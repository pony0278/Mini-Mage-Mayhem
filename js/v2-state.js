// v2 的狀態與調參中心 (docs/v2-module-boundaries.md §3/§4)。
// - 全部 tuning 常數與資料表都住這裡:改手感數值永遠只開這個檔案。
// - 共享可變單例(fighters/inc/pads/barrels/iceZones/containLog/roundWins/camRig)
//   沿用「原地變異、永不重新賦值」(同 state.js 的 game)。
// - 跨模組可重賦值純量集中在 v2s 物件(唯一的純量容器;模組頂層不 export let)。
import { W, H, TILE } from './constants.js';

export const LOCAL = 0;        // the human-controlled fighter (camera follows it)
export const DEBUG = true;     // console event log (open DevTools) — copy lines to report issues
export const dlog = (...a) => { if (DEBUG) console.log('[v2]', ...a); };

// --- 基礎調參 ---
export const SPEED = 168;      // walk speed (px/s)
export const RESPAWN = 1.3;    // delay before a fallen fighter pops back in (isles)
export const FRICTION = 0.25;  // isles 長滑行的每秒速度乘數(平台場改用 KNOCK_FRICTION, 見 v2-terrain)

export const SPAWN = [{ x: 5 * TILE, y: 14 * TILE }, { x: 24 * TILE, y: 14 * TILE }];
export const COLORS = ['#5e8bff', '#ff6b6b'];
export const NAMES = ['藍法師', '紅法師'];

// --- 收容測試 (spec F §2): 揮拳削穩定值 → 擊暈 → 抓 → 拖進實驗艙 = 收容 ---
export const POD = { x: W / 2, y: H / 2, r: 46 };
export const STAB_MAX = 100, STAB_REGEN = 28;
export const PUNCH_RANGE = 46, PUNCH_CONE = 0.9; // 揮拳零位移(受擊=純踉蹌);位移只屬於指定攻擊(終結技/風壓/爆桶)
// 三連擊:左鉤→右鉤→浮誇直拳(終結技)。點擊就接段(空揮也演),超窗 0.9s 才重置
export const COMBO_STAB = [20, 20, 35], COMBO_CD = [0.35, 0.35, 0.6], COMBO_WINDOW = 0.9;
export const FINISHER_KNOCK = 240; // 終結技=指定攻擊:小擊退拉開距離,重置節奏
// 格擋推開:被打中後 PUSH_WIN 秒內按格擋鍵 → 把攻擊方推開+踉蹌,斷 combo;冷卻 PUSH_CDT
export const PUSH_WIN = 0.55, PUSH_CDT = 3, PUSH_RANGE = 70, PUSH_FORCE = 380, PUSH_STAGGER = 0.45, AI_PUSH_CHANCE = 0.22;
export const STUN_T = 1.2, STUN_RECOVER = 40, RESTUN_IMMUNE = 0.6;
export const GRAB_RANGE = 46, CARRY_SLOW = 0.6, REGRAB_CD = 0.6;
export const CARRY_ESCAPE_NEED = 100, CARRY_MASH_AI = 30, CARRY_MASH_TAP = 8; // AI 掙脫≈3.3s(玩家反饋:AI 太強,45→30);人類左右交替每下+8
// AI 人味缺陷(玩家反饋「AI 太強」:人類贏不了零反應延遲的機器):
export const AI_PUNCH_CHANCE = 0.6;   // 進範圍時每次機會只有 6 成真的出拳(否則猶豫 0.3s 再說)
export const AI_GRAB_DELAY = 0.55;    // 看到你暈 → 要 0.55s「反應時間」才抓(也給玩家看清教練提示的窗口)
export const AI_BACKOFF_T = 0.55;     // 出拳後後撤喘息時間(給玩家反打窗口)
export const FUMBLE_T = 0.5, ESCAPE_STAB = 50;
export const BODY_SEP = 0.8;   // 角色實心圈 = (r+r)*BODY_SEP:視覺貼近到體素肩碰肩才停
export function inPod(x, y) { return Math.hypot(x - POD.x, y - POD.y) <= POD.r; }

// --- 危險 #1:爆桶。靠近→點燃→爆炸:炸飛+削弱穩定值 ---
export const BARREL_IGNITE = 28, BARREL_FUSE = 0.5, BARREL_BLAST = 95, BARREL_FORCE = 700, BARREL_STAB = 50, BARREL_RESPAWN = 6;
export const BARREL_SPOTS = [[300, 210], [660, 210], [300, 470], [660, 470]];
export const barrels = BARREL_SPOTS.map(([x, y]) => ({ x, y, r: 13, state: 'idle', fuse: 0, alive: true, respawn: 0 }));
export function resetBarrels() { for (const b of barrels) { b.state = 'idle'; b.fuse = 0; b.alive = true; b.respawn = 0; } }

// --- 道具系統 (spec F §3/§4): 補給座撿即用, 只拿 1, 用完即空 ---
export const ITEM_TYPES = ['wind', 'teleport', 'ice'];
export const ITEM_INFO = { wind: { name: '風壓手套', color: '#bfeaff' }, teleport: { name: '傳送符', color: '#c98cff' }, ice: { name: '冰霜瓶', color: '#9fd8ff' } };
export const PAD_SPOTS = [[480, 140], [480, 500]]; // 補給座:上下中線(避開角落爆桶與中央實驗艙)
export const PAD_RESPAWN = 5, PICKUP_R = 26;
export const WIND_RANGE = 150, WIND_CONE = 1.0, WIND_FORCE = 620, WIND_SELF = 180; // 貼臉(<50)發射自身反彈=風壓過載
export const TP_BLINK = 150, TP_JITTER = 20;
export const ICE_R = 60, ICE_DUR = 5, ICE_THROW = 120, ICE_ACCEL = 7, ICE_FRICTION = 0.6;
export const SLIDE_CONTAIN_V = 200; // 失控入艙:被擊退/打滑速度 > 此值且進艙半徑 = 收容(spec F §2.2)
export function randItem() { return ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)]; }
export const pads = PAD_SPOTS.map(([x, y]) => ({ x, y, r: 14, item: randItem(), respawn: 0 }));
export function resetPads() { for (const p of pads) { p.item = randItem(); p.respawn = 0; } }
export const iceZones = []; // { x, y, r, life }
export function iceAt(x, y) { for (const z of iceZones) if (Math.hypot(x - z.x, y - z.y) <= z.r) return true; return false; }

// --- 三階段收容升級 (spec F §2.5) 的資料表 ---
export const STAGE_NAME = ['普通', '黃色警戒', '全面失控'];
export const STAGE_BANNER = ['臨時收容成功！樣本逃逸', '高危險樣本再收容！基地警戒升級'];
export const METHOD_COL = { carry: '#8fb6ff', wind: '#bfeaff', ice: '#9fd8ff', barrel: '#ff9a4a', reverse: '#c98cff' };
export const METHOD_ZH = { carry: '搬', wind: '吹', ice: '滑', barrel: '爆', reverse: '反向' };
export const WIN_TARGET = 3;

// --- 跨模組可重賦值純量(唯一容器;一律 v2s.x 讀寫) ---
export const v2s = {
  stage: 1,                                  // 收容階段 1..3
  barrelRespawnCur: BARREL_RESPAWN, barrelFuseCur: BARREL_FUSE, // 階段升級後的現值(*Cur)
  padRespawnCur: PAD_RESPAWN, slideContainCur: SLIDE_CONTAIN_V,
  matchOver: false, report: null,            // 對局結束旗標 + 事故報告物件
  winnerPid: -1, winBannerT: 0, bannerText: '', // 階段/封存橫幅
  localFlash: 0,                             // 本機被打的紅屏脈衝
  fallReason: '', fallReasonT: 0,            // isles:「為什麼掉下去」讀出
};
export function resetStage() { v2s.stage = 1; v2s.barrelRespawnCur = BARREL_RESPAWN; v2s.barrelFuseCur = BARREL_FUSE; v2s.padRespawnCur = PAD_RESPAWN; v2s.slideContainCur = SLIDE_CONTAIN_V; }
export function applyStage(s) { // 危險升級:用現有爆桶+補給座+艙吸力(門檻)
  v2s.stage = s;
  if (s >= 2) { v2s.barrelRespawnCur = 4; v2s.barrelFuseCur = 0.4; v2s.padRespawnCur = 4; }
  if (s >= 3) { v2s.barrelRespawnCur = 3; v2s.slideContainCur = 150; } // 艙吸力變強
}

// --- fighters ---
export function makeFighter(pid) {
  const f = { pid, type: 'brawler', r: 19, color: COLORS[pid], score: 0, state: 'alive', ai: false }; // 關節化體素小人(render.js 'brawler') (hitbox scales with r)
  resetFighter(f);
  return f;
}
export function resetFighter(f) {
  const sp = SPAWN[f.pid];
  f.x = sp.x; f.y = sp.y;
  f.vx = 0; f.vy = 0;
  f.facing = f.pid === 0 ? 0 : Math.PI; // face toward the centre
  f.faceT = 0; f.falling = false; f.fallT = 0; f.spin = 0; f.voidT = 0;
  f.hurt = 0; f.lastHitBy = -1; f.lastHitT = -9;
  f.stability = STAB_MAX; f.stabCd = 0;
  f.stunned = false; f.stunT = 0; f.restunT = 0;
  f.carrying = null; f.carriedBy = null; f.escape = 0; f.mashSide = 0; f._aPrev = false; f._dPrev = false;
  f.punchCd = 0; f.regrabCd = 0; f.fumbleT = 0; f.wasCarryingT = -9; f.invuln = 0;
  f.punchFx = -9; f.punchArm = 0; f.punchKind = 0; // 出拳動畫:時間戳+用哪隻手+段數(0左鉤/1右鉤/2終結直拳)
  f.flinchT = 0; f.flinchA = 0;   // 受擊反應:朝受力方向甩頭+壓扁回彈 (render 吃這兩個)
  f.comboN = 0; f.comboT = 0;     // 連段:下一拳是第幾段 / 接段窗口
  f.pushWinT = 0; f.pushCd = 0; f.pushFrom = null; f._aiPushAt = 0; // 格擋推開:窗口/冷卻/攻擊者/AI排程
  f._aiGrabAt = 0; f._aiSkipUntil = 0; f._aiBackoffUntil = 0; // AI 人味缺陷計時器
  f.item = null;
  f.state = 'alive';
}
export const fighters = [makeFighter(0), makeFighter(1)];
fighters[1].ai = false; // AI 預設關閉:開場紅方是練習假人,按 B 啟動 AI(HUD 常駐顯示目前狀態)

// --- 對局進度 + 事故計數器 ---
export const roundWins = [0, 0];
export const containLog = []; // { winner, method, stage } per containment → 三格 UI + 報告三幕
export const inc = { falls: [0, 0], knockoffs: [0, 0], selfFalls: [0, 0], types: new Set(), matchT: 0,
  contains: [0, 0], overloads: 0, selfPods: 0, barrelBooms: 0, itemUses: { wind: 0, teleport: 0, ice: 0 },
  carries: [0, 0], accidentContains: { wind: 0, ice: 0, barrel: 0 }, reverseContains: 0, teleportEscapes: 0, struggleEscapes: 0, itemBackfires: 0, pushOffs: 0 };
export function resetInc() {
  inc.contains = [0, 0]; inc.overloads = 0; inc.selfPods = 0; inc.barrelBooms = 0; inc.itemUses = { wind: 0, teleport: 0, ice: 0 };
  inc.carries = [0, 0]; inc.accidentContains = { wind: 0, ice: 0, barrel: 0 }; inc.reverseContains = 0; inc.teleportEscapes = 0; inc.struggleEscapes = 0; inc.itemBackfires = 0;
  inc.types = new Set(); inc.matchT = 0; inc.pushOffs = 0;
}

// --- 有界跟隨攝影機的代理點 + 夾界(見 v2.js updateCamRig 說明) ---
export const camRig = { x: SPAWN[0].x, y: SPAWN[0].y };
export const CAMB = { ix: 250, ny: 190, sy: 500, ease: 8 }; // ny 190:靠北時多看到一點北帶元素站 // ix=左右夾界(跟隨玩家 X，兩側牆內留邊), ny/sy=北/南夾界, ease=平滑
