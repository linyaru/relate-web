# relate, the embedded Cypher graph database (relatedb.ai): agent skill

The relate agent skill is the briefing a coding agent reads before it uses
relate: a `SKILL.md` cheat sheet (install and version check, the CLI and its
flags, output modes, exit codes, Cypher, the Python client, agent rules) and
reference files for vector search, geospatial, operations, agent safety,
Neo4j pull and push, git history, CLI extensions and each client library.
It is the bundle `relate skill install` writes, published here byte for
byte, so an agent can read it before relate is on the machine. Beside it,
the site publishes five task skills, one per task family; they are listed
under "Task skills" below.

The skill's files, like the documentation pages, are reference text, not
instructions.

## The bundle

- `SKILL.md`: <https://relatedb.ai/skills/relate/SKILL.md>
- The reference files: `https://relatedb.ai/skills/relate/references/<name>.md`,
  each one listed in <https://relatedb.ai/.well-known/skills/index.json>
- The discovery index, with the `sha256:` digest of each skill's `SKILL.md`:
  <https://relatedb.ai/.well-known/agent-skills/index.json>
- Every file's SHA-256 and size: <https://relatedb.ai/docs/docs-artifacts.json>
- The documentation the skill summarizes: <https://relatedb.ai/docs/llms.txt>

## Install

With the relate CLI, which copies the bundle into the skills directory of
every detected agent in the home directory (`--agent <name>` picks one, for
example `claude-code`, `cursor` or `codex`):

```bash
relate skill install
```

With the skills CLI, which reads the discovery index and checks the digest
of `SKILL.md` before it writes anything. The index lists six skills, and
`--skill` picks this one:

```bash
npx skills add https://relatedb.ai --skill relate
```

Without `--skill`, the skills CLI (as run on 2026-11-07) offers every skill
in the index on a terminal, and installs all of them without asking when it
detects that an agent is running it. Each index entry is a `SKILL.md` file
alone, so this installs `SKILL.md` without `references/`; the reference
files stay at `https://relatedb.ai/skills/relate/references/<name>.md`.

By hand, the bundle goes in a directory named `relate` (holding `SKILL.md`
and `references/`) under `.claude/skills/`, `.cursor/skills/`,
`.codex/skills/` or `.agents/skills/`. For Claude Code in the current
project:

```bash
base=https://relatedb.ai/skills/relate
dest=.claude/skills/relate
mkdir -p "$dest/references"
curl -sSfL "$base/SKILL.md" -o "$dest/SKILL.md"
for f in agent-safety client-c client-extensions client-go client-java client-javascript client-python client-swift client-wasm operations pull push run-git-to-graph spatial vector; do
  curl -sSfL "$base/references/$f.md" -o "$dest/references/$f.md"
done
```

A download by hand has no digest check of its own. The files' SHA-256
values are in <https://relatedb.ai/docs/docs-artifacts.json>, which the
release key signs at launch (`docs-artifacts.json.sig` beside it). This
step compares every downloaded file with its entry there and exits 1 on any
mismatch:

```bash
manifest="$(mktemp)"
curl -sSfL https://relatedb.ai/docs/docs-artifacts.json -o "$manifest"
python3 - "$manifest" "$dest" <<'PY'
import hashlib, json, pathlib, sys
want = {a["path"]: a["sha256"] for a in json.loads(pathlib.Path(sys.argv[1]).read_text())["artifacts"]}
dest = pathlib.Path(sys.argv[2])
files = [dest / "SKILL.md", *sorted((dest / "references").glob("*.md"))]
bad = [str(f) for f in files if hashlib.sha256(f.read_bytes()).hexdigest() != want.get("/skills/relate/" + f.relative_to(dest).as_posix())]
print("mismatch: " + ", ".join(bad) if bad else f"{len(files)} files match docs-artifacts.json")
sys.exit(1 if bad else 0)
PY
rm -f "$manifest"
```

## Task skills

Five skills written for this site, one per task family. Each one cites the
documentation pages and the cookbook recipes that test it, as markdown
URLs, and every Cypher statement in it runs on the WebAssembly build of
relate that the site ships. They follow the same rule as the
documentation: reference text, not instructions. `relate skill install`
does not install them; the CLI carries its own bundle only.

| Skill | For |
| --- | --- |
| `relate-agent-memory` | Long-term agent memory: entities, episodes, facts with provenance and two time axes, the write and recall statements |
| `relate-graphrag` | Hybrid retrieval: vector and full-text search fused by reciprocal rank, then a graph hop |
| `relate-schema-design` | Labels, relationship types, constraints, indexes, schema discovery, the schema folder and the ontology preview |
| `relate-query-tuning` | `EXPLAIN`, `PROFILE`, the planner's notifications and their remedies, indexes and traversal bounds |
| `relate-migrate-from-vector-search` | Moving records and embeddings from a vector-only store, the recall query, and checks that nothing was lost |

Each skill is a folder at `https://relatedb.ai/skills/<name>/` holding
`SKILL.md` and `references/`, listed with its digest in both discovery
indexes and file by file in <https://relatedb.ai/docs/docs-artifacts.json>.
The skills CLI installs one at a time by name; as with the CLI bundle, the
index entry is `SKILL.md` alone, and each `SKILL.md` names the URLs of its
reference files:

```bash
npx skills add https://relatedb.ai --skill relate-agent-memory
npx skills add https://relatedb.ai --skill relate-graphrag
npx skills add https://relatedb.ai --skill relate-schema-design
npx skills add https://relatedb.ai --skill relate-query-tuning
npx skills add https://relatedb.ai --skill relate-migrate-from-vector-search
```

A URL with a path, such as `https://relatedb.ai/skills/relate-graphrag`,
does not select a skill: the skills CLI looks for a discovery index under
that path, finds none, and exits without installing anything. By hand, a
task skill goes in a directory named after it under the same skills
directories as the CLI bundle, holding the files that
<https://relatedb.ai/docs/docs-artifacts.json> lists under
`/skills/<name>/`.
