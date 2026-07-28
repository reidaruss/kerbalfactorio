// shot_build.js: a screenshot of the build menu with its icons (GP-111/GP-130).
// Not an acceptance; `probes/buildmenu.js` is. This exists so the controller
// report can show the menu rather than describe it.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  await of.run(0.8);
  of.buildMenu(true);
  await of.run(0.7);
  const tiles = [...document.querySelectorAll('#of-build .of-btile')];
  return {
    valid: true,
    tiles: tiles.length,
    withArt: tiles.filter((t) => t.querySelector('.art img') !== null).length,
    stillText: tiles.filter((t) => t.querySelector('.art img') === null)
      .map((t) => t.getAttribute('data-build')),
  };
})()
