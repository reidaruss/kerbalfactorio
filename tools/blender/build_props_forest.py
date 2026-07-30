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
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import props_common as pc      # noqa: E402
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402

NAME = "PropsForest"
OUT = of.dist_path("props", "props_forest.glb")

# (offset x, offset y, frond count, seed) per crown.
FERN_CROWNS = (
    (0.00, 0.00, 6, 4101),
    (0.46, 0.30, 5, 4113),
    (-0.42, 0.24, 5, 4127),
)


def fern():
    """Three crowns of fronds arching almost flat, spread across the
    footprint with bare floor between them: a spreading fern colony rather
    than one dense clump. segs 4 and a bend close to the frond length is what
    makes a frond arch rather than stand: a fern is a horizontal shape, which
    is the opposite of every grass tuft in the game and the reason it reads
    as forest floor. Every third frond is LeafLight, a dapple of light
    breaking through the canopy."""
    p = hc.Parts()
    for cx, cy, count, seed in FERN_CROWNS:
        p.extend(pc.tuft(count, 0.58, 0.115, 0.07, seed, bend=0.52, segs=4,
                         droop=0.46, role="LeafDeep", alt_role="LeafLight",
                         alt_every=3, h_var=0.30, loc=(cx, cy, 0.0)))
    return p


def fern_lod2():
    p = hc.Parts()
    for cx, cy, seed in ((0.0, 0.0, 4101), (0.40, 0.24, 4139)):
        p.extend(pc.tuft(3, 0.58, 0.170, 0.05, seed, bend=0.52, segs=2,
                         droop=0.46, role="LeafDeep", alt_role="LeafLight",
                         alt_every=3, h_var=0.18, loc=(cx, cy, 0.0)))
    return p


def _stub(r0, r1, z0, z1, loc, lean, seed, seg=5):
    """A branch stub with a PALE SNAPPED END. hc.taper puts the top cap at
    face index 1, so the break gets its own role for the cost of one list.
    The snapped end rides the LeafDry role, so it gets disc UVs on the leaf
    card's opaque centre (see props_common.disc_uvs) and the bark sides keep
    their box-projected metres."""
    v, f, sm = hc.taper(r0, r1, z0, z1, loc=loc, seg=seg, lean=lean,
                        phase_deg=(seed % 9) * 11.0, smooth=False)
    return (v, f, sm, ["Bark", "LeafDry"] + ["Bark"] * (len(f) - 2),
            pc.disc_uvs(v), {"LeafDry"})


def dead_tree():
    """A standing snag: tapered trunk snapped off at the top, six stubs where
    the limbs were. The snapped crown is what separates it from a live tree at
    any distance - a dead tree has no canopy silhouette at all, just a spike."""
    p = hc.Parts()
    p.add(*_stub(0.19, 0.055, 0.0, 3.95, (0.0, 0.0, 0.0), (0.10, -0.06),
                 4111, seg=8))
    stubs = ((0.15, 0.05, 1.10, 1.55, (0.40, -0.10), 4121),
             (0.13, 0.04, 1.75, 2.15, (-0.45, 0.16), 4127),
             (0.12, 0.04, 2.35, 2.80, (0.30, 0.40), 4133),
             (0.10, 0.03, 2.90, 3.20, (-0.28, -0.34), 4139),
             (0.09, 0.03, 3.35, 3.65, (0.34, 0.06), 4147),
             (0.11, 0.04, 0.55, 0.85, (-0.22, -0.30), 4153))
    for r0, r1, z0, z1, lean, seed in stubs:
        p.add(*_stub(r0, r1, z0, z1, (0.0, 0.0, 0.0), lean, seed))
    return p


def fallen_log():
    """Settled into the ground and going back to soil: a sagging prism with
    pale broken ends and two moss patches on the upper surface."""
    p = hc.Parts()
    p.add(*pc.prism_x(((-1.28, 0.240, 0.00, 0.02),
                       (-0.42, 0.265, 0.03, -0.02),
                       (0.45, 0.245, -0.02, -0.01),
                       (1.26, 0.205, -0.05, 0.04)),
                      seg=7, seed=4161, jit=0.10))
    for loc, r, seed in (((-0.55, 0.02, 0.20), (0.30, 0.16, 0.09), 4171),
                         ((0.62, -0.04, 0.19), (0.24, 0.14, 0.08), 4177)):
        v, f, sm, roles = hc.lobe(r[0], r[1], r[2], loc=loc, seg=5, seed=seed,
                                  jit=0.26, rings=((0.0, 1.00), (0.65, 0.60)),
                                  role="Leaf")
        p.add(v, f, sm, roles,
              uvs=pc.shell_uvs(v, seed, centre=(loc[0], loc[1])))
    return p


def mushroom_cluster():
    """Five caps on pale stalks. Dark cap on a light stalk is the read; the
    reverse disappears against forest floor."""
    p = hc.Parts()
    plan = (((0.00, 0.00), 0.030, 0.185, 0.105, 4181),
            ((0.13, 0.07), 0.024, 0.140, 0.082, 4187),
            ((-0.11, 0.09), 0.021, 0.120, 0.072, 4193),
            ((0.05, -0.14), 0.026, 0.155, 0.090, 4201),
            ((-0.14, -0.08), 0.018, 0.095, 0.060, 4211))
    for (x, y), rs, h, rc, seed in plan:
        v, f, sm = hc.taper(rs, rs * 0.80, 0.0, h, loc=(x, y, 0.0), seg=4,
                            smooth=False)
        # A stalk is mushroom flesh riding the LeafDry role: a NARROW band on
        # the card's centreline (the opaque midrib), v held off the clamped
        # rows, so the alpha test cannot eat the stalk.
        p.add(v, f, sm, "LeafDry",
              uvs=pc.shell_uvs(v, seed, centre=(x, y), u_scale=0.09,
                               u_off=0.455, v_lo=0.20, v_hi=0.65))
        p.add(*hc.lobe(rc, rc * 0.92, h * 0.30, loc=(x, y, h * 0.86), seg=5,
                       seed=seed, jit=0.14,
                       rings=((0.0, 1.00), (0.55, 0.66)), role="Bark"))
    return p


def forest_rock():
    """A mossed boulder: the top facet fan is OF_Leaf. hc.lobe's facet indices
    run bands first and the apex fan last, so 12..17 on a 6-sided lobe is
    exactly 'the faces that see the sky', which is exactly where moss grows."""
    return pc.rock(4221, "Rock", "Leaf",
                   ((12, 13, 15, 17), (10, 11, 13), (12, 14)),
                   lobes=3, seg=6, jit=0.18,
                   plan=(((0.00, 0.00, 0.00), (0.52, 0.46, 0.48)),
                         ((0.31, 0.15, 0.00), (0.27, 0.26, 0.30)),
                         ((-0.27, -0.19, 0.00), (0.24, 0.27, 0.25))))


PROPS = [
    pc.Prop("Forest_Fern", (1.60, 1.55, 0.80), fern,
            ["LeafDeep", "LeafLight"], lod2=fern_lod2),
    pc.Prop("Forest_DeadTree", (1.36, 1.22, 4.20), dead_tree,
            ["Bark", "LeafDry"], lod2=0.30, collide=True,
            col_size=(0.50, 0.50, 4.20), col_role="Bark"),
    pc.Prop("Forest_FallenLog", (2.60, 0.68, 0.62), fallen_log,
            ["Bark", "LeafDry", "Leaf"], lod2=0.26, collide=True,
            col_size=(2.60, 0.68, 0.62), col_role="Bark"),
    pc.Prop("Forest_MushroomCluster", (0.46, 0.42, 0.26), mushroom_cluster,
            ["LeafDry", "Bark"], lod2=0.22),
    pc.Prop("Forest_Rock", (1.45, 1.25, 0.85), forest_rock,
            ["Rock", "Leaf"], lod2=0.16, collide=True, col_role="Rock"),
]


if __name__ == "__main__":
    pc.build_atlas(NAME, OUT, PROPS)
