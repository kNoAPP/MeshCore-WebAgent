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

import { useEffect, type RefObject } from 'react';

/**
 * Dismisses a popover when a `mousedown` lands outside `ref`. Only listens
 * while `active` is true (typically the popover's open state), so a closed
 * popover adds no document listener.
 *
 * @param ref - the popover root; clicks inside it are ignored.
 * @param active - whether the listener should be attached.
 * @param onOutside - called on an outside click (e.g. to close the popover).
 */
export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onOutside: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ref, active, onOutside]);
}
