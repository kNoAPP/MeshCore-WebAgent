// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import type { StatsResult } from '@/types/meshcore';
import { CLOCK_SKEW_THRESHOLD_SECS } from '@/lib/meshcore/client';
import { fmtUptime, fmtAirtime, fmtVoltage, fmtSkew } from '@/lib/utils';

/**
 * Device stats overlay. Fetches battery + all stats pages when opened (and on
 * Refresh), laid out as cards. Renders nothing while `statsOpen` is false.
 */
export function StatsModal() {
  const { t, i18n } = useTranslation();
  const { client, statsOpen, setStatsOpen, battery } = useMeshStore();
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [loading, setLoading] = useState(false);
  // The device clock (epoch seconds) and its skew from this computer at the
  // moment it was read, or null when there's no readable time — the radio
  // lacks GET_DEVICE_TIME (older firmware) or its clock is unset. The clock
  // card is hidden while null.
  const [clock, setClock] = useState<{ time: number; skew: number } | null>(
    null,
  );
  const [resyncing, setResyncing] = useState(false);

  // Bumped on every modal open so an async read whose modal has since reopened
  // drops its late setState instead of clobbering the current session's values.
  const session = useRef(0);

  // Reads the device clock and stores it with a fresh skew snapshot, unless
  // `gen` is no longer the current session. A null (unsupported firmware) or
  // unset (epoch 0) clock blanks the card; a transient read error leaves the
  // current display untouched.
  const readClock = useCallback(
    async (gen: number) => {
      if (!client) return;
      let dt: number | null;
      try {
        dt = await client.getDeviceTime();
      } catch {
        return;
      }
      if (gen !== session.current) return;
      setClock(
        dt !== null && dt > 0
          ? { time: dt, skew: dt - Math.floor(Date.now() / 1000) }
          : null,
      );
    },
    [client],
  );

  // Auto-fetch when modal opens; only setState after an await (never
  // synchronously in the effect body).
  useEffect(() => {
    if (!statsOpen || !client) return;
    const gen = ++session.current;
    void (async () => {
      const [s, b] = await Promise.all([
        client.getStats(),
        client.getBattery(),
      ]);
      if (gen !== session.current) return;
      setStats(s);
      if (b) useMeshStore.getState().setBattery(b);
      // Read the clock on its own: the firmware answers GET_DEVICE_TIME
      // reliably only one command at a time, so it can't be pipelined into the
      // stats batch above.
      await readClock(gen);
    })();
  }, [statsOpen, client, readClock]);

  const refresh = useCallback(async () => {
    if (!client) return;
    const gen = session.current;
    setLoading(true);
    const [s, b] = await Promise.all([client.getStats(), client.getBattery()]);
    if (gen === session.current) {
      setStats(s);
      if (b) useMeshStore.getState().setBattery(b);
      await readClock(gen);
    }
    setLoading(false);
  }, [client, readClock]);

  // Push this computer's time to the radio, then re-read to show the corrected
  // skew (a few seconds at most, from the round trip).
  const resyncClock = useCallback(async () => {
    if (!client) return;
    const gen = session.current;
    setResyncing(true);
    try {
      await client.setDeviceTime(Math.floor(Date.now() / 1000));
      await readClock(gen);
    } catch {
      // Best-effort: a timed-out or dropped resync just leaves the displayed
      // skew unchanged. Swallow so the onClick handler can't surface an
      // unhandled rejection.
    } finally {
      setResyncing(false);
    }
  }, [client, readClock]);

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
                [
                  t('stats.used'),
                  `${battery.usedKB.toLocaleString(i18n.language)} KB`,
                ],
                [
                  t('stats.total'),
                  `${battery.totalKB.toLocaleString(i18n.language)} KB`,
                ],
                [
                  t('stats.free'),
                  `${(battery.totalKB - battery.usedKB).toLocaleString(i18n.language)} KB`,
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
          {clock !== null && (
            <StatCard
              title={t('stats.card.clock')}
              rows={[
                [
                  t('stats.deviceTime'),
                  new Date(clock.time * 1000).toLocaleString(i18n.language),
                ],
                [
                  t('stats.clockSkew'),
                  Math.abs(clock.skew) <= CLOCK_SKEW_THRESHOLD_SECS
                    ? t('stats.clockInSync')
                    : fmtSkew(clock.skew),
                  <button
                    key='resync'
                    onClick={resyncClock}
                    disabled={resyncing}
                    title={t('stats.resyncClock')}
                    aria-label={t('stats.resyncClock')}
                    className='leading-none text-(--text2) transition-colors hover:text-(--accent) disabled:opacity-50'
                  >
                    {resyncing ? '⟳' : '↻'}
                  </button>,
                ],
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
                [
                  t('stats.received'),
                  stats.packets.recv.toLocaleString(i18n.language),
                ],
                [
                  t('stats.sent'),
                  stats.packets.sent.toLocaleString(i18n.language),
                ],
                [
                  t('stats.floodTx'),
                  stats.packets.floodTx.toLocaleString(i18n.language),
                ],
                [
                  t('stats.floodRx'),
                  stats.packets.floodRx.toLocaleString(i18n.language),
                ],
                [
                  t('stats.directTx'),
                  stats.packets.directTx.toLocaleString(i18n.language),
                ],
                [
                  t('stats.directRx'),
                  stats.packets.directRx.toLocaleString(i18n.language),
                ],
                ...(stats.packets.recvErrors != null
                  ? ([
                      [
                        t('stats.rxErrors'),
                        stats.packets.recvErrors.toLocaleString(i18n.language),
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

/**
 * A titled card rendering `[label, value]` rows for one stats group. A row may
 * carry an optional third element — an action node (e.g. a button) shown after
 * the value.
 */
function StatCard({
  title,
  rows,
}: {
  title: string;
  rows: [string, string, React.ReactNode?][];
}) {
  return (
    <div className='rounded-lg p-3.5' style={{ background: 'var(--surface2)' }}>
      <div className='mb-2.5 text-[11px] font-bold tracking-widest text-(--accent) uppercase'>
        {title}
      </div>
      {rows.map(([label, val, action]) => (
        <div
          key={label}
          className='flex justify-between border-b py-1.5 text-xs last:border-0'
          style={{ borderColor: 'var(--border)' }}
        >
          <span className='text-(--text2)'>{label}</span>
          {action ? (
            <span className='flex items-center gap-1.5'>
              <span className='font-semibold'>{val}</span>
              {action}
            </span>
          ) : (
            <span className='font-semibold'>{val}</span>
          )}
        </div>
      ))}
    </div>
  );
}
