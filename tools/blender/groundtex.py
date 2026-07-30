#!/usr/bin/env python3
"""
groundtex.py - the TERRAIN's ground-detail texture. Stdlib only, no Blender.

    python tools/blender/groundtex.py            # write assets/textures/dist/
    python tools/blender/groundtex.py selftest   # prove the encoder and fields
    python tools/blender/groundtex.py check      # assert the SHIPPED bytes

WHY THIS IS A SEPARATE MODULE AND NOT A texgen.py FAMILY (RN-77). texgen's two
families are normal + ORM pairs for MESH materials: they ride glTF UVs in
metres and are consumed through three's stock map slots. The terrain is a
ShaderMaterial on a cubed-sphere quadtree with NO surface parameterisation and
no tangent frame; what it can consume is a VALUE texture sampled on the
per-quad chunk UV (RN-50's coordinate), whose channels modulate the albedo the
shader already computed and feed the surface-gradient bump it already runs. A
normal map is the wrong artifact for that consumer, so this module ships ONE
RGBA value texture instead, and surfaces.json is not touched: the terrain does
not go through Surfaces.ts, and adding a family there would upload two maps to
every machine batch for nothing.

It IMPORTS texgen for the deterministic primitives (hash noise, worley, the
PNG chunk writer and filter search) rather than copying them, because a copy
of a hash is a second authority on what the hash is. texgen is not modified.

THE FOUR CHANNELS, all centred on 0.5 so a minified sample converges to the
IDENTITY of the modulation they drive (mean 0.5 -> albedo * 1.0). That is the
same self-confinement the mip chain gives for free: at range, the texture
fades ITSELF before any distance fade has to.

    R  grass clump   tuft-scale organic clumping. What breaks a lawn into
                     growth. Worley clumps ~20 cm at the shipped tile.
    G  rock grain    fractured facet grain for exposed rock and scree.
                     Two worley layers, 40 cm and 15 cm, plus grit.
    B  granular      fine sand/soil grain plus elongated wind ripples
                     (anisotropic noise; the only directional field here).
    A  clod          soil clods and litter at ~30 cm, for dirt and forest
                     floor.

THE SECOND TEXTURE, of_ground_relief.png: four packed HEIGHT fields for the
terrain's surface-gradient bump (lighting normal only, never geometry). The
first ground pass proved, by photograph, that SMOOTH symmetric noise fed to a
normal-perturbation bump reads as choppy water at every amplitude: a smooth
metre-scale undulation is liquid's visual signature. What separates dirt from
water is ASYMMETRY: sharp crests over rounded bases, flat facets with sharp
steps, skewed histograms. Every relief channel therefore carries a measured
asymmetry, asserted in selftest with negative controls that prove each
measurement is capable of failing:

    R  ripple   wind ripples in sand: long gentle stoss slope, short steep
                lee slope. The asymmetry lives in the skewness of the
                directional derivative along the ripple axis.
    G  clod     rounded dirt clods over narrower, deeper interstices. The
                asymmetry is the value histogram's skew: plateau mass with
                a thin dark tail down in the cracks.
    B  scree    flat facets joined by 1-3 texel steps. The signature is a
                bimodal gradient distribution: mostly near zero, plus a
                sparse population of large steps.
    A  litter   overlapping flat leaf-litter flakes, the same facet-plus-
                sharp-step signature one size down from B.

Relief channels are centred on 0.5 exactly like the value channels, because
the consumer samples through hardware mips and a minified sample converging
to the channel mean must be the flat (no bump) identity.

NO IDENTIFIABLE FEATURE IN ANY CHANNEL, deliberately. texgen's scratch lesson:
a shared tiling texture cannot carry a feature that is meant to look unique,
because the most identifiable thing in the tile is the strongest cue that the
tile repeats. Every field here is texture-free noise with structure, no
scratches, no cracks with a rememberable shape.

DETERMINISM: texgen's own contract, inherited by import. No RNG, no
transcendentals (math.sqrt only), no timestamps, no text chunks; zlib pinned
by texgen's parameters and recorded in the manifest.

TILING is by construction (every lattice wraps with %) and is ASSERTED twice:
selftest checks wrap-step <= worst interior step per channel on the float
fields, and `check` re-asserts it on the SHIPPED quantised bytes, because the
shipped bytes are what the sampler wraps.
"""

import hashlib
import json
import math
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import texgen  # noqa: E402  (deterministic primitives; texgen is NOT modified)

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(ROOT, "assets", "textures", "dist")

MANIFEST_VERSION = 1
SIZE = 1024

# Percentile window the remap stretches to. p2..p98 of each raw field lands on
# 0.5 +/- SPREAD, so every channel arrives at the shader with a KNOWN, equal
# amplitude and the per-biome weights in BiomePalette.ts mean the same thing
# for every channel. Without this the worley channels would ship hotter than
# the fbm ones and the weights would be lying about their own ratios.
SPREAD = 0.36


# ---------------------------------------------------------------------------
# Anisotropic periodic value noise: separate lattice periods per axis, so a
# cell is a stretched blob. This is the wind-ripple field for the B channel.
# Wraps in both axes exactly as texgen._noise_field does.
# ---------------------------------------------------------------------------

def _noise_aniso(w, h, pu, pv, seed):
    tab = [texgen._hash01(ix, iy, seed) for iy in range(pv) for ix in range(pu)]
    cols = []
    for x in range(w):
        f = x * pu / w
        i0 = int(f) % pu
        cols.append((i0, (i0 + 1) % pu, texgen._smooth(f - int(f))))
    out = [0.0] * (w * h)
    for y in range(h):
        f = y * pv / h
        j0 = int(f) % pv
        j1 = (j0 + 1) % pv
        ty = texgen._smooth(f - int(f))
        r0 = j0 * pu
        r1 = j1 * pu
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


# ---------------------------------------------------------------------------
# The four fields. Each returns floats roughly in [0, 1]; _centre() below is
# what actually fixes the mean and spread, so these only have to get the
# STRUCTURE right.
# ---------------------------------------------------------------------------

def _field_grass(s):
    """Connected turf patches, not dots. The first version was half worley F1,
    whose signature is a lattice of bright circular blobs at cell centres, and
    the offset-by-half sheet read as polka-dot ground before it ever reached
    the terrain (the failure mode was named, then seen, then removed). Patches
    come from SHARPENED fbm, which plateaus into irregular connected shapes;
    the worley tuft term stays but at a weight where it textures the patches
    rather than drawing its own lattice."""
    patch = texgen._fbm(s, s, 7, 4, seed=3301)
    fine = texgen._fbm(s, s, 21, 3, seed=3313)
    tufts = texgen._worley(s, s, 22, seed=3307)
    out = [0.0] * (s * s)
    for i in range(s * s):
        p = texgen._smoothstep(0.38, 0.66, patch[i])
        t = 1.0 - tufts[i]
        out[i] = 0.52 * p + 0.30 * fine[i] + 0.18 * t * t
    return out


def _field_rock(s):
    facets = texgen._worley(s, s, 9, seed=4409)
    chips = texgen._worley(s, s, 24, seed=4415)
    grit = texgen._fbm(s, s, 40, 2, seed=4421)
    out = [0.0] * (s * s)
    for i in range(s * s):
        a = 1.0 - facets[i]
        b = 1.0 - chips[i]
        out[i] = 0.55 * a * a + 0.30 * b * b + 0.15 * grit[i]
    return out


def _field_granular(s):
    grain = texgen._fbm(s, s, 52, 2, seed=5501)
    ripple = _noise_aniso(s, s, 36, 9, seed=5507)
    out = [0.0] * (s * s)
    for i in range(s * s):
        out[i] = 0.62 * grain[i] + 0.38 * ripple[i]
    return out


def _field_clod(s):
    """Soil clods. The worley term is GATED by the fbm so clods cluster into
    banks instead of tiling the plane with one dot per cell, which is the same
    polka-dot signature the grass channel had to lose."""
    lumps = texgen._fbm(s, s, 11, 3, seed=6607)
    clods = texgen._worley(s, s, 13, seed=6613)
    out = [0.0] * (s * s)
    for i in range(s * s):
        c = 1.0 - clods[i]
        out[i] = 0.60 * lumps[i] + 0.40 * c * c * (0.45 + 0.55 * lumps[i])
    return out


CHANNELS = (
    ("R", "grass clump", _field_grass),
    ("G", "rock grain", _field_rock),
    ("B", "granular", _field_granular),
    ("A", "clod", _field_clod),
)


# ---------------------------------------------------------------------------
# RELIEF fields: of_ground_relief.png, HEIGHT fields for the surface-gradient
# bump. The failure mode every one of these exists to dodge is SYMMETRIC-
# WATER: smooth noise whose ups mirror its downs photographs as liquid no
# matter the amplitude, so each field's construction bakes in a measurable
# asymmetry and selftest measures it. Same determinism contract as the value
# fields: texgen's hash, no RNG, no transcendentals beyond math.sqrt. The
# ripple profile in particular is built from piecewise smoothstep arithmetic
# instead of sin, because sin is exactly the transcendental the contract
# excludes.
# ---------------------------------------------------------------------------

RIPPLE_WAVES = 11    # integer, so the sawtooth wraps; ~93 texels/wave at 1024
RIPPLE_STOSS = 0.78  # fraction of each wavelength spent on the gentle rise


def _relief_ripple(s, stoss=RIPPLE_STOSS):
    """Wind ripples: a noise-warped sawtooth. Long shallow stoss slope over
    `stoss` of the wavelength, short steep lee over the rest, which is the
    profile wind actually cuts into sand. The asymmetry claim is in the
    x-derivative: many small positive steps up the stoss, few large negative
    ones down the lee, a skew a symmetric wave cannot produce (the negative
    control in selftest builds the stoss=0.5 triangle and watches it fail).

    The warp field bends the crest lines so no straight feature repeats
    across tiles, and its amplitude is deliberately capped: if the local
    phase velocity ever reversed, the reversed patch would carry a MIRRORED
    profile and its opposite skew would cancel the claim. Warp is fbm at
    period 3 with slope well under RIPPLE_WAVES, so the wave vector never
    flips sign."""
    warp = texgen._fbm(s, s, 3, 2, seed=7703)
    env = texgen._fbm(s, s, 4, 2, seed=7717)     # ripple strength wanders
    grain = texgen._fbm(s, s, 30, 2, seed=7723)  # sand grain riding on top
    out = [0.0] * (s * s)
    for y in range(s):
        base = y * s
        for x in range(s):
            i = base + x
            ph = (RIPPLE_WAVES * x / s + 0.5 * (2.0 * warp[i] - 1.0)) % 1.0
            if ph < stoss:
                prof = texgen._smoothstep(0.0, stoss, ph)
            else:
                prof = 1.0 - texgen._smoothstep(stoss, 1.0, ph)
            out[i] = prof * (0.55 + 0.45 * env[i]) + 0.08 * grain[i]
    return out


def _relief_clod(s):
    """Dirt clods and crumb: rounded lumps separated by narrower, deeper
    cracks. The clod boundaries are the level sets of a wiggled fbm (bands of
    `t` near 0), which form a connected crack NETWORK rather than the
    polka-dot lattice a bare worley would draw (the same failure the value
    channels had to lose). The fourth root rounds each clod fast off the
    crack floor and flattens it on top, which is what skews the histogram:
    most texels near the plateau, a thin tail falling into the interstices.
    Selftest asserts that skew; plain fbm is the negative control."""
    lobe = texgen._fbm(s, s, 9, 3, seed=7801)
    wig = texgen._fbm(s, s, 6, 2, seed=7807)     # wiggles the crack contours
    grain = texgen._fbm(s, s, 34, 2, seed=7813)  # crumb texture on the tops
    out = [0.0] * (s * s)
    for i in range(s * s):
        t = ((lobe[i] + 0.3 * (wig[i] - 0.5)) * 3.0) % 1.0
        b = 2.0 * t if t < 0.5 else 2.0 * (1.0 - t)   # 0 at crack, 1 mid-clod
        dome = math.sqrt(math.sqrt(b))
        out[i] = dome * (0.82 + 0.18 * grain[i])
    return out


def _terrace(v, levels, edge):
    """Quantise v to `levels` plateaus with a sharpened transition occupying
    the top (1 - edge) of each band. The transition is a smoothstep in VALUE
    space, so its width in texels is that value width divided by the local
    gradient: 1-3 texels at the shipped 1024 for the fields below."""
    t = texgen._clamp01(v) * levels
    f = math.floor(t)
    return (f + texgen._smoothstep(edge, 1.0, t - f)) / levels


def _relief_scree(s):
    """Scree and talus: flat facets joined by sharp steps, a terraced warped
    noise. Two terrace scales, a coarse one for the facets and a finer one
    for stones riding on them; both leave the field exactly constant across
    a plateau, so the gradient distribution is bimodal by construction:
    mostly zero, plus sparse steps of a whole band height. That bimodality
    is the anti-water claim and selftest measures it (flat fraction and
    p99 vs median gradient); smooth fbm is the negative control."""
    face = texgen._fbm(s, s, 6, 3, seed=7901)
    wob = texgen._fbm(s, s, 14, 2, seed=7907)   # wiggles the facet contours
    fine = texgen._fbm(s, s, 12, 2, seed=7913)
    out = [0.0] * (s * s)
    for i in range(s * s):
        q1 = _terrace(face[i] + 0.22 * (wob[i] - 0.5), 6, 0.94)
        q2 = _terrace(fine[i], 5, 0.94)
        out[i] = 0.78 * q1 + 0.22 * q2
    return out


def _relief_litter(s):
    """Forest-floor leaf litter: many overlapping flat flakes, each stamped
    dead flat with a sharp edge, later stamps overwriting earlier ones. A
    lattice of round stamps is the polka-dot failure by another name, so the
    stamps overlap hard (radius comparable to the cell), squash into per-
    flake ellipses, and snap to four shared height levels so neighbouring
    same-level flakes fuse into larger mats with no internal edge. What
    remains is the facet signature at leaf scale: interiors exactly flat,
    edges one to two texels, the same bimodal gradient claim as B one size
    down. Two jittered layers, fixed stamp order, torus wrap on the write
    index, so the field is deterministic and tiles."""
    grid = 24                      # stamps per axis per layer
    cell = s / grid
    e = max(0.75, 1.6 * s / 1024.0)   # edge width in texels, sharp by intent
    soil = texgen._fbm(s, s, 18, 2, seed=8101)
    out = [0.04 + 0.10 * soil[i] for i in range(s * s)]  # gaps show soil
    for layer in range(2):
        seed = 8111 + 97 * layer
        for cy in range(grid):
            for cx in range(grid):
                jx = texgen._hash01(cx, cy, seed)
                jy = texgen._hash01(cx, cy, seed + 1)
                hr = texgen._hash01(cx, cy, seed + 2)
                hl = texgen._hash01(cx, cy, seed + 3)
                ha = texgen._hash01(cx, cy, seed + 4)
                hb = texgen._hash01(cx, cy, seed + 5)
                cxt = (cx + jx) * cell
                cyt = (cy + jy) * cell
                r = cell * (0.42 + 0.34 * hr)
                lv = min(3, int(hl * 4.0))
                level = 0.30 + 0.46 * (lv / 3.0)
                axs = 0.80 + 0.45 * ha    # per-flake squash, breaks circles
                ays = 0.80 + 0.45 * hb
                reach = int(r / min(axs, ays) + e) + 2
                ix, iy = int(cxt), int(cyt)
                for yy in range(iy - reach, iy + reach + 1):
                    row = (yy % s) * s
                    dy = (yy - cyt) * ays
                    for xx in range(ix - reach, ix + reach + 1):
                        dx = (xx - cxt) * axs
                        d = math.sqrt(dx * dx + dy * dy)
                        if d >= r:
                            continue
                        cov = 1.0 - texgen._smoothstep(r - e, r, d)
                        j = row + (xx % s)
                        out[j] += cov * (level - out[j])
    return out


RELIEF_CHANNELS = (
    ("R", "ripple", _relief_ripple),
    ("G", "clod", _relief_clod),
    ("B", "scree", _relief_scree),
    ("A", "litter", _relief_litter),
)


def _centre(field):
    """Remap so the p2..p98 window spans 0.5 +/- SPREAD, then clamp.

    Percentiles rather than min/max because a worley field's extremes are a
    handful of texels at cell centres, and scaling by them would leave the
    body of the field flat. Centred on the MEAN, not the median: the mip
    chain converges to the mean, so the mean is the value that has to be the
    modulation identity, and a worley-squared field is skewed enough that the
    two differ by 0.03 (the first version centred the median and shipped a 3%
    net brighten, which is the macro-tint lesson repeating). Deterministic:
    sorted() and sum() on floats produced by deterministic arithmetic."""
    srt = sorted(field)
    n = len(srt)
    lo = srt[int(n * 0.02)]
    hi = srt[int(n * 0.98) - 1]
    mid = sum(field) / n
    scale = (2.0 * SPREAD) / (hi - lo) if hi > lo else 0.0
    return [texgen._clamp01(0.5 + (v - mid) * scale) for v in field]


def _pack_rgba(fields, s):
    out = bytearray(s * s * 4)
    for c, f in enumerate(fields):
        for i in range(s * s):
            out[i * 4 + c] = int(f[i] * 255.0 + 0.5)
    return bytes(out)


# ---------------------------------------------------------------------------
# RGBA PNG write/read. texgen's writer is RGB (colour type 2); the terrain
# texture is four packed channels, so this pair speaks colour type 6. The
# chunk writer and the per-scanline filter search are texgen's own.
# ---------------------------------------------------------------------------

def write_png_rgba(path, w, h, rgba):
    if len(rgba) != w * h * 4:
        raise ValueError("expected %d bytes, got %d" % (w * h * 4, len(rgba)))
    raw = texgen._filter_rows(rgba, w, h, 4)
    co = zlib.compressobj(texgen.ZLIB_LEVEL, zlib.DEFLATED, texgen.ZLIB_WBITS,
                          texgen.ZLIB_MEMLEVEL, zlib.Z_DEFAULT_STRATEGY)
    idat = co.compress(raw) + co.flush()
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    blob = (b"\x89PNG\r\n\x1a\n" + texgen._chunk(b"IHDR", ihdr)
            + texgen._chunk(b"IDAT", idat) + texgen._chunk(b"IEND", b""))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(blob)
    return len(blob)


def read_png_rgba(path):
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
# build / check / selftest
# ---------------------------------------------------------------------------

def build_fields(s):
    return [_centre(fn(s)) for _, _, fn in CHANNELS]


def build_relief_fields(s):
    return [_centre(fn(s)) for _, _, fn in RELIEF_CHANNELS]


def generate(out_dir=OUT_DIR, size=SIZE, quiet=False):
    fields = build_fields(size)
    rgba = _pack_rgba(fields, size)
    p_png = os.path.join(out_dir, "of_ground.png")
    n_bytes = write_png_rgba(p_png, size, size, rgba)
    with open(p_png, "rb") as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()
    manifest = {
        "_comment": [
            "Generated by tools/blender/groundtex.py. Do not hand-edit.",
            "ONE RGBA value texture for the TERRAIN shader (RN-77/RN-78).",
            "Channels modulate computed albedo and feed the surface-gradient",
            "bump; all four are centred on 0.5 so a minified sample converges",
            "to the identity. Sampled on the per-quad chunk UV at INTEGER",
            "repeats per quad, colorSpace NoColorSpace, RepeatWrapping.",
            "Not part of surfaces.json: the terrain does not go through",
            "Surfaces.ts and no mesh role wears this map.",
        ],
        "version": MANIFEST_VERSION,
        "zlib": zlib.ZLIB_RUNTIME_VERSION,
        "file": "of_ground.png",
        "bytes": n_bytes,
        "sha256": sha,
        "size_px": size,
        "spread": SPREAD,
        "channels": {c: label for c, label, _ in CHANNELS},
    }
    m_path = os.path.join(out_dir, "of_ground.json")
    with open(m_path, "w", newline="\n", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=False)
        fh.write("\n")
    if not quiet:
        print("[groundtex] of_ground.png %d B (%dx%d RGBA), sha %s.."
              % (n_bytes, size, size, sha[:12]))
        print("[groundtex] manifest %s" % m_path)
    return manifest


def generate_relief(out_dir=OUT_DIR, size=SIZE, quiet=False):
    """The relief pair. A separate function on purpose: generate() above must
    keep producing byte-identical of_ground.png/of_ground.json, so the relief
    family adds files next to them rather than reaching into that code."""
    fields = build_relief_fields(size)
    rgba = _pack_rgba(fields, size)
    p_png = os.path.join(out_dir, "of_ground_relief.png")
    n_bytes = write_png_rgba(p_png, size, size, rgba)
    with open(p_png, "rb") as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()
    manifest = {
        "_comment": [
            "Generated by tools/blender/groundtex.py. Do not hand-edit.",
            "Four packed HEIGHT fields for the terrain's surface-gradient",
            "bump (lighting normal only, never geometry). Same sampling",
            "contract as of_ground.png: per-quad chunk UV at integer",
            "repeats, colorSpace NoColorSpace, RepeatWrapping; every",
            "channel is centred on 0.5 so a minified sample converges to",
            "the flat identity. Every channel is deliberately ASYMMETRIC",
            "(skewed derivative, skewed histogram, or flat facets with",
            "sharp steps): smooth symmetric noise under a bump photographs",
            "as water, and these fields exist to not be water.",
        ],
        "version": MANIFEST_VERSION,
        "zlib": zlib.ZLIB_RUNTIME_VERSION,
        "file": "of_ground_relief.png",
        "bytes": n_bytes,
        "sha256": sha,
        "size_px": size,
        "spread": SPREAD,
        "channels": {c: label for c, label, _ in RELIEF_CHANNELS},
    }
    m_path = os.path.join(out_dir, "of_ground_relief.json")
    with open(m_path, "w", newline="\n", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2, sort_keys=False)
        fh.write("\n")
    if not quiet:
        print("[groundtex] of_ground_relief.png %d B (%dx%d RGBA), sha %s.."
              % (n_bytes, size, size, sha[:12]))
        print("[groundtex] manifest %s" % m_path)
    return manifest


def _wrap_vs_interior(f, s):
    """texgen selftest 7's subject, reused: worst step across the wrap against
    the worst step anywhere inside. A tiling field's wrap step is an ordinary
    step; a seam puts a cliff there."""
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


# ---------------------------------------------------------------------------
# Asymmetry statistics, plain Python sums for determinism. These are the
# measurements the relief channels stake their claims on.
# ---------------------------------------------------------------------------

def _skewness(vals):
    """E[(x - mu)^3] / sigma^3. Zero for anything mirror-symmetric, which is
    exactly why it can tell a sand ripple from a water wave."""
    n = len(vals)
    mu = sum(vals) / n
    m2 = m3 = 0.0
    for v in vals:
        d = v - mu
        d2 = d * d
        m2 += d2
        m3 += d2 * d
    m2 /= n
    m3 /= n
    return m3 / (m2 * math.sqrt(m2)) if m2 > 0.0 else 0.0


def _dx_diffs(f, s):
    """Forward finite difference along x with torus wrap: the directional
    derivative along the ripple axis the R channel is built on."""
    out = []
    for y in range(s):
        row = y * s
        for x in range(s):
            out.append(f[row + (x + 1) % s] - f[row + x])
    return out


def _grad_mags(f, s):
    """|gradient| per texel from wrapped forward differences."""
    out = []
    for y in range(s):
        row = y * s
        nrow = ((y + 1) % s) * s
        for x in range(s):
            dx = f[row + (x + 1) % s] - f[row + x]
            dy = f[nrow + x] - f[row + x]
            out.append(math.sqrt(dx * dx + dy * dy))
    return out


def _facet_stats(grads):
    """The flat-facet signature: (flat fraction, median, p99) of |grad|.
    Faceted ground is mostly flat with sparse big steps; smooth noise is
    neither, so it fails at least one of the two derived checks."""
    srt = sorted(grads)
    n = len(srt)
    mean = sum(grads) / n
    flat = sum(1 for g in grads if g <= 0.35 * mean) / n
    return flat, srt[n // 2], srt[int(n * 0.99)]


def _check_pair(out_dir, say, manifest_name, channels, tag):
    """One manifest + PNG pair: sha against manifest, per-channel mean,
    spread, and tiling on the quantised bytes (what the sampler wraps)."""
    m_path = os.path.join(out_dir, manifest_name)
    if not os.path.isfile(m_path):
        say(False, tag + "manifest", "MISSING: %s" % m_path)
        return
    with open(m_path, "r", encoding="utf-8") as fh:
        man = json.load(fh)
    say(man.get("version") == MANIFEST_VERSION, tag + "manifest",
        "version %r, zlib %s" % (man.get("version"), man.get("zlib")))

    path = os.path.join(out_dir, man["file"])
    if not os.path.isfile(path):
        say(False, tag + "file", "MISSING: %s" % path)
        return
    with open(path, "rb") as fh:
        blob = fh.read()
    digest = hashlib.sha256(blob).hexdigest()
    say(digest == man.get("sha256"), tag + "sha256",
        "%s.. %s manifest" % (digest[:12],
                              "==" if digest == man.get("sha256") else "!="))
    w, h, rgba = read_png_rgba(path)
    say(w == h == man["size_px"] and len(blob) == man["bytes"], tag + "file",
        "%dx%d, %d B" % (w, h, len(blob)))

    n = w * h
    for c, (cname, label, _) in enumerate(channels):
        vals = rgba[c::4]
        lo, hi = min(vals), max(vals)
        mean = sum(vals) / n
        say(abs(mean - 127.5) <= 6.0, "%s%s mean" % (tag, cname),
            "%.1f (need 127.5 +/- 6) [%s]" % (mean, label))
        say(hi - lo >= 96, "%s%s spread" % (tag, cname),
            "%d counts, range %d..%d" % (hi - lo, lo, hi))
        chan = [float(v) for v in vals]
        edge, inner = _wrap_vs_interior(chan, w)
        say(edge <= inner, "%s%s tiles" % (tag, cname),
            "wrap step %.0f vs worst interior %.0f" % (edge, inner))
    say(True, tag + "coverage", "%d texels examined, 0 skipped" % n)


def check_map(out_dir=OUT_DIR, verbose=True):
    """Assert the SHIPPED bytes of both pairs: the value texture and the
    relief texture, each against its own manifest."""
    lines, ok = [], True

    def say(good, label, detail):
        nonlocal ok
        ok = ok and good
        lines.append("  [%s] %-26s %s" % ("ok" if good else "FAIL", label, detail))

    _check_pair(out_dir, say, "of_ground.json", CHANNELS, "")
    _check_pair(out_dir, say, "of_ground_relief.json", RELIEF_CHANNELS, "relief ")
    if verbose:
        for ln in lines:
            print(ln)
    return ok, lines


def selftest():
    import tempfile
    fails = []
    count = [0]

    def check(label, ok, detail=""):
        count[0] += 1
        print("  [%s] %-28s %s" % ("ok" if ok else "FAIL", label, detail))
        if not ok:
            fails.append(label)

    tmp = tempfile.mkdtemp(prefix="groundtex_")

    # 1. RGBA encoder round trip. Catches a filter that does not invert at
    #    bpp 4, which texgen's own selftest cannot see (it runs bpp 3).
    w = h = 33
    px = bytearray()
    for y in range(h):
        for x in range(w):
            px += bytes(((x * 5) % 256, (y * 9) % 256,
                         ((x ^ y) * 7) % 256, ((x + y) * 3) % 256))
    p = os.path.join(tmp, "rt.png")
    write_png_rgba(p, w, h, bytes(px))
    rw, rh, rgba = read_png_rgba(p)
    check("rgba round trip", (rw, rh) == (w, h) and rgba == bytes(px),
          "%dx%d, %d bytes" % (rw, rh, len(rgba)))

    # 2. Minimal chunks: IHDR + IDAT + IEND and nothing else.
    with open(p, "rb") as fh:
        blob = fh.read()
    tags, off = [], 8
    while off + 8 <= len(blob):
        ln, tag = struct.unpack_from(">I4s", blob, off)
        tags.append(tag.decode("ascii"))
        off += 8 + ln + 4
    check("chunks are minimal", tags == ["IHDR", "IDAT", "IEND"], ",".join(tags))

    # 3 + 4. Stable and sensitive, texgen's pair at bpp 4.
    p2 = os.path.join(tmp, "rt2.png")
    write_png_rgba(p2, w, h, bytes(px))
    with open(p2, "rb") as fh:
        check("encode is stable", fh.read() == blob, "%d bytes twice" % len(blob))
    px3 = bytearray(px)
    px3[4 * (17 * w + 11) + 2] ^= 0x20
    p3 = os.path.join(tmp, "rt3.png")
    write_png_rgba(p3, w, h, bytes(px3))
    with open(p3, "rb") as fh:
        check("encode is sensitive", fh.read() != blob, "one texel changed the file")

    # 5. Every channel field tiles, at a reduced size so this stays fast. The
    #    lattice periods do not depend on the raster size, so a wrap defect at
    #    1024 is a wrap defect at 256.
    s = 256
    for (cname, label, fn) in CHANNELS:
        f = _centre(fn(s))
        edge, inner = _wrap_vs_interior(f, s)
        check("%s (%s) tiles" % (cname, label), edge <= inner,
              "wrap step %.4f vs worst interior %.4f" % (edge, inner))

    # 6. NEGATIVE CONTROL for the tiling check (texgen selftest 7b's ramp).
    ramp = [(x / s) for y in range(s) for x in range(s)]
    edge, inner = _wrap_vs_interior(ramp, s)
    check("seam check can fail", edge > inner,
          "ramp: wrap step %.4f vs worst interior %.4f" % (edge, inner))

    # 7. The centring does its job: mean within 0.02 of 0.5, p2..p98 within
    #    10% of the declared SPREAD, per channel. This is what makes the
    #    per-biome weights honest about their own ratios.
    for (cname, label, fn) in CHANNELS:
        f = _centre(fn(s))
        srt = sorted(f)
        n = len(srt)
        mean = sum(f) / n
        span = srt[int(n * 0.98) - 1] - srt[int(n * 0.02)]
        good = abs(mean - 0.5) <= 0.02 and abs(span - 2 * SPREAD) <= 0.2 * SPREAD
        check("%s centred" % cname, good,
              "mean %.3f, p2..p98 span %.3f (want %.3f)" % (mean, span, 2 * SPREAD))

    # 8. Relief channels: tiling and centring at the same bar as the value
    #    channels. Each centred field is built once and reused by the
    #    asymmetry section below.
    relief = {}
    for (cname, label, fn) in RELIEF_CHANNELS:
        relief[cname] = _centre(fn(s))
        edge, inner = _wrap_vs_interior(relief[cname], s)
        check("relief %s (%s) tiles" % (cname, label), edge <= inner,
              "wrap step %.4f vs worst interior %.4f" % (edge, inner))
    for (cname, label, fn) in RELIEF_CHANNELS:
        f = relief[cname]
        srt = sorted(f)
        n = len(srt)
        mean = sum(f) / n
        span = srt[int(n * 0.98) - 1] - srt[int(n * 0.02)]
        good = abs(mean - 0.5) <= 0.02 and abs(span - 2 * SPREAD) <= 0.2 * SPREAD
        check("relief %s centred" % cname, good,
              "mean %.3f, p2..p98 span %.3f (want %.3f)" % (mean, span, 2 * SPREAD))

    # 9. THE ASYMMETRY CLAIMS. This is what makes relief read as ground and
    #    not as water, so each claim ships with a negative control built to
    #    fail it: a check that cannot fail is not a check.
    #
    #    R: skew of the directional derivative along the ripple axis. The
    #    control is the SAME construction with a symmetric (stoss=0.5)
    #    triangle profile, i.e. the water wave we refuse to ship.
    dsk = _skewness(_dx_diffs(relief["R"], s))
    check("R d/dx skewed", abs(dsk) >= 0.8,
          "skew %+.3f (need |skew| >= 0.8)" % dsk)
    tri = _centre(_relief_ripple(s, stoss=0.5))
    tsk = _skewness(_dx_diffs(tri, s))
    check("symmetric-water rejected", abs(tsk) < 0.8,
          "triangle ripple skew %+.3f, correctly under the bar" % tsk)

    #    G: value-histogram skew (plateau mass, thin crack tail). The control
    #    is plain fbm, whose histogram is as symmetric as noise gets.
    hsk = _skewness(relief["G"])
    check("G histogram skewed", abs(hsk) >= 0.5,
          "skew %+.3f (need |skew| >= 0.5)" % hsk)
    ctl = _centre(texgen._fbm(s, s, 10, 4, seed=9101))
    csk = _skewness(ctl)
    check("plain-fbm skew rejected", abs(csk) < 0.5,
          "fbm skew %+.3f, correctly under the bar" % csk)

    #    B and A: the flat-facet signature, most texels near zero gradient
    #    plus a sparse population of large steps. Plain fbm has neither the
    #    flats nor the steps, so it must fail at least one half.
    for cname in ("B", "A"):
        flat, med, p99 = _facet_stats(_grad_mags(relief[cname], s))
        check("%s facet signature" % cname,
              flat >= 0.5 and p99 >= 4.0 * med,
              "flat %.2f (need >= 0.50), p99 %.4f vs 4*median %.4f"
              % (flat, p99, 4.0 * med))
    flat, med, p99 = _facet_stats(_grad_mags(ctl, s))
    check("fbm facets rejected", not (flat >= 0.5 and p99 >= 4.0 * med),
          "fbm flat %.2f, p99 %.4f vs 4*median %.4f" % (flat, p99, 4.0 * med))

    # 10. This module does not touch texgen's shipped set. Catches an OUT_DIR
    #    mixup before it costs a byte-identity argument: every file texgen
    #    owns must still match the sha surfaces.json records for it.
    #     Families are walked by shape, not by a hardcoded kind list: the
    #     manifest has grown albedo-only families since this check was
    #     written, and a check that crashes on a new family shape examines
    #     nothing.
    sj = os.path.join(OUT_DIR, "surfaces.json")
    if os.path.isfile(sj):
        with open(sj, "r", encoding="utf-8") as fh:
            man = json.load(fh)
        clean, seen = True, 0
        for fam in man.get("families", {}).values():
            for entry in fam.values():
                if not (isinstance(entry, dict) and "sha256" in entry):
                    continue
                seen += 1
                fp = os.path.join(OUT_DIR, entry["file"])
                with open(fp, "rb") as fh:
                    if hashlib.sha256(fh.read()).hexdigest() != entry["sha256"]:
                        clean = False
        check("texgen set untouched", clean and seen > 0,
              "%d surfaces.json shas hold" % seen)
    else:
        check("texgen set untouched", False, "NOT EXAMINED: surfaces.json missing")

    print("\n%s  %d check(s), %d failure(s)"
          % ("SELFTEST PASS" if not fails else "SELFTEST FAIL",
             count[0], len(fails)))
    return 0 if not fails else 1


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="?", default="build",
                    choices=["build", "selftest", "check"])
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--size", type=int, default=SIZE,
                    help="override resolution (debug only; shipped is %d)" % SIZE)
    args = ap.parse_args()
    if args.cmd == "selftest":
        return selftest()
    if args.cmd == "check":
        ok, lines = check_map(args.out)
        print("\n%s  %d check(s)" % ("GROUNDTEX PASS" if ok else "GROUNDTEX FAIL",
                                     len(lines)))
        return 0 if ok else 1
    generate(args.out, args.size)
    generate_relief(args.out, args.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
