"""
render_vessel.py - assemble the shipped vessel parts into a real rocket and
render it, so the stack contract can be SEEN as well as computed.

    blender --background --python tools/blender/render_vessel.py

Writes docs/screenshots/vessel_*.png.

WHY THIS EXISTS. It is the same argument render_structures.py makes for the
base module. Every part in rocket_parts.glb passes validate_glb.py on its own,
and every part passed on its own before the two diameter classes existed too.
What a per-file check cannot see is a JOINT: a 2.50 m decoupler quietly sitting
on a 1.25 m tank, an adapter the right height but the wrong way up, a strap-on
booster whose standoff leaves it 30 mm inside the core. Those exist only in an
assembly, so an assembly is what gets rendered.

check_mating.py measures the same assembly arithmetically and prints the gaps.
This is the other half: the arithmetic says the numbers agree, the picture says
the thing looks like a rocket. DW-7's lesson was that structural validation
cannot replace looking at the thing, and it cost a character with 144
unweighted vertices to learn.

PLACEMENT USES NOTHING BUT THE PUBLISHED INTERFACE. Stack parts are placed by
walking socket_stack_top, radial parts by the standoff socket_radial_out
publishes. No height table is typed here. If the render shows a seam, the parts
are wrong, not the picture.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

DIST = os.path.join(ROOT, "assets", "models", "dist", "rocket")
OUT = os.path.join(ROOT, "docs", "screenshots")
# A NAME PREFIX FOR MATCHED PAIRS (RN-436). Every shot here is a judgement
# about a shape, and a judgement about a shape needs the other shape beside it.
# The pair is made by rendering the shipped bytes, restoring HEAD's .glb into
# dist, rendering again under a different prefix, and rebuilding; so the only
# thing this file needs is somewhere else to write. Default is empty, so every
# existing filename is unchanged.
PREFIX = os.environ.get("OF_VESSEL_PREFIX", "")

# The three parts Reid handles most, rendered LARGE and side by side. The
# catalogue sheet renders 24 parts across 1800 px, i.e. about 60 px each, which
# is enough to answer "are these different parts" and nowhere near enough to
# answer "does this look like hardware". Those are different questions and they
# need different shots.
HEROES = ["LiquidEngineSmall", "LiquidTankSmallLong", "CommandPod"]

# The reference vessel, bottom up. It is a genuine two-stage rocket rather
# than a display chain: a class L core, an adapter down to class S, a small
# upper stage, and a crew section on top.
#
# THE UPPER ENGINE SITS ON THE DECOUPLER, and that is the interstage. An engine
# publishes no socket_stack_bottom, because nothing may ever be bolted under a
# bell, but it is still legal to PLACE one on a socket_stack_top: its bell then
# fires away from the joint, which is exactly what a stage separation is.
STACK = ["LiquidEngineLarge", "LiquidTankLarge", "StackAdapter",
         "StackDecouplerSmall", "EngineVacuumSmall", "LiquidTankSmallLong",
         "Battery", "DockingPort", "CommandPod", "Parachute", "NoseCone"]

# Every part in the catalogue, for the contact sheet, in catalogue order:
# class S stack parts, then class L, then the radial family.
CATALOGUE = [
    # LiquidEngineSmall and EngineVacuumSmall are ADJACENT on purpose. Choosing
    # between them is the decision the catalogue exists to support, so the
    # contact sheet has to answer "are these obviously different parts" without
    # anyone having to scroll between them.
    ["LiquidEngineSmall", "EngineVacuumSmall", "LiquidTankSmall",
     "LiquidTankSmallLong",
     "StackDecouplerSmall", "CargoBay", "NoseCone", "Parachute", "CommandPod",
     "SolidBooster", "MonopropTank", "ReactionWheel", "Battery", "DockingPort",
     "LiquidEngineLarge", "LiquidTankLarge", "StackDecouplerLarge",
     "StackAdapter", "RadialDecoupler", "EngineVernier", "Fin", "RcsBlock",
     "LandingLeg", "SolarPanel"],
]

ANIMATED = {"LandingLeg": "LandingLeg_Strut", "SolarPanel": "SolarPanel_Array"}


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]), 0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def setup_world(res, sky=(0.05, 0.07, 0.11), ground=True):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = 32
    scn.cycles.use_denoising = True
    scn.render.resolution_x, scn.render.resolution_y = res
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = sky + (1,)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.6
    sun.data.angle = math.radians(4.0)
    sun.rotation_euler = (math.radians(58), 0.0, math.radians(-40))
    scn.collection.objects.link(sun)

    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 9000.0
    fill.data.size = 24.0
    fill.location = (-16.0, -18.0, 12.0)
    look_at(fill, (0.0, 0.0, 6.0))
    scn.collection.objects.link(fill)

    if ground:
        g = bpy.data.meshes.new("Ground")
        g.from_pydata([(-60, -60, 0), (60, -60, 0), (60, 60, 0), (-60, 60, 0)],
                      [], [(0, 1, 2, 3)])
        g.update()
        scn.collection.objects.link(bpy.data.objects.new("Ground", g))

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.clip_start = 0.02
    cam.data.clip_end = 400.0
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def part_of(obj, names):
    """Climb to the part group this object belongs to.

    Sockets cannot be found by name after import: twenty parts publish a
    socket_stack_top, Blender uniques duplicate object names per FILE, and the
    importer therefore hands back socket_stack_top.001 .. .019 in whatever
    order the scene happens to be in. The part GROUP names are unique, so the
    parent chain is the only reliable way to ask which part a socket belongs
    to. This is the same rule ASSET-SPECS 2.6 states for the runtime.
    """
    n = obj
    while n is not None:
        if n.name in names:
            return n.name
        n = n.parent
    return None


def harvest():
    """Import rocket_parts.glb and bank, per part: its LOD0 mesh datablock with
    the world matrix it had in the file, and the height its socket_stack_top
    publishes."""
    bpy.ops.import_scene.gltf(filepath=os.path.join(DIST, "rocket_parts.glb"))
    names = set(sum(CATALOGUE, []))
    meshes, tops, extra = {}, {}, {}
    for o in list(bpy.data.objects):
        owner = part_of(o, names)
        if owner is None:
            continue
        if o.type == "MESH" and o.name.startswith(owner + "_LOD0"):
            meshes[owner] = (o.data, o.matrix_world.copy())
        elif o.type == "MESH" and owner in ANIMATED \
                and o.name.startswith(ANIMATED[owner]):
            extra[owner] = (o.data, o.matrix_world.copy())
        elif o.type == "EMPTY" and o.name.startswith("socket_stack_top"):
            tops[owner] = o.matrix_world.translation.z
        elif o.type == "EMPTY" and o.name.startswith("socket_radial_out"):
            tops["@standoff"] = o.matrix_world.translation.x
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    missing = names - set(meshes)
    if missing:
        raise SystemExit("missing part meshes in dist: %s" % sorted(missing))
    return meshes, tops, extra


def place(bank, key, loc, yaw_deg=0.0, name=None):
    from mathutils import Euler, Matrix
    data, local = bank[key]
    obj = bpy.data.objects.new((name or key) + "_inst", data)
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = (Matrix.Translation(loc)
                        @ Euler((0, 0, math.radians(yaw_deg)), "XYZ").to_matrix().to_4x4()
                        @ local)
    return obj


def radius_of(bank, key):
    """The part's own diameter, measured off the banked mesh: this is the
    diameter CLASS, read back rather than declared."""
    data, local = bank[key]
    xs = [(local @ v.co).x for v in data.vertices]
    return (max(xs) - min(xs)) * 0.5


def build_vessel(meshes, tops, extra):
    """The reference vessel, placed by walking socket_stack_top and nothing
    else, plus strap-ons placed by the published radial standoff."""
    z = 0.0
    at = {}
    for name in STACK:
        place(meshes, name, (0.0, 0.0, z))
        at[name] = z
        z += tops.get(name, 0.0)

    core_r = radius_of(meshes, "LiquidTankLarge")
    boost_r = radius_of(meshes, "SolidBooster")
    standoff = tops["@standoff"]
    d = core_r + standoff + boost_r
    # The booster's socket_radial_attach sits 3.00 m up its own side, so a
    # booster standing on z = 0.30 puts its attach point at 3.30, which is
    # where the decoupler goes. Both are on the core tank, which spans 2.60 to
    # 6.60, so the joint is on hull and not on a collar.
    attach_z, booster_base = 3.30, 0.30
    for deg in (0.0, 180.0):
        a = math.radians(deg)
        place(meshes, "RadialDecoupler",
              (core_r * math.cos(a), core_r * math.sin(a), attach_z), deg)
        place(meshes, "SolidBooster", (d * math.cos(a), d * math.sin(a),
                                       booster_base), deg)
    for deg in (45.0, 135.0, 225.0, 315.0):
        a = math.radians(deg)
        place(meshes, "Fin", (core_r * math.cos(a), core_r * math.sin(a),
                              at["LiquidTankLarge"] + 0.60), deg)
    up_r = radius_of(meshes, "LiquidTankSmallLong")
    for deg in (90.0, 270.0):
        a = math.radians(deg)
        place(meshes, "RcsBlock", (up_r * math.cos(a), up_r * math.sin(a),
                                   at["LiquidTankSmallLong"] + 3.40), deg)
        place(meshes, "SolarPanel", (up_r * math.cos(a), up_r * math.sin(a),
                                     at["LiquidTankSmallLong"] + 1.20), deg)
        if "SolarPanel" in extra:
            place(extra, "SolarPanel",
                  (up_r * math.cos(a), up_r * math.sin(a),
                   at["LiquidTankSmallLong"] + 1.20), deg, name="SolarArray")
    return z


def build_sheet(meshes, extra):
    """Every part in the catalogue in one row on the ground: the contact sheet.

    One row rather than a grid, because a grid puts the near row in front of
    the far one and the whole point of a contact sheet is that nothing is
    occluded. Spacing is by MEASURED width, so a part that grew would push its
    neighbours apart instead of overlapping them.
    """
    x = 0.0
    for name in CATALOGUE[0]:
        w = radius_of(meshes, name) * 2.0
        x += w * 0.5 + 0.55
        place(meshes, name, (x, 0.0, 0.0))
        if name in ANIMATED and name in extra:
            place(extra, name, (x, 0.0, 0.0), name=name + "_moving")
        x += w * 0.5
    return x


def shoot(cam, pos, target, lens, name, ortho=None):
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = "PERSP"
        cam.data.lens = lens
    cam.location = pos
    look_at(cam, target)
    path = os.path.join(OUT, PREFIX + name + ".png")
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_vessel] wrote %s" % path)


def scene(res, **kw):
    """Import first, THEN light the set: harvest() clears bpy.data.objects to
    drop the imported hierarchy once the mesh datablocks are banked, so
    anything built before it is deleted too."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    banked = harvest()
    return setup_world(res, **kw), banked


def main():
    cam, (meshes, tops, extra) = scene((760, 1100))
    top = build_vessel(meshes, tops, extra)
    shoot(cam, (26.0, -30.0, 12.0), (0.0, 0.0, top * 0.48), 52.0,
          "vessel_assembly", ortho=None)

    # The adapter joint on its own, because the class change is the one thing
    # in this catalogue that a wide shot cannot show.
    cam, (meshes, tops, extra) = scene((900, 620))
    build_vessel(meshes, tops, extra)
    shoot(cam, (7.4, -8.0, 8.9), (0.0, 0.0, 7.3), 78.0, "vessel_adapter_joint")

    # The contact sheet gets a BRIGHT world, and that is not a cosmetic
    # choice. Every part is metal, and a horizontal metal face reflects
    # whatever is above it; against the near-black sky the assembly shot uses,
    # every tank top renders as a black mirror and reads exactly like a
    # missing cap. The caps are there (the exported NORMAL accessor has +Y on
    # all 24 top-ring vertices of the large tank), so the fix belongs in the
    # lighting, not in the geometry.
    cam, (meshes, tops, extra) = scene((1800, 460), sky=(0.42, 0.45, 0.50))
    width = build_sheet(meshes, extra)
    shoot(cam, (width * 0.5, -42.0, 4.2), (width * 0.5, 0.0, 2.7), 0.0,
          "vessel_catalogue", ortho=width + 1.6)

    # THE TWO SMALL ENGINES, SIDE BY SIDE AND LARGE. A player choosing between
    # a sea-level and a vacuum engine is worth about 970 m/s of upper-stage
    # delta-v by the physics lane's measurement, so "are these obviously
    # different parts" is a real acceptance question and not a nicety. The
    # contact sheet cannot answer it, because at 24 parts across it renders
    # each one about 60 pixels wide. This shot exists to be looked at whenever
    # either engine changes.
    cam, (meshes, tops, extra) = scene((900, 620), sky=(0.42, 0.45, 0.50))
    place(meshes, "LiquidEngineSmall", (-0.85, 0.0, 0.0))
    place(meshes, "EngineVacuumSmall", (0.85, 0.0, 0.0))
    shoot(cam, (0.0, -9.0, 1.35), (0.0, 0.0, 0.72), 0.0,
          "vessel_engines", ortho=3.6)

    # THE THREE HERO PARTS, ON THE NEUTRAL FLOOR, AT THE SIZE THEY ARE
    # JUDGED AT (RN-436). Framed by the tallest part rather than by a typed
    # height, and spaced by MEASURED width, so a part that grew pushes its
    # neighbours apart instead of overlapping them.
    cam, (meshes, tops, extra) = scene((1500, 940), sky=(0.40, 0.43, 0.48))
    x, top = 0.0, 0.0
    for name in HEROES:
        w = radius_of(meshes, name) * 2.0
        x += w * 0.5 + 0.95
        place(meshes, name, (x, 0.0, 0.0))
        top = max(top, tops.get(name, 2.6))
        x += w * 0.5
    # FRAMED BY THE MEASURED HEIGHT, WITH MARGIN, AND THE ARITHMETIC IS
    # WRITTEN DOWN because the first take cropped the tank and the pod. At
    # lens L on a 36 mm sensor fitted HORIZONTALLY, the vertical half-angle is
    # atan(18 / aspect / L), so a 4.00 m part needs distance >= 2.4 / tan of
    # that. 62 mm at 11.5 m covered 4.14 m about a centre of 1.84 and cut the
    # top off at 3.91. This is the flora lane's `studio:` bug in a different
    # tool: a shot framed by one number, aimed just past the thing it exists
    # to show.
    dist, lens, aspect = 15.0, 50.0, 1500.0 / 940.0
    cover = 2.0 * dist * (18.0 / aspect) / lens
    assert cover > top * 1.35, "hero frame covers %.2f m for a %.2f m part" \
        % (cover, top)
    shoot(cam, (x * 0.5 - 0.5, -dist, top * 0.66), (x * 0.5, 0.0, top * 0.50),
          lens, "vessel_heroes")

    # And the same three from a standing player's distance, which is the VAB's
    # own working range and the only one at which a weld seam is a weld seam.
    cam, (meshes, tops, extra) = scene((1500, 700), sky=(0.40, 0.43, 0.48))
    place(meshes, "LiquidEngineSmall", (0.0, 0.0, 0.0))
    place(meshes, "LiquidTankSmallLong", (2.00, 0.0, 0.0))
    place(meshes, "CommandPod", (4.00, 0.0, 0.0))
    shoot(cam, (2.00, -6.6, 1.62), (2.00, 0.0, 1.30), 50.0, "vessel_close")


if __name__ == "__main__":
    main()
