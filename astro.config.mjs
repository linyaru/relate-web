import { defineConfig } from 'astro/config';

// Static output. Interim preview host; switch to https://relatedb.ai at launch (see LAUNCH.md).
export default defineConfig({
  site: 'https://r31473.relatedb.ai',
  output: 'static',
  trailingSlash: 'ignore',
});
