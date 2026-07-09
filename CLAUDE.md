# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Mini Mage Mayhem — a single-player, web, top-down magic roguelike (4 elements, fusions, elemental reactions, enemy waves, a boss). No framework, no bundler, no npm for the game itself; runtime deps are Three.js (vendored at `vendor/three.min.js`, r149 UMD global `THREE`) plus **build-free ES modules under `js/`**. The HTML files load the game via `<script type="module">` and `import` from `js/`.

The game JS now lives in **`js/` ES modules** (build-free); the three HTML files are thin shells that load them. **There is no duplicated game code anymore — edit the modules, not the HTML.** History/rationale of the split: `docs/module-boundaries.md`. **Before modifying `js/` modules, read `js/CLAUDE.md`** (auto-loads when touching `js/*`) — the runtime maintenance manual: module map (v2 systems/render/actor families), invariants, the v2 step() order, headless-test patterns (incl. the rAF-throttle gotcha), task recipes; no need to sweep-read the sources.

- `js/constants.js` — `W/H/TILE/COLS/ROWS` + `TILE_*` enum.
- `js/utils.js` — pure helpers (`rnd/clamp/dist/angleTo/norm/circleRectOverlap`).
- `js/data.js` — pure data + classifiers (`ELEMENT_INFO`, `arenaTemplates`, `fusionKind`, `isX­Kind`).
- `js/state.js` — the shared mutable singletons: `game` (session state), `keys`, `mouse`, `CAM` (`CAM` parked here transitionally; moves to render after the intent adapter, step 3.5).
- `js/sim.js` — the **simulation core**: `game` mutation + all logic (spells/enemies/zones/reactions/player/dash/secondary/props), `upgradePool`/`SECONDARY`, `update(dt)`. Imports only constants/utils/data/state — never render/input. (Still reads `CAM`/`mouse`/`keys`; the intent adapter, step 3.5, will make it fully headless.)
- `js/render.js` — the **render facade**: external code (main.js/v2*/panels) imports ONLY from here; it owns `render3D()` orchestration + re-exports the public API. Implementation lives in the render family — `render-core.js` (renderer/scene/camera/lights/geo+material caches/`project`/mouse raycast/shared display flags) → `render-world.js` (floor baking/islands/walls/wall-fade) / `render-actors.js` (player + enemy voxel models + procedural animation; the v2 brawler delegates to `actor-brawler.js` — skeleton ported from the user's PUNCH STUDIO pose editor; `BRAWLER_SPEC` for the model, and moves are PUNCH STUDIO JSON exports pasted into `brawler-clips.js` CLIPS (impact frames must stay aligned with `STRIKE_DELAY` in v2-state: damage lands on the impact frame)) / `render-entities.js` (props/projectiles/zones/particles/ground markers) / `render-hud.js` (single-player 2D HUD; v2's HUD is `v2-hud.js`) / `render-lab.js` (v2-only lab arena — ACES/emissive pipeline profile + prop builders + `LAB_LAYOUT` arrangement table; `?fx=low` disables shadows/deco-lights/transmission for SwiftShader tests & low-end). Imports sim only for HUD presentation helpers (`render → sim`, never reverse). Boundaries: `docs/render-module-boundaries.md`.
- `js/main.js` — app glue: input handlers + main loop + boot. Shared by all three shells.
- `js/camera-panel.js`, `js/training-panel.js` — page-specific add-ons (camera-tuning sliders / sandbox test panel).
- `js/v2*.js` — the **v2 mode** (魔法事故報告 · 收容測試, loaded by `v2.html` only): `v2-state` (all tuning consts + shared mutable state incl. the `v2s` scalar container) → `v2-terrain` / `v2-report` → `v2-combat` → `v2-items`; `v2-hud` (2D overlay); `v2.js` is the glue (input + step loop + boot + `window.__v2` test hook); `v2-tuning.js` is the opt-in `?tune=1` panel. Boundaries + invariants: `docs/v2-module-boundaries.md`. v2 never touches the single-player DAG.
- `index.html` — the game (site root). Loads `js/main.js`.
- `camera-sandbox.html` — game + camera panel. Loads `main.js` + `camera-panel.js`.
- `training.html` — repo-only test arena (spawn enemies/props, switch builds; `window.__game` debug hook). Loads `main.js` + `training-panel.js`.
- `vendor/three.min.js` — vendored Three.js. CDNs are blocked by the egress proxy; the npm registry is allowed, so re-vendor via `npm i three@0.149.0` and copy `build/three.min.js`.
- `tools/` — the user's dev tools (repo-only, CDN deps, open in a normal browser): `punch-studio.html` pose/keyframe editor (JSON exports are the source format for `js/brawler-clips.js` CLIPS) and `mesh-part-extractor.html` (splits a whole third-party model into parts; its 「匯出規範 GLB」 re-bases each part to the socket convention so punch-studio can mount it). Pipeline + rules: `docs/animation-workflow.md`, `docs/part-authoring.md`. punch-studio's JS lives in **`tools/ps/*.js`** — classic scripts (NOT ES modules) sharing one global scope, loaded in order by the HTML; the one rule (per-file hoisting: load-time code must not forward-call later files) is in `tools/ps/README.md`. **Before modifying punch-studio, read `tools/ps/CLAUDE.md`** (auto-loads when touching `tools/ps/*`) — the maintenance manual: file map, cross-file contracts, gotchas, task recipes, headless-test pattern; no need to sweep-read the sources.
- `assets/` — GLB modeling assets (repo-only, not deployed): `raw/` whole third-party source models, `parts/` extracted single-part GLBs (plain exports — still need a 「匯出規範 GLB」 pass through the extractor before mounting in punch-studio). See `assets/README.md`.
- `docs/` — design + roadmap docs (repo-only, not deployed). Start at `docs/README.md`; `docs/roadmap.md` holds the A/B/C direction decision; `docs/module-boundaries.md` documents the module split.

> **Module DAG (acyclic):** `constants` → `utils`/`data` → `state` → `sim` → `render` → `main`/panels. Invariant: **`sim.js` must not import render/input/main** (keeps the sim headless-extractable for the BR path).

## No build / test / lint

There is no build, test, or lint tooling. To sanity-check a change, run Node's syntax checker on the modules (they're ESM — copy to `.mjs` so `node --check` treats them as modules):

```bash
for f in js/*.js; do cp "$f" /tmp/_chk.mjs && node --check /tmp/_chk.mjs || echo "FAIL $f"; done
```

To actually *see* a change, render it headlessly with Puppeteer. **WebGL needs SwiftShader flags** — without them `WebGLRenderer` throws and the page is blank:

```
--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox
```

**`tools/` 也能 headless 測**(它們吃 CDN,而 egress 擋 CDN):puppeteer `setRequestInterception` 把 `unpkg.com/three@0.160.0/...` 改餵本地 `npm i three-160@npm:three@0.160.0` 的檔案(**記得帶 `access-control-allow-origin: *`,跨源模組必需**);抽取器有 `window.__mpe` 健檢 hook(比照 `__v2`),測試模型可在頁內用 GLTFExporter 產生(開口圓柱=有接縫環,可測規範匯出)。範本:scratchpad 的 `mpe_health.mjs`。

**ES modules do not load over `file://`** (browser CORS) — serve locally first: `python3 -m http.server 8099` then point Puppeteer at `http://localhost:8099/index.html`. The egress proxy blocks `github.io` and CDNs, so you cannot load the live Pages URL headlessly — test the local server instead.

## Editing the files

Edit the `js/` modules directly (the HTML shells are tiny now). `sim.js` (~2600 lines) and `render.js` (~1100) are large; small edits use the Edit tool, **large structural moves via a Python splice script** (read → `str.index`/`replace`/line-slice between stable anchors → write), because exact-match edits over big blocks are fragile (watch for `\u`/`\n` escapes and full-width punctuation in the Chinese UI strings). Each guarded splice should assert its anchor matches exactly once.

## Architecture

### Simulation vs. rendering split
The game **logic** runs on a flat 2D plane in pixel units: `W=960, H=640, TILE=32`, world coordinates `(x, y)` where `y` is depth. All gameplay (movement, collisions, elements, reactions, waves, boss) operates on this plane and is rendering-agnostic. This matters: the planned battle-royale path (see `docs/`) extracts this logic as a headless sim, and the 3D/art layer is irrelevant to it.

- `game` (exported from `js/state.js`) is the single mutable state object (player, enemies, projectiles, zones, particles, stats, map, run, wave/boss flags). Modules share it via live-binding `import` — only ever mutated in place, never reassigned.
- `update(dt)` (`sim.js`) advances the simulation; `draw()` (`render.js`) renders; `loop(now)` (`main.js`) ties them together with `requestAnimationFrame`.
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

## Deploy (Vercel — private repo, static site)

The repo is **private**, so it deploys on **Vercel** (GitHub Pages free tier does not serve private repos). Pure static, **no build step** — Vercel serves the repo root; committing to `main` auto-deploys. `vercel.json` sets `cleanUrls` (so `/v2.html` → `/v2`, `/tools/punch-studio.html` → `/tools/punch-studio`) and cache headers (`/js/*` no-cache so a deploy never serves stale modules — the old Pages hard-refresh pain; `/vendor/*` long cache). **Every reference is relative** (`vendor/…`, `js/…`, `./x.js`) so root-path serving needs zero path changes; the shells' clean URLs all resolve their relative assets against `/`. After deploys a hard refresh may still be needed (HTML carries no-cache meta; the build tag bottom-right confirms a fresh load).

> History: previously GitHub Pages served the `main` root (needed `.nojekyll` to stop Jekyll excluding `js/`/`vendor/`). `.github/workflows/deploy-pages.yml` remains as a disabled Pages alternative. Migrated to Vercel when the repo went private (protects `docs/` + `tools/` + git history; the client-side game code is always visible in-browser regardless).

### Portal submission build (CrazyGames/Poki) — the ONLY npm in the repo

Vercel is the **dev** deploy (raw modules, no build). Submitting v2 to a web-game portal is a separate, throwaway artifact: `cd build && npm run build` bundles `js/v2.js`'s whole import tree (esbuild, THREE stays an external global, `v2-tuning` dropped) and obfuscates it (javascript-obfuscator: control-flow flattening / string-array / self-defending / debug-protection) → `dist/` (`index.html` + `game.min.js` + `vendor/`). **`build/` is the only place with npm — the game itself stays build-free.** `build/node_modules` + `dist/` are gitignored. Strategy (why JS not Godot/WASM; threat model; domain-lock belongs to the platform SDK not a DIY hostname check): `docs/publishing.md`. Tool + boundaries: `build/README.md`.
