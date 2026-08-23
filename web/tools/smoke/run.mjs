// The agent dev loop (ARCHITECTURE.md section 11.2). Drives the running client
// with a real browser, waits for a SETTLED frame, captures a screenshot and
// prints __of.stats() + __of.world() as JSON. Any console.error or pageerror
// fails the run, so a silent shader fallback is a hard failure, not a visual
// one someone has to notice.
//
//   node tools/smoke/run.mjs --scenario=space --out=docs/screenshots/W1.png
//
// --out is relative to the REPO ROOT, not to cwd. A leading '../' escapes the
// project and is refused.
//
// Uses the locally installed Chrome via playwright-core (no browser download).
// The dev server must already be listening; start it with `npm run dev`.

import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const args = new Map();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? '1');
}
const base = args.get('url') ?? 'http://127.0.0.1:5173/';
// A query string inside --url used to be DISCARDED without a word: the runner
// rebuilds the query from its own flags below, so '?sandbox=1' written into
// --url silently ran the other mode, and two lanes have shipped wrong results
// off exactly that. Refuse it loudly instead (BT-24).
{
  const q = base.indexOf('?');
  if (q !== -1) {
    console.error(
      `smoke: --url must not carry a query string. '${base.slice(q)}' would be `
      + `silently discarded, because the runner rebuilds the query from its own `
      + `flags. Pass the flags instead: --url=${base.slice(0, q)} plus e.g. `
      + `--sandbox=1 --scenario=walk --seed=... (any key in the params list).`);
    process.exit(2);
  }
}
const out = args.get('out');
const width = Number(args.get('width') ?? 1600);
const height = Number(args.get('height') ?? 900);
const settleFrames = Number(args.get('settle') ?? 20);
const waitMs = Number(args.get('wait') ?? 0);
// --evalfile is --eval for probes that are too long to live on a command line.
// --evalargs is JSON, exposed to the probe as the global OF_ARGS.
const evalFile = args.get('evalfile');
const evalArgs = args.get('evalargs') ?? '{}';
// GP-982. THE HEARTBEAT. Seconds between progress lines, 0 disables.
// See the block above `beat` further down for why this runner needed one.
const heartbeatS = Number(args.get('heartbeat') ?? 30);
// THE PROBE PRELUDE. `mustNum(obj, 'triangles', where)` returns the field or
// THROWS, naming the keys the object actually publishes. It exists because a
// probe that reads a field the client stopped publishing gets `undefined`, and
// `undefined === undefined` is true: the assertion built on it passes forever
// while asserting nothing. That is not hypothetical. `probes/tunnelpersist.js`
// compared `mesh.faces` across a save and a reload for weeks after the surface
// nets change renamed it to `triangles`, so the one check that proves a dug
// tunnel survives a reload was comparing undefined with undefined and going
// green. Standing rule 11, in its cheapest possible form: make a dead read a
// loud failure instead of a silent pass. A throw here rejects page.evaluate,
// which the runner already reports as a FAILURE with a non-zero exit.
//
// It lives in the runner and not in the probes because run.mjs is the one place
// every probe goes through (survival.mjs, lodsweep.mjs and writeshot.mjs all
// shell out to it), and a guard that has to be pasted into ninety files is a
// guard that will be in eighty-nine of them.
//
// Kept to ONE LINE on purpose so probe line numbers in a stack trace are
// unchanged: the wrapper still occupies exactly the one line it did before.
const PRELUDE = 'globalThis.mustNum=(o,k,w)=>{'
  + 'if(o===null||o===undefined)throw new Error(`probe: cannot read ${w??"?"}.${k}, the object is ${o}`);'
  + 'const v=o[k];'
  + 'if(typeof v!=="number"||!Number.isFinite(v))throw new Error(`probe: ${w??"?"}.${k} is ${JSON.stringify(v)}, not a finite number. Published keys: ${Object.keys(o).join(", ")}`);'
  + 'return v;};'
  + 'globalThis.mustHave=(o,k,w)=>{'
  + 'if(o===null||o===undefined)throw new Error(`probe: cannot read ${w??"?"}.${k}, the object is ${o}`);'
  + 'if(!(k in o))throw new Error(`probe: ${w??"?"}.${k} does not exist. Published keys: ${Object.keys(o).join(", ")}`);'
  + 'return o[k];};';
// The parentheses around the file body are load-bearing: probes start with a
// comment block, and `return` followed by a newline is `return;` under ASI, so
// without them every probe silently resolves to undefined.
const rawScript = evalFile
  ? `((OF_ARGS) => (\n${readFileSync(resolve(process.cwd(), evalFile), 'utf8')}\n))(${evalArgs})`
  : args.get('eval');
const evalScript = rawScript ? `(()=>{${PRELUDE} return (${rawScript});})()` : rawScript;

const params = new URLSearchParams();
// Named so the unknown-flag check below can SUGGEST from it. An error that says
// only "no" is half an error.
const PAGE_PARAMS = ['seed', 'scenario', 'lat', 'lon', 'alt', 'quality', 'depth', 'pool', 'maxdepth',
  'split',
  't', 'gnomon', 'side', 'proxy', 'skirts', 'skirtfrac',
  'mode', 'view', 'stitch', 'rebase', 'walkspeed', 'interp', 'clear', 'zsep',
  'sundot', 'shell', 'fade', 'shadows', 'atmos', 'stars', 'cutoff', 'gameplay',
  // PH-94: `station=0` installs no orbital station. Registered here in the
  // same commit that introduces it, which is what this list's own guard asks
  // for a few lines below.
  'station',
  'props', 'lamp', 'voxelskin', 'voxelnear', 'aimshell', 'levelring', 'density',
  'scatterfair', 'propgrow', 'detail', 'propcull',
  // RN-45 / RN-46. The ground-detail LOD2, the understorey height band, the
  // pond-bed rejection, and the terrain surface art with its three terms and
  // their amplitudes. Standing rule 7: every one of these restores the
  // behaviour immediately before the change that introduced it.
  'proplod2', 'grassshort', 'scatterwet',
  'terrainart', 'macrovar', 'terrainbump', 'strata',
  'macroamp', 'bumpamp', 'strataamp',
  // RN-78, the ground texture (albedo modulation). `groundtex=0` removes the
  // term; `groundtexamp=` sweeps it.
  'groundtex', 'groundtexamp',
  // RN-1257, the per-biome material record. `biomescale=0` writes the
  // pre-RN-1257 frequency partition into every biome (so the three-tap ground
  // blend reproduces the old two-tap one exactly) and `biometint=0` writes a
  // white tint into every biome (so the modulation goes back to pure value).
  // The roughness table has no flag of its own on purpose: `terrainspec=0` is
  // already the exact control for its only consumer.
  'biomescale', 'biometint',
  // RN-1258, the dug voxel face. Three amplitudes, each isolating one half of
  // what the face gained: `voxelgrain=0` the triplanar albedo detail,
  // `voxelbump=0` the analytic relief, `voxelspec=0` the Blinn lobe (at which
  // point the material is diffuse-identical to the Lambert it replaced).
  'voxelgrain', 'voxelbump', 'voxelspec',
  // RN-148, the asymmetric relief bump. `groundrelief=0` removes the term;
  // `groundreliefamp=` sweeps it.
  'groundrelief', 'groundreliefamp',
  // RN-741, the relief bump's gradient. `reliefgrad=0` restores the screen
  // derivative of the sampled height, i.e. the etched squiggles exactly, and
  // is the negative control for the whole fix. It is a hard 0 or 1 and not an
  // amplitude, because what it restores is a defect rather than a level.
  'reliefgrad',
  // RN-842, the horizon occlusion the ambient's sky/ground split is weighted
  // by. `horizonocc=0` is the EXACT pre-RN-842 flat-tangent-plane model, and it
  // also SUPPRESSES the boot measurement, so it is a control over the whole
  // mechanism rather than over one value it produced.
  'horizonocc',
  // RN-841, the bounce source's shadow term. `bouncelit=0` restores the
  // pre-RN-841 expression, in which a fragment's own shadow extinguished the
  // light bouncing off the sunlit ground beside it.
  'bouncelit',
  // RN-843, the support the relief slope is differenced over, in tile units.
  // A sweep rather than an on/off: the shipped 0.0311 is the defect and the
  // question is which value is right, not whether the term should exist.
  'reliefgraduv',
  // RN-961, the ripple direction's peak-to-peak swing across cells, radians.
  // 0 collapses every cell's rotation to the identity and restores the
  // pre-RN-961 sample coordinate exactly, so it is the negative control for
  // the whole term. Registered in the same commit that introduces it.
  'reliefswing',
  // RN-1005, the direction field's two SCALES, promoted out of two `#define`s
  // in the same commit. `reliefcell` is the cell edge in tile units and
  // `reliefcellnoise` is the angle noise's frequency on the cell lattice.
  // Neither has an "off" value: `reliefswing=0` is the control for the whole
  // mechanism and a second one would be a second way to say the same state.
  // Registered in the same commit that introduces them, per this list's rule.
  'reliefcell', 'reliefcellnoise',
  // RN-1855, the two footprint fades' wavelengths in metres. The shipped
  // values are DERIVED from the octave count and the tile fraction; passing
  // the pre-RN-1855 `artfinem=4.2` and `relieffinem=0.45` restores the picture
  // that shipped between WG-186 and this lane, which is the before half of
  // every canonical-shot re-take this correction owes. Registered in the same
  // commit that introduces them, per this list's rule.
  'artfinem', 'relieffinem',
  // RN-731, the per-part material channel on the rock and ore node batches.
  // `rockmat=0` removes the hook entirely and restores the stock three
  // program, i.e. every ore seam back at one roughness and one metalness.
  'rockmat',
  // RN-1200, the same per-part channel on the MACHINE batch, which is the
  // factory, the structures, the launch pad, the belt cargo and the space
  // station. Three values, not two, and the middle one is the point:
  // `machinemat=0` bakes and injects nothing (the pre-change program exactly),
  // `machinemat=flat` runs the WHOLE path with every part baked at the batch's
  // own base so the shader arithmetic is an identity, and absent is the shipped
  // default. `=flat` is the positive control that says the plumbing ran, so a
  // null result under `=1` can be told apart from a dead injection.
  // `machinebare=0` isolates the second half (the `flat`-family roles drawing
  // as non-members instead of wearing `panel`'s rivets) from the first.
  // Registered in the same commit that introduces them, per this list's rule.
  'machinemat', 'machinebare',
  // RN-731, the terrain SPECULAR lobe. `terrainspec=0` restores the pure
  // Lambert ground exactly, which is what the terrain had from W3 until this
  // pass: albedo times irradiance, no specular term and no roughness input
  // anywhere in the material. The two halves isolate separately because they
  // fail differently, `terrainspecsun=0` leaving the grazing sky reflection
  // and `terrainspecsky=0` leaving the sun highlight; the two amp flags sweep
  // them.
  'terrainspec', 'terrainspecsun', 'terrainspecsky',
  'terrainspecamp', 'terrainspecskyamp',
  // RN-1733, the near-field analytic detail layer. `groundfine=0` restores the
  // pre-RN-1733 ground exactly and is the BEFORE half of every pair this term
  // is judged by, one flag apart on one build under one light;
  // `groundfinebump=0` and `groundfinealb=0` isolate the normal half from the
  // albedo half, which is the split that matters because they fail differently
  // (too much bump reads as gravel, too much albedo as speckle).
  // `groundfinebumpamp=` and `groundfinealbamp=` sweep them, and
  // `groundfinefreq=a,r,b` / `groundfinew=a,r,b` sweep the three repeats and
  // the three height weights. Registered in the same commit that introduces
  // them, per this list's own rule.
  'groundfine', 'groundfinebump', 'groundfinealb',
  'groundfinebumpamp', 'groundfinealbamp', 'groundfinefreq', 'groundfinew',
  // RN-1735, the per-biome luminance weight on that layer. `groundfinelum=0`
  // restores the flat amplitude across every biome exactly, which is the
  // control that makes the rule falsifiable rather than assumed.
  'groundfinelum',
  // RN-1900, the MID-FIELD layer, the ninth surface-art term. `groundmid=0`
  // restores the pre-RN-1900 ground exactly and is the BEFORE half of every
  // pair this term is judged by; `groundmidamp=` sweeps its amplitude,
  // `groundmidm=12.4,4.7` its two wavelengths IN METRES (its coordinate is
  // planet-centred metres, so unlike every repeat count in this material these
  // are not secretly a function of maxDepth), and `groundmidlum=0` restores the
  // flat amplitude across every biome so RN-1735's luminance rule is falsifiable
  // on this term rather than inherited on faith.
  // `artcoarsem=` is the vnoise bump's COARSE octave's fade wavelength; setting
  // it to 2.0664, i.e. equal to the fine one, is the pre-RN-1900 single-fade
  // bump and is that half of the lane's negative control.
  // Registered in the same commit that introduces them, per this list's own
  // rule and RN-152's scar.
  'groundmid', 'groundmidamp', 'groundmidm', 'groundmidlum', 'artcoarsem',
  // RN-2160, the near-field SPLAT: six PBR material layers blended by slope,
  // altitude and biome. `splat=0` removes all three of its halves at once and
  // is the ONE FLAG every before/after in that lane is taken one apart on;
  // `splatval=`, `splatchroma=` and `splatnrm=` sweep them separately, because
  // an albedo that is too strong, a hue that is a restyle and a normal that
  // lights the ground like something it is not are three different failures
  // and one switch could not tell them apart. `splatfade=a,b,c,d` moves the
  // two fade bands, which is what makes the convergence claim (the layers
  // reach the palette exactly by 75 m) falsifiable rather than asserted.
  // Registered in the same commit that introduces them, per this list's own
  // rule and RN-152's scar.
  'splat', 'splatval', 'splatchroma', 'splatnrm', 'splatfade',
  // RN-2195, phase 1.5, the far-field cover convergence that hands off from
  // the splat's own chroma term at its own 35-75 m boundary. `splatfar=0` is
  // its own whole-term isolator, separate from `splat=0` and `splatchroma=`
  // for the same reason those three are separate from each other: it fails
  // in a way none of the near-field terms can (greening ground that should
  // stay khaki, or leaving the carpet's own fade unmet). `splatfaramp=`
  // sweeps it. Registered in the same commit that introduces them, per this
  // list's own rule and RN-152's scar.
  'splatfar', 'splatfaramp',
  // RN-2265. THE FAR TREELINE, the terrain material's canopy read past the
  // impostor tier's realised reach. `treeline=0` is the exact pre-RN-2265
  // ground and is the negative control every proof in that lane is taken
  // against; `treelineamp=` scales the coverage, `treelinemottle=` the
  // 34 m crown-scale value break-up inside it.
  'treeline', 'treelineamp', 'treelinemottle',
  // RN-2560. `treelinepaint=1` paints the far treeline's own STAGE (which
  // program drew the fragment, whether the outer gate passed, whether the
  // Beer-Lambert term was evaluated, whether it returned coverage) and
  // `treelinepaint=2` paints the coverage itself. Registered in the same
  // commit that introduces it, which is what this list's own guard asks for.
  'treelinepaint',
  // RN-2560. `treelinefar=1` lets the SCALED terrain program run the far
  // treeline, which a `#ifndef OF_SCALED` had removed it from since RN-2265.
  // Registered in the same commit that introduces it.
  'treelinefar',
  // RN-2661. `treelinefloor=0` restores the pre-RN-2661 frame: the ground the
  // view ray reaches BETWEEN the far crowns, lit as if it were a clearing.
  // The shipped 1 shades it with the same `ofCrownSelfShade` the crowns take,
  // on the density the instances are not placing. Registered in the same
  // commit that introduces it.
  'treelinefloor',
  // RN-2661. `treelinefloorlaw=1` runs that shade on the LEAF-AREA depth K*mu
  // (the crown half's homogeneous model) instead of the shipped crown PLAN
  // index (the geometry the term's own view ray already uses). Registered in
  // the same commit that introduces it.
  'treelinefloorlaw',
  // RN-2665. `treelinestand=0` restores the pre-RN-2665 far canopy density: no
  // stand-scale modulation of the density the instance tier is not placing.
  // The shipped 1 re-imposes world-gen's own `dense(standAt)` factor at
  // STAND_M, which the terrain mesh has averaged away by 2,630 m of eye
  // distance. Registered in the same commit that introduces it.
  'treelinestand',
  // RN-2665. `treelinegrove=0` removes the SECOND of world-gen's two averaged-
  // away density factors, the 760 m landscape one. Separate from
  // `treelinestand` because the two retire at different ranges and the finding
  // that produced this one is that the stand octave reaches 4.3 km of a
  // 15.5 km band. Registered in the same commit that introduces it.
  'treelinegrove',
  // RN-2275. Inter-crown self-shadowing: the exact off control, and the two
  // numbers the law is chosen on. Registered in the commit that introduces
  // them (RN-152's scar).
  //
  // RN-2661 WIDENED WHAT `crownshade=0` TURNS OFF AND IT IS REGISTERED HERE
  // RATHER THAN DISCOVERED LATER. That flag zeroes `uCrownShade.x`, the amp
  // the law mixes from 1.0 with, and RN-2661's wood-floor shade calls the SAME
  // `ofCrownSelfShade`. So `?crownshade=0` now ALSO disables the far paint's
  // floor shade, silently, and an arm taken with it is no longer "the crowns
  // unshaded with everything else held". The isolated control for the floor
  // term alone is `?treelinefloor=0`; for the crown terms alone with the floor
  // held, pair `?crownshade=0` with nothing (there is no separate crown amp)
  // and read the difference against `?crownshade=0&treelinefloor=0`.
  'crownshade', 'crownshadeamp', 'crownshadek', 'crownshadefloor',
  // RN-2645. WHICH TRANSMITTANCE THE SHADE LAW TAKES. `crownshadelaw=0` is the
  // layer BASE's `exp(-tau/sinSun)`, the pre-RN-2645 frame; `=1` is the layer
  // MEAN's `(sinSun/tau)(1 - exp(-tau/sinSun))`, which is the canopy SUNLIT
  // FRACTION and the quantity a whole-crown impostor actually needs. Read at
  // module scope and interpolated into the terrain's GLSL, so it needs a page
  // load and has no runtime pair. Registered in the commit that introduces it
  // (RN-152's scar). See CrownSkyView.ts for the derivation and the anchor.
  'crownshadelaw',
  // RN-2645. THE CARD HALF'S OWN FLOOR. The far paint keeps 0.08; the crown
  // CARD's floor drops the sky-view factor `CROWN_SELF_FLOOR`'s arithmetic
  // guessed at 0.55, because this lane applies the DERIVED sky-view factor to
  // the card's own sky (its `envMap`) and the paint has no such term. The two
  // halves therefore occlude the same hemisphere ONCE EACH, in the place each
  // one's sky lives. `crowncardfloor=0.08` is the exact pre-lane card, and
  // `crownshadefloor=` still sets BOTH halves and takes precedence, so every
  // arm an earlier lane recorded still means what it meant. Registered in the
  // commit that introduces it (RN-152's scar).
  'crowncardfloor',
  // RN-2645. THE CROWN'S ENVIRONMENT TERM, and the first LIVE handle on it.
  // `crownenv=off` leaves the material inside `WebGLRenderer.js:2694-2696`'s
  // overwrite branch (the pre-lane state and the COST arm); `=1` installs the
  // own `envMap` and forces intensity 1, which must reproduce `off` to the
  // digit and is therefore the proof that the install is not itself a look
  // change; `=0` is the DELETING control and its move is this handle's whole
  // authority; absent is the derived `crownSkyView(K * mu)`. Readable back at
  // `treeline().crownEnv`, where `appliedLive` is read AFTER the draw and is
  // an OUTCOME readback rather than RN-2590's request one.
  'crownenv',
  // WG-230. The world-locked phase PROBE. The shipped amplitude is 0, so the
  // usual polarity is inverted here: `phaseamp=1` is the ON arm that paints the
  // 2 m checker proving the attribute reaches the shader, and the DEFAULT is
  // the exact pre-lane ground. Registered in the commit that introduces it
  // (RN-152's scar).
  'phaseamp', 'phaserep',
  // RN-2340. THE FAR GROUND, WG-230's first consumer: the world-locked mid
  // (32 m) and horizon (128 m) rungs of the splat, the sub-massif curvature
  // term and the range-aware biome-boundary break. `horizon=0` is the exact
  // pre-RN-2340 ground and is the negative control every proof in this lane is
  // taken against; the four per-term flags exist because the four fail
  // differently (noise, restyle, corrugated iron, outlined ridges) and one
  // switch could not tell them apart. `horizoneco=0` isolates the boundary
  // break, which fails in a fifth way none of them can (dissolving a coastline
  // that is meant to be sharp). Registered in the same commit that introduces
  // them, per this list's own rule and RN-152's scar.
  'horizon', 'horizonval', 'horizonchroma', 'horizonnrm', 'horizonao',
  'horizoneco', 'horizonecoamp',
  // RN-2421. THE CELL GUARD and its analytic stand-in. `horizoncell=0` is the
  // exact pre-RN-2421 rung (both halves off in one flag, because a guard
  // without its replacement is a state the material has never been in and is
  // not a before), and `horizoncellan=` sweeps the stand-in alone for the
  // question that IS separate: whether the replacement is too strong.
  // Registered in the same commit that introduces them, per this list's own
  // rule and RN-152's scar.
  'horizoncell', 'horizoncellan',
  // RN-2475. THE PLAINS MACRO GAIN, one multiply on the analytic stand-in's
  // amplitude: `1 + HORIZON_AN_PLAINS_GAIN * (1 - hzMsfBand)`, i.e. the macro
  // headroom the massif's own relief gate is withholding, handed over on that
  // gate's OWN complement so a relieved pose is bit-identical by construction.
  // (CORRECTED at RN-2510: this note used to describe a FAR MACRO PAIR, "the
  // stand-in's 640 m and 2560 m octaves". That design was built, swept at 20x,
  // measured at 0.00 counts and thrown away -- rendering.md 2.30.6 -- and what
  // shipped is the one multiply above. The same stale sentence was in
  // TerrainFragPars.glsl.ts and TerrainAmpQuery.ts and is corrected in all
  // three.)
  // `horizonplains=0` is the exact pre-RN-2475 frame with the cell guard and the
  // stand-in both still ARMED, which is what `horizoncell=0` cannot be: that
  // flag zeroes the guard and the stand-in together on purpose, so it is the
  // before of RN-2421 and not of this. Registered in the same commit that
  // introduces the term, per this list's own rule and RN-152's scar.
  'horizonplains',
  // WG-275, THE LOWLAND SWELL, and it is the only flag in this list that
  // switches the HEIGHT FIELD rather than a material. `horizonswell=0` is the
  // exact pre-WG-275 planet: the term is removed inside
  // `sampleHeightFieldPlanet`, so the ground, the collision, the biomes and
  // every scatter hash that reads the one oracle all go back together, and the
  // arm's own fixture is that every plains rectangle returns to its pre-swell
  // reading. Values between sweep the amplitude (1 = shipped 0.050), which is
  // how the re-baseline ladder was taken from ONE binary in ONE session rather
  // than from a second build (NUMBERS.md, "AN ARM TABLE'S HEADER NAMES ONE
  // BUILD"). Registered in the same commit that introduces the term.
  //
  // ABSENT is not 0 and not 1: the client resolves a missing flag to
  // `undefined` and never calls into /core, so the shipped amplitude has one
  // home and `Number(null)` cannot ship the planet flat (RN-150).
  'horizonswell',
  // RN-2512's `coverstand` family was registered here and is REMOVED again in
  // the same lane: the term it switched -- the mid field's material ground
  // cover -- was built, measured and refused on its own numbers (rendering.md
  // 2.31). A registered flag whose term does not exist is worse than a missing
  // one, which is RN-150's dead-default rule in its other direction. The
  // implementation is in this branch's own history at RN-2511 to RN-2515 if a
  // later lane wants it.
  // RN-2422. THE GROUND's half of RN-2385's emissive irradiance.
  // `firelightground=0` keeps every program and every machine surface as M3
  // shipped them and zeroes the TERRAIN's take alone, which is what makes the
  // night-ground pair one flag apart on one build. `firelight=0` remains the
  // control over the WHOLE model. Registered in the same commit that
  // introduces it, per this list's own rule.
  'firelightground',
  // RN-2340, the MASSIF term: two kilometre-scale octaves on pM that carry the
  // band past where a 256 m-period texture rung can reach. NOT nested under
  // `horizon=0`, deliberately: it is a different mechanism on a different
  // coordinate answering a different range band, and the four-arm measurement
  // that forced it into existence was taken by isolating the other one.
  'horizonmassif', 'horizonmassifval', 'horizonmassifbump', 'horizonmassifm',
  'horizonmassiffade',
  'crownshadefar', 'crownshadecard',
  // RN-2525. THE SPECTRAL SPLIT of RN-2275's self-shadow scalar: a per-channel
  // attenuation derived from FoliageTone.ts's leaf optics in place of one
  // achromatic multiply, applied to both halves through the shared
  // CanopySelfShadow/SurfaceBind seam. `crownspectral=0` sets every channel's
  // exponent to 1 and is the exact pre-lane achromatic frame (the pin makes
  // this an algebraic identity, not a second code path). Registered in the
  // commit that introduces it, per this list's own rule and RN-152's scar.
  'crownspectral',
  // RN-152, the starlight floor. `starlight=0` removes it (the PH-86 black
  // night exactly); `starlightamp=` sweeps it.
  // RN-952, the DAYLIGHT floor underneath it, which had no control at all and
  // is therefore the term four experiments could not reach: `starlight=0`
  // removes only the term above it. `terrainfloor=0` removes this one and
  // `terrainfloor=` sweeps it, so the two halves of the constant ambient on an
  // airless night are separable. Registered in the same commit that introduces
  // it, per this list's own rule.
  'starlight', 'starlightamp', 'terrainfloor',
  // RN-2130, FIDELITY LANE A1, the image pipeline. Five flags, each restoring
  // the state immediately before the term it names, registered in the same
  // commit that introduces them per this list's rule.
  // `tone=0`      the elevation-driven exposure, the highlight shoulder, the
  //               dawn warmth and the occlusion tint all become no-ops and the
  //               composite runs at the fixed 1.2 it ran at before.
  // `ambientfill=0` restores BOTH halves of the shadow fill in one flag: the
  //               pre-A1 daylight floor (0.030, 0.034, 0.045) and the pre-A1
  //               sky-ambient weight 0.32. They are one control on purpose,
  //               because a term whose two halves have two switches has an off
  //               state that is an argument rather than a measurement.
  // `occtint=0`   the AO multiply goes back to a neutral grey, i.e. the three
  //               channels occluded by the same amount, which is algebraically
  //               the pre-A1 apply pass.
  // `shoulderamp=` sweeps the shoulder without touching the exposure drive.
  // `greenpull=`  sweeps the green harmonisation; 0 is the exact off state.
  'tone', 'ambientfill', 'occtint', 'shoulderamp', 'greenpull',
  // RN-1251, the same floor for the STOCK materials, which had their own two
  // W4 hex literals instead. Three values and the middle one is the point, on
  // RN-1201's precedent: `stockfloor=0` does not install the writer at all and
  // is the pre-change frame exactly, `stockfloor=legacy` runs the whole writer
  // and returns the two literals so the frame must come back identical, and a
  // number sweeps the shipped floor. Registered in the same commit that
  // introduces it, per this list's rule.
  'stockfloor',
  // RN-953. `tile=suitplate:0.12` overrides a surface family's tile_m, so the
  // tile-size question can be swept in the running client instead of by
  // regenerating eight PNGs. Comma-separated for several families at once.
  // Registered in the same commit that introduces it, per this list's rule.
  'tile',
  // RN-181, the foliage albedo cards. `leaftex=0` boots with the card maps
  // and their alpha test off: the pre-texture flora exactly.
  'leaftex',
  // RN-345, the foliage tone. `foliagetone=0` is the pre-RN-345 palette exactly
  // and is the negative control for the whole foliage colour correction; any
  // value between sweeps it, and the SHIPPED default is 1 whether or not this
  // flag is passed, which is the half RN-150 says must be asserted separately.
  'foliagetone',
  // RN-2495, the CANOPY-ONLY saturation of that same tone (FoliageTone.ts's own
  // `canopy` row, which no longer copies `leaf`'s digit). `canopysat=0.62` is
  // the pre-RN-2495 build exactly and is the one-flag-apart control for the
  // aerial crown chroma; any value sweeps it. It defaults to the shipped row
  // whether or not it is passed, which is the half RN-150 says must be
  // asserted separately.
  'canopysat',
  // RN-2570, the crown impostor's ROUGHNESS, which had no switch of any kind
  // before this lane: `terrainspec` is the terrain's and reaches no prop, and
  // the value came straight off the glTF (0.800, read live). It is an
  // OVERRIDE, not a default -- absent, nothing is written and the asset's own
  // value stands, so the shipped frame is unchanged by construction.
  // `canopyrough=1.0` is the fully-rough arm this lane built, measured and
  // REFUSED (it moves the card's specular -1.6 / +2.0 per cent at the two
  // binding poses). Readable back live off `__ofSurfaces.report()`'s
  // `roughness` beside `treeline().self.roughOverride`, which is the
  // request-against-outcome pair RN-2268 asks for. Registered in the same
  // commit that introduces it.
  'canopyrough',
  // RN-2590, the crown impostor's `envMapIntensity`, routed to this lane by
  // 2.38.7 as a REQUIRED isolator. An OVERRIDE like `canopyrough`: absent,
  // nothing is written. **IT IS A DEAD SWITCH AND MOVES NOTHING, corrected
  // 2026-08-22:** `WebGLRenderer.js:2694-2696` overwrites the uniform from
  // `scene.environmentIntensity` every frame while the material has no own
  // `envMap` and `SkyIbl.ts:133`'s environment is set, so a sweep of it
  // measures exactly 0.000000 for a reason that has nothing to do with the
  // term's size. The environment is 37.48 per cent of the `crowns` rectangle
  // (`?ibldiag=noenv`), so 2.38.4's PMREM reading STANDS. The live handle is
  // `scene.environmentIntensity`. Registered and kept because the
  // request/outcome pair is what made the overwrite findable; see
  // rendering.md 2.39.10 before quoting it as an amplitude.
  'canopyenv',
  // RN-2590, the CROWN IMPOSTOR's shading normal, three switches for three
  // separable terms (RN-952). `crownnormal=0` routes the crown card back
  // through RN-1766's `bendNormals` and is the exact pre-lane control, tear
  // and all. `crownflank=<deg>` is the angle from UP the shading normal takes
  // at the crown's widest rim, and `crownflank=90` puts the dome anchor back
  // at the base (RN-1766's anchor) so it isolates the SIGN fix on its own.
  // `crowncard=<0..1>` is the out-of-plane mix with the card's own normal, so
  // `crowncard=0` restores the coplanarity degeneracy and isolates that fix on
  // its own. All three are read at REGISTRATION, like `foliagenormal`, so they
  // need a page load and cannot have a runtime pair; all three are readable
  // back against what the bake WROTE at `treeline().crownNormal`.
  'crownnormal', 'crownflank', 'crowncard',
  // RN-2605, the THIRD degeneracy: `OF_Canopy` is `doubleSided` and three
  // negates the WHOLE shading normal on a back face, so about half of every
  // stand's drawn card area takes RN-2590's dome normal upside down. FOUR
  // STATES, on `?propsky=`'s precedent, because the term adds both a VALUE and
  // a per-fragment COST and one flag cannot separate them:
  //   `off` the splice is NOT INSTALLED (the pre-RN-2605 programs exactly, and
  //         the arm the COST is measured against)
  //   `0`   installed and inert (same program, one uniform apart, and the arm
  //         the VALUE is measured against)
  //   `1`   SHIPPED, `UNNEGATE`: the back face keeps the normal the bake wrote,
  //         which is also rendering.md 2.39.12 item 1's reversed-winding plus
  //         `FrontSide` candidate's pixel, priced without building the geometry
  //   `2`   `UPFOLD`, the refused candidate: three's negation kept and the
  //         result reflected in the tree's own horizontal plane, so the azimuth
  //         turns toward the viewer. Measured worse on the pose spread of the
  //         crown's own unspecular diffuse (3.90x against 2.46x); kept
  //         reachable so the refusal can be re-judged
  // Read at PROGRAM COMPILE, so it needs a page load and has no runtime pair.
  // Readable back at `treeline().crownFace` as the live uniform value, the
  // spliced PROGRAM count, the anchor misses and the material scope.
  'crownface',
  // RN-47, the underwater view. `underwater=0` removes the pass; the other
  // four tune extinction, tint, scatter and the path clamp.
  'underwater', 'uwext', 'uwtint', 'uwscatter', 'uwpath',
  // RN-51 to RN-58, the water look. `water=0` removes the surface entirely so a
  // frame with no pond in it is reachable; the four term flags isolate one of
  // ripples, glint, refraction and foam each, and `wetsand` is the terrain-side
  // half of the shoreline. The four `*amp` flags sweep rather than switch.
  'water', 'waterripple', 'waterglint', 'waterrefract', 'waterfoam',
  'rippleamp', 'glintamp', 'refractamp', 'foamamp',
  'wetsand', 'wetsandamp',
  // RN-64. `iblground=0` removes the ground half of the environment map, which
  // is the whole of that fix in one flag: with it off every stock material is
  // lit from below by the sky model marched through the planet, i.e. by nothing.
  'iblground', 'iblgroundamp',
  // RN-1415 and RN-1420, standing rule 7 and both TRI-STATE. `iblsize=64`
  // restores the PMREM cube side every tier shipped with before the art
  // campaign; `shadowsoft=0` restores THREE.PCFShadowMap. Absent means "the
  // quality tier decides", which is a third state and not `false`.
  'iblsize', 'shadowsoft',
  // RN-1954. `shadowcast=0` clears `castShadow` on every cascade and CHANGES
  // NOTHING ELSE. `shadows=0` is not that control: it also drops cascades 1 and
  // 2 as light sources, so a pair across it differs by the maps and by two
  // thirds of the sun rig at once. Registered in the same commit that adds it,
  // which is what this list's own guard asks for.
  'shadowcast',
  // RN-1520 to RN-1524, standing rule 7, both TRI-STATE. `ibldiag=1` publishes
  // the environment-radiance instrument and changes no pixel; `ibldiag=mirror`
  // makes every machine a mirror so the environment is displayed rather than
  // inferred. `ibldisc=` multiplies the sun disc's radiance FOR THE IBL CAPTURE
  // ONLY. Absent means "the shipped build", which is a third state and not 0.
  'ibldiag', 'ibldisc',
  'vab', 'flight',
  // The post-processing stack (render/post/PostConfig.ts). `post` is the master
  // switch and restores the pre-stack path exactly; the other four isolate one
  // effect each, per standing rule 7.
  'post', 'ao', 'bloom', 'grade', 'aa', 'contact',
  'aoscale', 'aoslices', 'aosteps', 'aoradius', 'aostrength', 'aopower',
  // RN-2190, thin-geometry AO damping. `aothin=0` is the isolator.
  'aothin', 'aothinedge', 'aothinamount', 'aothinnear', 'aothinfar',
  // RN-2220, thin-geometry contact-shadow damping, AoGlsl's pattern reused
  // with its own tunable. `csthin=0` is the isolator.
  'csthin', 'csthinedge', 'csthinamount', 'csthinnear', 'csthinfar',
  'bloomlevels', 'bloomstrength', 'bloomthresh', 'exposure', 'msaa', 'fxaalod',
  'cslength', 'cssteps', 'csthick', 'csstrength',
  // RN-207, the look-development grade. `curve=0` returns the contrast term to
  // the RN-10 straight line, which is the negative control for the whole
  // response-curve change; the other four sweep the grade from a URL instead of
  // only from `of.setPostTune`, so a build can BOOT in a stated grade and the
  // shipped default can be asserted as the fixture it is (RN-150).
  'curve', 'contrast', 'saturation', 'lift', 'vignette',
  // DW-31. Unlike every other entry here this is not an isolation switch: it
  // selects a game MODE, and the world it makes saves to its own slot.
  'sandbox',
  // FS-78, standing rule 7. `rescale=0` loads a world built when the machines
  // were smaller WITHOUT re-spacing it, so the defect the migration exists to
  // remove can be measured rather than asserted. `probes/rescale.js` is its
  // negative control and prints the same fields with and without it.
  'rescale',
  // GP-79 / GP-82. Also not an isolation switch: it turns DANGER back on inside
  // sandbox, which DW-31 leaves off by default so a designer testing a rocket is
  // not fighting while they do it. Ignored in survival, which is always hostile.
  'combat',
  // WG-59, standing rule 7. `canopy=0` removes the forest and `canopyshade=0`
  // stops it thinning the understorey underneath it, so the trees and the
  // ground cover they shade are two costs that can be read apart in ONE
  // binary. A distance rather than a flag, so the same control sweeps the
  // cost, which goes as its square.
  'canopy', 'canopyshade',
  // WG-260, standing rule 7. `midhole=0` removes the 170-to-690 m mid tier and
  // restores the hole that stood between the biome-prop ring's hard edge and
  // the impostor tier's 550 m start. Structural rather than a density of zero:
  // the sampler never enters the draw, so the off arm is the pre-WG-260 world
  // and every arm in the lane's table is one page param from the SHIPPED build
  // (the one-session arm-table trap, NUMBERS.md 2026-08-21).
  // `midedge=0` restores the biome-prop ring's own hard boolean edge at 170 m,
  // the second half of the same lane, on its own flag so the mid tier's new
  // silhouettes and the ring's softened edge can be attributed apart.
  'midhole', 'midedge',
  // WG-295 / WG-301, standing rule 7. Three flags, one per finding, so R5
  // rank 1's reach half and its cap half can never be attributed to each
  // other in a reading.
  //   `canopytail=` is the coarse tail's multiple of the cover reach and
  //     `canopytail=1` is its STRUCTURAL off (the sampler's tail branch is
  //     never entered), so the before picture is one page param away on the
  //     shipped build. It sweeps, because the tail's cost is
  //     `EDGE_W r0^2 (1 - 1/mult)` and the shipping value is the widest the
  //     frame and the canopy pool hold.
  //   `capfair=0` restores MAX_PER_CHUNK's raster-order first-N truncation,
  //     which is what makes the density-aware cap measurable rather than
  //     asserted: the delivery ratio reads 1.0008 in both arms and only
  //     `capCellFrac` tells them apart.
  //   `canopymaxcell=` overrides RN-2230's coarsest admissible canopy cell,
  //     so the chunk-LOD ceiling on the reach is a ladder and not a claim.
  'canopytail', 'capfair', 'canopymaxcell',
  // WG-67, standing rule 7. `rocks=0` places NO world rocks, which is the
  // one-binary control for the whole rock-node pass; `rockdensity=` scales
  // every biome's rock ask together for the cost ladder.
  'rocks', 'rockdensity',
  // WG-116, standing rule 7. `trees=0` places NO world trees, which is the
  // one-binary control for the whole tree-node pass; `treedensity=` scales
  // every biome's tree ask together for the cost ladder, and `trees=<metres>`
  // sweeps the ring radius, which is the number the pass is judged on.
  'trees', 'treedensity',
  // WG-118, standing rule 7. `nodelod=0` draws every harvest node at LOD0 at
  // all ranges (the state before the batch loaded its own `_LOD1`/`_LOD2`);
  // `nodecull=0` turns per-instance frustum culling off. Two claims, two flags.
  'nodelod', 'nodecull',
  // WG-91 / WG-94, standing rule 7. `spires=0` drops rock_spire.glb from the
  // node art AND from the download set, so Mountains rocks are all boulders
  // exactly as before; `forestdetail=0` puts Forest's understorey back on the
  // shared GROUND_DETAIL meadow mix. One binary, one flag each.
  'spires', 'forestdetail',
  // WG-286, standing rule 7. `beachcanopy=0` puts the Beach biome back on the
  // EMPTY canopy table it shipped with, so `BIOME_CANOPY_MU[1]` is 0 again and
  // the far treeline's outer gate refuses across the coastal flat exactly as
  // it did when that band was 12.15 per cent of `forestair`'s terrain pixels.
  'beachcanopy',
  // RN-97, standing rule 7. `wind=0` removes the foliage wind hook entirely,
  // so the program set is stock and the build is the static one (the negative
  // control); `windamp=` sweeps the amplitude in place, and `windamp=0` keeps
  // the hooked program at exactly zero displacement, which is what separates
  // "the hook costs" from "the motion costs".
  'wind', 'windamp',
  // RN-2145, THE GROUND-COVER CARPET, registered in the same commit that
  // introduces the flags because this list's own rule a hundred lines down says
  // an unregistered flag is a vacuous green and has produced three of them.
  //
  // `grass=0` REMOVES THE LAYER: nothing is constructed, no geometry, no
  // material, no draw, so the off arm is bit-exact with the pre-carpet build
  // (?wind=0's shape, standing rule 7). It is NOT the same control as
  // `grassdens=0`, which leaves the layer constructed and empty and therefore
  // measures the cost of an empty pass; both exist because they answer
  // different questions.
  // `grasstint=0` makes every blade exactly the ground colour with no chroma
  // rotation, which isolates "is the greening doing this" from "is the cover
  // doing this". `grasstrans=0` removes the wrap and forward-scatter terms.
  // `grasspx=` and `grassfade=` move the fade window, which is in PIXELS of
  // apparent card height and not in metres; see GrassTuning's note on why.
  'grass', 'grassdens', 'grasstint', 'grasspx', 'grassfade',
  'grasstrans', 'grasstransamp', 'grasssharp', 'grassval',
  'grasslean', 'grassramp', 'grassdry',
  // RN-2410 to RN-2419, world audit R3 lane M4. `grasspatch=0` isolates the
  // mat rung's per-patch value multiplier (GrassTuning.MAT_PATCH_AMP): the
  // control for "is the variance this term or the pre-existing per-instance
  // jitter".
  'grasspatch',
  // RN-2220, standing rule 7. `grassbend=0` is the exact pre-RN-2220 control
  // for the blade-normal shading bend (GrassGlsl's `ns`, the second,
  // independent blend toward up spent only on ndl/skyView).
  'grassbend',
  // RN-2201, standing rule 7, and the FIRST arm is the one that matters. A1
  // measured that the sky-ambient weight which lights the terrain reaches no
  // scatter prop at all ("two counts of fourteen"); PropSkyAmbient splices the
  // terrain's own `ofAtmoScatter(...) * uSkyAmbient` into the stock prop and
  // node programs from the SAME shared uniform objects. `propsky=0` computes
  // the term and multiplies it by zero, so the PROGRAM is identical across the
  // pair and only the value differs -- which is what makes the before/after a
  // measurement of the term rather than of two different shaders. A number
  // sweeps it.
  'propsky',
  // RN-2205, standing rule 7. The foliage translucency approximation, the
  // charter's difference 5 ("no translucency approximation"), using A2's own
  // wrap-plus-forward-lobe model and A2's own two constants so the carpet and
  // the props glow into a low sun by the same amount. `foliagetrans=0` zeroes
  // the gain with the program unchanged, so the pair is a value control.
  'foliagetrans',
  // RN-2232. Aerial perspective on the props, the terrain's own two calls
  // spliced onto the final colour at `<fog_fragment>`. `prophaze=0` is the
  // value control (same program, term multiplied by zero) and it is the arm
  // that shows why a distant instanced forest without it reads as pepper.
  'prophaze',
  // RN-2540, and the first two are RN-952's lesson applied: the TERRAIN's copy
  // of that same aerial-perspective pair had no isolator at all, only the
  // global `atmos=0` that deletes the sky with it, so the half of every crown
  // rectangle that the far treeline PAINT draws could be neither charged nor
  // exonerated for the blue four audits photographed. `terrainhaze=0` is the
  // value control (one uniform, same program, `mix` at 1 is the identity);
  // `terrainpaint=1` and `proppaint=1` zero the SOURCE radiance before the two
  // calls so the fragment renders the additive floor ALONE, which an amplitude
  // cannot do because it moves `col*T` and `Lin` together. See
  // `src/render/materials/AerialDiag.ts`.
  'terrainhaze', 'terrainpaint', 'proppaint',
  // RN-2540. `propspec=0` removes three's `totalSpecular` from every prop
  // program (both lobes: the sun's and the sky PMREM's). It is the OTHER
  // radiance on a canopy card that is not multiplied by the albedo, and it had
  // no control of any kind before this lane -- `?terrainspec=` is the terrain's
  // and reaches no prop, and `envMapIntensity` has no page parameter anywhere.
  'propspec',
  // RN-2635. The biome-id paint arm (src/render/materials/BiomeIdPaint.ts):
  // `biomeid=1` renders ONLY a fixed, saturated debug colour keyed on the
  // terrain's raw classifier index, replacing `lit` after aerial perspective
  // so the reading survives the ~92 per cent additive floor at range. Proves
  // WHICH biome class a rectangle actually is before any BiomePalette.ts row
  // is touched. Registered in the same commit that introduces it, per this
  // list's own rule.
  'biomeid',
  // RN-2385, standing rule 7, and TWO flags because the change makes two
  // claims. World audit R3's rank 3: a running furnace at night put its own
  // frame BELOW an empty meadow, because every emissive in the game was a
  // self-illuminated albedo constant that reached nothing. `firelight=off`
  // removes the irradiance splice entirely (the pre-RN-2385 programs exactly,
  // which is what the per-fragment cost is measured against), `firelight=0`
  // keeps the program and multiplies the term by zero (the value control), and
  // a number sweeps it. `fireglow=` is the separate scale on the FIRE's own
  // radiance, i.e. how bright it looks rather than what it lights, so an audit
  // that finds one right and the other wrong can say which.
  'firelight', 'fireglow',

  // RN-2204, standing rule 7. `propcullbiome=0` narrows per-instance frustum
  // culling back to the understorey batches, which is the pre-widening build
  // exactly, so it is the control for the 344,118-triangle drop. `propcull=0`
  // still removes it from both layers and is the older, wider control.
  'propcullbiome',
  // RN-102, standing rule 7. `leafvar=0` bakes the flat greyscale vertex
  // colour, i.e. the pre-RN-102 bytes exactly; the runtime pair lives on
  // `__ofProps.setLeafVar` because a reload cannot hold the frame equal.
  'leafvar',
  // RN-1766, standing rule 7. `foliagenormal=<0..1>` sets how far a prop's
  // foliage normals are bent outward from the part's own base centre;
  // `foliagenormal=0` is the pre-change bytes exactly and is the negative
  // control for every claim about the understorey's shading. It is read at
  // REGISTRATION (Boot loads the atlases once), so it needs a page load and
  // cannot have a runtime pair.
  'foliagenormal',
  // RN-121, standing rule 7. `anim=0` freezes every skeletal AnimationMixer
  // (player body, FP arms, rigged creatures): rigs draw their rest pose and
  // nothing ticks. The negative control for every clip-playback claim and the
  // perf isolator that prices the mixer inside one binary.
  'anim',
  // RN-465 / RN-491, standing rule 7, ADDED AT RN-514 BECAUSE THEY WERE MISSING.
  // `?fur=0` removes FurShader's onBeforeCompile entirely (stock programs, a
  // bit-exact build) and `?partmat=0` isolates the per-part channel that rides
  // the same hook. Both shipped as the stated negative controls for the pelt and
  // NEITHER WAS ON THIS LIST, so no probe driven through run.mjs could reach
  // either one: the flags existed, the runner dropped them, and the URL arrived
  // without them. That is GP-156's vacuous-control shape in the runner rather
  // than in a probe, and it is the same failure RN-152 caught once already when
  // `--starlight=0` went unforwarded and both sides of a "pair" ran with the
  // feature on.
  'fur', 'partmat',
  // RN-681, standing rule 7. `shadowlod=0` restores the pre-change build
  // exactly: the machine ladders' tiers 1 and 2 are never added to the geometry
  // pools, so the geometry COUNT and the vertex-buffer size go back too, and no
  // batch installs a shadow hook. `shadowlodk=` sweeps the one texel of
  // silhouette error the rule allows a cascade, so "why one texel and not the
  // Nyquist two" is a measurement rather than an argument. Listed here in the
  // same commit that introduces them, which is the `fur`/`partmat` lesson two
  // entries up: a control the runner drops is a control that does not exist.
  // RN-696. `shadowlodpx=` opts into the per-cascade budget derived from each
  // cascade's own screen footprint; without it the rule is uniform one texel.
  // Added in the same edit that discovered it was missing: the run above
  // reported `policy uniform` for BOTH sides of a pair because the runner
  // dropped the flag, which is the `fur`/`partmat` failure a dozen lines up
  // happening again to the lane that had just finished writing it down.
  'shadowlod', 'shadowlodk', 'shadowlodpx',
  // RN-1571 and RN-1572, standing rule 7 both times. `shadowbias=0` restores
  // the raw -0.0006 depth-unit literal that shadowed every machine in the game
  // (the sign is inverted for reversed depth on three's PCF path); `sundisc=0`
  // restores the 3.15-degree LDR sun sprite. Registered in the same commit that
  // introduces them, which is what this list's own guard asks for.
  'shadowbias', 'sundisc',
  // RN-2175 (fidelity lane A4, the sky system). Each restores the state
  // immediately before the term it names: `aerobase=0` the per-ray aerosol
  // reference, `sunarc=0` the three-step sun-path march (any other number is a
  // scattering-curvature multiple), `skyirr=0` the zenith-only sky ambient,
  // `clouds=0` the cloud layer, `sunglare=0` the disc aureole.
  'aerobase', 'aerosol', 'skyaero', 'sunarc', 'skyirr', 'clouds', 'cloudamp', 'sunglare',
  // RN-2400 (lane M1, THE DISTANCE GOES BLUE). `aerodepth=0` restores the
  // flat RN-2320 tint exactly, whatever the optical depth: `ofAeroTintAt`
  // returns `uAeroTint` unconditionally. Registered in the same commit that
  // introduces it, per this list's own rule.
  'aerodepth',
  // RN-2445 (lane M5, THE NIGHT). `nightsky=0` restores the pre-lane sky
  // exactly: the scattering integral alone, with no zenith/horizon night term
  // added on top. Registered in the same commit that introduces it.
  'nightsky',
  // Like `sandbox` above, not an isolation switch: it selects WHICH BODY the
  // client boots on. `body=cinder` (or `moon`, or `1`) boots the moon; absent
  // or anything else is Forge, which is every existing probe unchanged.
  // Registered in the same commit that introduces it, per this list's own rule.
  'body',
  // RN-845. The second body in the sky. `skybodies=0` is the STRUCTURAL
  // control: the class is never constructed, so no oracle is sampled, no
  // texture is allocated and nothing joins the far scene, which is what makes
  // a byte-identical negative control possible at all. `skybodyrelief` and
  // `skybodydetail` are the two halves of the surface, separable because "the
  // body is in the wrong place" and "the body's surface is wrong" are
  // different faults; `skybodytex` is the bake resolution and `skybodytime`
  // pins the ephemeris clock so a disc can be posed at a chosen phase.
  // Registered in the same commit that introduces them, per this list's rule.
  'skybodies', 'skybodyrelief', 'skybodydetail', 'skybodytex', 'skybodytime'];
for (const k of PAGE_PARAMS) {
  if (args.has(k)) params.set(k, args.get(k));
}
params.set('debug', args.get('debug') ?? '1');

// AN UNRECOGNISED FLAG IS A FAILED RUN, NOT A DEFAULT (RN-698).
//
// The list above is a WHITELIST and everything else was silently discarded. That
// is not a hypothetical: it has produced a vacuous green three times in one
// night. `--fur=0` and `--partmat=0` shipped as the stated negative controls for
// the pelt and neither was on the list, so no probe could reach either; RN-152
// lost a whole "pair" to `--starlight=0` going unforwarded with both sides
// running the feature ON; and RN-698 caught it again with `--shadowlodpx=4`,
// which reported `policy uniform` for BOTH sides of a pair, twelve lines below
// the comment describing exactly this.
//
// The failure is silent and it fails in the FLATTERING direction: the page boots
// at the default, the probe reads the default, and the report says the default
// as though it were the request. Nothing anywhere says the flag was dropped.
//
// So a flag that is neither a page parameter nor one of this runner's own is a
// hard exit before the browser is even launched. `--allow-unknown-flags` is the
// door for a caller that means it, and it has to be typed, which is the point.
const RUNNER_OWN = new Set(['url', 'out', 'width', 'height', 'settle', 'wait',
  'evalfile', 'evalargs', 'eval', 'debug', 'allow-unknown-flags', 'heartbeat']);
const dropped = [...args.keys()].filter((k) => !RUNNER_OWN.has(k) && !params.has(k));
if (dropped.length > 0 && !args.has('allow-unknown-flags')) {
  const known = [...PAGE_PARAMS, ...RUNNER_OWN];
  for (const k of dropped) {
    // A near miss is nearly always a typo or a flag whose author forgot the
    // whitelist, so name the candidates rather than only the offence.
    const near = known.filter((c) => c.startsWith(k.slice(0, 3)) || k.startsWith(c.slice(0, 3)));
    console.error(`smoke: unknown flag --${k}. It is not one of this runner's own`
      + ` flags and it is NOT in the page-parameter list in run.mjs, so it would`
      + ` have been DISCARDED and the page would have booted at the default while`
      + ` the report described it as the request.`
      + (near.length > 0 ? ` Did you mean: ${near.map((c) => '--' + c).join(', ')}?` : '')
      + ` If the flag is real, add it to the list in run.mjs in the same commit`
      + ` that introduces it. To run anyway, pass --allow-unknown-flags.`);
  }
  process.exit(2);
}

const url = `${base}?${params.toString()}`;

// CHROME_PATH overrides the search entirely (set it rather than adding a new
// hardcoded path for a one-off machine). The Linux entries were added for the
// Proxmox build-tooling VM (BT-30-series, 2026-08-10): a plain `apt install
// google-chrome-stable` lands at /usr/bin/google-chrome-stable /
// /usr/bin/google-chrome depending on release, and this list previously had
// Windows paths only, so the probe harness could not run on Linux at all.
const CHROME_CANDIDATES = [
  ...(process.env.CHROME_PATH ? [process.env.CHROME_PATH] : []),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];
const exe = CHROME_CANDIDATES.find((p) => p && existsSync(p));
if (!exe) { console.error('smoke: no Chrome or Edge found'); process.exit(2); }

// Deduped: one bad shader emits hundreds of identical useProgram warnings, and
// a wall of them buries the single line that says what actually broke.
const seen = new Map();
const errors = {
  push(msg) {
    const key = msg.slice(0, 160);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  },
  get length() { return seen.size; },
  list() {
    return [...seen.entries()].map(([m, n]) => (n > 1 ? `${m}   (x${n})` : m));
  },
};
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: [
    '--use-angle=default',
    '--enable-unsafe-swiftshader',
    '--disable-frame-rate-limit',
    '--hide-scrollbars',
  ],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
// GL CONTEXT LOSS (BT-63), identical rule to boot.mjs. Under SwiftShader the
// context is lost at ~0.9 s and restored at ~2.6 s on roughly half of runs on
// the Linux VM, always inside the ItemIcons bake (a SECOND WebGL context).
// Measured: lost-and-restored differs from clean by 0.49% of pixels against
// 0.31% between two clean runs, so the restore re-uploads correctly. Tolerated
// ONLY when a restore answers it and the pair completes before __of.ready; a
// loss after ready means the probe measured a dead context, and an unanswered
// loss never came back. Both still fail the run.
let ready = false;
// ============================================================================
// GP-982. THE PROGRESS HEARTBEAT.
//
// THIS RUNNER'S ONLY OUTPUT USED TO ARRIVE AT THE END. Two lines at boot, then
// silence until one `console.log(JSON.stringify(report))` at the finish. For a
// probe that takes seconds that is fine. For `probes/padgate.js`, which needs
// about half an hour to reach a launch pad legally, it is indistinguishable
// from a dead process, and on 2026-08-15 a careful verifier read exactly that
// silence as a hang, diagnosed a stall that does not exist, reproduced the
// "stall" on clean `origin/main` as a control, and routed a defect. The probe
// was green the whole time. The full episode is in NUMBERS.md (GP-983).
//
// The repair is a periodic line, and the three constraints it has to respect:
//
//  1. IT GOES TO STDERR. Stdout carries exactly one JSON value and nothing
//     else, because `probeall.mjs` reads the whole of stdout and `JSON.parse`s
//     it for the verdict. A progress line on stdout would break every sweep.
//  2. IT NAMES A STAGE, not just a time. "alive 900s" says the process exists;
//     "stage=probe | page 4.1s ago: padgate [898.2s] smelt batch 17/22" says
//     it is working and on what. The stage is the runner's own; the page half
//     is whatever the probe last printed, so a probe that logs its phases gets
//     a rich heartbeat for free and one that logs nothing still gets a pulse.
//  3. A FAST PROBE GAINS NOTHING. The first beat is one interval in, so
//     anything under `--heartbeat` seconds (default 30) is silent exactly as
//     it is today. `--heartbeat=0` turns it off entirely.
// ============================================================================
const runT0 = Date.now();
let stage = 'launching';
let lastPageLine = '';
let lastPageAt = 0;
const beat = heartbeatS > 0
  ? setInterval(() => {
    const el = ((Date.now() - runT0) / 1000).toFixed(1);
    const tail = lastPageAt === 0
      ? 'no page output yet'
      : `page ${((Date.now() - lastPageAt) / 1000).toFixed(1)}s ago: `
        + lastPageLine.slice(0, 200);
    console.error(`smoke: alive ${el}s stage=${stage} | ${tail}`);
  }, heartbeatS * 1000)
  : null;
beat?.unref?.();
const ctx = { lost: 0, restored: 0, lateLoss: 0 };
page.on('console', (m) => {
  const t = m.type();
  if (/CONTEXT_LOST_WEBGL/.test(m.text())) {
    ctx.lost++; if (ready) ctx.lateLoss++; console.error(`[page] ${m.text()}`); return;
  }
  if (/WebGLRenderer: Context Restored/.test(m.text())) {
    ctx.restored++; console.error(`[page] ${m.text()}`); return;
  }
  if (t === 'error') errors.push(`console.error: ${m.text()}`);
  else if (t === 'warning' && /WebGL|shader|GL_INVALID/i.test(m.text())) {
    // TWO warnings are allowlisted, both on stock three.js source, both
    // compiler notes rather than fallbacks. Everything else still fails the
    // run, which is the rule that caught the silent no-op terrain material at
    // W1. Neither entry is a wildcard: they name one ANGLE diagnostic each.
    //
    // X4122: three's own PMREM shader, a literal sum ANGLE's HLSL backend
    //   cannot fold exactly in double precision.
    // X4000 in f_ApplyFXAA: three's `addons/shaders/FXAAShader.js`, reached
    //   only when the post stack's AA pass is on (`?aa=0` removes it entirely,
    //   which is how it was attributed). `ApplyFXAA` has exactly two return
    //   statements and no fall-through path, so "potentially uninitialized" is
    //   D3DCompiler failing to prove that the early return dominates its use
    //   after flattening. Stock three warns here either way: with its own
    //   implicit-LOD fetch it emits X3595 instead, which is why `?fxaalod=0`
    //   exists and why probes/post.js checks the two produce the same pixels.
    // "GPU stall due to ReadPixels": a KHR_debug PERFORMANCE note, severity
    // High, emitted only by the SwiftShader/Vulkan backend (BT-62). It is not
    // a fallback and not an app defect: it fires on the synchronous readback
    // the ItemIcons baker deliberately performs, once per context, 3 to 4
    // times per run, on 100% of runs on the Linux VM and never on Windows,
    // where ANGLE runs on D3D. It is a driver telling us a readback is slow,
    // which is exactly what a software rasteriser is. Named, not wildcarded.
    if (!/warning X4122/.test(m.text())
      && !/warning X4000: use of potentially uninitialized variable \(f_ApplyFXAA\)/.test(m.text())
      && !/GPU stall due to ReadPixels/.test(m.text())) {
      errors.push(`console.warn: ${m.text()}`);
    }
  }
  else if (t === 'info' || t === 'log') {
    lastPageLine = m.text();
    lastPageAt = Date.now();
    console.error(`[page] ${m.text()}`);
  }
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));

let exitCode = 0;
try {
  stage = 'navigate';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  stage = 'wait for window.__of';
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  stage = 'wait for __of.ready';
  await page.evaluate(() => window.__of.ready);
  // --eval runs against the live page and its return value lands in the report,
  // so a probe can drive the world (teleport, tapes) and hand back its own
  // measurements without the runner knowing anything about the scenario.
  ready = true;
  let evalResult;
  stage = evalFile ? `probe ${evalFile.split(/[\\/]/).pop()}` : 'probe';
  if (evalScript) evalResult = await page.evaluate(evalScript);
  stage = 'wait';
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  stage = 'settle';
  await page.evaluate((n) => window.__of.settle(n), settleFrames);

  stage = 'report';
  const report = await page.evaluate(() => ({
    stats: window.__of.stats(),
    world: window.__of.world(),
    scene: window.__of.scene(),
  }));
  if (evalResult !== undefined) report.eval = evalResult;

  if (out) {
    stage = 'screenshot';
    const p = isAbsolute(out) ? out : resolve(repoRoot, out);
    // --out is resolved against the REPO ROOT, so a leading '../' escapes the
    // project and silently scatters screenshots into the parent directory. That
    // is not hypothetical: it created a stray Nextcloud/docs folder that a later
    // agent then tried to rm -rf. mkdirSync would happily create the escape
    // path, so the guard has to come first. Refuse, and say what to pass.
    const rel = relative(repoRoot, p);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(
        `--out must stay inside the repo. '${out}' resolves to ${p}, which is outside `
        + `${repoRoot}. Paths are relative to the repo root, so pass `
        + `docs/screenshots/NAME.png (no leading '../').`);
    }
    mkdirSync(dirname(p), { recursive: true });
    await page.screenshot({ path: p });
    console.error(`smoke: wrote ${p}`);
  }
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  // BT-270 to BT-274. `stage` was already tracked (the heartbeat prints it
  // every 30s, `smoke: alive Ns stage=...`) but never carried into the
  // terminal failure record, so a reader of `runnerFails`/`stderrTail` in
  // probeall.mjs's results.jsonl could not tell "the app never booted" from
  // "the probe's own content check failed" from "the screenshot write
  // crashed" -- all three read as the same bare error message. This is a
  // DELIBERATELY MINIMAL fix, not the structural one considered and rejected
  // (see the audit's report for the reasoning): no `report` object exists at
  // this point to preserve a "partial report" from -- `report` is assembled
  // in ONE atomic page.evaluate call strictly AFTER the probe eval and
  // settle steps (see `stage = 'report'` above in the try block), so there
  // is nothing partial sitting in memory to lose here beyond what `stage`
  // and `e` already describe. The prefix stays exactly `runner: ` (not
  // `runner (at stage ...): `) because probeall.mjs's own `runnerFails`
  // extraction is a regex anchored on that literal, unbroken prefix
  // (`/^ {2}(console\.error|pageerror|requestfailed|runner|console\.warn):.*/gm`);
  // putting the stage inside the message body, after the colon, is what
  // keeps this change additive instead of silently breaking that gate.
  errors.push(`runner: [stage=${stage}] ${e?.message ?? e}`);
  exitCode = 1;
} finally {
  // Cleared BEFORE the close so a slow teardown cannot emit a beat that reads
  // like the probe is still working.
  if (beat) clearInterval(beat);
  stage = 'closing';
  await browser.close();
}

// Judged after the run, not at the moment the message arrived: whether a loss
// is tolerable depends on the restore that answers it and on whether it landed
// before ready, and neither is known yet when the console line appears.
if (ctx.lateLoss > 0) {
  errors.push(`smoke: the GL context was lost ${ctx.lateLoss}x AFTER __of.ready. `
    + `Every number and pixel this run reports past that point was produced on a `
    + `dead context and must not be trusted.`);
} else if (ctx.lost > ctx.restored) {
  errors.push(`smoke: the GL context was lost ${ctx.lost}x but only ${ctx.restored} `
    + `restore(s) arrived, so it never came back.`);
}

if (errors.length) {
  console.error(`smoke: FAILURES (${errors.length} distinct)`);
  for (const e of errors.list()) console.error('  ' + e);
  exitCode = 1;
} else {
  // A tolerated loss is REPORTED, never silent.
  const lostNote = ctx.lost > 0
    ? ` (${ctx.lost} pre-ready context loss(es), restored ${ctx.restored}x)` : '';
  console.error(`smoke: PASS (no console errors, no failed requests)${lostNote}`);
}
process.exit(exitCode);
