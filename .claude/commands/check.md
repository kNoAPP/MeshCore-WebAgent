---
# Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
# (https://github.com/kNoAPP/MeshCore-WebAgent)
---

Run all four CI checks in sequence and report results.

```bash
npm run lint && npm run type-check && npm run spell-check && npm run build
```

Report which checks passed and which failed. If any check fails, show the
relevant error output and suggest what to fix. Do not proceed to the next check
after a failure — stop and report immediately.
