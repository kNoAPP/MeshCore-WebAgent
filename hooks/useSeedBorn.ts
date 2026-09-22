// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useState } from 'react';
import { useMeshStore } from '@/store/meshStore';
import { hasSeedMarker } from '@/lib/storage';
import {
  onIdentityKeyRegistered,
  registeredIdentityKey,
} from '@/lib/identity/storageRoot';

/**
 * Whether the radio's live identity was made from a recovery phrase, so its
 * phrase already restores it.
 *
 * @remarks True once the identity's seed-born marker is read back
 * (`hasSeedMarker`), or while this tab holds its vault-derived key. False
 * until the marker read resolves, and for an identity minted before the
 * marker existed until its vault is next opened, which writes it.
 */
export function useSeedBorn(): boolean {
  const pubkey = useMeshStore((s) => s.selfInfo?.pubkey);
  // The identity last found to be seed-born, so a verdict for the previous
  // identity cannot answer for the next.
  const [marked, setMarked] = useState<string | null>(null);

  useEffect(() => {
    if (!pubkey) return;
    let live = true;
    void hasSeedMarker(pubkey).then(
      (seedBorn) => live && seedBorn && setMarked(pubkey),
    );
    // A vault opened while this identity is live registers its key, and
    // marks it if it was minted before the marker existed.
    const off = onIdentityKeyRegistered((registered) => {
      if (registered === pubkey.toLowerCase()) setMarked(pubkey);
    });
    return () => {
      live = false;
      off();
    };
  }, [pubkey]);

  return !!pubkey && (marked === pubkey || !!registeredIdentityKey(pubkey));
}
