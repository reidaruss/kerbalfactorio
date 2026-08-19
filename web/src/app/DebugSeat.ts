// PUTTING THE WALKER SOMEWHERE, AND THE FRAME THAT PUTS IT THERE (GP-1075,
// split out of DebugGameplay.ts under the 400-line cap).
//
// The two verbs are a matched pair and CE-54 is the seam between them:
// `standAt` takes a body-frame point and REFUSES inside a carrier's bound,
// naming `standAboard` in the refusal; `standAboard` is the verb it names,
// speaking the station's own authored local frame and boarding through the
// shipped `seatOnStationDeck`. Neither docstring can be read without the
// other, and the refusal's message is a live reference to the sibling below
// it, so the two travel together.
//
// WHERE THE STATION *IS* is `DebugStation.ts` next door. This module moves the
// player; that one only reads.
import { lastStationSolid } from '../game/SpaceStation.js';
import { seatOnStationDeck } from './StationMount.js';
import { BOARD_MARGIN_M } from '../world/CarrierBoarding.js';
import type { Services } from './Services.js';
import type { Loop } from './Loop.js';

export function seatApi(s: Services, loop: Loop) {
  return {
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
      //
      // ===================================================================
      // CE-101. AND `frame: 'body'` NOW SAYS WHAT IT DID, RATHER THAN GOING
      // QUIET.
      // ===================================================================
      //
      // CE-54 CHOSE THIS BRANCH AND THEN MADE IT THE ONLY SILENT ONE. The
      // membership test was skipped entirely for `frame: 'body'`, so the exact
      // reading CE-54 exists to prevent -- a caller seated at a point the deck
      // is about to leave behind -- came back indistinguishable from a seat in
      // empty space: `carrier: null`, and nothing else to read. `zerog.js` Z4
      // then spent a pass being honestly red with no instrument in its own
      // return value that named the cause (GP-805 had to go to
      // `of.carrier('mounts')` for it).
      //
      // The test is run on BOTH paths now and only the ACTION differs. Asking
      // for the body frame is still granted in full and still zeroes the
      // absolute velocity; it is simply told, in the value it hands back,
      // which carrier it is inside and how deep. That is what lets a probe
      // ASSERT it is holding the defect on purpose (`carrier` non-null,
      // `boarded: false`) instead of asserting nothing, and it is why Z4's
      // negative control can now be a named reading rather than a comment.
      //
      // The cost off a carrier is unchanged and is the same sentence as
      // before: one bounding-sphere reject per mount, and there is one mount.
      const on = s.mounts?.mountContaining(x, y, z, BOARD_MARGIN_M) ?? null;
      if (on !== null && opts?.frame !== 'body') {
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
          depthM: on.depthAt(x, y, z), boarded: false,
          feet: null, r: null, grounded: null, onDeck: null };
      }
      p.standAt(x, y, z);
      const f = p.body.feet;
      return {
        refused: false, why: null,
        /** CE-101. The carrier this body-frame seat landed INSIDE, or null.
         *  Non-null only on the `frame: 'body'` path, where it is the caller's
         *  own stated intent: the seat happened, in the body frame, and the
         *  deck will leave it behind at the carrier's own speed. */
        carrier: on?.frame.id ?? null,
        depthM: on === null ? null : on.depthAt(x, y, z),
        /** CE-101. ALWAYS FALSE, and it is here to be read rather than to
         *  vary. `standAt` never boards, in either frame: boarding is a
         *  velocity match against a LIVE pose and this verb's argument is a
         *  body-frame coordinate that was already stale when it was computed.
         *  A probe that wants a rider aboard asks `standAboard`; a probe that
         *  wants this defect as a control asserts on this field. */
        boarded: false,
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
  };
}
