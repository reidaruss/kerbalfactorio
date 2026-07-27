"""props_common.py - shared geometry and the atlas driver for Tier 1.

    build_props_beach.py, _plains, _forest, _hills, _mountains, _polar,
    _ocean, _moon, _cave, build_detail_cards.py

ASSET-SPECS 3.2 ships the environment dressing as ONE .glb PER BIOME, because
the scatter system wants one file per biome and one InstancedMesh per prop.
That shapes everything here:

  1. EVERY PROP SITS ON THE ORIGIN, base at z = 0, centred on x/y, and the
     props in a file OVERLAP. There is no atlas layout, for the same reason
     the items atlas has none (ASSET-SPECS 4.11): a layout offset rides along
     on the node transform and every consumer has to subtract it back out.
     A scatter pass clones one prop by name and writes a placement matrix, so
     "pivot at the ground contact point" makes that matrix pure terrain data.

  2. MATERIAL COUNT IS THE REAL BUDGET, not triangles. These are drawn by the
     thousand and the renderer batches by material, so an atlas that uses six
     roles costs six draws per chunk where one that uses three costs three.
     Three to five roles per atlas is the target; colour lives in the material
     and never in geometry.

  3. LOD0 AND LOD2 ONLY. Props skip the middle band: at 25 m a rock is either
     worth its 100 triangles or it is 80 m away and worth 15. Organic props
     decimate cleanly, so LOD2 is a COLLAPSE decimate. Foliage does NOT: a
     collapse decimator eats a grass blade whole and leaves a shard, so a
     foliage prop passes a CALLABLE that rebuilds the tuft with fewer blades.

  4. SILHOUETTE VARIETY OVER DETAIL. A biome reads as a place because of the
     mix of shapes at a mix of scales, not because any one rock is beautiful.

COLLISION. Section 2.5 asks for one convex proxy per asset. For scatter that
is the wrong default: a grass tuft with a collider is a player snagging on
grass, and a thousand colliders per chunk is a physics bill nobody wants for
decoration. So a proxy is authored only where the prop is a solid obstacle a
player must not walk through (rocks, boulders, spires, logs, dead trees, ice).
Everything soft or ankle-height is deliberately NoCollision. Each build script
says which is which, and contracts.json lists the proxies that exist.

Nothing here is animated. Tier 1 props carry no clips at all; wind on
vegetation belongs in a vertex shader, not in one AnimationMixer per tuft.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402


# ---------------------------------------------------------------------------
# Foliage. Built as real tapered blades, NOT as alpha-tested crossed quads.
#
# ASSET-SPECS 3.2 described detail_cards.glb as crossed quads drawn with alpha
# test. There is no texture pipeline (section 2.8 defers one until the texture
# payload would cross 1 MB, and 41 scatter props do not get close), and an
# untextured crossed quad renders as a solid rectangle standing in the grass.
# Five triangles of actual blade is both cheaper than a texture fetch and the
# only version that reads correctly with the materials this game actually has.
# ---------------------------------------------------------------------------

def blade(height, width, azim_deg, bend, segs=3, loc=(0.0, 0.0, 0.0),
          droop=0.30):
    """One tapered, arching blade rising from `loc` and leaning along
    `azim_deg`. `segs` levels plus a tip: segs 3 is two quads and a triangle,
    which is 5 triangles for a shape that reads as grass from any angle.

    The blade is single-sided geometry on a double-sided role (Leaf/LeafDry are
    in of_lib.DOUBLE_SIDED), so one strip is visible from both faces and there
    is no back-face pass to author."""
    a = math.radians(azim_deg)
    ca, sa = math.cos(a), math.sin(a)
    px, py = -sa, ca                     # across the blade
    verts = []
    for i in range(segs):
        t = i / float(segs)
        h = bend * t * t                 # lean grows with height: an arc
        z = height * (t - droop * t * t)
        w = width * (1.0 - 0.75 * t)
        cx = loc[0] + ca * h
        cy = loc[1] + sa * h
        cz = loc[2] + z
        verts.append((cx - px * w * 0.5, cy - py * w * 0.5, cz))
        verts.append((cx + px * w * 0.5, cy + py * w * 0.5, cz))
    verts.append((loc[0] + ca * bend, loc[1] + sa * bend,
                  loc[2] + height * (1.0 - droop)))
    faces = []
    for i in range(segs - 1):
        b = i * 2
        faces.append((b, b + 1, b + 3, b + 2))
    b = (segs - 1) * 2
    faces.append((b, b + 1, len(verts) - 1))
    return verts, faces, [False] * len(faces)


def tuft(count, height, width, radius, seed, bend=0.22, segs=3, droop=0.30,
         role="Leaf", alt_role=None, alt_every=0, loc=(0.0, 0.0, 0.0),
         h_var=0.45, phase=0.0, heads=0, head_role=None, head_scale=1.45,
         head_width=0.55):
    """A ring of blades: the grass tuft, the dune grass, the fern, the kelp.

    alt_role/alt_every recolour every Nth blade, which is how a tuft gets a
    dry note without a second mesh and without leaving the palette.

    `heads` adds that many blades TALLER than the rest (height * head_scale,
    width * head_width), scattered at random angles instead of evenly spaced,
    in `head_role` if given. A tuft with every blade the same height reads as
    a trimmed hedge; a couple of seed heads breaking the top line is the
    difference between "grass" and "green fuzz"."""
    nxt = hc.rng(seed)
    p = hc.Parts()
    for i in range(count):
        a = 360.0 * i / count + phase + (nxt() - 0.5) * (360.0 / count)
        h = height * (1.0 - h_var * nxt())
        w = width * (0.7 + 0.6 * nxt())
        b = bend * (0.55 + 0.9 * nxt())
        r = radius * math.sqrt(nxt())
        aa = math.radians(a)
        base = (loc[0] + r * math.cos(aa), loc[1] + r * math.sin(aa), loc[2])
        rl = (alt_role if (alt_role and alt_every and i % alt_every == 0)
              else role)
        p.add(*blade(h, w, a, b, segs=segs, loc=base, droop=droop), role=rl)
    for k in range(heads):
        a = 360.0 * nxt() + phase
        h = height * head_scale * (0.90 + 0.20 * nxt())
        w = width * head_width
        b = bend * (0.75 + 0.5 * nxt())
        r = radius * math.sqrt(nxt()) * 0.65
        aa = math.radians(a)
        base = (loc[0] + r * math.cos(aa), loc[1] + r * math.sin(aa), loc[2])
        p.add(*blade(h, w, a, b, segs=segs + 1, loc=base, droop=droop * 0.55),
              role=head_role or role)
    return p


# ---------------------------------------------------------------------------
# Rock. The whole Tier-1 rock family is one function with different plans, so
# a beach cobble and a mountain spire share a visual language and differ only
# in proportion, facet count and which two palette roles they mix.
# ---------------------------------------------------------------------------

SPIRE_RINGS = ((0.0, 1.00), (0.50, 0.62), (0.85, 0.28))
SLAB_RINGS = ((0.0, 0.92), (0.55, 1.00), (0.88, 0.78))
DOME_RINGS = ((0.0, 0.90), (0.45, 1.00), (0.80, 0.60))

DEFAULT_PLAN = (((0.00, 0.00, 0.00), (0.52, 0.46, 0.50)),
                ((0.34, 0.16, 0.00), (0.30, 0.28, 0.31)),
                ((-0.28, -0.22, 0.00), (0.26, 0.30, 0.26)))


def rock(seed, role, facet_role=None, facets=(), lobes=3, seg=6, jit=0.20,
         plan=None, rings=None, lean_gain=0.06):
    """A faceted multi-lobe rock in an arbitrary unit box; fit() sizes it.

    `facets` is one tuple of side-facet indices per lobe, split onto
    `facet_role`. That is the boulder trick from ASSET-SPECS 4.5 reused as
    plain visual interest: a few facets in a second stone tone stop a rock
    reading as a single flat-shaded blob at 40 m."""
    p = hc.Parts()
    plan = plan or DEFAULT_PLAN
    rings = rings or DOME_RINGS
    for k in range(min(lobes, len(plan))):
        loc, r = plan[k]
        v, f, sm, roles = hc.lobe(
            r[0], r[1], r[2], loc=loc, seg=seg, seed=seed + k * 17, jit=jit,
            lean=(lean_gain * (k - 1), -lean_gain * 0.8 * k), rings=rings,
            role=role, ore_role=facet_role,
            ore_faces=facets[k] if k < len(facets) else ())
        p.add(v, f, sm, roles)
    return p


def chips(count, area, size, seed, role, alt_role=None, alt_every=0, seg=5,
          jit=0.28, z_var=0.35, loc=(0.0, 0.0, 0.0), rings=None):
    """A scattered field of small angular chips: scree, talus, rubble, a
    pebble scatter, crater debris, a shell bed. `area` is the (x, y)
    half-extent they fall inside; `size` the (x, y, z) radius of one chip."""
    nxt = hc.rng(seed)
    p = hc.Parts()
    rings = rings or DOME_RINGS
    for i in range(count):
        a = 2.0 * math.pi * i / count + (nxt() - 0.5) * 1.4
        rr = math.sqrt(nxt())
        cx = loc[0] + area[0] * rr * math.cos(a)
        cy = loc[1] + area[1] * rr * math.sin(a)
        s = 1.0 - z_var * nxt()
        rl = (alt_role if (alt_role and alt_every and i % alt_every == 0)
              else role)
        v, f, sm, roles = hc.lobe(size[0] * s, size[1] * s, size[2] * s,
                                  loc=(cx, cy, loc[2]), seg=seg, rings=rings,
                                  seed=seed + 31 * i, jit=jit, role=rl)
        p.add(v, f, sm, roles)
    return p


# ---------------------------------------------------------------------------
# Wood
# ---------------------------------------------------------------------------

def prism_x(rings, seg=7, seed=1, jit=0.14, side_role="Bark",
            cap_role="LeafDry", loc=(0.0, 0.0, 0.0)):
    """A jittered n-sided prism lying along X, caps on their own role.

    Cut wood is pale and bark is dark, and that colour break at the ends is
    the only thing that says 'fallen timber' rather than 'brown tube'. It is
    the same rule the log item and the conifer stump already follow.

    `rings` is [(x, radius, dy, dz), ...]. A mid ring with a negative dz gives
    a log that sags where it has settled into the ground, and a run of rings
    with a growing dy gives a fork branch splaying off the main stem, which is
    how driftwood and a dead tree get a second axis with no rotation
    machinery at all."""
    nxt = hc.rng(seed)
    n = max(3, seg)
    verts = []
    for (x, r, dy, dz) in rings:
        for i in range(n):
            a = 2.0 * math.pi * i / n
            rr = r * (1.0 + (nxt() * 2.0 - 1.0) * jit)
            verts.append((loc[0] + x,
                          loc[1] + dy + rr * math.cos(a),
                          loc[2] + dz + rr * math.sin(a)))
    last = (len(rings) - 1) * n
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(last, last + n))]
    roles = [cap_role, cap_role]
    for b in range(len(rings) - 1):
        lo, hi = b * n, (b + 1) * n
        for i in range(n):
            j = (i + 1) % n
            faces.append((lo + i, lo + j, hi + j, hi + i))
            roles.append(side_role)
    return verts, faces, [False] * len(faces), roles


def limb(r_bot, r_top, z0, z1, loc=(0.0, 0.0, 0.0), lean=(0.0, 0.0), seg=6,
         seed=1):
    """A tapered trunk or an angled branch stub. hc.taper's `lean` offsets the
    TOP ring, which is how a stub leaves a trunk at an angle with no rotation
    machinery at all."""
    return hc.taper(r_bot, r_top, z0, z1, loc=loc, seg=seg, lean=lean,
                    phase_deg=(seed % 7) * 13.0, smooth=False)


# ---------------------------------------------------------------------------
# The atlas driver
# ---------------------------------------------------------------------------

class Prop:
    """One scatter prop inside an atlas.

    name      node stem; the file holds <name>_LOD0 and (usually) <name>_LOD2
    size      exact LOD0 bounds in metres, Blender axes (x, y, z up)
    make      () -> hc.Parts, in any units; fit() scales it into `size`
    roles     pinned material slot order. EVERY role the parts use must be
              listed, because Parts.into() drops faces whose role is not in
              the order it is given.
    lod2      float  -> COLLAPSE decimate at that ratio (organic props)
              callable -> a second Parts pile, fitted to the same box
              None   -> no LOD2 (already at the floor: a 4-triangle card)
    collide   author a col_<name> box proxy. False means walk-through, which
              is the default for everything soft or ankle-height.
    base_z    0.0 is the ground-contact pivot every scatter prop wants.
              -size[2]/2 centres it, which only the wall-mounted ore vein
              panel needs.
    """

    def __init__(self, name, size, make, roles, lod2=0.15, collide=False,
                 col_size=None, col_role=None, base_z=0.0, note=""):
        self.name = name
        self.size = tuple(size)
        self.make = make
        self.roles = list(roles)
        self.lod2 = lod2
        self.collide = collide
        self.col_size = tuple(col_size) if col_size else tuple(size)
        self.col_role = col_role or roles[0]
        self.base_z = base_z
        self.note = note


def _check_roles(prop, parts):
    used = {r for g in parts.groups for r in g[3]}
    missing = sorted(used - set(prop.roles))
    if missing:
        raise ValueError(
            "%s uses role(s) %s that are not in its pinned order %s - "
            "Parts.into() would silently drop those faces"
            % (prop.name, missing, prop.roles))


def build_atlas(root_name, out_path, props, verbose=True):
    """Build one biome atlas: every prop as a sibling mesh on the origin."""
    of.reset_scene()
    root = of.add_root(root_name)

    reported = []
    n_col = 0
    for prop in props:
        parts = prop.make()
        _check_roles(prop, parts)
        parts.fit(prop.size, base_z=prop.base_z)
        mb = of.MeshBuilder()
        parts.into(mb, prop.roles)
        obj = mb.build(prop.name + "_LOD0", root)
        reported.append((prop.name + "_LOD0", mb))

        if callable(prop.lod2):
            lp = prop.lod2()
            _check_roles(prop, lp)
            lp.fit(prop.size, base_z=prop.base_z)
            lmb = of.MeshBuilder()
            lp.into(lmb, prop.roles)
            lmb.build(prop.name + "_LOD2", root)
            reported.append((prop.name + "_LOD2", lmb))
        elif prop.lod2:
            of.add_lod_decimate(obj, 2, prop.lod2, root)

        if prop.collide:
            of.add_collision_box("col_" + prop.name, prop.col_size,
                                 (0.0, 0.0, prop.col_size[2] * 0.5), root,
                                 role=prop.col_role)
            n_col += 1

    if verbose:
        of.report(root_name, reported)
        print("[props] %s: %d props, %d collision proxies (%d tris), "
              "walk-through: %s"
              % (root_name, len(props), n_col, n_col * 12,
                 ", ".join(p.name for p in props if not p.collide) or "none"))
    of.export_glb(out_path, export_force_sampling=False)
