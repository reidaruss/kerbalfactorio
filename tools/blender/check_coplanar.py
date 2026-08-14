"""
check_coplanar.py - does any asset ship two painted surfaces fighting for the
same pixels?

    python tools/blender/check_coplanar.py                  # every shipped glb
    python tools/blender/check_coplanar.py machines/box.glb # one, or several
    python tools/blender/check_coplanar.py --details machines/box.glb

Exit status is 0 only if every asset is at or under its allowance in ALLOWED
below, so this can be wired into `npm run check` as a gate.

WHY THIS EXISTS. FS-68 rescaled the storage box and, while measuring it,
found that the assembler's painted hazard bands were coplanar with the steel
they are painted on. Two surfaces on one plane give the depth test nothing to
arbitrate with, so the winner is decided by whatever order the rasteriser
happens to visit them in: the paint disappears, or it flickers as the camera
moves, and either way NOTHING IN THE BUILD SAYS SO. The build script is happy,
the exporter is happy, validate_glb.py is happy, and the defect only exists in
the shipped bytes. That is exactly the class of bug this project keeps paying
for, so it gets a checker that reads the bytes.

WHY "SAME-FACING" IS THE COUNT THAT MATTERS, AND THE NAIVE COUNT IS A LIE.
The obvious test is "two coplanar triangles of different materials whose areas
overlap". Run that and the box scores 167 and the assembler 179, which is so
far from actionable that nobody would act on it. Almost all of those pairs are
BACK-TO-BACK CONTACTS: a plinth's top face pointing up with a painted skirt's
bottom face pointing down resting exactly on it. That is not a defect, it is
how you stack two boxes. Every material in the palette except the double-sided
ones is backface-culled (see of_lib.DOUBLE_SIDED), so at most one of those two
triangles is ever rasterised from any given camera, and the one that is
rasterised is the one whose solid the camera is outside of. There is nothing to
arbitrate and nothing flickers.

The pairs that DO fight are the ones whose outward normals point the SAME WAY.
Two front faces on one plane, both facing the camera, both surviving the cull,
both writing the same depth. That is the assembler's hazard band lying on the
plinth's front face, and it is the only geometry the renderer genuinely cannot
resolve. So this tool reports both numbers and gates on the same-facing one.

WHY A SAME-MATERIAL OVERLAP IS NOT COUNTED AT ALL. Two coplanar same-facing
triangles that share a material still z-fight in the depth buffer, but they
shade identically and their normals are equal, so the pixel is the same colour
whichever wins. It is invisible by construction. The roof railings on the
assembler cross at the corners and do exactly this; making that an error would
be noise, and noise is how a checker gets ignored.

WHAT THIS DELIBERATELY DOES NOT DO. The analysis is PER MESH, never across two
meshes of one asset. _LOD0, _LOD1 and _LOD2 are alternatives that are never
drawn together, so a cross-mesh test would report every asset in the set as
broken on the strength of geometry that can never be on screen at once. The
cost of that choice is a blind spot: a sibling object that IS drawn with LOD0
(Smelter_Glow, Assembler_Arm, Box_Lid) could in principle be flush against it
and would not be seen here. Those are hand-placed, few, and animated away from
their rest pose, so the blind spot is accepted and written down rather than
papered over.

IT MEASURES GEOMETRY, NOT VISIBILITY, AND THAT IS ON PURPOSE. A coplanar pair
buried inside a solid, or below z = 0 under the terrain, still counts here. It
could be excluded, but only by deciding that the thing burying it will always
be there, and "the ore boulder is always sunk into the ground" is a claim about
placement that no code enforces and no save file records. The four boulders in
this table are exactly that case. Counting them costs an allowance entry;
excusing them costs the checker its meaning.

Only AXIS-ALIGNED faces are examined. Everything in this game is authored from
world-axis boxes, cylinders and arc bands, so an axis-aligned plane is where
the defect lives; a coplanar pair on some arbitrary slanted plane is possible
but has never been built here, and testing for it means comparing plane
equations with a tolerance rather than bucketing exact coordinates, which is a
much worse checker for a case that does not occur.

Dependency-free stdlib, like web/scripts/check-proxies.mjs and for the same
reason: it has to run in `npm run check` without Blender, without a build step
and without anyone installing anything.
"""

import json
import math
import os
import struct
import sys

# --- tolerances ------------------------------------------------------------
# A face is "axis aligned" if its extent along that axis is under FLAT_EPS.
# Positions are exported as float32, so two vertices authored at the same
# coordinate come back bit-identical and the true extent is exactly 0; 1e-5 m
# (10 microns) is therefore pure slack against float32 rounding of a
# coordinate that was ARITHMETIC rather than literal, e.g. 0.385 - 0.035.
FLAT_EPS = 1e-5
# Two faces are on the same plane if their coordinates differ by under this.
# Same argument. Planes are CLUSTERED at this distance rather than rounded into
# fixed buckets, because a fixed bucket splits two faces that straddle a bucket
# edge and would silently under-report.
PLANE_EPS = 1e-5
# A separating axis has to clear by this much for the triangles to count as
# disjoint. It is what makes an EDGE CONTACT not an overlap: a painted band
# that stops exactly where a plinth strip starts shares a line, not an area,
# and a line has no pixels to fight over. This is the tolerance that decides
# whether "the steel stops short" actually worked, so it is deliberately tight.
SAT_EPS = 1e-6
# A triangle under this area (square metres) is treated as degenerate and
# skipped. mesh.validate() already deletes truly degenerate faces, so this only
# catches slivers, and a sliver cannot hold a visible amount of paint.
AREA_EPS = 1e-9

# --- the allowance table ---------------------------------------------------
# Key is the asset's path under assets/models/dist, without the extension.
# ABSENT MEANS ZERO.
#
# EVERY ENTRY HERE IS A DEBT WITH A NAME ON IT, NOT A LICENCE. The table exists
# so the gate can be turned on TODAY, over a set that is mostly not clean,
# rather than waiting for a 27-asset sweep that would never be scheduled as one
# piece of work. A number that goes up is a regression the gate catches; a
# number that comes down should be edited down here in the same commit, because
# an allowance larger than the measurement is a ratchet that has stopped
# ratcheting.
#
# The four machines at zero are NOT listed, deliberately: assembler, box,
# smelter and miner are held at zero by their absence, so anything that puts a
# coplanar pair back into them fails the build.
#
# BASELINED 2026-07-28 (FS-75) from the shipped bytes. What they mostly are, in
# case the next person to look assumes it is all painted bands:
#   door / wall /   the structure kit. floor's 72 are its deck and its edging
#   floor /         both landing on the tile edge at +/-2.0, which IS visible:
#   foundation      a floor at the lip of a platform shows that side face.
# CLEARED 2026-08-01 (RN-411 to RN-443): the three Tier 2 vessel assets, which
# were 982 pairs between them and 778 of those in rocket_parts alone, the worst
# asset in the game by an order of magnitude. All three are now at 0 and are
# held there by their absence. The attribution is worth reading before anyone
# assumes the next bad asset is painted bands, because none of these were:
#   rocket_parts    778. 704 of them (90.5%) are ONE mistake repeated in
#                   eleven parts: rocket_common.tube caps BOTH ends, and every
#                   stack part is concentric capped tubes SHARING AN END
#                   PLANE, so a barrel's buried bottom disc sat on the collar's
#                   mating face in a different material. Fixed by deleting the
#                   buried cap (`caps=`), which is triangle-negative. The rest:
#                   50 trim solids sized to land flush with a host's end plane,
#                   16 a literally copied width, 8 two solids both started on a
#                   radial part's mount plane.
#   lander_landed   118, ALL of it inherited: the file is assembled out of
#                   rocket_common, so it went to 0 with no edit of its own.
#                   That is the evidence the fix was at the root.
#   launch_pad      86, six causes, the largest being a propellant tank and its
#                   own skirt ring both bottom-capped at DECK_Z because both
#                   were derived from the deck when only one stands on it.
# CLEARED 2026-07-28 (FS-88): the four belt tiles, the structural floor, the
# survival smelter and the primitive furnace all went to 0 and are gone from
# this table, so they are held there. What they turned out to be is written up
# in each build script; none of it was the painted band at the footprint edge
# that FS-75 started from.
#   boulder_*       Rock against RockDark on z = 0, i.e. the undersides of two
#                   lobes on the ground plane. Buried under terrain in practice,
#                   which is a claim about placement that nothing enforces, so
#                   it is counted rather than excused.
#
# RN-1595, RN-1597, RN-1601, RN-1603, RN-1605 CLEARED FIVE ROWS AND ALL FIVE
# HAD ONE CAUSE. `machines/generator: 35`, `machines/inserter: 14`,
# `structures/wall: 40`, `structures/foundation: 20` and `structures/door: 120`
# - 229 pairs, the whole machine-and-structure half of the FS-75 baseline -
# were every one of them a part DIMENSIONED TO END exactly where the part it is
# mounted on ends. A hopper's accent band flush with the hopper face, a status
# lens flush with its own bezel, a mullion running rail-face to rail-face, a
# kerb founded on the stone field's own underside, a door leaf's field cut to
# its own frame's extent. None of them was a paint decision and none needed a
# palette change to fix; in every case the part now runs INTO the thing it
# frames, or is inset from it, which is also what the real assembly does.
#
# The 120 on `structures/door` was the largest entry in this table, and 56 of
# those were on `Door_Leaf`, i.e. on the one part of the structural kit that
# MOVES - so the pixels were not merely undecided, they changed as the door
# swung. That is the case this checker's own header describes and it had been
# baselined rather than fixed for two weeks.
ALLOWED = {
    "nodes/boulder_coal": 26,
    "nodes/boulder_copper": 23,
    "nodes/boulder_iron": 27,
    "nodes/boulder_stone": 34,
    # player/player_body was 10 until RN-642 and is now held at 0, alongside
    # the four clean machines and the three rocket assets. Its two causes were
    # a chest state light flush with the pack face it is mounted on, and a comm
    # fin whose top face was authored to land exactly on the helmet crown so
    # that the declared 1.80 m height stayed crown-driven. The second one is
    # the interesting one: the reasoning that caused the defect was correct
    # about the envelope and simply did not need the surfaces to TOUCH.
    "props/props_beach": 13,
    "props/props_cave": 13,
    "props/props_hills": 12,
    "props/props_ocean": 8,
    "props/props_plains": 7,
}

CTYPE = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2),
         5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
AXES = "XYZ"
# glTF axes after of_lib's export_yup conversion: X right, Y up, Z forward.
# Blender (x, y, z) -> glTF (x, z, -y), which is worth saying out loud because
# a plane reported here at "Y = 0.35" is the Blender build script's z = 0.35.
UV_AXES = {0: (1, 2), 1: (0, 2), 2: (0, 1)}


def repo_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def dist_root():
    return os.path.join(repo_root(), "assets", "models", "dist")


def glb_chunks(path):
    """(gltf json, BIN chunk) from a .glb, or raise naming the file."""
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) < 20 or data[0:4] != b"glTF":
        raise ValueError("%s: not a GLB (bad magic)" % path)
    off, js, binary = 12, None, b""
    while off + 8 <= len(data):
        clen, ctype = struct.unpack_from("<I4s", data, off)
        off += 8
        payload = data[off:off + clen]
        off += clen + ((4 - clen % 4) % 4 if clen % 4 else 0)
        if ctype == b"JSON":
            js = json.loads(payload.decode("utf-8"))
        elif ctype == b"BIN\x00":
            binary = payload
    if js is None:
        raise ValueError("%s: no JSON chunk" % path)
    return js, binary


def read_accessor(gltf, binary, idx):
    """One tuple per element. Honours byteStride, because a strided accessor
    read as tightly packed returns garbage that looks like geometry."""
    acc = gltf["accessors"][idx]
    if "bufferView" not in acc:
        return [(0,) * NCOMP[acc["type"]]] * acc["count"]
    fmt, size = CTYPE[acc["componentType"]]
    n = NCOMP[acc["type"]]
    bv = gltf["bufferViews"][acc["bufferView"]]
    base = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride") or (size * n)
    unpack = struct.Struct("<" + fmt * n).unpack_from
    return [unpack(binary, base + i * stride) for i in range(acc["count"])]


def _tri_overlap_2d(a, b):
    """Separating-axis test in the plane. True only for POSITIVE AREA overlap.

    Both triangles' edges are tried as separating axes. The comparison is
    strict by SAT_EPS, so two triangles that meet exactly along an edge or at a
    point are reported as disjoint: they share no area, so no pixel belongs to
    both, so the depth test is never asked the question."""
    for tri in (a, b):
        for i in range(3):
            p, q = tri[i], tri[(i + 1) % 3]
            nx, ny = -(q[1] - p[1]), q[0] - p[0]
            la = [nx * (v[0] - p[0]) + ny * (v[1] - p[1]) for v in a]
            lb = [nx * (v[0] - p[0]) + ny * (v[1] - p[1]) for v in b]
            if min(la) > max(lb) - SAT_EPS or min(lb) > max(la) - SAT_EPS:
                return False
    return True


def _flat_faces(gltf, binary, mesh):
    """[(material, axis, plane, poly2d, facing)] for every axis-aligned tri.

    `facing` is +1 or -1: the sign of the outward normal along `axis`, taken
    from the winding, because glTF is right-handed with counter-clockwise front
    faces and that is the only thing that decides which of two coplanar
    triangles survives the backface cull."""
    mats = [m.get("name", "material_%d" % i)
            for i, m in enumerate(gltf.get("materials", []))]
    out, skipped = [], 0
    for prim in mesh.get("primitives", []):
        if prim.get("mode", 4) != 4:
            skipped += 1
            continue
        if "indices" not in prim:
            skipped += 1
            continue
        mat = mats[prim["material"]] if "material" in prim else "(none)"
        pos = read_accessor(gltf, binary, prim["attributes"]["POSITION"])
        idx = [i[0] for i in read_accessor(gltf, binary, prim["indices"])]
        for k in range(0, len(idx) - 2, 3):
            p = [pos[idx[k + j]] for j in range(3)]
            for axis in range(3):
                c = (p[0][axis], p[1][axis], p[2][axis])
                if max(c) - min(c) >= FLAT_EPS:
                    continue
                u, v = UV_AXES[axis]
                poly = [(q[u], q[v]) for q in p]
                cross = ((poly[1][0] - poly[0][0]) * (poly[2][1] - poly[0][1])
                         - (poly[2][0] - poly[0][0]) * (poly[1][1] - poly[0][1]))
                if abs(cross) * 0.5 < AREA_EPS:
                    continue
                facing = 1 if cross > 0.0 else -1
                # (u, v) = (X, Z) for the Y axis is a LEFT-handed pair, so the
                # 2D cross product there has the opposite sign to the 3D
                # normal's Y component. Without this flip every horizontal face
                # in the game reports its facing upside down, which does not
                # change the pair COUNT (both members flip together) but does
                # make every printed plane a lie.
                if axis == 1:
                    facing = -facing
                out.append((mat, axis, sum(c) / 3.0, poly, facing))
                break
    return out, skipped


def _cluster(faces):
    """{(axis, plane_index): [face, ...]}, clustering plane coordinates that
    are within PLANE_EPS instead of rounding them into fixed buckets."""
    groups = {}
    for axis in (0, 1, 2):
        on_axis = sorted((f for f in faces if f[1] == axis), key=lambda f: f[2])
        gi, prev = -1, None
        for f in on_axis:
            if prev is None or f[2] - prev > PLANE_EPS:
                gi += 1
            prev = f[2]
            groups.setdefault((axis, gi), []).append(f)
    return groups


def measure_mesh(gltf, binary, mesh):
    """(same_facing, total, {(matA, matB, axis, plane, same): count})."""
    faces, skipped = _flat_faces(gltf, binary, mesh)
    same_n = total_n = 0
    detail = {}
    for group in _cluster(faces).values():
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                if a[0] == b[0]:
                    continue            # same material: invisible, see header
                if not _tri_overlap_2d(a[3], b[3]):
                    continue
                total_n += 1
                same = a[4] == b[4]
                if same:
                    same_n += 1
                key = (min(a[0], b[0]), max(a[0], b[0]), a[1],
                       round((a[2] + b[2]) * 0.5, 4), same)
                detail[key] = detail.get(key, 0) + 1
    return same_n, total_n, detail, skipped


def measure_asset(path):
    gltf, binary = glb_chunks(path)
    rows, same_total, all_total, skipped_total = [], 0, 0, 0
    for mesh in gltf.get("meshes", []):
        same, total, detail, skipped = measure_mesh(gltf, binary, mesh)
        rows.append((mesh.get("name", "?"), same, total, detail))
        same_total += same
        all_total += total
        skipped_total += skipped
    return same_total, all_total, rows, skipped_total


def asset_key(path):
    rel = os.path.relpath(path, dist_root()).replace("\\", "/")
    return rel[:-4] if rel.endswith(".glb") else rel


def find_all():
    out = []
    for base, _dirs, files in os.walk(dist_root()):
        for f in files:
            if f.endswith(".glb"):
                out.append(os.path.join(base, f))
    return sorted(out, key=asset_key)


def resolve(arg):
    """Accept an absolute path, a repo-relative path, or a path under dist."""
    for cand in (arg, os.path.join(repo_root(), arg),
                 os.path.join(dist_root(), arg),
                 os.path.join(dist_root(), arg + ".glb")):
        if os.path.isfile(cand):
            return os.path.abspath(cand)
    raise SystemExit("check_coplanar: no such asset: %s" % arg)


def main(argv):
    details = "--details" in argv or "-d" in argv
    args = [a for a in argv if not a.startswith("-")]
    paths = [resolve(a) for a in args] if args else find_all()

    print("COPLANAR PAINT: overlapping same-facing different-material faces")
    print("-" * 74)
    print("  %-34s %8s %8s   %s" % ("asset", "same", "naive", "allow"))
    failures, worst, examined, skipped_total = [], [], 0, 0
    for path in paths:
        key = asset_key(path)
        same, total, rows, skipped = measure_asset(path)
        examined += 1
        skipped_total += skipped
        allow = ALLOWED.get(key, 0)
        flag = "  <-- OVER" if same > allow else ""
        if same > allow:
            failures.append((key, same, allow))
        if same:
            worst.append((same, key))
        print("  %-34s %8d %8d   %5d%s" % (key, same, total, allow, flag))
        if details:
            for name, s, t, detail in rows:
                if not t:
                    continue
                print("      %-30s %5d same / %5d naive" % (name, s, t))
                for k, c in sorted(detail.items()):
                    print("          %-18s %-18s %s = %-9.4f x%-4d %s"
                          % (k[0], k[1], AXES[k[2]], k[3], c,
                             "SAME-FACING" if k[4] else "back-to-back"))
    print("-" * 74)
    if skipped_total:
        print("  note: %d primitive(s) skipped (non-triangle or non-indexed)"
              % skipped_total)
    if worst:
        worst.sort(reverse=True)
        print("  non-zero: " + ", ".join("%s (%d)" % (k, n)
                                         for n, k in worst))
    else:
        print("  every examined asset is at zero.")
    if failures:
        print("\nFAIL: %d asset(s) over allowance" % len(failures))
        for key, same, allow in failures:
            print("  %-34s %d > %d" % (key, same, allow))
        print("\nA same-facing pair is two front faces of different materials")
        print("on one plane with overlapping area. HALF is a hard edge, so the")
        print("paint cannot move outward: the steel has to stop short, or the")
        print("part it lands on has to not be there (see build_smelter.py's")
        print("notched plinth).")
        return 1
    print("\ncheck-coplanar OK (%d asset(s), 0 over allowance)" % examined)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
