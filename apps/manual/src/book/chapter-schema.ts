// The strict front-matter schema follows src/content.config.ts in the owner's garment engineering textbook
// (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission: a strict object,
// so a misspelt key is an error instead of being dropped, and one set of rules shared by the check and the build.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
//
// Changed from the original: the fields are this book's (BK5), and the schema lives in its own module so that
// src/content.config.ts and the chapter-contract plugin, which check:book and the build both run, share it.

import { z } from "astro/zod";
import { KEBAB_ID } from "./outline-rules.js";
import { OPENING_TYPES } from "./outline-types.js";

/** A todo id such as `B11`, `E4a` or `N46b`. */
export const TODO_ID = /^[A-Z]\d+[a-z]?$/;

/** A chapter's front matter. The chapter's number and part come from `src/outline.ts`, never from here. */
export const chapterSchema = z.strictObject({
  title: z.string().trim().min(1),
  /** One or two sentences: the page's meta description and the contents entry's summary. */
  summary: z.string().trim().min(1),
  /** How the chapter opens; it must be the type the outline plans for this chapter. */
  opening: z.enum(OPENING_TYPES),
  /** The register ids the chapter relies on, in the order its source list shows them. */
  sources: z.array(z.string().regex(KEBAB_ID, "source ids are kebab-case")).min(1, "a chapter lists its sources"),
  /** The glossary ids whose first use the chapter links. */
  glossary: z.array(z.string().regex(KEBAB_ID, "glossary ids are kebab-case")),
  /** The todos whose code this chapter's `verify/` listings will gain as tabs, while the listings stay (BK8). */
  switchTo: z.array(z.string().regex(TODO_ID, "todo ids look like B11, E4a or N46b")),
});

/** A chapter's checked front matter. */
export type ChapterFrontmatter = z.infer<typeof chapterSchema>;
