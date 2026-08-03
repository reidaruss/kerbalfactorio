"""CAN THE WALKER GET OFF THE DECK, AND IS THERE A WALL WHEN HE DOES.

    python tools/blender/check_station_deck.py
    python tools/blender/check_station_deck.py --azimuths=720

Reads the SHIPPED bytes. No Blender, no browser, no Playwright, in the shape of
`check_shadow_lod.py` and for the same reason: a loop you can run in a second is
a loop you actually run.

WHY THIS EXISTS, AND IT IS A HOLE THREE GATES LEFT BETWEEN THEM.

  `check-proxies.mjs`      compares the DECLARED name set against the SHIPPED
                           name set, both directions. It is exact and it has
                           nothing at all to say about where the boxes are.
  `validate_glb.py`        counts triangles, materials, sockets and dimensions.
                           Same blindness.
  `probes/stationwalk.js`  walks ONE route, the spine centreline, in a real
                           browser against the real walker. It is the strongest
                           instrument here and it costs a Chromium boot, so it
                           walks one line and not three hundred and sixty.

The station's hall passed all three while being a room a player falls out of in
92.7 per cent of directions, because every one of them was asking a question to
which the answer was yes. The question none of them asked is the one below.

WHAT IT CHECKS. From a point on a deck, march outward along an azimuth. Two
things can happen and exactly one of them is correct:

    a wall stops the walker              CORRECT
    the deck runs out first              HE FALLS, and at this asset that is
                                         400 km of falling

"Stops" is the walker's own predicate as closely as an offline tool can state
it: `KinematicBody` samples three points at 0.15, 0.90 and 1.65 m above the feet
and has NO CAPSULE RADIUS, so a box blocks only if it spans one of those three
heights. That is why `CEIL_PROXY_T` is 0.80 m (R48) and it is why a 0.30 m kerb
is not a wall.

WHAT IT DELIBERATELY DOES NOT DO. It does not model gravity volumes, step-up,
jumping, or the airlock. A green run here is a necessary condition for a room
being enclosed and not a sufficient one for it being playable; `stationwalk.js`
remains the instrument that decides that, and this one exists to stop that
probe's single route from being mistaken for coverage.

KNOWN RED, and it is reported rather than tolerated: see R59 in
docs/controllers/rendering.md. The hall's twelve wall proxies are twelve
IDENTICALLY ORIENTED boxes spaced round a circle, because `of_lib`'s
`add_collision_box` has no `rot_z` and the runtime consumes each proxy as an
axis-aligned bound anyway (`SpaceStation.learnStationProxies`), so a rotated
chord could not survive the trip even if Blender authored one. Only the two
whose tangent happens to be parallel to a world axis came out as walls; the two
at 90 and 270 degrees are radial fins pointing out of the room; the other eight
are oblique slabs. This tool prints that as a number so the fix has a target.
"""

import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

# KinematicBody's three collision samples above the feet, metres. NOT a capsule:
# the walker is a LINE to a structure box, which is the whole reason R48 exists.
SAMPLES = (0.15, 0.90, 1.65)
# A deck proxy is one whose TOP face is the standing plane. The station's decks
# are authored with their tops at local y = 0 exactly (SpaceStation.ts records
# the datum), so the test is on the top face and not on the thickness.
DECK_TOP_EPS = 1e-3


def glb_chunks(path):
    with open(path, "rb") as fh:
        data = fh.read()
    assert data[:4] == b"glTF", path
    off, js = 12, None
    while off < len(data):
        ln, ty = struct.unpack_from("<II", data, off)
        off += 8
        if ty == 0x4E4F534A:
            js = json.loads(data[off:off + ln].decode("utf-8"))
        off += ln
    return js


def proxy_boxes(gltf):
    """Every `col_*` node as an axis-aligned box in the asset's own frame.

    Read the way the CLIENT reads it and not the way Blender wrote it: three
    takes `mesh.geometry.boundingBox` through the node matrix, so a node's
    rotation would be flattened into a bound here too. Any tool that applied
    the rotation properly would be measuring a station the game cannot see.
    """
    out = {}
    for node in gltf.get("nodes", []):
        name = node.get("name", "")
        if not name.startswith("col_") or "mesh" not in node:
            continue
        lo = [1e30] * 3
        hi = [-1e30] * 3
        for prim in gltf["meshes"][node["mesh"]]["primitives"]:
            acc = gltf["accessors"][prim["attributes"]["POSITION"]]
            for i in range(3):
                lo[i] = min(lo[i], acc["min"][i])
                hi[i] = max(hi[i], acc["max"][i])
        t = node.get("translation", [0.0, 0.0, 0.0])
        s = node.get("scale", [1.0, 1.0, 1.0])
        a = [lo[i] * s[i] + t[i] for i in range(3)]
        b = [hi[i] * s[i] + t[i] for i in range(3)]
        out[name] = ([min(a[i], b[i]) for i in range(3)],
                     [max(a[i], b[i]) for i in range(3)])
    return out


def split(boxes):
    decks, solids = {}, {}
    for name, (lo, hi) in boxes.items():
        if abs(hi[1]) < DECK_TOP_EPS:
            decks[name] = (lo, hi)
        else:
            solids[name] = (lo, hi)
    return decks, solids


def march(decks, solids, x0, z0, az_deg, out_m, start_m=0.0, step=0.005):
    """Walk outward from (x0, z0). Return (deck_ran_out_at, wall_stopped_at).

    `start_m` IS NOT A CONVENIENCE AND SKIPPING IT IS AN INSTRUMENT BUG. The
    hall's origin is inside `col_HallCore`, a solid column from the deck to the
    gallery, so a march that begins at r = 0 finds a wall on its first sample at
    every single azimuth and reports a perfectly enclosed room. That is what the
    first version of this tool did, and it printed 0 of 180 against a hall the
    walker measurably falls out of. A gate that cannot fail is worse than no
    gate, so the caller passes the radius that clears the core and the value is
    DERIVED from the core's own box rather than typed.
    """
    a = math.radians(az_deg)
    cx, cz = math.cos(a), math.sin(a)
    r, on_deck, gap, wall = start_m, False, None, None
    while r <= out_m:
        x, z = x0 + cx * r, z0 + cz * r
        for lo, hi in solids.values():
            if lo[0] <= x <= hi[0] and lo[2] <= z <= hi[2]:
                if any(lo[1] < s < hi[1] for s in SAMPLES):
                    wall = r
                    break
        if wall is not None:
            break
        floored = any(lo[0] <= x <= hi[0] and lo[2] <= z <= hi[2]
                      for lo, hi in decks.values())
        if floored:
            on_deck = True
        elif on_deck and gap is None:
            gap = r
        r += step
    return gap, wall


def main(argv):
    n_az = 360
    for a in argv:
        if a.startswith("--azimuths="):
            n_az = int(a.split("=", 1)[1])
    contracts = json.load(open(os.path.join(HERE, "contracts.json"),
                               encoding="utf-8"))
    asset = contracts["assets"]["space_station"]
    path = os.path.join(ROOT, asset["glb"])
    if not os.path.exists(path):
        print("check-station-deck: %s is not built" % asset["glb"])
        return 2
    boxes = proxy_boxes(glb_chunks(path))
    decks, solids = split(boxes)

    print("CHECK STATION DECK: does a wall stop the walker before the deck ends?")
    print("  %d proxies, %d decks, %d solids, %d azimuths, samples at %s m"
          % (len(boxes), len(decks), len(solids), n_az,
             "/".join("%.2f" % s for s in SAMPLES)))
    print("-" * 78)

    # THE SPINE CENTRELINE, which is the one route `stationwalk.js` also walks.
    # Agreeing with it is what makes this tool trustworthy on the routes that
    # probe does NOT walk; disagreeing means one of the two is wrong and this
    # is the cheaper one to debug.
    hall = boxes.get("col_HallFloor")
    spine = boxes.get("col_SpineFwdFloor")
    rc = 0
    if hall is not None and spine is not None:
        x = hall[1][0]
        unfloored = 0.0
        while x <= spine[0][0] + 1e-9:
            if not any(lo[0] <= x <= hi[0] and lo[2] <= 0.0 <= hi[2]
                       for lo, hi in decks.values()):
                unfloored += 0.005
            x += 0.005
        bridging = sorted(k for k, (lo, hi) in decks.items()
                          if lo[0] < spine[0][0] and hi[0] > hall[1][0]
                          and lo[2] < 0.0 < hi[2])
        print("  hall deck ends      x = %+9.4f" % hall[1][0])
        print("  spine deck begins   x = %+9.4f  (a %.4f m slab-edge gap)"
              % (spine[0][0], spine[0][0] - hall[1][0]))
        print("  unfloored on the centreline        %.4f m   %s"
              % (unfloored, "OK" if unfloored < 1e-6 else "*** R57 A HOLE ***"))
        print("  decks bridging it   %s" % (", ".join(bridging) or "NONE"))
        if unfloored >= 1e-6:
            rc = 1
        print()

    # THE HALL, swept. Start clear of `col_HallCore`, which occupies the origin
    # and is a documented fact about this asset rather than a defect: the
    # station's own spawn socket is 4 m out for exactly this reason.
    core = boxes.get("col_HallCore")
    r0 = 0.1 if core is None else math.hypot(core[1][0], core[1][2]) + 0.4
    falls, worst, worst_az = [], 0.0, None
    for i in range(n_az):
        az = i * 360.0 / n_az
        gap, wall = march(decks, solids, 0.0, 0.0, az, 16.0, start_m=r0)
        if gap is not None and (wall is None or gap < wall - 1e-9):
            falls.append(az)
            run = (wall if wall is not None else 16.0) - gap
            if run > worst:
                worst, worst_az = run, az
    pct = 100.0 * len(falls) / n_az
    print("  HALL SWEEP, %d azimuths from the hall centre" % n_az)
    print("    the walker falls off the deck with no wall to stop him:")
    print("      %d of %d azimuths (%.1f%%)   %s"
          % (len(falls), n_az, pct, "OK" if not falls else "*** R59 ***"))
    if falls:
        print("      worst unfloored run %.4f m at azimuth %.1f deg"
              % (worst, worst_az))
        print("      the hall wall ring is twelve IDENTICALLY ORIENTED boxes;")
        print("      only the two whose tangent is axis parallel are walls.")
        rc = 1
    print("-" * 78)
    print("check-station-deck: %s" % ("PASS" if rc == 0 else "FAIL"))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
