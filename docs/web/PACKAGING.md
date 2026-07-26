# Packaging: the Steam desktop shell, and what scale actually costs

> **Owner:** build-tooling-controller · **Status:** de-risking spike, complete 2026-07-26
> **Answers:** [DECISIONS.md](DECISIONS.md) **DW-27** (ship on Steam, desktop, Electron shell, consoles out of scope)
> **Read alongside:** [STATUS.md](STATUS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DECISIONS.md](DECISIONS.md) DW-4, DW-10, DW-11, DW-17, DW-20
> **Machine:** RTX 4060 Ti, Windows 11, 1600x900, Electron 40.10.6, Chrome (same ANGLE D3D11 path on both)
> All numbers below were produced by the committed harness in `electron/` and can be re-run.

This is a **spike**, not a packaging pipeline. It exists to find out early and cheaply whether
anything about DW-27 bites, while the client is ~123 files rather than 500. It deliberately does
not build a Steam depot, an installer, code signing, or an update channel.

---

## 0. The headline, in four lines

1. **Electron is fine.** Cold start, frame time, draw calls and persistence are indistinguishable
   from Chrome running the same bytes. It costs 330 MB of disk and about 60 MB of JS heap.
2. **The scale wall is not Electron and not the GPU. It is a constant.**
   `MachineBatch`'s `CAPACITY = 256` is the whole ceiling, it is reached at about **150 machines**,
   and it fails **silently**: machines past it exist in the plan, exist in `/core`, tick correctly,
   and are simply never drawn. Draw calls, triangles and frame time all stay flat and green.
3. **DW-11's model held, and beat itself.** The entire factory is one `BatchedMesh` costing **4
   draw calls**, and the entire base is another **4**. 41 to 49 draw calls against a budget of 150,
   with 740 live instances and 765k triangles on screen.
4. **Steamworks initialises today**, on this machine, with no account and no money. Everything
   past `init()` needs a partner App ID that only Reid can obtain.

---

## 1. What was built

```
electron/
  package.json            SEPARATE npm package. Electron is NOT in web/'s dependency tree.
  main.mjs                the shell: privileged of:// scheme over web/dist, boot instrumentation
  shell/origincheck.html  capability probe: IndexedDB, module workers, wasm streaming, WebGL2
  measure/gpuguard.mjs    asserts a real GPU produced every number (see section 8)
  measure/origincheck.mjs file:// versus of://, same binary, same page
  measure/coldstart.mjs   spawn to first RENDERED frame, shell versus browser
  measure/drive.mjs       run any probe inside the shell over CDP
  measure/browser.mjs     the same probe in Chrome, same offscreen real-GPU conditions
  measure/pack.mjs        @electron/packager, then a size breakdown
  measure/rss.mjs         process working set of the whole tree (the Task Manager number)
  measure/steamcheck.mjs  does steamworks.js load and initialise
  probes/scale.js         THE SCALE TEST
  probes/soak.js          memory at rest and after minutes of driven play
  probes/plock.js         pointer lock, isolated
```

**The `web/` dev loop is untouched.** `web/package.json` gained nothing, `web/src` was not edited,
and `npm --prefix web run dev` is exactly as fast as it was. That was a hard requirement: every
other lane depends on it.

```
npm --prefix web run build            # the shell serves web/dist, nothing else
cd electron && npm install
npm start                             # play it in the shell
node measure/origincheck.mjs
node measure/coldstart.mjs --runs=6 --exe=out/OrbitalFoundry-win32-x64/OrbitalFoundry.exe
node measure/pack.mjs
node measure/rss.mjs --settle=120
node measure/drive.mjs   --evalfile=probes/scale.js --url=http://127.0.0.1:5199/?debug=1 --focusable
node measure/browser.mjs --evalfile=probes/scale.js --url=http://127.0.0.1:5199/?debug=1
node measure/steamcheck.mjs
```

---

## 2. The origin question, and why the answer was not the expected one

The expectation going in was that `file://` would break workers and IndexedDB, and that this would
be the headline finding because DW-17 puts the entire save system on IndexedDB. **It did not.**
Both origins were asked the same five questions by the same page in the same binary:

| capability | `file://` | `of://` (privileged custom scheme) |
|---|---|---|
| `isSecureContext` | true | true |
| IndexedDB open, write, read back | **OK**, round-tripped 1234 | **OK**, round-tripped 1234 |
| ES-module `Worker` with a static import | **OK** | **OK** |
| `WebAssembly.instantiateStreaming(fetch(...))` | **OK** | **OK** |
| `localStorage` | OK | OK |
| WebGL2 + `EXT_clip_control` | OK, ANGLE NVIDIA D3D11 | OK, ANGLE NVIDIA D3D11 |
| `crossOriginIsolated` / `SharedArrayBuffer` | false | false (not requested, see section 7) |

Electron treats `file://` as potentially trustworthy and does not give it the opaque-origin
treatment a browser does. So the DW-17 risk did not materialise.

**The shell still uses a custom scheme, for a different and better reason.** Loading the real app
over `file://` fails anyway, measured:

```
OF_MAIN load-start   file:///C:/.../web/dist/index.html?debug=1
OF_MAIN did-finish-load          <- the HTML loads
(no OF_FIRSTFRAME, ever)
```

Vite emits `<script src="/assets/index-*.js">` with an absolute base, which under `file://`
resolves to the filesystem root and silently never loads. Fixing that would mean setting
`base: './'` in `web/vite.config.ts`, i.e. changing the shared dev loop to suit the shell. The
custom scheme costs `web/` **nothing**: it serves the unmodified production build byte for byte.
That is the whole argument. `of://` is `standard: true, secure: true, supportFetchAPI: true,
corsEnabled: true, stream: true`.

**Persistence proven on the real save system, not on a toy.** Both existing persistence probes were
run inside the shell against the packaged bundle on `of://`:

- `probes/persist.js` `valid: true` at `of://app/index.html`. Pack `Wood:66`, four buildings, four
  node depletions saved, world wrecked (buildings 0, cells empty, pack changed to `Wood:71`), slot
  loaded, and every one of them came back exactly.
- `probes/tunnelpersist.js` `valid: true`. 177 voxel cells over 18 strikes, 1,602 voxel bytes, a
  41-byte slot, rock put back (`RRRRRRRR`) and restored (`........`), near mesh 1,064 to 745 to
  1,091 faces.

**DW-17 survives the origin change intact.** That is the single most load-bearing negative result
in this spike.

---

## 3. Cold start

Measured from the wall clock immediately before the process is spawned, to the wall clock at which
the client's own frame counter first reads `frames >= 1`. Not a load event, not a paint heuristic.
6 runs each, real GPU-composited windows parked offscreen.

| | min | **median** | max |
|---|---|---|---|
| **Shell, packaged, FRESH profile** | 6638 | **7047** | 11216 |
| Shell, packaged, warm profile (a returning player) | 3623 | **6596** | 8930 |
| **Chrome, fresh profile, same build over http** | 6049 | **7032** | 8998 |

**Electron costs nothing measurable at startup: 7047 ms versus 7032 ms.** The reputation is not
borne out here, and the reason is visible in the phase split:

| shell phase | min | median | max |
|---|---|---|---|
| process spawn to `app.whenReady` | 275 | **381** | 1967 |
| process spawn to `did-finish-load` | 599 | **865** | 2503 |
| to `window.__of` existing | 4359 | **5095** | 7756 |
| `__of` to `__of.ready` | 1945 | **2409** | 3453 |
| `__of.ready` to first rendered frame | 6 | **7** | 8 |
| client's own `bootMs` | 871 | **1113** | 1398 |

Electron's own contribution is the 381 ms to `app.whenReady` plus 484 ms to finish loading the
document. **Everything after that is our client**, and Chrome shows the same shape.

> **This is a client finding, not a packaging finding, and it is worth someone's time.** Seven
> seconds from double-click to a visible planet is a long time for a Steam game, and the client's
> self-reported `bootMs` of 1.1 s accounts for less than a sixth of it. The gap between
> `did-finish-load` (0.9 s) and `__of` existing (5.1 s) is where it lives. Not this spike's to fix.

---

## 4. Frame time and draw calls, shell versus browser

Same probe file, same probe server (`vite.probe.config.ts` on 5199), same seed, same scene, driven
by the same playwright machinery, both clients GPU-composited offscreen. One probe, two clients.

| machines | Chrome draws / tris / p50 / p99 | Shell draws / tris / p50 / p99 |
|---|---|---|
| 0 (surface baseline) | 41 / 421,682 / 2.0 / 3.2 | 41 / 419,634 / 2.3 / 4.3 |
| 60 | 45 / 475,826 / 2.0 / 3.2 | 45 / 473,778 / 2.1 / 3.6 |
| 120 | 45 / 573,378 / 2.0 / 3.2 | 45 / 571,330 / 2.2 / 3.7 |
| 150 (pool saturates) | 45 / 602,994 / 2.0 / 3.1 | 45 / 600,946 / 2.2 / 3.6 |
| 300 | 45 / 602,994 / 2.0 / 3.4 | 45 / 600,946 / 2.2 / 3.7 |
| 300 + a 140-part base | 49 / 650,034 / 2.5 / 5.1 | 49 / 647,986 / 2.2 / 3.5 |

**Identical.** Draw calls match exactly, triangles match to 0.4% (terrain streaming jitter), and
frame time differs by less than run-to-run noise: on the last row the shell is *faster*. The GPU
string is the same on both: `ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x00002803) Direct3D11
vs_5_0 ps_5_0, D3D11)`, `EXT_clip_control` present, so reversed-Z (DW-3) is on in the shell.

An earlier pair taken under heavier machine load showed the shell 12 to 18% slower on p99. That
difference did not survive a quieter machine, so **treat shell and browser frame time as equal**
and do not quote a penalty.

---

## 5. Installed size

`@electron/packager`, win32 x64, asar on, unpacked application directory (what a Steam depot holds).

| | MB |
|---|---|
| **total installed** | **337.8** |
| our payload (main.mjs + shell/ + web/dist) | **7.5** |
| Chromium and the Electron runtime | 330.2 |

Largest entries: `OrbitalFoundry.exe` 204.1, `locales/` 45.4, `dxcompiler.dll` 24.4,
`LICENSES.chromium.html` 15.3, `icudtl.dat` 10.3, `libGLESv2.dll` 7.6, `resources.pak` 6.1,
`vk_swiftshader.dll` 5.4, `d3dcompiler_47.dll` 4.5, `ffmpeg.dll` 2.9.

Cheap savings available later, none of them urgent: **`locales/` is 45.4 MB for 50-odd languages we
do not ship**, and pruning to `en-US.pak` is a one-line packager option. `vk_swiftshader.dll` (5.4
MB) is the software rasteriser fallback and should probably stay. `LICENSES.chromium.html` must
ship. A realistic floor is around 290 MB. For context, that is normal for this technology and
irrelevant next to the game's eventual asset footprint (art is currently 2.48 MB, and will not stay
there).

---

## 6. Memory

| | shell | Chrome |
|---|---|---|
| JS heap at rest | **143.6 MB** | 89.3 MB |
| JS heap after 3 minutes of driven play | **159.9 MB** | 93.8 MB |
| WASM linear memory, at rest and after | **64 MB, zero growth** | 64 MB, zero growth |
| renderer VRAM estimate | 75.1 MB, unchanged | 75.1 MB, unchanged |

Driven, not idle: the soak probe walks, turns and digs, and reports `ticks 10800 / expected 10800`
so DW-20 is satisfied. The JS heap sawtooths (143.6, 149.5, 161.4, 156.1, 162.3, 150.9, 159.9),
which is a garbage collector working, not a leak. **The shell costs about 60 MB more JS heap than
Chrome** and that is the only real memory difference.

**Process working set, which is what Task Manager and a Steam review will say:**

| packaged app, 4 processes | MB |
|---|---|
| at rest | **604.7** (48.3 / 254.7 / 192.3 / 109.4) |
| after 120 s | **602.2** |

Flat. 600 MB is a lot in absolute terms and completely ordinary for a Chromium-based game.

---

## 7. THE SCALE TEST, and where it breaks

This is the part that mattered most, and it found something.

### How the world is seeded, and why it is legitimate

`probes/scale.js` captures the live `Gameplay` instance by wrapping `Gameplay.prototype.frame` for
a single frame, then drives `Factory.restore(rows)` and `Structures.adopt(...)`. **Those are the
entry points a save-game load takes.** Every machine therefore exists in `/core`'s
`BuildableNetwork`, is chained and wired by the real `FactoryWiring`, and is drawn by the real
`FactoryView`. What is skipped is the aim ghost, the reach test and the item cost: the player's
hands, not the simulation. Placing 500 machines one at a time through `Factory.add` is not merely
slow, it is roughly O(n^3), because every `add` calls `commit()` which rebuilds the whole `/core`
network and re-runs the O(belts^2) chaining. `restore()` is one commit for the batch, which is
exactly why the save system uses it. Seeding 900 rows costs 28.6 ms.

The layout is parallel belt runs capped by smelters, laid out **in metres on a tangent basis taken
from the camera's own aim**, so the field is genuinely in front of the camera. A scale test that
seeds 600 machines behind the player measures frustum culling.

### The curve

| machines | batch instances | draw calls | triangles | p50 | p99 |
|---|---|---|---|---|---|
| 0 | 0 / 256 | 41 | 421,682 | 2.0 | 3.2 |
| 60 | 74 / 256 | 45 | 475,826 | 2.0 | 3.2 |
| 120 | 211 / 256 | 45 | 573,378 | 2.0 | 3.2 |
| **150** | **256 / 256** | 45 | **602,994** | 2.0 | 3.1 |
| 170 | 256 / 256 | 45 | 602,994 | 2.0 | 3.0 |
| 210 | 256 / 256 | 45 | 602,994 | 1.9 | 3.0 |
| 240 | 256 / 256 | 45 | 602,994 | 2.0 | 3.1 |
| 300 | 256 / 256 | 45 | 602,994 | 2.0 | 3.4 |
| 900 (earlier client) | 256 / 256 | 45 | 603,378 | 3.5 | 5.6 |

### What breaks first, and it is not what anyone expected

**`web/src/game/MachineBatch.ts:26`, `const CAPACITY = 256`.**

`FactoryView` constructs `new MachineBatch()` with that default, and machines, belt tiles **and**
DW-9's auto-created inserters all draw from that one pool. Past 256 live slots, `acquire()` returns
`-1`, `FactoryView.sync` does `continue`, and the machine **exists in the plan, exists in `/core`,
ticks, produces, and is never drawn**. The `BatchedMesh` is constructed once with a fixed instance
count and there is no grow path.

Read the table again with that in mind. From 150 machines onward, **triangles are frozen at exactly
602,994 and draw calls at exactly 45, forever.** Frame time does not degrade. Nothing errors.
Nothing logs. The budget indicators read `ok` on every single row. A build with 900 machines and a
build with 150 machines are byte-identical on screen.

**This is the worst possible failure mode: it looks like a pass.** Had this spike only asked "does
900 machines still run at 60 fps", the answer would have been an enthusiastic and completely wrong
yes. The instance-pool column is what makes it visible, which is why `probes/scale.js` reports
`instances / capacity` on every rung and why the DW-20 block also asserts the seeding shortfall.

Where exactly it bites depends on topology, because instances are machines **plus** belt tiles
**plus** inserters: measured at 74 instances for 60 machines, 211 for 120, 256 for 150. **Call it
150 machines in a belt-heavy layout, fewer if there are more inserters.** Reid asked whether 200 to
500 holds. It does not. It stops at about 150, silently, today.

`StructureView` has the same shape with `CAPACITY = 512` (`StructureView.ts:29`), and a door
consumes two slots, so a base is capped at ~512 parts or ~250 doors. That one was not reached:
484 parts drew fine.

**A second, independent ceiling**, found by the shortfall assertion: one adopted build **site**
bounded this layout at **323 machines** (`SITE_REACH_M = 32`). A player walking around founds more
sites, so this is a shape constraint rather than a hard cap, but it means "one contiguous factory"
has a size in metres as well as in count.

### Does the render_cost.h model hold? Yes, and better than it promised

DW-11 said `BatchedMesh` should collapse the factory to "roughly 3 to 6 draw calls against the 72
that `render_cost.h` validated". Measured:

- the entire factory (machines, belt tiles, belt curves, inserters) = **1 batch, +4 draw calls**
  (41 to 45)
- the entire base (foundations, floors, walls, doors) = **1 batch, +4 draw calls** (45 to 49)
- **740 live instances and 764,690 triangles on screen for 49 draw calls**, against budgets of 150
  and 2.7 M

The model held. The instancing architecture is not the problem and should not be touched. The
problem is a fixed-size array.

### What this does NOT prove

Two honest gaps, both of which make the picture rosier than it will eventually be.

1. **The seeded belts are empty.** There are no miners feeding them (a drill needs an ore patch
   under it, DW-25, and there is not enough patch to carry hundreds), so `/core`'s per-tick work is
   understated and the belt flow material is proving itself on nothing. The sim tick was never the
   binding cost here, but it has not been stress-tested either.
2. **The render ceiling hid everything above 150.** Because instances froze, the true cost of
   drawing 500 machines was never measured. The 484-part base run pushed total live instances to
   740 across two batches at 49 draw calls and 2.2 to 3.8 ms, which is strong evidence it would be
   fine, but it is evidence rather than measurement.

**Recommended next step, and it is small:** make `MachineBatch`'s capacity grow (allocate a new
`BatchedMesh` and re-add, or size it from a configured maximum), then re-run
`probes/scale.js` unchanged. It is a rendering-domain change; this spike reports it rather than
making it.

### Would SharedArrayBuffer or WebGPU clear this wall?

**No, and this is worth stating plainly so nobody spends a milestone on it.** DW-27 notes that a
shell removes the constraints that produced DW-4 and DW-10. Neither is relevant to what was
actually found. The wall is a JavaScript constant in a fixed-size instance pool. Shared memory does
not enlarge it; WebGPU does not enlarge it. At 740 instances and 765k triangles we are at 33% of
the draw-call budget and 28% of the triangle budget on a 2.0 ms frame, which is nowhere near the
regime where either technology pays. **Leave DW-4 and DW-10 exactly as they are.**

---

## 8. Why the harness runs offscreen and not headless

**Do not "helpfully" turn on headless mode in `electron/measure/*`. It would quietly invalidate
every number in this document.**

Headless Chromium routinely falls back to **SwiftShader software rasterisation**, and
`web/tools/smoke/run.mjs` even passes `--enable-unsafe-swiftshader` to make that fallback legal,
which is correct for a correctness smoke run and fatally wrong for a performance comparison. A
software-rasterised browser baseline against a hardware-composited shell would make Electron look
good for entirely fictional reasons, and it would look green the whole time. That is the DW-20
failure mode applied to a benchmark.

So every measurement script here runs a **real, GPU-compositing window parked at (-3200, -3200)**
with `skipTaskbar`, and Chrome gets `--window-position=-3200,-3200`. `show: false` is deliberately
not used: an unshown window is not guaranteed to composite, which is the same trap by a different
door. `measure/gpuguard.mjs` then asserts the ANGLE renderer string on **every** client before any
number is allowed out, and throws with an explanation if it sees SwiftShader, llvmpipe, or any
other software renderer.

**Offscreen windows default to `focusable: false`** so a measurement run cannot steal focus from
whoever is using the machine. Probes that need pointer lock must pass `--focusable`, which keeps
the window offscreen and merely lets it take focus. See section 9.

---

## 9. Two false alarms, recorded so they are not rediscovered

**Pointer lock.** The soak run threw `WrongDocumentError: The root document of this element is not
valid for pointer lock` in the shell and not in the browser. Mouse look is the entire control
scheme of a first-person game, so this looked like a showstopper. Isolated with `probes/plock.js`,
changing exactly one thing at a time:

| client | scheme | window | pointer lock |
|---|---|---|---|
| shell | `of://` | offscreen, non-focusable | **fails**, WrongDocumentError |
| shell | `http://` (same bundle) | offscreen, non-focusable | **fails**, WrongDocumentError |
| Chrome | `http://` (same bundle) | offscreen | works |
| shell | `of://` | offscreen, **focusable** | **works** |

It is neither Electron nor the custom scheme. Chromium refuses pointer lock on a non-focusable
window, and the non-focusable window was my harness being polite. Recorded because the
one-variable-at-a-time isolation is what stopped a harness artefact becoming a headline.

**A scale sweep that seeded 5 machines and reported a flat curve.** Mid-spike, another lane
refactored `Factory.snap` from a raw `/core` lattice key onto a metric build **site**
(`MachinePlacement.ts`, key `m<site>:<i>,<j>`). `siteAt` deliberately does not adopt, correctly, so
that "a ghost must not found sites by being looked at": an un-adopted snap founds a fresh
prospective site centred on the query point, and **every point in the world answers `m1:0,0`**. A
sweep asking for 140 machines placed 5, and produced a beautiful flat line at 45 draw calls that
looked exactly like a healthy result. One `factory.adoptSite(snap.addr)` fixed it.

The general lesson, and it is DW-20's: **a driven probe must assert that its SETUP worked, not only
that its measurement ran.** `probes/scale.js` now reports a per-rung `shortfall` and marks the rung
invalid if it could not lay what it was asked for. Without that assertion this document would have
contained a confident, wrong curve.

---

## 10. Steamworks

**Verified on this machine, with no partner account, no app registration and nothing spent.**

```json
{ "moduleLoaded": true, "initOk": true, "steamIdPresent": true,
  "cloudEnabledForAccount": true, "cloudEnabledForApp": true,
  "binaryRoundTrip": { "wrote": true, "lengthOut": 11, "lengthBack": 11, "identical": true } }
```

- **`steamworks.js@0.4.0`** (MIT, https://github.com/ceifa/steamworks.js). Ships a prebuilt
  `steamworksjs.win32-x64-msvc.node` plus Valve's `steam_api64.dll`. Built with `@napi-rs/cli`, so
  it is a **Node-API** addon: ABI stable across Node and Electron majors, **no `electron-rebuild`
  step and no per-Electron ABI matrix**. That is the decisive advantage over `greenworks`, which is
  NAN-based, needs rebuilding per Electron version, and whose maintainers state it is maintained
  "on a best-effort basis". Note the npm package literally named `greenworks` is an unrelated 2016
  stub; do not install it.
- **Main process only.** The README is explicit that it "cannot be used by default in the renderer
  process" and suggests `contextIsolation: false, nodeIntegration: true` to change that. **Do not.**
  Expose it over a preload `contextBridge`. `electronEnableSteamOverlay()` must be called from main
  regardless. There is no automatic callback thread: the host must pump `runCallbacks()` itself.
- **Runtime requirements.** Valve: "a running Steam client is required to provide implementations of
  the various Steamworks interfaces" (https://partner.steamgames.com/doc/sdk/api). In development,
  a `steam_appid.txt` next to the executable supplies the App ID; Valve documents that it must be
  removed before uploading to a depot. It is in `electron/.gitignore` and `measure/steamcheck.mjs`
  deletes it after use.

**On App ID 480.** It is the App ID of Valve's Spacewar SDK sample, which Valve's own docs use as
the example value in the `steam_appid.txt` instructions. **Using it as a general development sandbox
is community convention and is not sanctioned anywhere in Valve's documentation.** Do not repeat it
as policy. It was used here for one reason: it is the only way to ask "does the native module load
and does `init()` reach a running Steam client" without owning an App ID. Its achievement and cloud
namespaces are shared with every developer doing the same and are meaningless for anything else.

**A useful measured detail for later.** `steamworks.js` types Steam Cloud as
`writeFile(name: string, content: string)` / `readFile(name): string`, while an Orbital Foundry save
is **binary** bytes from `persistence.h`'s `SaveWriter`. The concern was that the string boundary
would throw or mangle. Measured: bytes including `0x80`, `0xC0` and `0xFA`-`0xFF` mapped through
`String.fromCharCode` **round-tripped identically**. It is lossless, because every value below 0x100
is a valid code point, but it goes over the wire as UTF-8, so bytes >= 0x80 cost two bytes each and
random binary inflates by roughly 1.5x. Passing a `Buffer` or `Uint8Array` directly will not work.

### What only Reid can do

Everything above is the mechanical stack. **None of the following can be verified, or even started,
without a Steamworks partner account**, and I did not start any of it:

1. Enroll at https://partner.steamgames.com (distribution agreement, identity, tax and banking).
2. Pay the Steam Direct fee, currently 100 USD per app, recoupable after 1,000 USD of adjusted gross
   revenue.
3. Wait out identity and bank verification, typically several business days.
4. Create the app in App Admin to receive a **real App ID**.
5. Set and publish the Steam Cloud byte quota and file-count limits.
6. Define every achievement's API Name, display strings and icons, and publish.

Achievements do not exist until step 6: the API Name you pass to `achievement.activate()` is
created in App Admin, not in code. Steam Cloud quota is step 5.

### The Cloud design hazard, for whoever wires it

Steam **Auto-Cloud** is not usable: it syncs files on disk, and DW-17's save lives in IndexedDB
inside the Chromium profile. Pointing Auto-Cloud at Chromium's LevelDB internals would be fragile
across Electron upgrades and would corrupt across machines. The API path is the right one, and it
creates **two writers with no shared clock**: Steam syncs at process start and exit, outside the
game's control, so a player who plays offline on machine A and then on machine B gets a Steam
conflict dialog while the renderer has already loaded its local IndexedDB copy. **IndexedDB must be
treated as a cache of the cloud slot and never as an independent authority**: read cloud in main,
resolve before the renderer is allowed to restore, and stamp every slot with a monotonic counter
plus wall clock so "which is newer" is a checked property rather than a guess. That is DW-26's rule
applied to saves: when one authority answers in two shapes, publish both and test the bound.

---

## 11. Other things noticed, not fixed

- **Electron prints a Content-Security-Policy security warning** for the loaded app. The shell
  should set a CSP on the `of://` responses before anything ships. One line in `main.mjs`, left
  undone deliberately because a CSP that breaks a worker or a data-URL icon at 3 a.m. before a
  release is worse than the warning.
- **Cross-origin isolation is available and switched off.** `main.mjs --isolate` adds
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to
  every `of://` response, which is all that stands between us and `SharedArrayBuffer`. DW-4 stays as
  it is; the switch exists so that if a measurement ever asks, the answer is two lines and not a
  redesign. Nothing has asked.
- The shell forces `backgroundThrottling: false`, without which Chromium throttles `requestAnimationFrame`
  the moment the window is occluded and every long driven measurement becomes a lie.

---

## 12. Recommendation

**Electron is fine, with one caveat that has nothing to do with Electron.**

Cold start equals the browser. Frame time equals the browser. Draw calls equal the browser. WebGL2
comes up on the same ANGLE D3D11 path with `EXT_clip_control`, so reversed-Z is on. Workers, WASM
streaming, IndexedDB and both real persistence probes work unchanged under the shell's origin, so
DW-17 survives. It costs 330 MB of disk, about 60 MB of JS heap, and a 600 MB process working set
that does not grow. Steamworks loads and initialises with a stable Node-API binding that needs no
rebuild step. **Nothing in DW-27 bites.**

The caveat is that the scale question found a real wall at **about 150 machines**, it is a
`const CAPACITY = 256` in `MachineBatch.ts`, and it fails silently with every indicator green.
That was worth finding today rather than in two months, which was the entire point of running this
spike early.

**What I would do next, in order:**

1. **Give `MachineBatch` a growth path** (rendering domain, small). Then re-run
   `node measure/browser.mjs --evalfile=probes/scale.js` unchanged and get the real 500-machine
   number. Until then, no performance claim about a large factory means anything.
2. **Add an instance-pool exhaustion alarm to the HUD budget line**, next to draw calls and
   triangles. A ceiling that is invisible is a ceiling that will be hit in a playtest and
   misdiagnosed as a save bug.
3. **Look at the 7-second cold start**, which is the client and not the shell: 0.9 s to
   `did-finish-load`, then 4.2 s before `window.__of` exists.
4. Leave DW-4 and DW-10 alone. Neither shared memory nor WebGPU is anywhere near being the
   constraint.
5. Steam work waits on Reid's partner account. Nothing else is blocked by it.
