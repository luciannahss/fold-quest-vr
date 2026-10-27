// Tiny synthesised sound effects (no asset files). The AudioContext is created on first user gesture.
let ctx = null;
function ensure() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function tone(freq, dur, { type = 'sine', gain = 0.12, slide = 0, delay = 0 } = {}) {
  const c = ensure(); if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
export const sfx = {
  unlock: ensure,
  click: () => tone(720, 0.07, { type: 'triangle', gain: 0.08 }),
  grab: () => tone(520, 0.09, { type: 'sine', gain: 0.1, slide: 200 }),
  fold: () => tone(220, 1.1, { type: 'sine', gain: 0.07, slide: 520 }),
  good: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, { type: 'triangle', gain: 0.1, delay: i * 0.08 })); },
  bad: () => { tone(180, 0.35, { type: 'sawtooth', gain: 0.09, slide: -90 }); tone(150, 0.4, { type: 'square', gain: 0.05, slide: -70, delay: 0.08 }); },
  win: () => { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.5, { type: 'triangle', gain: 0.1, delay: i * 0.11 })); },
};
