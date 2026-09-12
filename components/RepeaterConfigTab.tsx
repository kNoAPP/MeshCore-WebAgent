// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import {
  REPEATER_SETTING_GROUPS,
  REPEATER_ADVANCED_SETTINGS,
  REPEATER_GPS_SETTINGS,
  ALL_REPEATER_SETTINGS,
  REPEATER_ACTIONS,
  getCommand,
  setCommand,
  normalizeReply,
  isErrorReply,
  isValidValue,
  nameMaxBytes,
  parseRadio,
  formatRadio,
  LOOP_DETECT_OPTIONS,
  PATH_HASH_MODE_OPTIONS,
  GPS_ADVERT_OPTIONS,
} from '@/lib/meshcore/repeaterConfig';
import type {
  RepeaterSetting,
  NumberSetting,
  ToggleSetting,
  SelectSetting,
  RepeaterAction,
} from '@/lib/meshcore/repeaterConfig';
import { fmtNum, utf8ByteLength } from '@/lib/utils';
import { handleRovingKeyDown } from '@/lib/ui/roving';
import { Card } from './Card';
import { RefreshButton } from './RefreshButton';
import { RadioSettingsModal } from './RadioSettings';
import { SaveStatusChip, type SaveStatus } from './SaveStatus';
import { Select } from './Select';
import { Switch } from './Switch';
import type { Contact, RadioParams } from '@/types/meshcore';

type ValueMap = Record<string, string>;

// Stable reference, so an uncached repeater doesn't churn renders.
const EMPTY_VALUES: ValueMap = {};

const ROW_CLASS =
  'flex items-center justify-between gap-3 border-b border-border py-1.5 text-xs last:border-0';

// The node's value is authoritative: it may come back rounded or clamped from
// what was sent.
type CommitOutcome =
  { kind: 'ok'; value: string } | { kind: 'rejected'; reply: string };

// CLI replies are frequently dropped over the mesh, so a couple of retry passes
// markedly improve how many fields fill in without a manual refresh. A pass in
// which nothing answered ends the read early.
const READ_PASSES = 3;

// Every control in a row's value column shares this, so their edges line up
// down the card whatever kind of setting each row is.
const FIELD_WIDTH = 'w-24';

// Shown together in their own card, like the Settings page's Radio section,
// rather than inside the Identity group they're cataloged in.
const RADIO_FIELDS: readonly RepeaterSetting[] = ALL_REPEATER_SETTINGS.filter(
  (s) => s.id === 'radio' || s.id === 'tx',
);

/**
 * The Config tab of the repeater admin panel: structured, validated controls
 * for the common `get`/`set` settings plus the key action verbs, all driven by
 * the {@link REPEATER_SETTING_GROUPS} catalog. Nothing loads on entry; each
 * section has its own Refresh button that reads just that section's fields, so
 * the user pulls only the values they care about. Editing a field auto-commits
 * the matching `set` (on toggle/select change, slider release, or blur/Enter
 * for typed fields) and re-reads to confirm. The composite radio parameters and
 * TX power are edited together in the shared {@link RadioSettingsModal}.
 */
export function RepeaterConfigTab({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const { repeaterCliRequest, repeaterCli } = useMeshCore();
  const showToast = useMeshStore((s) => s.showToast);

  // Loaded/confirmed values are cached in the per-repeater session so the tab
  // stays populated across navigation; the store is their source of truth.
  const values = useMeshStore(
    (s) => s.adminSessions[contact.pubkeyPrefix]?.config ?? EMPTY_VALUES,
  );
  // Drafts are the transient, editable copy — seeded from the cache on mount so
  // fields render immediately, then diverge only while the user edits.
  const [drafts, setDrafts] = useState<ValueMap>(
    () =>
      useMeshStore.getState().adminSessions[contact.pubkeyPrefix]?.config ?? {},
  );
  // Ids whose current value is still being read; drives per-field placeholders
  // and each section's spinning Refresh. A field is dropped once its read
  // settles (loaded, errored, or timed out), so a slow/lost reply never blocks
  // the rest of the section. Starts empty — nothing loads until a section's
  // Refresh is clicked.
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<Record<string, SaveStatus>>({});
  // The last error message per field, shown on the error chip's tooltip.
  const [errorMsg, setErrorMsg] = useState<Record<string, string>>({});
  // Whether this node has GPS support compiled in. `null` until probed by an
  // Identity read; `false` hides the GPS controls (the firmware rejects the
  // `gps` verbs on non-GPS builds), `true` reveals them. Seeded from the
  // session cache so a remount (e.g. tab switch) keeps the picker visible
  // without re-probing.
  const [gpsSupported, setGpsSupported] = useState<boolean | null>(() => {
    const cfg =
      useMeshStore.getState().adminSessions[contact.pubkeyPrefix]?.config;
    return (cfg?.gps ?? '') !== '' || (cfg?.gpsAdvert ?? '') !== ''
      ? true
      : null;
  });
  // Ids of `optional` settings this node rejected (a firmware key it predates,
  // or a board capability it lacks). Their rows are dropped from the UI and
  // from later reads instead of surfacing an error.
  const [unsupported, setUnsupported] = useState<Set<string>>(() => new Set());
  // Fields that were asked for and never answered, after all read passes. The
  // difference between this and "never loaded" is the whole diagnosis: an
  // em-dash alone can't tell a user whether a value is unread or lost.
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  // Whether the shared radio/TX editor modal is open.
  const [radioEditOpen, setRadioEditOpen] = useState(false);
  // Transient text filter over the field labels; not a preference, so it stays
  // local and resets with the tab.
  const [fieldFilter, setFieldFilter] = useState('');

  // The hook callback identity can change (client re-wire), so read it through
  // a ref kept fresh by an effect rather than during render. Same for the
  // latest values/drafts, so the stable auto-commit callback isn't stale.
  const requestRef = useRef(repeaterCliRequest);
  const valuesRef = useRef(values);
  const draftsRef = useRef(drafts);
  useEffect(() => {
    requestRef.current = repeaterCliRequest;
    valuesRef.current = values;
    draftsRef.current = drafts;
  });

  // The mount-time contact; its pubkey is immutable, so a later contact-table
  // refresh (new object identity, same node) needn't re-run the prefill.
  const contactRef = useRef(contact);
  // False after unmount, so an in-flight read or commit doesn't set state on a
  // gone component (and a late CLI reply is ignored).
  const aliveRef = useRef(true);
  // Timers that fade a field's "saved ✓" chip back to idle.
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // The most recent value committed (or being committed) per field. The commit
  // no-op check compares against this rather than the last *confirmed* value,
  // so a fresh edit isn't discarded just because it matches the confirmed value
  // while an earlier write to a different value is still in flight.
  const intentRef = useRef<ValueMap>({});

  // Serializes whole commit round-trips against each other. The CLI layer
  // already serializes individual commands per repeater, but a `set` and its
  // confirming `get` must also stay adjacent: without this chain another edit's
  // `set` could land between them and be what the `get` reports back.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    const run = chainRef.current.then(op, op);
    chainRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  // Writes loaded/confirmed values into the per-repeater session cache (the
  // source of truth for `values`), so the tab stays populated across
  // navigation.
  const cacheValues = useCallback((patch: ValueMap) => {
    useMeshStore
      .getState()
      .mergeRepeaterConfig(contactRef.current.pubkeyPrefix, patch);
  }, []);

  // Reads the given fields' current values, one round trip at a time — the CLI
  // layer serializes commands per repeater regardless, since MeshCore replies
  // carry no correlation id. Fields populate as each reply lands. Called per
  // section, so concurrent section reads each scope their "stop reading" to
  // their own fields and never clear another's.
  const read = useCallback(
    (settings: readonly RepeaterSetting[]) => {
      void (async () => {
        // Retry gaps: CLI replies are often dropped over the mesh, so
        // re-request any field that didn't answer, up to a few passes. A field
        // stays "reading" until it loads or the passes are exhausted.
        let queue: RepeaterSetting[] = [...settings];
        for (let pass = 0; pass < READ_PASSES && queue.length > 0; pass++) {
          const misses: RepeaterSetting[] = [];
          for (const setting of queue) {
            if (!aliveRef.current) return;
            let parsed: string | null = null;
            let errored = false;
            try {
              const reply = await requestRef.current(
                contactRef.current,
                getCommand(setting),
              );
              if (!aliveRef.current) return;
              if (isErrorReply(reply, setting)) {
                // The GPS verbs are rejected on nodes without GPS compiled in:
                // treat any error on a GPS field as "unsupported", hiding the
                // controls silently rather than surfacing a toast.
                if (setting.id === 'gps' || setting.id === 'gpsAdvert') {
                  setGpsSupported(false);
                  errored = true;
                } else if (setting.optional) {
                  // A key this node's firmware or board doesn't have: drop the
                  // row rather than blaming the user for a missing feature.
                  errored = true;
                  setUnsupported((prev) =>
                    prev.has(setting.id) ? prev : new Set(prev).add(setting.id),
                  );
                } else {
                  // A terminal rejection (e.g. the firmware lacks this
                  // setting): surface it and don't retry a refused command.
                  errored = true;
                  showToast(
                    t('toast.repeaterConfigError', { error: reply.trim() }),
                    'error',
                  );
                }
              } else {
                if (setting.id === 'gps' || setting.id === 'gpsAdvert') {
                  setGpsSupported(true);
                }
                parsed = normalizeReply(setting, reply);
                if (parsed === null) {
                  errored = true;
                  showToast(
                    t('toast.repeaterReadParseFailed', {
                      field: t(
                        `repeaterAdmin.config.fields.${setting.id}.label`,
                      ),
                    }),
                    'error',
                  );
                }
              }
            } catch {
              if (!aliveRef.current) return;
            }
            if (parsed != null) {
              cacheValues({ [setting.id]: parsed });
              setDrafts((prev) => ({ ...prev, [setting.id]: parsed }));
            }
            if (parsed != null || errored) {
              // Settled (loaded or rejected): stop showing "reading".
              setPending((prev) => {
                if (!prev.has(setting.id)) return prev;
                const next = new Set(prev);
                next.delete(setting.id);
                return next;
              });
            } else {
              // No response — retry on a later pass.
              misses.push(setting);
            }
          }
          if (!aliveRef.current) return;
          // Nothing at all answered: the node is unreachable rather than the
          // link merely lossy, so retrying would just flood the mesh with sends
          // that each burn the full reply timeout.
          if (misses.length === queue.length) break;
          queue = misses;
        }
        if (!aliveRef.current) return;
        // Stop showing "reading" for this call's fields that never answered,
        // without touching a concurrent read's still-pending fields.
        setPending((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const s of settings) if (next.delete(s.id)) changed = true;
          return changed ? next : prev;
        });
        // Whatever is still queued asked and got nothing: record it so the row
        // can say "no reply" and offer a retry instead of an unexplained dash.
        if (queue.length > 0) {
          setFailed((prev) => {
            const next = new Set(prev);
            for (const s of queue) next.add(s.id);
            return next;
          });
        }
      })();
    },
    [cacheValues, showToast, t],
  );

  // Loads (or reloads) one section's fields. Marks them pending, then reads.
  // `setPending` here is a user-gesture update, not an effect body, so it's
  // allowed. A no-op re-click is harmless — the section's Refresh spins while
  // any of its fields are pending.
  const refreshSection = useCallback(
    (settings: readonly RepeaterSetting[]) => {
      setPending((prev) => {
        const next = new Set(prev);
        for (const s of settings) next.add(s.id);
        return next;
      });
      // A retry starts from a clean slate: these fields are being asked again.
      setFailed((prev) => {
        if (!settings.some((s) => prev.has(s.id))) return prev;
        const next = new Set(prev);
        for (const s of settings) next.delete(s.id);
        return next;
      });
      read(settings);
    },
    [read],
  );

  // Track liveness for in-flight reads/commits, and clear pending save-status
  // timers on unmount. The in-flight CLI request is deliberately *not*
  // cancelled here: cancelling rejects its queued slot and advances the CLI
  // send queue while the repeater may still be replying, so a command sent from
  // another tab (e.g. Console) could consume this request's late reply. The
  // `aliveRef` guard stops the read loop after the current round trip instead,
  // letting the outstanding request consume its own reply/timeout.
  useEffect(() => {
    aliveRef.current = true;
    const timers = savedTimers.current;
    return () => {
      aliveRef.current = false;
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, []);

  // Commits a field's new value: sends its `set`, then re-reads so the field
  // reflects the node's authoritative value (which may be rounded/clamped). A
  // no-op when unchanged or invalid; surfaces `Err` replies via a toast and an
  // error chip while leaving the stored value untouched.
  const commit = useCallback(
    async (setting: RepeaterSetting, next: string) => {
      const id = setting.id;
      // Compare against the last value we committed (or are committing), not
      // just the last confirmed one, so a revert issued while an earlier write
      // is still in flight isn't dropped as a no-op.
      const target = intentRef.current[id] ?? valuesRef.current[id] ?? '';
      if (next === target) return;
      // The name and both coordinates are validated together against the
      // location-aware 24-byte name budget, which needs all three loaded — a
      // partial section read (e.g. a coordinate that timed out) would otherwise
      // be treated as zero/empty and let an over-budget combination slip past.
      // Block editing any of them until the trio is loaded.
      if (
        setting.id === 'name' ||
        setting.id === 'lat' ||
        setting.id === 'lon'
      ) {
        const loaded = (fid: string) => (valuesRef.current[fid] ?? '') !== '';
        if (!loaded('name') || !loaded('lat') || !loaded('lon')) {
          showToast(t('toast.repeaterLoadBeforeLocationEdit'), 'error');
          setDrafts((prev) => ({ ...prev, [id]: valuesRef.current[id] ?? '' }));
          return;
        }
        const name =
          setting.id === 'name' ? next : (draftsRef.current.name ?? '');
        const lat = setting.id === 'lat' ? next : (draftsRef.current.lat ?? '');
        const lon = setting.id === 'lon' ? next : (draftsRef.current.lon ?? '');
        if (utf8ByteLength(name) > nameMaxBytes(lat, lon)) {
          showToast(t('toast.repeaterNameTooLongForLocation'), 'error');
          setDrafts((prev) => ({ ...prev, [id]: valuesRef.current[id] ?? '' }));
          return;
        }
      }
      const maxBytes =
        setting.kind === 'text'
          ? nameMaxBytes(
              draftsRef.current.lat ?? '',
              draftsRef.current.lon ?? '',
            )
          : undefined;
      if (!isValidValue(setting, next, maxBytes)) return;
      intentRef.current[id] = next;
      setDrafts((prev) => ({ ...prev, [id]: next }));
      setStatus((prev) => ({ ...prev, [id]: 'saving' }));
      setErrorMsg((prev) => {
        if (!(id in prev)) return prev;
        const next2 = { ...prev };
        delete next2[id];
        return next2;
      });
      try {
        // The `set` and its confirming `get` run as one queued unit, so no
        // other edit's write can land between them.
        const outcome = await enqueue(async (): Promise<CommitOutcome> => {
          const setReply = await requestRef.current(
            contactRef.current,
            setCommand(setting, next),
          );
          if (isErrorReply(setReply, setting)) {
            return { kind: 'rejected', reply: setReply.trim() };
          }
          try {
            const getReply = await requestRef.current(
              contactRef.current,
              getCommand(setting),
            );
            if (!isErrorReply(getReply, setting)) {
              return {
                kind: 'ok',
                value: normalizeReply(setting, getReply) ?? next,
              };
            }
          } catch {
            // Keep the value we just set if the confirm read fails.
          }
          return { kind: 'ok', value: next };
        });
        if (!aliveRef.current) return;
        if (outcome.kind === 'rejected') {
          const message = t('toast.repeaterConfigError', {
            error: outcome.reply,
          });
          showToast(message, 'error');
          // Only reconcile the field when this write still owns the latest
          // intent, so a newer queued edit keeps its own `saving` state,
          // draft, and intent rather than being flipped to this stale error.
          if (intentRef.current[id] === next) {
            setStatus((prev) => ({ ...prev, [id]: 'error' }));
            setErrorMsg((prev) => ({ ...prev, [id]: message }));
            setDrafts((prev) => ({
              ...prev,
              [id]: valuesRef.current[id] ?? '',
            }));
            intentRef.current[id] = valuesRef.current[id] ?? '';
          }
          return;
        }
        const confirmed = outcome.value;
        // The device really is at `confirmed` now, so cache it unconditionally
        // — even if a newer edit has since superseded this write. (During
        // 50→60→50, caching the 60 it confirmed keeps the cache honest if the
        // queued revert to 50 later fails.)
        cacheValues({ [id]: confirmed });
        // Only reconcile the visible draft/status/intent when this write still
        // owns the latest intent, so a superseded confirmation doesn't flip a
        // newer edit's shown value or spinner.
        if (intentRef.current[id] !== next) return;
        intentRef.current[id] = confirmed;
        setDrafts((prev) => ({ ...prev, [id]: confirmed }));
        setStatus((prev) => ({ ...prev, [id]: 'saved' }));
        clearTimeout(savedTimers.current[id]);
        savedTimers.current[id] = setTimeout(() => {
          setStatus((prev) => {
            if (prev[id] !== 'saved') return prev;
            const next2 = { ...prev };
            delete next2[id];
            return next2;
          });
        }, 2000);
      } catch (err) {
        if (!aliveRef.current) return;
        const message = t('toast.repeaterCliFailed', {
          error: (err as Error).message,
        });
        showToast(message, 'error');
        // Only reconcile when this write still owns the latest intent, so a
        // newer queued edit's `saving` state isn't overwritten by this stale
        // transport failure.
        if (intentRef.current[id] === next) {
          intentRef.current[id] = valuesRef.current[id] ?? '';
          setStatus((prev) => ({ ...prev, [id]: 'error' }));
          setErrorMsg((prev) => ({ ...prev, [id]: message }));
        }
      }
    },
    [enqueue, showToast, t, cacheValues],
  );

  // A coordinate handed back by the map picker (the "Set on map" button below)
  // is committed straight to the repeater on mount — picking the point is the
  // write, mirroring the Settings location card. One-shot: the store's
  // pendingLocation is cleared as soon as it's consumed here.
  useEffect(() => {
    const store = useMeshStore.getState();
    const pending = store.pendingLocation;
    if (!pending || store.locationPickReturn !== 'chat') return;
    store.clearPendingLocation();
    const latSetting = ALL_REPEATER_SETTINGS.find((s) => s.id === 'lat');
    const lonSetting = ALL_REPEATER_SETTINGS.find((s) => s.id === 'lon');
    // Defer out of the effect body so the commits' optimistic setState isn't a
    // synchronous render cascade (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (latSetting) void commit(latSetting, String(pending.lat));
      if (lonSetting) void commit(lonSetting, String(pending.lon));
    });
  }, [commit]);

  const runAction = useCallback(
    async (action: RepeaterAction) => {
      // Confirm success only on a real reply — or on silence from a verb that
      // never answers (`reboot`). Any other non-answer is reported as such
      // rather than as a green "sent"; a failed/disconnected send already
      // toasts from repeaterCli itself.
      const outcome = await repeaterCli(contact, action.cmd);
      if (outcome === 'ok' || (outcome === 'timeout' && action.silent)) {
        showToast(t('toast.repeaterActionSent'), 'success');
      } else if (outcome === 'timeout') {
        showToast(t('toast.repeaterCliNoReply'), 'error');
      }
    },
    [contact, repeaterCli, showToast, t],
  );

  // Applies the shared radio/TX editor's result to the repeater over CLI:
  // `set radio` only if the LoRa quad changed (it reboots the node), `set tx`
  // only if power changed. Returns whether every needed write succeeded so the
  // modal can stay open on failure.
  const applyRepeaterRadio = useCallback(
    async (params: RadioParams): Promise<boolean> => {
      const radioSetting = ALL_REPEATER_SETTINGS.find((s) => s.id === 'radio');
      const txSetting = ALL_REPEATER_SETTINGS.find((s) => s.id === 'tx');
      if (!radioSetting || !txSetting) return false;
      const cur = parseRadio(valuesRef.current.radio ?? '');
      const radioChanged =
        !cur ||
        Math.round(cur.freq * 1000) !== Math.round(params.radioFreq * 1000) ||
        cur.bw !== params.radioBw ||
        cur.sf !== params.radioSf ||
        cur.cr !== params.radioCr;
      const txChanged = Number(valuesRef.current.tx) !== params.txPower;
      const radioStr = formatRadio(
        params.radioFreq,
        params.radioBw,
        params.radioSf,
        params.radioCr,
      );
      const txStr = String(params.txPower);
      // Both writes travel as one queued unit, so a concurrent field edit can't
      // land between the LoRa quad and the TX power it pairs with. `applied`
      // carries whatever was accepted before any rejection or transport
      // failure, so a half-applied pair still caches the half that stuck.
      const { applied, error } = await enqueue(
        async (): Promise<{ applied: ValueMap; error: string | null }> => {
          const applied: ValueMap = {};
          // Confirm a write with a re-read so the cached/shown value is the
          // node's authoritative one (freq/bw/sf/cr and TX power may be clamped
          // or rounded), matching the per-field commit contract. Falls back to
          // the sent value if the confirming read is dropped or unreadable.
          const confirm = async (
            setting: RepeaterSetting,
            sent: string,
          ): Promise<string> => {
            try {
              const getReply = await requestRef.current(
                contactRef.current,
                getCommand(setting),
              );
              if (!isErrorReply(getReply, setting)) {
                return normalizeReply(setting, getReply) ?? sent;
              }
            } catch {
              // Keep the value we just set if the confirm read fails.
            }
            return sent;
          };
          try {
            if (radioChanged) {
              const reply = await requestRef.current(
                contactRef.current,
                setCommand(radioSetting, radioStr),
              );
              if (isErrorReply(reply, radioSetting)) {
                return {
                  applied,
                  error: t('toast.repeaterConfigError', {
                    error: reply.trim(),
                  }),
                };
              }
              applied.radio = await confirm(radioSetting, radioStr);
            }
            if (txChanged) {
              const reply = await requestRef.current(
                contactRef.current,
                setCommand(txSetting, txStr),
              );
              if (isErrorReply(reply, txSetting)) {
                return {
                  applied,
                  error: t('toast.repeaterConfigError', {
                    error: reply.trim(),
                  }),
                };
              }
              applied.tx = await confirm(txSetting, txStr);
            }
            return { applied, error: null };
          } catch (err) {
            // A transport failure mid-sequence (e.g. `set tx` times out after
            // `set radio` stuck): return what already applied so the caller
            // still caches it before reporting the error.
            return {
              applied,
              error: t('toast.repeaterCliFailed', {
                error: (err as Error).message,
              }),
            };
          }
        },
      );
      if (!aliveRef.current) return false;
      if (Object.keys(applied).length > 0) {
        cacheValues(applied);
        setDrafts((prev) => ({ ...prev, ...applied }));
      }
      if (error != null) {
        showToast(error, 'error');
        return false;
      }
      showToast(t('toast.radioParamsSaved'), 'success');
      return true;
    },
    [enqueue, showToast, t, cacheValues],
  );

  const nameBytes = nameMaxBytes(drafts.lat ?? '', drafts.lon ?? '');
  // The advanced knobs this node actually has; ones it rejected are dropped so
  // they neither render nor get re-requested on the next Refresh.
  const advancedSettings = REPEATER_ADVANCED_SETTINGS.filter(
    (s) => !unsupported.has(s.id),
  );
  const sectionBusy = (settings: readonly RepeaterSetting[]) =>
    settings.some((s) => pending.has(s.id));
  // A section is "unloaded" until at least one of its fields has a value; its
  // Refresh control then shows a download glyph to invite the first load.
  const sectionLoaded = (settings: readonly RepeaterSetting[]) =>
    settings.some((s) => (values[s.id] ?? '') !== '');

  // Seed for the shared radio/TX modal, or null until both values have loaded.
  const radioParsed = parseRadio(values.radio ?? '');
  const txValue = values.tx ?? '';
  const txNum = Number(txValue);
  const txSetting = ALL_REPEATER_SETTINGS.find((s) => s.id === 'tx');
  const maxTxPower =
    txSetting && txSetting.kind === 'number' ? txSetting.max : 22;
  const minTxPower =
    txSetting && txSetting.kind === 'number' ? txSetting.min : 1;
  const radioModalFields =
    radioParsed && txValue !== '' && Number.isFinite(txNum)
      ? {
          radioFreq: radioParsed.freq,
          radioBw: radioParsed.bw,
          radioSf: radioParsed.sf,
          radioCr: radioParsed.cr,
          txPower: txNum,
          maxTxPower,
          minTxPower,
        }
      : null;

  const rowProps = (setting: RepeaterSetting) => ({
    setting,
    value: values[setting.id] ?? '',
    onDraft: (v: string) => setDrafts((prev) => ({ ...prev, [setting.id]: v })),
    onCommit: (v: string) => void commit(setting, v),
    onRetry: () => refreshSection([setting]),
    draft: drafts[setting.id] ?? '',
    status: status[setting.id],
    errorText: errorMsg[setting.id],
    loading: pending.has(setting.id),
    failed: failed.has(setting.id),
    nameBytes,
  });

  // The current advertised-location policy: `none` (don't advertise), `prefs`
  // (the stored fixed lat/lon), or `share` (the live GPS fix). Empty until the
  // GPS fields load. Keeping all three states distinct means a node set to
  // `none` shows as Off rather than being collapsed into Fixed.
  const advertPolicy = drafts.gpsAdvert ?? '';
  // Under live GPS the coordinates come from the module, so the manual editor
  // is disabled.
  const usingGps = gpsSupported === true && advertPolicy === 'share';
  // The name and both coordinates validate as a group against the location-
  // aware name budget, so editing any of them is gated until all three have
  // loaded (a partial section read must not let an over-budget combo through).
  const identityLoaded =
    (values.name ?? '') !== '' &&
    (values.lat ?? '') !== '' &&
    (values.lon ?? '') !== '';
  const gpsSetting = REPEATER_GPS_SETTINGS.find((s) => s.id === 'gps');
  const gpsAdvertSetting = REPEATER_GPS_SETTINGS.find(
    (s) => s.id === 'gpsAdvert',
  );

  // Matched against the localized field labels, so the user searches for what
  // they can read ("duty cycle") rather than a setting id. Latitude also stands
  // in for longitude: the two share one Location row, so hiding either half
  // would leave the row half-rendered.
  const query = fieldFilter.trim().toLowerCase();
  const labelMatches = (id: RepeaterSetting['id']) =>
    t(`repeaterAdmin.config.fields.${id}.label`).toLowerCase().includes(query);
  const matches = (setting: RepeaterSetting) =>
    query === '' ||
    labelMatches(setting.id) ||
    (setting.id === 'lat' && labelMatches('lon'));
  const radioMatches =
    query === '' || labelMatches('radio') || labelMatches('tx');
  const advancedShown = advancedSettings.filter(matches);
  const filtering = query !== '';
  const noMatches =
    filtering &&
    !radioMatches &&
    advancedShown.length === 0 &&
    !REPEATER_SETTING_GROUPS.some((g) =>
      g.settings.some((s) => s.id !== 'radio' && s.id !== 'tx' && matches(s)),
    );

  // Pick the advertised-location policy. `share` (GPS) also turns the module
  // on; `none`/`prefs` turn it off. Each write runs through the same serialized
  // commit path (which no-ops an unchanged field), so a partial failure can be
  // fixed by re-selecting, and the row's single status reflects the pair.
  const selectPolicy = (policy: (typeof GPS_ADVERT_OPTIONS)[number]) => {
    if (!gpsSetting || !gpsAdvertSetting) return;
    void commit(gpsSetting, policy === 'share' ? 'on' : 'off');
    void commit(gpsAdvertSetting, policy);
  };

  // One gesture for the whole tab, since the load-on-demand model otherwise
  // needs four separate clicks to answer "what is this node set to?". The
  // composite `radio` setting is included: the Radio card reads it too, and
  // leaving it out would make "Load all" quietly skip the radio parameters.
  const loadAll = () => {
    refreshSection([
      ...REPEATER_SETTING_GROUPS.flatMap((g) => [...g.settings]),
      ...advancedSettings,
      ...(gpsSupported === false ? [] : REPEATER_GPS_SETTINGS),
    ]);
  };

  return (
    <>
      <div className='mx-auto mb-4 flex w-full max-w-6xl flex-wrap items-center gap-3'>
        <input
          type='search'
          value={fieldFilter}
          onChange={(e) => setFieldFilter(e.target.value)}
          placeholder={t('repeaterAdmin.config.filterPlaceholder')}
          aria-label={t('repeaterAdmin.config.filterLabel')}
          className='w-full max-w-xs rounded-md border border-border-control bg-surface px-2.5 py-1.5 text-xs text-text outline-none focus:border-accent'
        />
        <button
          type='button'
          onClick={loadAll}
          disabled={pending.size > 0}
          className='rounded-md border border-border-control px-2.5 py-1.5 text-xs font-medium text-text2 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50'
        >
          {t('repeaterAdmin.config.loadAll')}
        </button>
        <p className='w-full text-xs text-text2'>
          {t('repeaterAdmin.config.intro')}
        </p>
      </div>
      <div className='mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 xl:grid-cols-2'>
        {REPEATER_SETTING_GROUPS.map((group) => {
          // Radio + TX power live in their own card (see RadioSection), like
          // the Settings page; keep them out of the group they're cataloged in.
          const fields = group.settings.filter(
            (s) => s.id !== 'radio' && s.id !== 'tx',
          );
          const shown = fields.filter(matches);
          const isIdentity = group.id === 'identity';
          // The Identity refresh also probes/loads the GPS controls, unless the
          // node has already reported it lacks GPS support (so we stop asking).
          const readFields =
            isIdentity && gpsSupported !== false
              ? [...fields, ...REPEATER_GPS_SETTINGS]
              : fields;
          return (
            <Fragment key={group.id}>
              {(!filtering || shown.length > 0) && (
                <Card
                  title={t(`repeaterAdmin.config.groups.${group.id}`)}
                  action={
                    <RefreshButton
                      onClick={() => refreshSection(readFields)}
                      busy={sectionBusy(readFields)}
                      download={!sectionLoaded(fields)}
                    />
                  }
                >
                  {shown.map((setting) => {
                    // Latitude and longitude share one compact "Location" row,
                    // preceded by the Fixed/GPS source picker on GPS-capable
                    // nodes. Under GPS the coordinates are the live fix, so the
                    // manual lat/lon editor (and Set on map) are disabled; the
                    // whole trio is also locked until name + both coords load.
                    if (setting.id === 'lon') return null;
                    if (setting.id === 'name') {
                      return (
                        <SettingRow
                          key='name'
                          {...rowProps(setting)}
                          disabled={!identityLoaded}
                        />
                      );
                    }
                    if (setting.id === 'lat') {
                      const lon = group.settings.find((s) => s.id === 'lon');
                      const coordDisabled = usingGps || !identityLoaded;
                      const sourceStatus = combineStatus(
                        status.gps,
                        status.gpsAdvert,
                      );
                      return (
                        <Fragment key='location'>
                          {(gpsSupported === true ||
                            failed.has('gps') ||
                            failed.has('gpsAdvert')) && (
                            <LocationSourceRow
                              policy={advertPolicy}
                              status={sourceStatus}
                              errorText={errorMsg.gps ?? errorMsg.gpsAdvert}
                              disabled={
                                sourceStatus === 'saving' ||
                                pending.has('gps') ||
                                pending.has('gpsAdvert') ||
                                failed.has('gps') ||
                                failed.has('gpsAdvert') ||
                                !values.gps ||
                                !values.gpsAdvert
                              }
                              pending={pending}
                              failed={failed}
                              onRetry={(id) =>
                                refreshSection(
                                  REPEATER_GPS_SETTINGS.filter(
                                    (setting) => setting.id === id,
                                  ),
                                )
                              }
                              onSelect={selectPolicy}
                            />
                          )}
                          <LocationRow
                            latProps={{
                              ...rowProps(setting),
                              disabled: coordDisabled,
                            }}
                            lonProps={
                              lon
                                ? { ...rowProps(lon), disabled: coordDisabled }
                                : undefined
                            }
                          />
                        </Fragment>
                      );
                    }
                    return (
                      <SettingRow key={setting.id} {...rowProps(setting)} />
                    );
                  })}
                </Card>
              )}
              {group.id === 'identity' && radioMatches && (
                <RadioSection
                  radioValue={values.radio ?? ''}
                  txValue={values.tx ?? ''}
                  loaded={sectionLoaded(RADIO_FIELDS)}
                  pending={pending}
                  failed={failed}
                  onEdit={() => setRadioEditOpen(true)}
                  onRefresh={() => refreshSection(RADIO_FIELDS)}
                  onRetry={(id) =>
                    refreshSection(
                      RADIO_FIELDS.filter((setting) => setting.id === id),
                    )
                  }
                />
              )}
            </Fragment>
          );
        })}

        {(!filtering || advancedShown.length > 0) && (
          <Card
            title={t('repeaterAdmin.config.advanced')}
            action={
              <RefreshButton
                onClick={() => refreshSection(advancedSettings)}
                busy={sectionBusy(advancedSettings)}
                download={!sectionLoaded(advancedSettings)}
              />
            }
          >
            {advancedShown.map((setting) => (
              <SettingRow key={setting.id} {...rowProps(setting)} />
            ))}
          </Card>
        )}

        {!filtering && <ActionsSection onRun={runAction} />}
      </div>

      {noMatches && (
        <p className='mx-auto w-full max-w-6xl text-xs text-text2'>
          {t('repeaterAdmin.config.filterEmpty')}
        </p>
      )}

      {radioEditOpen && radioModalFields && (
        <RadioSettingsModal
          fields={radioModalFields}
          onApply={applyRepeaterRadio}
          onClose={() => setRadioEditOpen(false)}
        />
      )}
    </>
  );
}

interface RowProps {
  setting: RepeaterSetting;
  value: string;
  draft: string;
  onDraft: (value: string) => void;
  onCommit: (value: string) => void;
  /** Re-reads just this field, after its read went unanswered. */
  onRetry: () => void;
  status?: SaveStatus;
  errorText?: string;
  loading: boolean;
  /** The read was attempted and the node never replied. */
  failed: boolean;
  disabled?: boolean;
  nameBytes: number;
}

// Toggles and selects auto-commit on change; typed fields commit on blur or
// Enter, and an invalid edit reverts.
function SettingRow({
  setting,
  value,
  draft,
  onDraft,
  onCommit,
  onRetry,
  status,
  errorText,
  loading,
  failed,
  disabled,
  nameBytes,
}: RowProps) {
  const { t, i18n } = useTranslation();

  const label = t(`repeaterAdmin.config.fields.${setting.id}.label`);
  const hint = t(`repeaterAdmin.config.fields.${setting.id}.hint`);
  const maxBytes = setting.kind === 'text' ? nameBytes : undefined;
  const valid = isValidValue(setting, draft, maxBytes);
  // A field is "loaded" once its value has been read; before that (or if a read
  // is dropped) the row shows a placeholder instead of a control seeded from a
  // default, since nothing loads until the section's Refresh is clicked.
  const loaded = value !== '';
  // Blur/Enter (or slider release) on an editable field: commit a valid change,
  // or revert an invalid one back to the last known value.
  const commitEdit = () => {
    if (draft === value) return;
    if (valid) onCommit(draft);
    else onDraft(value);
  };

  return (
    <div className={ROW_CLASS}>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='flex min-w-0 items-center gap-1.5'>
          <span className='truncate text-text2'>{label}</span>
          {setting.requiresReboot && <RebootPill />}
        </span>
        {hint && (
          <span className='text-[11px] leading-snug text-text2 opacity-80'>
            {hint}
            {setting.kind === 'number' && (
              <>
                {' '}
                {t('repeaterAdmin.config.range', {
                  min: fmtNum(setting.min, i18n.language),
                  max: fmtNum(setting.max, i18n.language),
                })}
              </>
            )}
          </span>
        )}
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        <FieldSlot
          loading={loading}
          loaded={loaded}
          failed={failed}
          onRetry={onRetry}
        >
          {setting.kind === 'toggle' && (
            <SwitchControl
              setting={setting}
              value={draft}
              ariaLabel={label}
              onSelect={onCommit}
            />
          )}
          {setting.kind === 'number' && (
            <NumberEntry
              setting={setting}
              value={draft}
              valid={valid}
              ariaLabel={label}
              onChange={onDraft}
              onCommitEdit={commitEdit}
            />
          )}
          {setting.kind === 'select' && (
            <SelectField
              setting={setting}
              value={draft}
              ariaLabel={label}
              onSelect={onCommit}
            />
          )}
          {setting.kind === 'text' && (
            <TextField
              value={draft}
              maxBytes={maxBytes ?? setting.maxBytes}
              valid={valid}
              disabled={!!disabled}
              ariaLabel={label}
              onChange={onDraft}
              onCommitEdit={commitEdit}
            />
          )}
          <SaveStatusChip status={status} errorText={errorText} />
        </FieldSlot>
      </div>
    </div>
  );
}

function UnloadedValue() {
  return <span className='text-text2'>—</span>;
}

// A read that was attempted and never answered, told apart from one that was
// never attempted. Retrying one field costs one round trip, not a whole card.
function FailedValue({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <span className='flex items-center gap-1.5 text-xs text-amber'>
      {t('repeaterAdmin.config.noReply')}
      <button
        type='button'
        onClick={onRetry}
        className='font-semibold underline hover:opacity-80'
      >
        {t('common.retry')}
      </button>
    </span>
  );
}

function FieldSlot({
  loading,
  loaded,
  failed,
  onRetry,
  children,
}: {
  loading: boolean;
  loaded: boolean;
  failed?: boolean;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <span className='text-text2'>
        {t('repeaterAdmin.config.readingField')}
      </span>
    );
  }
  if (failed && onRetry) return <FailedValue onRetry={onRetry} />;
  if (!loaded) return <UnloadedValue />;
  return <>{children}</>;
}

function RebootPill() {
  const { t } = useTranslation();
  return (
    <span className='rounded-full bg-surface2 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-text2'>
      {t('repeaterAdmin.config.requiresReboot')}
    </span>
  );
}

function Field({
  width,
  invalid,
  disabled,
  suffix,
  children,
}: {
  width: string;
  invalid?: boolean;
  disabled?: boolean;
  suffix?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`field-group flex items-center overflow-hidden rounded-md border ${width} bg-surface focus-within:border-accent ${
        invalid ? 'border-red' : 'border-border-control'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      {children}
      {suffix != null && (
        <span className='border-l border-border-control px-1.5 py-1 text-[11px] whitespace-nowrap text-text2'>
          {suffix}
        </span>
      )}
    </div>
  );
}

function SwitchControl({
  setting,
  value,
  ariaLabel,
  onSelect,
}: {
  setting: ToggleSetting;
  value: string;
  ariaLabel: string;
  onSelect: (value: string) => void;
}) {
  const on = value === setting.on;
  return (
    <Switch
      checked={on}
      ariaLabel={ariaLabel}
      onChange={() => onSelect(on ? setting.off : setting.on)}
    />
  );
}

function NumberField({
  setting,
  value,
  valid,
  disabled,
  ariaLabel,
  width = 'w-28',
  onChange,
  onCommitEdit,
}: {
  setting: NumberSetting;
  value: string;
  valid: boolean;
  disabled: boolean;
  ariaLabel: string;
  width?: string;
  onChange: (value: string) => void;
  onCommitEdit: () => void;
}) {
  const { t } = useTranslation();
  const unit = setting.unit
    ? t(`repeaterAdmin.config.units.${setting.unit}`)
    : undefined;
  return (
    <Field
      width={width}
      invalid={!valid && value.trim() !== ''}
      disabled={disabled}
      suffix={unit}
    >
      <input
        type='number'
        inputMode='decimal'
        aria-label={ariaLabel}
        step={setting.step}
        min={setting.min}
        max={setting.max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        // Right-aligned only when a unit follows, so the two read as one
        // quantity. Alone, the value would sit against the far edge of a box
        // sized for the widest field in the column.
        className={`w-full min-w-0 bg-transparent px-2 py-1 text-xs text-text outline-none ${
          unit ? 'text-right' : 'text-center'
        }`}
      />
    </Field>
  );
}

/**
 * A number setting: a coarse slider for dragging plus a typed field for the
 * exact value.
 *
 * @remarks
 * The slider alone made precision impractical — the flood advert interval is
 * 166 steps across 160 pixels — and its `onKeyUp` commit turned one keyboard
 * step into one `set`+`get` round trip over LoRa. The slider commits on pointer
 * release or blur after keyboard edits. The typed field commits on blur or
 * Enter. The shared commit path deduplicates unchanged pending intents.
 */
function NumberEntry({
  setting,
  value,
  valid,
  ariaLabel,
  onChange,
  onCommitEdit,
}: {
  setting: NumberSetting;
  value: string;
  valid: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
  onCommitEdit: () => void;
}) {
  const n = Number(value);
  const slider = Number.isFinite(n) ? n : setting.min;
  return (
    <div className='flex items-center gap-2'>
      <input
        type='range'
        aria-label={ariaLabel}
        min={setting.min}
        max={setting.max}
        step={setting.step === 'any' ? undefined : setting.step}
        value={slider}
        onChange={(e) => onChange(e.target.value)}
        onPointerUp={onCommitEdit}
        // Arrow keys still move the thumb, so it needs a commit too — on blur,
        // not on key-up, which is what made one keyboard edit a round trip.
        onBlur={onCommitEdit}
        className='hidden w-32 accent-accent sm:block'
      />
      <NumberField
        setting={setting}
        value={value}
        valid={valid}
        disabled={false}
        ariaLabel={ariaLabel}
        width={FIELD_WIDTH}
        onChange={onChange}
        onCommitEdit={onCommitEdit}
      />
    </div>
  );
}

function SelectField({
  setting,
  value,
  ariaLabel,
  onSelect,
}: {
  setting: SelectSetting;
  value: string;
  ariaLabel: string;
  onSelect: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      value={value}
      ariaLabel={ariaLabel}
      onChange={onSelect}
      // Matches the number fields, or a content-sized dropdown leaves the
      // value column with a ragged left edge.
      className={FIELD_WIDTH}
      options={[
        // The radio reported a value outside the known set: show it so the
        // field isn't blank, but don't let it be picked again.
        ...(setting.options.includes(value)
          ? []
          : [{ value, label: '\u2014', disabled: true }]),
        ...setting.options.map((o) => ({
          value: o,
          label: optionLabel(t, setting.id, o),
        })),
      ]}
    />
  );
}

function TextField({
  value,
  maxBytes,
  valid,
  disabled,
  ariaLabel,
  onChange,
  onCommitEdit,
}: {
  value: string;
  maxBytes: number;
  valid: boolean;
  disabled: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
  onCommitEdit: () => void;
}) {
  const bytes = utf8ByteLength(value);
  return (
    <Field
      width='w-52'
      invalid={!valid && value.trim() !== ''}
      disabled={disabled}
      suffix={
        <span className={bytes > maxBytes ? 'text-red' : undefined}>
          {bytes}/{maxBytes}
        </span>
      }
    >
      <input
        type='text'
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className='w-full min-w-0 bg-transparent px-2 py-1 text-xs text-text outline-none'
      />
    </Field>
  );
}

const LOCATION_POLICIES = [
  { value: 'none', labelKey: 'repeaterAdmin.config.options.gpsAdvert.none' },
  { value: 'prefs', labelKey: 'repeaterAdmin.config.options.gpsAdvert.prefs' },
  { value: 'share', labelKey: 'repeaterAdmin.config.options.gpsAdvert.share' },
] as const;

// All three of the firmware's `gps advert` policies are distinct, so a node set
// to Off must not be shown as Fixed. GPS also disables the manual editor.
function LocationSourceRow({
  policy,
  status,
  errorText,
  disabled,
  pending,
  failed,
  onRetry,
  onSelect,
}: {
  policy: string;
  status?: SaveStatus;
  errorText?: string;
  disabled: boolean;
  pending: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  onRetry: (id: 'gps' | 'gpsAdvert') => void;
  onSelect: (policy: (typeof GPS_ADVERT_OPTIONS)[number]) => void;
}) {
  const { t } = useTranslation();
  // The policy is empty until the `gpsAdvert` read lands, and a radiogroup with
  // nothing checked still needs one tab stop, so fall back to the first radio.
  const activeIdx = LOCATION_POLICIES.findIndex((p) => p.value === policy);
  const tabStop = activeIdx === -1 ? 0 : activeIdx;
  return (
    <div className={ROW_CLASS}>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='truncate text-text2'>
          {t('settings.locationSource')}
        </span>
        <span className='text-[11px] leading-snug text-text2 opacity-80'>
          {t('repeaterAdmin.config.fields.gps.hint')}
        </span>
        <span className='text-[11px] leading-snug text-text2 opacity-80'>
          {t('repeaterAdmin.config.fields.gpsAdvert.hint')}
        </span>
      </div>
      <div className='flex shrink-0 flex-col items-end gap-2'>
        {(['gps', 'gpsAdvert'] as const).map((id) =>
          pending.has(id) || failed.has(id) ? (
            <div key={id} className='flex items-center gap-2 text-xs'>
              <span>{t(`repeaterAdmin.config.fields.${id}.label`)}</span>
              <FieldSlot
                loading={pending.has(id)}
                loaded={false}
                failed={failed.has(id)}
                onRetry={() => onRetry(id)}
              >
                {null}
              </FieldSlot>
            </div>
          ) : null,
        )}
        <div
          role='radiogroup'
          aria-label={t('settings.locationSource')}
          onKeyDown={(e) =>
            handleRovingKeyDown(e, LOCATION_POLICIES.length, tabStop, (i) =>
              onSelect(LOCATION_POLICIES[i].value),
            )
          }
          className='inline-flex rounded-md border border-border-control p-0.5'
        >
          {LOCATION_POLICIES.map(({ value, labelKey }, i) => {
            const active = policy === value;
            return (
              <button
                key={value}
                type='button'
                role='radio'
                aria-checked={active}
                tabIndex={i === tabStop ? 0 : -1}
                disabled={disabled}
                onClick={() => onSelect(value)}
                className={`rounded px-3 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? 'bg-accent-solid font-semibold text-white inset-ring-1 inset-ring-accent'
                    : 'text-text2 hover:text-text'
                }`}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>
        <SaveStatusChip status={status} errorText={errorText} />
      </div>
    </div>
  );
}

function LocationRow({
  latProps,
  lonProps,
}: {
  latProps: RowProps;
  lonProps?: RowProps;
}) {
  const { t } = useTranslation();
  const disabled = latProps.disabled ?? false;
  // One status for the whole row, since lat and lon commit as a pair: any write
  // in flight shows saving, any failure shows the error, else the saved tick.
  const rowStatus = combineStatus(latProps.status, lonProps?.status);
  const rowError = latProps.errorText ?? lonProps?.errorText;
  return (
    <div className={ROW_CLASS}>
      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <span className='truncate text-text2'>
          {t('repeaterAdmin.config.location')}
        </span>
        <span className='text-[11px] leading-snug text-text2 opacity-80'>
          {t('repeaterAdmin.config.fields.lat.hint')}
        </span>
        <span className='text-[11px] leading-snug text-text2 opacity-80'>
          {t('repeaterAdmin.config.fields.lon.hint')}
        </span>
      </div>
      <div className='flex shrink-0 flex-wrap items-center justify-end gap-2'>
        <CoordField {...latProps} />
        {lonProps && <CoordField {...lonProps} />}
        {!disabled && (
          <button
            type='button'
            onClick={() => useMeshStore.getState().startLocationPick('chat')}
            className='shrink-0 rounded-md border border-border-control px-3 py-1 text-xs text-text2 hover:text-text'
          >
            {t('settings.setOnMap')}
          </button>
        )}
        <SaveStatusChip status={rowStatus} errorText={rowError} />
      </div>
    </div>
  );
}

// Lets the paired lat/lon row show a single status dot.
function combineStatus(a?: SaveStatus, b?: SaveStatus): SaveStatus | undefined {
  if (a === 'saving' || b === 'saving') return 'saving';
  if (a === 'error' || b === 'error') return 'error';
  if (a === 'saved' || b === 'saved') return 'saved';
  return undefined;
}

function CoordField({
  setting,
  value,
  draft,
  onDraft,
  onCommit,
  disabled,
  loading,
  failed,
  onRetry,
}: RowProps) {
  const { t } = useTranslation();
  const label = t(`repeaterAdmin.config.fields.${setting.id}.label`);
  const valid = isValidValue(setting, draft);
  const commitEdit = () => {
    if (draft === value) return;
    if (valid) onCommit(draft);
    else onDraft(value);
  };
  return (
    <div className='flex items-center gap-1.5'>
      <span className='text-[11px] text-text2'>{label}</span>
      <FieldSlot
        loading={loading}
        loaded={value !== ''}
        failed={failed}
        onRetry={onRetry}
      >
        <NumberField
          setting={setting as NumberSetting}
          value={draft}
          valid={valid}
          disabled={!!disabled}
          ariaLabel={label}
          width='w-36'
          onChange={onDraft}
          onCommitEdit={commitEdit}
        />
      </FieldSlot>
    </div>
  );
}

// Edit is disabled until both values load, since the editor needs them to seed
// its draft.
function RadioSection({
  radioValue,
  txValue,
  loaded,
  pending,
  failed,
  onEdit,
  onRefresh,
  onRetry,
}: {
  radioValue: string;
  txValue: string;
  loaded: boolean;
  pending: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  onEdit: () => void;
  onRefresh: () => void;
  onRetry: (id: 'radio' | 'tx') => void;
}) {
  const { t, i18n } = useTranslation();
  const num = (n: number) => fmtNum(n, i18n.language);
  const parsed = parseRadio(radioValue);
  const busy = pending.has('radio') || pending.has('tx');
  const ready =
    parsed != null &&
    txValue !== '' &&
    !busy &&
    !failed.has('radio') &&
    !failed.has('tx');
  const rows: { id: 'radio' | 'tx'; label: string; value: string | null }[] = [
    {
      id: 'radio',
      label: t('settings.frequency'),
      value: parsed ? t('settings.mhz', { value: num(parsed.freq) }) : null,
    },
    {
      id: 'radio',
      label: t('settings.bandwidth'),
      value: parsed ? t('settings.khz', { value: num(parsed.bw) }) : null,
    },
    {
      id: 'radio',
      label: t('settings.spreadingFactor'),
      value: parsed ? num(parsed.sf) : null,
    },
    {
      id: 'radio',
      label: t('settings.codingRate'),
      value: parsed
        ? t('settings.radioEdit.crLabel', { value: parsed.cr })
        : null,
    },
    {
      id: 'tx',
      label: t('settings.txPower'),
      value:
        txValue !== '' ? t('units.dbm', { value: num(Number(txValue)) }) : null,
    },
  ];

  return (
    <Card
      title={t('repeaterAdmin.config.fields.radio.label')}
      action={
        <div className='flex items-center gap-2'>
          <RebootPill />
          <RefreshButton onClick={onRefresh} busy={busy} download={!loaded} />
          <button
            onClick={onEdit}
            disabled={!ready}
            className='rounded-md border border-border-control px-2.5 py-1 text-xs text-text2 hover:text-text disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-text2'
          >
            {t('repeaterAdmin.config.edit')}
          </button>
        </div>
      }
    >
      <p className='mb-1 text-[11px] leading-snug text-text2 opacity-80'>
        {t('repeaterAdmin.config.fields.radio.hint')}
      </p>
      <p className='mb-2 text-[11px] leading-snug text-text2 opacity-80'>
        {t('repeaterAdmin.config.fields.tx.hint')}
      </p>
      {rows.map((row) => (
        <ValueRow
          key={row.label}
          label={row.label}
          value={row.value}
          loading={pending.has(row.id)}
          failed={failed.has(row.id)}
          onRetry={() => onRetry(row.id)}
        />
      ))}
    </Card>
  );
}

function ValueRow({
  label,
  value,
  loading,
  failed,
  onRetry,
}: {
  label: string;
  value: string | null;
  loading: boolean;
  failed?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className={ROW_CLASS}>
      <span className='shrink-0 text-text2'>{label}</span>
      <FieldSlot
        loading={loading}
        loaded={value != null}
        failed={failed}
        onRetry={onRetry}
      >
        <span className='font-semibold'>{value}</span>
      </FieldSlot>
    </div>
  );
}

function ActionsSection({
  onRun,
}: {
  onRun: (action: RepeaterAction) => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const reboot = REPEATER_ACTIONS.find((a) => a.id === 'reboot');

  return (
    <Card title={t('repeaterAdmin.config.actionsTitle')}>
      <div className='flex flex-wrap items-center gap-2'>
        {REPEATER_ACTIONS.filter((a) => !a.destructive).map((a) => (
          <button
            key={a.id}
            onClick={() => onRun(a)}
            className='rounded-md border border-border-control px-3 py-1.5 text-xs text-text hover:bg-surface'
          >
            {t(`repeaterAdmin.config.actions.${a.id}.label`)}
          </button>
        ))}
        {reboot && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className='ml-auto rounded-md border border-red px-3 py-1.5 text-xs text-red hover:bg-red-dim hover:text-white'
          >
            {t('repeaterAdmin.config.actions.reboot.label')}
          </button>
        )}
      </div>

      {reboot && confirming && (
        <div className='mt-3 flex items-center justify-between gap-3 border-t border-border pt-3'>
          <span className='text-xs text-text2'>
            {t('repeaterAdmin.config.actions.reboot.confirm')}
          </span>
          <div className='flex shrink-0 gap-2'>
            <button
              onClick={() => setConfirming(false)}
              className='rounded-md px-3 py-1.5 text-xs text-text hover:bg-surface'
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                onRun(reboot);
                setConfirming(false);
              }}
              className='rounded-md bg-red-solid px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-hover'
            >
              {t('repeaterAdmin.config.actions.reboot.label')}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// One `as const satisfies Record<(typeof OPTIONS)[number], string>` map per
// setting: the keys resolve to a checked literal union (never a bare template
// literal, per the localization rule) and the map must stay exhaustive, so
// adding an option without a label fails the build.
const OPTION_LABEL_KEYS = {
  loopDetect: {
    off: 'repeaterAdmin.config.options.loopDetect.off',
    minimal: 'repeaterAdmin.config.options.loopDetect.minimal',
    moderate: 'repeaterAdmin.config.options.loopDetect.moderate',
    strict: 'repeaterAdmin.config.options.loopDetect.strict',
  },
  gpsAdvert: {
    none: 'repeaterAdmin.config.options.gpsAdvert.none',
    share: 'repeaterAdmin.config.options.gpsAdvert.share',
    prefs: 'repeaterAdmin.config.options.gpsAdvert.prefs',
  },
  pathHashMode: {
    '0': 'repeaterAdmin.config.options.pathHashMode.0',
    '1': 'repeaterAdmin.config.options.pathHashMode.1',
    '2': 'repeaterAdmin.config.options.pathHashMode.2',
  },
} as const satisfies {
  loopDetect: Record<(typeof LOOP_DETECT_OPTIONS)[number], string>;
  gpsAdvert: Record<(typeof GPS_ADVERT_OPTIONS)[number], string>;
  pathHashMode: Record<(typeof PATH_HASH_MODE_OPTIONS)[number], string>;
};

// The key comes from OPTION_LABEL_KEYS (a checked literal union), but `t()` is
// called through a string-typed alias: i18next's typed `t()` exceeds
// TypeScript's instantiation depth for these deeply-nested keys once the
// catalog is this large — even a single concrete literal trips it.
function optionLabel(
  t: ReturnType<typeof useTranslation>['t'],
  id: SelectSetting['id'],
  value: string,
): string {
  const translate = t as (key: string) => string;
  if (id === 'loopDetect') {
    const key = value as (typeof LOOP_DETECT_OPTIONS)[number];
    return translate(OPTION_LABEL_KEYS.loopDetect[key]);
  }
  if (id === 'gpsAdvert') {
    const key = value as (typeof GPS_ADVERT_OPTIONS)[number];
    return translate(OPTION_LABEL_KEYS.gpsAdvert[key]);
  }
  const key = value as (typeof PATH_HASH_MODE_OPTIONS)[number];
  return translate(OPTION_LABEL_KEYS.pathHashMode[key]);
}
