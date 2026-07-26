// THE ASSERTION THAT KEEPS THIS SPIKE HONEST.
//
// Every number in the packaging spike is a comparison, and a comparison between
// a hardware-composited shell and a software-rasterised browser is worse than no
// comparison at all: it is wrong while looking green, which is the DW-20 failure
// this project has a standing rule about. Headless Chromium falls back to
// SwiftShader routinely, and `--enable-unsafe-swiftshader` makes that fallback
// silent. So the harness runs real windows parked offscreen, and every client it
// drives has to prove it reached the real GPU before any number it produced is
// allowed to be reported.
//
// The GPU string is the one the HUD already prints: `__of.stats().gpu`, which is
// WEBGL_debug_renderer_info's UNMASKED_RENDERER_WEBGL.

/** Renderer substrings that mean "no GPU took part in this measurement". */
const SOFTWARE = [
  'swiftshader', 'software', 'llvmpipe', 'softwarerasterizer', 'basic render',
  'microsoft basic', 'mesa offscreen', 'google swiftshader',
];

export function isSoftwareRenderer(gpu) {
  if (typeof gpu !== 'string' || gpu.length === 0) return true;
  const g = gpu.toLowerCase();
  return SOFTWARE.some((s) => g.includes(s));
}

/**
 * Throw unless `gpu` names real hardware. Call this on EVERY client before
 * reporting, shell and browser alike, and let it kill the run. A spike whose
 * numbers cannot be trusted should fail loudly, not print quietly.
 */
export function assertHardwareGpu(label, gpu) {
  if (isSoftwareRenderer(gpu)) {
    throw new Error(
      `${label}: SOFTWARE RENDERER DETECTED (${JSON.stringify(gpu)}). `
      + 'Every frame-time and draw-call number from this client would be fiction. '
      + 'The harness runs real windows parked offscreen precisely so this cannot happen: '
      + 'do not "fix" this by enabling headless mode or --enable-unsafe-swiftshader. '
      + 'See docs/web/PACKAGING.md, "Why offscreen and not headless".');
  }
  return gpu;
}

/** Chromium switches that park a real, compositing window off the desktop. */
export const OFFSCREEN_CHROME_ARGS = [
  '--window-position=-3200,-3200',
  '--window-size=1600,900',
  // Do not take focus from whoever is using the machine.
  '--no-first-run',
  '--no-default-browser-check',
];
