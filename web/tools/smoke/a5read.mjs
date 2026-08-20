// Lane A5 scratch reader: pull the few artframe numbers this lane judges on out
// of a run.mjs report on stdin, so an arm's judged numbers are one line instead
// of a 12 KB JSON blob. Kept rather than deleted: `a5sweep.mjs` uses it and the
// pair is the only interleaved sweeper that can drive `meadow` and `flyover`
// (`ceilingsweep.mjs` hardcodes `--scenario=walk` and a five-pose table).
let s = '';
process.stdin.on('data', (d) => { s += d; });
process.stdin.on('end', () => {
  const j = JSON.parse(s).eval;
  const f = (x) => (typeof x === 'number' ? x.toFixed(2) : String(x));
  const e = j.extra ?? {};
  const parts = [
    `box ${f(j.box.luma)}`,
    `p05 ${f(j.box.p05)}`,
    `loFrac ${f(j.box.loFrac)}`,
    `iqr ${f(j.box.iqr)}`,
  ];
  for (const k of Object.keys(e)) parts.push(`${k} ${f(e[k].luma)}`);
  parts.push(`tris ${j.render.triangles}`);
  parts.push(`calls ${j.render.calls}`);
  parts.push(`p50 ${f(j.render.frameMs.p50)}`);
  console.log('  ' + parts.join('  '));
});
