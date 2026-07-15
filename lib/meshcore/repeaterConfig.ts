// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import {
  RADIO_FREQ_MIN_MHZ,
  RADIO_FREQ_MAX_MHZ,
} from '@/lib/meshcore/constants';
import { utf8ByteLength } from '@/lib/utils';

/**
 * Data-driven catalog of the repeater/room-server settings the Config tab
 * edits over the CLI (`get <key>` / `set <key> <value>`). Every entry is pure
 * metadata plus tolerant reply parsing so the tab — and task 7.6's raw console
 * — can reuse it without per-field handlers. Command strings follow the CLI
 * reference at https://docs.meshcore.io/cli_commands/.
 */

/** The editor control a {@link RepeaterSetting} renders. */
export type RepeaterSettingKind =
  'toggle' | 'number' | 'text' | 'select' | 'radio';

/** Unit suffix after a numeric value (i18n key under `config.units`). */
export type RepeaterSettingUnit = 'dbm' | 'hours' | 'minutes' | 'percent';

/**
 * i18n-safe identifiers for every setting, so `t()` keys under
 * `repeaterAdmin.config.fields.<id>` resolve to a literal union at compile
 * time.
 */
export type RepeaterSettingId =
  | 'name'
  | 'lat'
  | 'lon'
  | 'radio'
  | 'tx'
  | 'repeat'
  | 'floodAdvertInterval'
  | 'advertInterval'
  | 'floodMax'
  | 'txdelay'
  | 'directTxdelay'
  | 'dutycycle'
  | 'loopDetect'
  | 'pathHashMode'
  | 'multiAcks';

interface BaseSetting {
  /**
   * i18n-safe identifier (camelCase). Labels live under
   * `repeaterAdmin.config.fields.<id>`; never has dots, unlike {@link key}.
   */
  id: RepeaterSettingId;
  /** CLI key: `get <key>` reads it, `set <key> <value>` writes it. */
  key: string;
  kind: RepeaterSettingKind;
  /** Whether the node must reboot before a change takes effect. */
  requiresReboot?: boolean;
}

/** An on/off flag; {@link on}/{@link off} are the exact wire tokens sent. */
export interface ToggleSetting extends BaseSetting {
  kind: 'toggle';
  on: string;
  off: string;
}

/** A bounded numeric field; {@link integer} rejects fractional input. */
export interface NumberSetting extends BaseSetting {
  kind: 'number';
  min: number;
  max: number;
  /** `<input>` step; `'any'` allows arbitrary precision (e.g. lat/lon). */
  step: number | 'any';
  integer: boolean;
  unit?: RepeaterSettingUnit;
}

/** A free-text field capped at {@link maxBytes} UTF-8 bytes. */
export interface TextSetting extends BaseSetting {
  kind: 'text';
  maxBytes: number;
}

/** A fixed set of string values; the wire token equals the chosen option. */
export interface SelectSetting extends BaseSetting {
  kind: 'select';
  options: readonly string[];
}

/** The composite LoRa parameters, set together as `<freq>,<bw>,<sf>,<cr>`. */
export interface RadioSetting extends BaseSetting {
  kind: 'radio';
}

/** One editable repeater setting. */
export type RepeaterSetting =
  ToggleSetting | NumberSetting | TextSetting | SelectSetting | RadioSetting;

/** A visual grouping of settings in the Config tab. */
export interface RepeaterSettingGroup {
  /** i18n-safe id; the title lives under `repeaterAdmin.config.groups.<id>`. */
  id: 'identity' | 'routing';
  settings: RepeaterSetting[];
}

/** Loop-detection modes the firmware accepts (v1.14+). */
export const LOOP_DETECT_OPTIONS = [
  'off',
  'minimal',
  'moderate',
  'strict',
] as const;

/** Advert path hash sizes (`0`=1 byte, `1`=2 byte, `2`=3 byte). */
export const PATH_HASH_MODE_OPTIONS = ['0', '1', '2'] as const;

/**
 * The common settings, grouped for display. Advanced routing knobs live in a
 * collapsed section (see {@link REPEATER_ADVANCED_SETTINGS}) rather than a
 * group so the tab can render them behind a disclosure.
 */
export const REPEATER_SETTING_GROUPS: readonly RepeaterSettingGroup[] = [
  {
    id: 'identity',
    settings: [
      { id: 'name', key: 'name', kind: 'text', maxBytes: 32 },
      {
        id: 'lat',
        key: 'lat',
        kind: 'number',
        min: -90,
        max: 90,
        step: 'any',
        integer: false,
      },
      {
        id: 'lon',
        key: 'lon',
        kind: 'number',
        min: -180,
        max: 180,
        step: 'any',
        integer: false,
      },
      { id: 'radio', key: 'radio', kind: 'radio', requiresReboot: true },
      {
        id: 'tx',
        key: 'tx',
        kind: 'number',
        min: 1,
        max: 22,
        step: 1,
        integer: true,
        unit: 'dbm',
      },
    ],
  },
  {
    id: 'routing',
    settings: [
      { id: 'repeat', key: 'repeat', kind: 'toggle', on: 'on', off: 'off' },
      {
        id: 'floodAdvertInterval',
        key: 'flood.advert.interval',
        kind: 'number',
        min: 3,
        max: 168,
        step: 1,
        integer: true,
        unit: 'hours',
      },
      {
        id: 'advertInterval',
        key: 'advert.interval',
        kind: 'number',
        min: 60,
        max: 240,
        step: 2,
        integer: true,
        unit: 'minutes',
      },
      {
        id: 'floodMax',
        key: 'flood.max',
        kind: 'number',
        min: 0,
        max: 64,
        step: 1,
        integer: true,
      },
    ],
  },
];

/** Advanced routing settings, rendered behind a collapsed disclosure. */
export const REPEATER_ADVANCED_SETTINGS: readonly RepeaterSetting[] = [
  {
    id: 'txdelay',
    key: 'txdelay',
    kind: 'number',
    min: 0,
    max: 2,
    step: 0.1,
    integer: false,
  },
  {
    id: 'directTxdelay',
    key: 'direct.txdelay',
    kind: 'number',
    min: 0,
    max: 2,
    step: 0.1,
    integer: false,
  },
  {
    id: 'dutycycle',
    key: 'dutycycle',
    kind: 'number',
    min: 1,
    max: 100,
    step: 1,
    integer: true,
    unit: 'percent',
  },
  {
    id: 'loopDetect',
    key: 'loop.detect',
    kind: 'select',
    options: LOOP_DETECT_OPTIONS,
  },
  {
    id: 'pathHashMode',
    key: 'path.hash.mode',
    kind: 'select',
    options: PATH_HASH_MODE_OPTIONS,
  },
  { id: 'multiAcks', key: 'multi.acks', kind: 'toggle', on: '1', off: '0' },
];

/** Every setting, flattened — groups first, then the advanced knobs. */
export const ALL_REPEATER_SETTINGS: readonly RepeaterSetting[] = [
  ...REPEATER_SETTING_GROUPS.flatMap((g) => g.settings),
  ...REPEATER_ADVANCED_SETTINGS,
];

/**
 * A verb the Config tab can invoke on the node. `destructive` gates the action
 * behind an inline confirm.
 */
/** i18n-safe action ids (copy under `repeaterAdmin.config.actions.<id>`). */
export type RepeaterActionId =
  'reboot' | 'advert' | 'advertZeroHop' | 'clockSync';

export interface RepeaterAction {
  /** i18n-safe id; label/confirm copy live under `config.actions.<id>`. */
  id: RepeaterActionId;
  /** The CLI command to send. */
  cmd: string;
  destructive?: boolean;
}

/**
 * The action verbs exposed in the Config tab. Excludes `erase`/factory-reset by
 * design (task 7.5 scope).
 */
export const REPEATER_ACTIONS: readonly RepeaterAction[] = [
  { id: 'reboot', cmd: 'reboot', destructive: true },
  { id: 'advert', cmd: 'advert' },
  { id: 'advertZeroHop', cmd: 'advert.zerohop' },
  { id: 'clockSync', cmd: 'clock sync' },
];

/** Builds the `get` command that reads a setting's current value. */
export function getCommand(setting: RepeaterSetting): string {
  return `get ${setting.key}`;
}

/** Builds the `set` command that writes a normalized wire {@link value}. */
export function setCommand(setting: RepeaterSetting, value: string): string {
  return `set ${setting.key} ${value}`;
}

/**
 * `true` when a reply is an error rather than a value. Such replies must leave
 * the field unchanged and surface as a toast.
 *
 * @remarks
 * The firmware is inconsistent about the prefix, emitting all of `Err`,
 * `Err - ??` (its catch-all for an unrecognized command), `Error`,
 * `Error, bad chars`, and `ERROR: dutycycle must be 1-100`. Older/other builds
 * also reject unknown keys without an `Err` prefix — `??: <cmd>`,
 * `unknown config: <key>`, and `Unknown command` — so those are treated as
 * failures too; otherwise a `set` to a setting the firmware lacks would be
 * confirmed as saved. The trailing word boundary keeps a value that merely
 * starts with those letters — a node named `Erratic Relay` — from reading as a
 * failure.
 */
export function isErrorReply(reply: string): boolean {
  const text = stripPrompt(reply);
  return (
    /^err(or)?\b/i.test(text) ||
    /^unknown (config|command)\b/i.test(text) ||
    text.startsWith('??')
  );
}

/**
 * Strips the firmware's `"> "` CLI prompt prefix (and surrounding whitespace)
 * that leads every reply, so the value beneath can be parsed. Idempotent and
 * safe on replies that lack the marker.
 */
function stripPrompt(reply: string): string {
  return reply.trim().replace(/^>+\s*/, '');
}

const ON_TOKENS = new Set(['on', '1', 'true', 'enabled', 'yes']);
const OFF_TOKENS = new Set(['off', '0', 'false', 'disabled', 'no']);

/** Matches a leading signed decimal, tolerating trailing units/whitespace. */
const NUMBER_RE = /-?\d+(?:\.\d+)?/;

/**
 * Tolerantly normalizes a `get` reply into the canonical wire value the UI
 * holds and would later send back via {@link setCommand}. Returns `null` when
 * the reply can't be interpreted for this setting, so the field is left at its
 * prior value. Callers must first reject {@link isErrorReply} replies.
 */
export function normalizeReply(
  setting: RepeaterSetting,
  reply: string,
): string | null {
  const text = stripPrompt(reply);
  switch (setting.kind) {
    case 'toggle': {
      const token = text.toLowerCase();
      if (ON_TOKENS.has(token)) return setting.on;
      if (OFF_TOKENS.has(token)) return setting.off;
      return null;
    }
    case 'number': {
      const match = text.match(NUMBER_RE);
      if (!match) return null;
      const n = Number(match[0]);
      if (!Number.isFinite(n)) return null;
      // Canonicalize integer fields so a node reply like `50.0%` shows as `50`.
      return setting.integer ? String(Math.round(n)) : match[0];
    }
    case 'select': {
      const token = text.toLowerCase();
      return setting.options.find((o) => o.toLowerCase() === token) ?? null;
    }
    case 'radio': {
      const parts = text.split(',').map((p) => p.trim());
      if (parts.length < 4) return null;
      const quad = parts.slice(0, 4);
      if (!quad.every((p) => NUMBER_RE.test(p) && Number.isFinite(Number(p)))) {
        return null;
      }
      return quad.join(',');
    }
    case 'text':
      return text;
  }
}

/**
 * The node-name byte budget, which the firmware shrinks from 32 to 24 once a
 * location is set (a non-zero lat/lon). Emoji and accents cost several bytes.
 */
export function nameMaxBytes(lat: string, lon: string): number {
  const hasLocation = isNonZeroCoord(lat) || isNonZeroCoord(lon);
  return hasLocation ? 24 : 32;
}

function isNonZeroCoord(value: string): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0;
}

/**
 * Validates a draft wire {@link value} against a setting's bounds. For the
 * `name` field, pass {@link textMaxBytes} to apply the location-aware budget.
 */
export function isValidValue(
  setting: RepeaterSetting,
  value: string,
  textMaxBytes?: number,
): boolean {
  switch (setting.kind) {
    case 'toggle':
      return value === setting.on || value === setting.off;
    case 'number': {
      const n = Number(value);
      if (value.trim() === '' || !Number.isFinite(n)) return false;
      if (setting.integer && !Number.isInteger(n)) return false;
      return n >= setting.min && n <= setting.max;
    }
    case 'select':
      return setting.options.includes(value);
    case 'radio':
      return isValidRadio(value);
    case 'text': {
      const bytes = utf8ByteLength(value);
      return bytes >= 1 && bytes <= (textMaxBytes ?? setting.maxBytes);
    }
  }
}

/** Parses a `freq,bw,sf,cr` wire string into its four numeric fields. */
export function parseRadio(
  value: string,
): { freq: number; bw: number; sf: number; cr: number } | null {
  const parts = value.split(',').map((p) => Number(p.trim()));
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [freq, bw, sf, cr] = parts;
  return { freq, bw, sf, cr };
}

/** Serializes four LoRa parameters into the `freq,bw,sf,cr` wire string. */
export function formatRadio(freq: number, bw: number, sf: number, cr: number) {
  return `${freq},${bw},${sf},${cr}`;
}

function isValidRadio(value: string): boolean {
  const parsed = parseRadio(value);
  if (!parsed) return false;
  const { freq, bw, sf, cr } = parsed;
  return (
    freq >= RADIO_FREQ_MIN_MHZ &&
    freq <= RADIO_FREQ_MAX_MHZ &&
    bw > 0 &&
    sf >= 5 &&
    sf <= 12 &&
    cr >= 5 &&
    cr <= 8
  );
}
