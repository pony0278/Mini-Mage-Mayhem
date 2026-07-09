// punch-studio — parts:部位掛載系統:sockets.json→slot 定義、GLB 掛載(bundle/分檔)、部位面板、預設人偶自動載入
// 古典 script(非 module):所有 ps/*.js 共享同一個全域作用域,載入順序由 punch-studio.html 決定(見 ps/README.md)。
// ===== PUNCH STUDIO PART KIT LOADER (方案 B: GetAmped-like detached parts) =====
// Load static GLB parts exported by export_ranger_parts_for_punch_studio.py and attach them to the existing pose nodes.
const PART_CFG_STORAGE_KEY = 'PUNCH_STUDIO_PART_KIT_CFG_V3_SOCKETLOCAL_MOUNT';
const PART_HIDE_STORAGE_KEY = 'PUNCH_STUDIO_PART_KIT_HIDE_DUMMY_V2_14PARTS_AXISFIX';
// ===== 方案 B-1: sockets.json = 唯一真相,動態生成 PART_SLOT_DEFS =====
// sockets.json 的 child_part 命名與 PS slot 命名一致(已驗證),L/R 翻轉已被 sockets.json
// 內部吸收(socket .l 坐 .R 骨)。PS 只保留一張「邏輯 slot -> PS DIM rig 節點」適配表,
// 其餘 roster(哪些 slot、seam class、load_bearing、相容規則)全部來自 sockets.json。
// 部位的 socket->bone 由 PS 自己 rig 的 rest pose 自動滿足(零 config 即對位),
// 不套用 sockets.json 的 skeleton-bone-local 旋轉(那是給 skeleton rig / assembler 用的)。

// (1) 邏輯 slot/childPart -> PS DIM rig 節點存取器(唯一 PS-specific 適配層)
const PS_RIG_TARGET = {
  torso:       ()=>spine,
  head:        ()=>headPivot,
  neck:        ()=>spine,                     // neck 掛 spine + y 偏移(對齊可動的 fight demo)
  upper_arm_l: ()=>armL && armL.sh,
  forearm_l:   ()=>armL && armL.el,
  hand_l:      ()=>armL && armL.wr,
  upper_arm_r: ()=>armR && armR.sh,
  forearm_r:   ()=>armR && armR.el,
  hand_r:      ()=>armR && armR.wr,
  thigh_l:     ()=>legL && legL.hp,
  calf_l:      ()=>legL && legL.kn,
  foot_l:      ()=>legL && legL.ankle,
  thigh_r:     ()=>legR && legR.hp,
  calf_r:      ()=>legR && legR.kn,
  foot_r:      ()=>legR && legR.ankle,
  // 配件(sockets.json equipment_mounts 擺位多為 _todo;PS rig 無 chest 節點,
  //  沿用 PS 既有掛點,待資產到位再對 sockets.json 收斂)
  armguard_l:  ()=>armL && armL.el,
  armguard_r:  ()=>armR && armR.el,
  cloak:       ()=>headPivot,
  pouch:       ()=>spine,
  bow:         ()=>armR && armR.wr,
  headgear:    ()=>headPivot,                 // 頭戴道具(火帽…);掛頭骨,對位用校準滑桿
};

// (2) 中文標籤(未列者自動用 slot 名)
const PS_SLOT_LABEL = {
  head:'HEAD 頭', neck:'NECK 脖子', torso:'TORSO 身體',
  upper_arm_l:'UPPER_ARM_L 左大臂', forearm_l:'FOREARM_L 左前臂', hand_l:'HAND_L 左手',
  upper_arm_r:'UPPER_ARM_R 右大臂', forearm_r:'FOREARM_R 右前臂', hand_r:'HAND_R 右手',
  thigh_l:'THIGH_L 左大腿', calf_l:'CALF_L 左小腿', foot_l:'FOOT_L 左腳',
  thigh_r:'THIGH_R 右大腿', calf_r:'CALF_R 右小腿', foot_r:'FOOT_R 右腳',
  armguard_l:'ARMGUARD_L 左護腕', armguard_r:'ARMGUARD_R 右護腕',
  cloak:'CLOAK 披風', pouch:'POUCH 腰包', bow:'BOW 弓/武器',
  headgear:'HEADGEAR 頭戴道具',
};

// (3) sockets.json 讀取 + slot 推導
// 資料來自 ps/sockets-data.js 的全域 SOCKETS_JSON_RAW(古典 script,在 parts.js 之前同步載入)。
function readSocketsJson(){
  try{
    if(typeof SOCKETS_JSON_RAW !== 'undefined' && SOCKETS_JSON_RAW) return SOCKETS_JSON_RAW;
  }catch(e){ console.warn('[B-1] sockets.json 讀取失敗,改用 fallback', e); }
  return null;
}
function socketsToSlotDefs(j){
  const out = [];
  const push = (slot, seamClass, kind, extra)=>{
    const tfn = PS_RIG_TARGET[slot];
    out.push(Object.assign({
      slot, label: PS_SLOT_LABEL[slot] || slot,
      target: tfn || (()=>null), seamClass: seamClass||null, kind
    }, extra||{}));
  };
  if(j.torso_root) push(j.torso_root.part, null, 'root', {bone:j.torso_root.bone, loadBearing:false});
  (j.sockets||[]).forEach(s=> push(s.child_part, s.class, 'structural',
    {bone:s.bone, loadBearing:!!s.load_bearing, restLength:s.rest_length, socketId:s.socket_id}));
  (j.equipment_mounts||[]).forEach(e=> push(e.mount_id.replace(/\./g,'_'), e.overlay_class||null, 'equipment',
    {bone:e.bone, todo:!!e._todo}));
  // 僅保留 PS rig 有對應節點的項目(或 torso root)
  return out.filter(d=> PS_RIG_TARGET[d.slot] || d.kind==='root');
}

// fallback:萬一內嵌 sockets.json 缺失/解析失敗,沿用原本硬編 19 slot(無 neck)
const PART_SLOT_DEFS_FALLBACK = [
  {slot:'head',label:'HEAD 頭',target:()=>headPivot},
  {slot:'torso',label:'TORSO 身體',target:()=>spine},
  {slot:'upper_arm_l',label:'UPPER_ARM_L 左大臂',target:()=>armL && armL.sh},
  {slot:'forearm_l',label:'FOREARM_L 左前臂',target:()=>armL && armL.el},
  {slot:'hand_l',label:'HAND_L 左手',target:()=>armL && armL.wr},
  {slot:'upper_arm_r',label:'UPPER_ARM_R 右大臂',target:()=>armR && armR.sh},
  {slot:'forearm_r',label:'FOREARM_R 右前臂',target:()=>armR && armR.el},
  {slot:'hand_r',label:'HAND_R 右手',target:()=>armR && armR.wr},
  {slot:'thigh_l',label:'THIGH_L 左大腿',target:()=>legL && legL.hp},
  {slot:'calf_l',label:'CALF_L 左小腿',target:()=>legL && legL.kn},
  {slot:'foot_l',label:'FOOT_L 左腳',target:()=>legL && legL.ankle},
  {slot:'thigh_r',label:'THIGH_R 右大腿',target:()=>legR && legR.hp},
  {slot:'calf_r',label:'CALF_R 右小腿',target:()=>legR && legR.kn},
  {slot:'foot_r',label:'FOOT_R 右腳',target:()=>legR && legR.ankle},
  {slot:'armguard_l',label:'ARMGUARD_L 左護腕',target:()=>armL && armL.el},
  {slot:'armguard_r',label:'ARMGUARD_R 右護腕',target:()=>armR && armR.el},
  {slot:'cloak',label:'CLOAK 披風',target:()=>headPivot},
  {slot:'pouch',label:'POUCH 腰包',target:()=>spine},
  {slot:'bow',label:'BOW 弓/武器',target:()=>armR && armR.wr},
  {slot:'headgear',label:'HEADGEAR 頭戴道具',target:()=>headPivot},
];

const SOCKETS_DATA = readSocketsJson();
const PART_SLOT_DEFS = (()=>{
  if(SOCKETS_DATA){
    try{
      const defs = socketsToSlotDefs(SOCKETS_DATA);
      if(defs.length >= 15){ console.log(`[B-1] PART_SLOT_DEFS 由 sockets.json v${SOCKETS_DATA.version} 動態生成:${defs.length} slot (含 neck)`); return defs; }
    }catch(e){ console.warn('[B-1] 動態生成失敗,改用 fallback', e); }
  }
  console.warn('[B-1] 使用硬編 fallback slot 清單(無 neck)');
  return PART_SLOT_DEFS_FALLBACK;
})();

// (4) sockets.json 相容性判定(classMatch AND seamFit),供日後 hot-swap 驗證
function socketSeamRadius(cls){
  const t = SOCKETS_DATA && SOCKETS_DATA.seam_table; const e = t && t[cls];
  return e ? e.radius : null;
}
function partSocketCompatible(part, socket){
  if(!SOCKETS_DATA) return {ok:true, reason:'no-sockets-data'};
  const aCls=part.class, bCls=socket.class;
  const classMatch = aCls===bCls || aCls==='universal' || bCls==='universal';
  if(!classMatch) return {ok:false, reason:'classMismatch'};
  const sr = socket.radius!=null ? socket.radius : socketSeamRadius(bCls);
  const pr = part.radius!=null ? part.radius : socketSeamRadius(aCls);
  if(sr==='any'||pr==='any') return {ok:true, reason:'universal-seam'};
  if(typeof sr!=='number'||typeof pr!=='number') return {ok:false, reason:'missingRadius'};
  const ok = Math.abs(pr-sr) <= 0.10*sr;
  return {ok, reason: ok?'fit':'seamFail', delta:+(pr-sr).toFixed(4)};
}

// ===== Socket-local 部位的 mount 變換(移植自可動的 fight_demo_v0_modular Plan A)=====
// GLB 部位是 socket-local(seam 在原點、沿 +Y 生長)。DIM rig 的手臂/腿關節朝 -Y,
// 軀幹/頭朝 +Y,所以每個部位需要各自的「預設」旋轉/位移才能正確接上,不能用零變換。
// 這些值是 fight demo 已調好、實機可動的常數;PS 與 fight demo 用同一套 DIM rig,可直接沿用。
const PART_MOUNT_XFORM = {
  // 手臂(關節朝 -Y)→ 繞 Z 翻 180;手掌繞 X 翻 180
  upper_arm_l:{rot:[0,0,180],pos:[0,0,0]}, forearm_l:{rot:[0,0,180],pos:[0,0,0]}, hand_l:{rot:[180,0,0],pos:[0,0,0]},
  upper_arm_r:{rot:[0,0,180],pos:[0,0,0]}, forearm_r:{rot:[0,0,180],pos:[0,0,0]}, hand_r:{rot:[180,0,0],pos:[0,0,0]},
  // 腿(關節朝 -Y)→ 繞 Z 翻 180;腳掌繞 X 翻 90
  thigh_l:{rot:[0,0,180],pos:[0,0,0]}, calf_l:{rot:[0,0,180],pos:[0,0,0]}, foot_l:{rot:[90,0,0],pos:[0,0,0]},
  thigh_r:{rot:[0,0,180],pos:[0,0,0]}, calf_r:{rot:[0,0,180],pos:[0,0,0]}, foot_r:{rot:[90,0,0],pos:[0,0,0]},
  // 軀幹/頸/頭(朝 +Y);pos 把 seam 抬到 bone 高度。neck 掛 spine + 大 y 偏移
  torso:{rot:[0,0,0],pos:[0,0.0222,0]}, neck:{rot:[0,0,0],pos:[0,0.4772,0]}, head:{rot:[0,0,0],pos:[0,0.0944,0]},
};

// Plan-A DIM:把假人骨長對齊 skeleton rig 真值(armUpper/Lower、legUpper/Lower 來自 socket rest_length)。
// 不對齊的話關節間距與部位長度不符 → 有縫/錯位。*Thick/fist/shoe/headSize 只餵被隱藏的佔位幾何。
const PLAN_A_DIM = {
  headSize:0.50, bodyH:0.4388, bodyW:0.1772, bodyD:0.221,
  armUpper:0.2456, armLower:0.2047, armThick:0.55, armLenL:1, armLenR:1,
  legUpper:0.2332, legLower:0.2086, legThick:0.70, fist:1.0, shoe:1.0
};
// 髖部側向偏移(rig 非對稱,L/R 不同):leg2() 用 DIM.legSpread 對稱,故載入部位後個別覆蓋。
const HIP_X = { L:-0.0735, R:0.0761 };
function applyHipX(){
  const active = ['thigh_l','calf_l','foot_l','thigh_r','calf_r','foot_r'].some(s=>PART_MODELS[s]||PART_DETACHED[s]);
  if(!active) return;
  if(legL && legL.hp) legL.hp.position.x = HIP_X.L;
  if(legR && legR.hp) legR.hp.position.x = HIP_X.R;
}
// socket-local bundle 載入時:DIM 對齊 PLAN_A_DIM(GLB 自帶 extras.dim 則覆蓋),重建 rig 一次。
function applySocketLocalRig(gltf){
  let applied=0;
  Object.keys(PLAN_A_DIM).forEach(k=>{ if(k in DIM){ DIM[k]=PLAN_A_DIM[k]; applied++; } });
  try{
    const exDim = gltf && gltf.parser && gltf.parser.json && gltf.parser.json.extras && gltf.parser.json.extras.dim;
    if(exDim){ Object.keys(exDim).forEach(k=>{ const v=Number(exDim[k]); if(Number.isFinite(v) && (k in DIM)){ DIM[k]=v; applied++; } }); }
  }catch(e){ console.warn('extras.dim 套用失敗', e); }
  if(applied){ buildPropPanel(); rebuildCharacter(); if(typeof scheduleAutosave==='function') scheduleAutosave(); }
}
// 比照 fight demo mount():載入整包後自動隱藏佔位假人,避免盒狀袖子/拳頭與骨架部位重疊破圖
function autoHideDummyOnBundle(){
  PARTS_HIDE_DUMMY = true;
  try{ localStorage.setItem(PART_HIDE_STORAGE_KEY, '1'); }catch(e){}
  setSyntheticDummyVisible(false);
  const b=document.getElementById('partsDummyToggle'); if(b) b.textContent='顯示假人';
}
const PART_ALIASES = {
  'head':'head','region_head':'head','maclass_head':'head',
  'neck':'neck','part2_neck':'neck','region_neck':'neck','collar':'neck',
  'torso':'torso','body':'torso','region_torso':'torso','mregion_torso':'torso','maclass_torso':'torso',

  'upper_arm_l':'upper_arm_l','upperarml':'upper_arm_l','leftupperarm':'upper_arm_l','upper_l':'upper_arm_l','uarm_l':'upper_arm_l','arm_l':'upper_arm_l','arml':'upper_arm_l','leftarm':'upper_arm_l','region_upper_arm_l':'upper_arm_l','mregion_upper_arm_l':'upper_arm_l','maclass_upper_arm_l':'upper_arm_l',
  'forearm_l':'forearm_l','forearml':'forearm_l','lower_arm_l':'forearm_l','lowerarml':'forearm_l','leftforearm':'forearm_l','leftlowerarm':'forearm_l','larm_l':'forearm_l','region_forearm_l':'forearm_l','mregion_forearm_l':'forearm_l','maclass_forearm_l':'forearm_l',
  'hand_l':'hand_l','handl':'hand_l','lefthand':'hand_l','fist_l':'hand_l','region_hand_l':'hand_l','mregion_hand_l':'hand_l','maclass_hand_l':'hand_l',

  'upper_arm_r':'upper_arm_r','upperarmr':'upper_arm_r','rightupperarm':'upper_arm_r','upper_r':'upper_arm_r','uarm_r':'upper_arm_r','arm_r':'upper_arm_r','armr':'upper_arm_r','rightarm':'upper_arm_r','region_upper_arm_r':'upper_arm_r','mregion_upper_arm_r':'upper_arm_r','maclass_upper_arm_r':'upper_arm_r',
  'forearm_r':'forearm_r','forearmr':'forearm_r','lower_arm_r':'forearm_r','lowerarmr':'forearm_r','rightforearm':'forearm_r','rightlowerarm':'forearm_r','larm_r':'forearm_r','region_forearm_r':'forearm_r','mregion_forearm_r':'forearm_r','maclass_forearm_r':'forearm_r',
  'hand_r':'hand_r','handr':'hand_r','righthand':'hand_r','fist_r':'hand_r','region_hand_r':'hand_r','mregion_hand_r':'hand_r','maclass_hand_r':'hand_r',

  'thigh_l':'thigh_l','thighl':'thigh_l','upper_leg_l':'thigh_l','upperlegl':'thigh_l','leftthigh':'thigh_l','leftupperleg':'thigh_l','leg_l':'thigh_l','legl':'thigh_l','leftleg':'thigh_l','region_thigh_l':'thigh_l','mregion_thigh_l':'thigh_l','maclass_thigh_l':'thigh_l',
  'calf_l':'calf_l','calfl':'calf_l','lower_leg_l':'calf_l','lowerlegl':'calf_l','leftcalf':'calf_l','leftlowerleg':'calf_l','shin_l':'calf_l','region_calf_l':'calf_l','mregion_calf_l':'calf_l','maclass_calf_l':'calf_l',
  'foot_l':'foot_l','footl':'foot_l','leftfoot':'foot_l','region_foot_l':'foot_l','mregion_foot_l':'foot_l','maclass_foot_l':'foot_l',

  'thigh_r':'thigh_r','thighr':'thigh_r','upper_leg_r':'thigh_r','upperlegr':'thigh_r','rightthigh':'thigh_r','rightupperleg':'thigh_r','leg_r':'thigh_r','legr':'thigh_r','rightleg':'thigh_r','region_thigh_r':'thigh_r','mregion_thigh_r':'thigh_r','maclass_thigh_r':'thigh_r',
  'calf_r':'calf_r','calfr':'calf_r','lower_leg_r':'calf_r','lowerlegr':'calf_r','rightcalf':'calf_r','rightlowerleg':'calf_r','shin_r':'calf_r','region_calf_r':'calf_r','mregion_calf_r':'calf_r','maclass_calf_r':'calf_r',
  'foot_r':'foot_r','footr':'foot_r','rightfoot':'foot_r','region_foot_r':'foot_r','mregion_foot_r':'foot_r','maclass_foot_r':'foot_r',

  'armguard_l':'armguard_l','attach_arm_guard_l':'armguard_l','armguard.l':'armguard_l',
  'armguard_r':'armguard_r','attach_arm_guard_r':'armguard_r','armguard.r':'armguard_r',
  'cloak':'cloak','attach_cloak':'cloak',
  'pouch':'pouch','attach_pouch':'pouch',
  'bow':'bow','ranger_bow':'bow','weapon_bow':'bow'
};
let PART_MODELS = {};       // slot -> THREE.Group imported scene
let PART_CONFIG = {};       // slot -> x/y/z/rx/ry/rz/s
let PART_DETACHED = {};     // slot -> object temporarily detached during character rebuild
let PARTS_HIDE_DUMMY = false;
// 組裝檢視:暫時把手臂平舉(T-pose),只是檢視用,不寫入 phases。aL_sz/aR_sz 繞 Z 外展。
let PART_INSPECT_TPOSE = false;
function inspectTposePose(){ return Object.assign({}, ZERO_POSE, {aL_sz:90, aR_sz:90}); }
function applyInspectOrPhase(){
  if(PART_INSPECT_TPOSE) applyPose(inspectTposePose());
  else applyPose(PHASES[activePhase] || PHASES.idle || ZERO_POSE);
}

function partDefaultConfig(slot){
  const m = (typeof PART_MOUNT_XFORM!=='undefined') && PART_MOUNT_XFORM[slot];
  if(m) return {x:m.pos[0], y:m.pos[1], z:m.pos[2], rx:m.rot[0], ry:m.rot[1], rz:m.rot[2], s:1};
  return {x:0,y:0,z:0,rx:0,ry:0,rz:0,s:1};
}
function getPartDef(slot){ return PART_SLOT_DEFS.find(d=>d.slot===slot); }
function getPartTarget(slot){ const d=getPartDef(slot); return d && d.target ? d.target() : null; }
function normPartName(name){ return String(name||'').replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9_.-]+/g,'_').replace(/-/g,'_'); }
function inferPartSlot(filename){
  const n = normPartName(filename);
  if(PART_ALIASES[n]) return PART_ALIASES[n];
  // exported files may be like Ranger_HEAD.glb or 01_REGION_ARM_L.glb; prefer longest aliases.
  const keys = Object.keys(PART_ALIASES).sort((a,b)=>b.length-a.length);
  for(const k of keys){ if(n.includes(k)) return PART_ALIASES[k]; }
  // 第三輪:分隔符不敏感(left_hand / left-hand / Left Hand 1 → lefthand1 ⊇ lefthand)。
  // 修掉別名縫隙:表裡是 lefthand(無底線)和 hand_l,底線寫法 left_hand 曾兩邊都對不到。
  const ns = n.replace(/[_.]/g,'');
  const stripped = keys.map(k=>({k, ks:k.replace(/[_.]/g,'')})).filter(e=>e.ks)
    .sort((a,b)=>b.ks.length-a.ks.length);
  for(const e of stripped){ if(ns.includes(e.ks)) return PART_ALIASES[e.k]; }
  return null;
}
function partCfg(slot){
  if(!PART_CONFIG[slot]) PART_CONFIG[slot] = partDefaultConfig(slot);
  return PART_CONFIG[slot];
}
function savePartConfig(){
  try{ localStorage.setItem(PART_CFG_STORAGE_KEY, JSON.stringify(PART_CONFIG)); }catch(e){}
}
function loadPartConfig(){
  try{ const raw=localStorage.getItem(PART_CFG_STORAGE_KEY); if(raw) PART_CONFIG=JSON.parse(raw)||{}; }catch(e){ PART_CONFIG={}; }
  PART_SLOT_DEFS.forEach(d=>partCfg(d.slot));
  try{ PARTS_HIDE_DUMMY = localStorage.getItem(PART_HIDE_STORAGE_KEY)==='1'; }catch(e){}
}
function applyPartConfig(slot){
  const obj = PART_MODELS[slot]; if(!obj) return;
  const c = partCfg(slot);
  obj.position.set(Number(c.x)||0, Number(c.y)||0, Number(c.z)||0);
  obj.rotation.set((Number(c.rx)||0)*D2R, (Number(c.ry)||0)*D2R, (Number(c.rz)||0)*D2R);
  obj.scale.setScalar(Number(c.s)||1);
}
function markPartObject(obj, slot){
  obj.userData.punchPartModel = true; obj.userData.punchPartSlot = slot;
  obj.traverse(o=>{ o.userData.punchPartModel = true; o.userData.punchPartSlot = slot; });
}
function isInsidePartObject(o){
  let n=o;
  while(n){ if(n.userData && n.userData.punchPartModel) return true; n=n.parent; }
  return false;
}
function attachPart(slot, obj){
  const target = getPartTarget(slot);
  if(!target){ throw new Error('slot target not ready: '+slot); }
  if(PART_MODELS[slot] && PART_MODELS[slot].parent){ PART_MODELS[slot].parent.remove(PART_MODELS[slot]); }
  markPartObject(obj, slot);
  PART_MODELS[slot]=obj;
  target.add(obj);
  applyPartConfig(slot);
  setSyntheticDummyVisible(!PARTS_HIDE_DUMMY);
}
function clearParts(){
  Object.values(PART_MODELS).forEach(o=>{ if(o && o.parent) o.parent.remove(o); });
  PART_MODELS = {}; PART_DETACHED = {};
  if(typeof HAND_RIG !== 'undefined') HAND_RIG = null;  // 拳頭盒抑制解除(見 setSyntheticDummyVisible)
  updatePartsStatus(); setSyntheticDummyVisible(!PARTS_HIDE_DUMMY);
}
function setSyntheticDummyVisible(on){
  const roots = [root, pelvis].filter(Boolean);
  roots.forEach(r=>r.traverse(o=>{
    if((o.isMesh || o.isLine || o.isLineSegments) && !isInsidePartObject(o)) o.visible = !!on;
  }));
  // rigged 手掛載期間:假人自己的拳頭盒持續抑制(否則 box 手跟 chibi 手同時出現)
  if(typeof HAND_RIG !== 'undefined' && HAND_RIG){
    if(armL && armL.fist) armL.fist.visible = false;
    if(armR && armR.fist) armR.fist.visible = false;
  }
}
function detachPunchPartsForRebuild(){
  PART_DETACHED = {};
  Object.entries(PART_MODELS).forEach(([slot,obj])=>{
    if(obj && obj.parent){ obj.parent.remove(obj); PART_DETACHED[slot]=obj; }
  });
}
function reattachPunchPartsAfterRebuild(){
  Object.entries(PART_DETACHED).forEach(([slot,obj])=>{
    const target=getPartTarget(slot); if(target){ target.add(obj); applyPartConfig(slot); }
  });
  PART_DETACHED = {};
  applyHipX();
  if(PART_INSPECT_TPOSE) applyPose(inspectTposePose());
  setSyntheticDummyVisible(!PARTS_HIDE_DUMMY);
}
function updatePartsStatus(msg){
  const el=document.getElementById('partsStatus'); if(!el) return;
  const loaded = Object.keys(PART_MODELS).sort();
  const missingCore = ['head','neck','torso','upper_arm_l','forearm_l','hand_l','upper_arm_r','forearm_r','hand_r','thigh_l','calf_l','foot_l','thigh_r','calf_r','foot_r'].filter(s=>!PART_MODELS[s]);
  el.textContent = msg || (loaded.length ? `已載入 ${loaded.length} 個部位：${loaded.join(', ')}${missingCore.length?'｜核心缺：'+missingCore.join(', '):'｜核心部位已完整'}` : '尚未載入。先在 Blender 執行 export_14_parts_for_punch_studio.py，然後一次選取輸出的 HEAD/TORSO/UPPER_ARM/FOREARM/HAND/THIGH/CALF/FOOT .glb。');
}
// 從整個 scene graph 深度收集可對應 slot 的節點(支援巢狀 / Armature 包裹)。
// 同一 slot 多命中時:取樹中最淺者,並跳過已選節點的子孫,避免父子重複掛載。
function collectBundleParts(rootObj){
  const depthOf = (o)=>{ let d=0,p=o.parent; while(p){ d++; p=p.parent; } return d; };
  const hits = [];
  rootObj.traverse(n=>{ const s = inferPartSlot(n.name); if(s) hits.push({node:n, slot:s, depth:depthOf(n)}); });
  hits.sort((a,b)=> a.depth - b.depth);
  const claimed = {}; const picked = [];
  const underPicked = (node)=>{ let p=node.parent; while(p){ if(picked.some(x=>x.node===p)) return true; p=p.parent; } return false; };
  for(const h of hits){
    if(claimed[h.slot]) continue;       // 同 slot 已取(保留最淺)
    if(underPicked(h.node)) continue;    // 在已選節點底下 → 略過
    claimed[h.slot]=true; picked.push({node:h.node, slot:h.slot});
  }
  return picked; // [{node, slot}]
}

// 套用 bundle 內嵌比例(glTF 頂層 extras.dim)→ 假人關節間距自動配合此角色
function applyBundleDim(gltf){
  try{
    const exDim = gltf.parser && gltf.parser.json && gltf.parser.json.extras && gltf.parser.json.extras.dim;
    if(!exDim) return;
    let applied=0;
    Object.keys(exDim).forEach(k=>{ const v=Number(exDim[k]); if(Number.isFinite(v) && (k in DIM)){ DIM[k]=v; applied++; } });
    if(applied){ buildPropPanel(); rebuildCharacter(); if(typeof scheduleAutosave==='function') scheduleAutosave(); }
  }catch(e){ console.warn('bundle dim apply failed', e); }
}

// ★ 一次上傳整包 GLB,自動對應到所有部位 slot(深度遍歷,不管巢不巢狀)
async function loadPartBundle(file){
  if(!file) return false;
  if(!THREE.GLTFLoader){ updatePartsStatus('GLTFLoader 沒載入成功；請確認網路可連 CDN，或把 GLTFLoader.js 放到本機。'); return false; }
  const loader = new THREE.GLTFLoader();
  const url = URL.createObjectURL(file);
  try{
    const gltf = await new Promise((resolve,reject)=>loader.load(url, resolve, undefined, reject));
    const obj = gltf.scene || gltf.scenes[0];
    const picked = collectBundleParts(obj);
    if(picked.length === 0){
      updatePartsStatus(`整包「${file.name}」內找不到可對應的部位節點。節點名需含 head/neck/torso/upper_arm_l…(或 PART2_ 前綴)。`);
      return false;
    }
    applySocketLocalRig(gltf);
    let ok=0, fails=[];
    for(const {node, slot} of picked){
      try{ node.name='PUNCH_PART_'+slot; attachPart(slot, node); ok++; }
      catch(err){ console.error('bundle attach failed:', slot, err); fails.push(slot); }
    }
    applyHipX();
    autoHideDummyOnBundle();
    const structural = PART_SLOT_DEFS.filter(d=>d.kind!=='equipment').map(d=>d.slot);
    const got = picked.map(p=>p.slot);
    const missing = structural.filter(s=>!got.includes(s));
    updatePartsStatus(
      `整包「${file.name}」→ 一次對應 ${ok} 個部位` +
      (fails.length ? `｜失敗:${fails.join(', ')}` : '') +
      (missing.length ? `｜整包未含:${missing.join(', ')}` : '｜結構部位齊全') +
      '。可用下方 slot 下拉 + scale/x/y/z/rot 微調對位。'
    );
    return ok>0;
  }catch(err){
    console.error(err); updatePartsStatus(`整包載入失敗:${file.name} — ${err.message||err}`); return false;
  }finally{
    URL.revokeObjectURL(url);
  }
}

async function loadPartFile(file){
  const slot = inferPartSlot(file.name);
  // 檔名對不到 slot 時不直接放棄:可能是合併部件包(內部子節點名對 slot),先載入再判斷
  if(!THREE.GLTFLoader){ updatePartsStatus('GLTFLoader 沒載入成功；請確認網路可連 CDN，或把 GLTFLoader.js 放到本機。'); return false; }
  const loader = new THREE.GLTFLoader();
  const url = URL.createObjectURL(file);
  try{
    const gltf = await new Promise((resolve,reject)=>loader.load(url, resolve, undefined, reject));
    const obj = gltf.scene || gltf.scenes[0];
    // 合併部件包偵測:深度遍歷整個 scene,有 ≥2 個節點名可對應 slot → 自動拆掛(支援巢狀)
    const mapped = collectBundleParts(obj).map(p=>({k:p.node, kslot:p.slot}));
    if(mapped.length >= 2){
      applySocketLocalRig(gltf);
      let okCount = 0, fails = [];
      for(const {k, kslot} of mapped){
        try{ k.name='PUNCH_PART_'+kslot; attachPart(kslot, k); okCount++; }
        catch(err){ console.error('bundle attach failed:', kslot, err); fails.push(kslot); }
      }
      applyHipX();
      autoHideDummyOnBundle();
      updatePartsStatus(`已從 ${file.name} 自動拆出 ${okCount} 個部位` + (fails.length ? `｜失敗：${fails.join(', ')}` : ''));
      return okCount > 0;
    }
    if(!slot){
      updatePartsStatus(`無法判斷 ${file.name} 要掛到哪個 slot（檔名對不到、內部節點名也對不到）；檔名或節點名需含部位關鍵字，如 hand_l / left_hand / HAND_L / torso / upper_arm_r（大小寫與 _ - 空格皆可）。`);
      return false;
    }
    obj.name = 'PUNCH_PART_'+slot;
    attachPart(slot, obj);
    updatePartsStatus(`已載入 ${file.name} → ${slot}`);
    return true;
  }catch(err){
    console.error(err); updatePartsStatus(`載入失敗：${file.name} — ${err.message||err}`); return false;
  }finally{
    URL.revokeObjectURL(url);
  }
}
async function loadPartFiles(files){
  let ok=0;
  for(const f of Array.from(files||[])){ if(await loadPartFile(f)) ok++; }
  updatePartsStatus(ok ? `載入完成：${ok} 個部位。可用下方 scale/x/y/z/rot 微調對位。` : undefined);
}
// 裝備載入(通用):不靠檔名對應,直接把整個 GLB 掛到「目前選定的 slot」(如 headgear)。
// 供任意單網格道具(火帽等)——選 slot → 載入 → 用校準滑桿眼睛喬 → 匯出對位 JSON(= EQUIP_CAL)。
window.__PS_EQUIP_TARGET_SLOT = 'headgear';    // 預設頭戴;__ps 測試/UI 可覆寫
async function loadEquipFile(file){
  if(!THREE.GLTFLoader){ updatePartsStatus('GLTFLoader 未載入(需連 CDN)。'); return false; }
  const sel = document.getElementById('partSlotSelect');
  const slot = (sel && sel.value) || window.__PS_EQUIP_TARGET_SLOT;
  if(!getPartTarget(slot)){ updatePartsStatus(`slot「${slot}」在目前 rig 沒有掛點,無法掛裝備。`); return false; }
  const loader = new THREE.GLTFLoader();
  const url = URL.createObjectURL(file);
  try{
    const gltf = await new Promise((res,rej)=>loader.load(url,res,undefined,rej));
    const obj = gltf.scene || gltf.scenes[0];
    obj.name = 'PUNCH_EQUIP_'+slot;
    attachPart(slot, obj);
    updatePartsStatus(`已載入裝備 ${file.name} → ${slot}。用下方 scale/x/y/z/rot 校準對位,再「匯出對位 JSON」(= 遊戲的 EQUIP_CAL)。`);
    return true;
  }catch(err){ console.error(err); updatePartsStatus(`裝備載入失敗:${file.name} — ${err.message||err}`); return false; }
  finally{ URL.revokeObjectURL(url); }
}
// ===== Rigged 手(chibi-hands-rigged.glb):自動拆左右掛手腕 + 手勢庫(GetAmped 式預設姿勢+插值的編輯端)=====
// rig 事實(解析自 GLB):骨鏈 Hand→Fingers→FingerMid→FingerTips(+Thumb),手指沿骨局部 +Y 生長,
// 彎曲軸=骨局部 X(rest 已帶 -2.4° 自然微彎,左右同號 → 同一組角度兩手對稱)。剛性分段(無蒙皮),轉骨即彎。
let HAND_RIG = null;   // { L:{fingers,mid,tips,thumb}, R:{...} } 各=THREE.Object3D;rest 四元數存在 userData.restQ
let HAND_POSE = { fingers:0, mid:0, tips:0, thumb:0 };  // 目前滑桿角度(度;負=往掌心彎)
// 預設庫(起始值,使用者滑桿調完可覆寫進 preset 再匯出)
const HAND_POSE_PRESETS = {
  open: { fingers: 0,   mid: 0,   tips: 0,   thumb: 0 },
  grip: { fingers: -50, mid: -70, tips: -40, thumb: -40 },
  fist: { fingers: -80, mid: -95, tips: -70, thumb: -55 },
};
const HAND_BONE_KEYS = { fingers:'Fingers', mid:'FingerMid', tips:'FingerTips', thumb:'Thumb' };
function collectHandRig(handNode, side){
  const out = {};
  handNode.traverse(o=>{
    for(const [k, base] of Object.entries(HAND_BONE_KEYS)){
      if(o.name === base + side){ o.userData.restQ = o.quaternion.clone(); out[k] = o; }
    }
  });
  return out;
}
function applyHandPose(){
  if(!HAND_RIG) return;
  const AX = new THREE.Vector3(1,0,0);
  for(const side of ['L','R']){
    const rig = HAND_RIG[side]; if(!rig) continue;
    for(const [k, bone] of Object.entries(rig)){
      if(!bone || !bone.userData.restQ) continue;
      bone.quaternion.copy(bone.userData.restQ)
        .multiply(new THREE.Quaternion().setFromAxisAngle(AX, (Number(HAND_POSE[k])||0)*D2R));
    }
  }
}
function setHandPose(p){ Object.assign(HAND_POSE, p||{}); applyHandPose(); syncHandPoseUI(); }
function syncHandPoseUI(){
  [['handFingers','fingers'],['handMid','mid'],['handTips','tips'],['handThumb','thumb']].forEach(([id,k])=>{
    const r=document.getElementById(id), n=document.getElementById(id+'Num');
    if(r) r.value=HAND_POSE[k]; if(n) n.value=HAND_POSE[k];
  });
}
// 預設對位(從 rig 事實推導):手指沿節點空間 +X(L)/−X(R),假人拳頭沿手腕 −Y、大小 ≈0.42×DIM.fist
// → 預設 rz=∓90° 把指向轉到 −Y、scale≈0.55 使手長 ≈ 拳頭盒。只在該 slot 的 cfg 還是出廠值時套用(不蓋使用者調過的)。
const HAND_DEFAULT_CAL = { L:{ x:0,y:0,z:0, rx:0, ry:0, rz:-90, s:0.55 }, R:{ x:0,y:0,z:0, rx:0, ry:0, rz:90, s:0.55 } };
// 「使用者沒調過」= cfg 仍等於該 slot 的出廠值(hand slot 出廠值帶 rx:180,不是 identity,不能用零值判斷)
function cfgUntouched(slot, c){
  const d = partDefaultConfig(slot);
  return ['x','y','z','rx','ry','rz','s'].every(k=>Number(c[k])===Number(d[k]));
}
function mountRiggedHands(gltf){
  const scene = gltf.scene || gltf.scenes[0];
  // GLTFLoader 名稱淨化:Hand.L → HandL(同 actor-hands 的既知行為)
  let hl=null, hr=null;
  scene.traverse(o=>{ if(o.name==='HandL') hl=o; else if(o.name==='HandR') hr=o; });
  if(!hl || !hr) throw new Error('GLB 內找不到 HandL/HandR 節點');
  HAND_RIG = {};
  for(const [node, side, slot] of [[hl,'L','hand_l'],[hr,'R','hand_r']]){
    const wrap = new THREE.Group(); wrap.name='PUNCH_RIGGEDHAND_'+side;
    node.position.set(0,0,0);        // 去掉 rig 內左右並排的偏移(rest 旋轉保留;attachPart 的 cfg 動 wrap 不動它)
    wrap.add(node);
    HAND_RIG[side] = collectHandRig(node, side);
    const c = partCfg(slot);
    if(cfgUntouched(slot, c)) Object.assign(c, HAND_DEFAULT_CAL[side]); // 起始對位:整組覆寫(手指轉向 −Y、縮到拳頭大小);使用者調過則保留
    attachPart(slot, wrap);
    savePartConfig();
  }
  // 調手台:手掛在「假人」手腕上 → 假人=對位載體,必須看得到;基底角色同場只會擋視線 → 暫時隱藏
  if(typeof AVATAR !== 'undefined' && AVATAR && AVATAR.wrap) AVATAR.wrap.visible = false;
  PARTS_HIDE_DUMMY = false;
  setSyntheticDummyVisible(true);   // 內含 rigged 手期間抑制假人拳頭盒(box 手不再同框)
  applyHandPose();
  applyHandShow(); // 重載時保持目前的雙手/單手顯示模式
  updatePartsStatus('已載入 rigged 手 → hand_l / hand_r(假人拳頭盒已隱藏;基底角色暫時隱藏)。選 HAND_L/HAND_R 用滑桿微調對位;手勢用 ✋✊👊+滑桿;調好「匯出手勢 JSON」。');
}
async function loadRiggedHandsFile(file){
  if(!THREE.GLTFLoader){ updatePartsStatus('GLTFLoader 未載入(需連 CDN)。'); return false; }
  const url = URL.createObjectURL(file);
  try{
    const gltf = await new Promise((res,rej)=>new THREE.GLTFLoader().load(url,res,undefined,rej));
    mountRiggedHands(gltf); return true;
  }catch(err){ console.error(err); updatePartsStatus('rigged 手載入失敗:'+(err.message||err)); return false; }
  finally{ URL.revokeObjectURL(url); }
}
// 內建一鍵載入(repo 內 assets/rigs/chibi-hands-rigged.glb;比照 avatar.js 的 base-avatar fetch 套路,
// HTTP 服務下直接成功;file:// 開啟時 fetch 失敗 → 提示改用檔案選擇器)
async function loadRiggedHandsBuiltin(){
  try{
    const r = await fetch('../assets/rigs/chibi-hands-rigged.glb');
    if(!r.ok) throw new Error('HTTP '+r.status);
    const ab = await r.arrayBuffer();
    await new Promise((res,rej)=>new THREE.GLTFLoader().parse(ab, '', (g)=>{ try{ mountRiggedHands(g); res(); }catch(e){ rej(e); } }, rej));
    return true;
  }catch(err){
    console.warn('builtin hands load failed', err);
    updatePartsStatus('內建 rigged 手載入失敗(file:// 開啟時請改用「🖐 選檔載入」選 assets/rigs/chibi-hands-rigged.glb)。');
    return false;
  }
}
// 顯示切換:雙手 → 只左 → 只右(調單手手勢/對位時不被另一手擋視線)
let HAND_SHOW = 'both';
function applyHandShow(){
  const l = PART_MODELS.hand_l, r = PART_MODELS.hand_r;
  if(l) l.visible = (HAND_SHOW !== 'R');
  if(r) r.visible = (HAND_SHOW !== 'L');
  const btn = document.getElementById('handShowToggle');
  if(btn) btn.textContent = HAND_SHOW === 'both' ? '顯示:雙手' : HAND_SHOW === 'L' ? '顯示:只左手' : '顯示:只右手';
}
function cycleHandShow(){ HAND_SHOW = HAND_SHOW === 'both' ? 'L' : HAND_SHOW === 'L' ? 'R' : 'both'; applyHandShow(); }
function exportHandPoses(){
  // 匯出目前三個 preset(open 固定歸零;grip/fist 以「目前滑桿」覆寫使用者正在調的那組?
  // 規則:按過 preset 鈕後滑桿=該 preset;匯出時把目前滑桿寫回「最後按的 preset」,再輸出全部)
  if(HAND_LAST_PRESET && HAND_POSE_PRESETS[HAND_LAST_PRESET]) Object.assign(HAND_POSE_PRESETS[HAND_LAST_PRESET], HAND_POSE);
  const payload = { fmt:'HAND_POSES v1', axis:'bone-local X (deg, negative curls inward)', presets: HAND_POSE_PRESETS };
  const text = JSON.stringify(payload, null, 2);
  try{ navigator.clipboard && navigator.clipboard.writeText(text); }catch(e){}
  console.log('[hand poses]', text);
  updatePartsStatus('手勢 JSON 已複製到剪貼簿(也印在 console)。貼給遊戲端當 HAND_POSES。');
  return payload;
}
let HAND_LAST_PRESET = null;

// headless 健檢 hook(比照 __v2/__mpe;獨立命名空間,避免被 game-bridge 的 window.__ps 覆寫)。
window.__psEquip = {
  slots: ()=>PART_SLOT_DEFS.map(d=>d.slot),
  partInfo: (slot)=>{ const o=PART_MODELS[slot]; if(!o) return null; return { slot, mounted:true, onHeadPivot:o.parent===headPivot, cfg:partCfg(slot) }; },
  loadEquipBuffer: (ab, slot='headgear')=> new Promise((resolve,reject)=>{
    if(!THREE.GLTFLoader) return reject(new Error('no GLTFLoader'));
    const s=document.getElementById('partSlotSelect'); if(s) s.value=slot;
    new THREE.GLTFLoader().parse(ab, '', (gltf)=>{ const obj=gltf.scene||gltf.scenes[0]; obj.name='PUNCH_EQUIP_'+slot; try{ attachPart(slot,obj); resolve(true); }catch(e){ reject(e); } }, reject);
  }),
  loadHandsBuffer: (ab)=> new Promise((resolve,reject)=>{
    if(!THREE.GLTFLoader) return reject(new Error('no GLTFLoader'));
    new THREE.GLTFLoader().parse(ab, '', (gltf)=>{ try{ mountRiggedHands(gltf); resolve(true); }catch(e){ reject(e); } }, reject);
  }),
  setHandPose: (p)=>{ setHandPose(p); return HAND_POSE; },
  loadHandsBuiltin: loadRiggedHandsBuiltin,
  setHandShow: (m)=>{ HAND_SHOW = m; applyHandShow(); return { show: HAND_SHOW, lVis: PART_MODELS.hand_l ? PART_MODELS.hand_l.visible : null, rVis: PART_MODELS.hand_r ? PART_MODELS.hand_r.visible : null }; },
  handInfo: ()=>{
    if(!HAND_RIG) return null;
    const info = {};
    for(const side of ['L','R']){
      const rig=HAND_RIG[side]; if(!rig) continue;
      const wrap = PART_MODELS[side==='L'?'hand_l':'hand_r'];
      info[side] = { mounted: !!(wrap && wrap.parent), bones: Object.keys(rig),
        midQuatX: rig.mid ? +rig.mid.quaternion.x.toFixed(4) : null };
    }
    return info;
  },
  exportHandPoses,
};
function buildPartSlotUI(){
  const sel=document.getElementById('partSlotSelect'); if(!sel) return;
  sel.innerHTML='';
  PART_SLOT_DEFS.forEach(d=>{ const opt=document.createElement('option'); opt.value=d.slot; opt.textContent=d.label; sel.appendChild(opt); });
  const syncPair=(rangeId,numId,key)=>{
    const r=document.getElementById(rangeId), n=document.getElementById(numId); if(!r||!n) return;
    const write=(val)=>{ const slot=sel.value; const c=partCfg(slot); c[key]=Number(val)||0; if(key==='s' && c[key]<=0) c[key]=0.01; r.value=c[key]; n.value=c[key]; applyPartConfig(slot); savePartConfig(); };
    r.addEventListener('input',e=>write(e.target.value));
    n.addEventListener('input',e=>write(e.target.value));
  };
  syncPair('partScale','partScaleNum','s');
  syncPair('partX','partXNum','x'); syncPair('partY','partYNum','y'); syncPair('partZ','partZNum','z');
  syncPair('partRX','partRXNum','rx'); syncPair('partRY','partRYNum','ry'); syncPair('partRZ','partRZNum','rz');
  function refresh(){
    const c=partCfg(sel.value);
    [['partScale','partScaleNum','s'],['partX','partXNum','x'],['partY','partYNum','y'],['partZ','partZNum','z'],['partRX','partRXNum','rx'],['partRY','partRYNum','ry'],['partRZ','partRZNum','rz']].forEach(([rId,nId,k])=>{
      const r=document.getElementById(rId), n=document.getElementById(nId); if(r)r.value=c[k]; if(n)n.value=c[k];
    });
  }
  sel.addEventListener('change',refresh);
  refresh();
  document.getElementById('partsBundle')?.addEventListener('change',e=>{
    const f = e.target.files && e.target.files[0];
    if(f) loadPartBundle(f);
    e.target.value='';   // 允許同一檔重新上傳再次觸發
  });
  document.getElementById('partsFiles')?.addEventListener('change',e=>loadPartFiles(e.target.files));
  document.getElementById('partsEquip')?.addEventListener('change',e=>{ const f=e.target.files&&e.target.files[0]; if(f) loadEquipFile(f); e.target.value=''; }); // 裝備→選定 slot
  document.getElementById('partsHandsRig')?.addEventListener('change',e=>{ const f=e.target.files&&e.target.files[0]; if(f) loadRiggedHandsFile(f); e.target.value=''; }); // rigged 手→自動拆左右
  document.getElementById('handsBuiltin')?.addEventListener('click',()=>loadRiggedHandsBuiltin()); // 內建一鍵載入
  document.getElementById('handShowToggle')?.addEventListener('click',()=>cycleHandShow());        // 雙手/左/右 顯示切換
  // 手勢滑桿(骨局部 X 角度;負=往掌心彎)+ 預設鈕 + 匯出
  [['handFingers','fingers'],['handMid','mid'],['handTips','tips'],['handThumb','thumb']].forEach(([id,k])=>{
    const r=document.getElementById(id), n=document.getElementById(id+'Num'); if(!r||!n) return;
    const write=(val)=>{ HAND_POSE[k]=Number(val)||0; r.value=HAND_POSE[k]; n.value=HAND_POSE[k]; applyHandPose(); };
    r.addEventListener('input',e=>write(e.target.value));
    n.addEventListener('input',e=>write(e.target.value));
  });
  document.querySelectorAll('[data-handpose]').forEach(btn=>btn.addEventListener('click',()=>{
    const name=btn.dataset.handpose; HAND_LAST_PRESET=name;
    setHandPose(Object.assign({}, HAND_POSE_PRESETS[name]));
  }));
  document.getElementById('handPoseExport')?.addEventListener('click',()=>exportHandPoses());
  document.getElementById('partsClear')?.addEventListener('click',()=>clearParts());
  document.getElementById('partsDummyToggle')?.addEventListener('click',()=>{
    PARTS_HIDE_DUMMY=!PARTS_HIDE_DUMMY;
    try{ localStorage.setItem(PART_HIDE_STORAGE_KEY, PARTS_HIDE_DUMMY?'1':'0'); }catch(e){}
    setSyntheticDummyVisible(!PARTS_HIDE_DUMMY);
    const b=document.getElementById('partsDummyToggle'); if(b) b.textContent=PARTS_HIDE_DUMMY?'顯示假人':'隱藏假人';
  });
  document.getElementById('partInspectTpose')?.addEventListener('click',()=>{
    PART_INSPECT_TPOSE=!PART_INSPECT_TPOSE;
    applyInspectOrPhase();
    const b=document.getElementById('partInspectTpose'); if(b) b.textContent=PART_INSPECT_TPOSE?'結束檢視':'組裝檢視 T-pose';
  });
  document.getElementById('partResetSlot')?.addEventListener('click',()=>{
    PART_CONFIG[sel.value]=partDefaultConfig(sel.value); refresh(); applyPartConfig(sel.value); savePartConfig();
  });
  document.getElementById('partExportCfg')?.addEventListener('click',()=>{
    const out = JSON.stringify({createdBy:'PUNCH STUDIO part kit', config:PART_CONFIG, loaded:Object.keys(PART_MODELS)}, null, 2);
    const modal=document.getElementById('modal'), text=document.getElementById('modalText'), help=document.getElementById('modalHelp');
    if(help) help.textContent='保存這份 JSON 可記錄每個部位的 x/y/z/rotation/scale 對位參數。';
    if(text) text.value=out;
    if(modal) modal.classList.add('show');
  });
  const b=document.getElementById('partsDummyToggle'); if(b) b.textContent=PARTS_HIDE_DUMMY?'顯示假人':'隱藏假人';
}
loadPartConfig();
buildPartSlotUI();
setSyntheticDummyVisible(!PARTS_HIDE_DUMMY);
updatePartsStatus();


requestAnimationFrame(tick);

// 開機自動載入(基底角色優先 → Meshy 部位人偶退路)移到 avatar.js 統一調度。
