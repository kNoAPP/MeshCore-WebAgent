// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Advert, Message } from '@/types/meshcore';
import type { AutomationRule } from '@/types/automation';
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
  /** Automation rules whose id is not already present. */
  newRules: number;
  /** Automation rules whose id is already present (kept, not overwritten). */
  existingRules: number;
  /** Channel slots the file carries a secret for. */
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
      else newMessages++;
    }
  }

  // Counted off the filtered set, so the numbers shown are the ones that will
  // actually land — a backup entry older than the cached sighting is dropped by
  // `freshAdverts` and belongs in neither column.
  let newAdverts = 0;
  let updatedAdverts = 0;
  for (const prefix of Object.keys(
    freshAdverts(payload.advertCache, current.advertCache),
  )) {
    if (current.advertCache[prefix]) updatedAdverts++;
    else newAdverts++;
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
    newRules,
    existingRules: payload.automationRules.length - newRules,
    channels: payload.channels.filter((c) => c.secretHex).length,
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
 */
export function freshAdverts(
  incoming: Record<string, Advert>,
  cached: Record<string, Advert>,
): Record<string, Advert> {
  const out: Record<string, Advert> = {};
  for (const [prefix, advert] of Object.entries(incoming)) {
    const existing = cached[prefix];
    if (existing && existing.lastHeard >= advert.lastHeard) continue;
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
