// The docs chrome shared by docs pages and recipe pages: the phone menu that
// opens the sidebar, and the header's search input. Both are optional: a page without
// the elements runs neither. The ⌘K shortcut is site-wide (site-search.ts).
import { bindSearch } from '../search.ts';

// ---------- Phone menu: the sidebar opens from the header ----------
const shell = document.querySelector<HTMLElement>('.chrome-shell');
const toggle = document.getElementById('docsNavToggle') as HTMLButtonElement | null;
const sidebar = document.getElementById('docsNav');
if (shell && toggle && sidebar) {
  shell.dataset.navJs = '';
  toggle.hidden = false;
  const close = () => {
    sidebar.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = sidebar.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  sidebar.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a')) close();
  });
  document.addEventListener('click', (e) => {
    if (!sidebar.contains(e.target as Node) && !toggle.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

// ---------- Search ----------
const box = document.querySelector<HTMLElement>('[data-search]');
const input = document.getElementById('docsSearch') as HTMLInputElement | null;
const results = document.getElementById('docsSearchResults');
if (box && input && results) {
  box.hidden = false;
  bindSearch(box, input, results);
}
