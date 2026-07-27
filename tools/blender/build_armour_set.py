"""build_armour_set.py - the four wearable armour slots, as skinned meshes.

    blender --background --python tools/blender/build_armour_set.py

Produces assets/models/dist/player/armour_set.glb: four LOD0 meshes named
Armour_Head_LOD0, Armour_Chest_LOD0, Armour_Legs_LOD0, Armour_Feet_LOD0.

THE NODE NAMES ARE SLOT NAMES, NOT SET NAMES. A second armour set is a second
.glb carrying the SAME four node names, so the client's slot lookup is
set-independent and swapping a set is swapping a file. That is the whole reason
this file is armour_set.glb and not armour_tier1.glb.

SKINNED, NOT BONE-PARENTED. Each slot carries the SAME 44-bone armature as
player_body.glb - the same names, the same declaration order, the same T-pose
rest - read from rig_common.BODY_BONES rather than retyped. A leg plate has to
bend at the knee and a chest plate has to ride the spine; twenty rigid props
bone-parented to twenty bones cannot do either, and cost twenty draw calls to
fail at it. The client binds each slot to the skeleton it already has.

WEIGHTS come from of_lib.solve_weights, not from bone heat (DW-7). Bone heat
solves a Laplacian over a closed manifold; this armour, like the character
under it, is a pile of intersecting boxes and tubes. The per-part whitelist
(MeshBuilder.bind) is what makes distance weighting work: a left tasset
structurally cannot pick up weight from the right thigh.

CLEARANCE, NOT COINCIDENCE. Every plate is authored to stand 15 to 20 mm proud
of the body surface it covers, so a plate reads as a plate and so a small
change to the body underneath does not push it through. The body numbers below
are a SNAPSHOT of build_player_body.py taken 2026-07-27; the character is being
rebuilt in parallel. That is exactly why the clearance is generous and why the
real acceptance is render_armour.py, which dresses whatever player_body.glb is
on disk and drives both armatures with the same clip at the same frame.

SEGMENT COUNTS ARE A CONTRACT (check_mating.py's coaxial pass). Two coaxial
round surfaces with different segment counts do not share a surface at the same
radius: the larger one's flat faces sit inside the smaller one's vertices and
the joint renders as a sawtooth ring. So the helm shell over a 10-segment
helmet is 10 segments, the greave over a 10-segment shin is 10 segments, its
band is 10 segments, and the pauldron over an 8-segment shoulder pad is 8.

NO COLLISION PROXY: the player capsule is generated in code (ASSET-SPECS 2.5),
and armour does not change it.

LOD0 ONLY, deliberately: web/src/player/Avatar.ts loads the body with
lod: '_LOD0' and there is exactly one player, so three bands would triple the
skinning payload to make the same picture.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import rig_common as rc  # noqa: E402

NAME = "Armour"
OUT = of.dist_path("player", "armour_set.glb")

SIDES = (("Left", 1.0), ("Right", -1.0))

# Five roles, against a budget of six. Plate and SuitDark were added to the
# palette for this asset. EMIT is reserved for STATE, never decoration, so it
# appears exactly twice in the whole set and both are status chips.
PLATE, DARK, UNDER, HAZ, EMIT = ("Plate", "SteelDark", "SuitDark", "Hazard",
                                 "EmissiveState")


# ---------------------------------------------------------------------------
# 1. HEAD  Armour_Head_LOD0   bones: Head, Neck
#
# The body's helmet is a 10-segment tube (r 0.098 / 0.125 / 0.125 / 0.105 /
# 0.055 over z 1.530..1.800) with a 0.130 ring at z 1.552 and a Glass visor
# band whose OUTER radius is 0.136 over z 1.6225..1.6975.
#
# The visor is why this is not simply a bigger helmet. A full shell clearing
# the visor band would need circumradius 0.136 / cos(18 deg) = 0.143, whose
# flat faces land exactly ON the band; and the visor is the one part of the
# character a player reads as a face. So the head slot is an OPEN set of
# plates: a crown cap above the visor, cheek plates either side of it, a nape
# behind, a brow bar over it, and a crest that changes the outline.
# ---------------------------------------------------------------------------

def build_head(mb):
    mb.bind(["Head", "Neck"])

    # Crown cap. 10 segments, matching the helmet it covers.
    mb.add_raw(*rc.tube([(0, 0, 1.702), (0, 0, 1.752), (0, 0, 1.796),
                         (0, 0, 1.824)],
                        [0.143, 0.134, 0.106, 0.058], seg=10), role=PLATE)

    # The crest. This is the silhouette test made geometry: at 10 m the colour
    # of a helmet is invisible and a customisation system will override it
    # anyway, but a 46 mm fin on the skull is still a different outline.
    mb.add_raw(*rc.stack([((0.0, -0.010, 1.776), 0.028, 0.098),
                          ((0.0, 0.004, 1.816), 0.022, 0.086),
                          ((0.0, 0.014, 1.848), 0.012, 0.056)]), role=PLATE)

    # Brow bar, sitting on the cap directly above the visor band.
    mb.add_raw(*of.box_data((0.196, 0.042, 0.044), (0.0, -0.132, 1.716)),
               role=DARK)
    # Status chip on the brow: the one place a first-person player never sees
    # it and a second player always does.
    mb.add_raw(*of.box_data((0.030, 0.014, 0.018), (0.062, -0.157, 1.716)),
               role=EMIT)

    for _, s in SIDES:
        # Cheek plate: inner face buried 12 mm in the helmet barrel, outer face
        # 20 mm proud of it, and clear of the visor band's +/-0.107 in x.
        mb.add_raw(*of.box_data((0.032, 0.146, 0.116),
                                (s * 0.129, -0.028, 1.654)), role=PLATE)
        mb.add_raw(*of.box_data((0.020, 0.076, 0.030),
                                (s * 0.137, -0.030, 1.634)), role=DARK)

    # Nape. Its front face is inside the helmet ring, which is the point: the
    # ring is what it is bolted to, and nothing of the ring shows past it.
    #
    # HEAD ALONE, not Head and Neck. Its centroid sits at z 1.553, close enough
    # to the Neck segment that the distance solver gave it a 55/45 split, and
    # the pickaxe swing render showed the result: the plate half-followed the
    # neck while the helmet it is bolted to followed the head, and it lifted
    # off the helmet as a floating slab. A nape guard is part of the helmet, so
    # it is rigid to the helmet's bone. Tightening a whitelist is always
    # available and is always cheaper than tuning a falloff.
    mb.bind(["Head"])
    mb.add_raw(*of.box_data((0.190, 0.046, 0.130), (0.0, 0.140, 1.553)),
               role=PLATE)
    mb.add_raw(*of.box_data((0.140, 0.020, 0.040), (0.0, 0.150, 1.606)),
               role=DARK)
    return mb


# ---------------------------------------------------------------------------
# 2. CHEST  Armour_Chest_LOD0
#     cuirass  Spine, Spine1, Spine2      pauldrons  <side>Shoulder, <side>Arm
#
# The body's torso is a rect stack (half-extents 0.160/0.108 at z 1.060 up to
# 0.205/0.115 at z 1.450), with a chest pack whose FRONT FACE is y = -0.200 and
# a back plate whose BACK FACE is y = +0.170. The pack is the constraint: a
# cuirass that merely follows the ribs would be buried in it over the whole
# chest, so the front of the shell is a slab standing 18 to 22 mm ahead of the
# pack rather than a surface following the torso.
#
# The pauldrons are what make the 0.60 m width and the 0.54 m height, and both
# are silhouette, not decoration: they widen the shoulders and they are the top
# of the piece. The shell itself stops at z 1.500, below the helmet ring, so
# the chest and the head slots never fight over the same 30 mm of neck.
# ---------------------------------------------------------------------------

def build_chest(mb):
    # The cuirass rides the spine, and HIPS is in the whitelist for the waist
    # lip alone. Without it the bottom ring is rigid to Spine while the belt
    # below it is rigid to Hips, and a 26 degree crouch swings the belt 57 mm
    # forward of the cuirass: the waist opens and the bare torso shows through
    # the seam. Two surfaces that must stay adjacent have to SHARE the bones
    # they straddle, which is why the belt carries Spine for the same reason.
    # Neck is deliberately absent: the gorget's top ring is at z 1.500 and a
    # neck influence there drags the collar with every head turn, which reads
    # as the armour breathing.
    mb.bind(["Hips", "Spine", "Spine1", "Spine2"])
    mb.add_raw(*rc.stack([((0.0, -0.004, 1.061), 0.206, 0.150),
                          ((0.0, -0.014, 1.150), 0.211, 0.168),
                          ((0.0, -0.016, 1.250), 0.214, 0.200),
                          ((0.0, -0.017, 1.340), 0.220, 0.201),
                          ((0.0, -0.024, 1.430), 0.226, 0.190),
                          ((0.0, -0.014, 1.500), 0.180, 0.140)]), role=PLATE)

    # Central ridge, 17 mm proud of the breastplate slab.
    mb.add_raw(*of.box_data((0.076, 0.026, 0.270), (0.0, -0.222, 1.300)),
               role=PLATE)
    # Status chip, on the ridge where the shell is deepest.
    mb.add_raw(*of.box_data((0.048, 0.016, 0.024), (0.0, -0.243, 1.408)),
               role=EMIT)

    # Two hazard stripes flanking the ridge, straddling the breastplate face.
    # Colour alone is invisible at 10 m; these are for the 3 m read, where a
    # player is looking at another player rather than at a silhouette.
    for _, s in SIDES:
        mb.add_raw(*of.box_data((0.052, 0.020, 0.150),
                                (s * 0.150, -0.219, 1.330)), role=HAZ)
        mb.add_raw(*of.box_data((0.034, 0.022, 0.140),
                                (s * 0.078, -0.221, 1.230)), role=DARK)

    # Lumbar plate on the back, inside the shell's own depth envelope.
    mb.add_raw(*of.box_data((0.220, 0.016, 0.050), (0.0, 0.174, 1.180)),
               role=DARK)

    # Pauldrons. EIGHT segments, matching the body's 8-segment shoulder pad:
    # a 10-gon over an 8-gon at these radii is the sawtooth ring check_mating
    # already caught once on this character.
    # A SuitDark shoulder gusset was built here and then removed. It filled the
    # armpit at rest and protruded past the pauldron's lower rim as a stray
    # wedge the moment the arm swung, because it straddled a joint whose two
    # halves rotate 70 degrees apart. A gap that only exists at rest was not
    # worth a part that is wrong in motion.
    for pre, s in SIDES:
        mb.bind([pre + "Shoulder", pre + "Arm"])
        mb.add_raw(*rc.tube([(s * 0.120, 0, 1.428), (s * 0.188, 0, 1.470),
                             (s * 0.278, 0, 1.448)],
                            [0.120, 0.132, 0.104], seg=8), role=PLATE)
    return mb


# ---------------------------------------------------------------------------
# 3. LEGS  Armour_Legs_LOD0
#     belt      Hips                        tassets  Hips, <side>UpLeg
#     thigh/knee <side>UpLeg, <side>Leg     greave   <side>Leg, <side>Foot
#
# The body's leg is a 10-segment tube at x +/-0.10 from z 0.950 down to 0.130
# (r 0.105 / 0.092 / 0.078 / 0.070 / 0.060) with a knee box whose front face is
# y = -0.0945, over a boot whose top ring is at z 0.175.
#
# THE TASSETS ARE OUTBOARD ON PURPOSE. A hip plate that overlapped the pelvis
# in x would have the pelvis (half-extent 0.175, half-depth 0.120) poking
# through its own front and back faces, because a 66 mm slab is not as deep as
# the hip it is strapped to. Starting them at x 0.176 puts them entirely
# outside the pelvis and buried only in the thigh tube, which is what a tasset
# actually is.
# ---------------------------------------------------------------------------

def build_legs(mb):
    # Belt. Spine is in the whitelist with Hips because the cuirass's waist lip
    # overlaps this band and carries the same pair: the seam only stays shut in
    # a crouch if both sides of it blend the same two bones. See build_chest.
    mb.bind(["Hips", "Spine"])
    mb.add_raw(*rc.stack([((0.0, 0.0, 1.020), 0.184, 0.126),
                          ((0.0, 0.0, 1.082), 0.186, 0.128),
                          ((0.0, 0.0, 1.138), 0.187, 0.127)]), role=DARK)
    # Fauld. The dressed render showed a 150 mm band of bare white suit across
    # the front of the hips, between the cuirass rim and the cuisses, and it
    # was the first thing the eye went to. This closes the top 97 mm of it.
    # It stops at z 0.925 for a reason that is not cosmetic: the hip joint is
    # at 0.920, so a plate that ends here is never swept by a thigh, while one
    # reaching 50 mm lower is inside the thigh's own front surface at the 36
    # degree forward swing of Run. The remaining band is deliberate - a harness
    # articulates at the hip and something has to give there.
    mb.add_raw(*of.box_data((0.300, 0.043, 0.097), (0.0, -0.1165, 0.9735)),
               role=PLATE)

    for pre, s in SIDES:
        mb.bind(["Hips", pre + "UpLeg"])
        mb.add_raw(*rc.stack([((s * 0.212, -0.006, 1.030), 0.036, 0.086),
                              ((s * 0.220, -0.004, 0.950), 0.030, 0.090),
                              ((s * 0.214, -0.002, 0.868), 0.024, 0.074)]),
                   role=PLATE)

        mb.bind([pre + "UpLeg", pre + "Leg"])
        # Thigh plate, 26 mm proud of the front of the thigh tube. Its top edge
        # reaches 0.872 so it meets the tasset rather than leaving a 33 mm band
        # of bare suit between them at the hip.
        #
        # It is 110 mm DEEP and half buried, not a 58 mm slab standing off the
        # leg. The first version was the slab, and the run render showed why
        # that is wrong: a thin plate over a round limb shows daylight along
        # both of its long edges as soon as the leg swings, and reads as a
        # rectangle floating in front of the thigh rather than as armour ON it.
        # Burying the back half costs nothing - those faces are never seen -
        # and the side faces then meet the limb instead of missing it.
        mb.add_raw(*of.box_data((0.150, 0.110, 0.312),
                                (s * 0.10, -0.058, 0.716)), role=PLATE)
        # Knee cop. THE THREE PIECES ROUND THE KNEE OVERLAP ON PURPOSE and the
        # overlaps are the whole design, because the knee is where this asset
        # is hardest and where the run render found it. A knee bends 64 degrees
        # in Run and the front of the knee is the OUTSIDE of that bend, so the
        # surface over it has to get longer; no single rigid plate can, and no
        # weighting can invent the material. What works is slack: the cuisse
        # reaches 50 mm below the joint, the cop is 150 mm tall spanning 75 mm
        # either side of it, and the greave's rim reaches 10 mm below the joint,
        # so at every bend angle one plate is still behind the next and the
        # seam slides instead of opening. The first version had a 124 mm cop
        # between plates that stopped short, and at Run frame 19 it read as a
        # cube floating in front of a bare white knee.
        mb.add_raw(*of.box_data((0.126, 0.120, 0.150),
                                (s * 0.10, -0.062, 0.512)), role=PLATE)
        mb.add_raw(*of.box_data((0.134, 0.126, 0.024),
                                (s * 0.10, -0.063, 0.470)), role=DARK)

        mb.bind([pre + "Leg", pre + "Foot"])
        # Greave. TEN segments over a 10-segment shin, flaring at the ankle so
        # its bottom rim sits cleanly OUTSIDE the sabaton's cuff rather than
        # inside it.
        mb.add_raw(*rc.tube([(s * 0.10, 0, 0.500), (s * 0.10, 0, 0.379),
                             (s * 0.10, 0, 0.258)],
                            [0.096, 0.100, 0.104], seg=10), role=PLATE)
        # Band: same axis, same centre, same segment count, larger radius, so
        # it nests vertex to vertex by construction.
        mb.add_raw(*of.cyl_data(0.106, 0.028, (s * 0.10, 0, 0.300), "Z", 10),
                   role=DARK)
    return mb


# ---------------------------------------------------------------------------
# 4. FEET  Armour_Feet_LOD0   bones: <side>Foot, <side>ToeBase
#
# The body's boot is a rect stack from z 0.020 to 0.175 over a sole box that
# spans y -0.220..0.060 at z 0.000..0.024. The sabaton swallows the sole whole
# rather than sitting on it, because a 24 mm sole and a 20 mm plate at the same
# z is a z-fight, and lengthens the toe by 32 mm, which is the outline change
# that makes an armoured foot legible from 10 m.
# ---------------------------------------------------------------------------

def build_feet(mb):
    for pre, s in SIDES:
        cx = s * 0.10
        mb.bind([pre + "Foot", pre + "ToeBase"])
        # Sole plate: deep enough in z to contain the body's own sole box.
        mb.add_raw(*of.box_data((0.200, 0.328, 0.032), (cx, -0.086, 0.016)),
                   role=DARK)
        mb.add_raw(*rc.stack([((cx, -0.086, 0.032), 0.098, 0.162),
                              ((cx, -0.086, 0.082), 0.100, 0.162),
                              ((cx, -0.066, 0.140), 0.094, 0.132),
                              ((cx, -0.044, 0.196), 0.084, 0.102),
                              ((cx, -0.014, 0.252), 0.078, 0.086)]),
                   role=PLATE)
        # Toe cap: the 32 mm of extra length, as a separate wedge so the shell
        # keeps its own taper.
        mb.add_raw(*of.box_data((0.170, 0.080, 0.052), (cx, -0.212, 0.056)),
                   role=PLATE)
        mb.add_raw(*of.box_data((0.150, 0.048, 0.062), (cx, 0.062, 0.052)),
                   role=DARK)
        mb.add_raw(*of.box_data((0.188, 0.170, 0.026), (cx, -0.040, 0.170)),
                   role=UNDER)
    return mb


SLOTS = [
    ("Armour_Head_LOD0", build_head),
    ("Armour_Chest_LOD0", build_chest),
    ("Armour_Legs_LOD0", build_legs),
    ("Armour_Feet_LOD0", build_feet),
]


# ---------------------------------------------------------------------------

def main():
    of.reset_scene()
    # The armature IS the asset root, exactly as on the body, and it is built
    # from rig_common.BODY_BONES rather than from a copy of it: the two rigs
    # cannot drift, because there is only one declaration.
    arm_obj = of.add_armature(NAME, rc.BODY_BONES)
    segs = of.bone_segments(rc.BODY_BONES)

    built, lo_all, hi_all = [], None, None
    nvert = 0
    wmin, wmax = 1e30, -1e30
    for node, fn in SLOTS:
        mb = fn(of.MeshBuilder())
        mb.bind(None)
        obj = mb.build(node, arm_obj)
        groups = of.solve_weights(mb.verts, mb.vert_bones, segs)
        sums = [0.0] * len(mb.verts)
        for bone, pairs in groups.items():
            for i, w in pairs:
                sums[i] += w
        wmin, wmax = min(wmin, min(sums)), max(wmax, max(sums))
        nvert += len(mb.verts)
        of.bind_skin(obj, arm_obj, groups)

        lo, hi = mb.bounds()
        # Blender (x, y, z) -> glTF (x, z, -y): the contract is in three.js
        # axes, so the numbers printed here are the numbers validate_glb.py
        # will measure, not the Blender ones.
        gl = [hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]]
        print("[armour] %-20s %4d tris  gltf dims [%.4f %.4f %.4f]  "
              "blender z %.3f..%.3f  bones=%d"
              % (node, mb.tri_count(), gl[0], gl[1], gl[2], lo[2], hi[2],
                 len(groups)))
        built.append((node, mb))
        lo_all = lo if lo_all is None else [min(a, b) for a, b in zip(lo_all, lo)]
        hi_all = hi if hi_all is None else [max(a, b) for a, b in zip(hi_all, hi)]

    print("[armour] scripted weights: %d verts, weight sum %.4f to %.4f"
          % (nvert, wmin, wmax))
    print("[armour] set bounds blender x %.3f..%.3f  y %.3f..%.3f  z %.3f..%.3f"
          % (lo_all[0], hi_all[0], lo_all[1], hi_all[1], lo_all[2], hi_all[2]))

    # Nothing but the rest pose may be baked into the joint nodes.
    if arm_obj.animation_data:
        arm_obj.animation_data.action = None
    bpy.context.scene.frame_set(1)

    of.report(NAME, built)
    print("[armour] bones: %d, clips: 0, sockets: 0, collision: none"
          % len(rc.BODY_BONES))
    of.export_glb(OUT)


import bpy  # noqa: E402

if __name__ == "__main__":
    main()
