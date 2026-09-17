// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleQuestionMark, Trash2, X } from 'lucide-react';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import {
  isDestructiveCommand,
  matchConsoleCommands,
  normalizeCommandLine,
  parseHelpCommand,
  searchConsoleCommands,
  type ConsoleCommand,
} from '@/lib/meshcore/consoleCatalog';
import { formatRoundTrip } from '@/lib/i18n/format';
import type { CliLine } from '@/store/meshStore';
import type { Contact } from '@/types/meshcore';

// The console's "still waiting" glyph, shared by the in-line and standalone
// placements.
const PENDING_DOT_CLASS =
  'ml-2 inline-block h-2.5 w-2.5 animate-spin rounded-full border ' +
  'border-text2 border-t-transparent align-middle';

/**
 * Round-trip milliseconds for each transcript line, or `null` for lines that
 * aren't a reply: the gap between a reply and the command it answers. Commands
 * are sent strictly one at a time, so the nearest preceding own line is always
 * the one this reply belongs to. Client-side notes are excluded — a timeout
 * note measures the wait we gave up on, not a round trip.
 */
function roundTrips(lines: CliLine[]): (number | null)[] {
  let sentAt: number | null = null;
  return lines.map((line) => {
    if (line.own) {
      sentAt = line.ts;
      return null;
    }
    // Output that answered no outstanding request belongs to neither the
    // command above it nor any timing: it neither carries a round trip nor
    // closes one out.
    if (line.unsolicited) return null;
    // Whatever arrives first after a command closes it out, so a second frame
    // of a long reply isn't timed as if it were its own round trip.
    const at = sentAt;
    sentAt = null;
    return line.note || at === null ? null : line.ts - at;
  });
}

/**
 * The repeater admin Console: a raw CLI prompt against the selected node, with
 * the transcript, ↑/↓ history, Tab completion over the documented command
 * surface, inline help, and a confirm step in front of the verbs that change
 * the node.
 *
 * @remarks
 * Admin-only — current repeater/room firmware answers remote `CLI_DATA` only
 * for an admin client, so a guest would get no reply.
 */
export function RepeaterConsoleTab({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const { repeaterCli } = useMeshCore();
  const prefix = contact.pubkeyPrefix;
  const log = useMeshStore((s) => s.adminSessions[prefix]?.cli);
  const history = useMeshStore((s) => s.adminSessions[prefix]?.cliHistory);
  const clearCliLog = useMeshStore((s) => s.clearCliLog);
  const pushCliHistory = useMeshStore((s) => s.pushCliHistory);
  // Outstanding round trips are tracked in the session, not here, so switching
  // tabs and back while a slow command is in flight keeps the indicator.
  const cliPending = useMeshStore(
    (s) => s.adminSessions[prefix]?.cliPending ?? 0,
  );
  // The filter inline help is showing, or null when the help panel is closed.
  const [helpFilter, setHelpFilter] = useState<string | null>(null);

  const lines = useMemo(() => log ?? [], [log]);

  const run = (cmd: string) => {
    pushCliHistory(prefix, cmd);
    // A help request is answered from the local catalog: the point of it is to
    // learn what exists without spending the node's airtime to find out.
    const filter = parseHelpCommand(cmd);
    if (filter !== null) {
      setHelpFilter(filter);
      return;
    }
    setHelpFilter(null);
    // Every outcome lands in the transcript — the reply, or a muted note when
    // the node stays silent — so there is nothing to report here.
    void repeaterCli(contact, cmd);
  };

  return (
    <div className='flex h-full w-full flex-col gap-3'>
      <div className='relative flex-1 overflow-hidden rounded-lg border border-border bg-surface'>
        <div className='absolute top-2 right-2 z-10 flex gap-1'>
          <button
            onClick={() => setHelpFilter((f) => (f === null ? '' : null))}
            aria-expanded={helpFilter !== null}
            aria-label={t('repeaterAdmin.console.help.open')}
            title={t('repeaterAdmin.console.help.open')}
            className='rounded-md border border-border-control bg-surface p-1.5 text-text2 hover:bg-surface2 hover:text-text'
          >
            <CircleQuestionMark size={14} />
          </button>
          <button
            onClick={() => clearCliLog(prefix)}
            disabled={lines.length === 0}
            aria-label={t('repeaterAdmin.console.clear')}
            title={t('repeaterAdmin.console.clear')}
            className='rounded-md border border-border-control bg-surface p-1.5 text-text2 hover:bg-surface2 hover:text-text disabled:opacity-50 disabled:hover:bg-surface disabled:hover:text-text2'
          >
            <Trash2 size={14} />
          </button>
        </div>

        <ConsoleTranscript lines={lines} cliPending={cliPending} />

        {helpFilter !== null && (
          <ConsoleHelp
            filter={helpFilter}
            onClose={() => setHelpFilter(null)}
          />
        )}
      </div>
      <span role='status' aria-live='polite' className='sr-only'>
        {cliPending > 0 ? t('repeaterAdmin.console.waiting') : ''}
      </span>

      <ConsolePrompt
        nodeName={contact.name || contact.pubkeyPrefix.slice(0, 8)}
        history={history ?? []}
        onRun={run}
      />
    </div>
  );
}

/** The scrolling command/reply log, newest line kept in view. */
function ConsoleTranscript({
  lines,
  cliPending,
}: {
  lines: CliLine[];
  cliPending: number;
}) {
  const { t } = useTranslation();
  const endRef = useRef<HTMLDivElement>(null);
  const elapsed = useMemo(() => roundTrips(lines), [lines]);

  // Keep the newest line in view as the transcript grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lines]);

  // The indicator belongs on the newest command, which is not always the newest
  // line: a reply or timeout note for an earlier command can land after it.
  const lastOwn = lines.findLastIndex((l) => l.own);

  return (
    <div
      role='log'
      aria-live='polite'
      aria-label={t('repeaterAdmin.console.transcriptLabel')}
      className='h-full overflow-y-auto p-3 font-mono text-xs'
    >
      {lines.length === 0 && cliPending === 0 ? (
        <p className='text-text2'>{t('repeaterAdmin.console.empty')}</p>
      ) : (
        lines.map((line, i) => {
          const ms = elapsed[i];
          return (
            <div
              key={i}
              className={
                line.note
                  ? 'wrap-break-word whitespace-pre-wrap text-text2 italic'
                  : line.own
                    ? 'wrap-break-word whitespace-pre-wrap text-accent'
                    : 'wrap-break-word whitespace-pre-wrap text-text'
              }
            >
              {line.unsolicited && (
                <span
                  title={t('repeaterAdmin.console.unsolicitedHint')}
                  className='mr-2 text-text2 italic'
                >
                  {t('repeaterAdmin.console.unsolicited')}
                </span>
              )}
              {line.own ? `> ${line.text}` : line.text}
              {ms !== null && (
                <span
                  title={t('repeaterAdmin.console.roundTripLabel')}
                  className='ml-2 text-text2'
                >
                  {formatRoundTrip(ms)}
                </span>
              )}
              {cliPending > 0 && i === lastOwn && (
                <span aria-hidden className={PENDING_DOT_CLASS} />
              )}
            </div>
          );
        })
      )}
      {/* Clearing the transcript mid-round-trip leaves no own line to hang
          the indicator on, so it falls back to a standalone row. Hidden
          from assistive tech, which gets the live-region status below. */}
      {cliPending > 0 && lastOwn === -1 && (
        <div aria-hidden className='text-text2 italic'>
          {t('repeaterAdmin.console.waiting')}
          <span className={PENDING_DOT_CLASS} />
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

/**
 * The command catalog, rendered over the transcript. Purely local: opening it
 * costs the node nothing, which is the whole reason it exists.
 */
function ConsoleHelp({
  filter,
  onClose,
}: {
  filter: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const matches = useMemo(() => searchConsoleCommands(filter), [filter]);

  return (
    <div className='absolute inset-0 z-20 flex flex-col bg-surface'>
      <div className='flex items-center justify-between gap-2 border-b border-border px-3 py-2'>
        <h3 className='text-xs font-semibold text-text'>
          {t('repeaterAdmin.console.help.title')}
        </h3>
        <button
          onClick={onClose}
          aria-label={t('repeaterAdmin.console.help.close')}
          title={t('repeaterAdmin.console.help.close')}
          className='rounded-md p-1 text-text2 hover:bg-surface2 hover:text-text'
        >
          <X size={14} />
        </button>
      </div>
      <div className='flex-1 overflow-y-auto px-3 py-2'>
        <p className='mb-2 text-[11px] text-text2'>
          {t('repeaterAdmin.console.help.intro')}
        </p>
        {matches.length === 0 ? (
          <p className='text-xs text-text2'>
            {t('repeaterAdmin.console.help.empty', { filter })}
          </p>
        ) : (
          <dl className='space-y-1.5'>
            {matches.map((c) => (
              <div key={c.cmd}>
                <dt className='font-mono text-xs text-accent'>
                  {c.syntax}
                  {c.values && (
                    <span className='ml-2 text-text2'>{c.values}</span>
                  )}
                </dt>
                <dd className='text-[11px] text-text2'>{t(c.helpKey)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

/**
 * The command line: completion popover, ↑/↓ history, and the confirm step that
 * stands in front of a verb that would change the node.
 */
function ConsolePrompt({
  nodeName,
  history,
  onRun,
}: {
  nodeName: string;
  history: string[];
  onRun: (cmd: string) => void;
}) {
  const { t } = useTranslation();
  const listboxId = useId();
  const optionId = (i: number) => `${listboxId}-option-${i}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const [input, setInput] = useState('');
  const [index, setIndex] = useState(0);
  // Escape hides the popover without clearing the line, so the arrows go back
  // to walking history and Tab goes back to moving focus.
  const [dismissed, setDismissed] = useState(false);
  // How far back in history the line came from (0 is the newest entry), or
  // null while the user is editing a line of their own. `draft` holds that line
  // so walking back down to the present restores it.
  const [recalled, setRecalled] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  // The destructive command waiting on the confirm bar, captured when it was
  // submitted so an edit to the line can't change what the button sends.
  const [confirming, setConfirming] = useState<string | null>(null);
  // Bumped whenever the line is replaced wholesale (completion or recall), to
  // park the caret at the end of the new text rather than wherever it was.
  const [caretSeq, setCaretSeq] = useState(0);

  useEffect(() => {
    if (caretSeq === 0) return;
    const el = inputRef.current;
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [caretSeq]);

  // The confirm bar sits before the prompt in the DOM, so without this Tab from
  // the input would skip past it to Send. Focusing the confirming action also
  // makes the alert the screen reader's next stop.
  useEffect(() => {
    if (confirming !== null) confirmRef.current?.focus();
  }, [confirming]);

  const suggestions = useMemo(() => matchConsoleCommands(input), [input]);
  const open = !dismissed && suggestions.length > 0;
  const active = open ? Math.min(index, suggestions.length - 1) : 0;

  const edit = (value: string) => {
    setInput(value);
    setIndex(0);
    setDismissed(false);
    setRecalled(null);
    setConfirming(null);
  };

  const complete = (cmd: ConsoleCommand) => {
    setInput(cmd.takesArg ? `${cmd.cmd} ` : cmd.cmd);
    setIndex(0);
    setRecalled(null);
    setCaretSeq((n) => n + 1);
    inputRef.current?.focus();
  };

  const recall = (step: 1 | -1) => {
    if (history.length === 0) return;
    const next = (recalled ?? -1) + step;
    if (next < 0) {
      // Stepping forward past the newest entry returns to the user's own line.
      if (recalled !== null) setInput(draft);
      setRecalled(null);
    } else {
      if (next >= history.length) return;
      if (recalled === null) setDraft(input);
      setInput(history[history.length - 1 - next]);
      setRecalled(next);
    }
    setDismissed(true);
    setConfirming(null);
    setCaretSeq((n) => n + 1);
  };

  const submit = (cmd: string) => {
    setInput('');
    setIndex(0);
    setDismissed(false);
    setRecalled(null);
    setConfirming(null);
    // Confirming unmounts the button that was focused, so hand the prompt back.
    inputRef.current?.focus();
    onRun(cmd);
  };

  const cancelConfirm = () => {
    setConfirming(null);
    inputRef.current?.focus();
  };

  const send = () => {
    const cmd = normalizeCommandLine(input);
    if (cmd.trim() === '') return;
    // A verb that reconfigures, reboots or wipes the node gets one deliberate
    // second look: the node may be several hops away, where a mistake can only
    // be undone in person.
    if (isDestructiveCommand(cmd)) {
      setConfirming(cmd);
      return;
    }
    submit(cmd);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (open) setDismissed(true);
      else if (confirming) cancelConfirm();
      return;
    }
    if (e.key === 'Tab' && open) {
      e.preventDefault();
      complete(suggestions[active]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (open) setIndex((active + 1) % suggestions.length);
      else recall(-1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open)
        setIndex((active - 1 + suggestions.length) % suggestions.length);
      else recall(1);
    }
  };

  return (
    <div className='relative flex shrink-0 flex-col gap-2'>
      {open && (
        <ul
          id={listboxId}
          role='listbox'
          aria-label={t('repeaterAdmin.console.suggestionsLabel')}
          className='absolute right-0 bottom-full left-0 mb-1 overflow-hidden rounded-card border border-border shadow-pop bg-surface2'
        >
          {suggestions.map((c, i) => (
            <li key={c.cmd} role='presentation'>
              <button
                type='button'
                id={optionId(i)}
                role='option'
                aria-selected={i === active}
                tabIndex={-1}
                // preventDefault keeps focus in the input so the blur doesn't
                // close the popover before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => complete(c)}
                onMouseMove={() => setIndex(i)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left hover:text-accent ${
                  i === active ? 'bg-surface text-accent' : 'text-text'
                }`}
              >
                <span className='shrink-0 font-mono text-xs whitespace-nowrap'>
                  {c.syntax}
                </span>
                <span className='truncate text-[11px] text-text2'>
                  {t(c.helpKey)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <div
          role='alert'
          onKeyDown={(e) => {
            if (e.key === 'Escape') cancelConfirm();
          }}
          className='flex items-center justify-between gap-3 rounded-md border border-red px-3 py-2'
        >
          <span className='text-xs text-text2'>
            {t('repeaterAdmin.console.confirm.prompt', {
              cmd: confirming,
              name: nodeName,
            })}
          </span>
          <div className='flex shrink-0 gap-2'>
            <button
              type='button'
              onClick={cancelConfirm}
              className='rounded-md px-3 py-1.5 text-xs text-text hover:bg-surface'
            >
              {t('common.cancel')}
            </button>
            <button
              type='button'
              ref={confirmRef}
              onClick={() => submit(confirming)}
              className='rounded-md bg-red-solid px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-hover'
            >
              {t('repeaterAdmin.console.confirm.send')}
            </button>
          </div>
        </div>
      )}

      <form
        className='flex gap-2'
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          ref={inputRef}
          type='text'
          autoComplete='off'
          aria-label={t('repeaterAdmin.console.inputLabel')}
          value={input}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={onKeyDown}
          role='combobox'
          aria-autocomplete='list'
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          aria-activedescendant={open ? optionId(active) : undefined}
          placeholder={t('repeaterAdmin.console.placeholder')}
          className='flex-1 rounded-md border border-border-control bg-surface px-2.5 py-1.5 font-mono text-sm text-text outline-none focus:border-accent'
        />
        {/* `aria-expanded` announces that the popover is there; this says how
            many entries it holds and which key takes one. */}
        <span className='sr-only' role='status'>
          {open
            ? t('repeaterAdmin.console.suggestionCount', {
                count: suggestions.length,
              })
            : ''}
        </span>
        <button
          type='submit'
          disabled={input.trim() === ''}
          className='rounded-md bg-accent-solid px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
        >
          {t('repeaterAdmin.console.send')}
        </button>
      </form>
    </div>
  );
}
