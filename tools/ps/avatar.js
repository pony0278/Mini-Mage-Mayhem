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

// ===== rest 姿勢正規化(ugc-1b;與遊戲 js/actor-avatar.js normalizeRest 同一套演算法)=====
// 重定向的基準線是角色自己的 rest(目標世界 = Δ · bQT)——rest 偏了,每個姿勢都帶著這個偏差。
// 這裡把各肢段的 rest 方向轉到素體 T-pose 的方向,讓玩家「丟 VRoid 原檔進來就能動」,
// 不必先去 Blender 擺 T-pose。實驗室預設**開**(這裡就是驗匯入的地方);關掉可看修正前長相。
let AV_TPOSE_FIX = true;
try{ if(localStorage.getItem('PS_TPOSE_FIX')==='0') AV_TPOSE_FIX = false; }catch(e){}
// 肢段 = 骨頭 → 遠端子骨(方向由這兩點定義);torso 取到 head(neck 的素體 driver 就是 spine 本人=零向量)
const AV_LIMB_CHILD = { torso:'head',
  upperarm_l:'forearm_l', forearm_l:'hand_l', upperarm_r:'forearm_r', forearm_r:'hand_r',
  thigh_l:'shin_l', shin_l:'foot_l', thigh_r:'shin_r', shin_r:'foot_r' };
const _rva = new THREE.Vector3(), _rvb = new THREE.Vector3(), _rvc = new THREE.Vector3(), _rvd = new THREE.Vector3();
const _rqf = new THREE.Quaternion(), _rqw = new THREE.Quaternion(), _rqp = new THREE.Quaternion();
// apply=false → 只量不改(取修正後殘差當驗收數字)。回傳最大偏離角度(度)。
function normalizeAvatarRest(by, order, apply){
  let maxDeg = 0;
  for(const k of order){                       // **父先子後**:改父會帶動子,子要用改過後的位置重量
    const ck = AV_LIMB_CHILD[k]; if(!ck) continue;
    const e = by[k], c = by[ck]; if(!e || !c) continue;
    const n0 = e.node(), n1 = c.node(); if(!n0 || !n1) continue;
    e.bone.getWorldPosition(_rva); c.bone.getWorldPosition(_rvb);
    n0.getWorldPosition(_rvc); n1.getWorldPosition(_rvd);
    const have = _rvb.sub(_rva), want = _rvd.sub(_rvc);
    if(have.lengthSq() < 1e-12 || want.lengthSq() < 1e-12) continue;
    have.normalize(); want.normalize();
    const ang = Math.acos(Math.max(-1, Math.min(1, have.dot(want))));
    maxDeg = Math.max(maxDeg, ang * 180 / Math.PI);
    if(!apply || !(ang > 1e-4)) continue;
    _rqf.setFromUnitVectors(have, want);       // 世界空間:現有方向 → 目標方向
    e.bone.getWorldQuaternion(_rqw);
    e.bone.parent.getWorldQuaternion(_rqp).invert();
    e.bone.quaternion.copy(_rqw).premultiply(_rqf).premultiply(_rqp);
    e.bone.updateMatrixWorld(true);
  }
  return +maxDeg.toFixed(1);
}

// ===== ugc-1c 比例正規化:把匯入角色的骨架比例壓成 chibi 比例 =====
// 與遊戲 js/actor-avatar.js 的 CHIBI / conformProportions **同一份規格**(兩邊模組系統不同無法共用常數,
// 改一邊要同步另一邊)。使用者拍板 2026-07-29:「維持 chibi 風格,其他 GLB 只是外觀套進來,骨子還是 chibi
// ——原本的大頭就是大頭,VRoid 的頭套進來只是外觀改變,頭還是一樣大」。
// **studio 一定要跟遊戲做同一件事**:不然這裡看到 8.18 頭身、遊戲裡是 3.18 頭身,編出來的姿勢進遊戲就偏。
// 可行性關鍵:updateAvatarPose 每幀只寫 bone.quaternion(與 setS/setStretch 的 scale),**從不寫
// bone.position** → 改 rest 位移不會被每幀蓋掉;蒙皮頂點跟著骨頭走。
// `torso`=root→neck 世界距離、`jawDrop`=下巴低於頭骨關節的量(ugc-2d 新增,見 ①a/③)。
const CHIBI = { upperarm: 0.0834, forearm: 0.1171, thigh: 0.1266, shin: 0.1769,
                headTop: 0.325, jawDrop: 0.015, torso: 0.304, shoulderW: 0.195, hipW: 0.12 };
let AV_CHIBI_FIT = true;
try{ if(localStorage.getItem('PS_CHIBI_FIT')==='0') AV_CHIBI_FIT = false; }catch(e){}

// ⚠ `Box3.setFromObject` **不算蒙皮形變**:它拿 geometry 的 bounding box 乘 mesh.matrixWorld,而
// SkinnedMesh 的 matrixWorld 不隨骨頭動 → 對蒙皮角色永遠回傳 bind pose 的盒子。比例改完後這個誤差
// 大到讓角色腳浮空(遊戲端實測 14px = 身高 18%)。要量真的就得逐頂點 boneTransform。只在載入時跑。
const AV_SAMPLE = 240;
const _svv = new THREE.Vector3();
function sampledBox(root, out){
  out.makeEmpty();
  root.updateWorldMatrix(false, true);
  root.traverse(o => {
    if(!o.isMesh || !o.visible) return;
    const P = o.geometry.attributes.position; if(!P) return;
    const step = Math.max(1, Math.floor(P.count / AV_SAMPLE));
    for(let i = 0; i < P.count; i += step){
      _svv.set(P.getX(i), P.getY(i), P.getZ(i));
      if(o.isSkinnedMesh) o.boneTransform(i, _svv);      // → model space
      out.expandByPoint(_svv.applyMatrix4(o.matrixWorld));
    }
  });
  return out;
}

// 只量「某根骨頭子樹」的網格盒(頭部要量到**下巴**,整體包圍盒給不出來)。蒙皮走「主導骨在子樹內」,
// 剛體走「Mesh 是它的後代」。抽樣密度比 sampledBox 高:頭+髮只佔全身網格一小塊,240 點分下來下巴會不準。
const AV_HSAMPLE = 4000;
const _tvv = new THREE.Vector3();
function subtreeSampledBox(root, bone, out){
  out.makeEmpty();
  root.updateWorldMatrix(false, true);
  const inSub = (b) => { for(let o = b; o; o = o.parent) if(o === bone) return true; return false; };
  root.traverse(o => {
    if(!o.isMesh || !o.visible) return;
    const P = o.geometry.attributes.position; if(!P) return;
    const step = Math.max(1, Math.floor(P.count / AV_HSAMPLE));
    if(o.isSkinnedMesh){
      const SI = o.geometry.attributes.skinIndex, SW = o.geometry.attributes.skinWeight;
      if(!SI || !SW || !o.skeleton) return;
      const ok = new Map();                       // **每網格一份**:不同網格的 skeleton 可能不同
      for(let i = 0; i < P.count; i += step){
        let bi = SI.getX(i), bw = SW.getX(i);
        if(SW.getY(i) > bw){ bw = SW.getY(i); bi = SI.getY(i); }
        if(SW.getZ(i) > bw){ bw = SW.getZ(i); bi = SI.getZ(i); }
        if(SW.getW(i) > bw){ bw = SW.getW(i); bi = SI.getW(i); }
        let f = ok.get(bi);
        if(f === undefined){ const b = o.skeleton.bones[bi]; f = !!b && inSub(b); ok.set(bi, f); }
        if(!f) continue;
        _tvv.set(P.getX(i), P.getY(i), P.getZ(i));
        o.boneTransform(i, _tvv);
        out.expandByPoint(_tvv.applyMatrix4(o.matrixWorld));
      }
    } else {
      if(!inSub(o)) return;
      for(let i = 0; i < P.count; i += step)
        out.expandByPoint(_tvv.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(o.matrixWorld));
    }
  });
  return out;
}
// 把骨頭沿**世界 Y** 抬 dy(改 rest 位移;updateAvatarPose 只寫 quaternion/scale,不會被每幀蓋掉)。
// 父骨可能被旋轉/縮放過 → 用「兩點差分」把世界位移換成父空間的 local 位移,免得把平移項算進來。
const _lmm = new THREE.Matrix4(), _lvv = new THREE.Vector3(), _loo = new THREE.Vector3();
function liftBoneWorldY(bone, dy){
  if(!isFinite(dy) || Math.abs(dy) < 1e-9 || !bone.parent) return;
  bone.parent.updateWorldMatrix(true, false);
  _lmm.copy(bone.parent.matrixWorld).invert();
  _lvv.set(0, dy, 0).applyMatrix4(_lmm).sub(_loo.set(0, 0, 0).applyMatrix4(_lmm));
  bone.position.add(_lvv);
  bone.updateMatrixWorld(true);
}
const _pv = new THREE.Vector3(), _pw = new THREE.Vector3(), _pbox = new THREE.Box3(), _phbox = new THREE.Box3();
// ugc-2e:量 rest 腳尖朝向,回傳偏離 +Z 幾度(貼齊 90 檔位;0=不用修)。門檻:形心位移 <2%身高(對稱腳=
// 測不出)或離檔位 >30°(曖昧)都不動。與遊戲 js/actor-avatar.js 的 restYawSnap 同規格,改一邊要同步另一邊。
function avRestYawSnap(sc, by){
  if(!by.foot_l || !by.foot_r) return 0;
  sc.updateMatrixWorld(true);
  const dir = new THREE.Vector3();
  let n = 0;
  for(const k of ['foot_l', 'foot_r']){
    const bb = subtreeSampledBox(sc, by[k].bone, _phbox);
    if(bb.isEmpty()) continue;
    bb.getCenter(_pv); by[k].bone.getWorldPosition(_pw);
    _pv.sub(_pw); _pv.y = 0;
    dir.add(_pv); n++;
  }
  if(!n) return 0;
  const H = sampledBox(sc, _pbox).max.y - _pbox.min.y;
  if(!(H > 1e-6) || dir.length() / n < H * 0.02) return 0;
  const ang = Math.atan2(dir.x, dir.z) * 180 / Math.PI;
  const snap = Math.round(ang / 90) * 90;
  if(snap % 360 === 0 || Math.abs(ang - snap) > 30) return 0;
  return ((snap % 360) + 360) % 360;
}
// 頭身比 = 全身高 ÷ **頭高(下巴→頭頂)**。ugc-2d 前拿「頭頂 − 頭骨關節」當替代量,而 ③ 會把頭骨往上抬
// → 替代量從此低估頭高、把數字吹高。參考值:內建素體基底角色實測 **2.95**(舊定義的 3.08/3.15 已作廢)。
function avHeadsRatio(root, by, bb){
  if(!by.head) return null;
  const h = subtreeSampledBox(root, by.head.bone, _phbox);
  const hh = h.max.y - h.min.y;
  return hh > 1e-6 ? +((bb.max.y - bb.min.y) / hh).toFixed(2) : null;
}
// 兩隻腳骨中較低的世界 Y(姿勢準確,不像包圍盒那樣停在 bind pose)。沒腳骨退小腿,都沒有回 Infinity。
const _fbv = new THREE.Vector3();
// skip:{l,r} = 接觸鎖(contact===2 抬起的腳不當地面錨點,沿用素體同一條規則)。
function avFootBoneY(by, skip){
  for(const set of [['foot_l','foot_r'], ['shin_l','shin_r']]){
    let y = Infinity;
    for(const k of set){
      if(skip && ((k.endsWith('_l') && skip.l) || (k.endsWith('_r') && skip.r))) continue;
      const e = by[k]; if(!e) continue; e.bone.getWorldPosition(_fbv); y = Math.min(y, _fbv.y);
    }
    if(isFinite(y)) return y;
  }
  return avFootBoneY(by);                      // 兩腳都抬起(跳躍)→ 不套鎖,取較低的那隻
}
// 回傳修改前的頭身比(給報告看),沒東西可改回 null。
function conformAvatarProportions(sc, by){
  sc.updateMatrixWorld(true);
  const bb0 = sampledBox(sc, _pbox);
  let H = bb0.max.y - bb0.min.y;
  if(!(H > 1e-6) || !by.head) return null;
  const wp = (k, out) => { by[k].bone.getWorldPosition(out); return out; };
  const before = avHeadsRatio(sc, by, bb0);

  // ①a 軀幹長度(root→neck):匯入角色是寫實 7~8 頭身,軀幹佔比比 chibi 短一截(實測 VRoid 23.3%
  // vs 素體基底 30.4%);不修就是「大頭幾乎直接接在髖上、脖子被吃掉」。做法=把 root→neck 這條脊椎鏈
  // 上**每根骨的 local 位移**等比縮放(中間的 chest/upperChest 沒被別名表對照到,但 rest 位移同樣不會
  // 被每幀蓋掉)。肩/臂/頸/頭都是鏈上骨頭的子骨 → 自動跟著上移。
  const setTorsoLen = () => {
    if(!by.root || !by.neck || by.root.bone === by.neck.bone) return;
    const chain = [];
    for(let o = by.neck.bone; o && o !== by.root.bone; o = o.parent) chain.push(o);
    if(!chain.length || chain[chain.length - 1].parent !== by.root.bone) return;   // neck 不在 root 之下就別亂改
    sc.updateMatrixWorld(true);
    const now = wp('root', _pv).distanceTo(wp('neck', _pw));
    if(now < 1e-6) return;
    const f = CHIBI.torso * H / now;
    if(!(f > 0.25 && f < 4)) return;
    chain.forEach(b => b.position.multiplyScalar(f));
    by.root.bone.updateMatrixWorld(true);
  };
  setTorsoLen();
  // 軀幹改長度會改身高 → 後面各段的目標都得對**新的身高**算,不然四肢會集體偏 ~7%。
  sc.updateMatrixWorld(true);
  H = sampledBox(sc, _pbox).max.y - _pbox.min.y;
  if(!(H > 1e-6)) return before;

  // ① 肢段長度:縮子骨的 local 位移到目標長度(**父先子後**——改父會帶動子,子要用改過後的位置重量)
  const setLen = (a, b, t) => {
    for(const side of ['_l', '_r']){
      const A = by[a + side], Bn = by[b + side]; if(!A || !Bn) continue;
      sc.updateMatrixWorld(true);
      const now = wp(a + side, _pv).distanceTo(wp(b + side, _pw));
      if(now < 1e-6) continue;
      Bn.bone.position.multiplyScalar(t * H / now);
      Bn.bone.updateMatrixWorld(true);
    }
  };
  setLen('upperarm', 'forearm', CHIBI.upperarm); setLen('forearm', 'hand', CHIBI.forearm);
  setLen('thigh', 'shin', CHIBI.thigh);          setLen('shin', 'foot', CHIBI.shin);

  // ② 肩寬/臀寬外推(chibi 比寫實角色寬 ~1.4×)
  const widen = (k, t) => {
    const L = by[k + '_l'], R = by[k + '_r']; if(!L || !R) return;
    sc.updateMatrixWorld(true);
    const now = wp(k + '_l', _pv).distanceTo(wp(k + '_r', _pw)); if(now < 1e-6) return;
    const f = t * H / now;
    [L, R].forEach(e => { e.bone.position.x *= f; e.bone.updateMatrixWorld(true); });
  };
  widen('upperarm', CHIBI.shoulderW); widen('thigh', CHIBI.hipW);

  // ③ 大頭:頭骨等比放大(頭髮/髮飾骨是子骨,自動跟著大)+ **把頭抬回脖子上**。
  // ⚠ 只能動 head 的 scale——torso/forearm/shin/upperarm/thigh 的 bone.scale 是 setS/setStretch 每幀在寫的。
  // ⚠⚠ ugc-2d:舊寫法只拿「頭骨關節以上」的高度算倍率、繞著關節原點縮放。素體基底角色的頭幾乎整顆在關節
  // 之上(下巴只低 1.5%身高)所以看不出問題;但**真人骨架的 head 骨在顱底,下巴在它下面**,放大 2.7× 連
  // 下巴一起往下拉 2.7 倍 → 實測 VRoid 下巴沉到關節下 8%身高,整顆頭陷進胸口。改成同時解兩條件:
  //   頭頂 = 關節 + headTop·H   、   下巴 = 關節 − jawDrop·H
  // → 倍率照**整顆頭高**(上+下)算,再把頭骨往上抬 dy 讓下巴回到 chibi 的位置。
  sc.updateMatrixWorld(true);
  const hb = subtreeSampledBox(sc, by.head.bone, _phbox);
  const y0 = wp('head', _pv).y;
  const up = hb.max.y - y0, dn = y0 - hb.min.y;
  if(up + dn > 1e-6){
    const k = (CHIBI.headTop + CHIBI.jawDrop) * H / (up + dn);
    by.head.bone.scale.setScalar(k);
    liftBoneWorldY(by.head.bone, CHIBI.headTop * H - k * up);
  }
  sc.updateMatrixWorld(true);
  return before;
}

// ===== ugc-4 肢段粗細(與遊戲 js/actor-avatar.js 的 THICK/bakeLimbThickness **同一份規格**,改一邊要
// 同步另一邊)=====:ugc-1c 只 conform 長度,粗細沒動(VRoid 小腿 9.2%身高 vs 基準 19.9%=白針腿)。
// 不走骨縮放(非等比縮放沿骨鏈繼承,子骨一彎=剪切變形),**載入時烤進蒙皮頂點**:bind 骨局部把
// 垂直於骨軸的兩座標乘係數(骨軸過原點=繞骨軸外推),位移按 skin weight 加權=關節平滑;只加粗
// 不削瘦,上限 2.5×;腳掌不做。⚠ 防重烤旗標掛 **position attribute**(多 primitive 共用 attribute,
// 掛 geometry 每個 primitive 各烤一次=係數連乘,頂點飛出去)。
const AV_THICK = { upperarm: 0.070, forearm: 0.088, thigh: 0.118, shin: 0.199 };
const AV_THICK_CHILD = { upperarm: 'forearm', forearm: 'hand', thigh: 'shin', shin: 'foot' };
function bakeAvatarLimbThickness(sc, by){
  sc.updateMatrixWorld(true);
  const H = sampledBox(sc, _pbox).max.y - _pbox.min.y;
  if(!(H > 1e-6)) return null;
  const cand = new Map();
  for(const seg in AV_THICK) for(const sd of ['_l', '_r']){
    const e = by[seg + sd], c = by[AV_THICK_CHILD[seg] + sd];
    if(e && c) cand.set(e.bone, { key: seg + sd, seg, child: c.bone });
  }
  if(!cand.size) return null;
  const boxes = new Map();
  const v = new THREE.Vector3();
  const domi = (SI, SW, i) => { let bi = SI.getX(i), bw = SW.getX(i);
    if(SW.getY(i) > bw){ bw = SW.getY(i); bi = SI.getY(i); }
    if(SW.getZ(i) > bw){ bw = SW.getZ(i); bi = SI.getZ(i); }
    if(SW.getW(i) > bw){ bw = SW.getW(i); bi = SI.getW(i); }
    return bi; };
  const bindM = (o, bi) => new THREE.Matrix4().multiplyMatrices(o.skeleton.boneInverses[bi], o.bindMatrix);
  sc.traverse(o => {
    if(!o.isSkinnedMesh || !o.skeleton) return;
    const P = o.geometry.attributes.position, SI = o.geometry.attributes.skinIndex, SW = o.geometry.attributes.skinWeight;
    if(!P || !SI || !SW) return;
    const mc = new Map();
    const step = Math.max(1, Math.floor(P.count / 8000));
    for(let i = 0; i < P.count; i += step){
      const bi = domi(SI, SW, i);
      const bone = o.skeleton.bones[bi]; if(!bone || !cand.has(bone)) continue;
      let m = mc.get(bi); if(!m){ m = bindM(o, bi); mc.set(bi, m); }
      v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(m);
      (boxes.get(bone) || boxes.set(bone, new THREE.Box3()).get(bone)).expandByPoint(v);
    }
  });
  const plan = new Map();
  const rep = {};
  for(const [bone, info] of cand){
    const bb = boxes.get(bone); if(!bb || bb.isEmpty()) continue;
    const cp = info.child.position;
    const a = [Math.abs(cp.x), Math.abs(cp.y), Math.abs(cp.z)];
    const ax = a.indexOf(Math.max(...a));
    bb.getSize(v); const dims = [v.x, v.y, v.z];
    const cur = (dims[(ax + 1) % 3] + dims[(ax + 2) % 3]) / 2;
    if(!(cur > 1e-6)) continue;
    const f = Math.min(2.5, Math.max(1, AV_THICK[info.seg] * H / cur));
    rep[info.key] = +f.toFixed(2);
    if(f > 1.02) plan.set(bone, { ax, f });
  }
  if(!plan.size) return rep;
  const dv = new THREE.Vector3();
  sc.traverse(o => {
    if(!o.isSkinnedMesh || !o.skeleton) return;
    const g = o.geometry;
    const P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    if(!P || !SI || !SW) return;
    if(P.__thickBaked) return;
    P.__thickBaked = true;
    const cache = new Map();
    const entryFor = (bi) => {
      let e = cache.get(bi);
      if(e === undefined){
        const b = o.skeleton.bones[bi], pl = b && plan.get(b);
        e = pl ? { m: bindM(o, bi), ax: pl.ax, f: pl.f } : null;
        if(e) e.mi = e.m.clone().invert();
        cache.set(bi, e);
      }
      return e;
    };
    for(let i = 0; i < P.count; i++){
      let dx = 0, dy = 0, dz = 0;
      for(const [bi, w] of [[SI.getX(i), SW.getX(i)], [SI.getY(i), SW.getY(i)], [SI.getZ(i), SW.getZ(i)], [SI.getW(i), SW.getW(i)]]){
        if(!(w > 0.01)) continue;
        const e = entryFor(bi); if(!e) continue;
        v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(e.m);
        if(e.ax !== 0) v.x *= e.f;
        if(e.ax !== 1) v.y *= e.f;
        if(e.ax !== 2) v.z *= e.f;
        v.applyMatrix4(e.mi).sub(dv.set(P.getX(i), P.getY(i), P.getZ(i)));
        dx += w * v.x; dy += w * v.y; dz += w * v.z;
      }
      if(dx || dy || dz) P.setXYZ(i, P.getX(i) + dx, P.getY(i) + dy, P.getZ(i) + dz);
    }
    P.needsUpdate = true;
    g.computeBoundingSphere();
  });
  return rep;
}

// ===== 匯入檢查報告(實驗室的主產出:告訴玩家這顆模型能不能用、哪裡要修)=====
const AV_SLOTS = ['root','torso','neck','head','upperarm_l','upperarm_r','forearm_l','forearm_r',
                  'hand_l','hand_r','thigh_l','thigh_r','shin_l','shin_r','foot_l','foot_r'];
let AVATAR_REPORT = null;
function avatarReport(sc, by, label, missing, extra){
  const r = Object.assign({ label, missing: missing.slice(), slots: {}, warn: [] }, extra || {});
  AV_SLOTS.forEach(k => { r.slots[k] = by[k] ? (by[k].raw || '?') : null; });
  let tris = 0, meshes = 0, skins = 0, morphs = 0, textured = 0;
  sc.traverse(o => {
    if(o.isSkinnedMesh) skins++;
    if(!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    if(g.morphAttributes && Object.keys(g.morphAttributes).length) morphs++;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if(mats.some(m => m && m.map)) textured++;
  });
  r.tris = Math.round(tris); r.meshes = meshes; r.skins = skins; r.morphs = morphs; r.textured = textured;
  if(missing.length) r.warn.push(`缺 ${missing.length} 根必要骨頭:${missing.join('/')} — 骨頭命名要含 root/torso/upperarm/forearm/hand/thigh/shin/foot 或 VRM 的 J_Bip_*、Mixamo 的 UpLeg/LowerArm 等字樣`);
  if(r.tris > 70000) r.warn.push(`${r.tris} 面偏高(建議 ≤ 7 萬;場上兩個角色 = 兩份)——Blender Decimate 或匯出時降面`);
  if(!r.textured && r.meshes) r.warn.push('沒有任何貼圖(材質只有顏色)——VRM 轉 GLB 時記得把貼圖一起嵌入');
  if(r.morphs) r.warn.push(`${r.morphs} 個網格帶 morph target(表情)——遊戲目前不驅動表情,不影響載入`);
  if(r.skins > 1) r.warn.push(`${r.skins} 個蒙皮網格(身體/頭髮/衣服分開)——支援,但頭髮/裙子不會飄(無彈簧骨物理)`);
  if(extra && extra.restDev >= 8) r.warn.push(`rest 偏離 T-pose ${extra.restDev}°(A-pose 出廠)——`
    + (extra.fixOn ? `已自動校正,殘差 ${extra.restResid}°`
       : extra.builtin ? '內建角色不校正(與遊戲一致:遊戲也不校正內建角色,校正了這裡編的姿勢進遊戲會偏)'
       : '**未**校正(校正開關關著)'));
  if(extra && extra.yawFix) r.warn.push(`rest 面向偏 ${extra.yawFix}°(VRM0/VRoid 出廠面向 −Z)——已自動轉回 +Z(遊戲同規則;左右手也重判過)`);
  return r;
}
function renderAvatarReport(){
  const box = document.getElementById('avatarReport'); if(!box) return;
  const r = AVATAR_REPORT;
  if(!r){ box.innerHTML = '<summary style="cursor:pointer;color:var(--dim)">匯入檢查(尚未載入角色)</summary>'; return; }
  const okN = AV_SLOTS.filter(k => r.slots[k]).length;
  const head = `<summary style="cursor:pointer;color:${r.missing.length ? '#f66' : (r.warn.length ? '#fc6' : '#6d6')}">`
    + `匯入檢查:${r.label} — 骨頭 ${okN}/16${r.missing.length ? ' ✗' : ' ✓'}`
    + ` · ${r.skinned ? '蒙皮' : '剛體分件'} · ${r.tris} 面${r.headsAfter != null ? ` · ${r.headsAfter} 頭身` : ''}${r.warn.length ? ` · ${r.warn.length} 則提醒` : ''}</summary>`;
  const rows = AV_SLOTS.map(k => `<div style="display:flex;gap:4px"><span style="width:74px;color:var(--dim)">${k}</span>`
    + `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;color:${r.slots[k] ? '#9c9' : '#f66'}">${r.slots[k] || '缺'}</span></div>`).join('');
  const warn = r.warn.length ? `<div style="margin-top:5px;color:#fc6">` + r.warn.map(w => `• ${w}`).join('<br>') + '</div>' : '';
  const rest = (r.restDev != null) ? `<div style="margin-top:5px;color:var(--dim)">rest 偏離 T-pose:${r.restDev}° → 殘差 ${r.restResid}°(校正 ${r.fixOn ? '開' : (r.builtin ? '關·內建角色不校正' : '關')})· 縮放 ×${(r.S||0).toFixed(2)}</div>` : '';
  const prop = (r.headsAfter != null) ? `<div style="margin-top:3px;color:var(--dim)">頭身比:${r.chibiFit ? `${r.headsBefore} → <b style="color:#9c9">${r.headsAfter}</b>(已壓成 chibi 比例)` : `${r.headsAfter}(比例正規化 ${r.builtin ? '關·內建角色本身就是基準' : '關'})`}　chibi 基準 2.95</div>` : '';
  box.innerHTML = head + '<div style="margin-top:5px;display:grid;grid-template-columns:1fr 1fr;gap:0 10px">' + rows + '</div>' + rest + prop + warn;
}

let AVATAR_LAST_BUF = null, AVATAR_LAST_LABEL = '', AVATAR_LAST_BUILTIN = false;   // 切 T-pose 校正要重載(rest 是載入時烤死的)
// builtin=true → 內建 base-avatar,**不套 rest 校正**(與遊戲 `AVATAR_URL !== DEFAULT_AVATAR_URL` 同一條規則)。
// 這條 WYSIWYG 很重要:遊戲不校正內建角色(腿刻意外八 13°),實驗室要是校正了,這裡編的姿勢進遊戲就會偏。
async function loadAvatarBuffer(ab, label, builtin){
  if(!THREE.GLTFLoader){ updatePartsStatus('GLTFLoader 沒載入成功,無法載入角色。'); return false; }
  AVATAR_LAST_BUF = ab.slice(0); AVATAR_LAST_LABEL = label; AVATAR_LAST_BUILTIN = !!builtin;
  const gltf = await new Promise((res, rej) => psMakeGltfLoader().parse(ab, '', res, rej));
  const sc = gltf.scene; sc.updateMatrixWorld(true);

  // ① 收骨頭:別名表分型別(**有序,第一個命中就定案**;與遊戲 js/actor-avatar.js 的 BONE_ALIASES 同一份規格,
  // 兩邊模組系統不同(古典 script vs ESM)無法共用常數 → 改一邊要同步另一邊)。
  // 接受 Bone「或任何非網格節點」:重匯出的 GLB 沒有 skin 宣告時 isBone 會是 false,
  // 但空節點階層同樣能當骨架用(網格名 geo_* 是 Mesh,被排除,不會誤認)。
  const AV_ALIASES = [
    ['upperarm','upperarm'],
    ['forearm','forearm'], ['lowerarm','forearm'],
    ['hand','hand'],
    ['upperleg','thigh'], ['upleg','thigh'], ['thigh','thigh'],
    ['lowerleg','shin'], ['calf','shin'], ['shin','shin'],
    ['foot','foot'],
    ['spine','torso'], ['chest','torso'], ['torso','torso'],
    ['neck','neck'], ['head','head'],
    ['hips','root'], ['root','root'],
    ['arm','upperarm'],   // Mixamo LeftArm=上臂(裸字必須排在 forearm/upperarm 之後)
    ['leg','shin'],       // Mixamo LeftLeg=小腿(UpLeg 才是大腿,已在前面)
  ];
  // 容器節點:名字含關鍵字但不是骨頭。Blender 匯出的根節點 'Armature' 小寫化含 'arm',
  // 而它是 traverse 的第一個 → 會靠下面的「重複命名取第一個」把真正的上臂擋在門外。
  const AV_SKIP = /^(armature|scene|rootnode|correction|sketchfab)/;
  // 包成函式:yaw 正規化(下面)轉完場景要**重收一次**——左右判定靠世界 X,轉 180° 後左右互換。
  const _v = new THREE.Vector3();
  const collect = () => {
    const found = [];
    sc.traverse(o => {
      if(o.isMesh) return;
      const n = (o.name || '').toLowerCase().replace(/[^a-z]/g, '');
      if(!n || AV_SKIP.test(n)) return;
      const i = AV_ALIASES.findIndex(([k]) => n.includes(k));
      if(i >= 0) found.push({ bone: o, type: AV_ALIASES[i][1], raw: o.name, pri: i });
    });
    // 同一個 key 有多個候選時**照別名表優先序取,不是照 traverse 順序**。
    // 踩過:VRoid 檔同時有 `Root`(骨架根,在腳底)與 `J_Bip_C_Hips`(真髖)——Root 在階層上更早,
    // 舊的「重複取第一個」就選了它 → root 樞紐變腳底,clip 的 root_x(pitch)會繞著腳踝甩全身。
    found.sort((a, b) => a.pri - b.pri);

    // ② key = 型別(+左右,以骨頭「rest 世界 X」判定,不信名字)
    const out = {};
    for(const f of found){
      f.bone.getWorldPosition(_v);
      const sx = _v.x < 0 ? -1 : 1;
      const key = AVATAR_PAIRED.includes(f.type) ? `${f.type}${sx < 0 ? '_l' : '_r'}` : f.type;
      if(out[key]) continue;                       // 重複命名取第一個
      const nodeFor = AVATAR_NODE_OF[f.type];
      const meshes = f.bone.children.filter(c => c.isMesh);
      // 記每塊網格的靜止局部位置:命中放大要「繞骨頭原點(關節)」縮放而非網格自身原點——
      // 這模型幾何烤在骨架空間、網格節點帶補償位移,直接 mesh.scale 會把幾何甩離關節。
      meshes.forEach(m => { m.userData.restPos = m.position.clone(); });
      out[key] = { bone: f.bone, node: () => nodeFor(sx), meshes, raw: f.raw,
                  qT: new THREE.Quaternion(), bQT: new THREE.Quaternion() };
    }
    return out;
  };
  let by = collect();

  // ②b ugc-2e rest **yaw** 正規化(與遊戲 js/actor-avatar.js restYawSnap 同一份規格):慣例=rest 面向 +Z,
  // 但 VRM0/VRoid 出廠面向 −Z → bQT 把反向烤進基準線=整隻反 180° 而且左右鏡像;normalizeAvatarRest 看不見
  // yaw(它只對齊骨→子骨方向,脊椎/腿垂直、T-pose 手臂左右橫,繞垂直軸轉 180° 全都不變)。
  // 量**腳尖 rest 朝向**(腳掌網格形心−踝骨,水平,左右平均=外八互相抵消),貼齊 90° 檔位轉回 +Z,再重收骨頭。
  const yawFix = avRestYawSnap(sc, by);
  if(yawFix){
    const anchor = by.root ? by.root.bone : sc;
    anchor.getWorldPosition(_pv);                 // 繞場景原點轉會平移角色 → 把 root 水平位置補回去
    sc.rotation.y -= yawFix * Math.PI / 180;
    sc.updateMatrixWorld(true);
    anchor.getWorldPosition(_pw);
    sc.position.x += _pv.x - _pw.x; sc.position.z += _pv.z - _pw.z;
    sc.updateMatrixWorld(true);
    by = collect();
  }
  const missing = AVATAR_REQUIRED.filter(k => !by[k]);
  if(missing.length){
    AVATAR_REPORT = avatarReport(sc, by, label, missing);
    renderAvatarReport();
    updatePartsStatus(`角色載入失敗:${label} 缺骨頭 ${missing.join('/')}(命名需含 root/torso/upperarm… 字樣,rest=T-pose)。詳見下方「匯入檢查」。`);
    return false;
  }

  // ③b ugc-1c 比例正規化(**在量包圍盒之前**——改完比例身高會變,S 要照改完的算)
  const fitOn = AV_CHIBI_FIT && !builtin;
  const headsBefore = fitOn ? conformAvatarProportions(sc, by) : null;
  // ③c ugc-4 肢段粗細(conform 完身高定案才烤;蒙皮限定)
  const skinnedPre = (() => { let s = false; sc.traverse(o => { if (o.isSkinnedMesh) s = true; }); return s; })();
  const thickRep = (fitOn && skinnedPre) ? bakeAvatarLimbThickness(sc, by) : null;

  // ③ 縮放到素體身高,掛進場景(用 sampledBox 不用 setFromObject:蒙皮角色後者量到 bind pose)
  const bb = sampledBox(sc, new THREE.Box3()), size = new THREE.Vector3(); bb.getSize(size);
  const standH = headCY + DIM.headSize * 0.5;
  const S = size.y > 1e-6 ? standH / size.y : 1;
  const wrap = new THREE.Group(); wrap.name = 'PS_AVATAR'; wrap.scale.setScalar(S); wrap.add(sc);

  // ④ 校正:素體與角色都在 T-pose 下,記兩邊每個關節/骨頭的世界四元數
  if(AVATAR) clearAvatar();
  AVATAR = null;                                // 校正期間 hook 不得驅動
  applyPose(inspectTposePose());                // 素體 → T-pose(角色 rest 本來就是 T-pose)
  root.updateMatrixWorld(true);
  scene.add(wrap); wrap.updateMatrixWorld(true);
  // ⑤ 父先子後的處理順序(依骨頭深度)——rest 正規化與每幀重定向都靠它
  const depth = e => { let d = 0, p = e.bone; while(p.parent){ d++; p = p.parent; } return d; };
  const order = Object.keys(by).sort((a, b) => depth(by[a]) - depth(by[b]));

  // ⑤b rest 姿勢正規化(ugc-1b;**必須在記 bQT 之前**——bQT 就是基準線)。
  // VRoid/多數 DCC 出廠是 A-pose(手臂往下 45°),實測偏離 T-pose 45°=所有動作手臂低 45°。
  const skinned = (() => { let s = false; sc.traverse(o => { if(o.isSkinnedMesh) s = true; }); return s; })();
  const fixOn = AV_TPOSE_FIX && !builtin;
  const restDev = normalizeAvatarRest(by, order, fixOn);
  const restResid = normalizeAvatarRest(by, order, false);

  Object.values(by).forEach(e => { e.node().getWorldQuaternion(e.qT); e.bone.getWorldQuaternion(e.bQT); });
  // 關節填充半徑/顏色只在此刻(rest=T-pose)量一次並快取 → 之後 pose 彎曲不影響量測、拉滑桿不重掃幾何
  // (蒙皮角色沒有「骨頭下掛網格」→ jointFillRadiusColor 回 null,填充自動不生成,本來就不需要)
  JOINT_FILL_KEYS.forEach(k => { const e = by[k]; if(e) e._fill = jointFillRadiusColor(e); });

  // 踩地(蒙皮):bind pose 的包圍盒不隨姿勢動,拿它量腳底會浮空。改記「腳骨世界 Y − 真實腳底 Y」這個
  // **姿勢無關**的偏移(腳骨位置是姿勢準確的),每幀用腳骨反推腳底。剛體角色維持原本的網格包圍盒路徑。
  // ⚠ 存**wrap 局部單位**不是世界距離:updateAvatarPose 每幀 `w.scale.copy(root.scale)×S`(鏡射素體的
  // 擠壓 sq/squat)→ wrap 縮放會變,拿世界絕對距離每幀套就錯(實測腳浮 0.42 = 身高 20%)。
  const soleOffset = skinned
    ? +((avFootBoneY(by) - sampledBox(wrap, _pbox).min.y) / (wrap.scale.y || 1)).toFixed(5) : null;
  const headsAfter = avHeadsRatio(wrap, by, sampledBox(wrap, _pbox));
  AVATAR = { wrap, S, label, by, order, skinned, restDev, restResid, fixOn, builtin: !!builtin, yawFix,
             chibiFit: fitOn, headsBefore, headsAfter, soleOffset, thickRep, fillers: [] };
  AVATAR_REPORT = avatarReport(sc, by, label, [], { skinned, restDev, restResid, S, fixOn, builtin: !!builtin,
             yawFix, thickRep, chibiFit: fitOn, headsBefore, headsAfter });
  renderAvatarReport();
  buildJointFillers();
  if(typeof remountHeadgear === 'function') remountHeadgear();   // item-3b:角色到位 → 已掛的頭戴道具改掛 avatar 頭骨(校準值語意不變)
  setSyntheticDummyVisible(false);
  if(typeof buildPropPanel === 'function') buildPropPanel();   // 刷新 PROPORTIONS 面板 → 進入角色模式鎖定態
  applyInspectOrPhase();                        // 回到目前 phase,hook 立即驅動角色
  updatePartsStatus(`基底角色已掛載:${label}(${order.length} 骨,${skinned ? '蒙皮' : '剛體分件'},×${S.toFixed(2)}`
    + `${fitOn ? `,頭身 ${headsBefore}→${headsAfter}` : ''}`
    + `${restDev >= 8 ? `,rest 偏 ${restDev}°→${AV_TPOSE_FIX ? `校正後 ${restResid}°` : '未校正'}` : ''})。素體隱藏中;「清除角色」回素體/部位模式。`);
  return true;
}

// headless 健檢入口(比照 __psEquip;__ps 屬於 game-bridge,別的檔用自己的命名空間)
window.__psAvatar = {
  report: () => AVATAR_REPORT,
  avatar: () => AVATAR,
  tposeFix: (on) => { if(on !== undefined){ AV_TPOSE_FIX = !!on; try{ localStorage.setItem('PS_TPOSE_FIX', on ? '1' : '0'); }catch(e){} } return AV_TPOSE_FIX; },
  chibiFit: (on) => { if(on !== undefined){ AV_CHIBI_FIT = !!on; try{ localStorage.setItem('PS_CHIBI_FIT', on ? '1' : '0'); }catch(e){} } return AV_CHIBI_FIT; },
  load: (ab, label, builtin) => loadAvatarBuffer(ab, label || 'test.glb', builtin),
  clear: () => clearAvatar(),
};

// ===== 程序化關節填充 =====
// 剛體部位骨架的關節在大角度旋轉時會露出樞紐周圍的空殼(部件近端是平蓋、非以樞紐為圓心的球)。
// 對策:每個可填關節在樞紐處(骨頭 local 原點)生一顆低模球——以樞紐為圓心 → 旋轉不變 → 永不露縫。
// 半徑實測該部件近端的橫截半徑;顏色取該部件近端頂點色;低模 flatShading 貼合美術風格。
const JOINT_FILL_KEYS = ['upperarm_l','upperarm_r','forearm_l','forearm_r','hand_l','hand_r',
                         'thigh_l','thigh_r','shin_l','shin_r','foot_l','foot_r','neck'];
let JOINT_FILL_ON = true;
try{ if(localStorage.getItem('PS_JOINT_FILL')==='0') JOINT_FILL_ON = false; }catch(e){}

const _jp = new THREE.Vector3(), _jv = new THREE.Vector3(), _js = new THREE.Vector3(), _jjq = new THREE.Quaternion(),
      _jax = new THREE.Vector3(), _jtip = new THREE.Vector3(), _jrel = new THREE.Vector3();
let JOINT_FILL_SCALE = 0.82;   // 球半徑相對肢體橫截半徑:<1 收在表面內,不凸成腫瘤(全域基準)
try{ const v = parseFloat(localStorage.getItem('PS_JOINT_FILL_SIZE')); if(Number.isFinite(v)) JOINT_FILL_SCALE = Math.max(0.4, Math.min(1.3, v)); }catch(e){}
// 逐關節倍率(疊在全域基準上;預設 1.0=不變、0=關掉該關節填充)。key=骨頭 key,左右可不同。
let JOINT_FILL_MULT = {};
try{ const j = JSON.parse(localStorage.getItem('PS_JOINT_FILL_MULT')||'{}'); if(j && typeof j==='object') JOINT_FILL_MULT = j; }catch(e){}
const jfMult = k => (JOINT_FILL_MULT[k] != null ? JOINT_FILL_MULT[k] : 1);
function jointFillRadiusColor(e){
  // 量該部件近端的「對軸線橫截半徑」(不是到樞紐的距離——那含軸向偏移會偏大),世界量測。
  const mesh = e.meshes[0]; if(!mesh) return null;
  e.bone.getWorldPosition(_jp);
  mesh.updateMatrixWorld(true);
  const gp = mesh.geometry.getAttribute('position');
  const gc = mesh.geometry.getAttribute('color');
  if(!gp.count) return null;
  // 軸線:優先用骨頭階層方向(樞紐 → 子骨頭,確定、pose 無關、不靠頂點 tiebreak);
  //       末端骨(手/腳/頭無子骨)退回「樞紐 → 最遠頂點」。
  const childBone = e.bone.children.find(c => c.isBone || (!c.isMesh && /arm|hand|forearm|thigh|shin|calf|foot|head|neck/i.test(c.name||'')));
  let len;
  if(childBone){ childBone.getWorldPosition(_jtip); _jax.copy(_jtip).sub(_jp); len=_jax.length()||1; }
  else {
    let far=-1;
    for(let i=0;i<gp.count;i++){ _jv.set(gp.getX(i),gp.getY(i),gp.getZ(i)).applyMatrix4(mesh.matrixWorld);
      const d=_jv.distanceToSquared(_jp); if(d>far){ far=d; _jtip.copy(_jv); } }
    _jax.copy(_jtip).sub(_jp); len=_jax.length()||1;
  }
  _jax.multiplyScalar(1/len);
  // 近端環帶(沿軸 0~30% 的頂點),量各自對軸線的垂直距離 = 橫截半徑
  const rads=[]; let cr=0,cg=0,cb=0,cn=0;
  for(let i=0;i<gp.count;i++){ _jv.set(gp.getX(i),gp.getY(i),gp.getZ(i)).applyMatrix4(mesh.matrixWorld);
    _jrel.copy(_jv).sub(_jp); const t=_jrel.dot(_jax);
    if(t < 0 || t > len*0.3) continue;
    const perp=Math.sqrt(Math.max(0,_jrel.lengthSq()-t*t)); rads.push(perp);
    if(gc){ cr+=gc.getX(i); cg+=gc.getY(i); cb+=gc.getZ(i); cn++; }
  }
  if(!rads.length) return null;
  rads.sort((a,b)=>a-b);
  const r = rads[Math.floor(rads.length*0.5)];                          // 橫截半徑中位數
  const col = cn ? new THREE.Color(cr/cn, cg/cn, cb/cn) : new THREE.Color(0.7,0.7,0.7);
  // 骨頭世界縮放也在此刻(rest)一起量:decompose 出的 scale 會隨姿勢旋轉漂移,必須用 rest 值換算
  e.bone.matrixWorld.decompose(_jp, _jjq, _js);
  return { r, color: col, scale: _js.x };
}
function buildJointFillers(){
  const A = AVATAR; if(!A) return;
  A.fillers.forEach(f => { f.parent && f.parent.remove(f); f.geometry.dispose(); f.material.dispose(); });
  A.fillers = [];
  if(!JOINT_FILL_ON) return;
  for(const k of JOINT_FILL_KEYS){
    const e = A.by[k]; if(!e) continue;
    const rc = e._fill || (e._fill = jointFillRadiusColor(e));   // 用 rest 快取(見載入時預量);缺才即時量
    if(!rc) continue;
    // 世界半徑 → 骨頭 local 尺度:用 rest 時量的 scale(live decompose 會隨姿勢漂移)
    const localR = rc.r / (rc.scale || A.S || 1) * JOINT_FILL_SCALE * jfMult(k);   // 全域基準 × 逐關節倍率
    if(localR < 1e-4) continue;                                          // 倍率 0=關掉該關節填充
    const geo = new THREE.IcosahedronGeometry(localR, 1);               // 低模球(42 面)貼合 faceted 風格
    const mat = new THREE.MeshStandardMaterial({ color: rc.color, roughness:0.6, metalness:0.04, flatShading:true });
    const ball = new THREE.Mesh(geo, mat);
    ball.name = 'PS_JOINTFILL_'+k;
    e.bone.add(ball);                                                    // 掛在骨頭 local 原點=關節樞紐
    A.fillers.push(ball);
  }
}
function setJointFill(on){
  JOINT_FILL_ON = !!on;
  try{ localStorage.setItem('PS_JOINT_FILL', on?'1':'0'); }catch(e){}
  if(AVATAR) buildJointFillers();
}
function setJointFillSize(v){
  JOINT_FILL_SCALE = Math.max(0.4, Math.min(1.3, v));
  try{ localStorage.setItem('PS_JOINT_FILL_SIZE', String(JOINT_FILL_SCALE)); }catch(e){}
  if(AVATAR && JOINT_FILL_ON) buildJointFillers();
}
function setJointFillMult(k, v){
  JOINT_FILL_MULT[k] = Math.max(0, Math.min(2, v));
  try{ localStorage.setItem('PS_JOINT_FILL_MULT', JSON.stringify(JOINT_FILL_MULT)); }catch(e){}
  if(AVATAR && JOINT_FILL_ON) buildJointFillers();
}
function resetJointFillMult(){
  JOINT_FILL_MULT = {};
  try{ localStorage.removeItem('PS_JOINT_FILL_MULT'); }catch(e){}
  if(AVATAR && JOINT_FILL_ON) buildJointFillers();
}
// 逐關節微調 UI 的關節清單(左右分開,可不對稱)
const JOINT_FILL_PARTS = [
  ['upperarm_l','左肩'],['upperarm_r','右肩'],['forearm_l','左肘'],['forearm_r','右肘'],
  ['hand_l','左腕'],['hand_r','右腕'],['thigh_l','左髖'],['thigh_r','右髖'],
  ['shin_l','左膝'],['shin_r','右膝'],['foot_l','左踝'],['foot_r','右踝'],['neck','頸'],
];

// 腳踝跟隨度(0=腳鎖死跟小腿=高筒硬靴;1=完全吃編排器腳踝壓平)。
// 高筒靴角色的鞋頭/靴身接縫重疊很小,腳踝轉太多會開口——調低此值讓整隻靴子近乎一體。
let ANKLE_FOLLOW = 0.35;
try{ const v = parseFloat(localStorage.getItem('PS_ANKLE_FOLLOW')); if(Number.isFinite(v)) ANKLE_FOLLOW = Math.max(0, Math.min(1, v)); }catch(e){}

// 每幀由 rig.js applyPose 尾端呼叫(typeof 守衛)。素體剛 pose 完+updateMatrixWorld 完。
const _aq1 = new THREE.Quaternion(), _aqd = new THREE.Quaternion(),
      _aq2 = new THREE.Quaternion(), _aqp = new THREE.Quaternion(),
      _aq3 = new THREE.Quaternion(), _aqs = new THREE.Quaternion();
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
    // 腳:差量 = slerp(小腿差量, 腳踝差量, ANKLE_FOLLOW) → 靴子接近一體,壓平只吃一部分
    if((k === 'foot_l' || k === 'foot_r') && ANKLE_FOLLOW < 1){
      const se = A.by[k === 'foot_l' ? 'shin_l' : 'shin_r'];
      if(se && se.node()){
        se.node().getWorldQuaternion(_aq3);
        _aqs.copy(se.qT).invert().premultiply(_aq3);    // Δ小腿
        _aqd.copy(_aqs.slerp(_aqd, ANKLE_FOLLOW));
      }
    }
    _aq2.copy(e.bQT).premultiply(_aqd);                 // 目標世界 = Δ · bQT
    e.bone.parent.getWorldQuaternion(_aqp).invert();
    e.bone.quaternion.copy(_aq2).premultiply(_aqp);     // local = qParent⁻¹ · 目標世界
    e.bone.updateMatrixWorld(true);
  }
  // 命中放大/身體縮放:縮「骨頭上的網格」不縮骨頭(避免縮放傳染子骨)。
  // 繞骨頭原點(關節)縮放:renders s·(restPos + v) → 近端黏在關節,肢段往外脹大(power punch 觀感)。
  // ugc-1:蒙皮角色的網格全掛在 SkinnedMesh 上、骨頭底下沒有子網格(`e.meshes` 恆空)→ 縮網格整組失效。
  // 改縮**骨頭**;骨縮放沿骨鏈繼承,所以每組只縮近端那根(forearm 帶 hand、shin 帶 foot),不然 s² 爆掉。
  const setS = (k, v) => { const e = A.by[k]; if(!e) return; const s = v || 1;
    if(A.skinned){ e.bone.scale.setScalar(s); return; }
    e.meshes.forEach(m => { m.scale.setScalar(s); m.position.copy(m.userData.restPos).multiplyScalar(s); }); };
  if(A.skinned){
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
  // 整肢伸展:縮近端骨頭(upperarm/thigh)→ 整條肢從肩/髖等比放大(子骨/網格一起帶,uniform 不歪)
  const setStretch = (k, v) => { const e = A.by[k]; if(e) e.bone.scale.setScalar(v || 1); };
  setStretch('upperarm_l', p.aL_stretch); setStretch('upperarm_r', p.aR_stretch);
  setStretch('thigh_l', p.lL_stretch);    setStretch('thigh_r', p.lR_stretch);
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
  // 上面那套(網格包圍盒)只對**剛體分件**成立:蒙皮角色骨頭底下沒有網格,而且 Three 不把蒙皮形變算進
  // setFromObject(拿到的是 bind pose 盒)→ 比例正規化後會浮空。蒙皮改走腳骨推算(姿勢準確)。
  if(A.soleOffset != null){
    // 蒙皮:w.position.y 此刻為 0 → 腳骨世界 Y 減掉 rest 時量好的腳底偏移 = 這個姿勢的真實腳底。
    const b0 = avFootBoneY(A.by, { l: cL === 2, r: cR === 2 });
    w.position.y = (isFinite(b0) ? (baseY + A.soleOffset * w.scale.y - b0) : baseY) + (p.root_py || 0);
  } else {
    w.position.y = (isFinite(_abox.min.y) ? (baseY - _abox.min.y) : baseY) + (p.root_py || 0);
  }
}

function clearAvatar(){
  if(!AVATAR) return;
  scene.remove(AVATAR.wrap);
  AVATAR.wrap.traverse(o => {
    if(o.geometry) o.geometry.dispose();
    if(o.material){ (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }
  });
  AVATAR = null;
  AVATAR_REPORT = null; renderAvatarReport();
  if(typeof remountHeadgear === 'function') remountHeadgear();   // item-3b:退回素體 headPivot(補償 group 隨之銷毀)
  setSyntheticDummyVisible(!PARTS_HIDE_DUMMY);
  if(typeof buildPropPanel === 'function') buildPropPanel();   // 刷新 PROPORTIONS 面板 → 解除鎖定
  updatePartsStatus('角色已清除,回到素體/部位模式。');
}

// ===== UI:載入角色 GLB / 清除(插在部位面板狀態列上方)=====
(function(){
  const st = document.getElementById('partsStatus'); if(!st) return;
  const row = document.createElement('div'); row.className = 'util'; row.style.marginTop = '6px';
  row.innerHTML =
    `<label class="filebtn" title="載入 16 骨基座角色 GLB(rest=T-pose、剛體部位掛骨頭、面向 +Z;比例任意,左右自動以世界 X 判定)">👤 載入角色 GLB(基座骨架)<input type="file" id="avatarFile" accept=".glb,.gltf,model/gltf-binary,model/gltf+json"></label>` +
    `<button id="avatarClear" title="移除角色,回到素體/部位模式">清除角色</button>` +
    `<label style="display:flex;align-items:center;gap:6px" title="0=腳鎖死跟小腿(高筒硬靴,靴子一體不裂);1=完全吃編排器腳踝壓平。高筒靴角色建議 0.2~0.4">腳踝跟隨 <input type="range" id="ankleFollow" min="0" max="1" step="0.05" style="width:90px"><span id="ankleFollowV" style="min-width:24px"></span></label>` +
    `<label style="display:flex;align-items:center;gap:6px;cursor:pointer" title="每個關節樞紐補一顆低模球,塞住剛體部件大角度旋轉時露出的縫隙(以樞紐為圓心,旋轉不露縫)"><input type="checkbox" id="jointFill"> 關節填充</label>` +
    `<label style="display:flex;align-items:center;gap:6px" title="填充球大小(相對肢體橫截半徑)。太大會凸成腫瘤、太小遮不住縫,依角色微調">球大小 <input type="range" id="jointFillSize" min="0.4" max="1.3" step="0.02" style="width:80px"><span id="jointFillSizeV" style="min-width:30px"></span></label>` +
    `<label style="display:flex;align-items:center;gap:6px;cursor:pointer" title="把角色 rest 的各肢段方向轉到素體 T-pose 方向。VRoid/多數 DCC 出廠是 A-pose(手臂往下 45°),不校正的話每個動作手臂都低 45°。關掉可看修正前長相"><input type="checkbox" id="tposeFix"> T-pose 校正</label>` +
    `<label style="display:flex;align-items:center;gap:6px;cursor:pointer" title="把匯入角色的骨架比例壓成 chibi 比例(大頭/短腿/寬肩)——只換外觀,骨子維持遊戲的 chibi 身形。**這裡跟遊戲必須一致**,不然編出來的姿勢進遊戲會偏"><input type="checkbox" id="chibiFit"> chibi 比例</label>`;
  st.parentElement.insertBefore(row, st);
  // 匯入檢查報告(骨頭對照表 + 面數/蒙皮/貼圖 + rest 偏離 + 提醒)
  const rep = document.createElement('details');
  rep.id = 'avatarReport';
  rep.style.cssText = 'margin-top:4px;font-size:10px;background:rgba(255,255,255,.03);border-radius:4px;padding:3px 6px';
  st.parentElement.insertBefore(rep, st);
  const cf = document.getElementById('chibiFit');
  cf.checked = AV_CHIBI_FIT;
  cf.addEventListener('change', e => {
    AV_CHIBI_FIT = e.target.checked;
    try{ localStorage.setItem('PS_CHIBI_FIT', AV_CHIBI_FIT ? '1' : '0'); }catch(err){}
    if(AVATAR && AVATAR_LAST_BUF) loadAvatarBuffer(AVATAR_LAST_BUF.slice(0), AVATAR_LAST_LABEL, AVATAR_LAST_BUILTIN);   // 比例是載入時烤的 → 重載才生效
    else renderAvatarReport();
  });
  const tf = document.getElementById('tposeFix');
  tf.checked = AV_TPOSE_FIX;
  tf.addEventListener('change', e => {
    AV_TPOSE_FIX = e.target.checked;
    try{ localStorage.setItem('PS_TPOSE_FIX', AV_TPOSE_FIX ? '1' : '0'); }catch(err){}
    if(AVATAR && AVATAR_LAST_BUF) loadAvatarBuffer(AVATAR_LAST_BUF.slice(0), AVATAR_LAST_LABEL, AVATAR_LAST_BUILTIN);   // rest 是載入時烤的 → 重載才生效
    else renderAvatarReport();
  });
  const jf = document.getElementById('jointFill');
  jf.checked = JOINT_FILL_ON;
  jf.addEventListener('change', e => setJointFill(e.target.checked));
  const jfs = document.getElementById('jointFillSize'), jfsv = document.getElementById('jointFillSizeV');
  jfs.value = JOINT_FILL_SCALE; jfsv.textContent = JOINT_FILL_SCALE.toFixed(2);
  jfs.addEventListener('input', e => { const v = parseFloat(e.target.value); jfsv.textContent = v.toFixed(2); setJointFillSize(v); });

  // 逐關節微調(可折疊):13 個倍率滑桿,疊在全域「球大小」上;左右可不同。0=關掉該關節。
  const jp = document.createElement('details');
  jp.style.cssText = 'margin-top:4px;font-size:10px;background:rgba(255,255,255,.03);border-radius:4px;padding:3px 6px';
  let html = '<summary style="cursor:pointer;color:var(--dim)">逐關節微調(填充球大小)<button id="jfmReset" style="float:right;font-size:9px;padding:1px 6px">全部歸 1</button></summary>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px 10px;margin-top:5px">';
  JOINT_FILL_PARTS.forEach(([k,label])=>{
    const v = jfMult(k);
    html += `<label style="display:flex;align-items:center;gap:4px" title="${label} 填充球倍率(疊在全域球大小上;0=關掉)">`
      + `<span style="width:26px;color:var(--dim)">${label}</span>`
      + `<input type="range" id="jfm_${k}" min="0" max="2" step="0.05" value="${v}" style="flex:1;min-width:0">`
      + `<span id="jfmv_${k}" style="width:26px;text-align:right">${v.toFixed(2)}</span></label>`;
  });
  html += '</div>';
  jp.innerHTML = html;
  st.parentElement.insertBefore(jp, st);
  JOINT_FILL_PARTS.forEach(([k])=>{
    const s = document.getElementById('jfm_'+k), sv = document.getElementById('jfmv_'+k);
    s.addEventListener('input', e => { const v = parseFloat(e.target.value); sv.textContent = v.toFixed(2); setJointFillMult(k, v); });
  });
  document.getElementById('jfmReset').addEventListener('click', e => {
    e.preventDefault();
    resetJointFillMult();
    JOINT_FILL_PARTS.forEach(([k])=>{ const s=document.getElementById('jfm_'+k), sv=document.getElementById('jfmv_'+k); if(s){ s.value=1; sv.textContent='1.00'; } });
  });
  const af = document.getElementById('ankleFollow'), afv = document.getElementById('ankleFollowV');
  af.value = ANKLE_FOLLOW; afv.textContent = ANKLE_FOLLOW.toFixed(2);
  af.addEventListener('input', e => {
    ANKLE_FOLLOW = parseFloat(e.target.value); afv.textContent = ANKLE_FOLLOW.toFixed(2);
    try{ localStorage.setItem('PS_ANKLE_FOLLOW', String(ANKLE_FOLLOW)); }catch(err){}
    applyInspectOrPhase();                                  // 立即反映到目前姿勢
  });
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
    if (r.ok && await loadAvatarBuffer(await r.arrayBuffer(), 'base-avatar.glb', true)) return;   // builtin=true:不套 rest 校正(同遊戲)
  } catch (e) { /* 走退路 */ }
  try {
    const resp = await fetch('meshy-mannequin.glb');
    if (!resp.ok) return;
    const ok = await loadPartFile(new File([await resp.arrayBuffer()], 'meshy-mannequin.glb'));
    if (ok) updatePartsStatus(`預設人偶已自動掛載:meshy-mannequin.glb(${Object.keys(PART_MODELS).length} 部位)。要回素體按「清空部位」。`);
  } catch (e) { /* 保持素體 */ }
})();
