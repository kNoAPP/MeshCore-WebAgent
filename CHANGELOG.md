# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.35.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.34.0...v1.35.0) (2026-09-23)


### Features

* **ui:** brighten light-mode identity frames and add passphrase reveal ([#435](https://github.com/kNoAPP/MeshCore-WebAgent/issues/435)) ([9bb9ba7](https://github.com/kNoAPP/MeshCore-WebAgent/commit/9bb9ba720de220706c42bb3049824429e08cfbeb))
* **ui:** enter a recovery phrase one word per numbered box ([#434](https://github.com/kNoAPP/MeshCore-WebAgent/issues/434)) ([69fe5c2](https://github.com/kNoAPP/MeshCore-WebAgent/commit/69fe5c2338399f269f252174658901361577d22b))

## [1.34.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.33.1...v1.34.0) (2026-09-22)


### Features

* **storage:** key seed-born identities' records from the storage root ([#422](https://github.com/kNoAPP/MeshCore-WebAgent/issues/422)) ([c000bc0](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c000bc0f90a9e7b9b66557281ad4d48f45171677))
* **ui:** let the user delete an identity vault ([#417](https://github.com/kNoAPP/MeshCore-WebAgent/issues/417)) ([3f69a79](https://github.com/kNoAPP/MeshCore-WebAgent/commit/3f69a79a4a0a07da179a62dee0844ea5efe6b9e8))
* **ui:** let the user forget a remembered recovery phrase ([#418](https://github.com/kNoAPP/MeshCore-WebAgent/issues/418)) ([4fcb02a](https://github.com/kNoAPP/MeshCore-WebAgent/commit/4fcb02a821b714ea7e272b9cd7f2299e465b1c8e))


### Bug Fixes

* **identity:** clear the outgoing identity's data on a phrase restore ([#426](https://github.com/kNoAPP/MeshCore-WebAgent/issues/426)) ([afbb273](https://github.com/kNoAPP/MeshCore-WebAgent/commit/afbb273f8bc5244b5afff5d34060bbfaf8a5234a))
* **identity:** restore only the involved live flags on a refused switch ([#411](https://github.com/kNoAPP/MeshCore-WebAgent/issues/411)) ([324d0ee](https://github.com/kNoAPP/MeshCore-WebAgent/commit/324d0ee5d25177ccd51c2134fd41e54eb68d8926))
* **session:** clear another identity's data when a reconnect returns as it ([#429](https://github.com/kNoAPP/MeshCore-WebAgent/issues/429)) ([8efcd16](https://github.com/kNoAPP/MeshCore-WebAgent/commit/8efcd16babd00a02c06506a23da49860629a9f83))
* **session:** restart the session after a reboot the link survives ([#419](https://github.com/kNoAPP/MeshCore-WebAgent/issues/419)) ([0806437](https://github.com/kNoAPP/MeshCore-WebAgent/commit/08064370fbe92cce28a0702073734118f4022700))
* **ui:** name an unnamed persona in the unfinished-switch banner ([#430](https://github.com/kNoAPP/MeshCore-WebAgent/issues/430)) ([fe3085f](https://github.com/kNoAPP/MeshCore-WebAgent/commit/fe3085f80a8f59b612f8323282ecfa193ee9b53e))
* **ui:** stop telling a phrase-made identity it exists only in flash ([#428](https://github.com/kNoAPP/MeshCore-WebAgent/issues/428)) ([5601e17](https://github.com/kNoAPP/MeshCore-WebAgent/commit/5601e1759202943a289499e539a5c73db16abce4))

## [1.33.1](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.33.0...v1.33.1) (2026-09-22)


### Bug Fixes

* **identity:** clear the new-radio restore offer on every connect ([#392](https://github.com/kNoAPP/MeshCore-WebAgent/issues/392)) ([b0bccbc](https://github.com/kNoAPP/MeshCore-WebAgent/commit/b0bccbc25c27093877d3d26628f12d84d0944903))
* **sync:** nudge a stalled contact enumeration instead of dropping it ([#395](https://github.com/kNoAPP/MeshCore-WebAgent/issues/395)) ([f638a38](https://github.com/kNoAPP/MeshCore-WebAgent/commit/f638a3818929889ec152bf996812ea0c594805cb))
* **sync:** retract the incomplete-contacts warning once a sync completes ([#397](https://github.com/kNoAPP/MeshCore-WebAgent/issues/397)) ([3e7e21d](https://github.com/kNoAPP/MeshCore-WebAgent/commit/3e7e21d5e573bbcc1c1283fc143a8401bd11352c))

## [1.33.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.32.0...v1.33.0) (2026-09-22)


### Features

* **identity:** add a passphrase-sealed identity vault ([#378](https://github.com/kNoAPP/MeshCore-WebAgent/issues/378)) ([f57570b](https://github.com/kNoAPP/MeshCore-WebAgent/commit/f57570b8ba66586e073e7119c993d64d517a9427))
* **identity:** add BIP-39 and seed-to-Ed25519 derivation core ([#375](https://github.com/kNoAPP/MeshCore-WebAgent/issues/375)) ([1496a83](https://github.com/kNoAPP/MeshCore-WebAgent/commit/1496a831a436307ca47762aab7f02d54be63dc18))
* **identity:** add burner personas with zero persistence ([#389](https://github.com/kNoAPP/MeshCore-WebAgent/issues/389)) ([39b52e1](https://github.com/kNoAPP/MeshCore-WebAgent/commit/39b52e11773ffdcae9a4ba436cee0880c17de703))
* **identity:** add SLIP-0010 hardened sub-identity derivation ([#376](https://github.com/kNoAPP/MeshCore-WebAgent/issues/376)) ([72409fd](https://github.com/kNoAPP/MeshCore-WebAgent/commit/72409fd297da4aa84dc06e9dfec1f7b3b2235bc2))
* **identity:** add the per-persona radio-state blob with capture and apply ([#383](https://github.com/kNoAPP/MeshCore-WebAgent/issues/383)) ([eac93b5](https://github.com/kNoAPP/MeshCore-WebAgent/commit/eac93b5ef8b088eba50a52031d1a77d6ea4d6d09))
* **identity:** derive the storage root from the seed ([#377](https://github.com/kNoAPP/MeshCore-WebAgent/issues/377)) ([c7e541f](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c7e541f8153b572dab77b46021f2a2d0afde066e))
* **protocol:** probe private-key export capability on first use ([#374](https://github.com/kNoAPP/MeshCore-WebAgent/issues/374)) ([c2b64ea](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c2b64ea0fd9d0ce3e10f4d089a84f02100c043d6))
* **ui:** add a regenerate-identity-under-a-recovery-phrase wizard ([#379](https://github.com/kNoAPP/MeshCore-WebAgent/issues/379)) ([033be89](https://github.com/kNoAPP/MeshCore-WebAgent/commit/033be8931f34cbbe1d776e170b419147e91e0919))
* **ui:** add restore-identity-from-recovery-phrase ([#380](https://github.com/kNoAPP/MeshCore-WebAgent/issues/380)) ([0da05c9](https://github.com/kNoAPP/MeshCore-WebAgent/commit/0da05c9124310ca43bd4cedc2c98c6fa014aee87))
* **ui:** add the identity list and persona switch ceremony ([#385](https://github.com/kNoAPP/MeshCore-WebAgent/issues/385)) ([e7c6d70](https://github.com/kNoAPP/MeshCore-WebAgent/commit/e7c6d706dbeefdefde44ee638ef9743623d5e97f))
* **ui:** frame the live identity in its own accent color ([#386](https://github.com/kNoAPP/MeshCore-WebAgent/issues/386)) ([d253475](https://github.com/kNoAPP/MeshCore-WebAgent/commit/d253475d69dfca9e7d4b97bbe5aea990916e2953))


### Bug Fixes

* **identity:** save a persona switch's contacts before restarting the radio ([#388](https://github.com/kNoAPP/MeshCore-WebAgent/issues/388)) ([a7a55fa](https://github.com/kNoAPP/MeshCore-WebAgent/commit/a7a55fa5b81b66903ee5a4a99ad5dfb5e2621b17))
* **identity:** switch location sharing off for a newly minted persona ([#391](https://github.com/kNoAPP/MeshCore-WebAgent/issues/391)) ([cea83e4](https://github.com/kNoAPP/MeshCore-WebAgent/commit/cea83e431a9474bb863f5314dad3104c86b6bc7d))
* **protocol:** refresh selfInfo after an identity import ([#381](https://github.com/kNoAPP/MeshCore-WebAgent/issues/381)) ([e43de03](https://github.com/kNoAPP/MeshCore-WebAgent/commit/e43de0320fad99e612f6605526d42731db26be98))
* **state:** keep an unsaved backup restore across the next hydrate ([#373](https://github.com/kNoAPP/MeshCore-WebAgent/issues/373)) ([53ee466](https://github.com/kNoAPP/MeshCore-WebAgent/commit/53ee4668371e320474f8dc2a11d7fcb7d816a1d2))
* **storage:** persist a restored backup under the incoming identity ([#369](https://github.com/kNoAPP/MeshCore-WebAgent/issues/369)) ([897dc20](https://github.com/kNoAPP/MeshCore-WebAgent/commit/897dc20cec78f87c4e4d4bc173612dd87c0e547b))
* **storage:** re-key per-radio data when the channel set changes ([#384](https://github.com/kNoAPP/MeshCore-WebAgent/issues/384)) ([827ee63](https://github.com/kNoAPP/MeshCore-WebAgent/commit/827ee633d75b7e5178c1874b622c9cb87ef4dc48))

## [1.32.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.31.0...v1.32.0) (2026-09-21)


### Features

* **ui:** add a bottom action bar with a dismissable notification drawer ([#348](https://github.com/kNoAPP/MeshCore-WebAgent/issues/348)) ([c6cb35b](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c6cb35b4ff06544bd67dfc1856c543ad9790d8d5))
* **ui:** show the latest inbound message in the action bar as a live quick link ([#349](https://github.com/kNoAPP/MeshCore-WebAgent/issues/349)) ([4e58ac8](https://github.com/kNoAPP/MeshCore-WebAgent/commit/4e58ac84e20153d15c7e891310de70759576cca8))


### Bug Fixes

* **nodes:** split clock skew from last heard and normalize node ages ([#346](https://github.com/kNoAPP/MeshCore-WebAgent/issues/346)) ([49be086](https://github.com/kNoAPP/MeshCore-WebAgent/commit/49be086b6b3022ee80e79ffff9d75f9aff433fcf))
* **sync:** surface and quiet the post-connect message backlog drain ([#350](https://github.com/kNoAPP/MeshCore-WebAgent/issues/350)) ([c05be8d](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c05be8d0be3882a9f9be5da159a1f736171a088e))

## [1.31.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.30.0...v1.31.0) (2026-09-19)


### Features

* **backup:** add encrypted backup and restore for radio data and identity ([#331](https://github.com/kNoAPP/MeshCore-WebAgent/issues/331)) ([ee4176c](https://github.com/kNoAPP/MeshCore-WebAgent/commit/ee4176c6013cbbc4ecb72deff4ec082df84a2dde))
* **protocol:** read neighbors and access lists over binary requests ([#334](https://github.com/kNoAPP/MeshCore-WebAgent/issues/334)) ([19be93f](https://github.com/kNoAPP/MeshCore-WebAgent/commit/19be93f65d21bd9ca0a48fd76a1917c97ad5299e))
* **repeater:** retry a timed-out sign-in and never strand a saved credential ([#336](https://github.com/kNoAPP/MeshCore-WebAgent/issues/336)) ([99495ea](https://github.com/kNoAPP/MeshCore-WebAgent/commit/99495ea7b0159bd38eedaea962c296bec11ebc04))


### Bug Fixes

* **session:** bind the per-radio storage key before reporting connected ([#338](https://github.com/kNoAPP/MeshCore-WebAgent/issues/338)) ([89ca6a8](https://github.com/kNoAPP/MeshCore-WebAgent/commit/89ca6a8b5e6605381c736db969aa84963b703e0f))

## [1.30.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.29.0...v1.30.0) (2026-09-17)


### Features

* **map:** cluster and label markers, and make a node findable ([#322](https://github.com/kNoAPP/MeshCore-WebAgent/issues/322)) ([3940e3d](https://github.com/kNoAPP/MeshCore-WebAgent/commit/3940e3d1b7d2a4dc7d4d4bd218c1b1e06d823e54))
* **nodes:** add a Nodes directory over contacts and heard adverts ([#328](https://github.com/kNoAPP/MeshCore-WebAgent/issues/328)) ([c350716](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c35071634dbf551859535507b4397361fb4c252d))
* **ui:** give the command palette an actions group ([#320](https://github.com/kNoAPP/MeshCore-WebAgent/issues/320)) ([cb0da41](https://github.com/kNoAPP/MeshCore-WebAgent/commit/cb0da41a03d1b12cf77add5b7bdb428822ae2e5c))


### Bug Fixes

* **map:** declutter node name labels in pixel space ([#327](https://github.com/kNoAPP/MeshCore-WebAgent/issues/327)) ([d575eba](https://github.com/kNoAPP/MeshCore-WebAgent/commit/d575ebada69e8d3830b3c10113b822856337425d))
* **repeater:** budget CLI replies for the whole exchange, not an ACK ([#326](https://github.com/kNoAPP/MeshCore-WebAgent/issues/326)) ([1331674](https://github.com/kNoAPP/MeshCore-WebAgent/commit/13316749ff057684036b87f2daf17d393715ce7a))

## [1.29.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.28.0...v1.29.0) (2026-09-16)


### Features

* **map:** open a marker popup instead of the full-screen modal ([#314](https://github.com/kNoAPP/MeshCore-WebAgent/issues/314)) ([a3fc428](https://github.com/kNoAPP/MeshCore-WebAgent/commit/a3fc4281f5886152220f9d4e6a7fb196fa9b7adf))
* **protocol:** support node telemetry requests ([#318](https://github.com/kNoAPP/MeshCore-WebAgent/issues/318)) ([f005138](https://github.com/kNoAPP/MeshCore-WebAgent/commit/f005138cd45b0c506b33ad662ec39d36dc2b3b4b))
* **ui:** give the repeater console history, completion, help and guards ([#317](https://github.com/kNoAPP/MeshCore-WebAgent/issues/317)) ([f6bf5e3](https://github.com/kNoAPP/MeshCore-WebAgent/commit/f6bf5e325a4cf68c59bae7e2ae5ac0382bed900e))
* **ui:** notify for background DMs and mentions ([#319](https://github.com/kNoAPP/MeshCore-WebAgent/issues/319)) ([5d28005](https://github.com/kNoAPP/MeshCore-WebAgent/commit/5d280058c24094570aa85a90b824f0e8341a4fb0))

## [1.28.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.27.0...v1.28.0) (2026-09-15)


### Features

* **repeater:** map every neighbor, not just the located ones ([#306](https://github.com/kNoAPP/MeshCore-WebAgent/issues/306)) ([440b3ec](https://github.com/kNoAPP/MeshCore-WebAgent/commit/440b3ec6350bd8657f0f57592738072fd0c3a476))
* **stats:** derive duty cycle and error rates from the raw counters ([#307](https://github.com/kNoAPP/MeshCore-WebAgent/issues/307)) ([d72a0a9](https://github.com/kNoAPP/MeshCore-WebAgent/commit/d72a0a9e3357484c467dbe93c382945bd54fdde6))


### Bug Fixes

* **format:** report clock-skewed advert timestamps as their own state ([#303](https://github.com/kNoAPP/MeshCore-WebAgent/issues/303)) ([9b1d193](https://github.com/kNoAPP/MeshCore-WebAgent/commit/9b1d1936ece400701d33314264f93fe4a36708a8))
* **map:** declutter permanent edge labels instead of stacking them ([#305](https://github.com/kNoAPP/MeshCore-WebAgent/issues/305)) ([c77cb18](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c77cb189a4e0bc4085ca496198618f6f55b6d057))
* **map:** document the favorite ring in the map legend ([#304](https://github.com/kNoAPP/MeshCore-WebAgent/issues/304)) ([6ebb5f5](https://github.com/kNoAPP/MeshCore-WebAgent/commit/6ebb5f5801b10b2b7773270bf1cfe0444baf6806))

## [1.27.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.26.0...v1.27.0) (2026-09-14)


### Features

* **room:** support room server posts (read and publish) ([#285](https://github.com/kNoAPP/MeshCore-WebAgent/issues/285)) ([008d626](https://github.com/kNoAPP/MeshCore-WebAgent/commit/008d626033bdb12b3c47d2a3499486f4f383b19d))


### Bug Fixes

* **room:** land a room feed on its unread boundary, not the newest post ([#287](https://github.com/kNoAPP/MeshCore-WebAgent/issues/287)) ([8dc47de](https://github.com/kNoAPP/MeshCore-WebAgent/commit/8dc47dec98f715a1c33292ae8917c40234bd4d15))

## [1.26.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.25.0...v1.26.0) (2026-09-13)


### Features

* **chat:** retry direct messages automatically with shared route recovery ([#282](https://github.com/kNoAPP/MeshCore-WebAgent/issues/282)) ([3aa0bd7](https://github.com/kNoAPP/MeshCore-WebAgent/commit/3aa0bd77b3a683034aed5c1af02f2b066bee0045))

## [1.25.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.24.0...v1.25.0) (2026-09-12)


### Features

* **chat:** cap the reading measure and group consecutive messages ([#277](https://github.com/kNoAPP/MeshCore-WebAgent/issues/277)) ([4edb658](https://github.com/kNoAPP/MeshCore-WebAgent/commit/4edb65889b1339e7f4bca63536711c235002a30e))
* **map:** theme the markers and swap the modal for an on-map popup ([#276](https://github.com/kNoAPP/MeshCore-WebAgent/issues/276)) ([bfd1fbc](https://github.com/kNoAPP/MeshCore-WebAgent/commit/bfd1fbc0c8325c03baaea695a42f99b0f8e209fa))
* **repeater:** tell a failed read from an unread one and type exact values ([#278](https://github.com/kNoAPP/MeshCore-WebAgent/issues/278)) ([77356d0](https://github.com/kNoAPP/MeshCore-WebAgent/commit/77356d076fcb5b180f9ba66a69b564ee32421b2a))
* **sidebar:** add a contact filter, resizable persisted layout, and empty states ([#274](https://github.com/kNoAPP/MeshCore-WebAgent/issues/274)) ([4cec7c4](https://github.com/kNoAPP/MeshCore-WebAgent/commit/4cec7c4a6014d758af41eba2d05270075dcb0f82))


### Bug Fixes

* **a11y:** announce async status with live regions ([#272](https://github.com/kNoAPP/MeshCore-WebAgent/issues/272)) ([d8f0bcf](https://github.com/kNoAPP/MeshCore-WebAgent/commit/d8f0bcf1135632ab2ad387b2bb623e287a44cf05))
* **chat:** scope unread and new-message toasts to what is on screen ([#273](https://github.com/kNoAPP/MeshCore-WebAgent/issues/273)) ([c39a785](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c39a785ca1847ce113f075e4e20384e162c48abc))
* **settings:** give every write one save contract ([#279](https://github.com/kNoAPP/MeshCore-WebAgent/issues/279)) ([c8c6a3d](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c8c6a3dae6bf55687be62479e2bcf2eca8859968))

## [1.24.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.23.0...v1.24.0) (2026-09-10)


### Features

* **connect:** reopen granted USB ports without the chooser ([#265](https://github.com/kNoAPP/MeshCore-WebAgent/issues/265)) ([ffc1565](https://github.com/kNoAPP/MeshCore-WebAgent/commit/ffc1565e19b833866cf4e0bf2b5aedcd08cf8c6f))
* **settings:** widen settings and add a section rail ([#269](https://github.com/kNoAPP/MeshCore-WebAgent/issues/269)) ([ae2862b](https://github.com/kNoAPP/MeshCore-WebAgent/commit/ae2862b49b55213a42d3dd63969af94f5315e968))


### Bug Fixes

* **a11y:** give composite widgets real roles and keyboard models ([#270](https://github.com/kNoAPP/MeshCore-WebAgent/issues/270)) ([364079b](https://github.com/kNoAPP/MeshCore-WebAgent/commit/364079bf064b7fbbf87103eb6a8247f2ced8d021))
* **automation:** confirm before deleting a rule or clearing the audit log ([#267](https://github.com/kNoAPP/MeshCore-WebAgent/issues/267)) ([dc952de](https://github.com/kNoAPP/MeshCore-WebAgent/commit/dc952de74edf80b38a9adaa151a071c560a8bcee))


### Performance Improvements

* **chat:** scope store subscriptions and window the message list ([#268](https://github.com/kNoAPP/MeshCore-WebAgent/issues/268)) ([cdc96dc](https://github.com/kNoAPP/MeshCore-WebAgent/commit/cdc96dca5c16533238c35da95e66a301fb6e3a65))

## [1.23.0](https://github.com/kNoAPP/MeshCore-WebAgent/compare/v1.22.2...v1.23.0) (2026-09-09)


### Features

* **ui:** reflect app state in the URL and the document title ([#263](https://github.com/kNoAPP/MeshCore-WebAgent/issues/263)) ([aa451cb](https://github.com/kNoAPP/MeshCore-WebAgent/commit/aa451cb0ee8ac05c7446f367a235d46e5cda889c))


### Bug Fixes

* **a11y:** add a visible keyboard focus indicator app-wide ([#247](https://github.com/kNoAPP/MeshCore-WebAgent/issues/247)) ([22f6eee](https://github.com/kNoAPP/MeshCore-WebAgent/commit/22f6eeed5898efcc4de57bc490b93292293a198b))
* **a11y:** add main landmark and skip link ([#254](https://github.com/kNoAPP/MeshCore-WebAgent/issues/254)) ([9ef5dcc](https://github.com/kNoAPP/MeshCore-WebAgent/commit/9ef5dcc5961259471bf3fea3dcfba9f51fda50c5))
* **a11y:** declare color-scheme and set html lang pre-paint ([#259](https://github.com/kNoAPP/MeshCore-WebAgent/issues/259)) ([0dc9c70](https://github.com/kNoAPP/MeshCore-WebAgent/commit/0dc9c7005608d6e4eaaab0a61d2af09f775e6ba5))
* **a11y:** give modals dialog semantics, escape, and focus management ([#262](https://github.com/kNoAPP/MeshCore-WebAgent/issues/262)) ([b960ba5](https://github.com/kNoAPP/MeshCore-WebAgent/commit/b960ba5dc0c9f08562730b258697594d86d55202))
* **chat:** free the composer as soon as a message is queued ([#260](https://github.com/kNoAPP/MeshCore-WebAgent/issues/260)) ([9a08dbb](https://github.com/kNoAPP/MeshCore-WebAgent/commit/9a08dbbdfcf7c42676c8af77cf3197028363a1bf))
* **chat:** make the composer and mention list accessible ([#248](https://github.com/kNoAPP/MeshCore-WebAgent/issues/248)) ([9d212f6](https://github.com/kNoAPP/MeshCore-WebAgent/commit/9d212f61a810782ca703b5c63b050082aef42b1a))
* **chat:** reserve the channel sender prefix in the byte budget ([#257](https://github.com/kNoAPP/MeshCore-WebAgent/issues/257)) ([2968bd3](https://github.com/kNoAPP/MeshCore-WebAgent/commit/2968bd3bbe2fa2164d379e263ae005cd0b56d2d5))
* **chat:** scope the composer draft to its conversation ([#255](https://github.com/kNoAPP/MeshCore-WebAgent/issues/255)) ([c37a366](https://github.com/kNoAPP/MeshCore-WebAgent/commit/c37a36630b06143be110d84ab5eb89dff77d83e0))
* **connect:** keep the lost radio on the connect screen after give-up ([#261](https://github.com/kNoAPP/MeshCore-WebAgent/issues/261)) ([009d81f](https://github.com/kNoAPP/MeshCore-WebAgent/commit/009d81fe08c32333306d9faa8f8eb9ed13e0ab63))
* **connect:** stop reporting a cancelled device picker as an error ([#245](https://github.com/kNoAPP/MeshCore-WebAgent/issues/245)) ([7bea98b](https://github.com/kNoAPP/MeshCore-WebAgent/commit/7bea98babcbd79bb719bf0c6d91bd9d6be78a9c2))
* **header:** degrade the header instead of wrapping at 1280 and 1366 ([#246](https://github.com/kNoAPP/MeshCore-WebAgent/issues/246)) ([6cd0293](https://github.com/kNoAPP/MeshCore-WebAgent/commit/6cd02934be2e245fb67a9be112f0812892b275cc))
* **repeater:** surface repeater CLI timeouts instead of faking success ([#258](https://github.com/kNoAPP/MeshCore-WebAgent/issues/258)) ([a3bb9cb](https://github.com/kNoAPP/MeshCore-WebAgent/commit/a3bb9cb3e3fdbb23ecaf1427ef9b101aafb6bb70))
* **theme:** meet WCAG AA contrast in both themes ([#264](https://github.com/kNoAPP/MeshCore-WebAgent/issues/264)) ([7823982](https://github.com/kNoAPP/MeshCore-WebAgent/commit/78239826bd1582697d1f116191d2aec4a5410393))
* **ui:** prompt before reloading a live session on a new deploy ([#256](https://github.com/kNoAPP/MeshCore-WebAgent/issues/256)) ([23ccd8b](https://github.com/kNoAPP/MeshCore-WebAgent/commit/23ccd8bc42f04a2ca554398a1b8647fb2a9c6d30))

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
