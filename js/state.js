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
  bossDefeated: false
};

// Shared input containers: DOM event handlers (input layer) write button/key
// state; render's updateMouseWorld writes mouse world-coords; sim/loop read.
export const keys = new Set();
export const mouse = { x: W / 2, y: H / 2, down: false, right: false };

// Follow-camera config. Owned by render long-term; parked here transitionally
// so the (still-inline) sim can read CAM.azimuth without a render↔sim import
// cycle. Moves into render.js once the intent adapter removes sim's CAM read.
// Mutated in place (camera-sandbox sliders); never reassigned.
export const CAM = { fov: 33, angle: 41, dist: 720, azimuth: -35, panX: 10, panZ: -10, lookY: -10 };
