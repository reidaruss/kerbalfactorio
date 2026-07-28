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
// for a couple of dozen 64x64 draws, and destroyed before the game's own context
// does any work. Nothing here touches Scenes, the shadow rig or the frame loop.
//
// H-7: THE TABLE IS THE WHOLE SYSTEM, AND IT CARRIES /core's ItemId. The power
// pole, the burner generator and the electric smelter became craftable and fell
// back to text because they were not rows in it. A row is now `{id, name, url,
// nodes}` rather than two half-tables keyed by node name, so adding an item is
// one line and a probe can assert BY ID instead of by a display string. A row
// with no nodes is a DELIBERATE text fallback carrying the reason, because
// "there is no mesh for a science pack" and "somebody forgot" must not look the
// same in the report.

import * as THREE from 'three';
import { loadGlb, renderMeshes } from '../assets/Loaders.js';
import { ASSETS } from '../assets/Registry.js';

/** Icon edge in pixels. 64 is two DOM slots' worth on a HiDPI screen. */
const PX = 64;

/**
 * Coverage below which a bake counts as BLANK. 4096 pixels in a cell, so 32 is
 * 0.8% of it: below any real silhouette (the thinnest thing here, the power
 * pole's lattice mast, measures in the hundreds) and above the zero an empty
 * camera view produces. A valid PNG of nothing is the failure this file exists
 * to make impossible to report as success.
 */
const MIN_PIXELS = 32;

const ATLAS = 'assets/items/items_atlas.glb';
const MACH = 'assets/machines/';

/** One row of the icon table. `nodes` empty means deliberately no picture. */
export interface IconSpec {
  /** The /core ItemId (gameplay.h `items::`), so probes assert by id. */
  readonly id: number;
  /** The /core display name. What the panel and the hotbar look an icon up by. */
  readonly name: string;
  readonly url: string;
  /** Every node the picture is made of, drawn together in their authored pose. */
  readonly nodes: readonly string[];
  /** Why this row has no picture. Only meaningful when `nodes` is empty. */
  readonly why: string;
}

const R = (id: number, name: string, url: string, ...nodes: string[]): IconSpec =>
  ({ id, name, url, nodes, why: '' });

/** A row that has NO mesh anywhere in the shipped set, and says so. */
const TEXT = (id: number, name: string, why: string): IconSpec =>
  ({ id, name, url: '', nodes: [], why });

/**
 * Every item that can reach a slot, its /core id, and the mesh its picture is
 * made of. The atlas covers the resources; tools and buildables borrow the LOD0
 * of the object they place, which is the honest picture of them and costs no new
 * art.
 *
 * THE GENERATOR TAKES TWO NODES. `Generator_Flywheel` is a sibling of
 * `Generator_LOD0` rather than a child, because it is animated (ASSET-SPECS
 * 4.18, `Gen_Flywheel`), and the flywheel is the machine's entire read: an icon
 * of the LOD0 alone is a boiler on a skid with the one distinctive part missing.
 * A still picture wants the parts that move, so the row names both.
 */
export const ICON_TABLE: readonly IconSpec[] = [
  R(0x0030, 'Wood', ATLAS, 'Item_Log'),
  R(0x0031, 'Stone', ATLAS, 'Item_StoneChunk'),
  R(0x0032, 'Coal', ATLAS, 'Item_CoalLump'),
  R(0x0033, 'Raw iron', ATLAS, 'Item_OreChunk_Iron'),
  R(0x0034, 'Raw copper', ATLAS, 'Item_OreChunk_Copper'),
  R(0x0037, 'Iron', ATLAS, 'Item_IngotIron'),
  R(0x0038, 'Copper', ATLAS, 'Item_IngotCopper'),
  R(0x0035, 'Water', ATLAS, 'Item_WaterCanister'),
  R(0x0036, 'Oil', ATLAS, 'Item_OilFlask'),
  R(0x0001, 'Ferrite ore', ATLAS, 'Item_FerriteOre'),
  R(0x0002, 'Ferrite plate', ATLAS, 'Item_FerritePlate'),
  R(0x0003, 'Frame part', ATLAS, 'Item_FramePart'),
  R(0x0004, 'Cinderite', ATLAS, 'Item_Cinderite'),
  R(0x0005, 'Combustite', ATLAS, 'Item_Combustite'),
  R(0x0039, 'Crude pickaxe', ASSETS.crudePickaxe, 'CrudePickaxe_LOD0'),
  R(0x003a, 'Crude axe', ASSETS.crudeAxe, 'CrudeAxe_LOD0'),
  R(0x003b, 'Primitive furnace', `${MACH}primitive_furnace.glb`, 'PrimitiveFurnace_LOD0'),
  R(0x003c, 'Smelter', `${MACH}survival_smelter.glb`, 'SurvivalSmelter_LOD0'),
  R(0x0010, 'Miner', `${MACH}miner.glb`, 'Miner_LOD0'),
  R(0x0011, 'Belt', `${MACH}belt_segment.glb`, 'BeltSegment_LOD0'),
  // H-7. Craftable since ABI 9 and pictureless until now. All three place the
  // EXISTING machine TypeIds (0x12 / 0x15 / 0x16), so the art already ships and
  // this is three table rows rather than three assets.
  R(0x003d, 'Electric smelter', `${MACH}smelter.glb`, 'Smelter_LOD0'),
  R(0x003e, 'Burner generator', `${MACH}generator.glb`,
    'Generator_LOD0', 'Generator_Flywheel'),
  R(0x003f, 'Power pole', `${MACH}power_pole.glb`, 'PowerPole_LOD0'),
  // The four armour pieces reached the same craft menu in the same ABI bump and
  // had the same problem. `armour_set.glb` ships them SKINNED, which is why they
  // are baked from the bind pose (see `bake`) rather than posed.
  R(0x0070, 'Iron helm', ASSETS.armourSet, 'Armour_Head_LOD0'),
  R(0x0071, 'Iron cuirass', ASSETS.armourSet, 'Armour_Chest_LOD0'),
  R(0x0072, 'Iron greaves', ASSETS.armourSet, 'Armour_Legs_LOD0'),
  R(0x0073, 'Iron boots', ASSETS.armourSet, 'Armour_Feet_LOD0'),
  // DELIBERATE TEXT, not an oversight. Nothing in the shipped GLB set is a
  // science pack: `items_atlas.glb` carries fourteen item meshes and a generic
  // crate, and drawing two different packs as the same crate is worse than
  // drawing their names. These rows exist so the report can say WHICH it is.
  TEXT(0x0020, 'Automation science', 'no science-pack mesh ships in any GLB'),
  TEXT(0x0021, 'Logistic science', 'no science-pack mesh ships in any GLB'),
  TEXT(0x0022, 'Cinder science', 'no science-pack mesh ships in any GLB'),
];

/**
 * The /core item name each mesh stands for, derived from the table above.
 *
 * EXPORTED since FS-28, because belt cargo needs exactly the same question
 * answered ("which mesh is this item?") and a second table would be a second
 * answer. The icon baker wants a picture and the belt wants a 3D instance; both
 * are the same mesh, so both read this. Belt cargo only instances what its own
 * atlas holds and falls back to `Item_Crate` for everything else, so a machine
 * node appearing here never puts a 4 m power pole on a 1 m tile.
 */
export const ITEM_MESH_NODE: Record<string, string> = Object.fromEntries(
  ICON_TABLE.filter((r) => r.nodes.length > 0).map((r) => [r.name, r.nodes[0]]),
);

/** What one row produced. Every field is something a probe can fail on. */
export interface IconDetail {
  /** '0x003e'. The id, because a display string is not an identity. */
  readonly id: string;
  readonly name: string;
  /** The nodes the picture was made of, joined. '' for a text row. */
  readonly nodes: string;
  /** Triangles ACTUALLY BOUND. 0 means the lookup matched no geometry. */
  readonly tris: number;
  /** Non-transparent pixels of 4096. 0 means the camera framed nothing. */
  readonly pixels: number;
  readonly bytes: number;
  /** '' when there is a picture; otherwise why there is not. */
  readonly fallback: string;
}

export interface IconStats {
  icons: number;
  ms: number;
  px: number;
  /** Rows that SHOULD have a picture and do not. Always empty in a good build. */
  broken: string[];
  /** Rows that deliberately have none, with the reason. Legible, not silent. */
  textOnly: { name: string; why: string }[];
  detail: IconDetail[];
}

export class ItemIcons {
  private readonly urls = new Map<string, string>();
  readonly stats: IconStats =
    { icons: 0, ms: 0, px: PX, broken: [], textOnly: [], detail: [] };

  /** The data URL for a /core display name, or '' when there is no picture. */
  for(name: string): string {
    return this.urls.get(name) ?? '';
  }

  /** The same answer keyed by /core ItemId, which is the identity that lasts. */
  forId(id: number): string {
    const row = ICON_TABLE.find((r) => r.id === id);
    return row === undefined ? '' : this.for(row.name);
  }

  /**
   * Byte length of every baked icon, keyed by /core display name.
   *
   * The size is the assertable part. A canvas that rendered NOTHING still hands
   * back a valid PNG data URL, so "the call returned" and even "every row baked"
   * are both true of a set of blank squares; a transparent 64x64 PNG is about
   * 100 bytes and a drawn one is thousands, so a probe can tell them apart.
   * `stats.detail` carries the stronger version of the same claim, a count of
   * pixels that are not the background.
   */
  sizes(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, url] of this.urls) out[name] = url.length;
    return out;
  }

  /** Every icon, keyed by /core display name. What the panel is handed. */
  table(): Record<string, string> {
    return Object.fromEntries(this.urls);
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
    for (const row of ICON_TABLE) {
      if (row.nodes.length === 0) this.stats.textOnly.push({ name: row.name, why: row.why });
    }
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

      // One load per FILE, not per row: armour_set.glb carries four rows and the
      // atlas fourteen, and loadGlb dedupes anyway.
      const files = new Map<string, THREE.Object3D | null>();
      for (const row of ICON_TABLE) {
        if (row.nodes.length === 0) continue;
        if (!files.has(row.url)) {
          const g = await loadGlb(row.url).catch(() => null);
          files.set(row.url, g === null ? null : g.scene);
        }
        const root = files.get(row.url) ?? null;
        const shot = root === null ? { tris: 0, pixels: 0 }
          : this.bake(renderer, scene, holder, root, row);
        const ok = shot.tris > 0 && shot.pixels >= MIN_PIXELS;
        let bytes = 0;
        if (ok) {
          const url = canvas.toDataURL('image/png');
          this.urls.set(row.name, url);
          bytes = url.length;
          this.stats.icons++;
        } else {
          this.stats.broken.push(row.name);
        }
        this.stats.detail.push({
          id: `0x${row.id.toString(16).padStart(4, '0')}`,
          name: row.name, nodes: row.nodes.join('+'),
          tris: shot.tris, pixels: shot.pixels, bytes,
          fallback: ok ? '' : (root === null ? 'file did not load'
            : shot.tris === 0 ? 'no geometry matched the node names'
              : 'the bake drew nothing'),
        });
      }
    } catch { /* no WebGL for the baker: the panel falls back to text */ }
    renderer?.dispose();
    for (const row of ICON_TABLE) {
      if (row.nodes.length > 0 && !this.urls.has(row.name)
        && !this.stats.broken.includes(row.name)) this.stats.broken.push(row.name);
      if (row.nodes.length === 0) {
        this.stats.detail.push({
          id: `0x${row.id.toString(16).padStart(4, '0')}`, name: row.name,
          nodes: '', tris: 0, pixels: 0, bytes: 0, fallback: row.why,
        });
      }
    }
    this.stats.ms = +(performance.now() - t0).toFixed(1);
    return this.stats;
  }

  /**
   * Frame one row's nodes and draw them. Returns what was bound and what landed
   * on the canvas, so the caller never has to trust that "it returned".
   *
   * The camera is derived from the object's OWN bounding sphere, so a 0.26 m ore
   * chunk and a 4 m power pole both fill the frame: an icon set where the ore is
   * eight pixels because the pole set the scale is worse than no icons.
   *
   * THE SUBJECT IS REBUILT FROM FLAT MESHES rather than cloned as a subtree, for
   * three reasons that all bit somebody in this repo. It is what lets one row
   * name two sibling nodes. It drops skinning (a bind-pose Mesh is a still life;
   * a SkinnedMesh cloned away from its skeleton's world matrices collapses). And
   * it is where the triangle count comes from, which is the number that catches
   * the GLTFLoader split described in `iconMeshes`.
   */
  private bake(renderer: THREE.WebGLRenderer, scene: THREE.Scene,
               holder: THREE.Group, root: THREE.Object3D,
               row: IconSpec): { tris: number; pixels: number } {
    root.updateMatrixWorld(true);
    holder.clear();
    // Poses are taken relative to the first node's PARENT, so the two halves of
    // a two-node row keep their authored offset from each other while the row as
    // a whole is neutral of wherever it sat in the file.
    const base = new THREE.Matrix4();
    for (const n of row.nodes) {
      const p = root.getObjectByName(n)?.parent;
      if (p !== undefined && p !== null) { base.copy(p.matrixWorld).invert(); break; }
    }
    let tris = 0;
    for (const n of row.nodes) {
      for (const m of iconMeshes(root, n)) {
        const g = new THREE.Mesh(m.geometry, m.material);
        // glTF says a skinned mesh ignores its node transform, so the bind-pose
        // geometry is already where it belongs.
        if ((m as THREE.SkinnedMesh).isSkinnedMesh !== true) {
          g.matrix.multiplyMatrices(base, m.matrixWorld);
          g.matrix.decompose(g.position, g.quaternion, g.scale);
        }
        holder.add(g);
        tris += triangles(m.geometry);
      }
    }
    if (tris === 0) return { tris: 0, pixels: 0 };
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    if (box.isEmpty()) return { tris, pixels: 0 };
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
    return { tris, pixels: drawnPixels(renderer) };
  }
}

/**
 * The meshes a node stands for, with the GLTFLoader split accounted for.
 *
 * THE TRAP THIS EXISTS FOR. GLTFLoader names an object after its glTF NODE only
 * when the loader has one object to name; a node whose mesh has several
 * primitives becomes a Group whose children are `<mesh>_1`, `<mesh>_2`, ... and
 * an exporter that names the mesh but not the node leaves nothing called
 * `<node>` at all. `Generator_LOD0` is five primitives and `Armour_Chest_LOD0`
 * is four, so an exact-name lookup that "succeeds" can still bind a fraction of
 * the geometry, or none of it, and report an icon either way. The tolerance is
 * the `_<digits>` suffix; the assertion is the triangle count the caller returns.
 */
function iconMeshes(root: THREE.Object3D, node: string): THREE.Mesh[] {
  const host = root.getObjectByName(node);
  const direct = host === undefined ? [] : renderMeshes(host);
  if (direct.length > 0) return direct;
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh !== true || m.name.startsWith('col_')) return;
    const tail = m.name.startsWith(`${node}_`) ? m.name.slice(node.length + 1) : '';
    if (tail !== '' && /^\d+$/.test(tail)) out.push(m);
  });
  return out;
}

function triangles(geom: THREE.BufferGeometry): number {
  const idx = geom.getIndex();
  const pos = geom.getAttribute('position');
  const n = idx !== null ? idx.count : (pos === undefined ? 0 : pos.count);
  return Math.floor(n / 3);
}

/**
 * How much of the 64x64 cell the draw actually covered.
 *
 * Read off the back buffer rather than inferred from the PNG's length, because
 * a compressed blank square and a compressed silhouette are both "some bytes"
 * and only one of them is an icon. Clear alpha is 0, so anything above the
 * antialiasing fringe is geometry.
 */
function drawnPixels(renderer: THREE.WebGLRenderer): number {
  const gl = renderer.getContext();
  const buf = new Uint8Array(PX * PX * 4);
  gl.readPixels(0, 0, PX, PX, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let n = 0;
  for (let i = 3; i < buf.length; i += 4) if (buf[i] > 24) n++;
  return n;
}
