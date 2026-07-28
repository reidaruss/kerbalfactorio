"""build_detail_cards.py - the highest-density ground cover in the game.

    blender --background --python tools/blender/build_detail_cards.py

Produces assets/models/dist/props/detail_cards.glb (ASSET-SPECS 3.2).

These seven are NOT biome props. They are the layer under the biome props: the
thing the renderer stamps by the square metre across every vegetated chunk,
where a biome prop is placed by the handful. Their instance count is one to
two orders of magnitude above anything else in the batch, so every rule here
is about cost:

  * 18 to 42 triangles each, not the 60 to 400 the biome props run at.
  * Four materials for the whole file, so the entire detail layer is four
    draws per chunk no matter how many blades are in it.
  * A REBUILT LOD2, not a decimate. See the RN-45 note below: the claim that
    there is no distance at which a 0.5 m tuft is worth a second mesh was
    measured and is false, because the understorey is scattered by the square
    metre out to 78 m and 48.7% of its instances sit beyond the renderer's
    LOD2 switch at 45 m.
  * Nothing collides. Obviously.

TWO SPEC CORRECTIONS, both flagged in ASSET-SPECS 3.2.

1. NOT ALPHA-TESTED CROSSED QUADS. The spec called these crossed quads drawn
   with alpha test. There is no texture pipeline (section 2.8 defers one until
   the texture payload would cross 1 MB, and 45 untextured props never get
   close), and an untextured crossed quad renders as a SOLID RECTANGLE
   standing in the grass. Five triangles of actual tapered blade is cheaper
   than the alpha-test fragment cost would have been, needs no UVs, no mask
   authoring and no KTX2 step, and is the only version that reads correctly
   with the materials this game actually has.

2. NOT "the only double-sided meshes outside glass and water". OF_Leaf and
   OF_LeafDry have been in of_lib.DOUBLE_SIDED since the trees shipped,
   because a single-sided leaf disappears from half the angles you look at it
   from. This file uses the same two roles and adds nothing new.

Materials (4): OF_Grass, OF_LeafDry, OF_Rock, OF_Leaf.

RN-48 note (2026-07-28): THREE UNDERSTOREY SPECIES ADDED, because the ground
was one card shape jittered and nothing else. The first four props are all
upright blade tufts, so a chunk of ground was a field of vertical strokes at
one length; the reason Satisfactory's ground reads as a place is that several
distinct plant SILHOUETTES are mixed, not that any one of them is detailed.
The three added here are chosen to be different from the four and from each
other in silhouette before they are different in anything else:

  * Detail_BroadleafForb   few wide leaves splaying low from a centre. This
                           is the shape that breaks a field of blades.
  * Detail_FlowerSprig     a small tuft with three straw heads standing above
                           it on thin stems: a vertical accent with a colour
                           break at the top, where every other card is one
                           tone from base to tip.
  * Detail_SedgeRosette    many narrow straps radiating almost flat, wider
                           than it is tall, so it FILLS the gaps between the
                           taller cards instead of competing with them.

THE MATERIAL SPEND, which is the real budget (props_common rule 2): three
roles became FOUR, and the one role bought is OF_Leaf on the forb. Every
other new prop reuses what the file already pays for. The argument for
spending it there and nowhere else is about distance: the forb's whole job is
to not read as grass, and by 45 m (where 48.7% of live instances sit, see the
RN-45 note below) the shape difference between a low splay and an upright
tuft is a couple of pixels while a tone difference survives. OF_Leaf is also
the tone the trees and the plains shrub already use, so broad foliage agrees
with itself from the canopy down to the ankle. The sprig's heads take
OF_LeafDry, which is already in the file for card C: straw against green is a
LARGER colour break than any second green would have been, and it costs
nothing. The rosette is OF_Grass and carries its difference entirely in shape,
which is what the budget rule asks for wherever it is possible.

W11 note (2026-07-27): Registry.ts never passes detailCards to loadGlb, so
nothing here is drawn today; the controller is reporting that hook-up
separately. This file gets the minimum needed to stay valid and consistent
with the grass elsewhere: cards A and B moved onto OF_Grass (was OF_Leaf), the
same ground-grass role the plains and forest atlases now use, and their spawn
radius/width moved to the same tight-base, wide-blade ratio the plains fans
use (mass over blade count, see build_props_plains.py) since it costs nothing
extra to keep them consistent. No other change, deliberately: the effort went
to props_plains, props_forest and the two trees.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "DetailCards"
OUT = of.dist_path("props", "detail_cards.glb")


def grass_card_a():
    """Six short blades, three triangles each, based tight and wide so the
    card is a small mass rather than a spread of hairs. The default: this is
    the one that covers a plains chunk end to end."""
    return pc.tuft(6, 0.38, 0.090, 0.030, 1301, bend=0.14, segs=2, droop=0.32,
                   role="Grass", h_var=0.35)


def grass_card_b():
    """Eight taller blades with a real arch, same tight-base logic as A.
    Scattered at maybe a fifth of A's density to break the uniformity, which
    is the only job it has."""
    return pc.tuft(8, 0.60, 0.085, 0.040, 1311, bend=0.26, segs=3, droop=0.40,
                   role="Grass", h_var=0.40, phase=23.0)


def grass_card_c():
    """The dry note. Same shape budget as A, OF_LeafDry instead of OF_Leaf,
    so a chunk can be pushed toward parched by changing the mix ratio and
    nothing else."""
    return pc.tuft(6, 0.44, 0.058, 0.065, 1321, bend=0.18, segs=2, droop=0.30,
                   role="LeafDry", h_var=0.40, phase=41.0)


def broadleaf_forb():
    """Six wide leaves splaying low from one centre: 30 triangles.

    The same blade() the grass uses, driven the other way round. A blade is
    thin, upright and barely bent; this is width 0.24 against height 0.30 (a
    leaf as wide as it is long, where card A runs 0.09 against 0.38), a bend
    larger than the height so the leaf travels further OUT than UP, and a
    droop of 0.62 so the tip comes back down toward the ground. The result is
    a rosette of flat-ish paddles, which is the one silhouette in this file
    that has no vertical stroke in it anywhere."""
    return pc.tuft(6, 0.30, 0.24, 0.045, 1351, bend=0.36, segs=3, droop=0.62,
                   role="Leaf", h_var=0.26, phase=11.0)


def flower_sprig():
    """A five-blade tuft with three straw heads above it: 30 triangles, 15 in
    the tuft and 15 in the heads.

    tuft()'s own heads support does all of it: heads run height * head_scale
    with width * head_width, at random azimuths rather than on the even ring,
    which is what makes them read as three stems that happened rather than as
    a candelabra. head_scale 1.9 is deliberately larger than the 1.45 default
    because the whole point of this prop is the part standing ABOVE the
    foliage line; a head that only just clears the tuft is a head nobody sees.
    OF_LeafDry on the heads, OF_Grass under them.

    head_width IS 0.95 AND WAS 0.42, CHANGED BY LOOKING AT IT. At 0.42 the
    head was 3 cm of straw at its base after fit(), the render showed three
    hairlines, and a hairline is the sub-pixel failure build_props_plains
    already documented and already fixed once: an accent nobody can see is an
    accent that was not worth a triangle, never mind a colour break. At 0.95
    the head is as substantial as a grass blade, which is what makes the straw
    actually reach the eye."""
    return pc.tuft(5, 0.26, 0.085, 0.030, 1361, bend=0.16, segs=2, droop=0.30,
                   role="Grass", h_var=0.30, phase=7.0,
                   heads=3, head_role="LeafDry", head_scale=1.90,
                   head_width=0.95)


def sedge_rosette():
    """Twelve narrow straps radiating almost flat: 36 triangles.

    The gap filler. Bend 0.40 against height 0.20 sends each strap twice as
    far out as up, and droop 0.80 brings the tip back down to a fifth of the
    peak height, so the strap is an arc lying over the ground rather than a
    blade standing in it. Twelve of them, narrow, is the deliberate opposite
    of the forb's six wide ones: the two share a low profile and share nothing
    else, so they do not collapse into the same prop at 15 m.

    "Narrow" is RELATIVE and the first cut got it wrong. Width 0.052 measured
    2.7 cm across after fit(), a third of card A's blade, and rendered as a
    star of hairlines. 0.105 puts a strap at about 5 cm, still half a forb
    leaf and clearly a different plant, and it is the width that makes this
    prop a patch of covered ground rather than a spider."""
    return pc.tuft(12, 0.20, 0.105, 0.028, 1371, bend=0.40, segs=2, droop=0.80,
                   role="Grass", h_var=0.34, phase=29.0)


def pebble_scatter():
    """One broad chip and three shards, 42 triangles, all of them LOW.

    THE OLD VERSION WAS SEVEN FOUR-SIDED PYRAMIDS AND LOOKED LIKE IT. Seven
    single-ring lobes at seg = 4 is, literally, a base quad plus an apex fan:
    a square-footprint cone. Worse, fit() pins the pile's height to the card's
    authored 0.10 m whatever the author wrote, so those seven stones measured
    9 to 19 cm across against 6 to 10 cm tall, a width-to-height ratio of 1.5
    to 2.0. That is the profile of a pyramid and not of a stone, and a render
    of sixteen instances on sand is a field of tiny grey pyramids with no
    other reading available.

    The near pebble is seen from 5 m with the eye 1.7 m up, which is 19
    degrees above the ground and nowhere near the grazing angle the LOD2
    below is designed for. Vertical extent buys nothing at that angle and is
    exactly what made the pyramid; what reads is the OUTLINE, the TOP, and
    where the stone meets the soil. So three levers, each pulled for one of
    those:

      * OUTLINE. seg 6 on the large chip and 5 on the largest shard, never 4,
        so the plan silhouette is not a square; jit 0.48 against the old 0.30
        so the ground contact line is ragged rather than a regular polygon.
      * TOP. The chip gets a SECOND ring at 0.72 of its height carrying 0.74
        of its radius. lobe() always finishes with an apex fan, so the only
        way to not have a point is to hand that fan a large ring to start
        from and little height to cross: the crown is 23% of the stone and
        sits on a plateau three quarters of its width, which reads as a
        broken flat top. That second ring is 16 of the 42 triangles and it is
        the single change that stops the prop reading as a pyramid.
      * BURIAL. It cannot be done by sinking the stones. Parts.fit() rescales
        the pile so its AABB base lands exactly on z = 0, so a negative loc
        z is undone on the deepest stone and lifts every other stone off the
        ground instead. The burial read therefore comes from the profile: the
        widest ring is at z = 0 on every stone, so the stone is broadest
        exactly where the soil meets it and tapers upward from there. Fitted,
        the chip measures 0.51 x 0.31 x 0.10 m and the three shards 0.21 to
        0.11 m across by 0.043 to 0.029 m tall: a width-to-height ratio of
        3.6 to 5.1 where the old cones ran 1.5 to 2.0.

    Four stones and not seven, because 42 triangles is a HARD ceiling and not
    the 60 in the contract: the file's max_tris_total is 245 and the build
    already spends all 245, so a triangle added here is a triangle that has
    to come off another card. Four stones at 22 + 8 + 6 + 6 buys the two-ring
    chip and a real size hierarchy (a half-metre slab, a 21 cm shard, two
    crumbs) out of the same budget seven identical cones were spending.

    The three shards stay single-ring, and they are not pyramids either,
    because `lean` scaled to the stone's own radius throws the apex well off
    centre: one steep face, one long shallow ramp, which is what a broken
    chip of rock looks like. Everything varies off the same seeded stream the
    old version used, so the build stays byte-reproducible.
    """
    p = hc.Parts()
    nxt = hc.rng(1331)
    # seg, ring profile, distance from card centre, xy radius, height, lean
    plan = ((6, ((0.0, 1.00), (0.72, 0.74)), 0.22, 0.215, 0.052, 0.60),
            (5, ((0.0, 1.00),),              0.60, 0.110, 0.026, 0.90),
            (4, ((0.0, 1.00),),              0.66, 0.088, 0.019, 0.90),
            (4, ((0.0, 1.00),),              0.52, 0.070, 0.015, 0.90))
    for i, (seg, rings, rr0, rad, hgt, ln) in enumerate(plan):
        a = 2.0 * math.pi * i / len(plan) + (nxt() - 0.5) * 1.5
        rr = rr0 * (0.86 + 0.28 * nxt())
        s = 0.88 + 0.24 * nxt()
        rx = rad * s
        ry = rad * s * (0.80 + 0.30 * nxt())
        # A random SIGN on a guaranteed magnitude, not a random offset: an
        # offset drawn uniformly about zero averages to zero, which is how the
        # first cut of this ended up with four stones that all stood straight
        # up. Every stone now leans by at least 0.45 of its allowance.
        sx = 1.0 if nxt() < 0.5 else -1.0
        sy = 1.0 if nxt() < 0.5 else -1.0
        lean = (sx * ln * rx * (0.45 + 0.55 * nxt()),
                sy * ln * ry * (0.45 + 0.55 * nxt()))
        p.add(*hc.lobe(rx, ry, hgt * s,
                       loc=(rr * math.cos(a), rr * math.sin(a), 0.0),
                       seg=seg, seed=1341 + i * 13, jit=0.48, lean=lean,
                       rings=rings, role="Rock"))
    return p


# ---------------------------------------------------------------------------
# LOD2 (RN-45, 2026-07-27). Rebuilt, never decimated.
#
# The file header used to assert that a grass card is already at the triangle
# floor and that no distance justifies a second mesh. That was measured and it
# is false, for a reason that is about the SCATTER rather than about the card:
# the biome props are placed by the handful and the understorey is stamped by
# the square metre out to DETAIL_RADIUS_M = 78 m. Integrating the renderer's
# own density falloff over that ring puts 48.7% of live understorey instances
# beyond LOD2_M = 45 m, where a 0.28 m card is under 3 px tall. Those instances
# were drawing 18 to 42 triangles apiece for a shape nothing can resolve.
#
# A COLLAPSE DECIMATE CANNOT BE USED HERE and that is why these are callables.
# props_common's own header says it: a collapse decimator eats a grass blade
# whole and leaves a shard, because a blade is a 3-triangle strip with no
# interior edges to collapse into. Rebuilding the tuft with fewer, wider blades
# is the only operation that trades triangles for the thing that actually
# matters at this range, which is COVERED AREA and not silhouette.
#
# So the LOD2 rule for a card is: blades at segs = 1, i.e. one triangle each
# (a base pair plus a tip, with no intermediate ring), fewer of them, and
# WIDER to hold the coverage the dropped blades were providing. fit() rescales
# every LOD into the prop's authored box, so the height and footprint are
# identical to LOD0 by construction and the switch cannot pop in silhouette.
# ---------------------------------------------------------------------------

def grass_card_a_lod2():
    """Four single-triangle blades, 2.7x the base width of LOD0's six.
    4 triangles against 18."""
    return pc.tuft(4, 0.38, 0.245, 0.018, 1301, bend=0.14, segs=1, droop=0.16,
                   role="Grass", h_var=0.16)


def grass_card_b_lod2():
    """Card B is the tall note and is scattered at about a fifth of A's
    density, so it keeps the same 4-triangle budget rather than a larger one.
    4 triangles against 40, the biggest single saving in the file."""
    return pc.tuft(4, 0.60, 0.235, 0.024, 1311, bend=0.26, segs=1, droop=0.20,
                   role="Grass", h_var=0.18, phase=23.0)


def grass_card_c_lod2():
    """The dry note, on LeafDry so the far ground keeps its parched fraction.
    4 triangles against 18."""
    return pc.tuft(4, 0.44, 0.190, 0.030, 1321, bend=0.18, segs=1, droop=0.15,
                   role="LeafDry", h_var=0.18, phase=41.0)


def broadleaf_forb_lod2():
    """Four leaves at one triangle each, 1.9x the width of LOD0's six.
    4 triangles against 30.

    A leaf is the one card shape where the LOD2 rule costs nothing to obey:
    the LOD0 leaf is already a wide paddle, so dropping it to a single wide
    triangle loses the arc and keeps the paddle, which is the whole read."""
    return pc.tuft(4, 0.30, 0.455, 0.020, 1351, bend=0.36, segs=1, droop=0.30,
                   role="Leaf", h_var=0.14, phase=11.0)


def flower_sprig_lod2():
    """Three wide grass triangles with two wide straw ones standing over
    them: 5 triangles against 30.

    Built as TWO tufts rather than one tuft with heads, because tuft() gives a
    head segs + 1 levels and the cheapest blade this file allows is segs = 1;
    a head would therefore cost 3 triangles where the LOD2 budget for the
    whole prop is 4 to 8. Two tufts at segs = 1, the second taller and
    narrower, is the same shape for 5. The heads keep their own role, since a
    far sprig that has lost its straw accent is just a shorter grass card and
    there was no reason to draw it."""
    p = pc.tuft(3, 0.26, 0.205, 0.018, 1361, bend=0.16, segs=1, droop=0.16,
                role="Grass", h_var=0.14, phase=7.0)
    p.extend(pc.tuft(2, 0.49, 0.150, 0.012, 1367, bend=0.20, segs=1,
                     droop=0.10, role="LeafDry", h_var=0.12, phase=53.0))
    return p


def sedge_rosette_lod2():
    """Four straps at one triangle each, 3.7x the width of LOD0's twelve.
    4 triangles against 36.

    The widest ratio in the file, and it has to be: a rosette is nothing but
    covered ground, so of the two things a LOD2 can keep here, area and
    silhouette, only area exists.

    DROOP IS 0.40 AND NOT LOD0'S 0.80, for the reason the pebble LOD2 below
    spells out. LOD0's straps lie almost flat, which is the whole read of the
    prop up close; at 45 m with the eye 1.8 m up the ground is about 2 degrees
    off edge-on, a horizontal facet presents a few per cent of its area, and a
    faithfully flat LOD2 would fade out at exactly the range it exists to
    serve. Lifting the tips to 0.6 of the peak keeps the footprint fit()
    already guarantees and turns the covered area back toward the camera."""
    return pc.tuft(4, 0.20, 0.390, 0.016, 1371, bend=0.40, segs=1, droop=0.40,
                   role="Grass", h_var=0.16, phase=29.0)


def pebble_scatter_lod2():
    """One four-sided lobe filling the card's own footprint: 6 triangles
    against 42.

    Deliberately NOT flat triangles lying on the ground, which would be 3
    triangles and would be wrong. At 45 m with the eye 1.8 m up, the ground is
    seen about 2 degrees off edge-on, so a horizontal facet presents ~3.5% of
    its area and a scatter built from them would simply vanish at exactly the
    range this LOD exists to serve. A low mound presents its sides instead."""
    p = hc.Parts()
    p.add(*hc.lobe(0.46, 0.40, 0.10, seg=4, seed=1331, jit=0.22,
                   rings=((0.0, 1.00),), role="Rock"))
    return p


PROPS = [
    pc.Prop("Detail_GrassCardA", (0.50, 0.48, 0.36), grass_card_a,
            ["Grass"], lod2=grass_card_a_lod2),
    pc.Prop("Detail_GrassCardB", (0.72, 0.68, 0.58), grass_card_b,
            ["Grass"], lod2=grass_card_b_lod2),
    pc.Prop("Detail_GrassCardC", (0.62, 0.58, 0.42), grass_card_c,
            ["LeafDry"], lod2=grass_card_c_lod2),
    pc.Prop("Detail_PebbleScatter", (0.92, 0.80, 0.10), pebble_scatter,
            ["Rock"], lod2=pebble_scatter_lod2),
    pc.Prop("Detail_BroadleafForb", (0.60, 0.56, 0.26), broadleaf_forb,
            ["Leaf"], lod2=broadleaf_forb_lod2),
    pc.Prop("Detail_FlowerSprig", (0.46, 0.42, 0.58), flower_sprig,
            ["Grass", "LeafDry"], lod2=flower_sprig_lod2),
    pc.Prop("Detail_SedgeRosette", (0.66, 0.62, 0.16), sedge_rosette,
            ["Grass"], lod2=sedge_rosette_lod2),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
