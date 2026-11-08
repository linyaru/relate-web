// The generated docs pages (model.ts GENERATED_PAGES) with their renderers,
// and the other generated agent endpoints: the changelog feed and
// /docs/feedback.md. The routes under src/pages/docs/ and the checks
// (src/lib/docs/checks/generated.ts) both read this.

import { GENERATED_PAGES } from '../model.ts';
import { changelogFeed, changelogPage } from './changelog.ts';
import { feedbackMarkdown } from './feedback.ts';
import { glossaryPage } from './glossary.ts';
import { generatedContext, newest, type GeneratedContext, type GeneratedPage, type RenderedPage } from './page.ts';

export { changelogFeed, feedbackMarkdown, generatedContext, newest, type GeneratedContext, type GeneratedPage, type RenderedPage };

/** Every generated page, in GENERATED_PAGES order. */
export const GENERATED: GeneratedPage[] = [glossaryPage, changelogPage];

for (const meta of GENERATED_PAGES) {
  if (!GENERATED.some((g) => g.meta.id === meta.id)) throw new Error(`model.ts lists the generated page ${meta.id}, but src/lib/docs/generated/ has no renderer for it`);
}

/** The generated page `id`, or undefined. */
export const generatedPage = (id: string) => GENERATED.find((g) => g.meta.id === id);

/** `YYYY-MM-DD`: when the page's sources last changed. */
export const generatedUpdated = (g: GeneratedPage) => newest(g.sources());
