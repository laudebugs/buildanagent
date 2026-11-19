import type { Element, ElementContent, Root } from "hast";
import { visit } from "unist-util-visit";
import type { VFile } from "vfile";
import { normalizePhrase } from "../book/analogies.js";
import { captionId } from "../book/figures.js";
import type { Book } from "../book/load.js";
import { checkedChapter } from "./chapter-file.js";
import { failAt } from "./fail.js";
import { figureAnalogies } from "./remark-figures.js";

const hasClass = (node: ElementContent, name: string): boolean =>
  node.type === "element" && Array.isArray(node.properties.className) && node.properties.className.includes(name);

function textOf(nodes: readonly ElementContent[]): string {
  return nodes
    .map((node) => (node.type === "text" ? node.value : node.type === "element" ? textOf(node.children) : ""))
    .join("");
}

/**
 * Finishes each numbered figure: its caption takes the figure frame's classes, and an analogy illustration (BK22) is
 * checked against the analogy register and gets its "where the analogy breaks" note. A figure marked
 * `{#id analogy="entry"}` must name a register entry whose `illustration` is this figure, and its caption must start
 * with the analogy's name; the caption then links to the note, which follows it. A figure that an entry names as its
 * illustration must carry that mark. Each failure names the chapter's file and the figure's line.
 */
export function rehypeAnalogyFigures(options: { readonly book: Book }) {
  const { book } = options;
  return (tree: Root, file: VFile): void => {
    checkedChapter(file);
    const marks = figureAnalogies(file);
    visit(tree, "element", (node) => {
      if (node.tagName !== "figure" || node.properties.dataNumbered !== "figure") return;
      const id = String(node.properties.dataNumberedId);
      const caption = node.children.find(
        (child): child is Element => child.type === "element" && child.tagName === "figcaption",
      );
      if (caption === undefined) return;
      styleCaption(caption, id);
      const analogyId = marks.get(id);
      if (analogyId === undefined) {
        // Figure ids are unique across the book, so an entry from any chapter that names this id means this figure.
        const illustrated = [...book.analogies.values()].find((entry) => entry.illustration === id);
        if (illustrated !== undefined) {
          failAt(
            file,
            `figure "${id}" illustrates the analogy ${illustrated.id} in ${book.names.analogies}; mark it ` +
              `{#${id} analogy="${illustrated.id}"} so its caption names the analogy and says where it breaks`,
            node,
          );
        }
        return;
      }
      analogyFigure(node, caption, { id, analogyId, book, file });
    });
  };
}

/** Gives a Markdown figure's caption the classes the FigureFrame component's caption has. */
function styleCaption(caption: Element, id: string): void {
  caption.properties.className = ["figure__caption"];
  // The figure's scrolling stage is named by this id (remark-figures).
  caption.properties.id = captionId(id);
  const number = caption.children.find((child) => hasClass(child, "number"));
  if (number?.type === "element") number.properties.className = ["number", "figure__number", "label"];
}

function analogyFigure(
  figure: Element,
  caption: Element,
  where: { readonly id: string; readonly analogyId: string; readonly book: Book; readonly file: VFile },
): void {
  const { id, analogyId, book, file } = where;
  const entry = book.analogies.get(analogyId);
  if (entry === undefined) {
    failAt(file, `figure "${id}" names the analogy "${analogyId}", which is not in ${book.names.analogies}`, figure);
  }
  if (entry.illustration !== id) {
    const named = entry.illustration === null ? "no illustration" : `"${entry.illustration}" as its illustration`;
    failAt(
      file,
      `figure "${id}" illustrates the analogy ${analogyId}, but ${book.names.analogies} gives that analogy ${named}; ` +
        `set its illustration to "${id}"`,
      figure,
    );
  }
  const words = textOf(caption.children.filter((child) => !hasClass(child, "number")));
  if (!normalizePhrase(words).startsWith(normalizePhrase(entry.analogy))) {
    failAt(file, `the caption of figure "${id}" must start with the analogy's name, "${entry.analogy}"`, figure);
  }
  const noteId = `fig-${id}--breaks`;
  figure.properties.dataAnalogy = analogyId;
  caption.children.push(
    { type: "text", value: " (" },
    {
      type: "element",
      tagName: "a",
      properties: { href: `#${noteId}`, className: ["figure__breaks-link"] },
      children: [{ type: "text", value: "where the analogy breaks" }],
    },
    { type: "text", value: ")" },
  );
  figure.children.push({
    type: "element",
    tagName: "p",
    properties: { id: noteId, className: ["figure__breaks"] },
    children: [
      {
        type: "element",
        tagName: "span",
        properties: { className: ["label"] },
        children: [{ type: "text", value: "Where it breaks" }],
      },
      { type: "text", value: ` ${entry.breaks}` },
    ],
  });
}
