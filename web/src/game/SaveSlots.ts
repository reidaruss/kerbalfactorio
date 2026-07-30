// GP-137. NAMED SLOTS, MANUAL SAVE, A LOAD LIST AND DELETE.
//
// LOADING IS A COPY PLUS A RELOAD, AND THAT IS THE DESIGN RATHER THAN A
// SHORTCUT. GP-103 argued it for Start Fresh and the argument is stronger here:
// `Persist.apply` restores a diff over a FRESHLY GENERATED world, which is the
// only state a boot can be in. Applying a save over a world that already has a
// base, a factory, tunnels, pads, health rows and a pack in it would need every
// one of those emptied first, in an order that matters (`Persist`'s own header
// is about that order), and the failure mode of getting one wrong is a HALF
// LOADED world, which is worse than either outcome and impossible to report.
// Copying the chosen slot onto the autosave key and reloading reuses the boot
// path exactly, so a loaded world is indistinguishable from a world that was
// there when the page opened. It costs a second.
//
// DELETE SHIPS WITH IT, because a save list with no delete fills up and the
// player cannot fix it. It is ARMED then FIRED, the same two-step GP-103 uses,
// because the two verbs sit next to each other on the same row and a mis-click
// on Delete would destroy the thing the player was reaching for.
//
// THE LIST IS CACHED AND REFRESHED, not read synchronously, because IndexedDB
// is async and the menu draws every frame. What that buys is worth stating: the
// view never blocks and never throws, and a `busy` string says which operation
// is in flight, so a slow store reads as "saving" rather than as a dead button.

import { snapshot, saveProgress } from './Persist.js';
import { stampAssisted } from './SaveGame.js';
import { allKeys, autoKeyFor, deleteKey, nameOk, namedKey, parseNamedKey,
  readKey, writeKey, NAME_MAX } from './SaveKeys.js';
import type { SaveSlot } from './SaveGame.js';
import type { GameMode } from './GameMode.js';
import type { Gameplay } from './Gameplay.js';

/** One row of the load list. Everything the panel draws, already reduced. */
export interface SlotRow {
  name: string;
  key: string;
  savedAt: number;
  /** How long ago, in words. Computed here so src/ui formats nothing. */
  when: string;
  /** A one-line description of the world, so a player can tell two apart. */
  summary: string;
  /** GP-102: this world has had a testing control used on it. */
  assisted: boolean;
  /** True for the slot the game writes unprompted. It cannot be deleted from
   *  here: Start Fresh is that verb, and it says what it destroys. */
  isAuto: boolean;
}

export interface SaveListView {
  mode: string;
  rows: SlotRow[];
  /** '' when idle, else the operation in flight. */
  busy: string;
  /** The last outcome, good or bad. Never empty after the first action. */
  note: string;
  /** The name armed for deletion, or ''. */
  confirmDelete: string;
  nameMax: number;
}

export class SaveSlots {
  private rows: SlotRow[] = [];
  private busy = '';
  private note = '';
  private armed = '';
  private showing = false;
  /** Counters a probe reads: what actually happened, not what was asked for. */
  saved = 0; loads = 0; deleted = 0; refusals = 0;

  constructor(private readonly restart: () => void) {}

  /**
   * `showing` is whether the save PAGE is up, and the rising edge of it re-reads
   * the store.
   *
   * GP-137: without that the list is built once and never again, so the autosave
   * the game writes every 20 seconds never appears on the screen that exists to
   * show it, and a slot written by any other path stays invisible until
   * something else happens to refresh. A list that can be stale is a list a
   * player cannot trust, and the screenshot that found this was missing its
   * autosave row with no way to tell that from there being none.
   */
  view(mode: GameMode, showing: boolean): SaveListView {
    if (showing && !this.showing) void this.refresh(mode);
    this.showing = showing;
    return {
      mode,
      rows: this.rows,
      busy: this.busy,
      note: this.note,
      confirmDelete: this.armed,
      nameMax: NAME_MAX,
    };
  }

  /** Rebuild the list from the STORE. Only this mode's saves, plus its auto. */
  async refresh(mode: GameMode): Promise<void> {
    const keys = await allKeys();
    const want = [autoKeyFor(mode),
      ...keys.filter((k) => parseNamedKey(k)?.mode === mode)];
    const rows: SlotRow[] = [];
    for (const key of want) {
      const slot = await readKey(key);
      if (slot === null) continue;
      const named = parseNamedKey(key);
      rows.push({
        name: named?.name ?? 'Autosave',
        key,
        savedAt: slot.savedAt,
        when: ago(slot.savedAt),
        summary: describe(slot),
        assisted: (slot.assisted?.used.length ?? 0) > 0,
        isAuto: named === null,
      });
    }
    // The autosave first, then newest named save first: the two questions a
    // player has are "where was I" and "what did I keep", in that order.
    const auto = rows.filter((r) => r.isAuto);
    const rest = rows.filter((r) => !r.isAuto).sort((a, b) => b.savedAt - a.savedAt);
    this.rows = [...auto, ...rest];
  }

  // THE TYPED NAME IS NOT MIRRORED HERE, and the first version did mirror it so
  // the name could be refused live. That was wrong twice over and the
  // diagnostic caught both: every keystroke went through `press`, which calls
  // `menu.invalidate()`, which rebuilt the page and WIPED THE BOX THE PLAYER
  // WAS TYPING IN and took the caret with it. A text input already holds its own
  // value; the panel keeps it and hands it over on the press. The refusal
  // arrives one press later than it would have, in a whole sentence, which is a
  // trade worth making for a box that does not erase itself.

  /**
   * Snapshot the LIVE world under `name`.
   *
   * It goes through `Persist.snapshot`, the same function the autosave uses, so
   * a named save carries exactly what an autosave carries and no second idea of
   * what a world is can appear. It cannot go through `writeSlot`, which derives
   * the key from the mode by design, so it takes that function's own
   * `stampAssisted` and then writes the key itself: one authority on the GP-102
   * mark, two callers, because a named save of an assisted world is still
   * assisted.
   */
  async save(g: Gameplay, name: string): Promise<boolean> {
    if (!nameOk(name)) {
      this.refusals++;
      this.note = name.trim() === '' ? 'type a name first'
        : name.includes(':') ? 'a name cannot contain a colon'
          : `a name must be 1 to ${NAME_MAX} characters`;
      return false;
    }
    this.busy = `saving "${name.trim()}"`;
    const ok = await writeKey(namedKey(g.mode.mode, name),
      stampAssisted(this.snapshotOf(g)));
    this.busy = '';
    if (ok) { this.saved++; this.note = `saved "${name.trim()}"`; }
    else { this.refusals++; this.note = 'the store refused the write'; }
    await this.refresh(g.mode.mode);
    return ok;
  }

  /** Copy a named slot onto the autosave key and restart. See the header. */
  async load(g: Gameplay, name: string): Promise<boolean> {
    const mode = g.mode.mode;
    this.busy = `loading "${name}"`;
    const slot = await readKey(namedKey(mode, name));
    this.busy = '';
    if (slot === null) { this.refusals++; this.note = `"${name}" is not there`; return false; }
    // THE MODE IS CHECKED EVEN THOUGH THE KEY MAKES IT UNREPRESENTABLE, which is
    // DW-31's belt and braces applied one layer out: a store that has been
    // hand-edited or migrated wrongly is a different failure from a store that
    // is working, and it must not be best-effort merged into a running world.
    if (slot.mode !== undefined && slot.mode !== mode) {
      this.refusals++;
      this.note = `"${name}" says it is a ${slot.mode} save; refusing`;
      return false;
    }
    if (!await writeKey(autoKeyFor(mode), slot)) {
      this.refusals++; this.note = 'could not put that save in place';
      return false;
    }
    this.loads++;
    this.note = `loading "${name}", restarting`;
    this.restart();
    return true;
  }

  armDelete(name: string): void { this.armed = name; this.note = ''; }
  cancelDelete(): void { this.armed = ''; }

  async remove(g: Gameplay, name: string): Promise<boolean> {
    if (this.armed !== name) { this.refusals++; this.note = 'delete must be confirmed'; return false; }
    this.armed = '';
    const ok = await deleteKey(namedKey(g.mode.mode, name));
    if (ok) { this.deleted++; this.note = `deleted "${name}"`; }
    else { this.refusals++; this.note = 'the store refused the delete'; }
    await this.refresh(g.mode.mode);
    return ok;
  }

  private snapshotOf(g: Gameplay): SaveSlot {
    return snapshot(g.core, g.game, g.field, g.factory, g.machines, g.seed,
      g.ports, g.oreField, g.structures, g.pads, g.hotbar, g.mode.mode,
      saveProgress(g), g.health, g.vitals.serialize(), g.rocks);
  }

  report(): unknown {
    return { saved: this.saved, loads: this.loads, deleted: this.deleted,
      refusals: this.refusals, armed: this.armed, busy: this.busy,
      note: this.note, rows: this.rows.map((r) => ({ name: r.name, key: r.key,
        isAuto: r.isAuto, summary: r.summary, assisted: r.assisted })) };
  }
}

/** A world in one line, so two saves can be told apart without loading them. */
function describe(s: SaveSlot): string {
  const bits: string[] = [];
  const b = s.buildings.length + (s.structures?.length ?? 0);
  if (b > 0) bits.push(`${b} built`);
  if ((s.pads?.length ?? 0) > 0) bits.push(`${s.pads?.length ?? 0} pad`);
  if (s.machines.length > 0) bits.push(`${s.machines.length} machine`);
  const techs = s.progress?.techs.length ?? 0;
  if (techs > 0) bits.push(`${techs} tech`);
  if (s.voxels.cells.length > 0) bits.push('dug in');
  return bits.length === 0 ? 'nothing built yet' : bits.join(', ');
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
