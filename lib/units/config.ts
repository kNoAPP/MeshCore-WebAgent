// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * Measurement systems the UI can display distances in. `metric` (kilometers) is
 * the authoritative default; `imperial` renders miles.
 */
export const SUPPORTED_UNIT_SYSTEMS = ['metric', 'imperial'] as const;

/** A unit system the app knows how to render. */
export type UnitSystem = (typeof SUPPORTED_UNIT_SYSTEMS)[number];

/** The default unit system, used before any choice is persisted. */
export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'metric';

/** Miles per kilometer, for converting metric distances to imperial. */
export const MILES_PER_KM = 0.621371;

/** Narrows an arbitrary string to a {@link UnitSystem}. */
export function isSupportedUnitSystem(value: string): value is UnitSystem {
  return (SUPPORTED_UNIT_SYSTEMS as readonly string[]).includes(value);
}

/**
 * Normalizes an arbitrary (persisted or corrupt) value into a valid
 * {@link UnitSystem}, falling back to {@link DEFAULT_UNIT_SYSTEM}.
 */
export function normalizeUnitSystem(raw: unknown): UnitSystem {
  return typeof raw === 'string' && isSupportedUnitSystem(raw)
    ? raw
    : DEFAULT_UNIT_SYSTEM;
}
