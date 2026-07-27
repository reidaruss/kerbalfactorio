// The map's construction, lifted out of Boot.
//
// Not tidiness: `Boot.ts` is shared with three live lanes and sits within a
// couple of lines of the 400-line cap, so a feature that pushed it over would
// have been everybody's build break for the sake of one object literal. The
// ports themselves are the interesting part and they belong beside the mode
// they serve.
import { MapMode } from './MapMode.js';
import { MAP_ALLOWED } from '../player/Bindings.js';
import { vesselAbi } from '../sim/wasm/vesselabi.js';
import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { FlightMode } from './FlightMode.js';
import type { Input } from '../player/Input.js';
import type { PlanetBody } from '../world/PlanetBody.js';
import type { ModalStack } from '../ui/ModalStack.js';

/** Re-exported so Boot needs ONE import line for the map. Boot is at its cap. */
export type { MapMode };

/** The slice of Gameplay the map needs, named rather than imported whole: the
 *  map wants a modal registry and somewhere to put a sentence, and nothing
 *  else about the on-foot game. */
export interface MapGameplayPorts {
  modals: ModalStack;
  hud: { flash(msg: string): void };
}

export interface MapBootArgs {
  core: OfCoreModule;
  host: HTMLElement;
  g: MapGameplayPorts;
  flight: FlightMode;
  body: PlanetBody;
  input: Input;
}

export async function bootMap(a: MapBootArgs): Promise<MapMode> {
  const V = vesselAbi(a.core);
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
  });
}
