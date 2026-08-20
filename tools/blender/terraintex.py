#!/usr/bin/env python3
"""
terraintex.py - the TERRAIN's PBR SPLAT LAYERS. Stdlib only, no Blender.

    python tools/blender/terraintex.py            # write assets/textures/dist/
    python tools/blender/terraintex.py selftest   # prove the fields
    python tools/blender/terraintex.py check      # assert the SHIPPED bytes

WHY THIS EXISTS (RN-2160, fidelity lane A3 phase 1). The fidelity gap analysis
(docs/web/FIDELITY-GAP-2026-08-19.md section 1 difference 2) states it in one
line: "their terrain wears materials; ours wears a palette". The world audit
(docs/web/WORLD-AUDIT-2026-08-19.md gap 3) measures the same thing from the
other side: the terrain has no albedo, normal or ORM texture ANYWHERE, only two
greyscale detail maps modulating a per-biome colour, which is why a slope reads
as tinted noise rather than as rock or as soil. This module is where the
material layers come from.

WHY IT IS A THIRD MODULE AND NOT A texgen FAMILY OR A groundtex CHANNEL.
Three consumers, three artifacts, and the difference is the SAMPLING CONTRACT,
not the pixels:

  * texgen families ride glTF UVs in metres through three's stock map slots on
    MESH materials. The terrain has no surface parameterisation and no tangent
    frame, so a stock map slot cannot reach it.
  * groundtex ships ONE RGBA texture whose four channels are MODULATION FIELDS
    for a colour the shader already computed. It is a detail map: it says how
    the ground varies, never what the ground IS.
  * this module ships ONE RGBA texture PER MATERIAL LAYER, and the shader
    picks between the layers by slope, altitude and biome. It is the layer set
    a splat blends, which is a different question from either of the above.

groundtex is NOT modified and its two files stay byte-identical; texgen is not
modified either. Both are IMPORTED for their deterministic primitives, because
a copy of a hash is a second authority on what the hash is (groundtex's own
rule, applied one module further along).

THE LAYERS, and why these six. The brief named grass, dirt, rock, cliff, scree
and snow, and each one is a distinct FACT about a surface rather than a tint of
its neighbour, which is texgen's own family-split rule (RN-742: "the family
encoded the wrong FACT about the surface"):

    grass   the meadow carpet: tussock mounds, thatch between them, a fine
            blade grain. What the ground IS on a gentle vegetated slope.
    dirt    dry bare soil: rounded clods over narrow deep interstices, grit.
            The patch under and between the grass, and the whole surface where
            a biome has no cover to speak of.
    rock    ROCKY GROUND, i.e. bedrock in place under a thin skin: broad
            fractured facets with gravel and dust caught in the joints. What a
            slope becomes as it steepens past the point cover stays on it.
    cliff   near-vertical rock, and it is DIRECTIONAL where `rock` is
            isotropic: long vertical fissures crossed by horizontal bedding
            breaks. Exactly bark's argument for leaving `coarse` (texgen's
            header), one substrate over.
    scree   loose angular fragments on a mountain apron: flat facets joined by
            one-to-three texel steps at two scales, plus a sparse population of
            larger stones. The signature is a BIMODAL gradient distribution,
            which is what separates a talus slope from rough rock.
    snow    wind-worked drift: smooth dunes, sastrugi (long stoss slope, short
            lee slope, so the field is ASYMMETRIC along the wind axis) and a
            fine crystalline grain that lives almost entirely in roughness.

ONE TEXTURE PER LAYER, FOUR CHANNELS, AND THE PACKING IS THE WHOLE BUDGET
ARGUMENT. Six layers x three conventional maps (albedo, normal, ORM) is
eighteen samplers, and WebGL2 guarantees only sixteen fragment texture units in
total, before three's own shadow maps take three of them. Eighteen is not a
budget overrun, it is unimplementable. The way out is not an atlas (a tiling
atlas needs textureGrad, which GLSL ES 1.00 does not have, and this material is
GLSL1) and not a sampler2DArray (which needs GLSL ES 3.00 and therefore a
port of all twenty-three terrain shader chunks). It is to notice that THREE OF
THE EIGHTEEN MAPS ARE CARRYING INFORMATION THE PALETTE ALREADY OWNS:

    R  albedo VALUE     centred on 0.5
    G  normal x         centred on 0.5
    B  normal y         centred on 0.5   (z is reconstructed in the shader)
    A  roughness DETAIL centred on 0.5

Six samplers, not eighteen. The layer's HUE is a three-float constant in the
client (TerrainSplat.ts's LAYER table) rather than three channels of pixels,
and its roughness BASE is one float there too. That is not a compression trick,
it is BiomePalette's own rule (`of_lib.PALETTE` is the colour authority; texgen
ships no albedo for exactly this reason and its card families ship near-neutral
VALUE textures with the hue left to the client). It is also what makes section
3 of the brief - harmony with the biome palette - true BY CONSTRUCTION rather
than by tuning: see THE CONVERGENCE RULE below.

THE CONVERGENCE RULE, stated here because this module is the half of it that
can be asserted in bytes. EVERY CHANNEL OF EVERY LAYER IS CENTRED ON 0.5, so:

  * a fully minified sample (the mip chain's own limit) is 0.5 in all four
    channels, which is albedo x 1.0, normal (0,0,1) and roughness x 1.0, i.e.
    the exact palette colour, the geometric normal and the palette roughness.
  * the layer set therefore cannot move the world's colour at any distance
    where it has faded or minified, and the far field and the minimap keep
    reading the palette they read today.
  * the shader's own half of the rule (the luminance-preserving hue vectors and
    the two fade bands) is in TerrainSplat.ts; this file's half is the measured
    mean, and `check` asserts it on the SHIPPED BYTES rather than on the float
    fields, because the shipped bytes are what the sampler averages.

This is groundtex's centring argument with one thing added: groundtex centres
so a modulation converges to its identity, and this module centres so a
MATERIAL converges to the PALETTE. Same arithmetic, larger claim.

DETERMINISM: texgen's contract, inherited by import and restated because this
module is new and a rail nobody restated is a rail nobody checked.
  * No RNG. Every "random" value is texgen._hash01, pure 32-bit integer maths.
  * No transcendentals in the synthesis. Only + - * / and math.sqrt, which is
    correctly rounded by IEEE-754 and therefore bit-portable. No sin, no cos,
    no pow, no exp. DW-14 is this project's own scar from a 1 ULP libm
    divergence and it is not being re-earned here.
  * No timestamps, no text chunks, no gamma chunk: texgen's writer emits IHDR
    + IDAT + IEND and nothing else.
  * zlib pinned to texgen's explicit parameters and its runtime version
    recorded in the manifest.
  * sorted() and sum() over floats produced by deterministic arithmetic, which
    is groundtex._centre's own determinism argument.

RUNTIME AND SIZE, measured on this box on 2026-08-19 and recorded because no
generator in this repo had a recorded runtime before and the next lane should
not have to guess whether a build has hung:

    build      83.2 s wall clock, six layers at 1024 px
    selftest   about 40 s (256 px, plus one 128 px rebuild pair)
    check      about 30 s (six decodes plus the tiling sweep)
    on disk    8,880,037 B for the six PNGs (0.76 to 1.87 MB each)
    VRAM       32.0 MB as RGBA8 with a full mip chain

The 32.0 MB is the number the ceiling study's budget has to absorb: it measured
104 MB of 260 MB spent, so the six layers take the total to 136 MB and leave
124 MB. That is the whole texture cost of this lane; the splat adds no draw
call, only fetches inside the terrain draw that already exists.

TILING is by construction (every lattice and every worley cell wraps with %)
and is ASSERTED TWICE, exactly as groundtex asserts it: `selftest` checks the
wrap step against the worst interior step on the float fields, and `check`
re-asserts it on the shipped quantised bytes.

NO IDENTIFIABLE FEATURE IN ANY LAYER, deliberately, and it matters more here
than it does in groundtex because these tiles are 2 to 4 m and a walking player
crosses six of them in ten seconds. texgen's scratch lesson: the most
identifiable thing in a tile is the strongest cue that the tile repeats. There
are no cracks with a rememberable shape, no hero stones, no single large
feature anywhere in the six.

WHY NOT POLYHAVEN, WHICH THE BRIEF ASKED FOR. Recorded here rather than in a
report, because the next lane to read this file will ask.

  1. Downloading files is not a decision this lane is permitted to take on an
     agent's instruction. It needs Reid's own approval, and this lane ran
     overnight without it. That is the binding reason and the other two would
     not have been sufficient on their own.
  2. Committing the sources would put roughly 300 MB of 2k PNG/EXR into a repo
     that rewrote its own history on 2026-08-03 specifically to get 132
     screenshots and an abandoned engine out of it, and that retired the
     blanket `*.png filter=lfs` rule in the same move.
  3. The determinism rail is strictly WEAKER with an ingest than without one.
     An ingest has to promise that a resize, a channel repack and a re-encode
     of a committed source image reproduce byte-for-byte across platforms;
     synthesis promises the same thing with no source image, no resampler and
     no licence text in the tree. DW-5's byte-identical rebuild gate is easier
     to keep, not harder, on this side.

The ingest path is still worth having and this module is shaped so it can be
added WITHOUT a rewrite: every layer is a `_layer_<name>(s)` function returning
three float fields in [0, 1], and an ingest would replace those three returns
with decoded source pixels while `_centre_to`, the packer, the writer, the
manifest and the whole client side stay exactly as they are. That is the seam
to cut on, and it is one function per layer.
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
sys.path.insert(0, HERE)
import texgen     # noqa: E402  deterministic primitives; texgen is NOT modified
import groundtex  # noqa: E402  _noise_aniso and _terrace; NOT modified

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(ROOT, "assets", "textures", "dist")

# Manifest schema version. The client reads this and refuses a version it does
# not know, rather than mis-reading a field that changed meaning. texgen's
# rule, one tier down, and the same rule groundtex follows.
MANIFEST_VERSION = 1

# Pixels, square, per layer. 1024 is groundtex's own size and it is chosen the
# way FAMILY_SIZE's first-person block chooses: by TEXEL DENSITY against the
# tile, not by preference. At the 2.0 m tile the four ground layers ship on,
# 1024 px lands 512 texels/m, which is ASSET-SPECS 2.8's first-person target
# exactly, on the surface that occupies more screen area than every mesh family
# in the game combined.
#
# 2048 was considered and refused with a number rather than a feeling. RGBA8
# with its mip chain is 1.333 * 4 * px^2 bytes, so a 2k layer is 21.3 MiB and
# six of them are 128 MiB. The ceiling study measured 104 MB of a 260 MB budget
# already spent, and 104 + 128 = 232 leaves 28 MB for every other texture this
# project will ever add. At 1024 the six cost 32.0 MiB (the manifest publishes
# the exact byte count rather than this arithmetic), the total is 136 of 260,
# and the density still clears the published target.
SIZE = 1024

# Percentile window the value and roughness remaps stretch to, per channel.
# groundtex uses one SPREAD for all four of its channels because they all drive
# the same kind of modulation; these three drive different terms with different
# tolerances, so they are three numbers.
#
# VALUE 0.30. The albedo term is multiplicative on the palette colour, so this
# is a +/-30% swing at full weight before the shader's own amplitude scales it.
# groundtex's 0.36 is the comparison and it is deliberately not matched: that
# field is a DETAIL modulation riding on top of a colour, this one IS the
# material's own light and dark, and the two stack.
SPREAD_VALUE = 0.30
# PER-LAYER OVERRIDE, and it exists because selftest 7 caught the alternative.
# `snow` is authored with about a third of the others' value contrast (real snow
# has almost no albedo contrast; everything you see in it is shape and
# specular), and a percentile stretch to a shared SPREAD_VALUE SILENTLY PUT IT
# ALL BACK: the first run measured snow's p2-p98 spread at 0.6000 against rock's
# 0.6000, i.e. identical, because that is what `_centre_to` is for. Authoring an
# intention into a field and then normalising the field is not authoring
# anything. The claim now lives in this table, is published in the manifest, and
# is asserted as a RATIO against rock rather than as an absolute.
SPREAD_VALUE_BY_LAYER = {"snow": 0.10}
# ROUGHNESS 0.22. The roughness term is multiplicative on a per-layer base in
# [0.5, 0.94], and TerrainTex.glsl's named failure mode 1 ("the whole ground
# goes satin") is a floor problem, so the swing is authored SMALL and upward-
# biased by the base rather than large and symmetric.
SPREAD_ROUGH = 0.22
# NORMAL. Not a percentile stretch: the normal is the heightfield's gradient
# and its range is set by NORMAL_STRENGTH per layer, below. It is centred by
# construction (a wrapped central difference of a wrapped field sums to zero
# over the tile to within quantisation) and that is ASSERTED rather than
# assumed, because "by construction" is a sentence in a comment until something
# measures it (NUMBERS.md, "a sentence in a comment is not an invariant").
NORMAL_MEAN_TOL = 0.004

# Metres of world space one repeat of each layer covers. Lives in the manifest
# and is applied by the client, so retuning texel density costs zero rebuilds -
# texgen's FAMILY_TILE_M argument, inherited.
#
# THE FOUR GROUND LAYERS SHARE 2.0 m ON PURPOSE, and it is the one number in
# this table that is a CORRECTNESS constraint rather than a taste. grass, dirt,
# rock and scree blend against each other continuously across a hillside; if
# two layers being blended have different world scales then the blend has a
# visible scale beat in it, and a beat between two noise fields reads as a
# third pattern that is not in either texture. Layers that BLEND share a tile;
# layers that are separated by a hard domain do not have to.
#
# cliff 3.0 m. It is separated from `rock` by slope, not blended with it across
# open ground (the weight rule hands over inside a few degrees on geometry that
# is close to vertical, so the blend band is a metre or two of surface, not a
# hillside), and its content is architectural: a 3 m tile puts the vertical
# fissures at 15 to 40 cm, which is the spacing a real jointed rock face has,
# and lands 341 texels/m, `panel`'s own density and this project's precedent
# for "large surface judged from a few metres".
#
# snow 4.0 m. A drift has no fine content to resolve - its whole subject is a
# metre-scale dune and a sub-millimetre sparkle, with nothing in between - so
# the tile is set by the dune (4 m gives one and a half dunes per repeat, few
# enough that no copy is countable across a snowfield) and 256 texels/m is
# ample for a surface whose value contrast is a tenth of every other layer's.
TILE_M = {
    "grass": 2.0, "dirt": 2.0, "rock": 2.0, "scree": 2.0,
    "cliff": 3.0, "snow": 4.0,
}

# Gradient gain fed to the normal encode, per layer. Bigger is a deeper-looking
# surface and a noisier one; these were set by the RELIEF each layer is
# claiming, in the units the heightfield is authored in (the field spans [0,1]
# over the tile, so strength S and tile T give a maximum slope of about S/T per
# metre at the finest octave).
#
# snow is the lowest by a factor of two and that is the layer's whole point: a
# drift is SMOOTH, and the reason snow currently "reads as flat white paper"
# (world audit gap 10) is not that it has no relief but that it has no material
# at all. Giving it a rock's normal strength would fix the wrong complaint.
NORMAL_STRENGTH = {
    "grass": 3.2, "dirt": 2.6, "rock": 3.6,
    "cliff": 4.2, "scree": 3.8, "snow": 1.8,
}

# Layer order. THE CLIENT'S LAYER INDICES ARE THIS ORDER, so it is published in
# the manifest and asserted against the client's own copy, rather than being
# two lists that agree today.
LAYERS = ["grass", "dirt", "rock", "cliff", "scree", "snow"]

# Per-layer seeds. Explicit integers rather than an enumerate() index, because
# an index would renumber every layer the day one is inserted and every
# committed sha would move for a change that touched no field.
SEED = {
    "grass": 21600, "dirt": 21610, "rock": 21620,
    "cliff": 21630, "scree": 21640, "snow": 21650,
}


# ---------------------------------------------------------------------------
# Shared field helpers. Everything here is + - * / and math.sqrt.
# ---------------------------------------------------------------------------

def _centre_to(field, spread):
    """groundtex._centre, generalised to a per-channel spread.

    Not imported from groundtex, and the reason is the one thing worth writing
    down here: groundtex._centre closes over groundtex.SPREAD, which is part of
    of_ground.png's shipped contract. Reaching in to parameterise it would put
    this lane's tuning inside another artifact's authority, and the two files
    must stay byte-identical. The ARITHMETIC below is groundtex's to the
    character, including centring on the MEAN rather than the median (the mip
    chain converges to the mean, so the mean is the value that has to be the
    identity; groundtex's own note records the 3% net brighten that centring
    the median shipped).
    """
    srt = sorted(field)
    n = len(srt)
    lo = srt[int(n * 0.02)]
    hi = srt[int(n * 0.98) - 1]
    mid = sum(field) / n
    scale = (2.0 * spread) / (hi - lo) if hi > lo else 0.0
    return [texgen._clamp01(0.5 + (v - mid) * scale) for v in field]


def _mix(a, b, t):
    return a + (b - a) * t


def _add(dst, src, amp):
    """dst += src * amp, in place. The hot loop of every layer below."""
    for i in range(len(dst)):
        dst[i] += src[i] * amp
    return dst


def _mul_field(a, b):
    return [a[i] * b[i] for i in range(len(a))]


def _inv(field):
    return [1.0 - v for v in field]


def _gamma_like(field, k):
    """A monotone skew with NO pow(): v -> v / (v + k*(1-v)) for k > 0.

    k > 1 pushes mass DOWN (a dark-tailed histogram, which is what a surface
    with narrow deep interstices has), k < 1 pushes it UP (plateau mass with a
    thin dark tail, which is what a clodded or facetted surface has). It is a
    Mobius map on [0,1] fixing both ends, so it cannot clip and it cannot
    reorder, and it is four arithmetic ops with no transcendental anywhere.
    pow(v, g) would have been the obvious spelling and is exactly the kind of
    libm call DW-14 was paid for.
    """
    out = [0.0] * len(field)
    for i, v in enumerate(field):
        d = v + k * (1.0 - v)
        out[i] = v / d if d > 1e-9 else 0.0
    return out


def _ridge(field):
    """Sharp-crested from smooth: 1 - |2v - 1|. Turns value noise's rounded
    hills into creased ridges, which is what separates a fissured surface from
    a lumpy one."""
    return [1.0 - abs(2.0 * v - 1.0) for v in field]


def _steps(field, levels):
    """Quantise to flat facets joined by hard steps, with NO floor() drift.

    groundtex._terrace is the precedent and is imported for the fields that
    want its soft edge; this one is the HARD version scree needs, where the
    whole signature is a bimodal gradient distribution (mostly zero, plus a
    sparse population of large steps)."""
    out = [0.0] * len(field)
    inv = 1.0 / levels
    for i, v in enumerate(field):
        k = int(v * levels)
        if k >= levels:
            k = levels - 1
        out[i] = k * inv
    return out


def _terrace_field(field, levels, edge):
    """groundtex._terrace lifted from a scalar to a field. That function takes
    ONE value (it is called inside a comprehension at its own site), and
    mapping it here rather than reimplementing it keeps one authority on what a
    terrace is."""
    return [groundtex._terrace(v, levels, edge) for v in field]


def _dir_streak(s, period_along, period_across, seed, skew):
    """Anisotropic noise with an ASYMMETRIC profile across the streak axis.

    groundtex._noise_aniso gives the stretched cells; the skew is this
    function's addition and it is what makes a wind-worked surface not read as
    water. RN-147's finding, quoted in groundtex's header: smooth symmetric
    noise fed to a bump reads as choppy water at every amplitude, and what
    separates a real surface from a liquid one is asymmetry.
    """
    f = groundtex._noise_aniso(s, s, period_across, period_along, seed)
    return _gamma_like(f, skew)


# ---------------------------------------------------------------------------
# THE SIX LAYERS. Each returns (height, value, rough) as raw float lists in
# roughly [0, 1]; the caller centres value and rough and derives the normal
# from height. THIS IS THE INGEST SEAM: an ingest of source photography would
# replace these six function bodies and nothing else in the module.
# ---------------------------------------------------------------------------

def _layer_grass(s):
    """The meadow carpet: tussock mounds, thatch between them, blade grain.

    The value channel is what does most of the work here and it is authored
    against a specific complaint. The fidelity gap's difference 1 says our
    ground reads as "a table with objects on it"; A2's instanced blades are the
    other half of that fix and THIS is the half that has to meet them, so the
    field is authored as what you see BETWEEN blades looking down: dark damp
    thatch in the clump interstices, pale dry litter on the mounds. Getting
    that inverted (bright interstices) is the single most reliable way to make
    a grass texture read as moss.
    """
    sd = SEED["grass"]
    # Tussock mounds at ~33 cm on the 2 m tile. Worley, inverted, so a feature
    # point is the CROWN of a clump rather than the bottom of a pit.
    mound = _inv(texgen._worley(s, s, 6, sd))
    # Thatch: the matted layer between clumps. Two octaves, no ridge, because
    # thatch is genuinely smooth at this scale and its texture is in the grain.
    thatch = texgen._fbm(s, s, 18, 3, sd + 11)
    # Blade grain, ~2 cm. Ridged so individual blades have a crease rather than
    # a hump, and DIRECTIONAL because grass lies down: a purely isotropic grain
    # at this frequency is indistinguishable from grit.
    blade = _ridge(groundtex._noise_aniso(s, s, 24, 96, sd + 23))
    grit = texgen._fbm(s, s, 128, 2, sd + 31)

    height = [0.0] * (s * s)
    _add(height, mound, 0.52)
    _add(height, thatch, 0.28)
    _add(height, blade, 0.14)
    _add(height, grit, 0.06)

    # Value: follow the height (crowns dry and pale, hollows damp and dark) and
    # then skew the mass UPWARD, because a meadow seen from standing eye is
    # mostly lit blade with thin dark gaps, not the other way round.
    value = _gamma_like(height, 0.72)
    # The blade grain contributes more to VALUE than to height: a blade catches
    # light along its length far more than it displaces the surface.
    _add(value, blade, 0.22)

    # Roughness: high everywhere (vegetation is the roughest thing on a
    # planet), a little lower on the crowns where a waxy blade face catches a
    # grazing sun. That highlight is the whole reason the layer has a roughness
    # channel at all - a uniform 0.9 would have been a constant.
    rough = _inv(_mul_field(mound, mound))
    _add(rough, thatch, 0.35)
    return height, value, rough


def _layer_dirt(s):
    """Dry bare soil: rounded clods over narrow deep interstices, plus grit.

    The ASYMMETRY is the point and it is groundtex's clod channel one scale up:
    plateau mass with a thin dark tail down in the cracks. A symmetric field
    here reads as gravel, and a symmetric field fed to a bump reads as water.
    """
    sd = SEED["dirt"]
    clod = _inv(texgen._worley(s, s, 8, sd))
    # The crack network: the SAME worley distance un-inverted and squared, so
    # the cracks are exactly where the clods are not. One field read twice is
    # texgen's "one heightfield per family" rule inside one channel.
    crack = texgen._worley(s, s, 8, sd)
    crack = _mul_field(crack, crack)
    fines = texgen._fbm(s, s, 40, 4, sd + 13)
    grit = texgen._fbm(s, s, 160, 2, sd + 29)

    height = [0.0] * (s * s)
    _add(height, clod, 0.50)
    _add(height, fines, 0.30)
    _add(height, grit, 0.08)
    # Cut the cracks IN rather than adding clods ON: subtracting is what makes
    # the histogram's tail thin and dark instead of making the whole field
    # darker, which is the difference between a cracked surface and a dim one.
    for i in range(s * s):
        height[i] -= crack[i] * 0.22
    height = _gamma_like(height, 0.66)

    value = list(height)
    # Soil is DARKER where it is damp and sheltered, and the interstices are
    # both. Same correlation grass uses and the same one TerrainFragAlbedo's
    # detail-layer note calls "the one correlation in this material that is
    # physically right rather than merely cheap".
    _add(value, fines, 0.18)

    rough = [0.90] * (s * s)
    _add(rough, grit, 0.20)
    _add(rough, crack, -0.10)
    return height, value, rough


def _layer_rock(s):
    """ROCKY GROUND: broad fractured facets, gravel and dust in the joints.

    Isotropic on purpose. `cliff` below is the directional one and the two
    exist as separate layers precisely because bedded rock and fractured rock
    are different facts about a surface (texgen RN-742's split, verbatim).
    """
    sd = SEED["rock"]
    # Two facet scales, 25 cm and 10 cm on the 2 m tile, terraced so the facets
    # are FLAT and the arrises between them are sharp. groundtex._terrace is
    # the soft-edged version and is right here: a rock face's arrises are
    # chipped, not machined.
    big = _terrace_field(texgen._worley(s, s, 8, sd), 5, 0.14)
    small = _terrace_field(texgen._worley(s, s, 20, sd + 7), 4, 0.10)
    dust = texgen._fbm(s, s, 30, 4, sd + 17)
    gravel = texgen._worley(s, s, 64, sd + 23)

    height = [0.0] * (s * s)
    _add(height, big, 0.48)
    _add(height, small, 0.26)
    _add(height, dust, 0.14)
    _add(height, gravel, 0.12)

    # Value: dust and lichen collect in the joints and pale mineral shows on
    # the exposed facet faces, so value follows height MORE strongly than the
    # softer layers do. A rock face is mostly value contrast; that is what
    # makes it read as rock rather than as grey.
    value = list(height)
    _add(value, big, 0.30)

    # Roughness: the facet faces are smoother than the joints, which is the
    # whole reason wet rock and raked sun look like anything. TerrainTex's
    # ofArtRough already drops steep ground to 0.62 for this reason with a
    # CONSTANT; this is the per-pixel version of the same claim.
    rough = _inv(big)
    _add(rough, dust, 0.45)
    _add(rough, gravel, 0.25)
    return height, value, rough


def _layer_cliff(s):
    """Near-vertical rock: long vertical fissures crossed by bedding breaks.

    DIRECTIONAL, and that is the entire reason it is not `rock` at a different
    tile. A cliff's structure runs with the joint set and against the bedding,
    and an isotropic field on a vertical face reads as a pile of rubble glued
    to a wall.
    """
    sd = SEED["cliff"]
    # Vertical fissures: cells stretched 6:1 along v. Ridged, so a fissure is a
    # crease rather than a valley floor.
    fissure = _ridge(groundtex._noise_aniso(s, s, 14, 3, sd))
    # A second, finer joint set at a different stretch, so the face is not one
    # comb. 9:2 rather than 6:1 so the two do not beat against each other.
    joint = _ridge(groundtex._noise_aniso(s, s, 34, 8, sd + 9))
    # Horizontal bedding: the crossing structure, weaker than the fissures
    # because on a real face the joints win.
    bed = _terrace_field(groundtex._noise_aniso(s, s, 3, 22, sd + 19), 7, 0.10)
    grain = texgen._fbm(s, s, 96, 3, sd + 27)

    height = [0.0] * (s * s)
    _add(height, fissure, 0.40)
    _add(height, joint, 0.22)
    _add(height, bed, 0.26)
    _add(height, grain, 0.12)

    value = list(height)
    # Streaking: a cliff face is stained DOWN by water, so the value field
    # carries a stretched low-frequency wash the height does not. This is the
    # one place in the six where value and height deliberately decorrelate, and
    # the reason is that staining is a history of the surface rather than a
    # shape of it.
    stain = groundtex._noise_aniso(s, s, 5, 1, sd + 33)
    _add(value, stain, 0.34)

    rough = _inv(fissure)
    _add(rough, grain, 0.40)
    _add(rough, bed, 0.20)
    return height, value, rough


def _layer_scree(s):
    """A talus apron: flat fragments joined by hard steps, at two scales.

    THE SIGNATURE IS BIMODAL GRADIENT, which is groundtex's own scree channel
    stated as a measurement: mostly near-zero slope on the fragment faces, plus
    a sparse population of large steps at their edges. `selftest` measures it
    with a negative control, because a claim about a distribution that nothing
    counts is a claim nobody checked.
    """
    sd = SEED["scree"]
    # Hard steps, not terraced: a fragment edge is a genuine discontinuity.
    # FEWER AND BIGGER, and the count is calibrated rather than chosen. At 8
    # and 16 cells over the 2 m tile the fragments are 25 cm and 12.5 cm, which
    # is talus; at the 10 and 24 the first version used they were 20 cm and
    # 8 cm, and three overlapping contour sets at that density put a step
    # EDGE under 60 per cent of the texels, so there were no faces left between
    # them (0.400 flat against groundtex's 0.50 bar, p99 only 2.9x the median).
    # A facet field's edges have to be sparse or it is just a rough field with
    # extra steps in it.
    coarse = _steps(texgen._worley(s, s, 8, sd), 4)
    fine = _steps(texgen._worley(s, s, 16, sd + 5), 3)
    # Tilt each fragment slightly, so the faces are not all parallel to the
    # tile. Low-frequency noise multiplied into the step field does this
    # without adding a second population of edges.
    # THE TILT IS QUANTISED TOO, and that is the second thing the facet
    # instrument caught. A CONTINUOUS tilt multiplied into a stepped field
    # leaves a smooth ramp across the interior of every fragment, which is
    # precisely the thing a talus slope does not have: it measured 0.412 flat
    # against a 0.50 bar, i.e. the faces were not faces. Quantising the tilt
    # keeps what the term was for (fragments are not all parallel to the tile)
    # and takes back what it was accidentally doing (making each one a curved
    # shell).
    tilt = _steps(texgen._fbm(s, s, 10, 2, sd + 13), 4)
    dustfall = texgen._fbm(s, s, 18, 2, sd + 21)

    # THE HEIGHT CARRIES ALMOST NO BROADBAND GRAIN, and that is the layer's
    # whole signature rather than a saving. The first version summed a 3-octave
    # fbm at 0.10 into the height and selftest 3 measured the result at a
    # top-1% gradient share of 0.0295 against grass's 0.0328: LESS concentrated
    # than a meadow, i.e. not a talus slope at all. A per-texel noise term
    # spreads gradient over every texel in the tile and drowns a step
    # population that only occupies a few per cent of them, so the fragment
    # faces have to be genuinely FLAT for the steps to be the distribution.
    # The grain has not been deleted, it has been moved to the channels where
    # it belongs: `dustfall` still rides the value and the roughness, where it
    # reads as dust without filling in the gradient histogram.
    height = [0.0] * (s * s)
    _add(height, coarse, 0.50)
    _add(height, fine, 0.28)
    _add(height, _mul_field(coarse, tilt), 0.16)
    # A LITTLE broadband is kept ON PURPOSE, at a low frequency and a small
    # amplitude. A perfectly piecewise-constant field has a MEDIAN GRADIENT OF
    # EXACTLY ZERO, which makes the p99/median bar vacuously true and makes the
    # instrument stop being able to fail. It is also a lie about the surface:
    # there is dust on a talus slope.
    _add(height, dustfall, 0.04)

    value = list(height)
    # Fragment faces are freshly broken and pale; the shadowed gaps between
    # them are the dark half. Skewed UP because a talus slope seen from above
    # is mostly face and only a little gap.
    value = _gamma_like(value, 0.70)
    _add(value, dustfall, 0.16)

    rough = _inv(_mul_field(coarse, coarse))
    _add(rough, dustfall, 0.38)
    return height, value, rough


def _layer_snow(s):
    """Wind-worked drift: smooth dunes, asymmetric sastrugi, crystalline grain.

    The world audit's gap 10 says the snow band is "smoothstep applied to the
    albedo with no material behind it, so it takes the sky ambient straight and
    reads as paint". Nearly all of the fix is in the NORMAL and the ROUGHNESS,
    not in the value: real snow has almost no albedo contrast (it is the one
    natural surface where that is true) and everything you see in it is shape
    and specular. So this layer's value channel is authored DELIBERATELY FLAT,
    at about a third of every other layer's contrast, and the centring step is
    what publishes that as a number rather than as an intention.
    """
    sd = SEED["snow"]
    dune = texgen._fbm(s, s, 5, 3, sd)
    # Sastrugi: the wind-carved ridges, long along the wind and asymmetric
    # across it (a long gentle stoss slope into a short steep lee face).
    sastrugi = _dir_streak(s, 4, 26, sd + 11, 1.9)
    crust = texgen._fbm(s, s, 46, 3, sd + 17)
    # The crystalline grain. It is 1 to 2 texels at this size, so it is
    # deliberately NOT in the height (it would alias into the normal at any
    # range) and lives only in roughness, where a sparkle is what it should be.
    sparkle = texgen._worley(s, s, 200, sd + 29)

    height = [0.0] * (s * s)
    _add(height, dune, 0.50)
    _add(height, sastrugi, 0.34)
    _add(height, crust, 0.16)

    # A THIRD of the contrast of the other layers, by construction: the field
    # is pulled toward its own mean before the percentile stretch, so the
    # stretch cannot undo it. Written as an explicit lerp toward 0.5 rather
    # than as a smaller SPREAD, because SPREAD is a per-CHANNEL constant shared
    # by six layers and this is a claim about ONE layer's material.
    value = [_mix(0.5, height[i] * 0.6 + crust[i] * 0.4, 0.34)
             for i in range(s * s)]

    # Roughness is where snow lives. Wind-packed crust is smooth, fresh
    # powder in the lee is not, and the sparkle punches a sparse population of
    # very smooth texels through both, which is the facet glint.
    rough = [0.0] * (s * s)
    _add(rough, crust, 0.55)
    _add(rough, _inv(sastrugi), 0.30)
    _add(rough, sparkle, 0.35)
    return height, value, rough


LAYER_FN = {
    "grass": _layer_grass, "dirt": _layer_dirt, "rock": _layer_rock,
    "cliff": _layer_cliff, "scree": _layer_scree, "snow": _layer_snow,
}

# What each layer's four channels are, published in the manifest so a consumer
# reads the packing rather than transcribing it.
CHANNELS = {
    "r": "albedo value, centred on 0.5, multiplicative on the palette colour",
    "g": "tangent normal x, centred on 0.5",
    "b": "tangent normal y, centred on 0.5 (z reconstructed in the shader)",
    "a": "roughness detail, centred on 0.5, multiplicative on the layer base",
}


# ---------------------------------------------------------------------------
# Normal encode. texgen._normal_rgb writes three bytes and reconstructs
# nothing; this needs the two tangent components as FLOAT fields so they can be
# packed beside value and roughness and measured by the same centring
# assertion. Same central differences, same wrapped indexing, same OpenGL
# green-is-+Y convention (a DirectX-convention map is the classic silent
# normal-map defect and three/glTF expect OpenGL).
# ---------------------------------------------------------------------------

def _normal_xy(height, s, strength):
    nx = [0.0] * (s * s)
    ny = [0.0] * (s * s)
    for y in range(s):
        ym = ((y - 1) % s) * s
        yp = ((y + 1) % s) * s
        row = y * s
        for x in range(s):
            xm = (x - 1) % s
            xp = (x + 1) % s
            dx = (height[row + xp] - height[row + xm]) * strength
            dy = (height[yp + x] - height[ym + x]) * strength
            inv = 1.0 / math.sqrt(dx * dx + dy * dy + 1.0)
            i = row + x
            nx[i] = texgen._clamp01(-dx * inv * 0.5 + 0.5)
            ny[i] = texgen._clamp01(-dy * inv * 0.5 + 0.5)
    return nx, ny


def build_layer(name, s):
    """The four float channels of one layer, in R G B A order, plus the raw
    height (which selftest measures and nothing ships)."""
    height, value, rough = LAYER_FN[name](s)
    # Normalise the height into [0,1] before differentiating it, so
    # NORMAL_STRENGTH means the same thing for every layer regardless of how
    # many octaves that layer's recipe happened to sum. Without this the
    # strength table would be reading the recipes' amplitude totals by the back
    # door, which is TerrainTex's ROUGH_GRAIN note's own complaint.
    height = texgen._normalise(height)
    nx, ny = _normal_xy(height, s, NORMAL_STRENGTH[name])
    vspread = SPREAD_VALUE_BY_LAYER.get(name, SPREAD_VALUE)
    return [_centre_to(value, vspread), nx, ny,
            _centre_to(rough, SPREAD_ROUGH)], height


def _pack_rgba(fields, s):
    """groundtex._pack_rgba, byte-for-byte the same arithmetic. Not imported,
    for _centre_to's reason: it is three lines and importing a private from a
    sibling tool to save three lines buys a coupling, not a saving."""
    out = bytearray(s * s * 4)
    for c, f in enumerate(fields):
        for i in range(s * s):
            out[i * 4 + c] = int(f[i] * 255.0 + 0.5)
    return bytes(out)


def generate(out_dir=OUT_DIR, size=SIZE, quiet=False):
    entries = []
    for name in LAYERS:
        fields, _ = build_layer(name, size)
        rgba = _pack_rgba(fields, size)
        fn = "of_terrain_%s.png" % name
        path = os.path.join(out_dir, fn)
        n_bytes = groundtex.write_png_rgba(path, size, size, rgba)
        with open(path, "rb") as fh:
            sha = hashlib.sha256(fh.read()).hexdigest()
        means = [sum(f) / len(f) for f in fields]
        entries.append({
            "layer": name,
            "index": LAYERS.index(name),
            "file": fn,
            "bytes": n_bytes,
            "sha256": sha,
            "tile_m": TILE_M[name],
            "texels_per_m": round(size / TILE_M[name], 1),
            "normal_strength": NORMAL_STRENGTH[name],
            "seed": SEED[name],
            "spread_value": SPREAD_VALUE_BY_LAYER.get(name, SPREAD_VALUE),
            "channel_mean": [round(m, 5) for m in means],
        })
        if not quiet:
            print("[terraintex] %-22s %8d B  tile %.1f m  %5.0f px/m  "
                  "means %s  sha %s.."
                  % (fn, n_bytes, TILE_M[name], size / TILE_M[name],
                     " ".join("%.3f" % m for m in means), sha[:10]))

    total = sum(e["bytes"] for e in entries)
    # RGBA8 plus a full mip chain is 4/3 of the base level.
    vram = int(len(LAYERS) * size * size * 4 * 4 / 3)
    manifest = {
        "_comment": [
            "Generated by tools/blender/terraintex.py. Do not hand-edit.",
            "The TERRAIN SPLAT LAYER SET (RN-2160). One RGBA texture per",
            "material layer; the shader blends them by slope, altitude and",
            "biome. Channels: R albedo value, G normal x, B normal y,",
            "A roughness detail. EVERY CHANNEL IS CENTRED ON 0.5, so a",
            "minified or faded sample is the exact identity of the term it",
            "drives and the layer set converges to the BiomePalette colour.",
            "Sampled on the per-quad chunk UV at INTEGER repeats per quad",
            "(RN-78's seam argument), colorSpace NoColorSpace,",
            "RepeatWrapping, mips on, anisotropy 16.",
            "Layer HUE and roughness BASE are client constants, not pixels:",
            "see web/src/render/materials/TerrainSplat.ts.",
            "Not part of surfaces.json: the terrain does not go through",
            "Surfaces.ts and no mesh role wears these maps.",
        ],
        "version": MANIFEST_VERSION,
        "zlib": zlib.ZLIB_RUNTIME_VERSION,
        "size_px": size,
        "spread_value": SPREAD_VALUE,
        "spread_rough": SPREAD_ROUGH,
        "channels": CHANNELS,
        "order": LAYERS,
        "total_bytes": total,
        "vram_bytes_rgba8_with_mips": vram,
        "layers": entries,
    }
    m_path = os.path.join(out_dir, "of_terrain.json")
    with open(m_path, "w", newline="\n", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=False)
        fh.write("\n")
    if not quiet:
        print("[terraintex] %d layers, %d B on disk, %.1f MB VRAM with mips"
              % (len(LAYERS), total, vram / 1048576.0))
        print("[terraintex] manifest %s" % m_path)
    return manifest


# ---------------------------------------------------------------------------
# Measurements. Every one of these has to be capable of failing, which is why
# each is paired with a negative control in selftest rather than merely printed
# (NUMBERS.md: "a probe that prints and never asserts passes forever").
# ---------------------------------------------------------------------------

def _wrap_vs_interior(f, s):
    """groundtex's tiling measurement, reused verbatim in shape: the worst step
    across the wrap against the worst step anywhere inside. A tiling field's
    wrap step is an ordinary step; a seam puts a cliff there."""
    edge = inner = 0.0
    for y in range(s):
        d = abs(f[y * s] - f[y * s + s - 1])
        if d > edge:
            edge = d
        for x in range(1, s):
            d = abs(f[y * s + x] - f[y * s + x - 1])
            if d > inner:
                inner = d
    for x in range(s):
        d = abs(f[x] - f[(s - 1) * s + x])
        if d > edge:
            edge = d
    for y in range(1, s):
        for x in range(s):
            d = abs(f[y * s + x] - f[(y - 1) * s + x])
            if d > inner:
                inner = d
    return edge, inner


def _grad_mags(f, s):
    out = []
    for y in range(s):
        yp = ((y + 1) % s) * s
        row = y * s
        for x in range(s):
            xp = (x + 1) % s
            dx = f[row + xp] - f[row + x]
            dy = f[yp + x] - f[row + x]
            out.append(math.sqrt(dx * dx + dy * dy))
    return out


# THE SCREE INSTRUMENT IS groundtex's, NOT A NEW ONE, and the first version of
# this module is why that is worth a paragraph. It shipped a `_bimodality`
# helper measuring the share of total gradient carried by the top 1 per cent of
# texels, and the number it returned for scree (0.038) sat beside 0.033 for
# grass and 0.034 for SMOOTH SNOW. The metric was not wrong about the field, it
# was the wrong metric: a terraced worley field's step population is on the
# order of fifteen per cent of the tile, so a top-1% window cannot contain it,
# and every noise field on earth scores about 0.03 there because that is just
# the tail of a Rayleigh gradient distribution. It was a metric that is nearly
# flat in its own independent variable, which NUMBERS.md names outright.
#
# groundtex._facet_stats already measures exactly this claim, already has a
# published bar (flat fraction >= 0.5 AND p99 >= 4x median) and already has a
# negative control that fails it (plain fbm). Using it here means one authority
# on what "flat facets joined by sharp steps" means across both modules, and it
# means this lane's scree is measured against the same bar groundtex's scree
# relief channel was.


def _skewness(vals):
    n = len(vals)
    mean = sum(vals) / n
    m2 = sum((v - mean) * (v - mean) for v in vals) / n
    m3 = sum((v - mean) * (v - mean) * (v - mean) for v in vals) / n
    sd = math.sqrt(m2)
    return m3 / (sd * sd * sd) if sd > 1e-12 else 0.0


def _axis_skew(f, s, along_v):
    """Skewness of the directional derivative along one axis. A wind-worked
    surface (sastrugi, ripples) has a long gentle slope one way and a short
    steep one the other, so this is signed and non-zero; symmetric noise
    returns zero to within noise and that is the negative control."""
    d = []
    for y in range(s):
        row = y * s
        yp = ((y + 1) % s) * s
        for x in range(s):
            if along_v:
                d.append(f[yp + x] - f[row + x])
            else:
                d.append(f[row + ((x + 1) % s)] - f[row + x])
    return _skewness(d)


def _anisotropy(f, s):
    """Mean |d/dx| over mean |d/dy|. 1.0 is isotropic; a directional field is
    far from 1 and which side it is on says which way it runs."""
    sx = sy = 0.0
    for y in range(s):
        row = y * s
        yp = ((y + 1) % s) * s
        for x in range(s):
            sx += abs(f[row + ((x + 1) % s)] - f[row + x])
            sy += abs(f[yp + x] - f[row + x])
    return sx / sy if sy > 1e-12 else 0.0


# ---------------------------------------------------------------------------
# check: assert the SHIPPED BYTES. Everything here reads the PNG back, because
# the shipped bytes are what the sampler averages and what the mip chain
# converges to, and a float field that was correct before quantisation is not
# evidence about either.
# ---------------------------------------------------------------------------

def check_map(out_dir=OUT_DIR, verbose=True):
    lines = []
    ok = True

    def say(good, msg):
        nonlocal ok
        ok = ok and good
        lines.append(("  ok  " if good else "  FAIL") + "  " + msg)

    m_path = os.path.join(out_dir, "of_terrain.json")
    if not os.path.exists(m_path):
        say(False, "manifest %s is missing; run terraintex.py" % m_path)
        if verbose:
            print("\n".join(lines))
        return ok, lines
    with open(m_path, "r", encoding="utf-8") as fh:
        man = json.load(fh)

    say(man.get("version") == MANIFEST_VERSION,
        "manifest version %s == %d" % (man.get("version"), MANIFEST_VERSION))
    say(man.get("order") == LAYERS,
        "layer order %s == %s" % (man.get("order"), LAYERS))

    s = man["size_px"]
    for ent in man["layers"]:
        name = ent["layer"]
        path = os.path.join(out_dir, ent["file"])
        if not os.path.exists(path):
            say(False, "%s is missing" % ent["file"])
            continue
        with open(path, "rb") as fh:
            blob = fh.read()
        say(hashlib.sha256(blob).hexdigest() == ent["sha256"],
            "%s sha256 matches the manifest" % ent["file"])
        say(len(blob) == ent["bytes"],
            "%s is %d bytes as declared" % (ent["file"], ent["bytes"]))

        w, h, px = groundtex.read_png_rgba(path)
        say((w, h) == (s, s), "%s is %dx%d" % (ent["file"], w, h))

        # THE CONVERGENCE RULE, on the shipped bytes. This is the assertion the
        # whole palette-harmony claim rests on: if a channel's mean is not 0.5
        # then a minified sample is not the identity, and the world changes
        # colour as the player walks away from it.
        for c, cn in enumerate("rgba"):
            chan = [px[i * 4 + c] / 255.0 for i in range(s * s)]
            mean = sum(chan) / len(chan)
            tol = NORMAL_MEAN_TOL if cn in "gb" else 0.006
            say(abs(mean - 0.5) <= tol,
                "%s.%s mean %.5f is within %.4f of 0.5"
                % (name, cn, mean, tol))

        # Tiling, on the quantised bytes, per channel.
        for c, cn in enumerate("rgba"):
            chan = [px[i * 4 + c] / 255.0 for i in range(s * s)]
            edge, inner = _wrap_vs_interior(chan, s)
            say(edge <= inner + 1e-9,
                "%s.%s wrap step %.4f <= interior %.4f" % (name, cn, edge, inner))

    if verbose:
        print("\n".join(lines))
    return ok, lines


def selftest():
    """The field claims, each with a control that proves the measurement can
    fail. Run at a REDUCED size: every claim here is about a distribution or a
    ratio, none is about a texel, and 256 makes the suite a few seconds instead
    of a few minutes. The size-dependent claims (mean, tiling) are re-asserted
    on the shipped 1024 bytes by `check`, which is the arm that matters."""
    s = 256
    lines = []
    ok = True

    def say(good, msg):
        nonlocal ok
        ok = ok and good
        lines.append(("  ok  " if good else "  FAIL") + "  " + msg)

    # 1. Every layer's value and roughness centre on 0.5 before quantisation.
    fields = {}
    heights = {}
    for name in LAYERS:
        f, hgt = build_layer(name, s)
        fields[name] = f
        heights[name] = hgt
        for c, cn in enumerate("rgba"):
            mean = sum(f[c]) / len(f[c])
            tol = NORMAL_MEAN_TOL if cn in "gb" else 0.006
            say(abs(mean - 0.5) <= tol,
                "%s.%s float mean %.5f centred" % (name, cn, mean))

    # 2. Tiling on the float fields, per layer, on the height (which every
    #    channel is derived from, so a seam anywhere shows here).
    for name in LAYERS:
        edge, inner = _wrap_vs_interior(heights[name], s)
        say(edge <= inner + 1e-9,
            "%s height wrap step %.4f <= interior %.4f" % (name, edge, inner))

    # 3. scree is FLAT FACETS JOINED BY SHARP STEPS, on groundtex's own bar,
    #    and TWO controls have to fail it. One control would have left the bar
    #    untested from below; grass and snow bracket it from the rough side and
    #    the smooth side, which are the two different ways a field can be not
    #    a talus slope.
    f_scree, m_scree, p_scree = groundtex._facet_stats(
        _grad_mags(heights["scree"], s))
    say(f_scree >= 0.5 and p_scree >= 4.0 * m_scree,
        "scree facets: %.3f flat, p99 %.5f is %.1fx median"
        % (f_scree, p_scree, p_scree / m_scree if m_scree > 0 else 0.0))
    for ctl in ("grass", "snow"):
        f_c, m_c, p_c = groundtex._facet_stats(_grad_mags(heights[ctl], s))
        say(not (f_c >= 0.5 and p_c >= 4.0 * m_c),
            "%s rejected as facets: %.3f flat, p99 %.1fx median"
            % (ctl, f_c, p_c / m_c if m_c > 0 else 0.0))

    # 4. cliff is DIRECTIONAL and rock is not. Same shape of control.
    a_cliff = _anisotropy(heights["cliff"], s)
    a_rock = _anisotropy(heights["rock"], s)
    say(a_cliff > 1.35, "cliff anisotropy %.3f is directional" % a_cliff)
    say(0.75 < a_rock < 1.35, "rock anisotropy %.3f is isotropic" % a_rock)

    # 5. snow's sastrugi are ASYMMETRIC across the wind axis, and the control
    #    is the same field's OTHER axis, which has no sastrugi in it.
    sk_across = _axis_skew(heights["snow"], s, along_v=False)
    sk_along = _axis_skew(heights["snow"], s, along_v=True)
    say(abs(sk_across) > abs(sk_along),
        "snow derivative skew across %.4f exceeds along %.4f"
        % (sk_across, sk_along))

    # 6. dirt's histogram has a thin dark tail (plateau mass, deep cracks), and
    #    the control is grass, whose mass is skewed the other way.
    sk_dirt = _skewness(heights["dirt"])
    sk_grass = _skewness(heights["grass"])
    say(sk_dirt < sk_grass,
        "dirt height skew %.4f is below grass %.4f" % (sk_dirt, sk_grass))

    # 7. snow's VALUE contrast is about a third of the others'. Authored, and
    #    therefore asserted: the centring step would otherwise silently restore
    #    it, which is exactly the trap this claim exists to catch.
    def spread(f):
        srt = sorted(f)
        return srt[int(len(srt) * 0.98) - 1] - srt[int(len(srt) * 0.02)]
    v_snow = spread(fields["snow"][0])
    v_rock = spread(fields["rock"][0])
    say(v_snow < v_rock * 0.55,
        "snow value p2-p98 spread %.4f is under 0.55x rock's %.4f"
        % (v_snow, v_rock))

    # 8. No transcendental reached the fields: a determinism smoke test rather
    #    than a proof. Two builds of one layer in one process must be
    #    bit-identical, which catches an accidental dict-ordering or id()
    #    dependence. It cannot catch a libm difference, and `check`'s sha
    #    against a rebuild on another box is the arm that can.
    again, _ = build_layer("rock", 128)
    once, _ = build_layer("rock", 128)
    say(all(again[c] == once[c] for c in range(4)),
        "rock rebuilds bit-identically in-process")

    print("\n".join(lines))
    print("\n%s  %d check(s)" % ("TERRAINTEX SELFTEST PASS" if ok
                                 else "TERRAINTEX SELFTEST FAIL", len(lines)))
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("cmd", nargs="?", default="build",
                    choices=["build", "selftest", "check"])
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--size", type=int, default=SIZE)
    args = ap.parse_args()
    if args.cmd == "selftest":
        return 0 if selftest() else 1
    if args.cmd == "check":
        ok, lines = check_map(args.out)
        print("\n%s  %d check(s)" % ("TERRAINTEX PASS" if ok
                                     else "TERRAINTEX FAIL", len(lines)))
        return 0 if ok else 1
    generate(args.out, args.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
