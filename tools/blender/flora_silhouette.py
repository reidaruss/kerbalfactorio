"""flora_silhouette.py - is this tree's OUTLINE a function of its yaw?

    python tools/blender/flora_silhouette.py assets/models/dist/props/props_canopy.glb
    python tools/blender/flora_silhouette.py <glb> --node Canopy_Pine_LOD0
    python tools/blender/flora_silhouette.py <glb> --foliage      # WG-14 ratios

WHY THIS EXISTS, AND WHY IT IS NOT A SCREENSHOT.

RN-183 named the defect: the mid-field canopy repeats one umbrella outline by
the dozen, and the per-instance tint and size that ship cannot touch it because
the repetition is SILHOUETTE. RN-63 had already written down the mechanism for
a different family: "rotation does not change a silhouette viewed from a level
camera". The scatter yaws every canopy instance through a full turn
(ScatterEmit.ts:153), so the engine is ALREADY drawing each tree at hundreds of
different angles. If the asset is a solid of revolution, every one of those
angles produces the same outline and the variety machinery is running on
nothing.

That makes the fix checkable without a renderer at all. Rotate the exported
LOD0 about its own up axis, project it, and ask how much the outline actually
moves. A solid of revolution scores near zero on every number below no matter
how nice it looks; a tree with real bough structure cannot score near zero
however it is lit. So this measures the PROPERTY (RN-62's rule) rather than a
consequence of it, and it is immune to every lighting question, which is what
lets the geometry pass run ahead of look development.

WHAT IT REPORTS, per node, over `--yaws` evenly spaced rotations:

  width  cv   coefficient of variation of the projected WIDTH. This is the
               number a distant viewer reads: two trees of visibly different
               widths do not look like the same tree.
  area   cv   coefficient of variation of the projected filled AREA. Width can
               move while area does not (a shape that is merely wide one way
               and tall the other); both moving means the mass moved.
  IoU         mean pairwise intersection-over-union of the filled silhouettes,
               taken in the ASSET'S OWN FRAME (x = 0 is the placement origin,
               which is what two yaws of one instance genuinely share). 1.000
               means every rotation draws the same picture, which is the defect.
  IoU 90      the same for pairs a quarter turn apart, i.e. the worst case a
               viewer walking round one tree sees.
  off         the horizontal distance from the placement origin to the
               silhouette's own AREA CENTROID, as a fraction of the width. A
               centred crown scores ~0 and cannot avoid repeating; a crown that
               leans has to present a different profile as it turns.

The raster is deliberately coarse (default 256 across). The question is whether
the OUTLINE moved, and a fine grid would start reporting facet noise as
silhouette change, which is the tile-size failure in INSTRUMENTS.md with the
sign flipped: too fine an instrument here flatters, where too coarse a one
flattered the sun glint.

--foliage reports WG-14's rule instead: the lowest vertex on any non-Bark
primitive as a fraction of the node's own height, measured off the EXPORTED
BYTES because Parts.fit rescales z after the build script has finished. That is
the number that keeps scenery trees distinguishable from harvestable ones at a
glance, and any pass that adds variety has to show it did not blur that.

glTF is Y up (the Blender exporter maps (x, y, z) -> (x, z, -y)), so "yaw" here
is a rotation about +Y and "height" is +Y.
"""

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import validate_glb as vg      # noqa: E402  (GLB reader, scene walk, accessors)


def node_triangles(gltf, binc, walked, idx, out):
    """World-space triangles of node `idx` and its descendants, with the
    material name each one came from."""
    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    mats = gltf.get("materials", [])
    n = nodes[idx]
    _, m, _ = walked[idx]
    if "mesh" in n:
        for prim in meshes[n["mesh"]].get("primitives", []):
            if prim.get("mode", 4) != 4:
                continue
            pos = [vg.xform(m, p)
                   for p in vg.read_accessor(gltf, binc,
                                             prim["attributes"]["POSITION"])]
            if "indices" in prim:
                ix = [i[0] for i in vg.read_accessor(gltf, binc,
                                                     prim["indices"])]
            else:
                ix = list(range(len(pos)))
            name = (mats[prim["material"]].get("name", "")
                    if "material" in prim and prim["material"] < len(mats)
                    else "")
            for k in range(0, len(ix) - 2, 3):
                out.append((pos[ix[k]], pos[ix[k + 1]], pos[ix[k + 2]], name))
    for c in n.get("children", []):
        node_triangles(gltf, binc, walked, c, out)
    return out


def raster(tris, yaw, nx, ny, half, ylo, yhi):
    """Fill a boolean grid with the tree's outline, seen from +Z after the
    whole tree has been rotated by `yaw` radians about +Y.

    Standard half-space triangle fill over the triangle's own bounding cells.
    No depth, no culling: a silhouette is the UNION of every triangle, which is
    exactly what a viewer at range sees of an opaque crown."""
    ca, sa = math.cos(yaw), math.sin(yaw)
    grid = bytearray(nx * ny)
    sx = (2.0 * half) / nx
    sy = (yhi - ylo) / ny
    for (a, b, c, _m) in tris:
        px = []
        for p in (a, b, c):
            x = p[0] * ca + p[2] * sa
            px.append(((x + half) / sx, (p[1] - ylo) / sy))
        x0 = max(0, int(math.floor(min(q[0] for q in px))))
        x1 = min(nx - 1, int(math.ceil(max(q[0] for q in px))))
        y0 = max(0, int(math.floor(min(q[1] for q in px))))
        y1 = min(ny - 1, int(math.ceil(max(q[1] for q in px))))
        if x1 < x0 or y1 < y0:
            continue
        (ax, ay), (bx, by), (cx, cy) = px
        d = (by - ay) * (cx - ax) - (bx - ax) * (cy - ay)
        if abs(d) < 1e-12:
            continue
        for gy in range(y0, y1 + 1):
            fy = gy + 0.5
            for gx in range(x0, x1 + 1):
                fx = gx + 0.5
                w0 = ((by - ay) * (fx - ax) - (bx - ax) * (fy - ay)) / d
                w1 = ((fy - ay) * (cx - ax) - (fx - ax) * (cy - ay)) / d
                if w0 >= 0.0 and w1 >= 0.0 and w0 + w1 <= 1.0:
                    grid[gy * nx + gx] = 1
    return grid


def measure(tris, yaws, nx=256, ny=256):
    """-> dict of the six numbers this tool exists to print."""
    xs = [p[k] for t in tris for p in t[:3] for k in (0, 2)]
    ys = [p[1] for t in tris for p in t[:3]]
    half = max(abs(min(xs)), abs(max(xs))) * 1.02 + 1e-6
    ylo, yhi = min(ys), max(ys)
    grids, widths, areas, cents = [], [], [], []
    for yaw in yaws:
        g = raster(tris, yaw, nx, ny, half, ylo, yhi)
        grids.append(g)
        cols = [gx for gx in range(nx)
                if any(g[gy * nx + gx] for gy in range(ny))]
        widths.append((max(cols) - min(cols) + 1) * (2.0 * half / nx)
                      if cols else 0.0)
        n = sum(g)
        areas.append(n * (2.0 * half / nx) * ((yhi - ylo) / ny))
        cx = (sum(gx for gy in range(ny) for gx in range(nx)
                  if g[gy * nx + gx]) / float(n)) if n else nx * 0.5
        cents.append((cx + 0.5) * (2.0 * half / nx) - half)

    def cv(v):
        m = sum(v) / len(v)
        if m <= 0:
            return 0.0
        var = sum((x - m) ** 2 for x in v) / len(v)
        return math.sqrt(var) / m

    def iou(a, b):
        inter = union = 0
        for k in range(len(a)):
            if a[k] or b[k]:
                union += 1
                if a[k] and b[k]:
                    inter += 1
        return inter / float(union) if union else 1.0

    ny_ = len(yaws)
    pairs = [iou(grids[i], grids[j])
             for i in range(ny_) for j in range(i + 1, ny_)]
    q = ny_ // 4
    quarter = [iou(grids[i], grids[(i + q) % ny_]) for i in range(ny_)] if q \
        else pairs
    wmean = sum(widths) / len(widths)
    return {
        "w_min": min(widths), "w_max": max(widths), "w_cv": cv(widths),
        "a_min": min(areas), "a_max": max(areas), "a_cv": cv(areas),
        "iou": sum(pairs) / len(pairs) if pairs else 1.0,
        "iou90": sum(quarter) / len(quarter) if quarter else 1.0,
        "off": (sum(abs(c) for c in cents) / len(cents)) / wmean
               if wmean > 0 else 0.0,
        "height": yhi - ylo,
    }


def foliage_ratio(tris):
    """WG-14: the lowest vertex on any non-Bark primitive, as a fraction of the
    node's own height. Bark is the trunk; everything else is foliage."""
    ys = [p[1] for t in tris for p in t[:3]]
    lo, hi = min(ys), max(ys)
    fy = [p[1] for t in tris for p in t[:3] if not t[3].endswith("Bark")]
    if not fy:
        return None, hi - lo
    return (min(fy) - lo) / (hi - lo), hi - lo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--node", action="append", default=[])
    ap.add_argument("--yaws", type=int, default=12)
    ap.add_argument("--grid", type=int, default=256)
    ap.add_argument("--foliage", action="store_true")
    a = ap.parse_args()

    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    path = a.glb if os.path.isabs(a.glb) else os.path.join(root, a.glb)
    gltf, binc, _n = vg.read_glb(path)
    walked = vg.walk(gltf)
    want = a.node or None
    targets = [(i, nm) for i, (nm, _m, _p) in sorted(walked.items())
               if nm.endswith("_LOD0") and not nm.startswith("col_")
               and (want is None or nm in want)
               and "_Half_" not in nm and "_Low_" not in nm
               and "_Stump_" not in nm]
    if not targets:
        print("no _LOD0 node matched")
        return 1

    yaws = [2.0 * math.pi * k / a.yaws for k in range(a.yaws)]
    if a.foliage:
        print("%-28s %8s %8s" % ("node", "height", "lowest"))
        for idx, nm in targets:
            tris = node_triangles(gltf, binc, walked, idx, [])
            r, h = foliage_ratio(tris)
            print("%-28s %8.3f %8s"
                  % (nm, h, "none" if r is None else "%.3f" % r))
        return 0

    print("%-24s %6s %6s %6s %7s %7s %7s %7s"
          % ("node", "h", "w_min", "w_max", "w_cv", "a_cv", "IoU", "IoU90"))
    for idx, nm in targets:
        tris = node_triangles(gltf, binc, walked, idx, [])
        m = measure(tris, yaws, a.grid, a.grid)
        print("%-24s %6.2f %6.2f %6.2f %7.4f %7.4f %7.4f %7.4f   off=%.3f"
              % (nm, m["height"], m["w_min"], m["w_max"], m["w_cv"],
                 m["a_cv"], m["iou"], m["iou90"], m["off"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
