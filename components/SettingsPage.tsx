// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { useMeshStore, type SettingsSection } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useAdvertise } from '@/hooks/useAdvertise';
import { fmtNum, utf8ByteLength, contactShareUri, ADV_ICON } from '@/lib/utils';
import {
  MAX_ADVERT_NAME_BYTES,
  ADVERT_LAT_MIN,
  ADVERT_LAT_MAX,
  ADVERT_LON_MIN,
  ADVERT_LON_MAX,
  ADVERT_LOC_POLICY,
} from '@/lib/meshcore/constants';
import type { SelfInfo } from '@/types/meshcore';
import { CopyButton } from './CopyButton';
import { ModalShell } from './ModalShell';
import { ShareCard } from './ShareCard';
import { RadioSettingsModal, radioFields } from './RadioSettings';

/**
 * Settings page: device identity, firmware, radio configuration, and this
 * radio's advertised location. Rendered by {@link AppShell} in place of the
 * chat pane while `view` is `'settings'`. The Identity section's node name is
 * editable inline ({@link NodeNameRow}), the Radio section opens the
 * {@link RadioSettingsModal} editor, the Location section
 * ({@link LocationCard}) sets the advertised coordinate (typed or picked on the
 * map), and the Advertise section ({@link AdvertiseCard}) announces this node
 * to the mesh.
 * The Device actions section ({@link RebootCard}) reboots the radio behind an
 * inline confirmation; the dropped link recovers through the hook's
 * auto-reconnect loop.
 */
export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { status, selfInfo, deviceInfo: device } = useMeshStore();
  const settingsSection = useMeshStore((s) => s.settingsSection);
  const clearSettingsSection = useMeshStore((s) => s.clearSettingsSection);

  const [radioEditOpen, setRadioEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Scroll to and briefly flash a section card deep-linked from the command
  // palette, then clear the one-shot request.
  useEffect(() => {
    if (!settingsSection) return;
    const el = document.getElementById(`settings-${settingsSection}`);
    clearSettingsSection();
    if (!el) return;
    el.scrollIntoView({ behavior: 'auto', block: 'center' });
    el.classList.add('msg-flash');
    const timer = setTimeout(() => el.classList.remove('msg-flash'), 1600);
    return () => clearTimeout(timer);
  }, [settingsSection, clearSettingsSection]);

  // Editing needs a fully connected link and a firmware that reports every
  // radio field; older firmware that omits any leaves the affordance disabled.
  const fields = radioFields(selfInfo);
  const canEditRadio = status === 'connected' && fields != null;

  const unknown = t('common.unknown');
  const num = (n: number) => fmtNum(n, i18n.language);

  return (
    <div className='flex flex-1 flex-col overflow-y-auto p-7'>
      <div className='mx-auto w-full max-w-3xl'>
        <div className='mb-5'>
          <h2 className='text-base font-bold'>{t('settings.title')}</h2>
        </div>

        <div className='grid grid-cols-2 gap-4'>
          <Card title={t('settings.section.device')} section='device'>
            <Row label={t('settings.model')} value={device?.model || unknown} />
            <Row
              label={t('settings.firmware')}
              value={device ? String(device.fwVersion) : unknown}
            />
            <Row
              label={t('settings.build')}
              value={device?.version || unknown}
            />
            <Row
              label={t('settings.maxContacts')}
              value={device ? num(device.maxContacts) : unknown}
            />
            <Row
              label={t('settings.maxChannels')}
              value={device ? num(device.maxChannels) : unknown}
            />
            {device?.blePin != null && (
              <Row label={t('settings.blePin')} value={String(device.blePin)} />
            )}
          </Card>

          <Card
            title={t('settings.section.radio')}
            section='radio'
            action={
              <button
                onClick={() => setRadioEditOpen(true)}
                disabled={!canEditRadio}
                title={t('settings.editRadio')}
                className='rounded-md border border-(--border-control) px-2.5 py-1 text-xs text-(--text2) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-(--text2)'
              >
                {t('settings.edit')}
              </button>
            }
          >
            <Row
              label={t('settings.frequency')}
              value={
                selfInfo?.radioFreq != null
                  ? t('settings.mhz', { value: num(selfInfo.radioFreq) })
                  : unknown
              }
            />
            <Row
              label={t('settings.bandwidth')}
              value={
                selfInfo?.radioBw != null
                  ? t('settings.khz', { value: num(selfInfo.radioBw) })
                  : unknown
              }
            />
            <Row
              label={t('settings.spreadingFactor')}
              value={
                selfInfo?.radioSf != null ? num(selfInfo.radioSf) : unknown
              }
            />
            <Row
              label={t('settings.codingRate')}
              value={
                selfInfo?.radioCr != null ? num(selfInfo.radioCr) : unknown
              }
            />
            <Row
              label={t('settings.txPower')}
              value={
                selfInfo?.txPower != null
                  ? t('settings.dbm', { value: num(selfInfo.txPower) })
                  : unknown
              }
            />
            <Row
              label={t('settings.maxTxPower')}
              value={
                selfInfo?.maxTxPower != null
                  ? t('settings.dbm', { value: num(selfInfo.maxTxPower) })
                  : unknown
              }
            />
          </Card>

          <Card
            title={t('settings.section.identity')}
            className='col-span-2'
            section='identity'
            action={
              <button
                onClick={() => setShareOpen(true)}
                disabled={!selfInfo?.pubkey}
                className='rounded-md bg-(--accent) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--accent)'
              >
                {t('settings.shareNode')}
              </button>
            }
          >
            <NodeNameRow />
            <Row
              label={t('settings.publicKey')}
              value={selfInfo?.pubkey || unknown}
              mono
              copy={selfInfo?.pubkey || undefined}
            />
          </Card>

          <LocationCard />

          <RebootCard />
        </div>
      </div>

      {radioEditOpen && fields && (
        <RadioSettingsModal
          fields={fields}
          onClose={() => setRadioEditOpen(false)}
        />
      )}

      {shareOpen && selfInfo?.pubkey && (
        <ShareNodeModal
          selfInfo={selfInfo}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The "Share my node" modal: presents this node as a scannable contact QR, the
 * public key with a copy button, and a zero-hop advert action. Renders the
 * shared {@link ShareCard}, so it's identical to {@link ManagePanel}'s contact
 * share screen. The advert button advertises this node to direct neighbors —
 * the self-equivalent of re-broadcasting a contact's advert.
 */
function ShareNodeModal({
  selfInfo,
  onClose,
}: {
  selfInfo: SelfInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const status = useMeshStore((s) => s.status);
  const { advertise, sending } = useAdvertise();
  const advType = selfInfo.advType ?? 1;
  const uri = contactShareUri({
    name: selfInfo.name,
    pubkey: selfInfo.pubkey,
    advType,
  });
  const enabled = status === 'connected' && !sending;
  return (
    <ModalShell title={t('settings.shareNodeTitle')} onClose={onClose}>
      <ShareCard
        qrValue={uri}
        title={`${ADV_ICON[advType] ?? '👤'} ${selfInfo.name || t('common.unknown')}`}
        scanHint={t('settings.shareNodeScanHint')}
        pubkeyLabel={t('settings.publicKey')}
        pubkey={selfInfo.pubkey}
        advertLabel={t('settings.shareNodeAdvert')}
        advertHint={t('settings.shareNodeAdvertHint')}
        advertDisabled={!enabled}
        onAdvert={() => void advertise(false)}
        floodLabel={t('settings.shareNodeFlood')}
        floodDisabled={!enabled}
        onFloodAdvert={() => void advertise(true)}
      />
    </ModalShell>
  );
}

/**
 * The Identity section's node-name row with inline editing: a pencil reveals a
 * text input with Save/Cancel and a live UTF-8 byte counter. Save writes the
 * name to the radio via {@link useMeshCore.setNodeName} (the store — and so the
 * header and this row — update through `onSelfInfo` on success). Empty names
 * are rejected and the name is capped at {@link MAX_ADVERT_NAME_BYTES}; the
 * editor stays open on a failed write so the typed name isn't lost. Editing is
 * gated to a fully connected link, matching every other radio write.
 */
function NodeNameRow() {
  const { t } = useTranslation();
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const status = useMeshStore((s) => s.status);
  const { setNodeName } = useMeshCore();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  const currentName = selfInfo?.name ?? '';
  // Writes only land on a fully connected link (the hook gates on it too); show
  // the affordance disabled while reconnecting rather than hiding it.
  const editable = status === 'connected';

  const trimmed = value.trim();
  const byteCount = utf8ByteLength(trimmed);
  const overLimit = byteCount > MAX_ADVERT_NAME_BYTES;
  // Gate Save on `editable` too: if the link drops mid-edit the write would be
  // silently swallowed by the hook's connected-link check, with no toast.
  const canSave = editable && trimmed.length > 0 && !overLimit && !saving;

  const start = () => {
    setValue(currentName);
    setEditing(true);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const ok = await setNodeName(trimmed);
    setSaving(false);
    if (ok) setEditing(false);
  };

  const rowBorder = { borderColor: 'var(--border)' };

  if (!editing) {
    return (
      <div
        className='flex items-center justify-between gap-3 border-b py-1.5 text-xs'
        style={rowBorder}
      >
        <span className='shrink-0 text-(--text2)'>
          {t('settings.nodeName')}
        </span>
        <span className='flex min-w-0 items-center gap-1.5'>
          <span className='truncate font-semibold'>
            {currentName || t('common.unknown')}
          </span>
          <button
            onClick={start}
            disabled={!editable}
            aria-label={t('settings.editName')}
            title={t('settings.editName')}
            className='shrink-0 text-(--text2) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-(--text2)'
          >
            <Pencil size={13} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div
      className='flex flex-col gap-1.5 border-b py-1.5 text-xs'
      style={rowBorder}
    >
      <div className='flex items-center gap-2'>
        <span className='shrink-0 text-(--text2)'>
          {t('settings.nodeName')}
        </span>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            else if (e.key === 'Escape') setEditing(false);
          }}
          aria-label={t('settings.nodeName')}
          className='min-w-0 flex-1 rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-xs text-(--text) outline-none focus:border-(--accent)'
        />
        <span
          className={`shrink-0 text-[11px] ${
            overLimit
              ? 'text-(--red)'
              : byteCount > MAX_ADVERT_NAME_BYTES - 6
                ? 'text-(--yellow)'
                : 'text-(--text2)'
          }`}
        >
          {byteCount}/{MAX_ADVERT_NAME_BYTES}
        </span>
      </div>
      <div className='flex justify-end gap-2'>
        <button
          onClick={() => setEditing(false)}
          className='rounded-md px-2.5 py-1 text-xs text-(--text) hover:bg-(--surface)'
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={() => void save()}
          disabled={!canSave}
          className='rounded-md bg-(--accent) px-2.5 py-1 text-xs font-semibold text-white hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--accent)'
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

/**
 * The Location section: sets this radio's advertised coordinate, either typed
 * directly or picked on the map. Values are decimal degrees; {@link SelfInfo}
 * already reports them in degrees (unlike contacts), so they seed the inputs
 * as-is and `0`/unset shows blank. The editor stays populated after a failed
 * write so the values aren't lost, and it consumes a coordinate handed back by
 * the map picker via the store's one-shot `pendingLocation`. Gated to a fully
 * connected link, matching every other radio write.
 */
function LocationCard() {
  const { t } = useTranslation();
  const status = useMeshStore((s) => s.status);
  const advLocPolicy = useMeshStore((s) => s.selfInfo?.advLocPolicy);
  const { setLocation, setSharePosition } = useMeshCore();

  const fmtDeg = (v?: number) => (v ? String(v) : '');
  // Seed from a coordinate the map picker just handed back (the store's
  // one-shot `pendingLocation`), else this radio's current advertised location.
  // The card remounts on the return from the map, so reading it at init works.
  const [latStr, setLatStr] = useState(() => {
    const p = useMeshStore.getState().pendingLocation;
    return p ? String(p.lat) : fmtDeg(useMeshStore.getState().selfInfo?.advLat);
  });
  const [lonStr, setLonStr] = useState(() => {
    const p = useMeshStore.getState().pendingLocation;
    return p ? String(p.lon) : fmtDeg(useMeshStore.getState().selfInfo?.advLon);
  });
  const [saving, setSaving] = useState(false);
  const [savingShare, setSavingShare] = useState(false);

  // Clear the consumed one-shot signal so a later remount seeds from the live
  // location, not a stale pick. Touches only the store, never local state.
  useEffect(() => {
    if (useMeshStore.getState().pendingLocation) {
      useMeshStore.getState().clearPendingLocation();
    }
  }, []);

  // Writes only land on a fully connected link (the hook gates on it too); show
  // the affordance disabled while reconnecting rather than hiding it.
  const editable = status === 'connected';

  // `Number` (not `parseFloat`) so trailing junk like "12abc" is rejected as
  // NaN rather than silently parsed to 12, matching RadioSettings' inputs.
  const latNum = Number(latStr);
  const lonNum = Number(lonStr);
  const latValid =
    latStr.trim() !== '' &&
    Number.isFinite(latNum) &&
    latNum >= ADVERT_LAT_MIN &&
    latNum <= ADVERT_LAT_MAX;
  const lonValid =
    lonStr.trim() !== '' &&
    Number.isFinite(lonNum) &&
    lonNum >= ADVERT_LON_MIN &&
    lonNum <= ADVERT_LON_MAX;
  const canSave = editable && latValid && lonValid && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    await setLocation(latNum, lonNum);
    setSaving(false);
  };

  // Any non-`NONE` policy attaches a location; the app only ever writes the
  // `PREFS` (stored coordinate) variant, matching the firmware default. An
  // unknown policy (older firmware's short `SELF_INFO`) reads as not sharing so
  // the toggle starts from the off baseline rather than falsely showing on.
  const sharing =
    advLocPolicy !== undefined && advLocPolicy !== ADVERT_LOC_POLICY.NONE;
  const toggleShare = async () => {
    if (!editable || savingShare) return;
    setSavingShare(true);
    await setSharePosition(!sharing);
    setSavingShare(false);
  };

  return (
    <Card
      title={t('settings.section.location')}
      className='col-span-2'
      section='location'
    >
      <p className='mb-3 text-xs text-(--text2)'>
        {t('settings.locationHint')}
      </p>
      <div className='flex gap-3'>
        <div className='flex flex-1 flex-col gap-1 text-xs'>
          <label className='text-(--text2)'>{t('settings.latitude')}</label>
          <input
            value={latStr}
            onChange={(e) => setLatStr(e.target.value)}
            inputMode='decimal'
            placeholder='0.000000'
            aria-label={t('settings.latitude')}
            className={`min-w-0 rounded-md border bg-(--surface) px-2 py-1 text-xs text-(--text) outline-none focus:border-(--accent) ${
              latStr.trim() !== '' && !latValid
                ? 'border-(--red)'
                : 'border-(--border-control)'
            }`}
          />
        </div>
        <div className='flex flex-1 flex-col gap-1 text-xs'>
          <label className='text-(--text2)'>{t('settings.longitude')}</label>
          <input
            value={lonStr}
            onChange={(e) => setLonStr(e.target.value)}
            inputMode='decimal'
            placeholder='0.000000'
            aria-label={t('settings.longitude')}
            className={`min-w-0 rounded-md border bg-(--surface) px-2 py-1 text-xs text-(--text) outline-none focus:border-(--accent) ${
              lonStr.trim() !== '' && !lonValid
                ? 'border-(--red)'
                : 'border-(--border-control)'
            }`}
          />
        </div>
      </div>
      <div className='mt-3 flex items-center justify-between gap-2'>
        <button
          onClick={() => useMeshStore.getState().startLocationPick()}
          className='rounded-md border border-(--border-control) px-3 py-1.5 text-xs text-(--text2) hover:text-(--text)'
        >
          {t('settings.setOnMap')}
        </button>
        <button
          onClick={() => void save()}
          disabled={!canSave}
          className='rounded-md bg-(--accent) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--accent)'
        >
          {t('common.save')}
        </button>
      </div>
      <button
        role='switch'
        aria-checked={sharing}
        disabled={!editable || savingShare}
        onClick={() => void toggleShare()}
        className='mt-3 flex w-full items-center justify-between gap-2 border-t border-(--border) pt-3 text-left text-xs text-(--text) disabled:cursor-not-allowed disabled:opacity-50'
      >
        <span>{t('settings.sharePosition')}</span>
        <span
          className='relative h-4 w-7 shrink-0 rounded-full transition-colors'
          style={{ background: sharing ? 'var(--accent)' : 'var(--border)' }}
        >
          <span
            className={`absolute top-0.5 h-3 w-3 rounded-full bg-(--bg) transition-all ${
              sharing ? 'left-3.5' : 'left-0.5'
            }`}
          />
        </span>
      </button>
    </Card>
  );
}

/**
 * The Device actions section: reboots the radio behind an inline confirmation.
 * Rebooting is destructive to the live link — the radio restarts and the
 * transport drops — so it's deliberately red-styled and a two-step action.
 * After {@link useMeshCore.rebootDevice} sends the command the link drops and
 * the hook's auto-reconnect loop recovers the session, so there's nothing to do
 * here but toast and let the reconnecting overlay take over. Gated to a fully
 * connected link, matching every other radio write.
 */
function RebootCard() {
  const { t } = useTranslation();
  const status = useMeshStore((s) => s.status);
  const client = useMeshStore((s) => s.client);
  const { rebootDevice } = useMeshCore();
  const [confirming, setConfirming] = useState(false);
  const [rebooting, setRebooting] = useState(false);

  // Mirrors canTransmit(): status flips to 'connected' before the post-init
  // hydrate finishes, so also require a live, open client handle.
  const connected = status === 'connected' && !!client && !client.closed;

  const reboot = async () => {
    setRebooting(true);
    await rebootDevice();
    setRebooting(false);
    setConfirming(false);
  };

  return (
    <Card
      title={t('settings.section.danger')}
      className='col-span-2'
      section='danger'
    >
      <p className='mb-3 text-xs text-(--text2)'>{t('settings.rebootHint')}</p>
      {confirming ? (
        <div className='flex items-center justify-between gap-3'>
          <span className='text-xs text-(--text2)'>
            {t('settings.rebootConfirm')}
          </span>
          <div className='flex shrink-0 gap-2'>
            <button
              onClick={() => setConfirming(false)}
              className='rounded-md px-3 py-1.5 text-xs text-(--text) hover:bg-(--surface)'
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => void reboot()}
              disabled={!connected || rebooting}
              className='rounded-md bg-(--red) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--red-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--red)'
            >
              {t('settings.rebootConfirmAction')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          disabled={!connected}
          className='rounded-md bg-(--red-dim) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--red-dim-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--red-dim)'
        >
          {t('settings.reboot')}
        </button>
      )}
    </Card>
  );
}

/**
 * A titled card for one settings group. `action` renders an optional control
 * (e.g. an Edit button) on the right of the card heading.
 *
 * @param section - deep-link anchor id, so the command palette can scroll to
 * and flash this card.
 */
function Card({
  title,
  action,
  className,
  section,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  section?: SettingsSection;
  children: React.ReactNode;
}) {
  return (
    <div
      id={section ? `settings-${section}` : undefined}
      className={`rounded-lg p-3.5 ${className ?? ''}`}
      style={{ background: 'var(--surface2)' }}
    >
      <div className='mb-2.5 flex items-center justify-between gap-2'>
        <h3 className='text-[11px] font-bold tracking-widest text-(--accent) uppercase'>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * A label/value row inside a {@link Card}.
 *
 * @param mono - render the value in monospace (for the public key).
 * @param copy - if set, shows a {@link CopyButton} that copies this string.
 */
function Row({
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
    <div
      className='flex items-center justify-between gap-3 border-b py-1.5 text-xs last:border-0'
      style={{ borderColor: 'var(--border)' }}
    >
      <span className='shrink-0 text-(--text2)'>{label}</span>
      <span className='flex min-w-0 items-center gap-1.5'>
        <span className={`font-semibold ${mono ? 'font-mono break-all' : ''}`}>
          {value}
        </span>
        {copy && <CopyButton value={copy} />}
      </span>
    </div>
  );
}
