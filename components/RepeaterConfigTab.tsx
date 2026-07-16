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
import { Card } from './Card';
import { RefreshButton } from './RefreshButton';
import { RadioSettingsModal } from './RadioSettings';
import { SaveStatusChip, type SaveStatus } from './SaveStatus';
import type { Contact, RadioParams } from '@/types/meshcore';

/** The map of settings ids to their current on-device / draft values. */
type ValueMap = Record<string, string>;

/** Stable empty values map, so an uncached repeater doesn't churn renders. */
const EMPTY_VALUES: ValueMap = {};

/** Shared className for a config row: label left, content right, hairline. */
const ROW_CLASS =
  'flex items-center justify-between gap-3 border-b border-(--border) py-1.5 text-xs last:border-0';

/**
 * The result of one commit round-trip: either the node's authoritative value
 * (which may be rounded or clamped from what was sent), or its error reply.
 */
type CommitOutcome =
  { kind: 'ok'; value: string } | { kind: 'rejected'; reply: string };

/**
 * How many times a prefill re-requests fields that didn't answer. CLI replies
 * are frequently dropped over the mesh, so a couple of retry passes markedly
 * improve how many fields fill in without a manual refresh. A pass in which
 * nothing at all answered ends the read early — see {@link RepeaterConfigTab}.
 */
const READ_PASSES = 3;

/**
 * The radio-related fields, shown together in their own card (like the Settings
 * page's Radio section) rather than inside the Identity group they're cataloged
 * in. Loaded and edited as a unit via {@link RadioSection}.
 */
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
 * Renders read-only when `readOnly` (guest).
 */
export function RepeaterConfigTab({
  contact,
  readOnly,
}: {
  contact: Contact;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const { repeaterCliRequest, repeaterCli, clearRepeaterCli } = useMeshCore();
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
  // Whether the shared radio/TX editor modal is open.
  const [radioEditOpen, setRadioEditOpen] = useState(false);

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
              // Timeout or an unreadable reply — retry on a later pass.
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
      read(settings);
    },
    [read],
  );

  // Track liveness for in-flight reads/commits, and on unmount drop any pending
  // CLI request so its reply can't reach a new panel. Nothing is read here —
  // the user pulls each section on demand.
  useEffect(() => {
    aliveRef.current = true;
    const timers = savedTimers.current;
    const prefix = contactRef.current.pubkeyPrefix;
    return () => {
      aliveRef.current = false;
      clearRepeaterCli(prefix);
      for (const timer of Object.values(timers)) clearTimeout(timer);
    };
  }, [clearRepeaterCli]);

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
      const maxBytes =
        setting.kind === 'text'
          ? nameMaxBytes(
              draftsRef.current.lat ?? '',
              draftsRef.current.lon ?? '',
            )
          : undefined;
      if (!isValidValue(setting, next, maxBytes)) return;
      // Setting a non-zero coordinate shrinks the name budget from 32 to 24
      // bytes; refuse a coordinate that would leave the current name over that
      // budget (the node would reject or clip it) and tell the user to shorten
      // the name first, so the two never drift out of the documented limit.
      if (setting.id === 'lat' || setting.id === 'lon') {
        const lat = setting.id === 'lat' ? next : (draftsRef.current.lat ?? '');
        const lon = setting.id === 'lon' ? next : (draftsRef.current.lon ?? '');
        const name = draftsRef.current.name ?? valuesRef.current.name ?? '';
        if (utf8ByteLength(name) > nameMaxBytes(lat, lon)) {
          showToast(t('toast.repeaterNameTooLongForLocation'), 'error');
          setDrafts((prev) => ({ ...prev, [id]: valuesRef.current[id] ?? '' }));
          return;
        }
      }
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
        // If a newer edit has already superseded this write, it now owns the
        // visible draft and status — don't clobber them with this stale
        // confirmation. (During 50→60→50, the 60 landing must not flip the
        // shown 50 to "saved" before its own round trip finishes.) The newer
        // write caches its own confirmed value when it settles.
        if (intentRef.current[id] !== next) return;
        intentRef.current[id] = confirmed;
        cacheValues({ [id]: confirmed });
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
    if (readOnly) return;
    const latSetting = ALL_REPEATER_SETTINGS.find((s) => s.id === 'lat');
    const lonSetting = ALL_REPEATER_SETTINGS.find((s) => s.id === 'lon');
    // Defer out of the effect body so the commits' optimistic setState isn't a
    // synchronous render cascade (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (latSetting) void commit(latSetting, String(pending.lat));
      if (lonSetting) void commit(lonSetting, String(pending.lon));
    });
  }, [commit, readOnly]);

  const runAction = useCallback(
    async (action: RepeaterAction) => {
      // Confirm success only after the send is accepted (or the node stays
      // silent by design, e.g. reboot); a failed/disconnected send is surfaced
      // by repeaterCli itself, so don't show a premature "sent" toast.
      const ok = await repeaterCli(contact, action.cmd);
      if (ok) showToast(t('toast.repeaterActionSent'), 'success');
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
      try {
        // Both writes travel as one queued unit, so a concurrent field edit
        // can't land between the LoRa quad and the TX power it pairs with.
        // `applied` carries whatever was accepted before any rejection, so a
        // half-applied pair still caches the half that stuck.
        const { applied, rejected } = await enqueue(
          async (): Promise<{ applied: ValueMap; rejected: string | null }> => {
            const applied: ValueMap = {};
            // Confirm a write with a re-read so the cached/shown value is the
            // node's authoritative one (freq/bw/sf/cr and TX power may be
            // clamped or rounded), matching the per-field commit contract.
            // Falls back to the sent value if the confirming read is dropped
            // or can't be parsed.
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
            if (radioChanged) {
              const reply = await requestRef.current(
                contactRef.current,
                setCommand(radioSetting, radioStr),
              );
              if (isErrorReply(reply, radioSetting)) {
                return { applied, rejected: reply.trim() };
              }
              applied.radio = await confirm(radioSetting, radioStr);
            }
            if (txChanged) {
              const reply = await requestRef.current(
                contactRef.current,
                setCommand(txSetting, txStr),
              );
              if (isErrorReply(reply, txSetting)) {
                return { applied, rejected: reply.trim() };
              }
              applied.tx = await confirm(txSetting, txStr);
            }
            return { applied, rejected: null };
          },
        );
        if (!aliveRef.current) return false;
        if (Object.keys(applied).length > 0) {
          cacheValues(applied);
          setDrafts((prev) => ({ ...prev, ...applied }));
        }
        if (rejected != null) {
          showToast(
            t('toast.repeaterConfigError', { error: rejected }),
            'error',
          );
          return false;
        }
        showToast(t('toast.radioParamsSaved'), 'success');
        return true;
      } catch (err) {
        if (!aliveRef.current) return false;
        showToast(
          t('toast.repeaterCliFailed', { error: (err as Error).message }),
          'error',
        );
        return false;
      }
    },
    [enqueue, showToast, t, cacheValues],
  );

  const nameBytes = nameMaxBytes(drafts.lat ?? '', drafts.lon ?? '');
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
  const radioModalFields =
    radioParsed && txValue !== '' && Number.isFinite(txNum)
      ? {
          radioFreq: radioParsed.freq,
          radioBw: radioParsed.bw,
          radioSf: radioParsed.sf,
          radioCr: radioParsed.cr,
          txPower: txNum,
          maxTxPower,
        }
      : null;

  const rowProps = (setting: RepeaterSetting) => ({
    setting,
    value: values[setting.id] ?? '',
    onDraft: (v: string) => setDrafts((prev) => ({ ...prev, [setting.id]: v })),
    onCommit: (v: string) => void commit(setting, v),
    draft: drafts[setting.id] ?? '',
    status: status[setting.id],
    errorText: errorMsg[setting.id],
    loading: pending.has(setting.id),
    readOnly,
    nameBytes,
  });

  // The advertised location source, mirroring the companion's Settings card.
  // Keyed on the advert policy (`share` = live GPS) rather than an OR of the
  // module + policy, so a half-applied write (e.g. module on but policy still
  // `prefs`) reports the source that is actually advertised, and re-selecting
  // reissues the write that didn't stick.
  const usingGps = gpsSupported === true && drafts.gpsAdvert === 'share';
  const gpsSetting = REPEATER_GPS_SETTINGS.find((s) => s.id === 'gps');
  const gpsAdvertSetting = REPEATER_GPS_SETTINGS.find(
    (s) => s.id === 'gpsAdvert',
  );

  // Switch the Fixed/GPS source: GPS turns the module on and advertises its
  // live fix (`share`); Fixed turns it off and advertises the stored lat/lon
  // (`prefs`). Each write goes through the same serialized commit path (which
  // no-ops an unchanged field), so a partial failure stays retryable — re-
  // selecting reissues only the field that didn't stick, and the row's single
  // status reflects the pair.
  const selectSource = (nextUseGps: boolean) => {
    if (readOnly || !gpsSetting || !gpsAdvertSetting) return;
    void commit(gpsSetting, nextUseGps ? 'on' : 'off');
    void commit(gpsAdvertSetting, nextUseGps ? 'share' : 'prefs');
  };

  return (
    <>
      <div className='mx-auto grid w-full max-w-6xl grid-cols-1 gap-4 xl:grid-cols-2'>
        {readOnly && (
          <p
            className='rounded-md border border-(--border) p-3 text-xs text-(--text2) xl:col-span-2'
            style={{ background: 'var(--surface2)' }}
          >
            {t('repeaterAdmin.config.readOnlyNotice')}
          </p>
        )}

        {REPEATER_SETTING_GROUPS.map((group) => {
          // Radio + TX power live in their own card (see RadioSection), like
          // the Settings page; keep them out of the group they're cataloged in.
          const fields = group.settings.filter(
            (s) => s.id !== 'radio' && s.id !== 'tx',
          );
          const isIdentity = group.id === 'identity';
          // The Identity refresh also probes/loads the GPS controls, unless the
          // node has already reported it lacks GPS support (so we stop asking).
          const readFields =
            isIdentity && gpsSupported !== false
              ? [...fields, ...REPEATER_GPS_SETTINGS]
              : fields;
          return (
            <Fragment key={group.id}>
              <Card
                title={t(`repeaterAdmin.config.groups.${group.id}`)}
                action={
                  readOnly ? undefined : (
                    <RefreshButton
                      onClick={() => refreshSection(readFields)}
                      busy={sectionBusy(readFields)}
                      download={!sectionLoaded(fields)}
                    />
                  )
                }
              >
                {fields.map((setting) => {
                  // Latitude and longitude share one compact "Location" row,
                  // preceded by the Fixed/GPS source picker on GPS-capable
                  // nodes. Under GPS the coordinates are the live fix, so the
                  // manual lat/lon editor (and Set on map) are disabled.
                  if (setting.id === 'lon') return null;
                  if (setting.id === 'lat') {
                    const lon = group.settings.find((s) => s.id === 'lon');
                    const coordReadOnly = readOnly || usingGps;
                    const sourceStatus = combineStatus(
                      status.gps,
                      status.gpsAdvert,
                    );
                    return (
                      <Fragment key='location'>
                        {gpsSupported === true && (
                          <LocationSourceRow
                            useGps={usingGps}
                            status={sourceStatus}
                            errorText={errorMsg.gps ?? errorMsg.gpsAdvert}
                            readOnly={readOnly || sourceStatus === 'saving'}
                            onSelect={selectSource}
                          />
                        )}
                        <LocationRow
                          latProps={{
                            ...rowProps(setting),
                            readOnly: coordReadOnly,
                          }}
                          lonProps={
                            lon
                              ? { ...rowProps(lon), readOnly: coordReadOnly }
                              : undefined
                          }
                        />
                      </Fragment>
                    );
                  }
                  return <SettingRow key={setting.id} {...rowProps(setting)} />;
                })}
              </Card>
              {group.id === 'identity' && (
                <RadioSection
                  radioValue={values.radio ?? ''}
                  txValue={values.tx ?? ''}
                  busy={sectionBusy(RADIO_FIELDS)}
                  loaded={sectionLoaded(RADIO_FIELDS)}
                  readOnly={readOnly}
                  onEdit={() => setRadioEditOpen(true)}
                  onRefresh={() => refreshSection(RADIO_FIELDS)}
                />
              )}
            </Fragment>
          );
        })}

        <Card
          title={t('repeaterAdmin.config.advanced')}
          action={
            readOnly ? undefined : (
              <RefreshButton
                onClick={() => refreshSection(REPEATER_ADVANCED_SETTINGS)}
                busy={sectionBusy(REPEATER_ADVANCED_SETTINGS)}
                download={!sectionLoaded(REPEATER_ADVANCED_SETTINGS)}
              />
            )
          }
        >
          {REPEATER_ADVANCED_SETTINGS.map((setting) => (
            <SettingRow key={setting.id} {...rowProps(setting)} />
          ))}
        </Card>

        {!readOnly && <ActionsSection onRun={runAction} />}
      </div>

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

/** Props shared by every {@link SettingRow}. */
interface RowProps {
  setting: RepeaterSetting;
  value: string;
  draft: string;
  onDraft: (value: string) => void;
  onCommit: (value: string) => void;
  status?: SaveStatus;
  errorText?: string;
  loading: boolean;
  readOnly: boolean;
  nameBytes: number;
}

/**
 * One setting as a compact label→control row. Toggles/selects auto-commit on
 * change; typed fields commit on blur/Enter (an invalid edit reverts). A slider
 * drives number fields; the load state is rendered by {@link FieldSlot}.
 */
function SettingRow({
  setting,
  value,
  draft,
  onDraft,
  onCommit,
  status,
  errorText,
  loading,
  readOnly,
  nameBytes,
}: RowProps) {
  const { t } = useTranslation();

  const label = t(`repeaterAdmin.config.fields.${setting.id}.label`);
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
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        <span className='truncate text-(--text2)'>{label}</span>
        {setting.requiresReboot && <RebootPill />}
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        <FieldSlot loading={loading} loaded={loaded}>
          {setting.kind === 'toggle' && (
            <SwitchControl
              setting={setting}
              value={draft}
              disabled={readOnly}
              ariaLabel={label}
              onSelect={onCommit}
            />
          )}
          {setting.kind === 'number' && (
            <SliderField
              setting={setting}
              value={draft}
              disabled={readOnly}
              ariaLabel={label}
              onChange={onDraft}
              onCommitEdit={commitEdit}
            />
          )}
          {setting.kind === 'select' && (
            <SelectField
              setting={setting}
              value={draft}
              disabled={readOnly}
              ariaLabel={label}
              onSelect={onCommit}
            />
          )}
          {setting.kind === 'text' && (
            <TextField
              value={draft}
              maxBytes={maxBytes ?? setting.maxBytes}
              valid={valid}
              disabled={readOnly}
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

/** Placeholder for a field whose value hasn't been loaded yet. */
function UnloadedValue() {
  return <span className='text-(--text2)'>—</span>;
}

/**
 * Renders a row's right-hand content by load state: a "reading" caption while
 * fetching, a placeholder until the value first loads, else its control(s).
 */
function FieldSlot({
  loading,
  loaded,
  children,
}: {
  loading: boolean;
  loaded: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <span className='text-(--text2)'>
        {t('repeaterAdmin.config.readingField')}
      </span>
    );
  }
  if (!loaded) return <UnloadedValue />;
  return <>{children}</>;
}

/** A small "requires reboot" badge shown beside affected fields. */
function RebootPill() {
  const { t } = useTranslation();
  return (
    <span className='rounded-full bg-(--surface2) px-1.5 py-0.5 text-[10px] whitespace-nowrap text-(--text2)'>
      {t('repeaterAdmin.config.requiresReboot')}
    </span>
  );
}

/** A bordered input group: a control plus an optional in-field unit suffix. */
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
      className={`flex items-center overflow-hidden rounded-md border ${width} bg-(--surface) focus-within:border-(--accent) ${
        invalid ? 'border-(--red)' : 'border-(--border-control)'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      {children}
      {suffix != null && (
        <span className='border-l border-(--border-control) px-1.5 py-1 text-[11px] whitespace-nowrap text-(--text2)'>
          {suffix}
        </span>
      )}
    </div>
  );
}

/** A modern on/off switch bound to a toggle setting's wire tokens. */
function SwitchControl({
  setting,
  value,
  disabled,
  ariaLabel,
  onSelect,
}: {
  setting: ToggleSetting;
  value: string;
  disabled: boolean;
  ariaLabel: string;
  onSelect: (value: string) => void;
}) {
  const on = value === setting.on;
  return (
    <button
      type='button'
      role='switch'
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onSelect(on ? setting.off : setting.on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
        on ? 'bg-(--accent)' : 'bg-(--border-control)'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/** A right-sized numeric input with an in-field unit suffix. */
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
        step={setting.integer ? 1 : 'any'}
        min={setting.min}
        max={setting.max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className='w-full min-w-0 bg-transparent px-2 py-1 text-right text-xs text-(--text) outline-none'
      />
    </Field>
  );
}

/**
 * A numeric slider with a live value readout and unit. Dragging updates the
 * draft; the change commits on release (pointer up / key up), so a drag doesn't
 * fire a `set` on every tick.
 */
function SliderField({
  setting,
  value,
  disabled,
  ariaLabel,
  onChange,
  onCommitEdit,
}: {
  setting: NumberSetting;
  value: string;
  disabled: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
  onCommitEdit: () => void;
}) {
  const { t, i18n } = useTranslation();
  const unit = setting.unit
    ? t(`repeaterAdmin.config.units.${setting.unit}`)
    : undefined;
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
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onPointerUp={onCommitEdit}
        onKeyUp={onCommitEdit}
        className='w-40 accent-(--accent) disabled:opacity-60'
      />
      <span className='w-20 shrink-0 text-right text-xs text-(--text) tabular-nums'>
        {fmtNum(slider, i18n.language)}
        {unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
}

/** A content-sized dropdown over a select setting's fixed options. */
function SelectField({
  setting,
  value,
  disabled,
  ariaLabel,
  onSelect,
}: {
  setting: SelectSetting;
  value: string;
  disabled: boolean;
  ariaLabel: string;
  onSelect: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <select
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onSelect(e.target.value)}
      className='rounded-md border border-(--border-control) bg-(--surface) px-2 py-1 text-xs text-(--text) outline-none focus:border-(--accent) disabled:opacity-60'
    >
      {!setting.options.includes(value) && (
        <option value={value} disabled>
          —
        </option>
      )}
      {setting.options.map((o) => (
        <option key={o} value={o}>
          {optionLabel(t, setting.id, o)}
        </option>
      ))}
    </select>
  );
}

/** A name input with a live UTF-8 byte counter shown as an in-field suffix. */
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
        <span className={bytes > maxBytes ? 'text-(--red)' : undefined}>
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
        className='w-full min-w-0 bg-transparent px-2 py-1 text-xs text-(--text) outline-none'
      />
    </Field>
  );
}

/** The location sources offered on a GPS-capable node. */
const LOCATION_SOURCES = [
  { useGps: false, labelKey: 'settings.locationSourceFixed' },
  { useGps: true, labelKey: 'settings.locationSourceGps' },
] as const;

/**
 * The Fixed/GPS source picker for a GPS-capable node, mirroring the companion
 * radio's Settings location card. Fixed advertises the stored lat/lon; GPS
 * advertises the module's live fix (and disables the manual coordinate editor).
 */
function LocationSourceRow({
  useGps,
  status,
  errorText,
  readOnly,
  onSelect,
}: {
  useGps: boolean;
  status?: SaveStatus;
  errorText?: string;
  readOnly: boolean;
  onSelect: (useGps: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={ROW_CLASS}>
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        <span className='truncate text-(--text2)'>
          {t('settings.locationSource')}
        </span>
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        <div
          role='radiogroup'
          aria-label={t('settings.locationSource')}
          className='inline-flex rounded-md border border-(--border-control) p-0.5'
        >
          {LOCATION_SOURCES.map(({ useGps: optGps, labelKey }) => {
            const active = useGps === optGps;
            return (
              <button
                key={labelKey}
                type='button'
                role='radio'
                aria-checked={active}
                disabled={readOnly}
                onClick={() => onSelect(optGps)}
                className={`rounded px-3 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? 'bg-(--accent) font-semibold text-white'
                    : 'text-(--text2) hover:text-(--text)'
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

/** Latitude and longitude paired on one compact row under "Location". */
function LocationRow({
  latProps,
  lonProps,
}: {
  latProps: RowProps;
  lonProps?: RowProps;
}) {
  const { t } = useTranslation();
  const loading = latProps.loading || (lonProps?.loading ?? false);
  const loaded = latProps.value !== '' || (lonProps?.value ?? '') !== '';
  const readOnly = latProps.readOnly;
  // One status for the whole row, since lat and lon commit as a pair: any write
  // in flight shows saving, any failure shows the error, else the saved tick.
  const rowStatus = combineStatus(latProps.status, lonProps?.status);
  const rowError = latProps.errorText ?? lonProps?.errorText;
  return (
    <div className={ROW_CLASS}>
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        <span className='truncate text-(--text2)'>
          {t('repeaterAdmin.config.location')}
        </span>
      </div>
      <div className='flex shrink-0 flex-wrap items-center justify-end gap-2'>
        <FieldSlot loading={loading} loaded={loaded}>
          <CoordField {...latProps} />
          {lonProps && <CoordField {...lonProps} />}
          {!readOnly && (
            <button
              type='button'
              onClick={() => useMeshStore.getState().startLocationPick('chat')}
              className='shrink-0 rounded-md border border-(--border-control) px-3 py-1 text-xs text-(--text2) hover:text-(--text)'
            >
              {t('settings.setOnMap')}
            </button>
          )}
          <SaveStatusChip status={rowStatus} errorText={rowError} />
        </FieldSlot>
      </div>
    </div>
  );
}

/**
 * Combines two fields' save states into one: any in-flight write wins, then any
 * error, then a saved tick, else idle. Lets the paired lat/lon row show a
 * single status dot.
 */
function combineStatus(a?: SaveStatus, b?: SaveStatus): SaveStatus | undefined {
  if (a === 'saving' || b === 'saving') return 'saving';
  if (a === 'error' || b === 'error') return 'error';
  if (a === 'saved' || b === 'saved') return 'saved';
  return undefined;
}

/** One coordinate input (lat or lon) with its own caption. */
function CoordField({
  setting,
  value,
  draft,
  onDraft,
  onCommit,
  readOnly,
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
      <span className='text-[11px] text-(--text2)'>{label}</span>
      <NumberField
        setting={setting as NumberSetting}
        value={draft}
        valid={valid}
        disabled={readOnly}
        ariaLabel={label}
        width='w-36'
        onChange={onDraft}
        onCommitEdit={commitEdit}
      />
    </div>
  );
}

/**
 * The LoRa parameters and TX power as their own card, mirroring the Settings
 * page's Radio section: a read-only breakdown of frequency, bandwidth,
 * spreading factor, coding rate, and TX power, with a Refresh to load them and
 * an Edit that opens the shared {@link RadioSettingsModal}. Reuses {@link Card}
 * and {@link RefreshButton}; Edit is disabled until both values load, since the
 * editor needs them to seed its draft.
 *
 * @param busy - a read of either field is in flight: spins Refresh and shows
 *   the rows as "reading".
 * @param loaded - either field has a value, so Refresh drops its download
 *   glyph.
 */
function RadioSection({
  radioValue,
  txValue,
  busy,
  loaded,
  readOnly,
  onEdit,
  onRefresh,
}: {
  radioValue: string;
  txValue: string;
  busy: boolean;
  loaded: boolean;
  readOnly: boolean;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  const num = (n: number) => fmtNum(n, i18n.language);
  const parsed = parseRadio(radioValue);
  const ready = parsed != null && txValue !== '';
  const rows: { label: string; value: string | null }[] = [
    {
      label: t('settings.frequency'),
      value: parsed ? t('settings.mhz', { value: num(parsed.freq) }) : null,
    },
    {
      label: t('settings.bandwidth'),
      value: parsed ? t('settings.khz', { value: num(parsed.bw) }) : null,
    },
    {
      label: t('settings.spreadingFactor'),
      value: parsed ? num(parsed.sf) : null,
    },
    {
      label: t('settings.codingRate'),
      value: parsed
        ? t('settings.radioEdit.crLabel', { value: parsed.cr })
        : null,
    },
    {
      label: t('settings.txPower'),
      value:
        txValue !== ''
          ? t('settings.dbm', { value: num(Number(txValue)) })
          : null,
    },
  ];

  return (
    <Card
      title={t('repeaterAdmin.config.fields.radio.label')}
      action={
        // Guests get no CLI reply, so the read/edit controls are hidden — the
        // read-only notice explains why the values can't be shown.
        readOnly ? undefined : (
          <div className='flex items-center gap-2'>
            <RebootPill />
            <RefreshButton onClick={onRefresh} busy={busy} download={!loaded} />
            <button
              onClick={onEdit}
              disabled={!ready}
              className='rounded-md border border-(--border-control) px-2.5 py-1 text-xs text-(--text2) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-(--text2)'
            >
              {t('repeaterAdmin.config.edit')}
            </button>
          </div>
        )
      }
    >
      {rows.map((row) => (
        <ValueRow
          key={row.label}
          label={row.label}
          value={row.value}
          loading={busy}
        />
      ))}
    </Card>
  );
}

/** A read-only label/value row, matching the editable rows' hairline style. */
function ValueRow({
  label,
  value,
  loading,
}: {
  label: string;
  value: string | null;
  loading: boolean;
}) {
  return (
    <div className={ROW_CLASS}>
      <span className='shrink-0 text-(--text2)'>{label}</span>
      <FieldSlot loading={loading} loaded={value != null}>
        <span className='font-semibold'>{value}</span>
      </FieldSlot>
    </div>
  );
}

/** The action verbs, with Reboot gated behind an inline confirm. */
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
            className='rounded-md border border-(--border-control) px-3 py-1.5 text-xs text-(--text) hover:bg-(--surface)'
          >
            {t(`repeaterAdmin.config.actions.${a.id}.label`)}
          </button>
        ))}
        {reboot && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className='ml-auto rounded-md border border-(--red) px-3 py-1.5 text-xs text-(--red) hover:bg-(--red-dim) hover:text-white'
          >
            {t('repeaterAdmin.config.actions.reboot.label')}
          </button>
        )}
      </div>

      {reboot && confirming && (
        <div className='mt-3 flex items-center justify-between gap-3 border-t border-(--border) pt-3'>
          <span className='text-xs text-(--text2)'>
            {t('repeaterAdmin.config.actions.reboot.confirm')}
          </span>
          <div className='flex shrink-0 gap-2'>
            <button
              onClick={() => setConfirming(false)}
              className='rounded-md px-3 py-1.5 text-xs text-(--text) hover:bg-(--surface)'
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => {
                onRun(reboot);
                setConfirming(false);
              }}
              className='rounded-md bg-(--red) px-3 py-1.5 text-xs font-semibold text-white hover:bg-(--red-hover)'
            >
              {t('repeaterAdmin.config.actions.reboot.label')}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Resolves a select option to its localized label. */
function optionLabel(
  t: ReturnType<typeof useTranslation>['t'],
  id: SelectSetting['id'],
  value: string,
): string {
  if (id === 'loopDetect') {
    return t(
      `repeaterAdmin.config.options.loopDetect.${value as (typeof LOOP_DETECT_OPTIONS)[number]}`,
    );
  }
  if (id === 'gpsAdvert') {
    return t(
      `repeaterAdmin.config.options.gpsAdvert.${value as (typeof GPS_ADVERT_OPTIONS)[number]}`,
    );
  }
  return t(
    `repeaterAdmin.config.options.pathHashMode.${value as (typeof PATH_HASH_MODE_OPTIONS)[number]}`,
  );
}
