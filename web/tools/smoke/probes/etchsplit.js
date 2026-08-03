// RN-1004. WHICH TERM draws the etched lines. Four frames, one page, one
// camera, one sun, two amplitudes toggled independently.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=... \
//     --evalfile=tools/smoke/probes/etchsplit.js \
//     --evalargs='{"lat":-35.6028,"lon":53.30131,"yaw":180,"pitch":-20,"sunDot":0.45}'
//
// WHY THIS IS THE FIRST QUESTION AND NOT THE SECOND. RN-961 rotated the sample
// coordinate of ONE texture, `uGroundRelief`. The fragment also samples
// `uGroundTex` at `vChunkUv * 16.0`, unrotated, at the SAME 16 repeats, and
// that term multiplies albedo. Both are periodic tiles, so RN-954's structural
// argument applies to BOTH of them word for word: any orientation baked into a
// periodic tile is the orientation everywhere. If the albedo tile also carries
// a directional field then half the artefact was never in scope for the fix,
// and no amount of tuning the swing can reach it.
//
// This is the shape of mistake worth the most here: tuning the knob you have
// rather than measuring which knob the defect is on. A sweep of the relief
// swing would have produced a smooth, plausible, monotone curve either way.
//
// FOUR STATES AND NOT TWO, because "relief off still shows lines" and "tex off
// still shows lines" are separately informative and the both-off frame is the
// positive control that says there is no THIRD source. If lines survive with
// both off, neither term is the cause and the hunt starts somewhere else.
(async (A) => {
  const of = window.__of;
  const art = window.__ofTerrainArt;
  if (!of) throw new Error('etchsplit: no window.__of');
  if (!art) throw new Error('etchsplit: no __ofTerrainArt');

  const cv = document.querySelector('canvas');
  const walk = (el) => {
    for (const c of el.children) {
      if (c === cv) continue;
      if (c.contains(cv)) { walk(c); continue; }
      c.style.display = 'none';
    }
  };
  walk(document.body);

  const alt = A.alt ?? 2.0;
  of.teleport(A.lat, A.lon, alt);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);
  if (typeof of.build === 'function') of.build(0);
  if (typeof of.propsVisible === 'function') of.propsVisible(false);

  let aim = null;
  for (let i = 0; i < 120; i++) {
    aim = of.aim?.();
    if (aim && typeof aim.pitchDeg === 'number') break;
    await of.run(0.1);
  }
  if (aim === null) throw new Error('etchsplit: no player');
  of.look(A.yaw ?? 180, A.pitch ?? -20);
  await of.run(0.4);
  const solve = of.setSunElev(A.sunDot ?? 0.45);
  await of.settle(30);
  if (Math.abs(solve.err) > (A.sunTol ?? 0.02)) {
    throw new Error(`etchsplit: setSunElev missed by ${solve.err}`);
  }

  // Fixtures before behaviour. Both amplitudes must be their live shipped
  // values or "turning it off" is turning off nothing.
  const relShipped = art.getRelief();
  const texShipped = art.getTex();
  if (!(relShipped > 0)) throw new Error(`etchsplit: relief amp is ${relShipped}, already off`);
  if (!(texShipped > 0)) throw new Error(`etchsplit: ground tex amp is ${texShipped}, already off`);
  const relTex = art.reliefState();
  const texTex = art.texState();
  if (relTex.w < 2) throw new Error(`etchsplit: of_ground_relief.png is a ${relTex.w}x${relTex.h} placeholder`);
  if (texTex.w < 2) throw new Error(`etchsplit: of_ground_tex.png is a ${texTex.w}x${texTex.h} placeholder`);

  const grab = async () => {
    await of.settle(A.settle ?? 20);
    const blob = await of.screenshot();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(s)}`;
  };

  const shots = {};
  const hashes = {};
  const states = [
    ['both_on', relShipped, texShipped],
    ['relief_only', relShipped, 0],
    ['tex_only', 0, texShipped],
    ['both_off', 0, 0],
  ];
  for (const [name, r, t] of states) {
    art.setRelief(r);
    art.setTex(t);
    if (art.getRelief() !== r || art.getTex() !== t) {
      throw new Error(`etchsplit: state ${name} did not take: relief ${art.getRelief()} tex ${art.getTex()}`);
    }
    shots[name] = await grab();
    hashes[name] = of.framehash().hash;
  }
  art.setRelief(relShipped);
  art.setTex(texShipped);

  // Each state must produce a DISTINCT frame, or one of the two amplitudes is
  // not reaching a pixel and the attribution below is about a dead uniform.
  const hs = Object.values(hashes);
  if (new Set(hs).size !== hs.length) {
    throw new Error(`etchsplit: two of the four states produced the same frame hash (${JSON.stringify(hashes)}); one amplitude is dead`);
  }

  const w = of.world();
  return {
    valid: w.chunks.converged === true,
    site: { lat: A.lat, lon: A.lon, biome: w.biome ?? null },
    pose: { alt, yaw: A.yaw ?? 180, pitch: A.pitch ?? -20 },
    sun: { gotDot: solve.gotDot, err: solve.err,
      elevationDeg: +((Math.asin(Math.max(-1, Math.min(1, solve.gotDot))) * 180) / Math.PI).toFixed(2) },
    amps: { reliefShipped: relShipped, texShipped },
    served: { relief: relTex, tex: texTex },
    hashes, shots,
  };
})(OF_ARGS)
