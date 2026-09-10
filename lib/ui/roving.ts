// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import type { KeyboardEvent } from 'react';

/**
 * The keyboard model WAI-ARIA requires of a composite widget whose children
 * share a single tab stop — a `radiogroup` or a `tablist`. Arrow keys move
 * (wrapping at the ends) and activate as they go, Home/End jump to the ends,
 * and focus follows the selection so the roving `tabIndex` stays on the item
 * the user is on.
 *
 * A `radiogroup` takes all four arrows. A `tablist` takes only the pair along
 * its own axis — Left/Right by default, Up/Down when it carries
 * `aria-orientation='vertical'` — leaving the other pair to scroll the page.
 * The role and orientation are read from the container the handler is attached
 * to.
 *
 * Attach to the container's `onKeyDown`; give each child `role='radio'` or
 * `role='tab'` and `tabIndex={selected ? 0 : -1}`.
 *
 * @param event - the container's keydown; consumed only for handled keys, and
 * never for a modified chord.
 * @param count - number of children in the widget.
 * @param active - index of the currently selected child, or `-1` when none is;
 * movement then starts from the first child.
 * @param select - activates the child at the new index.
 */
export function handleRovingKeyDown(
  event: KeyboardEvent<HTMLElement>,
  count: number,
  active: number,
  select: (index: number) => void,
): void {
  if (count === 0) return;
  // A modified chord is the browser's or the OS's (Ctrl+Home, Alt+Left,
  // Shift+arrow selection), never the widget's.
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const container = event.currentTarget;
  const tablist = container.getAttribute('role') === 'tablist';
  const vertical = container.getAttribute('aria-orientation') === 'vertical';
  const forward = tablist
    ? [vertical ? 'ArrowDown' : 'ArrowRight']
    : ['ArrowRight', 'ArrowDown'];
  const back = tablist
    ? [vertical ? 'ArrowUp' : 'ArrowLeft']
    : ['ArrowLeft', 'ArrowUp'];
  const from = active >= 0 ? active : 0;
  let next: number;
  if (forward.includes(event.key)) {
    next = (from + 1) % count;
  } else if (back.includes(event.key)) {
    next = (from - 1 + count) % count;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = count - 1;
  } else {
    return;
  }
  event.preventDefault();
  select(next);
  // The nodes already exist — only their `tabIndex` changes — so focus can move
  // in the same tick rather than waiting for the re-render.
  const items = container.querySelectorAll<HTMLElement>(
    '[role="radio"],[role="tab"]',
  );
  items[next]?.focus();
}
