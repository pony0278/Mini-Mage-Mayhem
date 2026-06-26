// App glue: input handlers + main loop + boot. Shared by all three HTML shells
// (index / camera-sandbox / training); page-specific panels load as separate
// add-on modules (camera-panel.js / training-panel.js).
import { W, H } from './constants.js';
import { norm } from './utils.js';
import { game, keys, mouse, CAM } from './state.js';
import { resetGame, startRun, applyUpgrade, update } from './sim.js';
import { draw, updateMouseWorld, mouseScreen } from './render.js';

window.__game = game; // debug / headless-test hook

const canvas = document.getElementById('game');

// --- input ---
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
  if (e.key.toLowerCase() === 'r' && (game.state === 'over' || game.state === 'win')) resetGame();
  if (game.state === 'title' && e.key === 'Enter') startRun();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  // Store cursor in canvas pixels; converted to a world ground point each frame
  // via a camera raycast (updateMouseWorld), since the 3D camera moves.
  mouseScreen.x = (e.clientX - rect.left) / rect.width * W;
  mouseScreen.y = (e.clientY - rect.top) / rect.height * H;
});
canvas.addEventListener('mousedown', (e) => { if (e.button === 2) mouse.right = true; else mouse.down = true; });
window.addEventListener('mouseup', (e) => { if (e.button === 2) mouse.right = false; else mouse.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// menu interactions (title start / upgrade pick)
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width * W;
  const y = (e.clientY - rect.top) / rect.height * H;
  if (game.state === 'title') { startRun(); return; }
  if (game.state !== 'upgrade') return;
  for (let i = 0; i < game.upgrades.length; i++) {
    const bx = 210 + i * 185, by = 220;
    if (x >= bx && x <= bx + 165 && y >= by && y <= by + 170) applyUpgrade(i);
  }
});
window.addEventListener('keydown', (e) => {
  if (game.state === 'upgrade') {
    if (e.key === '1') applyUpgrade(0);
    if (e.key === '2') applyUpgrade(1);
    if (e.key === '3') applyUpgrade(2);
  }
});

// Intent adapter (B0 seam): translate raw keys/mouse/CAM into the neutral game.input the
// headless sim reads. Touch controls and (later) the BR netcode populate the same struct.
function buildInput() {
  const inp = game.input;
  let mx = 0, my = 0;
  if (keys.has('w') || keys.has('arrowup')) my -= 1;
  if (keys.has('s') || keys.has('arrowdown')) my += 1;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;
  // camera-relative so WASD matches the screen at any azimuth (a client/render concern)
  const maz = (CAM.azimuth || 0) * Math.PI / 180;
  const fX = -Math.sin(maz), fY = -Math.cos(maz); // screen-up in world
  const rX = Math.cos(maz), rY = -Math.sin(maz);  // screen-right in world
  const n = norm(rX * mx + fX * (-my), rY * mx + fY * (-my));
  inp.moveX = n.x; inp.moveY = n.y;
  inp.aimX = mouse.x; inp.aimY = mouse.y;          // mouse.x/y are world coords (updateMouseWorld raycast)
  inp.firing = mouse.down;
  inp.secondaryFiring = mouse.right || keys.has('q');
  inp.dash = keys.has(' ') || keys.has('shift');
  inp.grab = keys.has('e');
}

// --- main loop --- (pause hook used by camera-sandbox's panel)
let paused = false;
export function setPaused(p) { paused = p; }

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (!paused) { updateMouseWorld(); buildInput(); update(dt); } // mouse-world → intents → sim, only when running
  draw();
  requestAnimationFrame(loop);
}

resetGame();
requestAnimationFrame(loop);
