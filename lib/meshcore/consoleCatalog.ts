// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

import {
  ALL_REPEATER_SETTINGS,
  getCommand,
  setCommand,
  type RepeaterSetting,
  type RepeaterSettingId,
} from '@/lib/meshcore/repeaterConfig';

/**
 * The vocabulary the raw repeater console offers at the prompt: every command
 * the Config tab already models (`get`/`set` on the {@link
 * ALL_REPEATER_SETTINGS} catalog) plus the free-standing verbs it does not,
 * with the syntax, accepted values and one-line explanation used for inline
 * help and completion. Command strings follow the CLI reference at
 * https://docs.meshcore.io/cli_commands/.
 *
 * @remarks
 * Only commands a *remote* admin can usefully run are listed. The firmware's
 * serial-only verbs (`stats-core`, `region list`, `get acl`, `log`, …) answer
 * nothing over `TXT_TYPE_CLI_DATA`, so offering them would spend the node's
 * airtime for no reply.
 */

/**
 * i18n-safe ids for the free-standing verbs; the one-line explanation for each
 * lives under `repeaterAdmin.console.help.verbs.<id>`. Settings-derived
 * commands reuse the Config tab's hints instead and have no id here.
 */
export type ConsoleVerbId =
  | 'ver'
  | 'board'
  | 'clock'
  | 'clockSync'
  | 'time'
  | 'advert'
  | 'advertZeroHop'
  | 'neighbors'
  | 'neighborRemove'
  | 'discoverNeighbors'
  | 'clearStats'
  | 'logStart'
  | 'logStop'
  | 'logErase'
  | 'getRole'
  | 'getPublicKey'
  | 'getOwnerInfo'
  | 'setOwnerInfo'
  | 'password'
  | 'powersaving'
  | 'setperm'
  | 'startOta'
  | 'reboot'
  | 'poweroff'
  | 'erase'
  | 'help';

/** Every i18n key a {@link ConsoleCommand} may point its explanation at. */
export type ConsoleHelpKey =
  | `repeaterAdmin.console.help.verbs.${ConsoleVerbId}`
  | `repeaterAdmin.config.fields.${RepeaterSettingId}.hint`;

/** One command the console knows how to complete and document. */
export interface ConsoleCommand {
  /**
   * The literal prefix completion inserts, without any argument — e.g.
   * `set flood.max`. Unique across the catalog, so it doubles as the React key.
   */
  cmd: string;
  /**
   * The full form shown in help, with `<…>` placeholders for required
   * arguments and `[…]` for optional ones.
   */
  syntax: string;
  helpKey: ConsoleHelpKey;
  /**
   * The accepted argument values as the firmware spells them — an inclusive
   * `min-max` range for numbers, or a `a|b|c` list of literal wire tokens.
   * Absent when the argument is free-form or there is no argument.
   */
  values?: string;
  /** Whether the command takes an argument, so completion leaves a space. */
  takesArg?: boolean;
}

/**
 * Verbs whose first word puts the node's configuration, memory or power state
 * at risk, and which the console therefore confirms before transmitting. Every
 * `set` is included: a remote node reached over three hops can be configured
 * out of contact by a single typo. `setperm` deliberately is not — it is a
 * separate verb, not a `set`, and is matched whole rather than by prefix.
 */
const DESTRUCTIVE_VERBS: readonly string[] = [
  'set',
  'reboot',
  'clkreboot',
  'poweroff',
  'shutdown',
  'erase',
];

/**
 * The one verb whose argument may legitimately be blank: the firmware reads
 * everything after `neighbor.remove ` as the prefix to match, and a lone space
 * is the documented way to say "every neighbor".
 */
const ALL_NEIGHBORS_VERB = 'neighbor.remove';

/**
 * Verbs the node cannot answer, because handling them ends with a call that
 * never returns — `_board->powerOff()` for `poweroff`/`shutdown` and
 * `_board->reboot()` for `reboot`/`clkreboot`, all in
 * `CommonCLI::handleCommand` (`src/helpers/CommonCLI.cpp`). Every other verb
 * the console offers writes a reply, including `erase`: over remote CLI its
 * `sender_timestamp == 0` guard fails, so the node answers "Unknown command".
 */
const SILENT_VERBS: readonly string[] = [
  'reboot',
  'clkreboot',
  'poweroff',
  'shutdown',
];

/**
 * Normalizes a typed command line for transmission. Trims the surrounding
 * whitespace, except for the single trailing space that turns
 * `neighbor.remove` into its documented remove-every-neighbor form — trimming
 * that would silently send a different command than the one the user typed.
 */
export function normalizeCommandLine(line: string): string {
  const trimmed = line.trim();
  return trimmed === ALL_NEIGHBORS_VERB && /\s$/.test(line)
    ? `${trimmed} `
    : trimmed;
}

/**
 * `true` when a typed command line's verb is one the console confirms before
 * sending. Matches the first whitespace-delimited token only, so `setperm` and
 * a node named `erase` in `set name erase` are judged by the verb alone.
 */
export function isDestructiveCommand(line: string): boolean {
  const verb = line.trim().split(/\s+/)[0].toLowerCase();
  return DESTRUCTIVE_VERBS.includes(verb);
}

/**
 * `true` when a command line's verb is one the node never answers, so silence
 * is the expected outcome rather than a lost round trip. Matched on the first
 * token like {@link isDestructiveCommand}; the firmware matches these verbs by
 * prefix, so an unknown suffix (`reboot` run together with a word) is judged as
 * its own verb here and merely waits longer than it needs to.
 */
export function isSilentCommand(line: string): boolean {
  const verb = line.trim().split(/\s+/)[0].toLowerCase();
  return SILENT_VERBS.includes(verb);
}

/** The argument placeholder a setting's `set` form takes. */
function argPlaceholder(setting: RepeaterSetting): string {
  switch (setting.kind) {
    case 'radio':
      return '<freq>,<bw>,<sf>,<cr>';
    case 'text':
      return '<text>';
    case 'toggle':
      return '<state>';
    default:
      return '<value>';
  }
}

/** The accepted values for a setting, or `undefined` when free-form. */
function argValues(setting: RepeaterSetting): string | undefined {
  switch (setting.kind) {
    case 'toggle':
      return `${setting.on}|${setting.off}`;
    case 'select':
      return setting.options.join('|');
    case 'number':
      return `${setting.min}-${setting.max}`;
    default:
      return undefined;
  }
}

/**
 * Expands one catalog setting into the console commands that read and write it.
 * Normally a `get <key>` and a `set <key> <value>` pair; the GPS verbs read and
 * write through the same word (`gps`, `gps advert`), so those collapse into a
 * single entry whose argument is optional.
 */
function settingCommands(setting: RepeaterSetting): ConsoleCommand[] {
  const read = getCommand(setting);
  const write = setCommand(setting, '').trimEnd();
  const arg = argPlaceholder(setting);
  const values = argValues(setting);
  const helpKey =
    `repeaterAdmin.config.fields.${setting.id}.hint` as ConsoleHelpKey;
  if (read === write) {
    return [{ cmd: read, syntax: `${read} [${arg}]`, helpKey, values }];
  }
  return [
    { cmd: read, syntax: read, helpKey },
    {
      cmd: write,
      syntax: `${write} ${arg}`,
      helpKey,
      values,
      takesArg: true,
    },
  ];
}

/**
 * Builds a free-standing verb entry, deriving {@link ConsoleCommand.cmd} from
 * the syntax by dropping everything from the first `<…>`/`[…]` placeholder on,
 * so the completed prefix and the documented form can never disagree.
 */
function verb(
  id: ConsoleVerbId,
  syntax: string,
  extra: Omit<ConsoleCommand, 'cmd' | 'syntax' | 'helpKey'> = {},
): ConsoleCommand {
  const words = syntax.split(' ');
  const end = words.findIndex((w) => w.startsWith('<') || w.startsWith('['));
  return {
    cmd: (end === -1 ? words : words.slice(0, end)).join(' '),
    syntax,
    helpKey: `repeaterAdmin.console.help.verbs.${id}`,
    ...extra,
  };
}

/** The verbs that have no Config-tab equivalent, in rough order of use. */
const CONSOLE_VERBS: readonly ConsoleCommand[] = [
  verb('help', 'help [<filter>]'),
  verb('ver', 'ver'),
  verb('board', 'board'),
  verb('getRole', 'get role'),
  verb('getPublicKey', 'get public.key'),
  verb('clock', 'clock'),
  verb('clockSync', 'clock sync'),
  verb('time', 'time <epoch_seconds>', { takesArg: true }),
  verb('advert', 'advert'),
  verb('advertZeroHop', 'advert.zerohop'),
  verb('neighbors', 'neighbors'),
  verb('neighborRemove', 'neighbor.remove <pubkey_prefix>', {
    takesArg: true,
  }),
  verb('discoverNeighbors', 'discover.neighbors'),
  verb('clearStats', 'clear stats'),
  verb('logStart', 'log start'),
  verb('logStop', 'log stop'),
  verb('logErase', 'log erase'),
  verb('getOwnerInfo', 'get owner.info'),
  verb('setOwnerInfo', 'set owner.info <text>', { takesArg: true }),
  verb('password', 'password <new_password>', { takesArg: true }),
  verb('powersaving', 'powersaving [<state>]', { values: 'on|off' }),
  verb('setperm', 'setperm <pubkey> [<permissions>]', {
    values: '0|1|2|3',
    takesArg: true,
  }),
  verb('startOta', 'start ota'),
  verb('reboot', 'reboot'),
  verb('poweroff', 'poweroff'),
  verb('erase', 'erase'),
];

/**
 * Every command the console documents and completes: the free-standing verbs
 * first, then the `get`/`set` pairs derived from the Config tab's catalog so
 * the two surfaces can never drift apart.
 */
export const CONSOLE_COMMANDS: readonly ConsoleCommand[] = [
  ...CONSOLE_VERBS,
  ...ALL_REPEATER_SETTINGS.flatMap(settingCommands),
];

/** How many completions the prompt offers at once. */
export const MAX_CONSOLE_SUGGESTIONS = 6;

/**
 * Completions for a partially typed command line, capped at
 * {@link MAX_CONSOLE_SUGGESTIONS}. A line that already spells a command in full
 * yields none, so a finished command leaves the prompt's keys — Enter, and the
 * history arrows — to the user rather than to the popover.
 */
export function matchConsoleCommands(line: string): ConsoleCommand[] {
  const query = line.trimStart().toLowerCase();
  if (query === '') return [];
  return CONSOLE_COMMANDS.filter((c) => {
    const cmd = c.cmd.toLowerCase();
    return cmd !== query && cmd.startsWith(query);
  }).slice(0, MAX_CONSOLE_SUGGESTIONS);
}

/**
 * The commands inline help lists for a filter: every command when the filter is
 * blank, otherwise those whose syntax contains it (case-insensitive), so
 * `help advert` finds `advert`, `advert.zerohop` and the advert intervals
 * alike.
 */
export function searchConsoleCommands(filter: string): ConsoleCommand[] {
  const query = filter.trim().toLowerCase();
  if (query === '') return [...CONSOLE_COMMANDS];
  return CONSOLE_COMMANDS.filter((c) => c.syntax.toLowerCase().includes(query));
}

/**
 * The filter a `help` / `?` command line asks for, or `null` when the line is
 * not a help request. A bare `help` returns an empty string (list everything).
 */
export function parseHelpCommand(line: string): string | null {
  const trimmed = line.trim();
  const match = /^(?:help|\?)(?:\s+(.*))?$/i.exec(trimmed);
  return match ? (match[1]?.trim() ?? '') : null;
}
