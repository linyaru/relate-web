// Builds the playground into dist/playground, reusing the last build when none of its inputs changed.
// The playground is a separate Vite app that takes about three minutes; `astro build` empties dist, so
// without this every site build paid for it again. Inputs: the playground package (minus node_modules),
// the cookbook modules it imports from src/lib/cookbook, and the engine's type declarations.
// `--force` rebuilds; `--key` prints the inputs' key and exits (CI keys its cache of the build on it).
// The cache lives in node_modules/.cache/relate-playground (not committed).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist', 'playground');
const CACHE = join(ROOT, 'node_modules', '.cache', 'relate-playground');
const force = process.argv.includes('--force');

function files(dir, skip = () => false) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (skip(p)) continue;
    if (statSync(p).isDirectory()) out.push(...files(p, skip));
    else out.push(p);
  }
  return out;
}

const inputs = [
  ...files(join(ROOT, 'playground'), (p) => /[\\/](node_modules|dist)$/.test(p)),
  ...files(join(ROOT, 'src', 'lib', 'cookbook')),
  ...(existsSync(join(ROOT, 'public', 'wasm')) ? files(join(ROOT, 'public', 'wasm')).filter((p) => p.endsWith('.d.ts')) : []),
];
const hash = createHash('sha256');
hash.update(process.version);
for (const f of inputs) hash.update(relative(ROOT, f)).update('\0').update(readFileSync(f)).update('\0');
const key = hash.digest('hex').slice(0, 16);
const cached = join(CACHE, key);
if (process.argv.includes('--key')) {
  console.log(key);
  process.exit(0);
}

rmSync(OUT, { recursive: true, force: true });
if (!force && existsSync(join(cached, 'index.html'))) {
  mkdirSync(OUT, { recursive: true });
  cpSync(cached, OUT, { recursive: true });
  console.log(`playground: inputs unchanged (${key}); reused the cached build`);
  process.exit(0);
}

console.log(`playground: building (${key})`);
const r = spawnSync('npm', ['--prefix', 'playground', 'run', 'build', '--', '--outDir', '../dist/playground', '--emptyOutDir'], { cwd: ROOT, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
rmSync(CACHE, { recursive: true, force: true });
mkdirSync(cached, { recursive: true });
cpSync(OUT, cached, { recursive: true });
