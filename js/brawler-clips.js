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
  'lL_ty', 'lR_ty',
  'aL_stretch', 'aR_stretch', 'lL_stretch', 'lR_stretch',   // 整肢從近端關節等比伸展(1=原長;遠鏡頭下伸手更明顯)
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
  // tags:B 層(排程抓/丟)的零風險準備——保留 grab/release 等 tag 的幀時刻(秒),目前無人消費。
  // 未來遊戲端:grabAt=播 grab clip 後掛上被扛物的時刻、releaseAt=丟出給速度的時刻(鏡像 STRIKE_DELAY 模式)。
  const tags = {};
  for (const k of seq) if (k.tag && !(k.tag in tags)) tags[k.tag] = k.frame / REF_FPS;
  return { segs, phases, lags, dur, tags };
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
};
export const PUNCH_CLIPS = ['rhook', 'lhook', 'overhand']; // punchKind 0/1/2 → clip(使用者自編三連擊)
