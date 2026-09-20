// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Advert, Message } from '@/types/meshcore';
import type { AutomationRule } from '@/types/automation';
import { mergeAdvertCache } from '@/lib/map/advertCache';
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
 * Both records describe the *same* node, so their raw claims share that node's
 * clock and rank correctly even when it is wrong — normalizing them instead
 * would invert the order, because the magnitude fallback reads the larger of
 * two future claims as the older one. Our own `observedAt` is preferred when
 * both sides carry it: it is the one reading that survives the node's clock
 * being corrected between the backup and now.
 */
// Whether the cached record is at least as recent as the backup's. Our own
// observation decides it when both sides carry one — that is the reading
// which survives the node's clock being corrected between the backup and now.
// Failing that, the raw claims decide: they share this node's clock, so they
// rank correctly even when it is wrong. A `0` claim carries no time at all,
// so whichever side holds an observation of ours outranks it rather than
// losing to a number the other side happens to have.
function keepsCached(cached: Advert, backup: Advert): boolean {
  const cachedSeen = cached.observedAt;
  const backupSeen = backup.observedAt;
  if (cachedSeen !== undefined && backupSeen !== undefined) {
    return cachedSeen >= backupSeen;
  }
  if (cached.lastHeard > 0 && backup.lastHeard > 0) {
    return cached.lastHeard >= backup.lastHeard;
  }
  if (cachedSeen !== undefined) return true;
  if (backupSeen !== undefined) return false;
  return cached.lastHeard >= backup.lastHeard;
}

export function freshAdverts(
  incoming: Record<string, Advert>,
  cached: Record<string, Advert>,
): Record<string, Advert> {
  const out: Record<string, Advert> = {};
  for (const [prefix, advert] of Object.entries(incoming)) {
    const existing = cached[prefix];
    if (existing && keepsCached(existing, advert)) continue;
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
