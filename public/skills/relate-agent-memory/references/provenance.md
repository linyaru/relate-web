# Tool-call provenance: an audit trail in the memory graph

Every tool call an agent makes against its memory can become a `ToolCall`
node in the same graph, written by the same statement as the call itself
and linked to every node the call wrote or returned. The write and its
audit row then commit together or not at all: a `ToolCall` with
`status: 'committed'` exists only if the write it describes committed. The
statements below run in order on one in-memory store, on relate 0.1.2.

Source: <https://relatedb.ai/cookbook/tool-call-provenance/index.md>, which
replays twelve calls of one session, including two that fail, and audits
them.

## The trace schema

`call_key` is a NODE KEY on `(session, seq)`: every `ToolCall` has both and
no two share them, so a retried call cannot be recorded twice. The two
relationship constraints keep an integer `ts` on every `HAS_CALL`, so
ordering by time is exact.

```cypher
CREATE CONSTRAINT entity_key IF NOT EXISTS FOR (e:Entity) REQUIRE e.key IS UNIQUE;
CREATE CONSTRAINT session_id IF NOT EXISTS FOR (s:Session) REQUIRE s.id IS UNIQUE;
CREATE CONSTRAINT call_key IF NOT EXISTS
  FOR (c:ToolCall) REQUIRE (c.session, c.seq) IS NODE KEY;
CREATE CONSTRAINT has_call_ts IF NOT EXISTS
  FOR ()-[h:HAS_CALL]-() REQUIRE h.ts IS :: INTEGER;
CREATE CONSTRAINT has_call_ts_nn IF NOT EXISTS
  FOR ()-[h:HAS_CALL]-() REQUIRE h.ts IS NOT NULL;
CREATE (:Session {id: 's1'})
```

## A call and its trace in one statement

The tool's own Cypher sits in a `CALL () { … }` subquery that returns
`answer` (the row the agent sees) and `touched` (the nodes it wrote or
read). The tracer after it collects both, so it runs once per call even when
the call returns no rows, creates the `ToolCall` under the session, links
each touched node, and hands the answers back:

```json data=call-1
{"call": {"session": "s1", "seq": 1, "ts": 1772442060000, "tool": "remember",
          "ask": "We run a billing service."},
 "key": "billing service", "kind": "service"}
```

```cypher params=call-1
CALL () {
  MERGE (e:Entity {key: $key}) ON CREATE SET e.kind = $kind
  RETURN {entity: e.key} AS answer, [e] AS touched
}
WITH collect(answer) AS answers, collect(touched) AS touched
MATCH (s:Session {id: $call.session})
CREATE (s)-[:HAS_CALL {ts: $call.ts}]->
       (c:ToolCall {session: $call.session, seq: $call.seq, name: $call.tool,
                    ask: $call.ask, status: 'committed', rows: size(answers)})
FOREACH (n IN reduce(ns = [], t IN touched | ns + [x IN t WHERE x IS NOT NULL]) |
         MERGE (c)-[:TOUCHED]->(n))
WITH answers
UNWIND answers AS answer
RETURN answer
```

A read has the same shape with `status: 'read'`:

```json data=call-2
{"call": {"session": "s1", "seq": 2, "ts": 1772442120000, "tool": "recall",
          "ask": "What services do we run?"},
 "kind": "service"}
```

```cypher params=call-2
CALL () {
  MATCH (e:Entity {kind: $kind})
  RETURN {entity: e.key} AS answer, [e] AS touched
}
WITH collect(answer) AS answers, collect(touched) AS touched
MATCH (s:Session {id: $call.session})
CREATE (s)-[:HAS_CALL {ts: $call.ts}]->
       (c:ToolCall {session: $call.session, seq: $call.seq, name: $call.tool,
                    ask: $call.ask, status: 'read', rows: size(answers)})
FOREACH (n IN reduce(ns = [], t IN touched | ns + [x IN t WHERE x IS NOT NULL]) |
         MERGE (c)-[:TOUCHED]->(n))
WITH answers
UNWIND answers AS answer
RETURN answer
```

## Audit queries

Which call wrote an entity, and which calls have read it since:

```cypher
MATCH (e:Entity {key: 'billing service'})<-[:TOUCHED]-(c:ToolCall)<-[h:HAS_CALL]-(:Session)
RETURN c.seq AS seq, c.name AS tool, c.status AS status, c.ask AS ask, h.ts AS ts
ORDER BY ts
```

A call that fails leaves no `ToolCall` from this statement, because the
statement rolls back whole. The recipe records failures from the program
that caught the error, as a separate write with `status: 'rolled_back'` and
the error text, so the audit can count them.

## Rules the trace relies on

- The NODE KEY refuses a second row for the same `(session, seq)`, so a
  retried call fails instead of writing a duplicate audit row.
- `reduce(ns = [], t IN touched | ns + [x IN t WHERE x IS NOT NULL])`
  drops the nulls an `OPTIONAL MATCH` inside the call can return before
  `MERGE` links them.
- For a call that commits, the statement and its trace share one
  transaction; only a failed call is recorded by a separate write.
