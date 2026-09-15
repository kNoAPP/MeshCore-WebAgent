// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

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

/** A position in the map pane's pixel space. */
export interface PixelPoint {
  x: number;
  y: number;
}

/** A placed label's pixel box, kept so later labels can avoid it. */
export interface LabelBox {
  at: PixelPoint;
  width: number;
}

// Fractions along an edge, in preference order, at which a label may sit. The
// midpoint reads best, so it is tried first; the rest walk outward in pairs so
// a crowded anchor spreads its labels along the edges rather than around them.
const LABEL_FRACTIONS = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8];

// The rendered label is a single line of 11px tabular digits. These estimate
// its box in map-pane pixels, rounded up from what the browser reports so a
// near-miss still counts as a clash.
const LABEL_HEIGHT_PX = 24;
const LABEL_CHAR_PX = 5.6;
const LABEL_PADDING_PX = 14;

/** Approximate rendered width, in pixels, of an edge label. */
export function labelWidthPx(label: string): number {
  return label.length * LABEL_CHAR_PX + LABEL_PADDING_PX;
}

function collides(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.abs(a.at.x - b.at.x) < (a.width + b.width) / 2 &&
    Math.abs(a.at.y - b.at.y) < LABEL_HEIGHT_PX
  );
}

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
  const width = labelWidthPx(label);
  for (const fraction of LABEL_FRACTIONS) {
    const box = { at: project(fraction), width };
    if (placed.every((other) => !collides(box, other))) {
      placed.push(box);
      return fraction;
    }
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
