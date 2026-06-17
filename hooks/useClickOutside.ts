// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * Dismisses a popover when a `mousedown` lands outside `ref`. Only listens
 * while `active` is true (typically the popover's open state), so a closed
 * popover adds no document listener.
 *
 * Callers may pass a fresh `onOutside` closure each render; it's held in a ref
 * so the listener attaches once per `active` toggle, not on every render.
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
  const onOutsideRef = useRef(onOutside);
  useEffect(() => {
    onOutsideRef.current = onOutside;
  });

  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOutsideRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ref, active]);
}
