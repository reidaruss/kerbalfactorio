// shot_controls.js: a screenshot of the Options / Controls screen (GP-131).
// Not an acceptance; `probes/cheats.js` section B2 is. This exists so the
// controller report can show the screen rather than describe it.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  await of.run(0.8);
  of.pause(true);
  await of.run(0.4);
  of.cheat(OF_ARGS && OF_ARGS.page ? 'page:' + OF_ARGS.page : 'page:controls');
  await of.run(0.7);
  return {
    valid: true,
    page: of.pause().view.page,
    rows: document.querySelectorAll('#of-pause .ctlr').length,
    groups: document.querySelectorAll('#of-pause .ctlg').length,
  };
})()
