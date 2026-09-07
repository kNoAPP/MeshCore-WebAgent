# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.22.2](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.22.1...v1.22.2) (2026-09-07)


### Bug Fixes

* **map:** add CARTO api key to basemap tile urls ([#215](https://github.com/kNoAPP/MeshCore-WebAgent/issues/215)) ([fbb1839](https://github.com/kNoAPP/MeshCore-WebAgent/commit/fbb18398bf2ec1cdfd24570a3486e95e47e3174a))

## [1.22.1](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.22.0...v1.22.1) (2026-09-06)


### Bug Fixes

* **channels:** identify public channel by secret and allow removal ([#210](https://github.com/kNoAPP/MeshCore-WebAgent/issues/210)) ([3117645](https://github.com/kNoAPP/MeshCore-WebAgent/commit/311764519f7b3029b2642173878550a36bf87834))

## [1.22.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.21.0...v1.22.0) (2026-08-09)


### Features

* add show/hide password toggle to repeater login ([#198](https://github.com/kNoAPP/MeshCore-WebAgent/issues/198)) ([9e4df29](https://github.com/kNoAPP/MeshCore-WebAgent/commit/9e4df297eb177b27ccb17635b62acc64fae7819b))


### Bug Fixes

* **client:** drain CHANNEL_DATA_RECV frames when polling messages ([#202](https://github.com/kNoAPP/MeshCore-WebAgent/issues/202)) ([935db2c](https://github.com/kNoAPP/MeshCore-WebAgent/commit/935db2cf3d53933402db5ad9900624a3e861d01f))
* **client:** prune deleted contacts and surface CONTACTS_FULL ([#201](https://github.com/kNoAPP/MeshCore-WebAgent/issues/201)) ([94cdd68](https://github.com/kNoAPP/MeshCore-WebAgent/commit/94cdd68e5f43141da2109459640003796abb4d53))

## [1.21.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.20.0...v1.21.0) (2026-08-09)


### Features

* **repeater:** add v1.17.0 cad and radio.fem.rxgain CLI settings ([#192](https://github.com/kNoAPP/MeshCore-WebAgent/issues/192)) ([1561060](https://github.com/kNoAPP/MeshCore-WebAgent/commit/1561060ee372c1185d08009013a73d112476d78a))

## [1.20.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.19.0...v1.20.0) (2026-07-17)


### Features

* **repeater:** add map-based neighbors tab ([#182](https://github.com/kNoAPP/MeshCore-WebAgent/issues/182)) ([3595a21](https://github.com/kNoAPP/MeshCore-WebAgent/commit/3595a21da456827928584d9a8e3247b2fdb931f6))
* **repeater:** add neighbors list and raw CLI console tabs ([#177](https://github.com/kNoAPP/MeshCore-WebAgent/issues/177)) ([7b3772f](https://github.com/kNoAPP/MeshCore-WebAgent/commit/7b3772f4b58525b8e363d9897fd95e676de93144))

## [1.19.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.18.0...v1.19.0) (2026-07-16)


### Features

* add repeater admin panel with login gate and status dashboard ([#175](https://github.com/kNoAPP/MeshCore-WebAgent/issues/175)) ([0c02c01](https://github.com/kNoAPP/MeshCore-WebAgent/commit/0c02c01f77d162e26dfb24593710308adeb78785))
* **protocol:** add client login, status, and CLI command methods ([#171](https://github.com/kNoAPP/MeshCore-WebAgent/issues/171)) ([3947a7c](https://github.com/kNoAPP/MeshCore-WebAgent/commit/3947a7c74acb5a2822b50cc15ef34ffd2492ab66))
* **protocol:** add login, status request, and CLI text type ([#170](https://github.com/kNoAPP/MeshCore-WebAgent/issues/170)) ([fb8ec13](https://github.com/kNoAPP/MeshCore-WebAgent/commit/fb8ec132bd9a3d011d18d16002fb3f2a41404b42))
* **repeater:** add config editor tab with structured get/set over CLI ([#176](https://github.com/kNoAPP/MeshCore-WebAgent/issues/176)) ([0888f2e](https://github.com/kNoAPP/MeshCore-WebAgent/commit/0888f2e88f07fbf0b310153e23e052d4abeff32b))
* **store:** add repeater admin-session slice and hook wiring ([#174](https://github.com/kNoAPP/MeshCore-WebAgent/issues/174)) ([e63c001](https://github.com/kNoAPP/MeshCore-WebAgent/commit/e63c00139a553cdac0420b6cb52620325055892a))


### Performance Improvements

* **ai:** cache anthropic prompt prefix and trim automation token spend ([#159](https://github.com/kNoAPP/MeshCore-WebAgent/issues/159)) ([95a1db9](https://github.com/kNoAPP/MeshCore-WebAgent/commit/95a1db9ac48b78ec82a95af05e3d9eaa45949c90))

## [1.18.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.17.0...v1.18.0) (2026-07-06)


### Features

* add display toggle for full public keys ([#155](https://github.com/kNoAPP/MeshCore-WebAgent/issues/155)) ([5ca018e](https://github.com/kNoAPP/MeshCore-WebAgent/commit/5ca018ed9c8945cb89722cfc64d7eb4a36994392))


### Bug Fixes

* **chat:** stop auto-scroll from disrupting history reading ([#157](https://github.com/kNoAPP/MeshCore-WebAgent/issues/157)) ([65a85dc](https://github.com/kNoAPP/MeshCore-WebAgent/commit/65a85dc2321ac0206b4bfb73e0dc730a0eb8ed45))

## [1.17.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.16.1...v1.17.0) (2026-07-05)


### Features

* add unit system setting and store preferences per-radio ([#154](https://github.com/kNoAPP/MeshCore-WebAgent/issues/154)) ([89bd16b](https://github.com/kNoAPP/MeshCore-WebAgent/commit/89bd16ba0c5fe129bcc6b5e1d5ebfd127ea35a01))
* cache heard adverts for map and discovery ([#153](https://github.com/kNoAPP/MeshCore-WebAgent/issues/153)) ([282a9e7](https://github.com/kNoAPP/MeshCore-WebAgent/commit/282a9e7b1b0a11826161aec2c446b43ef1a506b6))


### Bug Fixes

* **map:** refresh self info on location source switch ([#151](https://github.com/kNoAPP/MeshCore-WebAgent/issues/151)) ([e1277a8](https://github.com/kNoAPP/MeshCore-WebAgent/commit/e1277a8609f31f377bf0d7c7af73b0a9ba740ddf))

## [1.16.1](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.16.0...v1.16.1) (2026-07-05)


### Bug Fixes

* **settings:** back location source with gps custom var ([#149](https://github.com/kNoAPP/MeshCore-WebAgent/issues/149)) ([ed0995e](https://github.com/kNoAPP/MeshCore-WebAgent/commit/ed0995e8d4fb6453583247018995fccd65c68f72))

## [1.16.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.15.0...v1.16.0) (2026-07-05)


### Features

* add transport icons to connect tabs ([#144](https://github.com/kNoAPP/MeshCore-WebAgent/issues/144)) ([f1ffc52](https://github.com/kNoAPP/MeshCore-WebAgent/commit/f1ffc526ca9d1d20596265ca6a14538f6bf53055))
* **chat:** add last-unread divider to conversations ([#148](https://github.com/kNoAPP/MeshCore-WebAgent/issues/148)) ([12a1c44](https://github.com/kNoAPP/MeshCore-WebAgent/commit/12a1c442a0321b12e6bf48592a5077d106376976))
* make links in messages open in a new tab ([#146](https://github.com/kNoAPP/MeshCore-WebAgent/issues/146)) ([614af64](https://github.com/kNoAPP/MeshCore-WebAgent/commit/614af645d8f564b6ae10ce20bacf5e91397160d6))
* **settings:** add GPS and fixed location source controls ([#147](https://github.com/kNoAPP/MeshCore-WebAgent/issues/147)) ([b924b66](https://github.com/kNoAPP/MeshCore-WebAgent/commit/b924b66eeab89ce98d52341fefada8eada361002))

## [1.15.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.14.0...v1.15.0) (2026-07-04)


### Features

* **message:** show repeater path on hover over hop count ([#143](https://github.com/kNoAPP/MeshCore-WebAgent/issues/143)) ([4e59a2f](https://github.com/kNoAPP/MeshCore-WebAgent/commit/4e59a2fd0605a774c748974f5520fbf8c2af8872))


### Bug Fixes

* **client:** wait for BLE pairing before initial sync ([#141](https://github.com/kNoAPP/MeshCore-WebAgent/issues/141)) ([513cd5e](https://github.com/kNoAPP/MeshCore-WebAgent/commit/513cd5e03508fa3c8c361a92c098a9485e120c1e))

## [1.14.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.13.0...v1.14.0) (2026-07-04)


### Features

* **automation:** add per-rule cooldown timer ([#139](https://github.com/kNoAPP/MeshCore-WebAgent/issues/139)) ([4732703](https://github.com/kNoAPP/MeshCore-WebAgent/commit/473270354a302d41d1b43b4e224901512e763861))

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
