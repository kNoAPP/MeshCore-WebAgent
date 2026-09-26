// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-Desktop)

'use client';

import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import {
  useMeshStore,
  isAuthedLogin,
  type AdminLoginState,
} from '@/store/meshStore';
import { ADV_ICON, formatPubkey } from '@/lib/utils';
import { RouteChip } from './RouteChip';
import type { Contact, RepeaterAccess } from '@/types/meshcore';

/**
 * The title bar over a repeater or room server: its identity, route, the role
 * the login granted, and the Log out that ends it. Shared by the room's post
 * feed in Chat and the node's management view on the Nodes page, so the two
 * surfaces of one login can't drift apart on how it reads.
 *
 * @param contact - the repeater or room server the bar names.
 * @param login - the node's admin-session login state.
 * @param onLogOut - ends the session and forgets its remembered credential.
 * @param onBack - if set, renders a back arrow before the name that calls it.
 */
export function NodeHeader({
  contact,
  login,
  onLogOut,
  onBack,
}: {
  contact: Contact;
  login: AdminLoginState;
  onLogOut: () => void;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const showFullPublicKeys = useMeshStore((s) => s.showFullPublicKeys);
  const authed = isAuthedLogin(login);

  return (
    <div className='flex shrink-0 items-center gap-2.5 border-b px-4 py-3 bg-surface border-border'>
      {onBack && (
        <button
          type='button'
          onClick={onBack}
          title={t('nodes.back')}
          aria-label={t('nodes.back')}
          className='-ml-1 rounded p-1 text-text2 hover:text-accent'
        >
          <ArrowLeft size={16} aria-hidden='true' />
        </button>
      )}
      <span className='text-lg'>{ADV_ICON[contact.advType] ?? '📡'}</span>
      <span className='text-[15px] font-semibold'>
        {contact.name || contact.pubkeyPrefix.slice(0, 8)}
      </span>
      <RouteChip contact={contact} />
      {authed && <AccessChip access={login} />}
      <div className='ml-auto flex items-center gap-3'>
        <span className='text-xs text-text2'>
          {formatPubkey(contact.pubkey, showFullPublicKeys)}
        </span>
        {authed && (
          <button
            onClick={onLogOut}
            className='rounded-md border border-red px-2.5 py-1 text-xs text-red hover:bg-red-dim hover:text-white'
          >
            {t('repeaterAdmin.dashboard.logout')}
          </button>
        )}
      </div>
    </div>
  );
}

function AccessChip({ access }: { access: RepeaterAccess }) {
  const { t } = useTranslation();
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        access === 'admin'
          ? 'bg-accent-solid text-white'
          : 'bg-surface2 text-text2'
      }`}
    >
      {t(`repeaterAdmin.access.${access}`)}
    </span>
  );
}
