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
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

const TEMPLATES: Record<string, MachineTemplate> = {
  miner: { url: 'assets/machines/miner.glb', root: 'Miner' },
  // OF_Rubber is the deck, and the deck is what the flow band scrolls along.
  belt: { url: 'assets/machines/belt_segment.glb', root: 'BeltSegment',
          flowMaterial: 'Rubber' },
  smelter: { url: 'assets/machines/smelter.glb', root: 'Smelter' },
  inserter: { url: 'assets/machines/inserter.glb', root: 'Inserter' },
};

/** kUnitsPerTile from factory_sim.h, and the fixed tick rate. */
const UNITS_PER_TILE = 256;
const TICKS_PER_SEC = 60;
/** Bands per metre in the deck shader; the flow value is bands per second. */
const BANDS_PER_M = 2;

export class FactoryView {
  readonly group = new THREE.Group();
  readonly batch = new MachineBatch();
  private ghost: THREE.Mesh | null = null;
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private readonly slots = new Map<number, number>();
  private readonly linkSlots: number[] = [];
  private readonly p = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private t = 0;

  constructor(private readonly origin: FloatingOrigin) {
    this.group.name = 'factory';
    this.group.add(this.batch.group);
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
  sync(f: Factory, simSecs: number): void {
    this.t = simSecs;
    this.batch.setTime(simSecs);
    const rows = new Map<number, { visual: number; anim: number }>();
    for (const r of f.line.entityStates()) rows.set(r.id, r);
    const flows = new Map<number, { speedQuant: number; density: number }>();
    for (const r of f.line.beltFlows()) flows.set(r.lineId, r);

    for (const b of f.placed) {
      let slot = this.slots.get(b.id);
      if (slot === undefined) {
        slot = this.batch.acquire(keyOf(b.kind));
        if (slot < 0) continue;
        this.slots.set(b.id, slot);
      }
      this.origin.toEngine(b.pos, this.p);
      this.m.compose(this.p, b.quat, this.one);
      this.batch.place(slot, this.m);
      this.batch.setFx(slot, this.fxFor(b, f, rows, flows));
    }
    this.syncLinks(f);
    this.batch.flush();
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

  /** DW-9: one inserter wherever the plan recorded a connection. */
  private syncLinks(f: Factory): void {
    for (let i = 0; i < f.links.length; ++i) {
      if (this.linkSlots.length <= i) {
        const s = this.batch.acquire('inserter');
        if (s < 0) break;
        this.linkSlots.push(s);
      }
      const l = f.links[i];
      this.origin.toEngine(l.pos, this.p);
      this.m.compose(this.p, orient(l.up, l.fwd), this.one);
      this.batch.place(this.linkSlots[i], this.m);
      this.batch.setFx(this.linkSlots[i], { flow: 0, density: 0, state: 1, level: 0.5 });
    }
  }

  /**
   * Show the placement preview. `ok` is the only feedback a player gets before
   * committing, so a refusal has to be visible BEFORE the key is pressed rather
   * than as a message afterwards.
   */
  showGhost(kind: BuildKind, pos: { x: number; y: number; z: number },
            up: THREE.Vector3, fwd: THREE.Vector3, ok: boolean): void {
    if (this.ghost === null) return;
    const g = this.batch.geometryFor(keyOf(kind));
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
    return { ...this.batch.stats(), ghost: this.ghostVisible, links: this.linkSlots.length };
  }
}

function keyOf(kind: BuildKind): string { return kind; }

/** The TypeIds this view knows how to draw, for a probe to assert against. */
export const DRAWN_TYPE_IDS = TYPE_ID;
