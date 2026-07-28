// vabdown.js: GP-141. THE DOWNWARD PREVIEW REACHES THE SCREEN.
//
//   npx vite --config vite.probe.config.ts --port 5261 --strictPort
//   node tools/smoke/run.mjs --url=http://127.0.0.1:5261/ --sandbox=1 --settle=6 \
//        --evalfile=tools/smoke/probes/vabdown.js
//
// Reid: "Snapping is broken and you can only build bottom-up."
//
// GP-122 measured the model and found building downward already worked, which
// was true and did not help, because what a player believes is a claim about
// PIXELS and every bay probe until this one asserted only about the report.
// Driven on the shipped build: hold an engine, put the cursor on the drawn pixel
// of a tank's bottom face, and `snapped` reads `bottom` while the frame is
// BIT-IDENTICAL to the frame with the cursor parked on empty space. Zero pixels,
// twice, on two stacks and two node heights, against 625 for the same part going
// on top and 1259 for it going on the side.
//
// The cause: the pad is an opaque 4.2 m disc whose top face sat exactly on the
// lowest committed part, and a downward attachment is by definition below that.
// Both halves of Reid's sentence are the same defect.
//
// WHAT MAKES THIS PROBE MEAN ANYTHING.
//
// (a) It counts THE GHOST'S OWN COLOUR (0x66ff99 at 0.6 alpha), not a raw frame
//     diff. Once the floor is allowed to move out of the way, the floor moving
//     is itself a large diff, so a raw diff would go up for two reasons and
//     prove neither. Measured: the raw diff for the bottom face reads 8875 of
//     57600 while the ghost accounts for 261 of them.
// (b) It is TWO-SIDED. Green must be present when a face is snapped and
//     BIT-EXACTLY ABSENT with the hand empty, which no threshold tuned until it
//     passes can imitate.
// (c) The top face and the radial ring are POSITIVE CONTROLS on the same page.
//     They were never broken, and they are here so that a future change which
//     hides everything cannot pass by hiding the thing under test as well.
// (d) The floor is asserted directly, against the pad the renderer holds. The
//     pixel counts say the preview arrived; `floorTopY <= ghost base` says WHY,
//     so a later change that restores the occlusion fails by name rather than
//     by a number drifting.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.vab !== 'function') return { valid: false, why: 'no __of.vab' };
  const fails = [];
  const log = [];
  const check = (name, ok, detail) => {
    if (!ok) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok;
  };
  const sleep = (n) => of.run(n);

  const PID = { Pod: 0x0100, TankS: 0x0101, TankSLong: 0x0102, EngineS: 0x0103,
                SolidBooster: 0x0105, NoseCone: 0x0109 };
  const cat = of.vab('catalogue');
  const idx = {};
  for (const k of Object.keys(PID)) {
    const r = cat.find((x) => x.id === PID[k]);
    idx[k] = r === undefined ? -1 : r.index;
    check(`catalogue has ${k}`, idx[k] >= 0, `PartId 0x${PID[k].toString(16)}`);
  }

  const boot = of.vab('enter');
  await sleep(3);
  check('the bay opened', boot.open === true, JSON.stringify(boot.open));

  const clear = async () => { of.vab('press', 'clear'); await sleep(2); };
  const hold = async (p) => { of.vab('drop'); of.vab('take', idx[p]); await sleep(1); };

  const canvas = document.querySelector('canvas');
  if (!canvas) return { valid: false, why: 'no canvas' };
  const W = 320, H = 180;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const ctx = off.getContext('2d', { willReadFrequently: true });
  /** How many pixels are the ghost's green? */
  const green = () => {
    ctx.drawImage(canvas, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 1] > d[i] + 25 && d[i + 1] > d[i + 2] + 25 && d[i + 1] > 90) n += 1;
    }
    return n;
  };

  /** Build `steps`, hold `part`, aim at the `kind` face, and photograph it. */
  const aim = async (steps, part, kind) => {
    await clear();
    for (const s of steps) {
      await hold(s.part);
      if (s.at !== undefined) {
        const n = of.vab('nodes').filter((x) => x.kind === s.at)
          .sort((p, q) => (s.at === 'bottom' ? p.pos[1] - q.pos[1]
                                             : q.pos[1] - p.pos[1]))[0];
        if (n === undefined) return { err: `no ${s.at} node for ${s.part}` };
        of.vab('hover', n.ndc[0], n.ndc[1]);
        await sleep(0.5);
        const r = of.vab('place');
        if (!r.ok) return { err: `${s.part} refused: ${r.report.message}` };
      } else of.vab('place');
      await sleep(2);
    }
    // Hand EMPTY: no markers, no ghost, no green. The absence side of (b).
    of.vab('drop');
    await sleep(2);
    const emptyGreen = green();
    const emptyFloor = mustNum(of.vab('floor'), 'topY', 'floor(empty)');

    await hold(part);
    const n = of.vab('nodes').filter((x) => x.kind === kind)
      .sort((p, q) => (kind === 'bottom' ? p.pos[1] - q.pos[1]
                                         : q.pos[1] - p.pos[1]))[0];
    if (n === undefined) return { err: `no ${kind} node` };
    const r = of.vab('hover', n.ndc[0], n.ndc[1]);
    await sleep(2);
    const s = r.snapped;
    const f = of.vab('floor');
    return { face: kind, part, emptyGreen, emptyFloor,
             nodePosY: Number(n.pos[1].toFixed(3)),
             snapped: s === null || s === undefined ? null : s.kind,
             ghostGreen: green(),
             floorTopY: mustNum(f, 'topY', 'floor(hover)'),
             ghostBaseY: mustNum(f, 'ghostBaseY', 'floor(hover)') };
  };

  // --- 1. the positive controls: up and sideways were never broken ----------
  const up = await aim([{ part: 'TankSLong' }], 'TankS', 'top');
  check('a part going ON TOP snaps', up.snapped === 'top', JSON.stringify(up));
  check('and its preview is drawn', up.ghostGreen > 150,
        `${up.ghostGreen} green pixels of ${W * H}`);
  const side = await aim([{ part: 'TankSLong' }], 'SolidBooster', 'radial');
  check('a part going ON THE SIDE snaps', side.snapped === 'radial',
        JSON.stringify(side));
  check('and its preview is drawn', side.ghostGreen > 150,
        `${side.ghostGreen} green pixels`);

  // --- 2. THE DEFECT: the same part going UNDER --------------------------
  const down = await aim([{ part: 'TankSLong' }], 'EngineS', 'bottom');
  check('a part going UNDERNEATH snaps', down.snapped === 'bottom',
        JSON.stringify(down));
  check('AND ITS PREVIEW IS DRAWN, which read 0 pixels before GP-141',
        down.ghostGreen > 150, `${down.ghostGreen} green pixels of ${W * H}`);
  // The floor is the thing that was in front of it. `-0.175` is the pad's own
  // half thickness and lives in VabView; asserted against the published top
  // face so this check does not have to know it.
  check('the floor is at or below the ghost it is previewing',
        down.floorTopY <= down.ghostBaseY + 1e-6,
        `floor top ${down.floorTopY}, ghost base ${down.ghostBaseY}`);
  check('and the ghost really did hang below the face', down.ghostBaseY < -1,
        `ghost base ${down.ghostBaseY} against node y ${down.nodePosY}`);

  // --- 3. and again once the stack has already grown down past the origin ---
  const down2 = await aim([{ part: 'Pod' }, { part: 'TankSLong', at: 'bottom' }],
                          'EngineS', 'bottom');
  check('a THIRD part goes under a stack that already hangs below 0',
        down2.snapped === 'bottom', JSON.stringify(down2));
  check('and that preview is drawn too', down2.ghostGreen > 150,
        `${down2.ghostGreen} green pixels at node y ${down2.nodePosY}`);
  check('the stack really had grown downward', down2.nodePosY < -1,
        `node y ${down2.nodePosY}`);
  check('and the floor moved under that preview too',
        down2.floorTopY <= down2.ghostBaseY + 1e-6,
        `floor top ${down2.floorTopY}, ghost base ${down2.ghostBaseY}`);

  // --- 4. the ABSENCE side. No hand, no green, anywhere. -------------------
  for (const [name, c] of [['up', up], ['side', side], ['down', down],
                           ['downStack', down2]]) {
    check(`${name}: an empty hand paints no ghost at all`, c.emptyGreen === 0,
          `${c.emptyGreen} green pixels with nothing in hand`);
  }

  log.push({ up: { green: up.ghostGreen, floor: up.floorTopY },
             side: { green: side.ghostGreen, floor: side.floorTopY },
             down: { green: down.ghostGreen, floor: down.floorTopY,
                     nodeY: down.nodePosY },
             downStack: { green: down2.ghostGreen, floor: down2.floorTopY,
                          nodeY: down2.nodePosY } });

  return {
    valid: fails.length === 0,
    fails,
    log,
    note: 'GP-141: the bay floor follows the PREVIEW, not only the committed '
      + 'assembly, so a downward attachment is visible before it is committed. '
      + 'Before: 0 green pixels on a snap the report called successful.',
  };
})()
