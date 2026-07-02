// v2 地形與幾何 (docs/v2-module-boundaries.md §3):TERRAIN 模式旗標、平台/浮島/格子場的
// 建地、實心/虛空判定、橋面導軌與 AI 安全轉向。只依賴 constants + 單機 state(game.map)。
import { W, H, COLS, ROWS, TILE_FLOOR, TILE_GRASS, TILE_WALL, TILE_VOID } from './constants.js';
import { game } from './state.js';
import { FRICTION } from './v2-state.js';

export const TERRAIN = 'flat';                  // 'flat'(平台,好測收容) | 'isles'(浮島) | 'grid'(格子斷橋)
export const FREEFORM = TERRAIN === 'isles';    // island routing / bridge-rails / fall only apply in isles mode
// 擊退手感:平台/收容場要「有重量」——大阻力 + 低速截斷砍掉溜冰尾巴;
// 浮島保留原本的長滑行(把人滑進虛空正是那張圖的機制)。
export const WEIGHTY = TERRAIN !== 'isles';
export const KNOCK_FRICTION = WEIGHTY ? 0.05 : FRICTION; // ↓ = 更大阻力,擊退衰減更快
export const KNOCK_CUTOFF = WEIGHTY ? 42 : 0;            // 速度 < 此值直接歸零,砍掉指數衰減的長尾巴(溜冰感的來源)

// --- grid broken-isles (TERRAIN='grid') ---
function fillTiles(x0, y0, x1, y1, tile) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    if (x >= 0 && y >= 0 && x < COLS && y < ROWS) game.map[y][x] = tile;
}
function island(x0, y0, x1, y1) { // grass-topped island with its 4 corners trimmed for an organic silhouette
  fillTiles(x0, y0, x1, y1, TILE_GRASS);
  game.map[y0][x0] = TILE_VOID; game.map[y0][x1] = TILE_VOID;
  game.map[y1][x0] = TILE_VOID; game.map[y1][x1] = TILE_VOID;
}
export function buildArena() {
  game.map = [];
  for (let y = 0; y < ROWS; y++) { const row = []; for (let x = 0; x < COLS; x++) row.push(TILE_VOID); game.map.push(row); }
  // four islands
  island(2, 11, 9, 17);    // near-left  (P1 spawn)
  island(20, 11, 27, 17);  // near-right (P2 spawn)
  island(12, 8, 17, 13);   // centre
  island(10, 2, 19, 6);    // far
  // stone bridges (2 wide) spanning the gaps
  fillTiles(10, 12, 11, 13, TILE_FLOOR); // left ↔ centre
  fillTiles(18, 12, 19, 13, TILE_FLOOR); // centre ↔ right
  fillTiles(13, 6, 14, 8, TILE_FLOOR);   // centre ↔ far
}

// --- free-form round islands (TERRAIN='isles', docs/v2-spec-D)。Islands are discs in world px;
// collision/fall use disc + bridge-segment geometry. ---
export const ISLANDS = [
  { x: 200, z: 460, r: 120 }, // near-left  (P1 spawn ≈ here)
  { x: 760, z: 460, r: 120 }, // near-right (P2 spawn ≈ here)
  { x: 480, z: 350, r: 110 }, // centre
  { x: 480, z: 150, r: 130 }, // far
];
function rimBridge(a, b, w) { // a rope bridge spanning the gap between two islands' rims
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
  return { ax: a.x + ux * a.r * 0.9, az: a.z + uz * a.r * 0.9, bx: b.x - ux * b.r * 0.9, bz: b.z - uz * b.r * 0.9, w };
}
const BRIDGE_DEFS = [[0, 2], [1, 2], [2, 3]]; // island index pairs (centre=2 is the hub)
const BRIDGE_W = 52;                          // chunky bridges so they're comfortable to cross
export const BRIDGES = BRIDGE_DEFS.map(([i, j]) => ({ ...rimBridge(ISLANDS[i], ISLANDS[j], BRIDGE_W), i, j }));
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
export function onSolid(x, y) {
  if (TERRAIN !== 'isles') return x > 0 && y > 0 && x < W && y < H; // flat/grid: whole arena is ground
  for (const I of ISLANDS) if (Math.hypot(x - I.x, y - I.z) <= I.r) return true;
  // corridor half-width = plank half + a generous margin (≈ player radius) so you don't fall from a slight drift
  for (const B of BRIDGES) if (segDist(x, y, B.ax, B.az, B.bx, B.bz) <= B.w * 0.5 + 12) return true;
  return false;
}
export function buildFlatMap() { // dummy all-floor grid so grid-reading helpers (circleHitsSolid) don't choke
  game.map = [];
  for (let y = 0; y < ROWS; y++) { const row = []; for (let x = 0; x < COLS; x++) row.push(TILE_FLOOR); game.map.push(row); }
}
export function buildFlatArena() { // fully walled platform (4 sides). setWallFade(true) makes any wall between
  // camera and the player turn see-through (GetAmped-style), so the south wall gives full enclosure yet never hides you.
  game.map = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) row.push(x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? TILE_WALL : TILE_FLOOR);
    game.map.push(row);
  }
}

// invisible bridge "rails": when a fighter is over a gap and near a bridge (and not being knocked hard),
// ease it toward the plank centreline so crossing a diagonal bridge with axis-aligned input doesn't slide
// off the side. Skipped during big knockback so intentional shove-offs near bridges still work.
export function bridgeAssist(f) {
  for (const I of ISLANDS) if (Math.hypot(f.x - I.x, f.y - I.z) <= I.r) return; // on an island → no rails
  if (Math.hypot(f.vx, f.vy) > 240) return;                                     // being flung → don't fight it
  let bcx = 0, bcy = 0, bd = Infinity, half = 0;
  for (const B of BRIDGES) {
    const dx = B.bx - B.ax, dz = B.bz - B.az, L2 = dx * dx + dz * dz || 1;
    let t = ((f.x - B.ax) * dx + (f.y - B.az) * dz) / L2; t = Math.max(0, Math.min(1, t));
    const cx = B.ax + dx * t, cy = B.az + dz * t, d = Math.hypot(f.x - cx, f.y - cy);
    if (d < bd) { bd = d; bcx = cx; bcy = cy; half = B.w * 0.5; }
  }
  if (bd < half + 34) { const ax = (bcx - f.x) * 0.3, ay = (bcy - f.y) * 0.3; f.x += ax; f.y += ay; f.assist = Math.hypot(ax, ay); } // capture & ease to centreline
}
export function aiSafeDir(f, dx, dy) { // pick a heading near (dx,dy) that won't step off the island
  const base = Math.atan2(dy, dx);
  for (const off of [0, 0.4, -0.4, 0.9, -0.9, 1.5, -1.5, 2.3, -2.3, Math.PI]) {
    const a = base + off, c = Math.cos(a), s = Math.sin(a);
    // require solid ground at both a near and a far probe so it won't clip a gap beside a bridge
    if (onSolid(f.x + c * 20, f.y + s * 20) && onSolid(f.x + c * 42, f.y + s * 42)) return { x: c, y: s };
  }
  return { x: 0, y: 0 }; // boxed in → hold still
}
