// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { useMeshStore, channelConvoId } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { ModalShell } from './ModalShell';
import { ConfirmRow } from './ConfirmRow';
import { CopyButton } from './CopyButton';
import { HintToken } from './MessageBubble';
import { ShareCard } from './ShareCard';
import { TelemetryPanel } from './TelemetryPanel';
import {
  ADV_ICON,
  ADV_LABEL_KEY,
  contactShareUri,
  toHex,
  fromHex,
  channelHashHex,
  deriveHashtagSecret,
  bytesEqual,
  isPublicChannelSecret,
  formatLatLon,
  formatPubkey,
  normalizedLastHeard,
} from '@/lib/utils';
import {
  formatClockSkew,
  formatDateTime,
  formatDistanceBearing,
  formatRelative,
  formatRoute,
} from '@/lib/i18n/format';
import {
  ADV_TYPE_REPEATER,
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
  // (`confirming`/`sharing`) reset instead of leaking into the next item. The
  // share flag is part of the key too: asking for the share page on the
  // already-open contact has to re-run the initial sub-view choice.
  return (
    <ManagePanelView
      key={`${managePanel.kind}:${managePanel.id}:${managePanel.share ?? false}`}
    />
  );
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
  const [sharing, setSharing] = useState(managePanel?.share ?? false);

  if (!managePanel) return null;
  const close = () => {
    setConfirming(false);
    setSharing(false);
    setManagePanel(null);
  };

  if (managePanel.kind === 'channel') {
    const idx = Number(managePanel.id);
    const channel = channels[idx];
    if (!channel) return null;
    return (
      <ModalShell
        title={`${isPublicChannelSecret(channel.secret) ? '📢' : '🔒'} ${channel.name || t('common.channelName', { index: idx })}`}
        onClose={close}
      >
        <ChannelDetails channel={channel} />
        {confirming ? (
          <ConfirmRow
            message={t('manage.removeChannelConfirm')}
            confirmLabel={t('common.remove')}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              removeChannel(idx);
              close();
            }}
          />
        ) : (
          <div className='mt-6 flex justify-end border-t border-border pt-4'>
            <button
              onClick={() => setConfirming(true)}
              className='rounded-md bg-red-dim px-3 py-1.5 text-sm text-white hover:bg-red-dim-hover'
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
    // Normalized to our clock, so this row reads the same age as the map popup
    // and the Nodes table show for the same node at the same moment.
    const advertHeard = normalizedLastHeard(undefined, advert);
    const advertSkew = formatClockSkew(advert.clockSkewSecs);
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
            value={
              advertHeard ? formatRelative(advertHeard) : t('common.unknown')
            }
            hint={advertHeard ? formatDateTime(advertHeard) : undefined}
          />
          {advertSkew && (
            <DetailRow
              label={t('manage.clockSkew')}
              value={advertSkew}
              hint={
                advert.lastHeard ? formatDateTime(advert.lastHeard) : undefined
              }
            />
          )}
          {location && (
            <DetailRow label={t('manage.location')} value={location} />
          )}
          {distance && (
            <DetailRow label={t('manage.distance')} value={distance} />
          )}
        </div>
        <div className='mt-4 flex items-center justify-between gap-3 border-t border-border pt-4'>
          <p className='text-xs text-text2'>
            {connected ? t('manage.advertHint') : t('manage.advertConnectHint')}
          </p>
          <button
            disabled={!connected}
            onClick={() => {
              void addDiscoveredContact(advert);
              close();
            }}
            className='shrink-0 rounded-md bg-accent-solid px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50'
          >
            {t('manage.addContact')}
          </button>
        </div>
      </ModalShell>
    );
  }

  const contact = contacts[managePanel.id];
  if (!contact) return null;

  const isFav = (contact.flags & FAVORITE_FLAG) !== 0;
  const hasRoute = contact.outPathLen !== NO_PATH;
  // The contact row carries the sender's clock; the cached advert is what
  // carries our measurement of how far off it is. Reading them together is
  // what stops this panel disagreeing with the map about the same node.
  const contactAdvert = advertCache[contact.pubkeyPrefix];
  const contactHeard = normalizedLastHeard(contact, contactAdvert);
  const contactSkew = formatClockSkew(contactAdvert?.clockSkewSecs);
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
              value={formatRoute(contact.outPathLen)}
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
                contactHeard
                  ? formatRelative(contactHeard)
                  : t('common.unknown')
              }
              hint={contactHeard ? formatDateTime(contactHeard) : undefined}
            />
            {contactSkew && (
              <DetailRow
                label={t('manage.clockSkew')}
                value={contactSkew}
                hint={
                  contact.lastAdvert
                    ? formatDateTime(contact.lastAdvert)
                    : undefined
                }
              />
            )}
            {location && (
              <DetailRow label={t('manage.location')} value={location} />
            )}
            {distance && (
              <DetailRow label={t('manage.distance')} value={distance} />
            )}
          </div>

          <div className='mt-6 border-t border-border pt-4'>
            <h3 className='mb-2 text-sm font-semibold text-text'>
              {t('telemetry.title')}
            </h3>
            <TelemetryPanel contact={contact} />
          </div>

          {confirming ? (
            <ConfirmRow
              message={t('manage.removeContactConfirm')}
              confirmLabel={t('common.remove')}
              onCancel={() => setConfirming(false)}
              onConfirm={() => {
                removeContact(contact);
                close();
              }}
            />
          ) : (
            <div className='mt-6 flex flex-wrap justify-end gap-2 border-t border-border pt-4'>
              <button
                onClick={() => toggleFavorite(contact)}
                className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2'
              >
                {isFav ? t('manage.unfavorite') : t('manage.favorite')}
              </button>
              {hasRoute && (
                <button
                  onClick={() => resetContactPath(contact)}
                  className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2'
                >
                  {t('manage.resetRoute')}
                </button>
              )}
              <button
                onClick={() => setSharing(true)}
                className='rounded-md px-3 py-1.5 text-sm text-text hover:bg-surface2'
              >
                {t('manage.share')}
              </button>
              <button
                onClick={() => setConfirming(true)}
                className='rounded-md bg-red-dim px-3 py-1.5 text-sm text-white hover:bg-red-dim-hover'
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
          setType('Private');
        }
        return;
      }
      const h = await channelHashHex(secret);
      let kind: 'Public' | 'Hashtag' | 'Private';
      if (isPublicChannelSecret(secret)) {
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
          <span className='w-24 shrink-0 text-text2'>
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
              <span className='absolute inset-0 flex items-center justify-center text-text2'>
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

function DetailRow({
  label,
  value,
  hint,
  mono,
  copy,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
  copy?: string;
}) {
  return (
    <div className='flex items-center gap-3 text-sm'>
      <span className='w-24 shrink-0 text-text2'>{label}</span>
      <span className={`flex-1 break-all ${mono ? 'font-mono text-xs' : ''}`}>
        <HintToken label={value} title={hint} />
      </span>
      {copy && <CopyButton value={copy} />}
    </div>
  );
}
