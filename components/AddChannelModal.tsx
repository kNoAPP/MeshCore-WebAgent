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
import { useTranslation } from '@/hooks/useTranslation';
import { ModalShell } from './ModalShell';
import { fromHex, randomSecret, deriveHashtagSecret, toHex } from '@/lib/utils';

/**
 * How the channel secret is obtained: `create` generates a random one,
 * `joinPrivate` takes a hex secret, `joinHashtag` derives it from a public
 * name.
 */
type Mode = 'create' | 'joinPrivate' | 'joinHashtag';

/**
 * Modal for adding a channel in one of three {@link Mode}s (create private,
 * join
 * private by hex secret, or join a public hashtag). Validates input, then calls
 * the `addChannel` action. Mounted only while {@link useMeshStore}
 * `addChannelOpen` is set.
 */
export function AddChannelModal() {
  const { addChannelOpen, setAddChannelOpen } = useMeshStore();
  const { addChannel } = useMeshCore();
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('create');
  const [name, setName] = useState('');
  const [secretHex, setSecretHex] = useState('');
  const [hashtag, setHashtag] = useState('');
  const [generated, setGenerated] = useState(() => toHex(randomSecret()));
  const [error, setError] = useState('');

  // Mode definitions require `t` so they're constructed inside the component.
  const MODES: { id: Mode; label: string; hint: string }[] = [
    {
      id: 'create',
      label: t('addChannelModeCreate'),
      hint: t('addChannelHintCreate'),
    },
    {
      id: 'joinPrivate',
      label: t('addChannelModeJoinPrivate'),
      hint: t('addChannelHintJoinPrivate'),
    },
    {
      id: 'joinHashtag',
      label: t('addChannelModeJoinHashtag'),
      hint: t('addChannelHintJoinHashtag'),
    },
  ];

  if (!addChannelOpen) return null;
  const close = () => {
    setMode('create');
    setName('');
    setSecretHex('');
    setHashtag('');
    setGenerated(toHex(randomSecret()));
    setError('');
    setAddChannelOpen(false);
  };

  const submit = async () => {
    setError('');
    if (mode === 'joinHashtag') {
      if (!/^[a-z0-9-]+$/.test(hashtag)) {
        setError(t('addChannelErrorHashtagChars'));
        return;
      }
      addChannel(`#${hashtag}`, await deriveHashtagSecret(hashtag));
      close();
      return;
    }
    if (!name.trim()) {
      setError(t('addChannelErrorNoName'));
      return;
    }
    if (mode === 'create') {
      // `generated` is always toHex(randomSecret()), i.e. valid 16-byte hex
      addChannel(name.trim(), fromHex(generated, 16)!);
      close();
      return;
    }
    const secret = fromHex(secretHex.trim(), 16);
    if (!secret) {
      setError(t('addChannelErrorSecretLen'));
      return;
    }
    addChannel(name.trim(), secret);
    close();
  };

  const hint = MODES.find((m) => m.id === mode)!.hint;

  return (
    <ModalShell title={t('addChannelTitle')} onClose={close} widthClass='w-112'>
      <div
        className='mb-3 flex gap-1 rounded-md p-1'
        style={{ background: 'var(--bg)' }}
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setMode(m.id);
              setError('');
            }}
            className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
              mode === m.id
                ? 'bg-(--accent) text-white'
                : 'text-(--text2) hover:bg-(--surface2)'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className='mb-4 text-xs text-(--text2)'>{hint}</p>

      <div className='space-y-4'>
        {mode === 'joinHashtag' ? (
          <label className='block'>
            <span className='mb-1 block text-xs text-(--text2)'>
              {t('addChannelLabelName')}
            </span>
            <div
              className='flex items-center rounded-md border'
              style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            >
              <span className='pl-3 text-sm text-(--text2)'>#</span>
              <input
                value={hashtag}
                onChange={(e) =>
                  setHashtag(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                  )
                }
                maxLength={31}
                className='w-full bg-transparent px-1 py-2 text-sm outline-none'
              />
            </div>
          </label>
        ) : (
          <label className='block'>
            <span className='mb-1 block text-xs text-(--text2)'>
              {t('addChannelLabelName')}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              className='w-full rounded-md border bg-(--bg) px-3 py-2 text-sm outline-none focus:border-(--accent)'
              style={{ borderColor: 'var(--border)' }}
            />
          </label>
        )}

        {mode === 'create' && (
          <label className='block'>
            <span className='mb-1 flex items-center justify-between text-xs text-(--text2)'>
              {t('addChannelLabelSecretGenerated')}
              <button
                onClick={() => setGenerated(toHex(randomSecret()))}
                className='text-(--accent) hover:underline'
              >
                {t('addChannelBtnRegenerate')}
              </button>
            </span>
            <input
              readOnly
              value={generated}
              className='w-full rounded-md border bg-(--bg) px-3 py-2 font-mono text-xs text-(--text2) outline-none'
              style={{ borderColor: 'var(--border)' }}
            />
          </label>
        )}

        {mode === 'joinPrivate' && (
          <label className='block'>
            <span className='mb-1 block text-xs text-(--text2)'>
              {t('addChannelLabelSecretHex')}
            </span>
            <input
              value={secretHex}
              onChange={(e) => setSecretHex(e.target.value)}
              className='w-full rounded-md border bg-(--bg) px-3 py-2 font-mono text-xs outline-none focus:border-(--accent)'
              style={{ borderColor: 'var(--border)' }}
            />
          </label>
        )}

        {error && <p className='text-xs text-(--red)'>{error}</p>}
      </div>

      <div className='mt-6 flex justify-end gap-2'>
        <button
          onClick={close}
          className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
        >
          {t('addChannelBtnCancel')}
        </button>
        <button
          onClick={submit}
          className='rounded-md bg-(--accent) px-3 py-1.5 text-sm font-semibold text-white hover:bg-(--accent-hover)'
        >
          {mode === 'create'
            ? t('addChannelBtnCreate')
            : t('addChannelBtnJoin')}
        </button>
      </div>
    </ModalShell>
  );
}
