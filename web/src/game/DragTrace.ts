// WHAT THE HOLD-DRAG DECIDED, PER FIXED TICK, AND WHY (FS-99).
//
// GP-836's finding, routed to factory-sim: across five same-seed runs of
// `probes/assembler.js` the stone haul consumed a deterministic 914 to 915
// fixed ticks and a deterministic 47.8 m of eye travel, and laid 46, 53, 53,
// 46 and 64 belt tiles. A drag that walks the same path over the same ticks
// and lays a different number of tiles is deciding something the walk does not
// determine, and NO reading taken from outside can say which decision that is:
// the probe layer sees a tile count and a tip pose, both of them the sum of
// several hundred per-tick choices.
//
// So this records the CHOICE and not the outcome. Per call of
// `MachineDrag.stepMachine` it keeps the aim ray the tick was handed, the cell
// the ghost resolved from it, the run's own tip, and then every cell the fill
// loop considered together with the reason it was taken or refused. Two runs
// diffed line by line therefore name the first tick that differed AND the
// quantity that differed on it, which is the whole point: "the tile count
// varies" is a symptom, "on tick 412 the ghost resolved cell m1:-27,19 in one
// run and m1:-27,20 in the other, from aim origins 0.0771 m apart" is a cause.
//
// THE AIM RAY IS RECORDED AT FULL PRECISION on purpose. The suspected class of
// defect is a wall-clock-coupled sample (a render-interpolated eye read by a
// fixed tick), and that shows up as a sub-centimetre difference in the ray
// hundreds of ticks before it shows up as a different cell. Rounded to
// millimetres it would be invisible until it was already too late to attribute.
//
// OFF BY DEFAULT, armed through `__of.dragTrace(true)`, and null-checked at the
// one call site, so a world with no probe attached pays one null test per tick.

/** One cell the fill loop looked at, and what happened to it. */
export interface DragStep {
  /** The cell considered, as site-local `i,j`. */
  i: number;
  j: number;
  /**
   * Why the loop stopped, or 'laid'. `reversal` is `dragRun`'s 180 degree
   * guard, `refused` is `Factory.stage` declining the cell, `capped` is
   * `DRAG_FILL_MAX`.
   */
  how: 'laid' | 'reversal' | 'refused' | 'capped';
  /**
   * THE TILE'S ORIENTATION AT THE MOMENT IT IS ASSIGNED, as the site's own
   * tangent axis: `e` and `n` are the heading's components on the site east and
   * north, each -1, 0 or 1 after `headingIn` has reduced it to one of four.
   *
   * Recorded here rather than read back off the placement because `reface`
   * turns the PREVIOUS tile on the very next iteration, so a tile's orientation
   * as read from the finished run is not the one it was laid with, and the
   * tip's is the only one that never gets refaced. The reported symptom is
   * about the tip specifically.
   */
  e: number;
  n: number;
}

/** One fixed tick of the machine drag. */
export interface DragSample {
  /** Calls of `stepMachine` since the trace was armed. NOT the world tick:
   *  build mode is not stepped while a UI panel is open, and a gap in a
   *  world-tick column would read as a stall that never happened. */
  seq: number;
  /** The aim ray this tick was handed, at full precision. See the header. */
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  /** What the ghost resolved: the occupancy key, the site-local cell, and
   *  whether the aim march actually met the ground. */
  cell: string;
  ci: number;
  cj: number;
  aimed: boolean;
  ok: boolean;
  reason: string;
  /** The gesture's own state, so a tick that laid nothing says which gate. */
  pressed: boolean;
  held: boolean;
  moved: boolean;
  /** The run's tip before this tick's fill, or null when no run is in progress. */
  ti: number | null;
  tj: number | null;
  /** The tip's last step, which is what the reversal guard compares against. */
  si: number | null;
  sj: number | null;
  /** Empty when the tick laid nothing; then `gate` says which return it took. */
  steps: DragStep[];
  /** 'ghost' (no target), 'standing' (press onto an existing tile), 'placed'
   *  (press laid one), 'refused', 'idle' (not held), 'site' (the crosshair left
   *  the run's site), 'fresh' (GP-59's one skipped tick), 'still' (`moved`
   *  false), or 'run' (the fill loop ran). */
  gate: string;
}

/**
 * A fixed-size ring of per-tick drag decisions. Sized for the whole of the
 * assembler probe's stone haul (915 ticks) with room to spare, because the
 * question it answers is "which tick FIRST differed" and the first one is at
 * the beginning.
 */
export class DragTrace {
  private readonly buf: DragSample[] = [];
  private w = 0;
  /** Ticks seen since `reset`, which may exceed `cap`. */
  total = 0;

  constructor(readonly cap = 4000) {}

  reset(): void { this.buf.length = 0; this.w = 0; this.total = 0; }

  push(s: DragSample): void {
    this.total++;
    if (this.buf.length < this.cap) { this.buf.push(s); return; }
    this.buf[this.w] = s;
    this.w = (this.w + 1) % this.cap;
  }

  /** Oldest first, so a consecutive-tick difference is a forward difference. */
  dump(): DragSample[] {
    if (this.buf.length < this.cap) return this.buf.slice();
    return this.buf.slice(this.w).concat(this.buf.slice(0, this.w));
  }

  /**
   * The trace as one diffable line per tick.
   *
   * A JSON dump of several hundred samples is not something a person or a
   * `diff` reads usefully, and the comparison this exists for is exactly a
   * line-by-line one between two runs. Fixed-width fields, the ray to seven
   * decimals (0.1 mm, comfortably below the 0.077 m one tick of walk covers),
   * and the fill loop flattened into `i,j:how:e,n` triples.
   */
  lines(): string[] {
    return this.dump().map((s) => {
      const steps = s.steps.map((p) => `${p.i},${p.j}:${p.how}:${p.e},${p.n}`)
        .join(' ');
      return `${String(s.seq).padStart(4, '0')} `
        + `o=${s.ox.toFixed(7)},${s.oy.toFixed(7)},${s.oz.toFixed(7)} `
        + `d=${s.dx.toFixed(7)},${s.dy.toFixed(7)},${s.dz.toFixed(7)} `
        + `cell=${s.cell} aimed=${s.aimed ? 1 : 0} ok=${s.ok ? 1 : 0} `
        + `p=${s.pressed ? 1 : 0}h=${s.held ? 1 : 0}m=${s.moved ? 1 : 0} `
        + `tip=${s.ti},${s.tj} step=${s.si},${s.sj} gate=${s.gate} `
        + `n=${s.steps.length}${steps === '' ? '' : ` | ${steps}`}`;
    });
  }
}
