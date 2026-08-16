"""tool_common.py - the two crude hand tools, crude_pickaxe and crude_axe.

    blender --background --python tools/blender/build_crude_pickaxe.py
    blender --background --python tools/blender/build_crude_axe.py

THE ONE RULE THAT MAKES A HAND-HELD ASSET DIFFERENT (ASSET-SPECS 4.3): the
origin is the GRIP POINT, not the base and not the centre. `hand.add(tool)`
with an identity transform must put the tool in the fist, so the haft runs
through the origin and `socket_grip` sits exactly on it. validate_glb.py's
pivot_mode 'grip' checks precisely that, because it is the failure that is
invisible in a render and glaring the moment a character picks the tool up.

Both tools are also carried by the first-person arms, which means they are seen
at 0.35 m as well as at 30 m. That is why the head is a real tapered solid and
not a box: a box reads fine in the third person and reads like a placeholder
filling a third of the screen.

Construction is EXACT, with no jitter and no fit() pass. A jittered pile has to
be measured and refitted to hit its declared bounds; a tool is small enough to
place every vertex by hand, and exact coordinates are what let the grip land on
the origin to the micrometre.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402
# RN-1880. `rc.tube` only, for its parallel-transported rings and its
# `smooth_sides=False`. It is a generic polyline-to-tube helper that happens to
# live beside the rig because the rig needed it first; the alternative here was
# stacking `of_lib.frustum`s, and two frusta meeting cap to cap is exactly the
# coplanar pair `check_coplanar.py` exists to catch.
import rig_common as rc  # noqa: E402


def spike(base, tip, radius, segments=6):
    """A cone from a ring at `base` to a point at `tip`, along any direction.

    The pick's business end. of_lib's frustum only builds along X, Y or Z, and
    a pick spike that is axis-aligned reads as a spigot: the rake (down and
    forward) is what makes the silhouette say 'pickaxe' at 30 m."""
    ax = [tip[k] - base[k] for k in range(3)]
    ln = math.sqrt(sum(c * c for c in ax)) or 1.0
    ax = [c / ln for c in ax]
    # any vector not parallel to the axis, to seed the orthonormal basis
    seed = (0.0, 0.0, 1.0) if abs(ax[2]) < 0.9 else (1.0, 0.0, 0.0)
    u = [ax[1] * seed[2] - ax[2] * seed[1],
         ax[2] * seed[0] - ax[0] * seed[2],
         ax[0] * seed[1] - ax[1] * seed[0]]
    un = math.sqrt(sum(c * c for c in u)) or 1.0
    u = [c / un for c in u]
    v = [ax[1] * u[2] - ax[2] * u[1],
         ax[2] * u[0] - ax[0] * u[2],
         ax[0] * u[1] - ax[1] * u[0]]
    verts = []
    for i in range(segments):
        a = 2.0 * math.pi * i / segments
        ca, sa = math.cos(a) * radius, math.sin(a) * radius
        verts.append(tuple(base[k] + u[k] * ca + v[k] * sa for k in range(3)))
    verts.append(tuple(tip))
    faces = [tuple(range(segments - 1, -1, -1))]
    for i in range(segments):
        faces.append((i, (i + 1) % segments, segments))
    return verts, faces, [False] * len(faces)


def wedge(x_half_back, x_half_front, y_back, y_front, z_back, z_front):
    """A flared blade: a back rectangle in the +Y plane opening out to a wider,
    shorter cutting edge in the -Y plane. Six quads, twelve triangles, and the
    entire read of the axe."""
    zb0, zb1 = z_back
    zf0, zf1 = z_front
    xb, xf = x_half_back, x_half_front
    v = [(-xb, y_back, zb0), (xb, y_back, zb0), (xb, y_back, zb1), (-xb, y_back, zb1),
         (-xf, y_front, zf0), (xf, y_front, zf0), (xf, y_front, zf1), (-xf, y_front, zf1)]
    f = [(0, 3, 2, 1),          # back
         (4, 5, 6, 7),          # cutting edge face
         (0, 1, 5, 4),          # bottom
         (2, 3, 7, 6),          # top
         (1, 2, 6, 5),          # +X cheek
         (3, 0, 4, 7)]          # -X cheek
    return v, f, [False] * len(f)


# ---------------------------------------------------------------------------
# Crude pickaxe. 0.34 x 0.10 x 0.95 m, grip 0.30 m up an 0.85 m haft.
# ---------------------------------------------------------------------------

PICK = dict(
    name="CrudePickaxe",
    out=("tools", "crude_pickaxe.glb"),
    size=(0.34, 0.10, 0.95),
    z_lo=-0.30,                 # haft bottom, i.e. 0.30 m below the grip
    head_z=0.58,
    head_socket=(0.20, -0.035, 0.585),
)

AXE = dict(
    name="CrudeAxe",
    out=("tools", "crude_axe.glb"),
    size=(0.22, 0.09, 0.80),
    z_lo=-0.24,
    head_z=0.48,
    head_socket=(0.0, -0.045, 0.48),
)


def _haft(mb, r_bot, r_top, z0, z1, seg=12):
    """The haft, and RN-1880 rebuilt it because it is the nearest surface in
    the game and it was the crudest.

    IT WAS ONE 8-SIDED FRUSTUM. Measured off the shipped `forestfloor` frame
    on real D3D11: the haft occupies roughly 90 px of a 1600 px frame at the
    first-person carry, so an octagon spends about 22 px on each facet and the
    crease between the two facets the camera looks straight down at is plainly
    a crease. The look audit filed this asset as "the lowest-fidelity thing in
    the frame" and named the bare forearm; the forearm is not even in the
    frame at this framing, and this is what is.

    Three things change and each is one of the three reads:

      SECTION. 12 sides rather than 8, flat-shaded rather than smooth, which
      is `rig_common.oval_tube`'s own recorded argument turned up one notch
      rather than a new one: a low-count tube smooth-shaded is "a lie the
      shader tells", and the answer is more facets with hard boundaries, not
      fewer facets pretending to be round. 12 puts a facet at 15 px.

      PROFILE. Four rings rather than two, so the shaft is SHAPED: it is
      thickest just under the hand and thins both ways, which is what a
      branch chosen for a tool looks like and what a single frustum (a cone)
      structurally cannot be. The old taper ran the wrong way for a haft
      anyway: monotonic bottom to top, so the butt was the widest part of it.

      GRAIN. The role is `Haft`, not `Bark`, so it wears `timber` at 1097
      texels/m instead of bark's 640. See texgen's FAMILY_TILE_M row: the
      600 mm tile is a fact about a standing trunk and this is a 48 mm stick
      held at 0.62 m.

    `r_bot` and `r_top` keep their meaning (the butt and the head end) so both
    call sites read as they did; the two middle rings are derived from them.
    """
    zs = (z0, z0 + (z1 - z0) * 0.22, z0 + (z1 - z0) * 0.46, z1)
    # THE PROFILE IS MONOTONIC AND THE FIRST DRAFT WAS NOT, which is worth
    # recording because the failure was invisible in every argument and
    # obvious in the first frame. It ran 0.94 at the butt up to 1.06 just
    # under the hand, on the reasoning that a shaped haft swells where it is
    # held. It does; but the BUTT IS POINTED ALMOST AT THE CAMERA in the
    # first-person carry, so an undercut butt puts a small end disc behind a
    # wider shaft and the pair reads as the mouth of a hollow pipe. The frame
    # showed a see-through eyelet where a stick's cut end should be.
    #
    # Monotone from butt to head keeps the cut end the widest disc in the
    # silhouette, which is what a cut branch is, and the shaping survives in
    # the RATE: 1.10 to 1.02 over the first fifth and then almost flat to
    # 0.97 means the shaft is slightly concave under the hand rather than a
    # straight cone, which is the whole reason for having four rings.
    rs = (r_bot * 1.10, r_bot * 1.02, r_bot * 0.97, r_top)
    pts = [(0.0, 0.0, z) for z in zs]
    mb.add_raw(*rc.tube(pts, list(rs), seg=seg, smooth_sides=False),
               role="Haft")
    return mb


def _grip_wrap(mb, z0, z1, radius, seg=12):
    """The cord wrapped where the hand actually closes.

    THIS IS THE ONE ADDITION HERE THAT IS ABOUT THE HAND RATHER THAN ABOUT THE
    STICK. The grip point is the origin (ASSET-SPECS 4.3), so the fist closes
    on z = 0 by construction, and until now the 20 cm of haft nearest the
    camera was the same bare cylinder as the 60 cm nobody looks at. A wrap
    there costs one tube, explains the grip, and gives the fingers something
    to be closing ON in a frame where they are otherwise resting on a dowel.

    It is 4 mm proud with a 1.5 mm lead-in at each end rather than a straight
    sleeve, so the ends read as cord running out rather than as a collar. Same
    reason `build_player_fp_arms.py`'s locking ring steps rather than butts.
    """
    lead = (z1 - z0) * 0.14
    pts = [(0.0, 0.0, z) for z in (z0, z0 + lead, z1 - lead, z1)]
    rs = [radius + 0.0015, radius + 0.0045, radius + 0.0045, radius + 0.0015]
    mb.add_raw(*rc.tube(pts, rs, seg=seg, smooth_sides=False), role="Rawhide")
    return mb


def _binding(mb, z_list, radius):
    """Rawhide lashing at the head. Two flat rings rather than a modelled wrap:
    at 260 tris the wrap costs a third of the budget and reads identically.

    RN-1880 CHANGED THE ROLE AND NOT THE GEOMETRY. It was `Accent`, which is
    FF8A1E, the most saturated row in the palette. RN-645 took that exact
    colour out of this exact frame once already, off the wrist ring, with the
    reasoning written out in `build_player_fp_arms.py`; it survived here on
    the object the hand is holding. Rawhide is also what actually lashes a
    head to a branch, so the quieter choice and the honest one agree.
    """
    for z in z_list:
        mb.cylinder(radius, 0.014, (0.0, 0.0, z), axis="Z", segments=8,
                    role="Rawhide")
    return mb


def build_pickaxe_lod0(root):
    mb = of.MeshBuilder()
    _haft(mb, 0.024, 0.019, PICK["z_lo"], 0.55)
    _grip_wrap(mb, -0.105, 0.095, 0.0248)
    # eye block: the collar the haft passes through. Sets the full 0.10 m depth
    # and the 0.95 m top, so the declared bounds come from ONE part.
    mb.box((0.075, 0.10, 0.14), (0.0, 0.0, PICK["head_z"]), "Iron")
    # pick arm, raked down and forward to the tip at x = +0.20
    mb.add_raw(*spike((0.030, 0.0, 0.600), PICK["head_socket"], 0.032, 6),
               role="Iron")
    # adze: short, blunt, tapered, ending exactly on x = -0.14
    mb.frustum(0.045, 0.030, 0.110, (-0.085, 0.0, 0.585), axis="X",
               segments=6, role="Iron")
    _binding(mb, (0.485, 0.455), 0.028)
    return mb, mb.build(PICK["name"] + "_LOD0", root)


def build_pickaxe_lod1(root):
    mb = of.MeshBuilder()
    mb.box((0.040, 0.040, 0.85), (0.0, 0.0, 0.125), "Haft")
    mb.box((0.075, 0.10, 0.14), (0.0, 0.0, PICK["head_z"]), "Iron")
    mb.box((0.170, 0.055, 0.055), (0.115, -0.018, 0.592), "Iron")
    mb.box((0.110, 0.070, 0.070), (-0.085, 0.0, 0.585), "Iron")
    return mb, mb.build(PICK["name"] + "_LOD1", root)


def build_axe_lod0(root):
    mb = of.MeshBuilder()
    _haft(mb, 0.022, 0.017, AXE["z_lo"], 0.48)
    _grip_wrap(mb, -0.100, 0.090, 0.0228)
    mb.add_raw(*wedge(0.055, 0.11, 0.045, -0.045, (0.40, 0.56), (0.44, 0.52)),
               role="Iron")
    _binding(mb, (0.360, 0.330), 0.026)
    return mb, mb.build(AXE["name"] + "_LOD0", root)


def build_axe_lod1(root):
    mb = of.MeshBuilder()
    mb.box((0.036, 0.036, 0.72), (0.0, 0.0, 0.12), "Haft")
    mb.box((0.22, 0.09, 0.16), (0.0, 0.0, 0.48), "Iron")
    return mb, mb.build(AXE["name"] + "_LOD1", root)


def build(kind):
    spec = PICK if kind == "pickaxe" else AXE
    of.reset_scene()
    root = of.add_root(spec["name"])

    if kind == "pickaxe":
        mb0, _ = build_pickaxe_lod0(root)
        mb1, _ = build_pickaxe_lod1(root)
    else:
        mb0, _ = build_axe_lod0(root)
        mb1, _ = build_axe_lod1(root)

    w, d, h = spec["size"]
    # Collision role is Iron, not the SteelDark default: the proxy never reaches
    # a pixel but it DOES count against the material budget, and these files
    # carry exactly three roles.
    of.add_collision_box("col_" + spec["name"], (w, d, h),
                         (0.0, 0.0, spec["z_lo"] + h * 0.5), root, role="Iron")

    # socket_grip IS the origin. It is redundant as a transform and essential as
    # a contract: it is what pivot_mode 'grip' asserts against.
    of.add_socket("socket_grip", (0.0, 0.0, 0.0), parent=root,
                  extras={"of_role": "grip"})
    of.add_socket("socket_head", spec["head_socket"], parent=root,
                  extras={"of_role": "impact"})

    of.report(spec["name"], [("LOD0", mb0), ("LOD1", mb1)])
    of.export_glb(of.dist_path(*spec["out"]), export_force_sampling=False)
