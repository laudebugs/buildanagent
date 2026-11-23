These screenshots show a chapter's notes panel before and after the change to the B1 design in `docs/design/notes/`. The chapter holds two notes and one plain highlight, and Chromium drew every file at CSS pixel scale.

The `before-*` files come from the code before the change, in a 1280x800 window in the light and the dark theme and in an iPhone 14 profile. The Notes button opened a dialog in the middle of the window, titled "Your notes on this chapter", with the storage sentence under the title. Every note carried a row of four text buttons (Go to passage, Edit note or Add note, Delete and Share) and a row of four colour buttons. Export as Markdown sat at the end of the list.

The `after-*` files come from the code after the change. In a 1280x900 window the panel sits on the window's right, below the sticky header. Its header holds "Notes", "3 in this chapter", and the Export and Close icons; a hint line and one card per note follow, and the footer says "Saved in this browser only." Each card shows a bar in its highlight's colour, the passage, the note and one "More actions" button. The two desktop `-menu` files show the first card's menu open in the light and the dark theme, with Edit, Share, the four colour dots and Delete; Amber is checked. In the iPhone 14 profile the panel takes the window's whole width below the header: `after-phone-menu.png` shows a menu open, and `after-phone.png` shows the panel with the menu closed.

Make the after files with:

```sh
pnpm --filter @buildanagent/manual check:notes-panel -- --shots <folder>
```
