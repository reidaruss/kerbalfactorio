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
// THE NEGATIVE CONTROL IS ONE KEY PRESS, machineports.js's argument verbatim:
// nothing is placed, nothing is removed, no run is re-chained, and the only thing
// that changes between a working line and a starved one is which way one tile
// faces. And the assertion is deliberately NOT "less was made", which would be a
// threshold tuned until it went green. It is that once the second hopper reaches
// ZERO, production stops DEAD while the FIRST hopper goes on filling off its own
// belt, and that turning the tile back brings production back. A build that had
// simply stopped fails the second half; a build where the belt was never really
// what fed it fails the first.
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
  // THE HOPPERS ARE READ OFF THE PANEL AND NOT OFF `list[]`, AND THAT IS A
  // DEFECT IN THE CODE UNDER TEST RATHER THAN A PREFERENCE.
  //
  // `FactoryReport.row` gates the `input` field on `f.inputItemOf(p) > 0`, and
  // `Factory.inputItemOf` answers `p.kind !== 'smelter' && p.kind !== 'esmelter'
  // ? 0 : ...`, so an ASSEMBLER's `input` is published as `null` for ever while
  // its `input2` (gated on `p.kind === 'assembler'`) reports fine. That is the
  // exact asymmetry FS-56's own comment in that file says `input2` was added to
  // remove: the report can say how much of ingredient B a machine holds and
  // cannot say how much of ingredient A. Measured on the first green run of this
  // probe: `input: null, input2: 50` on a machine that had just manufactured 11
  // smelters, which it could not have done on stone alone.
  //
  // `screen.input.count` is `f.line.inputBuffer(b.build)`, which is
  // `of_net_input_buffer`, so the number below is /core's own and not a
  // substitute for it. Both readings are reported, so the null is visible.
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

  /** The outward socket of whatever is currently the end of the chain. */
  const tailOut = (b) => add(b.pos, b.fwd, b.kind === 'belt' ? 0.5 : 1.0);
  let tip = ironDrill;
  const chainStep = async (kind, socket) => {
    const at = tailOut(tip);
    const made = await snapPlace(kind, at, socket, add(at, F, -3.2));
    if (made === null) return false;
    tip = made;
    return true;
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
    // FS-45 SAYS THE VERDICT ARRIVES BEFORE THE BUTTON, AND FOR THIS MACHINE IT
    // DOES NOT. Captured, reported and deliberately NOT asserted, because it is a
    // finding about the code under test rather than about this scene:
    // `FactoryGhost.PREVIEW_NEAR_M` is `1.6 * 2 + PORT_MATE_M` = 3.85 m, derived
    // from "no socket sits more than 1.6 m from its own origin", which FS-57's
    // 8 m assembler makes false (its inlets are 4.000 m out). A belt and an
    // assembler stand 5.01 m apart, so the preview's coarse filter drops the
    // assembler and the ghost says NOTHING where a smelter says
    // "socket_belt_out -> #n smelter socket_item_in (0.50 m)". It is the same
    // class of scale assumption `FactorySnap.nearestSocket` was already fixed for
    // (DW-33), one file away, and the fix is the same: derive it from FOOTPRINT.
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
  for (const wp of way) {
    for (let k = 0; k < 16 && gd(eye(), wp) > 5.0; ++k) {
      await sleep(0.35);
      aimAtPoint(wp);
    }
  }
  of.input.tape([{ hold: 6, keys: [] }]);
  await sleep(0.4);
  const draggedTiles = of.build().longestDrag;
  log.push(`the drag laid ${draggedTiles} tiles in one hold; `
    + `${fac().list.filter((b) => b.kind === 'belt').length} belts standing`);

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
  for (let k = 0; k < 14; ++k) {
    const t = lastBelt();
    if (shortOfPortB(t.pos) < 0.5) break;
    const made = await snapPlace('belt', tailOut(t), 'socket_belt_out',
      add(t.pos, t.fwd, -3.4));
    if (made === null) break;
    closed++;
  }
  const tipShortM = +shortOfPortB(lastBelt().pos).toFixed(2);
  log.push(`closed the last ${closed} cells by snapping; the run tip is `
    + `${tipShortM} m short of the port-B cell (negative means past it)`);

  // ==========================================================================
  // 7. THE TWO LINKS
  // ==========================================================================
  await sleep(1.0);
  const linksIn = () => fac().links.filter((l) => l.to === ASM);
  const linkA = () => linksIn().find((l) => l.toPort === 'socket_item_in_a') ?? null;
  const linkB = () => linksIn().find((l) => l.toPort === 'socket_item_in_b') ?? null;
  log.push(`links into the assembler: ${JSON.stringify(linksIn())}`);
  log.push(`refusals: ${JSON.stringify(fac().refusals)}`);

  // THE FALLBACK, AND IT IS LABELLED RATHER THAN SILENT. If the haul did not mate
  // port B, the stone is hand-loaded through the panel's own Load button, which
  // is `of_net_feed_machine2` (ABI 18). That is a real path and it is NOT the
  // headline; `bothIngredientsBelted` says which scene was actually reached, and
  // a run that fell back must be read as a weaker result.
  const belted = linkB() !== null;
  if (!belted) {
    log.push('PORT B DID NOT MATE: falling back to hand-loading the stone');
    for (const n of of.nodes()) {
      if (n.kind !== 1) continue;
      for (let k = 0; k < 40; ++k) of.harvest(n.index);
    }
    await walkTo(rowOf(ASM).pos, 3.0);
    await hold('hand');
    await aimBuild(ASM);
    of.input.act(['use'], 4);
    await sleep(0.5);
    for (let k = 0; k < 12; ++k) {
      const loadBtn = [...document.querySelectorAll('#of-furnace [data-load]')]
        .find((e) => (e.textContent ?? '').includes('Stone'));
      if (!click(loadBtn)) break;
      await sleep(0.25);
    }
    of.escape();
    await sleep(0.4);
  }

  // ==========================================================================
  // 8. THE HEADLINE WINDOW. NOBODY TOUCHES ANYTHING.
  // ==========================================================================
  // POLLED IN SMALL STEPS rather than slept through, autoline.js's lesson: a
  // hopper that is emptied the instant it is filled is at zero in every sample a
  // coarse window takes, and "both hoppers filled" would then read false on a
  // line that is visibly working. The peaks are what the claim is about.
  const panelOpen = await openPanel();
  check('the machine screen re-opened for the window', panelOpen,
    JSON.stringify(of.game().screen?.open));
  of.input.tape([{ hold: 2, keys: [] }]);

  // PRIME: WAIT FOR THE FIRST STONE TO CROSS THE HAUL, and time it.
  //
  // This is not padding, it is the length of the belt. `factory_sim.h` runs a
  // basic belt at `speedUnitsPerTick = 8` of `kUnitsPerTile = 256`, which is 32
  // ticks a tile, and every one of the snapped presses that closed the last cells
  // re-committed the plan and threw away whatever was riding the line
  // (`itemsLostToRebuild`), so at this point the stone has the WHOLE run to cross
  // from a standing start. The first run of this probe measured 96 items on the
  // line, 0 in the hopper and 0 made after 70 seconds and read exactly like a
  // machine that refuses stone; it was a belt that had not finished delivering
  // any. A window that starts before the first unit arrives cannot tell those two
  // apart, which is DW-20 in its most ordinary form.
  const primeT0 = of.world().tick;
  let primed = false;
  for (let k = 0; k < 400 && !primed; ++k) {
    await sleep(0.5);
    primed = hopB() > 0;
  }
  const primeTicks = of.world().tick - primeT0;
  const stoneRun = fac().runs.find((r) => r.tiles > 10) ?? null;
  log.push(`primed: first stone reached the hopper after ${primeTicks} ticks `
    + `(${(primeTicks / 60).toFixed(1)} s) across ${stoneRun?.tiles ?? -1} tiles, `
    + `${stoneRun?.items ?? -1} on the line`);
  check('the stone crossed the haul and reached the machine', primed,
    JSON.stringify({ primeTicks, stoneRun }));
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
  // 9. THE NEGATIVE CONTROL: turn the stone belt's head away and starve it
  // ==========================================================================
  const control = { ran: false };
  const feedB = linkB();
  const stoneHead = belted && feedB !== null ? rowOf(feedB.from) : null;
  if (stoneHead !== null) {
    await walkTo(stoneHead.pos, 3.0);
    await hold('hand');
    let turns = 0;
    for (let k = 0; k < 4; ++k) {
      if (!await aimBuild(stoneHead.id)) break;
      of.input.act(['rotate'], 3);
      await sleep(0.3);
      turns++;
      if (linkB() === null) break;
    }
    control.turns = turns;
    control.linkGone = linkB() === null;
    control.refusalNamesPortB = fac().refusals.some((r) => r.to === ASM
      && r.nearestPort === 'socket_item_in_b');
    // DRAIN FIRST, then take a window in which the hopper is known to have been
    // empty throughout. A machine that loses its feed keeps working what it
    // already holds, which is what a real factory does and what machineports.js
    // paid to learn; asserting on production before the buffer is gone would be
    // asserting on a guess about a symptom.
    control.panel = await openPanel();
    let drained = false;
    for (let k = 0; k < 160 && !drained; ++k) {
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
    // difference is the whole point of the control. A machine that cannot craft
    // stops drawing, so its first hopper fills to whatever /core's cap is and
    // then stops moving; "it went on rising" would therefore be false on a
    // correct build. What the claim actually is, and what fails against a
    // machine that is merely broken, is that ingredient A was THERE THE WHOLE
    // TIME and nothing was made anyway, because ingredient B was not.
    control.ironHeldWhileStarved = Math.min(c0.iron, c1.iron) > 0;
    control.ironDelta = c1.iron - c0.iron;
    log.push(`control: ${JSON.stringify(control)}`);
    // AND IT IS RECOVERABLE. A refusal nobody can undo would be a worse deadlock
    // than the silent wrong connection the port model replaced, so three more
    // presses bring the tile back round and production has to resume.
    //
    // THE WALK BACK IS NOT OPTIONAL. `openPanel` above walks to the ASSEMBLER,
    // which is five cells from the tile that has to be turned, and
    // `GameplayAim` resolves the crosshair at 3.5 m and not a centimetre
    // further. Without this the recovery reported `relinked: false` from the
    // wrong end of the machine, which reads exactly like a refusal that cannot
    // be undone and is nothing of the kind.
    await hold('hand');
    await walkTo(rowOf(stoneHead.id).pos, 3.0);
    for (let k = 0; k < 4 && linkB() === null; ++k) {
      if (!await aimBuild(stoneHead.id)) break;
      of.input.act(['rotate'], 3);
      await sleep(0.3);
    }
    control.relinked = linkB() !== null;
    const r0 = rowOf(ASM).producedOfOutput;
    await sleep(25);
    control.madeAfterRecovery = rowOf(ASM).producedOfOutput - r0;
    log.push(`recovery: relinked ${control.relinked}, `
      + `made ${control.madeAfterRecovery} more`);
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

  // 8. THE NEGATIVE CONTROL, and its recovery.
  const starvedStops = check(
    'starvedStops: with the stone port turned away and its hopper at zero, '
    + 'nothing more was made even though the iron hopper was never empty',
    control.ran === true && control.linkGone === true && control.drained === true
      && control.madeWhileStarved === 0
      && control.ironHeldWhileStarved === true
      && control.starvedCoreTicks > 600,
    JSON.stringify(control));
  const recovers = check(
    'recovers: turning the tile back restores the link and the production',
    control.relinked === true && control.madeAfterRecovery > 0,
    JSON.stringify({ relinked: control.relinked,
      made: control.madeAfterRecovery }));

  return {
    valid,
    // WHICH SCENE WAS ACTUALLY REACHED. The belted one is the headline and the
    // hand-loaded one is a fallback; it is never silently substituted.
    bothIngredientsBelted: belted,
    billMatchesCoreHandRecipe,
    ingredientsAreTheWorldsOwnItems,
    unsetMakesNothing,
    recipeSetByClick,
    bothHoppersFilled,
    buildableManufactured,
    portsMated,
    starvedStops,
    recovers,
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
      draggedTiles, closedBySnapping: closed, tipShortM, primeTicks,
      stoneRunTiles: stoneRun?.tiles ?? -1,
      patchesApartM: +apartM.toFixed(1),
    },
    control,

    // THREE THINGS THAT LOOK LIKE DEFECTS IN THE CODE UNDER TEST, reported and
    // NOT asserted, because a probe that asserted them would be pinning the bug
    // in place. Each is a number this run actually measured.
    //
    //   rowInputIsNullForAnAssembler
    //     `FactoryReport.row` gates `input` on `Factory.inputItemOf(p) > 0` and
    //     `inputItemOf` answers 0 for anything that is not a smelter, so the
    //     report can publish an assembler's SECOND hopper and never its first.
    //     Fix: teach `inputItemOf` the assembler's own recipe, exactly as
    //     `outputItemOf` already is.
    //   ghostNeverPreviewsAnAssemblerPort
    //     `FactoryGhost.PREVIEW_NEAR_M` is 1.6 * 2 + PORT_MATE_M = 3.85 m, from
    //     "no socket sits more than 1.6 m from its own origin". FS-57's 8 m
    //     assembler puts its inlets 4.000 m out and stands 5.01 m from the belt
    //     that feeds it, so the filter drops it and FS-45's "the verdict arrives
    //     before the button" silently does not hold for this machine. Same fix
    //     `FactorySnap.nearestSocket` already took: derive it from FOOTPRINT.
    //     `FactoryWiring.wire`'s machine-to-machine loop carries the identical
    //     3.85 m constant, so a smelter belted straight onto an assembler's
    //     inlet with no belt between them would be refused for the same reason.
    //   beltTilesInsideTheHousing
    //     `MachinePlacement.machineClash` returns null for any part with
    //     FOOTPRINT under 2 and skips any placed part with FOOTPRINT under 2, so
    //     a belt tile is never tested against a housing at all. Harmless while
    //     every machine was 2 m and occupied its own single cell key; an 8 m
    //     machine occupies one key and nine cells of ground. THE COUNT BELOW IS
    //     ZERO ON A GREEN RUN and that is not evidence against the defect: the
    //     probe now stops its run at the port cell on purpose. It read FOUR on
    //     the run that did not, with four belt tiles standing in the housing.
    defects: {
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
