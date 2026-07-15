// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useMeshStore, channelConvoId } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ModalShell } from './ModalShell';
import { RepeaterAdminPanel } from './RepeaterAdminPanel';
import { CopyButton } from './CopyButton';
import { ShareCard } from './ShareCard';
import {
  ADV_ICON,
  ADV_LABEL_KEY,
  contactShareUri,
  toHex,
  fromHex,
  channelHashHex,
  deriveHashtagSecret,
  bytesEqual,
  formatLatLon,
  formatPubkey,
} from '@/lib/utils';
import { formatDistanceBearing, formatRelative } from '@/lib/i18n/format';
import {
  ADV_TYPE_REPEATER,
  ADV_TYPE_ROOM,
  FAVORITE_FLAG,
  NO_PATH,
} from '@/lib/meshcore/constants';
import type { Contact, Channel } from '@/types/meshcore';

/**
 * The detail/management modal for a contact, channel, or cached advert, driven
 * by the store's `managePanel` selection. Contacts expose
 * favorite/reset-route/share/remove; the Share action swaps the detail view for
 * a {@link ContactShare} sub-page. Channels show their properties and a remove
 * action. A cached advert (a discovered node not in the radio's contact table)
 * shows a read-only summary of the metadata heard in its advert. Removal is
 * confirmed inline. Renders nothing when no item is selected.
 */
export function ManagePanel() {
  const managePanel = useMeshStore((s) => s.managePanel);
  if (!managePanel) return null;
  // Remount the panel whenever the selection changes — including when the open
  // item is evicted from the store and replaced — so the sub-view flags
  // (`confirming`/`sharing`) reset instead of leaking into the next item.
  return <ManagePanelView key={`${managePanel.kind}:${managePanel.id}`} />;
}

function ManagePanelView() {
  const { t } = useTranslation();
  const { managePanel, setManagePanel, contacts, channels, advertCache } =
    useMeshStore();
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const unitSystem = useMeshStore((s) => s.unitSystem);
  const showFullPublicKeys = useMeshStore((s) => s.showFullPublicKeys);
  // Adding a cached advert writes to the radio, so it needs a live link. The
  // cache can be viewed while disconnected (map/palette), so gate the action.
  const connected = useMeshStore((s) => s.status === 'connected');
  const {
    toggleFavorite,
    removeContact,
    resetContactPath,
    shareContact,
    removeChannel,
    addDiscoveredContact,
  } = useMeshCore();
  const [confirming, setConfirming] = useState(false);
  // `sharing` selects the contact share sub-page in place of the detail view.
  const [sharing, setSharing] = useState(false);
  // `managing` swaps in the repeater admin panel for the contact detail view.
  const [managing, setManaging] = useState(false);

  if (!managePanel) return null;
  const close = () => {
    setConfirming(false);
    setSharing(false);
    setManaging(false);
    setManagePanel(null);
  };

  if (managePanel.kind === 'channel') {
    const idx = Number(managePanel.id);
    const channel = channels[idx];
    if (!channel) return null;
    return (
      <ModalShell
        title={`${idx === 0 ? '📢' : '🔒'} ${channel.name || t('common.channelName', { index: idx })}`}
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

  if (managePanel.kind === 'advert') {
    const advert = advertCache[managePanel.id];
    if (!advert) return null;
    const location = formatLatLon(advert.advLat, advert.advLon);
    const distance = formatDistanceBearing(
      selfInfo?.advLat,
      selfInfo?.advLon,
      advert.advLat,
      advert.advLon,
      unitSystem,
    );
    const advertTitle = `${ADV_ICON[advert.advType] ?? '👤'} ${advert.name || advert.pubkeyPrefix.slice(0, 8)}`;
    return (
      <ModalShell title={advertTitle} onClose={close}>
        <div className='space-y-2'>
          <DetailRow
            label={t('manage.type')}
            value={t(
              ADV_LABEL_KEY[advert.advType as keyof typeof ADV_LABEL_KEY] ??
                'common.unknown',
            )}
          />
          <DetailRow
            label={t('manage.publicKey')}
            value={formatPubkey(advert.pubkey, showFullPublicKeys)}
            mono
            copy={advert.pubkey}
          />
          <DetailRow
            label={t('manage.lastAdvert')}
            value={formatRelative(advert.lastHeard)}
          />
          {location && (
            <DetailRow label={t('manage.location')} value={location} />
          )}
          {distance && (
            <DetailRow label={t('manage.distance')} value={distance} />
          )}
        </div>
        <div className='mt-4 flex items-center justify-between gap-3 border-t border-(--border) pt-4'>
          <p className='text-xs text-(--text2)'>
            {connected ? t('manage.advertHint') : t('manage.advertConnectHint')}
          </p>
          <button
            disabled={!connected}
            onClick={() => {
              void addDiscoveredContact(advert);
              close();
            }}
            className='shrink-0 rounded-md bg-(--accent) px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50'
          >
            {t('manage.addContact')}
          </button>
        </div>
      </ModalShell>
    );
  }

  const contact = contacts[managePanel.id];
  if (!contact) return null;

  if (managing) {
    return <RepeaterAdminPanel contact={contact} onClose={close} />;
  }

  const isRepeaterOrRoom =
    contact.advType === ADV_TYPE_REPEATER || contact.advType === ADV_TYPE_ROOM;
  const isFav = (contact.flags & FAVORITE_FLAG) !== 0;
  const hasRoute = contact.outPathLen !== NO_PATH;
  const location = formatLatLon(contact.advLat, contact.advLon);
  const distance = formatDistanceBearing(
    selfInfo?.advLat,
    selfInfo?.advLon,
    contact.advLat,
    contact.advLon,
    unitSystem,
  );

  const contactTitle = `${ADV_ICON[contact.advType] ?? '👤'} ${contact.name || contact.pubkeyPrefix.slice(0, 8)}`;

  return (
    <ModalShell
      title={sharing ? t('manage.shareTitle') : contactTitle}
      onClose={close}
      onBack={sharing ? () => setSharing(false) : undefined}
    >
      {sharing ? (
        <ContactShare
          contact={contact}
          onShareAdvert={() => shareContact(contact)}
        />
      ) : (
        <div>
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
              value={formatPubkey(contact.pubkey, showFullPublicKeys)}
              mono
              copy={contact.pubkey}
            />
            <DetailRow
              label={t('manage.route')}
              value={routeLabel(t, contact)}
            />
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
            {location && (
              <DetailRow label={t('manage.location')} value={location} />
            )}
            {distance && (
              <DetailRow label={t('manage.distance')} value={distance} />
            )}
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
              {connected && isRepeaterOrRoom && (
                <button
                  onClick={() => setManaging(true)}
                  className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
                >
                  {t('repeaterAdmin.manage')}
                </button>
              )}
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
                onClick={() => setSharing(true)}
                className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
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
        </div>
      )}
    </ModalShell>
  );
}

/**
 * The contact "Share" sub-page shown in place of the detail view (its title and
 * back button live in the surrounding {@link ModalShell}). Offers three ways to
 * hand off the contact: a scannable QR of its public key, the public key text
 * with a copy button, and a zero-hop advert that asks the radio to re-broadcast
 * the contact's advert to direct neighbors.
 */
function ContactShare({
  contact,
  onShareAdvert,
}: {
  contact: Contact;
  onShareAdvert: () => void;
}) {
  const { t } = useTranslation();
  // Zero-hop advert re-broadcasts the contact's signed advert, which repeaters
  // don't support (here or in the official app), so disable it for them.
  const isRepeater = contact.advType === ADV_TYPE_REPEATER;
  return (
    <ShareCard
      qrValue={contactShareUri(contact)}
      title={`${ADV_ICON[contact.advType] ?? '👤'} ${contact.name || contact.pubkeyPrefix.slice(0, 8)}`}
      scanHint={t('manage.shareScanHint')}
      pubkeyLabel={t('manage.publicKey')}
      pubkey={contact.pubkey}
      advertLabel={t('manage.zeroHopAdvert')}
      advertHint={
        isRepeater
          ? t('manage.zeroHopAdvertRepeater')
          : t('manage.zeroHopAdvertHint')
      }
      advertDisabled={isRepeater}
      onAdvert={onShareAdvert}
    />
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
                <Eye size={16} />
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
