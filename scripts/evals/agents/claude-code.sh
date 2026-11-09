#!/usr/bin/env bash
# A DOCS_EVALS_AGENT command for Claude Code (scripts/docs-evals.ts). Never run
# by this repository's checks: it needs ANTHROPIC_API_KEY and spends money.
# Used by .github/workflows/docs-evals.yml when an operator starts it, or a
# relate-release dispatch does once the operator has opted in.
#
#   DOCS_EVALS_HARNESS="claude-code <version>" \
#   DOCS_EVALS_AGENT="bash scripts/evals/agents/claude-code.sh" \
#     node scripts/docs-evals.ts
#
# From https://code.claude.com/docs/en/headless and
# https://code.claude.com/docs/en/cli-reference (both read 2026-11-07):
#   -p reads the prompt from stdin. --output-format stream-json needs
#   --verbose; it goes to stdout, which the harness reads as the transcript.
#   --allowedTools pre-approves the tools a task needs; a call that needs
#   approval and is not listed is denied in a -p run. `mcp__relate-docs__*`
#   matches every tool of the server named relate-docs
#   (https://code.claude.com/docs/en/permissions, read 2026-11-07).
#
#   none, agents-md, docs-mcp: --bare, which skips auto-discovery of hooks,
#   skills, MCP servers, auto memory and CLAUDE.md, reads only
#   ANTHROPIC_API_KEY, and sends no system reminders. Each condition is
#   passed by flag: the system prompt (and, for agents-md, the AGENTS.md
#   block) through --append-system-prompt-file, the docs MCP server through
#   --mcp-config.
#
#   skill: not --bare. The headless page says bare mode loads skills from an
#   --add-dir folder's .claude/skills/ but Claude "doesn't get the list of
#   available skills", so under --bare the agent would never be told the
#   skill exists. Instead the run discovers the working directory's
#   .claude/skills/relate/ (harness.ts `prepare` lays it out there) as an
#   interactive session would, with --setting-sources project (no user or
#   local settings) and --strict-mcp-config with no --mcp-config (no MCP
#   server), and with HOME set to an empty scratch directory, so nothing
#   under the operator's ~/.claude (skills, CLAUDE.md, auto memory, hooks,
#   plugins) loads. The working directory is a fresh scratch directory with
#   no .claude/settings.json and no .mcp.json; DOCS_EVALS_WORK must not be
#   inside a directory that holds a CLAUDE.md, since a non-bare run reads
#   those of parent directories. The difference from the other conditions
#   (system reminders on, which is how the skill list reaches the model) is
#   part of what this condition measures.
#
# Not yet run against a live account: the first operator run confirms that
# the skill condition's system/init event lists the skill and that an empty
# HOME with ANTHROPIC_API_KEY starts a -p run (LAUNCH.md).
set -euo pipefail

: "${DOCS_EVALS_SYSTEM_PROMPT:?run this through scripts/docs-evals.ts}"
: "${ANTHROPIC_API_KEY:?the wrapper authenticates with ANTHROPIC_API_KEY only}"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
system="$scratch/system-prompt.md"
cat "$DOCS_EVALS_SYSTEM_PROMPT" > "$system"
if [ -n "${DOCS_EVALS_AGENTS_MD:-}" ]; then
  printf '\n\nContents of AGENTS.md in the working directory:\n\n' >> "$system"
  cat "$DOCS_EVALS_AGENTS_MD" >> "$system"
fi

tools="Bash,Read,Edit"
args=(-p --output-format stream-json --verbose --append-system-prompt-file "$system")
if [ -n "${DOCS_EVALS_SKILL_DIR:-}" ]; then
  args+=(--setting-sources project --strict-mcp-config)
  mkdir "$scratch/home"
  export HOME="$scratch/home"
else
  args=(--bare "${args[@]}")
fi
if [ -n "${DOCS_EVALS_MCP_CONFIG:-}" ]; then
  args+=(--mcp-config "$DOCS_EVALS_MCP_CONFIG")
  tools="$tools,mcp__relate-docs__*"
fi
args+=(--allowedTools "$tools")

# Not exec: the EXIT trap removes the scratch directory after claude exits.
claude "${args[@]}"
