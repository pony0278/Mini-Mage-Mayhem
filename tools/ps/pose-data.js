// @ts-check
// punch-studio — pose-data:姿勢資料模型:POSE_KEYS 51 軸、presets、時間軸(SEQ)模型、滑桿定義
// 古典 script(非 module):所有 ps/*.js 共享同一個全域作用域,載入順序由 punch-studio.html 決定(見 ps/README.md)。
// 型別安全:此檔開了 `// @ts-check`(零建構,型別純 JSDoc 註解、程式碼照跑;jsconfig.json 提供設定)。
//   Pose/snapshot 的形狀在這裡定義一次,編輯器就會抓錯軸名以外的形狀錯誤(值非數字、缺欄位、frame 打錯…)。
/** @typedef {'out'|'in'|'lin'} Ease 緩動:out=快進慢出 / in=慢進快出 / lin=線性 */
/** @typedef {Record<string, number>} Pose 一個姿勢:軸名 → 值(度/比例/位置);軸名見 POSE_KEYS(51 軸) */
/** @typedef {Record<string, Pose>} Phases phase 名(idle/anti/strike/…) → Pose */
/** @typedef {{aL:number, aR:number, lL:number, lR:number}} Lags 四肢跟隨延遲(0..1;impact 段自動歸零) */
/**
 * @typedef {Object} TimelineKey 時間軸的一個 key(repairTimeline 正規化後的形狀)
 * @property {string} name key 名(SEQ[0] 恆為 'idle')
 * @property {number} [frame] 絕對影格(@60fps;idle=0;normalize 後必有)
 * @property {number} frames 段長=「前一 key → 此 key」的過渡影格數
 * @property {string} [ease] 'out' | 'in' | 'lin'
 * @property {boolean} [impact] 命中段(此段無 lag + 紅框 + 命中放大)
 * @property {boolean} [cancel] 可取消接段點
 * @property {string} [tag] 語意標籤(idle/anti/strike/impact/follow/recover/custom)
 * @property {number} [returnFrames] 僅 idle:播完最後一 key 收尾回 idle 的時長
 */
/** @typedef {{seq:TimelineKey[], phases:Phases, lags:Lags}} Snapshot 匯出/匯入的動作快照 */
const D2R = Math.PI/180;
const REF_FPS = 60;

// ===== Pose data model =====
// 47 軸 / phase(根 7 + 脊椎 3 + 頭 3 + 雙手 16:含腕 wx/wy + 雙腿 18:含接觸鎖 + 腳尖朝向)
// scale 軸:1=原大小、>1=放大(GetAmped 風攻擊命中放大)、<1=縮小(攻擊時身體縮)
const POSE_KEYS = [
  'root_y','root_x','root_py','root_pz','sq','body_scale','squat',
  'spine_x','spine_y','pelvis_y',
  'head_y','head_x','head_pz',
  'aL_sx','aL_sy','aL_sz','aL_ex','aL_idle','aL_scale',
  'aR_sx','aR_sy','aR_sz','aR_ex','aR_idle','aR_scale',
  'lL_hx','lL_hy','lL_hz','lL_kx','lL_ax','lL_idle','lL_scale',
  'lR_hx','lR_hy','lR_hz','lR_kx','lR_ax','lR_idle','lR_scale',
  'lL_contact','lR_contact',  // 腳掌接觸鎖:0=平踩 1=墊腳(抬跟) 2=抬起(離地,不當地面錨點)
  'aL_wx','aL_wy','aR_wx','aR_wy',   // 腕關節:wx 屈伸 / wy 沿前臂軸扭轉(旋前旋後)
  'lL_ty','lR_ty',                   // 腳尖朝向(踝 Y;×side,正=外八)— 可獨立於髖瞄準腳尖
  'aL_stretch','aR_stretch','lL_stretch','lR_stretch'   // 整肢從近端關節等比伸展(1=原長;遠鏡頭下伸手更明顯)
];
/** @param {string} k 軸名 @returns {number} 該軸的預設值(scale/stretch=1,其餘=0) */
function defaultPoseValue(k){
  // 所有 scale / stretch 類型預設必須是 1；重置/匯入/匯出都走這個函式，避免資料變 0。
  if(k === 'body_scale' || k.endsWith('_scale') || k.endsWith('_stretch')) return 1;
  return 0;
}
/** @param {Record<string, any>} [p] 部分姿勢(缺的軸補預設) @returns {Pose} 補滿 51 軸的姿勢 */
function normalizePose(p={}){
  /** @type {Pose} */
  const out = {};
  POSE_KEYS.forEach(k=>{ out[k] = (p[k] !== undefined && isFinite(p[k])) ? Number(p[k]) : defaultPoseValue(k); });
  return out;
}
const ZERO_POSE = Object.fromEntries(POSE_KEYS.map(k=>[k, defaultPoseValue(k)]));

// 滑稽戰鬥站姿:idle 不是直立,而是半蹲、屈膝、手肘彎、含胸、微不對稱
// (不含 O 型腿 — 那需要新增髖 Z 軸自由度,先保留)
const GOOFY_IDLE = {
  root_py:0, root_x:0, root_pz:0, root_y:0, sq:0, body_scale:1, squat:45,
  spine_x:0, spine_y:0,
  head_y:23, head_x:6, head_pz:0,
  aL_sx:-12, aL_sy:0, aL_ex:40,
  aR_sx:-12, aR_sy:6, aR_ex:40,
  lL_hx:-31, lL_hy:5, lL_hz:20, lL_kx:40, lL_ax:0,   // 定稿:最佳化半蹲 idle(含 squat 45)
  lR_hx:-31, lR_hy:5, lR_hz:20, lR_kx:40, lR_ax:0
};

// 預設動作 — 啟動時用 cross,user 可隨時重置/換
const PRESETS = {
  blank: {
    idle: {...ZERO_POSE},
    anti: {...ZERO_POSE},
    strike: {...ZERO_POSE},
    impact: {...ZERO_POSE},
    recovery: {...ZERO_POSE}
  },
  cross: { // 後手直拳 — 右手出,軀幹側轉,右腿驅動
    idle:    {...ZERO_POSE},
    anti:    {root_y:-18, root_x:-2, root_py:0, root_pz:-0.04, sq:0.10,
              aL_sx:-90, aL_sy:-15, aL_ex:80,
              aR_sx:-60, aR_sy:25, aR_ex:120,
              lL_hx:-12, lL_kx:18, lR_hx:14, lR_kx:38},
    strike:  {root_y:30, root_x:4, root_py:0, root_pz:0.22, sq:-0.18,
              aL_sx:-70, aL_sy:-10, aL_ex:85,
              aR_sx:-100, aR_sy:5, aR_ex:5,
              lL_hx:-8, lL_kx:8, lR_hx:18, lR_kx:6},
    impact:  {root_y:34, root_x:5, root_py:0, root_pz:0.24, sq:-0.20,
              aL_sx:-70, aL_sy:-10, aL_ex:85,
              aR_sx:-108, aR_sy:5, aR_ex:0,
              lL_hx:-8, lL_kx:8, lR_hx:18, lR_kx:4},
    recovery:{...ZERO_POSE}
  },
  hookl: {
    idle:    {...ZERO_POSE},
    anti:    {root_y:-20, root_x:-2, root_py:0, root_pz:-0.03, sq:0.12,
              aL_sx:-95, aL_sy:-40, aL_ex:90,
              aR_sx:-95, aR_sy:25, aR_ex:90,
              lL_hx:-14, lL_kx:38, lR_hx:12, lR_kx:22},
    strike:  {root_y:35, root_x:3, root_py:0, root_pz:0.18, sq:-0.18,
              aL_sx:-95, aL_sy:35, aL_ex:75,
              aR_sx:-90, aR_sy:15, aR_ex:90,
              lL_hx:-8, lL_kx:10, lR_hx:14, lR_kx:30},
    impact:  {root_y:42, root_x:3, root_py:0, root_pz:0.20, sq:-0.22,
              aL_sx:-100, aL_sy:45, aL_ex:70,
              aR_sx:-90, aR_sy:15, aR_ex:90,
              lL_hx:-8, lL_kx:8, lR_hx:14, lR_kx:30},
    recovery:{...ZERO_POSE}
  },
  hookr: {
    idle:    {...ZERO_POSE},
    anti:    {root_y:20, root_x:-2, root_py:0, root_pz:-0.03, sq:0.12,
              aL_sx:-95, aL_sy:-15, aL_ex:90,
              aR_sx:-95, aR_sy:40, aR_ex:90,
              lL_hx:-12, lL_kx:22, lR_hx:14, lR_kx:38},
    strike:  {root_y:-35, root_x:3, root_py:0, root_pz:0.20, sq:-0.18,
              aL_sx:-90, aL_sy:-15, aL_ex:90,
              aR_sx:-95, aR_sy:-35, aR_ex:75,
              lL_hx:-12, lL_kx:30, lR_hx:18, lR_kx:8},
    impact:  {root_y:-42, root_x:3, root_py:0, root_pz:0.22, sq:-0.22,
              aL_sx:-90, aL_sy:-15, aL_ex:90,
              aR_sx:-100, aR_sy:-45, aR_ex:70,
              lL_hx:-12, lL_kx:30, lR_hx:18, lR_kx:6},
    recovery:{...ZERO_POSE}
  },
  upper: {
    idle:    {...ZERO_POSE},
    anti:    {root_y:15, root_x:-6, root_py:-0.20, root_pz:-0.05, sq:0.22,
              aL_sx:-90, aL_sy:-15, aL_ex:95,
              aR_sx:-30, aR_sy:10, aR_ex:105,
              lL_hx:-14, lL_kx:42, lR_hx:14, lR_kx:55},
    strike:  {root_y:-12, root_x:8, root_py:0.10, root_pz:0.15, sq:-0.20,
              aL_sx:-85, aL_sy:-10, aL_ex:90,
              aR_sx:-140, aR_sy:5, aR_ex:75,
              lL_hx:-6, lL_kx:8, lR_hx:8, lR_kx:8},
    impact:  {root_y:-14, root_x:10, root_py:0.14, root_pz:0.18, sq:-0.24,
              aL_sx:-85, aL_sy:-10, aL_ex:90,
              aR_sx:-150, aR_sy:5, aR_ex:70,
              lL_hx:-6, lL_kx:8, lR_hx:8, lR_kx:6},
    recovery:{...ZERO_POSE}
  },
  jab: { // 前手刺拳 — 左手快速出,小幅動作
    idle:    {...ZERO_POSE},
    anti:    {root_y:8, root_x:-1, root_py:0, root_pz:-0.02, sq:0.06,
              aL_sx:-70, aL_sy:-20, aL_ex:100,
              aR_sx:-95, aR_sy:20, aR_ex:90,
              lL_hx:-12, lL_kx:22, lR_hx:14, lR_kx:34},
    strike:  {root_y:-12, root_x:2, root_py:0, root_pz:0.16, sq:-0.10,
              aL_sx:-100, aL_sy:0, aL_ex:5,
              aR_sx:-95, aR_sy:20, aR_ex:90,
              lL_hx:-8, lL_kx:14, lR_hx:18, lR_kx:24},
    impact:  {root_y:-15, root_x:3, root_py:0, root_pz:0.18, sq:-0.12,
              aL_sx:-108, aL_sy:0, aL_ex:0,
              aR_sx:-95, aR_sy:20, aR_ex:90,
              lL_hx:-8, lL_kx:14, lR_hx:18, lR_kx:22},
    recovery:{...ZERO_POSE}
  },
  punch_l: { // 左拳(誇張 GetAmped 風)— 巨拳 overshoot + 旋身收招。
             // 依分鏡逐格;★ 角度為「起點值」,2D 讀不出的 twist/景深載入後拖 slider 微調。
    idle:    {...ZERO_POSE}, // 強制 = GOOFY_IDLE
    // ANTI(图10–11 深蹲上膛):左拳拉到極後+大折肘,軀幹反向蓄力,左腿負載較深
    anti:    {root_y:20, root_x:-3, root_py:0, root_pz:-0.07, sq:0.14, squat:54,
              spine_y:10, head_y:18, head_x:8,
              aL_sx:-62, aL_sy:-28, aL_ex:128,    // ★左拳深拉、肘大折(蓄力)
              aR_sx:-95, aR_sy:22, aR_ex:95,      // 右手護臉
              lL_hx:-18, lL_kx:50, lR_hx:12, lR_kx:24},
    // STRIKE(图12 巨拳前撲):左臂全伸直 + aL_scale 巨拳,軀幹旋轉甩出,弓步前撲
    strike:  {root_y:-30, root_x:6, root_py:0, root_pz:0.36, sq:-0.18,
              spine_y:-12, head_y:10, head_x:4,
              aL_sx:-105, aL_sy:6, aL_ex:8, aL_scale:2.1,  // ★巨拳:scale 2.1
              aR_sx:-68, aR_sy:30, aR_ex:92,               // 右手後收平衡
              lL_hx:-6, lL_kx:10, lR_hx:22, lR_kx:14},
    // IMPACT(图12–13 峰值):scale/lunge 再頂一階,命中放大最高點
    impact:  {root_y:-34, root_x:8, root_py:0, root_pz:0.42, sq:-0.22,
              spine_y:-14, head_y:8, head_x:4,
              aL_sx:-110, aL_sy:6, aL_ex:4, aL_scale:2.4,  // ★巨拳峰值:scale 2.4
              aR_sx:-66, aR_sy:32, aR_ex:90,
              lL_hx:-4, lL_kx:8, lR_hx:24, lR_kx:10},
    // RECOVERY(图13–15 旋身風車):自訂收招(非站架)→ makePhasesFromPreset 會尊重它不覆寫。
    //   loop 回 idle 時自然把旋身收回站架。覺得轉太兇就把 root_y 往 0 拉。
    recovery:{root_y:-95, sq:0, squat:45, spine_y:-22, head_y:23, head_x:6,
              aL_sx:-42, aL_sy:55, aL_ex:62,    // 雙臂風車張開
              aR_sx:-42, aR_sy:-55, aR_ex:62,
              lL_hx:-28, lL_hy:5, lL_hz:20, lL_kx:42,
              lR_hx:-28, lR_hy:5, lR_hz:20, lR_kx:42}
  }
};
const DEFAULT_LAGS = {aL:0.0, aR:0.20, lL:0.0, lR:0.10};
// 時間軸:有序 key 列。SEQ[0]=idle(起點;它的 frames = 收尾回 idle 的時長)。
// 其後每個 key = 一段「前一 key → 此 key」的過渡:frames 段長、ease 緩動、impact 命中段(無 lag + 紅框 + 放大)。
/** @type {TimelineKey[]} */
const DEFAULT_SEQ = [
  {name:'idle',     frames:10, ease:'out', impact:false},
  {name:'anti',     frames:7,  ease:'out', impact:false},
  {name:'strike',   frames:3,  ease:'in',  impact:false},
  {name:'impact',   frames:4,  ease:'lin', impact:true },
  {name:'recovery', frames:12, ease:'out', impact:false},
];
const EASES = ['out','in','lin'];
const KEY_TAGS = ['idle','anti','strike','impact','follow','recover','custom'];
const DEFAULT_RETURN_FRAMES = 10;

/** @param {*} name @param {string} [fallback] @returns {string} 合法識別字(去非字元、避免數字開頭) */
function cleanKeyName(name, fallback='key'){
  let n = String(name || fallback).trim().replace(/[^\w]/g,'_');
  if(!n) n = fallback;
  if(/^\d/.test(n)) n = 'k_'+n;
  return n;
}
/** @param {string} base @returns {string} 在 SEQ 中不重複的 key 名 */
function uniqueKeyName(base){
  const root = cleanKeyName(base || 'key').replace(/_\d+$/,'');
  let name = root, n = 1;
  const used = new Set(SEQ.map(s=>s.name));
  while(used.has(name)) name = root + '_' + (++n);
  return name;
}
/** @param {string} name @param {boolean} [impact] @returns {string} 由 key 名/命中旗標推語意標籤 */
function tagFromName(name, impact){
  if(impact) return 'impact';
  const n=String(name||'').toLowerCase();
  if(n==='idle'||n.includes('guard')) return 'idle';
  if(n.includes('anti')||n.includes('wind')||n.includes('charge')) return 'anti';
  if(n.includes('strike')||n.includes('launch')) return 'strike';
  if(n.includes('follow')||n.includes('over')) return 'follow';
  if(n.includes('recover')) return 'recover';
  return 'custom';
}
function timelineReturnFrames(){
  /** @type {Partial<TimelineKey>} */
  const idle = SEQ && SEQ[0] ? SEQ[0] : {};
  return Math.max(1, Math.round(Number(idle.returnFrames ?? idle.frames ?? DEFAULT_RETURN_FRAMES)));
}
/** @param {any[]} seqIn 原始/部分時間軸 @returns {TimelineKey[]} 正規化後的時間軸(每 key 必有 frame) */
function repairTimeline(seqIn){
  /** @type {TimelineKey[]} */
  let raw = (Array.isArray(seqIn) && seqIn.length ? seqIn : DEFAULT_SEQ).map((k,i)=>({
    name: cleanKeyName(k.name || (i===0?'idle':`key_${i}`), i===0?'idle':`key_${i}`),
    frame: Number.isFinite(Number(k.frame)) ? Math.round(Number(k.frame)) : undefined,
    frames: Math.max(1, Math.round(Number(k.frames ?? (i===0?DEFAULT_RETURN_FRAMES:6)))),
    returnFrames: Number.isFinite(Number(k.returnFrames)) ? Math.max(1, Math.round(Number(k.returnFrames))) : undefined,
    ease: EASES.includes(k.ease) ? k.ease : (i===0?'out':'in'),
    impact: !!k.impact,
    cancel: !!k.cancel,
    tag: KEY_TAGS.includes(k.tag) ? k.tag : tagFromName(k.name, !!k.impact)
  }));
  const seen = new Set();
  raw.forEach(k=>{ let base=k.name, n=1; while(seen.has(k.name)){ k.name=base+'_'+(++n); } seen.add(k.name); });
  let idleIdx = raw.findIndex(k=>k.name==='idle');
  if(idleIdx < 0){ raw.unshift({name:'idle', frame:0, frames:DEFAULT_RETURN_FRAMES, returnFrames:DEFAULT_RETURN_FRAMES, ease:'out', impact:false, tag:'idle'}); idleIdx=0; }
  if(idleIdx !== 0){ const idle = raw.splice(idleIdx,1)[0]; raw.unshift(idle); }
  raw[0].name='idle'; raw[0].frame=0; raw[0].tag='idle'; raw[0].impact=false;
  const hasAbs = raw.slice(1).some(k=>Number.isFinite(Number(k.frame)));
  if(!hasAbs){
    let acc = 0;
    for(let i=1;i<raw.length;i++){ acc += Math.max(1, raw[i].frames || 6); raw[i].frame = acc; }
  } else {
    let acc = 0;
    for(let i=1;i<raw.length;i++){
      if(!Number.isFinite(Number(raw[i].frame))){ acc += Math.max(1, raw[i].frames || 6); raw[i].frame = acc; }
      else acc = Math.max(acc, raw[i].frame);
    }
    const rest = raw.slice(1).sort((a,b)=>a.frame-b.frame || a.name.localeCompare(b.name));
    raw = [raw[0], ...rest];
  }
  let prev = 0;
  for(let i=1;i<raw.length;i++){
    raw[i].frame = Math.max(prev+1, Math.round(raw[i].frame));
    raw[i].frames = raw[i].frame - prev;
    if(!KEY_TAGS.includes(raw[i].tag)) raw[i].tag = tagFromName(raw[i].name, raw[i].impact);
    prev = raw[i].frame;
  }
  raw[0].returnFrames = Math.max(1, raw[0].returnFrames ?? raw[0].frames ?? DEFAULT_RETURN_FRAMES);
  raw[0].frames = raw[0].returnFrames;
  return raw;
}
function normalizeTimelineInPlace(){
  const activeName = activePhase || (SEQ[activeIdx] && SEQ[activeIdx].name);
  SEQ = repairTimeline(SEQ);
  activeIdx = SEQ.findIndex(s=>s.name===activeName);
  if(activeIdx < 0) activeIdx = Math.min(1, SEQ.length-1);
  activePhase = SEQ[activeIdx].name;
}
function timelineLastFrame(){ normalizeTimelineInPlace(); return SEQ.length ? SEQ[SEQ.length-1].frame : 0; }
function totalTimelineFrames(){ return timelineLastFrame() + timelineReturnFrames(); }
function timelineDisplayMaxFrame(){
  const last = timelineLastFrame();
  const total = totalTimelineFrames();
  return Math.max(60, Math.ceil((Math.max(last + 20, total) || 60) / 10) * 10);
}
function isTimelineFrameFree(frame, excludeName){
  return !SEQ.some(k => k.name !== excludeName && Math.round(k.frame || 0) === frame);
}
function nearestFreeTimelineFrame(frame, excludeName, dir=1){
  frame = Math.max(1, Math.round(Number(frame) || 1));
  if(isTimelineFrameFree(frame, excludeName)) return frame;
  const firstDir = dir >= 0 ? 1 : -1;
  const secondDir = -firstDir;
  for(let d=1; d<2000; d++){
    const a = frame + firstDir * d;
    if(a >= 1 && isTimelineFrameFree(a, excludeName)) return a;
    const b = frame + secondDir * d;
    if(b >= 1 && isTimelineFrameFree(b, excludeName)) return b;
  }
  return frame;
}
function frameFromTimelineBar(clientX){
  const bar = document.getElementById('timelineBar');
  if(!bar) return 0;
  const rect = bar.getBoundingClientRect();
  const u = rect.width ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
  return Math.round(u * timelineDisplayMaxFrame());
}
function setKeyFrameByName(name, frame){
  normalizeTimelineInPlace();
  const s = SEQ.find(k=>k.name===name);
  if(!s || s.name==='idle') return;
  const oldFrame = Math.round(s.frame || 1);
  const desired = Math.max(1, Math.round(Number(frame)||1));
  const dir = desired >= oldFrame ? 1 : -1;
  s.frame = nearestFreeTimelineFrame(desired, name, dir);
  activePhase = name;
  normalizeTimelineInPlace();
}

// 把 preset 補滿 POSE_KEYS(舊 preset 缺新增的 idle/scale 欄位時自動補預設值)
/** @param {string} key preset 名(PRESETS 的鍵) @returns {Phases} 五個 phase(補滿 51 軸)的姿勢表 */
function makePhasesFromPreset(key){
  const preset = PRESETS[key];
  /** @type {Phases} */
  const out = {};
  ['idle','anti','strike','impact','recovery'].forEach(ph=>{
    out[ph] = {};
    POSE_KEYS.forEach(k=>{
      const defV = defaultPoseValue(k);
      out[ph][k] = (preset[ph] && preset[ph][k] !== undefined) ? preset[ph][k] : defV;
    });
    // idle 永遠 = 定稿站架(loop 基準,不可破壞)
    if(ph==='idle'){ Object.assign(out[ph], GOOFY_IDLE); }
    // recovery 解鎖:不再無條件覆寫成站架。
    //  - preset 提供「非全 0/1」的自訂 recovery → 尊重它(可把誇張旋身/收招 bake 進 preset)
    //  - 否則以戰鬥站架為預設起點,載入後可自由拖 slider 做誇張收招
    //    (blank 例外:保留全 0,供從零編輯)
    if(ph==='recovery'){
      const r = preset.recovery;
      const custom = r && Object.keys(r).some(k => r[k] !== 0 && r[k] !== 1);
      if(!custom && key !== 'blank'){ Object.assign(out[ph], GOOFY_IDLE); }
    }
  });
  return out;
}

// 啟動載入 cross 當例子
/** @type {Phases} */
let PHASES = makePhasesFromPreset('cross');
/** @type {TimelineKey[]} */
let SEQ = DEFAULT_SEQ.map(s=>({...s}));
/** @type {Lags} */
let LAGS = {...DEFAULT_LAGS};

let activeIdx = 1;        // 目前編輯第幾個 key(SEQ 索引)
let activePhase = 'idle'; // = SEQ[activeIdx].name(相容舊程式碼)
let playing = false;
let playT = 0;
let slowMo = 0.3;
let slowOn = true;
let loop = false;
let scrubActive = false, scrubPose = null;   // 時間軸 scrub(只讀凍結幀)

// ===== Slider definitions =====
const SLIDER_GROUPS = [
  {h:'軀幹 ROOT', cls:'', keys:[
    ['root_y', '軀幹 Y(twist/側轉)', -120, 120, 1, '°'],
    ['root_x', '軀幹 X(pitch/俯仰)', -30, 30, 1, '°'],
    ['root_py', '軀幹升降(jump/離地)', -0.5, 0.4, 0.01, 'u'],
    ['root_pz', '軀幹 Z 位置(lunge 前後)', -0.4, 0.6, 0.01, 'u'],
    ['sq', 'squash/stretch(壓/拉)', -0.4, 0.4, 0.01, ''],
    ['body_scale', '身體縮放(攻擊縮小)', 0.5, 1.5, 0.01, '×'],
    ['squat', '蹲下(整體屈膝下沉,自動踩地)', 0, 80, 1, '°']
  ]},
  {h:'頭部 HEAD', cls:'', keys:[
    ['head_y', '頭 Y(左右轉/看目標)', -90, 90, 1, '°'],
    ['head_x', '頭 X(俯仰/抬下巴)', -45, 45, 1, '°'],
    ['head_pz', '頭 Z 位置(前凸/縮)', -0.2, 0.5, 0.01, 'u']
  ]},
  {h:'脊椎 + 骨盆 SPINE / PELVIS(上下半身扭轉)', cls:'', keys:[
    ['spine_x', '脊椎 X(前傾／後仰;正=前傾駝背 · 負=後仰下腰/7字)', -80, 70, 1, '°'],
    ['spine_y', '脊椎 Y(上半身甩腰扭轉)', -90, 90, 1, '°'],
    ['pelvis_y', '骨盆 Y(下半身/後腳碾地轉,正=順 root_y 同向)', -90, 90, 1, '°']
  ]},
  {h:'左手 ARM L(前手)', cls:'arms', keys:[
    ['aL_sx', '肩 X(上下/前後)', -180, 60, 1, '°'],
    ['aL_sy', '肩 Y(左右橫掃)', -90, 90, 1, '°'],
    ['aL_sz', '肩 Z(外展/側平舉,正=往外)', -45, 170, 1, '°'],
    ['aL_ex', '肘(0=直 / 180=折)', -20, 160, 1, '°'],
    ['aL_idle', '→ IDLE 比例(1=強制垂下)', 0, 1, 0.01, ''],
    ['aL_scale', '前臂/拳頭縮放(命中放大)', 0.5, 2.5, 0.01, '×'],
    ['aL_stretch', '整條手臂伸展(從肩;遠鏡頭伸手更明顯)', 0.6, 2.2, 0.01, '×'],
    ['aL_wx', '腕 X(屈伸/勾腕)', -90, 90, 1, '°'],
    ['aL_wy', '腕 Y(扭轉/旋前旋後)', -90, 90, 1, '°']
  ]},
  {h:'右手 ARM R(後手)', cls:'arms', keys:[
    ['aR_sx', '肩 X(上下/前後)', -180, 60, 1, '°'],
    ['aR_sy', '肩 Y(左右橫掃)', -90, 90, 1, '°'],
    ['aR_sz', '肩 Z(外展/側平舉,正=往外)', -45, 170, 1, '°'],
    ['aR_ex', '肘(0=直 / 180=折)', -20, 160, 1, '°'],
    ['aR_idle', '→ IDLE 比例(1=強制垂下)', 0, 1, 0.01, ''],
    ['aR_scale', '前臂/拳頭縮放(命中放大)', 0.5, 2.5, 0.01, '×'],
    ['aR_stretch', '整條手臂伸展(從肩;遠鏡頭伸手更明顯)', 0.6, 2.2, 0.01, '×'],
    ['aR_wx', '腕 X(屈伸/勾腕)', -90, 90, 1, '°'],
    ['aR_wy', '腕 Y(扭轉/旋前旋後)', -90, 90, 1, '°']
  ]},
  {h:'左腿 LEG L(前腿)', cls:'legs', keys:[
    ['lL_hx', '髖 X(前後擺)', -60, 60, 1, '°'],
    ['lL_hy', '髖 Y(外旋/整條腿轉,正=外)', -150, 150, 1, '°'],
    ['lL_hz', '髖 Z(橫向張開/劈腿,正=往外)', -60, 120, 1, '°'],
    ['lL_kx', '膝(0=直 / 90=蹲)', -20, 90, 1, '°'],
    ['lL_ax', '腳踝微調(自動壓平外的額外)', -60, 60, 1, '°'],
    ['lL_idle', '→ IDLE 比例(1=強制直立)', 0, 1, 0.01, ''],
    ['lL_scale', '小腿/腳掌縮放(命中放大)', 0.5, 2.5, 0.01, '×'],
    ['lL_stretch', '整條腿伸展(從髖;拉長身形)', 0.6, 2.2, 0.01, '×'],
    ['lL_contact', '接觸鎖(0=平踩 1=墊腳 2=抬起)', 0, 2, 1, ''],
    ['lL_ty', '腳尖朝向(踝 Y,正=外八)', -120, 120, 1, '°']
  ]},
  {h:'右腿 LEG R(後腿)', cls:'legs', keys:[
    ['lR_hx', '髖 X(前後擺)', -60, 60, 1, '°'],
    ['lR_hy', '髖 Y(外旋/整條腿轉,正=外)', -150, 150, 1, '°'],
    ['lR_hz', '髖 Z(橫向張開/劈腿,正=往外)', -60, 120, 1, '°'],
    ['lR_kx', '膝(0=直 / 90=蹲)', -20, 90, 1, '°'],
    ['lR_ax', '腳踝微調(自動壓平外的額外)', -60, 60, 1, '°'],
    ['lR_idle', '→ IDLE 比例(1=強制直立)', 0, 1, 0.01, ''],
    ['lR_scale', '小腿/腳掌縮放(命中放大)', 0.5, 2.5, 0.01, '×'],
    ['lR_stretch', '整條腿伸展(從髖;拉長身形)', 0.6, 2.2, 0.01, '×'],
    ['lR_contact', '接觸鎖(0=平踩 1=墊腳 2=抬起)', 0, 2, 1, ''],
    ['lR_ty', '腳尖朝向(踝 Y,正=外八)', -120, 120, 1, '°']
  ]}
];

const TIMING_SLIDERS = [
  ['anti','ANTI 預備', 1, 30, 1],
  ['strike','STRIKE 出招', 1, 12, 1],
  ['impact','IMPACT 命中', 0, 12, 1],
  ['recovery','RECOVERY 收招', 1, 40, 1]
];
const LAG_SLIDERS = [
  ['aL','左手 lag(0=同步)'],
  ['aR','右手 lag'],
  ['lL','左腿 lag'],
  ['lR','右腿 lag']
];
