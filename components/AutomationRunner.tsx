// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

'use client';

import { useAutomation } from '@/hooks/useAutomation';

/**
 * Headless mount point for the automation engine (task 6.4). Runs
 * {@link useAutomation} — which subscribes the engine to the event bus while
 * armed, keeps its action context current, and persists rule edits — and
 * renders nothing. Mounted by {@link AppShell} only while connected.
 */
export function AutomationRunner() {
  useAutomation();
  return null;
}
