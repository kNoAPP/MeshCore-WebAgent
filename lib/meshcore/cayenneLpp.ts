// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

import type { TelemetryReading } from '@/types/meshcore';

/**
 * CayenneLPP data-type codes MeshCore nodes emit, as a `type -> payload size`
 * map. The size is what the record occupies after its two header bytes, so an
 * unrecognized type ends the decode (there is no length prefix to skip past).
 *
 * @see the `LPP_*` defines in the firmware's
 * `src/helpers/sensors/LPPDataHelpers.h`.
 */
const LPP_SIZE = {
  0: 1, // digital input
  1: 1, // digital output
  2: 2, // analog input
  3: 2, // analog output
  100: 4, // generic sensor
  101: 2, // luminosity
  102: 1, // presence
  103: 2, // temperature
  104: 1, // relative humidity
  113: 6, // accelerometer
  115: 2, // barometric pressure
  116: 2, // voltage
  117: 2, // current
  118: 4, // frequency
  120: 1, // percentage
  121: 2, // altitude
  125: 2, // concentration
  128: 2, // power
  130: 4, // distance
  131: 4, // energy
  132: 2, // direction
  133: 4, // unix time
  134: 6, // gyrometer
  135: 3, // colour
  136: 9, // GPS
  142: 1, // switch
} as const satisfies Record<number, number>;

// Decoding rule per type we surface: how many bytes, the divisor that turns the
// raw integer into its unit, and whether the raw integer is two's complement.
// Types absent here are skipped by LPP_SIZE rather than reported.
const SCALARS = {
  0: { kind: 'digitalInput', div: 1, signed: false },
  1: { kind: 'digitalOutput', div: 1, signed: false },
  101: { kind: 'luminosity', div: 1, signed: false },
  102: { kind: 'presence', div: 1, signed: false },
  103: { kind: 'temperature', div: 10, signed: true },
  104: { kind: 'humidity', div: 2, signed: false },
  115: { kind: 'pressure', div: 10, signed: false },
  116: { kind: 'voltage', div: 100, signed: false },
  117: { kind: 'current', div: 1000, signed: true },
  120: { kind: 'percentage', div: 1, signed: false },
  121: { kind: 'altitude', div: 1, signed: true },
  128: { kind: 'power', div: 1, signed: false },
} as const satisfies Record<
  number,
  { kind: TelemetryReading['kind']; div: number; signed: boolean }
>;

const LPP_GPS = 136;

// Reads `size` big-endian bytes as an integer, two's complement when `signed`.
function readInt(
  d: Uint8Array,
  pos: number,
  size: number,
  signed: boolean,
): number {
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + d[pos + i];
  if (!signed) return value;
  const limit = 2 ** (size * 8 - 1);
  return value >= limit ? value - limit * 2 : value;
}

/**
 * Decodes a CayenneLPP blob — the payload of a `PUSH_TELEMETRY_RESPONSE` — into
 * the readings the app renders.
 *
 * @remarks
 * Each record is `[channel][type][payload]`, and **every field is big-endian**,
 * unlike the rest of the Companion Protocol. Channel `1`
 * (`TELEM_CHANNEL_SELF`) is the node itself; higher channels are its attached
 * sensors. Decoding stops at the first channel `0` (the firmware's end-of-data
 * marker), at an unrecognized type (nothing carries a length, so the reader
 * cannot resynchronize), or at a record the buffer is too short to hold — the
 * readings decoded before that point are still returned.
 * @returns one entry per decoded record, in wire order. Types the app does not
 * surface (accelerometer, colour, …) are stepped over rather than reported.
 * @see the `LPPReader` class in the firmware's
 * `src/helpers/sensors/LPPDataHelpers.h`.
 */
export function decodeCayenneLpp(d: Uint8Array): TelemetryReading[] {
  const readings: TelemetryReading[] = [];
  let pos = 0;
  while (pos + 2 <= d.length) {
    const channel = d[pos];
    const type = d[pos + 1];
    if (channel === 0) break;
    const size = LPP_SIZE[type as keyof typeof LPP_SIZE];
    if (size === undefined) break;
    pos += 2;
    if (pos + size > d.length) break;
    if (type === LPP_GPS) {
      readings.push({
        channel,
        kind: 'gps',
        lat: readInt(d, pos, 3, true) / 10000,
        lon: readInt(d, pos + 3, 3, true) / 10000,
        altMeters: readInt(d, pos + 6, 3, true) / 100,
      });
    } else {
      const scalar = SCALARS[type as keyof typeof SCALARS];
      if (scalar) {
        readings.push({
          channel,
          kind: scalar.kind,
          value: readInt(d, pos, size, scalar.signed) / scalar.div,
        });
      }
    }
    pos += size;
  }
  return readings;
}
