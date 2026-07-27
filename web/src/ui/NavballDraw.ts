// Pure painting for the navball sphere: an attitude and a few markers in,
// pixels out. No DOM lookups, no state, no three.js (src/ui imports none by
// rule, and check-limits enforces it).
//
// THE FRAME is the local horizon: e east, n north, u up, right handed. A
// direction is a heading (0 north, 90 east) plus a pitch (+90 straight up).
// The ball is an orthographic view of that direction sphere centred on the
// NOSE, which is what makes the fixed reticle in the middle read the attitude,
// and it makes "is prograde behind me" one dot product rather than a special
// case: a marker is on screen exactly when it lies on the near hemisphere.

export interface Vec3 { e: number; n: number; u: number }

/** Screen basis in the local horizon frame: r right, u up, f into the screen. */
export interface View { r: Vec3; u: Vec3; f: Vec3 }

/** Unit-disc coordinates, y UP, plus depth. z > 0 is the near hemisphere. */
export interface P2 { x: number; y: number; z: number }

export type MarkKind = 'prograde' | 'retrograde' | 'command' | 'guidance' | 'node';
export interface Mark { kind: MarkKind; dir: Vec3 }

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
const SKY_HI = '#4a97d6';
const SKY_LO = '#2b6699';
const GND_HI = '#7b5a35';
const GND_LO = '#4e381f';
const LINE = 'rgba(228, 238, 245, 0.42)';
const LINE_HI = 'rgba(236, 244, 250, 0.85)';
const INK = '#f0f5f9';
const SHADE = 'rgba(0, 0, 0, 0.62)';
const RETICLE = '#ff9a3c';
const COLOUR: Record<MarkKind, string> = {
  prograde: '#d9e34f',
  retrograde: '#d9e34f',
  command: '#6fc9ff',
  guidance: '#ff9a3c',
  node: '#3cd6b0',
};

function dot(a: Vec3, b: Vec3): number { return a.e * b.e + a.n * b.n + a.u * b.u; }

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    e: a.n * b.u - a.u * b.n,
    n: a.u * b.e - a.e * b.u,
    u: a.e * b.n - a.n * b.e,
  };
}

export function dirOf(headingDeg: number, pitchDeg: number): Vec3 {
  const h = headingDeg * D2R;
  const p = pitchDeg * D2R;
  const c = Math.cos(p);
  return { e: c * Math.sin(h), n: c * Math.cos(h), u: Math.sin(p) };
}

/**
 * The screen basis for a nose attitude.
 *
 * Straight up and straight down are the one place this can fail: the roll
 * reference is "the horizontal to the right of the nose" and at the zenith
 * there is no such thing, so heading picks it instead. Without that branch the
 * ball tears itself apart on a vertical launch, which is the first thirty
 * seconds of every flight.
 */
export function viewOf(headingDeg: number, pitchDeg: number, rollDeg: number): View {
  const f = dirOf(headingDeg, pitchDeg);
  const c0 = cross(f, { e: 0, n: 0, u: 1 });
  const len = Math.hypot(c0.e, c0.n, c0.u);
  const r0 = len < 1e-6
    ? dirOf(headingDeg + 90, 0)
    : { e: c0.e / len, n: c0.n / len, u: c0.u / len };
  const u0 = cross(r0, f);
  const c = Math.cos(rollDeg * D2R);
  const s = Math.sin(rollDeg * D2R);
  return {
    r: { e: r0.e * c - u0.e * s, n: r0.n * c - u0.n * s, u: r0.u * c - u0.u * s },
    u: { e: r0.e * s + u0.e * c, n: r0.n * s + u0.n * c, u: r0.u * s + u0.u * c },
    f,
  };
}

export function project(v: Vec3, w: View): P2 {
  return { x: dot(v, w.r), y: dot(v, w.u), z: dot(v, w.f) };
}

/** The markers on the near hemisphere, which is exactly the set that is drawn. */
export function frontMarks(w: View, marks: readonly Mark[]): Mark[] {
  return marks.filter((m) => dot(m.dir, w.f) > 0);
}

export function drawBall(ctx: CanvasRenderingContext2D, size: number, w: View): void {
  const cx = size / 2;
  const cy = size / 2;
  const rad = size / 2 - 5;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, TAU);
  ctx.clip();
  hemispheres(ctx, w, cx, cy, rad);
  ladder(ctx, w, cx, cy, rad);
  cardinals(ctx, w, cx, cy, rad);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, TAU);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#39454e';
  ctx.stroke();
  reticle(ctx, cx, cy);
}

/**
 * Sky above the horizon, ground below, with the split drawn where it really
 * falls rather than across the middle of the widget.
 *
 * The horizon is a great circle, so the part of it on the near hemisphere is
 * one contiguous arc between two points on the rim, and it cuts the disc in
 * two. Trace the arc, close it along the rim one way, and whichever side that
 * encloses is painted over a disc of the other colour.
 */
function hemispheres(ctx: CanvasRenderingContext2D, w: View,
                     cx: number, cy: number, rad: number): void {
  const n = 240;
  const ring: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    ring.push(project({ e: Math.sin(t), n: Math.cos(t), u: 0 }, w));
  }
  const sky = band(ctx, cy, rad, SKY_HI, SKY_LO);
  const gnd = band(ctx, cy, rad, GND_HI, GND_LO);
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (ring[i].z <= 0 && ring[(i + 1) % n].z > 0) { start = (i + 1) % n; break; }
  }
  if (start < 0) {
    // Nose at the zenith or the nadir: no horizon on screen at all.
    ctx.fillStyle = w.f.u >= 0 ? sky : gnd;
    disc(ctx, cx, cy, rad);
    return;
  }
  const arc: P2[] = [];
  for (let k = 0; k < n; k++) {
    const p = ring[(start + k) % n];
    if (p.z <= 0) break;
    arc.push(p);
  }
  onRim(arc[0]);
  onRim(arc[arc.length - 1]);
  const a0 = Math.atan2(arc[0].y, arc[0].x);
  const a1 = Math.atan2(arc[arc.length - 1].y, arc[arc.length - 1].x);
  let sweep = a0 - a1;
  while (sweep <= 0) sweep += TAU;
  const mid = a1 + sweep / 2;
  const up = Math.cos(mid) * w.r.u + Math.sin(mid) * w.u.u;
  ctx.fillStyle = up > 0 ? gnd : sky;
  disc(ctx, cx, cy, rad);
  ctx.beginPath();
  ctx.moveTo(cx + arc[0].x * rad, cy - arc[0].y * rad);
  for (const p of arc) ctx.lineTo(cx + p.x * rad, cy - p.y * rad);
  for (let i = 1; i <= 48; i++) {
    const a = a1 + (sweep * i) / 48;
    ctx.lineTo(cx + Math.cos(a) * rad, cy - Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = up > 0 ? sky : gnd;
  ctx.fill();
}

/** Nudge an arc endpoint onto the rim, so the two fills leave no seam. */
function onRim(p: P2): void {
  const l = Math.hypot(p.x, p.y);
  if (l > 1e-6) { p.x /= l; p.y /= l; }
}

function band(ctx: CanvasRenderingContext2D, cy: number, rad: number,
              hi: string, lo: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, cy - rad, 0, cy + rad);
  g.addColorStop(0, hi);
  g.addColorStop(1, lo);
  return g;
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, rad: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, TAU);
  ctx.fill();
}

function ladder(ctx: CanvasRenderingContext2D, w: View,
                cx: number, cy: number, rad: number): void {
  ctx.lineWidth = 1;
  ctx.strokeStyle = LINE;
  for (let p = -80; p <= 80; p += 10) {
    if (p !== 0) parallel(ctx, w, cx, cy, rad, p);
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = LINE_HI;
  parallel(ctx, w, cx, cy, rad, 0);
  for (const p of [-60, -30, 30, 60]) {
    for (const at of [-0.44, 0.44]) rung(ctx, w, cx, cy, rad, p, at);
  }
}

/** One line of constant pitch, broken wherever it goes round the back. */
function parallel(ctx: CanvasRenderingContext2D, w: View, cx: number, cy: number,
                  rad: number, pitchDeg: number): void {
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i <= 90; i++) {
    const p = project(dirOf((i / 90) * 360, pitchDeg), w);
    if (p.z <= 0) { pen = false; continue; }
    const x = cx + p.x * rad;
    const y = cy - p.y * rad;
    if (pen) ctx.lineTo(x, y);
    else { ctx.moveTo(x, y); pen = true; }
  }
  ctx.stroke();
}

/** The number on a ladder line, placed where that line passes `atX`. */
function rung(ctx: CanvasRenderingContext2D, w: View, cx: number, cy: number,
              rad: number, pitchDeg: number, atX: number): void {
  let best: P2 | null = null;
  let near = 1e9;
  for (let i = 0; i < 240; i++) {
    const p = project(dirOf((i / 240) * 360, pitchDeg), w);
    if (p.z <= 0.06) continue;
    const d = Math.abs(p.x - atX);
    if (d < near) { near = d; best = p; }
  }
  if (best === null || near > 0.1 || Math.hypot(best.x, best.y) > 0.98) return;
  const [x, y] = inward(best, cx, cy, rad, 8);
  label(ctx, `${pitchDeg}`, x, y, 9, INK);
}

/** N, E, S, W on the horizon, with a tick at every 30 degrees between them. */
function cardinals(ctx: CanvasRenderingContext2D, w: View,
                   cx: number, cy: number, rad: number): void {
  for (let h = 0; h < 360; h += 30) {
    const p = project(dirOf(h, 0), w);
    if (p.z <= 0.08) continue;
    const x = cx + p.x * rad;
    const y = cy - p.y * rad;
    if (h % 90 === 0) {
      const [lx, ly] = inward(p, cx, cy, rad, 11);
      label(ctx, 'NESW'.charAt(h / 90), lx, ly, 12, INK);
      continue;
    }
    // Set the pen per tick: label() leaves a fat dark one behind it, and the
    // first cardinal of the ring would otherwise blacken every tick after it.
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = LINE_HI;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
  }
}

/**
 * The fixed centre mark. Whatever sits under it is where the nose points.
 *
 * Its tail hangs DOWNWARD, which is not a style choice: the compass letters sit
 * just above the horizon line, and a level vessel on a cardinal heading puts
 * one of them exactly here. A tail pointing up scribbles through the N.
 */
function reticle(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  stroked(ctx, RETICLE, () => {
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy);
    ctx.lineTo(cx - 7, cy);
    ctx.moveTo(cx + 7, cy);
    ctx.lineTo(cx + 20, cy);
    ctx.moveTo(cx, cy + 7);
    ctx.lineTo(cx, cy + 13);
  });
  ctx.beginPath();
  ctx.arc(cx, cy, 2.6, 0, TAU);
  ctx.fillStyle = RETICLE;
  ctx.fill();
}

export function drawMarks(ctx: CanvasRenderingContext2D, size: number, w: View,
                          marks: readonly Mark[]): void {
  const cx = size / 2;
  const cy = size / 2;
  const rad = size / 2 - 5;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, TAU);
  ctx.clip();
  for (const m of marks) {
    const p = project(m.dir, w);
    const x = cx + p.x * rad;
    const y = cy - p.y * rad;
    stroked(ctx, COLOUR[m.kind], () => { shape(ctx, m.kind, x, y); });
  }
  ctx.restore();
}

/**
 * The five marker glyphs, each readable in one glance and none of them a
 * recolour of another: prograde is a wheel with three spokes, retrograde is the
 * same wheel crossed out, the SAS command is a winged diamond, the maneuver
 * node is KSP's own radiating trefoil, and the guidance ribbon is a
 * corner-bracket target, because it is the one you fly TOWARDS.
 */
function shape(ctx: CanvasRenderingContext2D, kind: MarkKind, x: number, y: number): void {
  ctx.beginPath();
  if (kind === 'prograde' || kind === 'retrograde') {
    ctx.arc(x, y, 6, 0, TAU);
    ctx.moveTo(x - 6, y); ctx.lineTo(x - 13, y);
    ctx.moveTo(x + 6, y); ctx.lineTo(x + 13, y);
    ctx.moveTo(x, y - 6); ctx.lineTo(x, y - 13);
    if (kind === 'prograde') {
      ctx.moveTo(x + 2.2, y); ctx.arc(x, y, 2.2, 0, TAU);
    } else {
      ctx.moveTo(x - 4.2, y - 4.2); ctx.lineTo(x + 4.2, y + 4.2);
      ctx.moveTo(x + 4.2, y - 4.2); ctx.lineTo(x - 4.2, y + 4.2);
    }
    return;
  }
  if (kind === 'command') {
    ctx.moveTo(x - 15, y); ctx.lineTo(x - 6, y);
    ctx.moveTo(x + 6, y); ctx.lineTo(x + 15, y);
    ctx.moveTo(x, y - 6.5);
    ctx.lineTo(x + 6, y);
    ctx.lineTo(x, y + 6.5);
    ctx.lineTo(x - 6, y);
    ctx.closePath();
    return;
  }
  if (kind === 'node') {
    // KSP's trefoil: a ring with three arms at 12, 4 and 8 o'clock. Distinct
    // in SHAPE from every other marker, not only in colour, because a player
    // reads this one against the prograde wheel it usually sits beside.
    ctx.arc(x, y, 5.5, 0, TAU);
    for (let k = 0; k < 3; ++k) {
      const a = -Math.PI / 2 + (k * TAU) / 3;
      ctx.moveTo(x + Math.cos(a) * 5.5, y + Math.sin(a) * 5.5);
      ctx.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13);
    }
    return;
  }
  const s = 10;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(x + sx * s, y + sy * s - sy * 5);
    ctx.lineTo(x + sx * s, y + sy * s);
    ctx.lineTo(x + sx * s - sx * 5, y + sy * s);
  }
  ctx.moveTo(x - s - 7, y); ctx.lineTo(x - 3, y);
  ctx.moveTo(x + 3, y); ctx.lineTo(x + s + 7, y);
}

/** Every glyph twice: a dark backing pass, then the colour. The ball is busy
 *  and a one pixel yellow line over a sunlit horizon is not a marker. */
function stroked(ctx: CanvasRenderingContext2D, colour: string, draw: () => void): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = SHADE;
  ctx.lineWidth = 3.6;
  draw();
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.7;
  draw();
  ctx.stroke();
}

/**
 * Where a label goes: on the point, nudged towards the middle of the ball.
 *
 * Always nudging UPWARD is the obvious version and it is wrong, because a line
 * near the top of the ball then pushes its own number off the edge. Near the
 * centre there is no meaningful inward, so it falls back to upward.
 */
function inward(p: P2, cx: number, cy: number, rad: number,
                px: number): [number, number] {
  const l = Math.hypot(p.x, p.y);
  const ux = l < 0.2 ? 0 : p.x / l;
  const uy = l < 0.2 ? -1 : p.y / l;
  return [cx + p.x * rad - ux * px, cy - p.y * rad + uy * px];
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
               px: number, colour: string): void {
  ctx.font = `600 ${px}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = SHADE;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}
