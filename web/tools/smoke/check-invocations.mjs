// check-invocations.mjs (BT-225 to BT-239). AUTHORING-TIME GATE: a probe with
// no documented invocation FAILS A CHECK, by name, instead of being filed
// away and silently skipped the next time somebody sweeps the corpus.
//
// WHY THIS EXISTS. `probeall.mjs`'s census already recognises three probes'
// worth of exactly this shape and has for a while: a probe with no `run.mjs`
// header lands in bucket `NO_DOCUMENTED_CMD` or `PROSE_ONLY_INVOCATION` and
// the sweep moves on. That bucket is correct and necessary FOR A CENSUS --
// BT-115, BT-155, BT-175 and BT-190 all depend on being able to survey the
// whole corpus without one bad header aborting the run. It is the wrong
// answer for AUTHORING, because a census is something a lane chooses to run;
// a new probe can land, get called green by whoever wrote it (a single
// `node tools/smoke/run.mjs ... --evalfile=...` by hand), and sit
// undiscovered until the next multi-hour sweep, which is exactly what
// happened to `vmlight.js`, `vmshade.js` and `vmcost.js` (RN-1990..1997) --
// the SEVENTH time this shape has been found (BT-190's twenty prose-matched
// probes, `orbitdeck.js`, `airlock.js`, and now these three).
//
// So this is a second, separate, FAST instrument: a pure static scan, no
// browser, no build, no served tree, that a lane can run in well under a
// second and that is cheap enough to sit in `npm run check`. It reuses the
// exact parser `probeall.mjs` uses -- `extractCmd`, `PROSE_ONLY_INVOCATION`
// and `excludedReason`, imported, not reimplemented, per the standing rule
// that two copies of a parser drift (see `verify-extractcmd.mjs`, which
// proves the parser itself both ways on synthetic fixtures; this file proves
// the POLICY built on top of it: undocumented-and-not-exempt is a FAILURE).
//
//   node tools/smoke/check-invocations.mjs
//   node tools/smoke/check-invocations.mjs --selftest
//
// THE ONLY EXEMPTION HONOURED is the one the census already has,
// `// PROBEALL-EXCLUDE: <reason>` in a probe's first 60 lines (BT-115): a
// genuine two-phase fixture driven by another harness (`reload.mjs`,
// `twobody.mjs`, ...) that was never meant to carry a `run.mjs` line. This
// gate does not invent a second, silent way to skip a probe -- an exemption
// has to say so in the same form the census already parses, and every
// exemption is COUNTED and NAMED in this gate's own output, never absorbed
// silently into a passing count.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCmd, PROSE_ONLY_INVOCATION, excludedReason } from './probeall.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const probeDir = join(here, 'probes');

// ---- selftest, run unconditionally (check-roles.mjs's own precedent: a gate
// whose own arming check is never exercised is a log line, not a control). --
function selftest() {
  const cases = [
    {
      name: 'a file with no run.mjs mention anywhere is an OFFENDER (NO_DOCUMENTED_CMD)',
      src: ['// A probe with no header at all.', '(async()=>({fails:[]}))();'].join('\n'),
      wantOffender: true,
    },
    {
      name: 'a file whose only run.mjs-mentioning line is prose is an OFFENDER (PROSE_ONLY_INVOCATION)',
      src: ['// run.mjs settles before this probe screenshots anything.',
        '(async()=>({fails:[]}))();'].join('\n'),
      wantOffender: true,
    },
    {
      name: 'a file with a real documented invocation is NOT an offender',
      src: ['// node tools/smoke/run.mjs --scenario=walk \\',
        '//   --evalfile=tools/smoke/probes/example.js',
        '(async()=>({fails:[]}))();'].join('\n'),
      wantOffender: false,
    },
    {
      name: 'a file with no invocation but a PROBEALL-EXCLUDE header is EXEMPT, not an offender',
      src: ['// PROBEALL-EXCLUDE: two-phase fixture, driven by reload.mjs',
        '(async()=>({fails:[]}))();'].join('\n'),
      wantOffender: false,
    },
  ];
  const fails = [];
  for (const c of cases) {
    const excluded = excludedReason(c.src);
    const cmd = excluded ? null : extractCmd(c.src);
    const isOffender = !excluded && (cmd === null || cmd === PROSE_ONLY_INVOCATION);
    if (isOffender !== c.wantOffender) {
      fails.push(`${c.name}: got offender=${isOffender}, want offender=${c.wantOffender}`);
    }
  }
  return { pass: fails.length === 0, fails };
}

const st = selftest();
if (!st.pass) {
  console.error('check-invocations: SELFTEST FAILED, refusing to trust the real scan:');
  for (const f of st.fails) console.error(`  ${f}`);
  process.exit(2);
}

const argv = new Set(process.argv.slice(2));
if (argv.has('--selftest')) {
  console.log('check-invocations: selftest 4/4 PASS');
  process.exit(0);
}

// ---- the real corpus scan --------------------------------------------------
const files = readdirSync(probeDir).filter((f) => f.endsWith('.js')).sort();
const offenders = [];
const exempt = [];
let ok = 0;
for (const f of files) {
  const src = readFileSync(join(probeDir, f), 'utf8');
  const reason = excludedReason(src);
  if (reason) { exempt.push({ f, reason }); continue; }
  const cmd = extractCmd(src);
  if (cmd === null) { offenders.push({ f, cls: 'NO_DOCUMENTED_CMD' }); continue; }
  if (cmd === PROSE_ONLY_INVOCATION) { offenders.push({ f, cls: 'PROSE_ONLY_INVOCATION' }); continue; }
  ok++;
}

// Exemptions are printed LOUDLY and always, whether or not anything fails --
// BT-225's brief is explicit that a silent exemption is exactly the class of
// bug this gate exists to close, so "exempt" must never read like "passed
// without a trace".
console.log(`check-invocations: ${files.length} probe files, ${ok} carry a real `
  + `documented invocation, ${exempt.length} EXEMPT (PROBEALL-EXCLUDE), `
  + `${offenders.length} OFFENDER(S).`);
if (exempt.length > 0) {
  console.log('EXEMPT (named, not silent):');
  for (const e of exempt) console.log(`  ${e.f}: ${e.reason}`);
}

if (offenders.length > 0) {
  console.error('\ncheck-invocations FAIL. The following probe(s) have no line '
    + 'extractCmd() accepts as a real invocation (a line that actually STARTS '
    + '`node ... run.mjs`, not merely mentions it) and carry no '
    + '`// PROBEALL-EXCLUDE: <reason>` header:');
  for (const o of offenders) {
    console.error(`  ${o.f}: ${o.cls}`);
  }
  console.error('\nFix: give each file above a real `// node tools/smoke/run.mjs ...` '
    + 'header chosen from what the probe itself needs (see BT-192 for the method), '
    + 'or, if it is genuinely a two-phase fixture with no invocation of its own, '
    + 'add `// PROBEALL-EXCLUDE: <reason>` in its first 60 lines.');
  process.exit(1);
}

console.log('check-invocations: PASS, every probe file is either documented or exempt.');
process.exit(0);
