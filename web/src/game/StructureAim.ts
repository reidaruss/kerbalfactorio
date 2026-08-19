// Aim march: where the crosshair's ray lands, and whether it hit anything.
// Split out of StructurePlacement.ts (line-cap batch 2, BT-285): the raycast
// and its two fallback-point derivations are one cohesive group with no
// dependency on the resolve/commit machinery below them in the original file.

import * as THREE from 'three';
import { AIM_STEP_M } from './StructureGrid.js';
import type { Solid } from './StructureBody.js';
import type { Structures } from './Structures.js';
import type { Vec3d } from '../world/PlanetBody.js';

/** Aim march: step and reach, metres. Longer than a machine's, because a base is
 *  laid out by looking across it, not by standing on every cell of it.
 *
 *  DW-32 DOUBLED IT. 12 m was twelve cells at the 1 m module and is three at the
 *  4 m one, which is not enough to reach the far edge of the cell you are aiming
 *  at from inside a room you have already walled. 24 m is six cells: the whole
 *  of a 20 x 20 m five-cell room from its own doorway, without walking. The
 *  march still steps at 0.2 m, so this is 120 oracle samples rather than 60, and
 *  it stops at the first hit either way. */
// GP-1027: the step now lives in `StructureGrid` as `AIM_STEP_M`, because
// `levelOf` carries it as a TOLERANCE and the march's step and the slack it
// produces have to be one number. Aliased here so the march below still reads
// as a march rather than as a grid import.
const STEP_M = AIM_STEP_M;
const REACH_M = 24.0;
/** Where the ghost falls back to when the aim meets neither ground nor build.
 *  A cell and a half, keeping the quarter-of-reach ratio 3.0 had against 12. */
const FALLBACK_M = 6.0;
/**
 * GP-289. How much tangential aim is enough to say which way the player is
 * facing. `dir` is a unit vector, so this is sin(angle from the local
 * vertical): 0.09 is about 5 degrees, i.e. the preview is refused only inside a
 * narrow cone straight up or straight down where no heading exists at all. It
 * is a bound rather than a taste, and the alternative was picking an arbitrary
 * bearing and watching the preview swing as the camera crossed the pole.
 */
const OVERHEAD_TAN = 0.09;
/**
 * GP-289. THE NEAREST A PREVIEW MAY BE PLACED, and this is the number Reid's
 * report is actually about.
 *
 * Measured before fixing, foundation in hand, pitch swept: at 0 degrees the
 * preview sits 6.051 m away and the player is outside it; at -30, 3.206 m and
 * outside; at -60, 1.645 m and INSIDE; at -85, 1.385 m and INSIDE. The aim ray
 * is hitting real ground every time. Nothing is malfunctioning: look down and
 * the ground is close, so the building goes where you are standing, and the
 * preview material is `DoubleSide` with `depthWrite` off, so the inside faces
 * of a 4 m slab you are within ARE the viewport. "The translucent preview fills
 * the screen rather than sitting on the ground where the thing will go" is that
 * sentence exactly, and it happens at any downward pitch past about 45 degrees,
 * which is most of the time somebody is placing something.
 *
 * 3.2 m is the smallest value that keeps a standing eye outside the largest
 * 4 m module's box (half-diagonal 2.83 m plus a margin), derived rather than
 * tuned. THIS IS A SEMANTICS CHANGE AND IT IS FLAGGED: a player can no longer
 * put a building directly under their own feet, they have to take a step back.
 * That is how every builder this game is like behaves, and the alternative is a
 * preview that cannot be seen at the moment it matters most, but it is Reid's
 * call and it is one constant.
 */
const MIN_PLACE_M = 3.2;

/**
 * March the aim against the ground AND against what is already built, and take
 * whichever comes first. Without the second half a player aiming at the top of a
 * foundation would be told about the soil underneath it, and no upper storey
 * could ever be aimed at.
 *
 * =============================================================================
 * GP-966. "IGNORE THE SOLIDS A PLACEMENT CANNOT STAND ON" WAS BUILT, MEASURED
 * AND REVERTED. The numbers are here so nobody spends the afternoon this lane
 * did (FS-129's precedent, one file over).
 *
 * The brief was GP-937's UX finding: aiming a placement ghost across a tall
 * placed structure resolves the target block from that structure's own body hit,
 * so a player near a 28 m launch pad gets a misresolved cell from every vantage
 * the pad occludes; five were tried and all failed identically. The fix built
 * for it was principled: every solid shares one `StructureBodies` by design
 * (GP-58, one collision set for the walker), so tag the structural base parts
 * and let this march see only those, since a pad stands on 36 decks and nothing
 * is ever built on a pad. `Solid.basePart`, one flag, five files.
 *
 * IT MOVES NOTHING AT THE VANTAGE MEASURED. Two dists one line apart, same
 * seed, same standoff, same single aim, real D3D11 headless Chrome: the block
 * resolved is `[-3,-2,0]` in BOTH arms, with the whole ghost JSON identical.
 *
 * THE REASON IS `MIN_PLACE_M`, AND IT IS THE ONLY REASON. That clamp below
 * throws away any hit inside 3.2 m, and on a finished platform the nearest
 * surface is the deck you are standing on. Measured from pad.js's own 3 m
 * standoff: first solid on the ray at 0.20 m with the pad placed and 3.00 m
 * without it, and the same block out of both. Whatever the march found, this
 * function did not use it, so the arms could not differ.
 *
 * A SECOND REASON WAS PUBLISHED HERE AND IS WITHDRAWN. It said the pad is not
 * really 28 m to the aim, on the strength of a `solidBuild` sweep that found a
 * 2.0 m collision crown. A fresh-context verifier falsified it: that sweep
 * sampled two columns of a 24 m plan, `col_LaunchTower` sits at pad-local x
 * about -8 (the mirror of the one off-centre column it took) and spans 2.00 to
 * 28.00 m, and `padProxies` adopts every `col_` node but `col_LaunchClamp`.
 * **The pad's collider does reach its mesh crown and the pad IS a tall body to
 * this march.** `probes/pad.js`'s GP-969 block now sweeps the whole plan and
 * asserts that corrected fact. The withdrawal does not touch the measurement
 * above or the conclusion below, both of which stand on the clamp alone.
 *
 * So the pad never was the occluder -- not because it is short, but because
 * this function discarded the hit before the block was derived -- and the
 * reported symptom is GP-968 below, one constant away.
 *
 * =============================================================================
 * GP-1025. WHY GP-966 MEASURED NULL, AND IT IS "INCONCLUSIVE" RATHER THAN "NO".
 * The distinction matters because the entry above spent it as a NO.
 *
 * "Two dists one line apart, same seed, same standoff, same single aim" is TWO
 * BUILDS at ONE distance, and that distance was `pad.js`'s 3 m. The block just
 * above records what the ray met there: 0.20 m with the pad and 3.00 m without.
 * BOTH are inside `MIN_PLACE_M` (3.2 m), so both arms took the near-hit branch
 * below, which throws the march result away and returns a ground point instead.
 * The experiment did not weakly exercise the flank path. It never entered it.
 * An A/B whose two arms both skip the code under test cannot return a negative,
 * and the sentence it produced -- "a change to this function with no measurable
 * consequence is a liability" -- does not follow from it, because "no measurable
 * consequence" was a property of the standoff and not of the change.
 *
 * WHAT A CONCLUSIVE STANDOFF LOOKS LIKE, measured: `probes/padflank.js` stands
 * 14 m back and the first solid on the ray is at 14.0 m, four times the clamp,
 * so the march result is used and the two arms differ. That probe is also the
 * multi-storey fixture the entry below asked for, and it turned the worst case
 * from an argument into a number.
 *
 * AND GP-966 WAS THE WRONG FIX ANYWAY, WHICH THE NULL RESULT HID. `Solid`s a
 * placement cannot stand on is not the set: a WALL IS A LEGAL BASE. `supported()`
 * accepts a deck at level L over a wall at L-1, and DW-32 ships on aiming at a
 * wall's TOP to put the next floor over it, so the wall has to stay in this
 * march. The same body therefore has to give one answer for its crown and a
 * different one for its face, and no filter over BODIES can do that. Measured on
 * `padflank.js`'s boundary profile, one wall, aim walked up it:
 *
 *   aim z   1.0    2.0    2.5    3.0    3.5    3.8    3.95
 *   hit u   0.978  1.995  2.514  3.024  3.561  3.852  3.993
 *   level   0      0      0      0      0      1      1
 *
 * The level turns over at the CROWN and not at the body. That is GP-1027 in
 * `StructureGrid.levelOf`, and it is where this defect was fixed.
 * =============================================================================
 *
 * WHAT WAS THEREFORE STILL OPEN AFTER GP-969, AND IS NOW CLOSED BY GP-1027.
 * A flank hit that lands BEYOND `MIN_PLACE_M` is not covered by the measurement
 * above, and with the tower confirmed real that case exists and reproduces.
 * `probes/pad.js` stands a player 14 m back and aims 16.5 m up the tower column
 * the crown sweep found: the ray meets the pad at 19.6 m, well past the 3.2 m
 * clamp, so the march result IS used, and the ghost resolved `[-2,-4,3]`.
 * That trailing 3 was `padBlockAt` reading the hit's height as a STOREY
 * (`round(l.z / storey)`, clamped to MAX_LEVEL) off a point on a vertical face,
 * so the pad was addressed at a storey the platform does not have.
 *
 * ON THAT FIXTURE IT IS LEGIBILITY ONLY, AND THAT IS A PROPERTY OF THE FIXTURE
 * RATHER THAN OF THE DEFECT. `[-2,-4,3]` refuses structurally, because level 3
 * has no decks and an invented storey cannot manufacture the 36 real deck parts
 * `missingDecks` counts. **On a base that genuinely HAS a 6 x 6 platform at the
 * invented level, the same flank read resolves a LEGAL, GREEN ghost at a cell
 * the player never aimed at**, and `overlapping()` only rejects pads sharing a
 * level, so an existing pad at level 0 does not refuse it either. The worst case
 * is a wrong-but-placeable pad that looks correct right up to the press, not a
 * confusing refusal, and any fix should be judged against that case.
 *
 * THE WORST CASE IS NOW A MEASUREMENT AND IT WAS EVERYTHING THE ARGUMENT SAID.
 * `probes/padflank.js` builds the base the argument needed -- 6 x 6 at level 0
 * by real aims, a wall on the centre cell's north edge by the real key, 6 x 6 at
 * level 1 through `Structures.adopt` (the call `commitTarget` and
 * `StructureSave.restore` both make), then a real `of.save()` and `of.load()` so
 * every part under measurement came out of the shipped restore. Before GP-1027,
 * from a fixed eye 14 m south with the hit 2.506 m up the wall's face: the ghost
 * read `[-3,-3,1] ok TRUE missing 0`, and the press PUT A LAUNCH PAD ON THE
 * ROOF, 1.994 m above the point the crosshair was on, through a ceiling the
 * player cannot see past. Nothing refused it, exactly as predicted.
 * After GP-1027 the same aim reads `[-3,-3,0]` and the pad lands on the floor
 * under the crosshair, 2.006 m below the aimed point. `pad.js`'s own tower
 * reading moved with it, from `[-2,-4,3] "36 of 36 cells have no foundation"` to
 * `[-2,-4,4] "too high"`: the clamp removal made a refusal that had never once
 * run in the shipped game reachable.
 *
 * THE FOUR REJECTED CANDIDATES, and the first one is rejected on a NEW argument
 * rather than on GP-966's null.
 *   * `Solid.basePart`, ignore the solids a placement cannot stand on. A wall IS
 *     one it can stand on (see GP-1025 above), so the wall stays in the march
 *     and the flank case survives the fix. Filtering bodies cannot answer a
 *     question about faces.
 *   * IGNORE ALL PLACED STRUCTURES takes decks out too and deletes multi-storey
 *     aiming outright.
 *   * RESOLVE THE GROUND BEHIND A HIT whose body is not a legal base has the
 *     same body-versus-face problem, and it changes WHERE the ghost is as well
 *     as which storey it is on, which is a second behaviour to justify.
 *   * A VISIBLE CUE names a wrong cell without making it right (GP-969's own
 *     note), and a cue for a green ghost is a warning label on a bug.
 * What shipped instead is one expression, in one place, that both derivations
 * now share: `StructureGrid.levelOf`.
 * =============================================================================
 */
/**
 * GP-289. THE MARCH, AND WHETHER IT HIT ANYTHING.
 *
 * `found` is false when the ray reached `REACH_M` without touching ground or a
 * solid, which is what happens the moment a player looks up. The point is still
 * returned, at `FALLBACK_M`, because callers want somewhere to put a crosshair
 * even then; what they may NOT do any longer is draw a building there.
 *
 * REID'S BUG WAS THIS FALLBACK BEING SILENT. Measured 2026-08-03: with a
 * foundation in hand and the camera pitched at the sky, the preview lands
 * 1.385 m from the eye with the eye INSIDE its bounding box, and the ghost
 * material is `DoubleSide` with `depthWrite: false`, so what fills the viewport
 * is the inside of a 4 m slab you are standing in. "The translucent preview
 * fills the screen rather than sitting on the ground where the thing will go"
 * is exactly that, and the fallback distance is why: 6 m along a ray pointing
 * at the sky is 6 m of air over your own head.
 */
export function aimHit(s: Structures, ray: { origin: Vec3d; dir: Vec3d }):
{ p: Vec3d; found: boolean; overhead: boolean; solid: Solid | null } {
  const o = ray.origin, d = ray.dir;
  let tGround = -1;
  for (let t = 0.6; t <= REACH_M; t += STEP_M) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (Math.hypot(x, y, z) <= s.groundRadius(x, y, z)) { tGround = t; break; }
  }
  // GP-1027. `rayPick` RATHER THAN `rayHit`, AND IT IS THE SAME MARCH. Both walk
  // the ray at `STEP_M` and stop at the first sample inside a solid; `rayHit`
  // asks `blocks`, which is `inside` over the same list with the same O(1)
  // reject, so this returns the identical `t` and costs the same. What it also
  // returns is WHICH body, and `levelOf` needs that body's crown to tell a hit
  // on a top from a hit on a face. Nothing else in this function changed.
  const pick = s.bodies.rayPick(o, d, REACH_M, STEP_M);
  const tSolid = pick === null ? -1 : pick.t;
  if (tGround >= 0 || tSolid >= 0) {
    const raw = tGround >= 0 && tSolid >= 0 ? Math.min(tGround, tSolid)
      : tGround >= 0 ? tGround : tSolid;
    // PUSHED OUT TO ARM'S LENGTH, then dropped back onto the surface. Moving
    // along the ray alone would lift the point off the ground as the pitch
    // steepens, which trades one wrong preview for another; `fallbackOnGround`
    // already knows how to put a point on the surface in the direction the
    // player is facing, so a close hit reuses it rather than inventing a second
    // projection.
    //
    // =========================================================================
    // GP-968. ARM'S LENGTH IS `MIN_PLACE_M`, AND THIS PUSHED TO `FALLBACK_M`.
    //
    // `fallbackOnGround` used to hardcode `Math.max(FALLBACK_M, MIN_PLACE_M)`,
    // which is 6.0 m, so a hit refused for being nearer than 3.2 m was moved to
    // 6.0 m: 2.8 m further than the rule that rejected it asks for, in a
    // direction the player did not aim. On the shipped 4 m module that is most
    // of a cell, and it lands in the NEXT one.
    //
    // IT IS THE WHOLE OF THE "PAD OCCLUSION" REPORT (GP-937's five vantages),
    // MEASURED. On a finished platform the nearest surface is the deck you are
    // standing on, so `raw` is always inside 3.2 m and this branch always fires;
    // the point it returns is then a function of the eye and the aim direction
    // ALONE, with nothing in the world in it. That is why five different
    // vantages returned one identical block, and why an A/B one line apart --
    // marching the pad's body versus not marching it -- returns the same block
    // too, on the same seed, from the same standoff, with the first solid on the
    // ray at 0.20 m in one arm and 3.00 m in the other. The pad was never the
    // cause; this constant was, and the pad was simply the thing in frame.
    //
    // Measured at pad.js's own 3 m standoff, 4 m cells: pushing to 6.0 m puts
    // the point 3.0 m past the aimed cell CENTRE, over its 2.0 m boundary and
    // into the next cell (`[-3,-2,0]` for `[-3,-3,0]`). Pushing to 3.2 m puts it
    // 0.2 m past the centre, inside the cell that was aimed at.
    //
    // GP-289's ARGUMENT IS UNTOUCHED AND THAT IS THE POINT OF USING ITS OWN
    // NUMBER. 3.2 m is derived there as the smallest distance that keeps a
    // standing eye outside the largest 4 m module's box (half-diagonal 2.83 m
    // plus margin), so pushing to exactly it satisfies the rule exactly, and the
    // 6.0 m was never a second safety margin -- it is `FALLBACK_M`, the distance
    // for a ray that hit NOTHING, borrowed by a branch about a ray that hit
    // something too close. Two different questions were sharing one constant.
    // =========================================================================
    // GP-1027. THE NEAR-HIT BRANCH RETURNS A GROUND POINT, so it returns NO
    // solid: `fallbackOnGround` puts the point on the surface in the direction
    // the player is facing, and whatever the march touched at 0.2 m is not what
    // that point is on. Saying otherwise here would hand `levelOf` a crown
    // belonging to a body the returned point is nowhere near. THIS IS ALSO WHY
    // GP-966's A/B COULD NOT MOVE: at that experiment's 3 m standoff every hit
    // took this branch, so the march result was discarded in both arms.
    if (raw < MIN_PLACE_M) {
      return { p: fallbackOnGround(s, o, d, MIN_PLACE_M), found: true,
               overhead: overheadOf(o, d), solid: null };
    }
    // The solid is reported only when the SOLID is what was hit. Ground first
    // means ground, and a ground point has no crown.
    return { p: { x: o.x + d.x * raw, y: o.y + d.y * raw, z: o.z + d.z * raw },
             found: true, overhead: false,
             solid: pick !== null && raw === tSolid ? pick.solid : null };
  }
  return { p: fallbackOnGround(s, o, d, FALLBACK_M), found: false,
           overhead: overheadOf(o, d), solid: null };
}

/**
 * GP-289. WHERE A BUILDING GOES WHEN THE AIM RAY HITS NOTHING, and it is ON THE
 * GROUND rather than wherever the ray happened to be at six metres.
 *
 * THE MISS IS THE NORMAL CASE, WHICH IS THE PART THAT WAS NOT UNDERSTOOD. The
 * march runs 24 m across a body 600 km in radius, so a ray anywhere near the
 * horizontal never dips below the surface: measured on a fresh spawn looking at
 * flat open ground, the foundation preview sat at 6.014 m, which is
 * `FALLBACK_M` to the millimetre. It had NEVER been a hit. So the old fallback
 * was not an edge case for a player staring at the sky, it was the ordinary
 * path, and it worked by accident only while the camera was roughly level: at
 * that pitch "six metres along the ray" and "six metres ahead on the ground"
 * are nearly the same point, and they diverge exactly as the player looks up,
 * until at full pitch the point is six metres above their own head and the
 * DoubleSide preview they are standing inside becomes the whole viewport.
 *
 * The fix is to stop using the ray's own direction for the distance. Take the
 * aim direction's component in the local TANGENT PLANE, step `FALLBACK_M` along
 * that from under the eye, and put the result on the surface. It agrees with
 * the old behaviour where the old behaviour was right, it is defined at every
 * pitch, and it means the preview is on the ground by construction rather than
 * by the player happening to look at it.
 */
/** How much heading the aim has, as sin(angle from the local vertical). */
function overheadOf(o: Vec3d, d: Vec3d): boolean {
  const up = new THREE.Vector3(o.x, o.y, o.z).normalize();
  const tan = new THREE.Vector3(d.x, d.y, d.z);
  tan.addScaledVector(up, -tan.dot(up));
  return tan.length() < OVERHEAD_TAN;
}

/**
 * GP-968. `aheadM` IS THE CALLER'S, because the two callers are asking two
 * different questions and used to share one answer. A ray that hit NOTHING
 * wants `FALLBACK_M`; a ray that hit something INSIDE arm's length wants
 * `MIN_PLACE_M`, the constant that rejected it. The `Math.max` that used to sit
 * on the step below made the second silently take the first's value.
 */
function fallbackOnGround(s: Structures, o: Vec3d, d: Vec3d,
                          aheadM: number): Vec3d {
  const up = new THREE.Vector3(o.x, o.y, o.z).normalize();
  const fwd = new THREE.Vector3(d.x, d.y, d.z);
  fwd.addScaledVector(up, -fwd.dot(up));
  // STRAIGHT UP OR STRAIGHT DOWN has no heading of its own, so the ghost goes
  // where the player is standing rather than in a direction invented here. Any
  // invented direction would be a preview that moves when the camera passes
  // through the pole, which is worse than one that sits at your feet.
  if (fwd.lengthSq() < OVERHEAD_TAN * OVERHEAD_TAN) {
    // STRAIGHT UP OR STRAIGHT DOWN HAS NO HEADING, and every answer here is a
    // guess. Returning the player's own feet was the second wrong version of
    // this fix: a 4 m slab centred where you stand is a slab you are inside,
    // which is the very thing being fixed. The point is still returned so a
    // caller has something, and `overhead` tells `BuildMode` to draw nothing.
    const r0 = s.groundRadius(up.x, up.y, up.z);
    return { x: up.x * r0, y: up.y * r0, z: up.z * r0 };
  }
  fwd.normalize();
  // GP-968: `aheadM`, not `Math.max(FALLBACK_M, MIN_PLACE_M)`. The clamp is kept
  // as a floor so no caller can ask for a point inside its own preview box.
  const p = new THREE.Vector3(o.x, o.y, o.z)
    .addScaledVector(fwd, Math.max(aheadM, MIN_PLACE_M));
  p.normalize();
  const r = s.groundRadius(p.x, p.y, p.z);
  return { x: p.x * r, y: p.y * r, z: p.z * r };
}

/** The point alone, for callers that genuinely do not care. Unchanged. */
export function aimPoint(s: Structures, ray: { origin: Vec3d; dir: Vec3d }): Vec3d {
  return aimHit(s, ray).p;
}
