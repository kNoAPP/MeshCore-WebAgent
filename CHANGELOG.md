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

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Initial public release
- USB Serial, Bluetooth LE, and WiFi WebSocket transport support
- Channel messaging (up to 8 channels with 16-byte secrets)
- Direct messages with contacts
- Contact management (chat nodes, repeaters, room servers)
- Device stats modal (battery, RSSI/SNR, packet counters, uptime)
- Persistent encrypted message history via IndexedDB (AES-GCM)
- Resizable sidebar with channels and contacts sections
- Dark theme UI with Tailwind CSS
