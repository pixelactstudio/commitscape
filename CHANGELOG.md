# Changelog

## [0.3.0](https://github.com/pixelactstudio/commitscape/compare/v0.2.1...v0.3.0) (2026-10-09)


### ⚠ BREAKING CHANGES

* share from the CLI, drop the terminal interface, keep commits in Postgres ([#29](https://github.com/pixelactstudio/commitscape/issues/29))

### Features

* share from the CLI, drop the terminal interface, keep commits in Postgres ([#29](https://github.com/pixelactstudio/commitscape/issues/29)) ([d8658a2](https://github.com/pixelactstudio/commitscape/commit/d8658a286d9db64657644b10bec897329221371f))

## [0.2.1](https://github.com/pixelactstudio/commitscape/compare/v0.2.0...v0.2.1) (2026-10-07)


### Fixes

* **site:** ship React with the server so the image starts ([#27](https://github.com/pixelactstudio/commitscape/issues/27)) ([e903940](https://github.com/pixelactstudio/commitscape/commit/e903940eb8bef0331f00efa604bb96091529bd01))

## [0.2.0](https://github.com/pixelactstudio/commitscape/compare/v0.1.1...v0.2.0) (2026-10-06)


### Features

* **phase-33:** rebuild the Site UI and add people insights ([#23](https://github.com/pixelactstudio/commitscape/issues/23)) ([212ee2b](https://github.com/pixelactstudio/commitscape/commit/212ee2ba23f0f0db91b6366cb33c0a28ddfa3861))

## [0.1.1](https://github.com/pixelactstudio/commitscape/compare/v0.1.0...v0.1.1) (2026-09-28)


### Fixes

* **release:** download only the release's own artifacts ([#15](https://github.com/pixelactstudio/commitscape/issues/15)) ([46230f2](https://github.com/pixelactstudio/commitscape/commit/46230f221afaebe37c371b8bb087e38dc8ccf93d))
* **release:** skip versions already on npm and crates.io ([#17](https://github.com/pixelactstudio/commitscape/issues/17)) ([4873ffe](https://github.com/pixelactstudio/commitscape/commit/4873ffe09fd8d186dbda188e2e8fd2fdae5679de))
* **site:** respect public origin behind proxy ([#18](https://github.com/pixelactstudio/commitscape/issues/18)) ([ce22abe](https://github.com/pixelactstudio/commitscape/commit/ce22abec2768252fa93391e40d682376e5d9211f))

## 0.1.0 (2026-09-27)


### Features

* **phase-0:** workspace, fixture generator, benchmark harness, CI ([77154d4](https://github.com/pixelactstudio/commitscape/commit/77154d4fc6af7e3c074169cd575c6069e44479db))
* **phase-10:** GitHub numbers through the gh CLI (ADR-0009) ([783cd48](https://github.com/pixelactstudio/commitscape/commit/783cd48852b396805f0de2e54726174a63007337))
* **phase-11:** the interface rebuilt around charts, colour and plain words ([9daacf7](https://github.com/pixelactstudio/commitscape/commit/9daacf78264853494973e29ee742c962b778ec36))
* **phase-12:** commitscape card, a repository's story as an image to share ([4f57bf3](https://github.com/pixelactstudio/commitscape/commit/4f57bf3022859908203aabd2d87b4fd2b62278ef))
* **phase-13:** add Pixelact Studio repository card ([15fb8ff](https://github.com/pixelactstudio/commitscape/commit/15fb8ff3b04af625b986f8fc1143ac00a98ccd52))
* **phase-13:** remove everything AI-related, end to end ([8639a05](https://github.com/pixelactstudio/commitscape/commit/8639a05635b579ca4bc8d52bb811e91da56a55e0))
* **phase-14:** trust fixes: identities merge on strong evidence, w keeps your place, mouse ([68ea48d](https://github.com/pixelactstudio/commitscape/commit/68ea48dabf9a7362815cf7a1531972e024498660))
* **phase-15:** lines added and removed, counted in a background pass (ADR-0012) ([8247ba9](https://github.com/pixelactstudio/commitscape/commit/8247ba94cc6e66b8bd394111d8e64b2a72b1c21b))
* **phase-16:** the terminal interface in five screens, with themes; then frozen ([af42fc0](https://github.com/pixelactstudio/commitscape/commit/af42fc0c4b53b2fdcdd055d96ae8f75dd880a253))
* **phase-17:** GitHub's whole history, fetched once, then only what changed ([54e49b6](https://github.com/pixelactstudio/commitscape/commit/54e49b68d5f80e7e5b4b6711085ae6548e1a80c3))
* **phase-18:** the browser interface's foundation (ADR-0010) ([27f3d59](https://github.com/pixelactstudio/commitscape/commit/27f3d59caf8daebc88a6cf003fe401b3d85a6c41))
* **phase-19:** the browser interface's five screens, filters, themes, the card as PNG, and commitscape report ([2ccf611](https://github.com/pixelactstudio/commitscape/commit/2ccf611c6eb0d1f7d8b205fb1a3a684bb9538a9f))
* **phase-1:** combined-diff merges, parallel walk, time-ordered identity ([8b458b0](https://github.com/pixelactstudio/commitscape/commit/8b458b087f7d537c015f4a674e6efb80b5b01f27))
* **phase-20:** check and its GitHub Action, who, and health ([abcd93a](https://github.com/pixelactstudio/commitscape/commit/abcd93a840fc400b6d97762f5999a9787a26c479))
* **phase-21:** wrapped, your year as a page and a card, and the README card Action ([b36ec33](https://github.com/pixelactstudio/commitscape/commit/b36ec3351b7dee3e5b965e60ca1523d10e75b16d))
* **phase-22:** distribution: npm with the web app inside, Homebrew, a Nix flake, and the README ([b2d6e2d](https://github.com/pixelactstudio/commitscape/commit/b2d6e2d037412ff94adaa45e606741b6d4f15afc))
* **phase-23:** build the hosted Site, Builder, and monorepo ([#3](https://github.com/pixelactstudio/commitscape/issues/3)) ([3502efb](https://github.com/pixelactstudio/commitscape/commit/3502efb5d63a5e5e15f309c3941e27b3ef9b4b12))
* **phase-24:** move the hosted Site and Builder to Docker ([#4](https://github.com/pixelactstudio/commitscape/issues/4)) ([e4b38a2](https://github.com/pixelactstudio/commitscape/commit/e4b38a27c0cbade2b050b566e58ec147b962266c))
* **phase-2:** time-sliced cache with append-only data and frontier resume ([7badd18](https://github.com/pixelactstudio/commitscape/commit/7badd18c23e6817abd870331bc4a24d1c4c37a0e))
* **phase-3:** HEAD pass, Generated File classification, hotspots ([1959fe2](https://github.com/pixelactstudio/commitscape/commit/1959fe2978d588621b1029fc8757152f0f313ba4))
* **phase-4:** staleness, ownership, bus factor, code age, duplicates hint ([252bb9a](https://github.com/pixelactstudio/commitscape/commit/252bb9abad465b11474789958344823a20e02402))
* **phase-5:** change coupling and a bulk threshold chosen from data ([40f899b](https://github.com/pixelactstudio/commitscape/commit/40f899beab3821771c8ed16c31b49dbeddf17bf1))
* **phase-6:** --json, one reproducible document with every metric ([5362f6e](https://github.com/pixelactstudio/commitscape/commit/5362f6e4f2b980c646cc645de2fe8c0798aac802))
* **phase-7:** the terminal interface, Panels over one Window at a time ([a5e2a3e](https://github.com/pixelactstudio/commitscape/commit/a5e2a3e1f3d5976420023328b1a695a9882d596c))
* **phase-8:** the index records Local Time, Commit Kind and agent commits ([144cfbf](https://github.com/pixelactstudio/commitscape/commit/144cfbf266d69e442bc153a9c18fbc9cde687674))
* **phase-9:** the repository's story, as Analysis methods and in --json ([a673a5e](https://github.com/pixelactstudio/commitscape/commit/a673a5ef9874997bd0ff689b47ef4384b35f9a10))


### Fixes

* **release-please:** configure component release branch and version ([#13](https://github.com/pixelactstudio/commitscape/issues/13)) ([82d5e7f](https://github.com/pixelactstudio/commitscape/commit/82d5e7f4529f34131a6825bc39f1a4a59ac2296b))
* **tui:** a Window with no commits says so and points to a longer one ([f2d48cf](https://github.com/pixelactstudio/commitscape/commit/f2d48cffd55813795cdec4db45cac6f1fed4c1dc))
