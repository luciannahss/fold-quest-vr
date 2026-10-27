// Level 3 - "Who's that protein?": a black shadow of a protein (surface form) in front of a glowing backdrop;
// four coloured surface models stand in front of you. Grab one, turn it to compare, and drop it into the shadow.
// A right guess fills the shadow with colour and reveals what the protein does.
import * as THREE from 'three';
import { THEME } from './ui.js';
import { sfx } from './audio.js';
import { applyRotation } from './handle.js';
import { makeLabel } from './vessels.js';
import { POOL, ROUNDS, CATEGORIES } from './surfaces/info.js';
import { t as tr } from './i18n.js';

export const STAGE = new THREE.Vector3(0, 1.68, -1.95);     // centre of the shadow
const DROP_R = 0.62;                                // metres: drop a card this close to the shadow to guess
const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();

/** radius of the displayed model (metres) from the protein radius (Angstrom): size is kept as a gentle clue */
export const dispRadius = (R) => THREE.MathUtils.clamp(0.13 + 0.0032 * (R - 17), 0.12, 0.32);

// ---------------------------------------------------------------- loading
const cache = new Map();
export function loadSurface(id) {
  if (cache.has(id)) return cache.get(id);
  const p = fetch(new URL(`./surfaces/${id}.bin`, import.meta.url)).then((r) => r.arrayBuffer()).then((buf) => {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x31465253) throw new Error('bad surface file ' + id);
    const hl = dv.getUint32(4, true);
    const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)).replace(/\0+$/, ''));
    let off = 8 + hl;
    const pad4 = (n) => (n + 3) & ~3;
    const posI = new Int16Array(buf, off, head.nV * 3); off += pad4(head.nV * 6);
    const colU = new Uint8Array(buf, off, head.nV * 3); off += pad4(head.nV * 3);
    const idx = head.idx32 ? new Uint32Array(buf, off, head.nI) : new Uint16Array(buf, off, head.nI);
    const pos = new Float32Array(head.nV * 3);
    for (let i = 0; i < pos.length; i++) pos[i] = posI[i] / 32767;          // unit radius
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(colU), 3, true));
    geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
    geo.computeVertexNormals();
    return { id, geo, radius: head.radius, ext: head.ext };
  });
  cache.set(id, p);
  return p;
}

/** word picture of a protein's outline from its extents (x = width, y = height, z = depth) */
function describe(s) {
  const [x, y, z] = s.ext;
  const tall = y / x, depth = z / Math.max(x, y);
  if (tall > 2.2) return tr('l3.shape.rod');
  if (tall > 1.45) return tr(depth < 0.55 ? 'l3.shape.tallflat' : 'l3.shape.tall');
  if (depth < 0.5) return tr('l3.shape.flat');
  return tr('l3.shape.blob');
}

/** big sprite title that fits (makeLabel's font is too large for a long line) */
function bigTitle(title, sub) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle';
  // shrink long lines (other languages) so they stay inside the 1024 px texture
  const fit = (px, weight, str) => { g.font = `${weight} ${px}px system-ui, sans-serif`; const w = g.measureText(str).width; return w > 960 ? Math.floor(px * 960 / w) : px; };
  const ts = fit(92, 800, title), ss = fit(48, 500, sub);
  g.font = `800 ${ts}px system-ui, sans-serif`; g.fillStyle = '#ffd166'; g.shadowColor = '#ffd166'; g.shadowBlur = 28; g.fillText(title, 512, 96);
  g.shadowBlur = 0; g.font = `500 ${ss}px system-ui, sans-serif`; g.fillStyle = '#c9d4ff'; g.fillText(sub, 512, 200);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
}

/** soft clay-like matcap: lit from the upper left, gentle shadow, a cool rim - independent of the scene's lights */
let _matcap = null;
function matcapTexture() {
  if (_matcap) return _matcap;
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  const L = new THREE.Vector3(-0.45, 0.6, 0.66).normalize(), L2 = new THREE.Vector3(0.6, -0.2, 0.5).normalize();
  const lo = new THREE.Color('#8e9ad0'), hi = new THREE.Color('#ffffff'), rim = new THREE.Color('#bfe9ff'), tmp = new THREE.Color(), n = new THREE.Vector3();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = (x + 0.5) / N * 2 - 1, py = 1 - (y + 0.5) / N * 2, r2 = px * px + py * py, i = (y * N + x) * 4;
    if (r2 > 1) { img.data.set([142, 154, 208, 255], i); continue; }
    n.set(px, py, Math.sqrt(1 - r2));
    const d = Math.pow(THREE.MathUtils.clamp(n.dot(L) * 0.5 + 0.5, 0, 1), 1.35);
    tmp.copy(lo).lerp(hi, d);
    tmp.lerp(rim, Math.pow(1 - n.z, 3.2) * 0.45);                      // cool rim light
    tmp.multiplyScalar(0.93 + 0.12 * Math.max(0, n.dot(L2)));        // faint fill from the lower right
    img.data.set([Math.round(tmp.r * 255), Math.round(tmp.g * 255), Math.round(tmp.b * 255), 255], i);
  }
  g.putImageData(img, 0, 0);
  _matcap = new THREE.CanvasTexture(c); _matcap.colorSpace = THREE.SRGBColorSpace;
  return _matcap;
}
export const surfaceMaterial = () => new THREE.MeshMatcapMaterial({ matcap: matcapTexture(), vertexColors: true });

/** thin dark outline: the same mesh pushed out along its normals and drawn inside-out */
const outlineMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: { uThick: { value: 0.016 }, uColor: { value: new THREE.Color('#1c2866') }, uOpacity: { value: 1 } },
  vertexShader: 'uniform float uThick; void main() { vec3 p = position + normal * uThick; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
  fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; void main() { gl_FragColor = vec4(uColor, uOpacity); }',
});
const makeOutline = (geo, fade = false) => {
  const mat = outlineMat.clone(); mat.transparent = fade; // opaque outlines depth-sort correctly behind their model
  return new THREE.Mesh(geo, mat);
};

function sunburst() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(512, 512, 40, 512, 512, 720);
  grad.addColorStop(0, '#fffbe0'); grad.addColorStop(0.55, '#ffe08a'); grad.addColorStop(1, '#ff9a3d');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 1024);
  g.translate(512, 512);
  for (let i = 0; i < 24; i++) { g.rotate(Math.PI / 12); g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.moveTo(0, 0); g.lineTo(900, -70); g.lineTo(900, 70); g.closePath(); g.fill(); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Level3 {
  constructor(game) {
    this.game = game;
    this.protein = { name: tr('l3.name'), id: 'quiz' };
    this.index = 0;
    this.group = new THREE.Group(); this.group.visible = false;
    game.world.add(this.group);
    this.phase = 'loading';       // loading | play | revealed | done
    this.round = 0; this.mistakes = 0; this.hints = 0; this.roundHints = 0; this.solved = [];
    this.coach = { title: '', body: '', tone: 'info' };
    this.t = 0;
    this._inv = new THREE.Matrix4();
    this.cards = []; this.solvedFlags = [];
    this._buildStage();
    this.reset();
  }

  // ------------------------------------------------------------------ stage
  _buildStage() {
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.7), new THREE.MeshBasicMaterial({ map: sunburst(), toneMapped: false }));
    back.position.set(STAGE.x, STAGE.y, STAGE.z - 0.35);
    this.back = back; this.group.add(back);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(2.1, 1.7)), new THREE.LineBasicMaterial({ color: 0xff3df2, toneMapped: false }));
    frame.position.copy(back.position); this.group.add(frame);
    const title = bigTitle(tr('l3.title'), tr('l3.title.sub'));
    title.scale.set(1.5, 0.375, 1); title.position.set(STAGE.x, STAGE.y + 1.1, STAGE.z - 0.3); this.group.add(title);
    // a soft floor pad under the shadow
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.58, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3df2, toneMapped: false }));
    pad.position.set(STAGE.x, 0.85, STAGE.z); this.group.add(pad);
    // the shadow (black, unlit) and, after a right guess, the coloured reveal
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x03040a, transparent: true, opacity: 1, toneMapped: false });
    this.shadow = new THREE.Mesh(new THREE.BufferGeometry(), this.shadowMat);
    this.shadow.position.copy(STAGE); this.group.add(this.shadow);
    this.revealMat = surfaceMaterial(); this.revealMat.transparent = true; this.revealMat.opacity = 0;
    this.reveal = new THREE.Mesh(new THREE.BufferGeometry(), this.revealMat);
    this.revealOutline = makeOutline(new THREE.BufferGeometry(), true); this.revealOutline.material.uniforms.uOpacity.value = 0; this.reveal.add(this.revealOutline);
    this.reveal.position.copy(STAGE); this.group.add(this.reveal);
    this.revealT = 1;
    // drop-zone halo (visible while a card is held near the shadow)
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(DROP_R, 24, 16), new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.halo.position.copy(STAGE); this.group.add(this.halo);
  }

  // ------------------------------------------------------------------ flow
  reset() {
    this.round = 0; this.mistakes = 0; this.hints = 0; this.solved = ROUNDS.map(() => false);
    this.phase = 'loading';
    this.say(tr('l3.name'), tr('l3.loading'));
    this._clearCards();
    if (!this._booting) {
      this._booting = Promise.all(Object.keys(POOL).map(loadSurface)).then(() => { this._booting = null; if (this.phase === 'loading') this.startRound(this.groupRound ?? 0); }).catch((e) => { this._booting = null; console.warn(e); this.say(tr('l3.loadfail'), String(e.message || e), 'bad'); });
    }
  }

  async startRound(i) {
    this.round = i; this.roundHints = 0; this.phase = 'play';
    const R = ROUNDS[i];
    const target = await loadSurface(R.target);
    this.target = target; this.targetInfo = POOL[R.target];
    // the shadow (same view every time) and an empty reveal
    this.shadow.geometry = target.geo; this.reveal.geometry = target.geo; this.revealOutline.geometry = target.geo;
    const rs = Math.min(0.8, 1.55 * dispRadius(target.radius));
    this.shadow.scale.setScalar(rs); this.reveal.scale.setScalar(rs);
    this.shadowMat.opacity = 1; this.revealMat.opacity = 0; this.revealOutline.material.uniforms.uOpacity.value = 0; this.revealT = 1; this.shadow.visible = true;
    // choices: the target and the other three, shuffled
    const ids = [R.target, ...R.others];
    for (let k = ids.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [ids[k], ids[j]] = [ids[j], ids[k]]; }
    this._clearCards();
    const surfaces = await Promise.all(ids.map(loadSurface));
    surfaces.forEach((s, k) => this._makeCard(s, k, ids.length, R.twist));
    this.say(tr('l3.round', { i: i + 1, n: ROUNDS.length }), tr('l3.round.body', { input: this.game.inputHint(true), twist: R.twist === 'none' ? '' : tr('l3.twist') }));
  }

  _clearCards() {
    for (const c of this.cards) { this.group.remove(c.group, c.label, c.pad); }
    this.cards = [];
  }

  _makeCard(surf, k, n, twist) {
    const info = POOL[surf.id];
    const g = new THREE.Group();
    const r = dispRadius(surf.radius);
    const mesh = new THREE.Mesh(surf.geo, surfaceMaterial());
    const outline = makeOutline(surf.geo); mesh.add(outline);
    mesh.scale.setScalar(r);
    const label = makeLabel(info.short || info.name, '', CATEGORIES[info.category].color); // name only: the category is revealed after a right guess
    label.scale.set(0.52, 0.13, 1);
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ visible: false }));
    bubble.scale.setScalar(r * 1.1 + 0.03);
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.185, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.7, toneMapped: false }));
    g.add(mesh, bubble);
    this.group.add(g); this.group.add(label); this.group.add(pad);
    const th = (k - (n - 1) / 2) * 0.5;
    const home = new THREE.Vector3(Math.sin(th) * 1.2, 0.98, -Math.cos(th) * 1.2 + 0.1);
    pad.position.set(home.x, 0.6, home.z);
    const labelY = home.y - r - 0.12;
    const q0 = new THREE.Quaternion();
    if (twist === 'roll') q0.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (Math.random() < 0.5 ? 1 : -1) * (1.0 + Math.random() * 1.6));
    else if (twist === 'free') q0.setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
    g.position.copy(home); g.quaternion.copy(q0);
    const card = { outline, id: surf.id, info, surf, group: g, mesh, label, pad, bubble, home, q0, r, labelY, held: false, hover: false, state: 'idle', disabled: false, tried: false, t: 0, from: new THREE.Vector3(), holdPos: new THREE.Vector3(), isCard: true };
    bubble.userData.card = card;
    this.cards.push(card);
  }

  say(title, body, tone = 'info') { this.coach = { title, body, tone }; this.game.coachPanel.redraw(); }
  sig() { return `${this.round}|${this.phase}|${this.mistakes}|${this.hints}|${this.solved.filter(Boolean).length}`; }
  get joined() { return this.solved.filter(Boolean).length; }
  get nJ() { return 1; }
  /** group challenge: the shadow was guessed */
  groupSolved() { return this.phase === 'revealed' || this.phase === 'done'; }

  hint() {
    if (this.phase !== 'play') return;
    this.hints++; this.roundHints++;
    if (this.roundHints === 1) {
      this.say(tr('l3.hint1.title'), tr('l3.clue', { clue: this.targetInfo.clue }), 'warn');
    } else {
      const wrongOnes = this.cards.filter((c) => c.id !== ROUNDS[this.round].target && !c.disabled);
      const c = wrongOnes[Math.floor(Math.random() * wrongOnes.length)];
      if (c) { c.disabled = true; c.label.material.opacity = 0.3; this.say(tr('l3.hint2.title'), tr('l3.hint2', { name: c.info.name, clue: this.targetInfo.clue }), 'warn'); }
      else this.say(tr('hint'), tr('l3.clue', { clue: this.targetInfo.clue }), 'warn');
    }
  }

  guess(card) {
    const R = ROUNDS[this.round];
    if (card.id === R.target) {
      this.phase = 'revealed'; this.solved[this.round] = true;
      sfx.good();
      this.revealT = 0;
      card.state = 'gone'; card.t = 0;
      this.game.bursts.spawn(STAGE, 0xffe08a, 90, 1.5);
      const info = this.targetInfo, cat = CATEGORIES[info.category];
      const last = this.round === ROUNDS.length - 1;
      this.say(`✓ ${info.name}`, tr('l3.right', { cat: cat.label, pdb: info.pdb, fact: info.fact, last: last ? tr('l3.last') : '' }), 'good');
    } else {
      this.mistakes++; card.tried = true; card.state = 'bad'; card.t = 0; card.from.copy(card.group.position);
      sfx.bad();
      const a = describe(this.target), b = describe(card.surf);
      const bigger = card.surf.radius / this.target.radius;
      const size = bigger > 1.35 ? tr('l3.bigger', { name: card.info.name }) : bigger < 0.74 ? tr('l3.smaller', { name: card.info.name }) : '';
      this.say(tr('l3.wrong.title'), tr('l3.wrong', { a, b, name: card.info.name, size }), 'bad');
    }
  }

  next() {
    if (this.phase !== 'revealed') return;
    if (this.round >= ROUNDS.length - 1) { this.finish(); return; }
    this.startRound(this.round + 1);
  }

  finish() {
    this.phase = 'done';
    this._clearCards();
    this.shadowMat.opacity = 0; this.revealMat.opacity = 1; this.revealOutline.material.uniforms.uOpacity.value = 1; this.reveal.scale.setScalar(0.5);
    const stars = this.mistakes <= 2 && this.hints <= 3 ? 3 : this.mistakes <= 6 ? 2 : 1;
    sfx.win();
    this.say(tr('l3.done.title', { stars: '★'.repeat(stars) + '☆'.repeat(3 - stars) }), tr('l3.done', { n: ROUNDS.length, m: this.mistakes, h: this.hints }), 'good');
    ROUNDS.forEach((_, i) => setTimeout(() => this.game.bursts.spawn(new THREE.Vector3(-0.9 + i * 0.26, 1.7, -1.5), 0xffe08a, 40, 1.2), i * 160));
  }

  // ------------------------------------------------------------------ pointers
  handlePointers(pointers, raycaster, dt) {
    const g = this.game;
    const live = this.phase === 'play' ? this.cards.filter((c) => !c.disabled && c.state === 'idle') : [];
    const targets = [...g.panels.filter((p) => p.mesh.visible).map((p) => p.mesh), ...live.map((c) => c.bubble)];
    const hovBtn = new Map(g.panels.map((p) => [p, null]));
    this.cards.forEach((c) => (c.hover = false));
    let nearShadow = false;
    for (const ptr of pointers) {
      if (ptr.holding && !ptr.holding.isCard) ptr.holding = null;
      const was = ptr.prevPressed;
      ptr.hit = null; ptr.hitDist = 3;
      raycaster.set(ptr.origin, ptr.dir); raycaster.far = 6;
      const hits = ptr.holding ? [] : raycaster.intersectObjects(targets, false);
      let btn = null, card = null;
      if (hits.length) {
        const h = hits[0];
        ptr.hit = h.point; ptr.hitDist = h.distance;
        if (h.object.userData.panel) { const pan = h.object.userData.panel; btn = pan.pick(h.uv); if (btn) hovBtn.set(pan, btn.label); }
        else if (h.object.userData.card) card = h.object.userData.card;
      }
      if (card) card.hover = true;
      if (ptr.pressed && !was) {
        sfx.unlock();
        if (btn && !btn.disabled) { sfx.click(); ptr.haptic?.(0.4, 30); ptr.captured = true; btn.onClick(); }
        else if (card) { this.grab(card, ptr); ptr.captured = true; }
        else ptr.captured = !!(hits.length && hits[0].object.userData.panel);
      }
      if (!ptr.pressed) ptr.captured = false;
      if (ptr.holding) { nearShadow = this.hold(ptr, dt) || nearShadow; }
      ptr.prevPressed = ptr.pressed;
    }
    for (const [pan, label] of hovBtn) pan.setHover(label);
    this.halo.material.opacity += ((nearShadow ? 0.16 : 0) - this.halo.material.opacity) * Math.min(1, dt * 10);
  }

  grab(card, ptr) {
    ptr.holding = card; card.held = true; card.state = 'held'; ptr._rot = null;
    const w = this.game.world;
    card.holdPos.copy(card.group.position);
    ptr.holdDist = THREE.MathUtils.clamp(w.worldToLocal(ptr.origin.clone()).distanceTo(card.group.position), 0.3, 3);
    sfx.grab(); ptr.haptic?.(0.6, 50);
  }

  /** returns true while the held card is near the shadow */
  hold(ptr, dt) {
    const card = ptr.holding, w = this.game.world;
    ptr.holdDist = THREE.MathUtils.clamp(ptr.holdDist + (ptr.holdDelta || 0), 0.25, 3.4);
    const o = w.worldToLocal(ptr.origin.clone());
    const d = ptr.dir.clone().transformDirection(this._inv.copy(w.matrixWorld).invert());
    const target = o.clone().addScaledVector(d, ptr.holdDist);
    // aim assist: a ray pointed at the shadow pulls the card in front of it (flat screens have no depth)
    const front = STAGE.clone().add(new THREE.Vector3(0, 0, 0.45));
    const t = Math.max(0.3, _v.subVectors(front, o).dot(d)), onRay = o.clone().addScaledVector(d, t), perp = onRay.distanceTo(front);
    if (perp < 0.7) target.copy(onRay).lerp(front, 1 - perp / 0.7);
    const rotating = applyRotation(ptr, card.group.quaternion, w.quaternion);
    if (!rotating) card.holdPos.lerp(target, 1 - Math.pow(0.0005, dt));
    card.group.position.copy(card.holdPos);
    ptr.hit = w.localToWorld(target.clone()); ptr.hitDist = ptr.origin.distanceTo(ptr.hit);
    const near = card.group.position.distanceTo(STAGE) < DROP_R + 0.2;
    if (!ptr.pressed) {
      ptr.holding = null; card.held = false;
      if (card.group.position.distanceTo(STAGE) < DROP_R + 0.2) this.guess(card);
      else { card.state = 'returning'; card.t = 0; card.from.copy(card.group.position); sfx.click(); }
    }
    return near;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, t, pointers, raycaster) {
    this.t = t;
    this.handlePointers(pointers, raycaster, dt);
    for (const c of this.cards) {
      const g = c.group;
      if (c.state === 'idle') { g.position.copy(c.home); g.position.y += Math.sin(t * 1.5 + c.home.x * 3) * 0.012; g.scale.setScalar(1); }
      else if (c.state === 'returning') {
        c.t += dt; const a = ease(c.t / 0.7);
        g.position.lerpVectors(c.from, c.home, a); if (c.t >= 0.7) c.state = 'idle';
      } else if (c.state === 'bad') {
        c.t += dt;
        if (c.t < 0.6) { g.position.copy(c.from); g.position.x += Math.sin(c.t * 60) * 0.02 * (1 - c.t / 0.6); c.mesh.material.color.setRGB(1, 1 - 0.65 * (1 - c.t / 0.6), 1 - 0.65 * (1 - c.t / 0.6)); }
        else { c.mesh.material.color.setRGB(1, 1, 1); c.state = 'returning'; c.t = 0; c.from.copy(g.position); }
      } else if (c.state === 'gone') {
        c.t += dt; g.scale.setScalar(Math.max(0.001, 1 - c.t * 2.5)); g.position.lerp(STAGE, Math.min(1, dt * 6)); c.label.visible = false;
      }
      // label under the card, pad glow
      c.label.position.set(c.home.x, c.labelY + 0.035, c.home.z); c.label.visible = c.state !== 'gone';
      c.label.material.opacity = c.disabled ? 0.3 : 1;
      c.pad.material.opacity = c.disabled ? 0.15 : c.hover || c.held ? 1 : 0.6;
      c.mesh.material.opacity = 1; c.mesh.material.transparent = c.disabled; if (c.disabled) c.mesh.material.opacity = 0.18;
      c.outline.material.transparent = c.disabled; c.outline.material.uniforms.uOpacity.value = c.disabled ? 0.15 : 1;
    }
    // reveal: the black shadow turns into the coloured protein
    if (this.revealT < 1) {
      this.revealT = Math.min(1, this.revealT + dt / 1.4);
      const a = ease(this.revealT);
      this.revealMat.opacity = a; this.revealOutline.material.uniforms.uOpacity.value = a; this.shadowMat.opacity = 1 - a;
      if (this.revealT >= 1) this.shadow.visible = false;
    }
    // gentle turn of the revealed protein so its shape can be admired
    if (this.phase === 'revealed' || this.phase === 'done') this.reveal.rotation.y = Math.sin(t * 0.6) * 0.5;
    else this.reveal.rotation.y = 0;
    this.back.material.color.setScalar(0.92 + 0.08 * Math.sin(t * 1.2));
  }

  // ------------------------------------------------------------------ panels
  drawCoach(p) {
    const { w, h } = p, g = this.game, c = this.coach;
    const tone = { info: THEME.border, good: THEME.good, bad: THEME.bad, warn: THEME.warn }[c.tone] || THEME.border;
    const bodyY = p.text(c.title, 56, 34, { size: 44, weight: 800, color: tone, shadow: tone, maxW: w - 112, lh: 1.15 }) + 14;
    p.text(c.body, 56, bodyY, { size: 31, maxW: w - 112, lh: 1.3 });
    const r1 = h - 196, r2 = h - 100, bh = 78;
    const options = () => p.button(g.menuOpen ? tr('options.close') : tr('options'), w - 56 - 290, r2, 290, bh, () => g.toggleMenu(), { active: g.menuOpen, size: 32 });
    if (g.group.inRound) {         // group challenge: clock, score and progress; the server moves to the next shadow
      const solved = this.groupSolved();
      p.text(solved ? g.group.solvedLine() : g.group.statusLine(this), 56, r1 - 58, { size: 30, weight: 700, color: solved ? THEME.good : THEME.text, maxW: w - 112 });
      if (!solved) p.button(tr('hint'), 56, r1, 190, bh, () => this.hint(), { disabled: this.phase !== 'play' });
      options();
      return;
    }
    if (this.phase === 'play' || this.phase === 'loading') {
      p.text(tr('l3.status', { r: this.round + 1, n: ROUNDS.length, m: this.mistakes }), 56, r1 - 58, { size: 34, weight: 700 });
      p.button(tr('hint'), 56, r1, 190, bh, () => this.hint(), { disabled: this.phase !== 'play' });
      p.button(tr('restart'), 266, r1, 240, bh, () => this.reset());
      options();
    } else if (this.phase === 'revealed') {
      const last = this.round === ROUNDS.length - 1;
      p.button(tr(last ? 'l3.finish' : 'l3.nextshadow'), 56, r1, 330, bh, () => this.next(), { primary: true });
      options();
    } else {
      p.button(tr('play.again'), 56, r1, 300, bh, () => this.reset(), { primary: true });
      p.button(tr('menu.back'), 56, r2, 330, bh, () => { g.menuOpen = true; g.redrawAll(); }, { size: 30 });   // the Options board lists the levels
      options();
    }
  }

  drawSide(p) {
    const { w, g } = p;
    p.text(tr('l3.gallery'), 50, 34, { size: 44, weight: 800, color: THEME.border });
    p.text(tr('l3.gallery.sub'), 50, 100, { size: 27, color: THEME.dim, maxW: w - 100 });
    let y = 190;
    ROUNDS.forEach((R, i) => {
      const info = POOL[R.target], cat = CATEGORIES[info.category], done = this.solved[i];
      g.fillStyle = done ? cat.color : '#3a4366'; g.fillRect(50, y + 4, 10, 40);
      p.text(done ? info.name : tr('l3.shadow', { i: i + 1 }), 76, y, { size: 29, weight: 800, color: done ? cat.color : THEME.dim });
      p.text(done ? `${cat.label} · PDB ${info.pdb}` : (i === this.round && this.phase !== 'done' ? tr('l3.who') : '?'), 76, y + 30, { size: 25, color: done ? THEME.good : THEME.dim });
      y += 66;
    });
    y += 14;
    p.text(this.game.rotateHint(), 50, y, { size: 24, color: THEME.warn, maxW: w - 100, lh: 1.2 });
  }
}
