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

import { useState, useSyncExternalStore } from 'react';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useMeshStore } from '@/store/meshStore';
import { useTranslation } from '@/hooks/useTranslation';
import type { SyncProgress } from '@/types/meshcore';

type Tab = 'usb' | 'ble' | 'wifi';

interface TransportSupport {
  usb: boolean;
  ble: boolean;
}

const SYNC_STAGES: SyncProgress['stage'][] = [
  'device',
  'contacts',
  'channels',
  'messages',
];

/**
 * Builds the parenthetical detail after a sync stage label (e.g. ` (3 of 8)`).
 */
function syncDetail(
  { stage, current, total }: SyncProgress,
  t: (
    key: import('@/lib/i18n').TranslationKey,
    vars?: Record<string, string | number>,
  ) => string,
): string {
  if (stage === 'messages')
    return current ? ` ${t('syncDetailReceived', { n: current })}` : '';
  if (current != null && total != null)
    return ` ${t('syncDetailOf', { current, total })}`;
  return '';
}

// Snapshot must be cached — useSyncExternalStore compares by reference
let transportSupport: TransportSupport | null = null;
/**
 * Feature-detects USB/BLE support, memoized so the snapshot stays
 * reference-stable.
 */
function getTransportSupport(): TransportSupport {
  transportSupport ??= {
    usb: 'serial' in navigator,
    ble: 'bluetooth' in navigator,
  };
  return transportSupport;
}
const subscribeNever = () => () => {};
const getServerSupport = () => null;

/**
 * The pre-connection screen: USB/BLE/WiFi transport tabs with their inputs, or
 * the live sync-progress view while connecting. Shown until a radio is
 * connected.
 */
export function ConnectPanel() {
  const [tab, setTab] = useState<Tab>('usb');
  const [baud, setBaud] = useState(115200);
  const [wifiUrl, setWifiUrl] = useState('ws://192.168.1.100:5000');
  const [busy, setBusy] = useState(false);
  // null during the prerender — the static export has no `navigator`
  const support = useSyncExternalStore(
    subscribeNever,
    getTransportSupport,
    getServerSupport,
  );
  const { connectUSB, connectBLE, connectWiFi } = useMeshCore();
  const status = useMeshStore((s) => s.status);
  const syncProgress = useMeshStore((s) => s.syncProgress);
  const deviceName = useMeshStore((s) => s.deviceName);
  const { t } = useTranslation();

  const usbSupported = support?.usb ?? true;
  const bleSupported = support?.ble ?? true;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  /** Stage key → translation key mapping. */
  const stageLabelKey: Record<
    SyncProgress['stage'],
    import('@/lib/i18n').TranslationKey
  > = {
    device: 'syncStageDevice',
    contacts: 'syncStageContacts',
    channels: 'syncStageChannels',
    messages: 'syncStageMessages',
  };

  if (status === 'connecting' && syncProgress) {
    const { stage, percent } = syncProgress;
    const stageIdx = SYNC_STAGES.indexOf(stage);
    return (
      <div className='flex flex-1 items-center justify-center'>
        <div
          className='w-105 max-w-[95vw] rounded-[10px] border p-8'
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <h2 className='mb-1 text-xl font-bold'>{t('syncTitle')}</h2>
          <p className='mb-5 text-sm text-(--text2)'>
            {deviceName
              ? t('syncSubtitleNamed', { name: deviceName })
              : t('syncSubtitleUnnamed')}
          </p>
          <div className='mb-1.5 flex items-baseline justify-between gap-3'>
            <span className='text-sm'>
              {t(stageLabelKey[stage])}
              {syncDetail(syncProgress, t)}\u2026
            </span>
            <span className='text-xs text-(--text2)'>{percent}%</span>
          </div>
          <div
            className='h-2 w-full overflow-hidden rounded-full'
            style={{ background: 'var(--border)' }}
          >
            <div
              className='h-full rounded-full bg-(--accent) transition-[width] duration-300'
              style={{ width: `${percent}%` }}
            />
          </div>
          <ul className='mt-4 flex flex-col gap-1.5 text-xs'>
            {SYNC_STAGES.map((s, i) => {
              const done = i < stageIdx || percent === 100;
              const active = i === stageIdx && percent < 100;
              return (
                <li
                  key={s}
                  className='flex items-center gap-2'
                  style={{
                    color: done
                      ? 'var(--green)'
                      : active
                        ? 'var(--text)'
                        : 'var(--text2)',
                  }}
                >
                  <span className='w-3 text-center'>
                    {done ? '✓' : active ? '●' : '○'}
                  </span>
                  {t(stageLabelKey[s])}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-1 items-center justify-center'>
      {' '}
      <div
        className='w-105 max-w-[95vw] rounded-[10px] border p-8'
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <h2 className='mb-1 text-xl font-bold'>{t('connectTitle')}</h2>
        <p className='mb-5 text-sm text-(--text2)'>{t('connectSubtitle')}</p>

        {/* Tabs */}
        <div
          className='mb-5 flex overflow-hidden rounded-lg border'
          style={{ borderColor: 'var(--border)' }}
        >
          {(['usb', 'ble', 'wifi'] as Tab[]).map((tabId, i) => (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              className={`flex-1 py-2 text-[13px] font-medium transition-all
                ${i > 0 ? 'border-l' : ''}
                ${tab === tabId ? 'bg-(--accent) text-white' : 'text-(--text2) hover:text-(--text)'}`}
              style={i > 0 ? { borderColor: 'var(--border)' } : {}}
            >
              {tabId === 'usb'
                ? t('tabUSB')
                : tabId === 'ble'
                  ? t('tabBLE')
                  : t('tabWifi')}
            </button>
          ))}
        </div>

        {/* USB */}
        {tab === 'usb' && (
          <div className='flex flex-col gap-3'>
            {usbSupported ? (
              <InfoBox>{t('usbInfo')}</InfoBox>
            ) : (
              <WarningBox>{t('usbUnsupported')}</WarningBox>
            )}
            <label className='flex flex-col gap-1'>
              <span className='text-xs text-(--text2)'>
                {t('labelBaudRate')}
              </span>
              <input
                type='number'
                value={baud}
                onChange={(e) => setBaud(Number(e.target.value))}
                className='input-field'
              />
            </label>
            <PrimaryButton
              disabled={busy || !usbSupported}
              onClick={() => run(() => connectUSB(baud))}
            >
              {busy ? t('btnConnecting') : t('btnConnectUSB')}
            </PrimaryButton>
          </div>
        )}

        {/* BLE */}
        {tab === 'ble' && (
          <div className='flex flex-col gap-3'>
            {bleSupported ? (
              <InfoBox>
                {t('bleInfo')}
                <div className='mt-1.5'>{t('bleInfoExtra')}</div>
              </InfoBox>
            ) : (
              <WarningBox>{t('bleUnsupported')}</WarningBox>
            )}
            <PrimaryButton
              disabled={busy || !bleSupported}
              onClick={() => run(connectBLE)}
            >
              {busy ? t('btnScanning') : t('btnScanBLE')}
            </PrimaryButton>
          </div>
        )}

        {/* WiFi */}
        {tab === 'wifi' && (
          <div className='flex flex-col gap-3'>
            <InfoBox>
              {t('wifiInfo')}
              <div className='mt-1.5'>{t('wifiInfoExtra')}</div>
            </InfoBox>
            <label className='flex flex-col gap-1'>
              <span className='text-xs text-(--text2)'>
                {t('labelWebSocketURL')}
              </span>
              <input
                type='text'
                value={wifiUrl}
                onChange={(e) => setWifiUrl(e.target.value)}
                placeholder='ws://192.168.1.100:5000'
                className='input-field'
              />
            </label>
            <PrimaryButton
              disabled={busy || !wifiUrl.startsWith('ws')}
              onClick={() => run(() => connectWiFi(wifiUrl))}
            >
              {busy ? t('btnConnecting') : t('btnConnectWifi')}
            </PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className='rounded-lg px-3 py-2.5 text-xs text-(--text2)'
      style={{
        background: 'rgba(79,142,247,0.08)',
        border: '1px solid rgba(79,142,247,0.2)',
      }}
    >
      {' '}
      {children}{' '}
    </div>
  );
}

function WarningBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className='rounded-lg px-3 py-2.5 text-xs'
      style={{
        background: 'rgba(250,204,21,0.08)',
        border: '1px solid rgba(250,204,21,0.3)',
        color: 'var(--yellow)',
      }}
    >
      ⚠️ {children}
    </div>
  );
}

function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className='w-full rounded-lg bg-(--accent) py-2.5 text-sm font-semibold
text-white transition-opacity hover:opacity-90
disabled:cursor-not-allowed disabled:opacity-45'
    >
      {' '}
      {children}{' '}
    </button>
  );
}
