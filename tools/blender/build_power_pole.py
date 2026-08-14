"""
build_power_pole.py - Power pole, TypeId 0x16 (of::gameplay::types::PowerPole).

    ~/.local/bin/blender501 --background --python tools/blender/build_power_pole.py

Produces assets/models/dist/machines/power_pole.glb.

Footprint 1 x 1 m, height 4.0 m. A slim four-leg lattice mast splayed from
0.35 m at the base to 0.14 m at the top, a crossarm with two insulator caps,
and a supply lamp at 0.6 m where a player standing next to it can read it
without looking up 4 metres.

TWO SPEC CORRECTIONS (docs/web/ASSET-SPECS.md 4.19), both forced by the
whole-metre footprint rule in 2.2:

  - The crossarm was 1.10 m with sockets at +/-0.55. That is 50 mm of overhang
    past the 1 m cell on each side, which is exactly the class of bug the
    validator exists to catch. Crossarm is now 1.00 m, tangent to the cell
    edge by construction, with sockets at +/-0.42 on the insulator caps.
  - A bare lattice mast has a mesh footprint of only ~0.41 m, so nothing in
    the file would have proved the pole occupies its cell. It now stands on a
    1.00 x 1.00 m foundation pad, which makes the occupied cell legible on the
    ground during placement and makes the AABB check meaningful.

Legs are splayed, and MeshBuilder emits axis-aligned boxes, so each leg is
three stacked segments marching inward. At 4 m and 0.06 m section the steps
are well under a pixel of silhouette error, and it costs 144 triangles against
a hand-rotated leg's need for a whole transform path.

--------------------------------------------------------------------------
RN-1598 AND RN-1599, THE SE FORM PASS
--------------------------------------------------------------------------
NO machine_form HERE EITHER, and this asset is the clearest case in the set.
That module's LAYER table is absolute metres: a `tray` stands 74 mm proud and
this pole's structural members are 80 mm SQUARE. A cable tray on a leg would
be very nearly a second leg, a `housing` would be three and a half legs, and a
`bolt` head at 44 mm is over half a member's width. The vocabulary is safe on a
4 m to 8 m machine because its heights are properties of the greeble TYPE, and
that is exactly what makes it wrong on a lattice. Hand-authored at this
asset's own section, and machine_form's own docstring records the exclusion.

WHAT A LATTICE POLE WAS MISSING, and every one of these is structure rather
than decoration:
  - IT WAS NOT ATTACHED TO ANYTHING. Four legs ended on a pad. Each foot now
    has a base plate and a hold-down bolt, which is how a mast that carries a
    wire span in wind stays where it was put.
  - THE CROSSARM WAS ONE BOX. A single arm carrying two conductors at 0.42 m
    of lever is a cantilever with nothing under it: there is a second, lower
    arm and two struts between them now, which is the commonest real answer
    and the one that reads at range.
  - THE INSULATORS WERE ONE CONE EACH. An insulator is a STACK of sheds and
    the sheds are the whole reason it looks like an insulator; each gets one,
    at 0.08 m, which is the radius that lands the outer face exactly on the
    cell edge and is where INSUL_R came from in the first place.
  - NOBODY COULD CLIMB IT. Four step bolts up the +X face are the cheapest
    scale statement in the file - a step is a size a player already knows -
    and they put a rung ladder's hard notches into a plain vertical.
  - THE SUPPLY LAMP WAS A BEZEL ON NOTHING. It is a service cabinet now, with
    a bolted lid, the lamp on its face, and a hazard placard beside it, because
    a 4 m mast carrying live conductors is the one object in a starter base
    that genuinely warrants one.
  - AND THE DROP LEAD. There was no visible path from the crossarm to the
    cabinet: the pole's conductors arrived and connected to nothing. The lead
    is this asset's `coarse` consumer and it is a cable, so it is authored as
    one - `Rubber` runs with `SteelLight` clamp bands at the two fixed ends.

WHERE THE WIRES THEMSELVES STILL COME FROM IS UNCHANGED: runtime catenary
THREE.Line geometry between the socket_wire_* nodes of connected poles, never
authored geometry. The drop lead is the pole's OWN service connection and stops
at its own cabinet.

THE BUDGET RAISE IS THE ARGUMENT THIS FILE HAS TO WIN, because a pole is
numerous by construction: a power grid is poles, and a base spreads them at a
wire span apart. RN-1599 tried to pay for it out of the SHADOW side and the
trade IS NOT AVAILABLE ON THIS ASSET. The attempt and its refutation are both
recorded here, because a negative result nobody writes down is one the next
lane pays for again:

    LOD1 is `_legs(mb, 1)`, ONE segment where LOD0 marches three, and it
    measured 179.31 mm - inside cascade 2's 210.94 mm texel and far outside
    cascade 1's 56.25 mm, so the marginal multiplier is 3.0x. Giving LOD1 the
    SAME three-segment march, plus the braces and the steps, took it to 376
    triangles and 170.90 mm: still c2, still 3.0x. The multiplier did not move
    and the tier two cascades draw got 180 triangles heavier, so the shipped
    cost per pole went UP, 2212 -> 2392.

    THE REASON IS THE ASSET'S SHAPE AND IT IS WORTH STATING. A machine's detail
    is CONCENTRATED - the box's step riser, the generator's crown - so one
    stand-in box catches it and RN-1556's twelve-triangle trick works. A
    lattice pole's detail is DISTRIBUTED over four metres: feet, three brace
    levels, four steps, two arms, two insulators, a cabinet and a lead, none of
    them near any other. Catching them all is not an LOD1, it is LOD0 again.
    Every one of those parts was measured against a proxy and the proxy always
    lost, which is why LOD1 is back at one segment and 196 triangles.

The raise is therefore paid for honestly on the geometry side alone, priced per
pole against the reference base in contracts.json, and the one thing RN-1599
did bank is the DROP LEAD's three-segment march: authored as a single straight
box it stood 302 mm clear of the mast at the top and took the whole tier past
cascade 2 to 270.64 mm, which would have cost this asset the one cascade it
still earns.

check_coplanar has NEVER listed this asset, so it is held at ZERO by its
absence, and the pass keeps it there: every part added above is either a solid
standing on another solid or a plate sized so it overhangs what it is bolted
to.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "PowerPole"
OUT = of.dist_path("machines", "power_pole.glb")

W = D = 1.00
H = 4.00
PAD_H = 0.08
LEG = 0.08
MAST_TOP = 3.75                 # crossarm height
SPLAY_BASE, SPLAY_TOP = 0.35, 0.14
SEGMENTS = 3
ARM_W = 1.00                    # tangent to the cell edge, never past it
INSUL_X = 0.42
INSUL_R = 0.08                  # 0.42 + 0.08 == 0.50 exactly
LAMP_Z = 0.60

# NOTHING IN THIS BLOCK MAY MOVE. `socket_status` is placed off `_splay(LAMP_Z)`
# and `socket_wire_a/b` off INSUL_X, so SPLAY_BASE, SPLAY_TOP, MAST_TOP, LAMP_Z
# and INSUL_X are all PUBLISHED INTERFACE by consequence: retuning any one of
# them silently moves a socket the placement and wire code binds to. The form
# pass below adds parts and changes none of these five numbers.

ARM_LOW = 3.54                  # the lower crossarm, under the cantilever
CAB_Z = LAMP_Z                  # the service cabinet is the lamp's own station


def _splay(z):
    t = min(1.0, max(0.0, z / MAST_TOP))
    return SPLAY_BASE + (SPLAY_TOP - SPLAY_BASE) * t


def _legs(mb, segments):
    seg_h = (MAST_TOP - PAD_H) / segments
    for i in range(segments):
        z = PAD_H + seg_h * (i + 0.5)
        r = _splay(z)
        for sx in (-1, 1):
            for sy in (-1, 1):
                mb.box((LEG, LEG, seg_h), (sx * r, sy * r, z), "Steel")


def _feet(mb):
    """A base plate and a hold-down bolt under each leg.

    The plate is 0.17 against the leg's 0.08, so the leg's four side faces are
    buried in it rather than landing on its own edges, and the bolt head stands
    on the plate rather than beside it. That ordering is what keeps this asset
    at the zero check_coplanar holds it at by absence."""
    r = _splay(PAD_H)
    for sx in (-1, 1):
        for sy in (-1, 1):
            # SUNK 10 mm INTO THE PAD. Flush with the pad top, the plate's
            # underside and the LEG's underside were both on z = 0.08, which
            # is 10 same-facing pairs on an asset check_coplanar holds at
            # zero by absence. A base plate is grouted in anyway.
            mb.box((0.17, 0.17, 0.035), (sx * r, sy * r, PAD_H + 0.0075),
                   "SteelDark")
            mb.box((0.05, 0.05, 0.045), (sx * r, sy * r, PAD_H + 0.0475),
                   "SteelLight")


def _braces(mb):
    """Cross bracing: one X-brace per level, cheaper than a perimeter ring and
    it is what actually reads as "lattice" in silhouette."""
    for z in (1.05, 2.05, 3.05):
        r = _splay(z)
        mb.box((2 * r, 0.05, 0.05), (0, 0, z), "SteelDark")
        mb.box((0.05, 2 * r, 0.05), (0, 0, z), "SteelDark")


def _steps(mb):
    """Four step bolts up the +X face, between the two +X legs.

    THE BEST TRIANGLES ON THIS ASSET AND THE REASON IS SCALE, which is
    machine_form's argument for its ladder made at one twentieth the size. A
    step is a distance a player's own body already knows, so four of them say
    this mast is 4 m tall far more loudly than the mast being 4 m tall does,
    and they put hard horizontal notches into an outline that is otherwise
    four parallel lines."""
    for z in (0.95, 1.65, 2.35, 3.05):
        r = _splay(z)
        mb.box((0.05, 2.0 * r - 0.04, 0.045), (r, 0, z), "SteelDark")


def _crossarm(mb, full):
    """Two arms and the struts between them: a braced cantilever, not a stick.

    The lower arm is shorter than the upper one on purpose. It carries no
    conductor, its job is to stop the upper arm rotating about the mast, and an
    arm that reached the same 1.00 m would be a second conductor arm with
    nothing on it - which is how a detail stops reading as structure."""
    mb.box((ARM_W, 0.10, 0.10), (0, 0, MAST_TOP), "Steel")
    mb.box((0.22, 0.22, 0.16), (0, 0, MAST_TOP + 0.05), "SteelDark")
    if not full:
        return
    mb.box((0.72, 0.09, 0.09), (0, 0, ARM_LOW), "Steel")
    for sx in (-1, 1):
        mb.box((0.07, 0.07, MAST_TOP - ARM_LOW), (sx * 0.30, 0,
                                                  (ARM_LOW + MAST_TOP) * 0.5),
               "SteelDark")


def _insulator(mb, sx, segments, sheds=True):
    """A pin, a shed and the cap. INSUL_R is 0.08 because 0.42 + 0.08 is
    exactly 0.50, so the widest part of this stack is tangent to the cell edge
    and the shed cannot be one millimetre wider than it is."""
    mb.frustum(0.075, 0.05, 0.22, (sx * INSUL_X, 0, 3.89), axis="Z",
               segments=segments, role="SteelDark")
    if sheds:
        mb.cylinder(INSUL_R, 0.032, (sx * INSUL_X, 0, 3.845), axis="Z",
                    segments=6, role="SteelDark")


def _cabinet(mb, full):
    """The supply cabinet on the -Y/+X leg, at the height a person reads it.

    Bezel then chip: emissive stays last, which is of_lib's ordering rule and
    the reason the lamp was authored this way in the first place."""
    lr = _splay(LAMP_Z)
    mb.box((0.20, 0.20, 0.30), (lr, -lr, CAB_Z), "SteelDark")
    if full:
        mb.box((0.15, 0.15, 0.03), (lr + 0.035, -lr - 0.035, CAB_Z + 0.10),
               "Steel")
        for s in (-1, 1):
            mb.box((0.035, 0.035, 0.03),
                   (lr + 0.035 + s * 0.045, -lr - 0.035 - s * 0.045,
                    CAB_Z + 0.115), "SteelLight")
        # the hazard placard beside the lamp, on the cabinet's own face
        mb.box((0.13, 0.13, 0.02), (lr + 0.036, -lr - 0.036, CAB_Z - 0.09),
               "Hazard")
    mb.box((0.11, 0.11, 0.12), (lr + 0.04, -lr - 0.04, LAMP_Z),
           "EmissiveState")


def _drop_lead(mb, full=True):
    """The service lead from the crossarm down to the cabinet: this asset's one
    `coarse` consumer.

    A CABLE AND NOT A CONDUIT, for `machine_form.hose`'s reason at RN-1552. A
    drop lead hangs, it is pulled taut by its own weight and by nothing else,
    and the only hard parts of it are the two clamp bands at the ends. It is
    also the only thing on this pole that says the conductors overhead have
    anywhere to GO: before it, a wire arrived at an insulator and stopped.

    IT MARCHES IN THREE SEGMENTS FOR THE LEGS' EXACT REASON, and RN-1599 found
    that out by measuring rather than by thinking about it. A lead is CLIPPED
    TO A LEG, so it has to follow the splay; authored as one straight box off
    the cabinet's radius it stood 302 mm clear of the mast at the top, and
    that one part took the whole tier to 270.64 mm, which is past cascade 2
    and would have cost this asset every cascade it has. Marching the same
    three steps puts every clamp band within 38 mm of LOD1's own leg.

    `full=False` emits ONLY the top jog, which is the LOD1 STAND-IN and is
    RN-1556's idiom exactly: the jog is the one piece that leaves the leg, so
    it is the one piece the cruder tier has to have. Twelve triangles."""
    if full:
        z0, z1, n = CAB_Z + 0.20, 3.60, 3
        seg = (z1 - z0) / n
        for i in range(n):
            z = z0 + seg * (i + 0.5)
            r = _splay(z) + 0.05
            mb.box((0.032, 0.032, seg), (r, -r, z), "Rubber")
        for z in (CAB_Z + 0.26, 3.50):
            r = _splay(z) + 0.05
            mb.box((0.05, 0.05, 0.028), (r, -r, z), "SteelLight")
    r = _splay(3.60) + 0.05
    mb.box((r - 0.09, 0.30, 0.036), (r * 0.5 + 0.045, -r + 0.13, 3.60),
           "Rubber" if full else "SteelDark")


def build_lod0(root):
    mb = of.MeshBuilder()
    mb.box((W, D, PAD_H), (0, 0, PAD_H * 0.5), "SteelDark")
    _feet(mb)
    _legs(mb, SEGMENTS)
    _braces(mb)
    _steps(mb)
    _crossarm(mb, True)
    for sx in (-1, 1):
        _insulator(mb, sx, 8)
    _drop_lead(mb)
    _cabinet(mb, True)
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    mb.box((W, D, PAD_H), (0, 0, PAD_H * 0.5), "SteelDark")
    # ONE SEGMENT, MEASURED AND KEPT. See the docstring: the three-segment
    # march plus braces and steps was built, measured at 170.90 mm against this
    # tier's 179.31, earned the same single cascade, and cost 180 triangles on
    # the tier two cascades draw. It was reverted.
    _legs(mb, 1)
    # The lower arm and its struts ARE here, and they are the one part of the
    # experiment that paid: they are 36 triangles and they are what stops the
    # crossarm assembly being the tier's outlier at 246 mm.
    _crossarm(mb, True)
    _drop_lead(mb, full=False)
    for sx in (-1, 1):
        _insulator(mb, sx, 6, sheds=False)
    _cabinet(mb, False)
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    mb = of.MeshBuilder()
    mb.box((W, D, PAD_H), (0, 0, PAD_H * 0.5), "SteelDark")
    mb.box((0.24, 0.24, MAST_TOP - PAD_H), (0, 0, (PAD_H + MAST_TOP) * 0.5),
           "Steel")
    mb.box((ARM_W, 0.10, 0.10), (0, 0, MAST_TOP), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)

    of.add_collision_box("col_" + NAME, (0.40, 0.40, H), (0, 0, H * 0.5), root)

    # Wires are runtime catenary THREE.Line geometry between the socket_wire_*
    # nodes of connected poles, never authored geometry.
    of.add_socket("socket_wire_a", (-INSUL_X, 0.0, 3.95), parent=root,
                  extras={"of_role": "wire"})
    of.add_socket("socket_wire_b", (INSUL_X, 0.0, 3.95), parent=root,
                  extras={"of_role": "wire"})
    lr = _splay(LAMP_Z)
    of.add_socket("socket_status", (lr + 0.06, -lr - 0.06, LAMP_Z),
                  parent=root, extras={"of_role": "state_light"})

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
