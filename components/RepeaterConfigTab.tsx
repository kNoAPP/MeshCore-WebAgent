// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import {
  REPEATER_SETTING_GROUPS,
  REPEATER_ADVANCED_SETTINGS,
  ALL_REPEATER_SETTINGS,
  REPEATER_ACTIONS,
  getCommand,
  setCommand,
  normalizeReply,
  isErrorReply,
  isValidValue,
  nameMaxBytes,
  parseRadio,
  LOOP_DETECT_OPTIONS,
  PATH_HASH_MODE_OPTIONS,
} from '@/lib/meshcore/repeaterConfig';
import type {
  RepeaterSetting,
  NumberSetting,
  ToggleSetting,
  SelectSetting,
  RadioSetting,
  RepeaterAction,
} from '@/lib/meshcore/repeaterConfig';
import {
  RADIO_FREQ_MIN_MHZ,
  RADIO_FREQ_MAX_MHZ,
  RADIO_SF_VALUES,
  RADIO_CR_VALUES,
  RADIO_BW_VALUES_KHZ,
} from '@/lib/meshcore/constants';
import { fmtNum, utf8ByteLength } from '@/lib/utils';
import type { Contact } from '@/types/meshcore';

/** The map of settings ids to their current on-device / draft values. */
type ValueMap = Record<string, string>;

/** Per-field save lifecycle shown as a small status chip. */
type SaveStatus = 'saving' | 'saved' | 'error';

/**
 * How many times a prefill re-requests fields that didn't answer. CLI replies
 * are frequently dropped over the mesh, so a couple of retry passes markedly
 * improve how many fields fill in without a manual refresh.
 */
const READ_PASSES = 3;

/**
 * The Config tab of the repeater admin panel: structured, validated controls
 * for the common `get`/`set` settings plus the key action verbs, all driven by
 * the {@link REPEATER_SETTING_GROUPS} catalog. On open it prefills every field
 * by issuing its `get` and parsing the reply; editing a field auto-commits the
 * matching `set` (on toggle/select change, or on blur/Enter for typed fields)
 * and re-reads to confirm. Renders read-only when `readOnly` (guest).
 */
export function RepeaterConfigTab({
  contact,
  readOnly,
}: {
  contact: Contact;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const { repeaterCliRequest, repeaterCli, clearRepeaterCli } = useMeshCore();
  const showToast = useMeshStore((s) => s.showToast);

  const [values, setValues] = useState<ValueMap>({});
  const [drafts, setDrafts] = useState<ValueMap>({});
  // Ids whose current value is still being read; drives per-field placeholders
  // and the "reading" header. A field is dropped once its read settles (loaded,
  // errored, or timed out), so a slow/lost reply never blocks the whole tab.
  const [pending, setPending] = useState<Set<string>>(
    () => new Set(ALL_REPEATER_SETTINGS.map((s) => s.id)),
  );
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});
  // The last error message per field, shown on the error chip's tooltip.
  const [errorMsg, setErrorMsg] = useState<Record<string, string>>({});

  // The hook callback identity can change (client re-wire), so read it through
  // a ref kept fresh by an effect rather than during render. Same for the
  // latest values/drafts, so the stable auto-commit callback isn't stale.
  const requestRef = useRef(repeaterCliRequest);
  const valuesRef = useRef(values);
  const draftsRef = useRef(drafts);
  useEffect(() => {
    requestRef.current = repeaterCliRequest;
    valuesRef.current = values;
    draftsRef.current = drafts;
  });

  // The mount-time contact; its pubkey is immutable, so a later contact-table
  // refresh (new object identity, same node) needn't re-run the prefill.
  const contactRef = useRef(contact);
  // Token for the active read pass. A new pass (or unmount) flips the prior
  // token's `live` to false so a late reply can't write into a stale pass.
  const runRef = useRef<{ live: boolean }>({ live: false });
  // False after unmount, so an in-flight commit doesn't set state on a gone
  // component.
  const aliveRef = useRef(true);
  // Timers that fade a field's "saved ✓" chip back to idle.
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Serializes every CLI round-trip (reads and writes) so at most one is in
  // flight — the reply correlation relies on ordered, non-overlapping requests.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    const run = chainRef.current.then(op, op);
    chainRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  // Reads every field's current value, sequentially so only one request is
  // outstanding at a time (replies carry no key, so ordered round-trips are the
  // only reliable correlation). Fields populate as each reply lands rather than
  // gating the tab behind all of them.
  const read = useCallback(() => {
    runRef.current.live = false;
    const run = (runRef.current = { live: true });
    void (async () => {
      // Retry gaps: CLI replies are often dropped over the mesh, so re-request
      // any field that didn't answer, up to a few passes. A field stays
      // "reading" until it loads or the passes are exhausted.
      const loaded = new Set<string>();
      for (let pass = 0; pass < READ_PASSES; pass++) {
        let missing = false;
        for (const setting of ALL_REPEATER_SETTINGS) {
          if (!run.live) return;
          if (loaded.has(setting.id)) continue;
          let parsed: string | null = null;
          try {
            const reply = await enqueue(() =>
              requestRef.current(contactRef.current, getCommand(setting)),
            );
            if (!run.live) return;
            if (!isErrorReply(reply)) parsed = normalizeReply(setting, reply);
          } catch {
            if (!run.live) return;
          }
          if (parsed != null) {
            const value = parsed;
            loaded.add(setting.id);
            setValues((prev) => ({ ...prev, [setting.id]: value }));
            setDrafts((prev) => ({ ...prev, [setting.id]: value }));
            setPending((prev) => {
              if (!prev.has(setting.id)) return prev;
              const next = new Set(prev);
              next.delete(setting.id);
              return next;
            });
          } else {
            missing = true;
          }
        }
        if (!missing) break;
      }
      if (!run.live) return;
      // Stop showing "reading" for fields that never answered.
      setPending((prev) => (prev.size === 0 ? prev : new Set()));
    })();
  }, [enqueue]);

  // Manual re-read: mark every field pending again, then read. `setPending`
  // here is a user-gesture update, not an effect body, so it's allowed.
  const refresh = useCallback(() => {
    setPending(new Set(ALL_REPEATER_SETTINGS.map((s) => s.id)));
    read();
  }, [read]);

  // Prefill on entry — once per mount (the tab remounts per repeater and on
  // reopen); `pending` starts full from the initializer. On unmount, cancel the
  // run and drop any pending CLI request so its reply can't reach a new panel.
  useEffect(() => {
    aliveRef.current = true;
    read();
    const run = runRef.current;
    const timers = savedTimers.current;
    const prefix = contactRef.current.pubkeyPrefix;
    return () => {
      aliveRef.current = false;
      run.live = false;
      clearRepeaterCli(prefix);
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, [read, clearRepeaterCli]);

  // Commits a field's new value: sends its `set`, then re-reads so the field
  // reflects the node's authoritative value (which may be rounded/clamped). A
  // no-op when unchanged or invalid; surfaces `Err` replies via a toast and an
  // error chip while leaving the stored value untouched.
  const commit = useCallback(
    async (setting: RepeaterSetting, next: string) => {
      const id = setting.id;
      if (next === (valuesRef.current[id] ?? '')) return;
      const maxBytes =
        setting.kind === 'text'
          ? nameMaxBytes(
              draftsRef.current.lat ?? '',
              draftsRef.current.lon ?? '',
            )
          : undefined;
      if (!isValidValue(setting, next, maxBytes)) return;
      setDrafts((prev) => ({ ...prev, [id]: next }));
      setStatus((prev) => ({ ...prev, [id]: 'saving' }));
      setErrorMsg((prev) => {
        if (!(id in prev)) return prev;
        const next2 = { ...prev };
        delete next2[id];
        return next2;
      });
      try {
        const setReply = await enqueue(() =>
          requestRef.current(contactRef.current, setCommand(setting, next)),
        );
        if (!aliveRef.current) return;
        if (isErrorReply(setReply)) {
          const message = t('toast.repeaterConfigError', {
            error: setReply.trim(),
          });
          showToast(message, 'error');
          setStatus((prev) => ({ ...prev, [id]: 'error' }));
          setErrorMsg((prev) => ({ ...prev, [id]: message }));
          return;
        }
        let confirmed = next;
        try {
          const getReply = await enqueue(() =>
            requestRef.current(contactRef.current, getCommand(setting)),
          );
          if (aliveRef.current && !isErrorReply(getReply)) {
            confirmed = normalizeReply(setting, getReply) ?? next;
          }
        } catch {
          // Keep the value we just set if the confirm read fails.
        }
        if (!aliveRef.current) return;
        setValues((prev) => ({ ...prev, [id]: confirmed }));
        setDrafts((prev) => ({ ...prev, [id]: confirmed }));
        setStatus((prev) => ({ ...prev, [id]: 'saved' }));
        clearTimeout(savedTimers.current[id]);
        savedTimers.current[id] = setTimeout(() => {
          setStatus((prev) => {
            if (prev[id] !== 'saved') return prev;
            const next2 = { ...prev };
            delete next2[id];
            return next2;
          });
        }, 2000);
      } catch (err) {
        if (!aliveRef.current) return;
        const message = t('toast.repeaterCliFailed', {
          error: (err as Error).message,
        });
        showToast(message, 'error');
        setStatus((prev) => ({ ...prev, [id]: 'error' }));
        setErrorMsg((prev) => ({ ...prev, [id]: message }));
      }
    },
    [enqueue, showToast, t],
  );

  const runAction = useCallback(
    (action: RepeaterAction) => {
      void repeaterCli(contact, action.cmd);
      showToast(t('toast.repeaterActionSent'), 'success');
    },
    [contact, repeaterCli, showToast, t],
  );

  const nameBytes = nameMaxBytes(drafts.lat ?? '', drafts.lon ?? '');
  const reading = pending.size > 0;

  const rowProps = (setting: RepeaterSetting) => ({
    setting,
    value: values[setting.id] ?? '',
    onDraft: (v: string) => setDrafts((prev) => ({ ...prev, [setting.id]: v })),
    onCommit: (v: string) => void commit(setting, v),
    draft: drafts[setting.id] ?? '',
    status: status[setting.id],
    errorText: errorMsg[setting.id],
    loading: pending.has(setting.id),
    readOnly,
    nameBytes,
  });

  return (
    <div className='space-y-4'>
      {readOnly && (
        <p
          className='rounded-md border border-(--border) p-3 text-xs text-(--text2)'
          style={{ background: 'var(--surface2)' }}
        >
          {t('repeaterAdmin.config.readOnlyNotice')}
        </p>
      )}

      {REPEATER_SETTING_GROUPS.map((group, i) => (
        <Section
          key={group.id}
          title={t(`repeaterAdmin.config.groups.${group.id}`)}
          action={
            // The Refresh control lives in the first section's header rather
            // than its own row, so it costs no vertical space.
            i === 0 ? (
              <button
                onClick={refresh}
                disabled={reading}
                aria-label={t('repeaterAdmin.dashboard.refresh')}
                className='inline-flex items-center justify-center rounded-md border border-(--border-control) p-1 text-(--text2) transition-colors hover:bg-(--surface2) hover:text-(--text) disabled:opacity-50'
              >
                <RefreshIcon className={reading ? 'animate-spin' : undefined} />
              </button>
            ) : undefined
          }
        >
          {group.settings.map((setting) => {
            // Latitude and longitude share one compact "Location" row.
            if (setting.id === 'lon') return null;
            if (setting.id === 'lat') {
              const lon = group.settings.find((s) => s.id === 'lon');
              return (
                <LocationRow
                  key='location'
                  latProps={rowProps(setting)}
                  lonProps={lon ? rowProps(lon) : undefined}
                />
              );
            }
            return <SettingRow key={setting.id} {...rowProps(setting)} />;
          })}
        </Section>
      ))}

      <AdvancedSection>
        {REPEATER_ADVANCED_SETTINGS.map((setting) => (
          <SettingRow key={setting.id} {...rowProps(setting)} />
        ))}
      </AdvancedSection>

      {!readOnly && <ActionsSection onRun={runAction} />}
    </div>
  );
}

/** A titled card grouping related settings, rows split by hairline dividers. */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className='overflow-hidden rounded-xl border border-(--border)'
      style={{ background: 'var(--surface)' }}
    >
      <div className='flex items-center justify-between gap-2 border-b border-(--border) px-4 py-2'>
        <h3 className='text-[11px] font-semibold tracking-wide text-(--text2) uppercase'>
          {title}
        </h3>
        {action}
      </div>
      <div className='divide-y divide-(--border) px-4'>{children}</div>
    </section>
  );
}

/** The advanced routing knobs, collapsed behind a disclosure by default. */
function AdvancedSection({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section
      className='overflow-hidden rounded-xl border border-(--border)'
      style={{ background: 'var(--surface)' }}
    >
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className='flex w-full items-center justify-between px-4 py-2 text-[11px] font-semibold tracking-wide text-(--text2) uppercase hover:text-(--text)'
      >
        <span>{t('repeaterAdmin.config.advanced')}</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className='divide-y divide-(--border) border-t border-(--border) px-4'>
          {children}
        </div>
      )}
    </section>
  );
}

/** Props shared by every {@link SettingRow}. */
interface RowProps {
  setting: RepeaterSetting;
  value: string;
  draft: string;
  onDraft: (value: string) => void;
  onCommit: (value: string) => void;
  status?: SaveStatus;
  errorText?: string;
  loading: boolean;
  readOnly: boolean;
  nameBytes: number;
}

/**
 * One setting as a compact label→control row. Toggles/selects auto-commit on
 * change; typed fields commit on blur/Enter (an invalid edit reverts). The
 * composite radio setting delegates to {@link RadioRow}.
 */
function SettingRow({
  setting,
  value,
  draft,
  onDraft,
  onCommit,
  status,
  errorText,
  loading,
  readOnly,
  nameBytes,
}: RowProps) {
  const { t, i18n } = useTranslation();

  if (setting.kind === 'radio') {
    return (
      <RadioRow
        setting={setting}
        value={value}
        status={status}
        errorText={errorText}
        loading={loading}
        readOnly={readOnly}
        onCommit={onCommit}
      />
    );
  }

  const label = t(`repeaterAdmin.config.fields.${setting.id}.label`);
  const maxBytes = setting.kind === 'text' ? nameBytes : undefined;
  const valid = isValidValue(setting, draft, maxBytes);
  // Blur/Enter on a typed field: commit a valid change, or revert an invalid
  // one back to the last known value.
  const commitEdit = () => {
    if (draft === value) return;
    if (valid) onCommit(draft);
    else onDraft(value);
  };

  return (
    <div className='flex items-center gap-3 py-2'>
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        <span className='truncate text-sm text-(--text)'>{label}</span>
        <InfoHint text={settingHint(t, i18n.language, setting)} />
        {setting.requiresReboot && <RebootPill />}
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        {loading ? (
          <span className='text-xs text-(--text2)'>
            {t('repeaterAdmin.config.readingField')}
          </span>
        ) : (
          <>
            {setting.kind === 'toggle' && (
              <SwitchControl
                setting={setting}
                value={draft}
                disabled={readOnly}
                ariaLabel={label}
                onSelect={onCommit}
              />
            )}
            {setting.kind === 'number' && (
              <NumberField
                setting={setting}
                value={draft}
                valid={valid}
                disabled={readOnly}
                ariaLabel={label}
                onChange={onDraft}
                onCommitEdit={commitEdit}
              />
            )}
            {setting.kind === 'select' && (
              <SelectField
                setting={setting}
                value={draft}
                disabled={readOnly}
                ariaLabel={label}
                onSelect={onCommit}
              />
            )}
            {setting.kind === 'text' && (
              <TextField
                value={draft}
                maxBytes={maxBytes ?? setting.maxBytes}
                valid={valid}
                disabled={readOnly}
                ariaLabel={label}
                onChange={onDraft}
                onCommitEdit={commitEdit}
              />
            )}
            <StatusChip status={status} errorText={errorText} />
          </>
        )}
      </div>
    </div>
  );
}

/** A fixed-width slot showing a field's save lifecycle (spinner / ✓ / ⚠). */
function StatusChip({
  status,
  errorText,
}: {
  status?: SaveStatus;
  errorText?: string;
}) {
  return (
    <span className='inline-flex w-4 justify-center'>
      {status === 'saving' && (
        <span
          aria-hidden
          className='h-3 w-3 animate-spin rounded-full border border-(--text2) border-t-transparent'
        />
      )}
      {status === 'saved' && (
        <span aria-hidden className='text-xs text-(--green)'>
          ✓
        </span>
      )}
      {status === 'error' && (
        <span
          className='cursor-help text-xs text-(--red)'
          title={errorText}
          aria-label={errorText}
        >
          ⚠
        </span>
      )}
    </span>
  );
}

/** A small info affordance whose native tooltip explains a setting. */
function InfoHint({ text }: { text: string }) {
  return (
    <span
      className='inline-flex shrink-0 cursor-help text-(--text2)'
      title={text}
      aria-label={text}
    >
      <InfoIcon />
    </span>
  );
}

/** Circled-i glyph for {@link InfoHint}, inheriting the text color. */
function InfoIcon() {
  return (
    <svg
      viewBox='0 0 24 24'
      className='h-3.5 w-3.5'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <circle cx='12' cy='12' r='10' />
      <path d='M12 16v-4' />
      <path d='M12 8h.01' />
    </svg>
  );
}

/** Circular-arrows refresh glyph; spins via `animate-spin` while reading. */
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox='0 0 24 24'
      className={`h-4 w-4 ${className ?? ''}`}
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      <path d='M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' />
      <path d='M21 3v5h-5' />
      <path d='M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' />
      <path d='M3 21v-5h5' />
    </svg>
  );
}

/**
 * Builds a setting's tooltip: its localized description, with the valid numeric
 * range (and unit) appended for number fields.
 */
function settingHint(
  t: ReturnType<typeof useTranslation>['t'],
  lang: string,
  setting: RepeaterSetting,
): string {
  const desc = t(`repeaterAdmin.config.fields.${setting.id}.hint`);
  if (setting.kind === 'number') {
    const unit = setting.unit
      ? ` ${t(`repeaterAdmin.config.units.${setting.unit}`)}`
      : '';
    return `${desc} (${fmtNum(setting.min, lang)}–${fmtNum(setting.max, lang)}${unit})`;
  }
  return desc;
}

/** A small "requires reboot" badge shown beside affected fields. */
function RebootPill() {
  const { t } = useTranslation();
  return (
    <span className='rounded-full bg-(--surface2) px-1.5 py-0.5 text-[10px] whitespace-nowrap text-(--text2)'>
      {t('repeaterAdmin.config.requiresReboot')}
    </span>
  );
}

/** A bordered input group: a control plus an optional in-field unit suffix. */
function Field({
  width,
  invalid,
  disabled,
  suffix,
  children,
}: {
  width: string;
  invalid?: boolean;
  disabled?: boolean;
  suffix?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center overflow-hidden rounded-md border ${width} bg-(--surface) focus-within:border-(--accent) ${
        invalid ? 'border-(--red)' : 'border-(--border-control)'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      {children}
      {suffix != null && (
        <span className='border-l border-(--border-control) px-1.5 py-1 text-[11px] whitespace-nowrap text-(--text2)'>
          {suffix}
        </span>
      )}
    </div>
  );
}

/** A modern on/off switch bound to a toggle setting's wire tokens. */
function SwitchControl({
  setting,
  value,
  disabled,
  ariaLabel,
  onSelect,
}: {
  setting: ToggleSetting;
  value: string;
  disabled: boolean;
  ariaLabel: string;
  onSelect: (value: string) => void;
}) {
  const on = value === setting.on;
  return (
    <button
      type='button'
      role='switch'
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onSelect(on ? setting.off : setting.on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
        on ? 'bg-(--accent)' : 'bg-(--border-control)'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/** A right-sized numeric input with an in-field unit suffix. */
function NumberField({
  setting,
  value,
  valid,
  disabled,
  ariaLabel,
  width = 'w-28',
  onChange,
  onCommitEdit,
}: {
  setting: NumberSetting;
  value: string;
  valid: boolean;
  disabled: boolean;
  ariaLabel: string;
  width?: string;
  onChange: (value: string) => void;
  onCommitEdit: () => void;
}) {
  const { t } = useTranslation();
  const unit = setting.unit
    ? t(`repeaterAdmin.config.units.${setting.unit}`)
    : undefined;
  return (
    <Field
      width={width}
      invalid={!valid && value.trim() !== ''}
      disabled={disabled}
      suffix={unit}
    >
      <input
        type='number'
        inputMode='decimal'
        aria-label={ariaLabel}
        step={setting.integer ? 1 : 'any'}
        min={setting.min}
        max={setting.max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className='w-full min-w-0 bg-transparent px-2 py-1 text-right text-sm text-(--text) outline-none'
      />
    </Field>
  );
}

/** A content-sized dropdown over a select setting's fixed options. */
function SelectField({
  setting,
  value,
  disabled,
  ariaLabel,
  onSelect,
}: {
  setting: SelectSetting;
  value: string;
  disabled: boolean;
  ariaLabel: string;
  onSelect: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onSelect(e.target.value)}
      className='rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-sm text-(--text) outline-none focus:border-(--accent) disabled:opacity-60'
    >
      {!setting.options.includes(value) && (
        <option value={value} disabled>
          —
        </option>
      )}
      {setting.options.map((o) => (
        <option key={o} value={o}>
          {optionLabel(t, setting.id, o)}
        </option>
      ))}
    </select>
  );
}

/** A name input with a live UTF-8 byte counter shown as an in-field suffix. */
function TextField({
  value,
  maxBytes,
  valid,
  disabled,
  ariaLabel,
  onChange,
  onCommitEdit,
}: {
  value: string;
  maxBytes: number;
  valid: boolean;
  disabled: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
  onCommitEdit: () => void;
}) {
  const bytes = utf8ByteLength(value);
  return (
    <Field
      width='w-52'
      invalid={!valid && value.trim() !== ''}
      disabled={disabled}
      suffix={
        <span className={bytes > maxBytes ? 'text-(--red)' : undefined}>
          {bytes}/{maxBytes}
        </span>
      }
    >
      <input
        type='text'
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className='w-full min-w-0 bg-transparent px-2 py-1 text-sm text-(--text) outline-none'
      />
    </Field>
  );
}

/** Latitude and longitude paired on one compact row under "Location". */
function LocationRow({
  latProps,
  lonProps,
}: {
  latProps: RowProps;
  lonProps?: RowProps;
}) {
  const { t } = useTranslation();
  const loading = latProps.loading || (lonProps?.loading ?? false);
  return (
    <div className='flex items-center gap-3 py-2'>
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        <span className='truncate text-sm text-(--text)'>
          {t('repeaterAdmin.config.location')}
        </span>
        <InfoHint text={t('repeaterAdmin.config.locationHint')} />
      </div>
      <div className='flex shrink-0 items-center gap-3'>
        {loading ? (
          <span className='text-xs text-(--text2)'>
            {t('repeaterAdmin.config.readingField')}
          </span>
        ) : (
          <>
            <CoordField {...latProps} />
            {lonProps && <CoordField {...lonProps} />}
          </>
        )}
      </div>
    </div>
  );
}

/** One coordinate input (lat or lon) with its own caption and status chip. */
function CoordField({
  setting,
  value,
  draft,
  onDraft,
  onCommit,
  status,
  errorText,
  readOnly,
}: RowProps) {
  const { t } = useTranslation();
  const label = t(`repeaterAdmin.config.fields.${setting.id}.label`);
  const valid = isValidValue(setting, draft);
  const commitEdit = () => {
    if (draft === value) return;
    if (valid) onCommit(draft);
    else onDraft(value);
  };
  return (
    <div className='flex items-center gap-1.5'>
      <span className='text-[11px] text-(--text2)'>{label}</span>
      <NumberField
        setting={setting as NumberSetting}
        value={draft}
        valid={valid}
        disabled={readOnly}
        ariaLabel={label}
        width='w-36'
        onChange={onDraft}
        onCommitEdit={commitEdit}
      />
      <StatusChip status={status} errorText={errorText} />
    </div>
  );
}

/**
 * The composite LoRa parameters as a collapsed one-line summary that expands
 * into a `freq,bw,sf,cr` editor. Applying confirms first, since a radio change
 * requires a reboot and can take the node off the mesh.
 */
function RadioRow({
  setting,
  value,
  status,
  errorText,
  loading,
  readOnly,
  onCommit,
}: {
  setting: RadioSetting;
  value: string;
  status?: SaveStatus;
  errorText?: string;
  loading: boolean;
  readOnly: boolean;
  onCommit: (value: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [freqText, setFreqText] = useState('');
  const [bw, setBw] = useState(0);
  const [sf, setSf] = useState(0);
  const [cr, setCr] = useState(0);
  const num = (n: number) => fmtNum(n, i18n.language);

  const parsed = parseRadio(value);
  const summary = parsed
    ? [
        t('settings.mhz', { value: num(parsed.freq) }),
        t('settings.khz', { value: num(parsed.bw) }),
        `SF${parsed.sf}`,
        t('settings.radioEdit.crLabel', { value: parsed.cr }),
      ].join(' · ')
    : '—';

  const startEdit = () => {
    const p = parseRadio(value);
    // Trim float noise (e.g. 910.5250244) to the wire's kHz precision.
    setFreqText(p ? String(Math.round(p.freq * 1000) / 1000) : '');
    setBw(p?.bw ?? 0);
    setSf(p?.sf ?? 0);
    setCr(p?.cr ?? 0);
    setConfirming(false);
    setEditing(true);
  };

  const draft = `${freqText},${bw},${sf},${cr}`;
  const valid = isValidValue(setting, draft);

  return (
    <div className='py-2.5'>
      <div className='flex items-center gap-3'>
        <div className='flex min-w-0 flex-1 items-center gap-1.5'>
          <span className='text-sm text-(--text)'>
            {t('repeaterAdmin.config.fields.radio.label')}
          </span>
          <InfoHint text={settingHint(t, i18n.language, setting)} />
          <RebootPill />
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          {loading ? (
            <span className='text-xs text-(--text2)'>
              {t('repeaterAdmin.config.readingField')}
            </span>
          ) : (
            <>
              <span className='font-mono text-xs text-(--text2)'>
                {summary}
              </span>
              {!readOnly && !editing && (
                <button
                  onClick={startEdit}
                  className='rounded-md border border-(--border-control) px-2 py-0.5 text-xs text-(--text) hover:bg-(--surface2)'
                >
                  {t('repeaterAdmin.config.edit')}
                </button>
              )}
              <StatusChip status={status} errorText={errorText} />
            </>
          )}
        </div>
      </div>

      {editing && (
        <div
          className='mt-3 space-y-3 rounded-lg border border-(--border) p-3'
          style={{ background: 'var(--surface2)' }}
        >
          <div className='grid grid-cols-2 gap-3'>
            <label className='block'>
              <span className='mb-1 block text-[11px] text-(--text2)'>
                {t('settings.frequency')}
              </span>
              <input
                type='number'
                inputMode='decimal'
                step='any'
                min={RADIO_FREQ_MIN_MHZ}
                max={RADIO_FREQ_MAX_MHZ}
                value={freqText}
                onChange={(e) => setFreqText(e.target.value)}
                className='w-full rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-sm text-(--text) outline-none focus:border-(--accent)'
              />
            </label>
            <RadioSelect
              label={t('settings.bandwidth')}
              value={bw}
              options={withCurrent(RADIO_BW_VALUES_KHZ, bw)}
              format={(v) => t('settings.khz', { value: num(v) })}
              disabled={false}
              onChange={setBw}
            />
            <RadioSelect
              label={t('settings.spreadingFactor')}
              value={sf}
              options={withCurrent(RADIO_SF_VALUES, sf)}
              format={(v) => num(v)}
              disabled={false}
              onChange={setSf}
            />
            <RadioSelect
              label={t('settings.codingRate')}
              value={cr}
              options={withCurrent(RADIO_CR_VALUES, cr)}
              format={(v) => t('settings.radioEdit.crLabel', { value: v })}
              disabled={false}
              onChange={setCr}
            />
          </div>

          {confirming ? (
            <div className='flex items-center justify-between gap-3 border-t border-(--border) pt-3'>
              <span className='text-xs text-(--text2)'>
                {t('repeaterAdmin.config.radioConfirm')}
              </span>
              <div className='flex shrink-0 gap-2'>
                <button
                  onClick={() => setConfirming(false)}
                  className='rounded-md px-3 py-1 text-sm text-(--text) hover:bg-(--surface2)'
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => {
                    onCommit(draft);
                    setEditing(false);
                    setConfirming(false);
                  }}
                  className='rounded-md bg-(--red) px-3 py-1 text-sm font-semibold text-white hover:bg-(--red-hover)'
                >
                  {t('repeaterAdmin.config.apply')}
                </button>
              </div>
            </div>
          ) : (
            <div className='flex justify-end gap-2 border-t border-(--border) pt-3'>
              <button
                onClick={() => setEditing(false)}
                className='rounded-md px-3 py-1 text-sm text-(--text) hover:bg-(--surface2)'
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => valid && setConfirming(true)}
                disabled={!valid}
                className='rounded-md bg-(--accent) px-3 py-1 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
              >
                {t('repeaterAdmin.config.apply')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A compact labeled numeric select used by {@link RadioRow}. */
function RadioSelect({
  label,
  value,
  options,
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  format: (value: number) => string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className='block'>
      <span className='mb-1 block text-[11px] text-(--text2)'>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className='w-full rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-sm text-(--text) outline-none focus:border-(--accent) disabled:opacity-60'
      >
        {options.map((v) => (
          <option key={v} value={v}>
            {format(v)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The action verbs, with Reboot gated behind an inline confirm. */
function ActionsSection({
  onRun,
}: {
  onRun: (action: RepeaterAction) => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const reboot = REPEATER_ACTIONS.find((a) => a.id === 'reboot');

  return (
    <section
      className='overflow-hidden rounded-xl border border-(--border)'
      style={{ background: 'var(--surface)' }}
    >
      <h3 className='border-b border-(--border) px-4 py-2 text-[11px] font-semibold tracking-wide text-(--text2) uppercase'>
        {t('repeaterAdmin.config.actionsTitle')}
      </h3>
      <div className='flex flex-wrap items-center gap-2 p-4'>
        {REPEATER_ACTIONS.filter((a) => !a.destructive).map((a) => (
          <button
            key={a.id}
            onClick={() => onRun(a)}
            className='rounded-md border border-(--border-control) px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
          >
            {t(`repeaterAdmin.config.actions.${a.id}.label`)}
          </button>
        ))}
        {reboot && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className='ml-auto rounded-md border border-(--red) px-3 py-1.5 text-sm text-(--red) hover:bg-(--red-dim) hover:text-white'
          >
            {t('repeaterAdmin.config.actions.reboot.label')}
          </button>
        )}
      </div>

      {reboot && confirming && (
        <div className='flex items-center justify-between gap-3 border-t border-(--border) px-4 py-3'>
          <span className='text-sm text-(--text2)'>
            {t('repeaterAdmin.config.actions.reboot.confirm')}
          </span>
          <div className='flex shrink-0 gap-2'>
            <button
              onClick={() => setConfirming(false)}
              className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                onRun(reboot);
                setConfirming(false);
              }}
              className='rounded-md bg-(--red) px-3 py-1.5 text-sm font-semibold text-white hover:bg-(--red-hover)'
            >
              {t('repeaterAdmin.config.actions.reboot.label')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Standard option list plus the current value when it isn't already one. */
function withCurrent(values: readonly number[], current: number): number[] {
  if (current === 0 || values.includes(current)) return [...values];
  return [...values, current].sort((a, b) => a - b);
}

/** Resolves a select option to its localized label. */
function optionLabel(
  t: ReturnType<typeof useTranslation>['t'],
  id: SelectSetting['id'],
  value: string,
): string {
  if (id === 'loopDetect') {
    return t(
      `repeaterAdmin.config.options.loopDetect.${value as (typeof LOOP_DETECT_OPTIONS)[number]}`,
    );
  }
  return t(
    `repeaterAdmin.config.options.pathHashMode.${value as (typeof PATH_HASH_MODE_OPTIONS)[number]}`,
  );
}
