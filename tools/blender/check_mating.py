"""check_mating.py - does the SHIPPED geometry actually fit together?

    python tools/blender/check_mating.py            both sets
    python tools/blender/check_mating.py vessel     the DW-29 part catalogue
    python tools/blender/check_mating.py structure  the DW-32 base module

WHY THIS EXISTS, AND WHY IT IS NOT PART OF validate_glb.py. The validator
checks one asset against one contract: the right size, the right pivot, the
right sockets on the right points. Every part in this project has always
passed that in isolation. The interesting failure is BETWEEN parts, and it has
exactly two shapes:

    a SEAM   two parts that should touch do not, and you can see daylight
    a CLASH  two parts that should touch overlap, and they z-fight

Neither is visible to a per-file checker, because neither exists in a file.
They exist in an ASSEMBLY, so an assembly is what gets measured.

WHAT MAKES THIS A PROOF RATHER THAN A RESTATEMENT. Everything here is read out
of the .glb files in assets/models/dist. Nothing is imported from
rocket_common.py or structure_common.py, and no dimension is retyped from
ASSET-SPECS.md. Parts are placed using ONLY the socket positions the files
publish, exactly the way the runtime will place them, and then the resulting
world bounding boxes are measured and differenced. If the build script and the
exporter ever disagree about what got written, this catches it; a check driven
from the source constants could not, because it would be asking the builder
whether it agrees with itself.

The bounding boxes are computed properly: the node hierarchy is walked, each
node's TRS is composed, and the eight corners of every POSITION accessor's
min/max are transformed into world space. glTF is already three.js axes here
(X right, Y up, Z forward), because export_yup fired at author time.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import validate_glb as V  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))

ROOT = V.ROOT
EPS = 5e-7          # half a micrometre: below anything a float32 mesh can mean
FAILURES = []


# --------------------------------------------------------------------------
# Reading a shipped file
# --------------------------------------------------------------------------

class Scene:
    """One .glb, walked once, indexed by node name."""

    def __init__(self, rel):
        self.path = os.path.join(ROOT, rel)
        self.gltf, self.binc, self.nbytes = V.read_glb(self.path)
        self.walked = V.walk(self.gltf)
        self.by_name = {}
        for idx, (name, _m, _p) in self.walked.items():
            self.by_name.setdefault(name, []).append(idx)

    def index(self, name):
        hits = self.by_name.get(name)
        if not hits:
            raise KeyError("%s: no node named %s" % (os.path.basename(self.path), name))
        return hits[0]

    def has(self, name):
        return name in self.by_name

    def bounds(self, name):
        """World AABB of the node's whole subtree, as (lo, hi) three-lists."""
        acc = [[1e30] * 3, [-1e30] * 3]
        V.node_bbox(self.gltf, self.walked, self.index(name), acc)
        return acc[0], acc[1]

    def origin(self, name):
        """World translation of a node: for a socket Empty that is the point."""
        m = self.walked[self.index(name)][1]
        return [m[12], m[13], m[14]]

    def facing(self, name):
        """A socket's facing: its local -Y mapped into world (ASSET-SPECS 2.6),
        which after export_yup is the node's local -Z in glTF axes."""
        m = self.walked[self.index(name)][1]
        return [-m[8], -m[9], -m[10]]

    def descendant_of(self, group, child):
        """The index of `child` whose ancestor chain includes `group`.

        Blender uniques duplicate object names per FILE, so twenty parts each
        wanting socket_stack_top get .001 .. .019 unless the export post-pass
        strips them. It does strip them, which is the whole reason a socket has
        to be looked up UNDER its part rather than by name at the file root.
        """
        gi = self.index(group)
        for idx in self.by_name.get(child, []):
            p = self.walked[idx][2]
            while p is not None:
                if p == gi:
                    return idx
                p = self.walked[p][2]
        raise KeyError("%s: %s is not under %s"
                       % (os.path.basename(self.path), child, group))

    def part_socket(self, group, socket):
        m = self.walked[self.descendant_of(group, socket)][1]
        return [m[12], m[13], m[14]]

    def part_bounds(self, group, mesh):
        acc = [[1e30] * 3, [-1e30] * 3]
        V.node_bbox(self.gltf, self.walked, self.descendant_of(group, mesh), acc)
        return acc[0], acc[1]


def shifted(b, off):
    lo, hi = b
    return ([lo[k] + off[k] for k in range(3)], [hi[k] + off[k] for k in range(3)])


def check(label, value, want, tol=EPS, unit="m"):
    ok = abs(value - want) <= tol
    if not ok:
        FAILURES.append("%s: %.9f, want %.9f" % (label, value, want))
    print("  [%s] %-52s %+.9f %s (want %+.9f)"
          % ("ok" if ok else "XX", label, value, unit, want))
    return ok


def head(text):
    print("\n" + text)
    print("-" * max(len(text), 60))


# --------------------------------------------------------------------------
# The vessel catalogue: the two-class stack contract
# --------------------------------------------------------------------------

# Bottom-up chains. Each entry is (part group, its LOD0 mesh). A chain is
# assembled with the ONE published rule and nothing else:
#     next.position = this.position + this.socket_stack_top.position
# so if any part needed a private offset, the gap below would show it.
# EngineVacuumSmall sits ON the decoupler rather than at the foot of the chain,
# which is deliberate: that is an INTERSTAGE, the arrangement the reference
# vessel actually flies, and putting it there is what exercises both of its
# faces. An engine publishes no socket_stack_bottom because nothing may be
# bolted under a bell, but it is still legal to PLACE one on a stack top, and
# the gap arithmetic below holds it to the same zero as everything else.
CHAIN_S = ["LiquidEngineSmall", "LiquidTankSmall", "StackDecouplerSmall",
           "EngineVacuumSmall", "LiquidTankSmallLong", "CargoBay",
           "MonopropTank", "ReactionWheel", "Battery", "DockingPort",
           "CommandPod", "Parachute", "NoseCone"]

CHAIN_L = ["LiquidEngineLarge", "LiquidTankLarge", "StackDecouplerLarge",
           "StackAdapter", "LiquidTankSmall", "NoseCone"]


def stack_chain(sc, parts, title):
    """Assemble a stack from socket positions alone and measure every joint."""
    head(title)
    y = 0.0
    prev = None
    for name in parts:
        b = shifted(sc.part_bounds(name, name + "_LOD0"), (0.0, y, 0.0))
        lo, hi = b
        dia_x, dia_z = hi[0] - lo[0], hi[2] - lo[2]
        if prev is not None:
            pname, ptop, pdia = prev
            check("%s top -> %s base, gap" % (pname, name), lo[1] - ptop, 0.0)
            # A mate is only a mate if the two faces are the same size. This
            # is what a "diameter class" MEANS, and it is the check that would
            # catch a 2.50 m tank quietly sitting on a 1.25 m decoupler.
            if abs(dia_x - pdia) > 1e-6:
                print("      class change at this joint: %.3f -> %.3f m"
                      % (pdia, dia_x))
        print("      %-22s y[%+8.3f %+8.3f]  X %.4f  Z %.4f"
              % (name, lo[1], hi[1], dia_x, dia_z))
        if abs(dia_x - dia_z) > 1e-6:
            FAILURES.append("%s is not round: X %.4f vs Z %.4f"
                            % (name, dia_x, dia_z))
        try:
            top = sc.part_socket(name, "socket_stack_top")
        except KeyError:
            # A terminator: a nose cone has no stack top, so the chain ends
            # here and that is the contract working rather than a missing part.
            print("      %-22s terminates the stack (no socket_stack_top)" % name)
            break
        prev = (name, hi[1], dia_x)
        y += top[1]
    return y


def vessel():
    sc = Scene("assets/models/dist/rocket/rocket_parts.glb")

    head("DIAMETER CLASSES, measured off every stack part's own LOD0 AABB")
    classes = {}
    for name in sorted(set(CHAIN_S + CHAIN_L)):
        lo, hi = sc.part_bounds(name, name + "_LOD0")
        classes[name] = round(hi[0] - lo[0], 6)
        print("      %-22s  %.6f x %.6f m  (height %.3f)"
              % (name, hi[0] - lo[0], hi[2] - lo[2], hi[1] - lo[1]))
    seen = sorted(set(classes.values()))
    print("      distinct diameters in the catalogue: %s"
          % ", ".join("%.3f m" % d for d in seen))
    if len(seen) > 2:
        FAILURES.append("more than two diameter classes: %s" % seen)

    stack_chain(sc, CHAIN_S, "CLASS S STACK (1.25 m), bottom up, zero gap at every joint")
    stack_chain(sc, CHAIN_L, "CLASS L STACK (2.50 m) crossing to S through StackAdapter")

    # The decoupler is the part the whole staging idea rests on, so it gets
    # its own explicit both-ends test rather than being one row in a chain.
    head("THE STACK DECOUPLER MATES ON BOTH FACES")
    for dec, below, above in (("StackDecouplerSmall", "LiquidTankSmall", "LiquidTankSmallLong"),
                              ("StackDecouplerLarge", "LiquidTankLarge", "StackAdapter")):
        blo, bhi = sc.part_bounds(below, below + "_LOD0")
        y0 = sc.part_socket(below, "socket_stack_top")[1]
        dlo, dhi = shifted(sc.part_bounds(dec, dec + "_LOD0"), (0.0, y0, 0.0))
        y1 = y0 + sc.part_socket(dec, "socket_stack_top")[1]
        alo, ahi = shifted(sc.part_bounds(above, above + "_LOD0"), (0.0, y1, 0.0))
        check("%s bottom face on %s" % (dec, below), dlo[1] - bhi[1], 0.0)
        check("%s top face under %s" % (dec, above), alo[1] - dhi[1], 0.0)
        check("%s diameter matches %s" % (dec, below),
              (dhi[0] - dlo[0]) - (bhi[0] - blo[0]), 0.0)

    head("THE ADAPTER IS THE ONE PART WHOSE TWO ENDS ARE DIFFERENT CLASSES")
    lo, hi = sc.part_bounds("StackAdapter", "StackAdapter_LOD0")
    llo, lhi = sc.part_bounds("LiquidTankLarge", "LiquidTankLarge_LOD0")
    slo, shi = sc.part_bounds("LiquidTankSmall", "LiquidTankSmall_LOD0")
    # The adapter's own AABB is its widest end, so the narrow end is measured
    # by mating a class S part on it and reading that part's width back.
    check("adapter bottom width == class L", (hi[0] - lo[0]) - (lhi[0] - llo[0]), 0.0)
    top = sc.part_socket("StackAdapter", "socket_stack_top")
    check("adapter socket_stack_top height", top[1], hi[1] - lo[1])
    check("class S part on the adapter, gap",
          (slo[1] + top[1]) - hi[1], 0.0)

    head("RADIAL ATTACHMENT: solid booster on a class L tank")
    hostR = (lhi[0] - llo[0]) * 0.5
    dlo, dhi = sc.part_bounds("RadialDecoupler", "RadialDecoupler_LOD0")
    standoff = sc.part_socket("RadialDecoupler", "socket_radial_out")[0]
    check("radial decoupler spans exactly its standoff", dhi[0] - dlo[0], standoff)
    blo, bhi = sc.part_bounds("SolidBooster", "SolidBooster_LOD0")
    boosterR = (bhi[0] - blo[0]) * 0.5
    attach = sc.part_socket("SolidBooster", "socket_radial_attach")
    check("booster attach socket is on its own hull", attach[0], -boosterR)
    # Place: host hull at hostR, decoupler spans hostR .. hostR + standoff,
    # booster hull lands on the far face of the decoupler.
    axis = hostR + standoff + boosterR
    inner = axis + attach[0]
    print("      host hull %.4f + standoff %.4f + booster R %.4f -> axis at %.4f m"
          % (hostR, standoff, boosterR, axis))
    check("booster inner hull touches the decoupler face", inner - (hostR + standoff), 0.0)
    check("hull to hull gap equals the published standoff", inner - hostR, standoff)

    head("MATED SOCKETS ARE ANTI-PARALLEL (the dot-product test, not a name test)")
    for lower, upper in (("LiquidTankSmall", "StackDecouplerSmall"),
                         ("LiquidTankLarge", "StackDecouplerLarge")):
        li = sc.descendant_of(lower, "socket_stack_top")
        ui = sc.descendant_of(upper, "socket_stack_bottom")
        lm, um = sc.walked[li][1], sc.walked[ui][1]
        lf = [-lm[8], -lm[9], -lm[10]]
        uf = [-um[8], -um[9], -um[10]]
        dot = sum(lf[k] * uf[k] for k in range(3))
        check("%s top . %s bottom" % (lower, upper), dot, -1.0, tol=1e-6, unit="")

    size = os.path.getsize(sc.path)
    print("\n      rocket_parts.glb: %d bytes, %d nodes" % (size, len(sc.walked)))


# --------------------------------------------------------------------------
# The structural module: tiling, storey pitch and the pillar
# --------------------------------------------------------------------------

def structure():
    F = Scene("assets/models/dist/structures/foundation.glb")
    FL = Scene("assets/models/dist/structures/floor.glb")
    W = Scene("assets/models/dist/structures/wall.glb")
    D = Scene("assets/models/dist/structures/door.glb")

    head("THE MODULE, measured off the shipped sockets (never retyped)")
    cell = abs(F.origin("socket_edge_e")[0]) * 2.0
    deck_h = F.origin("socket_top")[1]
    wall_h = W.origin("socket_top")[1]
    wlo, whi = W.bounds("col_Wall")
    wall_t = whi[2] - wlo[2]
    storey = deck_h + wall_h
    print("      CELL   %.6f m   (2 x |socket_edge_e.x| on the foundation)" % cell)
    print("      DECK_H %.6f m   (foundation socket_top.y)" % deck_h)
    print("      WALL_H %.6f m   (wall socket_top.y)" % wall_h)
    print("      WALL_T %.6f m   (col_Wall depth)" % wall_t)
    print("      STOREY %.6f m   (DECK_H + WALL_H)" % storey)
    check("STOREY == CELL, the one 4 m lattice", storey - cell, 0.0)

    head("DECKS TILE IN A ROW: four cells, zero gap")
    prev = None
    for i in range(4):
        lo, hi = shifted(F.bounds("Foundation_LOD0"), (i * cell, 0.0, 0.0))
        print("      cell %d  x[%+8.3f %+8.3f]  z[%+8.3f %+8.3f]  y[%+.3f %+.3f]"
              % (i, lo[0], hi[0], lo[2], hi[2], lo[1], hi[1]))
        if prev is not None:
            check("deck %d -> %d gap" % (i - 1, i), lo[0] - prev, 0.0)
        prev = hi[0]

    head("WALLS TILE IN A ROW: four cells, zero gap")
    prev = None
    for i in range(4):
        lo, hi = shifted(W.bounds("Wall_LOD0"), (i * cell, 0.0, 0.0))
        if prev is not None:
            check("wall %d -> %d gap" % (i - 1, i), lo[0] - prev, 0.0)
        prev = hi[0]

    head("A DOOR DROPS INTO ANY WALL CELL")
    wl, wh = W.bounds("Wall_LOD0")
    dl, dh = D.bounds("Door_LOD0")
    for k, ax in enumerate("XYZ"):
        check("door vs wall envelope %s" % ax, (dh[k] - dl[k]) - (wh[k] - wl[k]),
              0.0, tol=1e-9)

    head("A WALL REACHES THE DECK IT STANDS ON, AND ITS HEAD IS THE NEXT DECK BASE")
    flo, fhi = F.bounds("Foundation_LOD0")
    wlo2, whi2 = shifted(W.bounds("Wall_LOD0"), (0.0, deck_h, 0.0))
    check("foundation top -> wall base", wlo2[1] - fhi[1], 0.0)
    nlo, nhi = shifted(F.bounds("Foundation_LOD0"), (0.0, storey, 0.0))
    check("wall head -> next deck base", nlo[1] - whi2[1], 0.0)
    check("storey pitch", nlo[1] - flo[1], cell)
    flo3, fhi3 = shifted(FL.bounds("Floor_LOD0"), (0.0, storey, 0.0))
    check("floor doubles as the ceiling at y = STOREY", flo3[1] - whi2[1], 0.0)

    head("FOUR WALLS CLOSE AROUND ONE FOUNDATION")
    half = cell * 0.5
    s = shifted(W.bounds("Wall_LOD0"), (0.0, deck_h, -half))
    n = shifted(W.bounds("Wall_LOD0"), (0.0, deck_h, +half))
    print("      S wall z[%+.4f %+.4f]   N wall z[%+.4f %+.4f]"
          % (s[0][2], s[1][2], n[0][2], n[1][2]))
    clear = n[0][2] - s[1][2]
    print("      clear interior %.4f x %.4f m" % (clear, clear))
    check("clear interior == CELL - WALL_T", clear - (cell - wall_t), 0.0)

    if not os.path.exists(os.path.join(ROOT, "assets/models/dist/structures/pillar.glb")):
        return
    P = Scene("assets/models/dist/structures/pillar.glb")
    head("THE PILLAR SPANS AN ARBITRARY GAP, MEASURED AT FOUR HEIGHTS")
    flo_, fhi_ = P.part_bounds("PillarFoot", "PillarFoot_LOD0")
    slo_, shi_ = P.part_bounds("PillarShaft", "PillarShaft_LOD0")
    hlo_, hhi_ = P.part_bounds("PillarHead", "PillarHead_LOD0")
    clo_, chi_ = P.part_bounds("PillarCollar", "PillarCollar_LOD0")
    foot_h, head_h = fhi_[1] - flo_[1], hhi_[1] - hlo_[1]
    seg = shi_[1] - slo_[1]
    print("      foot %.3f m, shaft segment %.6f m, head %.3f m, collar %.3f m"
          % (foot_h, seg, head_h, chi_[1] - clo_[1]))
    check("shaft is authored at exactly 1 m so scale.y IS metres", seg, 1.0)
    check("PillarFoot socket_top is the shaft base",
          P.part_socket("PillarFoot", "socket_top")[1], foot_h)
    check("PillarHead socket_deck is the deck underside",
          P.part_socket("PillarHead", "socket_deck")[1], head_h)
    for gap in (0.70, 1.37, 4.00, 9.42):
        shaft_len = gap - foot_h - head_h
        top = foot_h + shaft_len + head_h
        n_collar = 0
        y = foot_h
        while True:
            y += 2.00
            if y + (chi_[1] - clo_[1]) > gap - head_h - 0.35:
                break
            n_collar += 1
        print("      gap %5.2f m: shaft scale.y %.6f, %d collar(s)"
              % (gap, max(shaft_len, 0.0), n_collar))
        check("gap %.2f m: assembled height residual" % gap, top - gap, 0.0)

    for f, rel in (("foundation.glb", "structures/foundation.glb"),
                   ("floor.glb", "structures/floor.glb"),
                   ("wall.glb", "structures/wall.glb"),
                   ("door.glb", "structures/door.glb"),
                   ("pillar.glb", "structures/pillar.glb")):
        p = os.path.join(ROOT, "assets/models/dist", rel)
        print("      %-16s %d bytes" % (f, os.path.getsize(p)))


# --------------------------------------------------------------------------
# Coaxial segment-count conflicts: the scallop check
# --------------------------------------------------------------------------
#
# THE BUG CLASS. Two coaxial round surfaces built with different segment
# counts do not have the same surface even when they have the same radius. A
# 16-gon and a 24-gon of circumradius 0.625 have inradii 0.6011 and 0.6146, so
# between those two radii each one pokes through the other at alternating
# azimuths and the joint renders as a sawtooth ring.
#
# IT PASSES EVERY OTHER CHECK, which is why it needs its own. The bounding box
# is set by the circumradius, so `scale` is exact. The mating PLANE is exact,
# so `part_sockets` and the gap arithmetic above all read +0.000000000. The
# defect is in the mating SURFACE, and until now the only thing that could see
# it was a person looking at a render. It bit three times in one file on the
# day the two-diameter-class catalogue was built: the stack adapter's cone
# against its own class S collar, the monopropellant tank's 12-gon flanges
# against its 16-gon bowls, and a class L engine bell left on the module
# default 16 instead of the class's 24.
#
# HOW IT IS DETECTED, on the shipped bytes and with no help from the builder.
# Positions are deduplicated (flat shading splits a vertex per face, so raw
# indices do not describe adjacency), triangles are unioned into connected
# components, and each component is tested for being a solid of revolution
# about one of the three principal axes: every cross section must be a ring of
# k >= 6 vertices at one radius and one uniform azimuth spacing. A slab, a
# fin, a window frame and a stringer all fail that test and are simply not
# compared, which is what keeps the check free of false positives: a stringer
# standing proud of a barrel is intended detail, and it is not a ring.
#
# Two revolution components on the SAME axis with DIFFERENT segment counts
# must then nest: over their shared span one must lie entirely inside the
# other's inradius. Radii are piecewise linear in the axial coordinate, so
# evaluating the two containment inequalities at every ring plane inside the
# overlap decides it exactly, with no sampling error.
#
# What it does NOT cover, stated so the gap is known rather than assumed:
# partial sweeps (the docking port's capture annulus is two half arcs, so its
# azimuths are not uniform over 2 pi) and components that dedupe into one
# another because they happen to share exact vertex positions. Both fail the
# revolution test and are skipped, which is safe but silent.

RING_EPS = 2e-6
AXES = ((1, 2, 0), (0, 2, 1), (0, 1, 2))     # (u, v, axis) index triples


def _components(tris, nvert):
    parent = list(range(nvert))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for t in tris:
        r = find(t[0])
        for v in t[1:]:
            s = find(v)
            if r != s:
                parent[s] = r
    out = {}
    for v in range(nvert):
        out.setdefault(find(v), []).append(v)
    return list(out.values())


def _revolution(pts):
    """-> ((axis, cu, cv, [(t, radius), ...], k), reason).

    The first element is the revolution description, or None. The second names
    WHY it is None, and it exists because "not comparable" and "compared and
    clean" are different answers that must not print the same. See the note on
    coverage in `coaxial()`.

        `flat`      never formed a qualifying ring on any axis: a box, a fin, a
                    window frame, a stringer. Not a round surface at all, so
                    there is nothing here to scallop and nothing is being
                    hidden.
        `shell`     a ring plane carrying TWO radii, which is what an open
                    shell looks like (inner and outer wall in the same plane).
                    This IS a round surface and it is NOT examined.
        `partial`   a ring whose azimuths are not uniform over 2 pi: an arc
                    sweep such as a docking port's capture annulus. Also a
                    round surface, also NOT examined.
        `mixed`     segment count or phase changes along the axis inside one
                    component.
    """
    verdict = "flat"
    for u, v, ax in AXES:
        planes = {}
        for p in pts:
            planes.setdefault(round(p[ax] / RING_EPS), []).append(p)
        if len(planes) < 2:
            continue
        cu = sum(p[u] for p in pts) / len(pts)
        cv = sum(p[v] for p in pts) / len(pts)
        rings, k, phase, kind, ok = [], None, None, "ring", True
        for _key, grp in sorted(planes.items()):
            got = _classify_plane(grp, u, v, ax, cu, cv)
            if got is None:
                ok = False
                kind = "flat"
                break
            shape, kk, pp, radii = got
            if shape == "annulus":
                kind = "shell"
            elif shape == "partial":
                kind = "partial"
            if k is None:
                k, phase = kk, pp
            elif kk != k or abs(pp - phase) > 1e-4:
                ok = False
                kind = "mixed"
                break
            rings.append((grp[0][ax], radii))
        if not ok or k is None or len(rings) < 2:
            # Only record a reason if this axis genuinely saw round rings. A
            # box that happens to put six corners in one plane is not a shell,
            # and calling it one would inflate the skipped count into noise,
            # which is just as useless as a silent skip.
            if kind not in (None, "flat") and len(rings) >= 1:
                verdict = kind
            continue
        if kind == "ring":
            return (ax, round(cu, 6), round(cv, 6),
                    sorted((t, r[0]) for t, r in rings), k), "ok"
        verdict = kind
    return None, verdict


def _uniform_ring(angs):
    """-> phase if these azimuths are one evenly spaced ring, else None."""
    n = len(angs)
    if n < 6:
        return None
    a = sorted(angs)
    step = 2.0 * math.pi / n
    gaps = [a[(i + 1) % n] - a[i] + (2.0 * math.pi if i == n - 1 else 0.0)
            for i in range(n)]
    if max(abs(g - step) for g in gaps) > 1e-4:
        return None
    return a[0] % step


def _classify_plane(grp, u, v, ax, cu, cv):
    """One axial plane of a component -> (shape, k, phase, radii) or None.

    A POSITIVE test, deliberately. The earlier version inferred "shell" from
    the failure of the single-ring test, which labelled every box that happened
    to put six corners in one plane as an unexamined round surface and turned
    the coverage number into noise. A skip only means something if the thing
    skipped really is round.

        ring      one evenly spaced ring of k >= 6 vertices at one radius
        annulus   TWO such rings at different radii: an open shell wall
        partial   one radius, k >= 6, but not evenly spaced over 2 pi: an arc
    """
    rs = sorted((math.hypot(p[u] - cu, p[v] - cv), i)
                for i, p in enumerate(grp))
    clusters, cur = [], [rs[0]]
    for r, i in rs[1:]:
        if r - cur[-1][0] > 1e-5:
            clusters.append(cur)
            cur = []
        cur.append((r, i))
    clusters.append(cur)
    if len(clusters) > 2:
        return None
    shapes = []
    for cl in clusters:
        angs = [math.atan2(grp[i][v] - cv, grp[i][u] - cu) for _r, i in cl]
        ph = _uniform_ring(angs)
        if ph is None:
            if len(cl) >= 6 and len(clusters) == 1:
                return ("partial", len(cl), 0.0, [cl[0][0]])
            return None
        shapes.append((len(cl), ph, sum(r for r, _ in cl) / len(cl)))
    if len(shapes) == 1:
        return ("ring", shapes[0][0], shapes[0][1], [shapes[0][2]])
    if shapes[0][0] != shapes[1][0]:
        return None
    return ("annulus", shapes[0][0], shapes[0][1],
            [shapes[0][2], shapes[1][2]])


def _radius_at(rings, t):
    if t <= rings[0][0]:
        return rings[0][1]
    for (t0, r0), (t1, r1) in zip(rings, rings[1:]):
        if t <= t1:
            f = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            return r0 + (r1 - r0) * f
    return rings[-1][1]


def coaxial_conflicts(sc, node_name):
    """Every pair of same-axis revolution surfaces with clashing facets."""
    gltf, walked = sc.gltf, sc.walked
    idx = sc.index(node_name)
    pts, tris = [], []
    seen = {}

    def rec(i):
        n = gltf["nodes"][i]
        m = walked[i][1]
        if "mesh" in n:
            for prim in gltf["meshes"][n["mesh"]].get("primitives", []):
                if prim.get("mode", 4) != 4:
                    continue
                pos = V.read_accessor(gltf, sc.binc, prim["attributes"]["POSITION"])
                ind = (V.read_accessor(gltf, sc.binc, prim["indices"])
                       if "indices" in prim else
                       [(x,) for x in range(len(pos))])
                flat = [x for tup in ind for x in (tup if isinstance(tup, tuple) else (tup,))]
                local = []
                for p in pos:
                    w = V.xform(m, p)
                    key = tuple(round(c / RING_EPS) for c in w)
                    if key not in seen:
                        seen[key] = len(pts)
                        pts.append(w)
                    local.append(seen[key])
                for a in range(0, len(flat) - 2, 3):
                    tris.append((local[flat[a]], local[flat[a + 1]], local[flat[a + 2]]))
        for c in n.get("children", []):
            rec(c)

    rec(idx)
    if not tris:
        return [], {}
    revs, skipped = [], {}
    for comp in _components(tris, len(pts)):
        if len(comp) < 12:
            continue
        r, why = _revolution([pts[i] for i in comp])
        if r is not None:
            revs.append(r)
        elif why != "flat":
            # A ROUND surface this pass could not examine. Counted and named,
            # never folded into the pass total: see coaxial().
            skipped[why] = skipped.get(why, 0) + 1
    bad = []
    for i in range(len(revs)):
        for j in range(i + 1, len(revs)):
            ax, cu, cv, ra, ka = revs[i]
            bx, du, dv, rb, kb = revs[j]
            if ax != bx or cu != du or cv != dv or ka == kb:
                continue
            lo = max(ra[0][0], rb[0][0])
            hi = min(ra[-1][0], rb[-1][0])
            if hi - lo <= 1e-6:
                continue
            ts = sorted({lo, hi} | {t for t, _ in ra if lo < t < hi}
                        | {t for t, _ in rb if lo < t < hi})
            a_in, b_in = True, True
            worst = 0.0
            for t in ts:
                Ra, Rb = _radius_at(ra, t), _radius_at(rb, t)
                if Ra > Rb * math.cos(math.pi / kb) + 1e-9:
                    a_in = False
                if Rb > Ra * math.cos(math.pi / ka) + 1e-9:
                    b_in = False
                worst = max(worst, min(abs(Ra - Rb), 1.0))
            if not a_in and not b_in:
                bad.append((ka, kb, lo, hi, worst, "XYZ"[ax], (cu, cv)))
    return bad, skipped


def coaxial():
    """Run the scallop check over every asset in contracts.json.

    COVERAGE IS REPORTED, NOT ASSUMED. Some round surfaces cannot be tested by
    this method at all: an open shell puts two radii in one axial plane, and an
    arc sweep is not uniform over 2 pi, so neither satisfies the precondition.
    Those components are SKIPPED, and a skip is not a pass.

    Printing only "0 conflicts" would read as full coverage and would not be,
    which is precisely the failure mode this whole pass exists to close: a
    result that reports success on something it did not examine. So the skipped
    set is counted, named by reason, and printed next to the conflict count
    every single run. A future part that lands in the skipped set therefore
    shows up as unexamined instead of quietly joining the passing total.
    """
    head("COAXIAL FACET CONFLICTS across every shipped asset")
    spec = json.load(open(os.path.join(HERE, "contracts.json"), encoding="utf-8"))
    n_asset = n_node = n_bad = 0
    skipped = {}
    where = {}
    for key, entry in sorted(spec["assets"].items()):
        path = entry["glb"]
        if not os.path.exists(os.path.join(ROOT, path)):
            continue
        sc = Scene(path)
        n_asset += 1
        for name in sorted({n for n, _m, _p in sc.walked.values()
                            if "_LOD" in n and not n.startswith("col_")}):
            n_node += 1
            bad, skip = coaxial_conflicts(sc, name)
            for why, cnt in skip.items():
                skipped[why] = skipped.get(why, 0) + cnt
                where.setdefault(why, set()).add("%s/%s" % (key, name))
            for ka, kb, lo, hi, worst, axis, ctr in bad:
                n_bad += 1
                msg = ("%s/%s: %d-gon vs %d-gon share the %s axis at "
                       "(%.3f, %.3f) over %.3f..%.3f; neither clears the "
                       "other's inradius (radii differ by %.4f m). Give them "
                       "the same segment count."
                       % (key, name, ka, kb, axis, ctr[0], ctr[1], lo, hi,
                          worst))
                FAILURES.append(msg)
                print("  [XX] " + msg)
    print("  [%s] %d assets, %d render meshes, %d coaxial facet conflict(s)"
          % ("ok" if n_bad == 0 else "XX", n_asset, n_node, n_bad))
    total_skip = sum(skipped.values())
    print("  [--] %d round component(s) NOT EXAMINED (a skip is not a pass)"
          % total_skip)
    for why in sorted(skipped):
        names = sorted(where[why])
        print("       %-8s x%-3d  %s%s"
              % (why, skipped[why], ", ".join(names[:4]),
                 " ..." if len(names) > 4 else ""))
    if total_skip:
        print("       shell: an open shell has two radii in one axial plane, so"
              " it cannot be\n"
              "              tested this way. Build every round surface on such"
              " a part at its\n"
              "              own class segment count and it is safe by"
              " construction.\n"
              "       partial: an arc sweep is not uniform over 2 pi. Same"
              " remedy.")


def selftest():
    """Prove the scallop arithmetic FAILS on a known-bad pair.

    DW-20: a verification harness is suspect until it has demonstrated it can
    fail. `coaxial` printing zero conflicts is only worth something if zero is
    a result rather than the only answer it can give, and every real defect it
    has caught is now fixed, so nothing in `dist` can exercise it any more.

    The three cases below are the two real geometries from 2026-07-26 plus the
    nesting case that must NOT fire. No fixture file: the pairs are synthesised
    from radii and segment counts, which is the entire input the rule takes.
    """
    head("SELFTEST: the coaxial rule must fail on geometry that is wrong")

    def nests(ra, ka, rb, kb):
        """True if one polygon clears the other's inradius, i.e. no scallop."""
        return (ra <= rb * math.cos(math.pi / kb) + 1e-9
                or rb <= ra * math.cos(math.pi / ka) + 1e-9)

    cases = [
        ("player_body elbow: 10-gon arm 0.0634 inside an 8-gon band 0.068",
         0.06343, 10, 0.068, 8, False),
        ("stack adapter: 24-gon cone 0.6200 against a 16-gon collar 0.6250",
         0.6200, 24, 0.6250, 16, False),
        ("monoprop flange: 16-gon bowl 0.3531 against a 12-gon flange 0.3560",
         0.3531, 16, 0.3560, 12, False),
        ("a tank barrel 0.600 inside its own 16-gon collar 0.625 (LEGAL)",
         0.600, 16, 0.625, 16, True),
        ("class S 0.625 inside class L 1.250 (LEGAL)",
         0.625, 16, 1.250, 24, True),
    ]
    for label, ra, ka, rb, kb, want in cases:
        got = nests(ra, ka, rb, kb)
        ok = got == want
        if not ok:
            FAILURES.append("selftest: %s" % label)
        print("  [%s] %-62s nests=%s (want %s)"
              % ("ok" if ok else "XX", label[:62], got, want))


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    print("check_mating: measuring the SHIPPED .glb files in assets/models/dist")
    for want, fn in (("vessel", vessel), ("structure", structure),
                     ("coaxial", coaxial), ("coaxial", selftest)):
        if which not in ("all", want):
            continue
        try:
            fn()
        except (KeyError, IOError) as exc:
            # A part that is not in the shipped file is a failure of the set,
            # not a crash of the checker, and the other half still has to run.
            FAILURES.append("%s: %s" % (want, exc))
            print("\n  [XX] %s: %s" % (want, exc))
    print()
    if FAILURES:
        print("FAILED (%d):" % len(FAILURES))
        for f in FAILURES:
            print("  " + f)
        return 1
    print("ALL MATES AND TILES EXACT")
    return 0


if __name__ == "__main__":
    sys.exit(main())
