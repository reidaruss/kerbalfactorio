"""render_rubble.py - the picture the rubble pass has to produce, which is a
LINEUP and cannot be a single-asset frame.

    blender --background --python tools/blender/render_rubble.py -- lineup
    blender --background --python tools/blender/render_rubble.py -- detail Med

Writes docs/screenshots/RN1624_rubble_*.png.

WHY THIS IS NOT render_check.py, and it is the same reason render_rocks.py is
not. render_check renders ONE shipped file and hides everything that is not
`_LOD0`, which is the right instrument for "is this asset correct". It cannot
photograph this one at all: `rubble_pile.glb` carries THREE sizes stacked on the
same origin, so a straight import puts a 0.90 m pile inside a 3.40 m one.

More importantly, the claims this asset makes are COMPARATIVE by construction:

  1. The three sizes are three different WRECKS and not one arrangement scaled.
     A reader can only judge that with all three in one frame under one light.
  2. A pile reads as WRECKAGE and not as a rock. That is a claim against the
     boulder it replaces, so `--boulder` puts the old placeholder in the lineup
     at the same span, under the same sun, as the fourth object.

It loads the SHIPPED .glb, so what is judged is the bytes in dist/ rather than
what was in memory when the build ran. Cycles on the CPU, and the same studio
render_check uses - same world, same sun, same fill, same neutral floor - so a
rubble frame is comparable to every other asset frame in docs/screenshots.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import render_check as rc  # noqa: E402

GLB = os.path.join(ROOT, "assets", "models", "dist", "props", "rubble_pile.glb")
BOULDER = os.path.join(ROOT, "assets", "models", "dist", "nodes",
                       "boulder_stone.glb")
SIZES = (("Small", 0.90), ("Med", 2.20), ("Large", 3.40))

# The placeholder's own numbers, from Wreckage.ts before RN-1624: a 1.0 m
# nominal radius squashed to 0.45 of its height. Reproduced here rather than
# approximated, so the comparison is against what actually shipped.
BOULDER_R, BOULDER_SQUASH = 1.0, 0.45


def load(path, keep_prefix=None):
    """Import one .glb and return its visible LOD0 objects.

    `keep_prefix` selects ONE of a multi-variant file's subtrees, which is the
    thing render_check cannot do and the whole reason this file exists."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    made = [o for o in bpy.data.objects if o not in before]
    keep = []
    for o in made:
        n = o.name
        drop = (n.startswith("col_")
                or any(n.endswith("_LOD%d" % i) for i in range(1, 10))
                or "_Half_" in n or "_Low_" in n or "_Stump_" in n)
        if keep_prefix is not None and not n.startswith(keep_prefix):
            drop = True
        if drop:
            o.hide_render = True
        elif o.type == "MESH":
            keep.append(o)
    return made, keep


def ground(x0, x1):
    """A neutral floor spanning the subject, which render_check's fixed +/-8 m
    plane does not for a row of piles laid out from the origin."""
    m = bpy.data.meshes.new("Ground")
    pad = (x1 - x0) * 0.5
    m.from_pydata([(x0, -pad, 0), (x1, -pad, 0), (x1, pad, 0), (x0, pad, 0)],
                  [], [(0, 1, 2, 3)])
    m.update()
    o = bpy.data.objects.new("Ground", m)
    mat = bpy.data.materials.new("GroundMat")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (
        0.28, 0.28, 0.30, 1.0)
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    m.materials.append(mat)
    bpy.context.scene.collection.objects.link(o)


def place(objs, x, scale=1.0, squash=1.0):
    for o in objs:
        if o.parent is not None:
            continue
        o.location = (x + o.location[0] * scale, o.location[1] * scale,
                      o.location[2] * scale * squash)
        o.scale = (scale, scale, scale * squash)


def studio():
    """render_check's studio, and its scene reset, which is the part that is
    easy to leave out and impossible to miss afterwards: without
    `read_factory_settings(use_empty=True)` the frame keeps Blender's startup
    Cube, its Camera and its Light, and the first receipt off this file duly
    rendered a 2 m white cube beside the smallest pile and lit everything with
    a stray point lamp nobody had asked for."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return rc.setup_world()


def lineup(with_boulder):
    """The three authored sizes in one frame, biggest last, on one baseline.

    Spaced by their own spans plus a gap, so the frame says how big each one is
    against the others rather than filling the width with each in turn."""
    cam = studio()
    x = 0.0
    centres = []
    for label, span in SIZES:
        objs, _ = load(GLB, keep_prefix="RubblePile_%s_LOD0" % label)
        place(objs, x + span * 0.5)
        centres.append(x + span * 0.5)
        x += span + 0.55
    if with_boulder:
        # The placeholder, at the MEDIUM span, built the way Wreckage.ts built
        # it: scaled to spanM * 0.5 over the asset's own 1.0 m radius, and
        # squashed. This is the before, in the same frame as the after.
        objs, _ = load(BOULDER, keep_prefix="BoulderStone_Full_LOD0")
        span = SIZES[1][1]
        place(objs, x + span * 0.5, scale=(span * 0.5) / BOULDER_R,
              squash=BOULDER_SQUASH)
        centres.append(x + span * 0.5)
        x += span + 0.55

    # LANDSCAPE, and this is not a preference. render_check's studio is 420 x
    # 540 because it frames a standing player; a row of four piles in that is
    # the row cropped, which the first receipt duly showed. The frame follows
    # the subject.
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = 960, 420

    # A FLOOR SIZED TO THE ROW. render_check's ground is +/-8 m because it was
    # built under a 1.8 m player; this row is 10.9 m long starting at the
    # origin, so half of it stood over nothing and the last pile appeared to
    # float on the world background.
    ground(-1.5, x + 1.5)

    # Centred on the whole ROW rather than on the first and last centres: the
    # outer two piles are the widest, so their half-spans are exactly what the
    # first version left outside the frame. The camera keeps NO x offset for
    # the same reason - a three-quarter angle bought by sliding the camera
    # sideways is a three-quarter angle that crops one end of the row.
    mid = (x - 0.55) * 0.5
    width = x + 2.2
    # Frame width is COMPUTED, not eyeballed, by render_check's own arithmetic:
    # at 55 mm Blender fits the 36 mm sensor to the LARGER dimension, so the
    # horizontal half-angle is atan(18/55) at this aspect and the distance that
    # fits `width` metres is (width / 2) / tan(that).
    dist = (width * 0.5) / math.tan(math.atan(18.0 / 55.0))
    cam.data.lens = 55.0
    cam.location = (mid, -dist * 0.82, dist * 0.44)
    rc.look_at(cam, (mid, 0.0, 0.30))
    return "lineup_boulder" if with_boulder else "lineup"


def detail(label):
    """One pile at roughly a metre across the frame: where the twisted plate
    either reads as plate or reads as a lump."""
    cam = studio()
    span = dict(SIZES)[label]
    ground(-span * 2.0, span * 2.0)
    objs, _ = load(GLB, keep_prefix="RubblePile_%s_LOD0" % label)
    place(objs, 0.0)
    # Roughly 1.4 spans across the frame and well ABOVE the pile, because a
    # heap 0.28 of its span tall photographed from its own height is a heap
    # seen edge-on: the first attempt put the camera at 0.6 m on a 3.4 m pile
    # and produced a picture of the studio floor.
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = 720, 540
    dist = (span * 1.4 * 0.5) / math.tan(math.atan(18.0 / 55.0))
    cam.data.lens = 55.0
    cam.location = (dist * 0.42, -dist * 0.78, dist * 0.46)
    rc.look_at(cam, (0.0, 0.0, span * 0.10))
    return "detail_%s" % label.lower()


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    with_boulder = "--boulder" in argv
    argv = [a for a in argv if not a.startswith("--")]
    mode = argv[0] if argv else "lineup"
    tag = lineup(with_boulder) if mode == "lineup" else detail(argv[1])
    out = os.path.join(ROOT, "docs", "screenshots", "RN1624_rubble_%s.png" % tag)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print("[render_rubble] wrote %s" % out)


if __name__ == "__main__":
    main()
