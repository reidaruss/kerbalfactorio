"""render_dock.py - the DOCKING INTERFACE, both halves, at the size it is judged at.

    blender --background --python tools/blender/render_dock.py

Writes docs/screenshots/dock_*.png.

WHY THIS EXISTS AND WHY IT IS A SEPARATE FILE FROM render_vessel.py.

`render_vessel.py` renders the catalogue: 24 parts across 1800 px, about 60 px
each. That answers "are these obviously different parts" and it cannot answer
anything about a mating FACE, which is 0.30 m tall on a part 1.25 m across and
is the whole of what a docking port is. Reid's acceptance test is "auto flight
and docking to the space station", so the face is the deliverable and it gets
its own camera.

THE THIRD SHOT IS THE ONE THAT MATTERS AND IT IS NOT A PORTRAIT. It places the
vessel's `DockingPort` at the station's own published `socket_dock`, using the
socket's position and its facing, and frames both. Nothing is typed: if the two
halves of the interface disagree about size or about which way the collar
faces, the disagreement is IN THE PICTURE rather than in a paragraph. That is
the instrument this asset actually needed, because a mating frame is a claim
about two assets and no single-asset render can falsify it.

MAPS ARE ON BY DEFAULT (`--nomaps` to strip them). The .glb never carries the
surface maps (see surface_preview.py), so an unmapped render of a steel part is
a render of a flat palette constant and says nothing about material response.
Any shot published from here states which it is.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

DIST = os.path.join(ROOT, "assets", "models", "dist")
OUT = os.path.join(ROOT, "docs", "screenshots")

# A NAME PREFIX FOR MATCHED PAIRS, the same lever render_vessel.py carries. A
# judgement about a shape needs the other shape beside it, and the pair is made
# by rendering the shipped bytes, restoring HEAD's .glb, and rendering again
# under a different prefix.
PREFIX = os.environ.get("OF_DOCK_PREFIX", "")

PART = "DockingPort"

# How far off the station's mating plane the vessel port is held for shot 3.
STANDOFF_M = 1.10


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]), 0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def setup_world(res, sky=(0.05, 0.07, 0.11), ground=False, sun=4.6):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = 48
    scn.cycles.use_denoising = True
    scn.render.resolution_x, scn.render.resolution_y = res
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = sky + (1,)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    key = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    key.data.energy = sun
    # A TIGHT SUN, not a soft one. Orbit has one light source and no
    # atmosphere, so the shadow terminator on a machined face is hard, and a
    # soft key is the single fastest way to make metal read as plastic.
    key.data.angle = math.radians(1.6)
    key.rotation_euler = (math.radians(62), 0.0, math.radians(-46))
    scn.collection.objects.link(key)

    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 2600.0
    fill.data.size = 14.0
    fill.location = (-9.0, -11.0, 5.0)
    look_at(fill, (0.0, 0.0, 0.4))
    scn.collection.objects.link(fill)

    if ground:
        g = bpy.data.meshes.new("Ground")
        g.from_pydata([(-40, -40, 0), (40, -40, 0), (40, 40, 0), (-40, 40, 0)],
                      [], [(0, 1, 2, 3)])
        g.update()
        scn.collection.objects.link(bpy.data.objects.new("Ground", g))

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.clip_start = 0.01
    cam.data.clip_end = 400.0
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def maps_on(off=False):
    import surface_preview
    rep = surface_preview.apply_all(off=off)
    return rep


def hide_non_lod0(keep_prefixes):
    """Show LOD0 and nothing else.

    A .glb holds every tier as siblings, so rendering the file raw draws LOD0,
    LOD1 and LOD2 on top of each other and two nearly-coincident surfaces
    z-fight, which reads exactly like broken geometry. Same rule
    render_check.py states."""
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        n = o.name
        keep = any(n.startswith(p) for p in keep_prefixes)
        if not keep or n.startswith("col_") or "_LOD1" in n or "_LOD2" in n:
            o.hide_render = True


def part_of(obj, names):
    """Climb to the part group an object belongs to. Sockets cannot be found by
    name after import (twenty parts publish a socket_stack_top and Blender
    uniques per file), so the parent chain is the only reliable route."""
    n = obj
    while n is not None:
        if n.name in names:
            return n.name
        n = n.parent
    return None


# THE BEFORE HALF OF A PAIR, WITHOUT SWAPPING A SHARED FILE. Point this at a
# `git show HEAD:...rocket_parts.glb` dump and every shot renders the OLD port
# under this file's EXACT lighting, camera and framing. That last part is the
# whole reason it exists: the first before/after pair on this pass was shot
# under two different skies, because the sky was changed BY the pass, and a
# pair that differs in its lighting cannot be read as a difference in its
# geometry. Other lanes share this checkout, so restoring an old binary into
# `assets/models/dist` to shoot a control is not available either.
#
# BOTH BINARIES, and the second one is here because leaving it out produced a
# mislabelled control on the first attempt. With only the rocket overridden,
# shots 3 and 4 rendered the NEW station and were written under the `before`
# prefix, so two of the four files in a `before` set were not befores at all.
# The collar shot came out byte-identical between the two runs, which is the
# tell, and is the same tell NUMBERS.md records for a stale wasm: identical
# output from a changed input means the input you changed was never read.
ROCKET_GLB = os.environ.get("OF_DOCK_ROCKET",
                            os.path.join(DIST, "rocket", "rocket_parts.glb"))
STATION_GLB = os.environ.get(
    "OF_DOCK_STATION", os.path.join(DIST, "structures", "space_station.glb"))


def import_port():
    """Import rocket_parts.glb, delete everything that is not the docking port,
    and return (mesh_object, socket_dock_world_matrix)."""
    bpy.ops.import_scene.gltf(filepath=ROCKET_GLB)
    keep, sock = None, None
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            if o.type == "EMPTY" and o.name.startswith("socket_dock") \
                    and part_of(o, {PART}) == PART:
                sock = o.matrix_world.copy()
            continue
        # EVERY mesh is hidden and exactly one is shown again. The sibling
        # tiers and the collision proxy are children of the SAME part group as
        # the tier under test, so a filter that only asks "is this the docking
        # port" keeps `col_DockingPort` and renders a black box over the part.
        # Found by looking at the first render, which is the point of the
        # first render.
        o.hide_render = True
        if o.name.startswith(PART + "_LOD0") and part_of(o, {PART}) == PART:
            keep = o
    if keep is None:
        raise SystemExit("DockingPort_LOD0 not in rocket_parts.glb")
    keep.hide_render = False
    return keep, sock


def measure(obj, label):
    """Print the envelope and the radial extent of a mesh, read off the object
    rather than transcribed from the build script."""
    vs = [obj.matrix_world @ v.co for v in obj.data.vertices]
    xs = [v.x for v in vs]
    ys = [v.y for v in vs]
    zs = [v.z for v in vs]
    print("[render_dock] %-18s x %+.4f..%+.4f  y %+.4f..%+.4f  z %+.4f..%+.4f"
          % (label, min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))
    print("[render_dock] %-18s tris(quads counted as 2) %d, verts %d"
          % (label, sum(max(0, len(p.vertices) - 2) for p in obj.data.polygons),
             len(obj.data.vertices)))


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
    print("[render_dock] wrote %s" % path)


def fresh(res, **kw):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    return setup_world(res, **kw)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    want_maps = "--nomaps" not in argv

    # ---- 1. the port, three-quarter, large -------------------------------
    # A MID-GREY STUDIO SKY AND NOT THE ORBITAL BLACK, for the same reason
    # render_vessel.py's contact sheet uses one: every surface on this part is
    # metal at metalness 0.80 to 0.85, so it renders whatever is above it, and
    # against a near-black world the whole value ladder collapses into one
    # black object. The first pass of this shot proved it - the port has a
    # deliberate SteelDark / Steel / SteelLight ladder and none of it was
    # visible. This is a shot for judging FORM. Shot 3 keeps the black sky,
    # because that is the light the part actually ships under.
    cam = fresh((1200, 900), sky=(0.34, 0.37, 0.42))
    port, sock = import_port()
    measure(port, "DockingPort")
    if sock is not None:
        print("[render_dock] socket_dock local (blender axes) %s"
              % (tuple(round(c, 4) for c in sock.translation),))
    maps_on(off=not want_maps)
    shoot(cam, (1.72, -1.86, 0.86), (0.0, 0.0, 0.15), 58.0, "dock_port_hero")

    # ---- 2. the mating face, down the axis -------------------------------
    # The face is the part. Everything a docking port does happens on the
    # 0.30 m of it that another hull touches, and a three-quarter view
    # foreshortens exactly that.
    cam = fresh((1000, 1000), sky=(0.34, 0.37, 0.42))
    port, _ = import_port()
    maps_on(off=not want_maps)
    shoot(cam, (0.35, -0.55, 1.85), (0.0, 0.0, 0.22), 0.0, "dock_port_face",
          ortho=1.55)

    # ---- 3. THE INTERFACE, both halves, nothing typed --------------------
    # The port is placed at the station's OWN socket_dock, with the socket's
    # own facing. If the two halves disagree, the picture disagrees.
    cam = fresh((1500, 900), sky=(0.04, 0.05, 0.08), sun=5.2)
    port, _ = import_port()
    bpy.ops.import_scene.gltf(filepath=STATION_GLB)
    station_sock = None
    for o in bpy.data.objects:
        if o.type == "EMPTY" and o.name.startswith("socket_dock") \
                and o.get("of_role") == "dock" and o is not port:
            # The station's is the one that is not at the origin.
            if o.matrix_world.translation.length > 1.0:
                station_sock = o
    hide_non_lod0({PART + "_LOD0", "Station_LOD0", "StationInterior_LOD0"})
    port.hide_render = False
    if station_sock is not None:
        m = station_sock.matrix_world
        print("[render_dock] station socket_dock at %s"
              % (tuple(round(c, 4) for c in m.translation),))
        # The port's own dock face is its +Z top at 0.30; put that face on the
        # station socket, facing back down the socket's own facing, and then
        # STAND IT OFF by STANDOFF_M along that facing.
        #
        # The standoff is what makes the shot legible and it is not a cheat.
        # Placed at zero the two ports interpenetrate, which is geometrically
        # what "mated" means and photographs as one object: the whole point of
        # an ANDROGYNOUS interface is that the two halves are the same shape,
        # so a mated pair cannot show you that there are two of them. Held
        # apart by a metre it reads as an approach, which is the state a player
        # actually flies, and both halves are visible at once.
        from mathutils import Matrix
        port.matrix_world = (Matrix.Translation(m.translation)
                             @ Matrix.Translation((STANDOFF_M, 0.0, 0.0))
                             @ Matrix.Rotation(math.radians(90.0), 4, "Y")
                             @ Matrix.Translation((0.0, 0.0, -0.30)))
    maps_on(off=not want_maps)
    shoot(cam, (40.5, -11.0, 7.4), (27.5, 0.0, 2.2), 44.0,
          "dock_interface_scale")

    # ---- 4. the station collar and its adapter ---------------------------
    # THE STUDIO SKY AGAIN, and for the shot's purpose rather than for
    # realism. Shot 3 above is the honest orbital light and this is the same
    # geometry lit so a human can see the shape of it: the first version of
    # this shot rendered the adapter as a black silhouette inside a black
    # collar, which is exactly what it will look like in shadow and exactly
    # useless for judging whether the adapter is the right size.
    cam = fresh((1300, 950), sky=(0.30, 0.33, 0.38), sun=4.4)
    bpy.ops.import_scene.gltf(filepath=STATION_GLB)
    hide_non_lod0({"Station_LOD0", "StationInterior_LOD0"})
    maps_on(off=not want_maps)
    shoot(cam, (36.2, -6.4, 5.4), (29.0, 0.0, 2.2), 46.0, "dock_collar")


if __name__ == "__main__":
    main()
