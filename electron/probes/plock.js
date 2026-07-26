// POINTER LOCK, ASKED DIRECTLY (DW-27 spike).
//
// Mouse look is the entire control scheme of a first-person game, and the soak
// run threw `WrongDocumentError: The root document of this element is not valid
// for pointer lock` in the shell and not in the browser. That is either a
// property of the custom of:// scheme or an artefact of the measurement window
// being offscreen and non-focusable, and those two conclusions lead to opposite
// decisions, so it gets its own probe rather than a guess.
//
// Run it three ways, changing exactly ONE thing at a time:
//   node measure/drive.mjs   --evalfile=probes/plock.js                                  (shell, of://)
//   node measure/drive.mjs   --evalfile=probes/plock.js --url=http://127.0.0.1:4173/     (shell, http, SAME bundle)
//   node measure/browser.mjs --evalfile=probes/plock.js --url=http://127.0.0.1:4173/     (chrome, http, SAME bundle)
(async () => {
  const of = window.__of;
  const el = document.querySelector('canvas') ?? document.body;

  const ask = async (label, node) => {
    let err = null;
    let locked = false;
    try {
      const p = node.requestPointerLock();
      if (p && typeof p.then === 'function') await p;
      await new Promise((r) => setTimeout(r, 250));
      locked = document.pointerLockElement !== null;
    } catch (e) {
      err = { name: e && e.name ? e.name : 'unknown', message: String(e && e.message ? e.message : e) };
    }
    try { document.exitPointerLock(); } catch (_) {}
    return { label, locked, err, tag: node.tagName };
  };

  // A pointerlockerror event carries the failure that the promise rejection does
  // not always surface, so both are collected.
  const events = [];
  const onErr = () => events.push('pointerlockerror');
  const onChange = () => events.push(`pointerlockchange:${document.pointerLockElement ? 'locked' : 'unlocked'}`);
  document.addEventListener('pointerlockerror', onErr);
  document.addEventListener('pointerlockchange', onChange);

  const canvas = await ask('canvas', el);
  const body = await ask('body', document.body);

  document.removeEventListener('pointerlockerror', onErr);
  document.removeEventListener('pointerlockchange', onChange);

  return {
    client: /Electron/.test(navigator.userAgent) ? 'electron' : 'chrome',
    origin: location.origin,
    protocol: location.protocol,
    hasFocus: document.hasFocus(),
    visibilityState: document.visibilityState,
    // The verdict a human should read first.
    pointerLockWorks: canvas.locked === true || body.locked === true,
    canvas, body, events,
    pointerLockedFlagInGame: of.game() ? of.game().pointerLocked : null,
  };
})()
