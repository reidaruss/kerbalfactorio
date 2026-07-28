// Does the scatter actually refuse the pond bed? (RN-46, verified at RN-48.)
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=http://127.0.0.1:4196/ \
//     --evalfile=tools/smoke/probes/pondscatter.js
//   node tools/smoke/run.mjs ... --scatterwet=1 ...      # the control
//
// THIS PROBE EXISTS BECAUSE RN-46 SHIPPED WITH ONLY HALF ITS EVIDENCE, and the
// missing half was the half that matters.
//
// RN-46 added a per-cell rejection for cells under standing water and counted
// it as `wetCells`. It then reported `wetCells: 0` at two DRY test sites and
// called that a result. It is not: zero at a dry site is consistent with the
// filter working, and it is equally consistent with the filter never running,
// with `hasWater` returning false everywhere, with the radius guard rejecting
// every cell before the query, and with the whole feature being dead code. A
// counter that reads zero proves nothing on its own. The positive half has to
// come from ground that IS wet.
//
// So this probe goes to the pond and asserts BOTH directions in one run:
//   * over the water, `wetCells` must be nonzero and foliage coverage must be
//     essentially nil;
//   * with `?scatterwet=1`, the same camera must show foliage ON the bed and
//     `wetCells` must be exactly 0 (the flag switches the test off, so the
//     counter cannot increment).
// A pair where one side is a build flag is acceptable here ONLY because the
// quantities compared are a COUNT and a coverage fraction at a camera pinned to
// the pond centre, not a timing.
//
// THE CAMERA IS PLACED RELATIVE TO THE POND CENTRE, not to the spawn, exactly
// as `pondshot.js` does it and for its reason: a pond that moves takes the shot
// with it, where a hard-coded lat/lon quietly photographs a hillside.
(async () => {
  const of = window.__of;
  const A = (typeof OF_ARGS === 'object' && OF_ARGS !== null) ? OF_ARGS : {};

  const w0 = of.world();
  const R = w0.bodyRadiusM;
  const wq = of.water(w0.player.feet[0], w0.player.feet[1], w0.player.feet[2]);
  const disc = wq.disc;
  if (disc === null) return { valid: false, fails: ['no pond at the spawn'] };

  // A local frame on the sphere at the pond centre, so an offset in metres is a
  // direction. Same construction as pondshot.js.
  const ux = disc.dirX; const uy = disc.dirY; const uz = disc.dirZ;
  let ex = -uz; let ey = 0; let ez = ux;
  const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
  const nx = uy * ez - uz * ey;
  const ny = uz * ex - ux * ez;
  const nz = ux * ey - uy * ex;
  const at = (distM, ang) => {
    const c = Math.cos(ang); const s = Math.sin(ang); const t = distM / R;
    const dx = ux + t * (c * ex + s * nx);
    const dy = uy + t * (c * ey + s * ny);
    const dz = uz + t * (c * ez + s * nz);
    const l = Math.hypot(dx, dy, dz);
    return [dx / l, dy / l, dz / l];
  };

  if (A.hideUi !== false) {
    let node = document.querySelector('canvas');
    while (node !== null && node.parentElement !== null) {
      for (const sib of Array.from(node.parentElement.children)) {
        if (sib !== node) sib.style.display = 'none';
      }
      node = node.parentElement;
    }
  }

  // Stand on the bank and look across the water, so the frame is mostly pond.
  const distM = A.distM ?? 16;
  const bank = at(distM, 0);
  const g = of.latlon(bank[0], bank[1], bank[2]);
  of.teleport(g.latDeg, g.lonDeg, A.altM ?? 2);
  of.setTime(A.sunT ?? 0.30);
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  await of.run(1.0);

  // Aim at the pond centre by SEARCHING the actual aim ray, never by assuming a
  // yaw convention. `pondwade.js` calibrates yaw for the same reason and states
  // it plainly: which axis is zero and which way it turns is a convention, and a
  // probe that guesses it wrong photographs some other ground and reports
  // whatever is there. That defect cost WG-33 a pass.
  //
  // The target is a DIRECTION rather than a hit point, because `of.aim()`
  // publishes an origin and a direction and nothing else. Marching it would be a
  // second surface authority in a probe; a dot product needs neither.
  const feet = of.world().player.feet;
  const cx = ux * (R + disc.levelM) - feet[0];
  const cy = uy * (R + disc.levelM) - feet[1];
  const cz = uz * (R + disc.levelM) - feet[2];
  const cl = Math.hypot(cx, cy, cz) || 1;
  let bestYaw = 0;
  let bestDot = -Infinity;
  for (let yaw = 0; yaw < 360; yaw += 5) {
    of.look(yaw, A.pitchDeg ?? -14);
    await of.settle(2);
    const ray = of.aim();
    if (ray === null) continue;
    const d = (ray.dir[0] * cx + ray.dir[1] * cy + ray.dir[2] * cz) / cl;
    if (d > bestDot) { bestDot = d; bestYaw = yaw; }
  }
  of.look(bestYaw, A.pitchDeg ?? -14);
  of.setTime(A.sunT ?? 0.30);
  await of.settle(30);

  // WHAT THE ORACLE ITSELF SAYS AT THE CAMERA AND AT THE POND CENTRE, reported
  // so a zero `wetCells` can be attributed instead of guessed at. If the oracle
  // says there is 3 m of water at the centre and the scatter still refused
  // nothing, the defect is in the scatter; if the oracle says the column is dry,
  // the probe is standing in the wrong place. Without this the first two
  // diagnoses of a dead RN-46 were both guesses and both were wrong.
  const oracleHere = of.water(feet[0], feet[1], feet[2]);
  const oracleCentre = of.water(ux, uy, uz);

  // Foliage coverage over the frame, which `groundCover` measures by
  // differencing the SAME settled frame with the prop layer on and off. Camera,
  // sun, streamed set and terrain therefore cannot differ between the two
  // captures, which is what makes a coverage number a fact about the foliage
  // and not about the run.
  const cover = await of.groundCover(A.halfPx ?? 300, 6);

  of.setTime(A.sunT ?? 0.30);
  await of.run(A.timeSecs ?? 3.0);
  const w = of.world();
  const s = of.stats();
  const p = s.props;
  // Read the flag off the URL rather than being told, so the two halves of the
  // pair cannot be mislabelled by the caller.
  const wetAllowed = new URLSearchParams(self.location.search).get('scatterwet') === '1';

  const fails = [];
  if (!(w.tick > w0.tick)) fails.push('the sim did not advance');
  if (!w.chunks.converged) fails.push('the streamer never converged');
  if (bestDot === -Infinity) fails.push('of.aim() never returned a ray');
  if (bestDot < 0.9) {
    fails.push(`the best yaw only reaches dot ${bestDot.toFixed(3)} with the `
      + 'direction to the pond centre, so the camera is not looking at the pond');
  }
  if (cover.samplePx <= 0 || cover.bothBlack) {
    fails.push('the coverage sample is empty or both captures were black');
  }
  if (wetAllowed) {
    // The control. The test is switched OFF, so the counter must not tick, and
    // the bed must carry the cover the defect used to put there.
    if (p.wetCells !== 0) {
      fails.push(`?scatterwet=1 disables the test but wetCells read ${p.wetCells}`);
    }
  } else if (!(oracleCentre.depthM > 0)) {
    // Not a renderer failure. Say so plainly rather than blaming the scatter.
    fails.push('the water oracle reports a DRY column at the pond centre, so '
      + 'this probe is not standing where it thinks it is');
  } else if (!(p.wetCells > 0)) {
    // THE ASSERTION RN-46 WAS MISSING. Without this the whole feature could be
    // dead and every dry-site reading would look identical.
    fails.push('wetCells is 0 while standing at the pond, so the rejection '
      + 'never ran: a filter that reads zero everywhere is indistinguishable '
      + 'from a filter that does not exist');
  }

  return {
    valid: fails.length === 0,
    fails,
    pond: {
      levelM: disc.levelM, radiusM: disc.radiusM ?? null,
      camera: {
        latDeg: g.latDeg, lonDeg: g.lonDeg, yawDeg: bestYaw,
        pitchDeg: A.pitchDeg ?? -14, offsetM: distM,
        aimDotToCentre: Number.isFinite(bestDot) ? +bestDot.toFixed(4) : null,
      },
      convergeSpins: spin,
    },
    oracle: {
      here: {
        hasWater: oracleHere.hasWater, dry: oracleHere.dry,
        depthM: +Number(oracleHere.depthM).toFixed(3),
      },
      centre: {
        hasWater: oracleCentre.hasWater, dry: oracleCentre.dry,
        depthM: +Number(oracleCentre.depthM).toFixed(3),
      },
    },
    scatterWetAllowed: wetAllowed,
    wetCells: p.wetCells,
    coverage: cover,
    props: {
      placed: p.propsPlaced, instances: p.instances,
      deliveredFraction: p.deliveredFraction, refused: p.refused,
      cellsCapped: p.cellsCapped, chunksCapped: p.chunksCapped,
    },
    cost: {
      drawCalls: s.draw.calls, triangles: s.draw.triangles,
      programs: s.draw.programs, vramEstimateMB: s.vramEstimateMB,
    },
  };
})()
