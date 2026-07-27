"""
build_launch_pad.py - Tier 2, the launch pad: the place a rocket leaves from.

    blender --background --python tools/blender/build_launch_pad.py

Produces assets/models/dist/rocket/launch_pad.glb.

THE HERO ASSET OF THE DW-35 MATERIAL PASS, rebuilt at 24 x 24 m from the
8 x 8 m original on Reid's "make it big and make it look good" (he said big
twice). 24 m is 6 structural cells of the DW-32 4 m module and 9x the ground
area of the original; the tower more than doubles, 12 m to 28 m. It is the one
asset where the two halves of this game meet, so it has to read as
INFRASTRUCTURE from 200 m and as a place you can walk on from 2 m.

GRID-SNAPPED LIKE A MACHINE. A placed structure, so ASSET-SPECS 2.2 applies to
it exactly as it applies to a smelter: a whole-metre footprint, pivot at the
footprint centre, base on z = 0, nothing overhanging the cell. 24 is even, so
it snaps to a cell CORNER.

WHY THE DECK IS RAISED 2.00 m, which is the whole shape of the thing: it gives
the FLAME TRENCH somewhere to go. A pad flush with the ground has nowhere to
send the exhaust and reads as a car park. The trench is a 7.2 m channel running
the full 24 m of Y, open at BOTH ends, with a tent-ridge blast deflector under
the vehicle splitting the flow to +Y and -Y. Straddling it is a LAUNCH MOUNT:
a steel table flush with the deck, carrying the four hold-down clamps on the
1.90 m circle and a 3 x 3 m flame hole in the middle. That is the arrangement
every real pad uses, and it is the only one that puts solid ground under a
clamp at r = 1.90 while leaving a hole under the engine at r < 1.50.

FOUR MESHES PLUS A CLAMP, PLACED INDEPENDENTLY. `LaunchPad` is the apron,
deck, trench, mount and tower. `LaunchClamp` is a separate ground-pivoted part
sitting on the file origin, following the Tier-1 atlas convention (parts
overlap on the origin; the renderer clones one by name and writes a placement
matrix): the renderer puts FOUR of them on the circle socket_clamp marks, at
90 degree intervals, each rotated to face the stack axis. One clamp mesh, any
number of clamps.

    LaunchPad
      LaunchPad_LOD0/1/2        apron, deck, trench, deflector, mount, tower
      LaunchClamp_LOD0/2        clamp base and mast: does NOT move
      clamp_pivot               Clamp_Release drives this
        LaunchClamp_Arm
      col_LaunchPad / col_LaunchTrench / col_LaunchMount / col_LaunchTower
        / col_LaunchClamp
      socket_vessel / socket_clamp / socket_umbilical / socket_smoke
        / socket_status

THE COLLISION PROXIES ARE THE PIECES AROUND THE TRENCH, NOT A SLAB ACROSS IT.
One convex box cannot describe a 24 m slab with a hole down the middle and a
28 m mast on one side, and a single box spanning the trench would let a player
walk on air over a 1.70 m drop. So the deck is proxied as its two BANKS -
`col_LaunchPad` west of the trench and `col_LaunchTrench` east of it, the
second named for the trench because the trench is the only reason there are
two - plus `col_LaunchMount` for the launch table, which is the one surface
that legitimately spans the trench, and spans only 6.8 m of its 24 m length.
Five boxes, 60 triangles, exactly the contract's collision budget.

THE CLAMP FACES THE STACK ALONG ITS OWN -Y. of_lib's convention is that an
asset's forward is Blender -Y, so socket_clamp carries the rotation that maps
-Y onto "toward the axis" and the clamp is authored with its arm reaching
forward. Local +Y is therefore radially OUTBOARD, and the arithmetic that
matters is one line: a point at clamp-local y lands at radius 1.90 + y. The
grip pad's inner face is at local y = -0.65, i.e. r = 1.25, which is exactly
the DW-29a class L hull radius. It touches, by construction, not by tuning.

The vessel mates at socket_vessel, ON THE DECK TOP at 2.00 m, so the engine
bell fires straight into the flame hole. A vessel is placed by putting its
socket_stack_bottom on that point, which is the same stacking rule
rocket_parts.glb publishes.

MATERIAL FAMILIES (DW-35, texgen.ROLE_FAMILY). Everything POURED is `coarse`
and everything FABRICATED is `panel`, which is a real distinction and not a
colour choice: Rock and RockDark carry the deck, the trench floor, the stair
and the deflector's plinth because chipped granular relief at a 0.5 m tile is
what concrete looks like; Steel, SteelDark, Hazard and Accent carry the mount,
tower, rails, striping, plumbing and the deflector's own steel cladding
because plate seams, rivets and wear at a 1.0 m tile are what fabricated steel
looks like. EmissiveState is deliberately flat: any AO or roughness on a state
light is a lie about what the surface is doing.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "LaunchPad"
OUT = of.dist_path("rocket", "launch_pad.glb")

# --- the footprint and the two heights everything else hangs off ------------
W = 24.00                # whole-metre footprint, both axes
HALF = W * 0.5           # 12.00, the hard edge nothing may cross
H = 28.00                # tower crown; the declared height of the asset
DECK_Z = 2.00            # deck top: socket_vessel and socket_clamp live here
DECK_CAP = 0.45          # the poured cap; the mass below it is the plinth
CAP_Z = DECK_Z - DECK_CAP           # 1.55
INSET = 0.35             # cap setback from the plinth: a visible ledge

# --- the trench -------------------------------------------------------------
TR_HW = 3.60             # trench half-width; a 7.2 m channel through 24 m of Y
TR_FLOOR = 0.30          # trench floor slab top, so the trench is 1.70 m deep
DEFL_Z = 1.30            # blast deflector ridge, clear of the mount underside

# --- the launch mount straddling the trench ---------------------------------
MT_HW = TR_HW            # the table spans the trench exactly, wall to wall
MT_HY = 3.40             # ...and 6.80 m of its length
MT_UNDER = 1.45          # table underside
HOLE = 1.50              # half-width of the flame hole: 3.00 m square

# --- the clamps -------------------------------------------------------------
CLAMP_R = 1.90           # mounting circle, sized for the class L 2.50 m stack
HULL_R = 1.25            # DW-29a class L radius; the grip pad lands here
CLAMP_H = 2.40
CLAMP_X = 1.60           # tangential width
CLAMP_Y = 0.70           # radial depth
HINGE_Y = -0.25          # clamp-local; the arm swings from the inboard face
HINGE_Z = 2.18

# --- the tower --------------------------------------------------------------
TOWER = (-8.00, 0.00)    # centre, standing on the west bank of the trench
TL = 1.70                # leg offset from the tower centre
LEG = 0.32
TOWER_BASE = DECK_Z
BAYS = [TOWER_BASE + 2.60 * i for i in range(11)]      # 2.00 .. 28.00
ARM_Z = 13.60            # umbilical swing arm
UMB_X = -1.30            # arm tip: 0.05 m off a class L hull

# --- the stair notch in the north-east corner -------------------------------
STAIR_N = HALF - 0.08    # 11.92, the top of the run
STEPS = 8
TREAD = 0.34
RISER = DECK_Z / STEPS   # 0.25
STAIR_S = STAIR_N - STEPS * TREAD       # 9.20: where the east deck resumes
STAIR_X = 6.70
STAIR_W = 2.60

DOWN = of.deg3(x=90.0)
UP = of.deg3(x=-90.0)
INWARD = of.deg3(z=-90.0)     # -Y -> -X, a clamp on +X faces the stack axis
OUTWARD = of.deg3(z=90.0)     # -Y -> +X, an arm on -X faces the stack axis

_report = []


# ---------------------------------------------------------------------------
# One helper this file needs and of_lib does not have: a box tilted about a
# world axis. MeshBuilder.box yaws about Z only, which is all a machine ever
# needs; a lattice mast's diagonal braces and a stair's handrail are the two
# things in the game that lean, and a lattice with no diagonals reads as a
# ladder rather than as a tower.
# ---------------------------------------------------------------------------

def tilt_box(mb, size, loc, axis, deg, role="Steel"):
    """A box whose local +Z has been rotated `deg` about `axis`, then moved to
    `loc`. Rotation about X sends +Z to (0, -sin, cos); about Y to
    (sin, 0, cos)."""
    v, f, sm = of.box_data(size)
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    out = []
    for x, y, z in v:
        if axis == "X":
            p = (x, y * ca - z * sa, y * sa + z * ca)
        elif axis == "Y":
            p = (x * ca + z * sa, y, -x * sa + z * ca)
        else:
            p = (x * ca - y * sa, x * sa + y * ca, z)
        out.append((p[0] + loc[0], p[1] + loc[1], p[2] + loc[2]))
    return mb.add_raw(out, f, sm, role)


def strut(mb, p0, p1, section, axis, role="Steel"):
    """A tilted box spanning two points in the plane normal to `axis`.

    The length is SHORTENED by the section's own diagonal, and that is not
    cosmetic. A box tilted 45 degrees puts its end CORNERS half a section
    beyond its end FACE centre, so a brace drawn corner-to-corner of the top
    bay pushed the asset's bounding box to 28.0495 m against a contract that
    says 28.00 +/- 0.005. The overshoot is section * (|sin| + |cos|) / 2, so
    that is exactly what comes off each end."""
    d = [p1[k] - p0[k] for k in range(3)]
    length = math.sqrt(sum(c * c for c in d))
    mid = [(p0[k] + p1[k]) * 0.5 for k in range(3)]
    if axis == "Y":
        deg = math.degrees(math.atan2(d[0], d[2]))
    else:
        deg = math.degrees(math.atan2(-d[1], d[2]))
    a = math.radians(deg)
    trim = section * (abs(math.sin(a)) + abs(math.cos(a)))
    return tilt_box(mb, (section, section, max(0.1, length - trim)), mid,
                    axis, deg, role)


def rail_run(mb, a, b, z_deck, role="Steel", spacing=4.0, mid_rail=True):
    """A guard rail along the straight line a -> b on a deck at z_deck.

    Handrails are what sell a 24 m pad as 24 m: a 1.10 m rail is the one thing
    in the frame whose real size a player already knows. They are also the
    cheapest such cue per triangle, which is why they get this much of the
    budget. `mid_rail` is dropped where the run is not a fall hazard the
    player can reach - a tower balcony at 26 m, a walkway 14 m up - because
    the second rail costs as much as the first and reads at neither distance."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 0.2:
        return mb
    ctr = ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)
    horiz = abs(dx) >= abs(dy)
    for h in ((1.10, 0.58) if mid_rail else (1.10,)):
        size = ((length, 0.08, 0.08) if horiz else (0.08, length, 0.08))
        mb.box(size, (ctr[0], ctr[1], z_deck + h), role)
    n = max(2, int(round(length / spacing)) + 1)
    for i in range(n):
        t = i / (n - 1.0)
        mb.box((0.10, 0.10, 1.14), (a[0] + dx * t, a[1] + dy * t,
                                    z_deck + 0.57), role)
    return mb


# ---------------------------------------------------------------------------
# The ground: apron, deck banks, trench, deflector
# ---------------------------------------------------------------------------

def ground(mb, detail=True):
    """Two concrete banks with a 6 m channel between them.

    Built as a plinth plus a setback cap rather than as one 1.75 m slab: the
    0.20 m ledge is what gives a 9 x 24 m mass a horizon line, and without it
    the biggest surface in the asset is a single untextured-looking face no
    matter what the normal map does to it."""
    # Trench floor, which is also the only thing standing on z = 0 under the
    # channel, so the asset's base plane is the ground and not the deck.
    mb.box((2 * TR_HW, W, TR_FLOOR), (0.0, 0.0, TR_FLOOR * 0.5), "RockDark")

    # West bank: full 24 m of Y. East bank stops short of the stair notch.
    for sx, y0, y1 in ((-1.0, -HALF, HALF), (1.0, -HALF, STAIR_S)):
        cy, dy = (y0 + y1) * 0.5, y1 - y0
        mb.box((HALF - TR_HW, dy, CAP_Z),
               (sx * (HALF + TR_HW) * 0.5, cy, CAP_Z * 0.5), "RockDark")
        # The cap is inset on the OUTER and END faces only. Its trench face
        # stays flush at |x| = TR_HW so the mount can abut it exactly: two
        # coincident faces with opposite normals are invisible under backface
        # culling, where two coplanar faces with the SAME normal z-fight.
        cap_y0 = y0 + (INSET if y0 <= -HALF + 1e-9 else 0.0)
        cap_y1 = y1 - (INSET if y1 >= HALF - 1e-9 else 0.0)
        mb.box((HALF - INSET - TR_HW, cap_y1 - cap_y0, DECK_CAP),
               (sx * (HALF - INSET + TR_HW) * 0.5, (cap_y0 + cap_y1) * 0.5,
                CAP_Z + DECK_CAP * 0.5), "Rock")

    if detail:
        # Steel liner standing 0.22 m proud of each trench wall.
        for sx in (-1.0, 1.0):
            mb.box((0.22, W, 1.05), (sx * (TR_HW - 0.11), 0.0, 0.85),
                   "SteelDark")

    # Blast deflector: a tent ridge along X, splitting the exhaust to +-Y.
    # Written out as a prism because every primitive version of a wedge is a
    # box with two faces in the wrong place.
    #
    # STEEL, ON A CONCRETE PLINTH, and the first contact sheet is why. Built
    # in RockDark it was the same value as the trench floor it stands on and
    # the same value as the shadow it stands in, so the frame shot from the
    # trench mouth showed a flat floor and nothing else - the one part of the
    # asset that explains why the deck is raised was invisible in the one
    # picture taken to show it. A real deflector is steel-clad anyway, and
    # SteelDark is `panel`, so it now wears plate seams instead of gravel.
    # It also runs 9.20 m against the mount's 6.80, so it reaches out past
    # the table and into the light rather than hiding under it.
    mb.box((7.40, 9.80, 0.22), (0.0, 0.0, TR_FLOOR + 0.11), "RockDark")
    dz = TR_FLOOR + 0.22
    hx, hy = 3.50, 4.60
    v = [(-hx, -hy, dz), (hx, -hy, dz), (hx, hy, dz), (-hx, hy, dz),
         (-hx, 0.0, DEFL_Z), (hx, 0.0, DEFL_Z)]
    f = [(0, 3, 2, 1), (0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5)]
    mb.add_raw(v, f, [False] * len(f), "SteelDark")
    # A bright splitter cap along the ridge. Twelve triangles bought purely
    # for LEGIBILITY: the trench is 1.70 m deep and the table roofs most of
    # it, so the deflector is lit by bounce and nothing else, and a 9.6 degree
    # slope in bounce light is a slope nobody can see. One Steel edge catches
    # a highlight and the whole wedge resolves around it.
    mb.box((2 * hx - 0.40, 0.36, 0.20), (0.0, 0.0, DEFL_Z - 0.02), "Steel")
    return mb


def mount(mb, detail=True):
    """The launch table: a steel square annulus flush with the deck, spanning
    the trench wall to wall, with a 3 x 3 m flame hole in it.

    It is what puts deck under a clamp at r = 1.90 and a hole under an engine
    at r < 1.50, which no single slab and no single opening can do at once."""
    zc = (MT_UNDER + DECK_Z) * 0.5
    t = DECK_Z - MT_UNDER
    for sy in (-1.0, 1.0):
        mb.box((2 * MT_HW, MT_HY - HOLE, t),
               (0.0, sy * (MT_HY + HOLE) * 0.5, zc), "SteelDark")
    for sx in (-1.0, 1.0):
        mb.box((MT_HW - HOLE, 2 * HOLE, t),
               (sx * (MT_HW + HOLE) * 0.5, 0.0, zc), "SteelDark")
    if not detail:
        return mb
    # Hazard curb around the hole: the line that says where not to stand.
    for sy in (-1.0, 1.0):
        mb.box((2 * HOLE + 0.30, 0.15, 0.10), (0.0, sy * (HOLE + 0.075),
                                               DECK_Z), "Hazard")
    for sx in (-1.0, 1.0):
        mb.box((0.15, 2 * HOLE, 0.10), (sx * (HOLE + 0.075), 0.0, DECK_Z),
               "Hazard")
    # Girders under the table, visible from inside the trench.
    for sx in (-1.0, 1.0):
        mb.box((0.30, 2 * MT_HY, 0.34), (sx * (MT_HW - 0.20), 0.0,
                                         MT_UNDER - 0.17), "Steel")
    for sy in (-1.0, 1.0):
        mb.box((2 * MT_HW, 0.30, 0.34), (0.0, sy * (MT_HY - 0.20),
                                         MT_UNDER - 0.17), "Steel")
    return mb


# ---------------------------------------------------------------------------
# The tower
# ---------------------------------------------------------------------------

def tower(mb, detail=True):
    tx, ty = TOWER
    span = H - TOWER_BASE
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            mb.box((LEG, LEG, span), (tx + sx * TL, ty + sy * TL,
                                      TOWER_BASE + span * 0.5), "Steel")
    # Horizontal ties on a 2.60 m pitch, which is the leg spacing, so every
    # bay is square. A mast with no ties reads as four unrelated posts.
    levels = BAYS[1:-1] if detail else BAYS[2:-1:2]
    for z in levels:
        for sy in (-1.0, 1.0):
            mb.box((2 * TL, 0.16, 0.16), (tx, ty + sy * TL, z), "SteelDark")
        for sx in (-1.0, 1.0):
            mb.box((0.16, 2 * TL, 0.16), (tx + sx * TL, ty, z), "SteelDark")
    if detail:
        # Diagonal bracing on the two Y faces, zig-zagging bay to bay.
        for i in range(len(BAYS) - 1):
            z0, z1 = BAYS[i], BAYS[i + 1]
            for sy in (-1.0, 1.0):
                x0, x1 = tx - TL, tx + TL
                if (i + (sy > 0)) % 2:
                    x0, x1 = x1, x0
                strut(mb, (x0, ty + sy * TL, z0), (x1, ty + sy * TL, z1),
                      0.14, "Y", "SteelDark")
        # Lift shaft, and the door a player would use.
        mb.box((1.70, 1.70, 21.60), (tx, ty, TOWER_BASE + 11.30), "SteelDark")
        mb.box((1.10, 0.10, 2.10), (tx, ty - 0.88, TOWER_BASE + 1.05), "Steel")
        mb.box((1.14, 0.08, 0.16), (tx, ty - 0.92, TOWER_BASE + 2.18),
               "Accent")
        # Service platforms cantilevered toward the stack.
        for z in (BAYS[3], BAYS[7]):
            mb.box((3.20, 3.60, 0.18), (tx + 1.60, ty, z + 0.09), "Steel")
            rail_run(mb, (tx + 3.20, ty - 1.80), (tx + 3.20, ty + 1.80),
                     z + 0.18, "Steel", spacing=1.9, mid_rail=False)
            for sy in (-1.0, 1.0):
                mb.box((3.20, 0.08, 0.08), (tx + 1.60, ty + sy * 1.80,
                                            z + 1.28), "Steel")

    # Crown deck: the surface that sets the declared 28.00 m height, so it
    # carries NOTHING on top of it. A guard rail up there would be 1.10 m of
    # asset hanging over the number the contract checks; the rails live one
    # level down instead, where they cost nothing.
    mb.box((4.20, 4.20, 0.30), (tx, ty, H - 0.15), "Steel")
    if detail:
        mb.box((4.60, 4.60, 0.20), (tx, ty, H - 1.40), "Steel")
        for sy in (-1.0, 1.0):
            rail_run(mb, (tx - 2.30, ty + sy * 2.30), (tx + 2.30,
                                                       ty + sy * 2.30),
                     H - 1.30, "Steel", spacing=3.1, mid_rail=False)
        mb.box((0.36, 0.36, 0.30), (tx, ty, H - 0.45), "SteelDark")
    mb.box((0.26, 0.26, 0.22), (tx, ty, H - 0.45), "EmissiveState")
    return mb


def swing_arm(mb, detail=True):
    """The umbilical arm: the tower reaching out and touching the rocket.

    It is what makes the tower read as SERVICING the vehicle rather than
    standing next to it, so it runs all the way from the mast face to 0.05 m
    off a class L hull, and socket_umbilical is published at its tip."""
    tx, ty = TOWER
    x0 = tx + TL + 0.16                      # off the mast's inboard face
    boom_x1 = UMB_X - 0.44
    mb.box((boom_x1 - x0, 0.52, 0.46), ((x0 + boom_x1) * 0.5, ty, ARM_Z),
           "SteelDark")
    mb.box((0.44, 0.90, 0.80), (UMB_X - 0.22, ty, ARM_Z), "SteelDark")
    if not detail:
        return mb
    mb.box((boom_x1 - x0, 0.96, 0.10), ((x0 + boom_x1) * 0.5, ty,
                                        ARM_Z + 0.28), "Steel")
    for sy in (-1.0, 1.0):
        rail_run(mb, (x0, ty + sy * 0.48), (boom_x1, ty + sy * 0.48),
                 ARM_Z + 0.33, "Steel", spacing=2.5, mid_rail=False)
    mb.box((boom_x1 - x0 - 0.4, 0.24, 0.24), ((x0 + boom_x1) * 0.5, ty + 0.40,
                                              ARM_Z - 0.30), "Accent")
    for sy in (-1.0, 1.0):
        mb.box((0.30, 0.22, 0.22), (UMB_X - 0.15, ty + sy * 0.28, ARM_Z),
               "Accent")
    return mb


# ---------------------------------------------------------------------------
# Deck furniture: striping, guard rails, the stair, and the things that give
# the eye something of known size to measure the 24 m against.
# ---------------------------------------------------------------------------

def striping(mb):
    """Hazard paint, 10 mm proud of the deck so it never z-fights it.

    Two lines and they say two different things: the one along the trench lip
    is 'this is a hole', the one inside the outer edge is 'this is the edge'.
    Neither crosses the trench, because paint on a hole is a lie."""
    z = DECK_Z - 0.04
    for sx, y1 in ((-1.0, HALF - INSET), (1.0, STAIR_S)):
        y0 = -HALF + INSET
        cy, dy = (y0 + y1) * 0.5, y1 - y0
        mb.box((0.50, dy, 0.10), (sx * (TR_HW + 0.45), cy, z), "Hazard")
        mb.box((0.60, dy - 1.60, 0.10), (sx * (HALF - INSET - 0.50), cy, z),
               "Hazard")
    # End bands, one per BANK, so the trench mouth stays unpainted.
    for sx in (-1.0, 1.0):
        x0, x1 = sx * TR_HW, sx * (HALF - INSET)
        mb.box((abs(x1 - x0) - 1.60, 0.60, 0.10),
               ((x0 + x1) * 0.5, -(HALF - INSET - 0.50), z), "Hazard")
    mb.box((HALF - INSET - TR_HW - 1.60, 0.60, 0.10),
           (-(HALF - INSET + TR_HW) * 0.5, HALF - INSET - 0.50, z), "Hazard")
    return mb


def guard_rails(mb):
    """Rails along the two trench lips and the outer perimeter. The trench
    lips get posts at 3 m and the perimeter at 5 m: the drop you can actually
    fall down is the one worth spending triangles on."""
    for sx in (-1.0, 1.0):
        y1 = HALF - INSET if sx < 0 else STAIR_S
        rail_run(mb, (sx * (TR_HW + 0.12), -HALF + INSET),
                 (sx * (TR_HW + 0.12), y1), DECK_Z, "Steel", spacing=4.6)
    edge = HALF - INSET
    rail_run(mb, (-edge, -edge), (-edge, edge), DECK_Z, "Steel", spacing=8.0,
             mid_rail=False)
    rail_run(mb, (edge, -edge), (edge, STAIR_S), DECK_Z, "Steel", spacing=8.0,
             mid_rail=False)
    for sx in (-1.0, 1.0):
        rail_run(mb, (sx * edge, -edge), (sx * (TR_HW + 0.12), -edge), DECK_Z,
                 "Steel", spacing=8.0, mid_rail=False)
    rail_run(mb, (-edge, edge), (-TR_HW - 0.12, edge), DECK_Z, "Steel",
             spacing=8.0, mid_rail=False)
    return mb


def stair(mb, detail=True):
    """Eight steps from the ground to the deck in the north-east notch. The
    only route up that a player on foot can take, and the second scale cue
    after the rails: a 0.25 m riser is a riser at any distance."""
    for i in range(STEPS):
        top = RISER * (i + 1)
        y = STAIR_N - TREAD * (i + 0.5)
        mb.box((STAIR_W, TREAD, top), (STAIR_X, y, top * 0.5), "RockDark")
    if not detail:
        return mb
    run = STEPS * TREAD
    length = math.hypot(run, DECK_Z)
    deg = math.degrees(math.atan2(run, DECK_Z))
    for sx in (-1.0, 1.0):
        x = STAIR_X + sx * (STAIR_W * 0.5 + 0.10)
        tilt_box(mb, (0.09, 0.09, length),
                 (x, STAIR_N - run * 0.5, DECK_Z * 0.5 + 1.10), "X", deg,
                 "Steel")
        # Newel posts, from the tread they stand on up to the rail above it.
        # The rail at step i is at RISER * (i + 0.5) + 1.10, so the post is
        # 1.10 minus half a riser, wherever it is on the flight.
        plen = 1.10 - RISER * 0.5
        for i in (0, 3, 6):
            y = STAIR_N - TREAD * (i + 0.5)
            mb.box((0.09, 0.09, plen),
                   (x, y, RISER * (i + 1) + plen * 0.5), "Steel")
    return mb


def furniture(mb):
    """Floodlights, a propellant tank, a control bunker, a cable run. Every
    one of them is here to be a KNOWN SIZE next to an unknown one."""
    # THREE LIGHTNING MASTS, and they are the best triangles in the file.
    # The first contact sheet showed the whole thing reading flat from any
    # distance: a 2 m deck on a 24 m footprint is a 1:12 slab, so at 150 m
    # there was one vertical in frame and the pad had no silhouette at all.
    # Three more verticals around the vehicle is what a real pad does and it
    # is the same reason. They were paid for by dropping two of the four
    # floodlights and widening the rail post pitch.
    #
    # SHORTER AND FATTER THAN THE FIRST TRY, with a tapered tip. At a bare
    # 0.30 x 19 m they were 63:1 sticks that read as scaffolding poles, and
    # two of the three crossed the vehicle in the hero frame at full height.
    # 0.42 m of mast to 13 m with a 0.18 m tip is 31:1, stands 15.9 m against
    # the tower's 28, and reads as a mast rather than as a line.
    for x, y in ((-10.90, 10.90), (10.90, 7.60), (10.90, -10.60)):
        mb.box((0.80, 0.80, 0.50), (x, y, DECK_Z + 0.25), "SteelDark")
        mb.box((0.42, 0.42, 11.00), (x, y, DECK_Z + 6.00), "Steel")
        mb.box((0.18, 0.18, 2.60), (x, y, DECK_Z + 12.80), "Steel")
    # Floodlight masts, low and wide-throw, on the two remaining corners.
    for x, y in ((-11.00, -10.60), (11.00, -11.40)):
        mb.box((0.26, 0.26, 6.40), (x, y, DECK_Z + 3.20), "Steel")
        mb.box((1.10, 0.50, 0.52), (x, y, DECK_Z + 6.66), "SteelDark")
        mb.box((0.96, 0.14, 0.40), (x, y - 0.26, DECK_Z + 6.66),
               "EmissiveState")
    # Propellant tank on the east bank. Every ring is a 12-gon, so the
    # coaxial facet check has nothing to compare (see check_mating.coaxial).
    tx, ty = 8.60, 3.60
    mb.cylinder(1.50, 4.20, (tx, ty, DECK_Z + 2.10), segments=12, role="Steel")
    mb.cylinder(1.58, 0.36, (tx, ty, DECK_Z + 0.18), segments=12,
                role="SteelDark")
    mb.frustum(1.50, 0.42, 0.90, (tx, ty, DECK_Z + 4.65), segments=12,
               role="Steel")
    # Control bunker, with the standard four-colour state chip for a window.
    bx, by = 8.40, -8.00
    mb.box((4.00, 2.60, 1.70), (bx, by, DECK_Z + 0.85), "Rock")
    mb.box((4.30, 2.90, 0.20), (bx, by, DECK_Z + 1.80), "SteelDark")
    mb.box((4.05, 0.12, 0.14), (bx, by - 1.34, DECK_Z + 1.56), "Accent")
    mb.box((3.20, 0.10, 0.55), (bx, by - 1.33, DECK_Z + 1.10),
           "EmissiveState")
    # Cable run along the west bank, feeding the tower.
    mb.box((0.56, 15.00, 0.34), (-10.40, -1.00, DECK_Z + 0.17), "SteelDark")
    for sx in (-1.0, 1.0):
        mb.box((0.16, 15.00, 0.16), (-10.40 + sx * 0.16, -1.00,
                                     DECK_Z + 0.42), "Accent")
    return mb


# ---------------------------------------------------------------------------
# LOD chain
# ---------------------------------------------------------------------------

def build_lod0(root):
    mb = of.MeshBuilder()
    ground(mb)
    mount(mb)
    tower(mb)
    swing_arm(mb)
    striping(mb)
    guard_rails(mb)
    stair(mb)
    furniture(mb)
    _report.append(("LaunchPad_LOD0", mb))
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    mb = of.MeshBuilder()
    ground(mb, detail=False)
    mount(mb, detail=False)
    tower(mb, detail=False)
    swing_arm(mb, detail=False)
    striping(mb)
    stair(mb, detail=False)
    _report.append(("LaunchPad_LOD1", mb))
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    """At 80 m the pad is two banks, a table, a mast and a light. The MAST is
    what says 'launch site' from orbit-adjacent altitude, so it is the one
    thing LOD2 keeps at full height. The trench stays too, because a slot of
    shadow down the middle is the whole silhouette."""
    mb = of.MeshBuilder()
    mb.box((2 * TR_HW, W, TR_FLOOR), (0.0, 0.0, TR_FLOOR * 0.5), "RockDark")
    for sx, y0, y1 in ((-1.0, -HALF, HALF), (1.0, -HALF, STAIR_S)):
        cy, dy = (y0 + y1) * 0.5, y1 - y0
        mb.box((HALF - TR_HW, dy, DECK_Z),
               (sx * (HALF + TR_HW) * 0.5, cy, DECK_Z * 0.5), "Rock")
    mb.box((2 * MT_HW, 2 * MT_HY, DECK_Z - MT_UNDER),
           (0.0, 0.0, (MT_UNDER + DECK_Z) * 0.5), "SteelDark")
    tx, ty = TOWER
    mb.box((2 * TL + LEG, 2 * TL + LEG, H - TOWER_BASE),
           (tx, ty, (TOWER_BASE + H) * 0.5), "Steel")
    mb.box((4.20, 4.20, 0.30), (tx, ty, H - 0.15), "Steel")
    mb.box((0.26, 0.26, 0.22), (tx, ty, H - 0.45), "EmissiveState")
    x0 = tx + TL + 0.16
    mb.box((UMB_X - 0.44 - x0, 0.52, 0.46), ((x0 + UMB_X - 0.44) * 0.5, ty,
                                             ARM_Z), "SteelDark")
    _report.append(("LaunchPad_LOD2", mb))
    return mb, mb.build(NAME + "_LOD2", root)


# ---------------------------------------------------------------------------
# The clamp: a separate ground-pivoted part on the file origin
# ---------------------------------------------------------------------------

def build_clamp(root):
    """Base, mast and hinge head. Does NOT move; the arm does.

    Ground-pivoted and centred on X and Y, so the renderer places it with a
    plain translate-and-rotate on the circle socket_clamp marks. Local +Y is
    radially OUTBOARD, so the mast leans away from the stack and the arm has
    somewhere to swing to."""
    mb = of.MeshBuilder()
    mb.box((CLAMP_X, CLAMP_Y, 0.22), (0.0, 0.0, 0.11), "SteelDark")
    mb.box((CLAMP_X - 0.16, CLAMP_Y - 0.10, 0.06), (0.0, 0.0, 0.24), "Hazard")
    mb.box((0.72, 0.50, 1.86), (0.0, 0.08, 1.15), "Steel")
    for sx in (-1.0, 1.0):
        mb.box((0.14, 0.34, 1.50), (sx * 0.50, 0.10, 0.97), "SteelDark")
    mb.box((0.28, 0.26, 1.10), (0.0, -0.18, 1.00), "Steel")       # ram
    mb.box((0.20, 0.20, 0.34), (0.0, -0.18, 1.62), "SteelDark")
    mb.box((0.86, 0.44, 0.34), (0.0, -0.03, CLAMP_H - 0.17), "SteelDark")
    mb.box((0.30, 0.16, 0.90), (0.42, 0.24, 1.30), "Accent")      # hose
    _report.append(("LaunchClamp_LOD0", mb))
    obj = mb.build("LaunchClamp_LOD0", root)

    mb2 = of.MeshBuilder()
    mb2.box((CLAMP_X, CLAMP_Y, 0.22), (0.0, 0.0, 0.11), "SteelDark")
    mb2.box((0.72, 0.50, CLAMP_H - 0.11), (0.0, 0.08, (0.11 + CLAMP_H) * 0.5),
            "Steel")
    _report.append(("LaunchClamp_LOD2", mb2))
    mb2.build("LaunchClamp_LOD2", root)
    return mb, obj


def build_clamp_arm(pivot):
    """The half that lets go. Authored HOLDING, because frame 1 of
    Clamp_Release is the exported static pose and a pad at rest is a pad
    holding a rocket.

    Local to clamp_pivot, which sits at clamp-local y = HINGE_Y. A point at
    clamp-local y lands at radius CLAMP_R + y, so the grip pad's inner face at
    local y = -0.40 is at clamp-local -0.65, i.e. r = 1.25: exactly the class
    L hull. It touches by construction."""
    mb = of.MeshBuilder()
    mb.box((0.44, 0.28, 0.30), (0.0, -0.14, 0.0), "Steel")
    mb.box((1.40, 0.14, 0.60), (0.0, -0.33, 0.0), "Hazard")
    for sx in (-1.0, 1.0):
        mb.box((0.16, 0.30, 0.20), (sx * 0.50, -0.20, 0.0), "SteelDark")
    _report.append(("LaunchClamp_Arm", mb))
    return mb, mb.build("LaunchClamp_Arm", pivot)


# ---------------------------------------------------------------------------

def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    build_lod1(root)
    build_lod2(root)
    mbc, _ = build_clamp(root)
    arm_pivot = of.add_pivot("clamp_pivot", (0.0, HINGE_Y, HINGE_Z), root)
    mba, _ = build_clamp_arm(arm_pivot)

    # FIVE proxies, sixty triangles, exactly the contract's budget. The two
    # deck banks are separate boxes BECAUSE the trench is between them; a
    # single slab there would be a player walking on air over a 1.70 m drop.
    of.add_collision_box("col_LaunchPad", (HALF - TR_HW, W, DECK_Z),
                         (-(HALF + TR_HW) * 0.5, 0.0, DECK_Z * 0.5), root,
                         role="Rock")
    of.add_collision_box("col_LaunchTrench",
                         (HALF - TR_HW, STAIR_S + HALF, DECK_Z),
                         ((HALF + TR_HW) * 0.5, (STAIR_S - HALF) * 0.5,
                          DECK_Z * 0.5), root, role="Rock")
    of.add_collision_box("col_LaunchMount",
                         (2 * MT_HW, 2 * MT_HY, DECK_Z - MT_UNDER),
                         (0.0, 0.0, (MT_UNDER + DECK_Z) * 0.5), root,
                         role="SteelDark")
    of.add_collision_box("col_LaunchTower",
                         (2 * TL + LEG, 2 * TL + LEG, H - TOWER_BASE),
                         (TOWER[0], TOWER[1], (TOWER_BASE + H) * 0.5), root,
                         role="Steel")
    of.add_collision_box("col_LaunchClamp", (CLAMP_X, CLAMP_Y, CLAMP_H),
                         (0.0, 0.0, CLAMP_H * 0.5), root, role="SteelDark")

    of.add_socket("socket_vessel", (0.0, 0.0, DECK_Z), UP, root,
                  {"of_role": "vessel_mate"})
    of.add_socket("socket_clamp", (CLAMP_R, 0.0, DECK_Z), INWARD, root,
                  {"of_role": "clamp_mount"})
    of.add_socket("socket_umbilical", (UMB_X, 0.0, ARM_Z), OUTWARD, root,
                  {"of_role": "umbilical"})
    of.add_socket("socket_smoke", (0.0, 0.0, DEFL_Z), UP, root,
                  {"of_role": "exhaust"})
    of.add_socket("socket_status", (TOWER[0], TOWER[1], H - 0.45), DOWN, root,
                  {"of_role": "state_light"})

    # Clamp_Release: the arm swings 70 degrees up and back, out of the
    # vessel's way, retracting radially as it goes. One-shot; played in
    # reverse to re-clamp.
    of.add_clip_multi(arm_pivot, "Clamp_Release", {
        "rotation_euler": [(1, of.deg3()), (13, of.deg3(x=-32.0)),
                           (25, of.deg3(x=-70.0))],
        "location": [(1, (0.0, HINGE_Y, HINGE_Z)),
                     (13, (0.0, HINGE_Y, HINGE_Z)),
                     (25, (0.0, HINGE_Y + 0.06, HINGE_Z))],
    })

    of.report(NAME, _report)
    for label, mb in (("LaunchPad_LOD0", mb0), ("LaunchClamp_LOD0", mbc),
                      ("LaunchClamp_Arm", mba)):
        lo, hi = mb.bounds()
        print("[pad] %-18s dims %s  min %s"
              % (label, [round(hi[k] - lo[k], 4) for k in range(3)],
                 [round(v, 4) for v in lo]))
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
