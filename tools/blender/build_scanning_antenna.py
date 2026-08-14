"""
build_scanning_antenna.py - THE SCANNING ANTENNA. GP-533 minted TypeId 0x46,
priced it, gated it behind its own tech and wired the reveal, and then drew it
as `power_pole.glb`.

    ~/.local/bin/blender501 --background --python tools/blender/build_scanning_antenna.py

Produces assets/models/dist/structures/scanning_antenna.glb.

--------------------------------------------------------------------------
WHAT IT HAS TO SAY, IN ONE LINE, FROM A HUNDRED METRES
--------------------------------------------------------------------------
GP-536: building this reveals every POI within 2,500 m. The player's mental
model of the thing is therefore "the machine that looked around", and the two
shapes that say that without a caption are A DISH and A GUYED MAST. Both are
here and both are authored rather than implied:

    a 2.10 m panelled paraboloid on an elevation trunnion, feed horn on a
    quadripod at the focus, ribbed behind, aimed 45 degrees up and pointed at
    whoever built it;
    a four-chord lattice tower with real diagonals, standing on a plinth and
    held by four guys to four ground anchors.

A LATTICE IS THE WHOLE ARGUMENT FOR READING AGAINST THE SKY. A tube is a
silhouette; a lattice is a silhouette with sky through it, and the diagonals
change with bearing as the player walks round it. `machine_form.railing` makes
the identical point about a roofline for the identical reason, and
`station_form.truss_bay`'s docstring makes it about a boom: four parallel
chords are a box and four chords with braces are a structure.

WHY NOT `station_form.antenna`. It exists, and it is a MAST BOX plus a fan of
eight one-sided triangles round a cone, sized for a 400 km silhouette on a hull
the player flies past. It has no rim, no thickness, no ribs, no feed, no
mount, and it renders as a hole in the world from behind because a single fan
of triangles is one-sided and `SteelLight` is not in `of_lib.DOUBLE_SIDED`.
That is the correct asset for the station's boom and it is not this.

--------------------------------------------------------------------------
THE FOUR ANCHORS OWN THE BOUNDING BOX, AND THAT IS WHY THEY ARE FOUR
--------------------------------------------------------------------------
`validate_glb.py`'s `ground` pivot wants the LOD0 AABB centred on x and z;
ART-DIRECTION.md wants asymmetry. build_ruin.py settles that by deciding which
element owns the box and build_research_station.py gives it to the skid. Here
it goes to the guy anchors, and the reason is better than either: FOUR
IDENTICAL ANCHORS AT FOUR CORNERS IS WHAT A GUYED MAST IS. Symmetry in the
anchors is not a compromise with the validator, it is the engineering, and it
buys the whole rest of the asset the freedom to be lopsided - the equipment
cabinet is on one side only, the cable climbs one face only, the ladder rungs
are on one face only, and the dish hangs entirely into the -Y half.

    FOOT   3.00 m   three placement tiles; the anchor blocks are 0.44 square
                    at (+-1.28, +-1.28), so their outer faces land on +-1.50
                    exactly and nothing else may pass KEEP = 1.42.
    HEIGHT 6.00 m   DERIVED, not chosen. The top of the asset is the dish's
                    upper rim, so TRUNNION_Z is solved backwards from it:
                    HEIGHT - (DISH_R + rim/2 + depth) * sin(EL_DEG).

--------------------------------------------------------------------------
THE PICK SPHERE DOES NOT REACH THE HEAD, AND THAT IS REPORTED, NOT HIDDEN
--------------------------------------------------------------------------
`Antennas.pick` is `ResearchStations.pick` verbatim: a sphere of radius 1.40
sitting 0.70 m above the pivot, with 0.50 m of slack, so it refuses any ray
whose perpendicular distance from (0, 0, 0.70) exceeds 1.90 m. On a bench that
is a constraint the geometry can satisfy outright, and build_research_station.py
asserts it vertex by vertex. ON A SIX METRE MAST IT CANNOT BE SATISFIED AND
PRETENDING OTHERWISE WOULD MEAN BUILDING A 2.6 M ANTENNA.

So this file asserts the half of it that is real - everything below `PICK_Z`,
which is the plinth, the cabinet, the anchors and the lower tower, is inside
the sphere - and PRINTS the height above which selection stops. In play the
crosshair is 1.6 m up and level, so it meets the tower at about z = 1.6 and
picks normally; what does not work is aiming at the dish. The borrowed
`power_pole.glb` had exactly the same property at 4.0 m and nobody had measured
it. Widening `ANTENNA_RADIUS_M` is a gameplay change and belongs to that lane,
so it is named in the report rather than taken here.

--------------------------------------------------------------------------
THE LADDER
--------------------------------------------------------------------------
    LOD0   min_layer 0.0,  dish 16 sectors
    LOD1   min_layer `clip` 0.061, dish 16 sectors. Drops every greeble at or
           under `hinge` (0.052), so the predicted worst deviation is 52 mm
           and cascades 1 and 2 may draw it.
    LOD2   min_layer `bracket` 0.232, dish 8 sectors, tower diagonals halved,
           guys without turnbuckles, quadripod down to two struts. An 8-gon
           dish sits r(1 - cos(180/8)) = 80 mm inside a 16-gon one, so this
           tier CANNOT be shadow-safe and is a screen-distance tier, stated
           rather than discovered - build_ruin.py's own correction to
           build_space_station.py, applied in advance.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
import machine_form as mf  # noqa: E402
import station_form as sf  # noqa: E402

NAME = "ScanningAntenna"
OUT = of.dist_path("structures", "scanning_antenna.glb")

# ---------------------------------------------------------------------------
# THE ENVELOPE
# ---------------------------------------------------------------------------
TILE = 1.00                 # MachinePlacement.MACHINE_TILE_M
FOOT = 3.00                 # three tiles
HALF = FOOT * 0.5
KEEP = HALF - 0.08          # nothing but the anchors may reach HALF
PICK_R = 1.40               # Antennas.ANTENNA_RADIUS_M
PICK_UP = 0.70              # Antennas.ANTENNA_CENTRE_UP_M
PICK_MAX = PICK_R + 0.50    # the `+ 0.5` in Antennas.pick
EYE_Z = 1.60                # the eye height ResearchStations.pick names

assert abs(FOOT / TILE - round(FOOT / TILE)) < 1e-9

ANCHOR = 0.44               # anchor block, square in plan
ANCHOR_AT = HALF - ANCHOR * 0.5     # 1.28: outer faces land exactly on HALF
ANCHOR_H = 0.26

PLINTH = 0.94               # the central plinth, square
PLINTH_Z = 0.34
CURB = 1.24                 # the kerb ring around the plinth, outside it

# The tower. Four chords, tapering, on `BAYS` bays of diagonals.
TOWER_Z0 = PLINTH_Z
TOWER_Z1 = 4.30
TOWER_H0 = 0.29             # half the chord spacing at the foot
TOWER_H1 = 0.155            # and at the head
BAYS = 4
COLLAR_Z = 2.90             # the guy collar

# The head.
ROT_Z = TOWER_Z1 + 0.19     # azimuth rotator centre
DISH_R = 1.05               # 2.10 m across
EL_DEG = 45.0               # elevation: high enough to read as pointed at sky
F_OVER_D = 0.40             # a normal prime-focus dish
FOCAL = F_OVER_D * DISH_R * 2.0
SKIN_T = 0.055              # the reflector shell's thickness
DEPTH = DISH_R * DISH_R / (4.0 * FOCAL)
HEIGHT = 6.00
# SOLVED BACKWARDS FROM HEIGHT. The topmost point of the asset is the reflector
# rim at the top of the bowl, whose height above the vertex is
# (DISH_R + DEPTH) * sin(EL): the radius carries it up the tilt and the
# paraboloid's own depth carries it further along the same boresight. Both LOD
# sector counts (16 and 8) put a vertex at exactly theta = 90 degrees, so all
# three tiers share one bounding box, which is what lets contracts.json state a
# single dims_xyz_m for the file and for every part in it.
TRUNNION_Z = HEIGHT - (DISH_R + DEPTH) * math.sin(math.radians(EL_DEG))
DISH_Y = 0.10               # the vertex sits just behind the tower centreline
assert TRUNNION_Z > ROT_Z + 0.30, (
    "the trunnion lands at %.4f and the rotator top is %.4f, so the yoke has "
    "nowhere to be" % (TRUNNION_Z, ROT_Z))

# The equipment cabinet on the plinth, on ONE side.
CAB_X0, CAB_X1 = -1.16, -0.52
CAB_Y0, CAB_Y1 = -0.34, 0.34
CAB_Z0, CAB_Z1 = 0.18, 1.12

# ---------------------------------------------------------------------------
# THE TIERS
# ---------------------------------------------------------------------------
LOD1_MIN = mf.LAYER["clip"]
LOD2_MIN = mf.LAYER["bracket"]
SECTORS_FINE = 16
SECTORS_COARSE = 8

# ---------------------------------------------------------------------------
# THE EIGHT ROLES, all already in of_lib.PALETTE and in all three tables
# check-roles.mjs compares, so this build opens no shared file.
# ---------------------------------------------------------------------------
BODY = "Steel"
FRAME = "SteelDark"
BRIGHT = "SteelLight"
FASCIA = "Accent"
HAZ = "Hazard"
CABLE = "Rubber"
BRASS = "Copper"        # the waveguide and the earth bonding, the two places a
#                         real installation is not painted steel
GLOW = "EmissiveState"


def _face(axis, sign, plane, tier, name):
    """A tier-filtered `Panel` on a real face, always with a `limit`."""
    if axis == "Z":
        limit = HEIGHT if sign > 0 else 0.0
    else:
        limit = KEEP if sign > 0 else -KEEP
    return sf.Panel(axis, sign, plane, limit=limit, name=name, min_layer=tier)


def _strut(mb, a, b, w, role):
    """One member between two world points, as an oriented box.

    Everything diagonal in this file - a chord, a brace, a guy, a quadripod leg
    - is this call, because `station_form.oriented_box` is twelve triangles at
    any angle and a rotation through bpy is not reproducible."""
    d = [b[k] - a[k] for k in range(3)]
    ln = math.sqrt(sum(v * v for v in d))
    if ln < 1e-9:
        return
    ax = tuple(v / ln for v in d)
    tmp = (0.0, 0.0, 1.0) if abs(ax[2]) < 0.9 else (1.0, 0.0, 0.0)
    u = (ax[1] * tmp[2] - ax[2] * tmp[1], ax[2] * tmp[0] - ax[0] * tmp[2],
         ax[0] * tmp[1] - ax[1] * tmp[0])
    un = math.sqrt(sum(v * v for v in u))
    u = tuple(v / un for v in u)
    v = (ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2],
         ax[0] * u[1] - ax[1] * u[0])
    sf.oriented_box(mb, tuple((a[k] + b[k]) * 0.5 for k in range(3)),
                    ax, u, v, (ln, w, w), role)


# ---------------------------------------------------------------------------
# 1. THE GROUND WORKS. Four anchors, a plinth, a kerb.
# ---------------------------------------------------------------------------

CORNERS = ((-1, -1), (1, -1), (1, 1), (-1, 1))


def groundworks(mb, tier):
    for i, (sx, sy) in enumerate(CORNERS):
        ax, ay = sx * ANCHOR_AT, sy * ANCHOR_AT
        # THE BLOCK IS THE ONE THING ALLOWED TO REACH HALF, and all four are
        # identical, which is what makes the AABB centred without a single
        # mirrored detail anywhere else on the asset.
        # TWO BOXES, AND THE YELLOW ONE IS STRUCTURE. The first draft painted
        # the outboard faces with `scribe` stripes and they stood 6 mm proud of
        # the footprint, so the AABB measured 3.006 - and worse, `scribe` is
        # below LOD1's threshold, so the tiers would have measured DIFFERENT
        # bounding boxes. A capping course in Hazard is a real part of a real
        # anchor block, it is emitted at every tier, and it lands exactly on
        # HALF like the body under it.
        mb.box((ANCHOR, ANCHOR, ANCHOR_H - 0.05), (ax, ay,
                                                   (ANCHOR_H - 0.05) * 0.5),
               FRAME)
        mb.box((ANCHOR, ANCHOR, 0.05), (ax, ay, ANCHOR_H - 0.025), HAZ)
        top = _face("Z", 1, ANCHOR_H, tier, "anchor %d" % i)
        # The eye the guy shackles to: a boss, a lug and a pin, canted inboard
        # so the lug lines up with the guy rather than with the block.
        top.part(mb, 0.20, 0.20, ax, ay, "boss", BRIGHT)
        top.part(mb, 0.07, 0.07, ax, ay, "duct", BRIGHT)
        # 0.11 and not 0.15: an anchor's holding-down bolts sit on the block
        # and the block's own outer face IS the footprint edge, so a bolt head
        # 0.055 wide at 0.15 reached 1.4575 and pushed a TIER-FILTERED part
        # past KEEP - which would have given LOD0 and LOD1 different bounding
        # boxes, not merely a wide one.
        mf.bolts(mb, top, (ax - 0.11, ax + 0.11), (ay - 0.11, ay + 0.11),
                 0.05, BRIGHT)
    # The plinth and the kerb that stops soil washing against it.
    mb.box((PLINTH, PLINTH, PLINTH_Z), (0.0, 0.0, PLINTH_Z * 0.5), FRAME)
    for (sx, sy, dx, dy) in ((0, 1, CURB, 0.10), (0, -1, CURB, 0.10),
                             (1, 0, 0.10, CURB - 0.20),
                             (-1, 0, 0.10, CURB - 0.20)):
        mb.box((dx, dy, 0.14), (sx * (CURB * 0.5 - 0.05),
                                sy * (CURB * 0.5 - 0.05), 0.07), FRAME)
    top = _face("Z", 1, PLINTH_Z, tier, "plinth top")
    # A drain channel and a bonding stud: two small things that say the ground
    # under a mast was actually prepared.
    top.part(mb, 0.55, 0.07, 0.10, -PLINTH * 0.5 + 0.10, "scribe", CABLE)
    # THE BONDING STUD CLEARS THE TOWER'S OWN FOOT PADS. Both are `boss` parts
    # on the plinth top - one in Copper, one in SteelDark - and the foot pads
    # span +-0.19 to +-0.39 in both axes, so a stud at (0.34, 0.34) put two
    # roles on one plane. On the centreline in x it clears all four.
    top.part(mb, 0.08, 0.08, 0.0, 0.40, "boss", BRASS)
    top.part(mb, 0.045, 0.045, 0.0, 0.40, "clip", BRASS)
    return mb


# ---------------------------------------------------------------------------
# 2. THE TOWER. Four chords, ties, diagonals, a guy collar, climbing rungs.
# ---------------------------------------------------------------------------

def _tower_half(z):
    """Half the chord spacing at height `z`: a linear taper."""
    t = (z - TOWER_Z0) / (TOWER_Z1 - TOWER_Z0)
    return TOWER_H0 + (TOWER_H1 - TOWER_H0) * min(max(t, 0.0), 1.0)


def tower(mb, tier, screen=False):
    # Four continuous chords, foot to head. Continuous rather than per bay,
    # because a chord spliced at every tie is four times the triangles for a
    # joint nobody can see from outside the member.
    for (sx, sy) in CORNERS:
        _strut(mb, (sx * TOWER_H0, sy * TOWER_H0, TOWER_Z0),
               (sx * TOWER_H1, sy * TOWER_H1, TOWER_Z1), 0.075, FRAME)
    levels = [TOWER_Z0 + (TOWER_Z1 - TOWER_Z0) * i / BAYS
              for i in range(BAYS + 1)]
    for z in levels:
        h = _tower_half(z)
        for (sx, sy) in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            a = (sx * h - (0 if sx else h), sy * h - (0 if sy else h), z)
            b = (sx * h + (0 if sx else h), sy * h + (0 if sy else h), z)
            _strut(mb, a, b, 0.05, FRAME)
    # DIAGONALS: one per face per bay, direction alternating up the tower, so
    # the braces zig-zag the way an N-braced mast does instead of forming four
    # parallel lines that read as a printed pattern.
    for i in range(BAYS):
        if screen and i % 2:
            continue
        z0, z1 = levels[i], levels[i + 1]
        h0, h1 = _tower_half(z0), _tower_half(z1)
        flip = i % 2 == 0
        for (sx, sy) in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            def cor(h, s):
                return (sx * h + (0 if sx else s * h),
                        sy * h + (0 if sy else s * h))
            a = cor(h0, -1 if flip else 1) + (z0,)
            b = cor(h1, 1 if flip else -1) + (z1,)
            _strut(mb, a, b, 0.038, FRAME)

    # The foot: a base plate, gussets and holding-down bolts on the plinth.
    plinth_top = _face("Z", 1, PLINTH_Z, tier, "tower foot")
    for (sx, sy) in CORNERS:
        plinth_top.part(mb, 0.20, 0.20, sx * TOWER_H0, sy * TOWER_H0, "boss",
                        FRAME)
        plinth_top.part(mb, 0.06, 0.06, sx * TOWER_H0, sy * TOWER_H0, "bolt",
                        BRIGHT)

    # The guy collar: a square of four members with a lug at each corner.
    ch = _tower_half(COLLAR_Z)
    for (sx, sy) in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        a = (sx * (ch + 0.04) - (0 if sx else ch + 0.04),
             sy * (ch + 0.04) - (0 if sy else ch + 0.04), COLLAR_Z)
        b = (sx * (ch + 0.04) + (0 if sx else ch + 0.04),
             sy * (ch + 0.04) + (0 if sy else ch + 0.04), COLLAR_Z)
        _strut(mb, a, b, 0.07, BRIGHT)
    for (sx, sy) in CORNERS:
        mb.box((0.09, 0.09, 0.13), (sx * (ch + 0.05), sy * (ch + 0.05),
                                    COLLAR_Z), BRIGHT)

    # Climbing rungs on ONE face, and a fall-arrest rail beside them. This is
    # machine_form.ladder's argument at mast scale: it is the only greeble
    # whose size a player already knows, and it says 6 m louder than 6 m does.
    n = int((TOWER_Z1 - TOWER_Z0 - 0.5) / 0.32)
    for i in range(n):
        z = TOWER_Z0 + 0.42 + 0.32 * i
        h = _tower_half(z)
        f = _face("Y", -1, -h, tier, "tower rungs")
        f.part(mb, 2.0 * h - 0.06, 0.05, 0.0, z, "rung", BRIGHT)
    _strut(mb, (0.0, -_tower_half(TOWER_Z0) - 0.05, TOWER_Z0 + 0.30),
           (0.0, -_tower_half(TOWER_Z1) - 0.05, TOWER_Z1 - 0.10), 0.035,
           BRIGHT)

    # The feeder: a conduit clipped up ONE chord line, from the cabinet to the
    # head, which is the single longest continuous line on the object and the
    # thing that ties the two halves of the asset together visually.
    pts = [(TOWER_H0 * 0.9, TOWER_H0 * 0.9, TOWER_Z0 + 0.18)]
    for i in range(1, BAYS + 1):
        z = levels[i]
        h = _tower_half(z) * 0.9
        pts.append((h, h, z))
    for a, b in zip(pts, pts[1:]):
        _strut(mb, a, b, 0.055, CABLE)
    for z in levels[:-1]:
        h = _tower_half(z) * 0.9
        f = _face("X", 1, h + 0.03, tier, "feeder clip")
        f.part(mb, 0.07, 0.06, h, z + 0.06, "clip", BRIGHT)
    return mb


def guys(mb, tier, screen=False):
    """Four guys, collar to anchor, each with a turnbuckle near its foot.

    The turnbuckle is the detail that turns a line into a rigged line: it is
    the one part of a guy that has a diameter, and it sits low where a player
    walks past it."""
    ch = _tower_half(COLLAR_Z) + 0.05
    for (sx, sy) in CORNERS:
        top = (sx * ch, sy * ch, COLLAR_Z)
        foot = (sx * ANCHOR_AT, sy * ANCHOR_AT, ANCHOR_H + 0.14)
        _strut(mb, top, foot, 0.028, BRIGHT)
        if screen:
            continue
        t = 0.16
        a = tuple(foot[k] + (top[k] - foot[k]) * t for k in range(3))
        b = tuple(foot[k] + (top[k] - foot[k]) * (t + 0.11) for k in range(3))
        _strut(mb, a, b, 0.062, FRAME)
    return mb


# ---------------------------------------------------------------------------
# 3. THE HEAD AND THE DISH.
# ---------------------------------------------------------------------------

def _dish_frame():
    """(vertex, n, e1, e2): the paraboloid's own orthonormal frame.

    `n` is the boresight, so the dish is aimed at -Y and EL_DEG up, i.e. AT
    the player who placed it and over their head. Facing +Y would show them
    the back of it for ever, and a dish's back is the least legible thing on
    the asset."""
    a = math.radians(EL_DEG)
    n = (0.0, -math.cos(a), math.sin(a))
    e1 = (1.0, 0.0, 0.0)
    e2 = (n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2],
          n[0] * e1[1] - n[1] * e1[0])
    return (0.0, DISH_Y, TRUNNION_Z), n, e1, e2


def _surface(v, n, e1, e2, r, th):
    """A point on the reflector at polar (r, th), depth from the parabola."""
    d = r * r / (4.0 * FOCAL)
    c, s = math.cos(th), math.sin(th)
    return tuple(v[k] + (e1[k] * c + e2[k] * s) * r + n[k] * d
                 for k in range(3))


def dish(mb, tier, sectors):
    """A CLOSED panelled reflector: front skin, back skin, outer rim, inner rim.

    ONE closed solid rather than a fan of triangles, and the reason is the
    reason `station_form.hull_tube` exists: every role this asset uses is
    backface culled, so a one-sided surface is a hole in the world from the
    other side. A dish is seen from behind roughly half the time a player walks
    round it, so the back is not optional.

    `mf.oriented` decides the winding off the SIGNED VOLUME rather than off an
    author getting six axis-and-sign cases right, which is the whole point of
    that function."""
    v, n, e1, e2 = _dish_frame()
    radii = (0.16, 0.46, 0.76, DISH_R)
    verts, faces = [], []

    def idx(ring, i, back):
        return (back * len(radii) + ring) * sectors + (i % sectors)

    for back in (0, 1):
        for r in radii:
            for i in range(sectors):
                th = 2.0 * math.pi * i / sectors
                p = _surface(v, n, e1, e2, r, th)
                if back:
                    p = tuple(p[k] - n[k] * SKIN_T for k in range(3))
                verts.append(p)
    for k in range(len(radii) - 1):
        for i in range(sectors):
            faces.append((idx(k, i, 0), idx(k, i + 1, 0),
                          idx(k + 1, i + 1, 0), idx(k + 1, i, 0)))
            faces.append((idx(k, i, 1), idx(k, i + 1, 1),
                          idx(k + 1, i + 1, 1), idx(k + 1, i, 1)))
    for (ring, ) in ((0, ), (len(radii) - 1, )):
        for i in range(sectors):
            faces.append((idx(ring, i, 0), idx(ring, i + 1, 0),
                          idx(ring, i + 1, 1), idx(ring, i, 1)))
    verts, faces = mf.oriented(verts, faces)
    mb.add_raw(verts, faces, [False] * len(faces), BRIGHT)

    # THE PANEL STRAPS. A 2.10 m reflector is not one pressing: it is petals
    # bolted to radial ribs, and the straps are what stop the front reading as
    # a smooth bowl. Each is ONE box on the chord from the inner ring to the
    # rim and 0.14 m through, which buries it at mid-span (the chord runs about
    # 60 mm proud of the true surface there) and leaves it standing 70 mm proud
    # at both ends. Eight of them, at 12 triangles each.
    for i in range(8):
        th = 2.0 * math.pi * (i + 0.5) / 8.0
        a = _surface(v, n, e1, e2, radii[0], th)
        b = _surface(v, n, e1, e2, DISH_R - 0.02, th)
        _strut(mb, a, b, 0.055, FRAME)
    # Four heavier ribs BEHIND, which is what carries the thing, and the only
    # part of the reflector visible when it is pointed away from you.
    for i in range(4):
        th = 2.0 * math.pi * i / 4.0 + math.pi / 4.0
        a = tuple(_surface(v, n, e1, e2, radii[0], th)[k] - n[k] * 0.10
                  for k in range(3))
        b = tuple(_surface(v, n, e1, e2, DISH_R - 0.05, th)[k] - n[k] * 0.10
                  for k in range(3))
        _strut(mb, a, b, 0.085, FRAME)

    # The hub casting, on the boresight, spanning the inner rim.
    hub = tuple(v[k] - n[k] * 0.10 for k in range(3))
    _strut(mb, hub, tuple(v[k] + n[k] * 0.06 for k in range(3)), 0.30, FRAME)

    # THE QUADRIPOD AND THE FEED. A dish with nothing at its focus is a bowl.
    focus = tuple(v[k] + n[k] * FOCAL for k in range(3))
    legs = 2 if tier >= LOD2_MIN else 4
    for i in range(legs):
        th = 2.0 * math.pi * i / legs + math.pi / 4.0
        _strut(mb, _surface(v, n, e1, e2, DISH_R - 0.06, th), focus, 0.042,
               BRIGHT)
    _strut(mb, tuple(focus[k] - n[k] * 0.16 for k in range(3)),
           tuple(focus[k] + n[k] * 0.10 for k in range(3)), 0.15, BRASS)
    _strut(mb, tuple(focus[k] - n[k] * 0.30 for k in range(3)),
           tuple(focus[k] - n[k] * 0.14 for k in range(3)), 0.09, FRAME)
    return mb


def head(mb, tier):
    """The rotator, the yoke and the elevation screw jack.

    THE JACK IS THE PART THAT SAYS IT MOVES. A dish rigidly welded to a mast is
    a reflector; a dish on a trunnion with a screw jack under one rib is a dish
    somebody points, and it costs two boxes."""
    v, n, e1, e2 = _dish_frame()
    # Azimuth rotator: a finned drum on the tower head, so the head has three
    # diameters over 0.5 m rather than one.
    mb.box((0.34, 0.34, 0.10), (0.0, 0.0, TOWER_Z1 + 0.05), FRAME)
    mf.finned_drum(mb, 0.185, 0.30, (0.0, 0.0, ROT_Z), "Z", 3, FRAME, BRIGHT,
                   segments=8, fin_span=1.7)
    ring = _face("Z", 1, ROT_Z + 0.15, tier, "rotator top")
    mf.bolts(mb, ring, (-0.13, 0.13), (-0.13, 0.13), 0.05, BRIGHT)

    # The yoke: two arms up to the trunnion, and they are NOT the same length,
    # because the trunnion is offset in +Y from the mast centreline.
    for s in (-1, 1):
        _strut(mb, (s * 0.17, 0.0, ROT_Z + 0.12),
               (s * 0.17, DISH_Y, TRUNNION_Z), 0.09, FRAME)
        mb.box((0.10, 0.16, 0.16), (s * 0.17, DISH_Y, TRUNNION_Z), BRIGHT)
    # The elevation jack: from the yoke's foot to a point on the dish's back,
    # below the trunnion, which is where a real one goes.
    back = tuple(v[k] - n[k] * 0.12 + e2[k] * -0.55 for k in range(3))
    _strut(mb, (0.34, 0.02, ROT_Z + 0.10), back, 0.055, BRIGHT)
    _strut(mb, (0.34, 0.04, ROT_Z + 0.16),
           tuple((0.34 + back[0]) * 0.5 for _ in (0,))
           + ((0.04 + back[1]) * 0.5, (ROT_Z + 0.16 + back[2]) * 0.5), 0.085,
           FRAME)
    # The obstruction light, on the +Y side of the yoke where the dish does not
    # hide it, and the only emissive on the whole asset above head height.
    mb.box((0.07, 0.07, 0.16), (0.0, 0.20, ROT_Z + 0.24), FRAME)
    mb.cylinder(0.055, 0.07, (0.0, 0.20, ROT_Z + 0.35), axis="Z", segments=8,
                role=GLOW, smooth_sides=False)
    # The waveguide: a run from the rotator up the yoke toward the feed. It
    # stops at the trunnion on purpose - a real one goes through the bearing.
    _strut(mb, (0.10, 0.02, ROT_Z + 0.14), (0.10, DISH_Y - 0.02,
                                            TRUNNION_Z - 0.05), 0.06, BRASS)
    return mb


# ---------------------------------------------------------------------------
# 4. THE EQUIPMENT CABINET. One side only, and it is where the cable lands.
# ---------------------------------------------------------------------------

def cabinet(mb, tier):
    cx, cy = (CAB_X0 + CAB_X1) * 0.5, (CAB_Y0 + CAB_Y1) * 0.5
    w, d = CAB_X1 - CAB_X0, CAB_Y1 - CAB_Y0
    h = CAB_Z1 - CAB_Z0
    mb.box((w, d, h), (cx, cy, CAB_Z0 + h * 0.5), BODY)
    # Legs, because a cabinet in the field stands off the ground.
    for (sx, sy) in CORNERS:
        mb.box((0.07, 0.07, CAB_Z0), (cx + sx * (w * 0.5 - 0.06),
                                      cy + sy * (d * 0.5 - 0.06),
                                      CAB_Z0 * 0.5), FRAME)
    front = _face("Y", -1, CAB_Y0, tier, "cab front")
    back = _face("Y", 1, CAB_Y1, tier, "cab back")
    outer = _face("X", -1, CAB_X0, tier, "cab outer")
    inner = _face("X", 1, CAB_X1, tier, "cab inner")
    top = _face("Z", 1, CAB_Z1, tier, "cab top")

    mf.hatch(mb, front, cx, CAB_Z0 + 0.52, w - 0.14, 0.60, BODY, BRIGHT,
             FASCIA, hinge_side=-1)
    mf.louvre(mb, back, cx, CAB_Z0 + 0.56, w - 0.20, 0.34, 4, FRAME, BRIGHT,
              role_back=CABLE)
    # THE DIALS GO ON THE OUTBOARD END AND NOT ON THE DOOR. `mf.hatch` mounts
    # its mark plate on the `boss` layer in role_mark and `mf.gauge_cluster`
    # mounts its own body on the same layer in role_body, so two of them on one
    # face at overlapping heights is two roles on one plane - five same-facing
    # pairs, measured. The -X end has 0.68 m of clear width and nothing else on
    # it, which is where an instrument panel belongs anyway.
    mf.gauge_cluster(mb, outer, cy, CAB_Z0 + 0.62, 2, FRAME, BRIGHT)
    front.part(mb, 0.06, 0.06, cx - 0.20, CAB_Z1 - 0.12, "tray", FRAME)
    front.part(mb, 0.04, 0.04, cx - 0.20, CAB_Z1 - 0.12, "grille", GLOW)
    mf.placard(mb, inner, cy + 0.14, CAB_Z0 + 0.86, 0.16, 0.11, FASCIA)
    mf.kick_plate(mb, front, CAB_X0 + 0.04, CAB_X1 - 0.04, CAB_Z0 + 0.14, 0.12,
                  FRAME, dent=0.45, dent_at=-1)
    # A rain hood over the door, sloping one way.
    mf.eave(mb, front, CAB_X0 + 0.02, CAB_X1 - 0.02, CAB_Z1 - 0.07, 0.14, 2,
            FRAME, FRAME, thickness=0.07, drop=0.16)
    top.part(mb, w - 0.12, d - 0.12, cx, cy, "shim", FRAME)
    # The gland plate on the INNER face, and the feeder coming down to it: the
    # cable that climbed the tower has to land somewhere and this is where.
    mf.junction(mb, inner, cy - 0.10, CAB_Z0 + 0.62, 0.20, 0.26, FRAME, BODY)
    mf.pipe_run(mb, [(TOWER_H0 * 0.9, TOWER_H0 * 0.9, PLINTH_Z + 0.18),
                     (TOWER_H0 * 0.9, cy - 0.10, PLINTH_Z + 0.18),
                     (CAB_X1 + 0.30, cy - 0.10, PLINTH_Z + 0.18),
                     (CAB_X1 + 0.30, cy - 0.10, CAB_Z0 + 0.62)],
                0.055, CABLE, elbow_role=FRAME)
    # Bonding braid from the cabinet to the plinth stud, in Copper.
    mf.pipe_run(mb, [(CAB_X1 + 0.06, CAB_Y1 - 0.06, CAB_Z0 + 0.10),
                     (CAB_X1 + 0.06, 0.40, CAB_Z0 + 0.10),
                     (0.0, 0.40, PLINTH_Z + 0.08)], 0.03, BRASS,
                elbow_role=BRASS)
    # A stain under the louvre, on `stain` and `grime` - the two rows
    # machine_form.LAYER gained for exactly this, because two marks on one
    # layer in two roles is a coplanar pair by construction and `scribe`
    # already belongs to the louvre's own backing sheet.
    back.part(mb, 0.30, 0.16, cx, CAB_Z0 + 0.20, "stain", FRAME)
    back.part(mb, 0.16, 0.09, cx + 0.10, CAB_Z0 + 0.13, "grime", CABLE)
    return mb


# ---------------------------------------------------------------------------
# Collision, sockets, tiers
# ---------------------------------------------------------------------------

def build_collision(root):
    names = []
    boxes = [("col_Plinth", (CURB, CURB, PLINTH_Z), (0.0, 0.0, PLINTH_Z * 0.5)),
             ("col_Mast", (2.0 * TOWER_H0 + 0.10, 2.0 * TOWER_H0 + 0.10,
                           TOWER_Z1 - PLINTH_Z),
              (0.0, 0.0, (PLINTH_Z + TOWER_Z1) * 0.5)),
             ("col_Cabinet", (CAB_X1 - CAB_X0 + 0.06, CAB_Y1 - CAB_Y0 + 0.06,
                              CAB_Z1),
              ((CAB_X0 + CAB_X1) * 0.5, (CAB_Y0 + CAB_Y1) * 0.5,
               CAB_Z1 * 0.5))]
    for i, (sx, sy) in enumerate(CORNERS):
        boxes.append(("col_Anchor%d" % (i + 1), (ANCHOR, ANCHOR, ANCHOR_H),
                      (sx * ANCHOR_AT, sy * ANCHOR_AT, ANCHOR_H * 0.5)))
    for (name, size, loc) in boxes:
        of.add_collision_box(name, size, loc, root, role=FRAME)
        names.append(name)
    return names


def build_sockets(root):
    """`socket_scan` is the boresight at the feed, which is the one frame a
    scan effect, a beam or a reveal animation would ever want; `socket_status`
    is the cabinet lamp, matching every machine that has one."""
    v, n, _e1, _e2 = _dish_frame()
    focus = tuple(v[k] + n[k] * FOCAL for k in range(3))
    # Face along the boresight: EL_DEG up from -Y, which is `rot x` of
    # -(90 - EL) about the Blender X axis (an unrotated socket faces -Y).
    of.add_socket("socket_scan", focus, rot=of.deg3(x=-(90.0 - EL_DEG)),
                  parent=root, extras={"of_role": "scan"})
    of.add_socket("socket_status", ((CAB_X0 + CAB_X1) * 0.5 - 0.20,
                                    CAB_Y0 - 0.10, CAB_Z1 - 0.12),
                  parent=root, extras={"of_role": "state_light"})


def build_form(root, tier, suffix, screen=False, breakdown=False):
    mb = of.MeshBuilder()
    prev, rows = 0, []

    def stage(label, fn):
        fn()
        nonlocal prev
        rows.append((label, mb.tri_count() - prev))
        prev = mb.tri_count()

    stage("groundworks", lambda: groundworks(mb, tier))
    stage("tower", lambda: tower(mb, tier, screen))
    stage("guys", lambda: guys(mb, tier, screen))
    stage("head", lambda: head(mb, tier))
    stage("dish", lambda: dish(mb, tier,
                               SECTORS_COARSE if screen else SECTORS_FINE))
    stage("cabinet", lambda: cabinet(mb, tier))
    if breakdown:
        for (label, n) in rows:
            print("[antenna]   %-12s %6d tris" % (label, n))
    return mb, mb.build(NAME + suffix, root)


def _assert_envelope(mb):
    lo, hi = mb.bounds()
    assert abs(lo[2]) < 1e-6, (
        "the base plane is at z = %.6f and the ground pivot needs it at 0"
        % lo[2])
    for (k, ax) in ((0, "x"), (1, "y")):
        c = (lo[k] + hi[k]) * 0.5
        assert abs(c) < 1e-6, (
            "the AABB centre is %.6f on %s; the four anchors are meant to own "
            "the bounding box and something else has grown past HALF"
            % (c, ax))
        assert hi[k] <= HALF + 1e-6, (
            "%s reaches %.4f against HALF %.4f" % (ax, hi[k], HALF))
    worst_keep, inside, total = 0.0, 0, 0
    for p in mb.verts:
        if p[2] > ANCHOR_H + 1e-9:
            worst_keep = max(worst_keep, abs(p[0]), abs(p[1]))
        total += 1
        if math.sqrt(p[0] ** 2 + p[1] ** 2
                     + (p[2] - PICK_UP) ** 2) <= PICK_MAX:
            inside += 1
    assert worst_keep <= KEEP + 1e-6, (
        "something above the anchors reaches %.4f m, past KEEP %.4f"
        % (worst_keep, KEEP))
    # THE PICK PROPERTY THAT IS ACTUALLY TRUE OF A MAST, ASSERTED, AND THE ONE
    # THAT IS NOT, MEASURED. `pick` scores a ray by its perpendicular distance
    # to (0, 0, PICK_UP), so a LEVEL crosshair at eye height scores exactly
    # |EYE_Z - PICK_UP| whatever the range, and the only question is whether
    # the tower is standing at that height to be aimed at. Both halves are
    # checked. A vertex-by-vertex containment test is the RIGHT assertion for a
    # 2.4 m bench (build_research_station.py makes it) and is unsatisfiable
    # here, so it is reported as a fraction instead of quietly dropped.
    assert abs(EYE_Z - PICK_UP) <= PICK_MAX, (
        "a level crosshair at %.2f m scores %.4f against Antennas.pick's "
        "%.4f, so the antenna cannot be selected at all"
        % (EYE_Z, abs(EYE_Z - PICK_UP), PICK_MAX))
    assert TOWER_Z0 <= EYE_Z <= TOWER_Z1, (
        "the tower spans %.2f to %.2f and the eye is at %.2f, so a level "
        "crosshair meets nothing" % (TOWER_Z0, TOWER_Z1, EYE_Z))
    axis_top = PICK_UP + math.sqrt(max(0.0, PICK_MAX ** 2
                                       - (TOWER_H0 * math.sqrt(2.0)) ** 2))
    return lo, hi, inside / float(total), axis_top


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    mb0, _ = build_form(root, 0.0, "_LOD0", breakdown=True)
    mb1, _ = build_form(root, LOD1_MIN, "_LOD1")
    mb2, _ = build_form(root, LOD2_MIN, "_LOD2", screen=True)
    lo, hi, frac, axis_top = _assert_envelope(mb0)

    proxies = build_collision(root)
    build_sockets(root)

    of.report(NAME, [(NAME + "_LOD0", mb0), (NAME + "_LOD1", mb1),
                     (NAME + "_LOD2", mb2)])
    for label, mb in ((NAME + "_LOD0", mb0), (NAME + "_LOD1", mb1),
                      (NAME + "_LOD2", mb2)):
        l2, h2 = mb.bounds()
        print("[antenna] %-22s tris %5d  dims_xyz_m [%.4f, %.4f, %.4f]"
              % (label, mb.tri_count(), h2[0] - l2[0], h2[2] - l2[2],
                 h2[1] - l2[1]))
    height = hi[2] - lo[2]
    assert abs(height - HEIGHT) < 5e-4, (
        "the antenna stands %.4f m and HEIGHT says %.4f; TRUNNION_Z is solved "
        "backwards from HEIGHT so the two may not drift" % (height, HEIGHT))
    print("[antenna] footprint %.2f x %.2f m on a %.2f m tile; height %.4f m"
          % (FOOT, FOOT, TILE, height))
    print("[antenna] dish %.2f m across, f/D %.2f (focal %.3f m), depth %.4f, "
          "elevation %.1f deg, trunnion z %.4f"
          % (DISH_R * 2.0, F_OVER_D, FOCAL, DEPTH, EL_DEG, TRUNNION_Z))
    print("[antenna] pick: %.1f%% of LOD0 vertices lie inside Antennas.pick's "
          "%.2f m sphere; on the mast axis selection stops at z = %.3f, so "
          "the head and the dish are NOT selectable and the tower is"
          % (frac * 100.0, PICK_MAX, axis_top))
    print("[antenna] %d proxies: %s" % (len(proxies), " ".join(proxies)))
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
