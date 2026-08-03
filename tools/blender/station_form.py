"""
station_form.py - the vocabulary a PRESSURE VESSEL is detailed with.

Not a build script. Imported by build_space_station.py.

WHY A THIRD FORM MODULE. `machine_form.py` details a machine, `rock_form.py`
details a rock, and the argument for splitting them (RN-241) was that a rock is
detailed by FRACTURE and a machine by ASSEMBLY, so one module's vocabulary has
no business being visible to the other. A pressurised structure is a third
thing and the difference is not decorative, it is topological:

  A MACHINE IS A SOLID AND A STATION IS A SHELL. Every greeble in
  `machine_form` mounts on a flat outward face of a solid the player can only
  ever see the outside of. A station has an INSIDE, the player stands in it,
  and the same wall must present two surfaces two metres apart facing opposite
  ways. Nothing in this project cuts geometry (no boolean, no modifier that
  removes material), so a hollow volume is not something you carve, it is
  something you have to BUILD, and that is what `hull_tube` is for.

  A MACHINE'S FACES ARE AXIS ALIGNED AND A HULL'S ARE NOT. `machine_form.Face`
  is X, Y or Z with a sign. A pressure hull is a cylinder, so a hatch on it
  faces some arbitrary direction in a plane and the box that makes it has to be
  ORIENTED. `Shell` is `Face`'s cylindrical cousin and it deliberately reuses
  `machine_form.LAYER`, so a handrail bracket on a station and a P-clip on a
  smelter stand off their host by the same catalogued distances and inherit the
  same structural no-coplanar guarantee (machine_form property (b): the proud
  height is a property of the greeble TYPE, not of the call site).

WHAT "DETAILED AND COMPLEX" MEANS FOR A DERELICT (docs/web/ART-DIRECTION.md).
A machine is detailed by the operations that assembled it. A wreck is detailed
by the operations that assembled it AND by the event that ended it, and the
second one is the reason a derelict is the right subject for this art
direction rather than merely a nice idea:

  1. PLATING, RIBS AND FLANGES. A pressure hull is rolled plate on ring
     frames, seam-welded in courses, and every joint shows. This is
     `machine_form`'s seam argument wrapped round a cylinder.
  2. THINGS THAT PROVE A PERSON WAS HERE. Handrails, deck panels, hatches
     with dogs, ladders, lockers, placards, light coves. A corridor with none
     of these is a pipe.
  3. THINGS THAT PROVE IT WAS A SPACECRAFT. Radiators, solar wings, docking
     rings, antennae, micrometeoroid shielding, umbilical trunks.
  4. THE FAILURE, AUTHORED AS SHAPE. A breach with a petalled rim, buckled
     plate, a module canted off its trunnions, torn insulation, debris still
     in the volume it was blown out of. `tear_rim` and `buckle` are where this
     lives, and they are geometry rather than paint for exactly the reason
     `machine_form.kick_plate` gives: a dent is a fact about a shape whether
     or not anything is painted on it.
  5. ASYMMETRY BY SEED, NOT BY HAND. Every irregular thing here takes an
     integer and derives its wobble from a hash. That is the half of this art
     direction where a script-authored asset is genuinely STRONGER than hand
     modelling: variation is a function of position rather than a repeated
     decal, and it is reproducible to the byte.

DETERMINISM. `hashf` is an integer hash, not `random`, for DW-14's reason: the
build must be byte-identical on any machine and across any Python point
release. `math.sin`/`cos` ARE used here (unlike texgen.py, which bans them)
because Blender's own exporter and every existing cylinder in `of_lib` already
depend on them; the ban applies to the texture path, which must be bit-portable
without Blender in the loop at all.
"""

import math

import machine_form as mf


# ---------------------------------------------------------------------------
# The cylindrical frame.
#
# One table instead of six transcriptions. `axis` names the tube's own axis and
# the two other unit vectors are where angle 0 and angle 90 point. ANGLE 0 IS
# LOCAL UP (+Z) on the two horizontal axes, because "up" is the one direction
# an interior has an opinion about: the brief's decks are perpendicular to it,
# and a station convention of dorsal-0, port-90, ventral-180, starboard-270
# then reads off the number.
# ---------------------------------------------------------------------------

_FRAME = {
    "X": ((1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0)),
    "Y": ((0.0, 1.0, 0.0), (0.0, 0.0, 1.0), (1.0, 0.0, 0.0)),
    "Z": ((0.0, 0.0, 1.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)),
}


def frame(axis):
    """(axial, e0, e90) unit vectors for a tube on `axis`, or raise by name."""
    if axis not in _FRAME:
        raise ValueError("axis must be X, Y or Z (got %r)" % axis)
    return _FRAME[axis]


def radial(axis, deg):
    """Outward unit vector at `deg` around a tube on `axis`."""
    _a, e0, e9 = frame(axis)
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (e0[0] * c + e9[0] * s, e0[1] * c + e9[1] * s,
            e0[2] * c + e9[2] * s)


def tangent(axis, deg):
    """Unit vector along increasing angle at `deg`: the hull's 'across' axis."""
    _a, e0, e9 = frame(axis)
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return (e9[0] * c - e0[0] * s, e9[1] * c - e0[1] * s,
            e9[2] * c - e0[2] * s)


def point(axis, centre, along, deg, r):
    """The world point `r` metres out at `deg`, `along` metres up the axis."""
    ax, _e0, _e9 = frame(axis)
    rd = radial(axis, deg)
    return tuple(centre[k] + ax[k] * along + rd[k] * r for k in range(3))


# ---------------------------------------------------------------------------
# Determinism helpers
# ---------------------------------------------------------------------------

def hashf(*keys):
    """A stable float in [0, 1) from any tuple of integers.

    32-bit integer arithmetic only, the same shape texgen.py uses, and for the
    same reason: `random` is seeded per interpreter and would make the build
    depend on the order the script happened to call things in. Here the caller
    passes the part's own identity (module index, ring index, plate index) so a
    plate's dent depends on WHICH PLATE IT IS and nothing else. Re-ordering the
    build cannot move a single vertex."""
    h = 0x811C9DC5
    for k in keys:
        v = int(k) & 0xFFFFFFFF
        for _ in range(4):
            h = (h ^ (v & 0xFF)) & 0xFFFFFFFF
            h = (h * 0x01000193) & 0xFFFFFFFF
            v >>= 8
    h ^= (h >> 15)
    return ((h & 0xFFFFFF) / float(0x1000000))


def jitter(amount, *keys):
    """A stable value in [-amount, +amount]."""
    return (hashf(*keys) * 2.0 - 1.0) * amount


# ---------------------------------------------------------------------------
# Oriented primitives. of_lib's box only yaws about Z, which is enough for a
# machine standing on the ground and is not enough for anything mounted on a
# cylinder.
# ---------------------------------------------------------------------------

def oriented_box(mb, centre, u, v, w, size, role):
    """A box with an arbitrary orthonormal frame (u, v, w) and `size` along it.

    Written as raw vertices rather than as a Blender rotation, for of_lib's own
    stated reason: `bpy.ops` and object-level transforms depend on context and
    on the exporter's matrix handling, and a vertex list does not. Twelve
    triangles, same as `mb.box`, and it may be placed at any angle on any hull.
    """
    hu, hv, hw = (s * 0.5 for s in size)
    verts = []
    for sw in (-1.0, 1.0):
        for su, sv in ((-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)):
            verts.append(tuple(centre[k] + u[k] * hu * su + v[k] * hv * sv
                               + w[k] * hw * sw for k in range(3)))
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    verts, faces = mf.oriented(verts, faces)
    mb.add_raw(verts, faces, [False] * len(faces), role)
    return mb


def quad(mb, corners, role, smooth=False):
    """One four-cornered face, both sides implied by the caller's winding.

    The escape hatch for a shard, a petal of torn plate or a panel that is not
    a box. A single quad is TWO triangles and is the cheapest thing in this
    file; it is one-sided, so it belongs on a role in of_lib.DOUBLE_SIDED or on
    a surface the player only ever sees from one side."""
    mb.add_raw(list(corners), [(0, 1, 2, 3)], [smooth], role)
    return mb


def tri(mb, corners, role):
    """One triangle. The petal of a tear rim, the gusset of a truss."""
    mb.add_raw(list(corners), [(0, 1, 2)], [False], role)
    return mb


# ---------------------------------------------------------------------------
# The hull itself
# ---------------------------------------------------------------------------

def hull_tube(mb, axis, a0, a1, r_in, r_out, sides, role, centre=(0, 0, 0),
              deg0=0.0, deg1=360.0, smooth=True, caps=True):
    """A HOLLOW tube section: an outer skin, an inner skin, and annular ends.

    THIS IS THE WHOLE REASON THIS MODULE EXISTS. `of_lib.cylinder` is a solid,
    and a solid cylinder has no inside: standing in one renders the backs of
    its faces, which are culled, which reads as a hole in the universe. There
    is no boolean in this project to hollow one out with. So the two skins and
    the two end annuli are built as ONE closed manifold, wound by
    `machine_form.oriented`, and a player standing inside sees the inner skin's
    FRONT faces because the inner skin's outward normal points at the axis,
    which is correctly outward FROM THE SOLID.

    Cost is 4 quads per side (outer, inner, two ends) = 8 triangles per side,
    so a 12-sided full ring is 96 triangles for a watertight pressure hull with
    both faces. Dropping `caps` on a section that butts another section saves
    2 quads per side and is what makes a long spine affordable.

    `deg0`/`deg1` short of a full turn give an OPEN section: the two radial cut
    faces are added so the shell is still closed, and that is how a breach, a
    peeled-back panel or a half-collapsed module is expressed.

    `smooth` shades the two skins smoothly and leaves the ends flat, which is
    the same split `of_lib._cyl_data` makes and for the same reason: a smooth
    cylinder claims a curvature it does have, and a smooth end cap claims one
    it does not."""
    full = abs((deg1 - deg0) - 360.0) < 1e-9
    n = max(3, sides)
    step = (deg1 - deg0) / n
    ring = n if full else n + 1
    ax, _e0, _e9 = frame(axis)
    verts = []
    for i in range(ring):
        d = deg0 + step * i
        rd = radial(axis, d)
        for (a, r) in ((a0, r_out), (a1, r_out), (a0, r_in), (a1, r_in)):
            verts.append(tuple(centre[k] + ax[k] * a + rd[k] * r
                               for k in range(3)))
    faces, sm = [], []

    def idx(i, k):
        return (i % ring) * 4 + k

    for i in range(n):
        j = i + 1
        faces.append((idx(i, 0), idx(j, 0), idx(j, 1), idx(i, 1)))
        sm.append(smooth)
        faces.append((idx(i, 2), idx(i, 3), idx(j, 3), idx(j, 2)))
        sm.append(smooth)
        if caps:
            faces.append((idx(i, 0), idx(i, 2), idx(j, 2), idx(j, 0)))
            sm.append(False)
            faces.append((idx(i, 1), idx(j, 1), idx(j, 3), idx(i, 3)))
            sm.append(False)
    if not full:
        for (i, order) in ((0, (0, 1, 3, 2)), (ring - 1, (0, 2, 3, 1))):
            faces.append(tuple(idx(i, k) for k in order))
            sm.append(False)
    verts, faces = mf.oriented(verts, faces)
    mb.add_raw(verts, faces, sm, role)
    return mb


def bulkhead(mb, axis, at, r_in, r_out, thick, sides, role, centre=(0, 0, 0),
             hole_r=0.0):
    """A pressure frame across a tube: a flat annulus of `thick` metres.

    With `hole_r` 0 it is a ring frame welded to the inside of the hull, which
    is what every 3 m of a real pressure vessel has and what stops a long tube
    reading as extruded. With `hole_r` set it is a BULKHEAD with a doorway
    aperture, and the aperture is what makes a corridor read as a sequence of
    compartments rather than one pipe: a person walking a station passes
    through frames, and the frames are the rhythm."""
    hull_tube(mb, axis, at - thick * 0.5, at + thick * 0.5,
              max(hole_r, r_in), r_out, sides, role, centre=centre,
              smooth=False)
    return mb


class Shell:
    """A cylindrical surface, and the frame greebles are placed on it in.

    `Face`'s cousin, with the same contract: a caller says WHAT to put on the
    hull and WHERE in hull coordinates, and never says how far proud, because
    that is `machine_form.LAYER`'s job and is what makes a same-plane collision
    imply a same-material one.

    axis    the tube's own axis, "X", "Y" or "Z"
    centre  a point on that axis
    r       the radius of the surface being mounted on
    sign    +1 mounts OUTWARD (the exterior hull), -1 mounts INWARD (the
            corridor wall a player reaches out and touches). One class serves
            both because the only difference is which way `proud` runs, and an
            interior with its own half-copied module is how the two drift.

    Coordinates are (along, deg): `along` is metres up the axis from `centre`
    and `deg` is the hull angle, 0 = local up. A part's size is given as
    (span_along, span_arc) IN METRES ON THE SURFACE, not in degrees, because a
    handrail is 40 mm wide wherever it is and an author should never have to
    divide by a radius to say so.

    `min_layer` IS THE SHADOW LOD LADDER, AND IT IS A PROPERTY OF THE SURFACE
    RATHER THAN OF THE BUILD SCRIPT. A coarser tier is admitted to a shadow
    cascade by its maximum surface deviation from LOD0: 15.47 mm earns cascade
    0, 56.25 mm cascade 1, 210.94 mm cascade 2. Every greeble here stands proud
    by a catalogued `machine_form.LAYER` height, so the deviation a tier will
    measure is decided ENTIRELY by which layers it drops, and it is decided
    before a single triangle is built rather than discovered afterwards by
    `check_shadow_lod.py`.

    Set `min_layer` and a Shell silently drops every part shallower than it.
    One build function then emits LOD0 and LOD1 from the same source, so the
    two can never disagree about where anything is, and the tier's worst-case
    deviation is exactly `min_layer` by construction. `LOD1_MIN` below is the
    threshold that lands a tier in cascade 1 with margin.
    """

    __slots__ = ("axis", "centre", "r", "sign", "name", "min_layer", "sides")

    def __init__(self, axis, centre, r, sign=1, name=None, min_layer=0.0,
                 sides=12):
        frame(axis)
        if sign not in (-1, 1):
            raise ValueError("sign must be -1 or 1 (got %r)" % sign)
        self.axis = axis
        self.centre = tuple(float(c) for c in centre)
        self.r = float(r)
        self.sign = sign
        self.min_layer = float(min_layer)
        # THE HULL IS A POLYGON AND A PART MOUNTED ON IT MUST KNOW THAT.
        # `sides` is the facet count of the surface this Shell describes, and
        # the only thing it is used for is splitting a wide part along the
        # SAME facet lines. See `part`.
        self.sides = int(sides)
        self.name = name or ("%s%s r%.2f" % ("+-"[sign < 0], axis, r))

    def keeps(self, kind):
        """Whether a greeble of this type survives into this tier."""
        return mf.layer(kind) >= self.min_layer

    def arc_deg(self, metres):
        """Degrees of hull subtended by `metres` of arc at this radius."""
        return math.degrees(metres / self.r) if self.r > 1e-9 else 0.0

    def out(self, dist):
        """The radius `dist` metres proud of this surface, respecting sign."""
        return self.r + self.sign * dist

    def at(self, along, deg, dist=0.0):
        """The world point `dist` proud of the surface at (along, deg)."""
        return point(self.axis, self.centre, along, deg, self.out(dist))

    def part(self, mb, span, arc, along, deg, kind, role, embed=mf.EMBED):
        """One oriented box on this surface, `LAYER[kind]` proud of it.

        `span` runs along the axis and `arc` runs across the hull, both in
        metres. The box's third dimension is derived from the layer exactly as
        `Face.part` derives it, so its back is buried in the plate it is
        mounted on and no call in this class can put a part flush.

        The box is FLAT, not curved. At the radii a station is built from
        (1.8 m to 7 m) and the arc widths a greeble has (40 mm to 800 mm), the
        sagitta of the chord is well under a millimetre for a handrail and
        about 11 mm for the widest plate, which is inside the layer spacing and
        therefore cannot create a coplanar pair. Curving a greeble would cost
        four times the triangles to hide a defect nobody can see."""
        p = mf.layer(kind)
        if p < self.min_layer:
            return self.r
        back = -p * embed
        thick = p - back
        # A WIDE PART IS SPLIT ALONG THE HULL'S OWN FACET LINES, and both
        # halves of that sentence were learned the hard way.
        #
        # The threshold is derived from the cascade rather than chosen: a flat
        # chord of width w on radius r stands off its host by about w^2 / 8r,
        # and 12 mm is comfortably inside cascade 0's own 15.47 mm texel, so a
        # part under the cut is indistinguishable from a curved one. The first
        # version of this method was flat unconditionally and its docstring
        # justified that for greebles 40 mm to 800 mm wide, which was true and
        # was not the whole story: a 2.10 m livery stripe on a 3.20 m hull
        # stands 172 mm off at its ends and a 3.80 m cargo door on a 5.00 m
        # hull stands 349 mm off, so both floated AND measured that gap as
        # deviation when a coarse tier dropped them.
        #
        # THE SECOND VERSION CURVED THEM AS `hull_tube` ARCS AND WAS ALSO
        # WRONG, for a subtler reason: a swept arc follows the TRUE CIRCLE
        # while the hull it is mounted on is a 12-gon whose facet midpoints sit
        # r(1 - cos(pi/12)) = 3.4 per cent low. On a 5.00 m hull that is 170 mm
        # of gap under the middle of every panel, and the tier measured it.
        # A REAL PLATE ON A ROLLED POLYGONAL HULL BENDS AT THE FACET LINES, so
        # that is what this does: one flat box per facet, snapped to the same
        # angular grid the hull was built on. Each box is then exactly on its
        # own facet and the deviation is the layer height and nothing else.
        if arc * arc > 8.0 * self.r * 0.012:
            step = 360.0 / self.sides
            half = math.degrees(arc / (2.0 * self.r))
            lo = int(math.floor((deg - half) / step))
            hi = int(math.ceil((deg + half) / step))
            for i in range(lo, hi):
                c = (i + 0.5) * step
                chord = 2.0 * self.r * math.sin(math.radians(step * 0.5))
                self._flat(mb, span, chord, along, c, p, back, role)
            return self.out(p)
        self._flat(mb, span, arc, along, deg, p, back, role)
        return self.out(p)

    def _flat(self, mb, span, arc, along, deg, p, back, role):
        """One flat oriented box tangent to the surface at `deg`."""
        thick = p - back
        mid = self.out((p + back) * 0.5)
        c = point(self.axis, self.centre, along, deg, mid)
        ax, _e0, _e9 = frame(self.axis)
        tg = tangent(self.axis, deg)
        rd = radial(self.axis, deg)
        oriented_box(mb, c, ax, tg, rd, (span, arc, thick), role)

    def strake(self, mb, a0, a1, deg, width, role, kind="seam"):
        """A butt strap running ALONG the hull: the weld between two courses
        of rolled plate.

        `machine_form.through_seam` argues that the best ratio in that
        vocabulary is a strap that shows on two faces at once. A hull's version
        of the same argument is different and better: a strake is the longest
        straight line on the object, so twelve triangles buy a feature that
        runs the entire length of the silhouette and breaks a 48 m tube into
        plates at no per-metre cost."""
        return self.part(mb, a1 - a0, width, (a0 + a1) * 0.5, deg, kind, role)

    def girth(self, mb, at, width, role, kind="seam", segs=None, deg0=0.0,
              deg1=360.0):
        """The other weld: a course seam running AROUND the hull.

        Built as a short `hull_tube` rather than as a ring of boxes, because a
        band that goes all the way round is exactly what `hull_tube` is and one
        primitive at 8 triangles per side beats `sides` boxes at 12 each."""
        p = mf.layer(kind)
        if p < self.min_layer:
            return self.r
        n = segs or 12
        r0, r1 = sorted((self.r - self.sign * p * mf.EMBED, self.out(p)))
        hull_tube(mb, self.axis, at - width * 0.5, at + width * 0.5,
                  r0, r1, n, role, centre=self.centre, deg0=deg0, deg1=deg1,
                  smooth=False)
        return self.out(p)

    def rivets(self, mb, along, deg0, deg1, n, size, role, kind="bolt"):
        """`n` rivet heads spaced around an arc, both ends included.

        Cheap per head and ruinous per field: twelve triangles each is the same
        price `machine_form.bolts` warns about, so these go where a fastener is
        STRUCTURAL and where a player's face is close to it (a hatch coaming, a
        docking flange, the doubler round a breach), and never as a texture
        substitute across bare plate. The normal map carries a rivet field; the
        geometry carries the ones that catch a rim light."""
        if n < 1:
            return
        for i in range(n):
            t = 0.0 if n == 1 else i / float(n - 1)
            self.part(mb, size, size, along, deg0 + (deg1 - deg0) * t, kind,
                      role)

    def rivet_run(self, mb, a0, a1, deg, n, size, role, kind="bolt"):
        """The same run laid ALONG the hull instead of around it."""
        if n < 1:
            return
        for i in range(n):
            t = 0.0 if n == 1 else i / float(n - 1)
            self.part(mb, size, size, a0 + (a1 - a0) * t, deg, kind, role)


class Panel(mf.Face):
    """A flat interior wall, deck or ceiling, with the same tier filter.

    THE INTERIOR IS AXIS ALIGNED AND THE HULL IS NOT, so the interior does not
    need `Shell` at all: a corridor wall at y = 1.60 IS a `machine_form.Face`,
    and the whole machine greeble vocabulary (hatches, louvres, trays, gauge
    clusters, placards, kick plates, junction boxes) already places itself on
    one. The first version of this file bent a `Shell` onto a 900 m radius to
    reuse it for planes, which worked and was two trigonometric conversions
    nobody would ever be able to read.

    The ONLY thing `Face` lacks is the shadow-LOD tier filter, so that is the
    only thing added. `min_layer` means exactly what it means on `Shell`: parts
    shallower than it are dropped, so a tier's worst-case surface deviation is
    that number by construction rather than by measurement afterwards.

    `Shell` and `Panel` take the same four positional numbers in `part` (span,
    across, position-along, position-across), which is why every helper in this
    module that only calls `.part` works unchanged on either. `handrail` is the
    one that matters: the same call rails a curved hull and a flat corridor."""

    __slots__ = ("min_layer",)

    def __init__(self, axis, sign, plane, limit=None, name=None,
                 min_layer=0.0):
        mf.Face.__init__(self, axis, sign, plane, limit=limit, name=name)
        self.min_layer = float(min_layer)

    def keeps(self, kind):
        return mf.layer(kind) >= self.min_layer

    def part(self, mb, du, dv, u, v, kind, role, embed=mf.EMBED):
        if mf.layer(kind) < self.min_layer:
            return self.out(mf.layer(kind))
        return mf.Face.part(self, mb, du, dv, u, v, kind, role, embed)

    def coaming(self, mb, du, dv, u, v, role, rail=0.075, kind="coaming"):
        if mf.layer(kind) < self.min_layer:
            return
        mf.Face.coaming(self, mb, du, dv, u, v, role, rail=rail, kind=kind)

    def warped(self, mb, corners, kind, role, embed=mf.EMBED):
        if mf.layer(kind) < self.min_layer:
            return self.out(mf.layer(kind))
        return mf.Face.warped(self, mb, corners, kind, role, embed)

    def wedge(self, mb, u, du, v_top, reach, drop, kind, role):
        if mf.layer(kind) < self.min_layer:
            return
        mf.Face.wedge(self, mb, u, du, v_top, reach, drop, kind, role)


# ---------------------------------------------------------------------------
# Things that prove a person was here
# ---------------------------------------------------------------------------

def handrail(mb, shell, a0, a1, deg, role, posts=4, stand=0.075, rail=0.042):
    """A grab rail along a corridor wall: two brackets per post and a rail.

    THE SINGLE MOST LOAD-BEARING GREEBLE IN AN INTERIOR and the reason is
    `machine_form.ladder`'s reason turned sideways. A ladder says how TALL a
    machine is because a player knows a rung spacing. A handrail says WHICH WAY
    IS DOWN, because a rail is mounted at hand height above a floor and nowhere
    else, and the brief asks for exactly that: geometry that makes the
    artificial-gravity fiction legible without explaining it. It is also the
    thing a player's eye tracks along a corridor, so it does the job a
    vanishing point does in a corridor that has no other lines.

    The rail sits on the `tray` layer and the brackets on `clip` below it, so a
    bracket's front face is inside the rail it carries rather than on it: the
    same construction `machine_form.tray` uses, and it cannot make a coplanar
    pair."""
    shell.part(mb, a1 - a0, rail, (a0 + a1) * 0.5, deg, "tray", role)
    if posts < 1:
        return
    for i in range(posts):
        t = 0.0 if posts == 1 else i / float(posts - 1)
        shell.part(mb, rail * 1.6, rail + stand * 0.6, a0 + (a1 - a0) * t,
                   deg, "clip", role)


def deck_panel(mb, x0, x1, y0, y1, z_top, role_deck, role_trim, thick=0.06,
               seed=0):
    """One floor panel with a raised edge trim on two sides.

    WHY THE TREAD IS NOT GEOMETRY. The brief asks for floor gratings that read
    as down, and the first draft of this made them out of slats. A 2.5 x 2.0 m
    panel at a 60 mm slat pitch is 40 boxes and 480 triangles, and a corridor
    is forty panels, so the floor alone would have been 19,000 triangles of
    detail that is under a centimetre proud. That is precisely the frequency
    RN-454 assigns to the NORMAL MAP: relief below a centimetre belongs in the
    map, pigmentation at 10 to 20 cm in the albedo, and structure above 10 cm
    in the geometry. So the panel carries its JOINTS, which are structure, and
    the tread pattern rides on `deckplate`'s normal.

    `seed` drops the panel by a fraction of a millimetre so a long run of them
    is not a mirror. It is deliberately smaller than any shadow cascade texel
    (cascade 0 is 15.47 mm) so it can never cost an LOD tier its admission."""
    dz = jitter(0.0008, seed, 11)
    mb.box((x1 - x0, y1 - y0, thick),
           ((x0 + x1) * 0.5, (y0 + y1) * 0.5, z_top - thick * 0.5 + dz),
           role_deck)
    # The trim's UNDERSIDE is buried 6 mm in the panel it edges, not laid on
    # it. A strip whose bottom lands exactly on the deck's top gives two
    # materials one plane, which `check_coplanar` counts once per panel and
    # which is RN-411's catalogued cause: an extent on its host's boundary.
    # SHORTER than the panel it edges and 64 mm wide rather than 50. Both
    # numbers were found by `check_coplanar`, not chosen: a trim as long as its
    # panel puts its two end faces on the panel's own end planes (5 pairs per
    # panel, 42 panels), and at 50 mm its outer edge landed on y0 - 0.025,
    # which for a 1.66 m deck half-width is 1.635, which is also where a
    # neighbouring corridor's panels happened to end. A shared plane between
    # two unrelated parts is a coincidence of arithmetic, and the fix is to
    # stop the arithmetic coinciding.
    for y in (y0, y1):
        mb.box((x1 - x0 - 0.07, 0.064, 0.028),
               ((x0 + x1) * 0.5, y, z_top + 0.008 + dz), role_trim)


def grating(mb, x0, x1, y0, y1, z_top, bars, role, thick=0.035):
    """An OPEN floor grating over a service trench: bars with gaps between.

    The one place slats are worth their triangles, because here the gaps are
    the point. A player who can see cable runs and structure through the floor
    knows the floor is a floor rather than the bottom of the world, and this is
    the cheapest possible statement that the station has a below-decks. Used
    over short runs only; `deck_panel` is what tiles."""
    if bars < 1:
        return
    # RECESSED 15 mm below the deck it sits in, which is both what a floor
    # grating over a trench actually is and the thing that stops every bar's
    # top face sharing a plane with the deck panels around it.
    top = z_top - 0.015
    pitch = (y1 - y0) / bars
    for i in range(bars):
        cy = y0 + pitch * (i + 0.5)
        mb.box((x1 - x0, pitch * 0.55, thick), ((x0 + x1) * 0.5, cy,
                                                top - thick * 0.5), role)
    for y in (y0, y1):
        mb.box((x1 - x0, 0.05, thick * 1.5), ((x0 + x1) * 0.5, y,
                                              top - thick * 0.75), role)


def hatch_frame(mb, shell, along, deg, w, h, role_frame, role_panel,
                role_metal, dogs=4, open_deg=0.0):
    """A pressure hatch in a bulkhead: a coaming, a leaf, and dogging levers.

    `open_deg` swings the leaf on its hinge side. A derelict wants its hatches
    in DIFFERENT states, and that is not decoration: a shut hatch, a hatch
    dogged half open and a hatch blown off its hinges are three different
    stories about what happened here, and the player reads the difference
    before reading anything else in the compartment."""
    arc = shell.arc_deg(w)
    rail = 0.085
    for s in (-1, 1):
        shell.part(mb, h + rail * 2.0, rail, along, deg + s * (arc + shell.arc_deg(rail)) * 0.5,
                   "coaming", role_frame)
        shell.part(mb, rail, w, along + s * (h + rail) * 0.5, deg, "coaming",
                   role_frame)
    if open_deg <= 0.01:
        shell.part(mb, h * 0.94, w * 0.94, along, deg, "plate", role_panel)
        for i in range(dogs):
            t = (i + 0.5) / dogs
            shell.part(mb, 0.055, 0.20, along - h * 0.5 + h * t,
                       deg + arc * 0.42, "latch", role_metal)
        shell.part(mb, 0.16, 0.16, along, deg - arc * 0.30, "gauge",
                   role_metal)
    else:
        swing = math.radians(min(120.0, open_deg))
        hu = shell.arc_deg(w * 0.5)
        hinge = shell.at(along, deg - hu)
        ax, _e0, _e9 = frame(shell.axis)
        tg = tangent(shell.axis, deg)
        rd = radial(shell.axis, deg)
        reach = w * 0.94
        d = tuple(tg[k] * math.cos(swing) - shell.sign * rd[k] * math.sin(swing)
                  for k in range(3))
        c = tuple(hinge[k] + d[k] * reach * 0.5 for k in range(3))
        nrm = tuple(shell.sign * rd[k] * math.cos(swing) + tg[k] * math.sin(swing)
                    for k in range(3))
        oriented_box(mb, c, ax, d, nrm, (h * 0.94, reach, 0.055), role_panel)


def light_cove(mb, x0, x1, y, z, role_body, role_glow, width=0.13):
    """A ceiling light strip: a housing with an emissive lens under it.

    THE INTERIOR'S ONLY HONEST LIGHT SOURCE AND THEREFORE NOT OPTIONAL. A
    sealed hull in orbit has one directional sun outside it and no ambient
    inside, so a corridor lit only by what comes through a viewport is black,
    and a black corridor is not a place a player can be asked to walk around
    in. An emissive material costs no light in three.js (it is a term in the
    shader, not a source), so a strip is twelve triangles and buys the whole
    legibility of the interior.

    On a derelict most of them are DEAD, and the ones that are not are the only
    reason the player walks one way rather than another. Which is which is the
    caller's decision, expressed as the role it passes."""
    mb.box((x1 - x0, width, 0.075), ((x0 + x1) * 0.5, y, z + 0.037), role_body)
    mb.box((x1 - x0 - 0.10, width * 0.66, 0.026),
           ((x0 + x1) * 0.5, y, z - 0.013), role_glow)


def viewport(mb, shell, along, deg, r, role_frame, role_glass, role_metal,
             segs=8):
    """A window: a bolted coaming ring, a glass pane, and an outer sun shade.

    Built as a ring of `segs` boxes round the aperture rather than as a torus,
    which is `machine_form.arc_ring`'s argument (everything here is authored
    from primitives, and a ring of oriented boxes reads correctly at any angle
    for a twelfth of a torus's triangles).

    A viewport is the one greeble that does two jobs at once on a derelict: it
    is the strongest hard-surface cue on a blank hull, and it is a LIGHT PORT,
    so the shafts it throws across a dark deck are what makes the interior
    photograph at all."""
    for i in range(segs):
        a = 360.0 * i / segs
        du = r * 2.0 * math.pi / segs * 1.25
        shell.part(mb, du * abs(math.sin(math.radians(a))) + 0.09,
                   du * abs(math.cos(math.radians(a))) + 0.09,
                   along + r * math.cos(math.radians(a)),
                   deg + shell.arc_deg(r * math.sin(math.radians(a))),
                   "coaming", role_frame)
    shell.part(mb, r * 1.7, r * 1.7, along, deg, "shim", role_glass)
    shell.part(mb, r * 0.5, r * 2.3, along + r * 1.15, deg, "bracket",
               role_metal)


# ---------------------------------------------------------------------------
# Things that prove it was a spacecraft
# ---------------------------------------------------------------------------

def docking_ring(mb, axis, at, r, role_body, role_face, role_metal, sides=12,
                 centre=(0, 0, 0), latches=8):
    """An androgynous docking collar: a throat, a raised guide ring, a sealing
    face and a ring of capture latches.

    Three diameters over 400 mm, which is `machine_form.stack`'s trick applied
    to the one part of a station whose whole job is to be recognised from a
    kilometre away. A flat disc on the end of a tube is a lid; a collar with a
    guide petal ring is unmistakably a place another spacecraft goes."""
    ax, _e0, _e9 = frame(axis)
    hull_tube(mb, axis, at - 0.34, at - 0.06, r * 0.62, r, sides, role_body,
              centre=centre)
    hull_tube(mb, axis, at - 0.06, at + 0.05, r * 0.60, r * 1.16, sides,
              role_face, centre=centre, smooth=False)
    hull_tube(mb, axis, at + 0.05, at + 0.26, r * 0.94, r * 1.10, sides,
              role_metal, centre=centre)
    sh = Shell(axis, centre, r * 1.02, 1)
    for i in range(latches):
        sh.part(mb, 0.13, 0.09, at - 0.18, 360.0 * i / latches, "boss",
                role_metal)


def docking_adapter(mb, axis, at, centre, r_mate, capture_r, cone_deg,
                    role_body, role_face, role_metal, role_seal, role_mark,
                    throat_r, sides=12, tier=0.0, petal_az=(45.0, 165.0,
                                                            285.0),
                    latch_az=(27.0, 147.0, 267.0), index_az=0.0):
    """THE CLASS-S DOCKING INTERFACE, ON A STATION-SIZED BERTHING COLLAR.

    WHY THIS EXISTS, and it is a defect report before it is a feature.
    `docking_ring` above authors a 2.20 m collar whose clear throat is 2.64 m
    across. The vessel catalogue's only docking part is class S: 1.25 m across,
    with `dockCaptureRadiusM = 0.60`. **THOSE TWO THINGS CANNOT MATE.** The
    ship's port passes through the station's throat with 0.70 m of clearance
    all the way round and touches nothing, and every gate in this project
    passed on that for the whole time both assets have shipped, because no
    checker anywhere compares two assets to each other.

    So this is the missing half of the interface: an androgynous class-S port
    on the collar's own axis, standing proud of the guide ring on four struts.
    That is also what the real hardware does, and the reason is the same one.
    A big collar is a BERTHING ring, mated by an arm at zero relative velocity;
    a small port is a DOCKING ring, flown into under its own power. A station
    that offers both carries an adapter, and the adapter is this.

    THE STRUTS RATHER THAN A BULKHEAD IS A DELIBERATE CHOICE. Closing the
    throat with a plate would be cheaper and would seal a hole that currently
    opens into an unlit interior. It would also close the only large opening at
    the forward end, and this lane cannot tell whether a player is meant to get
    in through it. Four struts leave the throat exactly as passable as it was
    and change nothing that another lane may depend on.

    EVERY NUMBER IS THE VESSEL PORT'S. `capture_r` and `cone_deg` come from the
    same two catalogue fields `rocket_common.docking_port` is built against, so
    the two halves of the joint are the same interface rather than two things
    that look alike. `r_mate` is the class mating radius, 0.625.

    `tier` is the shadow-LOD gate, in `machine_form.LAYER` units, and it is
    used exactly as `Shell.min_layer` is: a coarser tier keeps the rings, which
    are structure, and drops the petals, latches, gasket and datum marks, which
    are trim. The worst-case surface deviation that costs is a dropped petal
    tip, `capture_r - r_land`, which is 30 mm and inside cascade 1's 56.25 mm.
    """
    ax, _e0, _e9 = frame(axis)
    r_land_in, r_land_out = r_mate * 0.723, r_mate * 0.912   # 0.452, 0.570
    r_seal_in, r_seal_out = r_mate * 0.538, r_mate * 0.739   # 0.336, 0.462
    keep_trim = tier <= mf.LAYER["clip"]

    # The pedestal: a hollow barrel from the collar's sealing face out to the
    # port, so the port is on the end of something rather than floating.
    hull_tube(mb, axis, at - 0.46, at - 0.06, r_seal_in, r_mate * 0.84, sides,
              role_body, centre=centre)
    # The two lands, at two heights, which is what makes it a SEALING face
    # rather than a washer. The outer one's outboard plane IS the mating plane
    # and is the surface `socket_dock` sits on.
    hull_tube(mb, axis, at - 0.07, at, r_land_in, r_land_out, sides,
              role_face, centre=centre, smooth=False)
    hull_tube(mb, axis, at - 0.064, at - 0.018, r_seal_in, r_seal_out, sides,
              role_metal, centre=centre, smooth=False)
    if keep_trim:
        hull_tube(mb, axis, at - 0.026, at - 0.008, r_mate * 0.563,
                  r_mate * 0.666, sides, role_seal, centre=centre,
                  smooth=False)                                  # the gasket

    # Four struts out to the collar throat. Sized to the gap they span, so a
    # change to either radius moves them rather than leaving them short.
    span = throat_r - r_mate * 0.84
    for k in range(4):
        deg = 45.0 + 90.0 * k
        u = radial(axis, deg)
        v = tangent(axis, deg)
        mid = tuple(centre[j] + ax[j] * (at - 0.30)
                    + u[j] * (r_mate * 0.84 + span * 0.5) for j in range(3))
        oriented_box(mb, mid, u, v, ax, (span, 0.14, 0.16), role_metal)

    if not keep_trim:
        return
    # The capture cone, as three petals. A petal is a plate whose inner face
    # lies on `cone_deg` from the axis and whose tip sweeps `capture_r`, which
    # is the same construction `rocket_common.petal` uses and the same two
    # published numbers. Authored as an oriented box canted by (90 - cone),
    # because on this side of the joint the petal is 90 mm long and a box that
    # long at the right angle is indistinguishable from a tapered plate.
    run = 0.16
    r_root = capture_r - run * math.tan(math.radians(cone_deg))
    tilt = math.radians(90.0 - cone_deg)
    for deg in petal_az:
        u = radial(axis, deg)
        v = tangent(axis, deg)
        # w runs up the petal: outward in radius, outboard along the axis.
        w = tuple(u[j] * math.cos(tilt) + ax[j] * math.sin(tilt)
                  for j in range(3))
        n = tuple(-u[j] * math.sin(tilt) + ax[j] * math.cos(tilt)
                  for j in range(3))
        # Length is the HYPOTENUSE, run / cos(cone), not the axial run. The
        # first draft divided by cos(tilt) instead and produced petals twice
        # as long as the port is wide.
        length, thick = run / math.cos(math.radians(cone_deg)), 0.022
        mid = tuple(centre[j] + ax[j] * (at - run * 0.5)
                    + u[j] * ((r_root + capture_r) * 0.5)
                    - n[j] * thick * 0.5 for j in range(3))
        oriented_box(mb, mid, w, v, n, (length, 0.17, thick), role_face)
    # Capture latches, inboard of the land and UNDER the mating plane, which is
    # the one relationship they may not break: a latch flush with the mating
    # plane is a coplanar pair with it and is what RN-426 spent a pass fixing
    # on the vessel side of this same joint.
    for deg in latch_az:
        u = radial(axis, deg)
        v = tangent(axis, deg)
        mid = tuple(centre[j] + ax[j] * (at - 0.026)
                    + u[j] * (r_mate * 0.688) for j in range(3))
        oriented_box(mb, mid, u, v, ax, (0.052, 0.096, 0.024), role_metal)
    # THE ROLL DATUM, at index_az and nowhere else, matching the vessel port's.
    # Two marks: one on the seal land for the close-in view, one on the
    # pedestal for the approach.
    for (along, r, size) in ((at - 0.030, r_mate * 0.64, (0.052, 0.030, 0.014)),
                             (at - 0.24, r_mate * 0.86, (0.052, 0.104, 0.016))):
        u = radial(axis, index_az)
        v = tangent(axis, index_az)
        mid = tuple(centre[j] + ax[j] * along + u[j] * r for j in range(3))
        oriented_box(mb, mid, u, v, ax, size, role_mark)


def radiator(mb, root, span, length, panels, role_panel, role_frame,
             axis_out=(0, -1, 0), axis_long=(1, 0, 0), droop=0.0, seed=0):
    """A deployable radiator bank: a spine beam and `panels` flat wings.

    Flat quads on a frame, because that is what a radiator physically is and
    because a 3 mm thick panel modelled as a box would spend half its triangles
    on edges nobody can resolve. `droop` cants successive panels progressively,
    which on a derelict is the point: a bank whose actuators have failed sags
    into a fan, and a fan reads as broken from any angle a flat bank reads as
    fine from."""
    up = (axis_out[1] * axis_long[2] - axis_out[2] * axis_long[1],
          axis_out[2] * axis_long[0] - axis_out[0] * axis_long[2],
          axis_out[0] * axis_long[1] - axis_out[1] * axis_long[0])
    oriented_box(mb, tuple(root[k] + axis_out[k] * length * 0.5
                           for k in range(3)),
                 axis_out, axis_long, up, (length, 0.22, 0.22), role_frame)
    if panels < 1:
        return
    pitch = length / panels
    for i in range(panels):
        d = pitch * (i + 0.5)
        a = math.radians(droop * (i + 1) + jitter(2.4, seed, i))
        c, s = math.cos(a), math.sin(a)
        n = tuple(up[k] * c + axis_long[k] * s for k in range(3))
        lg = tuple(axis_long[k] * c - up[k] * s for k in range(3))
        oriented_box(mb, tuple(root[k] + axis_out[k] * d for k in range(3)),
                     axis_out, lg, n, (pitch * 0.86, span, 0.035), role_panel)
        oriented_box(mb, tuple(root[k] + axis_out[k] * d for k in range(3)),
                     axis_out, lg, n, (pitch * 0.20, span * 1.02, 0.08),
                     role_frame)


def solar_wing(mb, root, out, long_ax, boom_len, cells_x, cells_y, cell,
               role_cell, role_frame, role_boom, bend=0.0, missing=(),
               seed=0):
    """A photovoltaic wing: a boom, a mast, and a grid of cell blankets.

    THE BIGGEST SILHOUETTE FOR THE FEWEST TRIANGLES ANYWHERE ON THE ASSET. A
    blanket is a flat quad, so a wing 16 m long is two triangles per cell panel
    and reaches further off the hull than anything else on the station. That
    matters more than it sounds: a station read at 500 m is read entirely by
    its outline, and the wings are most of the outline.

    `missing` is a set of (i, j) cells that are simply not emitted, which is
    what a micrometeoroid stream and thirty years do to a blanket, and `bend`
    progressively cants the panels so a wing can be authored as folded, half
    retracted, or snapped."""
    up = (out[1] * long_ax[2] - out[2] * long_ax[1],
          out[2] * long_ax[0] - out[0] * long_ax[2],
          out[0] * long_ax[1] - out[1] * long_ax[0])
    oriented_box(mb, tuple(root[k] + out[k] * boom_len * 0.5
                           for k in range(3)),
                 out, long_ax, up, (boom_len, 0.34, 0.34), role_boom)
    base = boom_len
    for i in range(cells_x):
        a = math.radians(bend * i + jitter(1.6, seed, i, 3))
        c, s = math.cos(a), math.sin(a)
        n = tuple(up[k] * c + long_ax[k] * s for k in range(3))
        lg = tuple(long_ax[k] * c - up[k] * s for k in range(3))
        cx = base + cell * (i + 0.5)
        ctr = tuple(root[k] + out[k] * cx for k in range(3))
        oriented_box(mb, ctr, out, lg, n, (cell * 0.97, cells_y * cell + 0.10,
                                           0.05), role_frame)
        for j in range(cells_y):
            if (i, j) in missing:
                continue
            off = (j - (cells_y - 1) * 0.5) * cell
            cc = tuple(ctr[k] + lg[k] * off for k in range(3))
            oriented_box(mb, cc, out, lg, n,
                         (cell * 0.90, cell * 0.90, 0.018), role_cell)


def truss_bay(mb, p0, p1, side, role, chord=0.10, diagonals=True):
    """One bay of a four-chord lattice truss between two world points.

    A truss is the cheapest way to make a long run read as ENGINEERED rather
    than extruded, and the diagonals are what do it: four parallel chords are a
    box, and four chords with crossed braces are a structure. Axis aligned
    chords and oriented diagonals, so a bay is 6 boxes and 72 triangles."""
    d = [p1[k] - p0[k] for k in range(3)]
    ln = math.sqrt(sum(v * v for v in d)) or 1.0
    ax = tuple(v / ln for v in d)
    tmp = (0.0, 0.0, 1.0) if abs(ax[2]) < 0.9 else (1.0, 0.0, 0.0)
    u = (ax[1] * tmp[2] - ax[2] * tmp[1], ax[2] * tmp[0] - ax[0] * tmp[2],
         ax[0] * tmp[1] - ax[1] * tmp[0])
    un = math.sqrt(sum(v * v for v in u)) or 1.0
    u = tuple(v / un for v in u)
    v = (ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2],
         ax[0] * u[1] - ax[1] * u[0])
    mid = tuple((p0[k] + p1[k]) * 0.5 for k in range(3))
    h = side * 0.5
    for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        c = tuple(mid[k] + u[k] * h * su + v[k] * h * sv for k in range(3))
        oriented_box(mb, c, ax, u, v, (ln, chord, chord), role)
    if not diagonals:
        return
    for (au, av, bu, bv) in ((-1, -1, 1, 1), (1, -1, -1, 1)):
        a = tuple(p0[k] + u[k] * h * au + v[k] * h * av for k in range(3))
        b = tuple(p1[k] + u[k] * h * bu + v[k] * h * bv for k in range(3))
        dd = [b[k] - a[k] for k in range(3)]
        dl = math.sqrt(sum(t * t for t in dd)) or 1.0
        da = tuple(t / dl for t in dd)
        du = (da[1] * v[2] - da[2] * v[1], da[2] * v[0] - da[0] * v[2],
              da[0] * v[1] - da[1] * v[0])
        dn = math.sqrt(sum(t * t for t in du)) or 1.0
        du = tuple(t / dn for t in du)
        dv = (da[1] * du[2] - da[2] * du[1], da[2] * du[0] - da[0] * du[2],
              da[0] * du[1] - da[1] * du[0])
        oriented_box(mb, tuple((a[k] + b[k]) * 0.5 for k in range(3)),
                     da, du, dv, (dl, chord * 0.62, chord * 0.62), role)


def antenna(mb, base, out, length, dish_r, role_mast, role_dish, segs=8,
            tilt=0.0):
    """A mast with a parabolic dish, faked as a shallow cone of quads.

    A dish is the one round thing on a station that HAS to be round, because
    its whole silhouette is a circle and a hexagon reads as a mistake rather
    than as a budget. `segs` 8 is 8 triangles for the face plus 8 for the rim,
    which is affordable exactly once."""
    up = (0.0, 0.0, 1.0) if abs(out[2]) < 0.9 else (1.0, 0.0, 0.0)
    sd = (out[1] * up[2] - out[2] * up[1], out[2] * up[0] - out[0] * up[2],
          out[0] * up[1] - out[1] * up[0])
    sn = math.sqrt(sum(v * v for v in sd)) or 1.0
    sd = tuple(v / sn for v in sd)
    up = (sd[1] * out[2] - sd[2] * out[1], sd[2] * out[0] - sd[0] * out[2],
          sd[0] * out[1] - sd[1] * out[0])
    oriented_box(mb, tuple(base[k] + out[k] * length * 0.5 for k in range(3)),
                 out, sd, up, (length, 0.14, 0.14), role_mast)
    hub = tuple(base[k] + out[k] * length for k in range(3))
    a = math.radians(tilt)
    n = tuple(out[k] * math.cos(a) + up[k] * math.sin(a) for k in range(3))
    apex = tuple(hub[k] - n[k] * dish_r * 0.34 for k in range(3))
    e1 = tuple(sd)
    e2 = (n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2],
          n[0] * e1[1] - n[1] * e1[0])
    rim = []
    for i in range(segs):
        th = 2.0 * math.pi * i / segs
        rim.append(tuple(hub[k] + (e1[k] * math.cos(th)
                                   + e2[k] * math.sin(th)) * dish_r
                         for k in range(3)))
    for i in range(segs):
        tri(mb, (apex, rim[i], rim[(i + 1) % segs]), role_dish)
    oriented_box(mb, tuple(hub[k] + n[k] * 0.10 for k in range(3)), n, e1, e2,
                 (0.16, 0.22, 0.22), role_mast)


# ---------------------------------------------------------------------------
# The failure, authored as shape
# ---------------------------------------------------------------------------

def tear_rim(mb, axis, at, r, deg0, deg1, petals, role, centre=(0, 0, 0),
             reach=0.55, seed=0):
    """The petalled lip of a hull breach: triangles peeled outward off the rim.

    WHAT A BREACH ACTUALLY LOOKS LIKE, and it is the opposite of what a hole
    looks like. Pressurised plate does not punch cleanly; it splits and the
    strips between the splits curl OUT, so the edge of a real breach is a
    ragged crown standing proud of the hull rather than a smooth cut. That
    crown is also what makes the hole read as a hole from outside: a plain
    aperture in a smooth tube reads as a black decal, and a ring of bright lit
    petals catching the sun does not.

    Every petal's length, splay and twist come from `hashf(seed, i)`, so the
    rim is irregular and reproducible to the byte."""
    if petals < 1:
        return
    span = (deg1 - deg0) / petals
    ax, _e0, _e9 = frame(axis)
    for i in range(petals):
        d0 = deg0 + span * i
        d1 = d0 + span * (0.62 + hashf(seed, i, 1) * 0.33)
        dm = (d0 + d1) * 0.5
        ln = reach * (0.35 + hashf(seed, i, 2) * 1.0)
        lift = 0.35 + hashf(seed, i, 3) * 0.8
        a0 = at + jitter(0.20, seed, i, 4)
        base0 = point(axis, centre, a0, d0, r)
        base1 = point(axis, centre, a0, d1, r)
        rd = radial(axis, dm)
        tipa = a0 + jitter(0.55, seed, i, 5)
        tip = tuple(point(axis, centre, tipa, dm, r)[k] + rd[k] * ln * lift
                    for k in range(3))
        tri(mb, (base0, base1, tip), role)
        inner = tuple(point(axis, centre, a0 - span * 0.02, dm, r * 0.94)[k]
                      for k in range(3))
        tri(mb, (base1, base0, inner), role)
        _ = ax


def buckle(mb, shell, a0, a1, deg, arc, role, depth=0.09, seed=0):
    """A plate that has crumpled inward: one panel with four corner offsets.

    `machine_form.warped`'s idea (a four-cornered plate whose corners stand off
    by different amounts) on a hull instead of a flat face. Twelve triangles,
    the same as the flat plate it replaces, and it is the cheapest honest way
    to say a section took a load it was not designed for."""
    ax, _e0, _e9 = frame(shell.axis)
    dm = deg
    dr = shell.arc_deg(arc) * 0.5
    verts = []
    for (a, d, k) in ((a0, dm - dr, 0), (a1, dm - dr, 1), (a1, dm + dr, 2),
                      (a0, dm + dr, 3)):
        push = depth * (0.25 + hashf(seed, k) * 1.0)
        verts.append(point(shell.axis, shell.centre, a, d,
                           shell.r - shell.sign * push))
    for (a, d) in ((a0, dm - dr), (a1, dm - dr), (a1, dm + dr), (a0, dm + dr)):
        verts.append(point(shell.axis, shell.centre, a, d,
                           shell.r + shell.sign * 0.018))
    verts, faces = mf.oriented(verts, [(0, 1, 2, 3), (7, 6, 5, 4),
                                       (0, 4, 5, 1), (1, 5, 6, 2),
                                       (2, 6, 7, 3), (3, 7, 4, 0)])
    mb.add_raw(verts, faces, [False] * len(faces), role)
    _ = ax


def debris_field(mb, centre, extent, count, role, size=0.16, seed=0):
    """Small tumbling fragments still in the volume they were blown out of.

    Free asymmetry and, on a derelict, free STORY: debris that has not
    dispersed says the event was recent enough to matter and that nothing has
    tidied up since. Each fragment is one yawed box, so the cost is twelve
    triangles and there is no rotation machinery, which is exactly
    `of_lib.MeshBuilder.ring_boxes`'s argument for small axis-aligned parts."""
    for i in range(count):
        c = tuple(centre[k] + jitter(extent[k], seed, i, k) for k in range(3))
        s = size * (0.35 + hashf(seed, i, 7) * 1.3)
        u = radial("Z", hashf(seed, i, 8) * 360.0)
        v = tangent("Z", hashf(seed, i, 8) * 360.0)
        w = radial("X", hashf(seed, i, 9) * 360.0)
        oriented_box(mb, c, u, v, w, (s, s * 0.72, s * 0.45), role)


def insulation(mb, shell, a0, a1, deg, arc, strips, role, seed=0):
    """Torn multi-layer insulation hanging off a damaged section.

    Single quads, one-sided, on a double-sided role. MLI is a foil blanket a
    few tenths of a millimetre thick, so a box would be a lie about its
    thickness AND six times the price. The strips splay by hash, which is what
    makes a repaired-looking tear look like a tear."""
    if strips < 1:
        return
    step = (a1 - a0) / strips
    for i in range(strips):
        aa = a0 + step * i
        dw = shell.arc_deg(arc) * (0.35 + hashf(seed, i) * 0.6)
        drop = 0.25 + hashf(seed, i, 2) * 0.85
        p0 = shell.at(aa, deg - dw)
        p1 = shell.at(aa + step * 0.7, deg - dw * 0.4)
        p2 = shell.at(aa + step * 0.7 + jitter(0.3, seed, i, 3), deg + dw * 0.6,
                      drop)
        p3 = shell.at(aa + jitter(0.2, seed, i, 4), deg + dw * 0.2,
                      drop * 0.55)
        quad(mb, (p0, p1, p2, p3), role)


def scorch_ribs(mb, shell, a0, a1, deg, arc, n, role, seed=0):
    """Exposed frames and stringers where the skin has gone.

    A hole with nothing behind it is a decal. A hole with the ribs of the
    structure visible through it is a hole, and it costs one thin box per rib.
    This is the interior of a breach seen from outside and the exterior of one
    seen from inside, which is why it is one call used from both."""
    if n < 1:
        return
    for i in range(n):
        t = (i + 0.5) / n
        shell.part(mb, 0.09, arc * (0.55 + hashf(seed, i) * 0.5),
                   a0 + (a1 - a0) * t, deg + jitter(3.0, seed, i, 2),
                   "duct", role)
