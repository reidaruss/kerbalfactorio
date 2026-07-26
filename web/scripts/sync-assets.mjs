// Copies the committed Blender build output into public/ so Vite serves it in
// dev and copies it into dist/ on build. The canonical .glb files live in
// assets/models/dist at the repo root and are authored by tools/blender; the
// web client CONSUMES them and never edits them (ASSET-SPECS.md section 5).
// public/assets is gitignored: one canonical copy, never two.
//
// There is no gltf-transform pass. ASSET-SPECS section 2.8 defers a texture
// pipeline until the payload would cross 1 MB, and every Tier 0/1 asset is
// untextured PBR roles, so --texture-compress ktx2 has nothing to compress and
// the whole set is already inside the 25 MB critical-preload budget. Revisit
// when a texture ships; the meshopt half is still worth having then.
import { copyFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'assets', 'models', 'dist');
const dst = join(here, '..', 'public', 'assets');

if (!existsSync(src)) {
  console.error(`sync-assets: ${src} is missing. Run the Blender build first.`);
  process.exit(1);
}

let files = 0;
let bytes = 0;
function walk(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from)) {
    const p = join(from, e);
    if (statSync(p).isDirectory()) { walk(p, join(to, e)); continue; }
    if (!e.endsWith('.glb')) continue;
    copyFileSync(p, join(to, e));
    files++;
    bytes += statSync(p).size;
  }
}
walk(src, dst);
console.log(`sync-assets: ${files} .glb, ${(bytes / 1048576).toFixed(2)} MB -> ${relative(join(here, '..'), dst)}`);
