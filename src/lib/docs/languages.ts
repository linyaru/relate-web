// The tab-key vocabulary of the global language picker (DOCS-PLAN.md §7.3,
// "Global language picker"): which `:::tab[…]{key=…}` keys name a language,
// and which keys are one language. A tab set whose keys are languages follows
// the picker; every set keeps its own tabs. Shared by the picker's build-time
// detection (LanguagePicker.astro) and its page script
// (src/scripts/docs/language-picker.ts), so keep it free of Node imports.

export interface Language {
  /** The language's id: the key a page should write. */
  id: string;
  /** What the picker shows. */
  label: string;
  /** Every tab key that means this language, the id first. */
  keys: string[];
}

/** The vocabulary, in the order the picker lists it. */
export const LANGUAGES: readonly Language[] = [
  { id: 'python', label: 'Python', keys: ['python'] },
  { id: 'node', label: 'Node.js', keys: ['node', 'js', 'javascript', 'nodejs', 'node-js'] },
  { id: 'rust', label: 'Rust', keys: ['rust'] },
  { id: 'c', label: 'C', keys: ['c'] },
  { id: 'java', label: 'Java', keys: ['java'] },
  { id: 'go', label: 'Go', keys: ['go'] },
  { id: 'swift', label: 'Swift', keys: ['swift'] },
  { id: 'browser', label: 'Browser', keys: ['browser', 'wasm'] },
  { id: 'cli', label: 'CLI', keys: ['cli'] },
];

/** The language a tab key names, or undefined when it names none (`agent`, `macos-linux`). */
export const languageOfKey = (key: string): Language | undefined => LANGUAGES.find((l) => l.keys.includes(key));

/** The key a tab without `{key=…}` gets from its label (the `::::tabs` directive's rule, constructs.ts). */
export const keyFromLabel = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * The languages the picker offers for a page whose tab sets have `sets`
 * keys: every language any set names, in vocabulary order, when at least one
 * set names two or more languages (a set to choose between); otherwise none,
 * and the page shows no picker.
 */
export function pickerLanguages(sets: string[][]): Language[] {
  const per = sets.map((keys) => new Set(keys.map(languageOfKey).filter((l): l is Language => l !== undefined).map((l) => l.id)));
  if (!per.some((s) => s.size >= 2)) return [];
  const all = new Set(per.flatMap((s) => [...s]));
  return LANGUAGES.filter((l) => all.has(l.id));
}

/**
 * The tab sets a page's MDX source writes as `::::tabs` containers, each as
 * its tabs' keys in order (a label-derived key where `{key=…}` is absent).
 * Fenced code is skipped, so a README showing the syntax counts nothing.
 * Generated components (`<Install />`) are not seen here; their caller adds
 * their sets.
 */
export function tabSetsOf(source: string): string[][] {
  const sets: string[][] = [];
  let current: string[] | null = null;
  let fence: string | null = null;
  for (const line of source.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1];
      else if (f[1].startsWith(fence[0]) && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (/^\s*::::tabs\s*$/.test(line)) {
      current = [];
      sets.push(current);
      continue;
    }
    const tab = /^\s*:::tab\[([^\]]*)\](?:\{([^}]*)\})?\s*$/.exec(line);
    if (tab && current) {
      const key = /(?:^|\s)key=("?)([^"\s}]+)\1/.exec(tab[2] ?? '')?.[2];
      current.push(key ?? keyFromLabel(tab[1]));
      continue;
    }
    if (/^\s*::::\s*$/.test(line)) current = null;
  }
  return sets.filter((s) => s.length > 0);
}

/**
 * How many choices `docs-tab` keeps: the eight of the layout's tab script
 * (src/layouts/Docs.astro), a language's spellings counting as one.
 */
export const KEPT_CHOICES = 8;

/**
 * The language picker's `docs-tab` list: `keys` in order, each language key
 * followed by every other spelling of its language, at most KEPT_CHOICES
 * choices: ["windows", "node", "cli"] becomes
 * ["windows", "node", "js", "javascript", "nodejs", "node-js", "cli"]. Used
 * by the picker's page script, so keep it free of Node imports.
 */
export function withSpellings(keys: readonly string[]): string[] {
  const out: string[] = [];
  let choices = 0;
  for (const key of keys) {
    if (out.includes(key)) continue;
    if (choices === KEPT_CHOICES) break;
    choices++;
    const lang = languageOfKey(key);
    for (const k of lang ? [key, ...lang.keys.filter((x) => x !== key)] : [key]) if (!out.includes(k)) out.push(k);
  }
  return out;
}
