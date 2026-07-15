// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
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
  formatRadio,
  LOOP_DETECT_OPTIONS,
  PATH_HASH_MODE_OPTIONS,
} from '@/lib/meshcore/repeaterConfig';
import type {
  RepeaterSetting,
  NumberSetting,
  ToggleSetting,
  SelectSetting,
  RepeaterAction,
} from '@/lib/meshcore/repeaterConfig';
import { fmtNum, utf8ByteLength } from '@/lib/utils';
import { RefreshButton } from './RefreshButton';
import { RadioSettingsModal } from './RadioSettings';
import type { Contact, RadioParams } from '@/types/meshcore';

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
 * How many field reads to keep in flight at once. Each command carries a unique
 * correlation tag the firmware reflects, so requests can be pipelined instead
 * of run one slow round-trip at a time; a modest window keeps the mesh and the
 * repeater's reply queue from being flooded while still loading far faster.
 */
const READ_CONCURRENCY = 4;

/**
 * The radio-related fields, shown together in their own card (like the Settings
 * page's Radio section) rather than inside the Identity group they're cataloged
 * in. Loaded and edited as a unit via {@link RadioSection}.
 */
const RADIO_FIELDS: readonly RepeaterSetting[] = ALL_REPEATER_SETTINGS.filter(
  (s) => s.id === 'radio' || s.id === 'tx',
);

/**
 * The Config tab of the repeater admin panel: structured, validated controls
 * for the common `get`/`set` settings plus the key action verbs, all driven by
 * the {@link REPEATER_SETTING_GROUPS} catalog. Nothing loads on entry; each
 * section has its own Refresh button that reads just that section's fields, so
 * the user pulls only the values they care about. Editing a field auto-commits
 * the matching `set` (on toggle/select change, slider release, or blur/Enter
 * for typed fields) and re-reads to confirm. The composite radio parameters and
 * TX power are edited together in the shared {@link RadioSettingsModal}.
 * Renders read-only when `readOnly` (guest).
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
  // and each section's spinning Refresh. A field is dropped once its read
  // settles (loaded, errored, or timed out), so a slow/lost reply never blocks
  // the rest of the section. Starts empty — nothing loads until a section's
  // Refresh is clicked.
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});
  // The last error message per field, shown on the error chip's tooltip.
  const [errorMsg, setErrorMsg] = useState<Record<string, string>>({});
  // Whether the shared radio/TX editor modal is open.
  const [radioEditOpen, setRadioEditOpen] = useState(false);

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
  // False after unmount, so an in-flight read or commit doesn't set state on a
  // gone component (and a late CLI reply is ignored).
  const aliveRef = useRef(true);
  // Timers that fade a field's "saved ✓" chip back to idle.
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Serializes commit round-trips (a `set` followed by its confirming `get`) so
  // two edits can't interleave their writes. Reads are pipelined separately and
  // correlated by tag, so they don't go through this chain.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    const run = chainRef.current.then(op, op);
    chainRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  // Reads the given fields' current values. The gets are pipelined (a bounded
  // window in flight at once) and correlated by the per-command tag, rather
  // than run one blocking round-trip at a time. Fields populate as each reply
  // lands. Called per section, so concurrent section reads each scope their
  // "stop reading" to their own fields and never clear another's.
  const read = useCallback((settings: readonly RepeaterSetting[]) => {
    void (async () => {
      // Retry gaps: CLI replies are often dropped over the mesh, so re-request
      // any field that didn't answer, up to a few passes. A field stays
      // "reading" until it loads or the passes are exhausted.
      let queue: RepeaterSetting[] = [...settings];
      for (let pass = 0; pass < READ_PASSES && queue.length > 0; pass++) {
        const batch = queue;
        const misses: RepeaterSetting[] = [];
        let cursor = 0;
        const worker = async () => {
          while (cursor < batch.length) {
            if (!aliveRef.current) return;
            const setting = batch[cursor++];
            let parsed: string | null = null;
            try {
              const reply = await requestRef.current(
                contactRef.current,
                getCommand(setting),
              );
              if (!aliveRef.current) return;
              if (!isErrorReply(reply)) parsed = normalizeReply(setting, reply);
            } catch {
              if (!aliveRef.current) return;
            }
            if (parsed != null) {
              const value = parsed;
              setValues((prev) => ({ ...prev, [setting.id]: value }));
              setDrafts((prev) => ({ ...prev, [setting.id]: value }));
              setPending((prev) => {
                if (!prev.has(setting.id)) return prev;
                const next = new Set(prev);
                next.delete(setting.id);
                return next;
              });
            } else {
              misses.push(setting);
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(READ_CONCURRENCY, batch.length) }, () =>
            worker(),
          ),
        );
        if (!aliveRef.current) return;
        queue = misses;
      }
      if (!aliveRef.current) return;
      // Stop showing "reading" for this call's fields that never answered,
      // without touching a concurrent read's still-pending fields.
      setPending((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const s of settings) if (next.delete(s.id)) changed = true;
        return changed ? next : prev;
      });
    })();
  }, []);

  // Loads (or reloads) one section's fields. Marks them pending, then reads.
  // `setPending` here is a user-gesture update, not an effect body, so it's
  // allowed. A no-op re-click is harmless — the section's Refresh spins while
  // any of its fields are pending.
  const refreshSection = useCallback(
    (settings: readonly RepeaterSetting[]) => {
      setPending((prev) => {
        const next = new Set(prev);
        for (const s of settings) next.add(s.id);
        return next;
      });
      read(settings);
    },
    [read],
  );

  // Track liveness for in-flight reads/commits, and on unmount drop any pending
  // CLI request so its reply can't reach a new panel. Nothing is read here —
  // the user pulls each section on demand.
  useEffect(() => {
    aliveRef.current = true;
    const timers = savedTimers.current;
    const prefix = contactRef.current.pubkeyPrefix;
    return () => {
      aliveRef.current = false;
      clearRepeaterCli(prefix);
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, [clearRepeaterCli]);

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

  // Applies the shared radio/TX editor's result to the repeater over CLI:
  // `set radio` only if the LoRa quad changed (it reboots the node), `set tx`
  // only if power changed. Returns whether every needed write succeeded so the
  // modal can stay open on failure.
  const applyRepeaterRadio = useCallback(
    async (params: RadioParams): Promise<boolean> => {
      const radioSetting = ALL_REPEATER_SETTINGS.find((s) => s.id === 'radio');
      const txSetting = ALL_REPEATER_SETTINGS.find((s) => s.id === 'tx');
      if (!radioSetting || !txSetting) return false;
      const cur = parseRadio(valuesRef.current.radio ?? '');
      const radioChanged =
        !cur ||
        Math.round(cur.freq * 1000) !== Math.round(params.radioFreq * 1000) ||
        cur.bw !== params.radioBw ||
        cur.sf !== params.radioSf ||
        cur.cr !== params.radioCr;
      const txChanged = Number(valuesRef.current.tx) !== params.txPower;
      const fail = (reply: string) =>
        showToast(
          t('toast.repeaterConfigError', { error: reply.trim() }),
          'error',
        );
      try {
        if (radioChanged) {
          const radioStr = formatRadio(
            params.radioFreq,
            params.radioBw,
            params.radioSf,
            params.radioCr,
          );
          const reply = await enqueue(() =>
            requestRef.current(
              contactRef.current,
              setCommand(radioSetting, radioStr),
            ),
          );
          if (!aliveRef.current) return false;
          if (isErrorReply(reply)) {
            fail(reply);
            return false;
          }
          setValues((prev) => ({ ...prev, radio: radioStr }));
          setDrafts((prev) => ({ ...prev, radio: radioStr }));
        }
        if (txChanged) {
          const txStr = String(params.txPower);
          const reply = await enqueue(() =>
            requestRef.current(
              contactRef.current,
              setCommand(txSetting, txStr),
            ),
          );
          if (!aliveRef.current) return false;
          if (isErrorReply(reply)) {
            fail(reply);
            return false;
          }
          setValues((prev) => ({ ...prev, tx: txStr }));
          setDrafts((prev) => ({ ...prev, tx: txStr }));
        }
        showToast(t('toast.radioParamsSaved'), 'success');
        return true;
      } catch (err) {
        if (!aliveRef.current) return false;
        showToast(
          t('toast.repeaterCliFailed', { error: (err as Error).message }),
          'error',
        );
        return false;
      }
    },
    [enqueue, showToast, t],
  );

  const nameBytes = nameMaxBytes(drafts.lat ?? '', drafts.lon ?? '');
  const sectionBusy = (settings: readonly RepeaterSetting[]) =>
    settings.some((s) => pending.has(s.id));
  // A section is "unloaded" until at least one of its fields has a value; its
  // Refresh control then shows a download glyph to invite the first load.
  const sectionLoaded = (settings: readonly RepeaterSetting[]) =>
    settings.some((s) => (values[s.id] ?? '') !== '');

  // Seed for the shared radio/TX modal, or null until both values have loaded.
  const radioParsed = parseRadio(values.radio ?? '');
  const txValue = values.tx ?? '';
  const txNum = Number(txValue);
  const txSetting = ALL_REPEATER_SETTINGS.find((s) => s.id === 'tx');
  const maxTxPower =
    txSetting && txSetting.kind === 'number' ? txSetting.max : 22;
  const radioModalFields =
    radioParsed && txValue !== '' && Number.isFinite(txNum)
      ? {
          radioFreq: radioParsed.freq,
          radioBw: radioParsed.bw,
          radioSf: radioParsed.sf,
          radioCr: radioParsed.cr,
          txPower: txNum,
          maxTxPower,
        }
      : null;

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
    <>
      <div className='mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 xl:grid-cols-2'>
        {readOnly && (
          <p
            className='rounded-md border border-(--border) p-3 text-xs text-(--text2) xl:col-span-2'
            style={{ background: 'var(--surface2)' }}
          >
            {t('repeaterAdmin.config.readOnlyNotice')}
          </p>
        )}

        {REPEATER_SETTING_GROUPS.map((group) => {
          // Radio + TX power live in their own card (see RadioSection), like
          // the Settings page; keep them out of the group they're cataloged in.
          const fields = group.settings.filter(
            (s) => s.id !== 'radio' && s.id !== 'tx',
          );
          return (
            <Fragment key={group.id}>
              <Section
                title={t(`repeaterAdmin.config.groups.${group.id}`)}
                action={
                  <RefreshButton
                    onClick={() => refreshSection(fields)}
                    busy={sectionBusy(fields)}
                    download={!sectionLoaded(fields)}
                  />
                }
              >
                {fields.map((setting) => {
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
              {group.id === 'identity' && (
                <RadioSection
                  radioValue={values.radio ?? ''}
                  txValue={values.tx ?? ''}
                  loading={pending.has('radio') || pending.has('tx')}
                  loaded={sectionLoaded(RADIO_FIELDS)}
                  busy={sectionBusy(RADIO_FIELDS)}
                  readOnly={readOnly}
                  onEdit={() => setRadioEditOpen(true)}
                  onRefresh={() => refreshSection(RADIO_FIELDS)}
                />
              )}
            </Fragment>
          );
        })}

        <Section
          title={t('repeaterAdmin.config.advanced')}
          action={
            <RefreshButton
              onClick={() => refreshSection(REPEATER_ADVANCED_SETTINGS)}
              busy={sectionBusy(REPEATER_ADVANCED_SETTINGS)}
              download={!sectionLoaded(REPEATER_ADVANCED_SETTINGS)}
            />
          }
        >
          {REPEATER_ADVANCED_SETTINGS.map((setting) => (
            <SettingRow key={setting.id} {...rowProps(setting)} />
          ))}
        </Section>

        {!readOnly && <ActionsSection onRun={runAction} />}
      </div>

      {radioEditOpen && radioModalFields && (
        <RadioSettingsModal
          fields={radioModalFields}
          onApply={applyRepeaterRadio}
          onClose={() => setRadioEditOpen(false)}
        />
      )}
    </>
  );
}

/** A titled card grouping related settings, matching the Settings page. */
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
      className='rounded-lg p-3.5'
      style={{ background: 'var(--surface2)' }}
    >
      <div className='mb-2.5 flex items-center justify-between gap-2'>
        <h3 className='text-[11px] font-bold tracking-widest text-(--accent) uppercase'>
          {title}
        </h3>
        {action}
      </div>
      {children}
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

  const label = t(`repeaterAdmin.config.fields.${setting.id}.label`);
  const maxBytes = setting.kind === 'text' ? nameBytes : undefined;
  const valid = isValidValue(setting, draft, maxBytes);
  // A field is "loaded" once its value has been read; before that (or if a read
  // is dropped) the row shows a placeholder instead of a control seeded from a
  // default, since nothing loads until the section's Refresh is clicked.
  const loaded = value !== '';
  // Blur/Enter (or slider release) on an editable field: commit a valid change,
  // or revert an invalid one back to the last known value.
  const commitEdit = () => {
    if (draft === value) return;
    if (valid) onCommit(draft);
    else onDraft(value);
  };

  return (
    <div className='flex items-center justify-between gap-3 border-b border-(--border) py-1.5 text-xs last:border-0'>
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        <span className='truncate text-(--text2)'>{label}</span>
        <InfoHint text={settingHint(t, i18n.language, setting)} />
        {setting.requiresReboot && <RebootPill />}
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        {loading ? (
          <span className='text-xs text-(--text2)'>
            {t('repeaterAdmin.config.readingField')}
          </span>
        ) : !loaded ? (
          <UnloadedValue />
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
              <SliderField
                setting={setting}
                value={draft}
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

/** Placeholder for a field whose value hasn't been loaded yet. */
function UnloadedValue() {
  return <span className='text-(--text2)'>—</span>;
}

/** A save-lifecycle indicator (spinner / ✓ / ⚠); renders nothing when idle. */
function StatusChip({
  status,
  errorText,
}: {
  status?: SaveStatus;
  errorText?: string;
}) {
  if (!status) return null;
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
        className='w-full min-w-0 bg-transparent px-2 py-1 text-right text-xs text-(--text) outline-none'
      />
    </Field>
  );
}

/**
 * A numeric slider with a live value readout and unit. Dragging updates the
 * draft; the change commits on release (pointer up / key up), so a drag doesn't
 * fire a `set` on every tick.
 */
function SliderField({
  setting,
  value,
  disabled,
  ariaLabel,
  onChange,
  onCommitEdit,
}: {
  setting: NumberSetting;
  value: string;
  disabled: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
  onCommitEdit: () => void;
}) {
  const { t, i18n } = useTranslation();
  const unit = setting.unit
    ? t(`repeaterAdmin.config.units.${setting.unit}`)
    : undefined;
  const n = Number(value);
  const slider = Number.isFinite(n) ? n : setting.min;
  return (
    <div className='flex items-center gap-2'>
      <input
        type='range'
        aria-label={ariaLabel}
        min={setting.min}
        max={setting.max}
        step={setting.step === 'any' ? undefined : setting.step}
        value={slider}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onPointerUp={onCommitEdit}
        onKeyUp={onCommitEdit}
        className='w-40 accent-(--accent) disabled:opacity-60'
      />
      <span className='w-20 shrink-0 text-right text-xs text-(--text) tabular-nums'>
        {fmtNum(slider, i18n.language)}
        {unit ? ` ${unit}` : ''}
      </span>
    </div>
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
      className='rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-xs text-(--text) outline-none focus:border-(--accent) disabled:opacity-60'
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
        className='w-full min-w-0 bg-transparent px-2 py-1 text-xs text-(--text) outline-none'
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
  const loaded = latProps.value !== '' || (lonProps?.value ?? '') !== '';
  return (
    <div className='flex items-center justify-between gap-3 border-b border-(--border) py-1.5 text-xs last:border-0'>
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        <span className='truncate text-(--text2)'>
          {t('repeaterAdmin.config.location')}
        </span>
        <InfoHint text={t('repeaterAdmin.config.locationHint')} />
      </div>
      <div className='flex shrink-0 items-center gap-3'>
        {loading ? (
          <span className='text-xs text-(--text2)'>
            {t('repeaterAdmin.config.readingField')}
          </span>
        ) : !loaded ? (
          <UnloadedValue />
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
 * The LoRa parameters and TX power as their own card, mirroring the Settings
 * page's Radio section: a read-only breakdown of frequency, bandwidth,
 * spreading factor, coding rate, and TX power, with a Refresh to load them and
 * an Edit that opens the shared {@link RadioSettingsModal}. Reuses {@link
 * Section} and {@link RefreshButton}; Edit is disabled until both values load,
 * since the editor needs them to seed its draft.
 */
function RadioSection({
  radioValue,
  txValue,
  loading,
  loaded,
  busy,
  readOnly,
  onEdit,
  onRefresh,
}: {
  radioValue: string;
  txValue: string;
  loading: boolean;
  loaded: boolean;
  busy: boolean;
  readOnly: boolean;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  const num = (n: number) => fmtNum(n, i18n.language);
  const parsed = parseRadio(radioValue);
  const ready = parsed != null && txValue !== '';
  const rows: { label: string; value: string | null }[] = [
    {
      label: t('settings.frequency'),
      value: parsed ? t('settings.mhz', { value: num(parsed.freq) }) : null,
    },
    {
      label: t('settings.bandwidth'),
      value: parsed ? t('settings.khz', { value: num(parsed.bw) }) : null,
    },
    {
      label: t('settings.spreadingFactor'),
      value: parsed ? num(parsed.sf) : null,
    },
    {
      label: t('settings.codingRate'),
      value: parsed
        ? t('settings.radioEdit.crLabel', { value: parsed.cr })
        : null,
    },
    {
      label: t('settings.txPower'),
      value:
        txValue !== ''
          ? t('settings.dbm', { value: num(Number(txValue)) })
          : null,
    },
  ];

  return (
    <Section
      title={t('repeaterAdmin.config.fields.radio.label')}
      action={
        <div className='flex items-center gap-2'>
          <RebootPill />
          <RefreshButton onClick={onRefresh} busy={busy} download={!loaded} />
          {!readOnly && (
            <button
              onClick={onEdit}
              disabled={!ready}
              className='rounded-md border border-(--border-control) px-2.5 py-1 text-xs text-(--text2) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-(--text2)'
            >
              {t('repeaterAdmin.config.edit')}
            </button>
          )}
        </div>
      }
    >
      {rows.map((row) => (
        <ValueRow
          key={row.label}
          label={row.label}
          value={row.value}
          loading={loading}
        />
      ))}
    </Section>
  );
}

/** A read-only label/value row, matching the editable rows' hairline style. */
function ValueRow({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | null;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className='flex items-center justify-between gap-3 border-b border-(--border) py-1.5 text-xs last:border-0'>
      <span className='shrink-0 text-(--text2)'>{label}</span>
      {loading ? (
        <span className='text-(--text2)'>
          {t('repeaterAdmin.config.readingField')}
        </span>
      ) : value == null ? (
        <UnloadedValue />
      ) : (
        <span className='font-semibold'>{value}</span>
      )}
    </div>
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
      className='rounded-lg p-3.5'
      style={{ background: 'var(--surface2)' }}
    >
      <h3 className='mb-2.5 text-[11px] font-bold tracking-widest text-(--accent) uppercase'>
        {t('repeaterAdmin.config.actionsTitle')}
      </h3>
      <div className='flex flex-wrap items-center gap-2'>
        {REPEATER_ACTIONS.filter((a) => !a.destructive).map((a) => (
          <button
            key={a.id}
            onClick={() => onRun(a)}
            className='rounded-md border border-(--border-control) px-3 py-1.5 text-xs text-(--text) hover:bg-(--surface)'
          >
            {t(`repeaterAdmin.config.actions.${a.id}.label`)}
          </button>
        ))}
        {reboot && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className='ml-auto rounded-md border border-(--red) px-3 py-1.5 text-xs text-(--red) hover:bg-(--red-dim) hover:text-white'
          >
            {t('repeaterAdmin.config.actions.reboot.label')}
          </button>
        )}
      </div>

      {reboot && confirming && (
        <div className='mt-3 flex items-center justify-between gap-3 border-t border-(--border) pt-3'>
          <span className='text-xs text-(--text2)'>
            {t('repeaterAdmin.config.actions.reboot.confirm')}
          </span>
          <div className='flex shrink-0 gap-2'>
            <button
              onClick={() => setConfirming(false)}
              className='rounded-md px-3 py-1.5 text-xs text-(--text) hover:bg-(--surface)'
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                onRun(reboot);
                setConfirming(false);
              }}
              className='rounded-md bg-(--red) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--red-hover)'
            >
              {t('repeaterAdmin.config.actions.reboot.label')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
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
