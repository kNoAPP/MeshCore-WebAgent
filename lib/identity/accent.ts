// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * The colors an identity can wear, each a `--identity-<name>` token in
 * `app/globals.css` with a light and a dark value. Deliberately no green or
 * red: a frame in either would read as link health, or as an error.
 */
export const IDENTITY_COLORS = [
  'teal',
  'lime',
  'amber',
  'orange',
  'pink',
  'violet',
] as const;

/** One of the {@link IDENTITY_COLORS}. */
export type IdentityColor = (typeof IDENTITY_COLORS)[number];

/**
 * The accent the app's chrome is framed in while an identity is live:
 * `'none'`, the default, leaves the chrome as it is.
 */
export type IdentityAccent = IdentityColor | 'none';

/**
 * Text color per identity color, for marks drawn in `currentColor`. Spelled
 * out whole so Tailwind's scanner generates every one.
 */
export const IDENTITY_TEXT_CLASS = {
  teal: 'text-identity-teal',
  lime: 'text-identity-lime',
  amber: 'text-identity-amber',
  orange: 'text-identity-orange',
  pink: 'text-identity-pink',
  violet: 'text-identity-violet',
} as const satisfies Record<IdentityColor, string>;

/** The header's frame: a stripe along its top edge. */
export const IDENTITY_TOP_FRAME_CLASS = {
  none: '',
  teal: 'border-t-3 border-t-identity-teal',
  lime: 'border-t-3 border-t-identity-lime',
  amber: 'border-t-3 border-t-identity-amber',
  orange: 'border-t-3 border-t-identity-orange',
  pink: 'border-t-3 border-t-identity-pink',
  violet: 'border-t-3 border-t-identity-violet',
} as const satisfies Record<IdentityAccent, string>;

/** The action bar's frame: a stripe along its bottom edge. */
export const IDENTITY_BOTTOM_FRAME_CLASS = {
  none: '',
  teal: 'border-b-3 border-b-identity-teal',
  lime: 'border-b-3 border-b-identity-lime',
  amber: 'border-b-3 border-b-identity-amber',
  orange: 'border-b-3 border-b-identity-orange',
  pink: 'border-b-3 border-b-identity-pink',
  violet: 'border-b-3 border-b-identity-violet',
} as const satisfies Record<IdentityAccent, string>;

/** The accent before the user chooses one. */
export const DEFAULT_IDENTITY_ACCENT: IdentityAccent = 'none';

/**
 * Normalizes a persisted (or corrupt) value into an {@link IdentityAccent},
 * falling back to {@link DEFAULT_IDENTITY_ACCENT}.
 */
export function normalizeIdentityAccent(raw: unknown): IdentityAccent {
  return typeof raw === 'string' &&
    (IDENTITY_COLORS as readonly string[]).includes(raw)
    ? (raw as IdentityColor)
    : DEFAULT_IDENTITY_ACCENT;
}
