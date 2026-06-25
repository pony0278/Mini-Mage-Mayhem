// Pure math/geometry helpers. No game state, no DOM.
export const rnd = (min, max) => min + Math.random() * (max - min);
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
export const norm = (x, y) => {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
};
export const circleRectOverlap = (cx, cy, r, rx, ry, rw, rh) => {
  const px = clamp(cx, rx, rx + rw);
  const py = clamp(cy, ry, ry + rh);
  return Math.hypot(cx - px, cy - py) <= r;
};
