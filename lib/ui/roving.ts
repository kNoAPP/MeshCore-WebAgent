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
 * Attach to the container's `onKeyDown`; give each child `role='radio'` or
 * `role='tab'` and `tabIndex={selected ? 0 : -1}`.
 *
 * @param event - the container's keydown; consumed only for handled keys.
 * @param count - number of children in the widget.
 * @param active - index of the currently selected child.
 * @param select - activates the child at the new index.
 */
export function handleRovingKeyDown(
  event: KeyboardEvent<HTMLElement>,
  count: number,
  active: number,
  select: (index: number) => void,
): void {
  if (count === 0) return;
  let next: number;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = (active + 1) % count;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      next = (active - 1 + count) % count;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = count - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  select(next);
  // The nodes already exist — only their `tabIndex` changes — so focus can move
  // in the same tick rather than waiting for the re-render.
  const items = event.currentTarget.querySelectorAll<HTMLElement>(
    '[role="radio"],[role="tab"]',
  );
  items[next]?.focus();
}
