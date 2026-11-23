Before and after screenshots of the note sheet at an iPhone 14's 390x664 window, with touch, at CSS pixel scale. Chromium drew them, not iOS Safari.

Each set shows the add-note and saved-note states in dark and light, a focused first colour dot, and each state in a 420px-high window, which stands in for the on-screen keyboard. The `before-*` files come from the code before this change and the `after-*` files from the code after it. Make them with:

```sh
pnpm --filter @buildanagent/manual check:note-sheet -- --shots <folder> --prefix before|after
```
