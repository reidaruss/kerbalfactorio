// `__of.vab`: the driven surface for the assembly bay.
//
// HOUSE RULE (DebugGameplay.ts): every entry goes through the PLAYER'S OWN code
// path. There is no setter here that reaches past a refusal, no way to place a
// part without paying for it and no way to snap to a node the mouse could not
// have reached. A probe that could cheat is a probe that proves nothing.
//
// The two mouse entry points are the exception that proves it: `hover` and
// `click` take SCREEN coordinates and drive the same pointer handlers a human
// does, so they exercise the real hit test rather than a parallel one. The
// genuinely real thing, a dispatched DOM PointerEvent, is what `probes/vab.js`
// uses for at least one assertion, because twenty green probes once hid a
// completely inert left mouse button.
import type { Services } from './Services.js';
import type { Vab } from '../game/Vab.js';

/** Click the `data-vab` control whose `data-name` matches, as a real event. */
function clickByName(root: HTMLElement, kind: string, name: string, v: Vab): unknown {
  const all = [...root.querySelectorAll(`[data-vab="${kind}"]`)];
  const hit = all.find((e) => e.getAttribute('data-name') === name);
  if (hit === undefined) return { error: `no ${kind} named ${name}` };
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return v.report();
}

/** Click the first control carrying this `data-vab` value. */
function clickByAttr(root: HTMLElement, kind: string, v: Vab): unknown {
  const hit = root.querySelector(`[data-vab="${kind}"]`);
  if (hit === null) return { error: `no control ${kind}` };
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return v.report();
}

export interface VabDebugApi {
  vab(op?: string, a?: unknown, b?: unknown): unknown;
}

export function vabApi(s: Services): VabDebugApi {
  return {
    vab(op?: string, a?: unknown, b?: unknown): unknown {
      const v = s.vab;
      if (v === null) return { error: 'no vab (needs gameplay, and not ?vab=0)' };
      switch (op) {
        case undefined:
        case 'report':
          return v.report();
        case 'enter': v.enter(); return v.report();
        case 'leave': v.leave(); return v.report();
        case 'toggle': v.toggle(); return v.report();
        // Take a catalogue part in hand, by INDEX. Same call the panel makes.
        case 'take': {
          // GP-120: through the tab, exactly as a player reaches a part that is
          // not on the page they are looking at.
          const el = v.panel.revealPart(Number(a));
          if (el === null) return { error: `part ${String(a)} is not offered` };
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return v.report();
        }
        // Move the cursor to a point in NORMALISED DEVICE COORDS and let the
        // real snap search run. Returns what it snapped to.
        case 'hover': {
          v.hoverNdc(Number(a), Number(b));
          return v.report();
        }
        // Commit at whatever is currently snapped. Pays, or refuses and says so.
        case 'place': return { ok: v.commitHere(), report: v.report() };
        // What the raycast under these NDC would hit. The SAME `view.pick` a
        // click runs, so a probe can look before it clicks exactly as a player
        // does, and then click for real. It removes nothing itself.
        case 'pick': return v.view.pick(v.camera, Number(a), Number(b));
        case 'drop': v.dropHand(); return v.report();
        case 'remove': return { ok: v.removeAt(Number(a)), report: v.report() };
        case 'frame': v.frameCamera(); return v.report();
        case 'orbit': {
          v.cam.yaw = Number(a);
          v.cam.pitch = Number(b);
          v.cam.apply();
          return v.cam.report();
        }
        case 'zoom': { v.cam.zoom(Number(a)); return v.cam.report(); }
        case 'designs': return v.report();
        // The joint gap, MEASURED on the drawn scene rather than on the model:
        // it walks the three.js graph for each mated pair of sockets and returns
        // the distance between them in world space.
        case 'gaps': return v.measureJointGaps();
        case 'catalogue': return v.catalogueReport();
        // GP-141. Where the bay floor is, read off the pad the renderer was
        // handed. The floor is the thing that was standing in front of every
        // downward preview, so an assertion about it has to come from the
        // scene rather than from a second copy of `applyFloor`'s arithmetic.
        case 'floor': return { topY: v.view.floorTopY,
                               ghostBaseY: v.view.ghostBase };
        // GP-143. The bay's one line, READ BACK OFF THE ELEMENT, so an
        // assertion is against the screen and not against a second copy of the
        // sentence the client composed (the GP-64 rule, as `verdictBand` does).
        case 'line': return { text: v.panel.messageText };
        // GP-266. The destination block AS DRAWN, read back off the elements,
        // beside the model's own numbers. Both, deliberately: a screen agreeing
        // with itself proves nothing, and the pair is what catches a painter
        // that stopped repainting (GP-136's third defect).
        case 'dest': return {
          drawn: {
            gate: v.destView.gateText,
            verdict: v.destView.verdictText,
            rowIds: v.destView.rowIds,
            blockedRowIds: v.destView.blockedRowIds,
            selectedRowId: v.destView.selectedRowId,
            altBox: v.destView.altInput.value,
            incBox: v.destView.incInput.value,
            orbitBoxesShown: v.destView.root
              .querySelector('.of-vdorbit')?.classList.contains('on') === true,
            reachText: v.destView.root
              .querySelector('.of-vdreach')?.textContent ?? '',
          },
          model: v.dest.report(),
        };
        // GP-148. What the last root normalisation did, so a probe asserts
        // against the OPERATION and not only against its side effects.
        case 'reroot': {
          const r = v.design.lastReroot;
          return r === null
            ? { moved: false, fromPartId: -1, toPartId: -1, reversed: 0,
                skipped: false, why: 'no normalisation has run' }
            : r;
        }
        // Every attachment node with the PIXEL it is drawn at, so a probe can
        // put the cursor where a player would look instead of teleporting the
        // snap. The hit test and the snap search still run for real.
        case 'nodes': return v.view.projectNodes(v.camera, v.nodes);
        // The panel controls, driven as REAL DOM clicks on the real elements.
        // Nothing here reaches past the button a player would press.
        case 'save': {
          const i = v.panel.nameInput, b = v.panel.saveButton;
          if (i === null || b === null) return { error: 'no save controls' };
          i.value = String(a);
          b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return v.report();
        }
        case 'load': return clickByName(v.panel.root, 'design', String(a), v);
        case 'forget': return clickByName(v.panel.root, 'design-del', String(a), v);
        case 'stageUp':
        case 'stageDown': {
          const el = op === 'stageUp' ? v.panel.stageUpButton(Number(a))
                                      : v.panel.stageDownButton(Number(a));
          if (el === null) return { error: `no ${op} control for ${String(a)}` };
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return v.report();
        }
        case 'autostage2': {
          const el = v.panel.autostageButton;
          if (el === null) return { error: 'no autostage control' };
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return v.report();
        }
        // GP-118. The pre-flight verdict, and the roll-out gate DRIVEN THROUGH
        // THE BUTTON a player presses: `rollout` here is a real click on the
        // real control, so a probe cannot arm the confirm by a route the player
        // has no access to.
        case 'verdict': return v.verdict;
        // The verdict AS PAINTED, read back off the element's own text, so the
        // assertion is against the screen rather than against a second copy of
        // the client's own arithmetic (the GP-64 rule).
        case 'verdictBand':
          return { text: v.panel.verdictText, fault: v.panel.verdictIsFault };
        case 'rollout': {
          const el = v.panel.rollOutButton;
          if (el === null) return { error: 'no rollout control' };
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return { armed: v.rollOutArmed, refused: v.rollOutsRefused,
                   forced: v.rollOutsForced, report: v.report() };
        }
        case 'recoverBtn': {
          const el = v.panel.recoverButton;
          if (el === null) return { error: 'no recover control' };
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return { recoveries: v.recoveries, report: v.report() };
        }
        // GP-120. The tab strip, as clicks and as read-back state.
        case 'tabs': return v.panel.tabReport();
        case 'tab': {
          const el = v.panel.tabButton(String(a));
          if (el === null) return { error: `no tab ${String(a)}` };
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return v.panel.tabReport();
        }
        case 'press': return clickByAttr(v.panel.root, String(a), v);
        default: return { error: `unknown vab op ${op}` };
      }
    },
  };
}
