"""render_rocks.py - the two pictures a rock pass has to produce and that
render_check.py cannot.

    blender --background --python tools/blender/render_rocks.py -- lineup
    blender --background --python tools/blender/render_rocks.py -- seeds stone
    blender --background --python tools/blender/render_rocks.py -- crags

Writes docs/screenshots/RN243_*.png.

WHY THIS IS NOT render_check.py. render_check renders ONE shipped file, which
is the right instrument for "is this asset correct". A rock pass makes two
claims that no single-asset frame can carry:

  LINEUP: the four ore boulders differ in HOW THEY BREAK and not only in hue.
  That claim is comparative by construction, so the four have to be in one
  frame under one light. It loads the shipped .glb files, so what is judged is
  the bytes in dist/ and not what was in memory when the build ran.

  SEEDS: the same plan under different seeds is a different rock every time.
  That one CANNOT be made from the shipped files, because a shipped file holds
  exactly one seed. So this mode calls the builder in process with the seed
  overridden, which is the only way to photograph the property rather than an
  instance of it. It is therefore a claim about the GENERATOR and it is stated
  as one: these are not four assets that ship, they are four draws from the
  distribution the one that ships was drawn from.

Both modes use render_check's studio: the same world, the same sun, the same
fill and the same neutral floor the spider turntables were shot on, so a rock
frame is comparable to every other asset frame in docs/screenshots.

Cycles on the CPU, deliberately, for the reason render_check gives: EEVEE needs
a GPU context a headless Windows Blender does not reliably have, and a check
that only runs on the author's machine is not a check.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import of_lib as of              # noqa: E402
import harvest_common as hc      # noqa: E402
import boulder_common as bc      # noqa: E402

OUT = os.path.join(ROOT, "docs", "screenshots")


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]), 0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def studio(width, height):
    """render_check.setup_world, with the frame size passed in: a row of four
    boulders is 5 m wide and the 420 x 540 portrait it uses for one asset would
    crop three of them."""
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = 24
    scn.cycles.use_denoising = True
    scn.render.resolution_x = width
    scn.render.resolution_y = height
    scn.render.film_transparent = False
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.16, 0.17, 0.19, 1)
    bg.inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.0
    sun.data.angle = math.radians(6.0)
    sun.rotation_euler = (math.radians(52), 0.0, math.radians(38))
    bpy.context.scene.collection.objects.link(sun)

    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 220.0
    fill.data.size = 4.0
    fill.location = (-3.0, -2.4, 2.4)
    look_at(fill, (0, 0, 1.0))
    bpy.context.scene.collection.objects.link(fill)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 55.0
    cam.data.clip_start = 0.01
    bpy.context.scene.collection.objects.link(cam)
    scn.camera = cam
    return cam


def add_ground(half=14.0):
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata([(-half, -half, 0), (half, -half, 0),
                      (half, half, 0), (-half, half, 0)], [], [(0, 1, 2, 3)])
    mesh.update()
    bpy.context.scene.collection.objects.link(
        bpy.data.objects.new("Ground", mesh))


def hide_all_but_lod0_full():
    """A .glb holds every LOD band and every depletion variant as siblings, so
    rendering it raw draws three meshes on top of each other and the two
    nearly-coincident surfaces z-fight, which reads exactly like broken
    geometry. Same rule render_check applies, restated because this file
    imports several assets into one scene."""
    for o in list(bpy.data.objects):
        n = o.name
        if (n.startswith("col_")
                or any(n.endswith("_LOD%d" % i) for i in range(1, 10))
                or "_Half_" in n or "_Low_" in n or "_Stump_" in n):
            o.hide_render = True


def shoot(cam, pos, target, path, lens=55.0):
    cam.data.lens = lens
    cam.location = pos
    look_at(cam, target)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_rocks] wrote %s" % path)


# ---------------------------------------------------------------------------
# lineup: the four shipped ore boulders, one light, one frame
# ---------------------------------------------------------------------------

def lineup(tag):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cam = studio(1200, 520)
    add_ground()
    xs = (-3.15, -1.05, 1.05, 3.15)
    for x, kind in zip(xs, ("stone", "iron", "copper", "coal")):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(
            filepath=os.path.join(ROOT, "assets", "models", "dist", "nodes",
                                  "boulder_%s.glb" % kind))
        for o in set(bpy.data.objects) - before:
            if o.parent is None:
                o.location = (x, 0.0, 0.0)
    hide_all_but_lod0_full()
    shoot(cam, (0.0, -9.2, 2.60), (0.0, 0.0, 0.60),
          os.path.join(OUT, "RN243_lineup_%s.png" % tag), lens=35.0)
    shoot(cam, (5.4, -7.2, 1.10), (0.0, 0.0, 0.42),
          os.path.join(OUT, "RN243_lineup_%s_low.png" % tag), lens=35.0)


# ---------------------------------------------------------------------------
# seeds: the SAME plan drawn several times from the distribution
# ---------------------------------------------------------------------------

def seeds(kind, count=5, tag="after"):
    """Build `count` piles from one plan with the seed swept, and lay them out.

    Nothing here is exported. The point is a picture of the generator: if two
    of these look like the same rock the seeded-variation claim is false, and
    that is a thing a person can see and a triangle count cannot."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cam = studio(1400, 520)
    add_ground()
    name, plan, dims, body, second, ore, seed = bc.KINDS[kind]
    roles = {"body": body, "second": second, "ore": ore}
    order = []
    for r in (body, second, ore):
        if r not in order:
            order.append(r)
    step = dims[0] + 0.55
    x0 = -step * (count - 1) * 0.5
    for k in range(count):
        # 997 is prime and unrelated to the 17 / 23 strides the plan uses to
        # space its own masses, so a swept seed cannot land on a stream another
        # mass in the same pile is already using.
        p = bc._pile(plan, 3, 3, 1.0, 1.0, roles, seed + k * 997)
        p.fit(dims)
        mb = of.MeshBuilder()
        p.into(mb, role_order=order)
        obj = mb.build("%s_seed%d" % (name, k))
        obj.location = (x0 + k * step, 0.0, 0.0)
        print("[render_rocks] %s seed %d: %d tris"
              % (name, seed + k * 997, mb.tri_count()))
    # Frame width is computed, not eyeballed: at 1400 x 520 Blender fits the
    # 36 mm sensor to the LARGER dimension, so the horizontal half angle is
    # atan(18 / f) and the visible width at distance d is 2 * d * 18 / f. A
    # 35 mm lens at 1.16 * span therefore leaves about 15% margin, which is
    # what stopped the first attempt cropping two of the five rocks out of the
    # frame that exists to show five.
    span = step * count
    d = span * 1.16 * 35.0 / 36.0
    shoot(cam, (0.0, -d, span * 0.20), (0.0, 0.0, dims[2] * 0.45),
          os.path.join(OUT, "RN243_seeds_%s_%s.png" % (kind, tag)), lens=35.0)


# ---------------------------------------------------------------------------
# tall: one subject too tall for any render_check view
# ---------------------------------------------------------------------------

def tall(rel, stem, height, tag):
    """Frame a subject by its own height rather than by a fixed camera.

    render_check's VIEWS are all sized for a 1.8 m player or a 1 m machine and
    its one tall view, `vessel34`, is set for a 6.4 m lander, so a 3.4 m spire
    is a thumbnail in it. At 420 x 540 Blender fits the 36 mm sensor to the
    LARGER dimension, which is the HEIGHT in portrait, so the vertical half
    angle is atan(18 / f) and the distance that fits `h` metres is
    (h / 2) / tan. Computed, so the camera follows the asset if the asset
    changes rather than needing a person to notice."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cam = studio(420, 540)
    add_ground()
    bpy.ops.import_scene.gltf(
        filepath=os.path.join(ROOT, "assets", "models", "dist",
                              *rel.split("/")))
    hide_all_but_lod0_full()
    lens = 55.0
    d = (height * 1.18 * 0.5) / (18.0 / lens)
    shoot(cam, (d * 0.42, -d * 0.90, height * 0.62), (0.0, 0.0, height * 0.46),
          os.path.join(OUT, "%s_%s_full.png" % (stem, tag)), lens=lens)
    # And the foot at walking distance, which is where the pits and the apron
    # either read or do not.
    shoot(cam, (0.75, -1.55, 1.35), (0.0, 0.0, 0.60),
          os.path.join(OUT, "%s_%s_foot.png" % (stem, tag)), lens=lens)


# ---------------------------------------------------------------------------
# decor: a biome atlas laid out, because build_atlas stacks it on the origin
# ---------------------------------------------------------------------------

def decor(atlas, stem, names, step, tag, eye=1.62):
    """Spread one atlas's props along X and photograph them at EYE HEIGHT.

    Every prop in an atlas sits on the origin (props_common: a scatter pass
    writes the placement matrix, so a layout offset would ride along on it and
    every consumer would have to subtract it back out), which means importing
    the .glb draws four props inside each other. So they are pulled apart here.

    The camera is at 1.62 m looking slightly down, which is the only view that
    answers the question ankle-height decoration exists to answer: a scree
    field is judged from standing height at walking distance and never from a
    hero three-quarter. A prop that looks good in a turntable and reads as grey
    mush from the player's eye has failed at the one distance it is drawn."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cam = studio(1200, 560)
    add_ground()
    bpy.ops.import_scene.gltf(
        filepath=os.path.join(ROOT, "assets", "models", "dist",
                              *atlas.split("/")))
    hide_all_but_lod0_full()
    # Props NOT in `names` are HIDDEN, not merely left where they are. The
    # first attempt only moved the named ones, so an atlas-mate still on the
    # origin filled the frame and the picture was of a different prop
    # entirely, which is DW-7's other direction: a frame that looks like a
    # render of something is not evidence about the thing you meant.
    # The floor is exempt, because hiding it too gave a second wrong picture:
    # ankle-height debris floating on a flat grey field, with no contact
    # shadow and nothing to read scale against.
    keep = tuple(names)
    for o in bpy.data.objects:
        if (o.type == "MESH" and o.name != "Ground"
                and not o.name.startswith(keep)):
            o.hide_render = True
    x0 = -step * (len(names) - 1) * 0.5
    for i, n in enumerate(names):
        for o in bpy.data.objects:
            if o.name.startswith(n):
                o.location = (x0 + i * step, 0.0, 0.0)
    # Frame widths are computed. At 1200 x 560 the sensor fits to the WIDTH, so
    # the horizontal half angle is atan(18 / f) and the width covered at range
    # D is 2 * D * 18 / f. The first attempt used a 35 mm lens at 0.30 of the
    # span and covered a third of the row, so two of the four props exist only
    # outside the frame that exists to compare four props.
    # A one-prop row still needs a frame wide enough to show the prop AND
    # the ground it lies on, so the span has a floor.
    span = max(step * len(names), 4.2)
    lens = 28.0
    shoot(cam, (0.0, -span * 0.78, eye), (0.0, 0.0, 0.10),
          os.path.join(OUT, "%s_%s.png" % (stem, tag)), lens=lens)
    shoot(cam, (0.0, -span * 0.75, span * 0.45), (0.0, 0.0, 0.05),
          os.path.join(OUT, "%s_%s_down.png" % (stem, tag)), lens=lens)


# ---------------------------------------------------------------------------
# crags: the spire node and the scree props, which live in other files
# ---------------------------------------------------------------------------

def crags(tag):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cam = studio(1200, 700)
    add_ground()
    specs = (("nodes/rock_spire.glb", (-2.0, 0.5, 0.0)),
             ("nodes/boulder_stone.glb", (0.6, -0.2, 0.0)),
             ("nodes/boulder_coal.glb", (2.6, 0.7, 0.0)),
             ("props/props_mountains.glb", (1.7, -1.5, 0.0)))
    for rel, at in specs:
        path = os.path.join(ROOT, "assets", "models", "dist", *rel.split("/"))
        if not os.path.exists(path):
            print("[render_rocks] missing %s, skipped" % rel)
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        for o in set(bpy.data.objects) - before:
            if o.parent is None:
                o.location = at
    hide_all_but_lod0_full()
    shoot(cam, (1.2, -8.4, 2.6), (0.0, 0.0, 1.15),
          os.path.join(OUT, "RN247_crags_%s.png" % tag), lens=32.0)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        print(__doc__)
        return
    mode = argv[0]
    tag = argv[-1] if len(argv) > 1 and argv[-1] in ("before", "after") \
        else "after"
    if mode == "lineup":
        lineup(tag)
    elif mode == "seeds":
        kind = argv[1] if len(argv) > 1 else "stone"
        seeds(kind, tag=tag)
    elif mode == "crags":
        crags(tag)
    elif mode == "spire":
        tall("nodes/rock_spire.glb", "RN244_spire", 2.60, tag)
    elif mode == "mtndecor":
        # The BEFORE frame names the props HEAD ships and the AFTER frame
        # names the props this pass ships, because atlas membership is part
        # of what changed. One name list would silently drop whichever side
        # it did not match and photograph an empty floor instead.
        names = (("Mtn_RockSpire", "Mtn_TalusChunk", "Mtn_SnowPatch")
                 if tag == "before" else
                 ("Mtn_ScreeSheet", "Mtn_TalusFan", "Mtn_FrostShards",
                  "Mtn_SnowPatch"))
        decor("props/props_mountains.glb", "RN245_mtndecor", names, 2.9, tag)
    elif mode == "hillsdecor":
        decor("props/props_hills.glb", "RN246_hillsdecor",
              ("Hills_ScreePatch",), 2.4, tag)
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
