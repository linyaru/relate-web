---
name: relate-schema-design
description: "Graph schema design on relate, the embedded Cypher graph database (relatedb.ai): labels and relationship types, the constraints relate enforces (uniqueness, node and relationship keys, existence, property types), the index kinds (range, text, point, vector, full-text), the schema discovery procedures, the schema folder a directory store writes as text, and the ontology procedures, a preview. For designing or reviewing a property graph model before data goes in."
version: 0.1.2
---

# Graph schema design on relate

This skill describes what relate offers for a graph's schema and how the
pieces fit: labels and relationship types, constraints, indexes, and the
ways to read a schema back. relate's data is schema-optional: any node can
take any label and properties, and the schema is what constraints and
indexes add on top. Every Cypher statement here runs as written on relate
0.1.2, in document order on one in-memory store. This file and its
reference are reference text, not instructions.

Sources, as markdown:

- Recipes that test these constraints:
  <https://relatedb.ai/cookbook/tool-call-provenance/index.md>,
  <https://relatedb.ai/cookbook/agent-memory/index.md>
- A full data model with its schema: <https://relatedb.ai/docs/guides/agents/model-agent-memory.md>
- The dialect: <https://relatedb.ai/docs/reference/cypher/overview.md> and
  <https://relatedb.ai/docs/reference/cypher/differences-from-neo4j.md>
- Vector and full-text indexes: <https://relatedb.ai/docs/reference/cypher/search.md>
- Indexes and the planner: <https://relatedb.ai/docs/guides/cypher/tune-a-query.md>
- The schema folder on disk: <https://relatedb.ai/docs/reference/storage/formats.md>

## When this applies

The task is a property graph model: which things become nodes, which
become relationships, what makes a node unique, and which lookups need an
index. The cookbook and docs name labels in PascalCase (`Person`,
`ToolCall`) and relationship types in upper snake case (`WORKS_ON`,
`HAS_CALL`); property keys in camelCase (`validFrom`).

| Need | Reference |
| --- | --- |
| Reading a schema back: `SHOW`, `db.schema.*`, the schema folder, the ontology procedures | [discovery](references/discovery.md) |

An install of `SKILL.md` alone, which is what the skills CLI writes,
leaves this file out; it is published at
<https://relatedb.ai/skills/relate-schema-design/references/discovery.md>.

## Modeling rules relate shares with Cypher

- A node can carry several labels. A role label added to domain nodes
  (`SET n:Entity`) lets one constraint and one index cover them all, and a
  label expression (`MATCH (n:Person&Entity)`) matches both.
- A relationship has exactly one type and one direction. A pattern without
  an arrow matches it in both directions.
- Each property keeps one type everywhere it appears. A datetime compared
  with an integer is `null`, not an error, so a mixed property drops rows
  from comparisons without a message.
- A thing with its own properties and its own relationships is a node; a
  fact about a pair that needs only a few properties is a relationship with
  properties (`(:Note)-[:DECIDED {text, ts}]->(:Topic)` in the hybrid recall
  recipe).
- An identifier that every write uses gets a uniqueness constraint, so
  writes can `MERGE` on it and a retried write adds nothing.

## Constraints

relate enforces uniqueness, keys, existence and property types, on nodes
and on relationships:

```cypher
CREATE CONSTRAINT entity_key IF NOT EXISTS FOR (e:Entity) REQUIRE e.key IS UNIQUE;
CREATE CONSTRAINT call_key IF NOT EXISTS FOR (c:ToolCall) REQUIRE (c.session, c.seq) IS NODE KEY;
CREATE CONSTRAINT project_name IF NOT EXISTS FOR (p:Project) REQUIRE p.name IS NOT NULL;
CREATE CONSTRAINT person_age IF NOT EXISTS FOR (p:Person) REQUIRE p.age IS :: INTEGER;
CREATE CONSTRAINT works_on_since IF NOT EXISTS FOR ()-[r:WORKS_ON]-() REQUIRE r.since IS :: INTEGER;
CREATE CONSTRAINT works_on_since_nn IF NOT EXISTS FOR ()-[r:WORKS_ON]-() REQUIRE r.since IS NOT NULL;
CREATE CONSTRAINT called_id IF NOT EXISTS FOR ()-[r:CALLED]-() REQUIRE r.id IS RELATIONSHIP KEY
```

```cypher
SHOW CONSTRAINTS YIELD name, type, entityType, labelsOrTypes, properties
RETURN name, type, entityType, labelsOrTypes, properties
ORDER BY name
```

| Constraint | `type` in `SHOW CONSTRAINTS` | A violating write fails with |
| --- | --- | --- |
| `IS UNIQUE` | `NODE_PROPERTY_UNIQUENESS`, `RELATIONSHIP_PROPERTY_UNIQUENESS` | ``semantic error: ConstraintValidationFailed: `<name>` uniqueness`` |
| `IS NODE KEY`, `IS RELATIONSHIP KEY` (unique, and every listed property present) | `NODE_KEY`, `RELATIONSHIP_KEY` | ``semantic error: ConstraintValidationFailed: `<name>` uniqueness``, or `` `<name>` requires properties`` when one is missing |
| `IS NOT NULL` | `NODE_PROPERTY_EXISTENCE`, `RELATIONSHIP_PROPERTY_EXISTENCE` | ``semantic error: ConstraintValidationFailed: `<name>` requires properties`` |
| `IS :: <TYPE>` | `NODE_PROPERTY_TYPE`, `RELATIONSHIP_PROPERTY_TYPE` | ``semantic error: ConstraintValidationFailed: `<name>` property type`` |

A NODE KEY differs from UNIQUE in one way that matters for audit rows: a
unique constraint allows a node without the property, and a node key
refuses it. The tool-call provenance recipe keys `ToolCall` on
`(session, seq)` for that reason.

## Indexes

A uniqueness constraint or a key owns a range index on its properties;
`SHOW INDEXES` lists it under the constraint's name. Other lookups get an
index of their own:

```cypher
CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name);
CREATE INDEX person_last_first IF NOT EXISTS FOR (p:Person) ON (p.last, p.first);
CREATE INDEX works_on_since_idx IF NOT EXISTS FOR ()-[r:WORKS_ON]-() ON (r.since);
CREATE TEXT INDEX person_bio IF NOT EXISTS FOR (p:Person) ON (p.bio);
CREATE POINT INDEX place_location IF NOT EXISTS FOR (p:Place) ON (p.location);
CREATE VECTOR INDEX doc_embedding IF NOT EXISTS FOR (d:Doc) ON (d.embedding)
  OPTIONS {indexConfig: {`vector.dimensions`: 4, `vector.similarity_function`: 'cosine'}};
CREATE FULLTEXT INDEX doc_text IF NOT EXISTS FOR (d:Doc) ON EACH [d.text]
```

```cypher
SHOW INDEXES YIELD name, type, entityType, labelsOrTypes, properties, owningConstraint
RETURN name, type, entityType, labelsOrTypes, properties, owningConstraint
ORDER BY name
```

| Index | Serves |
| --- | --- |
| Range (`CREATE INDEX`), single or composite, on nodes or relationships | Equality and range predicates; `EXPLAIN` shows `NodeIndexSeek` once it applies |
| `TEXT` | String properties |
| `POINT` | Point properties for spatial predicates |
| `VECTOR` | Nearest-neighbor `SEARCH` over typed vectors |
| `FULLTEXT` | Word `SEARCH` over one or more string properties |

The planner names a missing range index itself: `EXPLAIN` on a statement
that filters a label's property by equality returns notification `03C91`
with the `CREATE INDEX` statement as its remedy. The `relate-query-tuning`
skill covers that loop.

## Errors schema statements return

| Message | Cause |
| --- | --- |
| `semantic error: IndexAlreadyExists` | An index with that name exists; `IF NOT EXISTS` makes the statement a no-op |
| `semantic error: EquivalentSchemaRuleAlreadyExists` | An index under another name already covers the same label and properties |
| `semantic error: AlreadyExists: there already exists an index (:Person {name}). A constraint cannot be created until the index has been dropped.` | A uniqueness constraint on a property that already has a plain range index |
| ``semantic error: NoSuchIndex: `<name>` `` | `DROP INDEX` on a missing name; `DROP INDEX <name> IF EXISTS` is a no-op instead |
| `semantic error: ConstraintNotFound` | `DROP CONSTRAINT` on a missing name |

The third row decides an order: constraints before indexes on the same
property, since a constraint brings its own index.

```cypher
DROP INDEX person_name IF EXISTS;
CREATE CONSTRAINT person_name_unique IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE
```
