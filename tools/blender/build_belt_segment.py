"""
build_belt_segment.py - the reference asset AND the pipeline smoke test.

    blender --background --python tools/blender/build_belt_segment.py

Produces assets/models/dist/machines/belt_segment.glb.

This is the shape every other build script copies: reset, build LOD meshes with
MeshBuilder, add sockets and a collision proxy, author clips, export. It is
deliberately the smallest asset in the game that still exercises every part of
the contract - multi-material mesh, three LODs, a collision proxy, four
sockets, a state-emissive slot, and one looping animation clip.

Belt segment, TypeId 0x11 (of::gameplay::types::Belt).
Footprint 1 x 1 m (one build-grid cell), 0.30 m tall.
Flow runs along Blender -Y, which is three.js +Z.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "BeltSegment"
OUT = of.dist_path("machines", "belt_segment.glb")

# --- dimensions (metres) ---------------------------------------------------
W, L, H = 1.00, 1.00, 0.30      # footprint X, flow Y, height Z
RAIL_W = 0.10
DECK_W = W - 2 * RAIL_W         # 0.80
DECK_TOP = 0.25
SLAT_PITCH = 0.125              # 8 slats per metre -> a whole-number loop
SLAT_COUNT = 9                  # 8 on the tile + 1 entering from the inlet
ROLLER_R = 0.055
ROLLER_Y = L * 0.5 - ROLLER_R   # tangent to the cell edge, never outside it


def build_lod0(root):
    mb = of.MeshBuilder()
    # side rails
    for sx in (-1, 1):
        mb.box((RAIL_W, L, H), (sx * (W - RAIL_W) * 0.5, 0.0, H * 0.5), "Steel")
    # under-frame (reads as the machine's dark base, ties it to the ground)
    mb.box((DECK_W, L * 0.9, 0.12), (0.0, 0.0, 0.06), "SteelDark")
    # belt deck
    mb.box((DECK_W, L, 0.06), (0.0, 0.0, DECK_TOP - 0.03), "Rubber")
    # end rollers, axis across the flow. Tangent to the cell edge, NOT past it:
    # a machine that overhangs its footprint z-fights its neighbour on the grid.
    for sy in (-1, 1):
        mb.cylinder(ROLLER_R, DECK_W, (0.0, sy * ROLLER_Y, DECK_TOP - 0.03),
                    axis="X", segments=12, role="Steel")
    # state chip, flush in the +X rail top. THE machine-state readout.
    mb.box((0.05, 0.12, 0.01), ((W - RAIL_W) * 0.5, 0.0, H - 0.005),
           "EmissiveState")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    """Hand-built, not decimated: a collapse decimator destroys a box
    silhouette before it saves anything worth having."""
    mb = of.MeshBuilder()
    for sx in (-1, 1):
        mb.box((RAIL_W, L, H), (sx * (W - RAIL_W) * 0.5, 0.0, H * 0.5), "Steel")
    mb.box((DECK_W, L * 0.9, 0.12), (0.0, 0.0, 0.06), "SteelDark")
    mb.box((DECK_W, L, 0.06), (0.0, 0.0, DECK_TOP - 0.03), "Rubber")
    for sy in (-1, 1):
        mb.box((DECK_W, ROLLER_R * 2, ROLLER_R * 2),
               (0.0, sy * ROLLER_Y, DECK_TOP - 0.03), "Steel")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, L, H), (0.0, 0.0, H * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def build_slats(root):
    """The animated strip. A SIBLING of LOD0, not a child, so LOD0's bounding
    box stays exactly 1 x 1 x 0.30 while the strip is free to overhang the
    front edge mid-loop (the overhang tucks under the next tile's roller)."""
    mb = of.MeshBuilder()
    mb.repeat_box((DECK_W - 0.08, 0.05, 0.022),
                  start=(0.0, -0.4375, DECK_TOP + 0.011),
                  step=(0.0, SLAT_PITCH, 0.0),
                  count=SLAT_COUNT, role="Rubber")
    return mb, mb.build("Belt_Slats", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbs, slats = build_slats(root)

    of.add_collision_box("col_" + NAME, (W, L, H), (0.0, 0.0, H * 0.5), root)

    # Sockets. A socket's local -Y is its facing (three.js +Z).
    of.add_socket("socket_belt_in", (0.0, L * 0.5, DECK_TOP), parent=root,
                  extras={"of_role": "belt_in"})
    of.add_socket("socket_belt_out", (0.0, -L * 0.5, DECK_TOP), parent=root,
                  extras={"of_role": "belt_out"})
    of.add_socket("socket_item", (0.0, 0.0, DECK_TOP + 0.03), parent=root,
                  extras={"of_role": "item_ride"})
    of.add_socket("socket_status", ((W - RAIL_W) * 0.5, 0.0, H), parent=root,
                  extras={"of_role": "state_light"})

    # One clip: the slat strip walks exactly one slat pitch over 60 frames at
    # 60 fps, so the loop is seamless and the clip is 1.000 s == 0.125 m of
    # travel. three.js: action.timeScale = beltSpeedMetresPerSecond / 0.125.
    # A tier-1 belt (8 units/tick, 256 units/tile, 60 tps) runs 1.875 m/s,
    # so timeScale = 15.
    of.add_clip(slats, "Belt_Scroll", "location",
                [(1, (0.0, 0.0, 0.0)), (61, (0.0, -SLAT_PITCH, 0.0))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Belt_Slats", mbs)])
    # No rig here, just an object translation, so keep the F-curve keys instead
    # of baking 60 of them.
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
