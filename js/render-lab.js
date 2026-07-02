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

// 低效能模式(?fx=low):關陰影/剝裝飾性點光/關玻璃 transmission(額外整景渲染 pass)。
// SwiftShader headless 測試與低階機用;觀感主體(emissive/ACES/additive)全保留。
export const FX_LOW = new URLSearchParams(location.search).get('fx') === 'low';
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
    renderer.shadowMap.enabled = !FX_LOW;
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
  key.castShadow = !FX_LOW;
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
  buildLabProps();
  buildLabDust();
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
  m.castShadow = shadow && !FX_LOW; m.receiveShadow = true; return m;
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
/* ==========================================================================
   帶區裝飾 —— 模組化:下面全是純 builder(回傳 Group,原型逐字移植),
   佈置由 LAB_LAYOUT 編排表決定(改佈局=改表;單位=tile,原點=場地中心)。
   預設編排原則:南帶是鏡頭前景 → 只放矮件;四座元素站在北帶(牆後露出,
   景深最佳);水槽/高傢俱進東西帶。
   ========================================================================== */
M.glass = (c = 0x7fe8ff, o = 0.22) => new THREE.MeshPhysicalMaterial({
  color: c, transparent: true, opacity: o, roughness: 0.05, metalness: 0,
  transmission: FX_LOW ? 0 : 0.6, emissive: c, emissiveIntensity: 0.08, side: THREE.DoubleSide });
M.wood = () => new THREE.MeshStandardMaterial({ color: 0x3a2b3f, roughness: 0.85 });

// 裝飾性點光:低效能模式不建(氛圍主力=emissive/貼花;點光是加分項)。回傳可能為 null,動畫端判空。
function decoLight(color, intensity, dist, decay = 2) {
  if (FX_LOW) return null;
  return new THREE.PointLight(color, intensity, dist, decay);
}
function groundDecal(g, color, r = 2.8) { // 站台腳下的發光環貼花(各站自帶,顏色=站的元素色)
  const d = new THREE.Mesh(new THREE.RingGeometry(r - 0.2, r + 0.2, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  d.rotation.x = -Math.PI / 2; d.position.y = 0.04; g.add(d);
  labAnimated.push({ update: t => { d.material.opacity = 0.25 + Math.sin(t * 2 + g.position.x) * 0.12; } });
}

function containmentTank(color = 0x5ff0e0, specimen = 'orb') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.5, 14), M.darkMetal(), 0, 0.25, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.8, 14), M.glass(color), 0, 2.0, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(1.15, 1.0, 0.45, 14), M.metal(), 0, 3.55, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 8), M.glow(color, 1.5), 0, 4.1, 0, false));
  const core = mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.5, 14),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 2.0, 0, false);
  g.add(core);
  let sp;
  if (specimen === 'orb') sp = mesh(new THREE.SphereGeometry(0.42, 14, 14), M.glow(color, 1.2), 0, 2, 0, false);
  if (specimen === 'cube') sp = mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), M.glow(color, 1.1), 0, 2, 0, false);
  if (specimen === 'crystal') sp = mesh(new THREE.OctahedronGeometry(0.45), M.glow(color, 1.3), 0, 2, 0, false);
  g.add(sp);
  const bubbles = [];
  for (let i = 0; i < 5; i++) {
    const b = mesh(new THREE.SphereGeometry(0.05 + Math.random() * 0.05, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
      (Math.random() - 0.5) * 1.2, 0.8 + Math.random() * 2.4, (Math.random() - 0.5) * 1.2, false);
    bubbles.push(b); g.add(b);
  }
  const light = decoLight(color, 0.9, 6 * LAB_SCALE); if (light) { light.position.y = 2.2; g.add(light); }
  labAnimated.push({ update: (t, dt) => {
    sp.position.y = 2 + Math.sin(t * 1.3 + g.position.x) * 0.25;
    sp.rotation.y += dt * 0.8;
    bubbles.forEach(b => { b.position.y += dt * 0.7; if (b.position.y > 3.3) b.position.y = 0.8; });
    if (light) light.intensity = 0.75 + Math.sin(t * 2.2 + g.position.z) * 0.2;
  } });
  return g;
}
function alchemyTable() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(3.4, 0.25, 1.5), M.wood(), 0, 1.15, 0));
  [[-1.4, -0.55], [1.4, -0.55], [-1.4, 0.55], [1.4, 0.55]].forEach(([x, z]) =>
    g.add(mesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), M.darkMetal(), x, 0.55, z)));
  const cols = [0x6dff9e, 0xff77e0, 0x53c8ff, 0xffb84f];
  for (let i = 0; i < 4; i++) {
    const col = cols[i];
    const fx = -1.2 + i * 0.8, fz = (i % 2 ? 0.3 : -0.25);
    g.add(mesh(new THREE.SphereGeometry(0.22, 10, 10), M.glass(col, 0.5), fx, 1.5, fz, false));
    const liquid = mesh(new THREE.SphereGeometry(0.15, 8, 8), M.glow(col, 1.5), fx, 1.44, fz, false);
    g.add(liquid);
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6), M.glass(col, 0.4), fx, 1.78, fz, false));
    labAnimated.push({ update: t => { liquid.material.emissiveIntensity = 1.2 + Math.sin(t * 3 + i * 2) * 0.5; } });
  }
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.08, 0.5), M.glow(0xc9b8ff, 0.35), 1.1, 1.32, 0.3));
  const l2 = decoLight(0x8affc0, 0.6, 4 * LAB_SCALE); if (l2) { l2.position.set(0, 1.9, 0); g.add(l2); }
  return g;
}
function bookshelf() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(2.6, 3.4, 0.8), M.wood(), 0, 1.7, 0));
  const cols = [0x6b4f8f, 0x3f5f8a, 0x8a3f5f, 0x4f8a6b, 0x8a7a3f];
  for (let row = 0; row < 3; row++) {
    g.add(mesh(new THREE.BoxGeometry(2.3, 0.08, 0.7), M.darkMetal(), 0, 0.9 + row * 0.95, 0.02));
    let x = -1.0;
    while (x < 1.0) {
      const w2 = 0.14 + Math.random() * 0.12, h2b = 0.55 + Math.random() * 0.25;
      const b = mesh(new THREE.BoxGeometry(w2, h2b, 0.5), M.stone(cols[Math.floor(Math.random() * cols.length)]), x, 0.95 + row * 0.95 + h2b / 2, 0.05);
      if (Math.random() < 0.15) b.rotation.z = 0.12;
      g.add(b); x += w2 + 0.05;
    }
  }
  const tome = mesh(new THREE.BoxGeometry(0.2, 0.6, 0.5), M.glow(0xff6db0, 1.4), 0.6, 2.35, 0.06, false);
  g.add(tome);
  labAnimated.push({ update: t => { tome.material.emissiveIntensity = 1.0 + Math.sin(t * 1.8) * 0.6; } });
  return g;
}
function machinery() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(2.6, 2.2, 1.6), M.darkMetal(), 0, 1.1, 0));
  g.add(mesh(new THREE.BoxGeometry(2.8, 0.3, 1.8), M.metal(), 0, 2.35, 0));
  const screen = mesh(new THREE.PlaneGeometry(1.4, 0.8), M.glow(0x53e0ff, 1.1), 0, 1.5, 0.82, false);
  g.add(screen);
  for (let i = 0; i < 3; i++) {
    const d = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10), M.glow([0xff5c5c, 0xffc14f, 0x6dff9e][i], 1.6), -0.8 + i * 0.8, 0.7, 0.82, false);
    d.rotation.x = Math.PI / 2; g.add(d);
    labAnimated.push({ update: t => { d.material.emissiveIntensity = (Math.sin(t * 4 + i * 2.1) > 0.3) ? 1.8 : 0.35; } });
  }
  const pipe = mesh(new THREE.TorusGeometry(0.5, 0.1, 8, 16, Math.PI), M.metal(0x453a6e), 0.7, 2.5, 0);
  pipe.rotation.z = Math.PI; g.add(pipe);
  labAnimated.push({ update: t => { screen.material.emissiveIntensity = 0.9 + Math.sin(t * 7) * 0.15; } });
  return g;
}
function displayCabinet(color, trophy) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.9, 1.6), M.darkMetal(), 0, 0.45, 0));
  g.add(mesh(new THREE.BoxGeometry(1.35, 1.5, 1.35), M.glass(color, 0.16), 0, 1.65, 0, false));
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.2, 1.6), M.metal(), 0, 2.5, 0));
  let item;
  if (trophy === 'skull') {
    item = new THREE.Group();
    item.add(mesh(new THREE.SphereGeometry(0.32, 10, 10), M.stone(0xcfc7e8), 0, 0.1, 0, false));
    item.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.25), M.stone(0xcfc7e8), 0, -0.15, 0.08, false));
  } else if (trophy === 'sword') {
    item = new THREE.Group();
    item.add(mesh(new THREE.BoxGeometry(0.08, 1.0, 0.02), M.glow(color, 0.9), 0, 0.15, 0, false));
    item.add(mesh(new THREE.BoxGeometry(0.4, 0.07, 0.07), M.metal(0x6e5a9e), 0, -0.3, 0, false));
  } else {
    item = mesh(new THREE.IcosahedronGeometry(0.35), M.glow(color, 1.5), 0, 0, 0, false);
  }
  item.position.y = 1.55; g.add(item);
  const l2 = decoLight(color, 0.7, 4 * LAB_SCALE); if (l2) { l2.position.y = 2.1; g.add(l2); }
  labAnimated.push({ update: (t, dt) => { item.rotation.y += dt * 0.9; item.position.y = 1.55 + Math.sin(t * 1.5) * 0.08; } });
  return g;
}
function warningSign() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g2 = c.getContext('2d');
  g2.fillStyle = '#181228'; g2.fillRect(0, 0, S, S);
  g2.save(); g2.beginPath(); g2.rect(8, 8, S - 16, S - 16); g2.clip();
  for (let i = -S; i < S * 2; i += 34) {
    g2.fillStyle = i / 34 % 2 ? '#e8a83c' : '#141020';
    g2.beginPath(); g2.moveTo(i, 0); g2.lineTo(i + 34, 0); g2.lineTo(i + 34 - S, S); g2.lineTo(i - S, S); g2.fill();
  }
  g2.restore();
  g2.fillStyle = '#181228'; g2.fillRect(34, 34, S - 68, S - 68);
  g2.strokeStyle = '#e8a83c'; g2.lineWidth = 6; g2.strokeRect(34, 34, S - 68, S - 68);
  g2.fillStyle = '#e8a83c'; g2.font = 'bold 110px serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  g2.fillText('⚠', S / 2, S / 2 - 14);
  g2.font = 'bold 26px monospace'; g2.fillText('ᛗᚨᚷᛁᚲ', S / 2, S / 2 + 62);
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.8 }));
  const g = new THREE.Group(); m.position.y = 2.1; g.add(m); return g;
}
function crackedGlassPanel() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g2 = c.getContext('2d');
  g2.strokeStyle = 'rgba(190,230,255,0.8)'; g2.lineWidth = 2;
  const cx = S * 0.4 + Math.random() * S * 0.2, cy = S * 0.4 + Math.random() * S * 0.2;
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * 6.28 + Math.random() * 0.4;
    let x = cx, y = cy;
    g2.beginPath(); g2.moveTo(x, y);
    for (let s = 0; s < 4; s++) { x += Math.cos(a) * (20 + Math.random() * 20); y += Math.sin(a) * (20 + Math.random() * 20); g2.lineTo(x, y); }
    g2.stroke();
  }
  for (let r = 18; r < 70; r += 20) { g2.beginPath(); g2.arc(cx, cy, r + Math.random() * 8, Math.random() * 3, Math.random() * 3 + 2.5); g2.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.18, roughness: 0.05,
      emissiveMap: tex, emissive: 0xbfe6ff, emissiveIntensity: 0.5, side: THREE.DoubleSide }));
  const g = new THREE.Group(); m.position.y = 1.25; m.rotation.x = -0.1; g.add(m); return g;
}
/* --- 四座元素實驗站(火/冰/毒/雷;原型逐字) --- */
function fireStation() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.7, 2.0, 0.5, 10), M.stone(0x33203a), 0, 0.25, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.1, 1.35, 0.9, 10), M.darkMetal(), 0, 0.95, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.25, 0.9, 0.5, 10), M.metal(0x4a2f3a), 0, 1.6, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.1, 10), M.glow(0xff7a2a, 2.2), 0, 1.85, 0, false));
  const flames = [];
  const fcols = [0xffd24f, 0xff8c2e, 0xff5c2a];
  for (let i = 0; i < 3; i++) {
    const f = mesh(new THREE.ConeGeometry(0.85 - i * 0.22, 1.9 - i * 0.35, 8),
      new THREE.MeshBasicMaterial({ color: fcols[i], transparent: true, opacity: 0.55 - i * 0.1, blending: THREE.AdditiveBlending, depthWrite: false }),
      0, 2.7 + i * 0.15, 0, false);
    flames.push(f); g.add(f);
  }
  const embers = [];
  for (let i = 0; i < 8; i++) {
    const e = mesh(new THREE.SphereGeometry(0.05, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb04f, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      (Math.random() - 0.5) * 1.2, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.2, false);
    embers.push(e); g.add(e);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 10), M.metal(0x5a2f2a), 1.8, 0.7, 0.6));
  g.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 10), M.metal(0x5a2f2a), 1.8, 0.7, -0.6));
  const light = decoLight(0xff7a2a, 2.4, 12 * LAB_SCALE); if (light) { light.position.set(0, 3, 0); g.add(light); }
  groundDecal(g, 0xff7a2a);
  labAnimated.push({ update: (t, dt) => {
    flames.forEach((f, i) => {
      f.scale.set(1 + Math.sin(t * 9 + i) * 0.12, 1 + Math.sin(t * 11 + i * 2) * 0.18, 1 + Math.cos(t * 9 + i) * 0.12);
      f.rotation.y += dt * (1 + i * 0.5);
    });
    embers.forEach((e, i) => {
      e.position.y += dt * (0.8 + i * 0.1);
      e.material.opacity = Math.max(0, e.material.opacity - dt * 0.4);
      if (e.position.y > 4.4) { e.position.y = 2.1; e.position.x = (Math.random() - 0.5) * 1.2; e.position.z = (Math.random() - 0.5) * 1.2; e.material.opacity = 0.9; }
    });
    if (light) light.intensity = 2.0 + Math.sin(t * 13) * 0.35 + Math.sin(t * 7.3) * 0.25;
  } });
  return g;
}
function frostStation() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.9, 2.1, 0.4, 10), M.metal(0x2a3350), 0, 0.2, 0));
  g.add(mesh(new THREE.CylinderGeometry(1.05, 1.05, 2.6, 12), M.glass(0x9fe8ff, 0.3), 0, 1.9, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(1.2, 1.05, 0.5, 12), M.metal(0x3a4a70), 0, 3.4, 0));
  const frozen = mesh(new THREE.OctahedronGeometry(0.5), M.glow(0x9fe8ff, 0.8), 0, 1.9, 0, false);
  g.add(frozen);
  const crys = M.glass(0xbdf2ff, 0.5); crys.emissive = new THREE.Color(0x7fdcff); crys.emissiveIntensity = 0.6;
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * 6.28, r = 1.4 + Math.random() * 0.8;
    const s = mesh(new THREE.ConeGeometry(0.22 + Math.random() * 0.18, 0.9 + Math.random() * 1.3, 5), crys,
      Math.cos(a) * r, 0.4, Math.sin(a) * r);
    s.rotation.z = (Math.random() - 0.5) * 0.9; s.rotation.x = (Math.random() - 0.5) * 0.9;
    g.add(s);
  }
  const mist = mesh(new THREE.TorusGeometry(1.9, 0.35, 8, 20),
    new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
    0, 0.35, 0, false);
  mist.rotation.x = Math.PI / 2; g.add(mist);
  const light = decoLight(0x7fdcff, 1.8, 11 * LAB_SCALE); if (light) { light.position.set(0, 2.5, 0); g.add(light); }
  groundDecal(g, 0x7fdcff);
  labAnimated.push({ update: (t, dt) => {
    frozen.rotation.y += dt * 0.15;
    frozen.material.emissiveIntensity = 0.6 + Math.sin(t * 1.2) * 0.3;
    mist.scale.setScalar(1 + Math.sin(t * 1.5) * 0.08);
    mist.material.opacity = 0.09 + Math.sin(t * 1.5) * 0.04;
    if (light) light.intensity = 1.6 + Math.sin(t * 1.8) * 0.3;
  } });
  return g;
}
function poisonStation() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.7, 1.5, 2.2, 12), M.metal(0x2c3a2e), 0, 1.1, 0));
  const rim2 = mesh(new THREE.TorusGeometry(1.7, 0.16, 8, 16), M.darkMetal(), 0, 2.2, 0);
  rim2.rotation.x = Math.PI / 2; g.add(rim2);
  const liquid = mesh(new THREE.CylinderGeometry(1.55, 1.55, 0.12, 12), M.glow(0x6dff5c, 1.8), 0, 2.18, 0, false);
  g.add(liquid);
  const bubbles = [];
  for (let i = 0; i < 7; i++) {
    const b = mesh(new THREE.SphereGeometry(0.1 + Math.random() * 0.12, 8, 8), M.glow(0x8aff6d, 1.2),
      (Math.random() - 0.5) * 2.2, 2.25, (Math.random() - 0.5) * 2.2, false);
    b.userData.s = 0.4 + Math.random(); bubbles.push(b); g.add(b);
  }
  const pipe = mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.4, 8), M.metal(0x3a4a3a), 1.2, 3.3, 0);
  pipe.rotation.z = 0.5; g.add(pipe);
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.1, 8), M.metal(0x3a4a3a), 2.1, 3.9, 0));
  const spill = mesh(new THREE.CircleGeometry(2.6, 16),
    new THREE.MeshBasicMaterial({ color: 0x4fdd3c, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
    0.6, 0.035, 0.6, false);
  spill.rotation.x = -Math.PI / 2; g.add(spill);
  const light = decoLight(0x6dff5c, 1.7, 11 * LAB_SCALE); if (light) { light.position.set(0, 3.2, 0); g.add(light); }
  groundDecal(g, 0x6dff5c);
  labAnimated.push({ update: (t) => {
    bubbles.forEach((b, i) => {
      const ph = (t * b.userData.s + i) % 2;
      b.position.y = 2.25 + ph * 0.35;
      b.scale.setScalar(Math.max(0.01, 1 - ph * 0.5));
    });
    liquid.material.emissiveIntensity = 1.5 + Math.sin(t * 2.6) * 0.4;
    if (light) light.intensity = 1.5 + Math.sin(t * 2.6) * 0.35;
  } });
  return g;
}
function lightningStation() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.5, 10), M.darkMetal(), 0, 0.25, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.55, 0.75, 4.2, 10), M.metal(0x3a3260), 0, 2.6, 0));
  for (let i = 0; i < 4; i++) {
    const ring = mesh(new THREE.TorusGeometry(0.85, 0.1, 8, 16), M.glow(0x9a6bff, 1.2), 0, 1.4 + i * 0.9, 0, false);
    ring.rotation.x = Math.PI / 2; g.add(ring);
    labAnimated.push({ update: t => { ring.material.emissiveIntensity = 0.8 + Math.sin(t * 5 - i * 1.2) * 0.7; } });
  }
  const orb = mesh(new THREE.SphereGeometry(0.6, 14, 14), M.glow(0xcaa8ff, 2.4), 0, 5.2, 0, false);
  g.add(orb);
  const rods = [];
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * 6.28 + 0.4;
    const rod = mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.6, 6), M.metal(0x4a4080), Math.cos(a) * 2.3, 0.8, Math.sin(a) * 2.3);
    const tip = mesh(new THREE.SphereGeometry(0.15, 8, 8), M.glow(0xb58cff, 1.5), Math.cos(a) * 2.3, 1.7, Math.sin(a) * 2.3, false);
    rods.push(tip.position.clone()); g.add(rod); g.add(tip);
  }
  const arcMat = new THREE.LineBasicMaterial({ color: 0xd9c2ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
  const arcs = rods.map(() => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, arcMat.clone()); g.add(line); return line;
  });
  const top = new THREE.Vector3(0, 5.2, 0);
  function boltPoints(a, b) {
    const pts = []; const N = 9;
    for (let i = 0; i <= N; i++) {
      const p = a.clone().lerp(b, i / N);
      if (i > 0 && i < N) { p.x += (Math.random() - 0.5) * 0.45; p.y += (Math.random() - 0.5) * 0.45; p.z += (Math.random() - 0.5) * 0.45; }
      pts.push(p);
    }
    return pts;
  }
  const light = decoLight(0xb58cff, 1.8, 13 * LAB_SCALE); if (light) { light.position.set(0, 4.5, 0); g.add(light); }
  groundDecal(g, 0xb58cff);
  let boltT = 0;
  labAnimated.push({ update: (t, dt) => {
    orb.material.emissiveIntensity = 2.0 + Math.sin(t * 6) * 0.8;
    orb.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
    boltT -= dt;
    if (boltT <= 0) {
      boltT = 0.08 + Math.random() * 0.12;
      arcs.forEach((line, i) => {
        const on = Math.random() < 0.55;
        line.visible = on;
        if (on) line.geometry.setFromPoints(boltPoints(top, rods[i]));
      });
      if (light) light.intensity = 1.2 + Math.random() * 2.2;
    }
  } });
  return g;
}
function crate() { // 帶區散落小木箱
  const g = new THREE.Group();
  const c = mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), M.stone(0x2c2450), 0, 0.35, 0);
  c.rotation.y = Math.random() * Math.PI;
  const band = mesh(new THREE.BoxGeometry(0.74, 0.12, 0.74), M.glow(0x7a4dff, 0.7), 0, 0, 0, false);
  c.add(band); g.add(c); return g;
}

/* ---------- LAB_LAYOUT 編排表:改佈局=改這張表(x/z 單位=tile,原點=場地中心) ----------
   核心牆在 x=±14.5 / z=±9.5;帶區:北/南 z=±10..±15,東/西 x=±15..±17。
   南帶=鏡頭前景 → 只放矮件;元素站全在北帶(從北牆後露出,景深最佳)。 */
const BUILDERS = { tank: containmentTank, alchemy: alchemyTable, shelf: bookshelf, machine: machinery,
  cabinet: displayCabinet, sign: warningSign, glass: crackedGlassPanel, crate,
  fire: fireStation, frost: frostStation, poison: poisonStation, lightning: lightningStation };
export const LAB_LAYOUT = [
  // 北帶:四座元素實驗站(火/冰/毒/雷)
  { type: 'fire',      x: -11.5, z: -11.7, ry: Math.PI * 0.25 },
  { type: 'frost',     x: -4,    z: -11.9, ry: -Math.PI * 0.25 },
  { type: 'poison',    x: 4,     z: -11.9, ry: -Math.PI * 0.2 },
  { type: 'lightning', x: 11.5,  z: -11.7, ry: 0 },
  // 東/西帶:收容水槽+高傢俱
  { type: 'tank', x: -16, z: -6,   ry: Math.PI / 2,  args: [0x5ff0e0, 'orb'] },
  { type: 'tank', x: -16, z: 0,    ry: Math.PI / 2,  args: [0x8aff6d, 'cube'] },
  { type: 'tank', x: -16, z: 6,    ry: Math.PI / 2,  args: [0xb58cff, 'orb'] },
  { type: 'tank', x: 16,  z: -6,   ry: -Math.PI / 2, args: [0x53c8ff, 'crystal'] },
  { type: 'tank', x: 16,  z: 6,    ry: -Math.PI / 2, args: [0xff8ad0, 'crystal'] },
  { type: 'shelf',   x: 16,  z: 0,    ry: -Math.PI / 2 },
  { type: 'machine', x: -16, z: -11,  ry: Math.PI / 2 },
  // 南帶(前景):矮件
  { type: 'alchemy', x: 0,    z: 11.6, ry: Math.PI },
  { type: 'cabinet', x: -5.8, z: 11.6, ry: Math.PI, args: [0xffc14f, 'skull'] },
  { type: 'cabinet', x: 5.4,  z: 11.6, ry: Math.PI, args: [0x53e0ff, 'sword'] },
  { type: 'crate', x: -10.5, z: 11.2 }, { type: 'crate', x: 9.8, z: 11.5 }, { type: 'crate', x: 12.6, z: 11 },
  { type: 'crate', x: -8, z: -11.2 }, { type: 'crate', x: 8.2, z: -11 },
  // 警告標誌(掛核心牆內面)+裂玻璃(斜靠牆)
  { type: 'sign', x: -2,     z: -9.12, ry: 0 },
  { type: 'sign', x: 9,      z: -9.12, ry: 0 },
  { type: 'sign', x: 14.12,  z: 5,     ry: -Math.PI / 2 },
  { type: 'sign', x: -14.12, z: -5,    ry: Math.PI / 2 },
  { type: 'glass', x: -9.8,  z: -9.05, ry: 0 },
  { type: 'glass', x: 14.05, z: -6.5,  ry: -Math.PI / 2 },
];
function buildLabProps() {
  for (const item of LAB_LAYOUT) {
    const b = BUILDERS[item.type]; if (!b) continue;
    const g = b(...(item.args || []));
    g.position.set(item.x, 0, item.z); g.rotation.y = item.ry || 0;
    labGroup.add(g);
  }
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
    const u = hit.object.userData.unit; if (u) u.target = 0; // 完全透明(玩家反饋:0.18 殘影仍擋視線);邊界提示由牆基能量管+地板邊緣承擔
  }
  for (const u of _fadeUnits) {
    u.op += (u.target - u.op) * 0.25;
    if (Math.abs(u.target - u.op) < 0.01) u.op = u.target;
    for (const m of u.mats) m.opacity = u.op;
  }
}

/* ---------- 飄浮魔塵(原型 atmosphere;Points 便宜,低效能也開) ---------- */
function buildLabDust() {
  const dustGeo = new THREE.BufferGeometry();
  const N = 260, pos = new Float32Array(N * 3), spd = [];
  for (let i = 0; i < N; i++) {
    pos[i * 3] = CX + (Math.random() - 0.5) * SCENE_W * LAB_SCALE;
    pos[i * 3 + 1] = Math.random() * 8 * LAB_SCALE + 16;
    pos[i * 3 + 2] = CZ + (Math.random() - 0.5) * SCENE_D * LAB_SCALE;
    spd.push((0.1 + Math.random() * 0.25) * LAB_SCALE);
  }
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xb9a8ff, size: 0.09 * LAB_SCALE, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(dust);
  labAnimated.push({ update: (t, dt) => {
    const p = dust.geometry.attributes.position.array;
    for (let i = 0; i < N; i++) {
      p[i * 3 + 1] += spd[i] * dt;
      if (p[i * 3 + 1] > 9 * LAB_SCALE) p[i * 3 + 1] = 13;
    }
    dust.geometry.attributes.position.needsUpdate = true;
  } });
}

/* ---------- 每幀更新(facade render3D 呼叫;dt 由 t 差分) ---------- */
window.__lab = { fadeUnits: _fadeUnits, labGroup, labAnimated }; // debug hook(headless 測試用)
let _lastT = 0;
export function updateLabScene(t) {
  const dt = Math.min(Math.max(t - _lastT, 0), 0.05); _lastT = t;
  for (const a of labAnimated) a.update(t, dt);
  updateLabWallFade();
}
