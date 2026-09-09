// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState, useSyncExternalStore } from 'react';
import { Bluetooth, PlugZap, Usb, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useMeshStore, type ConnectFailure } from '@/store/meshStore';
import { version } from '@/package.json';
import { SyncDialog } from './SyncDialog';

type Tab = 'usb' | 'ble' | 'wifi';

const DEFAULT_WIFI_URL = 'ws://192.168.1.100:5000';

interface TransportSupport {
  usb: boolean;
  ble: boolean;
}

// Snapshot must be cached — useSyncExternalStore compares by reference
let transportSupport: TransportSupport | null = null;
// Memoized so the snapshot stays reference-stable.
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
  const { t } = useTranslation();
  // Null until the user picks a tab or edits the URL, so both can fall back to
  // the session auto-reconnect gave up on without an effect to sync them.
  const [pickedTab, setPickedTab] = useState<Tab | null>(null);
  const [editedUrl, setEditedUrl] = useState<string | null>(null);
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
  const connectError = useMeshStore((s) => s.connectError);
  const setConnectError = useMeshStore((s) => s.setConnectError);
  const lastFailure = useMeshStore((s) => s.lastConnectFailure);

  const tab = pickedTab ?? lastFailure?.transport ?? 'usb';
  const wifiUrl = editedUrl ?? lastFailure?.url ?? DEFAULT_WIFI_URL;
  const usbSupported = support?.usb ?? true;
  const bleSupported = support?.ble ?? true;

  // Switching transports clears a stale error from the previous attempt.
  const changeTab = (tb: Tab) => {
    setConnectError(null);
    setPickedTab(tb);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  // Reopens the radio the reconnect loop gave up on. USB and BLE go back
  // through the browser picker, since the granted handle died with the session.
  const reconnectLast = (failure: ConnectFailure) => {
    // Pin the transport and URL locally first: a retry that fails tears the
    // session down again, and the panel must still show what was being tried.
    setPickedTab(failure.transport);
    if (failure.url) setEditedUrl(failure.url);
    return run(() =>
      failure.transport === 'usb'
        ? connectUSB()
        : failure.transport === 'ble'
          ? connectBLE()
          : connectWiFi(failure.url ?? wifiUrl),
    );
  };

  if (status === 'connecting' && syncProgress) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <SyncDialog
          title={t('connect.sync.title')}
          subtitle={
            deviceName
              ? t('connect.sync.loadingFrom', { device: deviceName })
              : t('connect.sync.loadingGeneric')
          }
          progress={syncProgress}
        />
      </div>
    );
  }

  return (
    <div className='relative flex flex-1 items-center justify-center'>
      {' '}
      <div
        className='w-105 max-w-[95vw] rounded-[10px] border p-8'
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <h2 className='mb-1 text-xl font-bold'>{t('connect.title')}</h2>
        <p className='mb-5 text-sm text-(--text2)'> {t('connect.subtitle')} </p>

        {lastFailure && (
          <ReconnectFailedCard
            device={lastFailure.device}
            busy={busy}
            onReconnect={() => reconnectLast(lastFailure)}
          />
        )}

        {/* Tabs */}
        <div
          className='mb-5 flex overflow-hidden rounded-lg border'
          style={{ borderColor: 'var(--border)' }}
        >
          {(['usb', 'ble', 'wifi'] as Tab[]).map((tb, i) => {
            const Icon = tb === 'usb' ? Usb : tb === 'ble' ? Bluetooth : Wifi;
            return (
              <button
                key={tb}
                onClick={() => changeTab(tb)}
                disabled={busy}
                className={`focus-inset flex flex-1 items-center justify-center gap-1.5 py-2 text-[13px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50
                ${i > 0 ? 'border-l' : ''}
                ${tab === tb ? 'bg-(--accent) text-white' : 'text-(--text2) hover:text-(--text)'}`}
                style={i > 0 ? { borderColor: 'var(--border)' } : {}}
              >
                <Icon size={15} aria-hidden='true' />
                {tb === 'usb'
                  ? t('connect.tab.usb')
                  : tb === 'ble'
                    ? t('connect.tab.ble')
                    : t('connect.tab.wifi')}
              </button>
            );
          })}
        </div>

        {connectError && (
          <div className='mb-5' role='alert'>
            <WarningBox>{t(`toast.${connectError}`)}</WarningBox>
          </div>
        )}

        {/* USB */}
        {tab === 'usb' && (
          <div className='flex flex-col gap-3'>
            {usbSupported ? (
              <InfoBox>{t('connect.usb.info')}</InfoBox>
            ) : (
              <WarningBox>{t('connect.usb.unsupported')}</WarningBox>
            )}
            <PrimaryButton
              disabled={busy || !usbSupported}
              onClick={() => run(() => connectUSB())}
            >
              {busy ? t('connect.connecting') : t('connect.connectUsb')}
            </PrimaryButton>
          </div>
        )}

        {/* BLE */}
        {tab === 'ble' && (
          <div className='flex flex-col gap-3'>
            {bleSupported ? (
              <InfoBox>
                {t('connect.ble.info')}
                <div className='mt-1.5'>{t('connect.ble.infoExtra')}</div>
              </InfoBox>
            ) : (
              <WarningBox>{t('connect.ble.unsupported')}</WarningBox>
            )}
            <PrimaryButton
              disabled={busy || !bleSupported}
              onClick={() => run(connectBLE)}
            >
              {busy ? t('connect.scanning') : t('connect.scanConnectBle')}
            </PrimaryButton>
          </div>
        )}

        {/* WiFi */}
        {tab === 'wifi' && (
          <div className='flex flex-col gap-3'>
            <InfoBox>
              {t('connect.wifi.info')}
              <div className='mt-1.5'>{t('connect.wifi.infoExtra')}</div>
            </InfoBox>
            <label className='flex flex-col gap-1'>
              <span className='text-xs text-(--text2)'>
                {t('connect.websocketUrl')}
              </span>
              <input
                type='text'
                value={wifiUrl}
                onChange={(e) => setEditedUrl(e.target.value)}
                placeholder={DEFAULT_WIFI_URL}
                className='input-field'
              />
            </label>
            <PrimaryButton
              disabled={busy || !wifiUrl.startsWith('ws')}
              onClick={() => run(() => connectWiFi(wifiUrl))}
            >
              {busy ? t('connect.connecting') : t('connect.connectWifi')}
            </PrimaryButton>
          </div>
        )}
      </div>
      <ConnectFooter />
    </div>
  );
}

/**
 * Persistent notice that auto-reconnect ran out of attempts, naming the radio
 * that was lost and offering a one-click retry on the same transport.
 */
function ReconnectFailedCard({
  device,
  busy,
  onReconnect,
}: {
  device: string;
  busy: boolean;
  onReconnect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role='status'
      className='mb-5 rounded-lg border p-3.5'
      style={{
        background: 'color-mix(in srgb, var(--red) 8%, transparent)',
        borderColor: 'color-mix(in srgb, var(--red) 30%, transparent)',
      }}
    >
      <div className='mb-1.5 flex items-center gap-1.5 text-sm font-semibold'>
        <PlugZap size={16} aria-hidden='true' className='text-(--red)' />
        {t('connect.failed.title')}
      </div>
      <p className='mb-3 text-xs text-(--text2)'>
        {t('connect.failed.body', { device })}
      </p>
      <PrimaryButton disabled={busy} onClick={onReconnect}>
        {busy
          ? t('connect.connecting')
          : t('connect.failed.reconnect', { device })}
      </PrimaryButton>
    </div>
  );
}

function ConnectFooter() {
  const { t } = useTranslation();
  return (
    <footer className='absolute right-4 bottom-4 flex flex-col items-end gap-0.5 text-right text-[11px] text-(--text2)'>
      <span>{t('connect.footer.createdBy')}</span>
      <span>{t('connect.footer.license')}</span>
      <span>
        <a
          href='https://github.com/kNoAPP/MeshCore-WebAgent'
          target='_blank'
          rel='noreferrer'
          className='text-(--accent) hover:underline'
        >
          {t('connect.footer.contribute')}
        </a>{' '}
        · v{version}
      </span>
    </footer>
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
