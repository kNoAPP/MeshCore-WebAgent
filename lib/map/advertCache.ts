// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { Advert } from '@/types/meshcore';

/**
 * A browser-persisted cache of advert metadata (name, type, location, last
 * heard) keyed by `pubkeyPrefix`. It lets the map plot nodes the connected
 * radio can't hold in its bounded contact table: a companion micro may only
 * fit a few hundred contacts, but the browser remembers every advert it has
 * ever heard, so discovered nodes (e.g. distant repeaters) stay on the map
 * across reloads and reconnects without ever being retrieved from the radio.
 */

/** localStorage key for the persisted advert cache. */
export const ADVERT_CACHE_STORAGE_KEY = 'meshcore.advertCache';

/**
 * Upper bound on cached adverts. Once exceeded, the oldest (by `lastHeard`) are
 * evicted so the serialized blob stays comfortably within the localStorage
 * quota even on a large, busy mesh.
 */
export const ADVERT_CACHE_LIMIT = 5000;

/** Delay before an in-memory cache change is flushed to localStorage. */
const SAVE_DEBOUNCE_MS = 1000;

/** Narrows an unknown parsed value to a well-formed {@link Advert}. */
function isAdvert(value: unknown): value is Advert {
  if (typeof value !== 'object' || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.pubkey === 'string' &&
    typeof a.pubkeyPrefix === 'string' &&
    typeof a.name === 'string' &&
    typeof a.advType === 'number' &&
    typeof a.lastHeard === 'number'
  );
}

/**
 * Reads the persisted advert cache from localStorage, dropping any malformed
 * entries. Returns an empty map on SSR, a parse error, or when nothing is
 * stored yet.
 */
export function loadAdvertCache(): Record<string, Advert> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ADVERT_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const cache: Record<string, Advert> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isAdvert(value)) cache[key] = value;
    }
    return cache;
  } catch {
    return {};
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Writes the advert cache to localStorage, debounced so a burst of adverts on a
 * busy mesh doesn't rewrite the whole blob on every frame. Best-effort —
 * quota/SSR failures are ignored.
 */
export function saveAdvertCache(cache: Record<string, Advert>): void {
  if (typeof window === 'undefined') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      window.localStorage.setItem(
        ADVERT_CACHE_STORAGE_KEY,
        JSON.stringify(cache),
      );
    } catch {}
  }, SAVE_DEBOUNCE_MS);
}

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
          advLat: advert.advLat ?? existing.advLat,
          advLon: advert.advLon ?? existing.advLon,
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
