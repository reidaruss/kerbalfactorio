// The factory, drawn from the section 6 stream and from nothing else.
//
// The rule this file exists to keep is DW-8, and it shows up as an ABSENCE:
// there is no AnimationMixer, no per-belt clock and no per-item object. A belt
// tile is an instance whose flow speed and fill fraction come from one
// FFactoryBeltFlowState row, so N tiles on a line cost ONE row and one texel
// each, and the render cost is O(lines). The authored Belt_Scroll clip stays in
// the .glb as reference and is deliberately never played.
//
// Machines read the other stream: FFactoryEntityState.VisualState drives the
// emissive chip the asset already ships (idle / working / blocked / no power),
// so "is it working" is the simulation's answer, rendered, and not a second
// opinion computed here.
//
// DW-9: inserters are sim-internal. connect() creates them, the player never
// places one, and one is drawn wherever the plan recorded a connection, which
// is what makes a wired line legible.

import * as THREE from 'three';
import { loadGlb } from '../assets/Loaders.js';
import { MachineBatch, type MachineTemplate } from './MachineBatch.js';
import { TYPE_ID, type BuildKind, type Factory, type Placed } from './Factory.js';
import { orient } from './Grid.js';
import { cornersOf } from './BeltCorners.js';
import { readMachineSockets, type SocketDef } from './FactorySnap.js';
import { publishPorts } from './FactoryPorts.js';
import { BeltCargo } from './BeltCargo.js';
import { WireView } from '../render/WireView.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

const TEMPLATES: Record<string, MachineTemplate> = {
  miner: { url: 'assets/machines/miner.glb', root: 'Miner' },
  // OF_Rubber is the deck, and the deck is what the flow band scrolls along.
  belt: { url: 'assets/machines/belt_segment.glb', root: 'BeltSegment',
          flowMaterial: 'Rubber' },
  // W7. The curve tiles shipped at Tier 0 and nothing drew them, so a line that
  // turned a corner was two straight tiles meeting at a right angle with a notch
  // in the deck. They are DERIVED, never placed: the player lays belts and the
  // view works out which tiles are corners, because a turn is a property of a
  // run and not a thing to make somebody choose from a menu.
  belt_l: { url: 'assets/machines/belt_curve_l.glb', root: 'BeltCurveL',
            flowMaterial: 'Rubber', arc: 'l' },
  belt_r: { url: 'assets/machines/belt_curve_r.glb', root: 'BeltCurveR',
            flowMaterial: 'Rubber', arc: 'r' },
  smelter: { url: 'assets/machines/smelter.glb', root: 'Smelter' },
  inserter: { url: 'assets/machines/inserter.glb', root: 'Inserter' },
  // ABI 9. The pole and the generator shipped at Tier 0 (0x16 and 0x15) and
  // nothing drew them, because until tonight nothing could place one. The
  // ELECTRIC smelter deliberately reuses the smelter's own asset: it is the
  // same machine with a different power source, and inventing a second mesh
  // for it would be this lane authoring the art lane's content.
  pole: { url: 'assets/machines/power_pole.glb', root: 'PowerPole' },
  generator: { url: 'assets/machines/generator.glb', root: 'Generator' },
  esmelter: { url: 'assets/machines/smelter.glb', root: 'Smelter' },
};

/**
 * FS-47: `?inserters=1` DRAWS THE ARM ON EVERY LINK AGAIN, as it did before
 * ports existed. It is not a preference and there is no way to reach it from
 * the game; it exists so the saving can be MEASURED rather than asserted.
 *
 * Standing rule 7, verbatim: a measurement that has not isolated its subject is
 * an opinion. The claim being made is that the auto-created inserter population
 * was the dominant triangle cost at scale, and the only honest way to check it
 * is to run the SAME scene with the arms on and with them off and subtract, in
 * the same way `?proxy=0`, `?shell=0`, `?atmos=0` and `?stitch=0` exist so that
 * any single layer can be taken away. Reading it here rather than through
 * `Config` keeps the flag beside the thing it isolates and out of a shared
 * parser this lane does not own; `Boot.ts` reads `?gnomon` the same way.
 *
 * Read ONCE at module load, not per frame: a flag that can change mid-run turns
 * a before-and-after measurement into two halves of one ambiguous number.
 */
const LEGACY_INSERTERS = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('inserters') === '1';

/** kUnitsPerTile from factory_sim.h, and the fixed tick rate. */
const UNITS_PER_TILE = 256;
const TICKS_PER_SEC = 60;
/** Bands per metre in the deck shader; the flow value is bands per second. */
const BANDS_PER_M = 2;

export class FactoryView {
  readonly group = new THREE.Group();
  readonly batch = new MachineBatch();
  /** FS-28: discrete cargo riding the belts, at LOD 0 only. */
  readonly cargo = new BeltCargo();
  /** H-6: the grid's own spanning tree, drawn between the poles' crossarms. */
  readonly wires = new WireView();
  /**
   * FS-26: every socket the machine assets publish, read once at load. The
   * placement layer snaps to these; nothing recomputes a half-tile offset.
   */
  sockets: ReadonlyMap<string, SocketDef[]> = new Map();
  private ghost: THREE.Mesh | null = null;
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private readonly slots = new Map<number, number>();
  /** Which template each slot is currently drawing, so a corner can re-point. */
  private readonly drawn = new Map<number, string>();
  /** Belt tiles drawn as curves this frame, and which way each one turns. */
  curves: { id: number; turn: string }[] = [];
  /**
   * FS-40: ASSET-SPECS 4.12's two BODY endpoints for each of the three tile
   * shapes, read off the shipped `.glb` files at load and published raw.
   *
   * This is the socket convention a probe measures the SEAM with. All three
   * files put `socket_belt_in` at local (0, 0.25, -0.5); the outlet is at +Z on
   * the straight, -X on the left curve and +X on the right. Publishing the
   * numbers rather than a conclusion is the point: the probe rebuilds where each
   * tile's body ends from the asset and from the matrix three will draw, and
   * never from this file's opinion about which tiles are corners.
   */
  beltSockets: Record<string, { in: number[]; out: number[] }> = {};
  /** The last plan `sync` saw, so `stats()` can report per-tile draw state. */
  private lastPlan: Factory | null = null;
  private readonly linkSlots: number[] = [];
  /** FS-47: how many inserter instances were actually DRAWN this frame, against
   *  how many slots exist. A probe measuring the triangle saving needs the drawn
   *  count, and a hidden slot still owns an instance. */
  private drawnInserters = 0;
  private readonly p = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private t = 0;

  constructor(private readonly origin: FloatingOrigin) {
    this.group.name = 'factory';
    this.group.add(this.batch.group);
    this.group.add(this.cargo.group);
    this.group.add(this.wires.group);
    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x63d0ff, transparent: true, opacity: 0.35, depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  async load(): Promise<void> {
    const loaded = new Map<string, { def: MachineTemplate; scene: THREE.Object3D }>();
    await Promise.all(Object.entries(TEMPLATES).map(async ([key, def]) => {
      const g = await loadGlb(def.url);
      loaded.set(key, { def, scene: g.scene });
    }));
    this.batch.build(loaded);
    // FS-26: the sockets come off the SAME scenes the batch was built from, so
    // the geometry drawn and the geometry snapped to cannot fall out of step.
    this.sockets = readMachineSockets(loaded);
    // FS-43: and the SAME sockets become the IO ports the wiring connects
    // through, published from here because this is the one function in the
    // client that opens the shipped `.glb` files. FactoryPorts' header argues
    // why it is published rather than threaded.
    publishPorts(this.sockets);
    // ALL THREE TILE SHAPES, not just the straight. FS-31 solved the arc
    // through the curve tiles' published sockets and shipped with only the
    // first argument passed, so `BeltCargo.load`'s missing-file fallback
    // (`pathOf(null) ?? this.straight`) quietly gave every corner tile the
    // STRAIGHT path and cargo rode 0.618 m off the bend at the corner's exit,
    // which is Reid's "the resource appears to fall off the end instead of
    // turning". Measured by `probes/beltcargo.js`, the probe FS-31 deferred;
    // the fallback itself is kept, because it is for a genuinely absent file.
    await this.cargo.load(loaded.get('belt')?.scene ?? null,
      loaded.get('belt_l')?.scene ?? null,
      loaded.get('belt_r')?.scene ?? null);
    // H-6: the wire attachment comes off the SAME pole scene the batch drew, so
    // the mast that is rendered and the crossarm the cable lands on cannot fall
    // out of step. `socket_wire_a` / `socket_wire_b` are the asset's own
    // contract for this and had never been read.
    this.wires.load(loaded.get('pole')?.scene ?? null);
    for (const key of ['belt', 'belt_l', 'belt_r']) {
      const s = loaded.get(key)?.scene;
      const i = s?.getObjectByName('socket_belt_in');
      const o = s?.getObjectByName('socket_belt_out');
      if (i === undefined || o === undefined) continue;
      this.beltSockets[key] = { in: i.position.toArray(), out: o.position.toArray() };
    }
    // ONE ghost mesh, re-pointed at whichever machine is selected. A clone per
    // frame would allocate a mesh sixty times a second to draw a preview.
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
    this.ghost.name = 'buildGhost';
    this.ghost.frustumCulled = false;
    this.ghost.visible = false;
    this.ghost.renderOrder = 3;
    this.group.add(this.ghost);
  }

  /**
   * One pass over the plan: place every instance and write its fx texel.
   *
   * The two streams are pulled ONCE each, not per building: EmitEntityStates is
   * O(entities) and EmitBeltFlowStates is O(lines), and asking per building
   * would quietly turn both into O(n^2) the moment a base got interesting.
   */
  sync(f: Factory, simSecs: number,
       eye: { x: number; y: number; z: number }): void {
    this.t = simSecs;
    this.lastPlan = f;
    this.batch.setTime(simSecs);
    const rows = new Map<number, { visual: number; anim: number }>();
    for (const r of f.line.entityStates()) rows.set(r.id, r);
    const flows = new Map<number, { speedQuant: number; density: number }>();
    for (const r of f.line.beltFlows()) flows.set(r.lineId, r);
    const corners = cornersOf(f);

    for (const b of f.placed) {
      const corner = corners.get(b.id);
      const key = corner === undefined ? b.kind : `belt_${corner.turn}`;
      let slot = this.slots.get(b.id);
      if (slot === undefined) {
        slot = this.batch.acquire(key);
        if (slot < 0) continue;
        this.slots.set(b.id, slot);
        this.drawn.set(b.id, key);
      } else if (this.drawn.get(b.id) !== key) {
        // A tile becomes a corner when the tile behind it is laid, which is a
        // change of MESH with no change of instance.
        if (this.batch.setGeometry(slot, key)) this.drawn.set(b.id, key);
      }
      this.origin.toEngine(b.pos, this.p);
      // A curve is oriented by the flow ENTERING it, because the mesh's own
      // inlet is on its -Z face exactly where a straight tile's outlet is; the
      // turn is baked into the geometry, not into the transform.
      this.m.compose(this.p, corner === undefined ? b.quat : corner.quat, this.one);
      this.batch.place(slot, this.m);
      this.batch.setFx(slot, this.fxFor(b, f, rows, flows));
    }
    this.syncLinks(f);
    this.batch.flush();
    // FS-28. The corners map is handed straight over rather than recomputed:
    // cargo has to ride the deck that is actually drawn, and two answers to
    // "is this tile a curve" is how it ends up riding the one that is not.
    this.cargo.sync(f, f.core, this.origin, eye, corners);
    // H-6. Handed the whole factory rather than an edge list, because the view
    // decides WHEN to ask /core: the segments are pulled on a topology change
    // and the transforms rewritten on a rebase, and a steady frame does neither.
    this.wires.sync(f, this.origin);
    this.curves = [...corners].map(([id, c]) => ({ id, turn: c.turn }));
  }

  private fxFor(b: Placed, f: Factory,
                rows: Map<number, { visual: number; anim: number }>,
                flows: Map<number, { speedQuant: number; density: number }>) {
    if (b.kind === 'belt') {
      const line = f.runBuilds[b.run];
      const id = line === undefined ? -1 : f.line.entityIndex(line);
      const fl = flows.get(id);
      if (fl === undefined) return { flow: 0, density: 0, state: 0, level: 0 };
      return {
        // units/tick -> metres/second -> bands/second. One conversion, here.
        flow: (fl.speedQuant / UNITS_PER_TILE) * TICKS_PER_SEC * BANDS_PER_M,
        density: fl.density / 255,
        state: 0, level: 0,
      };
    }
    const r = rows.get(b.entity);
    const visual = r?.visual ?? 0;
    // A working machine breathes; anything else holds steady, because a blocked
    // machine that pulses reads as busy and that is the one thing it is not.
    const level = visual === 1
      ? 0.62 + 0.38 * Math.sin(this.t * 6.0 + b.id)
      : (visual === 2 ? 0.85 : 0.18);
    return { flow: 0, density: 0, state: visual, level };
  }

  /**
   * Drop a demolished building's instance. Without this the slot keeps drawing
   * the machine at its last transform for ever, which is the exact shape of the
   * "I removed it and it is still there" bug.
   */
  release(id: number): void {
    const slot = this.slots.get(id);
    if (slot === undefined) return;
    this.batch.release(slot);
    this.slots.delete(id);
    this.drawn.delete(id);
  }

  /**
   * FS-47: NO INSERTER IS DRAWN ON A PORT CONNECTION, and DW-9 is the reason
   * rather than the obstacle.
   *
   * DW-9's argument was that inserters are sim-internal, the player never places
   * one, and drawing the mesh wherever a connection exists is what makes a
   * connection LEGIBLE. That argument was correct and it has been satisfied by
   * something better: under FS-44 the belt physically ends at the machine's
   * hopper, so the connection is legible because you can see it. Keeping the
   * inserter as well would draw a robot arm reaching across a gap that no longer
   * exists, which is worse than redundant, it is a lie about the mechanism.
   *
   * IT IS ALSO THE DOMINANT TRIANGLE COST AT SCALE, which is why this is a
   * measurement and not only a taste call. `connect()` mints one inserter per
   * adjacency, so the population grows with CONNECTIONS rather than with
   * buildings, and FS-16's sweep put the triangle budget as the next real
   * ceiling at about 1,180 machines. Every inserter not drawn is budget back.
   * The number is in `probes/machineports.js`.
   *
   * The sim-side inserter is untouched: /core still creates one per `connect()`
   * and it still moves the items. This is a rendering decision about a machine
   * the player was never able to place, hold, or aim at.
   *
   * The slots are still acquired and HIDDEN rather than released, and the reason
   * has not changed: the count oscillates as a line is edited and re-acquiring
   * per edit would churn the batch.
   */
  private syncLinks(f: Factory): void {
    // Every link is a port link now, so this hides the lot. It is written as a
    // filter rather than as `hide everything` on purpose: a future connection
    // that is genuinely a reaching arm (a long inserter, a robot port) would
    // arrive as a link with no `fromPort`, and would draw without this function
    // being rediscovered.
    let n = 0;
    for (const l of f.links) {
      if (l.fromPort !== '' && !LEGACY_INSERTERS) continue;
      if (this.linkSlots.length <= n) {
        const s = this.batch.acquire('inserter');
        if (s < 0) break;
        this.linkSlots.push(s);
      }
      this.origin.toEngine(l.pos, this.p);
      this.m.compose(this.p, orient(l.up, l.fwd), this.one);
      this.batch.place(this.linkSlots[n], this.m);
      this.batch.setFx(this.linkSlots[n], { flow: 0, density: 0, state: 1, level: 0.5 });
      n++;
    }
    this.drawnInserters = n;
    for (let i = n; i < this.linkSlots.length; ++i) this.batch.hide(this.linkSlots[i]);
  }

  /**
   * Show the placement preview. `ok` is the only feedback a player gets before
   * committing, so a refusal has to be visible BEFORE the key is pressed rather
   * than as a message afterwards.
   */
  showGhost(kind: BuildKind, pos: { x: number; y: number; z: number },
            up: THREE.Vector3, fwd: THREE.Vector3, ok: boolean): void {
    if (this.ghost === null) return;
    // The GHOST is always the straight tile: the player places a belt and the
    // corner is derived afterwards, so previewing a curve would be previewing a
    // decision they are not making.
    const g = this.batch.geometryFor(kind);
    if (g === null) { this.ghost.visible = false; return; }
    this.ghost.geometry = g;
    this.origin.toEngine(pos, this.p);
    this.ghost.position.copy(this.p);
    this.ghost.quaternion.copy(orient(up, fwd));
    this.ghostMat.color.setHex(ok ? 0x63d0ff : 0xff5a44);
    this.ghost.visible = true;
    this.ghost.updateMatrixWorld(true);
  }

  hideGhost(): void { if (this.ghost !== null) this.ghost.visible = false; }
  get ghostVisible(): boolean { return this.ghost?.visible ?? false; }

  stats(): unknown {
    return { ...this.batch.stats(), ghost: this.ghostVisible,
      links: this.linkSlots.length, inserters: this.drawnInserters,
      cargo: this.cargo.stats(),
      curves: this.curves.length, curveTiles: this.curves,
      beltSockets: this.beltSockets, tiles: this.tileDraw(),
      wires: this.wires.report() };
  }

  /**
   * FS-40: every belt tile's DRAWN state, and only its drawn state.
   *
   * `mesh` is read out of the BatchedMesh's own per-instance geometry index and
   * `m` out of its matrix texture, so these are what the GPU is about to be
   * handed and not what this file believes it asked for. Built on demand from
   * `stats()` rather than per frame, because a base with a thousand tiles must
   * not allocate a thousand rows sixty times a second to feed a debug panel.
   */
  private tileDraw(): unknown[] {
    const f = this.lastPlan;
    if (f === null) return [];
    const out: unknown[] = [];
    for (const b of f.placed) {
      if (b.kind !== 'belt') continue;
      const slot = this.slots.get(b.id);
      out.push({ id: b.id, run: b.run, slot: slot ?? -1,
        mesh: slot === undefined ? null : this.batch.drawnKeyAt(slot),
        m: slot === undefined ? null : this.batch.matrixAt(slot) });
    }
    return out;
  }
}

/** The TypeIds this view knows how to draw, for a probe to assert against. */
export const DRAWN_TYPE_IDS = TYPE_ID;
