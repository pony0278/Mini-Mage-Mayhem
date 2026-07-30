// actor-hands-rigged.js — rigged 手(assets/rigs/chibi-hands-rigged.glb)掛到 v2 avatar 手骨。
// 目的:讓 ?avatar=1 的手 = punch-studio 的手(兩邊同一套 base rig + 同一份 rigged 手 GLB + 同一組
// 手指軸驅動),測試一致。移植自 tools/ps/parts.js 的 mountRiggedHands / applyFingerPose。
//   rig 事實:骨鏈 Hand→Fingers→FingerMid→FingerTips(+Thumb),手指沿骨局部 +Y 生長,彎曲軸=骨局部 X
//   (rest 已帶自然微彎),負=往掌心捲。剛性分段(無蒙皮),轉骨即彎。
// 純 render 層(不 import sim)。avatar 專用——方塊人維持舊 chibi 手(actor-hands.js grip/open)。
// 需 vendor/GLTFLoader.js(全域 THREE.GLTFLoader)。
const URL = 'assets/rigs/chibi-hands-rigged.glb';
let TEMPLATE = null;     // 載入一次的 GLB 場景(每個 avatar clone 一份)
let state = 0;           // 0=未載 1=載入中 2=就緒 3=失敗

export function riggedHandsReady() { return state === 2; }

export function preloadRiggedHands() {
  if (state !== 0) return;
  if (typeof THREE === 'undefined' || !THREE.GLTFLoader) { state = 3; console.warn('[rigged-hands] GLTFLoader 未載入'); return; }
  state = 1;
  fetch(URL).then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
    .then(ab => new Promise((res, rej) => new THREE.GLTFLoader().parse(ab, '', res, rej)))
    .then(gltf => { TEMPLATE = gltf.scene; TEMPLATE.updateMatrixWorld(true); state = 2; })
    .catch(e => { state = 3; console.warn('[rigged-hands] 載入失敗:', e); });
}

// 指骨鍵 → GLB 節點名字尾(GLTFLoader 淨化:Fingers.L→FingersL);彎曲軸=骨局部 X、負=往掌心。
const HAND_BONE_KEYS = { fingers: 'Fingers', mid: 'FingerMid', tips: 'FingerTips', thumb: 'Thumb' };
// 指骨鍵 → 姿勢軸名(左右各一組;與 brawler-clips POSE_KEYS 同名,punch-studio 匯出的 clip 直接帶)。
const FINGER_POSE_AXES = {
  L: { fingers: 'aL_fbase', mid: 'aL_fmid', tips: 'aL_ftip', thumb: 'aL_fthumb' },
  R: { fingers: 'aR_fbase', mid: 'aR_fmid', tips: 'aR_ftip', thumb: 'aR_fthumb' },
};
function collectHandRig(handNode, side) {
  const out = {};
  handNode.traverse(o => {
    for (const [k, base] of Object.entries(HAND_BONE_KEYS)) {
      if (o.name === base + side) { o.userData.restQ = o.quaternion.clone(); out[k] = o; }
    }
  });
  return out;
}

// 掛到 avatar 手骨(av.by.hand_l/hand_r.bone)。兩種模式:
// · 剛體 base-avatar(同出 base rig):手骨已帶 rest 旋轉,節點歸零 identity 掛上即貼合;
//   **只在抓握物品時**顯示(一般/戰鬥維持原生手=色塊拳套),setRiggedHandsVisible 依 grab 切換。
// · 蒙皮角色(ugc-3,使用者:「現在不是拳套了,有什麼辦法讓皮套在拳套嗎?」):**常戴拳套模式**——
//   rigged 手當「拳套裝備」永遠顯示,罩住角色自己的手(手在拳套裡;拳套是裝備不是皮膚,顏色
//   不用跟膚色=ugc-2c 的紫色手問題不存在)。兩個蒙皮專屬問題:
//   ① 朝向:蒙皮角色手骨的 rest 軸每個 GLB 都不同,identity 掛上=拳套朝向亂轉。兩個都踩過的
//      錯誤基準:box 腕節點 qT(≠base 拳套朝向,差著 base 手骨自己的 rest;實測拳套沿手臂往上長)、
//      拳套 GLB 節點的原始朝向 gQ(那只是檔案內的**陳列**擺法,不是穿戴朝向;實測手指朝上反 180°)。
//      正確基準=**base 手骨的 rest 朝向**(rig 家族的作者常數,identity 掛法之所以對就是因為它):
//      在作者空間(T-pose、面向 +Z——ugc-1b/2e 已把每個角色都正規化到這裡)實測 GLOVE_REST =
//      L 繞 Z +90° / R 繞 Z −90°(T-pose 手臂平舉、指向 ±X 的必然)。常數補償
//      qComp = bQT⁻¹·wrapQT·GLOVE_REST:掛上後拳套世界朝向 = Δ·bQT·qComp = Δ·wrapQT·GLOVE_REST
//      ——校正姿勢下與 base 角色戴的一模一樣,之後跟著腕的 Δ 剛體轉,任何姿勢都對,不用每幀追。
//   ② 尺寸:照**內建拳套的身高佔比**(GLOVE_RATIO×standH,實測 21.7px/78.3),不跟角色手大小走
//      (VRoid 手細,照手縮就沒有拳套感);世界尺寸受 wrap(S)/骨縮放影響 → 由 proto 局部高 ×
//      骨世界縮放反推 local scale。
// 成功回傳 true 並在 av 掛上 { handRig:{L,R}, handWraps:{L,R}, handNative:[...] }。
const GLOVE_RATIO = 0.28;            // 拳套世界高(指向 +Y)÷ standH,實測自內建 base-avatar
// base 手骨 rest 在作者空間的朝向(scratchpad/glove4.mjs 實測 wrapQT⁻¹·bQT,乾淨的 ±90°)
const GLOVE_REST = { L: new THREE.Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2),
                     R: new THREE.Quaternion(0, 0, -Math.SQRT1_2, Math.SQRT1_2) };
const _gb = new THREE.Box3(), _gs = new THREE.Vector3();
export function mountRiggedHands(av) {
  if (state !== 2 || !TEMPLATE || !av || !av.by || !av.by.hand_l || !av.by.hand_r) return false;
  const sc = TEMPLATE.clone(true); sc.updateMatrixWorld(true);
  let hl = null, hr = null;
  sc.traverse(o => { if (o.name === 'HandL') hl = o; else if (o.name === 'HandR') hr = o; });   // GLTFLoader:Hand.L→HandL
  if (!hl || !hr) { console.warn('[rigged-hands] GLB 內找不到 HandL/HandR 節點'); return false; }
  av.handRig = {};
  av.handWraps = {};
  av.handNative = [];
  const glove = !!av.skinned;         // 蒙皮=常戴拳套模式
  for (const [node, side, slot] of [[hl, 'L', 'hand_l'], [hr, 'R', 'hand_r']]) {
    const wrap = new THREE.Group(); wrap.name = 'RIGGED_HAND_' + side;
    node.position.set(0, 0, 0);       // 去掉 rig 內左右並排的偏移
    node.quaternion.identity();       // base rig 手骨已帶 rest 旋轉,節點再疊會轉兩次 → 歸零
    wrap.add(node);
    const entry = av.by[slot];
    if (glove) {
      // ⚠ 先量再轉:proto 尺寸要在 wrap 還是 identity 時量(setFromObject 量的是軸對齊盒,
      // 套了 qComp 再量=斜盒膨脹,實測大 1.39×)。
      wrap.updateMatrixWorld(true);
      _gb.setFromObject(node); _gb.getSize(_gs);                      // proto 局部尺寸(未掛骨,剛體=準)
      const protoLen = _gs.y || 1;                                    // 手指沿局部 +Y 生長
      wrap.quaternion.copy(entry.bQT).invert();                       // qComp = bQT⁻¹·wrapQT·GLOVE_REST(見表頭 ①)
      if (av.wrapQT) wrap.quaternion.multiply(av.wrapQT);
      wrap.quaternion.multiply(GLOVE_REST[side]);
      entry.bone.updateWorldMatrix(true, false);
      entry.bone.getWorldScale(_gs);
      const bs = Math.abs(_gs.y) || 1;
      wrap.scale.setScalar(GLOVE_RATIO * (av.standH || 78) / (protoLen * bs));   // 見表頭 ②
    }
    wrap.visible = glove;             // 拳套模式=常戴;base-avatar=預設藏、抓握才顯
    av.handRig[side] = collectHandRig(node, side);
    av.handWraps[side] = wrap;
    entry.bone.add(wrap);
    (entry.meshes || []).forEach(m => av.handNative.push(m));   // avatar 原生手(蒙皮=空陣列,拳套直接罩住)
  }
  av.handShowingRigged = glove;
  av.gloveMode = glove;
  return true;
}

// 依 grab 狀態切換:抓握物品時 rigged 手(顯示握持+手指軸)↔ 一般/戰鬥時 avatar 原生手。
export function setRiggedHandsVisible(av, on) {
  if (!av || !av.handRig || av.handShowingRigged === on) return;
  av.handShowingRigged = on;
  if (av.handWraps) { if (av.handWraps.L) av.handWraps.L.visible = on; if (av.handWraps.R) av.handWraps.R.visible = on; }
  (av.handNative || []).forEach(m => { m.visible = !on; });   // 顯 rigged 時藏原生,反之
}

// 每幀:從當前(播放/內插)姿勢的手指軸驅動指骨彎曲。未掛=no-op。彎曲軸=骨局部 X(負=往掌心)。
const _AX = new THREE.Vector3(1, 0, 0), _q = new THREE.Quaternion(), D2R = Math.PI / 180;
export function applyFingerPose(av, pose) {
  if (!av || !av.handRig || !pose) return;
  for (const side of ['L', 'R']) {
    const rig = av.handRig[side]; if (!rig) continue;
    const axes = FINGER_POSE_AXES[side];
    for (const [k, bone] of Object.entries(rig)) {
      if (!bone || !bone.userData.restQ) continue;
      const deg = Number(pose[axes[k]]) || 0;
      bone.quaternion.copy(bone.userData.restQ).multiply(_q.setFromAxisAngle(_AX, deg * D2R));
    }
  }
}
