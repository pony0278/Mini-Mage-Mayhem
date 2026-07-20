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
import { render3D, drawPanicFaces, setIslandMode, setIslandShapes, setWallFade, setFloorParams, setActorShadow, setVividFx, setGroundMarkers, setRichFloor, setLabTheme, setLabFlicker, setApron, setStationsPowered, setPodPerform, updateMouseWorld, mouseScreen } from './render.js';
import { playSfx, unlock as unlockAudio } from './audio.js';
import {
  v2s, fighters, LOCAL, dlog, inc, resetInc, roundWins, containLog,
  resetFighter, resetBarrels, resetPads, resetGroundItems, groundItems, resetStage, resetStations,
  POD, inPod, pads, barrels, bottles, resetBottles, ITEM_INFO, ITEM_SPEC, BARREL_BLAST, GRAB_RANGE,
  stations, STATION_WARN, ERUPT_PATCH_R, labSwitches, WIND_RANGE, WIND_CONE, FIRE_RANGE, FIRE_CONE, WATER_SLAM_DIST, WATER_R, LIGHTNING_RANGE,
  RESPAWN, STAB_MAX, STAB_REGEN, STUN_RECOVER, RESTUN_IMMUNE, CARRY_MASH_AI, CARRY_MASH_TAP, CARRY_ESCAPE_NEED, INTRO_T, INTRO_GO,
  PERSON_LOB, BARREL_LOB, PUNCH_LAUNCH_LOB, WIND_CARRY_LOB, BOTTLE_LOB, LAND_SKID, lobZ, JUMP_LOB, DIVE_T, RUN_STICK,
  camRig, CAMB, NAMES, AI_PROFILE,
} from './v2-state.js';
import { TERRAIN, ISLANDS, BRIDGES, onSolid, buildArena, buildFlatMap, buildFlatArena } from './v2-terrain.js';
import { moveFighter, punch, resolveStrike, doAction, doGuard, doPushOff, canGuard, updateGuard, startCarry, dropCarry, throwCarried, launchCarried, inThrowFlight, breakFree, stunFighter, containByCarry, containByEnviron, endMatch, floorHazards, drainFloorEvents, onSlipperyIce, startPerform, updatePerform, jump, dive, jumping, airborne, applyAiTier, updateAiCall } from './v2-combat.js';
import { updatePads, updateBarrels, updateBottles, updateStations, updateGroundItems, pickupItem, dropLooseItem, useItem, resolveItemCast, castWind, castTeleport, castFire, castWater, castLightning, shatterBottle, explodeBarrel, barrelChargeColor, elemColor, grabbableBarrel, pickUpBarrel, dropBarrel, throwBarrel, launchBarrel } from './v2-items.js';
import { stepFloor, resetFloor } from './v2-floor.js';
import { generateReport } from './v2-report.js';
import { drawHud } from './v2-hud.js';
import { CLIPS } from './brawler-clips.js';   // ?clip= 試播入口用(clip 名單+時長)

let prevLocalSolid = true; // track when YOU step off solid ground (isles diagnostics)
let _armedShown = false;       // 四角站通電光環的上次同步值(step 幀尾偵測 v2s.stationsArmed 變化)

// 測試旗 ?grabany=1:免「對手被擊暈」前提,隨時可舉起對手(測扛/丟動畫+avatar rigged 手用)。
// 正常玩法要先揍暈才抓;開這旗只放寬本機玩家的抓取條件,其餘(冷卻/被抓/範圍)照舊。
const GRAB_ANY = new URLSearchParams(location.search).get('grabany') === '1';

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

// --- round / match orchestration ---
function resetRound() {
  resetBarrels(); resetBottles(); resetPads(); resetGroundItems(); resetStations(); resetFloor();
  for (const f of fighters) resetFighter(f);
}
function restartMatch() {
  v2s.matchOver = false; v2s.report = null; roundWins[0] = 0; roundWins[1] = 0;
  inc.falls = [0, 0]; inc.knockoffs = [0, 0]; inc.selfFalls = [0, 0];
  resetInc(); containLog.length = 0; v2s.bannerText = ''; v2s.winBannerT = 0; resetStage();
  v2s.perform = null; for (const f of fighters) { f._performing = false; f._hidden = false; f._lastItem = null; } // 回收演出殘留(分類記憶跨回合、不跨場)
  v2s.aiCalled = false; v2s.aiCallAt = 0; v2s.aiCallPos = null; applyAiTier('intern'); // tier-1:再戰從實習生重新開始(逃跑戲重新武裝)
  v2s.introT = INTRO_T; camRig.x = (fighters[0].x + fighters[1].x) / 2; camRig.y = (fighters[0].y + fighters[1].y) / 2; // 再戰也走開場儀式(就位→開始!)
  resetRound();
}

// --- 有界跟隨(bounded follow):鏡頭跟一個「平滑 + 夾在內縮框裡」的代理點(camRig),
// 而不是直接黏在角色上。X 夾在 [ix, W-ix]:玩家貼牆仍在畫面內、又不越過側牆露黑邊;
// 垂直同樣夾 ny/sy。只用在平台場;浮島/格子場直接跟角色。數值可用 __v2.CAMB 即時微調。
let _camDist0 = 0; // 開場拉遠用的基準 dist(boot 設定後記住;intro 結束還原)
function updateCamRig(dt) {
  const lf = fighters[LOCAL];
  let tx = Math.min(Math.max(lf.x, CAMB.ix), W - CAMB.ix), ty = Math.min(Math.max(lf.y, CAMB.ny), CAMB.sy);
  // 開場帶場(使用者拍板 2026-07:雙方就位靜止,鏡頭框住「兩人」+拉遠 →「開始!」後平滑回玩家;
  // 不再飛去對手那邊——AI 一開工到處回收垃圾,玩家看著就懂)。
  if (v2s.introT > 0) {
    if (!_camDist0) _camDist0 = CAM.dist;
    const o = fighters[1 - LOCAL];
    const back = Math.min(1, Math.max(0, (INTRO_GO - v2s.introT) / INTRO_GO));   // 0=就位期,→1=「開始!」期間回到玩家
    const e = back * back * (3 - 2 * back);                                       // smoothstep
    const mx = (lf.x + o.x) / 2, my = (lf.y + o.y) / 2;                           // 兩人中點
    tx = mx + (tx - mx) * e; ty = my + (ty - my) * e;
    CAM.dist = _camDist0 + 130 * (1 - e);                                         // 拉遠框住雙方,回程收回
  } else if (_camDist0) { CAM.dist = _camDist0; _camDist0 = 0; }                  // intro 結束還原(不干擾 sandbox 調參)
  const e = Math.min(1, dt * CAMB.ease);
  camRig.x += (tx - camRig.x) * e; camRig.y += (ty - camRig.y) * e;
}

// --- 輸入:情境動作(J)/道具(K)/跳躍(空白)/格擋(Shift),邊緣觸發;滑鼠=瞄準+左鍵連擊+右鍵情境 ---
function mouseLeft(f) {                                                         // 左鍵=揮拳;扛人=拋擲;扛桶=丟桶
  if (f.state !== 'alive') return;
  if (f.carryObj) { throwBarrel(f); return; }
  if (f.carrying) { throwCarried(f); return; }
  punch(f);
}
// 右鍵=攻擊直覺(玩家反饋 2026-07:拿噴火帽想引爆瓶,右鍵卻變舉瓶):持攻擊裝備(kind blast)→ 直接開火,
// 不被撿桶/瓶搶走;逃脫類(傳送 mobility)不佔右鍵優先=拿著傳送照樣右鍵撿桶。撿/抓的互動優先版在 E(contextAction)。
function mouseRight(f) {
  if (f.state !== 'alive') return;
  if (f.carryObj) { dropBarrel(f); return; }                                   // 扛桶/瓶中 → 放下
  if (f.carrying) { dropCarry(f); return; }                                    // 搬運中 → 放下
  if (!f.carriedBy && !f.stunned && f.fumbleT <= 0 && f.regrabCd <= 0) {
    const o = fighters[1 - f.pid];                                              // 抓暈眩對手=最高優先(收容主動詞)
    if (o.state === 'alive' && (o.stunned || GRAB_ANY) && !o.carriedBy && o.invuln <= 0 && Math.hypot(o.x - f.x, o.y - f.y) <= GRAB_RANGE + o.r) { startCarry(f, o); return; }
    if (f.item && ITEM_SPEC[f.item].kind === 'blast') { useItem(f); return; }   // 攻擊裝備=右鍵開火(引爆桶/瓶靠這下)
    if (pickupItem(f)) return;                                                   // 空手 → 撿補給座/地上掉落道具
    const b = grabbableBarrel(f); if (b) { pickUpBarrel(f, b); return; }        // → 撿桶/瓶
  }
  useItem(f); // 否則放技能(useItem 自帶守衛:無道具直接略過;被抓/暈時只有傳送可用)
}
// E/觸控情境鍵=互動優先(舊右鍵順序):撿/抓照舊——持攻擊裝備時也能撿桶/瓶(跟右鍵開火分工)。
function contextAction(f) {
  if (f.state !== 'alive') return;
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
  const pressed = [keys.has('k'), keys.has('.')];
  for (let i = 0; i < 2; i++) { if (i !== LOCAL) continue; if (pressed[i] && !itemPrev[i]) useItem(fighters[i]); itemPrev[i] = pressed[i]; }
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
function pollJump() { // 空白=跳(edge);空中再按攻擊=下壓拳(mouseLeft→punch→dive 分派)
  const pressed = keys.has(' ');
  const f = fighters[LOCAL];
  if (pressed && !jumpPrev) jump(f);
  jumpPrev = pressed;
  if (touchInput.press.jump) { touchInput.press.jump = false; jump(f); }
}
const contextPrev = [false, false]; // E 鍵=互動優先情境(contextAction:撿/抓照舊;與右鍵開火分工)。Mac 觸控板/無滑鼠也靠這鍵
function pollContext() {
  const pressed = [keys.has('e'), false];
  for (let i = 0; i < 2; i++) { if (i !== LOCAL) continue; if (pressed[i] && !contextPrev[i]) contextAction(fighters[i]); contextPrev[i] = pressed[i]; }
}
// 觸控動作按鈕(Phase C):v2-touch 按下時設 press 閂鎖,這裡消費=一次一擊(等同鍵鼠的邊緣觸發)。
// 揮拳/情境走一般幀;格擋另抽一支,定格(hitstop)中也要收(反應常落在凍結幀)——同 pollGuard。
function pollTouchButtons() {
  if (touchInput.press.punch)   { touchInput.press.punch = false;   mouseLeft(fighters[LOCAL]); }
  if (touchInput.press.context) { touchInput.press.context = false; contextAction(fighters[LOCAL]); } // 觸控=互動優先(單鍵難分工,保住撿桶瓶玩法)
}
function pollTouchGuard() {
  if (touchInput.press.guard) { touchInput.press.guard = false; doGuard(fighters[LOCAL]); }
}
// 結算畫面「複製」觸控鈕:等同鍵盤 C(把戰報分享文字寫進剪貼簿)。
function copyShare() { if (v2s.report && navigator.clipboard) { navigator.clipboard.writeText(v2s.report.share); dlog('copied share text'); } }
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
  game.time += dt; inc.matchT += dt;
  if (v2s.introT > 0) v2s.introT -= dt;          // 開場目標字幕/鏡頭帶場倒數
  if (v2s.introT > INTRO_GO && (keys.size > 0 || (touchInput.enabled && touchInput.active))) v2s.introT = INTRO_GO; // 等不及的玩家按任何鍵=直接「開始!」
  if (v2s.winBannerT > 0) v2s.winBannerT -= dt;
  if (v2s.localFlash > 0) v2s.localFlash -= dt;
  if (v2s.fallReasonT > 0) v2s.fallReasonT -= dt;
  updateParticles(dt); updateRings(dt); updateFloatingTexts(dt);
  syncTouchLabels(); // 情境按鈕字(每幀,只在變動時寫 DOM)
  if (game.hitstop > 0) { game.hitstop -= dt; pollGuard(); pollTouchGuard(); } // 定格中也收格擋輸入:玩家的反應常落在凍結幀裡,不能吃掉
  else {
    pollAction(); pollItem(); pollGuard(); pollContext(); pollJump();
    pollTouchButtons(); pollTouchGuard();
    if (TEST_CLIP) {                                   // ?clip= 試播:循環播放 + 凍結對手 AI
      fighters[1 - LOCAL].ai = false;
      if (game.time >= _clipNextT) _clipNextT = game.time + (playClip(TEST_CLIP) || 1) + 0.5;
    }
    stepFloor(dt); // 地板化學:火沿油滾動 + 每格衰退/預警 + 電水雙計時器(注入=道具/站;cut 3 接)
    for (const f of fighters) {
      if (f.state === 'down') { f.respawn -= dt; if (f.respawn <= 0) resetFighter(f); continue; }
      if (f.state === 'away') continue; // 實習生跑掉搬救兵(tier-1):場外待命,updateAiCall 排資深進場
      if (f._performing) { f.x = POD.x; f.y = POD.y; f.vx = 0; f.vy = 0; continue; } // 收容演出:被罩在艙心(掙扎/掃描由 render+HUD 演;stun 倒數也凍結=不會醒)
      // cooldown timers
      if (f.punchCd > 0) f.punchCd -= dt;
      if (f.jumpCd > 0) f.jumpCd -= dt;
      if (f._diveLagT > 0) f._diveLagT -= dt;
      if (f.itemCastCd > 0) f.itemCastCd -= dt;
      if (f.regrabCd > 0) f.regrabCd -= dt;
      if (f.fumbleT > 0) f.fumbleT -= dt;
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
        f._lying = !!(f._thrownT > -5 && game.time - f._thrownT < lob.T + 0.15 && (z > 0 || f.fumbleT > 0));
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
        }
        continue;
      }
      // 跑=預設(brawl-2):有移動輸入就是跑;扛人/扛桶/暈眩/踉蹌不能跑(搬運要有重量感);瓶=輕,拿著照樣跑。
      // 手機:搖桿推程 < RUN_STICK=走(微操走位)、到底=跑;AI 維持走速(可預測的難度)。
      const mvIn = (!f.ai && f.pid === LOCAL)
        ? (touchInput.enabled ? (touchInput.active && touchInput.mag >= RUN_STICK)
          : (keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d')))
        : !!f._fleeing; // AI 平時走速(可預測);逃跑=進跑速(tier-1,moveFighter 再 ×FLEE_SPEED 讓玩家衝刺追得上)
      f.running = !!(mvIn && !f.carrying && !(f.carryObj && f.carryObj.kind !== 'bottle') && !f.stunned && f.fumbleT <= 0);
      f._runT = f.running ? (f._runT || 0) + dt : 0; // 衝刺狀態計時:持續跑 ≥ DASH_RUN_T 出拳=衝刺攻擊(feel-1)
      floorHazards(f, dt); // 踩電水硬直 / 站火海·毒區削穩定值 → 歸零擊暈(移動前讀最新地板)
      if (!f.carriedBy) moveFighter(f, dt); // carried fighter is positioned by the carry loop below
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
        const aDown = keys.has('a'), dDown = keys.has('d');
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
          : thrown ? 'throw' : (onSlipperyIce(f.x, f.y) || game.time - (f._slideT || -9) < 0.5) ? 'ice' : (f.lastHitBy === -3 ? 'barrel' : 'wind'); // 剛滑出冰面衝進艙也算 ice
        containByEnviron(f, cause); break;
      }
    }
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
  // alive barrels render as orange explosive crates (charge:'fire' → burning box in syncProps)
  // 被扛的桶(b.held)由 actor-brawler 畫在雙手上(舉過頭頂/丟桶 heave),這裡略過免雙重繪
  // fly = sim 真高度(B 案彈道 b.z,updateBarrels 算);人的高度=f.z(actor-brawler 直接讀)
  game.props = barrels.filter(b => b.alive && !b.held).map(b => ({ x: b.x, y: b.y, r: b.r, charge: 'fire', hp: 1, maxHp: 1, held: false, fly: b.z || 0, vx: b.vx, vy: b.vy, roll: b.roll })); // vx/vy/roll → render 桶翻滾(繞運動法向水平軸)
  for (const sw of labSwitches) game.props.push({ x: sw.x, y: sw.y, r: sw.r, sw: true, armed: v2s.stationsArmed, hp: 1, maxHp: 1, held: false }); // 左右緊急拉桿(render-entities 畫拉桿:未啟動=琥珀立起、啟動=壓下變暗)
  for (const t of bottles) if (t.alive && !t.held) game.props.push({ x: t.x, y: t.y, r: t.r, wall: t.elem, hp: 1, maxHp: 1, held: false, fly: t.z || 0, vx: t.vx, vy: t.vy, roll: t.roll }); // 場上投擲瓶(桶模 tint 佔位,瓶模好了換 mesh;vx/vy/roll → 翻滾)
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
  updateMouseWorld(); // 滑鼠螢幕座標 → 地面世界座標(供本地玩家瞄準)
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
  grabbableBarrel, pickUpBarrel, dropBarrel, throwBarrel, launchBarrel, playClip,
  PERSON_LOB, BARREL_LOB, PUNCH_LAUNCH_LOB, WIND_CARRY_LOB, BOTTLE_LOB, bottles, shatterBottle, roundWins, containLog, // 彈道 tuning(物件可變:控制台改即時生效;?tune=1 滑桿同源)+ 場上瓶(測試用)
  punch, resolveStrike, doGuard, canGuard, updateGuard, startCarry, stunFighter, throwCarried, launchCarried, dropCarry, breakFree, pads, groundItems, pickupItem, dropLooseItem, useItem, resolveItemCast, mouseRight, contextAction, castWind, castTeleport, castFire, castWater, castLightning, inc, generateReport, endMatch, jump, dive, JUMP_LOB,
  NAMES, AI_PROFILE, applyAiTier, updateAiCall, // AI 階級(tier-1):檔案表+進場排程(測試/控制台)
  state: () => ({ winnerPid: v2s.winnerPid, roundWins: [roundWins[0], roundWins[1]], matchOver: v2s.matchOver, report: v2s.report, stage: v2s.stage,
    perform: v2s.perform ? { n: v2s.perform.n, phase: v2s.perform.phase, t: +v2s.perform.t.toFixed(2), line: v2s.perform.line, final: v2s.perform.final } : null,
    tutorial: v2s.tutorial, introT: +v2s.introT.toFixed(2), aiMode: fighters[1 - LOCAL]._aiMode,
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
  if (k === 'b') toggleAI(); // 切換 AI / 練習模式
  if (k === 'l') toggleFlicker(); // 減閃爍開關
  if (k === 'k') cycleSlowmo(); // 慢動作觀察:1→0.5→0.25→0.1× 循環
  if (v2s.matchOver) { // incident report screen: R = rematch, C = copy share text
    if (k === 'r') restartMatch();
    else if (k === 'c' && v2s.report && navigator.clipboard) { navigator.clipboard.writeText(v2s.report.share); dlog('copied share text'); }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('pointerdown', unlockAudio);

// --- 滑鼠:游標→瞄準(存螢幕像素,每幀 raycast 成地面世界座標),左鍵連擊,右鍵情境(抓/道具) ---
const gameCanvas = document.getElementById('game');
gameCanvas.addEventListener('mousemove', (e) => {
  const rect = gameCanvas.getBoundingClientRect();
  mouseScreen.x = (e.clientX - rect.left) / rect.width * gameCanvas.width;   // 視圖像素(16:9 畫布),非世界座標
  mouseScreen.y = (e.clientY - rect.top) / rect.height * gameCanvas.height;
});
gameCanvas.addEventListener('mousedown', (e) => {
  unlockAudio();
  if (v2s.matchOver) return;                    // 報告畫面:用鍵盤 R 再戰 / C 複製
  const f = fighters[LOCAL]; if (!f || f.ai) return;
  if (e.button === 2) mouseRight(f);            // 右鍵
  else if (e.button === 0) mouseLeft(f);        // 左鍵
});
gameCanvas.addEventListener('contextmenu', (e) => e.preventDefault()); // 右鍵不彈出選單

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
} else {                                            // 'flat' — plain walled platform, no falling (best for testing)
  buildFlatArena();
  setWallFade(true);                                // see-through walls: occluding walls (esp. the south one) fade
  setApron(true);                                   // 場外暗地板:蓋掉牆外黑虛空(16:9 視野較寬)
  // 實驗室主題(arcane containment 原型換皮):暗藍紫做舊地板+發光溝縫+焦痕符文+冷色氛圍
  setLabTheme(true);
  try { v2s.lowFlicker = localStorage.getItem('mmm_lowFlicker') === '1'; } catch { /* no storage */ }
  setLabFlicker(v2s.lowFlicker); // 減閃爍偏好開機還原
  // 首局教學(使用者上手文檔 2026-07):沒玩過 → 教學局。示範者 AI 開場先撿垃圾丟進艙示範清運迴圈
  // (取代「不會動的練習假人」——一頭霧水的頭號元兇),頭幾秒不主動打你;開場放目標字幕+鏡頭帶到對手。
  try { v2s.tutorial = localStorage.getItem('mmm_v2_played') !== '1'; } catch { v2s.tutorial = true; }
  { const o = fighters[1 - LOCAL]; o.ai = true; o._aiMode = 'fight'; } // 爽鬥:紅方=AI 對手,開局即戰(小人不再搬瓶);B 鍵仍可切練習假人
  applyAiTier('intern'); // tier-1:對手從實習生起手(快輸=逃跑搬救兵→資深同事;AI_PROFILE 旋鈕表)
  v2s.introT = INTRO_T;                          // 開場目標字幕/鏡頭帶場(教學+老手都演一次,便宜且無害)
  camRig.x = (fighters[0].x + fighters[1].x) / 2; camRig.y = (fighters[0].y + fighters[1].y) / 2; // 鏡頭開場=兩人中點(就位構圖;「開始!」後回玩家)
  setActorShadow(true);
  setVividFx(true);
  // pulled in (dist↓) and panned so the followed player sits in the lower third: panZ<0 pushes the look-target
  // north, so the player (south of it) rides low in frame → less black void below, more arena ahead. (Live-tune via __v2.CAM.)
  CAM.fov = 32; CAM.angle = 44; CAM.dist = 650; CAM.azimuth = 0; CAM.panX = 0; CAM.panZ = -25; CAM.lookY = 14;
}
// flat mode uses the smoothed/bounded camRig; isles/grid follow the fighter directly (their framing differs)
game.camTarget = TERRAIN === 'flat' ? camRig : fighters[0];
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
import('./v2-touch.js').then(m => { touchMod = m; m.initTouch(); m.setReportActions({ rematch: restartMatch, copy: copyShare }); }).catch(e => console.warn('[v2] touch layer failed', e));
