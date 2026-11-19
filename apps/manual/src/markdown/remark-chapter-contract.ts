import type { Heading, Root, RootContent } from "mdast";
import type { VFile } from "vfile";
import { chapterSchema } from "../book/chapter-schema.js";
import type { Book } from "../book/load.js";
import { formatIssues } from "../book/zod-issues.js";
import { fileData, slugOf } from "./chapter-file.js";
import { failAt } from "./fail.js";

const plain = (node: RootContent): string =>
  ("value" in node ? node.value : "") + ("children" in node ? node.children.map(plain).join("") : "");

/**
 * Checks the chapter contract before any other plugin runs: the file is a chapter in the outline, its front matter
 * passes the strict schema, it opens with the outline's planned type, every source and glossary id it lists exists,
 * and its last section is "Exercises" holding a list and nothing else. The layout adds the source list after the
 * exercises.
 */
export function remarkChapterContract(options: { readonly book: Book }) {
  const { book } = options;
  return (tree: Root, file: VFile): void => {
    const slug = slugOf(file);
    const outline = slug === undefined ? undefined : book.bySlug.get(slug);
    if (outline === undefined) {
      failAt(file, `"${slug ?? "(no file)"}" is not a chapter in ${book.names.outline}, so it has no number`);
    }
    fileData(file).lineOffset = book.index.written.get(outline.slug)?.bodyLineOffset ?? 0;
    const parsed = chapterSchema.safeParse(fileData(file).astro?.frontmatter ?? {});
    if (!parsed.success) failAt(file, `front matter: ${formatIssues(parsed.error)}`);
    const frontmatter = parsed.data;
    if (frontmatter.opening !== outline.opening) {
      failAt(
        file,
        `front matter: opening is "${frontmatter.opening}", but ${book.names.outline} plans "${outline.opening}" for this ` +
          "chapter; change the outline, which re-runs the rotation check, or the opening",
      );
    }
    checkIds(file, frontmatter.sources, (id) => book.sources.has(id), "sources", book.names.sources);
    checkIds(file, frontmatter.glossary, (id) => book.glossary.has(id), "glossary", book.names.glossary);
    checkExercises(tree, file);
    fileData(file).chapter = { outline, frontmatter };
  };
}

function checkIds(
  file: VFile,
  ids: readonly string[],
  known: (id: string) => boolean,
  field: string,
  where: string,
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!known(id)) failAt(file, `front matter: ${field} lists "${id}", which is not in ${where}`);
    if (seen.has(id)) failAt(file, `front matter: ${field} lists "${id}" twice`);
    seen.add(id);
  }
}

function checkExercises(tree: Root, file: VFile): void {
  const sections = tree.children.filter((node): node is Heading => node.type === "heading" && node.depth === 2);
  const last = sections.at(-1);
  if (last === undefined || plain(last).trim() !== "Exercises") {
    failAt(file, 'the chapter must end with an "## Exercises" section', last);
  }
  const after = tree.children.slice(tree.children.indexOf(last) + 1);
  if (!after.some((node) => node.type === "list")) {
    failAt(file, 'the "Exercises" section needs a list of exercises', last);
  }
  // A box or a paragraph after the list would render inside the Exercises section, which holds only the exercises.
  const stray = after.find((node) => node.type !== "list");
  if (stray !== undefined) {
    failAt(
      file,
      `the "Exercises" section holds only its list; move the ${described(stray)} above "## Exercises"`,
      stray,
    );
  }
}

/** A node as a writer knows it, for an error message: `:::box`, `::listing` or the node's type. */
function described(node: RootContent): string {
  if (node.type === "containerDirective") return `:::${node.name}`;
  if (node.type === "leafDirective") return `::${node.name}`;
  return node.type;
}
