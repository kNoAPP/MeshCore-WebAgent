// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useReducer } from 'react';
import { useMeshStore } from '@/store/meshStore';
import { hasSeedMarker } from '@/lib/storage';
import {
  onIdentityKeyRegistered,
  registeredIdentityKey,
} from '@/lib/identity/storageRoot';

// Identities already found to be seed-born in this tab. A marker is never
// deleted, so a hook mounted later (the wizard's first step, say) starts from
// the answer instead of showing the flash-only copy until its own read lands.
const knownSeedBorn = new Set<string>();

/**
 * Whether the radio's live identity was made from a recovery phrase, so its
 * phrase already restores it.
 *
 * @remarks True once the identity's seed-born marker is read back
 * (`hasSeedMarker`), or while this tab holds its vault-derived key. False
 * until the tab's first marker read for it resolves, and for an identity
 * minted before the marker existed until its vault is next opened, which
 * writes it.
 */
export function useSeedBorn(): boolean {
  const pubkey = useMeshStore((s) => s.selfInfo?.pubkey);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!pubkey) return;
    let live = true;
    const mark = () => {
      knownSeedBorn.add(pubkey);
      if (live) rerender();
    };
    void hasSeedMarker(pubkey).then((seedBorn) => seedBorn && mark());
    // A vault opened while this identity is live registers its key, and
    // marks it if it was minted before the marker existed.
    const off = onIdentityKeyRegistered((registered) => {
      if (registered === pubkey.toLowerCase()) mark();
    });
    return () => {
      live = false;
      off();
    };
  }, [pubkey]);

  return (
    !!pubkey && (knownSeedBorn.has(pubkey) || !!registeredIdentityKey(pubkey))
  );
}
