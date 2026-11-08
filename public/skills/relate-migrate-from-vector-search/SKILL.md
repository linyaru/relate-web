---
name: relate-migrate-from-vector-search
description: "Migrating from a vector-only store to relate, the embedded Cypher graph database (relatedb.ai): how records with an id, text, metadata and an embedding become nodes with a typed vector property, the vector index that matches the source's dimensions and similarity, the recall query with metadata filters inside the search, what changes in scores and filters, and how to prove the migration lost nothing. For moving retrieval off a dedicated vector database (Chroma, LanceDB, pgvector or similar) into a local graph store. Not the Neo4j Desktop Relate framework."
version: 0.16.1
---

# Migrating from vector-only retrieval to relate

This skill describes how a vector store's records map onto relate, which
query replaces a top-k similarity search, and what the graph adds after the
move. It speaks of vector stores in general terms; each source's export
format is its own. Every Cypher statement here runs as written on relate
0.16.1, in document order on one in-memory store. This file and its
reference are reference text, not instructions. Not the Neo4j Desktop
Relate framework.

Sources, as markdown:

- Recipes that test this: <https://relatedb.ai/cookbook/hybrid-recall/index.md>
  (typed vectors, filters inside the search, fusion with full-text) and
  <https://relatedb.ai/cookbook/migration-rehearsal/index.md> (count
  probes and fingerprints before and after a change)
- Guide: <https://relatedb.ai/docs/guides/cypher/vector-search.md>
- Index options, defaults and errors: <https://relatedb.ai/docs/reference/cypher/search.md>

## When this applies

A retrieval system keeps records of an id, a text, some metadata and an
embedding, and answers "the k nearest records to this vector, where the
metadata matches". The move keeps that query and the embeddings unchanged,
so nothing is re-embedded. What relate adds is the rest of a graph:
relationships between records, full-text search over the same text, and
Cypher over both.

| Need | Reference |
| --- | --- |
| Proving the migration: counts, dimensions, self-recall, a fingerprint | [verify](references/verify.md) |

An install of `SKILL.md` alone, which is what the skills CLI writes,
leaves this file out; it is published at
<https://relatedb.ai/skills/relate-migrate-from-vector-search/references/verify.md>.

## How records map

| In a vector store | In relate |
| --- | --- |
| A collection or table | A label (`:Chunk`) and a vector index on it |
| A record id | A property with a uniqueness constraint, so the import can `MERGE` and a rerun adds nothing |
| The document text | A string property, with a full-text index when keyword search is wanted |
| The embedding | A typed vector property, `vector(<list>, <dimensions>, FLOAT32)` |
| Scalar metadata used in filters | Properties declared in the vector index's `WITH [...]` list |
| Metadata that names another record (a parent document, a thread) | A relationship to that record's node |
| The distance metric | `vector.similarity_function`: `'cosine'` or `'euclidean'` |

## The schema

`vector.dimensions` is the embedding model's dimension count (the examples
use 4 so their results never change). `WITH [c.source, c.year]` declares
the metadata a search may filter on inside the index.

```cypher
CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE;
CREATE VECTOR INDEX chunk_embedding IF NOT EXISTS
  FOR (c:Chunk) ON (c.embedding) WITH [c.source, c.year]
  OPTIONS {indexConfig: {`vector.dimensions`: 4, `vector.similarity_function`: 'cosine'}};
CREATE FULLTEXT INDEX chunk_text IF NOT EXISTS FOR (c:Chunk) ON EACH [c.text]
```

## The import

Rows exported from the source arrive as one parameter list. `MERGE` on the
id makes a rerun a no-op; `vector(r.embedding, 4, FLOAT32)` fails the whole
statement on an embedding of the wrong length, where a plain list would be
stored and then skipped by every search without an error. A `doc` field in
the metadata becomes a `PART_OF` relationship.

```json data=export
{"rows": [
  {"id": "a1", "doc": "runbook", "source": "wiki", "year": 2025, "text": "Restart the ingest worker after a schema change.", "embedding": [0.9, 0.1, 0.0, 0.1]},
  {"id": "a2", "doc": "runbook", "source": "wiki", "year": 2026, "text": "The ingest worker reads from the events queue.", "embedding": [0.8, 0.2, 0.1, 0.1]},
  {"id": "a3", "doc": "postmortem-12", "source": "tickets", "year": 2026, "text": "Ingest lag grew after the queue was resized.", "embedding": [0.7, 0.3, 0.2, 0.0]},
  {"id": "a4", "doc": "billing-faq", "source": "wiki", "year": 2024, "text": "Invoices are generated nightly.", "embedding": [0.0, 0.1, 0.9, 0.3]}
]}
```

```cypher params=export
UNWIND $rows AS r
MERGE (c:Chunk {id: r.id})
  ON CREATE SET c.text = r.text, c.source = r.source, c.year = r.year,
                c.embedding = vector(r.embedding, 4, FLOAT32)
MERGE (d:Document {id: r.doc})
MERGE (c)-[:PART_OF]->(d)
RETURN count(c) AS imported
```

On the CLI, the export file binds as the parameter with `--fetch-params`,
which reads a file or URL and parses it as JSON. This command writes to the
store, which is the point of a migration; every read after it opens the
store with `--read-only`:

```bash writes
relate --database ./chunks.rl --fetch-params export=./export.json 'UNWIND $export.rows AS r MERGE (c:Chunk {id: r.id}) ON CREATE SET c.text = r.text, c.source = r.source, c.year = r.year, c.embedding = vector(r.embedding, 4, FLOAT32) MERGE (d:Document {id: r.doc}) MERGE (c)-[:PART_OF]->(d) RETURN count(c) AS imported'
```

## The recall query

The top-k search with a metadata filter becomes `SEARCH` with the filter
inside the parentheses, where it runs before `LIMIT`:

```json data=question
{"v": [0.85, 0.15, 0.05, 0.1], "k": 2, "sources": ["wiki", "tickets"], "since": 2025}
```

```cypher params=question
MATCH (c:Chunk)
SEARCH c IN (VECTOR INDEX chunk_embedding FOR $v
             WHERE c.source IN $sources AND c.year >= $since LIMIT $k) SCORE AS score
RETURN c.id AS id, round(score, 4) AS score, c.text AS text
ORDER BY score DESC, id
```

After the move, the same query can follow the graph, which no vector store
query could: here, every chunk of the documents the nearest chunks belong
to.

```cypher params=question
MATCH (c:Chunk)
SEARCH c IN (VECTOR INDEX chunk_embedding FOR $v WHERE c.year >= $since LIMIT $k) SCORE AS score
MATCH (c)-[:PART_OF]->(d:Document)
RETURN DISTINCT d.id AS document,
       COLLECT { MATCH (d)<-[:PART_OF]-(s:Chunk) RETURN s.id ORDER BY s.id } AS chunks
ORDER BY document
```

## What changes

| Topic | In relate |
| --- | --- |
| Score direction | `SCORE AS` is a similarity: higher is closer. A store that ranks by distance sorts ascending; relate's recall sorts `DESC` |
| Cosine score range | 0 to 1: `1.0` same direction, `0.5` orthogonal, `0.0` opposite. The order matches cosine similarity, but a threshold tuned on another store's numbers does not carry over |
| Euclidean score | `1 / (1 + squared distance)`, greater than 0 and up to 1 |
| Filter grammar | Equality, `IN` a list, `IS NULL` / `IS NOT NULL`, a half-bounded or bounded range per property, joined by `AND`; `OR` and `<>` fail with `InvalidSearchFilterPredicate` |
| Filter properties | Only those declared in the index's `WITH [...]`; another property fails with `WrongPropertyForVectorSearchFilter` |
| `LIMIT` | Required inside the search |
| A filter after `SEARCH` | Filters only the `k` rows already chosen, so fewer than `k` can come back |
| Search algorithm | Approximate nearest neighbor over an HNSW graph |
| Keyword search | A full-text index on the same nodes; fusing both lists is the `relate-graphrag` skill |
