// THE FRAME: node transforms, depletion variants, effects, the HUD and the
// panels (GP-1076, split out of Gameplay.ts under the 400-line cap).
//
// THE OTHER HALF OF THE PAIR IN GameplayStep.ts, and the split between them is
// the project's oldest one: a rule runs on the SIM clock and a picture runs on
// the frame. Everything here is drawing or the arithmetic drawing needs, and
// the two places that deliberately use sim seconds rather than `performance.
// now()` (the belt scroll, the terrain cross-dissolve) say so at the line.
//
// The ordering comments inside are load-bearing and unchanged: the rocks and
// trees before `field.update` so a rock added this frame is drawn in it, the
// feet rather than the camera so an LOD boundary and a ring boundary are
// measured from one origin, and ONE prompt decision made in one place.
import { padPrompt } from './LaunchPadPlacement.js';
import { investigatePrompt } from './RuinInteract.js';
import { aimPrompt, ghostMachinePrompt } from './FactoryReport.js';
import { ghostPrompt } from './StructurePlacement.js';
import { screenView } from './MachineScreen.js';
import { recipes, slots } from './GameplayActions.js';
import { stepGoals } from './Objectives.js';
import { computeCompass } from './Compass.js';
import type { Gameplay } from './Gameplay.js';
import type { GameplayDeps } from './GameplayDeps.js';

/** Per frame: node transforms, depletion variants, effects, HUD, panels. */
export function frameOf(g: Gameplay, d: GameplayDeps, dt: number): void {
  g.simSecs += dt;
  // RN-2225. THE VEGETATION ORIGIN, and on foot it IS `d.player.body.feet`,
  // the same object read through a name that also has an answer when the eye
  // is somewhere the capsule is not. See `GameplayDeps.vegOrigin`.
  const veg = d.vegOrigin();
  // BEFORE field.update, so a rock added this frame is composed and drawn in
  // the same frame rather than flashing in a frame late at the ring's edge.
  g.rocks.update(veg);
  g.trees.update(veg);
  // The ORIGIN, not the camera: it is the same body-frame point the streaming
  // rings use, so an LOD boundary and a ring boundary are measured from one
  // origin and cannot disagree by an eye height.
  g.field.update(dt, veg);
  g.oreField.update(dt, d.ports?.voxels?.handle ?? 0);
  g.machines.update();
  g.machines.updateFx(dt);
  g.stations.update();
  g.antennas.update();
  g.wreckage.update();
  // WG-166 / WG-170. The floating-origin re-place AND the LOD rung, off the
  // same feet the two rings above use, for the reason the comment above
  // `field.update` gives.
  g.ruins.update(d.player.body.feet);
  g.structures.step(dt);
  g.structView.sync(g.structures);
  g.pads.step(dt);
  g.padView.sync(g.pads);
  g.fx.update(dt, d.origin);
  g.gun.fx.update(dt, d.origin);
  g.enemies.frame(g);
  const eye = d.player.aimRay().origin;
  g.sfx.walk(dt, d.player.body.speedMps, d.player.body.grounded);
  g.fx.beds(g.factory, g.machines, eye, (base) =>
    g.ambience.step(dt, eye, d.player.body.underRock, base));
  // The belt scroll is driven by SIM seconds, not performance.now(), for the
  // same reason the terrain cross-dissolve is: a headless driven run then
  // scrolls at exactly the rate a real one does and a capture is reproducible.
  g.factoryView.sync(g.factory, g.simSecs, eye);  // eye: FS-28 LOD 0
  if (g.openMachine !== null || g.openBuild !== null) {
    g.furnacePanel.render(screenView(g));
  }
  g.hud.setHealth(g.vitals.health);
  const carried = g.game.carried().map((c) => ({
    name: c.name, count: c.count, icon: g.icons.for(c.name),
  }));
  // ONE prompt decision, made in one place. It used to be four early returns
  // here, and every one of them had to remember the two panel conditions.
  // GP-700. `computeCompass` runs every frame regardless of mode (Gameplay
  // holds no `aboard`/map-open fact to gate it on); `GameHud.render` is the
  // one place that decides whether it draws, off the SAME `setVisible` the
  // crosshair already hides behind.
  g.hud.render(dt, g.uiOpen ? null : padPrompt(g.build.padTarget)
    ?? ghostPrompt(g.build.structTarget)
    ?? ghostMachinePrompt(g.build.label, g.build.target)
    ?? investigatePrompt(g.aimedInvestigate)
    ?? aimPrompt(g.factory, g.game, g.aimedBuild, g.aimedMachine,
      g.interact.target), carried, computeCompass(g));
  g.hotbarBar.render(g.hotbar.rows((n) => g.icons.for(n)));
  g.progress.frame();
  stepGoals(g, dt);
  if (g.panel.isOpen) g.panel.render(slots(g), recipes(g));
}
