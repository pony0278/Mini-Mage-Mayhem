// v2 地板化學狀態機 (docs/v2-floor-state-architecture.md;設計見 v2-element-floor-chemistry.md)。
// 守 v2 DAG:只 import constants/utils/state/v2-state,**絕不** import sim.js / render / input。
// 鏡射單機 game.oils 的「計時覆蓋 + 到期 revert」模式,但「一格一狀態」(取代,不疊層)。
// 唯一注入入口 = applyElement(道具命中 + 元素站噴發共用);每幀 stepFloor 衰退/火沿油滾動/電水雙計時器。
import { COLS, ROWS, TILE, TILE_FLOOR, TILE_GRASS } from './constants.js';
import { game } from './state.js';
import { FLOOR_LIFE, FLOOR_WARN } from './v2-state.js';

// 狀態集(§3):字串(好讀好 debug)。CLEAN 用「無 cell」(null)表示,省記憶體/GC。
export const FL = { CLEAN: 'clean', OIL: 'oil', WATER: 'water', ICE: 'ice', POISON: 'poison', FIRE: 'fire', CHARGED: 'charged_water' };

// 注入的「元素名」(道具/站用的字彙)→ 底料狀態(無招牌反應時可覆蓋)。
// lightning/wind 不在此表:雷打乾地無水可充 = no-op(站的原始電弧是 combat 事件,非地板);風不改地板。
const ELEM_TO_STATE = { fire: FL.FIRE, oil: FL.OIL, water: FL.WATER, ice: FL.ICE, poison: FL.POISON };
const SUBSTRATE = new Set([FL.OIL, FL.WATER, FL.ICE, FL.POISON, FL.FIRE]); // 可當新底料覆蓋舊的

// 招牌反應表(§2):`${現狀態}|${注入元素}` → { next, event? }。查不到 → 底料取代 / no-op(見 applyElement)。
const FLOOR_RX = {
  [`${FL.OIL}|fire`]:       { next: FL.FIRE },                       // R1 火燃油 → 火海(沿油擴散在 stepFloor)
  [`${FL.WATER}|lightning`]:{ next: FL.CHARGED },                    // R2 雷+水 → 電水
  [`${FL.POISON}|fire`]:    { next: FL.CLEAN, event: 'poison_burst' },// R3 毒遇火 → 毒爆 + 清空
  [`${FL.FIRE}|poison`]:    { next: FL.CLEAN, event: 'poison_burst' },// R3 火遇毒 → 毒爆 + 清空
  [`${FL.FIRE}|ice`]:       { next: FL.WATER },                      // R4 冰滅火 → 水
  [`${FL.ICE}|fire`]:       { next: FL.WATER },                      // R4b 火融冰 → 水(對稱於 R4;火帽/元素站/桶火皆可,接雷=R2 電水)
  [`${FL.OIL}|ice`]:        { next: FL.ICE },                        // R5 冰+油 → 冰面
  [`${FL.WATER}|ice`]:      { next: FL.ICE },                        // R5 冰+水 → 冰面
};

const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// --- v2 私有地板層 (2b):game.map 只管靜態結構;化學狀態獨立在此。 ---
// cell = null(clean) | { st, ttl, max, warn, waterTtl }
//   st=狀態 · ttl=剩餘壽命 · max=初始壽命(算閃爍比例) · warn=進入預警 · waterTtl=charged 專用(水底料時鐘)
const floor = [];
function initGrid() { floor.length = 0; for (let y = 0; y < ROWS; y++) { const row = []; for (let x = 0; x < COLS; x++) row.push(null); floor.push(row); } }
initGrid();

// 一次性事件佇列(§2.5):v2-floor 不 import combat(避免循環);combat 每幀 drain 這個佇列消化毒爆等。
export const floorEvents = []; // { type, tx, ty, x, y }

export function resetFloor() { for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) floor[y][x] = null; floorEvents.length = 0; }
export function cellAt(tx, ty) { return (ty >= 0 && ty < ROWS && tx >= 0 && tx < COLS) ? floor[ty][tx] : null; }
export function stateAt(tx, ty) { const c = cellAt(tx, ty); return c ? c.st : FL.CLEAN; }
export function stateAtPixel(x, y) { return stateAt(Math.floor(x / TILE), Math.floor(y / TILE)); }
export { floor }; // render-lab / 測試讀取(唯讀約定)

// 只在可走地板格施化學(排除牆/虛空);flat 場全 FLOOR,isles 場走 GRASS。
function walkable(tx, ty) { const t = game.map?.[ty]?.[tx]; return t === TILE_FLOOR || t === TILE_GRASS; }

function setState(tx, ty, st) {
  if (st === FL.CLEAN) { floor[ty][tx] = null; return; }
  const life = FLOOR_LIFE[st] || 0;
  if (st === FL.CHARGED) {
    // 電荷疊在水上:ttl=電荷壽命;waterTtl=水的剩餘底料時鐘(§3.1 鐵則:充電**不重置**它)。
    const prev = floor[ty][tx];
    const remainWater = (prev && prev.st === FL.WATER) ? prev.ttl : (FLOOR_LIFE[FL.WATER] || 0);
    floor[ty][tx] = { st, ttl: life, max: life, warn: false, waterTtl: remainWater };
    return;
  }
  floor[ty][tx] = { st, ttl: life, max: life, warn: false, waterTtl: 0 };
}

function queueEvent(type, tx, ty) { floorEvents.push({ type, tx, ty, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }); }

// 唯一注入入口:道具命中 / 元素站噴發都走這裡 → 永遠同一條反應邏輯。
export function applyElement(tx, ty, element) {
  if (!walkable(tx, ty)) return;
  const cur = stateAt(tx, ty);
  const rx = FLOOR_RX[`${cur}|${element}`];
  if (rx) { if (rx.event) queueEvent(rx.event, tx, ty); setState(tx, ty, rx.next); return; }
  const sub = ELEM_TO_STATE[element];      // 無招牌反應:底料元素 → 取代;lightning 打乾地 / wind → no-op
  if (sub && SUBSTRATE.has(sub)) setState(tx, ty, sub);
}

// 以世界像素圓 (cx,cy,r) 蓋一片元素(道具投擲 / 元素站噴發共用)。回傳實際改變的格數。
export function stampElement(cx, cy, r, element) {
  let n = 0;
  const t0x = Math.floor((cx - r) / TILE), t1x = Math.floor((cx + r) / TILE);
  const t0y = Math.floor((cy - r) / TILE), t1y = Math.floor((cy + r) / TILE);
  for (let ty = t0y; ty <= t1y; ty++) for (let tx = t0x; tx <= t1x; tx++) {
    if (Math.hypot(tx * TILE + TILE / 2 - cx, ty * TILE + TILE / 2 - cy) > r) continue;
    const before = stateAt(tx, ty);
    applyElement(tx, ty, element);
    if (stateAt(tx, ty) !== before) n++;
  }
  return n;
}

// 每幀:1) 火沿油滾動  2) 衰退+預警(charged 雙計時器)。在 v2.js step() 於道具 impact 派發之後、移動之前呼叫。
export function stepFloor(dt) {
  // 1) 火沿相連油傳播 → 火像波浪滾過油田(§3.1)。先收集後套用,避免同幀連鎖爆走。
  const ignite = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = floor[y][x];
    if (!c || c.st !== FL.FIRE) continue;
    for (const [dx, dy] of NB4) if (stateAt(x + dx, y + dy) === FL.OIL) ignite.push([x + dx, y + dy]);
  }
  for (const [x, y] of ignite) applyElement(x, y, 'fire'); // oil|fire → FIRE(新鮮 4s → 續傳)

  // 2) 衰退 + 預警
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const c = floor[y][x];
    if (!c) continue;
    c.ttl -= dt;
    c.warn = c.ttl <= FLOOR_WARN;
    if (c.st === FL.CHARGED) {
      c.waterTtl -= dt;
      if (c.waterTtl <= 0) { floor[y][x] = null; continue; }        // 水底料到期 → 整格 clean
      if (c.ttl <= 0) {                                             // 電荷散 → 退回水(保留剩餘水時鐘)
        floor[y][x] = { st: FL.WATER, ttl: c.waterTtl, max: FLOOR_LIFE[FL.WATER] || 0, warn: c.waterTtl <= FLOOR_WARN, waterTtl: 0 };
      }
      continue;
    }
    if (c.ttl <= 0) floor[y][x] = null;                            // 其餘 → clean
  }
}
