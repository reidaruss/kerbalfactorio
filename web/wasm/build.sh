#!/usr/bin/env bash
# =============================================================================
# build.sh - build the headless /core simulation to WebAssembly (Linux port of
# build.ps1, for the Proxmox VM lane; BT-30-series, 2026-08-10).
#
# Produces web/wasm/dist/of-core.mjs (ES6 module glue) + of-core.wasm, and the
# native ground-truth generator web/wasm/build/dump_expected used by the
# parity test. Mirrors build.ps1 flag-for-flag; see that file for the reasoning
# behind each emcc flag (unchanged here on purpose, so the two scripts cannot
# silently drift apart).
#
# PREREQ (once): install emsdk outside this repo, e.g.
#     git clone https://github.com/emscripten-core/emsdk ~/emsdk
#     cd ~/emsdk && python3 emsdk.py install 6.0.4 && python3 emsdk.py activate 6.0.4
#   (6.0.4 pinned to match the version the Windows machine's emsdk resolves to
#   as of 2026-08-10; bump both together if the Windows side moves.)
#
# Usage:  ./build.sh                 # release (-O3)
#         ./build.sh --debug         # -O0 + assertions + safe heap
#         ./build.sh --skip-native   # wasm only
#         EMSDK=/path/to/emsdk ./build.sh
# =============================================================================
set -euo pipefail

DEBUG=0
SKIP_NATIVE=0
EMSDK="${EMSDK:-$HOME/emsdk}"

for arg in "$@"; do
  case "$arg" in
    --debug) DEBUG=1 ;;
    --skip-native) SKIP_NATIVE=1 ;;
    --emsdk=*) EMSDK="${arg#--emsdk=}" ;;
    *) echo "build.sh: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
inc="$repo/core/include"
dist="$here/dist"
bld="$here/build"

mkdir -p "$dist" "$bld"

# --- activate emsdk -----------------------------------------------------------
if [ ! -f "$EMSDK/emsdk_env.sh" ]; then
  echo "build.sh: emsdk not found at $EMSDK. Clone + install it first (see header)." >&2
  exit 1
fi
export EMSDK_QUIET=1
# shellcheck source=/dev/null
source "$EMSDK/emsdk_env.sh"
emcc="$(command -v emcc || true)"
if [ -z "$emcc" ]; then
  echo "build.sh: no emcc on PATH after sourcing emsdk_env.sh under $EMSDK" >&2
  exit 1
fi

# --- native ground truth (the parity fixture) ---------------------------------
# Built with plain g++ -O2, no -ffast-math: the whole determinism story rests
# on strict IEEE-754 doubles (position-hashing reinterprets double bits). The
# Windows build additionally static-links the GNU runtime (BT-8) to dodge a
# stale system libstdc++-6.dll; that problem does not exist on this box (one
# glibc/libstdc++ on PATH), so this port does not carry -static.
if [ "$SKIP_NATIVE" -eq 0 ]; then
  echo "[1/2] native ground-truth generator (g++ -O2)"
  g++ -std=c++17 -O2 -I"$inc" -o "$bld/dump_expected" "$here/test/dump_expected.cpp"
  json="$("$bld/dump_expected")"
  # UTF-8, no BOM, LF endings: the fixture is committed, so it must not churn
  # between shells (and JSON.parse chokes on a BOM). printf keeps this a plain
  # LF text file same as the PowerShell UTF8Encoding($false) write.
  printf '%s\n' "$json" > "$here/test/expected.json"
fi

# --- wasm ---------------------------------------------------------------------
# FLAG NOTES: see build.ps1's header comment for the full rationale on each of
# these; they are kept byte-for-byte identical between the two scripts.
if [ "$DEBUG" -eq 1 ]; then
  opt=(-O0 -g3 -sASSERTIONS=2 -sSAFE_HEAP=1)
  opt_label="-O0"
else
  opt=(-O3 -sASSERTIONS=0)
  opt_label="-O3"
fi

flags=(
  -std=c++17
  -I"$inc"
  -ffp-contract=off
  -fno-rtti
  --no-entry
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createOrbitalFoundryCore
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=67108864
  -sSTACK_SIZE=1048576
  -sFILESYSTEM=0
  -sENVIRONMENT=web,worker,node
  -sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAPF64,HEAP8,HEAP16,HEAP32,HEAPU8,HEAPU16,HEAPU32
  -sEXPORTED_FUNCTIONS=_malloc,_free
  "${opt[@]}"
)

echo "[2/2] wasm (emcc $opt_label)"
emcc "${flags[@]}" "$here/of_core_api.cpp" -o "$dist/of-core.mjs"

for f in "$dist"/of-core.*; do
  printf '  %-16s %10d bytes\n' "$(basename "$f")" "$(stat -c%s "$f")"
done
echo OK
