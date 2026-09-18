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

// Repeaters known not to answer a structured GET_NEIGHBOURS, so the next read
// goes straight to the CLI instead of waiting out another full timeout. Only
// recorded when the structured read went unanswered *and* the CLI then
// answered: a node that answered neither was unreachable, which says nothing
// about its firmware. Keyed by pubkeyPrefix, module-level like the CLI queues
// beside it, and cleared with them on teardown.
const cliOnlyNeighbors = new Set<string>();

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
    !client.binaryRequestsUnsupported && !cliOnlyNeighbors.has(prefix);
  if (structured) {
    try {
      return await readNeighborsPaged(client, contact);
    } catch {
      // Any failure falls through to the CLI: an unsupported command, an
      // unanswered request, or a response this client could not decode all
      // leave the same thing worth trying.
    }
  }
  const neighbors = await readNeighborsViaCli(client, contact);
  // The CLI answering after the structured read did not is the one combination
  // that points at the firmware rather than at the link.
  if (structured) cliOnlyNeighbors.add(prefix);
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
    let page;
    try {
      page = await client.requestNeighbors(contact, {
        count: NEIGHBORS_PAGE_SIZE,
        offset: read,
        orderBy: NEIGHBOR_ORDER.NEWEST_FIRST,
      });
    } catch (err) {
      // A page lost part-way through the walk still leaves the rows already
      // read, and those are the ones the CLI fallback would have truncated
      // away. Only a walk that got nothing is worth falling back from.
      if (neighbors.length > 0) return neighbors;
      throw err;
    }
    // A page that carried nothing means the window ran past the table, whatever
    // the total claimed — without this an over-reported total would loop.
    if (page.neighbors.length === 0) break;
    read += page.neighbors.length;
    for (const neighbor of page.neighbors) {
      // The repeater re-sorts its table per request, so a node heard between
      // two pages can shift into a window already read. Drop the duplicate
      // rather than show one neighbor twice.
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
 * Forgets which repeaters were found to need the CLI fallback.
 *
 * @remarks Called on session teardown: the finding belongs to one radio's view
 * of one mesh, and a repeater can be reflashed between sessions.
 */
export function resetNeighborCapabilities(): void {
  cliOnlyNeighbors.clear();
}
