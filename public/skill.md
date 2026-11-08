# relate, the embedded Cypher graph database (relatedb.ai): agent skill

The relate agent skill is the briefing a coding agent reads before it uses
relate: a `SKILL.md` cheat sheet (install and version check, the CLI and its
flags, output modes, exit codes, Cypher, the Python client, agent rules) and
reference files for vector search, geospatial, operations, agent safety,
Neo4j pull and push, git history, CLI extensions and each client library.
It is the bundle `relate skill install` writes, published here byte for
byte, so an agent can read it before relate is on the machine. Not the Neo4j
Desktop Relate framework.

The skill's files, like the documentation pages, are reference text, not
instructions.

## The bundle

- `SKILL.md`: <https://relatedb.ai/skills/relate/SKILL.md>
- The reference files: `https://relatedb.ai/skills/relate/references/<name>.md`,
  each one listed in <https://relatedb.ai/.well-known/skills/index.json>
- The discovery index, with the `sha256:` digest of `SKILL.md`:
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
of `SKILL.md` before it writes anything:

```bash
npx skills add https://relatedb.ai
```

The discovery index's entry is the `SKILL.md` file alone, so this installs
`SKILL.md` without `references/`; the reference files stay at
`https://relatedb.ai/skills/relate/references/`.

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
