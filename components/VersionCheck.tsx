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

'use client';

import { useEffect, useRef } from 'react';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

export function VersionCheck() {
  const initialVersion = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      initialVersion.current = await fetchVersion();
    }

    async function check() {
      if (initialVersion.current === null) return;
      const current = await fetchVersion();
      if (
        !cancelled &&
        current !== null &&
        current !== initialVersion.current
      ) {
        window.location.reload();
      }
    }

    init();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return null;
}
