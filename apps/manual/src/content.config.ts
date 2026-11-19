import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { chapterSchema } from "./book/chapter-schema.js";
import { contentDirs } from "./book/load.js";

// One Markdown file per chapter; the file name is the slug and the URL (/<slug>/). The schema is the one the
// chapter-contract plugin applies, so `astro sync`, `check:book` and the build agree on the front matter, and the
// directory is the content model's, so the collection and the book index read the same files.
const chapters = defineCollection({
  loader: glob({ pattern: "*.md", base: contentDirs().chaptersDir }),
  schema: chapterSchema,
});

export const collections = { chapters };
