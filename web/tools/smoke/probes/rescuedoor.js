// rescuedoor.js (BT-320, R-RECOVER-1): THE of-rescue STORE'S FIRST READER,
// PROVEN AGAINST A REAL COPY.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/rescuedoor.js
//
// WHY A REAL COPY AND NOT A HAND-WRITTEN ONE. `probes/fieldstamp.js` already
// drives the real event this door exists for: dig and harvest for real content,
// save, then load the SAME bytes with the `fieldGen` stamp deleted, which is
// the shape of every save that predates PS-53 and is exactly what triggers
// `PersistSlot.fieldGenAdopt`'s real `keepRescue('fieldgen', ...)` call. This
// file repeats that setup (§0/§1 below are fieldstamp.js's, not a second
// invention of them) so the copy under test is the genuine PS-53 artifact and
// not a synthetic stand-in for one, and then spends its own effort on the half
// fieldstamp.js does not touch: `of.rescue.list/read/restore`, which did not
// exist when that file was written (listRescue/readRescue had zero callers,
// persistence.md's R-RECOVER-1).
//
// THE EXACT-BYTES CLAIM IS CHECKED TWO WAYS. `of.rescue.read(key)` is asserted
// against the IN-MEMORY fixture this probe itself wrote before the clear
// (the copy must hold what was cleared, verbatim); `of.rescue.restore(key)` is
// then asserted by reading the TARGET SLOT BACK OUT OF THE `saves` STORE
// DIRECTLY, hand-rolled exactly the way `fieldstamp.js`/`rescale.js` open it,
// rather than through any client helper: a bug that made `restore` look like
// it worked without actually writing the store cannot pass by both checks
// reading the same wrong path.
//
// NEGATIVE CASES: a malformed key and a key with no stored copy must both
// refuse (`ok:false`) rather than throwing or silently writing nothing where
// something was expected.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  for (const k of ['world', 'run', 'save', 'load', 'dig', 'game', 'look', 'nodes',
                   'harvest', 'rescue']) {
    if (of[k] === undefined) return { valid: false, why: `no __of.${k}` };
  }
  for (const k of ['list', 'read', 'restore']) {
    if (typeof of.rescue[k] !== 'function') return { valid: false, why: `no __of.rescue.${k}` };
  }
  const fails = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };
  const run = (s) => of.run(s, 12);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /** The save store, raw, exactly as fieldstamp.js/rescale.js open it. Reading
   *  the RESULT of a restore through the same door restore ought to have
   *  written through, rather than through of.load()/of.game(), is the point:
   *  it does not reuse anything this probe is trying to prove. */
  const openDb = (name, ver) => new Promise((res, rej) => {
    const q = indexedDB.open(name, ver);
    q.onerror = () => rej(q.error);
    q.onsuccess = () => res(q.result);
  });
  const getKey = async (dbName, store, ver, key) => {
    const db = await openDb(dbName, ver);
    const v = await new Promise((res, rej) => {
      const g = db.transaction(store, 'readonly').objectStore(store).get(key);
      g.onsuccess = () => res(g.result ?? null);
      g.onerror = () => rej(g.error);
    });
    db.close();
    return v;
  };
  const putKey = async (dbName, store, ver, key, value) => {
    const db = await openDb(dbName, ver);
    await new Promise((res, rej) => {
      const p = db.transaction(store, 'readwrite').objectStore(store).put(value, key);
      p.onsuccess = () => res();
      p.onerror = () => rej(p.error);
    });
    db.close();
  };
  /** Strike straight down, fieldstamp.js's own rule for the one aim that finds
   *  ground. */
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
  // §0/§1 - THE REAL SETUP, fieldstamp.js's own (DW-20: nothing below is
  //         believed until this is real content in a real sandbox slot).
  // ===========================================================================
  check('§0 this run is SANDBOX', of.game()?.mode?.sandbox === true,
    JSON.stringify(of.game()?.mode ?? null));
  const struck = await digN(6);
  let harvested = 0;
  for (const n of (of.nodes() ?? []).slice(0, 3)) {
    const h = of.harvest(n.index);
    if (h !== null && h !== undefined && h.ok === true) harvested++;
  }
  const receipt = await of.save();
  check('§1 the fixture actually dug and harvested, so there is something to lose',
    struck > 0 && harvested > 0 && (receipt?.voxelBytes ?? 0) > 0,
    `struck ${struck}, harvested ${harvested}, voxelBytes ${receipt?.voxelBytes ?? 0}`);

  const key = 'auto-sandbox';
  const stored = await getKey('orbital-foundry', 'saves', 1, key);
  if (stored === null) return { valid: false, why: 'no stored sandbox slot after save', fails };
  const bodyBytesBefore = (stored.voxels?.cells ?? []).length;

  // ===========================================================================
  // §2 - THE REAL CLEAR: the same bytes with the stamp removed, PersistSlot's
  //      own real `keepRescue('fieldgen', ...)` call fires on this load.
  // ===========================================================================
  const stampless = JSON.parse(JSON.stringify(stored));
  delete stampless.fieldGen;
  await putKey('orbital-foundry', 'saves', 1, key, stampless);
  await of.load();
  const clrSave = await of.save();
  const note = clrSave?.fieldGenLoad ?? null;
  const rescueKey = note?.rescue ?? '';
  check('§2 the load really cleared the body half and left a findable rescue key',
    note?.cleared === true && rescueKey.startsWith('fieldgen:'),
    JSON.stringify(note));
  if (rescueKey === '') {
    return { valid: false, why: 'no rescue key produced; nothing to test the door against',
      fails, note };
  }

  // ===========================================================================
  // §3 - of.rescue.list: the real key is findable through the new surface.
  // ===========================================================================
  const listed = await of.rescue.list();
  check('§3 of.rescue.list() is an array', Array.isArray(listed), typeof listed);
  check('§3 of.rescue.list() includes the real fieldgen copy',
    listed.includes(rescueKey), `${listed.length} keys, wanted ${rescueKey}`);

  // ===========================================================================
  // §4 - of.rescue.read: the copy holds EXACTLY the stampless bytes this probe
  //      wrote, not a re-derivation of them.
  // ===========================================================================
  const read = await of.rescue.read(rescueKey);
  check('§4 of.rescue.read() returns the stampless slot verbatim',
    read !== null && eq(read, stampless),
    read === null ? 'null' : 'differs from the exact bytes written before the clear');
  check('§4 read() on an absent key returns null, not a throw',
    (await of.rescue.read('fieldgen:auto-sandbox:no-such-timestamp')) === null);

  // ===========================================================================
  // §5 - of.rescue.restore: NEGATIVE CASES FIRST, so a permissive bug cannot
  //      be masked by the positive case below succeeding for the wrong reason.
  // ===========================================================================
  const badKey = await of.rescue.restore('not-a-rescue-key');
  check('§5 restore() refuses a malformed key', badKey.ok === false, JSON.stringify(badKey));
  const missing = await of.rescue.restore('fieldgen:auto-sandbox:no-such-timestamp');
  check('§5 restore() refuses a well-formed key with nothing stored under it',
    missing.ok === false, JSON.stringify(missing));

  // ===========================================================================
  // §6 - of.rescue.restore, THE POSITIVE CASE, and the exact-bytes claim
  //      checked by reading the TARGET STORE DIRECTLY rather than through
  //      of.rescue.read or of.load, so this cannot pass by re-reading its own
  //      write through the same code path it is meant to verify.
  // ===========================================================================
  // Overwrite the live slot first, so a restore that silently did nothing
  // cannot be mistaken for one that worked: if this junk value is still there
  // afterward, the write did not happen.
  await putKey('orbital-foundry', 'saves', 1, key, { junk: true });
  const restored = await of.rescue.restore(rescueKey);
  check('§6 restore() reports ok:true and the target slot it named',
    restored.ok === true && restored.targetSlot === key && restored.reason === 'fieldgen',
    JSON.stringify(restored));
  check('§6 restore() warns about re-creating the misplacement',
    typeof restored.warning === 'string' && restored.warning.includes('misplacement'),
    restored.warning);
  const landed = await getKey('orbital-foundry', 'saves', 1, key);
  check('§6 THE TARGET SLOT NOW HOLDS THE EXACT RESCUED BYTES, read independently',
    landed !== null && eq(landed, stampless),
    landed === null ? 'null' : (eq(landed, { junk: true }) ? 'still the junk value: restore did not write'
      : 'differs from the rescued bytes'));
  check('§6 and specifically the body half round-tripped byte for byte',
    (landed?.voxels?.cells ?? []).length === bodyBytesBefore,
    `${(landed?.voxels?.cells ?? []).length} of ${bodyBytesBefore}`);

  // NOTE: "restore does not load" is not asserted with a probe field here,
  // because nothing calls of.load() between §2 and here, and the running
  // session's live world is provably untouched by construction: §6 reads the
  // slot back through raw IndexedDB (`getKey`), the same door PersistSlot
  // itself uses, never through of.load() or of.game(), so this file has no
  // opportunity to conflate "the bytes are now on disk" with "the world is
  // now that". The safety argument is `restoreRescue`'s own: `writeKey` is
  // the byte-mover the client's load path already uses to copy a STORED slot
  // verbatim, and nothing in that call path touches the live scene.

  return {
    valid: fails.length === 0, pass: fails.length === 0, fails,
    says: [
      'R-RECOVER-1 closed on the READ side: of-rescue held load-bearing copies '
      + '(FS-79 rescale, PS-53 fieldgen) with zero callers on listRescue/readRescue '
      + 'and no debug verb; of.rescue.list/read/restore is the first reachable path.',
      'restore is explicit-only and writes verbatim through SaveKeys.writeKey, '
      + 'never through SaveGame.writeSlot, and never automatically.',
    ],
    rescueKey, bodyBytesBefore,
    listedCount: listed.length,
    restored,
  };
})()
