// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import type { StatsResult, BatteryInfo } from '@/types/meshcore';
import { CLOCK_SKEW_THRESHOLD_SECS } from '@/lib/meshcore/client';
import { fmtUptime, fmtAirtime, fmtVoltage, fmtSkew } from '@/lib/utils';

/**
 * Device stats page. Fetches battery + all stats pages when the stats view
 * becomes active (and on Refresh), laid out as cards. Rendered by
 * {@link AppShell} in place of the chat pane while `view` is `'stats'`.
 */
export function StatsPage() {
  const { t, i18n } = useTranslation();
  const { client, view } = useMeshStore();
  const [stats, setStats] = useState<StatsResult | null>(null);
  // This session's battery/storage snapshot — the exact result of the last
  // fetch, including null when the device didn't report it. Kept local (rather
  // than reading the shared store) so a timed-out fetch surfaces the card's
  // "unavailable" state here without clearing the header's last-known reading.
  const [battery, setBatteryLocal] = useState<BatteryInfo | null>(null);
  // Starts true so the very first paint shows shimmer skeletons instead of a
  // blank grid (the auto-fetch effect runs just after mount). Toggled on for
  // refreshes too, and cleared once a fetch settles.
  const [loading, setLoading] = useState(true);
  // True once a fetch has completed at least once this session. Distinct from
  // `loading`: it gates the "unavailable" cards so they appear only after a
  // real attempt, not during the initial blank render.
  const [fetched, setFetched] = useState(false);
  // The device clock (epoch seconds) and its skew from this computer at the
  // moment it was read, or null when there's no readable time — the radio
  // lacks GET_DEVICE_TIME (older firmware) or its clock is unset. The clock
  // card shows "not reported" while null (once fetched), matching the other
  // cards so the grid doesn't reflow.
  const [clock, setClock] = useState<{ time: number; skew: number } | null>(
    null,
  );
  const [resyncing, setResyncing] = useState(false);

  // Bumped on every entry to the stats view so an async read whose view has
  // since reopened drops its late setState instead of clobbering the current
  // session's values.
  const session = useRef(0);

  // True while a stats/battery fetch is in flight. The radio answers reliably
  // only one command sequence at a time, so a second overlapping fetch garbles
  // both — most visibly when StrictMode double-invokes the auto-fetch effect on
  // mount, leaving every card showing "not reported". This gate ensures only
  // one sequence runs at a time.
  const fetching = useRef(false);

  // Reads the device clock and stores it with a fresh skew snapshot, unless
  // `gen` is no longer the current session. A null (unsupported firmware) or
  // unset (epoch 0) clock surfaces the card's "not reported" state; a transient
  // read error leaves the current display untouched.
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

  // Auto-fetch when the stats view opens; only setState after an await (never
  // synchronously in the effect body).
  useEffect(() => {
    if (view !== 'stats' || !client || fetching.current) return;
    const gen = ++session.current;
    fetching.current = true;
    void (async () => {
      try {
        const s = await client.getStats();
        if (gen !== session.current) return;
        setStats(s);
        setFetched(true);
        // Battery on its own command, not pipelined with the stats batch: the
        // firmware answers reliably one sequence at a time, so racing the two
        // lets the stats batch starve the battery reply past its timeout (it
        // comes back null and the card reads "not reported").
        const b = await client.getBattery();
        if (gen !== session.current) return;
        setBatteryLocal(b);
        if (b) useMeshStore.getState().setBattery(b);
        // Read the clock on its own: the firmware answers GET_DEVICE_TIME
        // reliably only one command at a time, so it can't be pipelined into
        // the stats batch above.
        await readClock(gen);
      } finally {
        fetching.current = false;
        setLoading(false);
      }
    })();
  }, [view, client, readClock]);

  const refresh = useCallback(async () => {
    if (!client || fetching.current) return;
    const gen = session.current;
    setLoading(true);
    fetching.current = true;
    try {
      const s = await client.getStats();
      if (gen === session.current) {
        setStats(s);
        setFetched(true);
        // Battery on its own command — see the auto-fetch effect for why it
        // isn't pipelined with the stats batch.
        const b = await client.getBattery();
        setBatteryLocal(b);
        if (b) useMeshStore.getState().setBattery(b);
        await readClock(gen);
      }
    } finally {
      fetching.current = false;
      setLoading(false);
    }
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

  // The cards rendered with their real titles and row labels while a fetch is
  // in flight — only the values shimmer. Mirrors the loaded layout (all five
  // sections, including the clock) so labels stay visible and the grid doesn't
  // reflow when data arrives.
  const loadingCards: { title: string; labels: string[] }[] = [
    {
      title: t('stats.card.storageBattery'),
      labels: [
        t('stats.voltage'),
        t('stats.used'),
        t('stats.total'),
        t('stats.free'),
        t('stats.usage'),
      ],
    },
    {
      title: t('stats.card.core'),
      labels: [
        t('stats.uptime'),
        t('stats.battery'),
        t('stats.errors'),
        t('stats.queueLength'),
      ],
    },
    {
      title: t('stats.card.clock'),
      labels: [t('stats.deviceTime'), t('stats.clockSkew')],
    },
    {
      title: t('stats.card.radio'),
      labels: [
        t('stats.noiseFloor'),
        t('stats.lastRssi'),
        t('stats.lastSnr'),
        t('stats.txAirtime'),
        t('stats.rxAirtime'),
      ],
    },
    {
      title: t('stats.card.packets'),
      labels: [
        t('stats.received'),
        t('stats.sent'),
        t('stats.floodTx'),
        t('stats.floodRx'),
        t('stats.directTx'),
        t('stats.directRx'),
      ],
    },
  ];

  return (
    <div className='flex flex-1 flex-col overflow-y-auto p-7'>
      <div className='mx-auto w-full max-w-3xl'>
        {/* Header */}
        <div className='mb-5 flex items-center justify-between'>
          <h2 className='text-base font-bold'>{t('stats.title')}</h2>
          <button
            onClick={refresh}
            disabled={loading}
            className='rounded-lg bg-(--accent) px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50'
          >
            {loading ? t('stats.refreshing') : t('stats.refresh')}
          </button>
        </div>

        <div className='grid grid-cols-2 gap-4'>
          {loading ? (
            loadingCards.map(({ title, labels }) => (
              <StatCard
                key={title}
                title={title}
                loading
                rows={labels.map((label) => [label, ''])}
              />
            ))
          ) : (
            <>
              {battery ? (
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
              ) : (
                fetched && (
                  <StatCard
                    title={t('stats.card.storageBattery')}
                    note={t('stats.notReported')}
                  />
                )
              )}
              {stats?.core ? (
                <StatCard
                  title={t('stats.card.core')}
                  rows={[
                    [t('stats.uptime'), fmtUptime(stats.core.uptimeSecs)],
                    [t('stats.battery'), fmtVoltage(stats.core.battMv)],
                    [t('stats.errors'), String(stats.core.errors)],
                    [t('stats.queueLength'), String(stats.core.queueLen)],
                  ]}
                />
              ) : (
                fetched && (
                  <StatCard
                    title={t('stats.card.core')}
                    note={t('stats.notReported')}
                  />
                )
              )}
              {clock !== null ? (
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
              ) : (
                // Keep the clock slot once a fetch has landed (matching the
                // other cards) so the grid doesn't reflow when the loading
                // skeleton's clock card resolves to no readable time.
                fetched && (
                  <StatCard
                    title={t('stats.card.clock')}
                    note={t('stats.notReported')}
                  />
                )
              )}
              {stats?.radio ? (
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
              ) : (
                fetched && (
                  <StatCard
                    title={t('stats.card.radio')}
                    note={t('stats.notReported')}
                  />
                )
              )}
              {stats?.packets ? (
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
                            stats.packets.recvErrors.toLocaleString(
                              i18n.language,
                            ),
                          ],
                        ] as [string, string][])
                      : []),
                  ]}
                />
              ) : (
                fetched && (
                  <StatCard
                    title={t('stats.card.packets')}
                    note={t('stats.notReported')}
                  />
                )
              )}
            </>
          )}
        </div>

        {!loading &&
          fetched &&
          !stats?.core &&
          !stats?.radio &&
          !stats?.packets && (
            <p className='mt-4 text-xs text-(--text2)'>
              {t('stats.allUnavailable')}
            </p>
          )}
      </div>
    </div>
  );
}

/**
 * A titled card rendering `[label, value]` rows for one stats group. A row may
 * carry an optional third element — an action node (e.g. a button) shown after
 * the value. When `note` is set, the card shows that muted line instead of rows
 * — used to render a section the device didn't report. When `loading` is set,
 * the labels render normally but each value is replaced by a shimmer block.
 */
function StatCard({
  title,
  rows = [],
  note,
  loading = false,
}: {
  title: string;
  rows?: [string, string, React.ReactNode?][];
  note?: string;
  loading?: boolean;
}) {
  return (
    <div className='rounded-lg p-3.5' style={{ background: 'var(--surface2)' }}>
      <div className='mb-2.5 text-[11px] font-bold tracking-widest text-(--accent) uppercase'>
        {title}
      </div>
      {note !== undefined ? (
        <div className='py-1.5 text-xs text-(--text2)'>{note}</div>
      ) : (
        rows.map(([label, val, action]) => (
          <div
            key={label}
            className='flex justify-between border-b py-1.5 text-xs last:border-0'
            style={{ borderColor: 'var(--border)' }}
          >
            <span className='text-(--text2)'>{label}</span>
            {loading ? (
              <span className='skeleton h-3 w-16 self-center' />
            ) : action ? (
              <span className='flex items-center gap-1.5'>
                <span className='font-semibold'>{val}</span>
                {action}
              </span>
            ) : (
              <span className='font-semibold'>{val}</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}
