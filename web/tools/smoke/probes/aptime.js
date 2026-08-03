// aptime.js: GP-351 and GP-352. HOW LONG THE TRIP IS, AND THE TWO WAYS THIS
// SCREEN SAYS "NO".
//
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/aptime.js
//   node tools/smoke/run.mjs --sandbox=1 --settle=25 \
//        --evalfile=tools/smoke/probes/aptime.js --evalargs='{"weak":1}'
//
// TWO RUNS OF ONE FILE, and the second is not an extra: it is the only way to
// reach the state the whole of GP-352 is about. The reference rocket carries
// 2167 m/s and can afford every departure on both charts, so the affordability
// rule always falls inside the drawn band and the "you cannot pay for any of
// these" case is unreachable with it. `--evalargs='{"weak":1}'` builds a pod
// and an engine with no tank, which is GP-118's `dry-burn` vehicle, flies it to
// orbit with the cheat and asks the same questions of it.
//
// WHAT IS BEING PROVED.
//
// GP-351: the panel never said how long a transfer takes. Measured before the
// change, with Cinder selected: `LEAVE IN 00:00 / COSTS 1386 m/s / YOU HAVE
// 2167 m/s / CAPTURE INTO 84.0 km`, and then in prose "A transfer to the moon
// is hours long". HOW MANY HOURS was nowhere, on either chart, before or after
// arming, though `of_ap_departure_curve` word 3 has carried the arrival time
// since GP-271. The drawn duration is read back off the ELEMENT and parsed into
// seconds, then compared with the planner's own number, so the assertion is the
// painted string against /core rather than the client against a second copy of
// its own arithmetic (GP-64's rule).
//
// GP-352: the station's curve solves all 64 samples and the moon's refuses
// about 25 of them, and the two charts looked identical while behaving
// differently. Both behaviours are correct and neither may change, so the
// difference is DRAWN: a refused departure gets a shaded column, the counts are
// stated on both charts in one vocabulary, and the affordability rule is always
// on the picture even when it is off the scale. The probe therefore asserts
// BOTH SIDES of every one of those: a chart with refusals and a chart with
// none, a rule inside the band and a rule pinned to an edge, the explanatory
// note present where it applies and ABSENT where it does not. A cue that is on
// for every chart says nothing.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const A = typeof OF_ARGS === 'object' && OF_ARGS !== null ? OF_ARGS : {};
  const weak = A.weak === 1 || A.weak === true;
  const fails = [];
  const log = { mode: weak ? 'weak vehicle (pod + engine, no tank)' : 'reference rocket' };
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);
  const FM = () => of.flight('report');
  const F = () => of.flight('report').flight;
  const P = () => of.map('report').planner;

  /** MM:SS or H:MM:SS back into seconds, so the DRAWN text is what is compared
   *  and this file does not carry a second copy of `clock()`. */
  const parseClock = (s) => {
    const m = /(-?)(?:(\d+):)?(\d{1,2}):(\d{2})/.exec(String(s));
    if (m === null) return NaN;
    const v = Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]);
    return m[1] === '-' ? -v : v;
  };
  /** The DRAWN value of a readout row, by its drawn label. */
  const drawnRow = (label) => {
    for (const r of document.querySelectorAll('#of-map .row')) {
      const em = r.querySelector('em');
      if (em !== null && em.textContent.trim() === label) {
        return r.querySelector('b')?.textContent.trim() ?? '';
      }
    }
    return null;
  };
  const chartEl = () => document.querySelector('#of-map .pchart svg');
  const chartRead = () => {
    const el = chartEl();
    if (el === null) return null;
    const g = (k) => el.getAttribute(k);
    return {
      samples: Number(g('data-samples')), solved: Number(g('data-solved')),
      refused: Number(g('data-refused')), aff: g('data-aff'),
      gaps: g('data-gaps') ?? '', lo: Number(g('data-lo')),
      hi: Number(g('data-hi')),
      polylines: el.querySelectorAll('polyline').length,
      gapRects: el.querySelectorAll('rect.gap').length,
      affLines: el.querySelectorAll('line.afford').length,
      affPinned: el.querySelectorAll('line.afford.pinned').length,
    };
  };
  const legend = () => document.querySelector('#of-map .plegend')
    ?.innerText.replace(/\s+/g, ' ').trim() ?? null;
  const notes = () => [...document.querySelectorAll('#of-map .note')]
    .map((n) => n.textContent.replace(/\s+/g, ' ').trim());
  const pressRow = async (id) => {
    const el = document.querySelector(`#of-map [data-plan="${id}"]`);
    if (el === null) return `no row ${id}`;
    el.click();
    await sleep(2.2);            // past the curve latch, so the chart is this row's
    return P().selectedId;
  };
  const pressAct = async (act, settle = 1.0) => {
    const el = document.querySelector(`#of-map [data-plan-act="${act}"]`);
    if (el === null) return { landed: false, disabled: false };
    const disabled = el.disabled === true;
    el.click();
    await sleep(settle);
    return { landed: true, disabled };
  };

  // --- the vehicle ----------------------------------------------------------
  await sleep(0.8);
  of.build(0);
  of.vab('enter');
  await sleep(0.4);
  const cat = of.vab('catalogue');
  of.vab('press', 'clear');
  await sleep(0.15);
  // GP-118's dry-burn vehicle is a pod and an engine: real thrust, no
  // propellant, so it flies nothing. That is what makes every departure on the
  // chart unaffordable, which is the case the reference rocket cannot reach.
  for (const pid of weak ? [0x0100, 0x0103] : [0x0100, 0x0101, 0x0103]) {
    const i = cat.find((c) => c.id === pid)?.index ?? -1;
    if (i < 0) continue;
    of.vab('frame');
    of.vab('take', i);
    await sleep(0.12);
    const parts = of.vab('report').parts;
    if (parts.length === 0) { of.vab('place'); await sleep(0.12); continue; }
    let low = parts[0];
    for (const q of parts) if (q.origin[1] < low.origin[1]) low = q;
    const nodes = of.vab('nodes').filter((n) => n.parent === low.handle
      && n.onScreen && (n.kind === 'bottom' || n.kind === 'interstage'));
    if (nodes.length === 0) continue;
    of.vab('hover', nodes[0].ndc[0], nodes[0].ndc[1]);
    of.vab('place');
    await sleep(0.12);
  }
  of.vab('leave');
  await sleep(0.4);
  // TWICE, because GP-118's pre-flight verdict refuses a hopeless design on the
  // first press and launches it on the second, which is exactly the vehicle the
  // weak run wants.
  of.flight('rollout');
  await sleep(0.8);
  if (FM().rollouts === 0) { of.flight('rollout'); await sleep(0.8); }
  for (let i = 0; i < 16 && FM().distanceToVesselM > 10; ++i) {
    of.input.act(['forward'], 30);
    await sleep(0.6);
  }
  of.flight('board');
  await sleep(0.6);
  of.pause(true);
  await sleep(0.35);
  document.querySelector('#of-pause button[data-cheat="orbit"]')?.click();
  await sleep(1.5);
  of.pause(false);
  await sleep(1.2);
  if (!weak) {
    of.input.act(['stage'], 4);
    await sleep(0.6);
    of.input.act(['throttleCut'], 4);
    await sleep(0.6);
  }
  check('fixture: aboard and in orbit', F().status === 'ORBIT' && FM().aboard,
        `status ${F().status}`);
  if (F().status !== 'ORBIT') return { valid: false, why: 'no orbit', fails, log };

  const mapCode = (of.input.bindings().map || [])[0];
  window.dispatchEvent(new KeyboardEvent('keydown', { code: mapCode, bubbles: true }));
  await sleep(1.2);
  const r0 = P().run;
  check('fixture: the executor is on this bridge', r0.waitingOn === '',
        r0.waitingOn);

  // ==========================================================================
  // THE STATION: the chart with NO refusals, and (weak run) the rule off-scale.
  // ==========================================================================
  const rowIds = P().rowIds ?? [];
  const stationId = rowIds.find((x) => x.startsWith('v:'));
  check('there is a vessel destination to plan for', stationId !== undefined,
        rowIds.join(','));
  if (stationId === undefined) return { valid: false, why: 'no station', fails, log };
  log.stationSel = await pressRow(stationId);
  const st = { chart: chartRead(), legend: legend(),
               trip: drawnRow('trip takes'), arrive: drawnRow('arrive in'),
               leave: drawnRow('leave in'), notes: notes(),
               report: { samples: P().samples, solved: P().solved,
                         unsolved: P().unsolved, tripS: P().chosenTripS,
                         arriveTS: P().chosenArriveTS, tS: P().chosenTS,
                         dvAvail: P().run ? undefined : undefined,
                         verdict: P().verdict,
                         chosenFeasible: P().chosenFeasible } };
  log.station = st;
  check('the station chart is drawn', st.chart !== null);
  if (st.chart !== null) {
    check('every sample is priced: solved === samples',
          st.chart.solved === st.chart.samples,
          `${st.chart.solved} of ${st.chart.samples}`);
    check('so nothing is refused and no column is shaded',
          st.chart.refused === 0 && st.chart.gapRects === 0
          && st.chart.gaps === '',
          `refused ${st.chart.refused}, rects ${st.chart.gapRects}, `
          + `gaps "${st.chart.gaps}"`);
    check('the counts agree with the planner\'s own',
          st.chart.solved === st.report.solved
          && st.chart.refused === st.report.unsolved,
          `${st.chart.solved}/${st.chart.refused} vs `
          + `${st.report.solved}/${st.report.unsolved}`);
    check('the affordability rule is DRAWN whatever it reads',
          st.chart.affLines === 1, `${st.chart.affLines} lines`);
  }
  check('the legend states both counts', /priced/.test(st.legend ?? '')
        && /refused/.test(st.legend ?? ''), String(st.legend));
  // GP-351: the trip length, on the rendezvous chart too.
  check('the station panel says how long the trip is', st.trip !== null,
        'no `trip takes` row');
  check('and when it arrives', st.arrive !== null, 'no `arrive in` row');
  check('/core says the arrival is AFTER the departure',
        st.report.arriveTS > st.report.tS,
        `arrive ${st.report.arriveTS} vs leave ${st.report.tS}`);
  check('the DRAWN duration is the planner\'s own number',
        Math.abs(parseClock(st.trip) - st.report.tripS) <= 1.5,
        `drawn ${st.trip} = ${parseClock(st.trip)} s vs ${st.report.tripS}`);
  // The control for the refusal note: it must be ABSENT on a chart with none.
  check('a chart with no refusals does NOT explain a refusal',
        !st.notes.some((n) => /shaded columns/.test(n)),
        st.notes.filter((n) => /shaded/.test(n)).join(' | '));

  if (weak) {
    // ======================================================================
    // THE CASE THE REFERENCE ROCKET CANNOT REACH: every departure priced and
    // NONE affordable. Before GP-352 the rule was drawn only when it fell
    // between lo and hi, so this state drew a perfectly ordinary curve with
    // nothing on it saying the vehicle could not fly any of it.
    // ======================================================================
    check('the rule is pinned BELOW the whole curve',
          st.chart?.aff === 'below', `aff ${st.chart?.aff}`);
    check('and it is drawn as pinned rather than omitted',
          st.chart?.affPinned === 1, `${st.chart?.affPinned}`);
    check('the panel says so in words', st.notes.some(
      (n) => /BELOW this whole curve/.test(n)),
    st.notes.join(' | ').slice(0, 200));
    check('the verdict is a refusal about the VEHICLE', P().verdict === 'never',
          P().verdict);
    const arm = await pressAct('arm', 0.6);
    check('and the arm button is disabled', arm.landed && arm.disabled === true,
          JSON.stringify(arm));
    return { valid: fails.length === 0, fails, log };
  }

  // ==========================================================================
  // THE REQUESTED ORBIT AT ITS DEFAULT: the rule off the TOP.
  //
  // GP-301 found that the default requested orbit is the one you are already
  // in, so its curve costs nothing and 2167 m/s is far above all of it. That
  // makes it the cheap, reachable second value of `data-aff` in this same run,
  // which is what stops that attribute from being a constant nobody has seen
  // take another value.
  // ==========================================================================
  log.orbitSel = await pressRow('orbit');
  const ob = { chart: chartRead(), notes: notes() };
  log.requestedOrbit = ob;
  check('the requested-orbit chart is drawn', ob.chart !== null);
  check('with the rule pinned ABOVE the whole curve', ob.chart?.aff === 'above',
        `aff ${ob.chart?.aff} lo ${ob.chart?.lo} hi ${ob.chart?.hi}`);
  check('drawn as pinned', ob.chart?.affPinned === 1, `${ob.chart?.affPinned}`);
  check('and said in words', ob.notes.some((n) => /ABOVE this whole curve/.test(n)),
        ob.notes.join(' | ').slice(0, 200));
  check('so `data-aff` is not a constant: the station read something else',
        st.chart?.aff !== ob.chart?.aff,
        `station ${st.chart?.aff} vs orbit ${ob.chart?.aff}`);

  // ==========================================================================
  // THE MOON: the chart WITH refusals, against the station's without.
  // ==========================================================================
  log.moonSel = await pressRow('b:cinder');
  const mn = { chart: chartRead(), legend: legend(),
               trip: drawnRow('trip takes'), arrive: drawnRow('arrive in'),
               notes: notes(),
               report: { samples: P().samples, solved: P().solved,
                         unsolved: P().unsolved, tripS: P().chosenTripS,
                         arriveTS: P().chosenArriveTS, tS: P().chosenTS } };
  log.moon = mn;
  check('the moon chart is drawn', mn.chart !== null);
  if (mn.chart !== null) {
    check('it REFUSES some departures', mn.chart.refused > 0,
          `${mn.chart.refused} of ${mn.chart.samples}`);
    check('and every refusal is accounted for',
          mn.chart.refused === mn.chart.samples - mn.chart.solved,
          `${mn.chart.refused} vs ${mn.chart.samples} - ${mn.chart.solved}`);
    check('each refused RUN is drawn as a shaded column',
          mn.chart.gapRects > 0
          && mn.chart.gapRects === mn.chart.gaps.split(';').filter(Boolean).length,
          `${mn.chart.gapRects} rects vs "${mn.chart.gaps}"`);
    check('the line still stops rather than crossing them: more than one run',
          mn.chart.polylines > 1, `${mn.chart.polylines} polylines`);
  }
  check('the moon panel explains what a shaded column means',
        mn.notes.some((n) => /shaded columns/.test(n) && /REFUSE/.test(n)),
        mn.notes.join(' | ').slice(0, 240));
  // THE HEADLINE. The two screens used to be indistinguishable at the moment a
  // player most needs to read them.
  check('the two charts now SAY different things',
        mn.legend !== st.legend, `both read "${st.legend}"`);
  check('the station said nothing was refused and the moon says how many',
        /\b0 refused\b/.test(st.legend ?? '')
        && new RegExp(`\\b${mn.chart?.refused} refused\\b`).test(mn.legend ?? ''),
        `station "${st.legend}" moon "${mn.legend}"`);
  // GP-351 on the moon, which is the trip that is actually hours long.
  check('the moon panel says how long the trip is', mn.trip !== null);
  check('the DRAWN moon duration is the planner\'s own number',
        Math.abs(parseClock(mn.trip) - mn.report.tripS) <= 1.5,
        `drawn ${mn.trip} = ${parseClock(mn.trip)} s vs ${mn.report.tripS}`);
  check('and the warp advice now carries that number instead of "hours"',
        mn.notes.some((n) => /This trip is/.test(n) && n.includes(mn.trip)),
        mn.notes.filter((n) => /This trip/.test(n)).join(' | '));
  // TWO ROWS OR ONE FIELD DRAWN TWICE? At the default departure `leave in` is
  // 00:00, so `arrive in` and `trip takes` are legitimately the same number and
  // a check that they agree there would be an identity trap (INSTRUMENTS.md).
  // Pushing the departure later must separate them, or one of them is a copy.
  await pressAct('later', 1.4);
  const later = { leave: drawnRow('leave in'), trip: drawnRow('trip takes'),
                  arrive: drawnRow('arrive in'), tS: P().chosenTS,
                  tripS: P().chosenTripS, arriveTS: P().chosenArriveTS };
  log.oneLater = later;
  check('a later departure moves `leave in` off zero', later.tS > 0,
        `${later.tS}`);
  check('and `arrive in` then differs from `trip takes` by exactly that, so '
        + 'they are two quantities and not one drawn twice',
        Math.abs((later.arriveTS - later.tripS) - later.tS) <= 1.5
        && parseClock(later.arrive) !== parseClock(later.trip),
        `leave ${later.leave} trip ${later.trip} arrive ${later.arrive}`);
  await pressAct('earlier', 1.4);

  // ==========================================================================
  // ARMED: the executor has a countdown to the NEXT ignition and nothing about
  // the voyage, so the plan's own duration is latched and drawn beside it.
  // ==========================================================================
  await pressAct('cheapest');
  const tripAtArm = P().chosenTripS;
  await pressAct('arm', 1.5);
  const run = P().run;
  log.armed = { armed: run.armed, burnCount: run.burnCount,
                phaseWord: run.phaseWord, quotedTripS: run.quotedTripS,
                timeToIgnitionS: run.timeToIgnitionS,
                drawnTrip: drawnRow('the chart said the trip is'),
                drawnIgnition: drawnRow('light it in'), tripAtArm };
  check('fixture: something is actually armed',
        run.armed === true && run.burnCount > 0,
        `${run.burnCount} burns`);
  check('the armed panel says how long the whole trip is',
        log.armed.drawnTrip !== null, 'no `the chart said the trip is` row');
  check('and it is the duration that was on the chart when the button went down',
        Math.abs(run.quotedTripS - tripAtArm) <= 1.5,
        `${run.quotedTripS} vs ${tripAtArm}`);
  check('the drawn one matches it',
        Math.abs(parseClock(log.armed.drawnTrip) - run.quotedTripS) <= 1.5,
        `${log.armed.drawnTrip} vs ${run.quotedTripS}`);
  check('and the ignition countdown is a DIFFERENT number, so the panel is not '
        + 'saying one thing twice',
        Math.abs(parseClock(log.armed.drawnTrip)
                 - Math.abs(run.timeToIgnitionS)) > 60,
        `trip ${log.armed.drawnTrip} vs ignition ${log.armed.drawnIgnition}`);

  return { valid: fails.length === 0, fails, log };
})()
