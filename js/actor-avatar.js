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

// ===== ugc-1c 比例正規化:把匯入角色的**骨架比例**壓成 chibi 比例 =====
// 使用者拍板 2026-07-29:「維持 chibi 風格,其他 GLB 只是外觀套進來,骨子還是 chibi——
// 原本的大頭就是大頭,VRoid 的頭套進來只是外觀改變,頭還是一樣大」。
// 可行性關鍵:`retargetAvatar` 每幀**只寫 `bone.quaternion`,從不寫 `bone.position`** → 改 rest 位移
// 不會被每幀蓋掉;蒙皮頂點跟著骨頭走,所以改骨架比例 = 改身形,不用碰網格。
// 這跟 normalizeRest 是同一個機制的兩半:那邊修 rest 的**旋轉**,這邊修 rest 的**位移與縮放**。
// 目標比例(各段長度 ÷ 全身高)實測自內建 base-avatar(3.08 頭身);換基底角色要重量一次:
//   scratchpad/proportions.mjs —— 量 `骨頭→子骨頭` 世界距離 ÷ 包圍盒高。
const CHIBI = { upperarm: 0.0834, forearm: 0.1171, thigh: 0.1266, shin: 0.1769,
                headTop: 0.325, shoulderW: 0.195, hipW: 0.12 };
// 同 TPOSE_FIX:**只對匯入角色生效**(內建 base-avatar 本身就是比例基準,對它做等於原地踏步)。
const CHIBI_FIT = (() => {
  const q = new URLSearchParams(location.search).get('chibi');
  return q === null ? (AVATAR_URL !== DEFAULT_AVATAR_URL) : q !== '0';
})();
const _cv = new THREE.Vector3(), _cw = new THREE.Vector3(), _cbox = new THREE.Box3();
// 回傳修改前的頭身比(給報告/測試看),沒東西可改回 null。
function conformProportions(sc, by) {
  sc.updateMatrixWorld(true);
  // ⚠ 一律用 sampledBox 不用 setFromObject:對蒙皮角色後者回傳 bind pose 的盒子,①② 改完骨頭後它不會動,
  // ③ 拿它量頭高就會混到過期的數字(第一次量剛好還沒改所以看不出來,換個模型就中招)。
  const bb0 = sampledBox(sc, _cbox);
  const H = bb0.max.y - bb0.min.y;
  if (!(H > 1e-6) || !by.head) return null;
  const wp = (k, out) => { by[k].bone.getWorldPosition(out); return out; };
  const before = +(H / (bb0.max.y - wp('head', _cv).y)).toFixed(2);

  // ① 肢段長度:縮子骨的 local 位移到目標長度。**父先子後**——改父會帶動子,子要用改過後的位置重量。
  const setLen = (a, b, t) => {
    for (const s of ['_l', '_r']) {
      const A = by[a + s], Bn = by[b + s]; if (!A || !Bn) continue;
      sc.updateMatrixWorld(true);
      const now = wp(a + s, _cv).distanceTo(wp(b + s, _cw));
      if (now < 1e-6) continue;
      Bn.bone.position.multiplyScalar(t * H / now);
      Bn.bone.updateMatrixWorld(true);
    }
  };
  setLen('upperarm', 'forearm', CHIBI.upperarm); setLen('forearm', 'hand', CHIBI.forearm);
  setLen('thigh', 'shin', CHIBI.thigh);          setLen('shin', 'foot', CHIBI.shin);

  // ② 肩寬/臀寬:近端骨的 local X 外推(chibi 比寫實角色寬 ~1.4×)
  const widen = (k, t) => {
    const L = by[k + '_l'], R = by[k + '_r']; if (!L || !R) return;
    sc.updateMatrixWorld(true);
    const now = wp(k + '_l', _cv).distanceTo(wp(k + '_r', _cw)); if (now < 1e-6) return;
    const f = t * H / now;
    [L, R].forEach(e => { e.bone.position.x *= f; e.bone.updateMatrixWorld(true); });
  };
  widen('upperarm', CHIBI.shoulderW); widen('thigh', CHIBI.hipW);

  // ③ 大頭:頭骨等比放大(頭髮/髮飾骨是子骨,自動跟著大)。
  // ⚠ 只能動 head——`torso`/`forearm`/`shin`/`upperarm`/`thigh` 的 bone.scale 是命中放大/整肢伸展
  // (retargetAvatar 的 setS/setStretch)每幀在寫的,在這裡設會被蓋掉。
  sc.updateMatrixWorld(true);
  const bb = sampledBox(sc, _cbox);
  const nowHead = bb.max.y - wp('head', _cv).y;
  if (nowHead > 1e-6) by.head.bone.scale.setScalar(CHIBI.headTop * H / nowHead);
  sc.updateMatrixWorld(true);
  return before;
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
    const i = BONE_ALIASES.findIndex(([k]) => n.includes(k));
    if (i >= 0) found.push({ bone: o, type: BONE_ALIASES[i][1], pri: i });
  });
  // 同一個 key 有多個候選時**照別名表優先序取,不是照 traverse 順序**。
  // 踩過:VRoid 檔同時有 `Root`(骨架根,在腳底)與 `J_Bip_C_Hips`(真正的髖)——Root 在階層上更早,
  // 舊寫法「重複取第一個」就選了它,root 的樞紐變成腳底 → clip 的 root_x(pitch)會繞著腳踝甩全身。
  // 別名表裡 `hips` 排在裸 `root` 之前,照 pri 取就對了。
  found.sort((a, b) => a.pri - b.pri);
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

  // 蒙皮版骨局部 bbox(火帽/X光顱球/頭像取景用;剛體走 meshes 那條路不需要)
  if (skinned) { const lb = skinnedLocalBoxes(sc, by);
    for (const k in by) { by[k].localBox = lb.exact[k] || null; by[k].localBoxDeep = lb.deep[k] || null; } }

  // ugc-1c 比例正規化:**必須在量包圍盒之前**——改完比例身高會變,S 要照改完的身高算才會正規化到同站高。
  const headsBefore = CHIBI_FIT ? conformProportions(sc, by) : null;

  // 縮放角色到 box rig 身高。box brawler 世界高 ≈ hipY + torso 頂 + head ≈ 用包圍盒估。
  // ⚠ 用 sampledBox 不用 setFromObject:蒙皮角色(尤其比例正規化過的)後者量到的是 bind pose,身高會差 18%。
  const bb = sampledBox(sc, new THREE.Box3()), size = new THREE.Vector3(); bb.getSize(size);
  const boxH = boxRigHeight(boxRig);
  let S = (size.y > 1e-6 ? boxH / size.y : 1) * AVATAR_SCALE;   // ×整體放大倍率
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

  // 站高收斂:上面的 S 是拿**校正前**的身高算的,而 T-pose 校正 + rest 正規化會改姿勢(腿打直等)
  // → 實測渲染高度會偏(VRoid 比例正規化後高 8%)。使用者要求「大小跟高度跟原本角色一致」,
  // 所以照校正後的真實高度再收斂一次。uniform 縮放不影響世界四元數 → bQT 不用重抓。
  const targetH = boxH * AVATAR_SCALE;
  const realH = sampledBox(wrap, _sbox).max.y - _sbox.min.y;
  if (realH > 1e-6) { S *= targetH / realH; wrap.scale.setScalar(S); wrap.updateMatrixWorld(true); }
  const fin = sampledBox(wrap, _sbox).clone();
  // headsBefore/headsAfter=頭身比(全身高 ÷ 頭高),chibi 基底是 3.08;報告與測試讀這兩個數
  const headsAfter = (() => { const p = new THREE.Vector3();
    if (!by.head) return null; by.head.bone.getWorldPosition(p);
    const h = fin.max.y - p.y;
    return h > 1e-6 ? +((fin.max.y - fin.min.y) / h).toFixed(2) : null; })();
  // 踩地(蒙皮):bind pose 的包圍盒不隨姿勢動,拿它量腳底就會浮空。改記「腳骨世界 Y − 真實腳底 Y」
  // 這個**姿勢無關**的偏移(腳骨位置是姿勢準確的),每幀用腳骨反推腳底。剛體角色維持原本的網格包圍盒路徑。
  const soleOffset = skinned ? +(footBoneY(by) - fin.min.y).toFixed(3) : null;
  const av = { wrap, S, by, order, skinned, tposeFix: TPOSE_FIX, restDevDeg, restResidDeg,
    chibiFit: CHIBI_FIT, headsBefore, headsAfter, soleOffset, standH: +(fin.max.y - fin.min.y).toFixed(1) };   // standH=渲染後真實站高(px);被扛拎頭吊掛時頭→腳的身長(positionCarried 讀)

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
const _fbox = new THREE.Box3(), _sbox = new THREE.Box3();
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
  const groundY = boxFootWorldY(boxRig);
  if (av.soleOffset != null) {
    // 蒙皮:w.position.y 此刻為 0 → 腳骨世界 Y 減掉 rest 時量好的腳底偏移 = 這個姿勢的真實腳底。
    const b0 = footBoneY(av.by);
    if (isFinite(b0)) w.position.y = groundY + av.soleOffset - b0;
  } else {
    _fbox.setFromObject(w);                       // 剛體:網格包圍盒就是準的
    if (isFinite(_fbox.min.y)) w.position.y = groundY - _fbox.min.y;
  }

  // rigged 手:async 載入,首次就緒時 lazy 掛;顯示中(抓握物品)才由 clip 手指軸(aL_/aR_ f*)驅動指骨。
  // 顯示切換在 actor-brawler updateHands 依 grab 狀態做(一般/戰鬥=原生手,抓握=rigged 手)。
  if (!av.handRig && riggedHandsReady()) mountRiggedHands(av);
  if (av.handRig && av.handShowingRigged) applyFingerPose(av, p);
}

// 兩隻腳骨中較低的世界 Y(姿勢準確,不像包圍盒那樣停在 bind pose)。沒腳骨回 Infinity。
const _fb = new THREE.Vector3();
function footBoneY(by) {
  for (const set of [['foot_l', 'foot_r'], ['shin_l', 'shin_r']]) {   // 有腳骨就用腳骨,沒有才退小腿
    let y = Infinity;
    for (const k of set) { const e = by[k]; if (!e) continue; e.bone.getWorldPosition(_fb); y = Math.min(y, _fb.y); }
    if (isFinite(y)) return y;
  }
  return Infinity;
}

// ugc-2b:**蒙皮版「骨局部包圍盒」**。剛體分件的消費者(火帽尺寸/X光顱球/頭像取景)都靠
// `av.by[k].meshes` 量骨頭底下的網格 bbox——蒙皮角色那個陣列**恆空**(網格掛在 SkinnedMesh 上),
// 火帽因此 `return false` 退回 box rig(隱形 driver)= 帽子掛到脖子上(病 3 的第四次)。
// 這裡從 skin weight 反推:每個頂點歸給「權重最大的骨」,頂點用 `boneInverse × bindMatrix` 轉進
// **bind pose 骨局部**——與剛體路的 `geometry.boundingBox × mesh.matrix` 同一個空間,消費者拿到直接用。
// 骨頭上的 scale(比例正規化把 head 放大 2.69×)由父子關係自動繼承:box 不含它,掛上去的東西跟著
// 骨頭一起被放大,與網格同步。**只在載入時算一次**(抽樣上限每網格 4000 頂點)。
// **回傳兩種盒,因為消費者要的不一樣**(實測:只給含髮版,火帽被長髮撐成比角色還大):
//   `exact` = 只算「主導骨正好是這根」的頂點 → head 得到**顱骨+臉**(頭髮/髮飾骨不算)。
//             火帽尺寸、X 光顱球要這個。
//   `deep`  = 主導骨往上找最近的已對照祖先 → 頭髮/髮飾/手指等未對照子骨歸給它的 head/hand。
//             HUD 頭像取景要這個(半身像本來就該含髮)。
function skinnedLocalBoxes(sc, by) {
  const keyOf = new Map();
  for (const k in by) keyOf.set(by[k].bone, k);
  const nearestKey = (bone) => {
    for (let b = bone; b; b = b.parent) { const k = keyOf.get(b); if (k) return k; }
    return null;
  };
  const exact = {}, deep = {}, v = new THREE.Vector3();
  sc.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const geo = o.geometry, P = geo.attributes.position;
    const SI = geo.attributes.skinIndex, SW = geo.attributes.skinWeight;
    if (!P || !SI || !SW || !o.skeleton) return;
    const skel = o.skeleton, cache = new Map();  // boneIndex → {ek, dk, m4}
    const step = Math.max(1, Math.floor(P.count / 4000));
    for (let i = 0; i < P.count; i += step) {
      let bi = SI.getX(i), bw = SW.getX(i);
      if (SW.getY(i) > bw) { bw = SW.getY(i); bi = SI.getY(i); }
      if (SW.getZ(i) > bw) { bw = SW.getZ(i); bi = SI.getZ(i); }
      if (SW.getW(i) > bw) { bw = SW.getW(i); bi = SI.getW(i); }
      let e = cache.get(bi);
      if (e === undefined) {
        const bone = skel.bones[bi];
        const dk = bone ? nearestKey(bone) : null;
        e = dk ? { ek: keyOf.get(bone) || null, dk,
                   m4: new THREE.Matrix4().multiplyMatrices(skel.boneInverses[bi], o.bindMatrix) } : null;
        cache.set(bi, e);
      }
      if (!e) continue;
      v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(e.m4);
      (deep[e.dk] || (deep[e.dk] = new THREE.Box3())).expandByPoint(v);
      if (e.ek) (exact[e.ek] || (exact[e.ek] = new THREE.Box3())).expandByPoint(v);
    }
  });
  return { exact, deep };
}

// ---- 幾何小工具 ----
// ⚠ `Box3.setFromObject` **不算蒙皮形變**:它拿 geometry 的 bounding box 乘 mesh.matrixWorld,而
// SkinnedMesh 的 matrixWorld 不會因為骨頭動而改變 → 對蒙皮角色永遠回傳 bind pose 的盒子。
// 比例正規化(ugc-1c)把大腿砍半、頭放大 2.66× 之後,這個誤差大到會讓角色**腳浮在空中 14px**
//(實測:naive 高 101.2/腳 y=0,真實高 85.6/腳 y=14.4)。所以身高正規化與踩地都要用真頂點量。
// 逐網格抽樣(每網格上限 ~SAMPLE 點)壓成本;只在載入時跑一次,不進每幀。
const SAMPLE = 240;
const _sv = new THREE.Vector3();
function sampledBox(root, out) {
  out.makeEmpty();
  root.updateWorldMatrix(false, true);
  root.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const P = o.geometry.attributes.position; if (!P) return;
    const step = Math.max(1, Math.floor(P.count / SAMPLE));
    for (let i = 0; i < P.count; i += step) {
      _sv.set(P.getX(i), P.getY(i), P.getZ(i));
      if (o.isSkinnedMesh) o.boneTransform(i, _sv);      // → model space(bindMatrixInverse 已抵銷 matrixWorld)
      out.expandByPoint(_sv.applyMatrix4(o.matrixWorld));
    }
  });
  return out;
}
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
