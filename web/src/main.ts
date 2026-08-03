// COMPOSITION ROOT ONLY. Constructs, wires, starts. Zero game logic.

import './ui/styles/app.css';
import { parseConfig } from './app/Config.js';
import { boot } from './app/Boot.js';
import { Loop } from './app/Loop.js';
import { registerSystems } from './app/Systems.js';
import { installDebugApi } from './app/Debug.js';
import { vabApi } from './app/DebugVab.js';
import { flightApi } from './app/DebugFlight.js';
import { mapApi } from './app/DebugMap.js';
import { scatterApi } from './app/DebugScatter.js';
import { armourApi } from './app/DebugArmour.js';
import { postApi } from './app/DebugPost.js';
import { lifecycleApi } from './app/DebugLifecycle.js';
import { installPauseMenu } from './app/MenuBoot.js';
import { dumpChunks } from './world/TerrainDebug.js';
import { Hud } from './ui/Hud.js';
import { hudLines } from './ui/HudLines.js';
import { instancePools } from './game/InstancePools.js';

const host = document.getElementById('app');
if (host === null) throw new Error('#app is missing from index.html');

const cfg = parseConfig(location.search);
const hud = new Hud(host);

let resolveReady: () => void = () => {};
const ready = new Promise<void>((r) => { resolveReady = r; });

boot(cfg, host, hud).then(({ services }) => {
  const loop = new Loop(services);
  registerSystems(services, loop);
  const api = installDebugApi(
    services, loop, ready,
    () => services.terrain.report(),
    (n, nearOnly) => dumpChunks(services.terrain.residentViews.values(), n, nearOnly,
      services.terrain.nowSecs, services.terrain.geometryPool),
  );

  // `__of.vab` is assigned onto the SAME object installDebugApi put on window,
  // rather than spread inside it: Debug.ts is at the 400-line cap and the bay's
  // whole driven surface is one method. See app/DebugVab.ts.
  // GP-100. The game menu is CONSTRUCTED here rather than in Gameplay, because
  // its testing controls reach the flight session and Gameplay cannot see one
  // (Systems.ts: flight owns its own eye). See app/MenuBoot.ts.
  Object.assign(api, vabApi(services), flightApi(services), mapApi(services),
    scatterApi(services, loop), armourApi(services), postApi(services, loop),
    // CE-19 / CE-20. `of.life()` and `of.reboot()`: the world lifecycle's driven
    // surface. See app/DebugLifecycle.ts for why `reboot` is debug-only.
    lifecycleApi(services),
    installPauseMenu(services, loop));

  let hudFrame = 0;
  loop.onDrain.push(() => {
    if (++hudFrame % 10 !== 0) return;
    hud.render(hudLines(
      api.stats(), api.world(), services.renderer.caps.gpu,
      services.boot.oracleUs.surfaceHeight,
      // The instancing pools, straight off the batches. A full pool is
      // INVISIBLE in every other number on this HUD (MachineBatch's header),
      // which is the whole reason it gets a line of its own.
      instancePools(),
    ));
  });

  hud.setVisible(cfg.debug);
  loop.start();
  loop.settle(2).then(resolveReady);

  console.info(
    `[of] W2 terrain  chunk ${services.boot.chunkVerts} verts / ` +
    `${services.boot.chunkBytes | 0} B  index ${services.boot.indexCount} (shared)  ` +
    `pool ${cfg.chunkPoolSize} geometries = ` +
    `${(services.boot.pooledBytes / 1048576).toFixed(1)} MB preallocated  ` +
    `terrain.worker load ${services.boot.terrainWorkerLoadMs.toFixed(0)} ms`,
  );
  console.info(
    `[of] W0 handshake  abi=${services.core._of_abi_version()}  ` +
    `wasm ${services.boot.wasmLoadMs.toFixed(0)} ms  ` +
    `oracle base/surface/biome/solid = ` +
    Object.values(services.boot.oracleUs).map((v) => v.toFixed(2)).join(' / ') + ' us  ' +
    `worker instance agrees=${services.boot.workerAgrees} ` +
    `(mismatches ${services.boot.workerMismatches}, load ${services.boot.workerLoadMs.toFixed(0)} ms)  ` +
    `depth=${services.renderer.depth.mode}  boot ${services.boot.bootMs.toFixed(0)} ms`,
  );
}).catch((err: unknown) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  hud.banner(`BOOT FAILED\n\n${msg}`, true);
  console.error('[of] boot failed', err);
});
