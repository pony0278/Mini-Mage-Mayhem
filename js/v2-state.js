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
// 跑=預設(brawl-2,使用者拍板 2026-07-15:亂鬥節奏玩家永遠要快,雙擊觸發退役):
// 桌機=有方向鍵就是跑;手機=搖桿推程 < RUN_STICK 走(微操走位)、≥ RUN_STICK 跑(touchInput.mag)。
// 走路只剩情境:冰面 ICE_WALK / 扛人扛桶 CARRY_SLOW(瓶=輕,照跑)。
export const RUN_MULT = 1.6, RUN_STICK = 0.85;
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
// 漫畫打擊爆花分級(hitfx-1;fx.addBurst 的參數包,v2-combat 命中時挑一檔):
// 顏色=打擊類型(拳=橘白/打暈=琥珀/挑飛=橘白最大/反擊=金/下壓=紅白);重擊帶速度線+白閃、挑飛加集中線。
export const HIT_BURST = {
  hook:    { size: 22, col: '#ff8a3a', life: 0.2 },                                        // 鉤拳:小爆花
  fin:     { size: 32, col: '#ff8a3a', life: 0.24, streaks: 4, flash: 0.3 },               // 終結技(第三拳)
  stun:    { size: 40, col: '#ffb300', life: 0.28, streaks: 5, flash: 0.45 },              // 打暈那拳
  launch:  { size: 46, col: '#ff8a3a', life: 0.3, streaks: 6, flash: 0.5, focus: true },   // 挑飛 launcher(最大檔)
  counter: { size: 42, col: '#ffd700', life: 0.28, streaks: 5, flash: 0.45 },              // 反擊拳=金
  dive:    { size: 40, col: '#ff4a4a', life: 0.28, streaks: 5, flash: 0.4 },               // 下壓拳=紅
  dash:    { size: 30, col: '#ff8a3a', life: 0.22, streaks: 3, flash: 0.2 },               // 衝刺攻擊(帶線=有衝勁)
};
// 頓點分級(feel-3,多玩家反饋「打擊頓點可再加強」):玩家動詞的 hitstop 全走這張表(×v2s.hitstopMul)。
// 舊況=散落 0.08~0.14 且 fx 硬帽 0.12,輕重只差 1.5×(反擊 0.14/封存 0.4 從未生效);
// 現=輕重差 2.6×(格鬥慣例):普通<衝刺<下壓<終結<挑飛<打暈<反擊。hitstop 凍結 game.time=所有計時一起凍,
// 連段拍子相對關係不變,只是重的那拳世界多停一下。環境事故(桶爆/毒爆/站)不進表=不跟玩家動詞搶戲。
export const HIT_STOP = { punch: 0.10, dash: 0.14, dive: 0.16, fin: 0.18, launch: 0.20, stun: 0.22, counter: 0.26, block: 0.05, seal: 0.4 };
// brawl-3 連段黏臉:三連擊全中 = 剛好一次暈(25+25+50=STAB_MAX 100),讀作「連段接滿=暈」。
// 有穩定值時所有拳只踉蹌不位移(黏在臉上,連段接得到暈);打暈那拳=原地;對「已暈」的對手出拳才=挑飛(launcher)。
export const COMBO_STAB = [25, 25, 50], COMBO_CD = [0.35, 0.35, 0.6], COMBO_WINDOW = 0.9;
// 出拳承諾(feel-2,使用者拍板 2026-07-16「不要邊轉邊滑步像溜冰芭蕾」):承諾期=**整段揮拳動畫**
// (起手 _strikeAt>0 + 收招 _recoverT 未到=clip 播完為止;只鎖起手時 impact 後還有 0.3s 順勢在揮,照樣轉身穿幫)。
// 承諾期間:面向硬鎖在出拳方向+移動 ×PUNCH_MOVE(0=腳釘住;嫌連段追不上人可調 0.2 重滑步)+不能跳/舉防。
// 連段不變笨重:接段按鍵(punchCd 到)可在收招中直接取消進下一拳(方向取當下瞄準);道具施法也取消收招。
// 衝刺/下壓有自己的承諾位移=不吃鎖腳。
export const PUNCH_MOVE = 0;
// 收招時長=clip 全長 − impact 幀(自動導出,同 STRIKE_DELAY;揮空=整段動畫的真懲罰窗)。[3][4]=dive/dash 自有懲罰,不用此表。
export const PUNCH_RECOVER = PUNCH_CLIPS.map((n, i) => { const c = CLIPS[n]; return c?.impactT != null ? c.dur - c.impactT : [0.3, 0.3, 0.367, 0, 0][i]; });
// 傷害對齊動作的 impact 影格(玩家反饋階段:真格鬥手感):點擊=起手,STRIKE_DELAY 秒後才判定命中。
// **自動導出**:直接讀各 punch clip 的第一個 impact key(prepClip.impactT)——studio 重編移動 impact 幀,
// 重貼 JSON 即對齊,不再手動同步(舊值 fallback 防 clip 缺 impact)。
// 起手期間被打暈/被抓/被推開踉蹌 → 打擊取消(格擋推開從此是真反制)。
export const STRIKE_DELAY = PUNCH_CLIPS.map((n, i) => CLIPS[n]?.impactT ?? [0.283, 0.233, 0.383, 0.3, 0.22][i]); // [3]=dive_punch/[4]=dash_punch 槽(實際用 DIVE_T/DASH_T,見下)
// 終結技=打飛:命中後小拋物線(最後一擊→擊中→打飛→落地),取代舊滑行擊退(FINISHER_KNOCK 240)。
// 與丟人同一條彈道管線(f._lob 記 profile);調性=「挑空」:往前短、往上明顯、滯空久掛在空中。
// 調參史:100/18/0.35(zmax≈34,嫌飛遠不夠高)→ 55/50/0.4(zmax≈65)→ 現值=使用者 ?tune 實測定稿(zmax≈115)。
export const PUNCH_LAUNCH_LOB = { range: 18, apex: 100, T: 0.6, h0: 30 }; // feel-6 使用者反饋:range 80 拋太遠(落地相距 ~130px vs 拳觸及 65)連擊接不上——改豎直挑空(GetAmped launcher):對手在面前被挑上天,全程在拳觸及內=可浮空補拳/落地接抓
// --- 跳躍+下壓拳(brawl-2,使用者拍板 2026-07-15:空白=跳/Shift=防;走位技術入遊戲)---
// 跳躍=自發小 lob(z 走 v2.js 同一套 lobZ 管線;range 0=垂直,水平位移靠移動+空中操控)。
// 空中規則:免地板化學+免冰面鎖滑(=冰滑主動解)、不可防/抓/被抓;空中挨拳=AIR_HIT_LOB 小翻滾落地。
export const JUMP_LOB = { range: 0, apex: 46, T: 0.55, h0: 0 };
export const AIR_CTRL = 0.55;      // 空中操控率(移動輸入 × 此係數)
export const JUMP_CD = 0.22;       // 落地後可再跳的間隔(防兔子跳刷屏;計時含滯空)
export const AIR_HIT_LOB = { range: 70, apex: 40, T: 0.45, h0: 30 }; // 空中挨拳=小翻滾(拍蚊子)
// 下壓拳:空中按攻擊=鎖方向俯衝,DIVE_T 後落地幀 AoE 判定(排程打擊 kind 3)。重擊穿防(剋龜,
// 補完三角:防禦剋連拳、下壓剋防禦、格擋反暈剋出手);落空=DIVE_LAG 硬直(有承諾才有讀取)。
// DIVE_T 由 dive_punch clip 的 impact 幀自動導出(同 STRIKE_DELAY 機制;使用者編好 clip 即對齊)。
export const DIVE_T = CLIPS.dive_punch?.impactT ?? 0.3;
export const DIVE_R = 44;          // 落點 AoE 半徑
export const DIVE_STAB = 45;       // 削穩定(> 終結技 35=獎勵讀位,兩發即暈)
export const DIVE_FWD = 46;        // 俯衝前撲距離(往起跳鎖定的 facing)
export const DIVE_LAG = 0.2;       // 落空硬直(移動鎖;命中無硬直)
export const DIVE_CD = 0.6;        // 下壓後拳冷卻
export const AI_JUMP_CHANCE = 0.012, AI_JUMP_CD = 4; // AI 每幀起跳率(中距離對峙時)+ 冷卻;起跳後半程自動下壓
// 衝刺攻擊(feel-1,使用者拍板 2026-07-16:跑+攻擊——中性=連段/跑=衝刺/空中=下壓,移動×攻擊矩陣補完)。
// 跑=預設的觸發衝突解法:持續跑 ≥ DASH_RUN_T 才進「衝刺狀態」,此時出拳=前衝突進拳(遠距衝鋒=自帶預告);
// 貼身短移動=普通連段。單發不入連段、可被擋(擋下照樣開反擊窗=融入三角);揮空=滑過頭+冷卻(位置懲罰)。
export const DASH_RUN_T = 0.4;      // 持續跑多久=衝刺狀態
export const DASH_T = CLIPS.dash_punch?.impactT ?? 0.22; // 起手(dash_punch clip impact 自動導出;暫用 rhook 頂)
export const DASH_LUNGE = 88;       // 起手期間前衝距離(px;滑步突進,揮空就滑過頭)
export const DASH_STAB = 30;        // 削穩定(> 鉤拳 25、< 下壓 45)
export const DASH_KNOCK = 300;      // 命中擊退(唯一帶位移的普通命中=衝擊感)
export const DASH_CD = 0.7;         // 出招後拳冷卻(+滑過頭=揮空懲罰窗)
// 格擋推開:被打中後 PUSH_WIN 秒內按格擋鍵 → 把攻擊方推開+踉蹌,斷 combo;冷卻 PUSH_CDT
export const PUSH_WIN = 0.55, PUSH_CDT = 3, PUSH_RANGE = 70, PUSH_FORCE = 380, PUSH_STAGGER = 0.45, AI_PUSH_CHANCE = 0.22;
// 反擊拳(brawl-3.1 改制,使用者拍板 2026-07-15:讓玩家自己體會,不再有慢動作/灰屏/大字提示)：
// 先「按住 Shift 成功擋下」對手的鉤拳 → 開一個反擊窗口 = 擋下後停頓 COUNTER_DELAY(逼你別狂按),
// 停頓過後的 COUNTER_WIN 內按「左鍵出拳」= 反擊拳=反暈攻擊者;太早按=喪失窗口、太晚=過期。
// 唯一線索=擋下瞬間的 hitstop(手感抓,無 UI 提示)。AI 不舉防→不會反擊(玩家專屬)。
// 終結技穿防不可擋→不可反擊(反擊只從擋下鉤拳來)。
export const COUNTER_DELAY = 0.1;   // 擋下後的停頓(這段內按左鍵=太早,喪失反擊)
export const COUNTER_WIN = 0.25;    // 停頓過後的反擊窗口長度(緊=自己體會)
// 按住防禦架式(2026-07):隨時可舉防、擋普通鉤拳(前兩段);終結技+元素穿防;耐力耗盡=破防。
// 空按不再進冷卻(改由耐力當防呆閘門)。數值 ?tune=1 可調。
export const GUARD_MOVE = 0;            // 舉防時移動倍率(0=定身;想拉開就得放防)
export const GUARD_STAM_MAX = 100;
export const GUARD_DRAIN = 67;          // 純守耐力衰退(/s);滿值 100÷67 ≈ 1.5s 見底(玩家反饋:別太長)
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
// --- AI 階級檔案(tier-1,使用者拍板 2026-07-20:對手=實習生→快輸逃跑搬救兵→資深同事)---
// 行為=旋鈕表(不寫 N 套 AI):aiMove 讀 AI_PROFILE[v2s.aiTier] 取代散常數。之後領班/廠長=加列(campaign)。
// 旋鈕:punchChance 進範圍真出拳率 / hesitate 猶豫秒 / backoffT 打完後撤 / grabDelay 看到暈的反應 /
// jumpChance 跳攻率 / guard 會不會讀起手舉防 / comboDrop 連段中途放棄率(實習生=連段不完整)。
export const AI_PROFILE = {
  intern: { name: '實習生',   punchChance: 0.35, hesitate: 0.6,  backoffT: 1.1, grabDelay: 1.2, jumpChance: 0,               guard: false, comboDrop: 0.5 },
  senior: { name: '資深同事', punchChance: 0.75, hesitate: 0.22, backoffT: 0.4, grabDelay: 0.4, jumpChance: AI_JUMP_CHANCE,  guard: true,  comboDrop: 0 },
};
// 實習生逃跑(可被追擊,不是過場):被收容 WIN_TARGET−1 次後、穩定值 ≤ FLEE_STAB → 跑向最近場邊出口
// (AI 逃跑=進跑速 ×FLEE_SPEED,略慢於玩家=衝刺/風壓/冰瓶才好攔;暈/抓/收容照常有效=追上他直接完賽)。
// 到出口=白煙消失,CALL_T 後資深同事同點進場(比分保留,只差最後一收但對手變強)。一場一次(v2s.aiCalled)。
export const FLEE_STAB = 50, FLEE_SPEED = 0.95, CALL_T = 2.0;
export const FLEE_EXITS = [[44, H / 2], [W - 44, H / 2], [W / 2, 44], [W / 2, H - 44]]; // 四側牆內緣出口
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
// 撞牆彈跳騰空(玩家反饋:桶被吹亂但沒翻—讓「夠快的桶撞牆反彈」那段騰空跳起翻滾):地面高速桶撞牆 → 短弧跳起(空中=快速自旋)→ 落地。
// apex·4p(1−p)=貼地起落純跳弧(h0=0);min=觸發下限(慢滾不跳);T=騰空時長。
export const BARREL_WALL_HOP = { min: 250, apex: 45, T: 0.4 };
export const BARREL_SPOTS = [[110, 235], [850, 235]];   // 2026-07-21 貼牆:左右牆邊(元素站角與側閘拉桿之間的空檔;讓開中央戰鬥區)
export const barrels = BARREL_SPOTS.map(([x, y]) => ({ x, y, r: 13, state: 'idle', fuse: 0, alive: true, respawn: 0, charge: null, held: false, vx: 0, vy: 0, thrownBy: -1, armGrace: 0, flyT0: -9, landed: true, z: 0, dropT0: -9, dropZ0: 0, hopT0: -9, roll: 0 }));
export function resetBarrels() { for (const b of barrels) { b.state = 'idle'; b.fuse = 0; b.alive = true; b.respawn = 0; b.charge = null; b.held = false; b.vx = 0; b.vy = 0; b.thrownBy = -1; b.armGrace = 0; b.flyT0 = -9; b.landed = true; b.z = 0; b.dropT0 = -9; b.dropZ0 = 0; b.hopT0 = -9; b.roll = 0; } }

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
// 總開關(§10.1):緊急拉桿控制台。玩家反饋 2026-07:原本埋在中央回收艙圓環內違反場景直覺 → 移到場地左右兩側牆邊。
// 左右各一支拉桿,揍任一支都 arm 四站洩漏循環(armed 真相=v2s.stationsArmed,單向不可關);開局平靜。避開東西中線的爆桶(200/760)。
export const labSwitches = [
  { x: 80, y: 320, r: 16 },   // 左側牆邊
  { x: 880, y: 320, r: 16 },  // 右側牆邊
];
export function resetStations() { for (const s of stations) { s.state = 'idle'; s.warnT = 0; } v2s.stationsArmed = false; }

// --- 道具系統 (spec F §3/§4): 補給座=裝備類(拿在手上按右鍵發動);投擲類(冰/油瓶)改場上物件,見下方 bottles ---
export const ITEM_TYPES = ['wind', 'teleport', 'fire', 'water', 'lightning'];
export const ITEM_INFO = { wind: { name: '風壓手套', color: '#bfeaff' }, teleport: { name: '傳送符', color: '#c98cff' }, fire: { name: '噴火帽', color: '#ff7a3a' }, water: { name: '工業重錘', color: '#4da6ff' }, lightning: { name: '魔導電鞭', color: '#9fd0ff' }, ice: { name: '冰霜瓶', color: '#9fd8ff' }, oil: { name: '潤滑油瓶', color: '#c9a86a' } }; // ice/oil 只剩名字/顏色(瓶 prop 的浮字/標記沿用)
// 道具規格表(單一真相來源;分類=正交欄位,見 docs/v2-item-cast-system.md)。骨架階段 clip:null/delay:0
// = 全部瞬發(行為不變),等 studio 動畫到位再逐列填 clip+delay(=impact 幀÷60,同 STRIKE_DELAY)。
//   uses=次數 · clip/delay=施放動畫與 impact · whileDisabled=被抓/暈可用(取代寫死的 !=='teleport')
//   aim=facing/self/target(未來瞄準用) · kind=純標籤(HUD/AI/文件分組;機制不靠它)
export const ITEM_SPEC = {
  wind:     { uses: 3, clip: 'item_wind', delay: CLIPS.item_wind?.impactT ?? STRIKE_DELAY[0], whileDisabled: false, aim: 'facing', kind: 'blast' }, // 專屬施放動畫(使用者 studio 定稿 2026-07-23,腕 Z 側掌外推);delay=clip impact 幀自動導出,未標 impact=維持 0.283s 原時序(預告窗+可被打斷)
  fire:     { uses: 2, clip: 'rhook', delay: STRIKE_DELAY[0], whileDisabled: false, aim: 'facing', kind: 'blast' }, // 噴火帽=噴流(rhook 暫代;點燃油海=R1)
  water:    { uses: 2, clip: 'rhook', delay: STRIKE_DELAY[0], whileDisabled: false, aim: 'facing', kind: 'blast' }, // 工業重錘=前方砸壓(rhook 暫代砸下 clip;造濕地=R2 接雷、砸中短擊倒)
  lightning:{ uses: 2, clip: 'rhook', delay: STRIKE_DELAY[0], whileDisabled: false, aim: 'facing', kind: 'blast' }, // 魔導電鞭=直線電擊(rhook 暫代;命中線內=電擊暈、沿線給水充電 R2)
  teleport: { uses: 1, clip: null, delay: 0, whileDisabled: true,  aim: 'self',   kind: 'mobility' },
};
export const ITEM_CAST_RECOVER = 0.18; // 排程施放後的恢復(承諾冷卻);瞬發道具(delay:0)不套用
export const PAD_SPOTS = [[480, 140], [480, 500]]; // 補給座:上下中線(避開角落爆桶與中央實驗艙)
export const PAD_RESPAWN = 5, PICKUP_R = 26;
// 手動撿道具(2026-07,C 案):補給座改按鍵撿;被暈(逃脫類 whileDisabled 除外)道具噴到地上=掉落物,可撿/搶,TTL 到自然消失。
export const GROUND_ITEM_TTL = 8;
export const groundItems = []; // 地上掉落道具 { x, y, type, uses, ttl };round reset 清空
export function resetGroundItems() { groundItems.length = 0; }
// 風壓手套=遠距離扇形放射狀衝擊波(2026-07 重設計):錐內 → 力 = WIND_FORCE × 距離衰減(1−d/RANGE) × 角度衰減(1−|θ|/CONE),
// 方向=從手心往外放射(正中往前全力、兩側斜著吹歪、遠處衰減)。近端窄遠端寬的扇形自動成立(錐從手心張開)。一發同時吹對手/桶/飛行冰瓶。
export const WIND_RANGE = 320, WIND_CONE = 1.0, WIND_FORCE = 620; // RANGE=射程(遠程定位)/CONE=半張角±57°(夠寬才「整片」)/FORCE=中心近處峰值(>失控門檻→吹進艙)
// 吹翻滾(玩家反饋 2026-07:別滑行、要暴風翻滾):風力 > MIN 的近中心命中 → 接拋飛管線=趴滾+爬起(非直立滑行);
// 弱命中(邊緣/遠)只吹歪踉蹌。JITTER=每目標方向亂數擾動(±rad)=吹亂不齊步。低弧(h0/apex 小=貼地滾非過頂丟)。
export const WIND_TUMBLE_MIN = 300, WIND_TUMBLE_JITTER = 0.38;
export const WIND_TUMBLE_LOB = { range: 0, apex: 34, T: 0.5, h0: 12 };
// brawl-3 空中接送:風壓打到「已騰空」的對手(挑飛/跳/翻滾中)=乾淨接送——往瞄準方向平飛直送、
// 不墊穩定、幾乎不亂(地面吹飛才吹亂),讓對手一路飛進回收艙、沒有落地反擊。是「連段收尾」的入口。
export const WIND_CARRY_LOB = { range: 0, apex: 26, T: 0.55, h0: 22 };
export const TP_BLINK = 150, TP_JITTER = 20;
export const ICE_R = 90;             // 冰面半徑(玩家反饋 2026-07:加大=溜冰場);壽命=FLOOR_LIFE.ice
// 鎖滑(玩家反饋 2026-07):帶動量踩冰=鎖直線滑到撞牆暈(舊 ICE_ACCEL/ICE_FRICTION 低摩擦模型退場)
export const SLIDE_MIN = 220;        // 鎖滑最低速度(> SLIDE_CONTAIN_V 200 → 滑進艙自動符合失控收容)
export const SLIDE_KNOCK_V = 120;    // 冰上擊退速度超過此值 → 也觸發鎖滑(被打上冰/冰上挨打/摔落冰面)
export const ICE_WALK = 0.4;         // 靜止站上冰(如冰凍醒來)的小心走速度倍率=逃生口,不觸發鎖滑
export const OIL_R = 100;            // 油膜半徑(比冰面略大=好鋪、好引燃連段)
// 噴火帽=貼臉短扇形(2026-07 使用者反饋:採風壓扇形判定但射程極短)。噴火**不留地形火**——
// 只點燃扇內既有油(R1 火海=油+火專屬連段;乾淨地板噴過去只有火光,不殘留 fire tile);直擊錐內目標=著火 DoT+可暈。
export const FIRE_RANGE = 100, FIRE_CONE = 0.72;                    // 短貼臉扇形(RANGE≈3.1 tile,半張角 ±41°;起手預告扇形教範圍)
export const FIRE_HIT_STAB = 18, FIRE_BURN_T = 1.2, FIRE_BURN_DPS = 70; // 命中即扣 18 + 著火 1.2s×70≈84(合計 ~102=從滿條可燒到暈);burn 在 floorHazards 續燒
// 工業重錘=前方砸壓 AoE(2026-07,原「盾」改造):懸手→砸下(rhook 暫代)→ 落點圓形範圍造濕地(接雷=R2 電水)+
// 砸中對手=短擊倒(好抓送進艙,設計文件砸壓定位)+ 徑向擊退。落點在面前 SLAM_DIST 處(起手預告畫圓圈教範圍)。
export const WATER_SLAM_DIST = 48, WATER_R = 70, WATER_KNOCK = 240, WATER_STAB = 30; // 落點距離/AoE+濕地半徑/擊退/削穩定
// 魔導電鞭=直線電擊(2026-07 使用者:攻擊範圍只能直線)。MVP=一發直線電擊(§9.1#4;纏住拉近後補)。
// 沿面向一條窄長線:命中線內對手=電擊擊暈(元素穿防)+ 沿線給水地板充電(R2 電水陷阱)。起手預告畫直線教範圍。
export const LIGHTNING_RANGE = 260, LIGHTNING_WIDTH = 20, LIGHTNING_KNOCK = 140; // 射程/線半寬(命中判定,含對手 r)/電擊小擊退
export const SLIDE_CONTAIN_V = 200; // 失控入艙:被擊退/打滑速度 > 此值且進艙半徑 = 收容(spec F §2.2)
// 補給座刷新加權(裝備類專用;投擲瓶改場上物件後退出這張表)。調各道具出現率只動這張表。
export const ITEM_WEIGHT = { wind: 2, fire: 2, water: 2, lightning: 2, teleport: 1 };
export function randItem() {
  let total = 0; for (const t of ITEM_TYPES) total += ITEM_WEIGHT[t] || 1;
  let r = Math.random() * total;
  for (const t of ITEM_TYPES) { r -= ITEM_WEIGHT[t] || 1; if (r < 0) return t; }
  return ITEM_TYPES[ITEM_TYPES.length - 1];
}
export const pads = PAD_SPOTS.map(([x, y]) => ({ x, y, r: 14, item: randItem(), respawn: 0 }));
export function resetPads() { for (const p of pads) { p.item = randItem(); p.respawn = 0; } }

// --- 投擲瓶=場上物件(2026-07 朋友反饋定案:投擲類全走爆桶動詞——撿了丟、一次性、高頻刷新;
// 玩家只要學兩條規則:場上物件=撿起來丟、發光裝備=拿在手上按右鍵)。物理共用桶管線(carryObj/風吹/翻滾),
// kind:'bottle' 分支碎裂行為:瓶=脆(丟出落地/硬撞牆/硬撞人/被拳打/被爆炸波及 全都碎=蓋元素地板;冰瓶硬砸中人=直擊冰凍)。
export const BOTTLE_LOB = { range: 180, apex: 34, T: 0.5, h0: 58 }; // 丟瓶拋物線(同 LOB 語言,?tune/控制台可即時調)
export const BOTTLE_BREAK_V = 170;   // 地面硬撞碎裂門檻(px/s):走路推(BARREL_PUSH 130)不碎、風吹/丟出滑行必碎
// 瓶 respawn 時長改走 bottleRespawnT()(4~6s 隨機=稀缺窗;見下方憲章供料模型)
// §12.5 羅盤分區:對角中帶(桶=東西中線、補給座=南北中線、元素站=四角、艙=中心)。對角配對:油-冰交叉。
// 供料(2026-07-21 使用者拍板:場上投擲物收斂=冰霜瓶+爆桶,重心讓給肉搏+道具連招;再收:全貼牆散角落,中央淨空):
// 4 個瓶位全冰、塞四角深袋(外於角落元素站;元素多樣性交給元素站/桶充能/裝備道具);respawn 同型不換(randGarbage 退役,表留給 HUD 名稱)。
export const BOTTLE_SPOTS = [[95, 95, 'ice'], [865, 95, 'ice'], [95, 545, 'ice'], [865, 545, 'ice']];
export const bottles = BOTTLE_SPOTS.map(([x, y, elem]) => ({ kind: 'bottle', x, y, x0: x, y0: y, r: 9, elem, alive: true, respawn: 0, held: false, vx: 0, vy: 0, thrownBy: -1, flyT0: -9, landed: true, z: 0, roll: 0, _smash: false }));
export function resetBottles() { for (const t of bottles) { t.x = t.x0; t.y = t.y0; t.alive = true; t.respawn = 0; t.held = false; t.vx = 0; t.vy = 0; t.thrownBy = -1; t.flyT0 = -9; t.landed = true; t.z = 0; t.roll = 0; t._smash = false; } }

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

// --- 垃圾瓶=戰鬥道具(四型元素瓶:砸人=冰凍/著火/電弧/毒地板;分類玩法凍結在 B 款=4c92837,docs/game-split.md)---
export const GARBAGE_ELEMS = ['fire', 'ice', 'poison', 'lightning']; // 四型垃圾瓶(毒不換水——毒綠 vs 冰青可辨、水留給重錘)
export const GARBAGE_NAME = { fire: '火焰廢料', ice: '冰霜廢料', poison: '黏液污染物', lightning: '帶電零件' };
export const GARBAGE_ICON = { fire: '🔥', ice: '❄️', poison: '🧪', lightning: '⚡' };
export function randGarbage(not) { const p = GARBAGE_ELEMS.filter(e => e !== not); return p[Math.floor(Math.random() * p.length)]; }
export const BOTTLE_RESPAWN_MIN = 4, BOTTLE_RESPAWN_MAX = 6;       // 碎/清運後 respawn 窗(秒)
export function bottleRespawnT() { return BOTTLE_RESPAWN_MIN + Math.random() * (BOTTLE_RESPAWN_MAX - BOTTLE_RESPAWN_MIN); }
export const INTRO_T = 3.6;                  // 開場總長(秒;v2s.introT 遞減):就位期(雙方靜止+目標字幕+鏡頭框兩人)→「開始!」
export const INTRO_GO = 0.9;                 // 尾段「開始!」閃字時長;introT<=INTRO_GO 起 AI 開始行動(使用者拍板:AI 一動玩家就懂)

// --- 回收演出 V0.8(使用者演出設計文檔 2026-07:收容後的招牌喜劇演出)---
// 使用者拍板:不鎖定勝方、不動 follow cam;敗方 snap 艙心+玻璃罩+掃描+艙口 LED 分類字,收尾才彈回/封存。
export const PERFORM_T = [2.1, 2.6, 3.6];      // 第 1/2/3 次收容演出總長(秒;文檔 §1.4 節奏上限內)
export const PERFORM_DOME_R = 56;              // 玻璃罩半徑(世界px;蓋住艙圈 POD.r=46,留在 GLB 輪盤 r87 內)
export const WASTE_CLASS = {                    // 分類結果(文檔 §三;依敗方本場拿過的道具個人化,免費一層笑點)
  fire: '易燃魔法廢棄物', lightning: '帶電廢棄物', water: '潮濕超標廢棄物',
  wind: '易飄散廢棄物', teleport: '空間不穩定廢棄物', none: '高危險魔法廢棄物',
};

// --- 跨模組可重賦值純量(唯一容器;一律 v2s.x 讀寫) ---
export const v2s = {
  stage: 1,                                  // 收容階段 1..3
  barrelRespawnCur: BARREL_RESPAWN, barrelFuseCur: BARREL_FUSE, // 階段升級後的現值(*Cur)
  padRespawnCur: PAD_RESPAWN, slideContainCur: SLIDE_CONTAIN_V,
  stationTimer: STATION_INTERVAL, stationIntervalCur: STATION_INTERVAL, lastStationIdx: -1, // 元素站輪替(隨機不連續)
  stationsArmed: false,                       // 總開關:開局平靜,揍左右任一緊急拉桿(labSwitches)才 arm 四站循環(單向)
  matchOver: false, report: null,            // 對局結束旗標 + 事故報告物件
  winnerPid: -1, winBannerT: 0, bannerText: '', // 階段/封存橫幅
  localFlash: 0,                             // 本機被打的紅屏脈衝
  hitstopMul: 1,                             // 頓點全域倍率(feel-3;?tune=1 打擊感滑桿,HIT_STOP 表 × 此值)
  aiTier: 'intern', aiCalled: false, aiCallAt: 0, aiCallPos: null, // AI 階級(tier-1):現任檔案/逃跑已演過/資深進場排程時刻+位置
  fallReason: '', fallReasonT: 0,            // isles:「為什麼掉下去」讀出
  lowFlicker: false,                         // 減閃爍(光敏無障礙):L 鍵切換,localStorage 記憶;3D 脈動由 render 的 setLabFlicker 吃
  perform: null,                             // 收容演出狀態機(v2-combat startPerform/updatePerform;null=沒在演)
  tutorial: false,                           // 首局教學旗標(v2.js 依 localStorage 設;示範者 AI + 容錯 + 完整教學提示)
  introT: 0,                                 // 開場目標字幕/鏡頭帶場的倒數(>0=演出中;v2.js step 遞減)
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
  f.burnT = 0; f.burnBy = -1;        // 著火 DoT(噴火帽直擊殘留;不靠地形):floorHazards 每幀削穩定→歸零暈
  f.stability = STAB_MAX; f.stabCd = 0;
  f.stunned = false; f.stunT = 0; f.restunT = 0;
  f.carrying = null; f.carriedBy = null; f.escape = 0; f.mashSide = 0; f._aPrev = false; f._dPrev = false;
  f.punchCd = 0; f.regrabCd = 0; f.fumbleT = 0; f.wasCarryingT = -9; f.invuln = 0;
  f.punchFx = -9; f.punchArm = 0; f.punchKind = 0; // 出拳動畫:時間戳+用哪隻手+段數(0左鉤/1右鉤/2終結直拳)
  f.flinchT = 0; f.flinchA = 0;   // 受擊反應:朝受力方向甩頭+壓扁回彈 (render 吃這兩個)
  f.comboN = 0; f.comboT = 0;     // 連段:下一拳是第幾段 / 接段窗口
  f.pushWinT = 0; f.pushCd = 0; f.pushFrom = null; f._aiPushAt = 0; // 格擋推開:窗口/冷卻/攻擊者/AI排程
  f._aiGrabAt = 0; f._aiSkipUntil = 0; f._aiBackoffUntil = 0; // AI 人味缺陷計時器
  f._aiMode = 'fight';               // AI 對手=純戰鬥(B 款示範者/同事 AI 凍結在 4c92837)
  f._fleeing = false; f._fleeTo = null; // 實習生逃跑(tier-1):逃跑中旗標+目標出口(FLEE_EXITS 之一)
  f._thrownT = -9; f._aiThrowAt = 0; // 被拋出的時間戳(翻滾入艙判定) / AI 投擲排程
  f.running = false;                 // 跑=預設:v2.js step 每幀裁定(有移動輸入+沒扛重物=跑;手機看推程)
  f._jumpT = -9; f.jumpCd = 0;       // 跳躍:起跳時戳(z=lobZ(t,JUMP_LOB),v2.js 每幀算)+ 再跳冷卻
  f._diveT0 = -9; f._diveZ0 = 0; f._diveDir = 0; f._diveLagT = 0; // 下壓拳:俯衝起始戳/起始高度/鎖定方向/落空硬直
  f._aiJumpAt = 0; f._aiDiveAt = 0;  // AI 跳躍排程(對峙起跳/半程下壓)
  f._runT = 0; f._dashT0 = -9; f._dashDir = 0; // 衝刺攻擊:持續跑計時(v2.js 每幀)/突進起始戳/鎖定方向
  f.frozen = false;                  // 冰凍皮(=暈的視覺變體:render 冰塊+不搖晃;stun 醒來時清)
  f._slideVx = 0; f._slideVy = 0; f._onIce = false; f._slideT = -9; // 鎖滑:滑行向量(≠0=鎖定中)/上幀在冰上/滑行起始戳(收容歸因)
  f._lob = null;                     // 這次被拋飛用的彈道 profile(丟人=PERSON_LOB/終結技=PUNCH_LAUNCH_LOB;null 退回 PERSON_LOB)
  f.z = 0;                           // 被拋飛的 sim 高度(B 案彈道;v2.js step 每幀由 lobZ 算,判定 gate+render 都讀它)
  f._carryThrowAt = 0; f.carryClip = null; f.carryFx = -9; f.carryHold = 0; // 排程丟人 + 拎頭 heave clip 時鐘 + hold 定格秒(0=不定格)
  f._strikeAt = 0; f._strikeKind = 0; f._strikeDir = 0; f._recoverT = 0; // 排程中的打擊(impact 影格判定)+ 收招承諾到期時刻
  f._counterFrom = null; f._counterAt = -9;              // 反擊拳:擋下後記攻擊者 + 反擊窗口開啟時刻(game.time+COUNTER_DELAY)
  f.guarding = false; f.guardStam = GUARD_STAM_MAX; f.guardLock = 0; f.guardRegenT = 0; // 按住防禦架式:是否舉防/耐力/破防鎖定/回充延遲計時
  f._performing = false; f._hidden = false;             // 收容演出:被罩在艙心(v2.js 迴圈凍結) / 壓縮後隱藏(render 不畫)
  if (f._lastItem === undefined) f._lastItem = null;     // 本場拿過的最後一種道具(演出分類字用;跨回合保留,restartMatch 清)
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
  contains: [0, 0], overloads: 0, selfPods: 0, barrelBooms: 0, itemUses: { wind: 0, teleport: 0, fire: 0, water: 0, lightning: 0 },
  carries: [0, 0], accidentContains: { wind: 0, ice: 0, barrel: 0 }, reverseContains: 0, teleportEscapes: 0, struggleEscapes: 0, itemBackfires: 0, pushOffs: 0,
  throws: [0, 0], throwContains: 0, parries: 0, cleaned: [0, 0] };
export function resetInc() {
  inc.contains = [0, 0]; inc.overloads = 0; inc.selfPods = 0; inc.barrelBooms = 0; inc.itemUses = { wind: 0, teleport: 0, fire: 0 };
  inc.carries = [0, 0]; inc.accidentContains = { wind: 0, ice: 0, barrel: 0 }; inc.reverseContains = 0; inc.teleportEscapes = 0; inc.struggleEscapes = 0; inc.itemBackfires = 0;
  inc.types = new Set(); inc.matchT = 0; inc.pushOffs = 0; inc.throws = [0, 0]; inc.throwContains = 0; inc.parries = 0; inc.cleaned = [0, 0];
}

// --- 有界跟隨攝影機的代理點 + 夾界(見 v2.js updateCamRig 說明) ---
export const camRig = { x: SPAWN[0].x, y: SPAWN[0].y };
export const CAMB = { ix: 250, ny: 190, sy: 500, ease: 8 }; // ny 190:靠北時多看到一點北帶元素站 // ix=左右夾界(跟隨玩家 X，兩側牆內留邊), ny/sy=北/南夾界, ease=平滑
