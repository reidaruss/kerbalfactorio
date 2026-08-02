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


def deviation(v0, verts_t, tris_t, cell=0.35):
    """max over LOD0's vertices of the distance to the tier's SURFACE.

    Uniform-grid broad phase over the tier's triangles, then the exact
    point-to-triangle distance for the candidates. The grid is what makes this
    a second rather than a minute: the smelter is 2,276 triangles against
    ~1,300 vertices, and the naive product is 3 million exact tests per pair.
    The radius grows until it finds something, so a sparse tier is correct and
    merely slower rather than wrong."""
    if not tris_t:
        return float("inf")
    grid = {}
    for t in tris_t:
        a, b, c = verts_t[t[0]], verts_t[t[1]], verts_t[t[2]]
        lo = [min(a[i], b[i], c[i]) for i in range(3)]
        hi = [max(a[i], b[i], c[i]) for i in range(3)]
        for ix in range(int(math.floor(lo[0] / cell)), int(math.floor(hi[0] / cell)) + 1):
            for iy in range(int(math.floor(lo[1] / cell)), int(math.floor(hi[1] / cell)) + 1):
                for iz in range(int(math.floor(lo[2] / cell)), int(math.floor(hi[2] / cell)) + 1):
                    grid.setdefault((ix, iy, iz), []).append(t)
    worst = 0.0
    for p in v0:
        home = tuple(int(math.floor(p[i] / cell)) for i in range(3))
        best = float("inf")
        r = 0
        while True:
            got = False
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    for dz in range(-r, r + 1):
                        if r > 0 and max(abs(dx), abs(dy), abs(dz)) != r:
                            continue
                        for t in grid.get((home[0] + dx, home[1] + dy,
                                           home[2] + dz), ()):
                            got = True
                            d2 = _pt_tri_dist2(p, verts_t[t[0]], verts_t[t[1]],
                                               verts_t[t[2]])
                            if d2 < best:
                                best = d2
            # Stop only when the shell searched is provably farther than the
            # best hit so far: a nearer triangle cannot hide in a ring whose
            # inner face already exceeds it.
            if best < float("inf") and (r * cell) ** 2 >= best:
                break
            if not got and r > 24:
                break
            r += 1
        worst = max(worst, best)
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
        lods = [n for n in c["lod_nodes"] if n in by]
        if len(lods) < 2:
            continue
        v0, _t0 = mesh_geometry(gltf, binary, by[lods[0]])
        tiers = [0]
        print("  %-22s %8s %10s  %s" % (name, "LOD0", "0.00", "all (it IS the reference)"))
        for li, ln in enumerate(lods[1:], start=1):
            vt, tt = mesh_geometry(gltf, binary, by[ln])
            d = deviation(v0, vt, tt)
            t = tier_for(d)
            earns = ("none" if t is None
                     else ", ".join("c%d" % k for k in range(t, len(CASCADE_M))))
            print("  %-22s %8s %10.2f  %s"
                  % ("", "LOD%d" % li, d * 1000.0, earns))
            tiers.append(t)
        # Which tier each cascade actually gets: the finest tier admitted.
        drawn = []
        for ci in range(len(CASCADE_M)):
            pick = 0
            for li in range(len(tiers) - 1, 0, -1):
                if tiers[li] is not None and tiers[li] <= ci:
                    pick = li
                    break
            drawn.append(pick)
        m = marginal(drawn)
        rows.append((name, drawn, m))
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
