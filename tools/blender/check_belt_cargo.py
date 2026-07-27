#!/usr/bin/env python3
"""check_belt_cargo.py - can the SHIPPED items actually ride the SHIPPED belts?

    python tools/blender/check_belt_cargo.py            the whole report
    python tools/blender/check_belt_cargo.py selftest   prove the rules can fail

WHY THIS EXISTS AND WHY IT IS NOT validate_glb.py OR check_mating.py.

validate_glb checks one asset against one contract: right size, right pivot,
right sockets present. check_mating checks that two parts which should touch do
touch. Neither can see this bug class, because it is not about a file and it is
not about two parts of one machine: it is about an ITEM and a BELT, authored in
different files, on different days, by rules that were never written down.

Three of those rules had never been checked by anything:

  1. THE FLOW-AXIS BOUND. core/include/of/factory_sim.h saturates a belt at
     kItemSpacing of kUnitsPerTile, which on a 1 m tile is 0.250 m between item
     centres - four per tile, the Factorio number. An item deeper than 0.250 m
     along the flow axis therefore interpenetrates its neighbour the moment the
     line backs up. Twelve of the fourteen items satisfied it by luck; two did
     not, and nobody had noticed because nothing had ever put an item on a belt.

  2. WHERE AN ITEM'S BOTTOM IS. Items are pivoted at their volumetric centre
     (they tumble when dropped), but an item on a belt RESTS on it. Without a
     published bottom, every consumer needs a per-item half-height table. The
     bottom is published as a child Empty named socket_rest, and this checks
     that it really is on the mesh's own lowest point rather than near it.

  3. WHERE THE PATH IS. Each belt tile publishes socket_item_a (entry),
     socket_item (midpoint) and socket_item_b (exit). The client rule is one
     rule for both tile shapes: an item's position across a tile is the
     CIRCULAR ARC through those three points. This checks that the three points
     really do describe that arc - collinear on a straight tile, and on a
     circle of radius 0.5 about the tile's own corner on a curve, which is the
     same curve MachineBatch.ts's fragment shader already walks for its flow
     band.

EVERYTHING HERE IS MEASURED OFF assets/models/dist. Nothing is imported from a
build script and no dimension is retyped from ASSET-SPECS: a check generated
from the builder would only ever prove the builder agrees with itself. The two
sim constants ARE read from core/include/of/factory_sim.h, because that is
where they live and a check that hardcoded 0.250 would go quietly stale the day
kItemSpacing changed.

Per-tile EXPECTATIONS are derived too, not typed. A tile whose socket_belt_out
faces the opposite edge from socket_belt_in is a straight; one whose outlet is
on a side edge is a curve, and the corner it must turn about is the
intersection of those two edges; one with no socket_belt_out at all is a
terminator, and its path is a stub. So the checker never has to be told which
file is which.

Stdlib only - no Blender, no npm, no pip. Runs in CI as a plain python3 step.
"""

import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import validate_glb as V  # noqa: E402

ROOT = V.ROOT
FAILURES = []

ITEMS_GLB = "assets/models/dist/items/items_atlas.glb"
BELTS = ["assets/models/dist/machines/belt_segment.glb",
         "assets/models/dist/machines/belt_curve_l.glb",
         "assets/models/dist/machines/belt_curve_r.glb",
         "assets/models/dist/machines/belt_end_cap.glb"]
SIM_HEADER = "core/include/of/factory_sim.h"

# Tolerances, each one stated where it is used rather than tuned globally.
TOL_REST = 1e-4      # 0.1 mm: socket_rest on the mesh minimum
TOL_PLANE = 1e-4     # 0.1 mm: three path points share one Y
TOL_LINE = 1e-5      # 10 um: sagitta below which a path is a straight line
TOL_ARC = 1e-4       # 0.1 mm: fitted radius / centre against the tile corner
TOL_EDGE = 1e-4      # 0.1 mm: a point sitting on a tile boundary plane
TILE = 1.0           # the build-grid cell, and the straight tile's arc length


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------

def head(text):
    print("\n" + text)
    print("-" * max(len(text), 68))


def ok(label, passed, detail=""):
    if not passed:
        FAILURES.append("%s: %s" % (label, detail))
    print("  [%s] %-46s %s" % ("ok" if passed else "XX", label, detail))
    return passed


# --------------------------------------------------------------------------
# Reading a shipped file
# --------------------------------------------------------------------------

class Scene:
    """One .glb, walked once. glTF here is already three.js axes (X right,
    Y up, Z forward), because export_yup fired at author time."""

    def __init__(self, rel):
        self.rel = rel
        self.name = os.path.basename(rel)
        self.path = os.path.join(ROOT, rel.replace("/", os.sep))
        self.nbytes = os.path.getsize(self.path)
        self.gltf, self.binc, _ = V.read_glb(self.path)
        self.walked = V.walk(self.gltf)
        self.by_name = {}
        for idx, (nm, _m, _p) in self.walked.items():
            self.by_name.setdefault(nm, []).append(idx)

    def has(self, name):
        return name in self.by_name

    def index(self, name):
        hits = self.by_name.get(name)
        if not hits:
            raise KeyError("%s: no node named %s" % (self.name, name))
        return hits[0]

    def origin(self, name):
        m = self.walked[self.index(name)][1]
        return (m[12], m[13], m[14])

    def bounds(self, name):
        acc = V.node_bbox(self.gltf, self.walked, self.index(name),
                          [[1e30] * 3, [-1e30] * 3])
        return acc[0], acc[1]

    def children(self, name):
        return [self.walked[c][0]
                for c in self.gltf["nodes"][self.index(name)].get("children", [])]

    def mesh_nodes(self):
        """Every node that carries a mesh, by name."""
        return sorted(nm for idx, (nm, _m, _p) in self.walked.items()
                      if "mesh" in self.gltf["nodes"][idx])

    def material_bounds(self, node, material):
        """World AABB of just the primitives of `node` using `material`.

        The belt's carrying surface is a rubber one and its frame is a steel
        one, so 'how high is the deck' is a question about a material and not
        about a node's bounding box."""
        idx = self.index(node)
        m = self.walked[idx][1]
        n = self.gltf["nodes"][idx]
        lo, hi = [1e30] * 3, [-1e30] * 3
        found = False
        for prim in self.gltf["meshes"][n["mesh"]].get("primitives", []):
            if "material" not in prim:
                continue
            if self.gltf["materials"][prim["material"]].get("name") != material:
                continue
            a = self.gltf["accessors"][prim["attributes"]["POSITION"]]
            if not a.get("min") or not a.get("max"):
                continue
            found = True
            for i in range(8):
                p = [a["max"][0] if i & 1 else a["min"][0],
                     a["max"][1] if i & 2 else a["min"][1],
                     a["max"][2] if i & 4 else a["min"][2]]
                w = V.xform(m, p)
                for k in range(3):
                    lo[k] = min(lo[k], w[k])
                    hi[k] = max(hi[k], w[k])
        return (lo, hi) if found else None


def sim_constants():
    """kUnitsPerTile and kItemSpacing, read from the header that defines them."""
    path = os.path.join(ROOT, SIM_HEADER.replace("/", os.sep))
    src = open(path, "r", encoding="utf-8").read()

    def grab(sym):
        m = re.search(r"\b%s\s*=\s*(\d+)" % sym, src)
        if not m:
            raise KeyError("%s: %s not found" % (SIM_HEADER, sym))
        return int(m.group(1))

    return grab("kUnitsPerTile"), grab("kItemSpacing")


# --------------------------------------------------------------------------
# THE RULES, as pure arithmetic. Every one of these is exercised by selftest()
# against fabricated bad input, which is the only way "it passed" means
# anything (DW-20).
# --------------------------------------------------------------------------

def flow_extent_ok(z_extent, bound):
    """Rule 1: an item's own flow-axis depth must fit the saturation pitch."""
    return z_extent <= bound + 1e-9


def rest_socket_ok(socket_xyz, lo, hi):
    """Rule 2: socket_rest is on the item's lowest point, on its vertical axis."""
    return (abs(socket_xyz[1] - lo[1]) <= TOL_REST
            and abs(socket_xyz[0] - (lo[0] + hi[0]) * 0.5) <= TOL_REST
            and abs(socket_xyz[2] - (lo[2] + hi[2]) * 0.5) <= TOL_REST)


def sagitta(a, m, b):
    """Perpendicular distance of m from the chord a->b, in metres.

    A metric test, not a determinant test: 'these three points are a straight
    line' has to mean 'to within a distance you could see', and a normalised
    cross product is that distance."""
    ax, ay = a
    bx, by = b
    mx, my = m
    dx, dy = bx - ax, by - ay
    span = math.hypot(dx, dy)
    if span < 1e-12:
        return float("inf")
    return abs(dx * (my - ay) - dy * (mx - ax)) / span


def circumcircle(a, m, b):
    """Centre and radius of the circle through three 2D points, or None."""
    ax, ay = a
    bx, by = m
    cx, cy = b
    d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-15:
        return None
    a2, b2, c2 = ax * ax + ay * ay, bx * bx + by * by, cx * cx + cy * cy
    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    return (ux, uy), math.hypot(ax - ux, ay - uy)


def classify_path(a, m, b):
    """Rule 3: -> ('line', length, None, None) or ('arc', length, centre, r).

    THE published client rule, executed: the path across a tile is the circular
    arc through entry, midpoint and exit. Three collinear points degenerate it
    to the chord, which is exactly why a straight tile and a curve need no
    per-shape special case in the client."""
    if sagitta(a, m, b) <= TOL_LINE:
        return "line", math.hypot(b[0] - a[0], b[1] - a[1]), None, None
    fit = circumcircle(a, m, b)
    if fit is None:
        return "degenerate", 0.0, None, None
    centre, r = fit
    aa = math.atan2(a[1] - centre[1], a[0] - centre[0])
    am = math.atan2(m[1] - centre[1], m[0] - centre[0])
    ab = math.atan2(b[1] - centre[1], b[0] - centre[0])
    return "arc", r * abs(_sweep(aa, am, ab)), centre, r


def _wrap(x):
    return (x + math.pi) % (2.0 * math.pi) - math.pi


def _sweep(aa, am, ab):
    """Signed a->b sweep that passes THROUGH m. Without the m test the arc
    could be taken the long way round the circle, which is a 3/4 turn where the
    tile has a 1/4 turn, and the two are indistinguishable from the endpoints."""
    d = _wrap(ab - aa)
    dm = _wrap(am - aa)
    if d == 0.0:
        return 0.0
    if not (0.0 <= dm / d <= 1.0):
        d = d - math.copysign(2.0 * math.pi, d)
    return d


def sample_path(a, m, b, n=33):
    """n points along the path, inclusive of both ends."""
    kind, _len, centre, r = classify_path(a, m, b)
    if kind != "arc":
        return [(a[0] + (b[0] - a[0]) * i / (n - 1.0),
                 a[1] + (b[1] - a[1]) * i / (n - 1.0)) for i in range(n)]
    aa = math.atan2(a[1] - centre[1], a[0] - centre[0])
    am = math.atan2(m[1] - centre[1], m[0] - centre[0])
    ab = math.atan2(b[1] - centre[1], b[0] - centre[0])
    d = _sweep(aa, am, ab)
    out = []
    for i in range(n):
        ang = aa + d * i / (n - 1.0)
        out.append((centre[0] + r * math.cos(ang),
                    centre[1] + r * math.sin(ang)))
    return out


def on_boundary(p, half=0.5):
    """Is this point ON one of the tile's four boundary planes?"""
    return (abs(abs(p[0]) - half) <= TOL_EDGE
            or abs(abs(p[1]) - half) <= TOL_EDGE)


def inside_footprint(p, half=0.5, slack=TOL_EDGE):
    return abs(p[0]) <= half + slack and abs(p[1]) <= half + slack


def is_corner(c, half=0.5, tol=TOL_ARC):
    return abs(abs(c[0]) - half) <= tol and abs(abs(c[1]) - half) <= tol


# --------------------------------------------------------------------------
# The items
# --------------------------------------------------------------------------

def items(bound, per_tile, spacing, deck_w):
    sc = Scene(ITEMS_GLB)
    names = [n for n in sc.mesh_nodes() if n.startswith("Item_")]

    head("FLOW-AXIS EXTENT: an item must fit the belt's own saturation pitch")
    print("      kItemSpacing %d of kUnitsPerTile %d on a %.2f m tile "
          "-> %.4f m between item centres" % (spacing, per_tile, TILE, bound))
    print("      %-24s %8s %8s %8s   %s"
          % ("item", "Z (flow)", "margin", "X", "vs deck"))
    worst = ("", -1.0)
    for n in names:
        lo, hi = sc.bounds(n)
        dz, dx = hi[2] - lo[2], hi[0] - lo[0]
        over = dx - deck_w
        good = flow_extent_ok(dz, bound)
        if dz > worst[1]:
            worst = (n, dz)
        if not good:
            FAILURES.append("%s is %.4f m deep along the flow axis, over the "
                            "%.4f m saturation pitch" % (n, dz, bound))
        print("  [%s] %-24s %8.4f %+8.4f %8.4f   %s"
              % ("ok" if good else "XX", n, dz, bound - dz, dx,
                 "fits" if over <= 0.0 else "overhangs %+.4f m" % over))
    print("      deepest item %s at %.4f m, %.1f%% of the pitch"
          % (worst[0], worst[1], 100.0 * worst[1] / bound))
    ok("all %d items inside the %.3f m flow bound" % (len(names), bound),
       all(flow_extent_ok(sc.bounds(n)[1][2] - sc.bounds(n)[0][2], bound)
           for n in names))

    head("socket_rest: every item publishes its own bottom, so nothing needs "
         "a half-height table")
    print("      tolerance %.4f m; socket_rest must be at the item's minimum Y "
          "and on its vertical axis" % TOL_REST)
    for n in names:
        kids = [c for c in sc.children(n) if c.startswith("socket_")]
        rest = [c for c in kids if c == "socket_rest"]
        if len(rest) != 1:
            ok("%s socket_rest child count" % n, False,
               "%d, want exactly 1 (children: %s)" % (len(rest), kids or "none"))
            continue
        lo, hi = sc.bounds(n)
        idx = [c for c in sc.gltf["nodes"][sc.index(n)].get("children", [])
               if sc.walked[c][0] == "socket_rest"][0]
        m = sc.walked[idx][1]
        p = (m[12], m[13], m[14])
        good = rest_socket_ok(p, lo, hi)
        ok("%s socket_rest" % n, good,
           "y %+.5f, mesh min y %+.5f, dy %+.6f m; x %+.5f z %+.5f"
           % (p[1], lo[1], p[1] - lo[1], p[0], p[2]))
    print("      %d bytes, %d nodes" % (sc.nbytes, len(sc.walked)))
    return names


# --------------------------------------------------------------------------
# The belt tiles
# --------------------------------------------------------------------------

def tile_shape(sc):
    """-> (kind, corner). Derived from the tile's OWN belt sockets, never typed.

    A tile whose outlet faces the plane opposite its inlet is a straight; one
    whose outlet is on a side plane is a curve, and the corner it turns about is
    where those two boundary planes meet; one with no outlet is a terminator."""
    p_in = sc.origin("socket_belt_in")
    a_in = (p_in[0], p_in[2])
    if not sc.has("socket_belt_out"):
        return "terminator", None, a_in, None
    p_out = sc.origin("socket_belt_out")
    a_out = (p_out[0], p_out[2])
    if abs(abs(a_out[1]) - 0.5) <= TOL_EDGE and abs(a_in[1] + a_out[1]) <= TOL_EDGE:
        return "straight", None, a_in, a_out
    corner = (math.copysign(0.5, a_out[0]), a_in[1])
    return "curve", corner, a_in, a_out


def belts():
    lengths = {}
    seg = Scene(BELTS[0])
    dlo, dhi = seg.material_bounds("BeltSegment_LOD0", "OF_Rubber")
    deck_w = dhi[0] - dlo[0]

    for rel in BELTS:
        sc = Scene(rel)
        head("%s" % sc.name)
        kind, corner, a_in, a_out = tile_shape(sc)

        missing = [s for s in ("socket_item_a", "socket_item", "socket_item_b")
                   if not sc.has(s)]
        if not ok("path sockets present", not missing,
                  "socket_item_a / socket_item / socket_item_b"
                  if not missing else "MISSING %s" % missing):
            continue
        pa = sc.origin("socket_item_a")
        pm = sc.origin("socket_item")
        pb = sc.origin("socket_item_b")
        a, m, b = (pa[0], pa[2]), (pm[0], pm[2]), (pb[0], pb[2])

        # --- one ride plane -------------------------------------------------
        ys = [pa[1], pm[1], pb[1]]
        ok("the three path points share one Y (+/-%.4f m)" % TOL_PLANE,
           max(ys) - min(ys) <= TOL_PLANE,
           "a %.4f  item %.4f  b %.4f  spread %.6f m"
           % (ys[0], ys[1], ys[2], max(ys) - min(ys)))
        ride = sum(ys) / 3.0

        # --- the ride plane IS a surface, not a number near one -------------
        lod0 = [n for n in sc.mesh_nodes() if n.endswith("_LOD0")][0]
        deck = sc.material_bounds(lod0, "OF_Rubber")
        carry = max(sc.material_bounds(n, "OF_Rubber")[1][1]
                    for n in sc.mesh_nodes()
                    if not n.startswith("col_")
                    and not re.search(r"_LOD[1-9]$", n)
                    and sc.material_bounds(n, "OF_Rubber"))
        print("      rubber deck top %.4f m, highest rubber (the slats) %.4f m,"
              " ride plane %.4f m" % (deck[1][1], carry, ride))
        ok("the ride plane is the carrying surface", abs(ride - carry) <= TOL_PLANE,
           "ride %.4f vs highest rubber %.4f, dy %+.6f m"
           % (ride, carry, ride - carry))
        ok("the ride plane is above the deck", ride > deck[1][1],
           "%.4f > %.4f m" % (ride, deck[1][1]))

        # --- the path enters and leaves where the BELT does ------------------
        ok("socket_item_a is on a tile boundary plane", on_boundary(a),
           "(%+.4f, %+.4f)" % a)
        ok("socket_item_a agrees with socket_belt_in",
           math.hypot(a[0] - a_in[0], a[1] - a_in[1]) <= TOL_EDGE,
           "path (%+.4f, %+.4f) vs belt (%+.4f, %+.4f)" % (a + a_in))
        if kind == "terminator":
            print("      no socket_belt_out: this tile TERMINATES a line, so"
                  " its path is a stub")
            ok("socket_item_b is inside the tile", inside_footprint(b),
               "(%+.4f, %+.4f)" % b)
        else:
            ok("socket_item_b is on a tile boundary plane", on_boundary(b),
               "(%+.4f, %+.4f)" % b)
            ok("socket_item_b agrees with socket_belt_out",
               math.hypot(b[0] - a_out[0], b[1] - a_out[1]) <= TOL_EDGE,
               "path (%+.4f, %+.4f) vs belt (%+.4f, %+.4f)" % (b + a_out))

        # --- the shape -------------------------------------------------------
        shape, arclen, centre, r = classify_path(a, m, b)
        want = "arc" if kind == "curve" else "line"
        ok("path shape is a %s" % want, shape == want,
           "measured %s, sagitta %.3e m (line below %.0e)"
           % (shape, sagitta(a, m, b), TOL_LINE))
        if shape == "arc":
            ok("fitted radius is the 0.5 m centre line",
               abs(r - 0.5) <= TOL_ARC, "r = %.6f m" % r)
            ok("fitted centre is the tile's own corner", is_corner(centre),
               "(%+.6f, %+.6f), derived corner (%+.2f, %+.2f)"
               % (centre[0], centre[1], corner[0], corner[1]))
            ok("fitted centre IS the derived corner",
               math.hypot(centre[0] - corner[0], centre[1] - corner[1]) <= TOL_ARC,
               "%.2e m apart"
               % math.hypot(centre[0] - corner[0], centre[1] - corner[1]))
        else:
            mid = ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)
            ok("socket_item is the midpoint of a -> b",
               math.hypot(m[0] - mid[0], m[1] - mid[1]) <= TOL_ARC,
               "item (%+.4f, %+.4f), midpoint (%+.4f, %+.4f)" % (m + mid))

        # --- the whole path, not just its three points -----------------------
        pts = sample_path(a, m, b)
        out = [p for p in pts if not inside_footprint(p)]
        ok("the whole path stays inside the 1 x 1 m footprint", not out,
           "%d of %d samples inside" % (len(pts) - len(out), len(pts)))

        lengths[sc.name] = (shape, arclen)
        print("      ARC LENGTH %.6f m   (%s)" % (arclen, shape))
        print("      %d bytes, %d nodes" % (sc.nbytes, len(sc.walked)))

    head("ARC LENGTH IS NOT TILE COUNT")
    base = lengths.get("belt_segment.glb", (None, TILE))[1]
    for name in sorted(lengths):
        shape, L = lengths[name]
        print("      %-22s %-5s %.6f m   %+6.1f%% vs a straight tile"
              % (name, shape, L, 100.0 * (L - base) / base))
    quarter = math.pi / 4.0
    for name in ("belt_curve_l.glb", "belt_curve_r.glb"):
        if name in lengths:
            ok("%s measures pi/4" % name,
               abs(lengths[name][1] - quarter) <= 1e-6,
               "%.6f vs %.6f m" % (lengths[name][1], quarter))
    print("      A curve is %.1f%% shorter than a straight tile. An item"
          " advanced at a constant" % (100.0 * (1.0 - quarter / TILE)))
    print("      rate in TILE FRACTIONS therefore accelerates through every"
          " corner. Parameterise")
    print("      by arc length, never by offsetTiles alone.")
    return deck_w


# --------------------------------------------------------------------------
# DW-20: a check that has never failed has not been shown to work
# --------------------------------------------------------------------------

def selftest():
    head("SELFTEST: every rule above, run against input that is WRONG")
    bound = 0.250
    cases = []

    # Rule 1, the flow-axis bound.
    cases.append(("an item 0.300 m deep on a 0.250 m pitch",
                  flow_extent_ok(0.300, bound), False))
    cases.append(("an item 0.2501 m deep, one tenth of a mm over",
                  flow_extent_ok(0.2501, bound), False))
    cases.append(("an item exactly 0.250 m deep (LEGAL)",
                  flow_extent_ok(0.250, bound), True))
    cases.append(("Item_FramePart at its new 0.240 m depth (LEGAL)",
                  flow_extent_ok(0.240, bound), True))

    # Rule 2, socket_rest.
    lo, hi = (-0.12, -0.11, -0.10), (0.12, 0.11, 0.10)
    cases.append(("socket_rest 20 mm above the item's bottom",
                  rest_socket_ok((0.0, -0.09, 0.0), lo, hi), False))
    cases.append(("socket_rest at the CENTRE, i.e. never moved off the pivot",
                  rest_socket_ok((0.0, 0.0, 0.0), lo, hi), False))
    cases.append(("socket_rest off the vertical axis by 5 mm",
                  rest_socket_ok((0.005, -0.11, 0.0), lo, hi), False))
    cases.append(("socket_rest on the bottom, on the axis (LEGAL)",
                  rest_socket_ok((0.0, -0.11, 0.0), lo, hi), True))

    # Rule 3, the path. A straight tile, a left curve, and three ways to be
    # neither: bowed, on the wrong circle, and centred off the corner.
    straight = ((0.0, -0.5), (0.0, 0.0), (0.0, 0.5))
    q = 0.5 - 0.5 / math.sqrt(2.0)
    curve_l = ((0.0, -0.5), (-q, -q), (-0.5, 0.0))

    def path_ok(a, m, b, want_shape):
        shape, _L, centre, r = classify_path(a, m, b)
        if shape != want_shape:
            return False
        if shape == "line":
            mid = ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)
            return math.hypot(m[0] - mid[0], m[1] - mid[1]) <= TOL_ARC
        return abs(r - 0.5) <= TOL_ARC and is_corner(centre)

    cases.append(("a straight tile's three points (LEGAL)",
                  path_ok(*straight, want_shape="line"), True))
    cases.append(("a left curve's exact quarter circle (LEGAL)",
                  path_ok(*curve_l, want_shape="arc"), True))
    cases.append(("a path bowed 50 mm: neither a line nor the right circle",
                  path_ok((0.0, -0.5), (0.05, 0.0), (0.0, 0.5),
                          want_shape="arc"), False))
    s = 0.31 / math.sqrt(2.0)
    cases.append(("an arc on the right corner but r = 0.31 not 0.5",
                  path_ok((-0.19, -0.5), (-0.5 + s, -0.5 + s), (-0.5, -0.19),
                          want_shape="arc"), False))
    cases.append(("an r = 0.5 arc centred on (0.10, 0.20), not a corner",
                  path_ok((0.10, -0.30), (0.10 + 0.5 / math.sqrt(2.0),
                                          0.20 + 0.5 / math.sqrt(2.0)),
                          (0.60, 0.20), want_shape="arc"), False))
    cases.append(("collinear, but socket_item is not between a and b",
                  path_ok((0.0, -0.5), (0.0, 0.8), (0.0, 0.5),
                          want_shape="line"), False))

    # The ride plane and the footprint.
    cases.append(("three path points 5 mm apart in Y",
                  max(0.280, 0.285, 0.280) - min(0.280, 0.285, 0.280)
                  <= TOL_PLANE, False))
    cases.append(("three path points on one Y (LEGAL)",
                  max(0.280, 0.280, 0.280) - min(0.280, 0.280, 0.280)
                  <= TOL_PLANE, True))
    cases.append(("a path point 120 mm outside the tile",
                  inside_footprint((0.62, 0.0)), False))
    cases.append(("a path point on the tile edge (LEGAL)",
                  inside_footprint((0.5, 0.0)), True))

    # The long-way-round trap the socket_item test exists to close: from the
    # endpoints alone a quarter turn and a three-quarter turn are the same two
    # points on the same circle, and only the midpoint tells them apart.
    _shape, L_short, _c, _r = classify_path(*curve_l)
    cases.append(("the quarter arc is pi/4 and not the 3/4 turn (LEGAL)",
                  abs(L_short - math.pi / 4.0) <= 1e-9, True))

    n_bad = 0
    for label, got, want in cases:
        good = (got == want)
        if not good:
            FAILURES.append("selftest: %s" % label)
            n_bad += 1
        print("  [%s] %-62s fires=%-5s (want %s)"
              % ("ok" if good else "XX", label[:62], not got, not want))
    print("      %d cases, %d must fire, %d must not, %d wrong"
          % (len(cases), sum(1 for _l, _g, w in cases if not w),
             sum(1 for _l, _g, w in cases if w), n_bad))


# --------------------------------------------------------------------------

def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    print("check_belt_cargo: measuring the SHIPPED .glb files in "
          "assets/models/dist")
    if which in ("all", "belts", "items"):
        per_tile, spacing = sim_constants()
        bound = TILE * spacing / float(per_tile)
        print("  sim constants read from %s: kUnitsPerTile=%d kItemSpacing=%d"
              % (SIM_HEADER, per_tile, spacing))
        deck_w = belts() if which in ("all", "belts") else 0.80
        if which in ("all", "items"):
            print("\n      deck width measured off belt_segment's own rubber "
                  "deck: %.4f m" % deck_w)
            items(bound, per_tile, spacing, deck_w)
    if which in ("all", "selftest"):
        selftest()

    print()
    if FAILURES:
        print("FAILED (%d):" % len(FAILURES))
        for f in FAILURES:
            print("  " + f)
        return 1
    print("BELT CARGO CONVENTION HOLDS ON THE SHIPPED BYTES")
    return 0


if __name__ == "__main__":
    sys.exit(main())
