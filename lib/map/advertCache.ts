// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Advert } from '@/types/meshcore';

/**
 * The in-memory model for the advert-metadata cache (name, type, location,
 * last heard) keyed by `pubkeyPrefix`. It lets the map plot nodes the connected
 * radio can't hold in its bounded contact table: a companion micro may only fit
 * a few hundred contacts, but the browser remembers every advert it has heard,
 * so discovered nodes (e.g. distant repeaters) stay on the map across reloads
 * and reconnects without ever being retrieved from the radio.
 *
 * The cache is persisted per-radio, encrypted at rest under the connected
 * radio's derived key — the same scheme as message history (see
 * `lib/storage.ts`), so a different radio decrypts to a different cache and
 * none of it is stored on the radio itself. This module holds only the pure
 * merge logic; load/save live in `lib/storage.ts`, wired by `useMeshCore`.
 */

/**
 * Upper bound on cached adverts. Once exceeded, the oldest (by `lastHeard`) are
 * evicted so the encrypted blob stays comfortably within the IndexedDB quota
 * even on a large, busy mesh.
 */
export const ADVERT_CACHE_LIMIT = 5000;

/**
 * Folds a batch of freshly heard adverts into the cache, returning a new map.
 * An incoming advert supersedes its cached entry (a re-advert refreshes the
 * stored name/type/location), but a known location is never overwritten by an
 * advert that arrived without one. The result is capped to
 * {@link ADVERT_CACHE_LIMIT}, evicting the least-recently-heard nodes.
 */
export function mergeAdvertCache(
  cache: Record<string, Advert>,
  incoming: Record<string, Advert>,
): Record<string, Advert> {
  const merged: Record<string, Advert> = { ...cache };

  for (const advert of Object.values(incoming)) {
    const existing = merged[advert.pubkeyPrefix];
    merged[advert.pubkeyPrefix] = existing
      ? {
          ...existing,
          ...advert,
          lastHeard: Math.max(existing.lastHeard, advert.lastHeard),
          // `0` is the firmware's "unset" sentinel (not undefined), so a
          // re-advert without a fix must not clobber a known location — fall
          // back to the cached coordinates in that case.
          advLat: advert.advLat || existing.advLat,
          advLon: advert.advLon || existing.advLon,
        }
      : advert;
  }

  const keys = Object.keys(merged);
  if (keys.length <= ADVERT_CACHE_LIMIT) return merged;

  // Keep only the most-recently-heard nodes when over the cap.
  const kept = keys
    .sort((a, b) => merged[b].lastHeard - merged[a].lastHeard)
    .slice(0, ADVERT_CACHE_LIMIT);
  const capped: Record<string, Advert> = {};
  for (const key of kept) capped[key] = merged[key];
  return capped;
}
