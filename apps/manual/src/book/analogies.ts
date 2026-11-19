import { z } from "astro/zod";
import { KEBAB_ID } from "./outline-rules.js";
import type { ProblemList } from "./problems.js";
import { formatIssues } from "./zod-issues.js";

/** One entry in the analogy register, `src/content/analogies.json` (BK22). */
export const analogySchema = z.strictObject({
  /** The id a chapter names the analogy by: `:analogy[label]{#id}`. */
  id: z.string().regex(KEBAB_ID, "id must be kebab-case"),
  /** The one concept the analogy explains, across the whole book. */
  concept: z.string().trim().min(1),
  /** The everyday image itself. */
  analogy: z.string().trim().min(1),
  /** The slug of the chapter that introduces it; later chapters may refer back to it by id. */
  chapter: z.string().regex(KEBAB_ID, "chapter must be a slug from src/outline.ts"),
  /** The id of the figure that illustrates it, or null for none. */
  illustration: z.string().regex(KEBAB_ID, "illustration must be a figure id").nullable(),
  /** Where the analogy stops being true. */
  breaks: z.string().trim().min(1),
});

/** One entry in the analogy register. */
export type Analogy = z.infer<typeof analogySchema>;

/** Compares analogies and concepts without case, punctuation or a leading article. */
export function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(a|an|the) /, "");
}

/**
 * Parses and checks the register: each entry matches the schema, ids appear once, each chapter is in the outline, and
 * analogies and concepts pair one to one. An analogy listed twice for the same concept is a duplicate; one listed for
 * a second concept is a reuse; a concept listed twice has more than one analogy. Each fails.
 */
export function checkAnalogies(
  data: unknown,
  file: string,
  chapterSlugs: ReadonlySet<string>,
  problems: ProblemList,
): readonly Analogy[] {
  const parsed = z.array(z.unknown()).safeParse(data);
  if (!parsed.success) {
    problems.add(file, "the analogy register must be a JSON array of entries");
    return [];
  }
  const entries: Analogy[] = [];
  const ids = new Set<string>();
  const byAnalogy = new Map<string, Analogy>();
  const byConcept = new Map<string, Analogy>();
  for (const [index, raw] of parsed.data.entries()) {
    const result = analogySchema.safeParse(raw);
    if (!result.success) {
      problems.add(file, `entry ${index + 1}: ${formatIssues(result.error)}`);
      continue;
    }
    const entry = result.data;
    if (ids.has(entry.id)) problems.add(file, `${entry.id}: the id appears twice`);
    ids.add(entry.id);
    if (!chapterSlugs.has(entry.chapter))
      problems.add(file, `${entry.id}: chapter "${entry.chapter}" is not in the outline`);
    checkPairing(entry, byAnalogy, byConcept, file, problems);
    entries.push(entry);
  }
  return entries;
}

function checkPairing(
  entry: Analogy,
  byAnalogy: Map<string, Analogy>,
  byConcept: Map<string, Analogy>,
  file: string,
  problems: ProblemList,
): void {
  const concept = normalizePhrase(entry.concept);
  const earlier = byAnalogy.get(normalizePhrase(entry.analogy));
  if (earlier === undefined) {
    byAnalogy.set(normalizePhrase(entry.analogy), entry);
  } else if (normalizePhrase(earlier.concept) === concept) {
    problems.add(file, `${entry.id}: duplicates ${earlier.id}, the same analogy for the same concept`);
  } else {
    problems.add(
      file,
      `${entry.id}: "${entry.analogy}" already explains "${earlier.concept}" (${earlier.id}); an analogy explains ` +
        "one concept only",
    );
  }
  const sameConcept = byConcept.get(concept);
  if (sameConcept === undefined) byConcept.set(concept, entry);
  else if (earlier === undefined) {
    problems.add(
      file,
      `${entry.id}: "${entry.concept}" already has an analogy (${sameConcept.id}); refer back to it by its id`,
    );
  }
}
