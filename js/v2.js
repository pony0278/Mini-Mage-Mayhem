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
import { W, H, TILE, COLS, ROWS, TILE_FLOOR, TILE_WALL, TILE_VOID } from './constants.js';
import { clamp, norm } from './utils.js';
import { game, keys, CAM } from './state.js';
import { overVoid, updateDeathTheater, circleHitsSolid, addShake, addRing, hitSpark, addText, updateParticles, updateRings, updateFloatingTexts } from './sim.js';
import { render3D, drawPanicFaces, setIslandMode } from './render.js';
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

// --- arena: a floating island (no outer walls — the edges are cliffs; step/get knocked off → fall) ---
const ISLE = { x0: 3, x1: 26, y0: 3, y1: 16 };   // floor footprint (inclusive tile range)
const PIT = { x0: 13, x1: 16, y0: 8, y1: 11 };    // central chasm
const SPAWN = [ { x: 6 * TILE, y: 10 * TILE }, { x: 23 * TILE, y: 10 * TILE } ];
function buildArena() {
  game.map = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      const onIsle = x >= ISLE.x0 && x <= ISLE.x1 && y >= ISLE.y0 && y <= ISLE.y1;
      const inPit = x >= PIT.x0 && x <= PIT.x1 && y >= PIT.y0 && y <= PIT.y1;
      row.push(onIsle && !inPit ? TILE_FLOOR : TILE_VOID); // everything off-island is open air
    }
    game.map.push(row);
  }
}

// --- fighters ---
const COLORS = ['#5e8bff', '#ff6b6b'];
const NAMES = ['藍法師', '紅法師'];
function makeFighter(pid) {
  const f = { pid, type: 'imp', r: 15, color: COLORS[pid], score: 0, state: 'alive' };
  resetFighter(f);
  return f;
}
function resetFighter(f) {
  const sp = SPAWN[f.pid];
  f.x = sp.x; f.y = sp.y;
  f.vx = 0; f.vy = 0;
  f.facing = f.pid === 0 ? 0 : Math.PI; // face toward the pit/centre
  f.faceT = 0; f.falling = false; f.fallT = 0; f.spin = 0; f.voidT = 0;
  f.hurt = 0; f.slowTimer = 0; f.shoveCd = 0; f.lastHitBy = -1;
  f.state = 'alive';
}
const fighters = [makeFighter(0), makeFighter(1)];

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

function moveFighter(f, dt) {
  const m = readMove(f.pid);
  if (m.x || m.y) f.facing = Math.atan2(m.y, m.x);
  // walk intent + lingering knockback velocity, integrated with axis-separated wall collision
  const stepX = (m.x * SPEED + f.vx) * dt;
  const stepY = (m.y * SPEED + f.vy) * dt;
  if (!circleHitsSolid(f.x + stepX, f.y, f.r)) f.x += stepX; else f.vx = 0;
  if (!circleHitsSolid(f.x, f.y + stepY, f.r)) f.y += stepY; else f.vy = 0;
  f.x = clamp(f.x, f.r, W - f.r); f.y = clamp(f.y, f.r, H - f.r);
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
    o.faceT = 0.35; o.hurt = 0.12; o.lastHitBy = f.pid;
    hitSpark(o.x, o.y, '#dff3ff', 1.3);
  }
  addRing(f.x + Math.cos(a) * 26, f.y + Math.sin(a) * 26, 46, '#dff3ff', 0.22, 4);
  addShake(3);
  game.sfx.push('dash');
}

// edge-triggered shove (so a held key doesn't auto-fire every frame)
const shovePrev = [false, false];
function pollShove() {
  const pressed = [keys.has('f'), keys.has('/')];
  for (let i = 0; i < 2; i++) {
    if (pressed[i] && !shovePrev[i]) shove(fighters[i]);
    shovePrev[i] = pressed[i];
  }
}

function step(dt) {
  game.time += dt;
  game.screenShake = Math.max(0, game.screenShake - dt * 28);
  if (game.shakeSmallCd > 0) game.shakeSmallCd -= dt;
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
          if (f.lastHitBy >= 0 && f.lastHitBy !== f.pid) {
            fighters[f.lastHitBy].score++;
            addText(f.x, f.y - 30, NAMES[f.lastHitBy] + ' 得分!', COLORS[f.lastHitBy]);
          }
        }
        continue;
      }
      moveFighter(f, dt);
    }
  }
  // present only the fighters that aren't waiting to respawn
  game.enemies = fighters.filter(f => f.state !== 'down');
}

function drawHud() {
  hctx.clearRect(0, 0, W, H);
  hctx.textAlign = 'center'; hctx.textBaseline = 'alphabetic';
  // title
  hctx.font = '900 22px system-ui, sans-serif';
  hctx.fillStyle = '#eafaff';
  hctx.fillText('把對手轟進洞！', W / 2, 34);
  // scores
  hctx.font = '900 40px system-ui, sans-serif';
  hctx.textAlign = 'left'; hctx.fillStyle = COLORS[0];
  hctx.fillText(String(fighters[0].score), 24, 50);
  hctx.textAlign = 'right'; hctx.fillStyle = COLORS[1];
  hctx.fillText(String(fighters[1].score), W - 24, 50);
  // controls hint
  hctx.textAlign = 'center'; hctx.font = '700 13px system-ui, sans-serif';
  hctx.fillStyle = 'rgba(234,250,255,.7)';
  hctx.fillText('藍：WASD 移動 · F 陣風  　　 紅：方向鍵移動 · / 陣風', W / 2, H - 18);
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
window.__v2 = { game, fighters, CAM }; // debug / headless-test hook (CAM for live camera tuning)
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
buildArena();
setIslandMode(true); // float the arena above open air: VOID = transparent gap, edges = cliffs, fall = drop into sky/sea
game.enemies = fighters.slice();
// Front-on "diorama" framing (hero-brawler look): low rake + face-on so the arena's depth
// recedes away from camera and the near edge reads as foreground (NOT a steep top-down).
// v2-only — index.html keeps its follow-cam. The floating-island slab + sky/sea backdrop (setIslandMode)
// fills what used to be the empty band above the far edge.
CAM.fov = 35; CAM.angle = 25; CAM.dist = 950; CAM.azimuth = 0; CAM.panX = 0; CAM.panZ = -100; CAM.lookY = 30;

let last = performance.now();
requestAnimationFrame(frame);
