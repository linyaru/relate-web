# The SEARCH clause: every form

relate searches two kinds of index. A vector index answers "which entities
are nearest to this vector" with an approximate nearest-neighbor search
over a Hierarchical Navigable Small World (HNSW) graph; a full-text index
answers "which entities contain these words". The `SEARCH` clause restricts
a `MATCH` to an index's top results and names their score. The statements
below run in order on one in-memory store, on relate 0.16.1.

Sources: <https://relatedb.ai/docs/reference/cypher/search.md> (every rule,
option, default and error message) and
<https://relatedb.ai/cookbook/hybrid-recall/index.md> (fusion over 40 notes).

## Synopsis

```text
MATCH <pattern that binds var>
SEARCH <var> IN (
  VECTOR INDEX <name> FOR <query vector> [WHERE <filter>] LIMIT <k>
) [SCORE AS <score var>]

MATCH <pattern that binds var>
SEARCH <var> IN (
  FULLTEXT INDEX <name> FOR <query string> [SKIP <n> | OFFSET <n>] LIMIT <k>
) [SCORE AS <score var>]
```

## Node and relationship indexes

A small graph: notes with a vector and a text, and decisions recorded on a
relationship with their own text.

```cypher
CREATE VECTOR INDEX note_e IF NOT EXISTS
  FOR (n:Note) ON (n.embedding) WITH [n.session]
  OPTIONS {indexConfig: {`vector.dimensions`: 3, `vector.similarity_function`: 'cosine'}};
CREATE FULLTEXT INDEX note_t IF NOT EXISTS FOR (n:Note) ON EACH [n.text];
CREATE FULLTEXT INDEX decided_t IF NOT EXISTS FOR ()-[r:DECIDED]-() ON EACH [r.text];
CREATE (a:Note {id: 'n1', session: 's1', text: 'One Kafka topic per tenant for ticket events',
                embedding: vector([0.9, 0.1, 0.2], 3, FLOAT32)}),
       (b:Note {id: 'n2', session: 's2', text: 'Shared Kafka topics keyed by tenant id',
                embedding: vector([0.8, 0.3, 0.1], 3, FLOAT32)}),
       (c:Note {id: 'n3', session: 's2', text: 'Invoices run nightly from usage events',
                embedding: vector([0.1, 0.2, 0.9], 3, FLOAT32)}),
       (t:Topic {name: 'kafka'}),
       (a)-[:DECIDED {text: 'one Kafka topic per tenant', ts: 1772409600000}]->(t),
       (b)-[:DECIDED {text: 'shared Kafka topics keyed by tenant id', ts: 1773014400000}]->(t)
```

A vector search filtered inside the search, on a property the index
declares in `WITH [...]`:

```cypher
MATCH (n:Note)
SEARCH n IN (VECTOR INDEX note_e FOR [0.85, 0.2, 0.15] WHERE n.session = 's2' LIMIT 2) SCORE AS s
RETURN n.id AS note, round(s, 4) AS score
ORDER BY score DESC
```

A relationship search binds the relationship variable of a single-hop
pattern. The arrow matters: an undirected pattern matches each relationship
once per direction, so every hit comes back twice.

```cypher
MATCH ()-[r:DECIDED]->()
SEARCH r IN (FULLTEXT INDEX decided_t FOR 'tenant shared' LIMIT 5) SCORE AS s
RETURN startNode(r).id AS note, r.text AS decision, s AS score
ORDER BY score DESC, note
```

## The intersection form

Two searches on the same variable, the second after a `WITH`, keep only the
entities both returned. This is an intersection, not a fusion: an entity
that only one search found is dropped.

```cypher
MATCH (n:Note)
SEARCH n IN (VECTOR INDEX note_e FOR [0.85, 0.2, 0.15] LIMIT 2) SCORE AS vs
WITH n, vs
MATCH (n)
SEARCH n IN (FULLTEXT INDEX note_t FOR 'tenant' LIMIT 3) SCORE AS fs
RETURN n.id AS note, round(vs, 4) AS vector, fs AS fulltext
ORDER BY note
```

## COMBINE, a preview

`SEARCH <var> IN (COMBINE (<source> WEIGHT <w>, …) USING WRRF [WITH CONSTANT <c>] LIMIT <k>)`
fuses two or more sources by weighted reciprocal rank in the clause itself.
It is a preview: without `RELATE_PREVIEW=hybrid-search` in the process
environment it fails with `semantic error: SemanticError: preview feature
'hybrid-search' is not enabled: set RELATE_PREVIEW=hybrid-search`. The
WebAssembly build has no way to set it, so on the browser and in the
cookbook the plain-Cypher fusion of the skill's main file is the form that
runs. An entity's fused score is the sum over the sources of
`weight / (constant + rank + 1)`, with `rank` counting from 0; `WEIGHT`
defaults to 1 and `WITH CONSTANT` to 60.

On the CLI, against a store that holds the chunks and indexes of the
skill's main file, opened read-only:

```bash
RELATE_PREVIEW=hybrid-search relate --database ./chunks.rl --read-only --mode table "MATCH (c:Chunk) SEARCH c IN (COMBINE (VECTOR INDEX chunk_embedding FOR [0.82, 0.28, 0.02, 0.1] LIMIT 3 WEIGHT 0.7, FULLTEXT INDEX chunk_text FOR 'revoking tokens' LIMIT 3 WEIGHT 0.3) USING WRRF LIMIT 3) SCORE AS score RETURN c.id AS chunk, score"
```

## The procedure forms

`db.index.vector.queryNodes`, `db.index.vector.queryRelationships`,
`db.index.fulltext.queryNodes` and `db.index.fulltext.queryRelationships`
exist and are deprecated. `EXPLAIN` reports notification `01N01` with the
remedy ``Use the `SEARCH` clause instead.``; the vector procedures take no
filter, and the full-text procedures treat the whole query string as one
term:

```cypher
EXPLAIN CALL db.index.vector.queryNodes('note_e', 2, [0.85, 0.2, 0.15]) YIELD node, score
RETURN node.id AS note, score
```

## Errors an agent meets

| Message | Cause |
| --- | --- |
| ``syntax error: parse error: expected LIMIT, got ")" (RightParen)`` | A search without `LIMIT` |
| `WrongPropertyForVectorSearchFilter` | A vector-search filter on a property the index does not declare in `WITH [...]` |
| ``syntax error: InvalidUseOfCommand: WHERE cannot be used together with 'FULLTEXT INDEX'`` | A `WHERE` inside a full-text search |
| `type error: VectorIndexDimensionalityMismatch` | The query vector's length differs from `vector.dimensions` |
| `type error: vector() dimension does not match list` | A `vector(<list>, <n>, FLOAT32)` call whose list has another length |
| `syntax error: UndefinedVariable: variable 'score' not defined` | The score read without `SCORE AS score` |
