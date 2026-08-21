// WG-230. THE WORLD-LOCKED PHASE COORDINATE, the shader half. GLSL text and
// the one define it rides on; a leaf module on TerrainFine's precedent (2.2
// rule 1) importing nothing but the period constant it must not transcribe.
//
// WHAT THIS IS FOR. Every world-keyed field in this material is keyed on `pM`,
// planet-centred metres in float32, and `pM` at Forge's radius carries a
// quantum of 31.25 mm (WG-50 measured the typical component; TerrainArt.glsl's
// header quotes the 62.5 mm worst case). That is 8.77 pixel footprints at two
// metres, which is why the surface-art bump has to fade out and why the splat
// rides the CHUNK UV instead -- and the chunk UV's world scale DOUBLES at every
// LOD ring, which is precisely what makes a world-locked far rung impossible
// today (TerrainSplat.ts's own note). `vPhase` is the coordinate that is both
// world-locked AND resolvable.
//
// HOW IT IS BUILT. `aPhase` is `frac(anchor / P)` reduced on the CPU in float64
// (world-gen's ChunkPhase.ts) and stamped per chunk; the vertex shader adds the
// vertex's own chunk-local `position / P`. Neither term is ever a planet-scale
// float, which is standing rule 6 applied to a shading coordinate instead of to
// a position, and it is the whole mechanism.
//
// THE ONE RULE A CONSUMER MUST KEEP. `vPhase` is periodic with period 1.0, so
// two chunks reaching the same ground hold values that differ by an exact
// INTEGER. `fract(vPhase * n)` therefore agrees across a chunk edge for INTEGER
// n and for nothing else. A non-integer n draws a line along every chunk
// boundary in the frame, and it draws it only at range where the boundaries are
// far apart and the cause is least obvious. `assertPhasePeriod()` in
// ChunkPhase.ts is the throw that stops that reaching a screenshot; call it at
// module load with your tile metres and multiply by what it returns.
//
// WHAT IS DELIBERATELY NOT HERE. No anti-tiling, no far rung, no texture fetch.
// This lane ships the coordinate and the probe that proves it arrives; the
// far-field material that consumes it is R2's L1 lane.

import { PHASE_PERIOD_M } from '../../world/ChunkPhase.js';

export const TERRAIN_PHASE_PARS = /* glsl */`
  #define OF_PHASE_PERIOD_M ${PHASE_PERIOD_M.toFixed(1)}

  // The world-locked coordinate at a period of OF_PHASE_PERIOD_M / repeats
  // metres, in [0,1) per axis. repeats MUST be a whole number.
  vec3 ofPhaseWrap(float repeats) {
    return fract(vPhase * repeats);
  }

  // The same coordinate in METRES, modulo OF_PHASE_PERIOD_M. For a consumer
  // that would rather divide by its own tile size than count repeats; the
  // integer-repeats rule above is unchanged, it is just written the other way.
  vec3 ofPhaseMetres() {
    return fract(vPhase) * OF_PHASE_PERIOD_M;
  }

  // THE PROBE, and the reason a stub lane ships one at all: RN-2268's scar is
  // that a term reading a value published by another subsystem has one failure
  // mode nothing else has -- the publish never fires -- and a coordinate that
  // silently arrives as zero is invisible in every frame and in every counter.
  //
  // A CHECKER, because a checker is the one pattern that fails LOUDLY in all
  // three ways this wire can break: if the attribute is unbound it is flat, if
  // the reduction is wrong it does not line up across a chunk boundary, and if
  // the precision claim is wrong it stairs.
  //
  // Its repeats are uPhaseProbe.y and NOT a constant, because a fixed 2 m
  // checker is unresolvable from 1.2 km and reads as moire whatever the wire is
  // doing -- an instrument that returns the same picture for "working" and
  // "broken" at the range the term is FOR. ?phaserep= puts the check at a size
  // the pose can actually see. It is gated by uPhaseProbe.x, whose shipped
  // value is 0.
  float ofPhaseProbe() {
    vec3 c = ofPhaseWrap(uPhaseProbe.y);
    vec3 s = step(vec3(0.5), c);
    return fract((s.x + s.y + s.z) * 0.5) - 0.5;
  }
`;
