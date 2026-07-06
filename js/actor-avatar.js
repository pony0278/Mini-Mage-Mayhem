// actor-avatar.js — Phase 1:讓 v2 fighter 渲染使用者的 GLB 角色(assets/rigs/base-avatar.glb),
// 而非體素方塊人。原理與 punch-studio 的 avatar.js 同構:box brawler(actor-brawler)照常被 47 軸
// 姿勢驅動(當隱形 driver),每幀把各關節「相對 T-pose 的世界旋轉差量」轉寫到 GLB 角色骨頭。
//   Δ = q_now · q_T⁻¹(box 關節)   →   角色骨頭目標世界 = Δ · bQ_T(角色骨頭 rest)
// 好處:box rig 的走路/出拳/踩地全部自動繼承,角色跟著動;WYSIWYG——編排器裡調的姿勢 = 遊戲裡的姿勢。
// 純 render 層:不 import sim,不影響玩法/多人。以 ?avatar=1 開啟(Phase 1 驗證用)。
//
// 需求:vendor/GLTFLoader.js(全域 THREE.GLTFLoader)已在 v2.html 載入。
import { game } from './state.js';

const AVATAR_URL = 'assets/rigs/base-avatar.glb';
let TEMPLATE = null;          // 載入一次的 GLB 場景(每個 fighter clone 一份)
let loadState = 0;            // 0 未載 / 1 載入中 / 2 成功 / 3 失敗
export function avatarEnabled() { return new URLSearchParams(location.search).get('avatar') === '1'; }
export function avatarReady() { return loadState === 2; }

export function preloadAvatar() {
  if (loadState !== 0 || !avatarEnabled()) return;
  if (!THREE.GLTFLoader) { loadState = 3; console.warn('[avatar] GLTFLoader 未載入'); return; }
  loadState = 1;
  fetch(AVATAR_URL).then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
    .then(ab => new Promise((res, rej) => new THREE.GLTFLoader().parse(ab, '', res, rej)))
    .then(gltf => { TEMPLATE = gltf.scene; TEMPLATE.updateMatrixWorld(true); loadState = 2; })
    .catch(e => { loadState = 3; console.warn('[avatar] 載入失敗:', e); });
}

// box rig 骨頭 → 角色骨頭型別。side:-1=世界 −X(左),+1=右。box rig 無踝關節 → 腳併入小腿。
const NODE_OF = {
  root:     (R) => R.P,
  torso:    (R) => R.spine,
  neck:     (R) => R.spine,        // 角色的頸跟軀幹(box 無獨立頸)
  head:     (R) => R.headPivot,
  upperarm: (R, s) => s < 0 ? R.armL.sh : R.armR.sh,
  forearm:  (R, s) => s < 0 ? R.armL.el : R.armR.el,
  hand:     (R, s) => s < 0 ? R.armL.wr : R.armR.wr,
  thigh:    (R, s) => s < 0 ? R.legL.hp : R.legR.hp,
  shin:     (R, s) => s < 0 ? R.legL.kn : R.legR.kn,
  // foot：box 無踝 → 讓腳的世界差量跟隨小腿(shin),不獨立驅動
};
const PAIRED = ['upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot'];
const TOKENS = ['upperarm', 'forearm', 'hand', 'thigh', 'shin', 'calf', 'foot', 'torso', 'neck', 'head', 'root'];

// T-pose:box rig 的中性測量姿勢(雙臂水平放下=角色 rest 對齊)。與編排器 inspectTposePose 同義:
// 手臂 sz=90(水平)、其餘 0。用來建立 box↔角色的世界四元數對照。
function tposePose() {
  return { aL_sz: 90, aR_sz: 90 };
}

// 建立 fighter 的角色實例:clone GLB、收骨頭、對 box rig 做 T-pose 校正、掛進 g、隱藏 box 網格。
// 需要 applyBrawlerPose 把 box rig 擺到 T-pose 一次(caller 傳入)。
export function buildAvatar(g, boxRig, applyBrawlerPose) {
  if (loadState !== 2 || !TEMPLATE) return null;
  const sc = TEMPLATE.clone(true);
  sc.updateMatrixWorld(true);

  // 收角色骨頭(接受 Bone 或空節點;網格 geo_* 是 Mesh 排除)
  const _v = new THREE.Vector3();
  const found = [];
  sc.traverse(o => {
    if (o.isMesh) return;
    const n = (o.name || '').toLowerCase().replace(/[^a-z]/g, '');
    const t = TOKENS.find(k => n.includes(k));
    if (t) found.push({ bone: o, type: t === 'calf' ? 'shin' : t });
  });
  const by = {};
  for (const f of found) {
    f.bone.getWorldPosition(_v);
    const s = _v.x < 0 ? -1 : 1;
    const key = PAIRED.includes(f.type) ? `${f.type}${s < 0 ? '_l' : '_r'}` : f.type;
    if (by[key]) continue;
    const nodeFor = NODE_OF[f.type];
    if (!nodeFor) continue;                       // foot 無對應 driver → 跳過(跟隨父骨)
    const meshes = f.bone.children.filter(c => c.isMesh);
    meshes.forEach(m => { m.userData.restPos = m.position.clone(); });   // 命中放大需繞關節縮放(restPos×s)
    by[key] = { bone: f.bone, node: () => nodeFor(boxRig, s), meshes, qT: new THREE.Quaternion(), bQT: new THREE.Quaternion() };
  }

  // 縮放角色到 box rig 身高。box brawler 世界高 ≈ hipY + torso 頂 + head ≈ 用包圍盒估。
  const bb = new THREE.Box3().setFromObject(sc), size = new THREE.Vector3(); bb.getSize(size);
  const boxH = boxRigHeight(boxRig);
  const S = size.y > 1e-6 ? boxH / size.y : 1;
  const wrap = new THREE.Group(); wrap.name = 'AVATAR'; wrap.scale.setScalar(S); wrap.add(sc);
  g.add(wrap);

  // T-pose 校正:box rig 擺 T-pose,記 box 關節與角色骨頭的世界四元數
  applyBrawlerPose(boxRig, tposePose());
  boxRig.P.updateMatrixWorld(true);
  wrap.updateMatrixWorld(true);
  Object.values(by).forEach(e => { const nd = e.node(); if (nd) { nd.getWorldQuaternion(e.qT); e.bone.getWorldQuaternion(e.bQT); } });

  const order = Object.keys(by).sort((a, b) => depth(by[a].bone) - depth(by[b].bone));
  const av = { wrap, S, by, order };

  // 隱藏 box 網格(保留骨架群組當 driver);記錄以便切回
  av.hidden = [];
  g.traverse(o => { if (o.isMesh && !insideWrap(o, wrap)) { av.hidden.push(o); o.visible = false; } });

  g.userData.avatar = av;
  if (typeof window !== 'undefined') (window.__avatars || (window.__avatars = [])).push(av);   // headless 健檢用
  return av;
}

// 每幀:box rig 已被 applyBrawlerPose 擺好姿勢 → 把世界差量轉寫到角色骨頭。
const _q1 = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _fbox = new THREE.Box3();
export function retargetAvatar(g, boxRig, pose) {
  const av = g.userData.avatar; if (!av) return;
  const w = av.wrap;
  const p = pose || {};
  // 位置/縮放:box rig 的 root(P)已含 squat/踩地,取其世界 y 讓角色一起沉;x/z 由 g 提供(fighter 位置)
  boxRig.P.updateMatrixWorld(true);
  w.position.set(0, 0, 0);
  w.quaternion.identity();
  w.scale.setScalar(av.S);
  w.updateMatrixWorld(true);
  for (const k of av.order) {
    const e = av.by[k], nd = e.node(); if (!nd) continue;
    nd.getWorldQuaternion(_q1);
    _qd.copy(e.qT).invert().premultiply(_q1);         // Δ = q_now · qT⁻¹
    _q2.copy(e.bQT).premultiply(_qd);                 // 目標世界 = Δ · bQT
    e.bone.parent.getWorldQuaternion(_qp).invert();
    e.bone.quaternion.copy(_q2).premultiply(_qp);     // local = qParent⁻¹ · 目標世界
    e.bone.updateMatrixWorld(true);
  }
  // 命中放大/身體縮放(Phase 1 遺漏 → 補上;繞關節縮放,近端黏住不飛走)
  const setS = (k, v) => { const e = av.by[k]; if (!e || !e.meshes) return; const s = v || 1;
    e.meshes.forEach(m => { m.scale.setScalar(s); if (m.userData.restPos) m.position.copy(m.userData.restPos).multiplyScalar(s); }); };
  setS('forearm_l', p.aL_scale); setS('hand_l', p.aL_scale);
  setS('forearm_r', p.aR_scale); setS('hand_r', p.aR_scale);
  setS('shin_l', p.lL_scale);    setS('foot_l', p.lL_scale);
  setS('shin_r', p.lR_scale);    setS('foot_r', p.lR_scale);
  setS('torso', p.body_scale);
  // 整肢伸展:縮近端骨頭(upperarm/thigh)→ 整條肢等比放大(uniform,子骨/網格一起帶)
  const setStretch = (k, v) => { const e = av.by[k]; if (e) e.bone.scale.setScalar(v || 1); };
  setStretch('upperarm_l', p.aL_stretch); setStretch('upperarm_r', p.aR_stretch);
  setStretch('thigh_l', p.lL_stretch);    setStretch('thigh_r', p.lR_stretch);
  // 踩地:角色最低頂點對齊 box rig 的腳底(box P 世界 y 已含踩地)。簡化:角色 wrap y = box 腳底世界 y。
  w.updateMatrixWorld(true);
  _fbox.setFromObject(w);
  const groundY = boxFootWorldY(boxRig);
  if (isFinite(_fbox.min.y)) w.position.y = groundY - _fbox.min.y;
}

// ---- 幾何小工具 ----
function depth(o) { let d = 0, p = o; while (p.parent) { d++; p = p.parent; } return d; }
function insideWrap(o, wrap) { let p = o; while (p) { if (p === wrap) return true; p = p.parent; } return false; }
function boxRigHeight(R) {
  const bb = new THREE.Box3();
  R.P.updateMatrixWorld(true);
  [R.headPivot, R.legL.kn, R.legR.kn].forEach(n => { if (n) bb.expandByObject(n); });
  const s = new THREE.Vector3(); bb.getSize(s);
  return s.y > 1e-6 ? s.y * 1.15 : 55;              // ×1.15 補頭頂/腳底外延
}
function boxFootWorldY(R) {
  const v = new THREE.Vector3(); let y = Infinity;
  [R.legL.kn, R.legR.kn].forEach(n => { if (n) { n.getWorldPosition(v); y = Math.min(y, v.y); } });
  return isFinite(y) ? y - 6 : 0;                   // 小腿末端再往下一個腳掌高
}
