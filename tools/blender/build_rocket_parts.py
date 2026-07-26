"""
build_rocket_parts.py - Tier 2, the 13 vessel parts.

    blender --background --python tools/blender/build_rocket_parts.py

Produces assets/models/dist/rocket/rocket_parts.glb.

ONE FILE, THIRTEEN PARTS, ONE GROUP NODE EACH:

    RocketParts
      CommandPod                      group Empty, sits on the file origin
        CommandPod_LOD0
        socket_stack_bottom / socket_stack_top / socket_hatch
        col_CommandPod
      TankSmall ... CargoBay          the same shape, eight stack parts
      LandingLeg
        LandingLeg_LOD0               the hull yoke: does NOT move
        leg_pivot                     Leg_Deploy drives this
          LandingLeg_Strut
          socket_leg_foot             rides the clip: it is the contact point
        socket_radial_mount
        col_LandingLeg
      SolarPanel                      same split: mount + solar_pivot + array

SOCKET NAMES ARE SCOPED TO THE PART, NOT TO THE FILE. Thirteen parts carry a
socket_stack_top between them, so the runtime rule is: clone the PART node
(root.getObjectByName('TankSmall')) and query sockets on the clone. Calling
getObjectByName('socket_stack_top') on the file root returns whichever part
happens to be first, which is a bug waiting to be written once. contracts.json
checks the sockets per part through `part_sockets`, which is the machine-
readable half of that rule.

Parts ship LOD0 ONLY, and that is a decision rather than an omission: a vessel
is either near you (you are flying it, or you are standing next to it building
it) or it is in the scaled far scene, where it is an impostor and not a mesh at
all. There is no middle band for a rocket part to be in. lander_landed.glb,
which IS a distant surface landmark, carries the full chain.

See rocket_common.py for the stack contract itself.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of        # noqa: E402
import rocket_common as rk  # noqa: E402

NAME = "RocketParts"
OUT = of.dist_path("rocket", "rocket_parts.glb")

# Socket facings. A socket's local -Y is its facing (ASSET-SPECS 2.6), so the
# rotation that aims -Y along an axis is what these three constants are.
UP = of.deg3(x=-90.0)        # -Y -> +Z : socket_stack_top, away from the part
DOWN = of.deg3(x=90.0)       # -Y -> -Z : socket_stack_bottom, socket_muzzle
OUTWARD = of.deg3(z=90.0)    # -Y -> +X : socket_radial_mount

_report = []
_bounds = []


def _mesh(pile, name, parent, offset=(0.0, 0.0, 0.0)):
    """Build one mesh and record its WORLD bounds, because contracts.json's
    parts[] check measures the world AABB of the node subtree and a mesh under
    an offset pivot is not where its own vertex list says it is."""
    mb = of.MeshBuilder()
    pile.into(mb, rk.ROLES)
    obj = mb.build(name, parent)
    _report.append((name, mb))
    lo, hi = mb.bounds()
    _note(name, [lo[k] + offset[k] for k in range(3)],
          [hi[k] + offset[k] for k in range(3)])
    return mb, obj


def _note(name, lo, hi):
    _bounds.append((name, [round(hi[k] - lo[k], 4) for k in range(3)],
                    [round(lo[k], 4) for k in range(3)]))
    return lo, hi


def stack_part(root, name, pile, height, top=True, bottom=True, collide=True):
    """A part that mates on the 1.25 m stack: origin on its bottom face."""
    grp = of.add_pivot(name, (0.0, 0.0, 0.0), root)
    _mesh(pile, name + "_LOD0", grp)
    if bottom:
        of.add_socket("socket_stack_bottom", (0.0, 0.0, 0.0), DOWN, grp,
                      {"of_role": "stack_bottom"})
    if top:
        of.add_socket("socket_stack_top", (0.0, 0.0, height), UP, grp,
                      {"of_role": "stack_top"})
    if collide:
        of.add_collision_box("col_" + name, (2 * rk.R, 2 * rk.R, height),
                             (0.0, 0.0, height * 0.5), grp, role="SteelDark")
    return grp


def radial_part(root, name, pile, collide=False, col_size=None, col_loc=None):
    """A part that clamps to the SIDE of a stack: origin on its mount plane,
    body extending +X."""
    grp = of.add_pivot(name, (0.0, 0.0, 0.0), root)
    _mesh(pile, name + "_LOD0", grp)
    of.add_socket("socket_radial_mount", (0.0, 0.0, 0.0), OUTWARD, grp,
                  {"of_role": "radial_mount"})
    if collide:
        of.add_collision_box("col_" + name, col_size, col_loc, grp,
                             role="SteelDark")
    return grp


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    # --- eight stack parts ------------------------------------------------
    pod = stack_part(root, "CommandPod", rk.command_pod(), rk.POD_H)
    of.add_socket("socket_hatch", (0.50, 0.0, 1.15), OUTWARD, pod,
                  {"of_role": "crew_hatch"})

    stack_part(root, "TankSmall", rk.fuel_tank(2.00, bands=1), 2.00)
    stack_part(root, "TankLarge", rk.fuel_tank(4.00, bands=2), 4.00)

    # An engine terminates a stack: it has a top face to bolt a tank onto and
    # no bottom face at all, so it carries no socket_stack_bottom.
    eng = stack_part(root, "EngineMain", rk.engine_main(), rk.ENGINE_H,
                     bottom=False)
    of.add_socket("socket_muzzle", (0.0, 0.0, 0.0), DOWN, eng,
                  {"of_role": "plume"})

    stack_part(root, "Decoupler", rk.decoupler(), rk.DECOUPLER_H)
    stack_part(root, "NoseCone", rk.nose_cone(), rk.NOSE_H, top=False)

    chute = stack_part(root, "Parachute", rk.parachute(), rk.CHUTE_H)
    of.add_socket("socket_chute", (0.0, 0.0, rk.CHUTE_H), UP, chute,
                  {"of_role": "canopy_spawn"})

    stack_part(root, "CargoBay", rk.cargo_bay(), rk.BAY_H)

    # --- five radial parts ------------------------------------------------
    vern = radial_part(root, "EngineVernier", rk.engine_vernier())
    of.add_socket("socket_muzzle", (0.22, 0.0, -0.30), DOWN, vern,
                  {"of_role": "plume"})

    radial_part(root, "Fin", rk.fin(), collide=True,
                col_size=(0.85, 0.09, 1.10), col_loc=(0.425, 0.0, 0.0))
    radial_part(root, "RcsBlock", rk.rcs_block())

    # --- landing leg: a fixed yoke plus one animated strut ----------------
    leg = of.add_pivot("LandingLeg", (0.0, 0.0, 0.0), root)
    mb_yoke, _ = _mesh(rk.landing_leg_bracket(), "LandingLeg_LOD0", leg)
    leg_pivot = of.add_pivot("leg_pivot", (0.0, 0.0, 0.0), leg)
    mb_strut, strut = _mesh(rk.landing_leg_strut(), "LandingLeg_Strut",
                            leg_pivot)
    lo_y, hi_y = mb_yoke.bounds()
    lo_s, hi_s = mb_strut.bounds()
    lo = [min(lo_y[k], lo_s[k]) for k in range(3)]
    hi = [max(hi_y[k], hi_s[k]) for k in range(3)]
    _note("LandingLeg", lo, hi)
    of.add_socket("socket_radial_mount", (0.0, 0.0, 0.0), OUTWARD, leg,
                  {"of_role": "radial_mount"})
    # The foot socket hangs under the pivot so it RIDES the deploy, which is
    # what makes it usable as the ground-contact point: physics reads its world
    # position every frame instead of owning a copy of the deploy kinematics.
    # Its own rotation is pre-composed the same way the pad geometry is, so
    # that once deployed its facing is straight down.
    of.add_socket("socket_leg_foot", rk.LEG_PAD_LOC,
                  of.deg3(x=90.0, y=-rk.LEG_DEPLOY_DEG), leg_pivot,
                  {"of_role": "ground_contact"})
    of.add_collision_box(
        "col_LandingLeg",
        tuple(hi[k] - lo[k] for k in range(3)),
        tuple((lo[k] + hi[k]) * 0.5 for k in range(3)), leg, role="SteelDark")

    # Leg_Deploy. Two channels of ONE object, so it stays one Action and
    # therefore one AnimationClip: the strut swings 125 degrees out and the
    # whole leg settles 30 mm as the shock takes the weight. Keyed in two
    # rotation steps because glTF stores rotation as a quaternion and a single
    # key pair past 180 degrees is ambiguous.
    of.add_clip_multi(leg_pivot, "Leg_Deploy", {
        "rotation_euler": [(1, of.deg3()),
                           (21, of.deg3(y=rk.LEG_DEPLOY_DEG * 0.5)),
                           (41, of.deg3(y=rk.LEG_DEPLOY_DEG))],
        "location": [(1, (0.0, 0.0, 0.0)), (21, (0.0, 0.0, 0.0)),
                     (41, (0.0, 0.0, -0.03))],
    })

    # --- solar panel: fixed mount plus one animated array -----------------
    # The array hinges on the OUTBOARD face of its mount, so solar_pivot sits
    # at x = SOLAR_HINGE_X and the clip's frame-1 location key is that same
    # value: the frame-1 identity rule is "the first key equals the node's own
    # TRS", not "the first key is zero".
    sol = of.add_pivot("SolarPanel", (0.0, 0.0, 0.0), root)
    mb_mount, _ = _mesh(rk.solar_mount(), "SolarPanel_LOD0", sol)
    hinge = (rk.SOLAR_HINGE_X, 0.0, 0.0)
    solar_pivot = of.add_pivot("solar_pivot", hinge, sol)
    mb_arr, _ = _mesh(rk.solar_array(), "SolarPanel_Array", solar_pivot,
                      offset=hinge)
    lo_m, hi_m = mb_mount.bounds()
    lo_a, hi_a = mb_arr.bounds()
    _note("SolarPanel",
          [min(lo_m[k], lo_a[k] + hinge[k]) for k in range(3)],
          [max(hi_m[k], hi_a[k] + hinge[k]) for k in range(3)])
    of.add_socket("socket_radial_mount", (0.0, 0.0, 0.0), OUTWARD, sol,
                  {"of_role": "radial_mount"})
    of.add_clip_multi(solar_pivot, "Solar_Deploy", {
        "rotation_euler": [(1, of.deg3()),
                           (31, of.deg3(y=rk.SOLAR_DEPLOY_DEG * 0.5)),
                           (61, of.deg3(y=rk.SOLAR_DEPLOY_DEG))],
        "location": [(1, hinge), (31, hinge),
                     (61, (hinge[0], 0.0, 0.06))],
    })

    of.report(NAME, _report)
    print("[rocket] measured part bounds (Blender x, y, z):")
    for name, dims, lo in _bounds:
        print("[rocket]   %-16s dims %s  min %s" % (name, dims, lo))
    print("[rocket]   leg foot after deploy: %s"
          % [round(v, 4) for v in rk.leg_foot_offset()])
    of.export_glb(OUT, export_force_sampling=False, dedupe_socket_names=True)


if __name__ == "__main__":
    main()
