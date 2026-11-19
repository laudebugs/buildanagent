// Adapted from src/lib/markdown/remark-terms.mjs in the owner's garment engineering textbook
// (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
//
// Changed from the original: a chapter links only the terms its `glossary` front matter tags, and a tagged term that
// never appears fails the build; no sections are skipped; the glossary comes from the loaded book; and the
// "used in" list for the glossary page is not recorded.
//
// Links the first use of each tagged glossary term in a chapter to its glossary entry. Later uses stay plain, so the
// text does not fill up with underlines. Headings, links, code and HTML are left alone. An abbreviation is also
// wrapped in <abbr>, without a title, because the browser's own tooltip would cover the card.
//
// Hover and keyboard focus can show a card with the definition, from data-def; screen readers get the same text
// through aria-describedby, which points into one hidden list of definitions appended to the chapter.

import type { PhrasingContent, Root, RootContent } from "mdast";
import type { VFile } from "vfile";
import { cardText, findTerms, type GlossaryEntry, matcher, termHref } from "../book/glossary.js";
import type { Book } from "../book/load.js";
import { checkedChapter } from "./chapter-file.js";
import { failAt } from "./fail.js";
import { splitText, textInside } from "./split-text.js";

const SKIPPED = new Set(["heading", "link", "linkReference", "inlineCode", "code", "html", "definition"]);

/** The id of the hidden definition a term's link points at. */
export const definitionId = (entry: GlossaryEntry): string => `termdef-${entry.id}`;

function termLink(entry: GlossaryEntry, text: string): PhrasingContent {
  const value: PhrasingContent = { type: "text", value: text };
  return {
    type: "link",
    url: termHref(entry),
    data: { hProperties: { className: ["term"], dataDef: cardText(entry), ariaDescribedBy: [definitionId(entry)] } },
    // An <abbr> in mdast: a text node whose data renames it, holding the abbreviation as written.
    children: entry.kind === "abbr" ? [{ type: "text", value: text, data: { hName: "abbr" } }] : [value],
  };
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
    const done = new Set<string>();
    const used: GlossaryEntry[] = [];
    splitText(tree, textInside(tree, SKIPPED), (value) =>
      findTerms(value, m)
        .filter(({ entry }) => {
          if (done.has(entry.id)) return false;
          done.add(entry.id);
          used.push(entry);
          return true;
        })
        .map(({ entry, index, text }) => ({ index, length: text.length, node: termLink(entry, text) })),
    );
    const unused = tagged.filter((entry) => !done.has(entry.id)).map((entry) => entry.id);
    if (unused.length > 0) {
      failAt(
        file,
        `front matter: glossary tags ${unused.join(", ")}, but the chapter's text never uses ${unused.length === 1 ? "it" : "them"}`,
      );
    }
    tree.children.push(definitionList(used));
  };
}
