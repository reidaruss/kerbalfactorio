// The Steam desktop shell (DW-27). One job: serve web/dist to a BrowserWindow
// over an origin the client can actually live on, and instrument the boot so
// cold start is a measured number rather than an impression.
//
// The interesting decision is the ORIGIN. A packaged web app is normally loaded
// over file://, and file:// is an OPAQUE origin: IndexedDB is refused, module
// workers are refused, and fetch() of a .wasm is refused. DW-17 puts the entire
// save system on IndexedDB and DW-4 puts terrain, voxel meshing and the factory
// tick in module workers, so file:// would break both halves of the client at
// once. So the shell registers a PRIVILEGED custom scheme (of://) which
// Chromium treats as a real, secure, same-origin web origin, and serves the
// built client from it. Pass --origin=file to load file:// instead: the failure
// is then observable rather than asserted (see measure/origincheck.mjs).
//
// Nothing in here is game code. The renderer is the unmodified Vite build.

import { app, BrowserWindow, protocol, net, session } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const webDist = resolve(repoRoot, 'web', 'dist');
const shellRoot = resolve(here, 'shell');

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const ORIGIN = argOf('origin', 'protocol');      // protocol | file
const PAGE = argOf('page', 'app');               // app | origincheck
const QUERY = argOf('query', 'debug=1');
// OFFSCREEN, NOT HEADLESS, AND THE DIFFERENCE IS THE WHOLE MEASUREMENT.
// Headless Chromium routinely falls back to SwiftShader software rasterisation
// (web/tools/smoke/run.mjs even passes --enable-unsafe-swiftshader to make that
// fallback legal), so a headless frame-time number is a CPU rasteriser number
// wearing a GPU number's clothes. Every measurement script here therefore runs a
// REAL window on the REAL GPU and simply parks it off the visible desktop, and
// every one of them asserts the ANGLE string is not a software renderer before
// it reports anything. `show: false` is deliberately NOT used: an unshown window
// is not guaranteed to composite, which would be the same trap by a different
// door. See docs/web/PACKAGING.md section "Why offscreen and not headless".
const OFFSCREEN = process.argv.includes('--offscreen');
const WIDTH = Number(argOf('width', '1600'));
const HEIGHT = Number(argOf('height', '900'));
const KEEP_OPEN = process.argv.includes('--keep-open');

// Timestamps are Date.now() so they are directly comparable with the launcher's
// own clock across the process boundary. t0 is as early as this file can run.
const tProcess = Date.now();
process.stdout.write(`OF_MAIN {"ev":"main-loaded","t":${tProcess}}\n`);

// Must be called before app is ready. `standard` is what makes it a real origin
// (so localStorage/IndexedDB/workers work); `secure` puts it in a secure
// context (so crypto.subtle and SharedArrayBuffer are legal); supportFetchAPI
// lets three.js and Emscripten fetch() their own assets.
protocol.registerSchemesAsPrivileged([{
  scheme: 'of',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    bypassCSP: false,
  },
}]);

// DW-27 notes that in a shell we own the headers. We do not turn cross-origin
// isolation ON here, because DW-4 still stands and nothing has asked for
// SharedArrayBuffer yet. The switch is a two-line change in serve() below
// (Cross-Origin-Opener-Policy: same-origin + Cross-Origin-Embedder-Policy:
// require-corp) and this comment is the whole cost of leaving it available.
const ISOLATE = process.argv.includes('--isolate');

const mime = (p) => {
  if (p.endsWith('.html')) return 'text/html';
  if (p.endsWith('.js') || p.endsWith('.mjs')) return 'text/javascript';
  if (p.endsWith('.css')) return 'text/css';
  if (p.endsWith('.json') || p.endsWith('.map')) return 'application/json';
  if (p.endsWith('.wasm')) return 'application/wasm';
  if (p.endsWith('.glb')) return 'model/gltf-binary';
  if (p.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
};

/** Resolve a request path inside `root`, refusing anything that escapes it. */
function safeJoin(root, urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const p = normalize(join(root, clean));
  if (p !== root && !p.startsWith(root + sep)) return null;
  return p;
}

app.whenReady().then(async () => {
  process.stdout.write(`OF_MAIN {"ev":"app-ready","t":${Date.now()}}\n`);

  protocol.handle('of', async (request) => {
    const u = new URL(request.url);
    // of://app/...  and  of://shell/...  are two roots, so the origin probe
    // page can be served from the SAME origin as the app without living in
    // web/dist (which this spike must not write into).
    const root = u.hostname === 'shell' ? shellRoot : webDist;
    let file = safeJoin(root, u.pathname === '/' ? '/index.html' : u.pathname);
    if (file === null) return new Response('bad path', { status: 403 });
    if (!existsSync(file)) return new Response('not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Type', mime(file));
    if (ISOLATE) {
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    }
    return new Response(res.body, { status: 200, headers });
  });

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    // Shown and compositing on the real GPU, but parked off the visible desktop
    // and refusing focus, so a measurement run does not steal the machine from
    // whoever is using it.
    show: true,
    ...(OFFSCREEN ? { x: -3200, y: -3200, focusable: false, skipTaskbar: true } : {}),
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The client is a fixed-timestep game loop. Without this, Chromium
      // throttles rAF the moment the window is occluded or backgrounded, which
      // would make every long driven measurement a lie (DW-20).
      backgroundThrottling: false,
      offscreen: false,
    },
  });
  win.setMenuBarVisibility(false);
  if (OFFSCREEN) { win.setPosition(-3200, -3200); win.blur(); }

  const target = (() => {
    // --url= points the shell at a live vite server instead of the packaged
    // bundle. That is what makes the scale test an honest shell-versus-browser
    // comparison: the same server, the same sources, the same probe, two
    // clients. The packaged of:// path is what cold start and installed size
    // are measured on.
    const override = argOf('url', '');
    if (override !== '') return override;
    if (PAGE === 'origincheck') {
      return ORIGIN === 'file'
        ? `${pathToFileURL(join(shellRoot, 'origincheck.html')).toString()}`
        : 'of://shell/origincheck.html';
    }
    return ORIGIN === 'file'
      ? `${pathToFileURL(join(webDist, 'index.html')).toString()}?${QUERY}`
      : `of://app/index.html?${QUERY}`;
  })();

  // Relay every renderer console line to stdout. The measurement scripts read
  // stdout, so the page can hand a number back without any IPC surface.
  win.webContents.on('console-message', (e) => {
    const text = typeof e === 'string' ? e : (e?.message ?? '');
    process.stdout.write(`OF_PAGE ${text}\n`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    process.stdout.write(`OF_MAIN {"ev":"fail-load","code":${code},"desc":${JSON.stringify(desc)},"url":${JSON.stringify(url)}}\n`);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    process.stdout.write(`OF_MAIN {"ev":"renderer-gone","reason":${JSON.stringify(d?.reason)}}\n`);
  });

  win.webContents.on('did-finish-load', () => {
    process.stdout.write(`OF_MAIN {"ev":"did-finish-load","t":${Date.now()}}\n`);
    if (PAGE !== 'app') return;
    // Poll for the FIRST RENDERED FRAME, not for a load event. The client boots
    // wasm and streams terrain after load, so did-finish-load is nowhere near
    // "you can see the planet". frames >= 1 is the client's own frame counter.
    win.webContents.executeJavaScript(`
      (async () => {
        const waitFor = (fn) => new Promise((r) => {
          const i = setInterval(() => { try { if (fn()) { clearInterval(i); r(); } } catch (_) {} }, 2);
        });
        await waitFor(() => typeof window.__of !== 'undefined');
        await window.__of.ready;
        await waitFor(() => window.__of.world().frames >= 1);
        const w = window.__of.world();
        console.log('OF_FIRSTFRAME ' + JSON.stringify({
          t: Date.now(), frames: w.frames, tick: w.tick,
          origin: location.origin, protocol: location.protocol,
          boot: window.__of.boot, gpu: window.__of.stats().gpu,
        }));
      })();
    `).catch((e) => process.stdout.write(`OF_MAIN {"ev":"inject-failed","err":${JSON.stringify(String(e))}}\n`));
  });

  process.stdout.write(`OF_MAIN {"ev":"load-start","t":${Date.now()},"url":${JSON.stringify(target)}}\n`);
  win.loadURL(target);

  if (!KEEP_OPEN) {
    // A measurement run closes itself; an interactive run does not.
  }
});

app.on('window-all-closed', () => { app.quit(); });

// Exposed so a launcher can ask for a clean exit over stdin without SIGKILL
// truncating stdout mid-line.
process.stdin.on('data', (b) => {
  if (String(b).includes('quit')) app.quit();
});
process.stdin.resume();
