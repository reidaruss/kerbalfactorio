"""render_rocks.py - the two pictures a rock pass has to produce and that
render_check.py cannot.

    blender --background --python tools/blender/render_rocks.py -- lineup
    blender --background --python tools/blender/render_rocks.py -- seeds stone
    blender --background --python tools/blender/render_rocks.py -- crags

Writes docs/screenshots/RN243_*.png.

FLAGS, which may sit anywhere in the argument list because they are removed
before the positional arguments are read:

  --nomaps      strip the surface maps and restore the flat palette constants.
                The DEFAULT is maps ON, so the shipped frame shows what the
                client shows. A before/after pair is therefore ONE FLAG apart
                on one build under one light:
                    ... -- lineup before --nomaps
                    ... -- lineup after
                (the before/after tag is what keeps the two files apart; the
                same tag twice overwrites the first frame with the second.)
  --diag <stops>  measurement mode: set the exposure to <stops> and remove the
                look, so the frame is a plain encode of scene radiance and a
                colour can be read back out of it. Never a picture.

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

# True binds the shipped surface maps, False strips them and rewrites the flat
# palette constants. There is no None here, unlike render_check.py: a rock is
# only judged against the client if it wears the client's maps, so the default
# is a positive statement in BOTH directions and never "whatever the .glb
# happened to carry".
_MAPS = True
# None is the shipped picture mode; a float is a diagnostic exposure in stops
# with the look removed. 0.0 stops is a legitimate diagnostic exposure, so the
# absence of the flag has to be None and cannot be 0.0.
_DIAG = None


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]), 0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def setup_view_transform(scn):
    """Get the studio render onto the SHIPPED response curve, not Blender's.

    docs/controllers/rendering.md section 2.1 is the calibrated target and the
    client's curve is ACES with exposure 1.2, contrast 1.45. Blender 5.0
    defaults to AgX, which is a substantially FLATTER and more desaturating
    transform than any of that, and it is applied to every pixel after the
    material has done its work. Judged under AgX a warm rock reads as dusty
    terracotta, which is a statement about the view transform and not about the
    map. The creature lane spent three renders tuning a map against the wrong
    curve before this was found, and every rock frame this file has ever
    written was taken under that same wrong curve.

    `Standard` plus an exposure of +0.26 stops (2 ** 0.26 = 1.20) plus a
    high-contrast look is the closest the stock OCIO config gets. It is NOT
    ACES and this is not a claim that it is: what it buys is that the studio
    frame and the game frame are now wrong in the same DIRECTION rather than
    opposite ones, so a material judged here is not re-judged from scratch in
    the browser. The in-game shot remains the answer on lighting.

    KNOWING DUPLICATION, recorded as a debt rather than paid off here. This is
    the FOURTH copy of this function. The other three are
    tools/blender/render_creatures.py:139, tools/blender/render_machines.py:123
    and tools/blender/render_player.py:150. It is copied and not hoisted into
    of_lib because those three files are owned by other in-flight lanes and
    editing them would re-surface work that is not finished. When those lanes
    land, all four call sites should collapse into one shared helper; until
    then, a change to the curve has to be made in four places and this comment
    is the list.
    """
    vs = scn.view_settings
    for want in ("Standard", "Filmic", "AgX"):
        try:
            vs.view_transform = want
            break
        except TypeError:
            continue
    vs.exposure = 0.26
    for want in ("High Contrast", "Medium High Contrast", "None"):
        try:
            vs.look = want
            break
        except TypeError:
            continue
    # MEASUREMENT MODE. The picture mode above structurally cannot answer one
    # question, because Standard clips: a bright ore vein lands over display
    # 255 at any exposure that renders the host stone correctly, so it
    # photographs as a white slab with no form no matter what its roughness is.
    # `--diag <stops>` drops the exposure and removes the look, so the frame is
    # a plain encode of scene radiance and the linear value can be read back
    # out of it and put through the client's own ACES arithmetic. It is a
    # MEASUREMENT and never a picture; the shipped pair is always taken in the
    # mode above.
    if _DIAG is not None:
        vs.exposure = _DIAG
        try:
            vs.look = "None"
        except TypeError:
            pass
    print("[render_rocks] view transform %r, look %r, exposure %+.2f stops"
          % (vs.view_transform, vs.look, vs.exposure))


def _bsdf_constants(mat):
    """The palette constants a material is currently carrying, or None."""
    if not mat.use_nodes:
        return None
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        return None
    return (tuple(round(c, 5) for c in bsdf.inputs["Base Color"].default_value),
            round(bsdf.inputs["Metallic"].default_value, 5),
            round(bsdf.inputs["Roughness"].default_value, 5))


def merge_duplicate_materials():
    """Collapse `OF_Rock.001` back onto `OF_Rock`, and report what was merged.

    THIS FILE IS THE ONLY STUDIO THAT HITS THIS. render_check.py imports ONE
    .glb, so its material names are the authored ones. Every mode here imports
    several, and Blender renames on collision: the second boulder's Rock
    material arrives as `OF_Rock.001`. surface_preview reads the role off the
    material name (`mat.name[3:]`), so `Rock.001` is not a palette role, and
    the map binding SILENTLY SKIPS it. Measured before this existed: a four
    boulder lineup bound maps to the first boulder and left the other three
    wearing flat constants, which is the precise opposite of what a comparative
    frame is for. Six materials were reported as NOT EXAMINED and the frame
    still looked plausible, which is why this is worth a function.

    The merge is only performed when the duplicate's palette constants MATCH
    the original's. They do, because of_lib builds both from one PALETTE table
    and the client merges by role anyway, but a duplicate that genuinely
    differs is a real authored difference and flattening it would be a lie. In
    that case it is left alone and surface_preview's NOT EXAMINED line names
    it."""
    merged, kept = [], []
    for mat in list(bpy.data.materials):
        base, dot, suffix = mat.name.rpartition(".")
        if not (dot and base.startswith("OF_") and suffix.isdigit()):
            continue
        orig = bpy.data.materials.get(base)
        if orig is None or orig is mat:
            continue
        if _bsdf_constants(mat) != _bsdf_constants(orig):
            kept.append(mat.name)
            continue
        # The name is taken BEFORE the datablock is removed, because reading
        # `mat.name` afterwards is a use-after-free in Blender's RNA.
        was = mat.name
        mat.user_remap(orig)
        bpy.data.materials.remove(mat)
        merged.append(was)
    if merged:
        print("[render_rocks] merged %d duplicate material(s) onto their "
              "originals: %s" % (len(merged), sorted(merged)))
    if kept:
        print("[render_rocks] %d duplicate material(s) DIFFER from the "
              "original and were left alone: %s" % (len(kept), sorted(kept)))


def apply_maps():
    """Bind the shipped surface maps onto the OF_* materials, after import.

    WHY THIS EXISTS AT ALL. Until this call was added, every rock frame this
    file produced showed flat palette constants: no normal map, no ORM, no
    family binding. The `ore` family had never been photographed on a rock, so
    a lineup frame was evidence about four colours and not about four surfaces.

    `surface_preview` is imported HERE and not at module scope, which is
    render_check.py's rule: the module raises if assets/textures/dist/ (or
    whatever OF_TEX_DIR points at) has no manifest, and importing at module
    scope would make every caller depend on that directory existing even when
    it has asked for no maps at all. Imported here, only a caller that actually
    wanted maps can be told the maps are not built."""
    import surface_preview
    merge_duplicate_materials()
    # Said out loud so a frame is self-documenting about WHICH bytes it
    # photographed. surface_preview already announces an OF_TEX_DIR override,
    # but the shipped path is silent there and "no line printed" is not
    # evidence of anything.
    print("[render_rocks] texture set: %s%s"
          % (surface_preview.TEX_DIR,
             "  [OF_TEX_DIR override, UNSHIPPED]"
             if os.environ.get("OF_TEX_DIR") else "  [shipped]"))
    rep = surface_preview.apply_all(off=not _MAPS)
    print("[render_rocks] surface maps %s: %d mapped %s, %d flat %s, "
          "%d skipped"
          % ("ON" if _MAPS else "OFF (stripped)",
             len(rep["mapped"]), rep["mapped"],
             len(rep["flat"]), rep["flat"], len(rep["skipped"])))


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
    setup_view_transform(scn)
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
    # After every import, because apply_all walks bpy.data.materials once and a
    # material that arrives later would keep its flat constants and be the one
    # rock in the row that is not comparable to the other three.
    apply_maps()
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
    apply_maps()
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
    apply_maps()
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
    apply_maps()
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
    apply_maps()
    shoot(cam, (1.2, -8.4, 2.6), (0.0, 0.0, 1.15),
          os.path.join(OUT, "RN247_crags_%s.png" % tag), lens=32.0)


def main():
    global _MAPS, _DIAG
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    # The flags come out of the list wherever they sit, BEFORE the mode and the
    # tag are read, so the positional arguments keep the meaning and the order
    # they have always had (render_check.py's rule). Parsed by hand rather than
    # with argparse because the rest of this file already reads argv by hand
    # after the `--` separator, and one file with two parsers in it is how a
    # flag comes to work in one mode and not another.
    for tok, val in (("--maps", True), ("--nomaps", False)):
        while tok in argv:
            argv.remove(tok)
            _MAPS = val
    if "--diag" in argv:
        i = argv.index("--diag")
        _DIAG = float(argv[i + 1])
        del argv[i:i + 2]
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
