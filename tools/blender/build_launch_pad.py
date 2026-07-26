"""
build_launch_pad.py - Tier 2, the launch pad and its clamp.

    blender --background --python tools/blender/build_launch_pad.py

Produces assets/models/dist/rocket/launch_pad.glb.

GRID-SNAPPED LIKE A MACHINE. The pad is a placed structure, so ASSET-SPECS 2.2
applies to it exactly as it applies to a smelter: an 8 x 8 m WHOLE-METRE
footprint, pivot at the footprint centre, base on z = 0, nothing overhanging
the cell. 8 is even, so it snaps to a cell CORNER, not a cell centre.

TWO MESHES, PLACED INDEPENDENTLY. `LaunchPad` is the deck plus the 12 m
service tower. `LaunchClamp` is a separate ground-pivoted part sitting on the
file origin, following the Tier-1 atlas convention (props overlap on the
origin; the renderer clones one by name and writes a placement matrix): the
renderer puts THREE of them on the mounting circle marked by socket_clamp, at
120 degree intervals, each rotated to face the stack axis. One clamp mesh, any
number of clamps.

    LaunchPad
      LaunchPad_LOD0/1/2        deck, flame deflector, tower, swing arm
      LaunchClamp_LOD0/2        clamp base and mast: does NOT move
      clamp_pivot               Clamp_Release drives this
        LaunchClamp_Arm
      col_LaunchPad / col_LaunchTower / col_LaunchClamp
      socket_vessel / socket_clamp / socket_smoke / socket_status

The vessel mates at socket_vessel, 1.20 m ABOVE the deck: the clamps hold it
there so the engine bell fires into the flame opening instead of onto the
concrete. A vessel is placed by putting its socket_stack_bottom on that point,
which is the same stacking rule rocket_parts.glb publishes.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "LaunchPad"
OUT = of.dist_path("rocket", "launch_pad.glb")

W = 8.00                 # whole-metre footprint, both axes
HALF = W * 0.5           # 4.00, the hard edge nothing may cross
H = 12.00                # tower top; the declared height of the asset
DECK_Z = 0.40            # deck top
HOLE = 1.20              # half-width of the flame opening
MATE_Z = 1.60            # socket_vessel: 1.20 m of clamp above the deck

TOWER = (-3.20, 3.20)    # tower centre, a whole cell in from the corner
TOWER_LEG = 0.55         # leg offset from the tower centre
CLAMP_R = 1.25           # clamp mounting circle radius

DOWN = of.deg3(x=90.0)
UP = of.deg3(x=-90.0)
INWARD = of.deg3(z=-90.0)   # -Y -> -X, a clamp on +X faces the stack axis

_report = []


def deck(mb):
    """Four concrete slabs around a square flame opening. Built as four boxes
    rather than as one slab with a hole, because a hole in a box is either a
    boolean or eight n-gons and this is neither."""
    for sy in (-1.0, 1.0):
        mb.box((W, HALF - HOLE, DECK_Z),
               (0.0, sy * (HALF + HOLE) * 0.5, DECK_Z * 0.5), "Rock")
    for sx in (-1.0, 1.0):
        mb.box((HALF - HOLE, 2 * HOLE, DECK_Z),
               (sx * (HALF + HOLE) * 0.5, 0.0, DECK_Z * 0.5), "Rock")
    # Steel curb around the opening, and hazard paint on the outer edge: the
    # two lines that tell a player where not to stand.
    for sy in (-1.0, 1.0):
        mb.box((2 * HOLE + 0.24, 0.24, 0.10), (0.0, sy * (HOLE + 0.12),
                                               DECK_Z + 0.05), "SteelDark")
        mb.box((W - 0.20, 0.30, 0.05), (0.0, sy * (HALF - 0.25),
                                        DECK_Z + 0.025), "Hazard")
    for sx in (-1.0, 1.0):
        mb.box((0.24, 2 * HOLE + 0.24, 0.10), (sx * (HOLE + 0.12), 0.0,
                                               DECK_Z + 0.05), "SteelDark")
        mb.box((0.30, W - 0.80, 0.05), (sx * (HALF - 0.25), 0.0,
                                        DECK_Z + 0.025), "Hazard")
    # Flame deflector, entirely below the deck top so nothing a vessel mates
    # with can ever touch it.
    mb.frustum(1.05, 0.16, 0.34, (0.0, 0.0, 0.17), axis="Z", segments=12,
               role="SteelDark")
    return mb


def tower(mb, detail=True):
    tx, ty = TOWER
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            mb.box((0.16, 0.16, H - 0.20),
                   (tx + sx * TOWER_LEG, ty + sy * TOWER_LEG,
                    (H - 0.20) * 0.5), "Steel")
    if detail:
        # Horizontal ties every 2 m. A lattice mast with no ties reads as four
        # unrelated posts from any distance at all.
        for k in range(1, 6):
            z = 2.0 * k
            for sy in (-1.0, 1.0):
                mb.box((2 * TOWER_LEG, 0.10, 0.10),
                       (tx, ty + sy * TOWER_LEG, z), "SteelDark")
            for sx in (-1.0, 1.0):
                mb.box((0.10, 2 * TOWER_LEG, 0.10),
                       (tx + sx * TOWER_LEG, ty, z), "SteelDark")
        mb.box((0.70, 0.70, 9.00), (tx, ty, 4.70), "SteelDark")   # lift shaft
    mb.box((1.40, 1.40, 0.20), (tx, ty, H - 0.10), "Steel")       # crown deck
    # Umbilical swing arm, reaching to 1.0 m from the stack axis: close enough
    # to read as connected, clear enough that it never intersects a 1.25 m
    # stack.
    mb.box((2.20, 0.30, 0.30), (tx + 1.10 + 0.00, ty, 8.00), "SteelDark")
    mb.box((0.30, 2.30, 0.26), (tx + 2.20, ty - 1.15, 8.00), "SteelDark")
    return mb


def build_lod0(root):
    mb = of.MeshBuilder()
    deck(mb)
    tower(mb)
    tx, ty = TOWER
    mb.box((0.30, 0.30, 0.24), (tx, ty, H - 0.32), "SteelDark")   # beacon bezel
    mb.box((0.22, 0.22, 0.18), (tx, ty, H - 0.32), "EmissiveState")
    mb.box((1.60, 0.60, 0.90), (2.60, -3.00, DECK_Z + 0.45), "SteelDark")
    mb.box((1.40, 0.20, 0.30), (2.60, -3.32, DECK_Z + 0.75), "Accent")
    _report.append(("LaunchPad_LOD0", mb))
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    deck(mb)
    tower(mb, detail=False)
    tx, ty = TOWER
    mb.box((0.22, 0.22, 0.18), (tx, ty, H - 0.32), "EmissiveState")
    _report.append(("LaunchPad_LOD1", mb))
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    """At 80 m the pad is a slab, a mast and a light. The mast is what says
    'launch site' from orbit-adjacent altitude, so it is the one thing LOD2
    keeps at full height."""
    mb = of.MeshBuilder()
    mb.box((W, W, DECK_Z), (0.0, 0.0, DECK_Z * 0.5), "Rock")
    tx, ty = TOWER
    mb.box((1.20, 1.20, H), (tx, ty, H * 0.5), "Steel")
    mb.box((0.22, 0.22, 0.18), (tx, ty, H - 0.32), "EmissiveState")
    _report.append(("LaunchPad_LOD2", mb))
    return mb, mb.build(NAME + "_LOD2", root)


def build_clamp(root):
    """Base and mast. Ground-pivoted and centred on X, so the renderer places
    it with a plain translate-and-rotate on the mounting circle."""
    mb = of.MeshBuilder()
    mb.box((1.24, 0.50, 0.24), (0.0, 0.0, 0.12), "SteelDark")
    mb.box((1.10, 0.16, 0.05), (0.0, 0.0, 0.265), "Hazard")
    mb.box((0.34, 0.34, 1.10), (-0.30, 0.0, 0.79), "Steel")
    mb.box((0.20, 0.20, 0.16), (-0.30, 0.0, 1.42), "SteelDark")
    _report.append(("LaunchClamp_LOD0", mb))
    obj = mb.build("LaunchClamp_LOD0", root)

    mb2 = of.MeshBuilder()
    mb2.box((1.24, 0.50, 0.24), (0.0, 0.0, 0.12), "SteelDark")
    mb2.box((0.34, 0.34, 1.26), (-0.30, 0.0, 0.87), "Steel")
    _report.append(("LaunchClamp_LOD2", mb2))
    mb2.build("LaunchClamp_LOD2", root)
    return mb, obj


def build_clamp_arm(pivot):
    """The half that lets go. Authored HOLDING, because frame 1 of
    Clamp_Release is the exported static pose and a pad at rest is a pad
    holding a rocket."""
    mb = of.MeshBuilder()
    # Local to clamp_pivot, which sits on the mast top at x = -0.30, so the
    # grip lands at x = +0.62 in the clamp's own space: exactly the mounting
    # radius minus the 0.625 stack radius, i.e. touching the hull.
    mb.box((0.92, 0.26, 0.22), (0.46, 0.0, 0.0), "Steel")
    mb.box((0.10, 0.30, 0.30), (0.87, 0.0, 0.0), "Hazard")
    mb.box((0.16, 0.16, 0.30), (0.0, 0.0, -0.14), "SteelDark")
    _report.append(("LaunchClamp_Arm", mb))
    return mb, mb.build("LaunchClamp_Arm", pivot)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    build_lod1(root)
    build_lod2(root)
    mbc, _ = build_clamp(root)
    arm_pivot = of.add_pivot("clamp_pivot", (-0.30, 0.0, 1.20), root)
    mba, _ = build_clamp_arm(arm_pivot)

    of.add_collision_box("col_LaunchPad", (W, W, DECK_Z),
                         (0.0, 0.0, DECK_Z * 0.5), root, role="Rock")
    of.add_collision_box("col_LaunchTower", (1.40, 1.40, H),
                         (TOWER[0], TOWER[1], H * 0.5), root, role="Steel")
    of.add_collision_box("col_LaunchClamp", (1.24, 0.50, 1.50),
                         (0.0, 0.0, 0.75), root, role="SteelDark")

    of.add_socket("socket_vessel", (0.0, 0.0, MATE_Z), UP, root,
                  {"of_role": "vessel_mate"})
    of.add_socket("socket_clamp", (CLAMP_R, 0.0, DECK_Z), INWARD, root,
                  {"of_role": "clamp_mount"})
    of.add_socket("socket_smoke", (0.0, 0.0, DECK_Z), UP, root,
                  {"of_role": "exhaust"})
    of.add_socket("socket_status", (TOWER[0], TOWER[1], H - 0.32), DOWN, root,
                  {"of_role": "state_light"})

    # Clamp_Release: the arm swings 70 degrees up and back, out of the
    # vessel's way. One-shot; played in reverse to re-clamp.
    of.add_clip_multi(arm_pivot, "Clamp_Release", {
        "rotation_euler": [(1, of.deg3()), (13, of.deg3(y=-35.0)),
                           (25, of.deg3(y=-70.0))],
        "location": [(1, (-0.30, 0.0, 1.20)), (13, (-0.30, 0.0, 1.20)),
                     (25, (-0.34, 0.0, 1.20))],
    })

    of.report(NAME, _report)
    for label, mb in (("LaunchPad_LOD0", mb0), ("LaunchClamp_LOD0", mbc),
                      ("LaunchClamp_Arm", mba)):
        lo, hi = mb.bounds()
        print("[pad] %-18s dims %s  min %s"
              % (label, [round(hi[k] - lo[k], 4) for k in range(3)],
                 [round(v, 4) for v in lo]))
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
