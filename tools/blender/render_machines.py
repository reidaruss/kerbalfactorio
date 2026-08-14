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
deliberately plain and is IDENTICAL across a before/after pair.

RN-551 CHANGED WHAT THAT SENTENCE IS ALLOWED TO MEAN. Through RN-378 this rig
existed to compare two GEOMETRIES, look development owned every material value,
and the note above said so. The values freeze is lifted for the machine and
structure set, so this rig now has to be able to judge a SURFACE, and three
things it inherited make that impossible until they are fixed:

  1. IT RENDERED UNDER BLENDER'S VIEW TRANSFORM. Blender 5.0 defaults to AgX,
     which is far flatter and more desaturating than the shipped ACES at
     exposure 1.2 and contrast 1.45 (rendering.md section 2.1). RN-456 spent
     three renders of the creature pass tuning a map against AgX before
     anybody re-derived it, and the finding was written down precisely so the
     next lane would not pay for it again. `setup_view_transform` prints its
     transform, look and exposure on EVERY run, for the same reason.
  2. THE WORLD WAS A FLAT 0.20/0.23/0.27 GREY AT STRENGTH 1. That is a large
     share of the light in the frame and it arrives from every direction at
     once, which fills every crease a normal map spends its whole budget
     darkening. It is why a machine under this rig could only ever look like
     one material: an ambient that bright IS a matte look.
  3. THE FLOOR WAS 0.20 NEUTRAL GREY. Section 2.1 puts groundNear at luma 35
     to 55 in soil and litter at HSV saturation 0.25 to 0.35, and a machine
     bounces its floor. A neutral floor makes a painted machine read cooler
     than the game will ever draw it.

`--maps` / `--merged` wire the shipped surface families on through
surface_preview, which is the same consumer the client is written against, so a
before/after pair is ONE FLAG apart on ONE build under ONE light rather than
two commits apart.
"""

import io
import math
import os
import re
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

# Set from the command line in main(). Module level rather than threaded
# through every shot function, because a shot's job is framing and a flag that
# has to be passed through five signatures gets dropped from one of them.
_MAPS = False
_MERGED = False
# RN-1111. DEFAULT ON, and `--noclient` is the escape rather than `--client`
# being the opt-in. The honest picture is the one the game can draw, so it is
# what a run gives you without being asked; and every run prints which mode it
# is in, because RN-150's rule is that an unexercised default ships silently.
_CLIENT = True


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


def setup_view_transform(scn):
    """Get the studio render onto the SHIPPED response curve, not Blender's.

    THIS IS RN-456'S FINDING, PORTED RATHER THAN REDISCOVERED, and porting it
    is the whole reason it was written down. rendering.md section 2.1 is the
    calibrated target: ACES, exposure 1.2, contrast 1.45 on a slope-matched S,
    saturation 0.92, zero lift. Blender 5.0 defaults to AgX, which is a
    substantially flatter and more desaturating transform, applied to every
    pixel AFTER the material has done its work.

    Under AgX a painted steel plate reads as chalky grey-blue whatever its
    albedo is, which is a statement about the view transform and not about the
    paint. `Standard` plus +0.26 stops (2 ** 0.26 = 1.20) plus a high-contrast
    look is the closest the stock OCIO config gets. IT IS NOT ACES and this is
    not a claim that it is; what it buys is that the studio frame and the game
    frame are wrong in the same DIRECTION rather than opposite ones, so a
    material judged here is not re-judged from scratch in the browser."""
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
    print("[render_machines] view transform %r, look %r, exposure %+.2f stops"
          % (vs.view_transform, vs.look, vs.exposure))


def setup_world(w, h, samples):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.use_denoising = True
    set_res(w, h, samples)
    scn.render.film_transparent = False
    setup_view_transform(scn)
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    # A COOL, DIM sky rather than the old flat 0.20/0.23/0.27 at strength 1.
    # That ambient was roughly half the light in the frame and it arrived from
    # every direction at once, which fills every crease a normal map exists to
    # darken: under it a machine could not read as anything but matte, whatever
    # its ORM said. The game's ambient is sky-coloured and the sun does most of
    # the work, so this rig now does the same and the shadow side of a plate is
    # allowed to be dark. Same value the creature rig settled on.
    world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.048, 0.058, 0.076, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = world

    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 5.2
    # 2 degrees rather than 3. Painted steel's whole material claim is a
    # specular that MOVES across a panel, and a wide source smears that into a
    # broad sheen: the same mechanism that made three creature renders read as
    # matte leather no matter what the roughness map said.
    sun.data.angle = math.radians(2.0)
    sun.rotation_euler = (math.radians(52), 0.0, math.radians(38))
    bpy.context.scene.collection.objects.link(sun)

    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 50.0
    cam.data.clip_start = 0.02
    cam.data.clip_end = 900.0
    bpy.context.scene.collection.objects.link(cam)
    scn.camera = cam
    return cam


def add_ground(size=160.0):
    """A SUBSTRATE-coloured floor, not a neutral grey and not Blender's 0.8.

    Section 2.1 item 2 gives the shipped groundNear luma as 35 to 55 at the
    vegetated sites and item 3 says the terrain is soil and litter at HSV
    saturation 0.25 to 0.35. The old 0.20 neutral was the right call while this
    rig only compared two geometries; it is wrong now that it has to judge a
    painted surface, because a machine BOUNCES its floor and a neutral bounce
    makes warm paint read cool. The floor is part of the measurement."""
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata([(-size, -size, 0), (size, -size, 0),
                      (size, size, 0), (-size, size, 0)], [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new("Ground", mesh)
    mat = bpy.data.materials.new("Floor")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.052, 0.045, 0.033, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.95
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def collapse_role_materials():
    """RN-1101. Fold every `OF_<Role>.001` back onto `OF_<Role>`, and say how
    many. **This has to run before `apply_surfaces` or the line shot renders
    almost entirely unmapped, which is what it has been doing.**

    THE DEFECT. The line shot imports twelve .glb files into one scene.
    Blender's ID namespace is per-FILE, not per-import, so the second file's
    `OF_Steel` arrives as `OF_Steel.001`, the third as `OF_Steel.002`, and so
    on. `surface_preview.apply_all` resolves a role as `mat.name[3:]`, which
    for `OF_Steel.001` is the role `"Steel.001"`; that is not in the palette,
    so the material is SKIPPED. It printed the skip honestly ("44 material(s)
    not in the palette") and nobody read the list, because the same line also
    said "10 mapped" and ten is the number of roles there are.

    So the maps landed on whichever .glb was named FIRST on the command line
    and on nothing else. A `--maps` / `--nomaps` pair of the production line
    was one asset's surface against eleven assets' flat palette constants, in
    both halves.

    WHY COLLAPSING IS THE RIGHT FIX AND NOT STRIPPING THE SUFFIX IN
    `surface_preview`. The client draws this whole set through ONE
    `MeshStandardMaterial` (`MachineBatch.makeMaterial`), so twelve copies of
    `OF_Steel` is not a thing the game has; it is an artefact of importing
    twelve files. Collapsing makes the studio scene's material count equal the
    client's, which is the property this rig exists to preserve. Teaching the
    role parser to ignore a numeric suffix would instead make `OF_Steel.001` a
    legal name, and the next lane that genuinely wants two steels would get
    one silently.

    Returns (folded, canonical) counts."""
    canon, dups = {}, []
    for mat in bpy.data.materials:
        if not mat.name.startswith("OF_"):
            continue
        stem = mat.name.rsplit(".", 1)
        # `.001` and not `.Foo`: only a 3-digit numeric tail is Blender's
        # collision suffix. `OF_Steel.001` folds; a hypothetical
        # `OF_Steel.Rusty` is a different role and must NOT be swallowed.
        if len(stem) == 2 and len(stem[1]) == 3 and stem[1].isdigit():
            dups.append((stem[0], mat))
        else:
            canon.setdefault(mat.name, mat)
    folded = 0
    for base, mat in dups:
        target = canon.get(base)
        if target is None:
            # The base name is not in the file at all, so this .001 IS the
            # only copy. Rename rather than remap: dropping it would delete a
            # role from the scene, which is worse than the defect being fixed.
            mat.name = base
            canon[base] = mat
            continue
        mat.user_remap(target)
        bpy.data.materials.remove(mat)
        folded += 1
    print("[render_machines] collapsed %d duplicate OF_ material(s) onto %d "
          "canonical role(s)" % (folded, len(canon)))
    return folded, len(canon)


MACHINE_BATCH_TS = os.path.join(ROOT, "web", "src", "game", "MachineBatch.ts")


def client_machine_material():
    """RN-1111. The (roughness, metalness) the CLIENT actually draws every
    machine role at, READ OUT OF THE CLIENT'S OWN SOURCE.

    WHY THIS FUNCTION EXISTS AND WHY IT PARSES RATHER THAN HARDCODES. The
    numbers it returns are a client constant. Typed here they would be a copy
    that drifts silently the first time the client lane touches that line, and
    the whole point of the value is to make this render agree with the game.
    Read from the file, a divergence is either corrected automatically or
    raises. `check_shadow_lod` reads the client's cascade splits for the same
    reason.

    WHAT IT IS FOR, AND IT IS THE SECOND HALF OF RN-456. `apply_material`'s
    `force` argument is documented as "the studio's ?partmat=0", and
    `apply_all`'s no-force path is justified by "the merge now carries them
    (PartMaterial.ts), so the two agree by construction". **That justification
    is true of SpiderFlock and NodeBatch and FALSE of MachineBatch, which
    contains zero references to PartMaterial.** So a machine rendered with
    `--merged` and no force previews per-role roughness and metalness that the
    game throws away, which is RN-456's catalogued failure - a studio render
    showing something the game cannot draw - reappearing on a different asset
    class, in the rig that was built to prevent it.

    Returns (roughness, metalness, has_partmat). `has_partmat` is the flag
    that makes this instrument survive its own fix: the day MachineBatch bakes
    and injects the per-part channel the way NodeBatch does, forcing becomes
    the WRONG thing to do and this says so instead of quietly lying the other
    way."""
    if not os.path.exists(MACHINE_BATCH_TS):
        raise SystemExit("[render_machines] FAIL: cannot read the client's "
                         "machine material from %s" % MACHINE_BATCH_TS)
    src = io.open(MACHINE_BATCH_TS, encoding="utf-8").read()
    has_partmat = ("PartMaterial" in src) or ("partMat" in src)
    # RN-1566: WHOLE-LINE COMMENTS COME OUT BEFORE THE SEARCH, and the reason
    # is that this parser had already been defeated by one. RN-1478 added a
    # comment to `makeMaterial` saying "render_machines.py regex-reads them out
    # of the FIRST `new THREE.MeshStandardMaterial({...})` here", which is
    # true, correct, well meant - and is itself the first literal occurrence of
    # that text in the file. The non-greedy search matched the SENTENCE, found
    # no `roughness:` inside it, and every machine render in this repo failed
    # with "MachineBatch's material declares no roughness" while the constants
    # sat four lines below, unmoved and exactly as documented.
    #
    # The instrument was right to stop rather than guess; it was reading the
    # wrong thing. Stripping lines whose first non-space characters are `//`
    # leaves the parser looking only at code, which is what it always meant to
    # read. Line comments only: a `/* */` block or a `//` inside a string
    # would need a tokeniser, and neither exists in the region this reads.
    src = "\n".join("" if ln.lstrip().startswith("//") else ln
                    for ln in src.splitlines())
    m = re.search(r"new\s+THREE\.MeshStandardMaterial\(\{(.*?)\}\)", src,
                  re.S)
    if m is None:
        raise SystemExit("[render_machines] FAIL: MachineBatch.ts no longer "
                         "constructs a MeshStandardMaterial the way this "
                         "parser expects. An instrument that guesses a client "
                         "constant is worse than one that stops.")
    block = m.group(1)
    got = {}
    for key in ("roughness", "metalness"):
        k = re.search(r"\b%s\s*:\s*([0-9.]+)" % key, block)
        if k is None:
            raise SystemExit("[render_machines] FAIL: MachineBatch's material "
                             "declares no %s. Cannot state what the game "
                             "draws, so this render will not claim to." % key)
        got[key] = float(k.group(1))
    return got["roughness"], got["metalness"], has_partmat


def apply_surfaces():
    """Wire the shipped surface families onto the imported OF_* materials.

    Called once, after every .glb is imported and before any shot, because
    `surface_preview` walks `bpy.data.materials` and a material that does not
    exist yet cannot be wired. `--merged` reproduces what the client's
    single-material batch can actually draw (of_lib.BARE_ROLES wear no family
    maps), for RN-456's instrument-honesty reason: a studio render showing
    something the game cannot draw flatters in the direction nobody
    double-checks.

    RN-1111: `--client` (the DEFAULT, and `--noclient` turns it off) is the
    other half of that same reason for machines specifically. See
    `client_machine_material`."""
    import surface_preview
    collapse_role_materials()
    force = None
    if _MAPS and _CLIENT:
        rough, metal, has_partmat = client_machine_material()
        if has_partmat:
            print("[render_machines] --client: MachineBatch.ts now references "
                  "PartMaterial, so per-role roughness and metalness DO reach "
                  "the game. Not forcing; the authored values are the truth.")
        else:
            force = (rough, metal)
            print("[render_machines] --client: MachineBatch.ts draws EVERY "
                  "machine role at roughness %.2f metalness %.2f and carries "
                  "no PartMaterial channel, so every per-role value in the "
                  ".glb is discarded. Forcing that pair onto every role, "
                  "which is what the game will show." % (rough, metal))
    else:
        print("[render_machines] --client is %s: per-role roughness and "
              "metalness are previewed AS AUTHORED, which for a machine is "
              "NOT what MachineBatch draws."
              % ("OFF (--noclient given)" if _MAPS else "moot (--nomaps)"))
    rep = surface_preview.apply_all(off=not _MAPS,
                                    merged=bool(_MAPS and _MERGED),
                                    force=force)
    # RN-1101's GATE, and it is the half that stops the defect coming back. An
    # `OF_` material that reaches here unexamined is a role rendering with no
    # surface while the report line above says the surfaces are on. There is
    # no legitimate case: every `OF_` name IS a palette role by construction.
    stray = sorted(m.name for m in bpy.data.materials
                   if m.name.startswith("OF_")
                   and m.name[3:] not in surface_preview.texgen_palette())
    if stray:
        raise SystemExit("[render_machines] FAIL: %d OF_ material(s) are not "
                         "palette roles and rendered unsurfaced: %s"
                         % (len(stray), ", ".join(stray)))
    return rep


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
        # RN-1102, the same exemption `line` needs and for the same reason:
        # the floor is scenery, not a subject. It is not appended to `out`
        # either, because callers frame the bounding box of what this returns
        # and a 320 m plane would frame the county.
        if n == "Ground":
            o.hide_render = False
            continue
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
        # RN-1102. THE GROUND IS EXEMPT FROM THE HIDE SWEEP, and it was not.
        # This loop hides every mesh so a shot shows only what it places, and
        # `_place_copy` unhides the COPIES it makes. The floor is never a copy,
        # so it was hidden here and never unhidden, and every line shot ever
        # taken rendered the factory floating in ambient with NO CONTACT
        # SHADOW AND NO BOUNCE. `add_ground`'s own docstring is the argument
        # against that ("a machine BOUNCES its floor and a neutral bounce makes
        # warm paint read cool"), so the rig was contradicting its own reason.
        # The `studio`/`face`/`det` shots go through `visible_objects`, which
        # has the same shape, so they lost the floor too.
        if o.type == "MESH" and o.name != "Ground":
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
    global _MAPS, _MERGED, _CLIENT
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    # Pulled out wherever they sit, so the three positional arguments keep the
    # meaning and the order they have always had (render_check.py's rule).
    for tok, val in (("--maps", True), ("--nomaps", False)):
        while tok in argv:
            argv.remove(tok)
            _MAPS = val
    while "--merged" in argv:
        argv.remove("--merged")
        _MERGED = True
    for tok, val in (("--client", True), ("--noclient", False)):
        while tok in argv:
            argv.remove(tok)
            _CLIENT = val
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
    apply_surfaces()
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
