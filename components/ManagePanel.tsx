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

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMeshStore, channelConvoId } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ModalShell } from './ModalShell';
import { CopyButton } from './CopyButton';
import {
  ADV_ICON,
  ADV_LABEL_KEY,
  formatRelative,
  toHex,
  fromHex,
  channelHashHex,
  deriveHashtagSecret,
  bytesEqual,
} from '@/lib/utils';
import { FAVORITE_FLAG, NO_PATH } from '@/lib/meshcore/constants';
import type { Contact, Channel } from '@/types/meshcore';

/**
 * The detail/management modal for a contact or channel, driven by the store's
 * `managePanel` selection. Contacts expose favorite/reset-route/remove (share
 * is
 * a placeholder); channels show their properties and a remove action. Removal
 * is
 * confirmed inline. Renders nothing when no item is selected.
 */
export function ManagePanel() {
  const { t } = useTranslation();
  const { managePanel, setManagePanel, contacts, channels, autoAddConfig } =
    useMeshStore();
  const { toggleFavorite, removeContact, resetContactPath, removeChannel } =
    useMeshCore();
  const [confirming, setConfirming] = useState(false);

  if (!managePanel) return null;
  const close = () => {
    setConfirming(false);
    setManagePanel(null);
  };

  if (managePanel.kind === 'channel') {
    const idx = Number(managePanel.id);
    const channel = channels[idx];
    if (!channel) return null;
    return (
      <ModalShell
        title={`🔒 ${channel.name || t('common.channelName', { index: idx })}`}
        onClose={close}
      >
        <ChannelDetails channel={channel} />
        {confirming ? (
          <ConfirmRow
            message={t('manage.removeChannelConfirm')}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              removeChannel(idx);
              close();
            }}
          />
        ) : (
          <div className='mt-6 flex justify-end border-t border-(--border) pt-4'>
            <button
              disabled={idx === 0}
              onClick={() => setConfirming(true)}
              title={
                idx === 0 ? t('manage.publicChannelCantRemove') : undefined
              }
              className='rounded-md bg-(--red-dim) px-3 py-1.5 text-sm text-white hover:bg-(--red-dim-hover) disabled:opacity-40 disabled:hover:bg-(--red-dim)'
            >
              {t('manage.removeChannel')}
            </button>
          </div>
        )}
      </ModalShell>
    );
  }

  const contact = contacts[managePanel.id];
  if (!contact) return null;
  const isFav = (contact.flags & FAVORITE_FLAG) !== 0;
  const hasRoute = contact.outPathLen !== NO_PATH;

  return (
    <ModalShell
      title={`${ADV_ICON[contact.advType] ?? '👤'} ${contact.name || contact.pubkeyPrefix.slice(0, 8)}`}
      onClose={close}
    >
      <div className='space-y-2'>
        <DetailRow
          label={t('manage.type')}
          value={t(
            ADV_LABEL_KEY[contact.advType as keyof typeof ADV_LABEL_KEY] ??
              'common.unknown',
          )}
        />
        <DetailRow
          label={t('manage.publicKey')}
          value={
            autoAddConfig.showPublicKeys
              ? contact.pubkey
              : `${contact.pubkeyPrefix}…`
          }
          mono
          copy={contact.pubkey}
        />
        <DetailRow label={t('manage.route')} value={routeLabel(t, contact)} />
        {hasRoute && contact.path.length > 0 && (
          <DetailRow
            label={t('manage.path')}
            value={toHex(contact.path, ' ')}
            mono
          />
        )}
        <DetailRow
          label={t('manage.lastAdvert')}
          value={
            contact.lastAdvert
              ? formatRelative(contact.lastAdvert)
              : t('common.unknown')
          }
        />
      </div>

      {confirming ? (
        <ConfirmRow
          message={t('manage.removeContactConfirm')}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            removeContact(contact);
            close();
          }}
        />
      ) : (
        <div className='mt-6 flex flex-wrap justify-end gap-2 border-t border-(--border) pt-4'>
          <button
            onClick={() => toggleFavorite(contact)}
            className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
          >
            {isFav ? t('manage.unfavorite') : t('manage.favorite')}
          </button>
          {hasRoute && (
            <button
              onClick={() => resetContactPath(contact)}
              className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
            >
              {t('manage.resetRoute')}
            </button>
          )}
          <button
            disabled
            title={t('manage.comingSoon')}
            className='rounded-md px-3 py-1.5 text-sm text-(--text2) opacity-40'
          >
            {t('manage.share')}
          </button>
          <button
            onClick={() => setConfirming(true)}
            className='rounded-md bg-(--red-dim) px-3 py-1.5 text-sm text-white hover:bg-(--red-dim-hover)'
          >
            {t('common.remove')}
          </button>
        </div>
      )}
    </ModalShell>
  );
}

/**
 * Read-only property rows for a channel: name, index, derived type
 * (Public/Hashtag/Private), channel hash, message count, and a reveal/copy of
 * the secret key.
 */
function ChannelDetails({ channel }: { channel: Channel }) {
  const { t } = useTranslation();
  const msgHistory = useMeshStore((s) => s.msgHistory);
  const [reveal, setReveal] = useState(false);
  const [hash, setHash] = useState('');
  const [type, setType] = useState<'' | 'Public' | 'Hashtag' | 'Private'>('');

  const secretHex = channel.secret ? toHex(channel.secret) : '';
  const msgCount = (msgHistory[channelConvoId(channel.idx)] ?? []).length;

  // secretHex (a stable string) drives the effect so it doesn't recompute on
  // every store update, where channel.secret would be a fresh Uint8Array
  // identity
  useEffect(() => {
    let active = true;
    void (async () => {
      const secret = secretHex ? fromHex(secretHex, 16) : null;
      if (!secret) {
        if (active) {
          setHash('');
          setType(channel.idx === 0 ? 'Public' : 'Private');
        }
        return;
      }
      const h = await channelHashHex(secret);
      let kind: 'Public' | 'Hashtag' | 'Private';
      if (channel.idx === 0) {
        kind = 'Public';
      } else if (
        channel.name.startsWith('#') &&
        bytesEqual(await deriveHashtagSecret(channel.name.slice(1)), secret)
      ) {
        kind = 'Hashtag';
      } else {
        kind = 'Private';
      }
      if (active) {
        setHash(h);
        setType(kind);
      }
    })();
    return () => {
      active = false;
    };
  }, [channel.idx, channel.name, secretHex]);

  return (
    <div className='space-y-2'>
      <DetailRow
        label={t('manage.name')}
        value={channel.name || t('common.channelName', { index: channel.idx })}
      />
      <DetailRow label={t('manage.index')} value={String(channel.idx)} />
      {type && (
        <DetailRow
          label={t('manage.type')}
          value={
            type === 'Public'
              ? t('manage.channelType.public')
              : type === 'Hashtag'
                ? t('manage.channelType.hashtag')
                : t('manage.channelType.private')
          }
        />
      )}
      {hash && (
        <DetailRow label={t('manage.channelHash')} value={`0x${hash}`} mono />
      )}
      <DetailRow label={t('manage.messages')} value={String(msgCount)} />
      {secretHex && (
        <div className='flex items-center gap-3 text-sm'>
          <span className='w-24 shrink-0 text-(--text2)'>
            {t('manage.secretKey')}
          </span>
          <button
            onClick={() => setReveal(!reveal)}
            aria-label={
              reveal ? t('manage.hideSecret') : t('manage.revealSecret')
            }
            className='relative flex-1 cursor-pointer text-left'
          >
            <span
              className={`block font-mono text-xs break-all ${reveal ? '' : 'blur-[5px] select-none'}`}
            >
              {secretHex}
            </span>
            {!reveal && (
              <span className='absolute inset-0 flex items-center justify-center text-(--text2)'>
                <EyeIcon />
              </span>
            )}
          </button>
          <CopyButton value={secretHex} />
        </div>
      )}
    </div>
  );
}

/**
 * Inline confirmation row (message + Cancel/Remove) shown in place of the
 * action buttons.
 */
function ConfirmRow({
  message,
  onCancel,
  onConfirm,
}: {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className='mt-6 flex items-center justify-between gap-3 border-t border-(--border) pt-4'>
      <span className='text-sm text-(--text2)'>{message}</span>
      <div className='flex shrink-0 gap-2'>
        <button
          onClick={onCancel}
          className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={onConfirm}
          className='rounded-md bg-(--red) px-3 py-1.5 text-sm font-semibold text-white hover:bg-(--red-hover)'
        >
          {t('common.remove')}
        </button>
      </div>
    </div>
  );
}

/** Verbose route description for the contact detail row. */
function routeLabel(t: TFunction, contact: Contact): string {
  if (contact.outPathLen === NO_PATH) return t('route.noRouteFloods');
  if (contact.outPathLen === 0) return t('route.directHops');
  return t('route.hops', { count: contact.outPathLen });
}

/**
 * A label/value row in the detail panel.
 *
 * @param mono - render the value in monospace (for keys/hashes).
 * @param copy - if set, shows a {@link CopyButton} that copies this string.
 */
function DetailRow({
  label,
  value,
  mono,
  copy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copy?: string;
}) {
  return (
    <div className='flex items-center gap-3 text-sm'>
      <span className='w-24 shrink-0 text-(--text2)'>{label}</span>
      <span className={`flex-1 break-all ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </span>
      {copy && <CopyButton value={copy} />}
    </div>
  );
}

/** Eye glyph overlaid on the blurred secret key to indicate it's revealable. */
function EyeIcon() {
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d='M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z' />
      <circle cx='12' cy='12' r='3' />
    </svg>
  );
}
