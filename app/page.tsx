// Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
// (https://github.com/kNoAPP/MeshCore-WebAgent)

import { AppShell } from '@/components/AppShell';

/**
 * The single app route — delegates everything to the client-side
 * {@link AppShell}.
 */
export default function Page() {
  return <AppShell />;
}
