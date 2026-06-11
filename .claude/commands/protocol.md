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

Fetch and explain a MeshCore Companion Protocol command or response.

The user will provide a command name, CMD constant, or RESP constant (e.g. "SEND_TEXT_MESSAGE", "CMD_APP_START", "RESP_CONTACT_MSG_RECV").

1. Look up the constant in `lib/meshcore/constants.ts`
2. Find the corresponding encode/decode logic in `lib/meshcore/frames.ts` and `lib/meshcore/parsers.ts`
3. Fetch the live protocol documentation: https://docs.meshcore.io/companion_protocol/
4. Summarize:
   - What the command/response does
   - Its binary layout (fields, sizes, offsets)
   - Where it is used in the codebase (which files call or handle it)
   - Any known edge cases (BLE MTU limits, timing, etc.)
