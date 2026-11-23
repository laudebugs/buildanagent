/**
 * Turns a docs page's source into the Markdown of its twin. The source is parsed to an mdast tree (with MDX syntax for
 * an `.mdx` page and the `::figure` directive for both), and the twin is the page's own text with each part that only
 * makes sense in the rendered site replaced by plain Markdown:
 *
 * - a `file=` fence by the code it names (example-code.ts, the code the page shows);
 * - a `::figure` by a line with its caption and alt text, without the drawing;
 * - Starlight's MDX components by Markdown: tabs by a bold label and the code, an aside by a blockquote, link cards
 *   and buttons by list items;
 * - imports, exports, MDX comments and HTML comments by nothing, and an MDX expression that is a string literal by the
 *   string's text; any other expression is an error, like an unknown component;
 * - a link, image or reference definition that points at a docs page by the address of that page's twin when it has
 *   one, and a root-relative address by the same address on the site otherwise, so an asset keeps its own name.
 *
 * Everything else stays as the author wrote it, because the twin takes the source's own characters by position, not by
 * serializing the tree again. A component the module doesn't know is an error, so a new component can't reach a twin as
 * a raw tag.
 */
import type { Definition, Image, Link, Paragraph, Root, RootContent } from "mdast";
import type {} from "remark-directive";
import remarkDirective from "remark-directive";
import type {} from "remark-mdx";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { exampleSource, parseExampleRef, rewriteMeta } from "../plugins/example-code.js";

/** A node of any kind the tree can hold, with the position the parser gives every node it reads. */
type AnyNode = Root | RootContent;

/** What the flattening needs to know about the site. */
export interface FlattenContext {
  /** The site's origin without a trailing slash, such as `https://docs.buildanagent.fyi`. */
  readonly site: string;
  /**
   * Whether the page at this slug has a twin. The build passes a check against the pages `twinPages()` lists, so a link
   * to an asset or an unknown address stays an address on the site; `hasTwin()` in rule.ts is the rule for the pages.
   */
  readonly hasTwin: (slug: string) => boolean;
  /** The page's path, for error messages. */
  readonly page: string;
}

/** A page the twin step can't flatten, with the page and line in the message. */
export class TwinError extends Error {
  override readonly name = "TwinError";
}

const ASIDE_NAMES = new Set(["note", "tip", "caution", "danger"]);

function fail(ctx: FlattenContext, node: AnyNode, message: string): never {
  throw new TwinError(`${ctx.page}:${node.position?.start.line ?? "?"}: ${message}`);
}

/** The text of a JSX attribute with a string value, or `undefined`. */
function attribute(node: RootContent, name: string): string | undefined {
  if (node.type !== "mdxJsxFlowElement" && node.type !== "mdxJsxTextElement") return undefined;
  const found = node.attributes.find((attr) => attr.type === "mdxJsxAttribute" && attr.name === name);
  return found !== undefined && "value" in found && typeof found.value === "string" ? found.value : undefined;
}

function offsets(node: AnyNode): { start: number; end: number; column: number } {
  const start = node.position?.start;
  const end = node.position?.end;
  if (start?.offset === undefined || end?.offset === undefined) throw new TwinError("a parsed node has no position");
  return { start: start.offset, end: end.offset, column: start.column };
}

/** Removes the indent `width` of every line after the first, which is how a node inside a container is written. */
function dedent(text: string, width: number): string {
  if (width <= 0) return text;
  const [first = "", ...rest] = text.split("\n");
  const strip = new RegExp(`^ {0,${width}}`);
  return [first, ...rest.map((line) => line.replace(strip, ""))].join("\n");
}

/** Indents every line after the first by `width` spaces, so a replacement sits at the column it replaces. */
function indent(text: string, width: number): string {
  if (width <= 0) return text;
  const pad = " ".repeat(width);
  return text
    .split("\n")
    .map((line, index) => (index === 0 || line === "" ? line : pad + line))
    .join("\n");
}

function fenceOf(code: string, lang: string | null | undefined, meta: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((run) => run[0].length));
  const mark = "`".repeat(Math.max(3, longest + 1));
  return `${mark}${lang ?? ""}${meta === "" ? "" : ` ${meta}`}\n${code}\n${mark}`;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The visible text of a node's children, for a button's label. */
function textOf(node: AnyNode): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  return "children" in node ? (node.children as AnyNode[]).map(textOf).join("") : "";
}

/** One replacement of a span of the source. */
interface Edit {
  readonly start: number;
  readonly end: number;
  readonly column: number;
  readonly text: string;
}

/** The part of an ESTree statement the expression check reads. */
interface EstreeStatement {
  readonly type: string;
  readonly expression: {
    readonly type: string;
    readonly value?: unknown;
    readonly quasis?: readonly { readonly value: { readonly cooked?: string | null } }[];
    readonly expressions?: readonly unknown[];
  };
}

/** The index of the `]` that closes the label opened just before `from`, skipping escapes and nested brackets. */
function labelEnd(raw: string, from: number): number {
  let depth = 0;
  for (let i = from; i < raw.length; i += 1) {
    const char = raw.charAt(i);
    if (char === "\\") i += 1;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * Where the address sits in the source text of a link, image or definition: from `from` to `to`, angle brackets
 * included. The span comes from the node's own text, so spacing, an angle-bracket form and a title are all found.
 */
function destinationSpan(raw: string, node: Link | Image | Definition): { from: number; to: number } | undefined {
  let after: number;
  if (node.type === "definition") {
    const label = /^\[(?:\\.|[^\]\\])*\]:\s*/.exec(raw);
    if (label === null) return undefined;
    after = label[0].length;
  } else {
    const close = labelEnd(raw, node.type === "image" ? 2 : 1);
    if (close === -1) return undefined;
    const open = /^\]\(\s*/.exec(raw.slice(close));
    if (open === null) return undefined;
    after = close + open[0].length;
  }
  if (raw.charAt(after) === "<") {
    const end = raw.indexOf(">", after);
    return end === -1 ? undefined : { from: after, to: end + 1 };
  }
  let depth = 0;
  let to = after;
  for (; to < raw.length; to += 1) {
    const char = raw.charAt(to);
    if (/\s/.test(char)) break;
    if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return to > after ? { from: after, to } : undefined;
}

class Flattener {
  private readonly source: string;
  private readonly ctx: FlattenContext;

  constructor(source: string, ctx: FlattenContext) {
    this.source = source;
    this.ctx = ctx;
  }

  /**
   * The address a link to `url` gets in a twin: a docs page's twin, or the same address on the site. An image is never
   * a page, so its address only gains the site.
   */
  link(url: string, image = false): string {
    if (!url.startsWith("/") || url.startsWith("//")) return url;
    const [path = "", ...rest] = url.split(/(?=[?#])/);
    const slug = path.replace(/^\/+|\/+$/g, "");
    const suffix = rest.join("");
    if (!image && this.ctx.hasTwin(slug)) return `${this.ctx.site}${slug === "" ? "/index" : `/${slug}`}.md${suffix}`;
    return `${this.ctx.site}${path}${suffix}`;
  }

  /** The replacement text for a node that doesn't survive into a twin, or `undefined` when the node stays as written. */
  replace(node: RootContent): string | undefined {
    switch (node.type) {
      case "mdxjsEsm":
        return "";
      case "mdxFlowExpression":
      case "mdxTextExpression":
        return this.expression(node);
      case "html":
        return /^<!--[\s\S]*-->\s*$/.test(node.value) ? "" : undefined;
      case "code": {
        const ref = parseExampleRef(node.meta);
        if (ref === undefined) return undefined;
        return fenceOf(exampleSource(ref), node.lang, rewriteMeta(node.meta, ref));
      }
      case "mdxJsxFlowElement":
      case "mdxJsxTextElement":
        return this.component(node);
      case "leafDirective":
        return node.name === "figure" ? this.figure(node) : undefined;
      case "containerDirective":
        return ASIDE_NAMES.has(node.name) ? this.directiveAside(node) : undefined;
      default:
        return undefined;
    }
  }

  /**
   * The text an MDX expression leaves in a twin. A comment, which parses to no statement, leaves nothing; a string
   * literal leaves its value, as the rendered page shows it; anything else is computed when the page renders, so a twin
   * can't know its text and the build fails.
   */
  private expression(node: RootContent & { type: "mdxFlowExpression" | "mdxTextExpression" }): string {
    const body = (node.data as { estree?: { body: readonly EstreeStatement[] } } | undefined)?.estree?.body;
    if (body === undefined) {
      if (node.value.trim() === "" || /^\s*\/\*[\s\S]*\*\/\s*$/.test(node.value)) return "";
    } else if (body.length === 0) return "";
    else if (body.length === 1 && body[0]?.type === "ExpressionStatement") {
      const expression = body[0].expression;
      if (expression.type === "Literal" && typeof expression.value === "string") return expression.value;
      const [only] = expression.quasis ?? [];
      if (expression.type === "TemplateLiteral" && expression.expressions?.length === 0 && only?.value.cooked != null)
        return only.value.cooked;
    }
    return fail(
      this.ctx,
      node,
      `the expression {${node.value.trim()}} is computed when the page renders, so its twin can't show it; write the text out`,
    );
  }

  /** The edit that rewrites a link, image or reference definition's address, or `undefined` when it stays. */
  private urlEdit(node: RootContent): Edit | undefined {
    if (node.type !== "link" && node.type !== "image" && node.type !== "definition") return undefined;
    if (!node.url.startsWith("/")) return undefined;
    const { start, end, column } = offsets(node);
    const raw = this.source.slice(start, end);
    const span = destinationSpan(raw, node);
    if (span === undefined) return undefined;
    const written = raw.slice(span.from, span.to);
    const next = this.link(written.replace(/^<|>$/g, ""), node.type === "image");
    if (next === written.replace(/^<|>$/g, "")) return undefined;
    const text = written.startsWith("<") ? `<${next}>` : next;
    return { start: start + span.from, end: start + span.to, column, text };
  }

  private figure(node: RootContent & { type: "leafDirective" }): string {
    const caption = this.slice(node.children).trim().replace(/\.$/, "");
    const alt = (node.attributes?.alt ?? "").trim();
    return `**Figure: ${caption}.** ${alt}`;
  }

  private directiveAside(node: RootContent & { type: "containerDirective" }): string {
    const [first, ...rest] = node.children;
    const labelled =
      first?.type === "paragraph" && (first.data as { directiveLabel?: boolean } | undefined)?.directiveLabel;
    const label = labelled === true ? textOf(first as Paragraph) : capitalize(node.name);
    return this.aside(label, labelled === true ? rest : node.children);
  }

  private aside(label: string, body: readonly RootContent[]): string {
    const text = this.slice(body).trim();
    return quote(`**${label}**${text === "" ? "" : `\n\n${text}`}`);
  }

  private component(node: RootContent & { type: "mdxJsxFlowElement" | "mdxJsxTextElement" }): string {
    const name = node.name ?? "";
    const body = (): string => this.slice(node.children).trim();
    switch (name) {
      case "Tabs":
      case "CardGrid":
      case "Steps":
      case "FileTree":
      case "": {
        // Link cards read as a list, so they stay on adjacent lines; anything else is a run of blocks.
        const cards = node.children.length > 0 && node.children.every((c) => attribute(c, "href") !== undefined);
        // Tab labels and cards are blocks of their own, so they never run into the block before them.
        const tabs =
          node.children.length > 0 &&
          node.children.every((c) => c.type === "mdxJsxFlowElement" && c.name === "TabItem");
        if (cards) return node.children.map((c) => this.replace(c) ?? "").join("\n");
        return tabs ? node.children.map((c) => this.replace(c) ?? "").join("\n\n") : body();
      }
      case "TabItem": {
        const label = attribute(node, "label");
        if (label === undefined) fail(this.ctx, node, "a <TabItem> needs a label");
        return `**${label}**\n\n${body()}`;
      }
      case "Card": {
        const title = attribute(node, "title");
        return title === undefined ? body() : `**${title}**\n\n${body()}`;
      }
      case "Aside": {
        const type = attribute(node, "type") ?? "note";
        return this.aside(attribute(node, "title") ?? capitalize(type), node.children);
      }
      case "LinkCard": {
        const title = attribute(node, "title") ?? "";
        const href = this.link(attribute(node, "href") ?? "");
        const description = attribute(node, "description");
        return `- [${title}](${href})${description === undefined ? "" : `: ${description}`}`;
      }
      case "LinkButton":
        return `- [${node.children.map(textOf).join("").trim()}](${this.link(attribute(node, "href") ?? "")})`;
      case "Badge":
        return attribute(node, "text") ?? "";
      case "Icon":
        return "";
      default:
        return fail(
          this.ctx,
          node,
          `no Markdown form for <${name}>; add one to src/twins/flatten.ts so it can't reach a twin as a raw tag`,
        );
    }
  }

  /** The source text of `nodes`, from the first one's start to the last one's end, with every replacement made. */
  slice(nodes: readonly RootContent[]): string {
    const first = nodes[0];
    const last = nodes.at(-1);
    if (first === undefined || last === undefined) return "";
    const from = offsets(first);
    const to = offsets(last);
    const edits: Edit[] = [];
    const collect = (node: RootContent): void => {
      const text = this.replace(node);
      if (text !== undefined) {
        edits.push({ ...offsets(node), text });
        return;
      }
      if ("children" in node) for (const child of node.children as RootContent[]) collect(child);
      // After the children, which sit before the address, so the edits stay in source order. The edit covers only the
      // address, so the rest of the link keeps its own line breaks and indent.
      const url = this.urlEdit(node);
      if (url !== undefined) edits.push(url);
    };
    for (const node of nodes) collect(node);
    edits.sort((a, b) => a.start - b.start);
    let out = "";
    let cursor = from.start;
    for (const edit of edits) {
      out += this.source.slice(cursor, edit.start) + indent(edit.text, edit.column - 1);
      cursor = edit.end;
    }
    out += this.source.slice(cursor, to.end);
    return dedent(out, from.column - 1);
  }
}

/** Blank lines beyond one are dropped, except inside a fenced block, whose lines stay as they are. */
function tidy(text: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  let blank = 0;
  for (const line of text.split("\n")) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? "";
    if (fence === undefined) {
      if (mark !== "") fence = mark;
    } else if (mark.startsWith(fence.charAt(0)) && mark.length >= fence.length) {
      fence = undefined;
    }
    if (fence === undefined && line.trim() === "") {
      blank += 1;
      if (blank > 1) continue;
    } else blank = 0;
    out.push(line);
  }
  return `${out.join("\n").trim()}\n`;
}

/**
 * The body of a twin: the page's Markdown after its front matter, flattened as the module comment says.
 * Pass `mdx` for an `.mdx` page, whose parser reads JSX, imports and expressions.
 */
export function flattenBody(body: string, mdx: boolean, ctx: FlattenContext): string {
  const processor = unified().use(remarkParse).use(remarkDirective);
  if (mdx) processor.use(remarkMdx);
  const tree = processor.parse(body) as Root;
  const flat = new Flattener(body, ctx).slice(tree.children);
  return tidy(flat);
}

/** A page's twin: its title as the heading, its description, then the flattened body. */
export function twinMarkdown(
  page: { readonly title: string; readonly description: string | undefined },
  body: string,
  mdx: boolean,
  ctx: FlattenContext,
): string {
  const head = `# ${page.title}\n\n${page.description === undefined ? "" : `${page.description}\n\n`}`;
  return `${head}${flattenBody(body, mdx, ctx)}`;
}
