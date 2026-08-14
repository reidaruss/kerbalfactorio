"""
belt_common.py - THE FABRICATED RAIL SECTION, AND THE SEAM IT HAS TO HOLD.

NOT a build script (no `build_` prefix), so the "run every build_*.py" loop
skips it. Imported by build_belt_segment.py, build_belt_end_cap.py and
belt_curve_common.py, which are the four belt tiles in the game.

--------------------------------------------------------------------------
WHY THIS MODULE EXISTS AT ALL (RN-1622).

RN-1563 to RN-1565 gave the STRAIGHT tile a real fabricated frame rail -
flanges at the edges, a 15 mm lightening pocket between them, a mid-span
stiffener, solid full-section end blocks, and a `SteelWorn` top flange - and
left the other three tiles wearing the extruded bar it replaced. A line of
belt going into a corner therefore changed section halfway along, which is the
one thing a modular kit may not do.

That pass's own docstring names the reason it could not simply be copied:

    "Rails, deck width and deck height are shared with belt_curve_common.py so
     that a curve butted against a straight tile has no seam"

except that they were not SHARED, they were TRANSCRIBED. `RAIL_W = 0.10`,
`DECK_TOP = 0.25` and `SLAT_T = 0.030` were written out three times in three
files, each with a comment saying it matched the other two. Three copies of a
number whose whole job is to be equal is the FS-73 fixture defect and the
`FOREST_FLOOR` density defect over again: the copies agree until one of them
is edited, and nothing anywhere reports the day they stop agreeing.

So the section moves here ONCE, the four tiles import it, and a future edit to
the rail is an edit to the rail rather than to a quarter of it.

--------------------------------------------------------------------------
THE SEAM IS THE HARD CONSTRAINT AND IT IS WHY THE END BLOCKS EXIST.

Every tile boundary in this game is a plane at the edge of a 1 m cell, and two
tiles butted across it must present the SAME cross-section or the join grows a
step. The pocket is 15 mm deep, so a rail that is recessed all the way to its
end puts a 15 mm notch on the boundary plane and every straight-to-curve
junction in a factory grows a visible slot.

`rail_straight` and `rail_arc` therefore both END SOLID: a full-section block
occupies the last stretch of rail at each end, so what lands on the boundary
plane is the same solid RAIL_W x H rectangle it has always been, and what a
player sees mid-tile is a lightening pocket between two stiffened ends, which
is what a fabricated conveyor frame looks like anyway.

That is a claim about the shipped bytes, and it is checked as one: the seam
cross-section of all four tiles is extracted from the exported .glb and
compared against the pre-change build, rather than argued from the source.

--------------------------------------------------------------------------
THE POCKET DEPTH IS THE SHADOW CASCADE'S NUMBER, INHERITED UNCHANGED.

`check_shadow_lod.py` measures LOD0's VERTICES against the tier's SURFACE and
cascade 0 is 15.47 mm per texel, so a web recessed 15.0 mm puts every vertex
the fabricated rail adds inside cascade 0's own texel of the plain box each
tile's LOD1 already draws. No proxy needs re-authoring, no tile's shadow
ladder moves, and every cascade goes on drawing the cheap tier. A 25 mm pocket
would look no different and would cost cascade 0 the whole LOD0 mesh on every
belt in the base. The number is the instrument's, not taste.
"""

import math

# --- the seam dimensions. ONE COPY. -----------------------------------------
# Every one of these was previously written out in two or three build scripts
# with a comment claiming it matched the others.
W = L = 1.00                    # cell footprint, X and flow
H = 0.30                        # rail height, and the tile's own height
RAIL_W = 0.10                   # rail width across the flow
DECK_W = W - 2 * RAIL_W         # 0.80, the rubber deck between the rails
DECK_TOP = 0.25                 # top of the rubber deck
SLAT_T = 0.030                  # slat thickness
RIDE_TOP = DECK_TOP + SLAT_T    # 0.28, the surface cargo rests on
ROLLER_R = 0.055

# --- the fabricated section (RN-1563 to RN-1565, now shared) ----------------
RECESS = 0.015                  # pocket depth: cascade 0 is 15.47 mm/texel
RAIL_END = 0.09                 # solid block at each end of a STRAIGHT rail
RAIL_MID = 0.07                 # the mid-span stiffener between pockets
CHORD_T = 0.07                  # top flange thickness
CHORD_B = 0.06                  # bottom flange thickness
RAIL_X = (W - RAIL_W) * 0.5     # 0.45, a straight rail's centre line
WEB_Y = L * 0.5 - RAIL_END      # 0.41, where a straight tile's pockets stop


def rail_straight(mb, sx, length=L, role="Steel", role_flange="SteelWorn"):
    """One fabricated frame rail running along the flow axis: two end blocks, a
    top and bottom flange, a recessed web between them and a mid-span
    stiffener.

    THE TOP FLANGE IS THE ONE PART OF THIS GAME'S PAINTED STEEL THAT IS
    CERTAIN TO BE WORN, which is why it is this asset's `paintchip` consumer
    and why the family is worth a draw call at all. It is the edge cargo is
    dropped onto, the edge a player walks along, and the edge every transfer
    scuffs, and there are 57 of these in the reference base against one
    smelter's worth of any other painted surface. `SteelWorn` carries Steel's
    own hex, so the flange is the SAME COLOUR as the rail under it and differs
    only in how it takes light: chipped to bare alloy along the top arris,
    coated everywhere the plate is flat. A different colour here would have
    read as a stripe, which is the opposite of wear.

    EVERY PART OF THIS RAIL IS EITHER ON x = +/-0.50 OR RECESSED EXACTLY
    `RECESS` FROM IT, so the cell edge is held by four separate solids and the
    proxy stays a plain box. Nothing here may stand PROUD: a belt that
    overhangs its footprint z-fights the tile beside it on the grid."""
    x = sx * RAIL_X
    web_y = length * 0.5 - RAIL_END
    for sy in (-1, 1):
        mb.box((RAIL_W, RAIL_END, H),
               (x, sy * (length * 0.5 - RAIL_END * 0.5), H * 0.5), role)
    mb.box((RAIL_W, RAIL_MID, H - CHORD_T - CHORD_B),
           (x, 0.0, (CHORD_B + H - CHORD_T) * 0.5), role)
    mb.box((RAIL_W, 2.0 * web_y, CHORD_B), (x, 0.0, CHORD_B * 0.5), role)
    mb.box((RAIL_W - RECESS, 2.0 * web_y, H - CHORD_T - CHORD_B),
           (x - sx * RECESS * 0.5, 0.0, (CHORD_B + H - CHORD_T) * 0.5), role)
    mb.box((RAIL_W, 2.0 * web_y, CHORD_T), (x, 0.0, H - CHORD_T * 0.5),
           role_flange)


def rail_arc(mb, r_in, r_out, centre, a0_deg, a1_deg, segments=6,
             role="Steel", role_flange="SteelWorn"):
    """The same section swept along an arc: a curve tile's outer rail.

    THE SUBDIVISION IS THE DECK'S AND IT MAY NOT BE CHOSEN FREELY, which is the
    one real difference from the straight case. A curve's deck ends on the same
    cylinder the rail begins on (r = 0.90), so deck and rail are coincident
    surfaces there and are back-to-back only while they are faceted the SAME
    WAY. Give the rail 8 facets against the deck's 6 and the two disagree by up
    to 6 mm around the sweep, which opens a sliver of daylight between the belt
    and its own frame in four places. So every part built here is cut from the
    caller's `segments` lattice and the end blocks are whole segments of it.

    WHICH COSTS THE MID-SPAN STIFFENER, AND THAT IS STATED RATHER THAN HIDDEN.
    A solid end at each end plus a symmetric pocket plus a central stiffener
    needs an ODD number of pocket segments, i.e. 1 + n + 1 + n + 1 = segments
    with n whole, which 6 cannot satisfy. The choice was a stiffener at the
    cost of an asymmetric rail, or a symmetric rail with none. The rail is
    symmetric: a curve tile is mirrored to make its handed twin (see
    build_belt_curve_l/r), so an asymmetric section would read one way going
    left and the other way going right on the same factory floor, and that is
    a worse artefact than a missing stiffener on a 0.99 m span.

    The end blocks are one whole segment at each end, so a curve's solid ends
    are longer than a straight tile's 0.09 m. That is not a mismatch at the
    join: what the seam sees is a SOLID FULL SECTION on both sides of the
    boundary either way, which is the only thing the seam is a claim about."""
    n = max(3, int(segments))
    step = (a1_deg - a0_deg) / float(n)
    cx, cy, cz = centre

    # The two solid ends: one whole segment of the caller's lattice each.
    for a in (a0_deg, a1_deg - step):
        mb.arc_band(r_in, r_out, H, (cx, cy, cz + H * 0.5), a, a + step, 1,
                    role)

    # The pocketed span between them, on the same lattice.
    p0, p1, pn = a0_deg + step, a1_deg - step, n - 2
    mb.arc_band(r_in, r_out, CHORD_B, (cx, cy, cz + CHORD_B * 0.5),
                p0, p1, pn, role)
    mb.arc_band(r_in, r_out - RECESS, H - CHORD_T - CHORD_B,
                (cx, cy, cz + (CHORD_B + H - CHORD_T) * 0.5), p0, p1, pn, role)
    mb.arc_band(r_in, r_out, CHORD_T, (cx, cy, cz + H - CHORD_T * 0.5),
                p0, p1, pn, role_flange)
