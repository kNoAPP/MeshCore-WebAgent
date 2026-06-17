---
# Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
# (https://github.com/kNoAPP/MeshCore-WebAgent)
---

Fetch and explain a MeshCore Companion Protocol command or response.

The user will provide a command name, CMD constant, or RESP constant (e.g.
"SEND_TEXT_MESSAGE", "CMD_APP_START", "RESP_CONTACT_MSG_RECV").

1. Look up the constant in `lib/meshcore/constants.ts`
2. Find the corresponding encode/decode logic in `lib/meshcore/frames.ts` and
   `lib/meshcore/parsers.ts`
3. Fetch the live protocol documentation:
   https://docs.meshcore.io/companion_protocol/
4. Summarize:
   - What the command/response does
   - Its binary layout (fields, sizes, offsets)
   - Where it is used in the codebase (which files call or handle it)
   - Any known edge cases (BLE MTU limits, timing, etc.)
