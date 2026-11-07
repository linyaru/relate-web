// The docs' remark plugin for Astro's MDX compiler (astro.config.mjs): renders
// a docs page's constructs to their HTML form (constructs.ts). It runs after
// remark-directive, on files under src/content/docs only.

import type { Root } from 'mdast';
import type { VFile } from 'vfile';

import { DOCS_DIR, glossary, publishedIds } from './content.ts';
import { renderConstructs, type ToMarkdown } from './constructs.ts';
import { highlighter } from './highlight.ts';

export interface RemarkDocsOptions {
  /** The JSX components pages may use (src/components/docs/registry.ts). */
  components: Record<string, ToMarkdown>;
}

export function remarkDocs(options: RemarkDocsOptions) {
  return async (tree: Root, file: VFile) => {
    const path = file.path ?? '';
    if (!path.startsWith(DOCS_DIR)) return;
    renderConstructs(tree, 'html', {
      file: path,
      source: String(file.value),
      links: { pages: publishedIds() },
      glossary: glossary(),
      components: options.components,
      highlight: await highlighter(),
    });
  };
}
