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

export interface Bundle {
  format: 1;
  kind: 'documentation';
  origin: string;
  verified: string;
  engine: { version: string; verified: string; date: string; commit: string | null; source_build: boolean };
  graph: { nodes: number; relationships: number; seed_bytes: number };
  pages: Record<string, PageEntry>;
  refs: Record<string, Ref>;
  errors: ErrorEntry[];
  notifications: NotificationEntry[];
  llms: string;
  skill: Record<string, string>;
  releases: { source: string; latest: string; releases: (ReleaseEntry & { notes?: string })[] };
  onboard: { text: string; source: string };
}
