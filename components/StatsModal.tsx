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

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import type { StatsResult } from '@/types/meshcore';
import { fmtUptime, fmtAirtime, fmtVoltage } from '@/lib/utils';

/**
 * Device stats overlay. Fetches battery + all stats pages when opened (and on
 * Refresh), laid out as cards. Renders nothing while `statsOpen` is false.
 */
export function StatsModal() {
  const { t } = useTranslation();
  const { client, statsOpen, setStatsOpen, battery } = useMeshStore();
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-fetch when modal opens; only setState inside the .then callback (not
  // synchronously)
  useEffect(() => {
    if (!statsOpen || !client) return;
    let active = true;
    Promise.all([client.getStats(), client.getBattery()]).then(([s, b]) => {
      if (!active) return;
      setStats(s);
      if (b) useMeshStore.getState().setBattery(b);
    });
    return () => {
      active = false;
    };
  }, [statsOpen, client]);

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    const [s, b] = await Promise.all([client.getStats(), client.getBattery()]);
    setStats(s);
    if (b) useMeshStore.getState().setBattery(b);
    setLoading(false);
  }, [client]);

  if (!statsOpen) return null;

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center'
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setStatsOpen(false);
      }}
    >
      <div
        className='max-h-[85vh] w-135 max-w-[95vw] overflow-y-auto rounded-[10px] border p-7'
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {/* Header */}
        <div className='mb-5 flex items-center justify-between'>
          <h2 className='text-base font-bold'>{t('stats.title')}</h2>
          <button
            onClick={() => setStatsOpen(false)}
            className='text-lg leading-none text-(--text2) hover:text-(--text)'
          >
            ✕
          </button>
        </div>

        <div className='grid grid-cols-2 gap-4'>
          {battery && (
            <StatCard
              title={t('stats.card.storageBattery')}
              rows={[
                [t('stats.voltage'), fmtVoltage(battery.voltage)],
                [t('stats.used'), `${battery.usedKB.toLocaleString()} KB`],
                [t('stats.total'), `${battery.totalKB.toLocaleString()} KB`],
                [
                  t('stats.free'),
                  `${(battery.totalKB - battery.usedKB).toLocaleString()} KB`,
                ],
                [
                  t('stats.usage'),
                  `${battery.totalKB ? Math.round((battery.usedKB / battery.totalKB) * 100) : '?'}%`,
                ],
              ]}
            />
          )}
          {stats?.core && (
            <StatCard
              title={t('stats.card.core')}
              rows={[
                [t('stats.uptime'), fmtUptime(stats.core.uptimeSecs)],
                [t('stats.battery'), fmtVoltage(stats.core.battMv)],
                [t('stats.errors'), String(stats.core.errors)],
                [t('stats.queueLength'), String(stats.core.queueLen)],
              ]}
            />
          )}
          {stats?.radio && (
            <StatCard
              title={t('stats.card.radio')}
              rows={[
                [t('stats.noiseFloor'), `${stats.radio.noiseFloor} dBm`],
                [t('stats.lastRssi'), `${stats.radio.lastRssi} dBm`],
                [
                  t('stats.lastSnr'),
                  `${stats.radio.lastSnr > 0 ? '+' : ''}${stats.radio.lastSnr.toFixed(2)} dB`,
                ],
                [t('stats.txAirtime'), fmtAirtime(stats.radio.txAirSecs)],
                [t('stats.rxAirtime'), fmtAirtime(stats.radio.rxAirSecs)],
              ]}
            />
          )}
          {stats?.packets && (
            <StatCard
              title={t('stats.card.packets')}
              rows={[
                [t('stats.received'), stats.packets.recv.toLocaleString()],
                [t('stats.sent'), stats.packets.sent.toLocaleString()],
                [t('stats.floodTx'), stats.packets.floodTx.toLocaleString()],
                [t('stats.floodRx'), stats.packets.floodRx.toLocaleString()],
                [t('stats.directTx'), stats.packets.directTx.toLocaleString()],
                [t('stats.directRx'), stats.packets.directRx.toLocaleString()],
                ...(stats.packets.recvErrors != null
                  ? ([
                      [
                        t('stats.rxErrors'),
                        stats.packets.recvErrors.toLocaleString(),
                      ],
                    ] as [string, string][])
                  : []),
              ]}
            />
          )}
        </div>

        <div className='mt-4 flex justify-end'>
          <button
            onClick={refresh}
            disabled={loading}
            className='rounded-lg bg-(--accent) px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50'
          >
            {loading ? t('stats.refreshing') : t('stats.refresh')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A titled card rendering `[label, value]` rows for one stats group. */
function StatCard({
  title,
  rows,
}: {
  title: string;
  rows: [string, string][];
}) {
  return (
    <div className='rounded-lg p-3.5' style={{ background: 'var(--surface2)' }}>
      <div className='mb-2.5 text-[11px] font-bold tracking-widest text-(--accent) uppercase'>
        {title}
      </div>
      {rows.map(([label, val]) => (
        <div
          key={label}
          className='flex justify-between border-b py-1.5 text-xs last:border-0'
          style={{ borderColor: 'var(--border)' }}
        >
          <span className='text-(--text2)'>{label}</span>
          <span className='font-semibold'>{val}</span>
        </div>
      ))}
    </div>
  );
}
