// Data and small renderers for the home page's "Run a query on connected data" (Demo.astro) and
// "One statement at a time" (LiveGraph.astro) sections. Shared by the build (the static first
// state) and the browser (the scripted playback), so it stays free of Node imports and erasable.
//
// The scenario and preset data are a scripted preview. Every Cypher statement was run on the
// site's WASM build (relate v0.1.2) over the sample data described beside it; the result rows are
// that run's output, in the engine's own text form.

export interface Scenario {
  id: 'memory' | 'code' | 'recs';
  icon: 'brain' | 'code' | 'sparkles';
  title: string;
  ask: string;
  db: string;
  q: string;
  cypher: string[];
  cols: string[];
  rows: string[][];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'memory', icon: 'brain', title: 'Agent memory', ask: 'Ask what the agent remembered from last session.', db: 'memory.rl',
    q: 'What do you remember from our last session?',
    cypher: ['MATCH (e:Event)-[:AFFECTS]->(x)', "WHERE e.session = 'last'", 'RETURN e.summary AS remembered, labels(x)[0] AS kind, x.name AS item'],
    cols: ['remembered', 'kind', 'item'],
    rows: [['"Pricing depends on the Q3 launch"', '"Decision"', '"Annual plan"'], ['"Launch moved to Nov 12"', '"Task"', '"Draft launch email"'], ['"Maya owns the pricing page"', '"Person"', '"Maya"']],
  },
  {
    id: 'code', icon: 'code', title: 'Codebase context', ask: 'Ask which functions break if you change parse_config().', db: 'repo.rl',
    q: 'Which functions break if I change parse_config()?',
    cypher: ["MATCH (f:Function)-[:CALLS*1..3]->(:Function {name: 'parse_config'})", 'RETURN DISTINCT f.name AS function, f.file AS file'],
    cols: ['function', 'file'],
    rows: [['"load_settings"', '"config/loader.py"'], ['"start_server"', '"app/main.py"'], ['"run_migrations"', '"db/migrate.py"']],
  },
  {
    id: 'recs', icon: 'sparkles', title: 'Recommendations', ask: 'Ask what to suggest to a reader who liked Dune.', db: 'books.rl',
    q: 'What should I suggest to a reader who liked Dune?',
    cypher: ["MATCH (:Book {title: 'Dune'})-[:ABOUT]->(t:Theme)<-[:ABOUT]-(rec:Book)", "WHERE rec.title <> 'Dune'", 'RETURN rec.title AS book, collect(t.name) AS shared, count(t) AS overlap', 'ORDER BY overlap DESC, book'],
    cols: ['book', 'shared', 'overlap'],
    rows: [['"Hyperion"', '["religion", "empire"]', '2'], ['"Annihilation"', '["ecology"]', '1'], ['"Foundation"', '["empire"]', '1']],
  },
];

export interface Preset {
  id: 'mem' | 'code' | 'recs';
  title: string;
  /** The opening statement, then the follow-up statements the playback types in. */
  statements: string[];
}

export const PRESETS: Preset[] = [
  {
    id: 'mem', title: 'Org chart',
    statements: [
      "CREATE (maya:Person {name: 'Maya'})-[:REPORTS_TO]->(sam:Person {name: 'Sam'}),\n       (alex:Person {name: 'Alex'})-[:REPORTS_TO]->(sam),\n       (sam)-[:LEADS]->(:Team {name: 'Platform'});",
      "MATCH (a {name: 'Maya'}) CREATE (a)-[:MENTORS]->(:Person {name: 'Priya'});",
      "MATCH (a {name: 'Sam'}) CREATE (a)-[:LEADS]->(:Team {name: 'Design'});",
      "MATCH (a {name: 'Alex'}) CREATE (a)-[:MEMBER_OF]->(:Team {name: 'Infra'});",
    ],
  },
  {
    id: 'code', title: 'Dependencies',
    statements: [
      "CREATE (api:Service {name: 'api'})-[:DEPENDS_ON]->(auth:Service {name: 'auth'}),\n       (api)-[:DEPENDS_ON]->(db:Service {name: 'postgres'}),\n       (auth)-[:DEPENDS_ON]->(db);",
      "MATCH (a {name: 'api'}) CREATE (a)-[:DEPENDS_ON]->(:Service {name: 'queue'});",
      "MATCH (a {name: 'auth'}) CREATE (a)-[:DEPENDS_ON]->(:Service {name: 'redis'});",
      "MATCH (a {name: 'postgres'}) CREATE (a)-[:BACKED_UP_BY]->(:Service {name: 'storage'});",
    ],
  },
  {
    id: 'recs', title: 'Knowledge base',
    statements: [
      "CREATE (pricing:Doc {name: 'Pricing'})-[:LINKS_TO]->(faq:Doc {name: 'Billing FAQ'}),\n       (pricing)-[:COVERS]->(plans:Topic {name: 'Plans'}),\n       (faq)-[:COVERS]->(:Topic {name: 'Invoices'});",
      "MATCH (a {name: 'Pricing'}) CREATE (a)-[:COVERS]->(:Topic {name: 'Trials'});",
      "MATCH (a {name: 'Billing FAQ'}) CREATE (a)-[:LINKS_TO]->(:Doc {name: 'Refunds'});",
      "MATCH (a {name: 'Plans'}) CREATE (a)-[:RELATED_TO]->(:Topic {name: 'Limits'});",
    ],
  },
];

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Cypher highlighting for the terminal: strings, keywords, relationship types, labels, functions. */
export function hl(code: string): string {
  return esc(code).replace(
    /('[^']*')|\b(OPTIONAL MATCH|MATCH|WHERE|RETURN|CREATE|MERGE|SET|ORDER BY|LIMIT|DISTINCT|AS|DESC|IN)\b|((?<=\[):[A-Za-z_]+)|(:[A-Z][A-Za-z_]*)|\b(count|collect|labels|nodes)(?=\()/g,
    (m, str, kw, rel, label, fn) => (str ? `<span class="s">${m}</span>` : kw || fn ? `<span class="k">${m}</span>` : rel ? `<span class="r">${m}</span>` : label ? `<span class="n">${m}</span>` : m),
  );
}

/** The editor's highlighting: the same, with any other `:Name` as a label. */
export function hlEditor(code: string): string {
  return esc(code).replace(
    /('[^']*')|\b(OPTIONAL MATCH|MATCH|WHERE|RETURN|CREATE|MERGE|SET|ORDER BY|LIMIT|DISTINCT|AS|DESC|IN)\b|((?<=\[):[A-Za-z_]+)|(:[A-Z][A-Za-z_]*)/g,
    (m, str, kw, rel) => (str ? `<span class="s">${m}</span>` : kw ? `<span class="k">${m}</span>` : rel ? `<span class="r">${m}</span>` : `<span class="n">${m}</span>`),
  );
}

export const table = (cols: string[], rows: string[][]): string =>
  '<table class="res"><thead><tr>' + cols.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>' +
  rows.map((r) => '<tr>' + r.map((v, i) => `<td${i === 0 ? ' class="n"' : ''}>${esc(v)}</td>`).join('') + '</tr>').join('') +
  `</tbody></table><div class="res-meta">${rows.length} rows</div>`;

/** One terminal line per entry; `fade` is added for the animated playback. */
export function scenarioLines(s: Scenario, fade = false): string[] {
  const f = fade ? ' fade' : '';
  return [
    `<div class="tl${f}"><span class="dm">you</span> ${esc(s.q)}</div>`,
    `<div class="tl dm${f}">agent writes:</div>`,
    ...s.cypher.map((l) => `<div class="tl${f}"><span class="dm">relate&gt;</span> ${hl(l)}</div>`),
    `<div class="tl${f}">${table(s.cols, s.rows)}</div>`,
  ];
}

const grid = (rows: string[], cls: string, h: number): string => {
  const w = rows[0].length;
  let d = '';
  rows.forEach((row, y) => { for (let x = 0; x < w; x++) if (row[x] === '#') d += `M${x} ${y}h1v1h-1z`; });
  return `<svg class="${cls}" viewBox="0 0 ${w} ${rows.length}" height="${h}" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
};

const SCENARIO_ICONS: Record<Scenario['icon'], string[]> = {
  brain: ['###......###', '###......###', '###......###', '...#....#...', '....#..#....', '.....##.....', '.....##.....', '....####....', '....####....', '....####....'],
  code: ['............', '...#....#...', '..#....#.#..', '.#....#...#.', '#....#.....#', '.#..#.....#.', '..#.#....#..', '...#....#...', '............'],
  sparkles: ['.....#.....', '.....#.....', '....###....', '###########', '.#########.', '..#######..', '...#####...', '...##.##...', '..##...##..', '..#.....#..'],
};
const PRESET_ICONS: Record<Preset['id'], string[]> = {
  mem: ['....###....', '....#.#....', '....###....', '.....#.....', '.#########.', '.#...#...#.', '###.###.###', '#.#.#.#.#.#', '###.###.###'],
  code: ['###########', '#.........#', '###########', '.....#.....', '###########', '#.........#', '###########', '.....#.....', '###########', '#.........#', '###########'],
  recs: ['.######...', '.#....##..', '.#....#.#.', '.#....####', '.#.......#', '.#.#####.#', '.#.......#', '.#.#####.#', '.#.......#', '.#.###...#', '.#.......#', '.#########'],
};

export const scenarioIcon = (k: Scenario['icon']): string => grid(SCENARIO_ICONS[k], 'dmo-px', 20);
export const presetIcon = (k: Preset['id']): string => grid(PRESET_ICONS[k], 'lg-px', 16);
