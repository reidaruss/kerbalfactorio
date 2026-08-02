// RN-731. One posed frame through the SHIPPING path, for the pairs a studio
// floor structurally cannot carry.
//
// WHY A POSED IN-WORLD FRAME AND NOT A STUDIO RENDER. `render_rocks.py` shoots
// a boulder on a neutral floor under a fixed studio light, which is the right
// instrument for "is this asset correct" and the wrong one for the two claims
// this pass actually makes. A mineral's material response is a claim about how
// it behaves under the SHIPPED grade (ACES, exposure 1.2, contrast 1.45) beside
// the terrain it sits in, and a studio floor has neither. The terrain specular
// is a claim about ground that only exists in the world.
//
// Everything that would make two frames differ for a reason other than the one
// being tested is pinned: the seed comes from the runner, the camera is
// teleported and aimed rather than walked to, the sun is set by dot rather than
// by clock, the chunk stream is drained to convergence, the scatter backlog is
// drained to zero and the wind clock is frozen. What is left between a pair is
// the flag.
//
// The PNG comes back as a data URL for `writeshot.mjs` rather than through
// run.mjs's own `--out`, because `--out` fires after `settle()` and `settle()`
// advances the day clock (RN-13), so two `--out` frames of the same pose are
// not at the same sun.

(async () => {
  const of = window.__of;
  const A = OF_ARGS ?? {};
  const site = A.site ?? { name: 'mtn', lat: 2.0, lon: 144.0, yaw: 300, pitch: -12 };

  of.teleport(site.lat, site.lon, site.alt ?? 2.0);
  of.look(site.yaw, site.pitch);
  await of.run(1.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.25);
  let drain = 0;
  while (of.stats().props.scatterBacklog > 0 && drain++ < 900) await of.run(1 / 60);
  await of.run(1.0, 60);
  if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);

  // AIM AT A REAL HARVEST NODE, because a rock pass photographed from a
  // standing eye at a fixed bearing is a picture of whatever happened to be in
  // front of the spawn. The first version of this probe did exactly that and
  // came back with a frame containing no boulder in it at all, which is a
  // picture that cannot fail and therefore cannot pass either.
  //
  // `wantArt` names the asset ("BoulderIron", "BoulderCoal", "RockSpire", ...),
  // so a per-mineral pair is the SAME node on both sides and the comparison is
  // about the material rather than about which rock the camera happened to
  // find. The chosen node's index and range come back with the frame so a pair
  // can be CHECKED for having photographed the same rock rather than assumed to.
  //
  // THE YAW IS MEASURED, NOT DERIVED. There is no published mapping from
  // `of.look(yaw, pitch)` to a world direction, and assuming one (north is 0,
  // yaw increases clockwise, the up axis is +Y) is three assumptions that would
  // fail silently by pointing at empty ground. `of.aim()` publishes the camera
  // ray, so this sweeps yaw and pitch and keeps the pair whose ray has the
  // largest dot product with the direction to the node. That measures the
  // convention instead of believing one, and it is exact to the refine step.
  let aimed = null;
  const nodes = (typeof of.nodes === 'function' ? of.nodes() : []) ?? [];
  if (A.wantArt !== undefined) {
    const cands = nodes.filter((n) => n.art === A.wantArt);
    let best = null;
    for (const n of cands) {
      if (best === null || n.distanceM < best.distanceM) best = n;
    }
    if (best !== null) {
      // WALK TO IT FIRST. The nearest node of a given kind is typically 25 to
      // 40 m away, where a 1.5 m boulder subtends about 3 degrees and lands
      // near 48 px tall in a 900 px frame. That is a picture of a silhouette,
      // not of a material, and every claim this pass makes is about the
      // material. `of.latlon(x, y, z)` converts the node's own published world
      // position, so the approach is derived from the node rather than from a
      // hand-tuned camera literal that would go stale the moment a seed moved.
      //
      // The offset is in LATITUDE and in metres converted at the body's own
      // radius, so it is the same ground distance at every site rather than
      // the same angle. Approaching from a fixed compass direction rather than
      // a random one is deliberate: it keeps the sun on the same side of the
      // rock in every frame in the set.
      const ll = of.latlon(best.x, best.y, best.z);
      const bodyR = of.world().body?.radiusM ?? 600000;
      const degPerM = 360 / (2 * Math.PI * bodyR);
      const approach = (A.approachM ?? 4.5) * degPerM;
      of.teleport(ll.latDeg + approach, ll.lonDeg, site.alt ?? 2.0);
      await of.run(1.0);
      let respin = 0;
      while (!of.world().chunks.converged && respin++ < 240) await of.run(0.25);
      let redrain = 0;
      while (of.stats().props.scatterBacklog > 0 && redrain++ < 900) await of.run(1 / 60);
      await of.run(1.0, 60);
      if (window.__ofWind) window.__ofWind.freeze(A.windT ?? 40);

      const o = of.aim().origin;
      const t = [best.x - o[0], best.y - o[1], best.z - o[2]];
      const tl = Math.hypot(t[0], t[1], t[2]);
      const tn = [t[0] / tl, t[1] / tl, t[2] / tl];
      const score = (yaw, pitch) => {
        of.look(yaw, pitch);
        const d = of.aim().dir;
        return d[0] * tn[0] + d[1] * tn[1] + d[2] * tn[2];
      };
      let bY = 0; let bP = 0; let bS = -2;
      for (let y = 0; y < 360; y += 5) {
        for (let p = -40; p <= 20; p += 5) {
          const s = score(y, p);
          if (s > bS) { bS = s; bY = y; bP = p; }
        }
      }
      for (let y = bY - 5; y <= bY + 5; y += 0.5) {
        for (let p = bP - 5; p <= bP + 5; p += 0.5) {
          const s = score(y, p);
          if (s > bS) { bS = s; bY = y; bP = p; }
        }
      }
      of.look(bY, bP);
      aimed = {
        art: best.art, index: best.index, kind: best.kind,
        rangeM: +best.distanceM.toFixed(2), scale: +best.scale.toFixed(3),
        yaw: +bY.toFixed(1), pitch: +bP.toFixed(1),
        // The cosine between the camera ray and the direction to the node. 1.0
        // is dead centre; anything under about 0.999 means the search did not
        // converge and the frame is not of what it says it is.
        aimCos: +bS.toFixed(5),
      };
      await of.run(0.25);
    }
  }

  // The sun by DOT on the rising side, so the same argument names the same time
  // of day at every site. `of.stats().sky.elevationDot` and never
  // `__ofPost.state().sun`, which freezes below the horizon.
  const want = A.sunDot ?? 0.42;
  const samples = A.sunSamples ?? 480;
  let sunBest = { t: 0, e: -2 };
  let err = 9;
  let prevE = -2;
  for (let i = 0; i < samples; ++i) {
    const t = i / samples;
    of.setTime(t);
    const e = of.stats().sky.elevationDot;
    if (e > prevE) {
      const d = Math.abs(e - want);
      if (d < err) { err = d; sunBest = { t, e }; }
    }
    prevE = e;
  }
  of.setTime(sunBest.t);
  await of.settle(A.settle ?? 14);
  of.setTime(sunBest.t);

  const blob = await of.screenshot();
  const buf = await blob.arrayBuffer();
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; ++i) s += String.fromCharCode(b[i]);

  const rock = window.__ofRockMat ? window.__ofRockMat.state() : null;
  const art = window.__ofTerrainArt;

  return {
    png: `data:image/png;base64,${btoa(s)}`,
    site: site.name,
    aimed,
    sunDot: +sunBest.e.toFixed(4),
    sunErr: +err.toFixed(4),
    search: location.search,
    // The FIXTURE beside the picture, so a frame is self-documenting about what
    // it was actually photographing. A pair whose flags did not differ is the
    // failure this exists to make impossible to publish by accident.
    rockMat: rock === null ? null
      : { enabled: rock.enabled, flagPresent: rock.flagPresent, hooked: rock.hooked },
    terrainSpec: art ? art.getSpec() : null,
    nodes: of.stats().nodes ?? null,
  };
})()
