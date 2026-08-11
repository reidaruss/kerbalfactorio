"""
build_ruin.py - THE RUIN. An ancient civilisation's temple platform, destroyed
long ago, standing on the ground the storyline sends the player to first.

    ~/.local/bin/blender501 --background --python tools/blender/build_ruin.py

Produces assets/models/dist/structures/ruin.glb.

There was no ruin in this project at all before this file: no asset, no build
script, no contract row. `story_line_outline_v1.txt` names it as the first
destination a player walks to, `core/include/of/poi.h` already places one on
Forge, and nothing existed for the placement lane to place.

--------------------------------------------------------------------------
EVERY DIMENSION BELOW IS DERIVED FROM poi.h, AND THE DERIVATION IS THE POINT
--------------------------------------------------------------------------
`forgeSpecs` publishes ONE `SiteSpec` for the ruin and four of its fields are
this file's whole envelope:

    footprintM  18.0     so a 36 m complex, and NOTHING may leave the disc
    maxTiltDeg   4.0     the worst ground the admission gate will accept
    maxResidM    1.0     plus that much residual under the fitted plane
    variants     1       one asset, so it has to carry the whole read alone

poi.h then does the arithmetic itself, in prose, and this file is the thing
that prose was written for:

    "The worst admissible ground drops 18*tan(4) = 1.26 m from centre to rim
     and carries up to 1.0 m of residual on top, so a ruin needs a plinth,
     skirt or buried course that can absorb about 2.3 m at its rim without
     daylight under it."

NOTHING LEVELS TERRAIN UNDER A STATIC STRUCTURE in this game, so that 2.26 m is
not a tolerance, it is a structural requirement on the mesh: there has to be
2.30 m of solid stone below the grade datum, continuous all the way round, or
the ruin floats on its downhill side on almost every site the gate admits.

--------------------------------------------------------------------------
THE GROUND-PIVOT COLLISION, AND socket_grade IS THE RESOLUTION
--------------------------------------------------------------------------
Those two requirements contradict each other as stated, and the contradiction
is worth writing down because the obvious readings both fail.

`validate_glb.py`'s `ground` pivot means "the LOD0 base sits on y = 0 and the
footprint is centred on x = z = 0", and `FSite.pos` is a SURFACE point. Read
naively, that puts the model's lowest vertex on the ground at the site centre,
which leaves the buried course with nowhere to be: the rim ground is up to
2.26 m LOWER than the centre, so the skirt would need to reach 2.26 m below the
model's own base plane, which a ground pivot forbids by definition.

The other naive reading, "give it pivot_mode none like the station", throws
away the thing a placed surface object actually needs. The station is a free
body in orbit and has no ground; a ruin is nothing but its relationship to the
ground.

SO THE ASSET PUBLISHES ITS OWN GRADE DATUM AND THE PIVOT STAYS `ground`.

    z = 0.00   the bottom of the buried course. The model's base plane, so
               `ground` is satisfied exactly and the pivot check is real.
    z = 2.30   `GRADE_Z`, marked by `socket_grade`. THIS is the plane the
               placement lane puts on `FSite.pos`, i.e. the model is sunk
               2.30 m relative to the surface point at the site centre.
    z = 3.30   `DECK_Z`, the walking surface, 1.00 m of stylobate above grade.

On flat ground the whole 2.30 m course is invisible, which is what a buried
course IS. On the worst ground the gate admits, the rim ground falls to
z = 0.04 and the course's own bottom is 0.04 m below it, so there is still no
daylight, with 40 mm to spare and no tuning: the number came from poi.h.

The datum is published as a SOCKET rather than as a comment because a
relationship written in prose is a number nobody is checking. `socket_grade` is
in the bytes, `contracts.json` asserts its position and its facing, and
`validate_glb.py`'s `socket_frames` block goes red if it ever moves.

--------------------------------------------------------------------------
THE ONE SYMMETRIC ELEMENT IS THE ONE NOBODY EVER SEES
--------------------------------------------------------------------------
`ground` also demands the LOD0 AABB be centred on x and z to the pivot
tolerance, and ART-DIRECTION.md demands asymmetry throughout. Those pull
against each other too, and the resolution is to decide WHICH element owns the
bounding box.

The buried course is a plain 24-gon prism at `R_BASE`, exactly centred, and it
is the widest thing on the asset by 140 mm. Every other element - the courses
above it, the stylobate blocks, the piers, the cella, the debris - is asserted
to stay inside `R_KEEP`, so no amount of settlement, spall, tilt or collapse
can touch the AABB. The regular element is therefore the one that is buried on
every site the gate admits, and the asymmetry lives entirely in what a player
can see. `_assert_envelope` checks this off the accumulated vertices rather
than trusting the argument.

--------------------------------------------------------------------------
WHAT IT IS: A POLYGONAL PLATFORM, A PERISTYLE, AND ONE INTACT CELLA
--------------------------------------------------------------------------
The plan is a temple plan because a temple plan is the one that puts an
enterable room at the far end of a walk, which is exactly the beat the
storyline wants: you arrive, you cross a colonnade, you go inside, you find
the thing.

    plinth     24-gon, R 17.60 buried / 17.12 at the stylobate, four courses
    peristyle  17 piers on a 4.00 m module (structure_common.CELL), 9 of them
               still standing full height, 3 snapped, 5 down to stumps, and
               7 surviving spans of entablature between the full ones
    cella      8.80 x 14.40 m outside, 6.80 x 12.40 m clear inside, 4.20 m
               clear head, walls 1.00 m thick, ONE intact stone roof
    stele      the focal feature, in the cella, in a shaft of daylight

THE MODULE IS `structure_common.CELL` = 4.00 m ON PURPOSE. The player's own
base-building set is a 4 m module, and putting the ancient builders on the same
one says they were solving the same problem with the same hands. It costs
nothing and it is the only cross-reference in the file that is not arithmetic.

THE DESTRUCTION HAS A DIRECTION AND EVERY WEAR MARK IS DOWNSTREAM OF IT.
`damage(x, y)` is one falloff from `BLAST`, a point off the +X / -Y quarter,
and it decides pier state, blackening, rubble placement and spall depth. So the
+X / -Y corner is flattened, the -X / +Y side stands, the surviving colonnade
is contiguous (which is what lets the entablature exist at all), and a player
can read which way the attack came from without being told. Nothing here is
"randomly damaged": the hash only breaks ties inside a field that has a cause.

The other four causes, and each one is a function of position rather than a
decal:

    COLLAPSE WHERE A BEAM FAILED. Rubble sits UNDER the spans that are gone and
    not under the ones that are still up, because the material came from there.
    STAINING BELOW WATER PATHS. A drip stain is emitted below a surviving
    cornice and nowhere else, so where the cornice is broken the stain stops
    dead. That discontinuity is the tell that the mark has a cause.
    GROWTH IN SHADE. `shade()` is a dot product against one authored sun
    bearing plus a height term, and moss is only placed where shade and
    moisture overlap. Inside the cella that is one patch, under the hole in the
    roof, where the only light and the only water both arrive.
    SAG OVER SPANS. `sag_beam` bows the architrave's own underside over its
    span. It is not a rotation of a straight block, it is a bent one.

--------------------------------------------------------------------------
THE LADDER IS SHADOW-SAFE BY MEASUREMENT, AND IT TOOK SEVEN ROUNDS
--------------------------------------------------------------------------
EVERY optional detail here goes through `station_form.Panel`,
`station_form.Shell` or `Slab` below, all of which take their proud height from
`machine_form.LAYER` and silently drop anything under `min_layer`. Nothing
calls `mb.box` for a detail.

    LOD0   min_layer 0.0
    LOD1   min_layer `clip` 0.061  -> drops every greeble at or under `hinge`
                                      (0.052), so a predicted worst deviation
                                      of 52 mm

AND THE PREDICTION WAS WRONG BY A FACTOR OF 22 ON THE FIRST BUILD.
`check_shadow_lod.py` measured Ruin_LOD1 at 1134.94 mm. That is exactly what
`build_space_station.py` hit (Station_LOD1 at 139.87 mm against the same 52 mm
prediction) and its contract admits a fifth cause it never attributed. Here
every cause was attributed, by locating the worst LOD0 vertices off the shipped
bytes and bisecting the build stage that emitted each one. THE POINT WORTH
CARRYING FORWARD IS THAT NONE OF THEM WAS A SHADOW BUG FIRST:

  1134.94  ashlar scribed straight ACROSS the cella doorway, 1.20 m from the
           nearest jamb, in open air
   360.05  a real HOLE in the door wall: the jambs stopped at the lintel
           soffit, so |y| 1.40 to 6.20 was open from z 6.50 to 7.50
   269.43  the stylobate skin on one shared `Shell` at the nominal radius,
           over 24 blocks that have each settled inward by a different amount
   207.16  `spall` and `growth_patch` SAMPLED a centre inside a window and
           then SIZED the part past it, so a 0.75 m chip hung 0.4 m off a
           0.52 m band
   155.26  parts at VERTEX bearings on a 24-gon, which sit
           r(1 - cos(180/sides)) = 148 mm inside the solid; plus `Shell`
           mounting at the vertex radius rather than the facet radius
   106.09  scorch marks buried 0.20 m inside a pier's own base block, and
           drum greebles hung off the bottom edge of their drum
    78.23  `Shell.part`'s facet SPLITTER snapping to a grid that starts at
           bearing 0 and knows nothing about the `phase_deg` its drum was
           built with
    50.76  SHIPPED. Under `hinge`'s own 52 mm, so the layer ladder is finally
           the binding constraint and nothing else is.

So LOD1 earns cascade 1 AND cascade 2, the three cascades draw tiers 0, 1, 1,
and the marginal multiplier is 2.0x. Cascade 0 draws LOD0 because nothing on
any asset in this project reaches its 15.47 mm, so THERE IS NO CASCADE LEFT
FOR A THIRD TIER: a LOD2 built to the same rule would be correct, admissible
and never once drawn.

So LOD2 here is a SCREEN-DISTANCE TIER AND IS DELIBERATELY NOT SHADOW-SAFE, and
saying that out loud is the point. It takes `min_layer` `bracket` (0.232, which
drops every greeble at or under `duct`) and then takes two savings the layer
ladder would refuse: the debris fields are omitted, and the 24 settled
stylobate blocks are merged into one prism at their MEAN inset. The debris
omission is worth about 0.5 m of deviation on its own and forfeits cascade 2 -
for a tier that could not have been drawn in one. What it buys is 3,728
triangles against LOD1's 6,200, at a range where a 0.6 m block of fallen stone
is well under a pixel. The station could not make this argument because it
never measured which cascade its tiers actually reached; this file measures it
first and then decides.

MASS IS IN EVERY TIER OTHERWISE. Courses, drums, capitals, beams, walls, roof
slabs, the stele, the fallen drums and the three fallen architraves are
structure and silhouette and are emitted identically at all three tiers.

--------------------------------------------------------------------------
COLLISION IS THE FEATURE, BECAUSE ENTERABLE IS THE BRIEF
--------------------------------------------------------------------------
Floors, walls and ceilings are separate boxes out of ONE `collision_boxes()`
function, for the reason the station wrote down: a single enclosing box cannot
describe an interior and would turn the cella into a solid lump.

Three numbers from the physics lane govern the set, all of them SURFACE numbers
rather than the station's 400 km ones:

    NO CEILING AUTHORITY IN THE WALKER (R48). Above the feet there is only
    `free()`, three point samples 0.75 m apart, so an overhead proxy thinner
    than 0.75 m fits between two samples and the player walks through it. Every
    overhead proxy here is `CEIL_PROXY_T` = 0.80 m, against roof slabs that are
    0.75 m of visible stone and an architrave that is 0.85.
    THE WALKER IS A LINE, not a capsule: three samples at 0.15 / 0.90 / 1.65 m,
    no radius. Nothing binds it laterally, so clear widths here are chosen for
    proportion and for what an ancient hall should feel like.
    STEP-UP IS 1.10 m (`CAPSULE.stepUpM`, and `STRUCTURE_STEP_UP_M` is
    [0.55, 1.1] for proxies). THE STYLOBATE IS 1.00 m, so a player walks up
    onto the platform anywhere round it with 100 mm of margin and the asset
    needs no stair. See THE STAIR THAT IS NOT HERE, below.

A round deck can only be walled and floored with AXIS-ALIGNED boxes, so the
deck is the union of `DECK_STEPS` rectangles with their corners on the circle,
spaced by the closed form `build_space_station.hall_steps` derives (GP-400).
Seven steps stop the player 1.09 m short of the visible edge, which is the same
stand-off the station shipped, at twice the radius, for four more boxes.

--------------------------------------------------------------------------
THE STAIR THAT IS NOT HERE, AND IT IS A REFUSAL RATHER THAN AN OMISSION
--------------------------------------------------------------------------
A monumental flight up the stylobate is the obvious thing to build and it
cannot be built. Three treads at a walkable 0.48 m going project 1.44 m out
from the stylobate face, which puts stone at radius 18.56 m: OUTSIDE the 18.0 m
`footprintM` that `admit()` measured the ground flatness over, so the stair
would stand on terrain nothing ever checked. Recessing it instead is not
available either, because nothing in this project cuts geometry.

So the stair is ROBBED OUT, which is what happens to a temple stair in reality
and costs nothing: the two cheek blocks that flanked it survive at the +Y
approach and the treads between them are gone. The player climbs the 1.00 m
stylobate directly on `stepUpM`. What the placement lane needs to know from
this is in the report: on a steeply admitted site the downhill rim can stand
3.26 m proud, so the ruin is enterable from its uphill side and not from every
side, by construction.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import machine_form as mf  # noqa: E402
import station_form as sf  # noqa: E402
import structure_common as sc  # noqa: E402

NAME = "Ruin"
OUT = of.dist_path("structures", "ruin.glb")

# ---------------------------------------------------------------------------
# THE ENVELOPE. Every one of these five numbers is read out of poi.h rather
# than chosen here, and the two asserts are what keeps them read out of it.
# ---------------------------------------------------------------------------
FOOTPRINT_M = 18.0          # SiteSpec.footprintM, poi.h forgeSpecs
MAX_TILT_DEG = 4.0          # SiteSpec.maxTiltDeg
MAX_RESID_M = 1.0           # SiteSpec.maxResidM

# The drop the plinth has to swallow, DERIVED. poi.h states 2.3; this is the
# same arithmetic done in floating point so a change to either gate moves the
# geometry instead of stranding a literal.
RIM_DROP_M = FOOTPRINT_M * math.tan(math.radians(MAX_TILT_DEG)) + MAX_RESID_M
GRADE_Z = 2.30              # the datum socket_grade publishes
assert GRADE_Z >= RIM_DROP_M, (
    "the buried course absorbs %.4f m and the worst admissible ground drops "
    "%.4f m, so the rim floats. poi.h's gates set this, not taste."
    % (GRADE_Z, RIM_DROP_M))

DECK_Z = 3.30               # the walking surface: 1.00 m of stylobate
STYLOBATE_H = DECK_Z - GRADE_Z
STEP_UP_M = 1.10            # CAPSULE.stepUpM, web/src/player/Capsule.ts
assert STYLOBATE_H <= STEP_UP_M, (
    "the stylobate is %.2f m and the walker's step-up is %.2f m, so nobody can "
    "get on the platform and the asset needs the stair it cannot have"
    % (STYLOBATE_H, STEP_UP_M))

SIDES = 24                  # facets of the platform: a POLYGONAL plinth

# The four courses, bottom to top: (z0, z1, radius). The batter is 40 mm per
# course, which is what a real dry-laid platform has and is also what keeps the
# buried course the widest thing in the file.
R_BASE = 17.60
COURSES = ((0.00, 0.90, R_BASE),
           (0.90, 1.72, 17.46),
           (1.72, 2.54, 17.30),
           (2.54, DECK_Z, 17.12))
R_DECK = COURSES[-1][2]
# Nothing above the buried course may reach this. Checked off the vertices in
# `_assert_envelope`, not assumed.
R_KEEP = R_BASE - 0.10
assert all(r <= R_KEEP for (_a, _b, r) in COURSES[1:])
assert R_BASE <= FOOTPRINT_M, (
    "the platform is %.2f m across the flats' circumradius against an %.2f m "
    "footprint gate; a site is admitted on the ground under 18 m and nothing "
    "checked the ground under anything wider" % (R_BASE, FOOTPRINT_M))

# ---------------------------------------------------------------------------
# THE PLAN. `structure_common.CELL` is 4.00 m and the ancient builders use it.
# ---------------------------------------------------------------------------
CELL = sc.CELL                      # 4.00
COL_Y = 10.40                       # the two long colonnade rows
COL_X = tuple(-12.0 + CELL * i for i in range(7))     # -12 .. +12
END_X = 14.80                       # the +X end row
END_Y = (-6.40, 0.0, 6.40)

# The cella. Outer box first, because the walls are what the plan is.
CELLA_X0, CELLA_X1 = -14.20, -5.40
CELLA_Y0, CELLA_Y1 = -7.20, 7.20
CELLA_WALL_T = 1.00
IN_X0, IN_X1 = CELLA_X0 + CELLA_WALL_T, CELLA_X1 - CELLA_WALL_T   # -13.20, -6.40
IN_Y0, IN_Y1 = CELLA_Y0 + CELLA_WALL_T, CELLA_Y1 - CELLA_WALL_T   # -6.20, 6.20

# CLEAR HEAD IS 4.20 m AND IT IS A MEASUREMENT WITH SLACK, NOT A GUESS. At
# Forge's surface gravity the walker's jump apex is 0.828 m (the number
# build_space_station.py derived against its own 2.319915 m at 400 km) and its
# topmost collision sample sits 1.65 m above the feet, so a player tops out at
# 2.478 m. 4.20 leaves 1.72 m and makes the room read as a hall rather than as
# a corridor, which is what an ancient cella is for.
CELLA_CLEAR = 4.20
CEIL_Z = DECK_Z + CELLA_CLEAR       # 7.50, the underside of the roof slabs
ROOF_T = 0.75                       # visible slab
ROOF_Z = CEIL_Z + ROOF_T            # 8.25
PARAPET_Z = ROOF_Z + 0.60           # 8.85

DOOR_HW = 1.20                      # 2.40 m clear opening
DOOR_Z1 = DECK_Z + 3.20             # 6.50, the lintel soffit

# The peristyle's own section.
PIER_BASE_H = 0.46
PIER_BASE_W = 1.90
DRUMS = 4
DRUM_H = 1.075
SHAFT_H = DRUMS * DRUM_H            # 4.30
CAP_H = 0.58
CAP_W = 1.86
CAP_TOP = DECK_Z + PIER_BASE_H + SHAFT_H + CAP_H        # 8.64
ARCH_H = 0.85                       # architrave depth
ARCH_TOP = CAP_TOP + ARCH_H                             # 9.49
CORNICE_H = 0.40
CORNICE_TOP = ARCH_TOP + CORNICE_H                      # 9.89

# The one surviving fragment of attic over the cella's front, and the tallest
# thing on the asset. Height is a spec band (6 to 12 m) and it is checked
# against the MEASURED bounds in main(), not here.
ATTIC_TOP = 11.40
HEIGHT_MIN, HEIGHT_MAX = 6.0, 12.0

# THE WIDEST GREEBLE A COLUMN DRUM MAY CARRY, and it is a threshold in a
# shared module rather than a taste. `station_form.Shell.part` splits any part
# wider than sqrt(8 * r * 0.012) into ONE BOX PER FACET, snapped to the angular
# grid `(i + 0.5) * 360 / sides` - which starts at bearing 0 and knows nothing
# about the `phase_deg` the drum was actually built with. These drums each
# carry a hashed phase (that is what stops four drums reading as one
# extrusion), so a split part lands up to 22.5 degrees off the facet it is
# meant to lie on: 0.739 * (1 - cos 22.5) = 56 mm, which is cascade 1's whole
# budget, spent by accident. Staying UNDER the threshold keeps every drum
# greeble a single flat box at its own facet centre. The smallest drum face is
# facet_r(0.725, 8) = 0.670, so the threshold there is 0.2536 m.
#
# THE UNDERLYING ASYMMETRY IS station_form's AND IS REPORTED RATHER THAN
# PATCHED HERE: `Shell` takes `sides` but never takes the hull's phase, so its
# splitter is only correct for a hull built at phase 0. Every asset that pairs
# a phased `hull_tube` or `frustum` with a `Shell` has it.
DRUM_ARC = 0.24
assert DRUM_ARC * DRUM_ARC < 8.0 * (0.725 * math.cos(math.pi / 8)) * 0.012, (
    "a drum greeble this wide trips Shell.part's facet splitter, which snaps "
    "to a grid that ignores the drum's own phase")

CEIL_PROXY_T = 0.80         # R48: below 0.75 m the walker jumps clean through
assert CEIL_PROXY_T >= 0.75, (
    "R48: free() samples the walker 0.75 m apart, so a thinner overhead proxy "
    "fits between two samples and is passed clean through")
assert ARCH_H >= 0.80 and ROOF_T <= CEIL_PROXY_T, (
    "an overhead proxy has to be at least as thick as R48 needs and the stone "
    "it stands for should not be thicker than the proxy")

# THE LADDER. Same two thresholds as the station and for the same reason; see
# the header. LOD2 goes one layer deeper than the station's because nothing on
# this asset has the station's `scorch_ribs` problem (structure standing inside
# a hole where the host is the missing part).
LOD1_MIN = mf.LAYER["clip"]         # 0.061: drops every greeble <= hinge
LOD2_MIN = mf.LAYER["bracket"]      # 0.232: drops every greeble <= duct
assert mf.LAYER["hinge"] < 0.05625 and LOD1_MIN > 0.05625, (
    "LOD1 must drop everything under cascade 1's 56.25 mm and keep the rest")
# LOD1 ALONE COVERS BOTH CASCADES A COARSE TIER CAN REACH, which is what makes
# LOD2 a screen tier rather than a shadow one. See the header.
assert mf.LAYER["hinge"] < 0.21094, (
    "LOD1's own worst deviation must also clear cascade 2, or LOD2 has a "
    "shadow job after all and may not take the debris saving")

# ---------------------------------------------------------------------------
# ROLES. Eight, and each one names a MATERIAL STATE rather than a colour.
#
# Every role is already in of_lib.PALETTE, so this build opens no shared file:
# not of_lib.py, not texgen.py, not surfaces.json. RN-552's rule, that a form
# pass and a skin pass are judged against different things and a pass that
# changes both can attribute neither, applies to a first build most of all.
# ---------------------------------------------------------------------------
STONE = "Rock"            # weathered ashlar, the body of the thing
STONE_D = "RockDark"      # deep courses, sheltered stone, water staining
STONE_L = "Sand"          # FRESHLY BROKEN stone: every spall and every fracture
EARTH = "Soil"            # silt and soil banked against the stone
MOSS = "LeafDeep"         # cushion moss in full shade
LICHEN = "LeafDry"        # crustose lichen in the half-shaded band
BRONZE = "Copper"         # the builders' cramps and the stele's inlay
BURNT = "Coal"            # blackened stone where the fire was

# A CHIP IS LIGHTER THAN THE FACE IT CAME OUT OF, and that is the whole reason
# STONE_L exists as a separate role. Weathered stone darkens; the interior of
# the block does not, so a fresh fracture reads pale against the surface around
# it. Authoring spall in the SAME role as the wall makes it invisible, which is
# the mistake this comment exists to stop.
#
# LICHEN IS `LeafDry` AND NOT `Grass`, WHICH IS A CORRECTION TAKEN OFF THE
# FIRST RENDERS. `Grass` (6F8F42) is a saturated mid-green authored for a
# ground cover seen at distance, and at 0.3 m on a grey stone face it reads as
# a painted panel rather than as growth: ART-DIRECTION.md asks for "grounded,
# muted, layered colour" and names saturated primaries as the failure. Crustose
# lichen on stone is an olive-tan, which is what `LeafDry` (8A7A3E) already is.
# `LeafDeep` stays for cushion moss because a dark green in permanent shade is
# what that actually looks like.


# ---------------------------------------------------------------------------
# The fields. Three functions, and every wear mark in the file is downstream of
# one of them.
# ---------------------------------------------------------------------------

BLAST = (19.0, -15.0)       # where it came from, off the +X / -Y quarter
BLAST_REACH = 30.0


def damage(x, y):
    """0 (untouched) to 1 (flattened), from ONE point off the +X / -Y corner.

    This is the only reason anything on this asset is broken. Pier state,
    blackening, rubble placement and spall depth all read it, so the ruin has a
    direction a player can see rather than a scatter of independent accidents.
    The falloff is linear because a linear falloff is legible: the reader can
    look at a pier and say which side of the building it is on."""
    d = math.hypot(x - BLAST[0], y - BLAST[1])
    return max(0.0, min(1.0, 1.30 - d / BLAST_REACH))


# The sun this civilisation's stone weathered under, as a bearing. Not a render
# light: a bearing the WEAR is a function of, so growth and bleaching agree
# with each other across the whole asset instead of being placed by eye.
SUN_AZ = 55.0
SUN_DIR = (math.cos(math.radians(SUN_AZ)), math.sin(math.radians(SUN_AZ)))


def shade(nx, ny, z):
    """0 (baked) to 1 (permanently shaded) for a face with outward normal
    (nx, ny) at height z.

    Two terms and no more. A face turned away from the sun bearing is shaded;
    stone near the ground is shaded by everything around it and stays damp
    longest. Multiplying them is what puts the moss on the low north faces and
    keeps it off the high south ones, which is the read."""
    n = math.hypot(nx, ny) or 1.0
    facing = (nx * SUN_DIR[0] + ny * SUN_DIR[1]) / n
    low = max(0.0, min(1.0, (DECK_Z + 3.4 - z) / 3.4))
    return max(0.0, min(1.0, (0.5 - 0.5 * facing) * (0.35 + 0.65 * low)))


def _rng(*keys):
    """Stable [0, 1) from part identity. `station_form.hashf`, named locally so
    every call site in this file reads as "this block's own number"."""
    return sf.hashf(*keys)


def facet_r(r, sides):
    """The radius of a polygon's FACE when its VERTICES are at `r`.

    A `station_form.Shell` mounts every part at its own `r` on the bearing of a
    facet CENTRE. `of_lib._cyl_data` and `station_form.hull_tube` both put the
    polygon's VERTICES at the radius they are given. Those are two different
    surfaces, and the gap between them is r(1 - cos(180/sides)): 150 mm on this
    asset's 24-gon platform at r = 17.46, and 61 mm on an 8-sided column drum
    at r = 0.80. Both are over cascade 1's 56.25 mm on their own, and on the
    platform the gap ALSO pushed the corner of a full-facet plate out to
    17.607 m, past R_BASE, which is what `_assert_envelope` refused.

    THIS IS NOT A LOCAL QUIRK AND IT IS FLAGGED UP RATHER THAN JUST FIXED.
    `Shell.part`'s own docstring says a wide part is split so that "each box is
    then exactly on its own facet", and that is true of the ANGULAR grid and
    not of the RADIUS. Every asset built on `station_form.Shell` has the same
    offset, scaled by its own radius and facet count, and the space station's
    contract records an unattributed fifth cause worth 3.0x against 2.0x on its
    exterior ladder. Correcting `Shell` itself would move geometry on a shipped
    asset in a lane that is not its owner's, so it is corrected HERE, at every
    call site that mounts a part, and reported to Admin.

    `girth` is the exception and must keep the VERTEX radius, because it emits
    a `hull_tube` ring rather than a plate: a ring built at the facet radius
    would be a polygon whose own facets sit a further 150 mm inside the course."""
    return r * math.cos(math.pi / max(3, sides))


def inboard(cx, cy, reach):
    """Pull a scatter's centre in until the whole scatter fits on the platform.

    A SCATTER IS NOT A POINT AND THAT IS WHAT THIS FUNCTION EXISTS FOR. The
    first draft of `collapse` tested only the pile's CENTRE against the deck
    radius, which is the same midpoint-is-not-overlap mistake
    `build_space_station._clear_spans` was built for and costs the same thing
    twice over here: rubble hanging in the air past the plinth edge, AND, on
    this asset specifically, an AABB wider than the buried course, which takes
    the ground pivot with it. `_assert_envelope` caught it at 18.9423 m against
    an R_KEEP of 17.50 on the very first build.

    `reach` is how far the scatter's furthest vertex can get from its centre.
    The centre is moved along its own radius rather than clamped per axis, so a
    pile stays on the bearing the collapse threw it on."""
    lim = R_DECK - 0.55 - reach
    r = math.hypot(cx, cy)
    if r <= max(0.0, lim) or r < 1e-9:
        return cx, cy
    k = max(0.0, lim) / r
    return cx * k, cy * k


# ---------------------------------------------------------------------------
# Two emitters this file needs and the shared modules do not have.
# ---------------------------------------------------------------------------

class Slab:
    """`machine_form.Face` for a flat face that is NOT axis aligned.

    THIS CLASS IS THE ANSWER TO A MEASURED DEFECT AND NOT A CONVENIENCE.
    `check_shadow_lod.py` put Ruin_LOD1 at 1134.94 mm against the 52 mm the
    layer ladder predicts, which is the space station's failure repeated, and
    one of its four causes was exactly this: a tilted fallen architrave and a
    leaning stele had their moss, spall and inscription placed through an
    AXIS-ALIGNED `Panel` standing at the face's mean height. On a beam yawed 63
    degrees a greeble 1.6 m along world X is not on the beam at all; it is in
    the air beside it. Invisible geometry first, and a lost shadow cascade
    second, which is the same pair `build_space_station._hosted` catalogues.

    `Shell` already solves this for a cylinder. A plane needed the same thing
    and did not have it, so the contract is copied exactly: the caller says
    WHAT and WHERE in face coordinates and never says how far proud, because
    that is `machine_form.LAYER`'s job, and `min_layer` drops anything below it
    so a tier's worst deviation is decided before a triangle is built.

    `part` takes the same four positional numbers as `Panel.part` and `Shell.
    part`, so `spall`, `growth_patch` and `stain_run` work on all three
    unchanged. That is the whole reason it is shaped this way."""

    __slots__ = ("o", "u", "v", "n", "min_layer")

    def __init__(self, origin, u, v, n, min_layer=0.0):
        self.o = tuple(float(c) for c in origin)
        self.u = tuple(float(c) for c in u)
        self.v = tuple(float(c) for c in v)
        self.n = tuple(float(c) for c in n)
        self.min_layer = float(min_layer)

    def keeps(self, kind):
        return mf.layer(kind) >= self.min_layer

    def part(self, mb, du, dv, u, v, kind, role, embed=mf.EMBED):
        p = mf.layer(kind)
        if p < self.min_layer:
            return
        back = -p * embed
        d = (p + back) * 0.5
        c = tuple(self.o[k] + self.u[k] * u + self.v[k] * v + self.n[k] * d
                  for k in range(3))
        sf.oriented_box(mb, c, self.u, self.v, self.n, (du, dv, p - back),
                        role)


def sag_beam(mb, p0, p1, width, height, sag, role, segs=3):
    """A stone beam that has CREPT over its span: the underside bows.

    `station_form.buckle` bends a plate on a hull and `machine_form.warped`
    bends one on a flat face; neither bends a SOLID, and a lintel that has crept
    is a solid whose soffit is lower in the middle than at its ends. Rotating a
    straight block instead is the thing that looks wrong: it drops one end and
    leaves the soffit dead straight, which is exactly what a beam that has NOT
    crept looks like.

    `segs` stations along the span, four corners each, so the cost is
    12 + 8*segs triangles: 36 at three segments, against 12 for the box it
    replaces. `sag` is the midspan drop of the soffit; the top stays flat,
    because the course above it was laid level and gravity did the rest."""
    ax = [p1[k] - p0[k] for k in range(3)]
    ln = math.sqrt(sum(c * c for c in ax)) or 1.0
    ax = [c / ln for c in ax]
    side = [-ax[1], ax[0], 0.0]
    sn = math.hypot(side[0], side[1]) or 1.0
    side = [side[0] / sn, side[1] / sn, 0.0]
    hw, hh = width * 0.5, height * 0.5
    rings = []
    for i in range(segs + 1):
        t = i / float(segs)
        # A parabola through both bearings, which is the shape a uniformly
        # loaded span actually takes and costs one multiply.
        drop = sag * 4.0 * t * (1.0 - t)
        c = [p0[k] + (p1[k] - p0[k]) * t for k in range(3)]
        ring = []
        for (su, sv) in ((-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)):
            dz = hh * sv - (drop if sv < 0 else 0.0)
            ring.append((c[0] + side[0] * hw * su, c[1] + side[1] * hw * su,
                         c[2] + dz))
        rings.append(ring)
    verts, faces = [], []
    for ring in rings:
        verts.extend(ring)
    for i in range(segs):
        a, b = i * 4, (i + 1) * 4
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append((a + k, a + k2, b + k2, b + k))
    faces.append((0, 3, 2, 1))
    faces.append((segs * 4, segs * 4 + 1, segs * 4 + 2, segs * 4 + 3))
    verts, faces = mf.oriented(verts, faces)
    mb.add_raw(verts, faces, [False] * len(faces), role)


def stain_run(panel, mb, u, v_top, v_bot, width, role, seed=0, n=4):
    """The dark streak below a drip point, tapering and fraying as it falls.

    ON LAYER `scribe`, WHICH IS 6 mm, AND THAT IS THE POINT. A water stain is a
    discolouration and not a relief, so it wants the shallowest layer in the
    table; the consequence is that LOD1 drops every one of these, which is
    correct, because a 6 mm feature contributes nothing to a shadow cascade and
    the tier that drops it measures 6 mm.

    THE CALLER DECIDES WHETHER THERE IS A DRIP POINT AT ALL. That is the whole
    causal contract of this function: it is called under a surviving cornice and
    not called under a broken one, so the stain stops exactly where the thing
    that sheds the water stops."""
    for i in range(n):
        t = i / float(n)
        t1 = (i + 1) / float(n)
        v0 = v_top + (v_bot - v_top) * t
        v1 = v_top + (v_bot - v_top) * t1
        w = width * (1.0 - 0.45 * t) * (0.55 + _rng(seed, i, 3) * 0.75)
        panel.part(mb, w, abs(v1 - v0) * 1.05,
                   u + sf.jitter(width * 0.30, seed, i, 5),
                   (v0 + v1) * 0.5, "scribe", role)


# The shallower layer a satellite fragment sits on, per main layer. Both are
# at or under `hinge` (0.052), so a satellite can never raise the tier's worst
# deviation above what the main mark already costs.
_SATELLITE = {"kick": "boss", "boss": "kick", "shim": "plate",
              "plate": "shim"}


def _ragged(panel, mb, u, v, du, dv, kind, role, seed):
    """One wear mark as TWO overlapping boxes instead of one rectangle.

    A CORRECTION TAKEN OFF THE FIRST RENDER RATHER THAN OFF A GATE. Every mark
    on this asset passed `validate_glb.py` and `check_shadow_lod.py` and looked
    like a POSTER: a single axis-aligned box standing 19 to 31 mm proud of a
    flat face, with a hard rectangular outline and a contrasting flat colour,
    which at 0.3 m reads as signage stuck to the stone rather than as damage in
    it. ART-DIRECTION.md's "clean is now a defect" cuts both ways; a crisp
    rectangle of dirt is as clean as no dirt.

    A second, smaller box on the layer BELOW, offset by about a third of the
    main box, breaks the outline into a stepped, asymmetric shape and doubles
    the number of edges that catch a grazing light. Twenty-four triangles a
    mark instead of twelve, so the counts that feed this are roughly halved:
    the same triangles buying half as many marks, each of which is worth
    looking at. The satellite's layer is always shallower than the main one, so
    the tier's worst-case deviation is still the main mark's layer and the
    shadow ladder is untouched."""
    panel.part(mb, du, dv, u, v, kind, role)
    k2 = _SATELLITE.get(kind, "shim")
    su = du * (0.42 + _rng(seed, 41) * 0.30)
    sv = dv * (0.40 + _rng(seed, 42) * 0.34)
    ou = du * (0.24 + _rng(seed, 43) * 0.24) * (1.0 if _rng(seed, 44) < 0.5
                                                else -1.0)
    ov = dv * (0.22 + _rng(seed, 45) * 0.26) * (1.0 if _rng(seed, 46) < 0.5
                                                else -1.0)
    panel.part(mb, su, sv, u + ou, v + ov, k2, role)


def _band(lo, hi, span, t):
    """Fit a `span`-long mark wholly inside [lo, hi] at fraction `t` along it.

    The one-dimensional half of `_fit`, and it exists for the same measured
    reason. Returns (span, centre) or (0, 0) when the band is too short for a
    mark worth emitting."""
    span = min(span, hi - lo)
    if span < 0.06:
        return 0.0, 0.0
    return span, lo + span * 0.5 + (hi - lo - span) * min(1.0, max(0.0, t))


def _fit(u0, u1, v0, v1, du, dv, seed, i):
    """Place a `du` x `dv` part wholly INSIDE the window [u0,u1] x [v0,v1], or
    refuse. Returns (u, v, du, dv) or None.

    A SCATTER EMITTER THAT SAMPLES A CENTRE AND THEN CHOOSES A SIZE PUTS PART
    OF THE PART OUTSIDE THE FACE, and this one did. `spall` could pick a 0.75 m
    chip whose centre was sampled inside a 0.52 m band, so 0.4 m of it hung off
    the stone; on a settled stylobate block and on a fallen architrave that is
    the difference between a chip and a shard floating beside the thing it came
    out of, and `check_shadow_lod` scored it at 207.16 mm.

    The part is SHRUNK to fit rather than nudged, because nudging a part that
    is bigger than its host just moves the overhang to the other edge; a face
    too small for the smallest useful mark gets no mark, which is correct."""
    # 1.5x, because `_ragged` hangs a satellite up to 0.48 * du off the main
    # box's centre and half of it beyond that: the window has to hold the whole
    # mark, not just the box the caller asked for.
    du = min(du, (u1 - u0) / 1.5)
    dv = min(dv, (v1 - v0) / 1.5)
    if du < 0.05 or dv < 0.05:
        return None
    lo_u, hi_u = u0 + du * 0.75, u1 - du * 0.75
    lo_v, hi_v = v0 + dv * 0.75, v1 - dv * 0.75
    u = lo_u + (hi_u - lo_u) * _rng(seed, i, 12)
    v = lo_v + (hi_v - lo_v) * _rng(seed, i, 13)
    return (u, v, du, dv)


def growth_patch(panel, mb, u0, u1, v0, v1, density, role_deep, role_light,
                 seed=0, n=10, hosted=None):
    """Moss and lichen over a region of a face, at `density` in [0, 1].

    Two roles because growth is not one thing: the deep-shade species holds the
    damp centre and the tolerant one rings it. The split is by the patch's own
    hash, so a patch is not a checkerboard.

    Layer `shim` (19 mm) for the body and `plate` (24 mm) for the crust, both
    dropped by LOD1, which is right: growth is a colour event at any distance a
    shadow cascade cares about."""
    if density <= 0.02:
        return
    for i in range(n):
        if _rng(seed, i, 11) > density:
            continue
        s = 0.22 + _rng(seed, i, 14) * 0.55
        dv = s * (0.5 + _rng(seed, i, 16) * 0.8)
        p = _fit(u0, u1, v0, v1, s, dv, seed, i)
        if p is None:
            continue
        u, v, du, dv = p
        if hosted is not None and not hosted(u, v):
            continue
        deep = _rng(seed, i, 15) < 0.55
        _ragged(panel, mb, u, v, du, dv, "shim" if deep else "plate",
                role_deep if deep else role_light, seed * 13 + i)


def spall(panel, mb, u0, u1, v0, v1, severity, seed=0, n=8, hosted=None):
    """Chipped stone: pale fresh fracture standing in the weathered face.

    ADDITIVE, because nothing in this project removes material (see
    `machine_form.Face.coaming` for the same argument on a machine). A chip is
    therefore emitted as the pale INTERIOR of the block standing a layer proud
    of the weathered skin around it, which is what a fresh conchoidal break
    actually looks like from two metres: a bright facet, not a hole.

    `severity` comes from `damage()` at the caller's own position, so chipping
    is worst where the destruction was and thins out across the building.

    `hosted(u, v)` is `build_space_station._hosted` generalised: a predicate
    the caller supplies saying whether there is stone at that point of the face
    to chip. A part with no host under it is an art bug (it floats) AND a
    shadow-LOD bug (a coarse tier that drops it measures its distance to
    whatever it should have been buried in, which across a doorway is metres).
    Two failure modes, one predicate."""
    if severity <= 0.02:
        return
    for i in range(n):
        if _rng(seed, i, 21) > severity:
            continue
        s = 0.16 + _rng(seed, i, 24) * 0.42 * (0.4 + severity)
        p = _fit(u0, u1, v0, v1, s, s * (0.55 + _rng(seed, i, 25) * 0.7),
                 seed, i + 900)
        if p is None:
            continue
        u, v, du, dv = p
        if hosted is not None and not hosted(u, v):
            continue
        _ragged(panel, mb, u, v, du, dv,
                "kick" if _rng(seed, i, 26) < 0.6 else "boss", STONE_L,
                seed * 17 + i)


# ---------------------------------------------------------------------------
# THE PLATFORM
# ---------------------------------------------------------------------------

def plinth(mb, tier, screen=False):
    """Four courses of a 24-gon platform, and the stylobate laid as blocks.

    The three lower courses are single prisms because they are mostly buried on
    most sites and are wholly buried on a flat one, so per-block authoring there
    buys nothing a player will ever see. The TOP course is 24 individual blocks,
    because it is the one at eye level, it is the outline that reads at 200 m,
    and settlement in it is the single most legible thing on the asset."""
    for (i, (z0, z1, r)) in enumerate(COURSES[:-1]):
        mb.cylinder(r, z1 - z0, (0.0, 0.0, (z0 + z1) * 0.5), axis="Z",
                    segments=SIDES, role=STONE_D if i == 0 else STONE,
                    smooth_sides=False)
    z0, z1, r = COURSES[-1]
    if screen:
        # THE SCREEN TIER LAYS THE STYLOBATE AS ONE PRISM. Its face is set at
        # the MEAN inset of the 24 settled blocks rather than at the nominal
        # radius, so the tier's error is the settlement SPREAD (worst 0.18 m)
        # and not the settlement itself. See build_form for why LOD2 is allowed
        # a saving the layer ladder would not admit.
        mb.cylinder(r - 0.09, z1 - z0, (0.0, 0.0, (z0 + z1) * 0.5), axis="Z",
                    segments=SIDES, role=STONE, smooth_sides=False)
        return _plinth_skin(mb, tier)
    # The deck inside the stylobate ring. One prism, because a paved deck's
    # joints are a Panel job and its mass is not.
    mb.cylinder(r - 1.55, z1 - z0, (0.0, 0.0, (z0 + z1) * 0.5), axis="Z",
                segments=SIDES, role=STONE, smooth_sides=False)

    step = 360.0 / SIDES
    chord = 2.0 * r * math.sin(math.radians(step * 0.5))
    thick = 1.55
    for i in range(SIDES):
        deg = (i + 0.5) * step
        # SETTLEMENT IS INWARD AND DOWNWARD ONLY, WHICH IS BOTH TRUE AND
        # REQUIRED. True, because a block on a failing bed drops into the fill
        # and rotates toward the void behind it; required, because outward
        # movement is the one thing that could reach R_KEEP and take the
        # ground pivot's AABB with it.
        d = damage(r * math.cos(math.radians(deg)), r * math.sin(math.radians(deg)))
        drop = (0.03 + _rng(7, i, 1) * 0.09) * (0.5 + d)
        inset = (0.02 + _rng(7, i, 2) * 0.10) * (0.5 + d)
        yaw = sf.jitter(2.4, 7, i, 3) * (0.4 + d)
        mid = r - thick * 0.5 - inset
        c = sf.point("Z", (0, 0, 0), (z0 + z1) * 0.5 - drop, deg, mid)
        rd = sf.radial("Z", deg + yaw)
        tg = sf.tangent("Z", deg + yaw)
        sf.oriented_box(mb, c, tg, rd, (0.0, 0.0, 1.0),
                        (chord * 0.985, thick, z1 - z0), STONE)
        # THE BLOCK'S OWN WEATHERING GOES ON THE BLOCK'S OWN FACE. A `Shell` at
        # the course's nominal radius cannot follow 24 blocks that have each
        # settled inward by a different amount, and the sweep measured that as
        # 269.43 mm across the whole stylobate ring. `Slab` in the block's own
        # frame is exact and costs nothing extra.
        face = Slab(tuple(c[k] + rd[k] * thick * 0.5 for k in range(3)),
                    tg, (0.0, 0.0, 1.0), rd, min_layer=tier)
        sv = shade(rd[0], rd[1], (z0 + z1) * 0.5)
        growth_patch(face, mb, -chord * 0.42, chord * 0.42,
                     -(z1 - z0) * 0.34, (z1 - z0) * 0.34, sv, MOSS, LICHEN,
                     seed=int(201 + i), n=3)
        spall(face, mb, -chord * 0.42, chord * 0.42,
              -(z1 - z0) * 0.34, (z1 - z0) * 0.34, d, seed=int(231 + i), n=3)
    _plinth_skin(mb, tier)


def _plinth_skin(mb, tier):
    """Everything on the platform that is a greeble rather than a course.

    EVERY PART IS PLACED ON ITS OWN COURSE'S RADIUS AND INSIDE ITS OWN COURSE'S
    z BAND, and both halves of that are corrections rather than care. The first
    version ran one `Shell` at `R_DECK` for all four courses, which buried
    every joint 180 to 340 mm inside the course it was meant to be scribed on
    (the courses batter back by 40 mm a time), and it hung the moss and the
    silt band up to 4.15 m, which is 0.85 m ABOVE the top of the plinth face,
    in mid air. `check_shadow_lod.py` measured the pair at 1134.94 mm and
    `/tmp` bisection attributed 26 of the worst clusters to this function."""
    step = 360.0 / SIDES
    # COURSE 3 IS NOT HERE. It is the stylobate, it is 24 separately settled
    # blocks rather than a prism, and its skin is emitted in `plinth` on each
    # block's own face; a shared Shell at the nominal radius cannot follow it.
    for (ci, (z0, z1, r)) in enumerate(COURSES[:-1]):
        chord = 2.0 * r * math.sin(math.radians(step * 0.5))
        # TWO SHELLS PER COURSE AND THE SPLIT IS THE POINT. `ring` carries the
        # course seam, which is a `hull_tube` and wants the course's VERTEX
        # radius; `sh` carries every plate, and a plate lies on the facet, so
        # it wants `facet_r`. See that function for the 150 mm this is worth
        # and for why it is reported upward rather than fixed in `Shell`.
        sh = sf.Shell("Z", (0, 0, 0), facet_r(r, SIDES), 1, min_layer=tier,
                      sides=SIDES)
        if ci:
            # The bed joint at the BOTTOM of this course, on this course's own
            # face. Course 0's is under the soil on every admitted site.
            ring = sf.Shell("Z", (0, 0, 0), r, 1, min_layer=tier, sides=SIDES)
            ring.girth(mb, z0, 0.10, STONE_D, kind="seam", segs=SIDES)
        if ci < 2:
            # NO SKIN ON THE TWO LOWEST COURSES. Course 0 spans z 0.00 to 0.90
            # and course 1 spans 0.90 to 1.72, and `GRADE_Z` is 2.30, so on
            # flat ground - which is most of the band `admit` accepts - BOTH
            # are entirely under the soil. They only appear at all on the
            # downhill side of a tilted site, where they are half covered by
            # the ground they are emerging from. Course 2 straddles grade and
            # is where the skin starts, which is also why the silt band is on
            # it: silt banks AT the ground line, and this is the course the
            # ground line runs through.
            continue
        for i in range(SIDES):
            # ON THE FACET CENTRE, NEVER ON A VERTEX BEARING, and this is the
            # other half of what `facet_r` is about. `facet_r` puts a part on
            # the facet PLANE; the bearing decides WHERE on that plane, and a
            # part at a vertex bearing sits facet_r(1 - cos(180/sides)) inside
            # the solid, which is 148 mm on this platform. The first version
            # scribed its block joints at i * step, i.e. exactly on the 24
            # corners, and that alone held Ruin_LOD1 at 155.26 mm. A joint per
            # facet centre says each face is two blocks, which is what a
            # polygonal platform of this size would have been laid as anyway.
            deg = (i + 0.5) * step
            nx = math.cos(math.radians(deg))
            ny = math.sin(math.radians(deg))
            sh.part(mb, (z1 - z0) - 0.16, 0.10, (z0 + z1) * 0.5, deg,
                    "scribe", STONE_D)
            sh_v = shade(nx, ny, (z0 + z1) * 0.5)
            # Silt banks against the LOWEST exposed course and the growth
            # follows it up the face. Both read the same shade term, so they
            # cannot disagree about which side of the building they are on, and
            # both are clamped INTO the course so nothing hangs off its top.
            lo, hi = z0 + 0.28, z1 - 0.28
            if hi <= lo:
                continue
            if sh_v > 0.35:
                # TWO WEDGES OF DIFFERENT HEIGHT, NOT ONE BAND. A single
                # full-chord box at a constant height ran a continuous brown
                # stripe round the whole platform, which reads as paint. Silt
                # banks unevenly against a wall and its top edge is what says
                # so, so each facet gets two pieces at different heights and
                # different widths and the line breaks at every joint.
                for w in range(2):
                    hh = min((0.30 + _rng(9, i, w, 1) * 0.42), hi - lo)
                    sh.part(mb, hh, chord * (0.30 + _rng(9, i, w, 2) * 0.22),
                            lo + hh * 0.5, deg + (w - 0.5) * 5.4, "shim",
                            EARTH)
            for j in range(3):
                if _rng(9, ci, i, j, 4) > sh_v:
                    continue
                sz = min(0.30 + _rng(9, ci, i, j, 5) * 0.5, hi - lo)
                # Arc capped at 1.20 m and the bearing jitter at 1 degree, so
                # half-arc plus offset never exceeds 3 degrees off the facet
                # centre and the worst burial is facet_r(1 - cos 3) = 24 mm,
                # inside cascade 1's 56.25.
                sh.part(mb, sz, min(1.20, 0.35 + _rng(9, ci, i, j, 6) * 0.9),
                        lo + sz * 0.5
                        + (hi - lo - sz) * _rng(9, ci, i, j, 7),
                        deg + sf.jitter(1.0, 9, ci, i, j, 8), "shim",
                        MOSS if _rng(9, ci, i, j, 9) < 0.6 else LICHEN)

    # The paving. Flagstone joints on the deck, on the deepest cheap layer that
    # still reads under a grazing sun, plus the debris that has collected in
    # them where nobody has walked for a very long time. Both are held inside
    # the deck prism's own radius, which is R_DECK - 1.55.
    r_pave = R_DECK - 1.70
    deck = sf.Panel("Z", 1, DECK_Z, min_layer=tier)
    for i in range(-4, 5):
        half = math.sqrt(max(0.0, r_pave ** 2 - (i * 3.4) ** 2))
        deck.part(mb, 0.11, 2.0 * half, i * 3.4, 0.0, "scribe", STONE_D)
        deck.part(mb, 2.0 * half, 0.11, 0.0, i * 3.4, "scribe", STONE_D)
    for i in range(20):
        x = sf.jitter(15.0, 11, i, 1)
        y = sf.jitter(15.0, 11, i, 2)
        if x * x + y * y > (r_pave - 0.8) ** 2:
            continue
        d = damage(x, y)
        deck.part(mb, 0.30 + _rng(11, i, 3) * 0.9, 0.25 + _rng(11, i, 4) * 0.8,
                  x, y, "shim" if _rng(11, i, 5) < 0.5 else "plate",
                  EARTH if _rng(11, i, 6) > d else STONE_L)


def approach(mb, tier, screen=False):
    """The two cheek blocks of a stair whose treads were robbed out.

    See THE STAIR THAT IS NOT HERE in the header. The blocks stand at the +Y
    approach on the stylobate line, they carry the sockets and worn steps of a
    flight that is gone, and they cost eight boxes instead of a stair that would
    have stood outside the footprint gate."""
    z0, z1 = GRADE_Z - 0.26, GRADE_Z + 1.36        # the block's own extent
    for s in (-1.0, 1.0):
        cx = s * 2.30
        mb.box((1.30, z1 - z0 + 0.98, z1 - z0),
               (cx, R_DECK - 1.30, (z0 + z1) * 0.5), STONE)
        f = sf.Panel("Y", 1, R_DECK, min_layer=tier)
        # THE TREAD SOCKETS ARE THE EVIDENCE. Three notches cut for treads that
        # are not there, which is what says "robbed" rather than "never built".
        # Every mark is kept inside [z0, z1]: the first version ran a band to
        # GRADE_Z + 1.45 on a block whose top is GRADE_Z + 1.36, and the 90 mm
        # of overhang was one of the two clusters over cascade 1.
        for k in range(3):
            f.part(mb, 1.05, 0.16, cx, z0 + 0.24 + 0.33 * k, "coaming",
                   STONE_D)
        f.part(mb, 1.10, 0.24, cx, z1 - 0.20, "seam", STONE_D)
        spall(f, mb, cx - 0.5, cx + 0.5, z0 + 0.06, z1 - 0.06, 0.55,
              seed=int(31 + s), n=5)
        growth_patch(f, mb, cx - 0.55, cx + 0.55, z0 + 0.06, z0 + 0.85,
                     shade(0.0, 1.0, GRADE_Z + 0.4), MOSS, LICHEN,
                     seed=int(33 + s), n=6)
    # The treads themselves, at the foot, mostly silted over.
    if screen:
        return
    sf.debris_field(mb, (0.0, R_DECK - 0.9, GRADE_Z - 0.35), (2.9, 0.5, 0.30),
                    9, STONE_D, size=0.55, seed=35)


# ---------------------------------------------------------------------------
# THE PERISTYLE
# ---------------------------------------------------------------------------

def pier_table():
    """Every pier's position and state, decided once and read by geometry AND
    by `collision_boxes`.

    A pier that is drawn standing and has no proxy is a column a player walks
    through, and a proxy with no pier is a wall in the open air. One table, so
    that cannot happen."""
    out = []
    sites = [(x, y) for y in (COL_Y, -COL_Y) for x in COL_X]
    sites += [(END_X, y) for y in END_Y]
    for (i, (x, y)) in enumerate(sites):
        d = damage(x, y) + sf.jitter(0.26, 41, i)
        state = "full" if d < 0.40 else ("snap" if d < 0.62 else "stump")
        out.append((x, y, state, max(0.0, min(1.0, d)), i))
    return out


def pier(mb, tier, x, y, state, dmg, i):
    """One pier: a base, four drums, a capital. Or what is left of one.

    THE SHAFT IS DRUMS AND NOT A COLUMN, and that is the cheap decision that
    pays for everything else. Four stacked frusta at eight sides cost the same
    as one tall one plus two rings, and they buy three things a single prism
    cannot: a real step at every joint that catches a rim light, a per-drum
    phase so no two drums line their facets up, and a per-drum lateral offset,
    which is what a pier that has shifted on its bed looks like and is the
    reason a broken pier here does not read as a snapped pencil."""
    if state == "stump":
        keep = 1
    elif state == "snap":
        keep = 2 + int(_rng(43, i, 1) * 2)
    else:
        keep = DRUMS
    mb.box((PIER_BASE_W, PIER_BASE_W, PIER_BASE_H),
           (x, y, DECK_Z + PIER_BASE_H * 0.5), STONE,
           rot_z=sf.jitter(3.0, 43, i, 2) * (0.3 + dmg))
    z = DECK_Z + PIER_BASE_H
    lean_x = sf.jitter(0.055, 43, i, 3) * (0.3 + dmg)
    lean_y = sf.jitter(0.055, 43, i, 4) * (0.3 + dmg)
    phase0 = _rng(43, i, 0, 6) * 45.0
    for k in range(keep):
        r0 = 0.80 - 0.025 * k
        r1 = 0.80 - 0.025 * (k + 1)
        h = DRUM_H if (k < keep - 1 or state == "full") else \
            DRUM_H * (0.35 + _rng(43, i, k, 5) * 0.55)
        # EACH DRUM CARRIES ITS OWN PHASE, and that phase then governs where
        # its greebles may sit. A phase is what stops eight facets lining up
        # over four drums and making a column read as one extrusion; it is also
        # what makes "put a mark at 60 degrees" wrong, because 60 degrees is
        # some arbitrary point across a facet whose own centre moved.
        phase = _rng(43, i, k, 6) * 45.0
        mb.frustum(r0, r0 - (r0 - r1) * (h / DRUM_H), h,
                   (x + lean_x * k, y + lean_y * k, z + h * 0.5), axis="Z",
                   segments=8, role=STONE,
                   smooth_sides=False, phase_deg=phase)
        # The bed joint between two drums is where the weather gets in, so it
        # is where the growth and the fracture both are.
        sh = sf.Shell("Z", (x + lean_x * k, y + lean_y * k, 0),
                      facet_r(r0, 8), 1, min_layer=tier, sides=8)
        for q in range(3):
            # Snapped to THIS drum's own facet centres, so a mark lies flat on
            # the stone rather than bridging a corner.
            deg = phase + 22.5 + 45.0 * (q * 3 + int(_rng(43, i, k, q, 7) * 2))
            nx = math.cos(math.radians(deg))
            ny = math.sin(math.radians(deg))
            sv = shade(nx, ny, z + h * 0.5)
            # EVERY MARK LIES WHOLLY INSIDE ITS OWN DRUM. `_band` is the same
            # fit `_fit` does for a two-dimensional scatter: a 0.40 m mark hung
            # off a drum's bottom edge ends up 0.10 m inside the base block
            # below it, which is invisible AND 97 to 107 mm of deviation for
            # any tier that drops it. That was the last thing holding this
            # asset's LOD1 out of cascade 1.
            if _rng(43, i, k, q, 8) < sv * 0.8:
                sp, at = _band(z, z + h, 0.16 + _rng(43, i, k, q, 9) * 0.24,
                               0.16)
                if sp:
                    sh.part(mb, sp, DRUM_ARC, at, deg, "shim", MOSS)
            if _rng(43, i, k, q, 10) < dmg * 0.7:
                sp, at = _band(z, z + h, 0.20 + _rng(43, i, k, q, 11) * 0.30,
                               0.25 + _rng(43, i, k, q, 12) * 0.5)
                if sp:
                    sh.part(mb, sp, DRUM_ARC, at, deg, "kick", STONE_L)
        z += h
    if state == "full":
        mb.box((CAP_W, CAP_W, CAP_H),
               (x + lean_x * DRUMS, y + lean_y * DRUMS, z + CAP_H * 0.5),
               STONE, rot_z=sf.jitter(1.6, 43, i, 13))
        top = sf.Panel("Z", 1, z + CAP_H, min_layer=tier)
        for s in (-1, 1):
            top.part(mb, CAP_W * 0.86, 0.09, x, y + s * CAP_W * 0.34, "seam",
                     STONE_D)
        # A bronze cramp still in its socket in the capital: the one piece of
        # worked metal a player can find on the outside of the building, and
        # the thing that says the builders had metallurgy.
        if _rng(43, i, 14) < 0.5:
            top.part(mb, 0.34, 0.09, x + sf.jitter(0.4, 43, i, 15), y, "boss",
                     BRONZE)
    else:
        # A BROKEN SHAFT IS NOT A FLAT CUT. The fracture is the pale interior of
        # the stone standing proud of the weathered skin, tilted, and it is
        # emitted at every tier because at 200 m the difference between a
        # snapped pier and a sawn one is the whole silhouette.
        fr = z
        for q in range(3):
            a = _rng(43, i, q, 16) * 360.0
            rr = 0.62 * (0.45 + _rng(43, i, q, 17) * 0.8)
            sf.oriented_box(
                mb, (x + lean_x * keep + math.cos(math.radians(a)) * 0.22,
                     y + lean_y * keep + math.sin(math.radians(a)) * 0.22,
                     fr + 0.07 + _rng(43, i, q, 18) * 0.16),
                sf.radial("Z", a), sf.tangent("Z", a),
                (math.sin(math.radians(14.0 + _rng(43, i, q, 19) * 22.0)),
                 0.0, math.cos(math.radians(14.0 + _rng(43, i, q, 19) * 22.0))),
                (rr, rr * 0.8, 0.20), STONE_L)
        if dmg > 0.72:
            # THE SCORCH BAND IS DERIVED FROM WHAT IS LEFT OF THE SHAFT, not
            # from three literals. It used to run to DECK_Z + 1.8 regardless of
            # how much pier survived, so on a stump (one drum, top at about
            # 4.7 m) the top mark stood in mid air at 5.375 m, which is one of
            # the four clusters that put Ruin_LOD1 at 1134.94 mm.
            # ON DRUM 0'S FACET CENTRES AND NO WIDER THAN ONE FACET. The
            # first version put three marks at 200, 242 and 284 degrees, which
            # are arbitrary bearings on an eight-sided drum whose own facets
            # start at a hashed phase: a 0.34 m mark at 22.5 degrees off a
            # facet centre bridges the corner and sits 0.78(1 - cos 36) =
            # 147 mm off the stone. That was the last cluster over cascade 1.
            face = sf.Shell("Z", (x, y, 0), facet_r(0.78, 8), 1,
                            min_layer=tier, sides=8)
            # ABOVE THE BASE BLOCK, NOT FROM THE DECK. The base is 1.90 m
            # square and the band sits 0.75 m off the pier axis, so a mark
            # started at deck level was BURIED 0.20 m inside the base: nothing
            # to see and 207.16 mm for a tier that dropped it.
            lo, hi = DECK_Z + PIER_BASE_H + 0.14, fr - 0.34
            for q in range(3):
                sp, at = _band(lo, hi, 0.55, (q + 0.5) / 3.0)
                if not sp:
                    break
                face.part(mb, sp, DRUM_ARC, at,
                          phase0 + 22.5 + 45.0 * (4 + q), "kick", BURNT)


def pier_top(x, y, i, dmg):
    """Where a full pier's capital actually sits, lean included.

    `dmg` IS THE TABLE'S VALUE AND NOT `damage(x, y)`. The table adds a hash
    jitter and clamps to [0, 1], and `pier` builds the lean from THAT, so
    re-deriving it from the raw field here put the entablature up to 31 mm off
    the stone it bears on. Two copies of one number, and the copy nobody was
    looking at was the one the beam used."""
    return (x + sf.jitter(0.055, 43, i, 3) * (0.3 + dmg) * DRUMS,
            y + sf.jitter(0.055, 43, i, 4) * (0.3 + dmg) * DRUMS,
            CAP_TOP)


def spans(table):
    """Adjacent standing piers on the same row: where an architrave survived.

    An entablature cannot span a missing pier, so this is a pure consequence of
    `pier_table` and never a separate list. It is also why the damage field has
    to be smooth: a scatter of independent failures would leave no two full
    piers side by side and the building would have no lintels at all."""
    full = {(x, y): (i, d) for (x, y, s, d, i) in table if s == "full"}
    out = []
    for (x, y) in sorted(full):
        if (x + CELL, y) in full:
            out.append(((x, y) + full[(x, y)],
                        (x + CELL, y) + full[(x + CELL, y)]))
    return out


def entablature(mb, tier, table):
    """The architrave and cornice over every surviving pair, and the stains
    under the cornice that survives.

    THE STAIN IS THE CAUSAL TEST FOR THE WHOLE FILE. Water leaves a building at
    its drip line, so a streak below a cornice is a consequence and a streak
    below open sky is a decal. This function is the only thing that emits either
    a cornice or a stain, and it emits them in the same loop."""
    for ((x0, y0, i0, d0), (x1, y1, i1, d1)) in spans(table):
        p0 = pier_top(x0, y0, i0, d0)
        p1 = pier_top(x1, y1, i1, d1)
        # THE BEAM IS WHERE THE PIERS ARE, NOT WHERE THE GRID IS. Piers lean by
        # up to 0.22 m at the capital, `sag_beam` bears on the leaned capitals,
        # and the first version then hung every greeble off the NOMINAL grid
        # line: the faces were up to 0.22 m from the stone, which is four times
        # cascade 1's texel and was 3 of the 6 worst clusters in the sweep.
        # Everything below is measured off p0 and p1.
        cxm, cym = (p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5
        along_x = abs(y1 - y0) < 1e-6
        seed = 51 + i0
        # Sag is a function of span and of how long this one has been carrying
        # it, and it is a real bow in the soffit. See sag_beam.
        sagm = 0.055 + _rng(seed, 1) * 0.055
        a0 = (p0[0], p0[1], p0[2] + ARCH_H * 0.5)
        a1 = (p1[0], p1[1], p1[2] + ARCH_H * 0.5)
        sag_beam(mb, a0, a1, 1.12, ARCH_H, sagm, STONE, segs=3)
        cz = ARCH_TOP + CORNICE_H * 0.5
        broken = _rng(seed, 2) < 0.30
        if not broken:
            mb.box((abs(x1 - x0) + 1.5 if along_x else 1.72,
                    1.72 if along_x else abs(y1 - y0) + 1.5, CORNICE_H),
                   (cxm, cym, cz), STONE, rot_z=sf.jitter(0.9, seed, 3))
        # EVERY FACE OF THIS BEAM IS DESCRIBED IN THE BEAM'S OWN FRAME, and
        # that is the last correction the shadow sweep forced. Two piers lean
        # independently by up to 0.22 m at the capital, so a 4.00 m span can
        # sit 6.3 degrees off the grid line: its side faces are then not planes
        # of constant y at all, and an axis-aligned `Panel` at the mean was up
        # to 0.22 m off the stone at the ends.
        #
        # THE SOFFIT ALSO BOWS. A plane across the whole span is `sagm`
        # (0.11 m) off its own surface at the ends; restricted to the middle
        # half the drop only ranges 0.75 to 1.00 of `sagm`, so a face at 0.875
        # of it is within 0.125 * sagm = 14 mm everywhere it is used.
        span_m = math.hypot(p1[0] - p0[0], p1[1] - p0[1]) or 1.0
        axv = ((p1[0] - p0[0]) / span_m, (p1[1] - p0[1]) / span_m, 0.0)
        sdv = (-axv[1], axv[0], 0.0)
        upv = (0.0, 0.0, 1.0)
        mid_v = CAP_TOP + ARCH_H * 0.5
        soff = Slab((cxm, cym, p0[2] - sagm * 0.875), axv, sdv,
                    (0.0, 0.0, -1.0), min_layer=tier)
        growth_patch(soff, mb, -span_m * 0.25, span_m * 0.25, -0.40, 0.40,
                     0.85, MOSS, LICHEN, seed=seed + 100, n=4)
        # The two faces of the beam, and the drip stain that only exists where
        # the cornice above it is still shedding water.
        for s in (1, -1):
            side = Slab((cxm + sdv[0] * s * 0.56, cym + sdv[1] * s * 0.56,
                         mid_v), axv, upv,
                        (sdv[0] * s, sdv[1] * s, 0.0), min_layer=tier)
            side.part(mb, span_m * 0.92, 0.10, 0.0, ARCH_H * 0.5 - 0.14,
                      "seam", STONE_D)
            # v starts above the SAGGED soffit, not above the bearing level:
            # at midspan the beam's underside is `sagm` lower than its ends and
            # a chip authored below it hangs in the air.
            spall(side, mb, -span_m * 0.45, span_m * 0.45,
                  -ARCH_H * 0.5 + 0.14, ARCH_H * 0.5 - 0.10, damage(cxm, cym),
                  seed=seed * 3 + s, n=3)
            if broken:
                continue
            for k in range(2):
                stain_run(side, mb,
                          (k - 0.5) * span_m * 0.44 + sf.jitter(0.25, seed, k, 4),
                          ARCH_H * 0.5 - 0.05, -ARCH_H * 0.5 + 0.16,
                          0.24 + _rng(seed, k, 5) * 0.20, STONE_D,
                          seed=seed * 7 + k, n=3)


# ---------------------------------------------------------------------------
# THE CELLA: the one room a player walks into
# ---------------------------------------------------------------------------

# The bay of roof that has gone, and it is placed rather than scattered: it is
# over the stele, so the only daylight in the room falls on the only thing in
# it. Everything else about the interior follows from these two numbers.
HOLE_Y0, HOLE_Y1 = 0.20, 1.75
HOLE_X1 = -10.00            # the surviving stub of that bay bears from here to
#                             the +X wall; the piece from CELLA_X0 to here fell.
ROOF_BAYS = 8
STELE = (-12.10, 0.95)


def cella_shell(mb, tier):
    """Four massive walls, a doorway, and a roof that is intact except where it
    is not.

    THE WALLS ARE SOLID BOXES AND THE ROOM IS THE GAP BETWEEN THEM. That is the
    only way to get an interior without a boolean (`station_form.hull_tube`
    makes the same argument for a tube), and it is also what a 1.00 m ashlar
    wall physically is, so nothing is being worked around."""
    h = CEIL_Z - DECK_Z
    # -X, +Y and -Y are solid. +X carries the door and is emitted as jambs and
    # a lintel through one description, so the opening cannot drift.
    mb.box((CELLA_WALL_T, CELLA_Y1 - CELLA_Y0, h),
           (CELLA_X0 + CELLA_WALL_T * 0.5, 0.0, DECK_Z + h * 0.5), STONE)
    for s in (1, -1):
        mb.box((CELLA_X1 - CELLA_X0 - CELLA_WALL_T, CELLA_WALL_T, h),
               ((CELLA_X0 + CELLA_WALL_T + CELLA_X1) * 0.5,
                s * (CELLA_Y1 - CELLA_WALL_T * 0.5), DECK_Z + h * 0.5), STONE)
    # THE JAMBS RUN FULL HEIGHT AND THE LINTEL ONLY SPANS THE OPENING. The
    # first version stopped the jambs at the lintel soffit, which left the
    # door wall open from |y| = 1.40 out to 6.20 between z = 6.50 and 7.50: a
    # real hole in a real wall, invisible from every exterior angle and worth
    # 360.05 mm of shadow deviation where the ashlar scribed across it.
    for s in (1, -1):
        w = (CELLA_Y1 - CELLA_WALL_T) - DOOR_HW
        mb.box((CELLA_WALL_T, w, h),
               (CELLA_X1 - CELLA_WALL_T * 0.5,
                s * (DOOR_HW + w * 0.5), DECK_Z + h * 0.5), STONE)
    mb.box((CELLA_WALL_T, DOOR_HW * 2.0 + 0.4, CEIL_Z - DOOR_Z1),
           (CELLA_X1 - CELLA_WALL_T * 0.5, 0.0,
            (DOOR_Z1 + CEIL_Z) * 0.5), STONE)

    # The roof. Slabs run in x, the SHORT span, which is what an ancient roof
    # does because stone is weak in bending and a long slab is a fallen slab.
    step = (CELLA_Y1 - CELLA_Y0) / ROOF_BAYS
    for k in range(ROOF_BAYS):
        y0 = CELLA_Y0 + step * k
        y1 = y0 + step
        gone = (y0 < HOLE_Y1 and y1 > HOLE_Y0)
        x0 = HOLE_X1 if gone else CELLA_X0
        if gone and x0 >= CELLA_X1 - 0.2:
            continue
        mb.box((CELLA_X1 - x0, step * 0.985, ROOF_T),
               ((x0 + CELLA_X1) * 0.5, (y0 + y1) * 0.5, CEIL_Z + ROOF_T * 0.5),
               STONE, rot_z=sf.jitter(0.5, 61, k))
    # The parapet, and it is BROKEN over the fallen bay, because the thing that
    # took the slab took the course above it first.
    for k in range(ROOF_BAYS):
        y0 = CELLA_Y0 + step * k
        if y0 < HOLE_Y1 and y0 + step > HOLE_Y0:
            continue
        for (sx, sy) in ((CELLA_X0 + 0.42, None), (CELLA_X1 - 0.42, None)):
            mb.box((0.84, step * 0.96, PARAPET_Z - ROOF_Z),
                   (sx, y0 + step * 0.5, (ROOF_Z + PARAPET_Z) * 0.5), STONE,
                   rot_z=sf.jitter(1.4, 62, k, int(sx)))
    for s in (1, -1):
        mb.box((CELLA_X1 - CELLA_X0, 0.84, PARAPET_Z - ROOF_Z),
               ((CELLA_X0 + CELLA_X1) * 0.5, s * (CELLA_Y1 - 0.42),
                (ROOF_Z + PARAPET_Z) * 0.5), STONE)

    # THE ATTIC FRAGMENT, and it is the tallest thing on the asset. One corner
    # of the front gable is still standing on the door wall; the rest of the
    # gable is in the rubble outside. It exists because a 9 m box has a flat top
    # edge and a ruin should not.
    mb.box((1.30, 5.20, ATTIC_TOP - PARAPET_Z),
           (CELLA_X1 - 0.65, 2.10, (PARAPET_Z + ATTIC_TOP) * 0.5), STONE,
           rot_z=1.2)
    sf.oriented_box(mb, (CELLA_X1 - 0.65, -0.90, PARAPET_Z + 0.55),
                    (1.0, 0.0, 0.0), (0.0, math.cos(math.radians(26.0)),
                                      math.sin(math.radians(26.0))),
                    (0.0, -math.sin(math.radians(26.0)),
                     math.cos(math.radians(26.0))),
                    (1.28, 2.40, 1.05), STONE)


def cella_skin(mb, tier, screen=False):
    """What a player actually looks at: the ashlar, the niches, the water that
    comes through the hole in the roof, and the growth that follows it in.

    THE WHOLE INTERIOR IS ONE CAUSAL CHAIN AND IT IS WORTH FOLLOWING. The bay of
    roof over the stele is gone. Therefore daylight falls there and nowhere
    else, therefore rain falls there and nowhere else, therefore the -X wall
    below the hole is stained and the floor under it is silted and the only
    growth in the room is in that patch. Every other surface in here is dry,
    dark, and marked only by age. A room where the moss was everywhere would say
    the roof was gone everywhere, which would be a different building."""
    walls = ((sf.Panel("X", 1, IN_X0, min_layer=tier), "X", 1.0),
             (sf.Panel("X", -1, IN_X1, min_layer=tier), "X", -1.0),
             (sf.Panel("Y", 1, IN_Y0, min_layer=tier), "Y", 1.0),
             (sf.Panel("Y", -1, IN_Y1, min_layer=tier), "Y", -1.0))
    for (wi, (p, ax, sgn)) in enumerate(walls):
        u0, u1 = (IN_Y0, IN_Y1) if ax == "X" else (IN_X0, IN_X1)
        door = (ax == "X" and sgn < 0.0)

        def hosted(u, v, _door=door):
            """Is there wall behind (u, v)? ONLY THE DOOR WALL SAYS NO.

            `build_space_station._hosted` in miniature, and it is here for the
            same measured reason: the first version scribed ashlar straight
            across the doorway, so a course seam's mid vertices hung 1.20 m
            from the nearest jamb in open air. Invisible in every render taken
            from outside, and 1002.50 mm of shadow deviation."""
            return (not _door) or v >= DOOR_Z1 or abs(u) >= DOOR_HW

        def clear(v, _door=door):
            """`[u0, u1]` with the opening cut out of it, INSET 50 mm so a
            clipped seam's end face does not land on the plane the jamb's own
            end face already occupies (the station traded a shadow defect for
            a coplanar one exactly there)."""
            if not _door or v >= DOOR_Z1:
                return [(u0, u1)]
            return [(u0, -DOOR_HW - 0.05), (DOOR_HW + 0.05, u1)]

        # Ashlar: five courses, joints staggered per course, which is what
        # stops a wall of joints reading as a grid.
        # FIVE COURSES THAT FIT UNDER THE CEILING. The top course's vertical
        # joints used to reach v + 0.78 = 7.60, which is 100 mm INSIDE the roof
        # slab: buried, invisible, and exactly 100.00 mm of deviation for a
        # tier that drops them.
        n_course = int((CEIL_Z - 0.10 - (DECK_Z + 0.42)) / 0.78)
        for c in range(n_course):
            v = DECK_Z + 0.42 + c * 0.78
            for (a, b) in clear(v):
                if b - a < 0.30:
                    continue
                p.part(mb, (b - a) * 0.985, 0.075, (a + b) * 0.5, v, "scribe",
                       STONE_D)
            n = 5
            for j in range(n):
                u = u0 + (u1 - u0) * ((j + 0.5 + (0.5 if c % 2 else 0.0)) / n)
                if u <= u0 + 0.2 or u >= u1 - 0.2:
                    continue
                # BOTH ENDS OF THE JOINT ARE TESTED, not its centre. A 0.74 m
                # vertical joint whose midpoint clears the opening by 0.1 m
                # still runs 0.27 m into it, which is `_clear_spans`'s
                # midpoint-is-not-an-overlap-test one storey down.
                if not (hosted(u, v) and hosted(u, v + 0.78)):
                    continue
                p.part(mb, 0.075, 0.74, u, v + 0.39, "scribe", STONE_D)
        spall(p, mb, u0 + 0.3, u1 - 0.3, DECK_Z + 0.2, CEIL_Z - 0.3, 0.35,
              seed=71 + wi, n=4, hosted=hosted)
    west, east, south, north = (w[0] for w in walls)

    # THREE NICHES in the -Y wall: additive coamings, because nothing here cuts.
    for k in range(3):
        south.coaming(mb, 1.10, 1.55, -12.0 + k * 3.0, DECK_Z + 1.85, STONE_D,
                      rail=0.11)
        south.part(mb, 1.14, 0.13, -12.0 + k * 3.0, DECK_Z + 1.05, "boss",
                   STONE_D)

    # The doorway's own reveal and the threshold a very long queue of feet wore.
    # ON THE JAMB, NOT IN THE GAP. The reveal bands used to sit at
    # |u| = DOOR_HW - 0.08, i.e. 80 mm INSIDE an opening whose stone starts at
    # DOOR_HW, and the lintel band at v = DOOR_Z1 - 0.10, i.e. 100 mm below the
    # soffit. Both were floating in the doorway.
    for s in (1, -1):
        east.part(mb, 0.16, DOOR_Z1 - DECK_Z - 0.2, s * (DOOR_HW + 0.10),
                  DECK_Z + (DOOR_Z1 - DECK_Z) * 0.5, "coaming", STONE_D)
    east.part(mb, DOOR_HW * 2.0 + 0.4, 0.20, 0.0, DOOR_Z1 + 0.13, "coaming",
              STONE_D)
    floor = sf.Panel("Z", 1, DECK_Z, min_layer=tier)
    floor.part(mb, 0.55, DOOR_HW * 2.0 - 0.1, IN_X1 - 0.28, 0.0, "shim",
               STONE_L)

    # THE HOLE IN THE ROOF, AND EVERYTHING DOWNSTREAM OF IT.
    hy = (HOLE_Y0 + HOLE_Y1) * 0.5
    for k in range(4):
        stain_run(west, mb, hy + sf.jitter(0.55, 81, k), CEIL_Z - 0.15,
                  DECK_Z + 0.10, 0.34 + _rng(81, k, 2) * 0.26, STONE_D,
                  seed=83 + k, n=5)
    growth_patch(west, mb, hy - 1.6, hy + 1.6, DECK_Z + 0.05, DECK_Z + 1.9,
                 0.85, MOSS, LICHEN, seed=85, n=7)
    growth_patch(floor, mb, IN_X0, IN_X0 + 3.2, hy - 1.8, hy + 1.8, 0.8,
                 MOSS, LICHEN, seed=86, n=7)
    # The silt cone under the hole, and the fragments of the slab that fell.
    if not screen:
        sf.debris_field(mb, (HOLE_X1 - 1.6, hy, DECK_Z + 0.16),
                        (1.9, 0.9, 0.10), 14, STONE_L, size=0.42, seed=87)
        sf.debris_field(mb, (HOLE_X1 - 1.2, hy, DECK_Z + 0.08),
                        (2.4, 1.2, 0.05), 12, EARTH, size=0.34, seed=88)
    for k in range(3):
        a = 18.0 + k * 27.0
        sf.oriented_box(mb, (HOLE_X1 - 2.2 - k * 1.5, hy + sf.jitter(0.7, 89, k),
                             DECK_Z + 0.30),
                        (math.cos(math.radians(a)), 0.0,
                         math.sin(math.radians(a))),
                        (0.0, 1.0, 0.0),
                        (-math.sin(math.radians(a)), 0.0,
                         math.cos(math.radians(a))),
                        (1.9 + _rng(89, k, 2) * 1.1, 1.35, 0.62), STONE)
    # The ceiling a player looks up at, and the sagging bed joints in it.
    ceil = sf.Panel("Z", -1, CEIL_Z, min_layer=tier)
    step = (CELLA_Y1 - CELLA_Y0) / ROOF_BAYS
    for k in range(ROOF_BAYS + 1):
        y = CELLA_Y0 + step * k
        if HOLE_Y0 - step < y < HOLE_Y1 + step:
            continue
        ceil.part(mb, IN_X1 - IN_X0 - 0.2, 0.10, (IN_X0 + IN_X1) * 0.5, y,
                  "seam", STONE_D)
    _ = (east, north)


def stele(mb, tier):
    """The focal feature, and the thing the investigate interaction will hang
    off when a later lane wires it.

    IT IS NOT CENTRED AND IT IS NOT UPRIGHT. It stands 0.95 m off the room's
    axis, under the hole in the roof rather than on the centreline, and it
    leans 4 degrees, because a monument that has stood on a settling bed for
    a thousand years leans. The pivot rule is satisfied by the platform below
    it, so the stele is free to be the asymmetric thing in the room."""
    x, y = STELE
    mb.box((3.20, 2.30, 0.32), (x, y, DECK_Z + 0.16), STONE)
    mb.box((2.55, 1.75, 0.28), (x, y, DECK_Z + 0.46), STONE, rot_z=2.4)
    lean = math.radians(4.0)
    h = 3.05
    cz = DECK_Z + 0.60 + h * 0.5
    up = (math.sin(lean), 0.0, math.cos(lean))
    fwd = (math.cos(lean), 0.0, -math.sin(lean))
    sf.oriented_box(mb, (x + math.sin(lean) * h * 0.5, y, cz),
                    fwd, (0.0, 1.0, 0.0), up, (0.62, 1.55, h), STONE)
    # The inscribed face, turned toward the door so a player reads it on the
    # way in. The bands are carved rules and the disc is the bronze inlay: the
    # one bright thing in a dark room, and the obvious place to press.
    #
    # ON A `Slab`, IN THE STELE'S OWN FRAME, BECAUSE THE STELE LEANS. A vertical
    # `Panel` at the face's mean x is 107 mm off the real face at the top and
    # the bottom, which is twice cascade 1's texel for the sake of one plane
    # that was easier to type. `u` is metres across the face and `v` is metres
    # up it, both measured from the face's own centre.
    face = Slab((x + math.sin(lean) * h * 0.5 + fwd[0] * 0.31, y,
                 cz + fwd[2] * 0.31), (0.0, 1.0, 0.0), up, fwd,
                min_layer=tier)
    for k in range(6):
        vv = -1.05 + k * 0.34
        face.part(mb, 1.24, 0.055, 0.0, vv, "scribe", STONE_D)
        # VARIED WIDTHS AND HEIGHTS. Four identical squares per row read as a
        # row of bolt heads, which is the one thing an inscription must not
        # look like; a script has letterforms of different widths and that is
        # nearly all of what makes a band of marks read as writing.
        for j in range(5):
            face.part(mb, 0.055 + _rng(91, k, j, 1) * 0.115,
                      0.09 + _rng(91, k, j, 2) * 0.12,
                      -0.48 + j * 0.24 + sf.jitter(0.035, 91, k, j),
                      vv + sf.jitter(0.018, 91, k, j, 3), "shim", STONE_D)
    face.part(mb, 0.62, 0.62, 0.0, 1.15, "boss", BRONZE)
    face.part(mb, 0.40, 0.40, 0.0, 1.15, "gauge", BRONZE)
    spall(face, mb, -0.6, 0.6, -1.20, 1.40, 0.30, seed=93, n=3)
    growth_patch(face, mb, -0.7, 0.7, -1.45, -0.75, 0.55, MOSS, LICHEN,
                 seed=94, n=4)


# ---------------------------------------------------------------------------
# WHAT CAME DOWN
# ---------------------------------------------------------------------------

def collapse(mb, tier, table, screen=False):
    """The material from the piers and beams that are gone, lying where it fell.

    RUBBLE IS PLACED UNDER THE THING THAT IS MISSING, which is the difference
    between debris and dressing. Every mound here is keyed to a pier site whose
    state is `stump` or `snap`, so a player standing among the fallen stone is
    standing where the building used to be, and the intact side of the plinth is
    swept clean because nothing above it came down."""
    for (x, y, state, dmg, i) in table:
        if state == "full":
            continue
        n = 7 if state == "snap" else 13
        off = 1.4 + _rng(101, i, 1) * 1.6
        a = math.radians(_rng(101, i, 2) * 360.0)
        # The pile falls AWAY from the blast, which is the direction the load
        # came from. One dot product, and it is why the rubble reads as thrown
        # rather than as stacked.
        bx, by = x - BLAST[0], y - BLAST[1]
        bl = math.hypot(bx, by) or 1.0
        cx = x + bx / bl * off + math.cos(a) * 0.6
        cy = y + by / bl * off + math.sin(a) * 0.6
        cx, cy = inboard(cx, cy, math.hypot(2.4, 2.4) + 0.75)
        if not screen:
            sf.debris_field(mb, (cx, cy, DECK_Z + 0.30), (1.9, 1.9, 0.24), n,
                            STONE if _rng(101, i, 3) < 0.7 else STONE_D,
                            size=0.62, seed=103 + i)
            sf.debris_field(mb, (cx, cy, DECK_Z + 0.10), (2.4, 2.4, 0.05),
                            n // 2, EARTH, size=0.40, seed=131 + i)
        # The drums of the shaft, lying where they rolled. A cylinder on its
        # side is the single most legible piece of fallen classical stone there
        # is and it costs 40 triangles.
        for k in range(2 if state == "snap" else 3):
            da = _rng(101, i, k, 4) * 360.0
            dx = cx + math.cos(math.radians(da)) * (0.9 + k * 0.85)
            dy = cy + math.sin(math.radians(da)) * (0.9 + k * 0.85)
            dx, dy = inboard(dx, dy, 0.85)
            mb.frustum(0.78, 0.72, 1.02, (dx, dy, DECK_Z + 0.39),
                       axis="X" if _rng(101, i, k, 5) < 0.5 else "Y",
                       segments=8, role=STONE, smooth_sides=False,
                       phase_deg=_rng(101, i, k, 6) * 45.0)
        if dmg > 0.75:
            # Blackened stone, and it is ONLY where the fire was hottest. A
            # ruin that is uniformly sooty has no event in it.
            deck = sf.Panel("Z", 1, DECK_Z, min_layer=tier)
            for k in range(4):
                deck.part(mb, 1.1 + _rng(101, i, k, 7) * 1.5,
                          0.9 + _rng(101, i, k, 8) * 1.4,
                          cx + sf.jitter(1.5, 101, i, k, 9),
                          cy + sf.jitter(1.5, 101, i, k, 10), "shim", BURNT)

    # THE ONE FALLEN ARCHITRAVE THAT LANDED IN ONE PIECE, and it is the piece of
    # storytelling the debris fields cannot do: a 4 m beam lying across the deck
    # says a building, and a heap of fragments says a quarry.
    # THE GROWTH ON THEM GOES THROUGH `Slab` AND NOT `Panel`, and that is the
    # fourth of the four causes `check_shadow_lod` caught. These beams are
    # YAWED, so "1.6 m along world X from the centre" is not a point on a beam
    # yawed 63 degrees at all; it is a point 1.4 m to one side of it, and a
    # coarse tier that dropped the moss measured that whole gap.
    for (k, (bx, by, ang)) in enumerate(((6.4, -6.9, 24.0), (11.2, 2.2, -63.0),
                                         (1.6, -9.4, 8.0))):
        a = math.radians(ang)
        tilt = math.radians(4.0 + _rng(151, k) * 9.0)
        ln = 3.6 + _rng(151, k, 1) * 0.8
        u = (math.cos(a) * math.cos(tilt), math.sin(a) * math.cos(tilt),
             math.sin(tilt))
        v = (-math.sin(a), math.cos(a), 0.0)
        w = (-math.cos(a) * math.sin(tilt), -math.sin(a) * math.sin(tilt),
             math.cos(tilt))
        c = (bx, by, DECK_Z + 0.62)
        sf.oriented_box(mb, c, u, v, w, (ln, 1.10, 0.84), STONE)
        top = Slab(tuple(c[j] + w[j] * 0.42 for j in range(3)), u, v, w,
                   min_layer=tier)
        growth_patch(top, mb, -ln * 0.42, ln * 0.42, -0.45, 0.45,
                     shade(v[0], v[1], DECK_Z + 1.0) + 0.3,
                     MOSS, LICHEN, seed=153 + k, n=5)
        spall(top, mb, -ln * 0.45, ln * 0.45, -0.47, 0.47, 0.8,
              seed=157 + k, n=4)


# ---------------------------------------------------------------------------
# COLLISION. One function, and the only place the proxy philosophy lives.
# ---------------------------------------------------------------------------

DECK_STEPS = 7


def deck_steps():
    """Half-extents (x, y) of the rectangles whose union approximates the round
    deck, with every inside corner the same distance short of the wall.

    THE CLOSED FORM IS `build_space_station.hall_steps`'s AND THE DERIVATION IS
    NOT REPEATED HERE. Its docstring has it in full: placing the corners at
    t_j = asin(sqrt((j + 1) / (M + 1))) equalises the shortfall at every inside
    corner and leaves R(1 - sqrt(M / (M + 1))). It is re-implemented rather
    than imported because that file is a build script for a different asset and
    importing it would run its module-level asserts about a station's hull.

    Seven steps on a 17.12 m deck stop the player 1.09 m short of the visible
    edge, which is the SAME stand-off the station shipped at 8.10 m on three
    steps. The cost of halving it again is another doubling of the box count,
    and the fix that takes it to zero is a per-proxy rotation surviving into the
    client, not more steps."""
    out = []
    for j in range(DECK_STEPS):
        t = math.asin(math.sqrt((j + 1.0) / (DECK_STEPS + 1.0)))
        out.append((R_DECK * math.cos(t), R_DECK * math.sin(t)))
    return out


DECK_STANDOFF = R_DECK * (1.0 - math.sqrt(DECK_STEPS / (DECK_STEPS + 1.0)))
assert DECK_STANDOFF < 1.20, (
    "%d steps stop the player %.4f m short of the platform edge; a plinth "
    "nobody can reach the edge of is a different defect wearing the same hat"
    % (DECK_STEPS, DECK_STANDOFF))


def collision_boxes(table):
    """(name, size, loc) for every proxy, from the same constants the visible
    geometry uses.

    NO NAME MAY END IN UNDERSCORE-DIGITS. `web/scripts/check-proxies.mjs`
    refuses it outright, and the reason is worth the sentence: three.js names
    the split primitives of a multi-material mesh `Name_0`, `Name_1`, ..., so
    the client's proxy readers strip a trailing `_<digits>` to keep a
    two-material box as one box. A proxy genuinely named `col_Pier_1` therefore
    collapses onto `col_Pier` and silently deletes `col_Pier_2` and everything
    after it. `col_Pier1` is fine and `col_Pier_1` is a missing wall."""
    floors, walls, ceils = [], [], []

    # The platform deck. `DECK_STEPS` rectangles, corners on the circle.
    for (i, (ax, by)) in enumerate(deck_steps()):
        floors.append(("col_PlinthDeck%s" % "ABCDEFGH"[i],
                       (ax * 2.0, by * 2.0, 0.60),
                       (0.0, 0.0, DECK_Z - 0.30)))

    # The cella. Floor comes free: the deck steps already cover it (step A
    # reaches |x| <= 14.83, |y| <= 8.56 and the room is inside that), so the
    # room's floor and the platform's are the same slab, which is what they are
    # in the geometry too.
    h = CEIL_Z - DECK_Z
    walls.append(("col_CellaWallW", (CELLA_WALL_T, CELLA_Y1 - CELLA_Y0, h),
                  (CELLA_X0 + CELLA_WALL_T * 0.5, 0.0, DECK_Z + h * 0.5)))
    for (s, tag) in ((1.0, "N"), (-1.0, "S")):
        walls.append(("col_CellaWall%s" % tag,
                      (CELLA_X1 - CELLA_X0, CELLA_WALL_T, h),
                      ((CELLA_X0 + CELLA_X1) * 0.5,
                       s * (CELLA_Y1 - CELLA_WALL_T * 0.5), DECK_Z + h * 0.5)))
    # THE DOORWAY IS JAMBS AND A LINTEL, NOT A WALL WITH A HOLE IN IT, because
    # an axis-aligned box set cannot express a hole. Same emitter shape as the
    # station's bulkhead frames and for the same reason.
    jw = (CELLA_Y1 - CELLA_WALL_T) - DOOR_HW
    for (s, tag) in ((1.0, "L"), (-1.0, "R")):
        walls.append(("col_CellaJamb%s" % tag,
                      (CELLA_WALL_T, jw, DOOR_Z1 - DECK_Z),
                      (CELLA_X1 - CELLA_WALL_T * 0.5, s * (DOOR_HW + jw * 0.5),
                       DECK_Z + (DOOR_Z1 - DECK_Z) * 0.5)))
    ceils.append(("col_CellaLintel",
                  (CELLA_WALL_T, DOOR_HW * 2.0 + 0.4, CEIL_Z - DOOR_Z1),
                  (CELLA_X1 - CELLA_WALL_T * 0.5, 0.0,
                   (DOOR_Z1 + CEIL_Z) * 0.5)))

    # The ceiling, in three pieces WITH THE HOLE IN IT. A player cannot leave
    # through it (0.828 m of jump against 4.20 m of room) but the hole is where
    # the light and the rain come in, and a proxy that plastered over it would
    # be the collision set disagreeing with the picture.
    ceils.append(("col_CellaRoofS",
                  (CELLA_X1 - CELLA_X0, HOLE_Y0 - CELLA_Y0, CEIL_PROXY_T),
                  ((CELLA_X0 + CELLA_X1) * 0.5, (CELLA_Y0 + HOLE_Y0) * 0.5,
                   CEIL_Z + CEIL_PROXY_T * 0.5)))
    ceils.append(("col_CellaRoofN",
                  (CELLA_X1 - CELLA_X0, CELLA_Y1 - HOLE_Y1, CEIL_PROXY_T),
                  ((CELLA_X0 + CELLA_X1) * 0.5, (HOLE_Y1 + CELLA_Y1) * 0.5,
                   CEIL_Z + CEIL_PROXY_T * 0.5)))
    ceils.append(("col_CellaRoofE",
                  (CELLA_X1 - HOLE_X1, HOLE_Y1 - HOLE_Y0, CEIL_PROXY_T),
                  ((HOLE_X1 + CELLA_X1) * 0.5, (HOLE_Y0 + HOLE_Y1) * 0.5,
                   CEIL_Z + CEIL_PROXY_T * 0.5)))

    # The stele, blocked as one solid: a player must not stand inside the thing
    # they are about to be asked to investigate.
    walls.append(("col_Stele", (3.30, 2.40, 3.70),
                  (STELE[0] + 0.12, STELE[1], DECK_Z + 1.85)))

    # Every pier that is still standing, and NOTHING for the ones that are not.
    for (x, y, state, _d, i) in table:
        if state == "stump":
            continue
        top = CAP_TOP + (CAP_H if state == "full" else 0.0) if state == "full" \
            else DECK_Z + PIER_BASE_H + DRUM_H * 2.4
        walls.append(("col_Pier%d" % (i + 1),
                      (PIER_BASE_W, PIER_BASE_W, top - DECK_Z),
                      (x, y, (DECK_Z + top) * 0.5)))

    # The surviving entablature, overhead, at CEIL_PROXY_T or better. A player
    # walks under these, so R48 applies to them exactly as it applies to a
    # ceiling.
    for (k, ((x0, y0, _i0, _d0), (x1, y1, _i1, _d1))) in enumerate(spans(table)):
        ceils.append(("col_Beam%d" % (k + 1),
                      (abs(x1 - x0) + 1.2 if abs(y1 - y0) < 1e-6 else 1.30,
                       1.30 if abs(y1 - y0) < 1e-6 else abs(y1 - y0) + 1.2,
                       max(CEIL_PROXY_T, ARCH_H)),
                      ((x0 + x1) * 0.5, (y0 + y1) * 0.5,
                       CAP_TOP + max(CEIL_PROXY_T, ARCH_H) * 0.5)))

    # The three fallen beams a player has to walk round, and the stair cheeks.
    for (k, (bx, by)) in enumerate(((6.4, -6.9), (11.2, 2.2), (1.6, -9.4))):
        walls.append(("col_Fallen%d" % (k + 1), (3.90, 1.40, 1.05),
                      (bx, by, DECK_Z + 0.52)))
    for (k, s) in enumerate((-1.0, 1.0)):
        walls.append(("col_Cheek%d" % (k + 1), (1.30, 2.60, 1.62),
                      (s * 2.30, R_DECK - 1.30, GRADE_Z + 0.55)))

    return floors + walls + ceils


def build_collision(root, table):
    names = []
    for (name, size, loc) in collision_boxes(table):
        # STONE_D rather than the default steel: a proxy's role never reaches a
        # pixel but it DOES count against max_materials, and dragging OF_Steel
        # into a file with no steel in it would cost a slot for nothing.
        of.add_collision_box(name, size, loc, root, role=STONE_D)
        names.append(name)
    return names


# ---------------------------------------------------------------------------
# Sockets
# ---------------------------------------------------------------------------

def build_sockets(root):
    """Four, and `socket_grade` is the one that carries the contract.

    A socket exports as a childless glTF node with a full TRS, and ASSET-SPECS
    2.6 fixes the reading: the socket's local -Y in Blender is its facing, which
    after `export_yup` is the node's local +Z in three.js. An identity rotation
    therefore faces three.js +Z, and `of.deg3(x=-90)` turns that to three.js +Y,
    which is UP. That is the right facing for a grade datum, because what the
    placement lane needs from it is a PLANE and a plane is a point plus a
    normal."""
    of.add_socket("socket_grade", (0.0, 0.0, GRADE_Z), rot=of.deg3(x=-90.0),
                  parent=root, extras={"of_role": "grade"})
    # Where a player arrives: outside the robbed stair, on the +Y approach,
    # facing the building.
    of.add_socket("socket_entry", (0.0, R_DECK - 2.2, DECK_Z),
                  rot=of.deg3(z=180.0), parent=root,
                  extras={"of_role": "spawn"})
    of.add_socket("socket_cella", (-9.8, 0.0, DECK_Z), rot=of.deg3(z=-90.0),
                  parent=root, extras={"of_role": "spawn"})
    # THE INTERACTION POINT, and it is deliberately in front of the stele
    # rather than on it: an interaction volume wants the place a player stands,
    # and 1.62 m is CAPSULE.eyeHeightM, so the socket is at the height the
    # inscription is read from.
    of.add_socket("socket_investigate", (STELE[0] + 1.55, STELE[1],
                                         DECK_Z + 1.62),
                  rot=of.deg3(z=-90.0), parent=root,
                  extras={"of_role": "poi"})


# ---------------------------------------------------------------------------
# Tiers
# ---------------------------------------------------------------------------

def build_form(root, tier, suffix, table, screen=False, breakdown=False):
    """One source for every tier, so two tiers cannot disagree about where
    anything is and re-authoring LOD0 re-authors LOD1 in the same edit.

    `breakdown` prints the per-stage triangle cost. THAT IS NOT DECORATION: a
    budget argued in `contracts.json` against a single total is an argument
    nobody can check, and the next lane that wants 2,000 triangles for
    something needs to know which stage to take them out of."""
    mb = of.MeshBuilder()
    prev, rows = 0, []

    def stage(label, fn):
        fn()
        nonlocal prev
        rows.append((label, mb.tri_count() - prev))
        prev = mb.tri_count()

    stage("platform", lambda: plinth(mb, tier, screen))
    stage("approach", lambda: approach(mb, tier, screen))
    stage("piers", lambda: [pier(mb, tier, x, y, s, d, i)
                            for (x, y, s, d, i) in table])
    stage("entablature", lambda: entablature(mb, tier, table))
    stage("cella shell", lambda: cella_shell(mb, tier))
    stage("cella skin", lambda: cella_skin(mb, tier, screen))
    stage("stele", lambda: stele(mb, tier))
    stage("collapse", lambda: collapse(mb, tier, table, screen))
    if breakdown:
        for (label, n) in rows:
            print("[ruin]   %-14s %6d tris" % (label, n))
    return mb, mb.build(NAME + suffix, root)


def _assert_envelope(mb):
    """The three properties the ground pivot and poi.h between them demand,
    checked off the ACCUMULATED VERTICES rather than off the argument.

    A build that reasons its way to a centred AABB and then emits one block
    0.3 m out of place ships a pivot failure that validate_glb catches after the
    export, in a message about a bounding box, three steps from the cause."""
    lo, hi = mb.bounds()
    assert abs(lo[2]) < 1e-6, (
        "the base plane is at z = %.6f and the ground pivot needs it at 0; the "
        "buried course starts the model" % lo[2])
    for (k, ax) in ((0, "x"), (1, "y")):
        c = (lo[k] + hi[k]) * 0.5
        assert abs(c) < 1e-6, (
            "the AABB centre is %.6f on %s. The buried course is meant to own "
            "the bounding box and something above it has grown past R_BASE"
            % (c, ax))
        assert hi[k] <= R_BASE + 1e-6, (
            "%s reaches %.4f against R_BASE %.4f: the asset is outside its own "
            "footprint gate" % (ax, hi[k], R_BASE))
    worst = 0.0
    for p in mb.verts:
        if p[2] > COURSES[0][1] + 1e-9:
            worst = max(worst, math.hypot(p[0], p[1]))
    assert worst <= R_KEEP + 1e-6, (
        "something above the buried course reaches %.4f m, past R_KEEP %.4f. "
        "Settlement, spall and collapse are inward and downward for exactly "
        "this reason" % (worst, R_KEEP))
    return lo, hi


def main():
    of.reset_scene()
    root = of.add_root(NAME)
    table = pier_table()

    mb0, _ = build_form(root, 0.0, "_LOD0", table, breakdown=True)
    mb1, _ = build_form(root, LOD1_MIN, "_LOD1", table)
    mb2, _ = build_form(root, LOD2_MIN, "_LOD2", table, screen=True)
    lo, hi = _assert_envelope(mb0)

    proxies = build_collision(root, table)
    build_sockets(root)

    of.report(NAME, [(NAME + "_LOD0", mb0), (NAME + "_LOD1", mb1),
                     (NAME + "_LOD2", mb2)])
    for label, mb in ((NAME + "_LOD0", mb0), (NAME + "_LOD1", mb1),
                      (NAME + "_LOD2", mb2)):
        l2, h2 = mb.bounds()
        print("[ruin] %-12s tris %6d  dims_xyz_m [%.4f, %.4f, %.4f]  "
              "blender z[%+.3f %+.3f]"
              % (label, mb.tri_count(), h2[0] - l2[0], h2[2] - l2[2],
                 h2[1] - l2[1], l2[2], h2[2]))
    height = hi[2] - lo[2]
    assert HEIGHT_MIN <= height <= HEIGHT_MAX, (
        "the ruin stands %.4f m and the brief's band is %.1f to %.1f"
        % (height, HEIGHT_MIN, HEIGHT_MAX))
    counts = {}
    for (_x, _y, s, _d, _i) in table:
        counts[s] = counts.get(s, 0) + 1
    print("[ruin] piers %s over %d sites; %d surviving spans"
          % (sorted(counts.items()), len(table), len(spans(table))))
    print("[ruin] %d proxies: %s" % (len(proxies), " ".join(proxies)))
    print("[ruin] platform r %.2f buried / %.2f stylobate, %d facets; "
          "grade z %.2f absorbs %.4f m of rim drop (poi.h needs %.4f)"
          % (R_BASE, R_DECK, SIDES, GRADE_Z, GRADE_Z, RIM_DROP_M))
    print("[ruin] cella clear %.2f x %.2f x %.2f; door %.2f x %.2f; "
          "stylobate step %.2f against stepUp %.2f"
          % (IN_X1 - IN_X0, IN_Y1 - IN_Y0, CELLA_CLEAR, DOOR_HW * 2.0,
             DOOR_Z1 - DECK_Z, STYLOBATE_H, STEP_UP_M))
    print("[ruin] deck proxy stand-off %.4f m at %d steps; overhead proxy "
          "%.2f m (R48 needs 0.75)" % (DECK_STANDOFF, DECK_STEPS,
                                       CEIL_PROXY_T))
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
