// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { MeshCoreClient } from '@/lib/meshcore/client';
import { repeaterCliRequest } from '@/lib/session/cliQueue';
import { parseNeighborsReply } from '@/lib/meshcore/repeaterCli';
import { isErrorReply } from '@/lib/meshcore/repeaterConfig';
import {
  NEIGHBOR_ORDER,
  NEIGHBORS_PAGE_SIZE,
  NEIGHBORS_READ_LIMIT,
} from '@/lib/meshcore/constants';
import i18n from '@/lib/i18n';
import type { Contact, Neighbor } from '@/types/meshcore';

// Raised when the walk finished but came up short of the total the repeater
// reported. Distinct from "the node did not answer": the request plainly works,
// so falling back to the CLI would replace a nearly complete list with a
// definitely shorter one.
class IncompleteWalkError extends Error {
  constructor(collected: number, total: number) {
    super(`Read ${collected} of ${total} neighbors`);
    this.name = 'IncompleteWalkError';
  }
}

/**
 * Reads a repeater's neighbor table, preferring the structured
 * `GET_NEIGHBOURS` binary request and falling back to scraping the `neighbors`
 * CLI reply.
 *
 * @remarks
 * The two paths are not equivalent, which is the point of preferring the first:
 * the CLI reply is built into a single 160-byte text message and the firmware
 * stops appending rows at 134 bytes, so it silently caps the list at roughly
 * eight neighbors out of the fifty a repeater can hold. The structured read is
 * paged and returns the table's true size, so it walks the whole thing.
 *
 * Degrading is by observation, never by version number. The firmware does not
 * raise its advertised version for `GET_NEIGHBOURS`, so there is nothing
 * trustworthy to gate on: a local radio that does not know `SEND_BINARY_REQ`
 * says so with a device error — definitive, and remembered for the session —
 * while a repeater that does not implement the request simply answers nothing,
 * which is indistinguishable from a lost reply and so is never remembered.
 * @param contact - the repeater, which must already have an admin session.
 * @returns every neighbor the repeater reported, newest first.
 * @throws if neither path answered, or the CLI answered with a rejection —
 * both distinct from a repeater that genuinely has no neighbors.
 */
export async function readNeighbors(
  client: MeshCoreClient,
  contact: Contact,
): Promise<Neighbor[]> {
  // Attempted on every read, with no per-repeater memo of past failures. There
  // is no signal that distinguishes "this firmware has no handler" from "that
  // response was lost": both are silence. Remembering a failure therefore means
  // guessing, and guessing wrong costs the untruncated list for the rest of the
  // session without telling anyone — while guessing right saves only one
  // receipt-derived timeout on a read that then spends far longer on the CLI
  // anyway. Observed on a live mesh: two lost responses in a row were enough to
  // strand a repeater that answers this request perfectly well.
  if (!client.binaryRequestsUnsupported) {
    try {
      return await readNeighborsWhole(client, contact);
    } catch (err) {
      // An incomplete walk is not a reason to fall back. The node answered, so
      // the CLI would only return a shorter list than the one just collected —
      // raising instead leaves the tab on its error state with whatever it had
      // cached, and a Refresh retries the structured read.
      if (err instanceof IncompleteWalkError) throw err;
      // Everything else — an unsupported command, an unanswered request, a
      // response this client could not decode — leaves the CLI worth trying.
    }
  }
  return readNeighborsViaCli(client, contact);
}

// Runs the paged walk, retrying once if it comes up short of the total the
// repeater reported. Each page is sorted from the live table afresh, so a
// neighbor heard mid-walk can shift into a window already read and be dropped
// as a duplicate while `read` still advances past it — leaving fewer unique
// rows than the node says it holds. That is transient, so a second walk usually
// closes it; a walk still short after that is reported rather than cached as
// the complete table.
async function readNeighborsWhole(
  client: MeshCoreClient,
  contact: Contact,
): Promise<Neighbor[]> {
  let last: { neighbors: Neighbor[]; total: number } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const walk = await readNeighborsPaged(client, contact);
    if (walk.neighbors.length >= walk.total) return walk.neighbors;
    // Keep whichever attempt saw more, so the error reports the best figure.
    if (!last || walk.neighbors.length > last.neighbors.length) last = walk;
  }
  throw new IncompleteWalkError(last!.neighbors.length, last!.total);
}

// Walks the repeater's table one page at a time. Each page is its own mesh
// round trip, so the walk stops as soon as the reported total is covered, and
// is bounded by the largest table the firmware can hold — a node reporting an
// implausible total must not be able to keep this going.
async function readNeighborsPaged(
  client: MeshCoreClient,
  contact: Contact,
): Promise<{ neighbors: Neighbor[]; total: number }> {
  const neighbors: Neighbor[] = [];
  const seen = new Set<string>();
  // The table size as the node last reported it. Tracked so the caller can tell
  // a complete walk from one that ran out of rows, pages, or budget.
  let total = 0;
  // Counts rows the repeater handed over, not rows kept: it is the window
  // position, and advancing it by the deduplicated count would leave a node
  // that keeps repeating a page asking for that same page forever. It is also
  // why the walk can finish with fewer unique rows than `total` — dropped
  // duplicates are counted here but not kept — which is what the caller checks
  // for. A total above NEIGHBORS_READ_LIMIT ends the walk the same way, so the
  // cap cannot pass for a complete table either.
  let read = 0;
  while (read < NEIGHBORS_READ_LIMIT) {
    // A page lost part-way through the walk is deliberately *not* salvaged into
    // a partial success. The caller caches whatever it gets as the repeater's
    // table with no indication it is short, so returning the rows read so far
    // would silently truncate the list — the exact failure this whole path
    // exists to fix. Letting it raise hands the caller its fallback and error
    // paths instead.
    const page = await client.requestNeighbors(contact, {
      count: NEIGHBORS_PAGE_SIZE,
      offset: read,
      orderBy: NEIGHBOR_ORDER.NEWEST_FIRST,
    });
    total = page.total;
    if (page.neighbors.length === 0) {
      // Nothing came back. That is the normal end of the walk when the total
      // agrees, but a node still claiming more rows than it has handed over has
      // contradicted itself — returning the rows so far would cache a list the
      // repeater itself says is short, which is the truncation this path exists
      // to remove. Raising also keeps an over-reported total from looping.
      if (page.total > read) {
        throw new Error(
          `Repeater reported ${page.total} neighbors but returned ${read}`,
        );
      }
      break;
    }
    read += page.neighbors.length;
    for (const neighbor of page.neighbors) {
      // The repeater re-sorts its table per request, so a node heard between
      // two pages can shift into a window already read. Drop the duplicate
      // rather than show one neighbor twice.
      //
      // This identifies a neighbor by the prefix alone, which two of them could
      // in principle share. Nothing better is on offer: age and SNR both move
      // between pages, and the only stronger key is a longer prefix — asking
      // for the full 32-byte key would cut a page from ten rows to three and
      // more than triple the mesh round trips for a full table. At eight bytes
      // a collision between two neighbors of the same repeater is not a case
      // worth paying that for.
      if (seen.has(neighbor.prefix)) continue;
      seen.add(neighbor.prefix);
      neighbors.push(neighbor);
    }
    if (read >= page.total) break;
  }
  return { neighbors, total };
}

// The legacy path: ask the repeater's console for `neighbors` and parse the
// text. A protocol-level rejection ("Err - ??", from firmware without the
// command) resolves the request but answers nothing, so it is raised rather
// than returned as an empty list — the caller must not cache it as "no
// neighbors".
async function readNeighborsViaCli(
  client: MeshCoreClient,
  contact: Contact,
): Promise<Neighbor[]> {
  const reply = await repeaterCliRequest(client, contact, 'neighbors');
  if (isErrorReply(reply)) {
    throw new Error(i18n.t('repeaterAdmin.neighbors.error'));
  }
  return parseNeighborsReply(reply);
}
