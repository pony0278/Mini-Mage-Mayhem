// render-world.js — 場地視覺 (docs/render-module-boundaries.md):地板紋理烘焙(含富材質)、
// 格子浮島+海、自由浮島+吊橋、牆體+穿牆淡出、裝飾。islandMode/freeIslands 只在本檔寫入。
// Phase 3 房間化場地動這裡。外部請走 render.js 門面。
import { W, H, TILE, COLS, ROWS, TILE_FLOOR, TILE_WALL, TILE_THIN, TILE_GRASS, TILE_BURNT, TILE_WATER, TILE_ICE, TILE_ICEWALL, TILE_OIL, TILE_VOID } from './constants.js';
import { rnd, clamp } from './utils.js';
import { game } from './state.js';
import { scene, camera, ART, boxGeo, octaGeo, cylGeo, coneGeo, matLambert, makeBox, colorHex, tmpMat } from './render-core.js';

  // --- ground (tilemap drawn to a texture on a flat plane) ---
  const groundCanvas = document.createElement('canvas');
  groundCanvas.width = COLS * 16; groundCanvas.height = ROWS * 16;
  const gtx = groundCanvas.getContext('2d');
  const groundTex = new THREE.CanvasTexture(groundCanvas);
  groundTex.magFilter = THREE.NearestFilter;
  groundTex.minFilter = THREE.NearestFilter;
  const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: groundTex }));
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.set(W / 2, 0, H / 2);
  scene.add(groundMesh);

  // --- floating-island mode (v2 arenas): the playable floor is a thick slab above open air;
  // VOID tiles render as transparent gaps (see sky/sea), and the slab's rim shows cliff faces, so
  // being knocked off an edge reads as falling into the abyss. Scoped behind a flag — single-player
  // (index.html) keeps the full opaque ground plane + dark void pits. Toggled via setIslandMode().
  export let islandMode = false;
  // Floor prominence (live-tunable): grid-line alpha, decorative motes on/off, and the tile colours. Dialing
  // these down keeps the eye on actors/hazards instead of the tiling. v2-only; single-player floor unchanged.
  let floorGridAlpha = 0.36, floorMotes = true, floorAO = false;
  // Rich floor: detailed stone/metal slab material (per-tile brightness variation, noise, scratches, recessed
  // grout bevel, cool edge highlights). The v2 floor is static, so it's BAKED ONCE (floorBaked) at higher
  // resolution instead of redrawn per frame. v2-only; single-player keeps the animated 16px checkerboard.
  let richFloor = false, floorBaked = false, floorPx = 16;
  export function setRichFloor(on) {
    richFloor = on; floorBaked = false; floorPx = on ? 32 : 16;
    groundCanvas.width = COLS * floorPx; groundCanvas.height = ROWS * floorPx;
    groundTex.magFilter = groundTex.minFilter = on ? THREE.LinearFilter : THREE.NearestFilter;
    groundTex.needsUpdate = true;
  }
  export function setFloorParams(o = {}) {
    if (o.gridAlpha !== undefined) floorGridAlpha = o.gridAlpha;
    if (o.motes !== undefined) floorMotes = o.motes;
    if (o.ao !== undefined) floorAO = o.ao;         // 牆底暗角(floor darkens where it meets a wall)
    if (o.floorA) ART.floorA = o.floorA;
    if (o.floorB) ART.floorB = o.floorB;
    if (o.floorEdge) ART.floorEdge = o.floorEdge;
    floorBaked = false;                             // re-bake the rich floor on any colour/param change
  }
  export function getFloorParams() { return { gridAlpha: floorGridAlpha, motes: floorMotes, floorA: ART.floorA, floorB: ART.floorB, floorEdge: ART.floorEdge }; }
  export function setFloorSubtle(on) { setFloorParams({ gridAlpha: on ? 0.1 : 0.36, motes: !on }); } // preset used at v2 boot
  // v2 art-pass toggles (render-only; single-player unaffected because these default off / lists stay empty)
  const islandGroup = new THREE.Group(); scene.add(islandGroup);
  // Warm, terraced cliff (stacked layers flaring outward downward) — evokes the layered-rock island
  // look instead of a flat grey wall. Three shades = sunlit rock → mid → shaded base.
  const TAU2 = Math.PI * 2;
  const cliffMats = [
    new THREE.MeshLambertMaterial({ color: 0xb07a44 }),
    new THREE.MeshLambertMaterial({ color: 0x8f5f34 }),
    new THREE.MeshLambertMaterial({ color: 0x6d4827 }),
  ];
  const CLIFF_LAYERS = [{ top: 0, h: 24, grow: 1.0 }, { top: -24, h: 26, grow: 1.2 }, { top: -50, h: 34, grow: 1.44 }];
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x9a969c });
  const archMat = new THREE.MeshLambertMaterial({ color: 0xa8a4ab });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x4fae40 });
  let islandSig = '';
  function addRockMesh(g, x, z, r) {
    const m = new THREE.Mesh(octaGeo, rockMat); m.scale.set(r, r * 0.78, r);
    m.position.set(x, r * 0.62, z); m.rotation.y = x * 0.13 + z * 0.07; g.add(m);
  }
  function addPlantMesh(g, x, z, s) { // a little fan of upright leaves
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * TAU2, leaf = new THREE.Mesh(boxGeo, leafMat);
      leaf.scale.set(2.4 * s, 13 * s, 2.4 * s);
      leaf.position.set(x + Math.cos(a) * 3.4 * s, 6 * s, z + Math.sin(a) * 3.4 * s);
      leaf.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); g.add(leaf);
    }
  }
  function addArchMesh(g, x, z, s) { // a ruined stone arch — the island landmark
    const pL = new THREE.Mesh(boxGeo, archMat); pL.scale.set(8 * s, 46 * s, 8 * s); pL.position.set(x - 15 * s, 23 * s, z); g.add(pL);
    const pR = new THREE.Mesh(boxGeo, archMat); pR.scale.set(8 * s, 46 * s, 8 * s); pR.position.set(x + 15 * s, 23 * s, z); g.add(pR);
    const top = new THREE.Mesh(boxGeo, archMat); top.scale.set(46 * s, 9 * s, 9 * s); top.position.set(x, 48 * s, z); g.add(top);
  }
  export function syncIsland() {
    let sig = '';
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (game.map[y][x] === TILE_VOID) sig += x + '.' + y + ';';
    if (sig === islandSig) return;
    islandSig = sig;
    islandGroup.clear();
    let minGrassY = ROWS, backXs = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = game.map[y][x];
      if (t === TILE_VOID) continue;
      const cx = x * TILE + TILE / 2, cz = y * TILE + TILE / 2;
      const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || game.map[ny][nx] === TILE_VOID;
      });
      if (rim) { // terraced cliff under any tile bordering the abyss
        for (let li = 0; li < CLIFF_LAYERS.length; li++) {
          const L = CLIFF_LAYERS[li], s = TILE * L.grow;
          const body = new THREE.Mesh(boxGeo, cliffMats[li]);
          body.scale.set(s, L.h, s);
          body.position.set(cx, L.top - L.h / 2, cz);
          islandGroup.add(body);
        }
      }
      if (t === TILE_GRASS) { // sparse, deterministic decor on interior grass
        const hsh = (x * 73856093 ^ y * 19349663) >>> 0;
        if (!rim) {
          if (hsh % 17 === 0) addRockMesh(islandGroup, cx, cz, 7 + (hsh % 5));
          else if (hsh % 13 === 0) addPlantMesh(islandGroup, cx, cz, 1);
        }
        if (y < minGrassY) { minGrassY = y; backXs = [cx]; }
        else if (y === minGrassY) backXs.push(cx);
      }
    }
    if (backXs.length) { // arch landmark on the back-most island
      const ax = backXs.reduce((a, b) => a + b, 0) / backXs.length;
      addArchMesh(islandGroup, ax, (minGrassY + 1) * TILE, 1);
    }
  }
  let seaMesh = null;
  function ensureSea() {
    if (seaMesh) return;
    seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshLambertMaterial({ color: 0x1d4f6b }));
    seaMesh.rotation.x = -Math.PI / 2; seaMesh.position.set(W / 2, -230, H / 2); seaMesh.visible = false;
    scene.add(seaMesh);
  }
  ensureSea();
  export function setIslandMode(on) {
    islandMode = on;
    seaMesh.visible = on;
    islandGroup.visible = on;
    decorGroup.visible = !on;            // toybox vials sit at fixed spots that may now be over the abyss
    groundMesh.material.transparent = on;
    groundMesh.material.alphaTest = on ? 0.5 : 0; // discard the transparent VOID texels → see sky/sea through the gaps
    groundMesh.material.needsUpdate = true;
    if (on) { scene.background = new THREE.Color(0x3a5a7e); scene.fog = new THREE.Fog(0x3a5a7e, 700, 1900); }
    else { scene.background = new THREE.Color(0x100e18); scene.fog = new THREE.Fog(0x100e18, 820, 1580); }
    islandSig = ''; // force slab rebuild on next render
    drawGroundTexture();
  }

  // === Free-form round islands (v2 experiment, docs/v2-spec-D) — organic floating islands as real
  // meshes (lathe rock body + grass cap + rope bridges), instead of the tile-grid slab. Driven by an
  // explicit shape list from v2; gameplay collision (overVoid) uses matching disc/segment geometry there. ===
  export let freeIslands = null;
  const freeGroup = new THREE.Group(); scene.add(freeGroup);
  const freeRockMat = new THREE.MeshLambertMaterial({ color: 0x8a6a44, flatShading: true });
  const freeGrassMat = new THREE.MeshLambertMaterial({ color: 0x6fbb3c, flatShading: true });
  const freeWoodMat = new THREE.MeshLambertMaterial({ color: 0x9c6f3e });
  const freeRopeMat = new THREE.MeshLambertMaterial({ color: 0xcaa35e });
  const freePostMat = new THREE.MeshLambertMaterial({ color: 0x7a5630 });
  function buildFreeIsland(I) {
    const R = I.r, depth = I.depth || I.r * 1.45, cx = I.x, cz = I.z;
    const pts = [
      new THREE.Vector2(0.02, -depth),
      new THREE.Vector2(R * 0.42, -depth * 0.66),
      new THREE.Vector2(R * 0.82, -depth * 0.34),
      new THREE.Vector2(R * 0.99, -depth * 0.12),
      new THREE.Vector2(R, 0),
    ];
    const bodyGeo = new THREE.LatheGeometry(pts, 13);
    const pos = bodyGeo.attributes.position; // mild radial wobble → organic, not a clean cone
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), rr = Math.hypot(x, z);
      if (rr > 0.5) { const f = 1 + Math.sin(x * 0.7 + z * 1.1) * 0.05; pos.setX(i, x * f); pos.setZ(i, z * f); }
    }
    bodyGeo.computeVertexNormals();
    const body = new THREE.Mesh(bodyGeo, freeRockMat); body.position.set(cx, 0, cz); freeGroup.add(body);
    // FLAT grass top at the walkable plane (y≈0) — a raised dome would bury fighters (who stand at y0)
    // toward the island centre. Keep the surface flush so characters sit cleanly on top.
    const cap = new THREE.Mesh(new THREE.CircleGeometry(R, 13), freeGrassMat);
    cap.rotation.x = -Math.PI / 2; cap.position.set(cx, 1, cz); freeGroup.add(cap);
    addRockMesh(freeGroup, cx - R * 0.5, cz - R * 0.35, 7);
    addRockMesh(freeGroup, cx + R * 0.45, cz + R * 0.3, 6);
    addPlantMesh(freeGroup, cx - R * 0.3, cz + R * 0.45, 1);
    addPlantMesh(freeGroup, cx + R * 0.35, cz - R * 0.4, 1);
  }
  function buildRopeBridge(B) {
    const ax = B.ax, az = B.az, bx = B.bx, bz = B.bz, w = B.w || 26;
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
    const sag = Math.min(40, len * 0.12), seg = Math.max(8, Math.round(len / 14));
    const P = (t, side, lift) => new THREE.Vector3(ax + dx * t + nx * side * w * 0.5, -Math.sin(t * Math.PI) * sag + (lift || 0), az + dz * t + nz * side * w * 0.5);
    for (let i = 0; i < seg; i++) { // planks
      const c = P((i + 0.5) / seg, 0, 0), plank = new THREE.Mesh(boxGeo, freeWoodMat);
      plank.scale.set(w, 3, len / seg * 0.82); plank.position.copy(c); plank.rotation.y = Math.atan2(dx, dz); freeGroup.add(plank);
    }
    for (const side of [1, -1]) for (let i = 0; i < seg; i++) { // rope rails
      const a = P(i / seg, side, 18), b = P((i + 1) / seg, side, 18), mid = a.clone().add(b).multiplyScalar(0.5);
      const rope = new THREE.Mesh(boxGeo, freeRopeMat); rope.scale.set(2.5, 2.5, a.distanceTo(b)); rope.position.copy(mid); rope.lookAt(b); freeGroup.add(rope);
    }
    for (const t of [0, 1]) for (const side of [1, -1]) { // end posts
      const p = P(t, side, 0), post = new THREE.Mesh(boxGeo, freePostMat); post.scale.set(4, 22, 4); post.position.set(p.x, 11, p.z); freeGroup.add(post);
    }
  }
  export function setIslandShapes(islands, bridges) {
    freeIslands = islands;
    freeGroup.clear();
    groundMesh.visible = false; islandGroup.visible = false; decorGroup.visible = false;
    ensureSea(); seaMesh.visible = true;
    scene.background = new THREE.Color(0x86cdf2); scene.fog = new THREE.Fog(0x86cdf2, 1100, 3200);
    for (const I of islands) buildFreeIsland(I);
    for (const B of (bridges || [])) buildRopeBridge(B);
  }

  function tileNoise(x, y) { return ((x * 1103515245 + y * 12345 + 97) >>> 0) % 1000 / 1000; }

  // deterministic per-tile hash (stable → the baked floor doesn't shimmer)
  const h2 = (x, y, k) => { const n = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return n - Math.floor(n); };
  // one rich floor slab: brightness variation + matte noise + soft scratches + recessed grout bevel + cool edge lip
  function drawRichFloorTile(px, py, s, x, y) {
    const b = h2(x, y, 1); // per-tile brightness variation
    gtx.fillStyle = b > 0.5 ? `rgba(210,220,255,${((b - 0.5) * 0.12).toFixed(3)})` : `rgba(0,0,0,${((0.5 - b) * 0.20).toFixed(3)})`;
    gtx.fillRect(px, py, s, s);
    const specks = Math.round(s * 0.5); // fine matte noise
    for (let i = 0; i < specks; i++) {
      const nx = px + (h2(x * 3.1 + i, y * 1.7, 2) * s | 0), ny = py + (h2(x * 1.3, y * 2.9 + i, 3) * s | 0);
      gtx.fillStyle = h2(i + x, y - i, 4) > 0.6 ? 'rgba(190,200,235,0.06)' : 'rgba(0,0,0,0.10)';
      gtx.fillRect(nx, ny, 1, 1);
    }
    if (h2(x, y, 5) > 0.68) { // soft scratch on ~30% of tiles
      gtx.strokeStyle = 'rgba(200,210,245,0.08)'; gtx.lineWidth = 1;
      const sx = px + h2(x, y, 6) * s * 0.7 + s * 0.15, sy = py + h2(x, y, 7) * s * 0.7 + s * 0.15;
      const ang = h2(x, y, 8) * Math.PI, len = s * (0.25 + h2(x, y, 9) * 0.4);
      gtx.beginPath(); gtx.moveTo(sx, sy); gtx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len); gtx.stroke();
    }
    // recessed grout: dark inner groove + low-brightness purple grout line on the boundary
    gtx.strokeStyle = 'rgba(20,16,34,0.55)'; gtx.lineWidth = 1; gtx.strokeRect(px + 2.5, py + 2.5, s - 5, s - 5);
    gtx.strokeStyle = ART.floorEdge; gtx.globalAlpha = Math.min(1, floorGridAlpha + 0.06);
    gtx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1); gtx.globalAlpha = 1;
    // faint cool highlight on the top+left lip (light catching the raised slab)
    gtx.strokeStyle = 'rgba(150,180,235,0.12)'; gtx.lineWidth = 1;
    gtx.beginPath(); gtx.moveTo(px + 2.5, py + s - 3.5); gtx.lineTo(px + 2.5, py + 2.5); gtx.lineTo(px + s - 3.5, py + 2.5); gtx.stroke();
  }
  export function drawGroundTexture() {
    if (richFloor && floorBaked) return; // static rich floor: bake once, then skip the per-frame redraw
    const s = floorPx;
    gtx.clearRect(0, 0, groundCanvas.width, groundCanvas.height);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = game.map[y][x];
      const px = x * s, py = y * s;
      if (islandMode && t === TILE_VOID) continue; // leave the abyss transparent → sky/sea shows through the gap
      let c;
      if (t === TILE_GRASS) c = ART.grass;
      else if (t === TILE_BURNT) c = ART.burnt;
      else if (t === TILE_WATER) c = ART.water;
      else if (t === TILE_ICE) c = ART.ice;
      else if (t === TILE_WALL) c = '#2b2630';
      else if (t === TILE_THIN) c = '#43342e';
      else if (t === TILE_ICEWALL) c = '#7fb6c9';
      else if (t === TILE_OIL) c = '#241f17';
      else if (t === TILE_VOID) c = '#05040a';
      else c = ((x + y) % 2 === 0) ? ART.floorA : ART.floorB;
      gtx.fillStyle = c;
      gtx.fillRect(px, py, s, s);
      if (t === TILE_VOID) { gtx.fillStyle = '#000'; gtx.fillRect(px + 1, py + 1, s - 2, s - 2); } // 空洞:暗坑
      if (t === TILE_FLOOR && richFloor) {
        drawRichFloorTile(px, py, s, x, y);
      } else if (t === TILE_FLOOR) {
        gtx.strokeStyle = ART.floorEdge;
        gtx.globalAlpha = floorGridAlpha; // live-tunable grid prominence
        gtx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
        gtx.globalAlpha = 1;
        if (floorMotes && (x * 7 + y * 11) % 23 === 0) { // decorative pink floor motes (off in subtle mode)
          gtx.strokeStyle = 'rgba(174,116,255,.42)';
          gtx.lineWidth = 1;
          gtx.beginPath();
          gtx.moveTo(px + 5, py + 5); gtx.lineTo(px + 11, py + 5); gtx.lineTo(px + 8, py + 11); gtx.closePath(); gtx.stroke();
        }
      } else if (t === TILE_GRASS) {
        gtx.fillStyle = ART.grassHi;
        for (let i = 0; i < 5; i++) {
          const ox = 2 + ((x * 5 + y * 3 + i * 4) % 12);
          const oy = 3 + ((x * 2 + y * 7 + i * 5) % 10);
          gtx.fillRect(px + ox, py + oy, 1.5, 5);
        }
      } else if (t === TILE_BURNT) {
        gtx.fillStyle = 'rgba(255,118,55,.20)';
        gtx.fillRect(px + 3, py + 4, s - 6, 2);
        gtx.fillStyle = 'rgba(0,0,0,.35)';
        gtx.fillRect(px + 4, py + 8, s - 8, 3);
      } else if (t === TILE_WATER) {
        gtx.fillStyle = 'rgba(122,224,255,.30)';
        gtx.beginPath();
        gtx.ellipse(px + 8, py + 8, 6, 3 + Math.sin(game.time * 2 + x) * 1.1, 0, 0, Math.PI * 2);
        gtx.fill();
        gtx.strokeStyle = 'rgba(173,245,255,.28)';
        gtx.beginPath(); gtx.moveTo(px + 2, py + 5); gtx.lineTo(px + 14, py + 4); gtx.stroke();
      } else if (t === TILE_ICE) {
        gtx.fillStyle = 'rgba(255,255,255,.46)';
        gtx.fillRect(px + 2, py + 2, 12, 4);
        gtx.strokeStyle = 'rgba(73,148,180,.55)';
        gtx.beginPath();
        gtx.moveTo(px + 4, py + 5); gtx.lineTo(px + 12, py + 11);
        gtx.moveTo(px + 12, py + 4); gtx.lineTo(px + 5, py + 12);
        gtx.stroke();
      } else if (t === TILE_WALL || t === TILE_THIN) {
        gtx.strokeStyle = 'rgba(255,211,109,.18)';
        gtx.strokeRect(px + 2, py + 2, s - 4, s - 4);
      }
      // 牆底暗角:darken the floor where it meets a wall, for grounded depth (a cheap ambient-occlusion lip)
      if (floorAO && t !== TILE_WALL && t !== TILE_THIN && t !== TILE_ICEWALL && t !== TILE_VOID) {
        const isWall = (xx, yy) => { const r = game.map[yy]; const tt = r && r[xx]; return tt === TILE_WALL || tt === TILE_THIN || tt === TILE_ICEWALL; };
        const w = 6; gtx.fillStyle = 'rgba(0,0,0,.42)';
        if (isWall(x, y - 1)) gtx.fillRect(px, py, s, w);
        if (isWall(x, y + 1)) gtx.fillRect(px, py + s - w, s, w);
        if (isWall(x - 1, y)) gtx.fillRect(px, py, w, s);
        if (isWall(x + 1, y)) gtx.fillRect(px + s - w, py, w, s);
      }
    }
    groundTex.needsUpdate = true;
    if (richFloor) floorBaked = true; // baked; drawGroundTexture will early-return until a param/map change
  }
  // --- raised walls (rebuilt only when the tile map changes) ---
  const wallGroup = new THREE.Group(); scene.add(wallGroup);
  const wallMat = new THREE.MeshLambertMaterial({ color: ART.wall });
  const wallTopMat = new THREE.MeshLambertMaterial({ color: ART.wallTop });
  const thinMat = new THREE.MeshLambertMaterial({ color: ART.thin });
  const thinTopMat = new THREE.MeshLambertMaterial({ color: ART.thinTop });
  const iceWallMat = new THREE.MeshLambertMaterial({ color: 0x9fdcef, transparent: true, opacity: 0.8 });
  const iceWallTopMat = new THREE.MeshLambertMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.88 });
  const wallBodyMat = (t) => t === TILE_WALL ? wallMat : (t === TILE_ICEWALL ? iceWallMat : thinMat);
  const wallCapMat = (t) => t === TILE_WALL ? wallTopMat : (t === TILE_ICEWALL ? iceWallTopMat : thinTopMat);
  // --- camera occlusion fade (see-through walls) : any wall between the camera and the followed character
  // turns translucent so it never hides them. Collision is untouched — this is render-only (the wall is still
  // physically there). Standard trick for 3/4 cameras (GetAmped-style). Enable via setWallFade(true).
  // Each wall tile is registered as a "fade unit" (its body+cap+rune materials, cloned so they fade independently).
  let wallFade = false, wallDirty = false;
  export function setWallFade(on) { if (on !== wallFade) { wallFade = on; wallDirty = true; } } // rebuild walls on toggle
  const _wallUnits = [];        // { mats:[…], op, target } — only populated when wallFade is on
  const _wallObjs = [];         // flat list of meshes to raycast (each carries userData.unit)
  const _ray = new THREE.Raycaster();
  const _rayDir = new THREE.Vector3();
  const WALL_FADE_OP = 0.16;    // how see-through an occluding wall gets
  let wallSig = '';
  export function syncWalls() {
    let sig = '';
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = game.map[y][x];
      if (t === TILE_WALL || t === TILE_THIN || t === TILE_ICEWALL) sig += x + '.' + y + '.' + t + ';';
    }
    if (sig === wallSig && !wallDirty) return;
    wallSig = sig; wallDirty = false;
    wallGroup.clear(); _wallUnits.length = 0; _wallObjs.length = 0;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = game.map[y][x];
      if (t !== TILE_WALL && t !== TILE_THIN && t !== TILE_ICEWALL) continue;
      const h = t === TILE_WALL ? 48 : (t === TILE_ICEWALL ? 34 : 30);
      // wallFade on → per-tile cloned transparent materials + a fade unit; off → original shared opaque materials
      // (keeps single-player / isles walls untouched: no transparent pass, no extra draw calls).
      const unit = wallFade ? { mats: [], op: 1, target: 1 } : null;
      const bodyMat = wallFade ? (() => { const m = wallBodyMat(t).clone(); m.transparent = true; unit.mats.push(m); return m; })() : wallBodyMat(t);
      const capMat = wallFade ? (() => { const m = wallCapMat(t).clone(); m.transparent = true; unit.mats.push(m); return m; })() : wallCapMat(t);
      const body = new THREE.Mesh(boxGeo, bodyMat);
      body.scale.set(TILE, h, TILE);
      body.position.set(x * TILE + TILE / 2, h / 2, y * TILE + TILE / 2);
      wallGroup.add(body);
      const cap = new THREE.Mesh(boxGeo, capMat);
      cap.scale.set(TILE * 0.94, 4, TILE * 0.94);
      cap.position.set(x * TILE + TILE / 2, h + 2, y * TILE + TILE / 2);
      wallGroup.add(cap);
      if (unit) { body.userData.unit = unit; cap.userData.unit = unit; _wallObjs.push(body, cap); }
      if ((x + y) % 5 === 0) {
        const runeMat = matLambert(0x9b6cff, 0x9b6cff, 0.7);
        if (unit) { runeMat.transparent = true; unit.mats.push(runeMat); }
        const rune = new THREE.Mesh(boxGeo, runeMat);
        rune.scale.set(5, 1.2, 5);
        rune.position.set(x * TILE + TILE / 2, h + 4.5, y * TILE + TILE / 2);
        wallGroup.add(rune);
        if (unit) { rune.userData.unit = unit; _wallObjs.push(rune); }
      }
      if (unit) _wallUnits.push(unit);
    }
  }
  // cast a few rays from the camera to points across the character silhouette; fade every wall unit any ray passes
  // through (so a wall grazing the character's edge still clears), then ease each unit's opacity toward its target.
  // [xOffset, height] samples across the character silhouette — a wide-enough fan that the faded window
  // comfortably clears the body (a 1-tile-wide window would only reveal a sliver of it).
  const _fadeSamples = [[0, 12], [0, 30], [0, 46], [-22, 22], [22, 22], [-40, 20], [40, 20]];
  export function updateWallFade() {
    for (const u of _wallUnits) u.target = 1;
    // aim at the ACTUAL character (game.occludeTarget), not game.camTarget — the latter may be a smoothed/
    // clamped camera rig whose position sits short of the player, so rays to it fly over low walls.
    const tgt = game.occludeTarget || game.camTarget;
    if (wallFade && tgt && _wallObjs.length) {
      wallGroup.updateMatrixWorld(true); // ensure wall world matrices are current for raycasting
      for (const [ox, hy] of _fadeSamples) {
        _rayDir.set(tgt.x + ox - camera.position.x, hy - camera.position.y, tgt.y - camera.position.z);
        const len = _rayDir.length() || 1; _rayDir.multiplyScalar(1 / len);
        _ray.set(camera.position, _rayDir); _ray.far = len - 8; // stop just short of the character
        const hits = _ray.intersectObjects(_wallObjs, false);
        for (const hh of hits) { const u = hh.object.userData.unit; if (u) u.target = WALL_FADE_OP; }
      }
    }
    for (const u of _wallUnits) {
      if (Math.abs(u.op - u.target) < 0.012) u.op = u.target; else u.op += (u.target - u.op) * 0.22;
      for (const m of u.mats) m.opacity = u.op;
    }
  }

  const decorGroup = new THREE.Group(); scene.add(decorGroup);
  function buildToyboxDecor() {
    decorGroup.clear();
    const spots = [
      {x: 74, z: 70}, {x: W - 82, z: 78}, {x: 86, z: H - 82}, {x: W - 96, z: H - 92},
      {x: 210, z: 84}, {x: W - 216, z: H - 74}
    ];
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const base = makeBox(34, 8, 22, i % 2 ? 0x6f4d33 : 0x3a2d3a); base.position.set(s.x, 4, s.z); decorGroup.add(base);
      const vial = new THREE.Mesh(cylGeo, matLambert(i % 3 === 0 ? 0x7ee7ff : i % 3 === 1 ? 0xd998ff : 0xffbd66, i % 3 === 0 ? 0x7ee7ff : i % 3 === 1 ? 0xd998ff : 0xffbd66, 0.5));
      vial.scale.set(4, 13, 4); vial.position.set(s.x - 8, 17, s.z); decorGroup.add(vial);
      const cork = makeBox(5, 3, 5, 0x7a5535); cork.position.set(s.x - 8, 31, s.z); decorGroup.add(cork);
      const crystal = new THREE.Mesh(octaGeo, matLambert(0x9b6cff, 0x9b6cff, 0.65));
      crystal.scale.set(7, 10, 7); crystal.position.set(s.x + 10, 19, s.z + 2); decorGroup.add(crystal);
    }
  }
  buildToyboxDecor();


// --- lab 場景(render-lab.js 復刻版)用的小開關:藏舊地板 / 舊牆壓暗(正式牆板前的過渡) ---
export function setStockGroundVisible(on) { groundMesh.visible = on; }
export function setStockWallsVisible(on) { wallGroup.visible = on; }
export function setWallDarkTint(on) {
  wallMat.color.setHex(on ? 0x151129 : ART.wall); wallTopMat.color.setHex(on ? 0x1c1636 : ART.wallTop);
  wallDirty = true;
}

// 場外暗色圍裙地板:蓋掉越過牆外看到的純黑虛空(16:9 視野更寬後更明顯)。
// 只在 v2 平台場開(setApron);浮島/單機不開 —— 那裡的黑就是「虛空」本身。
let apronMesh = null;
export function setApron(on, color = 0x0d0b16) {
  if (on && !apronMesh) {
    apronMesh = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshBasicMaterial({ color }));
    apronMesh.rotation.x = -Math.PI / 2; apronMesh.position.set(W / 2, -2, H / 2);
    scene.add(apronMesh);
  } else if (!on && apronMesh) { scene.remove(apronMesh); apronMesh = null; }
  if (apronMesh) apronMesh.material.color.setHex(color);
}
