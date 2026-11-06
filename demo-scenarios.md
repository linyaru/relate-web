# Relate — agentic usage demo scenarios

10 proposals (title + abstract) for demos of AI agents using Relate.
Each runs with the CLI only (one-shot invocations, JSON output) after
`relate skill install`. No server, no driver code.

## Context & memory

### 1. Tiny agent memory — a context graph in one `.cl` file
A small version of neo4j-agent-memory: the agent stores entities from each
session (people, projects, decisions, facts) as nodes with typed
relationships and timestamps in a single `memory.cl` file. Recall is graph
traversal: "who decided X and what else did they own?" is one `MATCH`.
Demo: an agent persists context across two sessions and answers "what do
you remember about …" from the file.

### 2. Context-graph builder for a codebase or document set
The agent ingests README/docs/tickets (or a codebase's modules and
imports), extracts entities and relations into Relate, and answers
multi-hop questions ("which component depends on the deprecated API and
who last touched it?"). Uses fulltext `SEARCH` for keyword recall plus
graph expansion for relations, in one process, checkpointed to a directory.

### 3. Cross-session scratchpad with vectors + graph
Combines 1 and 2: chunks get embeddings (`vector()`, HNSW index), facts get
graph structure. Shows both recall modes — vector search for "what did we
discuss about auth?" and traversal for "what changed since the last
decision?" — in one script with JSON in/out.

## Sandbox analytics over fetched datasets

### 4. Stack Overflow tag graph in a sandbox
Fetch a topic's questions from the Stack Exchange API, load questions,
tags, and users into `:memory:`, and query: tag co-occurrence, top answerers
per tag, unanswered questions. Data is ephemeral — load, query, print, drop.

### 5. Dependency analysis from deps.dev
Fetch a project's transitive dependencies from deps.dev, load them as a
`(Package)-[:DEPENDS_ON*]->(Package)` graph, and run reachability queries:
"which deps transitively use a package with an advisory?", "what breaks if
I drop X?". Checkpoint to `deps.cl` so the graph is versionable and the
run repeats in CI.

### 6. CSV triage with entity resolution
Load two messy CSV exports (e.g. CRM accounts vs. invoice addresses) into a
sandbox, model them as nodes, use string/list functions plus `MERGE` to
propose entity matches, and report duplicates and orphaned records as JSON.
Runs with a terminal, a `.cl` file, and about ten Cypher statements.

## Subgraph extraction & test fixtures

### 7. Companies demo subgraph as a checked-in test fixture
`relate pull --from companies.env --query 'MATCH (o:Organization)-[r]-() RETURN o, r LIMIT 500' ./sample.cl`
mirrors a slice of the `demo.neo4jlabs.com` companies graph into one file.
Commit it to the repo and generate data classes plus unit tests against it
(Rust or Python). Tests then run offline on the same graph every time;
refreshing the fixture is one command.

### 8. Golden-graph regression testing for migrations
Pull the same subgraph before and after a migration or schema change on the
source Neo4j. The agent compares the snapshots with Cypher (node/rel counts,
property diffs) and writes a markdown report on what changed or was lost.

### 9. Aura subgraph as a local agent playground
Pull only the subgraph a task needs (people, projects, recent events) from
Aura into a local `.cl`, then experiment — schema changes, deletes,
experimental queries — without touching the source. The agent works on
real-shaped data with no production risk.

## Evaluation

### 10. Text-to-Cypher eval harness in a single file
A small benchmark: a file of question/Cypher pairs, a graph loaded via
`pull`, and an agent (or any LLM) generating Cypher per question. Each
answer runs through `relate -json` and is scored against the expected
result. The harness is one binary plus two files, usable for prompt or
fine-tune evaluation without a Neo4j instance.
