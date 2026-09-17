// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * Pixel-space collision primitives shared by every label the map draws — the
 * per-link SNR tooltips (`lib/map/edgeLabel.ts`) and the node names beside
 * their markers (`lib/map/nodeLabel.ts`). Leaflet pins a label wherever it is
 * told and does no collision handling at all, so each caller measures the box
 * its label would occupy and keeps the boxes it has placed, letting later
 * labels step aside or be dropped.
 *
 * The geometry is pixel-based and carries no Leaflet import; the caller
 * supplies the projection, and a placement only holds at the zoom it was
 * computed at.
 */

// The app's own font family, read once — it is a static rule in
// `app/globals.css` and nothing swaps it at runtime.
let family: string | undefined;

// One detached canvas for every measurement, and a memo per font.
let measureCtx: CanvasRenderingContext2D | null = null;
const measured = new Map<string, Map<string, number>>();

function measureContext(): CanvasRenderingContext2D {
  // `getContext('2d')` is only null when the canvas already has a context of
  // another kind, which a canvas created right here cannot have.
  measureCtx ??= document
    .createElement('canvas')
    .getContext('2d') as CanvasRenderingContext2D;
  return measureCtx;
}

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
 * The CSS `font` shorthand for a map label drawn at `sizePx` and `weight`. The
 * family is read off the document rather than restated here, so a measurement
 * can never drift from the family the app actually renders in.
 */
export function labelFont(weight: number, sizePx: number): string {
  family ??= getComputedStyle(document.body).fontFamily;
  return `${weight} ${sizePx}px ${family}`;
}

/**
 * Width, in pixels, of one line of {@link text} rendered in {@link font}.
 *
 * @remarks Measured rather than estimated per character: node names are
 * user-supplied, and in the app's proportional font a `W` is more than twice
 * the width of an `i`, so a character count would let two labels clear each
 * other on paper and still overlap on screen. The canvas is detached, so this
 * costs no layout, and results are memoized because the same names are
 * re-measured on every pan and zoom.
 */
export function measureTextPx(text: string, font: string): number {
  let widths = measured.get(font);
  if (!widths) {
    widths = new Map();
    measured.set(font, widths);
  }
  const cached = widths.get(text);
  if (cached !== undefined) return cached;
  const ctx = measureContext();
  ctx.font = font;
  const width = ctx.measureText(text).width;
  widths.set(text, width);
  return width;
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
