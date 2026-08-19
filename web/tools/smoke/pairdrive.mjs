// INTERLEAVED multi-arm driver for the station census (RN-2030..2049).
//
// WG-189: never take a baseline serially before and after a change. Every
// pair here is one run of each arm back to back, so a box that gets busier or
// quieter partway through a batch moves both arms together. The two arms are
// served by TWO vite previews on two ports out of two dist directories, which
// is what lets the unfixed and fixed builds be interleaved at all.
//
// FRAME DEFINITION, chosen once and stated: everything is classified from
// `eval.png`, the probe's own in-page `of.screenshot()` at the capture
// instant. `run.mjs --out` is unusable on this shot -- `artframe.js` puts the
// walker back on the ground before it resolves, so the settled playwright
// screenshot of the `station` shot is a picture of the forest at 1.6 m.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m === undefined ? d : m.slice(k.length + 3);
};
const tag = arg('tag', 'P');
const pairs = Number(arg('pairs', '5'));
const root = arg('root', 'dist-scratch');
const ledger = `${root}/${arg('ledger', 'runs.jsonl')}`;
// [{name, port, args}], read from a file so the command line stays plain.
const ARMS = JSON.parse(readFileSync(arg('arms', `${root}/arms.json`), 'utf8'));
if (ARMS.length === 0) { console.error('pairdrive: --arms is required'); process.exit(2); }
for (const a of ARMS) mkdirSync(`${root}/frames/${tag}_${a.name}`, { recursive: true });

const batchStart = new Date();
console.error(`batch ${tag}: ${pairs} pairs x ${ARMS.length} arms, WALL START ${batchStart.toISOString()}`);

for (let p = 0; p < pairs; ++p) {
  for (const a of ARMS) {
    const id = `${tag}_${a.name}${String(p).padStart(3, '0')}`;
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [
      'tools/smoke/run.mjs', `--url=http://127.0.0.1:${a.port}/`,
      '--scenario=walk', '--width=1600', '--height=900',
      '--evalfile=tools/smoke/probes/artframe.js',
      `--evalargs=${JSON.stringify({ shot: 'station', ...(a.args ?? {}) })}`,
    ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    const t1 = Date.now();
    let row = { id, tag, arm: a.name, pair: p, startISO: new Date(t0).toISOString(),
      ms: t1 - t0, code: r.status };
    try {
      const rep = JSON.parse(r.stdout);
      const e = rep.eval; const c = e.captureDiag;
      if (typeof e.png === 'string') {
        writeFileSync(`${root}/frames/${tag}_${a.name}/${id}.png`,
          Buffer.from(e.png.slice('data:image/png;base64,'.length), 'base64'));
      }
      const ph = e.photoCapture;
      row = { ...row, valid: e.valid, why: e.why ?? null,
        boxLuma: e.box.luma, boxP50: e.box.p50, boxP95: e.box.p95, boxIqr: e.box.iqr,
        boxLoFrac: e.box.loFrac, boxHiFrac: e.box.hiFrac,
        worldLuma: e.world.luma, worldIqr: e.world.iqr, worldLoFrac: e.world.loFrac,
        // THE PHOTOGRAPHED FRAME'S OWN INSTRUMENTS (RN-2034). These are the
        // ones that can separate the modes; every other reading in this row is
        // taken on a different frame and is kept only to show that it cannot.
        phAlpha: ph && ph.clock ? ph.clock.alpha : null,
        phTick: ph ? ph.tick : null, phFrames: ph ? ph.frames : null,
        phEyeDistM: ph ? ph.drawEyeDistM : null,
        phRebases: ph ? ph.rebases : null,
        phCamPosE: ph ? ph.cam.posE : null, phDrawPosE: ph ? ph.drawPosE : null,
        phDrawQuat: ph ? ph.drawQuat : null, phCamQuat: ph ? ph.cam.quat : null,
        phStaleMaxM: ph ? ph.staleMaxM : null, phDrawnParts: ph ? ph.drawnParts : null,
        // The published instruments, on the frames they are actually read on.
        preAlpha: e.preCapture && e.preCapture.clock ? e.preCapture.clock.alpha : null,
        preTick: e.preCapture ? e.preCapture.tick : null,
        preEyeDistM: e.preCapture ? e.preCapture.drawEyeDistM : null,
        postTick: e.atCapture ? e.atCapture.tick : null,
        postFrames: e.atCapture ? e.atCapture.frames : null,
        diagCamPosE: c.camF.posE, diagCamQuat: c.camF.quat,
        diagDrawQuat: c.drawQuat, diagDrawPosE: c.stationDrawF.posE,
        diagEyeDistM: c.drawEyeDistM, sunBearingDeg: c.sunBearingDeg,
        lampF: c.lampF, drawF: c.drawF, ibl: e.ibl, iblSettleIters: e.iblSettleIters,
        clock: e.stationClock, sunT: e.sun.sunT, elevDot: e.sun.elevDot,
        vitals: e.vitals, shadow: e.shadow };
    } catch (err) {
      row.parseError = String(err).slice(0, 200);
      row.stderrTail = (r.stderr || '').slice(-400);
    }
    appendFileSync(ledger, JSON.stringify(row) + '\n');
    console.error(`${id} code=${row.code} ms=${row.ms} box=${row.boxLuma} alpha=${row.phAlpha} eyeDist=${row.phEyeDistM}`);
  }
}
console.error(`batch ${tag}: WALL END ${new Date().toISOString()} (started ${batchStart.toISOString()})`);
