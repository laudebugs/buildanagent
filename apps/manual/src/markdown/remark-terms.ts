// Adapted from src/lib/markdown/remark-terms.mjs in the owner's garment engineering textbook
// (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
//
// Changed from the original: a chapter links only the terms its `glossary` front matter tags, and a tagged term that
// never appears fails the build; a term links once per block instead of once per chapter; no sections are skipped; the
// glossary comes from the loaded book; each link carries its own hover card; and the "used in" list for the glossary
// page is not recorded.
//
// Links each tagged glossary term to its glossary entry the first time it appears in each block: a paragraph, a list
// item's paragraph, a table cell or a caption. A reader who starts mid-chapter still finds the link, and capping it at
// one per block keeps a paragraph from filling with underlines. Headings, box and tab headings, links, code and HTML
// are left alone. An abbreviation is also wrapped in <abbr>, without a title, because the browser's own tooltip would
// cover the card.
//
// Each link sits in a .glossary-term span beside its card. The span and the card take GlossaryTerm.astro's classes,
// so the same styles open the card on hover and keyboard focus, and scripts/glossary.ts closes it on Escape and keeps
// it inside the viewport. Unlike GlossaryTerm's card, a chapter's card has no id, no role and no <dfn>, and is
// aria-hidden: a term can link many times on a page, so screen readers get the definition through aria-describedby,
// which points into one hidden list appended to the chapter with one entry per term. The card's text therefore repeats
// in the page's HTML after every link; aria-hidden keeps it from screen readers and from reader views that drop
// hidden elements, data-pagefind-ignore keeps it out of search, and the print stylesheet never shows it.

import type { Nodes, Parent, PhrasingContent, Root, RootContent, Text } from "mdast";
import type { VFile } from "vfile";
import { cardText, findTerms, type GlossaryEntry, matcher, termHref } from "../book/glossary.js";
import type { Book } from "../book/load.js";
import { checkedChapter } from "./chapter-file.js";
import { failAt } from "./fail.js";
import { splitText, textInside } from "./split-text.js";

const SKIPPED = new Set(["heading", "link", "linkReference", "inlineCode", "code", "html", "definition"]);

/** Inline mdast types: a text node's block is its nearest ancestor of any other type. */
const PHRASING = new Set(["emphasis", "strong", "delete", "textDirective"]);

/** Elements a plugin may render an inline mdast node as that still start a block of their own. */
const BLOCK_ELEMENT = /^(?:p|div|figcaption|aside|section|li|td|th)$/;

/** A box's or a tab's heading is a paragraph rendered as h2 to h6, so it is skipped like a heading. */
const isHeading = (node: Nodes): boolean => node.type === "heading" || /^h[1-6]$/.test(String(node.data?.hName));

const isPhrasing = (node: Nodes): boolean =>
  PHRASING.has(node.type) && !BLOCK_ELEMENT.test(String(node.data?.hName ?? ""));

/** Maps each text node to the block it sits in, and adds the text of every heading to `skip`. */
function blocksOf(tree: Root, skip: Set<Text>): Map<Text, Nodes> {
  const blocks = new Map<Text, Nodes>();
  const walk = (node: Nodes, block: Nodes, inHeading: boolean): void => {
    if (node.type === "text") {
      if (inHeading) skip.add(node);
      blocks.set(node, block);
      return;
    }
    const own = isPhrasing(node) ? block : node;
    const heading = inHeading || isHeading(node);
    for (const child of (node as Partial<Parent>).children ?? []) walk(child as Nodes, own, heading);
  };
  walk(tree, tree, false);
  return blocks;
}

/** The definition an abbreviation's card shows under its heading: the expansion, then the definition. */
const cardDefinition = (entry: GlossaryEntry): string =>
  entry.kind === "abbr" ? `${entry.expansion}. ${entry.definition}` : entry.definition;

/** The id of the hidden definition a term's link points at. */
export const definitionId = (entry: GlossaryEntry): string => `termdef-${entry.id}`;

/** An inline span in mdast: an emphasis node renamed, which keeps its children. */
const span = (
  className: string[],
  children: PhrasingContent[],
  extra: Record<string, string> = {},
): PhrasingContent => ({
  type: "emphasis",
  data: { hName: "span", hProperties: { className, ...extra } },
  children,
});

const spanText = (className: string, value: string): PhrasingContent => ({
  type: "text",
  value,
  data: { hName: "span", hProperties: { className: [className] } },
});

function termLink(entry: GlossaryEntry, text: string): PhrasingContent {
  const link: PhrasingContent = {
    type: "link",
    url: termHref(entry),
    data: { hProperties: { className: ["glossary-term__link"], ariaDescribedBy: [definitionId(entry)] } },
    // An <abbr> in mdast: a text node whose data renames it, holding the abbreviation as written.
    children: [
      entry.kind === "abbr" ? { type: "text", value: text, data: { hName: "abbr" } } : { type: "text", value: text },
    ],
  };
  // The same classes as GlossaryCard.astro's inline card. No id, because a term can link many times on a page.
  const card = span(
    ["glossary-card", "glossary-term__card"],
    [spanText("glossary-card__term", entry.term), spanText("glossary-card__definition", cardDefinition(entry))],
    { ariaHidden: "true", dataPagefindIgnore: "" },
  );
  return span(["glossary-term"], [link, card]);
}

function definitionList(used: readonly GlossaryEntry[]): RootContent {
  return {
    type: "paragraph",
    data: { hName: "div", hProperties: { hidden: true, className: ["term-defs"], dataPagefindIgnore: "" } },
    children: used.map((entry) => ({
      type: "text",
      value: cardText(entry),
      data: { hName: "span", hProperties: { id: definitionId(entry) } },
    })),
  };
}

export function remarkTerms(options: { readonly book: Book }) {
  const { book } = options;
  return (tree: Root, file: VFile): void => {
    const { frontmatter } = checkedChapter(file);
    const tagged = frontmatter.glossary.flatMap((id) => book.glossary.get(id) ?? []);
    if (tagged.length === 0) return;
    const m = matcher(tagged);
    const skip = textInside(tree, SKIPPED);
    const blocks = blocksOf(tree, skip);
    // The entries each block has linked already, so a term links once per block.
    const linked = new Map<Nodes, Set<string>>();
    const used = new Map<string, GlossaryEntry>();
    splitText(tree, skip, (value, node) => {
      const block = blocks.get(node) ?? tree;
      const inBlock = linked.get(block) ?? new Set<string>();
      linked.set(block, inBlock);
      return findTerms(value, m)
        .filter(({ entry }) => {
          if (inBlock.has(entry.id)) return false;
          inBlock.add(entry.id);
          used.set(entry.id, entry);
          return true;
        })
        .map(({ entry, index, text }) => ({ index, length: text.length, node: termLink(entry, text) }));
    });
    const unused = tagged.filter((entry) => !used.has(entry.id)).map((entry) => entry.id);
    if (unused.length > 0) {
      failAt(
        file,
        `front matter: glossary tags ${unused.join(", ")}, but the chapter's text never uses ${unused.length === 1 ? "it" : "them"}`,
      );
    }
    tree.children.push(definitionList([...used.values()]));
  };
}
