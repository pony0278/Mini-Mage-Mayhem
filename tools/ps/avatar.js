// punch-studio — avatar:基底角色(rigged avatar)模式——16 骨角色 GLB 直接被 47 軸驅動
// 古典 script(非 module):所有 ps/*.js 共享同一個全域作用域,載入順序由 punch-studio.html 決定(見 ps/README.md)。
//
// 原理:素體(box rig)照常被 applyPose 驅動(隱藏但仍計算),每幀把每個關節
// 「相對 T-pose 校正的世界旋轉差量」轉寫到角色對應骨頭:
//     Δ = q_now · q_T⁻¹(素體關節)   →   骨頭目標世界四元數 = Δ · bQ_T(角色骨頭)
// 好處:蹲下巨集/自動踩地/腳踝壓平/接觸鎖/idle 權重…全部自動繼承,零逐軸翻譯;
// 階層差異(素體骨盆獨立 vs 角色 Root 直連雙腿)也被世界空間差量自動吸收。
//
// ── 角色基座慣例(未來所有角色都照這個做,丟進來即用)──
//  1. 16 骨,命名含字樣:Root/Torso/Neck/Head/UpperArm/Forearm/Hand/Thigh/Shin(Calf)/Foot + L/R
//  2. rest = T-pose(雙臂水平)、面向 +Z、頭朝 +Y
//  3. 網格 = 骨頭的剛體子節點(不蒙皮、不用權重)
//  4. 比例、身高任意(自動縮放+世界差量重定向吸收);左右以骨頭世界 X 判定,不信名字

let AVATAR = null;   // {wrap, S, label, by:{key:{bone,node,meshes,qT,bQT}}, order:[key…]}

// 型別字樣 → 素體關節 accessor(side:-1=世界−X=素體 armL/legL)
const AVATAR_NODE_OF = {
  root:     () => root,
  torso:    () => spine,
  neck:     () => spine,        // 素體沒有獨立頸關節:頸跟軀幹
  head:     () => headPivot,
  upperarm: s => s < 0 ? (armL && armL.sh) : (armR && armR.sh),
  forearm:  s => s < 0 ? (armL && armL.el) : (armR && armR.el),
  hand:     s => s < 0 ? (armL && armL.wr) : (armR && armR.wr),
  thigh:    s => s < 0 ? (legL && legL.hp) : (legR && legR.hp),
  shin:     s => s < 0 ? (legL && legL.kn) : (legR && legR.kn),
  foot:     s => s < 0 ? (legL && legL.ankle) : (legR && legR.ankle),
};
const AVATAR_PAIRED = ['upperarm','forearm','hand','thigh','shin','foot'];
const AVATAR_REQUIRED = ['root','torso','head',
  'upperarm_l','upperarm_r','forearm_l','forearm_r','hand_l','hand_r',
  'thigh_l','thigh_r','shin_l','shin_r'];   // neck/foot 選配

async function loadAvatarBuffer(ab, label){
  if(!THREE.GLTFLoader){ updatePartsStatus('GLTFLoader 沒載入成功,無法載入角色。'); return false; }
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(ab, '', res, rej));
  const sc = gltf.scene; sc.updateMatrixWorld(true);

  // ① 收骨頭:字樣分型別(calf=shin 同義;字樣測試順序避免 'forearm' 撞 'arm')
  const TOKENS = ['upperarm','forearm','hand','thigh','shin','calf','foot','torso','neck','head','root'];
  const found = [];
  sc.traverse(o => {
    if(!o.isBone) return;
    const n = (o.name || '').toLowerCase().replace(/[^a-z]/g, '');
    const t = TOKENS.find(k => n.includes(k));
    if(t) found.push({ bone: o, type: t === 'calf' ? 'shin' : t });
  });

  // ② key = 型別(+左右,以骨頭「rest 世界 X」判定,不信名字)
  const _v = new THREE.Vector3();
  const by = {};
  for(const f of found){
    f.bone.getWorldPosition(_v);
    const sx = _v.x < 0 ? -1 : 1;
    const key = AVATAR_PAIRED.includes(f.type) ? `${f.type}${sx < 0 ? '_l' : '_r'}` : f.type;
    if(by[key]) continue;                       // 重複命名取第一個
    const nodeFor = AVATAR_NODE_OF[f.type];
    by[key] = { bone: f.bone, node: () => nodeFor(sx),
                meshes: f.bone.children.filter(c => c.isMesh),
                qT: new THREE.Quaternion(), bQT: new THREE.Quaternion() };
  }
  const missing = AVATAR_REQUIRED.filter(k => !by[k]);
  if(missing.length){
    updatePartsStatus(`角色載入失敗:${label} 缺骨頭 ${missing.join('/')}(命名需含 root/torso/upperarm… 字樣,rest=T-pose)。`);
    return false;
  }

  // ③ 縮放到素體身高,掛進場景
  const bb = new THREE.Box3().setFromObject(sc), size = new THREE.Vector3(); bb.getSize(size);
  const standH = headCY + DIM.headSize * 0.5;
  const S = size.y > 1e-6 ? standH / size.y : 1;
  const wrap = new THREE.Group(); wrap.name = 'PS_AVATAR'; wrap.scale.setScalar(S); wrap.add(sc);

  // ④ 校正:素體與角色都在 T-pose 下,記兩邊每個關節/骨頭的世界四元數
  if(AVATAR) clearAvatar();
  AVATAR = null;                                // 校正期間 hook 不得驅動
  applyPose(inspectTposePose());                // 素體 → T-pose(角色 rest 本來就是 T-pose)
  root.updateMatrixWorld(true);
  scene.add(wrap); wrap.updateMatrixWorld(true);
  Object.values(by).forEach(e => { e.node().getWorldQuaternion(e.qT); e.bone.getWorldQuaternion(e.bQT); });

  // ⑤ 父先子後的處理順序(依骨頭深度)
  const depth = e => { let d = 0, p = e.bone; while(p.parent){ d++; p = p.parent; } return d; };
  const order = Object.keys(by).sort((a, b) => depth(by[a]) - depth(by[b]));

  AVATAR = { wrap, S, label, by, order };
  setSyntheticDummyVisible(false);
  applyInspectOrPhase();                        // 回到目前 phase,hook 立即驅動角色
  updatePartsStatus(`基底角色已掛載:${label}(${order.length} 骨,×${S.toFixed(2)})。素體隱藏中;「清除角色」回素體/部位模式。`);
  return true;
}

// 每幀由 rig.js applyPose 尾端呼叫(typeof 守衛)。素體剛 pose 完+updateMatrixWorld 完。
const _aq1 = new THREE.Quaternion(), _aqd = new THREE.Quaternion(),
      _aq2 = new THREE.Quaternion(), _aqp = new THREE.Quaternion();
const _abox = new THREE.Box3();
function updateAvatarPose(p){
  if(!AVATAR) return;
  const A = AVATAR, w = A.wrap;
  // 鏡射素體 root 的擠壓縮放(sq)與前後位移(root_pz);y 最後用角色自己的腳踩地
  w.position.set(0, 0, root.position.z);
  w.scale.copy(root.scale).multiplyScalar(A.S);
  w.quaternion.identity();                      // root_x/y 由 Root 骨的世界差量處理,不在 wrap 上疊
  w.updateMatrixWorld(true);
  // 世界差量重定向(父先子後;getWorldQuaternion 會自動更新祖先矩陣)
  for(const k of A.order){
    const e = A.by[k], node = e.node(); if(!node) continue;
    node.getWorldQuaternion(_aq1);
    _aqd.copy(e.qT).invert().premultiply(_aq1);         // Δ = q_now · qT⁻¹
    _aq2.copy(e.bQT).premultiply(_aqd);                 // 目標世界 = Δ · bQT
    e.bone.parent.getWorldQuaternion(_aqp).invert();
    e.bone.quaternion.copy(_aq2).premultiply(_aqp);     // local = qParent⁻¹ · 目標世界
    e.bone.updateMatrixWorld(true);
  }
  // 命中放大/身體縮放:縮「骨頭上的網格」不縮骨頭(避免縮放傳染子骨)
  const setS = (k, v) => { const e = A.by[k]; if(e) e.meshes.forEach(m => m.scale.setScalar(v || 1)); };
  setS('forearm_l', p.aL_scale); setS('hand_l', p.aL_scale);
  setS('forearm_r', p.aR_scale); setS('hand_r', p.aR_scale);
  setS('shin_l', p.lL_scale);    setS('foot_l', p.lL_scale);
  setS('shin_r', p.lR_scale);    setS('foot_r', p.lR_scale);
  setS('torso', p.body_scale);
  // 自動踩地:用角色自己的腳(沿用素體的接觸鎖規則:2=抬起不當錨點)
  w.updateMatrixWorld(true);
  _abox.makeEmpty();
  const cL = Math.round(p.lL_contact || 0), cR = Math.round(p.lR_contact || 0);
  const exp = k => { const e = A.by[k]; if(e) e.meshes.forEach(m => _abox.expandByObject(m)); };
  let g = false;
  if(cL !== 2){ exp('foot_l'); g = true; }
  if(cR !== 2){ exp('foot_r'); g = true; }
  if(!g){ exp('foot_l'); exp('foot_r'); }
  if(!isFinite(_abox.min.y)){ exp('shin_l'); exp('shin_r'); }   // 沒腳骨的角色:用小腿墊底
  w.position.y = (isFinite(_abox.min.y) ? (baseY - _abox.min.y) : baseY) + (p.root_py || 0);
}

function clearAvatar(){
  if(!AVATAR) return;
  scene.remove(AVATAR.wrap);
  AVATAR.wrap.traverse(o => {
    if(o.geometry) o.geometry.dispose();
    if(o.material){ (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }
  });
  AVATAR = null;
  setSyntheticDummyVisible(!PARTS_HIDE_DUMMY);
  updatePartsStatus('角色已清除,回到素體/部位模式。');
}

// ===== UI:載入角色 GLB / 清除(插在部位面板狀態列上方)=====
(function(){
  const st = document.getElementById('partsStatus'); if(!st) return;
  const row = document.createElement('div'); row.className = 'util'; row.style.marginTop = '6px';
  row.innerHTML =
    `<label class="filebtn" title="載入 16 骨基座角色 GLB(rest=T-pose、剛體部位掛骨頭、面向 +Z;比例任意,左右自動以世界 X 判定)">👤 載入角色 GLB(基座骨架)<input type="file" id="avatarFile" accept=".glb,.gltf,model/gltf-binary,model/gltf+json"></label>` +
    `<button id="avatarClear" title="移除角色,回到素體/部位模式">清除角色</button>`;
  st.parentElement.insertBefore(row, st);
  document.getElementById('avatarFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if(!f) return;
    try{ await loadAvatarBuffer(await f.arrayBuffer(), f.name); }
    catch(err){ console.error(err); updatePartsStatus(`角色載入失敗:${f.name} — ${err.message || err}`); }
    e.target.value = '';
  });
  document.getElementById('avatarClear').addEventListener('click', clearAvatar);
})();

// ===== 開機自動載入:基底角色優先(assets/rigs/base-avatar.glb),退回 Meshy 部位人偶 =====
(async () => {
  try {
    const r = await fetch('../assets/rigs/base-avatar.glb');
    if (r.ok && await loadAvatarBuffer(await r.arrayBuffer(), 'base-avatar.glb')) return;
  } catch (e) { /* 走退路 */ }
  try {
    const resp = await fetch('meshy-mannequin.glb');
    if (!resp.ok) return;
    const ok = await loadPartFile(new File([await resp.arrayBuffer()], 'meshy-mannequin.glb'));
    if (ok) updatePartsStatus(`預設人偶已自動掛載:meshy-mannequin.glb(${Object.keys(PART_MODELS).length} 部位)。要回素體按「清空部位」。`);
  } catch (e) { /* 保持素體 */ }
})();
