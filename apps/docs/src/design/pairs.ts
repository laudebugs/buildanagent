// The colour pairs Starlight's roles create on top of the book's own. The book's pairs live in
// docs/design/book-tokens.json, and its contrast test counts them, so these stay here; test/contrast.test.ts measures
// every one in both modes from the colours tokens.css ships.

/** A token named by where it lives, `page.<key>` or `panel.<key>`; the test reads it in the light and the dark set. */
export type TokenName = `page.${string}` | `panel.${string}`;

/** A colour on a background, both tokens, and what Starlight draws with them. */
export interface StarlightPair {
  /** Where the pair appears, for the failure message. */
  readonly role: string;
  readonly color: TokenName;
  readonly on: TokenName;
  /** `text` must reach 4.5:1 (WCAG 1.4.3); `nonText`, a focus ring or a meaningful edge, 3:1 (WCAG 1.4.11). */
  readonly kind: "text" | "nonText";
}

const ASIDES = [
  ["note", "page.highlightBlue", "page.highlightEdgeBlue"],
  ["tip", "page.highlightGreen", "page.highlightEdgeGreen"],
  ["caution", "page.highlight", "page.highlightEdge"],
  ["danger", "page.highlightPink", "page.highlightEdgePink"],
] as const;

// Marked, inserted and deleted code: each kind's edge and sign, all on the panel's grid shade (CODE_STYLE_OVERRIDES).
const MARKERS = [
  ["marked", "panel.amber"],
  ["inserted", "panel.olive"],
  ["deleted", "panel.terracotta"],
] as const;

const SYNTAX = ["text", "comment", "amber", "olive", "terracotta"] as const;

/** Every pair the mapping in starlight.css and the code panels' settings create. */
export const STARLIGHT_PAIRS: readonly StarlightPair[] = [
  { role: "body text", color: "page.text", on: "page.background", kind: "text" },
  { role: "sidebar links", color: "page.textSoft", on: "page.background", kind: "text" },
  { role: "table of contents and footer", color: "page.textMuted", on: "page.background", kind: "text" },
  { role: "links and the site title", color: "page.link", on: "page.background", kind: "text" },
  { role: "the sidebar's current page", color: "page.background", on: "page.link", kind: "text" },
  { role: "a primary link button", color: "page.background", on: "page.link", kind: "text" },
  { role: "a banner on the accent", color: "page.background", on: "page.accent", kind: "text" },
  { role: "selected text", color: "page.background", on: "page.accent", kind: "text" },
  { role: "the copy button's tooltip", color: "page.background", on: "page.accent", kind: "text" },
  { role: "a focused search result", color: "page.link", on: "page.highlight", kind: "text" },
  { role: "a search result's text", color: "page.text", on: "page.highlight", kind: "text" },
  { role: "inline code", color: "panel.text", on: "panel.background", kind: "text" },
  { role: "a code block's title and copy button", color: "panel.text", on: "panel.background", kind: "text" },
  { role: "a muted line in a code panel", color: "page.textMuted", on: "panel.background", kind: "text" },
  { role: "inline code in a link", color: "page.link", on: "panel.background", kind: "text" },
  ...SYNTAX.map(
    (key): StarlightPair => ({
      role: `${key} code on a marker`,
      color: `panel.${key}`,
      on: "panel.grid",
      kind: "text",
    }),
  ),
  ...MARKERS.flatMap(([marker, edge]): StarlightPair[] => [
    { role: `a ${marker} line's diff sign`, color: edge, on: "panel.grid", kind: "text" },
    { role: `a ${marker} line marker's label`, color: "panel.background", on: edge, kind: "text" },
    { role: `a ${marker} marker's edge on the marker`, color: edge, on: "panel.grid", kind: "nonText" },
    { role: `a ${marker} inline marker's edge on the panel`, color: edge, on: "panel.background", kind: "nonText" },
  ]),
  ...ASIDES.flatMap(([aside, background, edge]): StarlightPair[] => [
    { role: `a ${aside} aside's text and title`, color: "page.text", on: background, kind: "text" },
    { role: `a link in a ${aside} aside`, color: "page.link", on: background, kind: "text" },
    { role: `a ${aside} aside's left rule`, color: edge, on: "page.background", kind: "nonText" },
  ]),
  { role: "a home page card's title", color: "page.text", on: "panel.background", kind: "text" },
  { role: "a home page card's description", color: "page.textSoft", on: "panel.background", kind: "text" },
  { role: "a home page card's arrow", color: "page.link", on: "panel.background", kind: "text" },
  { role: "a home page card's edge", color: "page.textMuted", on: "page.background", kind: "nonText" },
  { role: "the accent word of the home title", color: "page.link", on: "page.background", kind: "text" },
  { role: "the focus ring on the page", color: "page.accent", on: "page.background", kind: "nonText" },
  { role: "the focus ring on a code panel", color: "page.accent", on: "panel.background", kind: "nonText" },
  { role: "a code block's active tab marker", color: "page.accent", on: "panel.background", kind: "nonText" },
];
