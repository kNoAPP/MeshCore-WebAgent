// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useAdvertise } from '@/hooks/useAdvertise';
import {
  fmtVoltage,
  fmtNum,
  utf8ByteLength,
  contactShareUri,
  ADV_ICON,
} from '@/lib/utils';
import { MAX_ADVERT_NAME_BYTES } from '@/lib/meshcore/constants';
import type { SelfInfo } from '@/types/meshcore';
import { CopyButton } from './CopyButton';
import { ModalShell } from './ModalShell';
import { ShareCard } from './ShareCard';
import { RadioSettingsModal, radioFields } from './RadioSettings';

/**
 * Settings page: device identity, firmware, radio configuration, and a
 * storage/battery summary. Rendered by {@link AppShell} in place of the chat
 * pane while `view` is `'settings'`. The Identity section's node name is
 * editable inline ({@link NodeNameRow}), the Radio section opens the
 * {@link RadioSettingsModal} editor, and the Advertise section
 * ({@link AdvertiseCard}) announces this node to the mesh. The Device actions
 * section ({@link RebootCard}) reboots the radio behind an inline confirmation;
 * the dropped link recovers through the hook's auto-reconnect loop.
 */
export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const {
    status,
    selfInfo,
    deviceInfo: device,
    battery,
    setView,
  } = useMeshStore();

  // Stats auto-fetches over the link on activation, so the shortcut to it is
  // gated while reconnecting — matching the header's Stats tab.
  const reconnecting = status === 'reconnecting';

  const [radioEditOpen, setRadioEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
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
          <Card title={t('settings.section.device')}>
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

          <Card title={t('settings.section.storage')} className='col-span-2'>
            {battery ? (
              <>
                <Row
                  label={t('settings.voltage')}
                  value={fmtVoltage(battery.voltage)}
                />
                <Row
                  label={t('settings.storageUsed')}
                  value={t('settings.kbUsage', {
                    used: num(battery.usedKB),
                    total: num(battery.totalKB),
                  })}
                />
              </>
            ) : (
              <p className='py-1.5 text-xs text-(--text2)'>
                {t('settings.noBattery')}
              </p>
            )}
            <button
              onClick={() => setView('stats')}
              disabled={reconnecting}
              className='mt-2 text-xs text-(--accent) hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50'
            >
              {t('settings.viewStats')}
            </button>
          </Card>

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
    <Card title={t('settings.section.danger')} className='col-span-2'>
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
 */
function Card({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
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
