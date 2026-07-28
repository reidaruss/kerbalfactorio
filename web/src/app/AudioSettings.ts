// GP-134. OPTIONS / AUDIO, and it is the first options page that actually DOES
// something.
//
// The difference from Video (GP-132) is worth stating, because the two look
// alike and are not. A video knob is read ONCE at boot by files another lane
// owns, so that page can only report. `AudioBus` already has `setVolume`,
// `setMuted` and a `localStorage` key, all live, all persisted, and nothing else
// is editing `web/src/audio/` this round. So there is no reason for this page to
// be read only and it is not: the slider moves the master gain in the same frame
// and the setting survives a reload.
//
// THE DIAGNOSTIC IS THE PART THAT EARNS ITS KEEP. `AudioBus`'s own header says
// every browser blocks audio until a gesture, and that "the game would be mute
// for exactly the players who never noticed why". That is still true and this is
// the first surface anywhere that can answer it. A player whose game is silent
// has four candidate reasons (no Web Audio at all, the context never unlocked,
// muted, volume at zero) and until now no way to tell them apart. `silentBecause`
// names exactly one of them, and it names the MUTE KEY from the binding table
// rather than spelling it, which is GP-131's whole lesson applied one screen
// over.
//
// WHAT IS RESERVED AND NOT BUILT: per-bus levels. `Sfx`, `Beds` and `Ambience`
// all connect straight to the one master gain, so there is no second gain to
// move and a "music" slider would be a control wired to nothing. The rows are
// listed with what each one currently shares, so the shape is visible and the
// work needed is legible, which is the same trade the Video page makes.

import { labelOf } from '../player/Bindings.js';
import type { AudioBus } from '../audio/AudioBus.js';

export interface AudioBusRow {
  name: string;
  /** What it plays, and what it shares its gain with today. */
  note: string;
  /** False until it has a gain of its own. Reserved, and said out loud. */
  separate: boolean;
}

export interface AudioView {
  supported: boolean;
  /** The AudioContext's own state: 'running', 'suspended' or 'none'. */
  state: string;
  unlocked: boolean;
  muted: boolean;
  /** 0 to 1. */
  volume: number;
  /** How the mute key reads, from the binding table and never spelled here. */
  muteKey: string;
  /**
   * Why nothing can be heard right now, or '' when it can. Exactly one reason,
   * in the order they actually gate: no support, then not unlocked, then muted,
   * then a volume of zero. Ordered because they are not independent, and a
   * screen that listed all four would leave the player to guess which is theirs.
   */
  silentBecause: string;
  /** Counters, so the page can show that sound is being ASKED for even when
   *  none of it is audible. That distinction is the whole diagnosis. */
  plays: number;
  loops: number;
  cpuMs: number;
  buses: AudioBusRow[];
}

const BUSES: readonly AudioBusRow[] = [
  { name: 'Effects', note: 'swings, impacts, placement, the gun. Shares the '
    + 'master gain.', separate: false },
  { name: 'Machines', note: 'the running hum of furnaces and the factory. A '
    + 'persistent loop on the master gain.', separate: false },
  { name: 'Ambience', note: 'wind, the fire bed, the sound of a biome. A '
    + 'persistent loop on the master gain.', separate: false },
  { name: 'Music', note: 'nothing plays music yet, so this row is a placeholder '
    + 'for a bus that does not exist.', separate: false },
];

export function audioView(bus: AudioBus): AudioView {
  const s = bus.stats();
  return {
    supported: s.supported,
    state: s.state,
    unlocked: s.unlocked,
    muted: s.muted,
    volume: s.volume,
    muteKey: labelOf('mute'),
    silentBecause: silence(s.supported, s.unlocked, s.muted, s.volume),
    plays: s.totalPlays,
    loops: s.loops,
    cpuMs: s.cpuMs,
    buses: [...BUSES],
  };
}

function silence(supported: boolean, unlocked: boolean, muted: boolean,
                 volume: number): string {
  if (!supported) return 'this browser has no Web Audio at all';
  if (!unlocked) {
    return 'the browser has not let the game make a sound yet. It waits for a '
      + 'click or a key press, which is a rule this game cannot override';
  }
  if (muted) return `muted. Press ${labelOf('mute')} or the button below`;
  if (volume <= 0) return 'the volume is at zero';
  return '';
}

/**
 * The audio verbs the menu can press. Returns what happened, or '' for an id
 * this page does not own.
 *
 * `unlock` is here and is not a cheat: the context can only be resumed from a
 * user gesture, and a click on this button IS one. It is the one control that
 * can fix the most common cause of a silent game, which is why the page offers
 * it rather than only diagnosing it.
 */
export function pressAudio(bus: AudioBus, id: string): string {
  if (id === 'audio:mute') {
    return bus.toggleMute() ? 'sound off' : 'sound on';
  }
  if (id === 'audio:unlock') {
    void bus.unlock();
    return 'asked the browser to start the audio context';
  }
  if (id.startsWith('audio:vol:')) {
    const v = Number(id.slice(10));
    if (!Number.isFinite(v)) return '';
    return `volume ${Math.round(bus.setVolume(v / 100) * 100)}%`;
  }
  return '';
}
