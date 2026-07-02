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
import { render3D, drawPanicFaces, setIslandMode, setIslandShapes, setWallFade, setFloorParams, setActorShadow, setVividFx, setGroundMarkers, setRichFloor, updateMouseWorld, mouseScreen } from './render.js';
import { playSfx, unlock as unlockAudio } from './audio.js';
import {
  v2s, fighters, LOCAL, dlog, inc, resetInc, roundWins, containLog,
  resetFighter, resetBarrels, resetPads, resetStage,
  POD, inPod, iceAt, iceZones, pads, barrels, ITEM_INFO, BARREL_BLAST, GRAB_RANGE,
  RESPAWN, STAB_MAX, STAB_REGEN, STUN_RECOVER, RESTUN_IMMUNE, CARRY_MASH_AI, CARRY_MASH_TAP, CARRY_ESCAPE_NEED,
  camRig, CAMB,
} from './v2-state.js';
import { TERRAIN, ISLANDS, BRIDGES, onSolid, buildArena, buildFlatMap, buildFlatArena } from './v2-terrain.js';
import { moveFighter, punch, doAction, doPushOff, startCarry, dropCarry, breakFree, stunFighter, containByCarry, containByEnviron } from './v2-combat.js';
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
function mouseLeft(f) { if (f.state === 'alive') punch(f); }                   // 左鍵=揮拳(punch 自帶狀態守衛)
function mouseRight(f) {                                                        // 右鍵=拖被擊暈的人 / 放技能(道具)
  if (f.state !== 'alive') return;
  if (f.carrying) { dropCarry(f); return; }                                    // 搬運中 → 放下
  if (!f.carriedBy && !f.stunned && f.fumbleT <= 0 && f.regrabCd <= 0) {        // 空手且可動作 → 優先抓近處被擊暈的對手
    const o = fighters[1 - f.pid];
    if (o.state === 'alive' && o.stunned && !o.carriedBy && o.invuln <= 0 && Math.hypot(o.x - f.x, o.y - f.y) <= GRAB_RANGE + o.r) { startCarry(f, o); return; }
  }
  useItem(f); // 否則放技能(useItem 自帶守衛:無道具直接略過;被抓/暈時只有傳送可用)
}
const actionPrev = [false, false];
function pollAction() {
  const pressed = [keys.has('j'), keys.has('/')];
  for (let i = 0; i < 2; i++) { if (fighters[i].ai) continue; if (pressed[i] && !actionPrev[i]) doAction(fighters[i]); actionPrev[i] = pressed[i]; }
}
const itemPrev = [false, false];
function pollItem() {
  const pressed = [keys.has('k'), keys.has('.')];
  for (let i = 0; i < 2; i++) { if (fighters[i].ai) continue; if (pressed[i] && !itemPrev[i]) useItem(fighters[i]); itemPrev[i] = pressed[i]; }
}
const guardPrev = [false, false]; // 格擋鍵:藍=空白鍵, 紅(熱座)=Enter
function pollGuard() {
  const pressed = [keys.has(' '), keys.has('enter')];
  for (let i = 0; i < 2; i++) { if (fighters[i].ai) continue; if (pressed[i] && !guardPrev[i]) doPushOff(fighters[i]); guardPrev[i] = pressed[i]; }
}

function step(dt) {
  if (v2s.matchOver) return; // freeze gameplay while the incident report is up
  game.time += dt; inc.matchT += dt;
  game.screenShake = Math.max(0, game.screenShake - dt * 28);
  if (game.shakeSmallCd > 0) game.shakeSmallCd -= dt;
  if (game.kickX || game.kickY) { const kd = Math.pow(0.00005, dt); game.kickX *= kd; game.kickY *= kd; if (Math.abs(game.kickX) + Math.abs(game.kickY) < 0.1) { game.kickX = 0; game.kickY = 0; } } // 鏡頭踹:~80ms 彈回
  if (v2s.winBannerT > 0) v2s.winBannerT -= dt;
  if (v2s.localFlash > 0) v2s.localFlash -= dt;
  if (v2s.fallReasonT > 0) v2s.fallReasonT -= dt;
  updateParticles(dt); updateRings(dt); updateFloatingTexts(dt);
  if (game.hitstop > 0) { game.hitstop -= dt; pollGuard(); } // 定格中也收格擋輸入:玩家的反應常落在凍結幀裡,不能吃掉
  else {
    pollAction(); pollItem(); pollGuard();
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
      if (f.ai && f._aiPushAt && game.time >= f._aiPushAt) { f._aiPushAt = 0; doPushOff(f); } // AI 的格擋反應
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
      if (o.ai) o.escape += CARRY_MASH_AI * dt;                                // AI 固定填速
      else {                                                                    // 人類: 左右交替點按(按指示)
        const aDown = keys.has('a'), dDown = keys.has('d');
        const aEdge = aDown && !o._aPrev, dEdge = dDown && !o._dPrev;
        if (o.mashSide === 0 && aEdge) { o.escape += CARRY_MASH_TAP; o.mashSide = 1; }
        else if (o.mashSide === 1 && dEdge) { o.escape += CARRY_MASH_TAP; o.mashSide = 0; }
        o._aPrev = aDown; o._dPrev = dDown;
      }
      if (o.escape >= CARRY_ESCAPE_NEED) breakFree(o);
    }
    // 失控入艙: 被擊退/打滑(速度夠快)或暈眩者進到艙半徑 → 收容(對手勝)。無敵中免疫。
    for (const f of fighters) {
      if (f.state !== 'alive' || f.carriedBy || f.carrying || f.invuln > 0) continue;
      if ((f.stunned || Math.hypot(f.vx, f.vy) > v2s.slideContainCur) && inPod(f.x, f.y)) {
        const cause = iceAt(f.x, f.y) ? 'ice' : (f.lastHitBy === -3 ? 'barrel' : 'wind');
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
  setGroundMarkers(marks);
  if (game.camTarget === camRig) updateCamRig(dt); // flat mode: smoothed, bounded camera follow
}

function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
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
  punch, startCarry, stunFighter, pads, iceZones, useItem, castWind, castTeleport, castIce, inc, generateReport,
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
    itemBackfires: inc.itemBackfires, barrelBooms: inc.barrelBooms, itemUses: inc.itemUses }) };
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
window.addEventListener('keydown', (e) => {
  unlockAudio();
  const k = e.key.toLowerCase();
  keys.add(k);
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '/'].includes(k)) e.preventDefault();
  if (k === 'b') toggleAI(); // 切換 AI / 練習模式
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
  mouseScreen.x = (e.clientX - rect.left) / rect.width * W;
  mouseScreen.y = (e.clientY - rect.top) / rect.height * H;
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
  // 視覺:暗藍紫地板 + 低亮度紫格線 + 牆底暗角;角色/箱子腳下陰影;魔法特效高亮
  setFloorParams({ floorA: '#2a2c4e', floorB: '#22243f', floorEdge: '#6a5bb0', gridAlpha: 0.16, motes: false, ao: true });
  setRichFloor(true);   // detailed stone/metal slab material (noise/scratches/grout bevel/edge lip, baked once)
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

// opt-in live tuning panel (角色大小 / 格線 / 地板顏色·搶眼度 / 攝影機): open v2.html?tune=1
if (new URLSearchParams(location.search).has('tune')) import('./v2-tuning.js').catch(e => console.warn('[v2] tuning panel failed', e));
