// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * The colors an identity can wear. Each is a `--identity-<name>` token in
 * `app/globals.css` for text and marks, and a `--identity-frame-<name>` one
 * for the frame stripe, both with a light and a dark value. Deliberately no
 * green or red: a frame in either would read as link health, or as an error.
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

/**
 * The header's frame: a stripe along its top edge, thicker than the action
 * bar's so the live identity reads at a glance.
 */
export const IDENTITY_TOP_FRAME_CLASS = {
  none: '',
  teal: 'border-t-5 border-t-identity-frame-teal',
  lime: 'border-t-5 border-t-identity-frame-lime',
  amber: 'border-t-5 border-t-identity-frame-amber',
  orange: 'border-t-5 border-t-identity-frame-orange',
  pink: 'border-t-5 border-t-identity-frame-pink',
  violet: 'border-t-5 border-t-identity-frame-violet',
} as const satisfies Record<IdentityAccent, string>;

/** The action bar's frame: a stripe along its bottom edge. */
export const IDENTITY_BOTTOM_FRAME_CLASS = {
  none: '',
  teal: 'border-b-3 border-b-identity-frame-teal',
  lime: 'border-b-3 border-b-identity-frame-lime',
  amber: 'border-b-3 border-b-identity-frame-amber',
  orange: 'border-b-3 border-b-identity-frame-orange',
  pink: 'border-b-3 border-b-identity-frame-pink',
  violet: 'border-b-3 border-b-identity-frame-violet',
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
