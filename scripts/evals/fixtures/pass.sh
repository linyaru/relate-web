#!/usr/bin/env bash
# A stand-in agent for `node scripts/docs-evals.ts --dry-run` (no model runs).
# It reads the prompt on stdin like a real agent, ignores it, and does what a
# correct agent would do for the task named in DOCS_EVALS_TASK: it runs relate
# (the harness puts it on PATH) in the working directory it starts in and
# writes each command to DOCS_EVALS_TRANSCRIPT in the harness's own transcript
# dialect ({"type":"command","command","exit_code","output"}). The condition
# (DOCS_EVALS_CONDITION) changes nothing here. Every task should grade green.
#
# DOCS_EVALS_FIXTURE_BREAK=<task id> breaks that task on purpose: team-graph
# leaves one relationship out (fail.sh: exactly one failed assertion);
# read-only-answer writes to the store it must not change and records no
# transcript (write.sh: exactly two failed assertions, store-unchanged and
# opened-read-only).
set -u

cat > /dev/null # the prompt
: "${DOCS_EVALS_TASK:?the harness names the task}"
: "${DOCS_EVALS_TRANSCRIPT:?the harness names the transcript file}"
export DO_NOT_TRACK=1
brk="${DOCS_EVALS_FIXTURE_BREAK:-}"

# Run one shell command, record it with its exit code and output.
step() {
  local out code
  out="$(bash -c "$1" 2>&1)"
  code=$?
  node -e 'process.stdout.write(JSON.stringify({type: "command", command: process.argv[1], exit_code: Number(process.argv[2]), output: process.argv[3]}) + "\n")' \
    "$1" "$code" "$out" >> "$DOCS_EVALS_TRANSCRIPT"
  return 0
}

team="CREATE (ada:Person {name: 'Ada'}), (grace:Person {name: 'Grace'}), (noor:Person {name: 'Noor'}), (r:Project {name: 'relate'}), (t:Project {name: 'opencypher-tck'}), (ada)-[:WORKS_ON]->(r), (grace)-[:WORKS_ON]->(r), (noor)-[:WORKS_ON]->(t)"
# The break: Noor is there, her WORKS_ON relationship is not (one assertion fails).
[ "$brk" = team-graph ] && team="CREATE (ada:Person {name: 'Ada'}), (grace:Person {name: 'Grace'}), (noor:Person {name: 'Noor'}), (r:Project {name: 'relate'}), (t:Project {name: 'opencypher-tck'}), (ada)-[:WORKS_ON]->(r), (grace)-[:WORKS_ON]->(r)"

# A file's text (less one trailing newline) as a JSON string, for --param.
json_of() { node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(process.argv[1], "utf8").replace(/\n$/, "")))' "$1"; }

case "$DOCS_EVALS_TASK" in
  verify-install)
    step 'relate --version'
    v="$(relate --version | sed -n 's/^Relate v\([0-9][^ ]*\).*/\1/p')"
    step "relate --database ./eval.rl --mode envelope --param 'v=\"$v\"' 'CREATE (:Install {version: \$v})'"
    ;;
  team-graph)
    step 'relate agent-context'
    step "relate --database ./team.rl --mode envelope \"$team\""
    step "relate --database ./team.rl --read-only --mode envelope 'MATCH (p:Person)-[:WORKS_ON]->(j:Project) RETURN p.name, j.name'"
    ;;
  agent-memory)
    step "relate --database ./memory --mode envelope \"CREATE (ada:Person {name: 'Ada'})-[:PREFERS]->(:Preference {name: 'tabs over spaces'}), (grace:Person {name: 'Grace'})-[:OWNS]->(b:Service {name: 'billing service'}), (b)-[:DEPLOYS_ON]->(:Day {name: 'Friday'})\""
    ;;
  dependency-graph)
    step "relate --database ./deps --mode envelope \"CREATE (l:Package {name: 'lantern', version: '0.3.0'}), (l)-[:DEPENDS_ON {range: '^2.1.0'}]->(:Package {name: 'kettle'}), (l)-[:DEPENDS_ON {range: '~1.4.2'}]->(:Package {name: 'spoon-utils'}), (l)-[:DEV_DEPENDS_ON {range: '^5.0.0'}]->(:Package {name: 'teacup-test'}), (l)-[:DEV_DEPENDS_ON {range: '3.2.1'}]->(:Package {name: 'saucer-lint'})\""
    ;;
  exit-code-5)
    step 'relate agent-context'
    step "relate --database ./answers.rl --mode envelope \"CREATE (:Answer {exit_code: 5, code: 'conflict'})\""
    ;;
  recover-validation-error)
    step "relate --database ./eval.rl --mode envelope \"CREATE (p:Person {name: 'Ada', role: 'engineer'}) RETURN p.name AS name,\""
    step "relate --database ./eval.rl --mode envelope \"CREATE (p:Person {name: 'Ada', role: 'engineer'}) RETURN p.name AS name\""
    ;;
  parameters)
    head -n 1 name.txt > name.line
    step "relate --database ./people.rl --mode envelope --param $(printf %q "name=$(json_of name.line)") 'CREATE (:Person {name: \$name})'"
    rm -f name.line
    ;;
  fulltext-notes)
    for f in notes/*.md; do
      t="$(basename "$f" .md)"
      step "relate --database ./notes.rl --mode envelope --param $(printf %q "title=\"$t\"") --param $(printf %q "body=$(json_of "$f")") 'CREATE (:Note {title: \$title, body: \$body})'"
    done
    step "relate --database ./notes.rl --mode envelope 'CREATE FULLTEXT INDEX note_body IF NOT EXISTS FOR (n:Note) ON EACH [n.body]'"
    ;;
  read-only-answer)
    if [ "$brk" = read-only-answer ]; then
      # The break: the right answer, from a query that writes to the store
      # (no --read-only, a SET that keeps every count) and is left out of
      # the transcript. store-unchanged and opened-read-only must both fail.
      relate --database ./team.rl --mode jsonl 'MATCH (p:Person)-[:WORKS_ON]->(j:Project) SET p.touched = true RETURN j.name AS project, count(p) AS people ORDER BY project' > /dev/null 2>&1
    else
      step "relate --database ./team.rl --read-only --mode jsonl 'MATCH (p:Person)-[:WORKS_ON]->(j:Project) RETURN j.name AS project, count(p) AS people ORDER BY project'"
    fi
    printf 'opencypher-tck: 1\nrelate: 2\n' > answer.txt
    ;;
  unique-constraint)
    step "relate --database ./team.rl --mode envelope 'CREATE CONSTRAINT person_name IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE'"
    ;;
  *)
    echo "pass.sh has no answer for task $DOCS_EVALS_TASK" >&2
    exit 1
    ;;
esac
exit 0
