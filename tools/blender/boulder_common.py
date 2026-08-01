"""boulder_common.py - the four ore boulders, four ways of BREAKING.

    build_boulder_stone.py / _iron.py / _copper.py / _coal.py

ASSET-SPECS 4.5 asked for angular rock in 5 to 7 large flat facets with no
small detail. That spec was written for a low-poly game and it is superseded by
docs/web/ART-DIRECTION.md: realistic, detailed, complex, and "clean" is now a
defect. Rendered on the studio floor, the RN-73 boulders read as low-poly gems:
convex, smooth, and completely empty inside 1 m. The geometry vocabulary that
fixes that lives in rock_form.py; this file is the four ARRANGEMENTS.

The ore is still not a texture: three to five side facets are split out onto
the ore material so the seam mineral catches its own light while the host rock
stays matte. The seam roles are the ORE-IN-ROCK palette rows (IronOre /
CopperOre / CoalSeam, RN-156), not the refined-item metals. THOSE VALUES ARE
NOT TOUCHED HERE. Albedo, roughness and colour are lighting-dependent and are
owed to the look-development pass; form is not, and form is what this file
changes.

FOUR MINERALS, FOUR FRACTURE BEHAVIOURS (RN-242). RN-76 gave the four kinds
four ARRANGEMENTS of the same mass, which separated them in plan and left them
identical in substance. A player at 2 m should be able to tell iron from coal
with the colour removed, because the two rocks do not break the same way:

    stone   SHATTER CLUSTER. Three blocks split off one fracture direction and
            jammed back together, so their shear planes are PARALLEL: the same
            azimuth on every mass, because they were one rock a moment ago.
            Bedding, bites, pits, welded fragments, loose chips at the foot.

    iron    DENSE AND ANGULAR. One dominant wedge that cleaved rather than
            crumbled. Nearly zero ring jitter, so its facets stay hard and
            flat and large; TWO deep shear planes meeting in an arris; the
            fewest pits of the four, because dense ore does not spall. Its
            silhouette is three or four planes and almost nothing else.

    copper  WEATHERED INTO NODULES. It did not cleave at all. Bulging ring
            profile, the highest ring jitter and segment count, a small
            shallow crown instead of a dominant break plane, NO shear planes
            anywhere, deep rim bites so the top edge is rounded off and
            irregular, and the most welded nodules of the four budding out of
            its flanks. Vug pits rather than spall pits.

    coal    FRIABLE AND BLOCKY. Five columns, so the plan is a rough
            quadrilateral rather than a cone; two bedding ledges stacked, so
            the silhouette carries horizontal lines; the most pits, because
            coal flakes; and RUBBLE, a ring of loose fragments it has shed
            around its own foot, which no other kind gets. Rolled 19 degrees
            onto its edge so its base plane stands off the ground.

DEPLETION. `_Full` / `_Half` / `_Low` swap at RemainingAmount / InitialAmount
of 0.66 and 0.33. Volume falls hard and masses are removed rather than merely
scaled, so the silhouette changes and not just the size. Masses are removed
from the END of the plan, so mass 0 (which carries the ore seam) always
survives. Every variant keeps the same pivot (base centre, z = 0) and stays
inside the Full footprint, so the renderer swaps the mesh in place with no pop
and no re-snap.

DETAIL FALLS WITH DEPLETION TOO, and it is not a cheat. A Low stub is 0.36 m
tall; a 2 cm pocket authored for a 0.90 m boulder is not the same feature at
that size, it is noise the decimator will eat anyway. So Half drops half the
welded fragments and Low drops them all and halves the pits. That is a real
saving on the variant a spent field is full of.

THE DERIVED THRESHOLD THIS FILE IS THE SOURCE OF. RockTuning.DECOR_ROCK_MAX_H
is KINDS["stone"] dims z (0.90) times VARIANTS "Low" z scale (0.40) times
ROCK_SCALE_MIN, and decoration must stay strictly below it. Neither of those
two numbers moves in this pass, so the threshold is unchanged at 0.27 m; if
either ever moves, that constant moves with it.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of            # noqa: E402
import harvest_common as hc    # noqa: E402
import rock_form as rf         # noqa: E402


# kind -> (root name, plan, dims, body role, second role, ore role, seed)
KINDS = {
    "stone":  ("BoulderStone",  "cluster", (1.40, 1.20, 0.90),
               "Rock", "RockDark", "RockDark", 1301),
    "iron":   ("BoulderIron",   "wedge",   (1.60, 1.40, 1.10),
               "Rock", "RockDark", "IronOre", 1307),
    "copper": ("BoulderCopper", "nodule",  (1.50, 1.30, 1.00),
               "Rock", "RockDark", "CopperOre", 1319),
    "coal":   ("BoulderCoal",   "slab",    (1.70, 1.40, 1.00),
               "RockDark", "Rock", "CoalSeam", 1327),
}

# Depletion: (name, bounding-box scale, mass count, chip count, pit scale,
# clast scale). The last two are the detail ladder described above.
VARIANTS = (
    ("Full", (1.00, 1.00, 1.00), 3, 3, 1.0, 1.0),
    ("Half", (0.86, 0.86, 0.70), 2, 2, 1.0, 0.5),
    ("Low",  (0.66, 0.66, 0.40), 1, 1, 0.5, 0.0),
)


# --------------------------------------------------------------------------
# The plans. Each kind is an ARRANGEMENT and a FRACTURE BEHAVIOUR.
# Every entry is a rock_form.mass() keyword set plus role / tip / spin /
# clasts; see rock_form.place().
# --------------------------------------------------------------------------

# The shear azimuth the stone cluster shares across all three blocks. One
# name, used three times, because "the same fracture direction" is the whole
# idea of the plan and three transcribed 0.62s would let it drift apart.
CLUSTER_BREAK = 0.62

PLANS = {
    # One rock that shattered: three blocks jammed together, every break face
    # tilted the same way and every shear plane on the same bearing, because
    # they were one mass a moment ago.
    "cluster": {
        "masses": (
            dict(loc=(-0.14, -0.08, 0.0), r=(0.44, 0.40, 0.56), seg=9,
                 role="body", rings=rf.BED5, top=0.90, tilt=(0.24, 0.12),
                 notch=(0.16, 0.46), ring_jit=0.08, rim_bites=3, pits=4,
                 crown_pit=0.09,
                 flank_bites=5, lean=(0.05, -0.03),
                 shears=((CLUSTER_BREAK, 0.34, 0.24, 1.0),),
                 clasts=((0.10, 0.42, 0.20, 24.0, 40.0),
                         (0.44, 0.66, 0.16, -32.0, 15.0),
                         (0.80, 0.30, 0.18, 18.0, -50.0)),
                 seam=(0.14, 2, (1, 2), False)),
            dict(loc=(0.32, 0.22, 0.0), r=(0.30, 0.29, 0.40), seg=8,
                 role="second", rings=rf.BED4, top=0.88, tilt=(0.26, 0.13),
                 tip=-8.0, ring_jit=0.08, rim_bites=2, pits=2, crown_pit=0.10,
                 flank_bites=4, lean=(-0.04, 0.03),
                 shears=((CLUSTER_BREAK, 0.22, 0.30, 1.0),),
                 clasts=((0.28, 0.50, 0.22, -20.0, 30.0),),
                 seam=(0.60, 2, (1,), False)),
            dict(loc=(0.06, -0.36, 0.0), r=(0.26, 0.24, 0.30), seg=6,
                 role="body", rings=rf.R3, top=0.88, tilt=(0.26, 0.13),
                 ring_jit=0.09, rim_bites=2, pits=1, flank_bites=3,
                 lean=(0.02, 0.04), seam=(0.35, 1, (1,), True)),
        ),
        "chips": (
            dict(loc=(-0.42, 0.30, 0.0), r=(0.17, 0.16, 0.13), seg=5,
                 role="second", rings=rf.R1, top=0.80, tilt=(0.30, 0.15),
                 ring_jit=0.12, rim_bites=1, flank_bites=2),
            dict(loc=(0.36, -0.14, 0.0), r=(0.15, 0.15, 0.11), seg=5,
                 role="body", rings=rf.R1, top=0.82, tilt=(0.30, 0.15),
                 ring_jit=0.12, rim_bites=1, flank_bites=2,
                 seam=(0.3, 1, (0,), False)),
            dict(loc=(-0.30, -0.30, 0.0), r=(0.13, 0.12, 0.09), seg=5,
                 role="second", rings=rf.R1, top=0.72, tilt=(0.30, -0.34),
                 ring_jit=0.12, rim_bites=1, flank_bites=2, spin=28.0),
        ),
    },

    # One dominant wedge that CLEAVED. Its crown sheared away toward -X, two
    # deep vertical fracture planes meet in an arris down the -Y flank, and
    # the piece that came off lies at its toe. Hard flat facets, almost no
    # jitter, the fewest pits of the four.
    "wedge": {
        "masses": (
            dict(loc=(-0.04, 0.02, 0.0), r=(0.50, 0.44, 0.64), seg=8,
                 role="body", rings=rf.R3, top=0.70, tilt=(-0.56, 0.12),
                 notch=(0.74, 0.32), tip=-9.0, ring_jit=0.025, rim_bites=2,
                 bite_keep=(0.70, 0.92), pits=2, crown_pit=0.07, flank_bites=3,
                 flank_keep=(0.76, 0.92), lean=(-0.07, 0.02),
                 shears=((0.72, 0.30, 0.0, 1.0), (0.90, 0.34, 0.30, 1.0)),
                 clasts=((0.20, 0.55, 0.17, 26.0, 35.0),),
                 seam=(0.70, 2, (1, 2), True)),
            dict(loc=(0.40, 0.18, 0.0), r=(0.25, 0.24, 0.32), seg=7,
                 role="second", rings=rf.BED4, top=0.76, tilt=(0.44, -0.28),
                 ring_jit=0.03, rim_bites=2, bite_keep=(0.70, 0.92), pits=1,
                 flank_bites=2, flank_keep=(0.76, 0.92), lean=(0.04, 0.03),
                 shears=((0.14, 0.20, 0.20, 1.0),),
                 seam=(0.08, 2, (1,), False)),
            dict(loc=(-0.34, -0.32, 0.0), r=(0.24, 0.26, 0.24), seg=6,
                 role="body", rings=rf.R2, top=0.80, tilt=(0.16, 0.46),
                 ring_jit=0.03, rim_bites=1, bite_keep=(0.70, 0.92),
                 flank_bites=2, flank_keep=(0.76, 0.92),
                 shears=((0.46, 0.18, 0.0, 1.0),),
                 seam=(0.45, 1, (1,), True)),
        ),
        "chips": (
            dict(loc=(-0.46, 0.28, 0.0), r=(0.17, 0.15, 0.12), seg=5,
                 role="second", rings=rf.R1, top=0.74, tilt=(0.32, 0.36),
                 ring_jit=0.04, flank_bites=1,
                 shears=((0.30, 0.12, 0.0, 1.0),)),
            dict(loc=(0.26, -0.38, 0.0), r=(0.16, 0.15, 0.10), seg=5,
                 role="body", rings=rf.R1, top=0.78, tilt=(-0.36, 0.20),
                 ring_jit=0.04, flank_bites=1, seam=(0.2, 1, (0,), False)),
            dict(loc=(0.10, 0.44, 0.0), r=(0.13, 0.12, 0.08), seg=4,
                 role="second", rings=rf.R1, top=0.72, tilt=(0.18, -0.40),
                 ring_jit=0.04, flank_bites=1, spin=-22.0),
        ),
    },

    # Two halves of one rock that never cleaved: they WEATHERED apart. Bulging
    # nodular profiles, no shear plane anywhere, the deepest rim bites and the
    # most welded nodules of the four. The cleft between them still runs the
    # whole height, because they are still two masses.
    "nodule": {
        "masses": (
            dict(loc=(-0.24, -0.06, 0.0), r=(0.38, 0.42, 0.60), seg=10,
                 role="body", rings=rf.NODE4, top=0.72, tilt=(-0.26, 0.12),
                 notch=(0.02, 0.50), tip=-11.0, ring_jit=0.14, rim_bites=4,
                 bite_keep=(0.62, 0.92), pits=4, crown_pit=0.12, flank_bites=6,
                 flank_keep=(0.66, 0.90), lean=(0.04, 0.05),
                 clasts=((0.08, 0.52, 0.19, 30.0, 20.0),
                         (0.34, 0.72, 0.15, -26.0, 60.0),
                         (0.62, 0.34, 0.21, 14.0, -35.0),
                         (0.86, 0.60, 0.16, -18.0, 45.0)),
                 seam=(0.00, 2, (1, 2), False)),
            dict(loc=(0.28, 0.08, 0.0), r=(0.34, 0.38, 0.54), seg=9,
                 role="second", rings=rf.NODE4, top=0.70, tilt=(0.28, -0.10),
                 notch=(0.50, 0.52), tip=11.0, ring_jit=0.14, rim_bites=3,
                 bite_keep=(0.62, 0.92), pits=3, crown_pit=0.12, flank_bites=5,
                 flank_keep=(0.66, 0.90), lean=(-0.05, -0.04),
                 clasts=((0.20, 0.62, 0.18, -22.0, 50.0),
                         (0.70, 0.40, 0.20, 28.0, -25.0)),
                 seam=(0.46, 2, (1,), True)),
            dict(loc=(0.02, -0.36, 0.0), r=(0.22, 0.20, 0.24), seg=7,
                 role="body", rings=rf.NODE4, top=0.74, tilt=(0.18, -0.22),
                 ring_jit=0.15, rim_bites=2, bite_keep=(0.62, 0.92), pits=1,
                 flank_bites=3, flank_keep=(0.66, 0.90),
                 seam=(0.4, 1, (1,), False)),
        ),
        "chips": (
            dict(loc=(-0.02, 0.34, 0.0), r=(0.16, 0.14, 0.12), seg=6,
                 role="second", rings=rf.R2, top=0.72, tilt=(0.18, 0.24),
                 ring_jit=0.16, rim_bites=1, flank_bites=2),
            dict(loc=(0.44, -0.26, 0.0), r=(0.15, 0.15, 0.10), seg=6,
                 role="body", rings=rf.R2, top=0.74, tilt=(0.24, -0.12),
                 ring_jit=0.16, rim_bites=1, flank_bites=2,
                 seam=(0.15, 1, (0,), False)),
            dict(loc=(-0.34, 0.24, 0.0), r=(0.12, 0.13, 0.09), seg=5,
                 role="second", rings=rf.R1, top=0.76, tilt=(0.14, 0.20),
                 ring_jit=0.16, flank_bites=2, spin=34.0),
        ),
    },

    # A bedded slab rolled onto its edge. Its BASE is the overhang: 19 degrees
    # of roll lifts the +X half of the base plane clear of the ground. Five
    # columns make the plan blocky rather than conical, two stacked ledges put
    # horizontal lines through the silhouette, and coal being friable it has
    # shed a ring of its own crumbs around the foot.
    "slab": {
        "masses": (
            dict(loc=(-0.06, 0.00, 0.0), r=(0.54, 0.46, 0.50), seg=6,
                 role="body", rings=rf.BED5, top=0.86, tilt=(0.15, 0.12),
                 notch=(0.38, 0.48), tip=-19.0, ring_jit=0.05, rim_bites=3,
                 pits=5, crown_pit=0.14, flank_bites=5, lean=(0.06, 0.02),
                 shears=((0.06, 0.36, 0.40, 1.0),),
                 clasts=((0.26, 0.46, 0.20, 22.0, 30.0),
                         (0.74, 0.66, 0.17, -28.0, -20.0)),
                 seam=(0.34, 2, (0, 1), True)),
            dict(loc=(-0.34, 0.36, 0.0), r=(0.26, 0.24, 0.28), seg=5,
                 role="second", rings=rf.BLOCK3, top=0.88, tilt=(-0.18, 0.22),
                 ring_jit=0.05, rim_bites=2, pits=3, spin=18.0, flank_bites=3,
                 crown_pit=0.13,
                 seam=(0.62, 2, (1,), False)),
            dict(loc=(-0.30, -0.36, 0.0), r=(0.24, 0.22, 0.22), seg=5,
                 role="body", rings=rf.BLOCK3, top=0.86, tilt=(-0.20, -0.22),
                 ring_jit=0.05, rim_bites=2, pits=2, spin=-26.0, flank_bites=3,
                 seam=(0.85, 1, (1,), True)),
        ),
        "chips": (
            dict(loc=(-0.50, 0.02, 0.0), r=(0.17, 0.16, 0.12), seg=4,
                 role="second", rings=rf.R1, top=0.72, tilt=(-0.30, 0.14),
                 ring_jit=0.06, rim_bites=1, flank_bites=2),
            dict(loc=(0.26, 0.16, 0.0), r=(0.16, 0.15, 0.15), seg=4,
                 role="body", rings=rf.R1, top=0.74, tilt=(0.18, -0.30),
                 ring_jit=0.06, rim_bites=1, flank_bites=2,
                 seam=(0.5, 1, (0,), False)),
            dict(loc=(0.02, -0.46, 0.0), r=(0.13, 0.13, 0.10), seg=4,
                 role="second", rings=rf.R1, top=0.70, tilt=(0.12, 0.32),
                 ring_jit=0.06, rim_bites=1, flank_bites=2, spin=40.0),
        ),
        # Friability, and only this kind gets it: loose crumbs, ankle high,
        # ringing the slab. sink is 0 because Parts.fit() re-pins the pile
        # base to z = 0, so a fragment buried below zero would LIFT the whole
        # boulder off the ground by exactly the amount it was buried.
        "rubble": dict(count=6, area=(0.66, 0.60), size=(0.10, 0.09, 0.07),
                       seed=1409, seg=4, role="body", alt_role="second",
                       alt_every=3, sink=0.0),
    },
}


def _pile(plan, count, chips, pit_scale, clast_scale, roles, seed):
    """The rock itself, in an arbitrary unit box; fit() sizes it afterwards."""
    p = hc.Parts()
    spec = PLANS[plan]

    def thinned(e, index):
        """The depletion detail ladder, plus the base stagger.

        `index` is the entry's position in the pile and it lands on the base z
        through rock_form.BASE_DZ: see that constant for why two flat bases at
        exactly z = 0 in different roles is a real defect and not a metric
        artefact. Entry 0 stays at zero, so the pile minimum, and therefore
        everything Parts.fit() derives from it, is unchanged."""
        out = dict(e)
        out["loc"] = (e["loc"][0], e["loc"][1], e["loc"][2]
                      + index * rf.BASE_DZ)
        if pit_scale != 1.0 and "pits" in out:
            out["pits"] = int(out["pits"] * pit_scale)
        if clast_scale != 1.0 and "clasts" in out:
            out["clasts"] = out["clasts"][:int(len(out["clasts"])
                                               * clast_scale)]
        return out

    masses = spec["masses"]
    n_mass = min(count, len(masses))
    for k in range(n_mass):
        rf.place(p, thinned(masses[k], k), roles, seed + k * 17)
    chip_plan = spec["chips"]
    n_chip = min(chips, len(chip_plan))
    for k in range(n_chip):
        rf.place(p, thinned(chip_plan[k], n_mass + k), roles,
                 seed + 101 + k * 23)
    rub = spec.get("rubble")
    if rub and count >= 2:
        kw = dict(rub)
        # The rubble ring continues the SAME base stagger the masses and chips
        # are on, rather than restarting at zero, which is what left one
        # coplanar pair between crumb 0 and mass 0 when it did restart.
        kw["loc"] = (0.0, 0.0, (n_mass + n_chip) * rf.BASE_DZ)
        kw["role"] = roles[kw["role"]]
        if kw.get("alt_role"):
            kw["alt_role"] = roles[kw["alt_role"]]
        kw["count"] = max(2, int(kw["count"] * (1.0 if count >= 3 else 0.5)))
        p.extend(rf.rubble(**kw))
    return p


def build(kind):
    name, plan, dims, body, second, ore, seed = KINDS[kind]
    stem = "boulder_%s" % kind
    out = of.dist_path("nodes", stem + ".glb")
    roles = {"body": body, "second": second, "ore": ore}
    order = []
    for r in (body, second, ore):
        if r not in order:
            order.append(r)

    of.reset_scene()
    rf.reset_dev()
    root = of.add_root(name)

    reported = []
    for vname, vscale, nmass, nchips, pit_s, clast_s in VARIANTS:
        p = _pile(plan, nmass, nchips, pit_s, clast_s, roles, seed)
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
    print("[boulder] %s: fracture planes %d, max out-of-plane %.3e m; "
          "shear masses %d, max off-plane %.3e m"
          % (name, rf.DEV["crowns"], rf.DEV["crown"], rf.DEV["shears"],
             rf.DEV["shear"]))
    of.export_glb(out, export_force_sampling=False)
