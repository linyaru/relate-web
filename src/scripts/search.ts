// Search (Pagefind): the results list behind the docs header's input and the site-wide overlay
// (site-search.ts). Pagefind loads on first focus; without a build index the list says so.
interface PagefindResult {
  data: () => Promise<{ url: string; excerpt: string; meta: { title?: string } }>;
}
interface Pagefind {
  options: (o: Record<string, unknown>) => Promise<void>;
  debouncedSearch: (q: string) => Promise<{ results: PagefindResult[] } | null>;
}
export function bindSearch(box: HTMLElement, input: HTMLInputElement, results: HTMLElement): void {
  let pagefind: Promise<Pagefind | null> | null = null;
  const load = () => {
    const url = '/pagefind/pagefind.js';
    pagefind ??= import(/* @vite-ignore */ url)
      .then(async (pf: Pagefind) => {
        await pf.options({ excerptLength: 18 });
        return pf;
      })
      .catch(() => null);
    return pagefind;
  };
  const show = (html: string) => {
    results.innerHTML = html;
    results.hidden = !html;
    input.setAttribute('aria-expanded', String(!!html));
  };
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  input.addEventListener('focus', () => void load(), { once: true });
  input.addEventListener('input', async () => {
    const q = input.value.trim();
    if (!q) return show('');
    const pf = await load();
    if (!pf) return show('<p class="search-note">Search is built with the site (npm run build).</p>');
    const found = await pf.debouncedSearch(q);
    if (found === null || input.value.trim() !== q) return; // superseded by a newer query
    if (!found.results.length) return show(`<p class="search-note">No results for “${esc(q)}”.</p>`);
    const items = await Promise.all(found.results.slice(0, 8).map((r) => r.data()));
    show(
      items
        .map(
          (d, i) =>
            `<a class="search-hit" role="option" id="hit-${i}" href="${esc(d.url)}"><span class="hit-title">${esc(d.meta.title ?? d.url)}</span>` +
            `<span class="hit-excerpt">${d.excerpt}</span></a>`,
        )
        .join(''),
    );
  });
  input.addEventListener('keydown', (e) => {
    const hits = [...results.querySelectorAll<HTMLAnchorElement>('.search-hit')];
    if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault();
      hits[0].focus();
    } else if (e.key === 'Escape') {
      input.value = '';
      show('');
    }
  });
  results.addEventListener('keydown', (e) => {
    const hits = [...results.querySelectorAll<HTMLAnchorElement>('.search-hit')];
    const i = hits.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === 'ArrowDown' && i < hits.length - 1) {
      e.preventDefault();
      hits[i + 1].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (i > 0 ? hits[i - 1] : input).focus();
    } else if (e.key === 'Escape') {
      input.focus();
      show('');
    }
  });
  document.addEventListener('click', (e) => {
    if (!box.contains(e.target as Node)) show('');
  });
}
