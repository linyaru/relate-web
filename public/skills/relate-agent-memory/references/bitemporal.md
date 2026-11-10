# Bi-temporal facts: what was true, and what was believed

A fact in the memory model carries two intervals. Valid time, `validFrom`
to `validTo`, is when it held in the world; an open `validTo` means it
still holds. Record time, `recordedAt` to `closedAt`, is when the agent
believed it; an open `closedAt` means it still does. A correction that
arrives late closes the old fact on both axes, and the two axes then give
different answers for the days in between. The statements below run in
order on one in-memory store, on relate 0.1.2.

Sources: <https://relatedb.ai/cookbook/bitemporal-decisions/index.md> (a
decision log through late corrections, a rejection and a planned change)
and <https://relatedb.ai/docs/guides/agents/model-agent-memory.md>.

## A slot with a late correction

Grace's fact was recorded on 2 March. On 20 March the agent learned that Ada
had taken over on 10 March, so Grace's fact is valid until 10 March but was
believed until 20 March.

```cypher
CREATE (f1:Fact {id: 'f1', slot: 'relate/release-reviewer', text: 'Grace reviews each relate release.',
                 validFrom: datetime('2026-01-05T00:00:00Z'), validTo: datetime('2026-03-10T00:00:00Z'),
                 recordedAt: datetime('2026-03-02T10:00:00Z'), closedAt: datetime('2026-03-20T09:00:00Z')}),
       (f3:Fact {id: 'f3', slot: 'relate/release-reviewer', text: 'Ada reviews each relate release.',
                 validFrom: datetime('2026-03-10T00:00:00Z'),
                 recordedAt: datetime('2026-03-20T09:00:00Z')}),
       (f3)-[:SUPERSEDES]->(f1)
```

## True on a date, and believed on a date

One statement answers both questions for 15 March. A fact is true on `t`
when `validFrom <= t < validTo`, and believed on `t` when
`recordedAt <= t < closedAt`, with an open end counting as "still":

```json data=asof
{"slot": "relate/release-reviewer", "on": "2026-03-15T00:00:00Z"}
```

```cypher params=asof
MATCH (f:Fact) WHERE f.slot = $slot
WITH datetime($on) AS t, collect(f) AS facts
RETURN [x IN facts WHERE x.validFrom <= t AND (x.validTo IS NULL OR t < x.validTo) | x.text] AS trueOn,
       [x IN facts WHERE x.recordedAt <= t AND (x.closedAt IS NULL OR t < x.closedAt) | x.text] AS believedOn
```

`trueOn` is Ada's fact and `believedOn` is Grace's: both are right. That
pair is the audit trail for "why did the agent ask Grace on 15 March?".

## The history of a slot

`SUPERSEDES` chains each correction to the fact it replaced. A bounded
quantified path walks the chain from the current fact back:

```cypher
MATCH (cur:Fact) WHERE cur.slot = 'relate/release-reviewer' AND cur.closedAt IS NULL
MATCH p = (cur)-[:SUPERSEDES]->{0,10}(old:Fact)
RETURN old.text AS fact, old.validFrom AS validFrom, old.validTo AS validTo, length(p) AS stepsBack
ORDER BY stepsBack
```

## How late the agent learned

The gap between `validTo` (when a fact stopped holding) and `closedAt`
(when the agent learned it) measures how stale memory was:

```cypher
MATCH (f:Fact) WHERE f.closedAt IS NOT NULL
RETURN f.text AS fact, duration.inDays(f.validTo, f.closedAt).days AS daysLate
```

## Rules the queries rely on

- All four times are datetimes. A datetime compared with an integer is
  `null`, not an error, so a fact stored with epoch milliseconds in one of
  them drops out of every as-of query without a message.
- A correction closes; it never deletes. `DETACH DELETE` on a fact loses
  both the history and the audit trail.
- The bi-temporal recipe adds a reviewer's rejection as
  `(:Review)-[:REJECTS]->(:Decision)` and a planned change whose
  `validFrom` is in the future; both keep this shape.
