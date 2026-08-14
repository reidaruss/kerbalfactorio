// The gameplay half of window.__of, split out when the demolition and audio
// surfaces landed and Debug.ts crossed the 400-line cap.
//
// EVERY ENTRY HERE GOES THROUGH THE PLAYER'S OWN PATH. `build(n)` is the number
// key, `demolish` is the X key's handler, `craft` is the panel button. A probe
// that reached past these into the sim would be verifying a path no player can
// take, which is the quiet way an acceptance test stops meaning anything.

import { PLANT_KINDS, STARTER, starterPlanFor } from '../game/StarterContent.js';
import { demolishBuild, demolishMachine, demolishStructure } from '../game/Demolition.js';
import { renderVoices } from '../audio/Sfx.js';
import { renderBeds } from '../audio/Beds.js';
import { clearSlot } from '../game/SaveGame.js';
import { urlForMode } from '../game/GameMode.js';
import { clearEdits } from '../game/VoxelSave.js';
import { showGoals } from '../game/Objectives.js';
import { enemyDebug } from '../game/EnemyDebug.js';
import { isPart } from '../game/Hotbar.js';
import { snapToGround } from '../game/Grid.js';
import { STRUCTURE_STEP_UP_M, VOXEL_STEP_UP_M } from '../player/VoxelCollision.js';
import { StandTrace } from '../player/StandTrace.js';
import { bodyIsAirless } from '../game/StarterContent.js';
import {
  findStation, lastStationInstall, lastStationSolid, stationSockets,
  STATION_ALT_M, STATION_TAG, stationAxes, stationProxies,
} from '../game/SpaceStation.js';
import { seatOnStationDeck } from './StationMount.js';
import { BOARD_MARGIN_M } from '../world/CarrierBoarding.js';
import { registry, stateOf } from '../sim/VesselRegistry.js';
import { volumes } from '../game/GravityVolumes.js';
import {
  airlockPlaneM, lastStationGravity, setStationGravityPowered,
  stationGravityPowered,
} from '../game/StationGravity.js';
import { StackedGravity, UniformGravity } from '../player/GravityPort.js';
import { ZEROG } from '../player/ZeroG.js';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';

/** The instrument behind `gravityScale`. One per page, held here so repeated
 *  calls tune the same field rather than stacking a new one every time. */
const uniform = new UniformGravity();

export function gameplayApi(s: Services, loop: Loop) {
  return {
    game: () => s.gameplay?.report() ?? null,
    nodes: () => s.gameplay?.nodes() ?? [],
    /** GP-530. THE TECH TREE, full rows (`Research.list()`), not the summary
     *  counts `game().progress.research` already carries: a probe asking
     *  "is FlightAutopilot researchable yet" needs the one row's own
     *  `canResearch`/`block`/`milestone`, which no existing debug surface
     *  published before the milestone bus needed proving. */
    research: () => s.gameplay?.progress.research.list() ?? [],
    panel(open: boolean) { s.gameplay?.setPanel(open); return s.gameplay?.report() ?? null; },
    craft: (index: number) => s.gameplay?.game.craft(index) ?? false,
    lamp(on?: boolean) {
      if (on !== undefined && on !== s.headlamp.enabled) s.headlamp.toggle();
      return s.headlamp.stats();
    },

    /**
     * The old build-menu index, kept as a name for the seven BUILDABLE parts.
     *
     * It is now a view onto the hotbar, because the hotbar is what a number key
     * actually moves (GP-26): 0 puts the hands back and 1 to 7 are drill, belt,
     * smelter, foundation, floor, wall, door, which live in hotbar slots 3 to 9.
     * Probes written against the old menu keep meaning what they meant.
     */
    build(index?: number) {
      const h = s.gameplay?.hotbar;
      if (index !== undefined && h !== undefined) {
        h.select(index <= 0 ? 0 : Math.min(index + 1, 8));
        s.gameplay?.build.arm(h.partInHand);
      }
      return s.gameplay?.build.report() ?? null;
    },

    /**
     * The hotbar itself. `n` is 1-based, exactly as the number keys are, and it
     * goes through the SAME `select` a key press does.
     */
    hotbar(n?: number) {
      const g = s.gameplay;
      if (g === null) return null;
      if (n !== undefined) { g.hotbar.select(n - 1); g.build.arm(g.hotbar.partInHand); }
      return g.hotbar.report();
    },

    /** Put something in a hotbar slot, 1-based. The "put things in it" half. */
    assignSlot(n: number, what: string) {
      const g = s.gameplay;
      if (g === null) return null;
      const content = what === 'hand' ? { kind: 'hand' as const }
        : what === 'furnace' ? { kind: 'furnace' as const }
          : what === 'empty' || !isPart(what) ? { kind: 'empty' as const }
            : { kind: 'part' as const, part: what };
      g.hotbar.assign(n - 1, content);
      g.build.arm(g.hotbar.partInHand);
      return g.hotbar.report();
    },

    /**
     * Every modal that EXISTS, derived from the registry rather than listed, so
     * a probe asserting Escape against all of them cannot miss a new menu.
     */
    modals: () => s.gameplay?.modals.report() ?? null,

    /** Escape, through the one handler a key press reaches. */
    escape() {
      const g = s.gameplay;
      if (g === null) return null;
      g.input.playTape([{ hold: 2, actions: ['cancel'] }, { hold: 2, keys: [] }]);
      return g.modals.report();
    },

    /** The base: every part, every site, the module and the costs. */
    structures: () => s.gameplay?.structures ?? null,
    /**
     * GP-288. THE STRUCTURE VIEW, which is a different object from the model
     * above and is the one that owns the placement ghost. Reid reported the
     * preview filling the screen, and `structures()` could not answer that
     * because the model has no idea what is drawn.
     */
    structView: () => s.gameplay?.structView.stats() ?? null,
    /** GP-288. The launch pad's own view, which owns a SECOND ghost. */
    padView: () => s.gameplay?.padView.stats() ?? null,
    /**
     * GP-289. WHICH BRANCH THE AIM TOOK, so a probe can tell a real ground hit
     * from the mid-air fallback from the overhead cone. Without it "the preview
     * encloses the player" has three different causes and one number.
     */
    buildAim: () => {
      const t = s.gameplay?.build.structTarget ?? null;
      if (t === null) return null;
      return { aimed: t.aimed, overhead: t.overhead, ok: t.ok,
               reason: t.reason, freePlaced: t.freePlaced };
    },

    /**
     * GP-57. The launch pads, LIVE, so a probe can measure against the pad's
     * own `socket_vessel` rather than against a number retyped in the probe.
     * `vesselAnchor` is the same call the roll-out makes, which is the point:
     * a probe that recomputed the anchor would be checking its own arithmetic.
     */
    pads: () => s.gameplay?.pads ?? null,

    /**
     * D-019. The research stations, as their own REPORT rather than as the live
     * object the two above hand over.
     *
     * A report and not the object, because everything a probe needs to assert
     * about a station is a fact rather than a measurement: how many stand, what
     * one costs, whether /core says the pack can pay (with the mode taken back
     * out, which is DW-31's in-page negative control), and which mesh is
     * standing in for the art that has not shipped. There is no `module` to
     * measure the way the pad has one, because the station borrows a mesh and
     * measuring a placeholder would pin numbers that are about to change.
     */
    stations: () => s.gameplay?.stations.report() ?? null,

    /** GP-533. Same shape as `stations` above, and for the same reasons. */
    antennas: () => s.gameplay?.antennas.report() ?? null,

    /**
     * DW-31. READ-ONLY on purpose: there is no `sandbox(true)`.
     *
     * A setter would be the single most useful thing here and the single most
     * dangerous: a probe, or a curious player at a console, could flip a
     * survival world halfway through and its autosave would then be written to
     * the sandbox key with half a survival session in it. Switching goes
     * through the reload the menu uses, so a mode is always decided at boot.
     * `switchUrl` is what that button would navigate to, for a probe to assert.
     */
    sandbox() {
      const g = s.gameplay;
      if (g === null) return null;
      const to = g.mode.sandbox ? 'survival' : 'sandbox';
      return {
        ...(g.mode.report() as object),
        switchUrl: urlForMode(window.location.href, to),
        // The button a PLAYER presses, so a probe can click it rather than
        // calling a function only a probe can reach (standing rule 3).
        menuButton: g.panel.modeSwitch?.textContent ?? null,
      };
    },

    /**
     * Snap a body-frame point exactly as a MACHINE placement does: the metric
     * site grid, then back onto the ground (GP-27). This is the number a belt
     * run is laid on, so measuring it is measuring the alignment itself.
     *
     * READ THIS BEFORE MEASURING WITH IT. Until a site has been ADOPTED, every
     * call founds a prospective one on the lattice cell it was handed, so two
     * calls a metre apart land in two different frames and it reproduces the
     * voxel lattice's own uneven steps. Place something first, or use
     * `latticeCell` if the lattice is what you actually wanted.
     */
    snapCell(x: number, y: number, z: number) {
      const f = s.gameplay?.factory;
      if (f === undefined) return null;
      const p = f.snap(x, y, z);
      return [p.pos.x, p.pos.y, p.pos.z];
    },

    /**
     * Snap to /core's own 1 m VOXEL lattice, which is what machines used to use.
     *
     * Kept precisely so the claim behind the change stays measurable: one unit
     * step of a cell key covers 0.59 to 1.02 m of ground depending on the axis,
     * because a body-frame cube grid is cut obliquely by the ground sphere. The
     * acceptance measures both and reports the difference.
     */
    latticeCell(x: number, y: number, z: number) {
      const f = s.gameplay?.factory;
      if (f === undefined) return null;
      const p = snapToGround(s.core, f.bodyHandle,
        s.voxels?.handle ?? 0, x, y, z);
      return [p.pos.x, p.pos.y, p.pos.z];
    },

    /**
     * Open or shut a placed door by part id, through the SAME toggle the E key
     * reaches. A probe that set `wantOpen` directly would be proving a path no
     * player can take.
     */
    door(id: number, open?: boolean) {
      const st = s.gameplay?.structures;
      const p = st?.parts.find((q) => q.id === id);
      if (st === undefined || p === undefined) return null;
      if (open === undefined || open !== p.wantOpen) st.toggle(p);
      return { id, kind: p.kind, wantOpen: p.wantOpen, swing: p.swing,
        shut: p.solid.shut };
    },

    /**
     * Is this body-frame point inside a structural collider? This is the exact
     * predicate the walker uses, so a probe asserting that a doorway is open is
     * asserting about the collision the player will actually meet, not about a
     * parallel test written in the probe.
     */
    solidBuild(x: number, y: number, z: number) {
      return s.gameplay?.structures.bodies.blocks(x, y, z) ?? false;
    },

    /**
     * The per-TICK standing trace (player/StandTrace.ts). `stand(true)` arms and
     * clears it, `stand()` dumps it oldest-first, `stand(false)` disarms.
     *
     * It lives on the gameplay surface because the question it answers is a
     * gameplay one: WHICH of the terrain and the base is holding the player up
     * this tick. `world().player` reports the answer once per FRAME, and a frame
     * carries one to three fixed ticks, so anything that alternates is aliased
     * away before a probe can see it.
     */
    /** The structural step ladder, so a probe can assert the rung that gets a
     *  player onto their own foundation still clears the shipped deck rather
     *  than reciting 0.55 back at itself. */
    stepUpM: STRUCTURE_STEP_UP_M,

    /** The VOXEL step ladder, deliberately a second name for a second ladder
     *  (see VoxelCollision.ts). A probe bounding the lift a tunnel floor query
     *  is allowed to apply reads its first rung from here rather than reciting
     *  0.55, so retuning the walker retunes the assertion with it. */
    voxelStepUpM: VOXEL_STEP_UP_M,

    stand(on?: boolean) {
      const b = s.player?.body;
      if (b === undefined || b === null) return null;
      if (on === false) { b.trace = null; return { armed: false, samples: [] }; }
      if (on === true) {
        if (b.trace === null) b.trace = new StandTrace();
        b.trace.reset();
      }
      const t = b.trace;
      return { armed: t !== null, total: t?.total ?? 0, samples: t?.dump() ?? [] };
    },

    /**
     * PH-94. THE STATION, read from the RECORD rather than from the installed
     * solid, so a probe comparing across a reload is comparing the thing that
     * is actually on disk. `pos` is `stateOf`, one Kepler solve, derived on
     * demand and cached nowhere.
     *
     * `deckR` is the radius the interior's floor sits at, which is `|pos|`
     * because the station is nadir pointing and the deck top face is its own
     * local y = 0. A probe wanting the floor the walker will stand on should
     * bisect `solidBuild` instead, which is the walker's own predicate; this is
     * the ORBIT's answer and the two agreeing is a real assertion (PH-96).
     */
    station() {
      const rec = findStation();
      if (rec === null) return null;
      const st = stateOf(s.core, registry, rec, 0);
      const r = Math.hypot(st.pos[0], st.pos[1], st.pos[2]);
      const el = rec.where.kind === 'conic' ? rec.where.el : null;
      return {
        id: rec.id, name: rec.name, mode: rec.mode, tag: rec.status,
        expectTag: STATION_TAG,
        pos: st.pos, vel: st.vel, deckR: r,
        speedMps: Math.hypot(st.vel[0], st.vel[1], st.vel[2]),
        designParts: rec.design.parts.length,
        clockS: rec.clockS, stampedTick: rec.stampedTick,
        proxies: stationProxies().length,
        proxyNames: stationProxies().map((b) => b.name),
        /** Every proxy's own box, so a probe can aim at a named deck rather
         *  than at a coordinate it transcribed out of the Blender source.
         *  Standing rule 11: a probe that re-derived the layout would agree
         *  with itself whatever the asset did. */
        proxyBoxes: stationProxies().map((b) => ({
          name: b.name, min: b.min, max: b.max,
        })),
        airlockX: airlockPlaneM(stationProxies()),
        /** GP-284. EVERY SOCKET AS A FRAME, so a probe can assert the AXIS the
         *  asset ships rather than only the position. Physics needs `face` and
         *  `roll` to aim a docking capture, and until this pass the client read
         *  the rotation out of the glb and dropped it on the floor: two hulls
         *  meeting nose to nose and nose to tail have identical socket
         *  positions, so a point cannot express the difference. The names are
         *  the asset's own and nothing here renames them. */
        sockets: [...stationSockets()].map(([name, f]) => ({
          name, pos: f.pos, face: f.face, roll: f.roll,
        })),
        nominalAltM: STATION_ALT_M,
        el: el === null ? null : { ...el },
        axes: stationAxes(st.pos),
        install: lastStationInstall(),
        records: registry.count,
      };
    },

    /**
     * PH-90. Put the walker's feet at a BODY-FRAME point and report where they
     * ended up. The companion to `stand()`: that one asks WHICH authority held
     * the player up, this one puts the player somewhere there is no terrain
     * authority at all so the question can be asked off the heightfield.
     *
     * Deliberately NOT routed through `__of.teleport`, which is lat/lon/alt and
     * discards the altitude by a documented contract every walking probe in the
     * suite depends on (Config.ts line 51). See `Controller.standAt`.
     */
    standAt(x: number, y: number, z: number,
            opts?: { frame?: 'body' | 'auto' }) {
      const p = s.player;
      if (p === null || p === undefined) return null;
      // ===================================================================
      // CE-54. AND IT REFUSES INSIDE A CARRIER'S BOUND (RN-1412).
      // ===================================================================
      //
      // `Controller.standAt` zeroes the ABSOLUTE velocity, which off a carrier
      // is exactly right and ON one is the defect: Anchorage travels at
      // 1879.2552 m/s, so a walker put on the deck at rest in the BODY frame is
      // a walker the deck leaves behind at 31.32 m per tick. Measured, from the
      // spawn socket: the deck is 1,002 m away after half a second and 14,032 m
      // after 7.5, while `stationDraw` still reports `visible: true` and
      // `drawnParts: 2`. A black frame with a perfect report.
      //
      // THE REFUSAL IS THE ANSWER RATHER THAN A SILENT SEAT, and the case that
      // decides it is `zerog.js`: it measures speed as a FINITE DIFFERENCE OF
      // POSITION in the body frame, so a `standAt` that quietly boarded would
      // hand it 1879 m/s where it expects a walking pace and it would have no
      // way to tell. This verb cannot know which frame the caller meant, and
      // guessing wrong is undetectable in both directions, so it asks. That is
      // the same argument the header already makes about `grounded`: an
      // instrument must not answer its own question.
      //
      // The predicate and the margin are `BoardingRule`'s own, imported rather
      // than retyped, so the point this refuses is exactly the point the
      // per-tick rule would call aboard.
      //
      // OFF A CARRIER NOTHING CHANGES. `mountContaining` is one bounding-sphere
      // reject per mount and there is one mount, 400 km up, so the ground path
      // runs the instruction sequence it always ran.
      //
      // AND THE BODY FRAME IS STILL REACHABLE, BY ASKING FOR IT. `frame:
      // 'body'` is the pre-CE-54 behaviour, unchanged, and it is a legitimate
      // request rather than a loophole: `zerog.js` measures speed as a finite
      // difference of BODY-FRAME position, so for that instrument a rider
      // carried at 1879 m/s is the wrong answer and being left behind is the
      // right one. What the refusal is for is making the caller SAY which,
      // because this verb cannot tell and guessing wrong is invisible in both
      // directions.
      const on = opts?.frame === 'body' ? null
        : s.mounts?.mountContaining(x, y, z, BOARD_MARGIN_M) ?? null;
      if (on !== null) {
        const why = `standAt refuses: (${x}, ${y}, ${z}) is inside carrier `
          + `'${on.frame.id}', whose bound this point is `
          + `${(-on.depthAt(x, y, z)).toFixed(3)} m inside. standAt zeroes the `
          + 'ABSOLUTE velocity, so on a moving carrier it seats a walker the '
          + 'deck immediately leaves behind. Use __of.standAboard() for the '
          + "station's own live spawn socket, or __of.standAboard(lx, ly, lz) "
          + "for a point in the station's authored local frame, either of "
          + 'which boards the frame and matches its velocity. To ride a '
          + 'non-station carrier use __of.carrier(\'board\') then '
          + "__of.carrier('standLocal'). If the BODY frame is genuinely what "
          + 'you want (a body-frame instrument, or this defect as a control), '
          + "say so: __of.standAt(x, y, z, { frame: 'body' }).";
        // WARN AND NOT ERROR, deliberately: `tools/smoke/run.mjs` fails a run on
        // any `console.error`, and a probe that catches this refusal and asserts
        // on it is behaving correctly. The sentence still reaches the log for a
        // probe that only reads the transcript.
        console.warn(`[of] ${why}`);
        return { refused: true, why, carrier: on.frame.id,
          feet: null, r: null, grounded: null, onDeck: null };
      }
      p.standAt(x, y, z);
      const f = p.body.feet;
      return { refused: false, why: null, carrier: null,
        feet: [f.x, f.y, f.z], r: Math.hypot(f.x, f.y, f.z),
        grounded: p.body.grounded, onDeck: p.body.onDeck };
    },

    /**
     * CE-54. STAND ON THE STATION'S DECK, ABOARD ITS FRAME (RN-1412).
     *
     * The verb `standAt` refuses in favour of, and the one that makes the
     * harness honest about frames: it drives the SHIPPED `seatOnStationDeck`,
     * the same function the `visit:station` row presses, so a probe standing on
     * the deck measures the arrival that ships rather than a second spelling of
     * it.
     *
     *   `standAboard()`            the asset's own live spawn socket, scanned
     *                              for clearance exactly as the press does.
     *   `standAboard(lx, ly, lz)`  a point in the STATION'S AUTHORED LOCAL
     *                              frame: +X along the spine, +Y the radial
     *                              (up), +Z across. The frame `socket_hall` and
     *                              every other socket in the glb are written
     *                              in.
     *
     * LOCAL AND NOT BODY-FRAME COORDINATES, WHICH IS THE HALF OF RN-1412 THE
     * VELOCITY DOES NOT COVER. A body-frame point aimed at the station has to
     * come from somewhere, and every published source of one is a boot-time
     * record: `stationdraw.js` composed its target from `install.standPos` and
     * `install.pos`, which are 5,352 m from the live deck by the time the probe
     * reads them. A local point is resolved against the live pose here, so it
     * cannot go stale, and the probe never touches an install record again.
     *
     * NOT the carrier frame's local basis: that one is LVLH from the record's
     * own r x v and its offset from the authored attitude is a measured
     * constant (`StationMount.ts` header). `carrier('standLocal')` speaks the
     * frame's basis and this speaks the asset's; both are published because
     * they answer different questions.
     */
    standAboard(lx?: number, ly?: number, lz?: number) {
      const r = seatOnStationDeck(
        s.mounts, s.ride, s.player, loop.tickIndex, loop.fixedDt,
        s.gameplay?.structures.bodies ?? null,
        lx === undefined ? null : [lx, ly ?? 0, lz ?? 0],
      );
      if (r === null) {
        return { error: 'nothing to seat on: no walker, no ride, or the '
          + 'station solid is on no mount (?station=0, or a reboot that never '
          + 're-mounted)' };
      }
      const b = s.player?.body;
      const mount = s.mounts?.mountCarrying(lastStationSolid()) ?? null;
      return {
        ...r,
        /** Metres from the feet to the carrier bound's SURFACE, negative
         *  INSIDE it. The continuous form of the predicate `standAt` refuses
         *  on, so a probe can assert it stayed aboard rather than trusting a
         *  boolean taken once. */
        deckDepthM: mount === null ? null
          : mount.depthAt(r.feet[0], r.feet[1], r.feet[2]),
        /** FALSE on the tick it lands, exactly as the shipped press leaves it:
         *  whether the deck caught the walker is a fact one fixed tick later
         *  (`VisitSites.ts` makes the same point about its own receipt). */
        grounded: b?.grounded ?? null,
        onDeck: b?.onDeck ?? null,
      };
    },

    /**
     * PH-98. WHAT THE PLAYER WEIGHS, and why.
     *
     * With no argument it reports the feet. With a body-frame point it asks the
     * field about that point WITHOUT moving anybody, which is what lets a probe
     * map the edge of a volume by bisection the same way `solidBuild` lets it
     * bisect a floor -- and for the same reason: an assertion that has to move
     * the player to make its measurement cannot then measure the player.
     *
     * `trueG` and `apparentG` are both published because their DIFFERENCE is
     * the physically meaningful quantity (it is the carrier's freefall) and
     * because a report carrying only the second could not tell an orbit from a
     * world with gravity switched off.
     */
    weight(x?: number, y?: number, z?: number) {
      const b = s.player?.body;
      if (b === undefined || b === null) return null;
      const at = x === undefined || y === undefined || z === undefined
        ? { x: b.feet.x, y: b.feet.y, z: b.feet.z } : { x, y, z };
      const r = Math.hypot(at.x, at.y, at.z);
      const trueG = s.body.gravityAccel(r);
      const field = b.gravity;
      const apparentG = field === null ? trueG : field.apparentAt(at.x, at.y, at.z, trueG);
      return {
        at: [at.x, at.y, at.z], r,
        trueG, apparentG, freefallG: trueG - apparentG,
        /** EXACT equality, not a tolerance: see GravityVolumes.ts. */
        restoredExactly: apparentG === trueG,
        floatG: ZEROG.floatG, standG: ZEROG.standG,
        thrustAccel: ZEROG.thrustAccel, maxSpeedMps: ZEROG.maxSpeedMps,
        /** The LIVE walker state, only meaningful when no point was given. */
        floating: b.floating,
        weightless: b.weight.weightless,
        grounded: b.grounded, onDeck: b.onDeck,
        volumes: volumes.count,
        inVolumes: volumes.at(at.x, at.y, at.z).map((v) => ({
          id: v.id, mode: v.mode, powered: v.powered, carrierG: v.carrierG,
        })),
        station: lastStationGravity(),
        gravityTests: b.gravityTests,
      };
    },

    /**
     * The station's artificial gravity, on or off. THE INSTRUMENT FOR THE
     * DERELICT CASE, and the seam a real powered generator entity plugs into
     * (PH-103): nothing here decides how much gravity, only whether. See
     * StationGravity.ts for why the generator publishes no magnitude of its own.
     */
    stationGravity(on?: boolean) {
      if (on !== undefined) setStationGravityPowered(on);
      return { powered: stationGravityPowered(), report: lastStationGravity() };
    },

    /**
     * WHOLE-WORLD GRAVITY SCALE, and it exists to be an INSTRUMENT rather than
     * a cheat (PH-99). "Does the walker degrade into a floating body when
     * gravity goes away" is a question about the WALKER, and asking it at the
     * station would fold the volume geometry, the fringe and the station's own
     * pose into the answer. This asks it with nothing else in the room.
     *
     * It stacks UNDER any volumes rather than replacing them, so a run can zero
     * the world and still ask what a powered deck does on top of that.
     */
    gravityScale(k?: number) {
      const b = s.player?.body;
      if (b === undefined || b === null) return null;
      if (k !== undefined) {
        uniform.scale = k;
        // Installed unconditionally rather than only when k !== 1. Multiplying
        // by 1.0 is exact in IEEE754, so the stacked field at scale 1 returns
        // the same bits the bare volume set does, and a hook that rewired
        // itself depending on its own argument would be a second code path
        // reachable only by the value nobody tests with.
        b.gravity = new StackedGravity(uniform, volumes);
      }
      return { scale: uniform.scale, volumes: volumes.count,
        stacked: b.gravity !== volumes };
    },

    collect(id: number) {
      const f = s.gameplay?.factory;
      const b = f?.placed.find((p) => p.id === id);
      return f === undefined || b === undefined ? 0 : f.collect(b);
    },

    demolish(sel: { id?: number; machine?: number; part?: number }) {
      const g = s.gameplay;
      if (g === null) return null;
      if (sel.part !== undefined) {
        const p = g.structures.parts.find((q) => q.id === sel.part);
        return p === undefined ? null
          : demolishStructure(g.structures, g.structView, g.game, p);
      }
      if (sel.machine !== undefined) {
        const m = g.machines.list[sel.machine];
        return m === undefined ? null
          : demolishMachine(g.machines, g.game, m);
      }
      const b = g.factory.placed.find((p) => p.id === sel.id);
      return b === undefined ? null
        : demolishBuild(g.factory, g.factoryView, g.game, b);
    },

    /**
     * GP-65. Deal damage to a placed thing, by its health key.
     *
     * THIS IS THE SAME CALL A WEAPON MAKES and deliberately not a shortcut past
     * one: `HealthBook.damage` is the only door into the number, so a probe
     * driving this is driving the combat path with the trigger left off. That
     * matters because health lands BEFORE any damage source exists, and without
     * an entry here the persistence claim could not be tested at all until a gun
     * shipped, which is exactly the order this work set out not to use.
     *
     * Returns null for an unknown key rather than a cheerful zero, because a
     * probe that silently damaged nothing and then asserted the damage survived
     * a reload would pass on two absences agreeing with each other.
     */
    damage(sel: { key: string; amount: number }) {
      const g = s.gameplay;
      if (g === null || typeof sel?.key !== 'string') return null;
      if (!g.health.has(sel.key)) return null;
      const r = g.health.damage(sel.key, sel.amount);
      return { key: sel.key, ...r };
    },

    /**
     * GP-79. Hurt the PLAYER, and stand them back up.
     *
     * `hurt` is the same `PlayerHealth.hurt` an enemy's contact will reach
     * through `step`, so a probe driving it drives the real path: the death
     * rule, the banner, the blackout and the respawn are all downstream of this
     * one call and none of them is reimplemented for the test.
     *
     * `respawn` exists so a probe does not have to wait out the five second
     * blackout in real time, and it is the SAME call the timer makes rather
     * than a second way to stand up, which is what keeps the teleport and the
     * heal from ever getting out of step.
     */
    hurt(sel: { amount?: number; cause?: string; respawn?: boolean }) {
      const g = s.gameplay;
      if (g === null) return null;
      if (sel?.respawn === true) {
        if (s.player === null) return null;
        g.vitals.respawn({ player: s.player, hud: g.hud });
      } else {
        g.vitals.health.hurt(Number(sel?.amount ?? 0), String(sel?.cause ?? 'debug'));
      }
      return g.vitals.report();
    },

    /** GP-87 to GP-93. The enemy loop, its nests and the swarm. `advance` is
     *  the ONLY verb that changes anything and it changes only the CLOCK; there
     *  is deliberately no way to conjure a wave. Reasoning in game/EnemyDebug.ts. */
    enemies(op?: string | number, a?: number) {
      const g = s.gameplay;
      return g === null ? null : enemyDebug(g.enemies, g, s.oracle, op, a);
    },

    audio(op?: string | number) {
      const sfx = s.gameplay?.sfx;
      if (sfx === undefined) return null;
      if (typeof op === 'number') sfx.bus.setVolume(op);
      else if (op === 'mute') sfx.bus.setMuted(true);
      else if (op === 'unmute') sfx.bus.setMuted(false);
      else if (op === 'unlock') void sfx.bus.unlock();
      else if (op !== undefined) sfx.play(op);
      return sfx.stats();
    },

    // DW-20 for sound, in two calls and not one. The published shape of
    // audioRender is a CONTRACT that probes already read; the beds get their
    // own entry rather than being wrapped around it. Both exist for the same
    // reason: a bed that runs for ever producing silence is exactly the failure
    // a play counter reports as working.
    audioRender: () => renderVoices(),
    bedsRender: () => renderBeds(),

    // DW-17. `save` writes the autosave slot NOW and `load` applies it over the
    // live world, which is what makes a reload testable without one: a probe
    // can save, mutate, load and compare in a single page.
    save: () => s.gameplay?.save() ?? Promise.resolve(null),
    load: () => s.gameplay?.load() ?? Promise.resolve(null),
    // The RUNNING mode's slot only. Wiping both would let a probe destroy a
    // world it is not testing, which is exactly the contamination DW-31 exists
    // to prevent, from the other direction.
    wipe: () => clearSlot(s.gameplay?.mode.mode ?? 'survival'),
    // Regrow the clearing from the seed, exactly as boot does. This is what
    // lets a probe model a RELOAD without one: a save is a diff over a freshly
    // generated world, so restoring onto a world that is already more depleted
    // than the save is a state a real boot can never be in.
    repopulate() { s.gameplay?.populate(); return s.gameplay?.report() ?? null; },
    /**
     * GP-268 / R16. THE STARTER GATE AS A PURE FUNCTION, so the invariant can
     * be driven with an answer no shipped body produces. A READ and never a
     * mutation (the allowlist rule): it places nothing and changes nothing.
     *
     * This exists because the shipped tables cannot exercise the rule. Forge
     * has air and Cinder has an empty list, so on the two bodies that exist
     * the refusal branch is never taken, and a rule that is never taken is a
     * rule nobody knows is there. `kinds` lets a probe hand it the case that
     * matters: a table that ASKS for a tree on an airless body.
     */
    starterPlan(bodyId: unknown, airless: unknown, kinds?: unknown) {
      const t = Array.isArray(kinds) ? kinds.map(Number) : undefined;
      return {
        plan: starterPlanFor(Number(bodyId), airless === true, t),
        tables: STARTER.map((x) => ({ bodyId: x.bodyId, name: x.name,
                                      count: x.kinds.length, why: x.why })),
        plantKinds: [...PLANT_KINDS],
      };
    },

    // W7. The H key's own handler, so a probe cannot hide the checklist by a
    // path a player has no access to.
    goals(show?: boolean) {
      const g = s.gameplay;
      if (g === undefined || g === null) return null;
      if (show !== undefined) showGoals(g, show);
      // GP-165: the resolved hints ride along so a probe can assert the
      // derivation for rows the panel is not currently drawing.
      // GP-286. THE DRAWN ROWS, not just the counters, plus the two facts a
      // probe needs to tell "this world refused it" from "the player has not
      // done it yet". `airless` and `woodPlaceable` come off the same
      // authority the card and the tree placement share, so a probe cannot
      // agree with a second copy of the rule.
      const v = g.goals.view(g);
      return {
        ...(g.goals.report() as object), hints: g.goals.allHints(g),
        bodyId: g.starterBodyId,
        airless: bodyIsAirless(g.core, g.starterBodyId),
        woodPlaceable: !bodyIsAirless(g.core, g.starterBodyId),
        mootCount: g.goals.mootCount(g),
        doneCount: v.doneCount,
        rows: v.rows,
        // GP-350. EVERY ROW'S PREDICATE EVALUATED NOW, which is a different
        // question from `rows[i].done` (a POSITION in the walk). It is what
        // lets a fixture test a row without first driving the ten in front of
        // it, and in particular test it at its DEFAULT.
        satisfied: g.goals.satisfied(g),
        // Whether the CHECKLIST is holding the panel up, as opposed to the
        // world HUD leaving it up. Both read `isVisible` the same.
        panelPinned: g.goalPanel.isPinned,
        panelVisible: g.goalPanel.isVisible,
      };
    },

    // DW-17, the voxel half of `repopulate`: put the rock back, so a restore is
    // verified against a world with no digs in it, which is the only state a
    // reloaded page can actually be in.
    forgetTunnels() {
      const left = clearEdits(s.core, s.voxels, s.voxelMesh);
      return { removedCells: left, meshVisible: s.voxelMesh?.mesh.visible ?? false };
    },

    harvest(index: number) {
      if (s.gameplay === null) return null;
      const ok = s.gameplay.interact.harvestNow(index, loop.tickIndex);
      // GP-506: `refusal` names WHY a false `ok` happened (tool gate) rather
      // than leaving a probe to guess between that, an empty node and a full
      // pack from `node`/`carried` alone.
      return {
        ok, node: s.gameplay.game.node(index), carried: s.gameplay.game.carried(),
        refusal: s.gameplay.interact.lastRefusal,
      };
    },
  };
}
