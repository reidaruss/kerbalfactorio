// MAPSHOT (DW-37): frame the map at ONE named zoom and hand back what it drew.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5199/ --sandbox=1 --settle=8 \
//     --evalfile=tools/smoke/probes/mapshot.js --evalargs='{"shot":"surface"}' \
//     --out=docs/screenshots/WG29_map_surface.png
//
// SHOTS: surface (400 m) | regional (60 km) | orbital (3.2e6 m). The three
// numbers are `probes/discovery.js` section 7's, copied so the pictures frame
// exactly what the acceptance run frames.
//
// WHY IT EXISTS SEPARATELY. `discovery.js` already takes these three shots, and
// it is the right file to take them from when the whole acceptance is being run
// anyway. But it is a twenty-minute driven run per picture, and a picture is a
// thing you look at, throw away and take again. This does the same driving --
// the REAL M key, the REAL zoom hook the wheel and the buttons call, a REAL
// walked survey so discovery has a shape -- and nothing else.
//
// IT ASSERTS NOTHING AND IT SAYS SO. Everything here is framing; the claims
// about what the map draws live in `discovery.js`, which is where they can be
// diffed across the two modes. What this returns is the paint report, so a
// reader of the screenshot can check the picture against the counts that made
// it rather than against an impression of it (DW-7 in both directions: a
// structural check cannot replace looking, and looking cannot replace a count).
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['map', 'game', 'teleport']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};
  const SHOT = typeof A.shot === 'string' ? A.shot : 'surface';
  const WANT = { surface: 400, regional: 60000, orbital: 3.2e6 }[SHOT];
  if (WANT === undefined) return { valid: false, why: `unknown shot ${SHOT}` };
  const sleep = (n) => of.run(n);
  const MAP = () => of.map('report');
  const DEG = 180 / Math.PI;
  const ZOOM = 1.15;

  await sleep(0.8);
  const R = of.world().bodyRadiusM;
  // Stand on the ore cluster, the same anchor `discovery.js` uses, so the three
  // pictures and the acceptance run are looking at the same ground.
  const list = of.game().ore.list;
  const c = [0, 0, 0];
  for (const p of list) for (let k = 0; k < 3; k++) c[k] += p.centre[k] / list.length;
  const cl = Math.hypot(c[0], c[1], c[2]);
  const lat0 = Math.asin(c[1] / cl) * DEG, lon0 = Math.atan2(c[2], c[0]) * DEG;

  // A WALKED SURVEY, at a survey cell's own spacing. Without it the discovered
  // set is one cell and the regional and orbital pictures are a dot: the point
  // of the wide shots is that discovery has a SHAPE, and in survival that shape
  // is the whole picture.
  const CELL = of.map('disc').discovery.surveyCellSizeM;
  const G = 5;
  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      of.teleport(lat0 + ((i - (G - 1) / 2) * CELL / R) * DEG,
        lon0 + ((j - (G - 1) / 2) * CELL / (R * Math.cos(lat0 / DEG))) * DEG, 2);
      await sleep(1.1);
    }
  }
  of.teleport(lat0, lon0, 2);
  await sleep(1.2);

  // THE REAL KEY, not `map('open')`: standing rule 3.
  const code = (of.input.bindings().map || [])[0];
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  await sleep(0.5);
  if (MAP().open !== true) return { valid: false, why: 'the M key did not open the map' };

  // THE REAL ZOOM, one notch at a time through the hook the wheel and the two
  // buttons both call. Stepping the span directly would frame a view no player
  // can reach and would skip every rebuild on the way.
  let notches = 0;
  for (let i = 0; i < 400 && MAP().spanM > WANT * ZOOM; i++) {
    of.map('zoom', { mult: 1 / ZOOM }); notches++; await sleep(0.03);
  }
  for (let i = 0; i < 400 && MAP().spanM < WANT / ZOOM; i++) {
    of.map('zoom', { mult: ZOOM }); notches++; await sleep(0.03);
  }
  await sleep(0.8);

  const r = MAP();
  const d = r.view.drawn;
  const t = of.map('disc').terrain;
  const disc = of.map('disc').discovery;
  return {
    valid: true, shot: SHOT, wantSpanM: WANT, notches,
    mode: of.game().mode.mode, revealAll: of.game().mode.fullMapRevealed,
    spanM: Math.round(r.spanM), focus: r.focus.active,
    painted: d.discoveredQuads, onBody: d.terrainSamples,
    sampleSizeM: d.sampleSizeM, alphas: d.alphas, markers: d.markers,
    ore: d.oreDrawn, bodyFilled: d.bodyFilled, frames: r.view.frames,
    terrain: t,
    discovery: { surveyCells: disc.surveyCells, exploreCells: disc.exploreCells,
      surveyCellSizeM: disc.surveyCellSizeM },
  };
})()
