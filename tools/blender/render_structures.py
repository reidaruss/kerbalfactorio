"""
render_structures.py - assemble the shipped structural GLBs into a real
building and render it, so the tiling claim can be SEEN as well as computed.

    blender --background --python tools/blender/render_structures.py

Writes docs/screenshots/structures_*.png.

WHY THIS IS NOT render_check.py. render_check renders ONE file, which is the
right tool for a machine or a rigged character: an asset that is wrong is wrong
on its own. A tiling set is different. Every part here passes validate_glb.py in
isolation and the interesting failure is BETWEEN parts - a seam, an overlap, a
wall that does not reach the deck it stands on. That only exists in an assembly,
so the assembly is what gets rendered.

It loads from assets/models/dist, through the glTF importer, so what is judged
is the shipped bytes and not what was in memory when the build script ran. The
placement here uses nothing but the module constants in structure_common.py and
the documented anchors: cell centres for decks, cell edge midpoints for walls,
and structure_common.pillar_parts() for a pillar. There is not one retyped
number in the whole file. If the render shows a gap, the contract is wrong, not
the picture.

WHAT THE 4 m MODULE CHANGED HERE (DW-32). The demo room is still 3 x 3 cells and
is now 12 x 12 m, so every camera had to be recomposed rather than scaled: the
plan grew by four and the storey only by a third, so the building went from
roughly cubic to a wide, low box, and a camera rig multiplied by four would have
framed the sky. The distances below are set from the room's own size.

THE SECOND SUBJECT is the case DW-32 exists for. A foundation may hang out over
a drop, carried by its neighbour, and the gap under it is a continuous number.
structures_pillars puts a run of decks out over a stepped drop with FOUR
different gaps under it, from 0.90 m (just above the 0.70 m cutoff, so the
pillar is almost all foot and bracket) to 8.20 m (three collars). One picture
answers "does this look right at any length", which no per-part render can.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import structure_common as sc  # noqa: E402

DIST = os.path.join(ROOT, "assets", "models", "dist", "structures")
OUT = os.path.join(ROOT, "docs", "screenshots")

CELL, DECK_H, WALL_H = sc.CELL, sc.DECK_H, sc.WALL_H
N = 3                                  # the demo building is N x N cells
STOREY = sc.STOREY
ROOM = N * CELL                        # 12.00 m across

# The fill light, expressed as a direction and a distance rather than a point,
# so it can follow a subject that is 12 m across or one that is 30 m long. The
# direction and the 900 W / 8 m size are the ones the 1 m set was lit with, at
# its 11.95 m throw; energy scales with distance squared and the softbox with
# distance, which is what keeps the look identical as the subject grows.
FILL_DIR = (-0.6276, -0.7113, 0.3180)
FILL_REF_D = 11.95


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]), 0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def add_slab(name, x0, x1, y0, y1, z_top, depth=24.0):
    """A ground slab as a solid box, not a plane. The pillar scene needs the
    ground to STEP, and a stepped set of planes has no risers: the drop would
    read as a floating shelf, which is the one thing the picture is meant to
    disprove."""
    z0 = z_top - depth
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z_top), (x1, y0, z_top), (x1, y1, z_top), (x0, y1, z_top)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
         (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    me.update()
    bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, me))


def setup_world(res, focus, fill_d, slabs):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = 32
    scn.cycles.use_denoising = True
    scn.render.resolution_x, scn.render.resolution_y = res
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.17, 0.19, 0.22, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.2
    sun.data.angle = math.radians(5.0)
    sun.rotation_euler = (math.radians(54), 0.0, math.radians(-34))
    scn.collection.objects.link(sun)

    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 900.0 * (fill_d / FILL_REF_D) ** 2
    fill.data.size = 8.0 * (fill_d / FILL_REF_D)
    fill.location = tuple(focus[k] + FILL_DIR[k] * fill_d for k in range(3))
    look_at(fill, focus)
    scn.collection.objects.link(fill)

    for i, s in enumerate(slabs):
        add_slab("Ground%d" % i, *s)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.clip_start = 0.02
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def harvest():
    """Import every structural .glb and keep the LOD0 mesh datablocks (plus the
    door leaf), each with the world matrix it had inside its own file.

    Only LOD0 is kept, for the reason render_check documents: a .glb holds every
    band as siblings, and drawing LOD0 on top of LOD1 z-fights in a way that
    reads exactly like broken geometry."""
    want = {"Foundation_LOD0", "Floor_LOD0", "Wall_LOD0", "Door_LOD0",
            "Door_Leaf", "PillarFoot_LOD0", "PillarShaft_LOD0",
            "PillarCollar_LOD0", "PillarHead_LOD0"}
    kept = {}
    for stem in ("foundation", "floor", "wall", "door", "pillar"):
        bpy.ops.import_scene.gltf(filepath=os.path.join(DIST, stem + ".glb"))
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name in want:
            kept[o.name] = (o.data, o.matrix_world.copy())
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    missing = want - set(kept)
    if missing:
        raise SystemExit("missing meshes in dist: %s" % sorted(missing))
    return kept


def place(kept, key, loc, yaw_deg=0.0, scale_z=1.0):
    from mathutils import Euler, Matrix
    data, local = kept[key]
    obj = bpy.data.objects.new(key + "_inst", data)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = (Matrix.Translation(loc)
                        @ Euler((0, 0, math.radians(yaw_deg)), "XYZ").to_matrix().to_4x4()
                        @ Matrix.Diagonal((1.0, 1.0, scale_z, 1.0))
                        @ local)
    return obj


def place_pillar(kept, x, y, ground_z, deck_z=0.0):
    """One pillar under a deck whose underside is at deck_z, standing on ground
    at ground_z. The recipe is structure_common's, not this file's: only the
    shaft is scaled, and only in its own axis."""
    for stem, z, sz in sc.pillar_parts(deck_z - ground_z):
        place(kept, stem + "_LOD0", (x, y, ground_z + z), scale_z=sz)


def build_room(kept, roof=True, door_open=False):
    """A 3 x 3 cell room, placed from the documented anchors and nothing else.

    decks  cell centre  ((i + 0.5) * CELL, (j + 0.5) * CELL)
    walls  edge midpoint of the perimeter, yaw 0 for an X-running wall and
           90 for a Y-running one
    """
    for i in range(N):
        for j in range(N):
            place(kept, "Foundation_LOD0", ((i + 0.5) * CELL, (j + 0.5) * CELL, 0.0))
            if roof:
                place(kept, "Floor_LOD0",
                      ((i + 0.5) * CELL, (j + 0.5) * CELL, STOREY))
    door_cell = N // 2
    for i in range(N):
        c = (i + 0.5) * CELL
        # south (y = 0) and north (y = ROOM) edges: walls run along X, yaw 0
        south = "Door_LOD0" if i == door_cell else "Wall_LOD0"
        place(kept, south, (c, 0.0, DECK_H))
        if south == "Door_LOD0":
            leaf = place(kept, "Door_Leaf", (c, 0.0, DECK_H))
            if door_open:
                from mathutils import Euler, Matrix
                hinge = Matrix.Translation((c + sc.HINGE_X, 0.0, DECK_H))
                swing = Euler((0, 0, math.radians(-95)), "XYZ").to_matrix().to_4x4()
                back = Matrix.Translation((-(c + sc.HINGE_X), 0.0, -DECK_H))
                leaf.matrix_world = hinge @ swing @ back @ leaf.matrix_world
        place(kept, "Wall_LOD0", (c, ROOM, DECK_H))
        # west (x = 0) and east (x = ROOM) edges: walls run along Y, yaw 90
        place(kept, "Wall_LOD0", (0.0, c, DECK_H), 90.0)
        place(kept, "Wall_LOD0", (ROOM, c, DECK_H), 90.0)


def build_lineup(kept):
    """The five parts side by side on the ground: the contact sheet. Spaced one
    cell plus a metre apart, so the gaps are obviously gaps and the 4 m module
    is legible against them."""
    step = CELL + 1.0
    place(kept, "Foundation_LOD0", (-2.0 * step, 0.0, 0.0))
    place(kept, "Floor_LOD0", (-1.0 * step, 0.0, 0.0))
    place(kept, "Wall_LOD0", (0.0, 0.0, 0.0))
    place(kept, "Door_LOD0", (1.0 * step, 0.0, 0.0))
    place(kept, "Door_Leaf", (1.0 * step, 0.0, 0.0))
    # A pillar at a mid-range gap, carrying a deck, so the contact sheet shows
    # the ASSEMBLY and not four loose parts plus a mystery.
    place_pillar(kept, 2.0 * step, 0.0, 0.0, deck_z=5.60)
    place(kept, "Foundation_LOD0", (2.0 * step, 0.0, 5.60))


# The drop the pillar run walks out over. Column index -> ground height. The
# four gaps are chosen to bracket the whole usable range: 0.90 is barely above
# the 0.70 m cutoff (so the pillar is foot and bracket with 0.20 m of shaft
# between them), 3.60 takes one collar, 5.60 two, 8.20 three.
DROP = (0.0, 0.0, -0.90, -3.60, -5.60, -8.20)
RUN_ROWS = 2


def build_run(kept):
    """A run of foundations walking out over a stepped drop, on pillars."""
    for i, gz in enumerate(DROP):
        for j in range(RUN_ROWS):
            x, y = (i + 0.5) * CELL, (j + 0.5) * CELL
            place(kept, "Foundation_LOD0", (x, y, 0.0))
            place_pillar(kept, x, y, gz)
        place(kept, "Wall_LOD0", ((i + 0.5) * CELL, RUN_ROWS * CELL, DECK_H))


def run_slabs():
    """The stepped ground under build_run, as slabs that abut on the cell lines
    so the risers land exactly where the gap changes."""
    out = [(-CELL * 3.0, CELL * 2.0, -CELL * 3.0, CELL * 5.0, DROP[0])]
    for i in range(2, len(DROP)):
        x0 = i * CELL
        x1 = (i + 1) * CELL if i + 1 < len(DROP) else (i + 4) * CELL
        out.append((x0, x1, -CELL * 3.0, CELL * 5.0, DROP[i]))
    return out


def shoot(cam, pos, target, lens, name):
    cam.data.lens = lens
    cam.location = pos
    look_at(cam, target)
    path = os.path.join(OUT, name + ".png")
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_structures] wrote %s" % path)


FLAT = [(-CELL * 6.0, CELL * 9.0, -CELL * 6.0, CELL * 9.0, 0.0)]


def scene(res, focus, fill_d, slabs=None):
    """Import first, THEN light the set.

    harvest() clears bpy.data.objects wholesale to drop the imported hierarchy
    once its mesh datablocks are banked, so anything built before it - camera,
    sun, ground - is deleted too and the returned camera is a dead StructRNA.
    Order is the fix, not a smarter delete."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    kept = harvest()
    return setup_world(res, focus, fill_d, FLAT if slabs is None else slabs), kept


def main():
    mid = ROOM * 0.5                       # 6.0, the room's centre line

    # Three-quarter view. The room is 12 x 12 x 4.5 m, so the camera stands off
    # about 1.6 room-widths and looks slightly down: any closer and a 4 m wall
    # panel fills the frame, any further and the tile boundaries in the deck
    # stop being resolvable, which is the thing this shot is for.
    cam, kept = scene((1120, 700), (mid, mid, 2.0), 30.0)
    build_room(kept, roof=True, door_open=False)
    shoot(cam, (mid + 18.0, mid - 20.0, 13.5), (mid, mid, 2.0), 45.0,
          "structures_assembly_34")

    cam, kept = scene((1120, 700), (mid, mid, 1.8), 28.0)
    build_room(kept, roof=False, door_open=True)
    shoot(cam, (mid + 15.0, mid - 17.0, 15.0), (mid, mid, 1.8), 42.0,
          "structures_assembly_open")

    # The door as a player meets it: standing on the ground outside, eye at
    # 1.62 m, far enough back that the whole 4 m panel, the 1.20 x 2.40 opening
    # and the accent lintel are in frame at once. That framing IS the test - the
    # door has to read as a door in one glance from here, which is the whole
    # argument for not scaling the opening with the module.
    door_x = (N // 2 + 0.5) * CELL
    cam, kept = scene((900, 720), (door_x, 0.0, 1.9), 15.0)
    build_room(kept, roof=True, door_open=False)
    shoot(cam, (door_x, -7.0, 1.62), (door_x, 0.0, 1.90), 28.0,
          "structures_door_eye")

    cam, kept = scene((1400, 560), (0.0, 0.0, 2.8), 26.0)
    build_lineup(kept)
    shoot(cam, (0.0, -32.0, 4.2), (0.0, 0.0, 2.8), 42.0, "structures_lineup")

    # The DW-32 case: decks hanging out over a drop, on pillars of four
    # different lengths. Shot in profile-ish three-quarter so the risers, the
    # gaps and the collar rhythm are all readable in one frame.
    cam, kept = scene((1400, 720), (12.0, 4.0, -3.0), 34.0, run_slabs())
    build_run(kept)
    shoot(cam, (26.0, -30.0, 6.0), (12.0, 4.0, -3.0), 38.0, "structures_pillars")

    # The tallest one on its own, portrait, because the question a collar
    # answers ("is the rhythm right at 8 m") is a vertical question.
    tall_x = (len(DROP) - 0.5) * CELL
    cam, kept = scene((760, 940), (tall_x, 4.0, -4.0), 20.0, run_slabs())
    build_run(kept)
    shoot(cam, (tall_x + 9.0, -8.0, -1.0), (tall_x, 4.0, -4.2), 45.0,
          "structures_pillars_tall")


if __name__ == "__main__":
    main()
