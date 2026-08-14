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

# --- RN-1557 to RN-1559: the SE form pass ----------------------------------
# RN-1103 gave this machine the vocabulary; this pass gives it the three things
# D-020's bar asks for that a vocabulary pass did not: a GUARD over the moving
# part, a surface that has actually FAILED where the machine works wet, and a
# flexible run to the part that travels.
#
# THE GUARD IS THE HEADLINE AND IT IS NOT DECORATION. This machine's entire
# stated read is "a motor pushing a column into the ground", and the column
# turns 30 frames to the revolution one metre from where a player stands to
# read the gauges, with nothing between them. Space Engineers' machines read as
# serviceable because every moving part is behind something; this one's was
# behind nothing at all.
#
# IT DOES NOT CLOSE THE GANTRY, WHICH IS THE ONE THING IT MUST NOT DO. The
# module docstring's whole argument for having no plinth is that you can see
# THROUGH this machine to the deposit it is bound to. A cage is uprights on a
# circle: the sky and the ore show between the bars from every bearing, the
# same way `machine_form.railing` beats a parapet. A shroud would have closed
# exactly the gap the design is made of, and that is why this is a cage.
#
# THE RADIUS IS DERIVED FROM WHAT IT HAS TO MISS, not chosen. Inboard it must
# clear the guide collar's outer face at 0.72 and the guide posts' outer
# corners at 0.74; outboard it must clear the chute housing, whose rear face is
# at y = -1.06, and the four legs, whose inner faces are at 1.48. 0.95 leaves
# 0.21 m inboard and 0.11 m to the chute, which is the tightest of the two and
# therefore the number that binds.
GUARD_R = 0.95
GUARD_Z0, GUARD_Z1 = 0.34, 1.36     # top 40 mm clear of the body underside, so
                                    # the cage is a free-standing guard and not
                                    # a bracket hung off the body
GUARD_BARS = 8

# The dust hose. It runs from the body underside down and forward INTO the
# chute housing, which is where a real drill's water or dust suppression goes:
# to the point the spoil is handed over, not to the bit. Both ends land ON a
# surface rather than in mid-air, which is `_duct`'s recorded rule ("a duct
# whose lower end stops in mid-air is a shape"), and the clamp bands straddle
# those two surfaces so both are visible rather than buried.
HOSE_W = 0.09
HOSE = [(1.42, -0.50, 1.38), (1.42, -0.50, 1.24),
        (1.42, -1.30, 1.24), (1.16, -1.30, 1.24)]

# The vent bank, in the west face's CENTRE RIB LANE. The ribs occupy
# RIB_YS +/- 0.13, so the clear lanes are -1.07..-0.75, -0.49..0.49 and
# 0.75..1.07; only the middle one is wide enough for a bank worth looking at.
# Its coaming stands 0.108 proud against the ribs' 0.07, so the vent is proud
# of the ribs it sits between rather than sunk behind them.
VENT_V = 1.90
VENT_DU, VENT_DV = 0.80, 0.44


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
    # RN-1558: the throat is the wet-ore face and it wears `rust`. LOD1's own
    # inset stays SteelDark on purpose - see build_lod1 - so the rust family
    # exists in tier 0 only and costs the shadow cascades no extra layer.
    #
    # ITS BOX GREW IN TWO DIRECTIONS AND THE ROLE CHANGE IS WHY. The throat was
    # 0.10 deep and exactly `open_h` tall, which put its BACK face on y = -1.74
    # and its BOTTOM on z = 0.22 - the same two planes the chute shelf below it
    # already occupied, both facing the same way. That was invisible for as
    # long as both parts were SteelDark, because check_coplanar deliberately
    # does not count a same-material overlap: it is unresolvable by a depth
    # test and unnoticeable by an eye. Painting one of them a different
    # material does not CREATE the defect, it reveals one that was always in
    # the file, and the fix is at the cause rather than at the paint. The plate
    # now runs 0.10 lower, so its underside is buried in the sill, and 0.04
    # further back, so its rear face is buried in the chute housing. A throat
    # plate is the bottom of a hole and both of its hidden edges should be
    # inside the thing the hole is cut in.
    mb.box((open_w, 0.14, open_h + 0.10), (0, -(CHUTE_Y + 0.03), z_c - 0.05),
           "SteelRust")
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
    # RN-1558. The collar the column turns inside is the third wet-ore face and
    # the one a player looks straight at through the guard: a bearing surface
    # with spoil running past it is where steel actually goes.
    mf.arc_ring(mb, GUIDE_R, GUIDE_T, GUIDE_Z, 12, "SteelRust")


def _drill_guard(mb):
    """RN-1557. The rotating column acquires the one thing that lets a person
    stand next to it.

    See the GUARD_R block above for why it is a cage rather than a shroud and
    where the radius comes from. The hazard role on the hoops is earned here in
    a way it is not on most of the paint in this game: a hoop at shin and chest
    height around a turning drill is EXACTLY what gets striped on a real
    machine, and `machine_form.guard_cage` refuses a hoop no wider than its
    bars, so the paint cannot end up on a plane the steel is also on."""
    mf.guard_cage(mb, GUARD_R, GUARD_Z0, GUARD_Z1, GUARD_BARS,
                  "Steel", "Hazard", bar=0.06, hoop=0.09, segs=8)


def _wet_steel(mb):
    """RN-1558. THE FIRST CONSUMER OF `rust` IN THE GAME, and the argument for
    why it is this machine and only these parts.

    texgen's family header is precise about what `rust` depicts: not a used
    machine (that is `paintchip`) but steel that has GONE, oxide scale lifted
    and spalled, metalness falling because there is progressively less metal
    left. In a working factory exactly one path has that surface, and it is the
    one where wet ore is in contact with steel all day: this machine's throat,
    the lip its spoil crosses, and the collar its column turns inside.

    WHAT IS DELIBERATELY NOT RUSTED. The body, the motor housing, the legs and
    every painted band stay as they were. A machine rusted all over is a wreck,
    and this one is running: the story puts it at the head of the player's
    first production chain. Applying a family to a whole asset because the
    family is new is how `panel` came to be on the suit.

    THE PALETTE PAIRING IS WHY THIS IS A ROLE AND NOT A TINT. The family's
    albedo is mean-neutral, so the map cannot supply the orange; `SteelRust`
    carries its own oxide hex, metallic 0.35 and roughness 0.92, and wired to
    Steel's grey instead it would render as grey rust. of_lib.PALETTE has the
    numbers and the derivation."""
    # The spoil lip under the chute: the plate every item this machine produces
    # crosses on its way out. It replaces nothing; the chute's shelf and its
    # painted edge strip are still steel and paint, and this is the wear face
    # laid on top of the shelf with its underside buried in it.
    mb.box((1.16, 0.16, 0.05), (0, -1.83, 0.315), "SteelRust")


def _fasteners(mb):
    """RN-1559. The machine is BOLTED TOGETHER, which it had never said.

    RN-1103 bought this machine seams, a ladder, a hatch and an eave and left
    every joint between its five stacked solids unmarked, so at close range the
    flange sat on the body the way one box sits on another. Two places earn the
    triangles, and both are places a real machine is unmistakably bolted:

      THE CAP FLANGE, whose whole job is to be the bolted joint between the
      body and the drill motor deck. Its side faces are at 1.80 with 0.20 m to
      the hard edge, which a 0.044 bolt clears easily and nothing deeper does.

      THE FOOT PADS, because this machine has no plinth and stands on four
      pads that are the only thing holding it down. `requiresDeposit` means it
      is placed on ore and left there, and an anchor bolt at each pad is the
      cheapest possible statement that somebody installed it."""
    for sign, name in ((-1, "flange front"), (1, "flange rear")):
        f = mf.Face("Y", sign, sign * 1.80, limit=sign * HALF, name=name)
        mf.bolt_run(mb, f, -1.44, 1.44, 2.57, 5, 0.055, "SteelDark")
    # Two anchor bolts per pad, on the pad's own top face, set diagonally
    # outboard of the leg that stands on it. The pad top is at FOOT_H and the
    # leg occupies +/- 0.22 of the pad centre, so 0.24 is just clear of it.
    pad = mf.Face("Z", 1, FOOT_H, limit=H, name="foot pad")
    for cx, cy in CORNERS:
        for s in (-1, 1):
            pad.part(mb, 0.07, 0.07, cx + (0.24 if cx > 0 else -0.24),
                     cy + s * 0.18, "bolt", "Steel")


def _vent(mb):
    """RN-1559. A drill motor under load is the hottest thing on this machine,
    and until now the only air it moved was through one bank on the motor
    housing 2.9 m up.

    The body carries the gear the motor drives and it vented nowhere. This bank
    sits in the west face's centre rib lane at 1.90, which is the one place on
    a body face that is neither ribbed, laddered, hatched, trayed nor under the
    eave, and it is at the height a person standing beside the machine looks
    at. `louvre` gives it a coaming, a dark backing sheet and three blades, so
    it reads as a hole rather than as stripes."""
    mf.louvre(mb, SERV, 0.0, VENT_V, VENT_DU, VENT_DV, 3, "Steel", "SteelDark",
              role_back="SteelDark")


def _hose(mb):
    """RN-1559. The dust line, and this machine's one `coarse` part.

    See the HOSE block above for the route and why both ends land on a
    surface. The point of it being a HOSE rather than another `pipe_run` is
    that this machine's head TRAVELS: Drill_Bob sinks the whole assembly 120 mm
    every cycle, and a rigid duct to a part that moves is the kind of detail
    that is invisible until somebody who has serviced machinery looks at it."""
    mf.hose(mb, HOSE, HOSE_W, "Rubber", clamp_role="Steel")


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
    # --- RN-1557 to RN-1559, the SE pass -----------------------------------
    _drill_guard(mb)
    _wet_steel(mb)
    _fasteners(mb)
    _vent(mb)
    _hose(mb)

    mb.box((0.05, 0.44, 0.16), (1.845, 0.0, STATUS_Z), "EmissiveState")
    # The footprint is sim-load-bearing (FactorySnap.stepsFor derives the
    # mating distance from the declared box), so it is asserted where it is
    # caused rather than found later in the shipped bytes by validate_glb.
    mf.assert_inside(mb, HALF, HALF, H, "Miner_LOD0")
    return mb, mb.build(NAME + "_LOD0", root)


def _proxy_bulk(mb):
    """RN-1623. EVERY LOD0 FEATURE THAT STANDS FURTHER THAN ONE SHADOW TEXEL
    FROM THE PROXY, BLOCKED IN AT ITS OWN ENVELOPE. One box per feature, which
    is the technique RN-561 authored for the smelter and the same reason.

    THESE ARE NOT DECORATIONS AND NOTHING HERE IS EVER SEEN. This mesh is a
    shadow caster and a distant silhouette; every box below exists because
    `check_shadow_lod` measured a LOD0 vertex too far from this tier's SURFACE
    and a cascade therefore had to fall back to drawing all 2,032 triangles.

    THE ENVELOPES ARE MEASURED, NOT EYEBALLED. Each one was read off a trace of
    of_lib.MeshBuilder._add over this file's own LOD0 build, so a box here is
    the true bounding volume of the part it answers for, and every expression
    below is written in the SAME constants the LOD0 feature is written in. A
    greeble that moves takes its proxy with it.

    WHY A BOX IS ENOUGH, and it is worth stating because it is not obvious.
    The metric is the distance from a LOD0 vertex to the NEAREST POINT of this
    mesh's surface, so a vertex needs only ONE of its three coordinates to lie
    on a face of the box that contains it. A part's extreme vertices always do,
    by construction, which is why a flat ring like the drill collar is answered
    honestly by a slab of exactly its own thickness: every vertex it has is on
    the slab's top or bottom face, at zero."""
    # THE GUARD CAGE, AND ITS 8 SEGMENTS ARE THE CAGE'S OWN LATTICE. This was
    # the worst single number on the machine at 622 mm for the bars and 641 mm
    # for the hoops: LOD1 had two guide posts on the X axis and two stubs on
    # the Y axis, and the four bars at 45 degrees stood in open air 0.62 m from
    # anything. A band at the cage's own radius answers bars and hoops at once.
    # `guard_cage` places its bars with `ring_boxes` at 2*pi*i/8 and rolls its
    # hoops from `arc_ring` at segs=8, i.e. BOTH sit on vertices of an 8-fold
    # lattice; a proxy ring on that same lattice therefore puts every bar and
    # every hoop vertex on a facet CORNER, where the band is at its full
    # radius, instead of at a facet midpoint where a coarse ring sags away from
    # it. That is what buys a 72-triangle ring where an aligned-by-luck one
    # would have needed 136 to hold the same tolerance.
    for a0 in (0.0, 180.0):
        mb.arc_band(GUARD_R - 0.05, GUARD_R + 0.05, GUARD_Z1 - GUARD_Z0,
                    (0.0, 0.0, (GUARD_Z0 + GUARD_Z1) * 0.5),
                    a0, a0 + 180.0, GUARD_BARS // 2, "Steel")
    # The drill guide collar (640 mm): a flat ring, so a slab of its own
    # thickness holds every vertex it has at zero. See the docstring.
    mb.box((2.0 * GUIDE_R + GUIDE_T, 2.0 * GUIDE_R + GUIDE_T, GUIDE_T),
           (0.0, 0.0, GUIDE_Z), "SteelDark")
    # The hazard collar where the column enters the body underside (100 mm).
    # Same argument: a 12-gon disc, and its two flat faces are the whole job.
    mb.box((1.40, 1.40, 0.20), (0.0, 0.0, BODY_Z0), "SteelDark")

    # THE POWER DUCT (449 mm at its top elbow, 385 along the run). Three boxes
    # for the three legs `_duct` routes, at the elbow width rather than the
    # pipe width, because `pipe_run`'s elbows are the parts that reach.
    elb = DUCT_W * 1.28
    mb.box((1.86 + elb * 0.5 - HOUSE_HALF, elb, elb),
           ((HOUSE_HALF + 1.86 + elb * 0.5) * 0.5, DUCT_Y, 2.92), "SteelDark")
    mb.box((elb, elb, 2.92 - (1.70 - elb * 0.5)),
           (1.86, DUCT_Y, (1.70 - elb * 0.5 + 2.92) * 0.5), "SteelDark")
    mb.box((1.86 - (1.55 - DUCT_W * 0.5), DUCT_W, DUCT_W),
           ((1.55 - DUCT_W * 0.5 + 1.86) * 0.5, DUCT_Y, 1.70), "SteelDark")

    # THE LADDER (331 mm at the stringers, 222 at the rungs). `mf.ladder` runs
    # its stringers 0.22 past each end of the rung run and stands them a
    # `stringer` layer proud of the face, so the envelope is derived from the
    # same three constants the call uses.
    lad_out = mf.layer("stringer")
    mb.box((0.34 + 0.055, lad_out * (1.0 + mf.EMBED),
            LADDER_V1 - LADDER_V0 + 0.44),
           (LADDER_U, BODY_HALF + lad_out * (1.0 - mf.EMBED) * 0.5,
            (LADDER_V0 + LADDER_V1) * 0.5 + 0.22), "Steel")

    # The motor housing's junction box and its lid and bolts (281 to 325 mm).
    # ITS FOUR LID BOLTS ARE WHAT SET THE FRONT PLANE, not the housing: they
    # stand on a `plate` above it and reach y = 1.27, and a proxy stopping at
    # the housing's own 1.231 leaves each bolt 69 mm inside with no face near
    # it. Read off the trace rather than re-derived through three of
    # `mf.junction`'s internal layers.
    mb.box((0.34, 1.231 - 0.795, 0.30), (-0.42, (0.795 + 1.231) * 0.5, 2.86),
           "SteelDark")
    # ...and a second, thin box AT the bolt layer rather than a taller single
    # one, because a bolt sitting INSIDE a box in all three axes is exactly the
    # case the box technique does not cover: it needs one of its coordinates on
    # a face. This plate puts both of its y faces there, at zero.
    mb.box((0.34, 1.27 - 1.21, 0.30), (-0.42, (1.21 + 1.27) * 0.5, 2.86),
           "SteelDark")

    # The power inlet bracket (280 mm). The LOD0 box, unchanged: it is already
    # a plain box and there is nothing to simplify.
    mb.box((0.28, 0.40, 0.40), (PWR_X - 0.14, PWR_Y, PWR_Z - 0.20), "Steel")

    # THE TWO CANOPY EAVES (222 mm at the lips, 132 at the gussets). A lip and
    # a gusset band per face: the lip reaches the footprint edge and the
    # gussets hang under it, and they are far enough apart in Z that one box
    # over both would leave the gusset's own faces stranded in its middle.
    for face, u0, u1 in ((FRONT, -1.50, 0.34), (SERV, -1.45, 1.45)):
        face.part(mb, u1 - u0, 0.10, (u0 + u1) * 0.5, 2.42, "housing", "Steel")
        face.part(mb, (u1 - u0) - 0.27, 0.34, (u0 + u1) * 0.5, 2.42 - 0.17 - 0.03,
                  "bracket", "SteelDark")

    # The dust hose and its two clamp bands (218 mm, 205 mm). Two boxes for the
    # long run and the last leg, at the clamp width, since the clamps reach.
    cl = HOSE_W * 1.44
    mb.box((cl, abs(HOSE[2][1] - HOSE[0][1]) + cl, cl),
           (HOSE[1][0], (HOSE[0][1] + HOSE[2][1]) * 0.5,
            (HOSE[1][2] + HOSE[2][2]) * 0.5 + 0.02), "SteelDark")
    mb.box((abs(HOSE[3][0] - HOSE[2][0]) + cl, cl, cl),
           ((HOSE[2][0] + HOSE[3][0]) * 0.5, HOSE[2][1], HOSE[2][2]),
           "SteelDark")

    # The chute front's gauge cluster (200 mm), at eye height where a reader
    # stands: the one part of this machine a player is ever close to.
    gau = mf.layer("gauge")
    mb.box((0.46, gau * (1.0 + mf.EMBED), 0.20),
           (-0.78, -(CHUTE_Y + gau * (1.0 - mf.EMBED) * 0.5), 1.24),
           "SteelDark")

    # THE THREE PANEL ASSEMBLIES, at their traced envelopes. Each is a coaming
    # or a frame around a recess with several parts inside it, so the envelope
    # is a property of the ASSEMBLY and not of any one call's arguments; it is
    # read off a trace of this file's own LOD0 build rather than re-derived
    # through `mf.hatch`/`mf.louvre`/`mf.tray` internals, which would be three
    # more transcriptions of numbers that already exist. `check_shadow_lod` is
    # the gate that catches the day one of them moves, and it runs.
    mb.box((1.44, 0.17, 0.59), (0.0, -0.975, 2.895), "SteelDark")   # louvre
    mb.box((0.17, 0.94, 0.59), (-1.725, 0.0, 1.895), "SteelDark")   # vent bank
    mb.box((1.00, 0.17, 0.90), (0.62, 1.725, 1.94), "SteelDark")    # hatch
    mb.box((0.19, 0.115, 0.88), (-0.60, 1.7167, 1.96), "SteelDark")  # tray
    # The four body ribs (70 mm) as ONE band. They are 0.07 proud of a 3.40 m
    # body and every rib's outer and top and bottom faces are the band's, so
    # the gaps between them cost nothing the metric can see.
    mb.box((BODY + 0.14, 2.0 * (max(RIB_YS) + 0.13), 0.90), (0, 0, 1.97),
           "SteelDark")
    # The status rail's bezel (100 mm) with the inlay standing 40 mm off it.
    mb.box((0.10, 0.72, 0.36), (1.75, 0.0, STATUS_Z), "SteelDark")
    # The outlet's dark throat plate (100 mm), proud of the chute face.
    mb.box((OUT_W, 0.14, OUT_H + 0.10), (0, -(CHUTE_Y + 0.03), OUT_Z - 0.05),
           "SteelDark")


def build_lod1(root):
    """THE SHADOW PROXY. Hand-built, and re-authored as a proxy by RN-1623.

    WHAT THIS TIER IS FOR, stated first, because it decides everything below.
    `MachineBatch` casts into three CSM cascades, and a cascade may only be
    given a cruder tier if that tier's deviation from LOD0 is under the
    cascade's own texel size (15.47 / 56.25 / 210.94 mm). This mesh measured
    623.57 mm, so ALL THREE cascades fell back to LOD0 and every miner in the
    game cost 4 x 2,032 = 8,128 triangles a frame. That multiplier, not the
    triangle count, is the number worth moving: RN-1103's own note said "the
    day somebody re-authors this proxy to get under 210 they need to know what
    is in the way", and this is that day.

    THE READ IS STILL THE OPEN GANTRY, unchanged: the legs stay, the surface
    detail stays out, and the slot survives as a block because a decimator
    would close it. What is added is `_proxy_bulk`, which is not detail - it is
    the envelope of every feature a cascade could otherwise see hanging in open
    air. Nothing here is drawn where a player can resolve it.

    WHAT THE MEASUREMENT SAID, in the order the boxes answer it: the guard
    cage's off-axis bars and its hoops at 622 and 641 mm (this tier had two
    posts and two stubs on the axes and nothing at 45 degrees), the drill
    collar at 640, the power duct's top elbow at 449, the ladder at 331, the
    motor housing's junction box at 325, the power bracket at 280, the two
    canopy eaves at 222, the dust hose at 218, the gauge cluster at 200, the
    eave gussets at 132, and a 100 mm tail of collar, throat and status bezel.

    THE GUIDE POSTS AND STUBS STAY even though the guard ring now stands
    outboard of them: they answer for `_drill_guide`'s posts, which are at
    r = 0.66 and which the ring at 0.95 says nothing about. RN-1108 bought
    them with a measurement and they are still earning it."""
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
    _proxy_bulk(mb)
    # LAST, ALWAYS: the renderer indexes OF_EmissiveState by slot position, so
    # a part appended after it silently moves every machine's status colour.
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
