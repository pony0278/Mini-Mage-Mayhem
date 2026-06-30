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
import { W, H, TILE, COLS, ROWS, TILE_FLOOR, TILE_GRASS, TILE_VOID } from './constants.js';
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
const FREEFORM = true;
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
  for (const I of ISLANDS) if (Math.hypot(x - I.x, y - I.z) <= I.r) return true;
  // corridor half-width = plank half + a generous margin (≈ player radius) so you don't fall from a slight drift
  for (const B of BRIDGES) if (segDist(x, y, B.ax, B.az, B.bx, B.bz) <= B.w * 0.5 + 12) return true;
  return false;
}
function buildFlatMap() { // dummy all-floor grid so grid-reading helpers (circleHitsSolid) don't choke
  game.map = [];
  for (let y = 0; y < ROWS; y++) { const row = []; for (let x = 0; x < COLS; x++) row.push(TILE_FLOOR); game.map.push(row); }
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
function wellOnIsland(x, y) { for (const I of ISLANDS) if (Math.hypot(x - I.x, y - I.z) <= I.r - 26) return true; return false; }
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
  const fromI = islandIndexAt(f.x, f.y), toI = islandIndexAt(gx, gy);
  if (fromI < 0) {
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
  fighters[pid].score++; winnerPid = pid; winBannerT = 2.6;
  game.sfx.push('waveclear'); addShake(6);
  resetRound();
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
  game.time += dt;
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
          if (f.lastHitBy >= 0 && f.lastHitBy !== f.pid) {
            fighters[f.lastHitBy].score++;
            addText(f.x, f.y - 30, NAMES[f.lastHitBy] + ' 得分!', COLORS[f.lastHitBy]);
          }
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
          dlog(NAMES[f.pid], 'GRABBED trophy → Boss wakes');
          addText(f.x, f.y - 30, NAMES[f.pid] + ' 搶到獎盃！', COLORS[f.pid]);
          addText(boss.x, boss.y - 36, 'Boss 甦醒！', '#9affd0'); addRing(boss.x, boss.y, 60, '#9affd0', 0.4, 4);
          game.sfx.push('upgrade'); addShake(4);
          break;
        }
      }
    } else {
      const h = fighters[holderPid];
      if (h.state === 'alive') { trophy.x = h.x; trophy.y = h.y; holdMeter[holderPid] += dt; if (holdMeter[holderPid] >= HOLD_WIN) winRound(holderPid); }
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
  hctx.font = '900 20px system-ui, sans-serif';
  hctx.fillStyle = '#eafaff';
  hctx.fillText('搶獎盃 → 撐住！別被 Boss 抓到', W / 2, 30);
  // scores
  hctx.font = '900 40px system-ui, sans-serif';
  hctx.textAlign = 'left'; hctx.fillStyle = COLORS[0];
  hctx.fillText(String(fighters[0].score), 24, 50);
  hctx.textAlign = 'right'; hctx.fillStyle = COLORS[1];
  hctx.fillText(String(fighters[1].score), W - 24, 50);
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
  // build tag — bump on each gameplay change so you can confirm a fresh deploy loaded (hard-refresh if it's old)
  hctx.textAlign = 'right'; hctx.font = '700 11px ui-monospace, monospace'; hctx.fillStyle = 'rgba(234,250,255,.5)';
  hctx.fillText('build: isles-bridge3', W - 10, H - 4);
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
  state: () => ({ holderPid, holdMeter: [holdMeter[0], holdMeter[1]], winnerPid, awake: boss.awake, scores: [fighters[0].score, fighters[1].score], fallReason, fallReasonT: +fallReasonT.toFixed(2), localFlash: +localFlash.toFixed(2) }) };
window.addEventListener('keydown', (e) => {
  unlockAudio();
  keys.add(e.key.toLowerCase());
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '/'].includes(e.key.toLowerCase())) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('pointerdown', unlockAudio);

game.state = 'v2';      // not 'playing' → render's capstone/HUD branches stay off
game.player = null;     // camera centres on the arena, no player voxel
game.stats = null;
if (FREEFORM) {
  buildFlatMap();                                   // no walls; falling is governed by onSolid below
  setIslandShapes(ISLANDS, BRIDGES);                // organic round islands + rope bridges (mesh)
  game.isVoidAt = (e) => !onSolid(e.x, e.y);        // off any island/bridge → fall
} else {
  buildArena();                                     // grid broken-isles
  setIslandMode(true);                              // tile-slab floating island
}
game.camTarget = fighters[0]; // follow the (local) controlled player; the rival comes into view as it nears
game.enemies = fighters.slice();
// Front-on "diorama" framing (hero-brawler look): low rake + face-on so the arena's depth
// recedes away from camera and the near edge reads as foreground (NOT a steep top-down).
// v2-only — index.html keeps its own follow-cam. Telephoto follow on one fighter (game.camTarget):
// keeps the tight diorama look while always framing the controlled player; the rival enters view as it nears.
CAM.fov = 22; CAM.angle = 22; CAM.dist = 860; CAM.azimuth = 0; CAM.panX = 0; CAM.panZ = -60; CAM.lookY = 10;

let last = performance.now();
requestAnimationFrame(frame);
