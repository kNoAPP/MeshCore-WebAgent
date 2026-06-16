---
# Copyright 2026 Knoban LLC. All rights reserved.
#
# This software is confidential and proprietary, intended for use only by
# Knoban LLC or its authorized users. Unauthorized use, copying, modification,
# distribution of this software, or any part of it, is strictly prohibited and
# may be subject to civil and criminal penalties.
#
# A License Agreement is required to view, use, and/or modify this software.
#
# Disclaimer: This software is provided 'as is' and without any express or
# implied warranties. Knoban LLC is not liable for any damages arising out of
# the use of this software.
#
# For inquiries, contact: alden@knoban.com
---

Run all four CI checks in sequence and report results.

```bash
npm run lint && npm run type-check && npm run spell-check && npm run build
```

Report which checks passed and which failed. If any check fails, show the
relevant error output and suggest what to fix. Do not proceed to the next check
after a failure — stop and report immediately.
