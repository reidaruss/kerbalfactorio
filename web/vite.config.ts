import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// THE BUILD STAMP (BT-27). Reid runs a server; agents merge into main; the two
// drift, and when they drift EVERY symptom lies. A stale bundle produced three
// wrong diagnoses in one session: a launch fix that "did not work", a tunnel fix
// that "did not work", and a machine panel that "did not work", all of them
// already correct in main and none of them in the browser. The only cure is that
// the running client can be asked which commit it IS.
//
// Read at config time, not at import time in the app: the app must not be able
// to reach a shell, and a dev server started before a commit should keep saying
// the commit it was started at, because that is the truth about what it serves.
// `dirty` matters as much as the sha here, since a lane's uncommitted work in a
// shared checkout is exactly the state that produces a bundle matching NO commit.
function buildStamp(): string {
  // A snapshot built from `git archive` genuinely CONTAINS one commit's content
  // no matter what the surrounding checkout is doing, and asking git from inside
  // it answers about the wrong tree. Such a build states its own sha, explicitly.
  const forced = process.env.OF_BUILD_STAMP;
  if (forced !== undefined && forced !== '') return forced;
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    // Anchored at the repo root, not at the config's directory: `../web` means
    // different things depending on where the config is, and got this wrong once.
    const top = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    // TRACKED changes only. Untracked build outputs (web/dist-*, screenshots) are
    // not part of what the bundle is made of, and counting them would leave the
    // stamp permanently `+dirty`, which is the same as having no warning at all.
    const dirty = execSync(
      `git diff --name-only HEAD -- "${top}/web" "${top}/core"`, { encoding: 'utf8' }).trim();
    return dirty === '' ? sha : `${sha}+dirty`;
  } catch {
    // A tarball with no git is a legitimate way to build, so this is not fatal.
    return 'nogit';
  }
}

// DECISIONS.md DW-4 / ARCHITECTURE.md 2.5: transferables only. There are
// deliberately NO COOP/COEP headers here, so the build runs on any static host
// and no cross-origin subresource is broken.
export default defineConfig({
  define: { __OF_BUILD__: JSON.stringify(buildStamp()) },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    reportCompressedSize: true,
  },
});
