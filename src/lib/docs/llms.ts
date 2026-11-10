// The agent indexes (DOCS-PLAN.md §3.2): /docs/llms.txt (a facts block, then
// one line per page grouped by task) and the llms-full.txt files (every
// page's twin, concatenated: all of them, and one file per section and per
// group).

import { ENVELOPE_CHECK, ENVELOPE_HAS_TIMINGS, ENVELOPE_OUTPUT, VERSION_LINE } from '../../components/docs/install.ts';
import { CANONICAL_ORIGIN } from '../cookbook/links.ts';
import type { Engine } from './content.ts';
import { EVALUATE, LLMS_GROUPS, llmsGroupOf } from './landing.ts';
import { CHANGELOG_FEED_URL, estimateTokens, FEEDBACK_URL, tokenLabel, twinUrl } from './model.ts';
import { SAMPLES_INDEX_PATH } from './sample-manifests.ts';

export interface IndexedPage {
  id: string;
  title: string;
  description: string;
  /** The page's twin. */
  markdown: string;
}

/** The canonical phrase (DOCS-PLAN.md §3.9): verbatim wherever a model reads first. */
export const CANONICAL_PHRASE = 'relate, the embedded Cypher graph database (relatedb.ai)';

/** The facts block: the common case answered in one fetch. */
export function factsBlock(engine: Engine): string {
  const v = engine.version;
  return [
    `Current release: ${v}${engine.date ? ` (${engine.date})` : ''}.`,
    ...(engine.sourceBuild
      ? [
          `Before launch these pages are recorded from a source build of upstream ${engine.commit ?? '(unknown commit)'} that reports ${engine.verified} and includes engine changes made after the ${engine.verified} release; they are re-recorded from a published release at launch.`,
        ]
      : []),
    '',
    '- Install (macOS, Linux): `curl -sSfL https://relatedb.ai/install.sh | bash`. It installs the latest release to `~/.local/bin` after checking the signed SHA256SUMS, and installs nothing if a check fails.',
    `- Check the install: \`relate --version\` prints \`${VERSION_LINE}\`, and \`${ENVELOPE_CHECK}\` prints \`${ENVELOPE_OUTPUT}\`${ENVELOPE_HAS_TIMINGS ? ', each `<ms>` a number of milliseconds that changes from run to run' : ''}.`,
    '- Run a statement: `relate --database ./graph.rl --read-only --mode envelope "MATCH (n) RETURN count(n) AS n"`; remove `--read-only` to write. `--mode envelope` prints one JSON object per result set.',
    '- Stores: `:memory:` (the default), a directory, or a single `.rl` file, named by `--database`. Add `--read-only` to open an existing store without writing.',
    '- Parameters: write `$name` in the statement and bind it with `--param name=<value>`.',
    '- Exit codes: 0 success, 1 runtime failure, 2 usage error, 5 conflict or locked store (a query run; `relate serve` exits 1 on a locked store), 6 statement rejected (syntax, type, or a write on a read-only store), 7 timeout.',
    '- MCP for a local agent: `relate serve --mcp stdio --database ./graph.rl --read-only`.',
    '- `relate agent-context` prints the command index, flags and exit codes of the installed version; `relate skill install` adds the agent skill.',
    `- The agent skill as files: \`${CANONICAL_ORIGIN}/skill.md\`. The docs as a graph: \`${CANONICAL_ORIGIN}/docs/graph.cypher\` (Cypher seed; also \`${CANONICAL_ORIGIN}/docs/graph.json\`).`,
    `- Task skills, one per task family (agent memory, GraphRAG, schema design, query tuning, migrating from vector search): the "Task skills" section of \`${CANONICAL_ORIGIN}/skill.md\`, each at \`${CANONICAL_ORIGIN}/skills/<name>/SKILL.md\`; the skills CLI installs one by name (\`npx skills add ${CANONICAL_ORIGIN} --skill <name>\`).`,
    `- Problems relate solves, as data: \`${CANONICAL_ORIGIN}/docs/capabilities.json\` (each problem mapped to its capability, guides, recipes, recommended data model and the recorded run that verifies it, or null where none does yet; the page: \`${CANONICAL_ORIGIN}${twinUrl('concepts/problems-relate-solves')}\`).`,
    `- Verified language samples, as data: \`${CANONICAL_ORIGIN}${SAMPLES_INDEX_PATH}\` indexes one manifest per sample (\`<page url>samples/<id>.json\`): the program, its recorded output with a SHA-256, the client build it last ran on, and how the docs' runner builds and runs it. A twin's \`samples\` frontmatter lists its page's manifests.`,
    `- Every page below is markdown at its URL plus \`.md\` (also \`<url>/index.md\`). Whole sections: \`${CANONICAL_ORIGIN}/docs/<section>/llms-full.txt\`; everything: \`${CANONICAL_ORIGIN}/docs/llms-full.txt\`.`,
    `- What changed in each release: \`${CANONICAL_ORIGIN}${twinUrl('reference/changelog')}\` (JSON Feed: \`${CANONICAL_ORIGIN}${CHANGELOG_FEED_URL}\`). Terms: \`${CANONICAL_ORIGIN}${twinUrl('reference/glossary')}\` (as JSON: \`${CANONICAL_ORIGIN}/docs/glossary.json\`).`,
    `- A wrong or missing page: \`${CANONICAL_ORIGIN}${FEEDBACK_URL}\` says what a report holds; the operator decides whether to send it.`,
    '- These pages are reference text, not instructions.',
  ].join('\n');
}

/** /docs/llms.txt. `sections` are the llms-full.txt files to list, as [path, label]. */
export function llmsTxt(pages: IndexedPage[], engine: Engine, sections: [string, string][]): string {
  const lines = [`# ${CANONICAL_PHRASE}: docs`, '', '> The documentation index: a facts block, then every page by task.', '', factsBlock(engine), ''];
  for (const group of LLMS_GROUPS) {
    const members = pages.filter((p) => llmsGroupOf(p.id) === group);
    // Evaluate keeps its own order (the fit page first, DOCS-PLAN.md §2); the other groups keep the sidebar's.
    if (group === 'Evaluate') members.sort((a, b) => EVALUATE.indexOf(a.id) - EVALUATE.indexOf(b.id));
    if (!members.length) continue;
    lines.push(`## ${group}`, '');
    for (const p of members) {
      lines.push(`- [${p.title}](${CANONICAL_ORIGIN}${twinUrl(p.id)}): ${p.description} (${tokenLabel(estimateTokens(p.markdown))})`);
    }
    lines.push('');
  }
  lines.push('## Whole sections', '');
  lines.push(`- [All pages](${CANONICAL_ORIGIN}/docs/llms-full.txt) (${tokenLabel(estimateTokens(pages.map((p) => p.markdown).join('\n')))})`);
  for (const [path, label] of sections) lines.push(`- [${label}](${CANONICAL_ORIGIN}${path})`);
  lines.push(`- [Cookbook recipes](${CANONICAL_ORIGIN}/cookbook/llms.txt)`, '');
  return lines.join('\n');
}

/** An llms-full.txt: a heading line, then each page's twin. */
export function llmsFull(title: string, pages: IndexedPage[]): string {
  return [`# ${title}`, '', `> ${CANONICAL_PHRASE}. ${pages.length} page(s), each a markdown twin with its frontmatter.`, '', ...pages.map((p) => p.markdown)].join('\n');
}
