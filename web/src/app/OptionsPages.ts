// GP-134. THE THREE OPTIONS PAGES, ASSEMBLED IN ONE PLACE.
//
// Controls, Video and Audio are three renderers over state that already exists,
// and none of them is a cheat. They lived on `Cheats.view` for exactly as long
// as there was one of them; the third pushed that file past its 400-line cap,
// which is the usual signal that a responsibility had been sharing a house with
// a different one. `Cheats` owns the TESTING controls and their consequences
// (GP-102's assisted mark, the armed confirm); this owns the pages that only
// read and write settings a player is entitled to change.
//
// EACH PAGE IS DERIVED ON EVERY CALL and none of them caches: the controls come
// from the one binding table, the video values from the live parsed config, and
// the audio state from the bus itself. The panel diffs its own render key, so
// this reaches the DOM only when something moved.

import { controlGroups } from '../player/BindingText.js';
import { videoRows } from './VideoSettings.js';
import { audioView, pressAudio } from './AudioSettings.js';
import type { AudioBus } from '../audio/AudioBus.js';
import type { Config } from './Config.js';
import type { AudioView } from './AudioSettings.js';
import type { ControlGroup } from '../player/BindingText.js';
import type { VideoRow } from './VideoSettings.js';
import type { SaveListView, SaveSlots } from '../game/SaveSlots.js';
import type { Gameplay } from '../game/Gameplay.js';
import type { GameMode } from '../game/GameMode.js';

export interface OptionPages {
  controls: ControlGroup[];
  video: VideoRow[];
  audio: AudioView;
  saves: SaveListView;
}

/**
 * A bus that does not exist, so the audio page can still describe itself in a
 * world with no gameplay layer (a headless scenario, a boot that failed).
 *
 * It is a REAL `AudioBus` rather than a hand-written null view, because the
 * alternative is a second implementation of `audioView`'s shape that would
 * drift: a fresh bus reports `supported`, `unlocked: false` and the stored
 * volume, which is exactly the truth about a world with no sound in it.
 */
let silent: AudioBus | null = null;

export function optionPages(cfg: Config, bus: AudioBus | null,
                            fallback: () => AudioBus, slots: SaveSlots,
                            mode: GameMode, page: string): OptionPages {
  if (bus === null && silent === null) silent = fallback();
  return {
    controls: controlGroups(),
    video: videoRows(cfg),
    audio: audioView(bus ?? (silent as AudioBus)),
    saves: slots.view(mode, page === 'save'),
  };
}

/**
 * The pages' own verbs. '' for an id these pages do not own.
 *
 * The SAVE verbs are fired and not awaited, which is the shape IndexedDB forces
 * and is honest about it: each one sets `busy` on the way in and a `note` on the
 * way out, and the list is rebuilt from the STORE afterwards rather than patched
 * in memory, so what the player sees is what is actually there. `save:new` reads
 * the name the panel is holding, because the panel owns its own input and this
 * owns the rule about what a name may be.
 */
export function pressOption(bus: AudioBus | null, slots: SaveSlots,
                            g: Gameplay | null, id: string): string {
  if (id.startsWith('audio:')) return bus === null ? '' : pressAudio(bus, id);
  if (!id.startsWith('save:') || g === null) return '';
  if (id === 'save:delcancel') { slots.cancelDelete(); return 'cancelled'; }
  if (id.startsWith('save:arm:')) {
    const n = id.slice(9);
    slots.armDelete(n);
    return `delete "${n}"?`;
  }
  if (id.startsWith('save:del:')) { void slots.remove(g, id.slice(9)); return 'deleting'; }
  if (id.startsWith('save:load:')) { void slots.load(g, id.slice(10)); return 'loading'; }
  if (id.startsWith('save:new:')) { void slots.save(g, id.slice(9)); return 'saving'; }
  return '';
}
