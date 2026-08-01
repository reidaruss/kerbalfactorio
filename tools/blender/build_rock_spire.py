"""build_rock_spire.py - the Mountains spire, restored as a harvest node.

    blender --background --python tools/blender/build_rock_spire.py

Writes assets/models/dist/nodes/rock_spire.glb. The form and the reasoning are
in crag_common.py; this file is the wrapper that gives it the node contract:
three depletion variants, the LOD ladder, a collision proxy and the two
sockets.

NODE KIND. `Rock`, the same kind boulder_stone carries, so a client lane can
add it as a SECOND entry in NodeArt.ART[NODE_KIND.Rock] exactly the way the
trees already alternate two files "so a stand is not a clone army". That is one
line of client code and no new resource, no new recipe and no new UI, which is
why it is the cheapest possible home for this shape.

THE HIT SOCKET IS DERIVED FROM THE PLAYER, NOT FROM THE ROCK, and this is the
one number here that would be wrong if it were copied. Every existing node puts
socket_hit at 0.55 of its own height because every existing node is about a
metre tall, so 0.55 of it lands at chest height by coincidence. This asset is
3.40 m, and 0.55 of that is 1.87 m, which is over the player's head. Where a
swing lands is a property of the ARM, so the socket is min(0.55 * height,
SWING_Z), and the rock's own proportion only governs while the rock is shorter
than the player. This is the 8 m machine lesson from INSTRUMENTS.md applied
before it costs anything rather than after.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import crag_common as cc       # noqa: E402
import rock_form as rf         # noqa: E402

NAME = "RockSpire"
# x, y, z up. The retired Mtn_RockSpire was 3.40 m and this is 2.60, which is
# NOT a reduction in the thing that was lost: a decor prop is placed at one
# size, and a harvest node is placed at ROCK_SCALE_MIN to ROCK_SCALE_MAX, i.e.
# 0.75 to 1.5, so these author out at 1.95 m to 3.90 m and the tallest spire on
# a ridge is now taller than the retired one ever was. Authoring at 3.40 would
# have put the biggest at 5.10 m, and cost distortion besides: Parts.fit()
# forces the box, so a box 2.72 times taller than wide against a pile that is
# naturally 2.0 stretches every pit and every welded fragment vertically by
# 36%. At 2.60 the stretch is 5%.
DIMS = (1.30, 1.15, 2.60)
SEED = 6201
BODY, SECOND = "Rock", "RockDark"

# Height a standing player's swing lands at, metres. The pickaxe impact socket
# on every other node is a fraction of the node; on anything taller than the
# player it has to be a fraction of the PLAYER. 1.15 m is chest height on the
# 1.8 m body in ASSET-SPECS 4.1.
SWING_Z = 1.15

# The collision proxy is the SHAFT, not the bounding box. A box the full
# 1.25 x 1.10 footprint would also enclose the apron, and a player would be
# stopped by loose scree lying half a metre away from a rock they can see
# through. 0.62 is the widest lift in SPIRE_BLOCKS as a fraction of the pile
# width, so the proxy shrinks with the shaft if the plan ever changes.
COL_FRAC = 0.62


def main():
    out = of.dist_path("nodes", "rock_spire.glb")
    roles = {"body": BODY, "second": SECOND}
    order = [BODY, SECOND]

    # The stack has to be SOLID, and the joints are where it stops being. See
    # crag_common.seam_margins: a negative margin is daylight through the shaft
    # and it renders as a shadow under a bedding ledge, which the same shaft
    # produces on purpose elsewhere, so the eye cannot arbitrate and this can.
    seams = cc.seam_margins()
    if min(seams) <= 0.0:
        raise ValueError("spire stack has a gap at joint %d: margins %s"
                         % (seams.index(min(seams)) + 1,
                            ["%.4f" % m for m in seams]))

    of.reset_scene()
    rf.reset_dev()
    root = of.add_root(NAME)

    reported = []
    for vname, vscale, blocks, apron in cc.SPIRE_VARIANTS:
        pit_s = 1.0 if blocks >= 4 else 0.5
        clast_s = 1.0 if blocks >= 6 else (0.5 if blocks >= 4 else 0.0)
        p = cc.spire_pile(roles, SEED, blocks, apron, pit_s, clast_s)
        p.fit([DIMS[k] * vscale[k] for k in range(3)])
        mb = of.MeshBuilder()
        p.into(mb, role_order=order)
        obj = mb.build("%s_%s_LOD0" % (NAME, vname), root)
        reported.append(("%s_LOD0" % vname, mb))
        of.add_lod_decimate(obj, 1, 0.45, root)
        of.add_lod_decimate(obj, 2, 0.15, root)

    col = (DIMS[0] * COL_FRAC, DIMS[1] * COL_FRAC, DIMS[2])
    of.add_collision_box("col_" + NAME, col, (0, 0, col[2] * 0.5), root,
                         role=BODY)

    hit_z = min(DIMS[2] * 0.55, SWING_Z)
    of.add_socket("socket_hit", (0.0, -DIMS[1] * 0.30, hit_z), parent=root,
                  extras={"of_role": "hit"})
    # The chunk pops off WHERE IT WAS STRUCK, a little above the impact, not
    # from a crown 3.4 m in the air: on a boulder those two points are the same
    # place and on a spire they are not.
    of.add_socket("socket_item_pop", (0.0, 0.0, hit_z + 0.35), parent=root,
                  extras={"of_role": "item_pop"})

    of.report(NAME, reported)
    print("[spire] %s: fracture planes %d, max out-of-plane %.3e m; "
          "shear blocks %d, max off-plane %.3e m; hit socket %.2f m; "
          "joint margins %s"
          % (NAME, rf.DEV["crowns"], rf.DEV["crown"], rf.DEV["shears"],
             rf.DEV["shear"], hit_z, ["%.4f" % m for m in seams]))
    of.export_glb(out, export_force_sampling=False)


if __name__ == "__main__":
    main()
