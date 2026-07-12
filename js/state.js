import { W, H } from './constants.js';

// The single mutable session state. Mutated IN PLACE by the sim (resetGame /
// update); read by render. Never reassigned, so a live-binding import always
// points at the current state.
export const game = {
  state: 'title',
  time: 0,
  score: 0,
  kills: 0,
  biggestBoom: 0,
  chainBooms: 0,
  wave: 0,
  waveClearTimer: 0,
  screenShake: 0,
  flash: 0,
  message: '',
  messageTimer: 0,
  map: [],
  player: null,
  fireballs: [],
  enemyProjectiles: [],
  lightningBolts: [],
  iceBolts: [],
  enemies: [],
  poisonClouds: [],
  steamClouds: [],
  fireZones: [],
  electricZones: [],
  explosions: [],
  walls: [],
  oils: [],
  blackHoles: [],
  props: [],
  bossWarnings: [],
  particles: [],
  rings: [],
  slams: [],
  windFans: [],   // 風壓手套發射閃:擴張扇形衝擊波(fx.addWindFan;render-entities 畫扇形+外緣射程弧+風絲)
  windAims: [],   // 風壓手套起手預告:winding-up 時每幀重建的淡扇形(v2.js 幀尾;讀 fighter 面向即時跟)
  fireAims: [],   // 噴火帽起手預告:短扇形+外緣射程弧(教攻擊範圍;同 windAims 每幀重建,火色)
  floatingTexts: [],
  upgrades: [],
  stats: null,
  run: null,
  waveMods: null,
  fusionBanner: null,
  bossPhaseBanner: null,
  bossAttackLabel: '',
  bossAttackTimer: 0,
  bossStarted: false,
  bossDefeated: false,
  // Neutral input intents — the headless seam (B0). The client adapter (main.js buildInput)
  // fills these from keys/mouse/CAM (or touch, or network for BR); the SIM reads ONLY these,
  // never raw keys/mouse/CAM. moveX/moveY = world-space move dir (camera-relative already
  // applied by the client); aimX/aimY = world aim point.
  input: { moveX: 0, moveY: 0, aimX: W / 2, aimY: H / 2, firing: false, secondaryFiring: false, dash: false, grab: false },
  // Outbound SFX event buffer (headless): sim pushes abstract names, the client drains + plays them.
  sfx: [],
  // Hitstop (頓幀): seconds the gameplay sim freezes on impact for "punch". Cosmetics keep animating.
  hitstop: 0,
  // Screen-shake small-event throttle: cooldown so frequent small shakes coalesce (see addShake).
  shakeSmallCd: 0,
  // camera-sandbox only: when true, spawnWave is a no-op and the wave-clear progression is skipped,
  // so the arena stays empty for camera tuning. Never set in the shipped game.
  noMonsters: false,
  // Optional explicit camera-follow target {x,y} (v2 follows one fighter). null → render falls back to
  // the player (when following) or the arena centre (fixed). Overrides the sandbox follow toggle.
  camTarget: null,
  // Optional custom over-the-abyss test fn(e)->bool (v2 free-form islands). null → tile-grid default.
  isVoidAt: null
};

// Shared input containers: DOM event handlers (input layer) write button/key
// state; render's updateMouseWorld writes mouse world-coords; sim/loop read.
export const keys = new Set();
export const mouse = { x: W / 2, y: H / 2, down: false, right: false };
// 手機觸控輸入(v2-touch 寫入、v2-combat/v2 讀取;桌機 enabled=false 完全不影響)。
// enabled=觸控裝置;active=搖桿正被推;x/y=類比方向向量(-1..1,camera 前的螢幕軸,同 readMove 的 sx/sy)。
// press=動作按鈕的邊緣觸發閂鎖(v2-touch 按下時設 true,v2.js step 消費後清 false=一次一擊)。
export const touchInput = { enabled: false, active: false, x: 0, y: 0, guardHeld: false, press: { punch: false, context: false, guard: false } };

// Touch controls (client). touch.js (event wiring) writes these; main.js's buildInput
// folds them into game.input; render draws the sticks/buttons. enabled = coarse-pointer
// device or after the first touch. Stick dx/dy are normalised screen-space [-1,1].
export const touch = {
  enabled: false,
  move: { active: false, ox: 0, oy: 0, dx: 0, dy: 0 },
  aim: { active: false, ox: 0, oy: 0, dx: 0, dy: 0 },
  btn: { dash: false, secondary: false, grab: false }
};

// Follow-camera config. Owned by render long-term; parked here transitionally
// so the (still-inline) sim can read CAM.azimuth without a render↔sim import
// cycle. Moves into render.js once the intent adapter removes sim's CAM read.
// Mutated in place (camera-sandbox sliders); never reassigned.
export const CAM = { fov: 33, angle: 41, dist: 720, azimuth: -35, panX: 10, panZ: -10, lookY: -10 };
