// ARCHITECTURE.md section 2.2 rule 1: 400 lines hard cap per source file, and
// rule 4: src/ui imports zero three.js. Both are structural, so they are checked
// mechanically rather than by review. Exit 1 on any violation.
//
// THE CAP VIOLATIONS CARRY A TWO-SIDED DATED BASELINE (BT-8x, BT-41 point 7),
// `check-limits-known-over.json`, the same rule known-red.json applies to
// probes: a listed file passes ONLY when its line count matches the recorded
// count EXACTLY. Grown past it, shrunk but still over, or dropped under the
// cap entirely all still FAIL, so the baseline is a claim that gets checked
// every run rather than a one-way suppression nobody revisits. This makes the
// cap enforceable again today (BT-42: it had been dead for 407 commits behind
// an `&&` chain) without requiring the 40-plus-file refactor first; it does
// NOT excuse any of those files from eventually coming under the cap.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'src');
const CAP = 400;
const baselinePath = join(root, 'scripts', 'check-limits-known-over.json');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|glsl)$/.test(e)) out.push(p);
  }
  return out;
}

function loadBaseline() {
  if (!existsSync(baselinePath)) return new Map();
  const doc = JSON.parse(readFileSync(baselinePath, 'utf8'));
  return new Map((doc.entries ?? []).map((e) => [e.file, e]));
}

const baseline = loadBaseline();
const overCap = new Map(); // rel path -> line count, this run
const structuralViolations = [];
for (const file of walk(srcRoot)) {
  const rel = relative(root, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').length;
  if (lines > CAP) overCap.set(rel, lines);
  if (rel.startsWith('src/ui/') && /from\s+['"]three/.test(text)) {
    // No baseline: an ARCHITECTURE.md layering rule, not a size the codebase
    // can carry a legacy count of.
    structuralViolations.push(`${rel}: src/ui must import zero three.js`);
  }
}

const failures = [...structuralViolations];
const known = [];
for (const [rel, lines] of overCap) {
  const entry = baseline.get(rel);
  if (!entry) { failures.push(`${rel}: ${lines} lines > ${CAP} cap, NEW (not in check-limits-known-over.json)`); continue; }
  if (lines === entry.lines) { known.push(`${rel}: ${lines} lines, known over cap since ${entry.base}, owner ${entry.owner}`); continue; }
  failures.push(`${rel}: ${lines} lines > ${CAP} cap, but check-limits-known-over.json expects exactly `
    + `${entry.lines} (${lines > entry.lines ? 'grew' : 'shrank'}). Update the baseline in the same commit.`);
}
for (const [rel, entry] of baseline) {
  if (!overCap.has(rel)) failures.push(`${rel}: listed in check-limits-known-over.json at ${entry.lines} lines `
    + `but is now <= ${CAP}. Expected over cap and came back under: DELIST IT in the commit that fixed it.`);
}

if (failures.length) {
  console.error('check-limits FAIL:');
  for (const v of failures) console.error('  ' + v);
  process.exit(1);
}
if (known.length) {
  console.log(`check-limits: ${known.length} file(s) KNOWN OVER CAP (see check-limits-known-over.json):`);
  for (const k of known) console.log('  ' + k);
}
console.log(`check-limits OK (${walk(srcRoot).length} files, ${known.length} known-over-cap, 0 new violations)`);
