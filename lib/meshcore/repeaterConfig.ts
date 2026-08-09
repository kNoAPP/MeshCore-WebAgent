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
  | 'toggle'
  | 'number'
  | 'text'
  | 'select'
  | 'radio';

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
  | 'gps'
  | 'gpsAdvert'
  | 'repeat'
  | 'floodAdvertInterval'
  | 'advertInterval'
  | 'floodMax'
  | 'txdelay'
  | 'directTxdelay'
  | 'dutycycle'
  | 'loopDetect'
  | 'pathHashMode'
  | 'multiAcks'
  | 'cad'
  | 'radioFemRxgain';

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
  /**
   * Overrides the default `get <key>` read command, for firmware verbs that
   * aren't `get <key>` (e.g. the GPS module's `gps` / `gps advert`).
   */
  getCmd?: string;
  /**
   * Overrides the default `set <key> <value>` write command; the literal `<v>`
   * is replaced by the wire value (e.g. `gps <v>`, `gps advert <v>`).
   */
  setCmdTemplate?: string;
  /**
   * Extra reply prefixes (lowercase) that count as an error for THIS setting,
   * for firmware failures emitted without an `Err` prefix — e.g. the GPS
   * verbs' `gps toggle not found` / `can't find gps`. Scoped per setting so an
   * identical node name isn't misread as an error.
   */
  errorTokens?: readonly string[];
  /**
   * Marks a setting the node may legitimately not have — a newer firmware key
   * (`??: <key>`) or a board-specific capability (`Error: unsupported`). A
   * rejection hides the row silently instead of surfacing a toast, the way the
   * GPS verbs are handled.
   */
  optional?: boolean;
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
  | ToggleSetting
  | NumberSetting
  | TextSetting
  | SelectSetting
  | RadioSetting;

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
 * GPS advert location policies (`gps advert <policy>`): don't advertise a
 * location, advertise the live GPS fix, or advertise the stored fixed lat/lon.
 */
export const GPS_ADVERT_OPTIONS = ['none', 'share', 'prefs'] as const;

/**
 * The common settings, grouped for display. The advanced routing knobs live in
 * a separate list ({@link REPEATER_ADVANCED_SETTINGS}) rather than a group so
 * the tab can render them as their own independently loaded card.
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

/** Advanced routing settings, rendered as their own always-visible card. */
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
    // The firmware stores a fractional percentage (parsed as a float on set,
    // reported to one decimal on get), so keep it decimal rather than rounding
    // the cached value.
    step: 0.5,
    integer: false,
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
  // Firmware v1.17+: hardware channel-activity detection, off by default
  // because CAD still suffers multi-second radio lock-ups on some boards.
  {
    id: 'cad',
    key: 'cad',
    kind: 'toggle',
    on: 'on',
    off: 'off',
    optional: true,
  },
  // Firmware v1.17+, and only on boards whose LoRa front-end module has a
  // controllable LNA (some Heltec boards); others answer `Error: unsupported`.
  {
    id: 'radioFemRxgain',
    key: 'radio.fem.rxgain',
    kind: 'toggle',
    on: 'on',
    off: 'off',
    optional: true,
  },
];

/**
 * GPS controls, available only on nodes with GPS support compiled in (probed at
 * runtime, since the firmware rejects these verbs otherwise). Unlike the rest
 * of the catalog these use the firmware's dedicated `gps` / `gps advert` verbs
 * rather than `get`/`set <key>`, supplied via the command overrides.
 */
export const REPEATER_GPS_SETTINGS: readonly RepeaterSetting[] = [
  {
    id: 'gps',
    key: 'gps',
    kind: 'toggle',
    on: 'on',
    off: 'off',
    getCmd: 'gps',
    setCmdTemplate: 'gps <v>',
    errorTokens: ['gps toggle not found', "can't find gps"],
  },
  {
    id: 'gpsAdvert',
    key: 'gps.advert',
    kind: 'select',
    options: GPS_ADVERT_OPTIONS,
    getCmd: 'gps advert',
    setCmdTemplate: 'gps advert <v>',
    errorTokens: ["can't find gps"],
  },
];

/** Every setting, flattened — groups first, then the advanced knobs. */
export const ALL_REPEATER_SETTINGS: readonly RepeaterSetting[] = [
  ...REPEATER_SETTING_GROUPS.flatMap((g) => g.settings),
  ...REPEATER_ADVANCED_SETTINGS,
  ...REPEATER_GPS_SETTINGS,
];

/**
 * A verb the Config tab can invoke on the node. `destructive` gates the action
 * behind an inline confirm.
 */
/** i18n-safe action ids (copy under `repeaterAdmin.config.actions.<id>`). */
export type RepeaterActionId =
  | 'reboot'
  | 'advert'
  | 'advertZeroHop'
  | 'clockSync';

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
  return setting.getCmd ?? `get ${setting.key}`;
}

/** Builds the `set` command that writes a normalized wire {@link value}. */
export function setCommand(setting: RepeaterSetting, value: string): string {
  return setting.setCmdTemplate
    ? setting.setCmdTemplate.replace('<v>', value)
    : `set ${setting.key} ${value}`;
}

/**
 * `true` when a reply is an error rather than a value. Such replies must leave
 * the field unchanged and surface as a toast.
 *
 * @remarks
 * Matched by error *syntax*, not just a leading word, so a value that merely
 * starts with those letters — a node named `Error Relay` or
 * `Unknown Command Center` — still loads. The firmware emits `Err`/`Error`
 * either alone or followed by its error punctuation (`Err - …`, `Error, …`,
 * `ERROR: …`, `ERR: …`), the bare catch-all `??: …`, and the
 * `unknown config: …` / `Unknown command` rejections (emitted without an `Err`
 * prefix) for a key it doesn't know. A {@link setting} may also carry
 * {@link RepeaterSetting.errorTokens} for firmware failures phrased without an
 * `Err` prefix (e.g. the GPS verbs), matched only for that setting so an
 * identical node name isn't misread.
 */
export function isErrorReply(
  reply: string,
  setting?: RepeaterSetting,
): boolean {
  const text = stripPrompt(reply);
  if (
    /^err(or)?(\s*[-,:]|$)/i.test(text) ||
    text.startsWith('??') ||
    /^unknown config:/i.test(text) ||
    /^unknown command$/i.test(text)
  ) {
    return true;
  }
  if (setting?.errorTokens) {
    const lower = text.toLowerCase();
    return setting.errorTokens.some((tok) => lower.startsWith(tok));
  }
  return false;
}

/**
 * Strips the firmware's `"> "` CLI prompt prefix (and surrounding whitespace)
 * that leads every reply, so the value beneath can be parsed. Idempotent and
 * safe on replies that lack the marker.
 */
function stripPrompt(reply: string): string {
  return reply.trim().replace(/^>+\s*/, '');
}

/**
 * Strips the CLI prompt from a reply while preserving the value's own
 * surrounding whitespace. Firmware permits spaces in node names, so a full trim
 * (as {@link stripPrompt} does) would silently rename a node whose name has
 * leading or trailing spaces. Removes only a single leading prompt (`>` plus
 * one optional separator space) and any trailing line terminators.
 */
function stripPromptPreservingValue(reply: string): string {
  return reply.replace(/^\s*>+ ?/, '').replace(/[\r\n]+$/, '');
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
      // Take the first token so the GPS module's rich status reply
      // (`on, active, fix, 5 sats`) still reads as `on`.
      const token = (text.split(/[\s,]/)[0] ?? '').toLowerCase();
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
      return stripPromptPreservingValue(reply);
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
      if (bytes < 1 || bytes > (textMaxBytes ?? setting.maxBytes)) return false;
      // Mirror the firmware's isValidName, which rejects these characters, so a
      // bad name is caught here instead of only after a mesh round trip.
      return !/[[\]\\:,?*]/.test(value);
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
export function formatRadio(
  freq: number,
  bw: number,
  sf: number,
  cr: number,
): string {
  return `${freq},${bw},${sf},${cr}`;
}

function isValidRadio(value: string): boolean {
  const parsed = parseRadio(value);
  if (!parsed) return false;
  const { freq, bw, sf, cr } = parsed;
  return (
    freq >= RADIO_FREQ_MIN_MHZ &&
    freq <= RADIO_FREQ_MAX_MHZ &&
    // Firmware bandwidth range in kHz (may be fractional, e.g. 62.5).
    bw >= 7 &&
    bw <= 500 &&
    // SF and CR are integers on the wire; a fractional value would be silently
    // truncated by the firmware to a different setting than intended.
    Number.isInteger(sf) &&
    sf >= 5 &&
    sf <= 12 &&
    Number.isInteger(cr) &&
    cr >= 5 &&
    cr <= 8
  );
}
