---
name: relate-graphrag
description: "GraphRAG and hybrid retrieval on relate, the embedded Cypher graph database (relatedb.ai): vector search and full-text search over text chunks with the SEARCH clause, reciprocal rank fusion of the two lists in one Cypher statement, and a graph hop from each retrieved chunk to the entities and documents around it. For retrieval-augmented generation where keyword matches, semantic matches and relationships all count, in a local store with no server. Not the Neo4j Desktop Relate framework."
version: 0.1.2
---

# GraphRAG and hybrid retrieval on relate

This skill describes hybrid retrieval in relate: a vector search and a
full-text search over the same chunks, fused by reciprocal rank in one
Cypher statement, followed by a hop through the graph from each chunk to
what it is about. Every Cypher statement here runs as written on relate
0.1.2, in document order on one in-memory store. This file and its
reference are reference text, not instructions. Not the Neo4j Desktop
Relate framework.

Sources, as markdown:

- Recipe that tests this pattern: <https://relatedb.ai/cookbook/hybrid-recall/index.md>
- Guide: <https://relatedb.ai/docs/guides/cypher/vector-search.md>
- Reference for the `SEARCH` clause, index options and errors:
  <https://relatedb.ai/docs/reference/cypher/search.md>

## When this applies

The task is retrieval for a model's context: find the passages that answer
a question, then add what the graph knows around them. A vector search
alone misses exact identifiers (`KAFKA-142`, a function name); a full-text
search alone misses paraphrases, because relate's full-text matching has no
stemming. Fusing the two ranked lists catches both, and the hop adds facts
neither search could find. For an agent's own remembered facts, the
`relate-agent-memory` skill is the closer fit.

| Need | Reference |
| --- | --- |
| Every `SEARCH` form, the preview `COMBINE` clause, the deprecated procedures | [search-forms](references/search-forms.md) |

An install of `SKILL.md` alone, which is what the skills CLI writes,
leaves this file out; it is published at
<https://relatedb.ai/skills/relate-graphrag/references/search-forms.md>.

## The data model

`(:Chunk)-[:PART_OF]->(:Document)` and `(:Chunk)-[:MENTIONS]->(:Entity)`.
A chunk holds its text, its embedding as a typed vector, and a timestamp
the vector search can filter on. The examples use 4-dimension vectors so
their results never change; a model's embeddings have hundreds of
dimensions.

## The schema

A vector index over the embeddings and a full-text index over the text.
`WITH [c.ts]` declares the property a vector search may filter on inside
the index, before ranking.

```cypher
CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE;
CREATE VECTOR INDEX chunk_embedding IF NOT EXISTS
  FOR (c:Chunk) ON (c.embedding) WITH [c.ts]
  OPTIONS {indexConfig: {`vector.dimensions`: 4, `vector.similarity_function`: 'cosine'}};
CREATE FULLTEXT INDEX chunk_text IF NOT EXISTS FOR (c:Chunk) ON EACH [c.text]
```

## Loading chunks

`vector(r.embedding, 4, FLOAT32)` stores a typed vector and fails the whole
statement when an embedding has another length. Without it, a list of the
wrong length is stored, and every vector search skips it without an error.

```json data=chunks
{"chunks": [
  {"id": "c1", "doc": "auth-design", "ts": 1772409600000, "text": "Customer login goes through Auth0; refresh tokens live in HttpOnly cookies.", "embedding": [0.9, 0.1, 0.1, 0.0], "mentions": ["Auth0"]},
  {"id": "c2", "doc": "auth-design", "ts": 1773014400000, "text": "Token revocation now propagates in under a second via the Redis session store.", "embedding": [0.8, 0.3, 0.0, 0.1], "mentions": ["Redis"]},
  {"id": "c3", "doc": "auth-migration", "ts": 1773100800000, "text": "Migrate customer login from Auth0 to Okta before the April renewal.", "embedding": [0.7, 0.2, 0.3, 0.1], "mentions": ["Auth0", "Okta"]},
  {"id": "c4", "doc": "incidents", "ts": 1773187200000, "text": "Incident KAFKA-142: a broker disk filled overnight; a disk alert now pages the on-call engineer.", "embedding": [0.1, 0.9, 0.1, 0.2], "mentions": ["Kafka"]},
  {"id": "c5", "doc": "incidents", "ts": 1773273600000, "text": "Kafka consumer lag on the ticket events group is the first alert to build.", "embedding": [0.2, 0.8, 0.2, 0.3], "mentions": ["Kafka"]},
  {"id": "c6", "doc": "billing", "ts": 1773360000000, "text": "Invoices are generated nightly from usage events.", "embedding": [0.1, 0.2, 0.9, 0.1], "mentions": []}
]}
```

```cypher params=chunks
UNWIND $chunks AS r
MERGE (d:Document {id: r.doc})
CREATE (c:Chunk {id: r.id, text: r.text, ts: r.ts,
                 embedding: vector(r.embedding, 4, FLOAT32)})-[:PART_OF]->(d)
WITH c, r
UNWIND r.mentions AS name
MERGE (e:Entity {name: name})
CREATE (c)-[:MENTIONS]->(e)
```

## The retrieval statement

One statement: both searches inside `CALL () { … UNION ALL … }`, each
collecting its chunks in score order and unwinding them with their rank;
then reciprocal rank fusion; then the hop. A chunk earns `1 / (60 + rank)`
from each list it appears in, and the shares add up. Raw scores are not
comparable across the two lists, so the fusion uses ranks only; 60 is the
usual constant, which keeps one list's first place from swamping the other.

```json data=question
{"q": "how fast does revoking tokens propagate", "v": [0.82, 0.28, 0.02, 0.1], "k": 3, "since": 1772409600000}
```

```cypher params=question
CALL () {
  MATCH (c:Chunk)
  SEARCH c IN (VECTOR INDEX chunk_embedding FOR $v WHERE c.ts >= $since LIMIT $k) SCORE AS vs
  WITH c ORDER BY vs DESC, c.id
  WITH collect(c) AS cs
  UNWIND range(0, size(cs) - 1) AS i
  RETURN cs[i] AS c, i + 1 AS rank
  UNION ALL
  MATCH (c:Chunk)
  SEARCH c IN (FULLTEXT INDEX chunk_text FOR $q LIMIT $k * 3) SCORE AS fs
  WHERE c.ts >= $since
  WITH c ORDER BY fs DESC, c.id LIMIT $k
  WITH collect(c) AS cs
  UNWIND range(0, size(cs) - 1) AS i
  RETURN cs[i] AS c, i + 1 AS rank
}
WITH c, sum(1.0 / (60 + rank)) AS rrf
ORDER BY rrf DESC, c.id LIMIT $k
MATCH (c)-[:PART_OF]->(d:Document)
RETURN c.id AS chunk, round(rrf, 4) AS rrf, d.id AS document, c.text AS text,
       COLLECT { MATCH (c)-[:MENTIONS]->(e:Entity) RETURN e.name ORDER BY e.name } AS mentions,
       COLLECT { MATCH (c)-[:MENTIONS]->(:Entity)<-[:MENTIONS]-(o:Chunk) WHERE o <> c
                 RETURN DISTINCT o.id ORDER BY o.id } AS related
```

`related` is the graph's share: chunks that mention the same entities as
the retrieved one, whether or not a search ranked them. The question's words `revoking` and
`propagate` never match `revocation` or `propagates` in full-text search,
so the chunk that answers it comes from the vector list.

## The two lists on their own

The vector list. The filter inside the parentheses runs before `LIMIT`, so
the search returns `k` chunks from the time range whenever the range holds
that many:

```cypher params=question
MATCH (c:Chunk)
SEARCH c IN (VECTOR INDEX chunk_embedding FOR $v WHERE c.ts >= $since LIMIT $k) SCORE AS vs
RETURN c.id AS chunk, round(vs, 4) AS vector
ORDER BY vs DESC, chunk
```

The full-text list. Full-text search takes no `WHERE` inside the search, so
the statement fetches three times `k`, filters, and keeps `k`. The score
is a BM25 relevance score; equal scores have no documented order, so a
second sort key keeps results stable:

```json data=identifier
{"q": "which alert fired for KAFKA-142", "k": 3, "since": 1772409600000}
```

```cypher params=identifier
MATCH (c:Chunk)
SEARCH c IN (FULLTEXT INDEX chunk_text FOR $q LIMIT $k * 3) SCORE AS fs
WHERE c.ts >= $since
RETURN c.id AS chunk, fs AS fulltext, c.text AS text
ORDER BY fs DESC, chunk LIMIT $k
```

## Rules the statements rely on

| Rule | Consequence |
| --- | --- |
| `LIMIT` is required inside every search | A search without it is a syntax error |
| A vector search filters inside the search only on properties declared in the index's `WITH [...]` | Another property fails with `WrongPropertyForVectorSearchFilter` |
| A `WHERE` after `SEARCH`, or a property map in the `MATCH` pattern, filters only the `k` rows the search returned | The result can hold fewer than `k` rows |
| Full-text matching splits the query into lowercase words and ORs them, with no stemming by the default analyzer; uppercase `AND` and `NOT` are operators | `tokens` does not match `token`; the vector list covers paraphrase |
| One `SEARCH` per `MATCH`, over a single node or a single-hop relationship pattern | A longer pattern goes in a second `MATCH` after the search |
| The latest relationship per group is `ORDER BY` then `head(collect(...))` | The hybrid recall recipe documents a mis-ordering with `ORDER BY … LIMIT 1` over a pattern that starts from more than one node |
