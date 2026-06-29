// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * A community region preset: the LoRa parameters that let nodes in a region
 * hear each other. Units match {@link SelfInfo}/{@link RadioParams} —
 * `freq` in MHz, `bw` in kHz. `title` is a region identifier shown as-is (a
 * proper noun from the upstream list), not a translated UI string.
 */
export interface RadioPreset {
  title: string;
  freq: number;
  bw: number;
  sf: number;
  cr: number;
}

/**
 * Bundled snapshot of the official MeshCore region presets — the same
 * `suggested_radio_settings` the official config UI (`config.meshcore.io`)
 * loads from `https://api.meshcore.nz/api/v1/config`. They are community
 * suggestions, so they shift over time; this is a static copy (no runtime
 * fetch) and is refreshed by hand.
 *
 * @remarks
 * Snapshot taken 2026-06-28. Every value here lands within the editor's
 * dropdown option sets (`RADIO_BW_VALUES_KHZ`, `RADIO_SF_VALUES`,
 * `RADIO_CR_VALUES`) and the firmware's accepted ranges, so applying a preset
 * never produces an out-of-range field.
 */
export const RADIO_PRESETS: readonly RadioPreset[] = [
  { title: 'Australia', freq: 915.8, bw: 250, sf: 10, cr: 5 },
  { title: 'Australia (Narrow)', freq: 916.575, bw: 62.5, sf: 7, cr: 8 },
  { title: 'Australia (Mid)', freq: 915.075, bw: 125, sf: 9, cr: 5 },
  { title: 'Australia: SA, WA', freq: 923.125, bw: 62.5, sf: 8, cr: 8 },
  { title: 'Australia: QLD', freq: 923.125, bw: 62.5, sf: 8, cr: 5 },
  { title: 'Brazil', freq: 923.125, bw: 62.5, sf: 8, cr: 8 },
  { title: 'EU/UK (Narrow)', freq: 869.618, bw: 62.5, sf: 8, cr: 8 },
  { title: 'EU/UK (Deprecated)', freq: 869.525, bw: 250, sf: 11, cr: 5 },
  { title: 'Czech Republic (Narrow)', freq: 869.432, bw: 62.5, sf: 7, cr: 5 },
  { title: 'EU 433MHz (Long Range)', freq: 433.65, bw: 250, sf: 11, cr: 5 },
  { title: 'EU 433MHz (Narrow)', freq: 433.65, bw: 62.5, sf: 8, cr: 8 },
  { title: 'Netherlands', freq: 869.618, bw: 62.5, sf: 7, cr: 5 },
  { title: 'New Zealand', freq: 917.375, bw: 250, sf: 11, cr: 5 },
  { title: 'New Zealand (Narrow)', freq: 917.375, bw: 62.5, sf: 7, cr: 5 },
  { title: 'Portugal 433', freq: 433.375, bw: 62.5, sf: 9, cr: 6 },
  { title: 'Portugal 868', freq: 869.618, bw: 62.5, sf: 7, cr: 6 },
  { title: 'Switzerland', freq: 869.618, bw: 62.5, sf: 8, cr: 8 },
  { title: 'USA/Canada (Recommended)', freq: 910.525, bw: 62.5, sf: 7, cr: 5 },
  { title: 'Vietnam (Narrow)', freq: 920.25, bw: 62.5, sf: 8, cr: 5 },
  { title: 'Vietnam (Deprecated)', freq: 920.25, bw: 250, sf: 11, cr: 5 },
] as const;
