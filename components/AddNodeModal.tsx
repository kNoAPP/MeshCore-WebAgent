// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ModalShell } from './ModalShell';
import { handleRovingKeyDown } from '@/lib/ui/roving';
import { ADV_ICON, ADV_LABEL_KEY, fromHex, parseContactUri } from '@/lib/utils';
import {
  ADV_TYPE_REPEATER,
  ADV_TYPE_ROOM,
  ADV_TYPE_SENSOR,
} from '@/lib/meshcore/constants';

type Mode = 'manual' | 'paste';

const MODES = [
  {
    id: 'manual',
    labelKey: 'addNode.mode.manualLabel',
    hintKey: 'addNode.mode.manualHint',
  },
  {
    id: 'paste',
    labelKey: 'addNode.mode.pasteLabel',
    hintKey: 'addNode.mode.pasteHint',
  },
] as const satisfies readonly {
  id: Mode;
  labelKey: string;
  hintKey: string;
}[];

const TYPE_OPTIONS = [
  1,
  ADV_TYPE_REPEATER,
  ADV_TYPE_ROOM,
  ADV_TYPE_SENSOR,
] as const satisfies readonly (keyof typeof ADV_LABEL_KEY)[];

/**
 * Modal for adding a node the radio has not heard, in one of two
 * {@link Mode}s: entering a name, 64-hex public key, and type manually, or
 * pasting a `meshcore://contact/add` link, which prefills those fields for
 * review. Both submit through `importContact`. Nodes heard over the air are
 * saved from the Nodes directory itself. Mounted only while
 * {@link useMeshStore} `addNodeOpen` is set.
 */
export function AddNodeModal() {
  const { t } = useTranslation();
  const addNodeOpen = useMeshStore((s) => s.addNodeOpen);
  const setAddNodeOpen = useMeshStore((s) => s.setAddNodeOpen);
  const { importContact } = useMeshCore();
  const [mode, setMode] = useState<Mode>('manual');
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [pubkey, setPubkey] = useState('');
  const [advType, setAdvType] = useState<number>(1);
  const [error, setError] = useState('');

  if (!addNodeOpen) return null;

  const close = () => {
    setMode('manual');
    setLink('');
    setName('');
    setPubkey('');
    setAdvType(1);
    setError('');
    setAddNodeOpen(false);
  };

  const keyValid = fromHex(pubkey, 32) !== null;

  const useLink = () => {
    setError('');
    const parsed = parseContactUri(link);
    if (!parsed) {
      setError(t('addNode.error.invalidLink'));
      return;
    }
    setName(parsed.name);
    setPubkey(parsed.pubkey);
    setAdvType(parsed.advType);
    setMode('manual');
  };

  const submit = () => {
    setError('');
    if (!name.trim()) {
      setError(t('addNode.error.enterName'));
      return;
    }
    if (!keyValid) {
      setError(t('addNode.error.invalidKey'));
      return;
    }
    importContact({ name: name.trim(), pubkey, advType });
    close();
  };

  const hint = t(MODES.find((m) => m.id === mode)!.hintKey);

  return (
    <ModalShell title={t('addNode.title')} onClose={close} widthClass='w-112'>
      <div
        role='tablist'
        aria-label={t('addNode.modeLabel')}
        onKeyDown={(e) =>
          handleRovingKeyDown(
            e,
            MODES.length,
            MODES.findIndex((m) => m.id === mode),
            (i) => {
              setMode(MODES[i].id);
              setError('');
            },
          )
        }
        className='mb-3 flex gap-1 rounded-md p-1 bg-bg'
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            role='tab'
            id={`add-node-tab-${m.id}`}
            aria-selected={mode === m.id}
            aria-controls='add-node-tabpanel'
            tabIndex={mode === m.id ? 0 : -1}
            onClick={() => {
              setMode(m.id);
              setError('');
            }}
            className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
              mode === m.id
                ? 'bg-accent-solid text-white inset-ring-1 inset-ring-accent'
                : 'text-text2 hover:bg-surface2'
            }`}
          >
            {t(m.labelKey)}
          </button>
        ))}
      </div>
      <div
        id='add-node-tabpanel'
        role='tabpanel'
        aria-labelledby={`add-node-tab-${mode}`}
      >
        <p className='mb-4 text-xs text-text2'>{hint}</p>

        {mode === 'paste' ? (
          <div className='space-y-4'>
            <label className='block'>
              <span className='mb-1 block text-xs text-text2'>
                {t('addNode.link')}
              </span>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder={t('addNode.linkPlaceholder')}
                className='w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs outline-none focus:border-accent'
              />
            </label>
            {error && <p className='text-xs text-red'>{error}</p>}
          </div>
        ) : (
          <div className='space-y-4'>
            <label className='block'>
              <span className='mb-1 block text-xs text-text2'>
                {t('addNode.name')}
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={32}
                className='w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent'
              />
            </label>

            <label className='block'>
              <span className='mb-1 block text-xs text-text2'>
                {t('addNode.publicKey')}
              </span>
              <input
                value={pubkey}
                onChange={(e) => setPubkey(e.target.value)}
                placeholder={t('addNode.publicKeyPlaceholder')}
                className={`w-full rounded-md border bg-bg px-3 py-2 font-mono text-xs outline-none ${
                  pubkey && !keyValid
                    ? 'border-red'
                    : 'border-border focus:border-accent'
                }`}
              />
              {pubkey && !keyValid && (
                <span className='mt-1 block text-xs text-red'>
                  {t('addNode.error.invalidKey')}
                </span>
              )}
            </label>

            <div>
              <span
                className='mb-1 block text-xs text-text2'
                id='add-node-type'
              >
                {t('addNode.type')}
              </span>
              <div
                role='radiogroup'
                aria-labelledby='add-node-type'
                onKeyDown={(e) =>
                  handleRovingKeyDown(
                    e,
                    TYPE_OPTIONS.length,
                    TYPE_OPTIONS.indexOf(
                      advType as (typeof TYPE_OPTIONS)[number],
                    ),
                    (i) => setAdvType(TYPE_OPTIONS[i]),
                  )
                }
                className='flex gap-1'
              >
                {TYPE_OPTIONS.map((type) => (
                  <button
                    key={type}
                    role='radio'
                    aria-checked={advType === type}
                    tabIndex={advType === type ? 0 : -1}
                    onClick={() => setAdvType(type)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                      advType === type
                        ? 'border-accent text-accent'
                        : 'border-border text-text2 hover:bg-surface2'
                    }`}
                  >
                    <span>{ADV_ICON[type]}</span>
                    {t(ADV_LABEL_KEY[type])}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className='text-xs text-red'>{error}</p>}
          </div>
        )}
      </div>

      <div className='mt-6 flex justify-end gap-2'>
        <button
          onClick={close}
          className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2'
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={mode === 'paste' ? useLink : submit}
          className='rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover'
        >
          {mode === 'paste' ? t('addNode.review') : t('addNode.add')}
        </button>
      </div>
    </ModalShell>
  );
}
