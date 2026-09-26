// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore, isAuthedLogin, roomConvoId } from '@/store/meshStore';
import { useRepeaterAutoLogin } from '@/hooks/useRepeaterAutoLogin';
import { clearRepeaterCred } from '@/lib/meshcore/adminCreds';
import { ChatArea } from './ChatArea';
import { NodeHeader } from './NodeHeader';
import { RepeaterLoginGate } from './RepeaterLoginGate';
import type { Contact } from '@/types/meshcore';

/**
 * A room server's post feed, shown in place of the chat pane when a room is
 * selected in the sidebar (or the command palette). Only the conversation
 * lives here: the room's status, config and other admin surfaces are on the
 * Nodes page. Resolves the room from the active conversation; renders a notice
 * if it has been evicted.
 */
export function RoomView() {
  const { t } = useTranslation();
  const activeConvo = useMeshStore((s) => s.activeConvo);
  const contacts = useMeshStore((s) => s.contacts);
  const prefix =
    activeConvo?.kind === 'room' ? (activeConvo.rawId as string) : undefined;
  const contact = prefix ? contacts[prefix] : undefined;

  if (!contact) {
    return (
      <div className='flex flex-1 items-center justify-center text-sm text-text2'>
        {t('repeaterAdmin.contactUnavailable')}
      </div>
    );
  }

  // Key by prefix so the auto-login guard resets when the user switches to a
  // different room.
  return <RoomViewInner key={contact.pubkeyPrefix} contact={contact} />;
}

function RoomViewInner({ contact }: { contact: Contact }) {
  const autoLogin = useRepeaterAutoLogin(contact);
  const login = useMeshStore(
    (s) => s.adminSessions[contact.pubkeyPrefix]?.login ?? 'loggedOut',
  );
  const resetAdminSession = useMeshStore((s) => s.resetAdminSession);
  const authed = isAuthedLogin(login);
  const prefix = contact.pubkeyPrefix;

  // Report whether the post feed is actually rendered, so arrivals behind the
  // login gate stay unread and keep their drawer row.
  const setVisibleRoomFeed = useMeshStore((s) => s.setVisibleRoomFeed);
  useEffect(() => {
    setVisibleRoomFeed(authed ? roomConvoId(prefix) : null);
    return () => setVisibleRoomFeed(null);
  }, [authed, prefix, setVisibleRoomFeed]);

  // Logging out also forgets any remembered credential, so the next visit
  // re-prompts instead of silently auto-logging back in. The encrypted record
  // and the copy the sign-in hook holds in memory both have to go.
  const logOut = () => {
    resetAdminSession(prefix);
    autoLogin.forget();
    void clearRepeaterCred(prefix);
  };

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <NodeHeader contact={contact} login={login} onLogOut={logOut} />
      {authed ? (
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <ChatArea />
        </div>
      ) : (
        <div className='flex flex-1 flex-col items-center justify-center overflow-y-auto p-4'>
          <RepeaterLoginGate
            contact={contact}
            isRoom
            pending={login === 'pending'}
            auto={autoLogin}
          />
        </div>
      )}
    </div>
  );
}
