// Adapted from src/lib/terms.mjs in the owner's garment engineering textbook
// (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
//
// Changed from the original: the entries are checked with a zod schema and reported as problems instead of thrown one
// at a time; every entry must cite at least one register source; the `see`, `refs`, `wikidata` and per-chapter
// `chapters` fields are gone; and the data comes in as an argument instead of a JSON import.

import { z } from "astro/zod";
import { KEBAB_ID } from "./outline-rules.js";
import type { ProblemList } from "./problems.js";
import { formatIssues } from "./zod-issues.js";

/** A hover card holds a sentence or two, not an essay. */
const MAX_DEFINITION = 320;

/** One entry in `src/data/glossary.json`: a term or an abbreviation, its definition and the sources behind it. */
export const glossaryEntrySchema = z
  .strictObject({
    /** The anchor on the glossary page (`/glossary/#id`) and the id a chapter tags in its `glossary` list. */
    id: z.string().regex(KEBAB_ID, "id must be kebab-case"),
    term: z.string().trim().min(1),
    kind: z.enum(["term", "abbr"]).default("term"),
    /** An abbreviation's expansion, which starts its hover card. */
    expansion: z.string().trim().min(1).optional(),
    /** Plain text in our own words, with no Markdown and no citations (those go in `sources`). */
    definition: z
      .string()
      .trim()
      .min(1)
      .max(MAX_DEFINITION, `a definition is a hover card; keep it under ${MAX_DEFINITION} characters`)
      .refine((text) => !/`|\[|\]|\*\*|__/.test(text), "the definition must be plain text, with no Markdown"),
    /** The spellings to link in chapters; the term itself when omitted. */
    match: z.array(z.string().trim().min(1)).min(1).optional(),
    /** Register ids that back the definition. */
    sources: z.array(z.string()).min(1, "every definition cites at least one register source"),
  })
  .refine((entry) => entry.kind === "term" || entry.expansion !== undefined, {
    message: "an abbreviation needs its expansion",
    path: ["expansion"],
  });

/** A checked glossary entry, with `match` filled in. */
export type GlossaryEntry = z.infer<typeof glossaryEntrySchema> & { readonly match: readonly string[] };

/**
 * Parses and checks the glossary: each entry matches the schema, ids appear once, no spelling belongs to two
 * entries, and every source id is in the register.
 */
export function checkGlossary(
  data: unknown,
  file: string,
  sourceIds: ReadonlySet<string>,
  problems: ProblemList,
): readonly GlossaryEntry[] {
  const parsed = z.array(z.unknown()).safeParse(data);
  if (!parsed.success) {
    problems.add(file, "the glossary must be a JSON array of entries");
    return [];
  }
  const entries: GlossaryEntry[] = [];
  const ids = new Set<string>();
  const spellings = new Map<string, string>();
  for (const [index, raw] of parsed.data.entries()) {
    const result = glossaryEntrySchema.safeParse(raw);
    if (!result.success) {
      problems.add(file, `entry ${index + 1}: ${formatIssues(result.error)}`);
      continue;
    }
    const entry = { ...result.data, match: result.data.match ?? [result.data.term] };
    if (ids.has(entry.id)) problems.add(file, `${entry.id}: the id appears twice`);
    ids.add(entry.id);
    for (const id of entry.sources) {
      if (!sourceIds.has(id)) problems.add(file, `${entry.id}: source "${id}" is not in the register`);
    }
    for (const spelling of entry.match) {
      // Compared without case, because a term matches any case.
      const key = spelling.toLowerCase();
      const owner = spellings.get(key);
      if (owner !== undefined) problems.add(file, `${entry.id}: "${spelling}" is already matched by ${owner}`);
      spellings.set(key, entry.id);
    }
    entries.push(entry);
  }
  return entries;
}

/** The text a hover card and `aria-describedby` give: an abbreviation's expansion, then the definition. */
export function cardText(entry: GlossaryEntry): string {
  return entry.kind === "abbr" ? `${entry.term}: ${entry.expansion}. ${entry.definition}` : entry.definition;
}

/** Where a term links: its entry on the glossary page. */
export const termHref = (entry: GlossaryEntry): string => `/glossary/#${entry.id}`;

/** A compiled matcher over a set of entries. */
export interface TermMatcher {
  readonly re: RegExp;
  readonly owner: readonly { readonly entry: GlossaryEntry; readonly spelling: string }[];
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One regular expression for every spelling, longest first, so "agent loop" wins over "agent". A match cannot touch a
 * letter or digit on either side, nor a hyphen and a letter after it. Terms match any case and an -s, -es or -ies
 * plural; abbreviations match their exact case only. Group names map back to entries.
 *
 * The original made abbreviations case-sensitive with an inline `(?-i:…)` group, which Node 22's V8 does not support,
 * so `findTerms` drops an abbreviation hit whose case differs instead.
 */
export function matcher(entries: readonly GlossaryEntry[]): TermMatcher {
  const all = entries.flatMap((entry) => entry.match.map((spelling) => ({ entry, spelling })));
  all.sort((a, b) => b.spelling.length - a.spelling.length);
  const alternatives = all.map(({ entry, spelling }, i) => {
    if (entry.kind === "abbr") return `(?<t${i}>${escapeRegExp(spelling)})`;
    const body = /[^aeiou]y$/i.test(spelling)
      ? `${escapeRegExp(spelling.slice(0, -1))}(?:y|ies)`
      : `${escapeRegExp(spelling)}(?:e?s)?`;
    return `(?<t${i}>${body})`;
  });
  const source = alternatives.length > 0 ? alternatives.join("|") : "(?!)";
  return {
    re: new RegExp(`(?<![\\p{L}\\p{N}-])(?:${source})(?![\\p{L}\\p{N}]|-\\p{L})`, "giu"),
    owner: all,
  };
}

/** One match in a string: the entry it belongs to, where it starts and the text as written. */
export interface TermHit {
  readonly entry: GlossaryEntry;
  readonly index: number;
  readonly text: string;
}

/** Every match in a plain string. */
export function findTerms(text: string, m: TermMatcher): readonly TermHit[] {
  return [...text.matchAll(m.re)].flatMap((hit) => {
    const key = Object.keys(hit.groups ?? {}).find((name) => hit.groups?.[name] !== undefined);
    const owner = key === undefined ? undefined : m.owner[Number(key.slice(1))];
    if (owner === undefined || (owner.entry.kind === "abbr" && hit[0] !== owner.spelling)) return [];
    return [{ entry: owner.entry, index: hit.index, text: hit[0] }];
  });
}
