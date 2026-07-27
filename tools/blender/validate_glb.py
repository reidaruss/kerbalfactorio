#!/usr/bin/env python3
"""
validate_glb.py - the automated acceptance gate for Orbital Foundry models.

    python tools/blender/validate_glb.py --all
    python tools/blender/validate_glb.py belt_segment

Reads tools/blender/contracts.json (hand-authored, mirrors
docs/web/ASSET-SPECS.md) and checks each exported .glb against it. The contract
is authored INDEPENDENTLY of the build script on purpose: if the checker were
generated from the builder it would only ever prove the builder agrees with
itself.

Stdlib only - no Blender, no npm, no pip. Runs in CI as a plain python3 step.

What it proves, per asset:
  scale      world bounding box of the LOD0 subtree matches the spec in metres
  up axis    ...which is only true if export_yup actually put +Y up
  pivot      LOD0 sits on y = 0 and is centred on x = z = 0 (grid snapping)
  polys      LOD0 triangle budget and whole-file triangle budget
  materials  count within budget and every name is an OF_ palette role
  sockets    every required socket_* node is present
  clips      the animation clip name set matches exactly, and every clip moves
  hygiene    no cameras, no lights, no Draco, collision proxy present
"""

import argparse
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CONTRACTS = os.path.join(HERE, "contracts.json")


# --------------------------------------------------------------------------
# GLB container
# --------------------------------------------------------------------------

def read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) < 12:
        raise ValueError("file is too small to be a GLB")
    magic, version, total = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ValueError("bad magic %r (not a GLB)" % magic)
    if version != 2:
        raise ValueError("glTF version %d, expected 2" % version)
    if total != len(data):
        raise ValueError("header length %d != file length %d" % (total, len(data)))
    off, gltf, binc = 12, None, None
    while off + 8 <= len(data):
        clen, ctype = struct.unpack_from("<I4s", data, off)
        off += 8
        chunk = data[off:off + clen]
        if ctype == b"JSON":
            gltf = json.loads(chunk.decode("utf-8"))
        elif ctype == b"BIN\x00":
            binc = chunk
        off += clen + ((4 - clen % 4) % 4 if clen % 4 else 0)
    if gltf is None:
        raise ValueError("no JSON chunk")
    if binc is None:
        raise ValueError("no BIN chunk (geometry is not embedded)")
    return gltf, binc, len(data)


# --------------------------------------------------------------------------
# Accessor reading. Only needed to prove an animation channel actually moves.
# --------------------------------------------------------------------------

_COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
              5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_accessor(gltf, binc, index):
    a = gltf["accessors"][index]
    if "bufferView" not in a:
        return []
    bv = gltf["bufferViews"][a["bufferView"]]
    fmt, sz = _COMPONENT[a["componentType"]]
    n = _NCOMP[a["type"]]
    base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride") or sz * n
    return [struct.unpack_from("<" + fmt * n, binc, base + k * stride)
            for k in range(a["count"])]


# --------------------------------------------------------------------------
# Minimal 4x4 matrix maths (column-major, as glTF stores it)
# --------------------------------------------------------------------------

IDENT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def mat_mul(a, b):
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4))
    return out


def trs_matrix(node):
    if "matrix" in node:
        return list(node["matrix"])
    t = node.get("translation", [0, 0, 0])
    r = node.get("rotation", [0, 0, 0, 1])
    s = node.get("scale", [1, 1, 1])
    x, y, z, w = r
    rot = [
        1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
        2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
        2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
        0, 0, 0, 1,
    ]
    for c in range(3):
        for r_ in range(3):
            rot[c * 4 + r_] *= s[c]
    rot[12], rot[13], rot[14] = t
    return rot


def xform(m, p):
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]


# --------------------------------------------------------------------------
# Scene walk
# --------------------------------------------------------------------------

def walk(gltf):
    """-> {node_index: (name, world_matrix, parent_index)} for every node."""
    nodes = gltf.get("nodes", [])
    scene = gltf.get("scenes", [{}])[gltf.get("scene", 0)]
    out = {}

    def rec(idx, parent_m, parent_idx):
        n = nodes[idx]
        m = mat_mul(parent_m, trs_matrix(n))
        out[idx] = (n.get("name", "<unnamed>"), m, parent_idx)
        for c in n.get("children", []):
            rec(c, m, idx)

    for rootIdx in scene.get("nodes", []):
        rec(rootIdx, IDENT, None)
    return out


def prim_tris(gltf, prim):
    if prim.get("mode", 4) != 4:
        return 0
    accs = gltf.get("accessors", [])
    if "indices" in prim:
        return accs[prim["indices"]]["count"] // 3
    return accs[prim["attributes"]["POSITION"]]["count"] // 3


def node_bbox(gltf, walked, idx, acc):
    """Accumulate the world-space AABB of node `idx` and its descendants."""
    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    accs = gltf.get("accessors", [])
    n = nodes[idx]
    _, m, _ = walked[idx]
    if "mesh" in n:
        for prim in meshes[n["mesh"]].get("primitives", []):
            a = accs[prim["attributes"]["POSITION"]]
            lo, hi = a.get("min"), a.get("max")
            if not lo or not hi:
                continue
            for i in range(8):
                p = [hi[0] if i & 1 else lo[0],
                     hi[1] if i & 2 else lo[1],
                     hi[2] if i & 4 else lo[2]]
                w = xform(m, p)
                for k in range(3):
                    acc[0][k] = min(acc[0][k], w[k])
                    acc[1][k] = max(acc[1][k], w[k])
    for c in n.get("children", []):
        node_bbox(gltf, walked, c, acc)
    return acc


def subtree_tris(gltf, idx):
    nodes = gltf.get("nodes", [])
    meshes = gltf.get("meshes", [])
    n = nodes[idx]
    t = 0
    if "mesh" in n:
        t += sum(prim_tris(gltf, p) for p in meshes[n["mesh"]]["primitives"])
    for c in n.get("children", []):
        t += subtree_tris(gltf, c)
    return t


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------

class Result:
    def __init__(self, asset):
        self.asset = asset
        self.rows = []

    def check(self, label, ok, detail=""):
        self.rows.append((label, bool(ok), detail))
        return ok

    @property
    def passed(self):
        return all(ok for _, ok, _ in self.rows)

    def dump(self):
        print("\n%s  %s" % ("PASS" if self.passed else "FAIL", self.asset))
        for label, ok, detail in self.rows:
            print("  [%s] %-14s %s" % ("ok" if ok else "XX", label, detail))


def validate(asset, spec, verbose=False):
    r = Result(asset)
    path = os.path.join(ROOT, spec["glb"].replace("/", os.sep))
    if not os.path.isfile(path):
        r.check("file", False, "missing: %s" % spec["glb"])
        return r
    try:
        gltf, binc, nbytes = read_glb(path)
    except Exception as exc:
        r.check("container", False, str(exc))
        return r
    r.check("container", True, "valid GLB2, %d bytes" % nbytes)

    walked = walk(gltf)
    by_name = {}
    for idx, (name, _, _) in walked.items():
        by_name.setdefault(name, idx)

    # --- LOD0 present, and its bounding box == the spec, in metres, Y up ---
    lod0 = spec.get("lod0_node", asset + "_LOD0")
    if lod0 not in by_name:
        r.check("lod0", False, "no node named %s" % lod0)
        return r
    tol = spec.get("tolerance_m", 0.005)
    acc = node_bbox(gltf, walked, by_name[lod0],
                    [[1e9] * 3, [-1e9] * 3])
    lo, hi = acc
    dims = [hi[k] - lo[k] for k in range(3)]
    want = spec["dims_xyz_m"]
    r.check("scale",
            all(abs(dims[k] - want[k]) <= tol for k in range(3)),
            "%s m (want %s, +/-%g)" % ([round(d, 4) for d in dims], want, tol))

    # --- pivot ---
    # Four pivot rules, because the game has four kinds of thing:
    #   ground  a placed object. Base on y = 0, centred on x = z = 0, so grid
    #           snapping is pure arithmetic and there is no per-asset offset.
    #   centre  a dropped item. Origin at the volumetric centre, because items
    #           tumble in the air and ride centred on a belt (ASSET-SPECS 4.11).
    #   grip    a hand-held tool. Origin at the grip point so hand.add(tool)
    #           with an IDENTITY transform puts it in the fist (4.3). Proved by
    #           checking socket_grip actually lands on the origin, which is the
    #           thing that silently breaks if the mesh is nudged.
    #   none    a view model. The first-person arms hang off the camera point,
    #           which is by construction outside the mesh.
    pmode = spec.get("pivot_mode", "ground")
    ptol = spec.get("pivot_tolerance_m", tol)
    cx, cy, cz = ((lo[k] + hi[k]) * 0.5 for k in range(3))
    if pmode == "ground":
        r.check("pivot", abs(lo[1]) <= ptol and abs(cx) <= ptol
                and abs(cz) <= ptol,
                "ground: base y=%.4f centre x=%.4f z=%.4f" % (lo[1], cx, cz))
    elif pmode == "centre":
        r.check("pivot", all(abs(v) <= ptol for v in (cx, cy, cz)),
                "centre: %.4f %.4f %.4f" % (cx, cy, cz))
    elif pmode == "grip":
        gs = spec.get("grip_socket", "socket_grip")
        if gs not in by_name:
            r.check("pivot", False, "grip: no node named %s" % gs)
        else:
            _, gm, _ = walked[by_name[gs]]
            gp = [gm[12], gm[13], gm[14]]
            inside = all(lo[k] - ptol <= 0.0 <= hi[k] + ptol for k in range(3))
            r.check("pivot",
                    all(abs(v) <= ptol for v in gp) and inside,
                    "grip: %s at %s, origin inside LOD0 bounds=%s"
                    % (gs, [round(v, 4) for v in gp], inside))
    elif pmode == "none":
        r.check("pivot", True, "none (view model)")
    else:
        r.check("pivot", False, "unknown pivot_mode %r" % pmode)

    # --- triangle budgets ---
    t0 = subtree_tris(gltf, by_name[lod0])
    r.check("tris_lod0", t0 <= spec["max_tris_lod0"],
            "%d <= %d" % (t0, spec["max_tris_lod0"]))
    # Render budget excludes col_* proxies - they never reach the GPU. They are
    # subtracted rather than skipped at the top level, because a proxy is a
    # CHILD of the asset root (and, on a rigged asset, a child of the armature),
    # so a top-level filter never actually excluded them.
    col = sum(subtree_tris(gltf, i) for i, (n, _, _) in walked.items()
              if n.startswith("col_"))
    render = sum(subtree_tris(gltf, i) for i, (n, _, p) in walked.items()
                 if p is None and not n.startswith("col_")) - col
    r.check("tris_total", render <= spec["max_tris_total"],
            "%d render <= %d (+%d collision)"
            % (render, spec["max_tris_total"], col))
    r.check("tris_col", col <= spec.get("max_tris_collision", 64),
            "%d <= %d" % (col, spec.get("max_tris_collision", 64)))

    # --- LOD chain ---
    lods = spec.get("lod_nodes", [])
    missing = [n for n in lods if n not in by_name]
    r.check("lods", not missing,
            "%d present%s" % (len(lods) - len(missing),
                              "" if not missing else ", missing %s" % missing))

    # --- named parts: an atlas is N independent meshes in one file ---
    # items_atlas.glb has fourteen sibling meshes and no LOD chain, so the
    # single lod0_node check proves almost nothing about it. Each part is
    # checked for existence, its own bounding box, its own tri budget, and its
    # own pivot rule, which is what actually keeps an item legible on a belt
    # and a scatter prop sitting ON the terrain instead of floating over it.
    #
    # A part declares `pivot`: "ground" (base on y = 0, centred on x/z - every
    # Tier-1 scatter prop, so a placement matrix is pure terrain data),
    # "centre" (a dropped item, which tumbles), or "none". The older boolean
    # `centred` still means "centre", so the items atlas is untouched.
    parts = spec.get("parts", [])
    if parts:
        bad = []
        for p in parts:
            node = p["node"]
            if node not in by_name:
                bad.append("%s missing" % node)
                continue
            pacc = node_bbox(gltf, walked, by_name[node], [[1e9] * 3, [-1e9] * 3])
            plo, phi = pacc
            pd = [phi[k] - plo[k] for k in range(3)]
            pw = p["dims_xyz_m"]
            ptl = p.get("tolerance_m", tol)
            if any(abs(pd[k] - pw[k]) > ptl for k in range(3)):
                bad.append("%s dims %s want %s" % (node, [round(d, 4) for d in pd], pw))
            ppiv = p.get("pivot", "centre" if p.get("centred", True) else "none")
            pc = [(plo[k] + phi[k]) * 0.5 for k in range(3)]
            if ppiv == "centre" and any(abs(v) > ptl for v in pc):
                bad.append("%s not centred on its origin" % node)
            elif ppiv == "ground" and (abs(plo[1]) > ptl or abs(pc[0]) > ptl
                                       or abs(pc[2]) > ptl):
                bad.append("%s not ground-pivoted (base y=%.4f x=%.4f z=%.4f)"
                           % (node, plo[1], pc[0], pc[2]))
            elif ppiv not in ("centre", "ground", "none"):
                bad.append("%s unknown pivot %r" % (node, ppiv))
            pt = subtree_tris(gltf, by_name[node])
            if pt > p.get("max_tris", spec["max_tris_lod0"]):
                bad.append("%s %d tris > %d" % (node, pt, p.get("max_tris")))
        r.check("parts", not bad, "%d checked%s"
                % (len(parts), "" if not bad else "; " + "; ".join(bad)))

    # --- per-part sockets: the Tier-2 stack contract, made checkable --------
    # rocket_parts.glb holds thirteen parts and thirteen socket_stack_top
    # nodes, so the flat `sockets` list below proves only that ONE of them
    # exists. What the engine actually binds to is "this part's stack top is
    # at this height on the stack axis", and that is what this checks: the
    # socket must be a DESCENDANT of the named part group, and must land on
    # the declared position in three.js axes. It is the check that would
    # catch a part whose height and whose mating plane silently disagree.
    part_sockets = spec.get("part_sockets", {})
    if part_sockets:
        nodes_j = gltf.get("nodes", [])
        bad = []
        for group, socks in sorted(part_sockets.items()):
            if group not in by_name:
                bad.append("%s missing" % group)
                continue
            found = {}

            def collect(i):
                nm, m, _ = walked[i]
                found.setdefault(nm, m)
                for c in nodes_j[i].get("children", []):
                    collect(c)

            collect(by_name[group])
            for sname in sorted(socks):
                want_p = socks[sname]
                if sname not in found:
                    bad.append("%s: %s is not under it" % (group, sname))
                    continue
                m = found[sname]
                got = [m[12], m[13], m[14]]
                if any(abs(got[k] - want_p[k]) > tol for k in range(3)):
                    bad.append("%s/%s at %s want %s"
                               % (group, sname, [round(v, 4) for v in got],
                                  want_p))
        r.check("part_sockets", not bad, "%d part(s)%s"
                % (len(part_sockets), "" if not bad else "; " + "; ".join(bad)))

    # --- materials: budget + every name is a palette role ---
    mats = [m.get("name", "") for m in gltf.get("materials", [])]
    bad = [m for m in mats if not m.startswith("OF_")]
    r.check("materials",
            len(mats) <= spec["max_materials"] and not bad,
            "%d <= %d %s%s" % (len(mats), spec["max_materials"], mats,
                               "" if not bad else " BAD:%s" % bad))

    # --- sockets ---
    want_sock = spec.get("sockets", [])
    missing = [s for s in want_sock if s not in by_name]
    r.check("sockets", not missing,
            "%d/%d present%s" % (len(want_sock) - len(missing), len(want_sock),
                                 "" if not missing else ", missing %s" % missing))

    # --- animation clips: exact name set ---
    clips = sorted(a.get("name", "") for a in gltf.get("animations", []))
    want_clips = sorted(spec.get("clips", []))
    r.check("clips", clips == want_clips, "%s (want %s)" % (clips, want_clips))

    # --- every clip must actually move something ---
    # glTF stores rotation as a quaternion, so a two-key 0 -> 360 degree euler
    # curve exports as a pair of IDENTICAL quaternions: a spin clip that reads
    # perfectly in Blender and does nothing in three.js. That is invisible in
    # the name check above, so check the sampler outputs.
    dead = []
    for anim in gltf.get("animations", []):
        moved = False
        for ch in anim.get("channels", []):
            samp = anim["samplers"][ch["sampler"]]
            try:
                vals = read_accessor(gltf, binc, samp["output"])
            except Exception:
                vals = []
            if len(vals) < 2:
                continue
            if any(max(v[k] for v in vals) - min(v[k] for v in vals) > 1e-5
                   for k in range(len(vals[0]))):
                moved = True
                break
        if not moved:
            dead.append(anim.get("name", "?"))
    if gltf.get("animations"):
        r.check("anim_live", not dead,
                "%d clip(s) move%s" % (len(gltf["animations"]),
                                       "" if not dead else "; DEAD: %s" % dead))

    # --- every clip starts at t = 0, exactly ---
    # three.js takes a clip's duration from its LAST track time, so a clip
    # whose first key sits at 1/60 s is one frame longer than the motion
    # authored into it and opens with a frame in which nothing moves. On Run
    # that is 0.4167 s of loop against 0.400 s of motion: a 7.5 cm positional
    # snap once per cycle at 4.5 m/s (DW-34; the cause and the fix are in
    # of_lib.clip_frame). The assertion is exact equality with 0.0 and not a
    # tolerance: the exporter writes frame/fps into a float32, so Blender
    # frame 0 is 0.0 with no rounding at all, and any tolerance here is just
    # somewhere for a one-frame offset to hide.
    late = []
    for anim in gltf.get("animations", []):
        for si, samp in enumerate(anim.get("samplers", [])):
            times = read_accessor(gltf, binc, samp["input"])
            if not times:
                continue
            if times[0][0] != 0.0:
                late.append("%s sampler %d first t=%.9g s"
                            % (anim.get("name", "?"), si, times[0][0]))
    if gltf.get("animations"):
        r.check("anim_t0", not late,
                "%d clip(s) start at t=0" % len(gltf["animations"])
                if not late else "; ".join(late[:3]))

    # --- rig: bones, skin weights, bone-parented sockets, bind pose ---
    # A rigged asset can pass every check above and still be broken in ways
    # that are invisible in a static render: a limb with no weights follows
    # nothing, a socket parented to the armature instead of to a bone does not
    # ride the hand, and a character exported mid-pose is permanently mid-pose.
    skins = gltf.get("skins", [])
    joint_idx = set()
    for sk in skins:
        joint_idx.update(sk.get("joints", []))

    want_bones = spec.get("bones", [])
    if want_bones:
        joint_names = {walked[j][0] for j in joint_idx if j in walked}
        missing = [b for b in want_bones if b not in by_name]
        unskinned = [b for b in want_bones
                     if b in by_name and b not in joint_names]
        extra = sorted(joint_names - set(want_bones))
        r.check("bones",
                not missing and not unskinned and not extra,
                "%d joints%s%s%s" % (
                    len(joint_names),
                    "" if not missing else "; MISSING %s" % missing,
                    "" if not unskinned else "; not in skin %s" % unskinned,
                    "" if not extra else "; UNDECLARED %s" % extra))

    if skins:
        # Every vertex of every skinned mesh must have weight. An unweighted
        # vertex is pinned to joint 0 forever, which is the exact failure mode
        # bone-heat automatic weights produces on intersecting geometry, and it
        # renders as a shard of the mesh left behind when the character moves.
        bad = []
        njoints = max(joint_idx) + 1 if joint_idx else 0
        for nidx, n in enumerate(gltf.get("nodes", [])):
            if "mesh" not in n or "skin" not in n:
                continue
            for prim in gltf["meshes"][n["mesh"]].get("primitives", []):
                attrs = prim.get("attributes", {})
                if "WEIGHTS_0" not in attrs or "JOINTS_0" not in attrs:
                    bad.append("%s has no skin attributes" % n.get("name"))
                    continue
                ws = read_accessor(gltf, binc, attrs["WEIGHTS_0"])
                js = read_accessor(gltf, binc, attrs["JOINTS_0"])
                zero = sum(1 for w in ws if sum(w) < 0.999 or sum(w) > 1.001)
                if zero:
                    bad.append("%s: %d/%d vertices without unit weight"
                               % (n.get("name"), zero, len(ws)))
                if any(j >= njoints for jv in js for j in jv):
                    bad.append("%s: joint index out of range" % n.get("name"))
        r.check("skin_weights", not bad,
                "%d skin(s), every vertex weighted" % len(skins)
                if not bad else "; ".join(bad))

    want_bs = spec.get("bone_sockets", {})
    if want_bs:
        parent_of = {}
        for idx, (nm, _, pidx) in walked.items():
            parent_of[nm] = walked[pidx][0] if pidx is not None else None
        bad = ["%s -> %s (want %s)" % (s, parent_of.get(s), bone)
               for s, bone in want_bs.items() if parent_of.get(s) != bone]
        r.check("bone_sockets", not bad, "%d bone-parented%s"
                % (len(want_bs), "" if not bad else "; " + "; ".join(bad)))

    if spec.get("rest_pose"):
        # world(joint) * inverseBindMatrix must be the identity, which says the
        # exported static pose IS the bind pose. This is the rigged form of the
        # frame-1 identity rule: a clip cannot start at the identity when its
        # frame 1 is mid-stride, so instead the ARMATURE is exported at rest and
        # every clip is relative to it.
        worst, where = 0.0, ""
        for sk in skins:
            if "inverseBindMatrices" not in sk:
                continue
            ibms = read_accessor(gltf, binc, sk["inverseBindMatrices"])
            for j, ibm in zip(sk["joints"], ibms):
                m = mat_mul(walked[j][1], list(ibm))
                d = max(abs(m[k] - IDENT[k]) for k in range(16))
                if d > worst:
                    worst, where = d, walked[j][0]
        r.check("rest_pose", worst <= 1e-4,
                "max |world*inverseBind - I| = %.2e%s"
                % (worst, "" if worst <= 1e-4 else " at %s" % where))

    if spec.get("frame1_identity"):
        # ASSET-SPECS 2.7: assigning an Action makes the depsgraph evaluate the
        # object and the exporter bakes THAT into the node TRS, so a clip whose
        # frame 1 is off the identity bakes a permanent offset into the asset.
        # Joints are exempt: their equivalent guarantee is rest_pose above.
        base = {"translation": [0, 0, 0], "rotation": [0, 0, 0, 1],
                "scale": [1, 1, 1]}
        bad = []
        for anim in gltf.get("animations", []):
            for ch in anim.get("channels", []):
                tgt = ch.get("target", {})
                nidx, path = tgt.get("node"), tgt.get("path")
                if nidx is None or nidx in joint_idx or path == "weights":
                    continue
                samp = anim["samplers"][ch["sampler"]]
                vals = read_accessor(gltf, binc, samp["output"])
                if not vals:
                    continue
                node = gltf["nodes"][nidx]
                want = node.get(path, base[path])
                got = vals[0]
                if any(abs(got[k] - want[k]) > 1e-4 for k in range(len(want))):
                    bad.append("%s/%s %s != node %s"
                               % (anim.get("name"), walked[nidx][0],
                                  [round(v, 4) for v in got],
                                  [round(v, 4) for v in want]))
        r.check("frame1_identity", not bad,
                "first key == node TRS"
                if not bad else "; ".join(bad[:3]))

    # --- collision proxy ---
    # One name for a single-asset file; a LIST for a biome atlas, where only
    # the props that are genuinely solid carry a proxy and everything soft or
    # ankle-height is walk-through by design (see props_common.py).
    if spec.get("collision"):
        want_col = spec["collision"]
        if isinstance(want_col, str):
            want_col = [want_col]
        missing = [c for c in want_col if c not in by_name]
        r.check("collision", not missing, "%d/%d present%s"
                % (len(want_col) - len(missing), len(want_col),
                   "" if not missing else ", missing %s" % missing))

    # --- hygiene ---
    exts = set(gltf.get("extensionsUsed", []))
    r.check("hygiene",
            not gltf.get("cameras") and "KHR_lights_punctual" not in exts
            and "KHR_draco_mesh_compression" not in exts,
            "no cameras/lights/draco; ext=%s" % (sorted(exts) or "none"))

    # Backface culling everywhere except the roles that genuinely need two
    # sides (glass, foliage, water). A stray doubleSided doubles fragment cost.
    two_sided = [m.get("name", "") for m in gltf.get("materials", [])
                 if m.get("doubleSided")]
    allowed = set(spec.get("double_sided_ok", []))
    r.check("culling", set(two_sided) <= allowed,
            "doubleSided=%s (allowed %s)" % (two_sided or "none",
                                             sorted(allowed) or "none"))

    if verbose:
        print("  nodes: %s" % sorted(by_name))
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("assets", nargs="*", help="asset keys from contracts.json")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    with open(CONTRACTS, "r", encoding="utf-8") as fh:
        contracts = json.load(fh)["assets"]

    keys = sorted(contracts) if (args.all or not args.assets) else args.assets
    results = []
    for k in keys:
        if k not in contracts:
            print("FAIL  %s  (no contract entry)" % k)
            return 1
        results.append(validate(k, contracts[k], args.verbose))

    for r in results:
        r.dump()
    bad = [r.asset for r in results if not r.passed]
    print("\n%d/%d assets pass." % (len(results) - len(bad), len(results)))
    if bad:
        print("failing: %s" % ", ".join(bad))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
