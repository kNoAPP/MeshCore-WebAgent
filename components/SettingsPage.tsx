// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore, type SettingsSection } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useAdvertise } from '@/hooks/useAdvertise';
import { fmtNum, utf8ByteLength, contactShareUri, ADV_ICON } from '@/lib/utils';
import { flashTarget } from '@/lib/ui/flash';
import {
  MAX_ADVERT_NAME_BYTES,
  ADVERT_LAT_MIN,
  ADVERT_LAT_MAX,
  ADVERT_LON_MIN,
  ADVERT_LON_MAX,
  ADVERT_LOC_POLICY,
} from '@/lib/meshcore/constants';
import type { SelfInfo } from '@/types/meshcore';
import { Card as SharedCard, type CardProps } from './Card';
import { CopyButton } from './CopyButton';
import { ModalShell } from './ModalShell';
import { ShareCard } from './ShareCard';
import { RadioSettingsModal, radioFields } from './RadioSettings';
import { SaveStatusChip, useSaveStatus } from './SaveStatus';
import { AiSettingsBody } from './AiSettings';
import { AutomationSettingsBody } from './AutomationPanel';
import { SUPPORTED_UNIT_SYSTEMS, type UnitSystem } from '@/lib/units/config';
import {
  SUPPORTED_LOCALES,
  LOCALE_NAMES,
  type SupportedLocale,
} from '@/lib/i18n/config';

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
  const { applyRadioParams } = useMeshCore();
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
    flashTarget(el);
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
                className='rounded-md bg-(--accent-solid) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--accent-solid)'
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

          <DisplayCard />

          <Card
            title={t('settings.section.ai')}
            className='col-span-2'
            section='ai'
          >
            <AiSettingsBody />
          </Card>

          <Card
            title={t('settings.section.automation')}
            className='col-span-2'
            section='automation'
          >
            <AutomationSettingsBody />
          </Card>

          <RebootCard />
        </div>
      </div>

      {radioEditOpen && fields && (
        <RadioSettingsModal
          fields={fields}
          onApply={applyRadioParams}
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

// The store — and so the header and this row — updates through `onSelfInfo` on
// success; an invalid edit reverts to the last known name on blur.
function NodeNameRow() {
  const { t } = useTranslation();
  const selfInfo = useMeshStore((s) => s.selfInfo);
  const status = useMeshStore((s) => s.status);
  const { setNodeName } = useMeshCore();
  const { status: saveStatus, run: runSave } = useSaveStatus();

  const currentName = selfInfo?.name ?? '';
  const [draft, setDraft] = useState(currentName);
  // Re-seed the editable draft when the radio reports a new name (e.g. after a
  // successful write) without a useEffect, via React's render-time state reset.
  // A dirty draft is preserved: if the user has typed a newer name while an
  // earlier save is still in flight, that in-flight update must not clobber it.
  const [known, setKnown] = useState(currentName);
  if (currentName !== known) {
    setKnown(currentName);
    if (draft === known) setDraft(currentName);
  }

  // Writes only land on a fully connected link (the hook gates on it too); show
  // the field disabled while reconnecting rather than hiding it.
  const editable = status === 'connected';

  const trimmed = draft.trim();
  const byteCount = utf8ByteLength(trimmed);
  const overLimit = byteCount > MAX_ADVERT_NAME_BYTES;
  const valid = trimmed.length > 0 && !overLimit;

  // Commit on blur/Enter: push a valid, changed name, or revert an invalid edit
  // back to the last known name. On success, normalize the visible draft to the
  // trimmed value actually sent — otherwise a whitespace-only edit the radio
  // treats as unchanged (`currentName` never moves) would leave the field dirty
  // and resend on every blur. Skip the reconcile if the user kept typing.
  const commit = () => {
    if (draft === currentName) return;
    if (!editable || !valid) {
      setDraft(currentName);
      return;
    }
    const submitted = draft;
    void runSave(() => setNodeName(trimmed)).then((ok) => {
      if (ok) setDraft((cur) => (cur === submitted ? trimmed : cur));
    });
  };

  return (
    <div
      className='flex items-center justify-between gap-3 border-b py-1.5 text-xs'
      style={{ borderColor: 'var(--border)' }}
    >
      <span className='shrink-0 text-(--text2)'>{t('settings.nodeName')}</span>
      <div className='flex shrink-0 items-center gap-2'>
        <div
          className={`field-group flex w-52 items-center overflow-hidden rounded-md border bg-(--surface) focus-within:border-(--accent) ${
            !valid && draft.trim() !== ''
              ? 'border-(--red)'
              : 'border-(--border-control)'
          } ${!editable ? 'opacity-60' : ''}`}
        >
          <input
            type='text'
            value={draft}
            disabled={!editable}
            aria-label={t('settings.nodeName')}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className='w-full min-w-0 bg-transparent px-2 py-1 text-xs text-(--text) outline-none'
          />
          <span
            className={`border-l border-(--border-control) px-1.5 py-1 text-[11px] whitespace-nowrap ${
              overLimit ? 'text-(--red)' : 'text-(--text2)'
            }`}
          >
            {byteCount}/{MAX_ADVERT_NAME_BYTES}
          </span>
        </div>
        <SaveStatusChip status={saveStatus} />
      </div>
    </div>
  );
}

// The source is stored on the radio as its `gps` custom var — the same field
// the official app's Position Settings → GPS Mode uses — so it round-trips
// independently of whether location is currently advertised.
const LOCATION_SOURCES = [
  { useGps: false, label: 'settings.locationSourceFixed' },
  { useGps: true, label: 'settings.locationSourceGps' },
] as const;

// Two independent controls: the advert location policy (`NONE` vs. a
// location-bearing policy) and the radio's `gps` custom var (Fixed vs. the GPS
// module). The fixed coordinate is stored via `SET_ADVERT_LATLON` independently
// of both, so it can be set without being advertised. Values are decimal
// degrees — `SelfInfo` already reports them in degrees, unlike contacts.
function LocationCard() {
  const { t } = useTranslation();
  const status = useMeshStore((s) => s.status);
  const advLocPolicy = useMeshStore((s) => s.selfInfo?.advLocPolicy);
  const hasGps = useMeshStore((s) => s.deviceInfo?.hasGps ?? false);
  const gpsEnabled = useMeshStore((s) => s.deviceInfo?.gpsEnabled ?? false);
  const { setLocation, setLocationPolicy, setLocationSource } = useMeshCore();

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
  const { status: coordStatus, run: runCoordSave } = useSaveStatus();
  const { status: sourceStatus, run: runSourceSave } = useSaveStatus();
  const { status: advertiseStatus, run: runAdvertiseSave } = useSaveStatus();
  const savingSource = sourceStatus === 'saving';
  const savingAdvertise = advertiseStatus === 'saving';
  // Last coordinate successfully written to the radio, so a blur that changed
  // nothing (or a re-blur of the same value) doesn't re-issue the write. Seeded
  // from the device's stored coordinate — not any pending map pick — and only
  // advanced on a confirmed save, so a failed write can be retried.
  const lastSaved = useRef({
    lat: fmtDeg(useMeshStore.getState().selfInfo?.advLat),
    lon: fmtDeg(useMeshStore.getState().selfInfo?.advLon),
  });

  // A coordinate handed back by the map picker is saved immediately on mount —
  // choosing a point on the map is itself the commit, so there's no Save step.
  useEffect(() => {
    const pending = useMeshStore.getState().pendingLocation;
    if (!pending) return;
    useMeshStore.getState().clearPendingLocation();
    const st = useMeshStore.getState();
    const connected = st.status === 'connected';
    const gps =
      (st.deviceInfo?.gpsEnabled ?? false) ||
      st.selfInfo?.advLocPolicy === ADVERT_LOC_POLICY.SHARE;
    if (!connected || gps) return;
    void runCoordSave(() => setLocation(pending.lat, pending.lon)).then(
      (ok) => {
        if (ok) {
          lastSaved.current = {
            lat: String(pending.lat),
            lon: String(pending.lon),
          };
        }
      },
    );
  }, [runCoordSave, setLocation]);

  // Writes only land on a fully connected link (the hook gates on it too); show
  // the affordance disabled while reconnecting rather than hiding it.
  const editable = status === 'connected';

  // Whether the radio attaches any location to its adverts. An unknown policy
  // (older firmware's short SELF_INFO) reads as off.
  const advertising =
    advLocPolicy !== undefined && advLocPolicy !== ADVERT_LOC_POLICY.NONE;

  // The radio's location source, read straight from its GPS module state: on
  // means the live fix is advertised, off means the fixed coordinate below is.
  // A radio already advertising `SHARE` counts as GPS even if its `gps` var
  // never read back, so the source is never misrepresented as Fixed.
  const usingGps = gpsEnabled || advLocPolicy === ADVERT_LOC_POLICY.SHARE;

  // Offer the Fixed/GPS picker on GPS-capable radios, or on one already
  // sourcing from GPS; otherwise a lone Fixed option is a pointless picker, so
  // hide it and just show the coordinate editor.
  const showSource = hasGps || usingGps;

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
  const canSave = editable && !usingGps && latValid && lonValid;

  // Commit typed coordinates on blur/Enter: a valid, changed pair is written
  // straight to the radio (no Save button); an invalid edit is left in place,
  // flagged red, for the user to fix.
  const commitCoords = async () => {
    if (!canSave) return;
    if (latStr === lastSaved.current.lat && lonStr === lastSaved.current.lon) {
      return;
    }
    const ok = await runCoordSave(() => setLocation(latNum, lonNum));
    if (ok) lastSaved.current = { lat: latStr, lon: lonStr };
  };

  // Flip the advert policy between off (`NONE`) and a location-bearing policy
  // matching the current source, so peers get the right kind of coordinate.
  const toggleAdvertise = async () => {
    if (!editable || savingAdvertise) return;
    await runAdvertiseSave(() =>
      setLocationPolicy(
        advertising
          ? ADVERT_LOC_POLICY.NONE
          : usingGps
            ? ADVERT_LOC_POLICY.SHARE
            : ADVERT_LOC_POLICY.PREFS,
      ),
    );
  };

  // Switch the Fixed/GPS source by toggling the radio's GPS module. The store
  // updates reactively via `onDeviceInfo` on success, so there's no local
  // choice to keep; a failed write leaves the radio (and the UI) untouched.
  const selectSource = async (nextUseGps: boolean) => {
    if (!editable || savingSource || nextUseGps === usingGps) return;
    await runSourceSave(() => setLocationSource(nextUseGps));
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
      <button
        role='switch'
        aria-checked={advertising}
        disabled={!editable || savingAdvertise}
        onClick={() => void toggleAdvertise()}
        className='flex w-full items-center justify-between gap-2 text-left text-xs text-(--text) disabled:cursor-not-allowed disabled:opacity-50'
      >
        <span>{t('settings.advertiseLocation')}</span>
        <span className='flex items-center gap-2'>
          <span
            className='relative h-4 w-7 shrink-0 rounded-full transition-colors'
            style={{
              background: advertising ? 'var(--accent)' : 'var(--border)',
            }}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-(--bg) transition-all ${
                advertising ? 'left-3.5' : 'left-0.5'
              }`}
            />
          </span>
          <SaveStatusChip status={advertiseStatus} />
        </span>
      </button>
      {showSource && (
        <div className='mt-3'>
          <div className='flex w-full items-start justify-between gap-2 text-xs text-(--text)'>
            <div className='flex flex-col gap-1'>
              <span>{t('settings.locationSource')}</span>
              <span className='text-(--text2)'>
                {t(
                  usingGps
                    ? 'settings.locationGpsHint'
                    : 'settings.locationFixedHint',
                )}
              </span>
            </div>
            <span className='flex items-center gap-2'>
              <div
                role='radiogroup'
                aria-label={t('settings.locationSource')}
                className='inline-flex rounded-md border border-(--border-control) p-0.5'
              >
                {LOCATION_SOURCES.map(({ useGps, label }) => {
                  const active = usingGps === useGps;
                  return (
                    <button
                      key={label}
                      role='radio'
                      aria-checked={active}
                      disabled={!editable || savingSource}
                      onClick={() => void selectSource(useGps)}
                      className={`rounded px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? 'bg-(--accent-solid) font-semibold text-white'
                          : 'text-(--text2) hover:text-(--text)'
                      }`}
                    >
                      {t(label)}
                    </button>
                  );
                })}
              </div>
              <SaveStatusChip status={sourceStatus} />
            </span>
          </div>
        </div>
      )}
      <div className='mt-3 flex items-end gap-3'>
        <div className='flex flex-1 flex-col gap-1 text-xs'>
          <label className='text-(--text)'>{t('settings.latitude')}</label>
          <input
            value={latStr}
            onChange={(e) => setLatStr(e.target.value)}
            onBlur={() => void commitCoords()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            disabled={usingGps}
            inputMode='decimal'
            placeholder='0.000000'
            aria-label={t('settings.latitude')}
            className={`min-w-0 rounded-md border bg-(--surface) px-2 py-1 text-xs text-(--text) outline-none focus:border-(--accent) disabled:cursor-not-allowed disabled:opacity-50 ${
              latStr.trim() !== '' && !latValid
                ? 'border-(--red)'
                : 'border-(--border-control)'
            }`}
          />
        </div>
        <div className='flex flex-1 flex-col gap-1 text-xs'>
          <label className='text-(--text)'>{t('settings.longitude')}</label>
          <input
            value={lonStr}
            onChange={(e) => setLonStr(e.target.value)}
            onBlur={() => void commitCoords()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            disabled={usingGps}
            inputMode='decimal'
            placeholder='0.000000'
            aria-label={t('settings.longitude')}
            className={`min-w-0 rounded-md border bg-(--surface) px-2 py-1 text-xs text-(--text) outline-none focus:border-(--accent) disabled:cursor-not-allowed disabled:opacity-50 ${
              lonStr.trim() !== '' && !lonValid
                ? 'border-(--red)'
                : 'border-(--border-control)'
            }`}
          />
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <button
            onClick={() => useMeshStore.getState().startLocationPick()}
            disabled={usingGps}
            className='rounded-md border border-(--border-control) px-3 py-1 text-xs text-(--text2) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-(--text2)'
          >
            {t('settings.setOnMap')}
          </button>
          <SaveStatusChip status={coordStatus} />
        </div>
      </div>
    </Card>
  );
}

// Rebooting drops the live link, and the hook's auto-reconnect loop recovers
// the session, so there's nothing to do here but toast and let the reconnecting
// overlay take over.
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
              className='rounded-md bg-(--red-solid) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--red-hover) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-(--red-solid)'
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

function DisplayCard() {
  const { t } = useTranslation();
  const locale = useMeshStore((s) => s.locale);
  const setLocale = useMeshStore((s) => s.setLocale);
  const unitSystem = useMeshStore((s) => s.unitSystem);
  const setUnitSystem = useMeshStore((s) => s.setUnitSystem);
  const showFullPublicKeys = useMeshStore((s) => s.showFullPublicKeys);
  const setShowFullPublicKeys = useMeshStore((s) => s.setShowFullPublicKeys);

  const selectClass =
    'cursor-pointer rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-xs text-(--text) transition-colors hover:border-(--accent) focus:border-(--accent) focus:outline-none';

  return (
    <Card
      title={t('settings.section.display')}
      className='col-span-2'
      section='display'
    >
      <div
        className='flex items-center justify-between gap-3 border-b py-1.5 text-xs'
        style={{ borderColor: 'var(--border)' }}
      >
        <span className='shrink-0 text-(--text2)'>{t('header.language')}</span>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as SupportedLocale)}
          aria-label={t('header.language')}
          className={selectClass}
        >
          {SUPPORTED_LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      </div>
      <div className='flex items-center justify-between gap-3 py-1.5 text-xs'>
        <span className='shrink-0 text-(--text2)'>{t('settings.units')}</span>
        <select
          value={unitSystem}
          onChange={(e) => setUnitSystem(e.target.value as UnitSystem)}
          aria-label={t('settings.units')}
          className={selectClass}
        >
          {SUPPORTED_UNIT_SYSTEMS.map((u) => (
            <option key={u} value={u}>
              {t(`settings.units_${u}`)}
            </option>
          ))}
        </select>
      </div>
      <button
        role='switch'
        aria-checked={showFullPublicKeys}
        onClick={() => setShowFullPublicKeys(!showFullPublicKeys)}
        className='flex w-full items-center justify-between gap-3 border-t py-1.5 text-left text-xs text-(--text)'
        style={{ borderColor: 'var(--border)' }}
      >
        <span className='shrink-0 text-(--text2)'>
          {t('settings.showFullPublicKeys')}
        </span>
        <span
          className='relative h-4 w-7 shrink-0 rounded-full transition-colors'
          style={{
            background: showFullPublicKeys ? 'var(--accent)' : 'var(--border)',
          }}
        >
          <span
            className={`absolute top-0.5 h-3 w-3 rounded-full bg-(--bg) transition-all ${
              showFullPublicKeys ? 'left-3.5' : 'left-0.5'
            }`}
          />
        </span>
      </button>
    </Card>
  );
}

// Keyed by settings section rather than a raw element id, so the command
// palette can scroll to and flash a card.
function Card({
  section,
  ...rest
}: Omit<CardProps, 'anchorId'> & { section?: SettingsSection }) {
  return (
    <SharedCard
      anchorId={section ? `settings-${section}` : undefined}
      {...rest}
    />
  );
}

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
