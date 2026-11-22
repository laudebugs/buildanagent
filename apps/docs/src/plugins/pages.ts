/** Reads the docs pages and splits them into the parts the content checks look at. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
  readonly body: string;
  readonly fences: readonly Fence[];
}

/** The path of every `.md` and `.mdx` page under the docs folder. */
export function pagePaths(dir = DOCS_DIR): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.mdx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function frontmatterOf(text: string): { frontmatter: Record<string, string>; rest: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (match === null) return { frontmatter: {}, rest: text };
  const frontmatter: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const pair = /^(\w+):\s*(.*)$/.exec(line);
    if (pair?.[1] !== undefined) frontmatter[pair[1]] = pair[2] ?? "";
  }
  return { frontmatter, rest: text.slice(match[0].length) };
}

/** Splits the body into prose lines and fenced blocks. */
function splitFences(rest: string): { body: string; fences: Fence[] } {
  const lines = rest.split("\n");
  const prose: string[] = [];
  const fences: Fence[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^(`{3,})(\w*)\s*(.*)$/.exec(lines[i] ?? "");
    if (open === null) {
      prose.push(lines[i] ?? "");
      continue;
    }
    const end = lines.findIndex((line, j) => j > i && line.trim() === open[1]);
    const close = end === -1 ? lines.length : end;
    let before = "";
    for (let k = i - 1; k >= 0 && before === ""; k -= 1) before = (lines[k] ?? "").trim();
    fences.push({
      line: i + 1,
      lang: open[2] ?? "",
      meta: open[3] ?? "",
      code: lines.slice(i + 1, close).join("\n"),
      before,
    });
    i = close;
  }
  return { body: prose.join("\n"), fences };
}

/** Every page, read from disk. */
export function readPages(): Page[] {
  return pagePaths().map((file) => {
    const { frontmatter, rest } = frontmatterOf(readFileSync(file, "utf8"));
    return { path: relative(DOCS_DIR, file), frontmatter, ...splitFences(rest) };
  });
}
