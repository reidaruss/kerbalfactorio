// RN-1014. WHICH terrain art term draws the zipper band at grazing incidence.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --body=cinder \
//     --url=http://127.0.0.1:4282/ \
//     --evalfile=tools/smoke/probes/bandsplit.js \
//     --evalargs='{"lat":2,"lon":144,"pitch":-35,"sunDot":0.45}'
//
// WHAT WAS SEEN. Magnified 6x, the ground at grazing incidence carries a
// straight band in which a diagonal pattern breaks into a hard black-and-white
// zipper. Below the band the same pattern is coherent; above it the ground is
// smooth. That is the signature of a high-frequency term crossing the pixel
// grid's Nyquist limit, not of a seam, a crack or a light.
//
// At night the same band is the brightest thing on an airless moon 26 degrees
// past the terminator, which is how it was found: the night ground is
// `albedo * uAmbient` and nothing there should have any structure at all.
//
// SIX STATES, ONE PAGE. `__ofTerrainArt` publishes the three art amplitudes as
// one vec3 plus two separate scalars, so each is turned off alone and then all
// together. **The all-off arm is the positive control**: if the band survives
// with every art term off it is not art, it is geometry or a light, and the
// individual results are coincidences.
//
// NAMED FAILURE MODES.
//  1. A TERM MEASURED WHERE IT CANNOT WORK REPORTS ITS OWN ABSENCE. The band
//     is a few per cent of the frame, so a whole-frame diff would read every
//     arm as "no change". The caller boxes the band; this probe publishes the
//     frames and does not compute a verdict over the wrong region.
//  2. AN ARM THAT WAS ALREADY OFF. Each amplitude is asserted non-zero before
//     it is turned off, so no arm can be vacuous.
//  3. THE ARMS MUST BE DISTINGUISHABLE. All six frame hashes are published; if
//     two match, two arms are the same state and the attribution is not what
//     it appears to be.
(async (A) => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  if (!of) throw new Error('bandsplit: no window.__of');
  if (!art) throw new Error('bandsplit: no __ofTerrainArt');

  const cv = document.querySelector('canvas');
  const walk = (el) => {
    for (const c of el.children) {
      if (c === cv) continue;
      if (c.contains(cv)) { walk(c); continue; }
      c.style.display = 'none';
    }
  };
  walk(document.body);

  of.teleport(A.lat, A.lon, A.alt ?? 2.0);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);
  if (typeof of.build === 'function') of.build(0);
  if (typeof of.propsVisible === 'function') of.propsVisible(false);
  of.lamp(false);
  await of.settle(4);
  if (of.stats().lamp.enabled !== false) throw new Error('bandsplit: lamp still on');

  let aim = null;
  for (let i = 0; i < 120; i++) {
    aim = of.aim?.();
    if (aim && typeof aim.pitchDeg === 'number') break;
    await of.run(0.1);
  }
  if (aim === null) throw new Error('bandsplit: no player');
  of.look(A.yaw ?? 0, A.pitch ?? -35);
  await of.run(0.4);
  const solve = of.setSunElev(A.sunDot ?? 0.45);
  await of.settle(30);
  if (Math.abs(solve.err) > (A.sunTol ?? 0.03)) {
    throw new Error(`bandsplit: setSunElev missed by ${solve.err}`);
  }

  const art0 = art.get();            // [macro, bump, strata]
  const rel0 = art.getRelief();
  const tex0 = art.getTex();
  const spec0 = art.getSpec();
  const nonzero = (v, n) => {
    if (!(v > 0)) throw new Error(`bandsplit: ${n} is already ${v}; that arm would be vacuous`);
  };
  nonzero(art0[0], 'macro'); nonzero(art0[1], 'bump'); nonzero(art0[2], 'strata');
  nonzero(rel0, 'relief'); nonzero(tex0, 'groundtex');

  const grab = async () => {
    await of.settle(A.settle ?? 20);
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(s)}`;
  };

  const apply = (macro, bump, strata, rel, tex, specSun, specSky) => {
    art.set(macro, bump, strata);
    art.setRelief(rel);
    art.setTex(tex);
    art.setSpec(specSun, specSky);
  };

  const states = [
    ['shipped', art0[0], art0[1], art0[2], rel0, tex0, spec0[0], spec0[1]],
    ['macro_off', 0, art0[1], art0[2], rel0, tex0, spec0[0], spec0[1]],
    ['bump_off', art0[0], 0, art0[2], rel0, tex0, spec0[0], spec0[1]],
    ['strata_off', art0[0], art0[1], 0, rel0, tex0, spec0[0], spec0[1]],
    ['relief_off', art0[0], art0[1], art0[2], 0, tex0, spec0[0], spec0[1]],
    ['tex_off', art0[0], art0[1], art0[2], rel0, 0, spec0[0], spec0[1]],
    ['spec_off', art0[0], art0[1], art0[2], rel0, tex0, 0, 0],
    ['all_off', 0, 0, 0, 0, 0, 0, 0],
  ];
  const shots = {};
  const hashes = {};
  for (const [name, ma, bu, sr, re, te, ss, sk] of states) {
    apply(ma, bu, sr, re, te, ss, sk);
    const g = art.get();
    if (g[0] !== ma || g[1] !== bu || g[2] !== sr
      || art.getRelief() !== re || art.getTex() !== te) {
      throw new Error(`bandsplit: state ${name} did not take (${JSON.stringify(g)} rel ${art.getRelief()} tex ${art.getTex()})`);
    }
    shots[name] = await grab();
    hashes[name] = of.framehash().hash;
  }
  apply(art0[0], art0[1], art0[2], rel0, tex0, spec0[0], spec0[1]);

  const hs = Object.values(hashes);
  const dup = hs.length !== new Set(hs).size;

  const w = of.world();
  return {
    valid: w.chunks.converged === true,
    site: { lat: A.lat, lon: A.lon, biome: w.biome ?? null },
    pose: { yaw: A.yaw ?? 0, pitch: A.pitch ?? -35, alt: A.alt ?? 2.0 },
    sun: {
      gotDot: +solve.gotDot.toFixed(4), err: +solve.err.toFixed(4),
      elevationDeg: +((Math.asin(Math.max(-1, Math.min(1, solve.gotDot))) * 180) / Math.PI).toFixed(2),
    },
    shipped: { art: art0, relief: rel0, tex: tex0, spec: spec0 },
    hashes,
    duplicateStates: dup,
    shots,
  };
})(OF_ARGS)
