// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useClockTick } from '@/hooks/useClockTick';
import { formatRelative, formatTelemetryValue } from '@/lib/i18n/format';
import { TELEM_CHANNEL_SELF } from '@/lib/meshcore/constants';
import { StatCard } from './StatCard';
import { RefreshButton } from './RefreshButton';
import type { Contact, TelemetryReading } from '@/types/meshcore';

/**
 * A node's sensor telemetry: the decoded readings from its last
 * `PUSH_TELEMETRY_RESPONSE`, one card per LPP data channel, behind a manual
 * read. Any node can be asked — no admin login is involved — and the last
 * reply is cached in the store, so returning here shows the previous reading
 * (with its age) rather than blanking.
 *
 * @param contact - the node to request telemetry from.
 */
export function TelemetryPanel({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const { requestTelemetry } = useMeshCore();
  const snapshot = useMeshStore((s) => s.telemetry[contact.pubkeyPrefix]);
  const unitSystem = useMeshStore((s) => s.unitSystem);
  const connected = useMeshStore((s) => s.status === 'connected');
  // The age label is derived from the wall clock, so it needs its own
  // re-render to keep counting up while the panel sits open.
  useClockTick();
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      await requestTelemetry(contact);
    } finally {
      setLoading(false);
    }
  };

  // One card per LPP data channel, in the order the node reported them.
  const readings = snapshot?.readings ?? [];
  const channels = [...new Set(readings.map((r) => r.channel))];

  // A node may report the same kind twice on one channel (two thermometers),
  // so those rows are numbered — otherwise they'd be indistinguishable.
  const rowsFor = (channel: number): [string, string][] => {
    const inChannel = readings.filter((r) => r.channel === channel);
    const totals = new Map<TelemetryReading['kind'], number>();
    for (const r of inChannel) {
      totals.set(r.kind, (totals.get(r.kind) ?? 0) + 1);
    }
    const seen = new Map<TelemetryReading['kind'], number>();
    return inChannel.map((r) => {
      const nth = (seen.get(r.kind) ?? 0) + 1;
      seen.set(r.kind, nth);
      const name = t(`telemetry.kind.${r.kind}`);
      const label = (totals.get(r.kind) ?? 0) > 1 ? `${name} ${nth}` : name;
      return [label, formatTelemetryValue(r, unitSystem)];
    });
  };

  return (
    <div className='space-y-3'>
      <div className='flex items-center justify-end gap-3'>
        {snapshot && !loading && (
          <span className='text-xs text-text2'>
            {t('telemetry.lastRead', { time: formatRelative(snapshot.readAt) })}
          </span>
        )}
        {connected && (
          <RefreshButton
            onClick={() => void refresh()}
            busy={loading}
            download={!snapshot}
          />
        )}
      </div>

      {loading && !snapshot ? (
        <p className='text-sm text-text2'>{t('telemetry.reading')}</p>
      ) : !snapshot ? (
        <p className='text-sm text-text2'>
          {connected ? t('telemetry.prompt') : t('telemetry.offline')}
        </p>
      ) : channels.length === 0 ? (
        <p className='text-sm text-text2'>{t('telemetry.none')}</p>
      ) : (
        <div className='flex flex-wrap items-start gap-4'>
          {channels.map((channel) => (
            <div key={channel} className='min-w-full flex-1 sm:min-w-72'>
              <StatCard
                title={
                  channel === TELEM_CHANNEL_SELF
                    ? t('telemetry.channelSelf')
                    : t('telemetry.channel', { index: channel })
                }
                loading={loading}
                rows={rowsFor(channel)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
