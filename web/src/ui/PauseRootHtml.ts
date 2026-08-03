// GP-235. The game menu's ROOT PAGE, lifted verbatim out of PauseMenu.ts.
//
// This is GP-206's move again and for the same reason: `PauseMenu.ts` sat at
// 398 lines against a hard 400 cap, and GP-233's one extra group would have
// pushed a COMPLIANT file over it. Adding a line to a file that already breaks
// the cap is a debt note; taking a file over it for the first time is a new
// defect, so the group's home was made before the group was added.
//
// NOTHING HERE IS NEW. `header`, `stubs`, `testing`, `visitGroup`, `cheatRow`
// and `armed` are the shipped functions moved with their comments intact, the
// STUBS table came with them because `stubs()` is its only reader, and
// `stationGroup` is the one addition. The four option pages already live next
// door in OptionPagesHtml.ts, so the split the file now has is: this draws the
// root, that draws the pages, and PauseMenu owns the modal, the focus and the
// diff.
//
// The two type imports point back at PauseMenu and are `import type`, so they
// are erased and there is no runtime cycle. The types stay where every other
// consumer already imports them from.

import { esc } from './GameHud.js';
import type { CheatRow, PauseView } from './PauseMenu.js';

/** Everything the shell reserves and does not build. Data, so adding the fifth
 *  section later is a row here rather than a layout. */
const STUBS: readonly { name: string; waiting: string; page: string }[] = [
  // GP-137. The last stub to become real. Named slots, manual save, a load list
  // and delete, keyed by mode AND name so a sandbox world cannot be loaded into
  // a survival session.
  { name: 'Save Game', page: 'save',
    waiting: 'named saves for this mode, and the autosave. Loading restarts.' },
  // GP-131. THE FIRST STUB TO BECOME REAL, and it stays in this list rather
  // than being promoted out of it, because the shape the shell reserved is the
  // shape it turned out to want: a named section with a page behind it.
  { name: 'Options / Controls', page: 'controls',
    waiting: 'every control the game listens to, read live from the one binding '
      + 'table. Rebinding is not built yet.' },
  // GP-132. READ ONLY. Every knob already exists as a URL flag and is read once
  // at boot by files another lane owns; showing what this session is running at
  // is worth having on its own and needs no renderer contact whatsoever.
  { name: 'Options / Video', page: 'video',
    waiting: 'what this session is running at, read live from the parsed '
      + 'config. Changing them from here is not built yet.' },
  // GP-134. The only options page that WRITES, because `AudioBus` already has
  // live persisted setters and nothing else is editing web/src/audio/ this
  // round. It also diagnoses a silent game, which nothing anywhere could do.
  { name: 'Options / Audio', page: 'audio',
    waiting: 'master volume, mute, and why the game might be silent.' },
  { name: 'Multiplayer', page: '',
    waiting: 'not yet: host, join and the server list. The sim is already '
      + 'deterministic and command-driven, which is the hard half.' },
];

/** The whole root page, in the order it is read down the screen. */
export function rootPage(v: PauseView): string {
  return header(v) + stubs() + testing(v) + visitGroup(v) + stationGroup(v)
    + worldGroup(v);
}

function header(v: PauseView): string {
  return '<div class="of-pgrp world"><h4>World</h4>'
    + `<div class="row"><span class="nm">Mode</span>`
    + `<span class="val" data-mode="${esc(v.mode)}">${esc(v.mode)}</span></div>`
    + `<div class="row"><span class="nm">Save slot</span>`
    + `<span class="val" data-slot="${esc(v.slotKey)}">${esc(v.slotKey)}</span></div>`
    + (v.assisted === '' ? ''
      : `<div class="row assist"><span class="nm">Assisted</span>`
        + `<span class="val">${esc(v.assisted)}</span></div>`)
    + '</div>';
}

function stubs(): string {
  return '<div class="of-pgrp stubs"><h4>Options</h4>'
    + STUBS.map((s) => `<div class="row stub${s.page === '' ? '' : ' live'}" `
      + `data-stub="${esc(s.name)}">`
      + `<span class="nm">${esc(s.name)}</span>`
      + `<span class="why">${esc(s.waiting)}</span>`
      + (s.page === '' ? ''
        : `<button type="button" data-cheat="page:${esc(s.page)}">Open</button>`)
      + '</div>').join('')
    + '</div>';
}

/**
 * The testing block. The destructive row is rendered in one of two states and
 * never in both: ARMED shows the sentence and two buttons, and that is the only
 * state from which the confirm button exists in the DOM at all. A confirm the
 * player can reach without first reading the sentence is not a confirm.
 */
function testing(v: PauseView): string {
  return '<div class="of-pgrp cheats"><h4>Testing</h4>'
    + v.cheats.map((c) => (c.destructive === true && v.confirm !== '')
      ? armed(c, v.confirm) : cheatRow(c, 'Do it')).join('') + '</div>';
}

/** GP-167. Same rows, same delegation, one renderer: only the verb differs. */
function visitGroup(v: PauseView): string {
  return '<div class="of-pgrp cheats visits"><h4>Visit site</h4>'
    + v.visits.map((c) => cheatRow(c, 'Go')).join('') + '</div>';
}

/**
 * GP-233. The station, under its own heading and through the SAME row renderer
 * with the SAME verb, because it is the same action: only the heading and the
 * kind of destination differ. Why it is not an eighth Visit-site row is argued
 * where the rows are built, in app/VisitSites.ts.
 */
function stationGroup(v: PauseView): string {
  return '<div class="of-pgrp cheats visits orbit"><h4>In orbit</h4>'
    + v.station.map((c) => cheatRow(c, 'Go')).join('') + '</div>';
}

/**
 * GP-500. The other bodies, under their own heading, through the SAME row
 * renderer and the same verb. Why it is not a ninth Visit-site row is argued
 * where the rows are built, in app/VisitWorlds.ts; the short version is that
 * the seven are a spawn-pick comparison on ONE planet and this group changes
 * which planet that is.
 *
 * It is drawn LAST on purpose. It is the only control in the whole menu that
 * takes the running page away, so it sits below everything a player might want
 * to press on the way past.
 */
function worldGroup(v: PauseView): string {
  return '<div class="of-pgrp cheats visits world-jump"><h4>Another world</h4>'
    + v.worlds.map((c) => cheatRow(c, 'Go')).join('') + '</div>';
}

function cheatRow(c: CheatRow, verb: string): string {
  const blocked = c.blocked !== undefined && c.blocked !== '';
  const state = c.kind === 'toggle'
    ? `<span class="state ${c.on === true ? 'on' : 'off'}">`
      + `${c.on === true ? 'ON' : 'OFF'}</span>`
    : '';
  return `<div class="row cheat${blocked ? ' blocked' : ''}`
    + `${c.destructive === true ? ' danger' : ''}" data-cheat-row="${esc(c.id)}">`
    + `<span class="nm">${esc(c.label)}${state}</span>`
    + `<span class="why">${esc(blocked ? (c.blocked ?? '') : c.note)}</span>`
    + `<button type="button" data-cheat="${esc(c.id)}"${blocked ? ' disabled' : ''}>`
    + `${c.kind === 'toggle' ? (c.on === true ? 'Turn off' : 'Turn on') : verb}`
    + '</button></div>';
}

function armed(c: CheatRow, sentence: string): string {
  return `<div class="row cheat danger armed" data-cheat-row="${esc(c.id)}">`
    + `<span class="nm">${esc(c.label)}</span>`
    + `<span class="why warn">${esc(sentence)}</span>`
    + `<span class="pair">`
    + `<button type="button" class="go" data-cheat="${esc(c.id)}:confirm">`
    + 'Yes, destroy it</button>'
    + `<button type="button" data-cheat="${esc(c.id)}:cancel">Cancel</button>`
    + '</span></div>';
}
