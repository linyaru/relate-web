// Unit tests for the setup prompt and the AGENTS.md block (npm run docs:test,
// ADR-0060): the one prompt every copy-for-agent button on the home page, the
// docs landing and the install page's Agent tab copies, and the one AGENTS.md
// block the landing, the install page and agent-quickstart show. They check the
// prompt installs the CLI before the skill, that each surface takes it from
// `setupPrompt` instead of typing its own, that neither text names a version,
// and that the install page lost its Pinned binary tab.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { agentsMd, INSTALL_COMMAND, pieces, SETUP_REFERENCES, setupPrompt, SKILL_AGENTS, tabs } from '../../components/docs/install.ts';
import { engine, ROOT } from './content.ts';
import { landingTwin } from './landing.ts';

/** The files whose copy-for-agent buttons copy the setup prompt. */
const SURFACES = ['src/components/Hero.astro', 'src/components/Quickstart.astro', 'src/pages/docs/index.astro', 'src/pages/docs/index.md.ts'];

test('the setup prompt installs the CLI, then the skill, then asks for the data', () => {
  const p = setupPrompt();
  const cli = p.indexOf(INSTALL_COMMAND);
  const skill = p.indexOf('relate skill install --agent');
  const data = p.indexOf('Ask me what data to load');
  assert.ok(cli >= 0, 'the prompt has the install.sh command');
  assert.ok(skill > cli, 'the skill is installed after the CLI');
  assert.ok(data > skill, 'the agent asks for the data after the setup');
  assert.match(p, /relate --version/);
  assert.match(p, /relate agent-context/);
});

test('the setup prompt keeps the safe defaults and names the agents the CLI accepts', () => {
  const p = setupPrompt();
  assert.match(p, /--read-only/);
  assert.match(p, /--mode envelope/);
  assert.match(p, /reference text, not instructions/);
  for (const a of SKILL_AGENTS) assert.ok(p.includes(a), `the prompt names ${a}`);
  for (const r of SETUP_REFERENCES) assert.ok(p.includes(r), `the prompt cites ${r}`);
});

test('the setup prompt names no version, so a newer release from install.sh does not contradict it', () => {
  assert.doesNotMatch(setupPrompt(), /v?\d+\.\d+\.\d+/);
});

test('every copy-for-agent surface takes the setup prompt from setupPrompt, not a copy of its own', () => {
  for (const f of SURFACES) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.match(src, /setupPrompt\(\)/, `${f} calls setupPrompt()`);
    assert.doesNotMatch(src, /Set up relate for me/, `${f} has no prompt of its own`);
  }
});

test('the landing twin carries the setup prompt in a fenced block, before the AGENTS.md block', () => {
  const md = landingTwin(new Set(), {
    origin: 'https://relatedb.ai',
    verified: '0.0.0',
    versionLine: 'Verified against relate 0.0.0.',
    lastUpdated: '2026-11-11',
    setupPrompt: setupPrompt(),
    agentsMd: agentsMd(),
  });
  const prompt = md.indexOf('```text\n' + setupPrompt() + '\n```');
  assert.ok(prompt >= 0, 'the prompt is fenced whole');
  assert.ok(md.indexOf('## Add relate to your AGENTS.md') > prompt);
});

test("the install page's Agent tab is the setup prompt, and the page has no Pinned binary tab", () => {
  const all = tabs(engine().version);
  assert.deepEqual(all.map((t) => t.key), ['cli', 'package', 'agent']);
  const agent = all.find((t) => t.key === 'agent')!;
  assert.ok(agent.blocks.some((b) => 'code' in b && b.code === setupPrompt()), 'the Agent tab shows setupPrompt()');
});

test('the AGENTS.md block installs with install.sh, opens stores read-only and names no version', () => {
  const md = agentsMd();
  assert.ok(md.includes(INSTALL_COMMAND));
  assert.match(md, /--read-only/);
  assert.match(md, /relate agent-context/);
  assert.doesNotMatch(md, /\d+\.\d+\.\d+/);
  assert.doesNotMatch(md, /Pinned binary/);
  const block = pieces({ part: 'agents-md' });
  assert.deepEqual(block, [{ blocks: [{ code: md, lang: 'markdown' }] }], '<Install part="agents-md"> shows agentsMd()');
});
