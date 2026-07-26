"""boulder_common.py - the four ore boulders share one form, four dressings.

    build_boulder_stone.py / _iron.py / _copper.py / _coal.py

ASSET-SPECS 4.5: one angular multi-lobe rock, one dominant mass with two
smaller lobes crowding it, 5 to 7 large flat facets and no small detail. The
ore is NOT a texture: three to five side facets are split out onto the ore
material, so raw metal catches a specular highlight while the host rock stays
matte. From 30 m an iron boulder reads as grey rock with bright chips in it and
a coal seam reads as near-black gloss, and that contrast is the entire
identification signal. The rock body is deliberately shared visual language
across all four so the mineral, not the shape, carries the identity.

DEPLETION. `_Full` / `_Half` / `_Low` swap at RemainingAmount / InitialAmount
of 0.66 and 0.33. Volume falls hard (100% / ~59% / ~18% of the bounding box)
and lobes are removed rather than merely scaled, so the silhouette changes, not
just the size: a nearly-spent boulder must read as spent from across a
clearing. Every variant keeps the same pivot (base centre, z = 0) and stays
inside the Full footprint, so the renderer swaps the mesh in place with no pop
and no re-snap.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402


# kind -> (root name, file stem, dims, body role, second role, ore role, seed)
KINDS = {
    "stone":  ("BoulderStone",  (1.40, 1.20, 0.90), "Rock", "RockDark",
               "RockDark", 1301),
    "iron":   ("BoulderIron",   (1.60, 1.40, 1.10), "Rock", "RockDark",
               "Iron", 1307),
    "copper": ("BoulderCopper", (1.50, 1.30, 1.00), "Rock", "RockDark",
               "Copper", 1319),
    "coal":   ("BoulderCoal",   (1.70, 1.40, 1.00), "RockDark", "Rock",
               "Coal", 1327),
}

# Depletion: (bounding-box scale, lobe count, chip count).
VARIANTS = (
    ("Full", (1.00, 1.00, 1.00), 3, 2),
    ("Half", (0.86, 0.86, 0.70), 2, 2),
    ("Low",  (0.66, 0.66, 0.40), 1, 1),
)

# Which side facets carry ore, per lobe. Kept proportional across variants so
# a boulder is still identifiable when it is nearly spent.
ORE_FACES = ((1, 5, 9, 14), (2, 7, 11), (0, 6, 12))


def _lobes(count, chips, body, second, ore, seed):
    """The rock itself, in an arbitrary unit box; fit() sizes it afterwards."""
    p = hc.Parts()
    # dominant mass, then smaller lobes crowding it off-centre
    plan = (((0.00, 0.00, 0.00), (0.52, 0.46, 0.50), 7, body),
            ((0.34, 0.16, 0.00), (0.30, 0.28, 0.31), 6, second),
            ((-0.28, -0.22, 0.00), (0.26, 0.30, 0.26), 6, body))
    for k in range(min(count, len(plan))):
        loc, r, seg, role = plan[k]
        v, f, sm, roles = hc.lobe(r[0], r[1], r[2], loc=loc, seg=seg,
                                  seed=seed + k * 17, jit=0.19,
                                  lean=(0.06 * (k - 1), -0.05 * k),
                                  role=role, ore_role=ore,
                                  ore_faces=ORE_FACES[k])
        p.add(v, f, sm, roles)
    chip_plan = (((-0.40, 0.26, 0.00), (0.17, 0.15, 0.13), second),
                 ((0.30, -0.34, 0.00), (0.15, 0.16, 0.11), body))
    for k in range(min(chips, len(chip_plan))):
        loc, r, role = chip_plan[k]
        v, f, sm, roles = hc.lobe(r[0], r[1], r[2], loc=loc, seg=5,
                                  seed=seed + 101 + k * 23, jit=0.22,
                                  role=role, ore_role=ore, ore_faces=(2,))
        p.add(v, f, sm, roles)
    return p


def build(kind):
    name, dims, body, second, ore, seed = KINDS[kind]
    stem = "boulder_%s" % kind
    out = of.dist_path("nodes", stem + ".glb")
    order = []
    for r in (body, second, ore):
        if r not in order:
            order.append(r)

    of.reset_scene()
    root = of.add_root(name)

    reported = []
    for vname, vscale, nlobes, nchips in VARIANTS:
        p = _lobes(nlobes, nchips, body, second, ore, seed)
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
