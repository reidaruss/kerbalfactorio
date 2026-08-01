"""rock_form.py - fracture geometry at several scales, shared by every rock.

    boulder_common.py (the four ore boulders)
    crag_common.py    (the harvestable spire, scree, talus, rubble)

WHY THIS FILE EXISTS, AND WHY IT IS NOT harvest_common.py.

`hc.lobe` is one radius per (ring, azimuth) plus an apex: a potato. RN-73 added
`_cleaved` inside boulder_common.py to escape it, and got ONE fracture plane,
ONE cleft and ONE overhang per mass. Rendered on a studio floor those four
boulders still read as low-poly gems: large smooth facets, a convex silhouette,
and nothing at all to look at inside 1 m. Under docs/web/ART-DIRECTION.md that
is the defect, not the goal, so the vocabulary is rebuilt here and shared.

It is a NEW MODULE rather than an edit to harvest_common.py or props_common.py
on purpose. Those two are imported by every tree, bush, pool and biome atlas in
the project, and a single extra draw from one of their rng streams moves the
bytes of twenty assets that this pass has no business touching. Nothing here is
imported by anything except rock builders.

THE FIVE SCALES, LARGEST FIRST. Each one is a different mechanism, and the
point is that they compose: a mass carries all five at once, and which columns,
which facets and how deep are functions of the mass's own seed, so no two
instances repeat.

  1. THE FRACTURE PLANE (kept from RN-73). The crown is one n-gon whose height
     is z = rz * (1 + tilt.x*u + tilt.y*v), linear in the vertex's own
     normalised position, so it is planar BY CONSTRUCTION whatever the jitter
     does. `mass()` measures the deviation and raises if it is not zero.

  2. THE SHEAR PLANE, new, and it costs nothing. A vertical plane at an
     azimuth, covering a height band, that every vertex outside it is projected
     ORTHOGONALLY onto. Two adjacent clipped columns therefore span a quad that
     lies exactly IN that plane, so a second family of flat break faces appears
     with zero extra triangles. Banded by height, it becomes a corner knocked
     off the top rather than a slice through the whole rock, which is what a
     real broken corner is. Also measured, also exact.

  3. THE BEDDING LEDGE, authored in the ring profile: two rings a few per cent
     of the height apart with a step in radius between them. The upper mass
     overhangs the lower by that step all the way round. 2n triangles for a
     horizontal line that runs through the silhouette, which is the cheapest
     large-scale interest in this file.

  4. THE RIM BITE. A few crown columns, chosen from the seed, pull IN in plan
     while their neighbours do not. The top edge stops being a smooth polygon
     and starts being ragged, and because the bite moves x and y and the crown
     z is computed FROM the final x and y, the fracture plane stays exactly
     planar through it. Zero extra triangles.

  5. THE PIT. One side facet is inset and pushed in along its own normal: a
     pocket with four walls and a floor. This is the only mechanism here that
     is invisible at 30 m and it is the only one that survives at 1 m, which is
     the distance ART-DIRECTION calls out and every rock in this project has
     been empty at. Net +2(k-1) triangles for a k-sided facet.

Plus EMBEDDED CLASTS (`clast`), small angular fragments seated with their base
INSIDE the host mass so only the broken part shows, and RUBBLE (`rubble`), the
loose fragments that a friable rock sheds around its own foot.

WHAT IS DELIBERATELY NOT HERE. No albedo, no roughness, no colour and no new
palette role. Form, silhouette, asymmetry and wear are lighting-independent and
are done now; values are owed to the look-development pass and are not guessed
at here (ART-DIRECTION, sequencing rule).

RING JITTER AND THE FLAT-FACET RULE IT RELAXES. RN-73 shared ONE radius wobble
per column across every ring so that each side quad was an exact cone-frustum
facet, i.e. flat, on the argument that flat facets read cleanly at 30 m.
`ring_jit` re-rolls a small extra factor per (ring, column), which makes a side
quad slightly bent, so the exporter's triangulation splits it into two
triangles with genuinely different normals. That DOUBLES the number of distinct
lit facets on the body for zero extra triangles. The old argument was a
readability argument and ART-DIRECTION says readability arguments have to be
restated in terms of detail; this is the restatement. The crown and the shear
faces stay exactly flat, because those are the ones that carry the silhouette.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harvest_common as hc    # noqa: E402


# Ring profiles: (z fraction, radius factor) below the fracture plane.
R1 = ((0.00, 1.00),)
R2 = ((0.00, 1.00), (0.48, 1.06))
R3 = ((0.00, 1.00), (0.30, 1.08), (0.64, 0.95))

# A bedding ledge: rings 1 and 2 are 5% of the height apart with a 0.20 step in
# radius, so the upper body overhangs the lower all the way round.
BED4 = ((0.00, 0.96), (0.26, 1.10), (0.31, 0.90), (0.66, 0.96))
# Two ledges, for a mass that should read as stacked strata.
BED5 = ((0.00, 0.98), (0.20, 1.08), (0.25, 0.88),
        (0.55, 0.94), (0.60, 0.78))
# Near-prismatic: a block, not a cone. Coal and slabby stone want this.
BLOCK3 = ((0.00, 1.00), (0.34, 1.02), (0.70, 0.99))
# Nodular: bulges rather than steps, for a rock that weathered instead of
# shattering. Copper.
NODE4 = ((0.00, 0.84), (0.22, 1.06), (0.52, 1.02), (0.78, 0.86))

# The planarity budget. Both the crown and every shear face are placed by an
# exact formula, so the honest bar is float noise and not a tolerance.
FLAT_EPS = 1e-9

# Anti-coincidence stagger between the flat BASE n-gons of the fragments in one
# pile, in local units, applied by index so it is derived rather than typed.
#
# Every mass in a pile stands on z = 0 and they interpenetrate on purpose,
# so two bases in different palette roles end up coplanar, same-facing (both
# pointing down) and overlapping: exactly the pair check_coplanar.py gates on.
# It is buried geometry and no camera above ground can see it, but this game
# digs tunnels, so a player CAN get under a boulder, and a z-fight there would
# be a real flicker with nothing in the build to explain it. Two orders of
# magnitude above the checker's PLANE_EPS of 1e-5 m and two orders below a
# pixel at any distance a rock is drawn at.
BASE_DZ = 0.0015

# Largest planarity deviation seen since the last reset, in local units. Build
# scripts print it, which is what makes the claim a measurement rather than a
# comment.
DEV = {"crown": 0.0, "shear": 0.0, "crowns": 0, "shears": 0}


def reset_dev():
    DEV.update({"crown": 0.0, "shear": 0.0, "crowns": 0, "shears": 0})


def _wob(nxt, amount):
    """Multiplicative wobble in [1-amount, 1+amount]."""
    return 1.0 + (nxt() * 2.0 - 1.0) * amount


def _newell(pts):
    """Unit polygon normal by Newell's method: correct for a bent polygon,
    where a three-vertex cross product is not."""
    nx = ny = nz = 0.0
    m = len(pts)
    for i in range(m):
        a, b = pts[i], pts[(i + 1) % m]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    d = math.sqrt(nx * nx + ny * ny + nz * nz)
    if d < 1e-12:
        return (0.0, 0.0, 1.0)
    return (nx / d, ny / d, nz / d)


def _pit(verts, faces, smooth, roles, fi, inset, depth):
    """Inset facet `fi` and push the inset ring in along the facet normal.

    The facet becomes the pocket FLOOR (same winding, so it still faces out)
    and k walls are appended. Wall winding is (outer i, outer j, inner j,
    inner i), which is the order whose normal points back toward the pocket
    axis; the reverse of it faces away and leaves the pocket looking like a
    stud rather than a hole, which is worth stating because both windings
    export without complaint and only one of them is a pit."""
    f = faces[fi]
    pts = [verts[i] for i in f]
    k = len(f)
    nrm = _newell(pts)
    cx = sum(p[0] for p in pts) / k
    cy = sum(p[1] for p in pts) / k
    cz = sum(p[2] for p in pts) / k
    base = len(verts)
    for p in pts:
        verts.append((p[0] + (cx - p[0]) * inset - nrm[0] * depth,
                      p[1] + (cy - p[1]) * inset - nrm[1] * depth,
                      p[2] + (cz - p[2]) * inset - nrm[2] * depth))
    role = roles[fi]
    faces[fi] = tuple(range(base, base + k))
    for i in range(k):
        j = (i + 1) % k
        faces.append((f[i], f[j], base + j, base + i))
        smooth.append(False)
        roles.append(role)


def mass(rx, ry, rz, loc=(0.0, 0.0, 0.0), seg=7, seed=1, jit=0.15,
         rings=R2, top=0.56, tilt=(0.55, 0.0), notch=None, ring_jit=0.07,
         rim_bites=0, bite_keep=(0.54, 0.84), flank_bites=0,
         flank_keep=(0.60, 0.86), lean=(0.0, 0.0), shears=(), pits=0,
         crown_pit=0.0, pit_inset=0.42, pit_depth=0.11, role="Rock",
         ore_role=None, seam=None):
    """One broken mass carrying all five scales of fracture.

    rings       (z fraction, radius factor) per ring BELOW the break.
    top         radius factor of the ring the break cuts through.
    tilt        (u, v) gradient of the fracture plane in units of rz per unit
                of normalised x and y. 0.55 tips the facet by about 30 degrees.
    notch       (azimuth fraction, radius factor): the cleft, one column, full
                depth at the crown and half at the foot, which is how a split
                propagates.
    ring_jit    per (ring, column) extra radius factor. Bends the side quads.
    rim_bites   how many crown columns are bitten back in plan.
    flank_bites how many single (ring, column) vertices on the BODY are pulled
                in hard. One vertex, so it is a dent with a kink in the
                silhouette either side of it rather than a smooth taper, and
                it costs nothing: the vertex is already there. This is the
                mechanism that stops the profile between the ledges reading as
                a cone, and it is deliberately sparse and deep rather than
                dense and shallow, because dense and shallow is what `jit`
                already does and what makes a rock read as a potato.
    lean        (dx, dy) offset of the top of the mass relative to its base,
                applied in proportion to height. A leaning block is the
                cheapest asymmetry there is, and every rock in this file
                standing bolt upright was one of the reasons they read as a
                set of gems on a shelf.
    shears      ((azimuth fraction, offset, z_lo, z_hi), ...) vertical fracture
                planes. `offset` is the plane's distance from the mass centre
                in LOCAL units, so a smaller number cuts deeper. z_lo/z_hi are
                ring z fractions, and 1.0 means the crown.
    pits        how many side facets become pockets.
    crown_pit   depth, as a fraction of rz, of ONE pocket sunk into the middle
                of the fracture plane itself; 0 for none. The crown is the
                largest and flattest facet a low rock has and it is the one
                the player looks down on, so it is the worst place to leave
                empty. The rim vertices are untouched, so the plane the
                planarity check measures is exactly the plane it was.
    seam        (azimuth fraction, column count, band indices, use plane):
                which facets carry the ore. Consecutive columns on purpose, a
                vein reads and scattered chips read as noise.

    Returns (verts, faces, smooth_flags, per_face_roles).
    """
    nxt = hc.rng(seed)
    n = max(3, seg)
    nr = len(rings)

    # One azimuth and one radius wobble per COLUMN, so the body keeps its
    # cone-frustum skeleton, plus a small per (ring, column) re-roll that bends
    # each quad off that skeleton. See the module docstring.
    az = [2.0 * math.pi * i / n + (nxt() - 0.5) * (2.0 * math.pi / n) * 0.62
          for i in range(n)]
    rw = [_wob(nxt, jit) for _ in range(n)]
    zw = [_wob(nxt, 0.05) for _ in range(nr)]
    rj = [[_wob(nxt, ring_jit) for _ in range(n)] for _ in range(nr + 1)]

    cut = [1.0] * n
    if notch:
        cut[int(round(notch[0] * n)) % n] = notch[1]

    bite = [1.0] * n
    for _ in range(rim_bites):
        c = int(nxt() * n) % n
        bite[c] = bite_keep[0] + (bite_keep[1] - bite_keep[0]) * nxt()

    flank = {}
    for _ in range(flank_bites):
        b = int(nxt() * nr) % nr
        c = int(nxt() * n) % n
        flank[(b, c)] = flank_keep[0] + (flank_keep[1] - flank_keep[0]) * nxt()

    def clip(x, y, zf):
        """Project (x, y) onto every shear plane whose band covers zf."""
        for (a_frac, off, z_lo, z_hi) in shears:
            if zf < z_lo - 1e-9 or zf > z_hi + 1e-9:
                continue
            a = 2.0 * math.pi * a_frac
            nx, ny = math.cos(a), math.sin(a)
            s = (x - loc[0]) * nx + (y - loc[1]) * ny
            if s > off:
                x -= (s - off) * nx
                y -= (s - off) * ny
        return x, y

    verts = []
    on_shear = []                      # (vertex index, plane index)
    for b, (zf, rf) in enumerate(rings):
        z = rz * zf * (1.0 if zf == 0.0 else zw[b])
        # The groove is half depth where the rock meets the ground and full
        # depth at the crown, which is the way a split actually runs.
        relief = 0.5 if zf == 0.0 else 0.0
        for i in range(n):
            r = (rf * rw[i] * rj[b][i] * flank.get((b, i), 1.0)
                 * (cut[i] + (1.0 - cut[i]) * relief))
            x = loc[0] + rx * r * math.cos(az[i]) + lean[0] * zf
            y = loc[1] + ry * r * math.sin(az[i]) + lean[1] * zf
            x2, y2 = clip(x, y, zf)
            if x2 != x or y2 != y:
                on_shear.append((len(verts), zf))
            verts.append((x2, y2, loc[2] + z))

    crown = len(verts)
    for i in range(n):
        r = top * rw[i] * rj[nr][i] * cut[i] * bite[i]
        x = loc[0] + rx * r * math.cos(az[i]) + lean[0]
        y = loc[1] + ry * r * math.sin(az[i]) + lean[1]
        x2, y2 = clip(x, y, 1.0)
        if x2 != x or y2 != y:
            on_shear.append((len(verts), 1.0))
        # z LAST, from the final x and y, so a bite or a shear slides the
        # vertex ALONG the fracture plane instead of off it.
        verts.append((x2, y2,
                      loc[2] + rz * (1.0 + tilt[0] * ((x2 - loc[0]) / rx)
                                     + tilt[1] * ((y2 - loc[1]) / ry))))

    faces = [tuple(range(n - 1, -1, -1))]          # flat base, normal down
    sides = []
    for b in range(nr):
        lo, hi = b * n, (b + 1) * n                # last band meets the crown
        for i in range(n):
            j = (i + 1) % n
            sides.append(len(faces))
            faces.append((lo + i, lo + j, hi + j, hi + i))
    plane = len(faces)
    faces.append(tuple(range(crown, crown + n)))   # the fracture plane
    smooth = [False] * len(faces)

    roles = [role] * len(faces)
    if ore_role and seam:
        az_frac, count, bands, on_plane = seam
        i0 = int(round(az_frac * n)) % n
        for k in range(count):
            for b in bands:
                roles[sides[(b % nr) * n + (i0 + k) % n]] = ore_role
        if on_plane:
            roles[plane] = ore_role

    # --- the two exactness claims, measured rather than asserted in prose ----
    dev = 0.0
    for i in range(crown, crown + n):
        x, y, z = verts[i]
        want = loc[2] + rz * (1.0 + tilt[0] * ((x - loc[0]) / rx)
                              + tilt[1] * ((y - loc[1]) / ry))
        dev = max(dev, abs(z - want))
    if dev > FLAT_EPS:
        raise ValueError("fracture plane is not planar: %.3e" % dev)
    DEV["crown"] = max(DEV["crown"], dev)
    DEV["crowns"] += 1

    for (vi, zf) in on_shear:
        x, y, _ = verts[vi]
        best = None
        for (a_frac, off, z_lo, z_hi) in shears:
            if zf < z_lo - 1e-9 or zf > z_hi + 1e-9:
                continue
            a = 2.0 * math.pi * a_frac
            s = ((x - loc[0]) * math.cos(a) + (y - loc[1]) * math.sin(a))
            d = abs(s - off)
            best = d if best is None else min(best, d)
        if best is not None:
            if best > FLAT_EPS:
                raise ValueError("shear face is not planar: %.3e" % best)
            DEV["shear"] = max(DEV["shear"], best)
    if shears:
        DEV["shears"] += 1

    # --- the smallest scale, applied last so `sides` stays valid -------------
    if crown_pit:
        # A crown pan is inset FURTHER than a flank pocket. A flank facet is a
        # tall narrow quad and a pocket taking 58% of it still reads as a
        # pocket; the crown is the widest facet on the mass, and the same
        # fraction there is a cauldron rather than a weathering pan.
        _pit(verts, faces, smooth, roles, plane,
             min(0.66, pit_inset + 0.18), crown_pit * rz)
    used = set()
    for _ in range(pits):
        k = int(nxt() * len(sides)) % len(sides)
        for step in range(len(sides)):
            fi = sides[(k + step) % len(sides)]
            if fi not in used:
                used.add(fi)
                _pit(verts, faces, smooth, roles, fi,
                     pit_inset, pit_depth * rz)
                break
    return verts, faces, smooth, roles


def radius_at(rings, top, zf):
    """The mass's own radius factor at height fraction `zf`, interpolated from
    the ring profile it was built with, with the crown counted as a ring at
    zf = 1.0 with factor `top`.

    This exists so that a clast is positioned by DERIVING the host surface
    rather than by transcribing a coordinate. Two parts dimensioned off the
    same landmark by hand is the catalogued defect class on this project, and a
    fragment glued to a rock is exactly that shape: change the rock's profile
    and every hand-typed fragment position is silently wrong, in a way that
    looks like a rendering bug."""
    prof = list(rings) + [(1.0, top)]
    if zf <= prof[0][0]:
        return prof[0][1]
    for k in range(len(prof) - 1):
        z0, r0 = prof[k]
        z1, r1 = prof[k + 1]
        if z0 <= zf <= z1:
            t = 0.0 if z1 - z0 < 1e-9 else (zf - z0) / (z1 - z0)
            return r0 + (r1 - r0) * t
    return prof[-1][1]


def clast(rx, ry, rz, loc, seed, seg=5, jit=0.30, rings=R1, top=0.76,
          tilt=(0.28, 0.18), spin=0.0, roll=0.0, ring_jit=0.10,
          role="Rock"):
    """A small angular fragment SET INTO a host mass.

    The whole point is that its base is inside the host and never drawn, so
    what shows is a broken corner budding out of a flat facet. That is a
    breccia read, and it is the one kind of small detail that survives a
    decimator, because it is real geometry rather than a normal map.

    Returned as a Parts so it can be rotated freely: unlike a mass standing on
    the ground it is NOT re-seated, because a clast that sits level is a pebble
    glued on."""
    v, f, sm, rl = mass(rx, ry, rz, loc=loc, seg=seg, seed=seed, jit=jit,
                        rings=rings, top=top, tilt=tilt, ring_jit=ring_jit,
                        role=role)
    p = hc.Parts().add(v, f, sm, rl)
    if roll:
        p.rotate("Y", roll, pivot=loc)
    if spin:
        p.rotate("Z", spin, pivot=loc)
    return p


def rubble(count, area, size, seed, role, alt_role=None, alt_every=0,
           loc=(0.0, 0.0, 0.0), seg=5, jit=0.34, rings=None, tilt=(0.5, 0.2),
           z_var=0.45, sink=0.30, pits=0):
    """The loose fragments a rock sheds around its own foot: scree, talus,
    the crumbs under a friable seam.

    Every fragment is a real `mass`, so it carries a fracture plane and a bent
    body like everything else here, and each is SUNK by `sink` of its own
    height so it reads as lying in the ground rather than balanced on it. Sunk
    geometry below z = 0 is fine on a boulder pile, which is fitted as a whole;
    a caller that needs the pile to start at zero passes sink = 0."""
    nxt = hc.rng(seed)
    rings = rings or R1
    p = hc.Parts()
    for i in range(count):
        a = 2.0 * math.pi * i / count + (nxt() - 0.5) * 1.6
        rr = math.sqrt(nxt())
        s = 1.0 - z_var * nxt()
        cx = loc[0] + area[0] * rr * math.cos(a)
        cy = loc[1] + area[1] * rr * math.sin(a)
        rl = (alt_role if (alt_role and alt_every and i % alt_every == 0)
              else role)
        h = size[2] * s
        v, f, sm, roles = mass(size[0] * s, size[1] * s, h,
                               loc=(cx, cy, loc[2] - h * sink + i * BASE_DZ),
                               seg=seg, seed=seed + 31 * i, jit=jit,
                               rings=rings, top=0.50,
                               tilt=(tilt[0] * (nxt() * 2.0 - 1.0),
                                     tilt[1] * (nxt() * 2.0 - 1.0)),
                               ring_jit=0.12, rim_bites=1, pits=pits,
                               role=rl)
        p.add(v, f, sm, roles)
    return p


def place(p, e, roles_by_key, seed):
    """Build one plan entry into the pile `p`, tipping it if it wants to.

    A plan entry is a dict of `mass` keyword arguments plus:
      role   a key into roles_by_key, so a plan can be written once and reused
             by four kinds that put different palette roles in the same slots
      tip    degrees about Y, base included, then RE-SEATED on whatever corner
             ended up lowest. The base plane is then inclined and stands off
             the ground on the far side, and that gap is the overhang. Note
             Parts.fit() re-pins the pile AABB base to z = 0 (RN-68), so a
             deliberate SINK is impossible and is not attempted; re-seating
             moves the pile minimum nowhere, so fit() has nothing to undo.
      spin   degrees about Z, applied after the tip, no re-seat needed
      clasts ((azimuth fraction, height fraction, size fraction, roll, spin),
             ...) fragments set into the host. Position and size are DERIVED
             from the host's own radii and its own ring profile through
             radius_at(), never typed in: `embed` then pushes the fragment
             0.45 of its own width back inside, so what shows is the part that
             broke off rather than a pebble balanced on a face.

    CLASTS ARE WELDED ON BEFORE THE TIP, not after, and the ordering is
    load-bearing rather than tidy: a clast is authored at a point on the
    UNTIPPED mass's surface, so rotating the host afterwards without it would
    leave the fragment hanging in the air beside the rock. Building the whole
    block first and rolling it as one is also what re-seating means, and the
    bounds the re-seat reads therefore include the fragments.
    """
    kw = {k: v for k, v in e.items()
          if k not in ("role", "tip", "spin", "clasts", "r", "loc")}
    body = roles_by_key[e.get("role", "body")]
    v, f, sm, roles = mass(e["r"][0], e["r"][1], e["r"][2], loc=e["loc"],
                           seed=seed, role=body,
                           ore_role=roles_by_key.get("ore"), **kw)
    sub = hc.Parts().add(v, f, sm, roles)
    rx, ry, rz = e["r"]
    prof = kw.get("rings", R2)
    ptop = kw.get("top", 0.56)
    for k, c in enumerate(e.get("clasts", ())):
        az_frac, z_frac, size, croll, cspin = c
        a = 2.0 * math.pi * az_frac
        rf = radius_at(prof, ptop, z_frac)
        crx, cry, crz = rx * size, ry * size, rz * size
        embed = 0.62
        cx = e["loc"][0] + (rx * rf - crx * embed) * math.cos(a)
        cy = e["loc"][1] + (ry * rf - cry * embed) * math.sin(a)
        cz = e["loc"][2] + rz * z_frac - crz * 0.5
        sub.extend(clast(crx, cry, crz, (cx, cy, cz), seed + 601 + k * 37,
                         roll=croll, spin=cspin, role=body))
    tip = e.get("tip", 0.0)
    if tip:
        sub.rotate("Y", tip, pivot=e["loc"])
        lo, _ = sub.bounds()
        sub.translate(dz=e["loc"][2] - lo[2])
    if e.get("spin"):
        sub.rotate("Z", e["spin"], pivot=e["loc"])
    return p.extend(sub)
