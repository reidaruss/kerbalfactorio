"""
build_foundation.py - Tier-0 structural foundation.

    ~/.local/bin/blender501 --background --python tools/blender/build_foundation.py

Produces assets/models/dist/structures/foundation.glb.

Footprint 4 x 4 m, height 0.50 m (structure_common.DECK_H). The ground-contact
deck: the thing a player levels terrain for and builds a base on top of.

RESCALED 2026-07-26 (DW-32). The plan module went 1.00 -> 4.00 m and DECK_H did
NOT move, so this part went from a 2:1 pad to an 8:1 slab. That is the correct
answer rather than a compromise: a 4 m span carried on half a metre of deck is
what a real slab looks like, and scaling the thickness with the plan would have
given a 2 m plinth that reads as a bunker foundation for a shed.

READ. A poured stone pad on a stepped footing, edged with a steel kerb. The
kerb is not decoration: it is what makes the tile boundary legible, so a
20 x 20 m platform reads as a grid of five placed modules rather than as one
grey sheet, and a player can see where the next foundation goes without a ghost.

WHAT THE FOUR-METRE CELL CHANGED. The kerb had to get wider, because 0.11 m of
edge on a 4 m tile is 2.7 percent of the module and disappears at the distance
the kerb exists to work at; 0.34 m holds the same 8-ish percent the 1 m tile
had. And a 4 x 4 m field of flat stone is a big empty rectangle, so the deck
carries a steel CROSS on the cell centrelines, splitting it into four 1.7 m
quadrants. That cross is the same "recessed field inside a frame" language the
wall panel uses, it lands on the 2 m half-cell so a platform shows a regular
sub-grid, and it is what gives the eye something to measure 4 m against.

TILING. The footing and the body are inset; only the kerb and the cross reach
the full 4.00 m, so two neighbours meet on the kerb line and show a shallow
reveal below it. That reveal is free (the inset geometry was going to be there
anyway) and it is what stops a large pad from looking like a single extruded
box. The stone field sits 0.02 m below the kerb top, so the module height is set
by the steel and by nothing else.

--------------------------------------------------------------------------
RN-1603, THE SE FORM PASS
--------------------------------------------------------------------------
THE FOUNDATION IS WHERE A BASE STARTS AND IT IS THE PART A PLAYER STANDS ON
LONGEST. It had a kerb, a cross and 11.6 square metres of flat stone. What was
missing was not surface, it was PURPOSE: nothing on it said what a foundation
is FOR, which is holding machines down and carrying water away.

  - FOUR ANCHOR PADS, one per quadrant, on the 0.85 m offsets. A machine that
    is bolted to a slab is bolted to something, and the pad with its recessed
    socket plate is that something. They also break the four blank quadrants
    the cross created, which the cross itself could not do.
  - A DRAIN CHANNEL along the -Y kerb, with its grating. A poured pad outdoors
    has a fall and a channel or it has a puddle, and this is the ONLY
    asymmetric feature in the structural set - every other part in the kit is
    mirror-symmetric in both plan axes, which is what makes a platform of them
    read as extruded. One tile edge that differs is one edge a player can
    orient by.
  - CORNER CASTINGS in `SteelWorn`, this asset's `paintchip` consumer. A kerb
    corner is what a cart, a crate and a boot actually hit, on RN-1553's rule,
    and a heavier casting there is also what a real kerb has for exactly that
    reason.

THE 20 COPLANAR PAIRS ARE CLOSED AT THE CAUSE (RN-1603) and it is the floor's
cause on a different asset: the kerb, the cross and the stone field all started
at z = 0.36, so 20 downward faces of two materials shared one plane. The steel
is founded 60 mm lower now, at z = 0.30, buried in the body it is cast into,
which is where a kerb's own root physically is. `structures/foundation: 20` is
deleted from check_coplanar.ALLOWED in this commit.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import structure_common as sc  # noqa: E402

NAME = "Foundation"
OUT = of.dist_path("structures", "foundation.glb")

W = D = sc.CELL
H = sc.DECK_H

FOOTING_H = 0.12                 # z 0.00 .. 0.12
BODY_Z0, BODY_Z1 = 0.10, 0.38    # overlaps the footing by 0.02, never touches
DECK_Z0 = 0.36                   # deck plate, z 0.36 .. 0.50
FIELD_Z1 = 0.48                  # stone field, 0.02 below the kerb top
STEEL_Z0 = 0.30                  # RN-1603: every steel part is FOUNDED here,
#                                  0.06 below the stone field it edges, so no
#                                  downward face of the kerb, the cross or a
#                                  casting can share a plane with the stone's.
#                                  0.30 is inside the body (0.10 .. 0.38),
#                                  which is where a kerb's root actually is.
KERB_W = 0.34                    # 0.30 of kerb + 0.04 of overlap into the core
CROSS_W = 0.16                   # centreline strips, on the 2 m half-cell
CAST_W = 0.46                    # the corner castings
PAD_AT = 0.85                    # anchor pads, one per quadrant
PAD_W = 0.38
DRAIN_Y = -(sc.HALF - KERB_W - 0.13)     # the channel, inboard of the -Y kerb

FOOTING = 3.80                   # inset 0.10 per side
BODY = 3.52                      # inset 0.24
FIELD = 3.40                     # inset 0.30, so the kerb overlaps it by 0.04


def build_lod0(root):
    mb = of.MeshBuilder()
    mb.box((FOOTING, FOOTING, FOOTING_H), (0, 0, FOOTING_H * 0.5), "MasonryDark")
    mb.box((BODY, BODY, BODY_Z1 - BODY_Z0), (0, 0, (BODY_Z0 + BODY_Z1) * 0.5),
           "Masonry")
    mb.box((FIELD, FIELD, FIELD_Z1 - DECK_Z0), (0, 0, (DECK_Z0 + FIELD_Z1) * 0.5),
           "Masonry")
    # Steel kerb: four strips whose OUTER faces are exactly on +/-2.0, so the
    # module dimension is set by the kerb and by nothing else. They cross at the
    # corners on purpose; overlapping solids never z-fight, coincident faces can.
    for s in (-1, 1):
        mb.box((W, KERB_W, H - STEEL_Z0),
               (0, s * (sc.HALF - KERB_W * 0.5), (STEEL_Z0 + H) * 0.5),
               "SteelDark")
        mb.box((KERB_W, D, H - STEEL_Z0),
               (s * (sc.HALF - KERB_W * 0.5), 0, (STEEL_Z0 + H) * 0.5),
               "SteelDark")
    # The centreline cross. Full length, so it runs kerb to kerb and a platform
    # shows an unbroken 2 m sub-grid across every tile boundary.
    mb.box((W, CROSS_W, H - STEEL_Z0), (0, 0, (STEEL_Z0 + H) * 0.5), "SteelDark")
    mb.box((CROSS_W, D, H - STEEL_Z0), (0, 0, (STEEL_Z0 + H) * 0.5), "SteelDark")
    # Corner castings. Sunk 20 mm below the kerb top rather than flush with it,
    # so the casting's own top is on no plane the kerb owns and a player reads a
    # separate part rather than a colour change.
    # INSET 20 mm FROM THE TILE EDGE, which is the difference between a casting
    # and 56 same-facing pairs. Flush with +/-2.00 its four outer faces were on
    # the kerb's own outer faces, on the exact plane where two neighbouring
    # foundations meet; and its top was on the stone field's 0.48. The kerb
    # keeps the edge, the casting sits inside it, and both of its own planes
    # are its own.
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box((CAST_W, CAST_W, 0.14),
                   (sx * (sc.HALF - 0.02 - CAST_W * 0.5),
                    sy * (sc.HALF - 0.02 - CAST_W * 0.5), 0.39), "SteelWorn")
    # Anchor pads: the thing a machine is bolted to. The socket plate is INSIDE
    # the pad on all four sides and 20 mm shy of its top, which is what a
    # recessed fixing is and is why neither part can share a plane with the
    # other.
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box((PAD_W, PAD_W, 0.085), (sx * PAD_AT, sy * PAD_AT, 0.4425),
                   "SteelDark")
            mb.box((PAD_W - 0.14, PAD_W - 0.14, 0.015),
                   (sx * PAD_AT, sy * PAD_AT, 0.4925), "SteelLight")
    # The drain channel and its grating, on the -Y edge only.
    mb.box((W - 2.0 * KERB_W, 0.26, H - 0.34), (0, DRAIN_Y, (0.34 + H) * 0.5),
           "SteelDark")
    mb.box((W - 2.0 * KERB_W - 0.10, 0.17, H - 0.435),
           (0, DRAIN_Y, (0.435 + H) * 0.5 - 0.015), "SteelLight")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    # The footing STEP is carried here, and the 12 triangles are measured: the
    # body's own corner at z = 0.10 sat 100.00 mm inside a single 3.80 box,
    # which was this tier's whole deviation before the form pass and belongs to
    # nobody's. A tiling part's far LOD has to be the same SIZE (that is what
    # the `parts` block in contracts.json checks); it does not have to be one
    # box, and here it cannot be.
    mb.box((FOOTING, FOOTING, FOOTING_H), (0, 0, FOOTING_H * 0.5), "Masonry")
    mb.box((BODY, BODY, BODY_Z1 - BODY_Z0), (0, 0, (BODY_Z0 + BODY_Z1) * 0.5),
           "Masonry")
    # RN-1603. The steel slab starts at STEEL_Z0 and not at BODY_Z1, for the
    # same reason build_floor's rib tops moved 5 mm: LOD0's kerb, cross and
    # castings are now founded 80 mm below where this tier's steel used to
    # begin, and a tier that does not reach them measures the whole 80 mm.
    mb.box((W, D, H - STEEL_Z0), (0, 0, (STEEL_Z0 + H) * 0.5), "SteelDark")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, H), (0, 0, H * 0.5), "Masonry")
    return mb, mb.build(NAME + "_LOD2", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root,
                         role="Masonry")
    sc.deck_sockets(root)

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    sc.report_bounds(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
