// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

// Tabbable candidates inside a dialog. `[tabindex="-1"]` is excluded on
// purpose: it marks programmatically-focusable elements such as the dialog
// container itself, which must never be a Tab stop.
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"])';

// The page-level opener behind each mounted dialog chain, innermost last. Read
// during the render of a dialog raised from inside another one, so it has
// somewhere to put focus if that other dialog turns out to be closing.
const openers: Element[] = [];

/**
 * Keeps keyboard focus inside a dialog for as long as it is mounted.
 *
 * On mount, focus moves into `ref` — unless it is already inside, so a child
 * that focuses its own input (the command palette) keeps it. Tab and Shift+Tab
 * then wrap around the container's tabbable descendants instead of walking out
 * into the page behind. On unmount, focus returns to the element that opened
 * the dialog so the next Tab resumes where the user left off.
 *
 * @param ref - the dialog container; must carry `tabIndex={-1}` so it can
 * receive the initial focus.
 */
export function useFocusTrap<T extends HTMLElement>(
  ref: RefObject<T | null>,
): void {
  // Captured during the first render, before any child effect can move focus
  // into the dialog, so it is the opener that gets focus back on close.
  const [restoreTo] = useState<Element | null>(() => document.activeElement);
  // Where to go instead when the opener does not outlive this dialog: raising
  // one dialog *from* another can replace it rather than stack on it (a command
  // palette action that opens a modal closes the palette in the same commit),
  // which leaves the captured element detached. Nested dialogs whose opener is
  // still on screen never reach this.
  const [outerOpener] = useState<Element | null>(() => {
    const active = document.activeElement;
    if (active?.closest('[role="dialog"]')) {
      return openers[openers.length - 1] ?? null;
    }
    return active;
  });
  const restoreFrame = useRef(0);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    cancelAnimationFrame(restoreFrame.current);
    if (!container.contains(document.activeElement)) container.focus();
    if (outerOpener) openers.push(outerOpener);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>(TABBABLE),
      );
      const first = items[0];
      const last = items[items.length - 1];
      // A dialog with nothing tabbable keeps focus on the container.
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === container) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      const at = outerOpener ? openers.lastIndexOf(outerOpener) : -1;
      if (at !== -1) openers.splice(at, 1);
      // The background is still `inert` while this cleanup runs — React has
      // not re-rendered without the dialog yet — and focusing into an inert
      // subtree is a no-op, so hand the restore to the next frame.
      restoreFrame.current = requestAnimationFrame(() => {
        const target =
          restoreTo instanceof HTMLElement && restoreTo.isConnected
            ? restoreTo
            : outerOpener;
        if (target instanceof HTMLElement && target.isConnected) target.focus();
      });
    };
  }, [ref, restoreTo, outerOpener]);
}
