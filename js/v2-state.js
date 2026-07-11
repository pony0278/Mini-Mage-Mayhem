// v2 的狀態與調參中心 (docs/v2-module-boundaries.md §3/§4)。
// - 全部 tuning 常數與資料表都住這裡:改手感數值永遠只開這個檔案。
// - 共享可變單例(fighters/inc/pads/barrels/containLog/roundWins/camRig)
//   沿用「原地變異、永不重新賦值」(同 state.js 的 game)。
// - 跨模組可重賦值純量集中在 v2s 物件(唯一的純量容器;模組頂層不 export let)。
import { W, H, TILE } from './constants.js';
// 判定時刻自動同步:動作 clip 的 impact/release/hold tag = 時序常數的單一真相(brawler-clips 是純資料模組,
// 不碰 render/DOM,sim headless 測試照樣可 import)。studio 移幀→重貼 JSON→常數自動跟,不再手動對時鐘。
import { CLIPS, PUNCH_CLIPS } from './brawler-clips.js';

export const LOCAL = 0;        // the human-controlled fighter (camera follows it)
export const DEBUG = true;     // console event log (open DevTools) — copy lines to report issues
export const dlog = (...a) => { if (DEBUG) console.log('[v2]', ...a); };

// --- 基礎調參 ---
export const SPEED = 168;      // walk speed (px/s)
// 跑步:同方向鍵(WASD)在 RUN_TAP 秒內連按 2 次 → 按住期間 ×RUN_MULT(放開/扛人/扛桶/暈=停)。
// RUN_TAP=0.28 對齊準拍脈衝格(docs/v2-combat-rhythm.md);桌面鍵盤限定(觸控搖桿無雙擊語意,先不做)。
export const RUN_MULT = 1.6, RUN_TAP = 0.28;
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
// 傷害對齊動作的 impact 影格(玩家反饋階段:真格鬥手感):點擊=起手,STRIKE_DELAY 秒後才判定命中。
// **自動導出**:直接讀各 punch clip 的第一個 impact key(prepClip.impactT)——studio 重編移動 impact 幀,
// 重貼 JSON 即對齊,不再手動同步(舊值 fallback 防 clip 缺 impact)。
// 起手期間被打暈/被抓/被推開踉蹌 → 打擊取消(格擋推開從此是真反制)。
export const STRIKE_DELAY = PUNCH_CLIPS.map((n, i) => CLIPS[n]?.impactT ?? [0.283, 0.233, 0.383][i]);
// 終結技=打飛:命中後小拋物線(最後一擊→擊中→打飛→落地),取代舊滑行擊退(FINISHER_KNOCK 240)。
// 與丟人同一條彈道管線(f._lob 記 profile);調性=「挑空」:往前短、往上明顯、滯空久掛在空中。
// 調參史:100/18/0.35(zmax≈34,嫌飛遠不夠高)→ 55/50/0.4(zmax≈65)→ 現值=使用者 ?tune 實測定稿(zmax≈115)。
export const PUNCH_LAUNCH_LOB = { range: 80, apex: 100, T: 0.6, h0: 30 };
// 格擋推開:被打中後 PUSH_WIN 秒內按格擋鍵 → 把攻擊方推開+踉蹌,斷 combo;冷卻 PUSH_CDT
export const PUSH_WIN = 0.55, PUSH_CDT = 3, PUSH_RANGE = 70, PUSH_FORCE = 380, PUSH_STAGGER = 0.45, AI_PUSH_CHANCE = 0.22;
// 精準格擋(節奏遊戲反擊):對手出拳預測會命中且你格擋可用 → 黃金窗口=對方起手期(STRIKE_DELAY),
// 本機時間放慢 PARRY_SLOW 倍+灰屏,窗口內按格擋鍵=反暈對方;超時挨打後按=普通推開;空按=進冷卻。
// 同一顆鍵三層結果,時機決定一切。AI 不會精準格擋(玩家專屬爽點;難度分級再說)。
export const PARRY_SLOW = 0.3;
// 按住防禦架式(2026-07):隨時可舉防、擋普通鉤拳(前兩段);終結技+元素穿防;耐力耗盡=破防。
// 空按不再進冷卻(改由耐力當防呆閘門)。數值 ?tune=1 可調。
export const GUARD_MOVE = 0;            // 舉防時移動倍率(0=定身;想拉開就得放防)
export const GUARD_STAM_MAX = 100;
export const GUARD_DRAIN = 10;          // 純守耐力衰退(/s);~10s 見底
export const GUARD_BLOCK_COST = 20;     // 每擋一拳扣的耐力(~5 拳)
export const GUARD_REGEN = 28, GUARD_REGEN_DELAY = 0.4; // 放開後 delay 才回充(/s)
export const GUARD_BLOCK_PUSH = 130, GUARD_BLOCK_FLINCH = 0.14; // 擋下=防守方輕微後仰+被推一小步
export const GUARD_BREAK_FUMBLE = 0.6, GUARD_BREAK_LOCK = 1.2;  // 破防:踉蹌 + 之後不能再舉防的鎖定
export const STUN_T = 1.2, STUN_RECOVER = 40, RESTUN_IMMUNE = 0.6;
export const GRAB_RANGE = 46, CARRY_SLOW = 0.6, REGRAB_CD = 0.6;
// 投擲(B 案:sim 真高度彈道)。三參數語言(人/桶/未來道具同一套,加投擲物=加一行):
//   range=落點距離(px)、apex=弧頂追加高(px)、T=滯空秒、h0=離手高(過頂丟的手高)。
//   水平速度 vh=range/T(空中無摩擦=直線飛);z 走閉式曲線 lobZ(免積分飄移、回放安全)。
// z 感知規則(全稽核表在 docs/v2-carry-throw-system.md §5.2):空中=人飛越對手(跳過身體阻擋)、
//   桶低於 BARREL_HIT_Z 才撞人引爆;牆仍擋(撞牆=z 快落 0.1s);飛越艙口=入艙(空中灌籃)。
export const PERSON_LOB = { range: 200, apex: 32, T: 0.5, h0: 58 };
export const BARREL_LOB = { range: 180, apex: 34, T: 0.5, h0: 58 };
export const LAND_SKID = 0.25;      // 落地保留的水平速度比(人=短滑/桶=滾動收尾)
export const WALL_BOUNCE = 0.35;    // 空中撞牆的反彈係數(法向速度反轉×此值:彈一小下就快落,不硬停懸空)
// 桶撞人=兩拍(可讀性:45° 視角讀不出弧高,任何高度碰到都算——取代舊 z 門檻直擊):
// 第一拍 bonk(砸中:-BONK 穩定+踉蹌)→ 桶水平歸零、DROP_T 秒快落 → 落地重置引信。
export const BARREL_BONK_STAB = 15, BARREL_DROP_T = 0.15;
// 心智模型一句話:「被丟的桶=落地閃 LAND_FUSE 秒才爆」(玩家反饋:落地即爆太快,沒有反制窗口)。
// 任何落地(自然/砸中快落/撞牆快落)都把引信重置成 LAND_FUSE → telegraph 閃圈自動有(fuse 狀態)。
// 博弈:爆風 95px、速度 168px/s → 1s 剛好逃得出去;被砸暈眩=跑不掉 → 先暈再丟=真連段。
// 地面滾動中碰到人維持直接爆(滾動接觸看得見,即爆可讀)。揍桶升壓(原地 BARREL_FUSE 爆)不受影響。
export const BARREL_LAND_FUSE = 1.0;
// 閉式彈道高度:t 秒(相對起飛)→ z(px)。t<0 或 ≥T 回 0(未起飛/已落地)。
export function lobZ(t, lob) { if (!(t >= 0) || t >= lob.T) return 0; const p = t / lob.T; return lob.h0 * (1 - p) + lob.apex * 4 * p * (1 - p); }
// 出手速度(range/T)與翻滾時長(T+0.1)不再是衍生常數——各 launch 點出手當下由 LOB 現算,
// 所以 ?tune=1 滑桿 / 控制台改 `__v2.PERSON_LOB.range = …` 即時生效(LOB 物件=唯一真相)。
// 扛/丟人動畫時序(person_throw clip):抓起就播「reach→grab→lift→翻橫」(0→hold 幀)然後**定格在 hold 幀**
// (舉過頭頂+打橫)扛著走;按丟才續播 hold→release 甩飛。
// **自動導出**:hold=clip 的 'hold' tag(缺席退回最後一個 grab tag)、release='release' tag。
// studio 重編時把定格幀標 tag 'hold'、甩出幀標 'release',重貼 JSON 即對齊(舊值 16f/22f fallback)。
const _pt = CLIPS.person_throw;
export const PERSON_HOLD_T = _pt?.tags.hold ?? _pt?.tagsLast.grab ?? 16 / 60;
export const PERSON_THROW_DELAY = (_pt?.tags.release ?? 22 / 60) - PERSON_HOLD_T;
export const AI_THROW_DIST = 220, AI_THROW_PANIC = 60, AI_THROW_DELAY = 0.3; // AI:近艙穩丟/掙脫快滿恐慌丟(可能丟歪),帶反應延遲(≈彈道射程 260 內留裕度)
export const CARRY_ESCAPE_NEED = 100, CARRY_MASH_AI = 30, CARRY_MASH_TAP = 8; // AI 掙脫≈3.3s(玩家反饋:AI 太強,45→30);人類左右交替每下+8
// AI 人味缺陷(玩家反饋「AI 太強」:人類贏不了零反應延遲的機器):
export const AI_PUNCH_CHANCE = 0.6;   // 進範圍時每次機會只有 6 成真的出拳(否則猶豫 0.3s 再說)
export const AI_GRAB_DELAY = 0.55;    // 看到你暈 → 要 0.55s「反應時間」才抓(也給玩家看清教練提示的窗口)
export const AI_BACKOFF_T = 0.55;     // 出拳後後撤喘息時間(給玩家反打窗口)
export const FUMBLE_T = 0.5, ESCAPE_STAB = 50;
export const BODY_SEP = 0.8;   // 角色實心圈 = (r+r)*BODY_SEP:視覺貼近到體素肩碰肩才停
export function inPod(x, y) { return Math.hypot(x - POD.x, y - POD.y) <= POD.r; }

// --- 危險 #1:不穩定魔力廢料桶 (docs/v2-element-floor-chemistry.md §12)。受攻擊/被丟→升壓 1s→大擊飛+種地板。
// charge = 桶下的元素地板(idle 時吸收,爆時決定爆種+污染);null = 野生隨機爆。被動近距引爆已拿掉。
export const BARREL_FUSE = 1.0, BARREL_BLAST = 95, BARREL_FORCE = 700, BARREL_STAB = 50, BARREL_RESPAWN = 6;
export const BARREL_PATCH_R = 40;                       // 爆後污染地板的小塊半徑(~1.3 tile)
export const WILD_CONTAM = ['oil', 'water', 'poison'];  // 未充能=野生隨機污染(不含火,免整場失火)
// 步驟 B:可推/撿/丟。丟出初速、滾動摩擦(快衰減=不永遠滾)、推力、撞擊引爆前的安全延遲。
export const BARREL_FRICTION = 0.02, BARREL_PUSH = 130, BARREL_ARM_GRACE = 0.15; // 丟桶水平初速=launchBarrel 由 BARREL_LOB 現算(空中無摩擦;落地 ×LAND_SKID 變滾動)
// 丟桶=排程動作:按下→播雙手過頂 heave 動畫(itemClip 'barrel_throw')→ release 幀才真的甩出。
// **自動導出**:= clip 的 release tag 秒數(studio 移 release 幀→重貼 JSON 即對齊;舊值 22f fallback)。
export const BARREL_THROW_DELAY = CLIPS.barrel_throw?.tags.release ?? 22 / 60;
export const BARREL_SPOTS = [[200, 320], [760, 320]];   // §12.5 羅盤分區:東西中線(避開補給台南北/元素站角/艙中)
export const barrels = BARREL_SPOTS.map(([x, y]) => ({ x, y, r: 13, state: 'idle', fuse: 0, alive: true, respawn: 0, charge: null, held: false, vx: 0, vy: 0, thrownBy: -1, armGrace: 0, flyT0: -9, landed: true, z: 0, dropT0: -9, dropZ0: 0 }));
export function resetBarrels() { for (const b of barrels) { b.state = 'idle'; b.fuse = 0; b.alive = true; b.respawn = 0; b.charge = null; b.held = false; b.vx = 0; b.vy = 0; b.thrownBy = -1; b.armGrace = 0; b.flyT0 = -9; b.landed = true; b.z = 0; b.dropT0 = -9; b.dropZ0 = 0; } }

// --- 危險 #2:四角元素站洩漏 (docs/v2-element-floor-chemistry.md §10)。輪流噴發:預警 3s → 徑向脈衝 + 殘留元素地板。
// 落點=可玩四角(§10.4);火/冰/毒 種地板,雷=無地板電擊擊暈(raw arc)。總開關(B 刀)arm 循環;A 刀先 always-on。
export const STATION_WARN = 3.0;        // 預警秒數(收縮環倒數)
export const STATION_INTERVAL = 10;     // 每次噴發間隔(階段升級縮短)
export const ERUPT_PATCH_R = 80;        // 噴發範圍 / 殘留地板半徑(~2.5 tile)
export const ERUPT_PULSE = 450, ERUPT_STAB = 30; // 瞬間徑向擊退 + 削穩定值(中等,有 3s 預警)
export const stations = [
  { x: 150, y: 150, elem: 'fire',      state: 'idle', warnT: 0 }, // 西北
  { x: 810, y: 150, elem: 'ice',       state: 'idle', warnT: 0 }, // 東北
  { x: 150, y: 490, elem: 'poison',    state: 'idle', warnT: 0 }, // 西南
  { x: 810, y: 490, elem: 'lightning', state: 'idle', warnT: 0 }, // 東南
];
// 總開關(§10.1):貼近清運口的緊急控制台,揍它一下 arm 四站循環,單向不可關;開局平靜。
export const labSwitch = { x: 480, y: 250, r: 16, armed: false };
export function resetStations() { for (const s of stations) { s.state = 'idle'; s.warnT = 0; } labSwitch.armed = false; v2s.stationsArmed = false; }

// --- 道具系統 (spec F §3/§4): 補給座撿即用, 只拿 1, 用完即空 ---
export const ITEM_TYPES = ['wind', 'teleport', 'ice'];
export const ITEM_INFO = { wind: { name: '風壓手套', color: '#bfeaff' }, teleport: { name: '傳送符', color: '#c98cff' }, ice: { name: '冰霜瓶', color: '#9fd8ff' } };
// 道具規格表(單一真相來源;分類=正交欄位,見 docs/v2-item-cast-system.md)。骨架階段 clip:null/delay:0
// = 全部瞬發(行為不變),等 studio 動畫到位再逐列填 clip+delay(=impact 幀÷60,同 STRIKE_DELAY)。
//   uses=次數 · clip/delay=施放動畫與 impact · whileDisabled=被抓/暈可用(取代寫死的 !=='teleport')
//   aim=facing/self/target(未來瞄準用) · kind=純標籤(HUD/AI/文件分組;機制不靠它)
export const ITEM_SPEC = {
  wind:     { uses: 3, clip: null, delay: 0, whileDisabled: false, aim: 'facing', kind: 'blast' },
  // 冰霜瓶改版(使用者拍板 2026-07):舉頭上拋出(barrel_throw 暫代;之後換專屬拋瓶 clip)→ ICE_LOB
  // 拋物線 → 落地/撞牆即碎 → 冰面。×3=技能彈(文件 §9.1.1 原 ×1;可拋瞄準後升 A 階用量,實測調)。
  // 排程施放管線的第一個真實用戶:clip+delay 填表即接(delay=release tag 自動導出)。
  ice:      { uses: 3, clip: 'barrel_throw', delay: BARREL_THROW_DELAY, whileDisabled: false, aim: 'facing', kind: 'hazard' },
  teleport: { uses: 1, clip: null, delay: 0, whileDisabled: true,  aim: 'self',   kind: 'mobility' },
};
export const ITEM_CAST_RECOVER = 0.18; // 排程施放後的恢復(承諾冷卻);瞬發道具(delay:0)不套用
export const PAD_SPOTS = [[480, 140], [480, 500]]; // 補給座:上下中線(避開角落爆桶與中央實驗艙)
export const PAD_RESPAWN = 5, PICKUP_R = 26;
export const WIND_RANGE = 150, WIND_CONE = 1.0, WIND_FORCE = 620, WIND_SELF = 180; // 貼臉(<50)發射自身反彈=風壓過載
export const TP_BLINK = 150, TP_JITTER = 20;
export const ICE_R = 90;             // 冰面半徑(玩家反饋 2026-07:加大=溜冰場);壽命=FLOOR_LIFE.ice;ICE_THROW(舊固定前放距離)已由 ICE_LOB 拋物線取代
// 鎖滑(玩家反饋 2026-07):帶動量踩冰=鎖直線滑到撞牆暈(舊 ICE_ACCEL/ICE_FRICTION 低摩擦模型退場)
export const SLIDE_MIN = 220;        // 鎖滑最低速度(> SLIDE_CONTAIN_V 200 → 滑進艙自動符合失控收容)
export const SLIDE_KNOCK_V = 120;    // 冰上擊退速度超過此值 → 也觸發鎖滑(被打上冰/冰上挨打/摔落冰面)
export const ICE_WALK = 0.4;         // 靜止站上冰(如冰凍醒來)的小心走速度倍率=逃生口,不觸發鎖滑
// 冰瓶拋物線(B 案三參數;同 LOB 語言,?tune=1/控制台可即時調)。瓶=脆:落地/撞牆即碎(桶=悶,落地閃 1s 才爆——材質對比)。
export const ICE_LOB = { range: 180, apex: 34, T: 0.5, h0: 58 };
export const itemProjectiles = []; // 拋擲道具投擲物(冰瓶;{ x,y,vx,vy,flyT0,z,elem,alive });round reset 清空
export const SLIDE_CONTAIN_V = 200; // 失控入艙:被擊退/打滑速度 > 此值且進艙半徑 = 收容(spec F §2.2)
export function randItem() { return ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)]; }
export const pads = PAD_SPOTS.map(([x, y]) => ({ x, y, r: 14, item: randItem(), respawn: 0 }));
export function resetPads() { for (const p of pads) { p.item = randItem(); p.respawn = 0; } }

// --- 地板化學壽命 (docs/v2-floor-state-architecture.md §3.1;危險度↔壽命反比:鋪陳長/佈場中/主動殺傷短) ---
// key 對齊 v2-floor.js 的 FL.* 狀態字串;charged_water = 電荷壽命(到期退回水,不重置水的底料時鐘)。
export const FLOOR_LIFE = { oil: 10, water: 10, poison: 8, ice: 8, fire: 4, charged_water: 4 }; // 秒
export const FLOOR_WARN = 1; // 最後 1s 進入閃爍預警(render 吃 cell.warn)
// 地板危險對角色(第二刀):stability→0 = 擊暈 = 好抓 = 收容路徑(火/毒不直接扣血,削穩定值)。
export const FIRE_STAB_DPS = 60;   // 站火海每秒削穩定值(~1.7s 從滿到暈)
export const POISON_STAB_DPS = 32; // 站毒區較慢(慌張計時器,逼離開;不是主力擊殺)
export const POISON_BURST_R = 72, POISON_BURST_STAB = 45, POISON_BURST_FORCE = 260; // 毒爆一次性 AoE

// --- 三階段收容升級 (spec F §2.5) 的資料表 ---
export const STAGE_NAME = ['普通', '黃色警戒', '全面失控'];
export const STAGE_BANNER = ['臨時收容成功！樣本逃逸', '高危險樣本再收容！基地警戒升級'];
export const METHOD_COL = { carry: '#8fb6ff', throw: '#ffd36d', wind: '#bfeaff', ice: '#9fd8ff', barrel: '#ff9a4a', reverse: '#c98cff' };
export const METHOD_ZH = { carry: '搬', throw: '拋', wind: '吹', ice: '滑', barrel: '爆', reverse: '反向' };
export const WIN_TARGET = 3;

// --- 跨模組可重賦值純量(唯一容器;一律 v2s.x 讀寫) ---
export const v2s = {
  stage: 1,                                  // 收容階段 1..3
  barrelRespawnCur: BARREL_RESPAWN, barrelFuseCur: BARREL_FUSE, // 階段升級後的現值(*Cur)
  padRespawnCur: PAD_RESPAWN, slideContainCur: SLIDE_CONTAIN_V,
  stationTimer: STATION_INTERVAL, stationIntervalCur: STATION_INTERVAL, lastStationIdx: -1, // 元素站輪替(隨機不連續)
  stationsArmed: false,                       // 總開關:開局平靜,揍中央控制台(labSwitch)才 arm 四站循環(單向)
  matchOver: false, report: null,            // 對局結束旗標 + 事故報告物件
  winnerPid: -1, winBannerT: 0, bannerText: '', // 階段/封存橫幅
  localFlash: 0,                             // 本機被打的紅屏脈衝
  fallReason: '', fallReasonT: 0,            // isles:「為什麼掉下去」讀出
  lowFlicker: false,                         // 減閃爍(光敏無障礙):L 鍵切換,localStorage 記憶;3D 脈動由 render 的 setLabFlicker 吃
};
export function resetStage() { v2s.stage = 1; v2s.barrelRespawnCur = BARREL_RESPAWN; v2s.barrelFuseCur = BARREL_FUSE; v2s.padRespawnCur = PAD_RESPAWN; v2s.slideContainCur = SLIDE_CONTAIN_V; v2s.stationIntervalCur = STATION_INTERVAL; v2s.stationTimer = STATION_INTERVAL; v2s.lastStationIdx = -1; }
export function applyStage(s) { // 危險升級:用現有爆桶+補給座+艙吸力(門檻)
  v2s.stage = s;
  if (s >= 2) { v2s.barrelRespawnCur = 4; v2s.barrelFuseCur = 0.7; v2s.padRespawnCur = 4; v2s.stationIntervalCur = 7; }
  if (s >= 3) { v2s.barrelRespawnCur = 3; v2s.slideContainCur = 150; v2s.stationIntervalCur = 5; } // 艙吸力變強 + 元素站更頻
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
  f._thrownT = -9; f._aiThrowAt = 0; // 被拋出的時間戳(翻滾入艙判定) / AI 投擲排程
  f.running = false; f._runKey = null; f._tapKey = ''; f._tapT = -9; // 跑步:同鍵連按2次觸發(v2.js keydown 記 tap、step 每幀裁定)
  f.frozen = false;                  // 冰凍皮(=暈的視覺變體:render 冰塊+不搖晃;stun 醒來時清)
  f._slideVx = 0; f._slideVy = 0; f._onIce = false; f._slideT = -9; // 鎖滑:滑行向量(≠0=鎖定中)/上幀在冰上/滑行起始戳(收容歸因)
  f._lob = null;                     // 這次被拋飛用的彈道 profile(丟人=PERSON_LOB/終結技=PUNCH_LAUNCH_LOB;null 退回 PERSON_LOB)
  f.z = 0;                           // 被拋飛的 sim 高度(B 案彈道;v2.js step 每幀由 lobZ 算,判定 gate+render 都讀它)
  f._carryThrowAt = 0; f.carryClip = null; f.carryFx = -9; f.carryHold = 0; // 排程丟人 + 拎頭 heave clip 時鐘 + hold 定格秒(0=不定格)
  f._strikeAt = 0; f._strikeKind = 0; f._strikeDir = 0; // 排程中的打擊(impact 影格判定)
  f.parryWinT = 0; f.parryWin0 = 0; f.parryFrom = null;  // 精準格擋黃金窗口(剩餘/總長/攻擊者)
  f.guarding = false; f.guardStam = GUARD_STAM_MAX; f.guardLock = 0; f.guardRegenT = 0; // 按住防禦架式:是否舉防/耐力/破防鎖定/回充延遲計時
  f.item = null; f.itemUses = 0;                        // 道具型別 + 剩餘次數
  f.carryObj = null;                                    // 扛著的物件(廢料桶;與 carrying=扛人 互斥)
  f._barrelThrowAt = 0;                                 // 排程丟桶(release 幀甩出;0=沒在丟)
  f._itemCastAt = 0; f._itemCastType = null;            // 排程施放(impact 幀觸發效果)
  f.itemFx = -9; f.itemClip = null; f.itemCastCd = 0;   // 施放動畫時鐘/clip + 承諾冷卻
  f.state = 'alive';
}
export const fighters = [makeFighter(0), makeFighter(1)];
fighters[1].ai = false; // AI 預設關閉:開場紅方是練習假人,按 B 啟動 AI(HUD 常駐顯示目前狀態)

// --- 對局進度 + 事故計數器 ---
export const roundWins = [0, 0];
export const containLog = []; // { winner, method, stage } per containment → 三格 UI + 報告三幕
export const inc = { falls: [0, 0], knockoffs: [0, 0], selfFalls: [0, 0], types: new Set(), matchT: 0,
  contains: [0, 0], overloads: 0, selfPods: 0, barrelBooms: 0, itemUses: { wind: 0, teleport: 0, ice: 0 },
  carries: [0, 0], accidentContains: { wind: 0, ice: 0, barrel: 0 }, reverseContains: 0, teleportEscapes: 0, struggleEscapes: 0, itemBackfires: 0, pushOffs: 0,
  throws: [0, 0], throwContains: 0, parries: 0 };
export function resetInc() {
  inc.contains = [0, 0]; inc.overloads = 0; inc.selfPods = 0; inc.barrelBooms = 0; inc.itemUses = { wind: 0, teleport: 0, ice: 0 };
  inc.carries = [0, 0]; inc.accidentContains = { wind: 0, ice: 0, barrel: 0 }; inc.reverseContains = 0; inc.teleportEscapes = 0; inc.struggleEscapes = 0; inc.itemBackfires = 0;
  inc.types = new Set(); inc.matchT = 0; inc.pushOffs = 0; inc.throws = [0, 0]; inc.throwContains = 0; inc.parries = 0;
}

// --- 有界跟隨攝影機的代理點 + 夾界(見 v2.js updateCamRig 說明) ---
export const camRig = { x: SPAWN[0].x, y: SPAWN[0].y };
export const CAMB = { ix: 250, ny: 190, sy: 500, ease: 8 }; // ny 190:靠北時多看到一點北帶元素站 // ix=左右夾界(跟隨玩家 X，兩側牆內留邊), ny/sy=北/南夾界, ease=平滑
