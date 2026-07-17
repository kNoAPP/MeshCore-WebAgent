// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * Parsing helpers for raw repeater CLI replies that aren't part of the
 * structured `get`/`set` catalog in `repeaterConfig.ts` — today just the
 * `neighbors` list. Command strings follow the CLI reference at
 * https://docs.meshcore.io/cli_commands/.
 */

/** One parsed row of a `neighbors` reply. */
export interface Neighbor {
  /** The node's public-key prefix (hex), as reported by the repeater. */
  prefix: string;
  /** Unix epoch seconds the repeater last heard this neighbor. */
  lastHeard: number;
  /** Signal-to-noise ratio in dB (the wire value divided by 4). */
  snr: number;
}

/**
 * Parses a `neighbors` CLI reply into rows. The reply lists up to the 8 most
 * recent adverts, one per line, each encoded as
 * `{pubkey-prefix}:{timestamp}:{snr*4}` (per the CLI docs); the SNR field is
 * quartered here to recover dB.
 *
 * @remarks
 * Parses the assembled reply block: a short 8-line list fits comfortably in a
 * single CLI reply frame, so the caller passes the one reply text through here
 * rather than accumulating frames. Tolerant by design — a blank reply, an error
 * reply, or a malformed line yields no row for that line, so a partial reply
 * still surfaces whatever parsed. The firmware's leading `"> "` prompt is
 * stripped before parsing.
 */
export function parseNeighborsReply(text: string): Neighbor[] {
  const neighbors: Neighbor[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^>+\s*/, '');
    if (line === '') continue;
    const parts = line.split(':');
    if (parts.length < 3) continue;
    const prefix = parts[0].trim();
    const lastHeard = Number(parts[1]);
    const snrQuarters = Number(parts[2]);
    if (
      prefix === '' ||
      !/^[0-9a-fA-F]+$/.test(prefix) ||
      !Number.isFinite(lastHeard) ||
      !Number.isFinite(snrQuarters)
    ) {
      continue;
    }
    neighbors.push({ prefix, lastHeard, snr: snrQuarters / 4 });
  }
  return neighbors;
}
