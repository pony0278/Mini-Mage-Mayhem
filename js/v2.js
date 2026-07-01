// v2.html only — the "第二刀" hot-seat prototype for the environmental-execution
// PvP slice (docs/v2-spec-A-dumb-deaths.md). Two players share one keyboard;
// the ONLY verb is a directional gust that shoves the other player. Line your
// rival up with the central pit, blast, and watch them 凸眼 → 墜落. This is the
// ugly laugh-gate prototype: validate that knocking each other into holes is
// funny with 3–4 people before we touch netcode.
//
// Reuses the v1 layers as a parts-donor (CLAUDE.md / docs): render.js for the
// art + the loved 45° camera, and sim.js's void death-theater (overVoid /
// updateDeathTheater). It runs its OWN tiny loop + input and does NOT touch the
// single-player update()/main.js loop. Both fighters live in game.enemies so the
// existing voxel renderer + death-theater draw them for free; game.player is null
// so render3D centres the camera on the arena.
import { W, H, TILE, COLS, ROWS, TILE_FLOOR, TILE_GRASS, TILE_WALL, TILE_VOID } from './constants.js';
import { clamp, norm } from './utils.js';
import { game, keys, CAM } from './state.js';
import { overVoid, updateDeathTheater, circleHitsSolid, addShake, addHitstop, addRing, hitSpark, addText, updateParticles, updateRings, updateFloatingTexts } from './sim.js';
import { render3D, drawPanicFaces, setIslandMode, setIslandShapes, project, setWallFade, setFloorSubtle } from './render.js';
import { playSfx, unlock as unlockAudio } from './audio.js';

const hud = document.getElementById('hud');
const hctx = hud.getContext('2d');

// --- tuning knobs (the laugh-gate dials) ---
const SPEED = 168;        // walk speed (px/s)
const SHOVE_FORCE = 540;  // launch velocity — well past the 凸眼 threshold (280), carries ~10 tiles
const SHOVE_RANGE = 138;  // how close the rival must be to catch the gust
const SHOVE_CONE = 1.05;  // forward half-cone (rad) — you must roughly face them (~60°)
const SHOVE_CD = 0.55;    // gust cooldown
const RESPAWN = 1.3;      // delay before a fallen fighter pops back in
const FRICTION = 0.25;    // per-second velocity multiplier for the knockback slide
const AI_SHOVE_CD = 1.6;  // 機制薄修:AI 出陣風間隔(↑=較不壓迫,你有更多空間削弱它/喘息)
const LOCAL = 0;          // the human-controlled fighter (camera follows it)
let localFlash = 0;       // red screen pulse when YOU get knocked (so a hit is never invisible)
let fallReason = '', fallReasonT = 0; // on-screen "why did I fall" readout (diagnostic + feedback)
const DEBUG = true;       // console event log (open DevTools) — copy lines to report issues
const dlog = (...a) => { if (DEBUG) console.log('[v2]', ...a); };
let prevLocalSolid = true; // track when YOU step off solid ground (the "boarding then falling" moment)

// --- arena: BROKEN ISLES — several grass-topped islands over open air, linked by narrow stone
// bridges. The gaps between islands are the executioner: get knocked off an island/bridge → fall.
// No central pit; the voids between islands do the work. (docs/v2-spec-D-arenas.md §3)
const SPAWN = [ { x: 5 * TILE, y: 14 * TILE }, { x: 24 * TILE, y: 14 * TILE } ];
function fillTiles(x0, y0, x1, y1, tile) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    if (x >= 0 && y >= 0 && x < COLS && y < ROWS) game.map[y][x] = tile;
}
function island(x0, y0, x1, y1) { // grass-topped island with its 4 corners trimmed for an organic silhouette
  fillTiles(x0, y0, x1, y1, TILE_GRASS);
  game.map[y0][x0] = TILE_VOID; game.map[y0][x1] = TILE_VOID;
  game.map[y1][x0] = TILE_VOID; game.map[y1][x1] = TILE_VOID;
}
function buildArena() {
  game.map = [];
  for (let y = 0; y < ROWS; y++) { const row = []; for (let x = 0; x < COLS; x++) row.push(TILE_VOID); game.map.push(row); }
  // four islands
  island(2, 11, 9, 17);    // near-left  (P1 spawn)
  island(20, 11, 27, 17);  // near-right (P2 spawn)
  island(12, 8, 17, 13);   // centre
  island(10, 2, 19, 6);    // far (future trophy island)
  // stone bridges (2 wide) spanning the gaps
  fillTiles(10, 12, 11, 13, TILE_FLOOR); // left ↔ centre
  fillTiles(18, 12, 19, 13, TILE_FLOOR); // centre ↔ right
  fillTiles(13, 6, 14, 8, TILE_FLOOR);   // centre ↔ far
}

// --- free-form round islands (EXPERIMENT, docs/v2-spec-D). Flip FREEFORM=false to revert to the grid
// broken-isles above. Islands are discs in world px; collision/fall use disc + bridge-segment geometry. ---
const TERRAIN = 'flat';                  // 'flat'(平台,好測收容) | 'isles'(浮島) | 'grid'(格子斷橋)
const FREEFORM = TERRAIN === 'isles';    // island routing / bridge-rails / fall only apply in isles mode
// 擊退手感:平台/收容場要「有重量」——大阻力 + 低速截斷砍掉溜冰尾巴 + 命中頓一下;
// 浮島保留原本的長滑行(把人滑進虛空/海裡正是那張圖的機制)。
const WEIGHTY = TERRAIN !== 'isles';
const KNOCK_FRICTION = WEIGHTY ? 0.05 : FRICTION; // ↓ = 更大阻力,擊退衰減更快
const KNOCK_CUTOFF = WEIGHTY ? 42 : 0;            // 速度 < 此值直接歸零,砍掉指數衰減的長尾巴(溜冰感的來源)
const SHOVE_MUL = WEIGHTY ? 0.9 : 1;              // 平台場略降力道,配合乾脆的停止
const ISLANDS = [
  { x: 200, z: 460, r: 120 }, // near-left  (P1 spawn ≈ here)
  { x: 760, z: 460, r: 120 }, // near-right (P2 spawn ≈ here)
  { x: 480, z: 350, r: 110 }, // centre
  { x: 480, z: 150, r: 130 }, // far (future trophy)
];
function rimBridge(a, b, w) { // a rope bridge spanning the gap between two islands' rims
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
  return { ax: a.x + ux * a.r * 0.9, az: a.z + uz * a.r * 0.9, bx: b.x - ux * b.r * 0.9, bz: b.z - uz * b.r * 0.9, w };
}
const BRIDGE_DEFS = [[0, 2], [1, 2], [2, 3]]; // island index pairs (centre=2 is the hub)
const BRIDGE_W = 52;                          // chunky bridges so they're comfortable to cross
const BRIDGES = BRIDGE_DEFS.map(([i, j]) => ({ ...rimBridge(ISLANDS[i], ISLANDS[j], BRIDGE_W), i, j }));
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
function onSolid(x, y) {
  if (TERRAIN !== 'isles') return x > 0 && y > 0 && x < W && y < H; // flat/grid: whole arena is ground
  for (const I of ISLANDS) if (Math.hypot(x - I.x, y - I.z) <= I.r) return true;
  // corridor half-width = plank half + a generous margin (≈ player radius) so you don't fall from a slight drift
  for (const B of BRIDGES) if (segDist(x, y, B.ax, B.az, B.bx, B.bz) <= B.w * 0.5 + 12) return true;
  return false;
}
function buildFlatMap() { // dummy all-floor grid so grid-reading helpers (circleHitsSolid) don't choke
  game.map = [];
  for (let y = 0; y < ROWS; y++) { const row = []; for (let x = 0; x < COLS; x++) row.push(TILE_FLOOR); game.map.push(row); }
}
function buildFlatArena() { // fully walled platform (4 sides). The camera-side (south) wall no longer needs removing:
  // setWallFade(true) makes any wall between camera and the player turn see-through (GetAmped-style), so the south
  // wall gives full enclosure yet never hides you. Collision unaffected (walls are solid + clamp as backstop).
  game.map = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) row.push(x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? TILE_WALL : TILE_FLOOR);
    game.map.push(row);
  }
}

// --- fighters ---
const COLORS = ['#5e8bff', '#ff6b6b'];
const NAMES = ['藍法師', '紅法師'];
function makeFighter(pid) {
  const f = { pid, type: 'imp', r: 19, color: COLORS[pid], score: 0, state: 'alive', ai: false }; // bigger voxel: stays readable as effects/bars/icons pile on (hitbox scales with it)
  resetFighter(f);
  return f;
}
function resetFighter(f) {
  const sp = SPAWN[f.pid];
  f.x = sp.x; f.y = sp.y;
  f.vx = 0; f.vy = 0;
  f.facing = f.pid === 0 ? 0 : Math.PI; // face toward the pit/centre
  f.faceT = 0; f.falling = false; f.fallT = 0; f.spin = 0; f.voidT = 0;
  f.hurt = 0; f.slowTimer = 0; f.shoveCd = 0; f.lastHitBy = -1; f.lastHitT = -9; f.aiLastShove = -9;
  f.stability = STAB_MAX; f.staggered = false; f.stabCd = 0;
  f.state = 'alive';
}
// --- 收容測試 (spec E §4 / V0.9): 削弱穩定值 → 推失衡對手進實驗艙 → 3 秒關艙 → 收容/過載反轉 ---
// (declared before fighters[] because resetFighter() reads STAB_MAX at construction time)
const POD = { x: W / 2, y: H / 2, r: 46 };
const STAB_MAX = 100, STAB_SHOVE = 45, STAB_REGEN = 28, STAG_ENTER = 25, STAG_EXIT = 45, STAG_SLOW = 0.6;
const LOCK_T = 3.0, ESCAPE_NEED = 100, MASH_AI = 26, MASH_TAP = 16; // mash to escape: AI fills ~78% in 3s (contained); a frantic human can break out
let lock = null; // { pid(被收容者), t(關艙倒數), escape(掙脫值), selfPod(自行入艙) }
function inPod(f) { return Math.hypot(f.x - POD.x, f.y - POD.y) <= POD.r; }
// --- 危險 #1:爆桶(Phase 1)。靠近→點燃 0.5s→爆炸:炸飛+削弱穩定值;炸到艙門→短路過載 ---
const BARREL_IGNITE = 28, BARREL_FUSE = 0.5, BARREL_BLAST = 95, BARREL_FORCE = 700, BARREL_STAB = 50, BARREL_RESPAWN = 6;
const BARREL_SPOTS = [[300, 210], [660, 210], [300, 470], [660, 470]];
const barrels = BARREL_SPOTS.map(([x, y]) => ({ x, y, r: 13, state: 'idle', fuse: 0, alive: true, respawn: 0 }));
function resetBarrels() { for (const b of barrels) { b.state = 'idle'; b.fuse = 0; b.alive = true; b.respawn = 0; } }

const fighters = [makeFighter(0), makeFighter(1)];
fighters[1].ai = true; // solo testing: red is a bot (flip to false for hot-seat 2-player)

// camera-relative basis (mirrors main.js buildInput) so screen-up = forward at any azimuth
function camRel(sx, sy) {
  const maz = (CAM.azimuth || 0) * Math.PI / 180;
  const fX = -Math.sin(maz), fY = -Math.cos(maz);
  const rX = Math.cos(maz), rY = -Math.sin(maz);
  return norm(rX * sx + fX * (-sy), rY * sx + fY * (-sy));
}

function readMove(pid) {
  let sx = 0, sy = 0;
  if (pid === 0) {
    if (keys.has('w')) sy -= 1; if (keys.has('s')) sy += 1;
    if (keys.has('a')) sx -= 1; if (keys.has('d')) sx += 1;
  } else {
    if (keys.has('arrowup')) sy -= 1; if (keys.has('arrowdown')) sy += 1;
    if (keys.has('arrowleft')) sx -= 1; if (keys.has('arrowright')) sx += 1;
  }
  return camRel(sx, sy);
}

// invisible bridge "rails": when a fighter is over a gap and near a bridge (and not being knocked hard),
// ease it toward the plank centreline so crossing a diagonal bridge with axis-aligned input doesn't slide
// off the side. Skipped during big knockback so intentional shove-offs near bridges still work.
function bridgeAssist(f) {
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
function moveFighter(f, dt) {
  const m = f.ai ? aiMove(f) : readMove(f.pid);
  if (m.x || m.y) f.facing = Math.atan2(m.y, m.x);
  const sp = SPEED * (f.staggered ? STAG_SLOW : 1); // 失衡時減速
  // walk intent + lingering knockback velocity, integrated with axis-separated wall collision
  const stepX = (m.x * sp + f.vx) * dt;
  const stepY = (m.y * sp + f.vy) * dt;
  if (!circleHitsSolid(f.x + stepX, f.y, f.r)) f.x += stepX; else f.vx = 0;
  if (!circleHitsSolid(f.x, f.y + stepY, f.r)) f.y += stepY; else f.vy = 0;
  f.x = clamp(f.x, f.r, W - f.r); f.y = clamp(f.y, f.r, H - f.r);
  if (FREEFORM) bridgeAssist(f);
  const k = Math.pow(KNOCK_FRICTION, dt); f.vx *= k; f.vy *= k;
  if (KNOCK_CUTOFF && f.vx * f.vx + f.vy * f.vy < KNOCK_CUTOFF * KNOCK_CUTOFF) { f.vx = 0; f.vy = 0; } // snap out the ice-slide tail
  if (f.shoveCd > 0) f.shoveCd -= dt;
}

// the one verb: a forward gust that flings any rival caught in the cone
function shove(f) {
  if (f.shoveCd > 0 || f.falling || f.state !== 'alive') return;
  f.shoveCd = SHOVE_CD;
  const a = f.facing;
  let hit = false;
  for (const o of fighters) {
    if (o === f || o.state !== 'alive' || o.falling) continue;
    const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy);
    if (d > SHOVE_RANGE) continue;
    let da = Math.atan2(dy, dx) - a;
    while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > SHOVE_CONE) continue;
    hit = true;
    o.vx += Math.cos(a) * SHOVE_FORCE * SHOVE_MUL; o.vy += Math.sin(a) * SHOVE_FORCE * SHOVE_MUL;
    o.faceT = 0.35; o.hurt = 0.12; o.lastHitBy = f.pid; o.lastHitT = game.time;
    o.stability = Math.max(0, o.stability - STAB_SHOVE); o.stabCd = 0.8; // 削弱穩定值(被陣風命中)
    hitSpark(o.x, o.y, '#dff3ff', 1.3);
    addText(o.x, o.y - 26, '推飛！', '#dff3ff'); addRing(o.x, o.y, 30, '#dff3ff', 0.3, 4); // clear "you got gusted" feedback
    if (o.pid === LOCAL) { localFlash = 0.28; dlog('SHOVED by', NAMES[f.pid], 'at', Math.round(o.x) + ',' + Math.round(o.y), '→ v', Math.round(o.vx) + ',' + Math.round(o.vy)); } // flash the screen when YOU are the one hit
  }
  addRing(f.x + Math.cos(a) * 26, f.y + Math.sin(a) * 26, 46, '#dff3ff', 0.22, 4);
  addShake(hit ? 5 : 3);
  if (hit && WEIGHTY) addHitstop(0.05); // 命中頓一下 → 賣出「撞到」的衝擊/重量感
  game.sfx.push('dash');
}

// edge-triggered shove (so a held key doesn't auto-fire every frame); AI fighters shove via aiMove, not keys
const shovePrev = [false, false];
function pollShove() {
  const pressed = [keys.has('f'), keys.has('/')];
  for (let i = 0; i < 2; i++) {
    if (fighters[i].ai) continue;
    if (pressed[i] && !shovePrev[i]) shove(fighters[i]);
    shovePrev[i] = pressed[i];
  }
}

// --- simple test AI (so you can play solo): seek the trophy / chase the holder / flee the boss when
// carrying, shove rivals in range, and steer to avoid walking off island edges. ---
function nearestIslandCenter(x, y) {
  let best = ISLANDS[0], bd = Infinity;
  for (const I of ISLANDS) { const d = Math.hypot(x - I.x, y - I.z); if (d < bd) { bd = d; best = I; } }
  return best;
}
function wellOnIsland(x, y) {
  if (TERRAIN !== 'isles') return x > 40 && y > 40 && x < W - 40 && y < H - 40; // flat: anywhere not hugging the wall
  for (const I of ISLANDS) if (Math.hypot(x - I.x, y - I.z) <= I.r - 26) return true; return false;
}
function aiSafeDir(f, dx, dy) { // pick a heading near (dx,dy) that won't step off the island
  const base = Math.atan2(dy, dx);
  for (const off of [0, 0.4, -0.4, 0.9, -0.9, 1.5, -1.5, 2.3, -2.3, Math.PI]) {
    const a = base + off, c = Math.cos(a), s = Math.sin(a);
    // require solid ground at both a near and a far probe so it won't clip a gap beside a bridge
    if (onSolid(f.x + c * 20, f.y + s * 20) && onSolid(f.x + c * 42, f.y + s * 42)) return { x: c, y: s };
  }
  return { x: 0, y: 0 }; // boxed in → hold still
}
function islandIndexAt(x, y) { for (let i = 0; i < ISLANDS.length; i++) { const I = ISLANDS[i]; if (Math.hypot(x - I.x, y - I.z) <= I.r) return i; } return -1; }
function bridgeBetween(a, b) { return BRIDGES.find(B => (B.i === a && B.j === b) || (B.i === b && B.j === a)); }
function bridgeFarEnd(B, fromI) { return fromI === B.i ? { x: B.bx, y: B.bz } : { x: B.ax, y: B.az }; }
function nextWaypoint(fromI, toI) { // bridge crossing toward the goal island (star graph: hub = centre/2)
  const direct = bridgeBetween(fromI, toI);
  if (direct) return bridgeFarEnd(direct, fromI);
  const viaHub = bridgeBetween(fromI, 2);          // not adjacent → first hop to the centre hub
  if (viaHub) return bridgeFarEnd(viaHub, fromI);
  return null;
}
function islandFarthestFromBoss() {
  let best = ISLANDS[0], bd = -1;
  for (const I of ISLANDS) { const d = Math.hypot(I.x - boss.x, I.z - boss.y); if (d > bd) { bd = d; best = I; } }
  return best;
}
function aiMove(f) {
  const o = fighters[1 - f.pid]; // the rival (1v1)
  const lockedSelf = lock && lock.pid === f.pid;
  let gx, gy;
  if (lockedSelf) { gx = f.x; gy = f.y; } // being contained → struggle handled elsewhere
  else if (f.staggered) { // I'm weak → flee from rival AND the pod (don't get trapped)
    const ax = f.x - o.x, ay = f.y - o.y, al = Math.hypot(ax, ay) || 1;
    const bx = f.x - POD.x, by = f.y - POD.y, bl = Math.hypot(bx, by) || 1;
    gx = f.x + ax / al * 200 + bx / bl * 130; gy = f.y + ay / al * 200 + by / bl * 130;
  } else if (o.staggered && o.state === 'alive') { // rival weak → get on the far side of the pod to push them in
    const ox = o.x - POD.x, oy = o.y - POD.y, ol = Math.hypot(ox, oy) || 1;
    gx = o.x + ox / ol * 58; gy = o.y + oy / ol * 58;
  } else { gx = o.x; gy = o.y; } // chase to weaken
  const dx = gx - f.x, dy = gy - f.y, dl = Math.hypot(dx, dy) || 1;
  const dir = aiSafeDir(f, dx / dl, dy / dl);
  if (dir.x || dir.y) f.facing = Math.atan2(dir.y, dir.x);
  // shove: weaken the rival, or (if they're weak) gust them toward the pod
  if (f.shoveCd <= 0 && game.time - (f.aiLastShove || -9) > AI_SHOVE_CD && o.state === 'alive' && !o.falling && !lockedSelf) {
    const od = Math.hypot(o.x - f.x, o.y - f.y);
    if (od <= SHOVE_RANGE) {
      f.aiLastShove = game.time;
      f.facing = o.staggered ? Math.atan2(POD.y - o.y, POD.x - o.x) : Math.atan2(o.y - f.y, o.x - f.x);
      shove(f);
    }
  }
  return dir;
}

// --- 有界跟隨(bounded follow):鏡頭跟一個「平滑 + 夾在內縮框裡」的代理點,而不是直接黏在角色上。
// 角色走到場邊時鏡頭停住不再跟過去 → 永遠不把場外黑色露進畫面(消滅留白);順帶消除跟隨抖動。
// 只用在平台場;浮島/格子場仍直接跟角色。數值可用 __v2.CAMB 即時微調。
const camRig = { x: SPAWN[0].x, y: SPAWN[0].y };
// ix=480(=W/2) → X 固定置中:相機視錐約等於場地寬度,只要水平偏離中心就會越過側牆露出黑邊;
// 這張圖幾乎就一個螢幕寬,水平跟隨沒有意義,固定置中 = 整場寬度永遠都在畫面內、側邊永不留白。
// 垂直仍用有界跟隨(ny/sy)給一點跟隨感又不露上下黑邊。
const CAMB = { ix: 480, ny: 210, sy: 500, ease: 8 }; // ix=左右夾界(=W/2 即固定置中), ny/sy=北/南夾界, ease=平滑
function updateCamRig(dt) {
  const lf = fighters[LOCAL];
  const tx = clamp(lf.x, CAMB.ix, W - CAMB.ix), ty = clamp(lf.y, CAMB.ny, CAMB.sy);
  const e = Math.min(1, dt * CAMB.ease);
  camRig.x += (tx - camRig.x) * e; camRig.y += (ty - camRig.y) * e;
}

// ===== 玩法 loop:搶獎盃 → Boss 甦醒追持有者 → 撐滿持有時間者勝 (docs/v2-spec-D §2/§5) =====
const TROPHY_R = 30;      // grab radius
const HOLD_WIN = 12;      // cumulative seconds holding the trophy → win the round
const BOSS_SPEED = 132;   // boss chase speed (px/s)
const BOSS_CONTACT = 34;  // boss strike radius
const BOSS_KNOCK = 640;   // boss contact knockback — can fling the holder clean off an island
const BOSS_WAKE = 1.3;    // grace after pickup before the boss starts chasing (it sleeps on the trophy)
const FAR = ISLANDS ? ISLANDS[3] : { x: 480, z: 150 }; // trophy/boss island (free-form coords; ≈far grid island)
const trophy = { x: FAR.x, y: FAR.z, held: false };
const boss = { type: 'boss', x: FAR.x, y: FAR.z - 12, r: 22, color: '#66e0a6', awake: false, wakeT: 0, facing: 0, hurt: 0, slowTimer: 0 };
let holderPid = -1;
const holdMeter = [0, 0];
let winnerPid = -1, winBannerT = 0;
// --- 魔法事故報告 (spec E / V0.8): a match = first to WIN_TARGET round-wins → generate an incident report ---
const WIN_TARGET = 3;
const roundWins = [0, 0];
let matchOver = false, report = null;
const inc = { falls: [0, 0], knockoffs: [0, 0], selfFalls: [0, 0], bossCatches: 0, grabs: [0, 0], types: new Set(), matchT: 0, maxHold: 0,
  contains: [0, 0], overloads: 0, selfPods: 0, barrelBooms: 0 };
const overAir = (x, y) => game.isVoidAt ? game.isVoidAt({ x, y }) : false; // free-form: off-island?

function resetRound() {
  holderPid = -1; holdMeter[0] = 0; holdMeter[1] = 0;
  trophy.held = false; trophy.x = FAR.x; trophy.y = FAR.z;
  boss.awake = false; boss.wakeT = 0; boss.x = FAR.x; boss.y = FAR.z - 12;
  lock = null;
  resetBarrels();
  for (const f of fighters) resetFighter(f);
}
function dropTrophy(x, y) {
  holderPid = -1; trophy.held = false; boss.awake = false; // boss sleeps until someone grabs again
  trophy.x = clamp(x, 40, W - 40); trophy.y = clamp(y, 40, H - 40);
  if (overAir(trophy.x, trophy.y)) { trophy.x = FAR.x; trophy.y = FAR.z; } // don't lose it down the abyss
  addText(trophy.x, trophy.y - 30, '獎盃掉落！', '#ffd36d');
}
function containSuccess() {
  const cap = lock.pid, w = 1 - cap;
  inc.contains[w]++; inc.types.add('contain'); if (lock.selfPod) { inc.selfPods++; inc.types.add('selfpod'); }
  addText(POD.x, POD.y - 40, NAMES[w] + ' 收容成功！', COLORS[w]); addRing(POD.x, POD.y, POD.r * 1.8, COLORS[w], 0.5, 5); addShake(5); game.sfx.push('waveclear');
  dlog('CONTAINED', NAMES[cap], '→', NAMES[w], 'wins round');
  lock = null; winRound(w);
}
function podOverload(cap) {
  inc.overloads++; inc.types.add('overload');
  for (const f of fighters) { if (f.state !== 'alive') continue; const dx = f.x - POD.x, dy = f.y - POD.y, d = Math.hypot(dx, dy) || 1; f.vx += dx / d * 620; f.vy += dy / d * 620; f.faceT = 0.4; }
  cap.stability = 55; cap.staggered = false; cap.stabCd = 1.0;
  if (cap.pid === LOCAL) localFlash = 0.3;
  addText(POD.x, POD.y - 40, '艙門過載！', '#ff7b72'); addRing(POD.x, POD.y, POD.r * 2.4, '#ffd36d', 0.45, 6); addShake(7); addHitstop(0.05); game.sfx.push('hit');
  dlog('OVERLOAD: escaped', NAMES[cap.pid]);
  lock = null;
}
function explodeBarrel(b) {
  b.alive = false; b.respawn = BARREL_RESPAWN; inc.barrelBooms++; inc.types.add('barrel');
  addRing(b.x, b.y, BARREL_BLAST, '#ff9a4a', 0.4, 6); addRing(b.x, b.y, BARREL_BLAST * 0.6, '#fff1bb', 0.3, 5);
  hitSpark(b.x, b.y, '#ffd36d', 2); addShake(8); addHitstop(0.05); game.sfx.push('hit');
  addText(b.x, b.y - 30, '爆！', '#ff7b72');
  for (const f of fighters) {
    if (f.state !== 'alive') continue;
    const dx = f.x - b.x, dy = f.y - b.y, d = Math.hypot(dx, dy) || 1;
    if (d > BARREL_BLAST + f.r) continue;
    f.vx += dx / d * BARREL_FORCE; f.vy += dy / d * BARREL_FORCE;
    f.stability = Math.max(0, f.stability - BARREL_STAB); f.stabCd = 0.8; f.faceT = 0.4; f.lastHitBy = -3; f.lastHitT = game.time; // -3 = 爆桶
    if (f.pid === LOCAL) localFlash = 0.32;
  }
  if (lock && Math.hypot(b.x - POD.x, b.y - POD.y) < BARREL_BLAST) { const cap = fighters[lock.pid]; if (cap) podOverload(cap); } // 炸到艙門→短路
  dlog('BARREL boom @', Math.round(b.x) + ',' + Math.round(b.y));
}
function updateBarrels(dt) {
  for (const b of barrels) {
    if (!b.alive) { b.respawn -= dt; if (b.respawn <= 0) { b.alive = true; b.state = 'idle'; } continue; }
    if (b.state === 'idle') {
      for (const f of fighters) { if (f.state === 'alive' && Math.hypot(f.x - b.x, f.y - b.y) < BARREL_IGNITE + f.r) { b.state = 'fuse'; b.fuse = BARREL_FUSE; addText(b.x, b.y - 26, '!', '#ffd36d'); game.sfx.push('dash'); break; } }
    } else if (b.state === 'fuse') { b.fuse -= dt; if (b.fuse <= 0) explodeBarrel(b); }
  }
}
function winRound(pid) {
  roundWins[pid]++; winnerPid = pid; winBannerT = 2.6;
  game.sfx.push('waveclear'); addShake(6);
  if (roundWins[pid] >= WIN_TARGET) endMatch(pid); else resetRound();
}
function endMatch(pid) { matchOver = true; report = generateReport(pid); game.sfx.push('upgrade'); dlog('MATCH OVER → report', report.level, report.name); }
function restartMatch() {
  matchOver = false; report = null; roundWins[0] = 0; roundWins[1] = 0;
  inc.falls = [0, 0]; inc.knockoffs = [0, 0]; inc.selfFalls = [0, 0]; inc.bossCatches = 0; inc.grabs = [0, 0]; inc.types = new Set(); inc.matchT = 0; inc.maxHold = 0;
  inc.contains = [0, 0]; inc.overloads = 0; inc.selfPods = 0; inc.barrelBooms = 0;
  resetRound();
}
function pickComment(w) {
  if (inc.barrelBooms >= 3) return '魔法倉庫的爆桶不是裝飾品。雖然你們把它當成了。';
  if (inc.contains[0] >= 1 && inc.contains[1] >= 1) return '技術上來說，有人被成功收容了。雙向地。';
  if (inc.overloads >= 2) return '實驗艙不是這樣用的。但你們找到了新用法。';
  if (inc.selfPods >= 1) return '受測體展現了高度的自我收容意識。';
  if (inc.barrelBooms >= 1) return '請勿在實驗艙附近施放火球。也請勿靠近爆桶。';
  return '請勿在實驗艙附近施放火球。';
}
function generateReport(winner) {
  const totalContains = inc.contains[0] + inc.contains[1];
  const chaos = totalContains + inc.overloads * 2 + inc.selfPods * 2 + inc.barrelBooms;
  const level = chaos >= 12 ? 'S+' : chaos >= 9 ? 'S' : chaos >= 7 ? 'A' : chaos >= 5 ? 'B' : chaos >= 3 ? 'C' : 'D';
  let name, summary;
  if (inc.barrelBooms >= 3) { name = '連環爆破事件'; summary = `魔法倉庫的爆桶連環引爆 ${inc.barrelBooms} 次，現場已無「桶」的概念。`; }
  else if (inc.contains[0] >= 1 && inc.contains[1] >= 1) { name = '反向收容拉鋸事件'; summary = `雙方互相收容了對方共 ${totalContains} 次，沒人說得清誰才是收容員。`; }
  else if (inc.overloads >= 2) { name = '艙門短路連發事件'; summary = `實驗艙過載 ${inc.overloads} 次，維修部門已遞辭呈。`; }
  else if (inc.selfPods >= 1) { name = '自行入艙事件'; summary = `受測體 ${inc.selfPods} 次自己滑進收容艙，效率高得令人不安。`; }
  else if (inc.barrelBooms >= 1) { name = '倉庫起火事件'; summary = `爆桶被引爆 ${inc.barrelBooms} 次，安全規範表示遺憾。`; }
  else { name = '標準收容測試'; summary = '收容程序大致完成，僅輕微失控。'; }
  const title = inc.barrelBooms >= 3 ? '爆破藝術家'
    : inc.overloads >= 2 ? '艙門短路專家'
    : inc.selfPods >= 1 ? '自助收容受測體'
    : inc.contains[winner] >= 2 ? '王牌收容員' : '合格但不可取';
  const damage = Math.min(99, chaos * 9);
  const code = 'MIR-' + Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
  const comment = pickComment(winner);
  const num = 100 + ((chaos * 7 + inc.contains[0] * 3 + inc.contains[1] * 5 + inc.overloads * 11) % 900);
  const share = `我在《魔法事故報告》觸發了 ${level} 級事故：${name}。\n${NAMES[winner]} 完成收容，基地損害 ${damage}%。\n安全委員會：「${comment}」\n挑戰碼：${code}`;
  return { num, name, level, winner, summary, comment, title, code, damage, time: inc.matchT };
}
function updateBoss(dt) {
  if (!boss.awake) return;
  boss.hurt = Math.max(0, boss.hurt - dt);
  if (boss.wakeT > 0) { // rising telegraph: hold position so the holder gets a head start
    boss.wakeT -= dt;
    if ((boss.wakeT * 8 | 0) % 2 === 0) addRing(boss.x, boss.y, 30, '#9affd0', 0.2, 3);
    return;
  }
  const t = holderPid >= 0 ? fighters[holderPid] : null;
  if (!t || t.state !== 'alive' || t.falling) return;
  const dx = t.x - boss.x, dy = t.y - boss.y, d = Math.hypot(dx, dy) || 1;
  boss.facing = Math.atan2(dy, dx);
  boss.x += (dx / d) * BOSS_SPEED * dt; boss.y += (dy / d) * BOSS_SPEED * dt;
  if (d <= BOSS_CONTACT + t.r) { // caught the holder → fling them off + drop the trophy
    t.vx += (dx / d) * BOSS_KNOCK; t.vy += (dy / d) * BOSS_KNOCK;
    t.faceT = 0.4; t.hurt = 0.15; t.lastHitBy = -2; t.lastHitT = game.time; // -2 = boss (≠ rival point)
    if (t.pid === LOCAL) { localFlash = 0.32; dlog('BOSS HIT you at', Math.round(t.x) + ',' + Math.round(t.y)); }
    addShake(6); addHitstop(0.06); game.sfx.push('hit');
    addText(t.x, t.y - 30, 'Boss 命中！', '#ff7b72');
    dropTrophy(t.x, t.y);
  }
}

function step(dt) {
  if (matchOver) return; // freeze gameplay while the incident report is up
  game.time += dt; inc.matchT += dt;
  game.screenShake = Math.max(0, game.screenShake - dt * 28);
  if (game.shakeSmallCd > 0) game.shakeSmallCd -= dt;
  if (winBannerT > 0) winBannerT -= dt;
  if (localFlash > 0) localFlash -= dt;
  if (fallReasonT > 0) fallReasonT -= dt;
  updateParticles(dt); updateRings(dt); updateFloatingTexts(dt);
  if (game.hitstop > 0) { game.hitstop -= dt; }
  else {
    pollShove();
    for (const f of fighters) {
      if (f.state === 'down') { f.respawn -= dt; if (f.respawn <= 0) resetFighter(f); continue; }
      // stability regen + 失衡 hysteresis (containment)
      if (f.stabCd > 0) f.stabCd -= dt; else f.stability = Math.min(STAB_MAX, f.stability + STAB_REGEN * dt);
      if (!f.staggered && f.stability <= STAG_ENTER) f.staggered = true;
      else if (f.staggered && f.stability >= STAG_EXIT) f.staggered = false;
      // death theatre first (handles 凸眼 + over-void fall); skip control while it owns the body
      if (updateDeathTheater(f, dt)) {
        if (f.dead) {
          f.state = 'down'; f.respawn = RESPAWN; f.dead = false;
          if (f.pid === LOCAL) { // diagnose & surface WHY you fell
            const recent = game.time - (f.lastHitT || -9) < 2.0; // knockback can slide you off ~1-2s after the hit
            fallReason = recent && f.lastHitBy === -2 ? 'Boss 撞落！'
              : recent && f.lastHitBy >= 0 ? `被${NAMES[f.lastHitBy]}推落！`
              : '走出邊緣墜落';
            fallReasonT = 3;
            dlog('FELL:', fallReason, '@', Math.round(f.x) + ',' + Math.round(f.y), 'lastHitBy', f.lastHitBy, 'Δhit', (game.time - (f.lastHitT || -9)).toFixed(2) + 's');
          }
          if (f.pid === holderPid) dropTrophy(f.x, f.y); // holder fell → trophy drops where they died
          // tally incidents for the end-of-match report
          inc.falls[f.pid]++;
          if (f.lastHitBy === -2) { inc.bossCatches++; inc.types.add('boss'); }
          else if (f.lastHitBy >= 0 && f.lastHitBy !== f.pid) { inc.knockoffs[f.lastHitBy]++; inc.types.add('knockoff'); addText(f.x, f.y - 30, NAMES[f.lastHitBy] + ' 推落!', COLORS[f.lastHitBy]); }
          else { inc.selfFalls[f.pid]++; inc.types.add('self'); }
        }
        continue;
      }
      const px0 = f.x, py0 = f.y;
      if (!(lock && lock.pid === f.pid)) moveFighter(f, dt); // captured fighter is held in the pod (struggle handled below)
      if (f.ai) { // stuck/vibrating detector for the bot
        if (Math.hypot(f.x - px0, f.y - py0) < 0.5) f._stillT = (f._stillT || 0) + dt; else { f._stillT = 0; f._stuckLogged = false; }
        if (f._stillT > 0.7 && !f._stuckLogged) {
          f._stuckLogged = true;
          dlog('AI STUCK @', Math.round(f.x) + ',' + Math.round(f.y), 'onBridge', islandIndexAt(f.x, f.y) < 0, 'facing', Math.round(f.facing * 57) + '°', 'holder', holderPid, 'goalIsHolder', holderPid >= 0);
        }
      }
    }
    // 收容:失衡對手進艙 → 關艙倒數;掙脫→過載反轉,倒數完成→收容成功
    if (lock) {
      const cap = fighters[lock.pid];
      if (cap.state !== 'alive') lock = null;
      else {
        cap.x += (POD.x - cap.x) * 0.35; cap.y += (POD.y - cap.y) * 0.35; cap.vx = 0; cap.vy = 0;
        // 掙扎=連打(按鍵上緣),非按住:AI 以固定速率(填不滿)→可被收容;人類狂按可掙脫
        if (cap.ai) lock.escape += MASH_AI * dt;
        else { const moving = (Math.abs(readMove(cap.pid).x) + Math.abs(readMove(cap.pid).y)) > 0; if (moving && !cap._mashPrev) lock.escape += MASH_TAP; cap._mashPrev = moving; }
        lock.t -= dt;
        if (lock.escape >= ESCAPE_NEED) podOverload(cap);
        else if (lock.t <= 0) containSuccess();
      }
    } else {
      for (const f of fighters) {
        if (f.state === 'alive' && !f.falling && f.staggered && inPod(f)) {
          lock = { pid: f.pid, t: LOCK_T, escape: 0, selfPod: game.time - (f.lastHitT || -9) > 1.2 };
          addText(POD.x, POD.y - 46, '收容程序啟動！', '#9affd0'); addRing(POD.x, POD.y, POD.r * 1.5, '#9affd0', 0.45, 4); addShake(4); game.sfx.push('upgrade');
          dlog('LOCK: captured', NAMES[f.pid], 'self?', lock.selfPod);
          break;
        }
      }
    }
    updateBarrels(dt); // 危險 #1:爆桶(靠近點燃→爆炸炸飛+削弱;炸到艙門→過載)
  }
  // log the exact frame YOU step off solid ground (the "boarding then falling" moment)
  const lf = fighters[LOCAL];
  if (lf.state === 'alive' && !lf.falling) {
    const s = onSolid(lf.x, lf.y);
    if (prevLocalSolid && !s) dlog('OFF-EDGE @', Math.round(lf.x) + ',' + Math.round(lf.y), 'v', Math.round(lf.vx) + ',' + Math.round(lf.vy), 'Δhit', (game.time - (lf.lastHitT || -9)).toFixed(2) + 's');
    prevLocalSolid = s;
  }
  // present live fighters for the renderer (no boss in the containment prototype)
  game.enemies = fighters.filter(f => f.state !== 'down');
  // alive barrels render as orange explosive crates (charge:'fire' → burning box in syncProps)
  game.props = barrels.filter(b => b.alive).map(b => ({ x: b.x, y: b.y, r: b.r, charge: 'fire', hp: 1, maxHp: 1, held: false }));
  if (game.camTarget === camRig) updateCamRig(dt); // flat mode: smoothed, bounded camera follow
}

function drawContainHud() {
  // 實驗艙:地面光環(關艙時轉紅 + 倒數);失衡冒星 + 穩定值小條
  const ground = (wx, wy) => project(wx, wy, 2);
  const pulse = 0.6 + 0.4 * Math.sin(game.time * 5);
  const c = ground(POD.x, POD.y), edge = ground(POD.x + POD.r, POD.y);
  if (!c.behind) {
    const rad = Math.max(14, Math.abs(edge.x - c.x));
    hctx.save();
    hctx.strokeStyle = lock ? `rgba(255,123,114,${pulse})` : `rgba(154,255,208,${0.5 + pulse * 0.3})`;
    hctx.lineWidth = 4; hctx.beginPath(); hctx.ellipse(c.x, c.y, rad, rad * 0.5, 0, 0, Math.PI * 2); hctx.stroke();
    hctx.restore();
    if (lock) { // 關艙倒數 + 掙脫進度
      hctx.textAlign = 'center';
      hctx.font = '900 40px system-ui, sans-serif'; hctx.fillStyle = '#ff7b72';
      hctx.fillText(Math.ceil(lock.t) + '', c.x, c.y - 30);
      const bw = 90, ex = c.x - bw / 2, ey = c.y - 18, p = clamp(lock.escape / ESCAPE_NEED, 0, 1);
      hctx.fillStyle = 'rgba(0,0,0,.5)'; hctx.fillRect(ex, ey, bw, 6);
      hctx.fillStyle = '#9affd0'; hctx.fillRect(ex, ey, bw * p, 6);
    }
  }
  for (const f of fighters) {
    if (f.state !== 'alive') continue;
    const s = project(f.x, f.y, (f.r || 14) * 2.2 + 16);
    if (s.behind) continue;
    const bw = 30, p = clamp(f.stability / STAB_MAX, 0, 1);
    hctx.fillStyle = 'rgba(0,0,0,.5)'; hctx.fillRect(s.x - bw / 2, s.y, bw, 4);
    hctx.fillStyle = f.staggered ? '#ff7b72' : COLORS[f.pid]; hctx.fillRect(s.x - bw / 2, s.y, bw * p, 4);
    if (f.staggered) { // 失衡冒星
      hctx.fillStyle = '#ffd36d'; hctx.font = '900 14px system-ui, sans-serif'; hctx.textAlign = 'center';
      hctx.fillText('★', s.x, s.y - 6);
    }
  }
}
const LEVEL_COL = { 'S+': '#ff5ce0', S: '#ff7b72', A: '#ffb14a', B: '#ffd36d', C: '#9fe7ff', D: '#bcd', E: '#9aa' };
function drawReport() {
  const r = report;
  hctx.fillStyle = 'rgba(8,10,16,.62)'; hctx.fillRect(0, 0, W, H); // dim the frozen world
  const pw = 640, ph = 446, px = (W - pw) / 2, py = (H - ph) / 2;
  hctx.fillStyle = 'rgba(20,24,34,.97)'; hctx.fillRect(px, py, pw, ph);
  hctx.strokeStyle = 'rgba(255,211,109,.5)'; hctx.lineWidth = 2; hctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  let y = py + 40; const cx = W / 2;
  hctx.textAlign = 'center';
  hctx.font = '900 24px system-ui, sans-serif'; hctx.fillStyle = '#eafaff';
  hctx.fillText('魔法事故報告 #' + r.num, cx, y); y += 40;
  // level badge
  hctx.font = '900 52px system-ui, sans-serif'; hctx.fillStyle = LEVEL_COL[r.level] || '#fff';
  hctx.fillText(r.level + ' 級', cx, y + 6); y += 50;
  hctx.font = '800 22px system-ui, sans-serif'; hctx.fillStyle = '#ffd36d';
  hctx.fillText(r.name, cx, y); y += 36;
  hctx.font = '600 15px system-ui, sans-serif'; hctx.fillStyle = '#cfe0f0';
  hctx.fillText(r.summary, cx, y); y += 34;
  // stats line
  hctx.font = '700 14px system-ui, sans-serif'; hctx.fillStyle = '#9fb6cd';
  hctx.fillText(`勝者：${NAMES[r.winner]}　基地損害 ${r.damage}%　收容 ${inc.contains[0] + inc.contains[1]} 次　艙門過載 ${inc.overloads}　自行入艙 ${inc.selfPods}　爆桶 ${inc.barrelBooms}　用時 ${r.time.toFixed(0)}s`, cx, y); y += 34;
  hctx.font = '800 16px system-ui, sans-serif'; hctx.fillStyle = COLORS[r.winner];
  hctx.fillText('稱號：' + r.title, cx, y); y += 34;
  // committee comment (the share juice)
  hctx.font = 'italic 700 17px system-ui, sans-serif'; hctx.fillStyle = '#9affd0';
  hctx.fillText('「' + r.comment + '」', cx, y); y += 28;
  hctx.font = '600 12px ui-monospace, monospace'; hctx.fillStyle = '#8a7d96';
  hctx.fillText('挑戰碼 ' + r.code, cx, y); y += 30;
  hctx.font = '800 15px system-ui, sans-serif'; hctx.fillStyle = '#eafaff';
  hctx.fillText('按 R 再來一場　·　按 C 複製分享文字', cx, py + ph - 18);
}
function drawHud() {
  hctx.clearRect(0, 0, W, H);
  // red edge pulse when YOU get knocked — so a hit is never invisible
  if (localFlash > 0) {
    const g = hctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, 'rgba(255,60,60,0)'); g.addColorStop(1, `rgba(255,40,40,${Math.min(0.5, localFlash * 1.6)})`);
    hctx.fillStyle = g; hctx.fillRect(0, 0, W, H);
  }
  hctx.textAlign = 'center'; hctx.textBaseline = 'alphabetic';
  // why you fell (diagnostic + feedback)
  if (fallReasonT > 0) { hctx.font = '900 30px system-ui, sans-serif'; hctx.fillStyle = '#ff9a9a'; hctx.fillText(fallReason, W / 2, H / 2 - 40); }
  // title
  hctx.font = '900 18px system-ui, sans-serif';
  hctx.fillStyle = '#eafaff';
  hctx.fillText('魔法事故報告 · 收容測試　削弱→推進實驗艙→關艙 ' + LOCK_T + 's　先贏 ' + WIN_TARGET, W / 2, 28);
  // round-win score (best-of)
  hctx.font = '900 40px system-ui, sans-serif';
  hctx.textAlign = 'left'; hctx.fillStyle = COLORS[0];
  hctx.fillText(roundWins[0] + '/' + WIN_TARGET, 24, 50);
  hctx.textAlign = 'right'; hctx.fillStyle = COLORS[1];
  hctx.fillText(roundWins[1] + '/' + WIN_TARGET, W - 24, 50);
  drawContainHud();
  // win banner
  if (winBannerT > 0) {
    hctx.textAlign = 'center'; hctx.font = '900 46px system-ui, sans-serif';
    hctx.fillStyle = COLORS[winnerPid]; hctx.fillText(NAMES[winnerPid] + ' 奪冠！', W / 2, H / 2);
  }
  // controls hint
  hctx.textAlign = 'center'; hctx.font = '700 13px system-ui, sans-serif';
  hctx.fillStyle = 'rgba(234,250,255,.7)';
  hctx.fillText('藍（你）：WASD 移動 · F 陣風(削弱+推進艙)　　紅：AI 對手', W / 2, H - 18);
  if (matchOver && report) drawReport(); // end-of-match incident report overlay
  // build tag — bump on each gameplay change so you can confirm a fresh deploy loaded (hard-refresh if it's old)
  hctx.textAlign = 'right'; hctx.font = '700 11px ui-monospace, monospace'; hctx.fillStyle = 'rgba(234,250,255,.5)';
  hctx.fillText('build: tune-4', W - 10, H - 4);
}

function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  step(dt);
  render3D();
  // drain sfx (whoosh on shove / fall)
  if (game.sfx.length) { for (const e of game.sfx) playSfx(e); game.sfx.length = 0; }
  drawHud();
  drawPanicFaces(); // 凸眼 billboarded over a launched/falling fighter (drawn after the HUD clear)
  requestAnimationFrame(frame);
}

// --- boot ---
window.__v2 = { game, fighters, CAM, trophy, boss, holdMeter, onSolid, ISLANDS, BRIDGES, // debug / headless-test hook (CAM for live camera tuning)
  winRound, restartMatch,
  POD, barrels, explodeBarrel, CAMB, camRig,
  state: () => ({ winnerPid, roundWins: [roundWins[0], roundWins[1]], matchOver, report,
    lock: lock ? { pid: lock.pid, t: +lock.t.toFixed(2), escape: +lock.escape.toFixed(0) } : null,
    stability: [Math.round(fighters[0].stability), Math.round(fighters[1].stability)],
    staggered: [fighters[0].staggered, fighters[1].staggered],
    contains: [inc.contains[0], inc.contains[1]], overloads: inc.overloads, selfPods: inc.selfPods, barrelBooms: inc.barrelBooms }) };
window.addEventListener('keydown', (e) => {
  unlockAudio();
  const k = e.key.toLowerCase();
  keys.add(k);
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '/'].includes(k)) e.preventDefault();
  if (matchOver) { // incident report screen: R = rematch, C = copy share text
    if (k === 'r') restartMatch();
    else if (k === 'c' && report && navigator.clipboard) { navigator.clipboard.writeText(report.share); dlog('copied share text'); }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('pointerdown', unlockAudio);

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
  setFloorSubtle(true);                             // calm floor: faint grid, no pink motes → eye goes to actors/hazards
  // pulled in (dist↓) and panned so the followed player sits in the lower third: panZ<0 pushes the look-target
  // north, so the player (south of it) rides low in frame → less black void below, more arena ahead. (Live-tune via __v2.CAM.)
  CAM.fov = 38; CAM.angle = 34; CAM.dist = 540; CAM.azimuth = 0; CAM.panX = 0; CAM.panZ = -40; CAM.lookY = 14;
}
// flat mode uses the smoothed/bounded camRig; isles/grid follow the fighter directly (their framing differs)
game.camTarget = TERRAIN === 'flat' ? camRig : fighters[0];
game.occludeTarget = fighters[LOCAL]; // see-through walls aim at the REAL player, not the (clamped) camera rig
game.enemies = fighters.slice();

let last = performance.now();
requestAnimationFrame(frame);

// opt-in live tuning panel (角色大小 / 格線 / 地板顏色·搶眼度 / 攝影機): open v2.html?tune=1
if (new URLSearchParams(location.search).has('tune')) import('./v2-tuning.js').catch(e => console.warn('[v2] tuning panel failed', e));
