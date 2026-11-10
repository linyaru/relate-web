// "On this page" scroll spy: marks the link of the section being read (`aria-current="location"`).
// A section is current from the moment its heading passes just under the sticky bars until the next
// heading does; at the foot of the page the last one is current. Used by docs and recipe pages.
const nav = document.querySelector<HTMLElement>('nav[aria-label="On this page"]');
if (nav) {
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
  const targets = links
    .map((a) => ({ a, el: document.getElementById(decodeURIComponent(a.hash.slice(1))) }))
    .filter((t): t is { a: HTMLAnchorElement; el: HTMLElement } => t.el !== null);
  if (targets.length) {
    const offset = () => {
      const bars = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
      return bars + 96;
    };
    let current: HTMLAnchorElement | null = null;
    // A clicked link stays current until the reader scrolls on their own: near the foot of a page a
    // heading may never reach the trigger line.
    let chosen: HTMLAnchorElement | null = null;
    let queued = false;
    const update = () => {
      queued = false;
      const line = offset();
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let pick = chosen ? targets.find((t) => t.a === chosen) ?? null : atEnd ? targets[targets.length - 1] : null;
      if (!pick) for (const t of targets) if (t.el.getBoundingClientRect().top <= line) pick = t;
      const next = pick?.a ?? null;
      if (next === current) return;
      current?.removeAttribute('aria-current');
      next?.setAttribute('aria-current', 'location');
      current = next;
      // Keep the active link visible when the list scrolls on its own (the sticky column).
      if (next && nav.scrollHeight > nav.clientHeight) next.scrollIntoView({ block: 'nearest' });
    };
    const queue = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    for (const a of links) a.addEventListener('click', () => { chosen = a; queue(); });
    const release = () => { if (chosen) { chosen = null; queue(); } };
    for (const ev of ['wheel', 'touchmove', 'keydown']) window.addEventListener(ev, release, { passive: true });
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    window.addEventListener('hashchange', queue);
    update();
  }
}
