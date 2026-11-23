/** Reads the docs pages and splits them into the parts the content checks look at. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { API_PACKAGES } from "../api/packages.js";

export const DOCS_DIR = fileURLToPath(new URL("../content/docs/", import.meta.url));

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
 * An MDX line that only imports a component or opens or closes one, such as `<Tabs syncKey="pm">` or `</TabItem>`. It
 * holds no words a reader sees, so the prose rules skip it. A component tag that carries text on its own line is not
 * matched and stays in the body, so its words are still counted.
 */
const MDX_ONLY = /^\s*(?:import\s.+\sfrom\s.+|<\/?[A-Z][\w.]*(?:\s[^<>]*)?\/?>)\s*$/;

/** Splits a page body into prose lines and fenced blocks; `mdx` also skips component lines (see `MDX_ONLY`). */
export function splitFences(rest: string, mdx: boolean): { body: string; fences: Fence[] } {
  const raw = rest.split("\n");
  // An MDX component line becomes a blank line, so it still separates two paragraphs.
  const isComponent = (index: number) => mdx && MDX_ONLY.test(raw[index] ?? "");
  const lines = raw.map((line, index) => (isComponent(index) ? "" : line));
  const prose: string[] = [];
  const fences: Fence[] = [];
  // The line that closed the previous fence, so tabs that follow each other can share one introduction.
  let previousClose = -1;
  for (let i = 0; i < lines.length; i += 1) {
    // A fence may be indented, as in a list item, and use backticks or tildes; it closes on a line of the same
    // character that is at least as long.
    const open = /^\s*(`{3,}|~{3,})(\w*)\s*(.*)$/.exec(lines[i] ?? "");
    if (open === null) {
      prose.push(lines[i] ?? "");
      continue;
    }
    const mark = (open[1] ?? "").charAt(0);
    const length = (open[1] ?? "").length;
    const end = lines.findIndex((line, j) => j > i && new RegExp(`^\\s*\\${mark}{${length},}\\s*$`).test(line));
    const close = end === -1 ? lines.length : end;
    let before = "";
    let k = i - 1;
    for (; k >= 0 && before === ""; k -= 1) before = (lines[k] ?? "").trim();
    // Reaching the previous fence's closing line means the two sit in sibling tabs, with only component lines
    // between them, so the second takes the first's introduction. Plain Markdown fences keep the strict rule.
    const between = Array.from({ length: Math.max(0, i - previousClose - 1) }, (_, n) => previousClose + 1 + n);
    if (k + 1 === previousClose && between.some(isComponent)) before = fences.at(-1)?.before ?? before;
    fences.push({
      line: i + 1,
      lang: open[2] ?? "",
      meta: open[3] ?? "",
      code: lines.slice(i + 1, close).join("\n"),
      before,
    });
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
