// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ModalShell } from './ModalShell';
import { SaveStatusChip, useSaveStatus } from './SaveStatus';
import { handleRovingKeyDown } from '@/lib/ui/roving';
import type { AutoAddConfig } from '@/types/meshcore';
import { MAX_HOPS_NO_LIMIT } from '@/types/meshcore';

/**
 * Gate that mounts {@link AutoAddSettingsPanel} only while the settings modal
 * is open.
 */
export function AutoAddSettings() {
  const autoAddOpen = useMeshStore((s) => s.autoAddOpen);
  // Mount the panel only while open so its local draft is seeded from the
  // current store value each time — the store is hydrated from the radio
  // asynchronously after connect, so a mount-once snapshot would go stale.
  if (!autoAddOpen) return null;
  return <AutoAddSettingsPanel />;
}

function AutoAddSettingsPanel() {
  const { t } = useTranslation();
  const { setAutoAddOpen, autoAddConfig } = useMeshStore();
  const { applyAutoAddConfig } = useMeshCore();
  const [cfg, setCfg] = useState<AutoAddConfig>(autoAddConfig);
  const { status, errorText, run } = useSaveStatus();
  const submitted = useRef<AutoAddConfig | null>(autoAddConfig);
  const submit = (next: AutoAddConfig) => {
    const previous = submitted.current;
    if (
      previous &&
      (Object.keys(next) as (keyof AutoAddConfig)[]).every(
        (key) => next[key] === previous[key],
      )
    ) {
      return;
    }
    submitted.current = next;
    void run(() => applyAutoAddConfig(next)).then(({ ok }) => {
      if (!ok && submitted.current === next) submitted.current = null;
    });
  };

  // Auto-commit, like every other settings surface: each control writes to the
  // radio as it changes and reports through the chip, rather than hiding the
  // write behind a Save button that a fifth of the app doesn't have.
  const patch = (p: Partial<AutoAddConfig>) => {
    const next = { ...cfg, ...p };
    setCfg(next);
    submit(next);
  };
  const selected = cfg.mode === 'selected';

  return (
    <ModalShell
      title={t('autoAdd.title')}
      onClose={() => setAutoAddOpen(false)}
      widthClass='w-112'
    >
      <div className='space-y-5'>
        <div
          role='radiogroup'
          aria-label={t('autoAdd.modeLabel')}
          className='space-y-2'
          onKeyDown={(e) =>
            handleRovingKeyDown(e, 2, selected ? 1 : 0, (i) =>
              patch({ mode: i === 0 ? 'all' : 'selected' }),
            )
          }
        >
          <Radio
            label={t('autoAdd.all.label')}
            hint={t('autoAdd.all.hint')}
            checked={cfg.mode === 'all'}
            onChange={() => patch({ mode: 'all' })}
          />
          <Radio
            label={t('autoAdd.selected.label')}
            hint={t('autoAdd.selected.hint')}
            checked={selected}
            onChange={() => patch({ mode: 'selected' })}
          />
        </div>

        <div className={selected ? '' : 'pointer-events-none opacity-40'}>
          <div className='mb-2 text-xs font-semibold tracking-wide text-text2 uppercase'>
            {t('autoAdd.typesHeading')}
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <Check
              label={t('autoAdd.chat')}
              checked={cfg.chat}
              onChange={(v) => patch({ chat: v })}
            />
            <Check
              label={t('autoAdd.repeaters')}
              checked={cfg.repeater}
              onChange={(v) => patch({ repeater: v })}
            />
            <Check
              label={t('autoAdd.rooms')}
              checked={cfg.room}
              onChange={(v) => patch({ room: v })}
            />
            <Check
              label={t('autoAdd.sensors')}
              checked={cfg.sensor}
              onChange={(v) => patch({ sensor: v })}
            />
          </div>
        </div>

        <Check
          label={t('autoAdd.overwriteOldest')}
          checked={cfg.overwriteOldest}
          onChange={(v) => patch({ overwriteOldest: v })}
        />

        <label className='block'>
          <div className='mb-1 flex justify-between text-sm'>
            <span>{t('autoAdd.maxHops')}</span>
            <span className='text-text2'>
              {cfg.maxHops >= MAX_HOPS_NO_LIMIT
                ? t('autoAdd.noLimit')
                : cfg.maxHops}
            </span>
          </div>
          <input
            type='range'
            min={0}
            max={MAX_HOPS_NO_LIMIT}
            value={cfg.maxHops}
            // Draft while dragging, write once on release: `onChange` fires per
            // tick, and each write queues two radio commands behind everything
            // else on the shared command chain.
            onChange={(e) =>
              setCfg({ ...cfg, maxHops: Number(e.target.value) })
            }
            onPointerUp={(event) => event.currentTarget.blur()}
            onBlur={() => submit(cfg)}
            className='w-full accent-accent'
          />
          <p className='mt-1 text-xs text-text2'>{t('autoAdd.maxHopsHint')}</p>
        </label>
      </div>

      <div className='mt-6 flex items-center justify-end gap-2'>
        <SaveStatusChip status={status} errorText={errorText} />
        <button
          onClick={() => setAutoAddOpen(false)}
          className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2'
        >
          {t('common.close')}
        </button>
      </div>
    </ModalShell>
  );
}

function Radio({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      role='radio'
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      onClick={onChange}
      className='flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-surface2'
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          checked ? 'border-accent' : 'border-border'
        }`}
      >
        {checked && <span className='h-2 w-2 rounded-full bg-accent' />}
      </span>
      <span>
        <span className='block text-sm'>{label}</span>
        <span className='block text-xs text-text2'>{hint}</span>
      </span>
    </button>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className='flex items-center gap-2 text-sm'>
      <input
        type='checkbox'
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className='h-4 w-4 accent-accent'
      />
      <span>{label}</span>
    </label>
  );
}
