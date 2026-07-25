// ARCHITECTURE.md section 2.2 rule 1: 400 lines hard cap per source file, and
// rule 4: src/ui imports zero three.js. Both are structural, so they are checked
// mechanically rather than by review. Exit 1 on any violation.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'src');
const CAP = 400;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|glsl)$/.test(e)) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(srcRoot)) {
  const rel = relative(root, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').length;
  if (lines > CAP) violations.push(`${rel}: ${lines} lines > ${CAP} cap`);
  if (rel.startsWith('src/ui/') && /from\s+['"]three/.test(text)) {
    violations.push(`${rel}: src/ui must import zero three.js`);
  }
}

if (violations.length) {
  console.error('check-limits FAIL:');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`check-limits OK (${walk(srcRoot).length} files, all <= ${CAP} lines)`);
