// Touch controls (client-only). Native touch events → state.touch; main.js's buildInput
// folds that into the neutral game.input the headless sim reads, exactly like keys/mouse do.
// Twin dynamic sticks (left = move, right = aim + auto-fire) + 3 fixed action buttons.
import { W, H } from './constants.js';
import { game, touch } from './state.js';

// Fixed action buttons in HUD/canvas coords (also read by render to draw them).
export const TOUCH_BTN = {
  dash: { x: W - 78, y: H - 74, r: 40, label: '閃' },
  secondary: { x: W - 162, y: H - 112, r: 34, label: '副' },
  grab: { x: W - 96, y: H - 168, r: 32, label: 'E' }
};
export const STICK_R = 64;       // max knob travel
const DEAD = 0.16;               // stick deadzone

// id → which control this finger owns ('move' | 'aim' | 'dash' | 'secondary' | 'grab')
const owner = new Map();

function toCanvas(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: (clientX - rect.left) / rect.width * W, y: (clientY - rect.top) / rect.height * H };
}
function hitBtn(x, y) {
  for (const k of ['dash', 'secondary', 'grab']) {
    const b = TOUCH_BTN[k];
    if (Math.hypot(x - b.x, y - b.y) <= b.r + 8) return k;
  }
  return null;
}
function setStick(s, cx, cy) {
  s.dx = Math.max(-1, Math.min(1, (cx - s.ox) / STICK_R));
  s.dy = Math.max(-1, Math.min(1, (cy - s.oy) / STICK_R));
  if (Math.hypot(s.dx, s.dy) < DEAD) { s.dx = 0; s.dy = 0; }
}

export function wireTouch(canvas) {
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) touch.enabled = true;

  const start = (id, clientX, clientY) => {
    touch.enabled = true;
    if (game.state !== 'playing') return false; // menus: let the synthesized click handle taps
    const { x, y } = toCanvas(canvas, clientX, clientY);
    const btn = hitBtn(x, y);
    if (btn) { touch.btn[btn] = true; owner.set(id, btn); return true; }
    if (x < W * 0.5 && !touch.move.active) { Object.assign(touch.move, { active: true, ox: x, oy: y, dx: 0, dy: 0 }); owner.set(id, 'move'); return true; }
    if (x >= W * 0.5 && !touch.aim.active) { Object.assign(touch.aim, { active: true, ox: x, oy: y, dx: 0, dy: 0 }); owner.set(id, 'aim'); return true; }
    return false;
  };
  const move = (id, clientX, clientY) => {
    const o = owner.get(id); if (!o) return;
    const { x, y } = toCanvas(canvas, clientX, clientY);
    if (o === 'move') setStick(touch.move, x, y);
    else if (o === 'aim') setStick(touch.aim, x, y);
  };
  const end = (id) => {
    const o = owner.get(id); if (!o) return; owner.delete(id);
    if (o === 'move') { touch.move.active = false; touch.move.dx = 0; touch.move.dy = 0; }
    else if (o === 'aim') { touch.aim.active = false; touch.aim.dx = 0; touch.aim.dy = 0; }
    else touch.btn[o] = false;
  };

  canvas.addEventListener('touchstart', (e) => {
    let used = false;
    for (const t of e.changedTouches) used = start(t.identifier, t.clientX, t.clientY) || used;
    if (used) e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) move(t.identifier, t.clientX, t.clientY);
    if (game.state === 'playing' && owner.size) e.preventDefault();
  }, { passive: false });
  const onEnd = (e) => { for (const t of e.changedTouches) end(t.identifier); };
  canvas.addEventListener('touchend', onEnd);
  canvas.addEventListener('touchcancel', onEnd);
}
