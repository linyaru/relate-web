// npm run skills:record — record the task skills after a review (DOCS-PLAN.md
// §3.8 "Skills library", ADR-0013 decision 2, ADR-0032).
//
// Writes `task_skills` into src/content/docs/_data/skill.json, keeping the
// CLI bundle's sync record beside it: for each folder under public/skills/
// but `relate`, every file's SHA-256, the review date (kept while the files
// are unchanged), and for each recipe the skill cites, the SHA-256 of its
// source and, with `--dist <dir>` (a built site), a digest of its
// cookbook/<slug>/results.json with timings removed. Run it after reading the
// skill diff and the diff of any recipe a skill cites; `npm run docs:check`
// fails while a skill or a cited recipe differs from the record
// (src/lib/docs/checks/skill.ts `checkTaskSkills`).
//
//   npm run skills:record                 source hashes; results digests kept where the source did not change
//   npm run skills:record -- --dist dist  also the results digests, from a build

import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { ROOT } from '../src/lib/docs/content.ts';
import { recordTaskSkills, TASK_SKILL_DATA_FILE } from '../src/lib/docs/skill.ts';

const { values: args } = parseArgs({ options: { dist: { type: 'string' } } });
const dist = args.dist ? resolve(args.dist) : null;
if (dist && !existsSync(dist)) {
  console.error(`skills:record: ${dist} does not exist; build first (npm run build)`);
  process.exit(1);
}

const records = recordTaskSkills({ dist });
for (const r of records) {
  const recipes = r.recipes.map((x) => `${x.slug}${x.results_sha256 ? '' : ' (no results digest)'}`).join(', ');
  console.log(`skills:record: ${r.name}: ${r.files.length} file(s), reviewed ${r.reviewed}; recipes: ${recipes || 'none'}`);
}
console.log(`skills:record: wrote task_skills to ${relative(ROOT, TASK_SKILL_DATA_FILE)}; review \`git diff -- ${relative(ROOT, TASK_SKILL_DATA_FILE)}\` before committing`);
