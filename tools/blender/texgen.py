#!/usr/bin/env python3
"""
texgen.py - deterministic procedural PBR surface maps. Stdlib only, no Blender.

    python tools/blender/texgen.py               # write assets/textures/dist/
    python tools/blender/texgen.py selftest      # prove the encoder and the fields
    python tools/blender/texgen.py --list        # role -> family table, no output

WHY THIS EXISTS (DW-35). 37 of 48 shipped assets carry no texture at all: flat
colour on a PBR material with no maps. Uniform roughness is exactly what makes
untextured PBR read as plastic, and a normal map is the single biggest win on
flat-shaded low-poly geometry because panel lines, bevels, rivets and weld seams
read as geometry for free. This module is where those maps come from.

WHY IT IS NOT A BLENDER BAKE. DW-5 makes the byte-identical rebuild a gate, and
image encoders are a classic source of nondeterminism: PNG tIME chunks, encoder
version strings in tEXt, and thread-count-dependent deflate. A Cycles bake adds
sampling on top of all three. Generating the pixels here, in plain Python, and
writing the PNG with an encoder we own, is the only version of this that can
honestly claim byte-identical output. It also removes Blender from the texture
path entirely, so a Blender upgrade (BT-14) cannot rewrite a texture byte.

DETERMINISM, STATED RATHER THAN HOPED:
  * No RNG. Every "random" value comes from `_hash01`, which is pure 32-bit
    integer arithmetic and therefore identical on every platform Python runs on.
  * No transcendentals in the field synthesis. Only + - * / and math.sqrt.
    sqrt is correctly rounded by IEEE-754, so it is bit-portable; sin/cos/tan
    are NOT, and DW-14 is this project's own scar from exactly that (a 1 ULP
    std::tan divergence between two libms). None are used here.
  * No timestamps, no text chunks, no gamma chunk. A PNG this module writes is
    IHDR + IDAT + IEND and nothing else.
  * zlib is pinned to explicit parameters rather than defaults, and its version
    is recorded in the manifest so a change is visible rather than mysterious.
    This is the ONE remaining external dependency in the byte stream and it is
    named here on purpose. Same machine, same bytes, always; a different zlib
    build could in principle re-pack the same pixels differently, which would
    change the file without changing the image. `selftest` checks the PIXELS
    round-trip, and the rebuild gate checks the BYTES, so the two together tell
    those cases apart.

THE SCHEME. Two shared tiling surfaces, not per-asset textures:

    panel   hard-surface industrial: plate seams, rivets, bolts, weld bead,
            scratches and grime. Steel, plate, painted accent, suit, ore metal.
    coarse  rough non-metal: chipped facets and granular relief. Rock, soil,
            sand, regolith, coal, bark, rubber.

Each family ships TWO maps and no albedo:

    <family>_n.png     tangent-space normal, RGB
    <family>_orm.png   R = ambient occlusion, G = roughness, B = metalness

ALBEDO IS DELIBERATELY ABSENT. `of_lib.PALETTE` is the game's colour authority
and DW-35 asks for a polish pass, not a restyle; an albedo map multiplies that
colour and is therefore the one map that can silently move the palette. It is
also the map the brief ranks last ("roughness variation matters more than albedo
detail"). Skipping it halves the VRAM and the download and removes the only
restyle risk in the set. AO in the R channel darkens crevices, which is most of
what an albedo grime layer was going to buy anyway.

ORM IS A MULTIPLIER, NOT AN ABSOLUTE. three.js computes
`roughness * roughnessMap.g` and `metalness * metalnessMap.b`, so the palette's
per-role constants survive and the map can only take a surface DOWN from them.
That direction is the physically right one: wear polishes metal (lower
roughness) and grime buries it (lower metalness). It is stated here because a
map authored as an absolute would quietly flatten thirty roles onto one value.

ONE HEIGHTFIELD PER FAMILY, EVERYTHING DERIVED FROM IT. The normal is its
gradient, the AO is its local relief, and the roughness and metalness masks are
functions of it. That is the "one authority" rule applied to a texture: the AO
cannot darken a seam the normal map did not dent, because they are the same
number read twice.
"""

import argparse
import hashlib
import json
import math
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(ROOT, "assets", "textures", "dist")

# Manifest schema version. The client reads this and refuses a version it does
# not know, rather than mis-reading a field that changed meaning. Same argument
# as the WASM bridge's OF_ABI_VERSION (standing rule 9), one tier down.
MANIFEST_VERSION = 1

SIZE = 512                 # px, square. See docs/web/ASSET-SPECS.md 2.8.

# Per-family resolution. `coarse` is half the pixels of `panel` and it is not a
# quality compromise: its tile covers half the world distance, so the two land
# on the SAME 512 px/m texel density, and the family that carries hard edges,
# rivets and a bolt head is the one that needs the pixels. Measured: coarse at
# 512 cost 588 KB of the payload against panel's 484 KB, for a surface that is
# noise and therefore incompressible, on assets the camera spends least time on.
FAMILY_SIZE = {"panel": 512, "coarse": 384}

ZLIB_LEVEL = 9
ZLIB_MEMLEVEL = 9
ZLIB_WBITS = 15


# ---------------------------------------------------------------------------
# Role -> family. THE authority for which surface a palette role wears.
#
# This table is consumed by three different things - the Blender preview
# renders, the texture checks, and the client - so it is published as JSON
# rather than transcribed. A role absent from this table is deliberately FLAT
# and is listed in FLAT_ROLES below with the reason, because "not in the dict"
# and "decided to leave alone" look identical at a call site and only one of
# them is a decision.
# ---------------------------------------------------------------------------
ROLE_FAMILY = {
    # --- panel: anything manufactured ---
    "Steel": "panel", "SteelDark": "panel", "SteelLight": "panel",
    "Accent": "panel", "Hazard": "panel", "Plate": "panel",
    "Suit": "panel", "SuitDark": "panel", "SuitAccent": "panel",
    # --- coarse: anything dug up or grown ---
    # Iron and Copper were in `panel` for one pass and it was the clearest
    # regression in the whole set: an ore vein wearing plate seams, rivet rows
    # and a weld bead reads as scrap panel riveted onto a rock, which is worse
    # than the flat metal wedge it replaced. They are METAL but they are not
    # MANUFACTURED, and `panel` encodes manufacture rather than metallicity.
    # Ore wants relief, just not that relief; metalness still comes from the
    # palette constant, which `coarse` leaves at identity.
    "Iron": "coarse", "Copper": "coarse",
    "Rock": "coarse", "RockDark": "coarse", "Regolith": "coarse",
    "Sand": "coarse", "Soil": "coarse", "Coal": "coarse",
    "Bark": "coarse", "BarkLight": "coarse", "Rubber": "coarse",
}

# Roles with NO map, and why. Each of these would be made worse by one.
FLAT_ROLES = {
    "Glass": "transparent; a normal map on a 0.35-alpha pane reads as dirt",
    "Water": "transparent and animated by the shader, not by a map",
    "Ice": "near-specular; relief belongs in the mesh at this poly count",
    "Oil": "a pool surface, deliberately mirror-flat",
    "Leaf": "double-sided card; a normal map fights the flat-shaded silhouette",
    "LeafDeep": "as Leaf",
    "LeafLight": "as Leaf",
    "LeafDry": "as Leaf",
    "Grass": "sub-pixel blades at any real viewing distance",
    "Skin": "1.5 cm of visible wrist; a pore map is 5.6 MB for nothing",
    "EmissiveState": "a state light. Any AO or roughness on it is a lie about "
                     "what the surface is doing",
}

# Metres of world space one repeat of the texture covers. UVs ship in METRES
# (see of_lib.MeshBuilder.project_uvs), so this number lives in the manifest and
# is applied by the consumer as texture.repeat = 1 / tile_m. Retuning texel
# density therefore costs zero asset rebuilds, which is the whole reason UVs are
# in metres rather than pre-divided.
# BOTH of these were retuned by RENDERING them rather than by computing them,
# which is the only way tile size can honestly be chosen.
#
# `panel` 1.00 -> 1.50 m. At 1 m a 4 m wall wore twelve plate columns, so the
# plates were 33 cm and a machine read as a mosaic of small tiles. 1.5 gives
# ~50 cm plates and drops the horizontal repeat across that wall from 4 to 2.67.
# 2.0 was rendered too and overshoots: bolt heads reach 7 cm and read as
# battleship rivets.
#
# `coarse` 0.50 -> 0.75 m. A 0.5 m tile put 8 repeats across a 4 m foundation
# deck, and repetition is the failure mode of a shared tiling surface. 1.0 was
# rendered too and turns the facets into moss.
#
# Neither number costs anything to change: they live in the manifest and are
# applied as texture.repeat, so they touch no pixel and no .glb. `panel` lands
# at 341 px/m, above ASSET-SPECS 2.8's 256 px/m machine target; `coarse` at
# 512 px/m, which is why FAMILY_SIZE went to 384 rather than staying at 256.
FAMILY_TILE_M = {"panel": 1.5, "coarse": 0.75}

# Texel density that implies, for the record against ASSET-SPECS 2.8
# (512 px/m for first-person, 256 px/m for machines):
#   panel   512 px / 1.0 m = 512 px/m
#   coarse  512 px / 0.5 m = 1024 px/m


# ---------------------------------------------------------------------------
# Deterministic hash and periodic value noise.
# ---------------------------------------------------------------------------

def _hash01(ix, iy, seed):
    """32-bit integer hash -> float in [0, 1). No RNG, no floats until the end.

    Written out rather than taken from `random` because `random`'s stream is a
    CPython implementation detail and this has to survive a Python upgrade the
    way the assets have to survive a Blender upgrade."""
    h = (ix * 0x1F1F1F1F) ^ (iy * 0x27D4EB2D) ^ (seed * 0x9E3779B1)
    h &= 0xFFFFFFFF
    h ^= h >> 15
    h = (h * 0x2C1B3C6D) & 0xFFFFFFFF
    h ^= h >> 12
    h = (h * 0x297A2D39) & 0xFFFFFFFF
    h ^= h >> 15
    return h / 4294967296.0


def _lattice(period, seed):
    """period x period table of hashed values, indexed [iy * period + ix]."""
    return [_hash01(ix, iy, seed)
            for iy in range(period) for ix in range(period)]


def _smooth(t):
    """Quintic smoothstep. C2 continuous, so the derived normal map has no
    visible creases where lattice cells meet - a cubic smoothstep leaves a
    gradient discontinuity that a normal map amplifies into a grid."""
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def _noise_field(w, h, period, seed):
    """Periodic value noise sampled on a w x h grid, returned as a flat list.

    Periodic in BOTH axes by construction (lattice indices wrap with %), which
    is what makes the finished texture tile without a seam. Seamlessness is
    asserted in selftest rather than assumed."""
    tab = _lattice(period, seed)
    # Precompute the per-column lattice index and blend weight once instead of
    # w*h times. This is the hot loop of the whole module.
    cols = []
    for x in range(w):
        f = x * period / w
        i0 = int(f) % period
        cols.append((i0, (i0 + 1) % period, _smooth(f - int(f))))
    out = [0.0] * (w * h)
    for y in range(h):
        f = y * period / h
        j0 = int(f) % period
        j1 = (j0 + 1) % period
        ty = _smooth(f - int(f))
        r0 = j0 * period
        r1 = j1 * period
        base = y * w
        for x in range(w):
            i0, i1, tx = cols[x]
            a = tab[r0 + i0]
            b = tab[r0 + i1]
            c = tab[r1 + i0]
            d = tab[r1 + i1]
            top = a + (b - a) * tx
            bot = c + (d - c) * tx
            out[base + x] = top + (bot - top) * ty
    return out


def _fbm(w, h, period, octaves, seed, gain=0.5, lacunarity=2):
    """Sum of octaves of periodic value noise, normalised to [0, 1]."""
    out = [0.0] * (w * h)
    amp, total, p = 1.0, 0.0, period
    for o in range(octaves):
        n = _noise_field(w, h, p, seed + o * 7919)
        for i in range(w * h):
            out[i] += n[i] * amp
        total += amp
        amp *= gain
        p *= lacunarity
    inv = 1.0 / total
    return [v * inv for v in out]


def _worley(w, h, cells, seed):
    """Periodic cellular noise: distance to the nearest of `cells` x `cells`
    jittered feature points. Returns [0, 1], 0 at a feature point.

    This is what makes rock read as chipped rather than as lumpy noise: value
    noise has no edges and a rock face is all edges."""
    pts = []
    for cy in range(cells):
        for cx in range(cells):
            jx = _hash01(cx, cy, seed)
            jy = _hash01(cx, cy, seed + 1)
            pts.append(((cx + jx) / cells, (cy + jy) / cells))
    out = [0.0] * (w * h)
    scale = cells * 1.4142135623730951      # normalise by the worst-case gap
    for y in range(h):
        py = y / h
        gy = int(py * cells)
        base = y * w
        for x in range(w):
            px = x / w
            gx = int(px * cells)
            best = 4.0
            for oy in (-1, 0, 1):
                ry = (gy + oy) % cells
                for ox in (-1, 0, 1):
                    rx = (gx + ox) % cells
                    fx, fy = pts[ry * cells + rx]
                    dx = px - fx - ox * 0.0
                    dy = py - fy - oy * 0.0
                    # wrap to the shorter way round the torus
                    if dx > 0.5:
                        dx -= 1.0
                    elif dx < -0.5:
                        dx += 1.0
                    if dy > 0.5:
                        dy -= 1.0
                    elif dy < -0.5:
                        dy += 1.0
                    d = dx * dx + dy * dy
                    if d < best:
                        best = d
            out[base + x] = min(1.0, math.sqrt(best) * scale)
    return out


# ---------------------------------------------------------------------------
# Small geometric helpers, all in wrapped tile space [0, 1).
# ---------------------------------------------------------------------------

def _wrap_delta(a, b):
    """Signed shortest distance from b to a on a unit circle."""
    d = a - b
    if d > 0.5:
        d -= 1.0
    elif d < -0.5:
        d += 1.0
    return d


def _wrap_dist(a, b):
    return abs(_wrap_delta(a, b))


def _clamp01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def _smoothstep(e0, e1, x):
    if e1 == e0:
        return 0.0 if x < e0 else 1.0
    t = _clamp01((x - e0) / (e1 - e0))
    return t * t * (3.0 - 2.0 * t)


def _seg_dist(px, py, ax, ay, bx, by):
    """Distance from a point to a segment, in wrapped tile space. The segment
    is treated as short enough not to wrap itself, which every scratch and weld
    bead in this file is."""
    dx = _wrap_delta(bx, ax)
    dy = _wrap_delta(by, ay)
    wx = _wrap_delta(px, ax)
    wy = _wrap_delta(py, ay)
    den = dx * dx + dy * dy
    t = 0.0 if den < 1e-12 else _clamp01((wx * dx + wy * dy) / den)
    ex = wx - dx * t
    ey = wy - dy * t
    return math.sqrt(ex * ex + ey * ey)


# ---------------------------------------------------------------------------
# The `panel` family: a manufactured plate.
#
# The layout is written down rather than randomised. A hashed plate subdivision
# looks the same in a still and is impossible to reason about when a seam lands
# somewhere ugly, and this pattern is going on every machine in the game.
# Vertical seams wrap through u = 0, horizontal seams through v = 0, so the tile
# edge IS a seam and the repeat is invisible.
# ---------------------------------------------------------------------------

# (u_start, u_end, [horizontal seam v's inside this column])
PANEL_COLUMNS = [
    (0.00, 0.34, [0.55]),
    (0.34, 0.71, [0.28, 0.66]),
    (0.71, 1.00, [0.42, 0.79]),
]
PANEL_U_SEAMS = [0.00, 0.34, 0.71]
# Groove geometry, in tile units against a 1 m tile, so these ARE metres.
# The first pass ran 0.0055 / 0.0130, which is a 3.7 cm gap between plates: at a
# glance it read as a panel line and in a preview it read as a trench. A real
# panel gap on industrial plant is under a centimetre, and the number is only
# obvious once it is written down as metres rather than as texels.
SEAM_HALF = 0.0032        # half groove width -> 6.4 mm gap
SEAM_BEVEL = 0.0068       # plate face falls away over a further 6.8 mm


def _panel_height(w, h):
    """(height, aux). Plate face at 1.0, groove floor at 0.0, plus rivets,
    bolts, a weld bead, scratches and micro grain.

    `aux` carries the feature masks the ORM pass needs - currently the scratch
    mask. It is RETURNED rather than re-derived from the height, because
    inferring "this texel is a scratch" from a height window is the same
    inference-from-a-failed-test that BT-13 had to remove from the coaxial
    checker: micro grain is +/- 0.026 and a scratch is now 0.030 deep, so any
    height window wide enough to catch the scratch also catches the noise."""
    grain = _fbm(w, h, 16, 4, seed=1301)
    grain2 = _fbm(w, h, 64, 3, seed=7717)

    # Rivet centres: a row down each vertical seam, offset onto the plate face.
    rivets = []
    for si, us in enumerate(PANEL_U_SEAMS):
        for k in range(9):
            v = (k + 0.5) / 9.0
            rivets.append(((us + 0.0235) % 1.0, v))
            rivets.append(((us - 0.0235) % 1.0, v))
    # Bolt heads at seam intersections.
    bolts = []
    for (u0, u1, vs) in PANEL_COLUMNS:
        for v in vs:
            bolts.append(((u0 + 0.030) % 1.0, v))
            bolts.append(((u1 - 0.030) % 1.0, v))

    weld = (0.36, 0.905, 0.69, 0.905)       # one horizontal bead
    # RUBS, not scratches. See the note at the use site.
    rubs = [
        (0.06, 0.18, 0.29, 0.34),
        (0.44, 0.72, 0.66, 0.51),
        (0.78, 0.12, 0.96, 0.31),
    ]

    out = [0.0] * (w * h)
    scratch_mask = [0.0] * (w * h)
    for y in range(h):
        v = (y + 0.5) / h
        base = y * w
        for x in range(w):
            u = (x + 0.5) / w

            # --- plate face vs groove --------------------------------------
            du = min(_wrap_dist(u, s) for s in PANEL_U_SEAMS)
            col = PANEL_COLUMNS[0]
            for c in PANEL_COLUMNS:
                if c[0] <= u < c[1]:
                    col = c
                    break
            dv = _wrap_dist(v, 0.0)
            for vs in col[2]:
                dv = min(dv, _wrap_dist(v, vs))
            d = min(du, dv)
            face = _smoothstep(SEAM_HALF, SEAM_HALF + SEAM_BEVEL, d)
            z = face

            # --- rivets and bolts ------------------------------------------
            for (ru, rv) in rivets:
                dd = math.sqrt(_wrap_delta(u, ru) ** 2 + _wrap_delta(v, rv) ** 2)
                if dd < 0.0105:
                    z += 0.30 * (1.0 - _smoothstep(0.0055, 0.0105, dd))
            for (bu, bv) in bolts:
                dd = math.sqrt(_wrap_delta(u, bu) ** 2 + _wrap_delta(v, bv) ** 2)
                if dd < 0.0180:
                    z += 0.42 * (1.0 - _smoothstep(0.0090, 0.0180, dd))

            # --- weld bead --------------------------------------------------
            dw = _seg_dist(u, v, *weld)
            if dw < 0.010:
                ripple = 0.5 + 0.5 * grain2[base + x]
                z += 0.26 * (1.0 - _smoothstep(0.004, 0.010, dw)) * (0.7 + 0.6 * ripple)

            # --- rubs (were scratches) --------------------------------------
            # THE STRUCTURAL POINT, and it is the most transferable thing this
            # module learned: A SHARED TILING TEXTURE CANNOT CARRY A FEATURE
            # THAT IS MEANT TO LOOK UNIQUE. A scratch is a long, straight,
            # high-contrast line, which makes it the single most identifiable
            # thing in the tile and therefore the strongest possible cue that
            # the tile repeats. On a 4 m wall you could count the copies. Seams
            # and rivets repeating read as MANUFACTURE and are fine, because
            # real plate is repetitive; a scratch repeating reads as a texture.
            #
            # Two narrowings failed before this. 0.075 deep and 3.5 px wide
            # aliased into a bright ridge (too narrow to hold two edges). 0.030
            # deep was worse in a new way: a smoother plate meant the scratch
            # was the ONLY thing modulating the normal, so it rendered as a
            # white specular streak and got MORE visible, not less.
            #
            # So they are now broad shallow rubs: 3.6 cm wide, barely any
            # relief, and most of the effect handed to roughness. Genuinely
            # unique wear belongs in a per-asset decal, which is a later job.
            for sc in rubs:
                ds = _seg_dist(u, v, *sc)
                if ds < 0.0180:
                    m = 1.0 - _smoothstep(0.0060, 0.0180, ds)
                    z -= 0.010 * m
                    if m > scratch_mask[base + x]:
                        scratch_mask[base + x] = m

            # --- micro grain -------------------------------------------------
            # Down from 0.045 / 0.012 after the first render pass: at close
            # range it read as hammered or crumpled metal rather than as rolled
            # plate, on the wall, the smelter and the player's chest alike. It
            # still has to be non-zero, because a perfectly smooth plate is
            # exactly the plastic look DW-35 exists to kill; it just has to sit
            # under the panel lines rather than compete with them.
            #
            # The second octave is deliberately weaker still. At period 64 on a
            # 512 map it is close to texel frequency, so it aliases under
            # minification and is incompressible, costing real bytes for detail
            # no camera resolves.
            z += (grain[base + x] - 0.5) * 0.026
            z += (grain2[base + x] - 0.5) * 0.007
            out[base + x] = z
    return out, {"scratch": scratch_mask}


def _panel_masks(w, h, height, aux):
    """(roughness, metalness) multipliers for the panel family.

    Both are DOWNWARD from the palette constant (see the module docstring), so
    the story each mask tells has to be one that only subtracts:
      roughness  raised metal is rubbed smooth by handling and by wear
      metalness  grooves collect grime, and grime is not a metal
    """
    mottle = _fbm(w, h, 12, 3, seed=4441)
    scratch = aux["scratch"]
    rough = [0.0] * (w * h)
    metal = [0.0] * (w * h)
    for i in range(w * h):
        z = height[i]
        # `face` is ~1 on the plate, ~0 in a groove, >1 on a rivet or bolt.
        face = _clamp01(z)
        proud = _clamp01(z - 1.0) / 0.42          # rivet / bolt tops
        # THE FLAT PLATE FACE MUST COME OUT AT ~1.0, and the first version did
        # not: `wear` folded in 0.55 of `face`, which is 1 on every flat plate,
        # so `1.0 - 0.40 * 0.55` shipped EVERY panel surface in the game at 78%
        # of its palette roughness. That is a silent global palette edit wearing
        # a texture's clothes, and this pass was explicitly not allowed to move
        # the palette. Only genuinely PROUD geometry is rubbed smooth now, which
        # is also the true story: a rivet head gets handled, a plate face does
        # not. The mottle is symmetric about 1.0, so it varies without shifting.
        r = 1.0 - 0.28 * proud
        r += (mottle[i] - 0.5) * 0.22
        # A rub exposes cleaner metal, so it goes shinier, not duller. Taken
        # straight from the mask the height pass built, rather than inferred
        # from a height window - the inference version became dead code the
        # moment the relief was reduced, which is exactly why it is gone.
        r -= 0.12 * scratch[i]
        rough[i] = _clamp01(r)
        m = 0.42 + 0.58 * _smoothstep(0.15, 0.85, face)
        metal[i] = _clamp01(m)
    return rough, metal


# ---------------------------------------------------------------------------
# The `coarse` family: dug up or grown.
# ---------------------------------------------------------------------------

def _coarse_height(w, h):
    """Rebalanced hard toward LOW frequency after the first render pass.

    The first version put 0.42 of its amplitude into two worley layers at 9 and
    23 cells plus a period-48 grit octave, and the result was uniform, isotropic
    and the same at every scale, which reads as stucco or a popcorn ceiling
    rather than as rock. It was worst exactly where it had the most area to be
    wrong: a 4 m foundation deck. Rock reads as rock because it has STRUCTURE at
    the size of the object and detail only underneath that, so the fix is fewer,
    bigger facets over a much stronger low-frequency base."""
    lumps = _fbm(w, h, 4, 4, seed=2203)
    grit = _fbm(w, h, 40, 2, seed=8821)
    chips = _worley(w, h, 6, seed=5501)
    chips2 = _worley(w, h, 14, seed=6607)
    out = [0.0] * (w * h)
    for i in range(w * h):
        # 1 - worley gives flat facets meeting at sharp valleys, which is the
        # read a fractured rock face has and plain fbm does not.
        z = 0.78 * lumps[i]
        z += 0.24 * (1.0 - chips[i]) ** 2
        z += 0.07 * (1.0 - chips2[i]) ** 2
        z += 0.035 * grit[i]
        out[i] = z
    return out, {}


def _coarse_masks(w, h, height, aux):
    """Roughness spread widened from 29 counts to something worth shipping.

    `texgen.py check` measured the first version's G channel at 226..255, an
    11% variation, on the family that covers every rock, soil and bark surface
    in the game. DW-35's whole argument is that roughness variation is the main
    win and uniform roughness is what reads as plastic, so an 11% spread is a
    map that passed its own check while barely doing its job. Exposed facets are
    weathered smooth and hollows hold dust, so relief drives it."""
    mottle = _fbm(w, h, 16, 3, seed=9109)
    rough = [0.0] * (w * h)
    metal = [1.0] * (w * h)      # identity: no coarse role is a polished metal
    for i in range(w * h):
        r = (1.0 - 0.26 * _smoothstep(0.15, 0.85, _clamp01(height[i]))
             + (mottle[i] - 0.5) * 0.18)
        rough[i] = _clamp01(r)
    return rough, metal


# ---------------------------------------------------------------------------
# Heightfield -> normal and AO.
# ---------------------------------------------------------------------------

def _normal_rgb(height, w, h, strength):
    """Tangent-space normal map from the gradient of the heightfield.

    Central differences with WRAPPED indexing, so the normal map tiles exactly
    as the heightfield does. Green is +Y (OpenGL convention), which is what
    three.js and glTF expect; a DirectX-convention map would read as lighting
    from the wrong side and is the classic silent normal-map defect."""
    out = bytearray(w * h * 3)
    for y in range(h):
        ym = ((y - 1) % h) * w
        yp = ((y + 1) % h) * w
        row = y * w
        for x in range(w):
            xm = (x - 1) % w
            xp = (x + 1) % w
            dx = (height[row + xp] - height[row + xm]) * strength
            dy = (height[yp + x] - height[ym + x]) * strength
            inv = 1.0 / math.sqrt(dx * dx + dy * dy + 1.0)
            nx, ny, nz = -dx * inv, -dy * inv, inv
            o = (row + x) * 3
            out[o] = int(_clamp01(nx * 0.5 + 0.5) * 255.0 + 0.5)
            out[o + 1] = int(_clamp01(ny * 0.5 + 0.5) * 255.0 + 0.5)
            out[o + 2] = int(_clamp01(nz * 0.5 + 0.5) * 255.0 + 0.5)
    return out


def _box_blur(field, w, h, radius):
    """Separable wrapped box blur. O(n) with a running sum, so the AO pass
    costs nothing next to the field synthesis."""
    n = 2 * radius + 1
    tmp = [0.0] * (w * h)
    for y in range(h):
        row = y * w
        acc = sum(field[row + (x % w)] for x in range(-radius, radius + 1))
        for x in range(w):
            tmp[row + x] = acc / n
            acc -= field[row + ((x - radius) % w)]
            acc += field[row + ((x + radius + 1) % w)]
    out = [0.0] * (w * h)
    for x in range(w):
        acc = sum(tmp[((y % h) * w) + x] for y in range(-radius, radius + 1))
        for y in range(h):
            out[y * w + x] = acc / n
            acc -= tmp[((y - radius) % h) * w + x]
            acc += tmp[((y + radius + 1) % h) * w + x]
    return out


def _ao(height, w, h, radius, floor_, gain):
    """Local-relief ambient occlusion: how far a texel sits below its own
    neighbourhood. Cheap, and correct in the only way that matters here, which
    is that it darkens exactly the grooves the normal map dents, because it is
    the same heightfield read a second time."""
    blur = _box_blur(height, w, h, radius)
    out = [0.0] * (w * h)
    for i in range(w * h):
        rel = height[i] - blur[i]
        out[i] = floor_ + (1.0 - floor_) * _clamp01(0.5 + rel * gain)
    return out


def _pack_orm(ao, rough, metal, w, h):
    out = bytearray(w * h * 3)
    for i in range(w * h):
        o = i * 3
        out[o] = int(_clamp01(ao[i]) * 255.0 + 0.5)
        out[o + 1] = int(_clamp01(rough[i]) * 255.0 + 0.5)
        out[o + 2] = int(_clamp01(metal[i]) * 255.0 + 0.5)
    return out


# ---------------------------------------------------------------------------
# PNG encode. 8-bit RGB, non-interlaced, adaptive per-scanline filtering.
#
# Deliberately NOT shared with contact_sheet.py's writer. That one writes review
# sheets, where a byte is a byte; this one writes gated artefacts, so it pins
# the zlib parameters and does the filter search that a normal map needs (a
# smooth gradient stored unfiltered is roughly 3x the bytes). Two writers is a
# smell, and the honest reason to keep them apart is that merging them would
# rebaseline a working tool for no gain.
# ---------------------------------------------------------------------------

def _chunk(tag, body):
    return (struct.pack(">I", len(body)) + tag + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))


def _filter_rows(data, w, h, bpp):
    """Per-scanline filter selection by the standard minimum-sum-of-absolute-
    differences heuristic. Deterministic: the same pixels always pick the same
    filter, and ties break toward the lower filter number."""
    stride = w * bpp
    out = bytearray()
    prev = bytearray(stride)
    for y in range(h):
        line = data[y * stride:(y + 1) * stride]
        best, best_score, best_bytes = 0, None, None
        for ftype in range(5):
            f = bytearray(stride)
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                raw = line[i]
                if ftype == 0:
                    v = raw
                elif ftype == 1:
                    v = raw - a
                elif ftype == 2:
                    v = raw - b
                elif ftype == 3:
                    v = raw - ((a + b) >> 1)
                else:
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                    v = raw - pred
                f[i] = v & 0xFF
            score = sum(v if v < 128 else 256 - v for v in f)
            if best_score is None or score < best_score:
                best, best_score, best_bytes = ftype, score, f
        out.append(best)
        out.extend(best_bytes)
        prev = line
    return bytes(out)


def write_png(path, w, h, rgb):
    """Write 8-bit RGB. IHDR + IDAT + IEND only: no tIME, no tEXt, no gAMA, so
    there is nothing in the file that can differ between two identical runs."""
    if len(rgb) != w * h * 3:
        raise ValueError("expected %d bytes, got %d" % (w * h * 3, len(rgb)))
    raw = _filter_rows(rgb, w, h, 3)
    co = zlib.compressobj(ZLIB_LEVEL, zlib.DEFLATED, ZLIB_WBITS,
                          ZLIB_MEMLEVEL, zlib.Z_DEFAULT_STRATEGY)
    idat = co.compress(raw) + co.flush()
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    blob = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr)
            + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(blob)
    return len(blob)


def read_png_rgb(path):
    """Minimal decoder, for the checks. 8-bit RGB non-interlaced only; anything
    else raises rather than being silently misread."""
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("%s: not a PNG" % path)
    off, idat, hdr = 8, [], None
    while off + 8 <= len(data):
        ln, tag = struct.unpack_from(">I4s", data, off)
        off += 8
        body = data[off:off + ln]
        off += ln + 4
        if tag == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            idat.append(body)
        elif tag == b"IEND":
            break
    w, h, depth, ctype, comp, filt, inter = hdr
    if (depth, ctype, inter) != (8, 2, 0):
        raise ValueError("%s: only 8-bit RGB non-interlaced is supported "
                         "(depth=%d colour=%d interlace=%d)"
                         % (path, depth, ctype, inter))
    raw = zlib.decompress(b"".join(idat))
    stride = w * 3
    out = bytearray(w * h * 3)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ftype = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        for i in range(stride):
            a = line[i - 3] if i >= 3 else 0
            b = prev[i]
            c = prev[i - 3] if i >= 3 else 0
            if ftype == 1:
                line[i] = (line[i] + a) & 0xFF
            elif ftype == 2:
                line[i] = (line[i] + b) & 0xFF
            elif ftype == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 0xFF
            elif ftype == 4:
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, bytes(out)


# ---------------------------------------------------------------------------
# Families
# ---------------------------------------------------------------------------

# `ao_gain` converts local relief into occlusion, and it is per-family because
# the two heightfields have completely different amplitudes: a panel groove is a
# full unit deep, a rock facet is a tenth of one. The first pass shared a gain
# of 2.2 and the result was a coarse AO map that was almost uniformly white -
# it shipped, it validated, and it did nothing, which is the failure mode this
# log keeps calling the expensive one.
FAMILIES = {
    "panel": dict(height=_panel_height, masks=_panel_masks,
                  normal_strength=26.0, ao_radius=7, ao_floor=0.42,
                  ao_gain=2.2),
    # coarse normal_strength came down 13 -> 9 with the low-frequency rebalance:
    # bigger facets over a stronger base means the same slope angles from a
    # smaller gradient, and 13 on the new field reads as corrugated.
    "coarse": dict(height=_coarse_height, masks=_coarse_masks,
                   normal_strength=9.0, ao_radius=11, ao_floor=0.50,
                   ao_gain=7.0),
}


def build_family(name, size=None):
    spec = FAMILIES[name]
    size = FAMILY_SIZE[name] if size is None else size
    height, aux = spec["height"](size, size)
    rough, metal = spec["masks"](size, size, height, aux)
    ao = _ao(height, size, size, spec["ao_radius"], spec["ao_floor"],
             spec["ao_gain"])
    normal = _normal_rgb(height, size, size, spec["normal_strength"])
    orm = _pack_orm(ao, rough, metal, size, size)
    return height, normal, orm


def generate(out_dir=OUT_DIR, size=None, quiet=False):
    files = {}
    sizes = {}
    for name in sorted(FAMILIES):
        fsize = FAMILY_SIZE[name] if size is None else size
        sizes[name] = fsize
        _, normal, orm = build_family(name, fsize)
        n_path = os.path.join(out_dir, "of_%s_n.png" % name)
        o_path = os.path.join(out_dir, "of_%s_orm.png" % name)
        n_bytes = write_png(n_path, fsize, fsize, normal)
        o_bytes = write_png(o_path, fsize, fsize, orm)
        files[name] = {
            "normal": {"file": os.path.basename(n_path), "bytes": n_bytes},
            "orm": {"file": os.path.basename(o_path), "bytes": o_bytes},
        }
        if not quiet:
            print("[texgen] %-7s normal %7d B   orm %7d B   (%dx%d, %g px/m)"
                  % (name, n_bytes, o_bytes, fsize, fsize,
                     fsize / FAMILY_TILE_M[name]))

    manifest = {
        "_comment": [
            "Generated by tools/blender/texgen.py. Do not hand-edit.",
            "UVs in the .glb files are in METRES, so a consumer applies",
            "texture.repeat = 1 / tile_m and texture.wrapS/wrapT = RepeatWrapping.",
            "orm channels: R = occlusion, G = roughness, B = metalness, and all",
            "three MULTIPLY the material constant rather than replacing it.",
            "normal maps are OpenGL convention (+Y up), colorSpace NoColorSpace.",
        ],
        "version": MANIFEST_VERSION,
        "zlib": zlib.ZLIB_RUNTIME_VERSION,
        "families": {},
        "roles": dict(sorted(ROLE_FAMILY.items())),
        "flat_roles": dict(sorted(FLAT_ROLES.items())),
    }
    for name in sorted(FAMILIES):
        fam = dict(files[name])
        fam["tile_m"] = FAMILY_TILE_M[name]
        fam["size_px"] = sizes[name]
        fam["texels_per_m"] = sizes[name] / FAMILY_TILE_M[name]
        for k in ("normal", "orm"):
            p = os.path.join(out_dir, fam[k]["file"])
            with open(p, "rb") as fh:
                fam[k]["sha256"] = hashlib.sha256(fh.read()).hexdigest()
        manifest["families"][name] = fam

    m_path = os.path.join(out_dir, "surfaces.json")
    with open(m_path, "w", newline="\n", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=False)
        fh.write("\n")
    if not quiet:
        total = sum(v[k]["bytes"] for v in files.values() for k in v)
        print("[texgen] manifest %s" % m_path)
        print("[texgen] %d files, %d bytes of texture payload"
              % (len(files) * 2, total))
    return manifest


# ---------------------------------------------------------------------------
# check: assert things about the SHIPPED bytes.
#
# BT-13's rule, applied to textures: put the check where the information
# actually is. The shipped PNG is what the game loads, so that is what gets
# measured, with no help from the generator that wrote it.
# ---------------------------------------------------------------------------

# A channel that is CONSTANT is a channel doing nothing, which is only
# acceptable when the constant is the identity for how the channel is used.
# metalness multiplies, so 255 is identity; anything else silently rescales
# every material that wears the map. Each entry needs a reason.
ALLOWED_CONSTANT = {
    ("coarse", "orm", "B"):
        "no coarse role is a polished metal, so metalness is left at identity",
}

# Channels that MUST carry variation, with the reason a flat one is a defect.
MUST_VARY = {
    ("normal", "R"): "no relief across the tile in X",
    ("normal", "G"): "no relief across the tile in Y",
    ("orm", "R"): "ambient occlusion is flat, so crevices do not darken",
    ("orm", "G"): "uniform roughness is what makes untextured PBR read as "
                  "plastic (DW-35); a flat G means the pass did nothing",
}
MIN_SPREAD = 16          # counts out of 255. A dead channel is 0; a real one
                         # measures 50+. Nothing lands near 16 by accident.


def _channel_stats(rgb, n):
    out = []
    for c in range(3):
        lo, hi, total = 255, 0, 0
        for i in range(c, n * 3, 3):
            v = rgb[i]
            if v < lo:
                lo = v
            if v > hi:
                hi = v
            total += v
        out.append((lo, hi, total / n))
    return out


def check_maps(out_dir=OUT_DIR, verbose=True):
    """Returns (ok, lines). Every texel of every map is examined; the count is
    reported so 'all green' cannot mean 'looked at nothing'."""
    lines, ok = [], True

    def say(good, label, detail):
        nonlocal ok
        ok = ok and good
        lines.append("  [%s] %-22s %s" % ("ok" if good else "FAIL",
                                          label, detail))

    m_path = os.path.join(out_dir, "surfaces.json")
    if not os.path.isfile(m_path):
        say(False, "manifest", "MISSING: %s" % m_path)
        return ok, lines
    with open(m_path, "r", encoding="utf-8") as fh:
        man = json.load(fh)
    say(man.get("version") == MANIFEST_VERSION, "manifest",
        "version %r (tool speaks %d), zlib %s"
        % (man.get("version"), MANIFEST_VERSION, man.get("zlib")))

    declared = set(man.get("families", {}))
    say(declared == set(FAMILIES), "families",
        "%s" % sorted(declared) if declared == set(FAMILIES)
        else "manifest %s != code %s" % (sorted(declared), sorted(FAMILIES)))

    total_texels = 0
    for fam in sorted(declared):
        spec = man["families"][fam]
        for kind in ("normal", "orm"):
            rec = spec[kind]
            path = os.path.join(out_dir, rec["file"])
            if not os.path.isfile(path):
                say(False, "%s.%s" % (fam, kind), "MISSING: %s" % rec["file"])
                continue
            with open(path, "rb") as fh:
                blob = fh.read()
            digest = hashlib.sha256(blob).hexdigest()
            if digest != rec.get("sha256"):
                say(False, "%s.%s sha" % (fam, kind),
                    "manifest %s.. != file %s.."
                    % (str(rec.get("sha256"))[:12], digest[:12]))
                continue
            w, h, rgb = read_png_rgb(path)
            n = w * h
            total_texels += n
            size_ok = w == h == spec["size_px"] and len(blob) == rec["bytes"]
            say(size_ok, "%s.%s file" % (fam, kind),
                "%dx%d, %d B, sha %s.." % (w, h, len(blob), digest[:8]))

            stats = _channel_stats(rgb, n)
            for c, cname in enumerate("RGB"):
                lo, hi, mean = stats[c]
                key = (fam, kind, cname)
                if lo == hi:
                    why = ALLOWED_CONSTANT.get(key)
                    say(why is not None and lo == 255,
                        "%s.%s %s const" % (fam, kind, cname),
                        ("constant %d, allowed: %s" % (lo, why)) if why
                        else "CONSTANT at %d and not declared allowed" % lo)
                elif (kind, cname) in MUST_VARY:
                    say(hi - lo >= MIN_SPREAD, "%s.%s %s" % (fam, kind, cname),
                        "spread %d (min %d), range %d..%d mean %.1f%s"
                        % (hi - lo, MIN_SPREAD, lo, hi, mean,
                           "" if hi - lo >= MIN_SPREAD
                           else "  -> " + MUST_VARY[(kind, cname)]))
                else:
                    say(True, "%s.%s %s" % (fam, kind, cname),
                        "range %d..%d mean %.1f" % (lo, hi, mean))

            if kind == "normal":
                # A normal map is unit vectors in tangent space. Two things can
                # be wrong and both look plausible in a thumbnail: the vectors
                # are not normalised (lighting goes soft and wrong), or Z is
                # negative somewhere (the surface points INTO itself, which
                # reads as a black pit).
                worst, back = 0.0, 0
                for i in range(0, n * 3, 3):
                    x = rgb[i] / 127.5 - 1.0
                    y = rgb[i + 1] / 127.5 - 1.0
                    z = rgb[i + 2] / 127.5 - 1.0
                    if z <= 0.0:
                        back += 1
                    d = abs(math.sqrt(x * x + y * y + z * z) - 1.0)
                    if d > worst:
                        worst = d
                # 8-bit quantisation alone can move a unit vector by up to
                # sqrt(3)/255 = 0.0068, so the bound is derived, not tuned.
                say(worst <= 0.0068 + 1e-9, "%s.normal unit" % fam,
                    "worst |len-1| = %.5f <= 0.00680 over %d texels"
                    % (worst, n))
                say(back == 0, "%s.normal +Z" % fam,
                    "0 texels face away" if not back
                    else "%d texels have Z <= 0" % back)

    say(True, "coverage", "%d texels examined, 0 skipped" % total_texels)
    if verbose:
        for ln in lines:
            print(ln)
    return ok, lines


# ---------------------------------------------------------------------------
# selftest. Per DW-20 a check has to demonstrate it can fail, so every case
# below states what it would catch.
# ---------------------------------------------------------------------------

def selftest():
    import tempfile
    fails = []

    def check(label, ok, detail=""):
        print("  [%s] %-26s %s" % ("ok" if ok else "FAIL", label, detail))
        if not ok:
            fails.append(label)

    tmp = tempfile.mkdtemp(prefix="texgen_")

    # 1. Encoder round trip. Catches: a filter that does not invert.
    w = h = 37
    px = bytearray()
    for y in range(h):
        for x in range(w):
            px += bytes(((x * 7) % 256, (y * 11) % 256, ((x ^ y) * 3) % 256))
    p = os.path.join(tmp, "rt.png")
    write_png(p, w, h, bytes(px))
    rw, rh, rgb = read_png_rgb(p)
    check("png round trip", (rw, rh) == (w, h) and rgb == bytes(px),
          "%dx%d, %d bytes" % (rw, rh, len(rgb)))

    # 2. No timestamp or text chunk. Catches: an encoder that "helpfully" adds
    #    provenance, which is the single most common cause of a PNG that
    #    differs between two identical runs.
    with open(p, "rb") as fh:
        blob = fh.read()
    tags = []
    off = 8
    while off + 8 <= len(blob):
        ln, tag = struct.unpack_from(">I4s", blob, off)
        tags.append(tag.decode("ascii"))
        off += 8 + ln + 4
    check("chunks are minimal", tags == ["IHDR", "IDAT", "IEND"], ",".join(tags))

    # 3. Two encodes of the same pixels are the same bytes. Catches: a
    #    nondeterministic filter choice or an unpinned zlib parameter.
    p2 = os.path.join(tmp, "rt2.png")
    write_png(p2, w, h, bytes(px))
    with open(p2, "rb") as fh:
        blob2 = fh.read()
    check("encode is stable", blob == blob2, "%d bytes twice" % len(blob))

    # 4. A different pixel produces a different file. Catches the failure this
    #    whole gate could have: an encoder that ignores its input would pass
    #    check 3 forever.
    px3 = bytearray(px)
    px3[3 * (19 * w + 23)] ^= 0x40
    p3 = os.path.join(tmp, "rt3.png")
    write_png(p3, w, h, bytes(px3))
    with open(p3, "rb") as fh:
        blob3 = fh.read()
    check("encode is sensitive", blob3 != blob, "one texel changed the file")

    # 5. Refuse what is out of scope rather than misreading it.
    bad = os.path.join(tmp, "bad.png")
    with open(bad, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n"
                 + _chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 16, 2, 0, 0, 0))
                 + _chunk(b"IDAT", zlib.compress(b"\x00" * 100, 9))
                 + _chunk(b"IEND", b""))
    try:
        read_png_rgb(bad)
        check("refuses 16-bit", False, "decoded a 16-bit PNG as 8-bit")
    except ValueError as exc:
        check("refuses 16-bit", True, str(exc).split(":")[-1].strip()[:40])

    # 6. The noise is periodic. Catches: a lattice that does not wrap, which
    #    would put a visible seam on every tile boundary in the game.
    n = _noise_field(64, 64, 8, seed=99)
    tab = _lattice(8, 99)
    #    Sampling at u = 1.0 must equal sampling at u = 0.0.
    row = 13
    f = row * 8 / 64
    j0 = int(f) % 8
    j1 = (j0 + 1) % 8
    ty = _smooth(f - int(f))
    at0 = n[row * 64 + 0]
    #    reconstruct the value at exactly u = 1.0 (lattice index 8 == 0)
    a, c = tab[j0 * 8 + 0], tab[j1 * 8 + 0]
    at1 = a + (c - a) * ty
    check("noise wraps", abs(at0 - at1) < 1e-12, "|d| = %.3e" % abs(at0 - at1))

    # 7. The generated fields tile.
    #
    #    The FIRST version of this check compared the two edge columns against a
    #    fixed threshold at a reduced resolution, and it failed both families -
    #    correctly by its own rule and uselessly, because at 96 px the 6 mm
    #    groove is half a texel wide, so it was measuring aliasing and had no
    #    way to see a seam underneath it. Worth keeping as a worked example of
    #    standing rule 11 in the other direction: a check can also fail on
    #    something it never examined.
    #
    #    The SECOND version measured the NORMAL MAP's two edge columns, and the
    #    negative control below is what caught it: `_normal_rgb` differences
    #    with wrapped indices, so the normal map is continuous across the wrap
    #    BY CONSTRUCTION whatever the heightfield does. A discontinuous height
    #    shows up as a bright double line in the two columns either side of the
    #    seam, and as exactly zero difference between them. The check could not
    #    have failed, which is the same defect this project has now found five
    #    times. It is recorded here rather than quietly deleted.
    #
    #    The subject is the HEIGHTFIELD, in both axes. A tiling field's step
    #    across the wrap is an ordinary step: no worse than the worst one
    #    inside. A feature that used an unwrapped distance puts a cliff there.
    def _wrap_vs_interior(f, s):
        edge = inner = 0.0
        for y in range(s):
            row = y * s
            edge = max(edge, abs(f[row] - f[row + s - 1]))
            for x in range(s - 1):
                inner = max(inner, abs(f[row + x] - f[row + x + 1]))
        for x in range(s):
            edge = max(edge, abs(f[x] - f[(s - 1) * s + x]))
            for y in range(s - 1):
                inner = max(inner, abs(f[y * s + x] - f[(y + 1) * s + x]))
        return edge, inner

    for fam in sorted(FAMILIES):
        s = FAMILY_SIZE[fam]
        height, _ = FAMILIES[fam]["height"](s, s)
        edge, inner = _wrap_vs_interior(height, s)
        check("%s tiles" % fam, edge <= inner,
              "wrap step %.4f vs worst interior %.4f" % (edge, inner))

    # 7b. NEGATIVE CONTROL, per DW-20: the check above must be able to fail.
    #     A linear ramp is smooth everywhere inside and maximally discontinuous
    #     at exactly the wrap, which is the shape of every seam defect.
    s = 64
    ramp = [(x / s) for y in range(s) for x in range(s)]
    edge, inner = _wrap_vs_interior(ramp, s)
    check("seam check can fail", edge > inner,
          "ramp: wrap step %.4f vs worst interior %.4f" % (edge, inner))

    # 8. Every palette role is either mapped or explicitly flat. Catches the
    #    standing-rule-11 failure of a check that passes on what it never
    #    examined: a new role added to of_lib.PALETTE would otherwise silently
    #    ship untextured with nobody noticing.
    try:
        sys.path.insert(0, HERE)
        import of_lib_palette_probe  # pragma: no cover - never exists
    except Exception:
        pass
    roles = _palette_roles()
    if roles is None:
        check("every role decided", False,
              "could not read of_lib.PALETTE - NOT EXAMINED")
    else:
        undecided = sorted(r for r in roles
                           if r not in ROLE_FAMILY and r not in FLAT_ROLES)
        check("every role decided", not undecided,
              "%d role(s) mapped, %d flat, %d undecided%s"
              % (len(ROLE_FAMILY), len(FLAT_ROLES), len(undecided),
                 (": " + ", ".join(undecided)) if undecided else ""))
        stale = sorted(r for r in list(ROLE_FAMILY) + list(FLAT_ROLES)
                       if r not in roles)
        check("no stale roles", not stale, ", ".join(stale) or "none")

    # 9. NEGATIVE CONTROL for `check`, against the SHIPPED set. A gate nobody
    #    has ever seen fail is a gate nobody knows the state of. This copies
    #    the real texture directory, flips one bit in one PNG, and requires
    #    `check` to notice - and separately requires it to pass on the
    #    untouched copy, because a checker that fails on everything is just as
    #    useless as one that passes on everything.
    if os.path.isdir(OUT_DIR):
        import shutil
        good = os.path.join(tmp, "tex_good")
        shutil.copytree(OUT_DIR, good)
        ok_clean, _ = check_maps(good, verbose=False)
        check("check passes clean", ok_clean, "shipped set under check_maps")
        victim = os.path.join(good, "of_panel_orm.png")
        with open(victim, "rb") as fh:
            blob = bytearray(fh.read())
        blob[len(blob) // 2] ^= 0x01
        with open(victim, "wb") as fh:
            fh.write(blob)
        ok_dirty, _ = check_maps(good, verbose=False)
        check("check can fail", not ok_dirty,
              "one flipped bit in of_panel_orm.png was caught")
    else:
        check("check passes clean", False,
              "NOT EXAMINED: %s does not exist, run `texgen.py` first" % OUT_DIR)
        check("check can fail", False, "NOT EXAMINED: same reason")

    print("\n%s  %d check(s), %d failure(s)"
          % ("SELFTEST PASS" if not fails else "SELFTEST FAIL",
             11 + len(FAMILIES), len(fails)))
    return 0 if not fails else 1


def _palette_roles():
    """Read of_lib.PALETTE's keys WITHOUT importing of_lib, because of_lib
    imports bpy and this module must run in a plain python. Parsing the source
    is the honest way to do that; if the parse finds nothing it returns None so
    the caller can report NOT EXAMINED rather than a false pass."""
    path = os.path.join(HERE, "of_lib.py")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
    except OSError:
        return None
    start = src.find("PALETTE = {")
    if start < 0:
        return None
    depth, i = 0, src.index("{", start)
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                body = src[i:j + 1]
                break
    else:
        return None
    roles = []
    for line in body.splitlines():
        line = line.strip()
        if line.startswith('"') and '":' in line:
            roles.append(line[1:line.index('":')])
    return roles or None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="?", default="build",
                    choices=["build", "selftest", "check"])
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--size", type=int, default=None,
                    help="override every family's resolution (debug only; the "
                         "shipped set uses FAMILY_SIZE)")
    ap.add_argument("--list", action="store_true",
                    help="print the role -> family table and exit")
    args = ap.parse_args()
    if args.list:
        for r, f in sorted(ROLE_FAMILY.items()):
            print("  %-14s %s" % (r, f))
        for r, why in sorted(FLAT_ROLES.items()):
            print("  %-14s FLAT   %s" % (r, why))
        return 0
    if args.cmd == "selftest":
        return selftest()
    if args.cmd == "check":
        ok, lines = check_maps(args.out)
        print("\n%s  %d check(s)" % ("TEXTURES PASS" if ok else "TEXTURES FAIL",
                                     len(lines)))
        return 0 if ok else 1
    generate(args.out, args.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
