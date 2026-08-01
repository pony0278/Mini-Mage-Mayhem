// render-shock.js — 觸電命中演出(shock-1):使用者「電擊命中特效 v1.1(X光閃現)」移植。
// **判定不動**=純演出:sim 三個電擊擊暈來源(電鞭直擊 castLightning / 元素站雷 eruptStation /
// 踩電水 FL.CHARGED)只設 `f.shockT = game.time + SHOCK_T`,這裡讀旗演出。演出時長=擊暈時長
// → 這個特效本身就是「他還在暈」的告示(舊況:被電暈跟被打暈畫面上都只有頭上一顆 ★)。
//
// 四層(全部照使用者 demo 的做法):
//  ① 包裹電弧:橢球面取兩點 → **中點位移鋸齒**(每層 15% 機率放大 2.2 倍=突發大跳變,電漿的正確做法)
//     + 分支;每 regenMs 整組重擲=離散閃爍(電流不能平滑補間)。同 render-whip 的電流語言。
//  ② 節點光點:路徑點抽樣 + 徑向漸層貼圖 Points。
//  ③ 星芒爆裂:不規則尖刺多邊形雙層,billboard;**沿視線推到角色後方**讓角色壓在星芒前(demo v1.1 的分層修正)。
//  ④ X光閃現:每次閃爍抽一次 → 角色整組換成扁平深色剪影 + 骷髏浮現。
//
// **骨架=rig 驅動**(不是 demo 的靜態骷髏):骨頭 mesh 直接掛在 brawler rig 節點(headPivot/spine/
// pelvis/armX.{sh,lm,wr}/legX.{hp,lm,ankle})上,姿勢自動跟著跑——暈眩、掙扎、被扛都對得上。
// 方塊人與 avatar 共用同一套:avatar 是從 box rig 世界差量重定向的,掛 box rig 兩邊同時正確。
//
// perf(js/CLAUDE.md「特效 perf 鐵則」;item-4f 卡頓後立的):
//  · **不加燈**——demo 的 shockLight PointLight 拿掉(lab 為手機已把燈 18→6,再加一盞是全場景常駐成本)。
//  · 電弧/星芒/節點全部**預配置 buffer**,重擲只改頂點+setDrawRange;demo 的 regenBurst 每 45ms
//    dispose()+new BufferGeometry(≈22 次/秒)已改掉。
//  · 鋸齒路徑用 ping-pong Float32Array,**零 Vector3 配置**(demo 每次重擲 new 150~300 個=GC 抖動)。
//  · 幾何/材質 module 級共用,開機 prewarm 預編譯。FX_LOW 砍節點光點+分支+外暈層。
import { game } from './state.js';
import { BOX_STAND_H } from './actor-brawler.js';
import { scene, renderer, camera } from './render-core.js';
import { FX_LOW } from './render-lab.js';

// ===== 使用者 demo 定稿參數(electric_shock_v1.1,原樣保存;loop/shockDuration 是 demo 自播欄位,
// 遊戲端時長由 sim 的 f.shockT 給=綁擊暈時長,不取用 shockDuration)=====
const LAB = { "arcCount": 10, "arcJag": 0.35, "branchChance": 0.5, "regenMs": 45, "spikeCount": 14, "burstSize": 1.15, "pulseSpeed": 9, "pulseAmp": 0.35, "shockDuration": 1.6, "xrayRatio": 0.6, "colorCore": "#ffffff", "colorGlow": "#ffe14d" };

// 尺寸換算(shock-1b):**全部按「×受害者實際站高」比例現算**,不走固定倍率——一開始用 K=28 是照
// 方塊人身高(≈48px)換的,但 avatar 帶 AVATAR_SCALE 1.3 站高 ≈60px、中心也更高,固定橢球只包到
// 下半身=使用者反饋「電弧停在身體中央,沒包住 GLB 角色」。比例=demo 值 ÷ demo 角色身高 1.67
//(頭球頂 1.25+0.42):橢球 (0.62,0.88,0.55)、電效中心 0.95。每副 rig 的實際尺寸在 refreshSize 現算。
const DEMO_H = 1.67;
const P = {
  arcCount: LAB.arcCount, arcJag: LAB.arcJag, branchChance: LAB.branchChance, regenMs: LAB.regenMs,
  spikeCount: LAB.spikeCount, burstSize: LAB.burstSize / DEMO_H,
  pulseSpeed: LAB.pulseSpeed, pulseAmp: LAB.pulseAmp, xrayRatio: LAB.xrayRatio,
  ex: 0.62 / DEMO_H, ey: 0.88 / DEMO_H, ez: 0.55 / DEMO_H,   // 包裹橢球(×身高)
  cy: 0.95 / DEMO_H,                                // 電效中心高(×身高;demo TARGET_CENTER y)
  minArc: 0.75 / DEMO_H,                            // 橢球取點的最小間距(×身高)
  burstBack: 0.9 / DEMO_H,                          // 星芒沿視線往後推(角色壓在星芒前)
  nodeSize: 0.16 / DEMO_H,
  fade: 0.25,                                       // 尾段淡出秒數(demo envelope)
};
// 方塊人站高:ugc-6 起方塊人是預設角色且整體放大到與 avatar 同高(見 actor-brawler SPEC.boxScale)。
// ⚠ **不能在模組層取值**:render-shock ↔ actor-brawler 之間有 import 循環,模組層讀會是 TDZ
//(實測 `Cannot access 'BOX_STAND_H' before initialization`,整頁掛掉)→ 一律呼叫時才讀。
const boxH = () => BOX_STAND_H;
const CORE = 0xffffff, GLOW = 0xffe14d;             // 使用者定稿黃白(拍板 2026-07-27:武器藍/觸電黃白不強求一致)
const BONE = 0xffffff, HOLE = 0x1a0e06, SIL = 0x33200f;

// brawler rig 的骨長(鏡射 BRAWLER_SPEC;**不 import actor-brawler**=避免 actor-brawler→render-shock→actor-brawler 循環)
const S = { torso: 18, torsoCy: 9, hipY: 14, upper: 7, fore: 6.5, thigh: 7.5, shin: 6.5, headCy: 7.5 };

const clamp01 = v => v < 0 ? 0 : (v > 1 ? 1 : v);

/* ==== 共用幾何/材質(module 級:所有角色共用一份,開機 prewarm 預編譯)==== */
const SUBDIV = 4;                                   // 中點位移層數 → 每條 2^4+1=17 點
const MAX_SEG = 1024, MAX_NODE = 128, MAX_SPIKE = 28;
let SIL_MAT = null, boneMat = null, holeMat = null;
let geoCache = null;

function ensureShared() {
  if (SIL_MAT) return;
  SIL_MAT = new THREE.MeshBasicMaterial({ color: SIL, fog: false });   // 剪影=平塗深色(不吃光,才「平」)
  boneMat = new THREE.MeshBasicMaterial({ color: BONE, transparent: true, depthTest: false, depthWrite: false, fog: false });
  holeMat = new THREE.MeshBasicMaterial({ color: HOLE, transparent: true, depthTest: false, depthWrite: false, fog: false });
  geoCache = {
    skull: new THREE.SphereGeometry(6.2, 14, 12),
    socket: new THREE.SphereGeometry(1.6, 8, 8),
    nose: new THREE.SphereGeometry(0.7, 6, 6),
    jaw: new THREE.BoxGeometry(5.8, 2.6, 2.4),
    tooth: new THREE.BoxGeometry(0.4, 2.0, 0.4),
    vert: new THREE.BoxGeometry(2.2, 1.9, 1.7),
    rib1: new THREE.BoxGeometry(11.5, 1.3, 1.3),
    rib2: new THREE.BoxGeometry(9.5, 1.3, 1.3),
    pelvis: new THREE.BoxGeometry(9.5, 2.0, 1.8),
    joint: new THREE.SphereGeometry(1.35, 8, 8),
    upper: new THREE.BoxGeometry(1.8, S.upper, 1.8),
    fore: new THREE.BoxGeometry(1.6, S.fore, 1.6),
    hand: new THREE.BoxGeometry(2.6, 2.2, 2.6),
    thigh: new THREE.BoxGeometry(2.1, S.thigh, 2.1),
    shin: new THREE.BoxGeometry(1.8, S.shin, 1.8),
    foot: new THREE.BoxGeometry(2.6, 1.3, 4.2),
  };
}

function makeGlowTexture() {                        // 節點光點的徑向漸層(demo 原樣)
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,240,170,0.7)');
  grad.addColorStop(1, 'rgba(255,220,80,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let glowTex = null;

/* ==== ① 鋸齒路徑:ping-pong Float32Array,零配置(demo 每個中點 new Vector3)==== */
const _pA = new Float32Array((1 << SUBDIV) * 3 + 3), _pB = new Float32Array((1 << SUBDIV) * 3 + 3);
let _pathBuf = _pA, _pathN = 0;
function buildJaggedPath(ax, ay, az, bx, by, bz, jag) {
  let src = _pA, dst = _pB, n = 2;
  src[0] = ax; src[1] = ay; src[2] = az; src[3] = bx; src[4] = by; src[5] = bz;
  let amp = Math.hypot(bx - ax, by - ay, bz - az) * jag;
  for (let lvl = 0; lvl < SUBDIV; lvl++) {
    let w = 0;
    dst[w++] = src[0]; dst[w++] = src[1]; dst[w++] = src[2];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 3, b = (i + 1) * 3;
      const dx = src[b] - src[a], dy = src[b + 1] - src[a + 1], dz = src[b + 2] - src[a + 2];
      // 隨機垂直方向:去掉沿線分量再正規化(demo randomPerp)
      let rx = Math.random() * 2 - 1, ry = Math.random() * 2 - 1, rz = Math.random() * 2 - 1;
      const dd = dx * dx + dy * dy + dz * dz || 1e-8, k = (rx * dx + ry * dy + rz * dz) / dd;
      rx -= dx * k; ry -= dy * k; rz -= dz * k;
      let m = Math.hypot(rx, ry, rz);
      if (m < 1e-4) { rx = 0; ry = 1; rz = 0; m = 1; }
      rx /= m; ry /= m; rz /= m;
      const spike = Math.random() < 0.15 ? 2.2 : 1.0;   // 15% 突發大跳變=尖銳感
      dst[w++] = (src[a] + src[b]) * 0.5 + rx * amp * spike * (Math.random() * 2 - 1);
      dst[w++] = (src[a + 1] + src[b + 1]) * 0.5 + ry * amp * spike * (Math.random() * 2 - 1);
      dst[w++] = (src[a + 2] + src[b + 2]) * 0.5 + rz * amp * spike * (Math.random() * 2 - 1);
      dst[w++] = src[b]; dst[w++] = src[b + 1]; dst[w++] = src[b + 2];
    }
    n = w / 3;
    const t = src; src = dst; dst = t;
    amp *= 0.55;                                       // 不用 0.5 平滑衰減,保留高頻抖動(demo 註解)
  }
  _pathBuf = src; _pathN = n;
}

/* ==== ③ 星芒:不規則尖刺多邊形,預配置 buffer(demo 每次 dispose+new)==== */
function writeBurst(arr, spikes) {
  const innerR = 0.20, n = Math.min(spikes, MAX_SPIKE), step = Math.PI * 2 / n;
  let w = 0;
  const bx = [], by = [];
  for (let i = 0; i < n; i++) {
    const baseA = i * step;
    const vA = baseA + (Math.random() - 0.5) * step * 0.4, vR = innerR * (0.75 + Math.random() * 0.5);
    bx.push(Math.cos(vA) * vR); by.push(Math.sin(vA) * vR);
    const tA = baseA + step * 0.5 + (Math.random() - 0.5) * step * 0.7, tR = 0.45 + Math.random() * 0.55;
    bx.push(Math.cos(tA) * tR); by.push(Math.sin(tA) * tR);
  }
  const m = bx.length;
  for (let k = 0; k < m; k++) {
    const q = (k + 1) % m;
    arr[w++] = 0; arr[w++] = 0; arr[w++] = 0;
    arr[w++] = bx[k]; arr[w++] = by[k]; arr[w++] = 0;
    arr[w++] = bx[q]; arr[w++] = by[q]; arr[w++] = 0;
  }
  return w / 3;
}

/* ==== 建一副 rig(每個角色一份;電弧/星芒掛 scene、骨架掛 rig 節點)==== */
function buildRig(R) {
  ensureShared();
  const fx = new THREE.Group(); fx.name = 'SHOCK'; fx.visible = false;
  scene.add(fx);

  // 電弧:核心 + 外暈兩層共用同一份頂點(外暈放大 1.04)
  const arcGeo = new THREE.BufferGeometry();
  arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SEG * 6), 3));
  arcGeo.setDrawRange(0, 0);
  const arcMatCore = new THREE.LineBasicMaterial({ color: CORE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const arcCore = new THREE.LineSegments(arcGeo, arcMatCore);
  arcCore.frustumCulled = false; arcCore.renderOrder = 20; arcCore.userData.__shock = true;
  fx.add(arcCore);
  let arcGlow = null, arcMatGlow = null;
  if (!FX_LOW) {
    arcMatGlow = new THREE.LineBasicMaterial({ color: GLOW, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    arcGlow = new THREE.LineSegments(arcGeo, arcMatGlow);
    arcGlow.frustumCulled = false; arcGlow.renderOrder = 19; arcGlow.userData.__shock = true;
    fx.add(arcGlow);
  }

  // 節點光點(FX_LOW 砍)
  let nodePoints = null, nodeGeo = null, nodeMat = null;
  if (!FX_LOW) {
    if (!glowTex) glowTex = makeGlowTexture();
    nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_NODE * 3), 3));
    nodeGeo.setDrawRange(0, 0);
    nodeMat = new THREE.PointsMaterial({ size: P.nodeSize * boxH(), map: glowTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false });
    nodePoints = new THREE.Points(nodeGeo, nodeMat);
    nodePoints.frustumCulled = false; nodePoints.renderOrder = 21; nodePoints.userData.__shock = true;
    fx.add(nodePoints);
  }

  // 星芒(雙層;depthTest true + 每幀推到角色後方 → 角色自然遮擋,demo v1.1 的分層修正)
  const burstGroup = new THREE.Group(); fx.add(burstGroup);
  const mkBurst = (col, op, order, sc) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SPIKE * 2 * 3 * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, side: THREE.DoubleSide, depthTest: true, depthWrite: false, fog: false });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false; m.renderOrder = order; m.scale.setScalar(sc); m.userData.__shock = true;
    burstGroup.add(m);
    return { geo, mat };
  };
  const bOuter = mkBurst(GLOW, 0.92, 30, 1);
  const bInner = mkBurst(CORE, 0.98, 31, 0.62);

  return {
    fx, arcGeo, arcCore, arcGlow, arcMatCore, arcMatGlow, nodeGeo, nodeMat,
    burstGroup, bOuter, bInner,
    skel: [], face: null, onAvatar: false, bodyH: 0, ex: 0, ey: 0, ez: 0, cy: 0, minArc: 0, burst: 0, back: 0, sil: null, xray: false, lastTick: -1, flicker: 1, shown: false,
  };
}

/* ==== X光骨架:骨頭掛「可見角色」的骨節點 → 姿勢自動跟 ====
   **必須掛 avatar 骨,不能掛 box rig(病 3)**:avatar 預設開,box rig 是隱形 driver——它的
   headPivot/spine 只是驅動用的節點,avatar 有自己的比例且整體被 av.S 縮放過,掛 box rig 的話
   骷髏頭會出現在胸口(2026-07-27 實測截圖抓到)。同 item-4b 風壓手套掛 av.by.hand_r.bone 的修法。
   骨長**不寫死**:從 avatar 骨鏈實測(子骨在父骨局部空間的位移=骨長+方向),換角色模型自動對齊。
   ?avatar=0 的方塊人退回 box rig + BRAWLER_SPEC 骨長。 */
const AV_CHAIN = [                                  // [父骨, 子骨(量長度), 粗細比例]
  ['upperarm_l', 'forearm_l', 0.20], ['upperarm_r', 'forearm_r', 0.20],
  ['forearm_l', 'hand_l', 0.18], ['forearm_r', 'hand_r', 0.18],
  ['thigh_l', 'shin_l', 0.22], ['thigh_r', 'shin_r', 0.22],
  ['shin_l', 'foot_l', 0.19], ['shin_r', 'foot_r', 0.19],
];
const avGeo = new Map();                            // 實測幾何快取(同一份 TEMPLATE → 所有角色骨長相同)
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m1 = new THREE.Matrix4();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const YAXIS = new THREE.Vector3(0, 1, 0);

// 子骨在父骨局部空間的位移(跨中間骨也對:走世界座標再轉回父骨局部)
function localOffset(parent, child, out) {
  child.getWorldPosition(out);
  parent.updateWorldMatrix(true, false);
  _m1.copy(parent.matrixWorld).invert();
  return out.applyMatrix4(_m1);
}
// 骨頭 mesh:沿「父骨→子骨」方向擺一根長條 + 起點關節球
function addLimb(list, parent, off, thick, key) {
  const L = off.length();
  if (L < 1e-4) return;
  let geo = avGeo.get(key);
  if (!geo) { geo = new THREE.BoxGeometry(L * thick, L, L * thick); avGeo.set(key, geo); }
  const m = new THREE.Mesh(geo, boneMat);
  m.position.copy(off).multiplyScalar(0.5);
  _v2.copy(off).normalize();
  m.quaternion.setFromUnitVectors(YAXIS, _v2);      // 幾何長軸=Y → 轉到骨方向
  m.renderOrder = 40; m.visible = false; m.userData.__shockbone = true;
  parent.add(m); list.push(m);
  let jg = avGeo.get('J' + key);
  if (!jg) { jg = new THREE.SphereGeometry(L * thick * 0.85, 8, 8); avGeo.set('J' + key, jg); }
  const j = new THREE.Mesh(jg, boneMat);
  j.renderOrder = 40; j.visible = false; j.userData.__shockbone = true;
  parent.add(j); list.push(j);
}

function buildSkeletonAvatar(g, av) {
  const list = [], by = av.by;
  let face = null;
  const need = k => by[k] && by[k].bone;
  // ---- 四肢:實測骨長 ----
  for (const [pk, ck, th] of AV_CHAIN) {
    if (!need(pk) || !need(ck)) continue;
    addLimb(list, by[pk].bone, localOffset(by[pk].bone, by[ck].bone, _v1), th, pk);
  }
  // ---- 脊椎/肋骨/骨盆:torso → head 的實測長度切三節 ----
  const torso = need('torso') ? by.torso.bone : null;
  const headB = need('head') ? by.head.bone : null;
  if (torso && headB) {
    const up = localOffset(torso, headB, _v1).clone();
    const L = up.length(), dir = up.clone().normalize();
    let vg = avGeo.get('vert');
    if (!vg) { vg = new THREE.BoxGeometry(L * 0.11, L * 0.12, L * 0.10); avGeo.set('vert', vg); }
    for (const t of [0.25, 0.5, 0.75]) {
      const m = new THREE.Mesh(vg, boneMat);
      m.position.copy(dir).multiplyScalar(L * t);
      m.renderOrder = 40; m.visible = false; m.userData.__shockbone = true;
      torso.add(m); list.push(m);
    }
    for (const [t, w, key] of [[0.68, 0.78, 'rib1'], [0.46, 0.64, 'rib2']]) {   // 肋骨兩道橫桿
      let rg = avGeo.get(key);
      if (!rg) { rg = new THREE.BoxGeometry(L * w, L * 0.07, L * 0.07); avGeo.set(key, rg); }
      const m = new THREE.Mesh(rg, boneMat);
      m.position.copy(dir).multiplyScalar(L * t);
      m.renderOrder = 40; m.visible = false; m.userData.__shockbone = true;
      torso.add(m); list.push(m);
    }
    let pg = avGeo.get('pel');
    if (!pg) { pg = new THREE.BoxGeometry(L * 0.55, L * 0.11, L * 0.11); avGeo.set('pel', pg); }
    const pm = new THREE.Mesh(pg, boneMat);
    pm.renderOrder = 40; pm.visible = false; pm.userData.__shockbone = true;
    (need('root') ? by.root.bone : torso).add(pm); list.push(pm);
  }
  // ---- 骷髏頭:半徑從頭骨的網格包圍盒實測;眼窩/鼻/顎的「前方」由角色朝向換算進頭骨局部 ----
  if (headB) {
    const bb = new THREE.Box3();
    for (const m of (by.head.meshes || [])) if (m.geometry) {
      m.geometry.computeBoundingBox();
      bb.union(new THREE.Box3().copy(m.geometry.boundingBox).applyMatrix4(m.matrix));
    }
    // 蒙皮角色 meshes 恆空 → 用 av.by.head.localBox(skin weight 反推的骨局部 bbox,同空間);
    // 沒有才退下面的 standH 估值。
    if (bb.isEmpty() && by.head.localBox && !by.head.localBox.isEmpty()) bb.copy(by.head.localBox);
    let r, cy;
    if (!bb.isEmpty()) { bb.getSize(_v1); r = Math.max(_v1.x, _v1.y, _v1.z) * 0.36; bb.getCenter(_v2); cy = _v2.clone(); }
    else { r = (av.standH / av.S) * 0.075; cy = new THREE.Vector3(0, r, 0); }
    // 顱球掛頭骨(跟著轉);**五官另掛 face 子群組,每幀偏航對鏡頭**(updateShock 驅動)——
    // 鏡頭固定+角色八向轉身,真 3D 朝向會讓臉常背對=只剩一顆白球,gag 讀不出來(demo 同理用 billboard)。
    const put = (parent, geo, off, mat, order) => {
      const m = new THREE.Mesh(geo, mat || boneMat);
      m.position.copy(off); m.renderOrder = order || 40;
      m.visible = false; m.userData.__shockbone = true;
      parent.add(m); list.push(m);
    };
    let sg = avGeo.get('skull');
    if (!sg) { sg = new THREE.SphereGeometry(r, 14, 12); avGeo.set('skull', sg); }
    put(headB, sg, cy);
    face = new THREE.Group(); face.position.copy(cy); headB.add(face);
    let jag = avGeo.get('jaw'), sog = avGeo.get('sock'), nog = avGeo.get('nose'), tg = avGeo.get('tooth');
    if (!jag) { jag = new THREE.BoxGeometry(r * 0.95, r * 0.42, r * 0.4); avGeo.set('jaw', jag); }
    if (!sog) { sog = new THREE.SphereGeometry(r * 0.32, 8, 8); avGeo.set('sock', sog); }
    if (!nog) { nog = new THREE.SphereGeometry(r * 0.11, 6, 6); avGeo.set('nose', nog); }
    if (!tg) { tg = new THREE.BoxGeometry(r * 0.07, r * 0.32, r * 0.07); avGeo.set('tooth', tg); }
    const P3 = (f, u2, rr) => new THREE.Vector3(r * rr, r * u2, r * f);   // face 群組:+Z=朝鏡頭
    put(face, jag, P3(0.30, -0.80, 0));
    put(face, sog, P3(0.78, 0.16, -0.38), holeMat, 41);
    put(face, sog, P3(0.78, 0.16, 0.38), holeMat, 41);
    put(face, nog, P3(0.88, -0.24, 0), holeMat, 41);
    put(face, tg, P3(0.52, -0.80, -0.18), holeMat, 41);
    put(face, tg, P3(0.52, -0.80, 0.18), holeMat, 41);
  }
  return { list, face };
}

// 方塊人(?avatar=0):骨頭掛 box rig,骨長=BRAWLER_SPEC(rig 的可見箱子都「從關節往下掛」,骨頭照同一慣例)
function buildSkeletonBox(R) {
  const list = [];
  const add = (parent, geo, x, y, z, mat, order) => {
    const m = new THREE.Mesh(geo, mat || boneMat);
    m.position.set(x, y, z); m.renderOrder = order || 40; m.visible = false;
    m.userData.__shockbone = true;
    parent.add(m); list.push(m);
  };
  const G = geoCache;
  add(R.headPivot, G.skull, 0, S.headCy, 0);
  add(R.headPivot, G.jaw, 0, S.headCy - 5.2, 1.2);
  add(R.headPivot, G.socket, -2.4, S.headCy + 0.9, 5.0, holeMat, 41);
  add(R.headPivot, G.socket, 2.4, S.headCy + 0.9, 5.0, holeMat, 41);
  add(R.headPivot, G.nose, 0, S.headCy - 1.6, 5.6, holeMat, 41);
  add(R.headPivot, G.tooth, -1.1, S.headCy - 5.2, 2.4, holeMat, 41);
  add(R.headPivot, G.tooth, 1.1, S.headCy - 5.2, 2.4, holeMat, 41);
  add(R.spine, G.vert, 0, 5, 0); add(R.spine, G.vert, 0, 9, 0); add(R.spine, G.vert, 0, 13, 0);
  add(R.spine, G.rib1, 0, 12, 0.6); add(R.spine, G.rib2, 0, 7.5, 0.6);
  add(R.pelvis, G.pelvis, 0, 0, 0);
  for (const A of [R.armL, R.armR]) {
    add(A.sh, G.upper, 0, -S.upper / 2, 0); add(A.sh, G.joint, 0, 0, 0);
    add(A.lm, G.fore, 0, -S.fore / 2, 0); add(A.lm, G.joint, 0, 0, 0);
    add(A.wr, G.hand, 0, -1.2, 0);
  }
  for (const L of [R.legL, R.legR]) {
    add(L.hp, G.thigh, 0, -S.thigh / 2, 0); add(L.hp, G.joint, 0, 0, 0);
    add(L.lm, G.shin, 0, -S.shin / 2, 0); add(L.lm, G.joint, 0, 0, 0);
    add(L.ankle, G.foot, 0, -0.65, 1.4);
  }
  return { list, face: null };   // 方塊人=除錯外觀,五官直接掛頭不做 billboard
}
function disposeSkel(list) { for (const m of list) if (m.parent) m.parent.remove(m); }   // 幾何是共用快取,不 dispose

/* ==== 電弧重擲(強度越高鋸齒越大;每 regenMs 一次=離散閃爍)==== */
function regenArcs(rig, intensity) {
  const pos = rig.arcGeo.attributes.position.array;
  const nodeArr = rig.nodeGeo ? rig.nodeGeo.attributes.position.array : null;
  let segIdx = 0, nodeIdx = 0;
  const count = Math.max(1, Math.round(P.arcCount * (FX_LOW ? 0.5 : 1) * (0.6 + Math.random() * 0.6)));
  for (let a = 0; a < count; a++) {
    // 橢球面上取距離夠遠的兩點
    let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, tries = 0;
    do {
      sampleEllipsoid(rig); ax = _samp[0]; ay = _samp[1]; az = _samp[2];
      sampleEllipsoid(rig); bx = _samp[0]; by = _samp[1]; bz = _samp[2];
      tries++;
    } while (Math.hypot(bx - ax, by - ay, bz - az) < rig.minArc && tries < 8);
    buildJaggedPath(ax, ay, az, bx, by, bz, P.arcJag * intensity);
    const buf = _pathBuf, n = _pathN;
    for (let i = 0; i < n - 1 && segIdx < MAX_SEG; i++) {
      const o = segIdx * 6, a3 = i * 3, b3 = (i + 1) * 3;
      pos[o] = buf[a3]; pos[o + 1] = buf[a3 + 1]; pos[o + 2] = buf[a3 + 2];
      pos[o + 3] = buf[b3]; pos[o + 4] = buf[b3 + 1]; pos[o + 5] = buf[b3 + 2];
      segIdx++;
    }
    // 節點光點:路徑點抽樣(分支在 FX_LOW 砍掉;分支要另存路徑,故先抽點再長分支)
    for (let i = 2; i < n - 2; i++) {
      if (nodeArr && nodeIdx < MAX_NODE && Math.random() < 0.25) {
        const o = nodeIdx * 3, a3 = i * 3;
        nodeArr[o] = buf[a3]; nodeArr[o + 1] = buf[a3 + 1]; nodeArr[o + 2] = buf[a3 + 2];
        nodeIdx++;
      }
    }
    if (!FX_LOW) {
      // 分支:從路徑內部點岔出短鋸齒(重用 ping-pong buffer → 得先把母路徑的起點抄出來)
      for (let i = 2; i < n - 2; i++) {
        if (Math.random() >= P.branchChance * 0.12) continue;
        const a3 = i * 3, sx = buf[a3], sy = buf[a3 + 1], sz = buf[a3 + 2];
        let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
        const m = Math.hypot(dx, dy, dz) || 1, len = (0.25 + Math.random() * 0.3) / DEMO_H * rig.bodyH;
        dx = dx / m * len; dy = dy / m * len; dz = dz / m * len;
        buildJaggedPath(sx, sy, sz, sx + dx, sy + dy, sz + dz, P.arcJag * 1.4);
        const bb = _pathBuf, bn = _pathN;
        for (let j = 0; j < bn - 1 && segIdx < MAX_SEG; j++) {
          const o = segIdx * 6, c3 = j * 3, d3 = (j + 1) * 3;
          pos[o] = bb[c3]; pos[o + 1] = bb[c3 + 1]; pos[o + 2] = bb[c3 + 2];
          pos[o + 3] = bb[d3]; pos[o + 4] = bb[d3 + 1]; pos[o + 5] = bb[d3 + 2];
          segIdx++;
        }
        break;                                          // 每條母電弧最多長一支(母路徑已被分支覆寫)
      }
    }
  }
  rig.arcGeo.setDrawRange(0, segIdx * 2);
  rig.arcGeo.attributes.position.needsUpdate = true;
  if (rig.nodeGeo) { rig.nodeGeo.setDrawRange(0, nodeIdx); rig.nodeGeo.attributes.position.needsUpdate = true; }
}
const _samp = [0, 0, 0];
function sampleEllipsoid(rig) {
  let x, y, z, l;
  do { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; l = x * x + y * y + z * z; } while (l < 0.05);
  l = Math.sqrt(l);
  _samp[0] = x / l * rig.ex; _samp[1] = y / l * rig.ey; _samp[2] = z / l * rig.ez;
  return _samp;
}
// 身形量測(shock-1b):橢球/星芒/中心高全部照受害者實際站高現算——avatar=av.standH(渲染後真實站高,
// 含 AVATAR_SCALE),方塊人退 boxH()。avatar 非同步建好/換模型時 bodyH 一變就重算。
function refreshSize(rig, H) {
  if (rig.bodyH === H) return;
  rig.bodyH = H;
  rig.ex = P.ex * H; rig.ey = P.ey * H; rig.ez = P.ez * H;
  rig.cy = P.cy * H; rig.minArc = P.minArc * H;
  rig.burst = P.burstSize * H; rig.back = P.burstBack * H;
  if (rig.nodeMat) rig.nodeMat.size = P.nodeSize * H;
}

/* ==== X光切換:角色整組換扁平深色剪影 + 骨架浮現 ==== */
// 剪影用「換 mesh.material 指標」而不是改材質顏色——avatar 是 TEMPLATE.clone(true),Three 的 clone
// **共用材質引用**,直接改顏色會把兩個角色一起變黑。換指標=每個 mesh 各自指向共用的 SIL_MAT,零污染。
function collectSil(g) {
  const list = [];
  g.traverse(o => { if (o.isMesh && !o.userData.__shockbone && !o.userData.__shock) list.push({ m: o, mat: o.material }); });
  return list;
}
function setXray(rig, on) {
  if (rig.xray === on) return;
  rig.xray = on;
  for (const b of rig.skel) b.visible = on;
  if (rig.sil) for (const s of rig.sil) s.m.material = on ? SIL_MAT : s.mat;
}

/* ==== prewarm:開機第一個 render 幀預編譯(免首次觸電那幀才編譯=首用凍幀,同 render-wind-blast 慣例)==== */
let _warmed = false;
function prewarm(rig) {
  if (_warmed) return; _warmed = true;
  rig.fx.visible = true;
  for (const b of rig.skel) b.visible = true;
  try { renderer.compile(scene, camera); } catch (e) { /* headless 無 GL 等罕例:退回惰性編譯 */ }
  for (const b of rig.skel) b.visible = false;
  rig.fx.visible = false;
}

const _wc = new THREE.Vector3(), _off = new THREE.Vector3();

/* ==== 驅動:每幀由 actor-brawler 幀尾呼叫(g 世界變換已套好)==== */
export function updateShock(e, g, R) {
  const u = g.userData;
  const now = game.time;
  const want = e.state === 'alive' && (e.shockT || 0) > now;
  let rig = u.shock;
  if (!rig) {
    if (!want && _warmed) return;
    rig = u.shock = buildRig(R);
  }
  // 骨架掛點:avatar 是非同步建好的 → 一出現就把骨架從 box rig 改掛 avatar 骨(同 item-4b 手套的重掛)
  const av = u.avatar;
  refreshSize(rig, av && av.standH ? av.standH : boxH());
  if (!!av !== rig.onAvatar || !rig.skel.length) {
    disposeSkel(rig.skel);
    if (rig.face && rig.face.parent) rig.face.parent.remove(rig.face);
    const built = av ? buildSkeletonAvatar(g, av) : buildSkeletonBox(R);
    rig.skel = built.list; rig.face = built.face; rig.onAvatar = !!av;
    if (rig.xray) for (const b of rig.skel) b.visible = true;   // 換掛時剛好在 X 光幀:新骨頭補亮
  }
  prewarm(rig);
  if (!want) {                                        // 演出結束/沒在觸電:收乾淨(剪影材質一定要還原)
    if (rig.shown) { rig.shown = false; setXray(rig, false); rig.fx.visible = false; u.xray = false; }
    return;
  }
  if (!rig.shown) {                                   // 這一發開始:重抓剪影目標(avatar 非同步建好/裝備換過)
    rig.shown = true; rig.sil = collectSil(g); rig.lastTick = -1; rig.fx.visible = true;
  }

  // 強度包絡:尾段 P.fade 淡出(shockT 是絕對結束時刻,由 sim 給=綁擊暈時長)
  const remain = e.shockT - now;
  const envelope = remain < P.fade ? Math.max(remain / P.fade, 0) : 1;
  // 脈動 × 每次重擲抽一次的隨機閃爍。閃變吃真實時鐘(同 render-whip:hitstop 凍結世界時電流仍滋滋作響)
  const pulse = 1 + P.pulseAmp * Math.sin(performance.now() / 1000 * P.pulseSpeed * Math.PI * 2);
  const intensity = pulse * rig.flicker * envelope;

  const tick = Math.floor(performance.now() / P.regenMs);
  if (tick !== rig.lastTick) {                        // 離散閃爍:間隔到才重建(電流不能連續平滑補間)
    rig.lastTick = tick;
    rig.flicker = 0.7 + Math.random() * 0.55;
    regenArcs(rig, intensity);
    rig.bOuter.geo.setDrawRange(0, writeBurst(rig.bOuter.geo.attributes.position.array, P.spikeCount));
    rig.bOuter.geo.attributes.position.needsUpdate = true;
    rig.bInner.geo.setDrawRange(0, writeBurst(rig.bInner.geo.attributes.position.array, Math.max(5, P.spikeCount - 3)));
    rig.bInner.geo.attributes.position.needsUpdate = true;
    rig.burstGroup.children[0].rotation.z = Math.random() * Math.PI * 2;
    rig.burstGroup.children[1].rotation.z = Math.random() * Math.PI * 2;
    setXray(rig, _forceXray != null ? _forceXray : Math.random() < P.xrayRatio); // 卡通X光:快速交替 剪影+骨架 ↔ 正常
  }
  u.xray = rig.xray;                                  // render-actors 的 tint pass 讀這面旗跳過剪影(否則會被寫回原色)
  if (rig.face && rig.face.parent) {                  // 五官偏航對鏡頭:世界目標朝向 → 轉回頭骨局部
    rig.face.parent.getWorldPosition(_v1);
    _qa.setFromAxisAngle(YAXIS, Math.atan2(camera.position.x - _v1.x, camera.position.z - _v1.z));
    rig.face.parent.getWorldQuaternion(_qb).invert();
    rig.face.quaternion.copy(_qb).multiply(_qa);
  }

  // 電效群組掛 scene(世界座標,不吃角色 yaw/squash);中心=軀幹中心
  g.getWorldPosition(_wc); _wc.y += rig.cy;
  rig.fx.position.copy(_wc);
  const s = Math.max(intensity, 0.001);
  rig.arcCore.scale.setScalar(s);
  if (rig.arcGlow) rig.arcGlow.scale.setScalar(s * 1.04);
  rig.burstGroup.scale.setScalar(rig.burst * s);      // writeBurst 頂點是單位半徑 ~1,縮放直接帶進 px
  rig.burstGroup.quaternion.copy(camera.quaternion);  // billboard(fx 掛 scene 且無旋轉 → local=world)
  _off.subVectors(_wc, camera.position).normalize().multiplyScalar(rig.back);
  rig.burstGroup.position.copy(_off);                 // 沿視線推到角色後方:角色壓在星芒前(depthTest true)

  rig.arcMatCore.opacity = envelope;
  if (rig.arcMatGlow) rig.arcMatGlow.opacity = 0.55 * envelope;
  if (rig.nodeMat) rig.nodeMat.opacity = 0.9 * envelope;
  rig.bOuter.mat.opacity = 0.92 * envelope;
  rig.bInner.mat.opacity = 0.98 * envelope;
}

// 測試/除錯 hook。__shockForce(true/false) 釘住 X 光相位、null 還給隨機——
// 閃爍是 45ms 一擲,截圖/斷言抓不到指定相位,測試靠這支釘住。
let _forceXray = null;
export function __shockInfo() { return { low: FX_LOW, warmed: _warmed, forced: _forceXray }; }
if (typeof window !== 'undefined') { window.__shock = __shockInfo; window.__shockForce = v => { _forceXray = v; }; }
