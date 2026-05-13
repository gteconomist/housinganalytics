// @ts-check
import { defineConfig } from 'astro/config';

// housinganalytics.org — static build, no integrations needed for v1.
// Deployed via GitHub Actions to GitHub Pages with a custom domain (CNAME file in /public).
export default defineConfig({
  site: 'https://housinganalytics.org',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
  vite: {
    // Keep things lean for static export.
    build: {
      assetsInlineLimit: 2048,
    },
  },
});
