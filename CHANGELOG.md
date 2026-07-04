# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.13.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.12.0...v1.13.0) (2026-07-04)


### Features

* **automation:** add cron scheduler trigger ([#138](https://github.com/kNoAPP/MeshCore-WebAgent/issues/138)) ([0f42995](https://github.com/kNoAPP/MeshCore-WebAgent/commit/0f42995e0717d80b7c8c05159a78a50e2f7a320d))
* **automation:** filter advert triggers by node type ([#135](https://github.com/kNoAPP/MeshCore-WebAgent/issues/135)) ([97d2c36](https://github.com/kNoAPP/MeshCore-WebAgent/commit/97d2c36af65a4b57742cec4e4bb0d1538b22c7d2))
* **automation:** filter message triggers by channel and contact ([#137](https://github.com/kNoAPP/MeshCore-WebAgent/issues/137)) ([d7df89c](https://github.com/kNoAPP/MeshCore-WebAgent/commit/d7df89c8c3b2d8fe44a32e3b3d0a3cb4d8766344))

## [1.12.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.11.0...v1.12.0) (2026-07-03)


### Features

* add connect attribution, provider key link, and Firefox BLE note ([#132](https://github.com/kNoAPP/MeshCore-WebAgent/issues/132)) ([2596512](https://github.com/kNoAPP/MeshCore-WebAgent/commit/259651212f3e01f63cdf0027ac9649d62592116f))
* show app version in connect footer ([#134](https://github.com/kNoAPP/MeshCore-WebAgent/issues/134)) ([3b731e5](https://github.com/kNoAPP/MeshCore-WebAgent/commit/3b731e59b63c5bd43f682892120499ca6ed464c1))

## [1.11.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.10.0...v1.11.0) (2026-07-02)


### Features

* open pending approvals in a top-bar popup ([#129](https://github.com/kNoAPP/MeshCore-WebAgent/issues/129)) ([c69366d](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c69366de95c0eb299a7e29d98304f1dde32b0b36))

## [1.10.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.9.0...v1.10.0) (2026-07-02)


### Features

* **automation:** revamp the rule editor with a dialog and limit sliders ([#126](https://github.com/kNoAPP/MeshCore-WebAgent/issues/126)) ([c41821b](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c41821b1ee873eb54b9bffa91e29402cb4f95648))


### Bug Fixes

* restore button cursor and index automation in search ([#128](https://github.com/kNoAPP/MeshCore-WebAgent/issues/128)) ([e019b5c](https://github.com/kNoAPP/MeshCore-WebAgent/commit/e019b5c848948b2581721df4d728676563ba62f8))

## [1.9.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.8.0...v1.9.0) (2026-07-02)


### Features

* add LLM provider abstraction and BYO-key settings ([#122](https://github.com/kNoAPP/MeshCore-WebAgent/issues/122)) ([68d2a8d](https://github.com/kNoAPP/MeshCore-WebAgent/commit/68d2a8df27d69f53d9d638ac158f240786b777b3))
* add mesh event bus and automation rules engine ([#123](https://github.com/kNoAPP/MeshCore-WebAgent/issues/123)) ([c96d10a](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c96d10adde2c15ce5ee89d07f6c9f7b38e463e50))
* **ai:** add secure per-radio secret storage for API keys ([#120](https://github.com/kNoAPP/MeshCore-WebAgent/issues/120)) ([0f89562](https://github.com/kNoAPP/MeshCore-WebAgent/commit/0f895629c9f032211e272a0591664602b94a0d5b))
* **ai:** teach the model MeshCore constraints via a system preamble ([#124](https://github.com/kNoAPP/MeshCore-WebAgent/issues/124)) ([5a16906](https://github.com/kNoAPP/MeshCore-WebAgent/commit/5a16906080ae1c7829c5cb4fea58c1346a0056d2))

## [1.8.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.7.0...v1.8.0) (2026-07-02)


### Features

* add advertised location settings with map picker and sharing ([#115](https://github.com/kNoAPP/MeshCore-WebAgent/issues/115)) ([71faee7](https://github.com/kNoAPP/MeshCore-WebAgent/commit/71faee75f130972cca55d9d5d625b88e3d9713b6))
* add global command palette (Find Anything) search ([#117](https://github.com/kNoAPP/MeshCore-WebAgent/issues/117)) ([d960578](https://github.com/kNoAPP/MeshCore-WebAgent/commit/d960578b55b60cfd23b8988ef403e5fba9e5f167))
* **chat:** add date dividers and per-message copy ([#116](https://github.com/kNoAPP/MeshCore-WebAgent/issues/116)) ([da61594](https://github.com/kNoAPP/MeshCore-WebAgent/commit/da61594b83e6699408ba702b1baa7fb165c69ddf))
* **map:** plot contacts as colored shapes with legend ([#112](https://github.com/kNoAPP/MeshCore-WebAgent/issues/112)) ([8b2def2](https://github.com/kNoAPP/MeshCore-WebAgent/commit/8b2def243131bb38ba89befdbaa785721fed4cea))


### Bug Fixes

* **manage:** show megaphone icon for Public channel in properties modal ([#114](https://github.com/kNoAPP/MeshCore-WebAgent/issues/114)) ([ec03d74](https://github.com/kNoAPP/MeshCore-WebAgent/commit/ec03d74d433249ea4172ea4145fa96fc34a93dfa))

## [1.7.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.6.0...v1.7.0) (2026-07-01)


### Features

* add channel import by meshcore://channel/add link ([#109](https://github.com/kNoAPP/MeshCore-WebAgent/issues/109)) ([f483a5c](https://github.com/kNoAPP/MeshCore-WebAgent/commit/f483a5c7396a36ff8e9d6bd44d6299ccf443db45))
* add contact by link, manual key entry, and discover tab ([#106](https://github.com/kNoAPP/MeshCore-WebAgent/issues/106)) ([a8ac710](https://github.com/kNoAPP/MeshCore-WebAgent/commit/a8ac7109c01680fe50080a04c06cd43df7d14c42))
* add Leaflet + OSM + Carto map view of contacts and adverts ([#111](https://github.com/kNoAPP/MeshCore-WebAgent/issues/111)) ([77c9baa](https://github.com/kNoAPP/MeshCore-WebAgent/commit/77c9baaeba6f0f58a51d1b98807627842cb7c8bb))
* set default app zoom to 125% ([#108](https://github.com/kNoAPP/MeshCore-WebAgent/issues/108)) ([77a6f4a](https://github.com/kNoAPP/MeshCore-WebAgent/commit/77a6f4a453b15a47e07413d42cd8f61b042861b0))
* show coordinates and distance in contact and advert detail ([#110](https://github.com/kNoAPP/MeshCore-WebAgent/issues/110)) ([a5b4c2d](https://github.com/kNoAPP/MeshCore-WebAgent/commit/a5b4c2d5259feb62176293eb9087429f3798c515))

## [1.6.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.5.0...v1.6.0) (2026-06-30)


### Features

* reboot the connected device (REBOOT command) ([#101](https://github.com/kNoAPP/MeshCore-WebAgent/issues/101)) ([0787be7](https://github.com/kNoAPP/MeshCore-WebAgent/commit/0787be7afe1e4f6511a98045019bbb446efd8040))
* self-advertise to the mesh (flood + zero-hop) ([#98](https://github.com/kNoAPP/MeshCore-WebAgent/issues/98)) ([e9edeab](https://github.com/kNoAPP/MeshCore-WebAgent/commit/e9edeab2d7ccfb25649d392d7dc38c20d36a940d))
* share your node via self-contact QR and link ([#103](https://github.com/kNoAPP/MeshCore-WebAgent/issues/103)) ([326d4bf](https://github.com/kNoAPP/MeshCore-WebAgent/commit/326d4bf6874d1a545c5a948614718024233bd150))
* view & edit radio parameters with region presets ([#96](https://github.com/kNoAPP/MeshCore-WebAgent/issues/96)) ([340df3d](https://github.com/kNoAPP/MeshCore-WebAgent/commit/340df3db3ddf6be209c1a414e34ce4d4edc6e874))


### Bug Fixes

* **stats:** stabilize device queries and add loading skeletons ([#104](https://github.com/kNoAPP/MeshCore-WebAgent/issues/104)) ([911167b](https://github.com/kNoAPP/MeshCore-WebAgent/commit/911167b276ccf1e2ac80e1664e9c4da2589ab107))
* **transport:** re-acquire USB port on reconnect after re-enumeration ([#99](https://github.com/kNoAPP/MeshCore-WebAgent/issues/99)) ([2c91838](https://github.com/kNoAPP/MeshCore-WebAgent/commit/2c91838f5ec7aeea76c975f34f44915831e0f153))

## [1.5.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.4.0...v1.5.0) (2026-06-28)


### Features

* add settings page with read-only device info ([#93](https://github.com/kNoAPP/MeshCore-WebAgent/issues/93)) ([192bdd8](https://github.com/kNoAPP/MeshCore-WebAgent/commit/192bdd850838f223ef5b62441959727a0ef3a5c9))
* edit node name from settings (SET_ADVERT_NAME) ([#94](https://github.com/kNoAPP/MeshCore-WebAgent/issues/94)) ([df5f724](https://github.com/kNoAPP/MeshCore-WebAgent/commit/df5f724a81fe0fbdbe2e98bf17ef6482841b9b14))
* include history senders in mention suggestions ([#92](https://github.com/kNoAPP/MeshCore-WebAgent/issues/92)) ([5c3f5d8](https://github.com/kNoAPP/MeshCore-WebAgent/commit/5c3f5d8de172bfae1d9965c09fcffce10b983cd7))
* replace stats modal with full-page stats view ([#91](https://github.com/kNoAPP/MeshCore-WebAgent/issues/91)) ([101a017](https://github.com/kNoAPP/MeshCore-WebAgent/commit/101a0179b1ecb61f6f6da8789d70ac9f4aac3ecd))
* surface unavailable device stats sections ([#90](https://github.com/kNoAPP/MeshCore-WebAgent/issues/90)) ([e6c71b2](https://github.com/kNoAPP/MeshCore-WebAgent/commit/e6c71b22c497a74186a4943594a331372e4d0ba6))


### Bug Fixes

* cap outgoing messages by UTF-8 bytes to match firmware ([#89](https://github.com/kNoAPP/MeshCore-WebAgent/issues/89)) ([13715fb](https://github.com/kNoAPP/MeshCore-WebAgent/commit/13715fbda82511ac40441dd81a737245e572066d))
* darken light-mode self-mention text for readability ([#86](https://github.com/kNoAPP/MeshCore-WebAgent/issues/86)) ([b6193a9](https://github.com/kNoAPP/MeshCore-WebAgent/commit/b6193a9f5a704aee8601fb2637e288417d0ac1ba))
* sync full contact table via idle timeout ([#85](https://github.com/kNoAPP/MeshCore-WebAgent/issues/85)) ([8a03c09](https://github.com/kNoAPP/MeshCore-WebAgent/commit/8a03c09946621fe8e0fe94f09650e3e3eed4d65c))

## [1.4.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.3.0...v1.4.0) (2026-06-26)


### Features

* add graceful reconnect to radio UI ([#47](https://github.com/kNoAPP/MeshCore-WebAgent/issues/47)) ([f74d644](https://github.com/kNoAPP/MeshCore-WebAgent/commit/f74d64467b85819142593b60b618808e56435d96))
* sync device clock on connect with stats resync control ([#84](https://github.com/kNoAPP/MeshCore-WebAgent/issues/84)) ([fac2ee0](https://github.com/kNoAPP/MeshCore-WebAgent/commit/fac2ee0f9746ac2bcd9828b5d344b7f59b838c08))


### Bug Fixes

* **parser:** correct SELF_INFO pubkey offset and expose radio params ([#81](https://github.com/kNoAPP/MeshCore-WebAgent/issues/81)) ([a117f62](https://github.com/kNoAPP/MeshCore-WebAgent/commit/a117f622ae27217b83db209114345f029ab5837b))

## [1.3.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.2.0...v1.3.0) (2026-06-18)


### Features

* add filter/ordering options to contacts sidebar ([#39](https://github.com/kNoAPP/MeshCore-WebAgent/issues/39)) ([b186598](https://github.com/kNoAPP/MeshCore-WebAgent/commit/b18659862339f0c30169ecdbe1a1ca4c363bcd7a))
* disable mobile viewports ([#44](https://github.com/kNoAPP/MeshCore-WebAgent/issues/44)) ([55a36c2](https://github.com/kNoAPP/MeshCore-WebAgent/commit/55a36c21e615a0aba753e6a99972806b0eb65a2c))


### Bug Fixes

* jump to latest message when switching chats ([#41](https://github.com/kNoAPP/MeshCore-WebAgent/issues/41)) ([eacc5b3](https://github.com/kNoAPP/MeshCore-WebAgent/commit/eacc5b33eb61b704fbb073d38e9e549d9f2fe052))

## [1.2.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.1.1...v1.2.0) (2026-06-17)


### Features

* add controls for adding/removing channels/contacts ([#32](https://github.com/kNoAPP/MeshCore-WebAgent/issues/32)) ([c28b2ee](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c28b2eee9b6df620f0194e275e555190e4f9a6e4))
* add i18next and de, en, es, fr locale support ([#36](https://github.com/kNoAPP/MeshCore-WebAgent/issues/36)) ([43ef812](https://github.com/kNoAPP/MeshCore-WebAgent/commit/43ef812a478d3f3da20c71e59c5ef04e190fbe8c))
* add UI allowing users to share contacts ([#38](https://github.com/kNoAPP/MeshCore-WebAgent/issues/38)) ([f974c24](https://github.com/kNoAPP/MeshCore-WebAgent/commit/f974c2448b15bac94fec75682a1cad99553498da))
* auto-populate new contacts to contacts list ([#29](https://github.com/kNoAPP/MeshCore-WebAgent/issues/29)) ([6ae1b15](https://github.com/kNoAPP/MeshCore-WebAgent/commit/6ae1b157cd46de49537b6711de5299a95c5bf639))
* create light and dark themes ([#37](https://github.com/kNoAPP/MeshCore-WebAgent/issues/37)) ([3fb1103](https://github.com/kNoAPP/MeshCore-WebAgent/commit/3fb1103d7a44f8926416941775d60b67a4e15841))
* display acks, hops, and offer retries ([#26](https://github.com/kNoAPP/MeshCore-WebAgent/issues/26)) ([443ed70](https://github.com/kNoAPP/MeshCore-WebAgent/commit/443ed702376882849e4408c9e4d8813da9c95ea0))


### Bug Fixes

* improve sent mentions color readability ([#30](https://github.com/kNoAPP/MeshCore-WebAgent/issues/30)) ([7f20206](https://github.com/kNoAPP/MeshCore-WebAgent/commit/7f2020678f24822b1b21a22a2030c71c208b3786))

## [1.1.1](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.1.0...v1.1.1) (2026-06-11)


### Bug Fixes

* deploy new web artifact on release ([47d430e](https://github.com/kNoAPP/MeshCore-WebAgent/commit/47d430eac4821db5cbb1b21bbe71ab75b9964749))

## [1.1.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.0.0...v1.1.0) (2026-06-11)


### Features

* show companion synchronization UI when first connected ([#23](https://github.com/kNoAPP/MeshCore-WebAgent/issues/23)) ([8ebbdd3](https://github.com/kNoAPP/MeshCore-WebAgent/commit/8ebbdd31c5db169faf7d50e1b8fe781e86617eca))
* use IndexedDB over localStorage for message history ([#21](https://github.com/kNoAPP/MeshCore-WebAgent/issues/21)) ([c697f42](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c697f4200ddfb6004e1381ffafe8ab99df303c3c))

## [1.0.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.0.0...v1.0.0) (2026-06-10)


### Features

* cache bust the app on release ([#13](https://github.com/kNoAPP/MeshCore-WebAgent/issues/13)) ([fb92668](https://github.com/kNoAPP/MeshCore-WebAgent/commit/fb92668f5e4a4a2fda6a7a141eb94f94627b4bb1))
* initial commit ([0836a65](https://github.com/kNoAPP/MeshCore-WebAgent/commit/0836a65f91315678dd19757eecf183b7a159be12))


### Bug Fixes

* deploy release once created ([#15](https://github.com/kNoAPP/MeshCore-WebAgent/issues/15)) ([6c44a5b](https://github.com/kNoAPP/MeshCore-WebAgent/commit/6c44a5b3390073cf85ddf7d94f3875b1ea5de0b2))
* repair annoying release please ([#10](https://github.com/kNoAPP/MeshCore-WebAgent/issues/10)) ([1e173ef](https://github.com/kNoAPP/MeshCore-WebAgent/commit/1e173eff3e52bee99a0154942087158f9f3da626))
* repair first-pass items ([#3](https://github.com/kNoAPP/MeshCore-WebAgent/issues/3)) ([85c93a1](https://github.com/kNoAPP/MeshCore-WebAgent/commit/85c93a1982cdd31fe6f2108b9bd32d181095b9ad))
* repair initial issues ([#6](https://github.com/kNoAPP/MeshCore-WebAgent/issues/6)) ([8102022](https://github.com/kNoAPP/MeshCore-WebAgent/commit/8102022b8254878f84b9f93b39b784f8e6909977))
* repair release-please ([#8](https://github.com/kNoAPP/MeshCore-WebAgent/issues/8)) ([0e1d568](https://github.com/kNoAPP/MeshCore-WebAgent/commit/0e1d568a376cbb5ba92881e8d760a814f8e58fa0))
