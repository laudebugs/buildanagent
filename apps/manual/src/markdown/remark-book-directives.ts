import type { Html, Paragraph, Parent, PhrasingContent, Root, RootContent } from "mdast";
import type { VFile } from "vfile";
import { isNumberedKind, NUMBERED_KINDS, type NumberedKind } from "../book/book-index.js";
import type { ListingSource } from "../book/listings.js";
import type { Book } from "../book/load.js";
import { captionParts, listingCodeHtml } from "../components/listing-html.js";
import { checkedChapter } from "./chapter-file.js";
import { failAt } from "./fail.js";
import { highlightListing } from "./highlight.js";

/** What each numbered kind must hold: a table, a fenced code block, or anything at all for a figure. */
const REQUIRED_CONTENT: Record<NumberedKind, RootContent["type"] | undefined> = {
  figure: undefined,
  listing: "code",
  table: "table",
};

// remark-directive's types add these node types to mdast's content unions.
type ContainerDirective = Extract<RootContent, { type: "containerDirective" }>;
type TextDirective = Extract<RootContent, { type: "textDirective" }>;
type LeafDirective = Extract<RootContent, { type: "leafDirective" }>;

/**
 * Turns the book's directives into HTML-ready nodes. `:::figure[Caption]{#id}`, `:::listing[…]{#id}` and
 * `:::table[…]{#id}` become a `<figure>` with an id such as `fig-<id>`, a caption and an empty number that the
 * numbering plugin fills in. `::listing[Caption]{#id file="…" region="…"}` shows a region of a real file, which the
 * book index has already cut and checked, highlighted with Shiki, under a caption with its number, path, line range
 * and pin. `:analogy[label]{#id}` marks a use of a registered analogy. Any other directive fails,
 * except a bare text directive such as the `:Invent` in "re:Invent" or the `:tools` in `[[ch:tools]]`, which is put
 * back as the text it was.
 */
export function remarkBookDirectives(options: { readonly book: Book }) {
  const { book } = options;
  return async (tree: Root, file: VFile): Promise<void> => {
    const { outline } = checkedChapter(file);
    const listings: Promise<void>[] = [];
    walk(tree, (node) => {
      if (node.type === "containerDirective" && isNumberedKind(node.name)) return numbered(node, node.name, file);
      if (node.type === "leafDirective" && node.name === "listing") {
        const { figure, code } = fileListing(node, book, outline.slug, file);
        listings.push(code);
        return figure;
      }
      if (node.type === "textDirective" && node.name === "analogy") return analogy(node, book, outline.number, file);
      if (node.type === "textDirective" && isBare(node)) return restored(node);
      if (node.type === "containerDirective" || node.type === "leafDirective" || node.type === "textDirective") {
        const colons = { containerDirective: ":::", leafDirective: "::", textDirective: ":" }[node.type];
        return failAt(file, `unknown directive ${colons}${node.name}; escape the colon as \\: if it is text`, node);
      }
      return undefined;
    });
    mergeText(tree);
    await Promise.all(listings);
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

/** Whether a caption's nodes hold no text but spaces, as in `:::figure[ ]`, which would render as an empty caption. */
function isBlank(nodes: readonly RootContent[]): boolean {
  const text = (node: RootContent): string =>
    "value" in node && typeof node.value === "string"
      ? node.value
      : "children" in node
        ? (node.children as RootContent[]).map(text).join("")
        : "";
  return nodes.map(text).join("").trim() === "";
}

const isBare = (node: TextDirective): boolean =>
  node.children.length === 0 && Object.keys(node.attributes ?? {}).length === 0;

function numbered(node: ContainerDirective, kind: NumberedKind, file: VFile): ContainerDirective {
  const id = node.attributes?.id;
  const labelIndex = node.children.findIndex((child) => child.type === "paragraph" && child.data?.directiveLabel);
  const label = node.children[labelIndex] as Paragraph | undefined;
  if (label === undefined || isBlank(label.children)) {
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
    return failAt(file, `:analogy{#${id ?? ""}} is not in the analogy register (${book.names.analogies})`, node);
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

/**
 * A `::listing` as a figure: a caption that the numbering plugin completes with "Listing 3.2", then the listing's path,
 * line range and pin, and the code. The caption parts and the code panel come from `listing-html.ts`, which the
 * ListingBlock component also uses, so the listing takes the panel's colours and shows each line's number in the file.
 * The code arrives as raw HTML that `highlighted` fills in once Shiki has tokenised the lines; raw HTML reaches the
 * page after Astro's own highlighter has run, so Astro does not highlight it again.
 */
function fileListing(
  node: LeafDirective,
  book: Book,
  slug: string,
  file: VFile,
): { readonly figure: ContainerDirective; readonly code: Promise<void> } {
  const id = node.attributes?.id ?? "";
  const block = book.index.written.get(slug)?.blocks.find((found) => found.kind === "listing" && found.id === id);
  if (block?.source === undefined) {
    return failAt(file, `the book index has no listing "${id}" from a file; rerun the build`, node);
  }
  if (isBlank(node.children)) {
    return failAt(file, `a listing needs a caption, written ::listing[Caption]{#${id} file="…"}`, node);
  }
  const { source, number } = block;
  const domId = `${NUMBERED_KINDS.listing.prefix}-${id}`;
  const caption: Paragraph = {
    type: "paragraph",
    data: { hName: "figcaption", hProperties: { className: ["listing__caption"], id: `${domId}-caption` } },
    children: [
      { type: "text", value: "", data: { hName: "span", hProperties: { className: ["listing__number", "number"] } } },
      {
        type: "emphasis",
        data: { hName: "span", hProperties: { className: ["listing__title"] } },
        children: node.children,
      },
      ...captionParts(source.path, source.lines, source.pin).map(
        ({ className, text }): PhrasingContent => ({
          type: "text",
          value: text,
          data: { hName: "span", hProperties: { className: [className] } },
        }),
      ),
    ],
  };
  const html: Html = { type: "html", value: "" };
  const figure: ContainerDirective = {
    type: "containerDirective",
    name: "listing",
    attributes: node.attributes ?? {},
    children: [caption, html],
    data: {
      hName: "figure",
      hProperties: {
        id: domId,
        className: ["numbered", "listing", "panel"],
        dataNumbered: "listing",
        dataNumberedId: id,
        ariaLabelledBy: [`${domId}-caption`],
      },
    },
    ...(node.position ? { position: node.position } : {}),
  };
  return { figure, code: highlighted(html, source, number, domId) };
}

/** Fills the listing's HTML node with its code panel once Shiki has tokenised the lines. */
async function highlighted(html: Html, source: ListingSource, number: string, domId: string): Promise<void> {
  html.value = listingCodeHtml(domId, number, await highlightListing(source), new Map());
}
