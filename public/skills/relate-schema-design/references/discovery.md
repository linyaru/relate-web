# Reading a schema back

Three ways to read what a store's schema is: Cypher (`SHOW` statements and
the `db.schema.*` procedures), the schema folder a directory store writes as
text, and the ontology procedures, a preview. The Cypher statements below
run in order on one in-memory store, on relate 0.1.2.

Sources: <https://relatedb.ai/docs/reference/cypher/differences-from-neo4j.md>
(the `db.schema` procedures in place of APOC's),
<https://relatedb.ai/docs/reference/storage/formats.md> (the files of a
directory store), and <https://relatedb.ai/cookbook/tool-call-provenance/index.md>
(`SHOW CONSTRAINTS` on a trace schema).

## A small store to read

```cypher
CREATE CONSTRAINT entity_key IF NOT EXISTS FOR (e:Entity) REQUIRE e.key IS UNIQUE;
CREATE CONSTRAINT person_age IF NOT EXISTS FOR (p:Person) REQUIRE p.age IS :: INTEGER;
CREATE INDEX project_name IF NOT EXISTS FOR (p:Project) ON (p.name);
CREATE (:Person:Entity {key: 'ada', name: 'Ada', age: 36})-[:WORKS_ON {since: 2024}]->(:Project {name: 'relate'})
```

## Cypher

The statements that recreate the catalog, one per index and constraint,
come from the `createStatement` column:

```cypher
SHOW CONSTRAINTS YIELD name, createStatement RETURN name, createStatement ORDER BY name;
SHOW INDEXES YIELD name, type, createStatement RETURN name, type, createStatement ORDER BY name
```

The properties each label and relationship type carries in the data, with
their inferred types:

```cypher
CALL db.schema.nodeTypeProperties() YIELD nodeLabels, propertyName, propertyTypes
RETURN nodeLabels, propertyName, propertyTypes
ORDER BY propertyName, nodeLabels[0];
CALL db.schema.relTypeProperties() YIELD relType, propertyName, propertyTypes
RETURN relType, propertyName, propertyTypes
```

The labels, the relationship types, and the schema as a graph of one
virtual node per label and one relationship per pattern:

```cypher
CALL db.labels() YIELD label RETURN label ORDER BY label;
CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType ORDER BY relationshipType;
CALL db.schema.visualization()
```

APOC is not part of relate: `CALL apoc.meta.schema()` fails with
`syntax error: ProcedureNotFound: apoc.meta.schema`, and the `db.schema`
procedures above describe the same graph.

## The schema folder

A directory store writes its schema as text under `.cypherlite/schema/`,
rewritten at every checkpoint.

| File | Holds |
| --- | --- |
| `schema.cypher` | One `CREATE INDEX` or `CREATE CONSTRAINT` statement per catalog entry, as the `createStatement` column renders it |
| `graph-type.cypher` | The store's graph type, when it has one |
| `ontology.json` or `ontology.yaml` | The ontology document as it was stored, when one is set |

The folder is a mirror to read and to diff in a pull request, not a source:
a schema change is a Cypher statement followed by a checkpoint. A hand edit
does not change the schema; the next open refuses the store with an error
that names the file and its repair:

```text
Failed to open Relate: storage error: schema mirror .cypherlite/schema/schema.cypher differs from the schema this store's checkpoint persisted; it was edited by hand or copied from another store; delete the .cypherlite/schema/ directory and reopen: the next checkpoint regenerates it from the store's schema
```

## The ontology procedures, a preview

An ontology is a document that names the node and relationship types and
their properties, kept in the store beside the data. Four procedures manage
it, and all four need `RELATE_PREVIEW=ontology` in the process environment;
without it each call fails with `semantic error: SemanticError: preview
feature 'ontology' is not enabled: set RELATE_PREVIEW=ontology` (exit code
6 on the CLI), and `SHOW PROCEDURES` does not list them. The WebAssembly
build has no way to set the opt-in.

| Procedure | Does |
| --- | --- |
| `db.ontology.set($ontology)` | Validates a JSON or YAML document and stores it, replacing any current one |
| `db.ontology.get()`, `db.ontology.get('json')` | Returns the stored document, or `null` when none is set |
| `db.ontology.drop()` | Removes the stored document |
| `db.ontology.apply()` | Turns the document into the store's graph type, which then gates writes |

A document in the shape `set` accepts: `schema` is this exact URI, `version`
is a string, and a required property is `must_exist`.

```yaml
schema: https://neo4j.com/docs/ontology-graph-spec/1.1.0/schema.json
id: example
version: "1"
nodes:
  Person:
    label: Person
    properties:
      id:
        type: STRING
        key: true
      name:
        type: STRING
        must_exist: true
```

After `apply`, a `Person` without `id` or `name` fails to write with a
`ConstraintValidationFailed` error, and `SHOW CURRENT GRAPH TYPE` prints the
graph type the document became. Reading the ontology needs no write access:

```bash
RELATE_PREVIEW=ontology relate --database ./graph --read-only --mode table "CALL db.ontology.get()"
```

A `null` result means no ontology is set; the `SHOW` statements and
`db.schema` procedures above then describe the schema instead.
