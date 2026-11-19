import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { chapterSchema } from "./book/chapter-schema.js";

// One Markdown file per chapter; the file name is the slug and the URL (/<slug>/). The schema is the one the
// chapter-contract plugin applies, so `astro sync`, `check:book` and the build agree on the front matter.
const chapters = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/chapters" }),
  schema: chapterSchema,
});

export const collections = { chapters };
