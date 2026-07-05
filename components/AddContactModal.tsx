// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ModalShell } from './ModalShell';
import {
  ADV_ICON,
  ADV_LABEL_KEY,
  formatLatLon,
  formatPubkey,
  fromHex,
  parseContactUri,
} from '@/lib/utils';
import {
  ADV_TYPE_REPEATER,
  ADV_TYPE_ROOM,
  ADV_TYPE_SENSOR,
} from '@/lib/meshcore/constants';
import { formatDistanceBearing, formatRelative } from '@/lib/i18n/format';

/**
 * How the contact is provided: `discover` lists heard over-the-air adverts to
 * add directly; `paste` parses a `meshcore://contact/add` link into the fields
 * for review; `manual` takes a name, public key, and type directly.
 */
type Mode = 'discover' | 'paste' | 'manual';

/**
 * Cap on discovered rows rendered at once. The advert cache can hold hundreds
 * of nodes; the search bar narrows the rest.
 */
const DISCOVER_RENDER_CAP = 200;

const MODES = [
  {
    id: 'discover',
    labelKey: 'addContact.mode.discoverLabel',
    hintKey: 'addContact.mode.discoverHint',
  },
  {
    id: 'manual',
    labelKey: 'addContact.mode.manualLabel',
    hintKey: 'addContact.mode.manualHint',
  },
  {
    id: 'paste',
    labelKey: 'addContact.mode.pasteLabel',
    hintKey: 'addContact.mode.pasteHint',
  },
] as const satisfies readonly {
  id: Mode;
  labelKey: string;
  hintKey: string;
}[];

/** Selectable advert types, paired with their icon and i18n label key. */
const TYPE_OPTIONS = [
  1,
  ADV_TYPE_REPEATER,
  ADV_TYPE_ROOM,
  ADV_TYPE_SENSOR,
] as const satisfies readonly (keyof typeof ADV_LABEL_KEY)[];

/**
 * Modal for adding a contact, in one of three {@link Mode}s: picking a node
 * heard over the air, pasting a `meshcore://contact/add` link (which prefills
 * the fields for review), or entering a name, 64-hex public key, and type
 * manually. Discovered nodes add via `addDiscoveredContact`; the link/manual
 * paths submit through `importContact`. Mounted only while {@link useMeshStore}
 * `addContactOpen` is set.
 */
export function AddContactModal() {
  const { t } = useTranslation();
  const { addContactOpen, setAddContactOpen, advertCache, contacts } =
    useMeshStore();
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const unitSystem = useMeshStore((s) => s.unitSystem);
  const showFullPublicKeys = useMeshStore((s) => s.showFullPublicKeys);
  // The cache can be viewed while disconnected, but adding a contact writes to
  // the radio — gate the per-row Add so it can't silently no-op offline.
  const connected = useMeshStore((s) => s.status === 'connected');
  const { importContact, addDiscoveredContact } = useMeshCore();
  const [mode, setMode] = useState<Mode>('discover');
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [pubkey, setPubkey] = useState('');
  const [advType, setAdvType] = useState<number>(1);
  const [discoverQuery, setDiscoverQuery] = useState('');
  const [error, setError] = useState('');

  if (!addContactOpen) return null;

  const close = () => {
    setMode('discover');
    setLink('');
    setName('');
    setPubkey('');
    setAdvType(1);
    setDiscoverQuery('');
    setError('');
    setAddContactOpen(false);
  };

  const keyValid = fromHex(pubkey, 32) !== null;

  const useLink = () => {
    setError('');
    const parsed = parseContactUri(link);
    if (!parsed) {
      setError(t('addContact.error.invalidLink'));
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
      setError(t('addContact.error.enterName'));
      return;
    }
    if (!keyValid) {
      setError(t('addContact.error.invalidKey'));
      return;
    }
    importContact({ name: name.trim(), pubkey, advType });
    close();
  };

  const hint = t(MODES.find((m) => m.id === mode)!.hintKey);
  // Discovered nodes come from the browser advert cache (persisted across
  // sessions), narrowed by the search box and ordered by most recently heard so
  // the freshest nodes surface first.
  const cachedAdverts = Object.values(advertCache);
  const discoverTerm = discoverQuery.trim().toLowerCase();
  const heard = cachedAdverts
    .filter(
      (a) =>
        !discoverTerm ||
        a.name.toLowerCase().includes(discoverTerm) ||
        a.pubkeyPrefix.toLowerCase().includes(discoverTerm),
    )
    .sort((a, b) => b.lastHeard - a.lastHeard);

  return (
    <ModalShell
      title={t('addContact.title')}
      onClose={close}
      widthClass='w-112'
    >
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
            {t(m.labelKey)}
          </button>
        ))}
      </div>
      {(mode !== 'discover' || cachedAdverts.length > 0) && (
        <p className='mb-4 text-xs text-(--text2)'>{hint}</p>
      )}

      {mode === 'discover' ? (
        cachedAdverts.length === 0 ? (
          <p className='py-8 text-center text-sm text-(--text2)'>
            {t('discover.empty')}
          </p>
        ) : (
          <div>
            <div className='relative mb-3'>
              <Search
                size={16}
                className='absolute top-1/2 left-3 -translate-y-1/2 text-(--text2)'
              />
              <input
                value={discoverQuery}
                onChange={(e) => setDiscoverQuery(e.target.value)}
                placeholder={t('discover.searchPlaceholder')}
                aria-label={t('discover.searchPlaceholder')}
                className='w-full rounded-md border border-(--border) bg-(--bg) px-9 py-2 text-sm outline-none focus:border-(--accent)'
              />
            </div>
            {heard.length === 0 ? (
              <p className='py-8 text-center text-sm text-(--text2)'>
                {t('discover.noMatches')}
              </p>
            ) : (
              <>
                <div className='max-h-[45vh] space-y-1 overflow-y-auto'>
                  {heard.slice(0, DISCOVER_RENDER_CAP).map((a) => {
                    const added = contacts[a.pubkeyPrefix] !== undefined;
                    const location = formatLatLon(a.advLat, a.advLon);
                    const distance = formatDistanceBearing(
                      selfInfo?.advLat,
                      selfInfo?.advLon,
                      a.advLat,
                      a.advLon,
                      unitSystem,
                    );
                    return (
                      <div
                        key={a.pubkeyPrefix}
                        className='flex items-center gap-3 rounded-md px-2 py-2 hover:bg-(--surface2)'
                      >
                        <span className='text-base'>
                          {ADV_ICON[a.advType] ?? '👤'}
                        </span>
                        <div className='min-w-0 flex-1'>
                          <div className='truncate text-sm'>
                            {a.name || a.pubkeyPrefix.slice(0, 8)}
                          </div>
                          <div className='truncate text-xs text-(--text2)'>
                            {t(
                              ADV_LABEL_KEY[
                                a.advType as keyof typeof ADV_LABEL_KEY
                              ] ?? 'discover.node',
                            )}{' '}
                            · {formatRelative(a.lastHeard)} ·{' '}
                            {formatPubkey(a.pubkey, showFullPublicKeys)}
                          </div>
                          {location && (
                            <div className='truncate text-xs text-(--text2)'>
                              {location}
                              {distance && ` · ${distance}`}
                            </div>
                          )}
                        </div>
                        {added ? (
                          <span className='text-xs text-(--green)'>
                            {t('discover.added')}
                          </span>
                        ) : (
                          <button
                            disabled={!connected}
                            onClick={() => addDiscoveredContact(a)}
                            className='rounded-md px-3 py-1 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
                            style={{ background: 'var(--accent)' }}
                          >
                            {t('discover.add')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {heard.length > DISCOVER_RENDER_CAP && (
                  <p className='mt-3 text-center text-xs text-(--text2)'>
                    {t('discover.showing', {
                      shown: DISCOVER_RENDER_CAP,
                      total: heard.length,
                    })}
                  </p>
                )}
              </>
            )}
          </div>
        )
      ) : mode === 'paste' ? (
        <div className='space-y-4'>
          <label className='block'>
            <span className='mb-1 block text-xs text-(--text2)'>
              {t('addContact.link')}
            </span>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={t('addContact.linkPlaceholder')}
              className='w-full rounded-md border border-(--border) bg-(--bg) px-3 py-2 font-mono text-xs outline-none focus:border-(--accent)'
            />
          </label>
          {error && <p className='text-xs text-(--red)'>{error}</p>}
        </div>
      ) : (
        <div className='space-y-4'>
          <label className='block'>
            <span className='mb-1 block text-xs text-(--text2)'>
              {t('addContact.name')}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              className='w-full rounded-md border border-(--border) bg-(--bg) px-3 py-2 text-sm outline-none focus:border-(--accent)'
            />
          </label>

          <label className='block'>
            <span className='mb-1 block text-xs text-(--text2)'>
              {t('addContact.publicKey')}
            </span>
            <input
              value={pubkey}
              onChange={(e) => setPubkey(e.target.value)}
              placeholder={t('addContact.publicKeyPlaceholder')}
              className={`w-full rounded-md border bg-(--bg) px-3 py-2 font-mono text-xs outline-none ${
                pubkey && !keyValid
                  ? 'border-(--red)'
                  : 'border-(--border) focus:border-(--accent)'
              }`}
            />
            {pubkey && !keyValid && (
              <span className='mt-1 block text-xs text-(--red)'>
                {t('addContact.error.invalidKey')}
              </span>
            )}
          </label>

          <div>
            <span className='mb-1 block text-xs text-(--text2)'>
              {t('addContact.type')}
            </span>
            <div className='flex gap-1'>
              {TYPE_OPTIONS.map((type) => (
                <button
                  key={type}
                  onClick={() => setAdvType(type)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                    advType === type
                      ? 'border-(--accent) text-(--accent)'
                      : 'border-(--border) text-(--text2) hover:bg-(--surface2)'
                  }`}
                >
                  <span>{ADV_ICON[type]}</span>
                  {t(ADV_LABEL_KEY[type])}
                </button>
              ))}
            </div>
          </div>

          {error && <p className='text-xs text-(--red)'>{error}</p>}
        </div>
      )}

      <div className='mt-6 flex justify-end gap-2'>
        <button
          onClick={close}
          className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
        >
          {mode === 'discover' ? t('common.close') : t('common.cancel')}
        </button>
        {mode !== 'discover' && (
          <button
            onClick={mode === 'paste' ? useLink : submit}
            className='rounded-md bg-(--accent) px-3 py-1.5 text-sm font-semibold text-white hover:bg-(--accent-hover)'
          >
            {mode === 'paste' ? t('addContact.review') : t('addContact.add')}
          </button>
        )}
      </div>
    </ModalShell>
  );
}
