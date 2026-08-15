"""
render_launch_pad.py - assemble the shipped launch pad the way the renderer
will, stand a class L rocket and a person on it, and photograph it.

    ~/.local/bin/blender501 --background --python tools/blender/render_launch_pad.py
    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" \
        --background --python tools/blender/render_launch_pad.py

PIN THE VERSION (RN-1690). This tool wrote `blender` bare, which is the hazard
docs/scope/ART-CAMPAIGN-2026-08-13.md names in its pipeline row: only
build_ruin and render_ruin pinned 5.0.1 and 79 other invocations did not, so a
machine with a different Blender on PATH silently renders a different picture
into the same receipt filename. Both spellings of the pinned 5.0.1 are given
above because the campaign now runs on Reid's Windows desktop as well as on
the VM.

Writes docs/screenshots/W12_pad_*.png. Tile them with

    python tools/blender/contact_sheet.py docs/screenshots/W12_pad_sheet.png \
        --glob "docs/screenshots/W12_pad_*.png"

WHY THIS IS NOT render_check.py. render_check renders ONE file's own nodes
where they sit, which is the right tool for a machine. The launch pad is a
file whose parts DELIBERATELY overlap on the origin: `LaunchClamp` is a
separate ground-pivoted mesh sitting at (0, 0, 0) waiting for the renderer to
clone it four times onto the circle `socket_clamp` marks. Photographed as-is,
the asset is a clamp buried in a flame hole. The interesting questions here -
does the clamp reach the hull, does the umbilical arm reach the stack, is
24 m actually big - only exist in the ASSEMBLY, so the assembly is what gets
photographed.

EVERYTHING IS READ OFF THE SHIPPED BYTES. The clamp circle comes from
`socket_clamp`, the rocket's seat from `socket_vessel`, and the stack is
assembled with the one published rule (`next.z += this.socket_stack_top.z`)
exactly as check_mating.py does it. There is not one retyped dimension in this
file. If a render shows a gap, the asset is wrong, not the picture.

THE HUMAN IS THE POINT OF THE HUMAN. Reid asked for big, twice. "Big" is not a
property of a mesh, it is a RATIO, and a render with nothing of known size in
it cannot show one. So `player_body.glb` stands on the deck in three of these
shots at its own shipped height, and the landmark shot is taken from 150 m
where the only cue left is the mast against the sky.

MAPS ON. `surface_preview.apply_all()` wires the DW-35 surface families onto
the OF_* materials before every shot, so what is judged is the shipped
geometry AND the shipped pixels. Materials arriving from three different .glb
files collide by name, and Blender resolves that with a `.001` suffix that
`apply_all` would silently skip - so they are remapped back onto the canonical
role first. A preview that quietly leaves a third of the set flat is worse
than no preview.
"""

import math
import os
import re
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import surface_preview  # noqa: E402

DIST = os.path.join(ROOT, "assets", "models", "dist")
OUT = os.path.join(ROOT, "docs", "screenshots")
# OF_PAD_PREFIX EXISTS BECAUSE THIS TOOL OVERWROTE ITS OWN HISTORY (RN-437).
# A matched pair is made by rendering the shipped bytes, restoring HEAD's .glb
# into dist, rendering again and rebuilding. With a fixed prefix the second
# pass silently replaced the eight W12_pad_* screenshots the GP-57 pad pass
# committed, i.e. a tool for comparing two versions destroyed the older one.
# They were recovered with `git checkout --`, which only worked because they
# were tracked; had they been the usual untracked screenshot they would simply
# have been gone.
PREFIX = os.environ.get("OF_PAD_PREFIX", "") or "W12_pad_"

PAD = os.path.join(DIST, "rocket", "launch_pad.glb")
PARTS = os.path.join(DIST, "rocket", "rocket_parts.glb")
PLAYER = os.path.join(DIST, "player", "player_body.glb")

# The reference vessel: check_mating.py's CHAIN_L, the class L stack that
# crosses to class S through the adapter. Bottom up.
CHAIN_L = ["LiquidEngineLarge", "LiquidTankLarge", "StackDecouplerLarge",
           "StackAdapter", "LiquidTankSmall", "NoseCone"]

FILL_DIR = (-0.6276, -0.7113, 0.3180)
FILL_REF_D = 11.95

BANK = {}          # name -> (mesh datablock, local matrix)
SOCKET = {}        # name -> matrix_world inside launch_pad.glb
STACK = []         # (mesh, local matrix, z offset) for the assembled vessel
PLAYER_H = 0.0


# ---------------------------------------------------------------------------
# Import and banking
# ---------------------------------------------------------------------------

_SUFFIX = re.compile(r"^(OF_.+)\.\d{3}$")


def dedupe_materials():
    """Fold OF_Steel.001 back onto OF_Steel.

    Three .glb files each carry their own copy of the palette, and Blender
    uniquifies the names on import. surface_preview keys on the role name, so
    a suffixed duplicate is not a role and is skipped - which would leave the
    rocket flat next to a textured pad and make the comparison a lie."""
    folded = 0
    for mat in list(bpy.data.materials):
        m = _SUFFIX.match(mat.name)
        if not m:
            continue
        canon = bpy.data.materials.get(m.group(1))
        if canon is None or canon is mat:
            continue
        mat.user_remap(canon)
        bpy.data.materials.remove(mat)
        folded += 1
    print("[render_pad] folded %d duplicate material(s) back onto their role"
          % folded)


def base(name):
    return name.split(".")[0]


def socket_under(obj, want):
    """The first descendant Empty whose base name is `want`. Socket names are
    a runtime contract and are duplicated across parts inside one file, so
    they must be looked up UNDER their part, never by name at the file root."""
    for c in obj.children_recursive:
        if base(c.name) == want:
            return c
    return None


def harvest():
    """Import the three files once, bank every mesh datablock and the socket
    transforms, then drop the imported hierarchy."""
    global PLAYER_H
    for path in (PAD, PARTS, PLAYER):
        if not os.path.isfile(path):
            raise SystemExit("missing %s" % path)
        bpy.ops.import_scene.gltf(filepath=path)
    dedupe_materials()

    for o in bpy.data.objects:
        if o.type == "MESH":
            BANK.setdefault(o.name, (o.data, o.matrix_world.copy()))
            o.data.use_fake_user = True
    for want in ("socket_clamp", "socket_vessel", "socket_umbilical",
                 "socket_smoke"):
        o = bpy.data.objects.get(want)
        if o is None:
            raise SystemExit("launch_pad.glb has no %s" % want)
        SOCKET[want] = o.matrix_world.copy()

    # The vessel, assembled from socket_stack_top and nothing else.
    z = 0.0
    for name in CHAIN_L:
        grp = bpy.data.objects.get(name)
        mesh = bpy.data.objects.get(name + "_LOD0")
        if grp is None or mesh is None:
            raise SystemExit("rocket_parts.glb has no %s" % name)
        STACK.append((mesh.data, mesh.matrix_world.copy(), z))
        top = socket_under(grp, "socket_stack_top")
        if top is None:
            break
        z += top.matrix_world.translation.z
    print("[render_pad] class L stack assembled to %.3f m of hardware" % z)

    p = bpy.data.objects.get("Player_LOD0")
    if p is not None:
        lo = min((p.matrix_world @ v.co).z for v in p.data.vertices)
        hi = max((p.matrix_world @ v.co).z for v in p.data.vertices)
        PLAYER_H = hi - lo
        print("[render_pad] human scale reference is %.3f m tall" % PLAYER_H)

    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)


# ---------------------------------------------------------------------------
# Placement
# ---------------------------------------------------------------------------

def place(key, world=None):
    from mathutils import Matrix
    data, local = BANK[key]
    obj = bpy.data.objects.new(key + "_inst", data)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = (Matrix.Identity(4) if world is None else world) @ local
    return obj


def build_pad(clamps=True):
    place("LaunchPad_LOD0")
    if not clamps:
        return
    from mathutils import Matrix
    # FOUR clamps, at 90 degree steps around the circle socket_clamp marks.
    # The whole placement is `yaw @ socket`, which is the rule the runtime
    # gets: one socket transform, one rotation per instance, no table.
    for i in range(4):
        yaw = Matrix.Rotation(math.radians(90.0 * i), 4, "Z")
        m = yaw @ SOCKET["socket_clamp"]
        place("LaunchClamp_LOD0", m)
        place("LaunchClamp_Arm", m)


def build_vessel():
    from mathutils import Matrix
    seat = SOCKET["socket_vessel"].translation
    for data, local, z in STACK:
        obj = bpy.data.objects.new("stack_inst", data)
        bpy.context.scene.collection.objects.link(obj)
        obj.matrix_world = Matrix.Translation(
            (seat.x, seat.y, seat.z + z)) @ local
    return seat.z + sum(1 for _ in STACK) * 0.0


def build_human(x, y, z, yaw_deg=0.0):
    from mathutils import Euler, Matrix
    if "Player_LOD0" not in BANK:
        return None
    m = (Matrix.Translation((x, y, z))
         @ Euler((0, 0, math.radians(yaw_deg)), "XYZ").to_matrix().to_4x4())
    return place("Player_LOD0", m)


# ---------------------------------------------------------------------------
# Set, camera, shutter
# ---------------------------------------------------------------------------

def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]), 0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def add_ground(half=140.0, z=0.0):
    v = [(-half, -half, z - 30.0), (half, -half, z - 30.0),
         (half, half, z - 30.0), (-half, half, z - 30.0),
         (-half, -half, z), (half, -half, z), (half, half, z), (-half, half, z)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
         (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me = bpy.data.meshes.new("Ground")
    me.from_pydata(v, [], f)
    me.update()
    mat = bpy.data.materials.get("PadGround")
    if mat is None:
        mat = bpy.data.materials.new("PadGround")
        mat.use_nodes = True
        mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"] \
            .default_value = (0.055, 0.052, 0.046, 1.0)
        mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"] \
            .default_value = 0.95
    me.materials.append(mat)
    bpy.context.scene.collection.objects.link(bpy.data.objects.new("Ground",
                                                                   me))


def setup_world(res, focus, fill_d, samples=32, fill_pos=None):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.render.resolution_x, scn.render.resolution_y = res
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.16, 0.19, 0.24, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.2
    sun.data.angle = math.radians(4.0)
    sun.rotation_euler = (math.radians(56), 0.0, math.radians(-38))
    scn.collection.objects.link(sun)

    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 900.0 * (fill_d / FILL_REF_D) ** 2
    fill.data.size = 8.0 * (fill_d / FILL_REF_D)
    # The default fill sits ABOVE the subject, which is right for everything
    # except a shot taken inside a 1.70 m trench with a launch table for a
    # roof: there the deck occludes it completely and the frame comes back as
    # a silhouette. `fill_pos` lets that one shot put the light down the
    # channel with the camera, where the light in a trench actually comes
    # from.
    fill.location = (tuple(focus[k] + FILL_DIR[k] * fill_d for k in range(3))
                     if fill_pos is None else tuple(fill_pos))
    look_at(fill, focus)
    scn.collection.objects.link(fill)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.clip_start = 0.05
    cam.data.clip_end = 2000.0
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def scene(res, focus, fill_d, samples=32, ground=True, fill_pos=None):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    if ground:
        add_ground()
    return setup_world(res, focus, fill_d, samples, fill_pos)


def shoot(cam, pos, target, lens, name):
    surface_preview.apply_all(quiet=True)
    cam.data.lens = lens
    cam.location = pos
    look_at(cam, target)
    path = os.path.join(OUT, PREFIX + name + ".png")
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_pad] wrote %s" % path)


# ---------------------------------------------------------------------------

def main():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    harvest()
    surface_preview.apply_all()

    deck = SOCKET["socket_vessel"].translation.z

    # 1. The hero: three-quarter, the whole thing, rocket on the mount.
    cam = scene((1280, 800), (0.0, 0.0, 10.0), 46.0, samples=40)
    build_pad()
    build_vessel()
    build_human(6.6, -5.4, deck, 200.0)
    build_human(-5.0, 6.0, deck, 20.0)
    shoot(cam, (36.0, -44.0, 24.0), (0.0, 0.0, 9.5), 40.0, "hero")

    # 2. The asset ALONE, no vessel, no clamps placed: what the file is,
    #    judged on its own terms.
    cam = scene((1280, 800), (0.0, 0.0, 9.0), 44.0)
    build_pad(clamps=False)
    shoot(cam, (-40.0, 38.0, 22.0), (0.0, 0.0, 8.5), 40.0, "bare_nw")

    # 3. The landmark read: 150 m out, near ground level, which is the
    #    distance the LOD2 mast is drawn at and the distance a player
    #    navigates back from.
    cam = scene((1280, 640), (0.0, 0.0, 12.0), 90.0)
    build_pad()
    build_vessel()
    shoot(cam, (108.0, -104.0, 9.0), (-2.0, 0.0, 12.0), 50.0, "landmark_150m")

    # 4. Human scale, deck level. Eye at 1.62 m ON the deck, looking at the
    #    mount: rails, stair, striping and a person, all in one frame.
    # The first sheet had this frame come back BLACK: the eye point stood
    # inside the control bunker, which is a 4 x 2.6 x 1.7 m solid at
    # (8.4, -8.0) on the east bank. A camera inside a box renders its inside.
    cam = scene((1100, 780), (2.0, 0.0, 3.4), 16.0)
    build_pad()
    build_vessel()
    build_human(4.9, -2.4, deck, 150.0)
    shoot(cam, (9.4, -4.2, deck + 1.62), (1.2, -0.4, 3.4), 30.0, "human_deck")

    # 5. The flame trench from its own mouth, at the height of the trench
    #    floor: the deflector, the mount underside, the girders, and 1.70 m
    #    of concrete over your head.
    # The first sheet had the deflector invisible here - same value as the
    # floor it stands on, 9 m away and under the table's shadow. It is steel
    # now and 2.6 m longer, and the camera has come 2 m closer and dropped to
    # the height of the ridge instead of looking over it.
    cam = scene((1200, 720), (0.0, 1.0, 0.9), 7.0, samples=48,
                fill_pos=(2.6, 12.0, 1.55))
    build_pad()
    build_vessel()
    build_human(2.6, 8.4, 0.30, 200.0)
    shoot(cam, (-2.5, 12.4, 1.42), (0.2, 0.2, 0.80), 20.0, "trench")

    # 6. The mount and the four clamps holding a 2.50 m stack. This is the
    #    frame that either shows the grip pads touching the hull or does not.
    cam = scene((1100, 820), (0.0, 0.0, 3.4), 12.0)
    build_pad()
    build_vessel()
    shoot(cam, (7.2, -8.2, 6.4), (0.0, 0.0, 3.2), 55.0, "clamps")

    # 7. The tower and the umbilical arm reaching the stack, shot from the
    #    deck looking up, so the 28 m has something to be 28 m against.
    cam = scene((820, 1000), (-5.0, 0.0, 16.0), 26.0)
    build_pad()
    build_vessel()
    shoot(cam, (6.0, -16.0, 4.0), (-4.0, 0.0, 17.0), 26.0, "tower")

    # 8. Straight down the trench line from the north, showing the channel
    #    open at both ends and the deck banks either side of it.
    cam = scene((1280, 720), (0.0, 0.0, 6.0), 40.0)
    build_pad()
    build_vessel()
    build_human(-4.9, 7.0, deck, 180.0)
    shoot(cam, (1.5, 46.0, 12.0), (0.0, 0.0, 6.5), 42.0, "trench_axis")


if __name__ == "__main__":
    main()
