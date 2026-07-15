// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { fmtUptime } from '@/lib/utils';
import { formatAirtime, formatSnr, formatVoltage } from '@/lib/i18n/format';
import { ModalShell } from './ModalShell';
import type { Contact, RepeaterAccess, RepeaterStatus } from '@/types/meshcore';

/** Coarse Li-ion voltage → charge mapping, clamped to 0–100%. */
const BATT_MIN_MV = 3300;
const BATT_MAX_MV = 4200;

/**
 * Estimates a rough battery charge percentage from a Li-ion cell voltage. The
 * curve is deliberately crude — a linear map between {@link BATT_MIN_MV} (0%)
 * and {@link BATT_MAX_MV} (100%) — so treat the result as approximate.
 */
function approxBatteryPercent(milliVolts: number): number {
  const pct = ((milliVolts - BATT_MIN_MV) / (BATT_MAX_MV - BATT_MIN_MV)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Remote-admin panel for a repeater or room server, opened from its contact
 * detail. Shows a login gate (password + Admin/Guest choice) until the session
 * is authenticated, then a read-only status dashboard with a Refresh and a
 * Log-out control. All session state (login level, latest status) lives in the
 * store's `adminSessions[prefix]`; only the transient password input is local
 * and is never stored or auto-filled.
 *
 * @param contact - the repeater/room-server contact to administer.
 * @param onClose - closes the panel (does not log out the session).
 */
export function RepeaterAdminPanel({
  contact,
  onClose,
}: {
  contact: Contact;
  onClose: () => void;
}) {
  const { repeaterLogin, repeaterStatus } = useMeshCore();
  const session = useMeshStore((s) => s.adminSessions[contact.pubkeyPrefix]);
  const resetAdminSession = useMeshStore((s) => s.resetAdminSession);

  const login = session?.login ?? 'loggedOut';
  const loggedIn = login === 'admin' || login === 'guest';
  const title = `📡 ${contact.name || contact.pubkeyPrefix.slice(0, 8)}`;

  if (!loggedIn) {
    return (
      <ModalShell title={title} onClose={onClose}>
        <LoginGate
          pending={login === 'pending'}
          onSubmit={(password, kind) =>
            void repeaterLogin(contact, password, kind)
          }
        />
      </ModalShell>
    );
  }

  return (
    <ModalShell title={title} onClose={onClose}>
      <StatusDashboard
        access={login}
        status={session?.status}
        onRefresh={() => repeaterStatus(contact)}
        onLogout={() => resetAdminSession(contact.pubkeyPrefix)}
      />
    </ModalShell>
  );
}

/**
 * The login form: a password field, an Admin/Guest access choice, and a submit
 * that dispatches the login. While `pending`, the form is disabled and the
 * button shows a progress label. The password lives only in local state and is
 * neither persisted nor auto-filled.
 */
function LoginGate({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (password: string, kind: RepeaterAccess) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [kind, setKind] = useState<RepeaterAccess>('admin');

  const submit = () => {
    // An empty password is a valid guest login; only Admin requires one.
    if (pending || (kind === 'admin' && password === '')) return;
    onSubmit(password, kind);
  };

  return (
    <form
      className='space-y-4'
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className='text-sm text-(--text2)'>
        {t('repeaterAdmin.login.prompt')}
      </p>

      <div
        role='radiogroup'
        aria-label={t('repeaterAdmin.login.accessLabel')}
        className='grid grid-cols-2 gap-2'
      >
        {(['admin', 'guest'] as const).map((k) => (
          <button
            key={k}
            type='button'
            role='radio'
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            disabled={pending}
            className={`rounded-md border px-3 py-2 text-left disabled:opacity-50 ${
              kind === k
                ? 'border-(--accent) bg-(--surface2)'
                : 'border-(--border-control) hover:bg-(--surface2)'
            }`}
          >
            <span className='block text-sm font-medium text-(--text)'>
              {t(`repeaterAdmin.login.${k}`)}
            </span>
            <span className='block text-xs text-(--text2)'>
              {t(`repeaterAdmin.login.${k}Hint`)}
            </span>
          </button>
        ))}
      </div>

      <label className='block'>
        <span className='mb-1 block text-xs text-(--text2)'>
          {t('repeaterAdmin.login.password')}
        </span>
        <input
          type='password'
          autoComplete='off'
          autoFocus
          disabled={pending}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('repeaterAdmin.login.passwordPlaceholder')}
          className='w-full rounded-md border border-(--border-control) bg-(--surface) px-2 py-1.5 text-sm text-(--text) outline-none focus:border-(--accent) disabled:opacity-50'
        />
      </label>

      <div className='flex justify-end border-t border-(--border) pt-4'>
        <button
          type='submit'
          disabled={pending || (kind === 'admin' && password === '')}
          className='rounded-md bg-(--accent) px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50'
        >
          {pending
            ? t('repeaterAdmin.login.loggingIn')
            : t('repeaterAdmin.login.submit')}
        </button>
      </div>
    </form>
  );
}

/**
 * The authenticated status dashboard: grouped cards of the repeater's live
 * status, a Refresh button, and a Log-out control. Fetches once on mount
 * (first entry) and again on demand; the fetched status is read from the store.
 */
function StatusDashboard({
  access,
  status,
  onRefresh,
  onLogout,
}: {
  access: RepeaterAccess;
  status?: RepeaterStatus;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const fetched = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    await onRefresh();
    setLoading(false);
  }, [onRefresh]);

  // Auto-fetch once on first entry to the dashboard. The ref guard keeps
  // StrictMode's double-invoke (and identity churn in `refresh`) from firing a
  // second request.
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    void refresh();
  }, [refresh]);

  const num = (n: number) => n.toLocaleString(i18n.language);
  const dbm = (n: number) => t('repeaterAdmin.dbm', { value: num(n) });
  const cards = status ? buildCards(t, status, num, dbm) : [];

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-xs text-(--text2)'>
          {access === 'admin'
            ? t('repeaterAdmin.dashboard.accessAdmin')
            : t('repeaterAdmin.dashboard.accessGuest')}
        </span>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className='rounded-md bg-(--accent) px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50'
        >
          {loading
            ? t('repeaterAdmin.dashboard.refreshing')
            : t('repeaterAdmin.dashboard.refresh')}
        </button>
      </div>

      {status ? (
        <div className='grid grid-cols-2 gap-3'>
          {cards.map(({ title: cardTitle, rows }) => (
            <StatCard key={cardTitle} title={cardTitle} rows={rows} />
          ))}
        </div>
      ) : (
        <p className='text-sm text-(--text2)'>
          {loading
            ? t('repeaterAdmin.dashboard.loading')
            : t('repeaterAdmin.dashboard.unavailable')}
        </p>
      )}

      <div className='flex justify-end border-t border-(--border) pt-4'>
        <button
          onClick={onLogout}
          className='rounded-md px-3 py-1.5 text-sm text-(--text) hover:bg-(--surface2)'
        >
          {t('repeaterAdmin.dashboard.logout')}
        </button>
      </div>
    </div>
  );
}

/**
 * Groups a decoded {@link RepeaterStatus} into display cards, dropping any row
 * whose field the firmware didn't report. `num`/`dbm` are the locale-bound
 * value formatters from the dashboard.
 */
function buildCards(
  t: ReturnType<typeof useTranslation>['t'],
  s: RepeaterStatus,
  num: (n: number) => string,
  dbm: (n: number) => string,
): { title: string; rows: [string, string][] }[] {
  const opt = (
    label: string,
    value: number | undefined,
    fmt: (n: number) => string,
  ): [string, string][] => (value == null ? [] : [[label, fmt(value)]]);

  const power: [string, string][] = [
    [t('repeaterAdmin.battery'), formatVoltage(s.battMilliVolts)],
    [
      t('repeaterAdmin.batteryPercent'),
      `${approxBatteryPercent(s.battMilliVolts)}%`,
    ],
    ...opt(t('repeaterAdmin.uptime'), s.totalUpTimeSecs, fmtUptime),
    [t('repeaterAdmin.queueLength'), num(s.currTxQueueLen)],
  ];

  const radio: [string, string][] = [
    ...opt(t('repeaterAdmin.noiseFloor'), s.noiseFloor, dbm),
    ...opt(t('repeaterAdmin.lastRssi'), s.lastRssi, dbm),
    ...opt(t('repeaterAdmin.lastSnr'), s.lastSnr, formatSnr),
  ];

  const airtime: [string, string][] = [
    ...opt(t('repeaterAdmin.txAirtime'), s.totalAirTimeSecs, formatAirtime),
    ...opt(t('repeaterAdmin.rxAirtime'), s.totalRxAirTimeSecs, formatAirtime),
  ];

  const packets: [string, string][] = [
    ...opt(t('repeaterAdmin.received'), s.nPacketsRecv, num),
    ...opt(t('repeaterAdmin.sent'), s.nPacketsSent, num),
    ...opt(t('repeaterAdmin.floodTx'), s.nSentFlood, num),
    ...opt(t('repeaterAdmin.floodRx'), s.nRecvFlood, num),
    ...opt(t('repeaterAdmin.directTx'), s.nSentDirect, num),
    ...opt(t('repeaterAdmin.directRx'), s.nRecvDirect, num),
    ...opt(t('repeaterAdmin.floodDups'), s.nFloodDups, num),
    ...opt(t('repeaterAdmin.directDups'), s.nDirectDups, num),
    ...opt(t('repeaterAdmin.rxErrors'), s.nRecvErrors, num),
  ];

  return [
    { title: t('repeaterAdmin.card.power'), rows: power },
    { title: t('repeaterAdmin.card.radio'), rows: radio },
    { title: t('repeaterAdmin.card.airtime'), rows: airtime },
    { title: t('repeaterAdmin.card.packets'), rows: packets },
  ].filter((c) => c.rows.length > 0);
}

/** A titled card rendering `[label, value]` rows for one status group. */
function StatCard({
  title,
  rows,
}: {
  title: string;
  rows: [string, string][];
}) {
  return (
    <div className='rounded-lg border border-(--border) bg-(--surface) p-3'>
      <h3 className='mb-2 text-xs font-semibold text-(--text2)'>{title}</h3>
      <div className='space-y-1'>
        {rows.map(([label, value]) => (
          <div key={label} className='flex items-center justify-between gap-2'>
            <span className='text-xs text-(--text2)'>{label}</span>
            <span className='text-sm text-(--text)'>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
