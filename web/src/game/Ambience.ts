// HOW WINDY IS IT HERE? The world's answer, in three numbers.
//
// Beds.ts knows how to make wind, an underground rumble and a Forest chorus.
// This file decides how much of each there should be where the player is
// standing, and it is deliberately the only place that decision lives, so the
// audio layer holds no opinion about terrain and the terrain layer holds none
// about sound.
//
// THE INPUTS ARE THE ONES THE SIMULATION ALREADY HAS. Altitude comes from the
// body radius and the eye's own distance from the centre; exposure is the
// walker's `underRock`, which the voxel collision pass already computes every
// tick and which is exactly "is there rock over my head"; the biome is
// `of_biome_at`, the one biome authority (standing rule 1). Nothing here
// re-derives a height, a surface or a biome.
//
// AND IT IS SMOOTHED. A player who steps under a lip must not hear the wind
// switch off: the levels are eased towards their target so a threshold crossing
// is a fade of about a second, which is also what stops a walker jittering
// across a boundary from strobing the mix.

import type { OfCoreModule } from '../sim/wasm/heap.js';
import type { Ambient } from '../audio/Sfx.js';

/**
 * Metres of relief over which the wind climbs to full. Forge's clearing sits
 * near 3 km of relief and its ridges run to about 8, so this is the band the
 * player will actually traverse rather than the planet's full range.
 */
const WIND_FULL_M = 6000;
/** Relief below which the wind is at its quietest, not off: a plain is not still. */
const WIND_FLOOR = 0.28;
/** Seconds for a level to travel most of the way to its target. */
const EASE_SECS = 0.9;

/** worldgen Biome, from `of_biome_at`. Only the two that change the bed. */
const BIOME_FOREST = 4;
const BIOME_PLAINS = 3;

export interface AmbienceState {
  wind: number;
  windBright: number;
  cave: number;
  life: number;
  /** What it was derived from, so a probe asserts the CAUSE and not the level. */
  altM: number;
  biome: number;
  underRock: boolean;
}

export class Ambience {
  readonly state: AmbienceState = {
    wind: 0, windBright: 0, cave: 0, life: 0, altM: 0, biome: -1, underRock: false,
  };
  /** Biome is sampled every few frames, not every frame: it costs an oracle call
   * and it cannot change fast enough at walking pace to be worth 60 Hz. */
  private sinceBiome = 1e9;
  private biome = -1;

  constructor(private readonly M: OfCoreModule, private readonly body: number) {}

  /**
   * Fold the world's ambience into whatever the machine beds already say.
   * `eye` is body-frame metres; `underRock` is the walker's own answer.
   */
  step(dt: number, eye: { x: number; y: number; z: number },
       underRock: boolean, base: Ambient): Ambient {
    const r = Math.hypot(eye.x, eye.y, eye.z) || 1;
    const altM = r - this.M._of_body_radius(this.body);
    this.sinceBiome += dt;
    if (this.sinceBiome > 0.5) {
      this.sinceBiome = 0;
      this.biome = this.M._of_biome_at(this.body, eye.x / r, eye.y / r, eye.z / r);
    }

    // Rock overhead is what silences wind, and it is the same fact that starts
    // the cave: the two are one measurement read in opposite directions.
    const open = underRock ? 0 : 1;
    const climb = Math.max(0, Math.min(1, altM / WIND_FULL_M));
    const windTarget = open * (WIND_FLOOR + (1 - WIND_FLOOR) * climb);
    const caveTarget = underRock ? 1 : 0;
    // Insects belong to the trees. Plains gets a trace, because a treeline in
    // earshot is more honest than a hard edge at the biome boundary.
    const lifeTarget = open * (this.biome === BIOME_FOREST ? 1
      : this.biome === BIOME_PLAINS ? 0.3 : 0);

    const k = 1 - Math.exp(-dt / EASE_SECS);
    const s = this.state;
    s.wind += (windTarget - s.wind) * k;
    s.windBright += (climb * open - s.windBright) * k;
    s.cave += (caveTarget - s.cave) * k;
    s.life += (lifeTarget - s.life) * k;
    s.altM = altM;
    s.biome = this.biome;
    s.underRock = underRock;

    return { ...base, wind: s.wind, windBright: s.windBright, cave: s.cave, life: s.life };
  }

  report(): unknown {
    const s = this.state;
    return {
      wind: +s.wind.toFixed(3), windBright: +s.windBright.toFixed(3),
      cave: +s.cave.toFixed(3), life: +s.life.toFixed(3),
      altM: Math.round(s.altM), biome: s.biome, underRock: s.underRock,
    };
  }
}
