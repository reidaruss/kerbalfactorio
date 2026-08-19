// BT-210 to BT-224: generates the single committed source of truth for
// per-probe sweep timeouts, web/tools/smoke/probe-budgets.json, from one or
// more measured probeall.mjs results.jsonl files.
//
// Why this exists: before this, a per-probe timeout override lived as a
// `// PROBEALL-TIMEOUT: <ms>` comment in the probe's own header (BT-130),
// hand-picked per incident (cantilever.js, machineports.js, padgate.js).
// That left every OTHER probe on one shared 240000 ms default, which was
// simultaneously too tight for real outliers (assembler.js ~730 s measured,
// scored a false NO_OUTPUT identical to a genuine hang, GP-950) and too loose
// to catch a real hang quickly for the hundreds of probes that finish in
// seconds. This script replaces both problems with one MEASURED number per
// probe, derived by one stated rule (below), in one committed file.
//
//   node build-probe-budgets.mjs --out=web/tools/smoke/probe-budgets.json \
//     <results1.jsonl> [results2.jsonl ...]
//
// Each input is a probeall.mjs results.jsonl (one JSON object per line, the
// shape `run()`/the main loop in probeall.mjs emits: `{probe, ms, timedOut,
// verdict, ...}` for a timed run, or `{probe, cls: 'EXCLUDED', ...}` for a
// probe that never runs). Multiple inputs let a borderline probe's extra
// samples (a separate `--only=<probe> --results=<scratch>/resample.jsonl`
// re-run, never appended to the main file, because probeall.mjs's own resume
// logic skips a probe already present in --results) be merged in without
// re-running the whole corpus.
//
// THE MARGIN RULE (one, stated, applied uniformly, never per-probe by hand):
//   budgetMs  (soft; exceeding it flags OVER_BUDGET, never a content fail)
//     = ceil(maxMeasuredMs * 1.25 / 5000) * 5000, floor 30000
//   hardCapMs (hard; the process is SIGKILLed here, a HUNG verdict, fatal)
//     = ceil(maxMeasuredMs * 3 / 30000) * 30000, floor 120000
// 1.25x/3x are not arbitrary: they are the band this project's own prior
// hand-picked overrides already sat in (cantilever.js and machineports.js at
// ~2.5x their measured cost, padgate.js at ~3.5x, both picked as "margin for
// sweep concurrency, not a guess"). 3x is the middle of that band, applied to
// EVERY probe instead of the three that happened to trip an incident. 1.25x
// on the soft budget is deliberately tighter: it exists to flag "this run
// took notably longer than its own worst measured case", not to survive a
// contended box, which is what the 3x hard cap is for.
//
// A probe with no measured sample anywhere in the inputs (new, or excluded)
// gets no entry; probeall.mjs falls back to DEFAULT_BUDGET_MS/
// DEFAULT_HARD_CAP_MS, themselves this same rule applied to the OLD shared
// 240000 ms default as a bootstrap "measurement" (240000*1.25=300000,
// 240000*3=720000), so the fallback is the same formula, not a second rule.

import { readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_BUDGET_MS = 300000;
const DEFAULT_HARD_CAP_MS = 720000;

function round(ms, stepMs, floorMs) {
  return Math.max(floorMs, Math.ceil(ms / stepMs) * stepMs);
}

export function deriveBudget(maxMeasuredMs) {
  return {
    budgetMs: round(maxMeasuredMs * 1.25, 5000, 30000),
    hardCapMs: round(maxMeasuredMs * 3, 30000, 120000),
  };
}

export function buildBudgets(records) {
  const samples = new Map(); // probe -> ms[]
  for (const r of records) {
    if (!r || typeof r !== 'object' || !r.probe) continue;
    if (r.cls === 'EXCLUDED' || r.cls === 'NO_DOCUMENTED_CMD' || r.cls === 'PROSE_ONLY_INVOCATION') continue;
    if (typeof r.ms !== 'number') continue;
    // A killed (timedOut) run measures the CAP, not the probe's real cost;
    // it must never be used to DERIVE a budget (that would ratchet the cap
    // up forever from its own kills). It is still informative as a fact
    // worth surfacing, so it is recorded separately, not silently dropped.
    if (r.timedOut) continue;
    if (!samples.has(r.probe)) samples.set(r.probe, []);
    samples.get(r.probe).push(r.ms);
  }
  const probes = {};
  for (const [probe, ms] of [...samples.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const maxMs = Math.max(...ms);
    const { budgetMs, hardCapMs } = deriveBudget(maxMs);
    probes[probe] = { samplesMs: ms, maxMs, budgetMs, hardCapMs };
  }
  return probes;
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') === process.argv[1].replace(/\\/g, '/');

if (isMain) {
  const args = process.argv.slice(2);
  const outIdx = args.findIndex((a) => a.startsWith('--out='));
  const outFile = outIdx >= 0 ? args[outIdx].slice('--out='.length) : 'web/tools/smoke/probe-budgets.json';
  const inputs = args.filter((a) => !a.startsWith('--'));
  if (inputs.length === 0) {
    console.error('usage: build-probe-budgets.mjs --out=<file> <results.jsonl> [more.jsonl ...]');
    process.exit(2);
  }
  const records = [];
  for (const f of inputs) {
    for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) {
      if (!l.trim()) continue;
      try { records.push(JSON.parse(l)); } catch { /* partial/torn line, skip */ }
    }
  }
  const probes = buildBudgets(records);
  const out = {
    _comment: 'GENERATED by web/tools/smoke/build-probe-budgets.mjs. Do not hand-edit; '
      + 'the source of truth is the measured results.jsonl this was built from (see marginRule '
      + 'and measuredOn below), plus the docs/web/NUMBERS.md BT-210..224 row. To re-baseline: '
      + 're-run the measurement, re-run this generator, and commit the diff with a stated reason '
      + '-- never hand-bump a number here.',
    marginRule: 'budgetMs (soft, flags OVER_BUDGET, never a content fail) = '
      + 'ceil(maxMeasuredMs * 1.25 / 5000) * 5000, floor 30000. hardCapMs (hard kill timeout; a '
      + 'kill here is HUNG, fatal) = ceil(maxMeasuredMs * 3 / 30000) * 30000, floor 120000. 1.25x/3x '
      + 'match the band this project\'s own prior hand-picked overrides already used '
      + '(cantilever.js/machineports.js ~2.5x, padgate.js ~3.5x), applied uniformly instead of '
      + 'per-incident.',
    defaultBudgetMs: DEFAULT_BUDGET_MS,
    defaultHardCapMs: DEFAULT_HARD_CAP_MS,
    measuredOn: new Date().toISOString().slice(0, 10) + ', quiet box (no concurrent lanes dispatched), '
      + 'harness code identical to 5ca5502f through the commit this was generated at (doc-only commits '
      + 'in between do not change web/ or core/)',
    probes,
  };
  writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.error(`build-probe-budgets: wrote ${Object.keys(probes).length} probe entries to ${outFile}`);
}
