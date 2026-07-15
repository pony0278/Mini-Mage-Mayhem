// v2 戰鬥動詞與移動 (spec F §2;docs/v2-module-boundaries.md §3):
// 移動(冰面/實心碰撞/擊退滑行)、打擊回饋管線(flinch/camKick)、三連擊、格擋推開、
// 抓-搬-掙脫-投擲、收容裁定(三階段軟重整→最終封存)、測試 AI。
// 不 import render/hud —— 模擬保持 headless 可跑。
import { W, H } from './constants.js';
import { clamp, norm } from './utils.js';
import { game, keys, mouse, CAM, touchInput } from './state.js';
import { circleHitsSolid, addShake, addHitstop, addRing, hitSpark, addText } from './fx.js';
import {
  v2s, fighters, LOCAL, dlog, COLORS, NAMES, inc, roundWins, containLog, WIN_TARGET,
  SPEED, RUN_MULT, POD, inPod, resetFighter, applyStage, barrels, bottles, labSwitches,
  STAB_MAX, PUNCH_RANGE, PUNCH_CONE, COMBO_STAB, COMBO_CD, COMBO_WINDOW, STRIKE_DELAY, PUNCH_LAUNCH_LOB,
  PUSH_WIN, PUSH_CDT, PUSH_RANGE, PUSH_FORCE, PUSH_STAGGER, AI_PUSH_CHANCE, AI_PUNCH_CHANCE, AI_GRAB_DELAY, AI_BACKOFF_T,
  STUN_T, GRAB_RANGE, CARRY_SLOW, REGRAB_CD, FUMBLE_T, ESCAPE_STAB, BODY_SEP,
  PERSON_LOB, WALL_BOUNCE, PERSON_HOLD_T, PERSON_THROW_DELAY, AI_THROW_DIST, AI_THROW_PANIC, AI_THROW_DELAY,
  SLIDE_MIN, SLIDE_KNOCK_V, ICE_WALK, STAGE_NAME, STAGE_BANNER, PERFORM_T, PERFORM_DOME_R, WASTE_CLASS, INTRO_GO,
  JUMP_LOB, AIR_CTRL, JUMP_CD, AIR_HIT_LOB, DIVE_T, DIVE_R, DIVE_STAB, DIVE_FWD, DIVE_LAG, DIVE_CD, AI_JUMP_CHANCE, AI_JUMP_CD,
  GUARD_MOVE, GUARD_STAM_MAX, GUARD_DRAIN, GUARD_BLOCK_COST, GUARD_REGEN, GUARD_REGEN_DELAY,
  GUARD_BLOCK_PUSH, GUARD_BLOCK_FLINCH, GUARD_BREAK_FUMBLE, GUARD_BREAK_LOCK,
  FIRE_STAB_DPS, FIRE_BURN_DPS, POISON_STAB_DPS, POISON_BURST_R, POISON_BURST_STAB, POISON_BURST_FORCE,
} from './v2-state.js';
import { FREEFORM, KNOCK_FRICTION, KNOCK_CUTOFF, bridgeAssist, aiSafeDir } from './v2-terrain.js';
import { generateReport } from './v2-report.js';
import { stateAtPixel, floorEvents, FL } from './v2-floor.js';

// camera-relative basis (mirrors main.js buildInput) so screen-up = forward at any azimuth
export function camRel(sx, sy) {
  const maz = (CAM.azimuth || 0) * Math.PI / 180;
  const fX = -Math.sin(maz), fY = -Math.cos(maz);
  const rX = Math.cos(maz), rY = -Math.sin(maz);
  return norm(rX * sx + fX * (-sy), rY * sx + fY * (-sy));
}
export function readMove(pid) {
  let sx = 0, sy = 0;
  if (pid === LOCAL && touchInput.enabled && touchInput.active) return camRel(touchInput.x, touchInput.y); // 手機:類比搖桿(camera-relative)
  if (pid === 0) {
    if (keys.has('w')) sy -= 1; if (keys.has('s')) sy += 1;
    if (keys.has('a')) sx -= 1; if (keys.has('d')) sx += 1;
  } else {
    if (keys.has('arrowup')) sy -= 1; if (keys.has('arrowdown')) sy += 1;
    if (keys.has('arrowleft')) sx -= 1; if (keys.has('arrowright')) sx += 1;
  }
  return camRel(sx, sy);
}

export function slideKnock(f, dt) { // apply lingering knockback velocity only (no self-control)
  // 被拋飛空中段(B 案彈道):直線飛(無摩擦)、飛越對手(跳過身體阻擋);
  // 空中撞牆=小反彈(法向速度反轉 ×WALL_BOUNCE)+ z 快落 0.1s——彈一下掉地,不硬停懸空、不貼牆滑行。
  const lob = f._lob || PERSON_LOB;                                       // 這次拋飛的彈道 profile(丟人/終結技打飛共用管線)
  const air = f._thrownT > -5 && game.time - f._thrownT < lob.T;          // 哨兵 > -5:快落夾出的小負時戳仍有效(-9=未被丟)
  const sx = f.vx * dt, sy = f.vy * dt;
  let wall = false;
  if (!circleHitsSolid(f.x + sx, f.y, f.r) && (air || !hitsFighter(f, f.x + sx, f.y))) f.x += sx;
  else { if (circleHitsSolid(f.x + sx, f.y, f.r)) { wall = true; f.vx = air ? -f.vx * WALL_BOUNCE : 0; } else f.vx = 0; }
  if (!circleHitsSolid(f.x, f.y + sy, f.r) && (air || !hitsFighter(f, f.x, f.y + sy))) f.y += sy;
  else { if (circleHitsSolid(f.x, f.y + sy, f.r)) { wall = true; f.vy = air ? -f.vy * WALL_BOUNCE : 0; } else f.vy = 0; }
  if (air && wall) f._thrownT = game.time - lob.T + 0.1;           // 反彈後快落;落地再吃 LAND_SKID+摩擦 → 很快停
  f.x = clamp(f.x, f.r, W - f.r); f.y = clamp(f.y, f.r, H - f.r);
  if (air) return;                                                 // 空中:等速直線;落地幀(v2.js 偵測)×LAND_SKID 短滑
  const k = Math.pow(KNOCK_FRICTION, dt); f.vx *= k; f.vy *= k;
  if (KNOCK_CUTOFF && f.vx * f.vx + f.vy * f.vy < KNOCK_CUTOFF * KNOCK_CUTOFF) { f.vx = 0; f.vy = 0; }
}
// --- 角色實心化:角色不能互相重疊,但也「不能推」——走進對方會被擋下(對方原地不動)。
// 只擋「會讓兩人更靠近」的移動:已重疊時(換位傳送/出生點被蹲)永遠允許往外走,不會卡死。
// 搬運對豁免(被扛者本來就貼在搬運者身前)。BODY_SEP<1 讓視覺上能貼近到體素肩碰肩才停。
export function fighterBlocking(f, nx, ny) { // 擋住 f 往 (nx,ny) 的那名角色(沒有=null);hitsFighter/鎖滑保齡球共用
  for (const o of fighters) {
    if (o === f || o.state !== 'alive' || o.falling) continue;
    if (f.carrying === o || o.carrying === f) continue;
    const rr = (f.r + o.r) * BODY_SEP;
    const dxn = nx - o.x, dyn = ny - o.y, d2n = dxn * dxn + dyn * dyn;
    if (d2n >= rr * rr) continue;
    const dxc = f.x - o.x, dyc = f.y - o.y;
    if (d2n >= dxc * dxc + dyc * dyc) continue; // 正在遠離 → 放行(防重疊卡死)
    return o;
  }
  return null;
}
export function hitsFighter(f, nx, ny) { return !!fighterBlocking(f, nx, ny); }
// --- 地板化學讀取 (docs/v2-floor-state-architecture.md 第二刀):踩冰滑 / 踩電水硬直 / 站火海·毒區削穩定值 ---
// 冰面=地板化學 FL.ICE(舊 iceZones 圓區已退場——冰瓶走 stampElement 後無人寫入,2026-07 清除)。
export function onSlipperyIce(x, y) { return stateAtPixel(x, y) === FL.ICE; }
// 每幀(移動前)呼叫:電水=自電硬直(restunT 節流,避免每幀重暈);火海/毒區=削穩定值 → 歸零擊暈(好抓=收容路徑)。
export function floorHazards(f, dt) {
  if (f.state !== 'alive' || f.carriedBy || f.invuln > 0) return;
  if (f.burnT > 0) {                                                 // 著火(噴火帽直擊殘留,不靠地形):持續削穩定值→歸零擊暈+身上火粒子
    f.burnT -= dt;
    f.stability = Math.max(0, f.stability - FIRE_BURN_DPS * dt); f.stabCd = 0.3;
    if (Math.random() < 0.6) game.particles.push({ x: f.x + (Math.random() * 2 - 1) * 10, y: f.y + (Math.random() * 2 - 1) * 10, vx: (Math.random() * 2 - 1) * 22, vy: -45 - Math.random() * 45, r: 2 + Math.random() * 2.4, life: 0.28 + Math.random() * 0.22, maxLife: 0.5, color: Math.random() < 0.5 ? '#ff7a3a' : '#ffce6a' });
    if (f.stability <= 0 && !f.stunned && f.restunT <= 0) { f.lastHitBy = f.burnBy; stunFighter(f); }
  }
  if (airborne(f)) return; // 空中=腳不沾地:地板化學(電水/火海/毒區)不作用(跳過危險地板=走位技術;著火 DoT 在身上,照燒)
  const st = stateAtPixel(f.x, f.y);
  if (st === FL.CHARGED) {
    if (!f.stunned && f.restunT <= 0) { stunFighter(f); addText(f.x, f.y - 44, '電擊！', '#bfe6ff'); }
    return;
  }
  if (st === FL.FIRE || st === FL.POISON) {
    f.stability = Math.max(0, f.stability - (st === FL.FIRE ? FIRE_STAB_DPS : POISON_STAB_DPS) * dt);
    f.stabCd = 0.3; // 站危險區時暫停穩定值回復
    if (f.stability <= 0 && !f.stunned && f.restunT <= 0) stunFighter(f);
  }
}
// 消化地板一次性事件(毒爆):範圍削穩定值 + 擊退。v2.js 每幀在 stepFloor 之後呼叫。
export function drainFloorEvents() {
  for (const e of floorEvents) {
    if (e.type !== 'poison_burst') continue;
    addRing(e.x, e.y, POISON_BURST_R, '#b06bff', 0.45, 6); addShake(5); addHitstop(0.06);
    addText(e.x, e.y - 30, '毒爆！', '#c98cff'); game.sfx.push('hurt');
    for (const f of fighters) {
      if (f.state !== 'alive' || f.carriedBy || f.invuln > 0) continue;
      const dx = f.x - e.x, dy = f.y - e.y, d = Math.hypot(dx, dy);
      if (d > POISON_BURST_R + f.r) continue;
      const a = Math.atan2(dy, dx) || 0;
      f.vx += Math.cos(a) * POISON_BURST_FORCE; f.vy += Math.sin(a) * POISON_BURST_FORCE;
      f.stability = Math.max(0, f.stability - POISON_BURST_STAB); f.stabCd = 0.8;
      f.lastHitBy = -4; f.lastHitT = game.time; flinch(f, a, 0.28); // -4 = 毒爆(環境;歸因細分留待 cut 3)
      if (f.stability <= 0 && !f.stunned && f.restunT <= 0) stunFighter(f);
    }
  }
  floorEvents.length = 0;
}
export function moveFighter(f, dt) {
  if (f.stunned || f.fumbleT > 0) { slideKnock(f, dt); return; } // 暈眩/踉蹌:不能自走,仍受擊退慣性
  const m = f.ai ? (v2s.introT > INTRO_GO ? { x: 0, y: 0 } : aiMove(f)) : (f.pid === LOCAL ? readMove(f.pid) : { x: 0, y: 0 }); // 開場就位期 AI 靜止,「開始!」(introT<=INTRO_GO)才開工;被動假人不吃方向鍵原地站
  if (f.pid === LOCAL && !f.ai) {
    if (touchInput.enabled) { if (m.x || m.y) f.facing = Math.atan2(m.y, m.x); } // 手機:移動=面向;放開搖桿保留最後方向(可推向魔法陣→放開→按投擲)
    else f.facing = Math.atan2(mouse.y - f.y, mouse.x - f.x);                    // 桌機:面向滑鼠(移動與瞄準解耦)
  } else if (m.x || m.y) f.facing = Math.atan2(m.y, m.x);                        // AI／熱座紅方:面向移動方向
  if (f.guarding) { m.x *= GUARD_MOVE; m.y *= GUARD_MOVE; }                       // 舉防=定身(GUARD_MOVE 0);想拉開就得放防。擊退/被推仍照 f.vx/vy 走
  if (f._diveLagT > 0) { m.x = 0; m.y = 0; }                                      // 下壓落空硬直:短暫定身(v2.js 倒數)
  let sp = SPEED * ((f.carrying || (f.carryObj && f.carryObj.kind !== 'bottle')) ? CARRY_SLOW : 1) * (f.running ? RUN_MULT : 1); // 搬運人/扛桶時變慢;瓶=輕(全速);跑=預設(v2.js 每幀裁定)
  if (f._diveT0 > -5) { m.x = Math.cos(f._diveDir); m.y = Math.sin(f._diveDir); sp = DIVE_FWD / DIVE_T; } // 俯衝:鎖方向自動前撲(承諾,無操控)
  else if (airborne(f)) { m.x *= AIR_CTRL; m.y *= AIR_CTRL; }                     // 空中操控率(起跳動量為主)
  // --- 冰面=鎖滑(玩家反饋 2026-07):帶動量踩上 → 鎖原始方向直線滑行,直到撞牆(暈)/撞人/滑出冰面。
  //     滑行中無操控;速度 ≥ SLIDE_MIN(> 失控收容門檻)→ 滑進艙=收容(cause 'ice')。
  //     靜止站上冰(冰凍醒來/瓶在腳下碎)= 小心走 ICE_WALK,不觸發鎖滑=逃生口。
  if (!airborne(f) && onSlipperyIce(f.x, f.y)) { // 空中=腳不沾地,飛越冰面不觸發鎖滑(跳=冰滑主動解;落地帶移動輸入照樣觸發)
    if (!(f._slideVx || f._slideVy)) { // 未鎖:判定要不要開始滑
      const vv = Math.hypot(f.vx, f.vy);
      const enterMoving = !f._onIce && (m.x || m.y);   // 走著/跑著踩進冰
      const knocked = vv > SLIDE_KNOCK_V;              // 被打上冰/冰上挨打/摔上冰(擊退速度)
      if (enterMoving || knocked) {
        const a = knocked ? Math.atan2(f.vy, f.vx) : Math.atan2(m.y, m.x); // 原始路徑方向
        const s = Math.max(vv, SLIDE_MIN, knocked ? 0 : sp);               // 跑著進場滑得更快
        f._slideVx = Math.cos(a) * s; f._slideVy = Math.sin(a) * s; f._slideT = game.time;
        addText(f.x, f.y - 34, '打滑！', '#bfe6ff'); game.sfx.push('dash');
      }
    }
    f._onIce = true;
    if (f._slideVx || f._slideVy) { // 鎖定中:等速直線,操控無效
      f.vx = f._slideVx; f.vy = f._slideVy;            // 餵給失控入艙判定(速度>門檻)
      f._slideT = game.time;                           // 持續刷新=「最後滑行時刻」(出冰衝進艙的歸因窗)
      const sx = f._slideVx * dt, sy = f._slideVy * dt;
      const nx = clamp(f.x + sx, f.r, W - f.r), ny = clamp(f.y + sy, f.r, H - f.r);
      if (circleHitsSolid(nx, ny, f.r) || nx !== f.x + sx || ny !== f.y + sy) { // 撞牆(含場邊)→ 停+暈
        f._slideVx = 0; f._slideVy = 0; f.vx = 0; f.vy = 0;
        addText(f.x, f.y - 44, '撞牆！', '#bfe6ff'); addShake(5);
        if (!f.stunned && f.restunT <= 0) stunFighter(f);
      } else {
        const victim = fighterBlocking(f, nx, ny);
        if (victim) slideCollide(f, victim);           // 撞到人:保齡球——兩人一起摔出去跌倒
        else { f.x = nx; f.y = ny; }
      }
      return;
    }
    // 冰上無鎖(靜止進場/滑行已停):小心走
    const wx = m.x * sp * ICE_WALK * dt, wy = m.y * sp * ICE_WALK * dt;
    if (!circleHitsSolid(f.x + wx, f.y, f.r) && !hitsFighter(f, f.x + wx, f.y)) f.x += wx;
    if (!circleHitsSolid(f.x, f.y + wy, f.r) && !hitsFighter(f, f.x, f.y + wy)) f.y += wy;
    f.x = clamp(f.x, f.r, W - f.r); f.y = clamp(f.y, f.r, H - f.r);
    const ik = Math.pow(KNOCK_FRICTION, dt); f.vx *= ik; f.vy *= ik; // 殘餘擊退照常衰減
    return;
  }
  if (f._slideVx || f._slideVy) { // 滑出冰面:動量交還一般擊退管線(草地自然減速)
    f.vx = f._slideVx; f.vy = f._slideVy; f._slideVx = 0; f._slideVy = 0;
  }
  f._onIce = false;
  const stepX = (m.x * sp + f.vx) * dt;
  const stepY = (m.y * sp + f.vy) * dt;
  if (!circleHitsSolid(f.x + stepX, f.y, f.r) && !hitsFighter(f, f.x + stepX, f.y)) f.x += stepX; else f.vx = 0;
  if (!circleHitsSolid(f.x, f.y + stepY, f.r) && !hitsFighter(f, f.x, f.y + stepY)) f.y += stepY; else f.vy = 0;
  f.x = clamp(f.x, f.r, W - f.r); f.y = clamp(f.y, f.r, H - f.r);
  if (FREEFORM) bridgeAssist(f);
  const k = Math.pow(KNOCK_FRICTION, dt); f.vx *= k; f.vy *= k;
  if (KNOCK_CUTOFF && f.vx * f.vx + f.vy * f.vy < KNOCK_CUTOFF * KNOCK_CUTOFF) { f.vx = 0; f.vy = 0; } // snap out the ice-slide tail
}

// --- 打擊回饋管線:受擊 flinch(模型甩頭/壓扁) + 方向性鏡頭踹(camera kick) ---
export function flinch(o, a, t = 0.22) { o.flinchA = a; o.flinchT = Math.max(o.flinchT || 0, t); }
export function camKick(a, mag) { game.kickX = Math.cos(a) * mag; game.kickY = Math.sin(a) * mag; } // render 加在鏡頭上,step 裡快速衰減

// --- 基礎動詞 (spec F §2): 揮拳(削穩定值→擊暈) + 情境動作鍵(暈眩對手在近處→抓; 搬運中→放下; 否則→揮拳) ---
export function stunFighter(o) {
  o.stunned = true; o.stunT = STUN_T; o.vx *= 0.4; o.vy *= 0.4;
  o._slideVx = 0; o._slideVy = 0; // 任何擊暈都清鎖滑向量(否則兩滑行者對撞後,殘留向量會在醒來瞬間瞬移續滑)
  addText(o.x, o.y - 30, '暈！', '#ffd36d'); addRing(o.x, o.y, 30, '#ffd36d', 0.3, 4);
  addHitstop(0.12); addShake(6); game.sfx.push('hurt'); // 擊暈=大事件:更長定格+重音,把「打崩了」讀出來
  if (o.pid === LOCAL) v2s.localFlash = 0.3;
}
// 冰上保齡球(玩家反饋 2026-07):鎖滑者撞上另一名角色 → 兩人一起摔出去跌倒(同「滑行碰撞=跌倒」規則的對稱版)。
// 被撞者順滑行方向飛(0.75×滑速)、滑撞者反彈(0.4×);雙方擊暈(restun 免疫則不重複暈但照樣被撞飛+踉蹌);
// 速度在 stunFighter(×0.4 阻尼)之後才給,否則被吃掉。歸因互記(1v1 同時暈=中性重整,無免費反打)。
export function slideCollide(f, o) {
  const s = Math.hypot(f._slideVx, f._slideVy) || SLIDE_MIN;
  const dx = f._slideVx / s, dy = f._slideVy / s, a = Math.atan2(dy, dx);
  f._slideVx = 0; f._slideVy = 0;
  if (!o.stunned && o.restunT <= 0) stunFighter(o);
  if (!f.stunned && f.restunT <= 0) stunFighter(f);
  o.vx = dx * s * 0.75; o.vy = dy * s * 0.75;   // 被撞飛(stun 後才設,免被 ×0.4 吃掉)
  f.vx = -dx * s * 0.4; f.vy = -dy * s * 0.4;   // 滑撞者反彈
  o.fumbleT = Math.max(o.fumbleT, FUMBLE_T); f.fumbleT = Math.max(f.fumbleT, FUMBLE_T); // 保證跌倒(免疫也踉蹌)
  o.lastHitBy = f.pid; o.lastHitT = game.time; f.lastHitBy = o.pid; f.lastHitT = game.time;
  flinch(o, a); flinch(f, a + Math.PI);
  const mx = (f.x + o.x) / 2, my = (f.y + o.y) / 2;
  addText(mx, my - 42, '保齡球！', '#bfe6ff'); addRing(mx, my, 40, '#bfe6ff', 0.4, 6);
  addShake(7); addHitstop(0.1); game.sfx.push('hurt');
}
// 冰凍=擊暈的冰凍皮(同 STUN_T/restunT 一套規則,玩家學一次):frozen 旗給 render(冰塊+不搖晃),
// stun 醒來時清(v2.js);被扛期間保留(扛冰雕=喜感本體),放下/丟出/掙脫才解凍(dropCarry/launchCarried/breakFree)。
// 已暈/免疫中:不重複暈(restun 鐵則),只噴視覺。歸因給投擲者(收容 credit)。
export function freezeFighter(o, byPid) {
  o.lastHitBy = byPid; o.lastHitT = game.time; o.faceT = 0.4;
  if (!o.stunned && o.restunT <= 0) {
    stunFighter(o);
    o.frozen = true;
    addText(o.x, o.y - 46, '冰凍！', '#bfe6ff'); addRing(o.x, o.y, 34, '#bfe6ff', 0.4, 5);
  } else {
    addText(o.x, o.y - 46, '冰晶四濺！', '#bfe6ff');
  }
}
// --- 跳躍+下壓拳(brawl-2:走位技術;空白=跳,空中攻擊=下壓)---
export function jumping(f) { return f._jumpT > -5 && game.time - f._jumpT < JUMP_LOB.T + 0.02; }
export function airborne(f) { return jumping(f) || f._diveT0 > -5 || f.z > 1; } // z>1 含被拋飛(對空中規則一視同仁)
export function jump(f) { // 自發小 lob(z 在 v2.js 每幀由 lobZ(t,JUMP_LOB) 算);冰面鎖滑的主動解
  if (f.state !== 'alive' || f.stunned || f.carriedBy || f.fumbleT > 0 || f.guarding || f._performing) return;
  if (f.carrying || (f.carryObj && f.carryObj.kind !== 'bottle')) return; // 扛人/扛桶跳不動(重量感);瓶=輕
  if (airborne(f) || f.jumpCd > 0) return;
  if (f._slideVx || f._slideVy) { // 鎖滑中起跳=解鎖:動量帶上天(落地乾淨,不續滑)
    f.vx = f._slideVx; f.vy = f._slideVy; f._slideVx = 0; f._slideVy = 0;
    addText(f.x, f.y - 40, '跳出冰面！', '#bfe6ff');
  }
  f._jumpT = game.time; f.jumpCd = JUMP_LOB.T + JUMP_CD;
  game.sfx.push('dash'); addRing(f.x, f.y, 20, '#cfe8ff', 0.25, 3);
  inc.types.add('jump');
}
export function dive(f) { // 空中+攻擊:鎖方向俯衝,DIVE_T 後落地幀 AoE 判定(kind 3);穿防;落空硬直
  if (f._diveT0 > -5 || f._strikeAt || f.punchCd > 0 || f.stunned || f.carriedBy || f.fumbleT > 0) return;
  f._diveT0 = game.time; f._diveZ0 = Math.max(f.z, 8); f._diveDir = f.facing;
  f._jumpT = -9;                                       // 跳躍彈道讓位給俯衝(z 改由 dive 線性壓地)
  f.punchCd = DIVE_CD;
  f.punchFx = game.time; f.punchKind = 3; f.punchArm = 1; // 動畫:dive_punch 槽(缺槽 actor-brawler 暫用 overhand)
  f._strikeAt = game.time + DIVE_T; f._strikeKind = 3; f._strikeDir = f.facing;
  game.sfx.push('dash');
}
function resolveDive(f) { // 下壓落地幀:落點圓形 AoE;命中=大削穩定+穿防+擊退;落空=硬直
  f._strikeAt = 0; f._diveT0 = -9;
  if (f.stunned || f.carriedBy || f.fumbleT > 0 || f.state !== 'alive') return; // 半途被拍落=這撲不存在
  addRing(f.x, f.y, DIVE_R, '#ffd36d', 0.32, 5);
  let hit = false;
  for (const o of fighters) {
    if (o === f || o.state !== 'alive' || o.carriedBy || o.invuln > 0 || o._performing) continue;
    if (Math.hypot(o.x - f.x, o.y - f.y) > DIVE_R + o.r) continue;
    hit = true;
    const a = Math.atan2(o.y - f.y, o.x - f.x) || f._strikeDir;
    if (o.guarding) { o.guarding = false; addText(o.x, o.y - 34, '穿防重擊！', '#ffb14a'); } // 重擊穿防(剋龜)
    o.stability = Math.max(0, o.stability - DIVE_STAB); o.stabCd = 1.2;
    o.lastHitBy = f.pid; o.lastHitT = game.time;
    o.vx += Math.cos(a) * 260; o.vy += Math.sin(a) * 260;
    flinch(o, a, 0.3); hitSpark(o.x, o.y, '#ffe0a3', 2.2);
    if (o.pid === LOCAL) v2s.localFlash = 0.3;
    if (o.stability <= 0 && !o.stunned && o.restunT <= 0) stunFighter(o); // 暈/踉蹌後的掉桶瓶由 v2.js 扛桶 loop 條件處理
  }
  if (hit) { addShake(7); addHitstop(0.1); camKick(f._strikeDir, 9); game.sfx.push('smash'); inc.types.add('dive'); }
  else { f._diveLagT = DIVE_LAG; addShake(3); game.sfx.push('thud'); addText(f.x, f.y - 30, '撲空！', '#9aa5b8'); }
}
// 出拳=起手:播動作、鎖定方向,STRIKE_DELAY 秒後的 impact 影格才判定命中(resolveStrike)。
// 起手中被打暈/被抓/被推開踉蹌 → resolveStrike 的守衛直接取消 = 格擋推開是能打斷出拳的真反制。
export function punch(f) {
  if (airborne(f) && f.state === 'alive' && !f.stunned && !f.carriedBy && !f.carrying && !f.carryObj) { dive(f); return; } // 空中攻擊=下壓拳
  if (f.punchCd > 0 || f.stunned || f.carrying || f.carryObj || f.carriedBy || f.fumbleT > 0 || f.guarding || f.state !== 'alive') return; // 舉防中不能出拳(防禦=承諾架式,要攻擊先放防)
  if (f.comboT <= 0) f.comboN = 0;                        // 超窗 → 從第一段重來
  const stage = f.comboN;                                 // 0 左鉤 / 1 右鉤 / 2 浮誇直拳(終結技)
  f.punchCd = COMBO_CD[stage];
  f.punchFx = game.time; f.punchKind = stage; f.punchArm = stage === 0 ? 0 : 1;
  f._strikeAt = game.time + STRIKE_DELAY[stage]; f._strikeKind = stage; f._strikeDir = f.facing; // 方向在按下瞬間鎖定(出拳有承諾)
  // 點擊就接段(空揮也演完整套);超過接段窗口才重置
  f.comboN = (stage + 1) % 3; f.comboT = COMBO_WINDOW;
  // 精準格擋黃金窗口:這拳預測會命中對手(距離+角度,留些微餘裕)且對手格擋可用(不在冷卻)
  // → 對手獲得「起手期」長度的反擊窗口(本機玩家另在 frame() 吃緩速+灰屏)
  const o = fighters[1 - f.pid];
  if (o.state === 'alive' && !o.stunned && !o.carriedBy && !o.carrying && o.invuln <= 0 && o.fumbleT <= 0 && o.pushCd <= 0) {
    const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy);
    let da = Math.atan2(dy, dx) - f.facing; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (d <= PUNCH_RANGE + o.r + 14 && Math.abs(da) <= PUNCH_CONE * 1.2) {
      o.parryWinT = o.parryWin0 = STRIKE_DELAY[stage]; o.parryFrom = f;
    }
  }
}
// 格擋鍵「按下瞬間」的分派(edge):黃金窗口內=精準格擋(反暈) → 挨打後短窗=普通推開。
// 都不是=不做事(按住本身=防禦架式,由 v2.js pollGuard 設 f.guarding、updateGuard 管耐力)。
// 空按不再進冷卻——「隨時可舉防」,防呆改由耐力條(GUARD_STAM)承擔。
export function doGuard(f) {
  if (f.state !== 'alive' || f.stunned || f.carriedBy || f.fumbleT > 0 || airborne(f)) return; // 空中沒有格擋/推開(空中規則)
  if (f.parryWinT > 0) { doPerfectParry(f); return; }
  if (f.pushWinT > 0 && f.pushCd <= 0) { doPushOff(f); return; }
}
// 能否舉防(按住防禦架式):活著、非暈/被扛/踉蹌、不在破防鎖定、不在鎖滑中、不在空中、耐力>0。
export function canGuard(f) {
  return f.state === 'alive' && !f.stunned && !f.carriedBy && !f.carrying && !f.carryObj
    && f.fumbleT <= 0 && f.guardLock <= 0 && f.guardStam > 0 && !(f._slideVx || f._slideVy) && !airborne(f);
}
// 每幀:耐力衰退/回充。舉防中純守衰退;放開後延遲才回充。v2.js step 於 pollGuard 設好 f.guarding 後呼叫。
export function updateGuard(f, dt) {
  if (f.guardLock > 0) f.guardLock = Math.max(0, f.guardLock - dt);
  if (f.guarding && !canGuard(f)) f.guarding = false;  // 狀態中途改變(被暈/被抓/踉蹌)→ 立刻卸防
  if (f.guarding) {
    f.guardStam = Math.max(0, f.guardStam - GUARD_DRAIN * dt);
    f.guardRegenT = GUARD_REGEN_DELAY;
    if (f.guardStam <= 0) guardBreak(f);       // 純守耗盡也破防(逼你別無腦龜)
  } else {
    if (f.guardRegenT > 0) f.guardRegenT = Math.max(0, f.guardRegenT - dt);
    else if (f.guardStam < GUARD_STAM_MAX) f.guardStam = Math.min(GUARD_STAM_MAX, f.guardStam + GUARD_REGEN * dt);
  }
}
// 破防:被逼出架式、踉蹌、短時間不能再舉防(攻擊方的免費機會)。
export function guardBreak(f) {
  f.guarding = false; f.guardStam = 0; f.guardLock = GUARD_BREAK_LOCK;
  f.fumbleT = Math.max(f.fumbleT, GUARD_BREAK_FUMBLE); f.guardRegenT = GUARD_REGEN_DELAY;
  addText(f.x, f.y - 40, '破防！', '#ff9a6b'); addRing(f.x, f.y, 34, '#ff9a6b', 0.4, 5);
  addShake(6); addHitstop(0.1); game.sfx.push('hurt');
  if (f.pid === LOCAL) v2s.localFlash = 0.28;
}
export function doPerfectParry(d) { // 黃金窗口內按下:取消對方那拳+反暈(進入抓取回合的入場券;爽鬥回歸)
  const a = d.parryFrom;
  d.parryWinT = 0; d.parryFrom = null; d.pushCd = PUSH_CDT;
  if (!a || a.state !== 'alive' || a.carriedBy) return;
  a._strikeAt = 0;                             // 那拳被你讀掉了,不存在
  a.comboN = 0; a.comboT = 0;
  d.facing = Math.atan2(a.y - d.y, a.x - d.x);
  stunFighter(a);                              // 反暈!
  inc.parries++; inc.types.add('parry');
  const ca = Math.atan2(a.y - d.y, a.x - d.x), cpx = (d.x + a.x) / 2, cpy = (d.y + a.y) / 2;
  hitSpark(cpx, cpy, '#fff6c9', 2.4); addRing(cpx, cpy, 42, '#ffe97a', 0.42, 6);
  addText(d.x, d.y - 40, '完美格擋！', '#ffe97a');
  addHitstop(0.2); addShake(8); camKick(ca, 8); game.sfx.push('smash');
  dlog('PARRY', NAMES[d.pid], '→', NAMES[a.pid]);
}
export function resolveStrike(f) { // impact 影格:執行命中掃描+全部打擊回饋
  const stage = f._strikeKind, fin = stage === 2;
  if (stage === 3) { resolveDive(f); return; } // 下壓拳:落地幀 AoE(自帶取消守衛)
  f._strikeAt = 0;
  if (f.stunned || f.carrying || f.carriedBy || f.fumbleT > 0 || f.state !== 'alive') return; // 被打斷:這拳不存在
  const a = f._strikeDir; let hit = false;
  // 出拳衝步只留終結技(玩家反饋:每拳都滑一步不自然)。鉤拳原地,進拳靠走位。
  if (fin) { f.vx += Math.cos(a) * 150; f.vy += Math.sin(a) * 150; }
  for (const o of fighters) {
    if (o === f || o.state !== 'alive' || o.carriedBy || o.invuln > 0) continue;
    const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy);
    if (d > PUNCH_RANGE + o.r) continue;
    let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > PUNCH_CONE) continue;
    hit = true;
    // 按住防禦架式:擋普通鉤拳(前兩段);終結技=浮誇直拳穿防(元素亦穿,見各 cast)。
    if (o.guarding && !fin) {
      o.guardStam -= GUARD_BLOCK_COST;                                   // 每擋一拳扣耐力
      o.lastHitBy = f.pid; o.lastHitT = game.time; o.faceT = 0.2;
      const bpx = o.x - Math.cos(a) * o.r * 0.7, bpy = o.y - Math.sin(a) * o.r * 0.7;
      hitSpark(bpx, bpy, '#bfe0ff', 1.4); addRing(bpx, bpy, 22, '#8fd0ff', 0.22, 4);
      o.vx += Math.cos(a) * GUARD_BLOCK_PUSH; o.vy += Math.sin(a) * GUARD_BLOCK_PUSH; // 防守方輕微後仰+被推一小步
      flinch(o, a, GUARD_BLOCK_FLINCH);
      addText(o.x, o.y - 34, '擋下！', '#9ecbff'); addShake(2); addHitstop(0.05); game.sfx.push('thud');
      if (o.guardStam <= 0) guardBreak(o);                              // 這一擋耗盡=破防(攻擊方免費機會)
      continue;                                                         // 擋掉:無穩定值傷害、不開推開窗、不打飛
    }
    o.faceT = 0.2; o.hurt = 0.12; o.lastHitBy = f.pid; o.lastHitT = game.time;
    o.stability = Math.max(0, o.stability - COMBO_STAB[stage]); o.stabCd = 0.8;
    flinch(o, a, fin ? 0.32 : 0.22);
    const cpx = o.x - Math.cos(a) * o.r * 0.7, cpy = o.y - Math.sin(a) * o.r * 0.7; // 火花開在拳頭接觸點
    hitSpark(cpx, cpy, '#ffe0a3', fin ? 2.2 : 1.5); addRing(cpx, cpy, fin ? 34 : 20, '#ffd36d', fin ? 0.32 : 0.22, fin ? 5 : 3);
    if (fin) { addText(o.x, o.y - 34, o.guarding ? '穿防重擊！' : '重擊！', '#ffb14a'); o.guarding = false; } // 終結技穿防:破掉架式
    // 格擋窗口:被打中(還能動)→ 短窗內按格擋鍵可推開攻擊方;AI 有機率排程一次推開
    if (!o.stunned && !o.carriedBy) {
      o.pushWinT = PUSH_WIN; o.pushFrom = f;
      if (o.ai && o.pushCd <= 0 && !o._aiPushAt && Math.random() < AI_PUSH_CHANCE) o._aiPushAt = game.time + 0.15 + Math.random() * 0.3;
    }
    if (o.stability <= 0 && !o.stunned && o.restunT <= 0) stunFighter(o); // 穩定值歸零 → 擊暈(爽鬥回歸:打夠就暈,無能量閘)
    // 鉤拳不位移(受擊=純踉蹌);終結技=打飛:小拋物線(擊中→打飛→落地),與丟人同管線、lob 較小。
    // 放在擊暈判定之後:stunFighter 會把速度×0.4,打崩+打飛要同時成立(落地時還暈著)。
    if (fin) {
      const F = PUNCH_LAUNCH_LOB.range / PUNCH_LAUNCH_LOB.T;            // 出手當下現算(?tune=1/控制台改 LOB 即時生效)
      o.vx = Math.cos(a) * F; o.vy = Math.sin(a) * F;
      o._thrownT = game.time; o._lob = PUNCH_LAUNCH_LOB; o.fumbleT = PUNCH_LAUNCH_LOB.T + 0.1;
      o._jumpT = -9; o._diveT0 = -9;                                    // 空中被終結=照樣挑飛(彈道覆蓋跳躍)
      if (o.carrying) dropCarry(o);                                     // 飛行中不可能繼續扛人(扛桶由 v2.js 扛桶 loop 的 fumbleT 條件掉)
    } else if (jumping(o) || o._diveT0 > -5) {                          // 空中挨鉤拳=拍蚊子:小翻滾落地(brawl-2 空中規則)
      o._jumpT = -9; o._diveT0 = -9;
      const F2 = AIR_HIT_LOB.range / AIR_HIT_LOB.T;
      o.vx = Math.cos(a) * F2; o.vy = Math.sin(a) * F2;
      o._thrownT = game.time; o._lob = AIR_HIT_LOB; o.fumbleT = AIR_HIT_LOB.T + 0.1;
      addText(o.x, o.y - 40, '拍落！', '#ffd36d');
    }
    if (o.pid === LOCAL) v2s.localFlash = 0.2;
  }
  for (const b of barrels) { // 揍到廢料桶 → 升壓(不需命中對手;charge 已由 idle 吸收,telegraph 在地面標記)
    if (!b.alive || b.state !== 'idle') continue;
    const dx = b.x - f.x, dy = b.y - f.y, d = Math.hypot(dx, dy);
    if (d > PUNCH_RANGE + b.r) continue;
    let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) <= PUNCH_CONE) { b.state = 'fuse'; b.fuse = v2s.barrelFuseCur; addText(b.x, b.y - 26, '升壓！', '#ffd36d'); hit = true; }
  }
  for (const t of bottles) { // 揍到場上瓶 → 立 _smash 旗,下一 tick updateBottles 碎裂蓋地板(DAG:combat 不能 import v2-items 的 shatterBottle)
    if (!t.alive || t.held || t._smash || t.z > 0) continue;
    const dx = t.x - f.x, dy = t.y - f.y, d = Math.hypot(dx, dy);
    if (d > PUNCH_RANGE + t.r) continue;
    let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) <= PUNCH_CONE) { t._smash = true; hitSpark(t.x, t.y, '#eaffff', 1.1); hit = true; }
  }
  if (!v2s.stationsArmed) for (const sw of labSwitches) { // 揍左右任一緊急拉桿 → arm 四站洩漏循環(單向不可關;§10.1)
    const dx = sw.x - f.x, dy = sw.y - f.y, d = Math.hypot(dx, dy);
    let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (d <= PUNCH_RANGE + sw.r && Math.abs(da) <= PUNCH_CONE) {
      v2s.stationsArmed = true; hit = true;
      addText(sw.x, sw.y - 34, '總閘拉下！四角元素站洩漏', '#ff9a4a');
      addRing(sw.x, sw.y, 64, '#ff9a4a', 0.6, 7); addShake(9); addHitstop(0.12); game.sfx.push('explosion');
      // 因果演出改由 render-lab 站光環承擔(玩家反饋:電束不自然 → 場邊四座大型處理站被魔法光環觸發=通電甦醒;
      // v2.js step 幀尾偵測 stationsArmed 變化 → setStationsPowered)。這裡只留拉桿本體回饋。
      dlog('SWITCH ARMED → stations live');
      break;
    }
  }
  // 命中回饋分級:終結技最重(定格/鏡頭踹/重音)
  if (hit) {
    if (fin) { addShake(7); addHitstop(0.12); camKick(a, 10); game.sfx.push('smash'); }
    else { addShake(4); addHitstop(0.08); camKick(a, 7); game.sfx.push('thud'); }
  } else { addShake(fin ? 2.5 : 1.5); game.sfx.push('whiff'); }
}
// 格擋推開:被打中的短窗內按鍵 → 把攻擊方推開一步+踉蹌,combo 斷掉(防守方自己不動)
export function doPushOff(o) {
  if (o.state !== 'alive' || o.stunned || o.carriedBy || o.fumbleT > 0) return;
  if (o.pushWinT <= 0 || o.pushCd > 0) return;
  const f = o.pushFrom;
  if (!f || f.state !== 'alive' || f.carriedBy || f.stunned) return;
  if (Math.hypot(f.x - o.x, f.y - o.y) > PUSH_RANGE + f.r) return;
  const a = Math.atan2(f.y - o.y, f.x - o.x);
  o.pushCd = PUSH_CDT; o.pushWinT = 0; o._aiPushAt = 0;
  f.vx += Math.cos(a) * PUSH_FORCE; f.vy += Math.sin(a) * PUSH_FORCE; // 攻擊方被推開(指定動作位移)
  f.fumbleT = PUSH_STAGGER; f.comboN = 0; f.comboT = 0;               // 踉蹌+斷 combo
  flinch(f, a, 0.28); camKick(a, 5); inc.pushOffs++;
  addText(o.x, o.y - 34, '推開！', '#9affd0'); addRing(o.x, o.y, 30, '#9affd0', 0.3, 4);
  addShake(4); addHitstop(0.06); game.sfx.push('dash');
  dlog('PUSHOFF', NAMES[o.pid], '→', NAMES[f.pid]);
}
export function startCarry(f, o) {
  if (airborne(f) || airborne(o)) return; // 空中不可抓/被抓(brawl-2 空中規則;呼叫端條件同幀可能過期,這裡守底)
  f.carrying = o; o.carriedBy = f; o.escape = 0; o.stunned = false; o.stunT = 0; o.mashSide = 0; o._aPrev = false; o._dPrev = false;
  f._carryThrowAt = 0; f.carryClip = 'person_throw'; f.carryFx = game.time; f.carryHold = PERSON_HOLD_T; // 抓起就播 0→hold(reach→抓→舉→翻橫)然後定格在 hold 幀扛著走
  addText(o.x, o.y - 30, '抓住！', COLORS[f.pid]); addRing(o.x, o.y, 34, COLORS[f.pid], 0.35, 4); addShake(4); game.sfx.push('upgrade');
  dlog('GRAB', NAMES[f.pid], '→', NAMES[o.pid]);
}
export function dropCarry(f) { const o = f.carrying; if (o) { o.carriedBy = null; o.frozen = false; o.stability = Math.max(o.stability, 30); } f.carrying = null; f._carryThrowAt = 0; f.carryClip = null; f.carryHold = 0; f.regrabCd = REGRAB_CD; }
// 丟人=排程動作:按下 → 解除 hold 定格、clip 從 hold 幀續播(舉→後仰→前甩)→ release 幀才 launchCarried 甩飛。
export function throwCarried(f) {
  const o = f.carrying;
  if (!o || f.state !== 'alive' || f.stunned || f._carryThrowAt > 0) return;   // 已在 heave 中 → 不重複
  f.carryHold = 0; f.carryFx = game.time - PERSON_HOLD_T;     // 解除定格,把時鐘對到 hold 幀 → clip 續播 16→22→38
  f._carryThrowAt = game.time + PERSON_THROW_DELAY;           // release 幀甩飛(v2.js step 判定)
  game.sfx.push('dash'); addText(f.x, f.y - 34, '甩！', COLORS[f.pid]);
}
// release 幀到:真的把人甩出去(舊 throwCarried 的物理段)。中途被打斷/掙脫 → carrying 沒了 → 取消。
export function launchCarried(f) {
  f._carryThrowAt = 0;                                         // carryClip 不清:讓 heave clip 播完收招(release 後仍是同一段動畫)
  const o = f.carrying;
  if (!o || f.state !== 'alive') return;
  if (f.stunned) { dropCarry(f); f.carryClip = null; return; } // release 幀被打暈 → 掉人不甩(同原 throwCarried 守衛)
  f.carrying = null; o.carriedBy = null; o.frozen = false; o.escape = 0; o.mashSide = 0; f.regrabCd = REGRAB_CD; // 出手即解凍(冰凍只活在暈/被扛期間)
  const a = f.facing;
  o.x = f.x + Math.cos(a) * (f.r + o.r * 0.7); o.y = f.y + Math.sin(a) * (f.r + o.r * 0.7);
  const F = PERSON_LOB.range / PERSON_LOB.T;                    // 出手當下現算(?tune=1/控制台改 LOB 即時生效)
  o.vx = Math.cos(a) * F; o.vy = Math.sin(a) * F;
  o.fumbleT = PERSON_LOB.T + 0.1; o._thrownT = game.time; o._lob = PERSON_LOB; // 翻滾:moveFighter 只走 slideKnock(_lob 蓋掉先前打飛殘值)
  o.lastHitBy = f.pid; o.lastHitT = game.time; o.faceT = 0.3;
  o.stability = Math.max(o.stability, 30);                     // 同放下:落地不至於原地再被打暈
  f.punchCd = 0.5;                                             // 投擲後恢復:丟完不能立刻接拳(動畫由 carryClip 收招)
  inc.throws[f.pid]++;
  flinch(o, a, 0.3); camKick(a, 7); addShake(5); game.sfx.push('dash');
  addText(o.x, o.y - 32, '拋出！', COLORS[f.pid]); addRing(f.x, f.y, 30, COLORS[f.pid], 0.3, 4);
  dlog('THROW', NAMES[f.pid], '→', NAMES[o.pid]);
}
export function inThrowFlight(f) { return f.fumbleT > 0 && game.time - (f._thrownT ?? -9) < (f._lob || PERSON_LOB).T + 0.15; } // 翻滾中(入艙判定用;T+0.15=舊 THROW_TUMBLE+0.05)
export function breakFree(o) { // 掙脫成功: 搬運者踉蹌 → 反轉窗口
  const f = o.carriedBy; o.carriedBy = null; o.frozen = false; o.escape = 0; o.stability = ESCAPE_STAB; inc.struggleEscapes++;
  if (f) { f.carrying = null; f._carryThrowAt = 0; f.carryClip = null; f.carryHold = 0; f.fumbleT = FUMBLE_T; f.regrabCd = REGRAB_CD; f.wasCarryingT = game.time; if (f.pid === LOCAL) v2s.localFlash = 0.28; }
  addText(o.x, o.y - 30, '掙脫！', COLORS[o.pid]); addRing(o.x, o.y, 32, COLORS[o.pid], 0.35, 4); addShake(5); game.sfx.push('dash');
  dlog('ESCAPE', NAMES[o.pid], 'from', f ? NAMES[f.pid] : '?');
}
export function isReversal(v) { return game.time - (v.wasCarryingT || -9) < 2.5; } // 被關者剛剛還在搬人 → 反向收容
export function containByCarry(f, o) { // 拖進艙 = 收容成功 (spec F §2.2 失控入艙;爽鬥回歸=直接得分)
  if (v2s.perform) return;                                // 演出中不疊加收容
  const w = f.pid, rev = isReversal(o);
  inc.contains[w]++; inc.carries[w]++; inc.types.add('contain');
  if (rev) { inc.reverseContains++; inc.types.add('reverse'); }
  f.carrying = null; f._carryThrowAt = 0; f.carryClip = null; f.carryHold = 0; o.carriedBy = null;
  resolveContain(w, o, rev ? 'reverse' : 'carry');
}
export function containByEnviron(v, cause) { // 被擊退/打滑失控進艙 → v 被收容, 對手勝(spec F §2.2)
  if (v2s.perform) return;                                // 演出中不疊加收容
  const w = 1 - v.pid, rev = isReversal(v);
  inc.contains[w]++; inc.types.add('contain');
  if (cause === 'throw') { inc.throwContains++; inc.types.add('throw'); } // 拋進艙=蓄意的指定攻擊,不算意外
  else {
    inc.accidentContains[cause] = (inc.accidentContains[cause] || 0) + 1; inc.types.add(cause);
    if (cause === 'ice') inc.itemBackfires++;               // 踩(自己的)冰面滑進艙 = 自作自受
  }
  if (rev) { inc.reverseContains++; inc.types.add('reverse'); }
  if (v.carriedBy) { v.carriedBy.carrying = null; v.carriedBy = null; }
  resolveContain(w, v, rev ? 'reverse' : cause);
}
// --- 三階段收容 (spec F §2.5): 每次收容 → 記 log + 計分; 前兩次軟重整升級, 第三次最終封存 ---
export function resolveContain(w, loser, method) {
  roundWins[w]++; v2s.winnerPid = w;
  containLog.push({ winner: w, method, stage: v2s.stage });
  addRing(POD.x, POD.y, POD.r * 1.8, COLORS[w], 0.5, 5); addShake(6);
  dlog('CONTAIN', NAMES[loser.pid], '→', NAMES[w], method, 'score', roundWins[0] + '-' + roundWins[1]);
  startPerform(w, loser); // 回收演出 V0.8:收尾(封存/彈回)延到演出結束(finishPerform)
}
// --- 回收演出 V0.8(使用者演出設計文檔 2026-07;拍板:不鎖定勝方/不動 follow cam/艙口 LED 飄字)---
// 時間軸(佔總長比例):捕捉 0-12% → 掙扎 12-30% → 掃描 30-62% → 分類 62-80% → 收尾 80-100%。
// 收尾風味 n:1 正常彈回 / 2 失控火花波及艙邊(文檔 §四:別只羞辱敗方)/ 3 壓縮成方塊送清運 → 事故報告。
const PERFORM_KEYS = [0.12, 0.30, 0.62, 0.80];
export function startPerform(w, loser) {
  const total = roundWins[0] + roundWins[1], final = roundWins[w] >= WIN_TARGET;
  const n = final ? 3 : Math.min(2, total);               // 演出風味(最終封存一定演第 3 式)
  const cls = WASTE_CLASS[loser._lastItem || 'none'] || WASTE_CLASS.none;
  // 敗方 snap 艙心 + 全保護(罩下不可打/不可抓;stunned=掙扎占位姿勢,V0.8 沿用暈眩搖晃)
  loser.x = POD.x; loser.y = POD.y; loser.vx = 0; loser.vy = 0; loser.z = 0;
  loser._thrownT = -9; loser._lying = false; loser.fumbleT = 0; loser._slideVx = 0; loser._slideVy = 0;
  loser.stunned = true; loser.stunT = 99; loser.frozen = false; loser.invuln = 99; loser._performing = true;
  // 勝方若站在罩位 → 輕推出罩外(免穿模;不鎖定,推完照常自由行動)
  const win = fighters[w], d = Math.hypot(win.x - POD.x, win.y - POD.y), rNeed = PERFORM_DOME_R + win.r + 4;
  if (win.state === 'alive' && d < rNeed) {
    const a = d > 1 ? Math.atan2(win.y - POD.y, win.x - POD.x) : Math.PI;
    win.x = POD.x + Math.cos(a) * rNeed; win.y = POD.y + Math.sin(a) * rNeed;
  }
  v2s.perform = { n, total, final, t: 0, T: PERFORM_T[n - 1], loser: loser.pid, winner: w, cls, phase: 'capture', pk: 0, line: '回收目標已捕捉', fired: 0, cube: null };
  game.sfx.push('thud');
  dlog('PERFORM start #' + n, NAMES[loser.pid], final ? '(final)' : '');
}
export function updatePerform(dt) {
  const p = v2s.perform; if (!p) return;
  const loser = fighters[p.loser];
  loser.stunT = 99;                                       // 演出期間不醒(v2.js 迴圈 continue 掉倒數,這行保險)
  p.t += dt; const k = Math.min(1, p.t / p.T), K = PERFORM_KEYS;
  const conflict = ['易燃?', '低溫?', '帶電?', '會尖叫?']; // 文檔 §四:第二次分類圖示亂跳
  if (k < K[0]) { p.phase = 'capture'; p.pk = k / K[0]; p.line = p.n === 2 ? '系統確認:它又回來了' : p.n === 3 ? '最終回收程序啟動' : '回收目標已捕捉'; }
  else if (k < K[1]) { p.phase = 'struggle'; p.pk = (k - K[0]) / (K[1] - K[0]); p.line = p.n === 3 ? '取消重新投放程序' : '警告:此廢棄物仍在反抗'; }
  else if (k < K[2]) {
    p.phase = 'scan'; p.pk = (k - K[1]) / (K[2] - K[1]);
    p.line = p.n === 2 ? '分類衝突:' + conflict[Math.floor(p.pk * 8) % conflict.length] : p.n === 3 ? '讀取樣本行為紀錄……' : '正在分析……';
  } else if (k < K[3]) {
    p.phase = 'classify'; p.pk = (k - K[2]) / (K[3] - K[2]);
    p.line = p.n === 1 ? '分類完成:' + p.cls : p.n === 2 ? '分類失敗:太複雜 → 先丟掉' : '身份:玩家樣本(' + p.cls + ') → 正式清運';
    if (p.fired < 1) { p.fired = 1; addRing(POD.x, POD.y, PERFORM_DOME_R, p.n === 2 ? '#ff9a4a' : '#9fe8ff', 0.4, 4); game.sfx.push('upgrade'); } // 分類鎖定「叮」
  } else {
    p.phase = 'resolve'; p.pk = (k - K[3]) / (1 - K[3]);
    p.line = p.n === 1 ? '初步回收完成:樣本重新投入測試' : p.n === 2 ? '分類中心失控!' : '壓縮完成:請勿打開包裝';
    if (p.fired < 2) {
      p.fired = 2;
      if (p.n === 2) {                                    // 錯誤回收事故:火花小爆炸,波及艙邊所有人
        hitSpark(POD.x, POD.y, '#ffd257', 2); addRing(POD.x, POD.y, PERFORM_DOME_R * 2.2, '#ff9a4a', 0.5, 6); addShake(7); game.sfx.push('thud');
        for (const o of fighters) {
          if (o.pid === p.loser || o.state !== 'alive') continue;
          const od = Math.hypot(o.x - POD.x, o.y - POD.y);
          if (od < PERFORM_DOME_R * 2.4) { const a = Math.atan2(o.y - POD.y, o.x - POD.x); o.vx += Math.cos(a) * 260; o.vy += Math.sin(a) * 260; }
        }
      }
      if (p.n === 3) { loser._hidden = true; p.cube = { x: POD.x, y: POD.y }; addShake(6); addHitstop(0.12); game.sfx.push('thud'); } // 卡通壓縮:人縮進包裝方塊(素木箱佔位)
    }
    if (p.cube) p.cube.y -= 46 * dt;                      // 包裝方塊往北送清運(輸送帶佔位,朝 WIZARD INTAKE 字)
  }
  if (p.t >= p.T) finishPerform();
}
function finishPerform() {
  const p = v2s.perform, loser = fighters[p.loser];
  loser._performing = false; loser.stunned = false; loser.stunT = 0; loser.invuln = 0;
  v2s.perform = null;
  if (p.final) { finalSeal(p.winner); }                   // 第三次:最終封存 → 事故報告(_hidden 由 resetFighter/restart 清)
  else { addRing(POD.x, POD.y, PERFORM_DOME_R * 1.6, '#4dffcf', 0.5, 5); softReintegrate(loser, p.total); } // 開罩彈回出生點
}
export function finalSeal(w) { // 第三次 = 最終封存儀式 → 事故報告
  v2s.bannerText = NAMES[w] + ' 最終封存完成！'; v2s.winBannerT = 3.0;
  addText(POD.x, POD.y - 48, '最終封存完成', COLORS[w]);
  addRing(POD.x, POD.y, POD.r * 3.2, COLORS[w], 0.7, 9); addRing(POD.x, POD.y, POD.r * 2.1, '#ffffff', 0.5, 6);
  addShake(12); addHitstop(0.4); game.sfx.push('waveclear'); game.sfx.push('upgrade');
  endMatch(w);
}
export function softReintegrate(loser, total) { // 非第三次:被收容者出生點彈出+無敵, 場地不重置, 警戒升級
  const next = Math.min(3, total + 1); applyStage(next);
  v2s.bannerText = STAGE_BANNER[Math.min(total - 1, STAGE_BANNER.length - 1)]; v2s.winBannerT = 1.6;
  addText(POD.x, POD.y - 48, NAMES[1 - loser.pid] + ' 收容成功　→ ' + STAGE_NAME[next - 1], COLORS[1 - loser.pid]);
  addHitstop(0.35); game.sfx.push('upgrade');
  resetFighter(loser); loser.invuln = 1.8; // 彈回出生點 + 無敵(不能被抓/打)
}
export function endMatch(pid) { v2s.matchOver = true; v2s.report = generateReport(pid); game.sfx.push('upgrade'); dlog('MATCH OVER → report', v2s.report.level, v2s.report.name); } // 爽鬥回歸:事故報告=結算+分享引擎
export function doAction(f) { // 情境動作鍵(j 鍵;桶的撿/丟/放走滑鼠+E+觸控的 mouseLeft/mouseRight)
  if (f.state !== 'alive' || f.stunned || f.carriedBy || f.fumbleT > 0 || f.carryObj) return;
  if (f.carrying) { dropCarry(f); return; }
  const o = fighters[1 - f.pid];
  if (f.regrabCd <= 0 && o.state === 'alive' && o.stunned && !o.carriedBy && o.invuln <= 0 && Math.hypot(o.x - f.x, o.y - f.y) <= GRAB_RANGE + o.r) { startCarry(f, o); return; }
  punch(f);
}

// --- simple test AI (so you can play solo): chase the rival, punch in range, grab when stunned,
// drag to the pod; on isles terrain steer to avoid walking off edges (aiSafeDir). ---
// 爽鬥回歸:AI=純戰鬥對手(分類同事 demoMove 已隨 B 款凍結於 4c92837;小人不再搬瓶)。
export function aiMove(f) {
  const o = fighters[1 - f.pid]; // the rival (1v1)
  // 首局容錯:開場(就位→開始!)後頭 3 秒不主動出拳,給新玩家反應/先手空間
  const attackGrace = v2s.tutorial && game.time < 7.0;
  let gx, gy;
  if (f.carrying) {                                       // 扛著人 → 拖去實驗艙
    gx = POD.x; gy = POD.y;
    // 投擲決策:夠近了穩穩丟進去;或對方掙脫條快滿 → 恐慌拋(太遠會丟歪=戲劇性)。帶反應延遲。
    const pd = Math.hypot(POD.x - f.x, POD.y - f.y);
    if (pd <= AI_THROW_DIST || f.carrying.escape >= AI_THROW_PANIC) {
      if (!f._aiThrowAt) f._aiThrowAt = game.time + AI_THROW_DELAY;
      if (game.time >= f._aiThrowAt) { f.facing = Math.atan2(POD.y - f.y, POD.x - f.x); throwCarried(f); f._aiThrowAt = 0; }
    } else f._aiThrowAt = 0;
  }
  else { gx = o.x; gy = o.y; }                            // 追對手(打暈/抓)
  // 出拳後的後撤喘息:短暫遠離對手(給玩家反打窗口)
  if (!f.carrying && game.time < (f._aiBackoffUntil || 0)) { gx = f.x - (o.x - f.x); gy = f.y - (o.y - f.y); }
  const dx = gx - f.x, dy = gy - f.y, dl = Math.hypot(dx, dy) || 1;
  const dir = FREEFORM ? aiSafeDir(f, dx / dl, dy / dl) : { x: dx / dl, y: dy / dl };
  if (dir.x || dir.y) f.facing = Math.atan2(dir.y, dir.x);
  // 跳躍(brawl-2):中距離對峙時偶爾起跳,半程自動下壓(活教學:AI 示範跳攻,玩家看得懂新動詞)
  if (f._aiDiveAt && game.time >= f._aiDiveAt) { f._aiDiveAt = 0; if (airborne(f) && !f.stunned) { f.facing = Math.atan2(o.y - f.y, o.x - f.x); dive(f); } }
  if (!attackGrace && !f.carrying && f.fumbleT <= 0 && !f.stunned && o.state === 'alive' && !o.stunned && game.time >= (f._aiJumpAt || 0)) {
    const jd = Math.hypot(o.x - f.x, o.y - f.y);
    if (jd > PUNCH_RANGE && jd < 150 && Math.random() < AI_JUMP_CHANCE) {
      jump(f);
      f._aiJumpAt = game.time + AI_JUMP_CD;
      f._aiDiveAt = game.time + JUMP_LOB.T * 0.45; // 快到頂點時下壓
    }
  }
  // actions: grab a stunned rival (after a human-like reaction delay), else sometimes punch when in range
  if (!f.carrying && f.fumbleT <= 0 && o.state === 'alive' && !o.carriedBy && o.invuln <= 0) {
    const od = Math.hypot(o.x - f.x, o.y - f.y);
    if (o.stunned) {
      if (!f._aiGrabAt) f._aiGrabAt = game.time + AI_GRAB_DELAY;   // 看到暈 → 排一個「反應時間」
      if (game.time >= f._aiGrabAt && f.regrabCd <= 0 && od <= GRAB_RANGE + o.r) { f.facing = Math.atan2(o.y - f.y, o.x - f.x); startCarry(f, o); f._aiGrabAt = 0; }
    } else {
      f._aiGrabAt = 0;
      if (!attackGrace && f.punchCd <= 0 && od <= PUNCH_RANGE + o.r && game.time >= (f._aiSkipUntil || 0) && game.time >= (f._aiBackoffUntil || 0)) {
        if (Math.random() < AI_PUNCH_CHANCE) {                     // 6 成真的出拳;打完後撤喘息
          f.facing = Math.atan2(o.y - f.y, o.x - f.x); punch(f);
          if (f.comboN === 0) f._aiBackoffUntil = game.time + AI_BACKOFF_T; // 一套打完才後撤(不打斷三連)
        } else f._aiSkipUntil = game.time + 0.3;                   // 猶豫:0.3s 後再考慮
      }
    }
  } else f._aiGrabAt = 0;
  return dir;
}
