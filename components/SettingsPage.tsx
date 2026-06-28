// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { fmtVoltage } from '@/lib/utils';
import { CopyButton } from './CopyButton';

/**
 * Read-only Settings page: device identity, firmware, radio configuration, and
 * a storage/battery summary. Rendered by {@link AppShell} in place of the chat
 * pane while `view` is `'settings'`. Editing (name, radio) and actions
 * (advertise, reboot, share) land in later Phase 2 tasks; the Radio section
 * shows a disabled Edit affordance those tasks wire up.
 */
export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const {
    status,
    selfInfo,
    deviceInfo: device,
    battery,
    setView,
  } = useMeshStore();

  // Stats auto-fetches over the link on activation, so the shortcut to it is
  // gated while reconnecting — matching the header's Stats tab.
  const reconnecting = status === 'reconnecting';

  const unknown = t('common.unknown');
  const num = (n: number) => n.toLocaleString(i18n.language);

  return (
    <div className='flex flex-1 flex-col overflow-y-auto p-7'>
      <div className='mx-auto w-full max-w-3xl'>
        <div className='mb-5'>
          <h2 className='text-base font-bold'>{t('settings.title')}</h2>
        </div>

        <div className='grid grid-cols-2 gap-4'>
          <Card title={t('settings.section.device')}>
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
            action={
              <button
                disabled
                title={t('settings.editComingSoon')}
                className='rounded-md border border-(--border-control) px-2.5 py-1 text-xs text-(--text2) disabled:cursor-not-allowed disabled:opacity-50'
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

          <Card title={t('settings.section.identity')} className='col-span-2'>
            <Row
              label={t('settings.nodeName')}
              value={selfInfo?.name || unknown}
            />
            <Row
              label={t('settings.publicKey')}
              value={selfInfo?.pubkey || unknown}
              mono
              copy={selfInfo?.pubkey || undefined}
            />
          </Card>

          <Card title={t('settings.section.storage')} className='col-span-2'>
            {battery ? (
              <>
                <Row
                  label={t('settings.voltage')}
                  value={fmtVoltage(battery.voltage)}
                />
                <Row
                  label={t('settings.storageUsed')}
                  value={t('settings.kbUsage', {
                    used: num(battery.usedKB),
                    total: num(battery.totalKB),
                  })}
                />
              </>
            ) : (
              <p className='py-1.5 text-xs text-(--text2)'>
                {t('settings.noBattery')}
              </p>
            )}
            <button
              onClick={() => setView('stats')}
              disabled={reconnecting}
              className='mt-2 text-xs text-(--accent) hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50'
            >
              {t('settings.viewStats')}
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * A titled card for one settings group. `action` renders an optional control
 * (e.g. an Edit button) on the right of the card heading.
 */
function Card({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg p-3.5 ${className ?? ''}`}
      style={{ background: 'var(--surface2)' }}
    >
      <div className='mb-2.5 flex items-center justify-between gap-2'>
        <h3 className='text-[11px] font-bold tracking-widest text-(--accent) uppercase'>
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * A label/value row inside a {@link Card}.
 *
 * @param mono - render the value in monospace (for the public key).
 * @param copy - if set, shows a {@link CopyButton} that copies this string.
 */
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
