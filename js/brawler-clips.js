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
];
export function defaultPoseValue(k) { return (k === 'body_scale' || k.endsWith('_scale')) ? 1 : 0; }
export function normalizePose(p = {}) {
  const out = {};
  for (const k of POSE_KEYS) out[k] = (p[k] !== undefined && isFinite(p[k])) ? Number(p[k]) : defaultPoseValue(k);
  return out;
}

// 滑稽戰鬥站姿(編排器 GOOFY_IDLE):半蹲、屈膝、手肘彎、頭微偏——所有動作的起點/終點
export const COMBAT_IDLE = normalizePose({
  squat: 45, head_y: 23, head_x: 6,
  aL_sx: -12, aL_ex: 40, aR_sx: -12, aR_sy: 6, aR_ex: 40,
  lL_hx: -31, lL_hy: 5, lL_hz: 20, lL_kx: 40,
  lR_hx: -31, lR_hy: 5, lR_hz: 20, lR_kx: 40,
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
  const seq = (snap.seq || []).map(k => ({ name: k.name, frame: k.frame || 0, ease: k.ease || 'in', impact: !!k.impact }));
  const segs = [];
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    segs.push({ from: a.name, to: b.name, start: a.frame, end: b.frame, ease: b.ease, impact: b.impact });
  }
  const last = seq[seq.length - 1];
  const rf = Math.max(1, Math.round((snap.seq && snap.seq[0] && (snap.seq[0].returnFrames ?? snap.seq[0].frames)) || 10));
  if (last && last.name !== 'idle') segs.push({ from: last.name, to: 'idle', start: last.frame, end: last.frame + rf, ease: 'out', impact: false });
  const dur = segs.length ? segs[segs.length - 1].end / REF_FPS : 0;
  return { segs, phases, lags, dur };
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

/* ===== CLIPS:動作庫。姿勢值引導自編排器內建 presets(hookl/hookr/cross),
   時間軸對齊遊戲節奏(鉤拳 impact @9f≈0.15s、直拳 @13f≈0.22s —— 與 v2-state 的
   STRIKE_DELAY 對齊:動作的 impact 影格 = 傷害判定時刻,兩邊要一起改)。
   之後在編排器重編 → JSON 匯出 → 整份取代對應 entry 即可。 ===== */
export const CLIPS = {
  hookl: prepClip({ // 左鉤拳(combo 第 1 段)
    seq: [
      { name: 'idle', frame: 0, frames: 8 },
      { name: 'anti', frame: 5, ease: 'out' },
      { name: 'strike', frame: 8, ease: 'in' },
      { name: 'impact', frame: 11, ease: 'lin', impact: true },
      { name: 'recovery', frame: 19, ease: 'out' },
    ],
    phases: {
      anti: { root_y: -20, root_x: -2, root_pz: -0.03, sq: 0.12,
        aL_sx: -95, aL_sy: -40, aL_ex: 90, aR_sx: -95, aR_sy: 25, aR_ex: 90,
        lL_hx: -14, lL_kx: 38, lR_hx: 12, lR_kx: 22 },
      strike: { root_y: 35, root_x: 3, root_pz: 0.18, sq: -0.18,
        aL_sx: -95, aL_sy: 35, aL_ex: 75, aR_sx: -90, aR_sy: 15, aR_ex: 90,
        lL_hx: -8, lL_kx: 10, lR_hx: 14, lR_kx: 30 },
      impact: { root_y: 42, root_x: 3, root_pz: 0.20, sq: -0.22,
        aL_sx: -100, aL_sy: 45, aL_ex: 70, aL_scale: 1.25, aR_sx: -90, aR_sy: 15, aR_ex: 90,
        lL_hx: -8, lL_kx: 8, lR_hx: 14, lR_kx: 30 },
      recovery: { ...COMBAT_IDLE },
    },
  }),
  hookr: prepClip({ // 右鉤拳(combo 第 2 段)
    seq: [
      { name: 'idle', frame: 0, frames: 8 },
      { name: 'anti', frame: 5, ease: 'out' },
      { name: 'strike', frame: 8, ease: 'in' },
      { name: 'impact', frame: 11, ease: 'lin', impact: true },
      { name: 'recovery', frame: 19, ease: 'out' },
    ],
    phases: {
      anti: { root_y: 20, root_x: -2, root_pz: -0.03, sq: 0.12,
        aL_sx: -95, aL_sy: -15, aL_ex: 90, aR_sx: -95, aR_sy: 40, aR_ex: 90,
        lL_hx: -12, lL_kx: 22, lR_hx: 14, lR_kx: 38 },
      strike: { root_y: -35, root_x: 3, root_pz: 0.20, sq: -0.18,
        aL_sx: -90, aL_sy: -15, aL_ex: 90, aR_sx: -95, aR_sy: -35, aR_ex: 75,
        lL_hx: -12, lL_kx: 30, lR_hx: 18, lR_kx: 8 },
      impact: { root_y: -42, root_x: 3, root_pz: 0.22, sq: -0.22,
        aL_sx: -90, aL_sy: -15, aL_ex: 90, aR_sx: -100, aR_sy: -45, aR_ex: 70, aR_scale: 1.25,
        lL_hx: -12, lL_kx: 30, lR_hx: 18, lR_kx: 6 },
      recovery: { ...COMBAT_IDLE },
    },
  }),
  cross: prepClip({ // 後手直拳(combo 第 3 段=終結技;投擲動作暫借用)
    seq: [
      { name: 'idle', frame: 0, frames: 10 },
      { name: 'anti', frame: 8, ease: 'out' },
      { name: 'strike', frame: 11, ease: 'in' },
      { name: 'impact', frame: 14, ease: 'lin', impact: true },
      { name: 'recovery', frame: 27, ease: 'out' },
    ],
    phases: {
      anti: { root_y: -18, root_x: -2, root_pz: -0.04, sq: 0.10,
        aL_sx: -90, aL_sy: -15, aL_ex: 80, aR_sx: -60, aR_sy: 25, aR_ex: 120,
        lL_hx: -12, lL_kx: 18, lR_hx: 14, lR_kx: 38 },
      strike: { root_y: 30, root_x: 4, root_pz: 0.22, sq: -0.18,
        aL_sx: -70, aL_sy: -10, aL_ex: 85, aR_sx: -100, aR_sy: 5, aR_ex: 5,
        lL_hx: -8, lL_kx: 8, lR_hx: 18, lR_kx: 6 },
      impact: { root_y: 34, root_x: 5, root_pz: 0.24, sq: -0.20,
        aL_sx: -70, aL_sy: -10, aL_ex: 85, aR_sx: -108, aR_sy: 5, aR_ex: 0, aR_scale: 1.35,
        lL_hx: -8, lL_kx: 8, lR_hx: 18, lR_kx: 4 },
      recovery: { ...COMBAT_IDLE },
    },
  }),
};
export const PUNCH_CLIPS = ['hookl', 'hookr', 'cross']; // punchKind 0/1/2 → clip
