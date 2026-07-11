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
  SPEED, RUN_MULT, POD, inPod, resetFighter, applyStage, barrels, labSwitch,
  STAB_MAX, PUNCH_RANGE, PUNCH_CONE, COMBO_STAB, COMBO_CD, COMBO_WINDOW, STRIKE_DELAY, PUNCH_LAUNCH_LOB,
  PUSH_WIN, PUSH_CDT, PUSH_RANGE, PUSH_FORCE, PUSH_STAGGER, AI_PUSH_CHANCE, AI_PUNCH_CHANCE, AI_GRAB_DELAY, AI_BACKOFF_T,
  STUN_T, GRAB_RANGE, CARRY_SLOW, REGRAB_CD, FUMBLE_T, ESCAPE_STAB, BODY_SEP,
  PERSON_LOB, WALL_BOUNCE, PERSON_HOLD_T, PERSON_THROW_DELAY, AI_THROW_DIST, AI_THROW_PANIC, AI_THROW_DELAY,
  ICE_ACCEL, ICE_FRICTION, STAGE_NAME, STAGE_BANNER,
  FIRE_STAB_DPS, POISON_STAB_DPS, POISON_BURST_R, POISON_BURST_STAB, POISON_BURST_FORCE,
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
export function hitsFighter(f, nx, ny) {
  for (const o of fighters) {
    if (o === f || o.state !== 'alive' || o.falling) continue;
    if (f.carrying === o || o.carrying === f) continue;
    const rr = (f.r + o.r) * BODY_SEP;
    const dxn = nx - o.x, dyn = ny - o.y, d2n = dxn * dxn + dyn * dyn;
    if (d2n >= rr * rr) continue;
    const dxc = f.x - o.x, dyc = f.y - o.y;
    if (d2n >= dxc * dxc + dyc * dyc) continue; // 正在遠離 → 放行(防重疊卡死)
    return true;
  }
  return false;
}
// --- 地板化學讀取 (docs/v2-floor-state-architecture.md 第二刀):踩冰滑 / 踩電水硬直 / 站火海·毒區削穩定值 ---
// 冰面=地板化學 FL.ICE(舊 iceZones 圓區已退場——冰瓶走 stampElement 後無人寫入,2026-07 清除)。
export function onSlipperyIce(x, y) { return stateAtPixel(x, y) === FL.ICE; }
// 每幀(移動前)呼叫:電水=自電硬直(restunT 節流,避免每幀重暈);火海/毒區=削穩定值 → 歸零擊暈(好抓=收容路徑)。
export function floorHazards(f, dt) {
  if (f.state !== 'alive' || f.carriedBy || f.invuln > 0) return;
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
  const m = f.ai ? aiMove(f) : (f.pid === LOCAL ? readMove(f.pid) : { x: 0, y: 0 }); // 被動假人(非 AI 非本機)不吃方向鍵,原地站
  if (f.pid === LOCAL && !f.ai) {
    if (touchInput.enabled) { if (m.x || m.y) f.facing = Math.atan2(m.y, m.x); } // 手機:移動=面向;放開搖桿保留最後方向(可推向魔法陣→放開→按投擲)
    else f.facing = Math.atan2(mouse.y - f.y, mouse.x - f.x);                    // 桌機:面向滑鼠(移動與瞄準解耦)
  } else if (m.x || m.y) f.facing = Math.atan2(m.y, m.x);                        // AI／熱座紅方:面向移動方向
  const sp = SPEED * ((f.carrying || f.carryObj) ? CARRY_SLOW : 1) * (f.running ? RUN_MULT : 1); // 搬運人/扛桶時變慢;跑步(雙擊)加速
  if (onSlipperyIce(f.x, f.y)) { // 冰面:打滑(走路變成加速度,低摩擦保留動量 → 滑行,可滑進艙)
    f.vx += m.x * sp * ICE_ACCEL * dt; f.vy += m.y * sp * ICE_ACCEL * dt;
    const vv = Math.hypot(f.vx, f.vy), vmax = sp * 1.4; if (vv > vmax) { f.vx *= vmax / vv; f.vy *= vmax / vv; }
    const isx = f.vx * dt, isy = f.vy * dt;
    if (!circleHitsSolid(f.x + isx, f.y, f.r) && !hitsFighter(f, f.x + isx, f.y)) f.x += isx; else f.vx = 0;
    if (!circleHitsSolid(f.x, f.y + isy, f.r) && !hitsFighter(f, f.x, f.y + isy)) f.y += isy; else f.vy = 0;
    f.x = clamp(f.x, f.r, W - f.r); f.y = clamp(f.y, f.r, H - f.r);
    const ik = Math.pow(ICE_FRICTION, dt); f.vx *= ik; f.vy *= ik;
    return;
  }
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
  addText(o.x, o.y - 30, '暈！', '#ffd36d'); addRing(o.x, o.y, 30, '#ffd36d', 0.3, 4);
  addHitstop(0.12); addShake(6); game.sfx.push('hurt'); // 擊暈=大事件:更長定格+重音,把「打崩了」讀出來
  if (o.pid === LOCAL) v2s.localFlash = 0.3;
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
// 出拳=起手:播動作、鎖定方向,STRIKE_DELAY 秒後的 impact 影格才判定命中(resolveStrike)。
// 起手中被打暈/被抓/被推開踉蹌 → resolveStrike 的守衛直接取消 = 格擋推開是能打斷出拳的真反制。
export function punch(f) {
  if (f.punchCd > 0 || f.stunned || f.carrying || f.carryObj || f.carriedBy || f.fumbleT > 0 || f.state !== 'alive') return;
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
// 格擋鍵的三層分派(同一顆鍵,時機決定結果):
// 黃金窗口內=精準格擋(反暈) → 挨打後短窗=普通推開 → 都不是=空按進冷卻(防無腦連打)
export function doGuard(f) {
  if (f.state !== 'alive' || f.stunned || f.carriedBy || f.fumbleT > 0) return;
  if (f.pushCd > 0) return;                    // 冷卻中:無事發生(不重複懲罰)
  if (f.parryWinT > 0) { doPerfectParry(f); return; }
  if (f.pushWinT > 0) { doPushOff(f); return; }
  f.pushCd = PUSH_CDT;                         // 空按:格擋資源被自己按掉
  addText(f.x, f.y - 34, '格擋落空…', '#8fa8b8'); game.sfx.push('whiff');
}
export function doPerfectParry(d) { // 黃金窗口內按下:取消對方那拳+反暈(進入抓取回合的入場券)
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
    o.faceT = 0.2; o.hurt = 0.12; o.lastHitBy = f.pid; o.lastHitT = game.time;
    o.stability = Math.max(0, o.stability - COMBO_STAB[stage]); o.stabCd = 0.8;
    flinch(o, a, fin ? 0.32 : 0.22);
    const cpx = o.x - Math.cos(a) * o.r * 0.7, cpy = o.y - Math.sin(a) * o.r * 0.7; // 火花開在拳頭接觸點
    hitSpark(cpx, cpy, '#ffe0a3', fin ? 2.2 : 1.5); addRing(cpx, cpy, fin ? 34 : 20, '#ffd36d', fin ? 0.32 : 0.22, fin ? 5 : 3);
    if (fin) addText(o.x, o.y - 34, '重擊！', '#ffb14a');
    // 格擋窗口:被打中(還能動)→ 短窗內按格擋鍵可推開攻擊方;AI 有機率排程一次推開
    if (!o.stunned && !o.carriedBy) {
      o.pushWinT = PUSH_WIN; o.pushFrom = f;
      if (o.ai && o.pushCd <= 0 && !o._aiPushAt && Math.random() < AI_PUSH_CHANCE) o._aiPushAt = game.time + 0.15 + Math.random() * 0.3;
    }
    if (o.stability <= 0 && !o.stunned && o.restunT <= 0) stunFighter(o); // 穩定值歸零 → 擊暈
    // 鉤拳不位移(受擊=純踉蹌);終結技=打飛:小拋物線(擊中→打飛→落地),與丟人同管線、lob 較小。
    // 放在擊暈判定之後:stunFighter 會把速度×0.4,打崩+打飛要同時成立(落地時還暈著)。
    if (fin) {
      const F = PUNCH_LAUNCH_LOB.range / PUNCH_LAUNCH_LOB.T;            // 出手當下現算(?tune=1/控制台改 LOB 即時生效)
      o.vx = Math.cos(a) * F; o.vy = Math.sin(a) * F;
      o._thrownT = game.time; o._lob = PUNCH_LAUNCH_LOB; o.fumbleT = PUNCH_LAUNCH_LOB.T + 0.1;
      if (o.carrying) dropCarry(o);                                     // 飛行中不可能繼續扛人(扛桶由 v2.js 扛桶 loop 的 fumbleT 條件掉)
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
  if (!labSwitch.armed) { // 揍中央緊急控制台 → arm 四站洩漏循環(單向不可關;§10.1)
    const dx = labSwitch.x - f.x, dy = labSwitch.y - f.y, d = Math.hypot(dx, dy);
    let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (d <= PUNCH_RANGE + labSwitch.r && Math.abs(da) <= PUNCH_CONE) {
      labSwitch.armed = true; v2s.stationsArmed = true; hit = true;
      addText(labSwitch.x, labSwitch.y - 34, '收容失控！四角開始洩漏', '#ff9a4a');
      addRing(labSwitch.x, labSwitch.y, 64, '#ff9a4a', 0.6, 7); addShake(9); addHitstop(0.12); game.sfx.push('explosion');
      dlog('SWITCH ARMED → stations live');
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
export function containByCarry(f, o) { // 拖進艙 = 收容成功 (spec F §2.2 失控入艙)
  const w = f.pid, rev = isReversal(o);
  inc.contains[w]++; inc.carries[w]++; inc.types.add('contain');
  if (rev) { inc.reverseContains++; inc.types.add('reverse'); }
  f.carrying = null; f._carryThrowAt = 0; f.carryClip = null; f.carryHold = 0; o.carriedBy = null;
  resolveContain(w, o, rev ? 'reverse' : 'carry');
}
export function containByEnviron(v, cause) { // 被擊退/打滑失控進艙 → v 被收容, 對手勝(spec F §2.2)
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
  if (roundWins[w] >= WIN_TARGET) finalSeal(w);
  else softReintegrate(loser, roundWins[0] + roundWins[1]);
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
export function endMatch(pid) { v2s.matchOver = true; v2s.report = generateReport(pid); game.sfx.push('upgrade'); dlog('MATCH OVER → report', v2s.report.level, v2s.report.name); }
export function doAction(f) { // 情境動作鍵(j 鍵;桶的撿/丟/放走滑鼠+E+觸控的 mouseLeft/mouseRight)
  if (f.state !== 'alive' || f.stunned || f.carriedBy || f.fumbleT > 0 || f.carryObj) return;
  if (f.carrying) { dropCarry(f); return; }
  const o = fighters[1 - f.pid];
  if (f.regrabCd <= 0 && o.state === 'alive' && o.stunned && !o.carriedBy && o.invuln <= 0 && Math.hypot(o.x - f.x, o.y - f.y) <= GRAB_RANGE + o.r) { startCarry(f, o); return; }
  punch(f);
}

// --- simple test AI (so you can play solo): chase the rival, punch in range, grab when stunned,
// drag to the pod; on isles terrain steer to avoid walking off edges (aiSafeDir). ---
export function aiMove(f) {
  const o = fighters[1 - f.pid]; // the rival (1v1)
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
  // actions: grab a stunned rival (after a human-like reaction delay), else sometimes punch when in range
  if (!f.carrying && f.fumbleT <= 0 && o.state === 'alive' && !o.carriedBy && o.invuln <= 0) {
    const od = Math.hypot(o.x - f.x, o.y - f.y);
    if (o.stunned) {
      if (!f._aiGrabAt) f._aiGrabAt = game.time + AI_GRAB_DELAY;   // 看到暈 → 排一個「反應時間」
      if (game.time >= f._aiGrabAt && f.regrabCd <= 0 && od <= GRAB_RANGE + o.r) { f.facing = Math.atan2(o.y - f.y, o.x - f.x); startCarry(f, o); f._aiGrabAt = 0; }
    } else {
      f._aiGrabAt = 0;
      if (f.punchCd <= 0 && od <= PUNCH_RANGE + o.r && game.time >= (f._aiSkipUntil || 0) && game.time >= (f._aiBackoffUntil || 0)) {
        if (Math.random() < AI_PUNCH_CHANCE) {                     // 6 成真的出拳;打完後撤喘息
          f.facing = Math.atan2(o.y - f.y, o.x - f.x); punch(f);
          if (f.comboN === 0) f._aiBackoffUntil = game.time + AI_BACKOFF_T; // 一套打完才後撤(不打斷三連)
        } else f._aiSkipUntil = game.time + 0.3;                   // 猶豫:0.3s 後再考慮
      }
    }
  } else f._aiGrabAt = 0;
  return dir;
}
