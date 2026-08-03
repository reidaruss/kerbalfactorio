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
import os
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



# ---------------------------------------------------------------------------
# RN-958. THE THIRD AND FOURTH SIDES, and the correction to RN-956's own
# prescription.
#
# RN-956 named the missing property as "the local WAVELENGTH must be
# preserved". Building it showed that is NOT sufficient either, and the
# counter-example is the exact failure it was meant to catch: a perfect
# concentric ring field sin(2*pi*r/L) has |grad phase| = 1 everywhere, so its
# local wavelength is EXACTLY constant. A fingerprint drawn that way passes a
# wavelength-stability test outright.
#
# What actually separates sand ripples from a fingerprint is HOW FAST THE CREST
# DIRECTION TURNS, measured in the only unit that makes the question scale-free:
# radians of turn per wavelength travelled.
#
#     tau = |grad theta| * lambda
#
# Real ripples run nearly straight for many wavelengths, so tau is small. A
# whorl turns through a full circle in a few wavelengths, so tau is of order
# one. Concentric rings of radius R give tau = lambda / R directly, which is
# the sanity check the fixtures below assert.
#
# So the claim is now FOUR-SIDED, and the fourth side exists because of a trap
# the first three could still have fallen into:
#
#   A. each local window is still a corduroy      (local anisotropy holds up)
#   B. the windows disagree with each other       (orientation spread rises)
#   C. the local wavelength is stable             (spread of lambda stays tight)
#   D. the crests do not curl                     (tau stays small)
#
# AND A POSITIVE CONTROL IS PART OF THE INSTRUMENT, not an optional extra. C
# and D can both be satisfied by changing NOTHING, so an instrument carrying
# only A to D would score a perfect pass on the unfixed build and would be a
# detector of "did anything change" wearing four hats. The `gentle curve`
# fixture is a field that is genuinely direction-varying AND wavelength-
# preserving, i.e. what a correct fix produces, and the instrument REFUSES to
# run if it does not accept it.


def _gsmooth(a, sigma):
    """Gaussian blur by FFT. Periodic at the edges, which is exact for the
    synthetic fixtures and acceptable on a frame because the analysis band is
    already an interior crop."""
    n0, n1 = a.shape
    fy = np.fft.fftfreq(n0)[:, None]
    fx = np.fft.fftfreq(n1)[None, :]
    k = np.exp(-2.0 * (np.pi * sigma) ** 2 * (fy * fy + fx * fx))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * k))


def radial_lambda(win):
    """Dominant wavelength in PIXELS, as the reciprocal of the power-weighted
    mean radial frequency. A centroid rather than the argmax bin, because the
    argmax jumps between adjacent bins on noise and would report a wavelength
    spread that is the estimator's and not the field's."""
    x = win - win.mean()
    if x.std() < 1e-9:
        return float('nan')
    n0, n1 = x.shape
    w = np.outer(np.hanning(n0), np.hanning(n1))
    P = np.abs(np.fft.fftshift(np.fft.fft2(x * w))) ** 2
    fy, fx = np.mgrid[0:n0, 0:n1]
    fy = (fy - n0 // 2) / float(n0)
    fx = (fx - n1 // 2) / float(n1)
    r = np.hypot(fy, fx)
    m = r > 1.5 / min(n0, n1)
    tot = P[m].sum()
    if tot <= 0:
        return float('nan')
    return float(1.0 / (float((P[m] * r[m]).sum()) / tot))


def turn_per_wavelength(img, lam):
    """tau = |grad theta| * lambda, the radians the crest direction turns per
    wavelength travelled. Orientation comes from the STRUCTURE TENSOR rather
    than from windowed FFTs, because tau is a per-pixel derivative of the
    direction field and a window statistic cannot resolve it.

    The turn is taken on the DOUBLE-ANGLE UNIT FIELD, never on theta itself: an
    orientation is mod 180, and differencing a wrapped angle manufactures a
    huge spurious gradient at every wrap. For a unit field u = (cos 2t, sin 2t),
    |grad u| IS |grad 2t|, with no unwrapping anywhere."""
    gy, gx = np.gradient(img)
    sig = max(1.0, 0.75 * lam)
    Jxx = _gsmooth(gx * gx, sig)
    Jyy = _gsmooth(gy * gy, sig)
    Jxy = _gsmooth(gx * gy, sig)
    vx = Jxx - Jyy
    vy = 2.0 * Jxy
    mag = np.hypot(vx, vy)
    coh = mag / (Jxx + Jyy + 1e-12)      # 0 isotropic, 1 perfectly oriented
    ux = vx / (mag + 1e-12)
    uy = vy / (mag + 1e-12)
    uxy, uxx = np.gradient(ux)
    uyy, uyx = np.gradient(uy)
    g2 = np.sqrt(uxx ** 2 + uxy ** 2 + uyx ** 2 + uyy ** 2)
    tau = 0.5 * g2 * lam
    # Only where there IS an orientation. An isotropic patch has a direction
    # field that is pure noise, and its turning rate would be a large number
    # about nothing.
    m = coh > 0.45
    if m.sum() < 200:
        return float('nan'), float(np.median(coh))
    return float(np.median(tau[m])), float(np.median(coh))


def evaluate(band):
    """ALL FOUR SIDES, from one array. Frames and fixtures both come through
    here, so the selftest exercises the identical code the frames do rather
    than a parallel implementation of it (a validation that runs different code
    from the thing it validates is a statement about the validation)."""
    A, ang, sd, lams = [], [], [], []
    for y in range(0, band.shape[0] - WIN + 1, WIN):
        for x in range(0, band.shape[1] - WIN + 1, WIN):
            win = band[y:y + WIN, x:x + WIN]
            a, g, t = orient(win)
            if t < 0.004:
                continue
            A.append(a); ang.append(g); sd.append(t)
            L = radial_lambda(win)
            if np.isfinite(L):
                lams.append(L)
    if len(A) < 4:
        return None
    A = np.array(A); sd = np.array(sd)
    lam_med = float(np.median(lams)) if lams else float('nan')
    if lams and len(lams) >= 4:
        q1, q3 = np.percentile(lams, [25, 75])
        lam_cv = float((q3 - q1) / max(lam_med, 1e-9))
    else:
        lam_cv = float('nan')
    tau, coh = turn_per_wavelength(band, lam_med if np.isfinite(lam_med) else 12.0)
    r = {
        'n': len(A),
        'A50': float(np.median(A)), 'A10': float(np.percentile(A, 10)),
        'spread': circ_spread(np.array(ang), sd * A),
        'lam': lam_med, 'lam_cv': lam_cv, 'tau': tau, 'coh': coh,
    }
    r['verdict'], r['fails'] = verdict(r['A50'], r['lam_cv'], r['tau'])
    return r


def line(name, r):
    if r is None:
        return f'{name:26s} NO WINDOWS PASSED THE CONTRAST FLOOR'
    ts = '   nan' if np.isnan(r['tau']) else f"{r['tau']:6.3f}"
    note = '' if not r['fails'] else '  <-- ' + '; '.join(r['fails'])
    return (f"{name:26s} n={r['n']:4d} | A p50 {r['A50']:.4f} p10 {r['A10']:.4f}"
            f" | spread {r['spread']:6.2f}d | lam {r['lam']:6.2f}px cv {r['lam_cv']:.3f}"
            f" | tau {ts} | {r['verdict']}{note}")


def frame(path, rows=slice(260, 840)):
    im = np.asarray(Image.open(path).convert('RGB')).astype(float).mean(axis=2) / 255.0
    return evaluate(im[rows])


def _fixtures(n=384, lam=12.0):
    """What each fixture IS and which side must catch it.

    `gentle curve` is the POSITIVE CONTROL and the most important entry: a
    field that is genuinely direction-varying AND wavelength-preserving, which
    is what a correct fix produces. C and D can both be satisfied by changing
    NOTHING, so without this fixture the thresholds could be tightened until
    the instrument rejected all change, and it would be a detector of
    difference wearing the costume of a detector of quality. The selftest fails
    LOUDLY if this one is rejected."""
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    rng = np.random.default_rng(4)

    def rings(ox, oy):
        return np.sin(2 * np.pi * np.hypot(xx - ox, yy - oy) / lam)

    whorl = (rings(0.30 * n, 0.32 * n) + rings(0.74 * n, 0.68 * n)
             + rings(0.18 * n, 0.82 * n) + rings(0.82 * n, 0.20 * n))

    # THE RN-955 BUG ITSELF, reproduced in numpy rather than described: rotate
    # the sample coordinate about the coordinate ORIGIN by a smooth angle
    # field, with the coordinate magnitude large, which is exactly what
    # `vChunkUv * 16.0` supplies to a shader.
    a = _gsmooth(rng.standard_normal((n, n)), n / 24.0)
    a = 1.2 * a / (np.abs(a).max() + 1e-9)
    px, py = xx + 6.0 * n, yy + 6.0 * n
    sheared = np.sin(2 * np.pi * (np.cos(a) * px - np.sin(a) * py) / lam)

    blobs = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal((n, n)))
                                 * np.exp(-((np.fft.fftfreq(n)[:, None] ** 2
                                             + np.fft.fftfreq(n)[None, :] ** 2) / 0.002))))
    return [
        ('straight corduroy',   np.sin(2 * np.pi * xx / lam),      'accept'),
        ('gentle curve',        rings(n / 2.0, n / 2.0 - 55 * lam), 'accept'),
        ('whorl (fingerprint)', whorl,                             'reject'),
        ('RN-955 origin shear', sheared,                           'reject'),
        ('isotropic blobs',     blobs,                             'reject'),
        ('white noise',         rng.standard_normal((n, n)),       'reject'),
    ], lam


WIN = 96
# Thresholds. TAU_MAX is READ OFF the fixtures rather than chosen: concentric
# rings of radius R give tau = lambda/R exactly, the positive control at 55
# wavelengths sits near 0.018, and a whorl with centres inside the frame is an
# order of magnitude above. The gap is wide, so the value is not delicate, and
# that is said here so nobody later tunes it believing it is a knob.
TAU_MAX = 0.10
ANISO_MIN = 0.30
LAM_CV_MAX = 0.30


def verdict(A50, lam_cv, tau):
    fails = []
    if not (A50 >= ANISO_MIN):
        fails.append('A: not a corduroy any more')
    if np.isfinite(lam_cv) and not (lam_cv <= LAM_CV_MAX):
        fails.append('C: wavelength unstable')
    if np.isfinite(tau) and not (tau <= TAU_MAX):
        fails.append('D: crests curl')
    return ('accept' if not fails else 'reject'), fails


def selftest(verbose=True):
    fx, lam = _fixtures()
    ok = True
    if verbose:
        print('  instrument validation, through evaluate() exactly as a frame is:')
    for name, f, must in fx:
        b = (f - f.min()) / max(float(f.max() - f.min()), 1e-9)
        r = evaluate(b)
        got = 'reject' if r is None else r['verdict']
        if verbose:
            print('    ' + line(name, r) + (f'   want {must}' if got == must
                                            else f'   <-- MISMATCH, want {must}'))
        if got != must:
            ok = False
    # THE UNIT CHECK, which is what makes tau a physical quantity rather than a
    # score. Concentric rings of radius R must read tau = lambda/R. The centre
    # is placed FAR OUTSIDE the frame on purpose: an earlier version of this
    # check put it inside, where the radius sweeps 0 to 200 px across the image
    # and lambda/R is not the field's actual turning rate at all. The check was
    # wrong, not the estimator.
    n = 384
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    for R in (600.0, 1200.0):
        f = np.sin(2 * np.pi * np.hypot(xx - n / 2.0, yy + R - n / 2.0) / lam)
        tau, _ = turn_per_wavelength(f, lam)
        want = lam / R
        good = np.isfinite(tau) and abs(tau - want) <= 0.35 * want
        if verbose:
            print(f'    tau unit check: rings R={R:6.0f}px -> tau {tau:.5f}, '
                  f'lambda/R {want:.5f}  {"ok" if good else "FAIL"}')
        if not good:
            ok = False
    # REAL PIXELS, not only synthetics. fixtures/RN958_ripple_frames.png holds
    # two halves of the RN-954 ladder: the SHIPPED beach on the left, which must
    # be ACCEPTED, and the reliefrot=1.20 whorl on the right, which must be
    # REJECTED. The left half is the load-bearing one. An instrument that
    # rejects the shipped build is not strict, it is broken, and it would have
    # sent the next lane hunting a defect that is only monotony.
    fp = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      'fixtures', 'RN958_ripple_frames.png')
    if os.path.exists(fp):
        g = np.asarray(Image.open(fp).convert('L')).astype(float) / 255.0
        for nm, sl, must in (('REAL shipped beach', slice(0, 624), 'accept'),
                             ('REAL reliefrot=1.20', slice(628, 1252), 'reject')):
            r = evaluate(g[:, sl])
            got = 'reject' if r is None else r['verdict']
            if verbose:
                print('    ' + line(nm, r) + (f'   want {must}' if got == must
                                              else f'   <-- MISMATCH, want {must}'))
            if got != must:
                ok = False
    elif verbose:
        print('    REAL-FRAME FIXTURE MISSING: synthetics only, weaker claim')
    if verbose:
        print(f'  validation: {"PASS" if ok else "FAIL"}')
    return ok


if __name__ == '__main__':
    if not selftest():
        print('REFUSING: the instrument does not separate its own fixtures.')
        sys.exit(2)
    print()
    for arg in sys.argv[1:]:
        label, path = arg.split('==', 1)
        print(line(label, frame(path)))
