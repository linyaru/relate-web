# Proving a migration lost nothing

A migration can import the right number of records and still lose data: an
embedding of the wrong length, a filter property under another name, a
relationship that never got made. The probes below compare what arrived
with what the source held, before the old store is retired. They run in
order on one in-memory store, on relate 0.1.2.

Sources: <https://relatedb.ai/cookbook/migration-rehearsal/index.md> (count
probes and per-node fingerprints that catch a bug node counts miss) and
<https://relatedb.ai/cookbook/hybrid-recall/index.md> (the typed vector as a
write guard).

## A small imported store

The second chunk arrived with a three-element list where the index expects
four, the failure a typed vector refuses at write time and a plain list
lets through:

```cypher
CREATE VECTOR INDEX chunk_embedding IF NOT EXISTS
  FOR (c:Chunk) ON (c.embedding) WITH [c.source]
  OPTIONS {indexConfig: {`vector.dimensions`: 4, `vector.similarity_function`: 'cosine'}};
CREATE (:Chunk {id: 'a1', source: 'wiki', embedding: vector([0.9, 0.1, 0.0, 0.1], 4, FLOAT32)}),
       (:Chunk {id: 'a2', source: 'wiki', embedding: [0.8, 0.2, 0.1]}),
       (:Chunk {id: 'a3', source: 'tickets', embedding: vector([0.7, 0.3, 0.2, 0.0], 4, FLOAT32)}),
       (:Chunk {id: 'a4', embedding: vector([0.0, 0.1, 0.9, 0.3], 4, FLOAT32)})
```

## Counts against the source

The source's record count, and per metadata value, against relate's. A
source count is passed in as a parameter:

```json data=source
{"total": 4, "bySource": {"wiki": 2, "tickets": 1, "none": 1}}
```

```cypher params=source
MATCH (c:Chunk)
WITH coalesce(c.source, 'none') AS source, count(*) AS n
WITH collect({source: source, n: n}) AS got
UNWIND keys($bySource) AS source
WITH source, $bySource[source] AS expected,
     coalesce(head([g IN got WHERE g.source = source | g.n]), 0) AS actual
RETURN source, expected, actual, expected = actual AS ok
ORDER BY source
```

## Every embedding is a vector of the right length

A search skips a property whose length differs from `vector.dimensions`
without an error, so the count above stays right while recall loses the
node. A type predicate finds every such node:

```cypher
MATCH (c:Chunk)
WHERE NOT c.embedding IS :: VECTOR<FLOAT32>(4)
RETURN c.id AS id, valueType(c.embedding) AS stored
ORDER BY id
```

## Filter properties kept their names

A node whose filter property is missing never matches a filter on it.
Nodes without the property, per declared filter property:

```cypher
MATCH (c:Chunk) WHERE c.source IS NULL
RETURN count(c) AS withoutSource
```

## Self-recall

Every chunk searched with its own embedding comes back first, with score
1.0, unless two chunks share an embedding exactly. A chunk missing from its
own result is one the index does not hold:

```cypher
MATCH (x:Chunk) WHERE x.embedding IS :: VECTOR<FLOAT32>(4)
CALL (x) {
  MATCH (c:Chunk)
  SEARCH c IN (VECTOR INDEX chunk_embedding FOR x.embedding LIMIT 1) SCORE AS s
  RETURN c.id AS top, s
}
RETURN x.id AS id, top, round(s, 4) AS score, top = x.id AS ok
ORDER BY id
```

## Recall parity on known questions

The strongest check replays questions whose answers the old system gave:
the same query vectors, the same `k`, and the ids each returned. An answer
whose ids differ is either a missing node (the probes above find it) or a
tie: relate's search is exact, so ids differ only where two scores tie
(relate orders ties by element id) or where the old system's index was
approximate. An id missing from the top of the list is not that.

## A fingerprint before a change

The migration rehearsal recipe stores a `Probe` node per label and
relationship type with the count before and the count a change must leave,
and a `Fingerprint` node per entity with its properties and relationships,
so a later change is compared against a record instead of memory. The same
shape works after an import, before the first schema change on the new
store.
