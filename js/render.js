import { W, H, TILE, COLS, ROWS, TILE_FLOOR, TILE_WALL, TILE_THIN, TILE_GRASS, TILE_BURNT, TILE_WATER, TILE_ICE, TILE_ICEWALL, TILE_OIL, TILE_VOID } from './constants.js';
import { rnd, clamp, dist, angleTo, norm, circleRectOverlap } from './utils.js';
import { ELEMENT_INFO, arenaTemplates, fusionKind, isFireKind, isIceKind, isLightningKind, isPoisonKind, isEarthKind } from './data.js';
import { game, mouse, CAM, touch } from './state.js';
import { TOUCH_BTN, STICK_R } from './touch.js';
import { T } from './strings.js';
import { currentFlowName, dashElement, isMastery, isSecMastery, makeRunStory, nearestLiftable, nearestLiftableWallTile, previewSpellState, spellDescription, upgradeDesc, upgradeName, SECONDARY } from './sim.js';

// 3D (Three.js voxel world) + 2D HUD render layer. Reads game state; owns the
// scene/camera/renderer/ctx and the HUD draw fns. Imports sim only for HUD
// presentation helpers (DAG: render -> sim, never the reverse).
const canvas = document.getElementById('game');
const hud = document.getElementById('hud');
const screenCtx = hud.getContext('2d');
let ctx = screenCtx;

  export function project(wx, wy, wz = 0) {
    const v = _projV.set(wx, wz, wy).project(camera);
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, behind: v.z > 1 };
  }

  // ===================================================================
  //  3D RENDERER (Three.js) — voxel world, fixed 45° follow camera.
  //  Game logic is unchanged; this replaces the old 2D world drawing.
  // ===================================================================
  export const mouseScreen = { x: W / 2, y: H / 2 };
  const _projV = new THREE.Vector3();

  let renderer = null, gl3dOk = false;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.shadowMap.enabled = false;
    gl3dOk = true;
  } catch (err) {
    console.warn('WebGL unavailable:', err);
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x100e18);
  scene.fog = new THREE.Fog(0x100e18, 820, 1580);

  // Tuned in the camera sandbox: telephoto, low diagonal follow cam.
  export const camera = new THREE.PerspectiveCamera(CAM.fov, W / H, 1, 5000);

  const hemi = new THREE.HemisphereLight(0xfff2d2, 0x1c1630, 0.92);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd88a, 1.18);
  sun.position.set(-0.6, 1.25, 0.55);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x7ddcff, 0.42);
  rim.position.set(0.55, 0.6, -0.75);
  scene.add(rim);
  const magicFill = new THREE.PointLight(0xaa72ff, 0.52, 980);
  magicFill.position.set(W / 2, 260, H / 2);
  scene.add(magicFill);

  const ART = {
    ink: '#15101c', parchment: '#f1d8aa', gold: '#ffd36d', violet: '#9b6cff', cyan: '#9fe7ff',
    floorA: '#4b3b45', floorB: '#40313d', floorEdge: '#6a5463', grass: '#416e38', grassHi: '#94df62',
    burnt: '#2a1c18', water: '#1d5771', ice: '#bdf5ff', wall: 0x625563, wallTop: 0x887780,
    thin: 0xa77b4e, thinTop: 0xd1a06a
  };

  // --- shared geometry / material caches ---
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeo = new THREE.SphereGeometry(1, 14, 12);
  const circleGeo = new THREE.CircleGeometry(1, 36);
  const coneGeo = new THREE.ConeGeometry(1, 2, 4);
  const octaGeo = new THREE.OctahedronGeometry(1, 0);
  const tetraGeo = new THREE.TetrahedronGeometry(1, 0);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  const torusGeo = new THREE.TorusGeometry(1, 0.08, 6, 24);
  const colorHex = (s) => {
    if (typeof s === 'number') return s;
    if (!s) return 0xffffff;
    if (s[0] === '#') return parseInt(s.slice(1), 16);
    return 0xffffff;
  };
  const _matCache = new Map();
  const basicMat = (hex) => {
    let m = _matCache.get(hex);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: hex }); _matCache.set(hex, m); }
    return m;
  };
  const lightMat = new THREE.LineBasicMaterial({ color: 0xe5fcff });

  function matLambert(color, emissive = 0x000000, intensity = 0) {
    return new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: intensity });
  }
  function makeBox(w, h, d, color, emissive = 0x000000, intensity = 0) {
    const m = new THREE.Mesh(boxGeo, matLambert(color, emissive, intensity));
    m.scale.set(w, h, d);
    return m;
  }
  function makeGlowSphere(r, color, opacity = 0.32) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const m = new THREE.Mesh(sphereGeo, mat);
    m.scale.setScalar(r);
    return m;
  }
  function tmpMat(color, opacity = 1, additive = false) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    if (additive) mat.blending = THREE.AdditiveBlending;
    mat.__tmp = true;
    return mat;
  }

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
  let islandMode = false;
  // Camera follow vs fixed framing. Default true = follow the controlled player (single-player behaviour).
  // false = lock onto the arena centre (the v2 fixed-diorama framing). Toggled from the camera sandbox.
  let camFollow = true;
  export function setCamFollow(on) { camFollow = on; }
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
  function syncIsland() {
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
  let freeIslands = null;
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

  function drawGroundTexture() {
    const s = 16;
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
      if (t === TILE_FLOOR) {
        gtx.strokeStyle = ART.floorEdge;
        gtx.globalAlpha = 0.36;
        gtx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
        gtx.globalAlpha = 1;
        if ((x * 7 + y * 11) % 23 === 0) {
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
    }
    groundTex.needsUpdate = true;
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
  let wallSig = '';
  function syncWalls() {
    let sig = '';
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = game.map[y][x];
      if (t === TILE_WALL || t === TILE_THIN || t === TILE_ICEWALL) sig += x + '.' + y + '.' + t + ';';
    }
    if (sig === wallSig) return;
    wallSig = sig;
    wallGroup.clear();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const t = game.map[y][x];
      if (t !== TILE_WALL && t !== TILE_THIN && t !== TILE_ICEWALL) continue;
      const h = t === TILE_WALL ? 48 : (t === TILE_ICEWALL ? 34 : 30);
      const body = new THREE.Mesh(boxGeo, wallBodyMat(t));
      body.scale.set(TILE, h, TILE);
      body.position.set(x * TILE + TILE / 2, h / 2, y * TILE + TILE / 2);
      wallGroup.add(body);
      const cap = new THREE.Mesh(boxGeo, wallCapMat(t));
      cap.scale.set(TILE * 0.94, 4, TILE * 0.94);
      cap.position.set(x * TILE + TILE / 2, h + 2, y * TILE + TILE / 2);
      wallGroup.add(cap);
      if ((x + y) % 5 === 0) {
        const rune = new THREE.Mesh(boxGeo, matLambert(0x9b6cff, 0x9b6cff, 0.7));
        rune.scale.set(5, 1.2, 5);
        rune.position.set(x * TILE + TILE / 2, h + 4.5, y * TILE + TILE / 2);
        wallGroup.add(rune);
      }
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

  // --- actor (player + enemy) voxel meshes ---
  const actorMeshes = new Map();
  let playerMesh = null;

  function tintable(group, list, m) { group.add(m); list.push({ mesh: m, base: m.material.color.getHex() }); return m; }

  function buildPlayer() {
    const g = new THREE.Group();
    const shadow = new THREE.Mesh(circleGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.7; shadow.scale.set(17, 11, 1); g.add(shadow);
    const bootL = makeBox(6, 5, 8, 0x1d1826); bootL.position.set(-5, 3, 0); g.add(bootL);
    const bootR = makeBox(6, 5, 8, 0x1d1826); bootR.position.set(5, 3, 0); g.add(bootR);
    const body = makeBox(22, 24, 16, 0x6c45ff, 0x22134a, 0.18); body.position.y = 16; g.add(body);
    const robeGlow = makeBox(24, 4, 17, 0xffd36d, 0xff9a4d, 0.18); robeGlow.position.y = 19; g.add(robeGlow);
    const scarf = makeBox(25, 5, 18, 0xffcc56); scarf.position.y = 27; g.add(scarf);
    const head = makeBox(15, 13, 13, 0xffd7b0); head.position.y = 35; g.add(head);
    const eyeL = makeBox(3, 3.5, 1.2, 0x76e7ff, 0x76e7ff, 0.55); eyeL.position.set(-4, 36, 6.8); g.add(eyeL);
    const eyeR = makeBox(3, 3.5, 1.2, 0x76e7ff, 0x76e7ff, 0.55); eyeR.position.set(4, 36, 6.8); g.add(eyeR);
    const brim = makeBox(34, 5, 30, 0x321b77, 0x160a38, 0.14); brim.position.y = 44; g.add(brim);
    const band = makeBox(25, 4, 23, 0xffc85a, 0xff9a4d, 0.15); band.position.y = 47; g.add(band);
    const hat2 = makeBox(20, 9, 20, 0x4c25bd, 0x160a38, 0.12); hat2.position.y = 53; g.add(hat2);
    const hat3 = makeBox(12, 10, 12, 0x6b35df, 0x260c54, 0.15); hat3.position.y = 63; g.add(hat3);
    const hat4 = makeBox(6, 7, 6, 0x9b6cff, 0x5c35d8, 0.18); hat4.position.y = 72; g.add(hat4);
    const orb = makeGlowSphere(10, 0xffcc56, 0.28); orb.position.y = 78; g.add(orb);
    const orbCore = new THREE.Mesh(octaGeo, matLambert(0xffcc56, 0xffcc56, 0.9)); orbCore.scale.set(5.5, 5.5, 5.5); orbCore.position.y = 78; g.add(orbCore);
    const staff = makeBox(3.2, 48, 3.2, 0x8a5f35); staff.position.set(15, 28, 9); g.add(staff);
    const sOrb = makeGlowSphere(11, 0xffcc56, 0.34); sOrb.position.set(15, 55, 9); g.add(sOrb);
    const sCore = new THREE.Mesh(octaGeo, matLambert(0xffcc56, 0xffcc56, 1)); sCore.scale.set(6.5, 6.5, 6.5); sCore.position.set(15, 55, 9); g.add(sCore);
    const familiar = new THREE.Mesh(octaGeo, matLambert(0x9fe7ff, 0x9fe7ff, 0.75)); familiar.scale.set(7, 7, 7); g.add(familiar);
    // brawler fists (shown only in fist mode; thrust forward when punching)
    const armL = makeBox(8, 8, 11, 0xffd7b0); armL.position.set(-13, 22, 6); armL.visible = false; g.add(armL);
    const armR = makeBox(8, 8, 11, 0xffd7b0); armR.position.set(13, 22, 6); armR.visible = false; g.add(armR);
    g.userData.orb = orb; g.userData.orbCore = orbCore; g.userData.sOrb = sOrb; g.userData.sCore = sCore; g.userData.familiar = familiar;
    g.userData.armL = armL; g.userData.armR = armR;
    g.userData.armLBase = armL.position.clone(); g.userData.armRBase = armR.position.clone();
    return g;
  }
  function updatePlayerMesh() {
    const p = game.player;
    playerMesh.position.set(p.x, 0, p.y);
    playerMesh.rotation.y = Math.atan2(mouse.x - p.x, mouse.y - p.y);
    const col = colorHex((ELEMENT_INFO[game.stats.spellKind] && ELEMENT_INFO[game.stats.spellKind].color) || '#ffcc56');
    for (const k of ['orb','orbCore','sOrb','sCore']) {
      const m = playerMesh.userData[k];
      if (m && m.material) {
        m.material.color.setHex(col);
        if (m.material.emissive) m.material.emissive.setHex(col);
      }
    }
    const fam = playerMesh.userData.familiar;
    if (fam) {
      const a = game.time * 2.2;
      fam.position.set(Math.cos(a) * 24, 31 + Math.sin(a * 1.7) * 5, Math.sin(a) * 18);
      fam.rotation.y += 0.05; fam.rotation.x += 0.035;
    }
    // brawler palm thrust: alternating hands shoot forward (local +Z = aim) on each punch
    const brawler = game.stats.mainMode !== 'spell';
    const armL = playerMesh.userData.armL, armR = playerMesh.userData.armR;
    if (armL && armR) {
      armL.visible = brawler; armR.visible = brawler;
      if (brawler) {
        const baseL = playerMesh.userData.armLBase, baseR = playerMesh.userData.armRBase;
        armL.position.copy(baseL); armR.position.copy(baseR);
        const active = p.fistHand ? armR : armL, idle = p.fistHand ? armL : armR;
        const base = p.fistHand ? baseR : baseL;
        const prog = p.fistAnim > 0 ? Math.sin((1 - p.fistAnim / p.fistAnimMax) * Math.PI) : 0; // 0→1→0
        active.position.z = base.z + prog * 34;          // thrust toward aim
        active.position.x = base.x * (1 - prog * 0.7);   // converge to centre
        active.position.y = base.y + prog * 3;
        // palm glow: stance colour for 雷掌/風掌, else the current element on the fist
        const palmTint = game.stats.mainMode === 'lightpalm' ? '#9fe7ff'
          : game.stats.mainMode === 'windpalm' ? '#dff3ff'
          : (ELEMENT_INFO[dashElement()] && ELEMENT_INFO[dashElement()].color) || '#ffe0bd';
        const ecol = colorHex(palmTint);
        active.material.color.setHex(prog > 0.2 ? ecol : 0xffd7b0);
        if (active.material.emissive) { active.material.emissive.setHex(ecol); active.material.emissiveIntensity = prog * 0.6; }
        idle.material.color.setHex(0xffd7b0);
        if (idle.material.emissive) idle.material.emissiveIntensity = 0;
      }
    }
    const blink = p.invuln > 0 && Math.floor(game.time * 20) % 2 === 0;
    playerMesh.visible = !blink;
  }
  function buildEnemy(e) {
    const g = new THREE.Group(); const r = e.r; const tints = [];
    const base = colorHex(e.color);
    const black = 0x17101c;
    if (e.type === 'slime') {
      const b = tintable(g, tints, makeBox(r * 2.05, r * 1.35, r * 2.05, base, base, 0.05)); b.position.y = r * 0.72;
      const shine = makeBox(r * 0.7, 3, r * 0.6, 0xb5ffb0); shine.position.set(-r * .25, r * 1.23, r * .35); g.add(shine);
      const eL = makeBox(3.8, 4.5, 1.3, black); eL.position.set(-r * 0.4, r * 1.0, r * 1.05); g.add(eL);
      const eR = makeBox(3.8, 4.5, 1.3, black); eR.position.set(r * 0.4, r * 1.0, r * 1.05); g.add(eR);
    } else if (e.type === 'bug') {
      const b = tintable(g, tints, makeBox(r * 1.65, r * 1.25, r * 2.05, base, 0x552a88, 0.14)); b.position.y = r * 0.9;
      const shell = makeBox(r * 1.25, 4, r * 1.7, 0x3c2855); shell.position.y = r * 1.55; g.add(shell);
      for (let i = -1; i <= 1; i++) { const legL = makeBox(3, 3, r * .7, 0x2a1a3d); legL.position.set(-r * .95, r * .55, i * r * .55); g.add(legL); const legR = makeBox(3, 3, r * .7, 0x2a1a3d); legR.position.set(r * .95, r * .55, i * r * .55); g.add(legR); }
      const eL = makeBox(4, 4, 1.2, 0xff7aff, 0xff7aff, 0.6); eL.position.set(-r * 0.42, r * 1.18, r * 1.05); g.add(eL);
      const eR = makeBox(4, 4, 1.2, 0xff7aff, 0xff7aff, 0.6); eR.position.set(r * 0.42, r * 1.18, r * 1.05); g.add(eR);
    } else if (e.type === 'imp') {
      const b = tintable(g, tints, makeBox(r * 1.55, r * 1.85, r * 1.55, base, 0x66220c, 0.12)); b.position.y = r * 0.95;
      const belly = makeBox(r * .75, r * .65, 2, 0xffbd66); belly.position.set(0, r * 0.95, r * .8); g.add(belly);
      const hornL = makeBox(3.4, r * 0.85, 3.4, 0xffe0a3); hornL.position.set(-r * 0.45, r * 2.02, 0); g.add(hornL);
      const hornR = makeBox(3.4, r * 0.85, 3.4, 0xffe0a3); hornR.position.set(r * 0.45, r * 2.02, 0); g.add(hornR);
      const eL = makeBox(3.7, 3.7, 1.2, 0xfff0a3, 0xffdf7a, 0.5); eL.position.set(-r * 0.35, r * 1.3, r * 0.75); g.add(eL);
      const eR = makeBox(3.7, 3.7, 1.2, 0xfff0a3, 0xffdf7a, 0.5); eR.position.set(r * 0.35, r * 1.3, r * 0.75); g.add(eR);
    } else if (e.type === 'charger') {
      const b = tintable(g, tints, makeBox(r * 1.75, r * 1.65, r * 1.5, 0xb9925e)); b.position.y = r * 0.8;
      const helm = makeBox(r * 1.55, r * 0.75, r * 1.35, 0x81716b); helm.position.y = r * 1.88; g.add(helm);
      const crest = makeBox(r * .25, r * .65, r * 1.45, 0xffd36d, 0xff9a4d, 0.12); crest.position.y = r * 2.3; g.add(crest);
      const visor = makeBox(r * 1.05, 4.2, 1.4, 0xffd36d, 0xffd36d, 0.45); visor.position.set(0, r * 1.88, r * 0.76); g.add(visor);
      const shield = makeBox(r * 1.58, r * 1.65, 5, 0x9c7a4f); shield.position.set(0, r * 0.98, r * 0.98); g.add(shield);
    } else if (e.type === 'boss') {
      const robe = tintable(g, tints, makeBox(30, 32, 24, 0x33694f, 0x10261c, 0.1)); robe.position.y = 16;
      const head = makeBox(27, 22, 22, 0x66e0a6, 0x224b3a, 0.15); head.position.y = 42; g.add(head);
      const eL = makeBox(5.5, 6.5, 1.4, 0x2b1f34); eL.position.set(-8, 44, 11); g.add(eL);
      const eR = makeBox(5.5, 6.5, 1.4, 0x2b1f34); eR.position.set(8, 44, 11); g.add(eR);
      const hat = makeBox(38, 7, 35, 0x47228d, 0x1d0e38, 0.2); hat.position.y = 57; g.add(hat);
      const crown = makeBox(18, 7, 18, 0xffcc56, 0xff9a4d, 0.16); crown.position.y = 65; g.add(crown);
      const staff = makeBox(4, 54, 4, 0x8a5f35); staff.position.set(23, 31, 9); g.add(staff);
      const staffOrb = new THREE.Mesh(octaGeo, matLambert(0xd998ff, 0xd998ff, 0.9)); staffOrb.scale.set(8, 8, 8); staffOrb.position.set(23, 63, 9); g.add(staffOrb);
      const orbs = [];
      const oc = [0xffbd66, 0xbff4ff, 0x9fe7ff, 0xd998ff];
      for (let i = 0; i < 4; i++) { const o = new THREE.Mesh(octaGeo, matLambert(oc[i], oc[i], 0.85)); o.scale.set(7, 7, 7); g.add(o); orbs.push(o); }
      g.userData.orbs = orbs;
    }
    g.userData.tints = tints;
    // free-form islands: a soft contact shadow grounds the fighter so it pops off the bright grass
    // (the voxels otherwise read as "sunk into" the terrain). v2-only; single-player enemies unchanged.
    if (freeIslands) {
      const sh = new THREE.Mesh(circleGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }));
      sh.rotation.x = -Math.PI / 2; sh.position.y = 1.6; sh.scale.set(r * 1.15, r * 0.82, 1); g.add(sh);
    }
    return g;
  }
  function updateActor(e, g) {
    if (e.falling) { // v2 死亡劇場 A: 縮小 + 旋轉 + 沉進洞裡
      const k = Math.max(0, Math.min(1, (e.fallT || 0) / 0.6));
      g.position.set(e.x, -120 * (1 - k), e.y);
      g.rotation.set(0, e.spin || 0, 0);
      g.scale.setScalar(Math.max(0.05, k));
      return;
    }
    g.position.set(e.x, 0, e.y);
    if (e.type === 'slime') g.position.y = Math.abs(Math.sin(game.time * 4 + e.x * 0.1)) * 4;
    if (e.type === 'boss') {
      g.position.y = 28 + Math.sin(game.time * 2) * 4;
      const orbs = g.userData.orbs || [];
      for (let i = 0; i < orbs.length; i++) {
        const a = game.time * (e.phase === 2 ? 2.8 : 1.8) + i * Math.PI / 2;
        orbs[i].position.set(Math.cos(a) * 42, 18 + Math.sin(a) * 12, Math.sin(a) * 42);
      }
    }
    if (e.type === 'charger') g.rotation.y = Math.atan2(Math.cos(e.facing), Math.sin(e.facing));
    else g.rotation.y = Math.atan2((game.player ? game.player.x - e.x : 0), (game.player ? game.player.y - e.y : 1));
    const tintHex = e.hurt > 0 ? 0xffffff : (e.slowTimer > 0 ? 0xd8fbff : null);
    for (const t of g.userData.tints) t.mesh.material.color.setHex(tintHex != null ? tintHex : t.base);
  }

  function syncActors() {
    const seen = new Set();
    for (const e of game.enemies) {
      seen.add(e);
      let g = actorMeshes.get(e);
      if (!g) { g = buildEnemy(e); scene.add(g); actorMeshes.set(e, g); }
      updateActor(e, g);
    }
    for (const [e, g] of actorMeshes) {
      if (!seen.has(e)) { scene.remove(g); actorMeshes.delete(e); }
    }
    if (game.player) {
      if (!playerMesh) { playerMesh = buildPlayer(); scene.add(playerMesh); }
      updatePlayerMesh();
    }
  }

  // --- interactive props (crates) — rebuilt each frame (few of them) ---
  const propGroup = new THREE.Group(); scene.add(propGroup);
  function syncProps() {
    propGroup.clear();
    for (const pr of game.props) {
      const charged = pr.charge === 'lightning', burning = pr.charge === 'fire';
      const cracked = pr.hp < pr.maxHp;
      const ice = pr.wall === 'ice', earth = pr.wall === 'earth'; // ★3 風掌牆碎塊（冰=藍/土=石灰）
      const col = burning ? 0xff7a3a : charged ? 0x6fb8d8 : ice ? 0x9fd8e8 : earth ? 0x8a8276 : (cracked ? 0x9c7038 : 0xb98a52);
      const emis = burning ? 0xff5a20 : charged ? 0x4fc8ff : (ice ? 0x2a6a88 : 0x000000);
      const s = pr.r * 1.9;
      const lift = pr.held ? pr.r * 2.0 : 0;          // a carried crate floats above the mage
      const box = makeBox(s, s, s, col, emis, (charged || burning || ice) ? 0.6 : 0);
      box.position.set(pr.x, pr.r * 0.95 + lift, pr.y);
      box.rotation.y = (pr.x + pr.y) * 0.01 + (pr.held ? game.time * 1.5 : 0);
      propGroup.add(box);
      const cap = makeBox(s * 1.04, 3, s * 1.04, burning ? 0x9c4422 : charged ? 0x3a7a90 : ice ? 0x6aa8c0 : earth ? 0x5a564e : 0x7a5a32);
      cap.position.set(pr.x, pr.r * 1.9 + lift, pr.y); cap.rotation.y = box.rotation.y; propGroup.add(cap);
      if (charged) { const g = makeGlowSphere(pr.r * 1.7, 0x9fe7ff, 0.3); g.position.set(pr.x, pr.r + lift, pr.y); propGroup.add(g); }
      else if (ice) { const g = makeGlowSphere(pr.r * 1.7, 0xcdf2ff, 0.22); g.position.set(pr.x, pr.r + lift, pr.y); propGroup.add(g); }
      if (pr.held) { const g = makeGlowSphere(pr.r * 2.1, 0xdff3ff, 0.26); g.position.set(pr.x, pr.r * 0.95 + lift, pr.y); propGroup.add(g); }
    }
  }

  // --- projectiles + ground effect discs (rebuilt each frame) ---
  const PROJZ = 18;
  const projGroup = new THREE.Group(); scene.add(projGroup);
  const zoneGroup = new THREE.Group(); scene.add(zoneGroup);
  function clearDynamic(grp) {
    for (const c of grp.children) {
      if (c.geometry && c.geometry.__tmp) c.geometry.dispose();
      if (c.material && c.material.__tmp) c.material.dispose();
    }
    grp.clear();
  }
  function ball(x, y, r, hex) {
    const m = new THREE.Mesh(sphereGeo, basicMat(hex));
    m.position.set(x, PROJZ, y); m.scale.setScalar(r);
    projGroup.add(m);
  }
  function addProjectileModel(kind, x, y, r, hex, vx = 0, vy = 1) {
    const a = Math.atan2(vx, vy);
    let m;
    if (kind === 'ice' || kind === 'frost_shock' || kind === 'venom_frost') {
      m = new THREE.Mesh(octaGeo, tmpMat(hex, 1));
      m.scale.set(r * 1.05, r * 1.05, r * 2.2);
      m.rotation.y = a;
    } else if (kind === 'lightning' || kind === 'toxic_shock') {
      m = new THREE.Mesh(tetraGeo, tmpMat(hex, 1, true));
      m.scale.set(r * 1.0, r * 1.0, r * 1.8);
      m.rotation.y = a + game.time * 7;
    } else if (kind === 'steam') {
      m = new THREE.Mesh(sphereGeo, tmpMat(0xeaffff, 0.42, true));
      m.scale.set(r * 2.1, r * 1.25, r * 2.1);
    } else if (kind === 'poison' || kind === 'toxic_boom') {
      m = new THREE.Mesh(sphereGeo, tmpMat(hex, 0.82, true));
      m.scale.setScalar(r * 1.35);
    } else if (isEarthKind(kind)) {                 // a tumbling angular rock
      m = new THREE.Mesh(tetraGeo, tmpMat(hex, 1, kind === 'magma'));
      m.scale.setScalar(r * 1.55);
      m.rotation.set(game.time * 4, game.time * 5 + a, a);
    } else {
      m = new THREE.Mesh(sphereGeo, tmpMat(hex, 1, kind === 'plasma' || kind === 'fire'));
      m.scale.setScalar(r * 1.25);
    }
    m.position.set(x, PROJZ, y);
    projGroup.add(m);
    const glow = new THREE.Mesh(sphereGeo, tmpMat(hex, 0.18, true));
    glow.scale.setScalar(r * (kind === 'steam' ? 3.1 : 2.35));
    glow.position.set(x, PROJZ, y);
    projGroup.add(glow);
  }
  function syncProjectiles() {
    clearDynamic(projGroup);
    if (game.plasmaOrb && game.state === 'playing' && game.stats.capstone === 'plasma') { // 電漿風暴: roaming plasma orb
      const o = game.plasmaOrb, R = 13 + game.stats.size * 1.5;
      addProjectileModel('plasma', o.x, o.y, R, 0x9fe7ff, o.vx, o.vy);
      const halo = new THREE.Mesh(sphereGeo, tmpMat(0xffb46a, 0.2, true)); halo.scale.setScalar(R * 3.2); halo.position.set(o.x, PROJZ, o.y); projGroup.add(halo);
    }
    for (const fb of game.fireballs) addProjectileModel(fb.kind, fb.x, fb.y, (fb.r || 7) * 1.25, colorHex(fb.color || '#ffffff'), fb.vx, fb.vy);
    for (const b of game.enemyProjectiles) addProjectileModel('fire', b.x, b.y, (b.r || 6) * 1.15, colorHex(b.color || '#ff8c4d'), b.vx, b.vy);
    for (const ib of game.iceBolts) addProjectileModel('ice', ib.x, ib.y, (ib.r || 6) * 1.3, 0xbff4ff, ib.vx, ib.vy);
    for (const lb of game.lightningBolts) {
      const midX = (lb.x1 + lb.x2) / 2 + Math.sin(game.time * 24 + lb.x1) * 8;
      const midY = (lb.y1 + lb.y2) / 2 + Math.cos(game.time * 21 + lb.y1) * 8;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(lb.x1, PROJZ + 3, lb.y1),
        new THREE.Vector3(midX, PROJZ + 10, midY),
        new THREE.Vector3(lb.x2, PROJZ + 3, lb.y2)]);
      geo.__tmp = true;
      const mat = new THREE.LineBasicMaterial({ color: 0xe5fcff, transparent: true, opacity: clamp(lb.life / lb.maxLife, 0, 1) }); mat.__tmp = true;
      projGroup.add(new THREE.Line(geo, mat));
    }
  }
  function disc(x, y, r, hex, op) {
    const mat = tmpMat(hex, op, true);
    mat.depthWrite = false;
    const m = new THREE.Mesh(circleGeo, mat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, 1.5, y); m.scale.setScalar(Math.max(1, r));
    zoneGroup.add(m);
  }
  function puff(x, y, r, hex, op, n = 5, height = 14) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + game.time * 0.25;
      const d = r * (0.12 + (i % 3) * 0.13);
      const m = new THREE.Mesh(sphereGeo, tmpMat(hex, op, true));
      const s = r * (0.16 + (i % 2) * 0.05);
      m.scale.set(s * 1.25, s * 0.75, s * 1.25);
      m.position.set(x + Math.cos(a) * d, height + Math.sin(game.time * 2 + i) * 3, y + Math.sin(a) * d);
      zoneGroup.add(m);
    }
  }
  function syncZones() {
    clearDynamic(zoneGroup);
    // capstone 凍毒領域: a frost-venom field that follows the player (radius kept in sync by sim)
    if (game.state === 'playing' && game.stats.capstone === 'frostpoison') {
      const p = game.player, r = game.frostAuraR || 116;
      const pulse = 0.17 + 0.06 * Math.sin(game.time * 3);
      disc(p.x, p.y, r, 0x6fd8c0, pulse);              // teal frost-venom field
      disc(p.x, p.y, r * 0.66, 0xa7ff45, pulse * 0.55); // toxic inner ring
      puff(p.x, p.y, r, 0xbff4ff, pulse * 0.7, 6, 12);
    }
    // capstone 劇毒電網: a charged poison field that follows the player
    if (game.state === 'playing' && game.stats.capstone === 'venomnet') {
      const p = game.player, r = game.venomNetR || 116;
      const pulse = 0.17 + 0.07 * Math.sin(game.time * 4);
      disc(p.x, p.y, r, 0x9a4fd0, pulse);               // purple poison field
      disc(p.x, p.y, r * 0.6, 0x79dcff, pulse * 0.5);   // electric inner core
      puff(p.x, p.y, r, 0xc98cff, pulse * 0.7, 6, 12);
    }
    // capstone 大地崩毀: a poison quagmire expanding under the player
    if (game.state === 'playing' && game.stats.capstone === 'quagmire') {
      const p = game.player, r = game.quagmireR || 90;
      const pulse = 0.2 + 0.05 * Math.sin(game.time * 2.5);
      disc(p.x, p.y, r, 0x6b7a3a, pulse);               // murky earthen swamp
      disc(p.x, p.y, r * 0.7, 0x8a36c8, pulse * 0.5);   // poison core
      puff(p.x, p.y, r, 0xa7c044, pulse * 0.7, 6, 9);
    }
    for (const pc of game.poisonClouds) {
      const a = 0.32 * clamp(pc.life / pc.maxLife, 0, 1);
      disc(pc.x, pc.y, pc.r, 0x8a36c8, a);
      puff(pc.x, pc.y, pc.r, 0xa7ff45, a * 0.75, 5, 18);
      if (Math.floor(game.time * 8 + pc.x) % 3 === 0) disc(pc.x, pc.y, pc.r * 0.42, 0xcfff6f, a * 0.5);
    }
    for (const sc of game.steamClouds) {
      const a = 0.28 * clamp(sc.life / sc.maxLife, 0, 1);
      disc(sc.x, sc.y, sc.r, 0xeaffff, a * 0.65);
      puff(sc.x, sc.y, sc.r, 0xf4ffff, a, 8, 24);
    }
    for (const fz of game.fireZones) {
      const a = 0.40 * clamp(fz.life / fz.maxLife, 0, 1);
      disc(fz.x, fz.y, fz.r, 0xff7a3e, a);
      for (let i = 0; i < 3; i++) {
        const flame = new THREE.Mesh(coneGeo, tmpMat(i % 2 ? 0xffd36d : 0xff673a, a * 1.2, true));
        const ang = game.time * 3 + i * 2.1;
        flame.scale.set(fz.r * .10, fz.r * .28, fz.r * .10);
        flame.position.set(fz.x + Math.cos(ang) * fz.r * .28, 9 + i * 2, fz.y + Math.sin(ang) * fz.r * .18);
        zoneGroup.add(flame);
      }
    }
    for (const ez of game.electricZones) {
      const a = 0.30 * clamp(ez.life / ez.maxLife, 0, 1);
      disc(ez.x, ez.y, ez.r, 0x79dcff, a);
      const ring = new THREE.Mesh(torusGeo, tmpMat(0xbdf5ff, a * 1.5, true));
      ring.rotation.x = -Math.PI / 2; ring.position.set(ez.x, 4, ez.y); ring.scale.set(ez.r, ez.r, ez.r);
      zoneGroup.add(ring);
    }
    for (const w of game.bossWarnings) {
      disc(w.x, w.y, w.r, 0xffd36d, 0.20);
      const ring = new THREE.Mesh(torusGeo, tmpMat(0xffd36d, 0.62, true));
      ring.rotation.x = -Math.PI / 2; ring.position.set(w.x, 5, w.y); ring.scale.set(w.r, w.r, w.r); zoneGroup.add(ring);
    }
    for (const ex of game.explosions) {
      const t = 1 - ex.life / ex.maxLife;
      disc(ex.x, ex.y, ex.r * (0.45 + t * 0.75), 0xffd36d, 0.28 * (ex.life / ex.maxLife));
      puff(ex.x, ex.y, ex.r, 0xff7640, 0.22 * (ex.life / ex.maxLife), 6, 30);
    }
    for (const rg of game.rings) disc(rg.x, rg.y, rg.r * (0.5 + (1 - rg.life / rg.maxLife) * 0.7), colorHex(rg.color), 0.16 * clamp(rg.life / rg.maxLife, 0, 1)); // was hardcoded white → every ring read as a white circle
    for (const s of game.slams) {
      const k = clamp(s.life / s.maxLife, 0, 1);   // 1→0 (fade)
      const t = 1 - k;                              // 0→1 (expand)
      const P = s.power;
      // leading shock ring punched out along the aim
      const lead = (40 + t * 70) * P;
      const lx = s.x + Math.cos(s.angle) * lead, ly = s.y + Math.sin(s.angle) * lead;
      const rr = (24 + t * 50) * P;
      const ring = new THREE.Mesh(torusGeo, tmpMat(s.hex, 0.95 * k, true));
      ring.rotation.x = -Math.PI / 2; ring.position.set(lx, 6, ly); ring.scale.set(rr, rr, rr * 0.85);
      zoneGroup.add(ring);
      const ring2 = new THREE.Mesh(torusGeo, tmpMat(s.hex, 0.6 * k, true)); // inner ring takes the stance colour (was always white)
      ring2.rotation.x = -Math.PI / 2; ring2.position.set(lx, 7, ly); ring2.scale.set(rr * 0.62, rr * 0.62, rr * 0.55);
      zoneGroup.add(ring2);
      // forward contact pop tinted by stance, + a SMALL white hot-core (so 土拳 reads earthy, not "a white circle")
      disc(s.x + Math.cos(s.angle) * 24 * P, s.y + Math.sin(s.angle) * 24 * P, 28 * P * (0.8 + t * 0.4), s.hex, 0.45 * k);
      disc(s.x + Math.cos(s.angle) * 20 * P, s.y + Math.sin(s.angle) * 20 * P, 11 * P, 0xffffff, 0.4 * k);
      for (let i = 0; i < 3; i++) {
        const d = ((22 + i * 28) + t * 56) * P;
        const dr = ((20 + i * 11) * (0.75 + t * 0.85)) * P;
        disc(s.x + Math.cos(s.angle) * d, s.y + Math.sin(s.angle) * d, dr, s.hex, 0.42 * k * (1 - i * 0.2));
      }
      puff(lx, ly, 26 * P, s.hex, 0.3 * k, 6, 14);
    }
    for (const bh of game.blackHoles) {
      disc(bh.x, bh.y, bh.r, 0x2a0f3a, 0.34);
      const t = 1 - bh.life / bh.maxLife;
      const core = new THREE.Mesh(sphereGeo, tmpMat(0x140022, 0.95, false));
      core.scale.setScalar(10 + t * 8); core.position.set(bh.x, 16, bh.y); zoneGroup.add(core);
      const ringm = new THREE.Mesh(torusGeo, tmpMat(0xb07aff, 0.7, true));
      ringm.rotation.x = -Math.PI / 2; ringm.position.set(bh.x, 4, bh.y);
      const rr = bh.r * (0.62 - t * 0.4); ringm.scale.set(rr, rr, rr); zoneGroup.add(ringm);
    }
    // 雷印 (lightning mark): a crackling cyan ring hovering over marked foes — dash through them
    // while in 雷掌 (or a lightning dash) to detonate the mark. (雷掌 signature, B 招牌差異化)
    for (const e of game.enemies) {
      if (e.dead || !(e.lightMark > 0)) continue;
      const fl = 0.55 + 0.45 * Math.sin(game.time * 24 + e.x * 0.3); // electric crackle flicker
      const m = new THREE.Mesh(torusGeo, tmpMat(0x9fe7ff, 0.4 + fl * 0.45, true));
      m.rotation.x = -Math.PI / 2; const s = 8 + fl * 3;
      m.position.set(e.x, 32, e.y); m.scale.set(s, s, s * 0.9);
      zoneGroup.add(m);
    }
    // Particles (dust, rock bits, sparks, gust streaks, death bursts…). The sim emits + updates these,
    // but the 3D build never had a draw pass for them — so ALL particle FX were invisible. Draw them as
    // small element-coloured voxel chunks (on-brand with the voxel art); opacity fades with life.
    for (const pa of game.particles) {
      const op = clamp(pa.life / pa.maxLife, 0, 1);
      // non-additive so solid bits (rock/dust) read as their real colour instead of blowing out to white when they pile up
      const m = new THREE.Mesh(boxGeo, tmpMat(colorHex(pa.color), 0.92 * op, false));
      const s = Math.max(1.5, pa.r * 1.7);
      m.position.set(pa.x, 9, pa.y); m.scale.set(s, s, s);
      zoneGroup.add(m);
    }
  }

  // --- mouse -> world ground point via camera raycast ---
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _ndc = new THREE.Vector2();
  const _hit = new THREE.Vector3();
  export function updateMouseWorld() {
    _ndc.set(mouseScreen.x / W * 2 - 1, -(mouseScreen.y / H * 2 - 1));
    raycaster.setFromCamera(_ndc, camera);
    if (raycaster.ray.intersectPlane(groundPlane, _hit)) {
      mouse.x = clamp(_hit.x, 0, W);
      mouse.y = clamp(_hit.z, 0, H);
    }
  }

  export function render3D() {
    if (!gl3dOk) return;
    if (!freeIslands) { drawGroundTexture(); syncWalls(); if (islandMode) syncIsland(); }
    syncProps();
    // Camera target: an explicit game.camTarget (v2 follows one fighter) wins; else the player when
    // following; else the arena centre (fixed framing). camTarget overrides the sandbox follow toggle.
    const camObj = game.camTarget || (camFollow ? game.player : null);
    const px = camObj ? camObj.x : W / 2;
    const pz = camObj ? camObj.y : H / 2;
    let shx = 0, shz = 0;
    if (game.screenShake > 0) { shx = rnd(-game.screenShake, game.screenShake); shz = rnd(-game.screenShake, game.screenShake); }
    const _pit = CAM.angle * Math.PI / 180, _az = CAM.azimuth * Math.PI / 180;
    const _hr = Math.cos(_pit) * CAM.dist;
    const _tx = px + CAM.panX, _tz = pz + CAM.panZ;
    camera.position.set(_tx + Math.sin(_az) * _hr + shx, Math.sin(_pit) * CAM.dist, _tz + Math.cos(_az) * _hr + shz);
    camera.lookAt(_tx, CAM.lookY, _tz);
    if (camera.fov !== CAM.fov) { camera.fov = CAM.fov; camera.updateProjectionMatrix(); } // live fov (camera-sandbox); no-op otherwise
    syncActors();
    syncProjectiles();
    syncZones();
    renderer.render(scene, camera);
  }

  // Enemy health bars, billboarded onto the HUD overlay.
  function drawEnemyBars() {
    for (const e of game.enemies) {
      if (e.type === 'boss') continue;
      if (!(e.maxHp && (e.type === 'charger' || e.hurt > 0 || e.hp < e.maxHp))) continue;
      const s = project(e.x, e.y, e.r * 2.4 + 22);
      if (s.behind) continue;
      const bw = e.type === 'charger' ? 42 : 28;
      const pct = clamp(e.hp / e.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(s.x - bw / 2, s.y, bw, 4);
      ctx.fillStyle = e.type === 'charger' ? '#ffd36d' : '#ff7b72'; ctx.fillRect(s.x - bw / 2, s.y, bw * pct, 4);
    }
  }

  // 凸眼 (panic faces): when an entity is launched hard / about to fall, billboard a pair of
  // cartoon bulging white eyes with trembling pupils over its head — the "oh no" beat that
  // sells a dumb death (v2 spec A). Cosmetic only; driven by sim's e.faceT countdown.
  export function drawPanicFaces() {
    for (const e of game.enemies) {
      if (!(e.faceT > 0)) continue;
      const s = project(e.x, e.y, (e.r || 14) * 2.2 + 6);
      if (s.behind) continue;
      const er = 6, off = 5;
      // tremble: tiny jitter on the pupils so the eyes read as panicked, not dead.
      const jx = Math.cos(game.time * 40) * 1.4, jy = Math.sin(game.time * 47) * 1.4;
      for (const dx of [-off, off]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(s.x + dx, s.y, er, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0a0a12';
        ctx.beginPath(); ctx.arc(s.x + dx + jx, s.y + jy, er * 0.45, 0, Math.PI * 2); ctx.fill();
      }
    }
  }


  // 風掌 crate prompts, billboarded onto the world: highlight a liftable crate, or
  // remind you that you can throw the one you're carrying.
  function drawCrateHints() {
    if (game.state !== 'playing' || game.stats.mainMode !== 'windpalm') return;
    const p = game.player;
    const cap = game.stats.windpalmStar || 1;
    if (p.held.length) {
      const it = p.held[0], s = project(it.x, it.y, it.r * 2.6 + 24);
      if (!s.behind) {
        const pulse = 0.6 + 0.4 * Math.sin(game.time * 8);
        const label = p.held.length > 1 ? `E 齊射 ×${p.held.length} →` : 'E 投擲 →';
        ctx.fillStyle = 'rgba(10,8,14,.6)'; roundRectPath(ctx, s.x - 60, s.y - 16, 120, 22, 8); ctx.fill();
        ctx.textAlign = 'center'; ctx.font = '900 13px system-ui, sans-serif';
        ctx.fillStyle = `rgba(223,243,255,${pulse})`; ctx.fillText(label, s.x, s.y);
      }
    }
    if (p.held.length >= cap) return;
    const pr = nearestLiftable(p);
    // With no crate/foe in reach, look for a liftable wall. Lifting unlocks at ★3 — below that we still
    // surface a dimmed "★3 可拔牆" lock prompt so the player knows the feature exists and how to unlock it.
    const wall = !pr ? nearestLiftableWallTile(p) : null;
    const target = pr || wall;
    if (!target) return;
    const locked = !!wall && cap < 3;
    const label = pr ? 'E 舉起 ↑'
      : locked ? '★3 可拔牆'
      : (wall.kind === 'ice' ? 'E 拔冰牆 ↑' : 'E 拔薄牆 ↑');
    const tint = locked ? '150,152,172'
      : wall && wall.kind === 'ice' ? '191,244,255'
      : '223,243,255';
    const s = project(target.x ?? target.cx, target.y ?? target.cy, (target.r ? target.r * 2.4 : 28) + 14);
    if (s.behind) return;
    const pulse = locked ? 0.7 : 0.55 + 0.45 * Math.sin(game.time * 6); // locked = steady & dim, no pulsing ring
    ctx.save();
    ctx.strokeStyle = `rgba(${tint},${locked ? 0.5 : pulse})`; ctx.lineWidth = locked ? 1.5 : 2.5;
    ctx.beginPath(); ctx.arc(s.x, s.y + 10, (locked ? 16 : 20) + (locked ? 0 : 3 * Math.sin(game.time * 6)), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(10,8,14,.6)'; roundRectPath(ctx, s.x - 50, s.y - 14, 100, 20, 8); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = '900 12px system-ui, sans-serif';
    ctx.fillStyle = `rgba(${tint},${pulse})`; ctx.fillText(label, s.x, s.y);
  }

  // On-screen touch controls (mobile): dynamic move/aim sticks + fixed action buttons.
  function drawTouchControls() {
    if (!touch.enabled || game.state !== 'playing') return;
    ctx.save();
    const stick = (s, col) => {
      if (!s.active) return;
      ctx.strokeStyle = `rgba(${col},.4)`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(s.ox, s.oy, STICK_R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(${col},.5)`;
      ctx.beginPath(); ctx.arc(s.ox + s.dx * STICK_R, s.oy + s.dy * STICK_R, 26, 0, Math.PI * 2); ctx.fill();
    };
    stick(touch.move, '160,200,255');
    stick(touch.aim, '255,190,120');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '900 19px system-ui, sans-serif';
    for (const k of ['dash', 'secondary', 'grab']) {
      if (k === 'grab' && (!game.stats || game.stats.mainMode !== 'windpalm')) continue; // E only matters for 風掌
      if (k === 'secondary' && (!game.stats || !game.stats.secondary)) continue;          // hide until a secondary is equipped
      const bd = TOUCH_BTN[k], pressed = touch.btn[k];
      ctx.fillStyle = pressed ? 'rgba(255,211,109,.45)' : 'rgba(20,16,26,.5)';
      ctx.strokeStyle = 'rgba(223,243,255,.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(bd.x, bd.y, bd.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#eafaff'; ctx.fillText(bd.label, bd.x, bd.y);
    }
    ctx.restore();
  }

  export function draw() {
    // 3D world (WebGL) ...
    render3D();
    // ... then the crisp 2D HUD overlay on top.
    ctx = screenCtx;
    ctx.clearRect(0, 0, W, H);
    if (!gl3dOk) {
      ctx.fillStyle = '#1a1722'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff1bb'; ctx.textAlign = 'center';
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.fillText('WebGL is not enabled — the 3D view can\'t be shown', W / 2, H / 2 - 10);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText('Use a newer browser, or enable hardware acceleration / WebGL', W / 2, H / 2 + 22);
      return;
    }
    if (game.flash > 0) {
      ctx.fillStyle = `rgba(255, 221, 148, ${game.flash * 0.22})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawEnemyBars();
    drawPanicFaces();
    drawCrateHints();
    drawFloatingTexts();
    drawReticle();
    drawUi();
    drawTouchControls();
    drawFusionBanner();
    drawBossPhaseBanner();

    if (game.state === 'title') drawTitle();
    if (game.state === 'upgrade') drawUpgrade();
    if (game.state === 'over') drawEnd(false);
    if (game.state === 'win') drawEnd(true);
  }


  function drawFloatingTexts() {
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const t of game.floatingTexts) {
      const alpha = clamp(t.life / t.maxLife, 0, 1);
      const s = project(t.x, t.y, 30);
      ctx.globalAlpha = alpha;
      const txt = T(t.text);
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillText(txt, s.x + 1, s.y + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(txt, s.x, s.y);
      ctx.globalAlpha = 1;
    }
  }

  function drawReticle() {
    if (game.state !== 'playing') return;
    const s = project(mouse.x, mouse.y);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.strokeStyle = 'rgba(255, 241, 187, .75)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 9 + Math.sin(game.time * 8) * 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-7, 0); ctx.moveTo(7, 0); ctx.lineTo(16, 0); ctx.moveTo(0, -16); ctx.lineTo(0, -7); ctx.moveTo(0, 7); ctx.lineTo(0, 16); ctx.stroke();
    ctx.restore();
  }


  function drawBossPhaseBanner() {
    const b = game.bossPhaseBanner;
    if (!b) return;
    const alpha = clamp(b.life / b.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha * 1.4);
    ctx.fillStyle = 'rgba(0, 0, 0, .46)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = b.color || '#ffdf7a';
    ctx.font = '900 58px system-ui, sans-serif';
    ctx.fillText(T(b.text), W / 2, H / 2 - 20);
    ctx.fillStyle = '#fff1bb';
    ctx.font = '900 20px system-ui, sans-serif';
    ctx.fillText(T(b.sub), W / 2, H / 2 + 20);
    ctx.restore();
  }

  function drawFusionBanner() {
    const fb = game.fusionBanner;
    if (!fb) return;
    const alpha = clamp(fb.life / fb.maxLife, 0, 1);
    const pop = 1 + Math.sin((1 - alpha) * Math.PI) * 0.075;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha * 1.35);
    ctx.translate(W / 2, 104);
    ctx.scale(pop, pop);
    const grad = ctx.createLinearGradient(-270, -54, 270, 54);
    grad.addColorStop(0, 'rgba(29,18,42,.92)');
    grad.addColorStop(0.5, 'rgba(49,27,70,.92)');
    grad.addColorStop(1, 'rgba(23,17,34,.92)');
    ctx.fillStyle = grad;
    roundRectPath(ctx, -276, -58, 552, 112, 18); ctx.fill();
    ctx.strokeStyle = fb.color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,211,109,.55)'; ctx.lineWidth = 1.5;
    roundRectPath(ctx, -260, -44, 520, 84, 12); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.shadowColor = fb.color; ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffd36d';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.fillText(fb.title === 'FUSION!' ? 'FUSION!' : 'SPELL SHIFT', 0, -22);
    ctx.shadowBlur = 0;
    ctx.fillStyle = fb.color;
    ctx.font = '900 20px system-ui, sans-serif';
    ctx.fillText(T(fb.equation), 0, 8);
    ctx.fillStyle = '#fff2cf';
    ctx.font = '800 12px system-ui, sans-serif';
    ctx.fillText(T(fb.desc), 0, 33);
    ctx.restore();
  }

  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  function elementIconInfo(el) {
    const map = {
      fire: ['🔥', '#ff8b47'], ice: ['❄', '#9feeff'], lightning: ['⚡', '#8fe8ff'], poison: ['☠', '#c07aff'],
      steam: ['☁', '#d8f6ff'], toxic_boom: ['☣', '#d998ff'], plasma: ['✦', '#ffcf6f'], frost_shock: ['✹', '#bff4ff'],
      toxic_shock: ['☠', '#b794ff'], venom_frost: ['◆', '#b7ffd2'], neutral: ['✦', '#f4e7ff'],
      earth: ['⬢', '#c79a5b'], magma: ['◉', '#ff7a3a'], frost_rock: ['❖', '#a9d8e6'], magnet: ['⊕', '#b8a0ff'], toxic_mire: ['⬟', '#9fae5a']
    };
    return map[el] || map.neutral;
  }

  function drawSpellFormulaCard(x, y, w, h) {
    const spellColor = ELEMENT_INFO[game.stats.spellKind]?.color || '#ffe6a7';
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 14);
    ctx.fillStyle = 'rgba(241,216,170,.92)'; ctx.fill();
    ctx.strokeStyle = 'rgba(82,52,35,.75)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#3b2530'; ctx.font = '900 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('SPELL FORMULA', x + w / 2, y + 23);
    const elems = (game.stats.spellElements && game.stats.spellElements.length) ? game.stats.spellElements : ['neutral'];
    for (let i = 0; i < 2; i++) {
      const ex = x + 22 + i * 54, ey = y + 38;
      const el = elems[i] || null;
      roundRectPath(ctx, ex, ey, 42, 42, 8);
      ctx.fillStyle = el ? elementIconInfo(el)[1] : 'rgba(60,40,35,.18)'; ctx.fill();
      ctx.strokeStyle = el ? '#5a3326' : 'rgba(60,40,35,.25)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = el ? '#fff' : 'rgba(60,40,35,.35)'; ctx.font = '900 23px system-ui, sans-serif';
      ctx.fillText(el ? elementIconInfo(el)[0] : '+', ex + 21, ey + 28);
    }
    ctx.fillStyle = '#5a3326'; ctx.font = '900 18px system-ui, sans-serif'; ctx.fillText('=', x + 128, y + 66);
    roundRectPath(ctx, x + 146, y + 38, 62, 42, 9); ctx.fillStyle = spellColor; ctx.fill(); ctx.strokeStyle = '#5a3326'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '900 22px system-ui, sans-serif'; ctx.fillText(elementIconInfo(game.stats.spellKind)[0], x + 177, y + 66);
    ctx.textAlign = 'right'; ctx.fillStyle = '#3b2530'; ctx.font = '900 13px system-ui, sans-serif';
    ctx.fillText(T(game.stats.spellName), x + w - 16, y + h - 16);
    ctx.restore();
  }

  function drawUi() {
    const p = game.player;
    ctx.save();
    // left toy-card HUD
    roundRectPath(ctx, 12, 12, 306, 92, 14);
    ctx.fillStyle = 'rgba(16, 12, 23, .74)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,211,109,.30)'; ctx.lineWidth = 2; ctx.stroke();
    // portrait frame
    roundRectPath(ctx, 24, 23, 52, 64, 10); ctx.fillStyle = '#2b1843'; ctx.fill(); ctx.strokeStyle = '#ffd36d'; ctx.stroke();
    ctx.fillStyle = '#6b35df'; ctx.beginPath(); ctx.moveTo(34, 50); ctx.lineTo(66, 50); ctx.lineTo(58, 30); ctx.lineTo(42, 30); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd36d'; ctx.fillRect(35, 51, 30, 4);
    ctx.fillStyle = '#76e7ff'; ctx.fillRect(42, 63, 5, 5); ctx.fillRect(53, 63, 5, 5);
    // hp bar
    ctx.fillStyle = '#311922'; ctx.fillRect(88, 30, 182, 18);
    const hpGrad = ctx.createLinearGradient(88, 30, 270, 30); hpGrad.addColorStop(0, '#ff554e'); hpGrad.addColorStop(1, '#ff9f45');
    ctx.fillStyle = hpGrad; ctx.fillRect(88, 30, 182 * clamp(p.hp / p.maxHp, 0, 1), 18);
    ctx.strokeStyle = '#ffd7bd'; ctx.strokeRect(88, 30, 182, 18);
    ctx.fillStyle = '#fff4db'; ctx.font = '900 14px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`${Math.ceil(p.hp)} / ${p.maxHp}`, 278, 44);
    ctx.fillStyle = '#9fe7ff'; ctx.fillRect(88, 54, 148 * (1 - clamp(p.cooldown / Math.max(0.05, 0.18 * game.stats.cooldownMul), 0, 1)), 7);
    // dash charges (C): one pip per charge; the recharging pip fills up as it comes back.
    { const n = game.stats.dashCharges, pw = 15, gap = 4, py = 63, rt = Math.max(0.05, 1.1 * game.stats.dashCdMul);
      for (let i = 0; i < n; i++) {
        const x = 240 + i * (pw + gap);
        ctx.fillStyle = 'rgba(183,216,255,.16)'; ctx.fillRect(x, py, pw, 5);
        const f = i < p.dashStock ? 1 : (i === p.dashStock ? 1 - clamp(p.dashRecharge / rt, 0, 1) : 0);
        if (f > 0) { ctx.fillStyle = '#b7d8ff'; ctx.fillRect(x, py, pw * f, 5); }
      }
    }
    ctx.fillStyle = '#fff2cf'; ctx.font = '800 13px system-ui, sans-serif';
    ctx.fillText(`${game.bossStarted ? 'BOSS FIGHT' : 'WAVE ' + (game.wave || 0) + '/5'}   ☠ ${game.kills}   ✦ ${game.score}`, 88, 82);

    const boss = game.enemies.find(e => e.type === 'boss' && !e.dead);
    if (boss) {
      const pct = clamp(boss.hp / boss.maxHp, 0, 1);
      roundRectPath(ctx, 292, 16, 376, 34, 12); ctx.fillStyle = 'rgba(16, 12, 23, .76)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.stroke();
      ctx.fillStyle = '#173025'; ctx.fillRect(310, 30, 244, 10);
      ctx.fillStyle = boss.phase === 2 ? '#ffdf7a' : '#66e0a6'; ctx.fillRect(310, 30, 244 * pct, 10);
      ctx.strokeStyle = '#e8ffe8'; ctx.strokeRect(310, 30, 244, 10);
      ctx.fillStyle = '#e8ffe8'; ctx.font = '900 13px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`${T('元素哥布林法師')}  P${boss.phase}`, 562, 39);
      if (game.bossAttackTimer > 0 && game.bossAttackLabel) {
        roundRectPath(ctx, 328, 56, 304, 26, 10); ctx.fillStyle = 'rgba(10, 8, 14, .78)'; ctx.fill();
        ctx.strokeStyle = boss.phase === 2 ? '#ffdf7a' : '#9fe7ff'; ctx.stroke();
        ctx.fillStyle = boss.phase === 2 ? '#ffdf7a' : '#d8f6ff'; ctx.textAlign = 'center'; ctx.font = '900 13px system-ui, sans-serif';
        ctx.fillText(T(game.bossAttackLabel), 480, 74);
      }
    }

    drawSpellFormulaCard(704, 14, 244, 104);
    const runLine = `${game.run && game.run.arena ? T(game.run.arena.name) : T('未選場')}｜${T(currentFlowName())}`;
    ctx.textAlign = 'right'; ctx.fillStyle = '#d7c7ff'; ctx.font = '800 12px system-ui, sans-serif';
    ctx.fillText(runLine, 936, 132);

    if (game.messageTimer > 0 && game.message) {
      ctx.textAlign = 'center';
      ctx.font = '900 26px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,.52)'; ctx.fillText(T(game.message), W / 2 + 2, 154 + 2);
      ctx.fillStyle = '#fff1bb'; ctx.fillText(T(game.message), W / 2, 154);
    }

    if (game.state === 'playing' && game.run && game.time - game.run.startTime < 7.5) {
      roundRectPath(ctx, 204, H - 58, 552, 38, 12); ctx.fillStyle = 'rgba(10, 8, 14, .76)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,211,109,.25)'; ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff1bb'; ctx.font = '900 14px system-ui, sans-serif';
      ctx.fillText('Tip: your single spell can be overwritten by Fire/Ice/Lightning/Poison — two elements fuse into a new spell.', W / 2, H - 34);
    }

    // 風掌 crate-control reminder (lift / throw), sits above the brawler tag.
    if (game.state === 'playing' && game.stats.mainMode === 'windpalm') {
      const heldN = p.held.length, cap = game.stats.windpalmStar || 1;
      roundRectPath(ctx, 16, H - 128, 214, 30, 10); ctx.fillStyle = 'rgba(10,8,14,.72)'; ctx.fill();
      ctx.strokeStyle = '#dff3ff'; ctx.stroke();
      ctx.textAlign = 'left'; ctx.font = '900 12px system-ui, sans-serif'; ctx.fillStyle = '#eafaff';
      ctx.fillText(heldN ? `[E] Throw ×${heldN} →` : `[E] Near crate/foe${cap >= 3 ? '/wall' : ''} → grab (★${cap})`, 26, H - 108);
    }

    // Brawler tag: main attack is melee (土拳 / 雷掌 / 風掌).
    if (game.state === 'playing' && game.stats.mainMode !== 'spell') {
      const BRAWL = { fist: ['Melee · Earth Fist', '#e0b07a', '#ffdfa6'], lightpalm: ['Melee · Lightning Palm', '#9fe7ff', '#cdf3ff'], windpalm: ['Melee · Wind Palm', '#dff3ff', '#eafaff'] };
      const b = BRAWL[game.stats.mainMode] || BRAWL.fist;
      const starN = { fist: game.stats.fistStar, lightpalm: game.stats.lightStar, windpalm: game.stats.windpalmStar }[game.stats.mainMode] || 0;
      const stars = starN > 1 ? ' ' + '★'.repeat(starN) : '';
      roundRectPath(ctx, 16, H - 92, 168, 32, 10); ctx.fillStyle = 'rgba(10,8,14,.72)'; ctx.fill();
      ctx.strokeStyle = b[1]; ctx.stroke();
      ctx.textAlign = 'left'; ctx.font = '900 13px system-ui, sans-serif'; ctx.fillStyle = b[2];
      ctx.fillText('Main [LMB]: ' + b[0] + stars, 26, H - 71);
    }

    // Secondary-attack indicator (bottom-left) — only once a secondary is equipped.
    if (game.state === 'playing' && game.stats.secondary) {
      const sec = SECONDARY[game.stats.secondary];
      const ready = p.secondaryCooldown <= 0;
      const icy = game.stats.secondary === 'icewall';
      roundRectPath(ctx, 16, H - 52, 150, 36, 10); ctx.fillStyle = 'rgba(10,8,14,.72)'; ctx.fill();
      ctx.strokeStyle = ready ? (icy ? '#bff4ff' : '#d1a06a') : 'rgba(255,255,255,.18)'; ctx.stroke();
      ctx.textAlign = 'left'; ctx.font = '900 13px system-ui, sans-serif';
      ctx.fillStyle = ready ? '#fff1e2' : 'rgba(255,255,255,.5)';
      ctx.fillText('Secondary [RMB]', 26, H - 34);
      ctx.fillStyle = ready ? (icy ? '#bff4ff' : '#e0b07a') : 'rgba(255,255,255,.45)';
      ctx.fillText(sec ? T(sec.name) : '—', 26, H - 20);
      if (!ready && sec) {
        const f = 1 - p.secondaryCooldown / sec.cd;
        ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(108, H - 30, 48, 6);
        ctx.fillStyle = icy ? '#bff4ff' : '#e0b07a'; ctx.fillRect(108, H - 30, 48 * f, 6);
      }
    }
    ctx.restore();
  }

  function drawPanel(x, y, w, h) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, 'rgba(33,24,45,.93)');
    g.addColorStop(1, 'rgba(14,11,20,.93)');
    roundRectPath(ctx, x, y, w, h, 18);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,211,109,.32)';
    ctx.lineWidth = 3;
    ctx.stroke();
    roundRectPath(ctx, x + 8, y + 8, w - 16, h - 16, 12);
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawTitle() {
    const bg = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 520);
    bg.addColorStop(0, 'rgba(118,72,180,.35)'); bg.addColorStop(1, 'rgba(0,0,0,.76)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    drawPanel(150, 74, 660, 500);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd36d'; ctx.font = '900 46px system-ui, sans-serif';
    ctx.fillText('Mini Mage Mayhem', W / 2, 142);
    ctx.fillStyle = '#9fe7ff'; ctx.font = '900 20px system-ui, sans-serif';
    ctx.fillText('A top-down magic roguelike — 4 elements, fusions, chaos', W / 2, 178);
    ctx.fillStyle = '#f7ecd6'; ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('You have one spell. Upgrades overwrite it with elements.', W / 2, 218);
    ctx.fillText('Two elements fuse into a new spell that reshapes the battlefield.', W / 2, 244);
    const rows = [
      ['🔥 Fire', 'Fireball: ignites grass, detonates poison', '#ffbd66'],
      ['❄ Ice', 'Ice Shard: freezes water, slows foes', '#bff4ff'],
      ['☁ Fire + Ice', 'Steam Bomb: steam clouds, melt, slow', '#d8f6ff'],
      ['☣ Fire + Poison', 'Toxic Bomb: poison clouds that detonate', '#d998ff'],
      ['✦ Fire + Lightning', 'Plasma Bolt: explodes and conducts', '#ffd36d'],
      ['✹ Lightning + Ice', 'Frostvolt Bolt: conduct, slow, control', '#9fe7ff']
    ];
    for (let i = 0; i < rows.length; i++) {
      const y = 306 + i * 28;
      ctx.fillStyle = rows[i][2]; ctx.font = '900 16px system-ui, sans-serif'; ctx.fillText(rows[i][0], 300, y);
      ctx.fillStyle = '#f3e9dc'; ctx.font = '14px system-ui, sans-serif'; ctx.fillText(rows[i][1], 470, y);
    }
    ctx.fillStyle = '#ffd36d'; ctx.font = '900 24px system-ui, sans-serif';
    ctx.fillText('Tap or press Enter to start', W / 2, 522);
    ctx.fillStyle = '#c9c0d8'; ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('WASD move · Mouse aim · LMB cast · Space/Shift dash · R restart · (mobile: on-screen sticks)', W / 2, 550);
  }

  function upgradeMeta(up) {
    if (['inject_fire'].includes(up.id)) return { label: '元素', color: '#ffbd66' };
    if (['inject_ice'].includes(up.id)) return { label: '元素', color: '#bff4ff' };
    if (['inject_lightning'].includes(up.id)) return { label: '元素', color: '#9fe7ff' };
    if (['inject_poison'].includes(up.id)) return { label: '元素', color: '#d998ff' };
    if (['inject_earth'].includes(up.id)) return { label: '元素', color: '#c79a5b' };
    if (['split','explode','trail','big','spread','toxic_boom','ice_lake','ice_shatter','shock'].includes(up.id)) return { label: '改造', color: '#fff1bb' };
    if (up.id && up.id.indexOf('equip_') === 0) return { label: isSecMastery(up) ? '強化' : '副攻', color: '#8cecff' };
    if (['fist_mode','lightpalm_mode','windpalm_mode'].includes(up.id)) return { label: '肉搏', color: '#e0b07a' };
    if (['dash_cd','dash_power','dash_charge'].includes(up.id)) return { label: '衝刺', color: '#b7d8ff' };
    if (['danger','vamp','haste','vitality','swift','second_wind'].includes(up.id)) return { label: '通用', color: '#d7a0ff' };
    return { label: '升級', color: '#fff1bb' };
  }

  // Multiple build tags per upgrade card (max 3). See docs/design-vision §10.
  const TAGCOLOR = {
    '火': '#ffbd66', '冰': '#bff4ff', '雷': '#9fe7ff', '毒': '#d998ff', '風': '#dff3ff', '土': '#c79a5b', '精通': '#ffd36d',
    '元素': '#ffe6a7', '近戰': '#e0b07a', '環境': '#8ee07a', '控場': '#9fe7ff',
    '破壞': '#caa472', '高風險': '#ff7b72', '投擲': '#dff3ff', '衝刺': '#b7d8ff',
    '副攻': '#8cecff', '通用': '#d7a0ff', '改造': '#fff1bb', '畢業': '#ffcf6f'
  };
  function upgradeTags(up) {
    if (up.element) return isMastery(up) ? [ELEMENT_INFO[up.element].name, '精通'] : [ELEMENT_INFO[up.element].name, '元素'];
    const T = {
      split: ['改造'], explode: ['改造', '破壞'], trail: ['改造', '環境'], haste: ['改造'],
      big: ['改造'], vamp: ['通用'], spread: ['環境'], toxic_boom: ['毒', '環境'],
      shock: ['雷', '控場'], ice_lake: ['冰', '環境'], ice_shatter: ['冰', '控場'], danger: ['高風險'],
      dash_cd: ['衝刺'], dash_power: ['衝刺', '近戰'], dash_charge: ['衝刺'],
      equip_icewall: ['冰', '環境', '副攻'], equip_earthwall: ['環境', '破壞', '副攻'],
      equip_oil: ['火', '高風險', '副攻'], equip_blackhole: ['環境', '副攻'],
      fist_mode: ['近戰', '破壞'], lightpalm_mode: ['雷', '近戰', '控場'], windpalm_mode: ['風', '近戰', '控場'],
      vitality: ['通用'], swift: ['通用'], second_wind: ['通用'],
      cap_meteor: ['火', '土', '畢業'], cap_plague: ['火', '毒', '畢業'], cap_storm: ['土', '雷', '畢業'], cap_frostpoison: ['冰', '毒', '畢業'], cap_plasma: ['火', '雷', '畢業'], cap_glacier: ['土', '冰', '畢業'], cap_boil: ['火', '冰', '畢業'], cap_zero: ['雷', '冰', '畢業'], cap_venomnet: ['雷', '毒', '畢業'], cap_quagmire: ['土', '毒', '畢業']
    };
    return T[up.id] || ['升級'];
  }

  function drawUpgrade() {
    ctx.fillStyle = 'rgba(0,0,0,.64)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff0b5';
    ctx.font = '900 32px system-ui, sans-serif';
    ctx.fillText(game.wave >= 5 && !game.bossStarted ? 'Final upgrade before the boss!' : `Wave ${game.wave} cleared — pick an upgrade`, W / 2, 126);
    ctx.fillStyle = '#e9dcff';
    ctx.font = '700 15px system-ui, sans-serif';
    if (game.stats.mainMode === 'spell') {
      ctx.fillText(`Spell: ${T(game.stats.spellName)} | ${T(spellDescription(game.stats.spellKind))}`, W / 2, 154);
    } else {
      const BNAME = { fist: 'Earth Fist', lightpalm: 'Lightning Palm', windpalm: 'Wind Palm' }[game.stats.mainMode] || 'Melee';
      const els = game.stats.spellElements || [];
      const elTxt = els.length ? els.map(e => T((ELEMENT_INFO[e] && ELEMENT_INFO[e].name) || e)).join('+') : 'none';
      const reach = game.stats.mainMode === 'fist' ? 'punch/dash/secondary' : 'dash/secondary';
      ctx.fillText(`Main: ${BNAME} (melee) | element: ${elTxt} (affects ${reach})`, W / 2, 154);
    }
    for (let i = 0; i < game.upgrades.length; i++) {
      const up = game.upgrades[i];
      const x = 165 + i * 215;
      const y = 198;
      drawPanel(x, y, 195, 238);
      // build tags (chips)
      const tags = upgradeTags(up).slice(0, 3);
      ctx.textAlign = 'left';
      ctx.font = '900 11px system-ui, sans-serif';
      let chipX = x + 14;
      for (const t of tags) {
        const w = ctx.measureText(T(t)).width + 12;
        roundRectPath(ctx, chipX, y + 12, w, 18, 5);
        ctx.fillStyle = TAGCOLOR[t] || '#fff1bb'; ctx.fill();
        ctx.fillStyle = '#1b1420';
        ctx.fillText(T(t), chipX + 6, y + 25);
        chipX += w + 4;
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd36d';
      ctx.font = '900 19px system-ui, sans-serif';
      ctx.fillText(`${i + 1}. ${T(upgradeName(up))}`, x + 98, y + 58);

      if (up.element && !isMastery(up) && game.stats.mainMode === 'spell') { // projectile preview only when you actually have a projectile
        const preview = previewSpellState(up.element);
        const color = ELEMENT_INFO[preview.kind]?.color || '#fff1bb';
        const before = game.stats.spellName;
        ctx.fillStyle = 'rgba(255,255,255,.07)';
        ctx.fillRect(x + 16, y + 78, 163, 62);
        ctx.strokeStyle = preview.fused ? color : 'rgba(255,255,255,.14)';
        ctx.lineWidth = preview.fused ? 2 : 1;
        ctx.strokeRect(x + 16, y + 78, 163, 62);
        ctx.fillStyle = preview.fused ? color : '#fff08a';
        ctx.font = '900 13px system-ui, sans-serif';
        ctx.fillText(preview.fused ? 'Fusion preview' : 'Spell change', x + 98, y + 96);
        ctx.fillStyle = '#f3e9dc';
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.fillText(`${T(before)} →`, x + 98, y + 116);
        ctx.fillStyle = color;
        ctx.font = '900 16px system-ui, sans-serif';
        ctx.fillText(T(preview.name), x + 98, y + 134);
        ctx.fillStyle = '#e9dcff';
        ctx.font = '13px system-ui, sans-serif';
        wrapText(T(preview.desc), x + 98, y + 166, 158, 17);
      } else {
        ctx.fillStyle = '#e9dcff';
        ctx.font = '14px system-ui, sans-serif';
        wrapText(T(upgradeDesc(up)), x + 98, y + 92, 158, 18);
      }

      ctx.fillStyle = '#8cecff';
      ctx.font = '800 13px system-ui, sans-serif';
      ctx.fillText('Tap or press ' + (i + 1), x + 98, y + 214);
    }
    ctx.fillStyle = '#c9c0d8';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText(game.stats.mainMode === 'spell'
      ? 'Tip: element upgrades reshape your single attack; two fuse, a third replaces the oldest.'
      : 'Tip: melee main attack ignores elements; they infuse your dash & secondary (and the Earth Fist punch).', W / 2, 478);
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    const chars = [...text];
    let line = '';
    let yy = y;
    for (const ch of chars) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, yy);
        line = ch;
        yy += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, yy);
  }

  function drawEnd(win) {
    ctx.fillStyle = 'rgba(0,0,0,.65)';
    ctx.fillRect(0, 0, W, H);
    drawPanel(216, 76, 528, 520);
    ctx.textAlign = 'center';
    ctx.fillStyle = win ? '#afff9d' : '#ffb29d';
    ctx.font = '900 38px system-ui, sans-serif';
    ctx.fillText(win ? 'Victory! Disaster Survivor' : 'You Died — Magic Unleashed', W / 2, 138);
    ctx.fillStyle = '#f3e9dc';
    ctx.font = '17px system-ui, sans-serif';
    wrapText(T(makeRunStory(win)), W / 2, 174, 456, 20);
    ctx.fillText(`Spell: ${T(game.stats.spellName)} | Arena: ${game.run && game.run.arena ? T(game.run.arena.name) : T('未知')} | Flow: ${T(currentFlowName())}`, W / 2, 224);
    ctx.fillText(`Kills: ${game.kills}   Score: ${game.score}`, W / 2, 258);
    ctx.fillText(`Biggest boom kills: ${game.biggestBoom}   Poison detonations: ${game.chainBooms}`, W / 2, 292);
    ctx.fillText(`Water shocks: ${game.stats.waterElectrocutes}   Frozen pools: ${game.stats.frozenWater}   Steam clouds: ${game.stats.steamClouds}`, W / 2, 326);
    ctx.fillText(`Grass burnt / Walls broken: ${game.stats.burnedGrass}/${game.stats.shatteredWalls}   Fusions: ${game.stats.fusions}`, W / 2, 360);
    ctx.fillText(`Elite kills / Back hits / Blocks: ${game.stats.elitesKilled} / ${game.stats.backHits} / ${game.stats.frontBlocks}`, W / 2, 384);
    ctx.fillText(`Boss damage: ${Math.round(game.stats.bossDamage)}   Last hit: ${T(game.stats.bossLastHit)}`, W / 2, 406);
    ctx.fillStyle = '#fff08a';
    ctx.font = '800 16px system-ui, sans-serif';
    wrapText(`Biggest disaster: ${T(game.stats.biggestDisaster)}`, W / 2, 434, 450, 20);
    ctx.fillStyle = '#f3e9dc';
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillStyle = '#fff1bb';
    ctx.font = '700 15px system-ui, sans-serif';
    const evText = game.run && game.run.events.length ? game.run.events.map(T).join(' → ') : 'none';
    wrapText('Events: ' + evText, W / 2, 466, 440, 20);
    ctx.fillStyle = '#d7c7ff';
    const buildText = game.stats.upgradeNames.length ? game.stats.upgradeNames.map(T).join(' / ') : 'none';
    const spellText = game.stats.spellHistory ? game.stats.spellHistory.map(T).join(' → ') : T(game.stats.spellName);
    const fusionText = game.stats.fusionLog && game.stats.fusionLog.length ? ' | Fusions: ' + game.stats.fusionLog.map(T).join(' / ') : '';
    wrapText('Spell evo: ' + spellText + fusionText, W / 2, 506, 440, 20);
    wrapText('Build: ' + buildText, W / 2, 544, 440, 20);
    ctx.fillStyle = '#9fe7ff';
    ctx.font = '800 20px system-ui, sans-serif';
    ctx.fillText('Press R / tap to restart', W / 2, 574);
  }

