These screenshots show the notes panel of a chapter with two notes and one plain highlight, before and after the change to the B1 design in `docs/design/notes/`. Chromium drew them at CSS pixel scale.

The `before-*` files come from the code before this change: a 1280x800 window in the light and the dark theme, and an iPhone 14 profile. The Notes button opened a dialog in the middle of the window, titled "Your notes on this chapter", with the storage sentence under the title. Every note had a row of four text buttons (Go to passage, Edit note or Add note, Delete and Share) and a row of four colour buttons, and Export as Markdown sat at the end of the list.

The `after-*` files come from the code after it. On a desktop, in a 1280x900 window, the panel sits on the window's right, below the sticky header. Its header holds "Notes", "3 in this chapter", and the Export and Close icons. A hint line and one card per note follow, and the footer says "Saved in this browser only." Each card shows a bar in its highlight's colour, the passage, the note and one "More actions" button. The `-menu` files show the first card's menu open with Edit, Share, the four colour dots with Amber checked, and Delete. On the iPhone 14 profile the panel takes the whole width below the header; `after-phone-menu.png` shows a menu open and `after-phone.png` the panel with it closed.

Make the after files with:

```sh
pnpm --filter @buildanagent/manual check:notes-panel -- --shots <folder>
```
