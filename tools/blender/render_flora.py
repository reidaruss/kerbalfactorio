"""render_flora.py - look at a tree, and look at a STAND of them.

    blender --background --python tools/blender/render_flora.py -- \\
        assets/models/dist/props/props_canopy.glb docs/screenshots/RN271 \\
        studio:Canopy_Pine_LOD0

    blender --background --python tools/blender/render_flora.py -- \\
        assets/models/dist/props/props_canopy.glb docs/screenshots/RN271 \\
        group:Canopy_Pine,Canopy_Fir,Canopy_Broadleaf:16:7

    blender --background --python tools/blender/render_flora.py -- \\
        props_forest.glb,detail_cards.glb,props_canopy.glb \\
        docs/screenshots/RN301 floor:forest:31

WHY NOT render_check.py. That harness frames a 1.8 m player: its tallest view
(`site34`) tops out around 8 m, and every canopy tree here is 10.5 to 16.5 m.
It also has no way to draw more than one copy of an asset, and ONE COPY IS
EXACTLY WHAT CANNOT ANSWER THIS PASS'S QUESTION. The defect being fixed is that
a forest repeats one outline; a single hero render of a tree cannot show that
either way, and a lane that only ever renders one tree can ship a beautiful
asset that still tiles.

THE GROUP SHOT IS THE INSTRUMENT AND IT COPIES THE CLIENT'S OWN DISTRIBUTIONS.
`ScatterEmit.ts:153` yaws every instance by a hashed 0 to 2*pi about the
surface normal, and `ScatterLook.scaleFor` draws a width jitter of +/-0.14 and
a height factor of 0.84 to 1.20 (Registry.C). So the stand below draws yaw and
scale from those SAME ranges rather than from taste. If the asset's outline
does not depend on yaw, this render shows a row of identical trees at slightly
different sizes, which is the "before" and is exactly what the frame is meant
to expose.

THE FLOOR SHOT (RN-301) IS THE GROUP SHOT AIMED AT THE OTHER END OF THE SCENE,
and it exists because `group:` cannot see the understorey at all. `group:` puts
the camera 5.4 m up looking at a point 7.4 m up across a band 26 to 78 m out,
which is the right frame for a 16 m fir and is a frame in which a 0.30 m fern is
a smudge two pixels tall. The layer a player is closest to for most of the game
therefore had no view in this tool, which is INSTRUMENTS.md's own trap once
more: a thing measured only where it cannot show reports its own absence.

`floor:` puts the camera at a standing eye (1.66 m) looking slightly DOWN at
ground 7 m ahead, over a patch 1.2 to 26 m out, which is where the ground cover
actually lives.

IT PLACES BY DENSITY, NOT BY COUNT, and that is the part that makes it an
instrument rather than a diorama. `group:` takes an instance count from the
caller, so its picture is a matter of taste; a forest floor's whole question is
whether the ground is COVERED, and coverage is a function of the shipped
densities and the shipped footprints together (Registry.ts's own note: the biome
props cover 13.1% of the ground however many instances are placed). So the
species table below carries instances per square kilometre and the placer
multiplies by the patch area. Fifteen ferns and seven hundred grass cards in one
frame is not a choice made here, it is what `BIOME_PROPS[3]` says the ground is.

THE TABLE IS TRANSCRIBED FROM `web/src/assets/Registry.ts` (BIOME_PROPS index 3,
GROUND_DETAIL, CANOPY_FOREST) WITH `DENSITY_SCALE = 6` ALREADY APPLIED, read on
2026-08-01. It is a copy and copies drift, so it is stated as a copy: if a
picture from this tool ever disagrees with the client's ground, check this table
against those three lists FIRST. It is not read from the client because this
lane is under a hard no-browser, no-build constraint and a TypeScript module is
not importable from Blender's python without one.

Cycles on the CPU with a modest sample count, for render_check.py's reason: a
check that only runs where a GPU context exists is not a check. Lighting here
is deliberately plain and is IDENTICAL across a before/after pair. It is not a
look-development statement and must not be read as one: this pass is geometry,
and the lighting exists only so that two geometries can be compared under it.
"""

import json
import math
import os
import random
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


def alpha_cards():
    """Wire the SHIPPED card textures onto the foliage materials, alpha clipped
    at the shipped threshold.

    ADDED AT RN-304 BECAUSE THE UNTEXTURED RENDER WAS ANSWERING A QUESTION THE
    GAME DOES NOT ASK. A foliage strip in these files is not a leaf, it is a
    CARRIER for an alpha-cut card: RN-176 to RN-183 landed the image pipeline
    and `props_common.blade_uvs` has been authoring unit-card UVs on every
    foliage face since RN-179. `Surfaces.ts` attaches `albedo` with
    `alphaTest` for the `grass` and `leaf` families, so what the player sees is
    the mask, and a render that draws the untextured strip is drawing a solid
    quad the client never puts on screen. That is the same class of error as
    rendering LOD0 and LOD2 on top of one another: a picture of something that
    is not shipped.

    It matters most for exactly this pass, because the question here is COVERAGE
    of the forest floor, and the mask is what decides how much of a strip
    actually covers anything.

    Materials are matched by the `OF_<Role>` name and routed through the same
    role table `assets/textures/dist/surfaces.json` gives the client, so this
    cannot drift from what ships. Base colour is kept and MULTIPLIED by the
    card, which is what the client's material does; this is not a look
    development statement and the lighting is unchanged."""
    tex = os.path.join(ROOT, "assets", "textures", "dist")
    surf = os.path.join(tex, "surfaces.json")
    if not os.path.exists(surf):
        print("[render_flora] no surfaces.json, leaving materials flat")
        return 0
    with open(surf, "r", encoding="utf-8") as fh:
        spec = json.load(fh)
    fams, roles = spec.get("families", {}), spec.get("roles", {})
    images, done = {}, 0
    for mat in bpy.data.materials:
        if not mat.name.startswith("OF_") or mat.node_tree is None:
            continue
        fam = fams.get(roles.get(mat.name[3:], ""), None)
        if fam is None or "albedo" not in fam or fam.get("uv_space") != "unit":
            continue
        png = fam["albedo"]
        png = png.get("file", png) if isinstance(png, dict) else png
        path = os.path.join(tex, os.path.basename(str(png)))
        if not os.path.exists(path):
            print("[render_flora] missing card %s for %s" % (path, mat.name))
            continue
        img = images.get(path)
        if img is None:
            img = bpy.data.images.load(path)
            images[path] = img
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        node.interpolation = "Closest"
        node.extension = "REPEAT"
        mix = nt.nodes.new("ShaderNodeMixRGB")
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        # Base colour may be a constant (of_lib writes the palette hex there)
        # or already driven by a node the importer built. Multiply against
        # whichever it is, so the palette is preserved either way.
        src = bsdf.inputs["Base Color"]
        if src.is_linked:
            nt.links.new(mix.inputs[2], src.links[0].from_socket)
        else:
            mix.inputs[2].default_value = src.default_value
        nt.links.new(mix.inputs[1], node.outputs["Color"])
        nt.links.new(bsdf.inputs["Base Color"], mix.outputs["Color"])
        # Cycles has no alpha-CLIP mode, so the threshold is applied as
        # geometry-level maths rather than as a raster state: round the alpha
        # at the shipped cut so a partially covered texel is in or out exactly
        # as `alphaTest` decides it in the client.
        step = nt.nodes.new("ShaderNodeMath")
        step.operation = "GREATER_THAN"
        step.inputs[1].default_value = float(fam.get("alpha_test", 0.35))
        nt.links.new(step.inputs[0], node.outputs["Alpha"])
        nt.links.new(bsdf.inputs["Alpha"], step.outputs["Value"])
        done += 1
    print("[render_flora] alpha cards on %d material(s): %s"
          % (done, ", ".join(sorted(os.path.basename(k) for k in images))))
    return done


def setup_world(w, h, samples):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    scn.render.resolution_x = w
    scn.render.resolution_y = h
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
    cam.data.clip_start = 0.05
    cam.data.clip_end = 900.0
    bpy.context.scene.collection.objects.link(cam)
    scn.camera = cam
    return cam


def add_ground(size=260.0):
    """A neutral floor. Mid grey, matte, no texture: the point of every frame
    here is an OUTLINE against a background, and a patterned floor competes
    with the thing being judged."""
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


def lod0_objects(stem=None):
    """The meshes the client actually draws: _LOD0 only, no collision proxy,
    and for a harvest node only the _Full depletion variant. Rendering a .glb
    raw draws LOD0, LOD1 and LOD2 on top of one another, and two nearly
    coincident surfaces z-fight, which reads exactly like broken geometry."""
    out = []
    for o in list(bpy.data.objects):
        n = o.name
        if o.type != "MESH":
            continue
        if (n.startswith("col_") or not n.endswith("_LOD0")
                or "_Half_" in n or "_Low_" in n or "_Stump_" in n):
            o.hide_render = True
            continue
        if stem is not None and not n.startswith(stem):
            o.hide_render = True
            continue
        # UN-HIDE, and that line is a bug fix rather than a tidy (RN-306).
        # Every shot in this file hides what it does not want and nothing ever
        # showed anything again, so a second `studio:` in the same invocation
        # rendered an EMPTY FRAME: the first shot had already hidden its
        # sibling props and this function only ever set the flag one way. It
        # went unnoticed because the pass that wrote this ran one shot per
        # Blender launch. An empty frame is at least loud; the same bug with
        # two overlapping props would have quietly dropped one of them.
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


def studio(cam, node, out_prefix):
    """One tree on the neutral floor, framed to its own height, from two
    bearings 90 degrees apart. The pair is the point: a single bearing cannot
    show whether an outline depends on which side you are standing on, which
    is the whole property this pass is about."""
    objs = lod0_objects(node.replace("_LOD0", ""))
    lo, hi = bounds_of(objs)
    h = hi[2] - lo[2]
    r = max(hi[0] - lo[0], hi[1] - lo[1])
    # Distance so the prop fills about 80% of the frame at 50 mm on a 36 mm
    # sensor, fitted to whichever of height and footprint is LARGER.
    #
    # IT USED TO FIT HEIGHT ONLY, and that was right for the canopy trees this
    # view was written for and wrong for everything on the forest floor: a
    # fallen log is 2.86 m long and 0.66 m tall, so framing its height put the
    # camera 1.7 m from a 2.9 m object and rendered a wall of bark. The
    # understorey is the layer where footprint routinely exceeds height, which
    # is exactly what makes it the understorey.
    d = (max(h, r * 0.62) * 1.25) * 50.0 / 24.0
    for tag, az in (("a", -62.0), ("b", 28.0)):
        a = math.radians(az)
        cam.location = (d * math.cos(a), d * math.sin(a),
                        max(h * 0.52, d * 0.26))
        look_at(cam, (0.0, 0.0, h * 0.46))
        path = os.path.join(ROOT, "%s_%s_%s.png"
                            % (out_prefix, node.replace("_LOD0", "").lower(),
                               tag))
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("[render_flora] wrote %s  (h=%.2f w=%.2f)" % (path, h, r))


def base(cam, node, out_prefix):
    """The bottom 2 m of a trunk, from a standing player's eye.

    A whole-tree render CANNOT judge root flare or bark ridging: on a 6.5 m
    conifer the buttress is 3 percent of the frame height and the crown covers
    most of the trunk anyway. These are close-range features and they need a
    close-range frame, which is the same argument RN-100's `det*` views make
    for surface maps and the same trap INSTRUMENTS.md names about the sun
    glint: a term measured only where it cannot show reports its own absence."""
    objs = lod0_objects(node.replace("_LOD0", ""))
    lo, hi = bounds_of(objs)
    for tag, az in (("basea", -58.0), ("baseb", 34.0)):
        a = math.radians(az)
        cam.data.lens = 50.0
        # The GROUND CONTACT has to be in frame. The first version of this
        # view looked at 0.72 m from 2.45 m and cropped the bottom 10 cm of the
        # trunk out, which is precisely where a root flare lives: the shot was
        # aimed just past the thing it exists to show.
        cam.location = (3.30 * math.cos(a), 3.30 * math.sin(a), 1.45)
        look_at(cam, (0.0, 0.0, 0.62))
        path = os.path.join(ROOT, "%s_%s_%s.png"
                            % (out_prefix, node.replace("_LOD0", "").lower(),
                               tag))
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("[render_flora] wrote %s  (base of %.2f m asset)"
              % (path, hi[2] - lo[2]))


def group(cam, stems, count, seed, out_prefix, tag="group"):
    """A mid-field stand: `count` instances of the given stems, placed in a
    band 26 to 78 m from the camera, each with its own yaw and non-uniform
    scale drawn from the CLIENT's distributions.

    78 m is not an arbitrary far edge: it is `CANOPY_LOD2_M`, the radius WG-17
    pinned equal to `DETAIL_RADIUS_M`, so everything in this frame is inside
    the band where the game draws these LOD0 meshes. A stand rendered further
    out would be showing impostors and would answer a different question.
    """
    src = {}
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        o.hide_render = True
        for s in stems:
            if o.name.startswith(s + "_LOD0"):
                src.setdefault(s, []).append(o)
    rnd = random.Random(seed)
    placed = 0
    for k in range(count):
        stem = stems[k % len(stems)]
        parts = src.get(stem)
        if not parts:
            continue
        # A band, not a grid: a regular lattice reads as a lattice and would
        # be a second repetition on top of the one being measured.
        depth = 26.0 + 52.0 * (k + 0.15 + 0.7 * rnd.random()) / count
        lateral = (rnd.random() * 2.0 - 1.0) * depth * 0.46
        # ScatterLook.scaleFor: width jitter +/- 0.14, height 0.84 to 1.20 of
        # the width, applied about the prop's own up axis.
        w = 1.0 + (rnd.random() * 2.0 - 1.0) * 0.14
        hgt = w * (0.84 + rnd.random() * 0.36)
        yaw = rnd.random() * 2.0 * math.pi
        for o in parts:
            c = o.copy()
            c.data = o.data
            c.hide_render = False
            c.location = (lateral, depth, 0.0)
            c.rotation_euler = (0.0, 0.0, yaw)
            c.scale = (w, w, hgt)
            bpy.context.scene.collection.objects.link(c)
        placed += 1
    cam.data.lens = 38.0
    cam.location = (0.0, -13.0, 5.4)
    look_at(cam, (0.0, 46.0, 7.4))
    path = os.path.join(ROOT, "%s_%s.png" % (out_prefix, tag))
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_flora] wrote %s  (%d instances)" % (path, placed))


# Instances per square kilometre, DENSITY_SCALE already applied. See the
# transcription note in the module docstring: this is a COPY of three lists in
# web/src/assets/Registry.ts and is stated as one.
#
# RN-1500: this table was still GROUND_DETAIL (the shared meadow table RN-311
# named), 12 days after WG-91 (bdee2b5, 2026-08-01) gave Forest its own
# FOREST_DETAIL and switched BIOME_PROPS_MUT[3] to it by default. The doc
# comment above still says "a COPY of three lists" and only two of the three
# were ever repointed; nobody had run `floor:forest` since WG-91 landed, so
# nothing caught it. Every number below the Forest-props block is now
# FOREST_DETAIL's own pre-scale figure x6, matching how every other row here
# is built.
FOREST_FLOOR = (
    # BIOME_PROPS[3], the Forest biome props (FOREST_BASE, unchanged by WG-91).
    ("Forest_Fern", 25200.0),
    ("Forest_MushroomCluster", 9000.0),
    ("Forest_DeadTree", 2520.0),
    ("Forest_FallenLog", 1560.0),
    # FOREST_DETAIL (WG-91), the understorey Forest no longer shares with Plains.
    ("Detail_GrassCardA", 540000.0),
    ("Detail_GrassCardB", 180000.0),
    ("Detail_GrassCardC", 720000.0),
    ("Detail_BroadleafForb", 900000.0),
    ("Detail_SedgeRosette", 660000.0),
    ("Detail_PebbleScatter", 144000.0),
    ("Detail_FlowerSprig", 84000.0),
    # CANOPY_FOREST. In frame only as trunks, which is what a player standing
    # in a forest sees of a canopy tree, and they are in the shot because the
    # floor is what it is BECAUSE they are there.
    ("Canopy_Pine", 1800.0),
    ("Canopy_Broadleaf", 1500.0),
    ("Canopy_Fir", 540.0),
)

# The patch the floor shot fills, in metres: x is lateral, y is depth away from
# the camera. Wider than the frame on purpose, so nothing pops in at the edge.
FLOOR_PATCH = (-14.0, 14.0, 1.2, 26.0)


def floor(cam, table, seed, out_prefix, tag="floor"):
    """The forest floor from a standing player's eye, populated BY DENSITY.

    Each species gets `per_km2 * area / 1e6` instances, so the frame reports
    what the shipped tables actually put on the ground rather than what would
    photograph well. Yaw and scale come from the client's own distributions,
    the same ones `group` uses and for the same reason."""
    src = {}
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        o.hide_render = True
        if o.name.startswith("col_") or "_Half_" in o.name \
                or "_Low_" in o.name or "_Stump_" in o.name:
            continue
        hit = o.name.rsplit("_LOD", 1)
        if len(hit) == 2 and hit[1] == "0":
            src.setdefault(hit[0], []).append(o)

    x0, x1, y0, y1 = FLOOR_PATCH
    area = (x1 - x0) * (y1 - y0)
    rnd = random.Random(seed)
    total, missing = 0, []
    for stem, per_km2 in table:
        parts = src.get(stem)
        if not parts:
            missing.append(stem)
            continue
        want = per_km2 * area / 1.0e6
        n = int(want) + (1 if rnd.random() < (want - int(want)) else 0)
        for _k in range(n):
            px = x0 + (x1 - x0) * rnd.random()
            py = y0 + (y1 - y0) * rnd.random()
            w = 1.0 + (rnd.random() * 2.0 - 1.0) * 0.14
            hgt = w * (0.84 + rnd.random() * 0.36)
            yaw = rnd.random() * 2.0 * math.pi
            for o in parts:
                c = o.copy()
                c.data = o.data
                c.hide_render = False
                c.location = (px, py, 0.0)
                c.rotation_euler = (0.0, 0.0, yaw)
                c.scale = (w, w, hgt)
                bpy.context.scene.collection.objects.link(c)
        total += n
        print("[render_flora] floor %-26s %6.0f /km2 -> %4d in %.0f m2"
              % (stem, per_km2, n, area))
    if missing:
        print("[render_flora] floor: NOT IN THE LOADED GLB(s): %s"
              % ", ".join(missing))
    # A standing eye, tilted down far enough that the ground fills the lower
    # two thirds. 34 mm rather than the 50 mm the studio views use: a floor is
    # judged on how much of it is covered, and a long lens crops the coverage
    # question out of the frame.
    cam.data.lens = 34.0
    cam.location = (0.0, -0.6, 1.66)
    look_at(cam, (0.0, 7.0, 0.30))
    path = os.path.join(ROOT, "%s_%s.png" % (out_prefix, tag))
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_flora] wrote %s  (%d instances, %d species)"
          % (path, total, len(table) - len(missing)))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) < 3:
        print(__doc__)
        return
    glb, out_prefix, shots = argv[0], argv[1], argv[2:]
    w, h, samples = 720, 640, 28
    if shots[0].startswith("group"):
        w, h, samples = 1100, 520, 22
    elif shots[0].startswith("floor"):
        w, h, samples = 1000, 620, 26
    bpy.ops.wm.read_factory_settings(use_empty=True)
    cam = setup_world(w, h, samples)
    # A COMMA-SEPARATED LIST, because a forest floor is not in one file. The
    # ground cover lives in detail_cards.glb, the biome props in
    # props_forest.glb and the trunks overhead in props_canopy.glb, and a shot
    # of any one of them alone answers a question nobody asked.
    for one in glb.split(","):
        one = one.strip()
        bpy.ops.import_scene.gltf(
            filepath=one if os.path.isabs(one) else os.path.join(ROOT, one))
    alpha_cards()
    # RN-1500: trunks (Bark/BarkLight) wore no texture in this tool at all
    # before this line, flat vertex colour whatever `_bark_albedo` (RN-1472)
    # actually looks like. `surface_preview.apply_all()` wires every TILING
    # family (bark included); the two CARD families it cannot handle
    # (`alpha_cards()`'s own job, just above) are now a documented no-op
    # inside it rather than a crash, see that module's own RN-1500 note.
    import surface_preview
    surface_preview.apply_all(quiet=True)
    add_ground()
    os.makedirs(os.path.join(ROOT, os.path.dirname(out_prefix)), exist_ok=True)
    for shot in shots:
        kind, rest = shot.split(":", 1)
        if kind == "studio":
            studio(cam, rest, out_prefix)
        elif kind == "base":
            base(cam, rest, out_prefix)
        elif kind == "group":
            stems, count, seed = rest.split(":")
            group(cam, stems.split(","), int(count), int(seed), out_prefix)
        elif kind == "groupone":
            stem, count, seed = rest.split(":")
            group(cam, [stem], int(count), int(seed), out_prefix,
                  tag="group_" + stem.lower())
        elif kind == "floor":
            spec, seed = rest.rsplit(":", 1)
            if spec == "forest":
                table = FOREST_FLOOR
            else:
                table = tuple((s.split("@")[0], float(s.split("@")[1]))
                              for s in spec.split(","))
            floor(cam, table, int(seed), out_prefix)
        else:
            print("[render_flora] unknown shot %r" % shot)


if __name__ == "__main__":
    main()
