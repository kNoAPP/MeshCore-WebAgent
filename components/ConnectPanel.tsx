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

import { useState } from 'react';
import { useMeshCore } from '@/hooks/useMeshCore';

type Tab = 'usb' | 'ble' | 'wifi';

export function ConnectPanel() {
  const [tab, setTab] = useState<Tab>('usb');
  const [baud, setBaud] = useState(115200);
  const [wifiUrl, setWifiUrl] = useState('ws://192.168.1.100:5000');
  const [busy, setBusy] = useState(false);
  const { connectUSB, connectBLE, connectWiFi } = useMeshCore();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

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
            <InfoBox>
              Uses Web Serial API (Chrome / Edge). Connect your MeshCore
              Companion via USB cable.
            </InfoBox>
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
              disabled={busy}
              onClick={() => run(() => connectUSB(baud))}
            >
              {busy ? 'Connecting…' : 'Connect USB'}
            </PrimaryButton>
          </div>
        )}

        {/* BLE */}
        {tab === 'ble' && (
          <div className='flex flex-col gap-3'>
            <InfoBox>
              Uses Web Bluetooth API (Chrome). Scans for devices advertising the
              Nordic UART service.
            </InfoBox>
            <PrimaryButton disabled={busy} onClick={() => run(connectBLE)}>
              {busy ? 'Scanning…' : 'Scan & Connect BLE'}
            </PrimaryButton>
          </div>
        )}

        {/* WiFi */}
        {tab === 'wifi' && (
          <div className='flex flex-col gap-3'>
            <InfoBox>
              Connects via WebSocket. Same frame protocol as USB serial.
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
