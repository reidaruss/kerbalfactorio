// GATE AUDIT (BT-40). Runs every probe that documents its own invocation and
// records what a runner that HONOURED `fails[]` and `valid` would have said.
//
// It does NOT patch run.mjs. run.mjs already prints the probe's return value as
// `report.eval`; this reads it and applies the verdict the runner throws away.
// That keeps the two signals separate, which is the whole question:
//   - exit code  -> what the runner sees today (console errors / requests / crash)
//   - eval       -> what the probe actually claimed
//
//   node probeall.mjs --url=http://127.0.0.1:4262/ --tree=<isolated tree>
//
// Resumable: one JSON line per probe appended to results.jsonl as it finishes.

import {
  readFileSync, readdirSync, appendFileSync, existsSync, mkdirSync,
  createWriteStream,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// BT-190: the sweep's MAIN FLOW (arg parsing, directory creation, spawning
// probes) is guarded below (search `if (isMain)`), after every pure function
// this file defines, so `verify-extractcmd.mjs` can
// `import { extractCmd, PROSE_ONLY_INVOCATION } from './probeall.mjs'` for
// the parser alone without also running a sweep or requiring `--tree`.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

// ---- BT-115 to BT-129: the extractCmd-null audit ---------------------------
// CE-86 found that a probe documenting no invocation returns `null` from
// extractCmd and drops SILENTLY into NO_DOCUMENTED_CMD, off by default, so
// "not on the red list" and "green" were different claims for 91 probes with
// no way to tell which from this file's own output. Two of those 91 are not
// oversights: a HELPER/FIXTURE that is genuinely not meant to run standalone
// through THIS runner (a two-phase setup probe driven by reload.mjs or
// twobody.mjs, for instance) will never carry a `run.mjs` line and should not
// be made to invent one. The fix is not to force an invocation onto every
// file; it is to make "excluded on purpose" a DIFFERENT, visible verdict from
// "nobody wrote a line yet". A probe is EXCLUDED when its header carries
//   // PROBEALL-EXCLUDE: <reason>
// anywhere in its first 60 lines. That census bucket is checked before
// extractCmd runs at all, and an excluded probe is skipped even under
// --nodocs, because running it at the runner's defaults would not be running
// the thing it was written to do either.
//
// BT-225 to BT-239: exported (was module-private) so `check-invocations.mjs`,
// the authoring-time gate, can recognise the SAME exemption this file already
// honours instead of re-deriving it -- one exemption convention, not two.
export function excludedReason(src) {
  const lines = src.split(/\r?\n/).slice(0, 60);
  for (const l of lines) {
    const m = /^\s*\/\/\s*PROBEALL-EXCLUDE:\s*(.+?)\s*$/.exec(l);
    if (m) return m[1];
  }
  return null;
}

// ---- BT-210 to BT-224: per-probe budgets, ONE committed source of truth ----
// BT-130 introduced a documented PER-PROBE timeout override to fix the same
// problem this section still fixes (the shared default is wrong in both
// directions: too tight for a real outlier like assembler.js, ~730 s
// measured, scored a false NO_OUTPUT identical to a genuine hang, GP-950;
// too loose to catch a real hang quickly for the hundreds of probes that
// finish in seconds). BT-130's fix was a `// PROBEALL-TIMEOUT: <ms>` header
// comment, hand-picked per incident (cantilever.js, machineports.js,
// padgate.js -- three probes, out of a corpus of 300+, each found only
// because it had already caused a false NO_OUTPUT). That does not scale to
// "every probe has a measured budget" and it is a SECOND place a number about
// the sweep can live, which is exactly the kind of drift NUMBERS.md's own
// "completed attribution with no owner" trap describes. It has been
// SUBSUMED: every probe's budget now comes from ONE committed, generated,
// machine-readable file, `web/tools/smoke/probe-budgets.json` (BT-210 to
// BT-224), and the three `PROBEALL-TIMEOUT` header comments that used to
// carry this are deleted from their probe files (the measurement narrative
// in each stays, pointing at the committed file instead of a magic number).
//
// Two numbers per probe, both derived from measured wall time by the ONE
// rule stated in `build-probe-budgets.mjs` (never hand-picked per probe):
//   - `budgetMs`:  a SOFT ceiling. Exceeding it flags `overBudget: true` on
//     an otherwise-normal result; it NEVER turns a GREEN into a fail, and it
//     never doubles up a RED that failed for its own reason. This is the
//     "slow but it finished" signal.
//   - `hardCapMs`: the HARD kill timeout passed to `run()`'s SIGKILL timer,
//     same role BT-130's override played. Being killed here is a `HUNG`
//     verdict: no report was ever produced, which is a fatal, real failure,
//     distinct from a probe that finished (however slowly) with a verdict.
//     "hung" (no output, ever) and "slow" (output, just late) are different
//     facts and this is what keeps them from collapsing onto one NO_OUTPUT
//     the way they did before GP-950's false read.
//
// A probe with no entry in the file (new since the last measurement pass, or
// the budgets file itself missing/unreadable in an older `--tree`) falls back
// to `defaultBudgetMs`/`defaultHardCapMs` from the same file, or the
// hardcoded constants below if the file cannot be read at all -- the same
// shared-default behaviour every probe had before this existed, never a
// silent skip.
const FALLBACK_BUDGET_MS = 300000;
const FALLBACK_HARD_CAP_MS = 720000;

function loadBudgets(tree) {
  const path = join(tree, 'web', 'tools', 'smoke', 'probe-budgets.json');
  try {
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    return {
      probes: doc.probes ?? {},
      defaultBudgetMs: Number(doc.defaultBudgetMs) || FALLBACK_BUDGET_MS,
      defaultHardCapMs: Number(doc.defaultHardCapMs) || FALLBACK_HARD_CAP_MS,
    };
  } catch {
    // Missing/unreadable is not fatal: every probe just runs at the fallback,
    // exactly as it did before this file existed. Loud on stderr so a lane
    // running against a stale `--tree` notices rather than silently getting
    // the fallback for every probe.
    console.error(`probeall: no readable probe-budgets.json at ${path}; every probe uses the `
      + `${FALLBACK_BUDGET_MS}/${FALLBACK_HARD_CAP_MS} ms fallback`);
    return { probes: {}, defaultBudgetMs: FALLBACK_BUDGET_MS, defaultHardCapMs: FALLBACK_HARD_CAP_MS };
  }
}

function budgetFor(budgets, probeFile) {
  const b = budgets.probes[probeFile];
  return {
    budgetMs: b?.budgetMs ?? budgets.defaultBudgetMs,
    hardCapMs: b?.hardCapMs ?? budgets.defaultHardCapMs,
  };
}

// ---- extract the documented invocation from the header comment -------------
// The command sits in a `//` block, one flag per token, with `\` continuations.
//
// BT-190: the old version took the FIRST `//` line that merely MENTIONED
// `run.mjs`, with no check that the line actually STARTED an invocation. A
// probe whose only such line was prose ("run.mjs's own --out screenshot
// happens after settle()...") returned that prose as `cmd`; `flagsOf()` then
// reduced it to whatever `--flag` tokens happened to appear in the sentence
// (usually none, since url/out/evalfile are excluded from `flags` and prose
// rarely contains a real flag by accident), so the probe queued and ran at
// the runner's bare defaults while this file believed it had a documented
// command. A mechanical corpus scan (BT-190, superseding BT-184's manual
// count of 19) found **20** probes carrying this trap beyond `airlock.js`
// (BT-183) and `orbitdeck.js` (BT-176), which were fixed by hand before this
// parser fix existed: 16 with no real invocation anywhere in the file, and 4
// -- not 3 -- where a real invocation exists further down but the first
// prose match short-circuited before ever reaching it (`artshot.js`,
// `flyto.js`, `popshot.js`, plus `padflat.js`, missed by the manual BT-184
// pass because it is a probe added to the corpus after that census).
//
// THE FIX, proven both ways in `tools/smoke/verify-extractcmd.mjs`: a candidate
// line must actually START an invocation (`node ... run.mjs`, matched
// against the WHOLE trimmed comment body, not merely contain the substring
// `run.mjs` anywhere in a sentence), tried in file order so a real command
// later in the file wins over prose earlier in it. A file with `run.mjs`
// mentioned only in prose -- no line anywhere starts a real invocation --
// now returns the LOUD sentinel `PROSE_ONLY_INVOCATION` instead of silently
// falling through to `flagsOf('')`'s empty array, so it is named in the
// census as a probe that needs a real header written, exactly the class
// `UNRECOGNISED_VERDICT_SHAPE` (BT-175) named for `verdictOf()`'s gap rather
// than let it default. A file with no `run.mjs` mention anywhere (a genuine
// two-phase fixture with no invocation to document) is unaffected and still
// returns plain `null`, which `excludedReason()` or `NO_DOCUMENTED_CMD`
// already handle correctly.
const REAL_INVOCATION_START = /^node\b[\s\S]*run\.mjs\b/;
export const PROSE_ONLY_INVOCATION = Symbol('PROSE_ONLY_INVOCATION');
export function extractCmd(src) {
  const lines = src.split(/\r?\n/);
  let sawMention = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\s*\/\/.*run\.mjs/.test(l)) continue;
    sawMention = true;
    const firstBody = l.replace(/^\s*\/\/\s?/, '').trim();
    if (!REAL_INVOCATION_START.test(firstBody)) continue; // prose that merely says the words
    const parts = [];
    for (let j = i; j < lines.length; j++) {
      const lj = lines[j];
      if (!/^\s*\/\//.test(lj)) break;
      const body = lj.replace(/^\s*\/\/\s?/, '');
      parts.push(body.replace(/\\\s*$/, ''));
      if (!/\\\s*$/.test(body)) break;
    }
    return parts.join(' ');
  }
  return sawMention ? PROSE_ONLY_INVOCATION : null;
}

const PLACEHOLDER = /^(\.\.\.|<.*>|\$.*|\.\.\.\.)$/;

// BT-265 to BT-269: exported (was module-private, same reasoning as
// `excludedReason`/`extractCmd` at BT-225) so `check-invocations.mjs` can
// classify the SAME flag-token shape this file's own sweep already uses to
// build a probe's argv, instead of re-deriving a second regex that could
// drift from this one. A token this pattern does not match is exactly what
// `flagsOf()`'s `continue` below drops SILENTLY -- correct for `flagsOf()`'s
// own job (build the argv from what IS a flag), wrong for a well-formedness
// gate, whose job is to notice when something that was clearly MEANT to be a
// flag value got split off and dropped instead.
export const FLAG_TOKEN_RE = /^--([A-Za-z0-9_-]+)(?:=(.*))?$/;

export function flagsOf(cmd) {
  const out = [];
  const bad = [];
  for (const tok of cmd.split(/\s+/)) {
    const m = FLAG_TOKEN_RE.exec(tok);
    if (!m) continue;
    const [, k, v0] = m;
    if (k === 'url' || k === 'out' || k === 'evalfile') continue;
    // The documented command is written for a SHELL, so `--evalargs='{"a":1}'`
    // carries the shell's own quotes. spawn() without a shell passes them
    // through, run.mjs substitutes them into the probe wrapper, and OF_ARGS
    // arrives as a STRING instead of an object: every OF_ARGS.foo reads
    // undefined and the probe measures the default while the record says it
    // measured the request. That is run.mjs's own dropped-flag failure one
    // layer out, so strip one matching pair of quotes.
    const v = v0 !== undefined ? v0.replace(/^(['"])([\s\S]*)\1$/, '$2') : v0;
    if (v !== undefined && PLACEHOLDER.test(v)) { bad.push(k); continue; }
    out.push(v === undefined ? `--${k}` : `--${k}=${v}`);
  }
  return { flags: out, bad };
}

// ---- verdict ---------------------------------------------------------------
// What a gate that honoured the probe's own report would say.
//
// THERE ARE FIVE VERDICT CONVENTIONS IN LIVE USE, NOT TWO, NOT FOUR. Every one
// below is confirmed by grepping web/tools/smoke/probes for how the probe
// actually returns, not assumed from one example:
//   1. `fails: [...]`  an array, empty means green    (e.g. terrainspec.js, carrier.js)
//   2. `valid: bool`                                  (e.g. build.js's own completed run)
//   3. `ok: bool`                                      (e.g. animgate.js)
//   4. `pass: bool`                                    (e.g. mapwork.js)
//   5. `fail: "why"`    a SINGULAR truthy string, from an early-return guard
//      shaped `const fail = (why, extra) => ({ fail: why, ...extra })` that
//      short-circuits the whole run before any of 1-4 is ever built
//                                                       (e.g. airlock.js, furnace.js)
// (1)-(4) were the BT-43 fix (the `ok`-only gap). (5) is the BT-155/BT-175
// gap: verdictOf() recognised only 1-4, so six live probes that fail by their
// own report (airlock.js, build.js, furnace.js, furnacelit.js, orbitdeck.js,
// portmigrate.js) sat as NO_VERDICT, invisible to a flipped gate, forever.
// Fixed here by treating a truthy string `fail` exactly like a failed bool.

// Exact-match, case-insensitive, against TOP-LEVEL key names only: deliberately
// not a substring test, so a nested/unrelated key like `validAfterQ` or `okMs`
// does not trip it. Only a key that IS one of these words but is not one of the
// five recognised (name, type) pairs above reaches the check below at all.
const VERDICT_LOOKALIKE = /^(valid|invalid|ok|okay|pass|passed|fail|failed|failure|failures|error|errors|success|succeeded)$/i;

export function verdictOf(ev) {
  if (ev === undefined || ev === null || typeof ev !== 'object') return { cls: 'NO_VERDICT', fails: [] };
  const hasFails = Array.isArray(ev.fails);
  const bools = ['valid', 'ok', 'pass'].filter((k) => typeof ev[k] === 'boolean');
  const hasFail = typeof ev.fail === 'string' && ev.fail.length > 0;
  if (!hasFails && bools.length === 0 && !hasFail) {
    // BT-175: this is where the fifth convention above went unseen. A silent
    // NO_VERDICT here cannot be told apart from a probe that is legitimately
    // report-only by design (telemetry/screenshot dumps with no verdict key
    // at all, ~24 of the 30 probes this census's NO_VERDICT bucket held) from
    // a probe using a SIXTH convention nobody has taught this function yet.
    // Rather than let that repeat silently, flag it LOUD whenever the object
    // carries a key that reads like a verdict field but matched none of the
    // five known shapes (wrong type, near-miss name, etc.): a real
    // report-only probe's keys (texW, drawCalls, footprintM, ...) never look
    // like this, so this does not fire on the legitimate 24.
    const lookalike = Object.keys(ev).filter((k) => VERDICT_LOOKALIKE.test(k));
    if (lookalike.length > 0) {
      return {
        cls: 'UNRECOGNISED_VERDICT_SHAPE',
        fails: [`eval has verdict-shaped key(s) [${lookalike.join(', ')}] that verdictOf() does not `
          + 'recognise (wrong type or unlisted name); teach verdictOf() the convention rather than '
          + 'letting this fall into NO_VERDICT, which is exactly how the singular fail gap (BT-175) '
          + 'went unnoticed'],
      };
    }
    return { cls: 'NO_VERDICT', fails: [] };
  }
  const fails = hasFails ? ev.fails.map(String) : [];
  // BT-175: a report carrying BOTH a truthy `fail` string AND a `fails: []`
  // (present but empty) now flips GREEN to RED, since `hasFail` alone is
  // enough to fall through to the RED branch below. Checked against every
  // convention-4 (`const fail = (why, extra) => ({ fail: why, ...extra })`)
  // early-return guard in the corpus: it always short-circuits the whole
  // run before the normal completion path ever builds a `fails` array, so
  // no real probe can produce this combination today. Recorded here so the
  // next reader does not have to re-derive that this is safe rather than an
  // accidental behaviour change; if a probe is ever written that DOES mix
  // the two, this comment is the trip-wire to come back and re-check it.
  if (hasFail) fails.push(ev.fail);
  const falseOnes = bools.filter((k) => ev[k] !== true);
  if (fails.length > 0 || falseOnes.length > 0) {
    return {
      cls: 'RED',
      fails: [...fails, ...falseOnes.map((k) => `${k}: false${ev.why ? ` (why: ${ev.why})` : ''}`)],
    };
  }
  return { cls: 'GREEN', fails: [] };
}

// ---- BT-130: the stdout cap that ate a verdict --------------------------
// The old code capped captured stdout in memory at a fixed 400000 bytes. That
// looked like a safety limit and was actually a correctness bug: run.mjs's
// report is ONE `console.log(JSON.stringify(report, null, 2))` call (stats,
// world, scene, THEN eval), so the verdict-bearing `eval` key sits near the
// END of the blob, after whatever `scene`/`world` dumped. `propshadow.js`
// (8.4 MB) and `r17_scout.js` both exited 0 with a real, complete report, and
// the cap sliced the JSON off mid-string before `eval` ever arrived. The
// parse then threw ("Unterminated string in JSON..."), and because the code
// below could not tell "the process printed nothing" from "the process
// printed plenty and we stopped listening", both collapsed onto the same
// NO_OUTPUT verdict as a probe that actually crashed. That is the exact
// failure this audit exists to find, reproduced by the audit's own tool: a
// uniform verdict standing in for two different facts.
//
// THE FIX IS TO STOP CAPPING IN MEMORY, NOT TO PICK A BIGGER NUMBER. Any
// fixed byte cap is guessable-around by the next probe that dumps a bigger
// scene, and "keep only head plus tail" was considered and rejected: the
// object being parsed is a single JSON value, not a line-oriented log, so a
// head+tail splice almost never reassembles into valid JSON and would trade
// one silent failure mode for a subtler one. Capping what probes may print
// was also rejected per the brief: that means auditing and possibly editing
// every probe that ever grows its report, forever, instead of fixing the one
// place that reads it.
//
// So stdout is streamed straight to a per-probe file on disk (`stdoutDir`)
// as it arrives, and read back in full after the process closes. Nothing
// is truncated by construction: the file grows with the process's real
// output, and disk is not the scarce resource an in-memory accumulator was
// guarding. The only remaining limit is `SAFETY_CAP_BYTES`, sized two full
// orders of magnitude above the 8.4 MB report that started this, as a
// backstop against a genuinely runaway process (an infinite loop spewing
// text) rather than a normal large report. Hitting it is recorded LOUDLY: a
// distinct `TRUNCATED_OUTPUT` verdict class with the byte counts in `fails`,
// never a silent fold into NO_OUTPUT.
const SAFETY_CAP_BYTES = 800 * 1000 * 1000; // 800 MB; propshadow.js's 8.4 MB report is 0.01x this.

function safeStdoutName(probeFile) {
  return probeFile.replace(/\.js$/, '').replace(/[^A-Za-z0-9_.-]/g, '_') + '.stdout.json';
}

// BT-190: `stdoutDir` is a parameter, not a closure over module-scope state,
// so this function (and everything above it) can be imported by
// `verify-extractcmd.mjs` without also importing the side-effecting main
// flow below, which used to run at module-load time regardless of whether
// the file was executed directly or imported for its parser.
function run(cmd, argv, cwd, probeFile, runTimeoutMs, stdoutDir) {
  return new Promise((res) => {
    const t0 = Date.now();
    const soPath = join(stdoutDir, safeStdoutName(probeFile));
    const soStream = createWriteStream(soPath);
    let soBytes = 0;
    let soTruncated = false;
    // NOT shell:true. process.execPath is "C:\Program Files\nodejs\node.exe" and
    // cmd.exe splits it at the space, so every run died before the browser with
    // "'C:\Program' is not recognized" and the harness recorded NO_OUTPUT for a
    // probe it had never actually started. A harness bug that reports a uniform
    // verdict is exactly the class this audit exists to find.
    const p = spawn(cmd, argv, { cwd, shell: false });
    let se = '';
    const seCap = 400000; // stderr is only ever grepped for a few tail lines, never JSON-parsed for a verdict, so a cap here does not risk losing one.
    p.stdout.on('data', (d) => {
      soBytes += d.length;
      if (soBytes <= SAFETY_CAP_BYTES) soStream.write(d);
      else soTruncated = true;
    });
    // GP-982. THE SWEEP HAD THE SAME BLIND SPOT THE RUNNER DID.
    //
    // `se` is accumulated and only ever read AFTER the child closes, and the
    // `[n/total]` line below is printed after that too, so during a 30-minute
    // probe this file printed nothing at all. Anyone watching a sweep saw the
    // same undifferentiated silence a hung probe produces, which is precisely
    // what turned `probes/padgate.js`'s legitimate half hour into a reported
    // stall on 2026-08-15 (NUMBERS.md, GP-983).
    //
    // run.mjs now emits `smoke: alive <s> stage=... | ...` on ITS stderr; this
    // forwards those lines through, prefixed with the probe, as they arrive.
    // Deliberately narrow: ONLY the heartbeat line is forwarded, so the sweep's
    // console does not turn into every probe's full `[page]` log, and nothing
    // here touches stdout, which is the single JSON value `JSON.parse` below
    // depends on.
    let seLine = '';
    p.stderr.on('data', (d) => {
      if (se.length < seCap) se += d;
      seLine += d;
      const parts = seLine.split(/\r?\n/);
      seLine = parts.pop() ?? '';
      for (const l of parts) {
        if (/^smoke: alive /.test(l)) console.error(`  [${probeFile}] ${l}`);
      }
    });
    // `se` is read here, not threaded through `partial`, so the error branch's
    // appended message is never shadowed by a stale copy taken earlier.
    const finish = (partial) => new Promise((r2) => {
      soStream.end(() => r2({
        ...partial, soPath, soBytes, soTruncated, se, ms: Date.now() - t0,
      }));
    });
    const timer = setTimeout(async () => {
      p.kill('SIGKILL');
      res(await finish({ code: null, timedOut: true }));
    }, runTimeoutMs);
    p.on('close', async (code) => { clearTimeout(timer); res(await finish({ code, timedOut: false })); });
    p.on('error', async (e) => { clearTimeout(timer); se += String(e); res(await finish({ code: -1, timedOut: false })); });
  });
}

if (isMain) {
const here = dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
// `--summarize=<file>` reads an existing results.jsonl (this run's or an
// earlier one's) and prints the pass/fail/OVER_BUDGET table with no browser,
// no tree, and no probes run -- useful to re-quote a sweep's summary later
// without paying for the sweep again.
if (args.has('summarize')) {
  printSummary(args.get('summarize'));
  process.exit(0);
}
const url = args.get('url') ?? 'http://127.0.0.1:4262/';
const tree = resolve(args.get('tree') ?? join(here, 'tree'));
const only = args.get('only');           // comma list of probe basenames
const limit = Number(args.get('limit') ?? 0);
// An explicit --timeout on the command line is a uniform OVERRIDE of every
// probe's hard cap (used for a from-scratch measurement pass, where the goal
// is one generous shared cap so real wall time can be observed rather than
// clipped). Omitted (the normal case), each probe's hard cap comes from
// probe-budgets.json (BT-210 to BT-224, see loadBudgets/budgetFor above).
const timeoutOverrideCli = args.has('timeout') ? Number(args.get('timeout')) : null;
const budgets = loadBudgets(tree);
// GP-982: forwarded to run.mjs only if given, so the runner's own default (30 s)
// stays the single place the cadence is defined. `--heartbeat=0` silences it.
const heartbeat = args.has('heartbeat') ? Number(args.get('heartbeat')) : null;
const outFile = args.get('results') ?? join(here, 'results.jsonl');
// BT-130: where each probe's raw stdout is captured. See the `cap` comment in
// run() for why this exists instead of an in-memory string.
const stdoutDir = args.get('stdoutdir') ?? join(here, 'stdout');
mkdirSync(stdoutDir, { recursive: true });
// Sharding exists to get the CENSUS quickly. It costs measurement quality:
// several probes assert frame time or draw cost, and INSTRUMENTS.md is explicit
// that timings are worthless while other work runs on the machine. Contention
// makes a probe FAIL, not pass, so a GREEN under a shard is trustworthy and a
// RED is not. Every red from a sharded sweep is re-run serially before it goes
// on the list.
const shard = Number(args.get('shard') ?? 0);
const shards = Number(args.get('shards') ?? 1);

const probeDir = join(tree, 'web', 'tools', 'smoke', 'probes');
const runner = join(tree, 'web', 'tools', 'smoke', 'run.mjs');
const webDir = join(tree, 'web');

const done = new Set();
if (existsSync(outFile)) {
  for (const l of readFileSync(outFile, 'utf8').split(/\r?\n/)) {
    if (!l.trim()) continue;
    try { done.add(JSON.parse(l).probe); } catch { /* partial line */ }
  }
}

let files = readdirSync(probeDir).filter((f) => f.endsWith('.js')).sort();
if (only) { const set = new Set(only.split(',')); files = files.filter((f) => set.has(f) || set.has(f.replace(/\.js$/, ''))); }

const queue = [];
let idx = -1;
for (const f of files) {
  if (done.has(f)) continue;
  const src = readFileSync(join(probeDir, f), 'utf8');
  const excluded = excludedReason(src);
  if (excluded) {
    if (shard === 0) appendFileSync(outFile, JSON.stringify({ probe: f, cls: 'EXCLUDED', reason: excluded }) + '\n');
    continue;
  }
  const { budgetMs, hardCapMs } = budgetFor(budgets, f);
  const probeTimeoutMs = timeoutOverrideCli ?? hardCapMs;
  const cmd = extractCmd(src);
  if (cmd === PROSE_ONLY_INVOCATION) {
    // BT-190: named LOUDLY and never queued, even under --nodocs. This is not
    // "no invocation documented" (NO_DOCUMENTED_CMD's honest case, where
    // --nodocs is a deliberate weaker-evidence fallback); it is "a comment
    // mentions run.mjs but never actually starts a command", which used to
    // run silently at bare defaults while this file's own census called it
    // documented. A probe landing here needs a real header written, not a run.
    if (shard === 0) appendFileSync(outFile, JSON.stringify({ probe: f, cls: 'PROSE_ONLY_INVOCATION' }) + '\n');
    continue;
  }
  if (!cmd) {
    // --nodocs runs the probes that document NO invocation, at the runner's
    // defaults. Their verdicts are reported in their own bucket and are weaker
    // evidence than the documented set: R8 says the scene is part of the
    // measurement, so a red here may only mean the probe was shown the wrong
    // world. A GREEN at defaults is still worth having; a RED is a question.
    if (!args.has('nodocs')) {
      if (shard === 0) appendFileSync(outFile, JSON.stringify({ probe: f, cls: 'NO_DOCUMENTED_CMD' }) + '\n');
      continue;
    }
    idx++;
    if (shards > 1 && idx % shards !== shard) continue;
    queue.push({
      f, flags: [], bad: [], cmd: '(defaults; probe documents no invocation)', defaults: true,
      timeoutMs: probeTimeoutMs, budgetMs,
    });
    continue;
  }
  if (args.has('nodocs')) continue;
  idx++;
  if (shards > 1 && idx % shards !== shard) continue;
  const { flags, bad } = flagsOf(cmd);
  queue.push({ f, flags, bad, cmd, timeoutMs: probeTimeoutMs, budgetMs });
}

console.error(`probeall: ${queue.length} to run (${done.size} already recorded)`);
let n = 0;
for (const q of queue) {
  if (limit && n >= limit) break;
  n++;
  const argv = [runner, `--url=${url}`, ...q.flags,
    ...(heartbeat === null ? [] : [`--heartbeat=${heartbeat}`]),
    `--evalfile=${join(probeDir, q.f)}`];
  // Printed BEFORE the run, not after it. Half of "is this sweep alive" is
  // knowing which probe it is inside; the other half is the forwarded
  // heartbeat in `run()`.
  console.error(`[${n}/${queue.length}] ${q.f} running (hard cap `
    + `${Math.round((q.timeoutMs ?? budgets.defaultHardCapMs) / 1000)}s, soft budget `
    + `${Math.round((q.budgetMs ?? budgets.defaultBudgetMs) / 1000)}s)`);
  const r = await run(process.execPath, argv, webDir, q.f, q.timeoutMs ?? budgets.defaultHardCapMs, stdoutDir);
  // BT-130: stdout is read back from disk, not from a capped in-memory
  // string, so a big-but-complete report (propshadow.js: 8.4 MB) parses the
  // same as a small one. `r.soTruncated` is only ever true against
  // SAFETY_CAP_BYTES (800 MB), a genuinely runaway process, not a normal
  // report.
  let so = '', readErr = null;
  try { so = readFileSync(r.soPath, 'utf8'); } catch (e) { readErr = String(e.message).slice(0, 200); }
  let report = null, parseErr = null;
  if (!r.soTruncated) {
    try { report = JSON.parse(so); } catch (e) { parseErr = String(e.message).slice(0, 200); }
  }
  let v;
  if (r.timedOut) {
    // BT-210 to BT-224: HUNG is its own verdict, not NO_OUTPUT. Both mean "no
    // report was ever produced", but they arrive differently: NO_OUTPUT is a
    // process that exited (crashed, or closed early) without ever printing a
    // parseable report; HUNG is a process still running when its own
    // measured hard cap (probe-budgets.json's hardCapMs, 3x this probe's own
    // worst measured wall time, floor 120 s -- see build-probe-budgets.mjs)
    // ran out and was SIGKILLed. Distinguishing them is the whole point of
    // this decision block: a probe that is merely SLOW (produces a report,
    // just later than its soft budget) must never collapse onto the same
    // bucket as a probe that never produces one at all, the way GP-950's
    // false NO_OUTPUT read did for assembler.js under the old shared 240 s
    // default. HUNG is always fatal/red; there is no soft-budget reading of
    // "never finished".
    v = {
      cls: 'HUNG',
      fails: [`killed at its own hard cap after ${r.ms} ms (cap `
        + `${q.timeoutMs ?? budgets.defaultHardCapMs} ms); no report was ever produced`],
    };
  } else if (r.soTruncated) {
    // LOUD, not a silent NO_OUTPUT: the process was still producing output
    // when the safety cap cut it off, which is a fact about the cap, not
    // about the probe's verdict.
    v = {
      cls: 'TRUNCATED_OUTPUT',
      fails: [`stdout exceeded the ${SAFETY_CAP_BYTES}-byte safety cap `
        + `(saw ${r.soBytes} bytes and counting); this is NOT a verdict, `
        + `re-run standalone and inspect ${r.soPath}`],
    };
  } else if (report) {
    v = verdictOf(report.eval);
  } else {
    v = { cls: 'NO_OUTPUT', fails: [] };
  }
  // A probe that finished (produced a real verdict, was not killed) but took
  // longer than its own soft budget is SLOW, not a content failure: the flag
  // rides alongside whatever verdict it earned (GREEN stays GREEN, RED stays
  // RED for its own reason) and is surfaced separately in the summary, never
  // folded into `fails` and never able to turn a pass into a fail by itself.
  const overBudget = !r.timedOut && r.ms > (q.budgetMs ?? budgets.defaultBudgetMs);
  const runnerFails = (r.se.match(/^ {2}(console\.error|pageerror|requestfailed|runner|console\.warn):.*/gm) ?? []).slice(0, 6);
  const rec = {
    probe: q.f,
    exit: r.code,
    timedOut: r.timedOut,
    ms: r.ms,
    runnerSaysPass: /smoke: PASS/.test(r.se),
    verdict: v.cls,
    evalKeys: report && report.eval && typeof report.eval === 'object' ? Object.keys(report.eval).slice(0, 30) : null,
    failCount: v.fails.length,
    fails: v.fails.slice(0, 12),
    runnerFails,
    flags: q.flags,
    atDefaults: q.defaults === true,
    timeoutMs: q.timeoutMs ?? budgets.defaultHardCapMs,
    budgetMs: q.budgetMs ?? budgets.defaultBudgetMs,
    overBudget,
    parseErr,
    stdoutBytes: r.soBytes,
    stdoutTruncated: r.soTruncated,
    stdoutFile: r.soPath,
    readErr,
    stderrTail: r.se.slice(-600),
  };
  appendFileSync(outFile, JSON.stringify(rec) + '\n');
  console.error(`[${n}/${queue.length}] ${q.f} done exit=${r.code} runner=${rec.runnerSaysPass ? 'PASS' : 'FAIL'} `
    + `verdict=${v.cls}${v.fails.length ? ` (${v.fails.length})` : ''}${overBudget ? ' OVER_BUDGET' : ''} `
    + `${Math.round(r.ms / 1000)}s`);
}
console.error('probeall: done');
printSummary(outFile);
} // isMain

// ---- BT-210 to BT-224: the pass/fail/OVER_BUDGET summary -------------------
// Read back from the results FILE, not from this run's in-memory queue, so it
// reports the true total across a resumed sweep (partial runs included, per
// the file's own resumability) rather than just whatever this invocation
// happened to execute. Callable standalone via `--summarize=<file>` (see
// below `if (isMain)`... this function itself has no side effects) so a
// results file from an earlier run can be summarised without re-running
// anything.
export function printSummary(outFile) {
  if (!existsSync(outFile)) { console.error(`probeall: no results file at ${outFile} to summarise`); return; }
  const byCls = {};
  let overBudgetCount = 0;
  let total = 0;
  for (const l of readFileSync(outFile, 'utf8').split(/\r?\n/)) {
    if (!l.trim()) continue;
    let d;
    try { d = JSON.parse(l); } catch { continue; }
    total++;
    const cls = d.cls || d.verdict || 'UNKNOWN';
    byCls[cls] = (byCls[cls] ?? 0) + 1;
    if (d.overBudget) overBudgetCount++;
  }
  // PASS is exactly GREEN. FAIL is every verdict that means the probe itself
  // is broken or never reported (RED, HUNG, NO_OUTPUT, TRUNCATED_OUTPUT,
  // UNRECOGNISED_VERDICT_SHAPE). Everything else (NO_VERDICT and the
  // documentation-only buckets EXCLUDED/NO_DOCUMENTED_CMD/
  // PROSE_ONLY_INVOCATION) is neither: NO_VERDICT is legitimately a
  // report-only probe by design for most of its members (BT-175), and the
  // documentation buckets never ran at all. OVER_BUDGET is cross-cutting and
  // deliberately excluded from both PASS and FAIL counts: per the BT-210 to
  // BT-224 gate semantics, a slow-but-correct run is visible, not a failure.
  const FAIL_CLASSES = ['RED', 'HUNG', 'NO_OUTPUT', 'TRUNCATED_OUTPUT', 'UNRECOGNISED_VERDICT_SHAPE'];
  const pass = byCls.GREEN ?? 0;
  const fail = FAIL_CLASSES.reduce((s, c) => s + (byCls[c] ?? 0), 0);
  console.error(`probeall summary (${outFile}): ${total} recorded, ${pass} PASS, ${fail} FAIL, `
    + `${overBudgetCount} OVER_BUDGET (informational, not counted in FAIL)`);
  for (const [cls, n] of Object.entries(byCls).sort(([a], [b]) => a.localeCompare(b))) {
    console.error(`  ${cls}: ${n}`);
  }
}
