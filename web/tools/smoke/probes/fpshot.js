// RN-648. Pitch the view to where a player actually looks while working, so
// run.mjs's own `--out` screenshot photographs the first-person hands.
//
// THIS PROBE TAKES NO PICTURE, DELIBERATELY. The first version grabbed the
// canvas itself with `toDataURL` after an `await of.run(...)` and wrote a
// BLANK WHITE PNG. That is the documented WebGL trap and writeshot.mjs's own
// header states it: the drawing buffer is not preserved, so a read that
// happens in a later task than the draw returns an empty buffer. A probe that
// wants its own frame must grab it in the SAME task as the render; a probe
// that just wants the settled frame should set the scene up and let run.mjs's
// `--out` do the capture, which is what this now does.
//
// WHY THE PITCH IS AN ARGUMENT AND NOT A PREFERENCE. The view model hangs
// 0.30 m below an origin that IS the camera, at 0.62 m out, which is
// atan(0.30/0.62) = 25.8 degrees below the eye axis. The client's vertical FOV
// is 60 degrees (CameraRig.ts, `fovDeg = 60`, never reassigned), so the
// half-angle is 30 and the hands sit at 25.8/30 = 86 per cent of the way to
// the bottom edge with the view LEVEL. A level in-game frame therefore shows
// two slivers at the bottom, which is the honest default framing and is also
// this pass's finding rather than a bad screenshot. Pitched down 12 degrees
// the gloves are in the lower third, where a player mining or building sees
// them.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  if (typeof of.look !== 'function') {
    return { valid: false, why: 'no of.look(yawDeg, pitchDeg)' };
  }
  const before = of.stats?.();
  const yaw = before?.pitchDeg === undefined ? null : before;
  // of.look is ABSOLUTE degrees (Debug.ts:356 differences against stats), so
  // the yaw is read back rather than assumed, keeping the heading the
  // scenario chose and moving only the pitch.
  of.look(before?.yawDeg ?? 0, -12);
  await of.run(1.2);
  const after = of.stats?.();
  return {
    valid: true,
    pass: true,
    pitchBefore: before?.pitchDeg ?? null,
    pitchAfter: after?.pitchDeg ?? null,
    yawHeld: (before?.yawDeg ?? null) === (after?.yawDeg ?? null),
    sawYaw: yaw !== null,
  };
})()
