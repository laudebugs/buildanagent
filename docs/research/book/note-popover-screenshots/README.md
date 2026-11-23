These screenshots show what a reader sees on a desktop after selecting text and pressing Add note, before and after the change to the A1 design in `docs/design/notes/`. Chromium drew all four at CSS pixel scale, in the light and the dark theme.

The `before-*` files come from the code before this change, at a 1280x800 window. Add note opened the whole notes panel, titled "Your notes on this chapter", with the storage warning, the note field and Export as Markdown, over a dimmed page.

The `after-*` files come from the code after it, at a 1280x900 window. Add note opens only a small popover under the selected words. It holds the four colour dots with Blue checked, "Esc to cancel", the passage, the note field, Save note, Cancel and the count "45 / 500". The passage is drawn in blue because the dots recolour it while the reader writes, though nothing is stored until Save note.

Make the after files with:

```sh
pnpm --filter @buildanagent/manual check:note-popover -- --shots <folder>
```
