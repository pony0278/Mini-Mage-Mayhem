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
import { game, keys, mouse, CAM } from './state.js';
import { overVoid, updateDeathTheater, circleHitsSolid, addShake, addHitstop, addRing, hitSpark, addText, updateParticles, updateRings, updateFloatingTexts } from './sim.js';
import { render3D, drawPanicFaces, setIslandMode, setIslandShapes, project, setWallFade, setFloorParams, setActorShadow, setVividFx, setGroundMarkers, setRichFloor, updateMouseWorld, mouseScreen } from './render.js';
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
  const f = { pid, type: 'brawler', r: 19, color: COLORS[pid], score: 0, state: 'alive', ai: false }; // 關節化體素小人(render.js 'brawler'):真的會走路/出拳 (hitbox scales with r)
  resetFighter(f);
  return f;
}
function resetFighter(f) {
  const sp = SPAWN[f.pid];
  f.x = sp.x; f.y = sp.y;
  f.vx = 0; f.vy = 0;
  f.facing = f.pid === 0 ? 0 : Math.PI; // face toward the pit/centre
  f.faceT = 0; f.falling = false; f.fallT = 0; f.spin = 0; f.voidT = 0;
  f.hurt = 0; f.lastHitBy = -1; f.lastHitT = -9;
  f.stability = STAB_MAX; f.stabCd = 0;
  f.stunned = false; f.stunT = 0; f.restunT = 0;
  f.carrying = null; f.carriedBy = null; f.escape = 0; f.mashSide = 0; f._aPrev = false; f._dPrev = false;
  f.punchCd = 0; f.regrabCd = 0; f.fumbleT = 0; f.wasCarryingT = -9; f.invuln = 0;
  f.punchFx = -9; f.punchArm = 0; // 出拳動畫時間戳 + 左右手交替 (render 的 brawler 姿勢吃這兩個)
  f.flinchT = 0; f.flinchA = 0;   // 受擊反應:朝受力方向甩頭+壓扁回彈 (render 吃這兩個)
  f.item = null;
  f.state = 'alive';
}
// --- 收容測試 (spec F §2): 揮拳削穩定值 → 擊暈 → 抓 → 拖進實驗艙 = 收容 ---
// (declared before fighters[] because resetFighter() reads STAB_MAX at construction time)
const POD = { x: W / 2, y: H / 2, r: 46 };
const STAB_MAX = 100, STAB_REGEN = 28;
// 基礎抓捕數值 (spec F §2.3 起始值,實測後調)
const PUNCH_RANGE = 46, PUNCH_CONE = 0.9, PUNCH_CD = 0.35, PUNCH_STAB = 25, PUNCH_KNOCK = 130;
const STUN_T = 1.2, STUN_RECOVER = 40, RESTUN_IMMUNE = 0.6;
const GRAB_RANGE = 46, CARRY_SLOW = 0.6, REGRAB_CD = 0.6;
const CARRY_ESCAPE_NEED = 100, CARRY_MASH_AI = 45, CARRY_MASH_TAP = 8; // AI 固定填速≈2.2s;人類左右交替每下+8
const FUMBLE_T = 0.5, ESCAPE_STAB = 50;
function inPod(x, y) { return Math.hypot(x - POD.x, y - POD.y) <= POD.r; }
// --- 危險 #1:爆桶(Phase 1)。靠近→點燃 0.5s→爆炸:炸飛+削弱穩定值;炸到艙門→短路過載 ---
const BARREL_IGNITE = 28, BARREL_FUSE = 0.5, BARREL_BLAST = 95, BARREL_FORCE = 700, BARREL_STAB = 50, BARREL_RESPAWN = 6;
const BARREL_SPOTS = [[300, 210], [660, 210], [300, 470], [660, 470]];
const barrels = BARREL_SPOTS.map(([x, y]) => ({ x, y, r: 13, state: 'idle', fuse: 0, alive: true, respawn: 0 }));
function resetBarrels() { for (const b of barrels) { b.state = 'idle'; b.fuse = 0; b.alive = true; b.respawn = 0; } }
// --- 道具系統 (spec F §3/§4): 補給座撿即用, 只拿 1, 用完即空; 風壓手套 / 傳送符 / 冰霜瓶 ---
const ITEM_TYPES = ['wind', 'teleport', 'ice'];
const ITEM_INFO = { wind: { name: '風壓手套', color: '#bfeaff' }, teleport: { name: '傳送符', color: '#c98cff' }, ice: { name: '冰霜瓶', color: '#9fd8ff' } };
const PAD_SPOTS = [[480, 140], [480, 500]]; // 補給座:上下中線(避開角落爆桶與中央實驗艙)
const PAD_RESPAWN = 5, PICKUP_R = 26;
const WIND_RANGE = 150, WIND_CONE = 1.0, WIND_FORCE = 620, WIND_SELF = 180; // 貼臉(<50)發射自身反彈=風壓過載
const TP_BLINK = 150, TP_JITTER = 20;
const ICE_R = 60, ICE_DUR = 5, ICE_THROW = 120, ICE_ACCEL = 7, ICE_FRICTION = 0.6;
const SLIDE_CONTAIN_V = 200; // 失控入艙:被擊退/打滑速度 > 此值且進艙半徑 = 收容(spec F §2.2)
function randItem() { return ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)]; }
const pads = PAD_SPOTS.map(([x, y]) => ({ x, y, r: 14, item: randItem(), respawn: 0 }));
function resetPads() { for (const p of pads) { p.item = randItem(); p.respawn = 0; } }
const iceZones = []; // { x, y, r, life }
function iceAt(x, y) { for (const z of iceZones) if (Math.hypot(x - z.x, y - z.y) <= z.r) return true; return false; }
// --- 三階段收容升級 (spec F §2.5): 每次收容 = 同一場事故的下一階段, 場地不重置, 危險升級 ---
let stage = 1;
let barrelRespawnCur = BARREL_RESPAWN, barrelFuseCur = BARREL_FUSE, padRespawnCur = PAD_RESPAWN, slideContainCur = SLIDE_CONTAIN_V;
const STAGE_NAME = ['普通', '黃色警戒', '全面失控'];
const STAGE_BANNER = ['臨時收容成功！樣本逃逸', '高危險樣本再收容！基地警戒升級'];
const METHOD_COL = { carry: '#8fb6ff', wind: '#bfeaff', ice: '#9fd8ff', barrel: '#ff9a4a', reverse: '#c98cff' };
const METHOD_ZH = { carry: '搬', wind: '吹', ice: '滑', barrel: '爆', reverse: '反向' };
function resetStage() { stage = 1; barrelRespawnCur = BARREL_RESPAWN; barrelFuseCur = BARREL_FUSE; padRespawnCur = PAD_RESPAWN; slideContainCur = SLIDE_CONTAIN_V; }
function applyStage(s) { // 危險升級:用現有爆桶+補給座+艙吸力(門檻)
  stage = s;
  if (s >= 2) { barrelRespawnCur = 4; barrelFuseCur = 0.4; padRespawnCur = 4; }
  if (s >= 3) { barrelRespawnCur = 3; slideContainCur = 150; } // 艙吸力變強
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
function slideKnock(f, dt) { // apply lingering knockback velocity only (no self-control)
  const sx = f.vx * dt, sy = f.vy * dt;
  if (!circleHitsSolid(f.x + sx, f.y, f.r) && !hitsFighter(f, f.x + sx, f.y)) f.x += sx; else f.vx = 0;
  if (!circleHitsSolid(f.x, f.y + sy, f.r) && !hitsFighter(f, f.x, f.y + sy)) f.y += sy; else f.vy = 0;
  f.x = clamp(f.x, f.r, W - f.r); f.y = clamp(f.y, f.r, H - f.r);
  const k = Math.pow(KNOCK_FRICTION, dt); f.vx *= k; f.vy *= k;
  if (KNOCK_CUTOFF && f.vx * f.vx + f.vy * f.vy < KNOCK_CUTOFF * KNOCK_CUTOFF) { f.vx = 0; f.vy = 0; }
}
// --- 角色實心化:角色不能互相重疊,但也「不能推」——走進對方會被擋下(對方原地不動)。
// 只擋「會讓兩人更靠近」的移動:已重疊時(換位傳送/出生點被蹲)永遠允許往外走,不會卡死。
// 搬運對豁免(被扛者本來就貼在搬運者身前)。BODY_SEP<1 讓視覺上能貼近到體素肩碰肩才停。
const BODY_SEP = 0.8;
function hitsFighter(f, nx, ny) {
  for (const o of fighters) {
    if (o === f || o.state !== 'alive' || o.falling) continue;
    if (f.carrying === o || o.carrying === f) continue;
    const rr = (f.r + o.r) * BODY_SEP;
    const dxn = nx - o.x, dyn = ny - o.y, d2n = dxn * dxn + dyn * dyn;
    if (d2n >= rr * rr) continue;
    const dxc = f.x - o.x, dyc = f.y - o.y;
    if (d2n >= dxc * dxc + dyc * dyc) continue; // 正在遠離 → 放行(防重疊卡死)
    return true;
  }
  return false;
}
function moveFighter(f, dt) {
  if (f.stunned || f.fumbleT > 0) { slideKnock(f, dt); return; } // 暈眩/踉蹌:不能自走,仍受擊退慣性
  const m = f.ai ? aiMove(f) : readMove(f.pid);
  if (f.pid === LOCAL && !f.ai) f.facing = Math.atan2(mouse.y - f.y, mouse.x - f.x); // 本地玩家:面向滑鼠(移動與瞄準解耦)
  else if (m.x || m.y) f.facing = Math.atan2(m.y, m.x);                              // AI／熱座紅方:面向移動方向
  const sp = SPEED * (f.carrying ? CARRY_SLOW : 1); // 搬運時變慢
  if (iceAt(f.x, f.y)) { // 冰面:打滑(走路變成加速度,低摩擦保留動量 → 滑行,可滑進艙)
    f.vx += m.x * sp * ICE_ACCEL * dt; f.vy += m.y * sp * ICE_ACCEL * dt;
    const vv = Math.hypot(f.vx, f.vy), vmax = sp * 1.4; if (vv > vmax) { f.vx *= vmax / vv; f.vy *= vmax / vv; }
    const isx = f.vx * dt, isy = f.vy * dt;
    if (!circleHitsSolid(f.x + isx, f.y, f.r) && !hitsFighter(f, f.x + isx, f.y)) f.x += isx; else f.vx = 0;
    if (!circleHitsSolid(f.x, f.y + isy, f.r) && !hitsFighter(f, f.x, f.y + isy)) f.y += isy; else f.vy = 0;
    f.x = clamp(f.x, f.r, W - f.r); f.y = clamp(f.y, f.r, H - f.r);
    const ik = Math.pow(ICE_FRICTION, dt); f.vx *= ik; f.vy *= ik;
    return;
  }
  const stepX = (m.x * sp + f.vx) * dt;
  const stepY = (m.y * sp + f.vy) * dt;
  if (!circleHitsSolid(f.x + stepX, f.y, f.r) && !hitsFighter(f, f.x + stepX, f.y)) f.x += stepX; else f.vx = 0;
  if (!circleHitsSolid(f.x, f.y + stepY, f.r) && !hitsFighter(f, f.x, f.y + stepY)) f.y += stepY; else f.vy = 0;
  f.x = clamp(f.x, f.r, W - f.r); f.y = clamp(f.y, f.r, H - f.r);
  if (FREEFORM) bridgeAssist(f);
  const k = Math.pow(KNOCK_FRICTION, dt); f.vx *= k; f.vy *= k;
  if (KNOCK_CUTOFF && f.vx * f.vx + f.vy * f.vy < KNOCK_CUTOFF * KNOCK_CUTOFF) { f.vx = 0; f.vy = 0; } // snap out the ice-slide tail
}

// --- 打擊回饋管線:受擊 flinch(模型甩頭/壓扁) + 方向性鏡頭踹(camera kick) ---
function flinch(o, a, t = 0.22) { o.flinchA = a; o.flinchT = Math.max(o.flinchT || 0, t); }
function camKick(a, mag) { game.kickX = Math.cos(a) * mag; game.kickY = Math.sin(a) * mag; } // render 加在鏡頭上,step 裡快速衰減

// --- 基礎動詞 (spec F §2): 揮拳(削穩定值→擊暈) + 情境動作鍵(暈眩對手在近處→抓; 搬運中→放下; 否則→揮拳) ---
function stunFighter(o) {
  o.stunned = true; o.stunT = STUN_T; o.vx *= 0.4; o.vy *= 0.4;
  addText(o.x, o.y - 30, '暈！', '#ffd36d'); addRing(o.x, o.y, 30, '#ffd36d', 0.3, 4);
  addHitstop(0.12); addShake(6); game.sfx.push('hurt'); // 擊暈=大事件:更長定格+重音,把「打崩了」讀出來
  if (o.pid === LOCAL) localFlash = 0.3;
}
function punch(f) {
  if (f.punchCd > 0 || f.stunned || f.carrying || f.carriedBy || f.fumbleT > 0 || f.state !== 'alive') return;
  f.punchCd = PUNCH_CD;
  f.punchFx = game.time; f.punchArm = f.punchArm ? 0 : 1; // 觸發出拳動畫(左右手交替)
  const a = f.facing; let hit = false;
  f.vx += Math.cos(a) * 110; f.vy += Math.sin(a) * 110; // 出拳衝步(lunge):整個人往前撲,不只手臂在動
  for (const o of fighters) {
    if (o === f || o.state !== 'alive' || o.carriedBy || o.invuln > 0) continue;
    const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy);
    if (d > PUNCH_RANGE + o.r) continue;
    let da = Math.atan2(dy, dx) - a; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > PUNCH_CONE) continue;
    hit = true;
    o.vx += Math.cos(a) * PUNCH_KNOCK; o.vy += Math.sin(a) * PUNCH_KNOCK;
    o.faceT = 0.2; o.hurt = 0.12; o.lastHitBy = f.pid; o.lastHitT = game.time;
    o.stability = Math.max(0, o.stability - PUNCH_STAB); o.stabCd = 0.8; // 削穩定值(命中暫停回穩)
    flinch(o, a);                                                        // 受擊:朝受力方向甩頭+壓扁回彈
    const cpx = o.x - Math.cos(a) * o.r * 0.7, cpy = o.y - Math.sin(a) * o.r * 0.7; // 火花開在拳頭接觸點,不是身體中心
    hitSpark(cpx, cpy, '#ffe0a3', 1.5); addRing(cpx, cpy, 20, '#ffd36d', 0.22, 3);
    if (o.stability <= 0 && !o.stunned && o.restunT <= 0) stunFighter(o); // 穩定值歸零 → 擊暈
    if (o.pid === LOCAL) localFlash = 0.2;
  }
  // 揮空/命中分離回饋:命中=悶擊聲+長定格+方向性鏡頭踹;揮空=風聲+輕震(出拳動作本身由手臂動畫承擔)
  if (hit) { addShake(4); addHitstop(0.09); camKick(a, 7); game.sfx.push('thud'); }
  else { addShake(1.5); game.sfx.push('whiff'); }
}
function startCarry(f, o) {
  f.carrying = o; o.carriedBy = f; o.escape = 0; o.stunned = false; o.stunT = 0; o.mashSide = 0; o._aPrev = false; o._dPrev = false;
  addText(o.x, o.y - 30, '抓住！', COLORS[f.pid]); addRing(o.x, o.y, 34, COLORS[f.pid], 0.35, 4); addShake(4); game.sfx.push('upgrade');
  dlog('GRAB', NAMES[f.pid], '→', NAMES[o.pid]);
}
function dropCarry(f) { const o = f.carrying; if (o) { o.carriedBy = null; o.stability = Math.max(o.stability, 30); } f.carrying = null; f.regrabCd = REGRAB_CD; }
function breakFree(o) { // 掙脫成功: 搬運者踉蹌 → 反轉窗口
  const f = o.carriedBy; o.carriedBy = null; o.escape = 0; o.stability = ESCAPE_STAB; inc.struggleEscapes++;
  if (f) { f.carrying = null; f.fumbleT = FUMBLE_T; f.regrabCd = REGRAB_CD; f.wasCarryingT = game.time; if (f.pid === LOCAL) localFlash = 0.28; }
  addText(o.x, o.y - 30, '掙脫！', COLORS[o.pid]); addRing(o.x, o.y, 32, COLORS[o.pid], 0.35, 4); addShake(5); game.sfx.push('dash');
  dlog('ESCAPE', NAMES[o.pid], 'from', f ? NAMES[f.pid] : '?');
}
function isReversal(v) { return game.time - (v.wasCarryingT || -9) < 2.5; } // 被關者剛剛還在搬人 → 反向收容
function containByCarry(f, o) { // 拖進艙 = 收容成功 (spec F §2.2 失控入艙)
  const w = f.pid, rev = isReversal(o);
  inc.contains[w]++; inc.carries[w]++; inc.types.add('contain');
  if (rev) { inc.reverseContains++; inc.types.add('reverse'); }
  f.carrying = null; o.carriedBy = null;
  resolveContain(w, o, rev ? 'reverse' : 'carry');
}
// --- 三階段收容 (spec F §2.5): 每次收容 → 記 log + 計分; 前兩次軟重整升級, 第三次最終封存 ---
function resolveContain(w, loser, method) {
  roundWins[w]++; winnerPid = w;
  containLog.push({ winner: w, method, stage });
  addRing(POD.x, POD.y, POD.r * 1.8, COLORS[w], 0.5, 5); addShake(6);
  dlog('CONTAIN', NAMES[loser.pid], '→', NAMES[w], method, 'score', roundWins[0] + '-' + roundWins[1]);
  if (roundWins[w] >= WIN_TARGET) finalSeal(w);
  else softReintegrate(loser, roundWins[0] + roundWins[1]);
}
function finalSeal(w) { // 第三次 = 最終封存儀式 → 事故報告
  bannerText = NAMES[w] + ' 最終封存完成！'; winBannerT = 3.0;
  addText(POD.x, POD.y - 48, '最終封存完成', COLORS[w]);
  addRing(POD.x, POD.y, POD.r * 3.2, COLORS[w], 0.7, 9); addRing(POD.x, POD.y, POD.r * 2.1, '#ffffff', 0.5, 6);
  addShake(12); addHitstop(0.4); game.sfx.push('waveclear'); game.sfx.push('upgrade');
  endMatch(w);
}
function softReintegrate(loser, total) { // 非第三次:被收容者出生點彈出+無敵, 場地不重置, 警戒升級
  const next = Math.min(3, total + 1); applyStage(next);
  bannerText = STAGE_BANNER[Math.min(total - 1, STAGE_BANNER.length - 1)]; winBannerT = 1.6;
  addText(POD.x, POD.y - 48, NAMES[1 - loser.pid] + ' 收容成功　→ ' + STAGE_NAME[next - 1], COLORS[1 - loser.pid]);
  addHitstop(0.35); game.sfx.push('upgrade');
  resetFighter(loser); loser.invuln = 1.8; // 彈回出生點 + 無敵(不能被抓/打)
}
function doAction(f) { // 情境動作鍵
  if (f.state !== 'alive' || f.stunned || f.carriedBy || f.fumbleT > 0) return;
  if (f.carrying) { dropCarry(f); return; }
  const o = fighters[1 - f.pid];
  if (f.regrabCd <= 0 && o.state === 'alive' && o.stunned && !o.carriedBy && o.invuln <= 0 && Math.hypot(o.x - f.x, o.y - f.y) <= GRAB_RANGE + o.r) { startCarry(f, o); return; }
  punch(f);
}
// --- 滑鼠操作(本地玩家):滑鼠瞄準 + 左鍵揮拳 + 右鍵情境(搬運中放下 → 暈眩對手在近處抓 → 否則用道具) ---
function mouseLeft(f) { if (f.state === 'alive') punch(f); }                   // 左鍵=揮拳(punch 自帶狀態守衛)
function mouseRight(f) {                                                        // 右鍵=拖被擊暈的人 / 放技能(道具)
  if (f.state !== 'alive') return;
  if (f.carrying) { dropCarry(f); return; }                                    // 搬運中 → 放下
  if (!f.carriedBy && !f.stunned && f.fumbleT <= 0 && f.regrabCd <= 0) {        // 空手且可動作 → 優先抓近處被擊暈的對手
    const o = fighters[1 - f.pid];
    if (o.state === 'alive' && o.stunned && !o.carriedBy && o.invuln <= 0 && Math.hypot(o.x - f.x, o.y - f.y) <= GRAB_RANGE + o.r) { startCarry(f, o); return; }
  }
  useItem(f); // 否則放技能(useItem 自帶守衛:無道具直接略過;被抓/暈時只有傳送可用)
}
// edge-triggered action key (human only); AI 透過 aiMove 直接呼叫 punch/startCarry
const actionPrev = [false, false];
function pollAction() {
  const pressed = [keys.has('j'), keys.has('/')];
  for (let i = 0; i < 2; i++) { if (fighters[i].ai) continue; if (pressed[i] && !actionPrev[i]) doAction(fighters[i]); actionPrev[i] = pressed[i]; }
}

// --- 道具:撿取 / 使用 (spec F §4). 補給座重刷隨機道具; 只拿1; 用完即空; 傳送符是被抓時唯一可用 ---
function updatePads(dt) {
  for (const p of pads) {
    if (!p.item) { p.respawn -= dt; if (p.respawn <= 0) p.item = randItem(); continue; }
    for (const f of fighters) {
      if (f.ai || f.state !== 'alive' || f.item || f.carriedBy || f.carrying || f.stunned) continue; // AI 這步不撿道具
      if (Math.hypot(f.x - p.x, f.y - p.y) < PICKUP_R + f.r) {
        f.item = p.item; p.item = null; p.respawn = padRespawnCur;
        addText(f.x, f.y - 32, ITEM_INFO[f.item].name + '！', ITEM_INFO[f.item].color); addRing(f.x, f.y, 28, ITEM_INFO[f.item].color, 0.3, 4); game.sfx.push('upgrade');
        dlog('PICKUP', NAMES[f.pid], f.item); break;
      }
    }
  }
}
function updateIce(dt) { for (let i = iceZones.length - 1; i >= 0; i--) { iceZones[i].life -= dt; if (iceZones[i].life <= 0) iceZones.splice(i, 1); } }
function useItem(f) {
  if (!f.item || f.state !== 'alive' || f.carrying) return;                 // 搬運中兩手全滿,不能用道具
  const grabbed = !!f.carriedBy;
  if ((grabbed || f.stunned || f.fumbleT > 0) && f.item !== 'teleport') return; // 被抓/暈/踉蹌:只有傳送能用
  const type = f.item; f.item = null;                                        // 用完即空
  inc.itemUses[type]++;
  if (type === 'wind') castWind(f);
  else if (type === 'teleport') castTeleport(f);
  else if (type === 'ice') castIce(f);
}
function castWind(f) { // 前方風錐強擊退; 貼臉發射自身反彈(過載)
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
    if (o.pid === LOCAL) localFlash = 0.25;
    if (d < 50) { f.vx -= Math.cos(a) * WIND_SELF; f.vy -= Math.sin(a) * WIND_SELF; inc.itemBackfires++; addText(f.x, f.y - 32, '過載反彈！', '#ff9a9a'); } // 風壓過載自反噬
  }
  addRing(f.x + Math.cos(a) * 30, f.y + Math.sin(a) * 30, 62, '#dff3ff', 0.25, 5); addShake(hit ? 5 : 3); game.sfx.push('dash');
  dlog('WIND', NAMES[f.pid], hit ? 'hit' : 'miss');
}
function castTeleport(f) { // 與對手換位(±偏移); 被抓時=脫困+搬運者踉蹌
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
function castIce(f) { // 前方丟出 → 冰面
  const lx = clamp(f.x + Math.cos(f.facing) * ICE_THROW, 24, W - 24), ly = clamp(f.y + Math.sin(f.facing) * ICE_THROW, 24, H - 24);
  iceZones.push({ x: lx, y: ly, r: ICE_R, life: ICE_DUR });
  addRing(lx, ly, ICE_R, ITEM_INFO.ice.color, 0.4, 5); addText(lx, ly - 20, '冰面！', ITEM_INFO.ice.color); game.sfx.push('dash');
  dlog('ICE @', Math.round(lx) + ',' + Math.round(ly));
}
function containByEnviron(v, cause) { // 被擊退/打滑失控進艙 → v 被收容, 對手勝(spec F §2.2)
  const w = 1 - v.pid, rev = isReversal(v);
  inc.contains[w]++; inc.types.add('contain');
  inc.accidentContains[cause] = (inc.accidentContains[cause] || 0) + 1; inc.types.add(cause);
  if (cause === 'ice') inc.itemBackfires++;                 // 踩(自己的)冰面滑進艙 = 自作自受
  if (rev) { inc.reverseContains++; inc.types.add('reverse'); }
  if (v.carriedBy) { v.carriedBy.carrying = null; v.carriedBy = null; }
  resolveContain(w, v, rev ? 'reverse' : cause);
}
// edge-triggered item key (human only; K / '.')
const itemPrev = [false, false];
function pollItem() {
  const pressed = [keys.has('k'), keys.has('.')];
  for (let i = 0; i < 2; i++) { if (fighters[i].ai) continue; if (pressed[i] && !itemPrev[i]) useItem(fighters[i]); itemPrev[i] = pressed[i]; }
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
  let gx, gy;
  if (f.carrying) { gx = POD.x; gy = POD.y; }             // 扛著人 → 拖去實驗艙
  else { gx = o.x; gy = o.y; }                            // 追對手(打暈/抓)
  const dx = gx - f.x, dy = gy - f.y, dl = Math.hypot(dx, dy) || 1;
  const dir = FREEFORM ? aiSafeDir(f, dx / dl, dy / dl) : { x: dx / dl, y: dy / dl };
  if (dir.x || dir.y) f.facing = Math.atan2(dir.y, dir.x);
  // actions: grab a stunned rival, else punch when in range
  if (!f.carrying && f.fumbleT <= 0 && o.state === 'alive' && !o.carriedBy && o.invuln <= 0) {
    const od = Math.hypot(o.x - f.x, o.y - f.y);
    if (o.stunned && f.regrabCd <= 0 && od <= GRAB_RANGE + o.r) { f.facing = Math.atan2(o.y - f.y, o.x - f.x); startCarry(f, o); }
    else if (!o.stunned && f.punchCd <= 0 && od <= PUNCH_RANGE + o.r) { f.facing = Math.atan2(o.y - f.y, o.x - f.x); punch(f); }
  }
  return dir;
}

// --- 有界跟隨(bounded follow):鏡頭跟一個「平滑 + 夾在內縮框裡」的代理點,而不是直接黏在角色上。
// 角色走到場邊時鏡頭停住不再跟過去 → 永遠不把場外黑色露進畫面(消滅留白);順帶消除跟隨抖動。
// 只用在平台場;浮島/格子場仍直接跟角色。數值可用 __v2.CAMB 即時微調。
const camRig = { x: SPAWN[0].x, y: SPAWN[0].y };
// cam-2(fov32/angle44/dist650)的視錐比場地窄 → 水平「有界跟隨」才對:X 夾在 [ix, W-ix]，
// ix 是兩側留邊,讓玩家貼牆時仍在畫面內、又不會越過側牆露出黑邊(ix=250 實測兩牆都不露黑)。
// 舊的 ix=480 固定置中是為了更寬的視錐,換成 cam-2 後角落出生的玩家會整個掉出左邊 → 這裡改成跟隨。
// 垂直同樣用有界跟隨(ny/sy)給跟隨感又不露上下黑邊。
const CAMB = { ix: 250, ny: 210, sy: 500, ease: 8 }; // ix=左右夾界(跟隨玩家 X，兩側牆內留邊), ny/sy=北/南夾界, ease=平滑
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
let winnerPid = -1, winBannerT = 0, bannerText = '';
// --- 魔法事故報告 (spec E / V0.8): a match = first to WIN_TARGET containments → generate an incident report ---
const WIN_TARGET = 3;
const roundWins = [0, 0];
const containLog = []; // { winner, method, stage } per containment → 三格 UI + 報告三幕
let matchOver = false, report = null;
const inc = { falls: [0, 0], knockoffs: [0, 0], selfFalls: [0, 0], bossCatches: 0, grabs: [0, 0], types: new Set(), matchT: 0, maxHold: 0,
  contains: [0, 0], overloads: 0, selfPods: 0, barrelBooms: 0, itemUses: { wind: 0, teleport: 0, ice: 0 },
  carries: [0, 0], accidentContains: { wind: 0, ice: 0, barrel: 0 }, reverseContains: 0, teleportEscapes: 0, struggleEscapes: 0, itemBackfires: 0 };
function resetInc() {
  inc.contains = [0, 0]; inc.overloads = 0; inc.selfPods = 0; inc.barrelBooms = 0; inc.itemUses = { wind: 0, teleport: 0, ice: 0 };
  inc.carries = [0, 0]; inc.accidentContains = { wind: 0, ice: 0, barrel: 0 }; inc.reverseContains = 0; inc.teleportEscapes = 0; inc.struggleEscapes = 0; inc.itemBackfires = 0;
  inc.types = new Set(); inc.matchT = 0;
}
const overAir = (x, y) => game.isVoidAt ? game.isVoidAt({ x, y }) : false; // free-form: off-island?

function resetRound() {
  holderPid = -1; holdMeter[0] = 0; holdMeter[1] = 0;
  trophy.held = false; trophy.x = FAR.x; trophy.y = FAR.z;
  boss.awake = false; boss.wakeT = 0; boss.x = FAR.x; boss.y = FAR.z - 12;
  resetBarrels(); resetPads(); iceZones.length = 0;
  for (const f of fighters) resetFighter(f);
}
function dropTrophy(x, y) {
  holderPid = -1; trophy.held = false; boss.awake = false; // boss sleeps until someone grabs again
  trophy.x = clamp(x, 40, W - 40); trophy.y = clamp(y, 40, H - 40);
  if (overAir(trophy.x, trophy.y)) { trophy.x = FAR.x; trophy.y = FAR.z; } // don't lose it down the abyss
  addText(trophy.x, trophy.y - 30, '獎盃掉落！', '#ffd36d');
}
function explodeBarrel(b) {
  b.alive = false; b.respawn = barrelRespawnCur; inc.barrelBooms++; inc.types.add('barrel');
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
    if (f.pid === LOCAL) localFlash = 0.32;
  }
  dlog('BARREL boom @', Math.round(b.x) + ',' + Math.round(b.y));
}
function updateBarrels(dt) {
  for (const b of barrels) {
    if (!b.alive) { b.respawn -= dt; if (b.respawn <= 0) { b.alive = true; b.state = 'idle'; } continue; }
    if (b.state === 'idle') {
      for (const f of fighters) { if (f.state === 'alive' && Math.hypot(f.x - b.x, f.y - b.y) < BARREL_IGNITE + f.r) { b.state = 'fuse'; b.fuse = barrelFuseCur; addText(b.x, b.y - 26, '!', '#ffd36d'); game.sfx.push('dash'); break; } }
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
  inc.falls = [0, 0]; inc.knockoffs = [0, 0]; inc.selfFalls = [0, 0]; inc.bossCatches = 0; inc.grabs = [0, 0]; inc.maxHold = 0;
  resetInc(); containLog.length = 0; bannerText = ''; winBannerT = 0; resetStage();
  resetRound();
}
function mostUsedItem() {
  const u = inc.itemUses, max = Math.max(u.wind, u.teleport, u.ice);
  if (max === 0) return inc.barrelBooms > 0 ? '爆桶' : '（徒手)';
  return u.teleport === max ? '傳送符' : u.ice === max ? '冰霜瓶' : '風壓手套';
}
function pickComment() {
  if (inc.reverseContains >= 1) return '技術上來說，有人被成功收容了。只是收錯人。';
  if (inc.itemBackfires >= 2) return '受測體最大的敵人，始終是自己手上的道具。';
  if (inc.accidentContains.ice >= 1) return '冰面很滑，收容艙很近。剩下的是物理問題。';
  if (inc.accidentContains.wind >= 1) return '風的方向，有時比法術更難預測。';
  if (inc.barrelBooms >= 3) return '魔法倉庫的爆桶不是裝飾品。雖然你們把它當成了。';
  if (inc.itemUses.teleport >= 3) return '請停止濫用傳送符。空間結構有它的極限。';
  return '收容程序完成。過程恕不予置評。';
}
function generateReport(winner) {
  const ac = inc.accidentContains, accTotal = ac.wind + ac.ice + ac.barrel;
  const dangerKinds = (inc.itemUses.teleport > 0 ? 1 : 0) + (inc.barrelBooms > 0 ? 1 : 0); // 涉案危險級道具種類(概念§8)
  const chaos = inc.carries[0] + inc.carries[1] + accTotal * 2 + inc.reverseContains * 3
    + inc.itemBackfires + inc.barrelBooms + dangerKinds;
  const level = chaos >= 14 ? 'S+' : chaos >= 10 ? 'S' : chaos >= 7 ? 'A' : chaos >= 5 ? 'B' : chaos >= 3 ? 'C' : 'D';
  let name, summary;
  if (inc.reverseContains >= 2) { name = '反向收容拉鋸事件'; summary = `收容員與受測體多次互換身分，反向收容共 ${inc.reverseContains} 次。`; }
  else if (inc.reverseContains >= 1) { name = '反向收容事件'; summary = `有人剛要完成收容，轉眼自己被關了進去。`; }
  else if (inc.barrelBooms >= 3) { name = '連環爆破事件'; summary = `爆桶連環引爆 ${inc.barrelBooms} 次，現場已無「桶」的概念。`; }
  else if (inc.itemBackfires >= 2) { name = '自體事故頻發事件'; summary = `受測體被自己的道具害到 ${inc.itemBackfires} 次，展現高度自我毀滅天賦。`; }
  else if (ac.ice >= 1) { name = '自投羅網事件'; summary = `${ac.ice} 次有人在冰面上一路滑進了收容艙。`; }
  else if (ac.wind >= 1) { name = '強風收容事件'; summary = `${ac.wind} 次有人被一陣風直接吹進收容艙。`; }
  else if (inc.itemUses.teleport >= 3) { name = '空間錯亂事件'; summary = `傳送符被使用 ${inc.itemUses.teleport} 次，沒人確定自己現在站在哪。`; }
  else if (inc.barrelBooms >= 1) { name = '倉庫起火事件'; summary = `爆桶被引爆 ${inc.barrelBooms} 次，安全規範表示遺憾。`; }
  else { name = '標準收容測試'; summary = '收容程序大致完成，僅輕微失控。'; }
  const title = inc.reverseContains >= 1 ? '換位藝術家'
    : inc.itemBackfires >= 2 ? '自助受測體'
    : inc.barrelBooms >= 3 ? '爆破藝術家'
    : ac.ice >= 1 ? '滑冰收容大師'
    : inc.carries[winner] >= 2 ? '王牌收容員' : '合格但不可取';
  const damage = Math.min(99, chaos * 8);
  const code = 'MIR-' + Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
  const comment = pickComment();
  const mostUsed = mostUsedItem();
  const num = 100 + ((chaos * 7 + inc.contains[0] * 3 + inc.contains[1] * 5 + inc.reverseContains * 11) % 900);
  const share = `我在《魔法事故報告》觸發了 ${level} 級事故：${name}。\n${NAMES[winner]} 完成收容，基地損害 ${damage}%，主要涉案道具「${mostUsed}」。\n安全委員會：「${comment}」\n挑戰碼：${code}`;
  return { num, name, level, winner, summary, comment, title, code, damage, mostUsed, share, time: inc.matchT };
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
    flinch(t, Math.atan2(dy, dx), 0.32);
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
  if (game.kickX || game.kickY) { const kd = Math.pow(0.00005, dt); game.kickX *= kd; game.kickY *= kd; if (Math.abs(game.kickX) + Math.abs(game.kickY) < 0.1) { game.kickX = 0; game.kickY = 0; } } // 鏡頭踹:~80ms 彈回
  if (winBannerT > 0) winBannerT -= dt;
  if (localFlash > 0) localFlash -= dt;
  if (fallReasonT > 0) fallReasonT -= dt;
  updateParticles(dt); updateRings(dt); updateFloatingTexts(dt);
  if (game.hitstop > 0) { game.hitstop -= dt; }
  else {
    pollAction(); pollItem();
    for (const f of fighters) {
      if (f.state === 'down') { f.respawn -= dt; if (f.respawn <= 0) resetFighter(f); continue; }
      // cooldown timers
      if (f.punchCd > 0) f.punchCd -= dt;
      if (f.regrabCd > 0) f.regrabCd -= dt;
      if (f.fumbleT > 0) f.fumbleT -= dt;
      if (f.restunT > 0) f.restunT -= dt;
      if (f.invuln > 0) f.invuln -= dt;
      if (f.flinchT > 0) f.flinchT -= dt;
      // stability regen (paused right after a hit; frozen while stunned/carried)
      if (f.stabCd > 0) f.stabCd -= dt; else if (!f.stunned && !f.carriedBy) f.stability = Math.min(STAB_MAX, f.stability + STAB_REGEN * dt);
      // stun countdown → recover (ungrabbed)
      if (f.stunned) { f.stunT -= dt; if (f.stunT <= 0) { f.stunned = false; f.stability = STUN_RECOVER; f.restunT = RESTUN_IMMUNE; } }
      // death theatre (isles over-void fall; no-op on the flat arena)
      if (updateDeathTheater(f, dt)) {
        if (f.dead) {
          f.state = 'down'; f.respawn = RESPAWN; f.dead = false;
          if (f.carrying) dropCarry(f); if (f.carriedBy) breakFree(f);
          inc.falls[f.pid]++;
          if (f.lastHitBy >= 0 && f.lastHitBy !== f.pid) { inc.knockoffs[f.lastHitBy]++; inc.types.add('knockoff'); }
          else { inc.selfFalls[f.pid]++; inc.types.add('self'); }
        }
        continue;
      }
      if (!f.carriedBy) moveFighter(f, dt); // carried fighter is positioned by the carry loop below
    }
    // 搬運: 被搬者跟隨在搬運者身前 + 全程掙脫 + 拖進艙 = 收容
    for (const f of fighters) {
      if (!f.carrying) continue;
      const o = f.carrying;
      if (o.state !== 'alive' || f.state !== 'alive' || f.stunned) { dropCarry(f); continue; }
      o.x = f.x + Math.cos(f.facing) * (f.r + o.r * 0.7); o.y = f.y + Math.sin(f.facing) * (f.r + o.r * 0.7); o.vx = 0; o.vy = 0;
      if (inPod(o.x, o.y)) { containByCarry(f, o); continue; }                 // 失控入艙 → 收容
      if (o.ai) o.escape += CARRY_MASH_AI * dt;                                // AI 固定填速
      else {                                                                    // 人類: 左右交替點按(按指示)
        const aDown = keys.has('a'), dDown = keys.has('d');
        const aEdge = aDown && !o._aPrev, dEdge = dDown && !o._dPrev;
        if (o.mashSide === 0 && aEdge) { o.escape += CARRY_MASH_TAP; o.mashSide = 1; }
        else if (o.mashSide === 1 && dEdge) { o.escape += CARRY_MASH_TAP; o.mashSide = 0; }
        o._aPrev = aDown; o._dPrev = dDown;
      }
      if (o.escape >= CARRY_ESCAPE_NEED) breakFree(o);
    }
    // 失控入艙: 被擊退/打滑(速度夠快)或暈眩者進到艙半徑 → 收容(對手勝)。無敵中免疫。
    for (const f of fighters) {
      if (f.state !== 'alive' || f.carriedBy || f.carrying || f.invuln > 0) continue;
      if ((f.stunned || Math.hypot(f.vx, f.vy) > slideContainCur) && inPod(f.x, f.y)) {
        const cause = iceAt(f.x, f.y) ? 'ice' : (f.lastHitBy === -3 ? 'barrel' : 'wind');
        containByEnviron(f, cause); break;
      }
    }
    updateBarrels(dt); updatePads(dt); updateIce(dt); // 爆桶 / 補給座重刷 / 冰面消退
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
  // ground markers: 青綠實驗艙光 + 橘色爆桶危險區(引信中更亮更快閃)
  const carrying = fighters.some(f => f.carrying);
  const marks = [{ x: POD.x, y: POD.y, r: POD.r, color: carrying ? '#c661ff' : '#4dffcf', pulse: true, op: 0.72, fill: 0.16, speed: carrying ? 8 : 3 }];
  for (const b of barrels) if (b.alive && b.state === 'fuse') // 平時不畫;只有引信中(快爆)才亮出完整爆炸範圍危險環
    marks.push({ x: b.x, y: b.y, r: BARREL_BLAST * 0.85, color: '#ff7a3a', pulse: true, op: 0.92, fill: 0.24, speed: 18 });
  for (const z of iceZones) marks.push({ x: z.x, y: z.y, r: z.r, color: '#bfe9ff', pulse: false, op: 0.4, fill: 0.28 }); // 冰面
  for (const p of pads) if (p.item) marks.push({ x: p.x, y: p.y, r: 24, color: ITEM_INFO[p.item].color, pulse: true, op: 0.5, fill: 0.12, speed: 4 }); // 補給座光圈
  setGroundMarkers(marks);
  if (game.camTarget === camRig) updateCamRig(dt); // flat mode: smoothed, bounded camera follow
}

function drawContainHud() {
  // 實驗艙地面光環 + 穩定值小條 + 暈眩冒星 + 搬運掙脫條/交替指示
  const pulse = 0.6 + 0.4 * Math.sin(game.time * 5);
  const c = project(POD.x, POD.y, 2), edge = project(POD.x + POD.r, POD.y, 2);
  if (!c.behind) {
    const rad = Math.max(14, Math.abs(edge.x - c.x));
    hctx.save();
    hctx.strokeStyle = `rgba(154,255,208,${0.5 + pulse * 0.3})`;
    hctx.lineWidth = 4; hctx.beginPath(); hctx.ellipse(c.x, c.y, rad, rad * 0.5, 0, 0, Math.PI * 2); hctx.stroke();
    hctx.restore();
  }
  for (const f of fighters) {
    if (f.state !== 'alive') continue;
    // 身分光環:每個角色腳下永遠畫「自身顏色」的環(本機更亮更粗＋朝向指針＋「你」),
    // 這樣就算暈眩(黃)/低穩定(橘)把血條變色,誰是你也永遠一眼可辨(修正「顏色跟對方同步、認不出自己」)。
    const gc = project(f.x, f.y, 2), ge = project(f.x + (f.r || 14), f.y, 2);
    if (!gc.behind) {
      const gr = Math.max(10, Math.abs(ge.x - gc.x)), isMe = f.pid === LOCAL;
      hctx.save();
      hctx.strokeStyle = COLORS[f.pid]; hctx.globalAlpha = isMe ? 0.95 : 0.5; hctx.lineWidth = isMe ? 3 : 2;
      hctx.beginPath(); hctx.ellipse(gc.x, gc.y, gr, gr * 0.5, 0, 0, Math.PI * 2); hctx.stroke();
      if (isMe) { // 朝向箭頭(配合滑鼠瞄準,畫在地面橢圓上)＋「你」標
        hctx.globalAlpha = 1;
        const ax = Math.cos(f.facing), ay = Math.sin(f.facing) * 0.5;         // y 壓扁對齊橢圓地面
        const al = Math.hypot(ax, ay) || 1, nx = ax / al, ny = ay / al;        // 單位方向
        const tipX = gc.x + ax * (gr + 15), tipY = gc.y + ay * (gr + 15);      // 箭尖伸出環外
        hctx.beginPath(); hctx.moveTo(gc.x + ax * gr * 0.5, gc.y + ay * gr * 0.5); hctx.lineTo(tipX - nx * 9, tipY - ny * 9); hctx.lineWidth = 4; hctx.stroke(); // 箭桿
        const hw = 8, bx = tipX - nx * 13, by = tipY - ny * 13, px = -ny, py = nx; // 箭頭三角
        hctx.beginPath(); hctx.moveTo(tipX, tipY); hctx.lineTo(bx + px * hw, by + py * hw); hctx.lineTo(bx - px * hw, by - py * hw); hctx.closePath();
        hctx.fillStyle = COLORS[f.pid]; hctx.fill();
        hctx.font = '900 12px system-ui, sans-serif'; hctx.textAlign = 'center';
        hctx.fillText('你', gc.x, gc.y + gr * 0.5 + 13);
      }
      hctx.restore();
    }
    const s = project(f.x, f.y, (f.r || 14) * 2.2 + 16);
    if (s.behind) continue;
    const bw = 30, p = clamp(f.stability / STAB_MAX, 0, 1);
    hctx.textAlign = 'center';
    hctx.fillStyle = 'rgba(0,0,0,.5)'; hctx.fillRect(s.x - bw / 2, s.y, bw, 4);
    // 血條:暈眩=黃、低穩定=橘(危險色,刻意不用紅色以免撞到紅方身分色)、其餘=自身身分色
    hctx.fillStyle = f.stunned ? '#ffd36d' : (f.stability < 30 ? '#ff9a4a' : COLORS[f.pid]); hctx.fillRect(s.x - bw / 2, s.y, bw * p, 4);
    if (f.stunned) { hctx.fillStyle = '#ffd36d'; hctx.font = '900 16px system-ui, sans-serif'; hctx.fillText('★', s.x, s.y - 6); }
    if (f.invuln > 0 && Math.floor(game.time * 12) % 2 === 0) { // 出艙無敵:閃爍護盾環
      const g = project(f.x, f.y, 10);
      if (!g.behind) { hctx.strokeStyle = '#7fe9ff'; hctx.lineWidth = 3; hctx.beginPath(); hctx.arc(g.x, g.y, 22, 0, Math.PI * 2); hctx.stroke(); }
    }
    if (f.carriedBy) { // 掙脫條 + 左右交替指示
      const ep = clamp(f.escape / CARRY_ESCAPE_NEED, 0, 1);
      hctx.fillStyle = 'rgba(0,0,0,.5)'; hctx.fillRect(s.x - bw / 2, s.y - 13, bw, 5);
      hctx.fillStyle = '#9affd0'; hctx.fillRect(s.x - bw / 2, s.y - 13, bw * ep, 5);
      if (!f.ai) { hctx.fillStyle = '#fff'; hctx.font = '900 13px system-ui, sans-serif'; hctx.fillText(f.mashSide === 0 ? '◀ A' : 'D ▶', s.x, s.y - 18); }
    }
  }
}
function drawPips(pid, x0, dir) { // 三格收容進度:填色=收容方式
  const size = 22, gap = 6, y0 = 26;
  const mine = containLog.filter(c => c.winner === pid);
  for (let i = 0; i < WIN_TARGET; i++) {
    const px = dir === 1 ? x0 + i * (size + gap) : x0 - size - i * (size + gap);
    hctx.fillStyle = mine[i] ? (METHOD_COL[mine[i].method] || COLORS[pid]) : 'rgba(255,255,255,.12)';
    hctx.fillRect(px, y0, size, size);
    hctx.strokeStyle = COLORS[pid]; hctx.lineWidth = 2; hctx.strokeRect(px + 1, y0 + 1, size - 2, size - 2);
  }
}
function drawItems() {
  hctx.textAlign = 'center'; hctx.textBaseline = 'alphabetic';
  for (const p of pads) { // 補給座上的道具球 + 名稱
    if (!p.item) continue;
    const s = project(p.x, p.y, 20 + Math.sin(game.time * 3) * 3); if (s.behind) continue;
    hctx.fillStyle = ITEM_INFO[p.item].color; hctx.beginPath(); hctx.arc(s.x, s.y, 9, 0, Math.PI * 2); hctx.fill();
    hctx.strokeStyle = 'rgba(255,255,255,.8)'; hctx.lineWidth = 2; hctx.stroke();
    hctx.fillStyle = '#eafaff'; hctx.font = '700 10px system-ui, sans-serif'; hctx.fillText(ITEM_INFO[p.item].name, s.x, s.y - 14);
  }
  for (const f of fighters) { // 持有道具:頭頂小球
    if (!f.item || f.state !== 'alive') continue;
    const s = project(f.x, f.y, (f.r || 14) * 2.2 + 34); if (s.behind) continue;
    hctx.fillStyle = ITEM_INFO[f.item].color; hctx.beginPath(); hctx.arc(s.x, s.y, 7, 0, Math.PI * 2); hctx.fill();
    hctx.strokeStyle = 'rgba(255,255,255,.8)'; hctx.lineWidth = 1.5; hctx.stroke();
  }
  const me = fighters[LOCAL]; // 本機持有 HUD
  hctx.textAlign = 'left'; hctx.font = '800 14px system-ui, sans-serif';
  if (me.item) { hctx.fillStyle = ITEM_INFO[me.item].color; hctx.fillText('持有：' + ITEM_INFO[me.item].name + '（右鍵使用）', 24, H - 40); }
  else { hctx.fillStyle = 'rgba(234,250,255,.45)'; hctx.fillText('持有：無（走到補給座撿）', 24, H - 40); }
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
  hctx.fillText(`勝者：${NAMES[r.winner]}　損害 ${r.damage}%　搬 ${inc.carries[0] + inc.carries[1]}·吹 ${inc.accidentContains.wind}·滑 ${inc.accidentContains.ice}·爆 ${inc.accidentContains.barrel}　反向 ${inc.reverseContains}　自傷 ${inc.itemBackfires}　主要道具 ${r.mostUsed}　${r.time.toFixed(0)}s`, cx, y); y += 30;
  if (containLog.length) { // 三幕封存序列
    hctx.font = '800 15px system-ui, sans-serif'; hctx.fillStyle = '#cfe0f0';
    hctx.fillText('封存序列：' + containLog.map(c => NAMES[c.winner][0] + '·' + (METHOD_ZH[c.method] || c.method)).join('　→　'), cx, y); y += 30;
  }
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
  hctx.fillText('魔法事故報告 · 收容測試　階段 ' + stage + '：' + STAGE_NAME[stage - 1] + '　封存 ' + WIN_TARGET + ' 次獲勝', W / 2, 28);
  // AI 狀態(練習模式)— 永遠可見,B 切換
  const aiOn = fighters[1 - LOCAL].ai;
  hctx.font = '800 13px system-ui, sans-serif';
  hctx.fillStyle = aiOn ? 'rgba(255,140,140,.92)' : 'rgba(154,255,208,.96)';
  hctx.fillText(aiOn ? '紅方：AI 對手　（按 B 關掉，練手感）' : '紅方：練習假人　（按 B 開 AI）', W / 2, 48);
  // 三格收容進度 (每格標收容方式)
  drawPips(0, 24, 1); drawPips(1, W - 24, -1);
  drawContainHud();
  drawItems();
  // stage / seal banner
  if (winBannerT > 0 && bannerText) {
    hctx.textAlign = 'center'; hctx.font = '900 40px system-ui, sans-serif';
    hctx.fillStyle = COLORS[winnerPid] || '#eafaff'; hctx.fillText(bannerText, W / 2, H / 2 - 30);
  }
  // controls hint
  hctx.textAlign = 'center'; hctx.font = '700 13px system-ui, sans-serif';
  hctx.fillStyle = 'rgba(234,250,255,.7)';
  hctx.fillText('藍（你）：WASD 移動 · 滑鼠瞄準 · 左鍵揮拳 · 右鍵抓／放技能（補給座撿：風/傳送/冰）　B：開關 AI', W / 2, H - 18);
  if (matchOver && report) drawReport(); // end-of-match incident report overlay
  // build tag — bump on each gameplay change so you can confirm a fresh deploy loaded (hard-refresh if it's old)
  hctx.textAlign = 'right'; hctx.font = '700 11px ui-monospace, monospace'; hctx.fillStyle = 'rgba(234,250,255,.5)';
  hctx.fillText('build: solid-1', W - 10, H - 4);
}

function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  updateMouseWorld(); // 滑鼠螢幕座標 → 地面世界座標(供本地玩家瞄準)
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
  punch, startCarry, stunFighter, pads, iceZones, useItem, castWind, castTeleport, castIce, inc, generateReport,
  state: () => ({ winnerPid, roundWins: [roundWins[0], roundWins[1]], matchOver, report, stage,
    containLog: containLog.map(c => ({ w: c.winner, m: c.method, s: c.stage })),
    invuln: [+fighters[0].invuln.toFixed(2), +fighters[1].invuln.toFixed(2)],
    stability: [Math.round(fighters[0].stability), Math.round(fighters[1].stability)],
    stunned: [fighters[0].stunned, fighters[1].stunned],
    carrying: [fighters[0].carrying ? fighters[0].carrying.pid : -1, fighters[1].carrying ? fighters[1].carrying.pid : -1],
    escape: [Math.round(fighters[0].escape || 0), Math.round(fighters[1].escape || 0)],
    items: [fighters[0].item, fighters[1].item], pads: pads.map(p => p.item), iceZones: iceZones.length,
    contains: [inc.contains[0], inc.contains[1]], carries: inc.carries, accidentContains: inc.accidentContains,
    reverseContains: inc.reverseContains, teleportEscapes: inc.teleportEscapes, struggleEscapes: inc.struggleEscapes,
    itemBackfires: inc.itemBackfires, barrelBooms: inc.barrelBooms, itemUses: inc.itemUses }) };
// 練習模式:B 鍵切換 AI 開關。關掉後紅方不動(不追、不打),當成手感練習的假人。
// 讀 fighters[1].ai 為唯一真相(tune 面板的勾選也吃這條),HUD 據此顯示狀態。
function toggleAI() {
  const on = !fighters[1 - LOCAL].ai;
  for (let i = 0; i < fighters.length; i++) if (i !== LOCAL) fighters[i].ai = on;
  const o = fighters[1 - LOCAL];
  if (!on) { o.vx = 0; o.vy = 0; } // 停下當假人
  addText(o.x, o.y - 42, on ? 'AI 開啟' : 'AI 關閉 · 練習模式', on ? '#ff6b6b' : '#9affd0');
  game.sfx.push('upgrade');
}
window.addEventListener('keydown', (e) => {
  unlockAudio();
  const k = e.key.toLowerCase();
  keys.add(k);
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', '/'].includes(k)) e.preventDefault();
  if (k === 'b') toggleAI(); // 切換 AI / 練習模式
  if (matchOver) { // incident report screen: R = rematch, C = copy share text
    if (k === 'r') restartMatch();
    else if (k === 'c' && report && navigator.clipboard) { navigator.clipboard.writeText(report.share); dlog('copied share text'); }
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('pointerdown', unlockAudio);

// --- 滑鼠:游標→瞄準(存螢幕像素,每幀 raycast 成地面世界座標),左鍵揮拳,右鍵情境(抓/道具) ---
const gameCanvas = document.getElementById('game');
gameCanvas.addEventListener('mousemove', (e) => {
  const rect = gameCanvas.getBoundingClientRect();
  mouseScreen.x = (e.clientX - rect.left) / rect.width * W;
  mouseScreen.y = (e.clientY - rect.top) / rect.height * H;
});
gameCanvas.addEventListener('mousedown', (e) => {
  unlockAudio();
  if (matchOver) return;                        // 報告畫面:用鍵盤 R 再戰 / C 複製
  const f = fighters[LOCAL]; if (!f || f.ai) return;
  if (e.button === 2) mouseRight(f);            // 右鍵
  else if (e.button === 0) mouseLeft(f);        // 左鍵
});
gameCanvas.addEventListener('contextmenu', (e) => e.preventDefault()); // 右鍵不彈出選單

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
  // 視覺:暗藍紫地板 + 低亮度紫格線 + 牆底暗角;角色/箱子腳下陰影;魔法特效高亮
  setFloorParams({ floorA: '#2a2c4e', floorB: '#22243f', floorEdge: '#6a5bb0', gridAlpha: 0.16, motes: false, ao: true });
  setRichFloor(true);   // detailed stone/metal slab material (noise/scratches/grout bevel/edge lip, baked once)
  setActorShadow(true);
  setVividFx(true);
  // pulled in (dist↓) and panned so the followed player sits in the lower third: panZ<0 pushes the look-target
  // north, so the player (south of it) rides low in frame → less black void below, more arena ahead. (Live-tune via __v2.CAM.)
  CAM.fov = 32; CAM.angle = 44; CAM.dist = 650; CAM.azimuth = 0; CAM.panX = 0; CAM.panZ = -25; CAM.lookY = 14;
}
// flat mode uses the smoothed/bounded camRig; isles/grid follow the fighter directly (their framing differs)
game.camTarget = TERRAIN === 'flat' ? camRig : fighters[0];
game.occludeTarget = fighters[LOCAL]; // see-through walls aim at the REAL player, not the (clamped) camera rig
game.enemies = fighters.slice();

let last = performance.now();
requestAnimationFrame(frame);

// opt-in live tuning panel (角色大小 / 格線 / 地板顏色·搶眼度 / 攝影機): open v2.html?tune=1
if (new URLSearchParams(location.search).has('tune')) import('./v2-tuning.js').catch(e => console.warn('[v2] tuning panel failed', e));
