// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  claimLabelBox,
  labelFont,
  measureTextPx,
  type LabelBox,
  type PixelPoint,
} from '@/lib/map/labelBox';
import { MAP_MARKER_SIZE_PX } from '@/lib/map/config';
import type { MapNode } from '@/lib/map/nodes';

/**
 * Placement of the node names drawn beside their markers. Clustering separates
 * the *glyphs* by `MAP_CLUSTER_RADIUS_PX`, which says nothing about the names
 * hanging off them — and a map that does not cluster at all (the Neighbors
 * map, where a collapsed endpoint would detach an SNR link from its node) has
 * nothing separating them whatsoever. A name is therefore drawn only where it
 * clears the names already drawn, the way link labels already are.
 *
 * Pixel-based and Leaflet-free: the caller supplies the projected marker
 * position, and a placement only holds at the zoom it was computed at.
 */

// The rendered label is a single line pinned to the right of the glyph. These
// mirror `.map-marker-label` in `app/globals.css`: the gap is its `left`
// offset, the halo is how far its `text-shadow` spreads past the glyphs, and
// the cap is its `max-width` (10rem), past which the name is truncated with an
// ellipsis rather than widening the box.
const NODE_LABEL_SIZE_PX = 11;
const NODE_LABEL_WEIGHT = 600;
const NODE_LABEL_HEIGHT_PX = 16;
const NODE_LABEL_MAX_WIDTH_PX = 160;
const NODE_LABEL_HALO_PX = 3;
const NODE_LABEL_GAP_PX = 4;

/**
 * The order names are claimed in, as a sorted copy: this node first, then
 * favorites, then by key. Which labels survive a crowded viewport is decided
 * by whoever asks first, so the pass is ranked by how much the user cares
 * rather than by the order the nodes happen to arrive in — and tie-broken on
 * the key, so the same node set always produces the same map.
 */
export function nodeLabelOrder(nodes: MapNode[]): MapNode[] {
  return [...nodes].sort(
    (a, b) => labelRank(a) - labelRank(b) || (a.key < b.key ? -1 : 1),
  );
}

function labelRank(node: MapNode): number {
  if (node.kind === 'self') return 0;
  return node.favorite ? 1 : 2;
}

/**
 * Decides whether one marker's name can be drawn, claiming the pixels it would
 * occupy when it can.
 *
 * @param at - the marker's position in the map pane's pixel space; the label
 * hangs to the right of the glyph centered there.
 * @param placed - boxes already claimed, appended to with this label's own.
 * @returns whether to draw the name. A dropped name is not lost — the caller
 * is expected to offer it on hover instead, and it returns as soon as the user
 * zooms in far enough to separate the markers.
 */
export function placeNodeLabel(
  label: string,
  at: PixelPoint,
  placed: LabelBox[],
): boolean {
  const text = Math.min(
    measureTextPx(label, labelFont(NODE_LABEL_WEIGHT, NODE_LABEL_SIZE_PX)),
    NODE_LABEL_MAX_WIDTH_PX,
  );
  const width = text + 2 * NODE_LABEL_HALO_PX;
  const box: LabelBox = {
    at: {
      x: at.x + MAP_MARKER_SIZE_PX / 2 + NODE_LABEL_GAP_PX + width / 2,
      y: at.y,
    },
    width,
    height: NODE_LABEL_HEIGHT_PX,
  };
  return claimLabelBox(box, placed);
}
