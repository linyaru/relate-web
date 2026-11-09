// The script budget (DOCS-PLAN.md §7.1): a docs page ships under 60 KB of
// its own JavaScript before the lazy chunks, and so does a cookbook page,
// which runs the same element loader (ADR-0045). docs:check --built
// measures each built docs and cookbook page: the scripts the browser runs eagerly, which are every
// classic or module <script> (inline text, or a `src` resolved in dist/) and,
// transitively, the modules those import statically. A module reached only
// through a dynamic `import()` is a lazy chunk and does not count: that is
// where the engine, NVL and every element module live. The page runtime
// (cells and elements) starts with the page, so the page shell imports it
// statically (src/components/docs/PageRuntime.astro) and it counts here, on
// the pages that have it. A script that runs `import()` as the page loads
// would hide what it loads from this static count; cookbook:browser measures
// what each docs page it opens loads before any interaction and fails a page
// that loads more than this count, or more than the budget.
// Bytes are uncompressed, as the files sit in dist/.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';

/** The budget, in bytes. */
export const PAGE_JS_BUDGET = 60 * 1024;

export interface PageScripts {
  /** Every eager byte: inline scripts and the files below. */
  bytes: number;
  inline: number;
  /** The files that run eagerly, by site path, with their sizes. */
  files: { path: string; bytes: number }[];
  /** Site paths a script names that are not in dist/. */
  missing: string[];
}

const JS_TYPES = /^(?:|module|text\/javascript|application\/javascript)$/i;

/** The static import and re-export specifiers of a module's text (minified or not); dynamic `import()` is left out. */
export function staticImports(js: string): string[] {
  const imports = /(?<![.\w$])import\s*(?:[\w$*{}\s,]*?\s*from\s*)?(["'])([^"'\n]+)\1/g;
  const reexports = /(?<![.\w$])export\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(["'])([^"'\n]+)\1/g;
  return [...js.matchAll(imports), ...js.matchAll(reexports)].map((m) => m[2]);
}

/**
 * The eager scripts of a built page. `pagePath` is its site path (`/docs/x/`);
 * `read(sitePath)` returns a file's text from dist/, or null when it is not
 * there. Scripts on another origin are not counted.
 */
export function eagerScripts(html: string, pagePath: string, read: (sitePath: string) => string | null): PageScripts {
  const files = new Map<string, number>();
  const missing = new Set<string>();
  let inline = 0;
  const resolve = (spec: string, from: string): string | null => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith('//')) return null; // another origin, or a data: URL
    if (!spec.startsWith('/') && !spec.startsWith('.')) return null; // a bare specifier cannot load in a browser
    return new URL(spec, `http://site${from}`).pathname;
  };
  const visit = (path: string) => {
    if (files.has(path) || missing.has(path)) return;
    const text = read(path);
    if (text === null) {
      missing.add(path);
      return;
    }
    files.set(path, Buffer.byteLength(text));
    for (const spec of staticImports(text)) {
      const next = resolve(spec, path);
      if (next) visit(next);
    }
  };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    const type = /\stype\s*=\s*["']?([^"'\s>]*)/i.exec(attrs)?.[1] ?? '';
    if (!JS_TYPES.test(type)) continue; // JSON-LD and other data blocks run nothing
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (src) {
      const path = resolve(src.replace(/&amp;/g, '&'), pagePath);
      if (path) visit(path);
      continue;
    }
    inline += Buffer.byteLength(m[2]);
    for (const spec of staticImports(m[2])) {
      const path = resolve(spec, pagePath);
      if (path) visit(path);
    }
  }
  const list = [...files].map(([path, bytes]) => ({ path, bytes })).sort((a, b) => b.bytes - a.bytes);
  return { bytes: inline + list.reduce((n, f) => n + f.bytes, 0), inline, files: list, missing: [...missing] };
}

/** A file reader over a dist/ directory, for `eagerScripts`. */
export function distReader(dist: string): (sitePath: string) => string | null {
  return (sitePath) => {
    const file = normalize(join(dist, decodeURIComponent(sitePath)));
    if (!file.startsWith(dist) || !existsSync(file) || !file.endsWith('.js')) return null;
    return readFileSync(file, 'utf8');
  };
}

export interface BudgetRow {
  page: string;
  scripts: PageScripts;
}

/**
 * Every built page under `dist`/docs, and under `dist`/cookbook (the recipe
 * pages run the same page runtime and element loader, ADR-0045), with its
 * eager scripts, largest first.
 */
export function measurePages(dist: string, sections: readonly string[] = ['docs', 'cookbook']): BudgetRow[] {
  const read = distReader(dist);
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name === 'index.html') pages.push(join(dir, e.name));
    }
  };
  for (const section of sections) {
    const root = join(dist, section);
    if (existsSync(root)) walk(root);
  }
  return pages
    .map((file) => {
      const page = `/${relative(dist, file).split(sep).join('/').replace(/index\.html$/, '')}`;
      return { page, scripts: eagerScripts(readFileSync(file, 'utf8'), page, read) };
    })
    .sort((a, b) => b.scripts.bytes - a.scripts.bytes);
}

export const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
