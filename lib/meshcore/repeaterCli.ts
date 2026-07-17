// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * Parsing helpers for raw repeater CLI replies that aren't part of the
 * structured `get`/`set` catalog in `repeaterConfig.ts` — today just the
 * `neighbors` list. Command strings follow the CLI reference at
 * https://docs.meshcore.io/cli_commands/.
 */

/**
 * The exact hex length of a neighbor's public-key prefix in a `neighbors`
 * reply. The firmware emits `toHex(hex, id.pub_key, 4)` — a 4-byte (8-hex)
 * prefix — for every row (`simple_repeater/MyMesh.cpp` `formatNeighborsReply`),
 * so a row whose first field isn't exactly this is malformed and skipped.
 * Enforcing it also keeps a truncated token from reaching `neighbor.remove`,
 * whose firmware matches (and removes) every neighbor sharing the given prefix.
 */
const NEIGHBOR_PREFIX_HEX_LEN = 8;

/** Matches a well-formed neighbor prefix: exactly the firmware's hex length. */
const NEIGHBOR_PREFIX_RE = new RegExp(
  `^[0-9a-fA-F]{${NEIGHBOR_PREFIX_HEX_LEN}}$`,
);

/** One parsed row of a `neighbors` reply. */
export interface Neighbor {
  /** The node's 4-byte public-key prefix, as 8 lowercase hex characters. */
  prefix: string;
  /**
   * Unix epoch seconds the repeater last heard this neighbor. Derived at parse
   * time from the wire field, which is the *age* in seconds
   * (`now − heard_timestamp` on the node), converted to an absolute time so a
   * relative "heard N ago" label keeps growing while the tab stays open.
   */
  lastHeard: number;
  /** Signal-to-noise ratio in dB (the wire value divided by 4). */
  snr: number;
}

/**
 * Parses a `neighbors` CLI reply into rows. The reply lists up to the 8 most
 * recent adverts, one per line, each encoded as
 * `{pubkey-prefix}:{seconds-ago}:{snr*4}`; the SNR field is quartered here to
 * recover dB, and the seconds-ago field is converted to an absolute epoch.
 *
 * @remarks
 * Parses the whole reply as one block. The firmware caps the entire reply at
 * under 134 bytes (`formatNeighborsReply`), well inside the 160-byte message
 * limit, so the list always arrives in a single `onCliReply` frame — there is
 * nothing to accumulate across frames. Strict by design: only a line matching
 * the exact three-field grammar — an 8-hex prefix, a `uint32` age, and an
 * `int8` SNR (all in range) — yields a row, so the firmware's `-none-`
 * sentinel, an error reply, or any malformed/truncated line is skipped rather
 * than surfacing a bogus (and potentially over-broad) neighbor. The leading
 * `"> "` CLI prompt is stripped before parsing.
 */
export function parseNeighborsReply(text: string): Neighbor[] {
  const nowSecs = Math.floor(Date.now() / 1000);
  const neighbors: Neighbor[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^>+\s*/, '');
    const parts = line.split(':');
    if (parts.length !== 3) continue;
    const [prefix, ageField, snrField] = parts;
    // An 8-hex prefix, a non-negative integer age, and a signed integer SNR.
    // Explicit patterns reject blanks and stray characters that `Number('')`
    // (→ 0) would otherwise wave through.
    if (
      !NEIGHBOR_PREFIX_RE.test(prefix) ||
      !/^\d+$/.test(ageField) ||
      !/^-?\d+$/.test(snrField)
    ) {
      continue;
    }
    const age = Number(ageField);
    const snrQuarters = Number(snrField);
    // Enforce the firmware wire types: the age is a `uint32` seconds-ago and
    // the SNR a raw `int8` (quarter-dB). A value out of range is a malformed
    // row (e.g. an over-long digit run that still fit in one reply), so skip it
    // rather than surface an absurd last-heard or SNR.
    if (age > 0xffffffff || snrQuarters < -128 || snrQuarters > 127) continue;
    neighbors.push({
      prefix: prefix.toLowerCase(),
      lastHeard: nowSecs - age,
      snr: snrQuarters / 4,
    });
  }
  return neighbors;
}
