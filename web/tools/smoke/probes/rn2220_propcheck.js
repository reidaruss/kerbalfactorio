// RN-2220's solid-shadow control. propshadow.js's own pose (a real shadow
// caster, Forest_FallenLog, ahead of the camera) with nothing removed: this
// probe only takes the screenshot so RN2220's contact-shadow thin-damp can be
// checked with boxstat.mjs against a rectangle picked on the log's own ground
// shadow, one flag apart (?csthin=0 vs the shipped default).
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:PORT/ --scenario=walk \
//     --width=1600 --height=900 --evalfile=tools/smoke/probes/rn2220_propcheck.js \
//     --out=docs/screenshots/RN2220_propshadow_after.png
(async (A) => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  of.teleport(A.lat ?? -19.85, A.lon ?? -72.7853, 2);
  await of.settle(30);
  of.look(A.yaw ?? 300, A.pitch ?? -26);
  of.setSunElev(A.sunDot ?? 0.30);
  await of.settle(30);
  of.setSunElev(A.sunDot ?? 0.30);
  await of.settle(20);
  return { valid: true };
})(typeof OF_ARGS === 'undefined' ? {} : OF_ARGS)
