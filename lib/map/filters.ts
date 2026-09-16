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
 * Which of the plotted nodes the Map page is currently showing. Transient view
 * state, not a preference: it is deliberately not persisted per radio, so
 * opening the Map always starts from the whole mesh rather than from a filter
 * the operator set days ago and forgot.
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

/** Whether {@link filters} hides anything at all. */
export function filtersActive(filters: MapFilters): boolean {
  return (
    filters.favoritesOnly ||
    filters.heardWithinDays !== null ||
    filters.categories.length !== LEGEND_CATEGORIES.length
  );
}

/**
 * The subset of {@link nodes} that {@link filters} leaves visible. Age is
 * measured with `heardAgeSecs` against one captured clock, so a node whose RTC
 * runs ahead is judged by how far off it is rather than passing every window;
 * a node neither store carries a timestamp for is *not* claimed to have been
 * heard recently, so a window excludes it.
 */
export function filterMapNodes(
  nodes: MapNode[],
  filters: MapFilters,
): MapNode[] {
  const nowSecs = Math.floor(Date.now() / 1000);
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
