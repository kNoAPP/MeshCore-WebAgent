// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useMeshStore } from '@/store/meshStore';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ConnectPanel } from './ConnectPanel';
import { ChatArea } from './ChatArea';
import { StatsModal } from './StatsModal';
import { ManagePanel } from './ManagePanel';
import { DiscoverPanel } from './DiscoverPanel';
import { AutoAddSettings } from './AutoAddSettings';
import { AddChannelModal } from './AddChannelModal';
import { Toast } from './Toast';

/**
 * Top-level app layout. Always shows the header and toast; swaps the connect
 * panel for the sidebar + chat once connected, and mounts the management modals
 * only while connected.
 */
export function AppShell() {
  const status = useMeshStore((s) => s.status);
  const connected = status === 'connected';

  return (
    <div className='flex h-full flex-col'>
      {' '}
      <Header />
      <div className='flex flex-1 overflow-hidden'>
        {' '}
        {connected && <Sidebar />}
        {connected ? <ChatArea /> : <ConnectPanel />}{' '}
      </div>{' '}
      <StatsModal />
      {connected && (
        <>
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
