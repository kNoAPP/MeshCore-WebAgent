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

/**
 * The Config tab of the repeater admin panel: structured, validated controls
 * for the common `get`/`set` settings plus the key action verbs, all driven by
 * the {@link REPEATER_SETTING_GROUPS} catalog. On open it prefills every field
 * by issuing its `get` and parsing the reply; saving a field sends the matching
 * `set` and re-reads to confirm. Renders read-only when `readOnly` (guest).
 */
export function RepeaterConfigTab({
  contact,
  readOnly,
}: {
  contact: Contact;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const { repeaterCliRequest, repeaterCli } = useMeshCore();
  const showToast = useMeshStore((s) => s.showToast);

  const [values, setValues] = useState<ValueMap>({});
  const [drafts, setDrafts] = useState<ValueMap>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // The hook callback identity can change (client re-wire), so read it through
  // a ref kept fresh by an effect rather than during render.
  const requestRef = useRef(repeaterCliRequest);
  useEffect(() => {
    requestRef.current = repeaterCliRequest;
  });

  // The mount-time contact; its pubkey is immutable, so a later contact-table
  // refresh (new object identity, same node) needn't re-run the prefill.
  const contactRef = useRef(contact);

  // Prefill each field by reading its current value on entry — once per mount
  // (the tab remounts per repeater and on reopen). Sequential so at most one
  // request is outstanding, keeping the FIFO reply correlation exact; a field
  // that errors or times out is skipped and the rest still load.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const setting of ALL_REPEATER_SETTINGS) {
        try {
          const reply = await requestRef.current(
            contactRef.current,
            getCommand(setting),
          );
          if (cancelled) return;
          if (isErrorReply(reply)) continue;
          const value = normalizeReply(setting, reply);
          if (value == null) continue;
          setValues((prev) => ({ ...prev, [setting.id]: value }));
          setDrafts((prev) => ({ ...prev, [setting.id]: value }));
        } catch {
          if (cancelled) return;
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nameBytes = nameMaxBytes(drafts.lat ?? '', drafts.lon ?? '');

  const setDraft = useCallback((id: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: value }));
  }, []);

  const saveField = useCallback(
    async (setting: RepeaterSetting) => {
      const draft = drafts[setting.id] ?? '';
      const maxBytes = setting.kind === 'text' ? nameBytes : undefined;
      if (!isValidValue(setting, draft, maxBytes)) return;
      setSavingId(setting.id);
      try {
        const setReply = await requestRef.current(
          contact,
          setCommand(setting, draft),
        );
        if (isErrorReply(setReply)) {
          showToast(
            t('toast.repeaterConfigError', { error: setReply.trim() }),
            'error',
          );
          return;
        }
        // Re-read so the field reflects the node's authoritative value (which
        // may be rounded/clamped from what we sent).
        let confirmed = draft;
        try {
          const getReply = await requestRef.current(
            contact,
            getCommand(setting),
          );
          if (!isErrorReply(getReply)) {
            confirmed = normalizeReply(setting, getReply) ?? draft;
          }
        } catch {
          // Keep the value we just set if the confirm read fails.
        }
        setValues((prev) => ({ ...prev, [setting.id]: confirmed }));
        setDrafts((prev) => ({ ...prev, [setting.id]: confirmed }));
        showToast(t('toast.repeaterConfigSaved'), 'success');
      } catch (err) {
        showToast(
          t('toast.repeaterCliFailed', { error: (err as Error).message }),
          'error',
        );
      } finally {
        setSavingId(null);
      }
    },
    [contact, drafts, nameBytes, showToast, t],
  );

  const runAction = useCallback(
    (action: RepeaterAction) => {
      void repeaterCli(contact, action.cmd);
      showToast(t('toast.repeaterActionSent'), 'success');
    },
    [contact, repeaterCli, showToast, t],
  );

  if (loading) {
    return (
      <p className='text-sm text-(--text2)'>
        {t('repeaterAdmin.config.loading')}
      </p>
    );
  }

  const rowProps = (setting: RepeaterSetting) => ({
    setting,
    value: values[setting.id] ?? '',
    draft: drafts[setting.id] ?? '',
    onDraft: (v: string) => setDraft(setting.id, v),
    onSave: () => void saveField(setting),
    saving: savingId === setting.id,
    readOnly,
    nameBytes,
  });

  return (
    <div className='space-y-6'>
      {readOnly && (
        <p
          className='rounded-md border border-(--border) p-3 text-xs text-(--text2)'
          style={{ background: 'var(--surface2)' }}
        >
          {t('repeaterAdmin.config.readOnlyNotice')}
        </p>
      )}

      {REPEATER_SETTING_GROUPS.map((group) => (
        <Section
          key={group.id}
          title={t(`repeaterAdmin.config.groups.${group.id}`)}
        >
          {group.settings.map((setting) => (
            <SettingRow key={setting.id} {...rowProps(setting)} />
          ))}
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

/** A titled card grouping related settings. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className='rounded-lg border border-(--border) p-4'
      style={{ background: 'var(--surface)' }}
    >
      <h3 className='mb-3 text-sm font-semibold text-(--text)'>{title}</h3>
      <div className='space-y-4'>{children}</div>
    </section>
  );
}

/** The advanced routing knobs, collapsed behind a disclosure by default. */
function AdvancedSection({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section
      className='rounded-lg border border-(--border) p-4'
      style={{ background: 'var(--surface)' }}
    >
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className='flex w-full items-center justify-between text-sm font-semibold text-(--text)'
      >
        <span>{t('repeaterAdmin.config.advanced')}</span>
        <span className='text-(--text2)'>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className='mt-4 space-y-4'>{children}</div>}
    </section>
  );
}

/** Props shared by every {@link SettingRow}. */
interface RowProps {
  setting: RepeaterSetting;
  value: string;
  draft: string;
  onDraft: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  readOnly: boolean;
  nameBytes: number;
}

/** One labeled setting: its control, an optional reboot hint, and a Save. */
function SettingRow({
  setting,
  value,
  draft,
  onDraft,
  onSave,
  saving,
  readOnly,
  nameBytes,
}: RowProps) {
  const { t } = useTranslation();
  const maxBytes = setting.kind === 'text' ? nameBytes : undefined;
  const valid = isValidValue(setting, draft, maxBytes);
  const dirty = draft !== value;

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between gap-2'>
        <label className='text-sm text-(--text)'>
          {t(`repeaterAdmin.config.fields.${setting.id}.label`)}
        </label>
        {setting.requiresReboot && (
          <span className='text-[11px] text-(--text2)'>
            {t('repeaterAdmin.config.requiresReboot')}
          </span>
        )}
      </div>
      <div className='flex items-start gap-2'>
        <div className='min-w-0 flex-1'>
          <SettingControl
            setting={setting}
            value={draft}
            onChange={onDraft}
            readOnly={readOnly}
            valid={valid}
            maxBytes={maxBytes}
          />
        </div>
        {!readOnly && (
          <button
            onClick={onSave}
            disabled={!dirty || !valid || saving}
            className='shrink-0 rounded-md bg-(--accent) px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {saving
              ? t('repeaterAdmin.config.saving')
              : t('repeaterAdmin.config.save')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Renders the control matching a setting's {@link RepeaterSetting.kind}. */
function SettingControl({
  setting,
  value,
  onChange,
  readOnly,
  valid,
  maxBytes,
}: {
  setting: RepeaterSetting;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  valid: boolean;
  maxBytes?: number;
}) {
  switch (setting.kind) {
    case 'toggle':
      return (
        <ToggleControl
          setting={setting}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      );
    case 'number':
      return (
        <NumberControl
          setting={setting}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          valid={valid}
        />
      );
    case 'select':
      return (
        <SelectControl
          setting={setting}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      );
    case 'radio':
      return (
        <RadioControl
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          valid={valid}
        />
      );
    case 'text':
      return (
        <TextControl
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          valid={valid}
          maxBytes={maxBytes ?? setting.maxBytes}
        />
      );
  }
}

const inputClass =
  'w-full rounded-md border bg-(--surface) px-2 py-1.5 text-sm text-(--text) outline-none focus:border-(--accent) disabled:opacity-60';

function borderClass(valid: boolean): string {
  return valid ? 'border-(--border-control)' : 'border-(--red)';
}

/** A segmented On/Off control bound to a toggle setting's wire tokens. */
function ToggleControl({
  setting,
  value,
  onChange,
  readOnly,
}: {
  setting: ToggleSetting;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const options = [
    { token: setting.on, label: t('repeaterAdmin.config.on') },
    { token: setting.off, label: t('repeaterAdmin.config.off') },
  ];
  return (
    <div
      role='radiogroup'
      className='inline-flex overflow-hidden rounded-md border border-(--border-control)'
    >
      {options.map((o) => (
        <button
          key={o.token}
          type='button'
          role='radio'
          aria-checked={value === o.token}
          disabled={readOnly}
          onClick={() => onChange(o.token)}
          className={`px-3 py-1.5 text-sm disabled:opacity-60 ${
            value === o.token
              ? 'bg-(--accent) text-white'
              : 'text-(--text) hover:bg-(--surface2)'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A bounded numeric input with a unit suffix and out-of-range hint. */
function NumberControl({
  setting,
  value,
  onChange,
  readOnly,
  valid,
}: {
  setting: NumberSetting;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  valid: boolean;
}) {
  const { t, i18n } = useTranslation();
  const unit = setting.unit
    ? t(`repeaterAdmin.config.units.${setting.unit}`)
    : null;
  return (
    <div>
      <div className='flex items-center gap-2'>
        <input
          type='number'
          inputMode='decimal'
          step={setting.step}
          min={setting.min}
          max={setting.max}
          value={value}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} ${borderClass(valid)}`}
        />
        {unit && (
          <span className='shrink-0 text-xs text-(--text2)'>{unit}</span>
        )}
      </div>
      {!valid && value.trim() !== '' && (
        <span className='mt-1 block text-[11px] text-(--red)'>
          {t('repeaterAdmin.config.range', {
            min: fmtNum(setting.min, i18n.language),
            max: fmtNum(setting.max, i18n.language),
          })}
        </span>
      )}
    </div>
  );
}

/** A dropdown over a select setting's fixed options. */
function SelectControl({
  setting,
  value,
  onChange,
  readOnly,
}: {
  setting: SelectSetting;
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  return (
    <select
      value={value}
      disabled={readOnly}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} border-(--border-control)`}
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

/** A text input with a live UTF-8 byte counter against its max. */
function TextControl({
  value,
  onChange,
  readOnly,
  valid,
  maxBytes,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  valid: boolean;
  maxBytes: number;
}) {
  const { t } = useTranslation();
  const bytes = utf8ByteLength(value);
  return (
    <div>
      <input
        type='text'
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} ${borderClass(valid)}`}
      />
      <span
        className={`mt-1 block text-[11px] ${
          bytes > maxBytes ? 'text-(--red)' : 'text-(--text2)'
        }`}
      >
        {t('repeaterAdmin.config.bytes', { used: bytes, max: maxBytes })}
      </span>
    </div>
  );
}

/** Editor for the composite LoRa parameters (`freq,bw,sf,cr`). */
function RadioControl({
  value,
  onChange,
  readOnly,
  valid,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  valid: boolean;
}) {
  const { t, i18n } = useTranslation();
  const parsed = parseRadio(value);
  const bw = parsed?.bw ?? 0;
  const sf = parsed?.sf ?? 0;
  const cr = parsed?.cr ?? 0;

  // Frequency is edited as raw text so partial input (e.g. "869.") survives a
  // keystroke; bw/sf/cr are discrete and read straight off the parsed value.
  const [freqText, setFreqText] = useState(parsed ? String(parsed.freq) : '');
  // Tracks the last string we emitted so the sync effect below can tell an
  // external change (prefill / save confirm) from our own edit echoing back.
  const emitted = useRef<string | null>(null);
  useEffect(() => {
    if (value === emitted.current) return;
    const p = parseRadio(value);
    setFreqText(p ? String(p.freq) : '');
  }, [value]);

  const emit = (
    freq: string,
    nextBw: number,
    nextSf: number,
    nextCr: number,
  ) => {
    const next = `${freq},${nextBw},${nextSf},${nextCr}`;
    emitted.current = next;
    onChange(next);
  };

  const num = (n: number) => fmtNum(n, i18n.language);

  return (
    <div className='space-y-2'>
      <div>
        <span className='mb-1 block text-[11px] text-(--text2)'>
          {t('settings.frequency')}
        </span>
        <input
          type='number'
          inputMode='decimal'
          step='0.001'
          min={RADIO_FREQ_MIN_MHZ}
          max={RADIO_FREQ_MAX_MHZ}
          value={freqText}
          disabled={readOnly}
          onChange={(e) => {
            setFreqText(e.target.value);
            emit(e.target.value, bw, sf, cr);
          }}
          className={`${inputClass} ${borderClass(valid)}`}
        />
      </div>
      <div className='grid grid-cols-3 gap-2'>
        <RadioSelect
          label={t('settings.bandwidth')}
          value={bw}
          options={withCurrent(RADIO_BW_VALUES_KHZ, bw)}
          format={(v) => t('settings.khz', { value: num(v) })}
          disabled={readOnly}
          onChange={(v) => emit(freqText, v, sf, cr)}
        />
        <RadioSelect
          label={t('settings.spreadingFactor')}
          value={sf}
          options={withCurrent(RADIO_SF_VALUES, sf)}
          format={(v) => num(v)}
          disabled={readOnly}
          onChange={(v) => emit(freqText, bw, v, cr)}
        />
        <RadioSelect
          label={t('settings.codingRate')}
          value={cr}
          options={withCurrent(RADIO_CR_VALUES, cr)}
          format={(v) => t('settings.radioEdit.crLabel', { value: v })}
          disabled={readOnly}
          onChange={(v) => emit(freqText, bw, sf, v)}
        />
      </div>
    </div>
  );
}

/** A compact labeled numeric select used by {@link RadioControl}. */
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
        className={`${inputClass} border-(--border-control)`}
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
      className='rounded-lg border border-(--border) p-4'
      style={{ background: 'var(--surface)' }}
    >
      <h3 className='mb-3 text-sm font-semibold text-(--text)'>
        {t('repeaterAdmin.config.actionsTitle')}
      </h3>
      <div className='flex flex-wrap gap-2'>
        {REPEATER_ACTIONS.filter((a) => !a.destructive).map((a) => (
          <button
            key={a.id}
            onClick={() => onRun(a)}
            className='rounded-md border border-(--border-control) px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
          >
            {t(`repeaterAdmin.config.actions.${a.id}.label`)}
          </button>
        ))}
      </div>

      {reboot &&
        (confirming ? (
          <div className='mt-4 flex items-center justify-between gap-3 border-t border-(--border) pt-4'>
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
        ) : (
          <div className='mt-4 border-t border-(--border) pt-4'>
            <button
              onClick={() => setConfirming(true)}
              className='rounded-md border border-(--red) px-3 py-1.5 text-sm text-(--red) hover:bg-(--red-dim) hover:text-white'
            >
              {t('repeaterAdmin.config.actions.reboot.label')}
            </button>
          </div>
        ))}
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
