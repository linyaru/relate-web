// Host install deeplinks (DOCS-PLAN.md §3.4, ADR-0013): the link a host
// opens to add an MCP server, generated from the JSON the page shows beside
// the button, so the reader reviews exactly what the link carries. Used by
// the `:::deeplink` directive (constructs.ts) and its tests.
//
// The URL forms, each from the host's own documentation (checked 2026-11-07):
//   cursor  cursor://anysphere.cursor-deeplink/mcp/install?name=<name>&config=<base64>
//           `config` is the server's entry (`{"command": …, "args": […]}`, the
//           value under `mcpServers.<name>` in mcp.json), JSON.stringify'd and
//           base64-encoded (cursor.com/docs/context/mcp/install-links). The
//           base64 is percent-encoded here so `+`, `/` and `=` survive any
//           query parser; decoding the query restores it.
//   vscode  vscode:mcp/install?<URL-encoded JSON>
//           the JSON is the server's entry with its `name` added
//           (code.visualstudio.com/api/extension-guides/ai/mcp, page dated
//           2026-11-04). VS Code opens the server's details for review
//           before it installs anything.

export interface DeeplinkHost {
  /** The host's name. */
  label: string;
  /** The button's text. */
  button: string;
  /** Where the URL form comes from. */
  source: string;
}

export const DEEPLINK_HOSTS: Record<string, DeeplinkHost> = {
  cursor: { label: 'Cursor', button: 'Add to Cursor', source: 'https://cursor.com/docs/context/mcp/install-links' },
  vscode: { label: 'VS Code', button: 'Add to VS Code', source: 'https://code.visualstudio.com/api/extension-guides/ai/mcp' },
};

/** A server name a link may carry: what the hosts key their config by. */
export const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type ServerConfig = Record<string, unknown>;

/**
 * Why `config` cannot be a deeplink's payload, or [] when it can: it must be
 * a JSON object; a server that starts a command (`command`, `args`) must open
 * its store `--read-only` (ADR-0013: the button adds a read-only server, and
 * the page says beside it how to allow writes); a remote server (`url`)
 * opens no store. A link is public, so an entry carries no `env` or
 * `headers`: nothing that could hold a credential (ADR-0013).
 */
export function configProblems(config: unknown): string[] {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return ['the JSON is not an object (the server entry: `{"command": …, "args": […]}` or `{"url": …}`)'];
  const c = config as ServerConfig;
  if ('mcpServers' in c || 'servers' in c) return ['the JSON is the whole config file; a deeplink carries one server entry, the value under `mcpServers.<name>`'];
  if ('env' in c || 'headers' in c) return ['the entry carries `env` or `headers`; a deeplink is public, so it carries no credential or environment (ADR-0013)'];
  if (typeof c.command === 'string') {
    const args = Array.isArray(c.args) ? c.args : [];
    if (!args.includes('--read-only')) return ['the server opens its store writable; a deeplink adds a read-only server, so `args` needs "--read-only" (ADR-0013)'];
    return [];
  }
  if (typeof c.url === 'string') return [];
  return ['the entry has neither a `command` nor a `url`'];
}

/** The deeplink for `host` that adds `config` as the server `name`. */
export function deeplinkHref(host: string, name: string, config: ServerConfig): string {
  const json = JSON.stringify(config);
  switch (host) {
    case 'cursor':
      return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(Buffer.from(json, 'utf8').toString('base64'))}`;
    case 'vscode':
      return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, ...config }))}`;
    default:
      throw new Error(`no deeplink form for host \`${host}\` (known: ${Object.keys(DEEPLINK_HOSTS).join(', ')})`);
  }
}

/** What a deeplink carries, decoded: the server name and its entry (the inverse of deeplinkHref, for checks). */
export function decodeDeeplink(href: string): { host: string; name: string; config: ServerConfig } {
  if (href.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?')) {
    const q = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    return { host: 'cursor', name: q.get('name') ?? '', config: JSON.parse(Buffer.from(q.get('config') ?? '', 'base64').toString('utf8')) };
  }
  if (href.startsWith('vscode:mcp/install?')) {
    const { name, ...config } = JSON.parse(decodeURIComponent(href.slice('vscode:mcp/install?'.length))) as ServerConfig;
    return { host: 'vscode', name: String(name ?? ''), config };
  }
  throw new Error(`not a known deeplink: ${href}`);
}
