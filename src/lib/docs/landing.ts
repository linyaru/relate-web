// The docs landing page's task index (DOCS-PLAN.md §2 "Landing"): the one
// primary navigation scheme, "I want to…", grouped as /docs/llms.txt is.
// Tasks name the page that answers them; a page not written yet renders as
// text. The landing page and its twin (/docs/index.md) both read this.

import { FEEDBACK_URL } from './model.ts';

export interface Task {
  text: string;
  page: string;
}

export interface TaskGroup {
  id: LlmsGroup;
  tasks: Task[];
}

export const LLMS_GROUPS = ['Evaluate', 'Get started', 'Agents', 'Guides', 'Reference', 'Concepts'] as const;
export type LlmsGroup = (typeof LLMS_GROUPS)[number];

export const TASKS: TaskGroup[] = [
  {
    id: 'Evaluate',
    tasks: [
      { text: 'See where relate fits, and where it does not', page: 'concepts/where-relate-fits' },
      { text: 'Check the performance numbers', page: 'reference/performance' },
      { text: 'Read the limitations', page: 'reference/limitations' },
      { text: 'Check the license, versioning and release process', page: 'reference/project' },
    ],
  },
  {
    id: 'Get started',
    tasks: [
      { text: 'Install relate', page: 'get-started/install' },
      { text: 'Build a first graph in the CLI', page: 'get-started/first-graph' },
      { text: 'Embed relate in a Python app', page: 'get-started/python' },
      { text: 'Embed relate in a Node.js app', page: 'get-started/node' },
    ],
  },
  {
    id: 'Agents',
    tasks: [
      { text: 'Connect your agent to relate', page: 'get-started/agent-quickstart' },
      { text: 'Install the agent skill', page: 'guides/agents/install-the-skill' },
      { text: 'Connect over MCP', page: 'guides/agents/connect-over-mcp' },
      { text: 'Drive relate from an agent', page: 'guides/agents/drive-relate-from-an-agent' },
      { text: 'Keep an agent safe', page: 'guides/agents/agent-safety' },
      { text: 'Run relate in a sandbox', page: 'guides/agents/run-in-a-sandbox' },
      { text: 'Model agent memory as a graph', page: 'guides/agents/model-agent-memory' },
      { text: 'Use relate from the Claude Agent SDK', page: 'guides/integrations/claude-agent-sdk' },
      { text: 'Give a LangGraph agent long-term memory', page: 'guides/integrations/langgraph' },
      { text: 'Back a Vercel AI SDK tool with relate, read-only', page: 'guides/integrations/vercel-ai-sdk' },
      { text: 'See what agent mode changes in the CLI', page: 'reference/cli/agent-mode' },
      { text: 'Understand why relate is agent-native', page: 'concepts/agent-native' },
    ],
  },
  {
    id: 'Guides',
    tasks: [
      { text: 'Import a CSV', page: 'guides/cypher/import-csv' },
      { text: 'Search by vector similarity', page: 'guides/cypher/vector-search' },
      { text: 'Tune a query', page: 'guides/cypher/tune-a-query' },
      { text: 'Size a store and its memory', page: 'guides/operate/sizing-and-memory' },
      { text: 'Share one store between two processes', page: 'guides/operate/two-processes-one-store' },
      { text: 'Recover from a crash', page: 'guides/operate/crash-and-recovery' },
      { text: 'Choose a durability mode', page: 'guides/operate/durability-modes' },
      { text: 'Upgrade a store', page: 'guides/operate/upgrade-a-store' },
      { text: 'Fix an error or an exit code', page: 'guides/operate/troubleshooting' },
      { text: 'Choose a store layout', page: 'guides/storage/choose-a-store-layout' },
      { text: 'Back up and restore a store', page: 'guides/storage/backup-and-restore' },
      { text: 'Script the CLI', page: 'guides/cli/scripting' },
    ],
  },
  {
    id: 'Reference',
    tasks: [
      { text: 'Look up an error', page: 'reference/errors' },
      { text: 'Look up a CLI command', page: 'reference/cli' },
      { text: 'Look up a CLI flag or environment variable', page: 'reference/cli/flags' },
      { text: 'Look up an exit code and the error object', page: 'reference/cli/exit-codes-and-errors' },
      { text: 'Check what Cypher relate supports', page: 'reference/cypher/overview' },
      { text: 'See how relate Cypher differs from Neo4j', page: 'reference/cypher/differences-from-neo4j' },
      { text: 'Look up vector and full-text search syntax', page: 'reference/cypher/search' },
      { text: 'Look up the storage formats', page: 'reference/storage/formats' },
      { text: 'Look up limits and sizing', page: 'reference/storage/limits-and-sizing' },
      { text: 'Check how releases are signed and verified', page: 'reference/security' },
      { text: 'See what relate collects and sends', page: 'reference/privacy-and-telemetry' },
      { text: 'Read the changelog', page: 'reference/changelog' },
      { text: 'Look up a term in the glossary', page: 'reference/glossary' },
    ],
  },
  {
    id: 'Concepts',
    tasks: [
      { text: 'Understand storage and durability', page: 'concepts/storage-and-durability' },
      { text: 'Understand transactions and concurrency', page: 'concepts/transactions-and-concurrency' },
      { text: 'Understand the Cypher dialect', page: 'concepts/cypher-dialect' },
      { text: 'Understand how relate is built', page: 'concepts/architecture' },
    ],
  },
];

/** The three buttons above the task index. */
export const PRIMARY = [
  { text: 'Get started', page: 'get-started/install' },
  { text: 'Connect your agent', page: 'get-started/agent-quickstart' },
  { text: 'Does relate fit?', page: 'concepts/where-relate-fits' },
];

/** Pages that belong in llms.txt's Evaluate group, in its order. */
export const EVALUATE = ['concepts/where-relate-fits', 'reference/performance', 'reference/limitations', 'reference/project'];

/** The llms.txt group of page `id`. */
export function llmsGroupOf(id: string): LlmsGroup {
  if (EVALUATE.includes(id)) return 'Evaluate';
  if (
    /^get-started\/agent-/.test(id) ||
    /^guides\/(agents|integrations)(\/|$)/.test(id) ||
    ['concepts/agent-native', 'reference/cli/agent-mode', 'reference/server/docs-mcp'].includes(id)
  ) {
    return 'Agents';
  }
  if (id.startsWith('get-started')) return 'Get started';
  if (id.startsWith('guides')) return 'Guides';
  if (id.startsWith('reference')) return 'Reference';
  return 'Concepts';
}

/** A task's page as a link target: its URL when the page is published, else null (rendered as text). */
export const taskHref = (page: string, published: Set<string>) => (published.has(page) ? `/docs/${page}/` : null);

/** What the landing's twin needs beyond the task index. */
export interface LandingTwinContext {
  origin: string;
  /** The verified engine version (_data/engine.json). */
  verified: string;
  /** The version line every twin carries, after the description. */
  versionLine: string;
  /** `YYYY-MM-DD`: when the landing page last changed. */
  lastUpdated: string;
  /** The AGENTS.md block from install.ts (one block on install, agent-quickstart and the landing; DOCS-PLAN.md §3.4). */
  agentsMd: string;
}

/** The landing's twin (/docs/index.md): the twin frontmatter, the task index with links to published pages, and the AGENTS.md block. */
export function landingTwin(published: Set<string>, ctx: LandingTwinContext): string {
  const { origin } = ctx;
  const link = (t: Task) => {
    const href = taskHref(t.page, published);
    return href ? `[${t.text}](${origin}${href.replace(/\/$/, '.md')})` : `${t.text} (not written yet)`;
  };
  const lines = [
    '---',
    'title: relate docs',
    'description: "relate, the embedded Cypher graph database (relatedb.ai): documentation to install it, connect an agent, and look up a command or an error."',
    'surfaces: []',
    'status: stable',
    `verified: ${ctx.verified}`,
    `canonical_url: ${origin}/docs/`,
    'prerequisites: []',
    'related: []',
    `last_updated: ${ctx.lastUpdated}`,
    '---',
    '',
    '# relate docs',
    '',
    ctx.versionLine,
    '',
    `The index for agents, with a facts block: ${origin}/docs/llms.txt`,
    '',
    `How a wrong or missing page is reported: ${origin}${FEEDBACK_URL}`,
    '',
  ];
  for (const g of TASKS) {
    lines.push(`## ${g.id}`, '', ...g.tasks.map((t) => `- ${link(t)}`), '');
  }
  lines.push('## Add relate to your AGENTS.md', '', '```markdown', ctx.agentsMd.trimEnd(), '```', '');
  return lines.join('\n');
}
