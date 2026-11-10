import { fileURLToPath } from 'node:url';

import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';
import { defineConfig } from 'astro/config';
import remarkDirective from 'remark-directive';

import { COMPONENT_TWINS } from './src/components/docs/registry.ts';
import { remarkDocs } from './src/lib/docs/remark.ts';

// Static output. Interim preview host; switch to https://relatedb.ai at launch (see LAUNCH.md).
export default defineConfig({
  site: 'https://relatedb.ai',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [
    // Docs pages (src/content/docs/**/*.mdx, ADR-0002, ADR-0015): MDX with the
    // directive pipeline. remarkDocs renders each construct (callouts, tabs,
    // terms, badges, figures, mermaid, `cypher run` cells, code blocks) to its
    // HTML form; src/lib/docs/twin.ts renders the same constructs to markdown.
    // SmartyPants is off so prose keeps `--flags` and straight quotes as written.
    mdx({
      processor: unified({ remarkPlugins: [remarkDirective, [remarkDocs, { components: COMPONENT_TWINS }]] }),
      smartypants: false,
      gfm: true,
      // remarkDocs highlights every docs code block; Astro's pass would redo them as plain text.
      syntaxHighlight: false,
    }),
  ],
  markdown: {
    // Code blocks stay dark in both themes, as in the cookbook. remarkDocs
    // highlights docs code itself (src/lib/docs/highlight.ts, same theme).
    shikiConfig: { theme: 'github-dark-default', langs: ['cypher'] },
  },
  vite: {
    // Agent worktrees (.claude/worktrees/) are whole copies of the repo; the
    // dev server must not watch them or restart when one is removed.
    server: { watch: { ignored: ['**/.claude/**'] } },
    resolve: {
      alias: {
        // NVL (the cookbook's graph view) imports Segment telemetry for side
        // effects only; the view disables telemetry, so ship none of it.
        '@segment/analytics-next': fileURLToPath(new URL('./src/scripts/cookbook/no-telemetry.ts', import.meta.url)),
      },
    },
  },
});
