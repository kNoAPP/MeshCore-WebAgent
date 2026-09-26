// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useCallback } from 'react';
import { useMeshStore, isAuthedLogin } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useAdvertise } from '@/hooks/useAdvertise';
import { clearRepeaterCred } from '@/lib/meshcore/adminCreds';
import { installApp } from '@/lib/pwa/install';
import { FAVORITE_FLAG, NO_PATH } from '@/lib/meshcore/constants';
import type { PaletteAction } from '@/lib/search/commandSearch';

/**
 * Resolves a {@link PaletteAction} to the store action or `useMeshCore`
 * function the rest of the app already uses for that verb, so the command
 * palette is a second entry point and never a second implementation.
 *
 * Every precondition the index checked is checked again here, against the store
 * as it stands at dispatch rather than the render the row was built from: an
 * action can be activated long after it was indexed, and one that opens a
 * dialog runs later still. A verb whose target has moved on — a removed
 * contact, a route already cleared, an admin session that has ended, a favorite
 * flag the radio flipped — is a no-op rather than a command the owning UI would
 * no longer offer.
 */
export function usePaletteActions(): (action: PaletteAction) => void {
  const { advertise } = useAdvertise();
  const {
    disconnect,
    rebootDevice,
    resetContactPath,
    toggleFavorite,
    repeaterStatus,
  } = useMeshCore();

  return useCallback(
    (action: PaletteAction): void => {
      const state = useMeshStore.getState();
      const contact = 'prefix' in action ? state.contacts[action.prefix] : null;
      switch (action.kind) {
        case 'advertise':
          // Backstop for the window between indexing and activation: the rows
          // are already filtered out while `advertising` is set, and the
          // header's menu is disabled, so nothing may queue a second broadcast
          // over one still in flight.
          if (!state.advertising) void advertise(action.flood);
          return;
        case 'disconnect':
          disconnect();
          return;
        case 'reboot':
          void rebootDevice();
          return;
        case 'toggleTheme':
          state.setTheme(state.theme === 'dark' ? 'light' : 'dark');
          return;
        case 'installApp':
          // The install actions are hidden once the app is installed.
          if (!state.appInstalled) void installApp();
          return;
        case 'setLocale':
          state.setLocale(action.locale);
          return;
        case 'setUnitSystem':
          state.setUnitSystem(action.unitSystem);
          return;
        case 'markAllRead':
          state.markAllRead();
          return;
        case 'addNode':
          state.setAddNodeOpen(true);
          return;
        case 'addChannel':
          state.setAddChannelOpen(true);
          return;
        case 'repeaterStatus':
          // A status read needs the admin session the index saw; it may have
          // ended (logged out, session reset) since. A read already running for
          // this repeater is joined rather than queued behind.
          if (!contact) return;
          if (!isAuthedLogin(state.adminSessions[action.prefix]?.login)) return;
          void repeaterStatus(contact);
          return;
        case 'repeaterLogOut':
          // Only end the session the row was offered for: a re-login since
          // then is a different one, and dropping its credentials would be a
          // logout the user never asked for.
          if (!contact) return;
          if (!isAuthedLogin(state.adminSessions[action.prefix]?.login)) return;
          state.resetAdminSession(action.prefix);
          void clearRepeaterCred(action.prefix);
          return;
        case 'contactResetRoute':
          // The route may have been cleared since the row was indexed, which is
          // when the owning UI stops offering the verb.
          if (!contact || contact.outPathLen === NO_PATH) return;
          void resetContactPath(contact);
          return;
        case 'contactFavorite':
          if (!contact) return;
          // Already in the state the row promised — something else set it since
          // it was indexed, and toggling now would do the opposite.
          if (((contact.flags & FAVORITE_FLAG) !== 0) === action.favorite) {
            return;
          }
          void toggleFavorite(contact);
          return;
        case 'contactShare':
          if (!contact) return;
          state.setManagePanel({
            kind: 'contact',
            id: action.prefix,
            share: true,
          });
          return;
      }
    },
    [
      advertise,
      disconnect,
      rebootDevice,
      resetContactPath,
      toggleFavorite,
      repeaterStatus,
    ],
  );
}
