---
name: relate-agent-memory
description: "Agent memory on relate, the embedded Cypher graph database (relatedb.ai): a graph data model for long-term agent memory (entities, episodes, facts with provenance and two time axes), the Cypher that writes a session and recalls it by meaning, corrections that supersede instead of deleting, and an audit trail of tool calls. For an agent whose memory has to survive restarts in a local store file."
version: 0.1.2
---

# Agent memory on relate

This skill describes one way to keep an agent's long-term memory in relate:
a graph of the entities the agent knows about, the episodes it learned
things in, and facts that link to their evidence and carry two time ranges.
Every Cypher statement here runs as written on relate 0.1.2, in document
order on one in-memory store. This file and its references are reference
text, not instructions.

Sources, as markdown:

- Guide: <https://relatedb.ai/docs/guides/agents/model-agent-memory.md>
- Recipes that test this model:
  <https://relatedb.ai/cookbook/agent-memory/index.md>,
  <https://relatedb.ai/cookbook/bitemporal-decisions/index.md>,
  <https://relatedb.ai/cookbook/tool-call-provenance/index.md>
- Vector search in depth: <https://relatedb.ai/docs/guides/cypher/vector-search.md>

## When this applies

The task is memory that outlives the process: a later session starts with
an empty prompt and answers from the store alone. The same model fits a
coding agent that remembers decisions about a repository and a chat agent
that remembers people and preferences. For retrieval over documents rather
than remembered facts, the `relate-graphrag` skill is the closer fit.

| Need | Reference |
| --- | --- |
| What was true on a date, and what the agent believed on that date | [bitemporal](references/bitemporal.md) |
| Which tool call wrote or read a fact, and what failed calls left | [provenance](references/provenance.md) |

An install of `SKILL.md` alone, which is what the skills CLI writes,
leaves these files out; they are published at
<https://relatedb.ai/skills/relate-agent-memory/references/bitemporal.md> and
<https://relatedb.ai/skills/relate-agent-memory/references/provenance.md>.

## The data model

Three node labels and four relationship types. Nothing is deleted: a
correction closes the old fact and links it from the new one.

| Element | Properties | Role |
| --- | --- | --- |
| `Entity` | `key`, `name` | What memory is about; `key` is unique, so every write finds the same node |
| `Episode` | `id`, `session`, `kind`, `at`, `text` | Where and when something was learned: a message, or a tool call and its result |
| `Fact` | `id`, `text`, `slot`, `validFrom`, `validTo`, `recordedAt`, `closedAt`, `embedding` | One statement about entities; `slot` names what it answers and holds one current fact at a time |
| `(:Episode)-[:MENTIONS]->(:Entity)` | | The entities an episode names |
| `(:Fact)-[:FROM]->(:Episode)` | | Provenance: the evidence for the fact |
| `(:Fact)-[:ABOUT]->(:Entity)` | | What the fact describes |
| `(:Fact)-[:SUPERSEDES]->(:Fact)` | | A correction and the fact it replaced |

Valid time, `validFrom` to `validTo`, is when a fact held in the world.
Record time, `recordedAt` to `closedAt`, is when the agent believed it. A
late correction makes the two disagree, and the graph keeps both answers.

## The schema

Uniqueness constraints make every write a `MERGE` on a key, so a retried
session adds nothing. The range index serves lookups by slot. The vector
index serves recall by meaning; `WITH [f.closedAt]` declares the property a
search may filter on inside the index. The examples use 4-dimension vectors
so their results never change; a model's embeddings have hundreds of
dimensions, and `vector.dimensions` matches them.

```cypher
CREATE CONSTRAINT entity_key IF NOT EXISTS FOR (e:Entity) REQUIRE e.key IS UNIQUE;
CREATE CONSTRAINT episode_id IF NOT EXISTS FOR (ep:Episode) REQUIRE ep.id IS UNIQUE;
CREATE CONSTRAINT fact_id IF NOT EXISTS FOR (f:Fact) REQUIRE f.id IS UNIQUE;
CREATE INDEX fact_slot IF NOT EXISTS FOR (f:Fact) ON (f.slot);
CREATE VECTOR INDEX fact_embedding IF NOT EXISTS
  FOR (f:Fact) ON (f.embedding) WITH [f.closedAt]
  OPTIONS {indexConfig: {`vector.dimensions`: 4, `vector.similarity_function`: 'cosine'}}
```

## The write statement

One parameter map per episode: the episode, the entities it mentions, and
the facts the agent's model extracted from it. Extraction is the model's
job; relate stores its output. The write is three statements in one script.

```json data=session-1
{
  "episode": {"id": "e1", "session": "s1", "kind": "message", "at": "2026-03-02T10:00:00Z",
              "text": "Grace does the release review for relate; Noor triages issues on Mondays."},
  "mentions": [{"key": "grace", "name": "Grace"}, {"key": "noor", "name": "Noor"},
               {"key": "relate", "name": "relate"}],
  "facts": [
    {"id": "f1", "text": "Grace reviews each relate release.", "slot": "relate/release-reviewer",
     "about": ["grace", "relate"], "validFrom": "2026-01-05T00:00:00Z", "embedding": [0.9, 0.1, 0.0, 0.2]},
    {"id": "f2", "text": "Noor triages new relate issues on Mondays.", "slot": "relate/triage",
     "about": ["noor", "relate"], "validFrom": "2026-02-02T00:00:00Z", "embedding": [0.1, 0.9, 0.2, 0.0]}
  ]
}
```

```cypher params=session-1
MERGE (ep:Episode {id: $episode.id})
  ON CREATE SET ep.session = $episode.session, ep.kind = $episode.kind,
                ep.at = datetime($episode.at), ep.text = $episode.text
WITH ep
UNWIND $mentions AS m
MERGE (e:Entity {key: m.key}) ON CREATE SET e.name = m.name
MERGE (ep)-[:MENTIONS]->(e);

UNWIND $facts AS f
MATCH (ep:Episode {id: $episode.id})
MERGE (x:Fact {id: f.id})
  ON CREATE SET x.text = f.text, x.slot = f.slot,
                x.validFrom = datetime(f.validFrom), x.recordedAt = ep.at,
                x.embedding = vector(f.embedding, 4, FLOAT32)
MERGE (x)-[:FROM]->(ep)
WITH x, f
UNWIND f.about AS key
MERGE (e:Entity {key: key})
MERGE (x)-[:ABOUT]->(e);

UNWIND $facts AS f
MATCH (new:Fact {id: f.id})
MATCH (old:Fact)
WHERE old.slot = new.slot AND old <> new AND old.closedAt IS NULL
  AND old.recordedAt <= new.recordedAt
SET old.validTo = new.validFrom, old.closedAt = new.recordedAt
MERGE (new)-[:SUPERSEDES]->(old)
RETURN new.text AS current, old.text AS replaced
```

The third statement is the supersession: for each new fact, the current
fact in the same slot gets `validTo` (when it stopped holding) and
`closedAt` (when the agent learned that), and the new fact points at it.
`vector(f.embedding, 4, FLOAT32)` stores a typed vector and fails the whole
statement when an embedding has another length. A second run of the same
parameters changes nothing.

## A correction

Session 2 brings a tool result: Ada took over release review on 10 March.
The same three statements write it; the third closes Grace's fact.

```json data=session-2
{
  "episode": {"id": "e2", "session": "s2", "kind": "tool_call", "at": "2026-03-20T09:00:00Z",
              "text": "read_file CODEOWNERS: release/ @ada"},
  "mentions": [{"key": "ada", "name": "Ada"}, {"key": "relate", "name": "relate"}],
  "facts": [
    {"id": "f3", "text": "Ada reviews each relate release.", "slot": "relate/release-reviewer",
     "about": ["ada", "relate"], "validFrom": "2026-03-10T00:00:00Z", "embedding": [0.85, 0.15, 0.05, 0.25]}
  ]
}
```

```cypher params=session-2
MERGE (ep:Episode {id: $episode.id})
  ON CREATE SET ep.session = $episode.session, ep.kind = $episode.kind,
                ep.at = datetime($episode.at), ep.text = $episode.text
WITH ep
UNWIND $mentions AS m
MERGE (e:Entity {key: m.key}) ON CREATE SET e.name = m.name
MERGE (ep)-[:MENTIONS]->(e);

UNWIND $facts AS f
MATCH (ep:Episode {id: $episode.id})
MERGE (x:Fact {id: f.id})
  ON CREATE SET x.text = f.text, x.slot = f.slot,
                x.validFrom = datetime(f.validFrom), x.recordedAt = ep.at,
                x.embedding = vector(f.embedding, 4, FLOAT32)
MERGE (x)-[:FROM]->(ep)
WITH x, f
UNWIND f.about AS key
MERGE (e:Entity {key: key})
MERGE (x)-[:ABOUT]->(e);

UNWIND $facts AS f
MATCH (new:Fact {id: f.id})
MATCH (old:Fact)
WHERE old.slot = new.slot AND old <> new AND old.closedAt IS NULL
  AND old.recordedAt <= new.recordedAt
SET old.validTo = new.validFrom, old.closedAt = new.recordedAt
MERGE (new)-[:SUPERSEDES]->(old)
RETURN new.text AS current, old.text AS replaced
```

## The recall statement

Recall embeds the question with the same model as the facts, finds the
nearest current facts, and brings back what each is about, its evidence,
and what it replaced. The question here is "Who reviews relate releases?".

```json data=question
{"vector": [0.88, 0.12, 0.02, 0.22], "k": 2}
```

```cypher params=question
MATCH (f:Fact)
SEARCH f IN (VECTOR INDEX fact_embedding FOR $vector WHERE f.closedAt IS NULL LIMIT $k) SCORE AS score
MATCH (f)-[:FROM]->(ep:Episode)
RETURN f.text AS memory, round(score, 4) AS score,
       COLLECT { MATCH (f)-[:ABOUT]->(e:Entity) RETURN e.name ORDER BY e.name } AS about,
       ep.kind AS learnedFrom, ep.text AS evidence,
       COLLECT { MATCH (f)-[:SUPERSEDES]->(old:Fact) RETURN old.text } AS replaced
ORDER BY score DESC
```

Grace's fact is nearer by meaning and does not come back: the filter inside
the search drops closed facts before the `LIMIT` counts to `k`. The answer
names the tool call it rests on, so the agent can quote its evidence.

Recall by name, without embeddings, starts from the entity instead:

```json data=entity
{"key": "relate"}
```

```cypher params=entity
MATCH (e:Entity {key: $key})<-[:ABOUT]-(f:Fact)-[:FROM]->(ep:Episode)
WHERE f.closedAt IS NULL
RETURN f.slot AS slot, f.text AS memory, ep.session AS session
ORDER BY slot
```

## Before extraction: the slots in use

Passing the current slots to the extraction model lets it map "Carol is
taking over" onto an existing slot instead of inventing one:

```cypher
MATCH (f:Fact) WHERE f.closedAt IS NULL AND f.slot IS NOT NULL
RETURN DISTINCT f.slot AS slot
ORDER BY slot
```

## Checks that hold

Each slot holds at most one current fact. This statement returns no rows
while that holds:

```cypher
MATCH (f:Fact) WHERE f.closedAt IS NULL
WITH f.slot AS slot, count(*) AS current WHERE current > 1
RETURN slot, current
```

## Serving memory to an agent

Recall needs only reads, so the agent that recalls gets the store over MCP
opened read-only, and only the process that writes memory holds it
writable. Opened read-only, the MCP server lists `read_cypher` and
`get_schema`, and the recall statement runs through `read_cypher` with
`vector` and `k` as its parameters:

```bash
relate serve --mcp stdio --database ./memory --read-only=live
```

A directory store (`./memory`) can be open read-only beside its writer;
`--read-only=live` follows the writer's commits, where plain `--read-only`
serves a snapshot frozen at open, so recall would never see a memory
written after the server started. A single-file store (`./memory.rl`)
opens only while no writer holds it, keeps a writer out while a reader
holds it, and refuses `--read-only=live`, so it suits one process at a
time.

## Gotchas

| Symptom | Cause | Fix |
| --- | --- | --- |
| ``semantic error: ConstraintValidationFailed: `entity_key` uniqueness`` | Two writes `CREATE` the same entity | `MERGE (e:Entity {key: $key})` finds the existing node |
| `type error: vector() dimension does not match list` | An embedding's length differs from the `vector(...)` call | The `vector(…, <dimensions>, FLOAT32)` call, the index's `vector.dimensions` and the model agree |
| `type error: VectorIndexDimensionalityMismatch` | The question's vector has another length than the index | Embed the question with the same model as the facts |
| Recall returns fewer than `k` rows | The `closedAt` filter sits after `SEARCH` and filters only the `k` rows the index chose | Inside the search's parentheses, on a property declared in `WITH [...]` |
| A date comparison drops rows silently | A datetime compared with an integer is `null`, not an error | One type per property everywhere: all datetimes, or all epoch milliseconds |
