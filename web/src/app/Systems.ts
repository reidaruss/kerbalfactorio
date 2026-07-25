// Registers the per-tick and per-frame work on the loop. Keeping this out of
// main.ts leaves the composition root pure wiring, and keeping it out of Loop.ts
// leaves the loop owning ORDER and nothing else.

import * as THREE from 'three';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';

export function registerSystems(s: Services, loop: Loop): void {
  const bodyCenterEngine = new THREE.Vector3();

  loop.onFixedStep.push(() => {
    if (s.regime.update(s.observer.altM)) {
      s.terrain.setNearDepthCutoff(s.regime.state.nearDepthCutoff);
      s.events.emit('RegimeChanged', { band: s.regime.state.band });
    }
    s.terrain.request(s.observer.position);
  });

  loop.onDrain.push(() => {
    s.terrain.drain();
    // The body centre in engine space is simply -origin; the far scene puts it
    // at the scaled origin, which TerrainMaterials.update handles itself.
    bodyCenterEngine.set(-s.origin.origin.x, -s.origin.origin.y, -s.origin.origin.z);
    s.materials.update(s.sky.sunDirection, bodyCenterEngine);
    for (const light of s.sunLights) {
      light.position.copy(s.sky.sunDirection).multiplyScalar(light.userData.distance as number);
    }
  });

  // A capture is only allowed once the streamer has converged and the inbox is
  // empty, which is what makes screenshots reproducible instead of flaky.
  loop.settleGate = () => s.terrain.report().converged;
}
