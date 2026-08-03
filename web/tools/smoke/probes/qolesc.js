// qolesc.js: Escape is three verbs, and one of them fires when the player means
// another. With a building in hand, does Escape open the menu or drop it?
(async () => {
  const of = window.__of;
  const sleep = (n) => of.run(n);
  // VISIBILITY, not presence. The first version of this helper matched the
  // menu's own <h3> whether or not it was drawn and reported the menu open at
  // spawn, which is the harness lying before the game had a chance to.
  const menuUp = () => [...document.querySelectorAll('h3')].some((h) =>
    (h.textContent ?? '').includes('Game menu') && h.offsetParent !== null);
  const held = () => of.game()?.hotbar?.label ?? of.game()?.hotbar ?? null;
  await sleep(1.2);
  const out = {};
  out.heldAtStart = held();
  out.menuAtStart = menuUp();

  // Put a foundation in hand through the number key a player presses.
  of.input.press('slot6', 4);
  await sleep(0.5);
  out.heldAfterSlot6 = held();

  // ONE Escape, the gesture a player makes to open the menu.
  of.input.press('cancel', 4);
  await sleep(0.6);
  out.afterFirstEscape = { held: held(), menu: menuUp() };

  // A second Escape.
  of.input.press('cancel', 4);
  await sleep(0.6);
  out.afterSecondEscape = { held: held(), menu: menuUp() };
  return { valid: true, ...out }
})()
