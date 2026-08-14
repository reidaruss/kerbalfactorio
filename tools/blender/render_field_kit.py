"""
render_field_kit.py - receipt frames for the two structures A6 owed: the
research station and the scanning antenna.

    ~/.local/bin/blender501 --background --python tools/blender/render_field_kit.py

Writes docs/screenshots/RN153*_{station,antenna}_*.png.

THE RIG IS render_ruin.py's, DELIBERATELY UNCHANGED: Cycles on the CPU (EEVEE
wants a GPU context a headless node does not reliably have, and a check that
only runs on one machine is not a check), `sensor_fit` pinned to VERTICAL with
the focal length derived through `lens_for`, a heightfield slab rather than a
plane so the object is seen meeting ground with thickness, and ONE LOD tier
imported at a time because a .glb holds every band as siblings and drawing LOD0
over LOD1 z-fights in a way that reads exactly like broken geometry.

WHAT IT LOADS IS THE SHIPPED BYTES. `harvest` imports from
assets/models/dist through the glTF importer, so a frame here is a frame of the
file the client will fetch, not of what was in memory when the build ran.

NO SURFACE MAPS ARE BOUND, AND THAT IS A LIMIT OF THE RIG. In the client
`Surfaces.ts` binds an albedo, a normal and an ORM by ROLE, so the shipped
station carries the `panel` family's plate grain and the antenna's reflector
carries its ORM response, and none of these frames shows any of it. READ THESE
AS FORM AND VALUE, NOT AS MATERIAL. A face that reads flat here may still read
flat with a map on it, which is worth fixing; the absence of texture in the
frame is the rig and not the asset.

THE TWO CLOSE FRAMES ARE AT `CLIENT_FOV_V_DEG` AND AT STANDING EYE HEIGHT,
which is render_ruin.py's own refusal to measure a lens: a console shot at a
comfortable 35 mm looks generous and the same console at the client's 60
degrees is the actual experience. The hero and silhouette frames are long
lenses on purpose and are labelled as such.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DIST = os.path.join(ROOT, "assets", "models", "dist", "structures")
OUT = os.path.join(ROOT, "docs", "screenshots")

CLIENT_FOV_V_DEG = 60.0
EYE_Z = 1.62
RES = (1500, 860)
SAMPLES = 44


def lens_for(fov_v_deg, sensor=36.0):
    return sensor / (2.0 * math.tan(math.radians(fov_v_deg) * 0.5))


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]), 0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def _bank(glb, only):
    """Import a .glb, bank ONE tier's mesh datablock and its world matrix, then
    clear every object in the scene.

    THE WHOLESALE CLEAR IS WHY BANKING AND PLACING ARE TWO STEPS. It is how the
    imported hierarchy (the root empty, the sockets, the col_* proxies and the
    other two tiers) gets dropped, and it does not distinguish between those and
    an instance a previous call already placed. The first version of this file
    placed inside this function, so the three-tier lineup shots imported LOD0,
    placed it, imported LOD1, DELETED LOD0, and ended with a single instance
    standing where LOD2 belonged - a frame that looks like a render of one
    object rather than like a bug. The datablock survives the clear because a
    Python reference is held to it."""
    bpy.ops.import_scene.gltf(filepath=glb)
    kept = None
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name == only:
            kept = (o.data, o.matrix_world.copy())
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    if kept is None:
        raise SystemExit("no mesh named %s in %s" % (only, glb))
    return kept


def place(kept, name, at=(0.0, 0.0, 0.0)):
    obj = bpy.data.objects.new(name + "_inst", kept[0])
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = kept[1]
    obj.location = (obj.location[0] + at[0], obj.location[1] + at[1],
                    obj.location[2] + at[2])
    return obj


def harvest(glb, only, at=(0.0, 0.0, 0.0)):
    """Bank one tier and place it. The single-object case."""
    return place(_bank(glb, only), only, at)


def ground(z=0.0, half=60.0):
    """A slab with 40 m of skirt: a plane has no edge, and a skid standing on
    four levelling feet has to be seen meeting something with thickness."""
    verts = [(-half, -half, z), (half, -half, z), (half, half, z),
             (-half, half, z), (-half, -half, z - 40.0),
             (half, -half, z - 40.0), (half, half, z - 40.0),
             (-half, half, z - 40.0)]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2),
             (2, 6, 7, 3), (3, 7, 4, 0)]
    me = bpy.data.meshes.new("Ground")
    me.from_pydata(verts, [], faces)
    me.update()
    obj = bpy.data.objects.new("Ground", me)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.new("GroundMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.128, 0.108, 0.079, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.95
    me.materials.append(mat)
    return obj


def world(sun_alt_deg, sun_az_deg, energy=4.4, sky=(0.20, 0.24, 0.30, 1)):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = SAMPLES
    scn.cycles.use_denoising = True
    scn.render.resolution_x, scn.render.resolution_y = RES
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = sky
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = w
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = energy
    sun.data.angle = math.radians(2.0)
    sun.rotation_euler = (math.radians(sun_alt_deg), 0.0,
                          math.radians(sun_az_deg))
    scn.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.sensor_fit = "VERTICAL"
    cam.data.clip_start = 0.02
    cam.data.clip_end = 900.0
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def shoot(cam, pos, target, fov_v, name):
    cam.data.lens = lens_for(fov_v)
    cam.location = pos
    look_at(cam, target)
    path = os.path.join(OUT, name + ".png")
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("[render_field_kit] wrote %s" % path)


def scene(glb, only, sun_alt, sun_az, energy=4.4, sky=(0.20, 0.24, 0.30, 1),
          at=(0.0, 0.0, 0.0)):
    """Import FIRST, then light: `harvest` clears bpy.data.objects wholesale to
    drop the imported hierarchy once the mesh is banked, so anything built
    before it is deleted with it (render_ruin.py's note)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    harvest(glb, only, at)
    return world(sun_alt, sun_az, energy, sky)


STATION = os.path.join(DIST, "research_station.glb")
ANTENNA = os.path.join(DIST, "scanning_antenna.glb")


def main():
    # ONLY the args after `--`. `sys.argv` under `blender --background --python
    # foo.py` still holds blender's own argv, including the SCRIPT PATH, which
    # does not start with a dash: a naive filter selected "tools/blender/
    # render_field_kit.py" as the wanted shot name and the script rendered
    # nothing at all, silently and in 0.7 seconds.
    want = set(sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else set()

    def on(tag):
        return not want or tag in want

    # RN-1531, THE STATION HERO. Off the -Y / -X bearing, because -Y is the
    # face `ResearchStations.faceToward` turns toward whoever placed it: this
    # is the view a player has by construction. 8.3 m of range at 30 degrees
    # gives a 4.4 m frame height against a 2.44 m asset on a 2.00 m skid, so
    # the whole object is in with a margin and the ground line is visible.
    if on("hero"):
        cam = scene(STATION, "ResearchStation_LOD0", 54.0, -34.0)
        ground()
        shoot(cam, (-4.40, -6.60, 3.20), (0.0, -0.10, 1.20), 30.0,
              "RN1531_station_hero")

    # RN-1532, THE CONSOLE, AT THE CLIENT'S OWN LENS AND EYE HEIGHT, standing
    # where a player stands to use it: 0.95 m off the bench's front edge, eye
    # at 1.62 m, looking at the screen centre. If the screen does not read as a
    # screen from here it does not read as one anywhere, because here is the
    # only place the game ever puts you.
    if on("console"):
        cam = scene(STATION, "ResearchStation_LOD0", 46.0, -20.0)
        ground()
        shoot(cam, (-0.14, -1.95, EYE_Z), (-0.14, 0.10, 1.28),
              CLIENT_FOV_V_DEG, "RN1532_station_console")

    # RN-1533, THE SERVICE SIDE. +Y / +X, which is the half of the asset the
    # player is never turned toward and which therefore has to earn its
    # triangles on its own: the bolted hatch, the junction box, the tray, the
    # drip lips, the vent bank on the cold end and the drip stain under it.
    if on("service"):
        cam = scene(STATION, "ResearchStation_LOD0", 50.0, 152.0)
        ground()
        shoot(cam, (4.70, 5.70, 3.20), (-0.10, 0.20, 1.15), 30.0,
              "RN1533_station_service")

    # RN-1534, THE ANTENNA HERO, from the -Y bearing the dish is aimed along,
    # low and close so the reflector face, the quadripod and the feed are all
    # legible and the lattice is behind them. 9.2 m at 40 degrees is a 6.7 m
    # frame height at the mast, which takes the whole 6.00 m with the anchors.
    if on("dish"):
        cam = scene(ANTENNA, "ScanningAntenna_LOD0", 52.0, -40.0)
        ground()
        shoot(cam, (-3.20, -8.90, 2.20), (0.0, -0.20, 3.20), 40.0,
              "RN1534_antenna_hero")

    # RN-1535, THE SILHOUETTE, WHICH IS THE FRAME THE LATTICE EXISTS FOR. A low
    # sun almost behind the mast and a bright sky: the tower goes to near
    # black and the only question the frame asks is whether sky comes through
    # it. A tube would read as a black bar here.
    if on("sky"):
        cam = scene(ANTENNA, "ScanningAntenna_LOD0", 78.0, 96.0, energy=3.2,
                    sky=(0.42, 0.52, 0.66, 1))
        ground()
        shoot(cam, (11.60, -4.00, 1.40), (0.0, 0.0, 3.10), 34.0,
              "RN1535_antenna_sky")

    # RN-1536, THE BASE, at standing eye height where a player walks past it:
    # the plinth, the kerb, the equipment cabinet with its hood and hatch, the
    # feeder landing in the gland box, the bonding braid, and one guy running
    # down to its anchor through its turnbuckle.
    if on("base"):
        cam = scene(ANTENNA, "ScanningAntenna_LOD0", 48.0, -62.0)
        ground()
        shoot(cam, (-2.70, -3.00, EYE_Z), (-0.55, -0.10, 0.75),
              CLIENT_FOV_V_DEG, "RN1536_antenna_base")

    # RN-1537, THE LADDER, both assets, three tiers side by side at one camera.
    # The receipt for the shadow-LOD table: LOD1 is the tier two of the three
    # cascades draw, so what it drops has to be invisible at range and the
    # frame is where that claim is judged rather than asserted.
    if on("lods"):
        for (tag, glb, stem, span, cam_at, tgt, fov) in (
                ("station", STATION, "ResearchStation", 2.7,
                 (0.0, -16.5, 4.0), (0.0, 0.0, 1.2), 24.0),
                ("antenna", ANTENNA, "ScanningAntenna", 3.7,
                 (0.0, -22.0, 4.6), (0.0, 0.0, 3.0), 26.0)):
            bpy.ops.wm.read_factory_settings(use_empty=True)
            os.makedirs(OUT, exist_ok=True)
            banked = [_bank(glb, "%s_LOD%d" % (stem, i)) for i in range(3)]
            for i, kept in enumerate(banked):
                place(kept, "%s_LOD%d" % (stem, i), ((i - 1) * span, 0.0, 0.0))
            cam = world(52.0, -34.0)
            ground()
            shoot(cam, cam_at, tgt, fov, "RN1537_%s_lods" % tag)


if __name__ == "__main__":
    main()
