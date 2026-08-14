// GP-700. THE COMPASS STRIP, split out of GameHud.ts along the seam
// GameplayChrome.ts's own header names: "Split out of Gameplay when ... the
// composition hit its 400-line cap". Adding the strip inline pushed GameHud
// from 301 to 431 lines against `scripts/check-limits.mjs`'s 400 cap, so this
// is that same rule applied to itself rather than an exception carved out for
// a new feature.
//
// DW-2 UNCHANGED: HTML/CSS only, zero three.js, plain data in. game/Compass.ts
// computes the numbers; this file only turns them into a strip and clips
// whatever falls outside its field of view.

/**
 * One bearing on the strip: a known marker (MarkerRegistry, GP-520) or the
 * player's own pad (LaunchPad.ts). `kind` is `ruin` | `signal` | `deposit`
 * (MapMarker's own union) or `pad`, read only for a CSS class -- the label
 * text is what a player actually reads, GP-165's own rule applied here (the
 * text comes off the one binding both maps already draw from,
 * `MapMarker.label` / a literal `Pad`, never re-spelled per kind in this file).
 */
export interface CompassChip {
  key: string;
  label: string;
  kind: string;
  /** 0..360: 0 is north, 90 is east (Controller.ts's own convention,
   *  `forward = north*cos(yaw) + east*sin(yaw)`). */
  bearingDeg: number;
}

/** game/Compass.ts's whole answer for one frame: plain numbers only, so this
 *  file never touches a quaternion or a body-frame vector itself. */
export interface CompassReadout {
  /** The player's own facing, same convention as `CompassChip.bearingDeg`. */
  headingDeg: number;
  chips: readonly CompassChip[];
}

/** How wide the strip's field of view is, either side of straight ahead. A
 *  marker or tick outside this window is simply never appended to the strip's
 *  HTML, which is what makes "falls off the edge as you turn" a property of
 *  the modulo arithmetic and not a second rule kept in step with the CSS
 *  width by hand. */
const HALF_FOV_DEG = 70;

const CARDINALS: ReadonlyArray<{ name: string; deg: number }> = [
  { name: 'N', deg: 0 }, { name: 'NE', deg: 45 }, { name: 'E', deg: 90 },
  { name: 'SE', deg: 135 }, { name: 'S', deg: 180 }, { name: 'SW', deg: 225 },
  { name: 'W', deg: 270 }, { name: 'NW', deg: 315 },
];

/** Signed degrees from `heading` to `target`, in (-180, 180]: how far right
 *  (positive) or left (negative) of straight ahead `target` sits. */
function relBearing(target: number, heading: number): number {
  return ((target - heading + 180) % 360 + 360) % 360 - 180;
}

/** Local, not imported from GameHud.ts: importing a value out of the module
 *  that composes this one would be a real circular VALUE dependency (not
 *  just a type), and a four-line pure function is cheaper to keep in step
 *  than a cycle is to reason about. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

/**
 * Owns its own element, its own diff key and its own last-published report.
 * `GameHud` composes one of these exactly as it composes nothing else today,
 * because the strip has no state any other HUD widget needs to read.
 */
export class CompassStrip {
  private readonly el: HTMLElement;
  private lastKey = '';
  private lastReport: unknown = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'of-compass';
    this.el.className = 'of-ui';
    parent.appendChild(this.el);
  }

  /**
   * Hides the strip with the crosshair (`GameHud.setVisible`'s own group).
   * Resets the diff key too, not only on the next `render(null)`:
   * `setVisible(false)` can arrive off-tick (a panel opening the same frame
   * as a mode change), and without this a `report()` read in between would
   * still answer the LAST visible frame's chips -- the stale-report class
   * GP-690's catalogue entry is about.
   */
  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
    if (!v) { this.lastKey = ''; this.lastReport = null; }
  }

  /** `__of.game()`'s own `compass` block (GameplayReport.ts): what the strip
   *  drew last, or `null` exactly when it is hidden -- a probe reads this
   *  rather than pixels, the `progress`/`stations` precedent. */
  report(): unknown { return this.lastReport; }

  /**
   * `c` arrives computed EVERY FRAME regardless of mode (game/Compass.ts has
   * no `aboard`/map-open fact to gate on); the caller decides whether to draw
   * at all by calling `setVisible`, so this only has to handle `c === null`
   * as "nothing to show yet", not as a mode.
   */
  render(c: CompassReadout | null): void {
    if (c === null) {
      if (this.lastKey !== '') {
        this.el.style.display = 'none';
        this.lastKey = '';
        this.lastReport = null;
      }
      return;
    }
    const heading = Math.round(((c.headingDeg % 360) + 360) % 360);
    const key = `${heading}|${c.chips
      .map((x) => `${x.key}:${Math.round(x.bearingDeg)}`).join(',')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.el.style.display = 'block';

    const parts: string[] = [];
    for (const t of CARDINALS) {
      const rel = relBearing(t.deg, c.headingDeg);
      if (Math.abs(rel) > HALF_FOV_DEG) continue;
      const left = (50 + (rel / HALF_FOV_DEG) * 50).toFixed(2);
      const cls = t.deg % 90 === 0 ? ' major' : '';
      parts.push(`<b class="tick${cls}" style="left:${left}%">${t.name}</b>`);
    }
    for (const m of c.chips) {
      const rel = relBearing(m.bearingDeg, c.headingDeg);
      if (Math.abs(rel) > HALF_FOV_DEG) continue;
      const left = (50 + (rel / HALF_FOV_DEG) * 50).toFixed(2);
      parts.push(`<i class="chip ${esc(m.kind)}" style="left:${left}%">`
        + `${esc(m.label)}</i>`);
    }
    this.el.innerHTML = `<div id="of-compass-strip">${parts.join('')}</div>`
      + `<div id="of-compass-caret"></div>`;
    this.lastReport = {
      headingDeg: heading,
      chips: c.chips.map((x) => ({
        key: x.key, label: x.label, kind: x.kind,
        bearingDeg: Math.round(x.bearingDeg * 10) / 10,
      })),
    };
  }
}
