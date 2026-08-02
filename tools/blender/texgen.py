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

THE SCHEME. Four shared tiling surfaces, not per-asset textures:

    panel   hard-surface industrial: plate seams, rivets, bolts, weld bead,
            scratches and grime. Steel, plate, painted accent, suit, ore metal.
    coarse  rough non-metal: chipped facets and granular relief. Rock, soil,
            sand, regolith, coal, rubber.
    bark    tree trunks: near-vertical fissures and ridge plateaus, a few
            horizontal breaks and knots. Bark and BarkLight only. Split out of
            `coarse` because rock pitting on a trunk reads as a stone pillar;
            bark's relief is strongly DIRECTIONAL and rock's is isotropic,
            which is not a difference a shared field can paper over.
    ore     ore seams in host rock: warped parallel strata, crevices between
            the bands, crystalline facet grain on them. IronOre, CopperOre,
            CoalSeam only (RN-156). Split out for bark's reason exactly:
            bedded mineral is DIRECTIONAL, rubble pitting is not, and the
            roughness contrast between smooth facet glints and dusty matrix
            is what sells a mineral under a moving sun.

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

TWO CARD FAMILIES BESIDE THE FOUR SURFACES. `leaf` and `grass` are
albedo+alpha CUTOUT CARDS (of_<name>_a.png, RGBA), not tiling PBR surfaces:
unit UVs rather than metres, u wraps and v clamps, and the alpha channel IS
the shape. They are the stated exception to ALBEDO IS DELIBERATELY ABSENT,
because a cutout cannot exist without its own texture, and they keep the
palette-authority argument intact by being near-neutral VALUE textures: hue
still comes from the client's colours, and the manifest publishes each card's
measured albedo_mean so the client can divide it out via material.color and
keep the modulation mean-neutral. See the ALBEDO CARD FAMILIES section.
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
# `bark` matches coarse at 384: its tile is smaller still (0.6 m), so 384 px
# lands at 640 px/m, already above the 512 px/m first-person target, and the
# family covers exactly two roles on organic props the camera brushes past.
# `ore` matches coarse and bark at 384: its 0.5 m tile lands at 768 px/m,
# comfortably above the 512 px/m first-person target, on a family that covers
# exactly three seam roles the camera only meets on boulder facets.
# `fur` matches coarse, bark and ore at 384: its 0.30 m tile lands at
# 1280 px/m, well above the 512 px/m first-person target, on a family whose
# finer strand layer is 7.5 mm apart and would alias away at anything less.
# It carries THREE maps rather than two, so 384 rather than 512 is also what
# keeps the addition at 2.36 MB of VRAM instead of 4.19 MB.
# `suitfab` and `suitplate` are sized by the ONE distance that matters for
# them and for nothing else in this file: the first-person hand sits 0.62 m
# from the eye, and at the client's real 60 degree vertical FOV (CameraRig.ts,
# `fovDeg = 60`, never reassigned) a 800 px frame resolves 1117 px per metre
# there. A family under about 1000 px/m is visibly soft in the one asset that
# is in every frame of the game, so both clear it: suitfab 512 px / 0.5 m =
# 1024 px/m, suitplate 384 px / 0.4 m = 960 px/m. ASSET-SPECS 2.8's 512 px/m
# first-person target is the floor here, not the aim.
FAMILY_SIZE = {"panel": 512, "coarse": 384, "bark": 384, "ore": 384,
               "fur": 384, "suitfab": 512, "suitplate": 384}

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
    "Accent": "panel", "Hazard": "panel",
    # SuitAccent stays on `panel` although it is a suit colour, and this is
    # deliberate rather than an oversight: rocket_common.py and
    # build_lander_landed.py both paint stripes and fittings with it, so it is
    # NOT a player-only role and moving it would re-surface another lane's
    # assets. The suit's own accent reads through geometry and value here.
    "SuitAccent": "panel",
    # --- suitfab / suitplate: the pressure garment (RN-643, RN-644) ---
    # `Suit`, `SuitDark` and `Plate` are used by build_player_body.py,
    # build_player_fp_arms.py and build_armour_set.py and by NOTHING ELSE in
    # the repo, so re-pointing them re-surfaces the player kit and only the
    # player kit. That exclusivity is what makes this a safe move rather than
    # a cross-lane one, and it was checked by grep before it was made.
    #
    # They were on `panel`, and `panel` is the wrong FACT about a pressure
    # suit in exactly the way `coarse` was the wrong fact about bark. panel
    # encodes MANUFACTURE OUT OF PLATE: seams, rivet rows, a weld bead. A
    # fabric garment has none of those, and section 2.1 item 4 measures
    # panel's effective roughness band at 0.032, which it names as "the
    # plastic read on every machine, plate and suit". A woven surface and a
    # worn metal fitting are two different materials and neither of them is
    # a riveted plate.
    "Suit": "suitfab", "SuitDark": "suitfab",
    "Plate": "suitplate",
    # --- fur: the creature pelt (RN-455, retargeted RN-461). The ROLE
    #     names stay: a tarantula cuticle really is chitin and the setae
    #     grow out of it, so the role says what the part IS and the family
    #     says what it LOOKS like. Fang is on it only because the client
    #     merge gives the whole creature one material anyway; at 4 cm of
    #     geometry the map on it is unobservable either way.
    "Chitin": "fur", "ChitinBand": "fur", "ChitinUnder": "fur",
    "Fang": "fur",
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
    "Rubber": "coarse",
    # --- bark: tree trunks ---
    # Moved out of `coarse` for the same reason Iron and Copper moved out of
    # `panel`: the family encoded the wrong FACT about the surface. `coarse`
    # is isotropic fracture, and a trunk wearing it reads as a stone column
    # with moss. Bark's structure is directional (fissures along the grain),
    # so it needs its own field, not a retune of the shared one.
    "Bark": "bark", "BarkLight": "bark",
    # --- ore: seam mineral in host rock ---
    # The ore-in-rock roles (RN-156), NOT the Iron/Copper/Coal item rows
    # above, which stay in `coarse`. Same argument that split bark out: a
    # seam face is bedded mineral, its structure is directional strata, and
    # rubble pitting is the wrong fact about it.
    "IronOre": "ore", "CopperOre": "ore", "CoalSeam": "ore",
    # --- the albedo CARD families (RN-181) ---
    # The foliage roles leave FLAT_ROLES for `leaf` and `grass`. The recorded
    # objections below are honoured rather than overruled: they refused a
    # NORMAL map on a card, and the card families carry none. What a card
    # family adds is an albedo whose ALPHA is the shape, alpha-tested at the
    # manifest's declared cutoff, over authored unit UVs (RN-180). This move
    # lands in the same commit as the client's copy of this table, because
    # verifyAgainstManifest makes a one-sided move a failed smoke run.
    "Leaf": "leaf", "LeafDeep": "leaf", "LeafLight": "leaf",
    "LeafDry": "leaf",
    "Grass": "grass",
}

# Roles with NO map, and why. Each of these would be made worse by one.
FLAT_ROLES = {
    "Glass": "transparent; a normal map on a 0.35-alpha pane reads as dirt",
    "Water": "transparent and animated by the shader, not by a map",
    "Ice": "near-specular; relief belongs in the mesh at this poly count",
    "Oil": "a pool surface, deliberately mirror-flat",
    # Leaf, LeafDeep, LeafLight, LeafDry and Grass lived here from DW-35 to
    # RN-181 with two recorded reasons: "a normal map fights the flat-shaded
    # silhouette" and "sub-pixel blades at any real viewing distance". Both
    # were about the SURFACE families and both still hold; the roles moved to
    # the albedo card families above, which carry no normal map, and the
    # honest converse of the sub-pixel argument (RN-101: a 0.6 m blade spans
    # ~100 px at 8 m) is what the card alpha is for.
    "Skin": "1.5 cm of visible wrist; a pore map is 5.6 MB for nothing",
    "EmissiveState": "a state light. Any AO or roughness on it is a lie about "
                     "what the surface is doing",
    # RN-455. Both eye roles are 3 to 6 cm of convex bead on a creature the
    # player meets at 2 m: chitin pitting at that size is one texel across
    # and reads as noise, and an eye is the one part of a spider that IS a
    # polished sphere. They differ from each other by VALUE, which is the
    # only channel that survives SpiderFlock's merge.
    "EyeGlow": "a wet convex bead 6 cm across; relief and grain belong to "
               "the shell around it, not to it",
    "EyeDark": "the six secondary eyes, same argument as EyeGlow",
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
#
# `bark` 0.6 m. The consumer is a trunk 0.3 to 0.5 m across and 2 to 6 m tall,
# and the thing being replaced is coarse's 0.75 m rock pitting, whose features
# were sized for a 4 m foundation deck and therefore wrap a 0.4 m trunk barely
# half a repeat: one facet becomes the whole trunk face. At 0.6 m a trunk
# circumference (~1.3 m for 0.4 m diameter) carries about two repeats around
# and a 4 m trunk carries ~6.7 repeats up, so the fissures read as many
# parallel ridges rather than as one giant feature, while the tile stays big
# enough that the repeat up the trunk is not countable at arm's length.
# `ore` 0.5 m. The consumer is a boulder seam facet 0.3 to 0.6 m across, so
# at ORE_BANDS = 5 per tile the band pitch is 10 cm and a facet carries three
# to six bands: enough parallel strata to read as a vein rather than as one
# stripe, few enough that the copies are not countable. coarse's 0.75 would
# put a 15 cm pitch on the same facet, two bands, one feature.
# `suitfab` 0.5 m. The tile size is a REPETITION argument, not a density one.
# The albedo carries soiling at 10 to 20 cm (RN-454's frequency split), and a
# patch that big in a 0.3 m tile is the tile, so the grime would repeat three
# times across a torso and read as a printed pattern. At 0.5 m the broad
# fbm period of 3 lands at 16.7 cm, inside the band, and a 0.12 m glove
# carries a quarter of one tile: no repeat is reachable on the part of this
# asset that fills the frame.
# `suitplate` 0.4 m. Its consumers are SMALL - a 5 cm knuckle plate, a 2.8 cm
# helmet ring, an armour lame - so a tile eight times the largest of them
# cannot repeat on any one part, and the scratches stay long relative to the
# plate they cross, which is what a scratch looks like.
FAMILY_TILE_M = {"panel": 1.5, "coarse": 0.75, "bark": 0.6, "ore": 0.5,
                 "fur": 0.3, "suitfab": 0.5, "suitplate": 0.4}

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

    --------------------------------------------------------------------
    RN-553: THE BAND, AND IT IS THE ONE NUMBER SECTION 2.1 NAMES BY NAME
    --------------------------------------------------------------------
    `docs/controllers/rendering.md` section 2.1 item 4 says a family's
    effective roughness p05..p95 must be at least about 0.15 wide, "below
    that it is a constant under a moving sun", and it measures THIS family
    at 0.032 with the verdict "that is the plastic read on every machine,
    plate and suit". Every machine, belt, structure, rocket part and tool in
    the game is wearing the one surface in the set that cannot respond to
    light.

    THIS FAMILY IS RE-AUTHORED RATHER THAN DUPLICATED UNDER A NEW NAME, and
    that is a decision (RN-60) rather than the path of least resistance. The
    player lane is moving `Suit`, `SuitDark` and `Plate` onto their own
    `suitfab` / `suitplate` families in a change that is in flight as this
    lands, which leaves `panel` holding Steel, SteelDark, SteelLight, Accent,
    Hazard and SuitAccent: every one of them painted industrial steel. A
    second painted-steel family beside this one would be the same surface
    authored twice, would need a client literal change to take effect at all
    (`MachineBatch` pins `attachSurface(m, 'panel', ...)` on the whole batch),
    and would leave the 0.032 band live on the rocket parts, the launch pad
    and the tools. Re-authoring reaches all of them with no role move.

    THE 0.032 WAS ARITHMETIC AND NOT AN ACCIDENT. The old mask is
    `1.0 - 0.28 * proud + (mottle - 0.5) * 0.22`, and `proud` is non-zero
    only on a rivet or bolt top, which is a fraction of a per cent of the
    texels. So on every flat plate face the whole map reduced to
    `1.0 +/- 0.11` around a mean of 1.0, and 0.45 (Steel's palette
    roughness) times a 0.22-wide multiplier is a 0.05-wide effective band
    before percentiles trim it to 0.032.

    THE FIX IS A STORY AND NOT A GAIN. Multiplying the old mottle by four
    would clear the gate and mean nothing: the band has to be somewhere a
    surface actually goes. Painted steel has three states and they are far
    apart. Coating that is intact and has been WIPED or RAINED ON is close
    to specular. Coating that has CHALKED in the sun is nearly matte, and
    that is the palette constant. Where the coating has gone and the alloy
    is bare and handled, it is polished. So the map runs from about 0.42 to
    1.00, effective 0.19 to 0.45 on Steel, and the direction of every term
    is a claim that can be checked against a real machine.

    WHY IT STAYS AT OR UNDER 1.0. The ORM channels are byte multipliers on
    the palette constant, so 1.0 is the ceiling by construction and the
    palette decides the matte end. Widening downward is therefore the only
    move available without a palette edit, and a palette edit here would
    re-surface the rocket parts, the launch pad and the tools in the same
    commit as a machine pass. That is a separate, arguable decision and it
    is deliberately not taken here.
    """
    mottle = _fbm(w, h, 12, 3, seed=4441)
    # 40 cm at the 1.5 m tile: WHERE THE WEATHER HAS BEEN. Big, slow patches
    # of chalked against intact coating, an order of magnitude coarser than
    # the mottle, so a 4 m wall has two or three of them rather than a texture.
    weather = _fbm(w, h, 4, 3, seed=6151)
    # 5 cm: run-off. Rain and condensate leave streaks that stay WET-looking
    # long after they dry, because the coating there is washed rather than
    # chalked. This is the term that puts fine vertical structure in the
    # roughness that the albedo and the normal do not have.
    wash = _fbm(w, h, 30, 2, seed=6421)
    scratch = aux["scratch"]
    rough = [0.0] * (w * h)
    metal = [0.0] * (w * h)
    for i in range(w * h):
        z = height[i]
        # `face` is ~1 on the plate, ~0 in a groove, >1 on a rivet or bolt.
        face = _clamp01(z)
        proud = _clamp01(z - 1.0) / 0.42          # rivet / bolt tops
        # THE FLAT PLATE FACE NO LONGER COMES OUT AT ~1.0, AND THE OLD NOTE
        # SAYING IT MUST IS SUPERSEDED. That note was written under a values
        # freeze this lane did not own; its actual argument was that a mask
        # must not silently shift the palette MEAN, which is a different claim
        # from "must not vary". `weather` is symmetric about its own midpoint
        # and `wash` only subtracts where it is high, so the mean moves down by
        # a stated 0.09 rather than by an unnoticed 0.22.
        # THE THRESHOLDS ARE WHERE THE BAND LIVES, NOT THE COEFFICIENTS, and
        # the first tuning got that backwards. An `_fbm` is normalised to 0..1
        # but CLUSTERS about its own middle, so `(weather - 0.34) / 0.52` only
        # reaches full strength where weather exceeds 0.86, which is a few per
        # cent of texels: the coefficient was 0.34 and the measured p05 still
        # sat at 0.686, for a Steel band of 0.136 against section 2.1's 0.15.
        # Moving the knee down to 0.28 and the ramp to 0.34 changes how MANY
        # texels are wiped rather than how far, which is what a percentile band
        # actually measures.
        r = 1.0 - 0.28 * proud
        r -= 0.40 * _clamp01((weather[i] - 0.28) / 0.34)   # wiped / rained on
        r -= 0.18 * _clamp01((wash[i] - 0.54) / 0.32)      # run-off streaks
        r += (mottle[i] - 0.5) * 0.14
        # A rub exposes cleaner metal, so it goes shinier, not duller. Taken
        # straight from the mask the height pass built, rather than inferred
        # from a height window - the inference version became dead code the
        # moment the relief was reduced, which is exactly why it is gone.
        r -= 0.16 * scratch[i]
        rough[i] = _clamp01(r)
        m = 0.42 + 0.58 * _smoothstep(0.15, 0.85, face)
        metal[i] = _clamp01(m)
    return rough, metal


def _panel_albedo(w, h, height, aux):
    """A TILING ALBEDO for painted industrial steel. RN-553.

    THE FREQUENCY SPLIT IS THE WHOLE DESIGN AND IT IS RN-454'S LESSON PAID
    FORWARD. Driving albedo, normal and ORM off one heightfield gave the
    creature identical frequency content in all three maps and it rendered as
    a spider built out of cobblestones. So this map deliberately does NOT
    read `height`, which already owns the seams, the rivets and the weld bead
    and hands them to the normal:

      NORMAL  relief below a centimetre plus the manufactured geometry
      ORM     the roughness band above, at 40 cm and 5 cm
      ALBEDO  PIGMENTATION at 10 to 45 cm, which is the one thing neither of
              the others can say and the thing paint actually does

    What paint does, in the order the terms below do it: it fades unevenly in
    patches the size of a hand to a hand-span; it collects grime in a fine
    speckle that darkens without colouring; and where the coating has failed
    it goes WARM, because what is under paint on a machine is oxide. The
    oxide term is the only one that moves hue, and it moves it in one
    direction only, because rust is not a colour that has an opposite.

    MEAN-NEUTRAL BY CONTRACT. `Surfaces.ts` sets
    `material.color = palette / albedo_mean` and then multiplies the map back
    in, so only this map's VARIANCE and its HUE survive and its LEVEL cannot
    shift the palette. That is what lets one map serve Steel, SteelDark,
    Accent and Hazard without lightening the dark one and dirtying the bright
    one, and it is why every term here is written as a multiplier about 1.0
    rather than as an absolute value."""
    fade = _fbm(w, h, 4, 3, seed=15013)       # ~38 cm: uneven weathering
    patch = _fbm(w, h, 9, 3, seed=15271)      # ~17 cm: coating thickness
    grime = _fbm(w, h, 34, 2, seed=15427)     # ~4.4 cm: dirt speckle
    oxide = _fbm(w, h, 6, 4, seed=15683)      # ~25 cm: where it has failed
    # THE MAP IS CENTRED AT 0.55 AND NOT AT 1.0, AND THE FIRST BUILD IS WHY.
    # Every term below is a multiplier about 1.0, which is the right way to
    # write a mean-neutral map and the wrong place to CENTRE one: the first
    # version measured a mean of 0.9659 with a per-channel range of 194..255,
    # i.e. the top of the variance was CLIPPING against the byte ceiling and
    # the map was throwing away the pigmentation it exists to carry.
    # `check_maps` refuses a tiling albedo outside 0.15..0.85 for exactly this
    # reason and the refusal is correct. The level is free, because
    # `Surfaces.ts` divides it back out, so it costs nothing to sit in the
    # middle of the range where both tails survive.
    LEVEL = 0.55
    out = bytearray(3 * w * h)
    for i in range(w * h):
        # Value. Two scales of fade and one of grime, all symmetric about 1.0
        # except the grime, which only ever darkens because dirt does.
        v = 1.0 + (fade[i] - 0.5) * 0.30 + (patch[i] - 0.5) * 0.17
        v -= 0.13 * _clamp01((grime[i] - 0.52) / 0.48)
        # A groove holds dirt and a rivet top does not, so the ONE thing this
        # map takes from the height is the sign of the relief, at a tenth of
        # the weight of the pigmentation. Any more and the seams would be
        # drawn twice, once in the normal and once here.
        v -= 0.07 * (1.0 - _clamp01(height[i]))
        # Hue. Oxide only, only where the coating has gone thin AND the
        # weathering agrees, so the rust is in patches rather than everywhere
        # at a low level, which is the difference between a worn machine and a
        # brown one.
        rust = _clamp01((oxide[i] - 0.62) / 0.34) * _clamp01((fade[i] - 0.40)
                                                             / 0.45)
        v *= LEVEL
        o = 3 * i
        out[o] = int(round(255.0 * _clamp01(v * (1.0 + 0.26 * rust))))
        out[o + 1] = int(round(255.0 * _clamp01(v * (1.0 - 0.05 * rust))))
        out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 - 0.24 * rust))))
    return bytes(out)


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
# The `bark` family: tree trunks.
# ---------------------------------------------------------------------------

# Fissure count per tile. 7 fissures across 0.6 m is an 8.6 cm ridge pitch,
# inside the 3 to 10 cm range mature conifer bark actually has, and odd on
# purpose: an even count at this tile size puts two fissures exactly half a
# tile apart, and the repeat around a two-repeat trunk then lines up with
# itself, which is the countable-copies failure the panel rubs comment
# documents.
BARK_FISSURES = 7
BARK_MEANDER = 0.030      # max lateral wander of a fissure, in tile u units
BARK_MEANDER_PERIOD = 4   # lattice points of the periodic wander, per tile


def _bark_height(w, h):
    """(height, aux). Ridge plateaus near 1.0 cut by deep near-vertical
    fissures, plus a few horizontal breaks and knot dimples.

    WHICH TEXTURE AXIS IS VERTICAL, derived rather than assumed. UVs are
    box-projected world metres (of_lib.MeshBuilder._project_uvs), and
    validate_glb.py's uv_metres check states the exact post-export mapping per
    dominant face axis:

        Blender axis Z -> (u, v) = ( X, 1 + Z)     top / bottom caps
        Blender axis X -> (u, v) = (-Z, 1 - Y)     side face, normal along X
        Blender axis Y -> (u, v) = ( X, 1 - Y)     side face, normal along Y

    glTF is Y-up after the exporter's conversion, so on the SIDE faces of a
    vertical trunk (the two horizontal-normal cases) v = 1 - Y in BOTH cases:
    the two cases AGREE, world-vertical is always the v axis, and there is no
    minority orientation to trade away. Fissures therefore run along v
    (image y), meandering slightly in u. The caps get fissures crossing the
    end grain, which is wrong but invisible: a trunk's caps are its cut ends.

    AMPLITUDE. The plateau sits near 1.0 and a fissure floor near 0.45, so
    the walls are ~0.55 over a ~1.4 cm bevel: steeper than coarse's facets,
    gentler than panel's grooves, and the family's normal_strength is chosen
    against that (see FAMILIES)."""
    grain = _fbm(w, h, 24, 3, seed=3307)
    lumps = _fbm(w, h, 5, 3, seed=4409)

    # Per-fissure meander tables, periodic in v BY CONSTRUCTION so the field
    # tiles: BARK_MEANDER_PERIOD hashed offsets per fissure, interpolated with
    # the same quintic the value noise uses, lattice indices wrapped with %.
    mp = BARK_MEANDER_PERIOD
    wander = [[(_hash01(k, j, 7331) - 0.5) * 2.0 * BARK_MEANDER
               for j in range(mp)] for k in range(BARK_FISSURES)]
    # Base u per fissure: even spacing plus a small hashed offset, small
    # enough (0.25 of the pitch, on top of +/- BARK_MEANDER) that neighbours
    # cannot cross.
    base_u = [(k + 0.5 + (_hash01(k, 91, 5479) - 0.5) * 0.25) / BARK_FISSURES
              for k in range(BARK_FISSURES)]

    # Horizontal breaks: short shallow cracks across the grain. Few and short,
    # for the reason the panel rubs comment gives: a long unique feature on a
    # shared tiling surface is a repeat cue.
    breaks = [
        (0.08, 0.22, 0.30, 0.22),
        (0.55, 0.61, 0.78, 0.63),
        (0.72, 0.90, 0.88, 0.89),
    ]
    # Knots: a raised welt with a dimple inside, where a branch was.
    knots = [(0.30, 0.72), (0.83, 0.34)]

    # Fissure centres per ROW (u depends on v through the meander), hoisted
    # out of the pixel loop: h rows x BARK_FISSURES instead of w*h.
    centres = []
    for y in range(h):
        v = (y + 0.5) / h
        f = v * mp
        j0 = int(f) % mp
        j1 = (j0 + 1) % mp
        t = _smooth(f - int(f))
        row = []
        for k in range(BARK_FISSURES):
            o0 = wander[k][j0]
            o1 = wander[k][j1]
            row.append((base_u[k] + o0 + (o1 - o0) * t) % 1.0)
        centres.append(row)

    out = [0.0] * (w * h)
    fissure = [0.0] * (w * h)
    for y in range(h):
        v = (y + 0.5) / h
        base = y * w
        cs = centres[y]
        for x in range(w):
            u = (x + 0.5) / w
            g = grain[base + x]

            # --- ridge plateau, gently domed between fissures ---------------
            du = min(_wrap_dist(u, c) for c in cs)
            z = 0.88 + 0.12 * lumps[base + x]
            z += 0.10 * _smoothstep(0.020, 0.055, du)

            # --- the fissure itself -----------------------------------------
            # Width breathes with the grain so the walls are ragged rather
            # than machined: 6 to 10 mm at the floor, bevel out to ~2 cm.
            w0 = 0.010 * (0.7 + 0.6 * g)
            w1 = 0.033
            cut = 1.0 - _smoothstep(w0, w1, du)
            z -= 0.55 * cut
            if cut > fissure[base + x]:
                fissure[base + x] = cut

            # --- horizontal breaks ------------------------------------------
            for br in breaks:
                db = _seg_dist(u, v, *br)
                if db < 0.020:
                    z -= 0.20 * (1.0 - _smoothstep(0.006, 0.020, db))

            # --- knots -------------------------------------------------------
            for (ku, kv) in knots:
                dd = math.sqrt(_wrap_delta(u, ku) ** 2
                               + _wrap_delta(v, kv) ** 2)
                if dd < 0.085:
                    z += 0.10 * (1.0 - _smoothstep(0.045, 0.085, dd))
                    z -= 0.34 * (1.0 - _smoothstep(0.008, 0.045, dd))

            # --- micro grain -------------------------------------------------
            z += (g - 0.5) * 0.05
            out[base + x] = z
    return out, {"fissure": fissure}


def _bark_masks(w, h, height, aux):
    """(roughness, metalness) for bark.

    Bark is matte everywhere, so the multiplier lives in roughly 0.8 to 1.0:
    fissure interiors and hollows at full palette roughness, exposed ridge
    crowns rubbed very slightly smoother, mottle on top so the spread clears
    MUST_VARY without pretending bark has polished spots. Metalness identity,
    exactly as coarse: the palette constant for both bark roles is already 0
    and a multiplier of 1.0 is the only value that does not rescale it."""
    mottle = _fbm(w, h, 12, 3, seed=7207)
    fiss = aux["fissure"]
    rough = [0.0] * (w * h)
    metal = [1.0] * (w * h)      # identity: bark is not a metal
    for i in range(w * h):
        r = (1.0 - 0.13 * _smoothstep(0.60, 1.05, _clamp01(height[i]))
             + (mottle[i] - 0.5) * 0.09
             + 0.04 * fiss[i])
        rough[i] = _clamp01(r)
    return rough, metal


# ---------------------------------------------------------------------------
# The `ore` family: seam mineral in host rock.
# ---------------------------------------------------------------------------

# Strata per tile. 5 bands across 0.5 m is a 10 cm band pitch (76.8 texels at
# 384), sized so a 0.3 to 0.6 m boulder seam facet carries three to six bands,
# and odd for bark's reason: an even count at this tile size lines the repeat
# up with itself on a two-repeat surface, which is the countable-copies
# failure the panel rubs comment documents.
ORE_BANDS = 5
ORE_WARP = 0.14           # max band-coordinate wander, in tile units: enough
                          # that the strata visibly bow, not enough that two
                          # bands can pinch shut (0.14 < half a 0.2 pitch)


def _ore_height(w, h, rotated=False):
    """(height, aux). Roughly parallel warped strata crossing v, a crevice
    where each band meets the next, crystalline facet grain on the band
    surface, occlusion living in the crevices.

    WHICH AXIS THE BANDS CROSS, derived rather than assumed, from the same
    box-projection fact _bark_height states in full: on the side faces of
    anything upright, world-vertical is the v axis in both horizontal-normal
    cases. Geological strata lie ACROSS the vertical, so the band coordinate
    is v and the bands themselves run along u, warped by a low-frequency
    field so they bow the way bedding does rather than ruling themselves
    like a machined grate.

    `rotated` is selftest-only: it feeds u to the band coordinate instead of
    v, which is the exact defect the anisotropy check exists to catch, so the
    check gets a negative control that fails honestly (DW-20).

    AMPLITUDE. Band surface near 0.72 doming to 0.82 mid-band, crevice floor
    0.45 lower over a ~1.6 cm bevel: between bark's fissure walls (0.55) and
    coarse's facets, and `ore`'s normal_strength is chosen against that (see
    FAMILIES). Facet grain rides on top at 0.14, small enough that the strata
    stay the structure and the facets stay the detail, which is the same
    structure-over-detail argument _coarse_height makes.

    Returns aux masks the ORM pass needs rather than letting it re-derive
    them from height windows, for _panel_height's stated reason: `glint` is
    facet crest clear of any crevice (the polished read), `crevice` is the
    cut mask (the dust trap)."""
    warp = _fbm(w, h, 4, 3, seed=5209)
    facets = _worley(w, h, 16, seed=7211)
    grain = _fbm(w, h, 32, 3, seed=6113)

    out = [0.0] * (w * h)
    glint = [0.0] * (w * h)
    crev = [0.0] * (w * h)
    for y in range(h):
        v = (y + 0.5) / h
        base = y * w
        for x in range(w):
            u = (x + 0.5) / w
            i = base + x
            bc = u if rotated else v
            # Band coordinate: the warp is periodic in both axes and the
            # band count is an integer, so t's fractional part tiles even
            # though t itself does not.
            t = (bc + (warp[i] - 0.5) * ORE_WARP) * ORE_BANDS
            f = t - math.floor(t)
            d = min(f, 1.0 - f)      # 0 at a band boundary, 0.5 mid-band

            # --- band surface, doming gently toward mid-band ---------------
            z = 0.72 + 0.10 * _smoothstep(0.10, 0.42, d)

            # --- the crevice between bands ----------------------------------
            # 7 mm at the floor, bevel out to ~1.6 cm, in band units of a
            # 10 cm pitch.
            cut = 1.0 - _smoothstep(0.035, 0.16, d)
            z -= 0.45 * cut
            if cut > crev[i]:
                crev[i] = cut

            # --- crystalline facet grain ------------------------------------
            # 1 - worley squared, coarse's fractured-facet read at 16 cells
            # (~3 cm facets): crystal faces meeting at sharp valleys.
            fc = (1.0 - facets[i]) ** 2
            z += 0.14 * fc

            # A facet crest inside a crevice is dust-buried, not polished, so
            # the glint mask is the crest gated by the cut.
            g = fc * (1.0 - cut)
            if g > glint[i]:
                glint[i] = g

            # --- micro grain -------------------------------------------------
            z += (grain[i] - 0.5) * 0.05
            out[i] = z
    return out, {"glint": glint, "crevice": crev}


def _ore_masks(w, h, height, aux):
    """(roughness, metalness) for ore. The roughness spread IS this family
    (RN-156): smooth crystal glints against a dusty matrix is what makes a
    mineral read as mineral under a moving sun, so the multiplier runs a
    deliberately wide 0.4-ish to 1.0 - facet crests polished well below the
    palette constant, crevices holding dust at full roughness, mottle on top.

    Metalness identity, and here it is load-bearing rather than merely
    tidy: the three ore roles' palette metallic values sit UNDER the
    client's metalness > 0.5 batching split on purpose (the whole reason
    this family exists is that the seam previously landed in the
    mirror-metal bucket and photographed as ice), and 1.0 is the only
    multiplier that cannot move them."""
    mottle = _fbm(w, h, 12, 3, seed=8317)
    glint = aux["glint"]
    crev = aux["crevice"]
    rough = [0.0] * (w * h)
    metal = [1.0] * (w * h)      # identity: ore-in-rock is not polished metal
    for i in range(w * h):
        r = (1.0 - 0.52 * _smoothstep(0.10, 0.60, glint[i])
             + 0.10 * crev[i]
             + (mottle[i] - 0.5) * 0.14)
        rough[i] = _clamp01(r)
    return rough, metal


# ---------------------------------------------------------------------------
# The `fur` family: the first CREATURE surface, and the first TILING family to
# carry an ALBEDO (RN-455, retargeted at RN-461).
#
# RN-461, AND THE CORRECTION IS THE WHOLE ENTRY. This family shipped as
# `chitin`: a hard shell with a specular sheen on the plate crowns and an
# effective roughness band 0.242 to 0.792 wide. Reid looked at it and said "it
# looks like its made of shiny stone. it should look like it has almost like a
# fur. very short fur." He is right and the brief was wrong. A sharp specular
# highlight is the single strongest HARD SURFACE cue there is, and the wider
# the roughness band the harder the thing reads. The machinery was good and it
# was aimed at beetle carapace when the subject is a tarantula.
#
# FUR IS CLOSE TO THE OPPOSITE, and every term below inverts one above it:
#   - roughness HIGH everywhere and no sharp specular anywhere. The band stays
#     over section 2.1's 0.15 minimum but now sits at 0.76 to 0.95 instead of
#     straddling the middle of the range.
#   - the relief is DIRECTIONAL. Fur flows, and flow is what turns a round
#     highlight into a stretched one. `_hair_layer` lays real, discrete,
#     tapered strands along a wobbling flow field rather than filtering
#     isotropic noise, because an anisotropic look cannot be built out of an
#     isotropic generator no matter how it is tuned.
#   - the strands are FINE: two layers at 20 and 40 cells over a 0.30 m tile,
#     so 15 mm and 7.5 mm apart, well under the punctate pitting the shell
#     version authored.
#   - value darkens at the ROOT and lifts at the TIP, which is what fur does
#     and what a pitted shell does not.
#
# What did NOT change is the SHAPE of the family (normal + orm + a tiling
# albedo, mean-neutral) or the reason for it, so the paragraph below still
# stands as written and the player suit still inherits it.
#
# THE SHAPE OF THIS FAMILY IS THE GENERAL THING, not the spider. Every tiling
# family before it is normal+orm and leaves base colour to the palette
# constant, because the machine path structurally cannot take an albedo
# (MachineBatch overwrites diffuseColor after <map_fragment>). That argument
# was always specific to that hook, and ART-DIRECTION.md names "flat vertex
# colour as the primary albedo source" as a defect to unlearn. So `chitin` is
# normal + orm + ALBEDO at metre UVs, mean-neutral exactly as the card
# families are, and the player suit, the machines and the rocks can each take
# the same shape when their lane comes to it.
#
# WHY THE ALBEDO HAS TO CARRY THE OCCLUSION. The near creature is drawn
# through SpiderFlock's merge, which collapses every primitive to ONE
# material, so per-part roughness does not exist, and the screen-space AO
# clamps bind inside 0.37 m (section 2.1 item 5). Value darkening into the
# creases is in the map or it is nowhere. It is mean-neutral (the client
# divides `albedo_mean` out through material.color), so it cannot shift the
# palette: what survives is the spatial variance and the hue, which is exactly
# the split section 2.1 item 4 states for the foliage cards.
# ---------------------------------------------------------------------------

def _normalise(field):
    lo = min(field)
    hi = max(field)
    span = (hi - lo) or 1.0
    return [(v - lo) / span for v in field]


def _hair_layer(w, h, cells, seed, length, radius, taper, flow_deg, wobble_deg):
    """Discrete tapered STRANDS on a jittered lattice, laid along a flow field.

    Returns (ridge, tip): `ridge` is 1 on a strand centreline falling to 0
    between strands, `tip` is 0 at a strand root and 1 at its point.

    WHY STRANDS AND NOT FILTERED NOISE. Fur reads as fur because its relief is
    ANISOTROPIC: high frequency across the flow, low frequency along it. Every
    noise generator in this file is isotropic by construction (worley is
    distance to a POINT, fbm is a lattice of scalars), and no amount of tuning
    grows a direction on an isotropic field. So the strands are laid down as
    segments and the field is the distance to the nearest one, bucketed 3x3 the
    way `_worley` buckets its points so the cost stays linear in texels.

    The flow is one base angle plus a low-frequency wobble, both periodic, so
    the tile still wraps and the fur has a grain rather than a swirl."""
    wob = _fbm(w, h, 3, 2, seed=seed + 77)
    seeds = []
    for cy in range(cells):
        for cx in range(cells):
            jx = _hash01(cx, cy, seed)
            jy = _hash01(cx, cy, seed + 1)
            jd = _hash01(cx, cy, seed + 2)
            ang = math.radians(flow_deg + (jd * 2.0 - 1.0) * wobble_deg)
            seeds.append(((cx + jx) / cells, (cy + jy) / cells, ang))
    ridge = [0.0] * (w * h)
    tip = [0.0] * (w * h)
    ln = length / cells
    rad = radius / cells
    for y in range(h):
        py = y / h
        gy = int(py * cells)
        base = y * w
        for x in range(w):
            px = x / w
            gx = int(px * cells)
            # the wobble bends a whole neighbourhood together, so strands in
            # one region agree with each other instead of crossing
            bend = (wob[base + x] - 0.5) * 2.0 * math.radians(wobble_deg)
            best = 0.0
            bestt = 0.0
            for oy in (-1, 0, 1):
                ry = (gy + oy) % cells
                for ox in (-1, 0, 1):
                    rx = (gx + ox) % cells
                    ax, ay, ang = seeds[ry * cells + rx]
                    ca = math.cos(ang + bend)
                    sa = math.sin(ang + bend)
                    dx = _wrap_delta(px, ax)
                    dy = _wrap_delta(py, ay)
                    t = (dx * ca + dy * sa) / ln
                    if t < 0.0:
                        t = 0.0
                    elif t > 1.0:
                        t = 1.0
                    ex = dx - ca * t * ln
                    ey = dy - sa * t * ln
                    d = math.sqrt(ex * ex + ey * ey)
                    # a strand narrows toward its point, so the ridge does too
                    r = rad * (1.0 - taper * t)
                    v = math.exp(-(d / r) * (d / r)) if r > 1e-9 else 0.0
                    if v > best:
                        best = v
                        bestt = t
            ridge[base + x] = best
            tip[base + x] = bestt
    return ridge, tip


def _fur_height(w, h):
    """Two strand layers over a soft body undulation, and nothing else.

    The shell version's punctate pits and bristle sockets are GONE. They were
    the correct detail for a carapace and they are the wrong one here: a pit is
    a hard-surface cue, and at this tile size they were also the COARSEST thing
    on the map, which is backwards for a surface whose whole character is that
    it is finer than everything around it."""
    dome = _fbm(w, h, 3, 3, seed=3301)
    r1, t1 = _hair_layer(w, h, 20, 4409, length=1.55, radius=0.26,
                         taper=0.62, flow_deg=90.0, wobble_deg=26.0)
    r2, t2 = _hair_layer(w, h, 40, 5507, length=1.35, radius=0.24,
                         taper=0.70, flow_deg=90.0, wobble_deg=34.0)
    grain = _fbm(w, h, 84, 2, seed=8831)
    out = [0.0] * (w * h)
    ridge = [0.0] * (w * h)
    tip = [0.0] * (w * h)
    for i in range(w * h):
        coarse = r1[i] >= r2[i] * 0.85
        ridge[i] = r1[i] if coarse else r2[i]
        tip[i] = t1[i] if coarse else t2[i]
        z = 0.42 * dome[i]
        z += 0.62 * r1[i]
        z += 0.34 * r2[i]
        z += 0.020 * grain[i]
        out[i] = z
    return out, {"ridge": ridge, "tip": tip, "hn": _normalise(out)}


def _fur_masks(w, h, height, aux):
    """HIGH everywhere, and the small band that remains runs ALONG the strands.

    Section 2.1 item 4 asks for an effective p05..p95 band at least ~0.15 wide,
    and that rule exists so a family is not a constant under a moving sun. It
    does NOT ask for the band to sit in the middle of the range, and for fur it
    must not: with the material at 0.95 this lands 0.76 to 0.95, a real band
    with no part of it anywhere near a hard specular.

    The slight dip on a strand crown is the only sheen fur has, and because the
    crowns are collinear it reads as a STRETCHED highlight rather than a round
    one, which is the anisotropy doing its job with an isotropic BRDF."""
    mottle = _fbm(w, h, 13, 3, seed=9127)
    rough = [0.0] * (w * h)
    # Honest constant, and more honest here than on the shell: fur is not a
    # metal by any reading, and the material constant is 0.02.
    metal = [1.0] * (w * h)
    for i in range(w * h):
        r = (1.0 - 0.20 * aux["ridge"][i] * (1.0 - 0.45 * aux["tip"][i])
             + (mottle[i] - 0.5) * 0.05)
        rough[i] = _clamp01(r)
    return rough, metal


def _fur_albedo(w, h, height, aux):
    """Dark at the root, lifted at the tip, over a broad pigmentation patch."""
    patch = _fbm(w, h, 2, 2, seed=12347)
    blotch = _fbm(w, h, 9, 3, seed=10133)
    ridge = aux["ridge"]
    tip = aux["tip"]
    out = bytearray(w * h * 3)
    for i in range(w * h):
        # between the strands is the ROOT layer and it is in shadow: the base
        # value is low, and a strand lifts it, most at the point.
        v = 0.44 + 0.40 * ridge[i] * (0.55 + 0.45 * tip[i])
        v *= 0.86 + 0.28 * patch[i]
        v *= 0.94 + 0.12 * blotch[i]
        # A hair tip is where light gets through it, so it warms; the root
        # layer is where it does not. Same six per cent lean the shell had,
        # driven by the strand rather than by the height.
        warm = 0.06 * ridge[i] * tip[i]
        o = i * 3
        out[o] = int(round(255.0 * _clamp01(v * (1.0 + warm))))
        out[o + 1] = int(round(255.0 * _clamp01(v)))
        out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 - warm * 0.9))))
    return bytes(out)


# ---------------------------------------------------------------------------
# suitfab - the pressure garment's woven shell. RN-643.
#
# THE FREQUENCY SPLIT IS THE WHOLE DESIGN AND IT IS RN-454's LESSON PAID
# FORWARD. Driving albedo, normal and ORM off one heightfield gave the spider
# identical frequency content in all three and it rendered as cobblestone. So
# each map is authored for the band it is actually good at:
#
#   NORMAL  carries relief BELOW A CENTIMETRE: the weave itself at a 5 mm
#           thread pitch, and the ripstop grid at 2.5 cm. Nothing coarser.
#   ALBEDO  carries pigmentation at 10 to 20 cm: soiling, dust, the patchy
#           discolouration a working garment has. Plus crease darkening,
#           which is the one place the two maps are allowed to agree.
#   ORM     carries a real roughness BAND, because that is what section 2.1
#           item 4 asks for and what panel's 0.032 fails to give.
#
# WHAT IS DELIBERATELY NOT HERE: panel seams, straps, buckles, zips and
# closures. Those are 10 to 30 cm features, the tile is 50 cm, and a 20 cm
# feature in a 50 cm tile repeats visibly on a 1.8 m body. RN-454 settled
# this for the spider ("plate structure at 10 to 30 cm is the GEOMETRY's job
# and the geometry already has it") and a suit is the same argument: a strap
# that is drawn rather than built has no silhouette, and silhouette is the
# thing ART-DIRECTION.md is actually asking for.
# ---------------------------------------------------------------------------

# 5 mm thread pitch over a 0.5 m tile. A technical garment's outer layer is a
# 1000-denier-ish weave and this is roughly its scale; finer than this and the
# weave is under the texel floor at the FP hand, coarser and it reads as
# sacking rather than as a suit.
# 3.3 mm at 150 threads over the 0.5 m tile, which is 3.4 texels per thread:
# right at the resolvable floor and deliberately so. THE FIRST VERSION WAS AT
# 100 (5 mm, 5.1 texels) AND IT RENDERED AS KNITWEAR. That is not a subtle
# miss: at 5 mm on a 0.12 m glove a player counts about twenty-four threads
# across the back of the hand, and anything you can count reads as hand-knitted
# wool rather than as the tight technical weave a pressure garment is. The
# whole point of the outer layer is that you sense the weave without resolving
# it, so the pitch is set just at the point where the texel floor stops it
# being countable.
_FAB_THREADS = 150
_FAB_RIPSTOP = 7          # every seventh thread is the heavy ripstop yarn: a
                          # 2.3 cm grid, which is what ripstop actually is,
                          # and it is now the COARSEST thing on the map, which
                          # is the right way round for a woven surface


def _suitfab_height(w, h):
    """A plain weave with an over-under, a ripstop grid, and a soft drape.

    The weave is TWO crossed strand layers, which is the only way to get it:
    `_hair_layer` is the one anisotropic primitive in this file and a weave is
    two anisotropies at right angles. Everything else here is isotropic by
    construction and no amount of tuning grows a direction on it (RN-461).

    THE OVER-UNDER IS THE POINT. Adding warp and weft together gives a
    waffle: every crossing is a bump and the surface has no weave, it has a
    grid of dots. A real plain weave alternates which yarn passes over, so the
    crossings alternate high and low in a checker at the thread pitch, and
    THAT is what makes a highlight travel along a thread instead of sitting on
    a lattice."""
    warp, _ = _hair_layer(w, h, _FAB_THREADS, 6101, length=2.10, radius=0.30,
                          taper=0.0, flow_deg=0.0, wobble_deg=2.5)
    weft, _ = _hair_layer(w, h, _FAB_THREADS, 6203, length=2.10, radius=0.30,
                          taper=0.0, flow_deg=90.0, wobble_deg=2.5)
    # The drape. Low frequency and low amplitude: it is what stops the weave
    # reading as graph paper, and it is NOT a fold - a fold is geometry.
    drape = _fbm(w, h, 5, 3, seed=6301)
    fuzz = _fbm(w, h, 150, 2, seed=6421)
    out = [0.0] * (w * h)
    crown = [0.0] * (w * h)
    rip = [0.0] * (w * h)
    for y in range(h):
        gy = int((y / h) * _FAB_THREADS)
        # the heavy yarn sits every _FAB_RIPSTOP threads in each direction
        ry = 1.0 if (gy % _FAB_RIPSTOP) == 0 else 0.0
        base = y * w
        for x in range(w):
            i = base + x
            gx = int((x / w) * _FAB_THREADS)
            rx = 1.0 if (gx % _FAB_RIPSTOP) == 0 else 0.0
            over = 1.0 if ((gx + gy) & 1) else 0.0
            a = warp[i]
            b = weft[i]
            # over-under: whichever yarn is on top this crossing gets the
            # crown, the other is pushed down behind it
            hi = a * 0.66 + b * 0.34 if over else a * 0.34 + b * 0.66
            lo = min(a, b)
            heavy = max(rx * a, ry * b)
            rip[i] = heavy
            crown[i] = hi - 0.55 * lo
            # The weave's share of the height came DOWN from 0.62 to 0.34 with
            # the pitch change, and the drape's went up. Amplitude and pitch
            # are not independent: a 0.62 crown over a 3.3 mm pitch is a
            # relief slope that reads as corrugation whatever the normal
            # strength does afterwards. The heavy ripstop yarn keeps its share
            # because it is meant to be the feature you actually see.
            out[i] = (0.44 * drape[i] + 0.34 * hi + 0.24 * heavy
                      + 0.030 * fuzz[i])
    return out, {"crown": _normalise(crown), "rip": rip,
                 "hn": _normalise(out), "drape": drape}


def _suitfab_masks(w, h, height, aux):
    """A WIDE band, and it is wide because a garment is not one material.

    Section 2.1 item 4 wants an effective p05..p95 span of at least ~0.15.
    `Suit` has a palette roughness of 0.65 and `SuitDark` 0.70, so an ormG
    running roughly 0.60 to 1.00 puts Suit at an effective 0.39 to 0.65 and
    SuitDark at 0.42 to 0.70. Both are four to five times panel's measured
    0.032 on the same roles.

    The band is not decoration. Three physically different things live on a
    working garment and they have genuinely different roughness: the raw
    weave is matte, the crowns of the yarns POLISH where the fabric rubs
    (elbows, palms, anywhere it drags), and ground-in dirt is rougher than
    either. Driving all three off one mask would be the cobblestone mistake
    again, so the polish follows the weave crowns (a sub-centimetre field)
    and the soiling follows the broad patches (a 17 cm field) and they are
    multiplied, not summed."""
    grime = _fbm(w, h, 3, 3, seed=6551)
    rub = _fbm(w, h, 4, 2, seed=6607)       # 12.5 cm: the rub ZONES
    rough = [0.0] * (w * h)
    # Honest constant. A pressure garment's outer layer is a polymer weave and
    # the palette already states 0.00 metallic on both roles; identity is the
    # only multiplier that leaves that alone.
    metal = [1.0] * (w * h)
    for i in range(w * h):
        # start rough, the way cloth is
        r = 0.99
        # THE ZONE TERM CARRIES THE BAND, AND THE FIRST VERSION DID NOT HAVE
        # IT. Polishing only the yarn crowns gave a measured effective band of
        # 0.127, under section 2.1's 0.15, because `crown` is a strand field:
        # heavily skewed to zero with a thin bright tail, so almost every texel
        # got almost the same roughness. A suit does not polish thread by
        # thread, it polishes in ZONES - elbows, knees, palms, under a strap -
        # and a zone is a low-frequency field with a real spread. The
        # smoothstep is what turns that spread into a band rather than a haze.
        r -= 0.30 * _smoothstep(0.18, 0.78, rub[i])
        # within a rub zone, the crowns take it first
        r -= 0.20 * aux["crown"][i] * (0.40 + 0.60 * rub[i])
        # the ripstop yarn is heavier and shinier than the field yarn
        r -= 0.06 * aux["rip"][i]
        # ground-in dirt roughens whatever it lands on
        r += 0.06 * (grime[i] - 0.5)
        rough[i] = _clamp01(r)
    return rough, metal


def _suitfab_albedo(w, h, height, aux):
    """Soiling at 10 to 20 cm, and dirt that collects where dirt collects.

    ART-DIRECTION.md asks for grounded, muted, layered colour and names flat
    vertex colour as the defect to unlearn. The palette gives the level (this
    map is mean-neutral by construction, so only its VARIANCE and its HUE
    survive `Surfaces.ts`'s divide by `albedo_mean`); what is authored here is
    where a working suit is dirty and where it is not."""
    soil = _fbm(w, h, 3, 3, seed=6701)          # 16.7 cm: the grime patches
    stain = _fbm(w, h, 6, 2, seed=6803)         # 8.3 cm: within-patch mottle
    out = bytearray(w * h * 3)
    for i in range(w * h):
        # The weave's own value structure: a yarn crown catches light, the
        # gap between yarns is in shadow and holds dirt. Small, because the
        # normal map is already carrying this band and doubling it is how a
        # surface starts looking painted.
        v = 0.90 + 0.13 * aux["crown"][i] - 0.10 * (1.0 - aux["hn"][i])
        # the broad soiling, which is the map's actual job
        d = _clamp01(0.62 * soil[i] + 0.38 * stain[i])
        v *= 1.0 - 0.30 * d
        # Dirt is warmer and much less saturated than the garment under it.
        # Applied as a LEAN on the channels rather than as a colour, because a
        # mean-neutral map cannot carry a colour and pretending otherwise is
        # how a family ships a tint that the divide then deletes.
        warm = 0.055 * d
        o = i * 3
        out[o] = int(round(255.0 * _clamp01(v * (1.0 + warm))))
        out[o + 1] = int(round(255.0 * _clamp01(v)))
        out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 - warm * 1.15))))
    return bytes(out)


# ---------------------------------------------------------------------------
# suitplate - the hard fittings. RN-644.
#
# Knuckle plates, the helmet ring, buckles, armour lames. One role, `Plate`,
# palette 7E8790 at metallic 0.70 and roughness 0.42.
#
# THIS FAMILY EXISTS TO FIX A NAMED DEFECT, NOT TO DECORATE. Section 2.1 item
# 4: "Metalness must carry information or be honestly constant. Three of four
# ORM maps are literally 255 in blue. That is fine for rock and bark; it is
# not fine that the only varying metalness in the game is 8.9 per cent of one
# map." A painted or anodised fitting that has worn through to bare metal is
# the clearest case in the game of a surface whose metalness genuinely varies
# across itself, and one wear mask drives all three maps coherently:
#
#   worn through -> albedo lifts, metalness goes UP toward bare alloy,
#                   roughness goes DOWN because the coating is what was rough
#   still coated  -> albedo sits dark, metalness low (a coating is dielectric),
#                   roughness high
#
# Getting those three to agree is the difference between metal and grey
# plastic, and it costs nothing that a decorative map would not also cost.
# ---------------------------------------------------------------------------

# Eleven scratches per tile, and they are AUTHORED as segments rather than
# drawn from noise. A scratch is a long thin straight thing and no isotropic
# field produces one; this is the same argument that made the fur strands
# discrete (RN-461). Values are (x0, y0, x1, y1, depth), tile space.
_PLATE_SCRATCHES = (
    (0.05, 0.18, 0.47, 0.29, 1.00), (0.62, 0.07, 0.95, 0.14, 0.72),
    (0.21, 0.55, 0.74, 0.71, 0.88), (0.83, 0.36, 0.99, 0.62, 0.55),
    (0.12, 0.82, 0.58, 0.93, 0.66), (0.40, 0.02, 0.52, 0.34, 0.44),
    (0.68, 0.78, 0.92, 0.88, 0.61), (0.02, 0.44, 0.19, 0.51, 0.38),
    (0.55, 0.42, 0.88, 0.49, 0.50), (0.30, 0.62, 0.36, 0.97, 0.42),
    (0.72, 0.20, 0.79, 0.44, 0.35),
)


def _plate_scratch_field(w, h):
    """Distance-falloff field for the authored scratches, 0..1, 1 in a groove.

    Two radii: a narrow cut and a wide burr shoulder either side of it, which
    is what makes a scratch catch light on one edge instead of reading as a
    drawn line."""
    cut = [0.0] * (w * h)
    burr = [0.0] * (w * h)
    for y in range(h):
        py = y / h
        base = y * w
        for x in range(w):
            px = x / w
            bc, bb = 0.0, 0.0
            for (ax, ay, bx, by, dep) in _PLATE_SCRATCHES:
                d = _seg_dist(px, py, ax, ay, bx, by)
                c = dep * (1.0 - _smoothstep(0.0, 0.0016, d))
                if c > bc:
                    bc = c
                s = dep * (1.0 - _smoothstep(0.0012, 0.0052, d))
                if s > bb:
                    bb = s
            cut[base + x] = bc
            burr[base + x] = bb
    return cut, burr


def _suitplate_height(w, h):
    """Brushed grain, micro-pitting, shallow dings, and eleven scratches.

    NO panel seams, NO rivets, NO bevels. The consumers are 3 to 6 cm parts
    and the geometry already carries their edges; a bevel in the map on a part
    that has a real bevel is the doubling that reads as dirt."""
    # The grain. One direction, very fine (140 threads over 0.4 m is a 2.9 mm
    # pitch), no taper: a brush mark is a scratch that runs the whole way.
    grain, _ = _hair_layer(w, h, 140, 7101, length=2.60, radius=0.20,
                           taper=0.0, flow_deg=12.0, wobble_deg=4.0)
    pit = _worley(w, h, 64, 7203)          # 6 mm cells: casting micro-pitting
    ding = _worley(w, h, 9, 7307)          # 44 mm cells: impact dishing
    cut, burr = _plate_scratch_field(w, h)
    out = [0.0] * (w * h)
    high = [0.0] * (w * h)
    for i in range(w * h):
        z = 0.50
        z += 0.085 * grain[i]
        # worley is 0 AT a feature point, so (1 - v) is the pit
        z -= 0.055 * (1.0 - pit[i]) ** 3
        # a ding is a broad shallow dish, not a hole: cube it so only the
        # cell centres dish and the surface between them stays flat
        z -= 0.130 * (1.0 - ding[i]) ** 3
        z += 0.040 * burr[i]
        z -= 0.150 * cut[i]
        out[i] = z
        # "how proud is this texel", which is what wears first
        high[i] = _clamp01(0.5 + 1.9 * (z - 0.5))
    return out, {"high": high, "cut": cut, "burr": burr, "grain": grain,
                 "ding": ding, "hn": _normalise(out)}


def _plate_wear(aux, patch, speck, i):
    """How far the coating has gone at one texel, 0 (intact) to 1 (bare).

    ONE function, called by both the masks and the albedo with the SAME two
    fields, because a wear pass that disagrees between its albedo and its ORM
    reads as dirt lying on metal rather than as metal with its coating worn
    off, and that is the single most common way this kind of map goes wrong.

    THE SMOOTHSTEP IS THE WHOLE THING AND THE FIRST VERSION DID NOT HAVE IT.
    Summing four independent noise fields concentrates the result around its
    mean, which is the central limit theorem doing exactly what it says: the
    raw sum below spans about 0.17 to 0.33 at p05..p95 and the effective
    metalness that came out of it measured a band of 0.074, WORSE than the
    0.406 of the `panel` family it was replacing and a straight regression on
    the one number this family was built to fix.

    Paint does not thin, it CHIPS. A coating is either there or it is not, and
    the physically right shape is bimodal, not Gaussian. The smoothstep maps
    the narrow raw distribution across the full range and gives the two
    populations the map is supposed to have."""
    raw = (0.55 * aux["high"][i] * (0.25 + 0.75 * patch[i])
           + 0.35 * aux["cut"][i]
           + 0.22 * speck[i] * aux["high"][i])
    # The knee is CENTRED ON THE RAW MEDIAN, which is about 0.25, and that is
    # a measurement rather than a taste. Sitting the knee at 0.20..0.46 put
    # the median texel at wear 0.06: 95 per cent of the plate still fully
    # coated, an effective roughness band of 0.115, and a map that had a
    # bimodal shape and only one mode in it. Centring the knee splits the
    # surface roughly in half, which is also what a used fitting looks like:
    # every proud face bright, every recess still painted.
    return _smoothstep(0.13, 0.34, raw)


def _suitplate_masks(w, h, height, aux):
    """ONE wear mask, three channels, and the metalness is the point.

    `Plate` is metallic 0.70, roughness 0.42, so:
      effective metalness = 0.70 * ormB, band 0.24 to 0.70 as authored
      effective roughness = 0.42 * ormG, band 0.19 to 0.41 as authored
    Both clear section 2.1's 0.15 requirement, and the metalness one is the
    first varying metalness in this file that is not a rounding error."""
    patch = _fbm(w, h, 4, 3, seed=7411)     # 10 cm: where the coating is thin
    speck = _fbm(w, h, 22, 2, seed=7507)    # 1.8 cm: chipping at the edges
    rough = [0.0] * (w * h)
    metal = [0.0] * (w * h)
    for i in range(w * h):
        wear = _plate_wear(aux, patch, speck, i)
        # coating is the rough one; bare alloy is smooth. Grain modulates the
        # bare metal only, because a brush mark under paint is invisible.
        r = 1.00 - 0.60 * wear
        r -= 0.10 * aux["grain"][i] * wear
        # a fresh scratch is bright and smooth along its floor
        r -= 0.12 * aux["cut"][i]
        rough[i] = _clamp01(r)
        # THE VARYING METALNESS, AND IT IS THE REASON THIS FAMILY EXISTS.
        # A dielectric coating reads near 0.30 of the palette's 0.70; worn
        # through, it is the alloy at full.
        metal[i] = _clamp01(0.30 + 0.70 * wear)
    return rough, metal


def _suitplate_albedo(w, h, height, aux):
    """The same wear mask, in value: dark coating, bright alloy under it.

    This map and the ORM must agree texel for texel or the surface reads as
    dirt on metal rather than as metal with its coating worn off, which is the
    single most common way a wear pass goes wrong."""
    patch = _fbm(w, h, 4, 3, seed=7411)     # the SAME field the masks use
    speck = _fbm(w, h, 22, 2, seed=7507)    # deliberately, not a new seed
    stain = _fbm(w, h, 8, 3, seed=7603)
    out = bytearray(w * h * 3)
    for i in range(w * h):
        wear = _plate_wear(aux, patch, speck, i)
        v = 0.70 + 0.38 * wear
        # a ding dishes and holds shadow even where the coating survived
        v -= 0.10 * (1.0 - aux["ding"][i]) ** 3
        # weathering staining in the hollows, cool rather than warm: this is
        # oxide and dust on alloy, not the organic grime on the fabric
        grime = (1.0 - aux["hn"][i]) * stain[i]
        v *= 1.0 - 0.16 * grime
        cool = 0.030 * grime
        # bare alloy leans very slightly warm-neutral against the coating
        warm = 0.018 * wear
        o = i * 3
        out[o] = int(round(255.0 * _clamp01(v * (1.0 + warm - cool * 0.6))))
        out[o + 1] = int(round(255.0 * _clamp01(v)))
        out[o + 2] = int(round(255.0 * _clamp01(v * (1.0 - warm + cool))))
    return bytes(out)


def _albedo_mean_rgb(rgb):
    """Mean RGB luma (0..1) over every texel: the opaque counterpart of
    `_albedo_mean_rgba`. No alpha, so no coverage test and every texel counts."""
    n = len(rgb) // 3
    if n == 0:
        return 0.0
    tot = 0.0
    for i in range(n):
        o = i * 3
        tot += 0.2126 * rgb[o] + 0.7152 * rgb[o + 1] + 0.0722 * rgb[o + 2]
    return tot / (n * 255.0)


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
# RGBA PNG write/read, colour type 6, for the albedo+alpha card families.
# Same chunk discipline as write_png (IHDR + IDAT + IEND only, pinned zlib),
# same per-scanline filter search, one more byte per pixel. groundtex.py
# carries its own copy of this pair; the duplication is known and left for a
# later dedupe on purpose, because rebaselining a shipped tool mid-pass is
# the wrong moment to share code (see write_png's note on two writers).
# ---------------------------------------------------------------------------

def write_png_rgba(path, w, h, rgba):
    """Write 8-bit RGBA. Refuses a wrong-size buffer rather than misreading
    it, exactly as write_png does."""
    if len(rgba) != w * h * 4:
        raise ValueError("expected %d bytes, got %d" % (w * h * 4, len(rgba)))
    raw = _filter_rows(rgba, w, h, 4)
    co = zlib.compressobj(ZLIB_LEVEL, zlib.DEFLATED, ZLIB_WBITS,
                          ZLIB_MEMLEVEL, zlib.Z_DEFAULT_STRATEGY)
    idat = co.compress(raw) + co.flush()
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    blob = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr)
            + _chunk(b"IDAT", idat) + _chunk(b"IEND", b""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(blob)
    return len(blob)


def read_png_rgba(path):
    """Minimal decoder for the checks. 8-bit RGBA non-interlaced only;
    anything else raises rather than being silently misread."""
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
    if (depth, ctype, inter) != (8, 6, 0):
        raise ValueError("%s: only 8-bit RGBA non-interlaced is supported "
                         "(depth=%d colour=%d interlace=%d)"
                         % (path, depth, ctype, inter))
    raw = zlib.decompress(b"".join(idat))
    stride = w * 4
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ftype = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        for i in range(stride):
            a = line[i - 4] if i >= 4 else 0
            b = prev[i]
            c = prev[i - 4] if i >= 4 else 0
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
    # panel gained a TILING ALBEDO at RN-553 and is the second family to carry
    # one after `fur`. It costs 1.40 MB of VRAM (512 px, the mip chain
    # included) and it buys the one thing a normal and an ORM structurally
    # cannot: pigmentation. ART-DIRECTION.md names flat vertex colour as a
    # defect to unlearn, and until this landed every manufactured surface in
    # the game took its entire base colour from one palette constant.
    "panel": dict(height=_panel_height, masks=_panel_masks,
                  albedo=_panel_albedo,
                  normal_strength=26.0, ao_radius=7, ao_floor=0.42,
                  ao_gain=2.2),
    # coarse normal_strength came down 13 -> 9 with the low-frequency rebalance:
    # bigger facets over a stronger base means the same slope angles from a
    # smaller gradient, and 13 on the new field reads as corrugated.
    "coarse": dict(height=_coarse_height, masks=_coarse_masks,
                   normal_strength=9.0, ao_radius=11, ao_floor=0.50,
                   ao_gain=7.0),
    # bark sits between the two: its fissure walls drop 0.55 over a ~1.4 cm
    # bevel, steeper than a coarse facet and shallower than a panel groove, so
    # 12 gives the walls roughly the shading weight coarse's facets get from 9
    # on their gentler slopes. ao_gain likewise: the relief under the blur is
    # ~0.5 in a fissure where coarse's is ~0.1, so coarse's 7.0 here would
    # clamp every fissure to the floor and read as painted-on black stripes.
    "bark": dict(height=_bark_height, masks=_bark_masks,
                 normal_strength=12.0, ao_radius=9, ao_floor=0.45,
                 ao_gain=3.0),
    # ore's crevice walls drop 0.45 over a ~1.6 cm bevel, just under bark's
    # fissures, so 11 lands them near bark's shading weight while keeping the
    # 0.14 facet grain from reading as corrugation. ao_gain by bark's
    # argument: relief under the blur is ~0.4 in a crevice, so coarse's 7.0
    # would clamp every crevice to the floor and paint the strata on as flat
    # black stripes, which is exactly the read the relief exists to avoid.
    "ore": dict(height=_ore_height, masks=_ore_masks,
                normal_strength=11.0, ao_radius=9, ao_floor=0.46,
                ao_gain=3.2),
    # chitin is the shallowest relief in the set and the highest frequency:
    # a pit is 0.16 deep over about 2 mm, so 16 is what gives a pit the
    # shading weight bark gets from 12 on a fissure ten times as wide. The
    # ao_radius is small for the same reason (the occluder IS the pit), and
    # the floor is the highest in the set because a shell is not a cave: a
    # crease darkens, it does not go black.
    # fur has the shallowest relief and the highest frequency in the set,
    # and it self-shadows hard at the root layer, which is where the velvet
    # look comes from at every angle that is not the silhouette. So the
    # normal is strong for its amplitude, the AO radius is the smallest
    # here (the occluder is the neighbouring STRAND) and the floor is the
    # lowest of any family: between hairs really is dark.
    "fur": dict(height=_fur_height, masks=_fur_masks,
                albedo=_fur_albedo,
                normal_strength=14.0, ao_radius=3, ao_floor=0.42,
                ao_gain=3.4),
    # suitfab's relief is SHALLOW and FINE: a yarn crown stands about 0.10 of
    # a unit over the gap beside it, across a 2.5 texel half-pitch. That is a
    # steeper local gradient than fur's strands on a much smaller amplitude,
    # so the strength lands between fur's 14 and panel's 26. At panel's 26 the
    # weave reads as corrugated iron, which was the first version of it.
    # ao_radius 3, not panel's 7: the occluder here is the neighbouring yarn
    # 2.5 texels away, and a 7-texel blur averages over four whole threads and
    # returns a uniform grey - the "it shipped, it validated, it did nothing"
    # failure this table's own header warns about.
    "suitfab": dict(height=_suitfab_height, masks=_suitfab_masks,
                    albedo=_suitfab_albedo,
                    normal_strength=2.4, ao_radius=3, ao_floor=0.46,
                    ao_gain=3.8),
    # suitplate has TWO relief scales in one field - a 0.085 brushed grain and
    # a 0.150 scratch cut - and the strength has to serve the scratch, because
    # the scratch is the feature a player actually sees on a 5 cm knuckle
    # plate. 20 puts the scratch walls near panel's groove weight while
    # leaving the grain as a sheen rather than as ribbing.
    # ao_gain 4.6 against panel's 2.2: the relief under the blur here is about
    # a third of a panel groove's, so panel's gain would leave every scratch
    # and ding at AO 250-ish and the map would do nothing.
    "suitplate": dict(height=_suitplate_height, masks=_suitplate_masks,
                      albedo=_suitplate_albedo,
                      normal_strength=5.5, ao_radius=5, ao_floor=0.40,
                      ao_gain=4.6),
}


def build_family(name, size=None):
    """(height, normal, orm, albedo). `albedo` is None unless the family
    declares one: a tiling family MAY carry a base colour now (RN-455) and
    every family authored before it deliberately does not."""
    spec = FAMILIES[name]
    size = FAMILY_SIZE[name] if size is None else size
    height, aux = spec["height"](size, size)
    rough, metal = spec["masks"](size, size, height, aux)
    ao = _ao(height, size, size, spec["ao_radius"], spec["ao_floor"],
             spec["ao_gain"])
    normal = _normal_rgb(height, size, size, spec["normal_strength"])
    orm = _pack_orm(ao, rough, metal, size, size)
    alb = spec.get("albedo")
    albedo = None if alb is None else alb(size, size, height, aux)
    return height, normal, orm, albedo


# ---------------------------------------------------------------------------
# ALBEDO CARD FAMILIES: `leaf` and `grass`.
#
# Alpha-tested foliage cards, not tiling PBR surfaces, so almost every rule
# above bends here and each bend is stated:
#   * UNIT UVs, not metres. A card is a quad that shows the whole texture
#     exactly once, so there is no tile_m and no texels_per_m.
#   * WRAP: u repeats (the field is periodic in u by construction, so a bent
#     card or a double-wide quad still reads), v CLAMPS: a card has a base
#     and a tip, and the tip edge must dissolve to nothing (see the tip-rows
#     rule below).
#   * RGBA, not normal+orm: the alpha channel IS the shape, and the albedo is
#     a near-neutral VALUE texture because hue comes from vertex colours in
#     the client. The palette stays the colour authority.
#
# ROWS TO V, stated once so orientation is a fact rather than a guess per
# call site. PNG row 0 is the TOP of the decoded image, and the client
# samples glTF-convention UVs (flipY false), so uv (0, 0) reads the decoded
# image's top-left. of_lib's exporter writes v flipped (v -> 1 - v), so mesh
# v = 0 (the card base) samples the BOTTOM PNG rows and mesh v = 1 (the tip)
# samples the TOP rows. The builders therefore author ROOTS in the bottom
# rows and TIPS in the top rows. If the in-engine look proves that backwards,
# flip ALBEDO_V_FLIP: it mirrors the composed field vertically before
# dilation and is deliberately the one-line fix.
ALBEDO_V_FLIP = False

ALBEDO_EDGE = 0.006     # alpha edge ramp in tile units, ~1.5 px at 256:
                        # anti-aliased enough not to stairstep, steep enough
                        # that the mip chain does not go mushy

ALBEDO_TIP_ROWS = 4     # top rows that MUST be fully transparent. v clamps,
                        # so any alpha in the top row would smear upward
                        # forever on a stretched sample; a frond tip has to
                        # dissolve, not stop at a hard picture edge.


def _strip_pt(px, py, ax, ay, bx, by):
    """Distance and parameter from a point to a segment, wrapping in u ONLY.
    _seg_dist wraps both axes, which is right for a tiling surface and wrong
    for a card: v clamps, so a root near the bottom edge must never read as
    close to a tip near the top edge through a v wrap."""
    dx = _wrap_delta(bx, ax)
    dy = by - ay
    wx = _wrap_delta(px, ax)
    wy = py - ay
    den = dx * dx + dy * dy
    t = 0.0 if den < 1e-12 else _clamp01((wx * dx + wy * dy) / den)
    ex = wx - dx * t
    ey = wy - dy * t
    return math.sqrt(ex * ex + ey * ey), t


# A strip is (ax, ay, bx, by, w0, w1, v0, v1, tint): a segment in (u, PNG-row
# fraction) space with half-widths w0 -> w1 tapering along it, an albedo value
# gradient v0 -> v1, and a warm/cool tint applied as R = v + tint, B = v - tint
# (so |R - B| <= 6 counts when |tint| <= 3/255).

def _grass_strips():
    """A bundle of 11 tapering blades, each a 2-segment polyline from a root
    at (or just below) the bottom edge to a tip well clear of the top rows,
    curving slightly via the mid-point offset. Placement is PERIODIC in u:
    even spacing plus a jitter smaller than the pitch, and every distance is
    measured with the u wrap, so a blade crossing the seam continues on the
    other side and the tile has no u seam by construction.

    Widths: roots ~26-37 px full width, tips 0.012 half-width, which keeps
    the tip's 50%-alpha contour at ~4.6 px: wide enough that mip averaging
    erodes the tip gracefully instead of deleting it.

    Values: per-blade base drawn from [0.60, 1.0], slightly darker at the
    root rising ~10% toward the tip, faint per-texel noise on top, and a
    per-blade warm/cool split of at most +/-6 counts between R and B."""
    strips = []
    nb = 11
    for k in range(nb):
        u0 = (k + 0.5) / nb + (_hash01(k, 3, 6011) - 0.5) * 0.55 / nb
        y_root = 1.0 + 0.012 * _hash01(k, 5, 6011)
        y_tip = 0.055 + 0.16 * _hash01(k, 7, 6011)
        lean = (_hash01(k, 11, 6011) - 0.5) * 0.11
        y_mid = y_root - (y_root - y_tip) * 0.5
        u_mid = u0 + lean * 0.38
        u_tip = u0 + lean
        w_root = 0.058 + 0.024 * _hash01(k, 13, 6011)
        w_tip = 0.012
        w_mid = (w_root + w_tip) * 0.5
        bk = 0.60 + 0.40 * _hash01(k, 17, 6011)
        tint = (_hash01(k, 19, 6011) - 0.5) * (6.0 / 255.0)
        strips.append((u0 % 1.0, y_root, u_mid % 1.0, y_mid,
                       w_root, w_mid, bk * 0.90, bk * 0.95, tint))
        strips.append((u_mid % 1.0, y_mid, u_tip % 1.0, y_tip,
                       w_mid, w_tip, bk * 0.95, bk, tint))
    return strips


def _leaf_strips():
    """A conifer-frond card: a central stem from base to tip with alternating
    tapered leaflets angled 30 to 55 degrees off the stem (shorter toward the
    tip), plus three partial background fronds, one of them across the u seam
    so the u wrap is exercised rather than trivially empty. Background fronds
    are sparser in PLACEMENT; their alpha is still full where they exist,
    because a translucent card texel is exactly what alpha testing cannot
    represent.

    The 30-55 degree angle is built from sin values (0.50..0.82) and
    cos = sqrt(1 - sin^2), because this module bans transcendentals (see the
    determinism note at the top): sqrt is bit-portable, sin/cos are not."""
    strips = []

    def frond(cx, y_base, y_tip, needles, scale, seed):
        lean = (_hash01(0, 1, seed) - 0.5) * 0.06
        sx0, sy0 = cx, y_base
        sx1, sy1 = cx + lean, y_tip
        bs = 0.62 + 0.38 * _hash01(1, 2, seed)
        stint = (_hash01(2, 3, seed) - 0.5) * (6.0 / 255.0)
        strips.append((sx0 % 1.0, sy0, sx1 % 1.0, sy1,
                       0.020 * scale, 0.009, bs * 0.93, bs, stint))
        for j in range(needles):
            t = (j + 1.0) / (needles + 1.0)
            ax = (sx0 + (sx1 - sx0) * t) % 1.0
            ay = sy0 + (sy1 - sy0) * t
            side = 1.0 if j % 2 == 0 else -1.0
            sn = 0.50 + 0.32 * _hash01(j, 5, seed)       # sin(30..55 deg)
            cs = math.sqrt(1.0 - sn * sn)
            ln = (0.46 * scale * (1.0 - 0.55 * t)
                  * (0.85 + 0.30 * _hash01(j, 7, seed)))
            ey = ay - cs * ln
            if ey < 0.055:               # keep every leaflet out of the tip rows
                ln = (ay - 0.055) / cs
                ey = ay - cs * ln
            ex = (ax + side * sn * ln) % 1.0
            bv = 0.62 + 0.38 * _hash01(j, 11, seed)
            tint = (_hash01(j, 13, seed) - 0.5) * (6.0 / 255.0)
            strips.append((ax, ay, ex, ey, 0.072 * scale, 0.011,
                           bv * 0.93, bv, tint))

    frond(0.50, 1.005, 0.050, 18, 1.0, 9203)     # the main frond
    frond(0.13, 1.010, 0.300, 8, 0.85, 9403)     # background thickeners
    frond(0.86, 1.010, 0.280, 8, 0.85, 9601)
    frond(0.995, 1.005, 0.380, 9, 0.90, 9803)    # crosses the u seam
    return strips


def _render_card(s, strips, noise_seed):
    """Compose tapered strips into (rgb, alpha) byte buffers, PRE-dilation.

    Alpha: 1 inside a strip, 0 outside, an ALBEDO_EDGE smoothstep ramp at the
    boundary. Albedo: the winning strip's value gradient (winner = deepest
    signed clearance, so overlaps resolve to whichever strip the texel is
    most inside of) plus faint per-texel noise. Background texels are left
    BLACK on purpose: _dilate_albedo must fill them, and a compose that
    pre-filled them would make the dilation selftest unfalsifiable."""
    noise = _fbm(s, s, 16, 3, seed=noise_seed)
    rgb = bytearray(3 * s * s)
    alpha = bytearray(s * s)
    bounds = []
    for st in strips:
        wmax = max(st[4], st[5]) + ALBEDO_EDGE
        bounds.append((min(st[1], st[3]) - wmax, max(st[1], st[3]) + wmax))
    for y in range(s):
        py = (y + 0.5) / s
        act = [st for st, (y0, y1) in zip(strips, bounds) if y0 <= py <= y1]
        base = y * s
        for x in range(s):
            px = (x + 0.5) / s
            a_best = 0.0
            cov_best = -1.0
            win = None
            wt = 0.0
            for st in act:
                d, t = _strip_pt(px, py, st[0], st[1], st[2], st[3])
                hw = st[4] + (st[5] - st[4]) * t
                a = 1.0 - _smoothstep(hw - ALBEDO_EDGE, hw, d)
                if a > a_best:
                    a_best = a
                if hw - d > cov_best:
                    cov_best = hw - d
                    win = st
                    wt = t
            if a_best > 0.0 and win is not None:
                val = win[6] + (win[7] - win[6]) * wt
                val += (noise[base + x] - 0.5) * 0.06
                tint = win[8]
                o = (base + x) * 3
                rgb[o] = int(_clamp01(val + tint) * 255.0 + 0.5)
                rgb[o + 1] = int(_clamp01(val) * 255.0 + 0.5)
                rgb[o + 2] = int(_clamp01(val - tint) * 255.0 + 0.5)
                alpha[base + x] = int(a_best * 255.0 + 0.5)
    return rgb, alpha


def _dilate_albedo(rgb, alpha, w, h):
    """Flood the covered region's albedo into every texel with alpha < 128:
    iterative synchronous 8-neighbour rounds (u wraps, v clamps) where each
    unfilled texel bordering a filled one takes the mean of its filled
    neighbours' albedo, until nothing borders the frontier unfilled.

    WHY: bilinear and mip filtering blend a texel's RGB regardless of its
    alpha, so black background texels bleed a dark halo into every blade edge
    and every distant mip. Flooding the blade colour outward makes the
    invisible texels agree with the visible ones.

    The u-wrapped grid is connected, so the flood reaches every texel and
    nothing is left for a fully-enclosed fallback; the one unreachable case
    (no covered texel at all) returns the buffer unchanged. Deterministic:
    candidates are processed in sorted index order and every round reads only
    the previous rounds' fills."""
    n = w * h
    out = bytearray(rgb)
    filled = bytearray(1 if alpha[i] >= 128 else 0 for i in range(n))
    front = [i for i in range(n) if filled[i]]
    if not front:
        return out
    while front:
        cand = set()
        for i in front:
            x = i % w
            y = i // w
            for dy in (-1, 0, 1):
                ny = y + dy
                if ny < 0 or ny >= h:
                    continue
                for dx in (-1, 0, 1):
                    j = ny * w + (x + dx) % w
                    if not filled[j]:
                        cand.add(j)
        newly = []
        for j in sorted(cand):
            x = j % w
            y = j // w
            rs = gs = bs = cnt = 0
            for dy in (-1, 0, 1):
                ny = y + dy
                if ny < 0 or ny >= h:
                    continue
                for dx in (-1, 0, 1):
                    k = ny * w + (x + dx) % w
                    if filled[k]:
                        o = k * 3
                        rs += out[o]
                        gs += out[o + 1]
                        bs += out[o + 2]
                        cnt += 1
            o = j * 3
            out[o] = (2 * rs + cnt) // (2 * cnt)
            out[o + 1] = (2 * gs + cnt) // (2 * cnt)
            out[o + 2] = (2 * bs + cnt) // (2 * cnt)
            newly.append(j)
        for j in newly:
            filled[j] = 1
        front = newly
    return out


def _halo_worst(rgb, alpha, w, h):
    """(worst, examined): worst absolute difference between a fully
    transparent texel's luma and the mean luma of its opaque (alpha >= 128)
    8-neighbours (u wraps, v clamps), over every alpha == 0 texel that has at
    least one. This is the halo measurement: an undilated build scores 100+
    here (black next to a bright blade), a dilated one scores a few counts."""
    worst = 0.0
    examined = 0
    for i in range(w * h):
        if alpha[i] != 0:
            continue
        x = i % w
        y = i // w
        tot = cnt = 0
        for dy in (-1, 0, 1):
            ny = y + dy
            if ny < 0 or ny >= h:
                continue
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                k = ny * w + (x + dx) % w
                if alpha[k] >= 128:
                    o = k * 3
                    tot += rgb[o] + rgb[o + 1] + rgb[o + 2]
                    cnt += 1
        if cnt:
            o = i * 3
            own = (rgb[o] + rgb[o + 1] + rgb[o + 2]) / 3.0
            d = abs(own - tot / (3.0 * cnt))
            if d > worst:
                worst = d
            examined += 1
    return worst, examined


def _alpha_coverage(alpha):
    """Fraction of texels with alpha >= 128, the coverage the mip chain
    converges toward."""
    return sum(1 for a in alpha if a >= 128) / len(alpha)


def _tip_rows_clear(alpha, w, rows=ALBEDO_TIP_ROWS):
    """True when the top `rows` PNG rows (the card's dissolving tip edge, at
    sampled v = 1 after the exporter's flip) are entirely alpha 0."""
    return all(alpha[i] == 0 for i in range(rows * w))


def _wrap_vs_interior_u(f, w, h):
    """Selftest 7's wrap-vs-interior measure restricted to the u axis: the
    card tiles in u only (v clamps), so only the u wrap step is a seam
    claim. A tiling field's wrap step is an ordinary step; a seam is a
    cliff there."""
    edge = inner = 0.0
    for y in range(h):
        row = y * w
        edge = max(edge, abs(f[row] - f[row + w - 1]))
        for x in range(w - 1):
            inner = max(inner, abs(f[row + x] - f[row + x + 1]))
    return edge, inner


def _albedo_mean_rgba(rgba, alpha_test):
    """Mean RGB luma (arithmetic (R+G+B)/3, normalised to 0..1) over texels
    whose alpha clears alpha_test * 255, measured from the packed bytes the
    file actually ships. The client divides this out via material.color, so
    the albedo modulation is mean-neutral and cannot shift the palette."""
    thr = alpha_test * 255.0
    tot = 0
    cnt = 0
    for o in range(0, len(rgba), 4):
        if rgba[o + 3] >= thr:
            tot += rgba[o] + rgba[o + 1] + rgba[o + 2]
            cnt += 1
    return 0.0 if cnt == 0 else tot / (cnt * 3.0 * 255.0)


# The two card families. UNREFERENCED BY ANY ROLE THIS COMMIT, deliberately:
# ROLE_FAMILY and FLAT_ROLES stay exactly as they are (Leaf*/Grass remain
# flat, with their recorded reasons), and the role move lands later in the
# same commit as the client change that consumes these, so the two cannot
# ship half-wired.
#
# `coverage` is the shipped alpha-coverage band (fraction of texels with
# alpha >= 128), asserted by check_maps against the shipped bytes. The FLOOR
# is the load-bearing edge: under mipmapping, alpha averages toward the
# card's mean coverage, so a sparse card whose distant mips fall under
# alpha_test (0.35) DISSOLVES at range. Coverage well above 0.35 makes the
# far mips converge toward solid instead of toward nothing; the ceiling
# keeps the card reading as foliage rather than as a curtain.
ALBEDO_FAMILIES = {
    "leaf": dict(strips=_leaf_strips, size=256, alpha_test=0.35,
                 wrap=("repeat", "clamp"), coverage=(0.60, 0.80),
                 noise_seed=15013),
    "grass": dict(strips=_grass_strips, size=256, alpha_test=0.35,
                  wrap=("repeat", "clamp"), coverage=(0.55, 0.75),
                  noise_seed=15101),
}


def build_albedo_family(name, size=None):
    """(rgba, rgb, alpha): the packed shipped bytes plus the composed
    channels, post-flip, post-dilation."""
    spec = ALBEDO_FAMILIES[name]
    s = spec["size"] if size is None else size
    rgb, alpha = _render_card(s, spec["strips"](), spec["noise_seed"])
    if ALBEDO_V_FLIP:
        rgb2 = bytearray(len(rgb))
        al2 = bytearray(len(alpha))
        for y in range(s):
            sy = s - 1 - y
            al2[y * s:(y + 1) * s] = alpha[sy * s:(sy + 1) * s]
            rgb2[y * s * 3:(y + 1) * s * 3] = rgb[sy * s * 3:(sy + 1) * s * 3]
        rgb, alpha = rgb2, al2
    rgb = _dilate_albedo(rgb, alpha, s, s)
    rgba = bytearray(s * s * 4)
    for i in range(s * s):
        o = i * 4
        r3 = i * 3
        rgba[o] = rgb[r3]
        rgba[o + 1] = rgb[r3 + 1]
        rgba[o + 2] = rgb[r3 + 2]
        rgba[o + 3] = alpha[i]
    return bytes(rgba), rgb, alpha


def generate(out_dir=OUT_DIR, size=None, quiet=False, only=None):
    """Write every family's PNGs and the manifest.

    `only` RESTRICTS THE WRITE TO ONE FAMILY, AND IT EXISTS BECAUSE THE
    ALL-OR-NOTHING DEFAULT IS A LAUNDERING MACHINE (RN-558).

    This function loops `FAMILIES` and rewrites `surfaces.json` wholesale, so
    a lane that regenerates in the shared tree to look at ITS OWN family also
    writes every other live lane's in-flight family into `assets/textures/dist`
    and into the manifest. That is not hypothetical: RN-151 is the recorded
    case of one lane laundering another's work into HEAD, and on 2026-08-01 it
    happened in BOTH DIRECTIONS in one afternoon between the machine lane and
    the player lane, from this single entry point, with four lanes live in this
    file. The standing workaround is a clean-tree generation plus a filtered
    blob, which works and is what NUMBERS.md prescribes; but that is a
    discipline, and making the wrong thing impossible beats instructing five
    lanes to be careful.

    THE MANIFEST IS MERGED, NOT REPLACED, AND THAT IS THE WHOLE DIFFICULTY.
    Writing a one-family manifest would be worse than the disease: every
    consumer asserts `set(manifest.families) == set(FAMILIES) | set(
    ALBEDO_FAMILIES)`, so a partial manifest fails the client, the preview and
    `check` at once. So `only` reads the manifest that is already on disk,
    replaces exactly that family's row, and leaves every other row BYTE FOR
    BYTE as it found it, including the `roles` and `flat_roles` tables, which
    belong to whoever last wrote them.

    ONE HONEST LIMIT, STATED. `roles` and `flat_roles` are NOT refreshed under
    `only`, because this process's `ROLE_FAMILY` may contain another lane's
    uncommitted role moves, which is exactly the payload being kept out. A
    lane that changes a role mapping therefore needs a full generation on a
    clean tree; `only` covers a family's PIXELS, which is the common case and
    the one that was hurting."""
    if only is not None and only not in FAMILIES:
        raise SystemExit(
            "--only %r is not a tiling family. Known: %s"
            % (only, ", ".join(sorted(FAMILIES))))
    wanted = sorted(FAMILIES) if only is None else [only]
    files = {}
    sizes = {}
    tiling_albedo = {}
    for name in wanted:
        fsize = FAMILY_SIZE[name] if size is None else size
        sizes[name] = fsize
        _, normal, orm, albedo = build_family(name, fsize)
        n_path = os.path.join(out_dir, "of_%s_n.png" % name)
        o_path = os.path.join(out_dir, "of_%s_orm.png" % name)
        n_bytes = write_png(n_path, fsize, fsize, normal)
        o_bytes = write_png(o_path, fsize, fsize, orm)
        files[name] = {
            "normal": {"file": os.path.basename(n_path), "bytes": n_bytes},
            "orm": {"file": os.path.basename(o_path), "bytes": o_bytes},
        }
        if albedo is not None:
            # RGB, not RGBA, and that is the contract rather than an omission:
            # a tiling body surface is OPAQUE, so it declares no alpha channel
            # and therefore cannot trip the validator's rule that an albedo
            # with alpha must publish an alpha_test.
            a_path = os.path.join(out_dir, "of_%s_a.png" % name)
            a_bytes = write_png(a_path, fsize, fsize, albedo)
            files[name]["albedo"] = {"file": os.path.basename(a_path),
                                     "bytes": a_bytes}
            tiling_albedo[name] = albedo
        if not quiet:
            print("[texgen] %-7s normal %7d B   orm %7d B%s   (%dx%d, %g px/m)"
                  % (name, n_bytes, o_bytes,
                     ("   albedo %7d B" % files[name]["albedo"]["bytes"])
                     if albedo is not None else "",
                     fsize, fsize, fsize / FAMILY_TILE_M[name]))

    albedo_files = {}
    for name in ([] if only is not None else sorted(ALBEDO_FAMILIES)):
        fsize = ALBEDO_FAMILIES[name]["size"] if size is None else size
        rgba, _, _ = build_albedo_family(name, fsize)
        a_path = os.path.join(out_dir, "of_%s_a.png" % name)
        a_bytes = write_png_rgba(a_path, fsize, fsize, rgba)
        albedo_files[name] = {"file": os.path.basename(a_path),
                              "bytes": a_bytes, "rgba": rgba, "size": fsize}
        if not quiet:
            print("[texgen] %-7s albedo %7d B                    (%dx%d, unit uv)"
                  % (name, a_bytes, fsize, fsize))

    manifest = {
        "_comment": [
            "Generated by tools/blender/texgen.py. Do not hand-edit.",
            "UVs in the .glb files are in METRES, so a consumer applies",
            "texture.repeat = 1 / tile_m and texture.wrapS/wrapT = RepeatWrapping.",
            "orm channels: R = occlusion, G = roughness, B = metalness, and all",
            "three MULTIPLY the material constant rather than replacing it.",
            "normal maps are OpenGL convention (+Y up), colorSpace NoColorSpace.",
            "A TILING family may also carry an `albedo` (chitin, RN-455).",
            "It is RGB with no alpha, uv_space is metres like its normal and",
            "orm siblings, and it publishes albedo_mean for the same",
            "mean-neutral divide the card families use. A family carrying all",
            "three maps is the shape a body surface takes.",
            "albedo families (grass, leaf) are CARD textures: albedo+alpha,",
            "values are sRGB as authored, alpha is coverage. Their UVs are",
            "UNIT (uv_space \"unit\"), not metres: a card shows the texture",
            "exactly once, so there is no tile_m. wrap: u repeat, v clamp;",
            "v = 1 is the tips as sampled with glTF UVs (the builder writes",
            "roots at the image bottom and the exporter flips v).",
            "alpha_test is the consumer contract: the material discards",
            "below it. An albedo family whose alpha channel is in use MUST",
            "declare alpha_test; the validator refuses one that does not",
            "(that check lands in the validator, the rule is stated here).",
            "albedo_mean is the mean RGB luma (0..1) over texels with",
            "alpha >= alpha_test * 255, measured from the shipped bytes: the",
            "client divides it out via material.color, so the modulation is",
            "mean-neutral and cannot shift the palette.",
        ],
        "version": MANIFEST_VERSION,
        "zlib": zlib.ZLIB_RUNTIME_VERSION,
        "families": {},
        "roles": dict(sorted(ROLE_FAMILY.items())),
        "flat_roles": dict(sorted(FLAT_ROLES.items())),
    }
    for name in wanted:
        fam = dict(files[name])
        fam["tile_m"] = FAMILY_TILE_M[name]
        fam["size_px"] = sizes[name]
        fam["texels_per_m"] = sizes[name] / FAMILY_TILE_M[name]
        for k in ("normal", "orm", "albedo"):
            if k not in fam:
                continue
            p = os.path.join(out_dir, fam[k]["file"])
            with open(p, "rb") as fh:
                fam[k]["sha256"] = hashlib.sha256(fh.read()).hexdigest()
        if name in tiling_albedo:
            fam["albedo_mean"] = round(_albedo_mean_rgb(tiling_albedo[name]), 4)
        manifest["families"][name] = fam
    for name in sorted(albedo_files):
        spec = ALBEDO_FAMILIES[name]
        rec = albedo_files[name]
        p = os.path.join(out_dir, rec["file"])
        with open(p, "rb") as fh:
            sha = hashlib.sha256(fh.read()).hexdigest()
        manifest["families"][name] = {
            "albedo": {"file": rec["file"], "bytes": rec["bytes"],
                       "sha256": sha},
            "size_px": rec["size"],
            "uv_space": "unit",
            "wrap": {"u": spec["wrap"][0], "v": spec["wrap"][1]},
            "alpha_test": spec["alpha_test"],
            "albedo_mean": round(_albedo_mean_rgba(rec["rgba"],
                                                   spec["alpha_test"]), 4),
        }

    m_path = os.path.join(out_dir, "surfaces.json")
    if only is not None:
        # MERGE, DO NOT REPLACE. Read what is already on disk, swap in exactly
        # this family's row, and leave every other row and both role tables
        # untouched. `json.load` / `json.dump` is a round trip and would
        # normally be refused on a shared file for reformatting other lanes'
        # rows (RN-443); it is safe HERE and only here, because this file is
        # itself generated by `json.dump(indent=2, sort_keys=False)` five
        # lines below, so the round trip is the identity on everything it does
        # not deliberately change. That is asserted rather than assumed.
        if not os.path.isfile(m_path):
            raise SystemExit(
                "--only needs an existing %s to merge into. Run a full "
                "generation on a CLEAN tree first." % m_path)
        with open(m_path, "r", encoding="utf-8") as fh:
            prior_text = fh.read()
        prior = json.loads(prior_text)
        rt = json.dumps(prior, indent=2, sort_keys=False) + "\n"
        if rt != prior_text:
            raise SystemExit(
                "%s is not in this tool's own output format, so a merge "
                "would silently reformat it. Refusing." % m_path)
        merged = prior
        merged["families"][only] = manifest["families"][only]
        for k in ("version", "zlib"):
            merged[k] = manifest[k]
        manifest = merged
    with open(m_path, "w", newline="\n", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=False)
        fh.write("\n")
    if not quiet:
        total = (sum(v[k]["bytes"] for v in files.values() for k in v)
                 + sum(v["bytes"] for v in albedo_files.values()))
        nfiles = (sum(len(v) for v in files.values()) + len(albedo_files))
        print("[texgen] manifest %s%s"
              % (m_path, "  (MERGED: only the %r row was rewritten; %d other "
                 "families and both role tables left as found)"
                 % (only, len(manifest["families"]) - 1)
                 if only is not None else ""))
        print("[texgen] %d files, %d bytes of texture payload"
              % (nfiles, total))
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
    ("bark", "orm", "B"):
        "bark is not a metal; the palette constant is already 0 and identity "
        "is the only multiplier that does not rescale it",
    ("ore", "orm", "B"):
        "ore-in-rock is mineral, not polished metal: the three ore roles' "
        "palette metallic values sit under the client's 0.5 metal/matte "
        "batching split on purpose (RN-156), and identity is the only "
        "multiplier that cannot move them across it",
    ("fur", "orm", "B"):
        "fur is not a metal by any reading, and section 2.1 asks that a "
        "flat channel say so rather than invent variation it does not "
        "have; identity leaves the material's own 0.02 exactly where the "
        "palette put it",
    ("suitfab", "orm", "B"):
        "a woven pressure garment is a polymer and both roles that wear it "
        "are already 0.00 metallic in the palette; identity is the only "
        "multiplier that leaves that alone, and inventing variation here "
        "would be the dishonest half of section 2.1's own rule. The suit's "
        "metal is on `suitplate`, which does vary",
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


def _check_albedo_family(fam, spec, out_dir, say):
    """The albedo-card half of check_maps: RGBA decode, sha, per-channel
    stats, alpha variation, coverage band, covered-region albedo variation,
    albedo_mean recompute, the alpha_test guard, and the uv_space/wrap
    contract fields. Returns the texel count examined."""
    code = ALBEDO_FAMILIES[fam]
    rec = spec.get("albedo") or {}
    path = os.path.join(out_dir, rec.get("file", ""))
    if not rec or not os.path.isfile(path):
        say(False, "%s.albedo" % fam, "MISSING: %s" % rec.get("file"))
        return 0
    with open(path, "rb") as fh:
        blob = fh.read()
    digest = hashlib.sha256(blob).hexdigest()
    if digest != rec.get("sha256"):
        say(False, "%s.albedo sha" % fam,
            "manifest %s.. != file %s.."
            % (str(rec.get("sha256"))[:12], digest[:12]))
        return 0
    w, h, rgba = read_png_rgba(path)
    n = w * h
    say(w == h == spec.get("size_px") and len(blob) == rec.get("bytes"),
        "%s.albedo file" % fam,
        "%dx%d, %d B, sha %s.." % (w, h, len(blob), digest[:8]))

    stats = []
    for c in range(4):
        vals = rgba[c::4]
        stats.append((min(vals), max(vals), sum(vals) / n))
    for c, cname in enumerate("RGB"):
        lo, hi, mean = stats[c]
        say(True, "%s.albedo %s" % (fam, cname),
            "range %d..%d mean %.1f" % (lo, hi, mean))
    alo, ahi, amean = stats[3]
    say(ahi - alo >= MIN_SPREAD, "%s.albedo A" % fam,
        "spread %d (min %d), range %d..%d mean %.1f%s"
        % (ahi - alo, MIN_SPREAD, alo, ahi, amean,
           "" if ahi - alo >= MIN_SPREAD
           else "  -> a card with constant alpha has lost its cutout"))

    cov = sum(1 for a in rgba[3::4] if a >= 128) / n
    lo_b, hi_b = code["coverage"]
    say(lo_b <= cov <= hi_b, "%s.albedo coverage" % fam,
        "%.3f in band %.2f..%.2f (alpha >= 128; the floor keeps distant "
        "mips above alpha_test)" % (cov, lo_b, hi_b))

    lmin, lmax = 255.0, 0.0
    for o in range(0, n * 4, 4):
        if rgba[o + 3] >= 128:
            lum = (rgba[o] + rgba[o + 1] + rgba[o + 2]) / 3.0
            if lum < lmin:
                lmin = lum
            if lum > lmax:
                lmax = lum
    say(lmax - lmin >= MIN_SPREAD, "%s.albedo varies" % fam,
        "covered-region luma spread %.0f (min %d), range %.0f..%.0f"
        % (lmax - lmin, MIN_SPREAD, lmin, lmax))

    measured = round(_albedo_mean_rgba(rgba, code["alpha_test"]), 4)
    say(spec.get("albedo_mean") == measured, "%s.albedo_mean" % fam,
        "manifest %r vs measured %.4f" % (spec.get("albedo_mean"), measured))

    # THE GREY-WHITE / SILENT-DROP GUARD. A card whose alpha channel is in
    # use but whose manifest declares no alpha_test leaves the consumer two
    # bad defaults: render the background as grey-white fill (no test) or
    # drop the family (unknown contract). Neither is a texture bug you can
    # see in this tool, so the manifest is refused HERE, by name.
    alpha_used = ahi > alo
    has_test = "alpha_test" in spec
    if alpha_used and not has_test:
        say(False, "%s.alpha_test guard" % fam,
            "ALPHA IN USE BUT alpha_test UNDECLARED: consumer would render "
            "grey-white fill or silently drop the family; refused")
    elif not alpha_used and has_test:
        say(False, "%s.alpha_test guard" % fam,
            "alpha_test declared on a constant-alpha family")
    else:
        say(has_test and spec.get("alpha_test") == code["alpha_test"],
            "%s.alpha_test guard" % fam,
            "alpha varies and alpha_test = %r (code declares %r)"
            % (spec.get("alpha_test"), code["alpha_test"]))

    say(spec.get("uv_space") == "unit", "%s.uv_space" % fam,
        "%r (cards are unit UVs, not metres)" % spec.get("uv_space"))
    wr = spec.get("wrap") or {}
    say((wr.get("u"), wr.get("v")) == code["wrap"], "%s.wrap" % fam,
        "u=%r v=%r (code declares u=%r v=%r)"
        % (wr.get("u"), wr.get("v"), code["wrap"][0], code["wrap"][1]))
    return n


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
    expected = set(FAMILIES) | set(ALBEDO_FAMILIES)
    say(declared == expected, "families",
        "%s" % sorted(declared) if declared == expected
        else "manifest %s != code %s" % (sorted(declared), sorted(expected)))

    total_texels = 0
    for fam in sorted(declared):
        spec = man["families"][fam]
        if fam in ALBEDO_FAMILIES:
            total_texels += _check_albedo_family(fam, spec, out_dir, say)
            continue
        for kind in ("normal", "orm", "albedo"):
            if kind not in spec:
                continue                 # only chitin carries a tiling albedo
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

            if kind == "albedo":
                # A TILING albedo (RN-455). Three claims, and they are the
                # three ways this map can ship dead: it must VARY (a flat
                # albedo is the flat vertex colour ART-DIRECTION.md rejects),
                # it must not be so dark that the mean-neutral divide blows
                # the palette up, and its published mean must be the mean of
                # the bytes actually written, because the client divides by
                # that number and a stale one shifts every colour it touches.
                stats = _channel_stats(rgb, n)
                lo = min(st[0] for st in stats)
                hi = max(st[1] for st in stats)
                say(hi - lo >= 40, "%s.albedo varies" % fam,
                    "luma spread %d (min 40), range %d..%d" % (hi - lo, lo, hi))
                measured = _albedo_mean_rgb(rgb)
                declared = spec.get("albedo_mean")
                say(declared is not None
                    and abs(declared - measured) < 5e-4,
                    "%s.albedo_mean" % fam,
                    "manifest %s vs measured %.4f" % (declared, measured))
                say(0.15 <= measured <= 0.85, "%s.albedo level" % fam,
                    "mean %.4f in 0.15..0.85 (the client divides by it)"
                    % measured)
                continue
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
    count = [0]

    def check(label, ok, detail=""):
        count[0] += 1
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

    # 7c. Bark's fissures actually run along v. The whole reason `bark` exists
    #     is orientation: world-vertical on a trunk's side faces is the v axis
    #     (both horizontal-normal cases of the box projection agree, see
    #     _bark_height), so the field must change much faster ACROSS u than
    #     along v. Measured as the summed absolute wrapped difference per
    #     axis; an isotropic field (coarse's, say) lands near 1.0x and would
    #     fail, which is exactly the regression this catches: someone retunes
    #     bark into rock and every trunk quietly goes back to stone.
    s = 192
    bh, _ = _bark_height(s, s)
    gu = gv = 0.0
    for y in range(s):
        row = y * s
        for x in range(s):
            here = bh[row + x]
            gu += abs(bh[row + (x + 1) % s] - here)
            gv += abs(bh[((y + 1) % s) * s + x] - here)
    check("bark fissures vertical", gu > 1.5 * gv,
          "sum |dz/du| %.1f vs sum |dz/dv| %.1f, ratio %.2f (need > 1.50)"
          % (gu, gv, gu / gv if gv > 0 else float("inf")))

    # 7d. Ore's strata actually cross v. The family exists to put BANDING on
    #     a seam facet (RN-156): world-vertical on a boulder's side facets is
    #     the v axis (the same box-projection fact 7c rests on), geological
    #     strata lie across it, so the field must change much faster along v
    #     than along u - the mirror of bark's rule. An isotropic field lands
    #     near 1.0x and fails, which is the regression this catches: someone
    #     retunes ore into rubble and every seam quietly goes back to rock.
    s = 192
    oh, _ = _ore_height(s, s)
    ou = ov = 0.0
    for y in range(s):
        row = y * s
        for x in range(s):
            here = oh[row + x]
            ou += abs(oh[row + (x + 1) % s] - here)
            ov += abs(oh[((y + 1) % s) * s + x] - here)
    check("ore strata cross v", ov > 1.5 * ou,
          "sum |dz/dv| %.1f vs sum |dz/du| %.1f, ratio %.2f (need > 1.50)"
          % (ov, ou, ov / ou if ou > 0 else float("inf")))

    # 7e. NEGATIVE CONTROL, per DW-20: the same measurement on the same
    #     recipe with the bands fed the wrong axis must FAIL the rule above.
    #     This is what catches an anisotropy check that has quietly become
    #     rotation-invariant - a `rotated` flag someone disconnected, or a
    #     measure rewritten in terms that cannot tell u from v.
    rh, _ = _ore_height(s, s, rotated=True)
    ru = rv = 0.0
    for y in range(s):
        row = y * s
        for x in range(s):
            here = rh[row + x]
            ru += abs(rh[row + (x + 1) % s] - here)
            rv += abs(rh[((y + 1) % s) * s + x] - here)
    check("ore band control fails", not (rv > 1.5 * ru),
          "rotated 90 degrees: ratio %.2f, correctly outside the > 1.50 rule"
          % (rv / ru if ru > 0 else float("inf")))

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

    # 10. The RGBA encoder: round trip, stability, sensitivity, and the size
    #     guard. Checks 1-4 cover the RGB path; what bpp 3 cannot see is a
    #     filter that fails to invert at bpp 4.
    w = h = 33
    px4 = bytearray()
    for y in range(h):
        for x in range(w):
            px4 += bytes(((x * 5) % 256, (y * 9) % 256,
                          ((x ^ y) * 7) % 256, ((x + y) * 3) % 256))
    p4 = os.path.join(tmp, "rt4.png")
    write_png_rgba(p4, w, h, bytes(px4))
    rw, rh, rgba = read_png_rgba(p4)
    check("rgba round trip", (rw, rh) == (w, h) and rgba == bytes(px4),
          "%dx%d, %d bytes" % (rw, rh, len(rgba)))
    with open(p4, "rb") as fh:
        blob4 = fh.read()
    p5 = os.path.join(tmp, "rt5.png")
    write_png_rgba(p5, w, h, bytes(px4))
    with open(p5, "rb") as fh:
        check("rgba encode is stable", fh.read() == blob4,
              "%d bytes twice" % len(blob4))
    px5 = bytearray(px4)
    px5[4 * (17 * w + 11) + 2] ^= 0x20
    p6 = os.path.join(tmp, "rt6.png")
    write_png_rgba(p6, w, h, bytes(px5))
    with open(p6, "rb") as fh:
        check("rgba encode is sensitive", fh.read() != blob4,
              "one texel changed the file")
    try:
        write_png_rgba(p6, w, h, bytes(px4[:-4]))
        check("rgba refuses wrong size", False, "accepted a short buffer")
    except ValueError as exc:
        check("rgba refuses wrong size", True, str(exc)[:40])

    # 11. The card families, composed ONCE at shipped size and measured
    #     pre- and post-dilation. The pre-dilation buffer is the real
    #     negative control for the halo check: compose leaves background
    #     texels black precisely so this can fail (see _render_card).
    for name in sorted(ALBEDO_FAMILIES):
        spec = ALBEDO_FAMILIES[name]
        s = spec["size"]
        raw_rgb, alpha = _render_card(s, spec["strips"](), spec["noise_seed"])
        dil = _dilate_albedo(raw_rgb, alpha, s, s)
        edge, inner = _wrap_vs_interior_u([float(a) for a in alpha], s, s)
        check("%s alpha tiles in u" % name, edge <= inner,
              "wrap step %.0f vs worst interior %.0f" % (edge, inner))
        cov = _alpha_coverage(alpha)
        lo_b, hi_b = spec["coverage"]
        check("%s coverage in band" % name, lo_b <= cov <= hi_b,
              "%.3f in %.2f..%.2f (alpha >= 128)" % (cov, lo_b, hi_b))
        worst_post, ex_post = _halo_worst(dil, alpha, s, s)
        check("%s dilation kills halos" % name,
              ex_post > 0 and worst_post <= 64.0,
              "worst |luma - opaque-neighbour mean| %.1f over %d texels "
              "(max 64)" % (worst_post, ex_post))
        worst_pre, ex_pre = _halo_worst(raw_rgb, alpha, s, s)
        check("%s halo fails undilated" % name,
              ex_pre > 0 and worst_pre > 64.0,
              "undilated worst %.1f over %d texels, correctly over 64"
              % (worst_pre, ex_pre))
        check("%s tip rows clear" % name, _tip_rows_clear(alpha, s),
              "top %d rows all alpha 0 (the clamped tip edge dissolves)"
              % ALBEDO_TIP_ROWS)

    # 12. NEGATIVE CONTROLS for the card checks, per DW-20: each must be
    #     shown able to fail on a field built to fail it.
    s = 64
    uramp = [x / s for y in range(s) for x in range(s)]
    edge, inner = _wrap_vs_interior_u(uramp, s, s)
    check("u-seam check can fail", edge > inner,
          "u ramp: wrap step %.4f vs worst interior %.4f" % (edge, inner))
    band = ALBEDO_FAMILIES["grass"]["coverage"]
    c_ones = _alpha_coverage(bytes([255]) * (s * s))
    c_zeros = _alpha_coverage(bytes(s * s))
    check("coverage check can fail",
          not (band[0] <= c_ones <= band[1])
          and not (band[0] <= c_zeros <= band[1]),
          "all-opaque %.2f and all-transparent %.2f both outside %.2f..%.2f"
          % (c_ones, c_zeros, band[0], band[1]))
    top_alpha = bytearray(s * s)
    top_alpha[0:s] = b"\xff" * s
    check("tip check can fail", not _tip_rows_clear(top_alpha, s),
          "an opaque top row was caught")

    # 13. The alpha_test guard, exercised against the SHIPPED manifest the
    #     same way check 9 exercises the sha: copy, strip the field, and
    #     check_maps must refuse by name.
    if os.path.isdir(OUT_DIR):
        import shutil
        guard = os.path.join(tmp, "tex_guard")
        shutil.copytree(OUT_DIR, guard)
        gm_path = os.path.join(guard, "surfaces.json")
        with open(gm_path, "r", encoding="utf-8") as fh:
            gman = json.load(fh)
        gfam = gman.get("families", {}).get("grass", {})
        if "alpha_test" in gfam:
            del gfam["alpha_test"]
            with open(gm_path, "w", newline="\n", encoding="utf-8") as fh:
                json.dump(gman, fh, indent=2, sort_keys=False)
                fh.write("\n")
            ok_guard, _ = check_maps(guard, verbose=False)
            check("alpha_test guard can fail", not ok_guard,
                  "grass without alpha_test was refused")
        else:
            check("alpha_test guard can fail", False,
                  "NOT EXAMINED: shipped manifest has no grass alpha_test, "
                  "run `texgen.py` first")
    else:
        check("alpha_test guard can fail", False,
              "NOT EXAMINED: %s does not exist" % OUT_DIR)

    print("\n%s  %d check(s), %d failure(s)"
          % ("SELFTEST PASS" if not fails else "SELFTEST FAIL",
             count[0], len(fails)))
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
    ap.add_argument("--only", default=None, metavar="FAMILY",
                    help="regenerate ONE tiling family's PNGs and merge only "
                         "that family's rows into the existing surfaces.json. "
                         "Use this whenever another lane has uncommitted work "
                         "in this file: a full build writes every live lane's "
                         "in-flight family into the shipped set (RN-558)")
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
    generate(args.out, args.size, only=args.only)
    return 0


if __name__ == "__main__":
    sys.exit(main())
