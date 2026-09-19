// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  contactCategory,
  heardAgeSecs,
  type ContactCategory,
} from '@/lib/utils';
import { LEGEND_CATEGORIES } from '@/lib/map/markers';
import type { MapNode } from '@/lib/map/nodes';

/**
 * Which of the plotted nodes the Map page is showing. A per-radio preference:
 * an operator who only ever cares about repeaters on one radio should not have
 * to say so again every session, so it travels in that radio's encrypted
 * preferences blob.
 */
export interface MapFilters {
  /** Only favorited contacts are plotted. */
  favoritesOnly: boolean;
  /** Categories left visible; a node outside the set is not plotted. */
  categories: ContactCategory[];
  /**
   * Widest clock-clamped age, in days, a node's last advert may have. `null`
   * plots every node regardless of age.
   */
  heardWithinDays: number | null;
}

/** Windows the "heard within" slider steps through; `null` is "any age". */
export const HEARD_WITHIN_DAY_CHOICES: readonly (number | null)[] = [
  1,
  3,
  7,
  14,
  30,
  null,
];

/** Everything visible — the state the Map page opens in. */
export const DEFAULT_MAP_FILTERS: MapFilters = {
  favoritesOnly: false,
  categories: LEGEND_CATEGORIES,
  heardWithinDays: null,
};

/** Every field of {@link MapFilters}, for handling them one at a time. */
export const MAP_FILTER_KEYS = [
  'favoritesOnly',
  'categories',
  'heardWithinDays',
] as const satisfies readonly (keyof MapFilters)[];

/**
 * Normalizes an arbitrary (persisted or corrupt) value into valid
 * {@link MapFilters}, so a tampered or half-written blob can only ever produce
 * a filter the UI can render and undo.
 */
export function normalizeMapFilters(raw: unknown): MapFilters {
  if (raw == null || typeof raw !== 'object') return DEFAULT_MAP_FILTERS;
  const parsed = raw as Partial<MapFilters>;
  const stored = parsed.categories;
  const days = parsed.heardWithinDays;
  return {
    favoritesOnly: parsed.favoritesOnly === true,
    // Rebuilt from the known set in legend order, so a duplicate, a junk entry
    // or a category this build no longer has cannot survive the round trip. An
    // empty array is a real state — every type hidden — so only a non-array
    // falls back to showing them all.
    categories: Array.isArray(stored)
      ? LEGEND_CATEGORIES.filter((c) => stored.includes(c))
      : DEFAULT_MAP_FILTERS.categories,
    // Only the windows the slider can actually land on, or it would sit at a
    // position that does not exist.
    heardWithinDays:
      typeof days === 'number' && HEARD_WITHIN_DAY_CHOICES.includes(days)
        ? days
        : null,
  };
}

/** Whether {@link filters} hides anything at all. */
export function filtersActive(filters: MapFilters): boolean {
  return (
    filters.favoritesOnly ||
    filters.heardWithinDays !== null ||
    filters.categories.length !== LEGEND_CATEGORIES.length
  );
}

/**
 * {@link filters} with {@link category} flipped. The set is rebuilt in legend
 * order rather than appended to, so which categories are on never depends on
 * the order they were clicked in.
 */
export function toggleCategory(
  filters: MapFilters,
  category: ContactCategory,
): MapFilters {
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
 * The subset of {@link nodes} that {@link filters} leaves visible. Ages come
 * in already normalized to our clock by `normalizedLastHeard`, so a window
 * admits exactly the nodes the list shows as that recent — including a node
 * whose RTC runs ahead. A node neither store carries a timestamp for is *not*
 * claimed to have been heard recently, so a window excludes it.
 *
 * @param nowSecs - the reference clock in epoch seconds. Taken as a parameter
 * rather than read here, so the caller decides when the window advances — read
 * internally, an age filter would freeze at whatever `Date.now()` said the last
 * time the node set happened to change.
 */
export function filterMapNodes(
  nodes: MapNode[],
  filters: MapFilters,
  nowSecs: number,
): MapNode[] {
  const maxAgeSecs =
    filters.heardWithinDays === null ? null : filters.heardWithinDays * 86400;
  const categories = new Set(filters.categories);
  return nodes.filter((node) => {
    if (filters.favoritesOnly && !node.favorite) return false;
    if (!categories.has(contactCategory(node.advType))) return false;
    if (maxAgeSecs === null) return true;
    if (node.lastHeard === undefined) return false;
    return heardAgeSecs(node.lastHeard, nowSecs) <= maxAgeSecs;
  });
}
