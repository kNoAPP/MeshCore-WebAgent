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

import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { fmtVoltage } from '@/lib/utils';

export function Header() {
  const { status, deviceName, battery, setStatsOpen } = useMeshStore();
  const { disconnect } = useMeshCore();
  const connected = status === 'connected';

  return (
    <header
      className='flex shrink-0 items-center gap-3 border-b px-4 py-2.5'
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      {/* Status dot */}
      <div
        className={`h-2 w-2 shrink-0 rounded-full ${
          connected
            ? 'bg-(--green) shadow-[0_0_6px_var(--green)]'
            : 'bg-(--red) shadow-[0_0_6px_var(--red)]'
        }`}
      />

      <h1 className='text-base font-bold tracking-tight'>
        Mesh<span className='text-(--accent)'>Core</span> Companion
      </h1>

      <span className='text-xs text-(--text2)'>
        {status === 'connecting'
          ? 'Connecting…'
          : status === 'connected'
            ? 'Connected'
            : 'Disconnected'}
      </span>

      {connected && (
        <>
          <span className='ml-auto text-sm font-semibold text-(--accent)'>
            {deviceName}
          </span>
          {battery && (
            <span className='text-xs text-(--text2)'>
              {fmtVoltage(battery.voltage)} 💾 {battery.usedKB}/
              {battery.totalKB}KB
            </span>
          )}
          <button
            onClick={() => setStatsOpen(true)}
            className='rounded-md border border-(--border) px-2.5 py-1 text-xs text-(--text2) transition-colors hover:border-(--accent) hover:text-(--accent)'
          >
            📊 Stats
          </button>
          <button
            onClick={disconnect}
            className='rounded-md border border-(--border) px-2.5 py-1 text-xs text-(--text2) transition-colors hover:border-(--red) hover:text-(--red)'
          >
            Disconnect
          </button>
        </>
      )}
    </header>
  );
}
