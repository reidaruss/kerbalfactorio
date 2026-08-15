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

const here = dirname(fileURLToPath(import.meta.url));
const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
const url = args.get('url') ?? 'http://127.0.0.1:4262/';
const tree = resolve(args.get('tree') ?? join(here, 'tree'));
const only = args.get('only');           // comma list of probe basenames
const limit = Number(args.get('limit') ?? 0);
const timeoutMs = Number(args.get('timeout') ?? 240000);
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
function excludedReason(src) {
  const lines = src.split(/\r?\n/).slice(0, 60);
  for (const l of lines) {
    const m = /^\s*\/\/\s*PROBEALL-EXCLUDE:\s*(.+?)\s*$/.exec(l);
    if (m) return m[1];
  }
  return null;
}

// ---- BT-130: a documented PER-PROBE timeout override -----------------------
// `cantilever.js` and `machineports.js` both hit the shared `timeoutMs`
// (default 240000) inside the BT-116 sweep and were recorded NO_OUTPUT.
// Re-run standalone on a quiet machine (2026-08-15, lane/probeall-debts),
// with NO wrapper timeout at all so the real cost could be measured:
// `cantilever.js` finished GREEN in 238.2 s, 1.8 s inside the 240 s cap with
// zero contention; `machineports.js` finished (RED on an unrelated assertion,
// see its own header) in 298.5 s, which is past the cap even completely
// alone. Neither is the sweep's parallelism inventing a cost that is not
// there: `machineports.js` cannot fit the shared budget under any
// concurrency, and `cantilever.js` has essentially no margin left for GC
// pauses or a second probe's Chrome instance sharing the CPU, which is
// exactly the class BT-116's 4-way batch would have induced.
//
// The instruction from the brief that fixed this is explicit: do not
// silently raise the GLOBAL timeout for every probe to cover two outliers.
// So the override is opt-in, per-probe, and requires the same kind of visible
// justification `PROBEALL-EXCLUDE` does: a probe's header may carry
//   // PROBEALL-TIMEOUT: <milliseconds>
// anywhere in its first 60 lines, read here and applied ONLY to that probe's
// own run, leaving every other probe (including a probe with no comment at
// all) on the shared default. `cantilever.js` and `machineports.js` both
// carry one now, with the measurement that justifies the number recorded in
// the same comment.
function timeoutOverrideMs(src) {
  const lines = src.split(/\r?\n/).slice(0, 60);
  for (const l of lines) {
    const m = /^\s*\/\/\s*PROBEALL-TIMEOUT:\s*(\d+)\s*$/.exec(l);
    if (m) return Number(m[1]);
  }
  return null;
}

// ---- extract the documented invocation from the header comment -------------
// The command sits in a `//` block, one flag per token, with `\` continuations.
function extractCmd(src) {
  const lines = src.split(/\r?\n/);
  let i = lines.findIndex((l) => /^\s*\/\/.*run\.mjs/.test(l));
  if (i === -1) return null;
  const parts = [];
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\s*\/\//.test(l)) break;
    const body = l.replace(/^\s*\/\/\s?/, '');
    parts.push(body.replace(/\\\s*$/, ''));
    if (!/\\\s*$/.test(body)) break;
  }
  return parts.join(' ');
}

const PLACEHOLDER = /^(\.\.\.|<.*>|\$.*|\.\.\.\.)$/;

function flagsOf(cmd) {
  const out = [];
  const bad = [];
  for (const tok of cmd.split(/\s+/)) {
    const m = /^--([A-Za-z0-9_-]+)(?:=(.*))?$/.exec(tok);
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
// THERE ARE FOUR VERDICT CONVENTIONS, NOT TWO. `valid` and `fails[]` are the
// common pair, but seven probes carry only a boolean `ok` (animgate, padflat,
// zerog, ...) and some carry `pass`. A census that knew only two names would
// have filed those under NO_VERDICT and missed any red among them, which is the
// audit committing the defect it is auditing. The runtime `evalKeys` recorded
// below is what makes that claim checkable rather than asserted.
function verdictOf(ev) {
  if (ev === undefined || ev === null || typeof ev !== 'object') return { cls: 'NO_VERDICT', fails: [] };
  const hasFails = Array.isArray(ev.fails);
  const bools = ['valid', 'ok', 'pass'].filter((k) => typeof ev[k] === 'boolean');
  if (!hasFails && bools.length === 0) return { cls: 'NO_VERDICT', fails: [] };
  const fails = hasFails ? ev.fails.map(String) : [];
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

function run(cmd, argv, cwd, probeFile, runTimeoutMs) {
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
  const probeTimeoutMs = timeoutOverrideMs(src) ?? timeoutMs;
  const cmd = extractCmd(src);
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
    queue.push({ f, flags: [], bad: [], cmd: '(defaults; probe documents no invocation)', defaults: true, timeoutMs: probeTimeoutMs });
    continue;
  }
  if (args.has('nodocs')) continue;
  idx++;
  if (shards > 1 && idx % shards !== shard) continue;
  const { flags, bad } = flagsOf(cmd);
  queue.push({ f, flags, bad, cmd, timeoutMs: probeTimeoutMs });
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
  console.error(`[${n}/${queue.length}] ${q.f} running (budget `
    + `${Math.round((q.timeoutMs ?? timeoutMs) / 1000)}s)`);
  const r = await run(process.execPath, argv, webDir, q.f, q.timeoutMs ?? timeoutMs);
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
  if (r.soTruncated) {
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
    timeoutMs: q.timeoutMs ?? timeoutMs,
    parseErr,
    stdoutBytes: r.soBytes,
    stdoutTruncated: r.soTruncated,
    stdoutFile: r.soPath,
    readErr,
    stderrTail: r.se.slice(-600),
  };
  appendFileSync(outFile, JSON.stringify(rec) + '\n');
  console.error(`[${n}/${queue.length}] ${q.f} done exit=${r.code} runner=${rec.runnerSaysPass ? 'PASS' : 'FAIL'} verdict=${v.cls}${v.fails.length ? ` (${v.fails.length})` : ''} ${Math.round(r.ms / 1000)}s`);
}
console.error('probeall: done');
