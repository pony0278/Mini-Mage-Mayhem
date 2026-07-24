// brawler-clips.js — v2 小人的動作資料 + 時間軸播放器(移植自使用者的 PUNCH STUDIO 動作編排器)。
// 工作流:在編排器裡編動作 → 「JSON」匯出 → 整份 snapshot 貼進下面的 CLIPS —— 改動作=貼資料,零程式碼。
// snapshot 格式(editor exportJson):{ seq:[{name,frame,frames,ease,impact,cancel}], phases:{name:{47軸}}, lags:{aL,aR,lL,lR} }
//   - seq[0] 必為 idle(frame 0;其 frames=收尾回 idle 的時長)
//   - 每個 key = 一段「前一 key → 此 key」的過渡:frame=絕對時間(60fps 影格)、ease=in/out/lin、
//     impact=命中段(此段 per-limb lag 歸零,四肢同步到位=打擊感)
//   - lags = per-limb 跟隨延遲(0..1,佔過渡比例)→ 天然的 follow-through
// 47 軸姿勢的語義見 applyBrawlerPose(actor-brawler.js);此檔只管「時間 → 姿勢」。

export const REF_FPS = 60;

export const POSE_KEYS = [
  'root_y', 'root_x', 'root_py', 'root_pz', 'sq', 'body_scale', 'squat',
  'spine_x', 'spine_y', 'pelvis_y',
  'head_y', 'head_x', 'head_pz',
  'aL_sx', 'aL_sy', 'aL_sz', 'aL_ex', 'aL_idle', 'aL_scale',
  'aR_sx', 'aR_sy', 'aR_sz', 'aR_ex', 'aR_idle', 'aR_scale',
  'lL_hx', 'lL_hy', 'lL_hz', 'lL_kx', 'lL_ax', 'lL_idle', 'lL_scale',
  'lR_hx', 'lR_hy', 'lR_hz', 'lR_kx', 'lR_ax', 'lR_idle', 'lR_scale',
  'lL_contact', 'lR_contact',
  'aL_wx', 'aL_wy', 'aR_wx', 'aR_wy',
  'aL_wz', 'aR_wz',   // 腕 Z 左右擺腕(尺橈偏;×side 正=往外,同肩 Z 慣例)— 2026-07-23 補軸,舊 clip 缺省=0
  'lL_ty', 'lR_ty',
  // rigged 手手指彎曲(逐關鍵格、左右獨立;骨局部 X 角度,負=往掌心捲)。與 punch-studio 同軸名,clip 直接帶。
  // 消費者:actor-hands-rigged.applyFingerPose(只在 ?avatar=1 且 rigged 手掛載時)。方塊人/舊 chibi 手無視這些軸。
  'aL_fbase', 'aL_fmid', 'aL_ftip', 'aL_fthumb',
  'aR_fbase', 'aR_fmid', 'aR_ftip', 'aR_fthumb',
  'aL_stretch', 'aR_stretch', 'lL_stretch', 'lR_stretch',   // 整肢從近端關節等比伸展(1=原長;遠鏡頭下伸手更明顯)
  // 被扛者旋轉/偏移(拎頭吊掛;非扛者骨軸,applyBrawlerPose 忽略)。render-actors 讀 clip 這幾軸,把被扛 actor
  // 貼到扛者手上+繞頭轉(pitch/yaw)+微調偏移。丟人 clip(person_throw)帶這些,一般 clip 全 0。
  'carry_tilt', 'carry_yaw', 'carry_ox', 'carry_oy', 'carry_oz',
];
export function defaultPoseValue(k) { return (k === 'body_scale' || k.endsWith('_scale') || k.endsWith('_stretch')) ? 1 : 0; }
export function normalizePose(p = {}) {
  const out = {};
  for (const k of POSE_KEYS) out[k] = (p[k] !== undefined && isFinite(p[k])) ? Number(p[k]) : defaultPoseValue(k);
  return out;
}

// 待機站姿(使用者 PUNCH STUDIO 定稿):放鬆直立、雙臂微外展(sz30)、直腿——所有動作的起點/終點。
// 待機呼吸(膝蓋微彎↔伸直)由 actor-brawler.js 的程序化 ANIM.breath 疊加,不寫在這個靜態姿勢裡。
export const COMBAT_IDLE = normalizePose({
  aL_sz: 30, aR_sz: 30,
});

const DEFAULT_LAGS = { aL: 0.0, aR: 0.20, lL: 0.0, lR: 0.10 };

function ease(p, m) { p = Math.max(0, Math.min(1, p)); if (m === 'in') return p * p; if (m === 'out') return 1 - (1 - p) * (1 - p); return p; }
function lerpPose(a, b, t, lags) { // 編排器同款:per-limb lag → 跟隨延遲;impact 段 lags 全 0
  const out = {};
  for (const k of POSE_KEYS) {
    let lag = 0;
    if (k.startsWith('aL_')) lag = lags.aL; else if (k.startsWith('aR_')) lag = lags.aR;
    else if (k.startsWith('lL_')) lag = lags.lL; else if (k.startsWith('lR_')) lag = lags.lR;
    const lt = lag > 0 ? Math.max(0, Math.min(1, (t - lag) / Math.max(1 - lag, 0.001))) : t;
    const dv = defaultPoseValue(k);
    const av = (a[k] !== undefined) ? a[k] : dv, bv = (b[k] !== undefined) ? b[k] : dv;
    out[k] = av + (bv - av) * lt;
  }
  return out;
}

// snapshot → 預編譯段落(一次做完,每幀只查表插值)
export function prepClip(snap) {
  const lags = { ...DEFAULT_LAGS, ...(snap.lags || {}) };
  const phases = {};
  for (const [n, p] of Object.entries(snap.phases || {})) phases[n] = normalizePose(n === 'idle' ? { ...COMBAT_IDLE, ...p } : p);
  if (!phases.idle) phases.idle = { ...COMBAT_IDLE };
  const seq = (snap.seq || []).map(k => ({ name: k.name, frame: k.frame || 0, ease: k.ease || 'in', impact: !!k.impact, tag: k.tag || null }));
  const segs = [];
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    segs.push({ from: a.name, to: b.name, start: a.frame, end: b.frame, ease: b.ease, impact: b.impact });
  }
  const last = seq[seq.length - 1];
  const rf = Math.max(1, Math.round((snap.seq && snap.seq[0] && (snap.seq[0].returnFrames ?? snap.seq[0].frames)) || 10));
  if (last && last.name !== 'idle') segs.push({ from: last.name, to: 'idle', start: last.frame, end: last.frame + rf, ease: 'out', impact: false });
  const dur = segs.length ? segs[segs.length - 1].end / REF_FPS : 0;
  // tags:判定時刻的單一真相——v2-state 的時序常數(STRIKE_DELAY/BARREL_THROW_DELAY/PERSON_HOLD_T/
  // PERSON_THROW_DELAY)由這裡導出。在 studio 移動 impact/release/hold 幀 → 重貼 JSON 即自動對齊,
  // 不再手動同步兩邊。tags=各 tag 第一次出現的秒數;tagsLast=最後一次(hold 缺席時退回最後一個 grab)。
  const tags = {}, tagsLast = {};
  for (const k of seq) if (k.tag) { if (!(k.tag in tags)) tags[k.tag] = k.frame / REF_FPS; tagsLast[k.tag] = k.frame / REF_FPS; }
  // impactT:第一個 impact key 的秒數(= STRIKE_DELAY 的來源;無 impact key 為 null)
  let impactT = null;
  for (const k of seq) if (k.impact) { impactT = k.frame / REF_FPS; break; }
  // lastKeyT=最後一個實排 key 的秒數(dur 含自動補的回-idle 收尾段;循環 clip 的循環終點要用這個,
  // 否則收尾段混進循環=每圈垮回站姿再跳回)
  const lastKeyT = last ? last.frame / REF_FPS : 0;
  return { segs, phases, lags, dur, tags, tagsLast, impactT, lastKeyT };
}
const NO_LAGS = { aL: 0, aR: 0, lL: 0, lR: 0 };
export function evalClip(clip, tSec) { // t 秒 → 47 軸姿勢;超出長度回 null(caller 落回 idle)
  const f = tSec * REF_FPS;
  for (const s of clip.segs) {
    if (f < s.end) {
      const lp = (f - s.start) / Math.max(s.end - s.start, 0.0001);
      return lerpPose(clip.phases[s.from] || COMBAT_IDLE, clip.phases[s.to] || COMBAT_IDLE, ease(lp, s.ease), s.impact ? NO_LAGS : clip.lags);
    }
  }
  return null;
}

/* ===== CLIPS:動作庫。三連擊由使用者在 PUNCH STUDIO 編排 → JSON 匯出接入。
   idle 幀已剝除,prepClip 自動用 COMBAT_IDLE(遊戲中性戰鬥站姿)補上,避免起手/收招爆閃。
   ⚠ impact 影格 = 傷害判定時刻:impact key 的 frame÷60 必須等於 v2-state.js 的 STRIKE_DELAY[段],
   重編動作若移動 impact 位置,兩邊要一起改。目前 rhook@17f/lhook@20f/overhand@23f。 ===== */
export const CLIPS = {
  rhook: prepClip({ // 右鉤拳(combo 第 1 段;impact @17f≈0.283s = STRIKE_DELAY[0];整肢伸展 1.4~1.91×)
    seq: [
      { name: 'idle', frame: 0, frames: 10, ease: 'out' },
      { name: 'windup', frame: 6, ease: 'out' },
      { name: 'hold', frame: 10, ease: 'out' },   // 預備停頓(移動式定格):蓄力側身多擰一點再爆發=浮誇感的來源
      { name: 'swing', frame: 13, ease: 'in' },
      { name: 'strike', frame: 15, ease: 'in' },
      { name: 'impact', frame: 17, ease: 'lin', impact: true },
      { name: 'impact_hold', frame: 19, ease: 'out' },   // 命中定格 2 影格:正常速度下讓撞擊讀得到(hold 在傷害幀之後 → STRIKE_DELAY 不變)
      { name: 'recovery_1', frame: 22, ease: 'lin' },
      { name: 'recovery_2', frame: 25, ease: 'lin' },
    ],
    phases: {
      windup: { root_y: -4, spine_x: -30, spine_y: 60, pelvis_y: 60, aL_sz: 34, aL_ex: 79, aR_sx: -73, aR_sy: 16, aR_sz: 99, aR_ex: 22, aR_scale: 1.65, aR_stretch: 1.4, lL_hx: 14, lL_hy: 18, lL_kx: 44, lR_hx: -15, lR_hy: -1, lR_hz: 11, lR_kx: 29 },
      hold: { root_y: -5, spine_x: -34, spine_y: 66, pelvis_y: 64, aL_sz: 34, aL_ex: 79, aR_sx: -78, aR_sy: 16, aR_sz: 99, aR_ex: 20, aR_scale: 1.65, aR_stretch: 1.4, lL_hx: 14, lL_hy: 18, lL_kx: 48, lR_hx: -15, lR_hy: -1, lR_hz: 11, lR_kx: 29 },
      swing: { spine_y: -12, pelvis_y: -8, aL_sz: 34, aL_ex: 79, aR_sx: -22, aR_sy: -12, aR_sz: 88, aR_ex: 40, aR_scale: 1.35, aR_stretch: 1.4, lL_hy: 12, lL_hz: 13, lL_kx: 18, lR_hy: 18, lR_hz: 20 },
      strike: { spine_x: 21, spine_y: -31, pelvis_y: -29, aL_sz: 34, aL_ex: 79, aR_sx: 2, aR_sy: 3, aR_sz: 96, aR_ex: 67, aR_idle: 0.07, aR_scale: 1.6, aR_stretch: 1.91, lL_hy: 25, lL_hz: 26, lL_kx: 36 },
      impact: { sq: 0.05, spine_x: 53, spine_y: -42, pelvis_y: -33, head_y: -6, aL_sz: 34, aL_ex: 79, aR_sx: -81, aR_sy: -90, aR_sz: 115, aR_ex: 11, aR_idle: 0.36, aR_scale: 1.9, aR_stretch: 1.77, lL_hx: -21, lL_hy: -29, lL_hz: -12, lL_kx: 18, lL_ax: -4, lR_hx: -2, lR_hy: 24, lR_hz: 16, lR_kx: 73 },
      impact_hold: { sq: 0.05, spine_x: 53, spine_y: -42, pelvis_y: -33, head_y: -6, aL_sz: 34, aL_ex: 79, aR_sx: -81, aR_sy: -90, aR_sz: 115, aR_ex: 11, aR_idle: 0.36, aR_scale: 1.9, aR_stretch: 1.77, lL_hx: -21, lL_hy: -29, lL_hz: -12, lL_kx: 18, lL_ax: -4, lR_hx: -2, lR_hy: 24, lR_hz: 16, lR_kx: 73 },
      recovery_1: { sq: 0.05, spine_x: 24, spine_y: -60, pelvis_y: -33, head_y: -6, aL_sz: 34, aL_ex: 79, aR_sx: -23, aR_sy: -90, aR_sz: 118, aR_ex: 127, aR_idle: 0.36, aR_scale: 0.65, aR_stretch: 1.58, lL_hx: -21, lL_hy: -29, lL_hz: -12, lL_kx: 18, lL_ax: -4, lR_hx: -43, lR_hy: 15, lR_hz: 16, lR_kx: 73 },
      recovery_2: { sq: 0.05, spine_x: 9, spine_y: -60, pelvis_y: -60, head_y: -6, aL_sz: 34, aL_ex: 79, aR_sx: -23, aR_sy: -90, aR_sz: 118, aR_ex: 127, aR_idle: 0.36, aR_scale: 0.65, aR_stretch: 1.58, lL_hx: -14, lL_hy: -29, lL_hz: -12, lL_kx: 18, lL_ax: -4, lR_hx: -43, lR_hy: 15, lR_hz: 16, lR_kx: 73 },
    },
    lags: { aL: 0, aR: 0.1, lL: 0, lR: 0.1 },
  }),
  lhook: prepClip({ // 甩腰迴旋左拳(combo 第 2 段;impact @14f≈0.233s = STRIKE_DELAY[1];上半身 −90→+54 大甩腰驅動)
    seq: [
      { name: 'idle', frame: 0, frames: 10, ease: 'out' },
      { name: 'windup', frame: 4, ease: 'out' },
      { name: 'windup_hold', frame: 8, ease: 'out' },   // 蓄力移動式定格(大甩腰讀得出來)
      { name: 'strike', frame: 11, ease: 'in' },        // 解腰:加速
      { name: 'impact', frame: 14, ease: 'in', impact: true },
      { name: 'impact_hold', frame: 17, ease: 'out' },  // 命中定格 3 影格:正常速度下讀得到撞擊(hold 在傷害幀之後 → STRIKE_DELAY 不變)
      { name: 'recovery', frame: 22, ease: 'out' },
    ],
    phases: {
      windup: { sq: 0.05, spine_x: 28, spine_y: -90, pelvis_y: -42, head_y: -6, aL_sx: 27, aL_sy: -32, aL_sz: 62, aL_ex: 94, aL_idle: 0.05, aL_scale: 1.63, aR_sx: -23, aR_sy: -90, aR_sz: 118, aR_ex: 127, aR_idle: 0.36, aR_scale: 0.77, lL_hx: -21, lL_hy: -29, lL_hz: -12, lL_kx: 18, lL_ax: -4, lR_hx: -43, lR_hy: 15, lR_hz: 16, lR_kx: 73, aL_stretch: 1.4, aR_stretch: 1.32 },
      windup_hold: { sq: 0.08, spine_x: 31, spine_y: -90, pelvis_y: -55, head_y: -6, aL_sx: 27, aL_sy: -32, aL_sz: 62, aL_ex: 98, aL_idle: 0.05, aL_scale: 1.63, aR_sx: -23, aR_sy: -90, aR_sz: 118, aR_ex: 127, aR_idle: 0.36, aR_scale: 0.77, lL_hx: -21, lL_hy: -29, lL_hz: -12, lL_kx: 18, lL_ax: -4, lR_hx: -43, lR_hy: 15, lR_hz: 16, lR_kx: 73, aL_stretch: 1.4, aR_stretch: 1.32 },
      strike: { sq: 0.05, spine_x: 29, spine_y: -30, pelvis_y: -42, head_y: -6, aL_sx: -14, aL_sy: -32, aL_sz: 71, aL_ex: 94, aL_idle: 0.05, aL_scale: 1.63, aR_sx: -23, aR_sy: -90, aR_sz: 118, aR_ex: 127, aR_idle: 0.36, aR_scale: 0.77, lL_hx: 53, lL_hy: -29, lL_hz: 14, lL_kx: 18, lL_ax: -4, lR_hx: -60, lR_hy: 17, lR_hz: 16, lR_kx: 73, aL_stretch: 1.4, aR_stretch: 1.32 },
      impact: { sq: 0.05, spine_x: 29, spine_y: 54, pelvis_y: -42, head_y: -6, aL_sx: -50, aL_sy: 47, aL_sz: 90, aL_ex: 7, aL_scale: 1.63, aR_sx: -24, aR_sy: 9, aR_sz: 104, aR_ex: 120, aR_idle: 0.36, aR_scale: 0.77, lL_hx: 53, lL_hy: -29, lL_hz: 14, lL_kx: 18, lL_ax: -4, lR_hx: -60, lR_hy: 17, lR_hz: 16, lR_kx: 73, aL_stretch: 1.4, aR_stretch: 1.32 },
      impact_hold: { sq: 0.05, spine_x: 29, spine_y: 54, pelvis_y: -42, head_y: -6, aL_sx: -50, aL_sy: 47, aL_sz: 90, aL_ex: 7, aL_scale: 1.63, aR_sx: -24, aR_sy: 9, aR_sz: 104, aR_ex: 120, aR_idle: 0.36, aR_scale: 0.77, lL_hx: 53, lL_hy: -29, lL_hz: 14, lL_kx: 18, lL_ax: -4, lR_hx: -60, lR_hy: 17, lR_hz: 16, lR_kx: 73, aL_stretch: 1.4, aR_stretch: 1.32 },
      recovery: { sq: 0.05, spine_x: 29, spine_y: 89, pelvis_y: -42, head_y: -6, aL_sx: -46, aL_sy: 49, aL_sz: 76, aL_ex: 7, aL_idle: 0.11, aL_scale: 1.19, aR_sx: -22, aR_sy: -74, aR_sz: 118, aR_ex: 120, aR_idle: 0.36, aR_scale: 0.77, lL_hx: 11, lL_hy: -40, lL_hz: 6, lL_kx: 18, lL_ax: -4, lR_hx: -50, lR_hy: 15, lR_hz: 37, lR_kx: 48, aL_stretch: 0.95, aR_stretch: 1.32 },
    },
    lags: { aL: 0, aR: 0.1, lL: 0, lR: 0.1 },
  }),
  overhand: prepClip({ // 過頂重擊(combo 第 3 段=終結技;使用者定稿:大甩腰過頂砸+雙定格厚重;impact @23f≈0.383s = STRIKE_DELAY[2])
    seq: [
      { name: 'idle', frame: 0, frames: 10, ease: 'out' },
      { name: 'windup', frame: 6, ease: 'out' },
      { name: 'windup_hold', frame: 13, ease: 'out' },
      { name: 'hold', frame: 16, ease: 'out' },              // 定格1:蓄力舉臂凍住(蓄力頓點)
      { name: 'strike', frame: 19, ease: 'in' },
      { name: 'strike_hold', frame: 21, ease: 'in' },
      { name: 'impact', frame: 23, ease: 'in', impact: true },
      { name: 'impact_hold', frame: 26, ease: 'out' },       // 定格2:命中凍住(厚重衝擊)
      { name: 'recovery', frame: 30, ease: 'out' },
      { name: 'recovery_hold', frame: 35, ease: 'out' },
    ],
    phases: {
      windup: { sq: 0.05, spine_x: 29, spine_y: 89, pelvis_y: -42, head_y: -6, aL_sx: -46, aL_sy: 49, aL_sz: 76, aL_ex: 7, aL_idle: 0.1, aR_sx: -22, aR_sy: -74, aR_sz: 118, aR_ex: 120, aR_idle: 0.15, aR_scale: 1.33, lL_hx: 11, lL_hy: -40, lL_hz: 6, lL_kx: 18, lL_ax: -4, lR_hx: -50, lR_hy: 15, lR_hz: 37, lR_kx: 48, aL_stretch: 1.08, aR_stretch: 1.86 },
      windup_hold: { sq: 0.05, spine_x: -32, spine_y: 90, pelvis_y: 36, head_y: -6, aL_sx: 31, aL_sy: 58, aL_sz: 60, aL_ex: 77, aL_idle: 0.11, aL_scale: 1.19, aR_sx: 60, aR_sy: 118, aR_sz: 100, aR_ex: 160, aR_idle: 0.1, aR_scale: 1.25, lL_hx: 11, lL_hy: -40, lL_hz: 6, lL_kx: 18, lL_ax: -4, lR_hx: -50, lR_hy: 15, lR_hz: 37, lR_kx: 48, aL_stretch: 0.95, aR_stretch: 1.63 },
      strike: { sq: 0.05, spine_x: -39, spine_y: -22, pelvis_y: -16, head_y: -6, aL_sx: 30, aL_sy: -55, aL_sz: 60, aL_ex: 77, aL_idle: 0.11, aL_scale: 1.19, aR_sx: -55, aR_sy: 2, aR_sz: 31, aR_ex: 42, aR_scale: 1.41, lL_hx: 11, lL_hy: -40, lL_hz: 6, lL_kx: 18, lL_ax: -4, lR_hx: -50, lR_hy: 15, lR_hz: 37, lR_kx: 48, aR_wx: -8, aR_wy: 90, aL_stretch: 0.95, aR_stretch: 2.09 },
      hold: { sq: 0.05, spine_x: -32, spine_y: 90, pelvis_y: 36, head_y: -6, aL_sx: 31, aL_sy: 58, aL_sz: 60, aL_ex: 77, aL_idle: 0.11, aL_scale: 1.19, aR_sx: 60, aR_sy: 118, aR_sz: 100, aR_ex: 160, aR_idle: 0.1, aR_scale: 1.25, lL_hx: 11, lL_hy: -40, lL_hz: 6, lL_kx: 18, lL_ax: -4, lR_hx: -50, lR_hy: 15, lR_hz: 37, lR_kx: 48, aL_stretch: 0.95, aR_stretch: 1.63 },
      impact: { sq: 0.05, spine_x: 42, spine_y: -33, pelvis_y: -67, head_y: -6, aL_sx: 30, aL_sy: -55, aL_sz: 60, aL_ex: 77, aL_idle: 0.11, aL_scale: 1.19, aR_sx: -121, aR_sy: -21, aR_sz: 31, aR_ex: 39, aR_scale: 1.61, lL_hx: 18, lL_hy: -92, lL_hz: 10, lL_kx: -20, lL_ax: 44, lR_hx: 44, lR_hy: 78, lR_hz: -30, lR_kx: 73, aR_wx: -8, aR_wy: 90, lR_ty: -10, aL_stretch: 0.95, aR_stretch: 2.57, lR_stretch: 1.03 },
      strike_hold: { sq: 0.05, spine_x: 20, spine_y: -36, pelvis_y: -16, head_y: -6, aL_sx: 30, aL_sy: -55, aL_sz: 60, aL_ex: 77, aL_idle: 0.11, aL_scale: 1.19, aR_sx: -55, aR_sy: 2, aR_sz: 31, aR_ex: 60, aR_scale: 1.41, lL_hx: 11, lL_hy: -40, lL_hz: 6, lL_kx: 18, lL_ax: -4, lR_hx: -50, lR_hy: 15, lR_hz: 37, lR_kx: 48, aR_wx: -8, aR_wy: 90, aL_stretch: 0.95, aR_stretch: 2.09 },
      impact_hold: { sq: 0.05, spine_x: 42, spine_y: -33, pelvis_y: -67, head_y: -6, aL_sx: 30, aL_sy: -55, aL_sz: 60, aL_ex: 77, aL_idle: 0.11, aL_scale: 1.19, aR_sx: -121, aR_sy: -21, aR_sz: 31, aR_ex: 39, aR_scale: 1.61, lL_hx: 18, lL_hy: -92, lL_hz: 10, lL_kx: -20, lL_ax: 44, lR_hx: 44, lR_hy: 78, lR_hz: -30, lR_kx: 73, aR_wx: -8, aR_wy: 90, lR_ty: -10, aL_stretch: 0.95, aR_stretch: 2.57, lR_stretch: 1.03 },
      recovery: { sq: 0.05, spine_x: 39, spine_y: -33, pelvis_y: -67, head_y: -6, aL_sx: 30, aL_sy: -55, aL_sz: 60, aL_ex: 77, aL_idle: 0.11, aL_scale: 1.19, aR_sx: -121, aR_sy: -24, aR_sz: 40, aR_ex: 66, aR_scale: 1.28, lL_hx: 18, lL_hy: -92, lL_hz: 10, lL_kx: -20, lL_ax: 44, lR_hx: 44, lR_hy: 78, lR_hz: -30, lR_kx: -1, aR_wx: -8, aR_wy: 90, lR_ty: -10, aL_stretch: 0.95, aR_stretch: 1.08, lR_stretch: 1.03 },
      recovery_hold: { sq: 0.05, spine_x: 15, spine_y: -8, pelvis_y: -90, head_y: -6, aL_sx: 30, aL_sy: 14, aL_sz: 60, aL_ex: 77, aL_idle: 0.11, aL_scale: 1.19, aR_sx: -9, aR_sy: -24, aR_sz: 40, aR_ex: 66, aR_scale: 1.28, lL_hx: 18, lL_hy: -92, lL_hz: 10, lL_kx: -20, lL_ax: 44, lR_hx: 44, lR_hy: 78, lR_hz: -30, lR_kx: -1, aR_wx: -8, aR_wy: 90, lR_ty: -10, aL_stretch: 0.95, aR_stretch: 1.08, lR_stretch: 1.03 },
    },
    lags: { aL: 0, aR: 0.1, lL: 0, lR: 0.1 },
  }),
  // 雙手過頂 heave 丟桶(道具 clip,經 itemClip 頻道播;非 combo)。使用者 PUNCH STUDIO 定稿。
  // grab@7f=桶黏手(遊戲端桶仍由 carry loop 定位)、release@22f=甩出時刻(= v2-state BARREL_THROW_DELAY,移動要同步)。
  // idle 略去 → prepClip 補 COMBAT_IDLE(與遊戲站姿無縫接)。手指軸(aL_/aR_ f*)已進 POSE_KEYS,?avatar=1 掛 rigged 手時驅動指骨。
  barrel_throw: prepClip({
    seq: [
      { name: 'idle', frame: 0, frames: 10, ease: 'out', tag: 'idle' },
      { name: 'anti', frame: 4, ease: 'out', tag: 'anti' },
      { name: 'windup', frame: 7, ease: 'out', tag: 'grab' },
      { name: 'grab', frame: 10, ease: 'out', tag: 'grab' },
      { name: 'grab_hold', frame: 13, ease: 'out', tag: 'grab' },
      { name: 'ready_to_release', frame: 16, ease: 'out', tag: 'grab' },
      { name: 'ready_to_release_2', frame: 19, ease: 'out', tag: 'grab' },   // 裝填定格(移動式定格;tag 修正 release→grab,手指仍握緊)
      { name: 'ready_to_release_2_hold', frame: 22, ease: 'out', tag: 'release' },   // 甩出幀(=BARREL_THROW_DELAY 的來源;tag 修正:裝填定格後的揮擺起點)
      { name: 'release', frame: 25, ease: 'out', tag: 'recover' },
    ],
    phases: {
      anti: { squat: 35, spine_x: 27, aL_sz: 55, aR_sz: 55 },
      windup: { squat: 35, spine_x: 27, aL_sx: -19, aL_sy: 69, aL_sz: 55, aL_ex: -10, aR_sx: -19, aR_sy: -58, aR_sz: 55, aL_stretch: 1.46, aR_stretch: 1.45, aL_fbase: -32, aL_fmid: -26, aR_fbase: -20, aR_fmid: -29 },
      grab: { squat: 35, spine_x: 27, aL_sx: -157, aL_sy: 71, aL_sz: 61, aL_ex: 2, aR_sx: -157, aR_sy: -70, aR_sz: 52, aL_wx: 76, aL_wy: 7, aR_wx: 70, aL_stretch: 1.78, aR_stretch: 1.72, aL_fbase: -55, aL_fmid: -28, aL_ftip: -21, aL_fthumb: -21, aR_fbase: -67, aR_fmid: -11, aR_ftip: -13, aR_fthumb: -2 },
      grab_hold: { squat: 35, spine_x: 27, aL_sx: -157, aL_sy: 71, aL_sz: 61, aL_ex: 2, aR_sx: -157, aR_sy: -70, aR_sz: 52, aL_wx: 76, aL_wy: 7, aR_wx: 70, aL_stretch: 1.78, aR_stretch: 1.72, aL_fbase: -55, aL_fmid: -28, aL_ftip: -21, aL_fthumb: -21, aR_fbase: -67, aR_fmid: -11, aR_ftip: -13, aR_fthumb: -2 },
      ready_to_release: { squat: 35, spine_x: -36, head_x: -36, aL_sx: -190, aL_sy: 71, aL_sz: 61, aL_ex: 2, aR_sx: -187, aR_sy: -70, aR_sz: 52, aL_wx: 76, aL_wy: 7, aR_wx: 70, aL_stretch: 1.78, aR_stretch: 1.72, aL_fbase: -55, aL_fmid: -28, aL_ftip: -21, aL_fthumb: -21, aR_fbase: -67, aR_fmid: -11, aR_ftip: -13, aR_fthumb: -2 },
      ready_to_release_2: { squat: 35, spine_x: 50, head_x: -36, aL_sx: -119, aL_sy: 71, aL_sz: 61, aL_ex: 2, aR_sx: -135, aR_sy: -70, aR_sz: 52, lL_hx: -60, lR_hx: -60, aL_wx: 76, aL_wy: 7, aR_wx: 70, aL_stretch: 1.78, aR_stretch: 1.72, aL_fbase: -55, aL_fmid: -28, aL_ftip: -21, aL_fthumb: -21, aR_fbase: -67, aR_fmid: -11, aR_ftip: -13, aR_fthumb: -2 },
      ready_to_release_2_hold: { squat: 35, spine_x: 50, head_x: -36, aL_sx: -119, aL_sy: 71, aL_sz: 61, aL_ex: 2, aR_sx: -135, aR_sy: -70, aR_sz: 52, lL_hx: -60, lR_hx: -60, aL_wx: 76, aL_wy: 7, aR_wx: 70, aL_stretch: 1.78, aR_stretch: 1.72, aL_fbase: -55, aL_fmid: -28, aL_ftip: -21, aL_fthumb: -21, aR_fbase: -67, aR_fmid: -11, aR_ftip: -13, aR_fthumb: -2 },
      release: { squat: 35, spine_x: 7, aL_sx: 16, aL_sy: 71, aL_sz: 61, aL_ex: 2, aR_sy: -70, aR_sz: 52, aL_wy: 7 },
    },
    lags: { aL: 0, aR: 0, lL: 0, lR: 0.1 },
  }),
  // 拎頭過頂丟人(carryClip 頻道播,扛人期間覆蓋程序姿勢)。使用者 PUNCH STUDIO 定稿(v2:含手指彎曲軸)。
  // grab@10=抓頭、hold@16=定格扛著走、release@22=甩飛——PERSON_HOLD_T/PERSON_THROW_DELAY 由這些 tag 自動導出,
  // 移幀重貼即對齊。被扛者靠 carry_tilt(-85 打橫)/carry_yaw(-100 轉向)/carry_o*(掛點微調)由 render-actors
  // 定位+旋轉;手指軸(抓時捲、收招放開)由 avatar rigged 手消費。idle 略去→補 COMBAT_IDLE。
  person_throw: prepClip({
    seq: [
      { name: "idle", frame: 0, frames: 10, ease: "out", tag: "idle" },
      { name: "windup", frame: 4, ease: "out", tag: "anti" },
      { name: "grab", frame: 10, ease: "out", tag: "grab" },
      { name: "grab_windup", frame: 13, ease: "out", tag: "grab" },
      { name: "grab_windup_2", frame: 16, ease: "out", tag: "hold" },   // 定格幀(翻橫完成→扛著走):tag hold = PERSON_HOLD_T 的來源
      { name: "ready_throw", frame: 19, ease: "out", tag: "grab" },
      { name: "throw_2", frame: 22, ease: "out", tag: "release" },
      { name: "throw_2_hold", frame: 25, ease: "out", tag: "release" },
      { name: "throw_finsh", frame: 28, ease: "out", tag: "recover" },
      { name: "recovery", frame: 38, ease: "out", tag: "recover" },
    ],
    phases: {
      windup: { spine_x: -6, spine_y: -63, pelvis_y: -6, aL_sx: 19, aL_sy: -21, aL_sz: 45, aL_ex: 95, aR_sx: 2, aR_sy: -18, aR_sz: 130, lL_hx: 16, lL_hy: 45, lL_kx: 22, lR_hx: -15, lR_hy: 8, lR_kx: 11, aR_wx: -13, aR_wy: -49, aR_stretch: 2.02, aL_fbase: -96, aL_fmid: -65, aL_ftip: -92, aL_fthumb: -76, aR_fbase: -42, aR_fmid: -28, aR_ftip: -55, aR_fthumb: -16 },
      grab: { spine_x: -6, spine_y: -63, pelvis_y: -6, aL_sx: 19, aL_sy: -21, aL_sz: 45, aL_ex: 95, aR_sx: -1, aR_sy: -28, aR_sz: 119, lL_hx: 16, lL_hy: 45, lL_kx: 22, lR_hx: -15, lR_hy: 8, lR_kx: 11, aR_wy: -97, aR_stretch: 1.95, aL_fbase: -96, aL_fmid: -65, aL_ftip: -92, aL_fthumb: -76, aR_fbase: -42, aR_fmid: -28, aR_ftip: -55, aR_fthumb: -16 },
      grab_windup: { spine_x: -28, spine_y: -63, pelvis_y: -6, head_x: 4, aL_sx: 19, aL_sy: -21, aL_sz: 45, aL_ex: 95, aR_sx: -34, aR_sy: -28, aR_sz: 119, lL_hx: 16, lL_hy: 45, lL_kx: 22, lR_hx: -15, lR_hy: 8, lR_kx: 11, aR_wy: -97, aR_stretch: 1.95, aL_fbase: -96, aL_fmid: -65, aL_ftip: -92, aL_fthumb: -76, aR_fbase: -42, aR_fmid: -28, aR_ftip: -55, aR_fthumb: -16 },
      grab_windup_2: { pelvis_y: -6, head_x: 4, aL_sx: -124, aL_sy: 47, aL_sz: 68, aL_ex: -3, aR_sx: -34, aR_sy: -28, aR_sz: 119, aR_scale: 0.9, lL_hx: -16, lL_hy: -6, lL_kx: 8, lR_hx: -15, lR_hy: 8, lR_kx: 11, aL_wx: 7, aL_wy: 30, aR_wx: -18, aR_wy: 48, aL_stretch: 1.81, aR_stretch: 1.95, aL_fbase: -35, aL_fmid: -27, aL_ftip: -48, aL_fthumb: -13, aR_fbase: -42, aR_fmid: 3, aR_ftip: -45, aR_fthumb: -16, carry_tilt: -85, carry_yaw: -100, carry_ox: -0.2, carry_oy: 0.48, carry_oz: 0.18 },
      ready_throw: { spine_x: -55, pelvis_y: -6, head_x: 4, aL_sx: -124, aL_sy: 47, aL_sz: 68, aL_ex: -3, aR_sx: -34, aR_sy: -28, aR_sz: 119, aR_scale: 0.9, lL_hx: -16, lL_hy: -6, lL_kx: 8, lR_hx: -15, lR_hy: 8, lR_kx: 11, aL_wx: 7, aL_wy: 30, aR_wx: -18, aR_wy: 48, aL_stretch: 1.81, aR_stretch: 1.95, aL_fbase: -35, aL_fmid: -27, aL_ftip: -48, aL_fthumb: -13, aR_fbase: -42, aR_fmid: 3, aR_ftip: -45, aR_fthumb: -16, carry_tilt: -85, carry_yaw: -100, carry_ox: -0.2, carry_oy: 0.48, carry_oz: 0.18 },
      throw_2: { spine_x: 33, pelvis_y: -6, head_x: 4, aL_sx: -124, aL_sy: 47, aL_sz: 68, aL_ex: -3, aR_sx: -34, aR_sy: -28, aR_sz: 119, aR_scale: 0.9, lL_hx: -16, lL_hy: -7, lL_kx: -20, lR_hx: -15, lR_hy: 8, lR_kx: -20, aL_wx: 7, aL_wy: 30, aR_wx: -18, aR_wy: 48, aL_stretch: 1.81, aR_stretch: 1.95, aL_fbase: -35, aL_fmid: -27, aL_ftip: -48, aL_fthumb: -13, aR_fbase: -42, aR_fmid: 3, aR_ftip: -45, aR_fthumb: -16, carry_tilt: -85, carry_yaw: -100, carry_ox: -0.2, carry_oy: 0.48, carry_oz: 0.18 },
      throw_2_hold: { spine_x: 33, pelvis_y: -6, head_x: 4, aL_sx: -124, aL_sy: 47, aL_sz: 68, aL_ex: -3, aR_sx: -34, aR_sy: -28, aR_sz: 119, aR_scale: 0.9, lL_hx: -16, lL_hy: -7, lL_kx: -20, lR_hx: -15, lR_hy: 8, lR_kx: -20, aL_wx: 7, aL_wy: 30, aR_wx: -18, aR_wy: 48, aL_stretch: 1.81, aR_stretch: 1.95, aL_fbase: -35, aL_fmid: -27, aL_ftip: -48, aL_fthumb: -13, aR_fbase: -42, aR_fmid: 3, aR_ftip: -45, aR_fthumb: -16, carry_tilt: -85, carry_yaw: -100, carry_ox: -0.2, carry_oy: 0.48, carry_oz: 0.18 },
      throw_finsh: { spine_x: -2, pelvis_y: -6, head_x: 4, aL_sx: -124, aL_sy: 47, aL_sz: 68, aL_ex: -3, aR_sx: -34, aR_sy: -28, aR_sz: 119, aR_scale: 0.9, lL_hx: -16, lL_hy: -7, lR_hx: -15, lR_hy: 8, aL_wx: 7, aL_wy: 30, aR_wx: -18, aR_wy: 48, aL_stretch: 1.81, aR_stretch: 1.95, aL_fbase: -35, aL_fmid: -27, aL_ftip: -48, aL_fthumb: -13, aR_fbase: -42, aR_fmid: 3, aR_ftip: -45, aR_fthumb: -16, carry_tilt: -85, carry_yaw: -100, carry_ox: -0.2, carry_oy: 0.48, carry_oz: 0.18 },
      recovery: { spine_x: -2, pelvis_y: -6, head_x: 4, aL_sx: 63, aL_sy: 66, aL_sz: 87, aL_ex: -3, aR_sx: 156, aR_sy: -25, aR_sz: 163, aR_scale: 0.9, lL_hx: -16, lL_hy: -7, lR_hx: -15, lR_hy: 8, aL_wx: 7, aL_wy: 30, aR_wx: 22, aR_wy: 66, carry_tilt: -85, carry_yaw: -100, carry_ox: -0.2, carry_oy: 0.48, carry_oz: 0.18 },
    },
    lags: { aL: 0, aR: 0.2, lL: 0, lR: 0.1 },
  }),
  // 跑步循環(雙擊跑;actor-brawler 循環頻道:0→run_1 起跑段播一次,[run_1..run_3] 位移驅動繞圈)。
  // 使用者 PUNCH STUDIO 初稿 + 接入時的節奏修正:①run_3=run_1 完全一致(原殘差 kx 0↔42 → 接縫跳)
  // ②循環段 ease lin(原全 out=每步頓一下)③lags 全 0(原 lR 0.1≈整圈相位,繞回點會取樣到起跑段)。
  // idle 略去 → COMBAT_IDLE 起跑。
  run_cycle: prepClip({ // 跑步循環 v3(2026-07-21 使用者授權代編;基於使用者 v2 的手臂擺動,重做腿+重量起伏):
    // 舊 v2=2 格剪刀腿(±60° 開合、直膝、等高)=滑行感;v3=標準四段×左右 8 格:
    // contact(前腿伸直踩地/後腿蹬尾)→ down(重量壓上:膝彎+root_py 最低;root_py=studio 單位 1≈25px 故用小數)→ pass(後腿摺膝 115° 掃過/身體回升)
    // → up(蹬地騰空:root_py 最高+前膝高抬)。前傾 spine_x 18~22 貫穿;觸地格 contact=1 踩實。
    // root_py 起伏編進格子 → ANIM.runClip.bob 已關(0)讓位,免雙重彈跳。手臂=使用者 v2 兩極值+中間格內插。
    seq: [
      { name: 'idle', frame: 0, frames: 10, ease: 'out', tag: 'idle' },
      { name: 'contact_L', frame: 4, ease: 'out', tag: 'run' },
      { name: 'down_L', frame: 6, ease: 'lin', tag: 'run' },
      { name: 'pass_L', frame: 8, ease: 'lin', tag: 'run' },
      { name: 'up_L', frame: 10, ease: 'lin', tag: 'run' },
      { name: 'contact_R', frame: 12, ease: 'lin', tag: 'run' },
      { name: 'down_R', frame: 14, ease: 'lin', tag: 'run' },
      { name: 'pass_R', frame: 16, ease: 'lin', tag: 'run' },
      { name: 'up_R', frame: 18, ease: 'lin', tag: 'run' },
      { name: 'loop_end', frame: 20, ease: 'lin', tag: 'run' },
    ],
    phases: {
      // 左腳領跑半循環(手臂=使用者 run_1 極值起步)
      contact_L: { spine_x: 18, root_py: -0.08, aL_sx: -51, aL_sz: 26, aL_ex: 68, aR_sx: 107, aR_sz: 25, aR_ex: 74, lL_hx: 55, lL_kx: 10, lL_ax: -25, lL_contact: 1, lR_hx: -50, lR_kx: 60, lR_ax: 45 },
      down_L:    { spine_x: 20, root_py: -0.24, aL_sx: -20, aL_sz: 26, aL_ex: 68, aR_sx: 80, aR_sz: 25, aR_ex: 74, lL_hx: 35, lL_kx: 55, lL_ax: 10, lL_contact: 1, lR_hx: -30, lR_kx: 95, lR_ax: 50 },
      pass_L:    { spine_x: 20, root_py: 0.02, aL_sx: 30, aL_sz: 26, aL_ex: 68, aR_sx: 30, aR_sz: 25, aR_ex: 74, lL_hx: 5, lL_kx: 25, lL_ax: 10, lL_contact: 1, lR_hx: 10, lR_kx: 115, lR_ax: 55 },
      up_L:      { spine_x: 22, root_py: 0.2, aL_sx: 90, aL_sz: 26, aL_ex: 68, aR_sx: -20, aR_sz: 25, aR_ex: 74, lL_hx: -35, lL_kx: 40, lL_ax: 50, lR_hx: 45, lR_kx: 80, lR_ax: 0 },
      // 右腳領跑半循環(鏡像;手臂=使用者 run_2 極值)
      contact_R: { spine_x: 18, root_py: -0.08, aL_sx: 120, aL_sz: 26, aL_ex: 68, aR_sx: -45, aR_sz: 25, aR_ex: 74, lR_hx: 55, lR_kx: 10, lR_ax: -25, lR_contact: 1, lL_hx: -50, lL_kx: 60, lL_ax: 45 },
      down_R:    { spine_x: 20, root_py: -0.24, aL_sx: 85, aL_sz: 26, aL_ex: 68, aR_sx: -15, aR_sz: 25, aR_ex: 74, lR_hx: 35, lR_kx: 55, lR_ax: 10, lR_contact: 1, lL_hx: -30, lL_kx: 95, lL_ax: 50 },
      pass_R:    { spine_x: 20, root_py: 0.02, aL_sx: 35, aL_sz: 26, aL_ex: 68, aR_sx: 35, aR_sz: 25, aR_ex: 74, lR_hx: 5, lR_kx: 25, lR_ax: 10, lR_contact: 1, lL_hx: 10, lL_kx: 115, lL_ax: 55 },
      up_R:      { spine_x: 22, root_py: 0.2, aL_sx: -25, aL_sz: 26, aL_ex: 68, aR_sx: 95, aR_sz: 25, aR_ex: 74, lR_hx: -35, lR_kx: 40, lR_ax: 50, lL_hx: 45, lL_kx: 80, lL_ax: 0 },
      loop_end:  { spine_x: 18, root_py: -0.08, aL_sx: -51, aL_sz: 26, aL_ex: 68, aR_sx: 107, aR_sz: 25, aR_ex: 74, lL_hx: 55, lL_kx: 10, lL_ax: -25, lL_contact: 1, lR_hx: -50, lR_kx: 60, lR_ax: 45 },
    },
    lags: { aL: 0, aR: 0, lL: 0, lR: 0 },
  }),
  hit_flinch: prepClip({ // 受擊短動作(使用者 studio 定稿 2026-07-16):軀幹後仰+右臂護頭+左腿踉蹌;
    // 4f 到位→10f 回站姿,dur≈0.23s(< 連段拍 0.35s,不拖手感)。只在「空閒」時播(actor-brawler 有 free/非行動守衛);
    // 世界層 flinch overlay 此時降權(ANIM.flinch.clipMul)避免雙重受擊。方向資訊由 overlay 的傾斜補(clip 是固定姿勢)。
    seq: [
      { name: 'idle', frame: 0, frames: 10, returnFrames: 10, ease: 'out' },
      { name: 'hit_flinch', frame: 4, ease: 'out' },
    ],
    phases: {
      hit_flinch: { spine_x: -27, spine_y: 17, aL_sx: -34, aL_sz: 24, aL_ex: 27, aR_sy: 36, aR_sz: 26, aR_ex: 62, lL_hx: -60, lL_kx: 39, lR_hy: 24 },
    },
    lags: { aL: 0, aR: 0, lL: 0, lR: 0.1 },
  }),
  walk_cycle: prepClip({ // 走路循環(使用者 studio 定稿 2026-07-16;僵直腿卡通搖擺步):A@4→B@7 鏡像對步,
    // tag walk=循環起點。⚠ walk_end@10=接回時補的閉環 key(姿勢=複製 A):循環規約=最後 key 姿勢等於
    // 循環起點姿勢,原匯出只到 B 會每步跳回 A 抽一下;studio 重編時直接多排這個尾 key 即可拿掉這行註解。
    seq: [
      { name: 'idle', frame: 0, frames: 10, returnFrames: 10, ease: 'out' },
      { name: 'walk', frame: 4, ease: 'out', tag: 'walk' },
      { name: 'walk_copy', frame: 7, ease: 'out', tag: 'walk' },
      { name: 'walk_end', frame: 10, ease: 'out' },
    ],
    phases: {
      walk:      { aL_sx: -31, aL_sz: 25, aL_ex: 17, aR_sx: 52, aR_sz: 20, aR_ex: 31, lL_hx: 52, lL_ax: 60, lR_hx: -40, lR_ax: -56 },
      walk_copy: { aL_sx: 50, aL_sz: 25, aL_ex: 17, aR_sx: -37, aR_sz: 20, aR_ex: 31, lL_hx: -43, lL_ax: -60, lR_hx: 60, lR_ax: 23 },
      walk_end:  { aL_sx: -31, aL_sz: 25, aL_ex: 17, aR_sx: 52, aR_sz: 20, aR_ex: 31, lL_hx: 52, lL_ax: 60, lR_hx: -40, lR_ax: -56 },
    },
    lags: { aL: 0, aR: 0, lL: 0, lR: 0.1 },
  }),
  dash_punch: prepClip({ // 衝刺突進拳(使用者 studio 定稿 2026-07-21;跑≥0.4s 出拳=前衝直拳):
    // impact @16f≈0.267s(自動成為 DASH_T/STRIKE_DELAY[4]);尾巴=impact_hold 3f 定格+回站姿 10f
    // = PUNCH_RECOVER[4]≈0.217s 收招空拍(使用者拍板:攻擊完停一拍,不能馬上接移動——resolveStrike 對 dash 也蓋章)
    seq: [
      { name: 'idle', frame: 0, frames: 10, returnFrames: 10, ease: 'out' },
      { name: 'anti', frame: 7, ease: 'out' },
      { name: 'strike', frame: 10, ease: 'out' },
      { name: 'strike_hold', frame: 13, ease: 'out' },
      { name: 'impact', frame: 16, ease: 'out', impact: true },
      { name: 'impact_hold', frame: 19, ease: 'out' },
    ],
    phases: {
      anti: { spine_x: -24, spine_y: 90, pelvis_y: -12, aL_sx: 40, aL_sy: 41, aL_sz: 90, aL_ex: 122, aR_sz: 90, lL_hx: -60, lR_hx: 36, lR_hy: 40, aR_stretch: 2.68 },
      strike: { spine_x: -24, spine_y: 90, pelvis_y: -12, aL_sx: 40, aL_sy: 41, aL_sz: 90, aL_ex: 122, aR_sz: 90, aR_ex: 117, lL_hx: 3, lR_hx: 36, lR_hy: 40, aR_stretch: 2.68 },
      strike_hold: { spine_x: -3, spine_y: 59, pelvis_y: -12, aL_sx: 40, aL_sy: 41, aL_sz: 90, aL_ex: 122, aR_sx: -2, aR_sz: 91, aR_ex: 159, lL_hx: 3, lR_hx: 24, lR_hy: 40, aR_stretch: 2.68 },
      impact: { spine_x: 54, aL_sx: -15, aL_sy: -25, aL_sz: 90, aL_ex: 122, aR_sx: -48, aR_sy: -97, aR_sz: 105, aR_ex: -5, lL_hx: 55, lL_hy: 14, lR_hx: 53, lR_hy: 40, aR_stretch: 2.68 },
      impact_hold: { spine_x: 62, aL_sx: -15, aL_sy: -25, aL_sz: 90, aL_ex: 122, aR_sx: -48, aR_sy: -97, aR_sz: 105, aR_ex: -5, lL_hx: 60, lL_hy: 14, lR_hx: 60, lR_hy: 40, aR_stretch: 2.68 },
    },
    lags: { aL: 0, aR: 0.2, lL: 0, lR: 0.1 },
  }),
  item_wind: prepClip({ // 風壓手套施放(使用者 studio 定稿 2026-07-23;首個用上腕 Z 的 clip:aR_wz 75°=右手側掌外推):
    // 右臂側伸(sy -74/sz 110/stretch 1.98)+ 左臂反向配重 + 弓步(lL -42/lR 57)。
    // **節奏(使用者拍板 2026-07-23):手伸到最遠(7f≈0.117s)→ 定格 0.5s(30f 同姿勢=凍結)→ 開火**。
    // impact 幀 = WIND_HOLD @37f ≈ 0.617s = ITEM_SPEC.wind.delay(v2-state 自動吃 impactT)。開火時手還在最遠處
    // (不是回落瞬間);開火後 10f 收回站姿。定格窗內 game.windAims 扇形預告脈動=蓄力讀條+對手閃避窗。
    seq: [
      { name: 'idle', frame: 0, frames: 10, returnFrames: 10, ease: 'out' },
      { name: 'WIND_UP', frame: 7, ease: 'out' },                              // 伸到最遠
      { name: 'WIND_HOLD', frame: 37, ease: 'lin', impact: true, tag: 'strike' }, // 定格 0.5s → 幀 37 開火
    ],
    phases: {
      WIND_UP:   { aL_sx: 44, aL_sy: -2, aL_sz: 26, aR_sx: 21, aR_sy: -74, aR_sz: 110, aR_ex: 10, lL_hx: -42, lL_kx: 38, lR_hx: 57, aR_wx: -7, aR_wy: -6, aR_wz: 75, aR_stretch: 1.98 },
      WIND_HOLD: { aL_sx: 44, aL_sy: -2, aL_sz: 26, aR_sx: 21, aR_sy: -74, aR_sz: 110, aR_ex: 10, lL_hx: -42, lL_kx: 38, lR_hx: 57, aR_wx: -7, aR_wy: -6, aR_wz: 75, aR_stretch: 1.98 }, // 同 WIND_UP=定格凍結
    },
    lags: { aL: 0, aR: 0.2, lL: 0, lR: 0.1 },
  }),
};
export const PUNCH_CLIPS = ['rhook', 'lhook', 'overhand', 'dive_punch', 'dash_punch']; // punchKind 0/1/2 → 三連擊;3=下壓拳(空中)/4=衝刺拳(跑)——皆為可選槽,使用者編好貼入即播(缺槽時 actor-brawler 暫用 overhand/rhook)
