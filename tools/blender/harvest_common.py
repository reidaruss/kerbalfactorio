"""harvest_common.py - shared geometry for the nine harvest-node assets.

    tree_conifer, tree_broadleaf, bush_scrub,
    boulder_stone / _iron / _copper / _coal,
    water_pool, oil_seep

The machines are boxes and cylinders, so they assemble straight out of
of_lib.MeshBuilder. Harvest nodes are organic, and organic shapes need three
things the machine path does not:

  1. DETERMINISTIC JITTER. A rock with no jitter reads as a crystal and a tree
     with no jitter reads as a lamp post, but a rebuild that changes the mesh
     is not diffable, and diffability is the entire reason this pipeline is
     scripted. So every wobble comes from a seeded LCG, never from `random`.

  2. FIT-AFTER-THE-FACT. A jittered pile does not know its own bounds in
     advance, and validate_glb.py checks the LOD0 bounding box against the
     spec to the millimetre. Parts.fit() therefore builds first and scales the
     finished pile into the spec box exactly.

  3. A SHARED TRANSFORM ACROSS DEPLETION VARIANTS. `_Full`, `_Half` and `_Low`
     are swapped in place at runtime by RemainingAmount / InitialAmount, so
     anything they share (a tree trunk, a pool rim) must land on exactly the
     same world coordinates in every variant or the swap pops. Parts.fit()
     returns its transform and Parts.apply() replays it, so the variants are
     fitted ONCE, by the Full build, and never independently.

Everything here returns plain (verts, faces, smooth) tuples in metres, Blender
axes, +Z up. Nothing here touches bpy.
"""

import math


# ---------------------------------------------------------------------------
# Deterministic noise
# ---------------------------------------------------------------------------

def rng(seed):
    """Seeded LCG returning floats in [0, 1). Numerical recipes constants.

    Deliberately not `random`: the stdlib generator's stream is a language
    implementation detail, and a build that produces different bytes on a
    different Python is a build that cannot be reviewed by diff."""
    state = [(seed * 2654435761) & 0xFFFFFFFF]

    def nxt():
        state[0] = (state[0] * 1664525 + 1013904223) & 0xFFFFFFFF
        return state[0] / 4294967296.0
    return nxt


def _wob(nxt, amount):
    """Multiplicative wobble in [1-amount, 1+amount]."""
    return 1.0 + (nxt() * 2.0 - 1.0) * amount


def _ordered_unique(seq):
    out = []
    for x in seq:
        if x not in out:
            out.append(x)
    return out


# ---------------------------------------------------------------------------
# Parts: a measurable, refittable pile of geometry
# ---------------------------------------------------------------------------

class Parts:
    """Accumulate raw geometry groups, measure them, refit them, then pour the
    result into an of_lib.MeshBuilder.

    A group carries a PER-FACE role list, which is how an ore boulder splits
    three to five of its facets out onto the ore material without needing a
    second mesh: the rock body stays matte while the raw metal catches a
    specular highlight, and that contrast is the whole 30 m gameplay signal.
    """

    def __init__(self):
        self.groups = []

    def add(self, verts, faces, smooth=None, role="Rock"):
        """role is either one palette role for the whole group, or a list with
        one role per face."""
        faces = [tuple(f) for f in faces]
        if smooth is None:
            smooth = [False] * len(faces)
        roles = [role] * len(faces) if isinstance(role, str) else list(role)
        if len(roles) != len(faces) or len(smooth) != len(faces):
            raise ValueError("per-face lists must match the face count")
        self.groups.append([list(verts), faces, list(smooth), roles])
        return self

    def extend(self, other):
        for g in other.groups:
            self.groups.append([list(g[0]), list(g[1]), list(g[2]), list(g[3])])
        return self

    def bounds(self):
        lo = [1e30, 1e30, 1e30]
        hi = [-1e30, -1e30, -1e30]
        for verts, _, _, _ in self.groups:
            for p in verts:
                for k in range(3):
                    lo[k] = min(lo[k], p[k])
                    hi[k] = max(hi[k], p[k])
        return lo, hi

    def apply(self, xform):
        """Replay a (scale, offset) produced by fit() on another Parts pile."""
        s, o = xform
        for g in self.groups:
            g[0] = [(p[0] * s[0] + o[0],
                     p[1] * s[1] + o[1],
                     p[2] * s[2] + o[2]) for p in g[0]]
        return self

    def fit(self, size, base_z=0.0):
        """Scale and shift so the AABB is exactly `size`, centred on X/Y with
        its base at `base_z`. That is the pivot rule from ASSET-SPECS 2.1, made
        exact rather than approximate. Returns the transform for apply()."""
        lo, hi = self.bounds()
        s = []
        for k in range(3):
            d = hi[k] - lo[k]
            s.append(size[k] / d if d > 1e-9 else 1.0)
        o = [-(lo[0] + hi[0]) * 0.5 * s[0],
             -(lo[1] + hi[1]) * 0.5 * s[1],
             base_z - lo[2] * s[2]]
        self.apply((s, o))
        return (s, o)

    def tri_count(self):
        return sum(max(0, len(f) - 2)
                   for _, faces, _, _ in self.groups for f in faces)

    def into(self, mb, role_order=None):
        """Pour into a MeshBuilder, one material slot per role.

        role_order pins the SLOT ORDER, which is part of the render-facing
        contract: three.js sees one primitive per slot in this order, so a
        renderer that wants "the ore primitive" can index it rather than
        string-matching a material name."""
        order = role_order or _ordered_unique(
            [r for g in self.groups for r in g[3]])
        for role in order:
            for verts, faces, smooth, roles in self.groups:
                idx = [i for i, r in enumerate(roles) if r == role]
                if not idx:
                    continue
                sub = [faces[i] for i in idx]
                used = sorted({v for f in sub for v in f})
                remap = {old: new for new, old in enumerate(used)}
                mb.add_raw([verts[i] for i in used],
                           [tuple(remap[v] for v in f) for f in sub],
                           [smooth[i] for i in idx], role)
        return mb


# ---------------------------------------------------------------------------
# Shapes
# ---------------------------------------------------------------------------

def lobe(rx, ry, rz, loc=(0.0, 0.0, 0.0), seg=7, seed=1, jit=0.17,
         lean=(0.0, 0.0), rings=((0.0, 0.90), (0.45, 1.00), (0.80, 0.60)),
         role="Rock", ore_role=None, ore_faces=(), smooth=False):
    """One faceted convex lobe: a flat n-gon base, jittered rings, an apex.

    This is the single primitive behind rock boulders, canopy blobs and bush
    lobes. Flat-shaded on purpose: ASSET-SPECS 4.5 puts the whole design in 5
    to 7 large flat facets, because flat facets catch directional light and
    hold a readable silhouette at 30 m where a noisy sculpt turns to mush.

    ore_faces indexes into the SIDE bands (0-based, in generation order) and
    reassigns those facets to ore_role. Three to five is the spec.

    Returns (verts, faces, smooth_flags, per_face_roles).
    """
    nxt = rng(seed)
    n = max(3, seg)
    verts = []
    for z_frac, r_frac in rings:
        z = rz * z_frac * (1.0 if z_frac == 0.0 else _wob(nxt, 0.07))
        for i in range(n):
            a = 2.0 * math.pi * i / n + (nxt() - 0.5) * (2.0 * math.pi / n) * 0.5
            r = r_frac * _wob(nxt, jit)
            verts.append((loc[0] + rx * r * math.cos(a) + lean[0] * z_frac,
                          loc[1] + ry * r * math.sin(a) + lean[1] * z_frac,
                          loc[2] + z))
    apex = len(verts)
    verts.append((loc[0] + rx * (nxt() - 0.5) * 0.22 + lean[0],
                  loc[1] + ry * (nxt() - 0.5) * 0.22 + lean[1],
                  loc[2] + rz))

    faces, sides = [], []
    faces.append(tuple(range(n - 1, -1, -1)))          # flat base, normal down
    nr = len(rings)
    for b in range(nr - 1):
        lo, hi = b * n, (b + 1) * n
        for i in range(n):
            j = (i + 1) % n
            sides.append(len(faces))
            faces.append((lo + i, lo + j, hi + j, hi + i))
    top = (nr - 1) * n
    for i in range(n):
        j = (i + 1) % n
        sides.append(len(faces))
        faces.append((top + i, top + j, apex))

    roles = [role] * len(faces)
    if ore_role:
        for k in ore_faces:
            roles[sides[k % len(sides)]] = ore_role
    return verts, faces, [smooth] * len(faces), roles


def blob(rx, ry, rz, loc=(0.0, 0.0, 0.0), seg=8, seed=1, jit=0.15,
         rings=(0.22, 0.50, 0.80), radii=(0.62, 1.00, 0.70), smooth=False):
    """A closed faceted spheroid centred on `loc`: broadleaf canopy masses,
    bush lobes, oil pressure mounds.

    rz is the FULL height, rx/ry the radii, so a canopy 'squashed to 0.6
    vertical' is rz = 1.2 * rx. Bottom apex, jittered rings, top apex, all
    flat shaded: 2 * seg * len(rings) triangles."""
    nxt = rng(seed)
    n = max(3, seg)
    z0 = loc[2] - rz * 0.5
    verts = [(loc[0], loc[1], z0)]
    for frac, rf in zip(rings, radii):
        z = z0 + rz * frac * _wob(nxt, 0.06)
        for i in range(n):
            a = 2.0 * math.pi * i / n + (nxt() - 0.5) * (2.0 * math.pi / n) * 0.6
            r = rf * _wob(nxt, jit)
            verts.append((loc[0] + rx * r * math.cos(a),
                          loc[1] + ry * r * math.sin(a), z))
    top = len(verts)
    verts.append((loc[0] + rx * (nxt() - 0.5) * 0.2,
                  loc[1] + ry * (nxt() - 0.5) * 0.2, z0 + rz))

    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((0, 1 + j, 1 + i))                    # bottom fan
    for b in range(len(rings) - 1):
        lo, hi = 1 + b * n, 1 + (b + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((lo + i, lo + j, hi + j, hi + i))
    last = 1 + (len(rings) - 1) * n
    for i in range(n):
        j = (i + 1) % n
        faces.append((last + i, last + j, top))            # top fan
    return verts, faces, [smooth] * len(faces)


def taper(r_bot, r_top, z0, z1, loc=(0.0, 0.0, 0.0), seg=8, phase_deg=0.0,
          smooth=True, lean=(0.0, 0.0)):
    """A tapered cylinder along +Z as raw geometry: trunks, conifer tiers,
    fork limbs.

    of_lib.MeshBuilder.frustum does the same thing, but a Parts pile has to
    own its vertices to be refittable, so the harvest nodes need the raw form.

    `lean` offsets the TOP ring in X/Y, which is how a broadleaf fork limb
    leaves the trunk at an angle without any rotation machinery.

    r_top must be > 0. A zero top radius collapses the top cap into degenerate
    faces that mesh.validate() silently deletes, which would make the reported
    triangle count a lie."""
    n = max(3, seg)
    ph = math.radians(phase_deg)
    verts = []
    for r, z, dx, dy in ((r_bot, z0, 0.0, 0.0), (r_top, z1, lean[0], lean[1])):
        for i in range(n):
            a = 2.0 * math.pi * i / n + ph
            verts.append((loc[0] + dx + r * math.cos(a),
                          loc[1] + dy + r * math.sin(a), loc[2] + z))
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    sm = [False, False]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        sm.append(smooth)
    return verts, faces, sm


def rim_ring(n, r_out, r_in, z_top, loc=(0.0, 0.0, 0.0), seed=1, jit=0.11,
             z_jit=0.22, z_bottom=0.0, include_bottom=False):
    """An irregular annular prism: the rock rim of a water pool, the cracked
    crust of an oil seep.

    Per-vertex radius and per-vertex top height are jittered, so the ring never
    reads as a machined washer. The bottom face is omitted by default: it sits
    on the terrain and is never visible, and 2n triangles is a third of the
    ring's cost."""
    nxt = rng(seed)
    ob, ib, ot, it = [], [], [], []
    for i in range(n):
        a = 2.0 * math.pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        ro = r_out * _wob(nxt, jit)
        ri = r_in * _wob(nxt, jit)
        zt = z_bottom + (z_top - z_bottom) * _wob(nxt, z_jit)
        ob.append((loc[0] + ro * ca, loc[1] + ro * sa, loc[2] + z_bottom))
        ib.append((loc[0] + ri * ca, loc[1] + ri * sa, loc[2] + z_bottom))
        ot.append((loc[0] + ro * ca, loc[1] + ro * sa, loc[2] + zt))
        it.append((loc[0] + ri * ca, loc[1] + ri * sa, loc[2] + zt))
    verts = ob + ib + ot + it
    OB, IB, OT, IT = 0, n, 2 * n, 3 * n
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((IT + i, OT + i, OT + j, IT + j))     # top annulus
        faces.append((OB + i, OB + j, OT + j, OT + i))     # outer wall
        faces.append((IB + i, IT + i, IT + j, IB + j))     # inner wall
        if include_bottom:
            faces.append((IB + i, IB + j, OB + j, OB + i))
    return verts, faces, [False] * len(faces)


def ngon(n, radius, z, loc=(0.0, 0.0, 0.0), seed=1, jit=0.06):
    """A flat n-gon facing +Z: a water surface, an oil slick, a basin floor.
    One face, n-2 triangles, which is as cheap as a near-flat surface gets."""
    nxt = rng(seed)
    verts = []
    for i in range(n):
        a = 2.0 * math.pi * i / n
        r = radius * _wob(nxt, jit)
        verts.append((loc[0] + r * math.cos(a), loc[1] + r * math.sin(a),
                      loc[2] + z))
    return verts, [tuple(range(n))], [False]


def crossed_quads(width, height, z0=0.0, loc=(0.0, 0.0, 0.0), yaw_deg=22.0):
    """Two intersecting vertical quads: the LOD2 foliage impostor. Four
    triangles that hold a tree's mass at 80 m+, which is the entire job of
    LOD2 for anything organic. Uses a double-sided role (Leaf), so one quad
    reads from both faces."""
    a = math.radians(yaw_deg)
    hw = width * 0.5
    verts, faces = [], []
    for k, ang in enumerate((a, a + math.pi * 0.5)):
        ca, sa = math.cos(ang), math.sin(ang)
        b = 4 * k
        verts += [(loc[0] - hw * ca, loc[1] - hw * sa, loc[2] + z0),
                  (loc[0] + hw * ca, loc[1] + hw * sa, loc[2] + z0),
                  (loc[0] + hw * ca, loc[1] + hw * sa, loc[2] + z0 + height),
                  (loc[0] - hw * ca, loc[1] - hw * sa, loc[2] + z0 + height)]
        faces.append((b, b + 1, b + 2, b + 3))
    return verts, faces, [False] * len(faces)
