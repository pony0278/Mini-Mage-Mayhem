// v2 道具與危險物 (spec F §3/§4;docs/v2-module-boundaries.md §3):
// 補給座撿取、風壓手套/傳送符/冰霜瓶三道具、爆桶點燃→爆炸。
// 新法術/道具的 cast 加在這裡;數值常數與資料表進 v2-state.js;報告欄位進 inc + v2-report.js。
import { W, H } from './constants.js';
import { clamp } from './utils.js';
import { game } from './state.js';
import { addShake, addHitstop, addRing, hitSpark, addText, addWindFan } from './fx.js';
import {
  v2s, fighters, LOCAL, dlog, NAMES, inc,
  pads, randItem, ITEM_INFO, ITEM_SPEC, ITEM_CAST_RECOVER, PICKUP_R,
  WIND_RANGE, WIND_CONE, WIND_FORCE, WIND_TUMBLE_MIN, WIND_TUMBLE_JITTER, WIND_TUMBLE_LOB, TP_BLINK, TP_JITTER, ICE_R, ICE_LOB, itemProjectiles,
  barrels, BARREL_BLAST, BARREL_FORCE, BARREL_STAB, BARREL_PATCH_R, WILD_CONTAM,
  BARREL_FRICTION, BARREL_PUSH, BARREL_ARM_GRACE, BARREL_THROW_DELAY, GRAB_RANGE,
  BARREL_LOB, BARREL_BONK_STAB, BARREL_DROP_T, BARREL_LAND_FUSE, LAND_SKID, WALL_BOUNCE, lobZ,
  stations, STATION_WARN, ERUPT_PATCH_R, ERUPT_PULSE, ERUPT_STAB,
  FUMBLE_T, REGRAB_CD,
} from './v2-state.js';
import { flinch, camKick, dropCarry, stunFighter, freezeFighter } from './v2-combat.js';
import { CLIPS } from './brawler-clips.js';
import { stampElement, stateAtPixel, FL } from './v2-floor.js';
import { circleHitsSolid } from './fx.js';

// 元素 → 顏色(爆炸 tint + 升壓發光 telegraph);wild=未充能野生紫
const ELEM_COL = { fire: '#ff7a3a', water: '#4da6ff', poison: '#b06bff', ice: '#bfe6ff', oil: '#9a8a5a', lightning: '#9fd0ff', wild: '#c98cff' };
export function elemColor(elem) { return ELEM_COL[elem] || ELEM_COL.wild; }
export function barrelChargeColor(charge) { return ELEM_COL[charge] || ELEM_COL.wild; }
// 桶下的元素地板 → 充能元素名(idle 時吸收;決定爆種+污染)。clean/無 → null(野生隨機)
const FLOOR_TO_ELEM = { [FL.FIRE]: 'fire', [FL.ICE]: 'ice', [FL.POISON]: 'poison', [FL.WATER]: 'water', [FL.OIL]: 'oil', [FL.CHARGED]: 'water' };
function floorChargeUnder(b) { return FLOOR_TO_ELEM[stateAtPixel(b.x, b.y)] || null; }
// 受攻擊/被丟 → 開始升壓(idle → fuse)。charge 已由 idle 吸收,此刻凍結(升壓中不再更新)。
export function pressurizeBarrel(b) {
  if (!b.alive || b.state !== 'idle') return;
  b.state = 'fuse'; b.fuse = v2s.barrelFuseCur;
  addRing(b.x, b.y, b.r + 8, barrelChargeColor(b.charge), 0.3, 4); addText(b.x, b.y - 26, '升壓！', barrelChargeColor(b.charge)); game.sfx.push('dash');
}

// --- 道具:撿取 / 使用 (spec F §4). 補給座重刷隨機道具; 只拿1; 用完即空; 傳送符是被抓時唯一可用 ---
export function updatePads(dt) {
  for (const p of pads) {
    if (!p.item) { p.respawn -= dt; if (p.respawn <= 0) p.item = randItem(); continue; }
    for (const f of fighters) {
      if (f.ai || f.state !== 'alive' || f.item || f.carriedBy || f.carrying || f.stunned) continue; // AI 這步不撿道具
      if (Math.hypot(f.x - p.x, f.y - p.y) < PICKUP_R + f.r) {
        f.item = p.item; f.itemUses = ITEM_SPEC[p.item].uses; p.item = null; p.respawn = v2s.padRespawnCur;
        addText(f.x, f.y - 32, ITEM_INFO[f.item].name + '！', ITEM_INFO[f.item].color); addRing(f.x, f.y, 28, ITEM_INFO[f.item].color, 0.3, 4); game.sfx.push('upgrade');
        dlog('PICKUP', NAMES[f.pid], f.item); break;
      }
    }
  }
}
export function useItem(f) {
  if (!f.item || f.state !== 'alive' || f.carrying) return;                 // 搬運中兩手全滿,不能用道具
  const spec = ITEM_SPEC[f.item];
  const grabbed = !!f.carriedBy;
  if ((grabbed || f.stunned || f.fumbleT > 0) && !spec.whileDisabled) return; // 被抓/暈/踉蹌:僅 whileDisabled 道具(傳送)可用
  if (f.itemCastCd > 0 || f._itemCastAt > 0) return;                        // 施法中/承諾冷卻中:不重複觸發
  const type = f.item;
  if (--f.itemUses <= 0) f.item = null;                                     // 起手即扣一次;歸零清空(不退還)
  inc.itemUses[type]++;
  if (!spec.clip || spec.delay <= 0) { castItem(type, f); return; }         // 瞬發(傳送)→ 直接生效、無動畫
  // 排程施放:動畫時鐘 + impact 幀 + 承諾冷卻
  f.itemFx = game.time; f.itemClip = spec.clip;
  f._itemCastAt = game.time + spec.delay; f._itemCastType = type;
  f.itemCastCd = spec.delay + ITEM_CAST_RECOVER;
}
function castItem(type, f) {
  if (type === 'wind') castWind(f);
  else if (type === 'teleport') castTeleport(f);
  else if (type === 'ice') castIce(f);
}
// step 在 impact 幀呼叫:施法中被打斷(暈/被抓)→ 取消(次數已扣、不退);否則發動效果
export function resolveItemCast(f) {
  const type = f._itemCastType; f._itemCastAt = 0; f._itemCastType = null;
  if (f.stunned || f.carriedBy || f.state !== 'alive') return;
  castItem(type, f);
}
// 扇形放射狀衝擊波:力=WIND_FORCE×距離衰減×角度衰減,方向=從手心往外放射(正中往前全力/兩側斜著吹歪/遠處衰減)。
// 回傳 {ux,uy,force}(放射狀單位向量×衰減力)或 null(不在扇形內)。對手/桶/飛行冰瓶共用這把尺=一發全掃。
function windBlast(f, a, ox, oy) {
  const dx = ox - f.x, dy = oy - f.y, d = Math.hypot(dx, dy) || 0.001;
  if (d > WIND_RANGE) return null;
  let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
  if (Math.abs(da) > WIND_CONE) return null;
  const fall = (1 - d / WIND_RANGE) * (1 - Math.abs(da) / WIND_CONE);        // 近×中=1、遠/邊→0
  return { ux: dx / d, uy: dy / d, force: WIND_FORCE * fall };
}
// 方向亂數擾動(吹亂=每個東西被吹去的方向略歪,不齊步滑):把單位向量繞 ±JITTER 隨機旋轉。
function windScatter(ux, uy) {
  const j = (Math.random() * 2 - 1) * WIND_TUMBLE_JITTER, c = Math.cos(j), s = Math.sin(j);
  return [ux * c - uy * s, ux * s + uy * c];
}
export function castWind(f) { // 遠距扇形放射狀衝擊波:轟一片(對手/桶/飛行冰瓶)往外飛;無貼臉自反噬(遠程武器)
  const a = f.facing; let hit = false;
  for (const o of fighters) {
    if (o === f || o.state !== 'alive' || o.carriedBy || o.invuln > 0) continue;
    const w = windBlast(f, a, o.x, o.y); if (!w) continue;
    hit = true;
    const [bx, by] = windScatter(w.ux, w.uy);                               // 方向亂數擾動=吹亂(不齊步滑)
    o.faceT = 0.3; o.hurt = 0.1; o.lastHitBy = f.pid; o.lastHitT = game.time;
    if (o.carrying) dropCarry(o);                                            // 吹中搬運者 → 鬆手
    if (w.force > WIND_TUMBLE_MIN && !o.stunned) {                          // 夠強(近中心)→ 吹翻滾:接拋飛管線=趴滾+爬起(非直立滑行)
      o.vx = bx * w.force; o.vy = by * w.force;
      o._lob = WIND_TUMBLE_LOB; o._thrownT = game.time; o.fumbleT = WIND_TUMBLE_LOB.T + 0.1;
      o.stability = Math.max(o.stability, 25);                              // 落地不至於原地再被暈
      addText(o.x, o.y - 30, '吹翻！', '#dff3ff');
    } else {                                                                // 弱(邊緣/遠)→ 只吹歪踉蹌
      o.vx += bx * w.force; o.vy += by * w.force;
      flinch(o, Math.atan2(by, bx), 0.3); addText(o.x, o.y - 26, '吹飛！', '#dff3ff');
    }
    camKick(a, 6); hitSpark(o.x, o.y, '#dff3ff', 1.3); addRing(o.x, o.y, 32, '#dff3ff', 0.3, 4);
    if (o.pid === LOCAL) v2s.localFlash = 0.25;
  }
  for (const pr of itemProjectiles) { // 反彈投射物(風剋冰投):錐內飛行冰瓶 → 放射狀甩回+改歸風施放者
    if (!pr.alive) continue;
    const w = windBlast(f, a, pr.x, pr.y); if (!w) continue;
    const spd = Math.hypot(pr.vx, pr.vy) || (ICE_LOB.range / ICE_LOB.T);
    pr.vx = w.ux * spd; pr.vy = w.uy * spd;                                   // 沿放射狀方向甩回(在手心正前=吹回原主)
    pr.flyT0 = game.time; pr.z = ICE_LOB.h0;                                  // 重啟拋物弧(從當前位置起新的一段)
    pr.owner = f.pid;                                                          // 改歸風施放者 → 命中原主=凍住原主、計功給風方
    hit = true;
    hitSpark(pr.x, pr.y, '#dff3ff', 1.5); addRing(pr.x, pr.y, 30, '#dff3ff', 0.32, 5); addText(pr.x, pr.y - 22, '反彈！', '#dff3ff');
  }
  for (const b of barrels) { // 吹動桶:錐內 idle 桶 → 放射狀+亂數擾動推走(被吹亂的活炸彈)+ 升壓
    if (!b.alive || b.state !== 'idle') continue;
    const w = windBlast(f, a, b.x, b.y); if (!w) continue;
    const [bx, by] = windScatter(w.ux, w.uy);
    b.vx += bx * w.force * 1.4; b.vy += by * w.force * 1.4;                  // 吹飛(桶輕=吹更遠更亂;updateBarrels 走物理+滾動摩擦)
    pressurizeBarrel(b); hit = true;
  }
  addWindFan(f.x, f.y, a, WIND_RANGE, WIND_CONE);                          // 扇形衝擊波(取代舊地上一圈圓;render 畫扇形+外緣射程弧+風絲)
  // 爆風加料(Tier A,全平台):槍口白閃 + 沿扇形往外噴的飛塵 + 方向性鏡頭踹 + 加重震動
  const mx = f.x + Math.cos(a) * (f.r + 10), my = f.y + Math.sin(a) * (f.r + 10);
  hitSpark(mx, my, '#eaffff', 1.8); addRing(mx, my, 18, '#ffffff', 0.14, 3); // 槍口白閃
  for (let i = 0; i < 16; i++) {                                            // 飛塵:沿扇形錐往外噴(近槍口;高摩擦=噴一小段就散)
    const ang = a + (Math.random() * 2 - 1) * WIND_CONE, sp = 260 + Math.random() * 340;
    game.particles.push({ x: mx, y: my, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 1.4 + Math.random() * 2.6, life: 0.22 + Math.random() * 0.22, maxLife: 0.44, color: '#dff3ff' });
  }
  camKick(a, 11); addShake(hit ? 9 : 5); game.sfx.push('dash');            // 方向性鏡頭踹 + 加重震動
  dlog('WIND', NAMES[f.pid], hit ? 'hit' : 'miss');
}
export function castTeleport(f) { // 與對手換位(±偏移); 被抓時=脫困+搬運者踉蹌
  const grabbed = !!f.carriedBy, o = fighters[1 - f.pid], jit = () => (Math.random() * 2 - 1) * TP_JITTER;
  if (o.state === 'alive') {
    const fx = f.x, fy = f.y;
    f.x = clamp(o.x + jit(), f.r, W - f.r); f.y = clamp(o.y + jit(), f.r, H - f.r);
    o.x = clamp(fx + jit(), o.r, W - o.r); o.y = clamp(fy + jit(), o.r, H - o.r);
    o.vx = 0; o.vy = 0;
    addRing(f.x, f.y, 40, '#c98cff', 0.4, 5); addRing(o.x, o.y, 40, '#c98cff', 0.4, 5); addText(f.x, f.y - 30, '換位！', '#c98cff'); addShake(4);
  } else {
    f.x = clamp(f.x + Math.cos(f.facing) * TP_BLINK, f.r, W - f.r); f.y = clamp(f.y + Math.sin(f.facing) * TP_BLINK, f.r, H - f.r);
    addText(f.x, f.y - 30, '瞬移！', '#c98cff');
  }
  if (grabbed) { const cap = f.carriedBy; f.carriedBy = null; f.escape = 0; inc.teleportEscapes++; if (cap) { cap.carrying = null; cap.fumbleT = FUMBLE_T; cap.regrabCd = REGRAB_CD; cap.wasCarryingT = game.time; } } // 逃脫+反轉
  f.vx = 0; f.vy = 0; game.sfx.push('upgrade');
  dlog('TELEPORT', NAMES[f.pid], grabbed ? '(escape)' : '');
}
// 冰霜瓶:release 幀從頭頂甩出(useItem 播 barrel_throw 暫代動畫,resolveItemCast 在 delay=release 幀呼叫這裡)
// → ICE_LOB 拋物線 → 落地/撞牆即碎 → 冰面。飛行中穿人不碰撞(瓶不傷人,殺傷=冰面滑行/接雷)。
export function castIce(f) {
  const a = f.facing, F = ICE_LOB.range / ICE_LOB.T;                 // 出手當下現算(改 LOB 即時生效)
  itemProjectiles.push({ x: f.x + Math.cos(a) * (f.r + 8), y: f.y + Math.sin(a) * (f.r + 8), vx: Math.cos(a) * F, vy: Math.sin(a) * F, flyT0: game.time, z: ICE_LOB.h0, elem: 'ice', alive: true, owner: f.pid });
  game.sfx.push('dash'); addText(f.x, f.y - 30, '拋瓶！', ITEM_INFO.ice.color);
  dlog('ICE throw by', NAMES[f.pid]);
}
function shatterProjectile(pr) { // 瓶=脆:落地/撞牆即碎 → 蓋元素地板;無傷害脈衝(冰的殺傷=滑行/接雷)
  pr.alive = false;
  const n = stampElement(pr.x, pr.y, ICE_R, pr.elem);
  addRing(pr.x, pr.y, ICE_R, ITEM_INFO.ice.color, 0.4, 5); hitSpark(pr.x, pr.y, ITEM_INFO.ice.color, 1.4);
  addText(pr.x, pr.y - 20, '碎裂！', ITEM_INFO.ice.color); game.sfx.push('thud');
  dlog('ICE shatter @', Math.round(pr.x) + ',' + Math.round(pr.y), 'tiles', n);
}
export function updateItemProjectiles(dt) {
  for (let i = itemProjectiles.length - 1; i >= 0; i--) {
    const pr = itemProjectiles[i];
    const t = game.time - pr.flyT0;
    pr.z = lobZ(t, ICE_LOB);
    // 直擊冰凍(玩家反饋定案):任何高度碰到人都算(桶教訓:規則綁看得見的碰撞,不綁看不見的弧高)。
    // 砸中 → 冰凍(=暈+冰凍皮)+ 瓶在他腳下碎 → 冰面(雙效,同一顆瓶)。不打自己(owner)。
    for (const o of fighters) {
      if (o.state !== 'alive' || o.pid === pr.owner || o.carriedBy || o.invuln > 0) continue;
      if (Math.hypot(pr.x - o.x, pr.y - o.y) > o.r + 8) continue;
      freezeFighter(o, pr.owner);
      pr.x = o.x; pr.y = o.y;                                        // 在被凍者腳下碎 → 冰面置中
      shatterProjectile(pr);
      break;
    }
    if (!pr.alive) { itemProjectiles.splice(i, 1); continue; }
    const nx = pr.x + pr.vx * dt, ny = pr.y + pr.vy * dt;
    if (circleHitsSolid(nx, ny, 8)) shatterProjectile(pr);           // 撞牆即碎(在牆邊成冰面;不反彈——脆)
    else {
      pr.x = clamp(nx, 8, W - 8); pr.y = clamp(ny, 8, H - 8);
      if (t >= ICE_LOB.T) {                                          // 自然落地幀:回推跨幀過衝(粗 dt 下 t 超過 T 的位移已加)→ 落點=精確 range
        const over = t - ICE_LOB.T;
        pr.x = clamp(pr.x - pr.vx * over, 8, W - 8); pr.y = clamp(pr.y - pr.vy * over, 8, H - 8);
        shatterProjectile(pr);
      }
    }
    if (!pr.alive) itemProjectiles.splice(i, 1);
  }
}

// --- 危險 #1:爆桶。靠近→點燃→爆炸:炸飛+削弱穩定值 ---
// --- 步驟 B:桶可推 / 撿 / 丟(接 carry/throw §12.1)。桶非 fighter → 走 f.carryObj 平行結構,與扛人(carrying)互斥。 ---
export function grabbableBarrel(f) { // 範圍內最近的可撿 idle 桶
  let best = null, bd = GRAB_RANGE + 20;
  for (const b of barrels) {
    if (!b.alive || b.held || b.state !== 'idle') continue;
    const d = Math.hypot(b.x - f.x, b.y - f.y);
    if (d < bd + b.r) { bd = d; best = b; }
  }
  return best;
}
export function pickUpBarrel(f, b) {
  if (f.carrying || f.carryObj || !b || !b.alive || b.held) return;
  f.carryObj = b; b.held = true; b.vx = 0; b.vy = 0; b.z = 0; b.flyT0 = -9; b.landed = true; b.dropT0 = -9;
  // 撿桶動畫(可選 clip:CLIPS 有 barrel_pickup 就播;桶從第 0 幀起貼在雙手中點,手往下撈→舉起=桶跟著走。
  // clip 播完落回程序 barrelHold 姿勢 → 結尾幀請對齊 barrel_throw 的 grab_hold 幀(= ANIM.barrelHold)才無縫)
  if (CLIPS.barrel_pickup) { f.itemFx = game.time; f.itemClip = 'barrel_pickup'; }
  addText(f.x, f.y - 30, '抓起桶！', barrelChargeColor(b.charge)); addRing(f.x, f.y, 30, barrelChargeColor(b.charge), 0.3, 4); game.sfx.push('upgrade');
}
export function dropBarrel(f) {
  const b = f.carryObj; if (!b) return;
  b.held = false; f.carryObj = null; f._barrelThrowAt = 0; f.regrabCd = REGRAB_CD;
  b.x = f.x + Math.cos(f.facing) * (f.r + b.r + 4); b.y = f.y + Math.sin(f.facing) * (f.r + b.r + 4);
  b.vx = 0; b.vy = 0;
}
// 丟桶=排程動作:按下 → 播雙手過頂 heave clip、桶仍握在手(carry loop 定位)→ release 幀才 launchBarrel 甩出。
export function throwBarrel(f) {
  const b = f.carryObj; if (!b || f.state !== 'alive' || f._barrelThrowAt > 0) return; // 已在 heave 中 → 不重複
  f.itemFx = game.time; f.itemClip = 'barrel_throw';         // 播動畫(itemClip 頻道;free 時生效)
  f._barrelThrowAt = game.time + BARREL_THROW_DELAY;         // release 幀甩出(v2.js step 判定)
  game.sfx.push('dash'); addText(f.x, f.y - 32, '舉桶！', barrelChargeColor(b.charge));
}
// release 幀到:真的把桶甩出去(舊 throwBarrel 的物理段)。中途被打斷/掉桶 → carryObj 沒了 → 取消。
export function launchBarrel(f) {
  f._barrelThrowAt = 0;
  const b = f.carryObj; if (!b || f.state !== 'alive') return;
  f.carryObj = null; b.held = false; f.regrabCd = REGRAB_CD;
  const a = f.facing;
  b.x = f.x + Math.cos(a) * (f.r + b.r); b.y = f.y + Math.sin(a) * (f.r + b.r);
  const F = BARREL_LOB.range / BARREL_LOB.T;                  // 出手當下現算(?tune=1/控制台改 LOB 即時生效)
  b.vx = Math.cos(a) * F; b.vy = Math.sin(a) * F;
  b.flyT0 = game.time; b.landed = false; b.dropT0 = -9;   // 起飛(彈道 BARREL_LOB;砸中人→快落引爆走 dropT0)
  b.thrownBy = f.pid; b.armGrace = BARREL_ARM_GRACE;
  pressurizeBarrel(b);                                        // 被丟 → 升壓(1s 引信;飛行中/落地/撞人爆)
  addShake(4); game.sfx.push('dash'); addText(b.x, b.y - 26, '丟桶！', barrelChargeColor(b.charge));
}
export function explodeBarrel(b) {
  for (const f of fighters) if (f.carryObj === b) { f.carryObj = null; f._barrelThrowAt = 0; } // 在手上爆 → 放開持有者(取消排程丟)
  b.held = false; b.thrownBy = -1;
  b.alive = false; b.respawn = v2s.barrelRespawnCur; inc.barrelBooms++; inc.types.add('barrel');
  // 爆種 = 充能元素;未充能 → 野生隨機污染。決定爆色 + 留下的地板。
  const elem = b.charge || WILD_CONTAM[Math.floor(Math.random() * WILD_CONTAM.length)];
  const col = barrelChargeColor(b.charge);
  addRing(b.x, b.y, BARREL_BLAST, col, 0.4, 6); addRing(b.x, b.y, BARREL_BLAST * 0.6, '#fff1bb', 0.3, 5);
  hitSpark(b.x, b.y, col, 2); addShake(8); addHitstop(0.1); game.sfx.push('explosion');
  addText(b.x, b.y - 30, '爆！', col);
  stampElement(b.x, b.y, BARREL_PATCH_R, elem); // 留一塊污染地板 → 接地板化學連段
  for (const f of fighters) {
    if (f.state !== 'alive' || f.invuln > 0) continue;
    const dx = f.x - b.x, dy = f.y - b.y, d = Math.hypot(dx, dy) || 1;
    if (d > BARREL_BLAST + f.r) continue;
    f.vx += dx / d * BARREL_FORCE; f.vy += dy / d * BARREL_FORCE;
    flinch(f, Math.atan2(dy, dx), 0.32);
    f.stability = Math.max(0, f.stability - BARREL_STAB); f.stabCd = 0.8; f.faceT = 0.4; f.lastHitBy = -3; f.lastHitT = game.time; // -3 = 爆桶
    if (f.carrying) dropCarry(f);                                        // 炸到搬運者 → 鬆手
    if (f.stability <= 0 && !f.stunned && f.restunT <= 0) stunFighter(f); // 炸崩 → 可能擊暈
    if (f.pid === LOCAL) v2s.localFlash = 0.32;
  }
  dlog('BARREL boom @', Math.round(b.x) + ',' + Math.round(b.y), 'as', elem);
}
export function updateBarrels(dt) {
  for (const b of barrels) {
    if (!b.alive) { b.respawn -= dt; if (b.respawn <= 0) { b.alive = true; b.state = 'idle'; b.charge = null; b.vx = 0; b.vy = 0; b.thrownBy = -1; b.armGrace = 0; b.flyT0 = -9; b.landed = true; b.z = 0; b.dropT0 = -9; } continue; }
    if (b.armGrace > 0) b.armGrace -= dt;
    if (!b.held) {                                                      // 被扛的桶由 carry loop 定位;其餘走物理
      // B 案彈道:sim 真高度(判定 gate + render 都讀它)。dropT0>0 = 快落段(砸中人/空中撞牆後垂直墜地)
      if (b.dropT0 > 0) {
        const u = (game.time - b.dropT0) / BARREL_DROP_T;
        if (u >= 1) {                                                  // 快落落地:重置引信(落地閃 LAND_FUSE 秒才爆)+ 塵土
          b.z = 0; b.dropT0 = -9;
          if (b.state === 'fuse') b.fuse = BARREL_LAND_FUSE;
          addRing(b.x, b.y, 22, '#cbb9a2', 0.28, 3); game.sfx.push('thud');
        } else b.z = b.dropZ0 * (1 - u) * (1 - u);                     // 加速墜落(二次曲線)
      } else b.z = lobZ(game.time - b.flyT0, BARREL_LOB);
      const air = b.z > 0;
      if (b.vx || b.vy) {                                              // 推/丟:速度整合 + 牆碰撞;空中無摩擦=直線飛
        const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
        let wall = false;
        if (!circleHitsSolid(nx, b.y, b.r)) b.x = nx; else { b.vx = -b.vx * WALL_BOUNCE; wall = true; }   // 撞牆=小反彈(空中/滾動皆彈,不硬停)
        if (!circleHitsSolid(b.x, ny, b.r)) b.y = ny; else { b.vy = -b.vy * WALL_BOUNCE; wall = true; }
        // 空中撞牆:反彈後 z 快落不懸空(落地重置引信;彈回的小速度=往回掉一小段)
        if (wall && air && b.dropT0 < 0) { b.dropZ0 = b.z; b.dropT0 = game.time; b.flyT0 = -9; b.landed = true; }
        b.x = clamp(b.x, b.r, W - b.r); b.y = clamp(b.y, b.r, H - b.r);
        if (!air) {
          const k = Math.pow(BARREL_FRICTION, dt); b.vx *= k; b.vy *= k;
          if (b.vx * b.vx + b.vy * b.vy < 400) { b.vx = 0; b.vy = 0; }
        }
      }
      if (!b.landed && game.time - b.flyT0 >= BARREL_LOB.T) {          // 彈道自然落地幀:剩餘速度 ×LAND_SKID=滾動收尾 + 重置引信 + 塵土
        b.landed = true; b.z = 0;
        b.vx *= LAND_SKID; b.vy *= LAND_SKID;
        if (b.state === 'fuse') b.fuse = BARREL_LAND_FUSE;             // 落地閃 LAND_FUSE 秒才爆(統一心智模型;丟空落地不再看殘餘引信)
        addRing(b.x, b.y, 22, '#cbb9a2', 0.28, 3); game.sfx.push('thud');
      }
      for (const f of fighters) {                                      // 碰到人:丟出中的活桶→兩拍(砸中→墜地→爆);否則推開
        if (f.state !== 'alive' || f.carryObj === b || f.invuln > 0) continue;
        const dx = b.x - f.x, dy = b.y - f.y, d = Math.hypot(dx, dy) || 1;
        if (d > f.r + b.r) continue;
        if (b.state === 'fuse' && (b.vx || b.vy) && b.armGrace <= 0 && f.pid !== b.thrownBy) {
          if (air && b.dropT0 < 0) {                                   // 空中砸中(任何高度都算——45° 視角讀不出弧高,規則綁看得見的碰撞):
            f.stability = Math.max(0, f.stability - BARREL_BONK_STAB); // 第一拍 bonk:小傷+踉蹌
            f.stabCd = 0.8; f.faceT = 0.3; f.lastHitBy = b.thrownBy; f.lastHitT = game.time;
            flinch(f, Math.atan2(dy, dx) + Math.PI, 0.26);
            addText(f.x, f.y - 34, '砸中!', barrelChargeColor(b.charge)); game.sfx.push('thud'); addShake(3);
            b.vx = 0; b.vy = 0;                                        // 桶停在被砸者頭上 → 垂直快落 → 落地閃 LAND_FUSE 秒才爆(反制窗口)
            b.dropZ0 = b.z; b.dropT0 = game.time; b.flyT0 = -9; b.landed = true;
          } else if (!air) explodeBarrel(b);                           // 地面滾動撞人:直接爆(原行為)
          break;
        }
        if (air) continue;                                             // 空中不推不擋
        b.vx += dx / d * BARREL_PUSH; b.vy += dy / d * BARREL_PUSH;    // 走進 idle 桶 → 推開
        b.x = f.x + dx / d * (f.r + b.r); b.y = f.y + dy / d * (f.r + b.r);
      }
      if (!b.alive) continue;                                          // 上面撞擊引爆了
    }
    if (b.state === 'idle') { if (!b.held) b.charge = floorChargeUnder(b); } // idle:吸收腳下元素(扛在手上不吸,保留原 charge)
    else if (b.state === 'fuse') { b.fuse -= dt; if (b.fuse <= 0) explodeBarrel(b); } // 升壓到底 → 爆(扛在手上也會炸=在手上爆)
  }
}

// --- 危險 #2:四角元素站 (§10)。輪流噴發:預警 3s → 徑向脈衝+小削穩 + 殘留元素地板(雷=電擊擊暈無地板)。---
function eruptStation(s) {
  s.state = 'idle';
  const col = elemColor(s.elem), light = s.elem === 'lightning';
  addRing(s.x, s.y, ERUPT_PATCH_R * 1.25, col, 0.45, 7); addRing(s.x, s.y, ERUPT_PATCH_R * 0.55, '#ffffff', 0.3, 4);
  hitSpark(s.x, s.y, col, 2.2); addShake(6); addHitstop(0.05); game.sfx.push('explosion');
  if (!light) stampElement(s.x, s.y, ERUPT_PATCH_R, s.elem);        // 殘留:火/冰/毒 種地板(雷=raw arc 無地板)
  for (const f of fighters) {
    if (f.state !== 'alive' || f.invuln > 0) continue;
    const dx = f.x - s.x, dy = f.y - s.y, d = Math.hypot(dx, dy);
    if (d > ERUPT_PATCH_R + f.r) continue;
    const a = Math.atan2(dy, dx) || 0;
    f.vx += Math.cos(a) * ERUPT_PULSE; f.vy += Math.sin(a) * ERUPT_PULSE; // 徑向脈衝(角落→往中央≈送進艙)
    f.stability = Math.max(0, f.stability - ERUPT_STAB); f.stabCd = 0.6; f.lastHitBy = -5; f.lastHitT = game.time; // -5 = 元素站
    flinch(f, a, 0.3);
    if (light && !f.stunned && f.restunT <= 0) stunFighter(f);       // 雷=電擊擊暈
    else if (f.stability <= 0 && !f.stunned && f.restunT <= 0) stunFighter(f);
    if (f.pid === LOCAL) v2s.localFlash = 0.3;
  }
  dlog('ERUPT', s.elem, '@', s.x + ',' + s.y);
}
export function updateStations(dt) {
  if (!v2s.stationsArmed) return;                                    // 總開關(B 刀);A 刀 always-on
  let warning = false;
  for (const s of stations) { if (s.state === 'warn') { warning = true; s.warnT -= dt; if (s.warnT <= 0) eruptStation(s); } }
  if (warning) return;                                               // 一次只有一個站在跑
  v2s.stationTimer -= dt;
  if (v2s.stationTimer <= 0) {                                       // 輪替:隨機挑一個(不重複上一個)開始預警
    const pool = stations.map((s, i) => i).filter(i => i !== v2s.lastStationIdx);
    const idx = pool[Math.floor(Math.random() * pool.length)];
    stations[idx].state = 'warn'; stations[idx].warnT = STATION_WARN;
    v2s.lastStationIdx = idx; v2s.stationTimer = v2s.stationIntervalCur;
    addText(stations[idx].x, stations[idx].y - 30, '洩漏警告！', elemColor(stations[idx].elem)); game.sfx.push('dash');
  }
}
