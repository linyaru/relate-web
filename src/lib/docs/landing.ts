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
      { text: 'Find the problems relate solves', page: 'concepts/problems-relate-solves' },
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
      { text: 'Run relate in the browser', page: 'get-started/browser' },
      { text: 'Embed relate in a Rust program', page: 'get-started/rust' },
      { text: 'Embed relate in a C program', page: 'get-started/c' },
      { text: 'Embed relate in a Java app', page: 'get-started/java' },
      { text: 'Embed relate in a Go program', page: 'get-started/go' },
      { text: 'Embed relate in a Swift app', page: 'get-started/swift' },
    ],
  },
  {
    id: 'Agents',
    tasks: [
      { text: 'Connect your agent to relate', page: 'get-started/agent-quickstart' },
      { text: 'Give an agent a memory', page: 'get-started/agent-memory' },
      { text: 'Install the agent skill', page: 'guides/agents/install-the-skill' },
      { text: 'Connect over MCP', page: 'guides/agents/connect-over-mcp' },
      { text: 'Search these docs over MCP', page: 'reference/server/docs-mcp' },
      { text: 'See how the hosted docs MCP is used', page: 'reference/server/docs-mcp-usage' },
      { text: 'Drive relate from an agent', page: 'guides/agents/drive-relate-from-an-agent' },
      { text: 'Keep an agent safe', page: 'guides/agents/agent-safety' },
      { text: 'Run relate in a sandbox', page: 'guides/agents/run-in-a-sandbox' },
      { text: 'Model agent memory as a graph', page: 'guides/agents/model-agent-memory' },
      { text: 'Turn questions into Cypher with an LLM', page: 'guides/agents/text-to-cypher' },
      { text: 'Keep a diffable memory in the repo', page: 'guides/agents/diffable-memory' },
      { text: 'Gate a CI job on a Cypher check', page: 'guides/agents/use-in-ci' },
      { text: 'Use relate from the Claude Agent SDK', page: 'guides/integrations/claude-agent-sdk' },
      { text: 'Give a LangGraph agent long-term memory', page: 'guides/integrations/langgraph' },
      { text: 'Back a Vercel AI SDK tool with relate, read-only', page: 'guides/integrations/vercel-ai-sdk' },
      { text: 'Give a PydanticAI agent graph tools', page: 'guides/integrations/pydantic-ai' },
      { text: 'Give an OpenAI Agents SDK agent a read-only Cypher tool', page: 'guides/integrations/openai-agents-sdk' },
      { text: 'Put relate behind a LlamaIndex retriever', page: 'guides/integrations/llamaindex' },
      { text: 'Give a LangChain agent a recall tool', page: 'guides/integrations/langchain' },
      { text: 'Share a store with a CrewAI crew', page: 'guides/integrations/crewai' },
      { text: 'Back a Mastra tool with relate, read-only', page: 'guides/integrations/mastra' },
      { text: 'See what agent mode changes in the CLI', page: 'reference/cli/agent-mode' },
      { text: 'Understand why relate is agent-native', page: 'concepts/agent-native' },
    ],
  },
  {
    id: 'Guides',
    tasks: [
      { text: 'Import a CSV', page: 'guides/cypher/import-csv' },
      { text: 'Pass values to a statement as parameters', page: 'guides/cypher/parameters' },
      { text: 'Load JSON from a URL or a file', page: 'guides/cypher/load-json-from-a-url' },
      { text: 'Search by vector similarity', page: 'guides/cypher/vector-search' },
      { text: 'Search by keyword, and fuse it with vector search', page: 'guides/cypher/full-text-and-hybrid-search' },
      { text: 'Query by location and distance', page: 'guides/cypher/geospatial' },
      { text: 'Create indexes and constraints', page: 'guides/cypher/indexes-and-constraints' },
      { text: 'Store and read an ontology (preview)', page: 'guides/cypher/ontology' },
      { text: 'Tune a query', page: 'guides/cypher/tune-a-query' },
      { text: 'Use the Python client', page: 'guides/embed/python' },
      { text: 'Use the Node.js client', page: 'guides/embed/node' },
      { text: 'Use relate from a web page', page: 'guides/embed/browser' },
      { text: 'Use the Rust crate', page: 'guides/embed/rust' },
      { text: 'Use the C ABI', page: 'guides/embed/c' },
      { text: 'Use the Java client', page: 'guides/embed/java' },
      { text: 'Use the Go client', page: 'guides/embed/go' },
      { text: 'Use the Swift package', page: 'guides/embed/swift' },
      { text: 'Serve a store over MCP', page: 'guides/serve/mcp' },
      { text: 'Serve a store over Bolt to Neo4j drivers and tools', page: 'guides/serve/bolt' },
      { text: 'Serve the HTTP Query API', page: 'guides/serve/http-query-api' },
      { text: 'Run relate serve in a container', page: 'guides/serve/docker' },
      { text: 'Set up authentication and TLS for relate serve', page: 'guides/serve/auth-and-tls' },
      { text: 'Size a store and its memory', page: 'guides/operate/sizing-and-memory' },
      { text: 'Share one store between two processes', page: 'guides/operate/two-processes-one-store' },
      { text: 'Recover from a crash', page: 'guides/operate/crash-and-recovery' },
      { text: 'Choose a durability mode', page: 'guides/operate/durability-modes' },
      { text: 'Upgrade a store', page: 'guides/operate/upgrade-a-store' },
      { text: 'Fix an error or an exit code', page: 'guides/operate/troubleshooting' },
      { text: 'Choose a store layout', page: 'guides/storage/choose-a-store-layout' },
      { text: 'Back up and restore a store', page: 'guides/storage/backup-and-restore' },
      { text: 'Open a store read-only and follow a writer', page: 'guides/storage/read-only-and-follow' },
      { text: 'Clone a store or convert its layout', page: 'guides/storage/clone-and-convert' },
      { text: 'Keep the schema as files', page: 'guides/storage/schema-as-files' },
      { text: 'Open a store as an Obsidian vault', page: 'guides/storage/obsidian-vault' },
      { text: 'Pull a subgraph from Neo4j', page: 'guides/neo4j/pull-from-neo4j' },
      { text: 'Push a subgraph to Neo4j', page: 'guides/neo4j/push-to-neo4j' },
      { text: 'Migrate from a vector store', page: 'guides/migrate/from-a-vector-store' },
      { text: 'Migrate from JSON files', page: 'guides/migrate/from-json-files' },
      { text: 'Migrate from Neo4j', page: 'guides/migrate/from-neo4j' },
      { text: 'Script the CLI', page: 'guides/cli/scripting' },
      { text: 'Choose an output format', page: 'guides/cli/output-formats' },
      { text: 'Use the interactive shell', page: 'guides/cli/interactive-shell' },
      { text: 'Write an extension', page: 'guides/extensions/write-an-extension' },
      { text: 'Install and run an extension', page: 'guides/extensions/install-and-run' },
      { text: 'Import a directory tree with fs-to-graph', page: 'guides/extensions/fs-to-graph' },
      { text: 'Import git history with git-to-graph', page: 'guides/extensions/git-to-graph' },
    ],
  },
  {
    id: 'Reference',
    tasks: [
      { text: 'Look up an error', page: 'reference/errors' },
      { text: 'Look up a CLI command', page: 'reference/cli' },
      { text: 'Look up relate query', page: 'reference/cli/query' },
      { text: 'Look up relate serve', page: 'reference/cli/serve' },
      { text: 'Look up relate clone', page: 'reference/cli/clone' },
      { text: 'Look up relate info', page: 'reference/cli/info' },
      { text: 'Look up relate pull', page: 'reference/cli/pull' },
      { text: 'Look up relate push', page: 'reference/cli/push' },
      { text: 'Look up relate skill', page: 'reference/cli/skill' },
      { text: 'Look up relate upgrade', page: 'reference/cli/upgrade' },
      { text: 'Look up relate telemetry', page: 'reference/cli/telemetry' },
      { text: 'Look up relate run', page: 'reference/cli/run' },
      { text: 'Look up relate extension', page: 'reference/cli/extension' },
      { text: 'Look up relate agent-context', page: 'reference/cli/agent-context' },
      { text: 'Look up a CLI flag or environment variable', page: 'reference/cli/flags' },
      { text: 'Look up every environment variable the CLI reads', page: 'reference/cli/environment-variables' },
      { text: 'Look up an output mode', page: 'reference/cli/output-modes' },
      { text: 'Look up a shell dot command', page: 'reference/cli/dot-commands' },
      { text: 'Look up an exit code and the error object', page: 'reference/cli/exit-codes-and-errors' },
      { text: 'Check what Cypher relate supports', page: 'reference/cypher/overview' },
      { text: 'See how relate Cypher differs from Neo4j', page: 'reference/cypher/differences-from-neo4j' },
      { text: 'Look up vector and full-text search syntax', page: 'reference/cypher/search' },
      { text: 'Look up a reading clause', page: 'reference/cypher/reading-clauses' },
      { text: 'Look up a writing clause', page: 'reference/cypher/writing-clauses' },
      { text: 'Look up how clauses compose: WITH, UNION, CALL and NEXT', page: 'reference/cypher/composing-clauses' },
      { text: 'Look up index, constraint and schema syntax', page: 'reference/cypher/schema-clauses' },
      { text: 'Look up pattern syntax', page: 'reference/cypher/patterns' },
      { text: 'Look up an expression or operator', page: 'reference/cypher/expressions' },
      { text: 'Look up a type and its values', page: 'reference/cypher/types-and-values' },
      { text: 'Look up a function', page: 'reference/cypher/functions' },
      { text: 'Look up a procedure', page: 'reference/cypher/procedures' },
      { text: 'Read a plan from EXPLAIN or PROFILE', page: 'reference/cypher/explain-and-profile' },
      { text: 'Look up a notification', page: 'reference/cypher/notifications' },
      { text: 'Pick a Cypher version', page: 'reference/cypher/cypher-versions' },
      { text: 'Compare the client APIs', page: 'reference/api' },
      { text: 'Look up the Python API', page: 'reference/api/python' },
      { text: 'Look up the Node.js API', page: 'reference/api/javascript' },
      { text: 'Look up the WebAssembly API', page: 'reference/api/wasm' },
      { text: 'Look up the Rust API', page: 'reference/api/rust' },
      { text: 'Look up the C ABI', page: 'reference/api/c' },
      { text: 'Look up the Java API', page: 'reference/api/java' },
      { text: 'Look up the Go API', page: 'reference/api/go' },
      { text: 'Look up the Swift API', page: 'reference/api/swift' },
      { text: 'Look up the Bolt server', page: 'reference/server/bolt' },
      { text: 'Look up the HTTP Query API', page: 'reference/server/http' },
      { text: 'Look up the MCP server', page: 'reference/server/mcp' },
      { text: 'Look up the storage formats', page: 'reference/storage/formats' },
      { text: 'Look up the WAL and checkpoint formats', page: 'reference/storage/wal-and-checkpoints' },
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
      { text: 'Understand namespaces', page: 'concepts/namespaces' },
      { text: 'Understand security and trust', page: 'concepts/security-and-trust' },
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
export const EVALUATE = ['concepts/where-relate-fits', 'concepts/problems-relate-solves', 'reference/performance', 'reference/limitations', 'reference/project'];

/** The llms.txt group of page `id`. */
export function llmsGroupOf(id: string): LlmsGroup {
  if (EVALUATE.includes(id)) return 'Evaluate';
  if (
    /^get-started\/agent-/.test(id) ||
    /^guides\/(agents|integrations)(\/|$)/.test(id) ||
    ['concepts/agent-native', 'reference/cli/agent-mode', 'reference/server/docs-mcp', 'reference/server/docs-mcp-usage'].includes(id)
  ) {
    return 'Agents';
  }
  if (id.startsWith('get-started')) return 'Get started';
  if (id.startsWith('guides')) return 'Guides';
  if (id.startsWith('reference')) return 'Reference';
  return 'Concepts';
}

/**
 * The task index in llms.txt's order, entry for entry (DOCS-PLAN.md §2: the
 * landing is grouped exactly as /docs/llms.txt is): Evaluate as EVALUATE
 * lists it, every other group in `order`, the page order llms.txt uses (the
 * sidebar's). A task whose page is not in `order` keeps its place after them.
 */
export function orderedTasks(order: readonly string[]): TaskGroup[] {
  const at = new Map(order.map((id, i) => [id, i]));
  const rank = (page: string, group: LlmsGroup) => {
    const i = group === 'Evaluate' ? EVALUATE.indexOf(page) : (at.get(page) ?? -1);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return TASKS.map((g) => ({ id: g.id, tasks: [...g.tasks].sort((a, b) => rank(a.page, g.id) - rank(b.page, g.id)) }));
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
  /** The page order llms.txt uses; the task index follows it (`orderedTasks`). */
  order?: readonly string[];
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
  for (const g of orderedTasks(ctx.order ?? [])) {
    lines.push(`## ${g.id}`, '', ...g.tasks.map((t) => `- ${link(t)}`), '');
  }
  lines.push('## Add relate to your AGENTS.md', '', '```markdown', ctx.agentsMd.trimEnd(), '```', '');
  return lines.join('\n');
}
