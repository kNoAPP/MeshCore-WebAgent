// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

/**
 * The "MeshCore Companion" brand wordmark, with the accent-colored "Core".
 * Inline-only — callers wrap it in the heading element and sizing they need.
 */
export function Wordmark() {
  return (
    <>
      Mesh<span className='text-(--accent)'>Core</span> Companion
    </>
  );
}
