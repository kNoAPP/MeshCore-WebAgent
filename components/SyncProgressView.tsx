// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { SyncProgress } from '@/types/meshcore';

const SYNC_STAGES: SyncProgress['stage'][] = [
  'device',
  'clock',
  'contacts',
  'channels',
  'messages',
];

const SYNC_STAGE_KEY = {
  device: 'sync.device',
  clock: 'sync.clock',
  contacts: 'sync.contacts',
  channels: 'sync.channels',
  messages: 'sync.messages',
} as const satisfies Record<SyncProgress['stage'], string>;

function syncDetail(
  t: TFunction,
  { stage, current, total }: SyncProgress,
): string {
  if (stage === 'messages')
    return current ? ` (${t('sync.received', { count: current })})` : '';
  if (current != null && total != null)
    return ` (${t('sync.progress', { current, total })})`;
  return '';
}

/**
 * The live sync read-out — a labeled percent bar plus a per-stage checklist —
 * shared by the initial-connect panel and the reconnect overlay so both show
 * identical progress.
 */
export function SyncProgressView({ progress }: { progress: SyncProgress }) {
  const { t } = useTranslation();
  const { stage, percent } = progress;
  const stageIdx = SYNC_STAGES.indexOf(stage);
  const stageLabel = `${t(SYNC_STAGE_KEY[stage])}${syncDetail(t, progress)}`;
  return (
    <>
      {/* `progressbar` is not a live role, so the stage — the part worth
          hearing — gets its own polite region. The percent and the item
          counter deliberately stay out of it: they change many times per
          stage and would flood the queue. */}
      <span className='sr-only' role='status' aria-live='polite'>
        {t(SYNC_STAGE_KEY[stage])}
      </span>
      <div className='mb-1.5 flex items-baseline justify-between gap-3'>
        <span className='text-sm'>{stageLabel}…</span>
        <span className='text-xs text-(--text2)'>{percent}%</span>
      </div>
      <div
        role='progressbar'
        aria-label={t('sync.label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t('sync.valueText', { stage: stageLabel, percent })}
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
              <span className='w-3 text-center' aria-hidden='true'>
                {done ? '✓' : active ? '●' : '○'}
              </span>
              {t(SYNC_STAGE_KEY[s])}
              <span className='sr-only'>
                {t(
                  done
                    ? 'sync.stageDone'
                    : active
                      ? 'sync.stageActive'
                      : 'sync.stagePending',
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
