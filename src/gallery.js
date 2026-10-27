// Level 3 "Protein gallery" (free play): browse the 12 proteins of the "Who's that protein?" quiz, turn them around, read
// what they do, and switch between the surface, the cartoon (helices, strands, coils) or both. It is a Level-like object
// (Game.l3s[1]) so it plugs into the same level switching, boards and pointer code as the puzzles.
import * as THREE from 'three';
import { THEME } from './ui.js';
import { t } from './i18n.js';
import { sfx } from './audio.js';
import { applyRotation } from './handle.js';
import { K } from './chain.js';
import { makeCartoon } from './cartoon.js';
import { loadSurface, surfaceMaterial, makeOutline } from './level3.js';
import { POOL, CATEGORIES } from './surfaces/info.js';

const CENTER = new THREE.Vector3(0, 1.5, -1.35);   // where the protein floats
const RADIUS = 0.5;                                 // metres: every protein is shown at the same size (the facts give the real size)
const MODES = ['surface', 'cartoon', 'both'];
const ZOOM_MIN = 0.4, ZOOM_MAX = 3;                 // x the default size
const IDS = Object.keys(POOL);

// ---------------------------------------------------------------- cartoon data ('CRT1' files from tools/make-cartoon.mjs)
const cartoonCache = new Map();
export function loadCartoon(id) {
  if (cartoonCache.has(id)) return cartoonCache.get(id);
  const p = fetch(new URL(`./cartoons/${id}.bin`, import.meta.url)).then((r) => r.arrayBuffer()).then((buf) => {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x31545243) throw new Error('bad cartoon file ' + id);
    const hl = dv.getUint32(4, true);
    const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)).replace(/\0+$/, ''));
    const n = head.n, pad4 = (x) => (x + 3) & ~3;
    let off = 8 + hl;
    const ca = new Int16Array(buf, off, n * 3); off += pad4(n * 6);
    const dn = new Int8Array(buf, off, n * 3); off += pad4(n * 3);
    const dc = new Int8Array(buf, off, n * 3); off += pad4(n * 3);
    const w = new Int8Array(buf, off, n * 3); off += pad4(n * 3);
    const ss = new Uint8Array(buf, off, n);
    return { n, segs: head.segs, ca, dn, dc, w, ss };
  });
  cartoonCache.set(id, p);
  return p;
}

/** a THREE.Group with the cartoon of every segment; `scale` turns Angstrom into the display size (see makeCartoonGroup) */
function makeCartoonGroup(data, radiusA) {
  const group = new THREE.Group();
  const s = RADIUS / (radiusA * K);                      // display scale: the protein's radius -> RADIUS metres
  let i0 = 0;
  for (const [len] of data.segs) {
    const res = [], ssl = [];
    for (let i = i0; i < i0 + len; i++) {
      const CA = new THREE.Vector3(data.ca[i * 3] / 200, data.ca[i * 3 + 1] / 200, data.ca[i * 3 + 2] / 200);
      const N = CA.clone().add(new THREE.Vector3(data.dn[i * 3], data.dn[i * 3 + 1], data.dn[i * 3 + 2]).multiplyScalar(1 / 30));
      const C = CA.clone().add(new THREE.Vector3(data.dc[i * 3], data.dc[i * 3 + 1], data.dc[i * 3 + 2]).multiplyScalar(1 / 30));
      const O = C.clone().add(new THREE.Vector3(data.w[i * 3], data.w[i * 3 + 1], data.w[i * 3 + 2]).multiplyScalar(1 / 120));
      res.push({ N, CA, C, O });
      ssl.push(['C', 'H', 'E'][data.ss[i]]);
    }
    group.add(makeCartoon(res, ssl, s, null, { half: 0.026, radius: 0.0115 }).group);   // ~1.2 A ribbon half-width, ~0.5 A coil radius
    i0 += len;
  }
  group.scale.setScalar(s);
  return group;
}

export class Gallery {
  constructor(game) {
    this.game = game;
    this.index = 1;                                   // position in Game.l3s (0 = the quiz)
    this.isGallery = true;
    this.protein = { name: t('gal.title'), id: 'gallery' };
    this.group = new THREE.Group(); this.group.visible = false;
    game.world.add(this.group);
    this.sel = 0; this.mode = 'surface'; this.zoom = 1;
    this.items = new Map();                           // id -> { surf, surfMesh, outline, cartoon } once loaded
    this.rot = new THREE.Quaternion(); this.held = false; this.t = 0;
    this.model = new THREE.Group(); this.model.position.copy(CENTER); this.group.add(this.model);
    this.hit = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.1, 16, 12), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.userData.gallery = this;
    this.group.add(this.hit); this.hit.position.copy(CENTER);
    // a pad under the protein
    const pad = new THREE.Group();
    pad.add(new THREE.Mesh(new THREE.RingGeometry(0.5, 0.53, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3df2, toneMapped: false })));
    pad.add(new THREE.Mesh(new THREE.CircleGeometry(0.5, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a2a6a, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false })));
    pad.position.set(CENTER.x, 0.86, CENTER.z); this.group.add(pad);
    this.loading = false;
  }

  // ------------------------------------------------------------------ level interface (see Game)
  reset() { this.select(this.sel); }
  hint() { this.select((this.sel + 1) % IDS.length); }          // the Hint key ('H') = next protein
  sig() { return `${this.sel}|${this.mode}|${this.loading ? 1 : 0}|${Math.round(this.zoom * 100)}`; }
  get joined() { return 0; } get nJ() { return 1; } get mistakes() { return 0; } get hints() { return 0; }
  groupSolved() { return false; }

  select(i) {
    this.sel = (i + IDS.length) % IDS.length;
    this.loading = true;
    this.rot.identity();
    const id = IDS[this.sel];
    this._ensure(id).then(() => { if (IDS[this.sel] === id) { this.loading = false; this._show(); } this.game.redrawAll(); });
    this._show();
    this.game.redrawAll();
  }

  setZoom(z) { this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)); }

  setMode(m) { this.mode = m; this._show(); this.game.redrawAll(); }

  async _ensure(id) {
    if (this.items.has(id)) return this.items.get(id);
    const [surf, cd] = await Promise.all([loadSurface(id), loadCartoon(id)]);
    const surfMesh = new THREE.Mesh(surf.geo, surfaceMaterial());
    surfMesh.scale.setScalar(RADIUS);
    const outline = makeOutline(surf.geo); surfMesh.add(outline);
    const glass = new THREE.Mesh(surf.geo, Object.assign(surfaceMaterial(), { transparent: true, opacity: 0.28, depthWrite: false }));   // "both": a see-through surface around the cartoon
    glass.scale.setScalar(RADIUS);
    const cartoon = makeCartoonGroup(cd, surf.radius);
    const it = { surf, cd, surfMesh, glass, cartoon };
    this.items.set(id, it);
    return it;
  }

  /** shows the selected protein in the selected representation */
  _show() {
    this.model.clear();
    const it = this.items.get(IDS[this.sel]);
    if (!it) return;
    if (this.mode === 'surface') this.model.add(it.surfMesh);
    else if (this.mode === 'cartoon') this.model.add(it.cartoon);
    else this.model.add(it.cartoon, it.glass);
  }

  // ------------------------------------------------------------------ pointers
  handlePointers(pointers, raycaster, dt) {
    const g = this.game;
    const targets = [...g.panels.filter((p) => p.mesh.visible).map((p) => p.mesh), this.hit];
    const hovBtn = new Map(g.panels.map((p) => [p, null]));
    this.hovered = false;
    // two hands (or two triggers) holding the protein = pinch-zoom: moving them apart / together scales it
    const holders = pointers.filter((q) => q.pressed && q.holding?.isGallery);
    const two = holders.length >= 2;
    if (two) {
      const d = holders[0].origin.distanceTo(holders[1].origin);
      if (!this._pinch) this._pinch = { d, z: this.zoom };
      else if (d > 0.02) this.setZoom(this.zoom + (this._pinch.z * (d / this._pinch.d) - this.zoom) * 0.35);   // smoothed: hand tracking jitters
    } else if (this._pinch) { this._pinch = null; holders.forEach((q) => (q._rot = null)); pointers.forEach((q) => (q._rot = null)); }   // back to one hand: re-anchor the turn, no jump
    for (const ptr of pointers) {
      if (ptr.holding && !ptr.holding.isGallery) ptr.holding = null;
      const was = ptr.prevPressed;
      ptr.hit = null; ptr.hitDist = 3;
      raycaster.set(ptr.origin, ptr.dir); raycaster.far = 6;
      const hits = ptr.holding ? [] : raycaster.intersectObjects(targets, false);
      let btn = null, model = false;
      if (hits.length) {
        const h = hits[0];
        ptr.hit = h.point; ptr.hitDist = h.distance;
        if (h.object.userData.panel) { const pan = h.object.userData.panel; btn = pan.pick(h.uv); if (btn) hovBtn.set(pan, btn.label); }
        else if (h.object.userData.gallery) model = true;
      }
      if (model) this.hovered = true;
      if (ptr.pressed && !was) {
        sfx.unlock();
        if (btn && !btn.disabled) { sfx.click(); ptr.haptic?.(0.4, 30); ptr.captured = true; btn.onClick(); }
        else if (model || (this.held && !btn)) { ptr.holding = { isGallery: true, isDemo: true }; ptr._rot = null; ptr.captured = true; sfx.grab(); ptr.haptic?.(0.4, 40); }   // isDemo: left-drag on a flat screen turns it; a 2nd hand pinching anywhere joins the first (zoom)
        else ptr.captured = !!(hits.length && hits[0].object.userData.panel);
      }
      if (!ptr.pressed) ptr.captured = false;
      if (ptr.holding) {
        if (!two) applyRotation(ptr, this.rot, g.world.quaternion, true);   // turntable: the protein turns with the hand (frozen while two hands zoom)
        if (ptr.holdDelta) this.setZoom(this.zoom * Math.exp(ptr.holdDelta * 1.5));   // mouse wheel / thumbstick while holding = zoom
        ptr.hit = g.world.localToWorld(CENTER.clone()); ptr.hitDist = ptr.origin.distanceTo(ptr.hit);
        if (!ptr.pressed) { ptr.holding = null; ptr._rot = null; }
      }
      ptr.prevPressed = ptr.pressed;
    }
    this.held = pointers.some((q) => q.holding?.isGallery);
    for (const [pan, label] of hovBtn) pan.setHover(label);
  }

  update(dt, t, pointers, raycaster) {
    this.t = t;
    this.handlePointers(pointers, raycaster, dt);
    if (!this.held) this.rot.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.25));   // slow turntable
    this.model.quaternion.copy(this.rot);
    this.model.scale.setScalar(this.zoom * (this.hovered || this.held ? 1.03 : 1));
    this.hit.scale.setScalar(this.zoom);
  }

  // ------------------------------------------------------------------ boards
  drawCoach(p) {
    const { w, h, g } = p;
    const game = this.game;
    p.text(t('gal.title'), 56, 34, { size: 46, weight: 800, color: THEME.border, shadow: THEME.border, maxW: w - 112 });
    // representation switch
    const bw = (w - 112 - 24) / 3;
    MODES.forEach((m, i) => p.button(t(`gal.${m}`), 56 + i * (bw + 12), 104, bw, 70, () => this.setMode(m), { active: this.mode === m, size: 30 }));
    // the 12 proteins, 2 columns
    const cw = (w - 112 - 12) / 2, ch = 76;
    IDS.forEach((id, i) => {
      const info = POOL[id], x = 56 + (i % 2) * (cw + 12), y = 196 + Math.floor(i / 2) * (ch + 10);
      p.button(info.short || info.name, x, y, cw, ch, () => this.select(i), { active: i === this.sel, size: 28 });
      g.fillStyle = CATEGORIES[info.category].color; g.fillRect(x + 12, y + 12, 9, ch - 24);
    });
    const r1 = h - 196, r2 = h - 100, bh = 78;
    p.button('◀', 56, r1, 120, bh, () => this.select(this.sel - 1), { size: 36 });
    p.button('▶', 56 + 132, r1, 120, bh, () => this.select(this.sel + 1), { size: 36 });
    // zoom: − / reset (shows the percentage) / +
    const zx = 56 + 2 * 132 + 40;
    p.button('−', zx, r1, 110, bh, () => this.setZoom(this.zoom / 1.25), { size: 44, disabled: this.zoom <= ZOOM_MIN + 1e-6 });
    p.button(`${Math.round(this.zoom * 100)}%`, zx + 122, r1, 170, bh, () => this.setZoom(1), { size: 30 });
    p.button('+', zx + 304, r1, 110, bh, () => this.setZoom(this.zoom * 1.25), { size: 44, disabled: this.zoom >= ZOOM_MAX - 1e-6 });
    p.button(t('level', { n: 3 }), 56, r2, 280, bh, () => game.setLevel(3, 0), { size: 28 });
    p.button(game.menuOpen ? t('options.close') : t('options'), w - 56 - 290, r2, 290, bh, () => game.toggleMenu(), { active: game.menuOpen, size: 32 });
  }

  drawSide(p) {
    const { w, g } = p;
    const id = IDS[this.sel], info = POOL[id], cat = CATEGORIES[info.category], it = this.items.get(id);
    let y = p.text(info.name, 50, 34, { size: 44, weight: 800, color: cat.color, maxW: w - 100, lh: 1.1 }) + 10;
    y = p.text(`${cat.label} · PDB ${info.pdb}`, 50, y, { size: 28, color: THEME.dim, maxW: w - 100 }) + 24;
    y = p.text(info.fact, 50, y, { size: 28, maxW: w - 100, lh: 1.28 }) + 28;
    if (it) {
      const [a, b, c] = it.surf.ext;
      const subs = new Set(it.cd.segs.map((s) => s[1])).size;
      y = p.text(t('gal.stats', { n: subs, r: it.cd.n }), 50, y, { size: 27, weight: 700, maxW: w - 100 }) + 8;
      y = p.text(t('gal.size', { a: Math.round(a), b: Math.round(b), c: Math.round(c) }), 50, y, { size: 27, color: THEME.dim, maxW: w - 100 }) + 28;
    } else y = p.text(t('gal.loading'), 50, y, { size: 27, color: THEME.dim }) + 28;
    // what the cartoon colours mean
    p.text(t('gal.legend'), 50, y, { size: 26, color: THEME.dim, weight: 700 }); y += 40;
    for (const [k, col] of [['helix', '#38e8ff'], ['strand', '#ff3df2'], ['coil', '#ffd166']]) {
      g.fillStyle = col; g.beginPath(); g.arc(64, y + 17, 12, 0, 7); g.fill();
      p.text(t(`kind.${k}.lower`), 90, y, { size: 27 }); y += 38;
    }
    y += 18;
    p.text(t('gal.grab'), 50, y, { size: 25, maxW: w - 100, lh: 1.2 }); y += 70;
    p.text(this.game.rotateHint(), 50, y, { size: 24, color: THEME.warn, maxW: w - 100, lh: 1.2 });
  }
}
