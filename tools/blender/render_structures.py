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
the documented anchors: cell centres for decks, cell edge midpoints for walls.
If the render shows a gap, the contract is wrong, not the picture.
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


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]), 0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def setup_world(res):
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
    fill.data.energy = 900.0
    fill.data.size = 8.0
    fill.location = (-6.0, -7.0, 5.0)
    look_at(fill, (1.5, 1.5, 1.2))
    scn.collection.objects.link(fill)

    ground = bpy.data.meshes.new("Ground")
    ground.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)],
                       [], [(0, 1, 2, 3)])
    ground.update()
    scn.collection.objects.link(bpy.data.objects.new("Ground", ground))

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
            "Door_Leaf"}
    kept = {}
    for stem in ("foundation", "floor", "wall", "door"):
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


def place(kept, key, loc, yaw_deg=0.0):
    from mathutils import Euler, Matrix
    data, local = kept[key]
    obj = bpy.data.objects.new(key + "_inst", data)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = (Matrix.Translation(loc)
                        @ Euler((0, 0, math.radians(yaw_deg)), "XYZ").to_matrix().to_4x4()
                        @ local)
    return obj


def build_room(kept, roof=True, door_open=False):
    """A 3 x 3 cell room, placed from the documented anchors and nothing else.

    decks  cell centre  (i + 0.5, j + 0.5)
    walls  edge midpoint of the perimeter, yaw 0 for an X-running wall and
           90 for a Y-running one
    """
    for i in range(N):
        for j in range(N):
            place(kept, "Foundation_LOD0", (i + 0.5, j + 0.5, 0.0))
            if roof:
                place(kept, "Floor_LOD0", (i + 0.5, j + 0.5, STOREY))
    door_cell = N // 2
    for i in range(N):
        # south (y = 0) and north (y = N) edges: walls run along X, yaw 0
        south = "Door_LOD0" if i == door_cell else "Wall_LOD0"
        place(kept, south, (i + 0.5, 0.0, DECK_H))
        if south == "Door_LOD0":
            leaf = place(kept, "Door_Leaf", (i + 0.5, 0.0, DECK_H))
            if door_open:
                from mathutils import Euler, Matrix
                hinge = Matrix.Translation((i + 0.5 + sc.HINGE_X, 0.0, DECK_H))
                swing = Euler((0, 0, math.radians(-95)), "XYZ").to_matrix().to_4x4()
                back = Matrix.Translation((-(i + 0.5 + sc.HINGE_X), 0.0, -DECK_H))
                leaf.matrix_world = hinge @ swing @ back @ leaf.matrix_world
        place(kept, "Wall_LOD0", (i + 0.5, float(N), DECK_H))
        # west (x = 0) and east (x = N) edges: walls run along Y, yaw 90
        place(kept, "Wall_LOD0", (0.0, i + 0.5, DECK_H), 90.0)
        place(kept, "Wall_LOD0", (float(N), i + 0.5, DECK_H), 90.0)


def build_lineup(kept):
    """The four parts side by side on the ground: the contact sheet."""
    place(kept, "Foundation_LOD0", (-2.4, 0.0, 0.0))
    place(kept, "Floor_LOD0", (-1.2, 0.0, 0.0))
    place(kept, "Wall_LOD0", (0.2, 0.0, 0.0))
    place(kept, "Door_LOD0", (1.6, 0.0, 0.0))
    place(kept, "Door_Leaf", (1.6, 0.0, 0.0))


def shoot(cam, pos, target, lens, name):
    cam.data.lens = lens
    cam.location = pos
    look_at(cam, target)
    path = os.path.join(OUT, name + ".png")
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_structures] wrote %s" % path)


def scene(res):
    """Import first, THEN light the set.

    harvest() clears bpy.data.objects wholesale to drop the imported hierarchy
    once its mesh datablocks are banked, so anything built before it - camera,
    sun, ground - is deleted too and the returned camera is a dead StructRNA.
    Order is the fix, not a smarter delete."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    kept = harvest()
    return setup_world(res), kept


def main():
    cam, kept = scene((960, 600))
    build_room(kept, roof=True, door_open=False)
    shoot(cam, (8.6, -8.2, 5.6), (1.5, 1.5, 1.5), 48.0, "structures_assembly_34")

    cam, kept = scene((960, 600))
    build_room(kept, roof=False, door_open=True)
    shoot(cam, (7.4, -7.0, 6.4), (1.5, 1.5, 1.4), 44.0, "structures_assembly_open")

    # The door as a player meets it: standing on the ground outside, eye at
    # 1.62 m, far enough back that the whole 2.5 m opening and the accent
    # lintel are in frame at once. That framing IS the test - the door has to
    # read as a door in one glance from here.
    cam, kept = scene((820, 600))
    build_room(kept, roof=True, door_open=False)
    shoot(cam, (1.5, -4.4, 1.62), (1.5, 0.0, 1.70), 26.0, "structures_door_eye")

    cam, kept = scene((1100, 520))
    build_lineup(kept)
    shoot(cam, (0.2, -9.2, 3.1), (-0.4, 0.0, 1.15), 42.0, "structures_lineup")


if __name__ == "__main__":
    main()
