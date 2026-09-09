// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ModalShell } from './ModalShell';
import {
  fromHex,
  randomSecret,
  deriveHashtagSecret,
  toHex,
  parseChannelUri,
  isPublicChannelSecret,
} from '@/lib/utils';
import {
  PUBLIC_CHANNEL_NAME,
  PUBLIC_CHANNEL_SECRET,
} from '@/lib/meshcore/constants';

// `joinHashtag` derives the secret from a public name; `joinLink` parses a
// `meshcore://channel/add` link into the `joinPrivate` fields for review.
type Mode =
  'joinPublic' | 'create' | 'joinPrivate' | 'joinHashtag' | 'joinLink';

const MODES = [
  {
    id: 'joinPublic',
    labelKey: 'addChannel.mode.joinPublicLabel',
    hintKey: 'addChannel.mode.joinPublicHint',
  },
  {
    id: 'create',
    labelKey: 'addChannel.mode.createLabel',
    hintKey: 'addChannel.mode.createHint',
  },
  {
    id: 'joinPrivate',
    labelKey: 'addChannel.mode.joinPrivateLabel',
    hintKey: 'addChannel.mode.joinPrivateHint',
  },
  {
    id: 'joinHashtag',
    labelKey: 'addChannel.mode.joinHashtagLabel',
    hintKey: 'addChannel.mode.joinHashtagHint',
  },
  {
    id: 'joinLink',
    labelKey: 'addChannel.mode.joinLinkLabel',
    hintKey: 'addChannel.mode.joinLinkHint',
  },
] as const satisfies readonly {
  id: Mode;
  labelKey: string;
  hintKey: string;
}[];

/**
 * Modal for adding a channel in one of five {@link Mode}s (restore the Public
 * channel, create private, join private by hex secret, join a public hashtag,
 * or paste a `meshcore://channel/add` link to review before joining). The
 * Public mode is offered only while that channel is missing from the radio.
 * Validates input, then calls the `addChannel` action. Mounted only while
 * {@link useMeshStore} `addChannelOpen` is set.
 */
export function AddChannelModal() {
  const { t } = useTranslation();
  const { addChannelOpen, setAddChannelOpen, channels } = useMeshStore();
  const { addChannel } = useMeshCore();
  const [mode, setMode] = useState<Mode>('create');
  const [name, setName] = useState('');
  const [secretHex, setSecretHex] = useState('');
  const [hashtag, setHashtag] = useState('');
  const [link, setLink] = useState('');
  const [generated, setGenerated] = useState(() => toHex(randomSecret()));
  const [error, setError] = useState('');

  if (!addChannelOpen) return null;
  const close = () => {
    setMode('create');
    setName('');
    setSecretHex('');
    setHashtag('');
    setLink('');
    setGenerated(toHex(randomSecret()));
    setError('');
    setAddChannelOpen(false);
  };

  const useLink = () => {
    setError('');
    const parsed = parseChannelUri(link);
    if (!parsed) {
      setError(t('addChannel.error.invalidLink'));
      return;
    }
    setName(parsed.name);
    setSecretHex(parsed.secret);
    setMode('joinPrivate');
  };

  const submit = async () => {
    setError('');
    if (mode === 'joinPublic') {
      addChannel(PUBLIC_CHANNEL_NAME, new Uint8Array(PUBLIC_CHANNEL_SECRET));
      close();
      return;
    }
    if (mode === 'joinHashtag') {
      if (!/^[a-z0-9-]+$/.test(hashtag)) {
        setError(t('addChannel.error.hashtagChars'));
        return;
      }
      addChannel(`#${hashtag}`, await deriveHashtagSecret(hashtag));
      close();
      return;
    }
    if (!name.trim()) {
      setError(t('addChannel.error.enterName'));
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
      setError(t('addChannel.error.invalidSecret'));
      return;
    }
    addChannel(name.trim(), secret);
    close();
  };

  const hint = t(MODES.find((m) => m.id === mode)!.hintKey);
  const modes = Object.values(channels).some((ch) =>
    isPublicChannelSecret(ch.secret),
  )
    ? MODES.filter((m) => m.id !== 'joinPublic')
    : MODES;

  return (
    <ModalShell
      title={t('addChannel.title')}
      onClose={close}
      widthClass='w-128'
    >
      <div
        className='mb-3 flex gap-1 rounded-md p-1'
        style={{ background: 'var(--bg)' }}
      >
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setMode(m.id);
              setError('');
            }}
            className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
              mode === m.id
                ? 'bg-(--accent-solid) text-white inset-ring-1 inset-ring-(--accent)'
                : 'text-(--text2) hover:bg-(--surface2)'
            }`}
          >
            {t(m.labelKey)}
          </button>
        ))}
      </div>
      <p className='mb-4 text-xs text-(--text2)'>{hint}</p>

      <div className='space-y-4'>
        {mode === 'joinHashtag' ? (
          <label className='block'>
            <span className='mb-1 block text-xs text-(--text2)'>
              {t('addChannel.name')}
            </span>
            <div className='flex items-center rounded-md border border-(--border) bg-(--bg) focus-within:border-(--accent)'>
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
        ) : mode === 'joinLink' || mode === 'joinPublic' ? null : (
          <label className='block'>
            <span className='mb-1 block text-xs text-(--text2)'>
              {t('addChannel.name')}
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
              {t('addChannel.secretGenerated')}
              <button
                onClick={() => setGenerated(toHex(randomSecret()))}
                className='text-(--accent) hover:underline'
              >
                {t('addChannel.regenerate')}
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
              {t('addChannel.secretHex')}
            </span>
            <input
              value={secretHex}
              onChange={(e) => setSecretHex(e.target.value)}
              className='w-full rounded-md border bg-(--bg) px-3 py-2 font-mono text-xs outline-none focus:border-(--accent)'
              style={{ borderColor: 'var(--border)' }}
            />
          </label>
        )}

        {mode === 'joinLink' && (
          <label className='block'>
            <span className='mb-1 block text-xs text-(--text2)'>
              {t('addChannel.link')}
            </span>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={t('addChannel.linkPlaceholder')}
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
          {t('common.cancel')}
        </button>
        <button
          onClick={mode === 'joinLink' ? useLink : submit}
          className='rounded-md bg-(--accent-solid) px-3 py-1.5 text-sm font-semibold text-white hover:bg-(--accent-hover)'
        >
          {mode === 'create'
            ? t('addChannel.create')
            : mode === 'joinLink'
              ? t('addChannel.review')
              : mode === 'joinPublic'
                ? t('addChannel.restore')
                : t('addChannel.join')}
        </button>
      </div>
    </ModalShell>
  );
}
