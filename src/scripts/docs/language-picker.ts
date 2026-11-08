// The global language picker's page script (LanguagePicker.astro). It works
// through the layout's tab script (src/layouts/Docs.astro), never beside it:
// choosing a language clicks that language's tab, once per key spelling the
// page uses (node, js, …), so the tab script switches every set that has it
// and remembers the key in `docs-tab`; then every spelling of the language is
// put at the front of `docs-tab`, so on the next page the tab script opens
// each set on that language before it paints, whatever key the set uses. A
// reader who clicks a language tab moves the picker to it, and the sets that
// spell the language another way follow.
//
// The tab script rewrites `docs-tab` from the list it read at page load, one
// key per click, so its writes drop spellings the picker added. After every
// tab click, of any tab, the picker rewrites the list so that each language
// in it carries all its spellings, in the tab script's order of recency (a
// language counts once toward the tab script's eight entries). Storage that
// throws (blocked, a private window) leaves the choice for this page only.

import { LANGUAGES, languageOfKey, withSpellings, type Language } from '../../lib/docs/languages.ts';

const TAB_KEY = 'docs-tab';

const readKeys = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(TAB_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
};

const writeKeys = (front: readonly string[]) => {
  const next = withSpellings([...front, ...readKeys()]);
  try {
    localStorage.setItem(TAB_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the choice lasts for this page.
  }
};

/** The tab buttons the tab script made, for one key. */
const buttonsFor = (key: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-tabs] > .tab-list > button')].filter((b) => b.dataset.tabKey === key);

/**
 * Open the tabs a set sits inside (the install block's Python tab is inside
 * its Package tab), so the chosen language is on screen, not only selected.
 */
function reveal(button: HTMLButtonElement) {
  let panel = button.closest('[data-tabs]')?.parentElement?.closest<HTMLElement>('.tab-panel') ?? null;
  while (panel) {
    if (panel.hidden) {
      const set = panel.parentElement;
      const tab = [...(set?.querySelectorAll<HTMLButtonElement>(':scope > .tab-list > button') ?? [])].find((b) => b.dataset.tabKey === panel!.dataset.tabKey);
      tab?.click();
    }
    panel = panel.parentElement?.closest<HTMLElement>('.tab-panel') ?? null;
  }
}

/** True while choose() clicks tabs itself, so the click listener leaves those clicks alone. */
let choosing = false;

/** Choose `lang` in every tab set that has it, open the tabs around the first, and remember it. */
function choose(lang: Language) {
  choosing = true;
  try {
    clickTabsOf(lang);
  } finally {
    choosing = false;
  }
  writeKeys(lang.keys);
}

function clickTabsOf(lang: Language) {
  const first = lang.keys.map((k) => buttonsFor(k)[0]).find(Boolean);
  if (first) reveal(first);
  // Click the canonical key last, so it ends up first in the tab script's memory.
  for (const key of [...lang.keys].reverse()) {
    const b = buttonsFor(key)[0];
    if (b && b.getAttribute('aria-selected') !== 'true') b.click();
    else if (b) {
      // Already shown in that set; other sets with the key may not be.
      for (const other of buttonsFor(key)) if (other.getAttribute('aria-selected') !== 'true') other.click();
    }
  }
}

class LangPicker extends HTMLElement {
  connectedCallback() {
    const select = this.querySelector<HTMLSelectElement>('[data-lang-select]');
    if (!select) return;
    const offered = new Set([...select.options].map((o) => o.value));
    const offeredLanguage = (key: string | undefined) => {
      const l = key === undefined ? undefined : languageOfKey(key);
      return l && offered.has(l.id) ? l : undefined;
    };
    // What the tab script shows: the first remembered key that is an offered
    // language, else the first language tab on the page (a set opens on its first tab).
    const firstTab = [...document.querySelectorAll<HTMLElement>('[data-tabs] > .tab-panel')].map((p) => offeredLanguage(p.dataset.tabKey)).find(Boolean);
    const shown = readKeys().map(offeredLanguage).find(Boolean) ?? firstTab;
    if (shown) select.value = shown.id;
    select.addEventListener('change', () => {
      const lang = LANGUAGES.find((l) => l.id === select.value);
      if (lang) choose(lang);
    });
    // A reader's click on a language tab (or an arrow key, which the tab
    // script turns into a click) moves the picker, and the sets that spell
    // that language with another key follow. The listener is on the document,
    // so it runs after the tab script's own handler on the button.
    document.addEventListener('click', (e) => {
      if (choosing) return;
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tabs] > .tab-list > button');
      const key = b?.dataset.tabKey;
      if (!key) return;
      const lang = offeredLanguage(key);
      if (lang) {
        select.value = lang.id;
        choose(lang);
        return;
      }
      // Any other tab: the tab script has just rewritten docs-tab from its
      // page-load list; put back every spelling of each language in it.
      writeKeys([]);
    });
  }
}

if (!customElements.get('lang-picker')) customElements.define('lang-picker', LangPicker);
