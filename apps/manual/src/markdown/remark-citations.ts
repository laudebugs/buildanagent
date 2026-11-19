// Adapted from src/lib/markdown/remark-citations.mjs in the owner's garment engineering textbook
// (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
//
// Changed from the original: citations are [@id] or [@a; @b] with kebab-case ids, each must also be in the chapter's
// `sources` list, a malformed [@…] fails instead of staying text, and the register comes from the loaded book.
//
// Turns citations in chapter text into links to /sources/#<id>. CommonMark leaves an undefined [@id] as plain text,
// merged into the text around it, so this plugin splits text nodes. Text inside a link and code are left alone,
// because links cannot be nested. An unknown id fails the build, naming the file and line.

import type { PhrasingContent, Root } from "mdast";
import type { VFile } from "vfile";
import { CITE, CITE_LIKE, citeHref, citeParts } from "../book/citations.js";
import type { Book } from "../book/load.js";
import { checkedChapter } from "./chapter-file.js";
import { failAt } from "./fail.js";
import { splitText, textInside } from "./split-text.js";

export function remarkCitations(options: { readonly book: Book }) {
  const known = new Set(options.book.sources.keys());
  return (tree: Root, file: VFile): void => {
    const { frontmatter } = checkedChapter(file);
    splitText(tree, textInside(tree, new Set(["link", "linkReference"])), (value, node) => {
      const valid = new Set([...value.matchAll(CITE)].map((m) => m.index));
      for (const m of value.matchAll(CITE_LIKE)) {
        if (!valid.has(m.index))
          failAt(file, `${m[0]} is not a citation; write [@id] or [@a; @b] with kebab-case ids`, node);
      }
      return [...value.matchAll(CITE)].map((m) => {
        let parts: ReturnType<typeof citeParts> = [];
        try {
          parts = citeParts(m[1] ?? "", known, frontmatter.sources);
        } catch (error) {
          failAt(file, error instanceof Error ? error.message : String(error), node);
        }
        return {
          index: m.index,
          length: m[0].length,
          node: parts.map(
            (part): PhrasingContent =>
              "id" in part
                ? {
                    type: "link",
                    url: citeHref(part.id),
                    title: options.book.sources.get(part.id)?.title ?? null,
                    data: { hProperties: { className: ["cite"] } },
                    children: [{ type: "text", value: part.text }],
                  }
                : { type: "text", value: part.text },
          ),
        };
      });
    });
  };
}
