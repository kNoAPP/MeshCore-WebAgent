// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { IDENTITY_COLORS, type IdentityColor } from './accent';

/** Cells per side of a {@link KeyGlyph}. */
export const KEY_GLYPH_SIZE = 5;

/**
 * A public key drawn as a small mirrored pattern, so two keys that share a
 * name can still be told apart at a glance.
 */
export interface KeyGlyph {
  color: IdentityColor;
  /** Row-major, {@link KEY_GLYPH_SIZE} squared; true is a filled cell. */
  cells: boolean[];
}

// The left half and the middle column; the right half mirrors the left.
const HALF = Math.ceil(KEY_GLYPH_SIZE / 2);

/**
 * The glyph for a public key, or a prefix of one.
 *
 * @remarks Read straight off the key's leading bytes, with no hash: an
 * Ed25519 public key is already uniform, and a contact's 6-byte prefix then
 * draws the same glyph as its full key. A glyph is a recognition aid, not a
 * check — 15 bits of pattern and six colors collide by chance, so it never
 * stands in for comparing keys.
 * @param hex - at least 3 bytes of the key, as hex; case is ignored.
 * @returns null when `hex` holds fewer than 3 bytes.
 */
export function keyGlyph(hex: string): KeyGlyph | null {
  const bytes = hex.match(/[0-9a-f]{2}/gi)?.slice(0, 3);
  if (!bytes || bytes.length < 3) return null;
  const [b0, b1, b2] = bytes.map((b) => parseInt(b, 16));
  const bits = (b1 << 8) | b2;
  const cells: boolean[] = [];
  for (let row = 0; row < KEY_GLYPH_SIZE; row++) {
    for (let col = 0; col < KEY_GLYPH_SIZE; col++) {
      const half = col < HALF ? col : KEY_GLYPH_SIZE - 1 - col;
      cells.push(((bits >> (row * HALF + half)) & 1) === 1);
    }
  }
  return { color: IDENTITY_COLORS[b0 % IDENTITY_COLORS.length], cells };
}
