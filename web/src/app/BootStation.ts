// CE-140. PHASE 8: the station, which is last for a reason the original's own
// comment gives: it runs after `resumeWorld` so a restored world adopts its
// SAVED record instead of minting a second station into the same orbit.
// Lifted verbatim out of `Boot.ts`; see `BootStage.ts`.

import * as THREE from 'three';
import {
  learnStationProxies, learnStationSockets, STATION_ASSET,
} from '../game/SpaceStation.js';
import { StationView } from '../render/StationView.js';
import { loadGlb } from '../assets/Loaders.js';
import { volumes } from '../game/GravityVolumes.js';
import { installAndMountStation } from './StationMount.js';
import type { BootCtx } from './BootStage.js';

export type StationIn = Pick<BootCtx,
  'cfg' | 'core' | 'body' | 'origin' | 'scenes' | 'router' | 'player'
  | 'gameplay' | 'carriers' | 'mounts' | 'stationRebuild'>;
export type StationOut = Pick<BootCtx, 'station'>;

export async function phaseStation(s: StationIn): Promise<StationOut> {
  const {
    cfg, core, body, origin, scenes, router, player, gameplay, carriers,
    mounts, stationRebuild,
  } = s;
  // RN-821. Outside the conditional block below because `Services` needs them
  // and the block is optional: `?station=0`, no gameplay and no character each
  // leave the station out of the world, and null is the honest view for that.
  let stationRoot: THREE.Object3D | null = null;
  let station: StationView | null = null;

  // PH-94. THE STATION, after `resumeWorld` and not before, because the record
  // is the authority: a restored world must adopt its SAVED station and only a
  // genuinely new one may mint a fresh record. Installing first would mint a
  // second station on every load, and the two would sit in the same orbit.
  //
  // The interior is derived from the record on every boot and is never itself
  // saved, so there is exactly one thing on disk (nine numbers and a clock) and
  // the box list cannot drift away from the orbit it hangs on.
  if (gameplay !== null && player !== null && cfg.station) {
    // PH-105. THE INTERIOR IS THE SHIPPED MESH'S, read here because `Boot` is
    // where every other asset in this game is read and because the proxies must
    // be learned BEFORE `installStation`, which now refuses without them rather
    // than falling back to a hand-authored shape (see SpaceStation.ts).
    // `loadGlb` is cached and the failure is caught: a station whose asset did
    // not arrive must not take the whole boot down with it.
    //
    // RN-821: the SAME parsed scene also builds the render view, because the
    // boxes a player stands on and the hull they see have to be two readings of
    // one file. StationView.ts carries the rest of the argument.
    await loadGlb(STATION_ASSET)
      .then((g) => {
        learnStationProxies(g.scene);
        learnStationSockets(g.scene);
        stationRoot = g.scene;
      })
      .catch(() => { learnStationProxies(null); learnStationSockets(null); });
    const u = router.up;
    // RN-821. THE MESH IS BUILT FIRST AND ONLY ONCE, because it is the one part
    // of this block that is NOT idempotent: `scenes.near.add` on a rebuild would
    // put a second hull in the scene. The install below poses it. Building it
    // before the install report exists reverses the old order and is safe:
    // `build(null)` is the no-asset case the `.catch` above already produces,
    // and an unposed view draws nothing because `place` is what gives it a pose.
    station = new StationView(origin);
    station.build(stationRoot);
    scenes.near.add(station.group);
    // CE-47. THE ONE INSTALL PATH, called here exactly as the rebuild calls it:
    // same function, same arguments, only the tick differs (0 here, the live
    // tick there). The lines that used to be inline are in
    // `StationMount.installAndMountStation`, because a copy of them in a reboot
    // handler would be a second authority for where the station is.
    const stationDeps = {
      core, bodies: gameplay.structures.bodies, volumes, carriers, mounts,
      view: station, up: [u.x, u.y, u.z] as [number, number, number],
      bodyRadiusM: body.radiusM, muM3S2: body.muM3S2, bodyId: body.bodyId,
      gravityAccel: (rM: number) => body.gravityAccel(rM),
    };
    const st = installAndMountStation(stationDeps, 0);
    if (st !== null) {
      player.body.gravity = volumes;
      // CE-47. R17. AND THE SAME CALL, ON EVERY REBUILD FROM HERE ON. See the
      // holder's declaration above for why this is a late assignment rather than
      // a line inside `buildBodyScope`.
      stationRebuild.fn = (rebuiltBodyId, tick) => {
        if (rebuiltBodyId !== body.bodyId) return;
        installAndMountStation(stationDeps, tick);
      };
    }
  }
  return { station };
}
