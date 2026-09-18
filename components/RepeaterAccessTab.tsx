// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeshStore } from '@/store/meshStore';
import { useMeshCore } from '@/hooks/useMeshCore';
import { resolveNeighbor } from '@/lib/map/nodes';
import {
  PERM_ACL_ADMIN,
  PERM_ACL_GUEST,
  PERM_ACL_READ_ONLY,
  PERM_ACL_READ_WRITE,
  PERM_ACL_ROLE_MASK,
} from '@/lib/meshcore/constants';
import { ADV_ICON } from '@/lib/utils';
import { RefreshButton } from './RefreshButton';
import type { AclEntry, Contact } from '@/types/meshcore';

// Held at module scope so a tab switch joins the outstanding read instead of
// starting a second one; removed once the read settles. Mirrors how the
// Neighbors tab shares its request.
const accessRequests = new Map<string, Promise<AclEntry[]>>();

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
 * The repeater admin Access tab: who else may administer this node, read from
 * its `GET_ACCESS_LIST` binary request.
 *
 * @remarks
 * Read-only by design — the firmware exposes no way to edit the list remotely,
 * and the point of showing it is that an operator can see which other clients
 * hold admin on a node they administer. Each entry carries only a 6-byte key
 * prefix, so it is named only as far as this browser's contacts and advert
 * cache can resolve it.
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

  const [loading, setLoading] = useState(false);
  // Three things land here identically: a reply lost on the mesh (the common
  // one — a single round trip, with no fallback path to soften it), a node
  // whose ACL is empty (the firmware suppresses a reply with no entries), and
  // firmware that has no handler at all. Nothing on the wire tells them apart,
  // so they share one message that leads with the retry.
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
    try {
      let request = accessRequests.get(prefix);
      if (!request) {
        request = repeaterAccessList(contact).finally(() => {
          accessRequests.delete(prefix);
        });
        accessRequests.set(prefix, request);
      }
      setRepeaterAccessList(prefix, await request);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [contact, prefix, repeaterAccessList, setRepeaterAccessList]);

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
                      <span className='truncate'>
                        {ADV_ICON[node.advType] ?? '👤'} {node.name}
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
