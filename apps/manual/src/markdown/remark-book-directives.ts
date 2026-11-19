import type { Html, List, ListItem, Paragraph, Parent, PhrasingContent, Root, RootContent } from "mdast";
import { visit } from "unist-util-visit";
import type { VFile } from "vfile";
import { isFileListing, isNumberedKind, NUMBERED_KINDS, type NumberedKind } from "../book/book-index.js";
import type { ListingSource } from "../book/listings.js";
import type { Book } from "../book/load.js";
import { noteNumbers } from "../book/notes.js";
import { KEBAB_ID } from "../book/outline-rules.js";
import { replayEvents } from "../book/transcripts.js";
import { captionParts, listingCodeHtml, NOTES_LABEL } from "../components/listing-html.js";
import { replayHtml } from "../components/replay-html.js";
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
 * and pin; written as a `:::listing` container, it holds `::note[Text]{#id}` notes for the lines marked
 * `// book:note <id>`, and with `replay` it adds the recorded run of its example. `:::tabs` holds file listings from
 * different harnesses, one tab each. `:::box[Title]{#id}` sets a passage apart as an `<aside>` under its own heading.
 * `:analogy[label]{#id}` marks a use of a registered analogy. Any other directive
 * fails, except a bare text directive such as the `:Invent` in "re:Invent" or the `:tools` in `[[ch:tools]]`, which
 * is put back as the text it was.
 */
export function remarkBookDirectives(options: { readonly book: Book }) {
  const { book } = options;
  return async (tree: Root, file: VFile): Promise<void> => {
    const { outline } = checkedChapter(file);
    const listings: Promise<void>[] = [];
    const depths = nestedHeadingDepths(tree);
    walk(tree, (node) => {
      // A directive this plugin built, such as a tab panel or a listing's figure, already names its element.
      if (node.type === "containerDirective" && node.data?.hName !== undefined) return undefined;
      if ((node.type === "leafDirective" || node.type === "containerDirective") && isFileListing(node)) {
        const { figure, code } = fileListing(node, book, outline.slug, file);
        listings.push(code);
        return figure;
      }
      if (node.type === "containerDirective" && isNumberedKind(node.name)) return numbered(node, node.name, file);
      if (node.type === "containerDirective" && node.name === "tabs") return tabs(node, file, depths.get(node) ?? 3);
      if (node.type === "containerDirective" && node.name === "box")
        return box(node, file, depths.get(node) ?? 3, tree.children.includes(node));
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
  const table = kind === "table";
  const captionId = `${prefix}-${id}--caption`;
  const caption: Paragraph = {
    type: "paragraph",
    data: table ? { hName: "figcaption", hProperties: { id: captionId } } : { hName: "figcaption" },
    children: [
      { type: "text", value: "", data: { hName: "span", hProperties: { className: ["number"] } } },
      { type: "text", value: " " },
      ...label.children,
    ],
  };
  return {
    ...node,
    // A figure's caption goes below it; a table's and a listing's go above, where readers look for them.
    children: kind === "figure" ? [...body, caption] : [caption, ...(table ? scrolling(body, captionId) : body)],
    data: {
      hName: "figure",
      hProperties: {
        id: `${prefix}-${id}`,
        className: ["numbered", kind],
        dataNumbered: kind,
        dataNumberedId: id,
        ...(table ? { ariaLabelledBy: [captionId] } : {}),
      },
    },
  };
}

/**
 * A table wrapped in the region that scrolls it sideways when it is wider than the column, as on a narrow phone. The
 * region takes focus, so a reader without a pointer can scroll it, and the table's caption names it, as a listing's
 * caption names its code.
 */
function scrolling(body: ContainerDirective["children"], captionId: string): ContainerDirective["children"] {
  return body.map((child) =>
    child.type === "table"
      ? ({
          type: "containerDirective",
          name: "table-scroll",
          attributes: {},
          children: [child],
          data: {
            hName: "div",
            hProperties: { className: ["table__scroll"], tabIndex: 0, role: "group", ariaLabelledBy: [captionId] },
          },
        } as ContainerDirective)
      : child,
  );
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
 * The heading level of each `:::tabs` block's tab headings and each `:::box`'s title: one below the heading the block
 * follows, so the headings keep the page's outline without JavaScript. A block before the chapter's first heading sits
 * under the chapter's title, a level-1 heading, so its headings are level 2. Levels stop at 6.
 *
 * A box marked `top`, as in `:::box[Title]{#id top}`, is the exception: its title is a level-2 heading, so the box
 * stands beside the chapter's sections and appears in "On this page". A `top` box sits directly in the chapter, not
 * inside another block. Position never decides this: a box without `top` is always one level below the heading it
 * follows, wherever it sits.
 *
 * A box's title counts as a heading for what the box holds, so tabs inside a box get tab headings one level below
 * the box's title: level 4 in a box inside a `##` section, level 3 in a top-level box.
 */
function nestedHeadingDepths(tree: Root): Map<RootContent, number> {
  const depths = new Map<RootContent, number>();
  let current = 1;
  const visitAll = (parent: Parent): void => {
    parent.children.forEach((node) => {
      if (node.type === "heading") current = node.depth;
      const isBox = node.type === "containerDirective" && node.name === "box";
      if (isBox || (node.type === "containerDirective" && node.name === "tabs")) {
        const topLevel = isBox && node.attributes !== null && node.attributes !== undefined && "top" in node.attributes;
        depths.set(node, topLevel ? 2 : Math.min(current + 1, 6));
      }
      if (!("children" in node)) return;
      if (isBox) {
        // A box holds no heading, so the level after it is the one before it.
        const outside = current;
        current = depths.get(node) ?? outside + 1;
        visitAll(node);
        current = outside;
      } else {
        visitAll(node);
      }
    });
  };
  visitAll(tree);
  return depths;
}

/**
 * `:::box[Title]{#id}` as an `<aside>` named by its title, which becomes a heading at the level `nestedHeadingDepths`
 * gives it, with the box's id, so a link to `#id` lands on the title. The box holds any Markdown but a heading or
 * another box, so its title stays the one heading the page's outline gets from it; a file listing inside it is numbered
 * and checked like any other. A box takes no attribute but its id and the bare `top`, which must sit directly in
 * the chapter (`topLevel`).
 */
function box(node: ContainerDirective, file: VFile, depth: number, topLevel: boolean): ContainerDirective {
  const id = node.attributes?.id;
  if (id === undefined || id === null || !KEBAB_ID.test(id)) {
    return failAt(file, "a box needs a kebab-case id, written :::box[Title]{#some-id}", node);
  }
  const extra = Object.keys(node.attributes ?? {}).find((name) => name !== "id" && name !== "top");
  if (extra !== undefined) {
    return failAt(file, `a box takes no attribute but its id and the bare flag top, not ${extra}`, node);
  }
  const top = node.attributes?.top;
  if (top !== undefined && top !== null && top !== "") {
    return failAt(file, `top takes no value; write :::box[Title]{#${id} top}, not top=${top}`, node);
  }
  if (top !== undefined && !topLevel) {
    return failAt(
      file,
      `a box marked top must sit directly in the chapter, not inside another block; drop top from :::box{#${id}} or move the box out of that block`,
      node,
    );
  }
  const labelIndex = node.children.findIndex((child) => child.type === "paragraph" && child.data?.directiveLabel);
  const label = node.children[labelIndex] as Paragraph | undefined;
  if (label === undefined || isBlank(label.children)) {
    return failAt(file, `a box needs a title, written :::box[Title]{#${id}}`, node);
  }
  const body = node.children.filter((_, i) => i !== labelIndex);
  if (body.length === 0) return failAt(file, "a box must hold its content", node);
  let inner = undefined as RootContent | undefined;
  visit({ type: "root", children: body } satisfies Root, (child) => {
    if (inner !== undefined) return;
    if (child.type === "heading" || (child.type === "containerDirective" && child.name === "box")) inner = child;
  });
  if (inner !== undefined) {
    return failAt(file, "a box may hold no heading and no other box; its title is its heading", inner);
  }
  const heading: Paragraph = {
    type: "paragraph",
    data: { hName: `h${depth}`, hProperties: { className: ["box__heading"], id } },
    children: label.children,
  };
  return {
    ...node,
    children: [heading, ...body],
    data: { hName: "aside", hProperties: { className: ["box"], ariaLabelledBy: [id] } },
  };
}

/** Listings inside `:::tabs`, whose tab heading shows their caption, so their own caption leaves it out. */
const tabbed = new WeakSet<object>();

/** The plain text of a caption, for a tab's heading. */
function plainText(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((node) =>
      "value" in node ? node.value : "children" in node ? plainText(node.children as PhrasingContent[]) : "",
    )
    .join("")
    .trim();
}

/** A file listing's caption: a leaf directive's children, or a container's label paragraph. */
function captionOf(node: LeafDirective | ContainerDirective): PhrasingContent[] {
  if (node.type === "leafDirective") return node.children;
  const label = node.children.find((child) => child.type === "paragraph" && child.data?.directiveLabel);
  return (label as Paragraph | undefined)?.children ?? [];
}

/** The `::note` directives of a file listing, by id; the book index has checked them against the file's markers. */
function notesOf(node: LeafDirective | ContainerDirective): ReadonlyMap<string, PhrasingContent[]> {
  if (node.type === "leafDirective") return new Map();
  const notes = new Map<string, PhrasingContent[]>();
  for (const child of node.children) {
    if (child.type === "leafDirective" && child.name === "note" && child.attributes?.id) {
      notes.set(child.attributes.id, child.children);
    }
  }
  return notes;
}

/**
 * `:::tabs` as the tabs component's markup: each file listing in a panel under a heading taken from its caption, so the
 * listings follow one another without JavaScript and src/scripts/tabs.ts turns the headings into a tab list. The
 * block must hold two or more file listings and nothing else.
 */
function tabs(node: ContainerDirective, file: VFile, depth: number): ContainerDirective {
  if (node.children.some((child) => child.type === "paragraph" && child.data?.directiveLabel)) {
    return failAt(file, ":::tabs takes no caption; each listing in it is a tab with its own caption", node);
  }
  const stray = node.children.find(
    (child) => !((child.type === "leafDirective" || child.type === "containerDirective") && isFileListing(child)),
  );
  if (stray !== undefined) {
    return failAt(file, ':::tabs may hold only listings of files, written ::listing[Tab]{#id file="…"}', stray);
  }
  if (node.children.length < 2) return failAt(file, ":::tabs needs two or more listings, one for each tab", node);
  const panels = node.children.map((child): ContainerDirective => {
    const listing = child as LeafDirective | ContainerDirective;
    const listingId = `${NUMBERED_KINDS.listing.prefix}-${listing.attributes?.id ?? ""}`;
    const id = `${listingId}-panel`;
    tabbed.add(listing);
    return {
      type: "containerDirective",
      name: "tab",
      attributes: {},
      children: [
        {
          type: "paragraph",
          data: { hName: `h${depth}`, hProperties: { className: ["tabs__heading"], id: `${listingId}-heading` } },
          children: [{ type: "text", value: plainText(captionOf(listing)) }],
        },
        listing,
      ],
      data: { hName: "section", hProperties: { className: ["tabs__panel"], id } },
    };
  });
  return {
    ...node,
    children: panels,
    data: { hName: "div", hProperties: { className: ["tabs"], dataLabel: "SDK" } },
  };
}

/**
 * A file listing as a figure: a caption that the numbering plugin completes with "Listing 3.2", then the listing's
 * path, line range and pin, the code, and its notes as a numbered list. The caption parts and the code panel come
 * from `listing-html.ts`, which the ListingBlock component also uses, so the listing takes the panel's colours and
 * shows each line's number in the file; a line with a note shows its numbered marker, a link to the note. The code
 * arrives as raw HTML that `highlighted` fills in once Shiki has tokenised the lines; raw HTML reaches the page after
 * Astro's own highlighter has run, so Astro does not highlight it again. A listing with `replay` is followed by the
 * recorded run of its example, in a wrapper that keeps the two together.
 */
function fileListing(
  node: LeafDirective | ContainerDirective,
  book: Book,
  slug: string,
  file: VFile,
): { readonly figure: ContainerDirective; readonly code: Promise<void> } {
  const id = node.attributes?.id ?? "";
  const block = book.index.written.get(slug)?.blocks.find((found) => found.kind === "listing" && found.id === id);
  if (block?.source === undefined) {
    return failAt(file, `the book index has no listing "${id}" from a file; rerun the build`, node);
  }
  const label = captionOf(node);
  if (isBlank(label)) {
    return failAt(file, `a listing needs a caption, written ::listing[Caption]{#${id} file="…"}`, node);
  }
  const { source, number } = block;
  const domId = `${NUMBERED_KINDS.listing.prefix}-${id}`;
  const caption: Paragraph = {
    type: "paragraph",
    data: { hName: "figcaption", hProperties: { className: ["listing__caption"], id: `${domId}-caption` } },
    children: [
      { type: "text", value: "", data: { hName: "span", hProperties: { className: ["listing__number", "number"] } } },
      // In a tab, the tab's heading is the caption, so the caption does not repeat it.
      ...(tabbed.has(node)
        ? []
        : [
            {
              type: "emphasis",
              data: { hName: "span", hProperties: { className: ["listing__title"] } },
              children: label,
            } satisfies PhrasingContent,
          ]),
      ...captionParts(source.path, source.lines, source.pin, !book.live.compared.has(source.path)).map(
        ({ className, text }): PhrasingContent => ({
          type: "text",
          value: text,
          data: { hName: "span", hProperties: { className: [className] } },
        }),
      ),
    ],
  };
  const notes = notesOf(node);
  const numbers = noteNumbers(source, new Set(notes.keys()));
  const html: Html = { type: "html", value: "" };
  const figure: ContainerDirective = {
    type: "containerDirective",
    name: "listing",
    attributes: node.attributes ?? {},
    children: numbers.size === 0 ? [caption, html] : [caption, html, notesList(domId, numbers, notes)],
    data: {
      hName: "figure",
      hProperties: {
        id: domId,
        className: ["numbered", "listing", "panel"],
        dataNumbered: "listing",
        dataNumberedId: id,
        ariaLabelledBy: tabbed.has(node) ? [`${domId}-heading`, `${domId}-caption`] : [`${domId}-caption`],
      },
    },
    ...(node.position ? { position: node.position } : {}),
  };
  const code = highlighted(html, source, number, domId, numbers);
  if (source.replay === undefined) return { figure, code };
  const replay: Html = {
    type: "html",
    value: replayHtml({
      id: `${domId}-replay`,
      title: `Recorded run of Listing ${number}`,
      source: source.replay.path,
      events: replayEvents(source.replay.transcript),
      listing: domId,
      controlsLabel: `Replay of Listing ${number}`,
      listingLines: new Set(source.lines.map((line) => line.number)),
    }),
  };
  const pair: ContainerDirective = {
    type: "containerDirective",
    name: "listing-replay",
    attributes: {},
    children: [figure, replay],
    data: { hName: "div", hProperties: { className: ["listing-replay"] } },
  };
  return { figure: pair, code };
}

/**
 * The notes under a listing as a numbered list in the order of their markers, each item's id the target of its
 * marker's link. The notes stay Markdown, so citations, glossary terms and references in them still render.
 */
function notesList(
  domId: string,
  numbers: ReadonlyMap<string, number>,
  notes: ReadonlyMap<string, PhrasingContent[]>,
): List {
  const items = [...numbers.keys()].map(
    (id): ListItem => ({
      type: "listItem",
      spread: false,
      data: { hProperties: { id: `${domId}-note-${id}` } },
      children: [{ type: "paragraph", children: notes.get(id) ?? [] }],
    }),
  );
  return {
    type: "list",
    ordered: true,
    spread: false,
    data: { hProperties: { className: ["annotations"], ariaLabel: NOTES_LABEL } },
    children: items,
  };
}

/** Fills the listing's HTML node with its code panel once Shiki has tokenised the lines. */
async function highlighted(
  html: Html,
  source: ListingSource,
  number: string,
  domId: string,
  numbers: ReadonlyMap<string, number>,
): Promise<void> {
  const lines = (await highlightListing(source)).map((line) =>
    line.note !== undefined && numbers.has(line.note) ? { ...line, highlight: true } : line,
  );
  html.value = listingCodeHtml(domId, number, lines, numbers);
}
