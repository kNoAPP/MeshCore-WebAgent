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

// How many structured reads in a row must fail — each with the CLI then
// answering — before a repeater is taken to lack GET_NEIGHBOURS. One is not
// evidence: a single binary response lost on the mesh while the later CLI round
// trip happened to survive looks exactly the same, and downgrading on that
// would give up the untruncated read for the rest of the session over one
// dropped packet.
const CLI_ONLY_STRIKES = 2;

// Consecutive structured-read failures per repeater (keyed by pubkeyPrefix),
// counted only where the CLI then answered. Reset by a structured read that
// succeeds, so a node is downgraded only on a sustained pattern. Module-level
// like the CLI queues beside it, and cleared with them on teardown.
const structuredFailures = new Map<string, number>();

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
 * says so with a device error, and a repeater that does not implement the
 * request answers nothing at all, which arrives as a timeout.
 * @param contact - the repeater, which must already have an admin session.
 * @returns every neighbor the repeater reported, newest first.
 * @throws if neither path answered, or the CLI answered with a rejection —
 * both distinct from a repeater that genuinely has no neighbors.
 */
export async function readNeighbors(
  client: MeshCoreClient,
  contact: Contact,
): Promise<Neighbor[]> {
  const prefix = contact.pubkeyPrefix;
  const structured =
    !client.binaryRequestsUnsupported &&
    (structuredFailures.get(prefix) ?? 0) < CLI_ONLY_STRIKES;
  if (structured) {
    try {
      const neighbors = await readNeighborsPaged(client, contact);
      // This node does answer, so any earlier failures were the link.
      structuredFailures.delete(prefix);
      return neighbors;
    } catch {
      // Any failure falls through to the CLI: an unsupported command, an
      // unanswered request, or a response this client could not decode all
      // leave the same thing worth trying.
    }
  }
  const neighbors = await readNeighborsViaCli(client, contact);
  // The CLI answering where the structured read did not is weak evidence about
  // the firmware — a lost response looks the same — so it counts a strike
  // rather than settling the question. A node that answered neither was
  // unreachable and says nothing at all, so it is not counted.
  if (structured) {
    structuredFailures.set(prefix, (structuredFailures.get(prefix) ?? 0) + 1);
  }
  return neighbors;
}

// Walks the repeater's table one page at a time. Each page is its own mesh
// round trip, so the walk stops as soon as the reported total is covered, and
// is bounded by the largest table the firmware can hold — a node reporting an
// implausible total must not be able to keep this going.
async function readNeighborsPaged(
  client: MeshCoreClient,
  contact: Contact,
): Promise<Neighbor[]> {
  const neighbors: Neighbor[] = [];
  const seen = new Set<string>();
  // Counts rows the repeater handed over, not rows kept: it is the window
  // position, and advancing it by the deduplicated count would leave a node
  // that keeps repeating a page asking for that same page forever.
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
  return neighbors;
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

/**
 * Forgets which repeaters have been failing structured neighbor reads.
 *
 * @remarks Called on session teardown: the finding belongs to one radio's view
 * of one mesh, and a repeater can be reflashed between sessions.
 */
export function resetNeighborCapabilities(): void {
  structuredFailures.clear();
}
