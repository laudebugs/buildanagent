import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// One Markdown file per chapter; the file name is the slug and the URL (/<slug>/).
const chapters = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/chapters" }),
  schema: z
    .object({
      title: z.string().min(1),
      description: z.string().min(1),
    })
    .strict(),
});

export const collections = { chapters };
