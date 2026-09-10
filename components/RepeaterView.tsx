// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import dynamic from 'next/dynamic';
import { Eye, EyeOff, Trash2 } from 'lucide-react';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { loadRepeaterCred, clearRepeaterCred } from '@/lib/meshcore/adminCreds';
import { parseNeighborsReply } from '@/lib/meshcore/repeaterCli';
import { isErrorReply } from '@/lib/meshcore/repeaterConfig';
import { ADV_TYPE_REPEATER } from '@/lib/meshcore/constants';
import { locateNeighborNode } from '@/lib/map/nodes';
import { handleRovingKeyDown } from '@/lib/ui/roving';
import {
  formatAirtime,
  formatDbm,
  formatPercent,
  formatSnr,
  formatUptime,
  formatVoltage,
} from '@/lib/i18n/format';
import { formatPubkey } from '@/lib/utils';
import { RouteChip } from './RouteChip';
import { StatCard } from './StatCard';
import { RefreshButton } from './RefreshButton';
import { RepeaterConfigTab } from './RepeaterConfigTab';
import type { Contact, RepeaterAccess, RepeaterStatus } from '@/types/meshcore';

// Leaflet and the neighbors map are loaded only when a located repeater with
// locatable neighbors opens the tab, keeping the initial bundle lean. `ssr:
// false` skips it during the static export, since Leaflet needs the DOM.
const NeighborsMap = dynamic(
  () => import('./NeighborsMap').then((m) => ({ default: m.NeighborsMap })),
  { ssr: false },
);

const BATT_MIN_MV = 3300;
const BATT_MAX_MV = 4200;

// A deliberately crude linear map between BATT_MIN_MV (0%) and BATT_MAX_MV
// (100%) — the result is only approximate.
function approxBatteryPercent(milliVolts: number): number {
  const pct = ((milliVolts - BATT_MIN_MV) / (BATT_MAX_MV - BATT_MIN_MV)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

type RepeaterTab = 'status' | 'config' | 'neighbors' | 'console';

/**
 * The main-window remote-admin view for a repeater or room server, shown in
 * place of the chat pane when either is selected in the sidebar (or the command
 * palette). Resolves the target contact from the active conversation; renders
 * nothing useful if it has been evicted.
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
  const prefix = contact.pubkeyPrefix;

  // Which tabs this session may see. Status is available to guests too (the
  // firmware answers a status request for any authed client), but every other
  // surface is admin-only: current repeater/room firmware handles remote
  // `TXT_TYPE_CLI_DATA` only for `client->isAdmin()`, so a guest gets no reply
  // to a config read, neighbors query, or console command. Neighbors is
  // additionally repeater-only — a room server's `formatNeighborsReply`
  // returns "not supported".
  const isAdmin = login === 'admin';
  const isRepeater = contact.advType === ADV_TYPE_REPEATER;
  const tabs = useMemo<RepeaterTab[]>(() => {
    const list: RepeaterTab[] = ['status'];
    if (isAdmin) list.push('config');
    if (isAdmin && isRepeater) list.push('neighbors');
    if (isAdmin) list.push('console');
    return list;
  }, [isAdmin, isRepeater]);
  const [tab, setTab] = useState<RepeaterTab>(() => {
    // Returning from the map picker (Set on map in the Config tab) reopens on
    // Config so the just-picked coordinate lands where the user left off.
    const s = useMeshStore.getState();
    return s.pendingLocation && s.locationPickReturn === 'chat'
      ? 'config'
      : 'status';
  });
  // The selected tab clamped to what this session may see. `tab` persists a
  // logout/re-login (the view stays mounted), so an admin who was on
  // Neighbors/Console and logs back in as a guest must not keep rendering a
  // now-hidden panel — fall back to Status.
  const activeTab = tabs.includes(tab) ? tab : 'status';
  // True only during the initial credential probe (from a clean logged-out
  // state), so we show a brief spinner instead of flashing the login form
  // before auto-login runs. A `pending` login shows the disabled gate instead.
  const [checking, setChecking] = useState(login === 'loggedOut');

  // Captured once at mount (the component is keyed by `prefix`, so it remounts
  // per repeater). The auto-login effect reads these without listing them as
  // dependencies, so an unrelated contact update can't re-run the effect and
  // cancel its own in-flight credential probe (which would strand the
  // "checking" spinner). The pubkey is immutable, so the mount-time contact is
  // valid for the login command.
  const contactRef = useRef(contact);
  const repeaterLoginRef = useRef(repeaterLogin);
  const loginRef = useRef(login);

  // On entry, when there is no live session yet, probe the encrypted store for
  // a remembered credential and auto-log-in with it. Keyed by the stable
  // `prefix`, so it runs once per repeater (remounted when the selection
  // changes).
  useEffect(() => {
    // Only probe from a clean logged-out state. Skipping `admin`/`guest`
    // avoids clobbering a live session; skipping `pending` avoids queuing a
    // second login when the view remounts mid-login (e.g. switching away and
    // back during a multi-hop handshake).
    if (loginRef.current !== 'loggedOut') return;
    let cancelled = false;
    void (async () => {
      const cred = await loadRepeaterCred(prefix);
      if (cancelled) return;
      if (cred) {
        // A failed auto-login (e.g. the node's password changed) falls back to
        // the gate via the login toast; the stale credential is left in place
        // since the failure may be transient.
        void repeaterLoginRef.current(
          contactRef.current,
          cred.password,
          cred.access,
          true,
        );
      }
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [prefix]);

  // Logging out also forgets any remembered credential, so the next visit
  // re-prompts instead of silently auto-logging back in.
  const logOut = () => {
    resetAdminSession(contact.pubkeyPrefix);
    void clearRepeaterCred(contact.pubkeyPrefix);
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
              onClick={logOut}
              className='rounded-md border border-(--red) px-2.5 py-1 text-xs text-(--red) hover:bg-(--red-dim) hover:text-white'
            >
              {t('repeaterAdmin.dashboard.logout')}
            </button>
          )}
        </div>
      </div>

      {authed ? (
        <>
          <TabBar tabs={tabs} active={activeTab} onSelect={setTab} />
          <div
            id='repeater-tabpanel'
            role='tabpanel'
            aria-labelledby={`repeater-tab-${activeTab}`}
            className='flex-1 overflow-y-auto p-4'
          >
            {activeTab === 'status' && (
              <StatusDashboard
                status={session?.status}
                onRefresh={() => repeaterStatus(contact)}
              />
            )}
            {activeTab === 'config' && <RepeaterConfigTab contact={contact} />}
            {activeTab === 'neighbors' && <NeighborsTab contact={contact} />}
            {activeTab === 'console' && <ConsoleTab contact={contact} />}
          </div>
        </>
      ) : (
        <div className='flex flex-1 flex-col items-center justify-center overflow-y-auto p-4'>
          {checking ? (
            <p className='text-sm text-(--text2)'>
              {t('repeaterAdmin.login.checking')}
            </p>
          ) : (
            <div className='w-full max-w-md'>
              <LoginGate
                pending={login === 'pending'}
                onSubmit={(password, kind, remember) =>
                  void repeaterLogin(contact, password, kind, remember)
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AccessChip({ access }: { access: RepeaterAccess }) {
  const { t } = useTranslation();
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        access === 'admin'
          ? 'bg-(--accent-solid) text-white'
          : 'bg-(--surface2) text-(--text2)'
      }`}
    >
      {access === 'admin'
        ? t('repeaterAdmin.access.admin')
        : t('repeaterAdmin.access.guest')}
    </span>
  );
}

function TabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: readonly RepeaterTab[];
  active: RepeaterTab;
  onSelect: (tab: RepeaterTab) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role='tablist'
      aria-label={t('repeaterAdmin.tabsLabel')}
      onKeyDown={(e) =>
        handleRovingKeyDown(e, tabs.length, tabs.indexOf(active), (i) =>
          onSelect(tabs[i]),
        )
      }
      className='flex shrink-0 gap-1 overflow-x-auto border-b border-(--border) px-3'
    >
      {tabs.map((id) => (
        <button
          key={id}
          role='tab'
          id={`repeater-tab-${id}`}
          aria-selected={active === id}
          aria-controls='repeater-tabpanel'
          tabIndex={active === id ? 0 : -1}
          onClick={() => onSelect(id)}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
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

// The password is never auto-filled: it stays in local state and is persisted
// (encrypted, per-radio) only when the user opts in via the remember toggle.
function LoginGate({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (password: string, kind: RepeaterAccess, remember: boolean) => void;
}) {
  const { t } = useTranslation();
  const passwordId = useId();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
        onKeyDown={(e) =>
          handleRovingKeyDown(e, 2, kind === 'admin' ? 0 : 1, (i) =>
            setKind(i === 0 ? 'admin' : 'guest'),
          )
        }
        className='grid grid-cols-2 gap-2'
      >
        {(['admin', 'guest'] as const).map((k) => (
          <button
            key={k}
            type='button'
            role='radio'
            aria-checked={kind === k}
            tabIndex={kind === k ? 0 : -1}
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

      <div>
        <label
          htmlFor={passwordId}
          className='mb-1 block text-xs text-(--text2)'
        >
          {t('repeaterAdmin.login.password')}
        </label>
        <div className='relative'>
          <input
            id={passwordId}
            type={showPassword ? 'text' : 'password'}
            autoComplete='off'
            autoFocus
            disabled={pending}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('repeaterAdmin.login.passwordPlaceholder')}
            className='w-full rounded-md border border-(--border-control) bg-(--surface) py-1.5 pr-9 pl-2 text-sm text-(--text) outline-none focus:border-(--accent) disabled:opacity-50'
          />
          <button
            type='button'
            onClick={() => setShowPassword((v) => !v)}
            disabled={pending}
            aria-label={t(
              showPassword
                ? 'repeaterAdmin.login.hidePassword'
                : 'repeaterAdmin.login.showPassword',
            )}
            title={t(
              showPassword
                ? 'repeaterAdmin.login.hidePassword'
                : 'repeaterAdmin.login.showPassword',
            )}
            className='absolute inset-y-0 right-0 flex items-center px-2 text-(--text2) hover:text-(--text) disabled:opacity-50'
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

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
          className='rounded-md bg-(--accent-solid) px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50'
        >
          {pending
            ? t('repeaterAdmin.login.loggingIn')
            : t('repeaterAdmin.login.submit')}
        </button>
      </div>
    </form>
  );
}

function StatusDashboard({
  status,
  onRefresh,
}: {
  status?: RepeaterStatus;
  onRefresh: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  // Skeletons only when there's no cached status; a cached snapshot (kept in
  // the admin session) renders immediately so returning to the tab stays
  // populated.
  const [loading, setLoading] = useState(status == null);
  const fetched = useRef(false);
  // Whether a cached status was present at mount, so the auto-read is skipped
  // when returning to an already-loaded tab (the user Refreshes for fresh
  // data).
  const hadCache = useRef(status != null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await onRefresh();
    } finally {
      setLoading(false);
    }
  }, [onRefresh]);

  // Auto-fetch once on first entry, unless a cached status is already showing.
  // The ref guard keeps StrictMode's double-invoke (and identity churn in
  // `refresh`) from firing a second request.
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    if (hadCache.current) return;
    void refresh();
  }, [refresh]);

  const num = (n: number) => n.toLocaleString(i18n.language);
  // Shared responsive layout for the stat cards (loading and loaded).
  const gridClass = 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3';
  const s = status;
  // Include a row only when the firmware reported that field.
  const opt = (
    label: string,
    value: number | undefined,
    fmt: (n: number) => string,
  ): [string, string][] => (value == null ? [] : [[label, fmt(value)]]);

  // One descriptor per card: `labels` drives the loading skeleton (one shimmer
  // row per label) and `rows` the loaded values (dropping unreported fields) —
  // the same shape the Stats page uses so the layout doesn't shift.
  const cards: {
    title: string;
    labels: string[];
    meter?: { label: string; percent: number; text: string };
    rows: [string, string][] | null;
  }[] = [
    {
      title: t('repeaterAdmin.card.power'),
      labels: [
        t('repeaterAdmin.battery'),
        t('repeaterAdmin.batteryPercent'),
        t('repeaterAdmin.uptime'),
        t('repeaterAdmin.queueLength'),
      ],
      meter: s
        ? {
            label: t('repeaterAdmin.batteryPercent'),
            percent: approxBatteryPercent(s.battMilliVolts),
            text: formatPercent(approxBatteryPercent(s.battMilliVolts)),
          }
        : undefined,
      rows: s
        ? [
            [t('repeaterAdmin.battery'), formatVoltage(s.battMilliVolts)],
            ...opt(t('repeaterAdmin.uptime'), s.totalUpTimeSecs, formatUptime),
            [t('repeaterAdmin.queueLength'), num(s.currTxQueueLen)],
          ]
        : null,
    },
    {
      title: t('repeaterAdmin.card.radio'),
      labels: [
        t('repeaterAdmin.noiseFloor'),
        t('repeaterAdmin.lastRssi'),
        t('repeaterAdmin.lastSnr'),
      ],
      rows: s
        ? [
            ...opt(t('repeaterAdmin.noiseFloor'), s.noiseFloor, formatDbm),
            ...opt(t('repeaterAdmin.lastRssi'), s.lastRssi, formatDbm),
            ...opt(t('repeaterAdmin.lastSnr'), s.lastSnr, formatSnr),
          ]
        : null,
    },
    {
      title: t('repeaterAdmin.card.airtime'),
      labels: [t('repeaterAdmin.txAirtime'), t('repeaterAdmin.rxAirtime')],
      rows: s
        ? [
            ...opt(
              t('repeaterAdmin.txAirtime'),
              s.totalAirTimeSecs,
              formatAirtime,
            ),
            ...opt(
              t('repeaterAdmin.rxAirtime'),
              s.totalRxAirTimeSecs,
              formatAirtime,
            ),
          ]
        : null,
    },
    {
      title: t('repeaterAdmin.card.packets'),
      labels: [
        t('repeaterAdmin.received'),
        t('repeaterAdmin.sent'),
        t('repeaterAdmin.floodTx'),
        t('repeaterAdmin.floodRx'),
        t('repeaterAdmin.directTx'),
        t('repeaterAdmin.directRx'),
        t('repeaterAdmin.floodDups'),
        t('repeaterAdmin.directDups'),
        t('repeaterAdmin.rxErrors'),
      ],
      rows: s
        ? [
            ...opt(t('repeaterAdmin.received'), s.nPacketsRecv, num),
            ...opt(t('repeaterAdmin.sent'), s.nPacketsSent, num),
            ...opt(t('repeaterAdmin.floodTx'), s.nSentFlood, num),
            ...opt(t('repeaterAdmin.floodRx'), s.nRecvFlood, num),
            ...opt(t('repeaterAdmin.directTx'), s.nSentDirect, num),
            ...opt(t('repeaterAdmin.directRx'), s.nRecvDirect, num),
            ...opt(t('repeaterAdmin.floodDups'), s.nFloodDups, num),
            ...opt(t('repeaterAdmin.directDups'), s.nDirectDups, num),
            ...opt(t('repeaterAdmin.rxErrors'), s.nRecvErrors, num),
          ]
        : null,
    },
  ];

  return (
    <div className='mx-auto w-full max-w-6xl space-y-4'>
      <div className='flex justify-end'>
        <RefreshButton onClick={() => void refresh()} busy={loading} />
      </div>

      {loading ? (
        <div className={gridClass}>
          {cards.map(({ title: cardTitle, labels }) => (
            <StatCard
              key={cardTitle}
              title={cardTitle}
              loading
              rows={labels.map((label) => [label, ''])}
            />
          ))}
        </div>
      ) : status ? (
        <div className={gridClass}>
          {cards
            .filter((c) => c.rows && c.rows.length > 0)
            .map(({ title: cardTitle, rows, meter }) => (
              <StatCard
                key={cardTitle}
                title={cardTitle}
                rows={rows ?? []}
                meter={meter}
              />
            ))}
        </div>
      ) : (
        <p className='text-sm text-(--text2)'>
          {t('repeaterAdmin.dashboard.unavailable')}
        </p>
      )}
    </div>
  );
}

// Held at module scope, not per-tab, so a remount (tab switch) joins the
// outstanding read instead of starting a duplicate or briefly showing a false
// empty. Storing the promise — rather than a flag — lets every mount await the
// same reply text. The entry is removed once the read settles.
const neighborsRequests = new Map<string, Promise<string>>();

function NeighborsTab({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const { repeaterCliRequest } = useMeshCore();
  const contacts = useMeshStore((s) => s.contacts);
  const advertCache = useMeshStore((s) => s.advertCache);
  const prefix = contact.pubkeyPrefix;

  // Cached in the per-repeater session so the list stays populated across
  // navigation; the store is its source of truth. `undefined` until the first
  // read, an empty array once a read settles with no neighbors.
  const neighbors = useMeshStore((s) => s.adminSessions[prefix]?.neighbors);
  const setRepeaterNeighbors = useMeshStore((s) => s.setRepeaterNeighbors);

  // The map renders only when the repeater itself is located and at least one
  // neighbor resolves to a saved contact/advert with a fix; otherwise there is
  // nothing to anchor or draw, so the tab shows an explanatory placeholder.
  const mappableCount = useMemo(() => {
    if (!contact.advLat || !contact.advLon) return 0;
    return (neighbors ?? []).filter((n) =>
      locateNeighborNode(n.prefix, contacts, advertCache),
    ).length;
  }, [contact.advLat, contact.advLon, neighbors, contacts, advertCache]);

  const [loading, setLoading] = useState(false);
  // Set when a read fails (timeout/disconnect). Distinct from a settled empty
  // list so the tab can show an error (and keep any cached data) instead of a
  // false "no neighbors".
  const [errored, setErrored] = useState(false);
  const fetched = useRef(false);
  // Whether a cached list was present at mount, so the auto-read is skipped
  // when returning to an already-loaded tab (the user Refreshes for fresh
  // data).
  const hadCache = useRef(neighbors != null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    try {
      // Join an outstanding read for this repeater if one exists, else start
      // one. Sharing the promise dedupes concurrent reads and lets a remount
      // await the same settlement instead of showing a transient false empty.
      let request = neighborsRequests.get(prefix);
      if (!request) {
        request = repeaterCliRequest(contact, 'neighbors').finally(() => {
          neighborsRequests.delete(prefix);
        });
        neighborsRequests.set(prefix, request);
      }
      const reply = await request;
      // A protocol-level rejection (`Err …`/`Unknown command`, e.g. on firmware
      // without the command) resolves the request but is not an empty list —
      // treat it as an error so it isn't cached as "no neighbors".
      if (isErrorReply(reply)) {
        setErrored(true);
        return;
      }
      setRepeaterNeighbors(prefix, parseNeighborsReply(reply));
    } catch {
      // A timeout or dropped link is an error, not "no neighbors": surface an
      // error state and preserve any cached list rather than clearing it.
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [contact, prefix, repeaterCliRequest, setRepeaterNeighbors]);

  // Fetch once on first entry, unless a cached list is already showing. The
  // ref guard survives StrictMode's double mount; `refresh` itself joins an
  // outstanding read, so a remount mid-flight won't duplicate it.
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    if (hadCache.current) return;
    void refresh();
  }, [refresh]);

  // The in-flight `neighbors` request is deliberately *not* cancelled on
  // unmount. Cancelling would reject its queued CLI slot, letting the queue
  // advance while the repeater is still replying — a late reply could then
  // resolve the next command's waiter (e.g. one sent from the Console tab). The
  // result is cached in the store, so letting the request run to completion is
  // both correct and harmless when the user has navigated away.

  return (
    <div className='h-full w-full'>
      {mappableCount > 0 ? (
        <NeighborsMap
          contact={contact}
          neighbors={neighbors ?? []}
          control={
            <RefreshButton
              onClick={() => void refresh()}
              busy={loading}
              className='bg-(--surface)'
            />
          }
        />
      ) : (
        <div className='relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg border border-(--border)'>
          <RefreshButton
            onClick={() => void refresh()}
            busy={loading}
            className='absolute top-2 right-2 z-10 bg-(--surface)'
          />
          <p className='px-6 text-center text-sm text-(--text2)'>
            {errored
              ? t('repeaterAdmin.neighbors.error')
              : loading
                ? t('repeaterAdmin.neighbors.loading')
                : !(neighbors && neighbors.length > 0)
                  ? t('repeaterAdmin.neighbors.empty')
                  : contact.advLat && contact.advLon
                    ? t('repeaterAdmin.neighbors.noLocation')
                    : t('repeaterAdmin.neighbors.noAnchor')}
          </p>
        </div>
      )}
    </div>
  );
}

// The console's "still waiting" glyph, shared by the in-line and standalone
// placements.
const PENDING_DOT_CLASS =
  'ml-2 inline-block h-2.5 w-2.5 animate-spin rounded-full border border-(--text2) border-t-transparent align-middle';

// Admin-only: current repeater/room firmware answers remote `CLI_DATA` only
// for an admin client, so a guest would get no reply.
function ConsoleTab({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const { repeaterCli } = useMeshCore();
  const prefix = contact.pubkeyPrefix;
  const log = useMeshStore((s) => s.adminSessions[prefix]?.cli);
  const clearCliLog = useMeshStore((s) => s.clearCliLog);
  // Outstanding round trips are tracked in the session, not here, so switching
  // tabs and back while a slow command is in flight keeps the indicator.
  const cliPending = useMeshStore(
    (s) => s.adminSessions[prefix]?.cliPending ?? 0,
  );
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest line in view as the transcript grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [log]);

  const send = () => {
    const cmd = input.trim();
    if (cmd === '') return;
    setInput('');
    // Every outcome lands in the transcript — the reply, or a muted note when
    // the node stays silent — so there is nothing to report here.
    void repeaterCli(contact, cmd);
  };

  const lines = log ?? [];
  // The indicator belongs on the newest command, which is not always the newest
  // line: a reply or timeout note for an earlier command can land after it.
  const lastOwn = lines.findLastIndex((l) => l.own);

  return (
    <div className='flex h-full w-full flex-col gap-3'>
      <div className='relative flex-1 overflow-hidden rounded-lg border border-(--border) bg-(--surface)'>
        <button
          onClick={() => clearCliLog(prefix)}
          disabled={lines.length === 0}
          aria-label={t('repeaterAdmin.console.clear')}
          title={t('repeaterAdmin.console.clear')}
          className='absolute top-2 right-2 z-10 rounded-md border border-(--border-control) bg-(--surface) p-1.5 text-(--text2) hover:bg-(--surface2) hover:text-(--text) disabled:opacity-50 disabled:hover:bg-(--surface) disabled:hover:text-(--text2)'
        >
          <Trash2 size={14} />
        </button>

        <div
          role='log'
          aria-live='polite'
          aria-label={t('repeaterAdmin.console.transcriptLabel')}
          className='h-full overflow-y-auto p-3 font-mono text-xs'
        >
          {lines.length === 0 && cliPending === 0 ? (
            <p className='text-(--text2)'>{t('repeaterAdmin.console.empty')}</p>
          ) : (
            lines.map((line, i) => (
              <div
                key={i}
                className={
                  line.note
                    ? 'wrap-break-word whitespace-pre-wrap text-(--text2) italic'
                    : line.own
                      ? 'wrap-break-word whitespace-pre-wrap text-(--accent)'
                      : 'wrap-break-word whitespace-pre-wrap text-(--text)'
                }
              >
                {line.own ? `> ${line.text}` : line.text}
                {cliPending > 0 && i === lastOwn && (
                  <span aria-hidden className={PENDING_DOT_CLASS} />
                )}
              </div>
            ))
          )}
          {/* Clearing the transcript mid-round-trip leaves no own line to hang
              the indicator on, so it falls back to a standalone row. Hidden
              from assistive tech, which gets the live-region status below. */}
          {cliPending > 0 && lastOwn === -1 && (
            <div aria-hidden className='text-(--text2) italic'>
              {t('repeaterAdmin.console.waiting')}
              <span className={PENDING_DOT_CLASS} />
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <span role='status' aria-live='polite' className='sr-only'>
        {cliPending > 0 ? t('repeaterAdmin.console.waiting') : ''}
      </span>

      <form
        className='flex gap-2'
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          type='text'
          autoComplete='off'
          aria-label={t('repeaterAdmin.console.inputLabel')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('repeaterAdmin.console.placeholder')}
          className='flex-1 rounded-md border border-(--border-control) bg-(--surface) px-2.5 py-1.5 font-mono text-sm text-(--text) outline-none focus:border-(--accent)'
        />
        <button
          type='submit'
          disabled={input.trim() === ''}
          className='rounded-md bg-(--accent-solid) px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
        >
          {t('repeaterAdmin.console.send')}
        </button>
      </form>
    </div>
  );
}
