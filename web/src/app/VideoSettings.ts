// GP-132. OPTIONS / VIDEO: THE SHAPE, PUBLISHED, AND DELIBERATELY NOT WIRED.
//
// Reid wants texture quality, render distance and similar so he can benchmark
// the same world across machines. Every one of those knobs ALREADY EXISTS: they
// are URL flags parsed in `app/Config.ts` and read by the renderer at boot. So
// the work is not "add settings", it is "give the settings that exist a screen
// and a way to change them", and those are two different jobs with two
// different owners.
//
// THIS FILE DOES THE FIRST ONE ONLY, and that is a decision rather than an
// unfinished state. `web/src/render/**`, `Scatter*.ts`, `Config.ts` and
// `Boot.ts` are another lane's this round, and every one of these knobs is read
// ONCE at boot by code in those files. Wiring a slider to any of them means
// either a live re-application path inside the renderer (theirs) or a reload
// (cheap, and the same shape `switchMode` already uses), and picking between
// those is a cross-domain call. So the screen READS and does not WRITE: it
// shows what this session is actually running at, which is precisely what a
// benchmark needs and is worth having on its own.
//
// WHAT IT READS: `Services.cfg`, the parsed `Config` object, and nothing else.
// It touches no renderer, no material and no scatter. It cannot change a frame.
//
// THE ROW THAT MATTERS MOST is `applyBy`, which says HOW each knob would come to
// be changeable. It is the handover note to whoever wires this: three of these
// are boot-only by construction (the terrain pool is preallocated, the depth
// mode picks a shader path), and the rest are live-settable in principle. A
// screen that offered a slider for a preallocated pool would be lying.

import type { Config } from './Config.js';

export interface VideoRow {
  /** The URL flag, which is the name this knob already has. */
  flag: string;
  label: string;
  /** What this session is actually running at, as a string. */
  value: string;
  /** What else it accepts, for the control that gets built later. */
  options: string;
  /**
   * How it would be changed: 'reload' when the value is read once at boot and
   * baked into an allocation or a shader, 'live' when the renderer could take a
   * new value mid-session. Honest per row rather than a blanket answer.
   */
  applyBy: 'reload' | 'live';
  group: string;
}

/**
 * Every video knob this build actually has, read off the live parsed config.
 *
 * It is DERIVED rather than typed out with defaults, so a screen showing
 * `quality: high` is showing what the renderer was handed and not what the
 * default happens to be. That distinction is the whole point of a benchmark
 * screen: the number you compare across two machines has to be the number each
 * of them ran.
 */
export function videoRows(cfg: Config): VideoRow[] {
  const on = (b: boolean): string => (b ? 'on' : 'off');
  return [
    { flag: 'quality', label: 'Quality tier', value: cfg.quality,
      options: 'low / med / high', applyBy: 'reload', group: 'Overall' },
    // BOOT-ONLY AND SAID SO: the chunk pool is preallocated at boot
    // (`pooledBytes` on the boot report), so a slider that resized it would be
    // asking for a reallocation the streamer has no path for.
    { flag: 'pool', label: 'Terrain chunk pool', value: String(cfg.chunkPoolSize),
      options: '64 and up, preallocated at boot', applyBy: 'reload',
      group: 'Terrain' },
    { flag: 'maxdepth', label: 'Render distance (quadtree depth)',
      value: String(cfg.maxDepth), options: '4 to 16, higher is further',
      applyBy: 'reload', group: 'Terrain' },
    { flag: 'depth', label: 'Depth buffer',
      value: cfg.forceLogDepth ? 'logarithmic'
        : cfg.forcePlainDepth ? 'plain' : 'automatic (reversed-Z where available)',
      options: 'auto / log / plain', applyBy: 'reload', group: 'Terrain' },
    { flag: 'density', label: 'Ground scatter density',
      value: `${cfg.density}x`, options: '0 and up, 1 is the authored count',
      applyBy: 'live', group: 'Scenery' },
    { flag: 'detail', label: 'Ground detail cards', value: on(cfg.detailCards),
      options: 'on / off', applyBy: 'live', group: 'Scenery' },
    { flag: 'propcull', label: 'Per-instance culling', value: on(cfg.propCull),
      options: 'on / off', applyBy: 'live', group: 'Scenery' },
    { flag: 'shadows', label: 'Cascaded shadows', value: on(cfg.shadows),
      options: 'on / off', applyBy: 'live', group: 'Lighting' },
    { flag: 'atmos', label: 'Atmospheric scattering', value: on(cfg.atmosphere),
      options: 'on / off', applyBy: 'live', group: 'Lighting' },
    // The post stack keeps its flags one level down, in `post.flags`, which is
    // read through rather than copied: `PostConfig.parsePost` is the authority
    // on what the stack is running and this screen is only allowed to report it.
    { flag: 'post', label: 'Post-processing stack', value: on(cfg.post.flags.post),
      options: 'on / off (master switch)', applyBy: 'reload', group: 'Post' },
    { flag: 'ao', label: 'Ambient occlusion', value: on(cfg.post.flags.ao),
      options: 'on / off', applyBy: 'live', group: 'Post' },
    { flag: 'contact', label: 'Contact shadows', value: on(cfg.post.flags.contact),
      options: 'on / off', applyBy: 'live', group: 'Post' },
    { flag: 'bloom', label: 'Bloom', value: on(cfg.post.flags.bloom),
      options: 'on / off', applyBy: 'live', group: 'Post' },
    { flag: 'grade', label: 'Colour grade', value: on(cfg.post.flags.grade),
      options: 'on / off', applyBy: 'live', group: 'Post' },
    { flag: 'aa', label: 'Anti-aliasing', value: on(cfg.post.flags.aa),
      options: 'on / off', applyBy: 'live', group: 'Post' },
  ];
}

/**
 * The URL this session would have with one flag changed, for the control that
 * gets built later.
 *
 * It exists NOW, unused by any button, for the same reason `urlForMode` did
 * before the sandbox menu row existed: it is the half of the job that belongs
 * to this lane, it is testable on its own, and publishing it means the wiring
 * pass is a button rather than a design. `switchMode` is the pattern in full.
 */
export function urlForVideo(href: string, flag: string, value: string): string {
  const u = new URL(href);
  if (value === '') u.searchParams.delete(flag);
  else u.searchParams.set(flag, value);
  return u.toString();
}
