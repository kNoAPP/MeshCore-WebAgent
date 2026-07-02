// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * Briefly flashes an element (via the `.msg-flash` accent animation) to draw
 * the eye after the command palette scrolls a target into view.
 *
 * Restarts the animation on every call: a bare `classList.add` is a no-op when
 * the class is still present, so the flash would never replay for the same
 * target. Removing, forcing a reflow, then re-adding restarts it, and the class
 * is dropped again on `animationend` so it never lingers on the DOM.
 */
export function flashTarget(el: HTMLElement): void {
  el.classList.remove('msg-flash');
  // Force a reflow so the removed-then-re-added class restarts the animation.
  void el.offsetWidth;
  el.classList.add('msg-flash');
  el.addEventListener('animationend', () => el.classList.remove('msg-flash'), {
    once: true,
  });
}
