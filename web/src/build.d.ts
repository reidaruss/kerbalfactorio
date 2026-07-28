// BT-27: the build stamp, substituted by Vite's `define` at build time.
//
// It is a compile-time constant and not a runtime lookup on purpose. The app has
// no route to a shell, and a value baked into the bundle cannot disagree with the
// bundle it is baked into, which is the entire property being bought here.
//
// Format: the short commit sha, plus `+dirty` when `web/` or `core/` carried
// uncommitted work at build time. `nogit` when built outside a git checkout.
declare const __OF_BUILD__: string;

// Just enough of `node:child_process` for `vite.config.ts` to read the sha.
// `@types/node` is deliberately NOT a dependency: this project's tsconfig types
// are `vite/client` only, and pulling the whole Node surface in to type one call
// would let Node globals leak into client code that must never reach them.
declare module 'node:child_process' {
  export function execSync(command: string, options: { encoding: 'utf8' }): string;
}

// Config-time only, for the OF_BUILD_STAMP override. Narrowed to `env` on
// purpose: widening this to the real Node `process` would make `process.exit`
// and friends typecheck inside `src/`, where they would fail at runtime.
declare const process: { env: Record<string, string | undefined> };
