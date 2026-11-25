# IBM Plex Sans, as the docs serve it

These are IBM's own WOFF2 files, unchanged. The docs app owns them; the book does not use this family.

- Package: `@ibm/plex-sans` 1.1.0, published 2024-11-11 by IBM, <https://registry.npmjs.org/@ibm/plex-sans/-/plex-sans-1.1.0.tgz> (source repository <https://github.com/IBM/plex>, package `gitHead` `1da12f02587b630c07e92692d21492d722f53614`).
- Files: `fonts/split/woff2/` of that package, the Latin1 subset of each face. IBM builds the split files; the docs do not subset anything.
- Licence: SIL Open Font License 1.1, in `LICENSE.txt`, the package's own file. Copyright © 2017 IBM Corp. with Reserved Font Name "Plex".
- The pin, with the tarball's integrity, is `apps/docs/fonts/ibm-plex-sans.json`; `pnpm --filter @buildanagent/docs fonts:plex` restores the files from the pinned release and checks them against the pin.

| File | Face | SHA-256 |
| --- | --- | --- |
| `IBMPlexSans-Regular-Latin1.woff2` | 400 | `b5ad7bd39f996144915f0ad9849a90183b27d8c28ad97ed98af5b1bebc51f6b1` |
| `IBMPlexSans-Italic-Latin1.woff2` | 400 italic | `0a06b98143f3453b81f3c396241a01c6c4cff84c1a77bf0c75b18bd603018506` |
| `IBMPlexSans-SemiBold-Latin1.woff2` | 600 | `fff0ab3a88b0b4aa0b693e4f0201359a15183b08e3fa5696d1918d8f0ade8ad5` |
| `LICENSE.txt` | licence | `7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da` |
