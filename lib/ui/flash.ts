// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

// Must match the `.msg-flash` animation duration in `app/globals.css`.
const FLASH_DURATION_MS = 1600;

// In-flight flash teardown per element, so a new call can cancel it.
const activeFlashes = new WeakMap<HTMLElement, () => void>();

/**
 * Briefly flashes an element (via the `.msg-flash` accent animation) to draw
 * the eye after the command palette scrolls a target into view.
 *
 * Restarts the animation on every call: a bare `classList.add` is a no-op when
 * the class is still present, so the flash would never replay for the same
 * target. Removing, forcing a reflow, then re-adding restarts it, and the class
 * is dropped again once the animation settles so it never lingers on the DOM.
 *
 * A timeout fallback matching the CSS duration handles the case where no
 * animation event fires — e.g. under `prefers-reduced-motion: reduce`, where
 * the animation is disabled and `animationend` would never arrive.
 */
export function flashTarget(el: HTMLElement): void {
  // Cancel any in-flight flash so re-selecting the same target replays cleanly
  // without leaking the prior run's listeners or timer.
  activeFlashes.get(el)?.();

  el.classList.remove('msg-flash');
  // Force a reflow so the removed-then-re-added class restarts the animation.
  void el.offsetWidth;
  el.classList.add('msg-flash');

  const cleanup = () => {
    el.removeEventListener('animationend', onEnd);
    el.removeEventListener('animationcancel', onEnd);
    clearTimeout(timer);
    activeFlashes.delete(el);
    el.classList.remove('msg-flash');
  };

  const onEnd = (e: AnimationEvent) => {
    // Ignore animations bubbling up from descendants.
    if (e.target !== el) return;
    cleanup();
  };

  el.addEventListener('animationend', onEnd);
  el.addEventListener('animationcancel', onEnd);
  const timer = setTimeout(cleanup, FLASH_DURATION_MS);

  activeFlashes.set(el, cleanup);
}
