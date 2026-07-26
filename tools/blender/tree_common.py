"""tree_common.py - the rig every tree-family harvest node shares.

    build_tree_conifer.py, build_tree_broadleaf.py, build_bush_scrub.py

All three map to worldgen::survival::NodeKind::Tree. What they share is not
their shape (the two trees are deliberately unalike, and the bush is neither)
but their RIG: two nested animation pivots, one socket set, one collision box
and the Tree_Sway / Tree_Fall clip pair.

WHY THE PIVOTS ARE SHARED RATHER THAN PER-VARIANT. validate_glb.py checks the
animation clip name set EXACTLY, and in ACTIONS export mode two same-named
Actions on two objects are not guaranteed to merge into one clip, so a second
`Tree_Sway` would surface as `Tree_Sway.001` and fail the build. One clip
therefore drives one object. Every depletion variant hangs under the same
sway pivot, so a single Tree_Sway sways whichever variant is currently visible
and a single Tree_Fall fells it, with no per-variant clip duplication.

    <Root>
      fell_pivot                 Tree_Fall rotates this about X
        sway_pivot               Tree_Sway rotates this +/- 1.5 deg
          <Root>_Full_LOD0..2
          <Root>_Half_LOD0..2
          <Root>_Low_LOD0..2
          <Root>_Stump_LOD0..2   (trees only)
      col_<Root>
      socket_hit / socket_fell_pivot / socket_item_pop

Both pivots sit at the trunk base with an identity rest transform, so the
LOD0 world bounding box the validator measures is the mesh's own.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402


def rig(root, name, col_size, hit_z, pop, fall=True):
    """Build the pivots, sockets and collision proxy. Returns the sway pivot;
    parent every render mesh to it."""
    fell = of.add_pivot("fell_pivot", (0.0, 0.0, 0.0), root) if fall else None
    sway = of.add_pivot("sway_pivot", (0.0, 0.0, 0.0), fell or root)

    of.add_collision_box("col_" + name, col_size,
                         (0, 0, col_size[2] * 0.5), root, role="Bark")

    # socket_hit is chest height on the forward face of the trunk: where the
    # axe lands and where impact VFX plays. socket_fell_pivot is the felling
    # hinge, kept as a marker distinct from the animated fell_pivot so the
    # socket stays a childless node per ASSET-SPECS 2.6.
    of.add_socket("socket_hit", (0.0, -0.28, hit_z), parent=root,
                  extras={"of_role": "hit"})
    if fall:
        of.add_socket("socket_fell_pivot", (0.0, 0.0, 0.0), parent=root,
                      extras={"of_role": "fell_pivot"})
    of.add_socket("socket_item_pop", pop, parent=root,
                  extras={"of_role": "item_pop"})

    # Tree_Sway, 1 to 181, loop. X runs one cycle at +/- 1.5 degrees and Y runs
    # TWO cycles at +/- 0.9, so the crown traces a slow figure eight instead of
    # rocking in one plane. At 6.5 m that is a 17 cm crown drift: wind at 30 m,
    # never a wobbling asset up close.
    #
    # FRAME 1 MUST BE THE IDENTITY POSE. Assigning an Action makes the
    # depsgraph evaluate the pivot at the current frame, and the exporter
    # writes THAT into the node's TRS. A clip that starts one degree off axis
    # therefore bakes a permanent one degree lean into the asset, which showed
    # up as a 2.483 m wide conifer failing a 2.400 m scale check. Both channels
    # also return to zero at 181 so the loop is seam free.
    of.add_clip_multi(sway, "Tree_Sway", {
        "rotation_euler": [
            (1,   of.deg3(0.00, 0.0, 0.0)),
            (24,  of.deg3(1.06, 0.9, 0.0)),
            (46,  of.deg3(1.50, 0.0, 0.0)),
            (69,  of.deg3(1.06, -0.9, 0.0)),
            (91,  of.deg3(0.00, 0.0, 0.0)),
            (114, of.deg3(-1.06, 0.9, 0.0)),
            (136, of.deg3(-1.50, 0.0, 0.0)),
            (159, of.deg3(-1.06, -0.9, 0.0)),
            (181, of.deg3(0.00, 0.0, 0.0)),
        ]})

    if fall:
        # Tree_Fall, 1 to 45, one shot. 88 degrees about X through the trunk
        # base, keyed in sub-180-degree steps because glTF stores rotation as
        # a quaternion. Slow break, fast topple, two-frame bounce settle.
        of.add_clip(fell, "Tree_Fall", "rotation_euler", [
            (1,  of.deg3(0.0, 0.0, 0.0)),
            (11, of.deg3(5.0, 0.0, 0.0)),
            (25, of.deg3(38.0, 0.0, 0.0)),
            (37, of.deg3(88.0, 0.0, 0.0)),
            (41, of.deg3(82.0, 0.0, 0.0)),
            (45, of.deg3(87.0, 0.0, 0.0)),
        ])
    return sway
