// Copyright 2026 Knoban LLC. All rights reserved.
//
// This software is confidential and proprietary, intended for use only by
// Knoban LLC or its authorized users. Unauthorized use, copying, modification,
// distribution of this software, or any part of it, is strictly prohibited and
// may be subject to civil and criminal penalties.
//
// A License Agreement is required to view, use, and/or modify this software.
//
// Disclaimer: This software is provided 'as is' and without any express or
// implied warranties. Knoban LLC is not liable for any damages arising out of
// the use of this software.
//
// For inquiries, contact: alden@knoban.com

'use client';

import { useState } from 'react';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ModalShell } from './ModalShell';
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

/**
 * The auto-add settings form. Edits a local draft seeded from the store on
 * mount (so it reflects the latest radio-hydrated values), then writes it to
 * the
 * radio and localStorage via `applyAutoAddConfig` on Save.
 */
function AutoAddSettingsPanel() {
  const { setAutoAddOpen, autoAddConfig } = useMeshStore();
  const { applyAutoAddConfig } = useMeshCore();
  const [cfg, setCfg] = useState<AutoAddConfig>(autoAddConfig);

  const patch = (p: Partial<AutoAddConfig>) => setCfg({ ...cfg, ...p });
  const selected = cfg.mode === 'selected';

  return (
    <ModalShell
      title='⚙ Auto-add settings'
      onClose={() => setAutoAddOpen(false)}
      widthClass='w-112'
    >
      <div className='space-y-5'>
        <div className='space-y-2'>
          <Radio
            label='Auto Add All'
            hint='Save every node the radio hears'
            checked={cfg.mode === 'all'}
            onChange={() => patch({ mode: 'all' })}
          />
          <Radio
            label='Auto Add Selected'
            hint='Only save the node types you choose'
            checked={selected}
            onChange={() => patch({ mode: 'selected' })}
          />
        </div>

        <div className={selected ? '' : 'pointer-events-none opacity-40'}>
          <div className='mb-2 text-xs font-semibold tracking-wide text-(--text2) uppercase'>
            Auto-add types
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <Check
              label='Chat users'
              checked={cfg.chat}
              onChange={(v) => patch({ chat: v })}
            />
            <Check
              label='Repeaters'
              checked={cfg.repeater}
              onChange={(v) => patch({ repeater: v })}
            />
            <Check
              label='Room servers'
              checked={cfg.room}
              onChange={(v) => patch({ room: v })}
            />
            <Check
              label='Sensors'
              checked={cfg.sensor}
              onChange={(v) => patch({ sensor: v })}
            />
          </div>
        </div>

        <Check
          label='Overwrite oldest non-favorite when contacts are full'
          checked={cfg.overwriteOldest}
          onChange={(v) => patch({ overwriteOldest: v })}
        />

        <label className='block'>
          <div className='mb-1 flex justify-between text-sm'>
            <span>Auto-add max hops</span>
            <span className='text-(--text2)'>
              {cfg.maxHops >= MAX_HOPS_NO_LIMIT ? 'No limit' : cfg.maxHops}
            </span>
          </div>
          <input
            type='range'
            min={0}
            max={MAX_HOPS_NO_LIMIT}
            value={cfg.maxHops}
            onChange={(e) => patch({ maxHops: Number(e.target.value) })}
            className='w-full accent-(--accent)'
          />
          <p className='mt-1 text-xs text-(--text2)'>
            Only add nodes heard within this many hops (0 = direct only; far
            right = no limit).
          </p>
        </label>

        <Check
          label='Show public keys in contact details'
          checked={cfg.showPublicKeys}
          onChange={(v) => patch({ showPublicKeys: v })}
        />
      </div>

      <div className='mt-6 flex justify-end gap-2'>
        <button
          onClick={() => setAutoAddOpen(false)}
          className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
        >
          Cancel
        </button>
        <button
          onClick={() => {
            applyAutoAddConfig(cfg);
            setAutoAddOpen(false);
          }}
          className='rounded-md px-3 py-1.5 text-sm font-semibold text-white'
          style={{ background: 'var(--accent)' }}
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}

/** A labeled radio option with a hint line, styled to match the theme. */
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
      onClick={onChange}
      className='flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-(--surface2)'
    >
      <span
        className='mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border'
        style={{ borderColor: checked ? 'var(--accent)' : 'var(--border)' }}
      >
        {checked && <span className='h-2 w-2 rounded-full bg-(--accent)' />}
      </span>
      <span>
        <span className='block text-sm'>{label}</span>
        <span className='block text-xs text-(--text2)'>{hint}</span>
      </span>
    </button>
  );
}

/** A labeled checkbox bound to a boolean. */
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
        className='h-4 w-4 accent-(--accent)'
      />
      <span>{label}</span>
    </label>
  );
}
