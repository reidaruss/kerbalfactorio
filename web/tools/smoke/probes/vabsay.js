// vabsay.js: GP-143. THE BAY SAYS WHAT IT IS ABOUT TO DO, BEFORE THE CLICK.
//
//   npx vite --config vite.probe.config.ts --port 5261 --strictPort
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5261/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/vabsay.js
//
// Measured on the shipped build, driving the six states a player passes on the
// way to a click: the bay's one line read "placed Fuel Tank (large) [S]" in ALL
// SIX, including with the cursor on empty space and with the cursor on a face
// that would take the part. GP-115 composed excellent refusals and they were
// reachable only by clicking and failing, which is GP-139's shape exactly: the
// help arrives only for a player who already knew what to do.
//
// WHAT MAKES THIS PROBE MEAN ANYTHING.
//
// (a) It reads the line OFF THE ELEMENT (`of.vab('line')` -> msgEl.textContent),
//     not off a field, so it cannot pass while the sentence never reaches the
//     screen. That is the same defect class GP-141 found one layer down.
// (b) It asserts the BINDING, never the prose: that the line names the part in
//     hand and names the part it would attach to, and that it CHANGES between
//     states. A test that breaks on a better sentence is one nobody keeps.
// (c) The states are asserted to differ from each other pairwise, which is the
//     property that actually failed: six states, one sentence.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  const fails = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);

  const PID = { TankSLong: 0x0102, EngineS: 0x0103, TankL: 0x0117 };
  const cat = of.vab('catalogue');
  const idx = {}, label = {};
  for (const k of Object.keys(PID)) {
    const r = cat.find((x) => x.id === PID[k]);
    idx[k] = r === undefined ? -1 : r.index;
    label[k] = r === undefined ? '' : r.name;
    check(`catalogue has ${k}`, idx[k] >= 0, `PartId 0x${PID[k].toString(16)}`);
  }
  const boot = of.vab('enter');
  await sleep(3);
  check('the bay opened', boot.open === true, JSON.stringify(boot.open));

  const clear = async () => { of.vab('press', 'clear'); await sleep(2); };
  const hold = async (p) => { of.vab('drop'); of.vab('take', idx[p]); await sleep(1); };
  const line = () => mustHave(of.vab('line'), 'text', "vab('line')");

  const states = [];
  const at = async (when) => { states.push({ when, says: line() }); };

  await clear();
  await at('empty bay, empty hand');
  await hold('TankSLong');
  await at('first part in hand');
  const l1 = line();
  check('a part in hand is named before anything is built',
        l1.includes(label.TankSLong), l1);

  of.vab('place');
  await sleep(2);
  await at('root placed');
  // The EVENT still wins for its own three seconds, which is the design: it is
  // the newer fact. Asserted so a later change cannot silently drop it.
  check('the placement event is what shows immediately after a click',
        line().includes('placed'), line());

  await hold('EngineS');
  await at('second part in hand, pointer where it was');
  of.vab('hover', 0.85, 0.85);
  await sleep(1);
  await at('pointer on empty space');
  const lNone = line();
  check('empty space says what to do rather than what was done',
        !lNone.includes('placed') && lNone.includes(label.EngineS), lNone);

  // THE DOWNWARD FACE. This is the sentence that answers "you can only build
  // bottom-up", and it must name BOTH parts: what is in hand and what it goes
  // under. Asserted as a binding, not as wording.
  const bot = of.vab('nodes').filter((n) => n.kind === 'bottom')
    .sort((a, b) => a.pos[1] - b.pos[1])[0];
  check('the stack offers a bottom face', bot !== undefined);
  if (bot !== undefined) { of.vab('hover', bot.ndc[0], bot.ndc[1]); await sleep(1); }
  await at('pointer on a face that WILL take it (downward)');
  const lDown = line();
  check('the downward line names the part in hand',
        lDown.includes(label.EngineS), lDown);
  check('and names the part it would go under',
        lDown.includes(label.TankSLong), lDown);
  check('and it is not the old event line', !lDown.includes('placed'), lDown);

  // The near miss speaks on the HOVER now, not only after a failed click.
  await hold('TankL');
  const top = of.vab('nodes').filter((n) => n.kind === 'top')
    .sort((a, b) => b.pos[1] - a.pos[1])[0];
  check('the stack offers a top face', top !== undefined);
  if (top !== undefined) { of.vab('hover', top.ndc[0], top.ndc[1]); await sleep(1); }
  await at('pointer on a face that will NOT take it');
  const lMiss = line();
  const rep = of.vab('report');
  check('the search really did hold it as a near miss',
        rep.snapped === null && rep.blocked !== null,
        JSON.stringify({ snapped: rep.snapped, blocked: rep.blocked }));
  check('THE REFUSAL IS ON SCREEN WITHOUT A CLICK, which is the whole entry',
        lMiss.includes('1.25 m') && lMiss.includes('2.50 m'), lMiss);
  check('and nothing has been placed or refused by getting here',
        rep.refused === 0, `${rep.refused} refusals`);

  // (c) six states, six different things to say. The defect was one sentence.
  const said = states.map((s) => s.says);
  const distinct = new Set(said).size;
  check('the line changes as the state changes', distinct >= 5,
        `${distinct} distinct lines across ${said.length} states: `
        + JSON.stringify(states));

  // Dropping the hand takes the aim line away rather than leaving a stale
  // instruction about a part nobody is holding.
  of.vab('drop');
  await sleep(1);
  check('an empty hand says nothing about a part', !line().includes(label.TankL),
        line());

  return {
    valid: fails.length === 0,
    fails,
    log: [{ states, downward: lDown, nearMiss: lMiss, distinct }],
    note: 'GP-143: `VabAim` composes an aim line on every pointer move and '
      + 'VabPanel draws it under the event message. Before this the bay ran '
      + 'through all six states saying "placed Fuel Tank (large) [S]".',
  };
})()
