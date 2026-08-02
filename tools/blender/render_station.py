"""render_station.py - the derelict station from outside, from INSIDE, and
with a person standing in it.

    blender --background --python tools/blender/render_station.py -- \\
        ext RN_station --nomaps
    blender --background --python tools/blender/render_station.py -- \\
        int RN_station --maps --only StationInt_LOD0
    blender --background --python tools/blender/render_station.py -- \\
        scale RN_station --maps

WHY THIS IS NOT render_structures.py AND NOT render_machines.py. Both of those
frame an OBJECT: they solve a stand-off from a bounding box, orbit it, and
photograph its outside. That is the right instrument for a 4 m wall panel and
for an 8 m assembler, and it is structurally unable to answer the only question
a 60 m walkable wreck actually raises, which is whether the inside of it is a
PLACE. Every exterior view of this asset is a silhouette, and a silhouette is
precisely the picture in which a corridor 1.8 m wide, or with a beam across it
at 1.85 m, or with no floor under a hatch, looks perfect.

THE MEASUREMENT MISTAKE THIS RIG EXISTS TO PREVENT is judging an interior from
outside it. The mistake is cheap to make and expensive to find: it is found by
walking into the thing in the browser, three days after the geometry froze,
which is the point at which a 2.5 m corridor is no longer a number anybody is
willing to change. So the interior gets its own mode, and that mode does not
get to choose its own camera.

THE INTERIOR CAMERA IS A PLAYER, NOT A DRONE, and that is the whole value of
`int`. The eye sits at EYE_Z, the standing eye height of the 1.80 m player body
(the same 1.66 m render_machines' `face` view stands at), and the frame is
CLIENT_FOV_V_DEG wide vertically because that is what the shipped camera does.
A studio that picks a comfortable 35 mm lens for an interior is not measuring
the interior, it is measuring a lens: a corridor shot at 35 mm looks generous
and the same corridor at the client's 60 degrees has both walls hard against
the frame edge, which is the actual experience and the actual defect.

THE FOV IS DERIVED, NEVER TYPED, for render_player.py's reason. Blender fits
its sensor to the LARGER output dimension under `sensor_fit = 'AUTO'`, so the
same focal length frames a landscape render horizontally while three.js
`PerspectiveCamera.fov` is always VERTICAL. `sensor_fit` is pinned to
'VERTICAL', the focal length comes out of the angle through `lens_for`, and
therefore `--res` cannot silently change the framing of any shot in this file.

A CAMERA INSIDE A BOX RENDERS ITS INSIDE (render_launch_pad.py, the
`human_deck` shot: the eye point stood inside a solid control bunker and the
frame came back black). Every shot in `int` is deliberately inside a box, so it
follows that the failure
signature is INVERTED here and has to be read the other way: a black interior
frame does not mean the fill failed, it usually means the eye or the fill has
been typed into the thickness of a bulkhead. Check the position against the
geometry before touching the light.

THE FILL IS A CHEAT AND IS LABELLED ONE. The asset's own emissive light strips
are the in-game answer to a dark interior and nothing here substitutes for
seeing them lit. The `int` and `scale` fill exists only so a studio still can
show the FORM of a space that the sun cannot reach, it is a light no player
carries, and `--nofill` turns it off. It is added only in those two modes: the
world, the sun and the view transform are identical in all three, so an
exterior pair taken a week apart is still comparable.

NO GROUND PLANE, AND THAT IS NOT A DEFAULT, IT IS THE SUBJECT. This thing is in
orbit. A floor at z = 0 under an exterior shot is a claim that it is sitting on
a planet, and it also throws a large bounce up into every underside the sun
never reaches, which is the one place a wreck's damage lives. `add_ground` is
opt-in through `--ground` and is off everywhere by default.

Cycles on the CPU, for render_check.py's reason: EEVEE wants a GPU context a
headless Windows Blender does not reliably have, and a check that only runs on
one machine is not a check.
"""

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    # Blender only puts the script's own directory on sys.path for some
    # invocation paths, so `import surface_preview` is made explicit rather
    # than lucky (render_creatures.py's note).
    sys.path.insert(0, HERE)

STATION = "assets/models/dist/structures/space_station.glb"
PLAYER = "assets/models/dist/player/player_body.glb"
OUT = "docs/screenshots"

# The shipped vertical field of view, read off web/src/render/CameraRig.ts
# (`private fovDeg = 60`, applied to every camera and never changed because
# setFov has no caller). `ASSET-SPECS 4.2` says "roughly 70 degrees" and the
# client does not use that number; render_player.py's RN-641 note is the
# correction and this is the same one. Everything framed as "what the player
# sees" is derived from this through `lens_for`, with `sensor_fit` pinned to
# VERTICAL so two resolutions stay comparable.
CLIENT_FOV_V_DEG = 60.0

# Standing eye height. `CAPSULE.eyeHeightM` in web/src/player/Capsule.ts, on
# a 1.80 m player. 1.62 and NOT the 1.66 render_machines' `face` view stands
# at: this rig reports a headroom result and a sightline result, so it takes
# the number from the walker rather than from a sibling studio. Every interior
# eye point derives its z from here rather than typing it five times, because
# five typed copies is five chances to leave one at 1.66.
EYE_Z = 1.62

# Authored interior envelope, restated ONLY as the thing the shots are checked
# against: corridors 3.00 m wide with 4.00 m of clear headroom, a 5.00 x 5.60 m
# hold, a 16.20 m hall, main deck at z = 0, local +Z up. THE HEADROOM IS 4.00
# AND NOT 2.50 BECAUSE OF A PHYSICS MEASUREMENT: at 400 km gravity is 3.49886
# m/s2, so the jump apex is 2.319915 m and the walker's top collision sample is
# 1.65 m above the feet, and a 2.50 m corridor is one a player jumps into the
# ceiling of. Nothing below is derived from these; they are what a frame is
# read for.
CORRIDOR_W = 3.0
HEADROOM = 4.0
HOLD_CZ = 5.60
HALL_R = 8.10
DECK_Z = 0.0

# Set from the command line in main(). Module level rather than threaded
# through every signature, because a flag that has to be passed through five
# functions gets dropped from one of them (render_machines.py's rule).
_MAPS = None          # None leaves the .glb's own materials alone
_MERGED = False
_FILL = True
_GROUND = False
_ONLY = None
_RES = (1600, 900)
_SAMPLES = 48


# ---------------------------------------------------------------------------
# Views. EXTERIOR: (camera xyz, look-at xyz, vertical FOV in degrees).
#
# The angle is carried rather than a focal length, because a focal length only
# means something once the sensor fit and the aspect are known, and carrying
# the angle is what lets the interior shots state the client's own number
# instead of a lens that approximates it at one resolution.
#
# Station frame: +X forward (the intact bow), -X aft (the wrecked end), +Z up,
# roughly 60 m along X, up to 70 m across Y with the solar wings out, 18 m in
# Z. Distances below are solved from that envelope, not guessed: at FOV f and
# range d the frame is 2*d*tan(f/2) tall and 16/9 of that wide at the default
# resolution, so each view is checked to contain the projected extent with
# about 15 per cent of margin.
# ---------------------------------------------------------------------------

VIEWS = {
    # The hero. High and forward off the PORT bow, i.e. +X and +Y, which is the
    # bearing that puts the intact end nearest the lens and runs the wreck away
    # from it: a derelict read from its damaged end first is a pile, read from
    # its intact end it is a ship that something happened to.
    # Range 115 m at 30 deg gives a 61 m frame height and a 110 m width; the
    # projected plan half-width on this bearing is 46 m, so the wings are in.
    "x34": ((86.0, 66.0, 38.0), (0.0, 0.0, 1.0), 30.0),
    # Dead broadside from -Y at a low elevation. The one view in which the 60 m
    # length and the deck stack read as a PROFILE rather than as perspective,
    # and therefore the only one in which "is the aft third visibly wrecked"
    # is a question about the geometry instead of about the camera.
    "xside": ((0.0, -118.0, 14.0), (0.0, 0.0, 2.0), 30.0),
    # Plan view, 8 degrees off dead overhead. The camera stays ON the +X axis
    # relative to the target on purpose: with the eye directly above the target
    # `look_at` still resolves, but any sideways nudge rolls the frame by
    # atan2 of the offset and a plan view of a 60 x 70 m object cannot afford
    # to arrive tilted. Frame up is world -X, frame right is world +Y, so the
    # 60 m length lies across the 73 m frame height and the 70 m wing span
    # across the 130 m width.
    "xtop": ((18.0, 0.0, 126.0), (0.0, 0.0, 0.0), 32.0),
    # The wrecked aft end, aimed at x = -24 rather than at the origin, because
    # a view of the damage centred on the whole station is a view of the whole
    # station. 74 m of range at 34 deg puts about 45 m across the frame.
    "xaft": ((-92.0, -26.0, 16.0), (-24.0, 0.0, 1.0), 34.0),
    # The intact bow, the counterpart to `xaft`. A wreck is only legible as a
    # wreck against the part of itself that is not one.
    "xbow": ((96.0, 22.0, 14.0), (24.0, 0.0, 1.0), 34.0),
    # CLOSE on the reactor module breach at roughly (-18, -9, 0). 23 m of range
    # at 30 deg is a 12 m frame height and a 22 m width, so the breach has the
    # hull either side of it for scale and nothing else. This is the frame that
    # either shows torn plate, ribs and an interior behind them, or shows a
    # hole cut in a box.
    "xbreach": ((-9.0, -28.0, 9.0), (-18.0, -9.0, 0.5), 30.0),
}

# INTERIOR: (eye xyz, look-at xyz). NO field of view, on purpose: every one of
# these is taken at CLIENT_FOV_V_DEG and a per-shot override is exactly the
# knob that would let a cramped corridor be photographed as a roomy one.
# The eye z is EYE_Z in every entry and is never typed as a number.
INTERIOR = {
    # Standing in the spine corridor on the centreline, looking forward down
    # +X. THE SHOT THIS MODE EXISTS FOR: a 2.5 m corridor at 60 degrees puts
    # both walls hard against the frame edge, and how far the eye can see
    # before something crosses the tunnel is the whole read.
    # The target is 20 m ahead and 0.12 m below the eye, which is where a
    # walking player's eyeline sits, not level.
    "spine_fwd": ((-19.0, 0.0, EYE_Z), (-4.0, 0.0, EYE_Z - 0.12)),
    # The same standing position turned around, looking -X toward the wrecked
    # end. Same eye, opposite direction: the pair is what shows whether the
    # corridor was authored in both directions or only along the one the
    # builder happened to be facing.
    # IN THE AFT COMPARTMENT, not looking into the back of the bulkhead
    # that closes it. x = -19.4 put the eye 0.6 m behind the SHUT frame
    # at x = -20.0 and the frame came back white, which is the fourth
    # time in one session an eye was typed into the wrong compartment.
    # The bay between -20.0 and the blown frame at -27.5 is 7.5 m long.
    "spine_aft": ((-21.6, 0.0, EYE_Z), (-29.5, 0.0, EYE_Z - 0.26)),
    # On the hub floor, off-centre at y = -4 so the far side of the volume is
    # across the frame rather than under the lens, looking into the hub AND UP.
    # A hub is a claim about volume and volume is the one thing an eye-level
    # level frame cannot show; the target is 4.2 m up for that reason.
    "hub": ((0.0, -5.6, EYE_Z), (0.0, 3.0, 5.6)),
    # In the hold, which is the section that proves the station is not one
    # corridor repeated: 5.00 m wide and 5.60 m tall against the spine's 3.00
    # by 4.00, and a player stepping between them is how a size gets felt.
    # y = -5.6 and not -3.4: the hold's own bulkhead stands at y = -4.0
    # with its hatch SHUT, so the first version of this shot stood 0.6 m
    # from a closed door and photographed it. The frame came back a white
    # rectangle, which is the interior mode working: an eye typed into the
    # wrong compartment is exactly what it is for.
    "hold": ((20.0, -5.6, EYE_Z), (20.0, -14.2, 2.4)),
    # The crew module, looking down the bunks.
    "hab": ((-14.0, 3.4, EYE_Z), (-14.0, 14.6, EYE_Z - 0.16)),
    # Four metres from a bulkhead hatch, square on, aimed at 1.30 m which is
    # about the centre of a 2 m opening. Four metres is not a composition, it
    # is the distance at which a hatch fills enough of a 60 degree frame to
    # judge whether the frame, the seal and the deck under it line up.
    "hatch": ((-16.0, 0.0, EYE_Z), (-20.0, 0.0, 1.30)),
}

# Per-shot fill strength, (energy in watts, area size in metres). A corridor is
# 2.5 m across and a hub is not, and one light cannot be right for both: the
# corridor value lights walls that are 1.25 m away, the hub value has to carry
# 10 m or more and falls off as the square of that.
FILL = {"hub": (1600.0, 4.0), "scale_hub": (1600.0, 4.0)}
FILL_DEFAULT = (400.0, 2.0)


def look_at(obj, target):
    d = [obj.location[k] - target[k] for k in range(3)]
    obj.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]),
                          0.0,
                          math.atan2(d[1], d[0]) + math.pi * 0.5)


def lens_for(fov_v_deg):
    """Focal length that gives `fov_v_deg` VERTICALLY on a 24 mm sensor height.

    Derived rather than typed. With sensor_fit pinned to VERTICAL this holds at
    every output resolution, which is the property that makes two renders at
    two resolutions comparable."""
    return 12.0 / math.tan(math.radians(fov_v_deg) * 0.5)


def setup_view_transform(scn):
    """Put the studio render on the SHIPPED response curve, not Blender's.

    RN-456'S FINDING, PORTED RATHER THAN REDISCOVERED, and porting it is the
    whole reason it was written down. rendering.md section 2.1 is the
    calibrated target: the client is ACES at exposure 1.2, contrast 1.45 on a
    slope-matched S, saturation 0.92, black point zero. Blender 5.0 defaults to
    AgX, which is both flatter and more desaturating than any of that, and it
    is applied to every pixel after the material has finished.

    `Standard` plus +0.26 stops (2 ** 0.26 = 1.20) plus a high-contrast look is
    the closest the stock OCIO config reaches. THIS IS NOT ACES and nothing
    here claims it is. What it buys is that the studio frame and the game frame
    are now wrong in the same DIRECTION rather than in opposite ones, so a
    surface judged here does not have to be judged from scratch again in the
    browser. It matters more on this asset than on most: a dim interior lives
    entirely in the bottom third of the curve, which is exactly where two
    transforms disagree most."""
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
    print("[render_station] view transform %r, look %r, exposure %+.2f stops"
          % (vs.view_transform, vs.look, vs.exposure))


def setup_world(samples):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = samples
    scn.cycles.use_denoising = True
    # NOT transparent. A transparent film would put the station on whatever the
    # viewer's image tool draws behind it, usually a checkerboard or white, and
    # a wreck lit by one hard sun against white is a picture of an outline. The
    # dim background below is the space this thing is actually in, and it is
    # also the only ambient the shadow side gets.
    scn.render.film_transparent = False
    setup_view_transform(scn)

    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    # The post-RN-551 calibrated value, same as render_machines.py and
    # render_creatures.py. A cool dim sky rather than a flat mid grey: a bright
    # neutral ambient is half the light in the frame, it arrives from every
    # direction at once, and it fills in every crease a normal map spent its
    # whole budget cutting. On a hull whose entire story is dents, tears and
    # scorch that is not a lighting preference, it is an erasure.
    world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.048, 0.058, 0.076, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 5.2
    # 2 degrees, not 6. Bare metal and a scorched panel both live or die on a
    # TIGHT specular, and a wide source smears it into the broad sheen that
    # made three creature renders read as matte leather whatever the roughness
    # map said. In orbit the real angular size of the sun is a quarter of a
    # degree, so if this number is wrong it is wrong in the soft direction.
    sun.data.angle = math.radians(2.0)
    sun.rotation_euler = (math.radians(52), 0.0, math.radians(38))
    bpy.context.scene.collection.objects.link(sun)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    # 0.02 m, because in `int` and `scale` the walls are 1.25 m from the lens
    # and a hatch frame can pass within a hand's width of it. Blender's 0.1 m
    # default would slice the near edge off a bulkhead and leave a clean
    # straight cut that reads as missing geometry.
    cam.data.clip_start = 0.02
    cam.data.clip_end = 4000.0
    # Pinned, and this is the whole reason the framing is trustworthy. 'AUTO'
    # fits the sensor to whichever output dimension is LARGER, so one lens
    # frames a portrait render vertically and a landscape render horizontally.
    # three.js `PerspectiveCamera.fov` is always the VERTICAL angle. Pinning
    # the fit makes the two agree by construction rather than by a resolution
    # nobody is going to re-check.
    cam.data.sensor_fit = "VERTICAL"
    cam.data.sensor_height = 24.0
    bpy.context.scene.collection.objects.link(cam)
    scn.camera = cam
    return cam


def boot(samples=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 60
    cam = setup_world(_SAMPLES if samples is None else samples)
    if _GROUND:
        add_ground()
    return cam


def add_ground(half=140.0):
    """A SUBSTRATE-coloured floor, opt-in with `--ground` and OFF by default.

    This asset is in orbit and a plane under it is a false statement about
    where it is. Worse, it is a false statement that flatters: a lit floor
    bounces into every underside and every torn edge, which is where a wreck
    keeps its damage and where the studio has no business adding light. The
    function exists for the one case where the station is being staged as a
    landed or crashed hulk; when it is used, the colour is section 2.1's
    substrate (groundNear luma 35 to 55, HSV saturation 0.25 to 0.35) rather
    than Blender's 0.8 default, which clips to paper white under the curve
    above."""
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata([(-half, -half, 0), (half, -half, 0),
                      (half, half, 0), (-half, half, 0)], [], [(0, 1, 2, 3)])
    mesh.update()
    mat = bpy.data.materials.new("StudioGround")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = (0.052, 0.045, 0.033, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.95
    mesh.materials.append(mat)
    bpy.context.scene.collection.objects.link(
        bpy.data.objects.new("Ground", mesh))
    print("[render_station] ground plane ON (--ground): this asset is in "
          "orbit, so every frame in this run is staging it as a landed hulk")


def import_asset(glb, scale=1.0, offset=(0.0, 0.0, 0.0), spin_deg=0.0):
    """Import one .glb and return (armature, [mesh objects], [roots]).

    THE IMPORTER SHIPS A 2 m SPHERE WITH THE FILE AND IT IS NOT IN THE FILE
    (RN-451). Blender's glTF importer creates a material-less mesh called
    `Icosphere` as the custom BONE DISPLAY SHAPE for the imported armature and
    parks it in a collection called `glTF_not_exported` that the view layer
    excludes, so a direct render never sees it. Anything that COPIES or LINKS
    an imported object escapes that exclusion and draws a white dome over the
    subject; the creature sheets did exactly that for two passes, and the tell
    (dark legs around a white body on an asset with one material) reads as a
    lost material and cost a material audit. The object's own hide flags are
    all False and say nothing about it, so the filter is by COLLECTION. This
    rig has to care because `scale` mode moves the player root and because
    anything added here later that clones a module will hit it.

    The third return value is a DELIBERATE DEVIATION from render_creatures.py
    and render_player.py, which both return a 2-tuple. `scale` mode has to put
    the same skinned player in two different places in one run, and a skinned
    mesh cannot be copied to do that: a copy sharing one armature modifier
    evaluates in the ARMATURE's space, so the copy stands wherever the original
    stands (render_machines.py found this). The root has to be moved instead,
    and re-importing to get a second position would collide the palette
    material names and earn a `.001` suffix that surface_preview skips, which
    would leave the second frame flat next to a textured first one."""
    before = set(bpy.context.scene.objects)
    path = glb if os.path.isabs(glb) else os.path.join(ROOT, glb)
    if not os.path.isfile(path):
        raise SystemExit("[render_station] missing %s" % path)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in before
           and not any(c.name.startswith("glTF_not_exported")
                       for c in o.users_collection)]
    arm, meshes, roots = None, [], []
    for o in new:
        if o.type == "ARMATURE":
            arm = o
        elif o.type == "MESH":
            meshes.append(o)
        if o.parent is None:
            roots.append(o)
            o.scale = (scale, scale, scale)
            o.rotation_mode = "XYZ"
            o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1],
                                o.rotation_euler[2] + math.radians(spin_deg))
            o.location = tuple(o.location[k] + offset[k] for k in range(3))
    print("[render_station] imported %s: %d object(s), %d mesh(es), arm %s"
          % (os.path.basename(path), len(new), len(meshes),
             arm.name if arm else None))
    return arm, meshes, roots


def place_root(roots, x, y, yaw_deg):
    """Move an imported hierarchy by its ROOT, for import_asset's reason."""
    for o in roots:
        o.location = (x, y, 0.0)
        o.rotation_euler = (o.rotation_euler[0], o.rotation_euler[1],
                            math.radians(yaw_deg))
    bpy.context.view_layer.update()


def _is_lodn(name):
    return any(name.endswith("_LOD%d" % i) for i in range(1, 10))


def visible_nodes(only=None, always=()):
    """Hide what the client does not draw, and honour `--only`.

    THE col_ RULE IS NOT COSMETIC. The collision proxies are boxy, oversized
    and untextured by construction, and they sit a few centimetres outside the
    surfaces they wrap. A studio frame that renders them is not a slightly
    wrong picture of the station, it is a picture of a DIFFERENT and much
    cruder station, and every judgement made from it about silhouette,
    clearance or greeble density is a judgement about the proxy. The client
    hides them; a rig that does not is lying.

    LOD1 and up are hidden for render_check.py's reason: drawn on top of LOD0
    the two nearly coincident surfaces z-fight, which reads exactly like broken
    geometry and has been mistaken for it before.

    `only` keeps the render nodes whose names start with it and hides the rest,
    so `Station_LOD0` and `StationInt_LOD0` can be shot separately. That is not
    a convenience: from an eye point inside the hull the exterior shell is
    BETWEEN the camera and nothing, and its inward-facing back sides can render
    as a black skin over the entire interior frame.

    `always` is a tuple of name prefixes that `only` may not hide, and it has
    one caller and one reason: `scale` mode loads the human reference into the
    same file, so an `--only StationInt_LOD0` run would otherwise hide the very
    thing the mode exists to put in the frame and hand back a picture of an
    empty corridor with nothing to measure it against. It exempts nothing from
    the col_ rule or the LOD rule.

    Sets hide_render BOTH ways on purpose (render_flora.py's RN-306 bug, not
    inherited): a second shot in one invocation must be able to show what the
    first one hid."""
    kept, dropped = [], []
    for o in list(bpy.data.objects):
        if o.type != "MESH":
            continue
        n = o.name
        if n.startswith("col_") or _is_lodn(n):
            o.hide_render = True
            o.hide_viewport = True
            dropped.append(n)
            continue
        exempt = bool(always) and n.startswith(tuple(always))
        if only is not None and not n.startswith(only) and not exempt:
            o.hide_render = True
            dropped.append(n)
            continue
        o.hide_render = False
        kept.append(n)
    print("[render_station] drawing %d node(s), hiding %d%s"
          % (len(kept), len(dropped),
             "" if only is None else " (--only %s)" % only))
    if not kept:
        # LOUD, because the failure this catches is a run of frames that are
        # correctly exposed pictures of empty space.
        print("[render_station] NOTHING IS VISIBLE. Check --only against the "
              "node names above; every mesh in the file was hidden.")
    return kept


def apply_maps():
    """Wire the shipped surface maps, or strip them, or leave them alone.

    Imported inside the function so a caller who asks for no maps does not
    depend on assets/textures/dist/ existing at all. Called AFTER every import
    and before any shot, because surface_preview walks bpy.data.materials and a
    material that does not exist yet cannot be wired."""
    if _MAPS is None:
        print("[render_station] surface maps: UNTOUCHED, rendering the .glb's "
              "own materials")
        return
    import surface_preview
    rep = surface_preview.apply_all(off=not _MAPS,
                                    merged=bool(_MAPS and _MERGED))
    print("[render_station] surface maps %s: %d mapped, %d flat, %d skipped"
          % ("ON" if _MAPS else "OFF (stripped)", len(rep["mapped"]),
             len(rep["flat"]), len(rep["skipped"])))


def set_fill(eye, target, energy, size):
    """A soft light BEHIND THE EYE, created once and repositioned after.

    This is a cheat and the module docstring says so. The station's own
    emissive strips are the in-game answer to a dark interior; this exists only
    so a studio frame can show the FORM of a space the sun cannot reach, and
    `--nofill` removes it. It is added by `int` and `scale` and by nothing
    else, so the exterior lighting is untouched and an exterior pair taken a
    week apart is still comparable.

    THE TRAP: 0.9 m behind the eye is inside the aft bulkhead if the eye is
    standing near the end of a run, and a light inside a wall lights nothing.
    That returns a frame as black as one with no fill at all, which reads as a
    dead light rather than as a misplaced one. If an interior frame comes back
    black, check this position against the geometry before touching the
    energy."""
    lamp = bpy.data.objects.get("Fill")
    if lamp is None:
        lamp = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill",
                                                                "AREA"))
        bpy.context.scene.collection.objects.link(lamp)
    d = [eye[k] - target[k] for k in range(3)]
    n = math.sqrt(sum(c * c for c in d)) or 1.0
    lamp.data.energy = energy
    lamp.data.size = size
    lamp.location = (eye[0] + d[0] / n * 0.9,
                     eye[1] + d[1] / n * 0.9,
                     eye[2] + d[2] / n * 0.9 + 0.5)
    look_at(lamp, target)
    print("[render_station] fill %.0f W, %.1f m, at (%.2f, %.2f, %.2f) "
          "[STUDIO CHEAT: the asset's own light strips are the real answer]"
          % (energy, size, lamp.location[0], lamp.location[1],
             lamp.location[2]))


def drop_fill():
    lamp = bpy.data.objects.get("Fill")
    if lamp is not None:
        bpy.data.objects.remove(lamp, do_unlink=True)


def play(arm, clip, frame):
    """Assign ONE imported action and evaluate it at `frame`.

    The glTF importer pushes every clip into its own NLA track. Left in place
    they all evaluate at once and the result is a blend of every clip, which
    looks like a plausible pose and is not one."""
    if arm is None:
        return
    if arm.animation_data is None:
        arm.animation_data_create()
    for tr in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(tr)
    act = bpy.data.actions.get(clip)
    if act is None:
        cands = [a for a in bpy.data.actions if a.name.startswith(clip)]
        act = cands[0] if cands else None
    if act is None:
        # LOUD, because the failure this catches is a scale shot in which the
        # human reference stands in a 1.80 m T-pose, reads as a wider
        # silhouette than the character, and nothing says so.
        print("[render_station] NO ACTION NAMED %r, THIS FRAME IS THE REST "
              "POSE" % clip)
        return
    arm.animation_data.action = act
    # Blender 4.4 moved actions behind slots and the attribute does not exist
    # on older builds, so this is asked for rather than assumed
    # (render_player.py does the same).
    if hasattr(act, "slots") and len(act.slots):
        try:
            arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
    bpy.context.scene.frame_set(int(frame))


def shoot(cam, pos, target, fov_v, name):
    """Render one frame from an ARBITRARY world eye point to a world target.

    render_launch_pad.py's model, and the reason it is the right one here: the
    interesting eye points in this asset are not on an orbit around a bounding
    box, they are standing on a deck 14 m inside it. An orbit rig cannot
    express them and a bounding-box solver would put every one of them outside
    the hull.

    A CAMERA INSIDE A BOX RENDERS ITS INSIDE. That is a bug in `ext` and it is
    the entire point of `int`, so the black-frame signature has to be read the
    other way round here: an interior frame that comes back black usually means
    the eye is in the thickness of a bulkhead, not that the light failed."""
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = _RES
    scn.cycles.samples = _SAMPLES
    cam.data.lens = lens_for(fov_v)
    cam.location = pos
    look_at(cam, target)
    full = os.path.join(ROOT, "%s/%s.png" % (OUT, name))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    scn.render.filepath = full
    d = math.sqrt(sum((pos[k] - target[k]) ** 2 for k in range(3)))
    # The resolved path is printed BEFORE the render as well as after, so a run
    # that dies in Cycles still says where it was aiming.
    print("[render_station] shooting %s" % full)
    print("[render_station]   eye (%.2f, %.2f, %.2f) -> (%.2f, %.2f, %.2f), "
          "range %.2f m" % (pos[0], pos[1], pos[2], target[0], target[1],
                            target[2], d))
    print("[render_station]   fov_v %.1f deg -> lens %.2f mm at %dx%d, "
          "%d samples, frame %.2f m tall at the target"
          % (fov_v, cam.data.lens, _RES[0], _RES[1], _SAMPLES,
             2.0 * d * math.tan(math.radians(fov_v) * 0.5)))
    bpy.ops.render.render(write_still=True)
    print("[render_station] wrote %s" % full)


# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------

def mode_ext(argv, glb):
    """The whole station from outside, in vacuum. NO ground plane.

    Ground is off unless `--ground` is given, and that is the subject rather
    than a default: a floor under an orbital wreck is a false statement about
    where it is, and it bounces light up into the undersides and torn edges
    that are the only places the damage lives."""
    prefix = argv[0]
    views = argv[1:] or ["x34", "xside", "xtop", "xaft", "xbow", "xbreach"]
    cam = boot()
    drop_fill()
    import_asset(glb)
    visible_nodes(_ONLY)
    apply_maps()
    for view in views:
        if view not in VIEWS:
            print("[render_station] unknown view %r, known: %s"
                  % (view, ", ".join(sorted(VIEWS))))
            continue
        pos, tgt, fov = VIEWS[view]
        shoot(cam, pos, tgt, fov, "%s_%s" % (prefix, view))


def mode_int(argv, glb):
    """Standing inside, at EYE_Z, at the client's own field of view.

    If a frame comes back as a black skin over everything, the exterior hull is
    between the eye and the interior: re-run with `--only StationInt_LOD0`. If
    a frame comes back black at the EDGES only, the eye is too close to a wall
    and the answer is the corridor, not the camera."""
    prefix = argv[0]
    shots = argv[1:] or ["spine_fwd", "spine_aft", "hub", "hatch"]
    cam = boot()
    import_asset(glb)
    visible_nodes(_ONLY)
    apply_maps()
    print("[render_station] interior at eye %.2f m, fov_v %.1f deg -> lens "
          "%.2f mm. Corridors are authored %.2f m wide with %.2f m of clear "
          "headroom; that is what these frames are read against."
          % (EYE_Z, CLIENT_FOV_V_DEG, lens_for(CLIENT_FOV_V_DEG),
             CORRIDOR_W, HEADROOM))
    for shot in shots:
        if shot not in INTERIOR:
            print("[render_station] unknown shot %r, known: %s"
                  % (shot, ", ".join(sorted(INTERIOR))))
            continue
        eye, tgt = INTERIOR[shot]
        if _FILL:
            energy, size = FILL.get(shot, FILL_DEFAULT)
            set_fill(eye, tgt, energy, size)
        else:
            drop_fill()
            print("[render_station] fill OFF (--nofill): this frame has only "
                  "the sun and the sky in it")
        shoot(cam, eye, tgt, CLIENT_FOV_V_DEG, "%s_%s" % (prefix, shot))


def mode_scale(argv, glb):
    """A 1.80 m person STANDING IN IT, twice: in the corridor and in the hub.

    "Big" is not a property of a mesh, it is a RATIO, and a render with nothing
    of known size in it cannot show one (render_launch_pad.py's note, and
    render_creatures.py's whole `scale` mode). A 60 m station photographed
    alone is 60 m or 6 m or 600 m depending on how coarse the greeble happens
    to be, and the interior is worse: a corridor with nobody in it is a
    corridor at whatever scale the viewer's eye assumes, which is usually the
    one the author intended rather than the one that was built.

    TWO FRAMES, because they fail differently. In the corridor the figure is
    39 per cent of the frame height and the walls are 1.25 m off each shoulder,
    which shows whether the space is TIGHT. In the hub the same figure is a
    seventh of the frame, which is the only way a large volume gets to read as
    large.

    The player is posed at Idle so the arms hang. A T-pose is 1.80 m of arm
    span and reads as a wider silhouette than the character, which in a 2.5 m
    corridor is the difference between "snug" and "cannot pass"."""
    prefix = argv[0]
    cam = boot()
    import_asset(glb)
    parm, _pm, proots = import_asset(PLAYER)
    # The human is exempt from --only, so `--only StationInt_LOD0` still has
    # somebody standing in the corridor.
    visible_nodes(_ONLY, always=("Player",))
    apply_maps()
    play(parm, "Idle", 0)

    # 1. The spine corridor. The figure stands on the deck at z = 0 at x = -8
    #    facing +X (the body faces -Y at yaw 0, so +90 turns it down the
    #    corridor), and the camera is 4 m behind it and 0.55 m above the eye.
    #    At 4 m and 60 degrees the frame is 4.6 m tall, so 1.80 m of person is
    #    39 per cent of it and the corridor runs on past both shoulders.
    # THE EYE IS BETWEEN TWO BULKHEADS AND THAT IS A CONSTRAINT, NOT A
    # COMPOSITION. The first version stood the camera at x = -20.4, which is
    # 0.4 m behind the closed bulkhead at x = -20.0, and the frame came back a
    # white slab: render_launch_pad.py's "a camera inside a box renders its
    # inside", found here by the picture rather than by arithmetic. The
    # compartment between the frames at -20.0 and -10.2 is 9.8 m long, so the
    # camera sits 1.6 m inside it and the figure 6.0 m ahead of that.
    place_root(proots, -14.0, 0.0, 90.0)
    eye = (-18.4, 0.0, EYE_Z + 0.62)
    tgt = (-8.6, 0.0, 1.45)
    if _FILL:
        set_fill(eye, tgt, *FILL_DEFAULT)
    shoot(cam, eye, tgt, CLIENT_FOV_V_DEG, "%s_scale" % prefix)

    # 2. The hub floor. Same figure, moved by its ROOT rather than copied: a
    #    skinned copy sharing one armature modifier evaluates in the armature's
    #    space and stands exactly where the original stands.
    # Same trap, same fix: the hall's inner wall is at r = 8.10, and an eye at
    # (-5.6, -6.4) is at r = 8.51, i.e. inside it.
    place_root(proots, 0.0, -2.6, 180.0)
    eye = (-4.4, -5.0, EYE_Z + 1.05)
    tgt = (1.2, -0.4, 2.80)
    if _FILL:
        set_fill(eye, tgt, *FILL["scale_hub"])
    shoot(cam, eye, tgt, CLIENT_FOV_V_DEG, "%s_scale_hub" % prefix)


MODES = {"ext": mode_ext, "int": mode_int, "scale": mode_scale}


def _take_value(argv, tok):
    """Remove `tok` and the token after it, returning that value.

    Hand-rolled rather than argparse, because none of the sibling rigs use
    argparse and a flag parser that pulls its tokens out WHEREVER THEY SIT is
    what lets the positional arguments keep the order and the meaning they
    have (render_check.py's rule)."""
    val = None
    while tok in argv:
        i = argv.index(tok)
        argv.pop(i)
        if i < len(argv):
            val = argv.pop(i)
    return val


def main():
    global _MAPS, _MERGED, _FILL, _GROUND, _ONLY, _RES, _SAMPLES
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for tok, val in (("--maps", True), ("--nomaps", False)):
        while tok in argv:
            argv.remove(tok)
            _MAPS = val
    while "--merged" in argv:
        argv.remove("--merged")
        _MERGED = True
    while "--nofill" in argv:
        argv.remove("--nofill")
        _FILL = False
    while "--ground" in argv:
        argv.remove("--ground")
        _GROUND = True
    _ONLY = _take_value(argv, "--only") or None
    res = _take_value(argv, "--res")
    if res:
        w, h = res.lower().split("x")
        _RES = (int(w), int(h))
    samples = _take_value(argv, "--samples")
    if samples:
        _SAMPLES = int(samples)

    # THE ASSET PATH IS POSITIONAL AND IS RECOGNISED BY ITS SUFFIX, wherever it
    # sits among the positional arguments. It cannot be argv[1] the way
    # render_machines.py has it, because argv[1] here is the output prefix and
    # everything after it is a variable-length list of view names; and it is
    # not a `--flag` because it is an input, not a setting. Pointing the rig at
    # a scratch build is the normal case while an asset is being authored, so
    # it has to be one token on the command line and not an edit to this file.
    glb = STATION
    for tok in list(argv):
        if tok.lower().endswith(".glb"):
            argv.remove(tok)
            glb = tok

    if len(argv) < 2 or argv[0] not in MODES:
        print(__doc__)
        return
    print("[render_station] mode %s, asset %s, %dx%d, %d samples"
          % (argv[0], glb, _RES[0], _RES[1], _SAMPLES))
    MODES[argv[0]](argv[1:], glb)


if __name__ == "__main__":
    main()
