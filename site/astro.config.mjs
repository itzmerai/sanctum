// @ts-check
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'astro/config'
import react from '@astrojs/react'

/**
 * Sanctum's marketing site (U1).
 *
 * Static output, because the site has no server-side behaviour and is hosted
 * on GitHub Pages. Astro rather than a client-rendered SPA so crawlers and
 * link-preview scrapers receive real HTML instead of an empty root element
 * (KTD1) - a shared URL that previews as a blank card is the one failure a
 * marketing page cannot afford.
 *
 * `base` comes from the environment because a GitHub project site is served
 * from a subpath (`/sanctum/`), and every asset 404s without a matching base.
 * Moving to a custom domain later is then `SITE_BASE=/`, not a code change
 * (KTD7).
 */
const base = process.env.SITE_BASE ?? '/sanctum/'
const site = process.env.SITE_ORIGIN ?? 'https://itzmerai.github.io'

export default defineConfig({
  output: 'static',
  site,
  base,
  integrations: [react()],
  build: {
    // One stylesheet beats a request per component on a page this small.
    inlineStylesheets: 'auto',
  },
  vite: {
    resolve: {
      alias: {
        // The app's token file is imported, never copied, so the site cannot
        // drift from what the product actually looks like (KTD3).
        '@app': fileURLToPath(new URL('../src', import.meta.url)),
      },
    },
  },
})
