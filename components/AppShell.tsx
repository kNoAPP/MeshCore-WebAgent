// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import dynamic from 'next/dynamic';
import { useMeshStore, isActiveStatus } from '@/store/meshStore';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useUrlState } from '@/hooks/useUrlState';
import { DesktopOnly } from './DesktopOnly';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ConnectPanel } from './ConnectPanel';
import { ChatArea } from './ChatArea';
import { RepeaterView } from './RepeaterView';
import { ReconnectingOverlay } from './ReconnectingOverlay';
import { StatsPage } from './StatsPage';
import { SettingsPage } from './SettingsPage';
import { ManagePanel } from './ManagePanel';
import { AutoAddSettings } from './AutoAddSettings';
import { AddChannelModal } from './AddChannelModal';
import { AddContactModal } from './AddContactModal';
import { CommandPalette } from './CommandPalette';
import { AutomationRunner } from './AutomationRunner';
import { MessageAnnouncer } from './MessageAnnouncer';
import { SyncAnnouncer } from './SyncProgressView';
import { Toast } from './Toast';

// Leaflet and the map view are loaded only when the map opens, keeping the
// initial bundle lean. `ssr: false` skips it during the static export, since
// Leaflet needs the browser DOM.
const MapView = dynamic(
  () => import('./MapView').then((m) => ({ default: m.MapView })),
  { ssr: false },
);

/**
 * Top-level app layout. Restricts the client to desktop browsers; otherwise
 * shows the header and toast, swaps the connect panel for the sidebar + chat
 * once connected, and mounts the management modals only while connected.
 */
export function AppShell() {
  useUrlState();
  const isDesktop = useIsDesktop();
  const status = useMeshStore((s) => s.status);
  const view = useMeshStore((s) => s.view);
  const activeConvo = useMeshStore((s) => s.activeConvo);
  const commandPaletteOpen = useMeshStore((s) => s.commandPaletteOpen);
  const modalOpen = useMeshStore((s) => s.openModals > 0);
  const connected = status === 'connected';
  const reconnecting = status === 'reconnecting';
  // A dropped link keeps the app mounted (chats stay visible) under a blocking
  // reconnect overlay, rather than dumping the user back to the connect screen.
  const active = isActiveStatus(status);

  // `null` until device detection runs on the client (the static export has no
  // navigator). Render a bare main background so neither the app nor the
  // desktop-only gate flashes before the device class is known.
  if (isDesktop === null) {
    return <main id='main' className='h-full' tabIndex={-1} />;
  }
  if (!isDesktop) {
    return (
      <main id='main' className='h-full' tabIndex={-1}>
        <DesktopOnly />
      </main>
    );
  }

  return (
    <div className='flex h-full flex-col'>
      {' '}
      {/* Everything a dialog covers. `ModalShell` portals onto `document.body`,
          so the open dialog itself is outside this subtree and stays live while
          the header and the page behind it go `inert` — which blocks the
          keyboard focus, not just the clicks the backdrop already swallows. */}
      <div className='flex min-h-0 flex-1 flex-col' inert={modalOpen}>
        <Header />
        <div className='relative flex flex-1 overflow-hidden'>
          {' '}
          {/* The reconnect overlay is modal the same way, but it renders inside
              this subtree, so only `main` beneath it goes inert. */}
          <main
            id='main'
            className='flex flex-1 overflow-hidden'
            inert={reconnecting}
            tabIndex={-1}
          >
            {active ? (
              view === 'stats' ? (
                <StatsPage />
              ) : view === 'settings' ? (
                <SettingsPage />
              ) : view === 'map' ? (
                <MapView />
              ) : (
                <>
                  <Sidebar />
                  {activeConvo?.kind === 'repeater' ? (
                    <RepeaterView />
                  ) : (
                    <ChatArea />
                  )}
                </>
              )
            ) : (
              <ConnectPanel />
            )}
          </main>{' '}
          {reconnecting && <ReconnectingOverlay />}
        </div>{' '}
      </div>{' '}
      {connected && (
        <>
          <ManagePanel />
          <AutoAddSettings />
          <AddChannelModal />
          <AddContactModal />
          {commandPaletteOpen && <CommandPalette />}
          <AutomationRunner />
        </>
      )}
      <Toast />
      <SyncAnnouncer />
      <MessageAnnouncer />
    </div>
  );
}
