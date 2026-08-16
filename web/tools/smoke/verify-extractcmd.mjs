// BT-190: proves the extractCmd() fix both directions on synthetic fixtures,
// then runs it over the real probe corpus and prints the affected set so the
// count in probeall.mjs's own header comment can be checked against reality
// rather than trusted. Read-only: touches no probe file.
//
//   node tools/smoke/verify-extractcmd.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCmd, PROSE_ONLY_INVOCATION } from './probeall.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} got=${String(got)} want=${String(want)}`);
  if (!ok) failures++;
}

// ---- direction 1: a file whose ONLY run.mjs-mentioning line is prose must
// be refused LOUDLY (PROSE_ONLY_INVOCATION), not silently accepted as if it
// were a real, flagless command. -------------------------------------------
const proseOnly = [
  '// Some header text.',
  '// run.mjs settles on terrain convergence before it screenshots anything,',
  '// so this probe does not need to wait itself.',
  '(async () => { return { fails: [] }; })();',
].join('\n');
check('prose-only file is refused, not silently accepted', extractCmd(proseOnly), PROSE_ONLY_INVOCATION);

// ---- direction 2: a real command LATER in the file must be found even
// though a prose line mentioning run.mjs comes first. -----------------------
const proseThenReal = [
  '// Pose the camera and leave the world how the shot wants, so run.mjs\'s',
  '// own --out capture photographs it.',
  '//',
  '//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \\',
  '//     --evalfile=tools/smoke/probes/example.js',
  '(async () => { return { fails: [] }; })();',
].join('\n');
// Expected value is DERIVED (join of the two comment bodies with the parser's
// own whitespace handling), not hand-counted, so this checks the real-vs-
// prose SELECTION rather than re-encoding extractCmd's whitespace behaviour.
const proseThenRealExpected = [
  '  node tools/smoke/run.mjs --scenario=walk --sandbox=1 ',
  '    --evalfile=tools/smoke/probes/example.js',
].join(' ');
check(
  'a real command later in the file beats prose earlier in it',
  extractCmd(proseThenReal),
  proseThenRealExpected,
);

// ---- direction 3, the control: a genuinely undocumented file (no run.mjs
// mention anywhere, not even in prose) is untouched by this fix and still
// returns plain null. --------------------------------------------------
const noMentionAtAll = [
  '// A two-phase fixture driven by reload.mjs, not by the smoke runner directly.',
  '(async () => { return { fails: [] }; })();',
].join('\n');
check('no mention anywhere still returns plain null', extractCmd(noMentionAtAll), null);

// ---- direction 4, the control: an already-correct header (real command is
// the FIRST run.mjs-mentioning line) is unaffected. -------------------------
const alreadyCorrect = [
  '// node tools/smoke/run.mjs --scenario=walk \\',
  '//   --evalfile=tools/smoke/probes/example.js',
  '(async () => { return { fails: [] }; })();',
].join('\n');
const alreadyCorrectExpected = [
  'node tools/smoke/run.mjs --scenario=walk ',
  '  --evalfile=tools/smoke/probes/example.js',
].join(' ');
check(
  'an already-correct header is unaffected',
  extractCmd(alreadyCorrect),
  alreadyCorrectExpected,
);

// ---- the corpus-wide count, so the number in probeall.mjs's comment is
// checked against the live tree rather than copied from the census. --------
const probeDir = join(here, 'probes');
function excludedReason(src) {
  const lines = src.split(/\r?\n/).slice(0, 60);
  for (const l of lines) {
    const m = /^\s*\/\/\s*PROBEALL-EXCLUDE:\s*(.+?)\s*$/.exec(l);
    if (m) return m[1];
  }
  return null;
}
const files = readdirSync(probeDir).filter((f) => f.endsWith('.js')).sort();
const proseOnlyFiles = [];
const total = files.length;
let excludedCount = 0;
for (const f of files) {
  const src = readFileSync(join(probeDir, f), 'utf8');
  if (excludedReason(src)) { excludedCount++; continue; }
  if (extractCmd(src) === PROSE_ONLY_INVOCATION) proseOnlyFiles.push(f);
}
console.log(`\ncorpus: ${total} probe files, ${excludedCount} excluded, `
  + `${proseOnlyFiles.length} PROSE_ONLY_INVOCATION (named, not silently defaulted):`);
for (const f of proseOnlyFiles) console.log(`  ${f}`);

console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
