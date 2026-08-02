"""check_shadow_lod.py - what cascade may each LOD tier be given?

    python tools/blender/check_shadow_lod.py                 # every asset
    python tools/blender/check_shadow_lod.py smelter miner   # some of them

Reads the SHIPPED bytes, no Blender required.

WHY THIS EXISTS, AND IT IS THE LESSON OF RN-559 TO RN-561. The machine lane
priced its smelter raise against a recovery of `2276 + 192 + 2x48 = 2564`,
i.e. the three CSM cascades drawing the cruder tiers that already ship. The
client lane then reproduced the +22.4% cost and showed the recovery cannot
happen: cascade 0 is 15.47 mm per texel and the smelter's `_LOD1` deviates
325 mm from its `_LOD0`, so no cascade fine enough to matter may draw it. The
predicted factor of 34 is a factor of 1.00.

The root cause is older than that raise and belongs to nobody's pass: the
pre-raise 592-triangle smelter's `_LOD1` already measured 264.8 mm. THE LOD
LADDER WAS AUTHORED FOR SCREEN DISTANCE AND WAS NEVER SHADOW-SAFE. Nothing
had ever asked a cascade to draw a cruder tier, so nothing had ever measured
the one number that decides whether it may.

`__ofShadowLod.report()` publishes this in the running client, which is the
authority. It is the wrong place to author against: an asset lane edits a
build script, runs Blender, and would have to boot a browser to find out
whether the edit bought anything. This is that number, offline, in the loop
where the geometry is actually written.

THE DEFINITION IS THE CLIENT'S AND IS NOT SYMMETRIC. `ShadowLod.ts` measures
from LOD0's VERTICES to the tier's SURFACE, and its comment says why: "a base
ring that LOD1 lifted by 30 mm reports 30 mm, not 0". A vertex-set comparison
would score that pair at zero, because every LOD1 vertex has a near neighbour
in LOD0. The asymmetry is the whole point, so it is reproduced here rather
than approximated by something more convenient.

THE THREE TARGETS, which are cascade texel sizes at the shipped quality tier:

    cascade 0    15.47 mm     the contact shadow a player stands next to
    cascade 1    56.25 mm
    cascade 2   210.94 mm

A tier deviating under one of those may be drawn by that cascade and every
coarser one. What an asset lane actually banks is the MARGINAL multiplier,
`1 + (cascades still drawing tier 0)`: four cascades' worth of a machine at
0,0,0 and only two at 0,1,1. Halving it doubles what every instance of that
machine can afford at LOD0, which is why authoring a shadow-safe `_LOD1` buys
more frame than trimming any `_LOD0` ever will.
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

# Metres per shadow texel, cascade 0..2, at the shipped quality tier. Section
# 2.1 measures cascade 0 at 15.47 mm over 0 to 22 m; the coarser two follow the
# published split. Named here so a quality change moves ONE table.
CASCADE_M = (0.01547, 0.05625, 0.21094)


def glb_chunks(path):
    with open(path, "rb") as fh:
        data = fh.read()
    assert data[:4] == b"glTF"
    off, js, bin_ = 12, None, None
    while off < len(data):
        ln, kind = struct.unpack_from("<II", data, off)
        body = data[off + 8:off + 8 + ln]
        if kind == 0x4E4F534A:
            js = json.loads(body.decode("utf-8"))
        elif kind == 0x004E4942:
            bin_ = body
        off += 8 + ln + ((4 - ln % 4) % 4 if ln % 4 else 0)
    return js, bin_


def _acc(gltf, binary, idx):
    a = gltf["accessors"][idx]
    bv = gltf["bufferViews"][a["bufferView"]]
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = a["count"]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    fmt = {5120: "b", 5121: "B", 5122: "h", 5123: "H",
           5125: "I", 5126: "f"}[a["componentType"]]
    sz = struct.calcsize(fmt)
    stride = bv.get("byteStride") or (sz * ncomp)
    out = []
    for i in range(n):
        o = base + i * stride
        out.append(struct.unpack_from("<" + fmt * ncomp, binary, o))
    return out


def mesh_geometry(gltf, binary, mesh):
    """(verts, tris) for one mesh, all primitives concatenated."""
    verts, tris = [], []
    for prim in mesh["primitives"]:
        pi = prim["attributes"]["POSITION"]
        base = len(verts)
        verts.extend(_acc(gltf, binary, pi))
        if "indices" in prim:
            idx = [i[0] for i in _acc(gltf, binary, prim["indices"])]
        else:
            idx = list(range(len(verts) - base))
        for k in range(0, len(idx) - 2, 3):
            tris.append((base + idx[k], base + idx[k + 1], base + idx[k + 2]))
    return verts, tris


def _pt_tri_dist2(p, a, b, c):
    """Squared distance from point to triangle. Ericson, Real-Time Collision
    Detection 5.1.5: the barycentric region test, unrolled. No numpy, because
    nothing else in this toolchain needs it and a build check that requires a
    package nobody has is a check that stops being run."""
    ab = [b[i] - a[i] for i in range(3)]
    ac = [c[i] - a[i] for i in range(3)]
    ap = [p[i] - a[i] for i in range(3)]
    d1 = sum(ab[i] * ap[i] for i in range(3))
    d2 = sum(ac[i] * ap[i] for i in range(3))
    if d1 <= 0.0 and d2 <= 0.0:
        return sum(ap[i] * ap[i] for i in range(3))
    bp = [p[i] - b[i] for i in range(3)]
    d3 = sum(ab[i] * bp[i] for i in range(3))
    d4 = sum(ac[i] * bp[i] for i in range(3))
    if d3 >= 0.0 and d4 <= d3:
        return sum(bp[i] * bp[i] for i in range(3))
    vc = d1 * d4 - d3 * d2
    if vc <= 0.0 <= d1 and d3 <= 0.0:
        t = d1 / (d1 - d3)
        q = [a[i] + ab[i] * t for i in range(3)]
        return sum((p[i] - q[i]) ** 2 for i in range(3))
    cp = [p[i] - c[i] for i in range(3)]
    d5 = sum(ab[i] * cp[i] for i in range(3))
    d6 = sum(ac[i] * cp[i] for i in range(3))
    if d6 >= 0.0 and d5 <= d6:
        return sum(cp[i] * cp[i] for i in range(3))
    vb = d5 * d2 - d1 * d6
    if vb <= 0.0 <= d2 and d6 <= 0.0:
        t = d2 / (d2 - d6)
        q = [a[i] + ac[i] * t for i in range(3)]
        return sum((p[i] - q[i]) ** 2 for i in range(3))
    va = d3 * d6 - d5 * d4
    if va <= 0.0 and (d4 - d3) >= 0.0 and (d5 - d6) >= 0.0:
        t = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        q = [b[i] + (c[i] - b[i]) * t for i in range(3)]
        return sum((p[i] - q[i]) ** 2 for i in range(3))
    den = 1.0 / (va + vb + vc)
    v, w = vb * den, vc * den
    q = [a[i] + ab[i] * v + ac[i] * w for i in range(3)]
    return sum((p[i] - q[i]) ** 2 for i in range(3))


def deviation(v0, verts_t, tris_t):
    """max over LOD0's vertices of the distance to the tier's SURFACE.

    BOUNDING-SPHERE PRUNE, NOT A UNIFORM GRID, AND THE FIRST VERSION IS WHY.
    A grid looks like the obvious broad phase and is the wrong one here,
    because the meshes it is asked about are exactly the ones it handles worst.
    The first version grew a shell radius until it found a candidate, which is
    correct and fast when the tier is dense and PATHOLOGICAL when it is sparse:
    a 48-triangle LOD2 leaves almost every cell empty, so the search expanded
    to its 24-shell cap and did roughly 117,000 dict lookups PER VERTEX. On
    `launch_pad` (5,026 vertices against a 48-triangle tier) that is about 590
    million lookups for one pair, and the whole-set sweep did not finish.

    Cost here is honestly O(V x T), which sounds worse and is far better at
    these sizes: every tier in the set is between 36 and 1,302 triangles, so
    the product is bounded and the constant is tiny. Each triangle carries a
    centroid and a radius, and a triangle whose sphere cannot beat the best
    distance found so far is skipped before the exact test runs. The prune is
    what does the work; the loop is just a loop.

    The exact test is still Ericson's, so the ANSWER is unchanged: this
    function was swapped for speed alone and the smelter still reads 325.00 mm
    against the pre-swap bytes, which is the control that matters."""
    if not tris_t:
        return float("inf")
    prepared = []
    for t in tris_t:
        a, b, c = verts_t[t[0]], verts_t[t[1]], verts_t[t[2]]
        cx = (a[0] + b[0] + c[0]) / 3.0
        cy = (a[1] + b[1] + c[1]) / 3.0
        cz = (a[2] + b[2] + c[2]) / 3.0
        rad = max(math.sqrt((v[0] - cx) ** 2 + (v[1] - cy) ** 2
                            + (v[2] - cz) ** 2) for v in (a, b, c))
        prepared.append((cx, cy, cz, rad, a, b, c))
    # Nothing about the order is required for correctness, but starting from
    # the tier's own centre of mass makes the first candidate a good one for
    # most vertices, which is what makes the prune bite immediately instead of
    # after a few hundred triangles.
    mx = sum(p[0] for p in prepared) / len(prepared)
    my = sum(p[1] for p in prepared) / len(prepared)
    mz = sum(p[2] for p in prepared) / len(prepared)
    prepared.sort(key=lambda p: (p[0] - mx) ** 2 + (p[1] - my) ** 2
                  + (p[2] - mz) ** 2)
    worst = 0.0
    for p in v0:
        px, py, pz = p[0], p[1], p[2]
        best = float("inf")
        for (cx, cy, cz, rad, a, b, c) in prepared:
            dc = math.sqrt((px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2)
            lower = dc - rad
            if lower > 0.0 and lower * lower >= best:
                continue
            d2 = _pt_tri_dist2(p, a, b, c)
            if d2 < best:
                best = d2
        if best > worst:
            worst = best
    return math.sqrt(worst)


def tier_for(dev_m):
    """The FINEST cascade this deviation may be drawn by, or None."""
    for i, t in enumerate(CASCADE_M):
        if dev_m <= t:
            return i
    return None


def marginal(tiers):
    """1 + (cascades still drawing tier 0). The number an asset lane banks."""
    return 1 + sum(1 for t in tiers if t == 0)


def main():
    want = [a for a in sys.argv[1:] if not a.startswith("-")]
    with open(os.path.join(HERE, "contracts.json"), encoding="utf-8") as fh:
        contracts = json.load(fh)["assets"]
    names = want or sorted(contracts)
    print("SHADOW LOD: may a cascade draw this tier?")
    print("  cascade texel sizes: c0 %.2f mm   c1 %.2f mm   c2 %.2f mm"
          % tuple(x * 1000.0 for x in CASCADE_M))
    print("-" * 78)
    print("  %-22s %8s %10s  %s" % ("asset", "tier", "dev mm", "cascades it earns"))
    rows = []
    for name in names:
        c = contracts.get(name)
        if c is None or len(c.get("lod_nodes", [])) < 2:
            continue
        path = os.path.join(ROOT, c["glb"])
        if not os.path.isfile(path):
            continue
        gltf, binary = glb_chunks(path)
        by = {m.get("name", ""): m for m in gltf.get("meshes", [])}

        # GROUP BY STEM. An asset is not one ladder: `launch_pad` declares
        # `LaunchPad_LOD0/1/2` AND `LaunchClamp_LOD0/2` AND `LaunchClamp_Arm`
        # in one `lod_nodes` list. Reading that list as a single six-tier
        # ladder measures a pad against a clamp standing 14 m away and reports
        # 14,090 mm, which is not a deviation, it is two different objects.
        # THE FIRST VERSION OF THIS TOOL DID EXACTLY THAT, and a table
        # published from it would have been worse than no table: every number
        # would have looked precise and five of them would have been fiction.
        ladders = {}
        for n in c["lod_nodes"]:
            if n not in by:
                continue
            k = n.rsplit("_LOD", 1)
            if len(k) != 2 or not k[1].isdigit():
                continue            # a sibling like LaunchClamp_Arm, not a tier
            ladders.setdefault(k[0], []).append((int(k[1]), n))
        printed = False
        for stem in sorted(ladders):
            rung = sorted(ladders[stem])
            if len(rung) < 2 or rung[0][0] != 0:
                continue
            v0, _t0 = mesh_geometry(gltf, binary, by[rung[0][1]])
            label = name if not printed else ""
            printed = True
            sub = "" if len(ladders) == 1 else " [%s]" % stem
            print("  %-22s %8s %10s  %s"
                  % (label, "LOD0", "0.00",
                     "all (it IS the reference)" + sub))
            tiers = {0: 0}
            for lvl, ln in rung[1:]:
                vt, tt = mesh_geometry(gltf, binary, by[ln])
                d = deviation(v0, vt, tt)
                t = tier_for(d)
                earns = ("none" if t is None
                         else ", ".join("c%d" % k
                                        for k in range(t, len(CASCADE_M))))
                print("  %-22s %8s %10.2f  %s"
                      % ("", "LOD%d" % lvl, d * 1000.0, earns))
                tiers[lvl] = t
            # Which tier each cascade actually gets: the finest tier admitted.
            drawn = []
            for ci in range(len(CASCADE_M)):
                pick = 0
                for lvl in sorted(tiers, reverse=True):
                    if lvl and tiers[lvl] is not None and tiers[lvl] <= ci:
                        pick = lvl
                        break
                drawn.append(pick)
            m = marginal(drawn)
            rows.append(("%s%s" % (name, sub), drawn, m))
            print("  %-22s %8s %10s  cascades draw tiers %s -> MARGINAL %.1fx"
                  % ("", "", "", ",".join(str(d) for d in drawn), m))
    print("-" * 78)
    worst = [r for r in rows if r[2] >= 4.0]
    if worst:
        print("  AT THE FULL 4.0x (every cascade still on tier 0): %s"
              % ", ".join(r[0] for r in worst))
    print("  A tier under %.2f mm earns cascade 1 and halves the multiplier."
          % (CASCADE_M[1] * 1000.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
