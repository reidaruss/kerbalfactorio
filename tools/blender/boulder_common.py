"""boulder_common.py - the four ore boulders, four broken forms, one mineral read.

    build_boulder_stone.py / _iron.py / _copper.py / _coal.py

ASSET-SPECS 4.5: angular rock, 5 to 7 large flat facets, no small detail. The
ore is NOT a texture: three to five side facets are split out onto the ore
material, so the seam mineral catches its own light while the host rock stays
matte. The seam roles are the ORE-IN-ROCK palette rows (IronOre / CopperOre /
CoalSeam, RN-156), not the refined-item metals: the item rows are metallic 1.0
and the client's metalness batching turned an Iron seam into mirror metal that
photographed as ice. From 30 m an iron boulder now reads as grey rock with
blue-grey mineral in it and a coal seam reads as near-black gloss, and that
contrast is the entire identification signal.

WHY THIS FILE HAS ITS OWN PRIMITIVE. hc.lobe is a flat n-gon base, a stack of
jittered rings and an apex: one radius per (ring, azimuth), re-jittered on every
ring. That is a potato. It cannot express the three things that make a mass read
as BROKEN STONE rather than as a weathered pebble:

  FRACTURE PLANE. Real broken rock carries one or two large planar faces at an
  angle to everything else. `_cleaved` replaces the apex with a single n-gon
  whose height is z = rz * (1 + tilt.x * u + tilt.y * v), linear in the vertex's
  own position, so the facet is planar by construction no matter how the ring is
  jittered. One n-gon, n-2 triangles, and it dominates the silhouette.

  CLEFT. `notch=(azimuth, depth)` pulls ONE column of the ring in hard and
  leaves its neighbours alone, so a groove cuts into the body at one azimuth
  without moving the rest of the ring. It costs nothing: the ring already has
  that vertex. The groove is shallower at the foot and full depth at the crown,
  which is how a split propagates.

  OVERHANG. `tip` rotates a whole mass about Y, base included, then re-seats it
  on its lowest corner. The base is then an inclined face standing off the
  ground on one side, so the rock genuinely overhangs its own footprint. Note
  that Parts.fit() re-pins the pile AABB base to z = 0 (RN-68), so a deliberate
  SINK is impossible here and is not attempted; a tip that re-seats itself is
  unaffected, because it moves the pile minimum nowhere.

`_cleaved` also shares ONE azimuth and ONE radius wobble per column across every
ring, varying only the per-ring radius factor. Every side quad is therefore an
exact cone-frustum facet, i.e. flat. hc.lobe re-rolls the wobble per ring, which
guarantees every quad is a bent non-planar wobble. Flat facets are the whole
point of the spec.

FOUR FORMS, NOT FOUR SEEDS. Each kind selects a different PLAN: an arrangement
of masses, not merely a different jitter stream.

    stone   shatter cluster: three blocks split off the same fracture
            direction, jammed together, all their break faces parallel.
    iron    cleaved wedge: one dominant mass, its crown sheared away toward
            -X, a cleft down the -Y flank, a toe block at the foot.
    copper  split pair: two masses of a kind, bases interpenetrating and
            crowns tipped apart, so a cleft runs the full height between them.
    coal    tipped slab: one wide slab rolled 24 degrees onto its edge so its
            base plane stands off the ground, plus two low props.

DEPLETION. `_Full` / `_Half` / `_Low` swap at RemainingAmount / InitialAmount
of 0.66 and 0.33. Volume falls hard and masses are removed rather than merely
scaled, so the silhouette changes, not just the size: a nearly-spent boulder
must read as spent from across a clearing. Masses are removed from the END of
the plan, so mass 0 (which carries the ore seam) always survives. Every variant
keeps the same pivot (base centre, z = 0) and stays inside the Full footprint,
so the renderer swaps the mesh in place with no pop and no re-snap.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402


# kind -> (root name, plan, dims, body role, second role, ore role, seed)
KINDS = {
    "stone":  ("BoulderStone",  "cluster", (1.40, 1.20, 0.90),
               "Rock", "RockDark", "RockDark", 1301),
    "iron":   ("BoulderIron",   "wedge",   (1.60, 1.40, 1.10),
               "Rock", "RockDark", "IronOre", 1307),
    "copper": ("BoulderCopper", "pair",    (1.50, 1.30, 1.00),
               "Rock", "RockDark", "CopperOre", 1319),
    "coal":   ("BoulderCoal",   "slab",    (1.70, 1.40, 1.00),
               "RockDark", "Rock", "CoalSeam", 1327),
}

# Depletion: (bounding-box scale, mass count, chip count).
VARIANTS = (
    ("Full", (1.00, 1.00, 1.00), 3, 2),
    ("Half", (0.86, 0.86, 0.70), 2, 2),
    ("Low",  (0.66, 0.66, 0.40), 1, 1),
)

# Ring profiles below the fracture plane: (z fraction, radius factor). The last
# ring is the one the plane sits on, so a 1-ring mass is a plain wedge and a
# 3-ring mass has a stepped, bulging body under its break.
R3 = ((0.00, 1.00), (0.30, 1.08), (0.64, 0.95))
R2 = ((0.00, 1.00), (0.48, 1.06))
R1 = ((0.00, 1.00),)


def _wob(nxt, amount):
    """Multiplicative wobble in [1-amount, 1+amount]."""
    return 1.0 + (nxt() * 2.0 - 1.0) * amount


def _cleaved(rx, ry, rz, loc=(0.0, 0.0, 0.0), seg=7, seed=1, jit=0.15,
             rings=R2, top=0.56, tilt=(0.55, 0.0), notch=None,
             role="Rock", ore_role=None, seam=None):
    """A faceted mass whose crown is sheared off by one oblique plane.

    rings   the rings BELOW the break, (z fraction, radius factor) each.
    top     radius factor of the ring the break cuts through.
    tilt    (u, v) gradient of the fracture plane, in units of rz per unit of
            normalised x and y. 0.55 tips the facet by roughly 30 degrees.
    notch   (azimuth fraction, radius factor) - the cleft. One column only.
    seam    (azimuth fraction, column count, band indices, use plane) - which
            facets carry the ore. Consecutive columns on purpose: a vein reads,
            scattered chips read as noise.

    Returns (verts, faces, smooth_flags, per_face_roles).
    Triangles: (2n - 4) + 2 * n * len(rings).
    """
    nxt = hc.rng(seed)
    n = max(3, seg)

    # One azimuth and one radius wobble per COLUMN, reused by every ring, so a
    # side quad only ever differs between its two rings by a uniform radius
    # factor. That makes it an exact cone-frustum face, i.e. flat.
    az = [2.0 * math.pi * i / n + (nxt() - 0.5) * (2.0 * math.pi / n) * 0.5
          for i in range(n)]
    rw = [_wob(nxt, jit) for _ in range(n)]

    cut = [1.0] * n
    if notch:
        cut[int(round(notch[0] * n)) % n] = notch[1]

    verts = []
    for zf, rf in rings:
        z = rz * zf * (1.0 if zf == 0.0 else _wob(nxt, 0.05))
        # the groove is half depth where the rock meets the ground and full
        # depth at the crown, which is the way a split actually runs.
        relief = 0.5 if zf == 0.0 else 0.0
        for i in range(n):
            r = rf * rw[i] * (cut[i] + (1.0 - cut[i]) * relief)
            verts.append((loc[0] + rx * r * math.cos(az[i]),
                          loc[1] + ry * r * math.sin(az[i]),
                          loc[2] + z))

    crown = len(verts)
    for i in range(n):
        r = top * rw[i] * cut[i]
        x = rx * r * math.cos(az[i])
        y = ry * r * math.sin(az[i])
        verts.append((loc[0] + x, loc[1] + y,
                      loc[2] + rz * (1.0 + tilt[0] * (x / rx)
                                     + tilt[1] * (y / ry))))

    faces = [tuple(range(n - 1, -1, -1))]          # flat base, normal down
    sides = []
    for b in range(len(rings)):
        lo, hi = b * n, (b + 1) * n                # last band meets the crown
        for i in range(n):
            j = (i + 1) % n
            sides.append(len(faces))
            faces.append((lo + i, lo + j, hi + j, hi + i))
    plane = len(faces)
    faces.append(tuple(range(crown, crown + n)))   # the fracture plane

    roles = [role] * len(faces)
    if ore_role and seam:
        az_frac, count, bands, on_plane = seam
        i0 = int(round(az_frac * n)) % n
        for k in range(count):
            for b in bands:
                roles[sides[(b % len(rings)) * n + (i0 + k) % n]] = ore_role
        if on_plane:
            roles[plane] = ore_role
    return verts, faces, [False] * len(faces), roles


# --------------------------------------------------------------------------
# The plans. Each kind is an ARRANGEMENT, not a seed.
# --------------------------------------------------------------------------

PLANS = {
    # One rock that shattered: three blocks jammed together, every break face
    # tilted the same way, because they were one mass a moment ago.
    "cluster": {
        "masses": (
            dict(loc=(-0.14, -0.08, 0.0), r=(0.44, 0.40, 0.56), seg=7,
                 role="body", rings=R3, top=0.52, tilt=(0.50, 0.22),
                 notch=(0.16, 0.34), seam=(0.14, 2, (1, 2), False)),
            dict(loc=(0.32, 0.22, 0.0), r=(0.30, 0.29, 0.40), seg=6,
                 role="second", rings=R2, top=0.50, tilt=(0.50, 0.22),
                 tip=-8.0, seam=(0.60, 2, (1,), False)),
            dict(loc=(0.06, -0.36, 0.0), r=(0.26, 0.24, 0.30), seg=5,
                 role="body", rings=R2, top=0.54, tilt=(0.50, 0.22),
                 seam=(0.35, 1, (1,), True)),
        ),
        "chips": (
            dict(loc=(-0.42, 0.30, 0.0), r=(0.17, 0.16, 0.13), seg=5,
                 role="second", rings=R1, top=0.62, tilt=(0.50, 0.22)),
            dict(loc=(0.36, -0.14, 0.0), r=(0.15, 0.15, 0.11), seg=5,
                 role="body", rings=R1, top=0.66, tilt=(0.50, 0.22),
                 seam=(0.3, 1, (0,), False)),
        ),
    },

    # One dominant wedge whose crown has sheared away toward -X, with a cleft
    # down the -Y flank and the piece that came off lying at its toe.
    "wedge": {
        "masses": (
            dict(loc=(-0.04, 0.02, 0.0), r=(0.50, 0.44, 0.64), seg=8,
                 role="body", rings=R3, top=0.50, tilt=(-0.66, 0.14),
                 notch=(0.74, 0.32), tip=-9.0,
                 seam=(0.70, 2, (1, 2), True)),
            dict(loc=(0.40, 0.18, 0.0), r=(0.25, 0.24, 0.32), seg=6,
                 role="second", rings=R2, top=0.48, tilt=(0.52, -0.34),
                 seam=(0.08, 2, (1,), False)),
            dict(loc=(-0.34, -0.32, 0.0), r=(0.24, 0.26, 0.24), seg=6,
                 role="body", rings=R2, top=0.60, tilt=(0.18, 0.56),
                 seam=(0.45, 1, (1,), True)),
        ),
        "chips": (
            dict(loc=(-0.46, 0.28, 0.0), r=(0.17, 0.15, 0.12), seg=5,
                 role="second", rings=R1, top=0.64, tilt=(0.36, 0.42)),
            dict(loc=(0.26, -0.38, 0.0), r=(0.16, 0.15, 0.10), seg=5,
                 role="body", rings=R1, top=0.68, tilt=(-0.42, 0.24),
                 seam=(0.2, 1, (0,), False)),
        ),
    },

    # Two halves of one rock: bases still interpenetrating, crowns tipped
    # apart, so the cleft between them runs the whole height.
    "pair": {
        "masses": (
            dict(loc=(-0.24, -0.06, 0.0), r=(0.38, 0.42, 0.60), seg=7,
                 role="body", rings=R3, top=0.50, tilt=(-0.58, 0.18),
                 notch=(0.02, 0.40), tip=-11.0,
                 seam=(0.00, 2, (1, 2), False)),
            dict(loc=(0.28, 0.08, 0.0), r=(0.34, 0.38, 0.54), seg=7,
                 role="second", rings=R2, top=0.52, tilt=(0.58, -0.16),
                 notch=(0.50, 0.42), tip=11.0,
                 seam=(0.46, 2, (1,), True)),
            dict(loc=(0.02, -0.36, 0.0), r=(0.22, 0.20, 0.24), seg=5,
                 role="body", rings=R2, top=0.58, tilt=(0.20, -0.50),
                 seam=(0.4, 1, (1,), False)),
        ),
        "chips": (
            dict(loc=(-0.02, 0.34, 0.0), r=(0.16, 0.14, 0.12), seg=5,
                 role="second", rings=R1, top=0.62, tilt=(0.30, 0.44)),
            dict(loc=(0.44, -0.26, 0.0), r=(0.15, 0.15, 0.10), seg=5,
                 role="body", rings=R1, top=0.66, tilt=(0.44, -0.20),
                 seam=(0.15, 1, (0,), False)),
        ),
    },

    # A slab rolled onto its edge. Its BASE is the overhang: 19 degrees of
    # roll lifts the +X half of the base plane clear of the ground. The props
    # sit on the -X side and the second chip is wedged part way under the
    # raised edge, which stops the undercut reading as a tunnel right through
    # the rock while leaving the bite itself wide open.
    "slab": {
        "masses": (
            dict(loc=(-0.06, 0.00, 0.0), r=(0.54, 0.46, 0.44), seg=8,
                 role="body", rings=R2, top=0.62, tilt=(0.34, 0.30),
                 notch=(0.38, 0.36), tip=-19.0,
                 seam=(0.34, 2, (0, 1), True)),
            dict(loc=(-0.34, 0.36, 0.0), r=(0.26, 0.24, 0.28), seg=6,
                 role="second", rings=R2, top=0.56, tilt=(-0.30, 0.48),
                 seam=(0.62, 2, (1,), False)),
            dict(loc=(-0.30, -0.36, 0.0), r=(0.24, 0.22, 0.22), seg=5,
                 role="body", rings=R2, top=0.60, tilt=(-0.36, -0.44),
                 seam=(0.85, 1, (1,), True)),
        ),
        "chips": (
            dict(loc=(-0.50, 0.02, 0.0), r=(0.17, 0.16, 0.12), seg=5,
                 role="second", rings=R1, top=0.62, tilt=(-0.46, 0.18)),
            dict(loc=(0.26, 0.16, 0.0), r=(0.16, 0.15, 0.15), seg=5,
                 role="body", rings=R1, top=0.66, tilt=(0.24, -0.44),
                 seam=(0.5, 1, (0,), False)),
        ),
    },
}


def _place(p, e, body, second, ore, seed):
    """Build one plan entry into the pile, tipping it first if it wants to."""
    v, f, sm, roles = _cleaved(
        e["r"][0], e["r"][1], e["r"][2], loc=e["loc"], seg=e["seg"],
        seed=seed, jit=e.get("jit", 0.15), rings=e.get("rings", R2),
        top=e.get("top", 0.56), tilt=e.get("tilt", (0.5, 0.0)),
        notch=e.get("notch"),
        role=body if e.get("role", "body") == "body" else second,
        ore_role=ore, seam=e.get("seam"))
    tip = e.get("tip", 0.0)
    if not tip:
        return p.add(v, f, sm, roles)
    # Rotate the whole mass, base included, then set it back down on whatever
    # corner ended up lowest. The base plane is now inclined and stands off the
    # ground on the far side: that gap is the overhang. Re-seating keeps the
    # pile minimum at z = 0, so Parts.fit() has nothing to re-pin (RN-68).
    sub = hc.Parts().add(v, f, sm, roles)
    sub.rotate("Y", tip, pivot=e["loc"])
    lo, _ = sub.bounds()
    sub.translate(dz=e["loc"][2] - lo[2])
    return p.extend(sub)


def _pile(plan, count, chips, body, second, ore, seed):
    """The rock itself, in an arbitrary unit box; fit() sizes it afterwards."""
    p = hc.Parts()
    masses = PLANS[plan]["masses"]
    for k in range(min(count, len(masses))):
        _place(p, masses[k], body, second, ore, seed + k * 17)
    chip_plan = PLANS[plan]["chips"]
    for k in range(min(chips, len(chip_plan))):
        _place(p, chip_plan[k], body, second, ore, seed + 101 + k * 23)
    return p


def build(kind):
    name, plan, dims, body, second, ore, seed = KINDS[kind]
    stem = "boulder_%s" % kind
    out = of.dist_path("nodes", stem + ".glb")
    order = []
    for r in (body, second, ore):
        if r not in order:
            order.append(r)

    of.reset_scene()
    root = of.add_root(name)

    reported = []
    for vname, vscale, nmass, nchips in VARIANTS:
        p = _pile(plan, nmass, nchips, body, second, ore, seed)
        p.fit([dims[k] * vscale[k] for k in range(3)])
        mb = of.MeshBuilder()
        p.into(mb, role_order=order)
        obj = mb.build("%s_%s_LOD0" % (name, vname), root)
        reported.append(("%s_LOD0" % vname, mb))
        # Rock is organic, so a COLLAPSE decimator is the right LOD tool here;
        # the machines hand-build their LODs because a decimator wrecks a box.
        of.add_lod_decimate(obj, 1, 0.45, root)
        of.add_lod_decimate(obj, 2, 0.15, root)

    of.add_collision_box("col_" + name, dims, (0, 0, dims[2] * 0.5), root,
                         role=body)

    # socket_hit: the big forward facet, chest height on the -Y face, where
    # pickaxe impact VFX plays. socket_item_pop: crown centre, where the
    # harvested chunk spawns and falls.
    of.add_socket("socket_hit", (0.0, -dims[1] * 0.30, dims[2] * 0.55),
                  parent=root, extras={"of_role": "hit"})
    of.add_socket("socket_item_pop", (0.0, 0.0, dims[2] * 1.02), parent=root,
                  extras={"of_role": "item_pop"})

    of.report(name, reported)
    of.export_glb(out, export_force_sampling=False)
