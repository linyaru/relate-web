// Code highlighting for docs pages: Shiki with a light and a dark theme, emitted as
// --shiki-light / --shiki-dark custom properties; src/styles/cookbook.css picks one from
// the site's Day/Night theme. The languages are the ones docs pages use.

import { createHighlighter, type Highlighter } from 'shiki';

export const THEMES = { light: 'github-light-default', dark: 'github-dark-default' } as const;
const LANGS = ['cypher', 'python', 'shellscript', 'json', 'javascript', 'typescript', 'rust', 'toml', 'yaml', 'java', 'go', 'swift', 'c', 'markdown', 'html', 'powershell', 'dockerfile'];
const ALIASES: Record<string, string> = { sh: 'shellscript', bash: 'shellscript', shell: 'shellscript', zsh: 'shellscript', console: 'shellscript', js: 'javascript', ts: 'typescript', py: 'python', yml: 'yaml', md: 'markdown', ps1: 'powershell' };

export type Highlight = (code: string, lang: string) => string;

let cached: Promise<Highlight> | null = null;

/** A highlighter: `(code, lang) => <pre class="shiki">…</pre>`; an unknown language renders as plain text. */
export function highlighter(): Promise<Highlight> {
  cached ??= createHighlighter({ themes: [THEMES.light, THEMES.dark], langs: LANGS }).then((h: Highlighter) => (code: string, lang: string) => {
    const l = ALIASES[lang] ?? lang;
    const known = h.getLoadedLanguages().includes(l);
    return h.codeToHtml(code, { lang: known ? l : 'text', themes: THEMES, defaultColor: false });
  });
  return cached;
}
