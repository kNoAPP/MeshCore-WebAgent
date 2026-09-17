// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Advert, Contact } from '@/types/meshcore';
import { isSaved, type DirectoryNode } from '@/lib/nodes/directory';

/**
 * The bar that appears once rows are checked, offering the two operations that
 * are painful one node at a time: saving a batch of heard nodes as contacts,
 * and pruning saved ones — which is what makes the radio's `CONTACTS_FULL`
 * warning actionable, since its only remedy is freeing table slots.
 *
 * Each node is written in sequence, never in parallel: the radio answers one
 * command at a time, and a batch fired at once would have each write racing the
 * others past its own timeout.
 *
 * @param selected - the checked rows, already narrowed to the listed ones, so
 * a node the filters hide is never written to.
 * @param onAddContact - resolves `false` when the radio refused the write; the
 * failure is surfaced as a toast by the caller's own action.
 * @param onRemoveContact - the same contract for a delete.
 * @param onClear - drops the selection without writing anything.
 * @param onWritten - receives the keys the radio accepted. Only those are
 * unchecked: a node the radio refused stays selected to retry, and so does one
 * this batch never touched (a saved contact during a "save heard nodes" run).
 */
export function NodeBulkBar({
  selected,
  connected,
  onAddContact,
  onRemoveContact,
  onClear,
  onWritten,
}: {
  selected: DirectoryNode[];
  connected: boolean;
  onAddContact: (advert: Advert) => Promise<boolean>;
  onRemoveContact: (contact: Contact) => Promise<boolean>;
  onClear: () => void;
  onWritten: (keys: string[]) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const addable = selected.filter((node) => !isSaved(node) && node.advert);
  const removable = selected.filter(isSaved);

  const run = async (
    batch: DirectoryNode[],
    write: (node: DirectoryNode) => Promise<boolean>,
  ) => {
    setBusy(true);
    const written: string[] = [];
    try {
      for (const node of batch) {
        if (await write(node)) written.push(node.key);
      }
    } finally {
      setBusy(false);
      setConfirming(false);
      onWritten(written);
    }
  };

  const addAll = () =>
    void run(addable, (node) =>
      node.advert ? onAddContact(node.advert) : Promise.resolve(false),
    );

  const removeAll = () =>
    void run(removable, (node) =>
      node.contact ? onRemoveContact(node.contact) : Promise.resolve(false),
    );

  return (
    <div
      role='region'
      aria-label={t('nodes.selection.title')}
      className='flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-2'
    >
      <p aria-live='polite' className='text-xs text-text2'>
        {confirming
          ? t('nodes.selection.removeConfirm', { count: removable.length })
          : t('nodes.selection.count', { count: selected.length })}
      </p>
      <div className='flex shrink-0 items-center gap-2'>
        {confirming ? (
          <>
            <button
              type='button'
              autoFocus
              onClick={() => setConfirming(false)}
              className='rounded-md px-3 py-1 text-xs text-text hover:bg-surface2'
            >
              {t('common.cancel')}
            </button>
            <button
              type='button'
              onClick={removeAll}
              disabled={busy}
              className='rounded-md bg-red-solid px-3 py-1 text-xs font-semibold text-white hover:bg-red-hover disabled:cursor-not-allowed disabled:opacity-50'
            >
              {t('nodes.selection.remove', { count: removable.length })}
            </button>
          </>
        ) : (
          <>
            <button
              type='button'
              onClick={onClear}
              className='rounded-md px-3 py-1 text-xs text-text2 hover:text-accent'
            >
              {t('nodes.selection.clear')}
            </button>
            <button
              type='button'
              onClick={addAll}
              disabled={!connected || busy || addable.length === 0}
              className='rounded-md bg-accent-solid px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:opacity-50'
            >
              {t('nodes.selection.add', { count: addable.length })}
            </button>
            <button
              type='button'
              onClick={() => setConfirming(true)}
              disabled={!connected || busy || removable.length === 0}
              className='rounded-md bg-red-dim px-3 py-1 text-xs text-white hover:bg-red-dim-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-red-dim'
            >
              {t('nodes.selection.remove', { count: removable.length })}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
