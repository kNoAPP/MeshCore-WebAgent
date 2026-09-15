// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback } from 'react';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { useAdvertise } from '@/hooks/useAdvertise';
import { clearRepeaterCred } from '@/lib/meshcore/adminCreds';
import type { PaletteAction } from '@/lib/search/commandSearch';

/**
 * Resolves a {@link PaletteAction} to the store action or `useMeshCore`
 * function the rest of the app already uses for that verb, so the command
 * palette is a second entry point and never a second implementation.
 *
 * @returns a runner that performs the action; a contact-scoped verb whose
 * contact has since left the radio's table is a no-op.
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
  const contacts = useMeshStore((s) => s.contacts);
  const theme = useMeshStore((s) => s.theme);
  const setTheme = useMeshStore((s) => s.setTheme);
  const setLocale = useMeshStore((s) => s.setLocale);
  const setUnitSystem = useMeshStore((s) => s.setUnitSystem);
  const markAllRead = useMeshStore((s) => s.markAllRead);
  const setAddContactOpen = useMeshStore((s) => s.setAddContactOpen);
  const setAddChannelOpen = useMeshStore((s) => s.setAddChannelOpen);
  const setManagePanel = useMeshStore((s) => s.setManagePanel);
  const setView = useMeshStore((s) => s.setView);
  const resetAdminSession = useMeshStore((s) => s.resetAdminSession);

  return useCallback(
    (action: PaletteAction): void => {
      switch (action.kind) {
        case 'advertise':
          void advertise(action.flood);
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
          if (contact) void repeaterStatus(contact);
          return;
        }
        case 'repeaterLogOut':
          resetAdminSession(action.prefix);
          void clearRepeaterCred(action.prefix);
          return;
        case 'contactResetRoute': {
          const contact = contacts[action.prefix];
          if (contact) void resetContactPath(contact);
          return;
        }
        case 'contactFavorite': {
          const contact = contacts[action.prefix];
          if (contact) void toggleFavorite(contact);
          return;
        }
        case 'contactShare':
          setManagePanel({ kind: 'contact', id: action.prefix, share: true });
          return;
        case 'contactMap':
          // Same destination a marker click reaches: the map, with that node's
          // detail popup open over it.
          setView('map');
          setManagePanel({ kind: 'contact', id: action.prefix });
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
      contacts,
      theme,
      setTheme,
      setLocale,
      setUnitSystem,
      markAllRead,
      setAddContactOpen,
      setAddChannelOpen,
      setManagePanel,
      setView,
      resetAdminSession,
    ],
  );
}
