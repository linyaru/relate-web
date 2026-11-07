// The parser both renderings share: MDX with GFM and remark-directive, the
// same syntax extensions the page's MDX compiler runs (astro.config.mjs).

import type { Root } from 'mdast';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

const parser = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkDirective).freeze();

/** A page body (MDX without frontmatter) as mdast. */
export const parsePage = (body: string): Root => parser.parse(body);

const stringifier = unified()
  .use(remarkGfm)
  .use(remarkStringify, { bullet: '-', fence: '`', fences: true, rule: '-', emphasis: '*', strong: '*', listItemIndent: 'one', incrementListMarker: true })
  .freeze();

/** mdast back to markdown (no MDX or directive syntax left in it). */
export const stringifyMarkdown = (tree: Root): string => stringifier.stringify(tree);
