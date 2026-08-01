"""render_machines.py - look at a machine, and look at a PRODUCTION LINE of them.

    blender --background --python tools/blender/render_machines.py -- \\
        assets/models/dist/machines/assembler.glb docs/screenshots/RN371 \\
        studio:Assembler face:Assembler det:Assembler

    blender --background --python tools/blender/render_machines.py -- \\
        machines/miner.glb,machines/smelter.glb,machines/assembler.glb,\\
        machines/box.glb,machines/belt_segment.glb,machines/belt_curve_l.glb,\\
        machines/belt_curve_r.glb,machines/belt_end_cap.glb,\\
        machines/power_pole.glb,machines/generator.glb,machines/inserter.glb,\\
        player/player_body.glb \\
        docs/screenshots/RN371 line:7

WHY NOT render_check.py. That harness frames a 1.8 m player. Its machine views
(`surfmach`, `detmach`) were computed for a 4.4 m frame width, which is right
for a smelter and crops an 8 m assembler; it has no floor of its own, no way to
draw more than one copy of anything, and no view at the height a player stands.
More importantly it CANNOT SHOW THE THING THIS PASS IS ABOUT. A factory is not
looked at one machine at a time. The defect being fixed is that a base made of
these objects reads as a set of extruded boxes, and a single hero render of one
box cannot show that either way: a lane that only ever renders one machine can
ship a well-detailed asset and still leave the base looking like a car park.

THE LINE SHOT IS THE INSTRUMENT. It places the machines on the SITE GRID the
client snaps to (1 m cells, an even footprint centring on an integer) and runs
real belt tiles between them, including the two curve handednesses, at the
sockets' own heights. So the frame answers questions no studio render can:
does a belt visibly run INTO a port, do four machines standing together read as
four different machines, does the silhouette of a line have anything in it
above the roofline, and is there anything at ankle height where the player
walks. The player body is loaded as a SCALE REFERENCE and is the only honest
one available: these are 3 m to 8 m objects and every intuition about greeble
size is wrong without a person in the frame.

WHAT COUNTS AS DRAWN, and it is not the same rule flora uses. A machine .glb
holds LOD0, LOD1, LOD2, a col_ proxy AND one or more animated SIBLINGS that the
client draws alongside LOD0 (Assembler_Arm, Miner_Drill, Box_Lid, Smelter_Glow,
Belt_Slats, Generator_Flywheel, Inserter_Arm). `render_flora.lod0_objects`
keeps only names ending `_LOD0`, which would silently drop every one of those,
and the assembler's arm is the one part of that machine allowed to break the
box silhouette. So the rule here is: hide `col_*` and any explicit `_LOD1..9`,
keep everything else.

Both framing bugs found in render_flora.py at RN-306 are fixed here at birth
rather than inherited: `visible_objects` sets `hide_render` BOTH ways, so a
second shot in one invocation does not render an empty frame, and every view
frames by whichever of height and footprint is LARGER, because a 1 m belt tile
is 0.30 m tall and a plinth is wider than it is high.

Cycles on the CPU with a modest sample count, for render_check.py's reason: a
check that only runs where a GPU context exists is not a check. Lighting is
deliberately plain and is IDENTICAL across a before/after pair. It is not a
look-development statement and must not be read as one: this pass is geometry,
look development owns every material value, and the lighting exists only so
that two geometries can be compared under it.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]),
                          0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def set_res(w, h, samples):
    """Resolution is PER SHOT, because each view has its own aspect argument.

    Every distance in this file is solved from the sensor fit, and Blender fits
    the 36 mm sensor to the LARGER pixel dimension, so a view that computes its
    stand-off must also own the frame it computed it for. Setting the
    resolution once at launch is what forced the first `face:` view to frame an
    8 x 4 machine inside a 720 x 640 window and lose half the picture."""
    scn = bpy.context.scene
    scn.render.resolution_x = w
    scn.render.resolution_y = h
    scn.cycles.samples = samples


def setup_world(w, h, samples):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.use_denoising = True
    set_res(w, h, samples)
    scn.render.film_transparent = False
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.20, 0.23, 0.27, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.4
    sun.data.angle = math.radians(3.0)
    sun.rotation_euler = (math.radians(58), 0.0, math.radians(34))
    bpy.context.scene.collection.objects.link(sun)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 50.0
    cam.data.clip_start = 0.02
    cam.data.clip_end = 900.0
    bpy.context.scene.collection.objects.link(cam)
    scn.camera = cam
    return cam


def add_ground(size=160.0):
    """A neutral floor. Mid grey, matte, no texture: the point of every frame
    here is form against a background, and a patterned floor competes with the
    thing being judged."""
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata([(-size, -size, 0), (size, -size, 0),
                      (size, size, 0), (-size, size, 0)], [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new("Ground", mesh)
    mat = bpy.data.materials.new("Floor")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.20, 0.20, 0.21, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.92
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _is_lodn(name):
    return any(name.endswith("_LOD%d" % i) for i in range(1, 10))


def visible_objects(stem=None):
    """The meshes the client actually draws for `stem`: LOD0 plus the animated
    siblings that ride with it, never a col_ proxy and never a lower band.

    Rendering a .glb raw draws LOD0, LOD1 and LOD2 on top of one another, and
    two nearly coincident surfaces z-fight, which reads exactly like broken
    geometry. Keeping ONLY `_LOD0` is the opposite error for a machine: the
    assembler's arm, the miner's drill column, the box's lid and every belt's
    slat strip are siblings of LOD0 and are drawn with it.

    Sets hide_render BOTH ways on purpose (render_flora.py's RN-306 bug, not
    inherited): a second shot in one invocation must be able to show what the
    first one hid."""
    out = []
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        n = o.name
        if n.startswith("col_") or _is_lodn(n):
            o.hide_render = True
            continue
        if stem is not None and not n.startswith(stem):
            o.hide_render = True
            continue
        o.hide_render = False
        out.append(o)
    return out


def bounds_of(objs):
    lo = [1e30] * 3
    hi = [-1e30] * 3
    for o in objs:
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            for k in range(3):
                lo[k] = min(lo[k], p[k])
                hi[k] = max(hi[k], p[k])
    return lo, hi


def studio(cam, stem, out_prefix, tag_suffix=""):
    """One machine on the neutral floor, from two bearings 90 degrees apart.

    Framed by whichever of height and footprint is LARGER. Fitting height alone
    is the bug render_flora.py shipped for a whole pass: a 1 m belt tile is
    0.30 m tall and 1.00 m across, and a plinth is always wider than it is
    high, so a height fit puts the camera inside the asset."""
    objs = visible_objects(stem)
    lo, hi = bounds_of(objs)
    set_res(720, 640, 28)
    h = hi[2] - lo[2]
    r = max(hi[0] - lo[0], hi[1] - lo[1])
    d = (max(h, r * 0.62) * 1.30) * 50.0 / 24.0
    for tag, az in (("a", -118.0), ("b", -32.0)):
        a = math.radians(az)
        cam.data.lens = 50.0
        cam.location = (d * math.cos(a), d * math.sin(a),
                        max(h * 0.55, d * 0.30))
        look_at(cam, (0.0, 0.0, h * 0.44))
        path = os.path.join(ROOT, "%s_%s%s_%s.png"
                            % (out_prefix, stem.lower(), tag_suffix, tag))
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("[render_machines] wrote %s  (h=%.2f w=%.2f d=%.2f)"
              % (path, h, r, d))


def face(cam, stem, out_prefix, tag_suffix=""):
    """The front (-Y) face from a standing player's eye at 1.66 m.

    THIS IS THE VIEW THE GAME ACTUALLY SHOWS. A player walks up to the port
    side of a machine and stands there; nobody in this game ever floats at the
    42 degree elevation a studio render uses. It is also the only frame in
    which the bottom metre of a 4 m machine, the part that gets kicked, is more
    than a few pixels tall.

    THE FRAME IS LANDSCAPE AND THAT IS ARITHMETIC, NOT TASTE. These machines
    are 8 x 4 and 4 x 3, so fitting the width inside a squarer frame leaves
    half the picture empty and shrinks the subject to the point where the pass
    cannot be judged: the first version of this view put a 4 m machine across
    43 percent of the frame height. The stand-off is then derived from the
    asset's own bounds rather than typed, so an 8 m assembler and a 1 m belt
    tile are both framed without a per-asset special case."""
    objs = visible_objects(stem)
    lo, hi = bounds_of(objs)
    h = hi[2] - lo[2]
    w = hi[0] - lo[0]
    set_res(960, 540, 28)
    # 30 mm on a 36 mm sensor fitted to the LARGER frame dimension, which at
    # 960 x 540 is x: half angle atan(18 / 30) = 30.96 deg, tan 0.600, so the
    # frame is 1.200 * d wide and (540 / 960) of that tall, i.e. 0.675 * d.
    d = max(2.2, max(w / 1.200, h / 0.675) * 1.14)
    cam.data.lens = 30.0
    # Off the centre line by 15 degrees: dead-on flattens every recess in the
    # face into paint, which is the exact defect this pass is about.
    a = math.radians(-90.0 - 15.0)
    cam.location = (d * math.cos(a), lo[1] + d * math.sin(a), 1.66)
    look_at(cam, (0.0, lo[1], h * 0.46))
    path = os.path.join(ROOT, "%s_%s%s_face.png"
                        % (out_prefix, stem.lower(), tag_suffix))
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_machines] wrote %s  (stand-off %.2f m, %.2f x %.2f asset)"
          % (path, d, w, h))


def det(cam, stem, out_prefix, tag_suffix=""):
    """Roughly 1.3 m of the front-lower corner, INCLUDING the ground contact.

    RN-100's `det*` argument, aimed at geometry rather than at texture: a bolt
    head is 0.03 m and is four pixels in a whole-machine frame, so a greeble
    pass judged only at studio distance is judged where it cannot show.
    INSTRUMENTS.md names that trap; this is the frame that closes it.

    It is aimed LOW and at a CORNER on purpose. Low, because the bottom metre
    is where a machine gets kicked and where wear has to be if it is anywhere.
    At a corner, because a frame with no silhouette edge in it cannot show
    whether the outline gained anything, and a flat-on frame of a flat panel is
    a picture of a colour."""
    objs = visible_objects(stem)
    lo, hi = bounds_of(objs)
    set_res(720, 640, 30)
    tx, ty, tz = lo[0] + (hi[0] - lo[0]) * 0.17, lo[1], 0.62
    # 45 mm: half angle atan(18 / 45) = 21.8 deg, so 1.3 m of surface sits at
    # 1.62 m of standoff. The camera is offset in +X and up, so the corner runs
    # diagonally through the frame and both faces are lit differently.
    cam.data.lens = 45.0
    cam.location = (tx + 0.98, ty - 1.42, tz + 0.72)
    look_at(cam, (tx, ty, tz))
    path = os.path.join(ROOT, "%s_%s%s_det.png"
                        % (out_prefix, stem.lower(), tag_suffix))
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_machines] wrote %s  (aimed at %.2f, %.2f, %.2f)"
          % (path, tx, ty, tz))


# --- the built factory -----------------------------------------------------
#
# (stem, x, y, yaw degrees). Coordinates are the client's SITE GRID: machines
# snap at floor(p) + 0.5 on a 1 m grid, an even footprint therefore centres on
# an integer, and a 1 m belt tile centres on a half integer. Every number below
# obeys that, so nothing here is a diorama coordinate that the game could not
# produce.
#
# The layout, and why it is this one:
#   Three producers stand shoulder to shoulder with their -Y faces on ONE line
#   at y = 1, which is what a real base looks like and what makes four machines
#   at four different heights comparable in one frame.
#   Each drops onto a spur, the two side spurs turn onto the trunk through the
#   two curve handednesses (a left curve and a right curve, so both shipped
#   tiles are exercised), and the trunk runs 8 m toward the camera into a
#   chest. Flow is the tiles' own: a straight tile flows along -Y, so a tile
#   flowing +X is yawed +90 and one flowing -X is yawed -90.
FACTORY = (
    ("Assembler", 0, 6, 0.0),
    ("Smelter", -6, 4, 0.0),
    # The miner stands at x = 10 and not at x = 6, and that is the camera's
    # arithmetic rather than a preference: from the eye position below, a
    # machine at x = 6 sits on almost exactly the bearing of the assembler's
    # own right edge and is hidden behind it. A frame that exists to show four
    # machines cannot afford to show three.
    ("Miner", 10, 4, 0.0),
    ("Box", 0, -9, 0.0),
    ("Generator", -11, 8, 0.0),
    ("PowerPole", -3, 1, 0.0),
    ("PowerPole", 8, 1, 0.0),
    ("PowerPole", 3, -8, 0.0),
    ("Inserter", 3, -6, 0.0),
    # the trunk, flowing -Y from under the assembler to the chest
    ("BeltSegment", 0.0, 1.5, 0.0),
    ("BeltSegment", 0.0, 0.5, 0.0),
    ("BeltSegment", 0.0, -0.5, 0.0),
    ("BeltSegment", 0.0, -1.5, 0.0),
    ("BeltSegment", 0.0, -2.5, 0.0),
    ("BeltSegment", 0.0, -3.5, 0.0),
    ("BeltSegment", 0.0, -4.5, 0.0),
    ("BeltSegment", 0.0, -5.5, 0.0),
    ("BeltEndCap", 0.0, -6.5, 0.0),
    # smelter spur: down two cells, right turn onto +X, then four straights
    ("BeltSegment", -6.0, 1.5, 0.0),
    ("BeltSegment", -6.0, 0.5, 0.0),
    ("BeltCurveR", -6.0, -0.5, 0.0),
    ("BeltSegment", -5.0, -0.5, 90.0),
    ("BeltSegment", -4.0, -0.5, 90.0),
    ("BeltSegment", -3.0, -0.5, 90.0),
    ("BeltSegment", -2.0, -0.5, 90.0),
    ("BeltSegment", -1.0, -0.5, 90.0),
    # miner spur: down two cells, left turn onto -X, then eight straights
    ("BeltSegment", 10.0, 1.5, 0.0),
    ("BeltSegment", 10.0, 0.5, 0.0),
    ("BeltCurveL", 10.0, -0.5, 0.0),
    ("BeltSegment", 9.0, -0.5, -90.0),
    ("BeltSegment", 8.0, -0.5, -90.0),
    ("BeltSegment", 7.0, -0.5, -90.0),
    ("BeltSegment", 6.0, -0.5, -90.0),
    ("BeltSegment", 5.0, -0.5, -90.0),
    ("BeltSegment", 4.0, -0.5, -90.0),
    ("BeltSegment", 3.0, -0.5, -90.0),
    ("BeltSegment", 2.0, -0.5, -90.0),
    ("BeltSegment", 1.0, -0.5, -90.0),
    # the scale reference, and it is the whole reason the numbers read
    ("Player", -3.2, -4.6, 150.0),
)


def _place_copy(objs, x, y, yaw):
    for o in objs:
        c = o.copy()
        c.data = o.data
        c.hide_render = False
        c.location = (x, y, 0.0)
        c.rotation_euler = (0.0, 0.0, math.radians(yaw))
        bpy.context.scene.collection.objects.link(c)


def line(cam, seed, out_prefix, tag="line"):
    """The built factory: several machines and belt tiles as a player meets
    them, on the grid the client snaps to."""
    src, roots = {}, {}
    set_res(1180, 560, 26)
    for o in list(bpy.data.objects):
        if o.type == "MESH":
            o.hide_render = True
    for o in list(bpy.data.objects):
        n = o.name
        if o.type == "MESH" and not n.startswith("col_") and not _is_lodn(n):
            stem = n.rsplit("_LOD0", 1)[0] if n.endswith("_LOD0") else n
            # A sibling is named <Stem>_<Part>, so the stem is the longest
            # declared name the object name starts with. Resolved against the
            # FACTORY table rather than by splitting on underscore, because
            # "BeltEndCap_Slats" would split wrongly and "Box_Lid" would not.
            for want in {row[0] for row in FACTORY}:
                if n.startswith(want):
                    stem = want
                    break
            src.setdefault(stem, []).append(o)
        if o.parent is None and o.type in ("EMPTY", "ARMATURE"):
            roots[n] = o

    placed, missing = 0, []
    for stem, x, y, yaw in FACTORY:
        if stem == "Player":
            # NOT copied. The player mesh is skinned, and a copy sharing one
            # armature modifier evaluates in the armature's space rather than
            # the copy's, so a copied player stands wherever the original
            # stands. There is one of him, so the ROOT is moved instead.
            root = roots.get("Player")
            if root is None:
                missing.append(stem)
                continue
            for o in src.get("Player", []):
                o.hide_render = False
            root.location = (x, y, 0.0)
            root.rotation_euler = (0.0, 0.0, math.radians(yaw))
            placed += 1
            continue
        parts = src.get(stem)
        if not parts:
            missing.append(stem)
            continue
        _place_copy(parts, x, y, yaw)
        placed += 1
    if missing:
        print("[render_machines] line: NOT IN THE LOADED GLB(s): %s"
              % ", ".join(sorted(set(missing))))
    bpy.context.view_layer.update()

    # Three quarters on, from a walking height rather than a crane. 24 mm and
    # 4.6 m up: high enough that the trunk belt is not hidden behind the chest,
    # low enough that the machines still stand ABOVE the horizon, which is the
    # only way a roofline is a silhouette at all.
    cam.data.lens = 24.0
    cam.location = (-15.0, -19.5, 5.60)
    look_at(cam, (1.6, 1.2, 1.90))
    path = os.path.join(ROOT, "%s_%s.png" % (out_prefix, tag))
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_machines] wrote %s  (%d placements, seed %d)"
          % (path, placed, seed))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 3:
        print(__doc__)
        return
    glb, out_prefix, shots = argv[0], argv[1], argv[2:]
    w, h, samples = 720, 640, 28
    if shots[0].startswith("line"):
        w, h, samples = 1180, 560, 26
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 60
    cam = setup_world(w, h, samples)
    # A COMMA-SEPARATED LIST, because a production line is not in one file.
    # A path with no directory separator is resolved under assets/models/dist,
    # so the eleven-file line shot fits on a command line.
    for one in glb.split(","):
        one = one.strip()
        if not os.path.isabs(one):
            one = os.path.join(ROOT, one if one.startswith("assets")
                               else os.path.join("assets", "models", "dist",
                                                 one))
        bpy.ops.import_scene.gltf(filepath=one)
    add_ground()
    os.makedirs(os.path.join(ROOT, os.path.dirname(out_prefix)), exist_ok=True)
    for shot in shots:
        kind, rest = shot.split(":", 1)
        suffix = ""
        if "@" in rest:
            rest, suffix = rest.split("@", 1)
            suffix = "_" + suffix
        if kind == "studio":
            studio(cam, rest, out_prefix, suffix)
        elif kind == "face":
            face(cam, rest, out_prefix, suffix)
        elif kind == "det":
            det(cam, rest, out_prefix, suffix)
        elif kind == "line":
            line(cam, int(rest), out_prefix)
        else:
            print("[render_machines] unknown shot %r" % shot)


if __name__ == "__main__":
    main()
