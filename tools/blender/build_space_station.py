"""
build_space_station.py - a DERELICT orbital station, large enough to walk
around inside.

    blender --background --python tools/blender/build_space_station.py

Produces assets/models/dist/structures/space_station.glb.

There was no space station in this project at all before this file: no asset,
no build script, no client loader. This is the first one, and it is the largest
asset in the game by every measure.

--------------------------------------------------------------------------
WHY DERELICT
--------------------------------------------------------------------------
A point of interest needs a reason to be explored, and a wreck supplies one in
the geometry itself rather than in a system that does not exist yet. An
OCCUPIED station implies crew, working hatches, powered lights, a faction and a
reason they tolerate you, which are four systems nobody has built; a derelict is
COMPLETE AS SHAPE, which is the only thing an art lane can actually deliver end
to end. It is also the subject docs/web/ART-DIRECTION.md asks for: wear, damage,
asymmetry and complexity are the brief, and on a wreck every one of them has a
cause, so they are authored as consequences rather than as decoration. The one
concession to playability is that a handful of light strips still work: a sealed
hull in orbit has no ambient inside it, and a corridor a player cannot see is
not a corridor a player can be asked to walk down.

--------------------------------------------------------------------------
THE SECTION, AND THE THREE MEASUREMENTS THAT SET IT
--------------------------------------------------------------------------
"Walk around inside" is a statement about a cross-section, so the section is
derived here once and every module inherits it. Three of its numbers came from
the physics lane MEASURED AT 400 km, not from surface intuition, and all three
moved after the first draft of this file was already written:

  HEADROOM IS 4.00 m, NOT 2.50. Gravity at 400 km is 3.49886 m/s2 against
  9.659126 at the surface, so the walker's jump apex is 2.319915 m instead of
  0.828 m and its topmost collision sample sits 1.65 m above the feet. A player
  in a 2.50 m corridor jumps into the ceiling with 1.47 m to spare. Every space
  a player occupies here is 4.00 m clear or more.

  WIDTH IS ESSENTIALLY FREE, so it is chosen for PROPORTION. The walker is a
  LINE to structures (three point samples at 0.15 / 0.9 / 1.65 m, no radius),
  not a capsule, so nothing binds it laterally. At 4.00 m of headroom a 2.50 m
  corridor is 1:1.6 tall and narrow, which reads as a shaft; 3.00 m restores a
  corridor proportion and is still unmistakably a corridor rather than a room.

  EYE HEIGHT IS 1.62 m (`CAPSULE.eyeHeightM`), player 1.80 m. That is a render
  and a sightline number: it is what the wall furniture, the viewports and the
  gauge clusters are placed against, and it is what `render_station.py` puts
  its interior camera at.

    main deck                 z = 0       LOCAL +Z IS UP (three.js +Y)
    every pressure hull axis  z = 2.20    so one deck plane serves every module

DOWN IS THE PLANET RADIAL AND THE STATION HOLDS NADIR ATTITUDE. Artificial
gravity therefore costs nothing: the walker derives down per tick from the feet
through the planet centre, and a nadir-pointing station gets the real
inverse-square magnitude for free. The corollary is a form decision and it is
taken here: THERE IS NO ROTATING HABITAT RING that the player walks in. A spin
section would need a non-radial up, which breaks `deckUnder` outright (the
parameter it returns IS a radius). Decks are perpendicular to the radial, and
the fiction is attitude hold.

The interior is FLAT WALLED and the hull is ROUND, and the gap between them is
the service void. That is not a compromise, it is what a real pressurised module
is: a rolled cylinder with a fitout inside it, racks and ducts in the space
between, and removable panels over the lot. It also buys three things that would
otherwise each need solving:

  1. A flat wall and a flat ceiling make "this way is down" unambiguous, which
     the brief asks for and which a barrel vault does not do.
  2. Where two tubes meet, the junction is a saddle nobody can author without
     a boolean. Inside, that mess sits in the void behind a flat bulkhead with
     a hatch in it, so the interior never has to describe it.
  3. Removing a void panel is then a first-class detail: the player sees real
     hull ribs, real conduit and real structure behind the wall.

    spine hull  r_out 3.20  r_in 2.90   -> 6.40 m outside diameter
    interior    walls at y = +-1.50, ceiling at z = 4.00
    void        1.29 m at the widest beside the wall, 0.98 m over the ceiling

--------------------------------------------------------------------------
TWO RENDER STEMS, AND THE REASON IS CULLING RATHER THAN TIDINESS
--------------------------------------------------------------------------
    Station_LOD0 / _LOD1       the pressure hulls, appendages, everything out
    StationInt_LOD0 / _LOD1    the fitout: decks, walls, ceilings, rails, lamps

They are separate stems because they are visible under DIFFERENT conditions.
The hull is visible from a kilometre away; the fitout is visible only from
inside it, through a viewport, or through the breach. A client that draws the
station at range can skip the interior entirely without leaving a hole in the
silhouette, and one that draws it from inside cannot skip the hull, because the
hull's INNER skin is the ceiling of the void. `station_form.hull_tube` builds
both skins as one closed manifold precisely so this split is possible at all.

It is also what makes the shadow-LOD ladder tractable. `check_shadow_lod.py`
groups ladders by node stem (RN-567), so the two are measured independently,
which is the honest way round: an exterior tier that omitted the interior would
otherwise be measured against interior vertices it was never meant to describe.

--------------------------------------------------------------------------
THE LADDER IS AUTHORED SHADOW-SAFE FROM THE FIRST BUILD
--------------------------------------------------------------------------
Every existing LOD ladder in this project was authored for screen distance and
none of them is shadow-safe. Repeating that on a 66 m asset is a mess nobody
wants, so the rule is structural here rather than remembered:

  A tier is admitted to shadow cascade N by its maximum surface deviation from
  _LOD0: 15.47 mm earns cascade 0, 56.25 mm cascade 1, 210.94 mm cascade 2.

Every greeble on this asset is placed by `station_form.Shell.part` or
`station_form.Panel.part`, both of which take their proud height from
`machine_form.LAYER` and never from the call site. So a tier's worst-case
deviation is EXACTLY the shallowest layer it keeps, and it is decided by one
number: `min_layer`. LOD1 sets it to `hinge` (0.052 m), the deepest layer under
cascade 1's 56.25 mm, so LOD1 drops scribes, seams, shims, plates, kick strips,
bosses, bolts and hinges (the numerous ones) and keeps every clip, tray, latch,
grille, coaming, rung, stringer, gauge, duct, bracket and housing blocked in at
its own envelope (the ones that would cost it the cascade). ONE build function
emits both tiers from one source, so they cannot disagree about where anything
is, and re-authoring LOD0 re-authors LOD1 in the same edit.

The caveat that applies here and is stated rather than worked around: a tier
whose entire saving IS an omission cannot be made admissible. That is why
`StationInt_LOD1` keeps every deck, wall, ceiling and handrail as geometry and
saves only greebles, and why there is no `StationInt_LOD2` at all. A coarse
interior tier's only available saving is deleting the interior, and the honest
name for that is not drawing it.

--------------------------------------------------------------------------
COLLISION IS THE FEATURE, NOT A DETAIL
--------------------------------------------------------------------------
For every other asset in this game a `col_` proxy is a box the player bounces
off. Here the proxies are the FLOOR: a player has to be able to stand on them,
and a single enclosing box cannot describe an interior at all, it would make the
station a solid lump. Three facts from the physics lane govern the set:

  1. THE WALKER CAN STAND ON A PROXY AND NEEDS NO NEW CODE. `KinematicBody`
     already composes the terrain floor with `StructureBodies.deckUnder` and
     takes the higher, and that comparison never mentioned altitude. Measured
     at 400 km: 264 of 264 ticks grounded, feet spread 0.000000 m.
  2. FLOORS, WALLS AND CEILINGS AS SEPARATE PROXIES IS REQUIRED, not merely
     tidy. Floors get an exact slab solve.
  3. THERE IS NO CEILING AUTHORITY IN THE WALKER (R48). Above the feet there is
     only `free()`, three point samples 0.75 m apart, so A HORIZONTAL PROXY
     THINNER THAN 0.75 m FITS BETWEEN TWO SAMPLES AND THE PLAYER PASSES CLEAN
     THROUGH IT. Measured with a thickness control: at 0.3 m the player jumps
     through the ceiling and stands on the roof; at 0.8 m the rise stops dead
     at 0.849904 m. **Every overhead proxy here is `CEIL_PROXY_T` = 0.80 m.**
     That is a constraint on the PROXY and not on the visible geometry: the
     ceiling panel you can see is 0.12 m and its proxy is 0.80 m, exactly as a
     machine's proxy is coarser than its hull.

The whole set is produced by `collision_boxes()` from the same layout constants
the visible geometry uses, and that function is the ONLY place the proxy
philosophy lives. If the physics answer changes again, that one function
changes and every rendered triangle stays byte-identical. See PROXY_SET.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import machine_form as mf  # noqa: E402
import rocket_common as rk  # noqa: E402
import station_form as sf  # noqa: E402

NAME = "Station"
INT = "StationInt"
OUT = of.dist_path("structures", "space_station.glb")

# ---------------------------------------------------------------------------
# THE SECTION. Derived once; nothing below re-types any of it.
# ---------------------------------------------------------------------------
DECK_Z = 0.00           # the walking surface, and the file's z datum
DECK_T = 0.30           # deck structure under it
AX_Z = 2.20             # every pressure hull's axis, above the deck
CORR_HW = 1.50          # interior clear HALF width -> 3.00 clear
CORR_CZ = 4.00          # interior clear headroom (the 400 km jump apex + 1.65)
WALL_T = 0.10
CEIL_T = 0.12

EYE_Z = 1.62            # CAPSULE.eyeHeightM. Sightlines are placed against it.
PLAYER_H = 1.80

SP_RO, SP_RI = 3.20, 2.90        # spine pressure hull, 6.40 m OD
CB_RO, CB_RI = 5.00, 4.70        # cargo bay, the wide one, 10.00 m OD
RX_RO, RX_RI = 4.10, 3.85        # reactor drum, the failed one
HUB_RO, HUB_RI = 8.40, 8.10      # the hall, 16.20 m across inside
SIDES = 12
HUB_SIDES = 16

CEIL_PROXY_T = 0.80     # R48: below 0.75 m the walker jumps clean through

# WHERE ANYTHING THAT STANDS ON THE DECK ACTUALLY STARTS, and it is not zero.
# RN-411's catalogued coplanar cause is a part whose extent lands exactly on its
# host's boundary plane, and a deck is the boundary plane EVERY piece of interior
# furniture shares. Starting a bulkhead jamb, a locker upright and a table leg at
# z = 0 gives three different materials one downward face on one plane, which is
# the definition of the defect. They start buried instead, and the depth is
# derived from the deck rather than typed at each call site.
SIT_Z = DECK_Z - 0.07
# A SECOND DEPTH, for parts in a DIFFERENT ROLE that stand on the same deck.
# One burial depth solves the deck plane and creates a new one 70 mm lower: a
# Steel bunk partition and a SteelLight table leg both buried to SIT_Z share
# their undersides, which is the same defect one storey down. Two depths, two
# roles, no shared plane.
SIT_Z2 = DECK_Z - 0.115

CARGO_HW = 2.50         # the hold is wider and taller than a corridor
CARGO_CZ = 5.60

# Headroom and fit, asserted rather than hoped. A flat ceiling inside a round
# hull only works if its corner clears the hull, and that is one Pythagoras
# nobody should have to redo by hand after nudging a radius.
_corner_r = math.sqrt((CORR_HW + WALL_T) ** 2
                      + (CORR_CZ + CEIL_T - AX_Z) ** 2)
_cargo_corner_r = math.sqrt((CARGO_HW + WALL_T) ** 2
                            + (CARGO_CZ + CEIL_T - AX_Z) ** 2)
assert _corner_r < SP_RI - 0.15, (
    "the corridor box does not fit the spine hull: corner at %.4f m against an "
    "inner radius of %.4f m" % (_corner_r, SP_RI))
assert _cargo_corner_r < CB_RI - 0.15, (
    "the hold does not fit the cargo hull: corner at %.4f m against an inner "
    "radius of %.4f m" % (_cargo_corner_r, CB_RI))
assert CORR_CZ >= 4.00 and CARGO_CZ >= 4.00, (
    "4.00 m clear is the 400 km jump apex (2.319915) plus the walker's top "
    "sample (1.65); anything less is a player jumping into the ceiling")
assert CEIL_PROXY_T >= 0.75, (
    "R48: free() samples the walker 0.75 m apart, so a thinner overhead proxy "
    "fits between two samples and is passed clean through")
assert math.sqrt(SP_RI ** 2 - AX_Z ** 2) > CORR_HW + 0.16, (
    "the deck is wider than the hull is at deck height")

# ---------------------------------------------------------------------------
# THE PLAN. One table, so a module cannot be half moved.
#
# X runs the spine, +X is FORWARD (the intact end with the docking collar),
# -X is AFT (the torn end). +Y is PORT, -Y is STARBOARD, +Z is UP.
#
# The x stations are spaced so no two hull WINDOWS overlap: a branch reserves
# its own outer radius plus 0.35 m either side of its station, and the hall
# reserves its whole inner radius. `_spine_runs` asserts the ordering, because
# an overlap silently produces a run with x1 < x0 and a tube inside out.
# ---------------------------------------------------------------------------
AFT_X = -36.00          # the torn aft rim, open to space
BLOWN_X = -28.00        # the bulkhead that failed
FWD_X = 30.00           # forward end of the pressure hull
DOCK_X = 30.00

# THE DOCKING INTERFACE, and these three numbers are NOT this file's to choose.
#
# `core/include/of/vessel.h` publishes, for parts::DockingPort, a 1.25 m part
# (so a 0.625 m mating radius), `dockCaptureRadiusM = 0.60` and
# `dockCaptureConeRad = 30 deg`. `tools/blender/rocket_common.py` mirrors the
# last two as DOCK_CAPTURE_R and DOCK_CONE_DEG and builds the ship's half of
# the joint from them. This end of the joint is built from the SAME numbers,
# imported rather than retyped, because a mating interface whose two halves
# carry their own copies of a dimension is a joint that will silently stop
# being one the first time somebody edits a single copy.
#
# DOCK_MATE_X is the plane the two ports touch on, and it is where socket_dock
# sits. It stands 0.14 m proud of the collar's own guide ring (DOCK_X + 0.26)
# so an approaching vessel meets the port and nothing else.
DOCK_MATE_R = rk.CLASS["S"][0]          # 0.625, the class mating radius
DOCK_CAPTURE_R = rk.DOCK_CAPTURE_R      # 0.600
DOCK_CONE_DEG = rk.DOCK_CONE_DEG        # 30.0
DOCK_MATE_X = DOCK_X + 0.40

HUB_Z0, HUB_Z1 = -1.30, 12.00
MEZZ_Z = 5.10           # gallery deck TOP: 4.80 m clear underneath it
MEZZ_RI = 3.40
CORE_R = 1.80

REACTOR_X = -23.00
HAB_X = -14.00
WING_X = 12.00
CARGO_X = 20.00

HAB_Y1 = 16.00
RX_Y1 = -17.20
CB_Y1 = -15.00

WING_BOOM = 6.00
WING_CELL = 2.20
WING_NX, WING_NY = 10, 3

TRUSS_Z = 6.60

# THE TWO LADDER THRESHOLDS, AND THEY ARE THE ONLY TWO NUMBERS THE LADDER HAS.
# A tier's worst-case surface deviation from LOD0 is exactly the shallowest
# LAYER it keeps, because nothing on this asset stands proud by an amount the
# call site chose. So a threshold is picked by reading machine_form.LAYER and
# the cascade table together, and `check_shadow_lod.py` then confirms rather
# than discovers.
#
#   cascade 0   15.47 mm   nothing can reach this: `seam` alone is 13 mm and a
#                          tier that keeps seams saves nothing worth having
#   cascade 1   56.25 mm   `hinge` is 52 mm and `clip` is 61 mm, so a tier that
#                          drops everything up to and including hinge measures
#                          52.00 mm and clears the gate by 4.25 mm
#   cascade 2  210.94 mm   `gauge` is 163 mm and `duct` is 196 mm, so a tier
#                          that drops up to and including gauge measures 163.00
#                          and clears by 47.94 mm. IT KEEPS `duct` ON PURPOSE:
#                          `scorch_ribs` is on that layer and it is the exposed
#                          structure standing INSIDE the breach, where the hull
#                          it would otherwise be measured against is the part
#                          that is missing. Dropping it measured 940.86 mm.
LOD1_MIN = mf.LAYER["clip"]       # 0.061: drops <= hinge, so deviation is 52 mm
LOD2_MIN = mf.LAYER["duct"]       # 0.196: drops <= gauge, deviation 163 mm
assert mf.LAYER["hinge"] < 0.05625 and LOD1_MIN > 0.05625, (
    "LOD1 must drop everything under cascade 1's 56.25 mm and keep the rest")
assert mf.LAYER["gauge"] < 0.21094 and LOD2_MIN > mf.LAYER["gauge"], (
    "LOD2 must drop everything under cascade 2's 210.94 mm and keep the rest")

# ---------------------------------------------------------------------------
# Roles. THIS PASS IS A FORM PASS AND USES ONLY ROLES THAT ALREADY EXIST.
#
# RN-552 built the smelter's form and its skin as two separate passes for a
# reason worth repeating: a form is judged against a silhouette and a skin
# against a surface, and a pair that changes both at once can attribute
# neither. Every role below is already in of_lib.PALETTE, so this build touches
# NO shared file: not of_lib.py, not texgen.py, not surfaces.json, not
# Surfaces.ts. The station surface families and their own roles are the next
# pass, and these names are aliases so that pass is one line per row rather
# than a search across two thousand lines of build script.
# ---------------------------------------------------------------------------
HULL = "Steel"            # painted hull plate
HULL_D = "SteelDark"      # recesses, shadow lines, structure
HULL_L = "SteelLight"     # doublers, flanges, machined fittings
TRIM = "Accent"           # livery striping
MARK = "Hazard"           # placards and warning marks
BARE = "Iron"             # torn and exposed structure
SCORCH = "Coal"           # burnt plate around a breach
DECK = "Plate"            # the walking surface
GRATE = "SteelDark"
RAIL = "SteelLight"
GLASS = "Glass"
LAMP_ON = "EmissiveState"
LAMP_OFF = "Rubber"
SEAL = "Rubber"
CELL = "SteelDark"        # photovoltaic blanket
FOIL = "Hazard"           # multi-layer insulation, torn


# ---------------------------------------------------------------------------
# EXTERIOR
# ---------------------------------------------------------------------------

def _windows():
    """The x spans the spine hull may NOT be a full ring across."""
    w = [(REACTOR_X - SP_RO - 0.35, REACTOR_X + SP_RO + 0.35),
         (HAB_X - SP_RO - 0.35, HAB_X + SP_RO + 0.35),
         (-HUB_RI, HUB_RI),
         (CARGO_X - CB_RO - 0.35, CARGO_X + CB_RO + 0.35)]
    w.sort()
    for i in range(len(w) - 1):
        assert w[i][1] < w[i + 1][0], (
            "hull windows overlap: %s runs into %s. Move a branch station."
            % (w[i], w[i + 1]))
    return w


def _spine_runs():
    """The x spans over which the spine hull IS a full ring.

    A branch the same diameter as the spine cannot leave through a small gap:
    at a T-junction between two comparable cylinders the through pipe's wall
    survives only as a strip top and bottom. So each junction reserves a window
    and the ring is emitted either side of it; `_junction` then fills the
    window with the two surviving arcs, which is what the joint physically is.
    """
    stops = [AFT_X]
    for (w0, w1) in _windows():
        stops += [w0, w1]
    stops.append(FWD_X)
    return [(stops[i], stops[i + 1]) for i in range(0, len(stops) - 1, 2)]


JUNCTION_ARC = 52.0     # half-angle of the hull strip that survives a T


def _in_window(x):
    """Is `x` inside a hull window, where the spine is arcs rather than a ring?

    Every greeble placer consults this. A part with no host under it is an art
    bug (it floats) AND a shadow-LOD bug (dropping it in a coarse tier measures
    its distance to whatever solid it is buried in, which at a junction is
    metres, not millimetres). The two problems have one fix and it is this
    predicate."""
    return any(w0 <= x <= w1 for (w0, w1) in _windows())


def _on_arc(deg):
    """Is `deg` on one of the two strips a junction leaves behind?"""
    d = deg % 360.0
    return (d <= JUNCTION_ARC or d >= 360.0 - JUNCTION_ARC
            or abs(d - 180.0) <= JUNCTION_ARC)


def _clear_spans(a0, a1):
    """`[a0, a1]` with every hull window cut out of it.

    A MIDPOINT TEST IS NOT AN OVERLAP TEST, and that mistake was worth
    1,976.71 mm. Strakes were skipped when their CENTRE fell in a window, so a
    5.68 m strap centred 0.23 m outside one still ran 2.61 m into it, and the
    part that overhung had no hull under it. Clipping the span is both the art
    fix (a strap stops at the plate it is welded to) and the shadow fix."""
    spans = [(a0, a1)]
    for (w0, w1) in _windows():
        out = []
        for (s0, s1) in spans:
            if s1 <= w0 or s0 >= w1:
                out.append((s0, s1))
                continue
            # Inset 50 mm, so a clipped strap's end face does not land on
            # the plane where the full ring's own end cap already is. Clipping
            # exactly to the boundary traded a shadow defect for a coplanar
            # one, 174 same-facing pairs across seven windows.
            if s0 < w0:
                out.append((s0, w0 - 0.05))
            if s1 > w1:
                out.append((w1 + 0.05, s1))
        spans = out
    return [(s0, s1) for (s0, s1) in spans if s1 - s0 > 0.45]


def _hosted(x, deg):
    """Is there spine hull under (x, deg) to mount something on?

    THE HALL WINDOW IS NOT A JUNCTION AND THAT DISTINCTION COST A CASCADE. A
    branch window leaves two arcs behind, so `_on_arc` is the right question
    there. The hall's window leaves NOTHING: the spine hull simply stops at
    +-HUB_RI and the hall's own drum takes over. A doubler plate placed at
    x = -4.60 passed `_on_arc(28)` and was therefore emitted 3.2 m out from an
    axis with no hull on it, floating inside the hall, and when LOD1 dropped it
    (a `shim` at 19 mm) those vertices measured 3976.57 mm to the nearest
    surface the tier kept. One predicate, two failure modes: invisible art and
    a lost shadow cascade."""
    if -HUB_RI <= x <= HUB_RI:
        return False
    return (not _in_window(x)) or _on_arc(deg)


def _junction(mb, x0, x1, deg_branch, tier):
    """The two arcs of spine hull that survive where a branch leaves, plus the
    bolted collar that makes a T read as a joint rather than as an overlap."""
    for centre in (0.0, 180.0):
        off = JUNCTION_ARC
        sf.hull_tube(mb, "X", x0, x1, SP_RI, SP_RO, SIDES, HULL,
                     centre=(0, 0, AX_Z), deg0=centre - off,
                     deg1=centre + off, smooth=True)
    sh = sf.Shell("X", (0, 0, AX_Z), SP_RO, 1, min_layer=tier)
    for x in (x0, x1):
        # THE RIVETS GO ON THE COLLAR, NOT ON THE HULL UNDER IT. A bolt head
        # 44 mm proud of a hull that carries a 232 mm collar at the same x is
        # 188 mm INSIDE the collar: invisible, and 65.48 mm of deviation when a
        # coarse tier drops it, which is over cascade 1's 56.25 mm on its own.
        # `girth` returns the surface it just made, so the second Shell is
        # derived rather than typed.
        collar = sh.girth(mb, x, 0.32, HULL_L, kind="bracket", segs=SIDES)
        sf.Shell("X", (0, 0, AX_Z), collar, 1, min_layer=tier).rivets(
            mb, x, 0.0, 330.0, 12, 0.078, HULL_L)
    for s in (-1, 1):
        sh.part(mb, 1.10, 0.36, (x0 + x1) * 0.5 + s * 2.3,
                deg_branch + s * 24.0, "bracket", HULL_D)


def hull_spine(mb, tier):
    """The spine: rolled plate in courses on ring frames, 66 m of it."""
    sh = sf.Shell("X", (0, 0, AX_Z), SP_RO, 1, min_layer=tier)
    for (x0, x1) in _spine_runs():
        sf.hull_tube(mb, "X", x0, x1, SP_RI, SP_RO, SIDES, HULL,
                     centre=(0, 0, AX_Z))
    # Ring frames every 3 m. A pressure vessel has them and a smooth tube does
    # not, and over 66 m they are most of what stops the spine reading extruded.
    n = int((FWD_X - AFT_X) / 3.0)
    for i in range(n + 1):
        x = AFT_X + 3.0 * i
        if -HUB_RI - 0.4 < x < HUB_RI + 0.4:
            continue
        if _in_window(x):
            # The frame follows the hull that is left, not the hull that would
            # be there. Emitted as the same two arcs `_junction` emits, so a
            # coarse tier that drops the frame drops something that was lying
            # ON a surface it keeps.
            for centre in (0.0, 180.0):
                sh.girth(mb, x, 0.17, HULL_D, kind="tray", segs=SIDES,
                         deg0=centre - JUNCTION_ARC, deg1=centre + JUNCTION_ARC)
        else:
            sh.girth(mb, x, 0.17, HULL_D, kind="tray", segs=SIDES)
    # Plate courses. Six strakes, not twelve: a strake is the longest straight
    # line on the object so it reads at any range, and doubling them doubles
    # the cost of the thing that is already legible.
    for k in range(6):
        deg = 30.0 + 60.0 * k
        seg = 6.0
        m = int((FWD_X - AFT_X) / seg)
        for i in range(m):
            a0 = AFT_X + 0.38 + seg * i
            a1 = min(a0 + seg - 0.32, FWD_X - 0.20)
            if a1 <= a0:
                continue
            # A strake is a strap ON a plate, so it may not run where there is
            # no plate. Inside a window the hull survives only as two arcs (or,
            # at the hall, not at all), and a strap hanging in the gap is both
            # invisible and the thing that costs a coarse tier its cascade.
            for (c0, c1) in _clear_spans(a0, a1):
                sh.strake(mb, c0, c1, deg + sf.jitter(1.5, k, i), 0.14, HULL_L)
    _junction(mb, REACTOR_X - SP_RO - 0.35, REACTOR_X + SP_RO + 0.35, 270.0,
              tier)
    _junction(mb, HAB_X - SP_RO - 0.35, HAB_X + SP_RO + 0.35, 90.0, tier)
    _junction(mb, CARGO_X - CB_RO - 0.35, CARGO_X + CB_RO + 0.35, 270.0, tier)


def hull_branches(mb, tier):
    """The three modules that leave the spine sideways.

    Each is the same construction and each is DIFFERENT in one structural way,
    so the station reads as assembled from parts with jobs rather than as a
    symmetric toy: the hab is plain and long, the hold is fat and short, and
    the reactor is the one that failed."""
    # Habitation, port. Plain, and deliberately the intact one.
    sf.hull_tube(mb, "Y", 1.60, HAB_Y1, SP_RI, SP_RO, SIDES, HULL,
                 centre=(HAB_X, 0, AX_Z))
    sh = sf.Shell("Y", (HAB_X, 0, AX_Z), SP_RO, 1, min_layer=tier)
    for i in range(6):
        sh.girth(mb, 3.0 + 2.4 * i, 0.17, HULL_D, kind="tray", segs=SIDES)
    for k in range(4):
        sh.strake(mb, 2.0, HAB_Y1 - 0.4, 45.0 + 90.0 * k, 0.14, HULL_L)
    sf.hull_tube(mb, "Y", HAB_Y1, HAB_Y1 + 0.36, 0.0, SP_RO * 0.98, SIDES,
                 HULL_D, centre=(HAB_X, 0, AX_Z), smooth=False)
    for a in (5.4, 8.6, 11.8):
        sf.viewport(mb, sh, a, 296.0, 0.46, HULL_L, GLASS, HULL_D)

    # Cargo bay, starboard forward. Fat, short, and it has a cargo door.
    sf.hull_tube(mb, "Y", -1.60, CB_Y1, CB_RI, CB_RO, SIDES, HULL,
                 centre=(CARGO_X, 0, AX_Z))
    sc = sf.Shell("Y", (CARGO_X, 0, AX_Z), CB_RO, 1, min_layer=tier)
    for i in range(5):
        sc.girth(mb, -3.2 - 2.5 * i, 0.19, HULL_D, kind="tray", segs=SIDES)
    for k in range(6):
        sc.strake(mb, -2.2, CB_Y1 + 0.4, 30.0 + 60.0 * k, 0.16, HULL_L)
    # OUTWARD, not inward. A cap built from CB_Y1 toward +Y puts its own
    # outer face on exactly the plane the tube's end annulus already occupies,
    # facing the same way, which is a same-facing coplanar pair per ring
    # segment. Built outward the two faces are back to back, which is invisible
    # by construction (one culled, one occluded).
    sf.hull_tube(mb, "Y", CB_Y1 - 0.42, CB_Y1, 0.0, CB_RO * 0.98, SIDES,
                 HULL_D, centre=(CARGO_X, 0, AX_Z), smooth=False)
    sc.part(mb, 4.20, 4.20, -8.6, 0.0, "coaming", HULL_L)
    sc.part(mb, 3.80, 3.80, -8.6, 0.0, "plate", HULL_D)
    for s in (-1, 1):
        sc.part(mb, 0.30, 0.50, -8.6 + s * 1.5, 21.0, "hinge", HULL_L)
    sc.part(mb, 1.90, 0.55, -8.6, 0.0, "boss", MARK)

    # Reactor, starboard aft. THE FAILURE.
    sf.hull_tube(mb, "Y", -1.60, -8.40, SP_RI, SP_RO, SIDES, HULL,
                 centre=(REACTOR_X, 0, AX_Z))
    sr = sf.Shell("Y", (REACTOR_X, 0, AX_Z), SP_RO, 1, min_layer=tier)
    for i in range(2):
        sr.girth(mb, -3.6 - 2.8 * i, 0.17, HULL_D, kind="tray", segs=SIDES)
    _reactor_drum(mb, tier)


def _reactor_drum(mb, tier):
    """The module that failed, and the whole argument for a derelict.

    The drum's middle is emitted as an ARC: 214 degrees of hull survive and the
    rest is gone. A hole is not authored by removing material (nothing here
    can), it is authored by never emitting it, and the edge is then dressed
    with `tear_rim` so it reads as split plate rather than as a clean cut."""
    cy = (REACTOR_X, 0, AX_Z)
    sf.hull_tube(mb, "Y", -8.40, -10.20, RX_RI, RX_RO, SIDES, HULL, centre=cy)
    sf.hull_tube(mb, "Y", -10.20, -14.60, RX_RI, RX_RO, SIDES, HULL,
                 centre=cy, deg0=118.0, deg1=332.0)
    sf.hull_tube(mb, "Y", -14.60, RX_Y1, RX_RI, RX_RO, SIDES, HULL, centre=cy)
    sf.hull_tube(mb, "Y", RX_Y1 - 0.36, RX_Y1, 0.0, RX_RO * 0.96, SIDES,
                 SCORCH, centre=cy, smooth=False)
    sh = sf.Shell("Y", cy, RX_RO, 1, min_layer=tier)
    for a in (-10.20, -14.60):
        sh.girth(mb, a, 0.24, HULL_D, kind="bracket", segs=SIDES)
    for a in (-10.20, -14.60):
        sf.tear_rim(mb, "Y", a, RX_RO, 332.0, 478.0, 9, BARE, centre=cy,
                    reach=0.95, seed=int(abs(a * 10)))
    sf.tear_rim(mb, "Y", -12.4, RX_RO * 0.99, 340.0, 470.0, 7, SCORCH,
                centre=cy, reach=0.55, seed=77)
    # Structure visible through the hole, which is what makes it a hole rather
    # than a black decal.
    inner = sf.Shell("Y", cy, RX_RI * 0.94, 1, min_layer=tier)
    sf.scorch_ribs(mb, inner, -10.4, -14.4, 25.0, 1.5, 6, BARE, seed=5)
    sf.scorch_ribs(mb, inner, -10.4, -14.4, 335.0, 1.3, 5, HULL_D, seed=9)
    for i in range(4):
        sf.oriented_box(mb, (REACTOR_X + sf.jitter(1.6, i, 1),
                             -11.0 - 1.2 * i, AX_Z - 2.0),
                        (1, 0, 0), (0, 1, 0), (0, 0, 1),
                        (2.8, 0.34, 0.34), BARE)
    sf.insulation(mb, sh, -10.4, -14.4, 20.0, 1.8, 5, FOIL, seed=3)
    sf.insulation(mb, sh, -10.6, -14.2, 340.0, 1.6, 4, FOIL, seed=8)
    sf.debris_field(mb, (REACTOR_X, -12.4, AX_Z - 0.9), (3.0, 2.6, 2.2), 22,
                    BARE, size=0.22, seed=41)
    # Buckled plate FORWARD of the breach: the shock went somewhere.
    for i in range(5):
        sf.buckle(mb, sh, -8.8 - 0.95 * i, -9.55 - 0.95 * i,
                  96.0 + 11.0 * i, 1.7, SCORCH if i < 2 else HULL_D,
                  depth=0.17, seed=i)


# Half-angle of each corridor portal in the hall wall, and the predicate every
# hall greeble consults before mounting itself. Published as a module constant
# because BOTH stems read it: the hull cuts the gap and the interior must not
# hang a console in it.
HUB_PORTAL_DEG = math.degrees(math.asin(min(0.999,
                                            (CORR_HW + 0.70) / HUB_RI)))
HUB_PORT_Z1 = CORR_CZ + CEIL_T + 0.30


def _hub_gap(deg, z):
    """Is (deg, z) inside a hall portal, where there is no wall to mount on?"""
    if not (-0.30 < z < HUB_PORT_Z1):
        return False
    d = deg % 360.0
    return (d <= HUB_PORTAL_DEG or d >= 360.0 - HUB_PORTAL_DEG
            or abs(d - 180.0) <= HUB_PORTAL_DEG)


def hull_hub(mb, tier):
    """The hall: a 16.2 m drum with a gallery, and the one large volume.

    Emitted in three z bands so the two corridor portals are GAPS rather than
    holes cut in a ring. Same construction as the branch junctions, and the
    only one available without a boolean."""
    c = (0, 0, 0)
    port_z1 = HUB_PORT_Z1
    sf.hull_tube(mb, "Z", HUB_Z0, -0.30, HUB_RI, HUB_RO, HUB_SIDES, HULL,
                 centre=c)
    gap = HUB_PORTAL_DEG
    for (d0, d1) in ((gap, 180.0 - gap), (180.0 + gap, 360.0 - gap)):
        sf.hull_tube(mb, "Z", -0.30, port_z1, HUB_RI, HUB_RO, HUB_SIDES, HULL,
                     centre=c, deg0=d0, deg1=d1)
    sf.hull_tube(mb, "Z", port_z1, HUB_Z1, HUB_RI, HUB_RO, HUB_SIDES, HULL,
                 centre=c)
    sf.hull_tube(mb, "Z", HUB_Z1, HUB_Z1 + 0.50, 0.0, HUB_RO * 0.86,
                 HUB_SIDES, HULL_D, centre=c, smooth=False)
    sf.hull_tube(mb, "Z", HUB_Z0 - 0.45, HUB_Z0, 0.0, HUB_RO * 0.92,
                 HUB_SIDES, HULL_D, centre=c, smooth=False)
    sh = sf.Shell("Z", c, HUB_RO, 1, min_layer=tier, sides=HUB_SIDES)
    for z in (HUB_Z0 + 0.9, 1.6, 4.6, 7.4, 10.0):
        if -0.30 < z < port_z1:
            # Inside the portal band the wall is two arcs, so the ring frame is
            # too. Same rule as the spine's junction frames and same reason.
            for (d0, d1) in ((gap, 180.0 - gap), (180.0 + gap, 360.0 - gap)):
                sh.girth(mb, z, 0.22, HULL_D, kind="tray", segs=HUB_SIDES,
                         deg0=d0, deg1=d1)
        else:
            sh.girth(mb, z, 0.22, HULL_D, kind="tray", segs=HUB_SIDES)
    for k in range(8):
        sh.strake(mb, HUB_Z0 + 0.4, HUB_Z1 - 0.4, 22.5 + 45.0 * k, 0.17,
                  HULL_L)
    # Viewports at standing eye height on the main deck and on the gallery.
    for k in range(6):
        if _hub_gap(40.0 + 55.0 * k, EYE_Z):
            continue
        sf.viewport(mb, sh, EYE_Z, 40.0 + 55.0 * k, 0.50, HULL_L, GLASS,
                    HULL_D)
    for k in range(4):
        sf.viewport(mb, sh, MEZZ_Z + EYE_Z, 66.0 + 78.0 * k, 0.44, HULL_L,
                    GLASS, HULL_D)
    # A dorsal cupola: the one place a player can look OUT and up.
    sf.hull_tube(mb, "Z", HUB_Z1 + 0.50, HUB_Z1 + 1.70, 1.55, 1.78, 8,
                 HULL_L, centre=c)
    sf.hull_tube(mb, "Z", HUB_Z1 + 1.70, HUB_Z1 + 1.86, 0.0, 1.70, 8,
                 GLASS, centre=c, smooth=False)


def hull_ends(mb, tier):
    """The two ends, which are the two halves of the story.

    FORWARD is a docking collar: intact, machined, and the reason a player's
    ship has somewhere to go. AFT is a tear: the pressure hull simply stops and
    what is left is petals and frames. One asset, both states, and a player
    reads which end is which from 500 m."""
    sf.docking_ring(mb, "X", DOCK_X, 2.20, HULL_D, HULL_L, HULL_L, sides=12,
                    centre=(0, 0, AX_Z), latches=8)
    # ...AND THE CLASS-S PORT ON ITS AXIS, WITHOUT WHICH THE COLLAR IS NOT AN
    # INTERFACE. See station_form.docking_adapter for the full argument; the
    # short form is that this collar's clear throat is 2.64 m and the only
    # docking part in the vessel catalogue is 1.25 m across, so nothing the
    # player can build could ever have touched it.
    sf.docking_adapter(mb, "X", DOCK_MATE_X, (0, 0, AX_Z),
                       DOCK_MATE_R, DOCK_CAPTURE_R, DOCK_CONE_DEG,
                       HULL_D, HULL_L, HULL, SEAL, TRIM,
                       throat_r=2.20 * 0.60, sides=12, tier=tier)
    sh = sf.Shell("X", (0, 0, AX_Z), SP_RO, 1, min_layer=tier)
    collar = sh.girth(mb, DOCK_X - 1.40, 0.36, HULL_L, kind="bracket",
                      segs=SIDES)
    sf.Shell("X", (0, 0, AX_Z), collar, 1, min_layer=tier).rivets(
        mb, DOCK_X - 1.40, 0.0, 330.0, 12, 0.088, HULL_L)
    for k in range(4):
        sh.part(mb, 1.20, 0.28, DOCK_X - 2.6, 45.0 + 90.0 * k, "bracket",
                HULL_D)
    sf.hull_tube(mb, "X", DOCK_X - 1.20, DOCK_X - 0.34, 2.20, SP_RO * 0.99,
                 SIDES, HULL_D, centre=(0, 0, AX_Z), smooth=False)
    # The tear, and the frames standing in the open behind it.
    sf.tear_rim(mb, "X", AFT_X, SP_RO, 0.0, 360.0, 14, BARE,
                centre=(0, 0, AX_Z), reach=1.25, seed=17)
    sf.tear_rim(mb, "X", AFT_X + 0.60, SP_RI, 0.0, 360.0, 10, SCORCH,
                centre=(0, 0, AX_Z), reach=0.75, seed=23)
    inner = sf.Shell("X", (0, 0, AX_Z), SP_RI * 0.96, 1, min_layer=tier)
    for deg, seed in ((60.0, 31), (240.0, 37), (150.0, 43)):
        sf.scorch_ribs(mb, inner, AFT_X + 0.7, AFT_X + 5.2, deg, 1.7, 5, BARE,
                       seed=seed)
    sf.insulation(mb, sh, AFT_X + 0.4, AFT_X + 4.0, 150.0, 2.0, 5, FOIL,
                  seed=13)
    sf.debris_field(mb, (AFT_X + 2.4, 0.0, AX_Z), (2.8, 2.4, 2.2), 16, BARE,
                    size=0.20, seed=53)
    for i in range(4):
        sf.buckle(mb, sh, AFT_X + 3.8 + 1.2 * i, AFT_X + 4.8 + 1.2 * i,
                  40.0 + 47.0 * i, 1.7, SCORCH if i < 2 else HULL_D,
                  depth=0.16, seed=i + 60)


def appendages(mb, tier):
    """Everything that says spacecraft: wings, radiators, truss, antennae.

    The wings are the biggest silhouette per triangle anywhere on the asset and
    the radiators are second. Both are AUTHORED BROKEN, in different ways,
    because a derelict whose appendages are all fine is a station with a hole
    in it rather than a wreck: the port wing has lost cells to thirty years of
    micrometeoroids, the starboard one folded at its hinge, and the ventral
    radiator bank sagged into a fan because nothing holds it."""
    sf.solar_wing(mb, (WING_X, SP_RO * 0.9, AX_Z), (0, 1, 0), (1, 0, 0),
                  WING_BOOM, WING_NX, WING_NY, WING_CELL, CELL, HULL_L,
                  HULL_D, bend=0.55,
                  missing={(2, 1), (5, 0), (5, 1), (6, 1), (8, 2), (9, 0),
                           (9, 1), (9, 2)}, seed=2)
    sf.solar_wing(mb, (WING_X, -SP_RO * 0.9, AX_Z), (0, -1, 0), (1, 0, 0),
                  WING_BOOM, WING_NX, WING_NY, WING_CELL, CELL, HULL_L,
                  HULL_D, bend=-4.2,
                  missing={(i, j) for i in range(6, 10) for j in range(3)}
                  | {(4, 2), (5, 2), (3, 0)}, seed=6)
    sf.radiator(mb, (-6.0, 0.0, AX_Z - SP_RO * 0.94), 4.60, 9.00, 5, HULL_L,
                HULL_D, axis_out=(0, 0, -1), axis_long=(1, 0, 0), droop=1.6,
                seed=4)
    sf.radiator(mb, (25.0, 0.0, AX_Z - SP_RO * 0.94), 3.80, 7.00, 4, HULL_L,
                HULL_D, axis_out=(0, 0, -1), axis_long=(1, 0, 0), droop=6.5,
                seed=9)
    for (x0, x1) in ((AFT_X + 4.0, -9.4), (9.4, DOCK_X - 3.4)):
        bays = max(1, int(round((x1 - x0) / 4.0)))
        step = (x1 - x0) / bays
        for i in range(bays):
            sf.truss_bay(mb, (x0 + step * i, 0.0, TRUSS_Z),
                         (x0 + step * (i + 1), 0.0, TRUSS_Z), 1.30, HULL_L)
        for i in range(bays + 1):
            x = x0 + step * i
            sf.oriented_box(mb, (x, 0.0, (TRUSS_Z + AX_Z + SP_RO) * 0.5),
                            (0, 0, 1), (1, 0, 0), (0, 1, 0),
                            (TRUSS_Z - AX_Z - SP_RO, 0.17, 0.17), HULL_D)
    sf.antenna(mb, (25.4, 0.0, TRUSS_Z + 0.8), (0.34, -0.52, 0.78), 3.80,
               2.15, HULL_L, HULL_D, segs=10, tilt=-16.0)
    sf.antenna(mb, (-20.0, 0.0, TRUSS_Z + 0.8), (0.0, 0.62, 0.78), 2.40, 1.15,
               HULL_L, HULL_D, segs=8, tilt=24.0)
    sh = sf.Shell("X", (0, 0, AX_Z), SP_RO, 1, min_layer=tier)
    # Umbilical trunk lines and micrometeoroid doublers: the exterior's version
    # of machine_form's cable trays, and what stops the ventral quarter reading
    # as blank plate.
    for (a0, a1, deg) in ((-26.0, -10.0, 200.0), (-26.0, -10.0, 160.0),
                          (10.0, 27.0, 200.0), (10.0, 27.0, 160.0),
                          (-26.0, -10.0, 320.0), (10.0, 27.0, 40.0)):
        sh.part(mb, a1 - a0, 0.36, (a0 + a1) * 0.5, deg, "tray", HULL_D)
        for i in range(int((a1 - a0) / 1.9)):
            sh.part(mb, 0.11, 0.46, a0 + 1.9 * (i + 0.5), deg, "clip", HULL_L)
    for i in range(10):
        x = AFT_X + 5.0 + 6.6 * i
        deg = 240.0 + 37.0 * i
        # ALL FOUR CORNERS, not the centre and not just the two ends. A 1.45 m
        # doubler is 1.45 m ALONG the hull and 1.45 m AROUND it, which at
        # r = 3.20 is 26 degrees of arc, so a plate centred safely on a
        # surviving strip still runs 13 degrees off the end of it. Both axes
        # are the same midpoint-is-not-overlap mistake `_clear_spans` exists
        # for: the along axis cost 3,976.57 mm and the arc axis cost 315.00.
        half = math.degrees(0.725 / SP_RO)
        if x > FWD_X - 1.5 or not all(
                _hosted(x + e, deg + d)
                for e in (-0.73, 0.0, 0.73) for d in (-half, 0.0, half)):
            continue
        sh.part(mb, 1.45, 1.45, x, deg, "shim", HULL_L)
        sh.rivets(mb, x, deg - 9.0, deg + 9.0, 3, 0.088, HULL_L)
    for i in range(8):
        x = AFT_X + 6.0 + 7.4 * i
        if x > FWD_X - 1.5:
            continue
        for (dx, deg, role) in ((0.0, 118.0, MARK), (1.6, 62.0, TRIM)):
            if not _hosted(x + dx, deg):
                continue
            sh.part(mb, 0.90 if role is MARK else 0.36,
                    0.50 if role is MARK else 2.10, x + dx, deg, "plate", role)


# ---------------------------------------------------------------------------
# INTERIOR
# ---------------------------------------------------------------------------

def _corridor(mb, axis, a0, a1, cross, tier, hw=CORR_HW, cz=CORR_CZ,
              lamps=True, seed=0):
    """One straight run of walkable corridor: deck, two walls, ceiling, rails,
    lamps, and the fittings that make it a place rather than a tube.

    `axis` is "X" or "Y" and `cross` is the run's centreline on the other
    horizontal axis, so the spine and every branch are the same call.

    The walls are `station_form.Panel`s, which are `machine_form.Face`s with a
    tier filter, so every greeble the machine set already has works here and
    the corridor inherits the same catalogued proud heights and the same
    structural no-coplanar guarantee."""
    ln = a1 - a0
    mid = (a0 + a1) * 0.5
    other = 1 if axis == "X" else 0

    def wbox(along_lo, along_hi, cross_lo, cross_hi, z0, z1, role, dz=0.0):
        size = [0.0, 0.0, z1 - z0]
        loc = [0.0, 0.0, (z0 + z1) * 0.5 + dz]
        ai = 0 if axis == "X" else 1
        size[ai] = along_hi - along_lo
        loc[ai] = (along_lo + along_hi) * 0.5
        size[other] = cross_hi - cross_lo
        loc[other] = (cross_lo + cross_hi) * 0.5
        mb.box(tuple(size), tuple(loc), role)

    # Deck, panel by panel, so the joints are structure and the tread is a map.
    panels = max(1, int(round(ln / 2.2)))
    step = ln / panels
    for i in range(panels):
        p0, p1 = a0 + step * i, a0 + step * (i + 1) - 0.05
        if axis == "X":
            sf.deck_panel(mb, p0, p1, cross - hw - 0.16, cross + hw + 0.16,
                          DECK_Z, DECK, HULL_D, seed=seed * 97 + i)
        else:
            sf.deck_panel(mb, cross - hw - 0.16, cross + hw + 0.16, p0, p1,
                          DECK_Z, DECK, HULL_D, seed=seed * 97 + i)
    # The under-deck structure is WIDER than the panels it carries and the
    # walls run PAST the ends of them, both by a few centimetres. A deck panel
    # whose side face lands on the same plane as the structure's, or whose end
    # lands on the same plane as the wall's, is RN-411's catalogued cause: an
    # extent on its host's boundary. Neither offset is visible and both are
    # derived rather than typed.
    wbox(a0 - 0.04, a1 + 0.04, cross - hw - 0.24, cross + hw + 0.24,
         DECK_Z - DECK_T, DECK_Z - 0.065, HULL_D)
    for s in (-1, 1):
        lo, hi = sorted((cross + s * hw, cross + s * (hw + WALL_T)))
        wbox(a0 - 0.04, a1 + 0.04, lo, hi, DECK_Z - 0.065, cz + CEIL_T, HULL)
    wbox(a0 - 0.04, a1 + 0.04, cross - hw - WALL_T, cross + hw + WALL_T, cz,
         cz + CEIL_T, HULL)

    # Wall furniture. The wall Panel's normal points INTO the corridor, and its
    # (u, v) are (along the run, height above the deck), which is exactly what
    # every call below reads as.
    wall_axis = "Y" if axis == "X" else "X"
    for s in (-1, 1):
        w = sf.Panel(wall_axis, -s, cross + s * hw, min_layer=tier,
                     name="corridor %+d" % s)
        # Handrails. The single most load-bearing greeble in an interior: a
        # rail sits at hand height above a FLOOR and nowhere else, so it is
        # what makes the artificial-gravity fiction legible without explaining
        # it, and it is the line a player's eye tracks down a corridor.
        sf.handrail(mb, w, a0 + 0.40, a1 - 0.40, 0.98, RAIL,
                    posts=max(2, int(ln / 1.9)))
        # v_top 0.26 over a 0.24 height, so the strip's bottom edge is
        # 20 mm ABOVE the deck rather than on it. A kick plate that reaches
        # the floor puts its underside on the deck's own top plane.
        mf.kick_plate(mb, w, a0 + 0.2, a1 - 0.2, 0.26, 0.24, HULL_D,
                      dent=0.55 if s > 0 else 0.0, dent_at=1)
        # Removable void panels, a few of them missing, which is what exposes
        # the hull ribs and conduit behind the fitout.
        n = max(1, int(ln / 2.8))
        for i in range(n):
            uu = a0 + (i + 0.5) * ln / n
            if sf.hashf(seed, i, s + 3) < 0.20:
                continue
            # `shim` and not `plate`, because the placards below are on
            # `plate` and machine_form's whole no-coplanar guarantee is that
            # two parts share an outer plane only when they share a TYPE, and
            # therefore a role. Two roles on one layer breaks it, and the gate
            # found it: 27 same-facing pairs across six corridors.
            w.part(mb, ln / n - 0.24, 1.55, uu, 2.05, "shim", HULL_D)
            w.part(mb, 0.11, 0.11, uu, 1.32, "latch", RAIL)
        for i in range(max(1, int(ln / 6.0))):
            uu = a0 + 2.0 + i * 6.0
            # 2.0 of clearance, not 1.2: the placard sits 1.5 m past `uu` and
            # the louvre 1.6 m before it, so a bound that only checks `uu`
            # hangs both off the end of the wall they are mounted on.
            if uu > a1 - 2.0 or uu < a0 + 2.0:
                break
            w.part(mb, 0.70, 1.05, uu, 1.62, "housing", HULL_D)
            mf.gauge_cluster(mb, w, uu, EYE_Z + 0.44, 3, HULL_L, RAIL)
            mf.placard(mb, w, uu + 1.5, EYE_Z + 0.20, 0.30, 0.22, MARK)
            mf.louvre(mb, w, uu - 1.6, 3.30, 0.72, 0.48, 4, HULL_L, HULL_D,
                      HULL_D)
        mf.tray_h(mb, w, a0 + 0.3, a1 - 0.3, 3.62, 0.20,
                  max(2, int(ln / 2.4)), HULL_D, HULL_L)

    # Overhead: conduit runs and the lamps, most of which are dead.
    for off in (-0.86, -0.55, 0.62):
        wbox(a0 + 0.1, a1 - 0.1, cross + off - 0.09, cross + off + 0.09,
             cz - 0.22, cz - 0.04, HULL_D)
    if lamps:
        n = max(1, int(ln / 3.4))
        for i in range(n):
            m0 = a0 + 0.6 + i * ln / n
            m1 = min(m0 + 1.7, a1 - 0.25)
            if m1 <= m0:
                break
            role = LAMP_OFF if sf.hashf(seed, i, 5) < 0.55 else LAMP_ON
            if axis == "X":
                sf.light_cove(mb, m0, m1, cross + 0.12, cz, HULL_D, role)
            else:
                mb.box((0.13, m1 - m0, 0.075),
                       (cross + 0.12, (m0 + m1) * 0.5, cz + 0.037), HULL_D)
                mb.box((0.086, m1 - m0 - 0.10, 0.026),
                       (cross + 0.12, (m0 + m1) * 0.5, cz - 0.013), role)
    return ln


def _bulkhead(mb, axis, at, cross, tier, hw=CORR_HW, cz=CORR_CZ,
              hatch_open=0.0, seed=0):
    """A pressure bulkhead across a corridor, with a hatch a person walks
    through.

    THE RHYTHM OF THE WALK. An 18 m corridor with nothing across it is a tube
    however well its walls are detailed; the same corridor divided into
    compartments by frames a player steps through is a sequence. It is also the
    only place the interior states out loud that it is a PRESSURE vessel.

    `hatch_open` swings the leaf. A derelict wants its hatches in DIFFERENT
    states, and that is not decoration: shut, dogged half open, and blown off
    its hinges are three different stories about what happened here, and the
    player reads the difference before reading anything else."""
    hhw, hh, t = HATCH_HW, HATCH_H, 0.24
    other = 1 if axis == "X" else 0

    def bbox(cross_lo, cross_hi, z0, z1, role, thick=t):
        size = [0.0, 0.0, z1 - z0]
        loc = [0.0, 0.0, (z0 + z1) * 0.5]
        ai = 0 if axis == "X" else 1
        size[ai] = thick
        loc[ai] = at
        size[other] = cross_hi - cross_lo
        loc[other] = (cross_lo + cross_hi) * 0.5
        mb.box(tuple(size), tuple(loc), role)

    for (c0, c1) in ((cross - hw - WALL_T, cross - hhw),
                     (cross + hhw, cross + hw + WALL_T)):
        bbox(c0, c1, DECK_Z - 0.065, cz + CEIL_T, HULL)
    bbox(cross - hhw, cross + hhw, hh, cz + CEIL_T, HULL)
    bbox(cross - hhw - 0.16, cross + hhw + 0.16, hh - 0.05, hh + 0.16,
         HULL_L, thick=t + 0.18)
    for s in (-1, 1):
        bbox(cross + s * hhw - 0.08, cross + s * hhw + 0.08, SIT_Z,
             hh + 0.16, HULL_L, thick=t + 0.18)
    if hatch_open <= 0.01:
        bbox(cross - hhw * 0.94, cross + hhw * 0.94, 0.06, hh * 0.96, HULL_D,
             thick=0.10)
        for i in range(4):
            bbox(cross + hhw * 0.76, cross + hhw * 0.92, 0.50 + i * 0.44,
                 0.82 + i * 0.44, RAIL, thick=0.12)
        bbox(cross - 0.42, cross - 0.10, EYE_Z - 0.16, EYE_Z + 0.16, GLASS,
             thick=0.12)
    else:
        a = math.radians(hatch_open)
        w = hhw * 1.88
        ca, sa = math.cos(a), math.sin(a)
        if axis == "X":
            ctr = (at - 0.14 - sa * w * 0.5, cross - hhw + ca * w * 0.5,
                   LEAF_Z0 + hh * 0.48)
            sf.oriented_box(mb, ctr, (0.0, 0.0, 1.0), (-sa, ca, 0.0),
                            (ca, sa, 0.0), (hh * 0.96, w, 0.10), HULL_D)
        else:
            ctr = (cross - hhw + ca * w * 0.5, at - 0.14 - sa * w * 0.5,
                   LEAF_Z0 + hh * 0.48)
            sf.oriented_box(mb, ctr, (0.0, 0.0, 1.0), (ca, -sa, 0.0),
                            (sa, ca, 0.0), (hh * 0.96, w, 0.10), HULL_D)
    bbox(cross - hhw - 0.62, cross - hhw - 0.20, 1.30, 1.72, HULL_D,
         thick=t + 0.22)
    bbox(cross - hhw - 0.52, cross - hhw - 0.30, EYE_Z, EYE_Z + 0.20, MARK,
         thick=t + 0.30)
    _ = (tier, seed)


HATCH_HW = 1.05         # hatch clear HALF width
HATCH_H = 2.30          # hatch clear height: a person walks, not jumps
LEAF_Z0 = 0.06          # a swung hatch leaf hangs clear of the deck, not on it


def interior(mb, tier):
    """The walkable volume, module by module.

    Roughly 76 m of 3.00 m corridor plus a 16.2 m hall and an 11 m hold, which
    is what makes "walk around inside" a real activity rather than a claim."""
    _corridor(mb, "X", BLOWN_X, -HUB_RI, 0.0, tier, seed=1)
    _corridor(mb, "X", HUB_RI, 28.20, 0.0, tier, seed=2)
    _corridor(mb, "Y", 1.60, HAB_Y1 - 0.6, HAB_X, tier, seed=3)
    _corridor(mb, "Y", -8.20, -1.60, REACTOR_X, tier, lamps=False, seed=4)
    _corridor(mb, "Y", CB_Y1 + 0.6, -1.60, CARGO_X, tier, hw=CARGO_HW,
              cz=CARGO_CZ, seed=5)

    for (x, sw) in ((-20.0, 0.0), (BLOWN_X + 0.5, 74.0), (-10.2, 88.0),
                    (10.2, 0.0), (24.0, 0.0)):
        _bulkhead(mb, "X", x, 0.0, tier, hatch_open=sw, seed=int(x))
    # AT THE MODULE ENTRANCE, not in the middle of the berths. At y = 8.0
    # the frame stood 0.12 m from a bunk partition, which is a coplanar
    # pair, a partition nobody can walk past, and a bunk stack cut in half
    # by a pressure frame. All three are the same placement mistake.
    _bulkhead(mb, "Y", 2.9, HAB_X, tier, hatch_open=0.0, seed=9)
    _bulkhead(mb, "Y", -4.6, REACTOR_X, tier, hatch_open=112.0, seed=11)
    _bulkhead(mb, "Y", -4.0, CARGO_X, tier, hw=CARGO_HW, cz=CARGO_CZ,
              hatch_open=0.0, seed=13)

    for (x, side) in ((HAB_X, 1), (REACTOR_X, -1), (CARGO_X, -1)):
        _side_hatch(mb, x, side, tier)
    _hall(mb, tier)
    _hab_fitout(mb, tier)
    _hold_fitout(mb, tier)


def _side_hatch(mb, x, side, tier):
    """The doorway where a branch leaves the spine, in the spine's own wall.

    This is where the flat fitout earns its keep: the tube-to-tube saddle
    behind this wall is a shape nobody can author without a boolean, and the
    interior never has to describe it because the interior describes a
    DOORWAY."""
    y = side * (CORR_HW + WALL_T * 0.5)
    for (a, b) in ((-CORR_HW - 1.1, -HATCH_HW), (HATCH_HW, CORR_HW + 1.1)):
        mb.box((b - a, WALL_T + 0.16, CORR_CZ + 0.12 - SIT_Z),
               (x + (a + b) * 0.5, y, (CORR_CZ + 0.12 + SIT_Z) * 0.5), HULL)
    mb.box((HATCH_HW * 2.0, WALL_T + 0.16, CORR_CZ + 0.12 - HATCH_H),
           (x, y, (HATCH_H + CORR_CZ + 0.12) * 0.5), HULL)
    mb.box((HATCH_HW * 2.0 + 0.34, WALL_T + 0.26, 0.21),
           (x, y, HATCH_H + 0.055), HULL_L)
    # The jamb OVERLAPS the panel beside it by 50 mm rather than butting it.
    # Butting put the jamb's face and the panel's face on one plane facing the
    # same way, six times over.
    for s in (-1, 1):
        # Buried 40 mm DEEPER than the panel beside it. Two parts that are
        # both "buried to SIT_Z" share a plane at SIT_Z, which is the same
        # defect one level down: a shared burial depth is still a shared depth.
        mb.box((0.21, WALL_T + 0.26, HATCH_H + 0.16 - SIT_Z + 0.04),
               (x + s * (HATCH_HW + 0.055), y,
                (HATCH_H + 0.16 + SIT_Z - 0.04) * 0.5), HULL_L)
    mb.box((0.36, WALL_T + 0.32, 0.36), (x - HATCH_HW - 0.40, y, 1.36),
           HULL_D)
    mb.box((0.15, WALL_T + 0.38, 0.15), (x - HATCH_HW - 0.40, y, EYE_Z), MARK)
    _ = tier


def _hall(mb, tier):
    """The hall's fitout: two decks, a core, a ladder and a lot of railing.

    THE ONE LARGE VOLUME, and the gallery is what makes it large rather than
    merely wide. A 16.2 m room with a flat floor is a floor; the same room with
    a gallery 5 m up, a ladder to it and a railing round it is a SPACE, and the
    player reads the height off the railing they are standing under."""
    of_r = HUB_RI
    # SUNK 20 mm. The radial deck plates put their tops on DECK_Z, and a disc
    # whose top is also on DECK_Z gives every one of them a same-facing pair
    # over its whole area. The plates are the walking surface; the disc is the
    # structure under it, and structure is lower than what it carries.
    mb.cylinder(of_r, DECK_T, (0, 0, DECK_Z - 0.02 - DECK_T * 0.5), axis="Z",
                segments=HUB_SIDES, role=HULL_D, smooth_sides=False)
    for k in range(HUB_SIDES):
        a = 360.0 * k / HUB_SIDES + 180.0 / HUB_SIDES
        c = sf.radial("Z", a)
        r = of_r * 0.60
        sf.oriented_box(mb, (c[0] * r, c[1] * r, DECK_Z - 0.03),
                        (c[0], c[1], 0.0), sf.tangent("Z", a), (0, 0, 1),
                        (of_r * 1.14, of_r * 0.40, 0.06), DECK)
    # An open grating over the service trench, so the floor has a below.
    sf.grating(mb, -1.30, 1.30, -of_r * 0.86, -of_r * 0.30, DECK_Z, 8, GRATE)
    # Core stack, and the six beams that carry the gallery.
    mb.cylinder(CORE_R, MEZZ_Z + 0.30 - SIT_Z, (0, 0, (MEZZ_Z + 0.30 + SIT_Z)
                                                 * 0.5),
                axis="Z", segments=8, role=HULL, smooth_sides=False)
    core = sf.Shell("Z", (0, 0, 0), CORE_R, 1, min_layer=tier, sides=8)
    for k in range(8):
        core.strake(mb, 0.12, MEZZ_Z + 0.2, 45.0 * k, 0.12, HULL_L)
    for k in range(4):
        core.part(mb, 1.05, 0.80, 1.35, 45.0 + 90.0 * k, "housing", HULL_D)
        core.part(mb, 0.34, 0.48, EYE_Z + 0.75, 45.0 + 90.0 * k, "gauge", RAIL)
    for k in range(6):
        a = 60.0 * k + 12.0
        c = sf.radial("Z", a)
        midr = (CORE_R + of_r) * 0.5
        sf.oriented_box(mb, (c[0] * midr, c[1] * midr, MEZZ_Z - 0.46),
                        (c[0], c[1], 0.0), sf.tangent("Z", a), (0, 0, 1),
                        (of_r - CORE_R, 0.24, 0.52), HULL_D)
    # The gallery: an annular deck and the railing that says how high it is.
    sf.hull_tube(mb, "Z", MEZZ_Z - 0.30, MEZZ_Z, MEZZ_RI, of_r, HUB_SIDES,
                 HULL_D, centre=(0, 0, 0), smooth=False)
    for k in range(HUB_SIDES):
        a = 360.0 * k / HUB_SIDES
        p = sf.point("Z", (0, 0, 0), MEZZ_Z + 0.55, a, MEZZ_RI + 0.07)
        sf.oriented_box(mb, p, (0, 0, 1), sf.radial("Z", a),
                        sf.tangent("Z", a), (1.10, 0.075, 0.075), RAIL)
        a1 = a + 360.0 / HUB_SIDES
        for h in (0.60, 1.06):
            q0 = sf.point("Z", (0, 0, 0), MEZZ_Z + h, a, MEZZ_RI + 0.07)
            q1 = sf.point("Z", (0, 0, 0), MEZZ_Z + h, a1, MEZZ_RI + 0.07)
            ln = math.sqrt(sum((q1[i] - q0[i]) ** 2 for i in range(3))) or 1.0
            sf.oriented_box(
                mb, tuple((q0[i] + q1[i]) * 0.5 for i in range(3)),
                tuple((q1[i] - q0[i]) / ln for i in range(3)), (0, 0, 1),
                sf.radial("Z", a + 180.0 / HUB_SIDES), (ln, 0.055, 0.055),
                RAIL)
    # THE HALL'S WALL FITOUT IS TIER INVARIANT, AND THE REASON IS THE TWO-STEM
    # SPLIT ITSELF. Everything below is bolted to the hull's INNER SKIN, and
    # that skin lives in the `Station` stem, not this one. A greeble mounted on
    # a surface its own node does not contain has no host to be measured
    # against: dropping a 24 mm placard here measured 839.96 mm, because the
    # nearest thing `StationInt_LOD1` still had was a cable tray a metre away.
    # So this Shell keeps min_layer at 0 and the hall wall costs the coarse
    # tier what it costs.
    #
    # THE REAL FIX IS A LINING and it is named rather than taken: a hall lined
    # with removable panels the way the corridors are would put a host in this
    # node, would let the fitout tier like everything else, and would let the
    # hull carry real window apertures behind it. That is a form change and it
    # belongs in the pass Reid steers, not in a shadow-LOD fix.
    wall = sf.Shell("Z", (0, 0, 0), HUB_RI, -1, min_layer=0.0, sides=HUB_SIDES)
    for s in (-1, 1):
        wall.part(mb, MEZZ_Z + 1.05, 0.065, (MEZZ_Z + 1.05) * 0.5 - 0.10,
                  128.0 + s * 1.7, "stringer", RAIL)
    for i in range(14):
        wall.part(mb, 0.055, 0.60, 0.34 + i * 0.36, 128.0, "rung", RAIL)
    # Wall fitout: consoles at eye level, cable trays, placards.
    for k in range(HUB_SIDES):
        a = 360.0 * k / HUB_SIDES + 11.0
        if 118.0 < a < 141.0 or _hub_gap(a, 0.95) or _hub_gap(a, 3.55):
            continue
        wall.part(mb, 1.70, 1.15, 0.95, a, "housing", HULL_D)
        wall.part(mb, 0.38, 0.80, EYE_Z + 0.30, a, "gauge", RAIL)
        wall.part(mb, 0.26, 0.55, EYE_Z + 1.05, a + 6.0, "plate", MARK)
        wall.part(mb, 0.22, 1.45, 3.55, a, "tray", HULL_D)
    for k in range(HUB_SIDES):
        a = 360.0 * k / HUB_SIDES
        wall.part(mb, 0.17, 2.10, MEZZ_Z + 2.10, a, "tray", HULL_D)
    # Light rings. The hall is the one place a player should see across, so it
    # keeps more of its lamps alive than the corridors do.
    for k in range(8):
        a = 45.0 * k
        for (z, live) in ((3.40, k % 3 != 2), (MEZZ_Z + 2.70, k % 2 == 0)):
            if _hub_gap(a, z):
                continue
            wall.part(mb, 0.15, 1.90, z, a, "clip", HULL_D)
            wall.part(mb, 0.055, 1.65, z - 0.05, a, "tray",
                      LAMP_ON if live else LAMP_OFF)
    sf.debris_field(mb, (2.9, -3.6, 0.36), (2.4, 2.2, 0.32), 14, HULL_D,
                    size=0.24, seed=71)


def _hab_fitout(mb, tier):
    """Crew quarters: bunks, lockers and a table, in the port module.

    A corridor proves the station has scale. A ROOM WITH FURNITURE IN IT proves
    somebody lived here, and that is the difference between a wreck and a
    building-shaped hole. Six bunks, because six is a crew."""
    # THE BUNKS RUN ALONG THE CORRIDOR, NOT ACROSS IT, and the first version
    # did the opposite: a 2.00 m bunk laid across a 3.00 m module left a 1.16 m
    # slot down the middle and the interior camera photographed a wall. A berth
    # is 2 m long and a person lies down the length of the room, which is also
    # the only orientation that leaves a walkway. Wall to walkway: 0.80 m of
    # bunk against 1.50 m of half-width leaves 1.40 m clear.
    x, wall = HAB_X, CORR_HW
    for i in range(3):
        y = 4.2 + i * 2.6
        for s in (-1, 1):
            for lvl in (0.64, 1.86):
                mb.box((0.80, 2.00, 0.10), (x + s * (wall - 0.40), y, lvl),
                       HULL_D)
                mb.box((0.74, 1.94, 0.14),
                       (x + s * (wall - 0.40), y, lvl + 0.10), SEAL)
                mb.box((0.09, 1.98, 0.46), (x + s * (wall - 0.82), y,
                                            lvl + 0.32), RAIL)
            mb.box((0.94, 0.10, 3.10 - SIT_Z),
                   (x + s * (wall - 0.47), y + 1.08,
                    (3.10 + SIT_Z) * 0.5), HULL)
    for i in range(4):
        y = 13.2 + (i % 2) * 0.86
        s = 1 if i < 2 else -1
        mb.box((0.60, 0.78, 2.05), (x + s * (wall - 0.30), y, 1.03), HULL_D)
        mb.box((0.10, 0.70, 1.90), (x + s * (wall - 0.62), y, 1.06), HULL_L)
        mb.box((0.09, 0.17, 0.17), (x + s * (wall - 0.68), y - 0.19, 1.24),
               RAIL)
    mb.box((1.05, 1.70, 0.09), (x, 11.2, 0.78), HULL_L)
    for (dx, dy) in ((-0.40, -0.72), (0.40, -0.72), (-0.40, 0.72),
                     (0.40, 0.72)):
        mb.box((0.09, 0.09, 0.74 - SIT_Z2), (x + dx, 11.2 + dy,
                                             (0.74 + SIT_Z2) * 0.5), RAIL)
    sf.debris_field(mb, (x, 8.6, 0.22), (0.9, 3.6, 0.18), 11, HULL_D,
                    size=0.17, seed=83)
    _ = tier


def _hold_fitout(mb, tier):
    """The hold: racks up both sides and a crane rail overhead.

    Wider and taller than a corridor on purpose. A station whose every interior
    is the same section is one interior repeated, and the moment a player steps
    out of a 3.0 m corridor into a 5.0 m bay with a 5.6 m ceiling, the corridor
    they just left acquires a size."""
    x, hw = CARGO_X, CARGO_HW
    y0, y1 = -2.4, CB_Y1 + 0.9
    for s in (-1, 1):
        for i in range(4):
            yy = y0 - 1.8 - i * 2.7
            for lvl in (1.00, 2.20, 3.40):
                mb.box((0.80, 2.26, 0.11), (x + s * (hw - 0.42), yy, lvl),
                       HULL_D)
            for dy in (-1.02, 1.02):
                mb.box((0.86, 0.10, 4.30 - SIT_Z2),
                       (x + s * (hw - 0.42), yy + dy,
                        (4.30 + SIT_Z2) * 0.5), RAIL)
            if sf.hashf(220, i, s + 2) > 0.45:
                mb.box((0.62, 0.78, 0.68), (x + s * (hw - 0.46), yy + 0.40,
                                            1.45), SEAL)
    for s in (-1, 1):
        mb.box((0.18, y0 - y1, 0.24), (x + s * 0.95, (y0 + y1) * 0.5,
                                       CARGO_CZ - 0.30), HULL_L)
    mb.box((0.72, 0.72, 0.56), (x, -7.4, CARGO_CZ - 0.78), HULL_D)
    mb.box((0.15, 0.15, 1.45), (x, -7.4, CARGO_CZ - 1.78), RAIL)
    sf.debris_field(mb, (x, -10.4, 0.32), (1.9, 2.8, 0.28), 16, HULL_D,
                    size=0.26, seed=91)
    _ = tier


# ---------------------------------------------------------------------------
# COLLISION. The whole feature, and deliberately the only place it lives.
# ---------------------------------------------------------------------------

# THE THREE SHAPES THE PHYSICS ANSWER CAN TAKE, and switching between them is
# one constant:
#
#   "full"   floors, walls and ceilings, all separate convex boxes. What a
#            walker that can stand on a solid needs, and the confirmed answer.
#   "floors" the floor boxes only, for a walker supported by solids but blocked
#            laterally by something else.
#   "shell"  walls and ceilings only, for a walker whose floor comes from a
#            heightfield and who needs solids purely to stay in the corridor.
#
# NO VISIBLE GEOMETRY READS THIS. Changing it rebuilds the proxy set and leaves
# every rendered triangle byte-identical, which is what "structure the file so
# the proxy set can change without redoing the visible geometry" means in
# practice.
PROXY_SET = "full"


def collision_boxes():
    """Every collision proxy as (name, size, loc), derived from the layout.

    Named individually rather than numbered, because a proxy is a gameplay
    contract: `check-proxies` compares the declared set against the shipped set
    IN BOTH DIRECTIONS, so a name is what the two halves agree on. A name must
    also never end in _<digits>, because three.js splits a multi-material
    primitive as Name_0, Name_1 and the client's proxy collapse would then eat
    every sibling but the first (the launch pad ships col_LaunchStep1 and not
    col_LaunchStep_1 for exactly this reason).

    Every box here is a BOX, so convexity is structural rather than checked,
    and a greeble is never a collision surface: a player cannot snag on a rivet
    because no rivet is in this list."""
    floors, walls, ceils = [], [], []

    def run(stem, axis, a0, a1, cross, hw, ceil_z):
        """Floor, two walls and a ceiling for one straight corridor run."""
        ln, mid = a1 - a0, (a0 + a1) * 0.5
        ai, oi = (0, 1) if axis == "X" else (1, 0)

        def put(bucket, name, along, across, zt, zc):
            size, loc = [0.0, 0.0, zt], [0.0, 0.0, zc]
            size[ai], loc[ai] = ln, mid
            size[oi], loc[oi] = across[0], across[1]
            bucket.append((name, tuple(size), tuple(loc)))

        put(floors, "col_%sFloor" % stem, ln, (hw * 2.0, cross),
            DECK_T, DECK_Z - DECK_T * 0.5)
        for (tag, s) in (("L", 1), ("R", -1)):
            put(walls, "col_%sWall%s" % (stem, tag), ln,
                (WALL_PROXY_T, cross + s * (hw + WALL_PROXY_T * 0.5)),
                ceil_z, ceil_z * 0.5)
        # R48: 0.80 m, because free() samples the walker 0.75 m apart and a
        # thinner slab is passed clean through. The visible ceiling panel above
        # it is 0.12 m; a proxy is allowed to be coarser than what it stands in
        # for, exactly as a machine's box proxy is coarser than its hull.
        put(ceils, "col_%sCeil" % stem, ln, (hw * 2.0, cross),
            CEIL_PROXY_T, ceil_z + CEIL_PROXY_T * 0.5)

    run("SpineAft", "X", BLOWN_X, -HUB_RI + 0.25, 0.0, CORR_HW, CORR_CZ)
    run("SpineFwd", "X", HUB_RI - 0.25, 28.20, 0.0, CORR_HW, CORR_CZ)
    run("Hab", "Y", 1.20, HAB_Y1 - 0.6, HAB_X, CORR_HW, CORR_CZ)
    run("Reactor", "Y", -8.20, -1.20, REACTOR_X, CORR_HW, CORR_CZ)
    run("Hold", "Y", CB_Y1 + 0.6, -1.20, CARGO_X, CARGO_HW, CARGO_CZ)

    # Bulkhead jambs and lintels. Without them a player walks through a wall
    # they can see. The lintel spans hatch head to ceiling, which is 1.70 m, so
    # it clears R48's 0.75 m on its own.
    # Stems are SPELLED OUT rather than derived from the coordinate. The first
    # version built a tag from abs(int(at * 10)), which gave the bulkheads at
    # x = -10.2 and x = +10.2 the same three names, and `check-proxies` would
    # have reported a set six names short with nothing saying which six.
    #
    # RN-831: FACTORED, because a SECOND caller arrived. The hall wall needs the
    # identical pierce and the two must not hold private copies of HATCH_HW and
    # HATCH_H: the physics lane's own caution from `orbitdeck.js` is that a file
    # holding 2.5 m width and headroom as private constants was green for the
    # wrong reason while calling them the project's convention. One emitter, one
    # hatch, and a doorway cut in the hall lines up with the bulkhead 1.65 m
    # down the corridor because there is nowhere for them to disagree.
    #
    # `flank` is the HALF WIDTH OF THE WALL BEING PIERCED and it is a parameter
    # rather than `hw + WALL_T` inline, because that expression is only the
    # right answer for a corridor bulkhead. The hall's wall is a 4.536 m chord
    # and its flank is that chord's half length; passing the corridor's 1.60
    # would have left 0.668 m of wall standing either side of the opening with
    # nothing holding it up and a 1.34 m hole in the drum.
    def frame(tag, axis, at, cross, flank, cz, thick=0.30):
        ai, oi = (0, 1) if axis == "X" else (1, 0)
        assert flank > HATCH_HW, (
            "%s: a %.3f m flank cannot carry a %.3f m hatch half width"
            % (tag, flank, HATCH_HW))
        for (side, s) in (("L", 1), ("R", -1)):
            size, loc = [0.0, 0.0, cz], [0.0, 0.0, cz * 0.5]
            size[ai], loc[ai] = thick, at
            size[oi] = flank - HATCH_HW
            loc[oi] = cross + s * (HATCH_HW + size[oi] * 0.5)
            walls.append(("col_Jamb%s%s" % (tag, side), tuple(size),
                          tuple(loc)))
        size, loc = [0.0, 0.0, cz - HATCH_H], [0.0, 0.0, (cz + HATCH_H) * 0.5]
        size[ai], loc[ai] = thick, at
        size[oi], loc[oi] = HATCH_HW * 2.0, cross
        walls.append(("col_Lintel%s" % tag, tuple(size), tuple(loc)))

    for (stem, axis, at, cross, hw) in (
            ("AftFrame", "X", -20.0, 0.0, CORR_HW),
            ("HallAft", "X", -10.2, 0.0, CORR_HW),
            ("HallFwd", "X", 10.2, 0.0, CORR_HW),
            ("FwdFrame", "X", 24.0, 0.0, CORR_HW),
            ("HabFrame", "Y", 2.9, HAB_X, CORR_HW)):
        frame(stem, axis, at, cross, hw + WALL_T, CORR_CZ)

    # The hall. A round room cannot be one convex box, so its floor is one slab
    # (a player standing on a disc only touches its top) and its wall is TWELVE
    # chords round the polygon inscribed in it. Twelve rather than eight
    # because a chord's sagitta at r 8.10 over 30 degrees is 0.276 m, which is
    # how far a player walks into the wall before stopping; at eight it would
    # be 0.616 m, which is visible. THE NUMBER IS A DECISION, NOT A DEFAULT.
    floors.append(("col_HallFloor", (HUB_RI * 1.42, HUB_RI * 1.42, DECK_T),
                   (0.0, 0.0, DECK_Z - DECK_T * 0.5)))
    hall_wall_d = HUB_RI + 0.15
    hall_wall_hw = HUB_RI * 0.28          # half of the 4.536 m chord
    hall_wall_cz = CORR_CZ + 2.0
    for k in range(12):
        # R56. A AND G ARE PIERCED RATHER THAN PLACED, and they are the only two
        # of the twelve that need it: k = 0 faces +X and k = 6 faces -X, which
        # are the two spine mouths. `HUB_PORTAL_DEG` cuts a 4.40 m gap in the
        # HULL at exactly these two angles and this list did not, so the wall a
        # player could see through was solid to walk into. Measured by the
        # physics lane: the walker stopped dead at local x 8.098644, which is
        # this box's inner face, 2.251356 m short of `col_JambHallFwdR`.
        #
        # THE OPENING IS THE SAME HATCH AS THE BULKHEAD'S, through the same
        # emitter, so the hall's doorway and the spine's bulkhead 1.65 m beyond
        # it are the same 2.10 m wide by 2.30 m tall hole and a player walks a
        # straight line through both. Making it the portal's 4.40 m instead was
        # considered and refused: the portal is what the HULL cuts, the hatch is
        # what a player walks through, and a doorway wider than every other
        # doorway on the station is a different room's convention.
        if k in (0, 6):
            frame("Mouth" + ("Fwd" if k == 0 else "Aft"), "X",
                  hall_wall_d if k == 0 else -hall_wall_d,
                  0.0, hall_wall_hw, hall_wall_cz)
            continue
        a = 30.0 * k
        c = sf.radial("Z", a)
        d = hall_wall_d
        walls.append(("col_HallWall%s" % "ABCDEFGHIJKL"[k],
                      (0.30, hall_wall_hw * 2.0, hall_wall_cz),
                      (c[0] * d, c[1] * d, hall_wall_cz * 0.5)))

    # R57. THE SILL, and there was 2.099 m of nothing where it goes.
    #
    # The hall's deck is a SQUARE inscribed in a round room, so it stops at
    # +-5.751 while the spine's deck starts at +-7.850, and the physics lane
    # fell through the difference for 51 ticks with 400 km underneath. Both ends
    # are DERIVED from the two slabs the sill joins rather than typed, so
    # resizing either one takes the sill with it and the gap cannot silently
    # reopen; the assertion below is what says so out loud.
    #
    # It spans the corridor's full 3.00 m rather than the hatch's 2.10, because
    # the vestibule between the hall wall and the spine bulkhead is 3.00 m wide
    # and a player who steps sideways in it needs deck under them too.
    sill_x0 = HUB_RI * 1.42 * 0.5
    sill_x1 = HUB_RI - 0.25
    assert sill_x1 > sill_x0, (
        "the hall deck already reaches the spine deck (%.4f >= %.4f); this sill "
        "is now an overlap rather than a bridge and wants deleting, not moving"
        % (sill_x0, sill_x1))
    for (tag, s) in (("Fwd", 1.0), ("Aft", -1.0)):
        floors.append(("col_HallSill%s" % tag,
                       (sill_x1 - sill_x0, CORR_HW * 2.0, DECK_T),
                       (s * (sill_x0 + sill_x1) * 0.5, 0.0,
                        DECK_Z - DECK_T * 0.5)))
    # The gallery is a floor a player stands on and its inner rail is the only
    # thing between them and a 5 m drop, so both are proxies. Four quadrant
    # slabs rather than an annulus, because an annulus is not convex. The slab
    # is CEIL_PROXY_T thick and its TOP is the walking surface, so it is also
    # the ceiling of the deck below and satisfies R48 in that role too.
    for k in range(4):
        a = 90.0 * k + 45.0
        c = sf.radial("Z", a)
        d = (MEZZ_RI + HUB_RI) * 0.5
        floors.append(("col_GalleryFloor%s" % "NESW"[k],
                       (HUB_RI - MEZZ_RI, HUB_RI * 1.02, CEIL_PROXY_T),
                       (c[0] * d, c[1] * d, MEZZ_Z - CEIL_PROXY_T * 0.5)))
        walls.append(("col_GalleryRail%s" % "NESW"[k],
                      (0.18, MEZZ_RI * 1.34, 1.15),
                      (c[0] * MEZZ_RI, c[1] * MEZZ_RI, MEZZ_Z + 0.575)))
    walls.append(("col_HallCore", (CORE_R * 1.72, CORE_R * 1.72, MEZZ_Z + 0.3),
                  (0.0, 0.0, (MEZZ_Z + 0.3) * 0.5)))

    out = []
    if PROXY_SET in ("full", "floors"):
        out += floors
    if PROXY_SET in ("full", "shell"):
        out += walls + ceils
    return out


WALL_PROXY_T = 0.60     # thick, because it costs nothing: it lives in the void


def build_collision(root):
    names = []
    for (name, size, loc) in collision_boxes():
        of.add_collision_box(name, size, loc, root, role=HULL_D)
        names.append(name)
    return names


# ---------------------------------------------------------------------------
# Sockets
# ---------------------------------------------------------------------------

def build_sockets(root):
    # `socket_dock` IS A FRAME AND IT WAS POINTING THE WRONG WAY (RN-853).
    #
    # A socket exports as a childless glTF node, so it carries a full TRS and
    # ASSET-SPECS 2.6 fixes the reading: the socket's local -Y in Blender is
    # its facing, which after export_yup is the node's local +Z in three.js.
    # ASSET-SPECS 4.23 then states the mating rule: two mated sockets are
    # ANTI-PARALLEL, each facing AWAY from the part it belongs to, so "do these
    # faces mate" is a dot product.
    #
    # This socket was authored `of.deg3(z=-90.0)`, which faces Blender -X, and
    # +X is the forward end this collar is ON. So the station's docking frame
    # pointed INTO the station. Read as an approach vector it aimed an arriving
    # vessel at the far side of the hull; read under the anti-parallel rule it
    # would have accepted a vessel flying out of the station's interior and
    # refused one arriving from space.
    #
    # NOTHING CAUGHT IT AND NOTHING COULD HAVE. `validate_glb.py`'s
    # `part_sockets` block checks a socket's POSITION and has never had an
    # opinion about its axis, and the client's `learnStationSockets` reduces
    # every socket to `[x, y, z]` at the door with `setFromMatrixPosition`, so
    # the rotation is discarded before any consumer could disagree with it.
    # The `socket_frames` block added to contracts.json in this pass is the
    # check that would have caught it, and it goes red on the old value.
    # THE ROLL HALF, and it is a second bug hiding behind the first. Turning
    # the socket round with `z=90` alone gets the FACING right (+X, out of the
    # collar) and leaves the roll pointing at three.js -Z, i.e. to starboard,
    # which is a bearing nothing on this asset marks. A docking port is a body
    # of revolution, so position and axis do not pin it: something has to say
    # which way is UP across the joint or two mated hulls have a free rotation
    # between them and no hatch, handrail or label can be aligned across the
    # seam.
    #
    # `docking_adapter` puts its datum marks at hull angle 0, which for a tube
    # on X is Blender +Z, i.e. three.js +Y, i.e. the station's own up. So the
    # socket's roll reference must be +Y, and `of.deg3(y=-90, z=90)` is the
    # rotation that gives facing +X with roll +Y. That was MEASURED in Blender
    # rather than derived on paper, because the Euler order, the -Y facing
    # convention and the Z-up-to-Y-up export compose into a mapping that is
    # easy to get right by accident and hard to get right by reasoning.
    of.add_socket("socket_dock", (DOCK_MATE_X, 0.0, AX_Z),
                  rot=of.deg3(y=-90.0, z=90.0), parent=root,
                  extras={"of_role": "dock"})
    of.add_socket("socket_entry", (DOCK_X - 3.2, 0.0, DECK_Z),
                  rot=of.deg3(z=90.0), parent=root,
                  extras={"of_role": "spawn"})
    of.add_socket("socket_hall", (0.0, -4.0, DECK_Z), parent=root,
                  extras={"of_role": "spawn"})
    of.add_socket("socket_breach", (REACTOR_X, -12.4, AX_Z), parent=root,
                  extras={"of_role": "poi"})


# ---------------------------------------------------------------------------
# Tiers
# ---------------------------------------------------------------------------

def build_exterior(root, tier, suffix):
    mb = of.MeshBuilder()
    hull_spine(mb, tier)
    hull_branches(mb, tier)
    hull_hub(mb, tier)
    hull_ends(mb, tier)
    appendages(mb, tier)
    return mb, mb.build(NAME + suffix, root)


def build_interior(root, tier, suffix):
    mb = of.MeshBuilder()
    interior(mb, tier)
    return mb, mb.build(INT + suffix, root)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_exterior(root, 0.0, "_LOD0")
    mb1, _ = build_exterior(root, LOD1_MIN, "_LOD1")
    mb2, _ = build_exterior(root, LOD2_MIN, "_LOD2")
    mi0, _ = build_interior(root, 0.0, "_LOD0")
    mi1, _ = build_interior(root, LOD1_MIN, "_LOD1")

    proxies = build_collision(root)
    build_sockets(root)

    of.report(NAME, [(NAME + "_LOD0", mb0), (NAME + "_LOD1", mb1),
                     (NAME + "_LOD2", mb2),
                     (INT + "_LOD0", mi0), (INT + "_LOD1", mi1)])
    # Every tier's dims, in THREE.JS axes, so contracts.json's `parts` rows are
    # pasted from a measurement rather than assumed equal to LOD0's.
    for label, mb in ((NAME + "_LOD0", mb0), (NAME + "_LOD1", mb1),
                      (NAME + "_LOD2", mb2), (INT + "_LOD0", mi0),
                      (INT + "_LOD1", mi1)):
        lo, hi = mb.bounds()
        print("[station] %-18s tris %6d  dims_xyz_m [%.4f, %.4f, %.4f]  "
              "blender z[%+.3f %+.3f]"
              % (label, mb.tri_count(), hi[0] - lo[0], hi[2] - lo[2],
                 hi[1] - lo[1], lo[2], hi[2]))
    print("[station] %d proxies (set %r): %s"
          % (len(proxies), PROXY_SET, " ".join(proxies)))
    print("[station] corridor %.2f m wide x %.2f m clear; hold %.2f x %.2f; "
          "hall %.2f across x %.2f tall; eye %.2f"
          % (CORR_HW * 2.0, CORR_CZ, CARGO_HW * 2.0, CARGO_CZ,
             HUB_RI * 2.0, HUB_Z1, EYE_Z))
    print("[station] fit: corridor corner r %.4f in hull r %.4f; hold corner "
          "r %.4f in hull r %.4f; overhead proxy %.2f m (R48 needs 0.75)"
          % (_corner_r, SP_RI, _cargo_corner_r, CB_RI, CEIL_PROXY_T))
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
