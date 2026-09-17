// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * Pixel-space collision primitives shared by every label the map draws — the
 * per-link SNR tooltips (`lib/map/edgeLabel.ts`) and the node names beside
 * their markers (`lib/map/nodeLabel.ts`). Leaflet pins a label wherever it is
 * told and does no collision handling at all, so each caller estimates the box
 * its label would occupy and keeps the boxes it has placed, letting later
 * labels step aside or be dropped.
 *
 * The geometry is pure and pixel-based, so it carries no Leaflet import; the
 * caller supplies the projection, and a placement only holds at the zoom it
 * was computed at.
 */

/** A position in the map pane's pixel space. */
export interface PixelPoint {
  x: number;
  y: number;
}

/** A placed label's pixel box, centered on {@link at}. */
export interface LabelBox {
  at: PixelPoint;
  width: number;
  height: number;
}

/**
 * Approximate rendered width, in pixels, of a single line of label text.
 *
 * @param charPx - mean advance width of the label's font at its rendered size.
 * @param paddingPx - horizontal padding around the text, if the label has any.
 * @remarks Deliberately an estimate rounded up from what the browser reports,
 * so a near-miss still counts as a clash; measuring for real would mean laying
 * every candidate out in the DOM.
 */
export function labelWidthPx(
  label: string,
  charPx: number,
  paddingPx = 0,
): number {
  return label.length * charPx + paddingPx;
}

/** Whether two label boxes overlap. */
export function collides(a: LabelBox, b: LabelBox): boolean {
  return (
    Math.abs(a.at.x - b.at.x) < (a.width + b.width) / 2 &&
    Math.abs(a.at.y - b.at.y) < (a.height + b.height) / 2
  );
}

/**
 * Claims {@link box} when it clears every box already placed, appending it to
 * {@link placed} so later labels avoid it too.
 *
 * @returns whether the box was claimed; a caller with alternative positions
 * tries the next one, and a caller with only one drops its label.
 */
export function claimLabelBox(box: LabelBox, placed: LabelBox[]): boolean {
  if (!placed.every((other) => !collides(box, other))) return false;
  placed.push(box);
  return true;
}
