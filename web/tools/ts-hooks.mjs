// PS-53. A RESOLVE HOOK SO NODE CAN LOAD THE CLIENT'S OWN `.ts` SOURCES.
//
// Node's `--experimental-strip-types` runs a `.ts` file directly, which is what
// `scripts/check-proplods.mjs` already relies on, but it does NOT rewrite a
// `./Thing.js` specifier to `./Thing.ts`. The client is authored under
// TypeScript's NodeNext rules, where a `.ts` module imports its neighbour by
// its EMITTED `.js` name, so every relative import in `src/` fails to resolve
// under bare node.
//
// This maps exactly that one case: a RELATIVE specifier ending in `.js` whose
// `.js` file does not exist and whose `.ts` sibling does. Anything else is
// handed straight back to node, so a real missing module still fails as a
// missing module rather than being silently redirected.
//
// WHY THIS EXISTS AT ALL: it is what lets a save/load fixture run headless. The
// persistence gates that came before it (`twobody.mjs`, `bodyfields.js`) all
// need a browser, a built client and a driven world, and they take minutes;
// the decision this hook makes reachable is pure data over a `SaveSlot`, and a
// pure decision tested through a browser is a slow test of the browser.

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
    try {
      const asJs = new URL(specifier, context.parentURL);
      if (!existsSync(fileURLToPath(asJs))) {
        const asTs = fileURLToPath(asJs).replace(/\.js$/, '.ts');
        if (existsSync(asTs)) {
          return { url: pathToFileURL(asTs).href, format: 'module-typescript',
            shortCircuit: true };
        }
      }
    } catch {
      // A specifier node cannot turn into a URL is node's to complain about.
    }
  }
  return next(specifier, context);
}
