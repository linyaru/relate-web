// The element loader (DOCS-PLAN.md §7, the docs README "Interactive
// elements"): finds the page's interactive elements and imports each one's
// module, src/scripts/docs/elements/<name>.ts, as a lazy chunk when its host
// comes within 600 px of the viewport or the reader points at, touches or
// focuses it; never with the page. The modules are found by directory
// (`import.meta.glob`), so adding an element edits nothing here.
//
// Hosts:
//   <docs-element data-element="<name>">   a directive (constructs.ts): the static form in
//                                          .element-static, an empty .element-live
//   <cypher-cell data-elements="<m> …">    a cell whose info string carries element words
//                                          (cells.ts CELL_WORDS); each module mounts on the cell
//   [data-bar-element="<name>"] on the     an engine-bar toggle: shown once its module exists,
//   engine bar                             the module loaded on the first press
//
// A host whose module is missing, or whose module fails, keeps its static
// form (`data-state` says which). Every mount's returned function runs, and
// every context's signal aborts, when the page is unloaded. A page the
// browser keeps in its back/forward cache (pagehide with `persisted`) is
// frozen, not unloaded: its elements, their listeners and their graph views
// stay as they are, so they work again when the reader comes back.

import type { BarContext, ElementContext, ElementModule, PageApi } from './element-api.ts';

const modules = import.meta.glob<ElementModule>(['./elements/*.ts', '!./elements/_*.ts']);
const moduleOf = (name: string) => modules[`./elements/${name}.ts`];

/** What brings an element's module in before it scrolls near: the reader reaching for it. */
const TRIGGERS = ['pointerenter', 'pointerdown', 'touchstart', 'focusin'] as const;

/** An element's CSS on the page, once per element: a <style> in the head (the CSS rode in the element's lazy chunk). */
function adoptStyles(name: string, css: string) {
  if (document.head.querySelector(`style[data-element-style="${name}"]`)) return;
  const style = document.createElement('style');
  style.dataset.elementStyle = name;
  style.textContent = css;
  document.head.append(style);
}

/** Load and mount the page's elements, each when it is needed. */
export function startElements(page: PageApi) {
  const controller = new AbortController();
  const { signal } = controller;
  const destroys: (() => void)[] = [];
  addEventListener('pagehide', (e) => {
    if (!e.persisted) controller.abort();
  });
  signal.addEventListener('abort', () => {
    for (const d of destroys.splice(0)) {
      try {
        d();
      } catch (err) {
        console.error(err);
      }
    }
  });

  const arms = new Map<Element, () => void>();
  const near = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) arms.get(e.target)?.();
    },
    { rootMargin: '600px 0px' },
  );
  /** Run `load` once, when `host` comes near or the reader reaches it. */
  const arm = (host: HTMLElement, load: () => Promise<void>) => {
    const go = () => {
      if (!arms.delete(host)) return;
      near.unobserve(host);
      for (const t of TRIGGERS) host.removeEventListener(t, go);
      host.dataset.state = 'loading';
      load().then(
        () => {
          if (host.dataset.state === 'loading') host.dataset.state = 'mounted';
        },
        (err) => {
          console.error(err);
          host.dataset.state = 'failed';
        },
      );
    };
    arms.set(host, go);
    near.observe(host);
    for (const t of TRIGGERS) host.addEventListener(t, go, { passive: true });
  };
  const mount = async (mod: ElementModule, name: string, ctx: ElementContext) => {
    if (typeof mod.mount !== 'function') throw new Error(`src/scripts/docs/elements/${name}.ts exports no mount`);
    const destroy = await mod.mount(ctx);
    if (typeof destroy === 'function') destroys.push(destroy);
  };

  for (const host of document.querySelectorAll<HTMLElement>('docs-element[data-element]')) {
    const name = host.dataset.element!;
    const load = moduleOf(name);
    if (!load) {
      host.dataset.state = 'missing';
      continue;
    }
    const staticForm = host.querySelector<HTMLElement>(':scope > .element-static');
    const live = host.querySelector<HTMLElement>(':scope > .element-live')!;
    let attrs: Record<string, string> = {};
    try {
      attrs = JSON.parse(host.dataset.attrs ?? '{}');
    } catch {
      // Written by the build; an element without attributes has none.
    }
    const ctx: ElementContext = {
      name,
      id: host.dataset.elementId ?? name,
      host,
      attrs,
      staticForm,
      live,
      showLive: () => {
        if (staticForm) staticForm.hidden = true;
        live.hidden = false;
        host.dataset.state = 'live';
      },
      showStatic: () => {
        live.hidden = true;
        if (staticForm) staticForm.hidden = false;
        host.dataset.state = 'static';
      },
      adoptStyles: (css) => adoptStyles(name, css),
      cell: null,
      page,
      signal,
    };
    arm(host, async () => mount(await load(), name, ctx));
  }

  for (const host of document.querySelectorAll<HTMLElement>('cypher-cell[data-elements]')) {
    const handle = page.cell(host.dataset.cell ?? '');
    const names = (host.dataset.elements ?? '').split(/\s+/).filter((n) => n && moduleOf(n));
    if (!handle || !names.length) continue;
    arm(host, async () => {
      // Each module mounts on its own, in its own pane: one that fails leaves
      // the others up, and the cell's recorded result is its static form.
      const failed: string[] = [];
      await Promise.all(
        names.map(async (name) => {
          const ctx: ElementContext = {
            name,
            id: handle.id,
            host,
            attrs: { ...handle.words },
            staticForm: null,
            live: handle.slot(name),
            showLive: () => {},
            showStatic: () => {},
            adoptStyles: (css) => adoptStyles(name, css),
            cell: handle,
            page,
            signal,
          };
          try {
            await mount(await moduleOf(name)!(), name, ctx);
          } catch (err) {
            console.error(err);
            failed.push(name);
          }
        }),
      );
      if (failed.length) {
        // Each failure is logged above; `data-failed` names the modules that did not mount.
        host.dataset.failed = failed.join(' ');
        host.dataset.state = 'failed';
      }
    });
  }

  for (const button of page.status.bar.querySelectorAll<HTMLButtonElement>('[data-bar-element]')) {
    const name = button.dataset.barElement!;
    const load = moduleOf(name);
    if (!load) continue;
    button.hidden = false;
    const ctx: BarContext = { button, page, signal, adoptStyles: (css) => adoptStyles(name, css) };
    let mod: Promise<ElementModule> | null = null;
    button.addEventListener('click', async () => {
      const on = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(on));
      try {
        mod ??= load();
        await (await mod).barToggle?.(on, ctx);
      } catch (err) {
        mod = null;
        console.error(err);
      }
    });
  }
}
