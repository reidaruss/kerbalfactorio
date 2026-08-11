# The Proxmox implementation VM (`claude-dev`)

Written 2026-08-10 by the build-tooling worker lane that provisioned it (BT-30
to BT-39 in [build-tooling.md](../controllers/build-tooling.md); read that
file's decision table for the full detail, this is the quick-reference copy).

## Facts

| | |
|---|---|
| Host | `ssh reid@10.10.10.36` (hostname `claude-dev`), passwordless key auth |
| OS | Ubuntu 24.04, kernel 6.8 |
| Sizing | 16 cores, 48 GB RAM, ~288 GB free on `/` |
| Sudo | passwordless for `reid` |
| Repo clone | `~/kerbalfactorio`, anonymous HTTPS (the repo is public) |
| emsdk | `~/emsdk`, version **6.0.4** (matches the Windows machine's `C:\Users\reida\emsdk`) |
| Node | 22.23.2 (NodeSource, not the ancient apt package) |
| Chrome | `google-chrome-stable` 151.0.7922.108, Google's own apt repo |
| Blender | apt gives **4.0.2** — **do not use for the asset pipeline**, which is pinned to 5.0.1 (BT-14, BT-36) |
| Claude Code | `~/.local/bin/claude` (2.1.227), already authenticated, **not on PATH for non-interactive ssh** — always call the full path |
| Served build | `http://10.10.10.36:4200`, systemd user unit, LAN-bound |

## What is NOT resolved

**Push access from the VM to GitHub.** An ed25519 deploy key was generated on
the VM (`~/.ssh/of_deploy_key[.pub]`) but never registered, because doing so
is an account/repo-config action this session could not take without Reid's
explicit go-ahead. The public key, for Reid (or an authenticated `gh` session)
to add with write access:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICGPqIl9hunXmBYp0x1e9j4QvR+YB5R9gVilcf4Wijeb claude-dev-vm-orbitalfoundry
```

Add it with `gh repo deploy-key add --allow-write -R reidaruss/kerbalfactorio <file>`
after `gh auth login`, or by hand under the repo's Settings → Deploy keys.
Until this lands, `git push` from `~/kerbalfactorio` on the VM will fail, and
any lane that commits there must say so rather than assume the commit is on
GitHub.

## Building

```bash
ssh reid@10.10.10.36
cd ~/kerbalfactorio/web
npm ci                                        # once, or after package.json changes
(cd wasm && EMSDK=$HOME/emsdk bash build.sh)  # build.sh must run from web/wasm/
npm run sync-assets && npm run sync-wasm && npm run build
```

`build.sh` is a Linux port of `build.ps1` (same emcc flags, same two-step:
native ground-truth generator then wasm). It writes `web/wasm/test/expected.json`
by default; that file is committed and toolchain-sensitive at the hash level
(BT-35) — pass `--skip-native` to leave it untouched, and never commit a
VM-regenerated copy.

`core/`:

```bash
cd ~/kerbalfactorio
cmake -S core -B core/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build core/build
cd core/build && ctest --output-on-failure
```

41 suites, 41/41 green as of 2026-08-10 (see BT-34 — the "21 suites" figure
elsewhere in older docs is stale).

## Serving (LAN-bound, survives reboot)

`~/.config/systemd/user/orbital-preview.service` (copy below), enabled via
`loginctl enable-linger reid` + `systemctl --user enable --now orbital-preview.service`.
Reid connects his browser to `http://10.10.10.36:4200` and the game renders on
his GPU; the VM does none of the rendering.

**Do not restart, rebuild into, or re-freeze this service while Reid is
connected to it** (state-of-the-union §1's surviving rule). Lanes may build
and test freely in `~/kerbalfactorio` itself; only the running preview process
is off-limits mid-session.

```ini
[Unit]
Description=Orbital Foundry served build (vite preview, LAN-bound)
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/kerbalfactorio/web
ExecStart=/usr/bin/npx vite preview --port 4200 --strictPort --host 0.0.0.0
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

## Probes

`web/tools/smoke/run.mjs` and `web/tools/smoke/boot.mjs` both had Chrome
discovery hardcoded to Windows paths only (BT-33, fixed in both — they share
one candidate list by explicit convention). On Linux they now find
`/usr/bin/google-chrome-stable` automatically, or honor `CHROME_PATH` if set.
One `boot.mjs` run on this VM took 55.2 s wall clock and produced a real
(non-infra) FAIL — texture decode + WebGL context-loss under SwiftShader, not
yet root-caused, flagged for rendering/world-gen in build-tooling.md BT-38.
Use that number, and the state-of-the-union §7.4 concurrency budget, before
fanning out a probe sweep on this box.

## Running Claude Code headless on the VM

```bash
ssh reid@10.10.10.36 '~/.local/bin/claude -p "your prompt here"'
```

Full path is required; `claude` is not on PATH for non-interactive ssh shells.
