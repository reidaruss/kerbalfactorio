# `web/wasm` — the headless `/core` simulation, compiled to WebAssembly

This is the browser-side home of the C++17 simulation in [`core/`](../../core).
Nothing here re-implements game logic: `of_core_api.cpp` is a thin flat-C shim
over the unmodified `core/include/of/*.h` headers, so the browser runs the exact
code the 22 green ctest suites cover.

The full API reference, memory-ownership rules, threading guidance, parity
results and benchmarks live in **[docs/web/WASM-BRIDGE.md](../../docs/web/WASM-BRIDGE.md)**.
This file is just how to build and run it.

## Layout

| Path | What |
|---|---|
| `of_core_api.cpp` | The flat C ABI shim (the only source file). |
| `build.ps1` | Builds the WASM module **and** the native ground-truth fixture. |
| `dist/of-core.mjs` + `dist/of-core.wasm` | Build output; committed so the renderer can bind without a toolchain. |
| `test/dump_expected.cpp` | Native ground-truth generator (also `--bench` and `--diag`). |
| `test/expected.json` | The pinned native fixture the parity test compares against. |
| `test/parity.mjs` | The parity + benchmark test (plain `node`). |
| `test/diag.mjs` | Determinism diagnostic; run it when parity reports a divergence. |

## Prerequisites (once)

Node 22+, WinLibs g++ (already on PATH for `core/build`), and emsdk **installed
outside this repo** (it is ~1.5 GB and must not enter Nextcloud sync):

```powershell
git clone https://github.com/emscripten-core/emsdk C:\Users\reida\emsdk
cd C:\Users\reida\emsdk
python emsdk.py install latest      # emscripten 6.0.4
python emsdk.py activate latest
```

## Activating emsdk

**PowerShell (the supported shell):**

```powershell
& "C:\Users\reida\emsdk\emsdk_env.ps1"
emcc --version        # -> emcc 6.0.4
```

`build.ps1` does this for you, so you normally never type it.

**Git Bash: `emsdk_env.sh` does NOT work here.** It shells out to bare `python`,
which on this machine resolves to the Windows Store app-execution alias and
fails. Call the compiler directly instead:

```bash
EM_CONFIG=/c/Users/reida/emsdk/.emscripten \
  python /c/Users/reida/emsdk/upstream/emscripten/emcc.py --version
```

## Build

```powershell
.\web\wasm\build.ps1              # native fixture + wasm (-O3)
.\web\wasm\build.ps1 -SkipNative  # wasm only
.\web\wasm\build.ps1 -Debug       # -O0 -g3 -sASSERTIONS=2 -sSAFE_HEAP=1
```

Output: `dist/of-core.mjs` (~19 KB glue) + `dist/of-core.wasm` (~127 KB).

## Test

```bash
node web/wasm/test/parity.mjs           # parity (exit 1 on a gating failure)
node web/wasm/test/parity.mjs --bench   # + perf table, R1 chunk gate, oracle cost
node web/wasm/test/diag.mjs             # determinism diagnostic (needs --diag data)
```

`parity.mjs` gates on two tiers and reports a third:

* **Tier 0 — self-determinism** (gating): the WASM module reproduces itself
  bit-for-bit, shared quad edges are bit-identical (crack-free), and **every
  export that answers "where is the ground" reads the surface oracle** (CASE 7b,
  the guard for the audit in WASM-BRIDGE.md §4.0).
* **Tier A — cross-toolchain, transcendental-free** (gating): factory sim, voxel
  layer, persistence bytes, LOD selection, index buffers.
* **Tier B — cross-toolchain, transcendental-dependent** (informational): the
  continuous terrain field, which differs from a native build by a known 1-ULP
  `libm` delta. See WASM-BRIDGE.md §"Parity".

To regenerate the diagnostic inputs before running `diag.mjs`:

```powershell
.\web\wasm\build\dump_expected.exe --diag > $null
```

## Using it

```js
import createOrbitalFoundryCore from './dist/of-core.mjs';
const M = await createOrbitalFoundryCore();
const forge = M._of_body_create_forge(0x0BF00D01, 0);
const h = M._of_base_height(forge, 0.577, 0.577, 0.577);   // metres of relief
```

Two rules, both non-negotiable (details in WASM-BRIDGE.md):

1. **Never cache a heap view or a scratch pointer across a call into WASM.**
   `-sALLOW_MEMORY_GROWTH` can replace the whole `ArrayBuffer` and detach every
   existing typed array. Re-read `M.HEAPxx` and re-read the pointer, every time.
2. **Every `*_create` needs its matching `*_destroy`.** JS holds int handles, not
   pointers; nothing is garbage-collected on the WASM side.

## What is deliberately excluded

`of/persistence_file.h` uses `std::filesystem` and cannot work in a browser. It
is not compiled in. `of/persistence.h` — the pure byte serializer — **is**
included and works; saving in the browser means handing its byte stream to
IndexedDB or OPFS on the JS side (`of_edits_serialize` / `of_edits_deserialize`
show the pattern).
