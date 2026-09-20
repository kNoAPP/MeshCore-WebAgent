// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Advert, Message } from '@/types/meshcore';
import type { AutomationRule } from '@/types/automation';
import { mergeAdvertCache } from '@/lib/map/advertCache';
import { normalizedLastHeard } from '@/lib/utils';
import type { BackupPayload } from './archive';

/**
 * Pure counting and merging for a backup import: what a file would change if
 * applied, and the merged automation-rule list. Message history and the advert
 * cache already have merge primitives that import reuses — `restoreHistory`
 * (de-duplicates by message id) and `cacheAdverts`/`mergeAdvertCache` (newest
 * sighting wins, never clobbering a known name or location) — so this module
 * only has to describe what they will do.
 */

/**
 * What applying a backup would change, shown to the user before anything is
 * written. Counts are of *incoming* records, split by whether the browser
 * already holds them.
 */
export interface ImportPreview {
  /** Messages in the file that this browser has no record of. */
  newMessages: number;
  /** Messages in the file this browser already holds (skipped on merge). */
  duplicateMessages: number;
  /** Conversations the file carries that this browser has never seen. */
  newConversations: number;
  /** Cached adverts for nodes this browser has never heard of. */
  newAdverts: number;
  /** Cached adverts that would refresh an entry this browser already holds. */
  updatedAdverts: number;
  /**
   * Cached nodes this browser would *lose*: at `ADVERT_CACHE_LIMIT` the merge
   * keeps the most recently heard, so taking in a backup's nodes can push out
   * ones already held. Normally 0 — the import UI only mentions it when it
   * isn't, because it is the one part of a restore that is not purely additive.
   */
  evictedAdverts: number;
  /** Automation rules whose id is not already present. */
  newRules: number;
  /** Automation rules whose id is already present (kept, not overwritten). */
  existingRules: number;
  /** Channel slots the file describes (slot number and name; see
   * `BackupChannel` for why no secret travels with them). */
  channels: number;
  /** Whether the file carries a preferences blob that would be applied. */
  hasPreferences: boolean;
  /** Whether the file carries the radio's private key. */
  hasIdentity: boolean;
  /**
   * Whether the file was taken from a different radio than the connected one.
   * The import UI requires an explicit extra confirmation in that case — the
   * history and adverts would be grafted onto a node they never belonged to.
   */
  pubkeyMismatch: boolean;
}

/**
 * Describes what importing {@link payload} would do to the current in-memory
 * state, without changing anything.
 *
 * @param connectedPubkey - the connected radio's public key hex, or null when
 * no radio is connected (which counts as a mismatch: nothing can be checked).
 */
export function previewImport(
  payload: BackupPayload,
  current: {
    msgHistory: Record<string, Message[]>;
    advertCache: Record<string, Advert>;
    automationRules: AutomationRule[];
  },
  connectedPubkey: string | null,
): ImportPreview {
  let newMessages = 0;
  let duplicateMessages = 0;
  let newConversations = 0;
  for (const [convoId, msgs] of Object.entries(payload.msgHistory)) {
    const existing = current.msgHistory[convoId];
    if (!existing) newConversations++;
    const seen = new Set((existing ?? []).map((m) => m.id));
    for (const m of msgs) {
      // A message with no id predates the field; `restoreHistory` mints one on
      // restore, so it can never match an existing record and always lands.
      if (m.id !== undefined && seen.has(m.id)) duplicateMessages++;
      else {
        newMessages++;
        // Claimed as `restoreHistory` claims it, so an id repeated inside the
        // file is counted once here and dropped there, rather than promising a
        // message the merge will discard.
        if (m.id !== undefined) seen.add(m.id);
      }
    }
  }

  // Counted off the merge the import will actually run, so the numbers shown
  // are the ones that land: `freshAdverts` drops a backup entry older than the
  // cached sighting, and `mergeAdvertCache` then evicts the least recently
  // heard over ADVERT_CACHE_LIMIT — an incoming advert lost to either belongs
  // in neither column.
  const fresh = freshAdverts(payload.advertCache, current.advertCache);
  const mergedCache = mergeAdvertCache(current.advertCache, fresh);
  let newAdverts = 0;
  let updatedAdverts = 0;
  for (const advert of Object.values(fresh)) {
    if (!mergedCache[advert.pubkeyPrefix]) continue;
    if (current.advertCache[advert.pubkeyPrefix]) updatedAdverts++;
    else newAdverts++;
  }
  // The same cap can push out nodes this browser already had, which no other
  // count would show — a restore is otherwise additive, and the preview would
  // be promising that.
  let evictedAdverts = 0;
  for (const prefix of Object.keys(current.advertCache)) {
    if (!mergedCache[prefix]) evictedAdverts++;
  }

  const ruleIds = new Set(current.automationRules.map((r) => r.id));
  const newRules = payload.automationRules.filter(
    (r) => !ruleIds.has(r.id),
  ).length;

  return {
    newMessages,
    duplicateMessages,
    newConversations,
    newAdverts,
    updatedAdverts,
    evictedAdverts,
    newRules,
    existingRules: payload.automationRules.length - newRules,
    channels: payload.channels.length,
    hasPreferences: payload.preferences !== null,
    hasIdentity: payload.identityHex !== undefined,
    pubkeyMismatch:
      connectedPubkey === null ||
      connectedPubkey.toLowerCase() !== payload.pubkey,
  };
}

/**
 * Drops backup adverts the cache already knows about at least as recently,
 * leaving only genuinely newer records.
 *
 * @remarks `mergeAdvertCache` is written for adverts just heard off the air: it
 * spreads the incoming record over the cached one and only takes the newer
 * *timestamp*, so a backup's name, type and location would win even when the
 * cached sighting is more recent. Restoring an old backup must not roll live
 * metadata backwards, so the stale entries are removed before that merge sees
 * them — and {@link previewImport} counts the same way, so the preview promises
 * exactly what lands.
 *
 * Recency is compared as `normalizedLastHeard`, not as the raw `lastHeard`:
 * that field is the sender's clock, and a backup taken while a node's clock
 * ran ahead carries a claim that outranks every later sighting. Comparing the
 * our-clock estimate keeps such an entry from reinstating both its future
 * timestamp and the stale skew measured against the clock it has since had
 * corrected.
 */
export function freshAdverts(
  incoming: Record<string, Advert>,
  cached: Record<string, Advert>,
): Record<string, Advert> {
  const out: Record<string, Advert> = {};
  for (const [prefix, advert] of Object.entries(incoming)) {
    const existing = cached[prefix];
    const cachedHeard = normalizedLastHeard(undefined, existing);
    const backupHeard = normalizedLastHeard(undefined, advert);
    if (existing && (cachedHeard ?? 0) >= (backupHeard ?? 0)) continue;
    out[prefix] = advert;
  }
  return out;
}

/**
 * Folds a backup's automation rules into the current list. A rule whose id is
 * already present is left alone — the live copy may have been edited since the
 * backup, and silently reverting it would be the more surprising outcome.
 */
export function mergeAutomationRules(
  current: AutomationRule[],
  incoming: AutomationRule[],
): AutomationRule[] {
  const ids = new Set(current.map((r) => r.id));
  return [...current, ...incoming.filter((r) => !ids.has(r.id))];
}
