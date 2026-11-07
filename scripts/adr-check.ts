// Checks docs/adr/ against the convention in docs/adr/README.md: unique
// sequential numbers, header and section order, the line ceiling, the
// public-record patterns, and the README index. Exit 1 on any problem.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'docs', 'adr');
const CEILING = 150;
const SECTIONS = ['## Context', '## Decision', '## Alternatives considered', '## Consequences'];
const STATUSES = ['Proposed', 'Accepted', 'Rejected', 'Withdrawn', 'Superseded'];
// Internal references that must not appear in a public record.
const PRIVATE = [/\bLABS-\d+/, /\bCIP-\d+/, /linear\.app/, /r31473/];

const problems: string[] = [];
const files = readdirSync(DIR).filter((f) => /^\d{4}-[a-z0-9-]+\.md$/.test(f)).sort();
const readme = readFileSync(join(DIR, 'README.md'), 'utf8');
const seen = new Map<string, string>();

for (const file of files) {
  const num = file.slice(0, 4);
  if (seen.has(num)) problems.push(`${file}: number ${num} is also used by ${seen.get(num)}`);
  seen.set(num, file);

  const text = readFileSync(join(DIR, file), 'utf8');
  const lines = text.split('\n');
  const say = (m: string) => problems.push(`${file}: ${m}`);

  if (lines.length > CEILING) say(`${lines.length} lines, over the ceiling of ${CEILING}`);
  if (!lines[0]?.startsWith(`# ADR-${num}: `)) say(`first line must be "# ADR-${num}: <title>"`);
  const status = lines.find((l) => l.startsWith('Status: '));
  if (!status) say('missing "Status:" line');
  else if (!STATUSES.some((s) => status.startsWith(`Status: ${s}`))) say(`unknown status "${status}"`);
  const date = lines.find((l) => l.startsWith('Date: '));
  if (!date || !/^Date: \d{4}-\d{2}-\d{2}$/.test(date)) say('missing or malformed "Date: YYYY-MM-DD" line');
  if (status && date && lines.indexOf(status) > lines.indexOf(date)) say('"Status:" must come before "Date:"');

  let last = -1;
  for (const s of SECTIONS) {
    const at = lines.indexOf(s);
    if (at < 0) say(`missing section "${s}"`);
    else if (at < last) say(`section "${s}" is out of order`);
    last = Math.max(last, at);
  }
  for (const re of PRIVATE) {
    const hit = lines.find((l) => re.test(l));
    if (hit) say(`internal reference matches ${re}: "${hit.trim()}"`);
  }
  if (!readme.includes(`](${file})`)) say('not listed in the README index');
}

// Sequential from 0001 with no gaps, so a number is never skipped or reused.
const nums = [...seen.keys()].map(Number).sort((a, b) => a - b);
nums.forEach((n, i) => {
  if (n !== i + 1) problems.push(`numbers are not sequential: expected ${String(i + 1).padStart(4, '0')}, found ${String(n).padStart(4, '0')}`);
});

if (problems.length) {
  console.error(`adr-check: ${problems.length} problem(s)\n\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`adr-check: ${files.length} record(s) ok`);
