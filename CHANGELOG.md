## [0.9.3](https://github.com/claygorman/bazzite-native-store/compare/0.9.2...0.9.3) (2026-08-23)


### Bug Fixes

* a broken portal probe silenced the out-of-date notice entirely ([8c2881f](https://github.com/claygorman/bazzite-native-store/commit/8c2881fca1dacf9d9718e64bb55321955f88c25d))
* one 429 blanked the account chip permanently ([7301b5d](https://github.com/claygorman/bazzite-native-store/commit/7301b5d241a215c1c01dda29323da0ebbed3611a))

## [0.9.2](https://github.com/claygorman/bazzite-native-store/compare/0.9.1...0.9.2) (2026-08-23)


### Bug Fixes

* assert the static deltas survive, because losing them is silent ([c30523a](https://github.com/claygorman/bazzite-native-store/commit/c30523a94ccbdfa9b78c8b77c429d343c7489001))

## [0.9.1](https://github.com/claygorman/bazzite-native-store/compare/0.9.0...0.9.1) (2026-08-23)


### Bug Fixes

* git dropped the ostree repo's empty directories, so 0.9.0 never built ([cbf2707](https://github.com/claygorman/bazzite-native-store/commit/cbf2707ecd1a941d3c6315f9c9dfc0148f7c243d)), closes [#pages](https://github.com/claygorman/bazzite-native-store/issues/pages)

# [0.9.0](https://github.com/claygorman/bazzite-native-store/compare/0.8.0...0.9.0) (2026-08-23)


### Bug Fixes

* the metainfo version was never committed, so every Flatpak shipped 0.5.2 ([bab955d](https://github.com/claygorman/bazzite-native-store/commit/bab955dc61eebbb04ffe69bff54eb8b39df9f1d3))


### Features

* notice a new version within fifteen minutes, without being told ([c3e9fcd](https://github.com/claygorman/bazzite-native-store/commit/c3e9fcd0fb8903130ca92e550e2c68e9461eea47))

# [0.8.0](https://github.com/claygorman/bazzite-native-store/compare/0.7.0...0.8.0) (2026-08-23)


### Bug Fixes

* Reviews & More is two columns, so left and right now mean columns ([79b3043](https://github.com/claygorman/bazzite-native-store/commit/79b3043a7f03b3d7d0fd18c8a713d8768f7b0215))


### Features

* the Flatpak updates itself, and only itself ([ead814b](https://github.com/claygorman/bazzite-native-store/commit/ead814baf883e098fc4b069a0eac9534de838aeb)), closes [#pages](https://github.com/claygorman/bazzite-native-store/issues/pages)

# [0.7.0](https://github.com/claygorman/bazzite-native-store/compare/0.6.1...0.7.0) (2026-08-23)


### Bug Fixes

* four tag results per row, with the Proton tier they always could have had ([d8d1c6b](https://github.com/claygorman/bazzite-native-store/commit/d8d1c6bfd5936eec99aa268fb54417dd9c6d30b6))
* the calendar heading missed the page's side margin ([23994a6](https://github.com/claygorman/bazzite-native-store/commit/23994a6997b8d97763d0107c298b32fadfd2765d))
* the offers band lifted OVER the hero instead of into it ([5620fcc](https://github.com/claygorman/bazzite-native-store/commit/5620fcccfbf496e3c93fcfaf0af81ddfa751a2de))


### Features

* the store knows who you are, because Steam already does ([cc7d9ef](https://github.com/claygorman/bazzite-native-store/commit/cc7d9ef8ff4a32daffe4d89390598569b9dd16be))

## [0.6.1](https://github.com/claygorman/bazzite-native-store/compare/0.6.0...0.6.1) (2026-08-23)


### Bug Fixes

* appdetails had never once worked in the Tauri build ([9063853](https://github.com/claygorman/bazzite-native-store/commit/90638538781676e09a5ba34a5e2bd7ce1518bbf6))
* build the Flatpak from the release commit, and correct the record ([e850c29](https://github.com/claygorman/bazzite-native-store/commit/e850c29a52463a2548cdfcf50668dd53729cb988))
* the app was rate-limiting itself, then blaming the game ([a0ba181](https://github.com/claygorman/bazzite-native-store/commit/a0ba18147f3271567c8711993032c937212e61c3))
* the only reachable sign-in control said "Sign out" ([f73a621](https://github.com/claygorman/bazzite-native-store/commit/f73a62177c2c5c2b0093de388e414c76dca18bc8))


### Performance Improvements

* cache like a store, not like a live website ([cd2b5f7](https://github.com/claygorman/bazzite-native-store/commit/cd2b5f778af3604b05373511f1bc212e71e4b9db))
* never ask again inside the origin's own freshness window ([173ef88](https://github.com/claygorman/bazzite-native-store/commit/173ef889fd5e132b77e9277f9ba29d4e21eb8f6d))
* the microtrailer rides the batch that was already happening ([bb3334e](https://github.com/claygorman/bazzite-native-store/commit/bb3334e36bf3ca52578c45f32ebdcff7d6ef5040))

# [0.6.0](https://github.com/claygorman/bazzite-native-store/compare/0.5.2...0.6.0) (2026-08-23)


### Bug Fixes

* log the requests that succeed and answer nothing ([d2e6d00](https://github.com/claygorman/bazzite-native-store/commit/d2e6d0094449ac09b3232d331e6ec7267e1a5199))
* stop driving the store while Steam's menu is over it ([234f580](https://github.com/claygorman/bazzite-native-store/commit/234f5802e534cf7d140bef1dc6d313b1d4a84b17))
* the metainfo version was a fourth version file nobody synced ([7b32627](https://github.com/claygorman/bazzite-native-store/commit/7b32627a8fe551e657df9ecec2e715ef9e8c8182))
* the page showed one game's name over another game's facts ([b8db2ca](https://github.com/claygorman/bazzite-native-store/commit/b8db2cadb7cb1f2b294b98abee3b184697198e4d))


### Features

* a debug log you can actually read over SSH ([92cf58d](https://github.com/claygorman/bazzite-native-store/commit/92cf58df208c21c54eb62fdeadd5a276da2ab7dd))
* debug state and a loopback control channel ([1ce7e6d](https://github.com/claygorman/bazzite-native-store/commit/1ce7e6d5d928367a8a66b88151c8adcfa9e38755))
* the F2 HUD says which game the page thinks it is ([d00076b](https://github.com/claygorman/bazzite-native-store/commit/d00076b4f766764ea9dfeb29df2f159949515be4))

## [0.5.2](https://github.com/claygorman/bazzite-native-store/compare/0.5.1...0.5.2) (2026-08-23)


### Bug Fixes

* a failed install must never be an uninstall ([59840d5](https://github.com/claygorman/bazzite-native-store/commit/59840d5707cbefdfd0eff30bef986eca31cb5bac))

## [0.5.1](https://github.com/claygorman/bazzite-native-store/compare/0.5.0...0.5.1) (2026-08-23)


### Bug Fixes

* a release guard that rejected a correct build ([3fb0b1e](https://github.com/claygorman/bazzite-native-store/commit/3fb0b1ebf7f34119ed7be1aa359816070209492c))

# [0.5.0](https://github.com/claygorman/bazzite-native-store/compare/0.4.1...0.5.0) (2026-08-23)


### Bug Fixes

* verify the Windows installer too, and correct the EGL record ([68d0eca](https://github.com/claygorman/bazzite-native-store/commit/68d0eca8b04e2b8b1e6f264c7a5272d5a3e5a3a7))


### Features

* ship Linux as a Flatpak ([0921419](https://github.com/claygorman/bazzite-native-store/commit/0921419cc05d2e3c37fd2856791efec7251952d8))

## [0.4.1](https://github.com/claygorman/bazzite-native-store/compare/0.4.0...0.4.1) (2026-08-23)


### Bug Fixes

* ship the app, not the indexer ([d2690f6](https://github.com/claygorman/bazzite-native-store/commit/d2690f60ff0beb824823118e8396f22fbf7d7f01))

# [0.4.0](https://github.com/claygorman/bazzite-native-store/compare/0.3.1...0.4.0) (2026-08-23)


### Bug Fixes

* a keyboard prompt is a pill, not a circle, and cannot take size-* ([4722a59](https://github.com/claygorman/bazzite-native-store/commit/4722a596ff4838949500a709de2560ac31b48a1e))
* an AppImage whose WebKit can actually see the GPU ([02cbf4c](https://github.com/claygorman/bazzite-native-store/commit/02cbf4c99080bac2c544dda0f4d485709b97e265))
* carry the page margin on the clip box, not on its parent ([30d3407](https://github.com/claygorman/bazzite-native-store/commit/30d340721f0c2e59c607ec53a8ebfb3fffd8f37f))
* no free Intel mac runner exists, so build a universal binary instead ([dca6ff2](https://github.com/claygorman/bazzite-native-store/commit/dca6ff254b86612adedd93528b3e31cdba15ec5c))
* the settings rail was half the width the artboard specifies ([52824d4](https://github.com/claygorman/bazzite-native-store/commit/52824d42030a94b110ad12b8c706d25396f9dc8d))
* the Storage page cannot download anything, so stop calling it Downloads ([4de2d28](https://github.com/claygorman/bazzite-native-store/commit/4de2d28a0aa341ea2149a98f29a4800af9529623))


### Features

* a ProtonDB tab, and bundles you can walk into ([7e2d6b0](https://github.com/claygorman/bazzite-native-store/commit/7e2d6b0e5bed3ed4dd02e9aebca6f520ad23bbb5))
* index ProtonDB's open report dump for per-game lookups ([62fe907](https://github.com/claygorman/bazzite-native-store/commit/62fe907e40e9d1b0c0f3a542f6ce5a928f688b87))
* keep the questionnaire answers, so a tier reconstruction can be tested ([92b3b77](https://github.com/claygorman/bazzite-native-store/commit/92b3b77ddecc662f1192c82b4ca4286cd8223246))
* sanitise and bound the ProtonDB dump, and check GitHub without downloading ([c60cf7a](https://github.com/claygorman/bazzite-native-store/commit/c60cf7a7e71674f77d9df0e0cd4ae5f18282a447))
* settings steppers become real dropdowns ([bdc175a](https://github.com/claygorman/bazzite-native-store/commit/bdc175aee5ff194b52cc62ba11f29e252a31f50d))
* stream the ProtonDB download so its progress is real ([9831494](https://github.com/claygorman/bazzite-native-store/commit/983149455ae6d62aff95457ea355492c80bc90da))
* the ProtonDB opt-in, as turn 13a's six states ([097abab](https://github.com/claygorman/bazzite-native-store/commit/097ababb9770e43fffc9a79512071a44321caefe))
* the shelf tile becomes a plate that lights up ([b57d789](https://github.com/claygorman/bazzite-native-store/commit/b57d789df119e16a9cc568be3ff3b496dff36cd1))
* what people ran a tag under, beside what Valve verified ([904cf14](https://github.com/claygorman/bazzite-native-store/commit/904cf14c138e37e03efd496104188f49c36b947a))


### Performance Improvements

* stream the dump instead of building a DOM, and make the indexer standalone ([301eaed](https://github.com/claygorman/bazzite-native-store/commit/301eaed49c90bd95802e9246ee232d5268f15925))

## [0.3.1](https://github.com/claygorman/bazzite-native-store/compare/0.3.0...0.3.1) (2026-08-22)


### Bug Fixes

* Windows had the same v1/v2 trap, and the two Macs were overwriting each other ([27326e8](https://github.com/claygorman/bazzite-native-store/commit/27326e8dd794c5603fa086fed907b9a536ea2e73))

# [0.3.0](https://github.com/claygorman/bazzite-native-store/compare/0.2.0...0.3.0) (2026-08-22)


### Features

* automatic updates actually download, and the installer is the CLI updater ([5650a0c](https://github.com/claygorman/bazzite-native-store/commit/5650a0c62887666fd32163b8d25968b84dfec6cd))
* builds for macOS and Windows, and an installer that says what it takes ([1418028](https://github.com/claygorman/bazzite-native-store/commit/1418028217f3c9387d9ffc7b8f19b26397abcf95))

# [0.2.0](https://github.com/claygorman/bazzite-native-store/compare/0.1.0...0.2.0) (2026-08-22)


### Bug Fixes

* **ci:** pin pnpm via packageManager so action-setup can find it ([fe49a96](https://github.com/claygorman/bazzite-native-store/commit/fe49a966933bef38f1cd38e75a2fd18f1af1dfd8))


### Features

* one-line installer, and make the Steam config path platform-aware ([067f4d7](https://github.com/claygorman/bazzite-native-store/commit/067f4d796d7f496e13e0133b8e995ad3e908baa7))
* **updater:** install the signing public key ([53eccb7](https://github.com/claygorman/bazzite-native-store/commit/53eccb70e84f835f7c358d9f7db0ebabe485af22))
