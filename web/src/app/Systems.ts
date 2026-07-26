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

export function registerSystems(s: Services, loop: Loop): void {
  const bodyCenterEngine = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const sunColor = new THREE.Color();
  let lastAnimSecs = 0;

  loop.onFixedStep.push(() => {
    if (s.regime.update(s.observer.altM)) {
      s.terrain.setNearDepthCutoff(s.regime.state.nearDepthCutoff);
      s.events.emit('RegimeChanged', { band: s.regime.state.band });
    }
    s.terrain.request(s.observer.position);
  });

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
    s.materials.update(bodyCenterEngine, loop.simSecs);
    s.sky.update(s.observer.position, s.observer.up, s.observer.altM);

    // Stock materials (PlanetProxy, Avatar) are lit by these; TerrainMaterial is
    // not. Driving them from the SAME sun elevation the sky uses is what stops
    // the avatar staying noon-lit on the night side.
    const elev = s.sky.elevation(s.observer.up);
    const k = THREE.MathUtils.smoothstep(elev, NIGHT_DOT, DAY_DOT);
    sunColor.copy(HORIZON).lerp(NOON, THREE.MathUtils.smoothstep(elev, 0.0, 0.35));
    for (const light of s.sunLights) {
      // ShadowRig owns cascade 0's POSITION (fitted to the eye and texel
      // snapped), so a zero distance means "colour and intensity only".
      const dist = light.userData.distance as number;
      if (dist > 0) light.position.copy(s.sky.sunDirection).multiplyScalar(dist);
      light.intensity = 3.0 * k;
      light.color.copy(sunColor);
    }
  });

  // AFTER the camera is placed: the cascades are fitted to the near camera, so
  // fitting them in onDrain would shadow last frame's pose.
  loop.onPreRender.push(() => {
    const cam = s.rig.nearCam;
    eye.setFromMatrixPosition(cam.matrixWorld);
    cam.getWorldDirection(fwd);
    // Two reasons to skip the whole pass, both worth 58 draw calls:
    // nothing on the ground casts onto anything at orbital range (section 3.5,
    // cascades 0 in ORBIT), and below the horizon the sun casts nothing at all.
    // Measured at night without this: 164 draws against a 150 target.
    const lit = s.sky.elevation(s.observer.up) > -0.03;
    s.shadows.update(eye, fwd, s.sky.sunDirection, lit && s.regime.state.band !== 'ORBIT');
  });

  // A capture is only allowed once the streamer has converged, the inbox is
  // empty and nothing is still dissolving in, which is what makes screenshots
  // reproducible instead of flaky.
  loop.settleGate = () => s.terrain.report().converged;
}
