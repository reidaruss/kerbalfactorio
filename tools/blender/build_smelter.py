"""
build_smelter.py - Smelter, TypeId 0x12 (of::gameplay::types::Smelter).

    blender --background --python tools/blender/build_smelter.py

Produces assets/models/dist/machines/smelter.glb.

Footprint 4 x 4 m, height 3.60 m. It shipped at 2 x 2 x 2.6, which is Factorio
scale, and it was the last machine still at the old baseline: the assembler is
8 m (FS-57), the storage box is 4 m (FS-68) and `FactoryKinds.FOOTPRINT`
already reads `smelter: 4`. The asset was the lagging half of that number.

WHY 3.60 m AND NOT 3.00 LIKE THE BOX. The housing itself tops out at 3.12,
which is the box's 3.00 plus a roof rim, because a kiln and a container of the
same footprint should have the same shoulder height. The last 0.48 m is the
CHIMNEY, and a chimney that does not clear its own roof is a pipe. So the
family reads box 3.00 < smelter 3.60 < assembler 4.00 by height while the
smelter's HOUSING is exactly the box's size, which is the honest description of
what this machine is: a 4 m box with a stack on it.

WHY THE BODY WAS REDRAWN AND NOT JUST SCALED, which is FS-57's and FS-68's
argument repeated once more. The old smelter was a 2 m kiln: corner bricks
0.22 m square, two jacket bands, a 0.44 m chimney, a hopper stuck on the +Y
face. Scale all of that by two and the bands stop being structural, because a
band's thickness only reads as a stiffener while the panel it stiffens is a
few band-widths across. So this is the box's body language at the box's size:
a low plinth flush to the footprint edge, refractory corner posts, ribs that
show on both side faces, a collar, a rimmed roof pan, and the stack.

THE SLOTS ARE THE POINT, exactly as they are on the box and the assembler.
Each item port is a recessed mouth in the housing face: two jambs, a head, a
sill, a dark throat plate set back from the outer plane, and a painted band
across the head and the sill. A belt terminating at one visibly runs INTO a
hole rather than stopping near a wall.

THE PORT HEIGHTS ARE UNCHANGED AND THAT IS THE WHOLE CONTRACT (FS-57).
socket_item_in stays at z = 0.90 and socket_item_out at z = 0.45, exactly
where build_box.py and build_assembler.py put their own. Every machine in the
game presents item ports at the same two heights, so one belt deck at 0.25 m
reaches all of them and FactoryPorts' rise is a per-role constant instead of a
per-asset one. Only the horizontal offset moved, from 1.00 m to HALF = 2.00 m.

THE FOOTPRINT STAYS AN EVEN WHOLE NUMBER OF METRES and that is not taste.
Machines snap on a 1 m site grid and FactorySnap.stepsFor steps a new part
ceil((fpA + fpB) / 2) cells away, so an even footprint keeps exactly the
half-cell residual PORT_MATE_M (0.65 m) was derived against. An odd footprint
lands on the other side of the rounding and moves the bound for every machine
in the game, not just this one.

WHY THE PLINTH IS NOTCHED UNDER THE OUTLET, which is the one place this file
departs from build_box.py. socket_item_out is at z = 0.45 and its slot's sill
therefore reaches the ground, so the painted band on that sill wants the same
outer plane (y = -HALF) that the plinth's own front face already occupies.
HALF is a hard edge, so the paint cannot move outward; the STEEL has to move
inward instead. Measured on the shipped bytes, build_box.py and
build_assembler.py both still lose that argument: their outlet sill bands are
coplanar with their plinths and the depth test picks a winner per pixel. Here
the plinth is three boxes instead of one and simply is not there across the
outlet's width, which also means a belt deck at 0.25 m can run right up to the
face instead of butting into 0.30 m of skirt. The plinth still alone sets the
4 x 4 footprint: its two outer strips hold all four corners.

MATERIALS ARE SIX AND THAT DECIDED THE BAND COLOUR. The set is SteelDark,
Steel, SteelRust, Accent, Rock and EmissiveState. Rock is the refractory brick
at the corners, which is this machine's one non-steel read and the thing that
tells it apart from the box at 40 m, so it keeps its slot; the painted bands are
therefore Accent rather than the Hazard yellow the box and the assembler use.
Accent also carries the keep-out ring above the plinth and the chute lip, so
one colour means one thing here: this is where the machine hands you something.

RN-1493: THE SIXTH IS THE HOT PATH, AND IT IS A SURFACE AND NOT A TINT. Every
role above resolves to ONE tiling family, `panel`, so before this pass the whole
machine outside the brick was a single texture with five colours multiplied over
it: manufacture out of plate, everywhere, including on a furnace door and a
flue. `SteelRust` maps to the `rust` family (layered oxide plates that have
lifted, spall pits where the scale came away, metalness going DOWN because oxide
is a dielectric), and it is painted by ONE RULE with no exceptions taken for
looks: whatever the fire, the flue gas or the melt touches. That is the stack
foot, tube, arrestor and cap; the firebox coaming and door leaf; the launder
floor and cheeks; and the charging hood's throat. Everything a HAND touches
stays bright - the cleanout dog, the door hinges and latch, the bolt run, the
peep boss, the hood brackets - which is what makes the two read as different
metals rather than as a machine someone recoloured.

LOD1 AND LOD2 DELIBERATELY DO NOT GET IT. RN-561 re-authored LOD1 as a SHADOW
PROXY and LOD2 is a screen-distance tier; a shadow carries no surface, and
adding a sixth material to a tier drawn at range buys a family bucket per
cascade in `MachineBatch` for a difference no camera resolves.

Combustion machine (ASSET-SPECS 2.3): VisualState 1 "working" overrides to
fire orange #FF7A1E at intensity 2.2 rather than the standard green. Idle,
blocked and no-power stay standard so the scanning rule still holds.

HALF IS A HARD EDGE. No LOD0 geometry crosses it in any axis in the tangent
plane, which is what makes the exported bounding box exactly 4 x 4 and the
grid-footprint check exact rather than approximate.

--------------------------------------------------------------------------
RN-552: THE FORM PASS, under docs/web/ART-DIRECTION.md
--------------------------------------------------------------------------
The machine above is correct against every gate it has and it is the defect
ART-DIRECTION.md names: an extruded box with flat colour, four identical
sides, nothing at ankle height, and a firebox that reads as a television
because it is a large white rectangle in a flat wall.

WHAT A SMELTER IS, WHICH IS THE WHOLE BRIEF FOR THIS PASS. It is a shaft
furnace. It is lined with refractory brick that expands when it is hot, so it
is held in COMPRESSION by steel tie rods running the full height of every
corner with a nut and a bearing plate at each end. That single detail is worth
more than any other on this machine, because it is the thing that makes a box
read as a FURNACE rather than as a generic housing, and nothing else in the
machine set has it. It is charged from above and behind, it pours from a
launder at the front, its firebox door is a heavy casting with a dog latch and
a peep hole rather than a pane of glass, and the brick around the pour mouth is
where a furnace shows its age.

THE CLEARANCE IS 0.30 m AND THAT IS THE DESIGN CONSTRAINT, NOT AN OBSTACLE.
The body is 3.40 across on a 4.00 footprint, so a greeble on a body face has
0.30 m before it reaches the hard edge, where the assembler had 0.40. All three
4 m machines share BODY = 3.40, so this is a family fact and narrowing this one
to buy room would break the family for one asset's convenience. Working inside
it has one consequence worth writing down rather than discovering:
`machine_form.junction` stacks a `plate` (0.024) on a `housing` (0.281) and
reaches 0.305, so A JUNCTION BOX DOES NOT FIT ON A 4 m MACHINE'S BODY FACE and
`Face._check` refuses it by name. It goes on the roof, which has 0.68 m of room
between the deck pan and H. That is the footprint assertion doing its job at
design time instead of the validator finding it in the shipped bytes.

WHERE THE TRIANGLES WENT, AND WHY THIS IS NOT THE ASSEMBLER'S BUDGET. The
assembler is the RAREST machine in a base and portcost's own 79-building
reference base contains none at all; it contains TWENTY-TWO SMELTERS. Every
triangle added here is multiplied by 22 and then again by the four passes
`MachineBatch` draws (one main plus three CSM cascades), so this asset's raise
is worth roughly forty times the assembler's in a real frame. The detail is
therefore spent on the two faces a player stands at and on the ONE silhouette
feature (the tie rods and the stack), and the roof railing the assembler bought
for its 8 m roofline is deliberately NOT repeated here: a 4 m roof seen from
the ground is mostly its own rim.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import machine_form as mf  # noqa: E402
import of_lib as of  # noqa: E402

NAME = "Smelter"
OUT = of.dist_path("machines", "smelter.glb")

W = D = 4.00
H = 3.60
HALF = 2.00                     # the hard edge nothing in LOD0 may cross

PLINTH_H = 0.30
BODY = 3.40
BODY_HALF = BODY * 0.5          # 1.70
BODY_Z0 = 0.24                  # the body's foot is BURIED in the plinth, so
                                # its underside shares no plane with the skirt's
BODY_TOP = 2.60
COLLAR = 3.86
COLLAR_TOP = 2.76
DECK = 3.30
DECK_TOP = 2.92                 # the roof PAN; the rim above it reaches 3.12
RIM_T = 0.16
RIM_TOP = 3.12                  # the housing's own top; the stack carries the H
SKIRT_H = 0.06                  # the painted keep-out ring above the plinth

MOUTH_D = HALF - BODY_HALF      # 0.30, the gap the slot frames live in
BAND_D = 0.06                   # painted band thickness, flush with the edge
FRAME_D = MOUTH_D - BAND_D      # 0.24: the frame stops SHORT of the edge, so
                                # the band is a raised strip and not a decal
                                # fighting the steel for the same pixels.

IN_Z = 0.90                     # FS-57's item_in height, unchanged
OUT_Z = 0.45                    # FS-57's item_out height, unchanged
STATUS_Z = 1.90
DOOR_Z = 1.70                   # firebox centre, ABOVE the outlet slot's head
PEEP_Z = DOOR_Z + 0.14          # the sight port, above the door's own centre

# Intake slot. The sill is short (0.18) on purpose: it puts the slot's bottom
# edge at 0.37, clear of the painted skirt at 0.30 to 0.36, so the intake's
# band never shares the plinth's or the skirt's outer plane.
IN_W, IN_H, IN_JAMB, IN_HEAD, IN_SILL = 1.40, 0.70, 0.50, 0.30, 0.18
# Outlet slot. Its sill reaches the ground, which is why the plinth is notched.
OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL = 1.40, 0.50, 0.50, 0.30, 0.20
SLOT_HALF = OUT_W * 0.5 + OUT_JAMB      # 1.20, and the notch's half-width
NOTCH_Y = 1.66                  # the notched plinth's -Y edge. It is INSIDE the
                                # body face at 1.70 rather than on it, so the
                                # plinth's front face is buried in the body
                                # instead of being coplanar with it.

CHIM_R = 0.34
CHIM_Y = 1.00                   # offset toward the BACK, which is what tells a
                                # player at 40 m which way the machine faces
CHIM_Z0 = 2.86                  # the stack's foot, sunk INTO the roof pan
CAP_Z0 = 3.54

POST = 0.36
POST_C = BODY_HALF + 0.02       # 1.72, so a brick post is proud of the body
POST_Z0 = 0.20                  # inside the plinth, and not on the body's foot
POST_TOP = 2.66                 # inside the collar, and not on the body's top
CORNERS = [(sx * POST_C, sy * POST_C) for sx in (-1, 1) for sy in (-1, 1)]

# Power inlet: the body's upper +X shoulder, NOT a top corner. The corners are
# the brick posts and the roof is the stack's, so a nub at either would either
# vanish inside the brick or interpenetrate the roof rim.
PWR_X, PWR_Y, PWR_Z = 1.98, 1.10, 3.02

RIB_YS = (-1.35, -0.90, 0.90, 1.35)

# --- RN-552: the detail frame (machine_form.py) ----------------------------
# The four body faces and the roof pan, each carrying the HARD EDGE nothing
# mounted on it may cross. A greeble that would grow the 4 x 4 footprint or
# push past H fails the BUILD, by name, with the overshoot in metres.
#
# The faces are the BODY's at 1.70, not the plinth's at 2.00, so every layer in
# machine_form.LAYER has 0.30 m to live in. See the module docstring: that is
# 0.10 m less than the assembler had and it is the reason a junction box is on
# the roof here and on a wall there.
FRONT = mf.Face("Y", -1, -BODY_HALF, limit=-HALF, name="front (pour)")
REAR = mf.Face("Y", 1, BODY_HALF, limit=HALF, name="rear (charge)")
SERV = mf.Face("X", -1, -BODY_HALF, limit=-HALF, name="service")
STAT = mf.Face("X", 1, BODY_HALF, limit=HALF, name="status")
ROOF = mf.Face("Z", 1, DECK_TOP, limit=H, name="roof pan")

# |u| beyond this on a body face is INSIDE a brick post. The posts are 0.36
# square centred on 1.72, so they occupy 1.54 to 1.90 and stand 0.02 proud of
# the body: a greeble past 1.54 would be swallowed by one. DERIVED from the
# post's own numbers rather than typed, because the post is what decides it.
CLEAR = POST_C - POST * 0.5 - 0.04                      # 1.50

# RN-1621: THE CHARGE HOOD'S HALF-WIDTH, NAMED, AND THE CABLE TRAY DERIVED
# FROM IT. The other 3 of this asset's 6 pre-existing same-facing pairs were
# the hood and the rear cable tray, and the cause is a property of
# `machine_form` rather than a typo: every part on a face is buried by
# `EMBED` x its own LAYER height, so ANY two parts of the SAME layer on the
# SAME face share a back plane exactly. The hood is a `warped` "tray" and the
# run is a `tray`, both 0.074, so both backs sat on y = 1.6593 and the tray
# overlapped the hood in plan.
#
# THAT IS NOT FIXED IN machine_form. Changing EMBED or making the burial
# layer-unique would move geometry on every machine in the game to close two
# buried faces on one of them, which is a far larger change than the defect.
# It is fixed HERE, where the actual mistake is: the tray was at u = 1.14, so
# 85 mm of a 130 mm conduit ran INSIDE the hopper, and from v = 1.34 up it was
# swallowed by the hood's own flare entirely. Half a metre of authored cable
# tray nobody could ever see, which is the same defect class as the miner's
# kick plate that was authored inside its outlet frame.
#
# THE RUN IS CENTRED IN THE CLEAR LANE, so moving either neighbour moves it
# and the pair cannot recur (the miner's PLACARD_U rule). The lane runs from
# the hood's edge to the brick post's, and the widest part of the run is the
# P-CLIP, not the conduit: `mf.tray` makes its clips `width + 0.05`, so the
# clip is what has to fit and it clears each neighbour by 80 mm.
HOOD_U = 1.16
TRAY_W = 0.13
TRAY_U = (HOOD_U + CLEAR) * 0.5                         # 1.33

# The rubbing strip at the foot of every face. Its TOP is derived from the
# painted skirt it stands on and its height is 40 mm more than the exposed
# part, so its underside is BURIED in the skirt rather than resting on the
# skirt's top plane.
KICK_TOP = PLINTH_H + SKIRT_H + 0.40                    # 0.76
KICK_H = 0.40 + 0.04                                    # 0.44

# Plate courses through the body, showing on the +Y and -Y faces. They clear
# the port mouths, whose frames reach |u| = 1.20, and stop short of the brick
# posts' inner edge at 1.54.
SEAM_US = (-1.42, 1.42)
SEAM_Z0, SEAM_Z1 = 0.46, 2.44

# --- the tie rods, and they are the best idea in this pass ------------------
# A shaft furnace is lined with refractory that grows when it is hot, so the
# lining is held in COMPRESSION by steel rods running the full height of the
# shell with a nut and a bearing plate at each end. It is the detail that makes
# a box read as a FURNACE rather than as a housing, nothing else in the machine
# set has one, and it costs three boxes per corner.
#
# THE ROD IS OUTBOARD OF THE BRICK POST, NOT ON IT. A rod centred on the post
# would be swallowed: the post stands 0.02 proud of the body and the rod is
# 0.09 across. It sits on the post's own DIAGONAL, pushed out to 1.86 in both
# axes, which is 0.14 inside the footprint edge and clear of both slot frames.
TIE_C = 1.86
TIE_W = 0.09
# THE ROD'S FOOT IS BURIED IN THE PLINTH, NOT STOOD ON IT, and the coplanar
# gate is what said so. The first version used TIE_Z0 = PLINTH_H exactly, on
# the reasonable-sounding grounds that a tie rod stands on the foundation. The
# painted skirt's own UNDERSIDE is also at PLINTH_H and also points down, so
# every rod put a Steel down-face on an Accent down-face: 8 of this asset's 12
# new same-facing pairs, and RN-411's catalogued cause verbatim, a part whose
# extent lands exactly on its host's boundary plane. Buried by BODY_Z0's own
# reasoning and DERIVED from the plinth rather than typed, so moving the plinth
# moves the rod with it.
TIE_Z0 = PLINTH_H - 0.06        # inside the plinth, sharing no plane with it
TIE_Z1 = 2.84                   # under the roof pan, so the top nut is visible


def _mouth(mb, sign, z_c, open_w, open_h, jamb, head_h, sill_h, band_role):
    """A recessed port slot in the +Y (sign 1) or -Y (sign -1) face.

    Two jambs, a head and a sill fill the first 0.24 m of the step between the
    body face and the footprint edge, leaving a hole `open_w` by `open_h`
    centred on `z_c`; the painted band fills the last 0.06 m across the head and
    the sill, so the slot is legible as a port from across the base. A dark
    throat plate stands proud of the body face so the hole has a visible
    bottom."""
    z0 = z_c - open_h * 0.5
    z1 = z_c + open_h * 0.5
    lo, hi = z0 - sill_h, z1 + head_h
    outer_w = open_w + 2.0 * jamb
    jamb_c = (open_w + jamb) * 0.5
    y_frame = sign * (BODY_HALF + FRAME_D * 0.5)    # 1.82, the frame's middle
    y_throat = sign * (BODY_HALF + 0.05)            # 1.75, proud of the body
    y_band = sign * (HALF - BAND_D * 0.5)           # 1.97, flush with the edge

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


def _mouth_block(mb, sign, z_c, open_w, open_h, jamb, head_h, sill_h):
    """The same slot at LOD1: a filled frame block plus a dark inset, so the
    port is still where it was and still reads dark, at three boxes instead of
    seven. A decimator cannot do this to a slot; it closes the hole.

    THE STEEL STOPS AT FRAME_D AND THE ACCENT BAND OWNS THE EDGE, WHICH IS
    LOD0'S OWN RULE AND THIS TIER WAS BREAKING IT. `_mouth` puts its frame at
    1.70 to 1.94 and lets the painted band fill 1.94 to 2.00, precisely so that
    nothing but paint occupies the footprint plane. This block ran Steel the
    whole way from 1.70 to HALF instead.

    That was harmless for as long as nothing else Accent reached y = 2.00 on
    this mesh, and it stopped being harmless the moment RN-561 gave this tier
    the painted skirt it needed for the anchor bolts' contact shadow: skirt
    side against mouth-block face, Accent against Steel, both outward, both on
    2.0000. Seven pairs, four at the intake and three at the outlet, and the
    fix is not to move the skirt but to make this block obey the rule the
    detailed tier already obeys."""
    lo = z_c - open_h * 0.5 - sill_h
    hi = z_c + open_h * 0.5 + head_h
    outer_w = open_w + 2.0 * jamb
    mb.box((outer_w, FRAME_D, hi - lo),
           (0, sign * (BODY_HALF + FRAME_D * 0.5), (lo + hi) * 0.5), "Steel")
    mb.box((outer_w, BAND_D, hi - lo),
           (0, sign * (HALF - BAND_D * 0.5), (lo + hi) * 0.5), "Accent")
    mb.box((open_w, 0.10, open_h), (0, sign * (HALF - 0.06), z_c), "SteelDark")


def _plinth(mb):
    """The footprint, in three boxes rather than one.

    The main slab runs from the notch line back to +HALF; two strips carry it
    out to -HALF on either side of the outlet, so all four corners are held and
    the exported bounding box is exactly 4 x 4. What is deliberately ABSENT is
    the strip directly under socket_item_out: see the module docstring."""
    mb.box((W, HALF + NOTCH_Y, PLINTH_H),
           (0, (HALF - NOTCH_Y) * 0.5, PLINTH_H * 0.5), "SteelDark")
    for s in (-1, 1):
        mb.box((HALF - SLOT_HALF, HALF - NOTCH_Y, PLINTH_H),
               (s * (HALF + SLOT_HALF) * 0.5, -(HALF + NOTCH_Y) * 0.5,
                PLINTH_H * 0.5), "SteelDark")


def _shell(mb):
    """Plinth, body, collar and roof pan: the stepped silhouette every LOD
    keeps. The plinth alone sets the 4 x 4 footprint, so no detail part has to
    be trimmed to hold the cell edge."""
    _plinth(mb)
    mb.box((BODY, BODY, BODY_TOP - BODY_Z0),
           (0, 0, (BODY_Z0 + BODY_TOP) * 0.5), "Steel")
    mb.box((COLLAR, COLLAR, COLLAR_TOP - BODY_TOP),
           (0, 0, (BODY_TOP + COLLAR_TOP) * 0.5), "SteelDark")
    mb.box((DECK, DECK, DECK_TOP - COLLAR_TOP),
           (0, 0, (COLLAR_TOP + DECK_TOP) * 0.5), "Steel")


def _posts(mb):
    """Refractory brick corner posts: this machine's one non-steel read.

    They start inside the plinth and stop inside the collar, so neither end
    leaves a face coplanar with a face of the shell. The old 2 m smelter set
    them FLUSH with the body face at BODY_HALF, which put brick and steel on
    exactly one plane over the whole height of the machine; measured on the
    shipped bytes that was 24 overlapping coplanar pairs, and it is why they
    are 0.02 proud here."""
    for cx, cy in CORNERS:
        mb.box((POST, POST, POST_TOP - POST_Z0),
               (cx, cy, (POST_Z0 + POST_TOP) * 0.5), "Rock")


def _tie_rods(mb):
    """Four full-height tie rods with a bearing plate and a nut at each end.

    See the TIE_C block above for why they exist and why they are outboard of
    the brick. The plate is WIDER than the nut and the nut is proud of the
    plate, so the three parts of an end fitting have three different outer
    planes and none of them can be coplanar with another."""
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * TIE_C, sy * TIE_C
            mb.box((TIE_W, TIE_W, TIE_Z1 - TIE_Z0), (x, y, (TIE_Z0 + TIE_Z1)
                                                     * 0.5), "Steel")
            for z, s in ((TIE_Z0 + 0.11, 1), (TIE_Z1 - 0.11, -1)):
                mb.box((0.24, 0.24, 0.07), (x, y, z), "SteelDark")
                mb.box((0.15, 0.15, 0.11), (x, y, z + s * 0.055), "Steel")


def _posts_coursed(mb):
    """The refractory posts, laid in COURSES instead of extruded.

    Three stacked blocks of alternating width rather than one 2.46 m box. Brick
    is the only non-steel material on this machine and the thing that tells it
    apart from the storage box at 40 m, so it is worth two extra boxes per
    corner to make it read as masonry rather than as a painted pilaster. The
    middle course is 20 mm narrower, which puts a horizontal shadow line at two
    heights on every corner of the machine for twenty-four triangles apiece."""
    zs = ((POST_Z0, 1.05, POST), (1.05, 1.86, POST - 0.04), (1.86, POST_TOP,
                                                             POST))
    for cx, cy in CORNERS:
        for z0, z1, w in zs:
            mb.box((w, w, z1 - z0), (cx, cy, (z0 + z1) * 0.5), "Rock")


def _plating(mb):
    """Plate courses across the +Y and -Y faces.

    `through_seam` runs one strap the whole way through the body, so twelve
    triangles buy TWO visible seams and the two can never drift out of line
    with each other, because they are one box. The ribs this machine already
    had do the same job on the +X and -X faces at a heavier stand-off, so the
    two axes now read as ribs one way and plate joints the other, which is what
    a welded shell inside a stiffened frame actually looks like."""
    mf.through_seam(mb, "Y", BODY_HALF, SEAM_US, SEAM_Z0, SEAM_Z1, 0.10,
                    "SteelDark")


def _anchors(mb):
    """The machine is BOLTED DOWN, and the skirt stops being a blank ring.

    One anchor pad per side, each carrying a bolt. This closes the same frame
    the assembler's anchors closed: a player-eye view of the front-lower corner
    was a picture of an empty band and an empty slab. The -Y pad is at +X only,
    because `_plinth` deliberately removes the foundation across the outlet and
    a pad over the notch would stand on nothing."""
    skirt = mf.Face("Z", 1, PLINTH_H + SKIRT_H, limit=H, name="skirt top")
    pad = mf.Face("Z", 1, skirt.out(mf.layer("boss")), limit=H, name="pad top")
    for loc in ((0.0, 1.82), (0.0, -1.82), (1.82, 0.0), (-1.82, 0.0),
                (1.60, -1.82)):
        if loc[1] < -1.0 and abs(loc[0]) < SLOT_HALF:
            continue
        du, dv = (0.30, 0.22) if abs(loc[1]) > abs(loc[0]) else (0.22, 0.30)
        skirt.part(mb, du, dv, loc[0], loc[1], "boss", "SteelDark")
        pad.part(mb, 0.08, 0.08, loc[0], loc[1], "bolt", "Steel")


def _front_detail(mb):
    """The -Y face: THE POUR SIDE, and the one a player stands at.

    It carries the firebox and the launder, so this is where the triangles go.
    Everything here is aimed at a person 3 m away and 1.7 m tall."""
    # The rubbing strip, in two runs either side of the outlet, and the -X run
    # is KICKED IN. Wear as geometry, which is the half of wear that survives
    # whatever any texture does: a dent is the CAUSE a scuff is the effect of.
    # This corner is where the ingot cart hits, which is why the dent is here
    # and not on a face nothing passes.
    #
    # STEELDARK AND NOT ACCENT, AND THE FIRST BUILD PROVED WHY. A kick plate
    # is a rubbing strip and rubbing strips are bare metal; painting it in the
    # machine's own accent put THREE orange bands within 0.5 m of the ground
    # (the port sill's, the painted skirt's and this one), which the detail
    # render showed as a solid orange plinth with the geometry lost inside it.
    # The Accent on this machine means "here is where it hands you something",
    # and a colour that means one thing has to be spent on one thing.
    mf.kick_plate(mb, FRONT, -CLEAR, -1.02, KICK_TOP, KICK_H, "SteelDark",
                  dent=0.72, dent_at=-1)
    mf.kick_plate(mb, FRONT, 1.02, CLEAR, KICK_TOP, KICK_H, "SteelDark")

    # THE FIREBOX STOPS BEING A TELEVISION. It was a 1.60 x 0.86 emissive slab
    # flush in a flat wall, which is a lit rectangle and not a door. A furnace
    # door is a heavy casting: it sits inside a raised coaming, it is hung on
    # two knuckles down one side, it is dogged shut by a lever on the other,
    # and the only light that gets out gets out through a PEEP HOLE. So the
    # emissive area drops to a 0.30 x 0.22 port and a thin sight strip, and the
    # rest of what used to glow is now iron.
    #
    # AND THE CASTING IS THE ONE THING ON THIS MACHINE THAT LIVES AT FLAME
    # TEMPERATURE, so RN-1493 gives the coaming and the door leaf `SteelRust`
    # while every piece of HARDWARE bolted to them stays bright: the hinges,
    # the dog, the lever, the bolt run and the peep boss are all still
    # SteelDark and Steel. That contrast is the whole reason to spend a role
    # here rather than a tint - dark matte oxide with sound metal fittings on
    # it is what a furnace door looks like, and neither half reads as either
    # while both wear `panel`.
    FRONT.coaming(mb, 1.34, 0.94, 0.0, DOOR_Z, "SteelRust", rail=0.085)
    FRONT.part(mb, 1.34, 0.94, 0.0, DOOR_Z, "plate", "SteelRust")
    door = mf.Face("Y", -1, FRONT.out(mf.layer("plate")), limit=-HALF,
                   name="firebox door")
    for s in (-1, 1):
        door.part(mb, 0.10, 0.24, -0.60, DOOR_Z + s * 0.30, "hinge",
                  "SteelDark")
    door.part(mb, 0.09, 0.46, 0.60, DOOR_Z, "latch", "SteelDark")
    door.part(mb, 0.34, 0.09, 0.30, DOOR_Z - 0.02, "latch", "Steel")
    mf.bolt_run(mb, door, -0.42, 0.42, DOOR_Z - 0.38, 4, 0.055, "SteelDark")
    # The peep hole's SURROUND. A sight port in a furnace door is a heavy
    # casting with a cover you swing aside, so the hole stands off the door on
    # its own boss rather than being a hole in flat plate.
    door.part(mb, 0.40, 0.32, 0.0, PEEP_Z, "boss", "SteelDark")

    # A cable riser on the -X third and NOTHING on the +X third, which is the
    # asymmetry this face was still missing. Both thirds were blank between the
    # kick plate and the collar, and giving them the same fitting would have
    # made the front symmetric about the door again. The +X third has the
    # placard instead, at a different height, so the two sides balance by mass
    # without matching.
    mf.tray(mb, FRONT, -1.24, 0.98, 1.86, 0.12, 3, "SteelDark", "Steel")

    # The launder: the outlet stops being a shelf and becomes a channel.
    # A pour that runs off the side of a flat shelf is a pour on the floor, so
    # a real one has CHEEKS. They are taller than the floor of the channel and
    # narrower than the lip, so the three parts stack without sharing a plane.
    # RN-1493: the channel the MELT runs down takes the oxide too, for the same
    # reason the stack does. The Accent lip below it does not, because a painted
    # lip is repainted and that is what a keep-out marking is for.
    # RN-1621. THE FLOOR IS BURIED IN THE SILL RATHER THAN RESTING ON ITS OWN
    # BOTTOM PLANE, and this is 3 of the 6 same-facing pairs this asset shipped
    # with (`check_coplanar`, pre-existing, older than RN-1493's oxide pass).
    # The slab was 0.10 thick centred on 0.25, so its UNDERSIDE landed on
    # z = 0.20 - which is the outlet mouth's own sill top and therefore the
    # throat plate's underside too (see `_mouth`: the opening runs 0.20 to
    # 0.70). Two down-facing surfaces of different materials on one plane, and
    # the file's catalogued cause verbatim: a part dimensioned to END exactly
    # where the part it is mounted on ends.
    #
    # THE FIX IS THE CRUST'S OWN RULE ONE LEVEL UP. Slag does not sit on the
    # launder floor, it welds itself into it; a launder does not sit on the
    # sill's bottom plane either, it is welded to the shell and its slab passes
    # BEHIND the sill. So the top stays exactly where it was (0.30, which the
    # two crust blocks are sunk into) and the underside drops out of the
    # crowded plane into solid steel.
    #
    # THE DEPTH IS `machine_form.EMBED` AND NOT A NUDGE. That constant is this
    # project's published burial rule - a part's back sits inside its host by
    # 0.55 of how far its front stands proud - and it is exactly the number a
    # `Face.part` would have used had the launder been authored as one. The
    # slab stands LAUNDER_T proud of the sill top, so it is buried 0.55 of
    # that, and the only face that moves is the one that was in the fight.
    LAUNDER_TOP, LAUNDER_T = 0.30, 0.10
    launder_h = LAUNDER_T * (1.0 + mf.EMBED)                # 0.155
    mb.box((1.30, 0.24, launder_h), (0, -1.86, LAUNDER_TOP - launder_h * 0.5),
           "SteelRust")
    for s in (-1, 1):
        mb.box((0.09, 0.26, 0.20), (s * 0.66, -1.85, 0.34), "SteelRust")
    mb.box((1.44, 0.08, 0.06), (0, -1.96, 0.25), "Accent")
    # The crust. A launder that has poured is a launder with slag frozen on its
    # lip, and that is a fact about the SHAPE, not only about the colour: two
    # small blocks of unequal size on unequal centres, which is the cheapest
    # asymmetry in the file at twenty-four triangles.
    #
    # BOTH ARE SUNK INTO THE LAUNDER FLOOR. Their first version started at
    # z = 0.30, which is the launder floor's top AND the painted skirt's own
    # underside, and slag lying exactly on a boundary plane is the remaining 4
    # of this asset's 12 new coplanar pairs. Slag does not sit on a surface, it
    # welds itself to one, so burying the block is also the truer shape.
    # AND THEIR FRONT FACES STOP SHORT OF THE LAUNDER'S OWN. The second build
    # still read 2 pairs: the larger block was 0.10 deep centred on -1.93, so
    # its front landed on exactly -1.98, which is the launder floor's front
    # plane, Rock against SteelDark. Same cause as the two already fixed above,
    # one axis over, and it is worth writing down that the SECOND fix for a
    # cause re-committed it: burying the block in Z said nothing about Y.
    mb.box((0.22, 0.09, 0.07), (-0.34, -1.925, 0.315), "Rock")
    mb.box((0.14, 0.08, 0.06), (0.41, -1.915, 0.310), "Rock")

    mf.placard(mb, FRONT, -1.24, 2.12, 0.40, 0.26, "Accent")
    mf.bolt_run(mb, FRONT, -CLEAR + 0.10, CLEAR - 0.10, 2.40, 6, 0.05,
                "SteelDark")


def _rear_detail(mb):
    """The +Y face: THE CHARGE SIDE, and it has to look like one.

    The asymmetry is why this is a separate function from `_front_detail`. A
    machine whose four sides are the same object with the same fittings is a
    symmetric solid however much is bolted to it. This side gets a charging
    hood and the vibrator that shakes ore down it; the front gets the door and
    the launder; the service side gets the air and the hatch."""
    mf.kick_plate(mb, REAR, -CLEAR, CLEAR, KICK_TOP, KICK_H, "SteelDark")
    # The charging hood, leaning out as it RISES: ore is tipped in from above,
    # so the mouth is wider than its throat. It leans the OPPOSITE way to the
    # front's launder lip, which is what makes the intake and the outlet
    # distinguishable by SHAPE from across the base rather than by colour.
    # RN-1493: hot ore goes down this, so the hood is on the oxide path with
    # the stack, the door and the launder. Its brackets are structure bolted to
    # the shell rather than part of the throat, so they stay SteelDark.
    REAR.warped(mb, [(-HOOD_U, 1.34, 1.00), (HOOD_U, 1.34, 1.00),
                     (HOOD_U, 1.86, 3.60), (-HOOD_U, 1.86, 3.60)],
                "tray", "SteelRust")
    for s in (-1, 1):
        REAR.wedge(mb, s * 1.06, 0.07, 1.34, 0.22, 0.30, "bracket",
                   "SteelDark")
    # The hopper vibrator. Round and paid for: `finned_drum`'s own note is that
    # a drum is where round is worth the triangles, because it is large and
    # reads as a machined part where a hexagonal pipe does not. Mounted on ONE
    # side, because a machine with a motor on both sides is symmetric again.
    #
    # 0.17 AND 1.80 ARE WHAT THE FOOTPRINT ALLOWS, AND THE GATE PICKED THEM.
    # The first version was 0.20 at 1.90 centred on y = 1.86, which puts the
    # drum's own shoulder at 2.06 and `assert_inside` refused the build with
    # "Y high by 0.06000". `finned_drum`'s docstring predicts exactly this and
    # names the number that has to move: on a machine with 0.30 m of clearance
    # a drum reaches out by its RADIUS and its fins by half their SPAN, so the
    # two have to be solved together against the hard edge rather than chosen.
    # 0.17 + 1.82 puts the drum at 1.99 and the fins at 1.973.
    mf.finned_drum(mb, 0.17, 0.52, (-1.06, 1.82, 2.16), "X", 3, "SteelDark",
                   "Steel", segments=8, fin_span=1.80)
    mf.tray(mb, REAR, TRAY_U, 0.95, 2.34, TRAY_W, 4, "SteelDark", "Steel")


def _service_detail(mb):
    """The -X face: combustion air, the maintenance hatch, and THE CLIMB.

    THE LADDER IS THE BEST TRIANGLES ON THIS MACHINE AND THE REASON IS SCALE,
    NOT DETAIL. It is the only greeble whose size a player already knows, so it
    says the machine is nearly four metres tall more loudly than the machine
    being four metres tall does, and it puts a hard vertical notch in an
    outline that was otherwise a rectangle.

    It stops at 2.28 and arrives at a bracketed landing rather than running to
    the pan. That is arithmetic and not a decision: the collar is 0.23 proud of
    the body from 2.60 to 2.76 and a stringer stands 0.139 proud, so a ladder
    taken any higher DISAPPEARS INSIDE the collar and reappears as a stub."""
    mf.kick_plate(mb, SERV, -CLEAR, CLEAR, KICK_TOP, KICK_H, "SteelDark",
                  dent=0.38, dent_at=1)
    mf.louvre(mb, SERV, 0.86, 1.32, 1.10, 0.86, 4, "SteelDark", "Steel")
    mf.step_tread(mb, SERV, -0.96, 0.66, 0.54, "SteelDark",
                  base=PLINTH_H + SKIRT_H)
    mf.ladder(mb, SERV, -0.96, 0.96, 2.28, 0.42, 5, "Steel")
    SERV.part(mb, 0.84, 0.07, -0.96, 2.46, "duct", "SteelDark")
    for s in (-1, 1):
        SERV.wedge(mb, -0.96 + s * 0.30, 0.07, 2.42, 0.20, 0.26, "bracket",
                   "SteelDark")


def _status_detail(mb):
    """The +X face: the instruments and the maintenance hatch.

    A furnace is the one machine in this set where a gauge cluster is not
    decoration: temperature and pressure are the two things an operator reads,
    and they are read from where somebody stands, which is why they are at
    1.42 and not wherever a render would put them."""
    mf.kick_plate(mb, STAT, -CLEAR, CLEAR, KICK_TOP, KICK_H, "SteelDark")
    mf.gauge_cluster(mb, STAT, -0.92, 1.42, 2, "SteelDark", "Steel")
    mf.hatch(mb, STAT, 0.72, 1.46, 0.90, 1.00, "Steel", "SteelDark",
             "Accent", hinge_side=1)
    mf.tray(mb, STAT, -1.34, 0.95, 2.52, 0.12, 4, "SteelDark", "Steel")
    mf.placard(mb, STAT, -0.92, 2.14, 0.38, 0.24, "Accent")


def _roof_detail(mb):
    """The pan: the stack, its cleanout, and the electrics.

    THE JUNCTION BOX IS HERE AND NOT ON A WALL, AND THAT IS THE FOOTPRINT
    TALKING. `machine_form.junction` stands a `plate` lid on a `housing` body
    and reaches 0.305 m proud; a body face on a 4 m machine has 0.30 m. It is
    refused by name on every wall of this machine and fits with 0.38 m to
    spare on the pan, which is the gate deciding a layout question at design
    time instead of the validator finding it in the shipped bytes."""
    mf.junction(mb, ROOF, -1.10, -1.06, 0.44, 0.52, "SteelDark", "Steel")
    # The stack's plumbing goes SOMEWHERE: the junction box feeds the vibrator
    # motor on the rear face, and the run is the only thing on the pan that
    # crosses it. A machine's fittings that end in mid-air are decoration.
    mf.pipe_run(mb, [(-1.10, -0.82, 3.00), (-1.10, 1.30, 3.00),
                     (-1.06, 1.30, 3.00)], 0.11, "SteelDark", "Steel")


def _stack(mb):
    """The chimney: a flared foot, a tube, a rain cap, and a CLEANOUT.

    It was three concentric cylinders of three diameters, which is already
    better than a pipe, and the two things it lacked are the two things that
    make a stack read as a working one. A cleanout door at the foot, where soot
    is actually raked out, and a spark arrestor band under the cap. Both sit on
    the tube rather than beside it, so neither costs a silhouette that the
    0.34 m radius has not already paid for."""
    mb.cylinder(CHIM_R + 0.12, 0.14, (0, CHIM_Y, DECK_TOP + 0.07), axis="Z",
                segments=8, role="SteelRust")
    mb.cylinder(CHIM_R, (CAP_Z0 + 0.04) - CHIM_Z0,
                (0, CHIM_Y, (CHIM_Z0 + CAP_Z0 + 0.04) * 0.5), axis="Z",
                segments=12, role="SteelRust")
    # The cleanout, on the -Y quadrant so it faces the player who is already
    # looking at the firebox. It is a door with a hinge and a dog, at a quarter
    # the size of the firebox's, because it is the same idea one scale down.
    #
    # THE DOG STAYS BRIGHT STEEL AND THAT IS THE POINT OF LEAVING IT (RN-1493).
    # Everything a hand turns is wiped clean by the turning; everything the flue
    # gas touches is not. So the tube, the foot, the arrestor and the cap take
    # the oxide and this one 90 mm block does not, which is the cheapest true
    # detail on the stack and costs no triangles at all.
    mb.box((0.26, 0.06, 0.24), (0, CHIM_Y - CHIM_R - 0.02, 3.16), "SteelRust")
    mb.box((0.09, 0.05, 0.09), (0.10, CHIM_Y - CHIM_R - 0.05, 3.16), "Steel")
    # The spark arrestor: a band of a third diameter between the tube and the
    # cap, so the stack now has FOUR diameters over its length instead of
    # three, and the eye reads a fitting rather than a taper.
    mb.cylinder(CHIM_R + 0.05, 0.10, (0, CHIM_Y, CAP_Z0 - 0.09), axis="Z",
                segments=8, role="SteelRust")
    mb.cylinder(CHIM_R + 0.10, H - CAP_Z0, (0, CHIM_Y, (CAP_Z0 + H) * 0.5),
                axis="Z", segments=8, role="SteelRust")


def build_lod0(root):
    mb = of.MeshBuilder()
    _shell(mb)

    # painted keep-out ring: the band of plinth left proud of the body. It sits
    # entirely ABOVE the plinth top rather than straddling it, so its side faces
    # never overlap the plinth's own on the footprint plane. It is also why the
    # intake slot's sill stops at 0.37 and not lower.
    mb.box((W, D, SKIRT_H), (0, 0, PLINTH_H + SKIRT_H * 0.5), "Accent")
    _posts_coursed(mb)
    _tie_rods(mb)

    # body ribs. ONE box per rib spans the whole width and shows on BOTH side
    # faces, so eight visible ribs cost four boxes and neither ribbed face can
    # ever drift out of line with the other. They are placed clear of the
    # status rail at y = 0 and clear of the brick posts at |y| = 1.54.
    for y in RIB_YS:
        mb.box((BODY + 0.14, 0.28, 2.10), (0, y, 1.45), "SteelDark")

    # roof rim: the lip that carries the HOUSING to 3.12, which is why nothing
    # on the pan itself has to reach that height and z-fight the deck. It is
    # 0.03 wider than the pan on each side, so the pan's own edge face is
    # covered rather than coplanar with it.
    rim_c = DECK * 0.5 - 0.05
    for s in (-1, 1):
        mb.box((DECK + 0.06, RIM_T, RIM_TOP - DECK_TOP),
               (0, s * rim_c, (DECK_TOP + RIM_TOP) * 0.5), "SteelDark")
        mb.box((RIM_T, DECK + 0.06, RIM_TOP - DECK_TOP),
               (s * rim_c, 0, (DECK_TOP + RIM_TOP) * 0.5), "SteelDark")

    # the two item slots: intake on +Y at 0.90, output on -Y at 0.45.
    _mouth(mb, 1, IN_Z, IN_W, IN_H, IN_JAMB, IN_HEAD, IN_SILL, "Accent")
    _mouth(mb, -1, OUT_Z, OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL, "Accent")

    # power inlet nub on the +X shoulder, under socket_power_in
    mb.box((0.28, 0.40, 0.44), (1.84, PWR_Y, 2.80), "Steel")
    _stack(mb)

    # RN-552: the form pass. Plating first, then one function per face, because
    # the four faces now differ and a machine whose sides differ is a machine
    # with a front.
    _plating(mb)
    _anchors(mb)
    _front_detail(mb)
    _rear_detail(mb)
    _service_detail(mb)
    _status_detail(mb)
    _roof_detail(mb)

    # Status bezel goes down BEFORE the emissive parts, so OF_EmissiveState is
    # always the LAST material slot on every mesh (the renderer indexes it by
    # position).
    mb.box((0.10, 0.72, 0.40), (1.75, 0.0, STATUS_Z), "Steel")
    mb.box((0.06, 0.56, 0.26), (1.81, 0.0, STATUS_Z), "SteelDark")

    # --- state surfaces: the firebox peep and the +X status chip ---
    # Both stand PROUD of the metal behind them rather than flush with it. The
    # 2 m smelter had its door at exactly the surround's outer plane, which is
    # the same coplanar-paint defect the slot bands were fixed for.
    #
    # THE EMISSIVE AREA IS NOW A TWENTIETH OF WHAT IT WAS, and that is the
    # point of `_front_detail`'s door. A 1.60 x 0.86 lit slab is 1.376 m2 of
    # pure emission in the middle of the face a player stands at: it blows out
    # under any exposure that renders the rest of the machine, it has no form
    # inside it at any distance, and it is why this machine photographed as a
    # television. Fire seen through a peep hole and a sight strip is 0.083 m2,
    # reads hotter for being smaller, and leaves the door itself as iron that
    # the sun can model.
    # THE PEEP SITS ON ITS BOSS, NOT ON THE DOOR, and the first build is why:
    # the boss stands 0.037 proud and the peep 0.006, so a peep on the door's
    # own plane is 31 mm INSIDE the casting that surrounds it and the render
    # showed a dark rectangle where the fire should be. A stack of greebles has
    # to be walked outward one layer at a time; `Face.part` returns the outer
    # coordinate for exactly this reason.
    door_p = FRONT.out(mf.layer("plate"))
    peep = mf.Face("Y", -1, door_p - mf.layer("boss"), limit=-HALF,
                   name="firebox peep")
    peep.part(mb, 0.30, 0.22, 0.0, PEEP_Z, "scribe", "EmissiveState")
    sight = mf.Face("Y", -1, door_p, limit=-HALF, name="firebox sight strip")
    sight.part(mb, 0.86, 0.05, 0.0, DOOR_Z - 0.26, "scribe", "EmissiveState")
    mb.box((0.05, 0.44, 0.18), (1.845, 0.0, STATUS_Z), "EmissiveState")

    # THE DECLARED BOX IS ASSERTED WHERE IT IS CAUSED. contracts.json says
    # 4.00 x 3.60 x 4.00 and validate_glb measures the shipped bytes against
    # it, but by then the geometry is written and the failure is a post-mortem.
    # A greeble that grows the footprint now fails the BUILD, with the axis
    # named and the overshoot in metres.
    mf.assert_inside(mb, HALF, HALF, H, "Smelter_LOD0")
    return mb, mb.build(NAME + "_LOD0", root)


def build_lod1(root):
    """The middle tier, RE-AUTHORED AS A SHADOW PROXY (RN-561).

    IT WAS AUTHORED FOR SCREEN DISTANCE AND WAS NEVER SHADOW-SAFE, and that is
    older than this pass rather than a consequence of it: the pre-raise
    592-triangle smelter's LOD1 already measured 264.8 mm against LOD0.
    Nothing had ever asked a cascade to draw a cruder tier, so the one number
    that decides whether it may had never been taken.

    WHAT THE NUMBER IS. `ShadowLod.ts` measures from LOD0's VERTICES to this
    mesh's SURFACE, so a feature this tier simply does not have reports its
    full stand-off. `tools/blender/check_shadow_lod.py` is that measurement
    offline; it read 325.00 mm here, agreeing with the client's own figure to
    the penny, and named the two causes: the roof JUNCTION BOX (325 mm, over a
    bare pan) and the hopper VIBRATOR (290 mm, over a bare rear face). Neither
    is subtle and neither could have been guessed, because both are features
    whose absence is invisible in a silhouette and total in a shadow.

    THE RULE THIS TIER IS NOW AUTHORED TO. Anything on LOD0 standing more than
    about 56 mm proud of a surface this tier does have must be BLOCKED IN,
    because 56.25 mm is cascade 1's texel and the whole object of the exercise
    is to earn cascade 1 and 2. Below that the cascade cannot resolve it
    anyway. So the greebles are not reproduced, they are boxed: one box per
    feature, at the feature's own envelope. A ladder is a slab the size of its
    stringers, a gauge cluster is a slab the size of its boss, a louvre is a
    slab the size of its coaming.

    WHAT IT BUYS, AND IT IS THE POINT. The marginal cost of one more LOD0
    triangle is `1 + (cascades still drawing tier 0)`. At 325 mm that is 4.0x
    and every LOD0 triangle on every smelter in the base is paid four times.
    Under 56.25 mm cascades 1 and 2 draw THIS mesh instead, the marginal drops
    to 2.0x, and what a machine can afford at LOD0 doubles. That is why this
    is worth more than trimming any LOD0: it is the multiplier, not the term.
    """
    mb = of.MeshBuilder()
    _shell(mb)
    _posts(mb)
    _mouth_block(mb, 1, IN_Z, IN_W, IN_H, IN_JAMB, IN_HEAD, IN_SILL)
    _mouth_block(mb, -1, OUT_Z, OUT_W, OUT_H, OUT_JAMB, OUT_HEAD, OUT_SILL)

    # The roof rim, which LOD0 carries to RIM_TOP and this tier stopped at the
    # pan: a flat 200 mm all the way round the roofline.
    rim_c = DECK * 0.5 - 0.05
    for s in (-1, 1):
        mb.box((DECK + 0.06, RIM_T, RIM_TOP - DECK_TOP),
               (0, s * rim_c, (DECK_TOP + RIM_TOP) * 0.5), "SteelDark")
        mb.box((RIM_T, DECK + 0.06, RIM_TOP - DECK_TOP),
               (s * rim_c, 0, (DECK_TOP + RIM_TOP) * 0.5), "SteelDark")

    # The stack, ROUND rather than square. A square tube of half-width CHIM_R
    # leaves LOD0's own cap vertices 129 mm from anything, because they sit at
    # radius 0.44 on a diagonal where the square is wider and on an axis where
    # it is narrower. An 8-gon against LOD0's 12-gon is 0.44 * (1 - cos 22.5)
    # = 33 mm, comfortably inside cascade 1, for sixteen more triangles.
    mb.cylinder(CHIM_R, (CAP_Z0 + 0.04) - CHIM_Z0,
                (0, CHIM_Y, (CHIM_Z0 + CAP_Z0 + 0.04) * 0.5), axis="Z",
                segments=8, role="Steel")
    mb.cylinder(CHIM_R + 0.10, H - CAP_Z0, (0, CHIM_Y, (CAP_Z0 + H) * 0.5),
                axis="Z", segments=8, role="SteelDark")

    # THE TWO THE MEASUREMENT NAMED, blocked in at their own envelopes.
    mb.box((0.50, 0.58, 0.32), (-1.10, -1.06, DECK_TOP + 0.16), "SteelDark")
    mb.box((0.54, 0.42, 0.42), (-1.06, 1.82, 2.16), "SteelDark")
    # The roof plumbing. A 2.1 m run standing 135 mm over a bare pan is a
    # shadow this tier simply did not cast, and on a roof that is exactly the
    # surface a low sun rakes across.
    mb.box((0.15, 2.20, 0.15), (-1.10, 0.24, 3.00), "SteelDark")

    # The charging hood on +Y, which leans out to 1.966 and is 266 mm of
    # nothing on this tier. One box at its mean stand-off.
    mb.box((2.32, 0.24, 0.52), (0.0, 1.84, 1.60), "SteelDark")
    # The firebox assembly on -Y: coaming plus door plus the peep boss reach
    # about 145 mm proud of the body face.
    mb.box((1.50, 0.16, 1.10), (0.0, -1.78, DOOR_Z), "SteelDark")
    # The launder, which reaches the cell edge and casts the contact shadow a
    # player standing at the pour side is looking straight at.
    mb.box((1.44, 0.30, 0.22), (0.0, -1.87, 0.30), "SteelDark")
    # The painted skirt. This tier never had it, so the anchor pads and their
    # bolts (which top out at 0.441 on the skirt at 0.36) stood 141 mm above
    # a plinth that stops at 0.30. The cheapest 12 triangles in this function
    # and the one that fixes the CONTACT shadow, which is the deviation class
    # ShadowLod.ts calls the most legible of the three.
    mb.box((W, D, SKIRT_H + 0.09), (0, 0, PLINTH_H + (SKIRT_H + 0.09) * 0.5),
           "Accent")
    # -X: the ladder stringers and the louvre coaming. The block is 0.84 wide
    # and not 0.52, because the widest thing on this face is not the ladder,
    # it is the bracketed LANDING at its top, and a block sized to the obvious
    # feature left the landing's own ends 160 mm from anything.
    mb.box((0.22, 0.86, 1.76), (-1.80, -0.96, 1.62), "Steel")
    mb.box((0.16, 1.00, 0.96), (-1.77, 0.86, 1.32), "SteelDark")
    # +X: the gauge cluster boss, the hatch coaming and the power nub.
    mb.box((0.24, 0.40, 0.26), (1.79, -0.92, 1.42), "SteelDark")
    mb.box((0.16, 1.04, 1.14), (1.77, 0.72, 1.46), "SteelDark")
    mb.box((0.28, 0.40, 0.44), (1.84, PWR_Y, 2.80), "Steel")
    # The tie rods' BEARING PLATES reach 1.98, which is 80 mm past the brick
    # post this tier already has. The rod itself is inside the post and needs
    # nothing; the plates do.
    for sx in (-1, 1):
        for sy in (-1, 1):
            for z in (TIE_Z0 + 0.11, TIE_Z1 - 0.11):
                mb.box((0.24, 0.24, 0.18), (sx * TIE_C, sy * TIE_C, z),
                       "SteelDark")

    mb.box((0.05, 0.44, 0.18), (1.845, 0.0, STATUS_Z), "EmissiveState")
    return mb, mb.build(NAME + "_LOD1", root)


def build_lod2(root):
    """Four boxes. The silhouette that has to survive is plinth, body, roof and
    an offset stack, because that offset is the facing cue."""
    mb = of.MeshBuilder()
    mb.box((W, D, PLINTH_H), (0, 0, PLINTH_H * 0.5), "SteelDark")
    mb.box((BODY, BODY, COLLAR_TOP - PLINTH_H),
           (0, 0, (PLINTH_H + COLLAR_TOP) * 0.5), "Steel")
    mb.box((DECK, DECK, RIM_TOP - COLLAR_TOP),
           (0, 0, (COLLAR_TOP + RIM_TOP) * 0.5), "SteelDark")
    mb.box((CHIM_R * 2, CHIM_R * 2, H - RIM_TOP),
           (0, CHIM_Y, (RIM_TOP + H) * 0.5), "Steel")
    return mb, mb.build(NAME + "_LOD2", root)


def build_glow(root):
    """The glow card in front of the firebox PEEP. Built centred on its OWN
    origin so the scale clip pulses it in place instead of sliding it toward
    0,0,0. It is a sibling of _LOD0, so its growth cannot enlarge the LOD0
    bounding box the footprint check reads.

    RN-552 MOVED AND SHRANK IT, AND THE FIRST BUILD OF THE NEW DOOR IS WHY.
    The card was 1.40 x 0.70 standing at y = -1.86, which is 0.14 m PROUD of
    the new door's own outer plane: it drew a white slab straight over the
    coaming, the hinges, the dog latch and the bolt run, and the studio render
    of the pass showed the same television the pass existed to delete, with the
    door visible only as a rim around it. The card is not part of _LOD0, so
    nothing in the geometry gate could have caught that; only the picture
    could, which is the argument for taking the picture."""
    mb = of.MeshBuilder()
    mb.box((0.34, 0.02, 0.26), (0, 0, 0), "EmissiveState")
    obj = mb.build("Smelter_Glow", root)
    # Just outside the peep's own front plane (the door plate at `plate`, plus
    # the peep at `scribe`), DERIVED rather than typed, so a change to either
    # layer moves the card with them instead of stranding it inside the door.
    obj.location = (0.0, -(BODY_HALF + mf.layer("plate") + mf.layer("boss")
                           + mf.layer("scribe") + 0.012), PEEP_Z)
    return mb, obj


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_lod0(root)
    mb1, _ = build_lod1(root)
    mb2, _ = build_lod2(root)
    mbg, glow = build_glow(root)

    of.add_collision_box("col_" + NAME, (W, D, H), (0, 0, H * 0.5), root)

    of.add_socket("socket_item_in", (0.0, HALF, IN_Z), parent=root,
                  extras={"of_role": "item_in"})
    of.add_socket("socket_item_out", (0.0, -HALF, OUT_Z), parent=root,
                  extras={"of_role": "item_out"})
    of.add_socket("socket_power_in", (PWR_X, PWR_Y, PWR_Z), parent=root,
                  extras={"of_role": "power_in"})
    of.add_socket("socket_smoke", (0.0, CHIM_Y, H), parent=root,
                  extras={"of_role": "smoke"})
    of.add_socket("socket_status", (HALF, 0.0, STATUS_Z), parent=root,
                  extras={"of_role": "state_light"})

    # Furnace_Glow: 60 frames == SmeltFerrite.timeTicks.
    # Preferred at runtime: drive emissiveIntensity from AnimPhase and drop the
    # clip entirely. It ships so the asset is complete without shader work.
    of.add_clip(glow, "Furnace_Glow", "scale",
                [(1, (1.0, 1.0, 1.0)), (31, (1.08, 1.0, 1.08)),
                 (61, (1.0, 1.0, 1.0))])

    of.report(NAME, [("LOD0", mb0), ("LOD1", mb1), ("LOD2", mb2),
                     ("Smelter_Glow", mbg)])
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
