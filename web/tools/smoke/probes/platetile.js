// RN-953. Frame the player in third person so `suitplate`'s tile can be judged
// on the parts that actually carry it, and PROVE THE SWEEP TOOK before the
// picture is worth anything.
//
// The flag is dropped-flag-prone in exactly RN-698's way: `?tile=` is parsed in
// the client, forwarded by run.mjs's whitelist, and a failure at either end
// boots the manifest default while the filename says otherwise. So this reads
// `manifestTileM` and `tileOverridden` back out of the surface report and
// FAILS if the ask did not land.
(async (A) => {
  const of = window.__of;
  const surf = window.__ofSurfaces;
  if (!of || !surf) return { valid: false, why: 'no __of / __ofSurfaces' };
  await surf.ready;

  const cv = document.querySelector('canvas');
  const walk = (el) => {
    for (const c of el.children) {
      if (c === cv) continue;
      if (c.contains(cv)) { walk(c); continue; }
      c.style.display = 'none';
    }
  };
  walk(document.body);

  let aim = null;
  for (let i = 0; i < 120; i++) {
    aim = of.aim?.();
    if (aim && typeof aim.pitchDeg === 'number') break;
    await of.run(0.1);
  }
  if (aim === null) return { valid: false, why: 'no player' };

  // `--view=tp` BOOTS in third person. `of.setView('tp')` while ALREADY in TP
  // returns FP: measured, atBoot TP -> setView('tp') -> FP. So calling it
  // unconditionally is what put the first version of this ladder back in first
  // person while the probe reported `view: "tp"` off setView's own return
  // value. Read the mode, act only if it is wrong, and assert the mode that is
  // actually in force when the picture is taken.
  if (of.aim().mode !== 'TP') of.setView('tp');
  await of.run(0.5);
  const tp = of.aim().mode;
  of.look(A.yaw ?? aim.yawDeg, A.pitch ?? -8);
  await of.run(0.8);
  if (typeof of.setTime === 'function' && A.t !== undefined) of.setTime(A.t);
  await of.run(0.4);

  const r = surf.report();
  const sp = r.families.find((f) => f.name === 'suitplate') ?? null;
  const sf = r.families.find((f) => f.name === 'suitfab') ?? null;
  const plate = r.materials.filter((m) => /OF_Plate$/.test(m.label));
  return {
    valid: true,
    // The sweep landed iff the effective tile differs from the manifest's when
    // an override was asked for, and equals it when none was.
    pass: tp === 'TP' && sp !== null && (A.want === undefined
      ? sp.tileOverridden === false
      : sp.tileOverridden === true && Math.abs(sp.tileM - A.want) < 1e-9),
    asked: A.want ?? null,
    view: tp,
    suitplate: sp,
    suitfab: sf,
    plateMaterials: plate.map((m) => `${m.label} repeat=${m.repeat}`),
  };
})(OF_ARGS)
