#!/usr/bin/env node
// Checks the docs (src/content/docs): the mechanical half of the style guide
// (STYLE.md §4.10) and the structural checks of DOCS-PLAN.md §8 (items 1, 3,
// 3a, 3d, 3f). Runs on Node directly, like scripts/cookbook.ts.
//
//   node scripts/docs.ts            source checks       (npm run docs:check)
//   node scripts/docs.ts --built    source checks, then the built-site
//                                   checks on dist/      (after npm run build)
//   node scripts/docs.ts --vocab    write the Vale vocabulary from the glossary
//   node scripts/docs.ts --lint     write the vocabulary, then run Vale on the
//                                   docs prose, the glossary bodies (their
//                                   frontmatter blanked) and STYLE.md
//                                   (npm run docs:lint)
//   node scripts/docs.ts --record   rewrite every page's results sidecar and
//                                   (DOCS_ONLY=<id>[,…] limits it to those pages)
//                                   static graph forms from a run of its cells
//                                   on public/wasm, then its interactive
//                                   elements' static forms; review the diff
//
// DIST=<dir> points the --built checks at a build other than ./dist.
//
// From the source (no build needed):
//   - frontmatter: the schema of DOCS-PLAN.md §5 on every page (planned ones
//     included); every non-planned page has a 60–160 character description;
//     `section`/`type` agree with the path; generated fields are not typed;
//     `verified` (from _data/engine.json) lags the engine by at most one minor
//   - links: internal links, `prerequisites` and `related` resolve across docs,
//     cookbook and playground, anchors included (docs anchors from the page's
//     headings, cells and generated tables; cookbook anchors in --built only).
//     A link to a docs page that has no file yet is a warning, not an error:
//     the page renders it as text until the page exists (src/lib/docs/links.ts)
//   - words (STYLE.md §4.4, §4.5, §4.9), in prose only, never in code: banned
//     words, the one-name-per-thing synonyms the glossary cannot express and
//     every glossary alias (the glossary is the banned-synonym list), the
//     product name, a "Note:" prefix, exclamation marks, self-reference words
//     ("above", "as mentioned"), link text ("here"), bare URLs
//   - headings: sentence case, no trailing punctuation, no `!`/`?`, no skipped
//     level, no H1 in the body (the title is the H1)
//   - fences: every block has a language; shell blocks have no `$` prompt; a
//     `run` fence is a Cypher cell or a verified sample (`python run`, `js run`,
//     `rust run`, `java run`, `go run`, `swift run`, `c run`)
//   - page shape: the required sections for the page's type (README.md)
//   - the twin round-trip (3a), rendered from the source exactly as the build
//     renders it (src/lib/docs/twin.ts): it parses, carries the frontmatter
//     fields with `verified` equal to _data/engine.json, holds every fenced
//     block the page has (a `json data=<name>` block over 2 KiB as one stub
//     whose size and SHA-256 are the block's, src/lib/docs/checks/data.ts),
//     each diagram's fence is followed by its description,
//     and the Terms section lists exactly the linked terms, in order of first
//     use, with their short definitions (the glossary's Twin check)
//   - trust (3d, ADR-0013): every bash/sh/json/toml/yaml block that mentions
//     `relate serve`, `mcp` or a host config also has `--read-only`, and so
//     does every `relate … --database` command in a markdown block; the
//     pasted install prompt pins the engine's version; no twin addresses the
//     reader in the imperative outside a fence (heuristic below); no twin
//     carries prompt-injection phrasing; results sidecars and data files were
//     recorded against the current engine
//   - cells (item 2, src/lib/docs/checks/cells.ts): every page's `cypher run`
//     cells run in page order on one in-memory database on public/wasm, each
//     as its info string says, and match the page's results sidecar entry for
//     entry; each recorded graph has a fresh, inert static form (light and
//     dark) and its first node expands in the graph view; public/wasm is the
//     engine _data/engine.json names. The example page is included
//   - samples (src/lib/docs/checks/samples.ts): every verified sample
//     (```python run, ```js run, ```rust run, ```java run, ```go run,
//     ```swift run, ```c run) has a recorded "text" entry in its page's sidecar, ids are unique
//     and clash with no cell, no stale entries; the outputs themselves are
//     replayed by scripts/docs-samples.ts (npm run docs:samples)
//   - CLI facts (src/lib/docs/checks/cli.ts): every recorded run in _data/ is
//     well formed; each quoted message is in its recorded output and agrees
//     with the recorded exit code and error object; the recorded agent-context
//     lists exactly cli.json's commands and flags; the recorded version names
//     _data/engine.json's; nothing is still disputed; `verify` only on bash
//     fences (npm run docs:cli-check replays them against a binary)
//   - diagrams (3f): every `mermaid` block has `accTitle` and a multi-line
//     `accDescr`, and a fresh light and dark rendering whose hash matches and
//     whose SVG is inert (src/lib/cookbook/diagrams.ts); stray renderings
//   - the glossary (DOCS-PLAN.md §4.11, src/lib/docs/checks/glossary.ts): ids,
//     the Short-definitions rule, `context`, `related` and `see` resolve,
//     aliases distinct; every term has a body (the full definition) that
//     renders, and its prose passes the word rules; every :term id on a page
//     resolves (Glossary links); a term no page links is reported (Unused
//     terms); a page that uses a term three or more times without linking it
//     gets one warning listing them (First use, while the page links fewer
//     than five terms); the Vale vocabulary is current
//   - generated pages (src/lib/docs/checks/generated.ts): each renders with a
//     well-formed twin that passes the imperative and injection checks; the
//     glossary covers every term; the changelog data is valid with
//     #since-<verified>; feedback.md names no address
//   - the skill (3b, src/lib/docs/checks/skill.ts): public/skills/relate/ is
//     upstream's bundle at the commit in _data/skill.json with the engine's
//     version stamped (skipped with a note when no upstream checkout is
//     present; RELATE_UPSTREAM, default ../relate), its description carries
//     the canonical phrase (a warning until upstream adopts it), its version
//     is the engine's, every relative link and cited URL resolves, the 0.2.0
//     and legacy skills indexes validate, /skill.md is complete, and
//     docs-artifacts.json.sig verifies when it exists
//   - the docs graph (item 3, src/lib/docs/checks/graph.ts): the seed script
//     replays on public/wasm; no orphan page; every cli.json command and flag
//     named on a reference page (a warning until the CLI reference exists);
//     no published page with a planned prerequisite; every :term id exists;
//     no page that is its own prerequisite; the search indexes exist (the
//     vector one filterable on `page`) and the seed sets as many section
//     vectors as the artifact has current ones.
//     Severities per rule: DOCS_GRAPH_SEVERITY=<rule>=<error|warning|off>,…
//   - the embeddings (3e, src/lib/docs/checks/embeddings.ts): every section has a
//     vector in _data/embeddings.json whose SHA-256 matches its text now, no
//     orphaned or malformed vector, the recipe's questions current, and the
//     `docs` block of the query-the-relate-docs recipe equal to the subset the
//     graph gives; DOCS_EMBEDDINGS_SEVERITY=warning|off lowers them locally
//   - the task skills (src/lib/docs/checks/skill.ts checkTaskSkills and
//     checkTaskSkillCypher): frontmatter, citations, prose, read-only opens,
//     the review record in _data/skill.json, every cypher fence on public/wasm;
//     the skills CLI install form names a skill
//   - the capability catalog (src/lib/docs/checks/capabilities.ts): every
//     _capabilities/ file well formed, its citations and verify run resolve,
//     the generated section of concepts/problems-relate-solves current
//   - surfaces.json is well formed (src/components/docs/matrix.ts validate)
//   - interactive elements (src/lib/docs/checks/elements.ts): each element's
//     files exist (build file, browser module, browser case file); every
//     directive passes its element's validate and has a current, non-empty
//     recorded static form; every cell word names a browser module
//
// From dist/ (--built, after `npm run build`):
//   - every published page has its HTML page and its `.md` twin; each built
//     twin parses, carries the frontmatter fields, and its `verified` equals
//     _data/engine.json; every code block the built HTML page offers to copy
//     appears as a fence in its twin (components included; a cell's
//     parameters over 2 KiB as a stub with their SHA-256); every data block
//     is built at /docs/<page>/data/<name>.json with exactly its bytes, and
//     every stub in a built twin names that file's size and SHA-256
//   - anchors on links into docs and cookbook pages resolve against the ids
//     in the built HTML; the playground is built
//   - every link in /docs/llms.txt resolves to a built file; the landing twin
//     passes the imperative and injection checks
//   - every generated page has its HTML and both twins, appears in llms.txt
//     and the sitemap, and the changelog feed parses
//   - the built skills indexes' digests and docs-artifacts.json's hashes match
//     the served bytes; the legacy files equal /skills/relate/; security.txt,
//     when built, has Contact and an unexpired Expires
//   - the script budget (src/lib/docs/checks/budget.ts): every built docs page
//     runs under 60 KB of JavaScript before its lazy chunks; the three largest
//     are printed
//
// The imperative heuristic (trust check, ADR-0013): in a twin, outside fenced
// blocks, headings and tables, a sentence of three or more words whose first
// word is one of IMPERATIVE_VERBS ("Run", "Install", "Copy", "Use", "Read",
// …) or that starts with "Do not"/"Don't" is flagged, unless the page's type
// is `tutorial` or `how-to` (whose steps are imperative by design). Only a
// sentence counts: it ends with ".", "!", "?" or ":", so an unpunctuated label
// (a landing card such as "Install relate") does not; nor does a sentence
// that opens with a link (a card or a "See also" item).
// Headings are skipped because STYLE.md §4.5 phrases them as intents
// ("Import a CSV"); tables because an errors table's remedy column is
// imperative by nature. The injection patterns apply to every page type.
//
// Suppressing a finding: an MDX comment on its own line names the rules it
// lifts for the next block, `{/* docs-check-ignore synonym heading-case */}`.
// It works for the source checks (words, headings, fences, trust fences),
// not for the twin and built checks.
//
// Exits 1 when there is any error, printing every finding by file and line.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path';
import { parseArgs } from 'node:util';

import GithubSlugger from 'github-slugger';
import type { Code, Heading, Link, Parent, Root, RootContent } from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { parse as parseYaml } from 'yaml';

import { COMPONENT_ANCHORS, COMPONENT_TWINS } from '../src/components/docs/registry.ts';
import {
  DOCS_RENDER_COMMAND,
  diagramDescription,
  diagramProblems,
  isDiagramFileOf,
  mermaidBlocks,
  readRendered,
} from '../src/lib/cookbook/diagrams.ts';
import { COOKBOOK_DIR, loadRecipes } from '../src/lib/cookbook/load.ts';
import { CANONICAL_ORIGIN } from '../src/lib/cookbook/links.ts';
import { type ComponentProps } from '../src/lib/docs/constructs.ts';
import {
  DOCS_DIR,
  engine as readEngine,
  ENGINE_FILE,
  GLOSSARY_DIR,
  glossary as readGlossary,
  lastUpdated,
  pageFiles,
  ROOT,
  splitFrontmatter,
  type Engine,
  type PageFile,
} from '../src/lib/docs/content.ts';
import { allowedScheme, docsIdOf } from '../src/lib/docs/links.ts';
import { CANONICAL_PHRASE } from '../src/lib/docs/llms.ts';
import {
  DOC_TYPES,
  GENERATED_FIELDS,
  GENERATED_IDS,
  pageUrl,
  SECTION_IDS,
  sectionOf,
  STATUSES,
  SURFACES,
  twinUrl,
  typeOf,
  type DocType,
} from '../src/lib/docs/model.ts';
import { aliasRules, readGlossary as readGlossaryEntries } from '../src/lib/docs/glossary.ts';
import { parsePage } from '../src/lib/docs/parse.ts';
import { collectCells, parseDataInfo, parseRunInfo, readResults } from '../src/lib/docs/results.ts';
import { renderTwin, type PageData } from '../src/lib/docs/twin.ts';
import { checkCells, recordCells } from '../src/lib/docs/checks/cells.ts';
import { checkElements, recordElements } from '../src/lib/docs/checks/elements.ts';
import { kb, measurePages, PAGE_JS_BUDGET } from '../src/lib/docs/checks/budget.ts';
import { elementFileId } from '../src/lib/docs/elements.ts';
import { cliCheck } from '../src/lib/docs/checks/cli.ts';
import { checkEmbeddings } from '../src/lib/docs/checks/embeddings.ts';
import { checkGenerated } from '../src/lib/docs/checks/generated.ts';
import { blankFrontmatter, bodyFences, checkFirstUse, checkGlossaryFiles, checkGlossaryLinks, checkUnusedTerms, linkedTerms, twinTermsProblems } from '../src/lib/docs/checks/glossary.ts';
import { checkGraph } from '../src/lib/docs/checks/graph.ts';
import { checkSampleManifests } from '../src/lib/docs/checks/sample-manifests.ts';
import { builtDataProblems, twinDataProblems, twinStubs } from '../src/lib/docs/checks/data.ts';
import { sha256Hex } from '../src/lib/docs/data-blocks.ts';
import { checkSamples } from '../src/lib/docs/checks/samples.ts';
import { checkSkill, checkTaskSkillCypher } from '../src/lib/docs/checks/skill.ts';
import { IMPERATIVE_VERBS, INJECTION } from '../src/lib/docs/skill.ts';
import { SURFACES_FILE, validate as validateSurfaces, type SurfacesData } from '../src/components/docs/matrix.ts';
import { feedbackMarkdown, GENERATED, generatedContext } from '../src/lib/docs/generated/index.ts';
import { resultGraphCell } from '../src/lib/docs/results.ts';
import { clientEnv, parseSampleInfo } from '../src/lib/docs/samples.ts';

// ---------------------------------------------------------------------------
// Findings

type Severity = 'error' | 'warning';

interface Finding {
  file: string;
  line: number | null;
  severity: Severity;
  rule: string;
  message: string;
}

const findings: Finding[] = [];
const rel = (file: string) => relative(ROOT, file).split(sep).join('/');

function report(file: string, line: number | null, severity: Severity, rule: string, message: string) {
  findings.push({ file: rel(file), line, severity, rule, message: message.replaceAll(`${ROOT}${sep}`, '') });
}

// ---------------------------------------------------------------------------
// Rules: words (STYLE.md §4.4, §4.5, §4.9)

interface WordRule {
  re: RegExp;
  rule: string;
  severity: Severity;
  message: (match: string) => string;
}

const banned = (re: RegExp, advice: string): WordRule => ({
  re,
  rule: 'banned-word',
  severity: 'error',
  message: (m) => `"${m}": ${advice} (STYLE.md §4.4)`,
});

/** STYLE.md §4.4 "Banned words and phrases". */
const BANNED_WORDS: WordRule[] = [
  banned(/\bsimply\b/gi, 'cut it'),
  banned(/\bjust (?:run|use|add|type|call|pass|set|install|copy|paste|open|works?|do|need|change|edit|point|import|create|write|follow)\b/gi, 'cut "just"'),
  banned(/\beas(?:y|ily)\b/gi, 'cut it, or say what makes it short'),
  banned(/\bquick(?:ly)?\b(?![ -]?start)/gi, 'cut it, or give the time'),
  banned(/\bobviously\b|\bof course\b/gi, 'cut it'),
  banned(/\bplease\b/gi, 'cut it'),
  banned(/\bnote that\b|\bit'?s worth noting\b/gi, 'state the fact, or use a callout'),
  banned(/\bin order to\b/gi, 'say "to"'),
  banned(/\butili[sz](?:e|es|ed|ing|ation)\b/gi, 'say "use"'),
  banned(/\bleverag(?:e|es|ed|ing)\b/gi, 'say "use"'),
  banned(/\brobust\b|\bpowerful\b|\bseamless(?:ly)?\b|\bblazing\b|\brevolutionary\b|\bfastest\b/gi, 'say what it does instead'),
  banned(/\bbest-in-class\b|\bworld-class\b|\bcutting-edge\b|\bstate-of-the-art\b/gi, 'say what it does instead'),
  banned(/\bwe'?re excited\b|\blet'?s dive in\b|\bunlock(?:s|ed|ing)?\b|\bsupercharg(?:e|es|ed|ing)\b/gi, 'cut it'),
  banned(/\be\.g\.|\bi\.e\.|\betc\./gi, 'say "for example", "that is", or finish the list'),
  banned(/\band more\b/gi, 'finish the list or cut it'),
  {
    re: /\bfull\b(?!-text)/gi,
    rule: 'full-reserved',
    severity: 'warning',
    message: () => '"full" is reserved for what is 100% true (MAINTAINING.md); keep it only if it is',
  },
];

/**
 * STYLE.md §4.4 "One name per thing": the glossary is the source (each term's
 * `aliases`, glossary.ts aliasRules, added at run time). This list keeps only
 * what a glossary alias cannot say: a preferred word that is not a term
 * (agent, Neo4j, WebAssembly), two preferred terms for one word (plugin), or
 * a pattern with an exception ("edge case", "bind a parameter").
 */
const SYNONYMS: { phrase: RegExp; say: string; label: string }[] = [
  { phrase: /\bedges?\b(?! case)/gi, say: 'relationship', label: 'edge' },
  // The noun only: "bind a parameter" and "without binding it" are fine.
  { phrase: /\b(?:a|the|python|node(?:\.js)?|go|rust|java|swift|c|language|native|wasm)\s+bindings?\b|\bbindings\b/gi, say: 'client (a language package) or surface (a front door)', label: 'binding' },
  { phrase: /\bplug-?ins?\b/gi, say: 'skill, or extension for a `relate run` package', label: 'plugin' },
  { phrase: /\bbots?\b/gi, say: 'agent', label: 'bot' },
  { phrase: /\bneo4j\b/g, say: 'Neo4j', label: 'neo4j' },
  { phrase: /\bWasm\b/g, say: 'WebAssembly, then WASM', label: 'Wasm' },
];

const PRODUCT_NAME: WordRule = {
  re: /\bRelate ?DB\b|\bthe relate database\b|(?<!\bNeo4j Desktop )\bRelate\b/g,
  rule: 'product-name',
  severity: 'error',
  message: (m) => `"${m}": the name is "relate", lowercase, even at the start of a sentence (STYLE.md §4.4)`,
};

const SELF_REFERENCE =
  /\b(?:see|shown|listed|described|explained|mentioned|noted|defined|given)\s+(?:above|below|earlier)\b|\bas (?:mentioned|noted|shown|described)\b|\b(?:the|in the)\s+(?:above|below)\b|\b(?:table|example|section|step|list|command|code|output|diagram|figure|snippet|block)s?\s+(?:above|below)\b|\bearlier (?:section|step|example)s?\b/gi;

const LINK_TEXT_BANNED = new Set(['here', 'click here', 'this link', 'this page', 'link', 'more', 'read more']);

// ---------------------------------------------------------------------------
// Rules: headings

/**
 * Capitalized words a sentence-case heading may hold after its first word.
 * All-caps words (CLI, JSON, WAL) and camel-case names (openCypher, macOS,
 * GitHub) are always allowed, so only Titlecase words need to be listed here.
 */
const PROPER_NOUNS = new Set([
  'Cypher', 'Python', 'Rust', 'Java', 'Go', 'Swift', 'Bolt', 'Docker', 'Linux', 'Windows', 'Mac', 'Unix',
  'Ubuntu', 'Debian', 'Alpine', 'Homebrew', 'Maven', 'Gradle', 'Neo4j', 'Node', 'Claude', 'Codex',
  'Cursor', 'Gemini', 'Copilot', 'Windsurf', 'Cline', 'Vercel', 'Cloudflare', 'Obsidian', 'Markdown',
  'Kuzu', 'Jupyter', 'Pydantic', 'Ollama', 'Mastra', 'Anthropic', 'Mermaid', 'Pagefind', 'Apple', 'Intel', 'English',
  'Spring', 'Kafka', 'Spark', 'Snowflake', 'Postgres', 'Aura',
]);

/** Multi-word names whose later words are capitalized (STYLE.md §4.4 names "HTTP Query API"). */
const PROPER_PHRASES = [
  'HTTP Query API', 'Claude Code', 'Claude Agent SDK', 'Claude Desktop', 'Vercel AI SDK', 'OpenAI Agents SDK', 'Vercel Sandbox', 'Gemini CLI',
  'Neo4j Desktop', 'Neo4j Browser', 'GitHub Actions', 'Cloudflare Pages', 'Cloudflare Workers', 'Web Analytics',
];

// ---------------------------------------------------------------------------
// Rules: trust (ADR-0013)

/** Languages of the blocks an agent copies into a shell or a host config. */
const CONFIG_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'json', 'jsonc', 'json5', 'toml', 'yaml', 'yml']);
const NEEDS_READ_ONLY = /relate\s+serve|\bmcp\b|mcpServers|mcp_servers|context_servers/i;
/** Languages a pasted prompt is written in. */
const PROMPT_LANGS = new Set(['text', 'markdown', 'md', 'prompt', 'txt']);
const INSTALLS = /install\.sh|pip install|npm (?:install|i)\b|npx |brew install|relate skill install|cargo install|go install/i;
const SEMVER = /\b\d+\.\d+\.\d+\b/g;

// IMPERATIVE_VERBS (sentence-initial verbs that make a twin sentence an
// instruction) and INJECTION come from src/lib/docs/skill.ts, one copy of the
// trust patterns for the pages, the task skills and the capability catalog.
const INSTRUCTIVE_TYPES = new Set<DocType>(['tutorial', 'how-to']);

// ---------------------------------------------------------------------------
// Rules: page shapes (src/content/docs/README.md "Sections")

const REQUIRED_SECTIONS: Record<DocType, string[]> = {
  tutorial: ['Prerequisites', 'What you built', 'Next'],
  'how-to': ['Prerequisites', 'Verify', 'If it goes wrong', 'Related'],
  reference: ['Synopsis', 'See also'],
  explanation: ['Where this shows up'],
};

/** Every key a page's frontmatter may hold (src/content.config.ts). */
const FRONTMATTER_KEYS = new Set([
  'title', 'label', 'description', 'section', 'type', 'order', 'surfaces', 'status', 'since', 'prerequisites', 'related',
]);
/** The most glossary terms a page links, so its twin's Terms section stays short (DOCS-PLAN.md §3.1). */
const MAX_TERMS = 5;
const TWIN_KEYS = ['title', 'description', 'surfaces', 'status', 'verified', 'canonical_url', 'prerequisites', 'related', 'last_updated'];

// ---------------------------------------------------------------------------
// The site as the checks see it

const plainParser = unified().use(remarkParse).use(remarkGfm).freeze();
const parseMarkdown = (text: string): Root => plainParser.parse(text);

interface Site {
  engine: Engine;
  pages: PageFile[];
  published: Map<string, PageFile>;
  planned: Set<string>;
  glossary: ReturnType<typeof readGlossary>;
  /** Recipe slug → its cell ids. */
  recipes: Map<string, Set<string>>;
  /** Docs page id → the anchors its source gives it. */
  anchors: Map<string, Set<string>>;
  /** Built HTML ids per site path (`/docs/x/`, `/cookbook/y/`), with --built. */
  builtIds: Map<string, Set<string>> | null;
  /** The ids of glossary terms some page links with `:term`. */
  termsUsed: Set<string>;
  /** The build the --built checks read: DIST, else ./dist. Every check that reads dist/ takes it from here. */
  dist: string;
}

/** The anchors a page's HTML will carry, from its source: heading slugs, cell ids, generated tables. */
function sourceAnchors(tree: Root, source: string): Set<string> {
  const out = new Set<string>();
  const slugger = new GithubSlugger();
  let cell = 0;
  visitAll(tree, (node) => {
    if (node.type === 'heading') out.add(slugger.slug(toString(node)));
    if (node.type === 'code') {
      try {
        const run = parseRunInfo(node.lang, node.meta);
        if (run) {
          cell++;
          const cid = run.name ?? `cell-${cell}`;
          out.add(cid.startsWith('cell-') ? cid : `cell-${cid}`);
          out.add(`out-${cid}`);
        }
      } catch {
        // Reported by the fence checks.
      }
    }
  });
  for (const [name, anchors] of Object.entries(COMPONENT_ANCHORS)) if (new RegExp(`<${name}\\b`).test(source)) anchors().forEach((a) => out.add(a));
  return out;
}

function visitAll(node: Root | RootContent, fn: (node: RootContent) => void) {
  if (node.type !== 'root') fn(node);
  if ('children' in node) for (const child of (node as Parent).children) visitAll(child as RootContent, fn);
}

/** Lines the frontmatter block takes, so body positions map to file lines. */
function frontmatterLines(text: string): number {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? m[0].split('\n').length - 1 : 0;
}

// ---------------------------------------------------------------------------
// Links

type LinkVerdict = { ok: true } | { ok: false; severity: Severity; message: string };

/**
 * Whether a site-relative href (`/docs/x#y`, `/cookbook/z/`, `/playground/#recipe=…`)
 * resolves. `from` is the page the link sits on, for same-page anchors.
 */
function checkHref(href: string, site: Site, from: string | null): LinkVerdict {
  if (href.startsWith('#')) {
    if (from === null) return { ok: true };
    return anchorVerdict(`/docs/${from}`, from, href.slice(1), site);
  }
  if (href.startsWith('//')) return { ok: false, severity: 'error', message: `protocol-relative link ${href}; write https://` };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    if (!allowedScheme(href)) {
      return { ok: false, severity: 'error', message: `${href.slice(0, 40)}: a docs link is http:, https: or mailto: (it would render as text)` };
    }
    if (href.startsWith(`${CANONICAL_ORIGIN}/`)) {
      return { ok: false, severity: 'error', message: `${href} links the site by its origin; write it site-relative (${href.slice(CANONICAL_ORIGIN.length)})` };
    }
    return { ok: true }; // external: lychee checks these on a schedule (DOCS-PLAN.md §8)
  }
  if (!href.startsWith('/')) {
    return { ok: false, severity: 'error', message: `relative link "${href}"; write it site-relative (/docs/…, /cookbook/…)` };
  }
  const docsId = docsIdOf(href);
  if (docsId !== null) {
    if (/\.(txt|json|svg|png|md)$/.test(href.split(/[?#]/)[0])) return assetVerdict(href);
    if (docsId === '') return { ok: true };
    if (site.published.has(docsId) || GENERATED_IDS.has(docsId)) {
      const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
      return hash ? anchorVerdict(`/docs/${docsId}`, docsId, hash, site) : { ok: true };
    }
    if (site.planned.has(docsId)) return { ok: true }; // renders as text until the page is written
    return {
      ok: false,
      severity: 'warning',
      message: `${href} names no page yet; it renders as text until src/content/docs/${docsId}.mdx exists (add it with \`status: planned\` to declare it)`,
    };
  }
  const recipe = /^\/cookbook\/([^/#?]+)\/?(?:#(.*))?$/.exec(href);
  if (recipe) {
    if (!site.recipes.has(recipe[1])) return { ok: false, severity: 'error', message: `${href}: there is no recipe src/content/cookbook/${recipe[1]}.md` };
    if (recipe[2] && site.builtIds) return builtAnchorVerdict(`/cookbook/${recipe[1]}/`, recipe[2], site);
    return { ok: true };
  }
  if (/^\/cookbook\/?(?:#.*)?$/.test(href)) return { ok: true };
  const play = /^\/playground\/?(?:#(.*))?$/.exec(href);
  if (play) {
    const params = new URLSearchParams(play[1] ?? '');
    const slug = params.get('recipe');
    if (slug && !site.recipes.has(slug)) return { ok: false, severity: 'error', message: `${href}: the playground has no recipe "${slug}"` };
    const cell = params.get('cell');
    if (slug && cell && !site.recipes.get(slug)!.has(cell)) {
      return { ok: false, severity: 'error', message: `${href}: recipe "${slug}" has no cell "${cell}"` };
    }
    return { ok: true };
  }
  return assetVerdict(href);
}

/** A site-relative link to a file: it must be in public/ (or, with --built, in dist/). */
function assetVerdict(href: string): LinkVerdict {
  const path = decodeURIComponent(href.split(/[?#]/)[0]);
  const candidates = [join(ROOT, 'public', path), join(ROOT, 'public', path, 'index.html')];
  if (args.built) candidates.push(join(DIST, path), join(DIST, path, 'index.html'));
  if (candidates.some((c) => existsSync(c))) return { ok: true };
  // Generated endpoints (twins, llms.txt) exist only after a build.
  if (!args.built && /^\/(?:docs|cookbook)\/.*\.(?:md|txt|json)$|^\/(?:llms\.txt|sitemap\.xml)$/.test(path)) return { ok: true };
  return { ok: false, severity: 'error', message: `${href} is not a page or a file of the site` };
}

function anchorVerdict(path: string, id: string, hash: string, site: Site): LinkVerdict {
  if (site.builtIds) return builtAnchorVerdict(pageUrl(id), hash, site);
  const anchors = site.anchors.get(id);
  if (!anchors || anchors.has(decodeURIComponent(hash))) return { ok: true };
  return { ok: false, severity: 'error', message: `${path}#${hash}: the page has no such heading or anchor` };
}

function builtAnchorVerdict(url: string, hash: string, site: Site): LinkVerdict {
  const ids = site.builtIds!.get(url);
  if (!ids) return { ok: false, severity: 'error', message: `${url} is not in dist/; run \`npm run build\` first` };
  if (ids.has(decodeURIComponent(hash))) return { ok: true };
  return { ok: false, severity: 'error', message: `${url}#${hash}: the built page has no element with that id` };
}

/** A page id reference from frontmatter (`get-started/install`, `reference/x#y`, `cookbook/<slug>`). */
function checkPageRef(ref: string, site: Site): LinkVerdict {
  if (/^(?:https?:)?\/\//.test(ref) || ref.startsWith('/')) {
    return { ok: false, severity: 'error', message: `"${ref}" is a URL; write a page id (get-started/install) or cookbook/<slug>` };
  }
  if (ref.startsWith('cookbook/')) return checkHref(`/${ref.replace(/^(cookbook\/[^#]+?)\/?(#|$)/, '$1/$2')}`, site, null);
  return checkHref(`/docs/${ref}`, site, null);
}

// ---------------------------------------------------------------------------
// Frontmatter (DOCS-PLAN.md §5, src/content.config.ts)

function checkFrontmatter(page: PageFile, site: Site) {
  const { id, file, data } = page;
  const err = (msg: string) => report(file, 1, 'error', 'frontmatter', msg);
  const planned = data.status === 'planned';
  for (const key of Object.keys(data)) {
    if ((GENERATED_FIELDS as readonly string[]).includes(key)) err(`\`${key}\` is generated by the build; remove it`);
    else if (!FRONTMATTER_KEYS.has(key)) err(`unknown key \`${key}\` (allowed: ${[...FRONTMATTER_KEYS].join(', ')})`);
  }
  if (typeof data.title !== 'string' || !data.title.trim()) err('`title` is required');
  if (typeof data.label !== 'undefined' && (typeof data.label !== 'string' || !data.label.trim())) err('`label` is an empty string');
  if (data.description === undefined) {
    if (!planned) err('`description` is required (one sentence, 60 to 160 characters)');
  } else if (typeof data.description !== 'string') {
    err('`description` is not a string');
  } else {
    const n = data.description.trim().length;
    if (n < 60 || n > 160) err(`\`description\` is ${n} characters; write one sentence of 60 to 160`);
    if (/\n/.test(data.description.trim())) err('`description` spans lines; write one sentence');
    if (!/[.]$/.test(data.description.trim())) err('`description` is a sentence; end it with a period');
  }
  const section = sectionOf(id);
  if (!section && !id.startsWith('_example/')) err('a docs page lives under get-started/, guides/, reference/ or concepts/');
  if (data.section !== undefined && (!(SECTION_IDS as string[]).includes(String(data.section)) || data.section !== section)) {
    err(`\`section: ${String(data.section)}\` disagrees with its path (${section ?? 'none'})`);
  }
  if (data.type !== undefined && (!(DOC_TYPES as string[]).includes(String(data.type)) || data.type !== typeOf(id))) {
    err(`\`type: ${String(data.type)}\` disagrees with its section (${typeOf(id) ?? 'none'})`);
  }
  if (data.order !== undefined && !Number.isInteger(data.order)) err('`order` is an integer');
  if (data.status !== undefined && !(STATUSES as readonly string[]).includes(String(data.status))) {
    err(`\`status: ${String(data.status)}\` is not one of ${STATUSES.join(', ')}`);
  }
  if (data.since !== undefined && !/^\d+\.\d+(\.\d+)?$/.test(String(data.since))) err(`\`since: ${String(data.since)}\` is not a version like 0.17 or 0.17.0`);
  for (const key of ['surfaces', 'prerequisites', 'related'] as const) {
    const v = data[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      err(`\`${key}\` is a list of strings`);
      continue;
    }
    if (key === 'surfaces') {
      for (const s of v) if (!(SURFACES as readonly string[]).includes(s)) err(`surface \`${s}\` is not one of ${SURFACES.join(', ')}`);
    } else if (!planned) {
      for (const ref of v as string[]) {
        const verdict = checkPageRef(ref, site);
        if (!verdict.ok) report(file, 1, verdict.severity, verdict.severity === 'error' ? 'link' : 'link-pending', `${key}: ${verdict.message}`);
      }
    }
  }
  if (typeof data.title === 'string') headingCase(data.title, file, 1, 'the title', new Set());
}

// ---------------------------------------------------------------------------
// Prose, headings, fences, links (source)

interface Prose {
  text: string;
  line: number;
  ignore: Set<string>;
}

/** The prose of a block: text with inline code as a placeholder, nothing from JSX, HTML or expressions. */
function proseOf(node: RootContent): string {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'inlineCode':
      return 'CODE';
    case 'break':
      return ' ';
    case 'html':
    case 'code':
    case 'image':
    case 'imageReference':
    case 'mdxTextExpression':
    case 'mdxFlowExpression':
    case 'mdxjsEsm':
      return '';
    default:
      return 'children' in node ? (node as Parent).children.map((c) => proseOf(c as RootContent)).join('') : '';
  }
}

const IGNORE_COMMENT = /^\s*\/\*\s*docs-check-ignore\s+([\s\S]*?)\*\/\s*$/;

function checkSource(page: PageFile, text: string, site: Site) {
  const { id, file } = page;
  const offset = frontmatterLines(text);
  const { body } = splitFrontmatter(text, rel(file));
  const tree = parsePage(body);
  const type = typeOf(id);
  const lineOf = (node: { position?: { start: { line: number } } }) => (node.position?.start.line ?? 1) + offset;
  const blocks: Prose[] = [];
  const paragraphs: Prose[] = [];
  /** Paragraphs and table cells, for the glossary's First-use count. */
  const termProse: string[] = [];
  let lastDepth = 1;
  const headings: string[] = [];

  const visit = (parent: Parent, inherited: Set<string>) => {
    let pending = new Set<string>();
    for (const raw of parent.children) {
      const node = raw as RootContent;
      if (node.type === 'mdxFlowExpression') {
        const m = IGNORE_COMMENT.exec(node.value);
        if (m) pending = new Set(m[1].split(/[\s,]+/).filter(Boolean));
        continue;
      }
      const ignore = pending.size ? new Set([...inherited, ...pending]) : inherited;
      pending = new Set();
      const line = lineOf(node);
      switch (node.type) {
        case 'heading': {
          const words = proseOf(node).trim();
          headings.push(words);
          checkHeading(node, words, file, line, ignore, lastDepth);
          lastDepth = node.depth;
          blocks.push({ text: words, line, ignore });
          break;
        }
        case 'paragraph': {
          const p = { text: proseOf(node), line, ignore };
          blocks.push(p);
          paragraphs.push(p);
          if (!ignore.has('glossary-first-use')) termProse.push(p.text);
          if (/^\s*Note:/.test(p.text) && !ignore.has('note-prefix')) {
            report(file, line, 'error', 'note-prefix', 'a "Note:" prefix in body text; use a `:::note` callout (STYLE.md §4.4)');
          }
          checkLinks(node, file, line, ignore, site, id);
          break;
        }
        case 'tableCell':
          blocks.push({ text: proseOf(node), line, ignore });
          if (!ignore.has('glossary-first-use')) termProse.push(proseOf(node));
          checkLinks(node, file, line, ignore, site, id);
          break;
        case 'code':
          checkFence(node, file, line, ignore, site);
          break;
        case 'mdxJsxFlowElement':
          if (node.name && /^[A-Z]/.test(node.name)) checkComponent(node.name, componentProps(node), file, line, ignore, site);
          else visit(node, ignore);
          break;
        case 'html':
        case 'mdxjsEsm':
          break;
        default:
          if ('children' in node) visit(node as Parent, ignore);
      }
    }
  };
  visit(tree, new Set());

  for (const block of blocks) checkWords(block, file);
  // The glossary (DOCS-PLAN.md §4.11): every :term id resolves; a term used often but never linked is reported.
  checkGlossaryLinks(file, body, offset, new Set(site.glossary.keys()), report);
  if (!id.startsWith('_example/')) checkFirstUse(file, termProse, new Set(linkedTerms(body).map((t) => t.id)), MAX_TERMS, report);
  checkExclamations(paragraphs, blocks, file, type);
  if (type) checkShape(type, headings, paragraphs, tree, file);
  site.anchors.set(id, sourceAnchors(tree, body));
}

function checkWords(block: Prose, file: string) {
  const { text, line, ignore } = block;
  const hit = (rule: string, severity: Severity, message: string) => {
    if (!ignore.has(rule)) report(file, line, severity, rule, message);
  };
  for (const r of [...BANNED_WORDS, PRODUCT_NAME]) {
    for (const m of text.matchAll(r.re)) hit(r.rule, r.severity, r.message(m[0]));
  }
  for (const s of synonymRules()) {
    for (const m of text.matchAll(s.phrase)) hit('synonym', 'error', `"${m[0]}": say ${s.say} (${s.source})`);
  }
  for (const m of text.matchAll(SELF_REFERENCE)) {
    hit('self-reference', 'error', `"${m[0]}": name what you mean or link to it (STYLE.md §4.5)`);
  }
}

let synonymCache: { phrase: RegExp; say: string; source: string }[] | null = null;
function synonymRules() {
  if (synonymCache) return synonymCache;
  const out = SYNONYMS.map((s) => ({ phrase: s.phrase, say: `"${s.say}"`, source: 'STYLE.md §4.4', label: s.label.toLowerCase() }));
  // The glossary's aliases (DOCS-PLAN.md §4.11): each flagged with its preferred term.
  for (const a of aliasRules(readGlossaryEntries())) {
    if (out.some((o) => o.label === a.alias.toLowerCase())) continue;
    out.push({ phrase: a.phrase, say: `"${a.term}"`, source: `glossary: ${a.id}`, label: a.alias.toLowerCase() });
  }
  synonymCache = out;
  return out;
}

function checkExclamations(paragraphs: Prose[], blocks: Prose[], file: string, type: DocType | null) {
  const bang = /[\w)'"”`]!(?=\s|$)/g;
  const hits = blocks.flatMap((b) => [...b.text.matchAll(bang)].map(() => b)).filter((b) => !b.ignore.has('exclamation'));
  if (!hits.length) return;
  if (type !== 'tutorial') {
    for (const b of hits) report(file, b.line, 'error', 'exclamation', 'an exclamation mark outside Get started (STYLE.md §4.4)');
    return;
  }
  const last = paragraphs[paragraphs.length - 1];
  hits.forEach((b, i) => {
    if (i > 0) report(file, b.line, 'error', 'exclamation', 'a tutorial gets one exclamation mark at most (STYLE.md §4.4)');
    else if (b !== last) report(file, b.line, 'error', 'exclamation', "a tutorial's one exclamation mark goes in its last paragraph (STYLE.md §4.4)");
  });
}

function checkHeading(node: Heading, words: string, file: string, line: number, ignore: Set<string>, lastDepth: number) {
  const hit = (rule: string, message: string) => {
    if (!ignore.has(rule)) report(file, line, 'error', rule, message);
  };
  if (node.depth === 1) hit('heading-level', 'an H1 in the body; the title is the H1, so start at ##');
  else if (node.depth > lastDepth + 1) hit('heading-level', `an H${node.depth} after an H${lastDepth}; do not skip a level`);
  if (/[.:;,]$/.test(words)) hit('heading-punctuation', `"${words}" ends with punctuation`);
  if (/[!?]/.test(words)) hit('heading-punctuation', `"${words}" has a "!" or "?"; phrase it as the reader's intent`);
  headingCase(words, file, line, `"${words}"`, ignore);
}

function headingCase(words: string, file: string, line: number, what: string, ignore: Set<string>) {
  if (ignore.has('heading-case')) return;
  const unnamed = PROPER_PHRASES.reduce((w, p) => w.replaceAll(p, p.split(' ')[0]), words);
  const tokens = unnamed.replace(/CODE/g, ' ').split(/\s+/).filter(Boolean);
  const wrong = tokens.slice(1).filter((t) => {
    const w = t.replace(/^[("'“‘]+|[)"'”’.,:;!?]+$/g, '');
    return /^[A-Z][a-z]+(?:'s)?$/.test(w) && !PROPER_NOUNS.has(w.replace(/'s$/, ''));
  });
  if (wrong.length) {
    report(file, line, 'error', 'heading-case', `${what} is not sentence case (${wrong.join(', ')}); lowercase all but the first word and proper nouns`);
  }
}

function checkLinks(node: Parent, file: string, line: number, ignore: Set<string>, site: Site, from: string) {
  visitAll(node as RootContent, (n) => {
    if (n.type !== 'link') return;
    const link = n as Link;
    const label = proseOf(link).trim();
    if (LINK_TEXT_BANNED.has(label.toLowerCase()) && !ignore.has('link-text')) {
      report(file, line, 'error', 'link-text', `link text "${label}"; say where it goes (STYLE.md §4.9)`);
    }
    if (/^https?:\/\//.test(label) && (label === link.url || `${label}/` === link.url) && !ignore.has('bare-url')) {
      report(file, line, 'error', 'bare-url', `bare URL ${link.url}; give it link text that says where it goes`);
    }
    if (ignore.has('link')) return;
    const verdict = checkHref(link.url, site, from);
    if (!verdict.ok) report(file, line, verdict.severity, verdict.severity === 'error' ? 'link' : 'link-pending', verdict.message);
  });
}

function checkFence(node: Code, file: string, line: number, ignore: Set<string>, site: Site) {
  const hit = (rule: string, message: string) => {
    if (!ignore.has(rule)) report(file, line, 'error', rule, message);
  };
  if (!node.lang) hit('fence-language', 'a fenced block without a language (`text` for output)');
  if (node.lang && /^(?:bash|sh|shell|zsh)$/.test(node.lang) && /^\s*\$ /m.test(node.value)) {
    hit('fence-prompt', 'a shell block with a `$` prompt; blocks are copyable, so drop it (STYLE.md §4.6)');
  }
  if (node.lang !== 'cypher' && /^run\b/.test(node.meta ?? '')) {
    try {
      if (!parseSampleInfo(node.lang, node.meta)) hit('fence-run', `a \`run\` fence in \`${node.lang ?? 'no language'}\`; runnable cells are Cypher, verified samples are \`python run\`, \`js run\`, \`rust run\`, \`java run\`, \`go run\`, \`swift run\` or \`c run\``);
    } catch (e) {
      hit('fence-run', (e as Error).message);
    }
  }
  if (node.lang === 'cypher') {
    try {
      parseRunInfo(node.lang, node.meta);
    } catch (e) {
      hit('fence-run', (e as Error).message);
    }
  }
  trustFence(node.lang ?? '', node.value, file, line, ignore, site);
}

/** A component's attributes as the twin renderer reads them: strings, `true`, or JSON literals (constructs.ts). */
function componentProps(node: MdxJsxFlowElement): ComponentProps {
  const props: ComponentProps = {};
  for (const attr of node.attributes) {
    if (attr.type !== 'mdxJsxAttribute') continue;
    const v = attr.value;
    if (v === null || v === undefined) props[attr.name] = true;
    else if (typeof v === 'string') props[attr.name] = v;
    else {
      try {
        props[attr.name] = JSON.parse(v.value);
      } catch {
        props[attr.name] = null; // the construct renderer reports a non-literal
      }
    }
  }
  return props;
}

/** A component on a page: its twin's fences pass the same trust checks as the page's own. */
function checkComponent(name: string, props: ComponentProps, file: string, line: number, ignore: Set<string>, site: Site) {
  const toMarkdown = COMPONENT_TWINS[name];
  if (!toMarkdown) return; // the construct renderer reports unknown components
  let md: string;
  try {
    md = toMarkdown(props);
  } catch (e) {
    report(file, line, 'error', 'component', `<${name} />: its toMarkdown threw: ${(e as Error).message}`);
    return;
  }
  visitAll(parseMarkdown(md), (n) => {
    if (n.type === 'code') trustFence(n.lang ?? '', n.value, file, line, ignore, site, `<${name} />`);
  });
}

function trustFence(lang: string, value: string, file: string, line: number | null, ignore: Set<string>, site: Site, where = 'a') {
  const l = lang.toLowerCase();
  if (CONFIG_LANGS.has(l) && NEEDS_READ_ONLY.test(value) && !value.includes('--read-only') && !ignore.has('trust-read-only')) {
    report(file, line, 'error', 'trust-read-only', `${where} \`${l}\` block starts relate serve, MCP or a host config without \`--read-only\` (ADR-0013)`);
  }
  // An AGENTS.md block (markdown) is copied as it stands: every relate command in it that opens a store opens it read-only.
  if ((l === 'markdown' || l === 'md') && !ignore.has('trust-read-only')) {
    for (const cmd of value.split('\n').filter((x) => /`relate\b[^`]*--database\b/.test(x) && !x.includes('--read-only'))) {
      report(file, line, 'error', 'trust-read-only', `${where} markdown block opens a store without \`--read-only\`: "${cmd.trim().slice(0, 60)}" (ADR-0013)`);
    }
  }
  if (PROMPT_LANGS.has(l) && /\binstall\b/i.test(value) && /\brelate\b/i.test(value) && INSTALLS.test(value) && !ignore.has('trust-pin')) {
    const versions = [...new Set(value.match(SEMVER) ?? [])];
    if (!versions.length) {
      report(file, line, 'error', 'trust-pin', `${where} pasted install prompt pins no version; pin ${site.engine.version} (ADR-0013)`);
    } else if (!versions.includes(site.engine.version)) {
      report(file, line, 'error', 'trust-pin', `${where} pasted install prompt pins ${versions.join(', ')}, not the engine's ${site.engine.version} (_data/engine.json)`);
    }
  }
}

function checkShape(type: DocType, headings: string[], paragraphs: Prose[], tree: Root, file: string) {
  const have = new Set(headings.map((h) => h.toLowerCase()));
  const missing = REQUIRED_SECTIONS[type].filter((s) => !have.has(s.toLowerCase()));
  if (missing.length) {
    report(file, null, 'error', 'page-shape', `a ${type} page needs the section(s) ${missing.map((m) => `"${m}"`).join(', ')} (README.md "Sections")`);
  }
  if (type === 'how-to' && paragraphs[0] && !/^This guide shows you how to\b/.test(paragraphs[0].text.trim())) {
    report(file, paragraphs[0].line, 'error', 'page-shape', 'a how-to opens with "This guide shows you how to…" (STYLE.md §4.8)');
  }
  const last = [...tree.children].reverse().find((n) => n.type !== 'mdxFlowExpression' && n.type !== 'html');
  if (last?.type === 'containerDirective' && (last.name === 'warning' || last.name === 'danger')) {
    report(file, null, 'error', 'page-shape', 'the page ends on a warning; end on the next step (STYLE.md §4.8)');
  }
}

// ---------------------------------------------------------------------------
// The twin (3a) and the trust checks that read it (3d)

function checkTwin(page: PageFile, text: string, site: Site, links: { pages: Set<string> }) {
  const { id, file } = page;
  const { body } = splitFrontmatter(text, rel(file));
  let markdown: string;
  let termCount: number;
  try {
    const twin = renderTwin(
      { id, file, body, data: page.data as unknown as PageData, lastUpdated: lastUpdated(file) },
      { links, glossary: site.glossary, components: COMPONENT_TWINS, engine: site.engine },
    );
    markdown = twin.markdown;
    termCount = twin.terms.length;
    twin.terms.forEach((t) => site.termsUsed.add(t.id));
  } catch (e) {
    report(file, null, 'error', 'construct', `the twin does not render: ${(e as Error).message.replace(/\n\s*/g, ' ')}`);
    // The trust checks on prose still run, on the source, so a broken construct hides nothing.
    twinProse(parsePage(body), typeOf(id), file);
    return;
  }
  const where = `${rel(file)} (twin)`;
  const twinFile = join(ROOT, where);
  twinStructure(markdown, id, twinFile, site);

  // Every fence the page has appears in the twin, and a diagram's fence is followed by its words.
  const source = parsePage(body);
  const twinTree = parseMarkdown(splitFrontmatter(markdown, where).body);
  const twinFences = new Set<string>();
  visitAll(twinTree, (n) => {
    if (n.type === 'code') twinFences.add(fenceKey(n.lang, n.value));
  });
  const offset = frontmatterLines(text);
  // A data block over 2 KiB is a stub linking its file (ADR-0049), checked against the block's bytes.
  const data = twinDataProblems(id, collectCells(source).data, twinTree);
  for (const problem of data.problems) report(file, null, 'error', 'twin-data', problem);
  visitAll(source, (n) => {
    if (n.type === 'code' && data.linked.has(parseDataInfo(n.lang, n.meta) ?? '')) return;
    if (n.type === 'code' && !twinFences.has(fenceKey(n.lang, n.value))) {
      report(file, (n.position?.start.line ?? 0) + offset, 'error', 'twin', `the twin lacks this \`${n.lang ?? ''}\` block`);
    }
  });
  twinTree.children.forEach((n, i) => {
    if (n.type !== 'code' || n.lang !== 'mermaid') return;
    const words = diagramDescription(n.value);
    const next = twinTree.children[i + 1];
    if (words && (next?.type !== 'paragraph' || toString(next).trim() !== words)) {
      report(file, null, 'error', 'twin', `the twin's mermaid block is not followed by its accDescr text ("${words.slice(0, 40)}…")`);
    }
  });
  if (termCount > MAX_TERMS && !id.startsWith('_example/')) {
    report(file, null, 'warning', 'terms-cap', `the page links ${termCount} glossary terms; the Terms section holds at most ${MAX_TERMS} (DOCS-PLAN.md §3.1), so link the rest as plain text`);
  }
  // The twin's Terms section lists exactly the page's linked terms, in order of first use (DOCS-PLAN.md §4.11).
  for (const problem of twinTermsProblems(markdown, linkedTerms(body).map((t) => t.id), site.glossary)) report(file, null, 'error', 'twin', problem);
  twinProse(twinTree, typeOf(id), file);
}

const fenceKey = (lang: string | null | undefined, value: string) => `${lang ?? ''}\u0000${value.replace(/\s+$/, '')}`;

/** The frontmatter fields every twin carries, `verified` equal to the engine's. */
function twinStructure(markdown: string, id: string, file: string, site: Site) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!m) {
    report(file, null, 'error', 'twin', 'the twin does not open with a YAML frontmatter block');
    return;
  }
  let front: Record<string, unknown>;
  try {
    front = parseYaml(m[1]) as Record<string, unknown>;
  } catch (e) {
    report(file, null, 'error', 'twin', `the twin's frontmatter is not YAML: ${(e as Error).message}`);
    return;
  }
  const keys = [...TWIN_KEYS, ...(typeOf(id) ? ['type'] : [])];
  const missing = keys.filter((k) => !(k in front));
  if (missing.length) report(file, null, 'error', 'twin', `the twin's frontmatter lacks ${missing.join(', ')}`);
  if (String(front.verified) !== site.engine.verified) {
    report(file, null, 'error', 'twin', `the twin says verified: ${String(front.verified)}; _data/engine.json says ${site.engine.verified}`);
  }
  if (!String(front.description ?? '').startsWith(CANONICAL_PHRASE)) {
    report(file, null, 'error', 'twin', `the twin's description does not open with the canonical phrase "${CANONICAL_PHRASE}" (DOCS-PLAN.md §3.9)`);
  }
  if (id !== '' && front.canonical_url !== `${CANONICAL_ORIGIN}${pageUrl(id)}`) {
    report(file, null, 'error', 'twin', `the twin's canonical_url is ${String(front.canonical_url)}, not ${CANONICAL_ORIGIN}${pageUrl(id)}`);
  }
  try {
    parseMarkdown(markdown.slice(m[0].length));
  } catch (e) {
    report(file, null, 'error', 'twin', `the twin does not parse as markdown: ${(e as Error).message}`);
  }
}

/** The imperative heuristic and the injection patterns, on a twin's prose outside fences, headings and tables. */
function twinProse(tree: Root, type: DocType | null, file: string) {
  const strict = !type || !INSTRUCTIVE_TYPES.has(type);
  const seen = new Set<string>();
  const walk = (node: Root | RootContent) => {
    if (node.type === 'code' || node.type === 'heading' || node.type === 'table' || node.type === 'html') return;
    if (node.type === 'paragraph') {
      const text = proseOf(node).replace(/\s+/g, ' ').trim();
      // For messages: the sentence with its inline code back in place of the placeholder.
      const code: string[] = [];
      visitAll(node, (n) => {
        if (n.type === 'inlineCode') code.push(`\`${n.value}\``);
      });
      let codeSeen = 0;
      const shown = (sentence: string) => {
        const out = sentence.replace(/CODE/g, () => code[codeSeen++] ?? 'CODE');
        return out.length > 80 ? `${out.slice(0, 77)}…` : out;
      };
      for (const re of INJECTION) {
        const m = re.exec(text);
        if (m && !seen.has(m[0])) {
          seen.add(m[0]);
          report(file, null, 'error', 'trust-injection', `the twin addresses the agent ("${m[0]}"); docs are data (ADR-0013)`);
        }
      }
      if (strict) {
        const opensWithLink = node.children[0]?.type === 'link';
        text.split(/(?<=[.!?])\s+/).forEach((sentence, i) => {
          const before = codeSeen;
          const display = shown(sentence);
          codeSeen = before + (sentence.match(/CODE/g)?.length ?? 0);
          if (i === 0 && opensWithLink) return;
          const words = sentence.replace(/^[^A-Za-z]+/, '').split(/\s+/);
          const first = words[0]?.toLowerCase().replace(/[^a-z']/g, '') ?? '';
          const imperative = IMPERATIVE_VERBS.has(first) || /^(?:do not|don't)\b/i.test(words.slice(0, 2).join(' '));
          const punctuated = /[.!?:]["'”)]?$/.test(sentence.trim());
          if (imperative && punctuated && words.length >= 3 && !seen.has(sentence)) {
            seen.add(sentence);
            report(
              file,
              null,
              'error',
              'trust-imperative',
              `"${display}" instructs the reader on ${type ? `a ${type === 'explanation' ? 'concept' : type}` : 'the landing'} page; describe the behavior instead, or move it into a fenced prompt (ADR-0013)`,
            );
          }
        });
      }
      return;
    }
    if ('children' in node) (node as Parent).children.forEach((c) => walk(c as RootContent));
  };
  walk(tree);
}

// ---------------------------------------------------------------------------
// Recorded results and diagrams (3f)

function checkResults(page: PageFile, site: Site) {
  try {
    const results = readResults(page.file);
    if (results?.verified && results.verified !== site.engine.verified) {
      report(page.file.replace(/\.mdx$/, '.results.json'), null, 'error', 'results-verified', `recorded against ${results.verified}; _data/engine.json says ${site.engine.verified}; re-record the page`);
    }
  } catch (e) {
    report(page.file, null, 'error', 'results', (e as Error).message);
  }
}

function checkDiagrams(page: PageFile, body: string) {
  let blocks;
  try {
    blocks = mermaidBlocks(body);
  } catch (e) {
    report(page.file, null, 'error', 'diagram', (e as Error).message);
    return;
  }
  const dir = join(dirname(page.file), 'diagrams');
  const slug = page.file.split(sep).pop()!.replace(/\.mdx$/, '');
  const offset = frontmatterLines(readFileSync(page.file, 'utf8'));
  for (const d of blocks) {
    for (const p of diagramProblems(d.source)) report(page.file, d.line + offset, 'error', 'diagram', `mermaid block ${d.index}: ${p}`);
    try {
      readRendered(dir, slug, d);
    } catch (e) {
      report(page.file, d.line + offset, 'error', 'diagram', `${(e as Error).message}; render again: ${DOCS_RENDER_COMMAND}`);
    }
  }
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!isDiagramFileOf(slug, name)) continue;
      const index = Number(/^(\d+)-/.exec(name.slice(slug.length + 1))![1]);
      if (index > blocks.length) report(join(dir, name), null, 'error', 'diagram', `a rendering of mermaid block ${index}, which ${rel(page.file)} no longer has; delete it`);
    }
  }
}

/** Rendering files in a diagrams/ directory that belong to no page. */
function strayRenderings(pages: PageFile[]) {
  const dirs = new Set(pages.map((p) => join(dirname(p.file), 'diagrams')));
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const slugs = pages.filter((p) => join(dirname(p.file), 'diagrams') === dir).map((p) => p.file.split(sep).pop()!.replace(/\.mdx$/, ''));
    for (const name of readdirSync(dir)) {
      // A cell's static graph form, or an element's static form: the cells and elements checks own them.
      if (slugs.some((s) => resultGraphCell(s, name) !== null || elementFileId(s, name) !== null)) continue;
      if (!slugs.some((s) => isDiagramFileOf(s, name))) report(join(dir, name), null, 'warning', 'diagram', 'a rendering no page draws; delete it');
    }
  }
}

// ---------------------------------------------------------------------------
// Glossary (STYLE.md §4.11) and the Vale vocabulary

function glossaryFiles(): string[] {
  if (!existsSync(GLOSSARY_DIR)) return [];
  return readdirSync(GLOSSARY_DIR).filter((n) => n.endsWith('.mdx')).sort().map((n) => join(GLOSSARY_DIR, n));
}

/**
 * The glossary (DOCS-PLAN.md §4.11, src/lib/docs/checks/glossary.ts): the
 * term files and their bodies, and unused terms; the bodies' prose also gets
 * the word rules (banned words, synonyms and aliases, self-reference), as a
 * page's prose does. Runs after the pages, so `site.termsUsed` is complete.
 */
function checkGlossary(site: Site) {
  const entries = readGlossaryEntries();
  const gsite = { pages: new Set([...site.published.keys(), ...GENERATED_IDS]), termsUsed: site.termsUsed };
  checkGlossaryFiles(gsite, report, (ref) => checkPageRef(ref, site), entries);
  checkUnusedTerms(gsite, report, entries);
  for (const e of entries) {
    if (!e.body) continue;
    const raw = readFileSync(e.file, 'utf8');
    const fm = frontmatterLines(raw);
    const offset = fm + Math.max(0, raw.split('\n').slice(fm).findIndex((l) => l.trim()));
    let tree: Root;
    try {
      tree = parsePage(e.body);
    } catch {
      continue; // checkGlossaryFiles reports it
    }
    visitAll(tree, (node) => {
      if (node.type !== 'paragraph' && node.type !== 'tableCell') return;
      const line = (node.position?.start.line ?? 1) + offset;
      checkWords({ text: proseOf(node), line, ignore: new Set() }, e.file);
    });
    // A body's fences get the page fences' trust rules (ADR-0013): a block that
    // starts relate serve, MCP or a host config carries --read-only. A body
    // holds no comments, so nothing lifts the rule.
    for (const f of bodyFences(tree)) trustFence(f.lang, f.value, e.file, f.line + offset, new Set(), site);
  }
}

const VOCAB_FILE = join(ROOT, 'scripts/vale/styles/config/vocabularies/relate/accept.txt');
/** Names the vocabulary accepts beyond the glossary terms (STYLE.md §4.4). */
const VOCAB_NAMES = ['relate', 'Cypher', 'openCypher', 'Neo4j', 'Node.js', 'WebAssembly', 'WASM', 'Bolt', 'MCP', 'GQL', 'TOON', 'NVL', 'OPFS', 'Diátaxis'];

/**
 * The Vale vocabulary (scripts/vale/styles/config/vocabularies/relate/accept.txt):
 * VOCAB_NAMES and every glossary term, one regular expression a line. A term
 * that carries capitals is matched exactly, so Vale.Terms enforces its case;
 * an all-lowercase term is matched in any case (`(?i)`), so a sentence may
 * start with it.
 */
function vocabulary(): string {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entries = new Set(VOCAB_NAMES.map(escape));
  for (const t of readGlossary().values()) {
    const term = t.term.replace(/`/g, '').trim();
    if (!term) continue;
    entries.add(/[A-Z]/.test(term) ? escape(term) : `(?i)${escape(term)}`);
  }
  return `${[...entries].sort((a, b) => a.replace('(?i)', '').localeCompare(b.replace('(?i)', ''))).join('\n')}\n`;
}

function writeVocabulary(): boolean {
  const text = vocabulary();
  if (existsSync(VOCAB_FILE) && readFileSync(VOCAB_FILE, 'utf8') === text) return false;
  mkdirSync(dirname(VOCAB_FILE), { recursive: true });
  writeFileSync(VOCAB_FILE, text);
  return true;
}

// ---------------------------------------------------------------------------
// Engine and data files

function checkVersions(site: Site) {
  const lag = (a: string, b: string) => {
    const [ma, na] = a.split('.').map(Number);
    const [mb, nb] = b.split('.').map(Number);
    return ma !== mb ? Infinity : Math.abs(na - nb);
  };
  if (lag(site.engine.version, site.engine.verified) > 1) {
    report(ENGINE_FILE, null, 'error', 'trust-lag', `verified ${site.engine.verified} lags the engine ${site.engine.version} by more than one minor; re-verify the pages`);
  }
  for (const name of ['errors.json', 'cli.json', 'surfaces.json']) {
    const file = join(DOCS_DIR, '_data', name);
    if (!existsSync(file)) continue;
    let data: { verified?: unknown };
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      report(file, null, 'error', 'data', `not JSON: ${(e as Error).message}`);
      continue;
    }
    const v = typeof data.verified === 'string' ? data.verified.replace(/^v/, '') : null;
    if (v && lag(site.engine.version, v) > 1) {
      report(file, null, 'error', 'trust-lag', `verified ${v} lags the engine ${site.engine.version} by more than one minor`);
    }
  }
  // <Matrix /> fails the build on an invalid surfaces file, but only on a page that uses it.
  if (existsSync(SURFACES_FILE)) {
    try {
      for (const p of validateSurfaces(JSON.parse(readFileSync(SURFACES_FILE, 'utf8')) as SurfacesData)) report(SURFACES_FILE, null, 'error', 'data', p);
    } catch (e) {
      report(SURFACES_FILE, null, 'error', 'data', `not JSON: ${(e as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Built-site checks (--built)

const DIST = process.env.DIST ? resolvePath(process.env.DIST) : join(ROOT, 'dist');
const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');

function htmlIds(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decodeEntities(m[1])));
}

function loadBuiltIds(site: Site): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const p of site.published.values()) {
    const file = join(DIST, pageUrl(p.id), 'index.html');
    if (existsSync(file)) out.set(pageUrl(p.id), htmlIds(readFileSync(file, 'utf8')));
  }
  for (const id of GENERATED_IDS) {
    const file = join(DIST, pageUrl(id), 'index.html');
    if (existsSync(file)) out.set(pageUrl(id), htmlIds(readFileSync(file, 'utf8')));
  }
  for (const slug of site.recipes.keys()) {
    const file = join(DIST, 'cookbook', slug, 'index.html');
    if (existsSync(file)) out.set(`/cookbook/${slug}/`, htmlIds(readFileSync(file, 'utf8')));
  }
  return out;
}

/** The script budget (DOCS-PLAN.md §7.1, checks/budget.ts): every built docs and cookbook page's eager JavaScript, and the three largest printed. */
function checkBudget() {
  const rows = measurePages(DIST);
  for (const { page, scripts } of rows) {
    const file = join(DIST, page, 'index.html');
    if (scripts.bytes > PAGE_JS_BUDGET) {
      const top = scripts.files.slice(0, 3).map((f) => `${f.path} ${kb(f.bytes)}`).join(', ');
      report(file, null, 'error', 'js-budget', `${page} runs ${kb(scripts.bytes)} of JavaScript before its lazy chunks, over the ${kb(PAGE_JS_BUDGET)} budget (inline ${kb(scripts.inline)}; ${top})`);
    }
    for (const m of scripts.missing) report(file, null, 'error', 'js-budget', `${page} loads ${m}, which is not in the build`);
  }
  if (rows.length) {
    console.log(`docs: script budget ${kb(PAGE_JS_BUDGET)} per page before lazy chunks; the largest of ${rows.length} built docs and cookbook page(s):`);
    for (const { page, scripts } of rows.slice(0, 3)) console.log(`  ${kb(scripts.bytes).padStart(9)}  ${page}  (${scripts.files.length} file(s), inline ${kb(scripts.inline)})`);
  }
}

function checkBuilt(site: Site) {
  if (!existsSync(join(DIST, 'docs'))) {
    report(DIST, null, 'error', 'built', 'dist/docs/ does not exist; run `npm run build` before `docs:check -- --built`');
    return;
  }
  checkBudget();
  if (!existsSync(join(DIST, 'playground/index.html'))) report(DIST, null, 'error', 'built', 'dist/playground/index.html is missing; links to /playground/ would 404');
  for (const p of site.published.values()) {
    const htmlFile = join(DIST, pageUrl(p.id), 'index.html');
    const twinFile = join(DIST, twinUrl(p.id));
    if (!existsSync(htmlFile)) report(htmlFile, null, 'error', 'built', `${rel(p.file)} has no built page`);
    if (!existsSync(twinFile)) {
      report(twinFile, null, 'error', 'built', `${rel(p.file)} has no built twin`);
      continue;
    }
    const twin = readFileSync(twinFile, 'utf8');
    twinStructure(twin, p.id, twinFile, site);
    const twinTree = parseMarkdown(splitFrontmatter(twin, rel(twinFile)).body);
    // Every data block built at /docs/<page>/data/<name>.json, and every stub naming its file's bytes (ADR-0049).
    try {
      const blocks = collectCells(parsePage(splitFrontmatter(readFileSync(p.file, 'utf8'), rel(p.file)).body)).data;
      for (const problem of builtDataProblems(DIST, p.id, blocks, twinTree)) report(twinFile, null, 'error', 'twin-data', problem);
    } catch {
      // An unparsable page is reported by the source checks.
    }
    if (!existsSync(htmlFile)) continue;
    // Every block the page offers to copy (code blocks, cells, component blocks) is a fence in the twin;
    // a cell's parameters over 2 KiB are a stub whose SHA-256 is theirs.
    const fences = new Set<string>();
    visitAll(twinTree, (n) => {
      if (n.type === 'code') fences.add(n.value.replace(/\s+$/, ''));
    });
    const linked = new Set(twinStubs(twinTree).map((s) => {
      try {
        return String((JSON.parse(s.value) as { sha256?: unknown }).sha256);
      } catch {
        return '';
      }
    }));
    const html = readFileSync(htmlFile, 'utf8');
    for (const m of html.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/g)) {
      const value = decodeEntities(m[1]).replace(/^\n/, '').replace(/\s+$/, '');
      if (value && !fences.has(value) && !linked.has(sha256Hex(value))) {
        report(htmlFile, null, 'error', 'twin', `the page shows a code block its twin lacks: "${value.split('\n')[0].slice(0, 60)}"`);
      }
    }
  }
  const landing = join(DIST, 'docs/index.md');
  if (existsSync(landing)) {
    const text = readFileSync(landing, 'utf8');
    twinStructure(text, '', landing, site);
    const tree = parseMarkdown(splitFrontmatter(text, rel(landing)).body);
    twinProse(tree, null, landing);
    visitAll(tree, (n) => {
      if (n.type === 'code') trustFence(n.lang ?? '', n.value, landing, null, new Set(), site, 'the landing twin\'s');
    });
  } else report(landing, null, 'error', 'built', 'the docs landing has no twin');
  const llms = join(DIST, 'docs/llms.txt');
  if (!existsSync(llms)) {
    report(llms, null, 'error', 'built', 'dist/docs/llms.txt is missing');
    return;
  }
  const llmsText = readFileSync(llms, 'utf8');
  if (!llmsText.split('\n', 1)[0].includes(CANONICAL_PHRASE)) {
    report(llms, 1, 'error', 'llms', `the first line does not carry the canonical phrase "${CANONICAL_PHRASE}" (DOCS-PLAN.md §3.9)`);
  }
  for (const m of llmsText.matchAll(/\]\(([^)\s]+)\)/g)) {
    let path = m[1];
    if (path.startsWith(CANONICAL_ORIGIN)) path = path.slice(CANONICAL_ORIGIN.length);
    if (!path.startsWith('/')) continue;
    const clean = decodeURIComponent(path.split(/[?#]/)[0]);
    const ok = [join(DIST, clean), join(DIST, clean, 'index.html')].some((f) => existsSync(f) && !f.endsWith(sep));
    if (!ok) report(llms, null, 'error', 'llms', `${m[1]} does not resolve to a built file`);
  }
}

// ---------------------------------------------------------------------------
// Vale (--lint)

const VALE_VERSION = '3.25.1';

function lint(): number {
  if (writeVocabulary()) console.error(`updated ${rel(VOCAB_FILE)}`);
  const probe = spawnSync('vale', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    console.error(
      [
        'docs:lint needs Vale (https://vale.sh), which is not on PATH.',
        `  macOS:  brew install vale`,
        `  other:  download vale ${VALE_VERSION} from https://github.com/vale-cli/vale/releases/tag/v${VALE_VERSION}`,
        '          and put the `vale` binary on PATH; CI installs that version (.github/workflows/cookbook.yml).',
        'Then run `npm run docs:lint` again. It fetches the Google style on first run (`vale sync`).',
      ].join('\n'),
    );
    return process.env.CI ? 1 : 0;
  }
  const valeIni = join(ROOT, '.vale.ini');
  if (!existsSync(join(ROOT, 'scripts/vale/styles/Google'))) {
    const sync = spawnSync('vale', ['--config', valeIni, 'sync'], { cwd: ROOT, stdio: 'inherit' });
    if (sync.status !== 0) return sync.status ?? 1;
  }
  const files = [...pageFiles().map((p) => p.file), join(DOCS_DIR, 'STYLE.md')].map(rel);
  const run = spawnSync('vale', ['--config', valeIni, ...files], { cwd: ROOT, stdio: 'inherit' });
  // The glossary's term files: Vale 3.25.1 lints front-matter string values,
  // and a term's id, context and see are lowercase identifiers the vocabulary's
  // case check flags (`context: cypher`). Vale reads copies of the files with
  // the frontmatter blanked out instead, so the bodies get every Vale rule and
  // the lines and the printed paths stay the real ones.
  const tmp = mkdtempSync(join(tmpdir(), 'relate-docs-lint-'));
  try {
    const terms = glossaryFiles().map(rel);
    for (const f of terms) {
      mkdirSync(dirname(join(tmp, f)), { recursive: true });
      writeFileSync(join(tmp, f), blankFrontmatter(readFileSync(join(ROOT, f), 'utf8')));
    }
    const runTerms = terms.length ? spawnSync('vale', ['--config', valeIni, ...terms], { cwd: tmp, stdio: 'inherit' }) : { status: 0 };
    return Math.max(run.status ?? 1, runTerms.status ?? 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Main

const { values: args } = parseArgs({
  options: {
    built: { type: 'boolean', default: false },
    vocab: { type: 'boolean', default: false },
    lint: { type: 'boolean', default: false },
    record: { type: 'boolean', default: false },
  },
});

async function main(): Promise<number> {
  if (args.lint) return lint();
  if (args.vocab) {
    console.log(writeVocabulary() ? `updated ${rel(VOCAB_FILE)}` : `${rel(VOCAB_FILE)} is current`);
    return 0;
  }
  if (args.record) {
    const pages = pageFiles();
    const only = process.env.DOCS_ONLY ? new Set(process.env.DOCS_ONLY.split(',').map((s) => s.trim()).filter(Boolean)) : null;
    const published = new Map(
      pages.filter((p) => p.data.status !== 'planned' && (!only || only.has(p.id))).map((p) => [p.id, p]),
    );
    let changed = await recordCells({ engine: readEngine(), published }, report, (line) => console.log(line));
    // After the cells: an element's static form is made from the page's recordings.
    changed += await recordElements({ published, only }, report, (line) => console.log(line));
    const errors = findings.filter((f) => f.severity === 'error');
    for (const f of errors) console.error(`${f.file}${f.line ? `:${f.line}` : ''}  ${f.message}`);
    console.log(`docs --record: ${changed} file(s) changed${errors.length ? `, ${errors.length} page problem(s) left unrecorded` : ''}`);
    return errors.length ? 1 : 0;
  }

  const pages = pageFiles();
  const published = new Map(pages.filter((p) => p.data.status !== 'planned').map((p) => [p.id, p]));
  const recipes = new Map(loadRecipes(COOKBOOK_DIR, { validate: false }).recipes.map((r) => [r.slug, new Set(r.cells.map((c) => c.id))]));
  const site: Site = {
    engine: readEngine(),
    pages,
    published,
    planned: new Set(pages.filter((p) => p.data.status === 'planned').map((p) => p.id)),
    glossary: readGlossary(),
    recipes,
    anchors: new Map(),
    builtIds: null,
    termsUsed: new Set(),
    dist: DIST,
  };
  const texts = new Map(pages.map((p) => [p.id, readFileSync(p.file, 'utf8')]));
  const unparsable = new Set<string>();

  // Anchors first, so links between pages resolve whatever the order.
  for (const p of published.values()) {
    const { body } = splitFrontmatter(texts.get(p.id)!, rel(p.file));
    try {
      site.anchors.set(p.id, sourceAnchors(parsePage(body), body));
    } catch (e) {
      const where = (e as { line?: number }).line;
      report(p.file, typeof where === 'number' ? where + frontmatterLines(texts.get(p.id)!) : null, 'error', 'parse', `the page is not valid MDX: ${(e as Error).message}`);
      unparsable.add(p.id);
    }
  }
  if (args.built && existsSync(join(DIST, 'docs'))) site.builtIds = loadBuiltIds(site);

  checkVersions(site);
  cliCheck(site, report);
  // The generated pages (glossary, changelog) count as published, with the anchors they render.
  const genCtx = generatedContext();
  for (const g of GENERATED) {
    try {
      site.anchors.set(g.meta.id, g.render(genCtx).anchors);
    } catch {
      // checkGenerated reports it.
    }
  }
  const links = { pages: new Set([...published.keys(), ...GENERATED_IDS]) };
  for (const p of pages) {
    checkFrontmatter(p, site);
    if (p.data.status === 'planned' || unparsable.has(p.id)) continue;
    const text = texts.get(p.id)!;
    try {
      checkSource(p, text, site);
    } catch (e) {
      report(p.file, null, 'error', 'parse', (e as Error).message);
      continue;
    }
    checkTwin(p, text, site, links);
    checkResults(p, site);
    checkDiagrams(p, splitFrontmatter(text, rel(p.file)).body);
  }
  strayRenderings([...published.values()]);
  await checkCells(site, report);
  await checkElements(site, report);
  checkSamples(site, report, clientEnv());
  checkSampleManifests(site, report, args.built ? site.dist : null);
  checkGlossary(site);
  checkGenerated(site, report, DIST);
  for (const g of GENERATED) {
    try {
      twinProse(parseMarkdown(splitFrontmatter(g.render(genCtx).markdown, g.meta.id).body), 'reference', join(ROOT, 'src/lib/docs/generated', `${g.meta.id.split('/').at(-1)}.ts`));
    } catch {
      // checkGenerated reports it.
    }
  }
  twinProse(parseMarkdown(splitFrontmatter(feedbackMarkdown(genCtx), 'feedback.md').body), 'reference', join(ROOT, 'src/lib/docs/generated/feedback.ts'));
  checkSkill(site, report);
  await checkTaskSkillCypher(report);
  checkGraph(site, report);
  checkEmbeddings(site, report);
  (await import('../src/lib/docs/checks/capabilities.ts')).checkCapabilities(site, report); // the capability catalog (DOCS-PLAN.md §3.8)
  if (existsSync(VOCAB_FILE) || glossaryFiles().length) {
    const current = existsSync(VOCAB_FILE) ? readFileSync(VOCAB_FILE, 'utf8') : '';
    if (current !== vocabulary()) report(VOCAB_FILE, null, 'error', 'vocab', 'the Vale vocabulary is stale; run `node scripts/docs.ts --vocab` (or `npm run docs:lint`)');
  }
  if (args.built) checkBuilt(site);

  return print(published.size, pages.length - published.size);
}

function print(published: number, planned: number): number {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  // Links to pages not written yet are expected while the docs grow: one line per target page.
  const pending = new Map<string, Set<string>>();
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const target = f.rule === 'link-pending' ? /\/docs\/([^\s#?]+)/.exec(f.message)?.[1] : undefined;
    if (target) pending.set(target, new Set([...(pending.get(target) ?? []), f.file]));
    else byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  }
  const out: string[] = [];
  for (const [file, list] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(file);
    for (const f of list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
      out.push(`  ${String(f.line ?? '-').padStart(4)}  ${f.severity.padEnd(7)}  ${f.rule.padEnd(19)}  ${f.message}`);
    }
    out.push('');
  }
  if (pending.size) {
    out.push('Links to pages not written yet (they render as text; add the page, or a `status: planned` stub, to declare it):');
    for (const [target, files] of [...pending].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`  warning  ${target}  from ${[...files].join(', ')}`);
    }
    out.push('');
  }
  const scope = args.built ? 'source and built checks' : 'source checks; `npm run docs:check -- --built` after a build adds the dist/ checks';
  const summary =
    `docs: ${published} page(s), ${planned} planned, ${glossaryFiles().length} glossary term(s): ` +
    `${errors} error(s), ${warnings} warning(s) (${scope})`;
  if (out.length) console.error(out.join('\n'));
  (errors ? console.error : console.log)(summary);
  return errors ? 1 : 0;
}

process.exit(await main());
