// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { loadRepeaterCred, clearRepeaterCred } from '@/lib/meshcore/adminCreds';
import {
  formatAirtime,
  formatSnr,
  formatUptime,
  formatVoltage,
} from '@/lib/i18n/format';
import { formatPubkey } from '@/lib/utils';
import { RouteChip } from './RouteChip';
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

/** Admin tabs in display order; Config/Neighbors/Console come in 7.5/7.6. */
const TABS = ['status'] as const;
type RepeaterTab = (typeof TABS)[number];

/**
 * The main-window remote-admin view for a repeater or room server, shown in
 * place of the chat pane when a repeater is selected in the sidebar (and
 * reachable for rooms via the manage action). Resolves the target contact from
 * the active conversation; renders nothing useful if it has been evicted.
 */
export function RepeaterView() {
  const { t } = useTranslation();
  const activeConvo = useMeshStore((s) => s.activeConvo);
  const contacts = useMeshStore((s) => s.contacts);
  const prefix =
    activeConvo?.kind === 'repeater'
      ? (activeConvo.rawId as string)
      : undefined;
  const contact = prefix ? contacts[prefix] : undefined;

  if (!contact) {
    return (
      <div className='flex flex-1 items-center justify-center text-sm text-(--text2)'>
        {t('repeaterAdmin.contactUnavailable')}
      </div>
    );
  }

  // Key by prefix so the auto-login guard and tab state reset when the user
  // switches to a different repeater.
  return <RepeaterViewInner key={contact.pubkeyPrefix} contact={contact} />;
}

function RepeaterViewInner({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const { repeaterLogin, repeaterStatus } = useMeshCore();
  const session = useMeshStore((s) => s.adminSessions[contact.pubkeyPrefix]);
  const resetAdminSession = useMeshStore((s) => s.resetAdminSession);
  const showFullPublicKeys = useMeshStore((s) => s.showFullPublicKeys);

  const login = session?.login ?? 'loggedOut';
  const authed = login === 'admin' || login === 'guest';

  const [tab, setTab] = useState<RepeaterTab>('status');
  // Whether a credential is remembered for this repeater — drives the log-out
  // button copy. Set when auto-login finds one or the user opts to remember on
  // submit; cleared by "log out & forget".
  const [remembered, setRemembered] = useState(false);
  // True only during the initial probe for a remembered credential, so we show
  // a brief spinner instead of flashing the login form before auto-login runs.
  const [checking, setChecking] = useState(!authed);
  const autoTried = useRef(false);

  // Auto-login on entry: if not already authenticated and a credential is
  // remembered for this repeater, log in with it; otherwise fall back to the
  // gate. The ref guard keeps StrictMode's double-invoke from firing twice.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    // Already authenticated (e.g. a reconnect kept the session): `checking` was
    // initialized false, so nothing to probe.
    if (login === 'admin' || login === 'guest') return;
    let cancelled = false;
    void (async () => {
      const cred = await loadRepeaterCred(contact.pubkeyPrefix);
      if (cancelled) return;
      if (cred) {
        setRemembered(true);
        // A failed auto-login (e.g. the node's password changed) falls back to
        // the gate via the login toast; the stale credential is left in place
        // since the failure may be transient.
        void repeaterLogin(contact, cred.password, cred.access, true);
      }
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [contact, login, repeaterLogin]);

  const logoutForget = () => {
    resetAdminSession(contact.pubkeyPrefix);
    void clearRepeaterCred(contact.pubkeyPrefix);
    setRemembered(false);
  };

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      {/* Header */}
      <div
        className='flex shrink-0 items-center gap-2.5 border-b px-4 py-3'
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <span className='text-lg'>📡</span>
        <span className='text-[15px] font-semibold'>
          {contact.name || contact.pubkeyPrefix.slice(0, 8)}
        </span>
        <RouteChip contact={contact} />
        {authed && <AccessChip access={login} />}
        <div className='ml-auto flex items-center gap-3'>
          <span className='text-xs text-(--text2)'>
            {formatPubkey(contact.pubkey, showFullPublicKeys)}
          </span>
          {authed && (
            <button
              onClick={logoutForget}
              className='rounded-md px-2.5 py-1 text-xs text-(--text) hover:bg-(--surface2)'
            >
              {remembered
                ? t('repeaterAdmin.dashboard.logoutForget')
                : t('repeaterAdmin.dashboard.logout')}
            </button>
          )}
        </div>
      </div>

      {authed ? (
        <>
          <TabBar active={tab} onSelect={setTab} />
          <div className='flex-1 overflow-y-auto p-4'>
            {tab === 'status' && (
              <StatusDashboard
                status={session?.status}
                onRefresh={() => repeaterStatus(contact)}
              />
            )}
          </div>
        </>
      ) : (
        <div className='flex-1 overflow-y-auto p-4'>
          {checking ? (
            <p className='text-sm text-(--text2)'>
              {t('repeaterAdmin.login.checking')}
            </p>
          ) : (
            <div className='mx-auto max-w-md'>
              <LoginGate
                pending={login === 'pending'}
                onSubmit={(password, kind, remember) => {
                  setRemembered(remember);
                  void repeaterLogin(contact, password, kind, remember);
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The access-level badge shown in the header once authenticated. */
function AccessChip({ access }: { access: RepeaterAccess }) {
  const { t } = useTranslation();
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        access === 'admin'
          ? 'bg-(--accent) text-white'
          : 'bg-(--surface2) text-(--text2)'
      }`}
    >
      {access === 'admin'
        ? t('repeaterAdmin.access.admin')
        : t('repeaterAdmin.access.guest')}
    </span>
  );
}

/** The admin tab strip. Data-driven off {@link TABS} so 7.5/7.6 extend it. */
function TabBar({
  active,
  onSelect,
}: {
  active: RepeaterTab;
  onSelect: (tab: RepeaterTab) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className='flex shrink-0 gap-1 border-b border-(--border) px-3'>
      {TABS.map((id) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${
            active === id
              ? 'border-(--accent) font-medium text-(--text)'
              : 'border-transparent text-(--text2) hover:text-(--text)'
          }`}
        >
          {t(`repeaterAdmin.tabs.${id}`)}
        </button>
      ))}
    </div>
  );
}

/**
 * The login form: a password field, an Admin/Guest access choice, a "remember"
 * toggle (default off), and a submit that dispatches the login. While
 * `pending`, the form is disabled and the button shows a progress label. The
 * password lives only in local state and is neither persisted nor auto-filled.
 */
function LoginGate({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (password: string, kind: RepeaterAccess, remember: boolean) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [kind, setKind] = useState<RepeaterAccess>('admin');
  const [remember, setRemember] = useState(false);

  const submit = () => {
    // An empty password is a valid guest login; only Admin requires one.
    if (pending || (kind === 'admin' && password === '')) return;
    onSubmit(password, kind, remember);
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

      <label className='flex items-center gap-2 text-sm text-(--text)'>
        <input
          type='checkbox'
          disabled={pending}
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className='h-4 w-4 accent-(--accent) disabled:opacity-50'
        />
        <span>{t('repeaterAdmin.login.remember')}</span>
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
 * The Status tab: grouped cards of the repeater's live status with a Refresh
 * button. Fetches once on mount (first entry) and again on demand; the fetched
 * status is read from the store.
 */
function StatusDashboard({
  status,
  onRefresh,
}: {
  status?: RepeaterStatus;
  onRefresh: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const fetched = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await onRefresh();
    } finally {
      setLoading(false);
    }
  }, [onRefresh]);

  // Auto-fetch once on first entry. The ref guard keeps StrictMode's
  // double-invoke (and identity churn in `refresh`) from firing a second
  // request.
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
      <div className='flex justify-end'>
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
    ...opt(t('repeaterAdmin.uptime'), s.totalUpTimeSecs, formatUptime),
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
