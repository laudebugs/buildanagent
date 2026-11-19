import type { Paragraph, Parent, Root, RootContent } from "mdast";
import type { VFile } from "vfile";
import { NUMBERED_KINDS, type NumberedKind } from "../book/book-index.js";
import type { Book } from "../book/load.js";
import { checkedChapter } from "./chapter-file.js";
import { failAt } from "./fail.js";

/** What each numbered kind must hold: a table, a fenced code block, or anything at all for a figure. */
const REQUIRED_CONTENT: Record<NumberedKind, RootContent["type"] | undefined> = {
  figure: undefined,
  listing: "code",
  table: "table",
};

// remark-directive's types add these node types to mdast's content unions.
type ContainerDirective = Extract<RootContent, { type: "containerDirective" }>;
type TextDirective = Extract<RootContent, { type: "textDirective" }>;

const isNumberedKind = (name: string): name is NumberedKind => Object.hasOwn(NUMBERED_KINDS, name);

/**
 * Turns the book's directives into HTML-ready nodes. `:::figure[Caption]{#id}`, `:::listing[…]{#id}` and
 * `:::table[…]{#id}` become a `<figure>` with an id such as `fig-<id>`, a caption and an empty number that the
 * numbering plugin fills in. `:analogy[label]{#id}` marks a use of a registered analogy. Any other directive fails,
 * except a bare text directive such as the `:Invent` in "re:Invent" or the `:tools` in `[[ch:tools]]`, which is put
 * back as the text it was.
 */
export function remarkBookDirectives(options: { readonly book: Book }) {
  const { book } = options;
  return (tree: Root, file: VFile): void => {
    const { outline } = checkedChapter(file);
    walk(tree, (node) => {
      if (node.type === "containerDirective" && isNumberedKind(node.name)) return numbered(node, node.name, file);
      if (node.type === "textDirective" && node.name === "analogy") return analogy(node, book, outline.number, file);
      if (node.type === "textDirective" && isBare(node)) return restored(node);
      if (node.type === "containerDirective" || node.type === "leafDirective" || node.type === "textDirective") {
        const colons = { containerDirective: ":::", leafDirective: "::", textDirective: ":" }[node.type];
        return failAt(file, `unknown directive ${colons}${node.name}; escape the colon as \\: if it is text`, node);
      }
      return undefined;
    });
    mergeText(tree);
  };
}

/** Visits every node depth first; a returned node replaces the visited one. */
function walk(parent: Parent, visit: (node: RootContent) => RootContent | undefined): void {
  parent.children = parent.children.map((child) => {
    const replaced = visit(child) ?? child;
    if ("children" in replaced) walk(replaced, visit);
    return replaced;
  }) as typeof parent.children;
}

/** A bare text directive put back as the text it was, keeping its position for error messages. */
function restored(node: TextDirective): RootContent {
  return { type: "text", value: `:${node.name}`, ...(node.position ? { position: node.position } : {}) };
}

const isBare = (node: TextDirective): boolean =>
  node.children.length === 0 && Object.keys(node.attributes ?? {}).length === 0;

function numbered(node: ContainerDirective, kind: NumberedKind, file: VFile): ContainerDirective {
  const id = node.attributes?.id;
  const labelIndex = node.children.findIndex((child) => child.type === "paragraph" && child.data?.directiveLabel);
  const label = node.children[labelIndex] as Paragraph | undefined;
  if (label === undefined || label.children.length === 0) {
    return failAt(file, `a ${kind} needs a caption, written :::${kind}[Caption]{#${id ?? "id"}}`, node);
  }
  const body = node.children.filter((_, i) => i !== labelIndex);
  const required = REQUIRED_CONTENT[kind];
  if (body.length === 0 || (required !== undefined && !body.some((child) => child.type === required))) {
    return failAt(file, `a ${kind} must hold ${required === undefined ? "its content" : `a ${required} block`}`, node);
  }
  const { prefix } = NUMBERED_KINDS[kind];
  const caption: Paragraph = {
    type: "paragraph",
    data: { hName: "figcaption" },
    children: [
      { type: "text", value: "", data: { hName: "span", hProperties: { className: ["number"] } } },
      { type: "text", value: " " },
      ...label.children,
    ],
  };
  return {
    ...node,
    // A figure's caption goes below it; a table's and a listing's go above, where readers look for them.
    children: kind === "figure" ? [...body, caption] : [caption, ...body],
    data: {
      hName: "figure",
      hProperties: { id: `${prefix}-${id}`, className: ["numbered", kind], dataNumbered: kind, dataNumberedId: id },
    },
  };
}

function analogy(node: TextDirective, book: Book, chapterNumber: number, file: VFile): TextDirective {
  const id = node.attributes?.id;
  const entry = id ? book.analogies.get(id) : undefined;
  if (entry === undefined) {
    return failAt(file, `:analogy{#${id ?? ""}} is not in the analogy register (src/content/analogies.json)`, node);
  }
  if (node.children.length === 0)
    return failAt(file, `:analogy{#${id}} needs a label: :analogy[the label]{#${id}}`, node);
  const introduced = book.bySlug.get(entry.chapter);
  if (introduced === undefined || introduced.number > chapterNumber) {
    return failAt(
      file,
      `analogy "${id}" belongs to ${entry.chapter}, which comes later; a chapter may refer back only to an ` +
        "earlier chapter's analogy",
      node,
    );
  }
  return { ...node, data: { hName: "span", hProperties: { className: ["analogy"], dataAnalogy: id } } };
}

/** Joins neighbouring text nodes, so restored directive text and the text around it match as one string. */
function mergeText(parent: Parent): void {
  const merged: RootContent[] = [];
  for (const child of parent.children) {
    const previous = merged.at(-1);
    if (child.type === "text" && previous?.type === "text" && !child.data && !previous.data) {
      const start = previous.position?.start;
      const end = child.position?.end;
      merged[merged.length - 1] = {
        type: "text",
        value: previous.value + child.value,
        ...(start && end ? { position: { start, end } } : {}),
      };
      continue;
    }
    if ("children" in child) mergeText(child);
    merged.push(child);
  }
  parent.children = merged as typeof parent.children;
}
