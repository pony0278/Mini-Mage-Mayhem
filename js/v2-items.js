// v2 道具與危險物 (spec F §3/§4;docs/v2-module-boundaries.md §3):
// 裝備類道具(風壓手套/傳送符/噴火帽,補給座手動撿)、投擲瓶(冰/油=場上物件,撿了丟)、爆桶點燃→爆炸。
// 新法術/道具的 cast 加在這裡;數值常數與資料表進 v2-state.js;報告欄位進 inc + v2-report.js。
import { W, H, TILE } from './constants.js';
import { clamp } from './utils.js';
import { game } from './state.js';
import { addShake, addHitstop, addRing, hitSpark, addText, addWindFan, addBolt } from './fx.js';
import {
  v2s, fighters, LOCAL, dlog, NAMES, inc, COLORS, POD, inPod,
  GARBAGE_ELEMS, GARBAGE_NAME, randGarbage, bottleRespawnT,
  pads, randItem, ITEM_INFO, ITEM_SPEC, ITEM_CAST_RECOVER, PICKUP_R, groundItems, GROUND_ITEM_TTL,
  WIND_RANGE, WIND_CONE, WIND_FORCE, WIND_TUMBLE_MIN, WIND_TUMBLE_JITTER, WIND_TUMBLE_LOB, WIND_CARRY_LOB, TP_BLINK, TP_JITTER, ICE_R, OIL_R,
  FIRE_RANGE, FIRE_CONE, FIRE_HIT_STAB, FIRE_BURN_T,
  WATER_SLAM_DIST, WATER_R, WATER_KNOCK, WATER_STAB,
  LIGHTNING_RANGE, LIGHTNING_WIDTH, LIGHTNING_KNOCK,
  bottles, BOTTLE_LOB, BOTTLE_BREAK_V,
  barrels, BARREL_BLAST, BARREL_FORCE, BARREL_STAB, BARREL_PATCH_R, WILD_CONTAM,
  BARREL_FRICTION, BARREL_PUSH, BARREL_ARM_GRACE, BARREL_THROW_DELAY, GRAB_RANGE,
  BARREL_LOB, BARREL_BONK_STAB, BARREL_DROP_T, BARREL_LAND_FUSE, BARREL_WALL_HOP, LAND_SKID, WALL_BOUNCE, lobZ,
  stations, STATION_WARN, ERUPT_PATCH_R, ERUPT_PULSE, ERUPT_STAB,
  FUMBLE_T, REGRAB_CD,
} from './v2-state.js';
import { flinch, camKick, dropCarry, stunFighter, freezeFighter, inThrowFlight } from './v2-combat.js';
import { CLIPS } from './brawler-clips.js';
import { stampElement, applyElement, stateAt, stateAtPixel, FL } from './v2-floor.js';
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
export function updatePads(dt) { // 補給座只管重刷(撿取改手動,見 pickupItem);掉落物 TTL 另在 updateGroundItems
  for (const p of pads) if (!p.item) { p.respawn -= dt; if (p.respawn <= 0) p.item = randItem(); }
}
export function updateGroundItems(dt) { // 地上掉落道具:TTL 倒數,到期自然消失
  for (let i = groundItems.length - 1; i >= 0; i--) { const g = groundItems[i]; g.ttl -= dt; if (g.ttl <= 0) { addRing(g.x, g.y, 20, ITEM_INFO[g.type].color, 0.3, 3); groundItems.splice(i, 1); } }
}
// 被暈時道具噴到地上(逃脫類 whileDisabled=傳送 不掉,否則被暈就永遠逃不了)。誰先撿到誰的=收容前的搶奪戰。
export function dropLooseItem(f) {
  if (!f.item || ITEM_SPEC[f.item].whileDisabled) return;
  groundItems.push({ x: f.x, y: f.y, type: f.item, uses: f.itemUses, ttl: GROUND_ITEM_TTL });
  addText(f.x, f.y - 22, ITEM_INFO[f.item].name + ' 掉了！', ITEM_INFO[f.item].color); addRing(f.x, f.y, 26, ITEM_INFO[f.item].color, 0.3, 4); game.sfx.push('thud');
  dlog('DROP', NAMES[f.pid], f.item); f.item = null; f.itemUses = 0;
}
// 手動撿(補給座 or 地上掉落):空手可動才撿;優先近的補給座、再地上掉落物。回傳 true=撿到(供 mouseRight 分派)。
export function pickupItem(f) {
  if (f.item || f.state !== 'alive' || f.carrying || f.carryObj || f.stunned || f.carriedBy || f.fumbleT > 0) return false;
  const take = (type, uses, fx, fy) => { f.item = type; f.itemUses = uses; f._lastItem = type; addText(f.x, f.y - 32, ITEM_INFO[type].name + '！', ITEM_INFO[type].color); addRing(f.x, f.y, 28, ITEM_INFO[type].color, 0.3, 4); game.sfx.push('upgrade'); dlog('PICKUP', NAMES[f.pid], type); };
  for (const p of pads) if (p.item && Math.hypot(f.x - p.x, f.y - p.y) < PICKUP_R + f.r) { take(p.item, ITEM_SPEC[p.item].uses); p.item = null; p.respawn = v2s.padRespawnCur; return true; }
  for (let i = 0; i < groundItems.length; i++) { const g = groundItems[i]; if (Math.hypot(f.x - g.x, f.y - g.y) < PICKUP_R + f.r) { take(g.type, g.uses); groundItems.splice(i, 1); return true; } }
  return false;
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
  f._recoverT = 0;                                                          // 接道具=取消出拳收招承諾(施法可轉向瞄準;挑飛→風壓接送要在收招窗內瞄)
  f._itemCastAt = game.time + spec.delay; f._itemCastType = type;
  f.itemCastCd = spec.delay + ITEM_CAST_RECOVER;
}
function castItem(type, f) {
  if (type === 'wind') castWind(f);
  else if (type === 'teleport') castTeleport(f);
  else if (type === 'fire') castFire(f);
  else if (type === 'water') castWater(f);
  else if (type === 'lightning') castLightning(f);
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
    const airborne = o.z > 1 || inThrowFlight(o);                           // 已騰空(挑飛/跳/翻滾中)? → 乾淨接送
    if (airborne) {                                                          // brawl-3 空中接送:往瞄準方向直送(不 scatter/不墊穩定)=一路吹進艙、無落地反擊
      o.vx = w.ux * w.force; o.vy = w.uy * w.force;                          // 用原始方向(不亂),精準送進艙口
      o._lob = WIND_CARRY_LOB; o._thrownT = game.time; o.fumbleT = WIND_CARRY_LOB.T + 0.1;
      o._jumpT = -9; o._diveT0 = -9;                                         // 接管彈道(覆蓋跳/挑飛殘值)
      addText(o.x, o.y - 30, '吹進去！', '#9ee6ff');
    } else if (w.force > WIND_TUMBLE_MIN && !o.stunned) {                    // 地面強命中(近中心)→ 吹翻滾:接拋飛管線=趴滾+爬起(非直立滑行)
      o.vx = bx * w.force; o.vy = by * w.force;
      o._lob = WIND_TUMBLE_LOB; o._thrownT = game.time; o.fumbleT = WIND_TUMBLE_LOB.T + 0.1;
      o.stability = Math.max(o.stability, 25);                              // 落地不至於原地再被暈(地面吹飛防站樁鎖;空中接送刻意不墊)
      addText(o.x, o.y - 30, '吹翻！', '#dff3ff');
    } else {                                                                // 弱(邊緣/遠)→ 只吹歪踉蹌
      o.vx += bx * w.force; o.vy += by * w.force;
      flinch(o, Math.atan2(by, bx), 0.3); addText(o.x, o.y - 26, '吹飛！', '#dff3ff');
    }
    camKick(a, 6); hitSpark(o.x, o.y, '#dff3ff', 1.3); addRing(o.x, o.y, 32, '#dff3ff', 0.3, 4);
    if (o.pid === LOCAL) v2s.localFlash = 0.25;
  }
  for (const t of bottles) { // 吹瓶:飛行中=整支甩回放射方向(風剋冰投,改歸風方=命中原主凍原主);地上=吹走(夠快→砸牆/砸人碎)
    if (!t.alive || t.held) continue;
    const w = windBlast(f, a, t.x, t.y); if (!w) continue;
    if (!t.landed) {                                                           // 飛行瓶 → 反彈(判 landed 旗,不判 t.z:z 是 updateBottles 每幀重算的快取,同幀內剛出手的瓶還是舊值 0 → 誤走地上分支=方向被亂數擾動吹歪)
      const spd = Math.hypot(t.vx, t.vy) || (BOTTLE_LOB.range / BOTTLE_LOB.T);
      t.vx = w.ux * spd; t.vy = w.uy * spd;
      t.flyT0 = game.time;                                                     // 重啟拋物弧(從當前位置起新的一段)
      addText(t.x, t.y - 22, '反彈！', '#dff3ff'); addRing(t.x, t.y, 30, '#dff3ff', 0.32, 5);
    } else {                                                                   // 地上瓶 → 放射狀+亂數擾動(分強弱,對齊風對人:近中心強命中=擊飛拋射、邊緣弱命中=地面吹滑)
      const [bx, by] = windScatter(w.ux, w.uy);
      if (w.force > WIND_TUMBLE_MIN) {                                         // 強(近中心)→ 擊飛進拋物弧:飛到下風落地碎(空中砸中人=冰凍/油潑膜),風多一條投送路徑
        t.vx = bx * w.force; t.vy = by * w.force;
        t.flyT0 = game.time; t.landed = false;                                 // updateBottles 走 BOTTLE_LOB 弧 → 自然落地/砸中/撞牆即碎
        addText(t.x, t.y - 22, '吹飛！', '#dff3ff');
      } else {                                                                 // 弱(邊緣/遠)→ 地面吹滑(滑撞牆/人夠快才碎;不夠快=換位不碎)
        t.vx += bx * w.force * 1.4; t.vy += by * w.force * 1.4;
      }
    }
    t.thrownBy = f.pid;                                                        // 改歸風施放者(碎裂凍人/計功歸風方)
    hit = true; hitSpark(t.x, t.y, '#dff3ff', 1.3);
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
// 噴火帽=貼臉短扇形(使用者反饋 2026-07):採風壓扇形判定但射程極短。噴火**不留地形火**——
// 只作用扇內既有的反應性地板:油→R1 火海、冰→R4b 融成水(乾淨/其他一律不 stamp=無殘留),
// 地形燃燒專屬「油+火」連段;直擊錐內目標=著火 DoT(floorHazards 續燒→歸零暈)+ 即時 flinch。
export function castFire(f) {
  const a = f.facing; let hit = false;
  const inCone = (x, y, pad) => {                                            // 扇內判定(prop 用;地板格另有逐格版)
    const dx = x - f.x, dy = y - f.y, d = Math.hypot(dx, dy);
    if (d > FIRE_RANGE + pad) return false;
    let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    return Math.abs(da) <= FIRE_CONE;
  };
  // 引爆 prop(玩家反饋 2026-07:拿火帽想引爆瓶/桶,右鍵卻變舉瓶——引爆本身也缺)。瓶**先**碎:
  // 油瓶潑出的油膜緊接著被下面的地板掃描同一發點燃=瞬間火海;冰瓶碎出的冰面同發融成水。桶=升壓(同揍桶)。
  for (const t of bottles) if (t.alive && !t.held && t.landed && inCone(t.x, t.y, t.r)) { shatterBottle(t); hit = true; }
  for (const b of barrels) if (b.alive && b.state === 'idle' && inCone(b.x, b.y, b.r)) { pressurizeBarrel(b); hit = true; }
  // 只作用扇內既有的油/冰格(逐格 applyElement:油→火海、冰→水;乾淨地板噴過去只有火光=無殘留)
  const t0x = Math.floor((f.x - FIRE_RANGE) / TILE), t1x = Math.floor((f.x + FIRE_RANGE) / TILE);
  const t0y = Math.floor((f.y - FIRE_RANGE) / TILE), t1y = Math.floor((f.y + FIRE_RANGE) / TILE);
  for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) {
    const st = stateAt(tx, ty);
    if (st !== FL.OIL && st !== FL.ICE) continue;                          // 只碰反應性地板(油=點燃、冰=融水);乾淨/水/毒 不動
    const cx = tx * TILE + TILE / 2, cy = ty * TILE + TILE / 2;
    const dx = cx - f.x, dy = cy - f.y, d = Math.hypot(dx, dy);
    if (d > FIRE_RANGE) continue;
    let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > FIRE_CONE) continue;
    applyElement(tx, ty, 'fire');                                          // oil→FIRE(R1 沿油擴散)、ice→WATER(R4b 融冰)
    hit = true;
  }
  for (const o of fighters) {                                              // 扇內對手:命中即扣 + 著火 DoT(floorHazards 續燒→歸零暈)
    if (o === f || o.state !== 'alive' || o.carriedBy || o.invuln > 0) continue;
    const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy);
    if (d > FIRE_RANGE + o.r) continue;
    let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > FIRE_CONE) continue;
    hit = true;
    o.stability = Math.max(0, o.stability - FIRE_HIT_STAB); o.stabCd = 0.8; o.hurt = 0.12; o.faceT = 0.3; o.lastHitBy = f.pid; o.lastHitT = game.time;
    o.burnT = FIRE_BURN_T; o.burnBy = f.pid;                               // 著火:短時持續燒(floorHazards 削穩定+身上火粒子)
    flinch(o, a, 0.26);
    addText(o.x, o.y - 34, '著火！', '#ff7a3a'); hitSpark(o.x, o.y, '#ffb04a', 1.5);
    if (o.stability <= 0 && !o.stunned && o.restunT <= 0) stunFighter(o);
    if (o.pid === LOCAL) v2s.localFlash = 0.25;
  }
  // 噴口火焰粒子(短射程扇形:噴慢一點、活短一點,約扇長內散開)
  const mx = f.x + Math.cos(a) * (f.r + 6), my = f.y + Math.sin(a) * (f.r + 6);
  for (let i = 0; i < 16; i++) {
    const ang = a + (Math.random() * 2 - 1) * FIRE_CONE, sp = 120 + Math.random() * 200;
    game.particles.push({ x: mx, y: my, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 2 + Math.random() * 3, life: 0.16 + Math.random() * 0.2, maxLife: 0.36, color: Math.random() < 0.5 ? '#ff7a3a' : '#ffce6a' });
  }
  camKick(a, 6); addShake(hit ? 6 : 3); game.sfx.push('dash');
  dlog('FIRE spray by', NAMES[f.pid], hit ? 'hit' : 'miss');
}
// 工業重錘=前方砸壓 AoE(原「盾」改造):面前 SLAM_DIST 落點 → 圓形範圍造濕地(接雷=R2 電水)+
// 砸中對手=短擊倒(好抓送進艙)+ 徑向擊退。起手預告畫圓圈(v2.js marks)教落點/範圍。
export function castWater(f) {
  const a = f.facing;
  const sx = f.x + Math.cos(a) * WATER_SLAM_DIST, sy = f.y + Math.sin(a) * WATER_SLAM_DIST; // 落點=面前
  // 砸壓 prop(玩家反饋:近距離道具要能引爆桶/瓶):瓶先砸碎(潑出的元素隨後被水蓋掉=大水撲滅),桶=受擊升壓
  for (const t of bottles) if (t.alive && !t.held && t.landed && Math.hypot(t.x - sx, t.y - sy) <= WATER_R + t.r) shatterBottle(t);
  for (const b of barrels) if (b.alive && b.state === 'idle' && Math.hypot(b.x - sx, b.y - sy) <= WATER_R + b.r) pressurizeBarrel(b);
  stampElement(sx, sy, WATER_R, 'water');                                   // 造濕地(水覆蓋油/冰=底料取代;接雷 R2 電水)
  addRing(sx, sy, WATER_R, '#4da6ff', 0.4, 6); addRing(sx, sy, WATER_R * 0.6, '#bfe6ff', 0.32, 5);
  hitSpark(sx, sy, '#8fd0ff', 2.2); addShake(8); addHitstop(0.08); game.sfx.push('explosion');
  let hit = false;
  for (const o of fighters) {                                               // 砸中範圍內對手:短擊倒(好抓)+ 徑向擊退 + 削穩定
    if (o === f || o.state !== 'alive' || o.carriedBy || o.invuln > 0) continue;
    const dx = o.x - sx, dy = o.y - sy, d = Math.hypot(dx, dy);
    if (d > WATER_R + o.r) continue;
    hit = true;
    const ka = Math.atan2(dy, dx) || 0;                                     // 從砸點往外
    o.vx += Math.cos(ka) * WATER_KNOCK; o.vy += Math.sin(ka) * WATER_KNOCK;
    o.stability = Math.max(0, o.stability - WATER_STAB); o.stabCd = 0.8; o.hurt = 0.14; o.faceT = 0.4; o.lastHitBy = f.pid; o.lastHitT = game.time;
    if (o.carrying) dropCarry(o);                                           // 砸中搬運者 → 鬆手
    if (!o.stunned && o.restunT <= 0) stunFighter(o);                       // 砸壓定位=直接短擊倒(元素穿防,同其他 item cast)
    flinch(o, ka, 0.3);
    addText(o.x, o.y - 34, '砸暈！', '#8fd0ff');
    if (o.pid === LOCAL) v2s.localFlash = 0.3;
  }
  for (let i = 0; i < 16; i++) {                                            // 水花粒子(徑向濺開)
    const ang = Math.random() * Math.PI * 2, sp = 80 + Math.random() * 220;
    game.particles.push({ x: sx, y: sy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 2 + Math.random() * 3, life: 0.2 + Math.random() * 0.24, maxLife: 0.44, color: Math.random() < 0.5 ? '#4da6ff' : '#bfe6ff' });
  }
  camKick(a, 8);
  dlog('WATER slam by', NAMES[f.pid], hit ? 'hit' : 'miss');
}
// 魔導電鞭=直線電擊(使用者 2026-07:攻擊範圍只能直線)。沿面向一條窄長線:
// 命中線內對手=電擊擊暈(元素穿防)+ 小擊退;沿線給水地板充電(R2 水→電水;乾地/其他 no-op=留下電水陷阱)。
export function castLightning(f) {
  const a = f.facing, ca = Math.cos(a), sa = Math.sin(a); let hit = false;
  const onLine = (x, y, pad) => {                                            // 直線判定(prop 用;同對手命中那把尺)
    const dx = x - f.x, dy = y - f.y, along = dx * ca + dy * sa;
    if (along < 0 || along > LIGHTNING_RANGE) return false;
    return Math.abs(-dx * sa + dy * ca) <= LIGHTNING_WIDTH + pad;
  };
  // 引爆 prop(玩家反饋:道具要能引爆桶/瓶):線上瓶=電得碎裂、桶=受擊升壓
  for (const t of bottles) if (t.alive && !t.held && t.landed && onLine(t.x, t.y, t.r)) { shatterBottle(t); hit = true; }
  for (const b of barrels) if (b.alive && b.state === 'idle' && onLine(b.x, b.y, b.r)) { pressurizeBarrel(b); hit = true; }
  // 沿線逐 tile 給水充電(applyElement:水→charged、非水 no-op;不誤觸乾淨地板)
  const steps = Math.ceil(LIGHTNING_RANGE / (TILE * 0.5)), seen = new Set();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, px = f.x + ca * LIGHTNING_RANGE * t, py = f.y + sa * LIGHTNING_RANGE * t;
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE), key = tx + ',' + ty;
    if (seen.has(key)) continue; seen.add(key);
    applyElement(tx, ty, 'lightning');
  }
  for (const o of fighters) {                                               // 命中線內對手:電擊擊暈 + 沿線小擊退
    if (o === f || o.state !== 'alive' || o.carriedBy || o.invuln > 0) continue;
    const dx = o.x - f.x, dy = o.y - f.y;
    const along = dx * ca + dy * sa;                                        // 沿線投影(0..RANGE 才在線上)
    if (along < 0 || along > LIGHTNING_RANGE) continue;
    const perp = Math.abs(-dx * sa + dy * ca);                             // 垂直距離(窄=直線)
    if (perp > LIGHTNING_WIDTH + o.r) continue;
    hit = true;
    o.vx += ca * LIGHTNING_KNOCK; o.vy += sa * LIGHTNING_KNOCK;
    o.stabCd = 0.8; o.hurt = 0.14; o.faceT = 0.4; o.lastHitBy = f.pid; o.lastHitT = game.time;
    if (o.carrying) dropCarry(o);
    if (!o.stunned && o.restunT <= 0) stunFighter(o);                       // 電擊=直接擊暈(同元素站雷;元素穿防)
    flinch(o, a, 0.28);
    addText(o.x, o.y - 34, '電擊！', '#9fd0ff'); hitSpark(o.x, o.y, '#dff3ff', 1.8);
    if (o.pid === LOCAL) v2s.localFlash = 0.3;
  }
  addBolt(f.x, f.y, a, LIGHTNING_RANGE);                                    // 直線電擊亮束(render-entities)
  const ex = f.x + ca * LIGHTNING_RANGE, ey = f.y + sa * LIGHTNING_RANGE;   // 線末端爆點
  hitSpark(ex, ey, '#dff3ff', 1.6); addRing(ex, ey, 22, '#9fd0ff', 0.3, 5);
  for (let i = 0; i < 14; i++) {                                            // 沿線電火花粒子
    const t = Math.random(), px = f.x + ca * LIGHTNING_RANGE * t, py = f.y + sa * LIGHTNING_RANGE * t;
    const ang = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160;
    game.particles.push({ x: px, y: py, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 1.4 + Math.random() * 2.2, life: 0.14 + Math.random() * 0.18, maxLife: 0.32, color: Math.random() < 0.5 ? '#9fd0ff' : '#eaffff' });
  }
  camKick(a, 7); addShake(hit ? 7 : 4); game.sfx.push('dash');
  dlog('LIGHTNING bolt by', NAMES[f.pid], hit ? 'hit' : 'miss');
}
// --- 投擲瓶=場上物件(朋友反饋定案:投擲類全走爆桶動詞——撿了丟、一次性、高頻刷新)。
// 物理共用桶語言(carryObj 撿丟/風吹/翻滾);瓶=脆:丟出落地/硬撞牆/硬撞人/被拳打(_smash)/被爆炸波及 全都碎。
// 碎裂=蓋元素地板(冰面/油膜);冰瓶硬砸中人=直擊冰凍(hitFighter,歸因 thrownBy)。
export function shatterBottle(t, hitFighter) {
  if (!t.alive) return;
  t.alive = false; t.respawn = bottleRespawnT(); t.held = false; t._smash = false;
  for (const f of fighters) if (f.carryObj === t) { f.carryObj = null; f._barrelThrowAt = 0; } // 在手上碎(爆炸波及)→ 放開持有者
  const col = elemColor(t.elem), r = t.elem === 'oil' ? OIL_R : ICE_R;
  const n = stampElement(t.x, t.y, r, t.elem);                        // 火/冰/毒/油=種地板;雷乾地無地板(下面 raw arc 補)
  addRing(t.x, t.y, r, col, 0.4, 5); hitSpark(t.x, t.y, col, 1.4);
  addText(t.x, t.y - 20, '碎裂！', col); game.sfx.push('thud');
  if (hitFighter && t.elem === 'ice') freezeFighter(hitFighter, t.thrownBy); // 直擊冰凍(任何高度碰到都算,同舊瓶規則)
  if (t.elem === 'lightning') {                                       // 帶電零件=raw arc(雷無地板):範圍電擊擊暈(同元素站雷)
    for (const f of fighters) {
      if (f.state !== 'alive' || f.invuln > 0 || f.pid === t.thrownBy) continue;
      if (Math.hypot(f.x - t.x, f.y - t.y) > r + f.r) continue;
      if (!f.stunned && f.restunT <= 0) { f.lastHitBy = t.thrownBy; stunFighter(f); addText(f.x, f.y - 44, '電擊！', '#bfe6ff'); }
    }
  }
  dlog('BOTTLE', t.elem, 'shatter @', Math.round(t.x) + ',' + Math.round(t.y), 'tiles', n);
}
// 爽鬥版:中央回收口對「瓶」只是銷毀口(丟進去=清掉+respawn;道具經濟走補給座)。
// 序列制分類/清運經濟已隨 B 款(分類遊戲)凍結於 commit 4c92837——docs/game-split.md。
function recycleGarbage(t) {
  t.alive = false; t.held = false; t.vx = 0; t.vy = 0; t.z = 0; t.respawn = bottleRespawnT();
  addRing(POD.x, POD.y, POD.r * 1.2, '#4dffcf', 0.35, 4); game.sfx.push('upgrade');
  addText(POD.x, POD.y - 40, '♻ 已清運', '#9affd0');
  dlog('BOTTLE recycled', t.elem);
}
export function updateBottles(dt) {
  for (const t of bottles) {
    if (!t.alive) { t.respawn -= dt; if (t.respawn <= 0) { t.alive = true; t.elem = randGarbage(t.elem); t.x = t.x0; t.y = t.y0; t.vx = 0; t.vy = 0; t.thrownBy = -1; t.flyT0 = -9; t.landed = true; t.z = 0; t.roll = 0; addRing(t.x, t.y, 18, elemColor(t.elem), 0.3, 4); } continue; }
    if (t._smash) { shatterBottle(t); continue; }                    // 被拳打碎(v2-combat 只立旗,免 DAG 反向 import)
    if (t.held) continue;                                            // 被扛的瓶由 carry loop 定位
    if (t.z <= 2 && inPod(t.x, t.y)) { recycleGarbage(t); continue; } // Route A:落進回收口 = 清運(優先於碎裂;丟得進去才算,空中飛越不算)
    t.z = lobZ(game.time - t.flyT0, BOTTLE_LOB);
    const air = t.z > 0, spd = Math.hypot(t.vx, t.vy);
    if (t.vx || t.vy) {
      const nx = t.x + t.vx * dt, ny = t.y + t.vy * dt;
      if (circleHitsSolid(nx, ny, t.r)) {                            // 撞牆:硬撞(飛行中/風吹滑行夠快)=碎;慢滑=停
        if (air || spd > BOTTLE_BREAK_V) { shatterBottle(t); continue; }
        t.vx = 0; t.vy = 0;
      } else { t.x = clamp(nx, t.r, W - t.r); t.y = clamp(ny, t.r, H - t.r); }
      if (!air) {
        const k = Math.pow(BARREL_FRICTION, dt); t.vx *= k; t.vy *= k; // 地面滑行=桶同款滾動摩擦
        if (t.vx * t.vx + t.vy * t.vy < 400) { t.vx = 0; t.vy = 0; }
      }
      t.roll += spd / Math.max(t.r, 1) * dt;                          // 翻滾角(render 繞運動法向軸)
    }
    // 碰到人(每幀都跑,對齊爆桶=場上物件一致可推):硬撞(丟出/風吹快滑/空中)=腳下碎+冰凍;靜止或慢滑=走動頂開
    for (const f of fighters) {
      if (f.state !== 'alive' || f.carryObj === t || f.invuln > 0) continue;
      const dx = t.x - f.x, dy = t.y - f.y, d = Math.hypot(dx, dy) || 1;
      if (d > f.r + t.r) continue;
      if ((air || spd > BOTTLE_BREAK_V) && f.pid !== t.thrownBy) { t.x = f.x; t.y = f.y; shatterBottle(t, f); break; } // 任何高度碰到都算(同舊直擊規則)
      // 走進靜止/慢瓶=頂開。**設定不疊加**(2026-07-20 修):舊 += 會在連續接觸幀疊速(130+130…>170 門檻)
      // → 跑著踢瓶兩三幀就「在自己腳下碎」還被冰凍——違反設計意圖「走路推不碎」。set=恆 130<170 永不碎;
      // 丟出/風吹的高速瓶(>170)在上一行就碎了,不會進到這裡=行為保留。
      if (!air) { t.vx = dx / d * BARREL_PUSH; t.vy = dy / d * BARREL_PUSH; t.x = f.x + dx / d * (f.r + t.r); t.y = f.y + dy / d * (f.r + t.r); }
    }
    if (!t.alive) continue;
    if (!t.landed && game.time - t.flyT0 >= BOTTLE_LOB.T) {          // 自然落地即碎(脆;桶=悶,落地閃 1s 才爆——材質對比)
      const over = game.time - t.flyT0 - BOTTLE_LOB.T;               // 回推跨幀過衝 → 落點=精確 range(同舊瓶管線)
      t.x = clamp(t.x - t.vx * over, t.r, W - t.r); t.y = clamp(t.y - t.vy * over, t.r, H - t.r);
      if (inPod(t.x, t.y)) recycleGarbage(t); else shatterBottle(t); // 落進回收口=清運(拋物線丟中艙),否則碎地(Route A vs 砸地)
    }
  }
}

// --- 危險 #1:爆桶。靠近→點燃→爆炸:炸飛+削弱穩定值 ---
// --- 步驟 B:桶可推 / 撿 / 丟(接 carry/throw §12.1)。桶非 fighter → 走 f.carryObj 平行結構,與扛人(carrying)互斥。 ---
export function grabbableBarrel(f) { // 範圍內最近的可撿投擲物(idle 桶/地上瓶——同一動詞:撿了丟)
  let best = null, bd = GRAB_RANGE + 20;
  const scan = (b, ok) => { if (!b.alive || b.held || !ok) return; const d = Math.hypot(b.x - f.x, b.y - f.y); if (d < bd + b.r) { bd = d; best = b; } };
  for (const b of barrels) scan(b, b.state === 'idle');
  for (const t of bottles) scan(t, t.z <= 0);   // 飛行中的瓶抓不到
  return best;
}
export function pickUpBarrel(f, b) { // 桶/瓶共用(kind:'bottle' 只差浮字顏色;動畫同一套雙手過頂)
  if (f.carrying || f.carryObj || !b || !b.alive || b.held) return;
  f._recoverT = 0; // 撿桶/瓶=主動接的新動詞,取消出拳收招承諾(不卡腳)
  f.carryObj = b; b.held = true; b.vx = 0; b.vy = 0; b.z = 0; b.flyT0 = -9; b.landed = true; b.dropT0 = -9;
  // 撿桶動畫(可選 clip:CLIPS 有 barrel_pickup 就播;桶從第 0 幀起貼在雙手中點,手往下撈→舉起=桶跟著走。
  // clip 播完落回程序 barrelHold 姿勢 → 結尾幀請對齊 barrel_throw 的 grab_hold 幀(= ANIM.barrelHold)才無縫)
  if (CLIPS.barrel_pickup) { f.itemFx = game.time; f.itemClip = 'barrel_pickup'; }
  const bottle = b.kind === 'bottle', col = bottle ? elemColor(b.elem) : barrelChargeColor(b.charge);
  addText(f.x, f.y - 30, bottle ? '抓起' + (GARBAGE_NAME[b.elem] || '廢料') + '！' : '抓起桶！', col); addRing(f.x, f.y, 30, col, 0.3, 4); game.sfx.push('upgrade'); // 瓶=垃圾元素(fire/ice/poison/lightning)→用 GARBAGE_NAME,不能查 ITEM_INFO(無 ice/poison 項→undefined.name 崩)
}
export function dropBarrel(f) {
  const b = f.carryObj; if (!b) return;
  b.held = false; f.carryObj = null; f._barrelThrowAt = 0; f.regrabCd = REGRAB_CD;
  b.x = f.x + Math.cos(f.facing) * (f.r + b.r + 4); b.y = f.y + Math.sin(f.facing) * (f.r + b.r + 4);
  b.vx = 0; b.vy = 0;
}
// 丟桶=排程動作:按下 → 播雙手過頂 heave clip、桶仍握在手(carry loop 定位)→ release 幀才 launchBarrel 甩出。
export function throwBarrel(f) { // 桶/瓶共用(同一顆 heave clip=同一條學習曲線)
  const b = f.carryObj; if (!b || f.state !== 'alive' || f._barrelThrowAt > 0) return; // 已在 heave 中 → 不重複
  f.itemFx = game.time; f.itemClip = 'barrel_throw';         // 播動畫(itemClip 頻道;free 時生效)
  f._barrelThrowAt = game.time + BARREL_THROW_DELAY;         // release 幀甩出(v2.js step 判定)
  const bottle = b.kind === 'bottle';
  game.sfx.push('dash'); addText(f.x, f.y - 32, bottle ? '舉瓶！' : '舉桶！', bottle ? elemColor(b.elem) : barrelChargeColor(b.charge));
}
// release 幀到:真的把桶/瓶甩出去。中途被打斷/掉了 → carryObj 沒了 → 取消。
export function launchBarrel(f) {
  f._barrelThrowAt = 0;
  const b = f.carryObj; if (!b || f.state !== 'alive') return;
  f.carryObj = null; b.held = false; f.regrabCd = REGRAB_CD;
  const a = f.facing, bottle = b.kind === 'bottle';
  b.x = f.x + Math.cos(a) * (f.r + b.r); b.y = f.y + Math.sin(a) * (f.r + b.r);
  const lob = bottle ? BOTTLE_LOB : BARREL_LOB;
  const F = lob.range / lob.T;                                // 出手當下現算(?tune=1/控制台改 LOB 即時生效)
  b.vx = Math.cos(a) * F; b.vy = Math.sin(a) * F;
  b.flyT0 = game.time; b.landed = false; b.thrownBy = f.pid;
  if (bottle) { addText(b.x, b.y - 26, '拋瓶！', elemColor(b.elem)); } // 瓶:落地/撞牆/砸人即碎(updateBottles)
  else {
    b.dropT0 = -9; b.armGrace = BARREL_ARM_GRACE;             // 桶:砸中人→快落引爆走 dropT0
    pressurizeBarrel(b);                                      // 被丟 → 升壓(1s 引信;飛行中/落地/撞人爆)
    addText(b.x, b.y - 26, '丟桶！', barrelChargeColor(b.charge));
  }
  addShake(4); game.sfx.push('dash');
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
  for (const t of bottles) if (t.alive && Math.hypot(t.x - b.x, t.y - b.y) <= BARREL_BLAST + t.r) shatterBottle(t); // 爆炸波及=瓶連環碎(在手上也碎,shatterBottle 放開持有者)
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
      if (b.hopT0 > 0) {                                               // 撞牆彈跳騰空:短跳弧(貼地起落),期間 air=true → 無摩擦滑翔+快速自旋(render fly)
        const hp = (game.time - b.hopT0) / BARREL_WALL_HOP.T;
        if (hp >= 1) { b.hopT0 = -9; addRing(b.x, b.y, 18, '#cbb9a2', 0.24, 3); }
        else b.z = Math.max(b.z, BARREL_WALL_HOP.apex * 4 * hp * (1 - hp));
      }
      const air = b.z > 0;
      if (b.vx || b.vy) {                                              // 推/丟:速度整合 + 牆碰撞;空中無摩擦=直線飛
        const spd0 = Math.hypot(b.vx, b.vy);                           // 撞牆前速度(反彈會×WALL_BOUNCE 衰減,騰空門檻看入射速)
        const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
        let wall = false;
        if (!circleHitsSolid(nx, b.y, b.r)) b.x = nx; else { b.vx = -b.vx * WALL_BOUNCE; wall = true; }   // 撞牆=小反彈(空中/滾動皆彈,不硬停)
        if (!circleHitsSolid(b.x, ny, b.r)) b.y = ny; else { b.vy = -b.vy * WALL_BOUNCE; wall = true; }
        // 空中撞牆:反彈後 z 快落不懸空(落地重置引信;彈回的小速度=往回掉一小段)
        if (wall && air && b.dropT0 < 0) { b.dropZ0 = b.z; b.dropT0 = game.time; b.flyT0 = -9; b.landed = true; }
        else if (wall && !air && b.hopT0 < 0 && spd0 > BARREL_WALL_HOP.min) { b.hopT0 = game.time; addRing(b.x, b.y, 20, '#dff3ff', 0.26, 4); game.sfx.push('thud'); } // 地面高速撞牆 → 彈起翻滾
        b.x = clamp(b.x, b.r, W - b.r); b.y = clamp(b.y, b.r, H - b.r);
        if (!air) {
          const k = Math.pow(BARREL_FRICTION, dt); b.vx *= k; b.vy *= k;
          if (b.vx * b.vx + b.vy * b.vy < 400) { b.vx = 0; b.vy = 0; }
        }
        b.roll += Math.hypot(b.vx, b.vy) / Math.max(b.r, 1) * dt;      // 翻滾角累積:滾動角速度=線速度/半徑(render 繞運動法向軸轉 b.roll)
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
