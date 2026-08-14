// discbody.js (PS-46 to PS-48, GP-725): THE DISCOVERY FIELD FOLLOWS THE BODY.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:4407/ --scenario=walk \
//     --settle=10 --width=320 --height=180 \
//     --evalfile=tools/smoke/probes/discbody.js
//
// -----------------------------------------------------------------------------
// THE DEFECT THIS EXISTS FOR (GP-725, recorded by the station-reveal lane and
// measured again here before anything was written).
//
// `Boot.ts` calls `bootMap` OUTSIDE `buildBodyScope`, so the `Discovery` driver
// is constructed once with the BOOT body's id and `WorldSession.reboot` never
// re-cuts the field. /core keeps ONE `g_disc` whose lattice resolution is a
// function of body radius, so after a switch the player walks on Cinder and
// their observations land in FORGE's lattice, at Forge's cell size, and the
// autosave then writes that mixture into the Forge world of the slot.
//
// Measured on the pre-fix build by this file, verbatim from the red run:
// after `of.reboot(1)` the world was Cinder (`of.world().bodyRadiusM` 200000)
// while the discovery field still reported `bodyRadiusM` 600000, a 9,375 m
// survey cell, and `surveyFraction` **1** -- a moon reporting a fully surveyed
// map because a station in FORGE orbit had handed one over. See §2.
//
// -----------------------------------------------------------------------------
// WHY THE ROUND TRIP IS THE ASSERTION AND A COUNT IS NOT.
//
// "Forge came back as it was left" cannot be asserted on `surveyCells`: two
// different lattices can hold the same number of cells, and the survey layer is
// FULL here (§1 reveals it), so it is the one number that cannot fall when
// another body's observations are poured into it. So §4 compares the SERIALIZED
// BYTES -- length and FNV-1a hash of `_of_disc_serialize`, off the same call --
// which is the same stream the save carries. That is the strongest identity the
// debug surface can express without shipping 10 KB of array through `evaluate`
// on every read.
//
// -----------------------------------------------------------------------------
// THE THREE THINGS A PROBE HERE CAN FOOL ITSELF WITH.
//
//  1. A REBOOTED SESSION IS A KNOWN-BROKEN WORLD (`of.life().stale`, seven
//     holders, VisitWorlds.ts's own measurement). This probe therefore does the
//     MINIMUM on the far body -- teleport hops and short runs, no building, no
//     digging, no flight -- because anything richer would be measuring the
//     residue rather than the field. The shipped door to another body is a page
//     reload, and `tools/smoke/twobody.mjs` is the gate for THAT path; this file
//     is the gate for the in-page one, which is where GP-725 lives.
//  2. `of.run(s, hz)` DOES NOT DELIVER `s` SECONDS BELOW 12 Hz (GP-726). Every
//     duration here is either irrelevant to a bound or read back off
//     `of.world().tick`. RENDER_HZ is 12 for the same reason stationreveal.js
//     pins it: 60/12 = 5 is exactly `Loop.MAX_CATCHUP`.
//  3. THE 20 s AUTOSAVE WRITES THE SAME SLOT (GP-727). §3 reads the store
//     IMMEDIATELY after its own forced save, and it compares the stored blob
//     against a mark taken before the switch rather than against a re-read of
//     the live field, so an autosave landing in between changes which moment is
//     being read but not what it is being compared with.
//
// Standing rule 11: every bound below is derived from a number read off the
// client in this run (the lattice totals, the cell edges, the marks) or is an
// exact equality. Nothing was tuned to make a run pass.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['map', 'game', 'carrier', 'world', 'run', 'teleport',
                   'save', 'reboot', 'life', 'station']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };

  const RENDER_HZ = 12;
  const run = (s) => of.run(s, RENDER_HZ);
  const D = () => of.map('disc').discovery;
  const RIDE = () => of.carrier('census').ride;
  const MILES = () => of.game()?.progress?.research?.milestones ?? [];
  const STATION_BOARDED = 0x0004;   // research.h milestones::StationBoarded
  const boarded = () => MILES().filter((m) => m === STATION_BOARDED).length;
  const FORGE_R = 600000;
  const CINDER_R = 200000;

  /** Everything that identifies a discovery field, as ONE reducer, so the two
   *  bodies and the two moments cannot be reduced differently and then
   *  compared. `saveHash` is the byte-level half (Discovery.bytesDigest). */
  const mark = () => {
    const d = D();
    return {
      bodyRadiusM: d.bodyRadiusM,
      surveyCellSizeM: d.surveyCellSizeM,
      surveyCells: d.surveyCells,
      exploreCells: d.exploreCells,
      surveyFraction: d.surveyFraction,
      saveBytes: d.saveBytes,
      saveHash: d.saveHash,
      observations: d.observations,
    };
  };
  const same = (a, b) => a.bodyRadiusM === b.bodyRadiusM
    && a.surveyCells === b.surveyCells && a.exploreCells === b.exploreCells
    && a.saveBytes === b.saveBytes && a.saveHash === b.saveHash;
  const brief = (m) => `R${m.bodyRadiusM} survey ${m.surveyCells} explore `
    + `${m.exploreCells} bytes ${m.saveBytes} hash ${m.saveHash}`;

  /**
   * THE STORE, RAW. Every view above the store reported the pre-PS-40 slot as
   * complete, which is why this reads the record and not the ledger.
   *
   * WHICH KEY IS NOT GUESSED FROM THE MODE AND THE FIRST DRAFT OF THIS FILE DID
   * GUESS. It filtered for a key starting with `auto-`, which is the SANDBOX
   * spelling: `SaveGame.slotKey` writes survival under the bare string `auto`,
   * so the read came back null on a survival scenario and the check that
   * depended on it failed for a reason that had nothing to do with the subject.
   * It now reads BOTH autosave keys and takes the one written most recently,
   * which is the one `of.save()` has just produced, so this file holds no copy
   * of the key rule at all.
   */
  const rawSlot = async () => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('orbital-foundry', 1);
      q.onerror = () => rej(q.error);
      q.onsuccess = () => res(q.result);
    });
    const one = (key) => new Promise((res, rej) => {
      const g = db.transaction('saves', 'readonly').objectStore('saves').get(key);
      g.onsuccess = () => res(g.result ?? null);
      g.onerror = () => rej(g.error);
    });
    const found = [];
    for (const k of ['auto', 'auto-sandbox']) {
      const s = await one(k);
      if (s !== null) found.push({ key: k, slot: s });
    }
    db.close();
    found.sort((a, b) => (b.slot.savedAt ?? 0) - (a.slot.savedAt ?? 0));
    if (found.length === 0) return null;
    const key = found[0].key;
    const slot = found[0].slot;
    const reduce = (w) => ({ body: w.body, discoveryBytes: (w.discovery ?? []).length });
    return {
      key: String(key),
      top: reduce({ ...slot, body: slot.body ?? 0 }),
      others: (slot.others ?? []).map(reduce),
    };
  };
  const worldIn = (raw, body) => raw === null ? null
    : raw.top.body === body ? raw.top : (raw.others.find((w) => w.body === body) ?? null);

  /** Four 2-degree hops, which on any body is more than two survey cells, so
   *  each one lands where the last was not. The multiplier is the BODY's, read
   *  off the client, so the same call is honest on a 200 km moon. */
  const hop = async (base) => {
    const out = [];
    for (let i = 1; i <= 4; i++) {
      of.teleport(base + i * 2.0, i * 2.0, 0);
      await run(2.0);
      out.push(D().exploreCells);
    }
    return out;
  };

  await run(1.5);

  // ===========================================================================
  // §0 - THE FIXTURE. DW-20: nothing below is believed until this is.
  // ===========================================================================
  const d0 = D();
  check('§0 the world boots on Forge', of.world().bodyRadiusM === FORGE_R,
    `${of.world().bodyRadiusM}`);
  check('§0 the discovery field is cut for the body the player is on',
    d0.bodyRadiusM === FORGE_R, `${d0.bodyRadiusM}`);
  check('§0 with Forge\'s 9,375 m survey lattice',
    Math.abs(d0.surveyCellSizeM - 9375) < 1e-6, `${d0.surveyCellSizeM}`);
  check('§0 a fresh world has not boarded the station', boarded() === 0,
    JSON.stringify(MILES()));
  check('§0 and has not got the full map', d0.surveyFraction < 1,
    `${d0.surveyFraction}`);
  const FORGE_TOTAL = Math.round(d0.surveyCells / d0.surveyFraction);
  check('§0 Forge\'s survey lattice total is derivable and is 6 * side^2',
    Number.isFinite(FORGE_TOTAL) && FORGE_TOTAL > 0 && FORGE_TOTAL % 6 === 0
    && Number.isInteger(Math.sqrt(FORGE_TOTAL / 6)), `${FORGE_TOTAL}`);

  // ===========================================================================
  // §1 - FILL FORGE'S MAP THROUGH THE SHIPPED DOOR, so the mark is unmistakable.
  // ===========================================================================
  //
  // The station reveal (GP-717) is used rather than a long walk for two
  // reasons: it puts the survey layer at EXACTLY 1.0, which is a value no
  // amount of walking on another body can produce by accident, and it is the
  // second half of this lane's brief -- the full-map reveal must stay home-body
  // only and must survive a body round trip.
  const seat = of.carrier('seat');
  check('§1 the shipped seat put the walker on the station',
    seat !== null && seat.carrier === 'station:anchorage', JSON.stringify(seat));
  await run(1.5);
  const revealed = mark();
  check('§1 boarding revealed the whole survey layer on Forge',
    revealed.surveyFraction === 1 && revealed.surveyCells === FORGE_TOTAL,
    `${revealed.surveyCells} of ${FORGE_TOTAL}, fraction ${revealed.surveyFraction}`);
  check('§1 the milestone was earned exactly once', boarded() === 1,
    JSON.stringify(MILES()));
  of.carrier('release');
  await run(1.0);
  // THE MARK IS THE LAST THING BEFORE THE SWITCH AND THE FIRST THING AFTER THE
  // RETURN, and the first draft of this file got that wrong in both directions.
  // It marked Forge before a release and a second of walking, then compared the
  // return against it and read the 446 bytes the walker had honestly added as a
  // failure. The claim being made is about THE SWITCH -- "the body change moved
  // nothing" -- so the two readings have to bracket the switch and nothing else.
  // Every frame between them is a real observation and belongs to neither side.
  const forgeMark = mark();
  check('§1 the field has bytes to compare', forgeMark.saveBytes > 0
    && forgeMark.saveHash !== 0, brief(forgeMark));
  log.push(`§1 Forge marked: ${brief(forgeMark)}`);

  // ===========================================================================
  // §2 - THE BODY CHANGES. THIS IS GP-725.
  // ===========================================================================
  let rebootErr = null;
  try { await of.reboot(1); } catch (e) { rebootErr = String(e); }
  check('§2 the world rebooted onto the moon', rebootErr === null, rebootErr ?? '');
  const worldR2 = of.world().bodyRadiusM;
  check('§2 the world really is Cinder', worldR2 === CINDER_R, `${worldR2}`);
  // READ BEFORE A SINGLE FRAME HAS RUN, so this is what the SWITCH produced and
  // not what the switch plus three seconds of moon produced. A first visit must
  // arrive at an EMPTY field, which is a sharper statement than "not Forge's":
  // it rules out a partial carry as well as a whole one.
  const arrived = mark();
  log.push(`§2 arrived on the moon: world radius ${worldR2}, field ${brief(arrived)}`);
  check('§2 a first visit to the moon arrives with an EMPTY field',
    arrived.surveyCells === 0 && arrived.exploreCells === 0,
    brief(arrived));
  of.teleport(0, 0, 0);
  await run(3.5);
  const cinder0 = mark();
  log.push(`§2 after settling on the moon: ${brief(cinder0)}`);
  // THE CROSSING. Pre-fix all three of these are red and the numbers in the
  // detail are Forge's, which is the whole finding.
  check('§2 the discovery field was RE-CUT for the body the player is now on',
    cinder0.bodyRadiusM === CINDER_R,
    `field says ${cinder0.bodyRadiusM}, world says ${worldR2}`);
  check('§2 and the moon did NOT arrive holding the planet\'s revealed map',
    cinder0.surveyFraction < 1 && cinder0.saveHash !== forgeMark.saveHash,
    `fraction ${cinder0.surveyFraction}, hash ${cinder0.saveHash} vs Forge's `
    + `${forgeMark.saveHash}`);
  const CINDER_TOTAL = cinder0.surveyFraction > 0
    ? Math.round(cinder0.surveyCells / cinder0.surveyFraction) : 0;
  check('§2 the moon has taken at least one observation to be measured by',
    cinder0.surveyCells > 0 && CINDER_TOTAL > 0,
    `${cinder0.surveyCells} cells, fraction ${cinder0.surveyFraction}`);
  check('§2 the moon\'s lattice is a different lattice from the planet\'s',
    CINDER_TOTAL !== FORGE_TOTAL, `${CINDER_TOTAL} vs ${FORGE_TOTAL}`);
  // AND IT IS THE MOON'S OWN LATTICE, by the identity that defines the grid
  // rather than by "the cell got smaller", which the first draft asserted and
  // which is not true in general: the cell target is 10 km and a smaller body
  // can land on a LARGER cell than Forge's 9,375 m. `cellSizeAtFaceCentre` is
  // 2R/side by construction (9,375 * 128 = 1,200,000 = 2 * 600,000 on Forge),
  // so the lattice has to span the body it claims to be cut for.
  const cinderSide = Math.sqrt(CINDER_TOTAL / 6);
  check('§2 and the moon\'s lattice spans the MOON: cell * side === 2R',
    Math.abs(cinder0.surveyCellSizeM * cinderSide - 2 * CINDER_R) < 1e-6,
    `${cinder0.surveyCellSizeM} m x ${cinderSide} vs 2 * ${CINDER_R}`);

  // ===========================================================================
  // §3 - WALKING ON THE MOON WRITES INTO THE MOON.
  // ===========================================================================
  const moonHops = await hop(0);
  const cinderMark = mark();
  check('§3 the moon\'s own exploring is being recorded',
    cinderMark.exploreCells > cinder0.exploreCells,
    `${cinder0.exploreCells} -> ${cinderMark.exploreCells} (${moonHops.join(' -> ')})`);
  check('§3 and it is still the moon\'s lattice it is being recorded in',
    cinderMark.bodyRadiusM === CINDER_R, `${cinderMark.bodyRadiusM}`);
  log.push(`§3 Cinder marked: ${brief(cinderMark)}`);

  // A SAVE TAKEN WHILE STANDING ON THE FAR BODY MUST NOT PUT THE FAR BODY'S
  // LATTICE INTO THE HOME BODY'S WORLD. `Gameplay.bodyId` is boot-captured
  // (persistence R-BODY-2, core-engine's residue), so the slot this write
  // produces still says body 0 -- which is exactly why the BYTES it carries have
  // to be body 0's. Pre-fix the live field IS the polluted Forge lattice and
  // this stores it; post-fix the write takes Forge's own stashed stream.
  const saved = await of.save();
  const raw = await rawSlot();
  const w0 = worldIn(raw, 0);
  check('§3 the save was written and could be read back raw',
    saved !== null && raw !== null && w0 !== null,
    JSON.stringify({ saved, key: raw === null ? null : raw.key }));
  check('§3 a save taken on the moon stores the PLANET\'s discovery under the '
    + 'planet, byte for byte',
    w0 !== null && w0.discoveryBytes === forgeMark.saveBytes,
    `slot holds ${w0 === null ? 'no world 0' : w0.discoveryBytes} bytes, Forge `
    + `was marked at ${forgeMark.saveBytes}, the live moon field is `
    + `${cinderMark.saveBytes}`);

  // ===========================================================================
  // §4 - AND BACK. THE PLANET'S FIELD IS EXACTLY WHAT IT WAS, PLUS NOTHING.
  // ===========================================================================
  let backErr = null;
  try { await of.reboot(0); } catch (e) { backErr = String(e); }
  check('§4 the world rebooted back to the planet', backErr === null, backErr ?? '');
  check('§4 the world really is Forge again', of.world().bodyRadiusM === FORGE_R,
    `${of.world().bodyRadiusM}`);
  const forgeBack = mark();
  log.push(`§4 Forge returned: ${brief(forgeBack)}`);
  check('§4 the planet\'s field came back BYTE FOR BYTE as it was left',
    same(forgeBack, forgeMark), `left ${brief(forgeMark)}; back ${brief(forgeBack)}`);
  check('§4 the station\'s full map survived the round trip',
    forgeBack.surveyFraction === 1 && forgeBack.surveyCells === FORGE_TOTAL,
    `${forgeBack.surveyCells} of ${FORGE_TOTAL}`);
  check('§4 and none of the moon\'s exploring came home with it',
    forgeBack.exploreCells === forgeMark.exploreCells,
    `left with ${forgeMark.exploreCells} explore cells, came back with `
    + `${forgeBack.exploreCells}; the moon added `
    + `${cinderMark.exploreCells - cinder0.exploreCells} of its own`);
  check('§4 the milestone is still spent exactly once, so no second reveal fired',
    boarded() === 1, JSON.stringify(MILES()));
  // WALK THE PLANET AGAIN BEFORE GOING BACK TO THE MOON, deliberately: it makes
  // §5's claim the stronger one. The moon's stream has to survive not just a
  // switch but a switch plus somebody else using the field it was taken out of.
  of.teleport(0, 0, 0);
  await run(2.5);
  const forgeAgain = mark();
  check('§4 and the planet goes on recording its own walking afterwards',
    forgeAgain.exploreCells >= forgeBack.exploreCells
    && forgeAgain.bodyRadiusM === FORGE_R,
    `${forgeBack.exploreCells} -> ${forgeAgain.exploreCells} at R${forgeAgain.bodyRadiusM}`);

  // ===========================================================================
  // §5 - THE MOON'S OWN ROUND TRIP, which is the half a one-way test cannot see.
  // ===========================================================================
  let backErr2 = null;
  try { await of.reboot(1); } catch (e) { backErr2 = String(e); }
  check('§5 the world rebooted onto the moon a second time', backErr2 === null,
    backErr2 ?? '');
  const cinderBack = mark();
  log.push(`§5 Cinder returned: ${brief(cinderBack)}`);
  check('§5 the moon\'s field came back byte for byte too',
    same(cinderBack, cinderMark),
    `left ${brief(cinderMark)}; back ${brief(cinderBack)}`);
  check('§5 and the moon still has NOT been handed the station\'s full map',
    cinderBack.surveyFraction < 1, `${cinderBack.surveyFraction}`);

  // ===========================================================================
  // §6 - THE HOLDER LIST KNOWS ABOUT THIS FIELD NOW.
  // ===========================================================================
  //
  // GP-725 was invisible to `of.life().stale` for the same reason it was
  // invisible to everything else: the discovery field was not on the list of
  // things that get asked what body they believe in. It is now, and this is the
  // check that would have caught the original defect on any switch.
  const stale = (of.life()?.stale ?? []).filter((h) => h.stale);
  const discRow = (of.life()?.stale ?? []).find((h) => h.holder === 'discovery');
  check('§6 the discovery field is on the stale-holder list at all',
    discRow !== undefined, JSON.stringify((of.life()?.stale ?? []).map((h) => h.holder)));
  check('§6 and it is not stale after a switch',
    discRow !== undefined && discRow.stale === false, JSON.stringify(discRow));
  log.push(`§6 stale holders after three switches: `
    + `${stale.map((h) => `${h.holder}.${h.field}`).join(', ') || 'none'}`);

  return {
    valid: fails.length === 0,
    fails,
    log,
    findings: [
      'PS-46: the discovery field is re-seated per body inside buildBodyScope '
      + '(Boot.ts holder, the R17 station-mount shape), and each body\'s stream '
      + 'is stashed on the way out and restored on the way back.',
      'PS-47: a save written while the session is on a body the slot does not '
      + 'name carries the NAMED body\'s discovery stream, never the live one.',
      'GP-725 is closed on the in-page path. The shipped page-reload door was '
      + 'already correct and is gated by tools/smoke/twobody.mjs.',
      'PS-48 (harness, this file): CINDER\'S SURVEY CELL IS 12,500 m, LARGER '
      + 'than Forge\'s 9,375 m. A smaller body does not mean a smaller cell -- '
      + 'the target is 10 km and the side is quantised - so "the cell got '
      + 'smaller" is not a test for "the right lattice". cell * side === 2R is.',
    ],
    forgeTotal: FORGE_TOTAL,
    cinderTotal: CINDER_TOTAL,
    forgeMark, cinderMark, forgeBack, cinderBack,
    moonHops,
    slot: raw,
    milestones: MILES(),
    staleAfter: stale.map((h) => `${h.holder}.${h.field}`),
  };
})()
