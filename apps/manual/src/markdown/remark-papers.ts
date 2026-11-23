// Turns `[[paper:id]]` in chapter text into a link to the paper's entry on the sources page, and fails the render on
// a paper named any other way the rules forbid (src/book/papers.ts):
//
// - a named paper's short name or alias as bare text;
// - a chapter's first mention of a named paper that is a `[@id]` citation, which carries no description;
// - `[[paper:id described]]` after the first mention, where there is nothing left to describe;
// - `[[paper:id]]` naming an id that is not a paper, a paper still pending, or a paper missing from the chapter's
//   `sources`.
//
// The first `[[paper:id]]` of each paper in a chapter shows the name, then the register's blurb in parentheses, and
// carries the id the sources page's "Cited in" links to. `[[paper:id described]]` shows the name alone with that id.
// Every later `[[paper:id]]` shows the name alone. It runs before the citations plugin, so a `[@id]` is still text
// that counts as a mention, and after the directives plugin, which puts the `:id` inside `[[paper:id]]` back as text.

import type { PhrasingContent, Root, Text } from "mdast";
import type { VFile } from "vfile";
import type { Book } from "../book/load.js";
import {
  type Mention,
  NOT_PROSE,
  PAPER_REF,
  PAPER_REF_LIKE,
  paperAnchor,
  paperHref,
  paperMentions,
} from "../book/papers.js";
import { checkedChapter } from "./chapter-file.js";
import { failAt } from "./fail.js";
import { placeAt } from "./position.js";
import { splitText, textInside } from "./split-text.js";

const at = (mention: Mention) =>
  placeAt(mention.node.position, mention.node.value, mention.index, mention.index + mention.text.length);

export function remarkPapers(options: { readonly book: Book }) {
  const { book } = options;
  return (tree: Root, file: VFile): void => {
    const { frontmatter } = checkedChapter(file);
    const skip = textInside(tree, NOT_PROSE);
    // A malformed reference fails here, with its own message, before the numbering plugin's general one.
    for (const node of textNodes(tree, skip)) {
      const valid = new Set([...node.value.matchAll(PAPER_REF)].map((m) => m.index));
      for (const m of node.value.matchAll(PAPER_REF_LIKE)) {
        if (!valid.has(m.index)) {
          failAt(
            file,
            `${m[0]} is not a paper reference; write [[paper:id]] or [[paper:id described]] with a kebab-case id`,
            placeAt(node.position, node.value, m.index, m.index + m[0].length),
          );
        }
      }
    }
    const mentions = paperMentions(tree, book.papers, book.sources);
    const seen = new Set<string>();
    // The references that are their paper's first mention in the chapter, by text node and offset.
    const firsts = new Map<Text, Set<number>>();
    for (const mention of mentions) {
      const { id, kind } = mention;
      const paper = book.papers.named.get(id);
      if (kind === "ref" || kind === "described") {
        const source = book.sources.get(id);
        if (source?.kind !== "paper") {
          failAt(file, `${mention.text} names no paper in the source register (${book.names.sources})`, at(mention));
        }
        if (paper === undefined) {
          failAt(
            file,
            `${mention.text} names a paper that has no short name and blurb yet; add them to its entry in ` +
              `${book.names.sources} and remove it from ${book.names.papersPending}`,
            at(mention),
          );
        }
        if (!frontmatter.sources.includes(id)) {
          failAt(file, `${mention.text} names a paper not in this chapter's \`sources\`; add ${id} there`, at(mention));
        }
      }
      if (paper === undefined) continue;
      if (kind === "bare") {
        failAt(
          file,
          `"${mention.text}" names the paper ${id} as bare text; write [[paper:${id}]] so it links to the sources page`,
          at(mention),
        );
      }
      const first = !seen.has(id);
      seen.add(id);
      if (first && kind === "cite") {
        failAt(
          file,
          `[@${id}] is this chapter's first mention of ${paper.short}, and a citation does not describe the paper; ` +
            `name it first as [[paper:${id}]], or [[paper:${id} described]] when the sentence describes it`,
          at(mention),
        );
      }
      if (!first && kind === "described") {
        failAt(
          file,
          `${mention.text} is not the chapter's first mention of ${paper.short}; only the first is described, so ` +
            `write [[paper:${id}]]`,
          at(mention),
        );
      }
      if (first) firsts.set(mention.node, (firsts.get(mention.node) ?? new Set()).add(mention.index));
    }
    splitText(tree, skip, (value, node) =>
      [...value.matchAll(PAPER_REF)].map((m) => {
        const id = m[1] ?? "";
        const paper = book.papers.named.get(id);
        if (paper === undefined) return failAt(file, `${m[0]} names no paper with a short name`, node);
        const first = firsts.get(node)?.has(m.index) ?? false;
        const link: PhrasingContent = {
          type: "link",
          url: paperHref(id),
          title: paper.source.title,
          data: { hProperties: { className: ["paper-ref"], ...(first ? { id: paperAnchor(id) } : {}) } },
          children: [{ type: "text", value: paper.short }],
        };
        const expanded = first && !m[2];
        return {
          index: m.index,
          length: m[0].length,
          node: expanded ? [link, { type: "text", value: ` (${paper.blurb})` }] : link,
        };
      }),
    );
  };
}

function textNodes(tree: Root, skip: ReadonlySet<Text>): Text[] {
  const nodes: Text[] = [];
  const walk = (node: Root | Root["children"][number]): void => {
    if (node.type === "text" && !skip.has(node)) nodes.push(node);
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(tree);
  return nodes;
}
