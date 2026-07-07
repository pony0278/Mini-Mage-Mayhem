// v2.html 的膠水層 (docs/v2-module-boundaries.md):輸入(鍵盤/滑鼠)、step() 主模擬編排、
// frame() 迴圈、開機(地形/攝影機/render 旗標)、__v2 debug hook。
// 玩法本體住在 v2-* 模組:state(狀態+調參)/terrain(地形)/combat(戰鬥)/items(道具)/
// report(事故報告)/hud(2D 繪製)。單機的 sim.js/render.js/main.js 完全不受 v2 影響。
//
// 歷史:這裡曾是 1000+ 行的單檔原型(陣風把人吹進洞的 laugh-gate 測試),玩法收斂到
// 「魔法事故報告 · 收容測試」(spec E/F)後拆分;舊系統(陣風動詞/搶獎盃 Boss loop)
// 已移除,要考古看 git 歷史。
import { W, H } from './constants.js';
import { game, keys, CAM } from './state.js';
import { updateDeathTheater, addText, updateParticles, updateRings, updateFloatingTexts } from './sim.js';
import { render3D, drawPanicFaces, setIslandMode, setIslandShapes, setWallFade, setFloorParams, setActorShadow, setVividFx, setGroundMarkers, setRichFloor, setLabTheme, setLabFlicker, setApron, updateMouseWorld, mouseScreen } from './render.js';
import { playSfx, unlock as unlockAudio } from './audio.js';
import {
  v2s, fighters, LOCAL, dlog, inc, resetInc, roundWins, containLog, PARRY_SLOW,
  resetFighter, resetBarrels, resetPads, resetStage,
  POD, inPod, iceAt, iceZones, pads, barrels, ITEM_INFO, BARREL_BLAST, GRAB_RANGE,
  RESPAWN, STAB_MAX, STAB_REGEN, STUN_RECOVER, RESTUN_IMMUNE, CARRY_MASH_AI, CARRY_MASH_TAP, CARRY_ESCAPE_NEED,
  camRig, CAMB,
} from './v2-state.js';
import { TERRAIN, ISLANDS, BRIDGES, onSolid, buildArena, buildFlatMap, buildFlatArena } from './v2-terrain.js';
import { moveFighter, punch, resolveStrike, doAction, doGuard, doPushOff, startCarry, dropCarry, throwCarried, inThrowFlight, breakFree, stunFighter, containByCarry, containByEnviron } from './v2-combat.js';
import { updatePads, updateIce, updateBarrels, useItem, castWind, castTeleport, castIce, explodeBarrel } from './v2-items.js';
import { generateReport } from './v2-report.js';
import { drawHud } from './v2-hud.js';

let prevLocalSolid = true; // track when YOU step off solid ground (isles diagnostics)

// --- round / match orchestration ---
function resetRound() {
  resetBarrels(); resetPads(); iceZones.length = 0;
  for (const f of fighters) resetFighter(f);
}
function restartMatch() {
  v2s.matchOver = false; v2s.report = null; roundWins[0] = 0; roundWins[1] = 0;
  inc.falls = [0, 0]; inc.knockoffs = [0, 0]; inc.selfFalls = [0, 0];
  resetInc(); containLog.length = 0; v2s.bannerText = ''; v2s.winBannerT = 0; resetStage();
  resetRound();
}

// --- 有界跟隨(bounded follow):鏡頭跟一個「平滑 + 夾在內縮框裡」的代理點(camRig),
// 而不是直接黏在角色上。X 夾在 [ix, W-ix]:玩家貼牆仍在畫面內、又不越過側牆露黑邊;
// 垂直同樣夾 ny/sy。只用在平台場;浮島/格子場直接跟角色。數值可用 __v2.CAMB 即時微調。
function updateCamRig(dt) {
  const lf = fighters[LOCAL];
  const tx = Math.min(Math.max(lf.x, CAMB.ix), W - CAMB.ix), ty = Math.min(Math.max(lf.y, CAMB.ny), CAMB.sy);
  const e = Math.min(1, dt * CAMB.ease);
  camRig.x += (tx - camRig.x) * e; camRig.y += (ty - camRig.y) * e;
}

// --- 輸入:情境動作(J)/道具(K)/格擋(空白鍵),邊緣觸發;滑鼠=瞄準+左鍵連擊+右鍵情境 ---
function mouseLeft(f) {                                                         // 左鍵=揮拳;扛著人=朝滑鼠方向拋擲
  if (f.state !== 'alive') return;
  if (f.carrying) { throwCarried(f); return; }
  punch(f);
}
function mouseRight(f) {                                                        // 右鍵=拖被擊暈的人 / 放技能(道具)
  if (f.state !== 'alive') return;
  if (f.carrying) { dropCarry(f); return; }                                    // 搬運中 → 放下
  if (!f.carriedBy && !f.stunned && f.fumbleT <= 0 && f.regrabCd <= 0) {        // 空手且可動作 → 優先抓近處被擊暈的對手
    const o = fighters[1 - f.pid];
    if (o.state === 'alive' && o.stunned && !o.carriedBy && o.invuln <= 0 && Math.hypot(o.x - f.x, o.y - f.y) <= GRAB_RANGE + o.r) { startCarry(f, o); return; }
  }
  useItem(f); // 否則放技能(useItem 自帶守衛:無道具直接略過;被抓/暈時只有傳送可用)
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
const guardPrev = [false, false]; // 格擋鍵=空白鍵(本機玩家)。doGuard 三層分派:黃金窗口=反暈/挨打後=推開/空按=進冷卻
function pollGuard() {
  const pressed = [keys.has(' '), keys.has('enter')];
  for (let i = 0; i < 2; i++) { if (i !== LOCAL) continue; if (pressed[i] && !guardPrev[i]) doGuard(fighters[i]); guardPrev[i] = pressed[i]; }
}
const contextPrev = [false, false]; // E 鍵=右鍵情境動作(抓/放下/放技能)的鍵盤替身:Mac 觸控板/無滑鼠玩家不必用右鍵
function pollContext() {
  const pressed = [keys.has('e'), false];
  for (let i = 0; i < 2; i++) { if (i !== LOCAL) continue; if (pressed[i] && !contextPrev[i]) mouseRight(fighters[i]); contextPrev[i] = pressed[i]; }
}

function step(dt) {
  // 視覺計時器先衰減再檢查 matchOver —— 否則最終封存的震屏(12)在結算畫面永遠不歸零,鏡頭抖不停
  game.screenShake = Math.max(0, game.screenShake - dt * 28);
  if (game.shakeSmallCd > 0) game.shakeSmallCd -= dt;
  if (game.kickX || game.kickY) { const kd = Math.pow(0.00005, dt); game.kickX *= kd; game.kickY *= kd; if (Math.abs(game.kickX) + Math.abs(game.kickY) < 0.1) { game.kickX = 0; game.kickY = 0; } } // 鏡頭踹:~80ms 彈回
  if (v2s.matchOver) return; // freeze gameplay while the incident report is up
  game.time += dt; inc.matchT += dt;
  if (v2s.winBannerT > 0) v2s.winBannerT -= dt;
  if (v2s.localFlash > 0) v2s.localFlash -= dt;
  if (v2s.fallReasonT > 0) v2s.fallReasonT -= dt;
  updateParticles(dt); updateRings(dt); updateFloatingTexts(dt);
  if (game.hitstop > 0) { game.hitstop -= dt; pollGuard(); } // 定格中也收格擋輸入:玩家的反應常落在凍結幀裡,不能吃掉
  else {
    pollAction(); pollItem(); pollGuard(); pollContext();
    for (const f of fighters) {
      if (f.state === 'down') { f.respawn -= dt; if (f.respawn <= 0) resetFighter(f); continue; }
      // cooldown timers
      if (f.punchCd > 0) f.punchCd -= dt;
      if (f.regrabCd > 0) f.regrabCd -= dt;
      if (f.fumbleT > 0) f.fumbleT -= dt;
      if (f.restunT > 0) f.restunT -= dt;
      if (f.invuln > 0) f.invuln -= dt;
      if (f.flinchT > 0) f.flinchT -= dt;
      if (f.comboT > 0) f.comboT -= dt;
      if (f.pushCd > 0) f.pushCd -= dt;
      if (f.pushWinT > 0) { f.pushWinT -= dt; if (f.pushWinT <= 0) f._aiPushAt = 0; }
      if (f.parryWinT > 0) { f.parryWinT -= dt; if (f.parryWinT <= 0) f.parryFrom = null; } // 黃金窗口過期
      if (f.ai && f._aiPushAt && game.time >= f._aiPushAt) { f._aiPushAt = 0; doPushOff(f); } // AI 的格擋反應
      if (f._strikeAt && game.time >= f._strikeAt) resolveStrike(f); // impact 影格到 → 判定命中(起手被打斷則取消)
      // stability regen (paused right after a hit; frozen while stunned/carried)
      if (f.stabCd > 0) f.stabCd -= dt; else if (!f.stunned && !f.carriedBy) f.stability = Math.min(STAB_MAX, f.stability + STAB_REGEN * dt);
      // stun countdown → recover (ungrabbed)
      if (f.stunned) { f.stunT -= dt; if (f.stunT <= 0) { f.stunned = false; f.stability = STUN_RECOVER; f.restunT = RESTUN_IMMUNE; } }
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
      if (!f.carriedBy) moveFighter(f, dt); // carried fighter is positioned by the carry loop below
    }
    // 搬運: 被搬者跟隨在搬運者身前 + 全程掙脫 + 拖進艙 = 收容
    for (const f of fighters) {
      if (!f.carrying) continue;
      const o = f.carrying;
      if (o.state !== 'alive' || f.state !== 'alive' || f.stunned) { dropCarry(f); continue; }
      o.x = f.x + Math.cos(f.facing) * (f.r + o.r * 0.7); o.y = f.y + Math.sin(f.facing) * (f.r + o.r * 0.7); o.vx = 0; o.vy = 0;
      if (inPod(o.x, o.y)) { containByCarry(f, o); continue; }                 // 失控入艙 → 收容
      if (o.ai || o.pid !== LOCAL) o.escape += CARRY_MASH_AI * dt;              // AI / 被動假人:固定填速(不吃玩家的 A/D 移動鍵)
      else {                                                                    // 本機玩家被扛: 左右交替點按 A/D 掙脫(按指示)
        const aDown = keys.has('a'), dDown = keys.has('d');
        const aEdge = aDown && !o._aPrev, dEdge = dDown && !o._dPrev;
        if (o.mashSide === 0 && aEdge) { o.escape += CARRY_MASH_TAP; o.mashSide = 1; }
        else if (o.mashSide === 1 && dEdge) { o.escape += CARRY_MASH_TAP; o.mashSide = 0; }
        o._aPrev = aDown; o._dPrev = dDown;
      }
      if (o.escape >= CARRY_ESCAPE_NEED) breakFree(o);
    }
    // 失控入艙: 被擊退/打滑(速度夠快)、暈眩者、或被拋出翻滾中進到艙半徑 → 收容(對手勝)。無敵中免疫。
    for (const f of fighters) {
      if (f.state !== 'alive' || f.carriedBy || f.carrying || f.invuln > 0) continue;
      const thrown = inThrowFlight(f);
      if ((f.stunned || thrown || Math.hypot(f.vx, f.vy) > v2s.slideContainCur) && inPod(f.x, f.y)) {
        const cause = thrown ? 'throw' : iceAt(f.x, f.y) ? 'ice' : (f.lastHitBy === -3 ? 'barrel' : 'wind');
        containByEnviron(f, cause); break;
      }
    }
    updateBarrels(dt); updatePads(dt); updateIce(dt); // 爆桶 / 補給座重刷 / 冰面消退
  }
  // log the exact frame YOU step off solid ground (the "boarding then falling" moment, isles)
  const lf = fighters[LOCAL];
  if (lf.state === 'alive' && !lf.falling) {
    const s = onSolid(lf.x, lf.y);
    if (prevLocalSolid && !s) dlog('OFF-EDGE @', Math.round(lf.x) + ',' + Math.round(lf.y), 'v', Math.round(lf.vx) + ',' + Math.round(lf.vy), 'Δhit', (game.time - (lf.lastHitT || -9)).toFixed(2) + 's');
    prevLocalSolid = s;
  }
  // present live fighters for the renderer
  game.enemies = fighters.filter(f => f.state !== 'down');
  // alive barrels render as orange explosive crates (charge:'fire' → burning box in syncProps)
  game.props = barrels.filter(b => b.alive).map(b => ({ x: b.x, y: b.y, r: b.r, charge: 'fire', hp: 1, maxHp: 1, held: false }));
  // ground markers: 青綠實驗艙光 + 橘色爆桶危險區(引信中更亮更快閃)
  const carrying = fighters.some(f => f.carrying);
  const marks = [{ x: POD.x, y: POD.y, r: POD.r, color: carrying ? '#c661ff' : '#4dffcf', pulse: true, op: 0.72, fill: 0.16, speed: carrying ? 8 : 3 }];
  for (const b of barrels) if (b.alive && b.state === 'fuse') // 平時不畫;只有引信中(快爆)才亮出完整爆炸範圍危險環
    marks.push({ x: b.x, y: b.y, r: BARREL_BLAST * 0.85, color: '#ff7a3a', pulse: true, op: 0.92, fill: 0.24, speed: 18 });
  for (const z of iceZones) marks.push({ x: z.x, y: z.y, r: z.r, color: '#bfe9ff', pulse: false, op: 0.4, fill: 0.28 }); // 冰面
  for (const p of pads) if (p.item) marks.push({ x: p.x, y: p.y, r: 24, color: ITEM_INFO[p.item].color, pulse: true, op: 0.5, fill: 0.12, speed: 4 }); // 補給座光圈
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

let grayOn = false;
function frame(now) {
  let dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (slowmo < 1) dt *= slowmo;   // 慢動作觀察:整場模擬按倍率放慢(動畫/判定同步慢,可看清出拳過程)
  // 精準格擋黃金時間:本機玩家被瞄準的起手期 → 時間放慢+畫面去彩(HUD 保持彩色,提示跳出來)
  const parryActive = !v2s.matchOver && fighters[LOCAL].parryWinT > 0 && !fighters[LOCAL].ai;
  if (parryActive) dt *= PARRY_SLOW;
  if (parryActive !== grayOn) { grayOn = parryActive; gameCanvas.style.filter = parryActive ? 'saturate(0.12) brightness(0.9)' : ''; }
  updateMouseWorld(); // 滑鼠螢幕座標 → 地面世界座標(供本地玩家瞄準)
  step(dt);
  render3D();
  if (game.sfx.length) { for (const e of game.sfx) playSfx(e); game.sfx.length = 0; } // drain sfx
  drawHud();
  drawPanicFaces(); // 凸眼 billboarded over a launched/falling fighter (drawn after the HUD clear)
  requestAnimationFrame(frame);
}

// --- boot ---
window.__v2 = { game, fighters, CAM, onSolid, ISLANDS, BRIDGES, // debug / headless-test hook (CAM for live camera tuning)
  restartMatch,
  POD, barrels, explodeBarrel, CAMB, camRig,
  punch, startCarry, stunFighter, throwCarried, pads, iceZones, useItem, castWind, castTeleport, castIce, inc, generateReport,
  state: () => ({ winnerPid: v2s.winnerPid, roundWins: [roundWins[0], roundWins[1]], matchOver: v2s.matchOver, report: v2s.report, stage: v2s.stage,
    containLog: containLog.map(c => ({ w: c.winner, m: c.method, s: c.stage })),
    invuln: [+fighters[0].invuln.toFixed(2), +fighters[1].invuln.toFixed(2)],
    stability: [Math.round(fighters[0].stability), Math.round(fighters[1].stability)],
    stunned: [fighters[0].stunned, fighters[1].stunned],
    carrying: [fighters[0].carrying ? fighters[0].carrying.pid : -1, fighters[1].carrying ? fighters[1].carrying.pid : -1],
    escape: [Math.round(fighters[0].escape || 0), Math.round(fighters[1].escape || 0)],
    items: [fighters[0].item, fighters[1].item], pads: pads.map(p => p.item), iceZones: iceZones.length,
    contains: [inc.contains[0], inc.contains[1]], carries: inc.carries, accidentContains: inc.accidentContains,
    reverseContains: inc.reverseContains, teleportEscapes: inc.teleportEscapes, struggleEscapes: inc.struggleEscapes,
    itemBackfires: inc.itemBackfires, barrelBooms: inc.barrelBooms, itemUses: inc.itemUses,
    throws: [inc.throws[0], inc.throws[1]], throwContains: inc.throwContains,
    fumble: [+fighters[0].fumbleT.toFixed(2), +fighters[1].fumbleT.toFixed(2)],
    strikePending: [fighters[0]._strikeAt > 0, fighters[1]._strikeAt > 0],
    parries: inc.parries, parryWin: [+fighters[0].parryWinT.toFixed(3), +fighters[1].parryWinT.toFixed(3)],
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
  const k = e.key.toLowerCase();
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

// opt-in live tuning panel (角色大小 / 格線 / 地板顏色·搶眼度 / 攝影機): open v2.html?tune=1
if (new URLSearchParams(location.search).has('tune')) import('./v2-tuning.js').catch(e => console.warn('[v2] tuning panel failed', e));

// 手機觸控層(docs/mobile-touch.md)。Phase A:觸控偵測 + 橫向提示。桌機零影響。
import('./v2-touch.js').then(m => m.initTouch()).catch(e => console.warn('[v2] touch layer failed', e));
