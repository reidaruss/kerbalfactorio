# =============================================================================
# build.ps1 — build the headless /core simulation to WebAssembly.
#
# Produces web/wasm/dist/of-core.mjs (ES6 module glue) + of-core.wasm, and the
# native ground-truth generator web/wasm/build/dump_expected.exe used by the
# parity test.
#
# PREREQ (once): install emsdk outside this repo, e.g.
#     git clone https://github.com/emscripten-core/emsdk C:\Users\reida\emsdk
#     cd C:\Users\reida\emsdk
#     python emsdk.py install latest
#     python emsdk.py activate latest
#
# ACTIVATION (per PowerShell session — this script does it for you):
#     & "C:\Users\reida\emsdk\emsdk_env.ps1"
# Note: emsdk_env.sh does NOT work in this Git Bash because bare `python`
# resolves to the Windows Store alias. Use PowerShell, or in bash call the
# compiler directly:  EM_CONFIG=/c/Users/reida/emsdk/.emscripten \
#                     python /c/Users/reida/emsdk/upstream/emscripten/emcc.py ...
#
# Usage:  .\build.ps1              # release (-O3)
#         .\build.ps1 -Debug       # -O0 + assertions + safe heap
#         .\build.ps1 -SkipNative  # wasm only
# =============================================================================
param(
    [switch]$Debug,
    [switch]$SkipNative,
    [string]$Emsdk = "C:\Users\reida\emsdk"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here "..\..")
$inc  = Join-Path $repo "core\include"
$dist = Join-Path $here "dist"
$bld  = Join-Path $here "build"

New-Item -ItemType Directory -Force -Path $dist | Out-Null
New-Item -ItemType Directory -Force -Path $bld  | Out-Null

# --- activate emsdk -----------------------------------------------------------
$env:EMSDK_QUIET = "1"
$envScript = Join-Path $Emsdk "emsdk_env.ps1"
if (-not (Test-Path $envScript)) {
    throw "emsdk not found at $Emsdk. Clone + install it first (see header)."
}
& $envScript
# emsdk 6.x ships emcc.exe; older SDKs ship emcc.bat. Accept either.
$emcc = @("emcc.exe", "emcc.bat") |
    ForEach-Object { Join-Path $Emsdk "upstream\emscripten\$_" } |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $emcc) { throw "no emcc.exe/emcc.bat under $Emsdk\upstream\emscripten" }

# --- native ground truth (the parity fixture) ---------------------------------
# Built with the SAME toolchain + flags as core/build's 22 ctest suites
# (WinLibs g++, -O2, no -ffast-math), so its output is the values ctest pins.
if (-not $SkipNative) {
    Write-Output "[1/2] native ground-truth generator (g++ -O2)"
    & g++ -std=c++17 -O2 -I"$inc" -static-libstdc++ -static-libgcc -static `
        -o (Join-Path $bld "dump_expected.exe") (Join-Path $here "test\dump_expected.cpp")
    if ($LASTEXITCODE -ne 0) { throw "native build failed" }
    $json = & (Join-Path $bld "dump_expected.exe")
    if ($LASTEXITCODE -ne 0) { throw "native self-checks failed - fixture is not ground truth" }
    # UTF-8, no BOM, LF endings: the fixture is committed, so it must not churn
    # between shells (and JSON.parse chokes on a BOM).
    [System.IO.File]::WriteAllText((Join-Path $here "test\expected.json"),
        (($json -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
}

# --- wasm ---------------------------------------------------------------------
# FLAG NOTES (each one is load-bearing):
#   -O3                       release codegen. NO -ffast-math anywhere: the whole
#                             determinism story rests on strict IEEE-754 doubles
#                             (position-hashing reinterprets double bits).
#   -ffp-contract=off         forbid FMA contraction so an expression can never be
#                             rounded once instead of twice. Harmless on wasm MVP
#                             (no scalar f64 FMA) but pinned explicitly so a future
#                             relaxed-SIMD backend cannot silently change results.
#   -fno-rtti                 nothing here uses dynamic_cast/typeid; saves ~10 KB.
#   -sMODULARIZE=1 -sEXPORT_ES6=1   the module is `import init from './of-core.mjs'`
#                             then `const M = await init()`. Works in a Worker.
#   -sALLOW_MEMORY_GROWTH=1   terrain streaming allocates unpredictably. NOTE: this
#                             is exactly why JS must re-read HEAPF32/HEAPF64/HEAP32
#                             after every call (growth detaches old ArrayBuffers).
#   --no-entry                no main(); the module is a library.
#   -sFILESYSTEM=0            no FS glue (persistence_file.h is excluded; saving is
#                             IndexedDB/OPFS on the JS side).
#   -sENVIRONMENT=web,worker,node   the three places we run it.
#   NOT USED: -sUSE_PTHREADS / SharedArrayBuffer. v1 recommendation is one
#   single-threaded module instance PER worker: it needs no COOP/COEP headers, has
#   no data races by construction, and parallelises fine (one meshing worker, one
#   sim worker). See docs/web/WASM-BRIDGE.md "threading".
$opt = if ($Debug) { @("-O0", "-g3", "-sASSERTIONS=2", "-sSAFE_HEAP=1") }
       else        { @("-O3", "-sASSERTIONS=0") }

$flags = @(
    "-std=c++17",
    "-I$inc",
    "-ffp-contract=off",
    "-fno-rtti",
    "--no-entry",
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sEXPORT_NAME=createOrbitalFoundryCore",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sINITIAL_MEMORY=67108864",
    "-sSTACK_SIZE=1048576",
    "-sFILESYSTEM=0",
    "-sENVIRONMENT=web,worker,node",
    "-sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAPF64,HEAP8,HEAP16,HEAP32,HEAPU8,HEAPU16,HEAPU32",
    "-sEXPORTED_FUNCTIONS=_malloc,_free"
) + $opt

Write-Output "[2/2] wasm (emcc $($opt[0]))"
& $emcc @flags (Join-Path $here "of_core_api.cpp") -o (Join-Path $dist "of-core.mjs")
if ($LASTEXITCODE -ne 0) { throw "emcc failed" }

Get-ChildItem $dist | Where-Object { $_.Name -like "of-core.*" } |
    ForEach-Object { Write-Output ("  {0,-16} {1,10:N0} bytes" -f $_.Name, $_.Length) }
Write-Output "OK"
