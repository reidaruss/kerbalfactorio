"""
machine_form.py - the vocabulary a factory MACHINE is detailed with.

Not a build script. Imported by build_assembler.py, build_smelter.py,
build_miner.py and build_box.py, plus station_form.py which extends it.

RN-1551 ADDED build_box.py TO THAT SENTENCE AND DELIBERATELY DID NOT ADD THE
BELT, and the belt is the more interesting half. The layer table below is in
ABSOLUTE METRES and every height in it was derived against a 4 m to 8 m
machine: a cable tray stands 74 mm proud and a housing 281 mm. A belt tile is
1.00 x 1.00 x 0.30 with a 0.10 m rail, so a `tray` on its rail inner face
stands three quarters of the rail's own width off it and a `housing` is
approaching the tile's full height. The vocabulary does not scale down, its
heights are properties of the TYPE rather than parameters (see (b) below), and
that is exactly what makes it safe on the big machines; the honest consequence
is that the belt is detailed with hand-authored boxes in its own file and says
so there. Adding the name here without the import is the defect the paragraph
below this one is about, and so is adding the import to make a name true.

**THAT LIST IS THE SHIPPED TRUTH AND IT IS DELIBERATELY SHORT.** It read
"build_assembler.py, build_smelter.py, build_miner.py, build_box.py and the
rest of the machine set" from the day this module was written, when only the
first two imported it: it described the intent and was read as a description
of the code, which is how a vocabulary comes to be built for thirteen machines
and applied to two. RN-1103 took the miner and corrected the sentence in the
same commit. **The eight machines still not on this list are box, generator,
power pole, inserter, primitive furnace, survival smelter, belt tile and belt
curve, and none of them has had a pass under docs/web/ART-DIRECTION.md.**
Anyone adding a name here: add it after the import exists, not before.

WHY IT IS A NEW MODULE AND NOT AN EXTENSION OF of_lib.py. `of_lib` is shared
with every Blender lane in this project and every one of the 51 shipped assets
reads it; this vocabulary is about hard-surface INDUSTRIAL detail and has no
business being visible to a tree or a boulder. `rock_form.py` was split out of
`harvest_common.py` for the same reason at RN-241 and the split has held.

WHAT "DETAILED AND COMPLEX" MEANS FOR MACHINERY, and it is not what it means
for a rock (docs/web/ART-DIRECTION.md). A rock is detailed by FRACTURE: a
family of break surfaces at five scales. A machine is detailed by ASSEMBLY. It
is made of parts that were bolted, welded, bracketed and hosed together by
somebody, and every one of those operations leaves a visible joint. The five
things this module exists to buy, in the order they pay:

  1. SEAMS AND PLATING. A 7.2 m panel is not one sheet. Straps between plates
     cost one box for two visible faces, because a strap that spans the whole
     body shows on the face it enters AND the face it leaves.
  2. GREEBLES WITH A REASON. A bolt head, a hinge, a latch, a louvre, a cable
     tray, a junction box, a gauge, a placard. Every one of them is a thing
     that does a job, so the eye reads the machine as built rather than as
     decorated.
  3. WEAR WHERE A MACHINE WOULD WEAR. Kick plates at the base, bent at the
     corner a loader hits. Wear is authored as GEOMETRY here on purpose: this
     lane does not own albedo, roughness or colour, and a dent is a fact about
     the shape whether or not anything is painted on it.
  4. ASYMMETRY AND FUNCTION. An intake side that differs from an exhaust side,
     a maintenance hatch on one face only, a ladder where a person would climb.
  5. DEPTH AT THE SILHOUETTE. Brackets, eaves, canted panels, protruding
     motors, railings with posts. The outline must stop being a rectangle.

--------------------------------------------------------------------------
THE COPLANAR RULE, AND WHY IT IS STRUCTURAL RATHER THAN CAREFUL
--------------------------------------------------------------------------
`check_coplanar.py` holds assembler, box, smelter and miner at ZERO by leaving
them out of its allowance table. Adding greebles is exactly how coplanar pairs
get created, and the catalogued root cause is two parts dimensioned off the
same landmark where the landmark is a WIDTH COPIED rather than DERIVED.

Two properties make that structurally impossible here rather than a thing an
author has to remember:

  (a) NOTHING IS EVER PLACED ON A FACE. `Face.part` puts a part's outer surface
      at `plane + proud` and its BACK at `plane - proud * EMBED`, so the back
      face is always buried inside the panel it is mounted on and can never be
      coplanar with anything. There is no call in this module that can put a
      part flush.

  (b) THE PROUD HEIGHT IS A PROPERTY OF THE GREEBLE TYPE, NOT OF THE CALL SITE.
      `LAYER` below gives every type its own height, and no two types share
      one. So two parts can only land on a common outer plane if they are the
      SAME type, and a type has one role, and check_coplanar deliberately does
      not count a same-material overlap because it is invisible by
      construction. A caller cannot re-create the defect by passing a number,
      because the number is not a parameter.

The costs of (b) are worth stating: the layers are 1 mm to 5 cm apart, so a
type cannot be nudged for looks without moving every use of it, and adding a
type means adding a row here rather than typing a height. Both are the point.

--------------------------------------------------------------------------
THE FOOTPRINT IS A HARD EDGE AND THIS MODULE ASSERTS IT
--------------------------------------------------------------------------
A machine's declared `dims_xyz_m` is sim-load-bearing: `FactorySnap.stepsFor`
is `ceil((fa + fb) / 2)`, so the mating distance IS the minimum clash-free
distance and it is computed from the declared box. `Face(..., limit=)` takes
the coordinate nothing may cross and every `part` call checks its own outer
plane against it, raising with the measured overshoot in metres. A greeble that
would grow the footprint is a BUILD FAILURE BY NAME, not something the
validator finds afterwards in the shipped bytes.
"""

import math


# --- the layer table -------------------------------------------------------
# metres proud of the mounting plane, per greeble TYPE. See property (b) above:
# these are deliberately all different, and that is what makes a same-plane
# collision imply a same-material one.
#
# Ordered smallest to largest so the list reads as a section through a panel:
# a seam is nearly flush, a bolt head stands off a strap, a tray stands off the
# panel, a motor hangs off the machine.
LAYER = {
    "scribe":   0.006,   # a shallow scribed panel line
    # RN-1543. TWO ROWS FOR THE TWO HALVES OF A WEAR MARK, added here rather
    # than borrowed, which is what the note above this table asks for. The
    # ruin's contract records that a mark reads as SIGNAGE unless it is two
    # overlapping boxes on two layers, and build_research_station.py reproduced
    # that by parenting the mark on `scribe` and its satellite on the layer
    # below - which is `scribe` itself, so both halves landed on one plane in
    # two different roles. That is the exact failure property (b) above exists
    # to make impossible, defeated by reusing a type that already had a role:
    # check_coplanar.py measured 8 same-facing pairs from it. A mark now has
    # its own two types and nothing else in the project mounts on them.
    "grime":    0.009,   # the shallow, offset half of a two-part wear mark
    "seam":     0.013,   # the strap between two plates
    "stain":    0.016,   # the main half of a wear mark; its satellite is grime
    "shim":     0.019,   # a packing plate under something else
    "plate":    0.024,   # a bolted-on plate: placards, patches, name plates
    "kick":     0.031,   # the rubbing strip at the foot of a machine
    "boss":     0.037,   # a raised pad a fitting is mounted on
    "bolt":     0.044,   # a bolt or rivet head
    "hinge":    0.052,   # a hinge knuckle
    "clip":     0.061,   # a P-clip holding a conduit to a panel
    "tray":     0.074,   # a cable tray or conduit run
    "latch":    0.086,   # a latch handle
    "grille":   0.098,   # a louvre bank's outer blade
    "coaming":  0.108,   # the raised frame that MAKES a recess (see Face.coaming)
    "rung":     0.117,   # a ladder rung
    "stringer": 0.139,   # a ladder side rail
    "gauge":    0.163,   # a dial standing off its boss
    "duct":     0.196,   # a duct or hose running along a face
    "bracket":  0.232,   # a gusset under an overhang
    "housing":  0.281,   # a bolted-on housing: fans, motors, junction boxes
}

# How far a part's BACK sits inside the plane it is mounted on, as a fraction
# of how far its front stands proud. 0.55 rather than a fixed millimetre count
# so the burial scales with the part: a 6 mm scribe is buried 3.3 mm and a
# 281 mm housing is buried 155 mm, and neither has to be thought about.
EMBED = 0.55


def layer(name):
    """The proud height of a greeble type, by name, or raise saying which."""
    if name not in LAYER:
        raise KeyError("unknown greeble layer %r (see machine_form.LAYER: %s)"
                       % (name, ", ".join(sorted(LAYER))))
    return LAYER[name]


def _signed_volume(verts, faces):
    """Six times the signed volume of a closed polyhedron, fan-triangulated."""
    total = 0.0
    for f in faces:
        a = verts[f[0]]
        for i in range(1, len(f) - 1):
            b, c = verts[f[i]], verts[f[i + 1]]
            total += (a[0] * (b[1] * c[2] - b[2] * c[1])
                      - a[1] * (b[0] * c[2] - b[2] * c[0])
                      + a[2] * (b[0] * c[1] - b[1] * c[0]))
    return total


def oriented(verts, faces):
    """`faces` rewound so every one of them points OUT of the closed solid.

    WHY THIS IS A FUNCTION AND NOT A RULE AN AUTHOR FOLLOWS. Every role in the
    palette except the double-sided few is backface culled (of_lib.DOUBLE_SIDED
    exists for exactly that reason), so a face wound the wrong way is INVISIBLE
    from outside and visible from inside, which reads as a hole in the machine.
    Getting the winding right by hand needs a different answer per axis and per
    sign: a corner list that is counter-clockwise seen from +X is clockwise seen
    from +Y, because the in-plane basis this module uses is (Y, Z) on an X face
    and (X, Z) on a Y face, and those two have opposite handedness against
    their own normal.

    Six axis-and-sign cases, each of which is a coin flip, is six chances to
    ship an invisible face on one side of one machine. The signed volume of the
    closed solid is ONE test that cannot be wrong: if it comes out negative the
    solid is inside out, and reversing every face fixes it whatever the face
    was supposed to be."""
    verts = list(verts)
    faces = [tuple(f) for f in faces]
    if _signed_volume(verts, faces) < 0.0:
        faces = [tuple(reversed(f)) for f in faces]
    return verts, faces


class Face:
    """One flat, outward-facing side of a machine, and the frame greebles are
    placed in.

    axis   "X", "Y" or "Z": the world axis the outward normal runs along.
    sign   +1 or -1: which way along that axis is out.
    plane  the coordinate of the face itself.
    limit  the coordinate nothing mounted on this face may cross. For a side
           face that is the footprint half-width; for a roof it is the declared
           height. None means unbounded, which is correct only for a face that
           looks into a recess.

    IN-PLANE COORDINATES. `u` runs across the face and `v` runs up it, and the
    mapping to world axes is fixed per face so one description of a detail band
    serves +Y, -Y, +X and -X without four transcriptions of the same numbers
    (build_assembler.py's `_put` made this argument for its port slots first;
    this is that idea with the outward offset and the limit folded in).

        X face   u = world Y,  v = world Z
        Y face   u = world X,  v = world Z
        Z face   u = world X,  v = world Y

    The u axis is NOT mirrored for the negative faces. A greeble at u = +1 on
    the -Y face is at world x = +1, the same side of the machine as u = +1 on
    the +Y face, which is what an author means by "on the right".
    """

    __slots__ = ("axis", "sign", "plane", "limit", "name")

    def __init__(self, axis, sign, plane, limit=None, name=None):
        if axis not in ("X", "Y", "Z"):
            raise ValueError("axis must be X, Y or Z (got %r)" % axis)
        if sign not in (-1, 1):
            raise ValueError("sign must be -1 or 1 (got %r)" % sign)
        self.axis = axis
        self.sign = sign
        self.plane = float(plane)
        self.limit = None if limit is None else float(limit)
        self.name = name or ("%s%s" % ("+-"[sign < 0], axis))

    # -- geometry -----------------------------------------------------------

    def out(self, dist):
        """The world coordinate `dist` metres outward from the face."""
        return self.plane + self.sign * dist

    def _check(self, front, what):
        if self.limit is None:
            return
        over = (front - self.limit) if self.sign > 0 else (self.limit - front)
        if over > 0.0:
            # RN-1103: `what` was interpolated TWICE, so the message read "a
            # bracket bracket reaching 0.34: a bracket bracket reaching 0.34
            # reaches ...". Cosmetic, and it is fixed because the whole value
            # of a build-time refusal is that the sentence is readable at 2am.
            raise ValueError(
                "%s reaches %.4f past the hard edge at %.4f on face %s. "
                "The footprint is sim-load-bearing (FactorySnap.stepsFor "
                "derives the mating distance from the declared box), so the "
                "DETAIL has to move, not the edge."
                % (what, over, self.limit, self.name))

    def _loc(self, u, v, along):
        if self.axis == "X":
            return (along, u, v)
        if self.axis == "Y":
            return (u, along, v)
        return (u, v, along)

    def _size(self, du, dv, thick):
        if self.axis == "X":
            return (thick, du, dv)
        if self.axis == "Y":
            return (du, thick, dv)
        return (du, dv, thick)

    def part(self, mb, du, dv, u, v, kind, role, embed=EMBED):
        """One box mounted on this face, standing `LAYER[kind]` proud of it.

        du x dv is the size IN the face; the thickness through the face is
        derived from the layer so a caller cannot make a part flush. Returns
        the outer coordinate, which is what a caller stacking a second part on
        top of this one needs."""
        p = layer(kind)
        back = -p * embed
        thick = p - back
        front = self.out(p)
        self._check(front, "a %s part %.2f x %.2f at (%.2f, %.2f)"
                    % (kind, du, dv, u, v))
        mb.box(self._size(du, dv, thick),
               self._loc(u, v, self.out((p + back) * 0.5)), role)
        return front

    def coaming(self, mb, du, dv, u, v, role, rail=0.075, kind="coaming"):
        """A raised frame around a region of the face: THE ADDITIVE WAY TO MAKE
        A RECESS, and the only way available here.

        NOTHING IN THIS PROJECT CUTS GEOMETRY. Every machine is a pile of
        intersecting solids exported as-is, with no boolean and no modifier
        that removes material, so "recess a hatch into the panel" is not an
        operation that exists: a box placed inside a solid body is simply
        invisible. The first draft of this module had a `sink()` that did
        exactly that, and it would have produced four hatches nobody could see.

        A machine gets a recess the way `build_assembler._mouth` already gets
        one: by standing a FRAME proud of the surface, so the surface inside
        the frame is lower than the frame around it. That is also what a real
        coaming is. Everything mounted inside then uses the plain face, and
        because the coaming is on the deepest layer in the table below the
        rung, whatever sits inside it is genuinely behind the frame's mouth."""
        for s in (-1, 1):
            self.part(mb, rail, dv + 2.0 * rail, u + s * (du + rail) * 0.5, v,
                      kind, role)
            self.part(mb, du, rail, u, v + s * (dv + rail) * 0.5, kind, role)

    def warped(self, mb, corners, kind, role, embed=EMBED):
        """A four-cornered plate whose corners stand off the face by DIFFERENT
        amounts: a canted panel, a bent kick plate, a sloped fairing.

        `corners` is [(u, v, scale), ...] in the order lower-left, lower-right,
        upper-right, upper-left, where `scale` multiplies the layer height. So
        [(u0, v0, 0.35), (u1, v0, 0.35), (u1, v1, 1.0), (u0, v1, 1.0)] is a
        plate leaning out as it rises, and dropping the scale on ONE corner is
        a dent.

        THIS IS WHERE WEAR LIVES. A machine that has been in service has been
        hit, and the cheapest honest way to say so without owning a single
        colour value is to bend the plate that took the hit. Twelve triangles,
        same as the box it replaces."""
        p = layer(kind)
        back = -p * embed
        verts, front_max = [], -1e30
        for (u, v, s) in corners:
            d = p * float(s)
            front_max = max(front_max, d)
            verts.append(self._loc(u, v, self.out(d)))
        for (u, v, _s) in corners:
            verts.append(self._loc(u, v, self.out(back)))
        self._check(self.out(front_max), "a warped %s plate" % kind)
        verts, faces = oriented(verts, [(0, 1, 2, 3), (7, 6, 5, 4),
                                        (0, 4, 5, 1), (1, 5, 6, 2),
                                        (2, 6, 7, 3), (3, 7, 4, 0)])
        mb.add_raw(verts, faces, [False] * len(faces), role)
        return self.out(front_max)

    def wedge(self, mb, u, du, v_top, reach, drop, kind, role):
        """A triangular gusset under an overhang: the bracket that carries an
        eave, a shelf or a canopy.

        Its vertical edge lies on the face, its horizontal edge runs `reach`
        out along the top, and the hypotenuse falls `drop` metres. `du` is its
        thickness across the face. Two triangles and three quads: eight
        triangles for a real piece of structure and a real notch in the
        silhouette."""
        self._check(self.out(reach), "a %s bracket reaching %.2f" % (kind, reach))
        back = -layer(kind) * EMBED
        tri = [(0.0, 0.0), (reach, 0.0), (0.0, -drop)]
        verts = []
        for s in (-0.5, 0.5):
            for (o, dv) in tri:
                verts.append(self._loc(u + du * s, v_top + dv,
                                       self.out(o + back)))
        verts, faces = oriented(verts, [(0, 1, 2), (5, 4, 3),
                                        (0, 3, 4, 1), (1, 4, 5, 2),
                                        (2, 5, 3, 0)])
        mb.add_raw(verts, faces, [False] * len(faces), role)


# ---------------------------------------------------------------------------
# The greebles. Every one of them takes a Face and places itself on it; none of
# them takes a proud height, because that is the layer's job.
# ---------------------------------------------------------------------------

def seam_v(mb, face, us, v0, v1, width, role, kind="seam"):
    """Vertical plate seams: one strap per entry in `us`, from v0 to v1.

    Real plating runs in courses with staggered joints, so a caller passes the
    positions rather than a count and a pitch. Cost is 12 triangles per strap
    and it turns one 7 m sheet into a wall of plates."""
    for u in us:
        face.part(mb, width, v1 - v0, u, (v0 + v1) * 0.5, kind, role)


def seam_h(mb, face, vs, u0, u1, height, role, kind="seam"):
    """Horizontal plate courses, the other half of `seam_v`."""
    for v in vs:
        face.part(mb, u1 - u0, height, (u0 + u1) * 0.5, v, kind, role)


def through_seam(mb, axis, half, us, v0, v1, width, role, kind="seam"):
    """Plate seams that pass THROUGH the body and show on BOTH opposite faces.

    THE CHEAPEST DETAIL IN THIS FILE AND THE ONE WITH THE BEST RATIO. A strap
    long enough to span the machine stands proud of the face it enters and the
    face it leaves, so twelve triangles buy two visible seams instead of one,
    and the two can never drift out of line with each other because they are
    one box. build_smelter.py and build_box.py already use exactly this trick
    for their body ribs; this is that idea named and generalised.

    `axis` is the axis the strap SPANS ("X" or "Y"), `half` is the body's
    half-width along it, and `us` are positions along the other horizontal
    axis. The strap runs from v0 to v1 in Z."""
    p = layer(kind)
    span = 2.0 * (half + p)
    for u in us:
        if axis == "Y":
            size = (width, span, v1 - v0)
            loc = (u, 0.0, (v0 + v1) * 0.5)
        elif axis == "X":
            size = (span, width, v1 - v0)
            loc = (0.0, u, (v0 + v1) * 0.5)
        else:
            raise ValueError("through_seam spans X or Y, not %r" % axis)
        mb.box(size, loc, role)


def bolts(mb, face, us, vs, size, role, kind="bolt"):
    """A grid of bolt or rivet heads at every (u, v) in the two lists.

    Twelve triangles each, which makes this the most expensive detail per unit
    of area in the vocabulary, so it is used where a bolt is STRUCTURAL and
    visible: the corners of a bolted-on plate, the flange of a housing, the
    frame of a port a player stands in front of. A field of bolts across a
    blank panel is the same triangles spent where nobody looks."""
    for u in us:
        for v in vs:
            face.part(mb, size, size, u, v, kind, role)


def bolt_run(mb, face, u0, u1, v, n, size, role, kind="bolt"):
    """`n` bolt heads evenly spaced along a line, ends INCLUDED.

    Ends included because the two that matter most are the ones at the corners
    of the thing being bolted down, and a caller who wanted interior-only
    spacing can pass the interior span."""
    if n < 1:
        return
    for i in range(n):
        t = 0.0 if n == 1 else i / float(n - 1)
        face.part(mb, size, size, u0 + (u1 - u0) * t, v, kind, role)


def louvre(mb, face, u, v, du, dv, blades, role_frame, role_blade,
           role_back=None):
    """A vent bank: a coaming, a dark backing sheet, and blades inside it.

    A vent is the one greeble that is unambiguously FUNCTIONAL at a glance, and
    the frame is what makes it read as a hole rather than as stripes. The
    backing sheet is the same argument the port slots make with their throat
    plates: an opening needs a visible bottom or it is a pattern."""
    face.coaming(mb, du, dv, u, v, role_frame)
    face.part(mb, du, dv, u, v, "scribe", role_back or role_frame)
    if blades < 1:
        return
    pitch = dv / (blades + 0.6)
    for i in range(blades):
        vb = v + dv * 0.5 - pitch * (i + 0.8)
        face.part(mb, du - 0.06, pitch * 0.52, u, vb, "grille", role_blade)


def hatch(mb, face, u, v, du, dv, role_panel, role_metal, role_mark,
          hinge_side=-1):
    """A bolted maintenance hatch: a coaming, a panel standing back inside it,
    two hinge knuckles on one side, a latch handle on the other, and a placard.

    THE HINGE SIDE IS THE ASYMMETRY. A machine with the same hatch on every
    face is still a symmetric object; a machine with one hatch, hinged on one
    side, has a front, a back and a service side, which is what makes it read
    as a thing somebody maintains."""
    face.coaming(mb, du, dv, u, v, role_metal, rail=0.065)
    face.part(mb, du, dv, u, v, "plate", role_panel)
    hu = u + hinge_side * (du * 0.5 - 0.045)
    for s in (-1, 1):
        face.part(mb, 0.075, dv * 0.20, hu, v + s * dv * 0.30, "hinge",
                  role_metal)
    lu = u - hinge_side * (du * 0.5 - 0.075)
    face.part(mb, 0.06, 0.22, lu, v, "latch", role_metal)
    face.part(mb, du * 0.30, 0.08, u, v + dv * 0.5 - 0.13, "boss", role_mark)
    bolt_run(mb, face, u - du * 0.5 + 0.07, u + du * 0.5 - 0.07,
             v - dv * 0.5 + 0.07, 3, 0.045, role_metal)


def ladder(mb, face, u, v0, v1, width, rungs, role):
    """Two stringers and `rungs` rungs, plus a grab extension above the top.

    THE SINGLE BEST TRIANGLES IN THIS MODULE and the reason is scale rather
    than detail: a ladder is the only greeble whose size a player already
    knows. It says the machine is 4 m tall more loudly than the machine being
    4 m tall does, and it puts a hard vertical notch in a silhouette that is
    otherwise a rectangle. The stringers stand proud of the rungs, so a rung's
    end faces are buried in a stringer and no two of the ladder's own parts
    share a plane."""
    for s in (-1, 1):
        face.part(mb, 0.055, v1 - v0 + 0.44, u + s * width * 0.5,
                  (v0 + v1) * 0.5 + 0.22, "stringer", role)
    if rungs < 1:
        return
    pitch = (v1 - v0) / float(rungs)
    for i in range(rungs):
        face.part(mb, width - 0.03, 0.045, u, v0 + pitch * (i + 0.5), "rung",
                  role)


def tray(mb, face, u, v0, v1, width, clips, role_tray, role_clip):
    """A cable tray or conduit run climbing a face, held by P-clips.

    The clips are on their own layer BELOW the tray, so a clip's front face is
    inside the tray it holds rather than on it, which is both correct (a clip
    wraps a conduit) and the reason this cannot make a coplanar pair."""
    face.part(mb, width, v1 - v0, u, (v0 + v1) * 0.5, "tray", role_tray)
    if clips < 1:
        return
    pitch = (v1 - v0) / float(clips)
    for i in range(clips):
        face.part(mb, width + 0.05, 0.05, u, v0 + pitch * (i + 0.5), "clip",
                  role_clip)


def tray_h(mb, face, u0, u1, v, height, clips, role_tray, role_clip):
    """The same run laid horizontally along a face."""
    face.part(mb, u1 - u0, height, (u0 + u1) * 0.5, v, "tray", role_tray)
    if clips < 1:
        return
    pitch = (u1 - u0) / float(clips)
    for i in range(clips):
        face.part(mb, 0.05, height + 0.05, u0 + pitch * (i + 0.5), v, "clip",
                  role_clip)


def junction(mb, face, u, v, du, dv, role_body, role_lid):
    """A junction box: a body, a proud lid with a lip, and four lid bolts."""
    face.part(mb, du, dv, u, v, "housing", role_body)
    inner = Face(face.axis, face.sign, face.out(layer("housing")),
                 limit=face.limit, name=face.name + " junction")
    inner.part(mb, du - 0.05, dv - 0.05, u, v, "plate", role_lid)
    bolts(mb, inner, (u - du * 0.5 + 0.05, u + du * 0.5 - 0.05),
          (v - dv * 0.5 + 0.05, v + dv * 0.5 - 0.05), 0.038, role_body)


def gauge_cluster(mb, face, u, v, n, role_body, role_dial):
    """`n` dials on one mounting boss, at eye height where a reader would be.

    Placed as a CLUSTER rather than as scattered dials because instruments on a
    real machine are grouped where somebody stands to read them, and a cluster
    also puts several small round shapes in one place, which is where they read
    as instruments instead of as bumps."""
    span = 0.13 * n + 0.07
    face.part(mb, span, 0.20, u, v, "boss", role_body)
    boss = Face(face.axis, face.sign, face.out(layer("boss")),
                limit=face.limit, name=face.name + " gauge boss")
    for i in range(n):
        du = span - 0.07
        cu = u - du * 0.5 + du * ((i + 0.5) / n if n > 1 else 0.5)
        boss.part(mb, 0.095, 0.095, cu, v, "gauge", role_dial)


def placard(mb, face, u, v, du, dv, role, tilt=0.30):
    """A small canted plate: a rating plate, a warning notice, a serial tag.

    Canted rather than flat, and the tilt is the whole point. A flat plate on a
    flat panel is one more rectangle in a machine already made of them; a plate
    that leans reads as a separate object, catches a different amount of light
    from every face around it, and does it for the same twelve triangles."""
    face.warped(mb, [(u - du * 0.5, v - dv * 0.5, 1.0),
                     (u + du * 0.5, v - dv * 0.5, 1.0),
                     (u + du * 0.5, v + dv * 0.5, 1.0 + tilt * 4.0),
                     (u - du * 0.5, v + dv * 0.5, 1.0 + tilt * 4.0)],
                "plate", role)


def kick_plate(mb, face, u0, u1, v_top, height, role, dent=0.0, dent_at=0.0):
    """The rubbing strip along the foot of a machine, optionally KICKED IN.

    `dent` is how far the bottom edge is pushed back toward the panel, as a
    fraction of the plate's own stand-off, and `dent_at` is -1, 0 or +1 for
    which end took the hit. dent = 0 is a plain strip.

    WEAR AS GEOMETRY, WHICH IS THE ONLY KIND THIS LANE OWNS. Look development
    owns every albedo and roughness value in the game, so a scuff cannot be
    authored here as a mark. It can be authored as a SHAPE, and a shape is
    arguably the better half of it anyway: paint chips off a dent because
    something hit it, and the dent is the cause."""
    d = max(0.0, min(1.0, dent))
    lo_l = 1.0 - d * (0.35 if dent_at > 0 else 1.0)
    lo_r = 1.0 - d * (0.35 if dent_at < 0 else 1.0)
    face.warped(mb, [(u0, v_top - height, lo_l), (u1, v_top - height, lo_r),
                     (u1, v_top, 1.0), (u0, v_top, 1.0)], "kick", role)


def eave(mb, face, u0, u1, v, reach, brackets, role_lip, role_bracket,
         thickness=0.10, drop=0.34):
    """An overhanging lip along a face with gusset brackets under it.

    The one detail in this module that is bought purely for the OUTLINE. A
    machine whose walls run straight from the ground to the roof is a
    rectangle from every bearing; a lip that stands out and a row of brackets
    that fall away under it break the vertical at one height and cast a hard
    shadow across everything below."""
    face.part(mb, u1 - u0, thickness, (u0 + u1) * 0.5, v, "housing", role_lip)
    lip = Face(face.axis, face.sign, face.out(layer("housing")),
               limit=face.limit, name=face.name + " eave")
    lip.part(mb, u1 - u0, thickness * 0.55, (u0 + u1) * 0.5,
             v + thickness * 0.30, "shim", role_lip)
    if brackets < 1:
        return
    for i in range(brackets):
        t = (i + 0.5) / brackets
        face.wedge(mb, u0 + (u1 - u0) * t, 0.075, v - thickness * 0.5,
                   reach, drop, "bracket", role_bracket)


def railing(mb, posts, x0, x1, y, z0, height, role, along="X"):
    """A real railing: posts, a top rail, a mid rail and a toe board.

    Not a Face greeble, because a railing stands ON a deck rather than being
    mounted to a wall. It replaces the single box a roof edge usually gets, and
    the difference at range is that a box is a wall and a railing is a railing:
    the sky shows through it, so the roofline stops being solid."""
    span = x1 - x0
    if along == "X":
        size_rail = (span, 0.045, 0.045)
        size_toe = (span, 0.030, 0.085)
    else:
        size_rail = (0.045, span, 0.045)
        size_toe = (0.030, span, 0.085)
    mid = (x0 + x1) * 0.5
    ctr = (mid, y) if along == "X" else (y, mid)
    mb.box(size_rail, (ctr[0], ctr[1], z0 + height), role)
    mb.box(size_rail, (ctr[0], ctr[1], z0 + height * 0.54), role)
    mb.box(size_toe, (ctr[0], ctr[1], z0 + 0.0425), role)
    for i in range(posts):
        t = 0.0 if posts == 1 else i / float(posts - 1)
        p = x0 + span * t
        loc = (p, y) if along == "X" else (y, p)
        mb.box((0.055, 0.055, height + 0.03), (loc[0], loc[1],
                                               z0 + (height + 0.03) * 0.5),
               role)


def finned_drum(mb, radius, length, loc, axis, fins, role_body, role_fin,
                segments=8, fin_span=2.16):
    """A motor or blower: a drum with cooling fins standing off it.

    The fins are square PLATES rather than rings, which is both what an air
    cooled casing looks like and far cheaper than a ring: a ring at n segments
    is 2n triangles and a plate is 12 however wide the drum is.

    `fin_span` is the fin's width as a multiple of the RADIUS and is a
    parameter rather than a constant because it is the thing that decides
    whether the drum fits: a drum mounted on a face reaches out by its radius
    but its fins reach out by half their span, so a fin span of 2.16 makes the
    fins the widest part of the assembly by 8 percent. On a machine with 0.40 m
    of clearance to a hard footprint edge that 8 percent is the difference
    between fitting and a build failure, and the number that has to move is
    this one and not the radius."""
    mb.cylinder(radius, length, loc, axis=axis, segments=segments,
                role=role_body)
    if fins < 1:
        return
    pitch = length / (fins + 0.8)
    for i in range(fins):
        off = -length * 0.5 + pitch * (i + 0.9)
        c = list(loc)
        idx = {"X": 0, "Y": 1, "Z": 2}[axis]
        c[idx] += off
        size = [radius * fin_span] * 3
        size[idx] = pitch * 0.34
        mb.box(tuple(size), tuple(c), role_fin)


def pipe_run(mb, points, width, role, elbow_role=None):
    """An axis-aligned pipe or duct through a list of world points, with a
    cube at every corner so the joint is a fitting rather than a mitre.

    Boxes and not cylinders, deliberately. A 6-sided tube is 20 triangles and a
    box is 12, and at the sizes a machine's plumbing is actually drawn the
    difference between a hexagonal pipe and a square duct is invisible while
    the difference in count is 40 percent. `finned_drum` is where round is
    worth paying for, because a drum is large and reads as a machined part."""
    elbow_role = elbow_role or role
    for a, b in zip(points, points[1:]):
        d = [b[k] - a[k] for k in range(3)]
        run = max(range(3), key=lambda k: abs(d[k]))
        if abs(d[run]) < 1e-9:
            continue
        size = [width, width, width]
        size[run] = abs(d[run])
        mb.box(tuple(size), tuple((a[k] + b[k]) * 0.5 for k in range(3)), role)
    for p in points[1:-1]:
        mb.box((width * 1.28, width * 1.28, width * 1.28), tuple(p),
               elbow_role)


def stack(mb, x, y, z0, z1, radius, role_body, role_cap, segments=6):
    """An exhaust stack with a flared foot and a rain cap.

    The cap is WIDER than the tube and the foot is wider still, so the stack
    has three diameters over its length instead of one, and neither end of the
    tube leaves a face on a plane the thing it meets also occupies."""
    mb.cylinder(radius * 1.42, (z1 - z0) * 0.10, (x, y, z0 + (z1 - z0) * 0.04),
                axis="Z", segments=segments, role=role_cap)
    mb.cylinder(radius, (z1 - z0) * 0.94, (x, y, (z0 + z1) * 0.5 + 0.01),
                axis="Z", segments=segments, role=role_body)
    mb.frustum(radius * 1.34, radius * 0.92, (z1 - z0) * 0.11,
               (x, y, z1 - (z1 - z0) * 0.055), axis="Z", segments=segments,
               role=role_cap)


def step_tread(mb, face, u, v, width, role, base=0.0):
    """A step at the foot of a ladder: a tread on two risers standing on
    whatever surface is at `base`.

    A ladder whose bottom rung is a metre off the ground is a ladder nobody can
    reach, and a machine detailed for a person has to be reachable by one. This
    is the cheapest possible statement that somebody climbs this thing.

    `base` is a parameter and not zero, because the surface a step stands on is
    a plinth top on every machine in this set and assuming the ground plane
    would hang the risers in the air by exactly the plinth height. That is the
    same class of error as `sink` in a scatter pile: an offset assumed rather
    than passed."""
    face.part(mb, width, 0.055, u, v, "duct", role)
    for s in (-1, 1):
        face.part(mb, 0.06, max(0.04, v - base + 0.02),
                  u + s * (width * 0.5 - 0.05),
                  (base + v) * 0.5 + 0.01, "bracket", role)


def arc_ring(mb, radius, thickness, z, segs, role, cx=0.0, cy=0.0):
    """A flat ring lying in the XY plane: a flange, a collar, a rim.

    Two arc bands rather than a torus, because everything else in this project
    is authored from world-axis primitives and an arc band is the primitive
    of_lib already has for a swept annulus."""
    for a0 in (0.0, 180.0):
        mb.arc_band(max(1e-4, radius - thickness * 0.5),
                    radius + thickness * 0.5, thickness, (cx, cy, z),
                    a0_deg=a0, a1_deg=a0 + 180.0, segments=max(2, segs // 2),
                    role=role)


def guard_cage(mb, radius, z0, z1, bars, role_bar, role_hoop, cx=0.0, cy=0.0,
               bar=0.06, hoop=0.085, segs=12):
    """A bar guard around a rotating part: `bars` uprights on a circle, held by
    two hoops.

    RN-1552. THE ONE THING IN THIS VOCABULARY THAT IS ABOUT SAFETY RATHER THAN
    ABOUT ASSEMBLY, and D-020's bar is what asks for it. Space Engineers'
    machines read as serviceable because every part that MOVES is behind
    something: a rotor has a cage, a belt nip has a plate over it, a fan has a
    grille. This project's machines had exposed rotating columns and an
    unguarded turret, and a guard is the single cheapest thing that says a
    person works near this and somebody thought about it.

    IT IS ALSO THE BEST SILHOUETTE VALUE IN THE FILE AFTER THE RAILING, and
    for the railing's exact reason: the sky shows THROUGH it. A cage is a
    circle of thin verticals, so at range it is a soft vertical band that
    breaks a solid outline without adding a solid, and up close it is the
    thing that makes the column behind it read as dangerous.

    THE HOOPS ARE WIDER THAN THE BARS AND INSET FROM THE BAR ENDS, which is
    both what a real guard is (rolled hoops, bars welded inside them) and what
    keeps this out of check_coplanar: a bar's side faces are buried in the
    hoop that crosses it, and a bar's END faces are in open air above and
    below the hoops rather than on a hoop's own plane."""
    h = z1 - z0
    if h <= 0.0 or bars < 1:
        return
    mb.ring_boxes((bar, bar, h), radius, bars, (cx, cy, (z0 + z1) * 0.5),
                  role_bar)
    if hoop <= bar:
        raise ValueError("a guard hoop (%.3f) must be wider than the bars it "
                         "holds (%.3f), or the bar's side faces land on the "
                         "hoop's own planes" % (hoop, bar))
    for z in (z0 + h * 0.14, z1 - h * 0.14):
        arc_ring(mb, radius, hoop, z, segs, role_hoop, cx=cx, cy=cy)


def bolted_plate(mb, face, u, v, du, dv, role_plate, role_bolt, inset=0.07,
                 size=0.05, kind="plate"):
    """A plate that is BOLTED ON rather than drawn on: the plate, and a bolt at
    each of its four corners standing off the plate's own outer surface.

    `plate` + `bolts` was already the commonest two-line idiom in the machine
    scripts and it was written out by hand every time, which is how the miner's
    rating plate came to be dimensioned off a copied width (see build_miner's
    PLACARD_U note). Here the bolt positions are DERIVED from the plate's own
    size and inset, so the two cannot be retuned apart, and the bolts sit on a
    face at the plate's outer plane rather than on the panel, which is what a
    bolt through a plate actually does."""
    face.part(mb, du, dv, u, v, kind, role_plate)
    top = Face(face.axis, face.sign, face.out(layer(kind)), limit=face.limit,
               name=face.name + " bolted plate")
    bolts(mb, top, (u - du * 0.5 + inset, u + du * 0.5 - inset),
          (v - dv * 0.5 + inset, v + dv * 0.5 - inset), size, role_bolt)


def hose(mb, points, width, role, clamp_role=None, clamp=1.45):
    """A FLEXIBLE run: `pipe_run`'s geometry with the two things that make a
    hose read as a hose instead of as a thinner duct.

    (1) NO ELBOW FITTINGS. `pipe_run` puts a cube at every corner because a
        rigid duct turns with a fitting; a hose BENDS, so the corner cube is
        the hose's own material and reads as the outside of a bend.
    (2) A CLAMP BAND AT EACH FIXED END. That is where a hose is actually
        attached, it is the only hard part of the assembly, and it is what
        tells the eye which end is the machine and which is the hose.

    WHY A MACHINE WANTS ONE AT ALL, since it already has ducts. A rigid duct
    cannot cross a joint that moves, so a machine whose plumbing is entirely
    rigid is a machine whose moving parts are not connected to anything. The
    assembler's turret rotates and the miner's head travels; both had rigid
    conduit running to them, which is the sort of detail that is invisible
    until somebody who services machinery looks at it. It is also this set's
    one honest MACHINE consumer of the `coarse` family, whose Rubber role has
    otherwise only ever been a belt deck."""
    pipe_run(mb, points, width, role, elbow_role=role)
    if clamp_role is None:
        return
    for p in (points[0], points[-1]):
        mb.box((width * clamp,) * 3, tuple(p), clamp_role)


def assert_inside(mb, half_x, half_y, height, what, eps=1e-6):
    """Refuse the build if the accumulated geometry leaves the declared box.

    A FOOTPRINT IS NOT AN OBSERVATION, IT IS A CONTRACT. `dims_xyz_m` in
    contracts.json is what `validate_glb.py` measures the shipped bytes
    against, but by then the geometry is written and the failure is a
    post-mortem. This is the same fact asserted where it is caused, with the
    overshoot in metres and the axis named, and it is the machine analogue of
    rock_form's planarity assertions: the claim the file makes about itself is
    measured by the file itself."""
    lo, hi = mb.bounds()
    bad = []
    for k, (name, limit) in enumerate((("X", half_x), ("Y", half_y))):
        if -lo[k] - limit > eps:
            bad.append("%s low by %.5f" % (name, -lo[k] - limit))
        if hi[k] - limit > eps:
            bad.append("%s high by %.5f" % (name, hi[k] - limit))
    if lo[2] < -eps:
        bad.append("Z below the ground plane by %.5f" % (-lo[2]))
    if hi[2] - height > eps:
        bad.append("Z high by %.5f" % (hi[2] - height))
    if bad:
        raise ValueError("%s leaves its declared box (%.2f x %.2f x %.2f): %s"
                         % (what, half_x * 2.0, half_y * 2.0, height,
                            "; ".join(bad)))
    return lo, hi


def deg(a):
    return math.radians(a)
