"""build_props_forest.py - the Forest biome scatter atlas.

    blender --background --python tools/blender/build_props_forest.py

Produces assets/models/dist/props/props_forest.glb (ASSET-SPECS 3.2,
Biome::Forest).

Forest already has the two harvestable trees standing in it, so this atlas is
explicitly the FLOOR of the forest and the DEAD wood in it: nothing here is a
live tree, because a scatter prop that looked like a conifer would read as a
harvest node the player cannot chop. The five props are what a player walks
between and over.

Materials (4): OF_Bark, OF_Leaf, OF_LeafDry, OF_Rock. Every broken or cut wood
face is OF_LeafDry - the same pale sapwood the conifer stump and the log item
use - so a snapped branch reads as snapped from any distance.

Collision: Forest_DeadTree (trunk box only, a player walks through where the
branches were), Forest_FallenLog and Forest_Rock. The fern and the mushrooms
are walk-through.

W11 pass (2026-07-27, dims relaxed by the controller the same night to 1.6 x
1.55 x 0.8 m, max 200 tris): the fern is now three crowns of arching fronds
spread across that bigger footprint with bare forest floor between them,
instead of one dense crown, the same "clump, not tuft" fix the plains grass
got. It shades LeafDeep (the floor is dim under a canopy) with a few
LeafLight fronds catching dapples of light through the trees, which needed
two more roles: Bark, LeafDry, Rock, Leaf, LeafDeep, LeafLight is 6, exactly
this atlas's budget.

RN-305 to RN-308 (2026-08-01), THE UNDERSTOREY PASS, under
docs/web/ART-DIRECTION.md. Reid's correction is that KSP was a MECHANICS
reference and never an art one, the target is Skyrim / Elden Ring, "clean" is
now a defect and a low triangle count is a budget rather than a virtue. The
predecessor lane (RN-271 to RN-284) applied that to the canopy; this file is
the layer a player is actually closest to for most of the game, and it had
four defects that the canopy pass names generally:

1. THE MISSING FOREST FLOOR. A real forest floor is mostly DEAD material:
   litter, fallen branches, exposed roots, moss, small dry stems. This atlas
   had a fern, a snag, a log, mushrooms and a rock, and between them not one
   piece of any of that. The floor shot at a standing eye
   (render_flora.py `floor:`, RN-301) shows the result plainly: the ground
   under a forest is a GRASS FIELD.

2. A TILTED DOWEL IS NOT A GROWN STEM. The snag's trunk was one
   `hc.taper` band with a `lean`, which is by construction a straight cone
   with an offset top. `tree_common.taper_bands` gained per-ring `offsets`, a
   coherent azimuthal `ridge` and a root `flare` at RN-271, all three of which
   cost ZERO triangles because they reshape rings that already exist, and none
   of them had reached this file.

3. A BRANCH THAT IS A STACK OF HORIZONTAL RINGS CANNOT LEAVE A TRUNK. Every
   stub here was `hc.taper` with a `lean`, whose rings stay flat in XY however
   far the top is pushed sideways, so a stub that reaches out flattens into a
   ribbon. `tree_common.limb` sweeps a real tube along a polyline and is what
   the stubs, the roots and the fallen branch are built from now.

4. PLAN ANISOTROPY GETS NORMALISED AWAY. `Parts.fit` scales X and Y
   INDEPENDENTLY to fill `size` exactly, so a footprint written square forces
   a square plan no matter what the build function produced (RN-273 measured a
   crown rebuilt entirely out of asymmetric boughs still reporting a plan
   aspect of 1.019). The fern was 1.60 x 1.55, an aspect of 1.03, and was
   therefore a round colony by contract. Footprints now STATE the aspect the
   asset actually has, with the mean held near the old value so scatter
   density does not move as a side effect.

WHAT THIS PASS DELIBERATELY DID NOT DO, and why it is not an oversight:

  * NO NEW STEM, IN ANY PROP. `PropLibrary.register` calls `addGeometry` for
    every `_LOD0` mesh in a .glb whether or not a biome table names it, so an
    unreferenced stem costs BatchedMesh geometry slots and moves an invariant
    other lanes measure, for no picture at all until a `Registry.ts` row lands.
    The forest-floor forms this pass adds therefore live INSIDE the four props
    that are already scattered.

  * NO NEW ROLE, IN ANY PROP. `PropLibrary` builds one PropPart per material
    per stem and `acquire` takes one instance slot per part per placement, so
    giving the fern a third role would add one instance per fern placed, and
    the fern is the densest biome prop in Forest at 25,200/km2 after
    DENSITY_SCALE. Every addition below is geometry inside a role set that
    prop already pays for, which is what lets this pass claim ZERO extra draw
    calls and ZERO extra instances without a browser to measure in.

  * NO MATERIAL VALUES. Albedo, roughness and colour are look development's,
    per the sequencing rule in ART-DIRECTION.md: re-authoring them under
    untuned lighting bakes the lighting error into the asset permanently. Roles
    here are palette SLOTS and this pass only chooses which slot a face sits
    in, never what the slot looks like.

  * NOTHING TO Forest_Rock. It is a rock, which is a sibling lane's, and
    WG-68 retired it from `BIOME_PROPS` anyway: nothing in the client
    references it, so it is already dead geometry in this file. Reported up
    rather than touched.

THE TRIANGLE PRICE, STATED, because ART-DIRECTION.md makes a raise arguable
rather than forbidden and an arguable raise still has to be argued. Densities
are per square kilometre after `Registry.DENSITY_SCALE = 6`, and props switch
to LOD2 at 45 m, so the LOD0 count that matters is the density times the
6,362 m2 inside that radius:

    prop                    density     LOD0 in 45 m   tris        cost
    Forest_Fern             25,200/km2      160        112 -> 141  +4,640
    Forest_MushroomCluster   9,000/km2       57        150 -> 187  +2,109
    Forest_DeadTree          2,520/km2       16        124 -> 192  +1,088
    Forest_FallenLog         1,560/km2       10         88 -> 172    +840

+218 triangles of asset, 243 LOD0 instances, about 8,700 triangles in a scene
that measured 1,139,594 at RN-183: 0.76 percent. That is the whole reason the
effort went here and NOT into `detail_cards.glb`, where ONE extra triangle on
Detail_GrassCardA costs 6,873 by the same arithmetic and the entire budget for
that file is 245. The ground layer got zero triangles and RN-302's shape
arguments instead. NOT re-measured in engine, because this pass had no browser.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402
import tree_common as tc       # noqa: E402

NAME = "PropsForest"
OUT = of.dist_path("props", "props_forest.glb")

# (offset x, offset y, frond count, height, droop, seed) per crown. UNEQUAL on
# every axis, and offset onto one bearing rather than spread evenly: a fern
# colony spreads from a rhizome, so it has a big end and a thin end. The three
# equal crowns this replaces summed to a round patch, which `fit` into a square
# 1.60 x 1.55 box then made exactly round.
FERN_CROWNS = (
    (-0.30, -0.14, 6, 0.62, 0.44, 4101),
    (0.34, 0.20, 5, 0.53, 0.50, 4113),
    (-0.62, 0.26, 4, 0.42, 0.56, 4127),
    (0.66, -0.24, 3, 0.31, 0.62, 4133),
)


def fern():
    """Four crowns of fronds arching almost flat, unequal in size and running
    along one bearing, with a few OLD fronds collapsed onto the floor between
    them: a fern colony rather than three copies of a tuft.

    segs 4 and a bend close to the frond length is what makes a frond arch
    rather than stand: a fern is a horizontal shape, which is the opposite of
    every grass tuft in the game and the reason it reads as forest floor. Every
    third frond is LeafLight, a dapple of light breaking through the canopy.

    THE COLLAPSED FRONDS ARE THE POINT OF THE RN-305 EDIT. droop 0.94 puts a
    frond's tip back within a twentieth of its own height of the ground, so it
    is a frond lying over rather than standing, and at `segs` 2 it costs three
    triangles. Nothing in this atlas was dead or damaged before, in the layer
    of the game where dead material is most of what is actually on the ground.
    They ride LeafDeep, the role the fern already pays for, because a role is
    an instance slot per placement (see the header) and this is the densest
    biome prop in the biome."""
    p = hc.Parts()
    for cx, cy, count, height, droop, seed in FERN_CROWNS:
        p.extend(pc.tuft(count, height, 0.115, 0.07, seed, bend=0.52, segs=4,
                         droop=droop, role="LeafDeep", alt_role="LeafLight",
                         alt_every=3, h_var=0.34, loc=(cx, cy, 0.0),
                         twist=1.15, kink=0.10, droop_var=0.22,
                         lean_var=0.45))
    # The litter: old fronds down on the floor, reaching further than they
    # rise. 0.014 of lift keeps them off z = 0 so they are not coplanar with
    # whatever terrain they land on.
    p.extend(pc.tuft(5, 0.30, 0.145, 0.30, 4141, bend=0.46, segs=2,
                     droop=0.94, role="LeafDeep", h_var=0.30, phase=17.0,
                     loc=(0.0, 0.0, 0.014), kink=0.12, lean_var=0.55))
    return p


def fern_lod2():
    p = hc.Parts()
    for cx, cy, height, seed in ((-0.30, -0.14, 0.62, 4101),
                                 (0.34, 0.20, 0.50, 4139),
                                 (0.66, -0.24, 0.33, 4133)):
        p.extend(pc.tuft(3, height, 0.170, 0.05, seed, bend=0.52, segs=2,
                         droop=0.46, role="LeafDeep", alt_role="LeafLight",
                         alt_every=3, h_var=0.18, loc=(cx, cy, 0.0),
                         kink=0.11, lean_var=0.40))
    return p


def _snapped(v, f, sm, roles, seed):
    """Hand a part its PALE SNAPPED END and the UVs that end needs.

    `tree_common.limb` and `taper_bands` both emit the top cap LAST, so
    roles[-1] is exactly "the face this stem was broken across". Putting it on
    LeafDry is the same pale-sapwood language the conifer stump, the log item
    and `props_common.prism_x` already speak, and once that role wears an
    alpha-tested card the cut face has to sample somewhere OPAQUE, which is
    what `disc_uvs` is for."""
    roles = list(roles)
    roles[-1] = "LeafDry"
    return (v, f, sm, roles, pc.disc_uvs(v), {"LeafDry"})


# The snag's trunk, as five rings that SWEEP rather than two that lean.
# (dx, dy) per ring plus (radius, z): a stem that leaves the ground one way and
# recovers, which is most of what says "grown" instead of "extruded".
SNAG_RINGS = ((0.230, 0.00), (0.180, 0.95), (0.140, 1.90),
              (0.098, 2.90), (0.058, 3.95))
SNAG_OFFSETS = ((0.000, 0.000), (0.128, -0.062), (0.196, -0.044),
                (0.170, 0.086), (0.074, 0.198))

# (path, radii, seed) for the limb stubs. Every one leaves the trunk SURFACE
# rather than its axis, and the two long ones bend down at the outer end,
# because a dead limb that has not yet fallen is a limb that is on its way.
SNAG_STUBS = (
    (((0.16, -0.05, 1.12), (0.52, -0.16, 1.22)), (0.052, 0.018), 4121),
    (((-0.15, 0.09, 1.78), (-0.58, 0.24, 1.66)), (0.048, 0.016), 4127),
    (((0.11, 0.13, 2.38), (0.42, 0.50, 2.44)), (0.042, 0.015), 4133),
    (((0.12, -0.06, 0.58), (0.46, -0.34, 0.44), (0.62, -0.52, 0.19)),
     (0.058, 0.032, 0.012), 4153),
    (((-0.10, -0.10, 2.94), (-0.44, -0.40, 2.86), (-0.66, -0.56, 2.52)),
     (0.038, 0.022, 0.009), 4139),
    (((0.09, 0.06, 3.42), (0.30, 0.22, 3.60), (0.44, 0.30, 3.44)),
     (0.034, 0.020, 0.008), 4147),
)

# The exposed root mat: three surface roots running OUT and DOWN to nothing,
# never below the trunk's own base, because `Parts.fit` lands the pile's AABB
# base on z = 0 and a root dipping under it would lift the whole snag off the
# ground instead (the burial trap build_detail_cards.py documents).
SNAG_ROOTS = (
    (((0.16, -0.09, 0.20), (0.54, -0.28, 0.032)), (0.135, 0.034), 4161),
    (((-0.15, -0.12, 0.18), (-0.50, -0.47, 0.028)), (0.120, 0.030), 4167),
    (((-0.04, 0.18, 0.19), (-0.18, 0.60, 0.026)), (0.112, 0.028), 4173),
)


def dead_tree():
    """A standing snag: a swept, fluted, root-flared trunk snapped off at the
    top, six limb stubs, three surface roots and one limb already down.

    The snapped crown is what separates it from a live tree at any distance: a
    dead tree has no canopy silhouette at all, just a spike.

    RIDGE, FLARE AND SWEEP COST NOTHING. All three are `taper_bands` arguments
    that move vertices the ring stack already had. The ridge runs a fixed set
    of flutes the whole length of the stem, which is different in kind from the
    per-ring `jit` that was already here: jitter redraws independently on every
    ring, so it is surface noise whose silhouette is a smooth line with a
    wobble on it, where a coherent azimuthal term breaks the outline into
    flutes and runs the same way as RN-100's bark fissures. The flare is the
    silhouette a player standing beside the thing actually reads, and it is the
    one this asset most obviously lacked."""
    p = hc.Parts()
    v, f, sm, roles = tc.taper_bands(
        [(r, z) for r, z in SNAG_RINGS], seg=7, seed=4111, jit=0.075,
        phase_deg=23.0, offsets=SNAG_OFFSETS, roles="Bark",
        ridge=(4, 0.135, 58.0), flare=(3, 1.05, 0.26))
    p.add(*_snapped(v, f, sm, roles, 4111))

    for path, radii, seed in SNAG_STUBS:
        v, f, sm, roles = tc.limb(path, radii, seg=4, seed=seed, jit=0.16,
                                  roles="Bark", cap=(False, True))
        p.add(*_snapped(v, f, sm, roles, seed))

    for path, radii, seed in SNAG_ROOTS:
        p.add(*tc.limb(path, radii, seg=4, seed=seed, jit=0.20, roles="Bark",
                       cap=(False, False)))

    # The limb that already came down, lying where it fell against the base.
    # A snag with every branch still attached is a snag nothing has happened
    # to yet, and something has happened to every dead tree in a real wood.
    v, f, sm, roles = tc.limb(
        ((0.62, 0.30, 0.052), (0.44, 0.62, 0.068), (0.10, 0.76, 0.044)),
        (0.046, 0.036, 0.020), seg=4, seed=4181, jit=0.22, roles="Bark",
        cap=(False, True))
    p.add(*_snapped(v, f, sm, roles, 4181))
    return p


def fallen_log():
    """Settled into the ground and going back to soil: a sagging, bending
    prism with pale broken ends, two snapped branch stubs, a pair of root
    spurs torn out of the ground at the butt, moss on the upper surface and
    leaf litter drifted against the downhill side.

    THE LOG BENDS IN PLAN AS WELL AS SAGGING IN SECTION. `prism_x` takes a dy
    per ring and nothing in this file had ever used it for anything but zero,
    so the log was a straight tube with a dip in it: straight in plan is the
    one thing a fallen trunk never is, because it fell around whatever was in
    the way and then settled. Five rings instead of four, so the bend and the
    sag are separable rather than being the same single curve."""
    p = hc.Parts()
    # EIGHT SIDES, NOT SEVEN, AND A THIRD MORE JITTER, at a cost of 10
    # triangles. A 0.5 m trunk at 7 sides is a 51 degree facet, and the render
    # showed the result honestly: a hewn beam, not a fallen tree. This is the
    # one place in the atlas where the old low-poly budget was buying a shape
    # the art direction now calls a defect outright.
    p.add(*pc.prism_x(((-1.28, 0.222, -0.075, 0.020),
                       (-0.62, 0.258, 0.028, 0.036),
                       (0.02, 0.266, 0.086, -0.014),
                       (0.66, 0.238, 0.052, -0.044),
                       (1.26, 0.196, -0.036, 0.030)),
                      seg=8, seed=4161, jit=0.19))

    # Two snapped branch stubs off the top of the log, one either side. A log
    # with no branch scars is a milled beam. They rise and lean AWAY along the
    # log rather than turning back on themselves: the first cut bent one back
    # over its own root and it rendered as a bent nail.
    for path, radii, seed in (
            (((-0.40, 0.05, 0.31), (-0.52, 0.34, 0.50), (-0.61, 0.58, 0.58)),
             (0.062, 0.036, 0.014), 4191),
            (((0.72, -0.02, 0.28), (1.02, -0.30, 0.41)),
             (0.055, 0.019), 4197)):
        v, f, sm, roles = tc.limb(path, radii, seg=4, seed=seed, jit=0.18,
                                  roles="Bark", cap=(False, True))
        p.add(*_snapped(v, f, sm, roles, seed))

    # The root spurs at the butt end: this trunk did not get sawn off, it came
    # out of the ground, and the plate it came out with is the only part of a
    # fallen tree that says which end was the bottom.
    for path, radii, seed in (
            (((-1.24, 0.10, 0.20), (-1.52, 0.44, 0.030)), (0.075, 0.026),
             4203),
            (((-1.26, -0.08, 0.18), (-1.46, -0.40, 0.026)), (0.066, 0.022),
             4211)):
        p.add(*tc.limb(path, radii, seg=4, seed=seed, jit=0.24, roles="Bark",
                       cap=(False, False)))

    # Moss, on the faces that see the sky. Three patches of unequal size, not
    # two of the same one.
    for loc, r, seg, seed in (((-0.58, 0.05, 0.22), (0.34, 0.17, 0.085), 5,
                               4171),
                              ((0.44, -0.06, 0.21), (0.26, 0.15, 0.070), 4,
                               4177),
                              ((1.02, 0.03, 0.17), (0.17, 0.11, 0.048), 4,
                               4183)):
        v, f, sm, roles = hc.lobe(r[0], r[1], r[2], loc=loc, seg=seg,
                                  seed=seed, jit=0.30,
                                  rings=((0.0, 1.00), (0.65, 0.60)),
                                  role="Leaf")
        p.add(v, f, sm, roles,
              uvs=pc.shell_uvs(v, seed, centre=(loc[0], loc[1])))

    # Leaf litter drifted against the log. Six one-triangle paddles reaching
    # further out than up, which is what a fallen leaf does.
    p.extend(pc.tuft(6, 0.16, 0.185, 0.62, 4217, bend=0.34, segs=1,
                     droop=0.92, role="LeafDry", h_var=0.36, phase=31.0,
                     loc=(0.10, -0.30, 0.014), kink=0.14, lean_var=0.60))
    return p


# (centre, stalk radius, height, cap radius, cap rings, seed). Five caps that
# are no longer five of the same cap: a spread flat one, a domed one, a
# nearly conical one, a wide low plate and a button.
#
# THE RING TABLE IS THE WHOLE VARIETY AND IT IS FREE. `hc.lobe` always
# finishes with an apex fan, so the only way to not have a POINT on top is to
# hand that fan a wide ring to start from and very little height to cross,
# which is exactly the lever RN-68 used to stop the near pebble reading as a
# pyramid. A ring at 0.34 of the height carrying 0.94 of the radius gives a
# cap that is flat across the top; one at 0.70 carrying 0.44 gives a cone. The
# two largest caps get a THIRD ring, which is the only place this prop spends
# a triangle, because they are the two the player's eye lands on.
MUSHROOMS = (
    ((0.00, 0.00), 0.030, 0.185, 0.118,
     ((0.0, 1.00), (0.34, 0.94), (0.72, 0.56)), 4181),
    ((0.13, 0.07), 0.024, 0.140, 0.080,
     ((0.0, 1.00), (0.30, 0.97), (0.66, 0.62)), 4187),
    ((-0.11, 0.09), 0.021, 0.120, 0.062, ((0.0, 1.00), (0.62, 0.50)), 4193),
    ((0.05, -0.14), 0.026, 0.168, 0.086, ((0.0, 1.00), (0.26, 0.98)), 4201),
    ((-0.14, -0.08), 0.017, 0.088, 0.048, ((0.0, 1.00), (0.48, 0.80)), 4211),
)


def mushroom_cluster():
    """Five caps on pale stalks, standing in leaf litter with two dry stems
    beside them. Dark cap on a light stalk is the read; the reverse disappears
    against forest floor.

    THE FIVE CAPS ARE NOW FIVE SHAPES. They were one ring profile at five
    scales, which is the same defect the canopy pass found in the trees one
    tier up: variety written as SIZE, where the eye reads FORM. A flat spread
    cap, a tall dome, a nearly conical button and a wide low plate are four
    different fungi at the same triangle count, because the profile is a ring
    table and a ring table is free."""
    p = hc.Parts()
    for (x, y), rs, h, rc, rings, seed in MUSHROOMS:
        # A SIX SIDED STALK FOR THE SAME TWELVE TRIANGLES A FOUR SIDED ONE COST.
        # `hc.taper` caps both ends, and on a mushroom both caps are invisible:
        # the bottom is in the ground and the top is under the cap. Spending
        # those four triangles on two more sides instead turns a stalk that
        # rendered as a SQUARE COLUMN at 0.5 m into a round one, and
        # `taper_bands` jitters each ring on the way, so it is not a perfect
        # cylinder either. 4 sides + 2 caps = 12; 6 sides + 0 caps = 12.
        v, f, sm, roles = tc.taper_bands(
            ((rs, 0.0), (rs * 0.80, h)), seg=6, seed=seed + 601, jit=0.16,
            phase_deg=(seed % 11) * 9.0, loc=(x, y, 0.0),
            lean=(rs * 0.35, -rs * 0.22), roles="LeafDry", cap=False)
        # A stalk is mushroom flesh riding the LeafDry role: a NARROW band on
        # the card's centreline (the opaque midrib), v held off the clamped
        # rows, so the alpha test cannot eat the stalk.
        p.add(v, f, sm, roles,
              uvs=pc.shell_uvs(v, seed, centre=(x, y), u_scale=0.09,
                               u_off=0.455, v_lo=0.20, v_hi=0.65))
        p.add(*hc.lobe(rc, rc * 0.92, h * 0.30, loc=(x, y, h * 0.86), seg=5,
                       seed=seed, jit=0.18, rings=rings, role="Bark"))

    # Two dry stems standing in the cluster: the smallest piece of dead wood
    # in the atlas, and the one a player sees most often, since this prop is
    # scattered at 9,000/km2.
    for path, radii, seed in (
            (((0.19, -0.05, 0.0), (0.24, -0.02, 0.175)), (0.011, 0.005),
             4223),
            (((-0.20, 0.14, 0.0), (-0.27, 0.20, 0.132)), (0.009, 0.004),
             4229)):
        p.add(*tc.limb(path, radii, seg=3, seed=seed, jit=0.22, roles="Bark",
                       cap=(False, False)))

    # The litter the fungi are growing out of. Five paddles lying nearly flat.
    p.extend(pc.tuft(5, 0.085, 0.115, 0.19, 4237, bend=0.22, segs=1,
                     droop=0.90, role="LeafDry", h_var=0.34, phase=43.0,
                     loc=(0.0, 0.0, 0.010), kink=0.09, lean_var=0.55))
    return p


def forest_rock():
    """A mossed boulder: the top facet fan is OF_Leaf. hc.lobe's facet indices
    run bands first and the apex fan last, so 12..17 on a 6-sided lobe is
    exactly 'the faces that see the sky', which is exactly where moss grows.

    UNTOUCHED BY RN-305 TO RN-308, deliberately and twice over: it is a rock,
    and rock geometry belongs to a sibling Blender lane; and WG-68 retired it
    from `BIOME_PROPS` on the decoration-size rule, so nothing in the client
    references this stem and it is already dead geometry in this file. Both
    facts are reported up rather than acted on here."""
    return pc.rock(4221, "Rock", "Leaf",
                   ((12, 13, 15, 17), (10, 11, 13), (12, 14)),
                   lobes=3, seg=6, jit=0.18,
                   plan=(((0.00, 0.00, 0.00), (0.52, 0.46, 0.48)),
                         ((0.31, 0.15, 0.00), (0.27, 0.26, 0.30)),
                         ((-0.27, -0.19, 0.00), (0.24, 0.27, 0.25))))


# FOOTPRINTS STATE THE PLAN ASPECT THE ASSET HAS, because `Parts.fit` scales X
# and Y independently and a square box therefore ERASES plan anisotropy however
# asymmetric the build function was (RN-273). Each pair below keeps its old
# MEAN, so the ground area a prop occupies, and therefore the density the
# scatter reads, does not move as a side effect of the shape fix:
#   fern      1.60 x 1.55 (mean 1.575, aspect 1.03) -> 1.86 x 1.29 (1.575, 1.44)
#   dead tree 1.36 x 1.22 (mean 1.290, aspect 1.11) -> 1.52 x 1.06 (1.290, 1.43)
#   log       2.60 x 0.68 already states a strong aspect and keeps it, widened
#             to 0.96 for the branch stubs and the litter drift.
PROPS = [
    pc.Prop("Forest_Fern", (1.86, 1.29, 0.80), fern,
            ["LeafDeep", "LeafLight"], lod2=fern_lod2),
    pc.Prop("Forest_DeadTree", (1.52, 1.06, 4.20), dead_tree,
            ["Bark", "LeafDry"], lod2=0.30, collide=True,
            col_size=(0.50, 0.50, 4.20), col_role="Bark"),
    pc.Prop("Forest_FallenLog", (2.86, 0.96, 0.66), fallen_log,
            ["Bark", "LeafDry", "Leaf"], lod2=0.26, collide=True,
            col_size=(2.60, 0.68, 0.62), col_role="Bark"),
    pc.Prop("Forest_MushroomCluster", (0.52, 0.44, 0.26), mushroom_cluster,
            ["LeafDry", "Bark"], lod2=0.22),
    pc.Prop("Forest_Rock", (1.45, 1.25, 0.85), forest_rock,
            ["Rock", "Leaf"], lod2=0.16, collide=True, col_role="Rock"),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
