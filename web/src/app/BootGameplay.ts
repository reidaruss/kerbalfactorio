// CE-140. PHASES 6 AND 7: the tools that dig, and the gameplay layer above
// them.
//
// `phaseTools` builds the voxel world, its mesh, the debris and the dig and
// level actions, every one of them gated on there being a character. Its output
// is exactly what `phaseGameplay` then binds to the pack, the assembly bay and
// flight, which is why they are one module and two functions. Lifted verbatim
// out of `Boot.ts`; see `BootStage.ts`.

import { VoxelWorld } from '../world/VoxelWorld.js';
import { VoxelMesh } from '../world/VoxelMesh.js';
import { DigFx } from '../render/DigFx.js';
import { DigAction } from '../player/DigAction.js';
import { LevelAction } from '../player/LevelAction.js';
import { LevelRing } from '../world/LevelRing.js';
import { reseatDiscovery } from '../world/DiscoveryScope.js';
import { captureLeavingWorld } from '../game/WorldScope.js';
import { resumeWorld } from './ResumeBoot.js';
import { bootVab, type VabExits } from './VabBoot.js';
import { bootMap, type MapMode } from './MapBoot.js';
import type { FlightMode } from './FlightMode.js';
import type { Gameplay } from '../game/Gameplay.js';
import type { Vab } from '../game/Vab.js';
import type { BootCtx } from './BootStage.js';

export type ToolsIn = Pick<BootCtx,
  'cfg' | 'core' | 'body' | 'oracle' | 'origin' | 'scenes' | 'player' | 'terrainOf'>;
export type ToolsOut = Pick<BootCtx,
  'voxels' | 'voxelMesh' | 'digFx' | 'dig' | 'levelRing' | 'level'>;

export function phaseTools(s: ToolsIn): ToolsOut {
  const { cfg, core, body, oracle, origin, scenes, player, terrainOf } = s;
  // W5. Created only when there is a character: with no player nobody digs, and
  // an unbound edits handle would arm voxel collision for a flying camera. The
  // handle is bound to the oracle in the VoxelWorld constructor, which is the
  // moment surfaceHeight starts subtracting derivedLoweringAt.
  const voxels = player === null ? null : new VoxelWorld(core, oracle);
  if (voxels !== null) voxels.aimAgainstShell = cfg.aimShell;
  const voxelMesh = voxels === null ? null
    : new VoxelMesh(core, body.handle, voxels.handle, origin, {
      bodyRadiusM: body.radiusM,
      maxReliefM: body.maxReliefM,
      surfaceRadiusAt: (dx, dy, dz) => oracle.surfaceRadius(dx, dy, dz),
      editFacesOnly: cfg.voxelSkinEditsOnly,
    });
  if (voxelMesh !== null && cfg.voxelNear) scenes.near.add(voxelMesh.mesh);
  // Debris. Reads gravity from the body, never from a constant (DW-18), and
  // costs one draw call that is skipped while nothing is in the air.
  const digFx = voxels === null ? null : new DigFx(origin, (r) => body.gravityAccel(r));
  if (digFx !== null) scenes.near.add(digFx.points);
  const dig = voxels === null || voxelMesh === null ? null
    : new DigAction(voxels, voxelMesh, terrainOf, digFx);
  // WG-22 terraforming. The ring is a ground decal, so it goes in the NEAR
  // scene beside the voxel mesh; `?levelring=0` isolates it (standing rule 7).
  const levelRing = voxels === null || !cfg.levelRing ? null
    : new LevelRing(oracle, origin);
  if (levelRing !== null) scenes.near.add(levelRing.mesh);
  const level = voxels === null || voxelMesh === null ? null
    : new LevelAction(voxels, voxelMesh, terrainOf, oracle, levelRing);
  return { voxels, voxelMesh, digFx, dig, levelRing, level };
}

export type GameplayIn = Pick<BootCtx,
  'cfg' | 'hud' | 'host' | 'core' | 'body' | 'oracle' | 'origin' | 'scenes'
  | 'rig' | 'frame' | 'canvas' | 'input' | 'player' | 'avatar' | 'router'
  | 'session' | 'proxy' | 'sky' | 'voxels' | 'voxelMesh' | 'dig' | 'level'
  | 'discReseat' | 'worldCapture'>;
export type GameplayOut = Pick<BootCtx, 'gameplay' | 'vab' | 'flight' | 'map'>;

export async function phaseGameplay(s: GameplayIn): Promise<GameplayOut> {
  const {
    cfg, hud, host, core, body, oracle, origin, scenes, rig, frame, canvas,
    input, player, avatar, router, session, proxy, sky, voxels, voxelMesh,
    dig, level, discReseat, worldCapture,
  } = s;
  // W5 gameplay. Also player-gated: the pack, the clearing and the swing all
  // hang off a character, and a free camera has no hands. It is built LAST
  // because it scatters its nodes around wherever the player already stands.
  let gameplay: Gameplay | null = null;
  if (player !== null && cfg.gameplay) {
    hud.banner('growing the harvest clearing ...');
    // Imported dynamically so `?gameplay=0` isolates the slice for real
    // (standing rule 7): with a static import the whole module graph is loaded,
    // parsed and bundled whether or not a single node is placed, so a probe
    // that means to measure the renderer alone cannot actually get there.
    const { Gameplay } = await import('../game/Gameplay.js');
    const { digOrePort } = await import('../game/DigOre.js');
    // PS-49. The save layer is reached from inside the dynamic block for
    // standing rule 7's reason, exactly as `Gameplay` is: a static import here
    // would pull the whole persistence graph into the main chunk and
    // `?gameplay=0` would stop isolating anything.
    const { snapshotOf } = await import('../game/PersistSlot.js');
    gameplay = await Gameplay.create({
      core, origin, player, avatar, input, host, scene: scenes.near,
      bodyHandle: body.handle, bodyId: body.bodyId, seed: cfg.seedLo,
      // WG-69: the rock lattice's datum and its water gate, both READ from the
      // objects that own them (DW-18: transcribing a body constant is how the
      // walker once fell at the wrong gravity). `?rocks=0` is the control.
      bodyRadiusM: body.radiusM, water: oracle.water,
      rocks: { enabled: cfg.rocks, density: cfg.rockDensity },
      // WG-116: the trees of the world, on the same lattice contract as the
      // rocks and reading the same body datum. `?trees=0` is the control.
      trees: { radiusM: cfg.treeRadiusM, density: cfg.treeDensity },
      nodeArt: { lod: cfg.nodeLod, cull: cfg.nodeCull },
      // DW-31. The mode is decided ONCE, here, and everything downstream asks
      // the ModeRules object rather than re-reading the flag.
      mode: cfg.sandbox ? 'sandbox' : 'survival',
      // DW-17: the voxel handles live here, so the save slot is handed them
      // rather than gameplay reaching for a global.
      // CE-20. A GETTER, so gameplay's port follows a rebuild. It held the
      // TerrainStream object, and a rebuilt scope would have left every dig and
      // every level press posting to a terminated worker with no error anywhere.
      ports: { voxels, voxelMesh, get terrain() { return session.terrain; } },
    });
    // PS-49. THE READING OF THE WORLD BEING LEFT, through the SAME function
    // that writes a save, so the fifteen body-scoped fields are enumerated
    // once and a field added later is frozen without anybody remembering to.
    // Assigned here rather than beside `discReseat` because it is the only
    // place `gameplay` is non-null by construction; a world with no gameplay
    // leaves the holder null, which `captureLeavingWorld` reads as "nothing to
    // freeze" rather than as an empty world.
    {
      const g = gameplay;
      worldCapture.fn = () => { captureLeavingWorld(() => snapshotOf(g)); };
    }
    // DIGGING INTO AN ORE BODY PAYS. The dig action lives in Services and the
    // ore pool lives in the gameplay layer, so this line is the seam between
    // them; without it a pickaxe swing at an outcrop grants ore and a dig strike
    // into the same ground grants nothing.
    // WG-23. The levelling tool announces every press through the same HUD line
    // every other action uses. A tool whose whole honest output is a number has
    // to have somewhere to say it, and a press that says nothing on ground a
    // 1 m lattice cannot flatten further is indistinguishable from a dead key.
    if (level !== null) level.flash = (t, secs) => gameplay?.hud.flash(t, secs);
    if (dig !== null) {
      const g = gameplay;
      dig.ore = digOrePort(g.oreField.patches, g.game, (n, name, at) => {
        const r = Math.hypot(at.x, at.y, at.z) || 1;
        g.fx.ingot(n, at, { x: at.x / r, y: at.y / r, z: at.z / r }, name);
        g.panel.invalidate();
      });
    }
  }

  // W8 THE ASSEMBLY BAY, wired in VabBoot.ts (Boot is at its line cap). Built
  // after gameplay because it spends the same pack, and before flight because
  // flight flies its design handle, which is why its two exits are late-bound.
  const vabExits: VabExits = { rollOut: null, recover: null };
  let vab: Vab | null = null;
  if (gameplay !== null && cfg.vab) {
    vab = await bootVab({
      core, bodyHandle: body.handle, bodyId: body.bodyId, host, canvas,
      scene: scenes.vab,
      camera: rig.vabCam, input, gameplay,
      setRenderMode: (on) => { frame.vabActive = on; },
    }, vabExits);
  }

  // W9 FLIGHT. Needs the bay (it flies the bay's design handle) and gameplay
  // (it hides the on-foot HUD while strapped in), so it is built last. Dynamic
  // import for standing rule 7: `?flight=0` has to isolate it for real.
  let flight: FlightMode | null = null;
  let map: MapMode | null = null;
  if (gameplay !== null && vab !== null && player !== null && cfg.flight) {
    hud.banner('loading the rocket meshes for flight ...');
    const { FlightMode: Mode } = await import('./FlightMode.js');
    const g = gameplay;
    const theVab = vab;
    flight = new Mode({
      M: core, bodyHandle: body.handle, bodyRadiusM: body.radiusM, oracle, origin,
      router, input, player, scene: scenes.near, host,
      designHandle: () => theVab.design.handle,
      // GP-57. THE PAD, as a thunk. A value would have worked here, but the
      // thunk keeps the pad's LIFETIME out of flight's hands, so a world
      // reloaded from a save hands back the RESTORED pads and not a stale list.
      pads: () => g.pads,
      // PH-383. ONE YES/NO QUESTION, not the research tree. R99's auto-approach
      // is gated on `StationBoarded`, which `StationReveal.ts` grants from the
      // hand-flown station mission itself, so Reid's task-39 ordering ("the
      // autopilot moves BEHIND the station visit") holds by construction.
      milestone: (id) => g.progress.research.earned(id),
      setWorldUi: (on) => {
        g.hud.setVisible(on);
        g.hotbarBar.setVisible(on);
        g.goalPanel.setVisible(on && g.goals.visible);
      },
    });
    await flight.load();
    // Both entrances now run the SAME two calls in the same order, so the
    // button and the key cannot drift into meaning different things.
    const theFlight = flight;
    vabExits.rollOut = () => theFlight.fromBay(() => theVab.leave());
    // GP-121 / R11. The SAME method the Delete key reaches through Systems.ts,
    // so the button and the key cannot drift into meaning different things.
    vabExits.recover = () => theFlight.recover();
    // GP-53. The checklist learns about the rocket. It is a PORT rather than a
    // field on Gameplay because Gameplay is at its line cap and because the
    // checklist is the only thing that wants to know.
    g.goals.rocket = {
      parts: () => theVab.design.parts.length,
      rollouts: () => theFlight.rollouts,
      boardings: () => theFlight.boardings,
    };
    // THE MAP, on M. Ports in MapBoot (Boot is at cap); DW-36 adds the walker.
    map = await bootMap({ core, host, g, flight: theFlight, body, input, player, oracle,
      frame, mapCam: rig.mapCam, sky, proxy });
  }
  // PS-46. AND THE SAME CALL ON EVERY REBUILD FROM HERE ON (the station's own
  // shape, in `phaseStation`). OUTSIDE the flight block on purpose: `?flight=0`
  // has no map and therefore no `Discovery` driver, but it still has a field in
  // /core and still autosaves it, so the field must follow the body there too.
  // `map` is read through the closure rather than captured, so this is the live
  // driver or null, whichever it is at the moment a rebuild happens.
  discReseat.fn = (rebuiltBodyId) => {
    reseatDiscovery(core, rebuiltBodyId, map?.discovery ?? null);
  };
  // PH-64 to PH-69. THE WORLD COMES BACK AS IT WAS LEFT (ResumeBoot argues the
  // order). After the flight block, so a vessel has somewhere to be promoted
  // into; outside it, because the body anchor is owed to `?flight=0` too.
  resumeWorld({ flight, vab, router, origin, core, bodyId: body.bodyId });
  return { gameplay, vab, flight, map };
}
