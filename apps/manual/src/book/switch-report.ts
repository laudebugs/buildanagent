import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@astrojs/markdown-remark";
import type { Book } from "./load.js";

/** One written chapter's switch to our own packages: the todos it waits on, and which of them are done. */
export interface ChapterSwitch {
  readonly slug: string;
  readonly number: number;
  readonly switchTo: readonly string[];
  readonly done: readonly string[];
}

/** The ids of the todos in `docs/todos/done/`, read from file names such as `B11-loop-core.md`. */
export function doneTodos(repoRoot: string): ReadonlySet<string> {
  const dir = join(repoRoot, "docs/todos/done");
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).flatMap((file) => /^([A-Z]\d+[a-z]?)-.*\.md$/.exec(file)?.[1] ?? []));
}

/**
 * Each written chapter's `switchTo` todos and which of them have reached `docs/todos/done/` (BK8). A chapter whose
 * todos are all done can move its listings from `verify/` to our own packages.
 */
export function chapterSwitches(book: Book): ChapterSwitch[] {
  const done = doneTodos(book.inputs.repoRoot);
  return [...book.index.written.values()].map(({ chapter, file }) => {
    const { frontmatter } = parseFrontmatter(readFileSync(file, "utf8"));
    const switchTo = Array.isArray(frontmatter.switchTo) ? frontmatter.switchTo.map(String) : [];
    return { slug: chapter.slug, number: chapter.number, switchTo, done: switchTo.filter((id) => done.has(id)) };
  });
}

/** The report's lines, one per written chapter, in reading order. */
export function formatSwitches(switches: readonly ChapterSwitch[]): string[] {
  if (switches.length === 0) return ["No chapter is written yet, so no chapter has listings to switch."];
  return switches.map(({ slug, number, switchTo, done }) => {
    const head = `Chapter ${number} (${slug}):`;
    if (switchTo.length === 0) return `${head} lists no switchTo todos.`;
    const todos = switchTo.map((id) => `${id} ${done.includes(id) ? "done" : "not done"}`).join(", ");
    const verdict =
      done.length === switchTo.length ? "ready to move to our own packages" : "keeps its verify/ listings";
    return `${head} ${todos}; ${verdict}.`;
  });
}
