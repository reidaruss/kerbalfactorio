// vabdirection.js: GP-145 / GP-146. WHICH WAY A ROCKET CAN BE BUILT, MEASURED,
// AND THE SENTENCE THE PLAYER GETS WHEN THEY PICK THE OTHER WAY.
//
//   npx vite --config vite.probe.config.ts --port 5262 --strictPort
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5262/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/vabdirection.js
//
// Reid: "you can only build bottom-up". The measurement says the constraint is
// real and points the OTHER WAY. The standard two-stage rocket, which is
// /core's own reference vehicle shape, builds top-down in all six parts and
// dies at part four of six going bottom-up, on the interstage joint: a
// decoupler hangs UNDER a bell, and nothing can be put ON TOP of that decoupler
// that is an engine, because a bell is not a mating face.
//
// So a multi-stage rocket can only be assembled DOWNWARD, and the downward
// preview was the invisible one (GP-141). He tried the only way that works, saw
// nothing happen, and concluded the opposite.
//
// WHAT MAKES THIS PROBE MEAN ANYTHING.
//
// (a) The two builds are the SAME PHYSICAL ROCKET written once and walked in
//     each direction, so a difference between them cannot be a difference of
//     content. The top-down build is the positive control: it must complete, or
//     the bottom-up failure proves nothing about direction.
// (b) The refusal is asserted to name a DIRECTION and to NOT name an internal
//     field, which is the defect it replaces ("Vacuum Engine has no bottom
//     node"). Asserted on the presence of the remedy, never on the wording.
// (c) The ROOT ASYMMETRY is measured rather than described: the same rocket
//     built from opposite ends, the same part removed, and the two surviving
//     stacks compared.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);

  const cat = of.vab('catalogue');
  const byName = {};
  for (const c of cat) byName[c.name] = c.index;
  const nameOf = (id) => (cat.find((c) => c.id === id) ?? { name: `?${id}` }).name;
  for (const n of ['Command Pod Mk1', 'Fuel Tank (small)', 'Fuel Tank (large) [S]',
                   'Vacuum Engine', 'Main Engine', 'Stack Decoupler', 'Nose Cone']) {
    check(`catalogue has ${n}`, byName[n] !== undefined, n);
  }
  const boot = of.vab('enter');
  await sleep(3);
  check('the bay opened', boot.open === true, JSON.stringify(boot.open));

  const clear = async () => { of.vab('press', 'clear'); await sleep(2); };
  const holdI = async (i) => { of.vab('drop'); of.vab('take', i); await sleep(0.6); };

  /** Walk a spec, stopping at the first refusal, and report where it stopped. */
  const build = async (spec) => {
    await clear();
    for (let k = 0; k < spec.length; ++k) {
      const [name, face] = spec[k];
      await holdI(byName[name]);
      if (k === 0) { of.vab('place'); await sleep(1.5); continue; }
      const ns = of.vab('nodes').filter((n) => n.kind === face);
      ns.sort((a, b) => (face === 'bottom' ? a.pos[1] - b.pos[1]
                                           : b.pos[1] - a.pos[1]));
      if (ns[0] === undefined) {
        return { placed: k, of: spec.length, stoppedAt: name, why: `no free ${face} face` };
      }
      const r0 = of.vab('hover', ns[0].ndc[0], ns[0].ndc[1]);
      await sleep(0.4);
      const r = of.vab('place');
      if (!r.ok) {
        return { placed: k, of: spec.length, stoppedAt: name,
                 why: r.report.message,
                 blocked: r0.blocked === null || r0.blocked === undefined
                   ? null : r0.blocked.kind };
      }
      await sleep(1.5);
    }
    return { placed: spec.length, of: spec.length, stoppedAt: null, why: '' };
  };

  // ONE rocket, written once, walked both ways.
  const TOP_DOWN = [['Command Pod Mk1'],
                    ['Fuel Tank (small)', 'bottom'], ['Vacuum Engine', 'bottom'],
                    ['Stack Decoupler', 'interstage'],
                    ['Fuel Tank (large) [S]', 'bottom'], ['Main Engine', 'bottom']];
  const BOTTOM_UP = [['Main Engine'],
                     ['Fuel Tank (large) [S]', 'top'], ['Stack Decoupler', 'top'],
                     ['Vacuum Engine', 'top'], ['Fuel Tank (small)', 'top'],
                     ['Command Pod Mk1', 'top']];

  // (a) THE POSITIVE CONTROL FIRST. If this does not complete, nothing below
  //     is about direction.
  const down = await build(TOP_DOWN);
  check('THE TOP-DOWN BUILD COMPLETES, which is what makes the other result mean anything',
        down.placed === down.of, JSON.stringify(down));
  const downRep = of.vab('report');
  check('and it really is a two-stage rocket', downRep.stages.length >= 2,
        `${downRep.stages.length} stages`);
  check('that flies', of.vab('verdict').ok === true,
        JSON.stringify(of.vab('verdict').faults.map((f) => f.code)));

  const up = await build(BOTTOM_UP);
  check('THE SAME ROCKET CANNOT BE BUILT BOTTOM-UP', up.placed < up.of,
        JSON.stringify(up));
  check('and it stops at the interstage joint, not somewhere incidental',
        up.stoppedAt === 'Vacuum Engine', JSON.stringify(up));
  log.push({ topDown: down, bottomUp: up });

  // (b) THE SENTENCE. Reproduce the refusal on a hover, with nothing committed,
  //     and assert it names the direction rather than a field name.
  // THE FIXTURE HAS TO LEAVE NO FREE BOTTOM FACE, or it cannot exhibit what
  // this section measures. The first two runs of this probe used a lone
  // decoupler and then a bare tank, both of which have a free bottom, so the
  // search legitimately answered with it and the line read "Vacuum Engine under
  // <that part>": a correct answer to a question this section is not asking.
  // A tank with an engine already under it closes the only downward face,
  // because an engine's own bottom is an interstage and takes a decoupler only.
  await clear();
  await holdI(byName['Fuel Tank (large) [S]']);
  of.vab('place');
  await sleep(2);
  await holdI(byName['Main Engine']);
  {
    const b = of.vab('nodes').filter((n) => n.kind === 'bottom')[0];
    if (b !== undefined) { of.vab('hover', b.ndc[0], b.ndc[1]); await sleep(0.5); }
    check('an engine closes the bottom of the tank', of.vab('place').ok === true);
  }
  await sleep(2);
  const refusedBefore = of.vab('report').refused;
  await holdI(byName['Vacuum Engine']);
  const stackFaces = of.vab('nodes').filter((n) => n.kind === 'top'
    || n.kind === 'bottom' || n.kind === 'interstage');
  check('no free bottom face is left, so the top is the only way up',
        stackFaces.filter((n) => n.kind === 'bottom').length === 0,
        JSON.stringify(stackFaces.map((n) => n.kind)));
  let why = '';
  const topFace = stackFaces.filter((n) => n.kind === 'top')[0];
  if (topFace !== undefined) {
    const r = of.vab('hover', topFace.ndc[0], topFace.ndc[1]);
    await sleep(1);
    check('the engine is held as a NEAR MISS on it',
          r.snapped === null && r.blocked !== null,
          JSON.stringify({ snapped: r.snapped, blocked: r.blocked }));
    why = mustHave(of.vab('line'), 'text', "vab('line')");
  }
  check('the refusal names the part', why.includes('Vacuum Engine'), why);
  check('THE REFUSAL NAMES THE DIRECTION THAT WORKS, not an internal field',
        /UNDER/.test(why), why);
  check('and the old field name is gone', !why.includes('no bottom node'), why);
  // `refused` is cumulative over the session, so the claim is a DELTA. Reading
  // it as an absolute would have this check depend on how many builds ran above.
  check('and it is on screen without a click',
        of.vab('report').refused === refusedBefore,
        `${of.vab('report').refused} against ${refusedBefore} before the hover`);
  log.push({ upwardRefusal: why });

  // The mirror: a nose cone cannot hang under anything, and gets the OTHER
  // sentence. Two-sided, so a change that emits one sentence for both fails.
  await clear();
  await holdI(byName['Fuel Tank (large) [S]']);
  of.vab('place');
  await sleep(2);
  await holdI(byName['Nose Cone']);
  const botFace = of.vab('nodes').filter((n) => n.kind === 'bottom')[0];
  check('the tank offers a bottom face', botFace !== undefined);
  let why2 = '';
  if (botFace !== undefined) {
    of.vab('hover', botFace.ndc[0], botFace.ndc[1]);
    await sleep(1);
    why2 = mustHave(of.vab('line'), 'text', "vab('line')");
  }
  check('the nose cone refusal names the part', why2.includes('Nose Cone'), why2);
  check('and names the OTHER direction', /ON TOP/.test(why2), why2);
  check('the two directions do NOT get the same sentence', why !== why2,
        `${why} | ${why2}`);
  log.push({ downwardRefusal: why2 });

  // (c) THE ROOT ASYMMETRY. Same rocket, opposite build order, same part
  //     removed, and the survivor is the opposite end.
  const shape = () => of.vab('report').parts.slice()
    .sort((a, b) => a.origin[1] - b.origin[1])
    .map((p) => nameOf(p.partId));
  const removeMiddle = async (spec) => {
    const r = await build(spec);
    if (r.placed !== r.of) return { err: JSON.stringify(r) };
    const rep = of.vab('report');
    const rows = rep.parts.slice().sort((a, b) => a.origin[1] - b.origin[1]);
    const mid = rows[Math.floor(rows.length / 2)];
    const before = shape();
    of.vab('remove', mid.handle);
    await sleep(2);
    return { root: nameOf(rep.parts.find((p) => p.parent < 0).partId),
             removed: nameOf(mid.partId), before, after: shape() };
  };
  const SHORT_DOWN = [['Command Pod Mk1'], ['Fuel Tank (large) [S]', 'bottom'],
                      ['Main Engine', 'bottom']];
  const SHORT_UP = [['Main Engine'], ['Fuel Tank (large) [S]', 'top'],
                    ['Command Pod Mk1', 'top']];
  const remDown = await removeMiddle(SHORT_DOWN);
  const remUp = await removeMiddle(SHORT_UP);
  check('both short builds succeeded', remDown.err === undefined
        && remUp.err === undefined, JSON.stringify({ remDown, remUp }));
  check('the two builds really are the same rocket on screen',
        JSON.stringify(remDown.before) === JSON.stringify(remUp.before),
        JSON.stringify({ a: remDown.before, b: remUp.before }));
  check('and they really have different roots', remDown.root !== remUp.root,
        `${remDown.root} vs ${remUp.root}`);
  // THIS IS A RECORD, NOT YET A FIX. It is asserted so the day somebody makes
  // removal root-independent, this check fails and points at the entry that
  // says why it was ever like this.
  check('REMOVING THE SAME PART LEAVES THE OPPOSITE HALF, by build order alone',
        JSON.stringify(remDown.after) !== JSON.stringify(remUp.after),
        JSON.stringify({ afterTopDownRoot: remDown.after,
                         afterBottomUpRoot: remUp.after }));
  log.push({ rootAsymmetry: { topDownRoot: remDown, bottomUpRoot: remUp } });

  return {
    valid: fails.length === 0,
    fails,
    log,
    note: 'GP-145 the direction refusal names the direction that works; GP-146 '
      + 'records that `of_vs_remove` deletes the subtree further from the root, '
      + 'so which half of an identical rocket a delete destroys is decided by '
      + 'which part the player happened to place first.',
  };
})()
