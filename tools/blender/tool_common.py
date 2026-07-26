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


def _haft(mb, r_bot, r_top, z0, z1, seg=8):
    """A slightly tapered branch haft along +Z, through the origin. The taper
    is what says 'a stick someone cut down', against the machines' extrusions."""
    mb.frustum(r_bot, r_top, z1 - z0, (0.0, 0.0, (z0 + z1) * 0.5), axis="Z",
               segments=seg, role="Bark")
    return mb


def _binding(mb, z_list, radius):
    """Rawhide lashing. Two flat rings rather than a modelled wrap: at 260 tris
    the wrap costs a third of the budget and reads identically."""
    for z in z_list:
        mb.cylinder(radius, 0.014, (0.0, 0.0, z), axis="Z", segments=8,
                    role="Accent")
    return mb


def build_pickaxe_lod0(root):
    mb = of.MeshBuilder()
    _haft(mb, 0.024, 0.019, PICK["z_lo"], 0.55)
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
    mb.box((0.040, 0.040, 0.85), (0.0, 0.0, 0.125), "Bark")
    mb.box((0.075, 0.10, 0.14), (0.0, 0.0, PICK["head_z"]), "Iron")
    mb.box((0.170, 0.055, 0.055), (0.115, -0.018, 0.592), "Iron")
    mb.box((0.110, 0.070, 0.070), (-0.085, 0.0, 0.585), "Iron")
    return mb, mb.build(PICK["name"] + "_LOD1", root)


def build_axe_lod0(root):
    mb = of.MeshBuilder()
    _haft(mb, 0.022, 0.017, AXE["z_lo"], 0.48)
    mb.add_raw(*wedge(0.055, 0.11, 0.045, -0.045, (0.40, 0.56), (0.44, 0.52)),
               role="Iron")
    _binding(mb, (0.360, 0.330), 0.026)
    return mb, mb.build(AXE["name"] + "_LOD0", root)


def build_axe_lod1(root):
    mb = of.MeshBuilder()
    mb.box((0.036, 0.036, 0.72), (0.0, 0.0, 0.12), "Bark")
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
