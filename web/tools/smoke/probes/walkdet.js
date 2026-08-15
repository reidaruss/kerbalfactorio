// FS-100: IS THE WALK ITSELF DETERMINISTIC, OR ONLY THE DRAG THAT READS IT?
//
//   cd web
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/walkdet.js
//
// FS-99 traced `probes/assembler.js`'s stone haul per tick and found the aim
// ray the drag is handed differs between two SAME-SEED runs by 0.004 m at the
// first tick of the haul and by up to 0.047 m later, which is enough to flip
// which 1.000 m cell the ghost resolves whenever the aim point is near a cell
// boundary. That measurement cannot say WHERE the 0.004 m came from, because
// the haul is preceded by a walk-in and an aim search whose own iteration
// counts are data dependent: an offset present at the first traced tick was
// established before the trace was armed.
//
// So this asks the question with everything data dependent removed. ONE fixed
// tape, ONE `of.run` of fixed length, no search, no adaptive loop, no
// placement, and the walker's own f64 feet printed at full precision at every
// checkpoint. Two runs of this that agree bit for bit put the divergence in
// something the probe layer does; two that disagree put it in the client, and
// the checkpoint it first appears at bounds where.
//
// THE TICK COUNT IS PART OF THE ANSWER, not a detail. `Loop.run` deliberately
// does NOT reset its accumulator (see its comment: zeroing it snaps alpha to 0
// and a probe calling run() in slices would measure its own slicing as jitter),
// so the number of fixed ticks a run of N seconds yields depends on the
// accumulator it inherited. If the feet agree and the tick counts do not, the
// walk is deterministic per tick and the SAMPLING of it is not.

(async () => {
  const of = window.__of;
  const sleep = (s) => of.run(s);
  const feet = () => of.world().player.feet ?? null;
  const eye = () => of.aim().origin;
  const p6 = (v) => v.map((x) => x.toFixed(6)).join(',');

  // A settled start, so the first checkpoint is not measuring the boot.
  await of.settle(30);
  const marks = [];
  const t0 = of.world().tick;
  marks.push({ at: 'start', tick: 0, eye: p6(eye()), feet: feet() === null ? null : p6(feet()) });

  // FOUR IDENTICAL LEGS rather than one long one, so a divergence has a
  // checkpoint before and after it. The tape is re-armed each leg with exactly
  // the same content: a tape is a script, and re-arming it is what a probe that
  // walks in stages does.
  for (let leg = 0; leg < 4; ++leg) {
    of.input.tape([{ hold: 240, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
    await sleep(4);
    marks.push({ at: `leg${leg}`, tick: of.world().tick - t0,
      eye: p6(eye()), feet: feet() === null ? null : p6(feet()) });
  }
  of.input.tape([{ hold: 4, keys: [] }]);
  await sleep(0.5);
  marks.push({ at: 'stop', tick: of.world().tick - t0,
    eye: p6(eye()), feet: feet() === null ? null : p6(feet()) });

  // NO `valid`, `ok` or `pass`. One run of this cannot be right or wrong; the
  // measurement is the COMPARISON of two, and a verdict key here would invite a
  // gate to read a green out of a single number that means nothing alone.
  return { walkDet: true, totalTicks: of.world().tick - t0, marks };
})()
