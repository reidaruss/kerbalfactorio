// RN-1650. Does `of.propsVisible(false)` (the runtime control every A/B probe
// in this repo uses as its props=0 arm) actually pull props out of the SHADOW
// pass, or only out of the colour pass? ADMIN's backlog carried this as a
// confirmed defect ("props=0 leaves scatter shadows", found by the terrain
// LOD lane, WG-186 to WG-193) on the strength of a comment in artframe.js's
// `voxelface` shot: "PROP SHADOWS SURVIVE propsVisible(false) ... `--props=0`
// changed nothing either (box luma 29.76 against 29.78)."
//
// RN-1650 COULD NOT REPRODUCE IT, on a real D3D11 boot (RTX 4060 Ti, ANGLE),
// three ways:
//
//   1. This probe's own pose (forestfloor, sun dot 0.30, a `Forest_FallenLog`
//      biome prop ahead, a real shadow caster and not a `:detail` card):
//      `propsVisible(false)` vs a SEPARATE boot with `?props=0` (zero atlases
//      ever loaded, `Scatter.enabled=false`, the strongest possible control)
//      produce frames that agree to within render noise (5.5% of pixels,
//      evenly split darker/lighter, confined to background-foliage dither and
//      the animated first-person arms; the ground itself is pixel-identical).
//   2. The same pose with `?canopy=200` so a large canopy tree stands right in
//      front of the camera and visibly shadows the grass beside it: same
//      result, `propsVisible(false)` and `?props=0` agree to noise.
//   3. artframe.js's own `voxelface` shot (RN-1258, sun dot 0.88, the exact
//      site the original comment measured): the §box read 67.58 luma with
//      props visible, and BIT-IDENTICAL 87.01 (rgb, p05, p50, p95, iqr, loFrac
//      all equal to the digit) whether props were removed by
//      `propsVisible(false)` or by booting with `?props=0`. The two removal
//      methods are indistinguishable; there is no third arm where the
//      "shadow" that survives removal is bigger than the terrain's own dug-pit
//      self-shadow.
//
// THE READING: `WebGLShadowMap.js`'s `projectObject` (three r185, line 509)
// checks `object.visible === false` and returns before the object is even
// considered as a caster, for BOTH the colour and the shadow render list.
// `PropLibrary.setVisible` sets exactly that flag on every batch, so the
// runtime toggle removes props from the shadow pass by the same mechanism it
// removes them from the colour pass. There is no separate shadow-caster list
// to fall out of step with it, and no cached shadow map to go stale:
// `Renderer.ts` never sets `shadowMap.autoUpdate = false`, so the shadow map
// re-renders in full every frame.
//
// THE ORIGINAL COMMENT'S OWN NUMBERS SAY THE SAME THING READ THE OTHER WAY:
// 29.76 against 29.78 is the two REMOVAL methods agreeing with each other
// (exactly what this probe finds at 67.58 -> 87.01, bit-identical either way
// props are removed), not a "shadow" that failed to move against a props-ON
// control that was never in that comment. What's left at `voxelface`'s box
// after removal is the dug pit's OWN wall self-shadowing a near-zenith sun
// barely reaches, which is real, is unrelated to props, and is exactly what
// "the high sun is what actually shrinks them" (the comment's own next
// sentence) already said.
//
// This probe is kept as the regression guard: run it, then re-run with
// `?props=0` at the same pose, and diff the two `png` fields. A REAL
// regression would show the shadow persisting under the URL flag where this
// probe's own toggle does not.
(async (A) => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  of.teleport(A.lat ?? -19.85, A.lon ?? -72.7853, 2);
  await of.settle(30);
  of.look(A.yaw ?? 300, A.pitch ?? -26);
  of.setSunElev(A.sunDot ?? 0.30);
  await of.settle(30);
  of.setSunElev(A.sunDot ?? 0.30);
  const elevDot = of.stats().sky.elevationDot;

  const grab = async () => {
    const blob = await of.screenshot();
    const buf = await blob.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:image/png;base64,${btoa(bin)}`;
  };

  const propsAvailable = typeof of.propsVisible === 'function';
  if (!propsAvailable) return { valid: false, why: 'no of.propsVisible' };

  const before = await grab();
  of.propsVisible(false);
  await of.run(1, 6);
  const after = await grab();
  of.propsVisible(true);
  await of.run(1, 6);
  const restored = await grab();

  return {
    valid: true, elevDot, propsAvailable,
    png: before, pngPropsOff: after, pngRestored: restored,
  };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
