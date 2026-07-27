"""tree_common.py - the rig every tree-family harvest node shares.

    build_tree_conifer.py, build_tree_broadleaf.py, build_bush_scrub.py

All three map to worldgen::survival::NodeKind::Tree. What they share is not
their shape (the two trees are deliberately unalike, and the bush is neither)
but their RIG: two nested animation pivots, one socket set, one collision box
and the Tree_Sway / Tree_Fall clip pair.

WHY THE PIVOTS ARE SHARED RATHER THAN PER-VARIANT. validate_glb.py checks the
animation clip name set EXACTLY, and in ACTIONS export mode two same-named
Actions on two objects are not guaranteed to merge into one clip, so a second
`Tree_Sway` would surface as `Tree_Sway.001` and fail the build. One clip
therefore drives one object. Every depletion variant hangs under the same
sway pivot, so a single Tree_Sway sways whichever variant is currently visible
and a single Tree_Fall fells it, with no per-variant clip duplication.

    <Root>
      fell_pivot                 Tree_Fall rotates this about X
        sway_pivot               Tree_Sway rotates this +/- 1.5 deg
          <Root>_Full_LOD0..2
          <Root>_Half_LOD0..2
          <Root>_Low_LOD0..2
          <Root>_Stump_LOD0..2   (trees only)
      col_<Root>
      socket_hit / socket_fell_pivot / socket_item_pop

Both pivots sit at the trunk base with an identity rest transform, so the
LOD0 world bounding box the validator measures is the mesh's own.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402


# ---------------------------------------------------------------------------
# Shared organic geometry for the tree family. Both live trees are radially
# UNIFORM shapes underneath (a taper is a perfect circle, a blob is a perfect
# ellipsoid), which is exactly what makes a script read as a script. These two
# helpers are the fix: same silhouette-defining parameters callers already
# pass, but every ring gets its own deterministic jitter, and every band along
# the shape's own axis can carry its own palette role. Zero extra triangles
# over the flat-coloured, perfectly-circular version; the whole cost is a
# handful of extra hc.rng() draws.
# ---------------------------------------------------------------------------

def taper_bands(bands_rz, seg=9, seed=1, jit=0.12, phase_deg=0.0,
                 loc=(0.0, 0.0, 0.0), lean=(0.0, 0.0), roles=None, cap=True):
    """A tapered stack of len(bands_rz) rings, bands_rz = [(r, z), ...] with
    at least 2 entries, each ring's radius jittered per vertex with a
    deterministic seeded LCG. This is harvest_common.taper's shape plus two
    things a plain frustum cannot do: an irregular (non-circular) ring, which
    is what stops a stacked cone reading as procedural, and one palette role
    PER SIDE BAND, so a trunk or a canopy tier can shade from a shadowed base
    to a sunlit tip with no extra geometry.

    `roles` is either a single role string (the whole taper), or a list with
    one entry per side band (len(bands_rz) - 1): bands_rz[0]->bands_rz[1] is
    roles[0], and so on. `lean` offsets only the LAST ring in X/Y, same
    convention as harvest_common.taper, so a tier can droop or a limb can fork
    away from the trunk with no rotation machinery.

    Returns (verts, faces, smooth, roles) ready for harvest_common.Parts.add.
    """
    nxt = hc.rng(seed)
    n = max(3, seg)
    ph = math.radians(phase_deg)
    nb = len(bands_rz)
    if nb < 2:
        raise ValueError("taper_bands needs at least 2 rings")
    verts = []
    for bi, (r, z) in enumerate(bands_rz):
        t = bi / float(nb - 1)
        dx, dy = lean[0] * t, lean[1] * t
        for i in range(n):
            a = 2.0 * math.pi * i / n + ph
            rr = r * (1.0 + (nxt() - 0.5) * 2.0 * jit)
            verts.append((loc[0] + dx + rr * math.cos(a),
                          loc[1] + dy + rr * math.sin(a), loc[2] + z))

    if roles is None or isinstance(roles, str):
        role_list = [roles] * (nb - 1)
    else:
        role_list = list(roles)
        if len(role_list) != nb - 1:
            raise ValueError("taper_bands got %d band role(s) for %d bands"
                             % (len(role_list), nb - 1))

    faces, smooth, out_roles = [], [], []
    if cap:
        faces.append(tuple(range(n - 1, -1, -1)))
        smooth.append(False)
        out_roles.append(role_list[0])
    for b in range(nb - 1):
        lo, hi = b * n, (b + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((lo + i, lo + j, hi + j, hi + i))
            smooth.append(False)
            out_roles.append(role_list[b])
    if cap:
        top = (nb - 1) * n
        faces.append(tuple(range(top, top + n)))
        smooth.append(False)
        out_roles.append(role_list[-1])
    return verts, faces, smooth, out_roles


def canopy_mass(rx, ry, rz, loc=(0.0, 0.0, 0.0), seg=9, seed=1, jit=0.15,
                 rings=(0.22, 0.50, 0.80), radii=(0.62, 1.00, 0.70),
                 bands=("LeafDeep", "LeafDeep", "Leaf", "LeafLight")):
    """A closed faceted spheroid, the same construction as
    harvest_common.blob (bottom apex, jittered rings, top apex), but with one
    role PER VERTICAL ZONE instead of one role for the whole mass. Zones run
    bottom fan, then one per consecutive ring pair, then top fan, in that
    order, so len(bands) must be len(rings) + 1.

    A canopy mass gets its volume from exactly this: the underside/interior
    (bottom fan, shadowed, facing away from the sky) reads darker than the
    crown (top fan, catching the most light), for zero extra triangles over
    the flat-coloured blob."""
    if len(bands) != len(rings) + 1:
        raise ValueError("canopy_mass needs %d band role(s) for %d rings, "
                         "got %d" % (len(rings) + 1, len(rings), len(bands)))
    nxt = hc.rng(seed)
    n = max(3, seg)
    z0 = loc[2] - rz * 0.5
    verts = [(loc[0], loc[1], z0)]
    for frac, rf in zip(rings, radii):
        z = z0 + rz * frac * (1.0 + (nxt() - 0.5) * 0.12)
        for i in range(n):
            a = 2.0 * math.pi * i / n + (nxt() - 0.5) * (2.0 * math.pi / n) * 0.6
            r = rf * (1.0 + (nxt() - 0.5) * 2.0 * jit)
            verts.append((loc[0] + rx * r * math.cos(a),
                          loc[1] + ry * r * math.sin(a), z))
    top = len(verts)
    verts.append((loc[0] + rx * (nxt() - 0.5) * 0.2,
                  loc[1] + ry * (nxt() - 0.5) * 0.2, z0 + rz))

    faces, out_roles = [], []
    for i in range(n):
        j = (i + 1) % n
        faces.append((0, 1 + j, 1 + i))
        out_roles.append(bands[0])
    for b in range(len(rings) - 1):
        lo, hi = 1 + b * n, 1 + (b + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((lo + i, lo + j, hi + j, hi + i))
            out_roles.append(bands[b + 1])
    last = 1 + (len(rings) - 1) * n
    for i in range(n):
        j = (i + 1) % n
        faces.append((last + i, last + j, top))
        out_roles.append(bands[-1])
    smooth = [False] * len(faces)
    return verts, faces, smooth, out_roles


def rig(root, name, col_size, hit_z, pop, fall=True):
    """Build the pivots, sockets and collision proxy. Returns the sway pivot;
    parent every render mesh to it."""
    fell = of.add_pivot("fell_pivot", (0.0, 0.0, 0.0), root) if fall else None
    sway = of.add_pivot("sway_pivot", (0.0, 0.0, 0.0), fell or root)

    of.add_collision_box("col_" + name, col_size,
                         (0, 0, col_size[2] * 0.5), root, role="Bark")

    # socket_hit is chest height on the forward face of the trunk: where the
    # axe lands and where impact VFX plays. socket_fell_pivot is the felling
    # hinge, kept as a marker distinct from the animated fell_pivot so the
    # socket stays a childless node per ASSET-SPECS 2.6.
    of.add_socket("socket_hit", (0.0, -0.28, hit_z), parent=root,
                  extras={"of_role": "hit"})
    if fall:
        of.add_socket("socket_fell_pivot", (0.0, 0.0, 0.0), parent=root,
                      extras={"of_role": "fell_pivot"})
    of.add_socket("socket_item_pop", pop, parent=root,
                  extras={"of_role": "item_pop"})

    # Tree_Sway, 1 to 181, loop. X runs one cycle at +/- 1.5 degrees and Y runs
    # TWO cycles at +/- 0.9, so the crown traces a slow figure eight instead of
    # rocking in one plane. At 6.5 m that is a 17 cm crown drift: wind at 30 m,
    # never a wobbling asset up close.
    #
    # FRAME 1 MUST BE THE IDENTITY POSE. Assigning an Action makes the
    # depsgraph evaluate the pivot at the current frame, and the exporter
    # writes THAT into the node's TRS. A clip that starts one degree off axis
    # therefore bakes a permanent one degree lean into the asset, which showed
    # up as a 2.483 m wide conifer failing a 2.400 m scale check. Both channels
    # also return to zero at 181 so the loop is seam free.
    of.add_clip_multi(sway, "Tree_Sway", {
        "rotation_euler": [
            (1,   of.deg3(0.00, 0.0, 0.0)),
            (24,  of.deg3(1.06, 0.9, 0.0)),
            (46,  of.deg3(1.50, 0.0, 0.0)),
            (69,  of.deg3(1.06, -0.9, 0.0)),
            (91,  of.deg3(0.00, 0.0, 0.0)),
            (114, of.deg3(-1.06, 0.9, 0.0)),
            (136, of.deg3(-1.50, 0.0, 0.0)),
            (159, of.deg3(-1.06, -0.9, 0.0)),
            (181, of.deg3(0.00, 0.0, 0.0)),
        ]})

    if fall:
        # Tree_Fall, 1 to 45, one shot. 88 degrees about X through the trunk
        # base, keyed in sub-180-degree steps because glTF stores rotation as
        # a quaternion. Slow break, fast topple, two-frame bounce settle.
        of.add_clip(fell, "Tree_Fall", "rotation_euler", [
            (1,  of.deg3(0.0, 0.0, 0.0)),
            (11, of.deg3(5.0, 0.0, 0.0)),
            (25, of.deg3(38.0, 0.0, 0.0)),
            (37, of.deg3(88.0, 0.0, 0.0)),
            (41, of.deg3(82.0, 0.0, 0.0)),
            (45, of.deg3(87.0, 0.0, 0.0)),
        ])
    return sway
