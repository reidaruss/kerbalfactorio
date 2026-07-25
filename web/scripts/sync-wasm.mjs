// Copies the committed /core WASM build into public/ so Vite serves it verbatim
// in dev and copies it into dist/ on build. The canonical artefacts live in
// web/wasm/dist (built by web/wasm/build.ps1); public/wasm is gitignored.
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'wasm', 'dist');
const dst = join(here, '..', 'public', 'wasm');
const files = ['of-core.mjs', 'of-core.wasm'];

if (!existsSync(src)) {
  console.error(`sync-wasm: ${src} is missing. Run web/wasm/build.ps1 first.`);
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
for (const f of files) {
  const from = join(src, f);
  if (!existsSync(from)) {
    console.error(`sync-wasm: ${from} is missing. Run web/wasm/build.ps1 first.`);
    process.exit(1);
  }
  copyFileSync(from, join(dst, f));
  console.log(`sync-wasm: ${f} (${statSync(from).size} B)`);
}
