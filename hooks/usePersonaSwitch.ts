// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useState } from 'react';
import { useMeshStore, type PersonaSwitch } from '@/store/meshStore';
import {
  generateBurnerKey,
  settleKeptSwitch,
  settleLandedSwitch,
} from '@/lib/identity/burner';
import {
  applyPersona,
  personaRemovals,
  type PersonaState,
} from '@/lib/identity/persona';
import {
  freshPersona,
  installKey,
  installPersonaKey,
  keepOutgoingPersona,
  PersonaSwitchError,
  preparePersonaSwitch,
  recordLive,
  verifyPersonaKey,
} from '@/lib/identity/personaSwitch';
import type { SeedIdentity } from '@/lib/identity/seed';
import type { Vault, VaultIdentity } from '@/lib/identity/vault';
import type { MeshCoreClient } from '@/lib/meshcore/client';
import { beginIdentitySwitch } from '@/lib/session/persistence';
import {
  deleteBurnerGuard,
  deletePendingPersona,
  saveBurnerGuard,
} from '@/lib/storage';
import { toHex } from '@/lib/utils';
import { useMeshCore } from './useMeshCore';

/** Where a persona switch run has got to, for its progress display. */
export type SwitchProgress =
  | { stage: 'saving' | 'importing' | 'syncing' | 'restarting' }
  | { stage: 'applying'; done: number; total: number };

/**
 * How a {@link usePersonaSwitch} `start` ended short of switching: `'kept'`
 * means the radio still holds the outgoing identity, so nothing changed;
 * `'unknown'` means the link failed before the radio could say, and the next
 * session will tell.
 */
export type SwitchOutcome = 'switched' | 'kept' | 'unknown';

// What a new switch starts from: the session, the identity the radio holds,
// and whether that is a burner or a switch that never finished.
function current(): {
  client: MeshCoreClient;
  outgoing: string;
  fromBurner: boolean;
  mixed: boolean;
  untouched: PersonaSwitch | null;
} {
  const store = useMeshStore.getState();
  const client = store.client;
  const outgoing = store.selfInfo?.pubkey?.toLowerCase();
  if (!client || !outgoing) throw new Error('Not connected');
  const pending = store.personaSwitch;
  // The radio is still mid-switch onto this identity: its state is a mix,
  // and the record already saved for it is the one to keep.
  const mixed = pending?.stage === 'switching' && pending.target === outgoing;
  return {
    client,
    outgoing,
    // A burner is never kept, so there is nothing to capture from it.
    fromBurner: store.burner?.pubkey === outgoing,
    mixed,
    // What the store goes back to when the run changes nothing.
    untouched: mixed && pending ? { ...pending, running: false } : null,
  };
}

/**
 * Runs persona switches, onto a persona of the vault or onto a new burner,
 * and finishes one a previous run left unfinished.
 *
 * @remarks Every step that can leave the radio part one persona, part another
 * is recorded first — in the store's `personaSwitch`, and, for a persona of
 * the vault, durably as the switch's pending record — so a cancel, a failure,
 * a dropped link or a reload is offered for finishing rather than lost. A
 * burner writes no pending record; its guard keeps a reload from saving
 * anything for it instead (see `lib/identity/burner.ts`).
 *
 * The session leaves the outgoing identity, and the store is cleared of its
 * data, before the key is written, so nothing the new key receives can be
 * filed under the old one and nothing of the old one can be merged into the
 * new. Any outcome that leaves the radio on the outgoing identity restarts the
 * session, which hydrates it again from what was just flushed. A finished
 * switch reboots the radio and restarts the session onto the incoming
 * identity, which checks the radio kept the persona before announcing it.
 *
 * @returns `start`, `startBurner` and `finish`, and the run's `progress`,
 * null when idle.
 */
export function usePersonaSwitch(): {
  start: (
    vault: Vault,
    phrase: string,
    target: VaultIdentity,
    announce: boolean,
    signal: AbortSignal,
  ) => Promise<SwitchOutcome>;
  startBurner: (
    vault: Vault,
    name: string,
    announce: boolean,
    signal: AbortSignal,
  ) => Promise<SwitchOutcome>;
  finish: (signal: AbortSignal, state?: PersonaState) => Promise<void>;
  progress: SwitchProgress | null;
} {
  const { restartSession } = useMeshCore();
  const [progress, setProgress] = useState<SwitchProgress | null>(null);

  const apply = useCallback(
    async (record: PersonaSwitch, state: PersonaState, signal: AbortSignal) => {
      const store = useMeshStore.getState();
      const client = store.client;
      if (!client) throw new Error('Not connected');
      const running = {
        ...record,
        state,
        removed: personaRemovals(client, state),
        running: true,
        dismissed: false,
      };
      store.setPersonaSwitch(running);
      try {
        await applyPersona(client, state, {
          signal,
          onProgress: (done, total) =>
            setProgress({ stage: 'applying', done, total }),
        });
        setProgress({ stage: 'restarting' });
        // The radio keeps contact writes in RAM until a lazy save seconds
        // later, and a restart inside that window — reopening a native USB
        // port is one — reloads the table from before them. REBOOT saves
        // pending contacts first, and finishes the key import besides.
        await client.reboot();
      } catch (err) {
        store.setPersonaSwitch({ ...running, running: false });
        throw err;
      } finally {
        setProgress(null);
      }
      // The pending record stays until the restarted session confirms the
      // contacts; see PersonaSwitch.
      store.setPersonaSwitch({ ...running, stage: 'done', running: false });
      restartSession();
    },
    [restartSession],
  );

  // Everything from the point the switch is recorded: the session leaves the
  // outgoing identity, the key goes on, and the persona is applied.
  const runSwitch = useCallback(
    async (
      vault: Vault,
      record: PersonaSwitch & { state: PersonaState },
      untouched: PersonaSwitch | null,
      install: () => Promise<boolean | null>,
      discard: () => Promise<unknown>,
      signal: AbortSignal,
    ): Promise<SwitchOutcome> => {
      const store = useMeshStore.getState();
      const client = store.client;
      if (!client) throw new Error('Not connected');
      store.setPersonaSwitch(record);
      // Before the key is written, so every way the switch can end — resumed
      // after a drop or a reload included — inherits it; only an outcome that
      // leaves the radio on the outgoing identity puts it back.
      const undoLive = await recordLive(vault, record.target, record.outgoing);
      // Undoes what was recorded, for an outcome that leaves the radio on the
      // outgoing identity.
      const keep = async () => {
        await discard();
        await undoLive();
        await settleKeptSwitch(record);
        store.setPersonaSwitch(untouched);
      };
      setProgress({ stage: 'importing' });
      await beginIdentitySwitch(client, record.burner ? null : record.target);

      let landed: boolean | null;
      try {
        landed = await install();
      } catch (err) {
        // A refusal: the radio kept the outgoing identity.
        await keep();
        setProgress(null);
        restartSession();
        throw err;
      }
      if (landed !== true) {
        if (landed === false) {
          await keep();
        } else {
          // The next session decides; see PersonaSwitch.
          store.setPersonaSwitch({ ...record, running: false });
        }
        setProgress(null);
        restartSession();
        return landed === false ? 'kept' : 'unknown';
      }

      await settleLandedSwitch(record);
      // The identity the radio was mid-switch onto is gone from it again, and
      // its good persona record was never overwritten.
      if (untouched) await deletePendingPersona(untouched.target);
      setProgress({ stage: 'syncing' });
      await client.resyncContacts();
      await apply(record, record.state, signal);
      return 'switched';
    },
    [apply, restartSession],
  );

  const start = useCallback(
    async (
      vault: Vault,
      phrase: string,
      target: VaultIdentity,
      announce: boolean,
      signal: AbortSignal,
    ): Promise<SwitchOutcome> => {
      const { client, outgoing, fromBurner, mixed, untouched } = current();

      setProgress({ stage: 'saving' });
      let state: PersonaState;
      try {
        await verifyPersonaKey(phrase, target);
        state = await preparePersonaSwitch(
          client,
          vault,
          target,
          !mixed && !fromBurner,
        );
      } catch (err) {
        setProgress(null);
        throw err;
      }
      if (signal.aborted) {
        await deletePendingPersona(target.publicKey);
        setProgress(null);
        signal.throwIfAborted();
      }

      return runSwitch(
        vault,
        {
          target: target.publicKey,
          outgoing,
          label: target.label,
          state,
          removed: [],
          announce,
          stage: 'switching',
          running: true,
          dismissed: false,
          burner: false,
        },
        untouched,
        () => installPersonaKey(client, phrase, target),
        () => deletePendingPersona(target.publicKey),
        signal,
      );
    },
    [runSwitch],
  );

  const startBurner = useCallback(
    async (
      vault: Vault,
      name: string,
      announce: boolean,
      signal: AbortSignal,
    ): Promise<SwitchOutcome> => {
      const { client, outgoing, fromBurner, mixed, untouched } = current();

      setProgress({ stage: 'saving' });
      let key: SeedIdentity;
      try {
        if (!mixed && !fromBurner) await keepOutgoingPersona(client, vault);
        key = await generateBurnerKey();
      } catch (err) {
        setProgress(null);
        throw err;
      }
      // Written before the key goes on, so a reload from then on still saves
      // nothing for it. A burner already live has one.
      const guarded = !!useMeshStore.getState().burner;
      if (signal.aborted || !(await saveBurnerGuard())) {
        key.privateKey.fill(0);
        if (!guarded) await deleteBurnerGuard();
        setProgress(null);
        signal.throwIfAborted();
        throw new PersonaSwitchError('saveFailed');
      }

      const target = toHex(key.publicKey);
      return runSwitch(
        vault,
        {
          target,
          outgoing,
          label: name,
          state: freshPersona(name),
          removed: [],
          announce,
          stage: 'switching',
          running: true,
          dismissed: false,
          burner: true,
        },
        untouched,
        () => installKey(client, key.privateKey, target),
        async () => {},
        signal,
      );
    },
    [runSwitch],
  );

  const finish = useCallback(
    async (signal: AbortSignal, state?: PersonaState) => {
      const record = useMeshStore.getState().personaSwitch;
      if (!record || record.stage !== 'switching') return;
      const toApply = state ?? record.state;
      if (!toApply) throw new Error('Persona state is still sealed');
      await apply(record, toApply, signal);
    },
    [apply],
  );

  return { start, startBurner, finish, progress };
}
