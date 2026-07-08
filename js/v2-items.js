// v2 道具與危險物 (spec F §3/§4;docs/v2-module-boundaries.md §3):
// 補給座撿取、風壓手套/傳送符/冰霜瓶三道具、爆桶點燃→爆炸。
// 新法術/道具的 cast 加在這裡;數值常數與資料表進 v2-state.js;報告欄位進 inc + v2-report.js。
import { W, H } from './constants.js';
import { clamp } from './utils.js';
import { game } from './state.js';
import { addShake, addHitstop, addRing, hitSpark, addText } from './fx.js';
import {
  v2s, fighters, LOCAL, dlog, NAMES, inc,
  pads, iceZones, randItem, ITEM_INFO, ITEM_SPEC, ITEM_CAST_RECOVER, PICKUP_R,
  WIND_RANGE, WIND_CONE, WIND_FORCE, WIND_SELF, TP_BLINK, TP_JITTER, ICE_R, ICE_DUR, ICE_THROW,
  barrels, BARREL_IGNITE, BARREL_BLAST, BARREL_FORCE, BARREL_STAB,
  FUMBLE_T, REGRAB_CD,
} from './v2-state.js';
import { flinch, camKick, dropCarry, stunFighter } from './v2-combat.js';
import { stampElement } from './v2-floor.js';

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
export function updateIce(dt) { for (let i = iceZones.length - 1; i >= 0; i--) { iceZones[i].life -= dt; if (iceZones[i].life <= 0) iceZones.splice(i, 1); } }
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
export function castWind(f) { // 前方風錐強擊退; 貼臉發射自身反彈(過載)
  const a = f.facing; let hit = false;
  for (const o of fighters) {
    if (o === f || o.state !== 'alive' || o.carriedBy || o.invuln > 0) continue;
    const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy);
    if (d > WIND_RANGE) continue;
    let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > WIND_CONE) continue;
    hit = true;
    o.vx += Math.cos(a) * WIND_FORCE; o.vy += Math.sin(a) * WIND_FORCE;
    o.faceT = 0.3; o.hurt = 0.1; o.lastHitBy = f.pid; o.lastHitT = game.time;
    flinch(o, a, 0.3); camKick(a, 6);
    if (o.carrying) dropCarry(o);                                            // 吹中搬運者 → 鬆手
    hitSpark(o.x, o.y, '#dff3ff', 1.3); addRing(o.x, o.y, 32, '#dff3ff', 0.3, 4); addText(o.x, o.y - 26, '吹飛！', '#dff3ff');
    if (o.pid === LOCAL) v2s.localFlash = 0.25;
    if (d < 50) { f.vx -= Math.cos(a) * WIND_SELF; f.vy -= Math.sin(a) * WIND_SELF; inc.itemBackfires++; addText(f.x, f.y - 32, '過載反彈！', '#ff9a9a'); } // 風壓過載自反噬
  }
  addRing(f.x + Math.cos(a) * 30, f.y + Math.sin(a) * 30, 62, '#dff3ff', 0.25, 5); addShake(hit ? 5 : 3); game.sfx.push('dash');
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
export function castIce(f) { // 前方丟出 → 地板冰面(cut 3:走地板化學 applyElement,格化、吃衰退、可被火熄成水)
  const lx = clamp(f.x + Math.cos(f.facing) * ICE_THROW, 24, W - 24), ly = clamp(f.y + Math.sin(f.facing) * ICE_THROW, 24, H - 24);
  const n = stampElement(lx, ly, ICE_R, 'ice'); // 舊 iceZones 圓區退場(onSlipperyIce 仍相容);視覺待 cut 4 動態 tile
  addRing(lx, ly, ICE_R, ITEM_INFO.ice.color, 0.4, 5); addText(lx, ly - 20, '冰面！', ITEM_INFO.ice.color); game.sfx.push('dash');
  dlog('ICE @', Math.round(lx) + ',' + Math.round(ly), 'tiles', n);
}

// --- 危險 #1:爆桶。靠近→點燃→爆炸:炸飛+削弱穩定值 ---
export function explodeBarrel(b) {
  b.alive = false; b.respawn = v2s.barrelRespawnCur; inc.barrelBooms++; inc.types.add('barrel');
  addRing(b.x, b.y, BARREL_BLAST, '#ff9a4a', 0.4, 6); addRing(b.x, b.y, BARREL_BLAST * 0.6, '#fff1bb', 0.3, 5);
  hitSpark(b.x, b.y, '#ffd36d', 2); addShake(8); addHitstop(0.1); game.sfx.push('explosion');
  addText(b.x, b.y - 30, '爆！', '#ff7b72');
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
  dlog('BARREL boom @', Math.round(b.x) + ',' + Math.round(b.y));
}
export function updateBarrels(dt) {
  for (const b of barrels) {
    if (!b.alive) { b.respawn -= dt; if (b.respawn <= 0) { b.alive = true; b.state = 'idle'; } continue; }
    if (b.state === 'idle') {
      for (const f of fighters) { if (f.state === 'alive' && Math.hypot(f.x - b.x, f.y - b.y) < BARREL_IGNITE + f.r) { b.state = 'fuse'; b.fuse = v2s.barrelFuseCur; addText(b.x, b.y - 26, '!', '#ffd36d'); game.sfx.push('dash'); break; } }
    } else if (b.state === 'fuse') { b.fuse -= dt; if (b.fuse <= 0) explodeBarrel(b); }
  }
}
