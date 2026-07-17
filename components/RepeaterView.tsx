// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { loadRepeaterCred, clearRepeaterCred } from '@/lib/meshcore/adminCreds';
import { parseNeighborsReply, type Neighbor } from '@/lib/meshcore/repeaterCli';
import {
  formatAirtime,
  formatRelative,
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

/** Admin tabs in display order. */
const TABS = ['status', 'config', 'neighbors', 'console'] as const;
type RepeaterTab = (typeof TABS)[number];

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

  const [tab, setTab] = useState<RepeaterTab>(() => {
    // Returning from the map picker (Set on map in the Config tab) reopens on
    // Config so the just-picked coordinate lands where the user left off.
    const s = useMeshStore.getState();
    return s.pendingLocation && s.locationPickReturn === 'chat'
      ? 'config'
      : 'status';
  });
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
          <TabBar active={tab} onSelect={setTab} />
          <div className='flex-1 overflow-y-auto p-4'>
            {tab === 'status' && (
              <StatusDashboard
                status={session?.status}
                onRefresh={() => repeaterStatus(contact)}
              />
            )}
            {tab === 'config' && (
              <RepeaterConfigTab
                contact={contact}
                readOnly={login !== 'admin'}
              />
            )}
            {tab === 'neighbors' && (
              <NeighborsTab contact={contact} isAdmin={login === 'admin'} />
            )}
            {tab === 'console' && <ConsoleTab contact={contact} />}
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
    <div
      role='tablist'
      className='flex shrink-0 gap-1 border-b border-(--border) px-3'
    >
      {TABS.map((id) => (
        <button
          key={id}
          role='tab'
          aria-selected={active === id}
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
 * password is never auto-filled; it stays in local state and is persisted
 * (encrypted, per-radio) only when the user opts in via the remember toggle.
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
 * status is read from the store. Cards reuse the shared {@link StatCard} and
 * its shimmer skeleton while a fetch is in flight, matching the Stats page.
 */
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
  const dbm = (n: number) => t('repeaterAdmin.dbm', { value: num(n) });
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
      rows: s
        ? [
            [t('repeaterAdmin.battery'), formatVoltage(s.battMilliVolts)],
            [
              t('repeaterAdmin.batteryPercent'),
              `${approxBatteryPercent(s.battMilliVolts)}%`,
            ],
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
            ...opt(t('repeaterAdmin.noiseFloor'), s.noiseFloor, dbm),
            ...opt(t('repeaterAdmin.lastRssi'), s.lastRssi, dbm),
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
            .map(({ title: cardTitle, rows }) => (
              <StatCard key={cardTitle} title={cardTitle} rows={rows ?? []} />
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

/**
 * Resolves a neighbor's public-key prefix to a saved contact's name, matching
 * a contact whose full key (or its own stored prefix) begins with the reported
 * prefix, or vice versa — the two prefix lengths need not match. Returns `null`
 * when no contact corresponds, so the caller shows the raw hex prefix instead.
 */
function resolveNeighborName(
  prefix: string,
  contacts: Record<string, Contact>,
): string | null {
  const lower = prefix.toLowerCase();
  for (const c of Object.values(contacts)) {
    const key = c.pubkey.toLowerCase();
    const keyPrefix = c.pubkeyPrefix.toLowerCase();
    if (
      key.startsWith(lower) ||
      keyPrefix.startsWith(lower) ||
      lower.startsWith(keyPrefix)
    ) {
      return c.name || null;
    }
  }
  return null;
}

/**
 * The Neighbors tab: the repeater's up-to-8 most recently heard nodes, read via
 * the `neighbors` CLI command and parsed by {@link parseNeighborsReply}. Each
 * row shows the node (resolved to a saved contact's name when known), how long
 * ago it was heard, and its SNR. Admins get a per-row Remove (with an inline
 * confirm) that sends `neighbor.remove <prefix>` for that exact prefix — never
 * a blank/space prefix, which the firmware would treat as "remove all". Fetches
 * once on entry and again on demand via Refresh.
 */
function NeighborsTab({
  contact,
  isAdmin,
}: {
  contact: Contact;
  isAdmin: boolean;
}) {
  const { t } = useTranslation();
  const { repeaterCliRequest, repeaterCli, clearRepeaterCli } = useMeshCore();
  const contacts = useMeshStore((s) => s.contacts);
  const prefix = contact.pubkeyPrefix;

  const [neighbors, setNeighbors] = useState<Neighbor[] | null>(null);
  const [loading, setLoading] = useState(false);
  // The prefix whose Remove is awaiting inline confirmation, or `null`.
  const [confirming, setConfirming] = useState<string | null>(null);
  // Prefixes with a `neighbor.remove` in flight, so their row disables.
  const [removing, setRemoving] = useState<Set<string>>(() => new Set());
  const fetched = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setConfirming(null);
    try {
      const reply = await repeaterCliRequest(contact, 'neighbors');
      setNeighbors(parseNeighborsReply(reply));
    } catch {
      // A timeout or dropped link leaves the list empty; the empty state and
      // the Refresh button let the user retry. The hook owns any toast.
      setNeighbors([]);
    } finally {
      setLoading(false);
    }
  }, [contact, repeaterCliRequest]);

  // Fetch once on first entry; the ref guard survives StrictMode's double
  // mount.
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    void refresh();
  }, [refresh]);

  // Drop any pending `neighbors`/`neighbor.remove` waiter on tab unmount.
  useEffect(() => () => clearRepeaterCli(prefix), [clearRepeaterCli, prefix]);

  const remove = async (neighborPrefix: string) => {
    // Guard against an empty/space prefix, which the firmware treats as
    // "remove all neighbors".
    if (neighborPrefix.trim() === '') return;
    setConfirming(null);
    setRemoving((prev) => new Set(prev).add(neighborPrefix));
    const ok = await repeaterCli(contact, `neighbor.remove ${neighborPrefix}`);
    setRemoving((prev) => {
      const next = new Set(prev);
      next.delete(neighborPrefix);
      return next;
    });
    if (ok) await refresh();
  };

  return (
    <div className='mx-auto w-full max-w-4xl space-y-4'>
      <div className='flex justify-end'>
        <RefreshButton onClick={() => void refresh()} busy={loading} />
      </div>

      {neighbors && neighbors.length > 0 ? (
        <div className='overflow-hidden rounded-lg border border-(--border)'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-(--border) text-left text-xs text-(--text2)'>
                <th className='px-3 py-2 font-medium'>
                  {t('repeaterAdmin.neighbors.node')}
                </th>
                <th className='px-3 py-2 font-medium'>
                  {t('repeaterAdmin.neighbors.lastHeard')}
                </th>
                <th className='px-3 py-2 font-medium'>
                  {t('repeaterAdmin.neighbors.snr')}
                </th>
                {isAdmin && <th className='px-3 py-2' />}
              </tr>
            </thead>
            <tbody>
              {neighbors.map((n) => {
                const name = resolveNeighborName(n.prefix, contacts);
                const busy = removing.has(n.prefix);
                return (
                  <tr
                    key={n.prefix}
                    className='border-b border-(--border) last:border-0'
                  >
                    <td className='px-3 py-2'>
                      {name ? (
                        <span className='text-(--text)'>{name}</span>
                      ) : (
                        <span className='font-mono text-xs text-(--text2)'>
                          {n.prefix}
                        </span>
                      )}
                    </td>
                    <td className='px-3 py-2 text-(--text2)'>
                      {formatRelative(n.lastHeard)}
                    </td>
                    <td className='px-3 py-2 text-(--text2)'>
                      {formatSnr(n.snr)}
                    </td>
                    {isAdmin && (
                      <td className='px-3 py-2 text-right'>
                        {confirming === n.prefix ? (
                          <span className='inline-flex items-center gap-2'>
                            <span className='text-xs text-(--text2)'>
                              {t('repeaterAdmin.neighbors.removeConfirm')}
                            </span>
                            <button
                              onClick={() => void remove(n.prefix)}
                              disabled={busy}
                              className='rounded-md border border-(--red) px-2 py-0.5 text-xs text-(--red) hover:bg-(--red-dim) hover:text-white disabled:opacity-50'
                            >
                              {t('repeaterAdmin.neighbors.confirm')}
                            </button>
                            <button
                              onClick={() => setConfirming(null)}
                              disabled={busy}
                              className='rounded-md border border-(--border-control) px-2 py-0.5 text-xs text-(--text2) hover:bg-(--surface2) disabled:opacity-50'
                            >
                              {t('repeaterAdmin.neighbors.cancel')}
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirming(n.prefix)}
                            disabled={busy}
                            className='rounded-md border border-(--border-control) px-2 py-0.5 text-xs text-(--text2) hover:bg-(--surface2) disabled:opacity-50'
                          >
                            {busy
                              ? t('repeaterAdmin.neighbors.removing')
                              : t('repeaterAdmin.neighbors.remove')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className='text-sm text-(--text2)'>
          {loading
            ? t('repeaterAdmin.neighbors.loading')
            : t('repeaterAdmin.neighbors.empty')}
        </p>
      )}
    </div>
  );
}

/**
 * The Console tab: a raw CLI transcript bound to the per-repeater
 * `adminSessions[prefix].cli` log, with a text input that sends arbitrary
 * commands via `repeaterCli`. Outgoing lines (the `own` flag) render distinctly
 * from the node's replies, which arrive unordered but append chronologically.
 * Clear empties the transcript (bounded by the store). Guests may send
 * read-only commands; the node rejects unauthorized writes with an `Err - …`
 * line shown verbatim.
 */
function ConsoleTab({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const { repeaterCli } = useMeshCore();
  const prefix = contact.pubkeyPrefix;
  const log = useMeshStore((s) => s.adminSessions[prefix]?.cli);
  const clearCliLog = useMeshStore((s) => s.clearCliLog);
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
    void repeaterCli(contact, cmd);
  };

  const lines = log ?? [];

  return (
    <div className='mx-auto flex h-full w-full max-w-4xl flex-col gap-3'>
      <div className='flex justify-end'>
        <button
          onClick={() => clearCliLog(prefix)}
          disabled={lines.length === 0}
          className='rounded-md border border-(--border-control) px-2.5 py-1 text-xs text-(--text2) hover:bg-(--surface2) disabled:opacity-50'
        >
          {t('repeaterAdmin.console.clear')}
        </button>
      </div>

      <div className='flex-1 overflow-y-auto rounded-lg border border-(--border) bg-(--surface) p-3 font-mono text-xs'>
        {lines.length === 0 ? (
          <p className='text-(--text2)'>{t('repeaterAdmin.console.empty')}</p>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className={
                line.own
                  ? 'wrap-break-word whitespace-pre-wrap text-(--accent)'
                  : 'wrap-break-word whitespace-pre-wrap text-(--text)'
              }
            >
              {line.own ? `> ${line.text}` : line.text}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

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
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('repeaterAdmin.console.placeholder')}
          className='flex-1 rounded-md border border-(--border-control) bg-(--surface) px-2.5 py-1.5 font-mono text-sm text-(--text) outline-none focus:border-(--accent)'
        />
        <button
          type='submit'
          disabled={input.trim() === ''}
          className='rounded-md bg-(--accent) px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
        >
          {t('repeaterAdmin.console.send')}
        </button>
      </form>
    </div>
  );
}
