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

## [1.1.1](https://github.com/kNoAPP/MeshCore-WebAgent/compare/meshcore-webagent-v1.1.0...meshcore-webagent-v1.1.1) (2026-06-09)


### Bug Fixes

* deploy release once created ([#15](https://github.com/kNoAPP/MeshCore-WebAgent/issues/15)) ([6c44a5b](https://github.com/kNoAPP/MeshCore-WebAgent/commit/6c44a5b3390073cf85ddf7d94f3875b1ea5de0b2))

## [1.1.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/meshcore-webagent-v1.0.0...meshcore-webagent-v1.1.0) (2026-06-09)


### Features

* cache bust the app on release ([#13](https://github.com/kNoAPP/MeshCore-WebAgent/issues/13)) ([fb92668](https://github.com/kNoAPP/MeshCore-WebAgent/commit/fb92668f5e4a4a2fda6a7a141eb94f94627b4bb1))

## 1.0.0 (2026-06-09)


### Features

* initial commit ([0836a65](https://github.com/kNoAPP/MeshCore-WebAgent/commit/0836a65f91315678dd19757eecf183b7a159be12))


### Bug Fixes

* repair annoying release please ([#10](https://github.com/kNoAPP/MeshCore-WebAgent/issues/10)) ([1e173ef](https://github.com/kNoAPP/MeshCore-WebAgent/commit/1e173eff3e52bee99a0154942087158f9f3da626))
* repair first-pass items ([#3](https://github.com/kNoAPP/MeshCore-WebAgent/issues/3)) ([85c93a1](https://github.com/kNoAPP/MeshCore-WebAgent/commit/85c93a1982cdd31fe6f2108b9bd32d181095b9ad))
* repair initial issues ([#6](https://github.com/kNoAPP/MeshCore-WebAgent/issues/6)) ([8102022](https://github.com/kNoAPP/MeshCore-WebAgent/commit/8102022b8254878f84b9f93b39b784f8e6909977))
* repair release-please ([#8](https://github.com/kNoAPP/MeshCore-WebAgent/issues/8)) ([0e1d568](https://github.com/kNoAPP/MeshCore-WebAgent/commit/0e1d568a376cbb5ba92881e8d760a814f8e58fa0))

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
