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
import { render3D, drawPanicFaces, setIslandMode, setIslandShapes, project } from './render.js';
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
function buildFlatArena() { // plain walled platform — no void/falling; easiest for testing the containment loop
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
  const f = { pid, type: 'imp', r: 15, color: COLORS[pid], score: 0, state: 'alive', ai: false };
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
  f.state = 'alive';
}
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
  // walk intent + lingering knockback velocity, integrated with axis-separated wall collision
  const stepX = (m.x * SPEED + f.vx) * dt;
  const stepY = (m.y * SPEED + f.vy) * dt;
  if (!circleHitsSolid(f.x + stepX, f.y, f.r)) f.x += stepX; else f.vx = 0;
  if (!circleHitsSolid(f.x, f.y + stepY, f.r)) f.y += stepY; else f.vy = 0;
  f.x = clamp(f.x, f.r, W - f.r); f.y = clamp(f.y, f.r, H - f.r);
  if (FREEFORM) bridgeAssist(f);
  const k = Math.pow(FRICTION, dt); f.vx *= k; f.vy *= k;
  if (f.shoveCd > 0) f.shoveCd -= dt;
}

// the one verb: a forward gust that flings any rival caught in the cone
function shove(f) {
  if (f.shoveCd > 0 || f.falling || f.state !== 'alive') return;
  f.shoveCd = SHOVE_CD;
  const a = f.facing;
  for (const o of fighters) {
    if (o === f || o.state !== 'alive' || o.falling) continue;
    const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy);
    if (d > SHOVE_RANGE) continue;
    let da = Math.atan2(dy, dx) - a;
    while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > SHOVE_CONE) continue;
    o.vx += Math.cos(a) * SHOVE_FORCE; o.vy += Math.sin(a) * SHOVE_FORCE;
    o.faceT = 0.35; o.hurt = 0.12; o.lastHitBy = f.pid; o.lastHitT = game.time;
    hitSpark(o.x, o.y, '#dff3ff', 1.3);
    addText(o.x, o.y - 26, '推飛！', '#dff3ff'); addRing(o.x, o.y, 30, '#dff3ff', 0.3, 4); // clear "you got gusted" feedback
    if (o.pid === LOCAL) { localFlash = 0.28; dlog('SHOVED by', NAMES[f.pid], 'at', Math.round(o.x) + ',' + Math.round(o.y), '→ v', Math.round(o.vx) + ',' + Math.round(o.vy)); } // flash the screen when YOU are the one hit
  }
  addRing(f.x + Math.cos(a) * 26, f.y + Math.sin(a) * 26, 46, '#dff3ff', 0.22, 4);
  addShake(3);
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
  let gx, gy; const holding = holderPid === f.pid;
  if (holding) { const I = islandFarthestFromBoss(); gx = I.x; gy = I.z; } // flee: run to the island away from boss
  else if (holderPid >= 0) { gx = fighters[holderPid].x; gy = fighters[holderPid].y; } // human holds → chase to steal
  else { gx = trophy.x; gy = trophy.y; }                                               // loose → go grab
  // route across bridges toward the goal island (incl. the fleeing holder, so it actually crosses, not camps)
  let tx = gx, ty = gy;
  const fromI = FREEFORM ? islandIndexAt(f.x, f.y) : 0, toI = FREEFORM ? islandIndexAt(gx, gy) : 0;
  if (FREEFORM && fromI < 0) {
    // ON A BRIDGE → commit to walking straight to the exit island (the end nearer the goal); stops the
    // "head to goal → veer off bridge → correct → repeat" jitter that made the bot vibrate mid-bridge.
    let nb = null, nbd = Infinity;
    for (const B of BRIDGES) { const d = segDist(f.x, f.y, B.ax, B.az, B.bx, B.bz); if (d < nbd) { nbd = d; nb = B; } }
    if (nb) { const ci = ISLANDS[nb.i], cj = ISLANDS[nb.j];
      const exit = Math.hypot(ci.x - gx, ci.z - gy) <= Math.hypot(cj.x - gx, cj.z - gy) ? ci : cj;
      tx = exit.x; ty = exit.z; }
  } else if (toI >= 0 && fromI !== toI) { const wp = nextWaypoint(fromI, toI); if (wp) { tx = wp.x; ty = wp.y; } }
  let dx = tx - f.x, dy = ty - f.y;
  // when carrying and the boss is closing in, add an away-from-boss nudge (don't fully override the route)
  if (holding && boss.awake && Math.hypot(f.x - boss.x, f.y - boss.y) < 130) {
    const bx = f.x - boss.x, by = f.y - boss.y, bl = Math.hypot(bx, by) || 1; dx += bx / bl * 130; dy += by / bl * 130;
  }
  const dl = Math.hypot(dx, dy) || 1;
  const dir = aiSafeDir(f, dx / dl, dy / dl);
  if (dir.x || dir.y) f.facing = Math.atan2(dir.y, dir.x);
  if (f.shoveCd <= 0 && game.time - (f.aiLastShove || -9) > 1.6) { // throttle bot shoves so testing isn't constant knock-offs
    for (const o of fighters) {
      if (o === f || o.state !== 'alive' || o.falling) continue;
      const ox = o.x - f.x, oy = o.y - f.y, od = Math.hypot(ox, oy);
      if (od > SHOVE_RANGE) continue;
      if (!wellOnIsland(o.x, o.y)) continue; // don't gust a rival who's still crossing/boarding (anti-cheese)
      // only shove with PURPOSE: the rival holds the trophy (steal it), or you're both contesting a loose one.
      // otherwise leave the player alone (so they can move/test without being griefed off islands).
      const contesting = o.pid === holderPid || (holderPid < 0 && Math.hypot(o.x - trophy.x, o.y - trophy.y) < 140);
      if (!contesting) continue;
      f.aiLastShove = game.time; f.facing = Math.atan2(oy, ox); shove(f); break;
    }
  }
  return dir;
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
const inc = { falls: [0, 0], knockoffs: [0, 0], selfFalls: [0, 0], bossCatches: 0, grabs: [0, 0], types: new Set(), matchT: 0, maxHold: 0 };
const overAir = (x, y) => game.isVoidAt ? game.isVoidAt({ x, y }) : false; // free-form: off-island?

function resetRound() {
  holderPid = -1; holdMeter[0] = 0; holdMeter[1] = 0;
  trophy.held = false; trophy.x = FAR.x; trophy.y = FAR.z;
  boss.awake = false; boss.wakeT = 0; boss.x = FAR.x; boss.y = FAR.z - 12;
  for (const f of fighters) resetFighter(f);
}
function dropTrophy(x, y) {
  holderPid = -1; trophy.held = false; boss.awake = false; // boss sleeps until someone grabs again
  trophy.x = clamp(x, 40, W - 40); trophy.y = clamp(y, 40, H - 40);
  if (overAir(trophy.x, trophy.y)) { trophy.x = FAR.x; trophy.y = FAR.z; } // don't lose it down the abyss
  addText(trophy.x, trophy.y - 30, '獎盃掉落！', '#ffd36d');
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
  resetRound();
}
function pickComment(w) {
  if (inc.bossCatches >= 2) return '技術上來說，有人被成功收容了。只是收錯人。';
  if (inc.selfFalls[w] > 0) return NAMES[w] + '贏了，但中途自己走下島過。我們選擇不深究。';
  if (Math.max(inc.knockoffs[0], inc.knockoffs[1]) >= 3) return '本局基地邊欄維修預算已超支。';
  return '請勿在實驗艙附近施放火球。';
}
function generateReport(winner) {
  const totalFalls = inc.falls[0] + inc.falls[1];
  const selfT = inc.selfFalls[0] + inc.selfFalls[1];
  const chaos = totalFalls + inc.bossCatches * 2 + selfT;
  const level = chaos >= 12 ? 'S+' : chaos >= 9 ? 'S' : chaos >= 7 ? 'A' : chaos >= 5 ? 'B' : chaos >= 3 ? 'C' : 'D';
  let name, summary;
  if (inc.bossCatches >= 2) { name = '收容核心暴走事件'; summary = `Boss 在收容過程失控 ${inc.bossCatches} 次，把受測體當逗貓棒甩。`; }
  else if (selfT >= 3) { name = '自由落體研究事件'; summary = `現場 ${selfT} 次有人「自己」走下島，無需外力協助。`; }
  else if (Math.max(inc.knockoffs[0], inc.knockoffs[1]) >= 3) { name = '連環陣風驅逐事件'; summary = `陣風把對手轟下島 ${Math.max(inc.knockoffs[0], inc.knockoffs[1])} 次，基地邊緣形同虛設。`; }
  else { name = '例行收容測試'; summary = '一切大致按計畫進行……的意思是大致沒人按計畫。'; }
  const title = inc.bossCatches >= 2 ? '逗貓棒大師'
    : inc.selfFalls[winner] > 0 ? '自爆倖存者'
    : inc.knockoffs[winner] >= 3 ? '風壓收容員' : '合格但不可取';
  const damage = Math.min(99, chaos * 8);
  const code = 'MIR-' + Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
  const comment = pickComment(winner);
  const num = 100 + ((chaos * 7 + inc.grabs[0] * 3 + inc.grabs[1] * 5) % 900);
  const share = `我在《魔法事故報告》觸發了 ${level} 級事故：${name}。\n${NAMES[winner]} 收容成功，基地損害 ${damage}%。\n安全委員會：「${comment}」\n挑戰碼：${code}`;
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
      moveFighter(f, dt);
      if (f.ai) { // stuck/vibrating detector for the bot
        if (Math.hypot(f.x - px0, f.y - py0) < 0.5) f._stillT = (f._stillT || 0) + dt; else { f._stillT = 0; f._stuckLogged = false; }
        if (f._stillT > 0.7 && !f._stuckLogged) {
          f._stuckLogged = true;
          dlog('AI STUCK @', Math.round(f.x) + ',' + Math.round(f.y), 'onBridge', islandIndexAt(f.x, f.y) < 0, 'facing', Math.round(f.facing * 57) + '°', 'holder', holderPid, 'goalIsHolder', holderPid >= 0);
        }
      }
    }
    // trophy: pick up when loose, ride + tick the hold meter when held
    if (holderPid < 0) {
      for (const f of fighters) {
        if (f.state !== 'alive' || f.falling) continue;
        if (Math.hypot(f.x - trophy.x, f.y - trophy.y) <= TROPHY_R + f.r) {
          holderPid = f.pid; trophy.held = true; boss.awake = true; boss.wakeT = BOSS_WAKE; boss.x = FAR.x; boss.y = FAR.z - 12;
          inc.grabs[f.pid]++; inc.types.add('grab');
          dlog(NAMES[f.pid], 'GRABBED trophy → Boss wakes');
          addText(f.x, f.y - 30, NAMES[f.pid] + ' 搶到獎盃！', COLORS[f.pid]);
          addText(boss.x, boss.y - 36, 'Boss 甦醒！', '#9affd0'); addRing(boss.x, boss.y, 60, '#9affd0', 0.4, 4);
          game.sfx.push('upgrade'); addShake(4);
          break;
        }
      }
    } else {
      const h = fighters[holderPid];
      if (h.state === 'alive') { trophy.x = h.x; trophy.y = h.y; holdMeter[holderPid] += dt; inc.maxHold = Math.max(inc.maxHold, holdMeter[holderPid]); if (holdMeter[holderPid] >= HOLD_WIN) winRound(holderPid); }
    }
    updateBoss(dt);
  }
  // log the exact frame YOU step off solid ground (the "boarding then falling" moment)
  const lf = fighters[LOCAL];
  if (lf.state === 'alive' && !lf.falling) {
    const s = onSolid(lf.x, lf.y);
    if (prevLocalSolid && !s) dlog('OFF-EDGE @', Math.round(lf.x) + ',' + Math.round(lf.y), 'v', Math.round(lf.vx) + ',' + Math.round(lf.vy), 'Δhit', (game.time - (lf.lastHitT || -9)).toFixed(2) + 's');
    prevLocalSolid = s;
  }
  // present live fighters + the boss (when awake) for the renderer
  game.enemies = fighters.filter(f => f.state !== 'down');
  if (boss.awake) game.enemies.push(boss);
}

function drawTrophyMarker() {
  // billboard a gold trophy: above the holder's head when carried, else on the ground
  const s = project(trophy.x, trophy.y, trophy.held ? 48 : 12);
  if (s.behind) return;
  const pulse = 0.7 + 0.3 * Math.sin(game.time * 6);
  hctx.save();
  hctx.translate(s.x, s.y);
  hctx.shadowColor = 'rgba(255,211,109,.9)'; hctx.shadowBlur = 12 * pulse;
  hctx.fillStyle = '#ffd36d';
  hctx.beginPath(); hctx.moveTo(0, -11); hctx.lineTo(9, 0); hctx.lineTo(0, 11); hctx.lineTo(-9, 0); hctx.closePath(); hctx.fill();
  hctx.shadowBlur = 0; hctx.fillStyle = '#fff6d8';
  hctx.beginPath(); hctx.arc(0, 0, 3, 0, Math.PI * 2); hctx.fill();
  hctx.restore();
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
  hctx.fillText(`勝者：${NAMES[r.winner]}　基地損害 ${r.damage}%　墜落 ${inc.falls[0] + inc.falls[1]} 次　自落 ${inc.selfFalls[0] + inc.selfFalls[1]}　Boss 命中 ${inc.bossCatches}　用時 ${r.time.toFixed(0)}s`, cx, y); y += 34;
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
  hctx.fillText('魔法事故報告 · 收容測試　搶獎盃→撐住→先贏 ' + WIN_TARGET + ' 回合', W / 2, 28);
  // round-win score (best-of)
  hctx.font = '900 40px system-ui, sans-serif';
  hctx.textAlign = 'left'; hctx.fillStyle = COLORS[0];
  hctx.fillText(roundWins[0] + '/' + WIN_TARGET, 24, 50);
  hctx.textAlign = 'right'; hctx.fillStyle = COLORS[1];
  hctx.fillText(roundWins[1] + '/' + WIN_TARGET, W - 24, 50);
  // hold progress bar (when someone holds the trophy)
  if (holderPid >= 0) {
    const pct = clamp(holdMeter[holderPid] / HOLD_WIN, 0, 1);
    const bw = 260, bx = W / 2 - bw / 2, by = 48;
    hctx.fillStyle = 'rgba(0,0,0,.45)'; hctx.fillRect(bx, by, bw, 12);
    hctx.fillStyle = COLORS[holderPid]; hctx.fillRect(bx, by, bw * pct, 12);
    hctx.textAlign = 'center'; hctx.font = '800 13px system-ui, sans-serif'; hctx.fillStyle = '#eafaff';
    hctx.fillText(NAMES[holderPid] + ' 持有獎盃 ' + Math.ceil(HOLD_WIN - holdMeter[holderPid]) + 's', W / 2, by + 30);
  }
  drawTrophyMarker();
  // win banner
  if (winBannerT > 0) {
    hctx.textAlign = 'center'; hctx.font = '900 46px system-ui, sans-serif';
    hctx.fillStyle = COLORS[winnerPid]; hctx.fillText(NAMES[winnerPid] + ' 奪冠！', W / 2, H / 2);
  }
  // controls hint
  hctx.textAlign = 'center'; hctx.font = '700 13px system-ui, sans-serif';
  hctx.fillStyle = 'rgba(234,250,255,.7)';
  hctx.fillText('藍（你）：WASD 移動 · F 陣風　　紅：AI 對手', W / 2, H - 18);
  if (matchOver && report) drawReport(); // end-of-match incident report overlay
  // build tag — bump on each gameplay change so you can confirm a fresh deploy loaded (hard-refresh if it's old)
  hctx.textAlign = 'right'; hctx.font = '700 11px ui-monospace, monospace'; hctx.fillStyle = 'rgba(234,250,255,.5)';
  hctx.fillText('build: flat-1', W - 10, H - 4);
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
  state: () => ({ holderPid, winnerPid, awake: boss.awake, roundWins: [roundWins[0], roundWins[1]], matchOver, report, fallReason, fallReasonT: +fallReasonT.toFixed(2), localFlash: +localFlash.toFixed(2) }) };
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
  CAM.fov = 32; CAM.angle = 40; CAM.dist = 760; CAM.azimuth = 0; CAM.panX = 0; CAM.panZ = 0; CAM.lookY = 0;
}
game.camTarget = fighters[0]; // follow the (local) controlled player; the rival comes into view as it nears
game.enemies = fighters.slice();

let last = performance.now();
requestAnimationFrame(frame);
