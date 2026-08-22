// CE-140. PHASES 3 AND 4: the eye and the world's shared services.
//
// `phaseObserver` builds the floating origin, whichever ViewSource is driving
// this run, the avatar, the input and the two world-anchored probes, and it is
// where the sun phase is solved for the scenario site. `phaseWorldPrep` starts
// the worker WASM instance, picks the regime band and loads the prop atlases.
//
// The two are one module because they are one seam: everything here is
// process-scoped, exists before any body scope, and is needed by every scope
// that follows. Lifted verbatim out of `Boot.ts`; see `BootStage.ts`.

import * as THREE from 'three';
import { SkyPass } from '../render/SkyPass.js';
import { createViewModelPlaceholder } from '../render/debug/Placeholders.js';
import { PropLibrary } from '../render/instancing/PropLibrary.js';
import { CANOPY_LOD3_M } from '../world/ScatterTuning.js';
import { JitterProbe } from '../render/debug/JitterProbe.js';
import { ZFightProbe } from '../render/debug/ZFightProbe.js';
import { BIOME_ATLAS, SHARED_ATLAS, CANOPY_ATLAS, setForestDetail, setBeachCanopy }
  from '../assets/Registry.js';
import { refreshCanopyMu } from '../render/geometry/ChunkCanopy.js';
import { setSpires } from '../game/NodeArt.js';
import { registerPool } from '../game/InstancePools.js';
import { FloatingOrigin } from '../world/FloatingOrigin.js';
import { Regime } from '../world/Regime.js';
import { ObserverCamera } from '../player/ObserverCamera.js';
import { ViewRouter } from '../player/ViewRouter.js';
import { Controller } from '../player/Controller.js';
import { Avatar } from '../player/Avatar.js';
import { Input } from '../player/Input.js';
import type { ViewSource } from '../player/ViewSource.js';
import { probeWorkerOracle } from './WorkerProbe.js';
import type { BootCtx } from './BootStage.js';

/** Camera basis from the orientation quaternion: -Z is forward, +X is right. */
function forwardOf(v: ViewSource): THREE.Vector3 {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(v.orientation).normalize();
}
function rightOf(v: ViewSource): THREE.Vector3 {
  return new THREE.Vector3(1, 0, 0).applyQuaternion(v.orientation).normalize();
}

export type ObserverIn = Pick<BootCtx,
  'cfg' | 'hud' | 'events' | 'oracle' | 'scenes' | 'canvas' | 'sky'>;
export type ObserverOut = Pick<BootCtx,
  'origin' | 'player' | 'router' | 'observer' | 'avatar' | 'input' | 'jitter' | 'zfight'>;

export async function phaseObserver(s: ObserverIn): Promise<ObserverOut> {
  const { cfg, hud, events, oracle, scenes, canvas, sky } = s;
  const origin = new FloatingOrigin(events, cfg.rebaseM);
  // Two ViewSource implementations, one contract. The capsule and the free
  // camera are BOTH the streaming observer when active, so what is drawn and
  // what is resident can never drift apart (the W1 rule, carried forward).
  const player = cfg.mode === 'walk'
    ? new Controller(oracle, cfg.view, cfg.walkSpeedMps, cfg.interpolate) : null;
  // W9. The eye goes through a ROUTER so that boarding a rocket is a swap of the
  // one object the loop already talks to, rather than a branch inside the loop.
  // Everything downstream (the origin, the terrain request, the regime band, the
  // sky, the shadow fit) then follows the vessel with no further wiring, which
  // is what makes the surface-to-orbit handoff need no flight-specific code.
  const router = new ViewRouter(player ?? new ObserverCamera(oracle));
  const observer: ViewSource = router;
  observer.teleport(cfg.scenario.lat, cfg.scenario.lon, cfg.scenario.alt);
  if (cfg.scenario.pitchDeg !== undefined) {
    observer.look(0, THREE.MathUtils.degToRad(cfg.scenario.pitchDeg - observer.state().pitchDeg));
  }
  origin.step(observer.position);
  sky.setSunT(cfg.sunTExplicit ?? SkyPass.solveSunT(observer.up, cfg.scenario.sunDot));
  // RN-844. Record WHAT the solve was for and WHERE, so a probe that teleports
  // can see that its `?sundot=` no longer applies. `?t=` is an absolute phase
  // and was never solved against a site, so it records nothing.
  sky.solvedFor = cfg.sunTExplicit !== null ? null : {
    wantDot: cfg.scenario.sunDot,
    latDeg: cfg.scenario.lat,
    lonDeg: cfg.scenario.lon,
  };

  const avatar = player === null ? null : new Avatar(cfg.anim);
  if (avatar !== null) {
    hud.banner('loading the character rig and the first-person arms ...');
    await avatar.load();
    scenes.near.add(avatar.group);
    scenes.viewModel.add(avatar.viewModel);
    // RN-1876. The probe surface for `Avatar.debugHidden`, published the way
    // `Surfaces.ts` publishes its own (`__ofSurfaces`) and for the same stated
    // reason: Debug.ts is at its line cap and this is one property removable in
    // one line. Reading it back is deliberate, so a probe can assert the
    // control frame actually took rather than assume it did.
    (window as unknown as { __ofViewModel: unknown }).__ofViewModel = {
      hide: (on: boolean): boolean => { avatar.debugHidden = on; return avatar.debugHidden; },
      hidden: (): boolean => avatar.debugHidden,
    };
  } else {
    scenes.viewModel.add(createViewModelPlaceholder());
  }

  const input = new Input();
  input.attach(canvas);
  const jitter = new JitterProbe();
  const zfight = cfg.scenarioName === 'zfight'
    ? new ZFightProbe(scenes, origin, observer.position,
      forwardOf(observer), rightOf(observer), observer.up, cfg.zSepRatio)
    : null;
  // Both probes are world-anchored, so both subscribe to the ONE broadcast.
  if (zfight !== null) events.on('OriginRebased', () => zfight.place(origin));
  return { origin, player, router, observer, avatar, input, jitter, zfight };
}

export type WorldPrepIn = Pick<BootCtx,
  'cfg' | 'hud' | 'core' | 'body' | 'renderer' | 'observer' | 'scenes'>;
export type WorldPrepOut = Pick<BootCtx, 'wp' | 'regime' | 'props'>;

export async function phaseWorldPrep(s: WorldPrepIn): Promise<WorldPrepOut> {
  const { cfg, hud, core, body, renderer, observer, scenes } = s;
  hud.banner('starting the worker WASM instance ...');
  const wp = await probeWorkerOracle(core, body, cfg);

  const regime = new Regime(cfg.nearCutoff > 0 ? cfg.nearCutoff : renderer.depth.nearDepthCutoff());
  regime.update(observer.altM);

  hud.banner('loading the biome prop atlases ...');
  // Every atlas, not just the biome under the observer: a walk crosses biome
  // boundaries continuously and a mid-walk fetch would hitch. Ten files, 392 kB.
  // `detail_cards.glb` is the ground-detail layer that sits UNDER the biome
  // props. It shipped, validated, and was declared in Registry.ts and never
  // passed to a loader, so it had never been drawn (blocker A-2).
  // The canopy atlas rides with the biome atlases and NOT with SHARED_ATLAS,
  // because `PropLibrary.load` reads SHARED_ATLAS to decide which batches get
  // the `:detail` suffix and that suffix sets `castShadow = false`. See
  // `Registry.CANOPY_ATLAS`. It is dropped entirely at `?canopy=0`, so the
  // control does not merely place no trees, it does not load them either.
  // WG-91 / WG-94, both BEFORE anything reads the tables they write: `Scatter`
  // samples a chunk's props once at build time and `NodeField.load` derives its
  // download set from `ART`, so a table written after either has run would be a
  // control that changes nothing and reports success. See `Registry
  // .setForestDetail` and `NodeArt.setSpires` for what each flag restores.
  setForestDetail(cfg.forestDetail);
  // WG-286/WG-287, and the refresh is the load-bearing half: `BIOME_CANOPY_MU` is
  // derived from these tables at IMPORT time, so a boot flag that rewrites a
  // row without re-deriving it would move the instance scatter and leave the
  // terrain material's canopy index reading the pre-flag table.
  setBeachCanopy(cfg.beachCanopy);
  refreshCanopyMu();
  setSpires(cfg.spires);
  const canopy = cfg.canopyRadiusM > 0 ? [...CANOPY_ATLAS] : [];
  const atlases = cfg.props
    ? (cfg.detailCards ? [...BIOME_ATLAS, ...canopy, ...SHARED_ATLAS]
      : [...BIOME_ATLAS, ...canopy])
    : [];
  // RN-2203's last argument: the range at which a canopy prop is drawing its
  // impostor rung, so `PropLibrary` can install the far-shadow skip without
  // importing a world-layer constant. It is the same `CANOPY_LOD3_M` the
  // scatter selects with, taken from the one place it is defined.
  const props = await PropLibrary.load(atlases, scenes.near, cfg.propGrow,
    cfg.propCull, cfg.propLod2, CANOPY_LOD3_M, cfg.propCullBiome);
  // DW-28: the foliage pools report through the SAME registry the machine pools
  // do, so a refusal reaches the HUD as `POOL FULL: n NOT DRAWN` rather than
  // being counted into a field nothing prints.
  registerPool(props);
  return { wp, regime, props };
}
