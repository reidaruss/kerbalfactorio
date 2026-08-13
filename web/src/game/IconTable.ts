// GP-133. THE ICON TABLE, split out of ItemIcons.ts when the five buildings
// (GP-130) pushed that file past the 400-line cap.
//
// The seam was already there and is the one worth having: this file is DATA and
// nothing else, and `ItemIcons.ts` is the BAKER that turns it into pictures. The
// table is edited every time an item ships; the baker has not changed since it
// was written. Keeping them together meant every content edit re-read a WebGL
// renderer, a camera fit and a pixel-coverage check to reach a one-line row.
//
// H-7: THE TABLE IS THE WHOLE SYSTEM, AND IT CARRIES /core's ItemId. A row is
// `{id, name, url, nodes}` rather than two half-tables keyed by node name, so
// adding an item is one line and a probe can assert BY ID instead of by a
// display string. A row with no nodes is a DELIBERATE text fallback carrying the
// reason, because "there is no mesh for a science pack" and "somebody forgot"
// must not look the same in the report.

import { ASSETS } from '../assets/Registry.js';

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

const ATLAS = 'assets/items/items_atlas.glb';
const MACH = 'assets/machines/';
const STRU = 'assets/structures/';

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
  // FS-56's assembler, picked up here because the build menu is the first
  // screen that draws a machine as a picture and it was the one tile still
  // showing its own name. `PART_INFO.assembler` already declares
  // `iconName: 'Assembler'`, so the row was expected and simply absent; the
  // asset, the node and the /core display name all shipped with the machine.
  R(0x0013, 'Assembler', `${MACH}assembler.glb`, 'Assembler_LOD0'),
  // FS-68's storage box, found the same way the assembler was: the build
  // menu's icon assertion is DERIVED from the live row list, so a buildable
  // that ships without a picture fails it by name rather than going
  // unmentioned. That is the second time in one night it has earned that.
  R(0x0014, 'Box', `${MACH}box.glb`, 'Box_LOD0'),
  // H-7. Craftable since ABI 9 and pictureless until now. All three place the
  // EXISTING machine TypeIds (0x12 / 0x15 / 0x16), so the art already ships and
  // this is three table rows rather than three assets.
  R(0x003d, 'Electric smelter', `${MACH}smelter.glb`, 'Smelter_LOD0'),
  R(0x003e, 'Burner generator', `${MACH}generator.glb`,
    'Generator_LOD0', 'Generator_Flywheel'),
  R(0x003f, 'Power pole', `${MACH}power_pole.glb`, 'PowerPole_LOD0'),
  // GP-130. THE FIVE BUILDINGS, and this is H-7's argument word for word one
  // family later: all five place an EXISTING TypeId whose art already ships, so
  // giving them pictures is five table rows and not five assets.
  //
  // They were pictureless because nothing had ever asked for one. A structural
  // part never enters the pack (gameplay.h S.6: it is paid for and placed), so
  // the panel that draws item icons could not reach them, and the hotbar's
  // `PART_INFO` carries `iconName: ''` for exactly that reason. The BUILD MENU
  // (GP-111) is the first surface that shows a building as a picture, and it
  // opened as a wall of words, which undercuts the whole point of replacing the
  // craft-then-scroll loop with something readable at a glance.
  //
  // THE NAMES ARE /core's OWN (`registerItem(mk(Foundation, "Foundation", ...))`
  // and `"Launch pad"`), and the ids are the identity that actually lasts: the
  // menu looks these up with `forId`, so a display name that drifted would cost
  // a pack row and never a build tile.
  R(0x0040, 'Foundation', `${STRU}foundation.glb`, 'Foundation_LOD0'),
  R(0x0041, 'Floor', `${STRU}floor.glb`, 'Floor_LOD0'),
  R(0x0042, 'Wall', `${STRU}wall.glb`, 'Wall_LOD0'),
  R(0x0043, 'Door', `${STRU}door.glb`, 'Door_LOD0'),
  // The pad takes the DECK ALONE and not its clamps. `LaunchClamp_LOD0` is four
  // separate arms generated at runtime from one shipped socket (GP-57), so a
  // row naming it would bake the single authored arm sitting off to one side of
  // a 24 m deck, which reads as a crane rather than as a launch pad.
  R(0x0044, 'Launch pad', 'assets/rocket/launch_pad.glb', 'LaunchPad_LOD0'),
  // D-019's research station, and its picture is the PLACEHOLDER MESH's, said
  // here as plainly as it is said in `ResearchStations.ts`. /core pins
  // `types::ResearchStation = 0x45` and the art lane owes
  // `structures/research_station.glb` against it; until that lands, the tile
  // shows the assembler, which is what the world shows too. A tile drawn from a
  // DIFFERENT mesh than the world would be worse than a placeholder, because
  // then the picture would be a lie rather than a stand-in.
  R(0x0045, 'Research station', `${MACH}assembler.glb`, 'Assembler_LOD0'),
  // GP-533's scanning antenna, the station's row above verbatim: the
  // PLACEHOLDER MESH is said here plainly, matching `Antennas.ts`. /core pins
  // `types::ScanningAntenna = 0x46` and the art lane owes
  // `structures/scanning_antenna.glb` against it; until that lands, the tile
  // shows the power pole (the tall, thin mast in the shipped set), which is
  // what the world shows too, so the tile is a stand-in rather than a lie.
  R(0x0046, 'Scanning antenna', `${MACH}power_pole.glb`, 'PowerPole_LOD0'),
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
