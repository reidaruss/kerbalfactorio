"""
build_research_station.py - THE RESEARCH STATION. The field bench D-019 minted
a TypeId for and never gave a mesh, so it has been drawing `assembler.glb`
since 2026-08-11.

    ~/.local/bin/blender501 --background --python tools/blender/build_research_station.py

Produces assets/models/dist/structures/research_station.glb against
`types::ResearchStation = 0x45`.

--------------------------------------------------------------------------
WHAT IT HAS TO BE, AND THE BORROWED MESH IS THE ARGUMENT AGAINST ITSELF
--------------------------------------------------------------------------
`ResearchStations.ts` borrowed the assembler because it "reads most like a
workbench under instruments". The assembler is EIGHT METRES SQUARE. The class
that draws it snaps to a 1.00 m tile (`MachinePlacement.MACHINE_TILE_M`), picks
with a 1.40 m sphere sitting 0.70 m off the ground, and places 2.20 m ahead of
the eye, i.e. it describes an object a person stands at and reaches across. So
the placeholder is not merely un-arted, it is wrong by a factor of four in
plan, and the first thing this file does is take the dimensions off the client
instead of off the borrowed asset.

GP-615 settles what it depicts: the research key is EXISTENCE-gated on a built
station, so the building is the referent for a screen. Everything below is in
service of one sentence - **this is the machine whose whole purpose is a screen
the player opens** - and the console is therefore authored first and the box is
authored around it, rather than the other way round.

--------------------------------------------------------------------------
THE ENVELOPE IS DERIVED FROM THE PICK, AND `_assert_envelope` MEASURES IT
--------------------------------------------------------------------------
Three numbers in `ResearchStations.ts` are load-bearing on the geometry:

    MACHINE_TILE_M       1.00   the metric grid a placement snaps to
    STATION_RADIUS_M     1.40   the pick sphere's radius
    STATION_CENTRE_UP_M  0.70   how far above the pivot that sphere sits

`pick` refuses a ray whose perpendicular distance to that centre exceeds
`STATION_RADIUS_M + 0.5`. So a part of the asset lying further than 1.90 m from
(0, 0, 0.70) is geometry the crosshair CANNOT SELECT: it draws, it blocks the
walker, and aiming at it does nothing. That is not a tolerance, it is a
requirement on the mesh, and it is the one property here that a validator
cannot see, because `contracts.json` measures a bounding box and this is a
sphere. `_assert_envelope` walks the accumulated vertices and refuses the build.

    FOOT   2.00 m   two tiles, so two benches side by side abut exactly
    HEIGHT 2.44 m   DERIVED: the mast stands at (0.60, 0.40), 0.721 m out in
                    plan, so the pick sphere allows it sqrt(1.90^2 - 0.721^2)
                    = 1.757 m of rise above the sphere centre, i.e. z <= 2.457.
                    A 2.60 m mast on a 2.00 m skid is unpickable at the top and
                    looks entirely reasonable in every render.

--------------------------------------------------------------------------
THE SKID OWNS THE BOUNDING BOX. STOLEN FROM build_ruin.py, ON PURPOSE
--------------------------------------------------------------------------
`validate_glb.py`'s default `ground` pivot demands the LOD0 AABB be centred on
x and z to the tolerance, and ART-DIRECTION.md demands asymmetry. The ruin
settled that fight by deciding WHICH element owns the box, and the same
resolution is available here and is better motivated: a field instrument is
skid mounted, the skid is a rectangular pallet because a pallet is what a
forklift and a lashing point understand, and everything bolted to it is placed
where a person needs it rather than where symmetry wants it.

So the skid is exactly 2.00 x 2.00 and exactly centred, `KEEP` is 0.94 and
nothing above `SKID_Z` may reach it, and every `Face` in this file carries
`limit=` so a greeble that would grow the footprint is a NAMED BUILD FAILURE
(machine_form's own contract) rather than a pivot check going red three steps
downstream. The cabinet sits in the +Y half, the bench and the console in the
-Y half, the mast in the +X quarter, and none of them is mirrored.

+Y IS THE BACK AND -Y IS WHERE THE PLAYER STANDS, and that is not a taste
call. `ResearchStations.faceToward` yaws the placed group until its local
three.js +Z points at the eye, and of_lib exports Blender (x, y, z) as glTF
(x, z, -y), so glTF +Z IS BLENDER -Y. The screen, the gauges, the control
shelf, the bench and the step are all on -Y for that reason and the hatch,
the junction box and the cable gland are all on +Y.

--------------------------------------------------------------------------
THE LADDER, AND WHAT THE RUIN'S SEVEN CAUSES COST TO AVOID
--------------------------------------------------------------------------
Every optional detail goes through `station_form.Panel`, which takes its proud
height from `machine_form.LAYER` and silently drops anything below `min_layer`.
Nothing here calls `mb.box` for a detail.

    LOD0   min_layer 0.0
    LOD1   min_layer `clip` 0.061   drops every greeble at or under `hinge`
                                    (0.052), so the predicted worst deviation
                                    is 52 mm and cascades 1 and 2 may draw it
    LOD2   min_layer `bracket` 0.232 plus two structural savings the ladder
                                    would refuse (the sensor heads collapse to
                                    one drum, the bench grating goes), so it is
                                    a SCREEN-DISTANCE tier and is stated as one

build_ruin.py's contract records eight measured causes of LOD1 deviation and
says every one of them was an invisible-geometry bug before it was a shadow
bug. Four of them are structurally impossible here and the other four are
guarded:

  * nothing is placed in open air, because every `Panel` in this file is a real
    face of a real solid and `limit=` bounds it;
  * there is no polygonal hull, so the 24-gon vertex-bearing and facet-splitter
    causes cannot occur (`Shell` is not imported);
  * `_mark` SAMPLES a centre and then CLAMPS the part to the band it is in,
    which is the 207 mm cause fixed at the call rather than at the callee;
  * `_assert_envelope` refuses any vertex outside the pick sphere, which also
    catches the 1134 mm class - a part that has wandered off its host.

--------------------------------------------------------------------------
COLLISION IS FOUR BOXES AND THE BENCH IS SOLID TO THE GROUND
--------------------------------------------------------------------------
The walker is a LINE, not a capsule: three samples at 0.15 / 0.90 / 1.65 m
above the feet, no radius, and `STRUCTURE_STEP_UP_M` is [0.55, 1.10]. A bench
deck 0.10 m thick at 0.92 m would be sampled by exactly one of those three
points and missed by a player standing 60 mm higher up a slope, so the bench
proxy runs from the ground to its own top rather than describing the slab. The
skid proxy is 0.24 m and is deliberately STEPPABLE: 0.24 is well under 1.10, so
a player walks up onto the pallet, which is what a pallet is for.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import machine_form as mf  # noqa: E402
import station_form as sf  # noqa: E402

NAME = "ResearchStation"
OUT = of.dist_path("structures", "research_station.glb")

# ---------------------------------------------------------------------------
# THE ENVELOPE, read out of web/src/game/{MachinePlacement,ResearchStations}.ts
# ---------------------------------------------------------------------------
TILE = 1.00                 # MachinePlacement.MACHINE_TILE_M
FOOT = 2.00                 # two tiles: two benches side by side abut exactly
HALF = FOOT * 0.5
KEEP = HALF - 0.06          # nothing above the skid may reach this
PICK_R = 1.40               # ResearchStations.STATION_RADIUS_M
PICK_UP = 0.70              # ResearchStations.STATION_CENTRE_UP_M
PICK_SLACK = 0.50           # the `+ 0.5` in ResearchStations.pick
PICK_MAX = PICK_R + PICK_SLACK

assert abs(FOOT / TILE - round(FOOT / TILE)) < 1e-9, (
    "the footprint is %.3f m on a %.3f m tile, so two stations placed on "
    "adjacent cells overlap or leave a seam" % (FOOT, TILE))

SKID_Z = 0.24               # the pallet deck: steppable, see the header
DECK_T = 0.06               # the deck plate, and it is the ONLY element that
#                             reaches HALF: see _assert_envelope
RUN_Y = 0.84                # the runners' outer faces, inside KEEP so they can
RUN_X = 0.86                # carry rubbing strips without growing the box
RUN_Z0 = 0.06               # the underside of the frame: only the FEET touch
#                             the ground, so z = 0 carries one role and not
#                             three (check_coplanar.py's own finding)
BENCH_Z = 0.92              # work surface top, a standing person's forearm
HEIGHT = 2.44               # measured back by _assert_envelope

# The cabinet: x0, x1, y0, y1. It is NOT centred and it is not meant to be.
# The two x limits are DERIVED rather than chosen: `eave` mounts its lip on the
# `housing` layer (0.281) and then a shim on top of that, so a face carrying one
# needs 0.300 m of clearance to KEEP, and -0.62 is the widest the cabinet can be
# on the side that gets a drip lip.
CAB_X0, CAB_X1 = -0.62, 0.30
CAB_Y0, CAB_Y1 = 0.10, 0.58
# 1.72 AND NOT 1.58, AND THE BENCH IS WHY. The bench deck runs INTO the
# cabinet at z 0.83 to 0.92, so the front face is only usable above 0.95: a
# control shelf at 0.80 is not low, it is UNDER THE BENCH, which is where the
# first build put the whole switch panel. The band above the bench has to hold
# a 0.15 m shelf, a 0.36 m screen with its coaming and a hood that leans 0.13 m
# above it, which is 0.75 m of face, and 0.24 + 1.48 is what provides it.
CAB_Z1 = 1.72

# The bench, hanging off the cabinet's -Y face on brackets. Its slab runs 0.04 m
# INTO the cabinet rather than butting against it: two solids that share a plane
# are a coplanar pair (check_coplanar.py holds every clean machine at zero), and
# a bench is bolted through a cabinet's side in reality anyway.
BEN_X0, BEN_X1 = -0.60, 0.36
BEN_Y0, BEN_Y1 = -0.74, 0.14
BEN_T = 0.09                # visible slab thickness

# The sensor mast. Its plan position is what sets HEIGHT; see the header.
LAMP_U, LAMP_V = 0.26, 1.62   # the status lamp, clear of the hood
SPIKE_X = -0.60               # the earth rod, clear of the -X levelling pads
MAST_X, MAST_Y = 0.60, 0.40
MAST_W = 0.15
MAST_Z0 = SKID_Z
MAST_Z1 = 2.10              # top of the column; the head goes above it
ARM_Z = 1.98                # the instrument crossarm

_MAST_R = math.hypot(MAST_X, MAST_Y)
_MAST_CEIL = PICK_UP + math.sqrt(max(0.0, PICK_MAX ** 2 - _MAST_R ** 2))
assert HEIGHT <= _MAST_CEIL + 1e-9, (
    "the mast stands at r = %.4f m in plan, so ResearchStations.pick can only "
    "reach z = %.4f; a %.2f m station has an unselectable head"
    % (_MAST_R, _MAST_CEIL, HEIGHT))

# The equipment box on the skid, front right, under the mast.
EQ_X0, EQ_X1 = 0.42, 0.78
EQ_Y0, EQ_Y1 = -0.80, -0.20
EQ_Z1 = 0.70

# ---------------------------------------------------------------------------
# THE TIERS
# ---------------------------------------------------------------------------
LOD1_MIN = mf.LAYER["clip"]         # 0.061: drops every greeble <= hinge
LOD2_MIN = mf.LAYER["bracket"]      # 0.232: drops every greeble <= duct
assert mf.LAYER["hinge"] < 0.05625 < LOD1_MIN, (
    "LOD1 drops greebles up to %.4f m against cascade 1's 56.25 mm texel; the "
    "ladder only earns a cascade while the layer table straddles it"
    % mf.LAYER["hinge"])

# ---------------------------------------------------------------------------
# THE EIGHT ROLES. Every one is already in of_lib.PALETTE and already has a row
# in all three tables check-roles.mjs compares, so this build opens no shared
# file: not of_lib.py, not texgen.py, not surfaces.json, not Surfaces.ts.
# ---------------------------------------------------------------------------
BODY = "Steel"          # the cabinet's coated sheet
FRAME = "SteelDark"     # skid, brackets, mast, everything structural
BRIGHT = "SteelLight"   # hinges, latches, rails, machined fittings
FASCIA = "Accent"       # the instrument fascia and the painted rating plates
HAZ = "Hazard"          # striping, on the one corner a loader hits
CABLE = "Rubber"        # conduit, gland boots, the cable hank
GLASS = "Glass"         # the screen pane and the sky-sensor dome
GLOW = "EmissiveState"  # the screen's backlight and the status lamp


def _face(axis, sign, plane, tier, name):
    """A `Panel` on a real face of a real solid, tier-filtered and BOUNDED.

    `limit` is always `KEEP` (or the ground/height plane), never None, because
    the footprint is what the placement snap is derived from: a greeble that
    would grow it is a build failure by name in machine_form.Face._check rather
    than a pivot check going red after the export."""
    if axis == "X":
        limit = KEEP if sign > 0 else -KEEP
    elif axis == "Y":
        limit = KEEP if sign > 0 else -KEEP
    else:
        limit = HEIGHT if sign > 0 else 0.0
    return sf.Panel(axis, sign, plane, limit=limit, name=name,
                    min_layer=tier)


def _mark(panel, mb, u, v, du, dv, role, band, sat_role=None,
          kind="stain", sat_kind="grime"):
    """A wear mark as TWO overlapping parts on two layers, clamped to its band.

    Both halves are the ruin's, and both are corrections it paid for rather
    than predictions. A single axis-aligned box 20 to 30 mm proud of a flat
    panel reads as SIGNAGE - a crisp rectangle of dirt is as clean as no dirt -
    so the satellite on the layer below breaks the outline for 12 more
    triangles. And `band` is (u0, u1, v0, v1) of the face this is allowed to
    touch, applied by CLAMPING the extent rather than by trusting the sample:
    the ruin's 207 mm deviation was a chip sampled inside a window and then
    sized past it, which is a bug at the call site and is fixed here."""
    u0, u1, v0, v1 = band
    du = min(du, u1 - u0)
    dv = min(dv, v1 - v0)
    u = min(max(u, u0 + du * 0.5), u1 - du * 0.5)
    v = min(max(v, v0 + dv * 0.5), v1 - dv * 0.5)
    panel.part(mb, du, dv, u, v, kind, role)
    if sat_role is None:
        return
    # THE SATELLITE'S LAYER IS PASSED, NOT DERIVED. The first version took the
    # row immediately below `kind` in machine_form.LAYER, which is correct
    # arithmetic and the wrong idea: for `scribe` there IS no row below, so
    # both halves landed on one plane in two roles, and for any other type the
    # row below already belongs to somebody else (a `seam` is a plate strap in
    # SteelDark). `stain` and `grime` are two rows this file added to the table
    # for marks and nothing else mounts on them.
    below = sat_kind
    su, sv = du * 0.52, dv * 0.58
    cu = min(max(u + du * 0.34, u0 + su * 0.5), u1 - su * 0.5)
    cv = min(max(v - dv * 0.28, v0 + sv * 0.5), v1 - sv * 0.5)
    panel.part(mb, su, sv, cu, cv, below, sat_role)


# ---------------------------------------------------------------------------
# 1. THE SKID. The one symmetric element, and the one that owns the AABB.
# ---------------------------------------------------------------------------

def skid(mb, tier):
    # THE DECK PLATE IS THE ONE ELEMENT THAT REACHES `HALF`, and it is exactly
    # centred, so it owns the AABB and every other part of the asset is free to
    # be asymmetric inside `KEEP`. The runners under it are INSET rather than
    # flush for the same reason: an outer face at the footprint edge can carry
    # no greeble at all, because a rubbing strip on it would stand 31 mm proud
    # of the box the placement snap is derived from.
    mb.box((FOOT, FOOT, DECK_T), (0.0, 0.0, SKID_Z - DECK_T * 0.5), FRAME)
    # THE FRAME STOPS AT `RUN_Z0` AND ONLY THE FEET TOUCH THE GROUND, which is
    # both what a skid on levelling feet is and the fix for the single largest
    # defect check_coplanar.py found in the first build: the runners' undersides
    # sat on z = 0 alongside the foot pads and the hazard guard, three roles on
    # one plane, 58 same-facing pairs out of 103.
    for s in (-1, 1):
        mb.box((2.0 * RUN_X, 0.16, 0.12), (0.0, s * (RUN_Y - 0.08),
                                           RUN_Z0 + 0.06), FRAME)
        mb.box((0.14, 2.0 * (RUN_Y - 0.16), 0.10),
               (s * (RUN_X - 0.07), 0.0, RUN_Z0 + 0.05), FRAME)
    # Cross members, visible in the gap under the deck.
    for x in (-0.42, 0.0, 0.42):
        mb.box((0.10, 2.0 * RUN_Y - 0.20, 0.09), (x, 0.0, RUN_Z0 + 0.045),
               FRAME)

    top = _face("Z", 1, SKID_Z, tier, "skid top")
    # A tread pattern on the two strips a person actually stands on, and
    # nowhere else. A field of tread across the whole pallet is the same
    # triangles spent where the cabinet is standing.
    for v in (-0.86, -0.66):
        mf.bolt_run(mb, top, -0.60, 0.20, v, 6, 0.075, BRIGHT, kind="kick")
    # Lashing points: two only, diagonally opposite, because that is how one
    # person with a ratchet strap actually secures a skid.
    for (x, y) in ((-HALF + 0.13, -HALF + 0.13), (HALF - 0.13, HALF - 0.13)):
        top.part(mb, 0.13, 0.13, x, y, "boss", BRIGHT)
        top.part(mb, 0.055, 0.11, x, y, "clip", BRIGHT)

    # Levelling feet. Four pads under the corners, and ONE of them is packed up
    # on a shim, which is the cheapest true thing a field instrument can say
    # about the ground it was set down on.
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        # 0.74 + the pad's own 0.11 radius = 0.85, inside KEEP. The first draft
        # put them at HALF - 0.14 and the pad RIM reached 0.97, which is the
        # cheapest possible illustration of why _assert_envelope measures
        # vertices rather than trusting centres.
        px, py = sx * 0.74, sy * 0.74
        pad = 0.03 if i == 1 else 0.0
        mb.cylinder(0.11, 0.045 + pad, (px, py, (0.045 + pad) * 0.5), axis="Z",
                    segments=8, role=BRIGHT, smooth_sides=False)
        # The post runs from the PAD TOP to the frame, so the only role on the
        # ground plane is the pad's. The first version sized it from z = 0 and
        # put a SteelDark underside on the same plane as four SteelLight ones.
        z0, z1 = 0.045 + pad, RUN_Z0 + 0.06
        mb.box((0.07, 0.07, z1 - z0), (px, py, (z0 + z1) * 0.5), FRAME)

    # The rubbing strips, on the RUNNER faces, and the +X / -Y corner is the
    # one that took the hit. Wear as geometry: this lane owns shape, not paint
    # (machine_form's rule).
    for (axis, sign, plane, u0, u1) in (
            ("Y", -1, -RUN_Y, -RUN_X + 0.06, RUN_X - 0.06),
            ("X", 1, RUN_X, -RUN_Y + 0.06, RUN_Y - 0.06)):
        f = _face(axis, sign, plane, tier, "skid %s%s" % (axis, sign))
        mf.kick_plate(mb, f, u0, u1, SKID_Z - DECK_T - 0.015, 0.09, FRAME,
                      dent=0.55, dent_at=1 if axis == "Y" else -1)
    # THE CORNER GUARD IS STRUCTURE AND NOT A GREEBLE, which is why it is two
    # boxes rather than two Panel parts. A hazard mark's whole job is to be
    # legible from further away than you can read a placard, and every layer in
    # machine_form.LAYER that a painted stripe honestly belongs on (`plate`,
    # 24 mm) is below LOD1's threshold, so a striped panel is a striped panel at
    # arm's length and bare steel at twenty metres. A bolted steel angle round
    # the corner a loader hits is a real part, is emitted at every tier, and
    # carries the colour with it.
    for (sx, sy, dx, dy) in ((1, -1, 0.05, 0.34), (1, -1, 0.34, 0.05)):
        mb.box((dx, dy, 0.16),
               (sx * (RUN_X - dx * 0.5 + 0.012),
                sy * (RUN_Y - dy * 0.5 + 0.012),
                RUN_Z0 + 0.06), HAZ)
    # And the fine stripes on top of it, for the range at which they resolve.
    for (axis, sign, plane, u) in (("Y", -1, -RUN_Y, 0.52),
                                   ("X", 1, RUN_X, -0.52)):
        f = _face(axis, sign, plane, tier, "skid haz %s" % axis)
        for i in range(4):
            f.part(mb, 0.055, 0.07, u + (0.075 * i) * (1 if axis == "Y" else -1),
                   RUN_Z0 + 0.055, "plate", HAZ)
    return mb


# ---------------------------------------------------------------------------
# 2. THE CABINET. Plated, vented, hatched, and drip-lipped.
# ---------------------------------------------------------------------------

def cabinet(mb, tier):
    cx, cy = (CAB_X0 + CAB_X1) * 0.5, (CAB_Y0 + CAB_Y1) * 0.5
    w, d = CAB_X1 - CAB_X0, CAB_Y1 - CAB_Y0
    h = CAB_Z1 - SKID_Z
    mb.box((w, d, h), (cx, cy, SKID_Z + h * 0.5), BODY)
    # CORNER POSTS ON THE CORNER EDGE, half in and half out. A post whose outer
    # face landed ON the sheet's plane would be a coplanar pair with it (two
    # roles, so check_coplanar counts it), and a post pulled fully inside the
    # box would be invisible. Straddling the edge is what a rolled angle
    # section actually does and it cannot share a plane with anything.
    for (px, py) in ((CAB_X0, CAB_Y0), (CAB_X0, CAB_Y1),
                     (CAB_X1, CAB_Y0), (CAB_X1, CAB_Y1)):
        mb.box((0.10, 0.10, h - 0.03), (px, py, SKID_Z + h * 0.5), FRAME)

    front = _face("Y", -1, CAB_Y0, tier, "cabinet front")
    back = _face("Y", 1, CAB_Y1, tier, "cabinet back")
    left = _face("X", -1, CAB_X0, tier, "cabinet left")
    right = _face("X", 1, CAB_X1, tier, "cabinet right")
    top = _face("Z", 1, CAB_Z1, tier, "cabinet top")

    # PLATE COURSES, AND THEY ARE TWO PARTS RATHER THAN ONE THROUGH-STRAP.
    # `machine_form.through_seam` is the cheapest detail in that file because a
    # box long enough to span the body shows on the face it enters and the face
    # it leaves - and it builds that box CENTRED ON THE ORIGIN, which is right
    # for a machine whose body is centred and wrong for a cabinet sitting in the
    # +Y half of a skid. Rather than reproduce it with an offset (a second
    # spelling of somebody else's geometry), the strap is emitted on both faces
    # from the same numbers: 24 triangles instead of 12, and the two still
    # cannot drift, because there is one pair of coordinates.
    for (u_f, u_b) in ((cx - 0.26, cx - 0.26), (cx + 0.22, cx + 0.22)):
        mf.seam_v(mb, front, (u_f,), SKID_Z + 0.05, CAB_Z1 - 0.05, 0.055, FRAME)
        mf.seam_v(mb, back, (u_b,), SKID_Z + 0.05, CAB_Z1 - 0.05, 0.055, FRAME)
    for f in (left, right):
        mf.seam_v(mb, f, (cy - 0.13,), SKID_Z + 0.05, CAB_Z1 - 0.05, 0.05,
                  FRAME)

    # THE VENT BANK IS ON THE COLD SIDE AND THE HATCH IS ON THE BACK, which is
    # the asymmetry that gives the object a service side.
    mf.louvre(mb, left, cy, SKID_Z + 0.86, 0.30, 0.42, 5, FRAME,
              BRIGHT, role_back=CABLE)
    mf.hatch(mb, back, cx + 0.12, SKID_Z + 0.62, 0.46, 0.66, BODY, BRIGHT,
             FASCIA, hinge_side=-1)
    # The junction box and the tray that feeds it, on the back, where a cable
    # from a mast and a cable to a ground spike both have to arrive.
    mf.junction(mb, back, cx - 0.30, SKID_Z + 0.98, 0.24, 0.30, FRAME, BODY)
    mf.tray(mb, back, cx - 0.30, SKID_Z + 0.12, SKID_Z + 0.83, 0.09, 3,
            CABLE, BRIGHT)
    back.part(mb, 0.10, 0.10, cx - 0.30, SKID_Z + 0.06, "boss", BRIGHT)

    # Kick plate, and the same corner takes the dent the skid took.
    mf.kick_plate(mb, front, CAB_X0 + 0.05, CAB_X1 - 0.05, SKID_Z + 0.16,
                  0.13, FRAME, dent=0.4, dent_at=1)
    # The rating plate, canted, and the serial tag beside it.
    mf.placard(mb, back, cx + 0.36, SKID_Z + 1.16, 0.15, 0.10, FASCIA)
    mf.placard(mb, right, cy + 0.02, SKID_Z + 0.42, 0.13, 0.09, FASCIA)

    # THE DRIP LIP IS ON THREE FACES AND NOT FOUR, and the missing one is the
    # front, because the screen hood already lives there and the two would
    # occupy the same air: the hood's top edge stands 0.46 m proud at z 1.52
    # and an eave lip stands 0.28 m proud at z 1.49. Two overhangs crossing is
    # the invisible-geometry failure the ruin catalogued eight causes of, and
    # a cabinet whose display has a hood and whose other three sides have a
    # drip lip is also just what such a cabinet looks like.
    for f in (left, right, back):
        mf.eave(mb, f, (CAB_Y0 if f is not back else CAB_X0) + 0.03,
                (CAB_Y1 if f is not back else CAB_X1) - 0.03, CAB_Z1 - 0.09,
                0.12, 2, FRAME, FRAME, thickness=0.075, drop=0.16)

    # The roof: a shallow crown so water runs off, a lifting eye, and the mast
    # stay's foot. Nothing on a roof is symmetric here either.
    top.part(mb, w - 0.14, d - 0.14, cx, cy, "shim", FRAME)
    top.part(mb, 0.12, 0.12, cx - 0.38, cy, "boss", BRIGHT)
    top.part(mb, 0.05, 0.09, cx - 0.38, cy, "clip", BRIGHT)
    mf.bolt_run(mb, top, cx - w * 0.5 + 0.08, cx + w * 0.5 - 0.08, cy - d * 0.5
                + 0.07, 5, 0.04, BRIGHT)

    # Weathering with a cause: a drip stain runs DOWN from the vent bank's
    # bottom rail and from the hatch's lower coaming, and nowhere else.
    # Drip stains, on the two layers machine_form gained for marks.
    _mark(left, mb, cy, SKID_Z + 0.44, 0.24, 0.30, FRAME,
          (CAB_Y0 + 0.05, CAB_Y1 - 0.05, SKID_Z + 0.20, SKID_Z + 0.64), CABLE)
    _mark(back, mb, cx + 0.12, SKID_Z + 0.20, 0.32, 0.16, FRAME,
          (CAB_X0 + 0.05, CAB_X1 - 0.05, SKID_Z + 0.08, SKID_Z + 0.28), CABLE)
    return mb


# ---------------------------------------------------------------------------
# 3. THE CONSOLE. The reason the asset exists.
# ---------------------------------------------------------------------------

def console(mb, tier):
    """The screen, its hood, and the shelf a person's hands go on.

    THE HOOD IS THE ONE PART THAT IS NOT NEGOTIABLE. A flat pane flush in a
    flat panel is a rectangle on a rectangle at every distance; a hood that
    leans out over it puts a hard horizontal shadow across the screen, gives
    the silhouette a notch, and is exactly what a sunlight-readable field
    display has. `Panel.warped` builds it for the same twelve triangles a flat
    plate costs, which is machine_form's own argument for `placard`.

    THE PANE IS `Glass` OVER `EmissiveState` AND NOT AN EMISSIVE PANE. Glass is
    alpha 0.35 in of_lib.PALETTE, so a lit plate behind it reads THROUGH the
    glass with the bezel's reflection on top, which is what a screen looks
    like. One emissive rectangle is a light, not a display."""
    front = _face("Y", -1, CAB_Y0, tier, "console")
    # THE FRONT FACE IS LAID OUT BOTTOM TO TOP AND EVERY BAND IS INSIDE IT.
    # kick 0.03-0.16, shelf 0.955-1.105, screen 1.18-1.54, hood to 1.69 under a
    # 1.72 top; the label strip is on the -X end because the front has no room
    # left. Everything is above 0.95, because below that the bench is in front
    # of the face and nothing mounted there can be seen at all. The first build put a two-dial gauge cluster at
    # x = 0.30 with a 0.33 m span, so 0.165 m of instrument hung off the +X
    # edge of a cabinet that ends at 0.30 - in open air, measured by
    # check_shadow_lod.py at 74.25 mm of LOD1 deviation, which is the ruin's
    # 207 mm cause exactly: a centre sampled on a face and a size taken past it.
    u, v = -0.14, 1.36           # off centre: the right-hand third is switches
    du, dv = 0.62, 0.36

    # Bezel, pane, backlight. The coaming makes the recess (nothing in this
    # project cuts geometry) and the pane stands inside it.
    #
    # THE THREE LAYERS ARE CHOSEN SO THE SCREEN SURVIVES LOD1, and that is a
    # correction taken off the first build rather than off a gate. The backlight
    # was on `scribe` (6 mm) and the pane on `plate` (24 mm), which are both
    # under LOD1's `clip` threshold, so the one feature the whole asset exists
    # for switched off at the first LOD band and the tier shipped without the
    # `EmissiveState` role at all - visible in of_lib.report's own role list.
    # `tray` (74 mm) and `grille` (98 mm) are the shallowest layers above the
    # threshold that still leave the coaming (108 mm) proud of the glass.
    front.coaming(mb, du, dv, u, v, FRAME, rail=0.055)
    # The lit plate is inset 0.10 inside the pane, so there is a dark border
    # between the glow and the bezel: an emissive rectangle that runs edge to
    # edge under glass reads as a light box rather than as a display.
    # THE LIT PLATE IS EMITTED AT EVERY TIER, LIKE THE HAZARD ANGLE AND FOR THE
    # SAME REASON. It sits exactly where `tray` would put it, so LOD0 and LOD1
    # are unchanged to the vertex; what it buys is LOD2, whose `bracket`
    # threshold drops the bezel, the pane and the hood and would have switched
    # the screen OFF at the range a lit panel is most of what an asset says.
    # An emissive is not a greeble: it is visible at exactly the distances the
    # geometry it is mounted on stops being.
    _pt = mf.layer("tray")
    _pb = -_pt * mf.EMBED
    mb.box((du - 0.10, _pt - _pb, dv - 0.10),
           (u, front.out((_pt + _pb) * 0.5), v), GLOW)
    front.part(mb, du - 0.04, dv - 0.04, u, v, "grille", GLASS)
    # The hood, leaning out as it rises, plus a gusset at each end.
    front.warped(mb, [(u - du * 0.5 - 0.05, v + dv * 0.5 + 0.02, 1.0),
                      (u + du * 0.5 + 0.05, v + dv * 0.5 + 0.02, 1.0),
                      (u + du * 0.5 + 0.05, v + dv * 0.5 + 0.13, 2.35),
                      (u - du * 0.5 - 0.05, v + dv * 0.5 + 0.13, 2.35)],
                 "duct", FRAME)
    for s_ in (-1, 1):
        front.wedge(mb, u + s_ * (du * 0.5 + 0.02), 0.05,
                    v + dv * 0.5 + 0.02, 0.16, 0.17, "bracket", FRAME)

    # The control shelf: a canted fascia at elbow height under the screen.
    sv = 1.03
    front.part(mb, du + 0.18, 0.15, u + 0.02, sv, "duct", FASCIA)
    shelf = sf.Panel("Y", -1, front.out(mf.layer("duct")), limit=-KEEP,
                     name="console shelf", min_layer=tier)
    # Four switch bosses and two rotary knobs, grouped where a hand goes.
    mf.bolt_run(mb, shelf, u - 0.22, u + 0.06, sv, 4, 0.052, BRIGHT,
                kind="boss")
    for i, k in enumerate((0.16, 0.26)):
        shelf.part(mb, 0.062, 0.062, u + k, sv, "gauge",
                   FASCIA if i == 0 else BRIGHT)
    # THE DIAL CLUSTER GOES ON THE +X END, not beside the screen. Its span is
    # 0.13n + 0.07 and the front face has 0.155 m of clear width left of the
    # cabinet edge, so the only face it fits on is the one with 0.48 m of room.
    right_face = _face("X", 1, CAB_X1, tier, "console gauges")
    mf.gauge_cluster(mb, right_face, (CAB_Y0 + CAB_Y1) * 0.5, 1.24, 2, FRAME,
                     BRIGHT)
    # The keyswitch and the label strip: two small round-and-flat shapes that
    # say a person turns this on. The strip is BELOW the shelf rather than
    # behind it: a 24 mm plate inside a 196 mm fascia is invisible geometry.
    front.part(mb, 0.05, 0.05, 0.26, 1.20, "latch", BRIGHT)
    left_face = _face("X", -1, CAB_X0, tier, "console label")
    left_face.part(mb, 0.24, 0.045, (CAB_Y0 + CAB_Y1) * 0.5, 1.48, "plate",
                   FASCIA)
    # The status lamp, clear of the hood's own u range (-0.50 to 0.22), and on
    # the same two layers the screen is on for the same reason: a lamp that goes
    # out at LOD1 is a lamp that is off whenever you are not standing at it.
    front.part(mb, 0.07, 0.07, LAMP_U, LAMP_V, "tray", FRAME)
    front.part(mb, 0.045, 0.045, LAMP_U, LAMP_V, "grille", GLOW)
    return mb


# ---------------------------------------------------------------------------
# 4. THE BENCH. A work surface with a rim, because samples roll.
# ---------------------------------------------------------------------------

def bench(mb, tier):
    bx = (BEN_X0 + BEN_X1) * 0.5
    by = (BEN_Y0 + BEN_Y1) * 0.5
    bw, bd = BEN_X1 - BEN_X0, BEN_Y1 - BEN_Y0
    mb.box((bw, bd, BEN_T), (bx, by, BENCH_Z - BEN_T * 0.5), FRAME)
    # Two legs to the skid at the outer corners, and two gussets into the
    # cabinet at the inner ones: a real bench is carried at four points and
    # only two of them are legs.
    for sx in (-1, 1):
        mb.box((0.075, 0.075, BENCH_Z - BEN_T - SKID_Z),
               (bx + sx * (bw * 0.5 - 0.07), BEN_Y0 + 0.07,
                (SKID_Z + BENCH_Z - BEN_T) * 0.5), FRAME)
    cab_front = _face("Y", -1, CAB_Y0, tier, "bench brackets")
    for sx in (-1, 1):
        cab_front.wedge(mb, bx + sx * (bw * 0.5 - 0.10), 0.07,
                        BENCH_Z - BEN_T, 0.30, 0.26, "bracket", FRAME)

    deck = _face("Z", 1, BENCH_Z, tier, "bench top")
    # The rim, on the two ends ONLY. The +Y edge needs none because the cabinet
    # is the back of the bench, and the -Y edge is open because that is the edge
    # a person sweeps swarf off. A rim all the way round would be a tray.
    for s in (-1, 1):
        deck.part(mb, 0.05, bd - 0.30, bx + s * (bw * 0.5 - 0.03), by - 0.08,
                  "coaming", FRAME)
    # A grating insert in the wet half, and a solid tray in the dry half.
    for i in range(6):
        deck.part(mb, 0.045, 0.40, BEN_X0 + 0.13 + 0.062 * i, by - 0.03,
                  "shim", FRAME)
    deck.part(mb, 0.30, 0.44, BEN_X1 - 0.22, by - 0.02, "plate", BRIGHT)
    deck.part(mb, 0.26, 0.40, BEN_X1 - 0.22, by - 0.02, "scribe", FRAME)
    # A sample clamp: a boss, a post and a jaw, which is three parts that say
    # something gets held still and looked at.
    deck.part(mb, 0.10, 0.10, BEN_X1 - 0.22, by + 0.24, "boss", BRIGHT)
    deck.part(mb, 0.05, 0.05, BEN_X1 - 0.22, by + 0.24, "gauge", BRIGHT)
    deck.part(mb, 0.13, 0.045, BEN_X1 - 0.28, by + 0.24, "duct", BRIGHT)
    # The under-bench drawer, on the front edge where a hand reaches it.
    lip = _face("Y", -1, BEN_Y0, tier, "bench lip")
    lip.part(mb, 0.44, 0.055, bx - 0.10, BENCH_Z - 0.055, "plate", BODY)
    lip.part(mb, 0.17, 0.035, bx - 0.10, BENCH_Z - 0.055, "latch", BRIGHT)
    # Scuffing where forearms rest, clamped to the deck's own band.
    _mark(deck, mb, bx - 0.16, BEN_Y0 + 0.11, 0.34, 0.11, BRIGHT,
          (BEN_X0 + 0.06, BEN_X1 - 0.06, BEN_Y0 + 0.05, BEN_Y1 - 0.08), CABLE)
    return mb


# ---------------------------------------------------------------------------
# 5. THE SENSOR MAST. Antenna-less on purpose: the antenna is 0x46.
# ---------------------------------------------------------------------------

def mast(mb, tier):
    """A met mast, not a comms mast, and the difference is the brief.

    GP-533's scanning antenna is a SEPARATE structure with its own TypeId, its
    own tech and its own price, so a dish on this one would make two buildings
    that look like the same building. What this carries is instruments that
    face the SITE - a shielded thermometer stack, a wind vane, a sky dome - so
    the two masts in the game are told apart at a glance by what is on top."""
    h = MAST_Z1 - MAST_Z0
    mb.box((MAST_W, MAST_W, h), (MAST_X, MAST_Y, MAST_Z0 + h * 0.5), FRAME)
    # The foot: a base plate on the skid, four holding-down bolts, and gussets.
    mb.box((0.30, 0.30, 0.05), (MAST_X, MAST_Y, MAST_Z0 + 0.025), FRAME)
    foot = _face("Z", 1, MAST_Z0 + 0.05, tier, "mast foot")
    mf.bolts(mb, foot, (MAST_X - 0.11, MAST_X + 0.11),
             (MAST_Y - 0.11, MAST_Y + 0.11), 0.05, BRIGHT)
    for (axis, sign, plane) in (("X", -1, MAST_X - MAST_W * 0.5),
                                ("Y", -1, MAST_Y - MAST_W * 0.5)):
        f = _face(axis, sign, plane, tier, "mast gusset")
        u = MAST_Y if axis == "X" else MAST_X
        f.wedge(mb, u, 0.05, MAST_Z0 + 0.40, 0.13, 0.34, "bracket", FRAME)

    west = _face("X", -1, MAST_X - MAST_W * 0.5, tier, "mast -X")
    south = _face("Y", -1, MAST_Y - MAST_W * 0.5, tier, "mast -Y")
    east = _face("X", 1, MAST_X + MAST_W * 0.5, tier, "mast +X")
    # Plate courses up the column, staggered, so it is a fabricated section.
    mf.seam_h(mb, south, (MAST_Z0 + 0.55, MAST_Z0 + 1.28), MAST_X - 0.06,
              MAST_X + 0.06, 0.045, FRAME)
    mf.seam_h(mb, west, (MAST_Z0 + 0.92,), MAST_Y - 0.06, MAST_Y + 0.06,
              0.045, FRAME)
    # Step bosses on ONE face, which is how somebody gets to the instruments.
    for i in range(5):
        east.part(mb, 0.055, 0.05, MAST_Y, MAST_Z0 + 0.42 + 0.30 * i, "rung",
                  BRIGHT)
    # The cable, clipped down the mast and into the cabinet's tray.
    mf.tray(mb, west, MAST_Y + 0.02, MAST_Z0 + 0.20, ARM_Z - 0.06, 0.055, 5,
            CABLE, BRIGHT)

    # THE CROSSARM RUNS PAST THE COLUMN ON ONE SIDE ONLY and carries three
    # instruments, none of them the same shape and none of them centred. The
    # arm is bolted BELOW the head so the two never occupy the same air; the
    # first draft hung a dome, a vane and a finial on one axis and produced a
    # 0.06 m stack of parts inside each other, which is invisible geometry and
    # is exactly what the ruin's ladder was wrecked by.
    mb.box((0.70, 0.06, 0.06), (0.45, MAST_Y, ARM_Z), FRAME)
    arm_top = _face("Z", 1, ARM_Z + 0.03, tier, "crossarm")
    for u in (0.20, 0.52):
        arm_top.part(mb, 0.05, 0.05, u, MAST_Y, "clip", BRIGHT)
    # A wind vane at the outboard end: a post, a boom and a tail plate, and the
    # tail is what makes the arm read as pointing somewhere.
    mb.box((0.03, 0.03, 0.15), (0.16, MAST_Y, ARM_Z + 0.105), FRAME)
    mb.box((0.15, 0.022, 0.045), (0.095, MAST_Y, ARM_Z + 0.17), BRIGHT)
    mb.box((0.055, 0.018, 0.085), (0.035, MAST_Y, ARM_Z + 0.205), FASCIA)
    # A radiation-shield stack: discs of falling diameter on a spindle, which
    # is the one instrument silhouette a field met station is recognised by.
    sx = 0.38
    mb.box((0.035, 0.035, 0.20), (sx, MAST_Y, ARM_Z + 0.13), FRAME)
    for i in range(4):
        mb.cylinder(0.075 - 0.008 * i, 0.018,
                    (sx, MAST_Y, ARM_Z + 0.07 + 0.045 * i),
                    axis="Z", segments=8, role=BRIGHT, smooth_sides=False)
    # A sky dome above the stack: the one genuinely round, genuinely glassy
    # thing on the asset, and the only part of it that looks up.
    mb.cylinder(0.05, 0.035, (sx, MAST_Y, ARM_Z + 0.265), axis="Z",
                segments=8, role=BRIGHT, smooth_sides=False)
    mb.frustum(0.044, 0.030, 0.05, (sx, MAST_Y, ARM_Z + 0.305), axis="Z",
               segments=8, role=GLASS)
    # A collector funnel HANGING UNDER the arm at the inboard end. Nothing else
    # on the asset hangs, so this is the part that says the arm has two sides.
    mb.frustum(0.085, 0.028, 0.13, (0.70, MAST_Y, ARM_Z - 0.10), axis="Z",
               segments=8, role=BRIGHT)
    mb.box((0.05, 0.05, 0.09), (0.70, MAST_Y, ARM_Z - 0.21), FRAME)

    # The head: a finned housing on the column top, a machined collar, and a
    # finial. Three diameters over 0.34 m, so the top of the mast is not a cut
    # tube (machine_form.stack's own argument, at a tenth of the size).
    mf.finned_drum(mb, 0.085, 0.16, (MAST_X, MAST_Y, MAST_Z1 + 0.08), "Z", 2,
                   FRAME, BRIGHT, segments=8, fin_span=1.9)
    mb.cylinder(0.055, 0.04, (MAST_X, MAST_Y, MAST_Z1 + 0.18), axis="Z",
                segments=8, role=BRIGHT, smooth_sides=False)
    mb.box((0.022, 0.022, HEIGHT - (MAST_Z1 + 0.20)),
           (MAST_X, MAST_Y, (MAST_Z1 + 0.20 + HEIGHT) * 0.5), FRAME)
    return mb


# ---------------------------------------------------------------------------
# 6. THE EQUIPMENT BOX AND THE CABLING. Proof somebody wired this up.
# ---------------------------------------------------------------------------

def services(mb, tier):
    ex, ey = (EQ_X0 + EQ_X1) * 0.5, (EQ_Y0 + EQ_Y1) * 0.5
    ew, ed = EQ_X1 - EQ_X0, EQ_Y1 - EQ_Y0
    eh = EQ_Z1 - SKID_Z
    mb.box((ew, ed, eh), (ex, ey, SKID_Z + eh * 0.5), BODY)
    lid = _face("Z", 1, EQ_Z1, tier, "equip lid")
    lid.part(mb, ew - 0.06, ed - 0.06, ex, ey, "plate", FRAME)
    # 0.08 and not 0.05: the lid is inset 0.03 from the box, so a 0.04 bolt at
    # 0.05 put its own outer face exactly on the lid's edge - two roles on one
    # plane, 24 same-facing pairs across the three tiers.
    mf.bolts(mb, lid, (ex - ew * 0.5 + 0.08, ex + ew * 0.5 - 0.08),
             (ey - ed * 0.5 + 0.08, ey + ed * 0.5 - 0.08), 0.04, BRIGHT)
    ef = _face("Y", -1, EQ_Y0, tier, "equip front")
    ef.part(mb, 0.10, 0.05, ex, SKID_Z + 0.36, "latch", BRIGHT)
    # v = 0.56 and not 0.76: the equipment box's front face only exists from
    # SKID_Z to EQ_Z1 = 0.70, and the first build hung this placard at 0.76 with
    # its top corner at 0.80, i.e. 0.10 m above the box it was mounted on and
    # 53 mm proud of nothing. check_shadow_lod.py priced it at 113.08 mm of
    # LOD1 deviation, which cost the asset cascade 1 outright.
    mf.placard(mb, ef, ex, 0.56, 0.12, 0.08, FASCIA)
    ex_face = _face("X", 1, EQ_X1, tier, "equip end")
    for i in range(3):
        ex_face.part(mb, 0.05, 0.20, ey - 0.10 + 0.09 * i, SKID_Z + 0.32,
                     "grille", FRAME)

    # The conduit run: equipment box -> cabinet, and cabinet -> earth spike.
    # Axis aligned boxes with a fitting at every corner (machine_form.pipe_run).
    mf.pipe_run(mb, [(ex - ew * 0.5 + 0.04, ey + ed * 0.5, SKID_Z + 0.52),
                     (ex - ew * 0.5 + 0.04, CAB_Y0 + 0.10, SKID_Z + 0.52),
                     (CAB_X1 + 0.03, CAB_Y0 + 0.10, SKID_Z + 0.52)],
                0.05, CABLE, elbow_role=FRAME)
    mf.pipe_run(mb, [(CAB_X0 + 0.14, CAB_Y1 + 0.06, SKID_Z + 0.30),
                     (CAB_X0 + 0.14, CAB_Y1 + 0.06, SKID_Z + 0.06),
                     (SPIKE_X, CAB_Y1 + 0.06, SKID_Z + 0.06)],
                0.045, CABLE, elbow_role=FRAME)
    # The earth spike itself, driven through the deck behind the cabinet. Its
    # x is DERIVED to clear the -X levelling pads: the rod reaches the ground
    # plane, the pads are the only other thing that does, and two roles on
    # z = 0 is a coplanar pair however small the rod is.
    mb.box((0.05, 0.05, 0.20), (SPIKE_X, CAB_Y1 + 0.06, 0.10), FRAME)
    mb.box((0.07, 0.07, 0.045), (SPIKE_X, CAB_Y1 + 0.06, 0.20), BRIGHT)
    # A hank of spare cable on a hook: nothing about it is symmetric and it is
    # the one part of the asset that could have been coiled by a person.
    hook = _face("X", -1, CAB_X0, tier, "cable hook")
    hook.part(mb, 0.06, 0.16, CAB_Y1 - 0.14, SKID_Z + 0.30, "clip", BRIGHT)
    for i in range(3):
        hook.part(mb, 0.20 - 0.03 * i, 0.045, CAB_Y1 - 0.14,
                  SKID_Z + 0.24 - 0.05 * i, "duct", CABLE)
    return mb


# ---------------------------------------------------------------------------
# Collision, sockets, tiers
# ---------------------------------------------------------------------------

PROXIES = (
    # (name, size, loc). The bench is SOLID TO THE GROUND on purpose; see the
    # header on the walker being a line with three samples 0.75 m apart.
    ("col_Skid", (FOOT, FOOT, SKID_Z), (0.0, 0.0, SKID_Z * 0.5)),
    ("col_Cabinet", (CAB_X1 - CAB_X0 + 0.06, CAB_Y1 - CAB_Y0 + 0.06,
                     CAB_Z1 - SKID_Z),
     ((CAB_X0 + CAB_X1) * 0.5, (CAB_Y0 + CAB_Y1) * 0.5,
      (SKID_Z + CAB_Z1) * 0.5)),
    ("col_Bench", (BEN_X1 - BEN_X0 + 0.04, BEN_Y1 - BEN_Y0 + 0.04, BENCH_Z),
     ((BEN_X0 + BEN_X1) * 0.5, (BEN_Y0 + BEN_Y1) * 0.5, BENCH_Z * 0.5)),
    ("col_Mast", (0.30, 0.30, HEIGHT - SKID_Z),
     (MAST_X, MAST_Y, (SKID_Z + HEIGHT) * 0.5)),
)


def build_collision(root):
    for (name, size, loc) in PROXIES:
        of.add_collision_box(name, size, loc, root, role=FRAME)
    return [p[0] for p in PROXIES]


def build_sockets(root):
    """Three, and each is a fact the client will need rather than a decoration.

    `socket_screen` is where the research UI's own anchor belongs and where a
    look-at test would aim; it faces the player, so it takes NO rotation at all
    (an unrotated Blender empty exports with its local +Z along glTF +Z, which
    is Blender -Y, measured rather than assumed).
    `socket_status` is the lamp, matching every machine that has one.
    `socket_sample` is the middle of the work surface, facing up."""
    of.add_socket("socket_screen", (-0.14, CAB_Y0 - 0.06, 1.36), parent=root,
                  extras={"of_role": "ui"})
    of.add_socket("socket_status", (LAMP_U, CAB_Y0 - 0.06, LAMP_V),
                  parent=root, extras={"of_role": "state_light"})
    of.add_socket("socket_sample", ((BEN_X0 + BEN_X1) * 0.5,
                                    (BEN_Y0 + BEN_Y1) * 0.5, BENCH_Z),
                  rot=of.deg3(x=-90.0), parent=root,
                  extras={"of_role": "item_rest"})


def build_form(root, tier, suffix, screen=False, breakdown=False):
    """One source for every tier, so two tiers cannot disagree about where
    anything is and re-authoring LOD0 re-authors LOD1 in the same edit."""
    mb = of.MeshBuilder()
    prev, rows = 0, []

    def stage(label, fn):
        fn()
        nonlocal prev
        rows.append((label, mb.tri_count() - prev))
        prev = mb.tri_count()

    stage("skid", lambda: skid(mb, tier))
    stage("cabinet", lambda: cabinet(mb, tier))
    stage("console", lambda: console(mb, tier))
    stage("bench", lambda: bench(mb, tier))
    stage("mast", lambda: mast(mb, tier))
    if not screen:
        stage("services", lambda: services(mb, tier))
    if breakdown:
        for (label, n) in rows:
            print("[station]   %-10s %6d tris" % (label, n))
    return mb, mb.build(NAME + suffix, root)


def _assert_envelope(mb):
    """The four properties the ground pivot, the footprint and the PICK demand,
    all checked off the accumulated vertices rather than off the argument."""
    lo, hi = mb.bounds()
    assert abs(lo[2]) < 1e-6, (
        "the base plane is at z = %.6f and the ground pivot needs it at 0"
        % lo[2])
    for (k, ax) in ((0, "x"), (1, "y")):
        c = (lo[k] + hi[k]) * 0.5
        assert abs(c) < 1e-6, (
            "the AABB centre is %.6f on %s; the skid is meant to own the "
            "bounding box and something above it has grown past HALF"
            % (c, ax))
        assert hi[k] <= HALF + 1e-6, (
            "%s reaches %.4f against HALF %.4f: the asset is wider than the "
            "two tiles its placement snap assumes" % (ax, hi[k], HALF))
    worst_keep, worst_pick = 0.0, 0.0
    for p in mb.verts:
        # THE DECK PLATE IS THE ONLY THING ALLOWED TO REACH `HALF`, and the
        # rule is stated as a band in z rather than as "the skid", because
        # "the skid" is a function name and this has to be a fact about the
        # bytes: a runner, a foot pad or a rubbing strip that crept out to the
        # footprint edge would otherwise be counted as the deck plate.
        in_deck = SKID_Z - DECK_T - 1e-9 <= p[2] <= SKID_Z + 1e-9
        if not in_deck:
            worst_keep = max(worst_keep, abs(p[0]), abs(p[1]))
        worst_pick = max(worst_pick, math.sqrt(p[0] ** 2 + p[1] ** 2
                                               + (p[2] - PICK_UP) ** 2))
    assert worst_keep <= KEEP + 1e-6, (
        "something off the deck plate reaches %.4f m, past KEEP %.4f. The deck "
        "plate is the one symmetric element and the AABB is its job"
        % (worst_keep, KEEP))
    assert worst_pick <= PICK_MAX + 1e-6, (
        "a vertex sits %.4f m from the pick centre against ResearchStations."
        "pick's own %.4f m, so that part of the station cannot be selected"
        % (worst_pick, PICK_MAX))
    return lo, hi, worst_pick


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_form(root, 0.0, "_LOD0", breakdown=True)
    mb1, _ = build_form(root, LOD1_MIN, "_LOD1")
    mb2, _ = build_form(root, LOD2_MIN, "_LOD2", screen=True)
    lo, hi, pick = _assert_envelope(mb0)

    proxies = build_collision(root)
    build_sockets(root)

    of.report(NAME, [(NAME + "_LOD0", mb0), (NAME + "_LOD1", mb1),
                     (NAME + "_LOD2", mb2)])
    for label, mb in ((NAME + "_LOD0", mb0), (NAME + "_LOD1", mb1),
                      (NAME + "_LOD2", mb2)):
        l2, h2 = mb.bounds()
        print("[station] %-22s tris %5d  dims_xyz_m [%.4f, %.4f, %.4f]"
              % (label, mb.tri_count(), h2[0] - l2[0], h2[2] - l2[2],
                 h2[1] - l2[1]))
    height = hi[2] - lo[2]
    assert abs(height - HEIGHT) < 1e-6, (
        "the station stands %.4f m and HEIGHT says %.4f; the pick ceiling is "
        "derived from HEIGHT, so the two may not drift" % (height, HEIGHT))
    print("[station] footprint %.2f x %.2f m on a %.2f m tile; height %.4f m "
          "against the pick ceiling %.4f" % (FOOT, FOOT, TILE, height,
                                             _MAST_CEIL))
    print("[station] worst vertex %.4f m from the pick centre (limit %.4f)"
          % (pick, PICK_MAX))
    print("[station] %d proxies: %s" % (len(proxies), " ".join(proxies)))
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
