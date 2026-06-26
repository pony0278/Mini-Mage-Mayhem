// Procedural SFX (client-only, no asset files → zero load, no egress). The sim stays headless:
// it pushes abstract event names into game.sfx; main.js drains them each frame and calls playSfx.
// WebAudio needs a user gesture to start — main.js calls unlock() on the first input.
let ctx = null, master = null, muted = false, ducked = false;
const VOL = 0.32;
const applyGain = () => { if (master) master.gain.value = (muted || ducked) ? 0 : VOL; };

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); applyGain(); master.connect(ctx.destination);
  return ctx;
}
export function unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }
export function isMuted() { return muted; }
export function toggleMute() { muted = !muted; applyGain(); return muted; }
// Duck audio independently of the user mute — for ad breaks / tab hidden. setAudioDucked(false)
// restores to the user's mute state, not unconditionally on.
export function setAudioDucked(d) { ducked = d; applyGain(); }

// --- synthesis primitives ---
function tone({ freq = 440, f1, type = 'square', dur = 0.12, gain = 0.5, attack = 0.005, release = 0.06, at = 0 }) {
  const c = ensure(); if (!c || muted) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + release + 0.02);
}
function noise({ dur = 0.2, gain = 0.5, type = 'lowpass', freq = 1200, q = 1, sweepTo, at = 0 }) {
  const c = ensure(); if (!c || muted) return;
  const t = c.currentTime + at;
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

// --- event → sound map (punchy, retro, procedural) ---
const SFX = {
  shoot:     () => tone({ freq: 760, f1: 360, type: 'triangle', dur: 0.08, gain: 0.30 }),
  melee:     () => { tone({ freq: 190, f1: 90, type: 'square', dur: 0.07, gain: 0.28 }); noise({ dur: 0.08, gain: 0.20, freq: 1900, sweepTo: 400 }); },
  hit:       () => tone({ freq: 1250, f1: 1550, type: 'square', dur: 0.025, gain: 0.13 }),
  enemyDie:  () => tone({ freq: 420, f1: 110, type: 'sawtooth', dur: 0.16, gain: 0.24 }),
  explosion: () => { noise({ dur: 0.34, gain: 0.5, freq: 900, sweepTo: 120, q: 0.7 }); tone({ freq: 130, f1: 48, type: 'sine', dur: 0.3, gain: 0.42 }); },
  fusion:    () => { tone({ freq: 440, f1: 880, type: 'triangle', dur: 0.26, gain: 0.28 }); tone({ freq: 660, f1: 1320, type: 'sine', dur: 0.32, gain: 0.18, attack: 0.05 }); },
  upgrade:   () => { tone({ freq: 660, type: 'triangle', dur: 0.1, gain: 0.28 }); tone({ freq: 990, type: 'triangle', dur: 0.14, gain: 0.26, at: 0.09 }); },
  hurt:      () => { tone({ freq: 220, f1: 90, type: 'sawtooth', dur: 0.18, gain: 0.32 }); noise({ dur: 0.1, gain: 0.18, freq: 600 }); },
  dash:      () => noise({ dur: 0.18, gain: 0.22, type: 'bandpass', freq: 500, sweepTo: 2600, q: 0.8 }),
  grab:      () => noise({ dur: 0.14, gain: 0.2, type: 'bandpass', freq: 400, sweepTo: 1600, q: 1 }),
  throw:     () => { noise({ dur: 0.16, gain: 0.24, type: 'bandpass', freq: 1800, sweepTo: 300, q: 0.8 }); tone({ freq: 300, f1: 150, type: 'square', dur: 0.1, gain: 0.16 }); },
  secondary: () => tone({ freq: 520, f1: 760, type: 'sine', dur: 0.16, gain: 0.26, attack: 0.02 }),
  waveclear: () => { tone({ freq: 523, type: 'triangle', dur: 0.12, gain: 0.26 }); tone({ freq: 659, type: 'triangle', dur: 0.12, gain: 0.26, at: 0.1 }); tone({ freq: 784, type: 'triangle', dur: 0.18, gain: 0.28, at: 0.2 }); },
  gameover:  () => { tone({ freq: 392, f1: 196, type: 'sawtooth', dur: 0.4, gain: 0.3 }); tone({ freq: 261, f1: 110, type: 'sine', dur: 0.6, gain: 0.26, at: 0.18 }); }
};

export function playSfx(name) { const fn = SFX[name]; if (fn) fn(); }
