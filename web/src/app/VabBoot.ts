// Building the assembly bay, lifted out of `Boot.ts` for the same reason
// `MapBoot.ts` was: Boot is at its 400-line cap and its job is composition
// order, not wiring detail.
//
// The LATE BINDING is the whole reason this needs a type. The bay is built
// BEFORE flight, because flight flies the bay's design handle, so the bay's two
// exits (roll out, and GP-121's recover) cannot hold references to something
// that does not exist yet. They go through one mutable holder that `Boot` fills
// in after flight is constructed, and both REFUSE OUT LOUD while it is empty:
// under `?flight=0` a dead button teaches the player the feature does not exist.
import * as THREE from 'three';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { Gameplay } from '../game/Gameplay.js';
import { UI_OWNERS, type Input } from '../player/Input.js';
import type { Vab } from '../game/Vab.js';

export interface VabExits {
  rollOut: (() => void) | null;
  recover: (() => boolean) | null;
}

export interface VabBootPorts {
  core: OfCoreModule;
  bodyHandle: number;
  /** GP-650. And its `BodyParams::bodyId`, for the destination list. */
  bodyId: number;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  input: Input;
  gameplay: Gameplay;
  setRenderMode(on: boolean): void;
}

export async function bootVab(p: VabBootPorts, exits: VabExits): Promise<Vab> {
  // Dynamically imported so `?vab=0` isolates the bay for real (standing rule
  // 7): a static import bundles and parses the whole module graph regardless.
  const { Vab: VabMode } = await import('../game/Vab.js');
  const g = p.gameplay;
  return VabMode.create({
    M: p.core, body: p.bodyHandle, bodyId: p.bodyId, host: p.host, canvas: p.canvas,
    scene: p.scene, camera: p.camera, modals: g.modals, mode: g.mode,
    // GP-54: the bay's OWN launch key, live only while the bay holds the
    // pointer. Not on UI_ALLOWED, which is global and would give G to the
    // inventory screen too. Systems.ts turns the press into leave + roll out.
    // GP-121 / R11: `recover` joins it, or the key is swallowed exactly as
    // `board` was before GP-54, and the bay's new Clear pad button would be the
    // only way to reach a verb that has had a binding since GP-74.
    // GP-820. Its own owner token, for the same reason MapBoot's is: the bay
    // releasing on exit must never touch a hold some other panel still has.
    setUiCapture: (on) => {
      p.input.setUiCapture(UI_OWNERS.vab, on, ['board', 'recover']);
    },
    setRenderMode: (on) => { p.setRenderMode(on); },
    rollOut: () => {
      if (exits.rollOut === null) {
        g.hud.banner('flight is not loaded (?flight=0)', '#ffb4a2');
        return;
      }
      exits.rollOut();
    },
    recover: () => {
      if (exits.recover === null) {
        g.hud.banner('flight is not loaded (?flight=0)', '#ffb4a2');
        return false;
      }
      return exits.recover();
    },
    // GP-267. THE RESEARCH GATE, asked exactly as the build menu asks it.
    // `researchGated` is `!sandbox`, so this returns '' for every item in
    // sandbox and the real answer in survival: the branch that matters is the
    // one no sandbox probe can reach, which is why `probes/vabdest.js` runs
    // in both and asserts the DIFFERENCE between them.
    lockOf: (item: number): string => {
      if (item <= 0 || !g.mode.researchGated) return '';
      const rs = g.progress.research;
      if (rs.itemAvailable(item)) return '';
      return rs.techForItem(item)?.name ?? 'a technology';
    },
    // The OFFER question, which is a different question from the LOCK question.
    // `itemGated` asks whether any tech claims this item at all; `itemAvailable`
    // asks whether it has been earned. Both, and in that order: an ungated item
    // is offered by the TIER rule or not at all, and must never be dragged into
    // the survival catalogue by a research clause that meant to admit one part.
    unlockedByTech: (item: number): boolean => {
      const rs = g.progress.research;
      return item > 0 && rs.itemGated(item) && rs.itemAvailable(item);
    },
    setWorldUi: (on) => {
      g.hud.setVisible(on);
      g.hotbarBar.setVisible(on);
      g.goalPanel.setVisible(on && g.goals.visible);
    },
  });
}
