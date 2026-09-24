// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dynamic from 'next/dynamic';
import { useMeshStore, isAuthedLogin, roomConvoId } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useRepeaterAutoLogin } from '@/hooks/useRepeaterAutoLogin';
import { useClockTick } from '@/hooks/useClockTick';
import { clearRepeaterCred } from '@/lib/meshcore/adminCreds';
import { ADV_TYPE_REPEATER, ADV_TYPE_ROOM } from '@/lib/meshcore/constants';
import {
  repeaterAnchorNode,
  resolveNeighbor,
  type NeighborIdentity,
} from '@/lib/map/nodes';
import { handleRovingKeyDown } from '@/lib/ui/roving';
import { joinRead, sessionReadKey } from '@/lib/session/sharedReads';
import {
  formatAirtime,
  formatDbm,
  formatPercent,
  formatRatePercent,
  formatRelative,
  formatSnr,
  formatUptime,
  formatVoltage,
} from '@/lib/i18n/format';
import { ADV_ICON, formatPubkey } from '@/lib/utils';
import { ChatArea } from './ChatArea';
import { HintToken } from './MessageBubble';
import { RouteChip } from './RouteChip';
import { StatCard } from './StatCard';
import { RefreshButton } from './RefreshButton';
import { RepeaterAccessTab } from './RepeaterAccessTab';
import { RepeaterConfigTab } from './RepeaterConfigTab';
import { RepeaterConsoleTab } from './RepeaterConsoleTab';
import { RepeaterLoginGate } from './RepeaterLoginGate';
import { TelemetryPanel } from './TelemetryPanel';
import type {
  Contact,
  Neighbor,
  RepeaterAccess,
  RepeaterStatus,
} from '@/types/meshcore';

// Leaflet and the neighbors map are loaded only when a located repeater opens
// the tab, keeping the initial bundle lean. `ssr: false` skips it during the
// static export, since Leaflet needs the DOM.
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

type RepeaterTab =
  | 'posts'
  | 'status'
  | 'telemetry'
  | 'config'
  | 'neighbors'
  | 'access'
  | 'console';

/**
 * The main-window view for a repeater or room server, shown in place of the
 * chat pane when either is selected in the sidebar (or the command palette). A
 * room opens on its post feed; a repeater on remote-admin status. Resolves the
 * target contact from the active conversation; renders nothing useful if it
 * has been evicted.
 */
export function RepeaterView() {
  const { t } = useTranslation();
  const activeConvo = useMeshStore((s) => s.activeConvo);
  const contacts = useMeshStore((s) => s.contacts);
  const prefix =
    activeConvo?.kind === 'repeater' || activeConvo?.kind === 'room'
      ? (activeConvo.rawId as string)
      : undefined;
  const contact = prefix ? contacts[prefix] : undefined;

  if (!contact) {
    return (
      <div className='flex flex-1 items-center justify-center text-sm text-text2'>
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
  const { repeaterStatus } = useMeshCore();
  const autoLogin = useRepeaterAutoLogin(contact);
  const session = useMeshStore((s) => s.adminSessions[contact.pubkeyPrefix]);
  const resetAdminSession = useMeshStore((s) => s.resetAdminSession);
  const showFullPublicKeys = useMeshStore((s) => s.showFullPublicKeys);

  const login = session?.login ?? 'loggedOut';
  const authed = isAuthedLogin(login);
  const prefix = contact.pubkeyPrefix;
  // The node's own transmit budget, once the Config tab has read it. Only used
  // to flag a TX duty cycle that has already run past it, so anything the
  // firmware hasn't answered with a positive number simply means no flag —
  // note `Number('')` is `0`, which would otherwise flag every node.
  const configuredDuty = Number(session?.config?.dutycycle ?? NaN);
  const dutyCycleLimit = configuredDuty > 0 ? configuredDuty : undefined;

  // Which tabs this session may see. A room's post feed comes first and is
  // open to every logged-in role (a read-only member may read, just not post).
  // Status is available to guests too (the firmware answers a status request
  // for any authed client), but every other surface is admin-only: current
  // repeater/room firmware handles remote `TXT_TYPE_CLI_DATA` only for
  // `client->isAdmin()`, so a guest gets no reply to a config read, neighbors
  // query, or console command. Neighbors is additionally repeater-only — a
  // room server's `formatNeighborsReply` returns "not supported".
  const isAdmin = login === 'admin';
  const isRepeater = contact.advType === ADV_TYPE_REPEATER;
  const isRoom = contact.advType === ADV_TYPE_ROOM;
  const tabs = useMemo<RepeaterTab[]>(() => {
    // Telemetry needs no login at all, so it sits beside Status for every role.
    const list: RepeaterTab[] = isRoom
      ? ['posts', 'status', 'telemetry']
      : ['status', 'telemetry'];
    if (isAdmin) list.push('config');
    if (isAdmin && isRepeater) list.push('neighbors');
    // The access list is admin-only but not repeater-only: a room server
    // answers the same request, reporting just its admin entries.
    if (isAdmin) list.push('access', 'console');
    return list;
  }, [isAdmin, isRepeater, isRoom]);
  // Where a fresh selection of this node lands. Returning from the map picker
  // (Set on map in the Config tab) reopens on Config so the just-picked
  // coordinate arrives where the user left off.
  const defaultTab = (): RepeaterTab => {
    const s = useMeshStore.getState();
    return s.pendingLocation && s.locationPickReturn === 'chat'
      ? 'config'
      : isRoom
        ? 'posts'
        : 'status';
  };
  // Selecting this node again — from a drawer row, its sidebar row or the
  // command palette — must return to the default tab, or the post pointed at
  // stays hidden behind Status. The view is keyed by node, so re-opening the
  // one already on screen does not remount it; `convoOpenSeq` is what makes
  // that navigation visible here.
  const convoOpenSeq = useMeshStore((s) => s.convoOpenSeq);
  const [selection, setSelection] = useState(() => ({
    seq: convoOpenSeq,
    tab: defaultTab(),
  }));
  if (selection.seq !== convoOpenSeq) {
    setSelection({ seq: convoOpenSeq, tab: defaultTab() });
  }
  const setTab = (tab: RepeaterTab) => setSelection({ seq: convoOpenSeq, tab });
  // The selected tab clamped to what this session may see. It persists a
  // logout/re-login (the view stays mounted), so an admin who was on
  // Neighbors/Console and logs back in as a guest must not keep rendering a
  // now-hidden panel — fall back to the first tab this session may see.
  const activeTab = tabs.includes(selection.tab) ? selection.tab : tabs[0];
  // Report whether the post feed is actually rendered, so arrivals behind the
  // login gate or another tab stay unread and keep their drawer row.
  const setVisibleRoomFeed = useMeshStore((s) => s.setVisibleRoomFeed);
  const feedVisible = isRoom && authed && activeTab === 'posts';
  useEffect(() => {
    setVisibleRoomFeed(feedVisible ? roomConvoId(prefix) : null);
    return () => setVisibleRoomFeed(null);
  }, [feedVisible, prefix, setVisibleRoomFeed]);

  // Logging out also forgets any remembered credential, so the next visit
  // re-prompts instead of silently auto-logging back in. The encrypted record
  // and the copy the sign-in hook holds in memory both have to go: clearing
  // only the record would leave the gate still offering to replay a password
  // the user just told us to forget.
  const logOut = () => {
    resetAdminSession(contact.pubkeyPrefix);
    autoLogin.forget();
    void clearRepeaterCred(contact.pubkeyPrefix);
  };

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      {/* Header */}
      <div className='flex shrink-0 items-center gap-2.5 border-b px-4 py-3 bg-surface border-border'>
        <span className='text-lg'>{ADV_ICON[contact.advType] ?? '📡'}</span>
        <span className='text-[15px] font-semibold'>
          {contact.name || contact.pubkeyPrefix.slice(0, 8)}
        </span>
        <RouteChip contact={contact} />
        {authed && <AccessChip access={login} />}
        <div className='ml-auto flex items-center gap-3'>
          <span className='text-xs text-text2'>
            {formatPubkey(contact.pubkey, showFullPublicKeys)}
          </span>
          {authed && (
            <button
              onClick={logOut}
              className='rounded-md border border-red px-2.5 py-1 text-xs text-red hover:bg-red-dim hover:text-white'
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
            // The post feed brings its own scroller and composer, so it fills
            // the panel instead of sitting inside a padded one.
            className={
              activeTab === 'posts'
                ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
                : 'flex-1 overflow-y-auto p-4'
            }
          >
            {activeTab === 'posts' && <ChatArea />}
            {activeTab === 'status' && (
              <StatusDashboard
                status={session?.status}
                statusAt={session?.statusAt}
                dutyCycleLimit={dutyCycleLimit}
                onRefresh={() => repeaterStatus(contact)}
              />
            )}
            {activeTab === 'telemetry' && (
              <div className='mx-auto w-full max-w-6xl'>
                <TelemetryPanel contact={contact} />
              </div>
            )}
            {activeTab === 'config' && <RepeaterConfigTab contact={contact} />}
            {activeTab === 'neighbors' && <NeighborsTab contact={contact} />}
            {activeTab === 'access' && <RepeaterAccessTab contact={contact} />}
            {activeTab === 'console' && (
              <RepeaterConsoleTab contact={contact} />
            )}
          </div>
        </>
      ) : (
        <div className='flex flex-1 flex-col items-center justify-center overflow-y-auto p-4'>
          <RepeaterLoginGate
            contact={contact}
            isRoom={isRoom}
            pending={login === 'pending'}
            auto={autoLogin}
          />
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
          ? 'bg-accent-solid text-white'
          : 'bg-surface2 text-text2'
      }`}
    >
      {t(`repeaterAdmin.access.${access}`)}
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
      className='flex shrink-0 gap-1 overflow-x-auto border-b border-border px-3'
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
              ? 'border-accent font-medium text-text'
              : 'border-transparent text-text2 hover:text-text'
          }`}
        >
          {t(`repeaterAdmin.tabs.${id}`)}
        </button>
      ))}
    </div>
  );
}

function StatusDashboard({
  status,
  statusAt,
  dutyCycleLimit,
  onRefresh,
}: {
  status?: RepeaterStatus;
  /** Unix epoch seconds this snapshot was read, from this computer's clock. */
  statusAt?: number;
  /**
   * The node's configured transmit budget as a percentage, once the Config tab
   * has read it. Used only to flag a TX duty cycle that has run past it.
   */
  dutyCycleLimit?: number;
  onRefresh: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  // The freshness label is derived from the wall clock, so it needs its own
  // re-render to keep aging while the tab sits open.
  useClockTick();
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
  // Shared responsive layout for the stat cards (loading and loaded). Wrapping
  // flex rather than a fixed column count: a short final row grows to fill the
  // width instead of leaving dead cells.
  const gridClass = 'flex flex-wrap items-start gap-4';
  const s = status;
  // Include a row only when the firmware reported that field.
  const opt = (
    label: string,
    value: number | undefined,
    fmt: (n: number) => string,
  ): [string, string][] => (value == null ? [] : [[label, fmt(value)]]);

  // Same rule for a derived row, so a percentage is never left stranded above
  // an `opt` that dropped the counter it was computed from.
  const derived = (
    label: string,
    inputs: (number | undefined)[],
    value: () => React.ReactNode,
  ): [string, React.ReactNode][] =>
    inputs.some((n) => n == null) ? [] : [[label, value()]];

  // Airtime only means something against the uptime it accrued over — that
  // ratio is the duty cycle regulators cap. The raw pair stays reachable as a
  // hint, and a TX figure past the node's own configured budget is flagged.
  const dutyCycle = (
    airSecs: number | undefined,
    uptimeSecs: number | undefined,
    limitPercent?: number,
  ): React.ReactNode => {
    // The limit itself when it has been exceeded, so the flag and the text that
    // explains it are driven by one value.
    const exceeded =
      airSecs != null &&
      uptimeSecs != null &&
      uptimeSecs > 0 &&
      limitPercent != null &&
      (airSecs / uptimeSecs) * 100 > limitPercent
        ? limitPercent
        : null;
    return (
      <span className={exceeded !== null ? 'text-red' : undefined}>
        <HintToken
          label={formatRatePercent(airSecs, uptimeSecs)}
          align='right'
          title={
            airSecs != null && uptimeSecs != null
              ? `${formatAirtime(airSecs)} / ${formatUptime(uptimeSecs)}`
              : undefined
          }
        />
        {/* The red is a reinforcement, not the message: the state has to
            survive a reader who cannot perceive it. */}
        {exceeded !== null && (
          <span className='sr-only'>
            {' '}
            {t('repeaterAdmin.overDutyCycle', {
              // The setting is fractional (0.5 steps), so a 1.5 % budget must
              // not be announced as 2 %, which would contradict the flag.
              limit: formatPercent(
                exceeded,
                Number.isInteger(exceeded) ? 0 : 1,
              ),
            })}
          </span>
        )}
      </span>
    );
  };

  // One descriptor per card: `labels` drives the loading skeleton (one shimmer
  // row per label) and `rows` the loaded values (dropping unreported fields) —
  // the same shape the Stats page uses so the layout doesn't shift.
  const cards: {
    title: string;
    labels: string[];
    meter?: { label: string; percent: number; text: string };
    rows: [string, React.ReactNode][] | null;
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
      labels: [
        t('repeaterAdmin.txAirtime'),
        t('repeaterAdmin.rxAirtime'),
        t('repeaterAdmin.txDutyCycle'),
        t('repeaterAdmin.rxDutyCycle'),
      ],
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
            ...derived(
              t('repeaterAdmin.txDutyCycle'),
              [s.totalAirTimeSecs, s.totalUpTimeSecs],
              () =>
                dutyCycle(
                  s.totalAirTimeSecs,
                  s.totalUpTimeSecs,
                  dutyCycleLimit,
                ),
            ),
            ...derived(
              t('repeaterAdmin.rxDutyCycle'),
              [s.totalRxAirTimeSecs, s.totalUpTimeSecs],
              () => dutyCycle(s.totalRxAirTimeSecs, s.totalUpTimeSecs),
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
        t('repeaterAdmin.floodDupRate'),
        t('repeaterAdmin.directDups'),
        t('repeaterAdmin.rxErrors'),
        t('repeaterAdmin.rxErrorRate'),
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
            ...derived(
              t('repeaterAdmin.floodDupRate'),
              [s.nFloodDups, s.nRecvFlood],
              () => formatRatePercent(s.nFloodDups, s.nRecvFlood),
            ),
            ...opt(t('repeaterAdmin.directDups'), s.nDirectDups, num),
            ...opt(t('repeaterAdmin.rxErrors'), s.nRecvErrors, num),
            ...derived(
              t('repeaterAdmin.rxErrorRate'),
              [s.nRecvErrors, s.nPacketsRecv],
              () =>
                formatRatePercent(
                  s.nRecvErrors,
                  s.nRecvErrors == null || s.nPacketsRecv == null
                    ? undefined
                    : s.nRecvErrors + s.nPacketsRecv,
                ),
            ),
          ]
        : null,
    },
  ];

  return (
    <div className='mx-auto w-full max-w-6xl space-y-4'>
      <div className='flex items-center justify-end gap-3'>
        {statusAt != null && !loading && (
          <span className='text-xs text-text2'>
            {t('repeaterAdmin.lastUpdated', {
              time: formatRelative(statusAt),
            })}
          </span>
        )}
        <RefreshButton onClick={() => void refresh()} busy={loading} />
      </div>

      {loading ? (
        <div className={gridClass}>
          {cards.map(({ title: cardTitle, labels }) => (
            <div key={cardTitle} className='min-w-full flex-1 sm:min-w-72'>
              <StatCard
                title={cardTitle}
                loading
                rows={labels.map((label) => [label, ''])}
              />
            </div>
          ))}
        </div>
      ) : status ? (
        <div className={gridClass}>
          {cards
            .filter((c) => c.rows && c.rows.length > 0)
            .map(({ title: cardTitle, rows, meter }) => (
              <div key={cardTitle} className='min-w-full flex-1 sm:min-w-72'>
                <StatCard title={cardTitle} rows={rows ?? []} meter={meter} />
              </div>
            ))}
        </div>
      ) : (
        <p className='text-sm text-text2'>
          {t('repeaterAdmin.dashboard.unavailable')}
        </p>
      )}
    </div>
  );
}

const NEIGHBOR_VIEWS = ['map', 'list'] as const;
type NeighborView = (typeof NEIGHBOR_VIEWS)[number];

function NeighborsTab({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const { repeaterNeighbors } = useMeshCore();
  const contacts = useMeshStore((s) => s.contacts);
  const advertCache = useMeshStore((s) => s.advertCache);
  const prefix = contact.pubkeyPrefix;

  // Cached in the per-repeater session so the list stays populated across
  // navigation; the store is its source of truth. `undefined` until the first
  // read, an empty array once a read settles with no neighbors.
  const neighbors = useMeshStore((s) => s.adminSessions[prefix]?.neighbors);
  const setRepeaterNeighbors = useMeshStore((s) => s.setRepeaterNeighbors);
  // Whether the newest attempt failed. In the session rather than in this
  // component because the tab unmounts on navigation: local state would reset,
  // the cached-list branch below would skip the automatic re-read, and the
  // stale rows would come back with nothing saying so.
  const stale = useMeshStore((s) => s.adminSessions[prefix]?.neighborsStale);
  const setNeighborsStale = useMeshStore((s) => s.setRepeaterNeighborsStale);

  // Resolve every row once: the identity the list names it by, and whether it
  // also has a fix the map can anchor. The lookup scans the advert cache,
  // which refreshes on every heard advert, so it runs once per row here and is
  // shared rather than repeated per consumer.
  const rows = useMemo(() => {
    const anchor = repeaterAnchorNode(contact);
    return (neighbors ?? []).flatMap((neighbor) => {
      const { identity, node } = resolveNeighbor(
        neighbor.prefix,
        contacts,
        advertCache,
      );
      // A neighbor resolving back to the repeater itself is a self-edge
      // `buildNeighborMap` drops. Dropping it here too keeps the table, the
      // map and the coverage count describing the same set.
      if (node !== null && node.key === anchor?.key) return [];
      // Their own fix, not whether the map can draw it: a repeater with no
      // advertised position does not make its neighbors' locations unknown.
      return [{ neighbor, node: identity, located: node !== null }];
    });
  }, [contact, neighbors, contacts, advertCache]);

  // The map needs an anchor to draw around. Neighbors without a fix are parked
  // on a ring rather than dropped, so any neighbor at all is worth drawing once
  // the repeater itself is located.
  const anchored = repeaterAnchorNode(contact) !== null;
  const locatedCount = rows.filter((r) => r.located).length;
  const total = rows.length;

  const [loading, setLoading] = useState(false);
  // Two renderings of one dataset, shown one at a time so neither is squeezed:
  // the map for shape, the table for the per-neighbor detail it can't carry.
  const [view, setView] = useState<NeighborView>('map');
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
    // The session this read belongs to. A structured read walks several pages,
    // so a log-out and re-login can easily land mid-flight; the new session
    // must not inherit the old one's list. The token is in the shared-read key
    // for the same reason — joining the previous session's read would stamp its
    // result with this session's token and pass the guard in
    // `setRepeaterNeighbors` on a technicality. Read outside the try so the
    // failure path can scope its own write to the same session.
    const token = useMeshStore.getState().adminSessions[prefix]?.token;
    try {
      // Join an outstanding read for this repeater and session if one exists,
      // else start it. Sharing the promise dedupes concurrent reads and lets a
      // remount await the same settlement instead of showing a false empty.
      const neighbors = await joinRead(
        sessionReadKey('neighbors', prefix, token),
        () => repeaterNeighbors(contact),
      );
      setRepeaterNeighbors(prefix, neighbors, token);
    } catch {
      // A timeout, a rejected reply, or a dropped link is an error, not "no
      // neighbors": surface an error state and preserve any cached list rather
      // than clearing it — marked stale on the session so navigating away and
      // back cannot present it as freshly confirmed.
      setErrored(true);
      setNeighborsStale(prefix, token);
    } finally {
      setLoading(false);
    }
  }, [
    contact,
    prefix,
    repeaterNeighbors,
    setRepeaterNeighbors,
    setNeighborsStale,
  ]);

  // Fetch once on first entry, unless a cached list is already showing. The
  // ref guard survives StrictMode's double mount; `refresh` itself joins an
  // outstanding read, so a remount mid-flight won't duplicate it.
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    if (hadCache.current) return;
    void refresh();
  }, [refresh]);

  // The in-flight neighbors read is deliberately *not* cancelled on unmount.
  // On the CLI fallback path, cancelling would reject its queued slot and let
  // the queue advance while the repeater is still replying — a late reply could
  // then resolve the next command's waiter (e.g. one sent from the Console
  // tab). The result is cached in the store, so letting the read run to
  // completion is both correct and harmless when the user has navigated away.

  // Shown whenever the map has nothing to draw, which on the map side doubles
  // as the explanation of why — so the switcher stays available either way.
  const notice = (
    <div className='flex h-full items-center justify-center rounded-lg border border-border p-6'>
      <p className='text-center text-sm text-text2'>
        {errored
          ? t('repeaterAdmin.neighbors.error')
          : loading
            ? t('repeaterAdmin.neighbors.loading')
            : total === 0
              ? t('repeaterAdmin.neighbors.empty')
              : contact.advLat && contact.advLon
                ? t('repeaterAdmin.neighbors.noLocation')
                : t('repeaterAdmin.neighbors.noAnchor')}
      </p>
    </div>
  );

  return (
    <div className='flex h-full w-full flex-col gap-3'>
      {/* A failed refresh over a cached result would otherwise leave it looking
          freshly confirmed. Gated on a list having been cached at all, not on
          its length: a repeater that legitimately reported no neighbors caches
          an empty list, and without this the notice below would go on calling
          that an empty table long after a refresh stopped confirming it.
          Driven by session state, so navigating away and back cannot clear the
          warning while leaving the result it was about. */}
      {stale && neighbors != null && (
        <p className='shrink-0 rounded-lg border border-border p-2 text-xs text-text2'>
          {t('repeaterAdmin.neighbors.stale')}
        </p>
      )}
      <div className='flex shrink-0 flex-wrap items-center justify-between gap-3'>
        <p className='text-xs text-text2'>
          {total > 0
            ? t('repeaterAdmin.neighbors.mapCoverage', {
                shown: locatedCount,
                count: total,
              })
            : t('repeaterAdmin.neighbors.listLabel')}
        </p>
        <div className='flex items-center gap-2'>
          {total > 0 && (
            <div
              role='tablist'
              aria-label={t('repeaterAdmin.neighbors.viewLabel')}
              onKeyDown={(e) =>
                handleRovingKeyDown(
                  e,
                  NEIGHBOR_VIEWS.length,
                  NEIGHBOR_VIEWS.indexOf(view),
                  (i) => setView(NEIGHBOR_VIEWS[i]),
                )
              }
              className='flex gap-1 rounded-md p-1 bg-bg'
            >
              {NEIGHBOR_VIEWS.map((id) => (
                <button
                  key={id}
                  role='tab'
                  id={`neighbors-view-${id}`}
                  aria-selected={view === id}
                  aria-controls='neighbors-tabpanel'
                  tabIndex={view === id ? 0 : -1}
                  onClick={() => setView(id)}
                  className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                    view === id
                      ? 'bg-accent-solid text-white inset-ring-1 inset-ring-accent'
                      : 'text-text2 hover:bg-surface2'
                  }`}
                >
                  {t(`repeaterAdmin.neighbors.view_${id}`)}
                </button>
              ))}
            </div>
          )}
          <RefreshButton
            onClick={() => void refresh()}
            busy={loading}
            className='bg-surface'
          />
        </div>
      </div>
      <div
        id='neighbors-tabpanel'
        {...(total > 0
          ? { role: 'tabpanel', 'aria-labelledby': `neighbors-view-${view}` }
          : {})}
        // Takes the whole tab below the header: `NeighborsMap` sizes itself
        // with `h-full`, which collapses against a parent that only grows.
        className='min-h-0 flex-1'
      >
        {total === 0 || view === 'list' ? (
          total === 0 ? (
            notice
          ) : (
            <div className='h-full overflow-y-auto rounded-lg border border-border px-3'>
              <NeighborsList rows={rows} />
            </div>
          )
        ) : anchored ? (
          <NeighborsMap contact={contact} neighbors={neighbors ?? []} />
        ) : (
          notice
        )}
      </div>
    </div>
  );
}

/** One `neighbors` row, already resolved against contacts and the advert
 * cache by {@link NeighborsTab}. */
interface NeighborRow {
  neighbor: Neighbor;
  node: NeighborIdentity | null;
}

/**
 * Every row the repeater returned, located or not — the map can only show the
 * subset with a known fix, and an unmapped neighbor is exactly the one the user
 * has not saved yet. A row resolving to a known node opens its manage panel;
 * one that resolves only to a cached advert also offers Add contact. A prefix
 * this browser has never heard an advert from carries no public key, so there
 * is nothing to add — it shows as the bare 4 bytes the repeater reported.
 */
function NeighborsList({ rows }: { rows: NeighborRow[] }) {
  const { t } = useTranslation();
  const advertCache = useMeshStore((s) => s.advertCache);
  const setManagePanel = useMeshStore((s) => s.setManagePanel);
  const connected = useMeshStore((s) => s.status === 'connected');
  const { addDiscoveredContact } = useMeshCore();
  // Nothing else re-renders this between refreshes, so without a tick the
  // ages below would freeze at whatever they read when the tab opened.
  useClockTick();

  return (
    <table
      className='w-full text-sm'
      aria-label={t('repeaterAdmin.neighbors.listLabel')}
    >
      <thead>
        {/* Pinned: the pane scrolls on its own now that it fills the tab. */}
        <tr className='sticky top-0 text-left text-xs text-text2 bg-surface'>
          <th scope='col' className='py-1 font-medium'>
            {t('repeaterAdmin.neighbors.colNode')}
          </th>
          <th scope='col' className='py-1 font-medium'>
            {t('repeaterAdmin.neighbors.colSnr')}
          </th>
          <th scope='col' className='py-1 font-medium'>
            {t('repeaterAdmin.neighbors.colLastHeard')}
          </th>
          <th scope='col' className='py-1' />
        </tr>
      </thead>
      <tbody>
        {rows.map(({ neighbor, node }, index) => {
          // Only a node known solely from the advert cache can be added: a
          // saved contact already exists, and an unresolved prefix carries no
          // public key to add.
          const addable =
            node?.kind === 'advert'
              ? advertCache[node.pubkeyPrefix]
              : undefined;
          return (
            // A key prefix is not unique on its own, so the reply position
            // discriminates two rows that happen to share one.
            <tr
              key={`${neighbor.prefix}:${index}`}
              className='border-t border-border'
            >
              <td className='py-1.5'>
                {node ? (
                  <button
                    onClick={() =>
                      setManagePanel({
                        kind: node.kind,
                        id: node.pubkeyPrefix,
                      })
                    }
                    className='truncate text-left hover:text-accent'
                  >
                    {ADV_ICON[node.advType] ?? '👤'} {node.name}
                  </button>
                ) : (
                  <span className='font-mono text-xs text-text2'>
                    {neighbor.prefix}
                  </span>
                )}
              </td>
              <td className='py-1.5 tabular-nums'>{formatSnr(neighbor.snr)}</td>
              <td className='py-1.5 text-text2'>
                {formatRelative(neighbor.lastHeard)}
              </td>
              <td className='py-1.5 text-right'>
                {addable && (
                  <button
                    disabled={!connected}
                    onClick={() => void addDiscoveredContact(addable)}
                    aria-label={t('repeaterAdmin.neighbors.addNode', {
                      name: node?.name ?? neighbor.prefix,
                    })}
                    className='rounded-md px-2 py-0.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 bg-accent-solid'
                  >
                    {t('common.add')}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
