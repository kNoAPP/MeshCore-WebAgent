// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useState } from 'react';
import { useMeshStore, type PersonaSwitch } from '@/store/meshStore';
import { applyPersona, type PersonaState } from '@/lib/identity/persona';
import {
  installPersonaKey,
  preparePersonaSwitch,
  recordLive,
  verifyPersonaKey,
} from '@/lib/identity/personaSwitch';
import type { Vault, VaultIdentity } from '@/lib/identity/vault';
import { beginIdentitySwitch } from '@/lib/session/persistence';
import { deletePendingPersona } from '@/lib/storage';
import { useMeshCore } from './useMeshCore';

/** Where a persona switch run has got to, for its progress display. */
export type SwitchProgress =
  | { stage: 'saving' | 'importing' | 'syncing' | 'announcing' }
  | { stage: 'applying'; done: number; total: number };

/**
 * How a {@link usePersonaSwitch} `start` ended short of switching: `'kept'`
 * means the radio still holds the outgoing identity, so nothing changed;
 * `'unknown'` means the link failed before the radio could say, and the next
 * session will tell.
 */
export type SwitchOutcome = 'switched' | 'kept' | 'unknown';

/**
 * Runs persona switches, and finishes one a previous run left unfinished.
 *
 * @remarks Every step that can leave the radio part one persona, part another
 * is recorded first — in the store's `personaSwitch`, and durably as the
 * switch's pending record — so a cancel, a failure, a dropped link or a
 * reload is offered for finishing rather than lost.
 *
 * The session leaves the outgoing identity, and the store is cleared of its
 * data, before the key is written, so nothing the new key receives can be
 * filed under the old one and nothing of the old one can be merged into the
 * new. Any outcome that leaves the radio on the outgoing identity restarts the
 * session, which hydrates it again from what was just flushed. A finished
 * switch restarts it too, onto the incoming identity.
 *
 * @returns `start` and `finish`, and the run's `progress`, null when idle.
 */
export function usePersonaSwitch(): {
  start: (
    vault: Vault,
    phrase: string,
    target: VaultIdentity,
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
      const running = { ...record, state, running: true, dismissed: false };
      store.setPersonaSwitch(running);
      try {
        await applyPersona(client, state, {
          signal,
          onProgress: (done, total) =>
            setProgress({ stage: 'applying', done, total }),
        });
        if (record.announce) {
          setProgress({ stage: 'announcing' });
          // The persona is in place either way; an advert that fails only
          // means peers learn it at the next one.
          await client.sendSelfAdvert(true).catch(() => {});
        }
      } catch (err) {
        store.setPersonaSwitch({ ...running, running: false });
        throw err;
      } finally {
        setProgress(null);
      }
      await deletePendingPersona(record.target);
      store.setPersonaSwitch({ ...running, stage: 'done', running: false });
      restartSession();
    },
    [restartSession],
  );

  const start = useCallback(
    async (
      vault: Vault,
      phrase: string,
      target: VaultIdentity,
      announce: boolean,
      signal: AbortSignal,
    ): Promise<SwitchOutcome> => {
      const store = useMeshStore.getState();
      const client = store.client;
      const outgoing = store.selfInfo?.pubkey?.toLowerCase();
      if (!client || !outgoing) throw new Error('Not connected');
      const pending = store.personaSwitch;
      // The radio is still mid-switch onto this identity: its state is a mix,
      // and the record already saved for it is the one to keep.
      const mixed =
        pending?.stage === 'switching' && pending.target === outgoing;
      // What the store goes back to when this run changes nothing.
      const untouched =
        mixed && pending ? { ...pending, running: false } : null;

      setProgress({ stage: 'saving' });
      let state: PersonaState;
      try {
        await verifyPersonaKey(phrase, target);
        state = await preparePersonaSwitch(client, vault, target, !mixed);
      } catch (err) {
        setProgress(null);
        throw err;
      }
      if (signal.aborted) {
        await deletePendingPersona(target.publicKey);
        setProgress(null);
        signal.throwIfAborted();
      }

      const record: PersonaSwitch = {
        target: target.publicKey,
        outgoing,
        label: target.label,
        state,
        announce,
        stage: 'switching',
        running: true,
        dismissed: false,
      };
      store.setPersonaSwitch(record);
      // Before the key is written, so every way the switch can end — resumed
      // after a drop or a reload included — inherits it; only an outcome that
      // leaves the radio on the outgoing identity puts it back.
      const undoLive = await recordLive(vault, target.publicKey, outgoing);
      setProgress({ stage: 'importing' });
      await beginIdentitySwitch(client, target.publicKey);
      store.resetIdentityData();

      let landed: boolean | null;
      try {
        landed = await installPersonaKey(client, phrase, target);
      } catch (err) {
        // A refusal: the radio kept the outgoing identity.
        await deletePendingPersona(target.publicKey);
        await undoLive();
        store.setPersonaSwitch(untouched);
        setProgress(null);
        restartSession();
        throw err;
      }
      if (landed !== true) {
        if (landed === false) {
          await deletePendingPersona(target.publicKey);
          await undoLive();
          store.setPersonaSwitch(untouched);
        } else {
          // The next session decides; see PersonaSwitch.
          store.setPersonaSwitch({ ...record, running: false });
        }
        setProgress(null);
        restartSession();
        return landed === false ? 'kept' : 'unknown';
      }

      // The identity the radio was mid-switch onto is gone from it again, and
      // its good persona record was never overwritten.
      if (untouched) await deletePendingPersona(untouched.target);
      setProgress({ stage: 'syncing' });
      await client.resyncContacts();
      await apply(record, state, signal);
      return 'switched';
    },
    [apply, restartSession],
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

  return { start, finish, progress };
}
