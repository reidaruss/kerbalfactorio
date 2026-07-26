"""
build_lander_landed.py - Tier 2, the landed lander.

    blender --background --python tools/blender/build_lander_landed.py

Produces assets/models/dist/rocket/lander_landed.glb.

The Cinder outpost beat (ObjectiveStep::OutpostComplete): the vessel that
carried the player off Forge, standing on its legs on another world. It is a
LANDMARK, not a part, so unlike rocket_parts.glb it carries the full LOD chain:
this is the thing a player navigates back to from 200 m away.

IT IS ASSEMBLED FROM THE SHIPPED PARTS, NOT MODELLED AGAIN. Every piece comes
out of rocket_common, transformed by hc.Parts.rotate/translate, so the landed
lander and the flyable vessel cannot drift apart. Specifically the legs and the
solar panels are the SAME geometry as rocket_parts.glb's, with their deploy
transform applied by hand instead of by an AnimationMixer, which is why
rocket_common exposes LEG_DEPLOY_DEG and leg_foot_offset() rather than hiding
them inside the clip.

    EngineMain  z 0.30 .. 1.90     bell 0.30 m clear of the ground
    TankSmall   z 1.90 .. 3.90     four legs hinged 0.30 up its side
    CommandPod  z 3.90 .. 6.40     hatch on +X, ladder down to the ground

The stack heights are what the LEGS allow: the foot lands 2.13 m below its
hinge, so the hinge has to be 2.20 m up, and everything else follows from
that. Getting this wrong is what proved the first landing leg too short.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402
import rocket_common as rk     # noqa: E402

NAME = "LanderLanded"
OUT = of.dist_path("rocket", "lander_landed.glb")

TANK_H = 2.00
SETTLE = -0.03                  # the Leg_Deploy shock settle, applied statically
PAD_HALF_T = 0.035              # half the foot pad thickness

FOOT = rk.leg_foot_offset()
HINGE_Z = -(FOOT[2] + SETTLE) + PAD_HALF_T   # feet land exactly on z = 0
TANK_Z0 = 1.90
ENGINE_Z0 = TANK_Z0 - rk.ENGINE_H
POD_Z0 = TANK_Z0 + TANK_H
TOP = POD_Z0 + rk.POD_H

LEG_AZ = (0.0, 90.0, 180.0, 270.0)
SOLAR_AZ = (45.0, 225.0)
SOLAR_Z = TANK_Z0 + 1.30
LADDER_X = 0.68

_report = []


def radial(pile, az, z):
    """Place a radial part on the hull at azimuth `az`, height `z`. This is
    the static form of the runtime rule in rocket_common: rotate about the
    stack axis, then push out to the hull radius."""
    a = math.radians(az)
    pile.rotate("Z", az)
    return pile.translate(rk.R * math.cos(a), rk.R * math.sin(a), z)


def deployed_leg():
    """The shipped leg with Leg_Deploy's final pose baked in."""
    p = rk.landing_leg_bracket()
    strut = rk.landing_leg_strut()
    strut.rotate("Y", rk.LEG_DEPLOY_DEG).translate(0.0, 0.0, SETTLE)
    return p.extend(strut)


def deployed_panel():
    """The shipped solar panel with Solar_Deploy's final pose baked in."""
    p = rk.solar_mount()
    arr = rk.solar_array()
    arr.rotate("Y", rk.SOLAR_DEPLOY_DEG).translate(rk.SOLAR_HINGE_X, 0.0, 0.06)
    return p.extend(arr)


def ladder():
    """Hatch to ground on +X. The one piece of this asset that is not a rocket
    part: a 6.4 m vessel with no way down reads as scenery rather than as the
    thing the player climbed out of."""
    p = hc.Parts()
    top, bot = POD_Z0 + 1.30, 0.10
    for sy in (-1.0, 1.0):
        rk.slab(p, (0.05, 0.05, top - bot), (LADDER_X, sy * 0.17,
                                             (top + bot) * 0.5), "Steel")
    n = 11
    for i in range(n):
        z = bot + (top - bot) * (i + 0.5) / n
        rk.slab(p, (0.04, 0.30, 0.04), (LADDER_X, 0.0, z), "SteelDark")
    rk.slab(p, (0.10, 0.44, 0.06), (LADDER_X - 0.04, 0.0, top), "Accent")
    return p


def build_lod0(root):
    p = hc.Parts()
    p.extend(rk.engine_main().translate(0.0, 0.0, ENGINE_Z0))
    p.extend(rk.fuel_tank(TANK_H, bands=1).translate(0.0, 0.0, TANK_Z0))
    p.extend(rk.command_pod().translate(0.0, 0.0, POD_Z0))
    for az in LEG_AZ:
        p.extend(radial(deployed_leg(), az, HINGE_Z))
    for az in SOLAR_AZ:
        p.extend(radial(deployed_panel(), az, SOLAR_Z))
    p.extend(ladder())
    mb = of.MeshBuilder()
    p.into(mb, rk.ROLES)
    _report.append((NAME + "_LOD0", mb))
    return mb, mb.build(NAME + "_LOD0", root)


def _simple_leg(thick):
    """A leg reduced to one strut box and a foot pad, in the deployed pose.
    Hand-built rather than decimated: a collapse decimator eats a 0.14 m strut
    whole and leaves the lander standing on nothing.

    The strut stops 60 mm short of the foot centre so that its far END-FACE
    CORNER cannot dip below the pad. Every LOD of this asset has to sit on
    exactly the same ground plane, or the LOD switch sinks the lander into the
    regolith by a couple of centimetres in front of the player."""
    p = hc.Parts()
    d = math.hypot(FOOT[0], FOOT[2]) - 0.06
    rk.slab(p, (thick, thick, d), (0.0, 0.0, d * 0.5), "Steel")
    p.rotate("Y", 180.0 - math.degrees(math.atan2(FOOT[0], -FOOT[2])))
    rk.disc(p, 0.22, 2.0 * PAD_HALF_T, (FOOT[0], 0.0, FOOT[2]), "SteelDark",
            seg=6)
    return p.translate(0.0, 0.0, SETTLE)


def build_lod1(root):
    p = hc.Parts()
    rk.tube(p, 0.55, ENGINE_Z0, ENGINE_Z0 + 0.95, "SteelDark", r_top=0.24,
            seg=12)
    rk.tube(p, rk.R, ENGINE_Z0 + 0.95, TANK_Z0, "SteelDark", seg=12)
    rk.tube(p, rk.R, TANK_Z0, POD_Z0, "SteelLight", seg=12)
    rk.tube(p, rk.R, POD_Z0, POD_Z0 + 1.77, "SteelLight", r_top=0.36, seg=12)
    rk.tube(p, 0.34, POD_Z0 + 1.77, TOP, "SteelDark", seg=8)
    for az in LEG_AZ:
        p.extend(radial(_simple_leg(0.16), az, HINGE_Z))
    for az in SOLAR_AZ:
        q = hc.Parts()
        rk.slab(q, (1.26, 0.56, 0.04), (0.17 + 0.63, 0.0, 0.0), "SuitAccent")
        p.extend(radial(q, az, SOLAR_Z))
    mb = of.MeshBuilder()
    p.into(mb, rk.ROLES)
    _report.append((NAME + "_LOD1", mb))
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    """At 80 m: a can, a cone and four sticks. The leg splay is the entire
    silhouette of a landed vessel, so it is the last thing to go."""
    p = hc.Parts()
    rk.tube(p, rk.R, TANK_Z0 - 0.60, POD_Z0, "SteelLight", seg=8)
    rk.tube(p, rk.R, POD_Z0, TOP, "SteelLight", r_top=0.30, seg=8)
    for az in LEG_AZ:
        p.extend(radial(_simple_leg(0.18), az, HINGE_Z))
    mb = of.MeshBuilder()
    p.into(mb, rk.ROLES)
    _report.append((NAME + "_LOD2", mb))
    return mb, mb.build(NAME + "_LOD2", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)

    # One proxy, and it is the CORE STACK only, not the leg span. The legs are
    # 0.14 m struts with 4 m of air between them: a convex box over the whole
    # 4.1 m span would be a wall the player cannot walk under, which is the
    # opposite of what a lander on legs should feel like. Same rule as the
    # Tier-1 dead tree, whose proxy is its trunk.
    of.add_collision_box("col_" + NAME, (1.30, 1.30, TOP - ENGINE_Z0),
                         (0.0, 0.0, (TOP + ENGINE_Z0) * 0.5), root,
                         role="SteelDark")

    of.add_socket("socket_hatch", (0.50, 0.0, POD_Z0 + 1.15),
                  of.deg3(z=90.0), root, {"of_role": "crew_hatch"})
    of.add_socket("socket_item_out", (LADDER_X + 0.35, 0.0, 0.10),
                  of.deg3(z=90.0), root, {"of_role": "item_out"})
    of.add_socket("socket_muzzle", (0.0, 0.0, ENGINE_Z0), of.deg3(x=90.0),
                  root, {"of_role": "plume"})

    of.report(NAME, _report)
    for label, mb in ((NAME + "_LOD0", mb0), (NAME + "_LOD1", mb1),
                      (NAME + "_LOD2", mb2)):
        lo, hi = mb.bounds()
        print("[lander] %-18s dims %s  min %s"
              % (label, [round(hi[k] - lo[k], 4) for k in range(3)],
                 [round(v, 4) for v in lo]))
    print("[lander] hinge z %.4f, leg mount %.4f above the tank base, "
          "bell clearance %.4f" % (HINGE_Z, HINGE_Z - TANK_Z0, ENGINE_Z0))
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
