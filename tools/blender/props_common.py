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
# Foliage card UVs: AUTHORED, unit space, for the alpha-tested card textures
# in assets/textures/dist/surfaces.json (albedo families "grass" and "leaf",
# uv_space "unit", wrap u repeat / v clamp, alpha_test 0.35).
#
# Every foliage-role face gets a hand-authored UV in the [0, 1] card space
# instead of the box-projected metre UVs everything else carries. Nothing in
# the client samples these yet, so the change is visually inert until the
# material switch lands; the validator's per-asset `uv_authored_materials`
# list is what exempts these primitives from the uv_metres equality.
#
# FOLIAGE_TIP_V is the ONE orientation constant: in Blender UV space, BEFORE
# the glTF exporter's v flip (v -> 1 - v), a blade TIP gets v = FOLIAGE_TIP_V
# and a base gets 1 - FOLIAGE_TIP_V. The PNG/Blender/glTF flip stack has three
# places to be wrong about which end of the card is the tip, and it will be
# verified IN ENGINE once the client actually samples these UVs; if the stack
# turns out inverted, flipping this constant to 0.0 and rebuilding the ten
# foliage assets is the whole fix. Shell and cut-face helpers below route
# their v through the same constant so the flip is global.
FOLIAGE_TIP_V = 1.0

# The six palette roles that wear a card texture, and which family each one
# samples: OF_Grass wears "grass" (a bundle of ~11 blades, so one geometric
# blade maps a NARROW vertical band of it); every OF_Leaf* wears "leaf" (ONE
# full frond, so a strip spans the full card width); OF_Canopy wears "canopy"
# (ONE whole tree crown, RN-2245, and it is mapped by exactly one thing in the
# project -- `build_props_canopy.py`'s `_impostor`, which passes its UVs
# explicitly through `quad_card_uvs`, so nothing in the canopy path actually
# consults this set. It is listed anyway because the set's docstring is a claim
# about which roles wear a card, and an incomplete claim is a lie in waiting.)
FOLIAGE_ROLES = {"Grass", "Leaf", "LeafDeep", "LeafLight", "LeafDry", "Canopy"}

# Half-width in u of the band one grass blade samples from the grass bundle
# texture. 0.045 is about one blade of the ~11 in the card.
GRASS_BAND_HALF_U = 0.045


def _hash01(key):
    """Deterministic int -> [0, 1) hash, independent of every hc.rng stream.

    UV variety (band centres, mirrors, shell phases) must NOT draw from the
    rng streams the geometry already consumes: one extra draw would shift
    every position generated after it and the rebuild would no longer be
    byte-identical in POSITION, which is the invariant this whole pass is
    built on. So UVs hash the parameters the builders already have."""
    h = (int(key) * 2654435761) & 0xFFFFFFFF
    h = (h * 1664525 + 1013904223) & 0xFFFFFFFF
    h = (h ^ (h >> 16)) * 2246822519 & 0xFFFFFFFF
    return (h & 0xFFFFFFFF) / 4294967296.0


def _tip_v(t):
    """t = 0 at a base, 1 at a tip -> the Blender-space v that end carries,
    routed through FOLIAGE_TIP_V so a global orientation flip is one line."""
    return (1.0 - FOLIAGE_TIP_V) + (2.0 * FOLIAGE_TIP_V - 1.0) * t


def blade_uvs(role, segs, key):
    """Per-vertex UVs for one blade() strip: segs pairs plus a tip vertex.

    Grass-family blades (role Grass) map a narrow vertical band of the grass
    bundle texture: centre u0 is a deterministic hash in [0, 1) and u wraps,
    so a band crossing 1.0 is fine. Leaf-family blades span the full card
    width (centreline u = 0.5) with a deterministic per-blade u-mirror for
    variety. v runs base -> tip along the strip's own length."""
    if role == "Grass":
        u0 = _hash01(key)
        ul, ur, ut = u0 - GRASS_BAND_HALF_U, u0 + GRASS_BAND_HALF_U, u0
    else:
        ul, ur = (1.0, 0.0) if _hash01(key * 2 + 1) < 0.5 else (0.0, 1.0)
        ut = 0.5
    uvs = []
    for i in range(segs):
        v = _tip_v(i / float(segs))
        uvs.append((ul, v))
        uvs.append((ur, v))
    uvs.append((ut, _tip_v(1.0)))
    return uvs


def shell_uvs(verts, seed, centre=(0.0, 0.0), u_scale=3.0, u_off=0.0,
              v_lo=0.10, v_hi=0.90, v_ripple=0.0):
    """Per-vertex UVs for a closed shell or mass (canopy_mass, blob, lobe,
    taper): u is azimuth about `centre` at three repeats around (u wraps in
    the sampler, and the one face that crosses the atan2 seam interpolates
    backwards across the repeats, which a repeating leaf texture absorbs),
    v is normalized elevation mapped into [v_lo, v_hi] so the clamped v rows
    at 0 and 1 are never sampled. The azimuth phase comes from a hash of the
    seed the mass was already built with: no new randomness sources.

    u_scale/u_off narrow the azimuth sweep: a stalk or stem that must stay on
    the card's opaque centreline uses u_off 0.455, u_scale 0.09 (one narrow
    band around u = 0.5) instead of the default three full repeats.

    v_ripple adds a small azimuth-keyed v variation. A cone's flat base fan
    sits at ONE elevation, and when that fan is the only face its role owns in
    the mesh (the LOD2 canopy undersides) its primitive would have zero v
    span, which the validator rightly rejects as a stub. The ripple hands it a
    real extent; on a repeating canopy texture the wobble is invisible."""
    zs = [p[2] for p in verts]
    z0, z1 = min(zs), max(zs)
    span = z1 - z0
    ph = _hash01(seed)
    out = []
    for (x, y, z) in verts:
        az = math.atan2(y - centre[1], x - centre[0])
        f = (az / (2.0 * math.pi) + ph) % 1.0
        t = (z - z0) / span if span > 1e-9 else 0.5
        vv = v_lo + (v_hi - v_lo) * t
        if v_ripple:
            vv = min(v_hi, vv + v_ripple * abs(f * 2.0 - 1.0))
        out.append((u_off + u_scale * f, _tip_v(vv)))
    return out


def disc_uvs(verts, plane="xy", r=0.08, at=(0.5, 0.45)):
    """Per-vertex UVs for a CUT FACE that happens to sit on a foliage role:
    stump sapwood n-gons, snapped-branch and log end caps. These are wood,
    not leaves, but Parts.into() folds them into the foliage-role primitive,
    so once that primitive alpha-tests a card texture they must sample
    somewhere OPAQUE. A small disc around the card's centre (the frond's own
    midrib, the densest part of the grass bundle) is the least-wrong patch
    available, and it keeps the validator's nonzero-span rule honest.
    `plane` picks the two axes the ring lies in ("yz" for a log along X)."""
    i, j = {"xy": (0, 1), "yz": (1, 2), "xz": (0, 2)}[plane]
    n = max(1, len(verts))
    ci = sum(p[i] for p in verts) / n
    cj = sum(p[j] for p in verts) / n
    out = []
    for p in verts:
        a = math.atan2(p[j] - cj, p[i] - ci)
        out.append((at[0] + r * math.cos(a), at[1] + r * math.sin(a)))
    return out


def quad_card_uvs(nquads, key):
    """Per-vertex UVs for `nquads` four-corner leaf cards whose corners run
    (-u,-v), (+u,-v), (+u,+v), (-u,+v): each card shows the full leaf texture
    once, upright, with a deterministic per-card u-mirror."""
    out = []
    for q in range(nquads):
        u0, u1 = (1.0, 0.0) if _hash01(key + 7919 * q) < 0.5 else (0.0, 1.0)
        vb, vt = _tip_v(0.0), _tip_v(1.0)
        out += [(u0, vb), (u1, vb), (u1, vt), (u0, vt)]
    return out


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
          droop=0.30, twist=0.0, kink=0.0):
    """One tapered, arching blade rising from `loc` and leaning along
    `azim_deg`. `segs` levels plus a tip: segs 3 is two quads and a triangle,
    which is 5 triangles for a shape that reads as grass from any angle.

    The blade is single-sided geometry on a double-sided role (Leaf/LeafDry are
    in of_lib.DOUBLE_SIDED), so one strip is visible from both faces and there
    is no back-face pass to author.

    TWO SHAPE ARGUMENTS ADDED AT RN-302, BOTH OPTIONAL, BOTH COSTING ZERO
    TRIANGLES, and both defaulting to a branch that is not taken, so every
    existing caller rebuilds byte-identical. They exist because the ground layer
    is the single most instanced geometry in the game (Registry's GROUND_DETAIL
    sums to 3.2 million per square kilometre after DENSITY_SCALE) and is
    therefore the one place where a triangle cannot be spent, which leaves only
    shape arguments that move vertices that already exist.

    `twist` rolls the blade's CROSS SECTION about its own long axis, in radians
    over the blade's full length: the strip leaves the ground face on and
    presents an edge partway up. This is the closest thing to a free silhouette
    that a three-triangle strip has. A flat strip is a parallelogram from every
    direction and its outline is a function of the viewer only, which is RN-271's
    solid-of-revolution defect wearing a different shape: the scatter yaws every
    instance (`ScatterEmit.ts:153`) and a card of untwisted blades gives that
    yaw almost nothing to act on. A twisted blade also catches light along part
    of its length and not the rest, which is the thing a real grass field does
    that a field of flat strips cannot.

    `kink` displaces the blade's CENTRELINE sideways, perpendicular to the plane
    it arches in, growing with t^2. Without it a blade is a PLANAR arc: bend and
    droop both act in the one vertical plane through `azim_deg`, so however much
    a blade leans it never leaves that plane, and a tuft is a set of flat fans
    at different bearings. Callers pass a signed value so a tuft can lean its
    blades both ways rather than curling them all one way, which reads as a
    whorl.
    """
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
        if kink:
            k = kink * t * t
            cx += px * k
            cy += py * k
        if twist:
            # Roll about the blade's own bearing (ca, sa, 0). The across vector
            # is perpendicular to that axis, so Rodrigues collapses to a plain
            # cosine on the horizontal part and a sine straight up.
            th = twist * t
            ct, st = math.cos(th), math.sin(th)
            ax, ay, az = px * ct, py * ct, st
            verts.append((cx - ax * w * 0.5, cy - ay * w * 0.5,
                          cz - az * w * 0.5))
            verts.append((cx + ax * w * 0.5, cy + ay * w * 0.5,
                          cz + az * w * 0.5))
        else:
            verts.append((cx - px * w * 0.5, cy - py * w * 0.5, cz))
            verts.append((cx + px * w * 0.5, cy + py * w * 0.5, cz))
    if kink:
        verts.append((loc[0] + ca * bend + px * kink,
                      loc[1] + sa * bend + py * kink,
                      loc[2] + height * (1.0 - droop)))
    else:
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
         head_width=0.55, twist=0.0, kink=0.0, droop_var=0.0, lean_var=0.0):
    """A ring of blades: the grass tuft, the dune grass, the fern, the kelp.

    alt_role/alt_every recolour every Nth blade, which is how a tuft gets a
    dry note without a second mesh and without leaving the palette.

    `heads` adds that many blades TALLER than the rest (height * head_scale,
    width * head_width), scattered at random angles instead of evenly spaced,
    in `head_role` if given. A tuft with every blade the same height reads as
    a trimmed hedge; a couple of seed heads breaking the top line is the
    difference between "grass" and "green fuzz".

    FOUR PER-BLADE VARIATION ARGUMENTS ADDED AT RN-303, ALL ZERO TRIANGLES.
    `twist` and `kink` are blade()'s own, given here as MAGNITUDES that each
    blade draws its own signed share of; `droop_var` lets a blade arch over
    further than its neighbours, up to `droop + droop_var`; `lean_var` scales
    the blade's outward `bend` beyond the existing 0.55 to 1.45 band, which is
    what makes one blade in a clump flop right out of it.

    THEY DRAW FROM `_hash01`, NOT FROM `nxt`, AND THAT IS NOT A STYLE CHOICE.
    Every value in this function comes off one seeded LCG in a fixed order, so a
    single extra `nxt()` call shifts every position generated after it and the
    whole file stops rebuilding byte-identical. `_hash01` was added for exactly
    that reason when the authored UVs landed, and it is reused here so that
    these four arguments at their defaults leave the existing thirty-odd callers
    bit-for-bit unchanged. The keys are offsets of the same
    `seed * 131071 + i` the UVs already use, so no new seed constants enter the
    file either.

    WHY A GRASS CARD NEEDED THIS AT ALL. h_var already varies height and the
    ring azimuth is already jittered, so a tuft was varied in the two ways that
    are cheapest to write and it was IDENTICAL in every way that shows: every
    blade a flat strip, arching in its own vertical plane, by the same fraction,
    to the same droop. Ground cover authored like that reads as a mown lawn of
    spikes at any density you scatter it at, and no amount of scatter jitter
    fixes it because the repetition is inside the one card.
    """
    nxt = hc.rng(seed)
    p = hc.Parts()

    def _shape(key, base_droop, base_bend):
        """Per-blade (droop, bend, twist, kink) off the hash stream."""
        d = base_droop + droop_var * _hash01(key + 17)
        bb = base_bend * (1.0 + lean_var * (_hash01(key + 29) * 2.0 - 1.0))
        tw = twist * (_hash01(key + 41) * 2.0 - 1.0)
        kk = kink * (_hash01(key + 53) * 2.0 - 1.0)
        return d, bb, tw, kk

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
        key = seed * 131071 + i
        dp, b, tw, kk = _shape(key, droop, b)
        p.add(*blade(h, w, a, b, segs=segs, loc=base, droop=dp, twist=tw,
                     kink=kk), role=rl,
              uvs=(blade_uvs(rl, segs, key)
                   if rl in FOLIAGE_ROLES else None))
    for k in range(heads):
        a = 360.0 * nxt() + phase
        h = height * head_scale * (0.90 + 0.20 * nxt())
        w = width * head_width
        b = bend * (0.75 + 0.5 * nxt())
        r = radius * math.sqrt(nxt()) * 0.65
        aa = math.radians(a)
        base = (loc[0] + r * math.cos(aa), loc[1] + r * math.sin(aa), loc[2])
        hr = head_role or role
        key = seed * 131071 + count + k
        dp, b, tw, kk = _shape(key, droop * 0.55, b)
        p.add(*blade(h, w, a, b, segs=segs + 1, loc=base, droop=dp, twist=tw,
                     kink=kk),
              role=hr,
              uvs=(blade_uvs(hr, segs + 1, key)
                   if hr in FOLIAGE_ROLES else None))
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
        # A moss or lichen facet is a foliage-role face on a stone lobe: it
        # gets shell UVs (authored card space), the stone keeps its metres.
        foliage = {rl for rl in roles if rl in FOLIAGE_ROLES}
        p.add(v, f, sm, roles,
              uvs=(shell_uvs(v, seed + k * 17, centre=(loc[0], loc[1]))
                   if foliage else None),
              uv_roles=foliage or None)
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
    # The pale cut ends usually sit on a foliage role (LeafDry); once that
    # role wears an alpha-tested card they must sample an opaque patch, so
    # the caps get disc UVs in the ring plane (YZ: the prism lies along X)
    # and the bark sides keep their box-projected metres.
    uvs = uv_roles = None
    if cap_role in FOLIAGE_ROLES:
        uvs = disc_uvs(verts, plane="yz")
        uv_roles = {cap_role}
    return verts, faces, [False] * len(faces), roles, uvs, uv_roles


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
    lod3      RN-2202, THE IMPOSTOR RUNG. callable -> a third Parts pile,
              fitted to the SAME box, exported as <name>_LOD3; None (the
              default) -> the prop has no impostor and the client's ladder
              walks back down to its LOD2, which is exactly what every atlas
              did before this rung existed. Only a callable is accepted: a
              decimate ratio cannot produce a card, and the whole point of
              this rung is that it is a hand-authored silhouette rather than
              a smaller version of the same mesh.
    collide   author a col_<name> box proxy. False means walk-through, which
              is the default for everything soft or ankle-height.
    base_z    0.0 is the ground-contact pivot every scatter prop wants.
              -size[2]/2 centres it, which only the wall-mounted ore vein
              panel needs.
    """

    def __init__(self, name, size, make, roles, lod2=0.15, lod3=None,
                 collide=False, col_size=None, col_role=None, base_z=0.0,
                 note=""):
        self.name = name
        self.size = tuple(size)
        self.make = make
        self.roles = list(roles)
        self.lod2 = lod2
        self.lod3 = lod3
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

        # RN-2202. The impostor rung, emitted by exactly the same three lines
        # LOD2 takes and fitted to the SAME box, so a rung cannot drift off the
        # footprint its neighbours share. Absent by default: an atlas that
        # names no lod3 exports no _LOD3 node and its bytes do not move.
        if callable(prop.lod3):
            ip = prop.lod3()
            _check_roles(prop, ip)
            ip.fit(prop.size, base_z=prop.base_z)
            imb = of.MeshBuilder()
            ip.into(imb, prop.roles)
            imb.build(prop.name + "_LOD3", root)
            reported.append((prop.name + "_LOD3", imb))

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
