// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  contactCategory,
  heardAgeSecs,
  normalizedLastHeard,
  type ContactCategory,
} from '@/lib/utils';
import { FAVORITE_FLAG, NO_PATH } from '@/lib/meshcore/constants';
import { LEGEND_CATEGORIES } from '@/lib/map/markers';
import type { Advert, Contact, Message } from '@/types/meshcore';

/**
 * One row of the Nodes directory: a node the radio has saved as a contact, a
 * node only the browser's advert cache has heard, or both merged into one.
 *
 * @remarks Unlike `MapNode`, a directory row does **not** require a location —
 * most heard nodes never advertise one, and they are exactly the rows the map
 * cannot show. Coordinates stay in the on-wire micro-degrees so they can be
 * handed straight to `formatDistanceBearing`.
 */
export interface DirectoryNode {
  /** Stable row key: the node's 12-hex public-key prefix. */
  key: string;
  pubkeyPrefix: string;
  /** Full 64-hex public key. */
  pubkey: string;
  /** Advertised name, falling back to the key prefix for an unnamed node. */
  name: string;
  advType: number;
  /** The saved contact, or `null` when only the advert cache knows the node. */
  contact: Contact | null;
  /** The cached advert, or `null` when only the radio's table knows it. */
  advert: Advert | null;
  /** Favorited on the radio; a heard-only node can never be favorited. */
  favorite: boolean;
  /**
   * Unix epoch seconds of the freshest advert across both stores, normalized
   * to our clock by `normalizedLastHeard`, or `undefined` when neither carries
   * one. Never in the future, so readers may subtract it from now.
   */
  lastHeard?: number;
  /**
   * Latitude in micro-degrees; `undefined`/`0` means no advertised location.
   */
  advLat?: number;
  advLon?: number;
  /**
   * The radio's stored route length, or `undefined` for a heard-only node the
   * radio holds no route for at all. {@link NO_PATH} means it floods.
   */
  outPathLen?: number;
  /**
   * SNR in dB of the most recent message received from this node, or
   * `undefined` when none has been received. See {@link lastSnrByPrefix}.
   */
  snr?: number;
}

/** Whether a directory row is saved in the radio's contact table. */
export function isSaved(node: DirectoryNode): boolean {
  return node.contact !== null;
}

/** The latest SNR one conversation carries for one node. */
interface SnrReading {
  snr: number;
  /** Sender's clock in epoch seconds, absent when the message carried none. */
  timestamp?: number;
}

// Keyed by the transcript array itself. The store replaces only the array of
// the conversation a message belongs to, so every other conversation keeps its
// identity and is answered from here instead of being walked again — without
// this, one inbound frame would re-read the whole uncapped history. A WeakMap
// holds nothing alive once a conversation is dropped.
const conversationReadingCache = new WeakMap<
  Message[],
  Map<string, SnrReading>
>();

// The last SNR each node has in this one conversation. The transcript is in
// receipt order, which no sender's clock can distort, so a later entry simply
// supersedes an earlier one.
function conversationReadings(messages: Message[]): Map<string, SnrReading> {
  const cached = conversationReadingCache.get(messages);
  if (cached) return cached;
  const latest = new Map<string, SnrReading>();
  for (const m of messages) {
    if (m.own || typeof m.snr !== 'number' || !m.pubkeyPrefix) continue;
    latest.set(m.pubkeyPrefix, { snr: m.snr, timestamp: m.timestamp });
  }
  conversationReadingCache.set(messages, latest);
  return latest;
}

/**
 * The SNR of the most recently received message from each node, keyed by
 * public-key prefix.
 *
 * @remarks The contact table and the advert cache carry no signal quality, so
 * the only per-node SNR the app holds is the one stamped on each inbound
 * message.
 *
 * Within a conversation the transcript is in **receipt** order and a later
 * entry supersedes an earlier one. Two conversations share no such order — a
 * node's prefix appears on its direct messages and on anything it posts to a
 * channel — so those are reconciled by clock-clamped age, the rule
 * `normalizedLastHeard` already applies to last-advert timestamps. That
 * comparison is the only part that depends on the clock, and it runs over the
 * cached per-conversation results rather than over the messages themselves.
 *
 * @param nowSecs - reference clock in epoch seconds for that age comparison.
 */
export function lastSnrByPrefix(
  msgHistory: Record<string, Message[]>,
  nowSecs: number = Math.floor(Date.now() / 1000),
): Record<string, number> {
  const snr: Record<string, number> = {};
  const age: Record<string, number> = {};
  for (const messages of Object.values(msgHistory)) {
    for (const [prefix, reading] of conversationReadings(messages)) {
      // A reading with no timestamp cannot be placed against another
      // conversation's, so it only wins when nothing else has been seen.
      const readingAge = reading.timestamp
        ? heardAgeSecs(reading.timestamp, nowSecs)
        : Infinity;
      if (prefix in age && age[prefix] <= readingAge) continue;
      age[prefix] = readingAge;
      snr[prefix] = reading.snr;
    }
  }
  return snr;
}

// The firmware writes `0` for an unset coordinate, so a pair counts only when
// both halves are set. Taken from one record or the other and never mixed:
// a half-populated contact and a half-populated advert would otherwise
// synthesize a position neither of them advertised.
function advertisedCoords(
  ...sources: ({ advLat?: number; advLon?: number } | null | undefined)[]
): { advLat?: number; advLon?: number } {
  for (const source of sources) {
    if (source?.advLat && source.advLon) {
      return { advLat: source.advLat, advLon: source.advLon };
    }
  }
  return {};
}

/**
 * Merges the radio's contact table with the browser's advert cache into the
 * full directory, contacts winning over an advert from the same node. This
 * radio's own `selfPrefix` is left out — it is not a node the operator browses
 * to, message, or remove.
 *
 * @param snrByPrefix - per-node SNR from {@link lastSnrByPrefix}.
 * @param nowSecs - reference clock in epoch seconds, so every row's merged
 * last-heard is ranked against the same instant.
 */
export function collectDirectoryNodes(
  contacts: Record<string, Contact>,
  adverts: Record<string, Advert>,
  snrByPrefix: Record<string, number>,
  selfPrefix?: string,
  nowSecs: number = Math.floor(Date.now() / 1000),
): DirectoryNode[] {
  const nodes: DirectoryNode[] = [];
  const seen = new Set<string>();
  if (selfPrefix) seen.add(selfPrefix);

  for (const contact of Object.values(contacts)) {
    const prefix = contact.pubkeyPrefix;
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    const advert = adverts[prefix] ?? null;
    nodes.push({
      key: prefix,
      pubkeyPrefix: prefix,
      pubkey: contact.pubkey,
      name: contact.name || prefix.slice(0, 8),
      advType: contact.advType,
      contact,
      advert,
      favorite: (contact.flags & FAVORITE_FLAG) !== 0,
      lastHeard: normalizedLastHeard(contact, advert ?? undefined, nowSecs),
      // The cache keeps a position the contact table may not have yet.
      ...advertisedCoords(contact, advert),
      outPathLen: contact.outPathLen,
      snr: snrByPrefix[prefix],
    });
  }

  for (const advert of Object.values(adverts)) {
    const prefix = advert.pubkeyPrefix;
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    nodes.push({
      key: prefix,
      pubkeyPrefix: prefix,
      pubkey: advert.pubkey,
      name: advert.name || prefix.slice(0, 8),
      advType: advert.advType,
      contact: null,
      advert,
      favorite: false,
      lastHeard: normalizedLastHeard(undefined, advert, nowSecs),
      ...advertisedCoords(advert),
      snr: snrByPrefix[prefix],
    });
  }

  return nodes;
}

/** Which nodes the directory is listing. */
export interface NodeFilters {
  /** Categories left visible; a node outside the set is not listed. */
  categories: ContactCategory[];
  /**
   * `'saved'` keeps contacts, `'heard'` keeps cache-only nodes, `'all'` both.
   */
  storage: 'all' | 'saved' | 'heard';
  /** Only favorited contacts are listed. */
  favoritesOnly: boolean;
  /**
   * Widest clock-clamped age, in days, a node's last advert may have. `null`
   * lists every node regardless of age.
   */
  heardWithinDays: number | null;
}

/** Everything visible — the state the Nodes page opens in. */
export const DEFAULT_NODE_FILTERS: NodeFilters = {
  categories: LEGEND_CATEGORIES,
  storage: 'all',
  favoritesOnly: false,
  heardWithinDays: null,
};

/** Whether {@link filters} hides anything at all. */
export function nodeFiltersActive(filters: NodeFilters): boolean {
  return (
    filters.storage !== 'all' ||
    filters.favoritesOnly ||
    filters.heardWithinDays !== null ||
    filters.categories.length !== LEGEND_CATEGORIES.length
  );
}

/**
 * {@link filters} with {@link category} flipped. Rebuilt in legend order rather
 * than appended to, so which categories are on never depends on the order they
 * were clicked in.
 */
export function toggleNodeCategory(
  filters: NodeFilters,
  category: ContactCategory,
): NodeFilters {
  const on = filters.categories.includes(category);
  return {
    ...filters,
    categories: on
      ? filters.categories.filter((c) => c !== category)
      : LEGEND_CATEGORIES.filter(
          (c) => c === category || filters.categories.includes(c),
        ),
  };
}

/**
 * The subset of {@link nodes} that {@link filters} leaves listed. Ages come in
 * already normalized to our clock by `normalizedLastHeard`, so a window admits
 * exactly the nodes the table shows as that recent — including a node whose
 * clock runs ahead. A node with no timestamp at all is excluded by any window
 * rather than assumed recent.
 *
 * @param nowSecs - reference clock in epoch seconds. Taken as a parameter so
 * the caller decides when the window advances.
 */
export function filterDirectoryNodes(
  nodes: DirectoryNode[],
  filters: NodeFilters,
  nowSecs: number,
): DirectoryNode[] {
  const maxAgeSecs =
    filters.heardWithinDays === null ? null : filters.heardWithinDays * 86400;
  const categories = new Set(filters.categories);
  return nodes.filter((node) => {
    if (filters.favoritesOnly && !node.favorite) return false;
    if (filters.storage === 'saved' && !isSaved(node)) return false;
    if (filters.storage === 'heard' && isSaved(node)) return false;
    if (!categories.has(contactCategory(node.advType))) return false;
    if (maxAgeSecs === null) return true;
    if (node.lastHeard === undefined) return false;
    return heardAgeSecs(node.lastHeard, nowSecs) <= maxAgeSecs;
  });
}

/**
 * Matches the name shown in the row and the public-key prefix, which is the
 * only handle an unnamed node has. {@link query} must already be trimmed and
 * lower-cased.
 */
export function matchesNodeQuery(node: DirectoryNode, query: string): boolean {
  return (
    node.name.toLowerCase().includes(query) ||
    node.pubkey.toLowerCase().startsWith(query)
  );
}

/** Which column the directory is ordered by. */
export type NodeSortKey =
  | 'name'
  | 'type'
  | 'storage'
  | 'heard'
  | 'distance'
  | 'route'
  | 'snr'
  | 'favorite';

/** Ascending or descending order for the active {@link NodeSortKey}. */
export type SortDirection = 'asc' | 'desc';

/** The column the table opens ordered by, and in which direction. */
export const DEFAULT_NODE_SORT: NodeSortKey = 'heard';

/**
 * The direction a column starts in when it is first clicked. Recency, signal
 * and distance read best "best first", so they open descending — except
 * distance, where nearest is the useful end.
 */
export const INITIAL_SORT_DIRECTION: Record<NodeSortKey, SortDirection> = {
  name: 'asc',
  type: 'asc',
  storage: 'asc',
  heard: 'desc',
  distance: 'asc',
  route: 'asc',
  snr: 'desc',
  favorite: 'desc',
};

/**
 * Sorts a copy of {@link nodes} by {@link key}.
 *
 * @remarks Rows a column has no value for (no advert heard, no location, no
 * message received, no stored route) always sort last, in both directions —
 * an absent value is not a small one, and burying them under a descending sort
 * would hide the very nodes the operator is looking for. Ties break on name so
 * the order is total and the table never reshuffles between renders.
 *
 * @param distanceKm - kilometers from this radio per row key, for the distance
 * column; a key absent from the map has no measurable distance.
 * @param nowSecs - reference clock in epoch seconds for the recency column.
 */
export function sortDirectoryNodes(
  nodes: DirectoryNode[],
  key: NodeSortKey,
  direction: SortDirection,
  distanceKm: Map<string, number>,
  nowSecs: number,
  language: string,
): DirectoryNode[] {
  const sign = direction === 'asc' ? 1 : -1;
  const byName = (a: DirectoryNode, b: DirectoryNode): number =>
    a.name.localeCompare(b.name, language);

  // Ranks a row on the active column, or `null` when it has no value there.
  const rank = (node: DirectoryNode): number | string | null => {
    switch (key) {
      case 'name':
        return node.name;
      case 'type':
        // The advert type itself, not its marker category: the column shows
        // `Contact` and `Chat` as different values, and ranking by category
        // would collapse them into one bucket ordered by name.
        return node.advType;
      case 'storage':
        return isSaved(node) ? 0 : 1;
      case 'heard':
        // Negated so "larger is later" holds for every numeric column, and a
        // descending sort means "heard most recently first".
        return node.lastHeard === undefined
          ? null
          : -heardAgeSecs(node.lastHeard, nowSecs);
      case 'distance':
        return distanceKm.get(node.key) ?? null;
      case 'route':
        // An unsaved node and a saved one that floods both have no route; the
        // hop count orders the rest.
        return node.outPathLen === undefined || node.outPathLen === NO_PATH
          ? null
          : node.outPathLen;
      case 'snr':
        return node.snr ?? null;
      case 'favorite':
        return node.favorite ? 1 : 0;
    }
  };

  return [...nodes].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra === null || rb === null) {
      if (ra !== rb) return ra === null ? 1 : -1;
      return byName(a, b);
    }
    const cmp =
      typeof ra === 'string' && typeof rb === 'string'
        ? ra.localeCompare(rb as string, language)
        : (ra as number) - (rb as number);
    return cmp !== 0 ? cmp * sign : byName(a, b);
  });
}
