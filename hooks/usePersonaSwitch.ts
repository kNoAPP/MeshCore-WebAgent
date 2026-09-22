// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useState } from 'react';
import { useMeshStore, type PersonaSwitch } from '@/store/meshStore';
import { applyPersona } from '@/lib/identity/persona';
import {
  installPersonaKey,
  preparePersonaSwitch,
} from '@/lib/identity/personaSwitch';
import type { Vault, VaultIdentity } from '@/lib/identity/vault';
import { useMeshCore } from './useMeshCore';

/** Where a persona switch run has got to, for its progress display. */
export type SwitchProgress =
  | { stage: 'saving' | 'importing' | 'announcing' }
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
 * is recorded in the store's `personaSwitch` first, so a cancel, a failure or
 * a dropped link is offered for finishing rather than lost. A finished switch
 * restarts the session, which hydrates the incoming identity's data.
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
  finish: (signal: AbortSignal) => Promise<void>;
  progress: SwitchProgress | null;
} {
  const { restartSession } = useMeshCore();
  const [progress, setProgress] = useState<SwitchProgress | null>(null);

  const apply = useCallback(
    async (record: PersonaSwitch, signal: AbortSignal) => {
      const store = useMeshStore.getState();
      const client = store.client;
      if (!client) throw new Error('Not connected');
      store.setPersonaSwitch({ ...record, running: true, dismissed: false });
      try {
        await applyPersona(client, record.state, {
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
        store.setPersonaSwitch({ ...record, running: false, dismissed: false });
        throw err;
      } finally {
        setProgress(null);
      }
      store.setPersonaSwitch({ ...record, stage: 'done', running: false });
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
      let state;
      try {
        state = await preparePersonaSwitch(client, vault, target, !mixed);
        signal.throwIfAborted();
      } catch (err) {
        setProgress(null);
        throw err;
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
      setProgress({ stage: 'importing' });
      let landed: boolean | null;
      try {
        landed = await installPersonaKey(client, phrase, target);
      } catch (err) {
        store.setPersonaSwitch(untouched);
        setProgress(null);
        throw err;
      }
      if (landed !== true) {
        // The next session decides an unknown outcome; see PersonaSwitch.
        if (landed === false) {
          store.setPersonaSwitch(untouched);
        } else {
          store.setPersonaSwitch({ ...record, running: false });
          // A link that is merely slow would otherwise carry on as a session
          // bound to the outgoing identity, whichever the radio now holds.
          restartSession();
        }
        setProgress(null);
        return landed === false ? 'kept' : 'unknown';
      }
      // From here the store must hold nothing of the outgoing persona: the
      // restart merges into it, and messages the new key receives meanwhile
      // are the incoming persona's to keep.
      store.resetIdentityData();
      await apply(record, signal);
      return 'switched';
    },
    [apply, restartSession],
  );

  const finish = useCallback(
    async (signal: AbortSignal) => {
      const record = useMeshStore.getState().personaSwitch;
      if (!record || record.stage !== 'switching') return;
      await apply(record, signal);
    },
    [apply],
  );

  return { start, finish, progress };
}
