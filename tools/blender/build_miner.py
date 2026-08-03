"""
build_miner.py - Miner, TypeId 0x10 (of::gameplay::types::Miner).

    blender --background --python tools/blender/build_miner.py

Produces assets/models/dist/machines/miner.glb.

Footprint 4 x 4 m, height 3.20 m. It shipped at 2 x 2 x 2.4, which is Factorio
scale, and it was the last machine still at the old baseline alongside the
smelter: the assembler is 8 m (FS-57) and the storage box is 4 m (FS-68), and
`FactoryKinds.FOOTPRINT` already reads `miner: 4`. The asset was the lagging
half of that number.

WHY 3.20 m AND NOT THE SMELTER'S 3.60. This is a drill tower, and the thing a
drill tower must not do is out-top the kiln standing next to it: a chimney has
to be the tallest silhouette on a starter base or it stops reading as a
chimney. 3.20 also keeps the drill motor housing a whole 0.70 m above the body
top, which is what makes the machine read as "a motor pushing a column into
the ground" rather than as a box with a lid. Family by height: box 3.00,
miner 3.20, smelter 3.60, assembler 4.00.

WHY THIS ONE DOES NOT GET THE PLINTH THE BOX AND THE SMELTER HAVE.
EntityDef.requiresDeposit is true, so the design has to say "it eats the
ground": four corner legs straddle the ore with NOTHING between them, and you
can see straight through to the deposit the machine is bound to. A plinth
flush to the footprint edge would close exactly the gap that claim is made of.
So the FOOT PADS alone set the 4 x 4 footprint, which is the same discipline
the plinth serves elsewhere (one part owns the cell edge and no detail part
has to be trimmed to hold it) applied to a machine that must stay open.

THE SLOT IS THE POINT, and at this scale the miner can finally have one. Its
outlet is a recessed mouth in a chute housing hung off the -Y face: two jambs,
a head, a sill, a dark throat plate set back from the outer plane, and a
painted band across the head and the sill. At 2 m the chute was a bare box
with an accent stripe, because there was no 0.26 m of depth to recess anything
into. A belt terminating here now visibly runs INTO a hole.

SOCKET_ITEM_OUT MOVED FROM z = 0.55 TO z = 0.45, AND THAT IS DELIBERATE
(FS-57 finally finished). Every other machine in the game hands items out at
0.45: the smelter, the box and the assembler all do. The miner's 0.55 was the
last hold-out and it existed only because the 2 m gantry's chute happened to
sit there. One belt deck at 0.25 m now reaches every outlet in the game and
FactoryPorts' rise is a per-role constant rather than a per-asset one.

THE FOOTPRINT STAYS AN EVEN WHOLE NUMBER OF METRES and that is not taste.
Machines snap on a 1 m site grid and FactorySnap.stepsFor steps a new part
ceil((fpA + fpB) / 2) cells away, so an even footprint keeps exactly the
half-cell residual PORT_MATE_M (0.65 m) was derived against. An odd footprint
lands on the other side of the rounding and moves the bound for every machine
in the game, not just this one.

THE DRILL AND ITS MOUNT ARE SIBLINGS OF _LOD0, NOT CHILDREN, so the LOD0
bounding box stays exactly 4 x 4 x 3.2 while the column is free to sink below
z = 0. Drill_Bob translates the mount, Drill_Spin turns the column under it, so
each clip still drives exactly one object (of_lib.add_clip_multi says why).

HALF IS A HARD EDGE. No LOD0 geometry crosses it in any axis in the tangent
plane. In particular the leg posts stop at 1.92 and their painted cuffs at
1.95, so the pads are the only parts on the cell edge and the cuffs never
share the pads' outer plane. The 2 m miner put pad, leg and cuff all flush at
HALF, which measured as 10 overlapping coplanar pairs of steel against paint.

--------------------------------------------------------------------------
RN-1103 TO RN-1108: THE MACHINE FORM PASS, AND WHY THIS MACHINE FIRST
--------------------------------------------------------------------------
`machine_form.py`'s own module docstring claims it is "imported by
build_assembler.py, build_smelter.py, build_miner.py, build_box.py and the
rest of the machine set". Before this pass exactly TWO files imported it, the
assembler and the smelter, and this one was not among them. The claim was
aspirational and read as a description, which is how the vocabulary came to be
built and then applied to a quarter of what it was built for.

WHAT THAT COST, IN THE ONE NUMBER THAT SHOWS IT. LOD0 triangles across the
machine set before this pass: assembler 2,976 and smelter 2,276, both of which
have had a pass under docs/web/ART-DIRECTION.md; then box 564, generator 532,
miner 488, survival smelter 348, primitive furnace 328, power pole 332,
inserter 244 and a belt tile 148, none of which have. **The miner is 4 x 4 m,
the SAME footprint as the smelter, and had 21% of its triangles.** A rock the
player walks past is 556 (boulder_iron) and a spire is 1,290: the machines the
player builds, aims at, and stands in front of all day were less detailed than
the scenery.

WHAT THIS MACHINE NEEDED, in the order the vocabulary's own docstring ranks it:

  1. THE SILHOUETTE WAS A RECTANGLE FROM EVERY BEARING. Pads, legs, body,
     flange, motor housing: five stacked boxes, each strictly narrower or
     wider than the last, and nothing anywhere that reached OUT. The eave and
     its gusset brackets on the front and service faces are bought entirely
     for the outline, and the ladder is bought for the same reason plus one
     more (see 3).
  2. THE DRILL DID NOT READ. The whole design argument above is "a motor
     pushing a column into the ground", and the column is a bare 12-gon tube
     hanging in an empty gantry where nothing says it is guided, driven, or
     even attached. It now runs through a GUIDE COLLAR carried on two posts
     off the body underside, so the eye follows housing to column to ground.
  3. NOTHING GAVE IT A SIZE. A 4 m machine and an 8 m machine are the same
     picture until something in the frame is a size a person already knows.
     The ladder is that thing, and it is the cheapest one there is.
  4. IT WAS PRISTINE AND SYMMETRIC. One hatch on one face, hinged on one
     side, an eave that stops short on one end, gauges where a person would
     stand to read them, and a rubbing strip with a dent kicked into it on
     the leg nearest the outlet.

THE LADDER STOPS 0.30 M BELOW THE BODY AND THAT IS NOT AN OVERSIGHT.
`machine_form.step_tread` exists because a ladder whose bottom rung is a metre
up is a ladder nobody can reach, and its docstring assumes the plinth every
other machine in this set has. **This machine deliberately has no plinth** (see
above: it must read as eating the ground), so there is no surface to stand a
tread on, and a tread floating between the legs would be worse than no tread.
A fixed access ladder ending above head height is what a real gantry has, for
the reason that it stops anyone climbing it casually.

BUDGET: lod0 900 -> 1450 (actual 1,384) and total 1600 -> 1880 (actual 1,800).
ART-DIRECTION.md: "triangle budgets were sized for a low-poly game. Raising one
is now a normal, arguable act rather than a failure." The argument is the
smelter: same 4 x 4 footprint, 0.40 m taller, 2,276 at a 2,400 budget. This
machine lands WELL BELOW that on purpose, because half its height is open
gantry, and a budget equal to the smelter's would be a number copied rather
than derived.

MATERIALS STAY AT FIVE. Steel, SteelDark, Accent, Hazard, EmissiveState, the
same five it already had. `SteelLight` would have made the ladder read against
the body by value, which is the right instinct, and it is not taken here: it
would move `max_materials` on a machine whose art change is otherwise entirely
geometric, and a value decision and a form decision in one diff is how a
reviewer loses the ability to tell which one they are looking at.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import machine_form as mf  # noqa: E402

NAME = "Miner"
OUT = of.dist_path("machines", "miner.glb")

# --- dimensions (metres) ---------------------------------------------------
W = D = 4.00                    # footprint, whole metres (4 x 4 build cells)
H = 3.20
HALF = W * 0.5                  # 2.00, the hard edge nothing in LOD0 may cross

FOOT = 0.60                     # foot pad section; the pads own the cell edge
FOOT_H = 0.24
FOOT_C = HALF - FOOT * 0.5      # 1.70, so the pad's outer corner IS the corner
LEG = 0.44                      # leg section, centred on its pad
LEG_TOP = 1.52                  # legs end INSIDE the body, not on its underside
CUFF = LEG + 0.06               # painted cuff, proud of the leg and short of
                                # the pad's outer plane at HALF
BODY = 3.40
BODY_HALF = BODY * 0.5          # 1.70
BODY_Z0 = 1.40                  # the body's underside; the gantry is below it
BODY_TOP = 2.50
FLANGE = 3.60
FLANGE_TOP = 2.64
HOUSE = 1.90                    # drill motor housing, carries the 3.20 m height
HOUSE_Z0 = 2.58                 # sunk INTO the flange, so no shared plane
CORNERS = [(sx * FOOT_C, sy * FOOT_C) for sx in (-1, 1) for sy in (-1, 1)]

# The turning column. It hangs from the bob mount and is a SIBLING of LOD0.
COL_R = 0.44
COL_H = 1.90
COL_Z = 1.50                    # column centre -> z 0.55 .. 2.45, top buried
                                # in the body so the tube has no visible cap
BIT_TIP_Z = 0.06

# --- the outlet slot -------------------------------------------------------
# CHUTE_Y is this machine's BODY_HALF as far as the mouth is concerned: the
# plane the frame is recessed from. It is 0.04 proud of the body face so the
# chute housing and the body share no plane at all.
CHUTE_Y = 1.74
MOUTH_D = HALF - CHUTE_Y        # 0.26, the gap the slot frame lives in
BAND_D = 0.06                   # painted band thickness, flush with the edge
FRAME_D = MOUTH_D - BAND_D      # 0.20: the frame stops SHORT of the edge, so
                                # the band is a raised strip and not a decal
                                # fighting the steel for the same pixels.
OUT_Z = 0.45                    # FS-57's item_out height, and see the docstring
OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL = 1.30, 0.46, 0.42, 0.28, 0.22

STATUS_Z = 2.00
# Power inlet: a bracket on the body's +X face at the -Y end, clear of both the
# ribs and the leg tops. A top-corner nub would sit inside the flange.
PWR_X, PWR_Y, PWR_Z = 1.98, -1.50, 2.46

RIB_YS = (-1.20, -0.62, 0.62, 1.20)

# --- RN-1103: the detail frame (machine_form.py) ---------------------------
# The faces are the BODY's at 1.70 and the MOTOR HOUSING's at 0.95, each
# carrying the hard edge nothing mounted on it may cross. A greeble that would
# grow the 4 x 4 footprint fails the BUILD, by name, with the overshoot in
# metres, rather than being found by validate_glb in the shipped bytes.
#
# THE BODY HAS 0.30 M OF ROOM AND THE HOUSING HAS 1.05, and that asymmetry
# decides the whole layout. `machine_form.LAYER` tops out at "housing" (0.281),
# and `junction` stacks a "plate" (0.024) on top of that for 0.305: a junction
# box will not fit on a body face here and the module says so by raising. So
# every deep greeble is on the motor housing and every shallow one is on the
# body, which is also where they belong, because the housing IS the machinery.
FRONT = mf.Face("Y", -1, -BODY_HALF, limit=-HALF, name="front (chute)")
REAR = mf.Face("Y", 1, BODY_HALF, limit=HALF, name="rear (service)")
SERV = mf.Face("X", -1, -BODY_HALF, limit=-HALF, name="west")
STAT = mf.Face("X", 1, BODY_HALF, limit=HALF, name="east (status)")
# The chute's own front, 0.26 from the edge. Shallower than the body's 0.30,
# so a part that fits on the body does NOT automatically fit here.
MOUTH = mf.Face("Y", -1, -CHUTE_Y, limit=-HALF, name="chute front")
HOUSE_HALF = HOUSE * 0.5                                # 0.95
HOUSE_N = mf.Face("Y", 1, HOUSE_HALF, limit=HALF, name="motor rear")
HOUSE_S = mf.Face("Y", -1, -HOUSE_HALF, limit=-HALF, name="motor front")

# |u| beyond this on a +/-X body face is INSIDE a rib. The ribs are 0.26 deep
# centred on RIB_YS and stand 0.07 proud of the body, so anything past the
# outermost rib's outer edge is swallowed by one. DERIVED from RIB_YS rather
# than typed, because the ribs are what decide it.
RIB_CLEAR = max(RIB_YS) + 0.13                          # 1.33

# The plate courses. Straps SPAN the body on the X axis, so one box shows on
# both the east and the west face and the two can never drift apart. They stop
# clear of the leg tops at |z| < LEG_TOP and clear of the flange above.
SEAM_XS = (-1.52, -0.06, 1.52)
# ABOVE THE CHUTE TOP AT 1.55, and derived from it rather than chosen. A strap
# starting lower would run inside the chute housing for the bottom 0.1 m of
# its length and buy a pair of faces nobody can see.
SEAM_Z0, SEAM_Z1 = 1.58, 2.44

# The access ladder, on the rear face because it is the only body face with a
# clear 1 m of width: the east face carries the status rail and the power
# bracket, the west and east faces are both banded by the four ribs, and the
# front face is the chute's. See the module docstring for why it stops short.
LADDER_U = -1.20
LADDER_V0, LADDER_V1 = 1.10, 2.44

# The rear face's hatch, and the rating plate beside it.
HATCH_U, HATCH_DU, HATCH_RAIL = 0.62, 0.86, 0.065
# THE PLACARD IS DERIVED FROM THE TWO THINGS THAT BOUND IT AND THAT IS THE
# WHOLE POINT. Its first version was a typed 1.42 x 0.30, which put its right
# edge at exactly 1.57 - the outboard face of the 1.52 seam strap, whose own
# edge is 1.52 + 0.05. Two parts dimensioned off the same landmark where the
# landmark was a WIDTH COPIED rather than DERIVED, which is check_coplanar's
# catalogued root cause verbatim, and it measured as this asset's only two
# same-facing pairs. Centred between its neighbours it cannot recur, and
# moving either neighbour moves it.
HATCH_EDGE = HATCH_U + HATCH_DU * 0.5 + HATCH_RAIL      # 1.115
SEAM_EDGE = SEAM_XS[2] - 0.05                           # 1.47
PLACARD_U = (HATCH_EDGE + SEAM_EDGE) * 0.5              # 1.2925
PLACARD_DU = (SEAM_EDGE - HATCH_EDGE) - 0.12            # 0.235

# The dented rubbing strip, on the west-front LEG rather than on the chute.
# THE CHUTE WAS THE OBVIOUS PLACE AND IT IS THE WRONG ONE: the outlet frame's
# jambs and sill occupy y -1.94 to -1.74 across x +/- 1.07 and z 0 to 0.96,
# and a `kick` layer part on the chute front stands at y -1.771, which is
# INSIDE that. The plate would have been authored, exported, counted and
# invisible. The leg is where the argument pointed anyway (see build_lod0's
# cuff comment: the legs are the part a player walks into), and a leg face has
# 0.08 m of room, which a 0.031 kick plate fits and nothing deeper does.
KICK_LEG_X = -(FOOT_C + LEG * 0.5)                      # -1.92, the leg's face
KICK_V_TOP, KICK_H2 = 0.50, 0.24                        # under the cuff at 0.54

# The drill guide. Two posts hung off the body underside carrying a collar the
# column turns inside. THE COLLAR'S INNER RADIUS IS DERIVED FROM THE THING IT
# GUIDES AND FROM ITS TRAVEL, not chosen to look right: the column's widest
# rotating part is its bottom collar at COL_R + 0.08 = 0.52, and Drill_Bob
# lowers the whole assembly 0.12 m, so the guide has to clear 0.52 at every
# frame of the clip. 0.60 inner is 80 mm of clearance at both extremes.
GUIDE_R = 0.66
GUIDE_T = 0.12                  # inner 0.60, outer 0.72
GUIDE_Z = 0.50
GUIDE_POST = 0.16
GUIDE_Z0, GUIDE_Z1 = 0.37, 1.43  # top buried in the body, which starts at 1.40

# The power duct from the motor housing down into the body's east shoulder.
# y = 0.90 IS THE GAP BETWEEN TWO RIBS AND IS DERIVED FROM THEM. The ribs
# occupy RIB_YS +/- 0.13, so the clear lane is 0.75 to 1.07; a 0.20 duct
# centred on 0.90 spans 0.80 to 1.00 and touches neither. Routed at 0.65 (the
# obvious "just outboard of the housing fins") it would have run 10 mm off the
# rib faces down the whole drop, which is a z-fight rather than a detail.
DUCT_Y = 0.90
DUCT_W = 0.20


def _mouth(mb, z_c, open_w, open_h, jamb, head_h, sill_h, band_role):
    """The recessed outlet slot in the -Y face of the chute housing.

    Two jambs, a head and a sill fill the first 0.20 m of the step between the
    chute face and the footprint edge, leaving a hole `open_w` by `open_h`
    centred on `z_c`; the painted band fills the last 0.06 m across the head
    and the sill, so the slot is legible as a port from across the base. A dark
    throat plate stands proud of the chute face so the hole has a visible
    bottom. Only -Y is parameterised because the miner has exactly one item
    port: it takes its input from the ground."""
    z0 = z_c - open_h * 0.5
    z1 = z_c + open_h * 0.5
    lo, hi = z0 - sill_h, z1 + head_h
    outer_w = open_w + 2.0 * jamb
    jamb_c = (open_w + jamb) * 0.5
    y_frame = -(CHUTE_Y + FRAME_D * 0.5)        # -1.84, the frame's middle
    y_throat = -(CHUTE_Y + 0.05)                # -1.79, proud of the chute
    y_band = -(HALF - BAND_D * 0.5)             # -1.97, flush with the edge

    for s in (-1, 1):
        mb.box((jamb, FRAME_D, hi - lo), (s * jamb_c, y_frame, (lo + hi) * 0.5),
               "Steel")
    mb.box((outer_w, FRAME_D, head_h), (0, y_frame, z1 + head_h * 0.5), "Steel")
    mb.box((outer_w, FRAME_D, sill_h), (0, y_frame, z0 - sill_h * 0.5), "Steel")
    mb.box((open_w, 0.10, open_h), (0, y_throat, z_c), "SteelDark")
    mb.box((outer_w, BAND_D, head_h * 0.5), (0, y_band, z1 + head_h * 0.5),
           band_role)
    mb.box((outer_w, BAND_D, sill_h * 0.5), (0, y_band, z0 - sill_h * 0.5),
           band_role)


def _mouth_block(mb, z_c, open_w, open_h, jamb, head_h, sill_h):
    """The same slot at LOD1: one filled frame block plus a dark inset, so the
    port is still where it was and still reads dark, at two boxes instead of
    seven. A decimator cannot do this to a slot; it closes the hole."""
    lo = z_c - open_h * 0.5 - sill_h
    hi = z_c + open_h * 0.5 + head_h
    outer_w = open_w + 2.0 * jamb
    mb.box((outer_w, MOUTH_D, hi - lo),
           (0, -(HALF - MOUTH_D * 0.5), (lo + hi) * 0.5), "Steel")
    mb.box((open_w, 0.10, open_h), (0, -(HALF - 0.06), z_c), "SteelDark")


def _gantry(mb):
    """Four pads on the cell corners and four legs standing on them.

    The pads alone reach HALF. The legs are centred on their pads and stop
    0.08 short of the edge, and they begin exactly at the pad top so the only
    plane they share with a pad is a back-to-back contact no depth test has to
    arbitrate. Their tops end INSIDE the body for the same reason."""
    for cx, cy in CORNERS:
        mb.box((FOOT, FOOT, FOOT_H), (cx, cy, FOOT_H * 0.5), "SteelDark")
    for cx, cy in CORNERS:
        mb.box((LEG, LEG, LEG_TOP - FOOT_H), (cx, cy, (FOOT_H + LEG_TOP) * 0.5),
               "Steel")


def _chute(mb):
    """The housing the outlet slot is cut into: a box hung off the -Y face,
    0.04 proud of it, running from just above the ground up into the body.

    It has to exist because the -Y face at z = 0.45 is OPEN GANTRY on this
    machine; there is no wall there to recess a mouth into. Its top is buried
    in the body and its front plane is CHUTE_Y, so it shares no plane with the
    body it hangs from."""
    mb.box((2.40, 0.68, 1.50), (0, -1.40, 0.80), "SteelDark")


def _shell(mb):
    """Body, cap flange and drill motor housing: the parts every LOD keeps."""
    mb.box((BODY, BODY, BODY_TOP - BODY_Z0),
           (0, 0, (BODY_Z0 + BODY_TOP) * 0.5), "Steel")
    mb.box((FLANGE, FLANGE, FLANGE_TOP - BODY_TOP),
           (0, 0, (BODY_TOP + FLANGE_TOP) * 0.5), "Accent")
    mb.box((HOUSE, HOUSE, H - HOUSE_Z0), (0, 0, (HOUSE_Z0 + H) * 0.5),
           "SteelDark")


def _plating(mb):
    """RN-1104. The body stops being one 3.4 m sheet.

    `through_seam` spanning Y shows the SAME box on the front and the rear
    face, so three straps buy six visible seams and the front and rear courses
    can never drift out of line with one another, because they are one box."""
    mf.through_seam(mb, "Y", BODY_HALF, SEAM_XS, SEAM_Z0, SEAM_Z1, 0.10,
                    "SteelDark")
    # One horizontal course per Y face, breaking the 0.86 m of body left
    # between the flange above and the chute below. Not a through_seam: a strap
    # spanning X would emerge on the two faces the RIBS already band, which is
    # detail spent where there is already detail.
    mf.seam_h(mb, FRONT, (2.02,), -1.44, 1.44, 0.09, "SteelDark")
    mf.seam_h(mb, REAR, (2.02,), -1.44, 1.44, 0.09, "SteelDark")


def _service_face(mb):
    """RN-1105. The rear face: the climb, the hatch, the conduit, the plate.

    THIS IS THE ONLY BODY FACE WITH A CLEAR METRE OF WIDTH and that is why
    everything a person interacts with is on it. The east face carries the
    status rail and the power bracket, the east and west faces are both banded
    by the four ribs from z 1.52 to 2.42, and the front face belongs to the
    chute. A machine's service side is wherever there is room to work, which
    is as true of a real one as it is of this one."""
    mf.ladder(mb, REAR, LADDER_U, LADDER_V0, LADDER_V1, 0.34, 5, "Steel")
    mf.hatch(mb, REAR, HATCH_U, 1.94, HATCH_DU, 0.76, "SteelDark", "Steel",
             "Accent", hinge_side=-1)
    mf.tray(mb, REAR, -0.60, 1.52, 2.40, 0.14, 4, "SteelDark", "Steel")
    mf.placard(mb, REAR, PLACARD_U, 2.28, PLACARD_DU, 0.16, "Accent")


def _motor_detail(mb):
    """RN-1106. The drill motor housing stops being a lidded box.

    It is the one part of this machine with real room to work in: 1.05 m to
    the footprint edge against the body's 0.30, so the two greebles the body
    structurally CANNOT take both live here. `junction` alone needs 0.305 and
    a body face would raise on it, which is the layer table doing its job.

    THE TWO FACES GET DIFFERENT THINGS, deliberately. A vent bank on both
    would be a symmetric machine with more triangles on it."""
    # Air intake, front. A drill motor under load is the hottest thing on the
    # machine and the only part of it that unambiguously reads as functional.
    mf.louvre(mb, HOUSE_S, 0.0, 2.89, 1.30, 0.44, 3, "Steel", "SteelDark",
              role_back="SteelDark")
    # Control gear and a rating plate, rear.
    mf.junction(mb, HOUSE_N, -0.42, 2.86, 0.34, 0.30, "SteelDark", "Steel")
    mf.placard(mb, HOUSE_N, 0.46, 2.86, 0.26, 0.14, "Accent")


def _duct(mb):
    """RN-1107. Power visibly reaches the motor.

    Housing shoulder, out past the body, down the east side, and INTO the body
    at z 1.70. The last leg is what makes it a run rather than a stub: a duct
    whose lower end stops in mid-air is a shape, and a duct that enters
    something is a cable."""
    mf.pipe_run(mb, [(HOUSE_HALF, DUCT_Y, 2.92),
                     (1.86, DUCT_Y, 2.92),
                     (1.86, DUCT_Y, 1.70),
                     (1.55, DUCT_Y, 1.70)],
                DUCT_W, "SteelDark", elbow_role="Steel")


def _canopy(mb):
    """RN-1108. The outline stops being a rectangle.

    Every other line on this machine is vertical or horizontal and flush; two
    eaves with gusset brackets falling away under them put a hard shadow across
    the top of the front and west faces and give the silhouette a notch at one
    height. `machine_form.eave`'s docstring calls this the one detail bought
    purely for the outline, and on this machine it is bought twice.

    THE FRONT EAVE STOPS AT u = 0.34 AND THAT IS THE DUCT'S DOING. Run the
    full width it would be a symmetric lip on a machine whose whole east
    shoulder carries a cable run; stopped short, the canopy covers the service
    approach and the plant is on the other side, which is a machine somebody
    laid out rather than a machine somebody mirrored.

    THE WEST EAVE'S THREE BRACKETS LAND AT y = 0 AND +/- 0.97, WHICH IS CLEAR
    OF ALL FOUR RIBS BY ARITHMETIC and not by luck: `eave` spaces n brackets at
    (i + 0.5) / n of its span, so 3 over -1.45 to 1.45 gives exactly those
    three, and the ribs occupy 0.49 to 0.75 and 1.07 to 1.33."""
    mf.eave(mb, FRONT, -1.50, 0.34, 2.42, 0.26, 3, "Steel", "SteelDark")
    mf.eave(mb, SERV, -1.45, 1.45, 2.42, 0.26, 3, "Steel", "SteelDark")


def _standing_detail(mb):
    """RN-1108. What a player sees from where a player stands.

    The body's lowest face is 1.40 m up, so every greeble above is at or over
    head height and the machine has NOTHING at the height it is read from. The
    chute front is the only surface on this machine at chest height, and it
    gets the two things a person uses: instruments to read and a rubbing strip
    that has taken a hit.

    THE CHUTE HAS 0.26 M OF ROOM AND THE BODY HAS 0.30, so this face is the
    tightest on the machine: `gauge_cluster` stacks a 0.163 gauge on a 0.037
    boss for 0.20 and fits, and anything on the `duct` layer or deeper does
    not. That is the layer table refusing rather than an author remembering."""
    mf.gauge_cluster(mb, MOUTH, -0.78, 1.24, 3, "SteelDark", "Steel")
    mf.placard(mb, MOUTH, 0.82, 1.24, 0.28, 0.15, "Accent")
    # The dented rubbing strip, at shin height on the leg nearest the outlet.
    # `dent_at=-1` puts the hit on the outboard end, which is the end anything
    # driving past the port would catch. See KICK_LEG_X for why it is here and
    # not on the chute face, which is where it was first authored and where it
    # would have been buried inside the outlet frame.
    leg = mf.Face("X", -1, KICK_LEG_X, limit=-HALF, name="west leg")
    mf.kick_plate(mb, leg, -(FOOT_C + LEG * 0.5) + 0.02,
                  -(FOOT_C - LEG * 0.5) - 0.02, KICK_V_TOP, KICK_H2,
                  "SteelDark", dent=0.62, dent_at=-1)


def _drill_guide(mb):
    """RN-1106. The column becomes a column that is GUIDED.

    Two posts off the body underside and a collar the drill turns inside. The
    machine's stated read is "a motor pushing a column into the ground" and
    before this the column was a bare tube hanging in an empty gantry with
    nothing to say it was driven, held, or even attached to the machine above
    it. Three parts, and the eye now runs housing to body to collar to ground.

    THE POSTS' TOPS ARE BURIED IN THE BODY, at 1.43 against its underside at
    1.40, so neither post shows a cap and neither can share the body's own
    bottom plane. Their bottoms are open and that is correct: a guide post
    ends."""
    for s in (-1, 1):
        mb.box((GUIDE_POST, GUIDE_POST, GUIDE_Z1 - GUIDE_Z0),
               (s * GUIDE_R, 0.0, (GUIDE_Z0 + GUIDE_Z1) * 0.5), "Steel")
    mf.arc_ring(mb, GUIDE_R, GUIDE_T, GUIDE_Z, 12, "SteelDark")


def build_lod0(root):
    mb = of.MeshBuilder()
    _gantry(mb)
    # painted cuffs at shin height: the legs are the part a player walks into.
    # Proud of the leg (so no shared plane) and short of HALF (so none of the
    # paint lands on the pads' outer plane).
    for cx, cy in CORNERS:
        mb.box((CUFF, CUFF, 0.18), (cx, cy, 0.63), "Hazard")

    _chute(mb)
    _shell(mb)

    # body ribs. ONE box per rib spans the whole width and shows on BOTH side
    # faces, so eight visible ribs cost four boxes and neither ribbed face can
    # ever drift out of line with the other. Placed clear of the status rail at
    # y = 0 and clear of the leg tops at |y| = 1.48.
    for y in RIB_YS:
        mb.box((BODY + 0.14, 0.26, 0.90), (0, y, 1.97), "SteelDark")

    # motor housing fins, proud on both +X and -X for the same reason
    for y in (-0.60, -0.20, 0.20, 0.60):
        mb.box((HOUSE + 0.06, 0.10, 0.30), (0, y, 2.92), "Steel")

    # hazard collar where the column enters the body underside. Its top is
    # inside the body, so the ring and the body share no plane.
    mb.cylinder(0.70, 0.20, (0, 0, BODY_Z0), axis="Z", segments=12,
                role="Hazard")

    # the outlet slot, then the chute shelf and lip. The lip is WIDER than the
    # shelf and sits inside the shelf's height, so the two share no plane.
    _mouth(mb, OUT_Z, OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL, "Accent")
    mb.box((1.20, 0.24, 0.10), (0, -1.86, 0.27), "SteelDark")
    mb.box((1.34, 0.08, 0.06), (0, -1.96, 0.27), "Accent")

    # power inlet bracket under socket_power_in
    mb.box((0.28, 0.40, 0.40), (1.84, PWR_Y, 2.26), "Steel")

    # Status bezel and inlay go down BEFORE the chip, so OF_EmissiveState is
    # always the LAST material slot on every mesh (the renderer indexes it by
    # position). The chip stands proud of the inlay rather than flush with it.
    mb.box((0.10, 0.72, 0.36), (1.75, 0.0, STATUS_Z), "SteelDark")
    mb.box((0.06, 0.56, 0.24), (1.81, 0.0, STATUS_Z), "Steel")

    # --- RN-1104 to RN-1108, the machine_form pass -------------------------
    # Placed here, BEFORE the emissive chip, for the reason the comment above
    # already gives: OF_EmissiveState has to be the last material slot on the
    # mesh because the renderer indexes it by position. A detail function
    # appended after it would silently move the state light's slot and break
    # every machine's status colour, which is the sort of thing that is
    # invisible in Blender and obvious in the game.
    _plating(mb)
    _service_face(mb)
    _motor_detail(mb)
    _duct(mb)
    _canopy(mb)
    _standing_detail(mb)
    _drill_guide(mb)

    mb.box((0.05, 0.44, 0.16), (1.845, 0.0, STATUS_Z), "EmissiveState")
    # The footprint is sim-load-bearing (FactorySnap.stepsFor derives the
    # mating distance from the declared box), so it is asserted where it is
    # caused rather than found later in the shipped bytes by validate_glb.
    mf.assert_inside(mb, HALF, HALF, H, "Miner_LOD0")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    """Hand-built. The read that must survive is the open gantry, so the legs
    stay and the surface detail goes; the slot survives as a block because a
    decimator would close it.

    RN-1108: THE GUIDE POSTS SURVIVE TO THIS TIER AND THE COLLAR DOES NOT, and
    `check_shadow_lod` is what says so rather than taste. Every other greeble
    this pass adds stands within 0.30 m of a face LOD1 already has, so none of
    them costs this tier anything. The guide posts are the one new part in
    OPEN SPACE, 1.06 m from the nearest LOD1 surface, and leaving them out
    took the measured deviation from 280 mm to 1030 mm on its own. Two boxes
    buy most of it back and a measurement says how much: 1030 to 864, with the
    residual traced to the COLLAR's north and south quadrants, which stand
    0.864 m from the nearest post corner and which this tier had nothing at
    all standing for. Two 0.16 stub brackets there rather than the ring
    itself: the ring is an arc band and costs about 96 triangles on a proxy
    whose whole job is to be cheap, and a shadow does not need the hole in
    the middle of it.

    WHAT THIS TIER STILL DOES NOT EARN, said plainly. LOD1 has never earned a
    cascade on this machine: the c2 texel is 210.94 mm and the pre-pass tier
    already measured 280. This pass does not make that worse in VERDICT, and
    the number moving at all is worth recording, because the day somebody
    re-authors this proxy to get under 210 they need to know what is in the
    way."""
    mb = of.MeshBuilder()
    _gantry(mb)
    _chute(mb)
    _shell(mb)
    for s in (-1, 1):
        mb.box((GUIDE_POST, GUIDE_POST, GUIDE_Z1 - GUIDE_Z0),
               (s * GUIDE_R, 0.0, (GUIDE_Z0 + GUIDE_Z1) * 0.5), "Steel")
        mb.box((GUIDE_POST, GUIDE_POST, GUIDE_T), (0.0, s * GUIDE_R, GUIDE_Z),
               "SteelDark")
    _mouth_block(mb, OUT_Z, OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL)
    mb.box((0.05, 0.44, 0.16), (1.845, 0.0, STATUS_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    """Three boxes. The gantry is gone at this range, so a squat base stands in
    for it; it is narrower than the body so the two share no plane."""
    mb = of.MeshBuilder()
    mb.box((3.20, 3.20, BODY_Z0), (0, 0, BODY_Z0 * 0.5), "SteelDark")
    mb.box((BODY, BODY, BODY_TOP - BODY_Z0),
           (0, 0, (BODY_Z0 + BODY_TOP) * 0.5), "Steel")
    mb.box((HOUSE, HOUSE, H - BODY_TOP), (0, 0, (BODY_TOP + H) * 0.5),
           "SteelDark")
    return mb, mb.build(NAME + "_LOD2", root)


def build_drill(mount):
    """The turning column, a child of the bob mount and a SIBLING of LOD0."""
    mb = of.MeshBuilder()
    mb.cylinder(COL_R, COL_H, (0, 0, COL_Z), axis="Z", segments=12, role="Steel")
    # Three flutes proud of the column. Without them a 12-gon cylinder spinning
    # about its own axis is indistinguishable from a static one.
    mb.ring_boxes((0.16, 0.16, COL_H - 0.16), COL_R - 0.02, 3, (0, 0, COL_Z),
                  "SteelDark")
    mb.cylinder(COL_R + 0.08, 0.16, (0, 0, COL_Z - COL_H * 0.5), axis="Z",
                segments=12, role="SteelDark")
    mb.frustum(COL_R + 0.02, 0.08, (COL_Z - COL_H * 0.5) - BIT_TIP_Z,
               (0, 0, (COL_Z - COL_H * 0.5 + BIT_TIP_Z) * 0.5), axis="Z",
               segments=8, role="Hazard")
    return mb, mb.build("Miner_Drill", mount)


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mount = of.add_pivot("Miner_DrillMount", (0, 0, 0), root)
    mbd, drill = build_drill(mount)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_item_out", (0.0, -HALF, OUT_Z), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_power_in", (PWR_X, PWR_Y, PWR_Z), parent=root,
                  extras={"of_role": "power_in"})
    of.add_socket("socket_status", (HALF, 0.0, STATUS_Z), parent=root,
                  extras={"of_role": "state_light"})
    # socket_drill_tip stays ON THE ORIGIN in the tangent plane. That is not a
    # convenience: FactoryPorts.faceOf returns null for a socket at x = z = 0,
    # which is how this one is excluded from being a belt target STRUCTURALLY
    # rather than by matching its name.
    of.add_socket("socket_drill_tip", (0.0, 0.0, 0.0), parent=root,
                  extras={"of_role": "dig_vfx"})

    # Drill_Spin: 30 frames == MineFerrite.timeTicks, one full turn about Z.
    # Keyed in 120 degree steps: glTF stores rotation as a quaternion, so a
    # two-key 0 -> 360 curve would export as no rotation at all.
    of.add_clip(drill, "Drill_Spin", "rotation_euler",
                [(1, of.deg3(z=0)), (11, of.deg3(z=120)),
                 (21, of.deg3(z=240)), (31, of.deg3(z=360))])
    # Drill_Bob: the mount sinks and lifts back over 60 frames. The throw grew
    # with the machine, from 80 mm to 120 mm, so the motion stays visible at
    # the range a 4 m machine is actually looked at from.
    of.add_clip(mount, "Drill_Bob", "location",
                [(1, (0, 0, 0.0)), (31, (0, 0, -0.12)), (61, (0, 0, 0.0))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Miner_Drill", mbd)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
