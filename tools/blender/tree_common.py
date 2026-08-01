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
                 loc=(0.0, 0.0, 0.0), lean=(0.0, 0.0), roles=None, cap=True,
                 offsets=None, ridge=None, flare=None):
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

    THREE SHAPE ARGUMENTS ADDED AT RN-271, ALL OPTIONAL, ALL COSTING ZERO
    TRIANGLES, and all of them default to None so every existing caller
    rebuilds byte-identical. Each is a function of the vertex's OWN azimuth and
    OWN height, so it reshapes rings that already exist rather than adding any.

    `offsets` is one (dx, dy) per ring and REPLACES `lean` when given. `lean`
    can only express a straight line, because it interpolates one displacement
    linearly down the stack, so a leaning trunk built with it is a tilted
    dowel. A real trunk SWEEPS: it leaves the ground one way and recovers, and
    that curve is most of what says "grown" rather than "extruded".

    `ridge` is (lobes, depth, twist_deg) and multiplies every radius by
    1 + depth * cos(lobes * azimuth - twist), with the twist accumulating up
    the stack. The phase does NOT depend on the ring, which is the whole point:
    the existing per-vertex `jit` redraws independently on every ring, so it is
    surface NOISE and the silhouette it produces is a smooth line with a wobble
    on it. A coherent azimuthal term instead runs a fixed set of ridges the
    length of the trunk, which breaks the silhouette into flutes and agrees
    with the direction of the bark texture's own fissures (RN-100 puts world
    vertical in v, so the fissures run vertically on every trunk side).

    `flare` is (lobes, depth, span) and ADDS buttressing to the bottom `span`
    fraction of the stack, decaying quadratically to nothing: the radius gains
    depth * (1 - t/span)^2 * max(0, cos(lobes * azimuth))^3. A mature trunk
    does not meet the ground as a circle, it meets it as three or four root
    swells with hollows between them, and that flare is the closest-range
    silhouette a player standing beside a tree actually reads.

    Returns (verts, faces, smooth, roles) ready for harvest_common.Parts.add.
    """
    nxt = hc.rng(seed)
    n = max(3, seg)
    ph = math.radians(phase_deg)
    nb = len(bands_rz)
    if nb < 2:
        raise ValueError("taper_bands needs at least 2 rings")
    if offsets is not None and len(offsets) != nb:
        raise ValueError("taper_bands got %d offset(s) for %d ring(s)"
                         % (len(offsets), nb))
    verts = []
    for bi, (r, z) in enumerate(bands_rz):
        t = bi / float(nb - 1)
        if offsets is None:
            dx, dy = lean[0] * t, lean[1] * t
        else:
            dx, dy = offsets[bi]
        for i in range(n):
            a = 2.0 * math.pi * i / n + ph
            rr = r * (1.0 + (nxt() - 0.5) * 2.0 * jit)
            if ridge is not None:
                lobes, depth, twist_deg = ridge
                rr *= 1.0 + depth * math.cos(lobes * a
                                             - math.radians(twist_deg) * t)
            if flare is not None:
                lobes, depth, span = flare
                if t < span:
                    fall = (1.0 - t / span) ** 2
                    swell = max(0.0, math.cos(lobes * a)) ** 3
                    rr += r * depth * fall * swell
            verts.append((loc[0] + dx + rr * math.cos(a),
                          loc[1] + dy + rr * math.sin(a), loc[2] + z))

    if roles is None or isinstance(roles, str):
        role_list = [roles] * (nb - 1)
    else:
        role_list = list(roles)
        if len(role_list) != nb - 1:
            raise ValueError("taper_bands got %d band role(s) for %d bands"
                             % (len(role_list), nb - 1))

    # `cap` is a bool for both ends or a (bottom, top) pair. The pair form is
    # tested for a TUPLE and not for truth, because (False, False) is truthy.
    cap_lo, cap_hi = (cap, cap) if isinstance(cap, bool) else tuple(cap)
    faces, smooth, out_roles = [], [], []
    if cap_lo:
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
    if cap_hi:
        top = (nb - 1) * n
        faces.append(tuple(range(top, top + n)))
        smooth.append(False)
        out_roles.append(role_list[-1])
    return verts, faces, smooth, out_roles


def limb(path, radii, seg=4, seed=1, jit=0.10, roles="Bark", cap=(True, True),
         phase_deg=0.0):
    """A tapered tube swept along an arbitrary 3D polyline: a bough leaving a
    trunk, a fork that keeps forking, a limb that droops at its outer end, a
    snapped stub.

    ADDED AT RN-271 BECAUSE THE FLORA FAMILY COULD NOT EXPRESS A BRANCH.
    Everything before this was a stack of HORIZONTAL rings (`taper_bands`,
    `_bands`, `hc.taper`), and `lean` offsets the top ring sideways. That is a
    legal shape only while the limb is mostly vertical: push `lean` far enough
    to make a limb reach OUT and its rings, still lying flat in XY, become
    flatter and flatter slices of it, until at horizontal they are degenerate
    and the limb is a ribbon. Every branch in this project is therefore either
    steeply upright or a cheat, and "trunks are near-cylinders with nothing
    coming off them" follows directly from that.

    `path` is [(x, y, z), ...] with at least 2 points, in the caller's own
    frame. `radii` is one radius per point. Each ring is built in the plane
    PERPENDICULAR to the local tangent (central difference at interior points,
    one-sided at the ends), so the tube keeps its cross section whatever
    direction the limb is running, including dead horizontal and past it.

    The ring frame is derived from the tangent and world +Z, falling back to
    world +X when the limb is within about half a degree of vertical, so a
    vertical limb is still well defined. Consecutive rings therefore share a
    reference direction rather than being parallel-transported: a limb that
    turns through more than about 90 degrees in one section will twist, which
    is why boughs here are authored as three or four short sections.

    Triangles: cap[0]*(seg-2) + cap[1]*(seg-2) + 2*seg*(len(path)-1).

    Returns (verts, faces, smooth, roles) ready for harvest_common.Parts.add.
    """
    m = len(path)
    if m < 2:
        raise ValueError("limb needs at least 2 path points")
    if len(radii) != m:
        raise ValueError("limb got %d radii for %d path point(s)"
                         % (len(radii), m))
    nxt = hc.rng(seed)
    n = max(3, seg)
    ph = math.radians(phase_deg)
    verts = []
    for k in range(m):
        p0 = path[max(0, k - 1)]
        p1 = path[min(m - 1, k + 1)]
        tx, ty, tz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
        tl = math.sqrt(tx * tx + ty * ty + tz * tz)
        if tl < 1e-9:
            raise ValueError("limb path has two coincident points")
        tx, ty, tz = tx / tl, ty / tl, tz / tl
        # u = normalize(tangent x up), v = tangent x u. The cross with +Z
        # collapses on a vertical limb, so the reference swaps to +X there.
        ux, uy, uz = ty, -tx, 0.0
        ul = math.hypot(ux, uy)
        if ul < 1e-4:
            ux, uy, uz = 0.0, tz, -ty
            ul = math.hypot(uy, uz)
        ux, uy, uz = ux / ul, uy / ul, uz / ul
        vx = ty * uz - tz * uy
        vy = tz * ux - tx * uz
        vz = tx * uy - ty * ux
        for i in range(n):
            a = 2.0 * math.pi * i / n + ph
            r = radii[k] * (1.0 + (nxt() - 0.5) * 2.0 * jit)
            ca, sa = math.cos(a) * r, math.sin(a) * r
            verts.append((path[k][0] + ux * ca + vx * sa,
                          path[k][1] + uy * ca + vy * sa,
                          path[k][2] + uz * ca + vz * sa))

    role_list = [roles] * (m - 1) if isinstance(roles, str) else list(roles)
    if len(role_list) != m - 1:
        raise ValueError("limb got %d role(s) for %d section(s)"
                         % (len(role_list), m - 1))
    faces, out_roles = [], []
    if cap[0]:
        faces.append(tuple(range(n - 1, -1, -1)))
        out_roles.append(role_list[0])
    for b in range(m - 1):
        lo, hi = b * n, (b + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((lo + i, lo + j, hi + j, hi + i))
            out_roles.append(role_list[b])
    if cap[1]:
        top = (m - 1) * n
        faces.append(tuple(range(top, top + n)))
        out_roles.append(role_list[-1])
    return verts, faces, [False] * len(faces), out_roles


def arc(az_deg, reach, z0, rise, droop, steps=3, r0=0.0, sweep_deg=0.0):
    """The path a bough takes: out along `az_deg` from (0, 0, z0), rising by
    `rise` at the point of greatest height and finishing `droop` metres BELOW
    that peak at full `reach`.

    A branch is not a straight line and the difference is the whole read. A
    straight limb gives a crown whose outline is a cone flank; a limb that
    leaves the trunk steeply, flattens, and then lets its outer end fall is
    what makes a canopy layered, and it is what puts foliage BELOW the level it
    is attached at, which is the shape the eye reads as weight.

    `r0` starts the path out from the trunk axis rather than on it, so a bough
    emerges from the trunk surface instead of from inside it. `sweep_deg` turns
    the bough in plan as it goes, so it curves rather than radiating: a crown
    of perfectly radial limbs is a wheel seen from above and reads as one.
    """
    pts = []
    for k in range(steps + 1):
        t = k / float(steps)
        a = math.radians(az_deg + sweep_deg * t * t)
        d = r0 + (reach - r0) * t
        # A parabola in t peaking at t = 0.62: up fast, then over and down.
        z = z0 + rise * (1.0 - ((t - 0.62) / 0.62) ** 2) - droop * t ** 3
        pts.append((d * math.cos(a), d * math.sin(a), z))
    return pts


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
