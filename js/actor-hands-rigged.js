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

// 掛到 avatar 手骨(av.by.hand_l/hand_r.bone)。avatar 與 rigged 手同出 base rig → 手骨已帶 rest
// 旋轉,手節點歸零(位置+旋轉)identity 掛上即貼合。
// 設計:rigged 手**只在抓握物品時**顯示(一般/戰鬥維持 avatar 原生手);故掛載後預設「rigged 藏、原生顯」,
//   由 setRiggedHandsVisible 依 grab 狀態切換(對齊 actor-hands 舊設計:扛/丟才換手模,其餘維持拳套/原生手)。
// 成功回傳 true 並在 av 掛上 { handRig:{L,R}, handWraps:{L,R}, handNative:[...] }。
export function mountRiggedHands(av) {
  if (state !== 2 || !TEMPLATE || !av || !av.by || !av.by.hand_l || !av.by.hand_r) return false;
  const sc = TEMPLATE.clone(true); sc.updateMatrixWorld(true);
  let hl = null, hr = null;
  sc.traverse(o => { if (o.name === 'HandL') hl = o; else if (o.name === 'HandR') hr = o; });   // GLTFLoader:Hand.L→HandL
  if (!hl || !hr) { console.warn('[rigged-hands] GLB 內找不到 HandL/HandR 節點'); return false; }
  av.handRig = {};
  av.handWraps = {};
  av.handNative = [];
  for (const [node, side, slot] of [[hl, 'L', 'hand_l'], [hr, 'R', 'hand_r']]) {
    const wrap = new THREE.Group(); wrap.name = 'RIGGED_HAND_' + side;
    node.position.set(0, 0, 0);       // 去掉 rig 內左右並排的偏移
    node.quaternion.identity();       // avatar 手骨已帶 rest 旋轉,節點再疊會轉兩次 → 歸零
    wrap.add(node);
    wrap.visible = false;             // 預設藏:只在抓握時顯示
    av.handRig[side] = collectHandRig(node, side);
    av.handWraps[side] = wrap;
    const entry = av.by[slot];
    entry.bone.add(wrap);
    (entry.meshes || []).forEach(m => av.handNative.push(m));   // avatar 原生手(預設顯示)
  }
  av.handShowingRigged = false;
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
