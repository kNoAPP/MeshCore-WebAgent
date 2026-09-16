// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback } from 'react';
import { useMeshStore, isAuthedLogin } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useAdvertise } from '@/hooks/useAdvertise';
import { clearRepeaterCred } from '@/lib/meshcore/adminCreds';
import { NO_PATH } from '@/lib/meshcore/constants';
import type { PaletteAction } from '@/lib/search/commandSearch';

/**
 * Resolves a {@link PaletteAction} to the store action or `useMeshCore`
 * function the rest of the app already uses for that verb, so the command
 * palette is a second entry point and never a second implementation.
 *
 * Results are indexed from a snapshot, so every precondition the index checked
 * is checked again here: a verb whose target has changed under an open palette
 * — a removed contact, a route that has since been cleared, an admin session
 * that has ended — is a no-op rather than a command the owning UI would no
 * longer offer.
 */
export function usePaletteActions(): (action: PaletteAction) => void {
  const { advertise, sending } = useAdvertise();
  const {
    disconnect,
    rebootDevice,
    resetContactPath,
    toggleFavorite,
    repeaterStatus,
  } = useMeshCore();
  const contacts = useMeshStore((s) => s.contacts);
  const adminSessions = useMeshStore((s) => s.adminSessions);
  const theme = useMeshStore((s) => s.theme);
  const setTheme = useMeshStore((s) => s.setTheme);
  const setLocale = useMeshStore((s) => s.setLocale);
  const setUnitSystem = useMeshStore((s) => s.setUnitSystem);
  const markAllRead = useMeshStore((s) => s.markAllRead);
  const setAddContactOpen = useMeshStore((s) => s.setAddContactOpen);
  const setAddChannelOpen = useMeshStore((s) => s.setAddChannelOpen);
  const setManagePanel = useMeshStore((s) => s.setManagePanel);
  const resetAdminSession = useMeshStore((s) => s.resetAdminSession);

  return useCallback(
    (action: PaletteAction): void => {
      switch (action.kind) {
        case 'advertise':
          // Backstop for the window between indexing and activation: the rows
          // are already filtered out while `advertising` is set, and the
          // header's menu is disabled, so nothing may queue a second broadcast
          // over one still in flight.
          if (!sending) void advertise(action.flood);
          return;
        case 'disconnect':
          disconnect();
          return;
        case 'reboot':
          void rebootDevice();
          return;
        case 'toggleTheme':
          setTheme(theme === 'dark' ? 'light' : 'dark');
          return;
        case 'setLocale':
          setLocale(action.locale);
          return;
        case 'setUnitSystem':
          setUnitSystem(action.unitSystem);
          return;
        case 'markAllRead':
          markAllRead();
          return;
        case 'addContact':
          setAddContactOpen(true);
          return;
        case 'addChannel':
          setAddChannelOpen(true);
          return;
        case 'repeaterStatus': {
          const contact = contacts[action.prefix];
          if (!contact) return;
          // A status read needs the admin session the index saw; it may have
          // ended (logged out, session reset) since.
          if (!isAuthedLogin(adminSessions[action.prefix]?.login)) return;
          void repeaterStatus(contact);
          return;
        }
        case 'repeaterLogOut':
          resetAdminSession(action.prefix);
          void clearRepeaterCred(action.prefix);
          return;
        case 'contactResetRoute': {
          const contact = contacts[action.prefix];
          // The route may have been cleared since the row was indexed, which is
          // when the owning UI stops offering the verb.
          if (!contact || contact.outPathLen === NO_PATH) return;
          void resetContactPath(contact);
          return;
        }
        case 'contactFavorite': {
          const contact = contacts[action.prefix];
          if (contact) void toggleFavorite(contact);
          return;
        }
        case 'contactShare': {
          const contact = contacts[action.prefix];
          if (contact) {
            setManagePanel({ kind: 'contact', id: action.prefix, share: true });
          }
          return;
        }
      }
    },
    [
      advertise,
      sending,
      disconnect,
      rebootDevice,
      resetContactPath,
      toggleFavorite,
      repeaterStatus,
      contacts,
      adminSessions,
      theme,
      setTheme,
      setLocale,
      setUnitSystem,
      markAllRead,
      setAddContactOpen,
      setAddChannelOpen,
      setManagePanel,
      resetAdminSession,
    ],
  );
}
