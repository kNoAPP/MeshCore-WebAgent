// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import i18n from '@/lib/i18n';
import type { MeshCoreClient } from '@/lib/meshcore/client';
import { deletePendingPersona, hasPendingPersona } from '@/lib/storage';
import { selectPreferences, useMeshStore } from '@/store/meshStore';
import {
  burnerSession,
  isBurnerShaped,
  settleKeptSwitch,
  settleLandedSwitch,
} from './burner';
import { capturePersona, personaContactsApplied } from './persona';

/**
 * What the connect flow does with a freshly synced session, once any persona
 * switch it lands in has been settled.
 */
export interface ConnectIdentity {
  /**
   * The radio holds the key of a persona switch that has not finished, so the
   * session must run with persistence unbound until it is finished.
   */
  unfinishedSwitch: boolean;
  /**
   * The session is a burner's, as {@link burnerSession} reports it: nothing
   * may be stored for it.
   */
  burner: 'live' | 'assumed' | false;
}

/**
 * Settles the persona switch, if any, that a freshly synced session lands in,
 * and works out whether the session may bind persistence. Runs before the
 * connect flow derives the storage key.
 *
 * @remarks A persona switch onto this identity that never finished leaves the
 * radio's channels, which the key derives from, possibly half-written: a key
 * derived now may be neither persona's, and the hydrate would find nothing
 * and the saves overwrite the real records. So the session runs with
 * persistence off until the switch is finished, which restarts it. The
 * switch's pending record says so after a page reload too, when the store's
 * record is gone. A radio on the outgoing identity never took the key (or is
 * another radio running it, which the switch dialog warns against), so the
 * switch is over, and its pending record would only gate that identity's next
 * arrival.
 *
 * A switch's own restart (`'done'`) is where its contacts are checked: every
 * write was acknowledged, but the radio saves contacts lazily and may have
 * come back with its table from before them.
 * @param reported - the public key the session reports, lowercase hex;
 * undefined when the radio reported none.
 * @param alive - whether the session is still worth finishing; checked after
 * the one radio round-trip this may make.
 */
export async function settleIdentityOnConnect(
  client: MeshCoreClient,
  reported: string | undefined,
  alive: () => boolean,
): Promise<ConnectIdentity> {
  const store = useMeshStore.getState();
  const pending = store.personaSwitch;
  if (pending?.stage === 'switching' && reported === pending.outgoing) {
    // The vault's live flags keep what the switch recorded: the vault is
    // locked, and a stale flag only misplaces a warning (see
    // VaultIdentity.live).
    await settleKeptSwitch(pending);
    store.setPersonaSwitch(null);
    void deletePendingPersona(pending.target);
    store.notify({
      level: 'warning',
      text: i18n.t('notify.personaSwitchNotLanded', { name: pending.label }),
      key: 'personaSwitchNotLanded',
    });
  }
  // The radio holds the switch's key, whichever stage it reached: a burner it
  // put on is the live one now, and one it took off is over.
  if (pending && reported === pending.target) {
    await settleLandedSwitch(pending);
  }
  let unfinishedSwitch =
    pending?.stage === 'switching' && reported === pending.target;
  if (pending?.stage === 'done' && reported === pending.target) {
    // A table the connect sync could not read gets one more try.
    if (!client.contactsSynced) await client.resyncContacts().catch(() => {});
    if (!alive()) {
      // Dropped during that try: nothing was learned, so the record is left
      // 'done' for the next session to check.
    } else if (
      pending.state &&
      !personaContactsApplied(client, pending.state, pending.removed)
    ) {
      unfinishedSwitch = true;
      store.setPersonaSwitch({
        ...pending,
        stage: 'switching',
        running: false,
        dismissed: false,
      });
      store.notify({
        level: 'warning',
        text: i18n.t('notify.personaSwitchNotSaved'),
        key: 'personaSwitchNotSaved',
      });
    } else {
      // A burner's switch wrote no pending record to delete.
      if (!pending.burner) void deletePendingPersona(reported);
      // Only now that the radio is known to hold the persona. The switch is
      // complete either way; a failed advert only means peers learn it at the
      // next one.
      if (pending.announce) void client.sendSelfAdvert(true).catch(() => {});
    }
  } else if (
    reported &&
    !unfinishedSwitch &&
    (await hasPendingPersona(reported))
  ) {
    unfinishedSwitch = true;
    store.setPersonaSwitch({
      target: reported,
      outgoing: '',
      label: '',
      state: null,
      removed: [],
      // What the user chose was not recorded, and an unwanted advert links
      // the personas while a missed one only delays peers.
      announce: false,
      stage: 'switching',
      running: false,
      dismissed: false,
      // A burner's switch writes no pending record to rebuild from.
      burner: false,
    });
  }
  // A burner's session saves nothing, so it binds no storage key and no
  // secrets context: every write the connect flow makes is then a no-op.
  const burner =
    reported && !unfinishedSwitch ? await burnerSession(reported) : false;
  return { unfinishedSwitch, burner };
}

/**
 * Finishes connecting a burner's session once it reports connected: marks its
 * preferences hydrated from memory, completes the switch that put it on, and
 * offers to finish an assumed burner that still carries another persona.
 *
 * @remarks An assumed burner cut off by a reload before its persona was
 * applied may still carry the previous persona's name, channels and contacts,
 * so finishing it is offered — but only from Settings, beside keeping the
 * radio's data: an identity assumed to be the burner may be a radio new here,
 * and finishing would wipe it.
 * @param reported - the burner's public key, lowercase hex.
 * @param burner - how {@link settleIdentityOnConnect} classified the session.
 */
export function hydrateBurnerSession(
  client: MeshCoreClient,
  reported: string,
  burner: 'live' | 'assumed',
): void {
  const store = useMeshStore.getState();
  // Hydrated from memory: what this session set is all there is.
  store.restorePreferences(selectPreferences(store), true);
  if (
    store.personaSwitch?.stage === 'done' &&
    store.personaSwitch.target === reported
  ) {
    store.setPersonaSwitch(null);
    store.notify({
      level: 'info',
      text: i18n.t('notify.burnerLive'),
      key: 'burnerLive',
    });
  }
  if (burner === 'assumed' && !isBurnerShaped(capturePersona(client))) {
    store.setPersonaSwitch({
      target: reported,
      outgoing: '',
      label: i18n.t('settings.persona.burner.live'),
      state: null,
      removed: [],
      announce: false,
      stage: 'switching',
      running: false,
      dismissed: true,
      burner: true,
    });
  }
  if (burner === 'assumed') {
    store.notify({
      level: 'warning',
      text: i18n.t('notify.burnerAssumed'),
      key: 'burnerAssumed',
    });
  }
}
