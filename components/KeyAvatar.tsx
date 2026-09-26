// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

import { IDENTITY_TEXT_CLASS } from '@/lib/identity/accent';
import { KEY_GLYPH_SIZE, keyGlyph } from '@/lib/identity/keyGlyph';

/**
 * A public key's fingerprint glyph, for showing beside the name it belongs
 * to. Decorative: the name next to it is what gets read out, so it is hidden
 * from assistive technology.
 *
 * @param pubkey - the key, or at least a 3-byte prefix of it, as hex.
 * Renders nothing for anything shorter.
 * @param size - the rendered edge, in CSS pixels.
 */
export function KeyAvatar({
  pubkey,
  size = 16,
}: {
  pubkey: string;
  size?: number;
}) {
  const glyph = keyGlyph(pubkey);
  if (!glyph) return null;
  // One unit of padding around the grid, so a filled edge cell does not touch
  // the tile's rounded corner.
  const view = KEY_GLYPH_SIZE + 2;
  return (
    <svg
      aria-hidden='true'
      width={size}
      height={size}
      viewBox={`0 0 ${view} ${view}`}
      shapeRendering='crispEdges'
      className={`shrink-0 rounded-sm bg-surface2 ${IDENTITY_TEXT_CLASS[glyph.color]}`}
    >
      {glyph.cells.map((filled, i) =>
        filled ? (
          <rect
            key={i}
            x={1 + (i % KEY_GLYPH_SIZE)}
            y={1 + Math.floor(i / KEY_GLYPH_SIZE)}
            width={1}
            height={1}
            fill='currentColor'
          />
        ) : null,
      )}
    </svg>
  );
}
