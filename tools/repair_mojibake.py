#!/usr/bin/env python3
"""tools/repair_mojibake.py: repair a UTF-8-as-cp1252-as-UTF-8 double encode.

BT-245. docs/phase1/OVERNIGHT-LOG.md was corrupted in the 2026-08-03 repo-move
commit (67b4857): the file's real UTF-8 bytes (an em dash, U+2014, section
signs, arrows, etc.) were decoded as Windows-1252 and the resulting mojibake
STRING was then written back out as UTF-8. That is a double encode, and it
reverses cleanly: decode the corrupted file as UTF-8 (which is genuinely valid
UTF-8, just wrong text), then for the byte sequence of any given LINE, encode
that already-decoded string back through cp1252 and decode the result as
UTF-8 a second time. That undoes exactly the two steps that broke it and
nothing else.

Only lines carrying a recognised mojibake marker are touched (MARKERS below);
every other line, including lines with no non-ASCII content at all, passes
through byte-for-byte. This is deliberately narrow rather than "encode/decode
the whole file", so a line that happens to contain some OTHER kind of non-ASCII
text (there are none in this file, checked) could never be silently mangled a
second time by a transform meant to fix a different one.

Usage:
    python tools/repair_mojibake.py <path>            repair in place
    python tools/repair_mojibake.py <path> --check     report only, no write

Exits 1 if a flagged line fails to round-trip (cp1252 cannot encode every
Unicode code point; a line that hits one is left untouched and reported,
never silently dropped).
"""
import sys

# Characters that only appear in this file because a UTF-8 multi-byte
# character was run through this exact double encode. Not a general mojibake
# heuristic: this is the literal, closed set of non-ASCII code points found
# in docs/phase1/OVERNIGHT-LOG.md (confirmed by scanning the file), which is
# what an em dash, a right arrow, curly quotes, a section sign, a checkmark
# and similar decode to as cp1252-then-reencoded-UTF-8 mojibake.
MARKERS = ('Â', 'â', 'Î', '£', '¦', '§', 'œ', '’', '“', '”', '†', '€')


def has_marker(line: str) -> bool:
    return any(m in line for m in MARKERS)


def repair_line(line: str) -> str:
    return line.encode('cp1252').decode('utf-8')


def repair_text(text: str) -> tuple[str, int, list[int]]:
    """Returns (repaired_text, lines_changed, failed_line_numbers)."""
    lines = text.split('\n')
    changed = 0
    failed = []
    out = []
    for i, line in enumerate(lines):
        if has_marker(line):
            try:
                fixed = repair_line(line)
            except (UnicodeEncodeError, UnicodeDecodeError):
                failed.append(i + 1)
                out.append(line)
                continue
            if fixed != line:
                changed += 1
            out.append(fixed)
        else:
            out.append(line)
    return '\n'.join(out), changed, failed


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    path = sys.argv[1]
    check_only = '--check' in sys.argv[2:]

    with open(path, 'r', encoding='utf-8', newline='') as f:
        text = f.read()

    repaired, changed, failed = repair_text(text)

    if failed:
        print(f'repair_mojibake: {len(failed)} flagged line(s) could not round-trip '
              f'through cp1252: {failed}', file=sys.stderr)
        sys.exit(1)

    print(f'repair_mojibake: {changed} line(s) repaired in {path}')
    if not check_only:
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(repaired)


if __name__ == '__main__':
    main()
