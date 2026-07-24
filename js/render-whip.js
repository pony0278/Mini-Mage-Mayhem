// render-whip.js — 魔導電鞭視覺(whip-1):使用者 Whip Lab v2.5(whip_lab_v2_5.html)的 Verlet 鞭移植。
// **判定不動**:sim castLightning 的直線判定(v2-items,LIGHTNING_RANGE)是唯一真相;這裡純演出——
// 持電鞭(item==='lightning')=右手垂鞭+微電紋,排程施放=WINDUP(方向空間往後鋪鞭=飛蠅釣 back cast)
// → 施放幀=STRIKE(方向貝茲 back→top→fwd 過頂甩向 facing,波前直化+鞭梢爆發)→ RECOVER → 回垂鞭。
// 鞭根=右手腕世界座標,clip 揮臂自動帶動(rhook 暫代;使用者之後在 punch-studio 編 lightning_cast
// 填進 ITEM_SPEC 即換裝,這裡零改動)。參數=LAB(使用者 lab 匯出 JSON 原樣保存)×K px 換算:
// 等比縮放(所有長度維度×K、時間不變)Verlet 動力學逐位元等價。電流閃變吃真實時鐘(離散重擲),
// 所以 hitstop 凍結世界時電流仍滋滋作響(lab 的設計:高壓電該有的樣子)。
import { game } from './state.js';
import { scene } from './render-core.js';
import { FX_LOW } from './render-lab.js';

// ===== 使用者 lab 定稿參數(2026-07-23 匯出,原樣保存;hand*/dummy*/hitstop*/socket* 是 lab
// 腳本驅動器/假人/慢動作的欄位,遊戲端手=腕骨、目標=真對手、頓點=fx.addHitstop,不取用)=====
const LAB = { "segments": 30, "whipLength": 2.2, "gravity": -13, "damping": 0.985, "bend": 0.05, "stiffness": 1, "iterations": 7, "ftlDamp": 0.9, "assist": 0.59, "frontSpeed": 1.2, "frontWidth": 0.4, "tipImpulse": 0.021, "handStopAt": 0.46, "tWindup": 0.77, "tStrike": 0.24, "tRecover": 0.5, "hitStart": 0.35, "hitEnd": 1.55, "hitFromS": 0.45, "restitution": 0.45, "contactFriction": 0.3, "recoilImpulse": 0.03, "impactRelease": 0.1, "impactSpeed": 4, "teleportDist": 0.6, "hitstopScale": 0.08, "hitstopDur": 0.07, "hitstopRamp": 0.22, "rBase": 0.042, "rTip": 0.006, "taper": 1.4, "elecAmp": 0.045, "elecFreq": 24, "elecBranches": 6, "elecGlow": 0.16, "groundY": 0, "groundFriction": 0.3, "timeScale": 1, "dummyDist": 1.75, "dummyLift": 0, "socketForward": [0, 0, 1], "handNeutral": [0.18, 1.15, 0.05], "handBack": [-0.08, 1.72, -0.52], "handEnd": [0.12, 1.08, 0.62], "strikeDir": [0, -0.14, 1], "backDir": [-0.1, 0.35, -0.93], "topDir": [0, 1, 0.12], "arcLift": 0.22, "backSettle": 0.4, "backAssist": 0.3, "dirSweep": 0.9 };

// px / lab-公尺:讓鞭全長(2.2)≈ LIGHTNING_RANGE 260px=甩出去的鞭梢摸得到判定線末端(演出對齊判定射程)。
const K = 118;
const P = {
  segments: LAB.segments, whipLength: LAB.whipLength * K,
  gravity: LAB.gravity * K, damping: LAB.damping, bend: LAB.bend, stiffness: LAB.stiffness,
  iterations: LAB.iterations, ftlDamp: LAB.ftlDamp,
  assist: LAB.assist, frontSpeed: LAB.frontSpeed, frontWidth: LAB.frontWidth,
  tipImpulse: LAB.tipImpulse * K,
  tStrike: LAB.tStrike, tRecover: LAB.tRecover,
  hitStart: LAB.hitStart, hitEnd: LAB.hitEnd, hitFromS: LAB.hitFromS,
  restitution: LAB.restitution, contactFriction: LAB.contactFriction,
  recoilImpulse: LAB.recoilImpulse * K, impactRelease: LAB.impactRelease, impactSpeed: LAB.impactSpeed * K,
  teleportDist: LAB.teleportDist * K,
  rBase: LAB.rBase * K, rTip: LAB.rTip * K, taper: LAB.taper,
  elecAmp: LAB.elecAmp * K, elecFreq: LAB.elecFreq, elecBranches: LAB.elecBranches, elecGlow: LAB.elecGlow,
  groundY: 0,
  strikeDir: LAB.strikeDir, backDir: LAB.backDir, topDir: LAB.topDir,
  backSettle: LAB.backSettle, backAssist: LAB.backAssist, dirSweep: LAB.dirSweep,
};

/* ==== 純模擬層(lab PURE 區塊 1:1 移植;碰撞體只留地板——鞭子穿過人=演出不干涉判定)==== */
const clamp01 = v => v < 0 ? 0 : (v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const d = (e1 - e0) || 1e-9; const t = clamp01((x - e0) / d); return t * t * (3 - 2 * t); };
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const IDLE = 0, WINDUP = 1, STRIKE = 2, RECOVER = 3;

function whipRadius(s) { return lerp(P.rBase, P.rTip, Math.pow(s, 1 / P.taper)); }
function frontAt(u) { return u * P.frontSpeed; }

function createWhipSim(origin) {
  const n = P.segments, m = (n + 1) * 3;
  const sim = {
    n, restLen: P.whipLength / n,
    pos: new Float64Array(m), prev: new Float64Array(m),
    tmp: new Float64Array(m), cn: new Float64Array(m),
    cflag: new Uint8Array(n + 1), cvn: new Float64Array(n + 1), vpre: new Float64Array(m),
    lastHand: [0, 0, 0], primed: false,
    cracked: false, impacted: false, impactAge: 0,
  };
  resetWhipSim(sim, origin, [0, -0.55, 0.83]);
  return sim;
}
function resetWhipSim(sim, origin, dir) {
  const n = sim.n, L = sim.restLen;
  const m = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  for (let i = 0; i <= n; i++) {
    const k = i * 3, d = L * i;
    sim.pos[k] = sim.prev[k] = origin.x + dir[0] / m * d;
    sim.pos[k + 1] = sim.prev[k + 1] = Math.max(origin.y + dir[1] / m * d, P.groundY + 1);
    sim.pos[k + 2] = sim.prev[k + 2] = origin.z + dir[2] / m * d;
  }
  sim.cracked = false; sim.impacted = false; sim.impactAge = 0; sim.primed = false;
}

// 碰撞投影(地板)——必須跟長度約束交替、放同一個迴圈裡(lab 註解:放外面=推出後沒人修長度=鞭子被拉長)
function resolveGround(sim) {
  const n = sim.n, pos = sim.pos, cn = sim.cn, cf = sim.cflag;
  for (let i = 1; i <= n; i++) {
    const j = i * 3, rw = whipRadius(i / n);
    if (pos[j + 1] < P.groundY + rw) {
      pos[j + 1] = P.groundY + rw;
      cn[j] = 0; cn[j + 1] = 1; cn[j + 2] = 0; cf[i] = 1;
    }
  }
}
// 接觸速度回應:只改 prev(=改速度)不動 pos → 不破壞剛解好的長度;用「入射速度」vpre 判定(lab 註解)
function applyContactVelocity(sim, dt) {
  const n = sim.n, pos = sim.pos, prev = sim.prev, cn = sim.cn, cf = sim.cflag, vp = sim.vpre;
  for (let i = 1; i <= n; i++) {
    if (!cf[i]) continue;
    const j = i * 3, nx = cn[j], ny = cn[j + 1], nz = cn[j + 2];
    const vx = vp[j], vy = vp[j + 1], vz = vp[j + 2];
    const vn = vx * nx + vy * ny + vz * nz;
    if (vn >= 0) continue;
    sim.cvn[i] = -vn / dt;
    const f = 1 - P.contactFriction;
    const rx = (vx - nx * vn) * f - nx * vn * P.restitution;
    const ry = (vy - ny * vn) * f - ny * vn * P.restitution;
    const rz = (vz - nz * vn) * f - nz * vn * P.restitution;
    prev[j] = pos[j] - rx; prev[j + 1] = pos[j + 1] - ry; prev[j + 2] = pos[j + 2] - rz;
  }
}

function whipStep(sim, hand, dir, phase, u, dt) {
  const n = sim.n, pos = sim.pos, prev = sim.prev;
  // 0) 傳送門防護:角色瞬移/重生=rigid 平移整條鞭(保留相對速度),別讓約束去硬拉
  if (sim.primed) {
    const dx = hand.x - sim.lastHand[0], dy = hand.y - sim.lastHand[1], dz = hand.z - sim.lastHand[2];
    if (dx * dx + dy * dy + dz * dz > P.teleportDist * P.teleportDist) {
      for (let i = 0; i <= n; i++) {
        const j = i * 3;
        pos[j] += dx; pos[j + 1] += dy; pos[j + 2] += dz;
        prev[j] += dx; prev[j + 1] += dy; prev[j + 2] += dz;
      }
    }
  }
  sim.lastHand[0] = hand.x; sim.lastHand[1] = hand.y; sim.lastHand[2] = hand.z;
  sim.primed = true;
  // 1) Verlet 積分
  const damp = Math.pow(P.damping, dt * 60), gdt = P.gravity * dt * dt;
  for (let i = 1; i <= n; i++) {
    const k = i * 3;
    for (let a = 0; a < 3; a++) {
      const x = pos[k + a], v = (x - prev[k + a]) * damp;
      prev[k + a] = x; pos[k + a] = x + v;
    }
    pos[k + 1] += gdt;
  }
  // 2) 鞭梢爆發:施加在 prev(等同給速度),波前抵梢那個子步觸發一次
  if (phase === STRIKE && !sim.cracked && !sim.impacted && frontAt(u) >= 1.0) {
    sim.cracked = true;
    for (let i = Math.max(1, n - 2); i <= n; i++) {
      const j = i * 3, m = P.tipImpulse * (1 - (n - i) * 0.25);
      prev[j] -= dir.x * m; prev[j + 1] -= dir.y * m; prev[j + 2] -= dir.z * m;
    }
  }
  // 3) 抗彎
  if (P.bend > 0) {
    for (let i = 1; i < n; i++) {
      const a = (i - 1) * 3, b = i * 3, c = (i + 1) * 3;
      for (let k = 0; k < 3; k++) pos[b + k] += ((pos[a + k] + pos[c + k]) * 0.5 - pos[b + k]) * P.bend;
    }
  }
  // 4) 直化(方向空間)+ FTL 長度投影;撞擊後 assist 在 impactRelease 內衰減=鞭子不再硬撐前伸
  const gate = sim.impacted ? Math.max(0, 1 - sim.impactAge / P.impactRelease) : 1;
  let front = 2.0, kk = 0;
  if (phase === STRIKE) { front = frontAt(u); kk = (1 - Math.pow(1 - P.assist, dt * 60)) * gate; }
  else if (phase === WINDUP) { front = frontAt(u); kk = (1 - Math.pow(1 - P.backAssist, dt * 60)) * gate; } // 後甩=一次反向出鞭(dir 已轉 backDir)
  const tmp = sim.tmp;
  tmp.set(pos);
  let px = hand.x, py = hand.y, pz = hand.z;
  pos[0] = px; pos[1] = py; pos[2] = pz;
  for (let i = 0; i < n; i++) {
    const a = i * 3, b = (i + 1) * 3;
    let dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1e-9) { dx = dir.x; dy = dir.y; dz = dir.z; }
    else { dx /= L; dy /= L; dz /= L; }
    if (kk > 0) {
      const w = (1 - smoothstep(front, front + P.frontWidth, (i + 1) / n)) * kk;
      if (w > 1e-5) {
        dx = lerp(dx, dir.x, w); dy = lerp(dy, dir.y, w); dz = lerp(dz, dir.z, w);
        const m = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
        dx /= m; dy /= m; dz /= m;
      }
    }
    px += dx * sim.restLen; py += dy * sim.restLen; pz += dz * sim.restLen;
    pos[b] = px; pos[b + 1] = py; pos[b + 2] = pz;
  }
  // 4b) FTL 速度修正(Müller 2012):沿鏈重建的位移要從 prev 扣回,否則被 Verlet 誤判成速度=高頻抖動
  if (P.ftlDamp > 0) {
    const s = P.ftlDamp;
    for (let i = 1; i < n; i++) {
      const j = i * 3, k = (i + 1) * 3;
      prev[j] += s * (pos[k] - tmp[k]);
      prev[j + 1] += s * (pos[k + 1] - tmp[k + 1]);
      prev[j + 2] += s * (pos[k + 2] - tmp[k + 2]);
    }
  }
  // 5) 碰撞與長度約束交替鬆弛
  sim.cflag.fill(0); sim.cvn.fill(0);
  for (let i = 0; i < sim.vpre.length; i++) sim.vpre[i] = pos[i] - prev[i];
  const iters = P.iterations | 0;
  for (let it = 0; it < iters; it++) {
    resolveGround(sim);
    const back = (it & 1) === 1;
    for (let s = 0; s < n; s++) {
      const i = back ? n - 1 - s : s;
      const a = i * 3, b = (i + 1) * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-8) d = 1e-8;
      const diff = (d - sim.restLen) / d * P.stiffness;
      if (i === 0) { pos[b] -= dx * diff; pos[b + 1] -= dy * diff; pos[b + 2] -= dz * diff; }
      else {
        const h = diff * 0.5;
        pos[a] += dx * h; pos[a + 1] += dy * h; pos[a + 2] += dz * h;
        pos[b] -= dx * h; pos[b + 1] -= dy * h; pos[b + 2] -= dz * h;
      }
    }
    pos[0] = hand.x; pos[1] = hand.y; pos[2] = hand.z;
  }
  resolveGround(sim);           // 收尾:保證離開迴圈時無穿透
  applyContactVelocity(sim, dt);
  // 7) 撞擊事件(地板版):s>=hitFromS 段以「速度撞上」地面才算(幾何重疊≠撞擊,lab 註解)→ 直化解除
  if (phase === STRIKE && !sim.impacted) {
    const from = Math.max(1, Math.ceil(P.hitFromS * n));
    for (let i = from; i <= n; i++) {
      if (!sim.cflag[i] || sim.cvn[i] < P.impactSpeed) continue;
      sim.impacted = true; sim.impactAge = 0;
      for (let k = Math.max(1, i - 4); k <= n; k++) {
        const m = k * 3;
        prev[m] += dir.x * P.recoilImpulse;
        prev[m + 1] += dir.y * P.recoilImpulse;
        prev[m + 2] += dir.z * P.recoilImpulse;
      }
      break;
    }
  }
  if (sim.impacted) sim.impactAge += dt;
}

/* ==== 電流外觀(lab 三層同軸管+分岔電弧移植;配色換遊戲雷系語言 0x9fd0ff 藍白,對齊
   boltAims/bolt 亮束——lab 的琥珀金是 lab 主題色)。抖動/分岔只在渲染層,sim.pos 不受影響。==== */
const RING = 6, MAXBR = 16, SEC = P.segments + 1;
// 決定性 hash:同 (i,tick) 永遠同亂數 → 閃變是「離散跳變」,每 1/elecFreq 秒整組重擲(電弧關鍵)
function hash2(i, t, k) {
  const x = Math.sin(i * 127.1 + t * 311.7 + k * 74.7) * 43758.5453;
  return x - Math.floor(x);
}
function buildTubeGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEC * RING * 3), 3));
  const idx = [];
  for (let i = 0; i < SEC - 1; i++) for (let k = 0; k < RING; k++) {
    const a = i * RING + k, b = i * RING + (k + 1) % RING;
    const c = (i + 1) * RING + k, d = (i + 1) * RING + (k + 1) % RING;
    idx.push(a, c, b, b, c, d);
  }
  g.setIndex(idx);
  return g;
}
function buildWhip() {
  const grp = new THREE.Group(); grp.name = 'WHIP';
  // 加法混色+關 depthWrite+關 fog:光暈疊亮不被霧染灰(lab);FX_LOW 砍外暈+分岔
  const mats = [
    new THREE.MeshBasicMaterial({ color: 0xf4ffff, fog: false }),
    new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    new THREE.MeshBasicMaterial({ color: 0x5f9fd8, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  ];
  const layers = [];
  const muls = [0.62, 1.9, 3.6];
  for (let li = 0; li < 3; li++) {
    if (li === 2 && FX_LOW) break;
    const geo = buildTubeGeo();
    const m = new THREE.Mesh(geo, mats[li]);
    m.frustumCulled = false; m.renderOrder = 20 + li; m.userData.__whip = true;
    grp.add(m); layers.push({ geo, mat: mats[li], mul: muls[li] });
  }
  let brGeo = null, brMat = null;
  if (!FX_LOW) {
    brGeo = new THREE.BufferGeometry();
    brGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXBR * 4 * 3), 3));
    brMat = new THREE.LineBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const lines = new THREE.LineSegments(brGeo, brMat);
    lines.frustumCulled = false; lines.renderOrder = 24; grp.add(lines);
  }
  scene.add(grp);
  return { grp, layers, brGeo, brMat, sim: null, phase: IDLE, u: 0, t0: -9, castStart: 0, castAt: 0, aim: 0, lastT: null, acc: 0, lastTick: -1, shown: false };
}

const _t = []; for (let i = 0; i < SEC; i++) _t.push(new THREE.Vector3());
const _nrm = new THREE.Vector3(), _bin = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pt = new THREE.Vector3(), _prevT = new THREE.Vector3();
const _rv = new THREE.Vector3();
const dpos = new Float64Array(SEC * 3);   // 抖動後的顯示中軸(分岔也從這裡長)
function updateTube(ws, energy, tick) {
  const sim = ws.sim, pos = sim.pos, n = sim.n;
  for (let i = 0; i <= n; i++) {   // 1) 骨幹切線(抖動偏移要垂直於它)
    const a = Math.max(0, i - 1) * 3, b = Math.min(n, i + 1) * 3;
    _t[i].set(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
    if (_t[i].lengthSq() < 1e-12) _t[i].set(0, 0, 1);
    _t[i].normalize();
  }
  for (let i = 0; i <= n; i++) {   // 2) 抖動中軸:隨機向量去切向分量;根部釘死(接在手上)
    const j = i * 3;
    let ax = pos[j], ay = pos[j + 1], az = pos[j + 2];
    if (i > 0) {
      let amp = P.elecAmp * energy * Math.min(i / 4, 1) * (0.45 + 1.1 * hash2(i, tick, 9));
      if (hash2(i, tick, 10) < 0.18) amp *= 2.2;            // 偶發大折=銳利尖角
      _rv.set(hash2(i, tick, 1) * 2 - 1, hash2(i, tick, 2) * 2 - 1, hash2(i, tick, 3) * 2 - 1);
      _rv.addScaledVector(_t[i], -_rv.dot(_t[i]));
      const m = _rv.length() || 1;
      ax += _rv.x / m * amp; ay += _rv.y / m * amp; az += _rv.z / m * amp;
    }
    dpos[j] = ax; dpos[j + 1] = ay; dpos[j + 2] = az;
  }
  for (let i = 0; i <= n; i++) {   // 3) 抖動後中軸重算切線+平行傳輸座標系(Frenet 反曲點會爆閃,lab 註解)
    const a = Math.max(0, i - 1) * 3, b = Math.min(n, i + 1) * 3;
    _t[i].set(dpos[b] - dpos[a], dpos[b + 1] - dpos[a + 1], dpos[b + 2] - dpos[a + 2]);
    if (_t[i].lengthSq() < 1e-12) _t[i].set(0, 0, 1);
    _t[i].normalize();
  }
  _nrm.set(0, 1, 0);
  if (Math.abs(_nrm.dot(_t[0])) > 0.95) _nrm.set(1, 0, 0);
  _nrm.addScaledVector(_t[0], -_nrm.dot(_t[0])).normalize();
  _prevT.copy(_t[0]);
  for (let i = 0; i <= n; i++) {
    if (i > 0) {
      _q.setFromUnitVectors(_prevT, _t[i]);
      _nrm.applyQuaternion(_q);
      _nrm.addScaledVector(_t[i], -_nrm.dot(_t[i]));
      if (_nrm.lengthSq() < 1e-10) _nrm.set(_t[i].y, -_t[i].x, 0);
      _nrm.normalize();
      _prevT.copy(_t[i]);
    }
    _bin.crossVectors(_t[i], _nrm);
    const sArc = i / n, k = i * 3;
    const rB = whipRadius(sArc) * (0.7 + 0.6 * hash2(i, tick, 8));   // 半徑也不規則
    for (const L of ws.layers) {
      const vp = L.geo.attributes.position.array, r = rB * L.mul;
      for (let jj = 0; jj < RING; jj++) {
        const ang = jj / RING * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
        _pt.set(_nrm.x * ca + _bin.x * sa, _nrm.y * ca + _bin.y * sa, _nrm.z * ca + _bin.z * sa);
        const o = (i * RING + jj) * 3;
        vp[o] = dpos[k] + _pt.x * r; vp[o + 1] = dpos[k + 1] + _pt.y * r; vp[o + 2] = dpos[k + 2] + _pt.z * r;
      }
    }
  }
  for (const L of ws.layers) L.geo.attributes.position.needsUpdate = true;
}
function rebuildBranches(ws, tick, energy) {  // 分岔電弧:只在 tick 跳變時重擲(與主幹同節奏)
  const arr = ws.brGeo.attributes.position.array, n = ws.sim.n;
  const count = Math.min(MAXBR, Math.round(P.elecBranches * (0.4 + energy * 0.8)));
  let w = 0;
  for (let b = 0; b < count; b++) {
    const i = 3 + Math.floor(hash2(b, tick, 20) * (n - 3));
    const j = i * 3, bx = dpos[j], by = dpos[j + 1], bz = dpos[j + 2];
    let dx = hash2(b, tick, 21) * 2 - 1, dy = hash2(b, tick, 22) * 2 - 1, dz = hash2(b, tick, 23) * 2 - 1;
    const m = Math.hypot(dx, dy, dz) || 1; dx /= m; dy /= m; dz /= m;
    const L = ((0.07 + 0.16 * hash2(b, tick, 24)) * (0.5 + energy * 0.8)) * K;
    const kx = (hash2(b, tick, 25) * 2 - 1) * L * 0.45;
    const ky = (hash2(b, tick, 26) * 2 - 1) * L * 0.45;
    const kz = (hash2(b, tick, 27) * 2 - 1) * L * 0.45;
    const mx = bx + dx * L * 0.5 + kx, my = by + dy * L * 0.5 + ky, mz = bz + dz * L * 0.5 + kz;
    const ex = bx + dx * L, ey = by + dy * L, ez = bz + dz * L;
    arr[w++] = bx; arr[w++] = by; arr[w++] = bz; arr[w++] = mx; arr[w++] = my; arr[w++] = mz;
    arr[w++] = mx; arr[w++] = my; arr[w++] = mz; arr[w++] = ex; arr[w++] = ey; arr[w++] = ez;
  }
  ws.brGeo.setDrawRange(0, w / 3);
  ws.brGeo.attributes.position.needsUpdate = true;
}

/* ==== 驅動:每幀由 actor-brawler 呼叫(g 世界變換已套好=腕骨世界座標是本幀最新)==== */
// 方向:lab 的 socket 空間(+Z=前)旋到 facing——fwd=(cos a,0,sin a)、up=(0,1,0)、right=fwd×up
function dirWorld(d, a, out) {
  const fx = Math.cos(a), fz = Math.sin(a);   // labX = up×fwd = (fz, 0, -fx)
  out.x = fz * d[0] + fx * d[2];
  out.y = d[1];
  out.z = -fx * d[0] + fz * d[2];
  return out;
}
function nlerpV(a, b, t, o) {
  o.x = lerp(a.x, b.x, t); o.y = lerp(a.y, b.y, t); o.z = lerp(a.z, b.z, t);
  const m = Math.hypot(o.x, o.y, o.z) || 1e-9;
  o.x /= m; o.y /= m; o.z /= m; return o;
}
const _hand = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _back = new THREE.Vector3(), _top = new THREE.Vector3();
const _dA = new THREE.Vector3(), _dB = new THREE.Vector3(), _dir = new THREE.Vector3();
const FIXED = 1 / 120;

export function updateWhip(e, g, R) {
  const u = g.userData;
  let ws = u.whip;
  const now = game.time;
  const casting = e._itemCastType === 'lightning' && (e._itemCastAt || 0) > now;
  const holding = e.item === 'lightning';
  const after = !!ws && ws.phase !== IDLE;   // item-4h:任何非 IDLE 相位都撐可見——最後一發清 item 後,發動幀 casting 轉 false 而相位還在 WINDUP(轉 STRIKE 在下方相位機,晚於此 want 檢查),舊寫法只認 STRIKE/RECOVER=在這一幀 want 掉 false 提早收鞭;改認「非 IDLE」讓相位機跑完 WINDUP→STRIKE→RECOVER→IDLE 才收
  const want = e.state === 'alive' && (holding || casting || after);
  if (!ws) { if (!want) return; ws = u.whip = buildWhip(); }
  if (!want) { ws.grp.visible = false; ws.phase = IDLE; ws.shown = false; ws.lastT = null; return; }
  ws.grp.visible = true;

  // 鞭根=右手腕(avatar 顯示時取 avatar 手骨——box 腕是隱形 driver,同扛物病 3;box 模式取 box 腕)
  const av = u.avatar;
  const hb = av && ((av.handRig && av.handRig.R && av.handRig.R.fingers) || (av.by.hand_r && av.by.hand_r.bone));
  if (hb) hb.getWorldPosition(_hand); else R.armR.wr.getWorldPosition(_hand);

  if (!ws.shown) {   // 首次亮相(撿到電鞭/開局):在手邊垂放(下前方),別從原點掃過全場
    ws.shown = true; ws.phase = IDLE; ws.lastT = now; ws.acc = 0;
    ws.sim = ws.sim || createWhipSim(_hand);
    dirWorld([0, -0.55, 0.83], e.facing || 0, _dir);
    resetWhipSim(ws.sim, _hand, [_dir.x, _dir.y, _dir.z]);
  }
  const sim = ws.sim;

  // ---- 相位機:施放排程(WINDUP)→ 施放幀(STRIKE)→ RECOVER → IDLE(時間軸=game.time,hitstop 凍結一致)----
  if (casting) {
    if (ws.phase !== WINDUP) { ws.phase = WINDUP; ws.castStart = now; ws.castAt = e._itemCastAt; }
    ws.u = clamp01((now - ws.castStart) / Math.max(ws.castAt - ws.castStart, 0.01));
  } else if (ws.phase === WINDUP) {
    if (e.stunned || e.carriedBy || e.state !== 'alive') ws.phase = IDLE;   // 施法被打斷(鏡射 resolveItemCast 守衛)=不出鞭
    else {
      ws.phase = STRIKE; ws.t0 = now; ws.u = 0; ws.aim = e.facing || 0;    // 鎖定出鞭方向=施放幀 facing(=判定用的同一個角)
      sim.cracked = false; sim.impacted = false; sim.impactAge = 0;
    }
  } else if (ws.phase === STRIKE) {
    ws.u = (now - ws.t0) / P.tStrike;
    if (ws.u >= 1) { ws.phase = RECOVER; ws.t0 = now; ws.u = 0; }
  } else if (ws.phase === RECOVER) {
    ws.u = (now - ws.t0) / P.tRecover;
    if (ws.u >= 1) { ws.phase = IDLE; ws.u = 0; }
  }

  // ---- 目標方向(lab scriptedSocket 的方向軌,位置軌由腕骨/clip 接手)----
  const aimA = ws.phase === STRIKE ? ws.aim : (e.facing || 0);
  dirWorld(P.strikeDir, aimA, _fwd);
  if (ws.phase === WINDUP) {
    dirWorld(P.backDir, aimA, _back);
    nlerpV(_fwd, _back, easeInOut(clamp01(ws.u / P.backSettle)), _dir);
  } else if (ws.phase === STRIKE) {
    // 腕轉同步「波前進度」:back→top→fwd 方向貝茲(de Casteljau),波才會沿鞭身滾動(lab v2.3 的病)
    dirWorld(P.backDir, aimA, _back); dirWorld(P.topDir, aimA, _top);
    const t = smoothstep(0, P.dirSweep, ws.u * P.frontSpeed);
    nlerpV(_back, _top, t, _dA); nlerpV(_top, _fwd, t, _dB); nlerpV(_dA, _dB, t, _dir);
  } else _dir.copy(_fwd);

  // ---- 子步推進(1/120 固定步長;dt=game.time 差=hitstop 時整條鞭凍結,與世界一致)----
  if (ws.lastT == null) ws.lastT = now;
  const dtR = Math.min(Math.max(now - ws.lastT, 0), 0.1); ws.lastT = now;
  ws.acc += dtR;
  let steps = Math.min(12, Math.floor(ws.acc / FIXED));
  ws.acc -= steps * FIXED;
  for (let k = 0; k < steps; k++) whipStep(sim, _hand, _dir, ws.phase, ws.u, FIXED);
  if (!steps) { sim.pos[0] = _hand.x; sim.pos[1] = _hand.y; sim.pos[2] = _hand.z; } // 凍結幀鞭根仍貼手(clip 繼續播)

  // ---- 外觀:能量分級(待機微電紋→出鞭全功率→撞擊爆亮);閃變吃真實時鐘=hitstop 時電流仍滋滋作響 ----
  let energy = ws.phase === STRIKE ? 1.0 : ws.phase === WINDUP ? 0.55 : ws.phase === RECOVER ? 0.7 : 0.35;
  if (sim.impacted && sim.impactAge < 0.18) energy += 1.1 * (1 - sim.impactAge / 0.18);
  const tick = Math.floor(performance.now() / 1000 * P.elecFreq);
  updateTube(ws, energy, tick);
  if (ws.brGeo && tick !== ws.lastTick) { rebuildBranches(ws, tick, energy); ws.lastTick = tick; }
  const glow = Math.min(1.6, 0.6 + energy * 0.6);   // 光暈強度=使用者 lab 定稿 elecGlow(0.16=低調,核心線為主)
  if (ws.layers[1]) ws.layers[1].mat.opacity = 0.55 * P.elecGlow * glow;
  if (ws.layers[2]) ws.layers[2].mat.opacity = 0.25 * P.elecGlow * glow;
  if (ws.brMat) ws.brMat.opacity = 0.9 * Math.min(1, 0.4 + energy * 0.7);
}
