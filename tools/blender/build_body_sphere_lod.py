"""
build_body_sphere_lod.py - Tier 2, the scaled far-scene body.

    blender --background --python tools/blender/build_body_sphere_lod.py

Produces assets/models/dist/world/body_sphere_lod.glb.

A UNIT icosphere at three subdivision levels. This is the mesh the renderer
draws a planet with once the body is far enough away that the cubed-sphere
terrain quadtree is not resident: Forge and Cinder from orbit, and every body
in the map view.

RADIUS COMES FROM BodyParams, NEVER FROM THE MESH. The sphere is authored at
radius 1.0 and the renderer scales it by radiusM (Forge 600 km, Cinder 200 km,
of::orbital::kForgeRadiusM / kCinderRadiusM). One mesh, every body.

WHY AN ICOSPHERE AND NOT A UV SPHERE. A UV sphere puts half its vertices in a
pinch at each pole and stretches its quads to nothing there, which on a planet
is exactly where the player flies over on a polar orbit. A geodesic sphere has
no poles at all: every triangle is within a few percent of every other one.

THE MESH IS INSCRIBED, NOT CIRCUMSCRIBED. Every vertex sits exactly on radius
1.0, so every FACE sags below it, and the horizon of the drawn sphere is
slightly inside the true one. The sag is printed per level below and is in the
contract comment: at LOD0 it is 0.45%, which on Forge is 2.7 km at a distance
where the body is already hundreds of kilometres away. A renderer that
cares (a horizon-clipped atmosphere shell, say) scales by radiusM * (1 + sag)
rather than by radiusM.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import of_lib as of  # noqa: E402

NAME = "BodySphere"
OUT = of.dist_path("world", "body_sphere_lod.glb")

# LOD level -> subdivision count. 3 / 2 / 1 gives 1280 / 320 / 80 triangles,
# which is the 100 / 25 / 6 percent ratio ASSET-SPECS 2.4 asks for, near
# enough, and it lands on exact powers of four because that is what
# subdividing a triangle does.
LEVELS = ((0, 3), (1, 2), (2, 1))

PHI = (1.0 + math.sqrt(5.0)) * 0.5


def icosahedron():
    """The canonical unit icosahedron. The vertex table and the face table
    below belong TOGETHER: a face list from one arrangement of the twelve
    vertices applied to another arrangement still builds twenty triangles,
    still exports, still validates, and is a folded tangle rather than a
    sphere. The sag readout is what catches it (a real subdiv-3 sphere sags
    0.45%, a scrambled one reads 16%)."""
    x = 1.0 / math.sqrt(1.0 + PHI * PHI)      # 0.5257311
    z = PHI * x                               # 0.8506508
    v = [(-x, 0.0, z), (x, 0.0, z), (-x, 0.0, -z), (x, 0.0, -z),
         (0.0, z, x), (0.0, z, -x), (0.0, -z, x), (0.0, -z, -x),
         (z, x, 0.0), (-z, x, 0.0), (z, -x, 0.0), (-z, -x, 0.0)]
    f = [(0, 1, 4), (0, 4, 9), (9, 4, 5), (4, 8, 5), (4, 1, 8),
         (8, 1, 10), (8, 10, 3), (5, 8, 3), (5, 3, 2), (2, 3, 7),
         (7, 3, 10), (7, 10, 6), (7, 6, 11), (11, 6, 0), (0, 6, 1),
         (6, 10, 1), (9, 11, 0), (9, 2, 11), (9, 5, 2), (7, 11, 2)]
    return [_unit(p) for p in v], f


def _unit(p):
    L = math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2])
    return (p[0] / L, p[1] / L, p[2] / L)


def subdivide(verts, faces):
    """One Loop-style split: each triangle becomes four, every new vertex
    pushed back out onto the unit sphere. The midpoint cache is what keeps the
    mesh WELDED: without it every triangle gets its own copy of each edge
    midpoint, smooth shading breaks along every edge, and the vertex count
    triples for nothing."""
    verts = list(verts)
    cache = {}

    def mid(a, b):
        key = (min(a, b), max(a, b))
        if key not in cache:
            pa, pb = verts[a], verts[b]
            verts.append(_unit(((pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5,
                                (pa[2] + pb[2]) * 0.5)))
            cache[key] = len(verts) - 1
        return cache[key]

    out = []
    for a, b, c in faces:
        ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
        out += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
    return verts, out


def icosphere(n):
    v, f = icosahedron()
    for _ in range(n):
        v, f = subdivide(v, f)
    return v, f


def sag(verts, faces):
    """1 - (distance from the centre to the closest face centroid). The
    geometric error the inscribed mesh carries, as a fraction of radius."""
    worst = 0.0
    for a, b, c in faces:
        p = [(verts[a][k] + verts[b][k] + verts[c][k]) / 3.0 for k in range(3)]
        worst = max(worst, 1.0 - math.sqrt(sum(q * q for q in p)))
    return worst


def main():
    of.reset_scene()
    root = of.add_root(NAME)

    report = []
    for level, subdiv in LEVELS:
        v, f = icosphere(subdiv)
        mb = of.MeshBuilder()
        mb.add_raw(v, f, [True] * len(f), "Regolith")
        name = "%s_LOD%d" % (NAME, level)
        mb.build(name, root)
        report.append((name, mb))
        lo, hi = mb.bounds()
        print("[body] %-16s subdiv %d  %5d tris  %5d verts  "
              "AABB %.4f  sag %.4f%%"
              % (name, subdiv, mb.tri_count(), len(v), hi[0] - lo[0],
                 100.0 * sag(v, f)))

    of.report(NAME, report)
    of.export_glb(OUT, export_force_sampling=False)


if __name__ == "__main__":
    main()
