// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useTranslation } from 'react-i18next';
import {
  contactConvo,
  manageNode,
  openConvo,
  useMeshStore,
} from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useClockTick } from '@/hooks/useClockTick';
import {
  ADV_ICON,
  ADV_LABEL_KEY,
  isManagedNode,
  normalizedLastHeard,
} from '@/lib/utils';
import {
  formatClockSkew,
  formatDateTime,
  formatDistanceBearing,
  formatRelative,
  formatRoute,
} from '@/lib/i18n/format';
import { FAVORITE_FLAG } from '@/lib/meshcore/constants';
import { type MapNode } from '@/lib/map/nodes';

/**
 * The body of the popup anchored to a clicked map marker: the spatial facts
 * worth reading without losing sight of the map (distance and bearing, route,
 * last advert), plus the actions a marker click used to cost several clicks —
 * opening the conversation and favoriting. Rarer or destructive operations stay
 * behind `ManagePanel`, which the last action escalates to.
 *
 * Reads the live `Contact`/`Advert` from the store rather than trusting the
 * {@link MapNode} snapshot, so an advert arriving while the popup is open
 * refreshes it. A node the radio no longer knows renders only what the marker
 * itself carries.
 */
export function MapNodePopup({
  node,
  onClose,
}: {
  /** The clicked node; never the `self` marker, which is inert. */
  node: MapNode;
  /** Dismisses the popup — used by actions that leave the map. */
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const contact = useMeshStore((s) => s.contacts[node.pubkeyPrefix]);
  const advert = useMeshStore((s) => s.advertCache[node.pubkeyPrefix]);
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const unitSystem = useMeshStore((s) => s.unitSystem);
  const { toggleFavorite } = useMeshCore();
  // The last-advert age is read off the wall clock, so it needs a tick of its
  // own to keep ageing while the map sits idle behind the popup.
  const nowSecs = useClockTick();

  const name = contact?.name || advert?.name || node.name;
  // The same normalization the node list and the age filter apply, so
  // selecting a row can't change the age the node appears to have.
  const lastHeard = normalizedLastHeard(contact, advert, nowSecs);
  const clockSkew = formatClockSkew(advert?.clockSkewSecs);
  // Taken as a pair, the way `contactCoords` reads it: `0` is the firmware's
  // unset coordinate, and a half-set contact position falls through to the
  // cached advert whole rather than pairing one field from each record — which
  // would put the distance somewhere the marker is not.
  const position =
    contact?.advLat && contact.advLon
      ? { lat: contact.advLat, lon: contact.advLon }
      : advert?.advLat && advert.advLon
        ? { lat: advert.advLat, lon: advert.advLon }
        : null;
  const distance = formatDistanceBearing(
    selfInfo?.advLat,
    selfInfo?.advLon,
    position?.lat,
    position?.lon,
    unitSystem,
  );
  const isFav = contact ? (contact.flags & FAVORITE_FLAG) !== 0 : false;
  // The same split as the Nodes directory: a room server offers both its post
  // feed and its management view, a repeater only the latter, and a sensor
  // its conversation once it has messaged. Selected as a boolean so a
  // sensor's first message shows the action without re-rendering on every
  // other arrival.
  const hasConvo = useMeshStore((s) =>
    contact ? contactConvo(contact, s.msgHistory) !== null : false,
  );
  const managed = contact ? isManagedNode(contact.advType) : false;

  const openContact = () => {
    const convo = contact && contactConvo(contact);
    if (!convo) return;
    onClose();
    // Selected before the view switch, the way the palette and URL routes do
    // it: `setView` catches up whichever conversation is open at that moment,
    // so switching first would mark the *previous* one read.
    openConvo(convo);
    useMeshStore.getState().setView('chat');
  };

  const openAdmin = () => {
    if (!contact) return;
    onClose();
    manageNode(contact);
  };

  const openManage = () => {
    onClose();
    // Keyed off the live store rather than the marker's snapshot, so a node
    // saved to the radio while its popup was open escalates to the contact
    // panel instead of the read-only advert one.
    useMeshStore.getState().setManagePanel({
      kind: contact ? 'contact' : 'advert',
      id: node.pubkeyPrefix,
    });
  };

  return (
    <div className='flex w-60 flex-col gap-2 text-sm text-text'>
      <div className='flex items-baseline gap-1.5 pr-4'>
        <span aria-hidden='true'>{ADV_ICON[node.advType] ?? '👤'}</span>
        <span className='min-w-0 font-semibold wrap-break-word'>{name}</span>
      </div>
      <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs'>
        <PopupRow
          label={t('manage.type')}
          value={t(
            ADV_LABEL_KEY[node.advType as keyof typeof ADV_LABEL_KEY] ??
              'common.unknown',
          )}
        />
        {distance && <PopupRow label={t('manage.distance')} value={distance} />}
        {contact && (
          <PopupRow
            label={t('manage.route')}
            value={formatRoute(contact.outPathLen)}
          />
        )}
        <PopupRow
          label={t('manage.lastAdvert')}
          value={lastHeard ? formatRelative(lastHeard) : t('common.unknown')}
          title={lastHeard ? formatDateTime(lastHeard) : undefined}
        />
        {clockSkew && (
          <PopupRow
            label={t('manage.clockSkew')}
            value={clockSkew}
            title={
              advert?.lastHeard ? formatDateTime(advert.lastHeard) : undefined
            }
          />
        )}
        <PopupRow
          label={t('manage.publicKey')}
          value={node.pubkeyPrefix}
          mono
        />
      </dl>
      <div className='flex flex-wrap items-center gap-1 border-t border-border pt-2'>
        {hasConvo && (
          <PopupAction onClick={openContact} label={t('map.popup.message')} />
        )}
        {managed && (
          <PopupAction onClick={openAdmin} label={t('map.popup.manage')} />
        )}
        {contact && (
          <PopupAction
            onClick={() => void toggleFavorite(contact)}
            label={isFav ? t('manage.unfavorite') : t('manage.favorite')}
          />
        )}
        <PopupAction onClick={openManage} label={t('map.popup.more')} />
      </div>
    </div>
  );
}

/**
 * `renderPopup` for {@link BaseLeafletMap}, shared by every map that opens a
 * node popup so they can't drift apart on what a marker click does. Defined at
 * module scope, so its identity is stable across renders.
 */
export const renderNodePopup = (node: MapNode, close: () => void) => (
  <MapNodePopup node={node} onClose={close} />
);

function PopupRow({
  label,
  value,
  title,
  mono,
}: {
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt className='text-text2'>{label}</dt>
      <dd className={`break-all ${mono ? 'font-mono' : ''}`} title={title}>
        {value}
      </dd>
    </>
  );
}

function PopupAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='rounded-md px-2 py-1 text-xs font-medium text-text hover:bg-surface2'
    >
      {label}
    </button>
  );
}
