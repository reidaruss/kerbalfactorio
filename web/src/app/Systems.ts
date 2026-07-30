// Registers the per-tick and per-frame work on the loop. Keeping this out of
// main.ts leaves the composition root pure wiring, and keeping it out of Loop.ts
// leaves the loop owning ORDER and nothing else.

import * as THREE from 'three';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';
import { windUpdate } from '../render/instancing/PropWind.js';
import { dayAdvance } from '../sim/DayCycle.js';
import { terrainNightAmbient } from '../render/materials/TerrainAmbient.js';

/** Sun elevation, as dot(sunDir, up), at which the stock lights are fully out. */
const NIGHT_DOT = -0.12;
const DAY_DOT = 0.15;
const NOON = new THREE.Color(0xfff2df);
const HORIZON = new THREE.Color(0xff9b52);
/** Stands in for the player's up when there is no player to have one. */
const UP_FALLBACK = new THREE.Vector3(0, 1, 0);

export function registerSystems(s: Services, loop: Loop): void {
  // W8. The assembly bay is entered and left with ONE key, edge-detected here
  // rather than inside Gameplay because the bay is not part of Gameplay: it owns
  // its own pointer, its own scene and its own pass. Escape still closes it, and
  // through the DERIVED modal list rather than through a second handler (GP-25),
  // because its panel joins the stack in its own constructor.
  let assemblyHeld = false;
  let boardHeld = false;
  let recoverHeld = false;
  let mapHeld = false;
  let holdHeld = false;
  loop.onFixedStep.push((_dt, tick) => {
    // GP-57. THE PAD'S CLAMPS, ON THE FIXED TICK AND NOT ON THE FRAME.
    //
    // The launch clamp releases inside `FlightSession.stepClamped`, which
    // `Loop.fixedTick` reaches through `observer.step` immediately before this
    // list runs, so `tick` here IS the tick the release happened on. A frame
    // carries one to three fixed ticks, so putting this beside `flight.frame`
    // in `onPreRender` would let the arms swing up to two ticks late with every
    // instrument still reading "they both happened".
    //
    // `fixedTick` is handed to the session for the NEXT tick, because
    // `observer.step` runs BEFORE this list: at tick T this sets T + 1, and the
    // release that happens inside `observer.step` at T + 1 stamps itself T + 1.
    // The two ticks are then written by two different systems reading two
    // different variables, which is what makes comparing them a test rather
    // than a restatement of one assignment.
    s.flight?.stepPadClamps(tick);
    if (s.flight !== undefined && s.flight !== null) {
      s.flight.session.fixedTick = tick + 1;
    }
    const on = s.input.act('assembly');
    if (on && !assemblyHeld) s.vab?.toggle();
    assemblyHeld = on;
    // W9. Board / roll out / disembark, edge-detected here for the same reason
    // the bay's key is: flight is not part of Gameplay, it owns its own eye.
    //
    // GP-54. THIS USED TO REFUSE THE KEY WHILE THE BAY WAS OPEN, AND IT WAS THE
    // WORST ANSWER AVAILABLE. Reid built a rocket, pressed the launch key at it
    // and the game did nothing whatsoever: `board` is not on UI_ALLOWED so the
    // press never arrived, and this line would have discarded it if it had. A
    // silent no-op teaches the player the feature does not exist. It now means
    // what they meant: leave the bay and roll the thing you just built out onto
    // the ground. Leaving FIRST matters, because `rollOut` puts the pad in
    // front of the player's own feet and yaw, and inside the bay both of those
    // belong to a camera orbiting a stand.
    const b = s.input.act('board');
    if (b && !boardHeld) {
      const vab = s.vab;
      if (vab?.open === true) s.flight?.fromBay(() => vab.leave());
      else s.flight?.board();
    }
    boardHeld = b;
    // GP-74. THE WAY OUT, edge-detected here beside the key that made the
    // vessel, because it is the same kind of key: flight owns its own eye and
    // neither of these is part of Gameplay's on-foot tick. It is deliberately
    // NOT gated on being aboard or on standing near the pad. A range test is
    // what turned this from a missing feature into a dead end the first time:
    // the only escape from a rocket that could not lift was to walk 200 m and
    // overwrite it with `board`, and a recovery you have to walk away from to
    // use is a recovery for the case that is not the emergency.
    const rk = s.input.act('recover');
    if (rk && !recoverHeld) s.flight?.recover();
    recoverHeld = rk;
    // W12. The MAP, on M. Same shape and same reason as the two above: it owns
    // its own pointer, and it refuses OUT LOUD off the vessel rather than doing
    // nothing, which is GP-54's lesson applied before it can bite again.
    const mk = s.input.act('map');
    if (mk && !mapHeld) s.map?.toggle();
    mapHeld = mk;
    // HOLD-NODE, the eighth SAS key. It lives here rather than in
    // FlightControls because it is not a MODE: it is SAS Command aimed at a
    // direction only the node knows, and FlightControls has no node.
    const hk = s.input.act('sasNode');
    if (hk && !holdHeld) s.map?.toggleHold();
    holdHeld = hk;
    // The ON-FOOT half of the gameplay tick is suspended while strapped in; the
    // FACTORY half is not, and that distinction is the whole point. A flight
    // that quietly froze the base would be two games again.
    //
    // The ghost has to be dropped as well as gated: `BuildMode` re-arms itself
    // from the hotbar every tick, so a part left in hand would keep drawing a
    // placement preview at a frozen walker's crosshair while the player is at
    // 80 km. Done here rather than inside Gameplay because Systems already owns
    // "what runs this tick" and Gameplay is at its line cap.
    const g = s.gameplay;
    if (g !== null) {
      const strapped = s.flight?.aboard === true;
      if (strapped !== g.suspended) {
        g.suspended = strapped;
        if (strapped) {
          g.build.arm(null);
          g.interact.target = null;
          g.aimedMachine = null; g.aimedBuild = null; g.aimedPart = null;
        }
      }
    }
  });
  loop.onDrain.push(() => { s.vab?.tick(performance.now()); });

  const bodyCenterEngine = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const sunColor = new THREE.Color();
  let lastAnimSecs = 0;
  let lampHeld = false;

  loop.onFixedStep.push((dt) => {
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
    // W9. Strapped into a rocket you have no hands: the walker is frozen at the
    // pad, so its aim ray is stale, and a click while in orbit would otherwise
    // dig a crater under a parked avatar 80 km below.
    const aboard = s.flight?.aboard === true;
    const digArmed = (s.gameplay?.digAllowed ?? true) && !aboard;
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
      s.level.step(s.input.frame.level && !busy && !aboard, ray.origin, ray.dir,
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
    // PH-86. THE SUN ADVANCES ON THE FIXED TICK, one full day+night per
    // DAY_CYCLE_S of sim time. On the fixed tick and not in onDrain because the
    // phase is SIM state (it is saved, and warp credits it); the per-frame
    // consumers below read whatever this wrote, exactly as they always did.
    // The first call seeds from the sky's boot value, or from a saved `dayT`
    // stashed by `readSlot`; `?t=` on the command line beats both (RN-13).
    s.sky.setSunT(dayAdvance(dt, s.sky.sunT, s.cfg.sunTExplicit !== null));
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
    // `flying` silences the on-foot presentation; the SIM half of gameplay
    // above is untouched. The vessel's own meshes are placed in onPreRender
    // rather than here, because they have to use the same interpolated instant
    // the camera does (VesselObserver.renderPos).
    const flying = s.flight?.aboard === true;
    const p = s.player;
    if (s.avatar !== null && flying) {
      // A rocket is a third-person view of a vehicle, so BOTH the body and the
      // first-person arms go: an arm floating at the eye 80 km up would be the
      // most obvious defect in the whole milestone.
      s.avatar.group.visible = false;
      s.avatar.viewModel.visible = false;
      s.rig.setOwnBodyVisible(false);
    } else if (s.avatar !== null) {
      s.avatar.group.visible = true;
    }
    if (p !== null && s.avatar !== null && !flying) {
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
    // The foliage wind clock, beside the terrain's for the same reason the
    // water shares the terrain's uTime: one sim clock, so pausing the sim
    // stops the breeze exactly as it stops the ripples.
    windUpdate(loop.simSecs);
    s.sky.update(s.observer.position, s.observer.up, s.observer.altM);

    // Stock materials (PlanetProxy, Avatar) are lit by these; TerrainMaterial is
    // not. Driving them from the SAME sun elevation the sky uses is what stops
    // the avatar staying noon-lit on the night side.
    const elev = s.sky.elevation(s.observer.up);
    // RN-64. The observer's up IS the direction from the planet centre, so this
    // is the /core classifier answering "what ground am I standing on" at the
    // one place that already holds both the oracle and the eye. SkyIbl turns it
    // into an albedo through the same palette TerrainMaterial uploads, and only
    // when it is actually rebuilding, so this is one WASM call per frame and no
    // colour work at all in between.
    const up = s.observer.up;
    s.ibl.update(s.scenes.sky, elev, s.oracle.biomeAt(up.x, up.y, up.z));
    // RN-152: the starlight floor rides the SAME elevation the sky, the IBL
    // and the sun lights read, written into the shared TERRAIN_AMBIENT object
    // both terrain materials and the sky ground shell hold by reference.
    terrainNightAmbient(elev);
    const k = THREE.MathUtils.smoothstep(elev, NIGHT_DOT, DAY_DOT);
    sunColor.copy(HORIZON).lerp(NOON, THREE.MathUtils.smoothstep(elev, 0.0, 0.35));
    // W5. How much sky the EYE can see, measured before the lights are set so
    // the same frame's lamp, ambient and sun all read one number. The lamp is
    // driven from the player's OWN eye and aim, not from the camera, so in third
    // person it stays on his head instead of 3.5 m behind it.
    // Null while flying: the lamp is on the player's HEAD, and leaving it on a
    // frozen walker's head would light the pad from orbit.
    const pv = flying ? null : s.player?.view ?? null;
    if (pv !== null) s.headlamp.measure(s.oracle, pv.eye);
    s.headlamp.update(loop.fixedDt, s.origin, pv?.eye ?? null,
      pv?.aim ?? fwd, pv?.up ?? UP_FALLBACK, elev);
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
    // AFTER observer.interpolate and rig.setView: the vessel is drawn at the
    // interpolated instant the camera was placed for, so the model and the eye
    // agree. Placing it in onDrain instead put it a whole tick of travel out,
    // which is 38 m at orbital speed and reads as a rocket that has vanished.
    s.flight?.frame(loop.simSecs);
    // AFTER flight: the node is re-planned off the state flight has just
    // sampled, so the ball's node marker and the map draw the same instant.
    // SIM seconds, not real ones: the map feeds the discovery field from here
    // (DW-36) and a warped orbit has to lay its ground track down at the rate
    // the world moved, not the rate the screen refreshed.
    s.map?.frame(loop.simSecs);
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
