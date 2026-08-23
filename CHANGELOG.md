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
