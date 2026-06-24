# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Mini Mage Mayhem — a single-player, web, top-down magic roguelike (4 elements, fusions, elemental reactions, enemy waves, a boss). It is a **single self-contained HTML file** with an inline `<script>` IIFE. No framework, no bundler, no npm for the game itself. The only runtime dependency is Three.js, vendored at `vendor/three.min.js` (r149 UMD, exposes global `THREE`, loaded same-origin).

- `index.html` — the game (deployed as the site root `index.html`).
- `camera-sandbox.html` — a copy of the game plus an on-screen camera-tuning panel (sliders for fov/angle/dist/azimuth/pan/lookY + pause). Keep its game logic in sync with `index.html` when changing shared behaviour.
- `vendor/three.min.js` — vendored Three.js. CDNs are blocked by the egress proxy; the npm registry is allowed, so re-vendor via `npm i three@0.149.0` and copy `build/three.min.js`.
- `docs/` — design + roadmap docs (repo-only, not deployed). Start at `docs/README.md`; `docs/roadmap.md` holds the current A/B/C direction decision.

## No build / test / lint

There is no build, test, or lint tooling. To sanity-check a change to the game JS, extract the inline script and run Node's syntax checker:

```bash
python3 - <<'PY'
import re; s=open("index.html",encoding="utf-8").read()
open("/tmp/_game.js","w").write(re.findall(r"<script>(.*?)</script>", s, re.S)[-1])
PY
node --check /tmp/_game.js
```

To actually *see* a change, render it headlessly with Puppeteer. **WebGL needs SwiftShader flags** — without them `WebGLRenderer` throws and the page is blank:

```
--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox
```

Load via `file://` so the vendored Three.js resolves. The egress proxy blocks `github.io` and CDNs, so you cannot load the live Pages URL headlessly — test the local file instead.

## Editing the file

`index.html` is ~3500 lines. Small edits use the Edit tool; **large structural replacements are done with a Python splice script** (read file → `str.index`/`replace` between stable anchors → write), because exact-match edits over big blocks are fragile (watch for `\u` / `\n` escapes and full-width punctuation in the Chinese UI strings).

## Architecture

### Simulation vs. rendering split
The game **logic** runs on a flat 2D plane in pixel units: `W=960, H=640, TILE=32`, world coordinates `(x, y)` where `y` is depth. All gameplay (movement, collisions, elements, reactions, waves, boss) operates on this plane and is rendering-agnostic. This matters: the planned battle-royale path (see `docs/`) extracts this logic as a headless sim, and the 3D/art layer is irrelevant to it.

- `const game = {...}` (~line 138) is the single mutable state object (player, enemies, projectiles, zones, particles, stats, map, run, wave/boss flags).
- `update(dt)` advances the simulation; `draw()` renders; `loop(now)` ties them together with `requestAnimationFrame`.
- The tile map is `game.map` (a `ROWS×COLS` grid of `TILE_*` constants: floor/wall/thin/grass/burnt/water/ice). `makeMap(template)` builds arenas.

### Rendering: 3D via Three.js, 2D HUD overlay
Two stacked canvases inside `#stage`: `#game` is the **WebGL canvas** (3D world), `#hud` is a **2D canvas overlay** for crisp HUD/menus/floating-text (`#hud` has `pointer-events:none` so input reaches `#game`). The module-level `let ctx` points at the HUD 2D context; HUD draw functions write to it.

- `render3D()` draws the world each frame: a tilemap-textured ground plane, extruded wall blocks, voxel meshes for player/enemies/boss (cached per entity, element-tinted), glowing-sphere projectiles, translucent ground discs for zones, then `renderer.render`.
- World→3D mapping: world `(x, y)` → 3D `(x, height, y)` (world `y` is the 3D `z`/depth axis).
- `project(wx, wy, wz)` projects a world point to HUD screen pixels via the live camera (used for billboarded health bars and floating text).
- `gl3dOk` guards a WebGL-init failure (shows a message instead of a dead page).

### Camera (fixed 45°-style follow) and camera-relative movement
`const CAM = { fov, angle, dist, azimuth, panX, panZ, lookY }` defines the follow camera; `render3D` positions it each frame from `angle`/`azimuth`/`dist` around the player (+ `pan` framing offset, + screen-shake). Because `azimuth ≠ 0` rotates the view, **WASD input is rotated by `CAM.azimuth`** in `updatePlayer` so screen-up = forward (camera-relative movement); dash inherits the same basis. Mouse aim raycasts the cursor onto the ground plane through the live camera, so aiming stays correct at any azimuth. `camera-sandbox.html` exposes all `CAM` fields as live sliders; its "copy" button emits the `CAM = {...}` line to paste back into `index.html`.

### Elements & fusion (the core mechanic)
The player's single spell is defined by up to two elements. `fusionKind(elements)` maps element sets to a spell kind (e.g. fire+ice→steam, fire+poison→toxic_boom); `ELEMENT_INFO` holds colors/names; `upgradePool` holds the per-wave 3-choose-1 upgrades (element injection, split, explode, trail, etc.). Reactions live in the projectile/zone update code (fire ignites grass, lightning conducts through water tiles, fire detonates poison clouds, explosions break thin walls).

## Deploy (GitHub Pages)

`.github/workflows/deploy-pages.yml` publishes the repo root to Pages on every push to `main` (and via `workflow_dispatch`). It copies `index.html`, `camera-sandbox.html`, `vendor/`, and `.nojekyll` into `_site`. **`.nojekyll` is required** — without it Jekyll excludes `vendor/`, so Three.js 404s and the game is blank. `configure-pages` runs with `enablement: true`. Pushing to `main` is what updates the live site: <https://pony0278.github.io/Mini-Mage-Mayhem/>. After deploys, a hard refresh is often needed (the HTML carries no-cache meta, but browsers/Pages still cache).
