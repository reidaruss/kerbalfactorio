// RN-2730. WHAT `aerosolScaleM` WOULD DO, DERIVED FROM THE SHADER'S OWN
// COLUMN INTEGRAL, BECAUSE THE CONSTANT HAS NO PAGE PARAMETER AND THIS LANE
// MAY NOT ADD ONE.
//
// THE WIRING GAP, stated first because everything below is a consequence of
// it. `aerosolSigma` is reachable from a URL: `?aerosol=` is an amplitude on
// it (`Atmosphere.glsl.ts:486-490`, applied at `:456`). `aerosolScaleM`
// (`Atmosphere.glsl.ts:155`, value 400) is reachable from nothing. It is built
// once into `uAerosol.y` at `:454-457`, no code writes `uAerosol.value.y` at
// runtime (`SkyPass.ts:171` writes `.x` and is the only runtime writer), and
// `__ofAtmos` publishes it as a READBACK with no setter beside it
// (`SkyPass.ts:169-206`). Registering a flag is a `web/src` change this lane is
// forbidden, so what follows is a derivation with the shipped constant read
// back off the page, not a sweep.
//
// WHY A DERIVATION IS WORTH ANYTHING HERE, and this is the load-bearing claim.
// In BOTH aerosol entry points the two constants meet exactly once and then
// never again:
//
//   ground, `ofAtmoAerial`      `od = uAerosol.x * colDepth(L, hA, hM, hB, H)`
//                               (AtmosphereAero.glsl.ts:340-342)
//   sky,    `ofAtmoSkyAero`     `od = uAerosol.x * ofChapman(h0, sinZ, cosZ,
//                               uPlanetR, uAerosol.y)`   (:288-289)
//
// and every quantity downstream of that line is a function of `od` ALONE:
// `tr = exp(-od)` (:343), the tint `ofAeroTintAt(od, ...)` (:359), and the
// composite `col * tr + haze * (1 - tr)` (:360). The phase function takes
// neither constant, and `sunT` is Rayleigh and Mie only (`ofAtmoSunTransmittance`,
// Atmosphere.glsl.ts:581-588, reads `uBetaR`/`uBetaM` and never `uAerosol`).
// So along ANY ONE RAY, sigma and the scale height are exactly interchangeable:
// the amplitude that reproduces a scale height H, on that ray, is
//
//   A_eq(H) = colDepth(H) / colDepth(400)
//
// and it is exact, not a first-order fit. What the two constants do NOT share
// is how that factor varies BETWEEN rays, and that difference is the entire
// content of 2.44.10 item 1's claim that `aerosolScaleM` is "the surgical one".
// This tool prints A_eq per ray across a pose's own depth range, so the SPREAD
// of A_eq is the number that says how surgical it actually is: a spread near
// zero means the amplitude slider already reaches everything the scale height
// would reach at that pose, and a wide spread means it does not.
//
// THE COLUMN INTEGRAL BELOW IS A TRANSCRIPTION, NOT A MODEL. `ofAeroColumn`
// and the two-segment midpoint split are copied line for line from
// AtmosphereAero.glsl.ts:140-151 and :338-341, clamp included. If that shader
// changes, this file is wrong and says nothing about it, which is why every
// number it prints is labelled DERIVED in the record.
//
//   node tools/smoke/rn2730scale.mjs --eye=1930.2 --base=730.2 --ground=730.2 \
//     --dists=4500,8000,12000,15200 --scales=100,200,300,400,600,800
//
// `--eye` and `--ground` are altitudes above the DATUM in metres, `--base` is
// the layer base the running page reports through `__ofAtmos.aeroRef()[0]`
// (artframe's `atmos.baseM`), and `--dists` is the ray length ladder. `--R` is
// the body radius, 600000 on Forge, read back at `__of.world().bodyRadiusM`.

const argv = new Map(process.argv.slice(2)
  .map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const R = Number(argv.get('--R') ?? 600000);
const eye = Number(argv.get('--eye') ?? 1930.2);
const base = Number(argv.get('--base') ?? 730.2);
const ground = Number(argv.get('--ground') ?? 730.2);
const H0 = Number(argv.get('--h0') ?? 400);
const sigma = Number(argv.get('--sigma') ?? 1.4e-4);
const dists = (argv.get('--dists') ?? '4500,8000,12000,15200').split(',').map(Number);
const scales = (argv.get('--scales') ?? '100,200,300,400,600,800').split(',').map(Number);

/** AtmosphereAero.glsl.ts:140-151, transcribed. */
function ofAeroColumn(L, hA, hB, H) {
  const lo = Math.min(hA, hB);
  const hi = Math.max(hA, hB);
  if (hi <= 0) return L;
  const under = lo < 0 ? (L * -lo) / Math.max(hi - lo, 1e-3) : 0;
  const a = Math.max(lo, 0);
  const d = (hi - a) / H;
  const mean = d < 1e-3
    ? Math.exp(-a / H) * (1 - 0.5 * d)
    : (H / (hi - a)) * (Math.exp(-a / H) - Math.exp(-hi / H));
  return under + (L - under) * mean;
}

/**
 * AtmosphereAero.glsl.ts:338-341, transcribed. The midpoint altitude uses the
 * chord identity |M|^2 = (r0^2 + r1^2)/2 - d^2/4 rather than a vector, which
 * is the same number the shader's `length(ro + rd * 0.5 * distM)` produces and
 * needs no camera basis to state.
 */
function colDepth(distM, H) {
  const r0 = R + eye;
  const r1 = R + ground;
  const rM = Math.sqrt(Math.max((r0 * r0 + r1 * r1) / 2 - (distM * distM) / 4, 0));
  const a0 = Math.max(r0 - R, 0);
  const a1 = Math.max(r1 - R, 0);
  const aM = Math.max(rM - R, 0);
  const hL = 0.5 * distM;
  return ofAeroColumn(hL, a0 - base, aM - base, H)
    + ofAeroColumn(hL, aM - base, a1 - base, H);
}

/**
 * AtmosphereAero.glsl.ts:30-61, transcribed: `ofErfcx` then `ofChapman`. This
 * is the SKY ray's column, and it matters because the emulation the ground
 * table below licenses does NOT extend to it. `?aerosol=` multiplies sigma for
 * both entry points at once; a scale-height change moves them by DIFFERENT
 * factors, so an amplitude arm chosen to reproduce a scale height in the ground
 * band is wrong in the sky of the same frame by the ratio printed here.
 */
function ofErfcx(x) {
  return 2.0 / (1.7724539 * (x + Math.sqrt(x * x + 1.2732395)));
}
function ofChapman(h0, sinZ, cosZ, Rr, H) {
  const hh = Math.max(h0, 0);
  const r0 = Rr + hh;
  const c = Math.max(cosZ, 1e-3);
  const u = (sinZ / c) * Math.sqrt(r0 / (2.0 * H));
  return Math.exp(-hh / H) * Math.sqrt(1.5707963 * r0 * H) * ofErfcx(u) / c;
}

console.log(`--- RN-2730 aerosolScaleM, DERIVED (no page parameter exists) ---`);
console.log(`R ${R}  eye ${eye} m  ground ${ground} m  layer base ${base} m`
  + `  shipped H ${H0} m  sigma ${sigma}`);
console.log('');
const head = ['  dist m', ' od@H400'].concat(scales.map((s) => `A_eq H${s}`.padStart(10)));
console.log(head.join(''));
const cols = new Map(scales.map((s) => [s, []]));
for (const d of dists) {
  const c0 = colDepth(d, H0);
  const row = [String(d).padStart(9), (sigma * c0).toFixed(4).padStart(9)];
  for (const s of scales) {
    const a = colDepth(d, s) / c0;
    cols.get(s).push(a);
    row.push(a.toFixed(4).padStart(10));
  }
  console.log(row.join(''));
}
console.log('');
console.log('SPREAD of A_eq across the ladder (max/min): the factor by which ONE'
  + ' amplitude misses');
for (const s of scales) {
  const v = cols.get(s);
  const lo = Math.min(...v); const hi = Math.max(...v);
  const mid = v.slice().sort((p, q) => p - q)[Math.floor(v.length / 2)];
  console.log(`  H ${String(s).padStart(4)}   A_eq ${lo.toFixed(4)} .. ${hi.toFixed(4)}`
    + `   median ${mid.toFixed(4)}   ratio ${(hi / Math.max(lo, 1e-9)).toFixed(3)}`);
}

// THE SKY RAY, printed so the ground table above cannot be over-read. An
// amplitude arm chosen from the ground column is wrong in the SAME FRAME's sky
// by exactly this ratio, because `?aerosol=` multiplies sigma for both entry
// points while a scale-height change does not.
const eyeH = eye - base;
console.log('');
console.log('SKY RAY (ofAtmoSkyAero / ofChapman) at the same eye, for elevations'
  + ' above the local horizontal:');
console.log('   elev deg' + scales.map((s) => `A_sky H${s}`.padStart(10)).join(''));
for (const deg of [2, 10, 30, 60, 90]) {
  // `ofAtmoSkyAero` defines sinZ = dot(rd, up), i.e. the SINE of the elevation
  // above the local horizontal, and cosZ = sqrt(1 - sinZ^2) (:281-286).
  const sinZ = Math.sin((deg * Math.PI) / 180);
  const cosZ = Math.cos((deg * Math.PI) / 180);
  const c0 = ofChapman(eyeH, sinZ, cosZ, R, H0);
  const row = [String(deg).padStart(11)];
  for (const s of scales) {
    const cs = ofChapman(eyeH, sinZ, cosZ, R, s);
    // FLOAT32 IS THE SHADER'S ARITHMETIC AND A RATIO OF TWO UNDERFLOWED
    // NUMBERS IS NOT A FINDING. At an orbital eye both columns are far below
    // the float32 minimum normal (1.18e-38), so on the GPU both are exactly
    // zero and the term is absent at every scale height on the ladder; in
    // float64 the same pair divides to 1e+43 and would read as a colossal
    // amplification that no frame can contain. Printed as `nil` instead, which
    // is what the hardware computes.
    const F32 = 1.1755e-38;
    const r = cs < F32 && c0 < F32 ? null : (c0 < F32 ? NaN : cs / c0);
    row.push((r === null ? 'nil' : (Number.isFinite(r) ? r.toFixed(4) : 'n/a'))
      .padStart(10));
  }
  console.log(row.join(''));
}
console.log(`   (sky column at H400, eye ${eyeH.toFixed(1)} m above the layer base:`
  + ` exp(-h/H) alone is ${Math.exp(-eyeH / H0).toExponential(3)})`);
