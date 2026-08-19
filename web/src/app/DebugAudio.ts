// SOUND: the bus, the voices and the beds (GP-1075, split out of
// DebugGameplay.ts under the 400-line cap).
//
// `audio` drives the live bus (volume, mute, unlock, play) and the two render
// entries are DW-20's offline proof, which is a different question from the
// first: a play counter reports a bed that runs for ever producing silence as
// working, so the rendered buffer is the only thing that can say otherwise.
// They stay two calls and not one for the reason written below.
import { renderVoices } from '../audio/Sfx.js';
import { renderBeds } from '../audio/Beds.js';
import type { Services } from './Services.js';

export function audioApi(s: Services) {
  return {
    audio(op?: string | number) {
      const sfx = s.gameplay?.sfx;
      if (sfx === undefined) return null;
      if (typeof op === 'number') sfx.bus.setVolume(op);
      else if (op === 'mute') sfx.bus.setMuted(true);
      else if (op === 'unmute') sfx.bus.setMuted(false);
      else if (op === 'unlock') void sfx.bus.unlock();
      else if (op !== undefined) sfx.play(op);
      return sfx.stats();
    },

    // DW-20 for sound, in two calls and not one. The published shape of
    // audioRender is a CONTRACT that probes already read; the beds get their
    // own entry rather than being wrapped around it. Both exist for the same
    // reason: a bed that runs for ever producing silence is exactly the failure
    // a play counter reports as working.
    audioRender: () => renderVoices(),
    bedsRender: () => renderBeds(),
  };
}
