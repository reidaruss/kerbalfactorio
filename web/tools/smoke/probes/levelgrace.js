// RN-146: the levelling ring's idle preview has a GRACE WINDOW, not a lease on
// the landscape. Before the fix the idle (key-up) preview drew FOREVER,
// following the feet: a permanent unlit 10 m pale disc under every player that
// washed ground contrast in every biome (the RN-81 "pale disc", attributed via
// ?levelring=0 by probes/discshot.js). The fix: the preview persists
// LEVEL.idleGraceTicks (180 = 3 s) past the last press or application, then
// hides.
//
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 --url=... \
//     --evalfile=tools/smoke/probes/levelgrace.js
//
// THE CLAIM IS TWO-SIDED (INSTRUMENTS.md): the ring must be PRESENT with a
// fresh application and BIT-EXACTLY ABSENT at rest, which a tuned threshold
// cannot imitate. Three states, in order:
//   1. AT REST (settling burned >3 s of sim since spawn): ring hidden. On the
//      pre-fix build this same read is VISIBLE, so this line alone
//      discriminates the builds.
//   2. AFTER of.level() (the levelOnce path): ring visible at idleAlpha on the
//      following ticks, because an application arms the grace exactly as a
//      press does; probes/level.js's ringVisible assertion depends on this.
//   3. AFTER 4 s MORE SIM (240 ticks > 180): ring hidden again, strength 0.
//
// NAMED FAILURE MODES: (a) grace never expires (state 3 fails: the old bug in
// a new coat); (b) levelOnce does not arm it (state 2 fails: probe path and
// key path disagree about when the ring shows); (c) the probe reads the ring
// before the idle step ticks once, seeing stale state (we run 0.2 s of sim
// after the application before reading).
(async () => {
  const of = window.__of;
  const lat = OF_ARGS.lat ?? 12;
  const lon = OF_ARGS.lon ?? 150;
  const w0 = of.world();
  of.teleport(lat, lon, 2.0);
  await of.run(2.0);
  let spin = 0;
  while (!of.world().chunks.converged && spin++ < 240) await of.run(0.5);
  // Burn well past the grace window so a spawn-time arming cannot leak in.
  await of.run(4.0);

  const ringOf = () => {
    const tf = of.terraform();
    return mustHave(tf, 'ring', 'terraform()');
  };
  const atRest = { ...ringOf() };

  of.look(180, -35);
  const applied = of.level();
  await of.run(0.2);
  const afterLevel = { ...ringOf() };

  await of.run(4.0);
  const expired = { ...ringOf() };

  const w = of.world();
  return {
    valid: w.tick > w0.tick && w.chunks.converged && applied !== null,
    atRest, afterLevel, expired,
    checks: {
      restHidden: atRest.visible === false && atRest.strength === 0,
      applicationShowsRing: afterLevel.visible === true && afterLevel.strength > 0,
      graceExpires: expired.visible === false && expired.strength === 0,
    },
  };
})()
