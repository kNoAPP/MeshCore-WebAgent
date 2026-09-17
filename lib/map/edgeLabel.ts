// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  claimLabelBox,
  labelFont,
  measureTextPx,
  type LabelBox,
  type PixelPoint,
} from '@/lib/map/labelBox';

/**
 * Placement of the permanent labels drawn on map link edges (the Neighbors
 * map's per-link SNR). Leaflet pins a tooltip wherever it is told and does no
 * collision handling, so edges radiating from a common anchor would stack their
 * labels on top of each other at the shared midpoint. Sliding each label to a
 * different fraction of its own edge separates them, because radial edges
 * diverge as they leave the anchor.
 *
 * The geometry here is pure and pixel-based, so it is unit-testable and carries
 * no Leaflet import; the caller supplies the projection.
 */

// Fractions along an edge, in preference order, at which a label may sit. The
// midpoint reads best, so it is tried first; the rest walk outward in pairs so
// a crowded anchor spreads its labels along the edges rather than around them.
const LABEL_FRACTIONS = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8];

// The rendered label is a single line of 11px tabular digits, in a box that
// carries its own padding and sits clear of the line it labels.
const LABEL_HEIGHT_PX = 24;
const LABEL_SIZE_PX = 11;
const LABEL_WEIGHT = 400;
const LABEL_PADDING_PX = 14;

/**
 * Picks where along one edge its label should sit, preferring the midpoint and
 * sliding along the edge until the label clears every label already placed.
 *
 * Returns `null` when no candidate is clear — at a zoom where the edges have
 * collapsed into each other there is no position that reads, and an omitted
 * label is more useful than an unreadable pile. Placement is per zoom, so the
 * label reappears as soon as the user zooms in far enough to separate the
 * edges.
 *
 * @param project - maps a fraction of the edge to its pixel position at the
 * current zoom; placement is only valid for that zoom.
 * @param placed - boxes already claimed, appended to with the chosen one.
 * @returns the fraction along the edge, from its start, to anchor the label at.
 */
export function placeEdgeLabel(
  label: string,
  project: (fraction: number) => PixelPoint,
  placed: LabelBox[],
): number | null {
  const width =
    measureTextPx(label, labelFont(LABEL_WEIGHT, LABEL_SIZE_PX)) +
    LABEL_PADDING_PX;
  for (const fraction of LABEL_FRACTIONS) {
    const box = { at: project(fraction), width, height: LABEL_HEIGHT_PX };
    if (claimLabelBox(box, placed)) return fraction;
  }
  return null;
}

/**
 * The point a `fraction` of the way from `from` to `to`, in decimal degrees.
 * Interpolating in degrees rather than on the projected plane is fine here:
 * these are short links and the result only positions a label.
 */
export function pointAlongEdge(
  from: [number, number],
  to: [number, number],
  fraction: number,
): [number, number] {
  return [
    from[0] + (to[0] - from[0]) * fraction,
    from[1] + (to[1] - from[1]) * fraction,
  ];
}
