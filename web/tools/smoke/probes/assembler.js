// FS-56: AN ASSEMBLER MAKES A BUILDABLE OUT OF TWO INGREDIENTS THAT BOTH
// ARRIVED ON BELTS.
//
//   cd web
//   node tools/smoke/run.mjs --scenario=walk --sandbox=1 \
//        --evalfile=tools/smoke/probes/assembler.js
//
// SANDBOX, deliberately, and it costs the probe nothing: placement is then never
// refused for materials, so every failure here is about ports, recipes or belts
// and never about a pack. Nothing the probe MEASURES is granted by the mode. The
// two ingredients are mined out of the ground, one of them is smelted, and both
// of them ride belts into the machine.
//
// WHAT DEFECT IT EXISTS TO CATCH, and it is three that share one shape.
//
//   1. A CLIENT-SIDE BILL OF MATERIALS. `FactoryRecipes.assemblerMenu` reads
//      /core's own hand-recipe table (`of_gp_recipe_count` / `of_gp_recipe_info`,
//      which is `gameplay.h`'s `handRecipes()`) and filters it to the rows the
//      two-slot `Recipe` in `factory_sim.h` can express. The entire value of that
//      decision is that a smelter costs 5 Iron and 5 Stone in the crafting menu
//      and 5 Iron and 5 Stone in an assembler, because both readings are the same
//      bytes. A second table authored in the client would agree on the day it was
//      written and would disagree the first time anybody rebalanced either, in a
//      direction nobody would notice. So `billMatchesCoreHandRecipe` reads the
//      SAME recipe by a route that has never heard of this feature and binds it
//      to the machine's own `recipeInputs` field by field.
//   2. A MACHINE THAT IS CORRECTLY CONFIGURED, CORRECTLY CONNECTED AND STALLED
//      BECAUSE ONE OF TWO HOPPERS IS EMPTY. No machine in this game has ever had
//      that failure mode, so no probe has ever looked for it: `coalsmelt.js`,
//      `machineports.js`, `shortline.js` and `autoline.js` all read `input`, and
//      `input` reads as a perfectly healthy machine while `input2` sits at zero
//      for ever. This probe asserts BOTH, and it fills both off belts, because a
//      hand-loaded hopper proves nothing at all about a factory.
//   3. A RECIPE NOBODY CHOSE. An unset assembler is placed as NOTHING on purpose:
//      no /core entity, `build` stays -1, and the panel reads NO RECIPE rather
//      than IDLE (FS-52's ordering rule: IDLE means "configured and waiting for
//      materials" and sends the player to look at their belts). That state has to
//      be asserted BEFORE the click, or "the assembler made a smelter" cannot be
//      told apart from "the assembler was always going to make a smelter".
//
// STANDING RULE 11: THE SCENE IS REACHED, NOT BUILT. There is no
// `of_net_belt_fill_saturated` anywhere here and no hand-feed on the headline
// path. Two drills go down on two real deposits through the real ghost, the
// belts are laid with the real hold-drag and the real FS-26 socket snap, the
// assembler comes out of the real build menu with B, and the recipe is chosen by
// clicking the real `data-recipe` button in the real panel. The only thing this
// probe hands the world is key presses.
//
// THE SCENE, which is two chains meeting on one 8 m housing:
//
//   drill on IronOre -> belt -> belt -> smelter -> belt -> belt -> assembler
//                                                          socket_item_in_a
//   drill on Rock (whose resource is Stone) -> about forty belt tiles across the
//                                              clearing -> assembler
//                                                          socket_item_in_b
//
// The deposits are laid out about 43 m apart (`OreField.SPREAD_M` is 40), so the
// stone half is a genuine haul: it is laid as ONE held drag walked across the
// clearing, and then finished with single snapped presses for the last few
// cells, because a drag ends wherever the crosshair is and the final cell has to
// be exact or no port mates.
//
// WHY THE ASSEMBLER'S OWN AXES DECIDE WHERE EVERYTHING ELSE GOES.
// `socket_item_in_a` is on the housing's local -Z (its rear) and
// `socket_item_in_b` is on local +X (its right); `Grid.orient` builds the frame
// with +Y up and +Z forward, so the right face points along `up x fwd`. The
// assembler inherits its heading from the belt it is snapped onto, so the IRON
// chain's direction decides which way port B faces. This probe therefore chooses
// the iron chain's axis FIRST, as `toRock x up`, precisely so that port B ends up
// facing the rock deposit and the stone haul is a straight line rather than a
// hook around the back of the machine. That is arithmetic done once here instead
// of a probe that lays forty tiles and then discovers the port is on the far side.
//
// WHY THE PORT-B CELL IS DERIVED AND NOT CAUGHT WITH THE CROSSHAIR. Every other
// placement below is aimed by sweeping until the ghost SAYS it caught the socket
// that was wanted, which is the honest way to target one: `FactoryGhost` and
// `FactoryWiring` reach the same `linksBetween`, so a ghost that names a socket
// is the connection about to be made. That cannot work for a machine INLET.
// `FactoryGhost.march` stops the aim ray at the GROUND, every item inlet in the
// shipped set is authored 0.90 m up the housing, and `FactorySnap.SNAP_M` is
// exactly 0.90, so the distance from any ground aim point to `socket_item_in_b`
// is at or over the bound by construction. That is not a defect: every real
// placement catches the BELT's socket, which sits 0.25 m up. So the port-B cell
// is derived from the assembler's own reported pose (five cells along `up x fwd`,
// which is `FactorySnap.stepsFor` for an 8 m machine against a 1 m tile), and
// the derivation is then MEASURED rather than trusted: the haul only counts if a
// link whose `toPort` is `socket_item_in_b` actually appears in the plan, and its
// gap, rise and facing are reported.
//
// WHAT THIS PROBE FOUND, and the reason the scene above is built and then only
// half used. THE GEOMETRY IS FULLY BELTED AND THE DELIVERY IS NOT. Both inlets
// mate: `socket_item_in_a` at 0.500 m gap, 0.650 m rise, facing -1, and
// `socket_item_in_b` at the same three numbers, each from a run's own
// `socket_belt_out`. The stone line then saturates to its own ceiling, four
// items a tile, standing against a mated port, and hands over NOT ONE UNIT in a
// hundred seconds, so nothing is ever manufactured from it.
//
// Traced to the line: `Automation::inferItem` decides an inserter's item type at
// CONNECT time, and for a belt feeding a machine it reads `lineHeadItem(from)`
// and falls back to the SLOT-1 ingredient when the belt is empty. `FactorySim`
// has no re-recipe and no entity removal, so every commit calls `recreate()`,
// which throws away everything riding every belt; every belt is therefore empty
// at the moment it is connected, and every belt-to-assembler inserter in the
// client ends up bound to ingredient A. `inserterSystem`'s pickup gate is
// `sl.headItem() == insItem_[i]`, so the stone line's inserter waits for iron
// for ever. The iron line works only because ingredient A is what it carries.
// An assembler's SECOND ingredient cannot be belted at all on this build.
//
// So the probe asserts that as `stoneArrivesByBelt` and expects it RED, and then
// goes on to measure everything downstream of it with the stone put in BY HAND
// through the panel's own Load button (`feedAssembler`, `of_net_feed_machine2`,
// ABI 18). `bothIngredientsBeltedGeometry` and `bothIngredientsBeltedDelivery`
// are two separate answers in the report for exactly this reason; a single
// boolean would have to lie about one of them.
//
// THE NEGATIVE CONTROL IS THEREFORE AN A/B ON ONE SCENE, and it is stronger than
// the key press this probe was going to use. THREE windows, same machine, same
// belts, same recipe, one variable: no stone (nothing made), stone put in by
// hand (buildables made), the hand-loaded stone exhausted (nothing made again).
// Neither end is a threshold. A build whose `producedOfOutput` merely counted up
// would fail the first and third windows; a build that had simply stopped
// working would fail the second; and the first window is also the evidence for
// the delivery defect above, since the iron hopper is full throughout it.
(async () => {
  const of = window.__of;
  if (!of) return { valid: false, why: 'no __of' };
  const sleep = (n) => of.run(n);
  const log = [];
  const fails = [];
  const check = (name, ok, detail) => {
    if (ok !== true) fails.push(detail === undefined ? name : `${name}: ${detail}`);
    return ok === true;
  };
  const fac = () => of.game().factory;
  const gd = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const eye = () => of.aim().origin;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  const norm = (v) => { const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const rowOf = (id) => fac().list.find((b) => b.id === id) ?? null;

  // --- AIMING, WALKING, PLACING ----------------------------------------------
  // `aimAtPoint` is autoline.js's search, unchanged and for its own reason: the
  // observer's yaw lives in a local tangent frame and cannot be computed from
  // body-frame coordinates without re-deriving that frame here, so the heading is
  // MEASURED by minimising the ray's perpendicular miss against a known point.
  // The `u <= 0` guard is load bearing: perpendicular distance to a LINE does not
  // care which way along it the target lies, so without it a heading 180 degrees
  // wrong scores exactly as well as the right one.
  const missTo = (t) => {
    const a = of.aim();
    const v = sub(t, a.origin);
    const u = dot(v, a.dir);
    if (u <= 0) return Infinity;
    return Math.hypot(v[0] - a.dir[0] * u, v[1] - a.dir[1] * u,
      v[2] - a.dir[2] * u);
  };
  const aimAtPoint = (t) => {
    let y = of.world().observer.yawDeg;
    let p = -20;
    for (const step of [16, 4, 1, 0.3]) {
      let bestM = Infinity, by = y, bp = p;
      for (let a = -6; a <= 6; ++a) {
        for (let b = -6; b <= 6; ++b) {
          of.look(y + a * step, Math.max(-88, Math.min(20, p + b * step)));
          const m = missTo(t);
          if (m < bestM) { bestM = m; by = y + a * step; bp = p + b * step; }
        }
      }
      y = by; p = Math.max(-88, Math.min(20, bp));
    }
    of.look(y, p);
    return [y, p];
  };
  // The burst is SIZED TO THE GAP, machineports.js's rule: the walker moves at
  // 4.6 m/s so a flat 60-frame hold covers four and a half metres, and fired at a
  // target three metres out it lands the player past it and the walk oscillates
  // until its budget is gone.
  const walkTo = async (pt, stopM) => {
    aimAtPoint(pt);
    let d = gd(eye(), pt);
    for (let i = 0; i < 30 && d > stopM; ++i) {
      const frames = Math.max(5, Math.min(60,
        Math.round(((d - stopM * 0.7) / 4.6) * 60)));
      of.input.tape([{ hold: frames, keys: ['KeyW'] }, { hold: 2, keys: [] }]);
      await sleep(1.1);
      aimAtPoint(pt);
      d = gd(eye(), pt);
    }
    of.input.tape([{ hold: 2, keys: [] }]);
    await sleep(0.2);
    return +d.toFixed(2);
  };
  const ghostAt = async (y, p) => {
    of.look(y, p);
    await sleep(0.035);
    return of.build().ghost;
  };
  /** Nearest-to-centre first, so the common case costs one sample. */
  const SPIRAL = (() => {
    const out = [];
    for (let a = -5; a <= 5; ++a) for (let b = -5; b <= 5; ++b) out.push([a, b]);
    out.sort((x, z) => (Math.abs(x[0]) + Math.abs(x[1]))
      - (Math.abs(z[0]) + Math.abs(z[1])));
    return out;
  })();
  const findGhost = async (t, pred, stepDeg = 1.4) => {
    const [y0, p0] = aimAtPoint(t);
    for (const [a, b] of SPIRAL) {
      const y = y0 + a * stepDeg;
      const p = Math.max(-88, Math.min(15, p0 + b * stepDeg));
      const g = await ghostAt(y, p);
      if (g !== null && pred(g)) return { g, yaw: y, pitch: p };
    }
    return null;
  };
  const placeHere = async () => {
    const before = fac().buildings;
    of.input.tape([{ hold: 3, actions: ['use'] }, { hold: 5, keys: [] }]);
    await sleep(0.3);
    return fac().buildings - before;
  };
  const SLOT = { hand: 1, miner: 3, belt: 4, smelter: 5 };
  const hold = async (what) => { of.hotbar(SLOT[what]); await sleep(0.25); };
  /**
   * Put `kind` down by catching a NAMED socket of something already standing.
   *
   * The ghost's own `snapped` sentence is the predicate rather than a distance
   * computed here, because `FactoryGhost.resolveGhost` and `FactoryWiring.wire`
   * reach the same `linksBetween`: a ghost that names the socket IS the placement
   * about to be made, and a probe that picked a cell by distance and hoped would
   * be guessing at the very thing it is supposed to measure.
   */
  const snapPlace = async (kind, at, socket, standBack) => {
    if (SLOT[kind] !== undefined) await hold(kind);
    if (standBack !== undefined) await walkTo(standBack, 3.4);
    const r = await findGhost(at, (g) => g.ok && g.snapped.includes(socket));
    if (r === null) return null;
    of.look(r.yaw, r.pitch);
    await sleep(0.2);
    const said = of.build().ghost;
    const before = fac().list.map((b) => b.id);
    if (await placeHere() <= 0) return null;
    const made = fac().list.find((b) => !before.includes(b.id));
    log.push(`${kind} #${made.id} at ${made.cell} via "${said.snapped}", `
      + `ghost ports "${said.ports}"`);
    return made;
  };
  const click = (el) => {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true,
      view: window }));
    return true;
  };
  // THE HOPPERS ARE READ OFF THE PANEL AS WELL AS OFF `list[]`, AND THE REASON
  // IS A DEFECT THIS PROBE FOUND AND THE FACTORY LANE HAS SINCE FIXED.
  //
  // `FactoryReport.row` gates the `input` field on `f.inputItemOf(p) > 0`, and
  // `Factory.inputItemOf` used to answer `p.kind !== 'smelter' && p.kind !==
  // 'esmelter' ? 0 : ...`, so an ASSEMBLER's `input` was published as `null`
  // however full it was, while its `input2` (gated on `p.kind === 'assembler'`)
  // reported fine. That is the exact asymmetry FS-56's own comment in that file
  // says `input2` was added to remove: the report could say how much of
  // ingredient B a machine held and not how much of ingredient A. Measured on
  // the first run of this probe: `input: null, input2: 50` on a machine that had
  // just manufactured eleven smelters, which it could not have done on stone
  // alone. `inputItemOf` now answers the assembler's own recipe.
  //
  // BOTH READINGS ARE STILL TAKEN AND BOTH ARE REPORTED, because they are two
  // different claims: `screen.input.count` is `f.line.inputBuffer(b.build)`,
  // which is `of_net_input_buffer` and therefore /core's own number, and
  // `list[].input` is the REPORT's answer to the same question. Publishing both
  // is what makes them comparable rather than one of them a substitute for the
  // other, and it is what would catch the regression again.
  const openPanel = async () => {
    await hold('hand');
    await walkTo(rowOf(ASM).pos, 3.0);
    if (!(await aimBuild(ASM))) return false;
    of.input.act(['use'], 4);
    await sleep(0.5);
    return of.game().screen.open === true;
  };
  const closePanel = async () => { of.escape(); await sleep(0.4); };
  const hopA = () => of.game().screen?.input?.count ?? -1;
  const hopB = () => of.game().screen?.input2?.count ?? -1;

  /** Put the crosshair on a placed building and confirm the GAME agrees. */
  const aimBuild = async (id) => {
    const b = rowOf(id);
    if (b === null) return false;
    const [y0, p0] = aimAtPoint(b.pos);
    for (const [a, c] of SPIRAL) {
      of.look(y0 + a * 1.2, Math.max(-88, Math.min(15, p0 + c * 1.2)));
      await sleep(0.03);
      if ((of.game().aimed?.build?.id ?? -1) === id) return true;
    }
    return false;
  };

  // ==========================================================================
  // 0. THE WORLD, AND THE TWO DEPOSITS THE SCENE IS STRUNG BETWEEN
  // ==========================================================================
  await sleep(1.0);
  await of.wipe();
  await sleep(0.6);
  if (of.game() === null) return { valid: false, why: 'no gameplay layer' };
  check('this run is SANDBOX, so nothing is refused for cost',
    of.game().mode.sandbox === true, JSON.stringify(of.game().mode));

  // KIND NUMBER AND RESOURCE NAME BOTH, coalsmelt.js's rule: a kind is an index,
  // and an index is exactly the sort of thing that gets renumbered.
  const patches = of.game().ore.list;
  const nodes = of.nodes();
  const iron = patches.find((p) => p.kind === 3);
  const rock = patches.find((p) => p.kind === 1);
  if (iron === undefined || rock === undefined) {
    return { valid: false, why: 'this world has no iron patch or no rock patch',
      kinds: patches.map((p) => p.kind) };
  }
  check('the IronOre patch is kind 3 and its resource is named Raw iron',
    nodes.some((n) => n.kind === 3 && n.name === 'Raw iron'),
    JSON.stringify([...new Set(nodes.map((n) => `${n.kind}|${n.name}`))]));
  check('the Rock patch is kind 1 and its resource is named Stone',
    nodes.some((n) => n.kind === 1 && n.name === 'Stone'),
    JSON.stringify([...new Set(nodes.map((n) => `${n.kind}|${n.name}`))]));

  const up = norm(iron.centre);
  let toRock = sub(rock.centre, iron.centre);
  toRock = norm(add(toRock, up, -dot(toRock, up)));
  // right = up x fwd (see the header), and the stone has to arrive on the right
  // face, so the iron chain has to run along toRock x up.
  const wantFwd = norm(cross(toRock, up));
  const apartM = gd(iron.centre, rock.centre);
  log.push(`iron patch r=${iron.radiusM.toFixed(1)} m, rock patch `
    + `r=${rock.radiusM.toFixed(1)} m, centres ${apartM.toFixed(1)} m apart`);

  // ==========================================================================
  // 1. /core's OWN HAND RECIPE, READ BY A ROUTE THAT HAS NEVER HEARD OF FS-56
  //
  // This happens BEFORE anything is built, because it needs no world: if the
  // client has grown a second recipe table, that is just as true of an empty
  // clearing, and finding it here reports it as what it is rather than as a
  // factory that made the wrong number of things.
  //
  // `of.game().recipes` is `GameCore.recipes()`, which is `of_gp_recipe_info`
  // straight off the bridge. `FactoryRecipes.assemblerMenu` reads the same call
  // and reshapes it; reading the bill back out of the machine panel instead would
  // be the client agreeing with itself, which is the shape of a check that cannot
  // fail.
  // ==========================================================================
  const SMELTER_ITEM = 60;          // items::SurvivalSmelter, 0x003C
  const coreRecipes = of.game().recipes ?? [];
  const coreRow = coreRecipes.find((r) => r.output === SMELTER_ITEM) ?? null;
  if (coreRow === null || !Array.isArray(coreRow.inputs)) {
    return { valid: false, why: 'no smelter row in /core\'s hand recipes, or the '
      + 'report does not publish the bill',
      outputs: coreRecipes.map((r) => [r.name, r.output]), log };
  }
  check('/core\'s own hand recipe for the Smelter has exactly two ingredients',
    coreRow.inputs.length === 2, JSON.stringify(coreRow));
  const coreBill = coreRow.inputs;
  log.push(`/core hand recipe ${coreRow.name} (${coreRow.output}): `
    + `${JSON.stringify(coreBill)}`);

  // ==========================================================================
  // 2. THE IRON CHAIN: drill, two belts, smelter, two belts
  // ==========================================================================
  log.push(`walked to ${await walkTo(add(iron.centre, wantFwd,
    -iron.radiusM * 0.55), 3.0)} m of the iron patch's upstream rim`);
  await hold('miner');
  const dg = await findGhost(add(iron.centre, wantFwd, -iron.radiusM * 0.15),
    (g) => g.ok && g.patch >= 0 && dot(g.fwd, wantFwd) > 0.6);
  if (dg === null) {
    return { valid: false, why: 'no drillable cell on the iron patch facing the '
      + 'axis that would put port B towards the rock', ghost: of.build().ghost, log };
  }
  of.look(dg.yaw, dg.pitch);
  await sleep(0.2);
  if (await placeHere() <= 0) {
    return { valid: false, why: 'the iron drill would not go down', log };
  }
  const ironDrill = fac().list.find((b) => b.kind === 'miner');
  const F = ironDrill.fwd;
  const U = ironDrill.up;
  const R = norm(cross(U, F));
  log.push(`iron drill #${ironDrill.id} on patch ${ironDrill.patch}, mines item `
    + `${ironDrill.outputItem}, heading dot ${dot(F, wantFwd).toFixed(3)}`);

  /**
   * The outward socket of whatever is currently the end of the chain.
   *
   * GP-760: THIS WAS A STALE CONSTANT, machineports.js's exact class. The
   * ternary used to read `b.kind === 'belt' ? 0.5 : 1.0`, which is the belt's
   * own outlet offset (still right, belts never moved) against a HARDCODED 1.0
   * for every machine, which was right for a 2 m smelter and a 2 m drill and
   * has been wrong since FS-73 took both to 4 m. `of.game().factory.footprint`
   * is the client's own table (FS-73's, the same one machineports.js,
   * autoline.js and shortline.js already read for the identical reason), and
   * every socket in the shipped set sits at exactly half its housing's
   * footprint from centre: measured here from the port GAP this probe's own
   * runs report, `#1 miner socket_item_out -> socket_belt_in (0.50 m)` and
   * `#3 belt socket_belt_out -> socket_item_in (0.50 m)` at a 3-cell (3.006 m)
   * mating distance both solve to an outlet 2.006 m out, not 1 m, matching
   * `footprint.miner / 2` and `footprint.smelter / 2` (both 4 / 2 = 2) and not
   * the literal this used to be.
   *
   * THE FAILURE THIS PRODUCED WAS NOT A NARROW MISS. `chainStep`'s aim point
   * for the belt off the smelter's outlet was 1 m short of the real socket,
   * so its `standBack` (the aim point minus 3.2 m along the run's own axis)
   * landed on the INPUT side of the housing instead of past the outlet, and a
   * 21x21 degree ghost sweep centred there (this lane's own diagnostic) found
   * not one `ok: true` candidate anywhere in it: every cell it reached read
   * `too close to #1 miner`, `too close to #4 smelter` or `cell taken`, because
   * the true output cell (the first one clear of `MachinePlacement.
   * footprintsOverlap`'s reach, three cells out) was never inside the swept
   * cone at all. `belt #2 off the drill's own outlet mated anyway on the same
   * build, purely because a drill has no input side for the wrong standoff to
   * collide with; that asymmetry is why this probe's first two belts (off the
   * miner) went down clean while the third (off the smelter) could not, and it
   * is why "some placements still work" is not evidence the constant was fine.
   */
  const FPT = of.game().factory.footprint;
  const tailOut = (b) => add(b.pos, b.fwd, FPT[b.kind] / 2);
  let tip = ironDrill;
  /**
   * GP-760, SECOND HALF OF THE SAME DEFECT. `standBack` used to be a flat
   * `add(at, F, -3.2)`, 3.2 m BEHIND THE OUTLET POINT: fine for a belt tip,
   * where "behind" is empty ground in the middle of a run, and silently not
   * fine for a MACHINE tip, where "behind" is its own INPUT face, which on a
   * short chain is occupied by the very belts and the drill that feed it.
   * Measured here, with the corrected 4 m footprint: standing behind the
   * smelter put the player within about a metre of the drill's own housing,
   * seven cells up the same short chain, and `walkTo`'s 30-iteration budget
   * logged the identical eye position step after step, wedged against it.
   * Standing PAST the outlet instead (continuing the direction of travel the
   * whole chain was already laid in) measured no better: that point is a
   * further 3.6 m PAST the housing beyond where the player already stands on
   * the input side, so the walk is longer, not shorter, and it wedged the
   * same way.
   *
   * enemies.js's `placeUntil` named this exact class first (GP-690: a
   * one-shot angle tuned against a 2 m housing went stale the day FS-73 made
   * it 4 m) and its fix was to WIDEN BY TRYING rather than to compute one
   * more single "correct" offset that the next rescale falsifies again. This
   * is that fix applied to a walk instead of a placement ring: several
   * honestly different candidate standoffs, GEOMETRICALLY DISTINCT (behind,
   * past, and off to either side along `R`, the chain's own measured right
   * axis), tried in turn until one lands a `snapPlace`. A belt tip keeps its
   * single, always-working candidate (behind it was never the problem there:
   * `0.5 - 3.2 = -2.7` from its outlet is `-2.2` from its own centre).
   */
  const standCandidatesFor = (b) => {
    const half = FPT[b.kind] / 2;
    if (b.kind === 'belt') return [add(b.pos, b.fwd, -(half + 2.2))];
    return [
      add(add(b.pos, b.fwd, half + 1.6), R, 0),
      add(add(b.pos, b.fwd, 0), R, half + 3.4),
      add(add(b.pos, b.fwd, 0), R, -(half + 3.4)),
      add(b.pos, b.fwd, -(half + 2.2)),
    ];
  };
  const chainStep = async (kind, socket) => {
    const at = tailOut(tip);
    for (const standBack of standCandidatesFor(tip)) {
      const made = await snapPlace(kind, at, socket, standBack);
      if (made !== null) { tip = made; return true; }
    }
    return false;
  };
  if (!await chainStep('belt', 'socket_item_out')) {
    return { valid: false, why: 'no belt would take the iron drill outlet', log };
  }
  if (!await chainStep('belt', 'socket_belt_out')) {
    return { valid: false, why: 'the ore run would not extend', log };
  }
  if (!await chainStep('smelter', 'socket_belt_out')) {
    return { valid: false, why: 'no smelter at the head of the ore run', log };
  }
  if (!await chainStep('belt', 'socket_item_out')) {
    return { valid: false, why: 'no belt off the smelter outlet', log };
  }
  if (!await chainStep('belt', 'socket_belt_out')) {
    return { valid: false, why: 'the ingot run would not extend', log };
  }
  const smelter = fac().list.find((b) => b.kind === 'smelter');
  const ingotHead = tip;

  // ==========================================================================
  // 3. THE ASSEMBLER, OUT OF THE BUILD MENU (GP-110), ONTO THE INGOT BELT
  // ==========================================================================
  // B and a click on the tile, which is the player's own route to a part that is
  // not on the starting bar. `assignSlot` would have been one line and would have
  // proved a path only a probe can take (standing rule 3).
  of.input.act(['build'], 4);
  await sleep(0.45);
  const menuRowIds = (of.buildMenu?.() ?? { rows: [] }).rows.map((r) => r.id);
  const tileSel = '#of-build .of-btile[data-build="assembler"]';
  const tile = document.querySelector(tileSel);
  check('the build menu lists an assembler', menuRowIds.includes('assembler')
    && tile !== null, menuRowIds.join(','));
  if (tile !== null) {
    tile.dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 }));
    await sleep(0.11);
    (document.querySelector(tileSel) ?? tile).click();
    await sleep(0.45);
  }
  if (of.buildMenu().open === true) { of.escape(); await sleep(0.3); }
  check('and clicking the tile puts an assembler in hand',
    of.build().selected === 'assembler', String(of.build().selected));
  let assemblerGhostPorts = '';
  {
    const at = tailOut(ingotHead);
    await walkTo(add(at, F, -3.2), 3.4);
    const r = await findGhost(at, (g) => g.ok
      && g.snapped.includes('socket_belt_out'));
    if (r === null) {
      return { valid: false, why: 'no assembler ghost on the ingot run head',
        ghost: of.build().ghost, log };
    }
    of.look(r.yaw, r.pitch);
    await sleep(0.2);
    // FS-45 SAYS THE VERDICT ARRIVES BEFORE THE BUTTON, AND THIS IS WHERE IT IS
    // CHECKED FOR THE BIGGEST MACHINE IN THE GAME. Captured before the press on
    // purpose: a sentence read afterwards proves only that it arrives eventually.
    //
    // IT DID NOT HOLD WHEN THIS PROBE WAS FIRST RUN, and the reason is worth the
    // paragraph because it is the class of bug this file kept turning up.
    // `FactoryGhost`'s preview filter was a hard `1.6 * 2 + PORT_MATE_M` = 3.85 m,
    // from "no socket sits more than 1.6 m from its own origin"; FS-57's 8 m
    // assembler puts its inlets 4.000 m out and stands 5.01 m from the belt that
    // feeds it, so the filter dropped the assembler and the ghost said NOTHING
    // where a smelter says the whole sentence. Fixed as FS-59 (`previewNearM`
    // derives it per pair from FOOTPRINT), so this now reads the mate and is
    // asserted rather than merely reported.
    assemblerGhostPorts = of.build().ghost.ports;
    if (await placeHere() <= 0) {
      return { valid: false, why: 'the assembler would not go down', log };
    }
  }
  const asm0 = fac().list.find((b) => b.kind === 'assembler');
  if (asm0 === undefined) return { valid: false, why: 'no assembler in the plan', log };
  const ASM = asm0.id;
  log.push(`assembler #${ASM} at ${asm0.cell}, build ${asm0.build}, ghost said `
    + `ports "${assemblerGhostPorts}"`);

  // ==========================================================================
  // 4. AN UNSET ASSEMBLER MAKES NOTHING, AND SAYS SO
  // ==========================================================================
  await walkTo(asm0.pos, 3.0);
  await hold('hand');
  check('the crosshair reaches the assembler', await aimBuild(ASM),
    JSON.stringify(of.game().aimed));
  of.input.act(['use'], 4);
  await sleep(0.5);
  const s0 = of.game().screen;
  const asmUnset = rowOf(ASM);
  check('the machine screen opened on the assembler',
    s0.open === true && s0.of === 'assembler',
    JSON.stringify({ open: s0.open, of: s0.of }));
  const unsetSaysNoRecipe = check('an unset assembler reads NO RECIPE',
    s0.status === 'NO RECIPE', s0.status);
  const unsetHasNoEntity = check('and has no /core entity at all (build -1)',
    asmUnset.build === -1, String(asmUnset.build));
  const unsetMadeNothing = check('and has made nothing',
    asmUnset.producedOfOutput === 0, String(asmUnset.producedOfOutput));
  check('and the plan records no recipe', asmUnset.recipe === 0,
    String(asmUnset.recipe));
  const menuRows = s0.recipes ?? [];
  const refusedRows = s0.refused ?? [];
  check('the panel offers a menu', menuRows.length > 0, JSON.stringify(menuRows));
  check('and NAMES the rows it cannot run, with the reason (GP-56)',
    refusedRows.some((r) => r.includes('3 ingredients')),
    JSON.stringify(refusedRows));

  // ==========================================================================
  // 5. THE CLICK. THE DOM BUTTON, NOT THE API.
  // ==========================================================================
  const button = document.querySelector(`#of-furnace [data-recipe="${SMELTER_ITEM}"]`);
  check('the menu carries a button for the Smelter recipe', button !== null,
    [...document.querySelectorAll('#of-furnace [data-recipe]')]
      .map((e) => e.getAttribute('data-recipe')).join(','));
  const clicked = click(button);
  await sleep(0.6);
  const s1 = of.game().screen;
  const asmSet = rowOf(ASM);
  const recipeSetByClick = check(
    'recipeSetByClick: clicking the row set the PLAN to that recipe',
    clicked === true && asmSet.recipe === SMELTER_ITEM,
    JSON.stringify({ clicked, recipe: asmSet.recipe }));
  check('and the menu now shows that row as [set]',
    (s1.recipes ?? []).some((r) => r.startsWith(`${SMELTER_ITEM}:`)
      && r.includes('[set]')), JSON.stringify(s1.recipes));
  check('and the machine now exists in /core', asmSet.build >= 0,
    String(asmSet.build));
  check('and the panel stopped saying NO RECIPE', s1.status !== 'NO RECIPE',
    s1.status);
  const bill = asmSet.recipeInputs;
  log.push('recipeInputs [aItem,aCount,bItem,bCount,output,ticks] = '
    + JSON.stringify(bill));
  // The panel holds the pointer; every gesture after this is a world gesture.
  of.escape();
  await sleep(0.4);

  // ==========================================================================
  // 6. THE STONE CHAIN, ACROSS THE CLEARING
  // ==========================================================================
  // Five cells out along the assembler's own right face. Five is
  // `FactorySnap.stepsFor(assembler, belt)`, ceil((8 + 1) / 2), and the site grid
  // measures 1.002 m per cell on the shipped world.
  const CELL_M = 1.002;
  const asmNow = rowOf(ASM);
  const pbPoint = add(asmNow.pos, R, 5 * CELL_M);
  log.push(`walked to ${await walkTo(add(rock.centre, R,
    rock.radiusM * 0.6), 3.0)} m of the rock patch's far rim`);
  await hold('miner');
  const rg = await findGhost(add(rock.centre, R, -rock.radiusM * 0.1),
    (g) => g.ok && g.patch >= 0 && dot(g.fwd, R) < -0.6);
  if (rg === null) {
    return { valid: false, why: 'no drillable cell on the rock patch pointing '
      + 'back at the assembler', ghost: of.build().ghost, fails, log };
  }
  of.look(rg.yaw, rg.pitch);
  await sleep(0.2);
  if (await placeHere() <= 0) {
    return { valid: false, why: 'the rock drill would not go down', fails, log };
  }
  const rockDrill = fac().list.filter((b) => b.kind === 'miner')
    .find((b) => b.id !== ironDrill.id);
  log.push(`rock drill #${rockDrill.id} on patch ${rockDrill.patch}, mines item `
    + `${rockDrill.outputItem}`);
  const stoneBelt0 = await snapPlace('belt', tailOut(rockDrill), 'socket_item_out',
    add(tailOut(rockDrill), rockDrill.fwd, -3.2));
  if (stoneBelt0 === null) {
    return { valid: false, why: 'no belt would take the rock drill outlet',
      fails, log };
  }

  // THE HAUL, as ONE held drag. `BuildDrag.dragRun` fills every cell between the
  // run's end and the crosshair and turns each tile at its successor, so the run
  // is chained BY CONSTRUCTION rather than by the aim happening to stay on axis;
  // `moved` is satisfied by the walk, which is exactly how probes/controls.js lays
  // a fifteen-tile run. Two legs: sideways onto the port-B axis, then straight
  // down it, because the last tile has to approach the housing along that axis or
  // its outlet faces somewhere else.
  const t0R = dot(sub(stoneBelt0.pos, asmNow.pos), R);
  const corner = add(asmNow.pos, R, t0R);
  const way = [];
  {
    const n1 = Math.max(1, Math.round(gd(stoneBelt0.pos, corner) / 5));
    for (let k = 1; k <= n1; ++k) {
      way.push([corner[0] + (stoneBelt0.pos[0] - corner[0]) * (1 - k / n1),
        corner[1] + (stoneBelt0.pos[1] - corner[1]) * (1 - k / n1),
        corner[2] + (stoneBelt0.pos[2] - corner[2]) * (1 - k / n1)]);
    }
    // THE DRAG DELIBERATELY STOPS SHORT, and the first run of this probe is why.
    // A drag ends at the crosshair's CELL, the crosshair is a 9 m ground march
    // taken by a walking player, and aimed at the port-B cell itself it overshot
    // by two cells: the run walked straight through the housing and stood four
    // tiles inside it. So the last waypoint is `STOP_SHORT_M` out along the same
    // axis and the remaining cells are closed one snapped press at a time below,
    // where each press is exactly one cell and cannot overshoot.
    const STOP_SHORT_M = 6;
    const endT = 5 * CELL_M + STOP_SHORT_M;
    const n2 = Math.max(1, Math.round((t0R - endT) / 5));
    for (let k = 1; k <= n2; ++k) {
      way.push(add(asmNow.pos, R, t0R + (endT - t0R) * (k / n2)));
    }
  }
  log.push(`stone haul: ${gd(stoneBelt0.pos, corner).toFixed(1)} m across, then `
    + `${(t0R - 5 * CELL_M).toFixed(1)} m down the port-B axis, `
    + `${way.length} waypoints`);
  await hold('belt');
  await walkTo(stoneBelt0.pos, 3.0);
  aimAtPoint(stoneBelt0.pos);
  await sleep(0.2);
  // ONE tape for the whole gesture: two tapes would put a released frame between
  // them, which is a second PRESS and not a hold, and the drag would restart from
  // the new cell instead of running on. Replacing the tape with another that
  // still holds `use` keeps the button down, which is how the walk is steered.
  of.input.tape([{ hold: 5000, actions: ['use'], keys: ['KeyW'] }]);
  await sleep(0.2);
  // GP-761 INSTRUMENTATION. `sleep` is `of.run` (Loop.run): it stops the real
  // rAF loop and drives a SYNTHETIC clock for the requested seconds, which its
  // own header says exists BECAUSE headless Chrome's rAF pump is bursty and
  // otherwise "a 20 second scripted walk advanced 90 fixed ticks". So the tick
  // count this gesture consumes should be a deterministic function of how many
  // waypoint iterations run below, not of real wall-clock load; logged (not
  // asserted) per waypoint so a stall can be told apart from "ran out of route"
  // and a tick-count variance can be told apart from a same-ticks/different-
  // position variance (the latter would point at async terrain/collision, not
  // at the tape or the of.run() clock).
  let routeM = 0;
  { let prev = stoneBelt0.pos; for (const wp of way) { routeM += gd(prev, wp); prev = wp; } }
  const dragHaul = [];
  const tick0 = of.world().tick;
  const wall0 = Date.now();
  let prevEye = eye();
  let coveredM = 0;
  for (const wp of way) {
    for (let k = 0; k < 16 && gd(eye(), wp) > 5.0; ++k) {
      const tBefore = of.world().tick;
      await sleep(0.35);
      aimAtPoint(wp);
      const e = eye();
      coveredM += gd(prevEye, e);
      prevEye = e;
      dragHaul.push({ k, ticks: of.world().tick - tBefore,
        distToWp: +gd(e, wp).toFixed(2), longestDrag: of.build().longestDrag });
    }
  }
  of.input.tape([{ hold: 6, keys: [] }]);
  await sleep(0.4);
  const draggedTiles = of.build().longestDrag;
  const dragTicks = of.world().tick - tick0;
  const dragWallMs = Date.now() - wall0;
  log.push(`the drag laid ${draggedTiles} tiles in one hold; `
    + `${fac().list.filter((b) => b.kind === 'belt').length} belts standing`);
  log.push(`GP-761: drag consumed ${dragTicks} ticks over ${dragWallMs} ms real `
    + `time (${(dragTicks / Math.max(1, dragWallMs / 1000)).toFixed(1)} ticks/s `
    + `effective), eye travelled ${coveredM.toFixed(1)} m against a `
    + `${routeM.toFixed(1)} m waypoint route (${way.length} waypoints, `
    + `${dragHaul.length} of.run(0.35) calls, last call k=${dragHaul.at(-1)?.k ?? -1} `
    + `stopped ${dragHaul.at(-1)?.distToWp ?? -1} m from its waypoint)`);

  // THE LAST FEW CELLS, ONE SNAPPED PRESS EACH. A drag ends wherever the
  // crosshair is and the crosshair is no more accurate than the 9 m aim march,
  // while the final cell has to be exact or nothing mates. Extending off the
  // run's own `socket_belt_out` puts each new tile one cell ahead carrying the
  // run's own heading, which is `FactorySnap.proposeFromSocket`'s whole rule, so
  // the approach stays straight and the last tile's outlet faces the housing.
  //
  // THE STOP TEST IS SIGNED ALONG R, not a distance, and that matters: a plain
  // `distance < 0.6` cannot tell "one cell short of the port" from "one cell
  // past it", and on the first run of this probe it happily extended a run that
  // was already inside the housing, three cells further in, every press making
  // the number it was testing larger.
  //
  // NOTHING STOPS A BELT STANDING INSIDE AN 8 m MACHINE, which is the second
  // defect this probe turned up and is reported rather than worked around:
  // `MachinePlacement.machineClash` returns null for any part whose FOOTPRINT is
  // under 2, and a belt tile is 1, so the overlap test is never run for a belt at
  // all. That was invisible while every machine was 2 m and occupied exactly the
  // one cell key `Factory.occupied` already guards; an 8 m assembler occupies one
  // key and nine cells of ground, so four belt tiles were drawn standing inside
  // its housing before this test was signed.
  const lastBelt = () => fac().list.filter((b) => b.kind === 'belt')
    .reduce((a, b) => (b.id > a.id ? b : a));
  const shortOfPortB = (p) => dot(sub(p, pbPoint), R);
  let closed = 0;
  // GP-761 DIAGNOSED HERE, AND HALF FIXED (probe-side); the other half is a
  // game-side finding recorded below rather than worked around.
  //
  // THE OLD LOOP always extended from `lastBelt()`'s OWN `fwd` (`tailOut`,
  // the same helper every OTHER chain step in this file uses correctly), on
  // the assumption that the drag's tip is oriented toward the port. Measured
  // across TWO runs on the identical seed, it is not: `dot(t.fwd, R)` at the
  // tip read 0.9975 to 1.0 -- pointing AWAY from port B, not toward it -- so
  // EVERY press in both runs made `shortOfPortB` WORSE by exactly one cell
  // (`closedThisPressM: -1`, 14 of 14 presses, both runs, bit-for-bit the
  // same shape). That is why raising the budget alone (tried by the prior
  // lane) cost "several unbounded minutes ... without reliably finishing": a
  // loop that diverges by a fixed amount every press never converges no
  // matter how large its budget, it only spends longer getting further away,
  // and each press is not cheap (a `findGhost` spiral plus a walk).
  //
  // THREE WAYS OF ASKING FOR THE NEXT TILE WERE TRIED, NOT ONE, before this
  // was accepted as a game-side finding: (1) the tip's own `fwd`, the
  // original; (2) aiming straight down `-R` at the port axis while still
  // asking for the TIP'S `socket_belt_out`; (3) aiming the same way but
  // asking for the tip's `socket_belt_in` instead, on the theory that a new
  // tile feeding INTO the tip would itself point the right way and hand the
  // NEXT press a correctly-oriented tip. All three found a valid snap and all
  // three still moved AWAY from the port by one cell (see NUMBERS.md GP-761:
  // 'out(fwd)' -1, 'out(-R)' -1, 'in(-R)' -1). `FactorySnap` is resolving the
  // next cell from the belt's actual authored geometry, not from the aim
  // point or which named socket the probe asked to match, so no aim strategy
  // available through this probe's placement API can route around it. That
  // rules out "the probe is aiming badly" as the cause; what remains is the
  // drag's own belt topology at its stop point, which is factory-sim's, not
  // this probe's, to fix (see the routed finding below).
  //
  // THE FIX ON THIS SIDE is therefore not a cleverer aim, it is refusing to
  // trust an untested one: MEASURE every press rather than assume it helped.
  // The instant a press fails to reduce `shortOfPortB`, stop -- report the
  // divergence by name and leave the rest of the budget unspent, rather than
  // burning it moving backward. That bounds the loop's worst case to O(1)
  // presses instead of O(budget) whenever the tip is oriented the wrong way,
  // while leaving it free to close a genuinely-reachable gap in one pass
  // should a future world's drag stop with its tip correctly oriented.
  const pressLog = [];
  for (let k = 0; k < 50; ++k) {
    const t = lastBelt();
    const shortBefore = shortOfPortB(t.pos);
    if (shortBefore < 0.5) break;
    const made = await snapPlace('belt', tailOut(t), 'socket_belt_out',
      add(t.pos, t.fwd, -3.4));
    if (made === null) {
      pressLog.push({ k, shortBefore: +shortBefore.toFixed(2), made: false });
      break;
    }
    const shortAfter = shortOfPortB(made.pos);
    const closedThisPressM = +(shortBefore - shortAfter).toFixed(2);
    pressLog.push({ k, shortBefore: +shortBefore.toFixed(2),
      shortAfter: +shortAfter.toFixed(2), closedThisPressM });
    if (closedThisPressM <= 0) {
      log.push(`GP-761: press ${k} moved the run AWAY from port B `
        + `(${shortBefore.toFixed(2)} -> ${shortAfter.toFixed(2)} m short); `
        + 'stopping honestly rather than spending the rest of the budget '
        + 'diverging further');
      break;
    }
    closed++;
  }
  const tipShortM = +shortOfPortB(lastBelt().pos).toFixed(2);
  log.push(`closed the last ${closed} cells by snapping; the run tip is `
    + `${tipShortM} m short of the port-B cell (negative means past it)`);
  log.push(`GP-761 press-by-press: ${JSON.stringify(pressLog)}`);

  // ==========================================================================
  // 7. THE TWO LINKS
  // ==========================================================================
  await sleep(1.0);
  const linksIn = () => fac().links.filter((l) => l.to === ASM);
  const linkA = () => linksIn().find((l) => l.toPort === 'socket_item_in_a') ?? null;
  const linkB = () => linksIn().find((l) => l.toPort === 'socket_item_in_b') ?? null;
  log.push(`links into the assembler: ${JSON.stringify(linksIn())}`);
  log.push(`refusals: ${JSON.stringify(fac().refusals)}`);

  const beltMatedBothInlets = linkA() !== null && linkB() !== null;

  // ==========================================================================
  // 8. THE STARVED WINDOW: BOTH PORTS MATED, THE STONE BELT SATURATED, AND NOT
  //    ONE UNIT OF STONE DELIVERED.
  // ==========================================================================
  // THIS IS THE DEFECT THE PROBE FOUND AND IT IS THE MOST IMPORTANT THING IN
  // THIS FILE, so the window that measures it comes BEFORE anything is put in by
  // hand and the result is a NAMED ASSERTION rather than a note.
  //
  // WHAT IS MEASURED: the run's head mates `socket_item_in_b` at 0.50 m, facing
  // -1, and the line saturates to its own ceiling (4 items a tile,
  // `kUnitsPerTile / kItemSpacing`), and `input2` stays at ZERO for the whole
  // window, and nothing is manufactured, while `input` sits full of iron that
  // arrived on the OTHER belt through the identical mechanism.
  //
  // WHY, traced to the line: `Automation::inferItem` decides an inserter's item
  // type at CONNECT time, and for a belt feeding a machine it reads
  // `sim_.lineHeadItem(from)` and falls back to the SLOT-1 ingredient when the
  // belt is empty. `FactorySim` has no re-recipe and no entity removal, so every
  // commit calls `recreate()`, which throws away everything riding every belt;
  // therefore every belt is empty at the moment it is connected, therefore every
  // belt-to-assembler inserter in the client is bound to ingredient A. The stone
  // line's inserter is looking for Iron on a belt carrying Stone, and
  // `inserterSystem`'s pickup gate is `sl.headItem() == insItem_[i]`, so it never
  // picks anything up. The iron line works only because ingredient A is what it
  // happens to carry.
  //
  // The consequence is not "sometimes slow": an assembler's SECOND ingredient
  // cannot be delivered by belt at all on this build, which is the one thing a
  // two-input machine exists for. The fix belongs in /core or in the wiring
  // layer, not here: either `connect` takes the item from the DESTINATION's
  // slots against what the source can produce, or the client passes the item
  // explicitly through `AutoLine.connect` instead of letting it be inferred.
  const panelOpen = await openPanel();
  check('the machine screen re-opened for the window', panelOpen,
    JSON.stringify(of.game().screen?.open));
  of.input.tape([{ hold: 2, keys: [] }]);
  // Long enough that belt transit cannot be the explanation: `factory_sim.h`
  // runs a basic belt at `speedUnitsPerTick = 8` of `kUnitsPerTile = 256`, which
  // is 32 ticks a tile, so even a 73 tile haul delivers its first unit in about
  // 39 s from a standing start. Every snapped press that closed the last cells
  // re-committed and emptied the line, so the stone starts from the far end.
  const STARVE_S = 100;
  const st0 = { made: rowOf(ASM).producedOfOutput, ticks: fac().coreTicks,
    iron: hopA(), stone: hopB() };
  let starvePeakStone = 0;
  let starveMinIron = Infinity;
  for (let i = 0; i < 200; ++i) {
    await sleep(STARVE_S / 200);
    starvePeakStone = Math.max(starvePeakStone, hopB());
    starveMinIron = Math.min(starveMinIron, hopA());
  }
  const st1 = { made: rowOf(ASM).producedOfOutput, ticks: fac().coreTicks,
    iron: hopA(), stone: hopB() };
  const stoneRun = fac().runs.find((r) => r.tiles > 10) ?? null;
  const starved = {
    coreTicks: st1.ticks - st0.ticks,
    made: st1.made - st0.made,
    stonePeak: starvePeakStone,
    ironHopper: [st0.iron, st1.iron],
    minIron: starveMinIron === Infinity ? -1 : starveMinIron,
    runTiles: stoneRun?.tiles ?? -1,
    runItems: stoneRun?.items ?? -1,
    // Four items a tile is `kUnitsPerTile / kItemSpacing`: the line's own
    // ceiling, so "saturated" is measured against /core's number and not a guess.
    runSaturated: stoneRun !== null && stoneRun.items >= stoneRun.tiles * 4,
  };
  log.push(`starved window: ${JSON.stringify(starved)}`);

  // ==========================================================================
  // 9. THE SAME MACHINE, ONE VARIABLE CHANGED: PUT THE STONE IN BY HAND
  // ==========================================================================
  // The A/B this probe is built on. Nothing moves, nothing is placed, nothing is
  // re-wired and no belt is touched; the only difference between the window
  // above and the window below is that the second hopper has stone in it. That
  // makes "a machine can be correctly configured, correctly connected and
  // stalled because ONE of two hoppers is empty" a measurement rather than a
  // sentence, and it is also the FS-56 hand-load path in its own right:
  // `feedAssembler` routes by item id into `of_net_feed_machine2` (ABI 18).
  await closePanel();
  let stoneInPack = 0;
  for (const n of of.nodes()) {
    if (n.kind !== 1) continue;
    for (let k = 0; k < 40; ++k) of.harvest(n.index);
  }
  stoneInPack = (of.game().carried.find((c) => c.name === 'Stone')
    ?? { count: 0 }).count;
  const reopened = await openPanel();
  let loads = 0;
  for (let k = 0; k < 20; ++k) {
    const loadBtn = [...document.querySelectorAll('#of-furnace [data-load]')]
      .find((e) => (e.textContent ?? '').includes('Stone'));
    if (!click(loadBtn)) break;
    loads++;
    await sleep(0.25);
  }
  log.push(`hand-load: ${stoneInPack} stone in the pack, ${loads} presses of the `
    + `Load button, panel ${reopened}, hopper now ${hopB()}`);
  check('the panel offered a Load button for the stone', loads > 0,
    [...document.querySelectorAll('#of-furnace [data-load]')]
      .map((e) => e.textContent).join(' | '));

  // ==========================================================================
  // 10. THE HEADLINE WINDOW. NOBODY TOUCHES ANYTHING.
  // ==========================================================================
  // POLLED IN SMALL STEPS rather than slept through, autoline.js's lesson: a
  // hopper that is emptied the instant it is filled is at zero in every sample a
  // coarse window takes, and "both hoppers filled" would then read false on a
  // line that is visibly working. The peaks are what the claim is about.
  const before = { tick: of.world().tick, coreTicks: fac().coreTicks,
    mined: fac().minedFromNodes, made: rowOf(ASM).producedOfOutput };
  const WINDOW = 70;
  const SAMPLES = 140;
  let peakIn = 0;
  let peakIn2 = 0;
  let workingSamples = 0;
  let rowInputWasAlwaysNull = true;
  for (let i = 0; i < SAMPLES; ++i) {
    await sleep(WINDOW / SAMPLES);
    const a = rowOf(ASM);
    if (a === null) continue;
    peakIn = Math.max(peakIn, hopA());
    peakIn2 = Math.max(peakIn2, hopB());
    if (a.input !== null) rowInputWasAlwaysNull = false;
    if (a.working) workingSamples++;
  }
  const after = { tick: of.world().tick, coreTicks: fac().coreTicks,
    mined: fac().minedFromNodes, made: rowOf(ASM).producedOfOutput };
  const asmRun = rowOf(ASM);
  const madeInWindow = after.made - before.made;
  const endHopA = hopA();
  const endHopB = hopB();
  await closePanel();
  log.push(`window: ${after.coreTicks - before.coreTicks} core ticks, mined `
    + `${(after.mined - before.mined).toFixed(0)}, hoppers ${endHopA}/`
    + `${endHopB} (peaks ${peakIn}/${peakIn2}), row.input `
    + `${JSON.stringify(asmRun.input)} row.input2 ${asmRun.input2}, output `
    + `buffer ${asmRun.output}, made ${madeInWindow} of item ${asmRun.outputItem}`);

  // ==========================================================================
  // 11. THE SECOND HALF OF THE CONTROL: LET THE HAND-LOADED STONE RUN OUT
  // ==========================================================================
  // The A/B closes here. The hand-load put a FINITE amount of stone in, so the
  // machine works until that is gone and then stops, on the same scene, with the
  // same belts, with the iron hopper still full. Three windows on one machine,
  // one variable moving: no stone (nothing), stone (buildables), stone gone
  // again (nothing). A build where `producedOfOutput` merely counted up would
  // fail the first and third; a build that had simply stopped working would fail
  // the second.
  const control = { ran: false };
  {
    control.panel = await openPanel();
    let drained = false;
    for (let k = 0; k < 200 && !drained; ++k) {
      await sleep(0.5);
      drained = hopB() === 0;
    }
    control.drained = drained;
    const c0 = { made: rowOf(ASM).producedOfOutput, iron: hopA(), stone: hopB(),
      ticks: fac().coreTicks };
    await sleep(20);
    const c1 = { made: rowOf(ASM).producedOfOutput, iron: hopA(), stone: hopB(),
      ticks: fac().coreTicks };
    await closePanel();
    control.ran = true;
    control.starvedCoreTicks = c1.ticks - c0.ticks;
    control.madeWhileStarved = c1.made - c0.made;
    control.stoneHopper = [c0.stone, c1.stone];
    control.ironHopper = [c0.iron, c1.iron];
    // THE OTHER HOPPER IS ASSERTED AS NON-EMPTY, NOT AS RISING, and the
    // difference is the whole point. A machine that cannot craft stops drawing,
    // so its first hopper fills to /core's cap and then stops moving; "it went
    // on rising" would be false on a CORRECT build. The claim is that ingredient
    // A was there the whole time and nothing was made anyway, because ingredient
    // B was not.
    control.ironHeldWhileStarved = Math.min(c0.iron, c1.iron) > 0;
    control.ironDelta = c1.iron - c0.iron;
    log.push(`exhaustion control: ${JSON.stringify(control)}`);
  }

  // ==========================================================================
  // THE ACCEPTANCE
  // ==========================================================================
  const finalA = linkA();
  const finalB = linkB();
  const port = (l) => (l === null ? null : { from: l.from, fromPort: l.fromPort,
    toPort: l.toPort, gapM: l.gapM, riseM: l.riseM, facing: l.facing });
  const advancedTicks = after.tick - before.tick;

  // 1. DW-20: the scene really formed and the sim really advanced.
  const valid = check('valid: the scene formed and the sim advanced',
    fac().buildings >= 10 && advancedTicks > 1200
      && after.mined - before.mined > 0 && fac().portsLoaded === true,
    JSON.stringify({ buildings: fac().buildings, advancedTicks,
      mined: +(after.mined - before.mined).toFixed(1),
      portsLoaded: fac().portsLoaded }));

  // 2. THE MENU CAME FROM /core, NOT FROM A CLIENT TABLE.
  //
  // Field for field against `of.game().recipes`, which is `of_gp_recipe_info`
  // with no FS-56 code anywhere in the path. The two ITEM ID checks under it are
  // a second, independent binding and they are the ones that could not be faked
  // by a client string table agreeing with itself: `smelter.outputItem` is what
  // /core's own `smeltOutputFor` said this smelter makes, and
  // `rockDrill.outputItem` is the resource /core's own patch carries, so they tie
  // the assembler's bill to the world through code that has never heard of it.
  const smelterRow = rowOf(smelter.id);
  const rockRow = rowOf(rockDrill.id);
  const billMatchesCoreHandRecipe = check(
    'billMatchesCoreHandRecipe: the machine was built from /core\'s own row',
    Array.isArray(bill) && bill.length === 6
      && bill[0] === coreBill[0][0] && bill[1] === coreBill[0][1]
      && bill[2] === coreBill[1][0] && bill[3] === coreBill[1][1]
      && bill[4] === SMELTER_ITEM
      // The ONE number FactoryRecipes authors, asserted as its own formula
      // against counts read from /core rather than as the literal 180.
      && bill[5] === 60 + 12 * (coreBill[0][1] + coreBill[1][1]),
    JSON.stringify({ machine: bill, core: coreBill }));
  const ingredientsAreTheWorldsOwnItems = check(
    'ingredientsAreTheWorldsOwnItems: ingredient A is what the smelter makes '
    + 'and ingredient B is what the rock drill mines',
    Array.isArray(bill) && bill[0] === smelterRow.outputItem
      && bill[2] === rockRow.outputItem,
    JSON.stringify({ bill, ingot: smelterRow.outputItem,
      stone: rockRow.outputItem }));

  // 3. THE UNSET STATE (each half asserted separately above).
  const unsetMakesNothing = unsetSaysNoRecipe && unsetHasNoEntity
    && unsetMadeNothing;

  // 5. BOTH HOPPERS FILLED. The assertion a one-ingredient machine cannot have.
  const bothHoppersFilled = check(
    'bothHoppersFilled: input AND input2 were both non-empty in the window',
    peakIn > 0 && peakIn2 > 0, JSON.stringify({ peakIn, peakIn2 }));

  // 6. THE HEADLINE: /core's own lifetime production tally for item 60.
  const buildableManufactured = check(
    'buildableManufactured: /core made at least one item 60',
    madeInWindow > 0 && asmRun.outputItem === SMELTER_ITEM,
    JSON.stringify({ madeInWindow, outputItem: asmRun.outputItem }));

  // 7a. FS-45 / FS-59: THE GHOST NAMED THE INLET BEFORE THE BUTTON WENT DOWN.
  const ghostPreviewedTheInlet = check(
    'ghostPreviewedTheInlet: the assembler ghost named socket_item_in_a and its '
    + 'gap before the placement was made',
    assemblerGhostPorts.includes('socket_item_in_a'),
    JSON.stringify(assemblerGhostPorts));

  // 7. THE PORTS THAT MATED, MEASURED RATHER THAN ASSUMED.
  const portsMated = check(
    'portsMated: one belt outlet mates socket_item_in_a and another mates '
    + 'socket_item_in_b',
    finalA !== null && finalB !== null
      && finalA.fromPort === 'socket_belt_out'
      && finalB.fromPort === 'socket_belt_out'
      && finalA.gapM <= 0.65 && finalB.gapM <= 0.65
      && finalA.facing <= -0.85 && finalB.facing <= -0.85,
    JSON.stringify({ a: port(finalA), b: port(finalB) }));

  // 8. THE BELTED DELIVERY, WHICH IS THE DEFECT. Expected RED on this build.
  const stoneArrivesByBelt = check(
    'stoneArrivesByBelt: a saturated belt mated to socket_item_in_b actually '
    + 'delivers stone into the second hopper',
    starved.stonePeak > 0, JSON.stringify(starved));
  // 9. THE NEGATIVE CONTROL, both halves, and neither is a threshold.
  const starvedMakesNothing = check(
    'starvedMakesNothing: with the second hopper at zero and the first full of '
    + 'iron, nothing at all is manufactured',
    starved.made === 0 && starved.minIron > 0 && starved.coreTicks > 3000,
    JSON.stringify(starved));
  const exhaustionStops = check(
    'exhaustionStops: when the hand-loaded stone runs out, production stops '
    + 'again while the iron hopper is still not empty',
    control.ran === true && control.drained === true
      && control.madeWhileStarved === 0
      && control.ironHeldWhileStarved === true
      && control.starvedCoreTicks > 600,
    JSON.stringify(control));

  return {
    valid,
    // WHICH SCENE WAS ACTUALLY REACHED, in two separate answers rather than one,
    // because on this build they differ and a single boolean would have to lie
    // about one of them. The GEOMETRY is fully belted: two drills, a smelter,
    // eighty-odd belt tiles and both of the assembler's inlets mated by a run's
    // own `socket_belt_out`. The DELIVERY is not: the stone line saturates
    // against a mated port and never hands a unit over, so the headline window
    // is measured with the stone put in by hand and says so.
    bothIngredientsBeltedGeometry: beltMatedBothInlets,
    bothIngredientsBeltedDelivery: starved.stonePeak > 0,
    billMatchesCoreHandRecipe,
    ingredientsAreTheWorldsOwnItems,
    unsetMakesNothing,
    recipeSetByClick,
    ghostPreviewedTheInlet,
    portsMated,
    stoneArrivesByBelt,
    starvedMakesNothing,
    bothHoppersFilled,
    buildableManufactured,
    exhaustionStops,
    fails,

    measured: {
      inletA: port(finalA),
      inletB: port(finalB),
      unset: { status: s0.status, build: asmUnset.build, recipe: asmUnset.recipe,
        producedOfOutput: asmUnset.producedOfOutput },
      afterClick: { status: s1.status, build: asmSet.build,
        recipe: asmSet.recipe },
      bill, coreBill,
      hoppers: { panelInput: endHopA, panelInput2: endHopB,
        peakInput: peakIn, peakInput2: peakIn2,
        rowInput: asmRun.input, rowInput2: asmRun.input2 },
      producedOfOutput: asmRun.producedOfOutput,
      madeInWindow,
      outputBuffer: asmRun.output,
      workingSamples: `${workingSamples}/${SAMPLES}`,
      windowCoreTicks: after.coreTicks - before.coreTicks,
      windowTicks: advancedTicks,
      minedInWindow: +(after.mined - before.mined).toFixed(2),
      assemblerCell: asmRun.cell,
      assemblerPos: asmRun.pos.map((v) => +v.toFixed(2)),
      assemblerFwd: asmRun.fwd.map((v) => +v.toFixed(4)),
      belts: fac().list.filter((b) => b.kind === 'belt').length,
      draggedTiles, closedBySnapping: closed, tipShortM,
      stoneRunTiles: stoneRun?.tiles ?? -1,
      stoneRunItems: stoneRun?.items ?? -1,
      handLoadPresses: loads, stoneInPack,
      patchesApartM: +apartM.toFixed(1),
      // GP-761 diagnosis numbers, see the two GP-761 log lines above for prose.
      dragTicks, dragWallMs, dragCoveredM: +coveredM.toFixed(2),
      dragRouteM: +routeM.toFixed(2), dragCalls: dragHaul.length,
      dragHaul, pressLog,
    },
    starved,
    control,

    // THINGS THAT LOOK LIKE DEFECTS IN THE CODE UNDER TEST. Each is a number
    // this run actually measured. Only the FIRST is an assertion, because it is
    // the claim FS-56 exists to make; the rest are reported and not asserted,
    // since a probe that asserted them would be pinning the bug in place.
    //
    //   stoneNeverArrivesOnTheSecondBelt   ASSERTED as `stoneArrivesByBelt`
    //     `Automation::inferItem` binds an inserter's item type at CONNECT time,
    //     and for a belt feeding a machine it reads `lineHeadItem(from)` with a
    //     documented fallback to the SLOT-1 ingredient for an empty belt. Every
    //     commit calls `FactorySim::recreate`, which throws away everything
    //     riding every belt, so every belt is empty when it is connected, so
    //     EVERY belt-to-assembler inserter in this client is bound to ingredient
    //     A. `inserterSystem`'s pickup gate is `sl.headItem() == insItem_[i]`,
    //     so the stone line's inserter waits for iron for ever. Measured here:
    //     the line saturated at four items a tile against a port mated at
    //     0.50 m, facing -1, and delivered nothing across a hundred seconds.
    //     An assembler's SECOND ingredient therefore cannot be belted at all on
    //     this build, which is the one thing a two-input machine is for.
    //
    //   rowInputIsNullForAnAssembler                       FIXED, kept as a guard
    //     `FactoryReport.row` gates `input` on `Factory.inputItemOf(p) > 0` and
    //     `inputItemOf` used to answer 0 for anything that was not a smelter, so
    //     the report published an assembler's SECOND hopper and never its first.
    //     Found by this probe and fixed in `Factory.inputItemOf`, which now
    //     answers the assembler's own recipe exactly as `outputItemOf` does.
    //     The field stays because a false here is the only thing that would
    //     catch the same gate being written again.
    //   ghostNeverPreviewsAnAssemblerPort                 FIXED, kept as a guard
    //     `FactoryGhost`'s preview filter was a hard 1.6 * 2 + PORT_MATE_M =
    //     3.85 m, from "no socket sits more than 1.6 m from its own origin".
    //     FS-57's 8 m assembler puts its inlets 4.000 m out and stands 5.01 m
    //     from the belt that feeds it, so the filter dropped it and FS-45's "the
    //     verdict arrives before the button" silently did not hold for this
    //     machine. Found by this probe, fixed as FS-59 (`previewNearM` derives
    //     the bound per pair from FOOTPRINT), and now asserted as
    //     `ghostPreviewedTheInlet` rather than only reported.
    //   beltTilesInsideTheHousing                         FIXED, kept as a guard
    //     `MachinePlacement.machineClash` used to return null for any part with
    //     FOOTPRINT under 2 and skip any placed part with FOOTPRINT under 2, so
    //     a belt tile was never tested against a housing at all. Harmless while
    //     every machine was 2 m and occupied its own single cell key; an 8 m
    //     machine occupies one key and nine cells of ground, and an overshooting
    //     drag put FOUR belt tiles inside this assembler. Found by this probe and
    //     fixed as FS-65 (`clashApplies`, which allows exactly the mating cell at
    //     every size). The count is now zero for two independent reasons, so it
    //     is weak evidence on its own and is reported rather than asserted.
    defects: {
      // The port is mated, the line is carrying items right up to it, and not
      // one of them crossed. `runItems` is /core's own count for that line.
      stoneNeverArrivesOnTheSecondBelt: starved.stonePeak === 0
        && starved.runItems > 0 && finalB !== null,
      rowInputIsNullForAnAssembler: rowInputWasAlwaysNull
        && asmRun.input === null,
      ghostNeverPreviewsAnAssemblerPort: assemblerGhostPorts === '',
      beltTilesInsideTheHousing: fac().list.filter((b) => b.kind === 'belt'
        && gd(b.pos, asmRun.pos) < 4.0).length,
    },

    // Data rather than assertions.
    screenRecipes: menuRows,
    screenRefused: refusedRows,
    assemblerGhostPorts,
    ticks: of.world().tick,
    runs: fac().runs.map((r) => ({ tiles: r.tiles, items: r.items,
      tail: r.tail, head: r.head })),
    links: fac().links,
    refusals: fac().refusals,
    plan: fac().list.map((b) => `${b.kind}#${b.id}@${b.cell}`),
    log,
  };
})()
