// Shared feedback/juice + grid primitives — extracted from sim.js so both the single-player sim
// AND v2 can use them without v2 depending on (or bundling) the whole single-player core.
// DAG: constants/utils → state → **fx** → sim → render → main;  v2-combat/v2-items/v2 → fx.
// Pure: only touches game.* arrays + utils; imports nothing from sim/render/input (no cycle).
import { TILE, COLS, ROWS, TILE_WALL, TILE_THIN, TILE_ICEWALL, TILE_VOID } from './constants.js';
import { rnd, circleRectOverlap } from './utils.js';
import { game } from './state.js';

// --- grid collision ---
export function isSolidTile(t) { return t === TILE_WALL || t === TILE_THIN || t === TILE_ICEWALL; }
export function circleHitsSolid(x, y, r) {
  const minX = Math.floor((x - r) / TILE);
  const maxX = Math.floor((x + r) / TILE);
  const minY = Math.floor((y - r) / TILE);
  const maxY = Math.floor((y + r) / TILE);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
      if (isSolidTile(game.map[ty][tx]) && circleRectOverlap(x, y, r, tx * TILE, ty * TILE, TILE, TILE)) return true;
    }
  }
  return false;
}

// --- feedback / juice emitters ---
export function addText(x, y, text, color = '#fff') {
  game.floatingTexts.push({ x, y, text, color, life: 0.82, maxLife: 0.82, vy: -34 });
}
// Hitstop (頓幀): freeze the gameplay sim for s seconds on a hit. Math.max (no stacking) + a hard cap.
export function addHitstop(s) { game.hitstop = Math.min(0.12, Math.max(game.hitstop, s)); }
// Screen-shake throttle: SMALL shakes (< SHAKE_BIG) are rate-limited + soft-capped so routine combat
// reads calm; BIG events bypass both and still punch.
const SHAKE_BIG = 6;         // >= this = a "big" event: always lands, uncapped
const SHAKE_SMALL_CAP = 3.5; // small events can't push the shake past this
export function addShake(s) {
  if (s >= SHAKE_BIG) { game.screenShake = Math.max(game.screenShake, s); return; } // big: always
  if (game.shakeSmallCd > 0) return;                 // a small shake already fired this window — coalesce
  game.shakeSmallCd = 0.1;
  game.screenShake = Math.max(game.screenShake, Math.min(s, SHAKE_SMALL_CAP));
}
export function addRing(x, y, r, color = '#fff', life = 0.35, width = 3) {
  game.rings.push({ x, y, r, color, life, maxLife: life, width });
}
// Per-hit contact feedback: a tight spark burst + a fast contact ring. `power` ~ hit weight.
export function hitSpark(x, y, color = '#fff3e2', power = 1) {
  const n = Math.round(4 + power * 4);
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), sp = rnd(70, 120) * (0.7 + power * 0.5);
    game.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rnd(1.5, 3.4), life: rnd(0.1, 0.24), maxLife: 0.24, color });
  }
  addRing(x, y, 8 + power * 7, color, 0.13, 2);
}

// --- feedback tickers (per-frame decay of the juice arrays) ---
export function updateParticles(dt) {
  for (const p of game.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.pow(0.05, dt);
    p.vy *= Math.pow(0.05, dt);
  }
  game.particles = game.particles.filter(p => p.life > 0);
}
// 風壓手套發射閃:扇形衝擊波(頂點在手、張到 range、半張角 cone),render 掃出去+淡出。
export function addWindFan(x, y, angle, range, cone, life = 0.45) {
  game.windFans.push({ x, y, angle, range, cone, life, maxLife: life });
}
export function updateRings(dt) {
  for (const r of game.rings) r.life -= dt;
  game.rings = game.rings.filter(r => r.life > 0);
  for (const s of game.slams) s.life -= dt;
  game.slams = game.slams.filter(s => s.life > 0);
  for (const w of game.windFans) w.life -= dt;
  game.windFans = game.windFans.filter(w => w.life > 0);
}
export function updateFloatingTexts(dt) {
  for (const t of game.floatingTexts) {
    t.life -= dt;
    t.y += t.vy * dt;
  }
  game.floatingTexts = game.floatingTexts.filter(t => t.life > 0);
}

// --- death theatre (void-fall: panic-face → shrink/spin/sink). Shared by both games (isles fall). ---
const VOID_LAUNCH_THRESH = 280; // 擊退速度超過 → 凸眼 (panic face)
const VOID_FALL_TIME = 0.6;     // 墜落:縮小 + 旋轉 + 下沉
const VOID_FALL_GRACE = 0.07;   // 懸空多久才確定墜落 (防邊緣抖動)
const VOID_FACE_TIME = 0.35;    // 凸眼臉持續
// tile read inlined (no tileAtPixel) so fx never imports sim; game.isVoidAt is v2-terrain's isles hook.
export function overVoid(e) {
  return game.isVoidAt ? game.isVoidAt(e) : (game.map?.[Math.floor(e.y / TILE)]?.[Math.floor(e.x / TILE)] === TILE_VOID);
}
export function updateDeathTheater(e, dt) {
  if (e.faceT > 0) e.faceT -= dt;
  if (e.falling) {
    e.fallT -= dt; e.spin = (e.spin || 0) + 18 * dt;
    if (e.fallT <= 0) { e.dead = true; addText(e.x, e.y - 8, '墜落!', '#eafaff'); }
    return true;
  }
  if (Math.hypot(e.vx || 0, e.vy || 0) >= VOID_LAUNCH_THRESH) e.faceT = VOID_FACE_TIME; // 凸眼:被轟飛瞬間
  if (overVoid(e)) {
    e.voidT = (e.voidT || 0) + dt;
    if (e.voidT > VOID_FALL_GRACE) {
      e.falling = true; e.fallT = VOID_FALL_TIME; e.faceT = Math.max(e.faceT || 0, VOID_FACE_TIME);
      addHitstop(0.05); addShake(4); game.sfx.push('dash'); // 致死 beat:小頓幀 + 一聲 whoosh
      return true;
    }
  } else e.voidT = 0;
  return false;
}
