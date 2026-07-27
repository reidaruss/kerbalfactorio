// THE FOUR NUMBERS DW-24, DW-32 AND DW-33 ARE ACTUALLY ABOUT, and the one
// function that spends them.
//
// Lifted out of Structures.ts because they are a different kind of thing from
// "what exists in the world", and because Structures.ts had no room left. They
// belong together: FLOAT and BURY are the two halves of one budget, the plane
// fit is how that budget is spent, and the cantilever is what happens when the
// float half runs out with a neighbour standing next to you.
//
// FLOAT is ground BELOW a part's base plane: a visible gap of daylight under a
// hovering slab, which is the thing DW-24 protects against.
//
// RE-MEASURED FOR THE 4 m MODULE (GP-30), never scaled. `probes/buildtol.js` at
// 812 footprints per site: a freely placed deck on ordinary sloped ground reads
// 0.5142 m p95 (p05 0.4979, so a cliff and not a tail), a plain 0.3350 m p95,
// and the levelling tool's worst downward residual over a levelled pad 0.5138 m.
// So the measured floor is 0.52 and 0.90 stands 1.7x above it. It is 0.90 rather
// than 0.55 because what makes a gap READ as wrong is its share of the span over
// it: 0.55 under a 1.00 m deck was 55% of the span and 0.90 under a 4.00 m deck
// is 22%, so this is TIGHTER in the only terms a player can see. It also opens
// the 0.70-to-0.90 band in which DW-32's pillar (minimum height 0.70 m) is both
// reachable and load-bearing.
//
// BURY is ground ABOVE the base plane. It disappears INSIDE the slab and reads
// as a pad set into soil, which is what a foundation on real ground looks like,
// so it costs nothing until the ground would break through the top face. The
// bound is therefore the deck thickness itself, read off the asset's own
// `socket_top`; the constant here is only the fallback for a failed load.

/** How far a corner may HANG before the gap of daylight is the failure. */
export const FLOAT_TOLERANCE_M = 0.90;
/** Only for a module that failed to load; the live bound is `module.deckH`. */
export const BURY_TOLERANCE_FALLBACK_M = 0.50;

/**
 * GP-36 (DW-33). THE FOUNDING PLANE IS CHOSEN TO FIT ITS FOOTPRINT.
 *
 * `lo` and `hi` are the lowest and highest signed deviations of the ground from
 * a candidate plane; the return is how far to MOVE that plane, in metres, so
 * positive raises it. Deviations then become `dev - d`, with positive burying
 * and negative floating.
 *
 * The old rule was `d = lo`, which pins the plane on the footprint's low point
 * and therefore charges the WHOLE spread against BURY with no float side at all.
 * That was defensible at the 1 m module, where a footprint's worst spread
 * measured 0.127 m against a 0.50 m bound. At the 4 m module of DW-32 the same
 * ground at the default spawn spreads 1.012 m, so every cell was refused with
 * "the ground stands 1.01 m into it" and only 19.8% of 81 sampled origins out to
 * 6.4 km were buildable at all. A constant that encodes "the error all lands on
 * one side" is a scale assumption in disguise.
 *
 * THE RULE IS: FILL THE BURY BUDGET FIRST, THEN SPILL INTO FLOAT. Formally
 * `d = clamp(hi - buryM, lo, lo + floatM)`, which has three regimes and they are
 * the three cases worth naming:
 *
 *   spread <= BURY            d = lo. IDENTICAL to the old rule. Gentle ground
 *                             keeps burying its whole error, which is the state
 *                             a base looks best in.
 *   BURY < spread <= B+FLOAT  d = hi - BURY. The bury budget is spent to the
 *                             last millimetre and only the remainder hangs.
 *   spread > BURY + FLOAT     d = lo + floatM, and the placement is REFUSED by
 *                             `checkGround`. The plane is left where the float
 *                             side is exactly satisfied so the refusal names the
 *                             high ground, which is the half a player can cut.
 *
 * WHY BIAS TOWARDS BURYING rather than splitting the error proportionally.
 * DW-33 permits either; the two accept exactly the same ground, because
 * feasibility is `spread <= FLOAT + BURY` for every choice of `d` inside the
 * band. What differs is which side the SECOND and later cells of the same site
 * then land on, and the two sides are not equally rescuable: a float that
 * exceeds the bound can be carried by a neighbour (`CANTILEVER_STOREYS` below,
 * DW-32), while a bury that exceeds it has no relief but a shovel. So the
 * precious budget is spent first and the renewable one is spilled into.
 */
export function fitPlane(lo: number, hi: number, floatM: number,
                         buryM: number): number {
  const k = 1 - PLANE_MARGIN;
  return Math.max(lo, Math.min(hi - buryM * k, lo + floatM * k));
}

/**
 * How much of each bound the fit refuses to spend. THIS IS NOT A FUDGE, AND THE
 * FIRST VERSION WITHOUT IT WAS BROKEN.
 *
 * Spending the bury budget "to the last millimetre" means the fitted plane puts
 * the worst point at EXACTLY `buryM`, and `checkGround` then re-derives that
 * same number from a different arithmetic path: both sides are `ground(x) -
 * |x|`, a difference of two doubles of magnitude 600,000, so the cancellation
 * carries about 1e-10 m of error. A slack ratio of 1 + 2e-10 is greater than 1,
 * and the placement is refused. On the coarse height field this lane started
 * against, spreads were usually inside the bury bound so the exact-fit branch
 * was rarely taken and the defect hid; the moment the terrain lane gave the
 * noise stack real detail (WG-25) it became the NORMAL case and every candidate
 * site in an 88-site scan refused with "the ground stands 0.50 m into it"
 * against a 0.50 m bound.
 *
 * 2% rather than an epsilon, because there are two problems here and only one
 * of them is arithmetic. A plane that lands exactly on the bury bound also
 * leaves the SECOND cell of the site no room at all: any neighbour whose ground
 * is a millimetre higher than the founding cell's own high point is refused. The
 * margin costs 10 mm of bury on a 0.50 m bound, which is invisible, and buys
 * both the numerical headroom and a base that can grow.
 */
export const PLANE_MARGIN = 0.02;

/**
 * DW-32's cantilever, in storeys of clear air under a carried deck.
 *
 * A deck with an orthogonally adjacent deck on the same level and site is held
 * up by its neighbour, so the float bound stops being about daylight under a
 * slab and starts being about how far an overhang may reach. One STOREY is the
 * honest unit: it is the height at which the drop under a deck stops reading as
 * a gap and starts reading as a level, and it is measured off the assets
 * (`module.storey`, 4.00 m) rather than typed, so it follows the Blender module.
 * BURY IS NOT RELAXED: a neighbour can carry weight, it cannot move soil.
 */
export const CANTILEVER_STOREYS = 1;

/**
 * How many consecutive carried cells a base may walk out over a drop.
 *
 * DW-32 asks for "a bounded unsupported run", and without a bound a player can
 * step one deck at a time across a canyon for ever, which is the failure the
 * pillar is meant to make honest rather than to enable. Three cells is 12 m at
 * the 4 m module: enough to finish a platform off the end of a slope or bridge a
 * gully, and short enough that crossing anything real means founding a second
 * site or standing something up. The run is counted in CELLS from the nearest
 * deck that genuinely rests on the ground, so a wide platform whose middle is
 * grounded may overhang three cells on every side at once.
 */
export const MAX_CANTILEVER_CELLS = 3;
