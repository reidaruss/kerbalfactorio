// fieldstamp.js (PS-53 to PS-56, persistence): THE CLIENT WRITES A
// FIELD-GENERATION STAMP, AND A WORLD ADDRESSED IN A PLANET THAT NO LONGER
// EXISTS IS CLEARED WITHOUT TAKING THE GLOBAL HALF WITH IT.
//
//   node tools/smoke/run.mjs --url=http://127.0.0.1:4531/ --sandbox=1 \
//     --scenario=walk --settle=10 --width=320 --height=180 \
//     --evalfile=tools/smoke/probes/fieldstamp.js
//
// WHAT THIS ADDS THAT `wasm/test/fieldstamp.mjs` CANNOT. That runner proves the
// stamp and the decision, headless, against the shipped binary's own pre-swell
// arm, and it is the faster and stricter of the two. What it cannot see is the
// WIRING: that `Persist.snapshot` actually puts the stamp in the bytes, that
// `PersistSlot.loadSlot` actually consults it, and that a cleared load leaves
// the pack and the research standing in a real world. Those three are what this
// file is for, and it is the same division `dockrcs.mjs` draws between a header
// test and a seam test.
//
// THE FIXTURE IS DIFFERENTIAL AND THE TWO ARMS DIFFER IN ONE FIELD. §2 and §3
// load THE SAME STORED BYTES, once with the stamp the client wrote and once
// with that one key deleted, and get opposite outcomes. So a red §3 cannot be
// blamed on a fixture that failed to dig: §2 is the proof it dug, taken off the
// same slot, and the two are compared against each other rather than against a
// number written down here.
//
// SANDBOX IS NOT A CONVENIENCE: the fixture has to leave something in the
// body-scoped half worth losing, and `freeBuild` is what lets it place without
// mining first. An empty world crosses as an empty world, which is exactly what
// a clear looks like, so §1 REFUSES rather than passing if the dig found
// nothing (PS-52's rule, one lane later).
//
// THE 20 s AUTOSAVE WRITES THE SAME KEY (GP-727). Every experiment below puts
// its own bytes into the store and loads them in the next step, so an autosave
// landing in between can only overwrite a slot that has already been read; the
// stored fixture is re-written from an in-memory copy before every arm rather
// than being assumed to have survived.
//
// Standing rule 11: every bound below is an exact equality against a number
// read off the client earlier in the same run, or a strict inequality whose
// direction is the defect. Nothing was tuned to make a run pass.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['world', 'run', 'save', 'load', 'dig', 'voxels', 'game', 'look',
                   'nodes', 'harvest']) {
    if (typeof of[k] !== 'function') return { valid: false, why: `no __of.${k}` };
  }
  const fails = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };
  const run = (s) => of.run(s, 12);          // GP-726 / discbody.js's reason.

  /** The save store, raw. Every view above it reported the pre-PS-40 slot as
   *  complete, which is why this reads the record (PS-52's rule). */
  const openSaves = () => new Promise((res, rej) => {
    const q = indexedDB.open('orbital-foundry', 1);
    q.onerror = () => rej(q.error);
    q.onsuccess = () => res(q.result);
  });
  /** Both autosave keys, newest `savedAt` wins: the survival key is the bare
   *  string `auto` and the sandbox one is `auto-sandbox` (PS-48), so this file
   *  holds no copy of the key rule. */
  const readSlot = async () => {
    const db = await openSaves();
    const one = (key) => new Promise((res, rej) => {
      const g = db.transaction('saves', 'readonly').objectStore('saves').get(key);
      g.onsuccess = () => res(g.result ?? null);
      g.onerror = () => rej(g.error);
    });
    const found = [];
    for (const k of ['auto', 'auto-sandbox']) {
      const s = await one(k);
      if (s !== null && s !== undefined) found.push({ key: k, slot: s });
    }
    db.close();
    found.sort((a, b) => (b.slot.savedAt ?? 0) - (a.slot.savedAt ?? 0));
    return found[0] ?? null;
  };
  const writeSlot = async (key, slot) => {
    const db = await openSaves();
    await new Promise((res, rej) => {
      const p = db.transaction('saves', 'readwrite').objectStore('saves').put(slot, key);
      p.onsuccess = () => res();
      p.onerror = () => rej(p.error);
    });
    db.close();
  };
  /** FS-79's rescue database, which PS-53 reuses for the copy taken before a
   *  clear. Read here because a copy nobody can find is not a copy. */
  const rescueKeys = async () => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('of-rescue', 1);
      q.onerror = () => rej(q.error);
      q.onsuccess = () => res(q.result);
    });
    const keys = await new Promise((res, rej) => {
      const g = db.transaction('slots', 'readonly').objectStore('slots').getAllKeys();
      g.onsuccess = () => res(g.result.map(String));
      g.onerror = () => rej(g.error);
    });
    db.close();
    return keys;
  };
  const rescueSlot = async (key) => {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open('of-rescue', 1);
      q.onerror = () => rej(q.error);
      q.onsuccess = () => res(q.result);
    });
    const v = await new Promise((res, rej) => {
      const g = db.transaction('slots', 'readonly').objectStore('slots').get(key);
      g.onsuccess = () => res(g.result ?? null);
      g.onerror = () => rej(g.error);
    });
    db.close();
    return v;
  };
  /** Strike straight down, the one aim that finds ground (bodydig.js's rule). */
  const digN = async (n) => {
    of.look(0, -85);
    let struck = 0;
    for (let i = 0; i < n; ++i) {
      const s = of.dig();
      if (s !== null && s !== undefined && s.cells > 0) struck++;
      await run(0.25);
    }
    return struck;
  };

  await run(1.5);

  // ===========================================================================
  // §0 - PRECONDITIONS. DW-20: nothing below is believed until these are.
  // ===========================================================================
  check('§0 this run is SANDBOX, so the fixture can leave something to lose',
    of.game()?.mode?.sandbox === true, JSON.stringify(of.game()?.mode ?? null));
  check('§0 the world boots on Forge', of.world().bodyRadiusM === 600000,
    `${of.world().bodyRadiusM}`);

  // ===========================================================================
  // §1 - THE CLIENT WRITES THE STAMP, AND IT IS IN THE BYTES.
  // ===========================================================================
  const struck = await digN(6);
  // AND SOMETHING IN THE GLOBAL HALF TOO, which the first run of this file did
  // not have and which cost it a red check on a correct build: a walk scenario
  // starts with an EMPTY pack, so "the pack came back" read 0 units and looked
  // like a loss when there had never been anything to lose. §3's claim is that
  // the global half is unaffected by the clear, and a claim about a quantity
  // that is zero in both arms is not a claim (NUMBERS.md: a metric that is flat
  // in its own independent variable is not measuring that variable).
  let harvested = 0;
  for (const n of (of.nodes() ?? []).slice(0, 3)) {
    const h = of.harvest(n.index);
    if (h !== null && h !== undefined && h.ok === true) harvested++;
  }
  const receipt = await of.save();
  check('§1 the fixture actually dug, so the body half has something in it',
    struck > 0 && (receipt?.voxelBytes ?? 0) > 0,
    `struck ${struck}, voxelBytes ${receipt?.voxelBytes ?? 0}`);
  check('§1 and the fixture filled the PACK, so the global half has something too',
    harvested > 0 && (receipt?.bytes ?? 0) > 0,
    `harvested ${harvested}, packBytes ${receipt?.bytes ?? 0}`);
  check('§1 the save receipt carries a field-generation stamp',
    typeof receipt?.fieldGen === 'number', JSON.stringify(receipt?.fieldGen ?? null));
  check('§1 SAVE_VERSION did NOT move for it', receipt?.version === 5,
    `${receipt?.version}`);
  const stored = await readSlot();
  check('§1 and the stamp is in the STORED bytes, not only on the receipt',
    stored !== null && stored.slot.fieldGen === receipt?.fieldGen,
    `${stored?.slot?.fieldGen} vs ${receipt?.fieldGen}`);
  const key = stored?.key ?? 'auto-sandbox';
  // The fixture, held in memory: every arm below is this exact world with one
  // key changed, put back into the store immediately before its load.
  const fixture = JSON.parse(JSON.stringify(stored?.slot ?? {}));
  const live = fixture.fieldGen;
  const bodyBytes = (fixture.voxels?.cells ?? []).length;

  // ===========================================================================
  // §2 - THE MATCHING ARM: a slot written on the field that exists round-trips.
  // ===========================================================================
  await writeSlot(key, JSON.parse(JSON.stringify(fixture)));
  const okLedger = await of.load();
  const okSave = await of.save();
  check('§2 a stamped slot loads with the verdict MATCH and nothing cleared',
    okSave?.fieldGenLoad?.verdict === 'match' && okSave?.fieldGenLoad?.cleared === false,
    JSON.stringify(okSave?.fieldGenLoad ?? null));
  check('§2 and the BODY half really came back',
    (okLedger?.voxels?.cells ?? 0) > 0, `cells ${okLedger?.voxels?.cells ?? 0}`);

  // ===========================================================================
  // §3 - THE PRE-SWELL ARM: the same bytes with the stamp REMOVED, which is
  //      the shape of every save that exists today.
  // ===========================================================================
  const stampless = JSON.parse(JSON.stringify(fixture));
  delete stampless.fieldGen;
  await writeSlot(key, stampless);
  const clrLedger = await of.load();
  const clrSave = await of.save();
  const note = clrSave?.fieldGenLoad ?? null;
  check('§3 a STAMPLESS slot is refused as ABSENT and the body half is cleared',
    note?.verdict === 'absent' && note?.cleared === true, JSON.stringify(note));
  check('§3 nothing of the body-scoped half came back',
    (clrLedger?.voxels?.cells ?? -1) === 0 && (clrLedger?.buildings ?? -1) === 0,
    `cells ${clrLedger?.voxels?.cells}, buildings ${clrLedger?.buildings}`);
  // DIFFERENTIAL, against §2's own arm rather than against a number written
  // here: the global half must restore IDENTICALLY whether or not the body half
  // was cleared. §1 has already refused if the pack was empty, so this cannot
  // pass by both sides being zero.
  check('§3 THE GLOBAL HALF DID: the pack came back exactly as it does on a match',
    (clrLedger?.packUnits ?? -1) === (okLedger?.packUnits ?? -2)
    && (clrLedger?.packUnits ?? 0) > 0,
    `match ${okLedger?.packUnits} vs cleared ${clrLedger?.packUnits}`);
  check('§3 and so did the rest of it: hotbar, mode and the progression spine',
    clrLedger?.hotbarRestored === okLedger?.hotbarRestored
    && clrLedger?.mode === okLedger?.mode
    && JSON.stringify(clrLedger?.progress) === JSON.stringify(okLedger?.progress),
    `${JSON.stringify(clrLedger?.progress)} vs ${JSON.stringify(okLedger?.progress)}`);
  check('§3 the same bytes with a stamp restored the world and without one did not',
    (okLedger?.voxels?.cells ?? 0) > 0 && (clrLedger?.voxels?.cells ?? -1) === 0,
    `${okLedger?.voxels?.cells} -> ${clrLedger?.voxels?.cells} from ${bodyBytes} stored bytes`);
  check('§3 the copy was taken before the clear and it is findable',
    typeof note?.rescue === 'string' && note.rescue.startsWith('fieldgen:'),
    `${note?.rescue}`);
  const copy = note?.rescue ? await rescueSlot(note.rescue) : null;
  check('§3 and the copy holds the world that was cleared, not an empty one',
    ((copy?.voxels?.cells ?? []).length) === bodyBytes,
    `${(copy?.voxels?.cells ?? []).length} of ${bodyBytes}`);

  // ===========================================================================
  // §4 - THE OTHER DIRECTION: a stamp this build does not have. Same bytes,
  //      same one key, a different value rather than an absent one, so the two
  //      branches of the verdict are both exercised on the shipped client.
  // ===========================================================================
  const future = JSON.parse(JSON.stringify(fixture));
  future.fieldGen = ((live ?? 0) + 1) >>> 0;
  await writeSlot(key, future);
  const futLedger = await of.load();
  const futSave = await of.save();
  check('§4 a slot from a field this build does not have is DIFFERS, and cleared',
    futSave?.fieldGenLoad?.verdict === 'differs'
    && futSave?.fieldGenLoad?.cleared === true,
    JSON.stringify(futSave?.fieldGenLoad ?? null));
  check('§4 and nothing of its body-scoped half came back',
    (futLedger?.voxels?.cells ?? -1) === 0, `cells ${futLedger?.voxels?.cells}`);
  check('§4 the live stamp the client compared against is §1\'s',
    futSave?.fieldGenLoad?.live === live,
    `${futSave?.fieldGenLoad?.live} vs ${live}`);

  return {
    valid: fails.length === 0,
    fails,
    says: [
      'PS-53: the stamp is a fingerprint of the DESIGNED FIELD (216 samples of '
      + '`of_base_height`, quantised to 1/64 m, FNV-1a) and not a list of the '
      + 'generation constants, so it cannot miss a constant nobody added to a '
      + 'list and cannot fire on one that moves no ground.',
      'PS-54: on a mismatch the BODY-SCOPED half is CLEARED and the global half '
      + 'loads. Refusing the whole slot is what a SAVE_VERSION bump does and it '
      + 'throws away the pack, the research and the vessels, which are about no '
      + 'place at all; refusing only the body half while keeping the stored '
      + 'bytes means nothing the player builds afterwards is ever saved.',
      'PS-55: an ABSENT stamp is a MISMATCH and not an unknown. Every save that '
      + 'exists today has none, and "absent means current" would protect nobody.',
    ],
    struck,
    stamp: { live, storedBytes: bodyBytes, version: receipt?.version ?? null },
    ledgers: {
      match: okLedger?.voxels?.cells ?? null,
      absent: clrLedger?.voxels?.cells ?? null,
      differs: futLedger?.voxels?.cells ?? null,
      packAfterClear: clrLedger?.packUnits ?? null,
    },
    rescue: (await rescueKeys()).filter((k) => k.startsWith('fieldgen:')),
  };
})()
