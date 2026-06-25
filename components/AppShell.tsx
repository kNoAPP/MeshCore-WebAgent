// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useMeshStore, isActiveStatus } from '@/store/meshStore';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { DesktopOnly } from './DesktopOnly';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ConnectPanel } from './ConnectPanel';
import { ChatArea } from './ChatArea';
import { ReconnectingOverlay } from './ReconnectingOverlay';
import { StatsModal } from './StatsModal';
import { ManagePanel } from './ManagePanel';
import { DiscoverPanel } from './DiscoverPanel';
import { AutoAddSettings } from './AutoAddSettings';
import { AddChannelModal } from './AddChannelModal';
import { Toast } from './Toast';

/**
 * Top-level app layout. Restricts the client to desktop browsers; otherwise
 * shows the header and toast, swaps the connect panel for the sidebar + chat
 * once connected, and mounts the management modals only while connected.
 */
export function AppShell() {
  const isDesktop = useIsDesktop();
  const status = useMeshStore((s) => s.status);
  const connected = status === 'connected';
  const reconnecting = status === 'reconnecting';
  // A dropped link keeps the app mounted (chats stay visible) under a blocking
  // reconnect overlay, rather than dumping the user back to the connect screen.
  const active = isActiveStatus(status);

  // `null` until device detection runs on the client (the static export has no
  // navigator). Render a bare background so neither the app nor the
  // desktop-only gate flashes before the device class is known.
  if (isDesktop === null) return <div className='h-full' />;
  if (!isDesktop) return <DesktopOnly />;

  return (
    <div className='flex h-full flex-col'>
      {' '}
      <Header />
      <div className='relative flex flex-1 overflow-hidden'>
        {' '}
        {/* `inert` makes the reconnect overlay truly modal: it not only captures
            clicks but also blocks the keyboard focus/typing that would
            otherwise reach the still-mounted composer underneath it. */}
        <div className='flex flex-1 overflow-hidden' inert={reconnecting}>
          {active && <Sidebar />}
          {active ? <ChatArea /> : <ConnectPanel />}
        </div>{' '}
        {reconnecting && <ReconnectingOverlay />}
      </div>{' '}
      {connected && (
        <>
          <StatsModal />
          <ManagePanel />
          <DiscoverPanel />
          <AutoAddSettings />
          <AddChannelModal />
        </>
      )}
      <Toast />
    </div>
  );
}
