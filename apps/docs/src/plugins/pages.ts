/** Reads the docs pages and splits them into the parts the content checks look at. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { API_PACKAGES } from "../api/packages.js";

export const DOCS_DIR = fileURLToPath(new URL("../content/docs/", import.meta.url));

/** The fence languages that mean TypeScript, so every check that looks for TypeScript blocks agrees on them. */
const TYPESCRIPT_LANGUAGES: ReadonlySet<string> = new Set(["ts", "tsx", "typescript", "mts", "cts"]);

/** Whether a fence or component language names TypeScript. The match ignores case, so `TS` and `TypeScript` count. */
export function isTypeScriptLang(lang: string): boolean {
  return TYPESCRIPT_LANGUAGES.has(lang.toLowerCase());
}

/** A fenced code block, with the line of its opening fence and the paragraph text before it. */
export interface Fence {
  readonly line: number;
  readonly lang: string;
  readonly meta: string;
  readonly code: string;
  /** The line before the fence, with its blank lines skipped: what the code is introduced by. */
  readonly before: string;
}

/** One docs page: its path under the docs folder, its front matter and its Markdown body without fences. */
export interface Page {
  readonly path: string;
  readonly frontmatter: Readonly<Record<string, string>>;
  /** Every string in the front matter, the hero text and action labels included, which a reader sees. */
  readonly texts: readonly string[];
  readonly body: string;
  readonly fences: readonly Fence[];
}

/** TypeDoc writes the API reference under these folders at build time, so the pages in them are not ours to check. */
const GENERATED = API_PACKAGES.map((pkg) => join(DOCS_DIR, pkg.output));

/**
 * The path of every `.md` and `.mdx` page we write under the docs folder. The generated reference folders are skipped
 * while walking, because TypeDoc deletes and rewrites them during a build that another test may be running.
 */
export function pagePaths(dir = DOCS_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return GENERATED.includes(path) ? [] : pagePaths(path);
      return /\.mdx?$/.test(entry.name) ? [path] : [];
    })
    .sort();
}

/** Every string inside a parsed YAML value, at any depth. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(stringsIn);
  return [];
}

function frontmatterOf(text: string): { frontmatter: Record<string, string>; texts: string[]; rest: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match === null) return { frontmatter: {}, texts: [], rest: text };
  const data = (parse(match[1] ?? "") ?? {}) as Record<string, unknown>;
  const frontmatter: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) if (typeof value === "string") frontmatter[key] = value;
  // The `template` and `link` values are names and addresses, not text a reader sees.
  const { template: _template, ...shown } = data;
  const texts = stringsIn(shown).filter((value) => !value.startsWith("/") && !/^[\w-]+$/.test(value));
  return { frontmatter, texts, rest: text.slice(match[0].length) };
}

/**
 * A one-line MDX component tag, such as `<Tabs syncKey="pm">`, `</TabItem>` or `<LinkCard title="Read" />`. A tag with
 * text on its own line, such as `<Aside>Read this.</Aside>`, does not match and stays in the body.
 */
const COMPONENT_TAG = /^\s*<\/?[A-Z][\w.]*(?:\s[^<>]*)?\/?>\s*$/;

/** The attributes of a component tag whose string values a reader sees, so the prose rules check them. */
const VISIBLE_ATTRIBUTE = /\b(?:title|label|description)=(?:"([^"]*)"|'([^']*)')/g;

/** A one-line `{/* ... *\/}` comment, a side-effect import or a one-line import: code, not prose. */
const MDX_CODE_LINE = /^\s*(?:\{\/\*.*\*\/\}|import\s+["'][^"']+["'];?|import\s.+\sfrom\s+["'][^"']+["'];?)\s*$/;

/** A line that opens a fenced code block. */
const FENCE_OPEN = /^\s*(?:`{3,}|~{3,})/;

/** A string or template literal on one line, which the export scan drops before it counts brackets. */
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

/** How many lines from `start` an MDX import, export or comment spans, or 0 when the line starts none of them. */
function codeSpan(lines: readonly string[], start: number): number {
  const first = lines[start] ?? "";
  if (MDX_CODE_LINE.test(first)) return 1;
  // `import` must be followed by a space and a name, or by `{` or `*`, so prose such as "Importantly, ..." is not one.
  const kind = /^\s*(?:(import)(?:\s+[\w{*]|\s*[{*])|(export)\s+(?:const|let|var|function)\b|(\{\/\*))/.exec(first);
  if (kind === null) return 0;
  const isComment = kind[3] !== undefined;
  // A multi-line import ends on its `from` line, a comment on `*/}`, and an export once its brackets balance.
  let depth = 0;
  for (let j = start; j < lines.length; j += 1) {
    const line = lines[j] ?? "";
    // No statement spans a fence, and an import or export does not span a blank line; a comment may.
    if (j > start && (FENCE_OPEN.test(line) || (!isComment && line.trim() === ""))) return 0;
    if (kind[1] !== undefined && /\sfrom\s+["'][^"']+["'];?\s*$/.test(line)) return j - start + 1;
    if (isComment && /\*\/\}\s*$/.test(line)) return j - start + 1;
    if (kind[2] !== undefined) {
      // Brackets inside string and template literals do not count.
      for (const ch of line.replace(STRING_LITERAL, "")) depth += "({[".includes(ch) ? 1 : ")}]".includes(ch) ? -1 : 0;
      if (depth <= 0) return j - start + 1;
    }
  }
  return 0;
}

/**
 * What an MDX line outside a fence leaves for the prose rules: nothing for an import, export, comment or a component
 * tag, except that the values of a tag's `title`, `label` and `description` attributes stay, because a reader sees them.
 */
function proseOfComponentLine(line: string): string | undefined {
  if (!COMPONENT_TAG.test(line)) return undefined;
  return [...line.matchAll(VISIBLE_ATTRIBUTE)].map((m) => m[1] ?? m[2] ?? "").join(" ");
}

/** The lines `<TabItem ...>` and `</TabItem>`, the only lines allowed between two fences that share an introduction. */
const TAB_ITEM_LINE = /^\s*<\/?TabItem\b[^<>]*>\s*$/;

/**
 * Splits a page body into prose lines and fenced blocks. In `mdx`, lines outside fences that only import, export, comment
 * or open or close a component are blanked (a blank still separates two paragraphs). A fence's `code` is always read
 * from the page's own lines, so a line inside a code block is never blanked.
 */
export function splitFences(rest: string, mdx: boolean): { body: string; fences: Fence[] } {
  const raw = rest.split("\n");
  // `view` holds each line as the prose rules see it: the raw line, or the blanked MDX line outside a fence.
  const view: string[] = [];
  const prose: string[] = [];
  const fences: Fence[] = [];
  // The line that closed the previous fence, so tabs that follow each other can share one introduction.
  let previousClose = -1;
  for (let i = 0; i < raw.length; i += 1) {
    // A fence may be indented, as in a list item, and use backticks or tildes; it closes on a line of the same
    // character that is at least as long.
    const open = /^\s*(`{3,}|~{3,})([\w-]*)\s*(.*)$/.exec(raw[i] ?? "");
    if (open === null) {
      const span = mdx ? codeSpan(raw, i) : 0;
      if (span > 0) {
        for (let n = 0; n < span; n += 1) {
          view.push("");
          prose.push("");
        }
        i += span - 1;
      } else {
        // A tag's visible attribute text goes to the prose rules but not to `view`: a tab's label introduces nothing.
        const shown = mdx ? proseOfComponentLine(raw[i] ?? "") : undefined;
        view.push(shown === undefined ? (raw[i] ?? "") : "");
        prose.push(shown ?? raw[i] ?? "");
      }
      continue;
    }
    const mark = (open[1] ?? "").charAt(0);
    const length = (open[1] ?? "").length;
    const end = raw.findIndex((line, j) => j > i && new RegExp(`^\\s*\\${mark}{${length},}\\s*$`).test(line));
    const close = end === -1 ? raw.length : end;
    let before = "";
    for (let k = i - 1; k >= 0 && before === ""; k -= 1) before = (view[k] ?? "").trim();
    // Only TabItem lines between two fences mean they sit in sibling tabs, so the second takes the first's
    // introduction. Any other line, a component included, keeps the strict rule.
    const between = raw.slice(previousClose + 1, i);
    const siblings =
      mdx &&
      previousClose >= 0 &&
      between.some((line) => TAB_ITEM_LINE.test(line)) &&
      between.every((line) => line.trim() === "" || TAB_ITEM_LINE.test(line));
    if (siblings) before = fences.at(-1)?.before ?? before;
    fences.push({
      line: i + 1,
      lang: open[2] ?? "",
      meta: open[3] ?? "",
      code: raw.slice(i + 1, close).join("\n"),
      before,
    });
    // The fence's own lines stay in `view` unchanged, so a later `before` that reaches them reads the closing fence.
    for (let n = i; n <= Math.min(close, raw.length - 1); n += 1) view.push(raw[n] ?? "");
    previousClose = close;
    i = close;
  }
  return { body: prose.join("\n"), fences };
}

/** Every page we write, read from disk. */
export function readPages(): Page[] {
  return pagePaths().map((file) => {
    const { frontmatter, texts, rest } = frontmatterOf(readFileSync(file, "utf8"));
    return { path: relative(DOCS_DIR, file), frontmatter, texts, ...splitFences(rest, file.endsWith(".mdx")) };
  });
}
