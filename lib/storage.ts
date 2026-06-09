// Copyright 2026 Knoban LLC. All rights reserved.
//
// This software is confidential and proprietary, intended for use only by
// Knoban LLC or its authorized users. Unauthorized use, copying, modification,
// distribution of this software, or any part of it, is strictly prohibited and
// may be subject to civil and criminal penalties.
//
// A License Agreement is required to view, use, and/or modify this software.
//
// Disclaimer: This software is provided 'as is' and without any express or
// implied warranties. Knoban LLC is not liable for any damages arising out of
// the use of this software.
//
// For inquiries, contact: alden@knoban.com

import type { Message } from '@/types/meshcore';

const PREFIX = 'meshcore:radio:';

export interface PersistedRadioData {
  msgHistory: Record<string, Message[]>;
}

// Derive an AES-256-GCM key from the radio's channel secrets and pubkey.
// Channel secrets (16 bytes each) are concatenated as PBKDF2 password material;
// the pubkey hex string is used as the salt so different radios always get
// different keys even if their channel secrets are identical.
export async function deriveStorageKey(
  channelSecrets: Uint8Array[],
  pubkey: string,
): Promise<CryptoKey> {
  const enc = new TextEncoder();

  const secretBytes = new Uint8Array(
    channelSecrets.reduce((acc, s) => acc + s.length, 0),
  );
  let offset = 0;
  for (const s of channelSecrets) {
    secretBytes.set(s, offset);
    offset += s.length;
  }

  const baseKey = await crypto.subtle.importKey(
    'raw',
    secretBytes.length > 0 ? secretBytes : enc.encode('meshcore-fallback'),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(pubkey),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(
    Array.from(new Uint8Array(buf), (b) => String.fromCharCode(b)).join(''),
  );
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function saveRadioData(
  pubkey: string,
  key: CryptoKey,
  data: PersistedRadioData,
): Promise<void> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext.buffer as ArrayBuffer,
    );
    const payload = JSON.stringify({
      iv: toBase64(iv.buffer as ArrayBuffer),
      data: toBase64(ciphertext),
    });
    localStorage.setItem(PREFIX + pubkey, payload);
  } catch {}
}

export async function loadRadioData(
  pubkey: string,
  key: CryptoKey,
): Promise<PersistedRadioData | null> {
  try {
    const raw = localStorage.getItem(PREFIX + pubkey);
    if (!raw) return null;
    const { iv, data } = JSON.parse(raw) as { iv: string; data: string };
    const ivBytes = fromBase64(iv);
    const cipherbytes = fromBase64(data);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer },
      key,
      cipherbytes.buffer as ArrayBuffer,
    );
    return JSON.parse(
      new TextDecoder().decode(plaintext),
    ) as PersistedRadioData;
  } catch {
    // Decryption failure = wrong key (different radio) or corrupt data — treat as empty
    return null;
  }
}
