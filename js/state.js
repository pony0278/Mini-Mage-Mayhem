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
  sfx: []
};

// Shared input containers: DOM event handlers (input layer) write button/key
// state; render's updateMouseWorld writes mouse world-coords; sim/loop read.
export const keys = new Set();
export const mouse = { x: W / 2, y: H / 2, down: false, right: false };

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
