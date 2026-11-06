import { fileURLToPath } from 'node:url';

import { defineConfig } from 'astro/config';

// Static output. Interim preview host; switch to https://relatedb.ai at launch (see LAUNCH.md).
export default defineConfig({
  site: 'https://r31473.relatedb.ai',
  output: 'static',
  trailingSlash: 'ignore',
  vite: {
    resolve: {
      alias: {
        // NVL (the cookbook's graph view) imports Segment telemetry for side
        // effects only; the view disables telemetry, so ship none of it.
        '@segment/analytics-next': fileURLToPath(new URL('./src/scripts/cookbook/no-telemetry.ts', import.meta.url)),
      },
    },
  },
});
