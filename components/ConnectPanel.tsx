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

const SYNC_STAGE_LABEL: Record<SyncProgress['stage'], string> = {
  device: 'Reading device info',
  contacts: 'Syncing contacts',
  channels: 'Syncing channels',
  messages: 'Syncing messages',
};

function syncDetail({ stage, current, total }: SyncProgress): string {
  if (stage === 'messages') return current ? ` (${current} received)` : '';
  if (current != null && total != null) return ` (${current} of ${total})`;
  return '';
}

// Snapshot must be cached — useSyncExternalStore compares by reference
let transportSupport: TransportSupport | null = null;
function getTransportSupport(): TransportSupport {
  transportSupport ??= {
    usb: 'serial' in navigator,
    ble: 'bluetooth' in navigator,
  };
  return transportSupport;
}
const subscribeNever = () => () => {};
const getServerSupport = () => null;

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

  if (status === 'connecting' && syncProgress) {
    const { stage, percent } = syncProgress;
    const stageIdx = SYNC_STAGES.indexOf(stage);
    return (
      <div className='flex flex-1 items-center justify-center'>
        <div
          className='w-105 max-w-[95vw] rounded-[10px] border p-8'
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <h2 className='mb-1 text-xl font-bold'>Syncing with radio</h2>
          <p className='mb-5 text-sm text-(--text2)'>
            {deviceName
              ? `Loading stored data from ${deviceName}.`
              : 'Loading stored data from your companion radio.'}
          </p>
          <div className='mb-1.5 flex items-baseline justify-between gap-3'>
            <span className='text-sm'>
              {SYNC_STAGE_LABEL[stage]}
              {syncDetail(syncProgress)}…
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
                  {SYNC_STAGE_LABEL[s]}
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
        <h2 className='mb-1 text-xl font-bold'>Connect to MeshCore</h2>
        <p className='mb-5 text-sm text-(--text2)'>
          {' '}
          Connect via USB, Bluetooth, or WiFi to your Companion Radio.{' '}
        </p>

        {/* Tabs */}
        <div
          className='mb-5 flex overflow-hidden rounded-lg border'
          style={{ borderColor: 'var(--border)' }}
        >
          {(['usb', 'ble', 'wifi'] as Tab[]).map((t, i) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-[13px] font-medium transition-all
                ${i > 0 ? 'border-l' : ''}
                ${tab === t ? 'bg-(--accent) text-white' : 'text-(--text2) hover:text-(--text)'}`}
              style={i > 0 ? { borderColor: 'var(--border)' } : {}}
            >
              {t === 'usb' ? '🔌 USB' : t === 'ble' ? '📡 BLE' : '🌐 WiFi'}
            </button>
          ))}
        </div>

        {/* USB */}
        {tab === 'usb' && (
          <div className='flex flex-col gap-3'>
            {usbSupported ? (
              <InfoBox>
                Uses Web Serial API (Chrome / Edge). Connect your MeshCore
                Companion via USB cable.
              </InfoBox>
            ) : (
              <WarningBox>
                USB is not supported in this browser. Use a supported browser
                like Chrome to connect over USB.
              </WarningBox>
            )}
            <label className='flex flex-col gap-1'>
              <span className='text-xs text-(--text2)'>Baud Rate</span>
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
              {busy ? 'Connecting…' : 'Connect USB'}
            </PrimaryButton>
          </div>
        )}

        {/* BLE */}
        {tab === 'ble' && (
          <div className='flex flex-col gap-3'>
            {bleSupported ? (
              <InfoBox>
                Uses Web Bluetooth API (Chrome). Scans for devices advertising
                the Nordic UART service.
                <div className='mt-1.5'>
                  Don&apos;t see your companion? It may already be connected to
                  another device, like your phone&apos;s MeshCore app.
                  Disconnect it there first.
                </div>
              </InfoBox>
            ) : (
              <WarningBox>
                Bluetooth is not supported in this browser. Use a supported
                browser like Chrome to connect over BLE.
              </WarningBox>
            )}
            <PrimaryButton
              disabled={busy || !bleSupported}
              onClick={() => run(connectBLE)}
            >
              {busy ? 'Scanning…' : 'Scan & Connect BLE'}
            </PrimaryButton>
          </div>
        )}

        {/* WiFi */}
        {tab === 'wifi' && (
          <div className='flex flex-col gap-3'>
            <InfoBox>
              Connects via WebSocket. Same frame protocol as USB serial.
              <div className='mt-1.5'>
                Can&apos;t reach your companion? It may already be connected to
                another device, like your phone&apos;s MeshCore app. Disconnect
                it there first.
              </div>
            </InfoBox>
            <label className='flex flex-col gap-1'>
              <span className='text-xs text-(--text2)'>WebSocket URL</span>
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
              {busy ? 'Connecting…' : 'Connect WiFi'}
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
