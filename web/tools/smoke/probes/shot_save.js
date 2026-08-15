// shot_save.js: a screenshot of the Save Game page (GP-136/GP-137).
// Not an acceptance; probes/savenamed.js under reload.mjs is.
//
//   node tools/smoke/run.mjs --scenario=walk \
//        --evalfile=tools/smoke/probes/shot_save.js \
//        --out=docs/screenshots/GP137_savegame.png
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  await sleep(0.8);
  // Two named saves and an autosave, so the list has something to show.
  of.pause(true);
  await sleep(0.4);
  of.cheat('page:save');
  await sleep(0.4);
  // RE-QUERIED each time: saving changes the render key, so the box and the
  // button from the previous round are detached by the rebuild.
  for (const n of ['before the mountain', 'first launch pad']) {
    const box = document.querySelector('#of-pause input[data-save="name"]');
    if (box !== null) box.value = n;
    document.querySelector('#of-pause button[data-cheat="save:new"]')?.click();
    await sleep(1.0);
  }
  await of.save();
  await sleep(0.6);
  of.cheat('page:');
  await sleep(0.2);
  of.cheat('page:save');
  await sleep(0.8);
  return { valid: true, rows: of.pause().view.saves.rows.map((r) => r.name) };
})()
