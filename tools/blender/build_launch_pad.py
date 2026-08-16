"""
build_launch_pad.py - Tier 2, the launch pad: the place a rocket leaves from.

    ~/.local/bin/blender501 --background --python tools/blender/build_launch_pad.py
    "C:/Program Files/Blender Foundation/Blender 5.0/blender.exe" \
        --background --python tools/blender/build_launch_pad.py

Produces assets/models/dist/rocket/launch_pad.glb.

RN-1690: THE FORM PASS (A4's asset list ends "then pad", and neither wave took
it). Everything below this paragraph up to the material-families note is the
pad as the DW-35 pass left it, and it was already an arrangement rather than a
slab: a raised deck, a flame trench, a blast deflector, four hold-down clamps,
a mast and an umbilical arm. What it did NOT have was the thing every machine
around it gained in waves one and two: ASSEMBLY. It was a correct arrangement
of untouched primitives. A launch pad is a place people work on, and the six
things this pass buys are the six a pad has that a big foundation does not -
a deck that was POURED IN BAYS and edged in steel, a trench with SERVICES in
it, clamps that read as MECHANISMS, a T-0 umbilical mast so the vehicle is
FUELLED by something, a cable network that goes somewhere, and SCORCH where
the exhaust actually lands.

WHY `machine_form` IS IMPORTED HERE AND WHY IT IS NOT USED ON THE DECK, and
this is that module's own scale argument arriving at the largest asset in the
game. Every height in its `LAYER` table is an absolute metre count derived
against a 4 m to 8 m machine, and the module's docstring makes exactly this
refusal twice already (the belt at RN-1551, the inserter and pole at RN-1591)
for parts that are too SMALL. The pad is the first part that is too BIG: a
13 mm `seam` strap on a 23.3 m deck bay is 0.06 per cent of the face it is
meant to divide, where the same strap on a 4 m wall panel is 0.33 per cent,
and a 44 mm `bolt` on the deck is a pebble.

So the vocabulary is applied to the pad's SUB-ASSEMBLIES, every one of which
is at machine-to-building scale and is therefore inside the range the table
was derived for - the launch table (7.2 x 6.8 m), the clamp (1.6 x 0.7 m), the
control bunker (4.0 x 2.6 m), the propellant tank (3.0 m across), the tower
legs and the swing arm - and the DECK is detailed at its own scale with
hand-authored geometry that says so where it is written. That is the same
answer `build_belt_segment.py` and `build_power_pole.py` give from the other
end of the range, and it is why this file appears on machine_form's import
list with the caveat attached rather than without one.

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
        / col_LaunchClamp / col_LaunchStep1 .. col_LaunchStep8
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

AND THE STAIRS ARE PROXIED TREAD BY TREAD (GP-76), the 2026-07-27 playtest fix
and the reason the collision budget moved. Reid: "the stairs on the launch pad
dont work". The eight steps in the north-east notch were drawn and never
proxied, so the ONE route up that a player on foot can take had nothing under
it at all: measured by `probes/padstair.js` before the fix, a driven walk
from the ground gained 0.000 m over the pad's base plane and wedged against the
2.00 m south face of `col_LaunchTrench` at the top of the run. The two banks
deliberately stop short of the notch (`STAIR_S`), so there was no proxy within
2.72 m of run to stand on.

They are eight boxes and not one ramp because the client's proxies are
AXIS-ALIGNED boxes in the part's own frame (`web/src/game/StructureBody.ts`):
an inclined plane is not expressible, so a staircase has to be a staircase. And
they are eight and not four because they are generated from the SAME
`stair_treads()` the drawn geometry is generated from, so the surface you stand
on is the surface you can see, to the millimetre. Coarsening to four 0.50 m
boxes would have halved the triangles and put the player's feet a quarter of a
metre above every other visible tread, which is the same walking-on-air the
trench paragraph above exists to prevent.

Thirteen boxes, 156 triangles. `max_tris_collision` in contracts.json moved
from 60 to 160 to pay for it; nothing here reaches a pixel (of_lib hides every
col_* and `assets/Loaders.ts` hides them again on load), so the cost is file
size plus eight more AABB tests per capsule sample while the player is standing
on this one 24 m part.

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

RN-1690 ADDS THE TWO WEAR ROLES, AND THE PAD IS THE ASSET WITH THE BEST CLAIM
ON THEM IN THE WHOLE PROJECT. `SteelRust` (texgen's `rust` family) and
`SteelWorn` (`paintchip`) were minted for the smelter's hot path and the
miner's wet-ore path, which are both arguments about a small region of one
machine. A launch pad has a region where a rocket engine fires: the flame
hole's throat plates, the deflector's own windward cladding and the trench
liner's lower band are, between them, the only surfaces in this game that a
supersonic exhaust plume is aimed at BY DESIGN, and painting them the same
`SteelDark` as the handrail two metres away is the flat read that D-020 is
about. `SteelWorn` goes where FEET go and not where fire goes - the launch
table's walking plate, the stair nosings, the top rail a hand slides along -
because paintchip is a coating that has been rubbed through, which is a
different fact about a surface than oxide is.

THE TWO ROLES ARE PLACED WHERE THE PHYSICS PUTS THEM AND NOT WHERE THEY LOOK
GOOD, which is checkable: `socket_smoke` is published at the deflector ridge
and the sim's exhaust leaves `socket_vessel` straight down the 3.00 m flame
hole, so "inside the hole, on the ridge, and up the trench walls as far as the
splash reaches" is the plume's own envelope. Nothing on the west bank, the
tower or the bunker wears rust, because nothing there is ever hit.

RN-1815 ANSWERS THE TWO THINGS THE FORM PASS'S OWN VERIFIER LEFT OWED, AND
BOTH ARE MATERIAL FINDINGS RATHER THAN FORM ONES.

(1) THE OUTER SKIRT. It is the largest single surface in the walk and close
frames and it read as "a repeating dark aggregate or rock tile rather than
poured concrete". RN-1780 had already moved every stone surface here off
`stone` and onto `masonry`, which fixed the WORLD SCALE and, by design,
reused `_stone_height` - so the pad was still wearing a field of 22 cm
fractured facets. A pad is poured. Every one of those surfaces now wears
`Concrete`/`ConcreteDark` (texgen's `concrete`), which is board marks, form
panel joints, tie holes, blowholes, spalls and rain runs at the same 1.8 m
and 512 px `masonry` already validated for this consumer. The ruin and the
foundation keep `masonry`, which is right for laid stone.

(2) THE TRENCH. It read as rust PAINT: one uniform `SteelRust` band down the
full 24 m of both walls, measured at saturation 0.635 sunlit and 0.829 shaded
on real D3D11 from the south mouth. A supersonic exhaust deposits carbon, so
every plume surface here - the liner's lower band, the deflector, the flame
throat - is now `Soot`, the trench floor and the deflector plinth are
`ConcreteSoot`, and the gradient runs OUT of the trench rather than along it:
black inside, thin scorch marks on the deck immediately outboard of the lips,
clean concrete everywhere the plume never reaches. `SteelRust` leaves this
asset; see `ground()` for the graded version that was built first and
measured out. NO GEOMETRY MOVES in either item: same 4256/2024/192 triangles,
same 18 sockets and colliders, same LOD1 deviation. RN-1815 is a materials
pass end to end.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import machine_form as mf  # noqa: E402

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
# PAINT STOPS SHORT OF THE EDGE IT MARKS (RN-442). `ground()` and `striping()`
# each derived the cap's Y boundary from HALF, INSET and STAIR_S, arriving
# independently at the same three planes: -11.65, +11.65 and +9.20. The hazard
# band's end faces therefore landed exactly on the concrete's own end faces,
# same-facing, over the full band width: 24 pairs across LOD0 and LOD1, the
# second largest group on the asset. A margin is not an epsilon here, it is
# what painted deck edging actually does; nobody paints to the cut line.
PAINT_MARGIN = 0.06
# ...and the same rule around the flame hole. `HOLE` is the hole's half-width,
# and both the hole plates and the hazard curb were placed as `HOLE + half of
# my own size`, which cancels to a shared inner face at |x| or |y| = 1.50 (22
# pairs). The curb now starts outboard of the plate's own edge.
CURB_STANDOFF = 0.04

# --- the trench -------------------------------------------------------------
TR_HW = 3.60             # trench half-width; a 7.2 m channel through 24 m of Y
TR_FLOOR = 0.30          # trench floor slab top, so the trench is 1.70 m deep
DEFL_Z = 1.30            # blast deflector ridge, clear of the mount underside
# RN-1815: THERE IS NO SOOT THRESHOLD, AND THE TWO THAT WERE TRIED ARE
# RECORDED IN `ground()` RATHER THAN HERE, because both were killed by a
# measurement and a frame rather than by an argument. The whole trench is the
# plume's path - the flow leaves socket_smoke at the deflector ridge and runs
# the full 24 m out of both mouths - so every surface in it is a plume
# surface, and the gradient this pass owes runs from the trench OUT ONTO THE
# DECK, not from the middle of the trench to its ends.

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

# --- RN-1690: the deck's own detail scale ------------------------------------
# THESE ARE NOT machine_form LAYER HEIGHTS AND THAT IS THE POINT (see the
# module docstring). A deck bay is 23.30 m long; the numbers below are derived
# from the bay, not from a machine. They are all DIFFERENT from each other for
# machine_form property (b)'s reason - two parts can only land on a common
# outer plane if they are the same type, and a type carries one role - and
# none of them is a LAYER value, so a deck part can never share a plane with a
# sub-assembly greeble either.
BAY = 4.6625             # a pour bay: the west cap's 23.30 m of Y in five.
JOINT_W = 0.11           # the sealant bead standing in the joint
JOINT_UP = 0.026         # ...proud of the cap
JOINT_DOWN = 0.014       # ...and buried, so it is never flush with the cap
KERB = 0.135             # the steel edge angle capping the concrete
KERB_UP = 0.058
ANCHOR_UP = 0.041        # a tie-down pocket's boss plate
SCORCH_UP = 0.021        # soot lying ON the concrete, thinner than a joint
SOOT_UP = 0.012          # ...and the offset satellite that breaks its outline

# --- RN-1690: the T-0 umbilical mast -----------------------------------------
# THE ONE THING ON THIS PAD THAT ANSWERS "HOW DOES THE ROCKET GET FUELLED",
# and it is placed by the same arithmetic the swing arm is: it stands clear of
# the launch table's east edge and reaches back IN to a class L hull.
# ON THE +X AXIS, AND THAT IS LOAD-BEARING RATHER THAN TIDY. `T0_TIP` is a
# RADIUS (HULL_R + 0.06), so a boom reaching x = T0_TIP only lands 60 mm off
# the hull if it runs along a line through the axis. Parked one bay south at
# y = -1.30 the same tip sits at radius 1.846, i.e. 596 mm of daylight between
# the umbilical and the vehicle it is plugged into, and the "same 0.05 m
# standoff UMB_X publishes" sentence below would have been simply false. Same
# class as the swing arm's own construction at the other end of the pad.
T0 = (MT_HW + 1.05, 0.0)        # 4.65, 0.0: off the table, on the east bank
T0_H = 5.40                     # crown, above deck: shorter than the stack it
T0_HW = 0.30                    # serves, so it never crosses the vehicle
T0_ARM_Z = DECK_Z + 3.90        # the head, level with the vessel's tank base
T0_TIP = HULL_R + 0.06          # 1.31: the same 0.05 m standoff the boom uses

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
#
# RN-1780 (look audit R3): every stone surface below wears `Masonry`/
# `MasonryDark`, not `Rock`/`RockDark`. Same colour, metalness and roughness
# (of_lib.PALETTE copies the two constants verbatim); only the tiling family
# differs, at a 1.8 m world scale authored for a 24 m pad instead of a
# 1.0-1.5 m boulder. See texgen.py's ROLE_FAMILY comment for the measured
# consumer range this split answers.
#
# RN-1815 SUPERSEDES THAT FOR THIS ASSET: `Concrete`/`ConcreteDark`, not
# `Masonry`/`MasonryDark`. RN-1780 moved the pad off `stone` because the
# WORLD SCALE was a boulder's, and it fixed exactly that; what it could not
# fix, having deliberately reused `_stone_height`, is that the recipe is
# still fractured rock. The pad's fresh-context verifier read the 2 m outer
# skirt - the largest single surface in the walk and close frames - as "a
# repeating dark aggregate or rock tile rather than poured concrete, with a
# visible repeat at walking distance". A pad is POURED. `concrete` is board
# marks, form panel joints, tie holes, blowholes and rain runs, at the same
# 1.8 m and 512 px masonry already validated for this consumer.
#
# THE COLLISION PROXIES BELOW KEEP `Masonry` AND THAT IS DELIBERATE. This
# pass is required to leave all 18 `col_*` and `socket_*` nodes byte-identical
# and a proxy's role is written into its exported material index, so moving
# them would break the identity proof to change something no pixel reads
# (of_lib hides every `col_*` and `assets/Loaders.ts` hides them again on
# load). `OF_Masonry` therefore survives in the .glb material table, worn by
# nothing that draws.
# ---------------------------------------------------------------------------


# RN-1820. THE POUR BAYS, AND WHY A TILING MAP COULD NOT HAVE DONE THIS.
#
# The RN-1815 verifier's third finding against the skirt: "the tone is uniform
# across all 24 m, with no pour-to-pour variation. A wall that size is poured
# in lifts and each lift cures slightly differently. Add that variation at the
# lift scale, not as noise."
#
# That length is the whole difficulty. `concrete` tiles at 1.8 m, so ANY term
# the texture carries repeats 13.3 times along this wall: a macro tone field
# authored in the map is, by construction, a 1.8 m period pretending to be a
# 6 m one, and it would be adding countable repeat to the wall whose countable
# repeat is the OTHER open finding. Above the tile there is exactly one dial
# left, the material assignment, so the plinth is poured in bays the way the
# real thing is and the bays wear three values of one material
# (of_lib's `ConcreteDark` and the `ConcreteLean`/`ConcreteRich` either side
# of it, +-9 counts of luma at unchanged chroma).
#
# THE CUTS ARE UNEQUAL AND THE TWO BANKS DO NOT AGREE, both on purpose. Equal
# bays are a metronome and a metronome is the defect one octave down; and the
# west bank is 24.0 m against the east's 21.2, so giving them the same bay
# count would be the one arrangement that says "generated". Four pours west at
# 7.0 / 6.0 / 5.5 / 5.5 m and three east at 6.4 / 7.6 / 7.2 m, with no two
# neighbours sharing a value, is a day's work a concrete gang would recognise.
#
# WHAT IT COSTS, priced rather than found later. Five more boxes, 60
# triangles, LOD0 4256 -> 4316 against a 4400 budget; two more materials in
# the file, 12 -> 14, i.e. two more draw calls on ONE instance; zero texture
# memory, because all three roles share the three `of_concrete_*` PNGs that
# already ship.
#
# AND IT IS LOD0 ONLY, WHICH IS A DECISION AND NOT AN OVERSIGHT. `ground(
# detail=False)` keeps one `ConcreteDark` box per bank, so LOD1 stays at 2024
# triangles and 10 primitives and does not eat its own 76-triangle headroom
# for a 9-count tone step nobody can resolve at LOD1 range. The pop at the
# switch is bounded by that same 9 counts, which is smaller than the tone step
# the boards already carry across a lift line. LOD2 drops the trench's soot
# gradient for the identical reason (RN-1815) and this follows it.
PLINTH_BAYS = {
    # (cuts measured in Y from the bank's own start, role for each bay)
    -1.0: ((7.0, "ConcreteLean"), (6.0, "ConcreteRich"),
           (5.5, "ConcreteDark"), (5.5, "ConcreteLean")),
    +1.0: ((6.4, "ConcreteDark"), (7.6, "ConcreteLean"),
           (7.2, "ConcreteRich")),
}


def plinth_bays(y0, y1, detail):
    """[(y0, y1, role)] for one bank's plinth: the pour bays at LOD0, one
    undivided `ConcreteDark` box below it.

    THE LAST BAY IS SNAPPED TO `y1` RATHER THAN ACCUMULATED TO IT. The widths
    in `PLINTH_BAYS` are hand-written metres and the banks are 24.00 and 21.20
    long, so a bare running sum leaves the final cut wherever float addition
    of four decimals lands - and the pad's own `tolerance_m` is 0.005, which a
    sum of four hand-written numbers is not guaranteed to hold. Snapping the
    end makes the asset's OUTER dimension exact by construction and puts the
    whole of any rounding error inside the last pour, where it is invisible."""
    # WHICH BANK, read off the geometry rather than passed in: only the west
    # bank runs to the far edge (`y1 == HALF`); the east one stops at the
    # stair notch. Deriving it here keeps `ground()`'s loop reading as the one
    # loop over two banks that it is.
    bays = PLINTH_BAYS[-1.0 if y1 >= HALF - 1e-9 else +1.0]
    if not detail:
        return [(y0, y1, "ConcreteDark")]
    out = []
    y = y0
    for i, (span, role) in enumerate(bays):
        nxt = y1 if i == len(bays) - 1 else y + span
        out.append((y, nxt, role))
        y = nxt
    return out


def ground(mb, detail=True):
    """Two concrete banks with a 6 m channel between them.

    Built as a plinth plus a setback cap rather than as one 1.75 m slab: the
    0.20 m ledge is what gives a 9 x 24 m mass a horizon line, and without it
    the biggest surface in the asset is a single untextured-looking face no
    matter what the normal map does to it."""
    # Trench floor, which is also the only thing standing on z = 0 under the
    # channel, so the asset's base plane is the ground and not the deck.
    #
    # RN-1815: STILL ONE BOX, AND `ConcreteSoot` FOR ALL 24 m OF IT.
    #
    # TWO GRADED VERSIONS WERE BUILT AND BOTH WERE MEASURED OUT, which is
    # worth the lines because the reasoning that produced them is the
    # reasoning the next lane will reach for. Version one split this slab in
    # three and sooted only |y| < 6.00 (the deflector's own 9.80 m footprint
    # plus a metre of splash), leaving the ends as clean `ConcreteDark`: on
    # real D3D11 from the south mouth that put the `floor` rectangle at luma
    # 157.96 AFTER the pass against 131.84 BEFORE, i.e. a flame trench whose
    # floor came out BRIGHTER and cleaner than the rock it replaced, over the
    # largest single area in the frame. Version two moved the threshold out to
    # 9.60 (the reach of driven rain at a mouth) and still measured 141.16.
    # The premise was wrong, not the number: rain that gets into a mouth runs
    # ALONG a floor and pools on it, which deposits rather than scours, and
    # the bottom of a channel is where everything the plume carries ends up.
    # There is no clean part of a flame trench floor, so there is no split.
    mb.box((2 * TR_HW, W, TR_FLOOR), (0.0, 0.0, TR_FLOOR * 0.5),
           "ConcreteSoot")

    # West bank: full 24 m of Y. East bank stops short of the stair notch.
    for sx, y0, y1 in ((-1.0, -HALF, HALF), (1.0, -HALF, STAIR_S)):
        cy, dy = (y0 + y1) * 0.5, y1 - y0
        for by0, by1, role in plinth_bays(y0, y1, detail):
            mb.box((HALF - TR_HW, by1 - by0, CAP_Z),
                   (sx * (HALF + TR_HW) * 0.5, (by0 + by1) * 0.5,
                    CAP_Z * 0.5), role)
        # The cap is inset on the OUTER and END faces only. Its trench face
        # stays flush at |x| = TR_HW so the mount can abut it exactly: two
        # coincident faces with opposite normals are invisible under backface
        # culling, where two coplanar faces with the SAME normal z-fight.
        cap_y0 = y0 + (INSET if y0 <= -HALF + 1e-9 else 0.0)
        cap_y1 = y1 - (INSET if y1 >= HALF - 1e-9 else 0.0)
        mb.box((HALF - INSET - TR_HW, cap_y1 - cap_y0, DECK_CAP),
               (sx * (HALF - INSET + TR_HW) * 0.5, (cap_y0 + cap_y1) * 0.5,
                CAP_Z + DECK_CAP * 0.5), "Concrete")

    if detail:
        # Steel liner standing 0.22 m proud of each trench wall, IN TWO BANDS
        # (RN-1690). One box became two for one reason: the lower 575 mm of a
        # flame trench wall is inside the splash the deflector throws and the
        # upper 475 mm is not, so the liner has a waterline and the two halves
        # of it are not the same material any more. The split plane at
        # z = 0.90 is shared by the two boxes with OPPOSITE normals (the
        # lower's top faces up into the upper's bottom), and their side faces
        # are coplanar but disjoint in Z, so there is no overlapping area for
        # check_coplanar to count.
        #
        # RN-1815 RE-ROLES THE LOWER BAND `Soot`, AND THAT IS THE SECOND OWED
        # ITEM. As RN-1690 left it, the lower band was one 24 m box of
        # `SteelRust` per wall: measured on real D3D11 from the south mouth,
        # saturation 0.635 on the sunlit wall and 0.829 on the shaded one, and
        # dead uniform end to end. The verifier's words: it "reads as rust
        # paint rather than soot". A supersonic exhaust plume does not leave
        # orange, it leaves carbon.
        #
        # A GRADED VERSION WAS BUILT FIRST AND MEASURED OUT. Sooting only the
        # middle and leaving the 2.40 m at each mouth as oxide (the reach of
        # driven rain) is the physically prettier story and it FAILED THE
        # FRAME: the trench is only ever seen from a mouth, because nothing
        # can stand on the 2 m deck, so the oxide fringe is the nearest and
        # largest part of the wall in every possible view. The measurement
        # said so - the whole-band saturation came down only 0.635 -> 0.561 -
        # and the picture said so louder: two orange panels, still the most
        # saturated thing in the trench, still the thing the finding was
        # about. What was wrong was not the number but the premise that the
        # role had a consumer left here at all. RN-1690 minted `SteelRust` for
        # this pad's plume surfaces, reasoning that they are the only
        # surfaces in the game a supersonic exhaust is aimed at by design;
        # that reasoning is right and its conclusion is not, because what an
        # exhaust plume deposits is carbon. So the role leaves this asset
        # entirely - liner, deflector and throat all go to `Soot` - and the
        # pad's gradient runs OUT OF the trench rather than along it: `Soot`
        # on the steel and `ConcreteSoot` on the concrete inside, thin
        # `ConcreteSoot` scorch marks on the deck immediately outboard of the
        # lips, clean `Concrete` everywhere the plume never reaches.
        #
        # It is also one box per wall again, exactly as RN-1690 built it, so
        # THIS PASS CHANGES NO GEOMETRY AT ALL: same 4256/2024/192 triangles,
        # same 18 sockets and colliders, same LOD1 deviation. `SteelRust`
        # keeps its palette row and its smelter and miner consumers.
        #
        # The UPPER band is untouched and that is deliberate twice over: it is
        # above the splash waterline that is the whole reason the band was
        # split, and leaving it gives this pass an adjacent, identically lit
        # NEGATIVE CONTROL that must not move.
        for sx in (-1.0, 1.0):
            mb.box((0.22, W, 0.575), (sx * (TR_HW - 0.11), 0.0, 0.6125),
                   "Soot")
            mb.box((0.22, W, 0.475), (sx * (TR_HW - 0.11), 0.0, 1.1375),
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
    mb.box((7.40, 9.80, 0.22), (0.0, 0.0, TR_FLOOR + 0.11), "ConcreteSoot")
    dz = TR_FLOOR + 0.22
    hx, hy = 3.50, 4.60
    v = [(-hx, -hy, dz), (hx, -hy, dz), (hx, hy, dz), (-hx, hy, dz),
         (-hx, 0.0, DEFL_Z), (hx, 0.0, DEFL_Z)]
    f = [(0, 3, 2, 1), (0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5)]
    # RN-1690: SteelRust, not SteelDark, and this is the surface in the game
    # with the strongest claim on the role. The deflector is the ONE thing a
    # rocket engine is aimed at on purpose, and painting it the same value as
    # the handrail 2 m above it was the flat read D-020 is about. The change
    # also does what the paragraph above wanted and failed to get: rust is
    # 834F2A against concrete's grey, so the wedge now separates from the
    # trench floor by HUE and not only by value, which is the one separation
    # that survives being lit by bounce alone. The Steel splitter cap below
    # keeps its highlight and is now the only bright thing down there.
    #
    # RN-1815: `Soot`, and the paragraph above is the thing that has to be
    # answered before changing it, because its separation argument is real.
    # The deflector is the single most plume-hit surface in the game, so if
    # anything on this pad is black with carbon it is this; but RockDark made
    # it vanish once already by being the SAME VALUE as the floor it stands
    # on, and that failure must not be repeated. It is not: the floor under
    # it is now `ConcreteSoot` at luma 50.4 and the wedge is `Soot` at 39.6,
    # which is only 11 counts, so the separation is NOT carried by value here
    # either. It is carried by MATERIAL - `Soot` is `rust`'s oxide-flake
    # relief at 0.02 metalness and 0.98 roughness against a concrete field at
    # 0.00 and 0.97 - and, decisively, by the `Steel` splitter cap along the
    # ridge, which RN-1690 added for exactly this reason and which is now the
    # only bright thing in the trench rather than one of two.
    mb.add_raw(v, f, [False] * len(f), "Soot")
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
    # THE CURB IS A CLOSED FRAME, and that is what removes the last 12 pairs.
    # Moving the bars outboard fixed their INNER faces but left the E/W pair
    # `2 * HOLE` long, so its END faces were still at |y| = 1.50, which is the
    # N/S hole plates' own inner edge. The same landmark, reached by a length
    # instead of by an offset. Running both pairs to the frame's outer corner
    # means every end face lands on another HAZARD face, and same-material
    # overlaps are invisible by construction (see check_coplanar's header).
    curb = HOLE + CURB_STANDOFF + 0.075
    for sy in (-1.0, 1.0):
        mb.box((2 * (curb + 0.075), 0.15, 0.10), (0.0, sy * curb, DECK_Z),
               "Hazard")
    for sx in (-1.0, 1.0):
        mb.box((0.15, 2 * (curb + 0.075), 0.10), (sx * curb, 0.0, DECK_Z),
               "Hazard")
    # Girders under the table, visible from inside the trench. The Y-running
    # pair used to be `2 * MT_HW` long, and MT_HW is DEFINED as TR_HW, so a
    # structural member that has no reason to reach the trench wall ended up
    # flush with the steel liner standing on it: 8 pairs. 0.15 m shorter at
    # each end is a girder that lands on the table and not on the wall.
    for sx in (-1.0, 1.0):
        mb.box((0.30, 2 * MT_HY, 0.34), (sx * (MT_HW - 0.20), 0.0,
                                         MT_UNDER - 0.17), "Steel")
    for sy in (-1.0, 1.0):
        mb.box((2 * (MT_HW - 0.15), 0.30, 0.34), (0.0, sy * (MT_HY - 0.20),
                                                  MT_UNDER - 0.17), "Steel")
    mount_detail(mb)
    return mb


# The table's own two faces, in machine_form's frame. THE LAUNCH TABLE IS THE
# ONE PART OF THIS ASSET THE VOCABULARY FITS WITHOUT AN ARGUMENT: 7.20 x 6.80 m
# is inside the 4 to 8 m range every LAYER height was derived against, which is
# more than can be said for the 24 m deck it is set into (see the module
# docstring). `limit` is the footprint edge in both cases, which is metres away
# and therefore not the constraint here; it is passed anyway so a future
# greeble that DID reach it fails by name.
def _mount_top():
    return mf.Face("Z", 1, DECK_Z, limit=H, name="launch table top")


def _mount_side(sy):
    return mf.Face("Y", int(sy), sy * MT_HY, limit=sy * HALF,
                   name="launch table %sY" % ("+" if sy > 0 else "-"))


def mount_detail(mb):
    """What turns the launch table from a steel annulus into a launch table.

    Four things, in the order they pay:

    (1) THE FOUR CLAMP PADS, and they are the reason this function exists.
        `socket_clamp` publishes a mounting circle at r = 1.90 and the renderer
        puts four clamps on it, standing on nothing: the table under them was
        the same unbroken plate as the table two metres away, so a 2.4 m
        mechanism that holds a rocket down appeared to be resting on the floor.
        A pad is what a hold-down bolts to. It is deliberately 340 mm longer
        and 320 mm wider than the clamp's own 1.60 x 0.70 base so a rim of it
        shows all round, which is the only way the pad reads at all once the
        clamp is placed on it.
    (2) THE THROAT, in `Soot` since RN-1815 and in `SteelRust` before it.
        Four plates hanging into the 3.00 m hole from the table underside.
        The hole was an ABSENCE - four plate edges and then nothing - and an
        opening with no visible inside is a pattern (machine_form.louvre
        makes the same argument about a vent). These are also the closest
        surfaces in the game to a firing engine bell, which is exactly why
        they are the one place on this asset with a stronger claim on carbon
        than on oxide: nothing is deeper inside the plume than the inside of
        the hole it goes down.
    (3) THE WALKING PLATES, in `SteelWorn`, north and south of the curb. A
        crew stands here to work on a clamp, and paintchip is a coating rubbed
        through by feet, which is a different fact about a surface than the
        oxide inside the hole is.
    (4) SIX GUSSETS under the two long edges, which is the only part of the
        table anyone standing in the trench can see the underside of."""
    top = _mount_top()
    # (1) the clamp pads. Two are long in Y and two long in X, because the
    # clamp's own 1.60 m width is TANGENTIAL to the circle: a pad drawn to one
    # orientation would be crossways under half of them.
    for i in range(4):
        a = math.radians(90.0 * i)
        cx, cy = CLAMP_R * math.cos(a), CLAMP_R * math.sin(a)
        du, dv = (1.02, 1.94) if i % 2 == 0 else (1.94, 1.02)
        top.part(mb, du, dv, cx, cy, "boss", "Steel")
        # Two bolts through each pad, near its OUTBOARD edge and spaced along
        # its LONG axis, which is where a hold-down's tension actually goes.
        # They stand on the pad's own outer plane through a Face at that
        # plane, which is machine_form.bolted_plate's construction: a bolt
        # through a plate, not beside it.
        #
        # THE OUTBOARD DIRECTION AND THE LONG AXIS ARE PERPENDICULAR AND SWAP
        # EVERY QUARTER TURN, which the first version got wrong in a way no
        # coplanar or footprint check could catch: it added the 0.62 m spacing
        # along the SAME axis as the 0.66 m outboard offset on the two pads at
        # +/-Y, so one bolt of each pair landed at r = 3.18 - 770 mm off the
        # far end of a pad 1.02 m wide, floating on bare table. The shadow
        # trace is what found it, because a bolt nowhere near its pad is also
        # a bolt nowhere near the pad's shadow proxy.
        pad = mf.Face("Z", 1, top.out(mf.layer("boss")), limit=H,
                      name="clamp pad %d" % i)
        out_u, out_v = math.cos(a) * 0.34, math.sin(a) * 0.34
        long_u, long_v = (0.0, 0.62) if i % 2 == 0 else (0.62, 0.0)
        for s in (-1.0, 1.0):
            pad.part(mb, 0.13, 0.13, cx + out_u + s * long_u,
                     cy + out_v + s * long_v, "bolt", "SteelDark")
    # (2) the throat: four plates lining the hole, hung off the underside so
    # their tops are buried in the table and only the lining shows.
    for sy in (-1.0, 1.0):
        mb.box((2 * HOLE - 0.10, 0.09, 0.62), (0.0, sy * (HOLE - 0.045),
                                               MT_UNDER - 0.19), "Soot")
    for sx in (-1.0, 1.0):
        mb.box((0.09, 2 * HOLE - 0.28, 0.62), (sx * (HOLE - 0.045), 0.0,
                                               MT_UNDER - 0.19), "Soot")
    # (3) the walking plates, outboard of the curb's own outer corner.
    for sy in (-1.0, 1.0):
        mf.bolted_plate(mb, top, 0.0, sy * 2.56, 4.20, 1.24,
                        "SteelWorn", "SteelDark", inset=0.16, size=0.085)
    # (4) the gussets.
    for sy in (-1.0, 1.0):
        side = _mount_side(sy)
        for u in (-2.30, 0.0, 2.30):
            side.wedge(mb, u, 0.10, DECK_Z - 0.10, 0.34, 0.42, "bracket",
                       "Steel")
    return mb


def trench_services(mb):
    """A flame trench with nothing in it is a ditch.

    A DELUGE HEADER AND A WAY OUT, which are the two things a real trench has
    that a channel does not, and both of them are answers to questions the
    asset already raises and did not answer. The header is why the trench
    survives being fired into; the ladder is how the person who is obviously
    meant to work down here (there is a lit, lined, 1.70 m deep room under the
    deck) gets back up. It is also the only ladder on the asset: the stair in
    the north-east notch reaches the DECK, not the trench floor.

    THE HEADER IS IN FOUR SEGMENTS AND NOT TWO RUNS, AND THE INTERRUPTIONS ARE
    THE GEOMETRY'S AND NOT A COMPOSITION'S. There is no room for a pipe over
    the middle of this trench: the deflector's plinth is 7.40 m wide against a
    7.20 m channel, so it is buried IN both walls, and its wedge reaches
    x = +/-3.50 against a liner face at +/-3.38 for the whole of y = -4.60 to
    +4.60. A wall-hugging pipe through that span would be inside the
    deflector. So the header runs in the two clear zones OUTBOARD of the
    deflector on each wall, which is where a real deluge ring is anyway - the
    nozzles surround the impingement zone rather than sitting in it - and the
    west wall's north segment stops 700 mm short of the rest of its run
    because the ladder is there. Pipework routes around access.

    THE LADDER IS ON THE WEST WALL AT THE NORTH END, which is the one place it
    fits. The east wall's deck above it stops at STAIR_S, the deflector
    occupies +/-4.90 of the middle and the launch table roofs +/-3.40, so the
    clear run of lined wall is y = 4.90 to 11.90 on either side; the west is
    chosen because the east bank's own stair is already at the north end and
    putting both routes in one corner is what a real site does."""
    LADDER_Y, HZ = 8.30, 1.14
    for sx in (-1.0, 1.0):
        # 0.30 in from the wall, so the pipe's outer 20 mm is buried in the
        # liner at |x| = 3.38: a pipe clipped to a wall, and 20 mm of daylight
        # between the two planes rather than none.
        hx = sx * (TR_HW - 0.30)
        north_end = 7.60 if sx < 0 else 10.60      # the ladder, on the west
        for (y0, y1) in ((-10.60, -4.90), (4.90, north_end)):
            mb.box((0.20, y1 - y0, 0.20), (hx, (y0 + y1) * 0.5, HZ), "Steel")
        # The riser that feeds both segments, climbing out of the trench floor
        # at the south end where the cable run already comes down. IT STANDS
        # ON THE FLOOR SLAB, not through it: run to z = 0 it got a bottom face
        # on the ground plane facing down, and so has the floor slab, in two
        # materials over the riser's whole section (4 same-facing pairs). The
        # floor is 0.30 m of concrete and a pipe stands on it.
        mb.box((0.24, 0.24, HZ + 0.22 - TR_FLOOR),
               (hx, -10.42, (TR_FLOOR + HZ + 0.22) * 0.5), "Steel")
        for y in (-9.20, -5.60, 5.60, 6.90):
            mb.box((0.13, 0.13, 0.26), (hx, y, HZ - 0.23), "SteelDark")
    # The caged ladder out. machine_form's own greeble, on a face that looks
    # into a recess, which is the one case its `limit=None` is documented for.
    wall = mf.Face("X", 1, -(TR_HW - 0.22), name="trench west wall")
    mf.ladder(mb, wall, LADDER_Y, TR_FLOOR + 0.18, DECK_Z, 0.46, 7, "Steel")
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
    # Recessed 0.05 from the tip block's own outboard face. Both used to be
    # written `UMB_X - half of my own size`, which cancels exactly: two solids
    # anchored to the same published socket coordinate, ending on one plane
    # (4 pairs). The trim is a fitting ON the tip block, so it stops short of
    # it; UMB_X stays where socket_umbilical publishes it.
    for sy in (-1.0, 1.0):
        mb.box((0.30, 0.22, 0.22), (UMB_X - 0.20, ty + sy * 0.28, ARM_Z),
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
    for sx, y1 in ((-1.0, HALF - INSET - PAINT_MARGIN),
                   (1.0, STAIR_S - PAINT_MARGIN)):
        y0 = -HALF + INSET + PAINT_MARGIN
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


# ---------------------------------------------------------------------------
# RN-1690: the deck stops being a slab
# ---------------------------------------------------------------------------

# The two cap rectangles, as (x0, x1, y0, y1), derived from the SAME three
# constants `ground()` derives them from rather than transcribed. The whole
# deck detail below reads this one function, so a cap that moves moves its
# joints, its kerb, its anchors and its scorch with it.
def cap_bays():
    for sx, y1 in ((-1.0, HALF - INSET), (1.0, STAIR_S)):
        x_out = sx * (HALF - INSET)
        x_in = sx * TR_HW
        yield (min(x_out, x_in), max(x_out, x_in), -HALF + INSET, y1, sx)


def deck_joints(mb):
    """A 24 m deck was not poured in one go, and this is what says so.

    THE JOINT IS THE SEALANT BEAD AND NOT THE GROOVE, for `Face.coaming`'s
    reason one level up: nothing in this project cuts geometry, so a recessed
    joint is a box inside a solid and is invisible. What a real construction
    joint actually shows above the surface is the bead standing 20 to 30 mm
    proud of the two slabs it separates, which is a thing that can be added,
    is honest, and reads at 40 m because it is a hard dark line across the
    single largest light surface in the game.

    BAY IS THE WEST CAP'S OWN LENGTH IN FIVE AND NOT A CHOSEN PITCH. 23.30 m
    of Y divided five ways is 4.6625, and the east cap takes the same pitch
    from the same south end so the two banks' joints LINE UP across the
    trench, which is what a pour sequence produces and what an eye reading the
    deck as one structure needs. The east cap's own length is 20.85, so it
    simply gets one bay fewer; deriving a second pitch from it would put eight
    joints on a deck at two spacings, which reads as a mistake."""
    zc = DECK_Z + (JOINT_UP - JOINT_DOWN) * 0.5
    for (x0, x1, y0, y1, sx) in cap_bays():
        # THE BEAD RUNS BETWEEN THE TWO RAIL LINES AND NOT WALL TO WALL, and
        # this is not tidiness, it is the coplanar rule arriving from an angle
        # nothing else on the asset has hit. `guard_rails` puts posts on the
        # trench lip at |x| = 3.72 and on the perimeter at |x| = 11.65, and
        # `rail_run` derives its post COUNT from the run's length over a
        # spacing - so the west lip's six posts land on 23.30 / 5 = 4.66,
        # which is BAY exactly, because both numbers are the same 23.30 m
        # divided by the same 5. Two unrelated details, dimensioned off one
        # landmark, arriving independently on one plane: the catalogued root
        # cause, in its purest form yet (measured: 4 same-facing pairs at
        # y = -2.38, a post's face and a bead's face).
        #
        # The pitch is NOT what moves. A pour bay is a pour bay and a rail
        # post pitch is a rail post pitch, and nudging either to dodge the
        # other is the hand-tuning this file's other notes warn about. What
        # moves is the bead's LENGTH: it stops 180 mm clear of each rail line,
        # so the two faces still share a plane and have no overlapping area on
        # it. A bead interrupted by a railing base is also what a real one is.
        jx0 = min(abs(x0), abs(x1)) + 0.30      # clear of the lip rail
        jx1 = max(abs(x0), abs(x1)) - 0.25      # clear of the perimeter rail
        k = 1
        while -HALF + INSET + BAY * k < y1 - 0.6:
            y = -HALF + INSET + BAY * k
            mb.box((jx1 - jx0, JOINT_W, JOINT_UP + JOINT_DOWN),
                   (sx * (jx0 + jx1) * 0.5, y, zc), "ConcreteDark")
            k += 1
        # ...and one longitudinal joint per bank, halving its 8.05 m width.
        # It runs the bank's full length less PAINT_MARGIN at each end, for
        # `striping()`'s exact reason: a bead run to the cut line lands its
        # end face on the concrete's end face, same-facing, over its full
        # section.
        mb.box((JOINT_W, y1 - y0 - 2.0 * PAINT_MARGIN, JOINT_UP + JOINT_DOWN),
               ((x0 + x1) * 0.5, (y0 + y1) * 0.5, zc), "ConcreteDark")
    return mb


def deck_kerb(mb):
    """A steel edge angle capping the concrete's exposed arris.

    THE BEST SIX BOXES ON THE DECK. A poured edge spalls, so every real deck
    has a steel angle bolted along it; and because the angle is the ONE bright
    fabricated line running the whole outline of a 24 m grey mass, it is also
    what draws the pad's plan shape from any distance. `guard_rails` breaks the
    outline vertically and this closes it horizontally.

    IT OVERHANGS THE ARRIS BY 48 mm rather than sitting flush on it, which is
    what a bolted-on angle does (the vertical leg has to clear the concrete to
    be bolted through it) and is also why it cannot make a coplanar pair: its
    outer plane is 48 mm outboard of the cap face and its underside 30 mm
    below the cap top, so it shares a plane with nothing. The 48 mm is spent
    OUTWARD into the 350 mm of ledge the cap's INSET already leaves, so the
    footprint does not move.

    THAT ARGUMENT IS ABOUT THE FACE THE ANGLE CAPS AND SAYS NOTHING ABOUT ITS
    ENDS, which is where the first version put twenty of its twenty-one
    same-facing pairs. The long outboard run was drawn `y1 - y0` long, so its
    two end faces landed exactly on the cap's own end faces at +/-11.65 and
    9.20; and each end run was drawn `x1 - x0 - KERB` long off the bank's
    centre, so its inboard face landed exactly on the cap's trench face at
    |x| = 3.60. Both are the same mistake as the bead's and neither shows up
    in a paragraph about the outer plane. Every run now OVERSHOOTS its corner
    by the same `over` it overhangs by - the four boxes are one role, so the
    overlap at the corner is invisible by construction - and the end runs stop
    a full kerb width short of the trench lip, which is where the guard rail
    already is."""
    over, drop = 0.048, 0.030
    h = KERB_UP + drop
    zc = DECK_Z + (KERB_UP - drop) * 0.5
    for (x0, x1, y0, y1, sx) in cap_bays():
        x_out = x1 if sx > 0 else x0
        # The long outboard run, down the whole bank and out past both corners.
        mb.box((KERB, y1 - y0 + 2.0 * over, h),
               (x_out + sx * (over - KERB * 0.5), (y0 + y1) * 0.5, zc),
               "Steel")
        # The two end runs, from the outboard run's own outer plane inboard to
        # a kerb width short of the trench lip.
        e0 = x_out + sx * over
        e1 = (x1 if sx < 0 else x0) - sx * KERB
        for (y_end, sy) in ((y0, -1.0), (y1, 1.0)):
            mb.box((abs(e1 - e0), KERB, h),
                   ((e0 + e1) * 0.5, y_end + sy * (over - KERB * 0.5), zc),
                   "Steel")
    return mb


def deck_anchors(mb):
    """Tie-down pockets: a bolted pad a crane or a hold-down strop shackles to.

    Four of them, one per quadrant of the two banks, which is where a load
    being lifted onto the deck would actually be secured. They are 1.10 m
    across on purpose - the deck detail scale note at the top of this file is
    the whole argument, and a `machine_form` boss at 0.30 m would be a pebble
    on a 23 m bay."""
    pad, bz = 1.10, DECK_Z + (ANCHOR_UP - 0.018) * 0.5
    for (x, y) in ((-8.60, -8.20), (-8.60, 6.40), (6.60, -6.20), (6.60, 6.40)):
        mb.box((pad, pad, ANCHOR_UP + 0.018), (x, y, bz), "SteelDark")
        # A shackle eye standing on the pad, and two bolts through it. The
        # bolts sit on the PAD's own top plane facing up while the pad's top
        # faces up too - opposite is what would matter, and these are stacked
        # solids in two roles whose shared plane has the bolt's own footprint
        # only, so they are placed 6 mm proud of it instead.
        mb.box((0.26, 0.44, 0.34), (x, y, DECK_Z + ANCHOR_UP + 0.17), "Steel")
        # ONE PIN THROUGH THE EYE, not two bolt heads either side of it. The
        # heads were drawn as separate 0.16 m cubes floating at x +/- 0.38 with
        # nothing between them, which is not what a shackle is (the pin is the
        # part that carries the load and it is continuous), and the shadow
        # trace priced the difference: a pair of small solids inside a proxy
        # needs its own hugging box, a bar through the eye is the same box.
        mb.box((0.92, 0.16, 0.16), (x, y, DECK_Z + ANCHOR_UP + 0.09), "Steel")
    return mb


def scorch(mb):
    """Soot on the concrete, where the plume actually reaches it.

    TWO BOXES PER MARK ON TWO HEIGHTS, which is RN-1543's rule and the reason
    it is a rule: one rectangle of a second colour on a flat deck reads as
    SIGNAGE - a painted bay marking - and no amount of choosing a duller
    colour fixes it, because the thing that says 'paint' is the single hard
    outline. A main patch with a smaller one lying across its edge at a
    different height has a broken outline and reads as deposit.

    WHERE, AND IT IS NOT A COMPOSITION CHOICE. `socket_smoke` is published on
    the deflector ridge and the exhaust leaves `socket_vessel` straight down
    the flame hole, so the plume's own path is: down the 3.00 m hole, onto the
    ridge, split to +/-Y, and out of the two trench mouths. The marks are on
    the deck immediately outboard of the two trench LIPS, heaviest at the
    mouths where the split flow climbs out, and there are none at all on the
    far side of either bank."""
    # A MARK STARTS AT THE LIP AND DOES NOT HANG OVER IT. Placed by their
    # CENTRES on a lip offset, the two widest marks reached 254 mm past
    # x = 3.60 into open trench, so a third of each was a painted rectangle
    # floating over a 1.70 m drop. Placed by their INNER EDGE instead, the
    # width is free to vary without any of them leaving the concrete, which
    # is what the deviating widths were for.
    #
    # RN-1815: `ConcreteSoot`, and the role is the point rather than a rename.
    # These marks were `MasonryDark` - a WEATHERED ROCK grey at 11 counts of
    # chroma and luma 83, sitting on a deck of the same family at luma 117 -
    # so a deposit of carbon was drawn as a slightly darker patch of the same
    # stone, which is the "one rectangle of a second colour" failure this
    # docstring's own first paragraph is about, in the colour channel rather
    # than in the outline. `ConcreteSoot` is luma 50.4 at 7 counts of chroma
    # against `Concrete`'s 133.8: the mark is now dark and neutral against a
    # light neutral deck, which is what soot on concrete looks like, and it
    # reads as the OUTER, thinnest end of the same gradient the trench floor
    # and the liner carry - these marks are outboard of the lips, the furthest
    # the plume gets from the hole.
    for sx in (-1.0, 1.0):
        y_lim = HALF - INSET if sx < 0 else STAIR_S
        for (y, du, dv) in ((-y_lim + 2.10, 2.30, 4.40),
                            (0.0, 1.60, 3.00),
                            (y_lim - 2.40, 2.10, 4.00)):
            inner = sx * (TR_HW + 0.06)
            mb.box((du, dv, SCORCH_UP + 0.010),
                   (inner + sx * du * 0.5, y,
                    DECK_Z + (SCORCH_UP - 0.010) * 0.5), "ConcreteSoot")
            mb.box((du * 0.55, dv * 0.42, SOOT_UP + 0.007),
                   (inner + sx * du * 0.82, y + dv * 0.24,
                    DECK_Z + (SOOT_UP - 0.007) * 0.5), "ConcreteSoot")
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


def stair_treads():
    """The eight treads, as (size, loc) pairs in the pad's own frame.

    ONE generator, read by both the drawn geometry in `stair()` and the
    `col_LaunchStep*` proxies in `main()`. That is the whole point of it being a
    function: the stairs shipped drawn-but-not-proxied for as long as the two
    were written out separately, and the cheapest guarantee that a re-author
    moves the collision with the mesh is that there is only one loop."""
    for i in range(STEPS):
        top = RISER * (i + 1)
        y = STAIR_N - TREAD * (i + 0.5)
        yield (STAIR_W, TREAD, top), (STAIR_X, y, top * 0.5)


def stair(mb, detail=True):
    """Eight steps from the ground to the deck in the north-east notch. The
    only route up that a player on foot can take, and the second scale cue
    after the rails: a 0.25 m riser is a riser at any distance."""
    for size, loc in stair_treads():
        mb.box(size, loc, "ConcreteDark")
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
    # THE TANK STANDS IN ITS SKIRT, NOT ON THE DECK (RN-441). It used to be
    # 4.20 tall centred at DECK_Z + 2.10, so its bottom was DECK_Z; the skirt
    # ring is 0.36 centred at DECK_Z + 0.18, so its bottom is DECK_Z too. Two
    # concentric 12-gons, the 1.50 nested entirely inside the 1.58, both
    # bottom-capped by of_lib.cylinder, both facing down, in two materials:
    # 25 same-facing pairs and the single largest group on this asset. Neither
    # number was wrong; they were both derived from DECK_Z when only ONE of
    # them is standing on the deck. The tank is now seated 0.12 m INSIDE the
    # skirt, which is what a skirt is for, and its top is unmoved so the dome
    # above it does not have to move either.
    mb.cylinder(1.50, 4.08, (tx, ty, DECK_Z + 2.16), segments=12, role="Steel")
    mb.cylinder(1.58, 0.36, (tx, ty, DECK_Z + 0.18), segments=12,
                role="SteelDark")
    mb.frustum(1.50, 0.42, 0.90, (tx, ty, DECK_Z + 4.65), segments=12,
               role="Steel")
    # Control bunker, with the standard four-colour state chip for a window.
    bx, by = 8.40, -8.00
    mb.box((4.00, 2.60, 1.70), (bx, by, DECK_Z + 0.85), "Concrete")
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
# RN-1690: the T-0 umbilical mast, and the cable network that goes somewhere
# ---------------------------------------------------------------------------

def t0_mast(mb):
    """The mast that FUELS the rocket, which nothing on this pad did.

    THE BIGGEST SINGLE GAP IN THE ASSET AND IT WAS A STORY GAP BEFORE IT WAS
    AN ART ONE. There is a 3.00 m propellant tank on the east bank and a
    vehicle on the mount, and until now the two were not connected by
    anything: the swing arm at 13.60 m is a CREW access arm serving the upper
    stage, 11 m above the tank it would have to be fed from. Every pad in the
    world has a second, short mast at the base of the vehicle carrying the
    propellant and electrical umbilicals that drop away at T-0, and that mast
    is what the tank, the deluge header and the cable run are all FOR.

    IT IS PLACED BY THE SAME ARITHMETIC AS THE SWING ARM AND NOT BY EYE. It
    stands on the +X axis (`T0`), so its boom runs straight in along -X to
    `T0_TIP` = HULL_R + 0.06, the same 50-to-60 mm standoff `UMB_X` publishes
    at the other end; and it stands 1.05 m clear of the launch table's own
    east edge, so it is on the east CAP and not on the table. It passes OVER
    the +X clamp, whose head is at 2.00 + CLAMP_H = 4.40 against a boom at
    5.90, which is what a real T-0 arm does and is why the head is at the
    height it is: `T0_ARM_Z` is level with a class L vehicle's tank base, so
    the umbilicals go where propellant goes.

    IT IS SHORTER THAN THE STACK IT SERVES, on purpose. The three lightning
    masts already learned this the expensive way (see `furniture`): a vertical
    that crosses the vehicle in the hero frame competes with it. At 5.40 m
    above the deck this one stops below the vehicle's shoulder and reads as
    part of the ground equipment, which is what it is."""
    tx, ty = T0
    base_h = 0.34
    mb.box((T0_HW + 0.42, T0_HW + 0.42, base_h), (tx, ty, DECK_Z + base_h * 0.5),
           "SteelDark")
    # THE MAST STANDS IN ITS BASE AND NOT THROUGH IT, which is RN-441's tank
    # skirt again on a different part. Written the obvious way - a mast from
    # DECK_Z to DECK_Z + T0_H sitting on a base plinth from DECK_Z up - both
    # solids get a bottom face on z = 2.00 facing down, one Steel and one
    # SteelDark, and the mast's whole 0.30 x 0.30 footprint is inside the
    # base's, so the overlap is total (measured: 2 same-facing pairs). Only
    # ONE of the two is standing on the deck. The mast is seated 0.16 m inside
    # the plinth and its crown is unmoved, so T0_H still means what it says.
    z0 = DECK_Z + base_h - 0.16
    mb.box((T0_HW, T0_HW, DECK_Z + T0_H - z0), (tx, ty,
                                                (z0 + DECK_Z + T0_H) * 0.5),
           "Steel")
    # A hazard band at knee height: this is a thing on a deck people walk on.
    mb.box((T0_HW + 0.07, T0_HW + 0.07, 0.22), (tx, ty, DECK_Z + 0.62),
           "Hazard")
    # Bolted base flange. `bolt_circle` on Z rather than machine_form's `bolts`
    # on a Face because a mast's holding-down bolts are on a circle around it,
    # not in a grid on one side of it, and the four heads are a single role.
    mf.bolt_circle(mb, (tx, ty, DECK_Z + base_h + 0.045), 0.31, 4, 0.11, "Z",
                   "Steel", phase_deg=45.0, depth=0.09)

    # A ladder up the OUTBOARD (+X) face, which is the side away from the
    # vehicle and therefore the side somebody could actually stand on.
    east = mf.Face("X", 1, tx + T0_HW * 0.5, limit=HALF, name="T-0 mast +X")
    mf.ladder(mb, east, ty, DECK_Z + 0.95, DECK_Z + T0_H - 0.55, 0.34, 5,
              "Steel")
    # ...and a cable tray up the -Y face, feeding the head.
    south = mf.Face("Y", -1, ty - T0_HW * 0.5, limit=-HALF, name="T-0 mast -Y")
    mf.tray(mb, south, tx, DECK_Z + 0.30, T0_ARM_Z - 0.25, 0.19, 3,
            "SteelDark", "Steel")

    # The head: a hinge block on the mast, a boom reaching in, and the plate
    # that meets the vehicle. Its outboard end stops 0.05 m short of the mast
    # face it hangs off, so the two do not share the plane x = tx - T0_HW/2.
    x_hinge = tx - T0_HW * 0.5 - 0.05
    mb.box((0.40, 0.52, 0.62), (x_hinge - 0.20, ty, T0_ARM_Z), "SteelDark")
    boom_x0 = x_hinge - 0.40
    # THE BOOM STOPS 100 mm SHORT OF THE PLATE IT CARRIES. `T0_TIP` is the
    # published reach and the plate is the thing that reaches it, so writing
    # the boom to `T0_TIP` too put two solids in two materials on one plane at
    # x = 1.31 with the boom's whole section overlapping (4 same-facing
    # pairs). This is the swing arm's own recorded defect at the other end of
    # the pad - `UMB_X - half of my own size` on both the tip block and its
    # trim - and it takes the same fix: the fitting is ON the boom, so the
    # boom ends inside it.
    boom_x1 = T0_TIP + 0.10
    mb.box((boom_x0 - boom_x1, 0.30, 0.28), ((boom_x0 + boom_x1) * 0.5, ty,
                                             T0_ARM_Z), "SteelDark")
    mb.box((0.26, 0.62, 0.74), (T0_TIP + 0.13, ty, T0_ARM_Z), "Accent")
    # THE HOSE IS WHAT MAKES IT AN UMBILICAL. A rigid duct cannot cross a
    # joint that moves and this arm's whole job is to move at T-0, which is
    # machine_form.hose's own argument, made here by the one part in the game
    # that literally is an umbilical. It slacks DOWN between the mast and the
    # boom rather than running along it, because that is where the service
    # loop of a hose that has to swing away has to be.
    mf.hose(mb, [(tx - T0_HW * 0.5 - 0.10, ty - 0.30, T0_ARM_Z - 0.30),
                 (tx - T0_HW * 0.5 - 0.10, ty - 0.30, T0_ARM_Z - 1.05),
                 (boom_x0 - 0.55, ty - 0.30, T0_ARM_Z - 1.05),
                 (boom_x0 - 0.55, ty - 0.30, T0_ARM_Z - 0.34)],
            0.15, "Rubber", clamp_role="SteelDark")
    return mb


def cable_network(mb):
    """The west bank's cable run went 15 m and stopped, which is a prop.

    Three additions and every one of them is a TERMINATION: a run that ends in
    mid-air is scenery, and a run that ends in a junction box on the thing it
    powers is infrastructure. The tower gets a 20 m tray up the lift shaft
    (the one face on this asset tall enough for the vocabulary's `tray` to be
    a tray rather than a second leg - `machine_form`'s power-pole refusal, and
    a 1.70 m shaft passes it where a 0.32 m leg does not); the tower base gets
    the junction box the deck run feeds; and the east bank gets its own run,
    because the tank, the T-0 mast and the bunker are all over there and none
    of them was connected to anything."""
    tx, ty = TOWER
    # Deck run -> tower base. It stops on the lift shaft, not at the leg.
    mb.box((2.05, 0.44, 0.30), (-9.60, -1.00, DECK_Z + 0.15), "SteelDark")
    # The tray up the lift shaft's +Y face, which is the face with no door on
    # it. The shaft is 1.70 square centred on TOWER, so its +Y plane is at
    # ty + 0.85. Face Y: u = world X, v = world Z.
    shaft = mf.Face("Y", 1, ty + 0.85, limit=HALF, name="lift shaft +Y")
    mf.tray(mb, shaft, tx - 0.42, TOWER_BASE + 0.90, TOWER_BASE + 21.30,
            0.22, 6, "SteelDark", "Steel")
    mf.junction(mb, shaft, tx + 0.44, TOWER_BASE + 1.30, 0.62, 0.78,
                "SteelDark", "Steel")
    # East bank run: bunker -> T-0 mast, passing the tank's skirt.
    mb.box((0.46, 7.40, 0.30), (5.90, -4.60, DECK_Z + 0.15), "SteelDark")
    mb.box((0.13, 7.40, 0.14), (5.90, -4.60, DECK_Z + 0.37), "Accent")
    # THE BUNKER BRANCH CLIMBS AND ENTERS THE WALL; it does not run under the
    # building. Drawn as one deck-level tray from the run to the bunker it
    # passed BENEATH the bunker's own footprint, and the bunker's underside is
    # a Rock face on z = 2.00 facing down while the tray's underside is a
    # SteelDark face on z = 2.00 facing down: same plane, same facing, two
    # materials, over 1.75 x 0.46 m of it (3 same-facing pairs, and the last
    # three on the asset). Nothing is wrong with either number - a tray sits
    # on the deck and a building sits on the deck - so neither moves; the run
    # goes UP instead, which is where a cable entering a wall goes anyway.
    mb.box((0.40, 0.40, 0.72), (6.00, -8.00, DECK_Z + 0.36), "SteelDark")
    mb.box((0.70, 0.34, 0.28), (6.40, -8.00, DECK_Z + 0.58), "SteelDark")
    return mb


# ---------------------------------------------------------------------------
# RN-1690: the shadow-proxy tier, RN-1623's method
# ---------------------------------------------------------------------------

def shadow_proxies(mb):
    """Every LOD0 feature standing over one shadow texel proud of what LOD1
    already has, blocked in at its MEASURED envelope.

    THE PAD WAS THE WORST ASSET IN THE GAME ON THIS NUMBER AND NOBODY HAD
    LOOKED. `check_shadow_lod` measured LOD1 at 14090.06 mm and LOD2 at
    14100.00 mm against a cascade-2 texel of 210.94 mm, so BOTH coarse tiers
    were refused by every cascade and all three cascades plus the camera drew
    LOD0: the full 4.0x marginal multiplier, the only asset in the project at
    it. The single number causing it is not subtle - LOD1 dropped
    `furniture()` entirely, and `furniture()` is where the three 15.9 m
    lightning masts are, so LOD0 had vertices 14 m from anything LOD1 owned.

    WHY THIS IS WORTH MORE THAN THE FORM PASS COSTS, and it is the whole
    argument for the budget raise in contracts.json. Un-fixed, this pass takes
    the pad from 4 x 2564 = 10,256 drawn triangles to 4 x 4304 = 17,216, a 68
    per cent rise. Fixed, cascades 1 and 2 draw a 1,200-triangle tier instead
    of a 4,304-triangle one and the total is 2 x 4304 + 2 x 1200 = 11,008: the
    same 68 per cent more geometry for 7 per cent more frame. The shadow work
    is what buys the form pass, not the other way round.

    MEASURED, NOT GUESSED. `of_lib.MeshBuilder._add` was instrumented to
    record the source line and exact vertex bounds of every primitive LOD0
    adds, and each was scored against this tier's own surface with
    `check_shadow_lod.deviation` - the client's asymmetric nearest-surface
    metric, offline, on the same geometry. Every box below is one of those
    measured envelopes. Nothing here is drawn to be seen: this tier is never
    painted (RN-561), so a box's role is chosen to match whatever it is
    standing on and avoid a coplanar pair, not to look like anything."""
    # -- the five masts, which are the entire 14 m and are what LOD1 never had
    for x, y in ((-10.90, 10.90), (10.90, 7.60), (10.90, -10.60)):
        mb.box((0.80, 0.80, 0.50), (x, y, DECK_Z + 0.25), "SteelDark")
        mb.box((0.42, 0.42, 11.00), (x, y, DECK_Z + 6.00), "Steel")
        mb.box((0.18, 0.18, 2.60), (x, y, DECK_Z + 12.80), "Steel")
    for x, y in ((-11.00, -10.60), (11.00, -11.40)):
        mb.box((0.26, 0.26, 6.40), (x, y, DECK_Z + 3.20), "Steel")
        mb.box((1.10, 0.50, 0.52), (x, y, DECK_Z + 6.66), "SteelDark")
        mb.box((0.96, 0.14, 0.40), (x, y - 0.26, DECK_Z + 6.66), "SteelDark")
    # -- the propellant tank, AS CYLINDERS AND NOT AS A BOX, and this is the
    # one place on the asset where the metric forces the primitive. A box
    # sized to a 12-gon's diameter leaves its 30-degree vertices 201 mm from
    # the nearest face, and shrinking the box to split the error only reaches
    # 100 mm: (1.500 - 1.299) / 2 is the best a square can do around a
    # dodecagon of radius 1.50, and cascade 1 wants 56.25. The tank's own
    # rings, reproduced at their own radii, are 0.00 mm by construction and
    # cost 44 triangles each - which is why the dome is here as a frustum
    # rather than being approximated by the cylinder under it.
    mb.cylinder(1.58, 0.36, (8.60, 3.60, DECK_Z + 0.18), segments=12,
                role="SteelDark")
    mb.cylinder(1.50, 4.08, (8.60, 3.60, DECK_Z + 2.16), segments=12,
                role="Steel")
    mb.frustum(1.50, 0.42, 0.90, (8.60, 3.60, DECK_Z + 4.65), segments=12,
               role="Steel")
    # -- the control bunker: its parapet is 0.15 m wider than its walls, so
    # one box on the parapet buries the wall corners by 150 mm and one on the
    # walls leaves the parapet 150 mm out. Two boxes, each hugging its own.
    mb.box((4.00, 2.60, 1.70), (8.40, -8.00, DECK_Z + 0.85), "Concrete")
    mb.box((4.30, 2.90, 0.20), (8.40, -8.00, DECK_Z + 1.80), "SteelDark")
    mb.box((4.05, 0.12, 0.14), (8.40, -9.40, DECK_Z + 1.56), "Accent")
    mb.box((3.20, 0.10, 0.55), (8.40, -9.33, DECK_Z + 1.10), "Accent")
    # -- the tower: lift shaft, door, the diagonals, the two service platforms
    # and their rails, the crown ring. None of these are in tower(detail=False).
    tx, ty = TOWER
    mb.box((1.70, 1.70, 21.60), (tx, ty, TOWER_BASE + 11.30), "SteelDark")
    mb.box((1.14, 0.14, 2.26), (tx, ty - 0.90, TOWER_BASE + 1.13), "SteelDark")
    for z in (BAYS[3], BAYS[7]):
        mb.box((3.20, 3.60, 0.18), (tx + 1.60, ty, z + 0.09), "Steel")
        mb.box((3.20, 3.76, 0.14), (tx + 1.60, ty, z + 1.28), "Steel")
    # The diagonals zig-zag corner to corner inside each 2.60 m bay on the two
    # Y faces, so their envelope IS the face: one slab per face, 150 mm thick
    # because the strut is 140.
    # FOUR FACE SLABS, WHICH COVER THE DIAGONALS AND THE MISSING TIE LEVELS
    # IN ONE. LOD1's own `tower(detail=False)` ties every OTHER bay
    # (`BAYS[2:-1:2]` against LOD0's `BAYS[1:-1]`), so five whole levels of
    # tie were absent and measured 80 mm; the diagonals were absent entirely.
    # Both live in the same four planes - the tower's own faces - so one slab
    # per face at the tie's own 160 mm section is 48 triangles against the 264
    # that reproducing nine tie levels and twenty struts would cost.
    #
    # THEY TAKE THE TIES' ROLE AND NOT THE LEGS', which is a coplanar
    # decision and not a look one (this tier is never painted). A slab in the
    # tie's own plane at the tie's own 160 mm section shares BOTH of its faces
    # with every tie it stands in for, and its ends land on the X-running
    # ties' end faces as well: 128 same-facing pairs when the slabs were
    # `Steel` against `SteelDark` ties. Matching the role makes every one of
    # them a same-material overlap, which check_coplanar skips by
    # construction. They also stop 100 mm short of the tower's ends so they do
    # not land on the legs' own end planes.
    for sy in (-1.0, 1.0):
        mb.box((2 * TL, 0.16, H - TOWER_BASE - 0.20),
               (tx, ty + sy * TL, (TOWER_BASE + H) * 0.5), "SteelDark")
        mb.box((0.16, 2 * TL, H - TOWER_BASE - 0.20),
               (tx + sy * TL, ty, (TOWER_BASE + H) * 0.5), "SteelDark")
    mb.box((4.60, 4.60, 0.20), (tx, ty, H - 1.40), "Steel")
    mb.box((0.36, 0.36, 0.30), (tx, ty, H - 0.45), "SteelDark")
    # EVERY RAILING GETS A RAILING-SHAPED PROXY AND NOT A BLOCK, and the crown
    # is the measurement that made the rule. A 4.72 m block containing the two
    # crown runs whole still scored their posts at 100.00 mm: the metric is
    # distance to the nearest SURFACE, so the corner of a 0.10 m post sitting
    # 0.10 m in from a big box's inboard face is 0.10 m from anything, exactly
    # as if it had been left out. Burial is not containment. `_rail_proxy`
    # matches a run's own 0.14 m section, so no vertex is ever more than
    # 30 mm from a face whatever the run's length.
    for sy in (-1.0, 1.0):
        _rail_proxy(mb, (tx - 2.30, ty + sy * 2.30), (tx + 2.30, ty + sy * 2.30),
                    z0=H - 1.30)
    for z in (BAYS[3], BAYS[7]):
        _rail_proxy(mb, (tx + 3.20, ty - 1.80), (tx + 3.20, ty + 1.80),
                    z0=z + 0.18)
    # -- the umbilical swing arm's walkway, rails and service duct
    x0 = tx + TL + 0.16
    boom_x1 = UMB_X - 0.44
    mb.box((boom_x1 - x0, 1.04, 0.14), ((x0 + boom_x1) * 0.5, ty,
                                        ARM_Z + 0.30), "Steel")
    for sy in (-1.0, 1.0):
        _rail_proxy(mb, (x0, ty + sy * 0.48), (boom_x1, ty + sy * 0.48),
                    z0=ARM_Z + 0.33)
    mb.box((boom_x1 - x0 - 0.4, 0.24, 0.24), ((x0 + boom_x1) * 0.5, ty + 0.40,
                                              ARM_Z - 0.30), "Accent")
    mb.box((0.44, 0.90, 0.80), (UMB_X - 0.22, ty, ARM_Z), "SteelDark")
    mb.box((0.30, 0.78, 0.22), (UMB_X - 0.20, ty, ARM_Z), "Accent")
    # -- the T-0 mast: the mast, the ladder on its +X face, the tray on its
    # -Y face, the head, the boom and the umbilical hose. SEVEN BOXES AND NOT
    # ONE FAT ONE, because the metric is distance to the nearest SURFACE and a
    # vertex buried deep inside an oversized proxy scores exactly as badly as
    # one left outside it: a single 0.62 m box around the 0.30 m mast put the
    # ladder stringers 167 mm from anything. Every box here hugs one feature.
    t0x, t0y = T0
    mb.box((T0_HW + 0.42, T0_HW + 0.42, 0.34), (t0x, t0y, DECK_Z + 0.17),
           "SteelDark")
    # Seated 0.18 m inside its plinth, exactly as the drawn mast is: run to
    # the deck it repeats LOD0's own same-facing pair (a Steel bottom face
    # inside a SteelDark one, both on z = 2.00) in the proxy tier.
    mb.box((T0_HW + 0.10, T0_HW + 0.10, T0_H - 0.18),
           (t0x, t0y, DECK_Z + 0.18 + (T0_H - 0.18) * 0.5), "Steel")
    mb.box((0.24, 0.40, 4.34), (4.8313, t0y, DECK_Z + 3.12), "Steel")
    mb.box((0.32, 0.20, 3.35), (t0x, t0y - 0.22, DECK_Z + 1.975), "SteelDark")
    mb.box((0.40, 0.52, 0.62), (t0x - 0.40, t0y, T0_ARM_Z), "SteelDark")
    mb.box((t0x - 0.60 - T0_TIP - 0.10, 0.34, 0.32),
           ((t0x - 0.60 + T0_TIP + 0.10) * 0.5, t0y, T0_ARM_Z), "SteelDark")
    mb.box((0.26, 0.62, 0.74), (T0_TIP + 0.13, t0y, T0_ARM_Z), "Accent")
    mb.box((1.16, 0.18, 1.00), (3.98, t0y - 0.30, T0_ARM_Z - 0.675), "Rubber")
    mb.box((0.60, 0.60, 0.10), (t0x, t0y, DECK_Z + 0.385), "Steel")
    # -- the deck: guard rails as a slab per run, the kerb, the anchors
    for sx in (-1.0, 1.0):
        y1 = HALF - INSET if sx < 0 else STAIR_S
        _rail_proxy(mb, (sx * (TR_HW + 0.12), -HALF + INSET),
                    (sx * (TR_HW + 0.12), y1))
    edge = HALF - INSET
    _rail_proxy(mb, (-edge, -edge), (-edge, edge))
    _rail_proxy(mb, (edge, -edge), (edge, STAIR_S))
    for sx in (-1.0, 1.0):
        _rail_proxy(mb, (sx * edge, -edge), (sx * (TR_HW + 0.12), -edge))
    _rail_proxy(mb, (-edge, edge), (-TR_HW - 0.12, edge))
    deck_kerb(mb)
    for (x, y) in ((-8.60, -8.20), (-8.60, 6.40), (6.60, -6.20), (6.60, 6.40)):
        mb.box((1.10, 1.10, 0.06), (x, y, DECK_Z + 0.011), "SteelDark")
        mb.box((0.26, 0.44, 0.34), (x, y, DECK_Z + 0.211), "Steel")
        mb.box((0.92, 0.16, 0.16), (x, y, DECK_Z + 0.131), "Steel")
    # -- the deck cable runs, the tower branch and the east bank run
    mb.box((0.56, 15.00, 0.58), (-10.40, -1.00, DECK_Z + 0.29), "SteelDark")
    mb.box((2.05, 0.44, 0.30), (-9.60, -1.00, DECK_Z + 0.15), "SteelDark")
    mb.box((0.46, 7.40, 0.44), (5.90, -4.60, DECK_Z + 0.22), "SteelDark")
    # Two boxes and not one spanning both, because a single box from the
    # riser to the wall stub has a bottom face on z = 2.00 running UNDER the
    # bunker - which is the same same-facing pair the LOD0 branch was
    # rerouted to avoid, reintroduced by a proxy that merged the two features
    # the reroute split.
    mb.box((0.40, 0.40, 0.72), (6.00, -8.00, DECK_Z + 0.36), "SteelDark")
    mb.box((0.70, 0.34, 0.28), (6.40, -8.00, DECK_Z + 0.58), "SteelDark")
    mb.box((0.30, 0.26, 20.40), (tx - 0.42, ty + 0.96, TOWER_BASE + 11.10),
           "SteelDark")
    # The junction box, plus a thin plate for its four lid bolts alone: the
    # bolts sit interior in all three axes of the body's envelope, which is
    # the case RN-1623 predicted would break a single box and RN-1675 met on
    # the smelter's roof.
    mb.box((0.70, 0.50, 0.86), (tx + 0.44, ty + 0.99, TOWER_BASE + 1.30),
           "SteelDark")
    mb.box((0.58, 0.09, 0.74), (tx + 0.44, ty + 1.14, TOWER_BASE + 1.30),
           "SteelDark")
    # -- the trench: liner, deluge header and its risers, the ladder, the
    # mount girders and gussets, the deflector's splitter cap
    for sx in (-1.0, 1.0):
        mb.box((0.22, W, 1.05), (sx * (TR_HW - 0.11), 0.0, 0.85), "SteelDark")
        mb.box((0.20, 21.20, 0.46), (sx * (TR_HW - 0.30), 0.0, 1.01), "Steel")
        mb.box((0.24, 0.24, 1.06), (sx * (TR_HW - 0.30), -10.42, 0.83),
               "Steel")
        mb.box((0.30, 2 * MT_HY, 0.34), (sx * (MT_HW - 0.20), 0.0,
                                         MT_UNDER - 0.17), "Steel")
    mb.box((0.23, 0.56, 2.10), (-3.3488, 8.30, 1.45), "Steel")
    for sy in (-1.0, 1.0):
        mb.box((2 * (MT_HW - 0.15), 0.30, 0.34), (0.0, sy * (MT_HY - 0.20),
                                                  MT_UNDER - 0.17), "Steel")
        mb.box((4.90, 0.36, 0.46), (0.0, sy * 3.445, DECK_Z - 0.31), "Steel")
    mb.box((6.60, 0.36, 0.20), (0.0, 0.0, DEFL_Z - 0.02), "Steel")
    # -- the launch table's own surface detail: the hazard curb frame, the
    # clamp pads with their bolts, the walking plates, the flame throat
    curb = HOLE + CURB_STANDOFF + 0.075
    mb.box((2 * (curb + 0.075), 2 * (curb + 0.075), 0.10), (0.0, 0.0, DECK_Z),
           "Hazard")
    for i in range(4):
        a = math.radians(90.0 * i)
        cx, cy = CLAMP_R * math.cos(a), CLAMP_R * math.sin(a)
        du, dv = (1.02, 1.94) if i % 2 == 0 else (1.94, 1.02)
        mb.box((du, dv, 0.135), (cx, cy, DECK_Z + 0.0265), "Steel")
    for sy in (-1.0, 1.0):
        mb.box((4.20, 1.24, 0.115), (0.0, sy * 2.56, DECK_Z + 0.0205),
               "SteelDark")
    mb.box((2 * HOLE, 2 * HOLE, 0.62), (0.0, 0.0, MT_UNDER - 0.19),
           "Soot")
    # -- the stair's leaning handrail and its newels. 2.78 x 2.90 IS THE
    # MEASURED ENVELOPE AND NOT run + A MARGIN: the rail is a tilted box, so
    # its Y extent is 2.774 rather than the 2.72 of run, and `run + 0.34`
    # reached y = 12.09 - which put the LOD1 TIER 90 mm outside the asset's
    # own 24 m declared box and cost it its ground pivot. A proxy is inside
    # the contract like anything else.
    run = STEPS * TREAD
    for sx in (-1.0, 1.0):
        mb.box((0.13, 2.78, 2.90),
               (STAIR_X + sx * (STAIR_W * 0.5 + 0.10), STAIR_N - run * 0.5,
                1.693), "Steel")
    return mb


def _rail_proxy(mb, a, b, z0=None):
    """One slab standing in for a whole `rail_run`: its two rails, its posts
    and the air between them.

    A RAILING IS THE ONE FEATURE WHERE THE SHADOW PROXY IS HONESTLY WRONG AND
    IS STILL RIGHT, which is worth stating because it is the opposite of every
    other box in `shadow_proxies`. The metric is LOD0-vertex to tier-SURFACE,
    so a solid slab through the rail's envelope scores every rail vertex at
    zero; but a solid slab casts a solid shadow where a railing casts a comb.
    At cascade 1's 56.25 mm texel a 55 mm post is one texel wide and the comb
    is already gone, so the two shadows are the same shadow at every distance
    this tier is drawn at, and this is 12 triangles against a railing's 96."""
    z0 = DECK_Z if z0 is None else z0
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 0.2:
        return
    # IT STARTS 20 mm ABOVE THE DECK AND NOT ON IT. A run drawn from z0 has a
    # slab face on the deck plane and, on the four perimeter runs, END faces
    # on the concrete cap's own outer and end planes over the 20 mm where the
    # two overlap: 22 same-facing Rock/Steel pairs, which the real railing
    # avoids only because an 0.08 m rail 1.10 m up has no area down there. The
    # cost of lifting it is that the posts' feet are 20 mm outside the proxy,
    # and 20 mm is a third of a cascade-1 texel.
    horiz = abs(dx) >= abs(dy)
    size = (length, 0.14, 1.16) if horiz else (0.14, length, 1.16)
    mb.box(size, ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, z0 + 0.60),
           "Steel")


def lod2_verticals(mb):
    """The five masts and the tank, blocked in for cascade 2.

    MEASURED AND KEPT, unlike the miner's LOD2 at RN-1675 which was measured
    and abandoned. The pad's LOD2 read 14100.00 mm for exactly LOD1's reason
    and for six boxes it comes inside cascade 2's 210.94 mm texel, which lets
    the coarsest cascade draw a 180-triangle tier instead of the
    1,200-triangle LOD1 it would otherwise fall back to. That is 1,000 drawn
    triangles for 84, and it does not move the marginal multiplier at all -
    the multiplier counts cascades still on tier 0 and this is a trade between
    tiers 1 and 2. It is banked because it is cheap and measured, not because
    it changes the headline number."""
    for x, y in ((-10.90, 10.90), (10.90, 7.60), (10.90, -10.60)):
        mb.box((0.60, 0.60, 14.10), (x, y, DECK_Z + 7.05), "Steel")
    for x, y in ((-11.00, -10.60), (11.00, -11.40)):
        mb.box((0.60, 0.60, 6.92), (x, y, DECK_Z + 3.46), "Steel")
    mb.box((3.00, 3.00, 5.91), (8.60, 3.60, DECK_Z + 2.955), "Steel")
    mb.box((4.30, 2.90, 1.90), (8.40, -8.00, DECK_Z + 0.95), "Concrete")
    mb.box((0.62, 0.62, T0_H), T0 + (DECK_Z + T0_H * 0.5,), "Steel")
    return mb


# ---------------------------------------------------------------------------
# LOD chain
# ---------------------------------------------------------------------------

def build_lod0(root):
    mb = of.MeshBuilder()
    ground(mb)
    mount(mb)
    trench_services(mb)
    tower(mb)
    swing_arm(mb)
    striping(mb)
    deck_joints(mb)
    deck_kerb(mb)
    deck_anchors(mb)
    scorch(mb)
    guard_rails(mb)
    stair(mb)
    furniture(mb)
    t0_mast(mb)
    cable_network(mb)
    _report.append(("LaunchPad_LOD0", mb))
    return mb, mb.build(NAME + "_LOD0", root)


def lod1_geometry(mb):
    ground(mb, detail=False)
    mount(mb, detail=False)
    tower(mb, detail=False)
    swing_arm(mb, detail=False)
    striping(mb)
    stair(mb, detail=False)
    shadow_proxies(mb)
    return mb


def build_lod1(root):
    mb = of.MeshBuilder()
    lod1_geometry(mb)
    _report.append(("LaunchPad_LOD1", mb))
    return mb, mb.build(NAME + "_LOD1", root)


def lod2_geometry(mb):
    """At 80 m the pad is two banks, a table, a mast and a light. The MAST is
    what says 'launch site' from orbit-adjacent altitude, so it is the one
    thing LOD2 keeps at full height. The trench stays too, because a slot of
    shadow down the middle is the whole silhouette."""
    # RN-1815: LOD2 does NOT get the trench's soot gradient and that is a
    # decision, not an oversight. This tier draws at 80 m, where the whole
    # trench is about a dozen pixels of shadow; three boxes there would buy
    # nothing and cost two more primitives on the cheapest tier in the asset.
    # The roles move with the family so the silhouette does not change value
    # between tiers, which is all LOD2 has to get right.
    mb.box((2 * TR_HW, W, TR_FLOOR), (0.0, 0.0, TR_FLOOR * 0.5),
           "ConcreteDark")
    for sx, y0, y1 in ((-1.0, -HALF, HALF), (1.0, -HALF, STAIR_S)):
        cy, dy = (y0 + y1) * 0.5, y1 - y0
        mb.box((HALF - TR_HW, dy, DECK_Z),
               (sx * (HALF + TR_HW) * 0.5, cy, DECK_Z * 0.5), "Concrete")
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
    lod2_verticals(mb)
    return mb


def build_lod2(root):
    mb = of.MeshBuilder()
    lod2_geometry(mb)
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
    somewhere to swing to.

    RN-1690: IT NOW READS AS A MECHANISM, WHICH IS THE ONE THING IT DID NOT.
    The sim already releases these - `PadPart.releasedAtTick` is stamped the
    same tick `FlightSession.releasedAtTick` is, and `probes/pad.js` asserts
    the co-occurrence - so the pad has FOUR working hold-downs, drawn as eight
    plain boxes with a rectangle labelled "hose". A hold-down is a hydraulic
    machine and the four things that say so are all cheap: a barrel with a rod
    coming out of it (a box cannot be a cylinder and a cylinder can), a gland
    nut where the rod leaves the barrel, a real flexible hose running from the
    barrel down to the base, and bolts through the base plate into the pad.

    THE BARREL IS ROUND AND ALMOST NOTHING ELSE HERE IS, deliberately. This
    part is 1.60 x 0.70 x 2.40 m and is drawn from two metres away in the
    `clamps` frame; `machine_form.pipe_run`'s argument (a 6-gon is 20
    triangles against a box's 12 and at plumbing sizes the difference is a
    pixel) inverts at this size and at this distance, and a hydraulic cylinder
    is the one part of a machine whose ROUNDNESS is what identifies it."""
    mb = of.MeshBuilder()
    mb.box((CLAMP_X, CLAMP_Y, 0.22), (0.0, 0.0, 0.11), "SteelDark")
    mb.box((CLAMP_X - 0.16, CLAMP_Y - 0.10, 0.06), (0.0, 0.0, 0.24), "Hazard")
    mb.box((0.72, 0.50, 1.86), (0.0, 0.08, 1.15), "Steel")
    for sx in (-1.0, 1.0):
        mb.box((0.14, 0.34, 1.50), (sx * 0.50, 0.10, 0.97), "SteelDark")
    # THE RAM. Barrel, gland and rod, on the inboard face where the arm it
    # drives is. The rod is 30 mm narrower than the gland it passes through
    # and the gland 40 mm wider than the barrel it caps, so the three have
    # three diameters and no two of them share an end plane (this is
    # machine_form.stack's construction, applied to a cylinder instead of a
    # chimney).
    #
    # THE RAM SITS AT y = -0.18 AND NOT -0.20, AND THE 20 mm IS THE DECLARED
    # BOX. The gland is the widest thing on the ram at r = 0.165, so at -0.20
    # it reached -0.365 against a `dims_xyz_m` of 0.70, i.e. a part 15 mm
    # outside its own contract - which `validate_glb` measures on the shipped
    # bytes and which no amount of "it still clears the hull at r = 1.535"
    # excuses, because the declared box is what the client reserves. Moved in,
    # not grown out: the ram is 5 mm inside the face on the widest ring.
    mb.cylinder(0.145, 1.02, (0.0, -0.18, 0.96), segments=8, role="Steel")
    mb.cylinder(0.165, 0.13, (0.0, -0.18, 1.53), segments=8, role="SteelDark")
    mb.box((0.13, 0.13, 0.42), (0.0, -0.18, 1.78), "Steel")
    mb.box((0.20, 0.20, 0.20), (0.0, -0.18, 2.04), "SteelDark")
    mb.box((0.86, 0.44, 0.34), (0.0, -0.03, CLAMP_H - 0.17), "SteelDark")
    # 0.395 + 0.15 = 0.545, which stops 25 mm short of the strap's 0.57. The
    # two used to reach the same face from unrelated arithmetic (0.50 + 0.07
    # against 0.42 + 0.15), which is the "hand-tuned to the same sum" defect:
    # neither literal is wrong and their difference is (3 pairs).
    mb.box((0.30, 0.16, 0.90), (0.395, 0.24, 1.30), "Accent")     # manifold
    # The hose off that manifold, down to the base plate. `machine_form.hose`
    # and not `pipe_run`: this line has to survive the arm swinging 70 degrees
    # at T-0, so it is the flexible one, and its two clamp bands are what say
    # which end is the machine.
    # The CLAMP BAND is 1.45x the hose width and the elbow only 1.28x, so it
    # is the band and not the bend that sets how far out this run may go:
    # 0.35 - 0.0616 = 0.2884. 0.28 leaves 8 mm, and picking the elbow's looser
    # 1.28 would have shipped the part 1.6 mm outside its box again.
    mf.hose(mb, [(0.395, 0.28, 1.20), (0.395, 0.28, 0.34),
                 (0.395, 0.11, 0.34)],
            0.085, "Rubber", clamp_role="SteelDark")
    # Holding-down bolts through the base plate. Four, at the corners where a
    # hold-down's tension actually goes.
    #
    # THEY MOUNT ON THE HAZARD PLATE AND NOT ON THE BASE PLATE UNDER IT, which
    # is a one-line fix for a bug that would have shipped silently. The base
    # plate's top is z = 0.22 and the hazard tread lying on it spans 0.21 to
    # 0.27, so a `bolt` at 44 mm proud of 0.22 has its head at 0.264 - 6 mm
    # UNDER the tread it is supposed to be holding down. Four bolts, correctly
    # placed by the vocabulary, entirely invisible. The mounting plane is the
    # surface the fastener actually passes through, which here is the tread.
    tread = mf.Face("Z", 1, 0.27, limit=CLAMP_H, name="clamp base tread")
    mf.bolts(mb, tread, (-0.58, 0.58), (-0.23, 0.23), 0.105, "Steel")
    # Two gussets under the hinge head, which is the one overhang on the part
    # and the thing a 2.4 m post carrying a rocket's hold-down load would
    # actually be braced for. `reach` is 0.16 and not more because the clamp's
    # declared Y half-width is 0.35 and the face they stand on is at -0.17:
    # machine_form checks that for us and would refuse 0.20 by name.
    face = mf.Face("Y", -1, -0.17, limit=-CLAMP_Y * 0.5, name="clamp mast -Y")
    for u in (-0.28, 0.28):
        face.wedge(mb, u, 0.09, CLAMP_H - 0.34, 0.16, 0.40, "bracket",
                   "SteelDark")
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
    L hull. It touches by construction.

    RN-1690 ADDS THE RUB STRIP AND NOTHING ELSE, and the restraint is the
    point. This is the one part of the pad the vehicle physically touches, so
    it is where `SteelWorn` belongs more than anywhere else on the asset - a
    coating rubbed through by contact is the literal definition of paintchip -
    but the grip pad is also HAZARD, and hazard has to stay legible (a 1.40 m
    yellow bar is how a player reads at a glance which way round the mechanism
    is). So the strip is inset into the pad's face rather than replacing it:
    1.02 m of the 1.40, 60 mm of the 140 mm depth, leaving a yellow border all
    round. The hazard bar is still a hazard bar and the contact patch is worn.

    THE BAR IS SPLIT IN THREE ACROSS X RATHER THAN LAYERED IN Y, and the first
    attempt is the reason. A thinner worn plate laid ON the hazard pad's
    contact face has to put its own outer face SOMEWHERE, and there are only
    two places: proud of y = -0.40, which moves the contact surface inboard of
    r = 1.25 and breaks the "it touches by construction" promise two
    paragraphs up; or flush with it, which is a same-facing pair in two
    materials over the strip's whole area - exactly what `check_coplanar`
    counts, and it measured it. Splitting the 1.40 m bar into a worn 1.02 m
    centre between two 0.19 m hazard ends puts all three on the one contact
    plane and makes them DISJOINT in X, so there is no overlapping area to
    fight over, the contact face is still at -0.40 to the millimetre, and the
    yellow still brackets the mechanism at both ends where it is read."""
    mb = of.MeshBuilder()
    mb.box((0.44, 0.28, 0.30), (0.0, -0.14, 0.0), "Steel")
    mb.box((1.02, 0.14, 0.60), (0.0, -0.33, 0.0), "SteelWorn")
    for sx in (-1.0, 1.0):
        mb.box((0.19, 0.14, 0.60), (sx * 0.605, -0.33, 0.0), "Hazard")
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

    # THIRTEEN proxies: five for the structure and one per stair tread. The two
    # deck banks are separate boxes BECAUSE the trench is between them; a
    # single slab there would be a player walking on air over a 1.70 m drop.
    of.add_collision_box("col_LaunchPad", (HALF - TR_HW, W, DECK_Z),
                         (-(HALF + TR_HW) * 0.5, 0.0, DECK_Z * 0.5), root,
                         role="Masonry")
    of.add_collision_box("col_LaunchTrench",
                         (HALF - TR_HW, STAIR_S + HALF, DECK_Z),
                         ((HALF + TR_HW) * 0.5, (STAIR_S - HALF) * 0.5,
                          DECK_Z * 0.5), root, role="Masonry")
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

    # THE STAIRS, one proxy per drawn tread, from the generator the drawn
    # geometry uses. See the module docstring for why this is eight boxes.
    #
    # THE NAMES MUST NOT END IN UNDERSCORE-DIGIT. `padProxies` and `proxiesOf`
    # in the client collapse `col_Foo_1`, `col_Foo_2` ... onto one proxy named
    # `col_Foo`, because that is how three.js names the split primitives of a
    # multi-material mesh and a collision box must stay ONE box. So these are
    # `col_LaunchStep1` and not `col_LaunchStep_1`: seven of the eight treads
    # would silently vanish on load under the other spelling, which is a
    # quieter version of exactly the bug being fixed here.
    for i, (size, loc) in enumerate(stair_treads()):
        of.add_collision_box("col_LaunchStep%d" % (i + 1), size, loc, root,
                             role="Masonry")

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
