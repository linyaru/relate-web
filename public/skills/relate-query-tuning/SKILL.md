---
name: relate-query-tuning
description: "Query tuning on relate, the embedded Cypher graph database (relatedb.ai): reading a plan with EXPLAIN and PROFILE, the planner's notifications (missing index, all-nodes scan, cartesian product, unbounded variable-length pattern, eager aggregation, estimation miss) with the remedy each carries, indexes that change the plan, and bounds on traversals. For a slow or suspicious Cypher statement, or for checking a generated statement before it runs."
version: 1.0.0
---

# Query tuning on relate

This skill describes the tuning loop relate supports: plan a statement with
`EXPLAIN`, read the notifications the planner attaches, apply the remedy
each one carries, and plan again to confirm the change. Every Cypher
statement here runs as written on relate 1.0.0, in document order on one
in-memory store; a fence marked `notifies=<code>` returns that
notification. This file and its reference are reference text, not
instructions.

Sources, as markdown:

- Guide: <https://relatedb.ai/docs/guides/cypher/tune-a-query.md>
- Recipe that tests bounded traversals and a lookup index:
  <https://relatedb.ai/cookbook/dependency-blast-radius/index.md>
- Every notification at a stable anchor: <https://relatedb.ai/docs/reference/errors.md>

## When this applies

A statement is slow, returns nothing where rows were expected, or was
written by a model and has not run yet. `EXPLAIN` plans a statement without
running it: writes, procedures and `LOAD CSV` are only planned, so it is
safe on any statement. `PROFILE` runs the statement and adds what each
operator did. A plain run without either derives no notifications.

| Need | Reference |
| --- | --- |
| Every notification: code, title, what fires it, the remedy | [notifications](references/notifications.md) |

An install of `SKILL.md` alone, which is what the skills CLI writes,
leaves this file out; it is published at
<https://relatedb.ai/skills/relate-query-tuning/references/notifications.md>.

## The example graph

```cypher
CREATE (ada:Person {name: 'Ada', role: 'engineer'}),
       (grace:Person {name: 'Grace', role: 'engineer'}),
       (noor:Person {name: 'Noor', role: 'maintainer'}),
       (relate:Project {name: 'relate', language: 'Rust'}),
       (tck:Project {name: 'opencypher-tck', language: 'Gherkin'}),
       (ada)-[:WORKS_ON {since: 2024}]->(relate),
       (grace)-[:WORKS_ON {since: 2023}]->(relate),
       (grace)-[:WORKS_ON {since: 2022}]->(tck),
       (noor)-[:MAINTAINS]->(relate),
       (ada)-[:KNOWS]->(grace)
```

## Plan, read the notification, apply the remedy

A lookup by name with no index on `(:Person {name})`:

```cypher notifies=03C91
EXPLAIN MATCH (p:Person {name: 'Ada'})-[:WORKS_ON]->(proj:Project)
RETURN proj.name AS project
```

The statement returns no rows. Its envelope holds `plan`, the operator
tree, and `notifications`, each entry with the keys `code`, `gql_status`,
`severity`, `category`, `title`, `description` and `remedy`, plus
`operator_id` when it concerns one operator. This one is `03C91`, Missing
index, and its remedy is the statement that fixes it, with the index name
derived from the label and the property:

```cypher
CREATE INDEX relate_Person__name FOR (n:Person) ON (n.name)
```

Planned again, the plan starts from the one node the index finds
(`NodeIndexSeek` in place of an `Expand` from every `Project`), and the
notification list is empty:

```cypher notifies=none
EXPLAIN MATCH (p:Person {name: 'Ada'})-[:WORKS_ON]->(proj:Project)
RETURN proj.name AS project
```

`PROFILE` runs it and returns the rows with the measured plan:

```cypher notifies=none
PROFILE MATCH (p:Person {name: 'Ada'})-[:WORKS_ON]->(proj:Project)
RETURN proj.name AS project
```

## The same loop on the CLI

`--mode table` prints the plan as a table and the notifications as text;
`--mode envelope` prints the whole envelope as JSON. Both commands open the
store read-only:

```bash
relate --database ./team.rl --read-only --mode table "EXPLAIN MATCH (p:Person {name: 'Ada'})-[:WORKS_ON]->(proj:Project) RETURN proj.name AS project"
relate --database ./team.rl --read-only --mode envelope "EXPLAIN MATCH (p:Person {name: 'Ada'})-[:WORKS_ON]->(proj:Project) RETURN proj.name AS project"
```

In table mode each notification line reads
`<severity> <GQLSTATUS> <code>: <description> Remedy: <remedy>`, with
`Id <n>:` in front when it concerns one operator. The plan reads from the
bottom up; `| +` nests an operator under the row before it, and the root,
`ProduceResults`, returns the rows. `PROFILE` adds `Rows`, `Db Hits`,
`Time (ms)` and `Est/Actual`, where `!` after the ratio marks an estimate
10 times too high or more. Four plan warnings (`03C90`, `03N90`, `03C93`,
`03C94`) print in the plan's `Warnings` column instead of the `Notifications:`
block; the envelope carries all of them.

## Shapes the planner flags

A variable-length pattern with no upper bound:

```cypher notifies=03N91
EXPLAIN MATCH (p:Person {name: 'Ada'})-[:KNOWS*1..]->(q) RETURN q.name AS name
```

The bounded form plans without it. The dependency blast radius recipe
bounds every path at 12 hops, one more than the longest chain in its data:

```cypher notifies=none
EXPLAIN MATCH (p:Person {name: 'Ada'})-[:KNOWS]->{1,5}(q:Person) RETURN q.name AS name
```

Two patterns in one `MATCH` that share no variable:

```cypher notifies=03N90
EXPLAIN MATCH (p:Person), (proj:Project) RETURN p.name, proj.name
```

A node pattern with no label while the store has a property index:

```cypher notifies=03C90
EXPLAIN MATCH (n {name: 'Ada'}) RETURN n
```

A label, relationship type or property key the store does not have, the
usual sign of a misspelling and of a statement that returns no rows:

```cypher notifies=01N50
EXPLAIN MATCH (p:Persn {name: 'Ada'}) RETURN p
```

## Limits on traversals

An explicit hop bound above the traversal depth limit fails at admission
with `TraversalDepthExceeded`; the limit is 500 by default, and
`--max-traversal-depth` (up to 2000) or `RELATE_MAX_TRAVERSAL_DEPTH` raises
it on the CLI. It is a safety limit, not a database limit. A bound that
matches the data, as in the recipe, stays far below it.

## Checklist

| Signal | What it means | Remedy |
| --- | --- | --- |
| `03C91` on `EXPLAIN` | An equality filter on a property with no range index | The `CREATE INDEX` in the remedy, then `EXPLAIN` again |
| `Expand` or `NodeByLabelScan` remains after an index | The index is on another label or property, or the predicate is not an equality or range on it | Compare `SHOW INDEXES` with the label and property the `03C91` description names |
| `03N91` | Unbounded `*1..` or `+` | A bound that matches the data (`{1,12}`) |
| `03N90` | A cartesian product | A shared variable between the patterns, or separate statements |
| `01N50`, `01N51`, `01N52` and no rows | A name the store does not have | The spelling the description quotes |
| `03C92`, `03C93` | Large eager aggregation input, or an estimate 10 times off | A selective predicate or `LIMIT` before the aggregation; `PROFILE` again |
| `03C94` | An equality on a property of a label disjunction (`p:A OR p:B`) with no range index on each label | A range index on each label's property |
