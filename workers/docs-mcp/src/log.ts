// One structured log line per request (ADR-0013 decision 4; DOCS-PLAN.md
// §3.8 "Evals and metrics"): the counts the docs team reads (calls per tool
// and per client, zero-result searches, explain_error misses, limits hit),
// and nothing else. Never the query text, a page asked for, an error
// message, an IP address or a full user-agent string.

export interface LogLine {
  path: string;
  /** HTTP method. */
  http: string;
  /** JSON-RPC methods in the body (initialize, tools/list, tools/call, …). */
  rpc?: string[];
  tool?: string;
  ua: string;
  status: number;
  ms: number;
  zero_results?: boolean;
  tool_error?: string;
  limited?: 'ip' | 'tool-cost';
  rpc_error?: number;
}

/** The client family from a User-Agent header, from a fixed list; anything else is "other". */
export function uaFamily(ua: string | null): string {
  if (!ua) return 'none';
  const s = ua.toLowerCase();
  const families: [RegExp, string][] = [
    [/claude-code|claude code/, 'claude-code'],
    [/claude/, 'claude'],
    [/anthropic/, 'anthropic'],
    [/cursor/, 'cursor'],
    [/codex/, 'codex'],
    [/openai|chatgpt/, 'openai'],
    [/windsurf|codeium/, 'windsurf'],
    [/gemini/, 'gemini'],
    [/cline/, 'cline'],
    [/opencode/, 'opencode'],
    [/copilot|vscode|visual studio code/, 'vscode'],
    [/zed/, 'zed'],
    [/mcp-remote/, 'mcp-remote'],
    [/inspector/, 'mcp-inspector'],
    [/curl/, 'curl'],
    [/python|httpx|aiohttp|requests/, 'python'],
    [/node|undici|axios/, 'node'],
    [/go-http-client/, 'go'],
    [/mozilla/, 'browser'],
  ];
  return families.find(([re]) => re.test(s))?.[1] ?? 'other';
}

export function log(line: LogLine): void {
  console.log(JSON.stringify({ evt: 'docs-mcp', ...line }));
}
