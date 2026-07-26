// THE PACK STOPS BEING A SPREADSHEET: every slot gets the item's own mesh.
//
// `items_atlas.glb` has shipped fourteen item meshes since Tier 0 and nothing
// ever drew one, so the inventory was rows of text next to a game about objects.
// The meshes are there, they are tiny (120 tris each, no texture), and the
// cheapest way to put them on a DOM panel is to render each ONCE at boot into a
// 64 px canvas and hand the panel a data URL.
//
// WHY BAKE RATHER THAN DRAW LIVE. src/ui imports zero three.js by rule
// (scripts/check-limits enforces it), and a live 3D inventory would mean a
// second scene, a second camera and a per-frame cost for a panel that is shut
// most of the time. A data URL is a string: the panel stays plain DOM, the HUD
// can use the same strings, and the whole thing costs one render per item at
// boot and nothing at all afterwards.
//
// THE RENDERER IS TEMPORARY AND IS DISPOSED. A WebGL context is a scarce
// resource (browsers cap them at about sixteen), so this one is created, used
// for fourteen 64x64 draws, and destroyed before the game's own context does any
// work. Nothing here touches Scenes, the shadow rig or the frame loop.

import * as THREE from 'three';
import { loadGlb, renderMeshes } from '../assets/Loaders.js';

/** Icon edge in pixels. 64 is two DOM slots' worth on a HiDPI screen. */
const PX = 64;

/**
 * Where each icon's mesh lives. The atlas covers the resources; tools and
 * buildables borrow the LOD0 of the object they place, which is the honest
 * picture of them and costs no new art.
 */
const SOURCES: { url: string; nodes: string[] }[] = [
  { url: 'assets/items/items_atlas.glb', nodes: [
    'Item_Log', 'Item_StoneChunk', 'Item_CoalLump', 'Item_OreChunk_Iron',
    'Item_OreChunk_Copper', 'Item_IngotIron', 'Item_IngotCopper',
    'Item_WaterCanister', 'Item_OilFlask', 'Item_FerriteOre',
    'Item_FerritePlate', 'Item_FramePart', 'Item_Cinderite', 'Item_Combustite',
  ] },
  { url: 'assets/tools/crude_pickaxe.glb', nodes: ['CrudePickaxe_LOD0'] },
  { url: 'assets/tools/crude_axe.glb', nodes: ['CrudeAxe_LOD0'] },
  { url: 'assets/machines/primitive_furnace.glb', nodes: ['PrimitiveFurnace_LOD0'] },
  { url: 'assets/machines/survival_smelter.glb', nodes: ['SurvivalSmelter_LOD0'] },
  { url: 'assets/machines/miner.glb', nodes: ['Miner_LOD0'] },
  { url: 'assets/machines/belt_segment.glb', nodes: ['BeltSegment_LOD0'] },
  { url: 'assets/machines/smelter.glb', nodes: ['Smelter_LOD0'] },
];

/** The /core item name each mesh stands for. Names, not ids: `ItemIds` does not
 * carry the buildables the build menu uses, and a name is what the panel has. */
const BY_NAME: Record<string, string> = {
  Wood: 'Item_Log',
  Stone: 'Item_StoneChunk',
  Coal: 'Item_CoalLump',
  'Raw iron': 'Item_OreChunk_Iron',
  'Raw copper': 'Item_OreChunk_Copper',
  Iron: 'Item_IngotIron',
  Copper: 'Item_IngotCopper',
  Water: 'Item_WaterCanister',
  Oil: 'Item_OilFlask',
  'Ferrite ore': 'Item_FerriteOre',
  'Ferrite plate': 'Item_FerritePlate',
  'Frame part': 'Item_FramePart',
  Cinderite: 'Item_Cinderite',
  Combustite: 'Item_Combustite',
  'Crude pickaxe': 'CrudePickaxe_LOD0',
  'Crude axe': 'CrudeAxe_LOD0',
  'Primitive furnace': 'PrimitiveFurnace_LOD0',
  Smelter: 'SurvivalSmelter_LOD0',
  Miner: 'Miner_LOD0',
  Belt: 'BeltSegment_LOD0',
};

export interface IconStats { icons: number; ms: number; px: number }

export class ItemIcons {
  private readonly urls = new Map<string, string>();
  readonly stats: IconStats = { icons: 0, ms: 0, px: PX };

  /** The data URL for a /core display name, or '' when there is no mesh. */
  for(name: string): string {
    return this.urls.get(BY_NAME[name] ?? '') ?? '';
  }

  /**
   * Byte length of every baked icon, keyed by /core display name.
   *
   * The size is the assertable part. A canvas that rendered NOTHING still hands
   * back a valid PNG data URL, so "the call returned" and even "14 icons exist"
   * are both true of a set of blank squares; a transparent 64x64 PNG is about
   * 100 bytes and a drawn one is thousands, so a probe can tell them apart.
   */
  sizes(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, node] of Object.entries(BY_NAME)) {
      const u = this.urls.get(node);
      if (u !== undefined) out[name] = u.length;
    }
    return out;
  }

  /** Every icon, keyed by /core display name. What the panel is handed. */
  table(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, node] of Object.entries(BY_NAME)) {
      const u = this.urls.get(node);
      if (u !== undefined) out[name] = u;
    }
    return out;
  }

  /**
   * Load the source files, bake every icon, and throw the renderer away.
   * Resolves even when a file is missing: an inventory with no pictures is a
   * worse inventory, not a broken game, so a load failure degrades to text.
   */
  async load(): Promise<IconStats> {
    const t0 = performance.now();
    let canvas: HTMLCanvasElement | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = PX;
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setClearAlpha(0);
      const scene = new THREE.Scene();
      // Three-quarter key plus a soft fill: enough to read a silhouette and a
      // couple of planes at 64 px, and cheap enough that lighting is not a
      // subject here. No shadows: a 64 px icon cannot show one.
      const key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(0.6, 1.0, 0.8);
      scene.add(key, new THREE.HemisphereLight(0xbfd4ff, 0x40372c, 1.5));
      const holder = new THREE.Group();
      scene.add(holder);

      for (const src of SOURCES) {
        const g = await loadGlb(src.url).catch(() => null);
        if (g === null) continue;
        for (const node of src.nodes) {
          const mesh = this.bake(renderer, scene, holder, g.scene, node);
          if (mesh) { this.urls.set(node, canvas.toDataURL('image/png')); this.stats.icons++; }
        }
      }
    } catch { /* no WebGL for the baker: the panel falls back to text */ }
    renderer?.dispose();
    this.stats.ms = +(performance.now() - t0).toFixed(1);
    return this.stats;
  }

  /**
   * Frame one node and draw it. Returns false when the file has no such node.
   *
   * The camera is derived from the object's OWN bounding sphere, so a 0.26 m ore
   * chunk and a 2 m smelter both fill the frame: an icon set where the ore is
   * eight pixels because the smelter set the scale is worse than no icons.
   */
  private bake(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
               holder: THREE.Group, root: THREE.Object3D, node: string): boolean {
    const found = root.getObjectByName(node);
    if (found === undefined) return false;
    holder.clear();
    const clone = found.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    // Collision proxies are grey boxes around the art (ASSET-SPECS 2.5) and
    // would be the only thing an icon showed.
    for (const m of renderMeshes(clone)) m.visible = true;
    clone.traverse((o) => { if (o.name.startsWith('col_')) o.visible = false; });
    holder.add(clone);
    holder.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(clone);
    if (box.isEmpty()) return false;
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(0.02, box.getBoundingSphere(new THREE.Sphere()).radius);
    // Orthographic, because perspective on a 64 px thumbnail is distortion with
    // no depth cue to pay for it. 1.15 leaves a hair of margin at the corners.
    const half = radius * 1.15;
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, radius * 20);
    // A three-quarter view: the one angle that shows a top, a front and a side,
    // which is what makes a log read as a log rather than as a brown rectangle.
    const dir = new THREE.Vector3(0.75, 0.62, 1).normalize();
    cam.position.copy(centre).addScaledVector(dir, radius * 6);
    cam.lookAt(centre);
    renderer.setSize(PX, PX, false);
    renderer.render(scene, cam);
    return true;
  }
}
