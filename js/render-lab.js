// render-lab.js — v2 魔法實驗室場景(復刻使用者的 arcane containment 原型,非換皮):
// 完整採用原型的渲染管線 —— MeshStandard + emissive 貼圖(真自發光)、ACES 電影調色、
// sRGB 輸出、PCFSoft 陰影、局部點光源。只在 v2.html 啟用(每頁獨立 renderer,單機零影響)。
// 原型單位:1 unit = 1 tile;我們的世界:1 tile = 32px → 一律乘 LAB_SCALE 換算,
// builder 幾乎逐字移植。碰撞/模擬完全不動(牆的碰撞仍在 30×20 核心邊界)。
import { W, H, TILE } from './constants.js';
import { game } from './state.js';
import { renderer, scene, camera } from './render-core.js';

const LAB_SCALE = TILE;                 // 1 原型單位 = 32 世界px
const CX = W / 2, CZ = H / 2;           // 場地中心(世界px)
const SCENE_W = 34, SCENE_D = 30;       // 總場景(tiles) — 牆外含裝飾帶
const CORE_W = 30, CORE_D = 20;         // 戰鬥核心區(tiles) = 現行模擬場地(=W/H)
export const LAB = { SCENE_W, SCENE_D, CORE_W, CORE_D, CX, CZ, S: LAB_SCALE };

export const labAnimated = [];          // { update(t, dt) } — updateLabScene 每幀跑
let labBuilt = false;

/* ---------- 原型地板:暗藍紫石磚 + 發光溝縫/焦痕/符文(map + emissive 雙貼圖) ---------- */
function makeFloorTextures() {
  const S = 1024, tiles = 8, t = S / tiles;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const e = document.createElement('canvas'); e.width = e.height = S;
  const ge = e.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  // base tiles with variation
  for (let y = 0; y < tiles; y++) for (let x = 0; x < tiles; x++) {
    const v = 0.85 + Math.random() * 0.3;
    g.fillStyle = `rgb(${Math.floor(26 * v)},${Math.floor(22 * v)},${Math.floor(48 * v)})`;
    g.fillRect(x * t, y * t, t, t);
    g.strokeStyle = 'rgba(255,255,255,0.04)';
    g.lineWidth = 3; g.strokeRect(x * t + 4, y * t + 4, t - 8, t - 8);
  }
  // wear / soft noise
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 230 : 0},255,${Math.random() * 0.03})`;
    g.fillRect(Math.random() * S, Math.random() * S, Math.random() * 8 + 1, Math.random() * 8 + 1);
  }
  // scratches
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI, L = 20 + Math.random() * 90;
    g.strokeStyle = `rgba(200,200,230,${0.03 + Math.random() * 0.06})`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  // stains
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 18 + Math.random() * 55;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const hue = Math.random() < 0.4 ? '20,40,25' : '12,10,26';
    grad.addColorStop(0, `rgba(${hue},0.35)`); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // magical scorch marks (+ faint residue ring on emissive)
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 25 + Math.random() * 45;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(5,3,10,0.85)');
    grad.addColorStop(0.6, 'rgba(30,10,50,0.4)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    ge.strokeStyle = `rgba(${Math.random() < 0.5 ? '140,80,255' : '80,220,255'},0.25)`;
    ge.lineWidth = 2; ge.beginPath(); ge.arc(x, y, r * 0.55, Math.random() * 3, Math.random() * 3 + 3); ge.stroke();
  }
  // cracks
  for (let i = 0; i < 22; i++) {
    let x = Math.random() * S, y = Math.random() * S;
    g.strokeStyle = 'rgba(8,5,16,0.8)'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 46; y += (Math.random() - 0.5) * 46; g.lineTo(x, y); }
    g.stroke();
  }
  // glowing grout lines (recessed purple; 真發光在 emissive 貼圖上)
  g.strokeStyle = 'rgba(60,30,110,0.9)'; g.lineWidth = 4;
  ge.strokeStyle = 'rgba(130,70,255,0.9)'; ge.lineWidth = 3;
  for (let i = 0; i <= tiles; i++) {
    g.beginPath(); g.moveTo(i * t, 0); g.lineTo(i * t, S); g.stroke();
    g.beginPath(); g.moveTo(0, i * t); g.lineTo(S, i * t); g.stroke();
    ge.beginPath(); ge.moveTo(i * t, 0); ge.lineTo(i * t, S); ge.stroke();
    ge.beginPath(); ge.moveTo(0, i * t); ge.lineTo(S, i * t); ge.stroke();
  }
  // fade grout glow with random dark gaps (worn energy lines)
  for (let i = 0; i < 160; i++) {
    ge.fillStyle = 'rgba(0,0,0,0.85)';
    const along = Math.random() < 0.5;
    const gx = Math.floor(Math.random() * (tiles + 1)) * t;
    if (along) ge.fillRect(gx - 4, Math.random() * S, 8, 20 + Math.random() * 60);
    else ge.fillRect(Math.random() * S, gx - 4, 20 + Math.random() * 60, 8);
  }
  // glowing rune decals
  const runes = 'ᚠᚢᚦᚨᚱᚲᛃᛇᛉᛋᛏᛒᛖᛗᛚᛝ';
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const col = ['rgba(120,80,255,', 'rgba(70,220,255,', 'rgba(120,255,150,'][Math.floor(Math.random() * 3)];
    ge.strokeStyle = col + '0.7)'; ge.lineWidth = 2;
    ge.beginPath(); ge.arc(x, y, 16, 0, 7); ge.stroke();
    ge.fillStyle = col + '0.8)';
    ge.font = '20px serif'; ge.textAlign = 'center'; ge.textBaseline = 'middle';
    ge.fillText(runes[Math.floor(Math.random() * runes.length)], x, y);
  }
  const map = new THREE.CanvasTexture(c); map.encoding = THREE.sRGBEncoding;
  const emissive = new THREE.CanvasTexture(e);
  map.wrapS = map.wrapT = emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
  map.repeat.set(SCENE_W / 16, SCENE_D / 16); emissive.repeat.set(SCENE_W / 16, SCENE_D / 16);
  return { map, emissive };
}

/* ---------- 原型中央魔法陣(破損符文陣;蓋在收容艙下) ---------- */
function makeCircleTexture() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const cx = S / 2, cy = S / 2;
  g.clearRect(0, 0, S, S);
  const P = 'rgba(160,110,255,'; const C = 'rgba(110,220,255,';
  function ring(r, w, col, alpha, gaps) {
    g.strokeStyle = col + alpha + ')'; g.lineWidth = w;
    let a = Math.random() * 6.28;
    for (let s = 0; s < gaps.length; s++) {
      g.beginPath(); g.arc(cx, cy, r, a, a + gaps[s][0]); g.stroke();
      a += gaps[s][0] + gaps[s][1];
    }
  }
  ring(470, 10, P, 0.95, [[2.2, 0.35], [1.4, 0.5], [1.1, 0.25]]);
  ring(440, 3, P, 0.7, [[3.1, 0.2], [2.4, 0.5]]);
  ring(330, 6, C, 0.85, [[1.8, 0.3], [2.6, 0.4], [0.9, 0.3]]);
  ring(210, 8, P, 0.9, [[2.9, 0.5], [2.2, 0.7]]);
  ring(120, 4, C, 0.8, [[5.6, 0.7]]);
  // inner hexagram
  g.strokeStyle = P + '0.85)'; g.lineWidth = 5;
  for (let tri = 0; tri < 2; tri++) {
    g.beginPath();
    for (let k = 0; k <= 3; k++) {
      const a = tri * Math.PI / 3 + k * 2 * Math.PI / 3 - Math.PI / 2;
      const x = cx + Math.cos(a) * 300, y = cy + Math.sin(a) * 300;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
  // runes around ring (missing = damage)
  const runes = 'ᚠᚢᚦᚨᚱᚲᛃᛇᛉᛋᛏᛒᛖᛗᛚᛝᛞᛟ';
  g.font = '42px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 26; i++) {
    if (Math.random() < 0.2) continue;
    const a = i / 26 * Math.PI * 2;
    g.fillStyle = Math.random() < 0.7 ? P + '0.9)' : C + '0.9)';
    g.save(); g.translate(cx + Math.cos(a) * 395, cy + Math.sin(a) * 395);
    g.rotate(a + Math.PI / 2);
    g.fillText(runes[i % runes.length], 0, 0); g.restore();
  }
  // small orbit nodes
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + 0.5;
    g.fillStyle = C + '0.9)';
    g.beginPath(); g.arc(cx + Math.cos(a) * 265, cy + Math.sin(a) * 265, 14, 0, 7); g.fill();
  }
  // damage: dark cracks erasing glow
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) {
    let x = cx + (Math.random() - 0.5) * 700, y = cy + (Math.random() - 0.5) * 700;
    g.lineWidth = 8 + Math.random() * 14; g.strokeStyle = 'rgba(0,0,0,0.95)';
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += (Math.random() - 0.5) * 130; y += (Math.random() - 0.5) * 130; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
  return tex;
}

/* ---------- 建場:管線 profile + 氛圍 + 燈光組 + 地板 + 魔法陣 ---------- */
export function initLabScene() {
  if (labBuilt) return; labBuilt = true;
  // 渲染管線(原型 profile;v2 頁面獨立 renderer,單機不受影響)
  if (renderer) {
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  scene.background = new THREE.Color(0x0a0818);
  scene.fog = new THREE.FogExp2(0x0d0a20, 0.016 / LAB_SCALE); // 原型密度按單位換算

  // 燈光組:原型的暗實驗室配置,但整體加亮 —— 角色是 Lambert 受光,原封值會吃掉藍/紅身分色
  scene.add(new THREE.AmbientLight(0x37306a, 1.6));
  scene.add(new THREE.HemisphereLight(0x4a3f8e, 0x0a0818, 0.8));
  const key = new THREE.DirectionalLight(0x9a8cd8, 0.55);
  key.position.set(CX + 14 * LAB_SCALE, 26 * LAB_SCALE, CZ + 10 * LAB_SCALE);
  key.target.position.set(CX, 0, CZ); scene.add(key.target);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -25 * LAB_SCALE;
  key.shadow.camera.right = key.shadow.camera.top = 25 * LAB_SCALE;
  key.shadow.camera.far = 4000;
  scene.add(key);

  // 地板:34×30 總場景一整片(核心+裝飾帶),map+emissive 雙貼圖
  const floorTex = makeFloorTextures();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(SCENE_W * LAB_SCALE, SCENE_D * LAB_SCALE),
    new THREE.MeshStandardMaterial({
      map: floorTex.map, emissiveMap: floorTex.emissive,
      emissive: 0xffffff, emissiveIntensity: 0.42,
      roughness: 0.62, metalness: 0.35,
    })
  );
  floor.rotation.x = -Math.PI / 2; floor.position.set(CX, -0.5, CZ);
  floor.receiveShadow = true;
  scene.add(floor);

  // 中央魔法陣(收容艙腳下) + 紫色點光
  const circleMat = new THREE.MeshBasicMaterial({
    map: makeCircleTexture(), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const magicCircle = new THREE.Mesh(new THREE.PlaneGeometry(8 * LAB_SCALE, 8 * LAB_SCALE), circleMat); // 原型 13 units;我們的鏡頭近,縮到 8 才不搶戲
  magicCircle.rotation.x = -Math.PI / 2; magicCircle.position.set(CX, 1, CZ);
  scene.add(magicCircle);
  const circleGlow = new THREE.PointLight(0x9a5cff, 1.6, 16 * LAB_SCALE, 2);
  circleGlow.position.set(CX, 1.2 * LAB_SCALE, CZ); scene.add(circleGlow);
  scene.add(labGroup);
  buildLabWalls();
  buildLabEnergyTubes();
  labAnimated.push({ update: (t) => {
    magicCircle.rotation.z = t * 0.05;
    circleMat.opacity = 0.55 + Math.sin(t * 1.4) * 0.15;
    circleGlow.intensity = 1.3 + Math.sin(t * 1.4) * 0.5;
  } });
}

/* ---------- 原型材質庫(牆/柱/管用;MeshStandard) ---------- */
const M = {
  metal: (c = 0x2b2545) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.8 }),
  darkMetal: () => new THREE.MeshStandardMaterial({ color: 0x1c1832, roughness: 0.5, metalness: 0.85 }),
  stone: (c = 0x241e3e) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0.1 }),
  glow: (c, i = 1.6) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.4 }),
};
function mesh(geo, mat, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true; return m;
}
// 所有原型 builder 都建在這個 ×32 縮放的 group 裡 → 幾何常數可逐字保留(原型單位)
const labGroup = new THREE.Group();
labGroup.scale.setScalar(LAB_SCALE); labGroup.position.set(CX, 0, CZ);

/* ---------- 牆板/角柱(原型 buildWalls;移到 30×20 核心邊界=碰撞位置) ---------- */
const WALL_HX = CORE_W / 2 - 0.5;   // 14.5:牆磚帶(最外圈 tile)的中心線
const WALL_HZ = CORE_D / 2 - 0.5;   // 9.5
const _fadeUnits = [];               // { meshes, mats, op, target } — lab 牆自己的穿牆淡出
function buildLabWalls() {
  const wall = new THREE.Group();
  function addPanelSide(length, fixedX, fixedZ, rotY, sideIndex) {
    const panelCount = Math.ceil(length / 4);
    const seg = length / panelCount;
    for (let i = 0; i < panelCount; i++) {
      const local = -length / 2 + seg / 2 + i * seg;
      const p = mesh(new THREE.BoxGeometry(seg * 0.96, 3.4, 0.7), M.stone(0x201a38), 0, 1.7, 0);
      p.scale.y = 0.92 + ((i * 7 + sideIndex * 3) % 5) * 0.05;
      const trim = mesh(new THREE.BoxGeometry(seg * 0.96, 0.14, 0.16), M.glow(0x7a4dff, 1.2), 0, 3.15 * p.scale.y, 0.32, false);
      const g = new THREE.Group(); g.add(p); g.add(trim);
      const unit = { meshes: [p], mats: [p.material, trim.material], op: 1, target: 1 };
      if (i % 2 === 0) {
        const seam = mesh(new THREE.BoxGeometry(0.1, 2.6, 0.06), M.glow(0x4a2fd0, 0.8), -seg / 2, 1.6, 0.34, false);
        g.add(seam); unit.mats.push(seam.material);
      }
      for (const m of unit.mats) { m.transparent = true; }
      _fadeUnits.push(unit); p.userData.unit = unit;
      g.rotation.y = rotY;
      if (Math.abs(Math.sin(rotY)) < 0.1) g.position.set(local, 0, fixedZ);
      else g.position.set(fixedX, 0, local);
      wall.add(g);
    }
  }
  addPanelSide(CORE_W, 0, -WALL_HZ, 0, 0);           // north
  addPanelSide(CORE_W, 0, WALL_HZ, Math.PI, 1);      // south
  addPanelSide(CORE_D, -WALL_HX, 0, Math.PI / 2, 2); // west
  addPanelSide(CORE_D, WALL_HX, 0, -Math.PI / 2, 3); // east
  // corner pillars + 脈動光球
  const pillarG = new THREE.CylinderGeometry(0.9, 1.1, 5.4, 8);
  const capG = new THREE.CylinderGeometry(1.05, 0.9, 0.5, 8);
  [[-WALL_HX, -WALL_HZ], [WALL_HX, -WALL_HZ], [-WALL_HX, WALL_HZ], [WALL_HX, WALL_HZ]].forEach(([x, z]) => {
    const pil = mesh(pillarG, M.darkMetal(), x, 2.7, z);
    const cap = mesh(capG, M.metal(0x352c58), x, 5.6, z);
    const orb = mesh(new THREE.SphereGeometry(0.34, 12, 12), M.glow(0xb08cff, 2), x, 6.1, z, false);
    const unit = { meshes: [pil], mats: [pil.material, cap.material, orb.material], op: 1, target: 1 };
    for (const m of unit.mats) m.transparent = true;
    _fadeUnits.push(unit); pil.userData.unit = unit;
    labAnimated.push({ update: t => { orb.material.emissiveIntensity = 1.6 + Math.sin(t * 2 + x + z) * 0.6; } });
    wall.add(pil); wall.add(cap); wall.add(orb);
  });
  labGroup.add(wall);
}
/* ---------- 能量管(原型 buildEnergyTubes;沿牆基內側) ---------- */
function buildLabEnergyTubes() {
  const colors = [0x53e0ff, 0x8a5cff, 0x6dff9e, 0xffa14f];
  const offX = WALL_HX - 0.6, offZ = WALL_HZ - 0.6;
  function addTube(length, x, z, rotY, color, phase) {
    const tube = mesh(new THREE.CylinderGeometry(0.13, 0.13, length, 10), M.glow(color, 1.4), 0, 0, 0, false);
    tube.rotation.z = Math.PI / 2;
    const g = new THREE.Group(); g.add(tube);
    g.rotation.y = rotY;
    g.position.set(x, 0.5, z);
    labGroup.add(g);
    labAnimated.push({ update: t => { tube.material.emissiveIntensity = 1.1 + Math.sin(t * 3 + phase) * 0.5; } });
  }
  addTube(CORE_W - 4, 0, -offZ, 0, colors[0], 0.0);
  addTube(CORE_D - 4, -offX, 0, Math.PI / 2, colors[1], 1.7);
  addTube(CORE_W - 4, 0, offZ, Math.PI, colors[2], 3.4);
  addTube(CORE_D - 4, offX, 0, -Math.PI / 2, colors[3], 5.1);
}
/* ---------- lab 牆的穿牆淡出:鏡頭→本機角色射線打到的牆板/角柱 → 淡出 ---------- */
const _labRay = new THREE.Raycaster();
const _labDir = new THREE.Vector3();
const _fadeMeshes = [];
function updateLabWallFade() {
  const tgt = game.occludeTarget;
  if (!tgt) return;
  for (const u of _fadeUnits) u.target = 1;
  _labDir.set(tgt.x, 26, tgt.y).sub(camera.position);
  const distTo = _labDir.length(); _labDir.normalize();
  _labRay.set(camera.position, _labDir); _labRay.far = distTo;
  if (!_fadeMeshes.length) for (const u of _fadeUnits) _fadeMeshes.push(...u.meshes);
  labGroup.updateMatrixWorld(true);
  for (const hit of _labRay.intersectObjects(_fadeMeshes, false)) {
    const u = hit.object.userData.unit; if (u) u.target = 0.18;
  }
  for (const u of _fadeUnits) {
    u.op += (u.target - u.op) * 0.25;
    if (Math.abs(u.target - u.op) < 0.01) u.op = u.target;
    for (const m of u.mats) m.opacity = u.op;
  }
}

/* ---------- 每幀更新(facade render3D 呼叫;dt 由 t 差分) ---------- */
window.__lab = { fadeUnits: _fadeUnits, labGroup, labAnimated }; // debug hook(headless 測試用)
let _lastT = 0;
export function updateLabScene(t) {
  const dt = Math.min(Math.max(t - _lastT, 0), 0.05); _lastT = t;
  for (const a of labAnimated) a.update(t, dt);
  updateLabWallFade();
}
