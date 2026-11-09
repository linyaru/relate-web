// The data blocks' files and the twins' stubs (ADR-0048, src/lib/docs/data-blocks.ts).
//
// From the source (docs:check): a page's ```json data=<name> block of up to
// 2 KiB is in its twin verbatim (the twin round-trip checks that); a larger
// one is not, and in its place the twin has exactly one stub fence whose
// info string names the block and its URL and whose size and SHA-256 are the
// block's bytes. A stub names a block the page has.
//
// From dist/ (docs:check --built): every block of every page is built at
// /docs/<page>/data/<name>.json with exactly the block's bytes, and every
// stub in a built twin names the size and SHA-256 of the built file it links.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Code, Parent, Root, RootContent } from 'mdast';

import { parseDataInfo, parseDataRef } from '../../cookbook/cells.ts';
import { dataBlockBytes, dataBlockPath, inlinedInTwin, INLINE_DATA_BYTES, stubProblems } from '../data-blocks.ts';

function codeNodes(tree: Root): Code[] {
  const out: Code[] = [];
  const visit = (n: Root | RootContent) => {
    if (n.type === 'code') out.push(n);
    if ('children' in n) for (const c of (n as Parent).children) visit(c as RootContent);
  };
  visit(tree);
  return out;
}

/** The stub fences of a twin's tree, by block name (a name twice is listed twice). */
export function twinStubs(twin: Root): { name: string; meta: string; value: string }[] {
  return codeNodes(twin).flatMap((n) => {
    const ref = parseDataRef(n.lang, n.meta);
    return ref ? [{ name: ref.name, meta: n.meta ?? '', value: n.value }] : [];
  });
}

/**
 * What is wrong with a twin's data blocks: `blocks` is the page's blocks
 * (collectCells(tree).data), `twin` the rendered twin's tree. Also returns
 * the names of the blocks the twin links, so the round-trip check does not
 * look for them inline.
 */
export function twinDataProblems(pageId: string, blocks: Map<string, string>, twin: Root): { problems: string[]; linked: Set<string> } {
  const problems: string[] = [];
  const linked = new Set<string>();
  const stubs = twinStubs(twin);
  const inline = new Set(codeNodes(twin).flatMap((n) => {
    const name = parseDataInfo(n.lang, n.meta);
    return name === null ? [] : [name];
  }));
  for (const [name, text] of blocks) {
    if (inlinedInTwin(text)) {
      if (stubs.some((s) => s.name === name)) problems.push(`the twin links \`json data=${name}\`, a block of ${INLINE_DATA_BYTES} bytes or less that it carries inline`);
      continue;
    }
    linked.add(name);
    const mine = stubs.filter((s) => s.name === name);
    if (inline.has(name)) problems.push(`the twin carries \`json data=${name}\` inline; a block over ${INLINE_DATA_BYTES} bytes is a stub linking ${dataBlockPath(pageId, name)}`);
    if (mine.length !== 1) {
      problems.push(`the twin has ${mine.length} stub fences for \`json data=${name}\` (${dataBlockBytes(text).length} bytes); it needs one`);
      continue;
    }
    problems.push(...stubProblems(pageId, name, mine[0].meta, mine[0].value, dataBlockBytes(text)));
  }
  for (const s of stubs) if (!blocks.has(s.name)) problems.push(`the twin has a stub for \`json data=${s.name}\`, a block the page does not have`);
  return { problems, linked };
}

/**
 * The built files of a page's blocks and the stubs of its built twin
 * (`twin`, parsed): every block at its path in `dist` with the block's
 * bytes, every stub's size and SHA-256 those of the file it links.
 */
export function builtDataProblems(dist: string, pageId: string, blocks: Map<string, string>, twin: Root): string[] {
  const problems: string[] = [];
  const built = new Map<string, Buffer>();
  for (const [name, text] of blocks) {
    const path = dataBlockPath(pageId, name);
    const file = join(dist, path);
    if (!existsSync(file)) {
      problems.push(`${path} is not built`);
      continue;
    }
    const bytes = readFileSync(file);
    built.set(name, bytes);
    if (!bytes.equals(dataBlockBytes(text))) problems.push(`${path} is not the bytes of the page's \`json data=${name}\` block`);
  }
  for (const s of twinStubs(twin)) {
    const bytes = built.get(s.name);
    if (!bytes) {
      if (!blocks.has(s.name)) problems.push(`the built twin has a stub for \`json data=${s.name}\`, a block the page does not have`);
      continue;
    }
    problems.push(...stubProblems(pageId, s.name, s.meta, s.value, bytes).map((p) => `built twin: ${p}`));
  }
  return problems;
}
