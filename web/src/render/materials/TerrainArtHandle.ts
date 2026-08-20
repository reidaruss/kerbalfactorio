// PHASE 3 of createTerrainMaterials: install `window.__ofTerrainArt`, the
// settled-frame runtime instrument every terrain-art probe drives. Split out of
// TerrainMaterial.ts at RN-2050; the body below is the original lines 647-975
// verbatim, at its original indentation.
//
// WHY THIS IS A PHASE AND NOT PART OF THE FACTORY. Every setter here writes a
// SHARED holder out of TerrainUniformState, so there is no path by which the
// near and far materials can disagree, and no uniform push is needed because
// three uploads a ShaderMaterial's uniforms every frame. It runs AFTER both
// materials are built, exactly as it did before the split, because the handle
// is about the state and not about either material.

import { ART_DEFAULT, fineAmpFromQuery, specAmpFromQuery} from './TerrainAmpQuery.js';
import { canopyToneNow } from './TerrainTreeline.js';
import { horizonOccFromQuery, reliefCellFromQuery, reliefCellNoiseFromQuery,
  reliefGradFromQuery, reliefGradUvFromQuery, reliefSwingFromQuery }
  from './TerrainReliefQuery.js';
import { ART_COARSE_M, ART_FINE_M, ART_FINE_M_PRE1855, FINE_ALB, FINE_BUMP,
  FINE_CHUNK_M, FINE_LUM_REF, MID_A_M, MID_ALB, MID_B_M, REL_CELL,
  REL_CELL_NOISE, RELIEF_FINE_M, RELIEF_FINE_M_PRE1855, RELIEF_GRAD_UV,
  REL_SWING_DEFAULT } from './TerrainArt.glsl.js';
import type { TerrainUniformState } from './TerrainUniformState.js';
import { terrainSplatHandle } from './TerrainSplatHandle.js';

export function installTerrainArtHandle(s: TerrainUniformState): void {
  const { artAmp, wetBand, groundTex, groundAmp, reliefTex, reliefAmp,
    reliefGrad, reliefGradUv, artFineM, reliefFineM, artCoarseM, midAmp, midM,
    reliefSwing, reliefCell, reliefCellNoise, bounceLit, horizonOcc, specAmp,
    fineAmp, fineFreq, fineW, fineLum } = s;
  // The runtime handle, on the `window.__ofSurfaces` / `window.__ofAtmos`
  // precedent. It writes the SHARED vector, so there is no path by which the
  // two materials can disagree, and it needs no uniform push because three
  // uploads a ShaderMaterial's uniforms every frame.
  (self as unknown as Record<string, unknown>).__ofTerrainArt = {
    set(macro: number, bump: number, strata: number): void {
      artAmp.set(macro, bump, strata);
    },
    get(): [number, number, number] { return [artAmp.x, artAmp.y, artAmp.z]; },
    reset(): void {
      artAmp.set(ART_DEFAULT.macro, ART_DEFAULT.bump, ART_DEFAULT.strata);
    },
    // RN-57. Same handle rather than a second one, because the wet band is a
    // terrain art term and a probe toggling it wants the SAME settled-frame
    // instrument RN-45 built for the other three.
    setWet(amp: number): number { wetBand.w = amp; return amp; },
    getWet(): [number, number, number, number] { return wetBand.toArray(); },
    // RN-78, same handle for the same reason as setWet: the ground texture is
    // a terrain art term and a probe toggling it wants the settled-frame
    // instrument, not a page reload.
    setTex(amp: number): number { groundAmp.value = amp; return amp; },
    getTex(): number { return groundAmp.value; },
    // RN-148, same handle for the same reason as setTex: the relief is a
    // terrain art term and a probe toggling it wants the settled-frame
    // instrument, not a page reload.
    setRelief(amp: number): number { reliefAmp.value = amp; return amp; },
    getRelief(): number { return reliefAmp.value; },
    /** RN-741. 1 is the band-limited tile-space slope, 0 the pre-RN-741 screen
     *  derivative. Runtime, so a probe gets RN-30's settled-frame pair rather
     *  than two page loads, which is what the shadow-LOD `k` comparison could
     *  NOT have and had to state as a bound instead. */
    setReliefGrad(v: number): number { reliefGrad.value = v > 0.5 ? 1 : 0; return reliefGrad.value; },
    getReliefGrad(): number { return reliefGrad.value; },
    reliefGradDefault(): { present: boolean; value: number } {
      const p = new URLSearchParams(self.location.search);
      return { present: p.get('reliefgrad') !== null, value: reliefGradFromQuery() };
    },
    /** RN-843. The relief slope's SUPPORT in tile units, at runtime, because
     *  the shipped value is the defect and finding the right one needs a sweep
     *  inside one page rather than one build per rung. */
    setReliefGradUv(v: number): number {
      if (Number.isFinite(v) && v > 0) reliefGradUv.value = v;
      return reliefGradUv.value;
    },
    getReliefGradUv(): number { return reliefGradUv.value; },
    /** RN-843. The shipped default and whether the URL moved it, so a sweep can
     *  assert its own fixture before reading any rung (GP-142). */
    reliefGradUvDefault(): { present: boolean; value: number; shipped: number } {
      const p = new URLSearchParams(self.location.search);
      return {
        present: p.get('reliefgraduv') !== null,
        value: reliefGradUvFromQuery(),
        shipped: RELIEF_GRAD_UV,
      };
    },
    /** RN-1855. THE TWO FOOTPRINT FADES' WAVELENGTHS, in metres, at runtime.
     *  setReliefGradUv's precedent and RN-1000's sharper reason: this
     *  correction is judged AT RANGE, where the mover is a smoothstep on the
     *  pixel footprint, and a pair whose two halves are two page loads differs
     *  by two streamed chunk sets and two sun solves as well as by the term.
     *  Both together in one call rather than two, because the two fades are one
     *  decision and an arm that moved one of them would be a third state
     *  nothing in this lane's report describes. */
    setFineM(artM: number, reliefM: number): [number, number] {
      if (Number.isFinite(artM) && artM > 0) artFineM.value = artM;
      if (Number.isFinite(reliefM) && reliefM > 0) reliefFineM.value = reliefM;
      return [artFineM.value, reliefFineM.value];
    },
    getFineM(): [number, number] { return [artFineM.value, reliefFineM.value]; },
    /** RN-1900. The vnoise bump's COARSE octave's fade wavelength, at runtime,
     *  on setFineM's precedent and for its reason: this correction is judged at
     *  range, and a pair whose two halves are two page loads differs by two
     *  streamed chunk sets and two sun solves as well as by the term. Setting
     *  it EQUAL to `uArtFineM` is the pre-RN-1900 single-fade bump. */
    setArtCoarseM(m: number): number {
      if (Number.isFinite(m) && m > 0) artCoarseM.value = m;
      return artCoarseM.value;
    },
    getArtCoarseM(): number { return artCoarseM.value; },
    artCoarseMDefault(): { present: boolean; value: number; pre: number } {
      const p = new URLSearchParams(self.location.search);
      return { present: p.get('artcoarsem') !== null, value: ART_COARSE_M,
        // The BEFORE half: the coarse octave faded at the FINE octave's
        // wavelength, which is what the single call did. Read from the same
        // export the fine fade's own default is read from, never transcribed
        // (standing rule 11).
        pre: ART_FINE_M };
    },
    /** RN-1900. THE MID-FIELD LAYER, amplitude and luminance weight together,
     *  and its two wavelengths. Runtime for setFineM's reason exactly: the term
     *  is judged between 18 and 45 m, where every candidate differs from every
     *  other by a smoothstep on the pixel footprint, and two page loads are two
     *  scenes (RN-1000). */
    setMid(amp: number, lum?: number): [number, number] {
      if (Number.isFinite(amp) && amp >= 0) midAmp.x = amp;
      if (lum !== undefined && Number.isFinite(lum)) midAmp.y = lum > 0.5 ? 1 : 0;
      return [midAmp.x, midAmp.y];
    },
    getMid(): [number, number] { return [midAmp.x, midAmp.y]; },
    setMidM(a: number, b: number): [number, number] {
      if (Number.isFinite(a) && a > 0) midM.x = a;
      if (Number.isFinite(b) && b > 0) midM.y = b;
      return [midM.x, midM.y];
    },
    getMidM(): [number, number] { return [midM.x, midM.y]; },
    /** RN-1900. The shipped defaults and whether the URL moved them, so an arm
     *  restores the boot state from the source of truth and a sweep can assert
     *  its own fixture before reading any rung (GP-142, RN-150). */
    midDefault(): {
      present: boolean; amp: number; lum: number; a: number; b: number;
    } {
      const p = new URLSearchParams(self.location.search);
      return {
        present: p.get('groundmid') !== null || p.get('groundmidamp') !== null
          || p.get('groundmidm') !== null || p.get('groundmidlum') !== null,
        amp: MID_ALB, lum: 1, a: MID_A_M, b: MID_B_M,
      };
    },
    /** RN-1855. The shipped defaults, whether the URL moved either, and the two
     *  PRE-FIX values, so an arm restores the before state from the source of
     *  truth rather than from a number typed into a probe (standing rule 11),
     *  and so the BOOT DEFAULT is assertable in its own right (RN-150). */
    fineMDefault(): {
      present: boolean; art: number; relief: number;
      artPre: number; reliefPre: number;
    } {
      const p = new URLSearchParams(self.location.search);
      return {
        present: p.get('artfinem') !== null || p.get('relieffinem') !== null,
        art: ART_FINE_M, relief: RELIEF_FINE_M,
        artPre: ART_FINE_M_PRE1855, reliefPre: RELIEF_FINE_M_PRE1855,
      };
    },
    /** RN-1000. The ripple direction's peak-to-peak swing in radians, at
     *  runtime, on setReliefGradUv's precedent exactly and for the sharper
     *  version of its reason. RN-961 shipped `?reliefswing=` and no handle, so
     *  the only available before/after pair was TWO PAGE LOADS: two streamed
     *  chunk sets, two scatter draws, two sun solves and two convergence
     *  histories, with the term's effect somewhere inside all of that. The
     *  artefact this term exists to remove is judged BY LOOKING at a pair, and
     *  a pair whose two halves differ in more than the term is not a pair. With
     *  this handle the camera, the sun, the chunks and the props are equal by
     *  construction and every moved pixel is the term's.
     *
     *  Negative values are refused rather than clamped: a negative swing is a
     *  caller error (the term is peak-to-peak) and silently reading it as its
     *  own magnitude would make a mistyped sweep look like a working one. */
    setReliefSwing(v: number): number {
      if (Number.isFinite(v) && v >= 0) reliefSwing.value = v;
      return reliefSwing.value;
    },
    getReliefSwing(): number { return reliefSwing.value; },
    /** RN-1000. The shipped default and whether the URL moved it, so a pair can
     *  assert its own fixture before reading either half (GP-142), and so the
     *  BOOT DEFAULT is assertable in its own right rather than only reachable
     *  by passing an explicit flag (RN-150: two features have already shipped
     *  dark because every probe passed one). */
    reliefSwingDefault(): { present: boolean; value: number; shipped: number } {
      const p = new URLSearchParams(self.location.search);
      return {
        present: p.get('reliefswing') !== null,
        value: reliefSwingFromQuery(),
        shipped: REL_SWING_DEFAULT,
      };
    },
    /** RN-1005. The direction field's two scales at runtime. Strictly positive
     *  in the setter as well as in the parser, because a sweep that silently
     *  ignored a bad rung would report the PREVIOUS rung's frame under the new
     *  rung's label, which is worse than failing. */
    setReliefCell(v: number): number {
      if (Number.isFinite(v) && v > 0) reliefCell.value = v;
      return reliefCell.value;
    },
    getReliefCell(): number { return reliefCell.value; },
    setReliefCellNoise(v: number): number {
      if (Number.isFinite(v) && v > 0) reliefCellNoise.value = v;
      return reliefCellNoise.value;
    },
    getReliefCellNoise(): number { return reliefCellNoise.value; },
    reliefCellDefault(): {
      present: boolean; value: number; shipped: number;
      noisePresent: boolean; noiseValue: number; noiseShipped: number;
    } {
      const p = new URLSearchParams(self.location.search);
      return {
        present: p.get('reliefcell') !== null,
        value: reliefCellFromQuery(),
        shipped: REL_CELL,
        noisePresent: p.get('reliefcellnoise') !== null,
        noiseValue: reliefCellNoiseFromQuery(),
        noiseShipped: REL_CELL_NOISE,
      };
    },
    /** RN-841. 1 is the unshadowed bounce source, 0 the pre-RN-841 expression. */
    setBounceLit(v: number): number { bounceLit.value = v > 0.5 ? 1 : 0; return bounceLit.value; },
    getBounceLit(): number { return bounceLit.value; },
    bounceLitDefault(): { present: boolean; value: number } {
      const p = new URLSearchParams(self.location.search);
      return { present: p.get('bouncelit') !== null, value: p.get('bouncelit') === '0' ? 0 : 1 };
    },
    /** RN-842. The body's horizon occlusion. 0 is the exact flat-plane model. */
    setHorizonOcc(v: number): number {
      horizonOcc.value = Math.min(0.45, Math.max(0, v));
      return horizonOcc.value;
    },
    getHorizonOcc(): number { return horizonOcc.value; },
    horizonOccDefault(): { present: boolean; value: number | null } {
      const p = new URLSearchParams(self.location.search);
      return { present: p.get('horizonocc') !== null, value: horizonOccFromQuery() };
    },
    // RN-731, same handle for the same reason as setRelief: the specular is a
    // terrain art term, and a probe toggling it wants RN-30's settled-frame
    // instrument (two frames with the camera, sun, streamed chunk set and
    // scatter equal BY CONSTRUCTION) rather than a page reload, which holds
    // none of those equal.
    /** `sun` is the GGX highlight, `sky` is the grazing sky reflection. Both
     *  are written into the SHARED vector, so the near and far materials cannot
     *  disagree, and neither needs a uniform push (three uploads a
     *  ShaderMaterial's uniforms every frame). */
    setSpec(sun: number, sky?: number): [number, number] {
      specAmp.set(sun, sky ?? sun);
      return [specAmp.x, specAmp.y];
    },
    getSpec(): [number, number] { return [specAmp.x, specAmp.y]; },
    /** RN-1733. The near-field detail layer, at runtime, on setSpec's precedent
     *  and for RN-1000's sharper version of its reason: this term is judged by
     *  LOOKING at a pair, and two page loads is not a pair (two streamed chunk
     *  sets, two scatter draws, two sun solves). Written into the SHARED vector,
     *  so the near and far materials cannot disagree, and no push is needed
     *  because three uploads a ShaderMaterial's uniforms every frame.
     *
     *  Negatives are refused rather than clamped, on setReliefSwing's rule: a
     *  negative amplitude is a caller error and reading it as its own magnitude
     *  would make a mistyped sweep look like a working one. */
    setFine(bump: number, alb?: number): [number, number] {
      if (Number.isFinite(bump) && bump >= 0) fineAmp.x = bump;
      const a = alb === undefined ? bump : alb;
      if (Number.isFinite(a) && a >= 0) fineAmp.y = a;
      return [fineAmp.x, fineAmp.y];
    },
    getFine(): [number, number] { return [fineAmp.x, fineAmp.y]; },
    /** RN-1733. The boot DEFAULT as its own fixture, separate from the live
     *  value, so a probe that always passes an explicit flag still exercises
     *  what ships (RN-150: two features have shipped dark because every probe
     *  passed one). `shipped` is the authored constant, `bump`/`alb` are what
     *  this boot actually resolved, and `present` says whether a URL moved it. */
    fineDefault(): { present: boolean; bump: number; alb: number;
      shippedBump: number; shippedAlb: number;
      freq: [number, number, number]; w: [number, number, number];
      chunkM: number; lambdaM: [number, number, number]; integerFreq: boolean;
      lum: number; lumRef: number } {
      const p = new URLSearchParams(self.location.search);
      const boot = fineAmpFromQuery();
      const keys = ['groundfine', 'groundfinebump', 'groundfinebumpamp',
        'groundfinealb', 'groundfinealbamp', 'groundfinefreq', 'groundfinew',
        'groundfinelum'];
      const f: [number, number, number] = [fineFreq.x, fineFreq.y, fineFreq.z];
      return {
        present: keys.some((k) => p.get(k) !== null),
        bump: boot.x, alb: boot.y,
        shippedBump: FINE_BUMP, shippedAlb: FINE_ALB,
        freq: f, w: [fineW.x, fineW.y, fineW.z], chunkM: FINE_CHUNK_M,
        lum: fineLum.value, lumRef: FINE_LUM_REF,
        // The WAVELENGTHS, published beside the repeats, because a repeat count
        // is not a thing anyone can judge and a wavelength in metres is. This
        // is where a reader sees that the finest octave is a decimetre and not
        // a metre without doing the division themselves.
        lambdaM: [FINE_CHUNK_M / f[0], FINE_CHUNK_M / f[1], FINE_CHUNK_M / f[2]],
        // The chunk-edge seam holds only for INTEGER repeats (ofArtVnoise2P
        // reduces the lattice index modulo this number). A sweep is allowed to
        // break it; what is not allowed is breaking it without the report
        // saying so, which is how a fractional rung's seam gets attributed to
        // the frequency rather than to the sweep.
        integerFreq: f.every((x) => Number.isInteger(x)),
      };
    },
    /** RN-1733. The frequency triple, at runtime, so which BAND the near ground
     *  is missing can be swept inside one page. Positive and finite or the call
     *  is refused, on setReliefCell's rule: a sweep that silently ignored a bad
     *  rung would report the PREVIOUS rung's frame under the new rung's label. */
    setFineFreq(a: number, r: number, b: number): [number, number, number] {
      if ([a, r, b].every((x) => Number.isFinite(x) && x > 0)) fineFreq.set(a, r, b);
      return [fineFreq.x, fineFreq.y, fineFreq.z];
    },
    getFineFreq(): [number, number, number] {
      return [fineFreq.x, fineFreq.y, fineFreq.z];
    },
    /** RN-1733. The three height weights at runtime. Negatives ARE allowed here
     *  and that is deliberate rather than sloppy: a negative weight inverts one
     *  octave's sense, which is a legitimate question about a crease field
     *  (creased highs against creased lows), and it is the ridge term where the
     *  answer is not obvious. */
    setFineW(a: number, r: number, b: number): [number, number, number] {
      if ([a, r, b].every((x) => Number.isFinite(x))) fineW.set(a, r, b);
      return [fineW.x, fineW.y, fineW.z];
    },
    getFineW(): [number, number, number] { return [fineW.x, fineW.y, fineW.z]; },
    /** RN-1735. The per-biome luminance weight, at runtime, so the rule can be
     *  turned off between two SETTLED FRAMES rather than two page loads. */
    setFineLum(v: number): number {
      fineLum.value = v > 0.5 ? 1 : 0; return fineLum.value;
    },
    getFineLum(): number { return fineLum.value; },
    /** The boot DEFAULT as its own fixture, separate from the live value, so a
     *  probe that always passes an explicit flag still exercises what ships
     *  (RN-150: `Number(null)` is 0 and 0 is finite). */
    specDefault(): { present: boolean; sun: number; sky: number } {
      const p = new URLSearchParams(self.location.search);
      const boot = specAmpFromQuery();
      const keys = ['terrainspec', 'terrainspecamp', 'terrainspecsun',
        'terrainspecsky', 'terrainspecskyamp'];
      return {
        present: keys.some((k) => p.get(k) !== null),
        sun: boot.x, sky: boot.y,
      };
    },
    reliefState(): { w: number; h: number } {
      const img = reliefTex.value.image as { width?: number; height?: number } | null;
      return { w: img?.width ?? 0, h: img?.height ?? 0 };
    },
    // The FIXTURE assertion for probes (INSTRUMENTS.md, GP-142): a pair taken
    // against the 1x1 placeholder is bit-identical by construction and reads
    // as a dead term when it is a dead fetch. width 1024 is "the real map is
    // bound"; width 1 is "still the placeholder".
    texState(): { w: number; h: number } {
      const img = groundTex.value.image as { width?: number; height?: number } | null;
      return { w: img?.width ?? 0, h: img?.height ?? 0 };
    },
    // RN-2265. THE FAR TREELINE, read back rather than assumed. A term whose
    // colour is READ OFF ANOTHER SUBSYSTEM at runtime has one new failure mode
    // -- the publish never fires and the fallback ships -- and that failure is
    // invisible in a frame, because a plausible green is still a green. This
    // is what makes it measurable: `live` false means the canopy material has
    // not been bound yet and the ground is painting the fallback.
    treeline(): {
      amp: number; mottle: number; reachM: number;
      tone: { r: number; g: number; b: number; live: boolean };
    } {
      const v = s.treeline.value;
      return {
        amp: v.x, mottle: v.y, reachM: v.z,
        tone: {
          r: s.treelineTone.value.x, g: s.treelineTone.value.y,
          b: s.treelineTone.value.z, live: canopyToneNow().live,
        },
      };
    },
    ...terrainSplatHandle(s),
  };
}
