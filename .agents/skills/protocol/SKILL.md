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
  version: '1.1.0'
---

# MeshCore Companion Protocol

Full spec: https://docs.meshcore.io/companion_protocol/

The docs are incomplete in places — the firmware source at
https://github.com/meshcore-dev/MeshCore is the authority when they disagree (e.g.
`out_path_len` mode bits, the `0x88` RX log push).

## Frame Format (USB + WiFi)

Same structure both directions, but the delimiter differs:

```
[delimiter] [length: 2 bytes LE] [payload: N bytes]
```

- Inbound (radio → app): delimiter `0x3C`, parsed in `lib/meshcore/frameParser.ts`. Frames with length 0 or > 512 are discarded.
- Outbound (app → radio): delimiter `0x3E`, built in `lib/meshcore/frames.ts`.

## Frame Format (BLE)

BLE uses the Nordic UART Service (NUS). No delimiter or length prefix — each GATT notification is treated as one complete inbound frame, and outbound payloads are written with `writeValueWithResponse` in 512-byte chunks (`lib/meshcore/transports.ts`).

## Command / Response Flow

- Commands are fire-and-forget writes; responses are matched by a timeout-based promise in `MeshCoreClient` (`lib/meshcore/client.ts`). Default timeout is 5 s.
- Command bytes live in the `CMD` const object in `lib/meshcore/constants.ts`; response bytes in the `RESP` object.
- Codes `>= 0x80` are unsolicited pushes from the radio (`RESP.PUSH_ADVERT`, `PUSH_PATH_UPDATED`, `PUSH_SEND_CONFIRMED`, `PUSH_MSG_WAITING`, `PUSH_LOG_RX_DATA`), not command responses.
- The client also polls for new messages (`CMD.SYNC_NEXT_MESSAGE`) every 5 seconds.
- Command encoding is in `lib/meshcore/frames.ts`.
- Response decoding is in `lib/meshcore/parsers.ts`.

## Key Constraints

- Timestamps are Unix epoch seconds as `uint32` little-endian.
- Contact public keys are 32-byte arrays; the UI identifies contacts by a 6-byte hex prefix (`pubkeyPrefix` in `parsers.ts`).
- Channel index is 0–7; channel secrets are exactly 16 bytes.
- Outgoing message text is truncated to 160 bytes (`frames.ts`).
- `Contact.outPathLen === 255` (`NO_PATH`) means no route is known and messages flood.

## Adding a New Command

1. Add the CMD/RESP byte constant to `constants.ts`.
2. Add the binary encoder to `frames.ts`.
3. Add the binary decoder to `parsers.ts`.
4. Wire the call in `MeshCoreClient` (`client.ts`).
5. Update the Zustand store and/or hook if the response affects UI state.
6. Reference the relevant protocol doc section in the PR description.
