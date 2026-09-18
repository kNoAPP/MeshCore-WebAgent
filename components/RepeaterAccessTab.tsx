// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { resolveNeighbor } from '@/lib/map/nodes';
import {
  ACCESS_LIST_MAX_ENTRIES,
  PERM_ACL_ADMIN,
  PERM_ACL_GUEST,
  PERM_ACL_READ_ONLY,
  PERM_ACL_READ_WRITE,
  PERM_ACL_ROLE_MASK,
} from '@/lib/meshcore/constants';
import { ADV_ICON } from '@/lib/utils';
import { joinRead, sessionReadKey } from '@/lib/session/sharedReads';
import { RefreshButton } from './RefreshButton';
import type { Contact } from '@/types/meshcore';

// Label key per ACL role, indexed by the role value itself — the firmware
// numbers the four roles 0-3, and `PERM_ACL_ROLE_MASK` keeps a lookup in range.
// A literal tuple rather than a `Record<number, string>` so `t()` still
// type-checks the keys.
const ROLE_LABELS = [
  'repeaterAdmin.accessList.roleGuest',
  'repeaterAdmin.accessList.roleReadOnly',
  'repeaterAdmin.accessList.roleReadWrite',
  'repeaterAdmin.accessList.roleAdmin',
] as const satisfies Record<
  | typeof PERM_ACL_GUEST
  | typeof PERM_ACL_READ_ONLY
  | typeof PERM_ACL_READ_WRITE
  | typeof PERM_ACL_ADMIN,
  string
>;

/**
 * The repeater admin Access tab: the node's access control list — every client
 * it holds an entry for and the role each was granted — read from its
 * `GET_ACCESS_LIST` binary request.
 *
 * @remarks
 * Not an admin-only roster: a repeater returns every entry whose permissions
 * byte is non-zero, so read-only and read/write clients appear alongside
 * admins. (A room server is the exception — it filters its reply to admin
 * entries.) A plain guest is the one role that cannot appear: the firmware
 * spends zero for both "deleted" and the guest role, and skips those entries
 * when building the reply. Nor is the list guaranteed whole — the reply is one
 * packet with no total and no way to ask for a second, so a node holding more
 * than {@link ACCESS_LIST_MAX_ENTRIES} is reported as possibly short.
 * Read-only by design, as
 * the firmware exposes no way to edit the list remotely; the point of showing
 * it is that an operator can see who else holds a role on a node they
 * administer. Each entry carries only a 6-byte key prefix, so it is named only
 * as far as this browser's contacts and advert cache can resolve it.
 * @param contact - the node, which must already have an admin session.
 */
export function RepeaterAccessTab({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  const { repeaterAccessList } = useMeshCore();
  const contacts = useMeshStore((s) => s.contacts);
  const advertCache = useMeshStore((s) => s.advertCache);
  const prefix = contact.pubkeyPrefix;

  // Cached in the per-node session so the table survives navigating away and
  // back; the store is its source of truth.
  const entries = useMeshStore((s) => s.adminSessions[prefix]?.accessList);
  const setRepeaterAccessList = useMeshStore((s) => s.setRepeaterAccessList);
  // Whether the newest attempt failed. In the session rather than in this
  // component because the tab unmounts on navigation: local state would reset,
  // the cached-list branch below would skip the automatic re-read, and the
  // stale rows would come back with nothing saying so.
  const stale = useMeshStore((s) => s.adminSessions[prefix]?.accessListStale);
  const setRepeaterAccessStale = useMeshStore((s) => s.setRepeaterAccessStale);

  const [loading, setLoading] = useState(false);
  // Three things land here identically: a reply lost on the mesh (the common
  // one — a single round trip, with no fallback path to soften it), a node
  // whose ACL is empty (the firmware suppresses a reply with no entries), and
  // firmware that has no handler at all. Nothing on the wire tells them apart,
  // so they share one message that leads with the retry.
  //
  // Only drives the no-cache notice. A failure with rows cached is recorded on
  // the session instead, so it survives navigation.
  const [errored, setErrored] = useState(false);
  const fetched = useRef(false);
  const hadCache = useRef(entries != null);

  // Name each entry as far as the prefix allows. `resolveNeighbor` refuses an
  // ambiguous prefix, so an entry that could be two different nodes stays
  // unnamed instead of being attributed to a guess.
  const rows = useMemo(
    () =>
      (entries ?? []).map((entry) => ({
        entry,
        node: resolveNeighbor(entry.pubkeyPrefix, contacts, advertCache)
          .identity,
      })),
    [entries, contacts, advertCache],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrored(false);
    // The session this read belongs to. A log-out and re-login while it is in
    // flight mints a new token, and this list is admin-only — so it must not
    // land on whatever session replaced the one that asked. The token is in the
    // shared-read key too: joining the previous session's read would stamp its
    // result with this session's token and walk straight past the guard in
    // `setRepeaterAccessList`. Read outside the try so the failure path can
    // scope its own write to the same session.
    const token = useMeshStore.getState().adminSessions[prefix]?.token;
    try {
      const entries = await joinRead(
        sessionReadKey('access', prefix, token),
        () => repeaterAccessList(contact),
      );
      setRepeaterAccessList(prefix, entries, token);
    } catch {
      setErrored(true);
      setRepeaterAccessStale(prefix, token);
    } finally {
      setLoading(false);
    }
  }, [
    contact,
    prefix,
    repeaterAccessList,
    setRepeaterAccessList,
    setRepeaterAccessStale,
  ]);

  // Read once on first entry unless a cached list is already showing. The ref
  // guard survives StrictMode's double mount, and `refresh` joins an
  // outstanding read, so a remount mid-flight won't duplicate it.
  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    if (hadCache.current) return;
    void refresh();
  }, [refresh]);

  return (
    <div className='mx-auto flex w-full max-w-3xl flex-col gap-3'>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-xs text-text2'>
          {t('repeaterAdmin.accessList.caption')}
        </p>
        <RefreshButton onClick={() => void refresh()} busy={loading} />
      </div>
      {/* A failed refresh over a cached result would otherwise leave it looking
          freshly confirmed, so say so above it. Gated on a list having been
          cached at all, not on its length: an empty list is a real answer from
          a node holding no entries, and without this the notice below would go
          on calling it that long after a refresh stopped confirming it. Driven
          by session state, so navigating away and back cannot clear the warning
          while leaving the result it was about. */}
      {stale && entries != null && (
        <p className='rounded-lg border border-border p-3 text-sm text-text2'>
          {t('repeaterAdmin.accessList.stale')}
        </p>
      )}
      {/* A reply that filled the firmware's buffer is the only sign this list
          may be short — the request carries no total and no way to ask for the
          rest, so a node holding more entries than fit answers with a reply
          that looks whole. Say so rather than let the table imply completeness.
          Exactly at the cap because the firmware stops there, not below it. */}
      {rows.length >= ACCESS_LIST_MAX_ENTRIES && (
        <p className='rounded-lg border border-border p-3 text-sm text-text2'>
          {t('repeaterAdmin.accessList.truncated', {
            max: ACCESS_LIST_MAX_ENTRIES,
          })}
        </p>
      )}
      {rows.length === 0 ? (
        <div className='rounded-lg border border-border p-6'>
          <p className='text-center text-sm text-text2'>
            {errored
              ? t('repeaterAdmin.accessList.unavailable')
              : loading || entries == null
                ? t('repeaterAdmin.accessList.loading')
                : t('repeaterAdmin.accessList.empty')}
          </p>
        </div>
      ) : (
        <div className='overflow-hidden rounded-lg border border-border'>
          <table
            className='w-full text-sm'
            aria-label={t('repeaterAdmin.accessList.label')}
          >
            <thead>
              <tr className='text-left text-xs text-text2 bg-surface'>
                <th scope='col' className='px-3 py-1.5 font-medium'>
                  {t('repeaterAdmin.accessList.colClient')}
                </th>
                <th scope='col' className='px-3 py-1.5 font-medium'>
                  {t('repeaterAdmin.accessList.colRole')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry, node }, index) => (
                // A 6-byte prefix is not unique on its own, so the reply
                // position discriminates two rows that happen to share one.
                <tr
                  key={`${entry.pubkeyPrefix}:${index}`}
                  className='border-t border-border'
                >
                  <td className='px-3 py-1.5'>
                    {node ? (
                      <span className='flex items-center gap-1.5 truncate'>
                        <span aria-hidden='true'>
                          {ADV_ICON[node.advType] ?? '👤'}
                        </span>
                        <span className='truncate'>{node.name}</span>
                      </span>
                    ) : (
                      <span className='font-mono text-xs text-text2'>
                        {entry.pubkeyPrefix}
                      </span>
                    )}
                  </td>
                  <td className='px-3 py-1.5 text-text2'>
                    {t(ROLE_LABELS[entry.permissions & PERM_ACL_ROLE_MASK])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
