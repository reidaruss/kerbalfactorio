// Registers the per-tick and per-frame work on the loop. Keeping this out of
// main.ts leaves the composition root pure wiring, and keeping it out of Loop.ts
// leaves the loop owning ORDER and nothing else.

import * as THREE from 'three';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';

/** Sun elevation, as dot(sunDir, up), at which the stock lights are fully out. */
const NIGHT_DOT = -0.12;
const DAY_DOT = 0.15;
const NOON = new THREE.Color(0xfff2df);
const HORIZON = new THREE.Color(0xff9b52);
/** Stands in for the player's up when there is no player to have one. */
const UP_FALLBACK = new THREE.Vector3(0, 1, 0);

export function registerSystems(s: Services, loop: Loop): void {
  const bodyCenterEngine = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const sunColor = new THREE.Color();
  let lastAnimSecs = 0;
  let lampHeld = false;

  loop.onFixedStep.push(() => {
    if (s.regime.update(s.observer.altM)) {
      s.terrain.setNearDepthCutoff(s.regime.state.nearDepthCutoff);
      s.events.emit('RegimeChanged', { band: s.regime.state.band });
    }
    s.terrain.request(s.observer.position);
    // W5. On the FIXED tick, not the frame: a dig and a harvest are simulation
    // events, so a driven tape acts exactly as often as a human holding the key.
    //
    // ONE BUTTON, THREE VERBS, and the HOTBAR picks which (GP-26). A part in
    // hand places and never digs, which is what `digAllowed` says. With the bare
    // hand, harvest still wins over digging when a node is in reach, because a
    // player looking at a tree who clicks means the tree, and digging a crater
    // under it instead is the sort of thing that makes a game feel unlistening.
    const busy = s.gameplay !== null && s.gameplay.fixedStep(loop.tickIndex - 1)
      ? true
      : (s.gameplay?.interact.hasTarget ?? false) || (s.gameplay?.uiOpen ?? false);
    const digArmed = s.gameplay?.digAllowed ?? true;
    if (s.dig !== null && s.player !== null) {
      const ray = s.player.aimRay();
      s.dig.step(s.input.frame.use && !busy && digArmed, ray.origin, ray.dir);
    }
    // WG-22 terraforming, on the same fixed tick and behind the same `busy`
    // gate: a player rummaging in a furnace is not reshaping the hillside. The
    // floor height comes from the player's own FEET, which is what makes the
    // tool read as "stand where you want the floor" rather than as a slider.
    if (s.level !== null && s.player !== null) {
      const ray = s.player.aimRay();
      s.level.step(s.input.frame.level && !busy, ray.origin, ray.dir,
        s.player.body.feet);
    }
    // WG-22. Reconcile the worker against the AUTHORITY when the edit set moved
    // by a route that was not an op: a save restore, or "put the rock back".
    // Two integer reads a tick, and it makes the worker's copy correct for any
    // future mutation site instead of only for the ones that remembered to
    // report. `digAt`/`levelAt` already told it about their own ops, so this
    // only fires on a foreign change.
    if (s.voxels !== null && s.voxels.driftedFromCore()) {
      const bytes = s.voxels.snapshotBytes();
      if (bytes !== null) s.terrain.syncEdits(bytes, s.observer.position);
    }
    // L is edge-detected here rather than held: a lamp that only shines while
    // the key is down is a torch button, and the player needs both hands.
    if (s.input.frame.lamp && !lampHeld) s.headlamp.toggle();
    lampHeld = s.input.frame.lamp;
  });

  // The voxel mesh re-derives its engine transform from its 64-bit anchor, the
  // same contract every other subscriber honours (ARCHITECTURE.md 3.6): nobody
  // applies the delta by hand.
  s.events.on('OriginRebased', () => { s.voxelMesh?.place(); s.levelRing?.place(); });

  loop.onDrain.push(() => {
    // The cross-fade ramp is SIM time, not wall clock, so a driven run on the
    // synthetic clock (Loop.run) dissolves at exactly the rate a real one does.
    s.terrain.nowSecs = loop.simSecs;
    s.terrain.drain();
    const p = s.player;
    if (p !== null && s.avatar !== null) {
      s.avatar.place(s.origin, p.body.feet, p.view.up, p.view.aim);
      s.avatar.placeViewModel(s.rig.vmCam.quaternion);
      // ONE state drives both skeletons (AnimGraph). The clock is Loop.simSecs,
      // not performance.now(), for the same reason the terrain cross-dissolve
      // uses it: a driven headless run then animates at exactly the rate a real
      // one does, so a captured pose is reproducible.
      const up = p.view.up;
      const v = p.body.vel;
      s.avatar.animate(Math.max(0, loop.simSecs - lastAnimSecs), {
        grounded: p.body.grounded,
        speedMps: p.body.speedMps,
        verticalMps: v.x * up.x + v.y * up.y + v.z * up.z,
      });
      lastAnimSecs = loop.simSecs;
      // The body is culled by CAMERA layer in FP, not by object visibility, so
      // the shadow caster still sees it and the player still casts a shadow.
      s.rig.setOwnBodyVisible(p.view.mode === 'TP');
      // The arms ARE the first-person silhouette; in TP the pass draws nothing.
      s.avatar.viewModel.visible = p.view.mode === 'FP';
    }
    // The body centre in engine space is simply -origin; the far scene puts it
    // at the scaled origin, which TerrainMaterials.update handles itself.
    bodyCenterEngine.set(-s.origin.origin.x, -s.origin.origin.y, -s.origin.origin.z);
    s.gameplay?.frame(loop.fixedDt);
    s.materials.update(bodyCenterEngine, loop.simSecs);
    s.sky.update(s.observer.position, s.observer.up, s.observer.altM);

    // Stock materials (PlanetProxy, Avatar) are lit by these; TerrainMaterial is
    // not. Driving them from the SAME sun elevation the sky uses is what stops
    // the avatar staying noon-lit on the night side.
    const elev = s.sky.elevation(s.observer.up);
    s.ibl.update(s.scenes.sky, elev);
    const k = THREE.MathUtils.smoothstep(elev, NIGHT_DOT, DAY_DOT);
    sunColor.copy(HORIZON).lerp(NOON, THREE.MathUtils.smoothstep(elev, 0.0, 0.35));
    // W5. How much sky the EYE can see, measured before the lights are set so
    // the same frame's lamp, ambient and sun all read one number. The lamp is
    // driven from the player's OWN eye and aim, not from the camera, so in third
    // person it stays on his head instead of 3.5 m behind it.
    const pv = s.player?.view ?? null;
    if (pv !== null) s.headlamp.measure(s.oracle, pv.eye);
    s.headlamp.update(loop.fixedDt, s.origin, pv?.eye ?? null,
      pv?.aim ?? fwd, pv?.up ?? UP_FALLBACK);
    const sunK = s.headlamp.sunScale;
    for (const light of s.sunLights) {
      // ShadowRig owns cascade 0's POSITION (fitted to the eye and texel
      // snapped), so a zero distance means "colour and intensity only".
      const dist = light.userData.distance as number;
      if (dist > 0) light.position.copy(s.sky.sunDirection).multiplyScalar(dist);
      // sunK is 0 under rock. Without it the cascade sun keeps raking the voxel
      // walls from a direction the player cannot see the source of, which is
      // exactly what made a tunnel read as an outdoor grey box.
      light.intensity = 3.0 * k * sunK;
      light.color.copy(sunColor);
    }
  });

  // AFTER the camera is placed: the cascades are fitted to the near camera, so
  // fitting them in onDrain would shadow last frame's pose.
  loop.onPreRender.push(() => {
    const cam = s.rig.nearCam;
    eye.setFromMatrixPosition(cam.matrixWorld);
    // Scatter follows the EYE, not the origin: the floating origin is only
    // rebased every 4 km, so a radius measured from it would put the foliage
    // ring kilometres away from the player.
    s.scatter.update(s.terrain.residentViews.values(), eye);
    cam.getWorldDirection(fwd);
    // Two reasons to skip the whole pass, both worth 58 draw calls:
    // nothing on the ground casts onto anything at orbital range (section 3.5,
    // cascades 0 in ORBIT), and below the horizon the sun casts nothing at all.
    // Measured at night without this: 164 draws against a 150 target.
    //
    // Being under rock is deliberately NOT a third reason, though the shadow
    // map down there is 58 draw calls of nothing. ShadowRig turns off by
    // clearing `visible` and `castShadow`, which changes three's lights state
    // hash and recompiles every material in the near scene; doing that on the
    // step where the player first ducks under a roof cost a measured 441 ms
    // stall. Underground the frame has 19 draw calls of its own, so those 58
    // are affordable and the stall is not. The sun is already at intensity 0
    // there (Headlamp.sunScale), so the map it renders is invisible anyway.
    const lit = s.sky.elevation(s.observer.up) > -0.03;
    s.shadows.update(eye, fwd, s.sky.sunDirection, lit && s.regime.state.band !== 'ORBIT');
  });

  // A capture is only allowed once the streamer has converged, the inbox is
  // empty and nothing is still dissolving in, which is what makes screenshots
  // reproducible instead of flaky.
  loop.settleGate = () => s.terrain.report().converged;
}
