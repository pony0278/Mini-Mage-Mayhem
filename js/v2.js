// v2.html 的膠水層 (docs/v2-module-boundaries.md):輸入(鍵盤/滑鼠)、step() 主模擬編排、
// frame() 迴圈、開機(地形/攝影機/render 旗標)、__v2 debug hook。
// 玩法本體住在 v2-* 模組:state(狀態+調參)/terrain(地形)/combat(戰鬥)/items(道具)/
// report(事故報告)/hud(2D 繪製)。單機的 sim.js/render.js/main.js 完全不受 v2 影響。
//
// 歷史:這裡曾是 1000+ 行的單檔原型(陣風把人吹進洞的 laugh-gate 測試),玩法收斂到
// 「魔法事故報告 · 收容測試」(spec E/F)後拆分;舊系統(陣風動詞/搶獎盃 Boss loop)
// 已移除,要考古看 git 歷史。
import { W, H } from './constants.js';
import { game, keys, CAM, touchInput } from './state.js';
import { updateDeathTheater, addText, addRing, updateParticles, updateRings, updateFloatingTexts } from './fx.js';
import { render3D, drawPanicFaces, setIslandMode, setIslandShapes, setWallFade, setFloorParams, setActorShadow, setVividFx, setGroundMarkers, setRichFloor, setLabTheme, setLabFlicker, setApron, setStationsPowered, setPodPerform, setRimGeometry, setRimTeams, setOutlineLow, FX_LOW, setMenuScene, MENU_STATION } from './render.js';
import { initMenu, setMenuVisible, markCleared } from './v2-menu.js';   // camp-0 主選單 DOM 疊層(規格 H §14)
import { playSfx, unlock as unlockAudio } from './audio.js';
import {
  v2s, fighters, LOCAL, dlog, inc, resetInc, roundWins, containLog,
  resetFighter, resetBarrels, resetPads, resetGroundItems, groundItems, resetStage, resetStations,
  POD, inPod, pads, barrels, bottles, resetBottles, ITEM_INFO, ITEM_SPEC, BARREL_BLAST, GRAB_RANGE,
  stations, STATION_WARN, ERUPT_PATCH_R, labSwitches, WIND_RANGE, WIND_CONE, FIRE_RANGE, FIRE_CONE, WATER_SLAM_DIST, WATER_R, LIGHTNING_RANGE,
  RESPAWN, STAB_MAX, STAB_REGEN, STUN_RECOVER, RESTUN_IMMUNE, CARRY_MASH_AI, CARRY_MASH_TAP, CARRY_ESCAPE_NEED, INTRO_T, INTRO_GO,
  PERSON_LOB, BARREL_LOB, PUNCH_LAUNCH_LOB, WIND_CARRY_LOB, BOTTLE_LOB, BURN_LOB, LAND_SKID, lobZ, JUMP_LOB, AIR_HIT_LOB, DIVE_T, RUN_STICK,
  camRig, CAMB, NAMES, AI_PROFILE, RECORD_TARGET, COLORS, FATIGUE,
  CAMP_LEVELS, CAMP_T, CAMP_TIER, CAMP_LEVEL_NAME, applyStage,
} from './v2-state.js';
import { TERRAIN, RIM, ISLANDS, BRIDGES, onSolid, buildArena, buildFlatMap, buildFlatArena } from './v2-terrain.js';
import { moveFighter, punch, resolveStrike, doAction, doGuard, doPushOff, canGuard, updateGuard, startCarry, dropCarry, throwCarried, launchCarried, inThrowFlight, breakFree, stunFighter, updateBurnChain, containByCarry, containByEnviron, endMatch, floorHazards, drainFloorEvents, onSlipperyIce, startPerform, updatePerform, jump, dive, jumping, airborne, applyAiTier, updateAiCall, resolveFall, updateFinisher, updateReject, pressFinisher , setSealHandler,
} from './v2-combat.js';
import { updatePads, updateBarrels, updateBottles, updateStations, updateGroundItems, pickupItem, dropLooseItem, useItem, resolveItemCast, castWind, castTeleport, castFire, castWater, castLightning, shatterBottle, explodeBarrel, barrelChargeColor, elemColor, grabbableBarrel, pickUpBarrel, dropBarrel, throwBarrel, launchBarrel } from './v2-items.js';
import { stepFloor, resetFloor } from './v2-floor.js';
import { drawHud } from './v2-hud.js';
import { CLIPS } from './brawler-clips.js';   // ?clip= 試播入口用(clip 名單+時長)

let prevLocalSolid = true; // track when YOU step off solid ground (isles diagnostics)
let _armedShown = false;       // 四角站通電光環的上次同步值(step 幀尾偵測 v2s.stationsArmed 變化)

// 測試旗 ?grabany=1:免「對手被擊暈」前提,隨時可舉起對手(測扛/丟動畫+avatar rigged 手用)。
// 正常玩法要先揍暈才抓;開這旗只放寬本機玩家的抓取條件,其餘(冷卻/被抓/範圍)照舊。
const GRAB_ANY = new URLSearchParams(location.search).get('grabany') === '1';

// ===== camp-0 主選單(規格 H §14):開機先停在「小人在流水線上幹活」的畫面 =====
// ⚠ **為什麼要多重旗標判斷**:40 支 headless 回歸全都假設「開機即開打」,選單擋在前面會一次全紅。
//   單一訊號太脆(6 支套件沒帶 ?turbo),所以四道獨立訊號任一成立就跳過,再對那 6 支明寫 ?menu=0:
//   ①`?menu=0/1` 明示覆蓋 ②`?turbo`(回歸專用)③`?clip`(動作試播)④`navigator.webdriver`(自動化)
//   ⑤ smokeroom(道具測試間也載 v2.js,不該被選單擋)。
const MENU_ON = (() => {
  const q = new URLSearchParams(location.search).get('menu');
  if (q === '1') return true;
  if (q === '0') return false;
  // ⚠ 自己讀 URL,不引用 TEST_CLIP/TURBO——那兩個 const 宣告在本檔後面,IIFE 立即執行會踩 TDZ。
  const p = new URLSearchParams(location.search);
  if (p.get('clip') || parseInt(p.get('turbo')) > 1) return false;
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  if (/smokeroom/.test(location.pathname)) return false;
  return true;
})();

// 測試旗 ?clip=名字:任意動作 clip 在本機角色上循環試播(WYSIWYG 驗證:studio 編完貼進 CLIPS 直接看,
// 不用先綁玩法頻道)。走 itemClip 頻道(free 時生效;扛人/被扛時讓位給 carry 動畫);對手 AI 凍結免干擾。
// 程式亦可 __v2.playClip(name) 播一次(回傳 clip 秒長,查無名字回 0)。
const TEST_CLIP = new URLSearchParams(location.search).get('clip');

let _clipNextT = 0;
function playClip(name, f = fighters[LOCAL]) {
  const c = CLIPS[name];
  if (!c) { console.warn('[v2] playClip: 無此 clip「' + name + '」;可用:', Object.keys(CLIPS).join(', ')); return 0; }
  f.itemFx = game.time; f.itemClip = name;
  return c.dur;
}

// ===== camp-0 主選單狀態(規格 H §14)=====
// 使用者提案:「主選單的背景就是玩家小人用第三人稱視角,不停在流水線上辛苦地工作;
// 開始遊戲的時候才會跑、準備逃跑下班。」→ 按下開始那一刻=他決定不幹了,動機完全不用文字解釋。
//
// 工作循環怎麼做:**零新動畫**——重複播現有的 `overhand`(下劈)當「敲打/蓋章輸送帶上的貨」。
// ⚠ 無縫循環要對 **`lastKeyT`** 重蓋時戳,不是 `dur`:prepClip 會自動補一段回待機的尾巴
//   (`dur > lastKeyT`),照 dur 重播會先鬆回待機再起手=一頓一頓的。
const MENU_CLIP = 'overhand', MENU_CLIP_GAP = 0.55;   // 每下之間留長一點的喘息=疲憊的重複勞動,不是戰鬥節奏
// ⚠ 這只是**零成本佔位**:overhand(下劈)拿來當「敲打/蓋章輸送帶上的貨」讀得過去,但不是真的工作動作。
//   要更像,走 punch-studio 編一支 `menu_work` 貼進 CLIPS 即可(CLIPS 是可變物件,playClip 依名字查表)。
function enterMenu() {
  v2s.camp.phase = 'menu'; v2s.menuOut = 0; v2s.introT = 0;
  setMenuScene(true); setMenuVisible(true);
  const me = fighters[LOCAL], o = fighters[1 - LOCAL];
  me.x = MENU_STATION.x; me.y = MENU_STATION.y; me.facing = -Math.PI / 2;  // 面向 −Y=北,背對鏡頭=第三人稱
  me.vx = me.vy = 0; me.stunned = false; me.invuln = 99;
  o.state = 'away'; o._hidden = true;                  // 對手退場(沿用逃跑那套隱藏旗),選單只有你一個人
  camRig.x = MENU_FOCUS.x; camRig.y = MENU_FOCUS.y;
  game.camTarget = camRig;
}
let _menuClipT = 0;
function stepMenu(dt) {
  game.time += dt;
  const me = fighters[LOCAL];
  me.x = MENU_STATION.x; me.y = MENU_STATION.y; me.facing = -Math.PI / 2;
  me.vx = me.vy = 0; me.running = false;
  if (game.time >= _menuClipT) {
    const c = CLIPS[MENU_CLIP];
    _menuClipT = game.time + (c ? (c.lastKeyT ?? c.dur) : 1) + MENU_CLIP_GAP;
    playClip(MENU_CLIP, me);
  }
  updateParticles(dt); updateRings(dt); updateFloatingTexts(dt);
  updateCamRig(dt);
}
// 「開始遊戲」:收掉選單 → 對手歸位 → 交還給既有的開場帶場(introT),鏡頭由 menuOut 混過去。
function startGame(opts = {}) {
  if (v2s.camp.phase !== 'menu') return;
  v2s.menuOut = MENU_OUT_T;
  setMenuVisible(false); setMenuScene(false);
  const me = fighters[LOCAL], o = fighters[1 - LOCAL];
  resetFighter(me); resetFighter(o);                   // 回各自出生點(順手清掉選單期的 invuln/面向)
  unlockAudio();                                       // 這一下就是 WebAudio 要的使用者手勢(舊開場是啞的)
  if (opts.overtime) {                                 // 加班模式=舊的無限對戰(封存→事故報告)
    v2s.camp.phase = 'free'; clearMatchState(); applyAiTier('intern');
    v2s.introT = INTRO_T; camRig.x = (me.x + o.x) / 2; camRig.y = (me.y + o.y) / 2;
    return;
  }
  const run = opts.resume ? loadRun() : null;          // 中離續玩:回到當時那一關,鑰匙帶著
  v2s.camp.keys = run ? run.keys : 0;
  v2s.camp.deaths = run ? run.deaths : 0;
  if (!run) clearRun();
  v2s.camp.phase = 'fight';                            // startLevel 需要非 menu 才會存檔
  startLevel(run ? run.level : 1);
}

// ===== 規格 H camp-1:闖關狀態機 =====
// 一句話:**打贏擋路的人 → 拿鑰匙 → 開門下班**。單關的勝負規則完全沿用規格 G(記滿 3 筆 → 終演封存),
// 這一層只負責「封存之後怎麼辦」:過關掉鑰匙 → 下一位進場;敗北就重打本關(鑰匙保留)。
//
// ⚠ **`free` 是舊行為的保留區**(加班模式 + 所有自動化測試):封存 → `endMatch` → 事故報告。
//   闖關只在玩家真的從主選單按下「開始遊戲」後才接管,所以既有 40 支回歸完全不受影響。
const RUN_KEY = 'mmm_camp_run';               // 中離續玩:{ level, keys, deaths }
function saveRun() {
  const c = v2s.camp;
  try {
    if (c.phase === 'free' || c.phase === 'menu') return;
    localStorage.setItem(RUN_KEY, JSON.stringify({ level: c.level, keys: c.keys, deaths: c.deaths }));
  } catch { /* 隱私模式沒有 storage 也能玩 */ }
}
function loadRun() {
  try {
    const r = JSON.parse(localStorage.getItem(RUN_KEY) || 'null');
    if (!r || !(r.level >= 1 && r.level <= CAMP_LEVELS) || !(r.keys >= 0 && r.keys < CAMP_LEVELS)) return null;
    return { level: r.level | 0, keys: r.keys | 0, deaths: r.deaths | 0 };
  } catch { return null; }
}
function clearRun() { try { localStorage.removeItem(RUN_KEY); } catch { /* no storage */ } }

// 開一關:場地/比分全清 → 危險等級綁關卡 → 換上這一關的對手 → 走既有的開場儀式。
function startLevel(n) {
  const c = v2s.camp;
  c.level = Math.min(CAMP_LEVELS, Math.max(1, n)); c.phase = 'fight'; v2s.campT = 0;
  clearMatchState();
  applyStage(c.level);                                   // 規格 H §2:危險等級**綁關卡**,不再由比分推
  applyAiTier(CAMP_TIER[c.level - 1]);                   // camp-4 換成三份 boss 檔案,這條線先接起來
  v2s.introT = INTRO_T;
  camRig.x = (fighters[0].x + fighters[1].x) / 2; camRig.y = (fighters[0].y + fighters[1].y) / 2;
  saveRun();
  dlog('CAMP level', c.level, 'keys', c.keys, 'tier', v2s.aiTier);
}
// 封存接手(v2-combat 的 finalSeal/fallSeal 注入這支)。回 true=闖關已接手,不要跑 endMatch。
function campSeal(winner) {
  const c = v2s.camp;
  if (c.phase !== 'fight') return false;                 // free/加班模式:交還舊路(事故報告)
  if (winner === LOCAL) {                                 // 過關:掉一把鑰匙
    c.keys = Math.min(CAMP_LEVELS, c.keys + 1);
    c.phase = 'keydrop'; v2s.campT = CAMP_T.keydrop;
    v2s.bannerText = '🔑 鑰匙 ' + c.keys + '/' + CAMP_LEVELS + ' 到手'; v2s.winBannerT = 2.2;
  } else {                                                // 敗北:今天不用下班了 → 重打本關
    c.deaths++;
    c.phase = 'retry'; v2s.campT = CAMP_T.retry;
    v2s.bannerText = '今天不用下班了……'; v2s.winBannerT = 2.2;
  }
  saveRun();
  return true;
}
// 節拍推進:掉鑰匙 → 下一位進場 / 三把湊齊 → 走向大門 → 打卡下班。
function stepCamp(dt) {
  const c = v2s.camp;
  if (c.phase === 'fight' || c.phase === 'free' || c.phase === 'menu') return;
  if (v2s.campT > 0) { v2s.campT -= dt; if (v2s.campT > 0) return; }
  if (c.phase === 'keydrop') {
    if (c.keys >= CAMP_LEVELS) {
      c.phase = 'escape'; v2s.campT = CAMP_T.escape;
      v2s.bannerText = '🔑 ' + CAMP_LEVELS + '/' + CAMP_LEVELS + '　大門解鎖'; v2s.winBannerT = 2.4;
    } else {
      c.phase = 'handoff'; v2s.campT = CAMP_T.handoff;
      const nm = CAMP_LEVEL_NAME[c.level] || '';
      v2s.bannerText = '關 ' + (c.level + 1) + ':' + nm; v2s.winBannerT = 2.0;
    }
  } else if (c.phase === 'handoff') {
    startLevel(c.level + 1);
  } else if (c.phase === 'retry') {
    startLevel(c.level);                                  // 鑰匙保留(規格 H §3:敗北零沒收)
  } else if (c.phase === 'escape') {
    // camp-6 會把這裡換成「走到大門 → 打卡演出」;camp-1 先直接進結局,把整條線跑通。
    c.phase = 'clockout'; v2s.matchOver = true; clearRun(); markCleared();
    v2s.bannerText = '下班打卡成功。'; v2s.winBannerT = 4.0;
    game.sfx.push('waveclear'); dlog('CAMP cleared, deaths', c.deaths);
  }
}

// --- round / match orchestration ---
function resetRound() {
  resetBarrels(); resetBottles(); resetPads(); resetGroundItems(); resetStations(); resetFloor();
  for (const f of fighters) resetFighter(f);
}
// 一局/一關的殘態清除(比分、事故計數、演出、規格 G 殘態、鏡頭 snap)。
// restartMatch(整輪重來)與 startLevel(闖關換關)共用——差別只在後續要不要重設 tier/關卡進度。
function clearMatchState() {
  v2s.matchOver = false; roundWins[0] = 0; roundWins[1] = 0;
  inc.falls = [0, 0]; inc.knockoffs = [0, 0]; inc.selfFalls = [0, 0];
  resetInc(); containLog.length = 0; v2s.bannerText = ''; v2s.winBannerT = 0; resetStage();
  v2s.perform = null; for (const f of fighters) { f._performing = false; f._hidden = false; f._lastItem = null; } // 回收演出殘留(分類記憶跨回合、不跨場)
  // 規格 G 殘態:終演/拒收/鏡頭 snap 還原(再戰要從乾淨鏡頭開始)
  v2s.finisher = null; v2s.reject = null; v2s.recordFlash = 0; v2s.finFlash = 0; v2s.letterK = 0;
  v2s.recordCard = null; v2s.brinkT = 0; v2s.brinkShown = false;   // flow-2:立案 beat / 瀕界心跳+一次性提示
  if (v2s.finCam) { const C = v2s.finCam; CAM.dist = C.dist; CAM.angle = C.angle; CAM.lookY = C.lookY; CAM.azimuth = C.az; game.camTarget = C.target; v2s.finCam = null; }
  v2s.aiCalled = false; v2s.aiCallAt = 0; v2s.aiCallPos = null;
  resetRound();
}
function restartMatch() {
  clearMatchState();
  applyAiTier('intern');                       // tier-1:再戰從實習生重新開始(逃跑戲重新武裝)
  // 闖關中按重來=重跑整輪(鑰匙歸零);加班模式維持 free
  if (v2s.camp.phase !== 'free' && v2s.camp.phase !== 'menu') {
    v2s.camp.keys = 0; v2s.camp.deaths = 0; v2s.campT = 0; clearRun();
    startLevel(1); return;
  }
  v2s.introT = INTRO_T; camRig.x = (fighters[0].x + fighters[1].x) / 2; camRig.y = (fighters[0].y + fighters[1].y) / 2; // 再戰也走開場儀式(就位→開始!)
}

// --- 有界跟隨(bounded follow):鏡頭跟一個「平滑 + 夾在內縮框裡」的代理點(camRig),
// 而不是直接黏在角色上。X 夾在 [ix, W-ix]:玩家貼牆仍在畫面內、又不越過側牆露黑邊;
// 垂直同樣夾 ny/sy。只用在平台場;浮島/格子場直接跟角色。數值可用 __v2.CAMB 即時微調。
// 開場高視角 vs 戰鬥低視角(使用者拍板 2026-07-21:開場保留舊高俯角運鏡框全場,
// 「開始!」後平滑降到戰鬥視角)。CAM_FIGHT=戰鬥定案(=boot 那組);CAM_INTRO=舊 v2 高視角+拉遠。
// intro 期間整組參數 smoothstep 混合(fov 由 render.js 偵測變化自動 updateProjectionMatrix)。
const CAM_FIGHT = { fov: 27, angle: 30, dist: 630, lookY: 14 }; // GetAmped 式中俯角(使用者 2026-07-21 對照截圖定案;37→31→30 微調放平)
const CAM_INTRO = { fov: 32, angle: 44, dist: 780, lookY: 14 };
// camp-0 主選單機位(規格 H §14):貼近的第三人稱,看小人在流水線上幹活。
// ⚠ **鍵組必須跟 CAM_FIGHT 一模一樣**——混合迴圈是 `for (const k in CAM_FIGHT)`,少一鍵就不會被混到。
const CAM_MENU = { fov: 26, angle: 22, dist: 470, lookY: 24 };
// 鏡頭**看向角色左邊一點**=角色落在畫面右側,左三分之一空出來給標題(等同 panX 的效果,
// 但不用動 panX——CAM_MENU 的鍵組必須跟 CAM_FIGHT 一致,多一鍵不會被混合迴圈碰到)。
const MENU_FOCUS = { x: MENU_STATION.x - 96, y: MENU_STATION.y - 8 };
const MENU_OUT_T = 0.9;                  // 選單機位 → 開場機位的混合秒數
let _camBlending = false; // intro 混合中旗標(結束時一次性歸位戰鬥值,之後不再碰=不干擾 ?tune 調參)
function updateCamRig(dt) {
  const lf = fighters[LOCAL];
  let tx = Math.min(Math.max(lf.x, CAMB.ix), W - CAMB.ix), ty = Math.min(Math.max(lf.y, CAMB.ny), CAMB.sy);
  // camp-0:選單期固定框住工作站;按下開始後 menuOut 秒內混回開場/戰鬥機位。
  // 手法照 intro 那條(移動**目標點**+整組參數 smoothstep),不換 camTarget → 交接零跳動。
  if (v2s.camp.phase === 'menu' || v2s.menuOut > 0) {
    _camBlending = true;
    const inMenu = v2s.camp.phase === 'menu';
    const e = inMenu ? 0 : (() => { const k = 1 - Math.min(1, v2s.menuOut / MENU_OUT_T); return k * k * (3 - 2 * k); })();
    tx = MENU_FOCUS.x + (tx - MENU_FOCUS.x) * e;
    ty = MENU_FOCUS.y + (ty - MENU_FOCUS.y) * e;
    for (const k in CAM_FIGHT) CAM[k] = CAM_MENU[k] + (CAM_INTRO[k] - CAM_MENU[k]) * e;
    const ee = Math.min(1, dt * CAMB.ease);
    camRig.x += (tx - camRig.x) * ee; camRig.y += (ty - camRig.y) * ee;
    return;
  }
  // 開場帶場(使用者拍板 2026-07:雙方就位靜止,鏡頭框住「兩人」+高視角拉遠 →「開始!」後平滑回玩家;
  // 不再飛去對手那邊——AI 一開工到處回收垃圾,玩家看著就懂)。
  if (v2s.introT > 0) {
    _camBlending = true;
    const o = fighters[1 - LOCAL];
    const back = Math.min(1, Math.max(0, (INTRO_GO - v2s.introT) / INTRO_GO));   // 0=就位期,→1=「開始!」期間回到玩家
    const e = back * back * (3 - 2 * back);                                       // smoothstep
    const mx = (lf.x + o.x) / 2, my = (lf.y + o.y) / 2;                           // 兩人中點
    tx = mx + (tx - mx) * e; ty = my + (ty - my) * e;
    for (const k in CAM_FIGHT) CAM[k] = CAM_INTRO[k] + (CAM_FIGHT[k] - CAM_INTRO[k]) * e; // 高視角→戰鬥視角整組混
  } else if (_camBlending) { Object.assign(CAM, CAM_FIGHT); _camBlending = false; } // intro 結束一次性歸位(不干擾 ?tune 調參)
  const e = Math.min(1, dt * CAMB.ease);
  camRig.x += (tx - camRig.x) * e; camRig.y += (ty - camRig.y) * e;
}

// --- 輸入(keys-1 滑鼠退役,使用者拍板 2026-07-21:雙端一致的 GetAmped 式鍵位)---
// C=攻擊(揮拳/拋投/空中下壓/反擊)、X=互動(抓/撿瓶桶裝備/放下)、Z=道具施放、Shift=按住防禦、空白=跳;
// 方向鍵+WASD 移動(8 向,面向=移動方向)。J/K/E 留作舊鍵位別名。攻擊裝備開火與撿瓶不再搶鍵(Z/X 分工)。
// 規格 G:終演進行中(按下之後)=雙方 input 全切,角色由 updateFinisher 自動駕駛
const finBusy = () => v2s.finisher && v2s.finisher.phase !== 'prompt';
function attackAction(f) {
  if (finBusy()) return;                                                      // C=攻擊;扛人=拋擲;扛桶/瓶=丟
  if (f.state !== 'alive') return;
  if (f.carryObj) { throwBarrel(f); return; }
  if (f.carrying) { throwCarried(f); return; }
  punch(f);
}
// X/E/觸控情境鍵=互動優先:撿/抓/放——持攻擊裝備時也能撿桶/瓶(開火在 Z,不搶鍵)。
function contextAction(f) {
  if (f.state !== 'alive') return;
  // 規格 G §4.1:收容窗口中 X=表演鍵(沿用抓的肌肉記憶);扛著物品先放下再按
  if (v2s.finisher && v2s.finisher.phase === 'prompt' && f.pid === v2s.finisher.w) {
    if (f.carryObj) dropBarrel(f);
    pressFinisher(f); return;
  }
  if (finBusy()) return;
  if (f.carryObj) { dropBarrel(f); return; }
  if (f.carrying) { dropCarry(f); return; }
  if (!f.carriedBy && !f.stunned && f.fumbleT <= 0 && f.regrabCd <= 0) {
    const o = fighters[1 - f.pid];
    if (o.state === 'alive' && (o.stunned || GRAB_ANY) && !o.carriedBy && o.invuln <= 0 && Math.hypot(o.x - f.x, o.y - f.y) <= GRAB_RANGE + o.r) { startCarry(f, o); return; }
    if (pickupItem(f)) return;
    const b = grabbableBarrel(f); if (b) { pickUpBarrel(f, b); return; }
  }
  useItem(f);
}
// 單機版:只有本機玩家(藍=LOCAL)吃鍵盤輸入。紅方永遠是 AI 或被動練習假人 ——
// 一律不吃輸入(舊 bug:假人 ai=false 但仍監聽 Enter/方向鍵,玩家一按 Enter 反而操控假人推開自己)。
const actionPrev = [false, false];
function pollAction() {
  const pressed = [keys.has('j'), keys.has('/')];
  for (let i = 0; i < 2; i++) { if (i !== LOCAL) continue; if (pressed[i] && !actionPrev[i]) doAction(fighters[i]); actionPrev[i] = pressed[i]; }
}
const itemPrev = [false, false];
function pollItem() {
  const pressed = [keys.has('z') || keys.has('k'), keys.has('.')]; // Z=道具施放(keys-1 主鍵;K=舊別名)
  for (let i = 0; i < 2; i++) { if (i !== LOCAL) continue; if (pressed[i] && !itemPrev[i] && !finBusy()) useItem(fighters[i]); itemPrev[i] = pressed[i]; }
}
let attackPrev = false; // C=攻擊(keys-1 主鍵,舊左鍵語意)。頓點中也收邊緣——反擊拳的按壓常落在擋下頓點的凍結幀(舊滑鼠是事件監聽天然不漏,鍵盤 poll 要補)
function pollAttack() {
  const pressed = keys.has('c');
  const f = fighters[LOCAL];
  if (pressed && !attackPrev && !f.ai) attackAction(f);
  attackPrev = pressed;
}
let guardPrev = false; // 格擋鍵=Shift(本機玩家;brawl-2 空白讓給跳)。按下瞬間 doGuard(黃金窗=反暈/挨打後=推開);按住=防禦架式(f.guarding)
function pollGuard() { // brawl-2 鍵位重排(使用者拍板):防禦=Shift(空白讓給跳躍=高頻動作佔最好的鍵)
  const pressed = keys.has('shift') || (touchInput.enabled && touchInput.guardHeld);
  const f = fighters[LOCAL];
  if (pressed && !guardPrev) doGuard(f);          // edge:精準格擋/推開分派
  f.guarding = pressed && canGuard(f);            // 按住=舉防(耐力/破防由 updateGuard 管);loop 前設好→無 1 幀延遲擋 AI 拳
  guardPrev = pressed;
}
let jumpPrev = false;
function pollJump() { // 空白=跳(edge);空中再按攻擊 C=下壓拳(attackAction→punch→dive 分派)
  if (finBusy()) return;
  const pressed = keys.has(' ');
  const f = fighters[LOCAL];
  if (pressed && !jumpPrev) jump(f);
  jumpPrev = pressed;
  if (touchInput.press.jump) { touchInput.press.jump = false; jump(f); }
}
const contextPrev = [false, false]; // X=互動情境(contextAction:抓/撿/放;E=舊別名)。開火在 Z,不搶鍵
function pollContext() {
  const pressed = [keys.has('x') || keys.has('e'), false];
  for (let i = 0; i < 2; i++) { if (i !== LOCAL) continue; if (pressed[i] && !contextPrev[i]) contextAction(fighters[i]); contextPrev[i] = pressed[i]; }
}
// 觸控動作按鈕(Phase C):v2-touch 按下時設 press 閂鎖,這裡消費=一次一擊(等同鍵鼠的邊緣觸發)。
// 揮拳/情境走一般幀;格擋另抽一支,定格(hitstop)中也要收(反應常落在凍結幀)——同 pollGuard。
function pollTouchButtons() {
  if (touchInput.press.punch)   { touchInput.press.punch = false;   attackAction(fighters[LOCAL]); }
  if (touchInput.press.context) { touchInput.press.context = false; contextAction(fighters[LOCAL]); } // 觸控=互動優先(單鍵難分工,保住撿桶瓶玩法)
}
function pollTouchGuard() {
  if (touchInput.press.guard) { touchInput.press.guard = false; doGuard(fighters[LOCAL]); }
}
// 結算畫面「複製」觸控鈕:等同鍵盤 C(把戰報分享文字寫進剪貼簿)。
// 按鈕字依本機玩家情境變:扛人→揮拳鍵變「投擲」、情境鍵變「放下」;空手且有道具→「技能」,否則「抓」。
let touchMod = null;
function syncTouchLabels() {
  if (!touchMod || !touchInput.enabled) return;
  const f = fighters[LOCAL];
  const bottle = f.carryObj && f.carryObj.kind === 'bottle';
  const punch = f.carryObj ? (bottle ? '丟瓶' : '丟桶') : f.carrying ? '投擲' : '揮拳';
  const context = f.carryObj ? (bottle ? '放下瓶' : '放下桶') : f.carrying ? '放下' : (f.item ? '技能' : '抓');
  touchMod.syncLabels(punch, context);
}

function step(dt) {
  // 收容演出 → 玻璃罩/掃描環(render-lab);放 matchOver return 之前,最終封存後才收得掉罩
  setPodPerform(v2s.perform ? { phase: v2s.perform.phase, pk: v2s.perform.pk, n: v2s.perform.n } : null);
  // 視覺計時器先衰減再檢查 matchOver —— 否則最終封存的震屏(12)在結算畫面永遠不歸零,鏡頭抖不停
  game.screenShake = Math.max(0, game.screenShake - dt * 28);
  if (game.shakeSmallCd > 0) game.shakeSmallCd -= dt;
  if (game.kickX || game.kickY) { const kd = Math.pow(0.00005, dt); game.kickX *= kd; game.kickY *= kd; if (Math.abs(game.kickX) + Math.abs(game.kickY) < 0.1) { game.kickX = 0; game.kickY = 0; } } // 鏡頭踹:~80ms 彈回
  if (v2s.matchOver) {
    if (v2s.tutorial) { v2s.tutorial = false; try { localStorage.setItem('mmm_v2_played', '1'); } catch { /* 隱私模式 */ } } // 首局打完 → 記「玩過」,下次不再教學
    return; // freeze gameplay while the incident report is up
  }
  if (v2s.camp.phase === 'menu') { stepMenu(dt); return; }   // camp-0:選單期不跑戰鬥,只演工作循環
  stepCamp(dt);                                             // camp-1:過關/交接/重來的節拍(fight/free 直接 return)
  if (v2s.menuOut > 0) v2s.menuOut = Math.max(0, v2s.menuOut - dt);  // 選單→遊戲的鏡頭混合倒數
  if (v2s.introT > 0) v2s.introT -= dt;          // 開場目標字幕/鏡頭帶場倒數
  if (v2s.introT > INTRO_GO && (keys.size > 0 || (touchInput.enabled && touchInput.active))) v2s.introT = INTRO_GO; // 等不及的玩家按任何鍵=直接「開始!」
  if (v2s.winBannerT > 0) v2s.winBannerT -= dt;
  if (v2s.localFlash > 0) v2s.localFlash -= dt;
  if (v2s.recordCard) { v2s.recordCard.t += dt; if (v2s.recordCard.t >= v2s.recordCard.T) v2s.recordCard = null; } // flow-2 立案 beat:掛在 hitstop 閘之前=閃光/快門在頓點中照演(標點感)
  if (v2s.fallReasonT > 0) v2s.fallReasonT -= dt;
  updateParticles(dt); updateRings(dt); updateFloatingTexts(dt);
  syncTouchLabels(); // 情境按鈕字(每幀,只在變動時寫 DOM)
  if (game.hitstop > 0) { game.hitstop -= dt; pollGuard(); pollTouchGuard(); pollAttack(); } // 定格中也收格擋+攻擊輸入:反擊拳/接段的按壓常落在凍結幀裡,不能吃掉
  else {
    // 頓點=時間真的停(feel-4 治「打飛跳幀」):game.time 只在非頓點推進。舊版時鐘照走、sim 凍結,
    // 導致所有「絕對時間」系統解凍即跳——挑飛彈道 lobZ(t) 瞬移 1/3 弧、clip 動畫跳 ~12 格。
    // 凍結時鐘後飛行弧/clip/排程打擊/反擊窗一致暫停無縫續播,且出拳動畫正確凍在 impact 幀(格鬥標準頓點)。
    game.time += dt; inc.matchT += dt;
    pollAction(); pollAttack(); pollItem(); pollGuard(); pollContext(); pollJump();
    pollTouchButtons(); pollTouchGuard();
    if (TEST_CLIP) {                                   // ?clip= 試播:循環播放 + 凍結對手 AI
      fighters[1 - LOCAL].ai = false;
      if (game.time >= _clipNextT) _clipNextT = game.time + (playClip(TEST_CLIP) || 1) + 0.5;
    }
    stepFloor(dt); // 地板化學:火沿油滾動 + 每格衰退/預警 + 電水雙計時器(注入=道具/站;cut 3 接)
    for (const f of fighters) {
      if (f.state === 'down') { f.respawn -= dt; if (f.respawn <= 0) { resetFighter(f); f.invuln = 1.8; } continue; } // 墜落重生短無敵(ring-1;同 softReintegrate 彈回)
      if (f.state === 'away') continue; // 實習生跑掉搬救兵(tier-1):場外待命,updateAiCall 排資深進場
      if (f._performing) { f.x = POD.x; f.y = POD.y; f.vx = 0; f.vy = 0; continue; } // 收容演出:被罩在艙心(掙扎/掃描由 render+HUD 演;stun 倒數也凍結=不會醒)
      // flow-2 疲態:被記錄數 → 角色身上的持續狀態(render 讀 f.fatigue;0/1/2 檔,滿檔=聽牌)。
      // 玩家反饋「不知不覺就被記 3 次」=資訊只在畫面邊緣的卡片上;搬到角色身體=對峙時一直看得到。
      f.fatigue = Math.min(RECORD_TARGET - 1, roundWins[1 - f.pid]);
      if (f.fatigue >= FATIGUE.sweat.at && f.state === 'alive' && !f.stunned && !f._performing) { // 冒汗:每 every 秒一滴(滿檔加倍),從頭頂落下
        f._sweatT -= dt;
        if (f._sweatT <= 0) {
          f._sweatT = FATIGUE.sweat.every / (1 + (f.fatigue - 1) * 1.0);
          const S = FATIGUE.sweat, a = Math.random() * Math.PI * 2;
          game.particles.push({ x: f.x + Math.cos(a) * 5, y: f.y + Math.sin(a) * 5, vx: Math.cos(a) * S.spd, vy: Math.sin(a) * S.spd,
            h: (f.z || 0) + 62, vh: 40, r: S.r, life: S.life, maxLife: S.life, color: S.color }); // vh→fx.updateParticles 帶重力(小拋物線:從頭甩出再落下)
        }
      }
      // cooldown timers
      if (f.punchCd > 0) f.punchCd -= dt;
      if (f.jumpCd > 0) f.jumpCd -= dt;
      if (f._diveLagT > 0) f._diveLagT -= dt;
      if (f.itemCastCd > 0) f.itemCastCd -= dt;
      if (f.regrabCd > 0) f.regrabCd -= dt;
      if (f.fumbleT > 0) f.fumbleT -= dt;
      updateBurnChain(f);   // 燃燒動作鏈(burn-1):黑定格到點=點火挑飛(在 z 管線前,本幀 _thrownT 即生效)
      // B 案彈道:被拋飛的 sim 高度(判定 gate + render 都讀 f.z);落地幀 ×LAND_SKID 短滑 + 塵土
      {
        // 哨兵用 > -5(-9=未被丟):撞牆快落會把 _thrownT 夾成 game.time-T+0.1,開場 game.time 小時是小負數,仍屬有效時戳
        const lob = f._lob || PERSON_LOB;   // 丟人=PERSON_LOB / 終結技打飛=PUNCH_LAUNCH_LOB(同一條管線)
        let z = (f._thrownT > -5) ? lobZ(game.time - f._thrownT, lob) : 0;
        if (f._jumpT > -5) {                // 跳躍(brawl-2):自發小 lob,同一套 z;到時落地清戳
          const jt = game.time - f._jumpT;
          if (jt < JUMP_LOB.T) z = Math.max(z, lobZ(jt, JUMP_LOB)); else f._jumpT = -9;
        }
        if (f._diveT0 > -5) {               // 下壓:從起跳高度線性壓地(落地幀=resolveStrike kind 3 清 _diveT0)
          z = Math.max(0, f._diveZ0 * (1 - (game.time - f._diveT0) / DIVE_T));
        }
        if (!z && f.z > 1) { f.vx *= LAND_SKID; f.vy *= LAND_SKID; addRing(f.x, f.y, 24, '#cbb9a2', 0.28, 3); game.sfx.push('thud'); }
        f.z = z;
        // 被丟打橫旗:飛行中+落地滑行都趴著,滑停(fumbleT 歸零)才站起(render 讀,actor-brawler 平滑旋轉)
        f._lying = !!(f._thrownT > -5 && game.time - f._thrownT < lob.T + 0.15 && (z > 0 || f.fumbleT > 0)) || !!f._burnLie; // burn-1:熄滅段撐趴姿(倒地燒完才站起)
        // 挑飛旗(feel-4b):挑飛=直立後仰飛(面向不動、90° 朝上),非超人趴姿——actor-brawler 讀此旗分姿勢
        f._launched = f._lying && f._lob === PUNCH_LAUNCH_LOB;
      }
      if (f.restunT > 0) f.restunT -= dt;
      if (f.invuln > 0) f.invuln -= dt;
      if (f.flinchT > 0) f.flinchT -= dt;
      if (f.comboT > 0) f.comboT -= dt;
      if (f.pushCd > 0) f.pushCd -= dt;
      if (f.pushWinT > 0) { f.pushWinT -= dt; if (f.pushWinT <= 0) f._aiPushAt = 0; }
      if (f._counterFrom && game.time - f._counterAt > 0.6) f._counterFrom = null; // 反擊窗口早過期(擋了沒反擊)→ 清掉懸空攻擊者參照
      updateGuard(f, dt); // 防禦架式:耐力衰退/回充/破防(guarding 由 pollGuard 設;AI 暫不舉防=只回充)
      if (f.ai && f._aiPushAt && game.time >= f._aiPushAt) { f._aiPushAt = 0; doPushOff(f); } // AI 的格擋反應
      if (f._strikeAt && game.time >= f._strikeAt) resolveStrike(f); // impact 影格到 → 判定命中(起手被打斷則取消)
      if (f._itemCastAt && game.time >= f._itemCastAt) resolveItemCast(f); // 道具施放 impact 幀到 → 發動效果(被打斷則取消)
      if (f._barrelThrowAt && game.time >= f._barrelThrowAt) launchBarrel(f); // 丟桶 release 幀到 → 甩出(掉桶則取消)
      if (f._carryThrowAt && game.time >= f._carryThrowAt) launchCarried(f); // 丟人 release 幀到 → 甩飛(掙脫/打斷則取消)
      // stability regen (paused right after a hit; frozen while stunned/carried)
      if (f.stabCd > 0) f.stabCd -= dt; else if (!f.stunned && !f.carriedBy) f.stability = Math.min(STAB_MAX, f.stability + STAB_REGEN * dt);
      // stun countdown → recover (ungrabbed)
      if (f.stunned) { f.stunT -= dt; if (f.stunT <= 0) { f.stunned = false; f.frozen = false; f.stability = STUN_RECOVER; f.restunT = RESTUN_IMMUNE; } } // 醒來同時解凍
      if (f.stunned && f.item) dropLooseItem(f); // 被暈=道具噴到地上(逃脫類不掉;誰先撿到誰的)
      // death theatre (isles over-void fall; no-op on the flat arena)
      if (updateDeathTheater(f, dt)) {
        if (f.dead) {
          f.state = 'down'; f.respawn = RESPAWN; f.dead = false;
          if (f.carrying) dropCarry(f); if (f.carriedBy) breakFree(f);
          inc.falls[f.pid]++;
          if (f.lastHitBy >= 0 && f.lastHitBy !== f.pid) { inc.knockoffs[f.lastHitBy]++; inc.types.add('knockoff'); }
          else { inc.selfFalls[f.pid]++; inc.types.add('self'); }
          resolveFall(f); // ring-1:墜落=對手得分(自摔也算=蠢死法);終局=廢料井封存版
        }
        continue;
      }
      // 跑=預設(brawl-2):有移動輸入就是跑;扛人/扛桶/暈眩/踉蹌不能跑(搬運要有重量感);瓶=輕,拿著照樣跑。
      // 手機:搖桿推程 < RUN_STICK=走(微操走位)、到底=跑;AI 維持走速(可預測的難度)。
      const mvIn = (!f.ai && f.pid === LOCAL)
        ? (touchInput.enabled ? (touchInput.active && touchInput.mag >= RUN_STICK)
          : (keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d') || keys.has('arrowup') || keys.has('arrowdown') || keys.has('arrowleft') || keys.has('arrowright'))) // keys-1:方向鍵同計
        : !!f._fleeing; // AI 平時走速(可預測);逃跑=進跑速(tier-1,moveFighter 再 ×FLEE_SPEED 讓玩家衝刺追得上)
      f.running = !!(mvIn && !f.carrying && !(f.carryObj && f.carryObj.kind !== 'bottle') && !f.stunned && f.fumbleT <= 0);
      f._runT = f.running ? (f._runT || 0) + dt : 0; // 衝刺狀態計時:持續跑 ≥ DASH_RUN_T 出拳=衝刺攻擊(feel-1)
      floorHazards(f, dt); // 踩電水硬直 / 站火海·毒區削穩定值 → 歸零擊暈(移動前讀最新地板)
      const F = v2s.finisher;
      if (F && F.phase !== 'prompt' && (f.pid === F.w || f.pid === F.v)) { /* 終演自動駕駛(updateFinisher 定位) */ }
      else if (!f.carriedBy) moveFighter(f, dt); // carried fighter is positioned by the carry loop below
      // 腳步塵土(run-1):跑動貼地時每步(≈stridePx/2=54px)腳下冒一小撮土——把「踩在地上」賣給眼睛(跑=預設,常駐回饋)
      if (f.state === 'alive' && f.running && (f.z || 0) <= 0 && f.fumbleT <= 0) {
        f._dustAcc = (f._dustAcc || 0) + Math.hypot(f.x - (f._dustPx ?? f.x), f.y - (f._dustPy ?? f.y));
        if (f._dustAcc >= 54) { f._dustAcc = 0; addRing(f.x - Math.cos(f.facing) * 9, f.y - Math.sin(f.facing) * 9, 9, '#b3a48c', 0.2, 2); }
      } else f._dustAcc = 0;
      f._dustPx = f.x; f._dustPy = f.y;
    }
    drainFloorEvents(); // 毒爆等一次性事件 AoE(本幀 stepFloor/道具注入產生的)
    updateAiCall();     // tier-1:實習生跑掉後的資深同事進場排程(CALL_T 到=同點進場,比分保留)
    // 搬運: 被搬者跟隨在搬運者身前 + 全程掙脫 + 拖進艙 = 收容
    for (const f of fighters) {
      if (!f.carrying) continue;
      const o = f.carrying;
      if (o.state !== 'alive' || f.state !== 'alive' || f.stunned) { dropCarry(f); continue; }
      o.x = f.x + Math.cos(f.facing) * (f.r + o.r * 0.7); o.y = f.y + Math.sin(f.facing) * (f.r + o.r * 0.7); o.vx = 0; o.vy = 0;
      if (inPod(o.x, o.y)) { containByCarry(f, o); continue; }                 // 失控入艙 → 收容
      if ((o.ai || o.pid !== LOCAL) && !GRAB_ANY) o.escape += CARRY_MASH_AI * dt; // AI / 被動假人:固定填速(不吃玩家的 A/D 移動鍵);?grabany=1 測試時不自動掙脫,好舉著慢慢看
      else {                                                                    // 本機玩家被扛: 左右交替點按 A/D 掙脫(按指示)
        const aDown = keys.has('a') || keys.has('arrowleft'), dDown = keys.has('d') || keys.has('arrowright'); // keys-1:方向鍵同計(掙脫左右交替)
        const aEdge = aDown && !o._aPrev, dEdge = dDown && !o._dPrev;
        if (o.mashSide === 0 && aEdge) { o.escape += CARRY_MASH_TAP; o.mashSide = 1; }
        else if (o.mashSide === 1 && dEdge) { o.escape += CARRY_MASH_TAP; o.mashSide = 0; }
        o._aPrev = aDown; o._dPrev = dDown;
      }
      if (o.escape >= CARRY_ESCAPE_NEED) breakFree(o);
    }
    // 扛桶(§12.1 步驟 B):桶跟在面前;暈/死/被打飛(fumbleT) → 掉桶(在手上爆已由 explodeBarrel 放開持有者)
    for (const f of fighters) {
      const b = f.carryObj; if (!b) continue;
      if (f.state !== 'alive' || f.stunned || f.fumbleT > 0 || !b.alive) { if (b.alive) dropBarrel(f); else { f.carryObj = null; f._barrelThrowAt = 0; } continue; }
      b.x = f.x + Math.cos(f.facing) * (f.r + b.r * 0.9); b.y = f.y + Math.sin(f.facing) * (f.r + b.r * 0.9); b.vx = 0; b.vy = 0;
    }
    // 失控入艙: 被擊退/打滑(速度夠快)、暈眩者、或被拋出翻滾中進到艙半徑 → 收容(對手勝)。無敵中免疫。演出中整段 suspend。
    if (!v2s.perform) for (const f of fighters) {
      if (f.state !== 'alive' || f.carriedBy || f.carrying || f.invuln > 0) continue;
      if (jumping(f) && !f.stunned) continue; // 主動跳躍=受控,飛越艙口不算失控入艙(帶著鎖滑動量跳過艙也安全);暈著照收
      const thrown = inThrowFlight(f);
      if ((f.stunned || thrown || Math.hypot(f.vx, f.vy) > v2s.slideContainCur) && inPod(f.x, f.y)) {
        const cause = (thrown && f._lob === WIND_CARRY_LOB) ? 'wind' // 風壓空中接送進艙=記 wind(連段收尾;brawl-3)
          : (thrown && f._lob === BURN_LOB) ? 'fire' // 火焰挑飛滾進艙=記 fire(burn-1;pips 橘=燒)
          : thrown ? 'throw' : (onSlipperyIce(f.x, f.y) || game.time - (f._slideT || -9) < 0.5) ? 'ice' : (f.lastHitBy === -3 ? 'barrel' : 'wind'); // 剛滑出冰面衝進艙也算 ice
        containByEnviron(f, cause); break;
      }
    }
    updateFinisher(dt); updateReject(dt); // 規格 G:收容終演 / 拒收吐回
    updateBrink(dt);                      // flow-2c 瀕界:心跳音 + 首次「只差一筆」提示
    if (v2s.recordFlash > 0) v2s.recordFlash -= dt;
    if (v2s.finFlash > 0) v2s.finFlash -= dt;
    { const lk = (finBusy() || (v2s.perform && v2s.perform.final)) ? 1 : 0;      // letterbox 進度(終演+最終封存)
      v2s.letterK += (lk - v2s.letterK) * Math.min(1, dt * 5); if (v2s.letterK < 0.005) v2s.letterK = 0; }
    podPulseT -= dt;                                                              // 收容指令=艙發光脈動
    if (podPulseT <= 0 && !v2s.perform && !v2s.matchOver && (roundWins[0] >= RECORD_TARGET || roundWins[1] >= RECORD_TARGET)) {
      podPulseT = 0.9;
      addRing(POD.x, POD.y, POD.r * 1.5, COLORS[roundWins[0] >= RECORD_TARGET ? 0 : 1], 0.5, 3);
    }
    updateFinisherCam(dt);
    updatePerform(dt); // 回收演出推進(phase/LED 字/收尾彈回或封存)
    updateBarrels(dt); updateBottles(dt); updateStations(dt); updatePads(dt); updateGroundItems(dt); // 廢料桶 / 投擲瓶 / 元素站 / 補給座重刷 / 掉落道具 TTL
  }
  // log the exact frame YOU step off solid ground (the "boarding then falling" moment, isles)
  const lf = fighters[LOCAL];
  if (lf.state === 'alive' && !lf.falling) {
    const s = onSolid(lf.x, lf.y);
    if (prevLocalSolid && !s) dlog('OFF-EDGE @', Math.round(lf.x) + ',' + Math.round(lf.y), 'v', Math.round(lf.vx) + ',' + Math.round(lf.vy), 'Δhit', (game.time - (lf.lastHitT || -9)).toFixed(2) + 's');
    prevLocalSolid = s;
  }
  // present live fighters for the renderer
  game.enemies = fighters.filter(f => f.state !== 'down' && !f._hidden); // _hidden=演出壓縮後(人已變成包裝方塊)
  // alive barrels render as the Violet Arcane Vessel GLB (item-2);充能/引信靠疊加光暈(charge=橘/藍、fuse=閃紅)。未載成 barrelClone 回 null 退方塊。
  // 被扛的桶(b.held)由 actor-brawler 畫在雙手上(舉過頭頂/丟桶 heave),這裡略過免雙重繪
  // fly = sim 真高度(B 案彈道 b.z,updateBarrels 算);人的高度=f.z(actor-brawler 直接讀)
  game.props = barrels.filter(b => b.alive && !b.held).map(b => ({ x: b.x, y: b.y, r: b.r, barrel: true, charge: b.charge, fuse: b.state === 'fuse', fuseT: b.fuse, hp: 1, maxHp: 1, held: false, fly: b.z || 0, vx: b.vx, vy: b.vy, roll: b.roll })); // barrel=GLB 鎖定旗;charge(null/fire/lightning)+fuse/fuseT → 疊加光暈;vx/vy/roll → render 桶翻滾(繞運動法向水平軸)
  for (const sw of labSwitches) game.props.push({ x: sw.x, y: sw.y, r: sw.r, sw: true, armed: v2s.stationsArmed, hp: 1, maxHp: 1, held: false }); // 左右緊急拉桿(render-entities 畫拉桿:未啟動=琥珀立起、啟動=壓下變暗)
  for (const t of bottles) if (t.alive && !t.held) game.props.push({ x: t.x, y: t.y, r: t.r, wall: t.elem, bottle: t.elem, hp: 1, maxHp: 1, held: false, fly: t.z || 0, vx: t.vx, vy: t.vy, roll: t.roll }); // 場上投擲瓶(bottle=元素旗:render-entities 用它鎖定冰瓶掛 GLB,不與 v1 冰牆碎塊的 wall:'ice' 撞;油瓶留方塊 tint;vx/vy/roll → 翻滾)
  if (v2s.perform && v2s.perform.cube) game.props.push({ x: v2s.perform.cube.x, y: v2s.perform.cube.y, r: 12, hp: 1, maxHp: 1, held: false, fly: 0 }); // 壓縮包裝方塊(素木箱佔位)沿輸送方向滑走
  // 風壓手套起手預告:施法窗中(_itemCastAt 未到)每幀重建淡扇形,面向即時跟(教射程/範圍;對手也看得到=反應窗)
  game.windAims.length = 0;
  for (const f of fighters) if (f.state === 'alive' && f._itemCastType === 'wind' && f._itemCastAt > game.time) game.windAims.push({ x: f.x, y: f.y, angle: f.facing, range: WIND_RANGE, cone: WIND_CONE });
  // 噴火帽起手預告:施法窗中每幀重建短扇形(教攻擊範圍——外緣弧=射程邊界;對手也看得到=反應窗)
  game.fireAims.length = 0;
  for (const f of fighters) if (f.state === 'alive' && f._itemCastType === 'fire' && f._itemCastAt > game.time) game.fireAims.push({ x: f.x, y: f.y, angle: f.facing, range: FIRE_RANGE, cone: FIRE_CONE });
  // 魔導電鞭起手預告:施法窗中每幀重建直線(教直線射程;對手也看得到=閃避窗)
  game.boltAims.length = 0;
  for (const f of fighters) if (f.state === 'alive' && f._itemCastType === 'lightning' && f._itemCastAt > game.time) game.boltAims.push({ x: f.x, y: f.y, angle: f.facing, range: LIGHTNING_RANGE });
  // ground markers: 青綠實驗艙光 + 橘色爆桶危險區(引信中更亮更快閃)
  const carrying = fighters.some(f => f.carrying);
  const marks = [{ x: POD.x, y: POD.y, r: POD.r, color: carrying ? '#c661ff' : '#4dffcf', pulse: true, op: 0.72, fill: 0.16, speed: carrying ? 8 : 3 }];
  if (!v2s.stationsArmed) for (const sw of labSwitches) marks.push({ x: sw.x, y: sw.y, r: sw.r + 12, color: '#ff9a4a', pulse: true, op: 0.8, fill: 0.2, speed: 5 }); // 未啟動=琥珀脈衝邀請揍任一支拉桿;啟動後熄
  for (const b of barrels) { // 升壓中=完整危險環(元素色 telegraph);idle 被充能=小光圈(先看得出爆種)
    if (!b.alive) continue;
    if (b.state === 'fuse') marks.push({ x: b.x, y: b.y, r: BARREL_BLAST * 0.85, color: barrelChargeColor(b.charge), pulse: true, op: 0.92, fill: 0.24, speed: 18 });
    else if (b.charge) marks.push({ x: b.x, y: b.y, r: b.r + 12, color: barrelChargeColor(b.charge), pulse: true, op: 0.5, fill: 0.18, speed: 3 });
  }
  for (const s of stations) if (s.state === 'warn') { // 元素站預警:靜態落點圈(元素色淡)+ 收縮倒數環(收到中心=噴)
    const prog = s.warnT / STATION_WARN, col = elemColor(s.elem); // 1→0
    marks.push({ x: s.x, y: s.y, r: ERUPT_PATCH_R, color: col, pulse: false, op: 0.36, fill: 0.16 });
    marks.push({ x: s.x, y: s.y, r: ERUPT_PATCH_R + prog * ERUPT_PATCH_R * 1.7, color: col, pulse: true, op: 0.92, fill: 0, speed: 6 + (1 - prog) * 16 });
  }
  for (const p of pads) if (p.item) marks.push({ x: p.x, y: p.y, r: 24, color: ITEM_INFO[p.item].color, pulse: true, op: 0.5, fill: 0.12, speed: 4 }); // 補給座光圈
  for (const t of bottles) if (t.alive && !t.held && t.z <= 0) marks.push({ x: t.x, y: t.y, r: t.r + 10, color: elemColor(t.elem), pulse: true, op: 0.5, fill: 0.14, speed: 4 }); // 場上瓶(可撿=元素色小圈)
  for (const g of groundItems) marks.push({ x: g.x, y: g.y, r: 18, color: ITEM_INFO[g.type].color, pulse: true, op: 0.72, fill: 0.18, speed: 7 }); // 地上掉落道具(可撿/搶)
  // 工業重錘起手預告:施法窗中畫落點圓圈(教砸壓範圍;對手也看得到=反應窗)
  for (const f of fighters) if (f.state === 'alive' && f._itemCastType === 'water' && f._itemCastAt > game.time) {
    const sx = f.x + Math.cos(f.facing) * WATER_SLAM_DIST, sy = f.y + Math.sin(f.facing) * WATER_SLAM_DIST;
    marks.push({ x: sx, y: sy, r: WATER_R, color: '#4da6ff', pulse: true, op: 0.8, fill: 0.2, speed: 11 });
  }
  if (_armedShown !== v2s.stationsArmed) { _armedShown = v2s.stationsArmed; setStationsPowered(_armedShown); } // 拉閘 → 四角站通電光環(render-lab;因果演出);round reset 自動熄
  if (v2s.lowFlicker) for (const m of marks) m.pulse = false; // 減閃爍:標記全改常亮
  setGroundMarkers(marks);
  if (game.camTarget === camRig) updateCamRig(dt); // flat mode: smoothed, bounded camera follow

}

// 慢動作觀察:對照 punch-studio 與 v2 的動作(studio 有 0.3× 慢放)。?slowmo=0.25 設初值;按 K 循環。
const SLOWMO_STEPS = [1, 0.5, 0.25, 0.1];
let slowmo = (() => { const v = parseFloat(new URLSearchParams(location.search).get('slowmo')); return Number.isFinite(v) && v > 0 ? Math.min(1, Math.max(0.05, v)) : 1; })();
let slowmoEl = null;
function showSlowmo() {
  if (!slowmoEl) {
    slowmoEl = document.createElement('div');
    slowmoEl.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:50;font:bold 13px system-ui;color:#9fe7ff;background:rgba(10,12,20,.72);padding:3px 12px;border-radius:12px;pointer-events:none;letter-spacing:1px';
    document.body.appendChild(slowmoEl);
  }
  slowmoEl.textContent = `🐢 慢動作 ${slowmo}×(K 切換)`;
  slowmoEl.style.display = slowmo < 1 ? '' : 'none';
}
function cycleSlowmo() {
  const i = SLOWMO_STEPS.indexOf(slowmo);
  slowmo = SLOWMO_STEPS[(i + 1) % SLOWMO_STEPS.length];
  showSlowmo();
}
showSlowmo();

// 測試加速(?turbo=N,headless 回歸專用;比照 ?slowmo/?grabany 測試旗):每個 rAF 幀跑 N 次 step(dt)。
// 每步 dt 不變=物理/計時/輸入語意全保真(等同正常幀率的 N 個連續幀,只是畫面少畫)。
// 背景:headless rAF 節流到 ~5% 實時且反節流 flags 無效(2026-07-20 實驗),19 套回歸要 10min+;
// turbo=8 讓 game.time 推進 ×8=等待類斷言收斂 ~8×。正常遊玩不帶參數=1,零影響。
const TURBO = (() => { const v = parseInt(new URLSearchParams(location.search).get('turbo')); return Number.isFinite(v) && v > 1 ? Math.min(32, v) : 1; })();
function frame(now) {
  let dt = Math.min(0.033, Math.max(0, (now - last) / 1000)); // 下夾 0:headless/分頁還原的 rAF 時間戳可能倒退,負 dt 會讓 game.time 變負=絕對時戳比較全壞(排程施放 flake 元兇,2026-07-20 獵獲)
  last = now;
  if (slowmo < 1) dt *= slowmo;   // 慢動作觀察:整場模擬按倍率放慢(動畫/判定同步慢,可看清出拳過程)
  // 反擊拳改制(brawl-3.1):不再有慢動作/灰屏提示——反擊靠「擋下瞬間 hitstop」的手感抓時機(讓玩家自己體會)。
  for (let i = 0; i < TURBO; i++) step(dt);
  if (touchMod) touchMod.setReportVisible(v2s.matchOver); // 結算畫面亮觸控「再戰/複製」、收起對戰控制(桌機 no-op)
  render3D();
  if (game.sfx.length) { for (const e of game.sfx) playSfx(e); game.sfx.length = 0; } // drain sfx
  drawHud();
  drawPanicFaces(); // 凸眼 billboarded over a launched/falling fighter (drawn after the HUD clear)
  requestAnimationFrame(frame);
}

// --- boot ---
window.__v2 = { game, fighters, CAM, v2s, onSolid, ISLANDS, BRIDGES, // debug / headless-test hook (CAM for live camera tuning; v2s=可重賦值純量容器,測試歸零 introT 用)
  restartMatch,
  POD, barrels, explodeBarrel, stations, updateStations, labSwitches, CAMB, camRig,
  grabbableBarrel, pickUpBarrel, dropBarrel, throwBarrel, launchBarrel, playClip, startGame, enterMenu, startLevel, campSeal,
  PERSON_LOB, BARREL_LOB, PUNCH_LAUNCH_LOB, WIND_CARRY_LOB, BOTTLE_LOB, bottles, shatterBottle, roundWins, containLog, // 彈道 tuning(物件可變:控制台改即時生效;?tune=1 滑桿同源)+ 場上瓶(測試用)
  punch, resolveStrike, doGuard, canGuard, updateGuard, startCarry, stunFighter, throwCarried, launchCarried, dropCarry, breakFree, pads, groundItems, pickupItem, dropLooseItem, useItem, resolveItemCast, attackAction, contextAction, castWind, castTeleport, castFire, castWater, castLightning, inc, endMatch, jump, dive, JUMP_LOB, AIR_HIT_LOB,
  floorHazards, airborne, // 地板化學/空中判定:測試直接餵 dt 呼叫,不用去追跳躍弧線的時間窗(見 tests/jump.mjs ④)
  pressFinisher, // 規格 G 終演(tests/finisher.mjs:按鍵在 rAF 節流下會漏拍,測試直接按)
  NAMES, AI_PROFILE, applyAiTier, updateAiCall, // AI 階級(tier-1):檔案表+進場排程(測試/控制台)
  state: () => ({ winnerPid: v2s.winnerPid, roundWins: [roundWins[0], roundWins[1]], matchOver: v2s.matchOver, stage: v2s.stage,
    perform: v2s.perform ? { n: v2s.perform.n, phase: v2s.perform.phase, t: +v2s.perform.t.toFixed(2), line: v2s.perform.line, final: v2s.perform.final } : null,
    finisher: v2s.finisher ? { phase: v2s.finisher.phase, w: v2s.finisher.w, t: +v2s.finisher.t.toFixed(2) } : null,   // 規格 G(測試讀)
    reject: v2s.reject ? { t: +v2s.reject.t.toFixed(2), loser: v2s.reject.loser } : null,
    letterK: +v2s.letterK.toFixed(2),
    fatigue: [fighters[0].fatigue, fighters[1].fatigue],                          // flow-2 疲態檔位(render 讀同一個欄位)
    brink: { shown: v2s.brinkShown, t: +v2s.brinkT.toFixed(2) },                  // flow-2c 瀕界:一次性提示旗 + 心跳節拍
    recordCard: v2s.recordCard ? { n: v2s.recordCard.n, w: v2s.recordCard.w, phrase: v2s.recordCard.phrase, t: +v2s.recordCard.t.toFixed(2) } : null,
    tutorial: v2s.tutorial, introT: +v2s.introT.toFixed(2), aiMode: fighters[1 - LOCAL]._aiMode,
    camp: { ...v2s.camp }, campT: +v2s.campT.toFixed(2), menuOut: +v2s.menuOut.toFixed(2),   // camp-0/1 闖關狀態
    containLog: containLog.map(c => ({ w: c.winner, m: c.method, s: c.stage })),
    invuln: [+fighters[0].invuln.toFixed(2), +fighters[1].invuln.toFixed(2)],
    stability: [Math.round(fighters[0].stability), Math.round(fighters[1].stability)],
    stunned: [fighters[0].stunned, fighters[1].stunned],
    carrying: [fighters[0].carrying ? fighters[0].carrying.pid : -1, fighters[1].carrying ? fighters[1].carrying.pid : -1],
    escape: [Math.round(fighters[0].escape || 0), Math.round(fighters[1].escape || 0)],
    items: [fighters[0].item, fighters[1].item], pads: pads.map(p => p.item),
    contains: [inc.contains[0], inc.contains[1]], carries: inc.carries, accidentContains: inc.accidentContains,
    reverseContains: inc.reverseContains, teleportEscapes: inc.teleportEscapes, struggleEscapes: inc.struggleEscapes,
    itemBackfires: inc.itemBackfires, barrelBooms: inc.barrelBooms, itemUses: inc.itemUses,
    throws: [inc.throws[0], inc.throws[1]], throwContains: inc.throwContains,
    fumble: [+fighters[0].fumbleT.toFixed(2), +fighters[1].fumbleT.toFixed(2)],
    z: [+(fighters[0].z || 0).toFixed(1), +(fighters[1].z || 0).toFixed(1)], running: [fighters[0].running, fighters[1].running],
    runT: [+(fighters[0]._runT || 0).toFixed(2), +(fighters[1]._runT || 0).toFixed(2)], dashing: [fighters[0]._dashT0 > -5, fighters[1]._dashT0 > -5],
    jumping: [jumping(fighters[0]), jumping(fighters[1])], diving: [fighters[0]._diveT0 > -5, fighters[1]._diveT0 > -5],
    guarding: [fighters[0].guarding, fighters[1].guarding],
    guardStam: [Math.round(fighters[0].guardStam), Math.round(fighters[1].guardStam)],
    guardLock: [+fighters[0].guardLock.toFixed(2), +fighters[1].guardLock.toFixed(2)],
    strikePending: [fighters[0]._strikeAt > 0, fighters[1]._strikeAt > 0],
    parries: inc.parries, counter: [!!fighters[0]._counterFrom, !!fighters[1]._counterFrom],
    pushCd: [+fighters[0].pushCd.toFixed(2), +fighters[1].pushCd.toFixed(2)] }) };
// 練習模式:B 鍵切換 AI 開關。關掉後紅方不動(不追、不打),當成手感練習的假人。
// 讀 fighters[1].ai 為唯一真相(tune 面板的勾選也吃這條),HUD 據此顯示狀態。
function toggleAI() {
  const on = !fighters[1 - LOCAL].ai;
  for (let i = 0; i < fighters.length; i++) if (i !== LOCAL) fighters[i].ai = on;
  const o = fighters[1 - LOCAL];
  if (!on) { o.vx = 0; o.vy = 0; } // 停下當假人
  addText(o.x, o.y - 42, on ? 'AI 開啟' : 'AI 關閉 · 練習模式', on ? '#ff6b6b' : '#9affd0');
  game.sfx.push('upgrade');
}
// 減閃爍(光敏無障礙,玩家反饋「一直閃爍對眼睛不好」):L 切換,localStorage 記憶
function toggleFlicker() {
  v2s.lowFlicker = !v2s.lowFlicker;
  try { localStorage.setItem('mmm_lowFlicker', v2s.lowFlicker ? '1' : '0'); } catch { /* 隱私模式沒有 storage 也能玩 */ }
  setLabFlicker(v2s.lowFlicker);
  const me = fighters[LOCAL];
  addText(me.x, me.y - 42, v2s.lowFlicker ? '減閃爍:開' : '減閃爍:關', '#9affd0');
  game.sfx.push('upgrade');
}
window.addEventListener('keydown', (e) => {
  unlockAudio();
  const k = e.key.toLowerCase(); // 跑=預設(brawl-2):雙擊偵測退役;'shift'=防禦、' '=跳(pollGuard/pollJump 每幀讀 keys)
  keys.add(k);
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '/'].includes(k)) e.preventDefault();
  if (v2s.camp.phase === 'menu') { if (k === 'enter' || k === ' ') startGame(); return; } // camp-0:選單期只收「開始」
  if (k === 'b') toggleAI(); // 切換 AI / 練習模式
  if (k === 'l') toggleFlicker(); // 減閃爍開關
  if (k === 'k') cycleSlowmo(); // 慢動作觀察:1→0.5→0.25→0.1× 循環
  if (v2s.matchOver) { // incident report screen: R = rematch, C = copy share text
    if (k === 'r') restartMatch();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('pointerdown', unlockAudio);

// --- 滑鼠退役(keys-1,使用者拍板 2026-07-21:雙端一致):v2 不再吃滑鼠瞄準/點擊——
// 面向=移動方向(8 向)、C=攻擊、X=互動、Z=道具。只留 contextmenu 阻擋(誤右鍵不彈選單)。
const gameCanvas = document.getElementById('game');
gameCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

game.state = 'v2';      // not 'playing' → render's capstone/HUD branches stay off
game.player = null;     // camera centres on the arena, no player voxel
game.stats = null;
if (TERRAIN === 'isles') {
  buildFlatMap();                                   // no walls; falling is governed by onSolid
  setIslandShapes(ISLANDS, BRIDGES);                // organic round islands + rope bridges (mesh)
  game.isVoidAt = (e) => !onSolid(e.x, e.y);        // off any island/bridge → fall
  CAM.fov = 22; CAM.angle = 22; CAM.dist = 860; CAM.azimuth = 0; CAM.panX = 0; CAM.panZ = -60; CAM.lookY = 10;
} else if (TERRAIN === 'grid') {
  buildArena();                                     // grid broken-isles
  setIslandMode(true);                              // tile-slab floating island
  CAM.fov = 26; CAM.angle = 24; CAM.dist = 1150; CAM.azimuth = 0; CAM.panX = 0; CAM.panZ = -10; CAM.lookY = 20;
} else {                                            // 'rim'(正式:開放邊緣+四角平台)| 'flat'(全牆退路,好測收容)
  if (TERRAIN === 'rim') {                          // ring-1(朋友提案 2026-07-29):四側邊帶=廢料井
    buildFlatMap();                                 // 無牆 tile(走/被打飛都能出界);墜落由 onSolid 裁定
    game.isVoidAt = (e) => !onSolid(e.x, e.y);      // fx.overVoid → 死亡劇場 → v2 迴圈計分(resolveFall)
    setRimGeometry(RIM);                            // render-lab ring-2:懸浮平台(裁形地板+側裙+深淵+整圈警戒帶;圍場造景退役)
  } else {
    buildFlatArena();
    setWallFade(true);                              // see-through walls: occluding walls (esp. the south one) fade
    setApron(true);                                 // 場外暗地板(rim 島不開:平台外=深淵,同層暗地板會殺掉懸浮感)
  }
  // 實驗室主題(arcane containment 原型換皮):暗藍紫做舊地板+發光溝縫+焦痕符文+冷色氛圍
  setLabTheme(true);
  try { v2s.lowFlicker = localStorage.getItem('mmm_lowFlicker') === '1'; } catch { /* no storage */ }
  setLabFlicker(v2s.lowFlicker); // 減閃爍偏好開機還原
  // 首局教學(使用者上手文檔 2026-07):沒玩過 → 教學局。示範者 AI 開場先撿垃圾丟進艙示範清運迴圈
  // (取代「不會動的練習假人」——一頭霧水的頭號元兇),頭幾秒不主動打你;開場放目標字幕+鏡頭帶到對手。
  try { v2s.tutorial = localStorage.getItem('mmm_v2_played') !== '1'; } catch { v2s.tutorial = true; }
  { const o = fighters[1 - LOCAL]; o.ai = true; o._aiMode = 'fight'; } // 爽鬥:紅方=AI 對手,開局即戰(小人不再搬瓶);B 鍵仍可切練習假人
  applyAiTier('intern'); // tier-1:對手從實習生起手(快輸=逃跑搬救兵→資深同事;AI_PROFILE 旋鈕表)
  // camp-0:預設先停在主選單(規格 H §14);自動化/試播旗走舊路=開機即開打(見 MENU_ON)
  setSealHandler(campSeal);                       // camp-1:封存完成後由闖關接手(free/加班模式回 false=走舊路)
  initMenu(startGame, () => loadRun());
  // ⚠ 沒有選單時一律進 **free**(=加班模式/舊行為:封存→事故報告)。這是既有 40 支回歸的保命符:
  //   闖關只在玩家真的從主選單按下開始後才接管。
  if (MENU_ON) { enterMenu(); } else { v2s.camp.phase = 'free'; setMenuVisible(false); }
  v2s.introT = MENU_ON ? 0 : INTRO_T;             // 開場目標字幕/鏡頭帶場(教學+老手都演一次,便宜且無害)
  camRig.x = (fighters[0].x + fighters[1].x) / 2; camRig.y = (fighters[0].y + fighters[1].y) / 2; // 鏡頭開場=兩人中點(就位構圖;「開始!」後回玩家)
  setActorShadow(true);
  setVividFx(true);
  // pulled in (dist↓) and panned so the followed player sits in the lower third: panZ<0 pushes the look-target
  // north, so the player (south of it) rides low in frame → less black void below, more arena ahead. (Live-tune via __v2.CAM.)
  Object.assign(CAM, { azimuth: 0, panX: 0, panZ: -25 }, CAM_FIGHT); // v2 相機定案(使用者 ?tune 拉定;戰鬥視角=CAM_FIGHT、開場高視角=CAM_INTRO,都在 updateCamRig 上方。改 v2 視角改那裡,不是 state.js——state.js 的 CAM 只是單機預設,v2 開機即蓋掉)
}
// flat mode uses the smoothed/bounded camRig; isles/grid follow the fighter directly (their framing differs)
// ===== flow-2c 瀕界層:只差一筆就被下收容指令時,用**聲音**提醒(視覺已飽和:疲態+立案 beat+階段警報)=====
// 心跳只在「本機玩家自己」瀕界時響=讀成自己的心跳(對手瀕界是好事,不該給你壓迫感);
// 首次進入瀕界另給一次性橫幅把因果講白(玩家反饋:不知不覺就被記滿了)。演出/終演/終局中靜音——戲在別處。
function updateBrink(dt) {
  const me = fighters[LOCAL];
  const brink = me.state === 'alive' && me.fatigue >= RECORD_TARGET - 1
    && !v2s.perform && !v2s.reject && !v2s.finisher && !v2s.matchOver && v2s.introT <= 0;
  if (!brink) { v2s.brinkT = 0; return; }
  if (!v2s.brinkShown) {                              // 一次性因果說明(本場一次;restartMatch 清)
    v2s.brinkShown = true;
    v2s.bannerText = '⚠ 再被記一筆,對方就能對你執行收容封存'; v2s.winBannerT = 2.6;
    game.sfx.push('hurt');
  }
  v2s.brinkT -= dt;
  if (v2s.brinkT <= 0) { v2s.brinkT = FATIGUE.brink.every; game.sfx.push('heartbeat'); }
}
// ===== 規格 G §4.3 終演鏡頭:近拍跟拍搬運者 → 拋入瞬間拉回框艙 → 演出結束 lerp 回原值 =====
// CAM 是 live 物件(camera-sandbox 慣例),直接 lerp 欄位;原值存 v2s.finCam,結束還原。
let podPulseT = 0;
const _podFocus = { x: POD.x, y: POD.y };
function updateFinisherCam(dt) {
  const F = v2s.finisher, P = v2s.perform;
  const active = (F && F.phase !== 'prompt') || (P && P.final && v2s.finCam);
  if (active) {
    if (!v2s.finCam) {
      v2s.finCam = { dist: CAM.dist, angle: CAM.angle, lookY: CAM.lookY, az: CAM.azimuth, target: game.camTarget, t: 0 };
    }
    const C = v2s.finCam; C.t += dt;
    const k = 1 - Math.exp(-dt * 3.2);
    if (F && (F.phase === 'run' || F.phase === 'carry')) {                 // 近拍:跟搬運者
      game.camTarget = fighters[F.w];
      CAM.dist += (360 - CAM.dist) * k; CAM.angle += (20 - CAM.angle) * k; CAM.lookY += (26 - CAM.lookY) * k;   // 推近跟拍(戰鬥 630;fov 27 是窄鏡頭,190 實測=角色佔 75% 畫面太擠,360≈四成高剛好)
      CAM.azimuth = C.az + Math.sin(C.t * 0.5) * 0.14;                     // 電影感微環繞
    } else {                                                               // 拋入/封存:拉回框艙
      game.camTarget = _podFocus;
      CAM.dist += (260 - CAM.dist) * k; CAM.angle += (C.angle - CAM.angle) * k; CAM.lookY += (C.lookY - CAM.lookY) * k;
      CAM.azimuth += (C.az - CAM.azimuth) * k;
    }
  } else if (v2s.finCam) {                                                 // 還原(演出結束/終演被取消)
    const C = v2s.finCam, k = 1 - Math.exp(-dt * 2.2);
    CAM.dist += (C.dist - CAM.dist) * k; CAM.angle += (C.angle - CAM.angle) * k;
    CAM.lookY += (C.lookY - CAM.lookY) * k; CAM.azimuth += (C.az - CAM.azimuth) * k;
    if (Math.abs(CAM.dist - C.dist) < 2 && Math.abs(CAM.angle - C.angle) < 0.5) {
      CAM.dist = C.dist; CAM.angle = C.angle; CAM.lookY = C.lookY; CAM.azimuth = C.az;
      game.camTarget = C.target; v2s.finCam = null;
    }
  }
}
setRimTeams(COLORS, LOCAL);   // ui-2:輪廓線要的隊伍色/本機 pid(render 不 import v2-state,由 glue 注入)
setOutlineLow(FX_LOW);        // ui-2:手機(FX_LOW)關掉描邊殼(+~20 draw call/角色)
game.camTarget = (TERRAIN === 'flat' || TERRAIN === 'rim') ? camRig : fighters[0];
game.occludeTarget = fighters[LOCAL]; // see-through walls aim at the REAL player, not the (clamped) camera rig
game.enemies = fighters.slice();

let last = performance.now();
requestAnimationFrame(frame);

// Phase 1:?avatar=1 → 預載使用者的 GLB 角色(render 層;非同步,就緒後 updateBrawler 自動換裝)
import('./actor-avatar.js').then(m => m.preloadAvatar()).catch(e => console.warn('[v2] avatar preload failed', e));

// 手部 GLB(扛人=握拳、丟人放手=張開;其餘=拳套)。render 層,零玩法影響。
import('./actor-hands.js').then(m => m.preloadHands()).catch(e => console.warn('[v2] hands preload failed', e));

// opt-in live tuning panel (角色大小 / 格線 / 地板顏色·搶眼度 / 攝影機): open v2.html?tune=1
if (new URLSearchParams(location.search).has('tune')) import('./v2-tuning.js').catch(e => console.warn('[v2] tuning panel failed', e));

// 手機觸控層(docs/mobile-touch.md)。Phase A:觸控偵測 + 橫向提示。桌機零影響。
import('./v2-touch.js').then(m => { touchMod = m; m.initTouch(); m.setReportActions({ rematch: restartMatch }); }).catch(e => console.warn('[v2] touch layer failed', e));
