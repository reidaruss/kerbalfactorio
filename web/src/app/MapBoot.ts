// The map's construction, lifted out of Boot.
//
// Not tidiness: `Boot.ts` is shared with three live lanes and sits within a
// couple of lines of the 400-line cap, so a feature that pushed it over would
// have been everybody's build break for the sake of one object literal. The
// ports themselves are the interesting part and they belong beside the mode
// they serve.
//
// DW-36 added two ports and both are narrowed the same way the first two were.
// `MapGameplayPorts` is a NAMED SLICE of Gameplay rather than Gameplay itself:
// the map wants a modal registry, somewhere to put a sentence, the ore in the
// ground, the item names for it and the mode's own answer about what may be
// seen. It wants nothing else about the on-foot game, and saying so in a type
// is what stops it from growing a dependency on all of it.
import { MapMode } from './MapMode.js';
import { MapWorld } from './MapWorld.js';
import { Discovery } from '../world/Discovery.js';
import { MapTerrain } from '../world/MapTerrain.js';
import type { SurfaceOracle } from '../world/SurfaceOracle.js';
import type { OrePatchSource } from './MapWorld.js';
import { MAP_ALLOWED } from '../player/Bindings.js';
import { vesselAbi } from '../sim/wasm/vesselabi.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { FlightMode } from './FlightMode.js';
import type { Input } from '../player/Input.js';
import type { PlanetBody } from '../world/PlanetBody.js';
import type { ModalStack } from '../ui/ModalStack.js';
import type { OfVesselModule } from '../sim/wasm/vesselabi.js';

/** The slice of the walker the map needs: where the FEET are and how high above
 *  the local surface. Named structurally rather than importing `Controller`,
 *  for the same reason `MapGameplayPorts` exists: the map wants a position, not
 *  a character controller. The feet and not the eye, because 1.7 m of eye height
 *  is `discovery.h`'s own tunable and belongs in one place. */
export interface MapPlayerPort {
  readonly body: { readonly feet: { x: number; y: number; z: number } };
  readonly altM: number;
}

/** Re-exported so Boot needs ONE import line for the map. Boot is at its cap. */
export type { MapMode };

/** The slice of Gameplay the map needs, named rather than imported whole. */
export interface MapGameplayPorts {
  modals: ModalStack;
  hud: { flash(msg: string): void };
  /** The ore in the ground. `oreField.patches` is the same object the drills
   *  and the dig payout read, so the count on the map is the count in the
   *  world by construction rather than by agreement (DW-25's ONE POOL). */
  oreField: { patches: OrePatchSource };
  /** The item registry's word for an opaque ItemId. World-gen never interprets
   *  the id (WG-11) and this is where the word comes from. */
  game: { itemName(item: number): string };
  /** DW-31's authority, asked BY NAME. `fullMapRevealed` and not `sandbox`:
   *  GameMode.ts's own argument is that a named question gets the right answer
   *  when a branch is written months later, and this is that branch. */
  mode: { fullMapRevealed: boolean };
}

/** Everything `MapMode` is handed. It lives here rather than in MapMode for the
 *  reason at the top of this file: the ports are the interesting part and they
 *  belong beside where they are built, and MapMode is at its line cap. */
export interface MapDeps {
  M: OfVesselModule;
  host: HTMLElement;
  modals: ModalStack;
  flight: FlightMode;
  bodyRadiusM: number;
  atmosphereCeilingM: number;
  setUiCapture(on: boolean): void;
  /** Where a refusal goes when there is no navball to put it on. Supplied by
   *  the app because the on-foot HUD is not this file's to reach into. */
  say(msg: string): void;
  /** Where the player is standing and how high, or null when they are not on
   *  the surface. DW-36's "centered around the player" is this port. */
  player(): { x: number; y: number; z: number; altM: number } | null;
  /** The discovered ground and the ore on it, or null when there is no
   *  gameplay layer (`?gameplay=0`). */
  world: MapWorld | null;
  /** The discovery field itself, so the map can FEED it. See `MapMode.frame`. */
  disc: Discovery | null;
}

export interface MapBootArgs {
  core: OfCoreModule;
  host: HTMLElement;
  g: MapGameplayPorts;
  flight: FlightMode;
  body: PlanetBody;
  /** THE SURFACE AUTHORITY, for its `editsHandle` (WG-33). The map samples the
   *  ground the player is standing on, edits included, or it cannot show them a
   *  hole they dug. Handed the oracle rather than the raw handle because the
   *  handle is bound LATER (VoxelWorld's constructor), so a copy taken here
   *  would be a permanent 0 and the map would silently keep drawing the
   *  untouched world. Read every sample, never cached. */
  oracle: SurfaceOracle;
  input: Input;
  /** The walker. DW-36's "centered around the player" begins here, and their
   *  altitude is what the discovery horizon is computed from. */
  player: MapPlayerPort;
}

export async function bootMap(a: MapBootArgs): Promise<MapMode> {
  const V = vesselAbi(a.core);
  // DISCOVERY IS WORLD STATE and its authority is `/core` (discovery.h). This
  // object is a driver: it decides when to take an observation and caches the
  // one query the map repaints from. bodyId 0 is Forge, 1 is anything else,
  // which is the same convention §1 of the bridge already uses.
  const disc = new Discovery(a.core, a.body.kind === 'moon' ? 1 : 0);
  // THE GROUND (DW-37). It takes the body HANDLE, not the 0/1 bodyId above:
  // the biome and the designed height belong to this seed's body, while the
  // discovery lattice only needs the body's radius. It is handed the discovery
  // driver purely for its generation counter, so a new observation invalidates
  // the cached picture rather than leaving a frame of the old survey mask, and
  // the surface oracle for its EDIT HANDLE, so the ground it samples is the
  // ground the player has been working on (WG-33).
  const terrain = new MapTerrain({ core: a.core, body: a.body.handle, disc,
    oracle: a.oracle });
  const world = new MapWorld({
    disc,
    terrain,
    ore: a.g.oreField.patches,
    bodyRadiusM: a.body.radiusM,
    revealAll: () => a.g.mode.fullMapRevealed,
    itemName: (id) => a.g.game.itemName(id),
  });
  return new MapMode({
    M: V,
    host: a.host,
    modals: a.g.modals,
    flight: a.flight,
    bodyRadiusM: a.body.radiusM,
    // bodyId 0 is Forge; anything else is airless (atmosphere.h §2), and the
    // only two bodies that exist are a planet and a moon. Read from /core so
    // the line the map draws the air at is the air the vessel flies through.
    atmosphereCeilingM: V._of_atmo_space_altitude(a.body.kind === 'moon' ? 1 : 0),
    // MAP_ALLOWED and NOT the global UI_ALLOWED. A map over a live flight has
    // to keep every flight key working, and an inventory screen must not: that
    // difference is exactly what `setUiCapture`'s second argument is for, and
    // it is the mechanism the swallowed launch key should have used.
    setUiCapture: (on) => { a.input.setUiCapture(on, on ? MAP_ALLOWED : []); },
    say: (m) => { a.g.hud.flash(m); },
    player: () => {
      const p = a.player.body.feet;
      return { x: p.x, y: p.y, z: p.z, altM: a.player.altM };
    },
    world,
    disc,
  });
}
