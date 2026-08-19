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
//
// BT-265 to BT-269: HAVING a documented invocation is not the same as it
// being WELL-FORMED. `shadowk.js` (BT-260, corrected) passed this gate --
// `extractCmd()` returned a non-null, non-`PROSE_ONLY_INVOCATION` string --
// while that string was itself truncated mid-JSON, because a wrapped
// `--evalargs='{...}'` continuation line was missing its trailing `\` AND,
// independently, `extractCmd()`'s own `parts.join(' ')` inserts a bare space
// at the join point regardless of either line's indentation, splitting the
// quoted JSON a second, independent way even once the backslash is restored.
// Both mechanisms have the same signature: a token that was clearly meant to
// be part of a `--flag=value` argument gets silently dropped, because
// `flagsOf()`'s job is to build an argv from what IS a flag, not to notice
// what got left behind. So this gate now runs a second check on every
// documented command, not just "is there one": `wellFormednessDefects()`
// below re-tokenises the SAME extracted string `flagsOf()` receives, walks
// every token in the flag section, and demands each one be a real
// `--flag`/`--flag=value` `flagsOf()`/`FLAG_TOKEN_RE` (imported, not
// re-derived) would accept, OR a documented, benign non-flag marker this
// corpus already uses on purpose (a bare `#` or `|` -- a trailing shell
// comment or a piped second command, both extend to the end of the string
// once the extraction has joined lines -- or a `[--flag=value]`
// bracket-wrapped OPTIONAL flag). Anything else in the flag section is named
// as a lost/malformed token. Separately, every accepted `--evalargs=...`
// value is run through `JSON.parse` (BT-265's other half of the brief),
// because a truncated JSON string is exactly what a dropped token produces
// and `flagsOf()`'s quote-stripping regex silently leaves the leading quote
// on an unterminated value rather than erroring, so the truncation is only
// visible if something downstream actually tries to parse it.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractCmd, PROSE_ONLY_INVOCATION, excludedReason, flagsOf, FLAG_TOKEN_RE,
} from './probeall.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const probeDir = join(here, 'probes');

// ---- well-formedness: does the extracted command actually parse as the
// flags it looks like it documents, with no token silently dropped? --------
function wellFormednessDefects(cmd) {
  const defects = [];
  const tokens = cmd.split(/\s+/).filter(Boolean);
  const firstFlagIdx = tokens.findIndex((t) => t.startsWith('--'));
  if (firstFlagIdx === -1) return defects; // no `--flag` anywhere: nothing to check here
  for (let i = firstFlagIdx; i < tokens.length; i++) {
    const tok = tokens[i];
    // A bare `#` or `|` is a documented, deliberate convention in this corpus
    // (a trailing shell comment naming which site a flag combination covers,
    // e.g. `deepgate.js`/`goalmoot.js`/`lifeless.js`; a pipe into a second
    // command, e.g. `artframe.js`'s `| node tools/smoke/writeshot.mjs ...`)
    // and everything after it is that trailing thing, not a run.mjs flag.
    if (tok === '#' || tok === '|') break;
    // `[--out=docs/screenshots/x.png]` (map3d.js): square brackets are this
    // corpus's convention for "this flag is optional", not a flag itself.
    const bracketed = tok.startsWith('[') && tok.endsWith(']');
    const inner = bracketed ? tok.slice(1, -1) : tok;
    const m = FLAG_TOKEN_RE.exec(inner);
    if (!m) {
      defects.push(`unrecognised token in the flag section: ${JSON.stringify(tok)} `
        + '(not a --flag/--flag=value, not a # or | marker, not a [--flag=value] '
        + 'optional -- most likely a flag value split across a broken line-wrap)');
    }
  }
  const { flags } = flagsOf(cmd);
  for (const f of flags) {
    if (!f.startsWith('--evalargs=')) continue;
    const raw = f.slice('--evalargs='.length);
    try {
      JSON.parse(raw);
    } catch (e) {
      defects.push(`--evalargs value is not valid JSON (${e.message}): ${raw}`);
    }
  }
  return defects;
}

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

// ---- well-formedness selftest, same precedent: an arming check for a check
// that has never been exercised is a log line, not a control. Both directions
// per BT-260's own rule: prove the gate accepts a genuinely well-formed
// command AND catches the actual shapes found broken in this corpus. --------
function wellFormednessSelftest() {
  const cases = [
    {
      name: 'a normal, single-line documented command has zero defects',
      cmd: "node tools/smoke/run.mjs --scenario=walk --evalfile=tools/smoke/probes/x.js --evalargs='{\"a\":1}'",
      wantAny: false,
    },
    {
      // The reconstructed PRE-FIX shadowk.js shape (BT-260): the wrapped
      // continuation line lost its trailing `\`, so extractCmd's own
      // continuation loop stops collecting mid-line and the joined string
      // hands flagsOf a token whose --evalargs value never closes.
      name: 'a --evalargs value truncated mid-JSON (missing continuation backslash, shadowk pre-fix shape) is a defect',
      cmd: 'node tools/smoke/run.mjs --url=http://127.0.0.1:<p>/ --scenario=walk '
        + '--evalfile=tools/smoke/probes/shadowk.js --wait=1200 '
        + '--evalargs=\'{"site":{"name":"mountains","lat":-31.165,',
      wantAny: true,
    },
    {
      // Restoring the backslash is not enough on its own: extractCmd's
      // parts.join(' ') still inserts a bare space at the join point, which
      // lands INSIDE the quoted JSON and splits it into two tokens, the
      // second of which flagsOf's `--flag` regex does not match and silently
      // drops. This is the shape BT-260's fresh-context verifier found after
      // this lane's first pass tested only the backslash half of the bug.
      name: 'a --evalargs value split by the join-point space (backslash restored, shadowk\'s SECOND bug) is a defect',
      cmd: 'node tools/smoke/run.mjs --url=http://127.0.0.1:<p>/ --scenario=walk '
        + '--evalfile=tools/smoke/probes/shadowk.js --wait=1200 '
        + '--evalargs=\'{"site":{"name":"mountains","lat":-31.165, "lon":-86.27401,"yaw":300,"pitch":-6},"sunDot":0.10}\'',
      wantAny: true,
    },
    {
      name: 'a trailing # comment naming which site a flag combo covers (deepgate.js-style) is NOT a defect',
      cmd: 'node tools/smoke/run.mjs --scenario=walk --evalfile=tools/smoke/probes/x.js # the spawn bore',
      wantAny: false,
    },
    {
      name: 'a trailing | pipe into a second command (artframe.js-style) is NOT a defect',
      cmd: 'node tools/smoke/run.mjs --scenario=walk --evalfile=tools/smoke/probes/x.js '
        + '--evalargs=\'{"shot":"forestfloor"}\' | node tools/smoke/writeshot.mjs docs/screenshots/x.png',
      wantAny: false,
    },
    {
      name: 'a [--flag=value] bracket-wrapped optional flag (map3d.js-style) is NOT a defect',
      cmd: 'node tools/smoke/run.mjs --sandbox=1 --evalfile=tools/smoke/probes/x.js [--out=docs/screenshots/x.png]',
      wantAny: false,
    },
    {
      name: 'a well-formed --evalargs token whose JSON is simply invalid (not a split, a typo) is a defect',
      cmd: "node tools/smoke/run.mjs --scenario=walk --evalfile=tools/smoke/probes/x.js --evalargs='{\"a\":1,}'",
      wantAny: true,
    },
    {
      name: 'a genuine stray token with no marker at all (clamprestore.js pre-fix shape) is a defect',
      cmd: 'node tools/smoke/run.mjs --url=... --sandbox=1 --debug=1 // --evalfile=tools/smoke/probes/x.js',
      wantAny: true,
    },
  ];
  const fails = [];
  for (const c of cases) {
    const got = wellFormednessDefects(c.cmd);
    const gotAny = got.length > 0;
    if (gotAny !== c.wantAny) {
      fails.push(`${c.name}: got ${got.length} defect(s) [${got.join(' | ')}], want `
        + `${c.wantAny ? 'at least one' : 'zero'}`);
    }
  }
  return { pass: fails.length === 0, fails, count: cases.length };
}

const st = selftest();
const wfSt = wellFormednessSelftest();
if (!st.pass || !wfSt.pass) {
  console.error('check-invocations: SELFTEST FAILED, refusing to trust the real scan:');
  for (const f of st.fails) console.error(`  ${f}`);
  for (const f of wfSt.fails) console.error(`  ${f}`);
  process.exit(2);
}

const argv = new Set(process.argv.slice(2));
if (argv.has('--selftest')) {
  console.log(`check-invocations: selftest 4/4 PASS, well-formedness selftest ${wfSt.count}/${wfSt.count} PASS`);
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
  const defects = wellFormednessDefects(cmd);
  if (defects.length > 0) { offenders.push({ f, cls: 'MALFORMED_INVOCATION', defects }); continue; }
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
    + '`node ... run.mjs`, not merely mentions it), or the invocation it extracts '
    + 'is not well-formed (a token silently lost from the flag section, or a '
    + '--evalargs value that is not valid JSON), and carry no '
    + '`// PROBEALL-EXCLUDE: <reason>` header:');
  for (const o of offenders) {
    console.error(`  ${o.f}: ${o.cls}`);
    if (o.cls === 'MALFORMED_INVOCATION') {
      for (const d of o.defects) console.error(`    - ${d}`);
    }
  }
  console.error('\nFix: give each file above a real `// node tools/smoke/run.mjs ...` '
    + 'header chosen from what the probe itself needs (see BT-192 for the method), '
    + 'or, if it is genuinely a two-phase fixture with no invocation of its own, '
    + 'add `// PROBEALL-EXCLUDE: <reason>` in its first 60 lines. A MALFORMED_INVOCATION '
    + 'usually means a multi-line --evalargs wrap lost a token: collapse it back onto '
    + 'one comment line (shadowk.js\'s BT-260 fix) or fix the line-continuation backslash.');
  process.exit(1);
}

console.log('check-invocations: PASS, every probe file is either documented, well-formed, or exempt.');
process.exit(0);
