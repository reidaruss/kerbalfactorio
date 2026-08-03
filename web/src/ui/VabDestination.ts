// =============================================================================
// VabDestination.ts - "WHERE IS THIS ROCKET GOING", in the bay, before it flies.
//
// GP-264. Reid's first autopilot ask: "during rocket building vab you should be
// able to select remote targets ... and it should tell you if there is enough
// fuel on the current rocket to rendezvous with the destination." This is the
// cheapest slice of the feature that makes the part mean something, and it is
// deliberately the one that lands first: a player can answer "will this rocket
// get there" without anything ever leaving the ground.
//
// It MOUNTS ITSELF into the assembly panel's right rail rather than living
// inside `VabPanel`. Two reasons, and the first is not the interesting one:
// `VabPanel.ts` is already over the 400-line cap. The real reason is that this
// block has a different lifetime from everything around it. The catalogue, the
// readouts and the stage table are all pure functions of the design and are
// rebuilt whenever it moves; a destination is a CHOICE the player made, and a
// choice must survive a repaint of the thing it is about.
//
// TWO KEYSTROKE RULES, both bought the hard way in this seat:
//
//  - The two orbit boxes are built ONCE, in the skeleton, and `render` never
//    replaces them. GP-136: the save panel's name field round-tripped through
//    the render path and the box the player was typing in was wiped mid-word.
//    Making the inputs structurally unreachable from `render` means that defect
//    cannot recur here, rather than being fixed here.
//  - Every key event inside them is stopped, because the game binds letters and
//    digits (`VabPanel` does the same for its name field).
// =============================================================================
import type { AutopilotTarget } from '../game/AutopilotTargets.js';
import type { ModuleFit, Reach } from '../game/Autopilot.js';
import { REACH_LEGS, waitingSentence } from '../game/Autopilot.js';
import { esc } from './GameHud.js';

export interface VabDestHooks {
  select(id: string): void;
  /** The requested orbit's two numbers, as typed. */
  setOrbit(altKm: number, incDeg: number): void;
}

export interface VabDestState {
  rows: readonly AutopilotTarget[];
  selectedId: string;
  fit: ModuleFit;
  reach: Reach;
  /** /core's own total for this design, and labelled as such on screen. */
  dvAvailableMS: number;
  altKm: number;
  incDeg: number;
}

// THE VERDICT SITS ABOVE THE LIST, which is GP-118's argument about the flight
// band one panel over: the loud thing goes where it is seen, and a verdict
// below a scrolling list is a verdict nobody reads. Measured, not assumed: the
// first version put it last and the screenshot cut `REACH PENDING` off at the
// rail's bottom edge with the sentence that explains it entirely off screen.
const SKELETON =
  '<h3 class="mid">Destination</h3>'
  + '<div class="of-vdest"><div class="of-vdgate"></div>'
  + '<div class="of-vdreach"></div>'
  + '<div class="of-vdrows"></div>'
  + '<div class="of-vdorbit"><label>alt<input type="text" inputmode="decimal" '
  + 'id="of-vd-alt" size="5" autocomplete="off" spellcheck="false"><i>km</i>'
  + '</label><label>inc<input type="text" inputmode="decimal" id="of-vd-inc" '
  + 'size="4" autocomplete="off" spellcheck="false"><i>deg</i></label></div>'
  + '</div>';

function fmt(v: number, d = 0): string {
  return Number.isFinite(v) ? v.toFixed(d) : '---';
}

export class VabDestination {
  private readonly el: HTMLElement;
  private readonly gateEl: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private readonly orbitEl: HTMLElement;
  private readonly reachEl: HTMLElement;
  private readonly altIn: HTMLInputElement;
  private readonly incIn: HTMLInputElement;
  /** [gate, rows, reach, orbit-shown]. */
  private last = ['', '', '', ''];

  constructor(vabRoot: HTMLElement, private readonly hooks: VabDestHooks) {
    const rail = vabRoot.querySelector<HTMLElement>('.rail.right');
    this.el = document.createElement('div');
    this.el.className = 'of-vdwrap';
    this.el.innerHTML = SKELETON;
    (rail ?? vabRoot).appendChild(this.el);
    this.gateEl = this.pick('.of-vdgate');
    this.rowsEl = this.pick('.of-vdrows');
    this.orbitEl = this.pick('.of-vdorbit');
    this.reachEl = this.pick('.of-vdreach');
    this.altIn = this.pick('#of-vd-alt') as HTMLInputElement;
    this.incIn = this.pick('#of-vd-inc') as HTMLInputElement;
    // ONE delegated listener over the block, never one per row: the row list is
    // rebuilt whenever the registry moves and per-row listeners would be leaked
    // with it (VabPanel's own rule).
    this.el.addEventListener('click', (e) => { this.onClick(e); });
    for (const box of [this.altIn, this.incIn]) {
      for (const t of ['keydown', 'keyup', 'keypress']) {
        box.addEventListener(t, (e) => { e.stopPropagation(); });
      }
      // `input`, not `change`: the number is read as it is typed, and because
      // `render` never touches these elements, reading them cannot wipe them.
      box.addEventListener('input', () => { this.pushOrbit(); });
    }
  }

  private pick(sel: string): HTMLElement {
    return this.el.querySelector<HTMLElement>(sel) as HTMLElement;
  }

  private pushOrbit(): void {
    const alt = Number(this.altIn.value);
    const inc = Number(this.incIn.value);
    // A half-typed number is not an error and must not blank the row: the last
    // good value stands until the box parses again.
    if (!Number.isFinite(alt) || !Number.isFinite(inc)) return;
    this.hooks.setOrbit(alt, inc);
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-dest]');
    if (t === null || t === undefined) return;
    const id = t.getAttribute('data-dest') ?? '';
    if (id !== '') this.hooks.select(id);
  }

  /** Force a rebuild on the next render. */
  invalidate(): void { this.last = ['', '', '', '']; }

  render(s: VabDestState): void {
    const kGate = `${s.fit.fitted ? 1 : 0}|${s.fit.reason}`;
    const kRows = `${s.selectedId}|`
      + s.rows.map((r) => `${r.id}:${r.detail}:${r.blocked === '' ? 1 : 0}`).join(',');
    const kReach = `${s.reach.waitingOn}|${fmt(s.reach.dvRequiredMS, 1)}|`
      + `${fmt(s.dvAvailableMS, 1)}|${fmt(s.reach.marginMS, 1)}|`
      + `${s.reach.feasible ? 1 : 0}|${s.selectedId}`;
    const kOrbit = s.selectedId === 'orbit' ? '1' : '0';
    if (kGate !== this.last[0]) {
      this.last[0] = kGate;
      // The gate is a NOTE and not a disabled overlay: the list stays readable
      // with no module fitted, because "what could I go to if I fitted one" is
      // the question that makes a player fit one.
      this.gateEl.innerHTML = s.fit.fitted
        ? '<div class="ok">Autopilot Module fitted</div>'
        : `<div class="warn">${esc(s.fit.reason)}</div>`;
    }
    if (kRows !== this.last[1]) {
      this.last[1] = kRows;
      this.rowsEl.innerHTML = s.rows.length === 0
        ? '<div class="none">Nothing to aim at yet. Anything you leave in '
          + 'orbit shows up here.</div>'
        : s.rows.map((r) => destRow(r, r.id === s.selectedId)).join('');
    }
    if (kOrbit !== this.last[3]) {
      this.last[3] = kOrbit;
      this.orbitEl.classList.toggle('on', kOrbit === '1');
      // Seed the boxes ONLY when they are empty, so a player's typing is never
      // overwritten by the state it produced.
      if (this.altIn.value === '') this.altIn.value = `${s.altKm}`;
      if (this.incIn.value === '') this.incIn.value = `${s.incDeg}`;
    }
    if (kReach !== this.last[2]) {
      this.last[2] = kReach;
      this.reachEl.innerHTML = reachBlock(s);
    }
  }

  // --- the driven surface ---------------------------------------------------

  get root(): HTMLElement { return this.el; }

  rowButton(id: string): HTMLElement | null {
    return this.el.querySelector<HTMLElement>(`[data-dest="${id}"]`);
  }

  get altInput(): HTMLInputElement { return this.altIn; }
  get incInput(): HTMLInputElement { return this.incIn; }

  /** The verdict AS PAINTED. An assertion against this is an assertion about
   *  the screen and not about the model (GP-64). */
  get verdictText(): string {
    return this.el.querySelector<HTMLElement>('.of-vdband')?.textContent ?? '';
  }

  get gateText(): string { return this.gateEl.textContent ?? ''; }

  get rowIds(): string[] {
    return [...this.el.querySelectorAll<HTMLElement>('[data-dest]')]
      .map((r) => r.getAttribute('data-dest') ?? '');
  }

  /** Which rows are drawn as unusable, off the CLASS the painter set, so the
   *  probe reads the screen rather than re-deriving the rule. */
  get blockedRowIds(): string[] {
    return [...this.el.querySelectorAll<HTMLElement>('[data-dest].blocked')]
      .map((r) => r.getAttribute('data-dest') ?? '');
  }

  get selectedRowId(): string {
    return this.el.querySelector<HTMLElement>('[data-dest].sel')
      ?.getAttribute('data-dest') ?? '';
  }
}

function destRow(r: AutopilotTarget, selected: boolean): string {
  const blocked = r.blocked !== '';
  return `<button type="button" class="of-vdrow${selected ? ' sel' : ''}`
    + `${blocked ? ' blocked' : ''}" data-dest="${esc(r.id)}" `
    + `aria-pressed="${selected ? 'true' : 'false'}">`
    + `<span class="top"><span class="nm">${esc(r.name)}</span>`
    + `<span class="kind">${esc(r.kind)}</span></span>`
    + `<span class="det">${esc(blocked ? r.blocked : r.detail)}</span></button>`;
}

/**
 * THE VERDICT, and it has THREE states rather than two.
 *
 * "can reach" and "cannot reach" are the two Reid asked for. The third is
 * PENDING, and printing it is the whole point: the mission cost belongs to the
 * physics lane's solver, and a screen that showed a confident green band while
 * that solver was absent would be lying in the most expensive direction. The
 * vehicle's own delta-v is shown either way, because it is real and it is
 * /core's.
 */
function reachBlock(s: VabDestState): string {
  const sel = s.selectedId !== '';
  const row = s.rows.find((r) => r.id === s.selectedId) ?? null;
  if (!sel || row === null) {
    return '<div class="of-vdband none">Pick a destination</div>'
      + line('vehicle dV', `${fmt(s.dvAvailableMS)} m/s`, 'src')
      + '<div class="note">Vehicle delta-v is the figure /core publishes '
      + '(of_vs_total_dv_vacuum).</div>';
  }
  if (row.blocked !== '') {
    return `<div class="of-vdband bad">CANNOT PLAN</div>`
      + `<div class="note">${esc(row.blocked)}</div>`;
  }
  const r = s.reach;
  if (r.waitingOn !== '') {
    return '<div class="of-vdband pend">REACH PENDING</div>'
      + line('vehicle dV', `${fmt(s.dvAvailableMS)} m/s`, 'src')
      + `<div class="note">${esc(waitingSentence(r.waitingOn))}</div>`;
  }
  const good = r.feasible;
  const out = [`<div class="of-vdband ${good ? 'ok' : 'bad'}">`
    + `${good ? 'CAN REACH' : 'CANNOT REACH'}</div>`];
  out.push(line('needs', `${fmt(r.dvRequiredMS)} m/s`, ''));
  out.push(line('vehicle dV', `${fmt(r.dvAvailableMS)} m/s`, 'src'));
  out.push(line(good ? 'margin' : 'SHORT BY',
    `${fmt(Math.abs(r.marginMS))} m/s`, good ? 'ok' : 'bad'));
  for (let k = 0; k < REACH_LEGS.length; ++k) {
    const v = r.legsMS[k];
    if (v === undefined || !(v > 0)) continue;
    out.push(line(REACH_LEGS[k] ?? '', `${fmt(v)} m/s`, 'leg'));
  }
  return out.join('');
}

function line(label: string, value: string, cls: string): string {
  return `<div class="of-vdline ${cls}"><em>${esc(label)}</em>`
    + `<b>${esc(value)}</b></div>`;
}
