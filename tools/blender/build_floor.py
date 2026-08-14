"""
build_floor.py - Tier-0 structural floor deck, which is ALSO the ceiling.

    ~/.local/bin/blender501 --background --python tools/blender/build_floor.py

Produces assets/models/dist/structures/floor.glb.

Footprint 4 x 4 m, height 0.50 m (structure_common.DECK_H) - the same envelope
as the foundation, because a deck is a deck: a floor that was thinner than a
foundation would put the storey pitch at two different numbers depending on
which one you stood on, and the whole point of the module is that it is one
number.

CEILING = FLOOR, DELIBERATELY. There is no ceiling.glb. Storey N's ceiling is
storey N+1's floor: the same part, the same origin, placed at z = 4 (N + 1).
That is why the ribs are on the UNDERSIDE and the plate is on top - the part is
authored to be seen from both sides at once, plate from above and ribbed
structure from below, which is exactly what a real deck looks like. Shipping a
second, flipped file would double the payload to make the same picture.

READ. A steel deck plate on a perimeter beam frame over a rib grid. Distinct
from the foundation on purpose: stone-and-kerb means ground, steel-and-beam
means suspended, and a player should be able to tell from the material alone
whether the thing under their feet is on soil or over a drop.

WHAT THE FOUR-METRE CELL CHANGED (DW-32). Two parallel ribs spanned a 1 m deck;
they do not span four. The underside is now a WAFFLE: three ribs each way on the
1 m voxel lines, which is the honest structure for a 4 m square panel carried
only on its edges, and which is the thing a player standing underneath actually
sees. The beam depth stayed at 0.40 because DECK_H stayed at 0.50, so the beam
is now 4.00 / 0.40 = 10:1 on span, which is what a real deck beam is.

--------------------------------------------------------------------------
RN-1602, THE SE FORM PASS, AND IT IS AN ENTIRELY 15 mm PASS
--------------------------------------------------------------------------
THIS ASSET IS DETAILED INSIDE ONE CASCADE-0 TEXEL AND NOTHING ELSE WAS ON THE
TABLE. A deck is placed once per cell per storey, so it is the second most
numerous structural part after the wall, and its shadow multiplier is worth
more than any greeble on it. Cascade 0 is 15.47 mm per texel and
`check_shadow_lod` measures every LOD0 VERTEX against LOD1's SURFACE - whether
or not the vertex is visible, and whether or not it is buried inside a solid.
LOD1 here is four beams and one full 4 x 4 plate. So:

    ANY feature standing more than 15.47 mm off the plate's top face, its
    underside, or a beam's inner face takes this asset from a 1.0x marginal
    multiplier to 2.0x, i.e. doubles what every deck in every base costs the
    shadow pass.

Two things were tried and refused on that measurement, and they are written
down because they are the obvious things to reach for next:
  - CORNER GUSSETS under the beam junctions, which is what a real welded deck
    frame has. The shallowest honest one hangs 100 mm off a beam's inner face.
    Refused.
  - A DEEP RECESSED DECK FIELD, the foundation's 20 mm kerb reveal. 20 mm is
    over the texel by 4.5 mm. The field is recessed 13 mm instead, which is a
    plate course depth, reads the same at the 2 m a player stands at, and
    keeps the multiplier.

WHAT IS ACTUALLY THERE NOW:
  - THE TOP IS COURSED. It was one 4 x 4 sheet, which is the largest blank
    surface in the game and the one a player looks straight down at all game.
    The field is recessed and a perimeter edge band plus a centreline cross
    stand at the full 0.50, so the module height is set by the STEEL and the
    tile boundary is legible from above - the same argument the foundation's
    kerb makes, in the deck's own material.
  - THE CROSS IS `SteelWorn`, and that is this asset's `paintchip` consumer on
    RN-1553's rule: a coating that failed where the thing gets HIT. The two
    centrelines of a 4 m deck are where people walk, because they are the
    lines that join one cell's doorway to the next.
  - THE RIBS LAND ON SPLICE PLATES. A waffle rib butted against a beam with
    nothing at the joint is a rib that was drawn rather than fitted; each beam
    now carries a riveted splice at the rib landing, on the beam's INNER face,
    which is the face a player standing underneath is looking at.

THE RIB TOPS MOVED 5 mm, from 0.400 to 0.395, and that is the whole reason this
asset is at 1.0x rather than 2.0x. They were 20.00 mm above the plate's own
underside, which was the pre-existing tier deviation and belongs to nobody's
pass; it is inside the texel now.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import machine_form as mf  # noqa: E402
import structure_common as sc  # noqa: E402

NAME = "Floor"
OUT = of.dist_path("structures", "floor.glb")

W = D = sc.CELL
H = sc.DECK_H

BEAM_W = 0.14
PLATE_Z0 = 0.38                  # plate z 0.38 .. 0.50
BEAM_H = PLATE_Z0                # z 0.00 .. 0.38, so the base is on z = 0 and
# THE BEAM STOPS EXACTLY WHERE THE PLATE STARTS, WHICH IS FS-88 AND IS THE
# WHOLE DEFECT. The beam used to be 0.40 deep and the plate started at 0.38, so
# the two overlapped through a 20 mm band. That is harmless in the middle of
# the tile, where one is buried inside the other, and it is not harmless at the
# EDGE: the beams' outer faces are on +/-2.0 because the beams are what two
# neighbouring decks butt against, and the plate is full 4 x 4 because it is the
# walking surface and a plate that stopped short would leave a 0.14 m trench
# along every seam. So through those 20 mm, steel and dark steel had two
# outward-facing faces on the same four planes, and check_coplanar.py measured
# 36 pairs per LOD, 72 in the file, on the most-seen face in the structure kit.
#
# Neither part could move sideways, so the OVERLAP had to go. It was buying
# nothing: this is one solid assembly, not a bolted joint, and 20 mm of
# interpenetration does not make it stiffer. Now the beam's top face and the
# plate's underside are a back-to-back contact, which no depth test arbitrates.
#
# The beam is consequently 4.00 / 0.38 = 10.5:1 on span rather than 10:1. The
# docstring's claim is "what a real deck beam is", and 10.5:1 is equally that;
# the ratio was never the constraint, DECK_H was.
RIB_W = 0.10
RIB_H = 0.28                     # z 0.115 .. 0.395, tucked up inside the frame
RIB_SPAN = W - 2.0 * BEAM_W      # 3.72, beam inner face to beam inner face
RIB_AT = (-1.0, 0.0, 1.0)        # on the 1 m voxel lines, three bays each way

FIELD_Z1 = H - 0.013             # 0.487, the walking surface: recessed by one
#                                  `seam` layer, which is a plate course depth
#                                  and is 2.5 mm inside cascade 0's texel.
BAND_W = 0.30                    # the perimeter edge band, at the full 0.50
CROSS_W = 0.18                   # the walked centreline cross, in SteelWorn
CROSS_Z0 = PLATE_Z0 + 0.010      # 0.39: the cross starts INSIDE the field, so
#                                  its underside is on no plane the field owns
#                                  and is 10 mm off LOD1's own 0.38.
BEAM_FACE = sc.HALF - BEAM_W     # 1.86, a beam's inner face


def _ribs(mb):
    """The waffle. Ribs run BOTH ways because a 4 m panel supported on four
    edges spans both ways; a one-way rib set would be a lie about the load and
    would read as one from underneath, which is where this face is seen from.

    RN-1602 MOVED THE TOP 5 mm. The offset was +0.02, putting the rib top on
    z = 0.400 against the plate's own underside at 0.380, and that 20.00 mm was
    this asset's entire LOD1 deviation before a triangle of the form pass
    existed. At +0.015 the tier is 15.00 mm, inside cascade 0, and the deck
    costs the shadow pass half what it used to."""
    for v in RIB_AT:
        mb.box((RIB_SPAN, RIB_W, RIB_H), (0, v, PLATE_Z0 - RIB_H * 0.5 + 0.015),
               "SteelDark")
        mb.box((RIB_W, RIB_SPAN, RIB_H), (v, 0, PLATE_Z0 - RIB_H * 0.5 + 0.015),
               "SteelDark")


def _beams(mb):
    """Perimeter beams. Outer faces exactly on +/-2.0: the beams, not the plate,
    are what two neighbouring decks butt against."""
    for s in (-1, 1):
        mb.box((W, BEAM_W, BEAM_H),
               (0, s * (sc.HALF - BEAM_W * 0.5), BEAM_H * 0.5), "SteelDark")
        mb.box((BEAM_W, D, BEAM_H),
               (s * (sc.HALF - BEAM_W * 0.5), 0, BEAM_H * 0.5), "SteelDark")


def _splices(mb):
    """A riveted splice plate on each beam's INNER face, at the rib landing.

    ON THE INNER FACE AND NOWHERE ELSE, because the outer face is the tiling
    plane: two decks butt on +/-2.0 and a 13 mm strap there would hold every
    pair of neighbours 13 mm apart. `Face(limit=+/-HALF)` refuses it by name,
    which is the assertion doing its job rather than this comment doing it."""
    for axis, sign in (("Y", 1), ("Y", -1), ("X", 1), ("X", -1)):
        # `limit=None`, and Face's own docstring is the authority on when that
        # is correct: "unbounded, which is correct only for a face that looks
        # into a recess". A beam's inner face points INWARD, so `part` walks
        # away from +/-2.00 and cannot reach it; the first draft passed the
        # footprint half-width anyway and the module refused the build,
        # correctly, because that limit was 3.85 m behind the face.
        face = mf.Face(axis, -sign, sign * BEAM_FACE,
                       name="deck beam %s%+d" % (axis, sign))
        for u in RIB_AT:
            mf.seam_h(mb, face, (0.24,), u - 0.17, u + 0.17, 0.26, "Steel")
            mf.bolt_run(mb, face, u - 0.11, u + 0.11, 0.24, 2, 0.048,
                        "SteelLight", kind="rivet")


def _topside(mb):
    """The recessed field, the perimeter edge band and the walked cross.

    THE FIELD STOPS AT +/-1.70 AND THE BAND CARRIES THE TILE EDGE, which is a
    correction RN-1602 measured rather than designed. The first draft left the
    field full 4 x 4 and stood the band on top of it, and the band's underside
    then overlapped the field's SIDE face through a 1.3 mm strip on x = +/-2.00
    and z = +/-2.00: 20 same-facing pairs on the tile boundary, i.e. on the one
    plane in this kit where two neighbouring decks meet and any flicker is
    doubled. Handing the edge to the band alone also makes the whole boundary
    one material, `SteelDark`, the same as the beams under it, so the seam
    between two decks reads as one continuous kerb rather than as a steel plate
    with a dark line drawn on it.

    EVERY z HERE IS INSIDE ONE CASCADE-0 TEXEL of LOD1's plate, which is what
    the docstring's 15.47 mm paragraph is about: the field top is 13 mm below
    LOD1's 0.50, the cross underside is 10 mm above LOD1's 0.38, and the band
    shares both of LOD1's own planes exactly."""
    mb.box((W - 2.0 * BAND_W, D - 2.0 * BAND_W, FIELD_Z1 - PLATE_Z0),
           (0, 0, (PLATE_Z0 + FIELD_Z1) * 0.5), "Steel")
    for s in (-1, 1):
        mb.box((W, BAND_W, H - PLATE_Z0),
               (0, s * (sc.HALF - BAND_W * 0.5), (PLATE_Z0 + H) * 0.5),
               "SteelDark")
        mb.box((BAND_W, D - 2.0 * BAND_W, H - PLATE_Z0),
               (s * (sc.HALF - BAND_W * 0.5), 0, (PLATE_Z0 + H) * 0.5),
               "SteelDark")
    # 40 mm short of the field's own edge at each end, deliberately: run out to
    # exactly +/-1.70 and the cross's end faces land ON the field's end faces
    # (16 same-facing pairs, measured); run INTO the band and its top face
    # lands on the band's (the same 16 on a different plane). Stopping short is
    # the only one of the three that is neither, and a walked strip that stops
    # short of the kerb is what a walked strip does.
    for size in ((W - 2.0 * BAND_W - 0.08, CROSS_W),
                 (CROSS_W, D - 2.0 * BAND_W - 0.08)):
        mb.box((size[0], size[1], H - CROSS_Z0), (0, 0, (CROSS_Z0 + H) * 0.5),
               "SteelWorn")


def build_lod0(root):
    mb = of.MeshBuilder()
    _beams(mb)
    _ribs(mb)
    _splices(mb)
    _topside(mb)
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    _beams(mb)
    mb.box((W, D, H - PLATE_Z0), (0, 0, (PLATE_Z0 + H) * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, H), (0, 0, H * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root,
                         role="SteelDark")
    sc.deck_sockets(root)

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    sc.report_bounds(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
