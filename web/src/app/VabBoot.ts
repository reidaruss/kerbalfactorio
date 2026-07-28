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
import type { Input } from '../player/Input.js';
import type { Vab } from '../game/Vab.js';

export interface VabExits {
  rollOut: (() => void) | null;
  recover: (() => boolean) | null;
}

export interface VabBootPorts {
  core: OfCoreModule;
  bodyHandle: number;
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
    M: p.core, body: p.bodyHandle, host: p.host, canvas: p.canvas,
    scene: p.scene, camera: p.camera, modals: g.modals, mode: g.mode,
    // GP-54: the bay's OWN launch key, live only while the bay holds the
    // pointer. Not on UI_ALLOWED, which is global and would give G to the
    // inventory screen too. Systems.ts turns the press into leave + roll out.
    // GP-121 / R11: `recover` joins it, or the key is swallowed exactly as
    // `board` was before GP-54, and the bay's new Clear pad button would be the
    // only way to reach a verb that has had a binding since GP-74.
    setUiCapture: (on) => { p.input.setUiCapture(on, ['board', 'recover']); },
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
    setWorldUi: (on) => {
      g.hud.setVisible(on);
      g.hotbarBar.setVisible(on);
      g.goalPanel.setVisible(on && g.goals.visible);
    },
  });
}
