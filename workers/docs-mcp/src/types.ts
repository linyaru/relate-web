// The shape of generated/docs.json, written by scripts/bundle.ts and read by
// the Worker. Types only.

import type { TwinIndex } from './sections.ts';

export interface PageEntry {
  /** The page id: its path under /docs/, no trailing slash. */
  id: string;
  title: string;
  description: string;
  type: string | null;
  section: string;
  status: string;
  surfaces: string[];
  verified: string;
  /** https://relatedb.ai/docs/<id>/ */
  url: string;
  /** https://relatedb.ai/docs/<id>.md */
  md_url: string;
  prerequisites: string[];
  related: string[];
  tokens: number | null;
  /** Whether the docs graph holds the page (generated pages are not Page nodes yet, ADR-0020). */
  in_graph: boolean;
  /** The markdown twin, byte for byte. */
  twin: string;
  index: TwinIndex;
}

export interface Ref {
  id: string;
  title: string;
  url: string | null;
  md_url: string | null;
  status: string;
}

export interface ErrorEntry {
  id: string;
  surface: string;
  code: string | null;
  kind: string | null;
  gql_status: string | null;
  neo4j_code: string | null;
  exit_code: number | null;
  jsonrpc_code: number | null;
  http_status: number | null;
  python_class: string | null;
  retryable: boolean | null;
  message: string | null;
  cause: string | null;
  remedy: string | null;
  note: string | null;
  /** https://relatedb.ai/docs/reference/errors/#<id> */
  url: string;
  /** Page ids: reference/errors, then every page that links to this entry. */
  pages: string[];
}

export interface NotificationEntry {
  id: string;
  gql_status: string;
  code: string;
  severity: string | null;
  category: string | null;
  title: string | null;
  url: string;
}

export interface ReleaseEntry {
  tag: string;
  published_at: string;
  prerelease: boolean;
  assets: string[];
}

/** One entry of /docs/capabilities.json (ADR-0026), as the Worker reads it. */
export interface CapabilityEntry {
  id: string;
  title: string;
  problem: string;
  capability: string;
  intents: string[];
  surfaces: string[];
  schema: { title: string; description: string; mermaid: string } | null;
  schema_url: string | null;
  verify: { ref: string; kind: string } | null;
  urls: { page: string; guides: string[]; recipes: string[]; reference: string[]; verify: string | null };
}

/** What passing a recipe means (src/lib/cookbook/recipe.ts verifiesSummary). */
export interface Verifies {
  summary: string;
  cells: number;
  recorded: number;
  text: string;
}

export interface ExampleCell {
  id: string;
  /** The heading the cell sits under. */
  title: string;
  /** The cell's Cypher, as the recipe runs it. */
  statement: string;
  setup: boolean;
  expect_error: boolean;
  /** The cell on the recipe page: https://relatedb.ai/cookbook/<slug>/#cell-<id> */
  url: string;
  playground: string;
  parameters_url: string | null;
  parameters_bytes: number | null;
  /** The parameters, inline when they are a parameter block (2 KiB or less); else null and parameters_url. */
  parameters: unknown;
  /** The recorded result block (```table or ```gram) as the recipe holds it. */
  result: { kind: string; text: string } | null;
}

export interface ExampleRecipe {
  slug: string;
  title: string;
  url: string;
  md_url: string;
  verifies: Verifies;
  cells: ExampleCell[];
}

/** One verified language sample's manifest (src/lib/docs/sample-manifests.ts), as served at its URL. */
export interface SampleEntry {
  /** relate-docs://sample/<page id>/<sample id> */
  uri: string;
  page: string;
  page_title: string;
  id: string;
  language: string;
  /** https://relatedb.ai/docs/<page>/samples/<id>.json */
  url: string;
  /** The manifest's bytes as the site serves them. */
  text: string;
}

/** One row of the Differences table of reference/cypher/differences-from-neo4j. */
export interface DialectRow {
  feature: string;
  neo4j: string;
  relate: string;
  write_instead: string;
  /** The messages relate returns for the habit (the row's code spans that are errors or notifications). */
  messages: string[];
  /** The page at the row's example cell when one records the error, else at #differences. */
  url: string;
}

export interface Bundle {
  format: 1;
  kind: 'documentation';
  origin: string;
  verified: string;
  engine: { version: string; verified: string; date: string; commit: string | null; source_build: boolean };
  /** seed_bytes: the replayed seed (no vectors); served_seed_bytes: /docs/graph.cypher; vectors: section vectors in generated/vectors.txt. */
  graph: { nodes: number; relationships: number; seed_bytes: number; served_seed_bytes: number; vectors: number };
  pages: Record<string, PageEntry>;
  refs: Record<string, Ref>;
  errors: ErrorEntry[];
  notifications: NotificationEntry[];
  llms: string;
  /** Every skill under /skills/<name>/: file path (SKILL.md, references/<file>.md) to text. */
  skills: Record<string, Record<string, string>>;
  releases: { source: string; latest: string; releases: (ReleaseEntry & { notes?: string })[] };
  onboard: { text: string; source: string };
  /** /docs/capabilities.json byte for byte, its URL and the page it is generated from. */
  capabilities: { text: string; source: string; page: string };
  examples: Record<string, ExampleRecipe>;
  /** /docs/samples.json byte for byte and its URL, and every sample manifest (ADR-0052). */
  samples: { index: { text: string; source: string }; manifests: SampleEntry[] };
  dialect: { page: string; url: string; md_url: string; rows: DialectRow[] };
  /** The fixed parts of the text-to-cypher prompt: the Differences table, verbatim, and its page. */
  textToCypher: { source: string; md_url: string; table: string };
}
