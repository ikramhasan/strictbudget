import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// The marketing site: static pages for the hosted service. The app itself (apps/web) is served
// separately, at APP_URL in src/lib/site.ts.
export default defineConfig({
  site: "https://strictbudget.app",
  // The legal pages are noindex until they're written, so they stay out of the sitemap too.
  integrations: [react(), mdx(), sitemap({ filter: (page) => !/\/(privacy|terms)\/$/.test(page) })],
  vite: { plugins: [tailwindcss()] },
});
