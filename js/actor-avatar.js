// actor-avatar.js — Phase 1:讓 v2 fighter 渲染使用者的 GLB 角色(assets/rigs/base-avatar.glb),
// 而非體素方塊人。原理與 punch-studio 的 avatar.js 同構:box brawler(actor-brawler)照常被 47 軸
// 姿勢驅動(當隱形 driver),每幀把各關節「相對 T-pose 的世界旋轉差量」轉寫到 GLB 角色骨頭。
//   Δ = q_now · q_T⁻¹(box 關節)   →   角色骨頭目標世界 = Δ · bQ_T(角色骨頭 rest)
// 好處:box rig 的走路/出拳/踩地全部自動繼承,角色跟著動;WYSIWYG——編排器裡調的姿勢 = 遊戲裡的姿勢。
// 純 render 層:不 import sim,不影響玩法/多人。**預設開啟(正式產品外觀)**;?avatar=0 退回方塊人(除錯用)。
//
// 需求:vendor/GLTFLoader.js(全域 THREE.GLTFLoader)已在 v2.html 載入。
import { game } from './state.js';
import { preloadRiggedHands, riggedHandsReady, mountRiggedHands, applyFingerPose } from './actor-hands-rigged.js';

// ugc-1(2026-07-29 使用者拍板走「玩家自製角色」路線 B):支援**蒙皮 GLB**(VRoid/Blender/Mixamo 的正常產出),
// 不再限剛體分件。三項核心見下:①clone 後重綁骨架 ②骨名別名表 ③per-part 縮放改縮骨頭。
// `?avatar=<路徑或 blob:URL>` 換角色檔(匯入精靈用 URL.createObjectURL 餵進來);?avatar=0 仍是退回方塊人。
const DEFAULT_AVATAR_URL = 'assets/rigs/base-avatar.glb';
const AVATAR_URL = (() => {
  const q = new URLSearchParams(location.search).get('avatar');
  return (q && q !== '0' && q !== '1') ? q : DEFAULT_AVATAR_URL;
})();
// 角色整體放大倍率(相對「對齊 box rig 身高」的基準)。v2 遠鏡頭下大一點更好看。
// 可用 URL ?avscale=1.5 即時試不同大小;預設 1.3。
const AVATAR_SCALE = (() => { const v = parseFloat(new URLSearchParams(location.search).get('avscale')); return Number.isFinite(v) ? Math.max(0.5, Math.min(3, v)) : 1.3; })();
let TEMPLATE = null;          // 載入一次的 GLB 場景(每個 fighter clone 一份)
let loadState = 0;            // 0 未載 / 1 載入中 / 2 成功 / 3 失敗
// avatar=正式產品外觀,**預設開啟**;?avatar=0 退回方塊人(box driver 除錯/低配比對用)。
export function avatarEnabled() { return new URLSearchParams(location.search).get('avatar') !== '0'; }
export function avatarReady() { return loadState === 2; }

export function preloadAvatar() {
  if (loadState !== 0 || !avatarEnabled()) return;
  if (!THREE.GLTFLoader) { loadState = 3; console.warn('[avatar] GLTFLoader 未載入'); return; }
  preloadRiggedHands();   // avatar 專用 rigged 手(與 punch-studio 同一份),隨 avatar 一起備料
  loadState = 1;
  fetch(AVATAR_URL).then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
    .then(ab => new Promise((res, rej) => new THREE.GLTFLoader().parse(ab, '', res, rej)))
    .then(gltf => { TEMPLATE = gltf.scene; TEMPLATE.updateMatrixWorld(true); loadState = 2; })
    .catch(e => { loadState = 3; console.warn('[avatar] 載入失敗:', e); });
}

// box rig 骨頭 → 角色骨頭型別。side:-1=世界 −X(左),+1=右。
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
  foot:     (R, s) => s < 0 ? R.legL.ankle : R.legR.ankle,   // 踝節點=腳的 driver(lL_ax/lL_ty/自動壓平/墊腳 → 角色腳掌)
};
const PAIRED = ['upperarm', 'forearm', 'hand', 'thigh', 'shin', 'foot'];
// ugc-1 ②骨名別名表:**有序**(第一個命中就定案),長字串必須排在會被它包含的短字串之前——
// 'forearm'/'lowerarm' 要早於裸 'arm'、'upperleg'/'lowerleg' 要早於裸 'leg',不然 Mixamo 的
// LeftForeArm 會先被 'arm'→upperarm 吃掉。涵蓋:遊戲原生命名 / VRoid·VRM(J_Bip_*)/ Mixamo / Blender Rigify。
const BONE_ALIASES = [
  ['upperarm', 'upperarm'],
  ['forearm', 'forearm'], ['lowerarm', 'forearm'],
  ['hand', 'hand'],
  ['upperleg', 'thigh'], ['upleg', 'thigh'], ['thigh', 'thigh'],
  ['lowerleg', 'shin'], ['calf', 'shin'], ['shin', 'shin'],
  ['foot', 'foot'],
  ['spine', 'torso'], ['chest', 'torso'], ['torso', 'torso'],
  ['neck', 'neck'], ['head', 'head'],
  ['hips', 'root'], ['root', 'root'],
  ['arm', 'upperarm'],                                  // Mixamo LeftArm=上臂(必須排最後)
  ['leg', 'shin'],                                      // Mixamo LeftLeg=小腿(UpLeg 才是大腿,已在前面)
];
// 容器節點:名字含關鍵字但不是骨頭。'Armature'(Blender 匯出的根)小寫化含 'arm' → 會被裸 'arm' 規則
// 誤收成 upperarm,而且它是 traverse 的頭一個 → 靠 `if (by[key]) continue` 把真正的上臂擋在門外。
const BONE_SKIP = /^(armature|scene|rootnode|correction|sketchfab)/;

// ugc-1b rest 姿勢正規化:重定向的基準線是角色**自己的 rest**(目標世界 = Δ · bQT)——rest 偏了,
// 每個姿勢都帶著這個偏差。VRoid/多數 DCC 出廠是 **A-pose**(手臂往下 45°),實測偏離 T-pose 45°,
// 直接拿來用 = 所有出拳動作手臂都低 45°。這裡在校正當下把各肢段的 rest 方向轉到 box rig T-pose 的方向,
// 讓「玩家丟什麼進來都能用」,而不是要求每個人先去 Blender 擺 T-pose。
// **只對匯入角色生效**:內建 base-avatar 是我們自己的資產(手臂已在 2~5° 內、腿刻意外八 13°),
// 硬拉直會改掉正式角色的站姿=視覺回歸。`?tpose=1` 強制開、`?tpose=0` 強制關(實驗室 A/B 用)。
const TPOSE_FIX = (() => {
  const q = new URLSearchParams(location.search).get('tpose');
  return q === null ? (AVATAR_URL !== DEFAULT_AVATAR_URL) : q !== '0';
})();
// 肢段 = 骨頭 → 它的遠端子骨(方向由這兩點定義);torso 取到 head(neck 的 box driver 就是 spine 本人=零向量)
const LIMB_CHILD = { torso: 'head',
  upperarm_l: 'forearm_l', forearm_l: 'hand_l', upperarm_r: 'forearm_r', forearm_r: 'hand_r',
  thigh_l: 'shin_l', shin_l: 'foot_l', thigh_r: 'shin_r', shin_r: 'foot_r' };
const _na = new THREE.Vector3(), _nb = new THREE.Vector3(), _nc = new THREE.Vector3(), _nd = new THREE.Vector3();
const _nqf = new THREE.Quaternion(), _nqw = new THREE.Quaternion(), _nqp = new THREE.Quaternion();
// apply=false → 只量不改(用來取修正後的殘差,當驗收數字)。回傳最大偏離角度(度)。
function normalizeRest(by, order, apply) {
  let maxDeg = 0;
  for (const k of order) {                    // **父先子後**:改父會帶動子,子要用改過後的位置重量
    const ck = LIMB_CHILD[k]; if (!ck) continue;
    const e = by[k], c = by[ck]; if (!e || !c) continue;
    const n0 = e.node(), n1 = c.node(); if (!n0 || !n1) continue;
    e.bone.getWorldPosition(_na); c.bone.getWorldPosition(_nb);
    n0.getWorldPosition(_nc); n1.getWorldPosition(_nd);
    const have = _nb.sub(_na), want = _nd.sub(_nc);
    if (have.lengthSq() < 1e-12 || want.lengthSq() < 1e-12) continue;
    have.normalize(); want.normalize();
    const ang = Math.acos(Math.max(-1, Math.min(1, have.dot(want))));
    maxDeg = Math.max(maxDeg, ang * 180 / Math.PI);
    if (!apply || !(ang > 1e-4)) continue;
    _nqf.setFromUnitVectors(have, want);      // 世界空間:現有方向 → 目標方向
    e.bone.getWorldQuaternion(_nqw);
    e.bone.parent.getWorldQuaternion(_nqp).invert();
    e.bone.quaternion.copy(_nqw).premultiply(_nqf).premultiply(_nqp);
    e.bone.updateMatrixWorld(true);
  }
  return +maxDeg.toFixed(1);
}

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
  const skinned = rebindSkeletons(sc);

  // 收角色骨頭(接受 Bone 或空節點;網格 geo_* 是 Mesh 排除)
  const _v = new THREE.Vector3();
  const found = [];
  sc.traverse(o => {
    if (o.isMesh) return;
    const n = (o.name || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!n || BONE_SKIP.test(n)) return;
    const hit = BONE_ALIASES.find(([k]) => n.includes(k));
    if (hit) found.push({ bone: o, type: hit[1] });
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
  const S = (size.y > 1e-6 ? boxH / size.y : 1) * AVATAR_SCALE;   // ×整體放大倍率
  const wrap = new THREE.Group(); wrap.name = 'AVATAR'; wrap.scale.setScalar(S); wrap.add(sc);
  g.add(wrap);

  // T-pose 校正:box rig 擺 T-pose,記 box 關節與角色骨頭的世界四元數
  applyBrawlerPose(boxRig, tposePose());
  boxRig.P.updateMatrixWorld(true);
  wrap.updateMatrixWorld(true);
  const order = Object.keys(by).sort((a, b) => depth(by[a].bone) - depth(by[b].bone));
  // ugc-1b:rest 姿勢正規化(**校正必須在記 bQT 之前**——bQT 就是基準線)
  const restDevDeg = normalizeRest(by, order, TPOSE_FIX);          // 修前偏離(TPOSE_FIX 時順便套用)
  const restResidDeg = normalizeRest(by, order, false);            // 修後殘差(關掉修正時 = 同一個數)
  Object.values(by).forEach(e => { const nd = e.node(); if (nd) { nd.getWorldQuaternion(e.qT); e.bone.getWorldQuaternion(e.bQT); } });

  const av = { wrap, S, by, order, skinned, tposeFix: TPOSE_FIX, restDevDeg, restResidDeg, standH: size.y * S };   // standH=渲染後真實站高(px);被扛拎頭吊掛時頭→腳的身長(positionCarried 讀)

  // 隱藏 box 網格(保留骨架群組當 driver);記錄以便切回
  av.hidden = [];
  g.traverse(o => { if (o.isMesh && !insideWrap(o, wrap) && !o.userData.__equip) { av.hidden.push(o); o.visible = false; } }); // __equip=頭戴裝備(火帽),別跟方塊人一起藏

  // rigged 手:掛到 avatar 手骨(async 載入,可能還沒好 → retargetAvatar 會 lazy 重試)
  if (riggedHandsReady()) mountRiggedHands(av);

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
  // ugc-1 ③:剛體分件=縮掛在骨頭下的網格;**蒙皮**=網格全掛在 SkinnedMesh 上、骨頭底下沒有子網格
  //(`e.meshes` 恆空 → 舊寫法整組靜默失效)→ 改縮**骨頭**。骨縮放會沿骨鏈繼承,所以每組只縮近端那根
  //(forearm 帶 hand、shin 帶 foot),不然父子各乘一次 = s² 爆掉。
  const setS = (k, v) => {
    const e = av.by[k]; if (!e) return; const s = v || 1;
    if (av.skinned) { e.bone.scale.setScalar(s); return; }
    if (!e.meshes) return;
    e.meshes.forEach(m => { m.scale.setScalar(s); if (m.userData.restPos) m.position.copy(m.userData.restPos).multiplyScalar(s); });
  };
  if (av.skinned) {
    setS('forearm_l', p.aL_scale); setS('forearm_r', p.aR_scale);   // hand 為子骨,自動繼承
    setS('shin_l', p.lL_scale);    setS('shin_r', p.lR_scale);      // foot 為子骨,自動繼承
    setS('torso', p.body_scale);
  } else {
    setS('forearm_l', p.aL_scale); setS('hand_l', p.aL_scale);
    setS('forearm_r', p.aR_scale); setS('hand_r', p.aR_scale);
    setS('shin_l', p.lL_scale);    setS('foot_l', p.lL_scale);
    setS('shin_r', p.lR_scale);    setS('foot_r', p.lR_scale);
    setS('torso', p.body_scale);
  }
  // 整肢伸展:縮近端骨頭(upperarm/thigh)→ 整條肢等比放大(uniform,子骨/網格一起帶)
  const setStretch = (k, v) => { const e = av.by[k]; if (e) e.bone.scale.setScalar(v || 1); };
  setStretch('upperarm_l', p.aL_stretch); setStretch('upperarm_r', p.aR_stretch);
  setStretch('thigh_l', p.lL_stretch);    setStretch('thigh_r', p.lR_stretch);
  // 踩地:角色最低頂點對齊 box rig 的腳底(box P 世界 y 已含踩地)。簡化:角色 wrap y = box 腳底世界 y。
  w.updateMatrixWorld(true);
  _fbox.setFromObject(w);
  const groundY = boxFootWorldY(boxRig);
  if (isFinite(_fbox.min.y)) w.position.y = groundY - _fbox.min.y;

  // rigged 手:async 載入,首次就緒時 lazy 掛;顯示中(抓握物品)才由 clip 手指軸(aL_/aR_ f*)驅動指骨。
  // 顯示切換在 actor-brawler updateHands 依 grab 狀態做(一般/戰鬥=原生手,抓握=rigged 手)。
  if (!av.handRig && riggedHandsReady()) mountRiggedHands(av);
  if (av.handRig && av.handShowingRigged) applyFingerPose(av, p);
}

// ---- 幾何小工具 ----
// ugc-1 ①:`Object3D.clone()` **不重綁骨架**——clone 出來的 SkinnedMesh 沿用 template 的 `skeleton` 引用,
// 而那份 skeleton 的 bones[] 指著 **template 的骨頭**。後果:兩個 fighter 共用同一副骨架(A 動 B 跟著動),
// 而且我們重定向寫的是 clone 的骨頭 → 蒙皮完全不跟著變形(實測形變量 0.0081 = 死的)。
// 修法=照名字把 skeleton.bones 重指到 clone 內的同名骨頭,再 `bind()` 回去(等同 SkeletonUtils.clone,
// 但 vendor 只有 GLTFLoader,不值得為這幾行再 vendor 一支)。回傳:這個角色是否含蒙皮網格。
function rebindSkeletons(sc) {
  const byName = new Map();
  sc.traverse(o => { if (o.isBone) byName.set(o.name, o); });
  let skinned = false;
  sc.traverse(o => {
    if (!o.isSkinnedMesh) return;
    skinned = true;
    o.frustumCulled = false;   // 蒙皮的 boundingSphere 停在 bind pose;骨頭一動就可能被誤剔除
    const src = o.skeleton;
    o.bind(new THREE.Skeleton(
      src.bones.map(b => byName.get(b.name) || b),
      src.boneInverses.map(m => m.clone())), o.bindMatrix.clone());
  });
  return skinned;
}
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
  [R.legL.ankle, R.legR.ankle].forEach(n => { if (n) { n.getWorldPosition(v); y = Math.min(y, v.y); } });
  if (isFinite(y)) return y - 2.6;                  // 踝再往下一個腳掌高(BRAWLER_SPEC.foot.h)
  [R.legL.kn, R.legR.kn].forEach(n => { if (n) { n.getWorldPosition(v); y = Math.min(y, v.y); } });
  return isFinite(y) ? y - 6 : 0;                   // 舊 fallback:小腿末端估
}
