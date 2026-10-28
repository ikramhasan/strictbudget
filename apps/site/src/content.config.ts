import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    /** The card's excerpt and the page's meta description. */
    description: z.string(),
    /** The line under the title on the post's page. */
    dek: z.string(),
    date: z.coerce.date(),
    category: z.enum(["Guides", "Product", "Stories"]),
    cover: z.enum(["assign", "currency", "sharing", "card"]),
    author: z.string().default("Ikram Hasan"),
    authorRole: z.string().default("Builds strictbudget"),
  }),
});

export const collections = { blog };
