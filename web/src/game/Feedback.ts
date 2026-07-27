// EVERYTHING A GAMEPLAY EVENT DOES THAT IS NOT THE RULE: chips, camera kick,
// captions and sound. The rules stay in /core; this file is the reaction.
//
// It exists because Gameplay is a composition and was at the 400-line cap, and
// because the reactions genuinely belong together: a swing landing is one event
// with four outputs (debris, kick, caption, sound) that must all fire on the
// SAME tick, and splitting them across four call sites is how they drift apart.
//
// THE TWO MISSING MOMENTS the W6 review named are `felled` and `ingot`.
// Clearing a node used to end on a smaller number and a silhouette swap, and a
// finished ingot only ever existed inside a panel. Both now happen in the world:
// a node collapses with a heavy burst and a low crash, and an ingot announces
// itself with a pop of pale chips and a chime at the machine that made it.

import * as THREE from 'three';
import { CameraKick, Debris } from './HarvestFx.js';
import { readable } from './GameplayViews.js';
import type { Ambient, Sfx } from '../audio/Sfx.js';
import type { GameHud } from '../ui/GameHud.js';
import type { NodeField } from './NodeField.js';
import type { Factory } from './Factory.js';
import type { GameCore } from './GameCore.js';
import type { Machines } from './Machines.js';
import type { FloatingOrigin } from '../world/FloatingOrigin.js';

export interface Grant {
  granted: number; name: string; usedTool: boolean; index: number;
  nodeEmpty: boolean;
}

/** The pale metal an ingot burst is made of, and how high it pops. */
const INGOT_COLOUR = 0xd8dde2;
const INGOT_UP_M = 1.15;

export class Feedback {
  readonly debris = new Debris();
  readonly kick = new CameraKick();
  felledCount = 0;
  ingots = 0;
  /** Per-smelter output buffer last tick, so a completed smelt is a DELTA. */
  private readonly lastOut = new Map<number, number>();

  constructor(private readonly hud: GameHud, private readonly field: NodeField,
              private readonly sfx: Sfx) {}

  /**
   * A landed swing. The node reacts, chips fly in the resource's own colour, the
   * camera kicks and the gain is read out beside the crosshair, all hanging off
   * the authored impact frame (17 of 33) because that is when the tool connects.
   */
  impact(g: Grant, eye: { x: number; y: number; z: number }, swings: number): void {
    const hit = this.field.hitPoint(g.index);
    if (hit !== null) {
      const back = this.awayFromNode(hit, eye);
      const n = Math.min(22, 8 + Math.round(Math.min(30, g.granted) * 0.45));
      this.debris.burst({ pos: hit.pos, up: hit.up, back, colour: hit.colour, count: n });
      this.hud.gain(`+${g.granted} ${g.name}`, readable(hit.colour));
    } else {
      this.hud.gain(`+${g.granted} ${g.name}`, '#e8eef3');
    }
    // Wood takes a dull thunk, stone and ore a sharper crack. Two sounds, chosen
    // by what was actually struck, is the whole difference between "a noise
    // plays" and "that felt like hitting a tree".
    this.sfx.hit(this.field.kindOf(g.index) === 0 ? 'thunk' : 'crack', swings);
    this.kick.fire(swings);
    if (g.nodeEmpty) this.felled(g, eye);
  }

  /**
   * THE FELLED MOMENT. The last swing on a node used to be indistinguishable
   * from every swing before it: the number reached zero, the silhouette swapped
   * to `_Low`, and that was the whole event. Now the node visibly collapses, a
   * heavy burst of its own material is thrown, the crosshair carries a banner
   * that names what was cleared, and a low crash lands under all of it.
   */
  private felled(g: Grant, eye: { x: number; y: number; z: number }): void {
    this.felledCount++;
    const hit = this.field.hitPoint(g.index);
    const kind = this.field.kindOf(g.index);
    // NAME THE THING, not the item it drops. "Wood cleared" is a caption about
    // an inventory row; "tree felled" is a caption about what just happened in
    // front of you, and only one of those is a moment.
    const what = kind === 0 ? 'tree felled'
      : kind === 1 ? 'boulder cleared' : `${g.name} deposit cleared`;
    if (hit !== null) {
      const back = this.awayFromNode(hit, eye);
      // The chips come back at the player and the TRUNK goes the other way.
      this.field.fell(g.index, { x: -back.x, y: -back.y, z: -back.z });
      this.debris.burst({
        pos: hit.pos, up: hit.up, back, colour: hit.colour, count: 44,
      });
      this.hud.banner(what, readable(hit.colour));
    } else {
      this.field.fell(g.index);
      this.hud.banner(what, '#e8eef3');
    }
    this.sfx.collapse();
  }

  /**
   * A SMELT FINISHED, marked AT THE MACHINE and nowhere else (GP-60). `n`
   * ingots pop out as pale chips with a chime, so a player near their line
   * learns it produced something without opening anything.
   *
   * THERE IS DELIBERATELY NO HUD BANNER HERE ANY MORE. The banner is a global
   * flash that follows the player anywhere on the planet, and "+1 Iron ready"
   * chasing someone kilometres from their base is Reid's complaint verbatim.
   * Routine production speaks through the machine itself: these chips, the
   * chime, and the panel's own slots and progress bar (GP-57). The banner path
   * keeps its two legitimate, player-caused moments: `felled` below and the
   * objectives' completion flash. `name` stays in the signature because the
   * caller identifies the ingot for the report and for the day a world-space
   * label wants it.
   */
  ingot(n: number, pos: { x: number; y: number; z: number },
        up: { x: number; y: number; z: number }, _name: string): void {
    if (n <= 0) return;
    this.ingots += n;
    const p = {
      x: pos.x + up.x * INGOT_UP_M,
      y: pos.y + up.y * INGOT_UP_M,
      z: pos.z + up.z * INGOT_UP_M,
    };
    // `back` is straight up here: an ingot is not knocked off the machine, it
    // rises out of it, so the cone has no lateral bias.
    this.debris.burst({
      pos: p, up, back: up, colour: INGOT_COLOUR, count: Math.min(18, 8 + n * 2),
    });
    this.sfx.chime(n);
  }

  /**
   * Notice completed smelts across the whole factory. Watching the output
   * buffer for a RISE is the honest signal: /core's `smelting` flag is only true
   * on a tick that progressed and is cleared by the very tick that finishes the
   * job, so the completion is exactly the edge where the buffer grows.
   */
  watchSmelters(f: Factory, game: GameCore): void {
    for (const b of f.placed) {
      if (b.kind !== 'smelter' || b.build < 0) continue;
      const now = f.line.outputBuffer(b.build);
      const was = this.lastOut.get(b.id) ?? now;
      this.lastOut.set(b.id, now);
      if (now > was) this.ingot(now - was, b.pos, b.up, game.itemName(f.outputItemOf(b)));
    }
  }

  /** After a demolition the ids and buffers have moved; start watching afresh. */
  forgetSmelters(): void { this.lastOut.clear(); }

  /**
   * Set the two continuous beds from the nearest running machine and the
   * nearest fire. DISTANCES, not levels: the mixer owns the falloff curve, so
   * hum and crackle cannot drift apart, and it stays O(buildings) per frame with
   * no per-machine voice anywhere (the DW-8 argument, applied to sound).
   */
  beds(f: Factory, machines: Machines, eye: { x: number; y: number; z: number },
       world: (base: Ambient) => Ambient = (b) => b): void {
    const d = (p: { x: number; y: number; z: number }): number =>
      Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
    let machineM = Infinity;
    let fireM = Infinity;
    for (const b of f.placed) {
      if (b.kind === 'belt' || b.build < 0) continue;
      if (f.line.working(b.build)) machineM = Math.min(machineM, d(b.pos));
    }
    for (const m of machines.list) if (m.burning) fireM = Math.min(fireM, d(m.pos));
    // The machines are what THIS module can see; the wind, the underground and
    // the Forest are the world's, and they are folded in by whoever knows where
    // the player is standing (Ambience.ts).
    this.sfx.ambience(world({ machineM, fireM }));
  }

  /** Flatten "towards the eye" into the ground plane, so chips come at you. */
  private awayFromNode(hit: { pos: { x: number; y: number; z: number };
                              up: { x: number; y: number; z: number } },
                       eye: { x: number; y: number; z: number }): THREE.Vector3 {
    const b = new THREE.Vector3(eye.x - hit.pos.x, eye.y - hit.pos.y, eye.z - hit.pos.z);
    const u = new THREE.Vector3(hit.up.x, hit.up.y, hit.up.z);
    b.addScaledVector(u, -b.dot(u));
    if (b.lengthSq() < 1e-9) b.set(u.y, -u.x, 0);
    return b.normalize();
  }

  update(dt: number, origin: FloatingOrigin): void { this.debris.update(dt, origin); }

  report(): unknown {
    return {
      debrisLive: this.debris.live, debrisSpawned: this.debris.spawned,
      kicking: this.kick.active, kickTicks: this.kick.applied,
      felled: this.felledCount, ingotsAnnounced: this.ingots,
    };
  }
}
