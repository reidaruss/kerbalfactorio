#!/usr/bin/env python3
"""
contact_sheet.py - tile rendered PNGs into one labelled sheet.

    python tools/blender/contact_sheet.py OUT.png [--cols N] [--title TEXT] IN.png...
    python tools/blender/contact_sheet.py OUT.png --glob "docs/screenshots/W11_player_*.png"
    python tools/blender/contact_sheet.py selftest

WHY THIS EXISTS. `render_check.py` writes one 420 x 540 PNG per shot, and a
character pass is thirty of them. Nobody looks at thirty files, which means the
renders stop being a review and become an artefact. One sheet is looked at.

WHY IT IS STDLIB ONLY. Pillow is not installed, in this python or in Blender's,
and `validate_glb.py` and `check_mating.py` already established that the tools
which gate this pipeline run as a plain `python3` step with no environment. A
review tool that only runs on the author's machine is not a review tool. So the
PNG codec below is written out: `zlib` does the hard part, and the rest is the
five scanline filters and a CRC.

Scope, stated rather than discovered: 8-bit non-interlaced greyscale, RGB and
RGBA input, which is every PNG Blender's Cycles output produces. Anything else
raises rather than guessing. Output is always 8-bit RGB.

The label under each tile is the input FILENAME, because `render_check.py`
already encodes the interesting facts there (`<prefix>_<clip>_f<frame>_<view>`),
so a sheet carries which clip and which frame without anyone typing it twice.
"""

import argparse
import glob as globmod
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

BG = (26, 28, 32)
FG = (218, 222, 228)
RULE = (58, 62, 70)


# ---------------------------------------------------------------------------
# PNG decode. 8-bit, non-interlaced, colour types 0 / 2 / 6.
# ---------------------------------------------------------------------------

_CHANNELS = {0: 1, 2: 3, 4: 2, 6: 4}


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def read_png(path):
    """Return (width, height, rows) with rows[y] a bytearray of RGB triples."""
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("%s is not a PNG" % path)
    off, idat, hdr = 8, [], None
    while off + 8 <= len(data):
        (clen,) = struct.unpack_from(">I", data, off)
        ctype = data[off + 4:off + 8]
        body = data[off + 8:off + 8 + clen]
        if ctype == b"IHDR":
            hdr = struct.unpack(">IIBBBBB", body)
        elif ctype == b"IDAT":
            idat.append(body)
        elif ctype == b"IEND":
            break
        off += 12 + clen
    if hdr is None:
        raise ValueError("%s has no IHDR" % path)
    w, h, depth, ctype_n, comp, filt, interlace = hdr
    if depth != 8 or interlace != 0 or ctype_n not in _CHANNELS:
        raise ValueError("%s: only 8-bit non-interlaced grey/RGB/RGBA are "
                         "supported, got depth %d type %d interlace %d"
                         % (path, depth, ctype_n, interlace))
    nch = _CHANNELS[ctype_n]
    raw = zlib.decompress(b"".join(idat))
    stride = w * nch
    rows, prev = [], bytearray(stride)
    pos = 0
    for _ in range(h):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if ftype == 1:
            for i in range(nch, stride):
                line[i] = (line[i] + line[i - nch]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                a = line[i - nch] if i >= nch else 0
                c = prev[i - nch] if i >= nch else 0
                line[i] = (line[i] + _paeth(a, prev[i], c)) & 0xFF
        elif ftype != 0:
            raise ValueError("%s: bad scanline filter %d" % (path, ftype))
        prev = line
        # Composite to RGB over the sheet background, so a film-transparent
        # render does not tile as a black hole.
        out = bytearray(w * 3)
        if nch == 3:
            out[:] = line
        elif nch == 1:
            for x in range(w):
                out[x * 3:x * 3 + 3] = bytes((line[x],) * 3)
        elif nch == 2:
            for x in range(w):
                g, a = line[x * 2], line[x * 2 + 1]
                for k in range(3):
                    out[x * 3 + k] = (g * a + BG[k] * (255 - a)) // 255
        else:
            for x in range(w):
                a = line[x * 4 + 3]
                if a == 255:
                    out[x * 3:x * 3 + 3] = line[x * 4:x * 4 + 3]
                else:
                    for k in range(3):
                        out[x * 3 + k] = (line[x * 4 + k] * a
                                          + BG[k] * (255 - a)) // 255
        rows.append(out)
    return w, h, rows


def write_png(path, w, h, rows):
    def chunk(tag, body):
        return (struct.pack(">I", len(body)) + tag + body
                + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))

    raw = bytearray()
    for r in rows:
        raw.append(0)
        raw += r
    body = (chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
            + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n" + body)


# ---------------------------------------------------------------------------
# A 5 x 7 bitmap font, so a tile carries its own name. Uppercase only: the
# labels are filenames and case is not information here.
# ---------------------------------------------------------------------------

_FONT = {
    "A": "01110 10001 10001 11111 10001 10001 10001",
    "B": "11110 10001 10001 11110 10001 10001 11110",
    "C": "01110 10001 10000 10000 10000 10001 01110",
    "D": "11110 10001 10001 10001 10001 10001 11110",
    "E": "11111 10000 10000 11110 10000 10000 11111",
    "F": "11111 10000 10000 11110 10000 10000 10000",
    "G": "01110 10001 10000 10111 10001 10001 01110",
    "H": "10001 10001 10001 11111 10001 10001 10001",
    "I": "11111 00100 00100 00100 00100 00100 11111",
    "J": "00001 00001 00001 00001 10001 10001 01110",
    "K": "10001 10010 10100 11000 10100 10010 10001",
    "L": "10000 10000 10000 10000 10000 10000 11111",
    "M": "10001 11011 10101 10001 10001 10001 10001",
    "N": "10001 11001 10101 10011 10001 10001 10001",
    "O": "01110 10001 10001 10001 10001 10001 01110",
    "P": "11110 10001 10001 11110 10000 10000 10000",
    "Q": "01110 10001 10001 10001 10101 10010 01101",
    "R": "11110 10001 10001 11110 10100 10010 10001",
    "S": "01111 10000 10000 01110 00001 00001 11110",
    "T": "11111 00100 00100 00100 00100 00100 00100",
    "U": "10001 10001 10001 10001 10001 10001 01110",
    "V": "10001 10001 10001 10001 10001 01010 00100",
    "W": "10001 10001 10001 10001 10101 11011 10001",
    "X": "10001 10001 01010 00100 01010 10001 10001",
    "Y": "10001 10001 01010 00100 00100 00100 00100",
    "Z": "11111 00001 00010 00100 01000 10000 11111",
    "0": "01110 10001 10011 10101 11001 10001 01110",
    "1": "00100 01100 00100 00100 00100 00100 01110",
    "2": "01110 10001 00001 00010 00100 01000 11111",
    "3": "11111 00010 00100 00010 00001 10001 01110",
    "4": "00010 00110 01010 10010 11111 00010 00010",
    "5": "11111 10000 11110 00001 00001 10001 01110",
    "6": "00110 01000 10000 11110 10001 10001 01110",
    "7": "11111 00001 00010 00100 01000 01000 01000",
    "8": "01110 10001 10001 01110 10001 10001 01110",
    "9": "01110 10001 10001 01111 00001 00010 01100",
    " ": "00000 00000 00000 00000 00000 00000 00000",
    "_": "00000 00000 00000 00000 00000 00000 11111",
    "-": "00000 00000 00000 11111 00000 00000 00000",
    ".": "00000 00000 00000 00000 00000 01100 01100",
    ":": "00000 01100 01100 00000 01100 01100 00000",
    "/": "00001 00010 00010 00100 01000 01000 10000",
}
_GLYPH_W, _GLYPH_H = 5, 7


def text_width(s, scale):
    return len(s) * (_GLYPH_W + 1) * scale


def draw_text(rows, x0, y0, s, scale=2, colour=FG, sheet_w=0):
    for ci, ch in enumerate(s.upper()):
        g = _FONT.get(ch)
        if g is None:
            g = _FONT[" "]
        cols = g.split()
        for gy in range(_GLYPH_H):
            for gx in range(_GLYPH_W):
                if cols[gy][gx] != "1":
                    continue
                for sy in range(scale):
                    y = y0 + gy * scale + sy
                    if y < 0 or y >= len(rows):
                        continue
                    row = rows[y]
                    for sx in range(scale):
                        x = x0 + (ci * (_GLYPH_W + 1) + gx) * scale + sx
                        if 0 <= x < sheet_w:
                            row[x * 3:x * 3 + 3] = bytes(colour)


# ---------------------------------------------------------------------------

def label_for(path):
    return os.path.splitext(os.path.basename(path))[0]


def build_sheet(out, paths, cols=None, title=None, pad=10, label_h=22,
                label_scale=2):
    if not paths:
        raise SystemExit("contact_sheet: no input images")
    tiles = []
    for p in paths:
        w, h, rows = read_png(p)
        tiles.append((label_for(p), w, h, rows))
    tw = max(t[1] for t in tiles)
    th = max(t[2] for t in tiles)
    n = len(tiles)
    if not cols:
        cols = 1
        while cols * cols < n:
            cols += 1
        cols = min(cols, 6)
    rows_n = (n + cols - 1) // cols
    title_h = 30 if title else 0
    sw = pad + cols * (tw + pad)
    sh = pad + title_h + rows_n * (th + label_h + pad)
    sheet = [bytearray(bytes(BG) * sw) for _ in range(sh)]

    if title:
        draw_text(sheet, pad, pad + 4, title, 3, FG, sw)
        for x in range(pad, sw - pad):
            sheet[pad + title_h - 6][x * 3:x * 3 + 3] = bytes(RULE)

    for i, (label, w, h, trows) in enumerate(tiles):
        cx = pad + (i % cols) * (tw + pad)
        cy = pad + title_h + (i // cols) * (th + label_h + pad)
        # centre a smaller tile inside the cell so a mixed set still lines up
        ox, oy = cx + (tw - w) // 2, cy + (th - h) // 2
        for y in range(h):
            dst = sheet[oy + y]
            dst[ox * 3:(ox + w) * 3] = trows[y]
        lw = text_width(label, label_scale)
        scale = label_scale
        while lw > tw and scale > 1:
            scale -= 1
            lw = text_width(label, scale)
        draw_text(sheet, cx + max(0, (tw - lw) // 2), cy + th + 5, label,
                  scale, FG, sw)

    os.makedirs(os.path.dirname(os.path.abspath(out)) or ".", exist_ok=True)
    write_png(out, sw, sh, sheet)
    return sw, sh, n, cols, rows_n


# ---------------------------------------------------------------------------

def selftest():
    """Prove the codec round-trips, and prove it REFUSES what it cannot read.

    A tool that has only ever succeeded has not been shown to work (DW-20)."""
    import tempfile
    ok = True
    tmp = tempfile.mkdtemp(prefix="contact_sheet_")

    # 1. round trip a known image through write then read
    w, h = 7, 5
    src = [bytearray(b"".join(bytes([(x * 37 + y * 11) % 256,
                                     (x * 5) % 256, (y * 61) % 256])
                             for x in range(w)))
           for y in range(h)]
    p = os.path.join(tmp, "rt.png")
    write_png(p, w, h, src)
    gw, gh, got = read_png(p)
    same = (gw, gh) == (w, h) and all(bytes(a) == bytes(b)
                                      for a, b in zip(src, got))
    print("  [%s] round trip %dx%d survives write then read"
          % ("ok" if same else "FAIL", w, h))
    ok &= same

    # 2. every scanline filter decodes to the same pixels
    raws = {}
    for ftype in range(5):
        raw = bytearray()
        prev = bytearray(w * 3)
        for y in range(h):
            line = bytearray(src[y])
            enc = bytearray(len(line))
            for i in range(len(line)):
                a = line[i - 3] if i >= 3 else 0
                b = prev[i]
                c = prev[i - 3] if i >= 3 else 0
                if ftype == 0:
                    enc[i] = line[i]
                elif ftype == 1:
                    enc[i] = (line[i] - a) & 0xFF
                elif ftype == 2:
                    enc[i] = (line[i] - b) & 0xFF
                elif ftype == 3:
                    enc[i] = (line[i] - ((a + b) >> 1)) & 0xFF
                else:
                    enc[i] = (line[i] - _paeth(a, b, c)) & 0xFF
            raw.append(ftype)
            raw += enc
            prev = line
        raws[ftype] = bytes(raw)

    def chunk(tag, body):
        return (struct.pack(">I", len(body)) + tag + body
                + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))

    for ftype, raw in raws.items():
        fp = os.path.join(tmp, "f%d.png" % ftype)
        with open(fp, "wb") as fh:
            fh.write(b"\x89PNG\r\n\x1a\n"
                     + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 9))
                     + chunk(b"IEND", b""))
        _, _, got = read_png(fp)
        good = all(bytes(a) == bytes(b) for a, b in zip(src, got))
        print("  [%s] scanline filter %d decodes to the same pixels"
              % ("ok" if good else "FAIL", ftype))
        ok &= good

    # 3. it must REFUSE a 16-bit file rather than produce a wrong sheet
    bad = os.path.join(tmp, "bad16.png")
    with open(bad, "wb") as fh:
        fh.write(b"\x89PNG\r\n\x1a\n"
                 + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 16, 2, 0, 0, 0))
                 + chunk(b"IDAT", zlib.compress(b"\x00" * 26, 9))
                 + chunk(b"IEND", b""))
    refused = False
    try:
        read_png(bad)
    except ValueError:
        refused = True
    print("  [%s] a 16-bit PNG is REFUSED, not silently misread"
          % ("ok" if refused else "FAIL"))
    ok &= refused

    # 4. and it must refuse a non-PNG
    notpng = os.path.join(tmp, "no.png")
    with open(notpng, "wb") as fh:
        fh.write(b"not a png at all")
    refused2 = False
    try:
        read_png(notpng)
    except ValueError:
        refused2 = True
    print("  [%s] a non-PNG is REFUSED" % ("ok" if refused2 else "FAIL"))
    ok &= refused2

    print("\n%s" % ("SELFTEST PASSED" if ok else "SELFTEST FAILED"))
    return 0 if ok else 1


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "selftest":
        return selftest()
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("inputs", nargs="*")
    ap.add_argument("--glob", action="append", default=[])
    ap.add_argument("--cols", type=int, default=0)
    ap.add_argument("--title", default=None)
    # parse_known_args, not parse_args, and the leftovers are folded back in.
    # argparse splits a single nargs="*" positional into CHUNKS whenever an
    # optional sits between two groups of positionals, matches only the first
    # chunk, and errors on the rest. So the natural
    #   contact_sheet.py out.png --cols 4 --title T a.png b.png
    # is rejected while the same arguments in another order are accepted, which
    # is a trap rather than a validation. Anything left over that is not a flag
    # is an input path.
    a, extra = ap.parse_known_args()
    stray = [e for e in extra if e.startswith("-")]
    if stray:
        ap.error("unrecognized option %s" % stray[0])

    paths = list(a.inputs) + extra
    for g in a.glob:
        paths += sorted(globmod.glob(os.path.join(ROOT, g)))
    paths = [p if os.path.isabs(p) else os.path.join(ROOT, p) for p in paths]
    missing = [p for p in paths if not os.path.exists(p)]
    if missing:
        raise SystemExit("contact_sheet: missing %s" % missing[0])

    out = a.out if os.path.isabs(a.out) else os.path.join(ROOT, a.out)
    sw, sh, n, cols, rows_n = build_sheet(out, paths, a.cols, a.title)
    print("contact_sheet: %d tiles, %d x %d grid, %d x %d px -> %s (%d bytes)"
          % (n, cols, rows_n, sw, sh, os.path.relpath(out, ROOT),
             os.path.getsize(out)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
