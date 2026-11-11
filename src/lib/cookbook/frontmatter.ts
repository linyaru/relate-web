// Recipe front matter: a deliberately small YAML subset, parsed into a typed
// FrontMatter.
//
// One `key: value` per line. A value is a plain scalar, a `"double"` or
// `'single'` quoted scalar, or a flow list `[a, "b, c", d]`. No nesting, no
// comments, no multi-line values. Parsing checks the whole schema: the keys,
// the required ones, the enumerated values, and the value rules, so a
// FrontMatter is always a valid one.

/** Front-matter keys a recipe may use, in the order the README lists them. */
export const KEYS = [
  'title',
  'summary',
  'level',
  'category',
  'features',
  'browser',
  'dataset',
  'source',
  'license',
  'companion',
] as const;

/** Longest `summary`, in characters. */
export const MAX_SUMMARY_CHARS = 350;

export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'] as const;
/** Every category, in index order. */
export const CATEGORIES = [
  'Agent memory',
  'Search with context',
  'Data wrangling',
  'Code and dependencies',
  'Maps and places',
] as const;
/** `full`: every step runs in the page. `partial`: some steps are shown as code only. */
export const BROWSERS = ['full', 'partial'] as const;

export type Level = (typeof LEVELS)[number];
export type Category = (typeof CATEGORIES)[number];
export type Browser = (typeof BROWSERS)[number];

export interface FrontMatter {
  title: string;
  /** At most MAX_SUMMARY_CHARS characters. */
  summary: string;
  level: Level;
  category: Category;
  /** Non-empty. */
  features: string[];
  browser: Browser;
  /** What a shipped dataset holds; required when the recipe ships one. */
  dataset: string | null;
  source: string | null;
  license: string | null;
  /** The companion program, an `https://` URL. */
  companion: string | null;
}

type Raw = { list: false; value: string } | { list: true; items: string[] };

const chars = (s: string) => [...s].length;

/**
 * Parse front-matter lines (the text between the two `---` lines). Throws
 * an Error listing every problem found, one per line.
 */
export function parseFrontMatter(text: string): FrontMatter {
  const raw = parseRaw(text);
  const errs: string[] = [];
  const scalar = (key: string): string | null => {
    const v = raw.get(key);
    if (!v) return null;
    if (v.list) {
      errs.push(`\`${key}\` must be a single value, not a list`);
      return null;
    }
    return v.value;
  };
  const title = scalar('title');
  const summary = scalar('summary');
  const level = scalar('level');
  const category = scalar('category');
  const browser = scalar('browser');
  const dataset = scalar('dataset');
  const source = scalar('source');
  const license = scalar('license');
  const companion = scalar('companion');
  let features: string[] | null = null;
  const f = raw.get('features');
  if (f?.list && f.items.length > 0) features = f.items;
  else if (f) errs.push('`features` must be a non-empty list');

  for (const [key, value] of [
    ['title', title],
    ['summary', summary],
    ['level', level],
    ['category', category],
    ['browser', browser],
  ] as const) {
    if (value === null && !raw.has(key)) errs.push(`front matter is missing \`${key}\``);
  }
  if (features === null && !raw.has('features')) errs.push('front matter is missing `features`');

  const lvl = level === null ? null : oneOf('level', level, LEVELS, errs);
  const cat = category === null ? null : oneOf('category', category, CATEGORIES, errs);
  const br = browser === null ? null : oneOf('browser', browser, BROWSERS, errs);
  if (summary !== null && chars(summary) > MAX_SUMMARY_CHARS) {
    errs.push(`\`summary\` is longer than ${MAX_SUMMARY_CHARS} characters`);
  }
  if (companion !== null && !companion.startsWith('https://')) {
    errs.push('`companion` must be an https:// URL');
  }

  if (errs.length || title === null || summary === null || lvl === null || cat === null || features === null || br === null) {
    throw new Error(errs.join('\n'));
  }
  return { title, summary, level: lvl, category: cat, features, browser: br, dataset, source, license, companion };
}

function oneOf<T extends string>(key: string, value: string, all: readonly T[], errs: string[]): T | null {
  if ((all as readonly string[]).includes(value)) return value as T;
  errs.push(`\`${key}: ${value}\` is not one of [${all.map((v) => JSON.stringify(v)).join(', ')}]`);
  return null;
}

function parseRaw(text: string): Map<string, Raw> {
  const map = new Map<string, Raw>();
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;
    const colon = line.indexOf(':');
    if (colon < 0) throw new Error(`front matter line ${i + 1}: expected \`key: value\``);
    const key = line.slice(0, colon).trim();
    if (!(KEYS as readonly string[]).includes(key)) {
      throw new Error(`front matter line ${i + 1}: unknown key \`${key}\``);
    }
    const rawValue = line.slice(colon + 1).trim();
    let value: Raw;
    try {
      if (rawValue.startsWith('[')) {
        if (!rawValue.endsWith(']')) throw new Error('unterminated list');
        value = { list: true, items: splitList(rawValue.slice(1, -1)) };
      } else {
        value = { list: false, value: unquote(rawValue) };
      }
    } catch (e) {
      throw new Error(`front matter \`${key}\`: ${(e as Error).message}`);
    }
    if (map.has(key)) throw new Error(`front matter: duplicate key \`${key}\``);
    map.set(key, value);
  });
  return map;
}

function splitList(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  let escaped = false;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (escaped) escaped = false;
      else if (ch === '\\' && quote === '"') escaped = true;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      items.push(unquote(current.trim()));
      current = '';
    } else {
      current += ch;
    }
  }
  if (quote) throw new Error('unterminated quote in list');
  if (current.trim() !== '') items.push(unquote(current.trim()));
  if (items.some((s) => s === '')) throw new Error('empty list item');
  return items;
}

function unquote(raw: string): string {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) throw new Error(`unterminated string ${raw}`);
    const body = raw.slice(1, -1);
    let out = '';
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === '\\') {
        const next = body[++i];
        if (next === '"' || next === '\\') out += next;
        else throw new Error(`unsupported escape \\${next ?? ''} in ${raw}`);
      } else {
        out += ch;
      }
    }
    return out;
  }
  if (raw.startsWith("'")) {
    if (raw.length < 2 || !raw.endsWith("'")) throw new Error(`unterminated string ${raw}`);
    return raw.slice(1, -1);
  }
  return raw;
}
