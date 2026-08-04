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
  // RN-152, the starlight floor. `starlight=0` removes it (the PH-86 black
  // night exactly); `starlightamp=` sweeps it.
  // RN-952, the DAYLIGHT floor underneath it, which had no control at all and
  // is therefore the term four experiments could not reach: `starlight=0`
  // removes only the term above it. `terrainfloor=0` removes this one and
  // `terrainfloor=` sweeps it, so the two halves of the constant ambient on an
  // airless night are separable. Registered in the same commit that introduces
  // it, per this list's own rule.
  'starlight', 'starlightamp', 'terrainfloor',
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
  'vab', 'flight',
  // The post-processing stack (render/post/PostConfig.ts). `post` is the master
  // switch and restores the pre-stack path exactly; the other four isolate one
  // effect each, per standing rule 7.
  'post', 'ao', 'bloom', 'grade', 'aa', 'contact',
  'aoscale', 'aoslices', 'aosteps', 'aoradius', 'aostrength', 'aopower',
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
  // RN-97, standing rule 7. `wind=0` removes the foliage wind hook entirely,
  // so the program set is stock and the build is the static one (the negative
  // control); `windamp=` sweeps the amplitude in place, and `windamp=0` keeps
  // the hooked program at exactly zero displacement, which is what separates
  // "the hook costs" from "the motion costs".
  'wind', 'windamp',
  // RN-102, standing rule 7. `leafvar=0` bakes the flat greyscale vertex
  // colour, i.e. the pre-RN-102 bytes exactly; the runtime pair lives on
  // `__ofProps.setLeafVar` because a reload cannot hold the frame equal.
  'leafvar',
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
  'evalfile', 'evalargs', 'eval', 'debug', 'allow-unknown-flags']);
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

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
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
page.on('console', (m) => {
  const t = m.type();
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
    if (!/warning X4122/.test(m.text())
      && !/warning X4000: use of potentially uninitialized variable \(f_ApplyFXAA\)/.test(m.text())) {
      errors.push(`console.warn: ${m.text()}`);
    }
  }
  else if (t === 'info' || t === 'log') console.error(`[page] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));

let exitCode = 0;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__of !== 'undefined', null, { timeout: 60000 });
  await page.evaluate(() => window.__of.ready);
  // --eval runs against the live page and its return value lands in the report,
  // so a probe can drive the world (teleport, tapes) and hand back its own
  // measurements without the runner knowing anything about the scenario.
  let evalResult;
  if (evalScript) evalResult = await page.evaluate(evalScript);
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  await page.evaluate((n) => window.__of.settle(n), settleFrames);

  const report = await page.evaluate(() => ({
    stats: window.__of.stats(),
    world: window.__of.world(),
    scene: window.__of.scene(),
  }));
  if (evalResult !== undefined) report.eval = evalResult;

  if (out) {
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
  errors.push(`runner: ${e?.message ?? e}`);
  exitCode = 1;
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`smoke: FAILURES (${errors.length} distinct)`);
  for (const e of errors.list()) console.error('  ' + e);
  exitCode = 1;
} else {
  console.error('smoke: PASS (no console errors, no failed requests)');
}
process.exit(exitCode);
