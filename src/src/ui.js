// Canvas-textured 3D panels with ray-clickable buttons (work with mouse, controllers and hand pinch).
import * as THREE from 'three';

export const THEME = {
  bg: 'rgba(5,9,26,0.86)', border: '#38e8ff', accent: '#ff3df2', text: '#e6ecff', dim: '#8e9bc9',
  good: '#5cff9d', bad: '#ff5c7a', warn: '#ffd166', btn: 'rgba(30,48,110,0.95)', btnHot: 'rgba(56,232,255,0.95)',
};

export function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export class Panel {
  constructor({ width = 1.4, height = 0.7, ppm = 900, title = '' } = {}) {
    this.width = width; this.height = height; this.ppm = ppm;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * ppm); this.canvas.height = Math.round(height * ppm);
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false, depthWrite: false }),
    );
    this.mesh.userData.panel = this;
    this.mesh.renderOrder = 10;
    this.buttons = [];
    this.hover = null;
    this.drawFn = null;
    this.title = title;
  }

  /** drawFn(p) is called with a helper `p` exposing ctx, w, h and drawing utilities. */
  set(drawFn) { this.drawFn = drawFn; this.redraw(); }

  redraw() {
    const g = this.g, W = this.canvas.width, H = this.canvas.height;
    this.buttons = [];
    g.clearRect(0, 0, W, H);
    g.save();
    // frame
    roundRect(g, 6, 6, W - 12, H - 12, 34);
    g.fillStyle = THEME.bg; g.fill();
    g.lineWidth = 4; g.strokeStyle = THEME.border; g.shadowColor = THEME.border; g.shadowBlur = 24; g.stroke();
    g.shadowBlur = 0;
    // corner accents
    g.strokeStyle = THEME.accent; g.lineWidth = 6;
    g.beginPath(); g.moveTo(40, 12); g.lineTo(150, 12); g.moveTo(W - 150, H - 12); g.lineTo(W - 40, H - 12); g.stroke();
    g.restore();
    if (this.drawFn) this.drawFn(this._helper());
    this.tex.needsUpdate = true;
  }

  _helper() {
    const p = this, g = this.g;
    return {
      g, w: this.canvas.width, h: this.canvas.height,
      text(str, x, y, { size = 38, color = THEME.text, weight = 500, align = 'left', maxW = 0, lh = 1.28, font = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', shadow = null } = {}) {
        g.save();
        g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'top'; g.fillStyle = color;
        if (shadow) { g.shadowColor = shadow; g.shadowBlur = 16; }
        let yy = y;
        const lines = maxW ? wrap(g, str, maxW) : String(str).split('\n');
        for (const l of lines) { g.fillText(l, x, yy); yy += size * lh; }
        g.restore();
        return yy;
      },
      button(label, x, y, w, h, onClick, { primary = false, disabled = false, size = 36, active = false } = {}) {
        const b = { x, y, w, h, onClick, disabled, label };
        p.buttons.push(b);
        const hot = p.hover === b.label && !disabled;
        g.save();
        roundRect(g, x, y, w, h, 22);
        g.fillStyle = disabled ? 'rgba(40,46,70,0.7)' : hot ? THEME.btnHot : active ? 'rgba(255,61,242,0.55)' : primary ? 'rgba(255,61,242,0.8)' : THEME.btn;
        g.fill();
        g.lineWidth = 3; g.strokeStyle = disabled ? '#3a4260' : hot ? '#ffffff' : primary ? '#ff9af8' : '#4d6bd6'; g.stroke();
        g.font = `700 ${size}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = disabled ? '#6a7396' : hot ? '#02101c' : '#ffffff';
        g.fillText(label, x + w / 2, y + h / 2 + 2);
        g.restore();
        return b;
      },
    };
  }

  /** uv in [0,1] (three's uv origin is bottom-left) -> button or null */
  pick(uv) {
    const x = uv.x * this.canvas.width, y = (1 - uv.y) * this.canvas.height;
    for (const b of this.buttons) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    return null;
  }

  setHover(label) {
    if (this.hover === label) return;
    this.hover = label;
    this.redraw();
  }
}
