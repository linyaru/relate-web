# The planner's notifications

`EXPLAIN` and `PROFILE` attach notifications to a plan; a plain run derives
none. Each has a GQLSTATUS code, a severity, a category, a title, a
description that names the labels, properties and counts involved, and a
remedy. The descriptions below are quoted from runs on relate 1.0.1; the
parts that name labels, properties and counts vary. The Cypher statements
run in order on one in-memory store.

Sources: <https://relatedb.ai/docs/guides/cypher/tune-a-query.md> and
<https://relatedb.ai/docs/reference/errors.md>; the bounded traversals are
from <https://relatedb.ai/cookbook/dependency-blast-radius/index.md>.

## Performance

| GQLSTATUS | Title | Fires on | Example description | Remedy |
| --- | --- | --- | --- | --- |
| `03C91` | Missing index | An equality predicate on a label's property with no range index on that pair | `the equality predicate on name filters :Person without a range index on (:Person {name})` | `CREATE INDEX relate_Person__name FOR (n:Person) ON (n.name)` |
| `03C90` | All nodes scan | A label-less node pattern while the store has a property index | `the scan matches every node; consider the property index (:Person(name))` | ``Name the label the scan intends (`MATCH (n:<Label>)`); on the index's label the scan becomes an index-backed lookup.`` |
| `03N90` | Cartesian product | Patterns in one `MATCH` that share no variable | `the MATCH patterns share no join anchor` | `Give the patterns a join anchor: reuse a node variable across them, or add a pattern that relates their endpoints; otherwise run them as separate queries.` |
| `03N91` | Unbounded variable-length pattern | A variable-length pattern with no upper bound | `the variable-length pattern (p:Person)-[:KNOWS*1..]->(q) has no upper bound` | ``Bound the expansion (`[:R*1..5]`) where arbitrary length is not required, or add a selective endpoint/label predicate and a `LIMIT`.`` |
| `03C92` | Eager aggregation | An aggregation whose input is estimated at 100,000 rows or more | `the aggregation buffers an estimated 100000 input rows, at or above the 100000-row eager threshold` | ``Reduce the rows reaching the aggregation with a selective label/property predicate or a `LIMIT` before it; profile again to confirm the buffered input shrank.`` |
| `03C93` | Estimation miss | `PROFILE` only: an operator whose estimate is 10 times its actual rows or more | `estimated rows 10x or more above the actual rows` | `Rework the operator's input so the estimate can see the filter (add the selective predicate at the scan, or reorder the join); the estimate is a planner assumption, not a runtime fact.` |
| `03C94` | Label disjunction scan | An equality on a property of a label disjunction, such as `(p:Model OR p:Source) AND p.id = 1`, that no range index on each label serves | `the disjunction scan answers per label; consider the property index (:Model(id), :Source(id))` | `Create a range index on each disjunct label's filtered property: the disjunction then serves as per-label keyed lookups instead of per-label scans.` |

## Names, scope and deprecation

| GQLSTATUS | Fires on | Example description | Remedy |
| --- | --- | --- | --- |
| `01N50` | A label the store does not have | ``The label `Persn` does not exist in this database.`` | `Check the spelling; the label exists after the first write that creates it, and no index or constraint uses the unknown name.` |
| `01N51` | A relationship type the store does not have | ``The relationship type `WORKS_ONN` does not exist in this database.`` | `Check the spelling; the type exists after the first write that creates it.` |
| `01N52` | A property key the store does not have | ``The property key `nam` does not exist in this database.`` | `Check the spelling; the key exists after the first write that sets it.` |
| `01N00` | A `CALL { … }` subquery without a scope clause | ``The `CALL { … }` subquery has no variable scope clause.`` | ``Add the scope clause the body imports: `CALL (n) { … }`, or `CALL () { … }` when it imports nothing.`` |
| `01N01` | A deprecated function or procedure | ``The procedure `db.index.vector.queryNodes` is deprecated.`` | ``Use the `SEARCH` clause instead.`` |

## Each one, on a small graph

```cypher
CREATE (ada:Person {name: 'Ada'}), (grace:Person {name: 'Grace'}),
       (relate:Project {name: 'relate'}),
       (ada)-[:WORKS_ON]->(relate), (ada)-[:KNOWS]->(grace)
```

```cypher notifies=03C91
EXPLAIN MATCH (p:Person {name: 'Ada'}) RETURN p.name
```

```cypher notifies=03N90
EXPLAIN MATCH (p:Person), (proj:Project) RETURN p.name, proj.name
```

```cypher notifies=03N91
EXPLAIN MATCH (p:Person)-[:KNOWS*1..]->(q) RETURN q.name
```

```cypher notifies=01N51,01N52
EXPLAIN MATCH (p:Person)-[:WORKS_ONN]->(x) RETURN x.nam
```

```cypher notifies=01N00
EXPLAIN CALL { MATCH (p:Person) RETURN p } RETURN p.name
```

With a property index in the store, a label-less pattern turns into
`03C90`:

```cypher
CREATE INDEX person_name FOR (p:Person) ON (p.name)
```

```cypher notifies=03C90
EXPLAIN MATCH (n {name: 'Ada'}) RETURN n
```

`03C92` needs an aggregation over an estimated 100,000 rows or more, and
`03C93` a `PROFILE` whose estimate misses by 10 times or more; both were
reproduced over 100,000 nodes, too large for this file.
