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

name: protocol
description: >
  MeshCore binary Companion Protocol conventions. Use when reading or writing
  anything in lib/meshcore/ — commands, responses, frame parsing, or transports.
license: Proprietary. See LICENSE for complete terms.
compatibility: Requires access to https://docs.meshcore.io/companion_protocol/ for full spec.
metadata:
  author: kNoAPP
  version: '1.0.0'
---

# MeshCore Companion Protocol

Full spec: https://docs.meshcore.io/companion_protocol/

## Frame Format (USB + WiFi)

Frames are delimited by `0x3C` and structured as:

```
[0x3C] [length: 2 bytes LE] [payload: N bytes]
```

Implemented in `lib/meshcore/frameParser.ts`.

## Frame Format (BLE)

BLE uses the Nordic UART Service (NUS). No frame delimiter — chunked writes up to the negotiated MTU (default 23 bytes; negotiate up to 512 bytes for large commands like `SET_CHANNEL`).

## Command / Response Flow

- Commands are fire-and-forget writes; responses are matched by a timeout-based promise in `MeshCoreClient` (`lib/meshcore/client.ts`).
- CMD constants live in `lib/meshcore/constants.ts` — prefix `CMD_*`.
- RESP constants also live in `constants.ts` — prefix `RESP_*`.
- Command encoding is in `lib/meshcore/frames.ts`.
- Response decoding is in `lib/meshcore/parsers.ts`.

## Key Constraints

- BLE default MTU is 23 bytes. Commands larger than the MTU must be split or require MTU negotiation before sending.
- Timestamps are Unix epoch seconds as `uint32` little-endian.
- Contact public keys are 32-byte arrays; the UI shows only the first 4 bytes as a hex prefix.
- Channel index is 0–7; channel secrets are exactly 16 bytes.

## Adding a New Command

1. Add the CMD/RESP byte constant to `constants.ts`.
2. Add the binary encoder to `frames.ts`.
3. Add the binary decoder to `parsers.ts`.
4. Wire the call in `MeshCoreClient` (`client.ts`).
5. Update the Zustand store and/or hook if the response affects UI state.
6. Reference the relevant protocol doc section in the PR description.
