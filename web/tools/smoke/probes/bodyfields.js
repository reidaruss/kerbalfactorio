// bodyfields.js (PS-49 to PS-52, persistence R-BODY-2): AFTER AN IN-PAGE BODY
// SWITCH, THE SLOT'S BODY-0 HALF IS STILL BODY 0's WORLD.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:4427/ --sandbox=1 \
//     --scenario=walk --settle=10 --width=320 --height=180 \
//     --evalfile=tools/smoke/probes/bodyfields.js
//
// SANDBOX IS REQUIRED, not a convenience: `freeBuild` is what lets the fixture
// put a smelter, a foundation and a wall down without first mining for them,
// and a fixture that could not build is a fixture that cannot exhibit this
// defect (see §1's refusal).
//
// -----------------------------------------------------------------------------
// THE DEFECT THIS EXISTS FOR, MEASURED BY THIS FILE'S OWN FIXTURE ON THE
// UNFIXED BUILD (verbatim from the red run, sandbox, one browser context):
//
//   Forge:                    5,776 removed voxel cells / 6 ops under body 0.
//   after `of.reboot(1)`:     the same 5,776 / 6 -- and `poi` 2 -> 0.
//   3 dig strikes on Cinder:  8,786 cells / 9 ops STORED UNDER BODY 0.
//   back on Forge:            8,786 / 9. Permanent.
//
// `slot.body` follows `Gameplay.bodyId`, which boot captured and
// `WorldSession.reboot` deliberately does not rebuild, so a save taken on the
// moon NAMES Forge; until PS-49 it also carried whatever the live populations
// held, which after a switch is Forge's world plus the moon's digging. The moon
// contribution above is 3,010 cells that no Forge player ever cut.
//
// AND `poi` IS DESTROYED RATHER THAN CROSSED, which is the sharper half and is
// invisible in a cell count. `_of_poi_save(g.bodyHandle)` is called with the
// BOOT handle, and `WorldSession.reboot` FREES that handle (`newBody()` ->
// `old.dispose()`), so on the moon the call refuses and the save writes zero
// poi bytes over the two that were there. Same adopt-then-wipe shape PS-47
// found in `discovery`, one field over.
//
// -----------------------------------------------------------------------------
// WHY THE ASSERTION IS "THE STORED HALF EQUALS THE MARK **AND** THE LIVE WORLD
// HAS MOVED PAST IT", AND NOT JUST THE FIRST HALF.
//
// "The slot still holds Forge's counts" passes trivially on a run that failed
// to dig on the moon, which is exactly what a broken fixture looks like. §4
// therefore asserts BOTH: the stored body-0 voxel set is the mark, and the LIVE
// edit set is strictly bigger than the mark. The second is the pre-fix number,
// read in the same run off the same client: on the unfixed build the stored
// value IS the live one, so this pair is the negative control and the
// assertion at once, with no second build to point at.
//
// -----------------------------------------------------------------------------
// THE THREE THINGS A PROBE HERE CAN FOOL ITSELF WITH.
//
//  1. A SAME-BODY REBOOT MUST NOT FREEZE ANYTHING. `worldreboot.js`,
//     `stationreboot.js` and `carrier.js` all call `of.reboot()` with no
//     argument as their negative control, and a freeze there would silently
//     stop every save in those runs. §2 does it FIRST, before any body change,
//     and asserts the save is still live afterwards. Without this the whole
//     mechanism could be "freeze on any rebuild" and every check below would
//     still be green.
//  2. THE PROBE'S FIELD LIST CAN DRIFT FROM `WORLD_KEYS`. This file enumerates
//     the body-scoped fields to count them, which is a second copy of a list
//     the compiler guards on the client side and does not guard here. §5
//     compares this file's list against the client's own
//     (`of.save().world.frozenCounts`, derived from the world rather than
//     written down) and goes red if a field exists that this file does not
//     count. A field added and not counted would otherwise be a field this
//     gate silently stops covering.
//  3. THE 20 s AUTOSAVE WRITES THE SAME SLOT (GP-727). Every read below follows
//     its own forced `of.save()` immediately, and every comparison is against a
//     mark taken before the switch rather than against a re-read of the live
//     world, so an autosave landing in between changes which moment is read and
//     not what it is compared with. The survival autosave key is the bare
//     string `auto` and the sandbox one is `auto-sandbox` (PS-48): both are
//     read and the newest `savedAt` wins, so this file holds no copy of the key
//     rule.
//
// Standing rule 11: every bound below is an exact equality against a number
// read off the client earlier in the same run, or a strict inequality whose
// direction is the defect. Nothing was tuned to make a run pass.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['world', 'run', 'save', 'reboot', 'life', 'dig', 'voxels',
                   'nodes', 'harvest', 'hotbar', 'build', 'look',
                   'teleport', 'game', 'carrier']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  if (typeof of.input?.tape !== 'function') return { valid: false, why: 'no __of.input.tape' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };
  const RENDER_HZ = 12;                   // GP-726 / discbody.js's reason.
  const run = (s) => of.run(s, RENDER_HZ);
  const FORGE_R = 600000;
  const CINDER_R = 200000;

  /**
   * THE FIFTEEN BODY-SCOPED FIELDS, COUNTED OFF THE RAW STORED WORLD.
   *
   * One reducer for both bodies and every moment, so two readings cannot be
   * reduced differently and then compared -- discbody.js's `mark` rule. The
   * unit is a LENGTH per field rather than a hash, because the claim is per
   * field ("Forge's buildings are still Forge's buildings") and a whole-world
   * hash would say only that something moved.
   */
  const KEYS = ['depletion', 'patches', 'rocks', 'trees', 'buildings',
    'machines', 'discovery', 'poi', 'sites', 'structures', 'pads', 'health',
    'stations', 'antennas'];
  const reduce = (w) => {
    const out = { body: w.body ?? 0 };
    for (const k of KEYS) out[k] = (w[k] ?? []).length;
    // `voxels` is the one body-scoped field that is not an array: two arrays
    // in an object, counted as two because a dig op and the cells it cut are
    // separately load-bearing.
    //
    // AND `cells` IS A BYTE ARRAY, NOT A CELL COUNT, which the first draft of
    // this file got wrong and which cost it a red check on a correct build:
    // `snapshotEdits` stores `_of_edits_serialize`'s BYTES (`PersistSlot` even
    // names its own summary field `voxelBytes`), while `of.voxels().removedCells`
    // is /core's own cell tally, and the two differ by two orders of magnitude
    // (5,734 against 54 in the run that caught it). Named for what it is here,
    // and never compared with a live cell count.
    out['voxels.bytes'] = (w.voxels?.cells ?? []).length;
    out['voxels.ops'] = (w.voxels?.ops ?? []).length;
    return out;
  };
  const differs = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k])
    .map((k) => `${k} ${a[k]} -> ${b[k]}`);
  const brief = (m) => Object.entries(m).filter(([, v]) => v !== 0)
    .map(([k, v]) => `${k} ${v}`).join(' ');

  /** THE STORE, RAW: every view above the store reported the pre-PS-40 slot as
   *  complete, which is why this reads the record and not the ledger. */
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
    const slot = found[0].slot;
    return {
      key: found[0].key,
      version: slot.version,
      savedAt: slot.savedAt,
      packBytes: (slot.pack ?? []).length,
      top: reduce({ ...slot, body: slot.body ?? 0 }),
      others: (slot.others ?? []).map(reduce),
    };
  };
  /** Never `others[0]` and never `slot.body === 0`: PS-40 trap 5, which the
   *  first draft of `twobody.mjs` walked into in both forms. */
  const worldIn = (raw, body) => raw === null ? null
    : raw.top.body === body ? raw.top
      : (raw.others.find((w) => w.body === body) ?? null);

  /** Put whatever is armed down, sweeping steep pitches first for chestsave's
   *  reason (`FactoryGhost.march` stops the ray at the ground, so a shallow
   *  pitch lands the ghost tens of metres away). Returns the field that rose. */
  const place = async () => {
    const before = await of.save();
    const yaw0 = of.world().observer.yawDeg;
    for (let t = 0; t < 8; ++t) {
      for (let p = -80; p <= -6; p += 2) {
        of.look(yaw0 + t * 45, p);
        await run(0.05);
        const r = of.build();
        const g = r.ghost ?? r.structGhost ?? r.padGhost ?? null;
        if (g === null || g.ok !== true) continue;
        of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 5, keys: [] }]);
        await run(0.35);
        const s = await of.save();
        for (const k of ['buildings', 'structures', 'sites', 'machines', 'pads']) {
          if ((s?.[k] ?? 0) > (before?.[k] ?? 0)) return k;
        }
      }
    }
    return null;
  };
  /** Strike straight down `n` times: the one aim that finds ground on either
   *  body, which is what makes the two halves of this run comparable
   *  (bodydig.js's rule). Returns the strike count AND the radius of the last
   *  hit, because "did it cut the right planet" is answered by the hit and not
   *  by the count -- and a strike that found nothing reports `hit: null`, which
   *  the first draft of this file dereferenced. */
  const digN = async (n) => {
    of.look(0, -85);
    let struck = 0;
    let hitR = 0;
    for (let i = 0; i < n; ++i) {
      const s = of.dig();
      if (s !== null && s.cells > 0) {
        struck++;
        if (s.hit !== null && s.hit !== undefined) {
          hitR = Math.hypot(s.hit.x, s.hit.y, s.hit.z);
        }
      }
      await run(0.25);
    }
    return { struck, hitR };
  };

  /** Streamed nodes the player has taken something out of. A LIVE reading, off
   *  the node field and not off the slot, so §6 can ask whether the world the
   *  player is standing in survived the trip. */
  const drainedNow = () => (of.nodes() ?? [])
    .filter((n) => n.remaining < n.initial).length;

  await run(1.5);

  // ===========================================================================
  // §0 - THE FIXTURE'S OWN PRECONDITIONS. DW-20: nothing below is believed
  //      until these are.
  // ===========================================================================
  check('§0 this run is SANDBOX, so the fixture can build',
    of.game()?.mode?.sandbox === true, JSON.stringify(of.game()?.mode ?? null));
  check('§0 the world boots on Forge', of.world().bodyRadiusM === FORGE_R,
    `${of.world().bodyRadiusM}`);
  const life0 = of.life();
  check('§0 the save reports its own body scope at all',
    life0?.world !== undefined && life0.world.liveBody === 0,
    JSON.stringify(life0?.world ?? null));
  check('§0 and nothing is frozen on a world that has not switched',
    life0?.world?.frozen === false && life0?.world?.freezes === 0,
    JSON.stringify(life0?.world ?? null));

  // ===========================================================================
  // §1 - BUILD A WORLD ON FORGE, through the player's own verbs.
  // ===========================================================================
  // A machine, a wall on a foundation, a dug hole and a depleted node, which is
  // four different KINDS of body-scoped state: a factory placement keyed to a
  // site grid, base parts keyed to a site, absolute body-frame voxel metres,
  // and an index into a node array the world-gen refills per body.
  of.hotbar(5); const gotSmelter = await place();
  of.hotbar(6); const gotFoundation = await place();
  of.hotbar(8); const gotWall = await place();
  of.hotbar(1);                                     // hands back
  const nodes = of.nodes() ?? [];
  let harvested = 0;
  for (const n of nodes.slice(0, 3)) {
    const h = of.harvest(n.index);
    if (h !== null && h.ok === true) harvested++;
  }
  const forgeDig = await digN(6);
  const struckForge = forgeDig.struck;
  // NO STATION RIDE HERE, and the first draft had one. Boarding Anchorage fills
  // the survey layer in one call (GP-717) and made `discovery` a six-figure
  // number instead of a walker's few hundred bytes, which was tempting -- but
  // `of.carrier('release')` leaves the walker where the station was, 1,000 km
  // up, and the next `of.dig()` strikes nothing while the terrain streams a
  // world the fixture is no longer standing in. That cost two red checks on a
  // correct build. The exactness claim below does not care how big the byte
  // array is, only that it is non-zero and unchanged, so the ride is left to
  // `discbody.js` and `stationreveal.js`, which are its gates.

  await of.save();
  const rawForge = await rawSlot();
  const mark = worldIn(rawForge, 0);
  check('§1 the save was written and body 0 could be read back raw',
    rawForge !== null && mark !== null,
    JSON.stringify(rawForge === null ? null : rawForge.key));
  log.push(`§1 Forge marked: ${brief(mark ?? {})}`);
  log.push(`§1 placed: smelter=${gotSmelter} foundation=${gotFoundation} `
    + `wall=${gotWall}, harvested ${harvested}, struck ${struckForge}`);
  // THE FIXTURE IS ASSERTED BEFORE THE BEHAVIOUR (bodydig.js's rule, and the
  // reason it is a `valid: false` and not a fail: an empty world crosses to the
  // other body as an empty world, which is EXACTLY what the fix looks like).
  const need = { 'voxels.bytes': 0, 'voxels.ops': 0, buildings: 0, sites: 0,
    structures: 0, depletion: 0, trees: 0, discovery: 0, poi: 0 };
  const empty = mark === null ? Object.keys(need)
    : Object.keys(need).filter((k) => (mark[k] ?? 0) <= 0);
  if (empty.length > 0) {
    return { valid: false, why: `the Forge fixture is empty in ${empty.join(', ')}`
      + ` -- an empty world cannot exhibit this defect`, mark, log, fails };
  }

  // ===========================================================================
  // §2 - THE NEGATIVE CONTROL FIRST: A SAME-BODY REBOOT FREEZES NOTHING.
  // ===========================================================================
  // Three probes in this directory use `of.reboot()` with no argument as their
  // own control, so a mechanism that froze on any rebuild would stop their
  // saves dead while every check in §4 stayed green. It is done here, before
  // any body change, because after one the answer is uninformative.
  let sameErr = null;
  try { await of.reboot(); } catch (e) { sameErr = String(e); }
  check('§2 a same-body reboot completed', sameErr === null, sameErr ?? '');
  check('§2 the world is still Forge', of.world().bodyRadiusM === FORGE_R,
    `${of.world().bodyRadiusM}`);
  check('§2 and it FROZE NOTHING: the save is still the live world',
    of.life()?.world?.frozen === false && of.life()?.world?.freezes === 0,
    JSON.stringify(of.life()?.world ?? null));
  // SETTLE BEFORE STRIKING. The first draft struck 0 of 2 here and read it as
  // the save having stopped; the cause was NOT the rebuild but that §1 had
  // ridden the station and released, leaving the walker a thousand kilometres
  // up with nothing under the pick. A dig does not need the terrain to be
  // resident at all -- `VoxelWorld` asks the oracle and the edit set, never the
  // mesh -- so `chunks.converged` is the wrong precondition to gate one on and
  // is deliberately not asserted. It is still worth a settle, because the rest
  // of §2 takes a save and a save reads the world.
  await run(2.0);
  const struckAfterSame = (await digN(3)).struck;
  await of.save();
  const afterSame = worldIn(await rawSlot(), 0);
  check('§2 a dig after a same-body reboot still reaches the save',
    struckAfterSame > 0 && afterSame !== null
    && afterSame['voxels.bytes'] > mark['voxels.bytes'],
    `struck ${struckAfterSame}, ${mark['voxels.bytes']} -> `
    + `${afterSame === null ? 'no world' : afterSame['voxels.bytes']} bytes`);
  // THE MARK MOVES TO HERE, and it is the last reading before the switch with
  // no frame between (discbody.js GP-542: a mark that does not bracket the
  // event measures the walking).
  await of.save();
  const preSwitch = worldIn(await rawSlot(), 0);
  const liveCellsBefore = of.voxels().removedCells;
  const drainedBefore = drainedNow();
  check('§2 the pre-switch mark could be read', preSwitch !== null, '');
  log.push(`§2 pre-switch mark: ${brief(preSwitch ?? {})} `
    + `(live edit set ${liveCellsBefore} cells)`);

  // ===========================================================================
  // §3 - THE BODY CHANGES, AND THE PLAYER WORKS ON THE OTHER ONE.
  // ===========================================================================
  let rebootErr = null;
  try { await of.reboot(1); } catch (e) { rebootErr = String(e); }
  check('§3 the world rebooted onto the moon', rebootErr === null, rebootErr ?? '');
  check('§3 the world really is Cinder', of.world().bodyRadiusM === CINDER_R,
    `${of.world().bodyRadiusM}`);
  const froze = of.life()?.world ?? null;
  check('§3 the switch FROZE the body-scoped half of the save, exactly once',
    froze !== null && froze.frozen === true && froze.freezes === 1
    && froze.liveBody === 0, JSON.stringify(froze));
  of.teleport(0, 0, 0);
  await run(2.5);
  const moonDig = await digN(6);
  const struckMoon = moonDig.struck;
  const liveCellsAfter = of.voxels().removedCells;
  check('§3 the moon digging actually happened, so there is a divergence to '
    + 'catch', struckMoon > 0 && liveCellsAfter > liveCellsBefore,
    `struck ${struckMoon}, live edit set ${liveCellsBefore} -> ${liveCellsAfter}`);
  // THE DIG IS GENUINELY ON CINDER'S GROUND, asserted off the strike's OWN hit
  // radius rather than trusted. The two surfaces are 400 km apart, so this is
  // the one reading that cannot be satisfied by digging on the wrong planet,
  // and the Forge strike is asserted the same way so the pair is symmetric.
  check('§3 and it is the MOON\'s ground being cut, not the planet\'s',
    Math.abs(moonDig.hitR - CINDER_R) < 0.02 * CINDER_R,
    `hit radius ${moonDig.hitR.toFixed(0)} m against Cinder's ${CINDER_R}`);
  check('§3 (and the Forge digging really was Forge\'s ground)',
    Math.abs(forgeDig.hitR - FORGE_R) < 0.02 * FORGE_R,
    `hit radius ${forgeDig.hitR.toFixed(0)} m against Forge's ${FORGE_R}`);

  // ===========================================================================
  // §4 - THE ASSERTION. A SAVE TAKEN ON THE MOON WRITES THE PLANET'S WORLD.
  // ===========================================================================
  const savedOnMoon = await of.save();
  const rawMoon = await rawSlot();
  const onMoon = worldIn(rawMoon, 0);
  check('§4 the save written on the moon could be read back raw',
    savedOnMoon !== null && onMoon !== null,
    JSON.stringify({ saved: savedOnMoon !== null, key: rawMoon?.key ?? null }));
  const drift = onMoon === null ? ['no world 0'] : differs(preSwitch, onMoon);
  check('§4 EVERY body-scoped field under body 0 is still the planet\'s, '
    + 'exactly', drift.length === 0, drift.join('; '));
  // AND THE OTHER HALF OF THE SAME CLAIM, which is what stops the check above
  // being a tautology: the run really did create a divergence for it to catch.
  // The two readings are the LIVE cell tally either side of the moon digging
  // (§3 asserts it grew) against the STORED byte array either side of the same
  // digging (this asserts it did not). Like is compared with like in each pair
  // and never across the two, which is the trap the first draft fell into.
  // On the unfixed build the stored array grows with the live one: measured
  // 5,776 -> 8,786 bytes and 6 -> 9 ops under body 0 for three moon strikes.
  check('§4 and the run DID diverge, so the equality above was earned',
    liveCellsAfter > liveCellsBefore
    && onMoon !== null && onMoon['voxels.ops'] === preSwitch['voxels.ops'],
    `live cells ${liveCellsBefore} -> ${liveCellsAfter}; stored ops `
    + `${preSwitch['voxels.ops']} -> ${onMoon === null ? 'none' : onMoon['voxels.ops']}`);
  check('§4 the moon\'s world is not filed under the planet\'s name either: '
    + 'no world was invented for a body nothing can describe',
    rawMoon !== null && rawMoon.others.every((w) => w.body !== 0),
    JSON.stringify(rawMoon?.others ?? null));
  // THE GLOBAL HALF GOES ON SAVING, which is the whole reason this is a freeze
  // of one bucket and not a refusal of the write (PS-40's boundary).
  check('§4 and the GLOBAL half of the slot is still being written',
    rawMoon !== null && rawForge !== null
    && rawMoon.savedAt > rawForge.savedAt && rawMoon.packBytes > 0,
    JSON.stringify({ before: rawForge?.savedAt, after: rawMoon?.savedAt,
      pack: rawMoon?.packBytes }));
  check('§4 SAVE_VERSION did not move', rawMoon !== null
    && rawMoon.version === rawForge.version && savedOnMoon.version === rawForge.version,
    `${rawForge?.version} -> ${rawMoon?.version} / ${savedOnMoon?.version}`);
  log.push(`§4 stored on the moon under body 0: ${brief(onMoon ?? {})}`);

  // ===========================================================================
  // §5 - THE PROBE'S OWN FIELD LIST IS THE CLIENT'S.
  // ===========================================================================
  // This file counts the body-scoped fields by name, which is a second copy of
  // `WORLD_KEYS`; the compiler guards that list on the client and cannot guard
  // it here. The client publishes its own counts derived FROM the world, so a
  // field this file does not know about shows up as a key it has never heard of.
  const clientKeys = Object.keys(savedOnMoon?.world?.frozenCounts ?? {});
  const mine = new Set([...KEYS, 'voxels.bytes', 'voxels.ops']);
  const unknown = clientKeys.filter((k) => !mine.has(k));
  check('§5 this probe counts every body-scoped field the client has',
    clientKeys.length > 0 && unknown.length === 0,
    `client has ${clientKeys.length} fields; not counted here: `
    + `${unknown.join(', ') || 'none'}`);

  // ===========================================================================
  // §6 - AND HOME AGAIN. THE PLANET'S WORLD IS STILL STANDING AND STILL SAVED.
  // ===========================================================================
  let backErr = null;
  try { await of.reboot(0); } catch (e) { backErr = String(e); }
  check('§6 the world rebooted back to the planet', backErr === null, backErr ?? '');
  check('§6 the world really is Forge again', of.world().bodyRadiusM === FORGE_R,
    `${of.world().bodyRadiusM}`);
  await run(1.5);
  await of.save();
  const home = worldIn(await rawSlot(), 0);
  const homeDrift = home === null ? ['no world 0'] : differs(preSwitch, home);
  check('§6 the planet\'s stored world is STILL exactly what it was left as',
    homeDrift.length === 0, homeDrift.join('; '));
  check('§6 and it did not thaw on the way home: one freeze, still frozen',
    of.life()?.world?.frozen === true && of.life()?.world?.freezes === 1,
    JSON.stringify(of.life()?.world ?? null));
  // THE LIVE WORLD IS UNHARMED AND STILL PLAYABLE, which the freeze is not
  // allowed to cost. Read off the live objects, not off the slot.
  const drained = drainedNow();
  check('§6 the tunnel the player dug is still in the live edit set',
    of.voxels().removedCells >= liveCellsAfter,
    `${liveCellsAfter} -> ${of.voxels().removedCells}`);
  // THE LIVE NODE FIELD IS DELIBERATELY **NOT** ASSERTED TO SURVIVE THE TRIP,
  // and that is a finding rather than an omission. Measured here on the fixed
  // build: 3 drained streamed nodes before the switch and 1 after the round
  // trip. Nothing re-cut the node array, so the two that came back full were
  // RE-PLACED by `TreeField` / `RockField` as the rebuilt scope re-streamed its
  // chunks, at a new /core index with a full `initial`. An in-page body round
  // trip therefore REGROWS the world's rocks and trees in the live session.
  // That is core-engine's R-BODY-2 residue (not one of the fifteen live
  // producers is body-scoped) and is exactly why the SAVE is frozen rather than
  // re-read from a world that has quietly regrown. Gating another domain's open
  // defect from this file would make this probe red for something it is not
  // about, so it is measured, logged and named instead.
  check('§6 the slot still carries the depletion the player mined, whatever the '
    + 'live field has regrown',
    home !== null && home.depletion === preSwitch.depletion
    && home.trees === preSwitch.trees,
    `slot ${home === null ? 'missing' : `${home.depletion}/${home.trees}`} `
    + `against ${preSwitch.depletion}/${preSwitch.trees}`);
  log.push(`§6 home: stored ${brief(home ?? {})}; live edit set `
    + `${of.voxels().removedCells} cells, ${drained} drained nodes`);
  log.push(`§6 live node field across the round trip: ${drainedBefore} drained `
    + `streamed nodes before, ${drained} after, from ${harvested} harvests. `
    + `core-engine R-BODY-2: the node field is not re-cut, so a rebuilt scope `
    + `re-places rocks and trees at full health in the LIVE world.`);

  return {
    valid: fails.length === 0,
    fails,
    log,
    findings: [
      'PS-49: an in-page body switch FREEZES the body-scoped half of the save '
      + 'at the last reading taken while it was attributable, and goes on '
      + 'writing the global half. No world is written under a body it does not '
      + 'describe.',
      'PS-50: `poi` was DESTROYED rather than crossed. `_of_poi_save` is called '
      + 'with the boot body handle, which `WorldSession.reboot` frees, so every '
      + 'save after a switch wrote zero poi bytes over the named body\'s.',
      'PS-52 (harness, and three of this file\'s four findings were its own): '
      + '`slot.voxels.cells` is a BYTE array while `of.voxels().removedCells` '
      + 'is a cell tally, two orders of magnitude apart and never comparable; '
      + 'a station ride leaves the walker in orbit so the next dig strikes '
      + 'nothing; and a dig needs no resident terrain, so `chunks.converged` '
      + 'was the wrong precondition to gate one on.',
      'R-BODY-2 remains OPEN as a playability defect and is core-engine\'s: not '
      + 'one of the fifteen live producers is re-cut for a new body, so work '
      + 'done after an in-page switch is not saved. The save is honest about '
      + 'it (of.life().world.frozen) rather than destructive.',
    ],
    mark, preSwitch, onMoon, home,
    struck: { forge: struckForge, afterSameBodyReboot: struckAfterSame,
      moon: struckMoon },
    liveCells: { before: liveCellsBefore, after: liveCellsAfter },
    world: of.life()?.world ?? null,
    slot: await rawSlot(),
  };
})()
