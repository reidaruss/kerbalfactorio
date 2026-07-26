// Mouse-look handedness. The bug this exists to prevent: dragging the mouse
// RIGHT turned the player LEFT, because Input mirrored pitch's minus sign onto
// yaw without checking which way rising yaw actually points.
//
// It asserts through the real DOM event, not through __of.look(): the defect
// lived in the pointermove handler, so a probe that drives ViewMode directly
// would pass while the game stayed inverted.
//
// Ground truth is independent of yaw's sign convention: after dragging right,
// the aim ray must rotate toward the EAST basis vector, because east is what
// lies to your right when you face north with up overhead.
(async () => {
  const of = window.__of;
  if (!of || !of.aim) return { valid: false, why: 'no __of.aim' };

  const el = document.querySelector('canvas');
  if (!el) return { valid: false, why: 'no canvas' };

  // Input deltas are drained by the 60 Hz TICK, not by the render frame. At 500
  // fps two rAFs is 4 ms, so a frame-counted wait reads the aim before the tick
  // has consumed the drag and silently reports "no movement". Wait in real time,
  // across several ticks. This is the DW-20 trap in miniature: the first version
  // of this probe called its own correct fix asymmetric.
  const settle = () => new Promise((r) => setTimeout(r, 120));

  // A known heading, so the answer is not read off some accumulated state.
  of.look(0, 0);
  await new Promise((r) => requestAnimationFrame(r));
  const before = of.aim();
  if (!before) return { valid: false, why: 'no aim ray (no character?)' };

  // east = the direction that is 90 degrees clockwise from the start heading,
  // derived from the aim ray itself so the probe shares no code with ViewMode.
  of.look(90, 0);
  await new Promise((r) => requestAnimationFrame(r));
  const atYaw90 = of.aim();
  of.look(0, 0);
  await new Promise((r) => requestAnimationFrame(r));

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // Drag right through the real handler. pointerdown first: the handler ignores
  // motion unless dragging or pointer-locked.
  const opts = { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  for (let i = 0; i < 10; ++i) {
    el.dispatchEvent(new PointerEvent('pointermove', { ...opts, movementX: 12, movementY: 0 }));
  }
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  await settle();
  const afterRight = of.aim();

  // Did the aim swing toward where yaw=90 pointed (right) or away from it (left)?
  const towardRight = dot(afterRight.dir, atYaw90.dir) - dot(before.dir, atYaw90.dir);

  // And the same drag to the left must undo it, so a stuck axis cannot pass.
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  for (let i = 0; i < 10; ++i) {
    el.dispatchEvent(new PointerEvent('pointermove', { ...opts, movementX: -12, movementY: 0 }));
  }
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  await settle();
  const afterBack = of.aim();

  const yawDelta = (a, b) => {
    let d = a - b;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  };

  const movedRight = yawDelta(afterRight.yawDeg, before.yawDeg);
  const returned = Math.abs(yawDelta(afterBack.yawDeg, before.yawDeg));

  return {
    valid: true,
    yawBefore: before.yawDeg,
    yawAfterDragRight: afterRight.yawDeg,
    yawAfterDragBack: afterBack.yawDeg,
    // The headline: positive means the aim moved toward the right-hand basis.
    towardRight,
    dragRightTurnsRight: towardRight > 0.01,
    // The drag actually did something (guards against a no-op handler passing).
    movedAtAll: Math.abs(movedRight) > 1,
    // ... and the mirrored drag comes home.
    symmetric: returned < 1,
  };
})()
