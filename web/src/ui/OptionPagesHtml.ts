// GP-138. THE OPTION PAGES' HTML, split out of PauseMenu.ts when Save Game made
// it four.
//
// `PauseMenu.ts` owns the SHELL: the frame, the modal registration, the pointer
// transition's DOM half, the root page and its testing block. This owns the four
// sub-pages, which have nothing in common with the shell and everything in
// common with each other: each takes plain data, returns a string, and holds no
// state and no opinion about what any of it means. That is the same seam
// `app/OptionsPages.ts` draws one layer up, where the DATA for these pages is
// derived, and it is drawn in the same place on purpose.
//
// DW-2 holds here as everywhere under src/ui: plain DOM, zero three.js, plain
// rows in and one callback out, and no knowledge of ItemIds, recipes, research,
// the binding table or IndexedDB beyond the shape of what it is handed.

import { esc } from './GameHud.js';
import type { ControlGroup } from '../player/BindingText.js';
import type { VideoRow } from '../app/VideoSettings.js';
import type { AudioView } from '../app/AudioSettings.js';
import type { SaveListView } from '../game/SaveSlots.js';

/**
 * GP-131. THE CONTROLS SCREEN: every action the game listens to, with the key
 * it is actually on.
 *
 * Nothing here is written down. The rows are DERIVED from `BINDINGS` by
 * `controlGroups()` on every render, so this screen cannot state a key the game
 * does not listen to, which is the whole reason it was worth building before
 * rebinding. A shared code is called out rather than drawn twice and hoped over.
 */
export function controls(groups: ControlGroup[]): string {
  const n = groups.reduce((a, g) => a + g.rows.length, 0);
  return '<div class="of-pgrp ctl"><h4>Controls'
    + `<button type="button" class="back" data-cheat="page:">Back</button></h4>`
    + `<div class="row note"><span class="why">All ${n} controls, read from the `
    + 'one binding table the game itself asks. Rebinding is not built yet; when '
    + 'it is, it will edit this table and nothing else.</span></div>'
    + groups.map((g) => `<div class="ctlg" data-group="${esc(g.name)}">`
      + `<h5>${esc(g.name)}</h5>`
      + g.rows.map((r) => `<div class="ctlr" data-action="${esc(r.action)}">`
        + `<span class="nm">${esc(r.label)}</span>`
        + `<span class="keys">${r.keys.map((k) =>
          `<kbd>${esc(k)}</kbd>`).join(' ')}</span>`
        + (r.sharedWith.length === 0 ? ''
          : `<span class="share">also ${esc(r.sharedWith.join(', '))}</span>`)
        + '</div>').join('') + '</div>').join('')
    + '</div>';
}

/**
 * GP-132. THE VIDEO SCREEN: what this session is actually running at.
 *
 * Every value is read off the parsed `Config` the renderer was handed at boot,
 * not off a default table, because the number worth comparing across two
 * machines is the number each of them RAN. `applyBy` is shown per row rather
 * than as a blanket footnote: three of these are baked into an allocation or a
 * shader path at boot, and a screen that offered a live slider for a
 * preallocated chunk pool would be lying about what it could do.
 */
export function video(rows: VideoRow[]): string {
  const groups: string[] = [];
  for (const r of rows) if (!groups.includes(r.group)) groups.push(r.group);
  return '<div class="of-pgrp ctl"><h4>Video'
    + '<button type="button" class="back" data-cheat="page:">Back</button></h4>'
    + `<div class="row note"><span class="why">Read only for now. Every one of `
    + 'these is a URL flag the game already accepts, so you can benchmark by '
    + 'adding it to the address bar today; a control here needs the renderer to '
    + 'either take the value live or reload, which is a cross-lane call.'
    + '</span></div>'
    + groups.map((gname) => `<div class="ctlg" data-group="${esc(gname)}">`
      + `<h5>${esc(gname)}</h5>`
      + rows.filter((r) => r.group === gname).map((r) =>
        `<div class="ctlr" data-flag="${esc(r.flag)}" data-apply="${r.applyBy}">`
        + `<span class="nm">${esc(r.label)}</span>`
        + `<span class="keys"><kbd>${esc(r.value)}</kbd></span>`
        + `<span class="share">?${esc(r.flag)}= ${esc(r.options)}`
        + `${r.applyBy === 'reload' ? ' (needs a reload)' : ''}</span>`
        + '</div>').join('') + '</div>').join('')
    + '</div>';
}

/**
 * GP-134. THE AUDIO SCREEN, and the only options page with working controls.
 *
 * THE DIAGNOSIS IS FIRST, above the controls, because it is the reason to open
 * this page at all: `AudioBus`'s own header says every browser blocks audio
 * until a gesture and that "the game would be mute for exactly the players who
 * never noticed why". `silentBecause` names ONE reason out of the four that can
 * gate sound, in the order they actually gate, and the page offers the button
 * that fixes the commonest of them. When there is nothing wrong it says so
 * rather than showing an empty box, because a blank diagnostic and a broken one
 * look identical.
 *
 * The counters are shown next to it deliberately: "412 sounds asked for, none
 * of them audible" is a completely different fault from "nothing has tried to
 * make a sound", and one number tells them apart.
 */
export function audio(a: AudioView): string {
  const pct = Math.round(a.volume * 100);
  const diag = a.silentBecause === ''
    ? '<div class="row note ok"><span class="nm">Sound is on</span>'
      + `<span class="why">volume ${pct}%, context ${esc(a.state)}</span></div>`
    : '<div class="row note warn"><span class="nm">You will hear nothing</span>'
      + `<span class="why">${esc(a.silentBecause)}</span>`
      + (a.unlocked || !a.supported ? ''
        : '<button type="button" data-cheat="audio:unlock">Start audio</button>')
      + '</div>';
  return '<div class="of-pgrp ctl aud"><h4>Audio'
    + '<button type="button" class="back" data-cheat="page:">Back</button></h4>'
    + diag
    + '<div class="ctlg"><h5>Master</h5>'
    + '<div class="ctlr vol"><span class="nm">Volume</span>'
    + `<input type="range" min="0" max="100" step="1" value="${pct}" `
    + 'data-audio="volume" aria-label="master volume">'
    + `<span class="keys"><kbd data-vol="${pct}">${pct}%</kbd></span></div>`
    + `<div class="ctlr"><span class="nm">Mute</span>`
    + `<span class="keys"><kbd>${esc(a.muteKey)}</kbd></span>`
    + `<button type="button" data-cheat="audio:mute">`
    + `${a.muted ? 'Unmute' : 'Mute'}</button></div>`
    + '</div>'
    + '<div class="ctlg"><h5>What has played</h5>'
    + `<div class="ctlr"><span class="nm">One-shots since boot</span>`
    + `<span class="keys"><kbd>${a.plays}</kbd></span></div>`
    + `<div class="ctlr"><span class="nm">Running loops</span>`
    + `<span class="keys"><kbd>${a.loops}</kbd></span></div>`
    + `<div class="ctlr"><span class="nm">Time spent building voices</span>`
    + `<span class="keys"><kbd>${a.cpuMs} ms</kbd></span></div>`
    + '</div>'
    + '<div class="ctlg"><h5>Buses</h5>'
    + a.buses.map((b) => `<div class="ctlr" data-bus="${esc(b.name)}">`
      + `<span class="nm">${esc(b.name)}</span>`
      + `<span class="share">${esc(b.note)}</span></div>`).join('')
    + '</div></div>';
}

/**
 * GP-137. THE SAVE SCREEN: this mode's saves, a name to type, and delete.
 *
 * ONLY THIS MODE'S SAVES ARE LISTED, which is Admin's call and the right one: a
 * greyed row a player cannot use is just a question they have to answer, and the
 * key policy in `SaveKeys.ts` makes cross-mode loading unrepresentable rather
 * than merely refused. So there is nothing to grey.
 *
 * THE AUTOSAVE IS A ROW WITH NO DELETE. It is the slot the game writes without
 * being asked, and the verb that destroys it already exists and says what it
 * destroys: Start Fresh, on the root page. A second delete for the same slot,
 * with a smaller warning, would be the more dangerous of the two.
 *
 * DELETE IS ARMED THEN FIRED, in place, on the row. GP-103's two-step, and the
 * reason it is needed here is narrower and sharper: Load and Delete sit two
 * centimetres apart on the same row, and a mis-click destroys exactly the thing
 * the player was reaching for.
 */
export function saves(v: SaveListView): string {
  const rows = v.rows.length === 0
    ? '<div class="ctlr"><span class="nm">No saves yet</span>'
      + '<span class="share">the game autosaves every 20 seconds once you '
      + 'start playing</span></div>'
    : v.rows.map((r) => row(r, v.confirmDelete)).join('');
  return '<div class="of-pgrp ctl sav"><h4>Save game'
    + '<button type="button" class="back" data-cheat="page:">Back</button></h4>'
    + `<div class="row note"><span class="nm">${esc(v.mode)}</span>`
    + `<span class="why">${esc(v.busy !== '' ? v.busy : v.note !== '' ? v.note
      : 'Saves are kept per mode, so a sandbox world can never be loaded into a '
        + 'survival session. Loading restarts the game.')}</span></div>`
    + `<div class="ctlg"><h5>Saved worlds</h5>${rows}</div>`
    + '<div class="ctlg"><h5>Save this world</h5>'
    + '<div class="ctlr vol"><span class="nm">Name</span>'
    + `<input type="text" maxlength="${v.nameMax}" data-save="name" `
    + 'placeholder="my base" aria-label="save name">'
    + '<button type="button" data-cheat="save:new">Save</button></div>'
    + '</div></div>';
}

function row(r: SaveListView['rows'][number], armed: string): string {
  const busy = armed === r.name;
  return `<div class="ctlr sv" data-slot="${esc(r.name)}" `
    + `data-auto="${r.isAuto ? 1 : 0}">`
    + `<span class="nm">${esc(r.name)}`
    + (r.assisted ? '<i class="asst" title="a testing control was used on this '
      + 'world">assisted</i>' : '') + '</span>'
    + `<span class="share">${esc(r.summary)} &middot; ${esc(r.when)}</span>`
    + (busy
      ? `<span class="pair"><button type="button" class="go" `
        + `data-cheat="save:del:${esc(r.name)}">Delete it</button>`
        + '<button type="button" data-cheat="save:delcancel">Cancel</button></span>'
      : `<span class="pair"><button type="button" `
        + `data-cheat="save:load:${esc(r.name)}">Load</button>`
        + (r.isAuto ? ''
          : `<button type="button" data-cheat="save:arm:${esc(r.name)}">Delete</button>`)
        + '</span>')
    + '</div>';
}
