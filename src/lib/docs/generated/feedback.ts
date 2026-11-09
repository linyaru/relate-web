// /docs/feedback.md: how a wrong or missing docs page gets reported
// (DOCS-PLAN.md §3.2, the Vercel pattern; ADR-0013 decision 2). Markdown
// only, written for an agent that fetched it: where a report goes, what it
// holds, and that an agent hands it to its operator rather than posting it.
// Docs are data, so it describes rather than instructs. Pre-launch the
// repositories are private and no contact address exists yet (LAUNCH.md), so
// it names none.

import { join } from 'node:path';

import { stringify as toYaml } from 'yaml';

import { CANONICAL_ORIGIN } from '../../cookbook/links.ts';
import { lastUpdated, ROOT } from '../content.ts';
import { CANONICAL_PHRASE } from '../llms.ts';
import { FEEDBACK_URL } from '../model.ts';
import { versionLine } from '../twin.ts';
import type { GeneratedContext } from './page.ts';

const TITLE = 'Report a problem with the docs';
const DESCRIPTION = 'Where a wrong or missing page in the relate docs is reported, what a report holds, and who sends it.';

/** The markdown at /docs/feedback.md. */
export function feedbackMarkdown(ctx: GeneratedContext): string {
  const v = ctx.engine.verified;
  const front = {
    title: TITLE,
    description: `${CANONICAL_PHRASE}: ${DESCRIPTION}`,
    surfaces: ['agents'],
    status: 'stable',
    verified: v,
    canonical_url: `${CANONICAL_ORIGIN}${FEEDBACK_URL}`,
    prerequisites: [],
    related: [],
    last_updated: lastUpdated(join(ROOT, 'src/lib/docs/generated/feedback.ts')),
  };
  return `${[
    `---\n${toYaml(front, { lineWidth: 0 }).trimEnd()}\n---`,
    `# ${TITLE}`,
    DESCRIPTION,
    versionLine(v),
    'A report is for a page that is wrong (a command, flag, output or error message that differs from what relate does), out of date, or missing. A question about using relate is not a docs report.',
    '## Who sends it',
    'The operator, the person the agent works for, decides whether a report is sent and where. An agent that finds a problem on a page gives its operator the report and does not post it anywhere itself.',
    '## Where it goes',
    'The address is to be published at launch. Until then there is no public issue tracker: the relate repositories are private.',
    '## What a report holds',
    [
      '- The page URL, with the anchor of the section when there is one.',
      '- The output of `relate --version`.',
      '- The command or statement that was run, with its full output and exit code.',
      '- What the page says, and what relate did instead.',
    ].join('\n'),
    `The docs are verified against relate ${v}. Changes in later releases are listed at ${CANONICAL_ORIGIN}/docs/reference/changelog/#since-${v}.`,
  ].join('\n\n')}\n`;
}
