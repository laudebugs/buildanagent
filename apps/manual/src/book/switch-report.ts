import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@astrojs/markdown-remark";
import { chapterSchema, TODO_ID } from "./chapter-schema.js";
import type { Book } from "./load.js";

/** One written chapter's switch to our own packages: the todos it waits on, and which of them are done. */
export interface ChapterSwitch {
  readonly slug: string;
  readonly number: number;
  readonly switchTo: readonly string[];
  readonly done: readonly string[];
  /** Set when the chapter's front matter fails the schema, so its `switchTo` cannot be read; `check:book` says why. */
  readonly invalid?: true;
}

/** The ids of the todos in `docs/todos/done/`, read from file names such as `B11-loop-core.md`. */
export function doneTodos(repoRoot: string): ReadonlySet<string> {
  const dir = join(repoRoot, "docs/todos/done");
  if (!existsSync(dir)) return new Set();
  // A todo file is named `<id>-<slug>.md`, and its id is the chapter schema's todo id.
  return new Set(
    readdirSync(dir).flatMap((file) => {
      const id = /^([^-]+)-.*\.md$/.exec(file)?.[1];
      return id !== undefined && TODO_ID.test(id) ? [id] : [];
    }),
  );
}

/**
 * Each written chapter's `switchTo` todos and which of them have reached `docs/todos/done/` (BK8). A chapter whose
 * todos are all done can move its listings from `verify/` to our own packages.
 */
export function chapterSwitches(book: Book): ChapterSwitch[] {
  const done = doneTodos(book.inputs.repoRoot);
  return [...book.index.written.values()].map(({ chapter, file }) => {
    const parsed = chapterSchema.safeParse(parseFrontmatter(readFileSync(file, "utf8")).frontmatter);
    const base = { slug: chapter.slug, number: chapter.number };
    if (!parsed.success) return { ...base, switchTo: [], done: [], invalid: true };
    const { switchTo } = parsed.data;
    return { ...base, switchTo, done: switchTo.filter((id) => done.has(id)) };
  });
}

/** The report's lines, one per written chapter, in reading order. */
export function formatSwitches(switches: readonly ChapterSwitch[]): string[] {
  if (switches.length === 0) return ["No chapter is written yet, so no chapter has listings to switch."];
  return switches.map(({ slug, number, switchTo, done, invalid }) => {
    const head = `Chapter ${number} (${slug}):`;
    if (invalid) return `${head} its front matter fails the schema, so its switchTo cannot be read; run check:book.`;
    if (switchTo.length === 0) return `${head} lists no switchTo todos.`;
    const todos = switchTo.map((id) => `${id} ${done.includes(id) ? "done" : "not done"}`).join(", ");
    const verdict =
      done.length === switchTo.length
        ? "ready for tabs on our own packages"
        : "its verify/ listings wait for our own packages";
    return `${head} ${todos}; ${verdict}.`;
  });
}
