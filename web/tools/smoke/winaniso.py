"""RN-954. The TWO-SIDED ripple instrument, AND THE PROOF THAT TWO SIDES WERE
NOT ENOUGH.

READ THIS BEFORE TRUSTING IT. This instrument passed a change that was plainly,
grossly wrong in the picture. It is kept because its validation is honest and
its two halves are the right two halves; it is documented as insufficient
because a THIRD property it does not measure is what actually decided the
question.

RN-954 rotated the relief tile's sample coordinate by a low-frequency angle
field to break the global ripple direction. This instrument reported both
halves satisfied: median local anisotropy 0.5214 -> 0.7147 at the smallest
swing (each window MORE of a corduroy than before) and the between-window
orientation spread 16.97 -> 37.76 degrees (the windows disagreeing 2.2x more).
By its own criteria the change was a clear win at every swing tested.

The frame was concentric fingerprint whorls. Rotating a UV about the UV ORIGIN
is not a rotation of the pattern: the shear term scales with the coordinate
magnitude, which at `vChunkUv * 16.0` is up to 16 tile units, so the local
frequency was multiplied rather than the direction changed.

AND A WHORL SATISFIES BOTH HALVES BY CONSTRUCTION. Concentric contours are
locally near-parallel (high local anisotropy) and their direction turns with
position (high between-window spread). The instrument was not measuring the
wrong thing; it was measuring two true things that a fingerprint also has.

The missing third property is that the local WAVELENGTH must be preserved.
Any future attempt must add it, and must still be looked at.

---


A single frame-wide anisotropy number cannot decide this and would be a
one-sided claim. Rotating the ripple per location makes a whole-frame number
fall, and so does destroying the ripple, and those are the good outcome and the
bad one. The classifier would be measuring exactly the thing being changed.

So the claim has two halves, and both must hold:

  A. EACH LOCAL WINDOW IS STILL A CORDUROY.  median local anisotropy must not
     collapse.  If it does, the rotation has sheared the tile into mush and the
     term bought "less artefact" with "less signal", which is the trade RN-843
     refused.
  B. THE WINDOWS DISAGREE WITH EACH OTHER.  the circular spread of the per
     window dominant orientation must RISE well above the BEFORE frame's own
     spread.  The before frame is the control for the perspective confound: a
     projection maps one world direction to different screen directions across
     the image, so some spread exists with no rotation at all, and it is
     measured rather than argued away.

VALIDATED BEFORE USE, on synthetic fields pushed through the identical window
code, so the numbers below have a scale attached rather than being bare.
"""
import sys
import numpy as np
from PIL import Image


def orient(win):
    """Anisotropy in [0,1] and dominant orientation in degrees, from the
    second-moment tensor of the power spectrum in DOUBLE-ANGLE space (an
    orientation is mod 180, so a plain mean would cancel 0 against 179)."""
    x = win - win.mean()
    if x.std() < 1e-9:
        return 0.0, 0.0, 0.0
    # A window is not periodic; without a taper its edges inject a cross of
    # spectral energy along both axes, which reads as anisotropy that is an
    # artefact of the crop. Hann in both directions.
    n0, n1 = x.shape
    w = np.outer(np.hanning(n0), np.hanning(n1))
    F = np.fft.fftshift(np.fft.fft2(x * w))
    P = F.real ** 2 + F.imag ** 2
    c0, c1 = n0 // 2, n1 // 2
    fy, fx = np.mgrid[0:n0, 0:n1]
    fy = fy - c0
    fx = fx - c1
    m = (fx * fx + fy * fy) > 0
    p = P[m]
    X = fx[m].astype(float)
    Y = fy[m].astype(float)
    L = np.hypot(X, Y)
    X /= L
    Y /= L
    tot = p.sum()
    c2 = float((p * (X * X - Y * Y)).sum())
    s2 = float((p * (2 * X * Y)).sum())
    A = float(np.hypot(c2, s2) / tot)
    ang = float(0.5 * np.degrees(np.arctan2(s2, c2)))
    return A, ang, float(x.std())


def circ_spread(angles_deg, weights):
    """Circular standard deviation of ORIENTATIONS (mod 180), in degrees.
    0 means every window agrees; ~52 is the uniform-random ceiling."""
    a = np.radians(np.asarray(angles_deg) * 2.0)
    w = np.asarray(weights, float)
    if w.sum() <= 0:
        return 0.0
    C = float((w * np.cos(a)).sum() / w.sum())
    S = float((w * np.sin(a)).sum() / w.sum())
    R = min(1.0, np.hypot(C, S))
    if R < 1e-12:
        return 90.0
    return float(np.degrees(np.sqrt(-2.0 * np.log(R))) / 2.0)


def windows(path, rows, win=96, step=96, floor=0.004):
    im = np.asarray(Image.open(path).convert('RGB')).astype(float).mean(axis=2) / 255.0
    band = im[rows]
    out = []
    for y in range(0, band.shape[0] - win + 1, step):
        for x in range(0, band.shape[1] - win + 1, step):
            A, ang, sd = orient(band[y:y + win, x:x + win])
            # A window with no texture in it has no orientation, and including
            # it would dilute both halves of the claim with noise. Dropped by
            # CONTRAST, which is not the quantity under test: the rotation
            # moves direction, not amplitude.
            if sd >= floor:
                out.append((A, ang, sd))
    return out


def summarise(name, w):
    if not w:
        return f'{name:28s} NO WINDOWS PASSED THE CONTRAST FLOOR'
    A = np.array([r[0] for r in w])
    ang = np.array([r[1] for r in w])
    sd = np.array([r[2] for r in w])
    return (f'{name:28s} n={len(w):4d}  local A: p50 {np.median(A):.4f} '
            f'p10 {np.percentile(A, 10):.4f} p90 {np.percentile(A, 90):.4f}  |  '
            f'orientation spread {circ_spread(ang, sd * A):6.2f} deg')


def selftest():
    """The refusing case and the scale, in the same run that reports a result."""
    n = 96
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    rng = np.random.default_rng(4)
    cases = [
        ('pure corduroy 0 deg', np.sin(2 * np.pi * xx / 12.0)),
        ('pure corduroy 40 deg',
         np.sin(2 * np.pi * (xx * np.cos(np.radians(40)) + yy * np.sin(np.radians(40))) / 12.0)),
        ('white noise', rng.standard_normal((n, n))),
        ('isotropic blobs',
         np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n)))
                              * np.exp(-((np.fft.fftfreq(n)[:, None] ** 2
                                          + np.fft.fftfreq(n)[None, :] ** 2) / 0.002))))),
    ]
    print('  instrument validation (same window code as the frames):')
    ok = True
    for nm, f in cases:
        A, ang, _ = orient(f)
        print(f'    {nm:24s} A={A:.4f}  ang={ang:+7.2f}')
        if nm.startswith('pure corduroy') and A < 0.90:
            ok = False
        if nm in ('white noise', 'isotropic blobs') and A > 0.35:
            ok = False
    # The 40 degree corduroy must READ as 40, or the orientation half of the
    # claim is measuring nothing.
    A40, ang40, _ = orient(cases[1][1])
    if abs(((ang40 - 40.0 + 90) % 180) - 90) > 6.0:
        ok = False
        print(f'    ORIENTATION RECOVERY FAILED: authored 40, read {ang40:+.2f}')
    print(f'  validation: {"PASS" if ok else "FAIL"}')
    return ok


if __name__ == '__main__':
    if not selftest():
        print('REFUSING: the instrument does not separate its own fixtures.')
        sys.exit(2)
    rows = slice(260, 840)
    print()
    for label, path in [a.split('=', 1) for a in sys.argv[1:]]:
        print(summarise(label, windows(path, rows)))
