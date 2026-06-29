// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ModalShell } from './ModalShell';
import {
  RADIO_FREQ_MIN_MHZ,
  RADIO_FREQ_MAX_MHZ,
  RADIO_PARAM_SCALE,
  TX_POWER_MIN_DBM,
  RADIO_SF_VALUES,
  RADIO_CR_VALUES,
  RADIO_BW_VALUES_KHZ,
} from '@/lib/meshcore/constants';
import { RADIO_PRESETS } from '@/lib/meshcore/radioPresets';
import { fmtNum } from '@/lib/utils';
import type { RadioParams, SelfInfo } from '@/types/meshcore';

/** The radio fields the editor needs; gates editing when any is missing. */
type RadioFields = Required<
  Pick<
    SelfInfo,
    'radioFreq' | 'radioBw' | 'radioSf' | 'radioCr' | 'txPower' | 'maxTxPower'
  >
>;

/**
 * Returns the editor's radio fields when every one is present (modern
 * firmware), or null when any is missing so the caller can keep editing
 * disabled instead of showing blank inputs.
 */
export function radioFields(info: SelfInfo | null): RadioFields | null {
  if (
    !info ||
    info.radioFreq == null ||
    info.radioBw == null ||
    info.radioSf == null ||
    info.radioCr == null ||
    info.txPower == null ||
    info.maxTxPower == null
  ) {
    return null;
  }
  return {
    radioFreq: info.radioFreq,
    radioBw: info.radioBw,
    radioSf: info.radioSf,
    radioCr: info.radioCr,
    txPower: info.txPower,
    maxTxPower: info.maxTxPower,
  };
}

/** Standard option list plus the device's current value if it isn't one. */
function withCurrent(values: readonly number[], current: number): number[] {
  if (values.includes(current)) return [...values];
  return [...values, current].sort((a, b) => a - b);
}

/** Frequency/bandwidth at the integer wire scale, so float rounding in the
 * parsed values can't desync an otherwise-equal comparison. */
function scaled(mhzOrKhz: number): number {
  return Math.round(mhzOrKhz * RADIO_PARAM_SCALE);
}

/**
 * Localized formatters shared by the editor's steps, bound to the active
 * language: `num` for plain numbers and `crLabel` for the `4/n` coding-rate
 * label.
 */
function useRadioFormat() {
  const { t, i18n } = useTranslation();
  return {
    t,
    num: (n: number) => fmtNum(n, i18n.language),
    crLabel: (n: number) => t('settings.radioEdit.crLabel', { value: n }),
  };
}

/**
 * The editor's in-progress draft: frequency as the raw `<input>` string (parsed
 * and validated on the fly), the rest as their wire values.
 */
type RadioDraft = {
  freq: string;
  bw: number;
  sf: number;
  cr: number;
  txPower: number;
};

/**
 * Two-step editor for the radio's LoRa parameters, launched from the Settings
 * Radio card. The first step edits a draft seeded from `fields`; the second
 * confirms, warning that a wrong frequency/bandwidth/SF/CR can silently isolate
 * the node from the mesh and showing each current→new value for easy revert.
 * Apply writes the changes via {@link useMeshCore.applyRadioParams} and closes
 * on success; a failed or rejected write keeps the editor open.
 */
export function RadioSettingsModal({
  fields,
  onClose,
}: {
  fields: RadioFields;
  onClose: () => void;
}) {
  const { t, num, crLabel } = useRadioFormat();
  const { applyRadioParams } = useMeshCore();

  const [draft, setDraft] = useState<RadioDraft>(() => ({
    freq: String(fields.radioFreq),
    bw: fields.radioBw,
    sf: fields.radioSf,
    cr: fields.radioCr,
    txPower: fields.txPower,
  }));
  const patch = (p: Partial<RadioDraft>) => setDraft((d) => ({ ...d, ...p }));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // Work at the wire's integer kHz scale so validation, the preset match, the
  // diff, and the value we send all agree and float rounding can't desync an
  // otherwise-equal comparison. `freqMhz` is only the display/send conversion.
  const freqScaled = scaled(Number(draft.freq));
  const freqMhz = freqScaled / RADIO_PARAM_SCALE;
  const freqValid =
    draft.freq.trim() !== '' &&
    Number.isFinite(freqScaled) &&
    freqMhz >= RADIO_FREQ_MIN_MHZ &&
    freqMhz <= RADIO_FREQ_MAX_MHZ;
  const dirty =
    freqScaled !== scaled(fields.radioFreq) ||
    draft.bw !== fields.radioBw ||
    draft.sf !== fields.radioSf ||
    draft.cr !== fields.radioCr ||
    draft.txPower !== fields.txPower;

  // The region preset whose four parameters match the current draft, or -1
  // ("Custom") once any field is edited away from it. TX power is preset-
  // agnostic, so it doesn't affect the match.
  const presetIdx = RADIO_PRESETS.findIndex(
    (p) =>
      scaled(p.freq) === freqScaled &&
      p.bw === draft.bw &&
      p.sf === draft.sf &&
      p.cr === draft.cr,
  );

  const onPreset = (idx: number) => {
    const p = RADIO_PRESETS[idx];
    if (!p) return;
    patch({ freq: String(p.freq), bw: p.bw, sf: p.sf, cr: p.cr });
  };

  const apply = async () => {
    const proposed: RadioParams = {
      radioFreq: freqMhz,
      radioBw: draft.bw,
      radioSf: draft.sf,
      radioCr: draft.cr,
      txPower: draft.txPower,
    };
    setSaving(true);
    const ok = await applyRadioParams(proposed);
    setSaving(false);
    if (ok) onClose();
  };

  const diffRows = [
    {
      label: t('settings.frequency'),
      cur: t('settings.mhz', { value: num(fields.radioFreq) }),
      next: t('settings.mhz', { value: num(freqMhz) }),
    },
    {
      label: t('settings.bandwidth'),
      cur: t('settings.khz', { value: num(fields.radioBw) }),
      next: t('settings.khz', { value: num(draft.bw) }),
    },
    {
      label: t('settings.spreadingFactor'),
      cur: num(fields.radioSf),
      next: num(draft.sf),
    },
    {
      label: t('settings.codingRate'),
      cur: crLabel(fields.radioCr),
      next: crLabel(draft.cr),
    },
    {
      label: t('settings.txPower'),
      cur: t('settings.dbm', { value: num(fields.txPower) }),
      next: t('settings.dbm', { value: num(draft.txPower) }),
    },
  ];

  return (
    <ModalShell
      title={
        confirming
          ? t('settings.radioEdit.confirmTitle')
          : t('settings.radioEdit.title')
      }
      onClose={onClose}
      onBack={confirming ? () => setConfirming(false) : undefined}
    >
      {confirming ? (
        <RadioConfirmStep
          rows={diffRows}
          saving={saving}
          onBack={() => setConfirming(false)}
          onApply={() => void apply()}
        />
      ) : (
        <RadioEditStep
          fields={fields}
          draft={draft}
          patch={patch}
          freqValid={freqValid}
          presetIdx={presetIdx}
          onPreset={onPreset}
          canReview={freqValid && dirty}
          onCancel={onClose}
          onReview={() => setConfirming(true)}
        />
      )}
    </ModalShell>
  );
}

/** The edit form: region preset picker plus each editable LoRa parameter. */
function RadioEditStep({
  fields,
  draft,
  patch,
  freqValid,
  presetIdx,
  onPreset,
  canReview,
  onCancel,
  onReview,
}: {
  fields: RadioFields;
  draft: RadioDraft;
  patch: (p: Partial<RadioDraft>) => void;
  freqValid: boolean;
  presetIdx: number;
  onPreset: (idx: number) => void;
  canReview: boolean;
  onCancel: () => void;
  onReview: () => void;
}) {
  const { t, num, crLabel } = useRadioFormat();

  return (
    <div className='space-y-4'>
      <label className='block'>
        <span className='mb-1 block text-xs text-(--text2)'>
          {t('settings.radioEdit.preset')}
        </span>
        <select
          value={presetIdx}
          onChange={(e) => onPreset(Number(e.target.value))}
          className='w-full rounded-md border border-(--border-control) bg-(--surface) px-2 py-1.5 text-sm text-(--text) outline-none focus:border-(--accent)'
        >
          <option value={-1}>{t('settings.radioEdit.presetCustom')}</option>
          {RADIO_PRESETS.map((p, i) => (
            <option key={p.title} value={i}>
              {p.title}
            </option>
          ))}
        </select>
      </label>

      <label className='block'>
        <span className='mb-1 block text-xs text-(--text2)'>
          {t('settings.frequency')}{' '}
          <span className='text-(--text2)'>
            ({num(RADIO_FREQ_MIN_MHZ)}–{num(RADIO_FREQ_MAX_MHZ)} MHz)
          </span>
        </span>
        <input
          type='number'
          inputMode='decimal'
          step='0.001'
          min={RADIO_FREQ_MIN_MHZ}
          max={RADIO_FREQ_MAX_MHZ}
          value={draft.freq}
          onChange={(e) => patch({ freq: e.target.value })}
          className={`w-full rounded-md border bg-(--surface) px-2 py-1.5 text-sm text-(--text) outline-none focus:border-(--accent) ${
            freqValid ? 'border-(--border-control)' : 'border-(--red)'
          }`}
        />
        {!freqValid && (
          <span className='mt-1 block text-[11px] text-(--red)'>
            {t('settings.radioEdit.invalidFreq', {
              min: num(RADIO_FREQ_MIN_MHZ),
              max: num(RADIO_FREQ_MAX_MHZ),
            })}
          </span>
        )}
      </label>

      <Select
        label={t('settings.bandwidth')}
        value={draft.bw}
        onChange={(v) => patch({ bw: v })}
        options={withCurrent(RADIO_BW_VALUES_KHZ, fields.radioBw).map((v) => ({
          value: v,
          label: t('settings.khz', { value: num(v) }),
        }))}
      />

      <div className='grid grid-cols-2 gap-3'>
        <Select
          label={t('settings.spreadingFactor')}
          value={draft.sf}
          onChange={(v) => patch({ sf: v })}
          options={withCurrent(RADIO_SF_VALUES, fields.radioSf).map((v) => ({
            value: v,
            label: num(v),
          }))}
        />
        <Select
          label={t('settings.codingRate')}
          value={draft.cr}
          onChange={(v) => patch({ cr: v })}
          options={withCurrent(RADIO_CR_VALUES, fields.radioCr).map((v) => ({
            value: v,
            label: crLabel(v),
          }))}
        />
      </div>

      <label className='block'>
        <span className='mb-1 flex justify-between text-xs text-(--text2)'>
          <span>{t('settings.txPower')}</span>
          <span>{t('settings.dbm', { value: num(draft.txPower) })}</span>
        </span>
        <input
          type='range'
          min={TX_POWER_MIN_DBM}
          max={fields.maxTxPower}
          step={1}
          value={draft.txPower}
          onChange={(e) => patch({ txPower: Number(e.target.value) })}
          className='w-full accent-(--accent)'
        />
        <span className='mt-1 block text-[11px] text-(--text2)'>
          {t('settings.radioEdit.maxTxHint', { value: num(fields.maxTxPower) })}
        </span>
      </label>

      <div className='flex justify-end gap-2'>
        <button
          onClick={onCancel}
          className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={onReview}
          disabled={!canReview}
          className='rounded-md bg-(--accent) px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
        >
          {t('settings.radioEdit.review')}
        </button>
      </div>
    </div>
  );
}

/** The confirmation step: mesh-isolation warning, a current→new diff, Apply. */
function RadioConfirmStep({
  rows,
  saving,
  onBack,
  onApply,
}: {
  rows: { label: string; cur: string; next: string }[];
  saving: boolean;
  onBack: () => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className='space-y-4'>
      <p
        className='rounded-md border border-(--red) p-3 text-xs leading-relaxed text-(--text)'
        style={{
          background: 'color-mix(in srgb, var(--red) 10%, transparent)',
        }}
      >
        {t('settings.radioEdit.warning')}
      </p>
      <div>
        {rows.map((r) => {
          const changed = r.cur !== r.next;
          return (
            <div
              key={r.label}
              className='flex items-center justify-between gap-3 border-b py-1.5 text-xs last:border-0'
              style={{ borderColor: 'var(--border)' }}
            >
              <span className='shrink-0 text-(--text2)'>{r.label}</span>
              <span className='flex min-w-0 items-center gap-1.5 text-right'>
                <span className={changed ? 'text-(--text2) line-through' : ''}>
                  {r.cur}
                </span>
                {changed && (
                  <>
                    <span className='text-(--text2)'>→</span>
                    <span className='font-semibold text-(--accent)'>
                      {r.next}
                    </span>
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className='flex justify-end gap-2'>
        <button
          onClick={onBack}
          disabled={saving}
          className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2) disabled:opacity-50'
        >
          {t('common.back')}
        </button>
        <button
          onClick={onApply}
          disabled={saving}
          className='rounded-md bg-(--red) px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
        >
          {t('settings.radioEdit.apply')}
        </button>
      </div>
    </div>
  );
}

/** A labeled `<select>` bound to a numeric value, styled to match the theme. */
function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: { value: number; label: string }[];
}) {
  return (
    <label className='block'>
      <span className='mb-1 block text-xs text-(--text2)'>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className='w-full rounded-md border border-(--border-control) bg-(--surface) px-2 py-1.5 text-sm text-(--text) outline-none focus:border-(--accent)'
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
