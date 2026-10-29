// Level 0 - "From Sequence to Shape": tutorial + sorting game.
import * as THREE from 'three';
import { Chain, K } from './chain.js';
import { Vessel, makeLabel } from './vessels.js';
import { HBondViz } from './hbonds.js';
import { Panel, THEME } from './ui.js';
import {
  optimizeSheet, findHBonds, PROPENSITY, CLASS_INDEX, RESIDUE_NAMES, RGROUP, classifySequence, scoreSequence, rgroupOf,
} from './chemistry.js';
import { sfx } from './audio.js';
import { Level1 } from './level1.js';
import { Level2 } from './level2.js';
import { Level3 } from './level3.js';
import { applyRotation } from './handle.js';
import { PROTEINS, COMPLEXES } from './proteins/index.js';
import { t, LANGS, getLang, setLang } from './i18n.js';
import { Group } from './group.js';
import { SEQUENCES } from './sequences.js';
import { Lab } from './lab.js';
import { Gallery } from './gallery.js';

const KINDS = {
  helix: { color: '#38e8ff', like: 'Ala (A), Leu (L), Glu (E), Met (M), Lys (K)', letters: 'ALEMK' },
  strand: { color: '#ff3df2', like: 'Val (V), Ile (I), Tyr (Y), Phe (F), Thr (T)', letters: 'VIYFT' },
  coil: { color: '#ffd166', like: 'Gly (G), Pro (P), Ser (S), Asn (N), Asp (D)', letters: 'GPSND' },
};
const kname = (k) => t(`kind.${k}.name`);


const _tmp = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _right = new THREE.Vector3(1, 0, 0);
const hexNum = (s) => parseInt(s.slice(1), 16);
const STAGE_KINDS = ['helix', 'strand', 'coil'];        // solo Level 0 is played one structure at a time, in this order
const STAGE_CENTER = new THREE.Vector3(0, 1.5, -1.45);   // where the vessel of the current stage stands
const TRAY_SCALE = 1.3;
const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t) => Math.min(1, Math.max(0, t));

const STEPS = ['primary', 'primary', 'helix', 'sheet', 'coil', null].map((demo, i) => ({ demo, i }));

class Bursts {
  constructor() {
    const N = 360;
    this.N = N;
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 3);
    this.vel = new Float32Array(N * 3); this.life = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.points.frustumCulled = false;
    this.cursor = 0;
  }
  spawn(p, color, count = 60, speed = 1.2) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.cursor++ % this.N;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), s = speed * (0.35 + Math.random());
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel.set([Math.sin(ph) * Math.cos(th) * s, Math.sin(ph) * Math.sin(th) * s + 0.4, Math.cos(ph) * s], i * 3);
      this.col.set([c.r, c.g, c.b], i * 3);
      this.life[i] = 0.9 + Math.random() * 0.8;
    }
  }
  update(dt) {
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -50; continue; }
      this.life[i] -= dt;
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
      this.vel[i * 3 + 1] -= 1.2 * dt;
      for (let a = 0; a < 3; a++) this.vel[i * 3 + a] *= 0.985;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

export class Game {
  constructor() {
    this.world = new THREE.Group();
    this.l0 = new THREE.Group(); // everything that belongs to Level 0
    this.world.add(this.l0);
    this.level = 0;
    this.sheet = optimizeSheet();
    this.mode = 'desktop';
    this.support = { vr: false, ar: false };
    this.hooks = { switchMode: () => {}, setFloor: () => {}, setHeight: () => {}, recenter: () => {} };
    this.floor = 'hex';
    this.heightOffset = 0;
    this.phase = 'intro';
    this.step = 0;
    this.staged = false; this.stage = 0; this.stageDoneT = -1;   // solo Level 0: one structure at a time (helix, then sheet, then coil)
    this.mistakes = 0;
    this.hintCount = 0;
    this.coach = { title: '', body: '', tone: 'info' };
    this.showHint = false;
    this.lastChain = null;
    this.reveal = 0; // 0 intro, 1 play (animated)
    this.time = 0;
    this._inv = new THREE.Matrix4();

    this.hb = new HBondViz(96);
    this.bursts = new Bursts();
    this.l0.add(this.hb.mesh);
    this.world.add(this.bursts.points);

    this.group = new Group(this);   // group challenge (headset side); inactive until a room is joined
    this.lab = new Lab(this);       // Level 0 sequence lab (free play)
    this._buildVessels();
    this._buildTray();
    this._buildDemos();
    this._buildPanels();
    this._buildLevels();
    this.setStep(0);
  }

  /** Levels 1-3 (also rebuilt when the language changes, because their labels are drawn into textures) */
  _buildLevels() {
    this.l1s = PROTEINS.map((pr, i) => new Level1(this, pr, i)); // one puzzle per protein
    this.l2s = COMPLEXES.map((pr, i) => new Level2(this, pr, i)); // Level 2: multi-chain complexes
    this.l3s = [new Level3(this), new Gallery(this)];              // Level 3: the shadow quiz, and the free-play protein gallery
    this.l1 = this.l1s[0];                                         // `l1` is always the puzzle currently shown
  }

  /** switch the language and redraw everything that holds text */
  changeLang(code) {
    if (code === getLang()) return;
    const lvl = this.level, idx = this.l1 ? this.l1.index : 0, wasMenu = this.menuOpen;
    if (this.group.inRound) return;   // would restart the puzzle (the menu disables the buttons too)
    setLang(code);
    for (const l of [...this.l1s, ...this.l2s, ...this.l3s]) this.world.remove(l.group);
    this._buildLevels();
    this.vessels.forEach((v) => this._labelVessel(v));
    if (this.group.active) this.groupIdle();
    else if (lvl >= 1) this.setLevel(lvl, idx);
    else this._refreshCoach();
    this.menuOpen = wasMenu;
    this.redrawAll();
  }

  /** Level 0: rewrite the current coach message in the new language (keeps the game state) */
  _refreshCoach() {
    if (this.phase === 'intro') { this.setStep(this.step); return; }
    if (this.phase === 'lab') { this.lab.refreshText(); return; }
    if (this.phase === 'play' && this.staged) { this.coach = this._stageCoach(); this.showHint = false; return; }
    if (this.phase === 'done') { this.coach = this._winCoach(); return; }
    this.coach = { title: t('play.title'), body: t('play.body', { input: this.inputHint() }), tone: 'info' };
    this.showHint = false;
  }

  // ------------------------------------------------------------------ building
  _buildVessels() {
    const defs = [['helix', -1.0, 0.38], ['strand', 0, 0], ['coil', 1.0, -0.38]];
    this.vessels = defs.map(([kind, x, yaw]) => {
      const v = new Vessel(kind, this.sheet);
      v.group.position.set(x, 1.5, -1.45 + Math.abs(x) * 0.2);
      v.group.rotation.y = yaw;
      v.group.updateMatrix();
      v.homePos = v.group.position.clone(); v.homeYaw = yaw;   // classic layout: three vessels side by side
      v.show = 1; v.activeTarget = true;                        // staged play: only the current structure's vessel is active
      this._labelVessel(v);
      this.l0.add(v.group);
      return v;
    });
  }

  _labelVessel(v) {
    if (v.label) v.group.remove(v.label);
    const label = makeLabel(t(`vessel.${v.kind}.title`), t(`vessel.${v.kind}.sub`), KINDS[v.kind].color);
    label.position.set(0, 0.5, 0);
    v.group.add(label);
    v.label = label;
  }

  _buildTray() {
    this.chains = [];
    const arcR = 1.0;
    SEQUENCES.forEach((s, i) => {
      if (classifySequence(s.seq) !== s.cls) console.warn('sequence class mismatch', s);
      const c = new Chain(s.seq, { seed: i + 3, unfolded: 'coil', id: 'seq' + i });
      c.userData = { state: 'tray', cls: s.cls, t: 0, from: new THREE.Vector3(), vel: new THREE.Vector3(), attempts: 0, homeScale: TRAY_SCALE };
      const th = (i - (SEQUENCES.length - 1) / 2) * 0.34;
      c.userData.home = new THREE.Vector3(Math.sin(th) * arcR, 1.08, -Math.cos(th) * arcR + 0.1);
      c.group.position.copy(c.userData.home);
      c.group.scale.setScalar(TRAY_SCALE);
      c.setBubble(true);
      c.bubble.material.side = THREE.DoubleSide;
      this.l0.add(c.group);
      this.chains.push(c);
    });
    // glowing pads under each chain
    this.pads = this.chains.map((c) => {
      const pad = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.165, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.7, toneMapped: false }));
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.15, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a2a6a, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
      pad.add(ring, disc);
      pad.position.copy(c.userData.home); pad.position.y -= 0.27;
      this.l0.add(pad);
      return pad;
    });
    this.shelf = new THREE.Group();
  }

  _buildDemos() {
    const mk = (seq, seed) => { const c = new Chain(seq, { seed, unfolded: 'ppii', id: 'demo-' + seq }); c.setBubble(false); c.bubble.material.side = THREE.DoubleSide; c.fitBubble(0.4); c.userData = { demo: true }; c.group.visible = false; this.l0.add(c.group); return c; };
    this.demos = {
      primary: mk('AVLEKGSTR', 11),
      helix: mk('AELLKEALK', 12),
      sheetA: mk('VTVIYVTIV', 13),
      sheetB: mk('FYTVIWTYV', 14),
      coil: mk('GPSNGDPGS', 15),
    };
    // the ribbons use the colours of the rest of the game (helix cyan, strand pink), still translucent (Chain fades the opacity in as it folds)
    const tint = (c, color) => { c.ribbon.material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.22, roughness: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.62, depthWrite: false }); };
    tint(this.demos.helix, KINDS.helix.color);
    tint(this.demos.sheetA, KINDS.strand.color); tint(this.demos.sheetB, KINDS.strand.color);
    this.demoCenter = new THREE.Vector3(0, 1.35, -1.15);
    this.demoScale = 1.45;
    for (const c of Object.values(this.demos)) c.group.scale.setScalar(this.demoScale);
    this.demoRun = { key: null, t: 0 };
    this.demoRot = new THREE.Quaternion(); // user + automatic rotation of the tutorial molecule
    this.demoHeld = false;
  }

  _buildPanels() {
    // two boards only: Field guide (left, swaps to Options on demand) and the coach (right)
    this.menuOpen = false;
    this.sidePanel = new Panel({ width: 0.8, height: 1.05, ppm: 950 });
    this.sidePanel.mesh.position.set(-2.1, 1.45, -1.6);
    this.sidePanel.mesh.rotation.y = 0.85;
    this.coachPanel = new Panel({ width: 1.1, height: 1.05, ppm: 900 });
    this.coachPanel.mesh.position.set(2.1, 1.45, -1.6);
    this.coachPanel.mesh.rotation.y = -0.85;
    this.panels = [this.coachPanel, this.sidePanel];
    this.panels.forEach((p) => this.world.add(p.mesh));
    this.redrawAll();
  }

  /** VR: a small Center button in the top-right corner of the left board (always in reach, whatever is being played) */
  _centerButton(p) {
    if (this.mode === 'desktop') return;
    p.button(t('menu.center'), p.w - 50 - 176, 22, 176, 64, () => this.hooks.recenter(), { size: 26 });
  }

  /**
   * The tutorial has a single molecule in the middle, so the boards come in close (no need to turn the head and lose the
   * animation); with the vessels and trays they stay out wide. They glide between the two layouts.
   */
  _placePanels(dt) {
    // 'tutorial': one molecule in the middle, boards right next to it. 'rack': something playable in front (the sequences, the
    // pieces, the choices, the gallery model): boards just beyond its ends. 'far': three vessels / the lab are spread out wide.
    let layout = 'far';
    if (this.group.panelMode || this.level >= 1) layout = 'rack';
    else if (this.level === 0 && this.phase !== 'lab' && this.phase !== 'done' && (!this.group.active || this.group.inRound)) layout = this.phase === 'play' ? 'rack' : 'tutorial';
    const L = layout === 'far' ? { p: [-2.1, 1.45, -1.6], r: 0.85 } : layout === 'rack' ? { p: [-1.3, 1.52, -1.3], r: 0.55 } : { p: [-1.0, 1.42, -1.25], r: 0.5 };
    const R = layout === 'far' ? { p: [2.1, 1.45, -1.6], r: -0.85 } : layout === 'rack' ? { p: [1.5, 1.52, -1.3], r: -0.55 } : { p: [1.15, 1.42, -1.25], r: -0.5 };
    const k = this._panelsPlaced ? 1 - Math.exp(-dt * 5) : 1;   // the first call snaps
    this._panelsPlaced = true;
    for (const [panel, tg] of [[this.sidePanel, L], [this.coachPanel, R]]) {
      panel.mesh.position.lerp(_tmp.set(...tg.p), k);
      panel.mesh.rotation.y += (tg.r - panel.mesh.rotation.y) * k;
    }
  }

  redrawAll() {
    this.coachPanel.set((p) => this._drawCoach(p));
    this.sidePanel.set((p) => {
      if (this.menuOpen) { this._drawMenu(p); return; }       // (the Options board has its own Center button)
      if (this.group.panelMode) this.group.drawSide(p); else if (this.level >= 1) this.l1.drawSide(p); else this._drawSide(p);
      this._centerButton(p);
    });
  }

  // ------------------------------------------------------------------ flow
  /** how to rotate a held object, for the current input mode */
  rotateHint() { return t(this.mode === 'desktop' ? 'rotate.desktop' : 'rotate.xr'); }

  /** how to grab and drop things; `shadow` = the wording for Level 3 */
  inputHint(shadow = false) { return t(`input.${this.mode === 'desktop' ? 'desktop' : 'xr'}${shadow ? '.shadow' : ''}`); }

  setStep(i) {
    this.step = Math.max(0, Math.min(STEPS.length - 1, i));
    const s = STEPS[this.step];
    this.coach = { title: t(`step.${this.step}.title`), body: t(`step.${this.step}.body`, { input: this.inputHint() }), tone: 'info' };
    this.startDemo(s.demo);
    this.redrawAll();
  }

  startDemo(key) {
    this.demoRun = { key, t: 0 };
    this.demoRot.identity();
    Object.values(this.demos).forEach((c) => { c.group.visible = false; c.f = 0; c.stress.fill(0); });
    const D = this.demos;
    const reset = (c) => { c.f = 0; c.kind = 'coil'; c.flip = false; c.weights.fill(1); c.refresh(); };
    if (key === 'primary') { reset(D.primary); D.primary.group.visible = true; D.primary.group.position.copy(this.demoCenter); D.primary.setLabels(true); }
    if (key === 'helix') { reset(D.helix); D.helix.kind = 'helix'; D.helix.group.visible = true; D.helix.group.position.copy(this.demoCenter); }
    if (key === 'sheet') {
      for (const c of [D.sheetA, D.sheetB]) { reset(c); c.kind = 'strand'; c.group.visible = true; }
      D.sheetB.flip = true;
    }
    if (key === 'coil') { reset(D.coil); D.coil.kind = 'coil'; D.coil.group.visible = true; D.coil.group.position.copy(this.demoCenter); this._coilTrace(D.coil, 0); }
  }

  updateDemo(dt) {
    const run = this.demoRun; run.t += dt;
    const D = this.demos, key = run.key;
    if (!key) return;
    // slow turntable spin unless the user is turning the molecule
    if (!this.demoHeld) this.demoRot.premultiply(_qa.setFromAxisAngle(_up, dt * 0.35));
    if (key === 'primary') { D.primary.group.quaternion.copy(this.demoRot); D.primary.group.position.copy(this.demoCenter); return; }
    const f = ease((run.t - 0.9) / 2.8);
    const sc = this.demoScale;
    if (key === 'helix') { D.helix.f = f; D.helix.refresh(); D.helix.group.quaternion.copy(this.demoRot); }
    if (key === 'coil') { D.coil.f = f; D.coil.refresh(); D.coil.group.quaternion.copy(this.demoRot); this._coilTrace(D.coil, f); }
    if (key === 'sheet') {
      const dA = this.sheet.d * K * sc, sA = this.sheet.s * K * sc;
      // tilt the sheet towards the viewer so the ladder of H-bonds between strands is visible
      const rot = _qb.setFromAxisAngle(_right, -0.95).premultiply(this.demoRot);
      for (const [c, sign] of [[D.sheetA, -1], [D.sheetB, 1]]) {
        c.f = f; c.refresh();
        const glide = 1 + (1 - ease((run.t - 0.4) / 1.2)) * 0.9; // strands glide together as they fold
        const off = new THREE.Vector3(sign * sA / 2, 0, sign * (dA / 2) * glide).applyQuaternion(rot);
        c.group.quaternion.copy(rot);
        c.group.position.copy(this.demoCenter).add(off);
      }
    }
    // time-based sound cue once
    if (run.t > 0.9 && !run.sfx && key !== 'primary') { run.sfx = true; sfx.fold(); }
  }

  /**
   * Tutorial coil: a thin translucent round trace along the backbone, like the helix and sheet ribbons but without
   * the flat ribbon (a ribbon would suggest a regular structure). It fades in as the chain forms its loop.
   */
  _coilTrace(chain, f) {
    if (!this._trace) {
      this._trace = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({
        color: KINDS.coil.color, emissive: 0x5a3f00, emissiveIntensity: 1, roughness: 0.4, transparent: true, opacity: 0, depthWrite: false,
      }));
      this._trace.frustumCulled = false;
      chain.group.add(this._trace);
    }
    const op = 0.62 * THREE.MathUtils.smoothstep(f, 0.05, 0.6);
    this._trace.visible = op > 0.01;
    this._trace.material.opacity = op;
    if (!this._trace.visible) return;
    const pts = chain.res.map((r) => r.CA.clone().multiplyScalar(K));
    this._trace.geometry.dispose();
    this._trace.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), pts.length * 8, 0.016, 8, false);
  }

  startPlay() {
    this.phase = 'play';
    this.mistakes = 0; this.hintCount = 0; this.showHint = false;
    Object.values(this.demos).forEach((c) => (c.group.visible = false));
    this.demoRun = { key: null, t: 0 };
    this.staged = true; this.stage = 0; this.stageDoneT = -1;   // solo and group play: one structure at a time
    this.coach = this.staged ? this._stageCoach() : { title: t('play.title'), body: t('play.body', { input: this.inputHint() }), tone: 'info' };
    this.resetPieces();
    this._applyStage(true);
    this.redrawAll();
    sfx.good();
  }

  // ------------------------------------------------------------------ staged Level 0 (solo): helix -> sheet -> coil
  /** only the vessel of the current stage is active (the others fade out); classic play / the finale show all three */
  _applyStage(snap = false) {
    const kind = STAGE_KINDS[Math.min(this.stage, STAGE_KINDS.length - 1)];
    for (const v of this.vessels) {
      v.activeTarget = !this.staged || v.kind === kind;
      if (snap && this.staged && v.activeTarget) v.show = 0;      // the new vessel grows in
    }
  }

  _stageCoach() {
    const kind = STAGE_KINDS[Math.min(this.stage, STAGE_KINDS.length - 1)];
    return { title: t('stage.title', { n: this.stage + 1, kind: kname(kind) }), body: t('stage.body', { rule: t(`kind.${kind}.rule`), input: this.inputHint() }), tone: 'info' };
  }

  updateStage(dt) {
    if (!this.staged || this.phase !== 'play' || this.stageDoneT < 0) return;
    this.stageDoneT += dt;
    if (this.stageDoneT > 5) this.nextStage();
  }

  nextStage() {
    if (!this.staged || this.stageDoneT < 0) return;
    const done = STAGE_KINDS[this.stage];
    for (const c of this.chains) {                                   // the sequences just placed go back to the rack: they stay among the choices
      const u = c.userData;
      if (u.state === 'locked' && u.cls === done) {
        u.stageDone = true;
        u.vessel.slots.forEach((s) => { if (s.chain === c) s.chain = null; });
        c.setLabels(true); c.seqLabel.visible = true;
        this.sendHome(c);
      }
    }
    this.stage = Math.min(STAGE_KINDS.length - 1, this.stage + 1);
    this.stageDoneT = -1;
    this._applyStage(true);
    this.coach = this._stageCoach();
    sfx.click();
    this.redrawAll();
  }

  resetPieces() {
    for (const v of this.vessels) { v.slots.forEach((s) => (s.chain = null)); v.state = 'idle'; }
    for (const c of this.chains) {
      const u = c.userData;
      u.state = 'tray'; u.attempts = 0; u.holder = null; u.stageDone = false;
      c.f = 0; c.kind = 'coil'; c.flip = false; c.weights.fill(1); c.stress.fill(0);
      c.group.position.copy(u.home); c.group.quaternion.identity();
      c.setBubble(true); c.setLabels(true); c.seqLabel.visible = true; c.refresh();
    }
    this.lastChain = null;
    this.reveal = this.phase === 'play' || this.phase === 'lab' ? this.reveal : 0;
  }

  restart() {
    if (this.group.active) return;   // no restarts during a group challenge
    if (this.phase === 'lab') return this.lab.takeOut();
    if (this.level >= 1) return this.l1.reset();
    this.phase = 'intro'; this.step = 0; this.reveal = 0; this.showHint = false;
    this.staged = false; this.stageDoneT = -1; this._applyStage(false);
    this.resetPieces();
    this.setStep(0);
  }

  /** n = 0..3; idx selects the protein / complex for Levels 1 and 2 */
  setLevel(n, idx = 0) {
    if (this.phase === 'lab') this.lab.exit();
    this.level = n; this.menuOpen = false;
    this.l0.visible = n === 0;
    [...this.l1s, ...this.l2s, ...this.l3s].forEach((l) => (l.group.visible = false));
    if (n >= 1 && n <= 3) {
      const list = n === 1 ? this.l1s : n === 2 ? this.l2s : this.l3s;
      this.l1 = list[Math.min(idx, list.length - 1)];   // `l1` = the puzzle currently shown
      this.l1.group.visible = true;
      this.l1.reset();
    } else { this.level = 0; this.restart(); }
    this.redrawAll();
  }

  skipTutorial() { if (!this.group.active) this.startPlay(); }

  /** what the group challenge watches: the current puzzle (Level 1-3 object, or an adapter for Level 0) */
  get puzzle() {
    if (this.level >= 1) return this.l1;
    const game = this;
    return {
      groupKind: 'l0', cards: null,
      sig: () => `${this.placedCount}|${this.mistakes}|${this.hintCount}|${this.phase}`,
      get joined() { return game.placedCount; }, nJ: this.chains.length, get mistakes() { return game.mistakes; }, get hints() { return game.hintCount; },
      groupSolved: () => this.phase === 'done',
    };
  }

  /** group challenge: nothing is played (lobby, countdown, results): hide every puzzle, keep the boards */
  groupIdle() {
    this.level = 0; this.phase = 'done'; this.menuOpen = false; this.showHint = false;
    this.l0.visible = false;
    [...this.l1s, ...this.l2s, ...this.l3s].forEach((l) => (l.group.visible = false));
    this.redrawAll();
  }

  /** group challenge: the server announced a puzzle ({ level, idx }) */
  startGroupChallenge(ch) {
    if (ch.level === 0) {            // Level 0 puzzle: fold the six sequences (no tutorial)
      [...this.l1s, ...this.l2s, ...this.l3s].forEach((l) => (l.group.visible = false));
      this.level = 0; this.menuOpen = false; this.l0.visible = true;
      this.startPlay();
      this.redrawAll();
      return;
    }
    this.l0.visible = false;
    if (ch.level === 3) this.l3s[0].groupRound = ch.idx;   // Level 3: which shadow
    this.setLevel(ch.level, ch.level === 3 ? 0 : ch.idx);   // (Level 3: idx is the shadow, not the list position)
  }

  say(title, body, tone = 'info') { this.coach = { title, body, tone }; this.showHint = false; this.coachPanel.redraw(); }

  get placedCount() { return this.chains.filter((c) => c.userData.state === 'locked' || c.userData.state === 'folding' || c.userData.stageDone).length; }

  // ------------------------------------------------------------------ panels
  _drawCoach(p) {
    if (this.group.panelMode) return this.group.drawCoach(p);
    if (this.phase === 'lab') return this.lab.drawCoach(p);
    if (this.level >= 1) return this.l1.drawCoach(p);
    const { w, h } = p;
    const c = this.coach;
    const tone = { info: THEME.border, good: THEME.good, bad: THEME.bad, warn: THEME.warn }[c.tone] || THEME.border;
    const bodyY = p.text(c.title, 56, 34, { size: 46, weight: 800, color: tone, shadow: tone, maxW: w - 112, lh: 1.15 }) + 14;
    if (this.showHint && this.hintChain) this._drawHint(p, this.hintChain);
    else p.text(c.body, 56, bodyY, { size: 32, maxW: w - 112, lh: 1.3 });
    // footer: two rows of buttons
    const r1 = h - 196, r2 = h - 100, bh = 78;
    const options = () => p.button(this.menuOpen ? t('options.close') : t('options'), w - 56 - 290, r2, 290, bh, () => this.toggleMenu(), { active: this.menuOpen, size: 32 });
    if (this.group.inRound) {          // group challenge: clock, score and progress; no restart / replay / next
      const solved = this.phase === 'done';
      p.text(solved ? this.group.solvedLine() : this.group.statusLine(this.puzzle), 56, r1 - 58, { size: 30, weight: 700, color: solved ? THEME.good : THEME.text, maxW: w - 112 });
      if (!solved) p.button(t('hint'), 56, r1, 190, bh, () => this.hint());
      if (!solved && this.staged && this.stageDoneT >= 0) p.button(t('stage.continue'), 266, r1, 300, bh, () => this.nextStage(), { primary: true, size: 30 });
      options();
      return;
    }
    if (this.phase === 'intro') {
      const last = this.step === STEPS.length - 1;
      p.button(t('back'), 56, r1, 210, bh, () => this.setStep(this.step - 1), { disabled: this.step === 0 });
      p.button(last ? t('start') : t('next'), 290, r1, 260, bh, () => (last ? this.startPlay() : this.setStep(this.step + 1)), { primary: true });
      p.text(`${this.step + 1} / ${STEPS.length}`, w - 56, r1 + 20, { size: 34, color: THEME.dim, align: 'right' });
      if (!last) p.button(t('tb.skip'), 56, r2, 330, bh, () => this.skipTutorial(), { size: 32 });
      options();
    } else if (this.phase === 'play') {
      p.text(t('l0.status', { a: this.placedCount, b: this.chains.length, m: this.mistakes }), 56, r1 - 58, { size: 34, color: THEME.text, weight: 700 });
      p.button(t('hint'), 56, r1, 190, bh, () => this.hint());
      p.button(t('restart'), 266, r1, 240, bh, () => this.startPlay());
      if (this.staged && this.stageDoneT >= 0) p.button(t('stage.continue'), 526, r1, w - 56 - 526, bh, () => this.nextStage(), { primary: true, size: 30 });
      options();
    } else {
      p.button(t('play.again'), 56, r1, 300, bh, () => { this.phase = 'play'; this.startPlay(); }, { primary: true });
      p.button(t('replay'), 380, r1, 360, bh, () => this.restart(), { size: 32 });
      p.button(t('next.level', { n: 1 }), 56, r2, 330, bh, () => this.setLevel(1), { primary: true, size: 30 });
      p.button(t('lab.btn'), 56 + 330 + 12, r2, 232, bh, () => this.lab.enter(), { size: 24 });
      options();
    }
  }

  toggleMenu() { this.menuOpen = !this.menuOpen; this.redrawAll(); }

  _drawHint(p, chain) {
    const { w } = p;
    const s = scoreSequence(chain.seq);
    const names = ['helix', 'strand', 'coil'].map((k) => t(`kind.${k}.lower`));
    const cols = [KINDS.helix.color, KINDS.strand.color, KINDS.coil.color];
    p.text(t('hint.l0.head', { seq: chain.seq }), 56, 100, { size: 31, color: THEME.dim, maxW: w - 112 });
    const g = p.g;
    const max = Math.max(...s);
    s.forEach((v, i) => {
      const y = 215 + i * 74, x0 = 250, bw = w - x0 - 190;
      p.text(names[i], 56, y + 6, { size: 36, weight: 700, color: cols[i] });
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x0, y + 4, bw, 40);
      g.fillStyle = cols[i]; g.globalAlpha = v === max ? 1 : 0.55; g.fillRect(x0, y + 4, bw * Math.min(1, v / 1.8), 40); g.globalAlpha = 1;
      p.text(v.toFixed(2) + (v === max ? t('hint.l0.best') : ''), x0 + bw + 20, y + 6, { size: 34, weight: 700 });
    });
    p.text(t('hint.l0.foot'), 56, 365, { size: 28, color: THEME.dim, maxW: w - 112 });
  }

  _drawSide(p) {
    if (this.phase === 'lab') return this.lab.drawSide(p);
    const { w } = p;
    const g = p.g;
    if (this.phase === 'intro') {
      p.text(t('legend'), 50, 34, { size: 46, weight: 800, color: THEME.border });
      let y = 110;
      p.text(t('legend.backbone'), 50, y, { size: 30, color: THEME.dim, weight: 700 }); y += 46;
      for (const [name, col, desc] of [['N', '#3b6bff', t('atom.N')], ['Cα / C', '#aab0c0', t('atom.C')], ['O', '#ff3b3b', t('atom.O')], ['H', '#ffffff', t('atom.H')]]) {
        g.fillStyle = col; g.beginPath(); g.arc(70, y + 20, 15, 0, 7); g.fill();
        p.text(`${name}  –  ${desc}`, 105, y + 3, { size: 32 }); y += 52;
      }
      y += 8;
      p.text(t('legend.side'), 50, y, { size: 30, color: THEME.dim, weight: 700 }); y += 46;
      for (const k of ['hydrophobic', 'polar', 'positive', 'negative', 'glycine', 'proline']) {
        const grp = RGROUP[k];
        g.fillStyle = '#' + grp.color.toString(16).padStart(6, '0'); g.beginPath(); g.arc(70, y + 20, 15, 0, 7); g.fill();
        p.text(t('rg.' + k), 105, y + 1, { size: 29 });
        p.text(grp.set.split('').map((aa) => RESIDUE_NAMES[aa]).join(' · '), 105, y + 33, { size: 22, color: THEME.dim, maxW: w - 150 });   // three-letter codes (Ala, Val...): not everybody knows the one-letter ones
        y += 68;
      }
      p.text(t('legend.hb'), 50, y + 10, { size: 30, color: '#fff27a', weight: 700 });
    } else if (this.staged && this.phase === 'play') {
      this._drawStageGuide(p);
    } else {
      p.text(t('field'), 50, 34, { size: 46, weight: 800, color: THEME.border });
      let y = 112;
      for (const k of ['helix', 'strand', 'coil']) {
        const txt = t(`kind.${k}.card`);
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(36, y, w - 72, 300 / 1.0 * 0.0 + 290);
        g.fillStyle = KINDS[k].color; g.fillRect(36, y, 8, 290);
        p.text(kname(k), 62, y + 14, { size: 40, weight: 800, color: KINDS[k].color });
        p.text(txt, 62, y + 66, { size: 28, maxW: w - 120, lh: 1.25 });
        this._likes(p, 62, y + 176, k, w - 120);
        y += 320;
      }
    }
  }

  /** Field guide of the staged Level 0: progress, and one big card for the structure being worked on */
  _drawStageGuide(p) {
    const { w } = p, g = p.g;
    p.text(t('field'), 50, 34, { size: 46, weight: 800, color: THEME.border });
    const cw = (w - 100 - 24) / 3;
    STAGE_KINDS.forEach((k, i) => {
      const done = i < this.stage || (i === this.stage && this.stageDoneT >= 0), cur = i === this.stage, x = 50 + i * (cw + 12);
      g.fillStyle = cur ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)'; g.fillRect(x, 108, cw, 64);
      g.strokeStyle = cur ? KINDS[k].color : 'rgba(255,255,255,0.15)'; g.lineWidth = cur ? 4 : 2; g.strokeRect(x, 108, cw, 64);
      p.text(`${done ? '✓ ' : ''}${kname(k)}`, x + cw / 2, 124, { size: 26, weight: 700, align: 'center', color: done ? THEME.good : cur ? KINDS[k].color : THEME.dim, maxW: cw - 16 });
    });
    const k = STAGE_KINDS[Math.min(this.stage, STAGE_KINDS.length - 1)], y0 = 200;
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(36, y0, w - 72, 700);
    g.fillStyle = KINDS[k].color; g.fillRect(36, y0, 8, 700);
    p.text(kname(k), 62, y0 + 22, { size: 54, weight: 800, color: KINDS[k].color, maxW: w - 120 });
    let y = p.text(t(`kind.${k}.card`), 62, y0 + 100, { size: 32, maxW: w - 120, lh: 1.3 }) + 26;
    y = p.text(t(`kind.${k}.rule`), 62, y, { size: 28, color: THEME.dim, maxW: w - 120, lh: 1.3 }) + 34;
    this._likes(p, 62, y, k, w - 120, 34);
  }

  /** "Likes:" line where each amino acid is written Name (X) in its own R-group colour. */
  _likes(p, x, y, kind, maxW, size = 30) {
    const g = p.g;
    g.save(); g.font = `700 ${size}px system-ui, sans-serif`; g.textBaseline = 'top';
    let cx = x, cy = y;
    const put = (txt, color) => {
      const wd = g.measureText(txt).width;
      if (cx + wd > x + maxW && cx > x) { cx = x; cy += size * 1.3; }
      g.fillStyle = color; g.fillText(txt, cx, cy); cx += wd;
    };
    put(t('likes'), THEME.dim);
    const aas = KINDS[kind].letters.split('');
    aas.forEach((aa, i) => {
      put(`${RESIDUE_NAMES[aa]} (${aa})`, '#' + RGROUP[rgroupOf(aa)].color.toString(16).padStart(6, '0'));
      if (i < aas.length - 1) put(', ', THEME.dim);
    });
    g.restore();
  }

  _drawMenu(p) {
    const { w } = p;
    p.text(t('options'), 50, 34, { size: 46, weight: 800, color: THEME.border });
    const bw = w - 100;
    const row = (items, y, size = 22) => { // equal-width buttons in one row: items = [{label, onClick, active, disabled}]
      const n = items.length, bwid = (bw - 12 * (n - 1)) / n;
      items.forEach((it, i) => p.button(it.label, 50 + (bwid + 12) * i, y, bwid, 70, it.onClick, { active: it.active, disabled: it.disabled, size }));
    };
    let y = 112;
    p.text(t('menu.mode'), 50, y, { size: 28, color: THEME.dim, weight: 700 }); y += 38;
    const m = this.mode;
    row([
      { label: t('menu.screen'), onClick: () => this.hooks.switchMode('desktop'), active: m === 'desktop', disabled: m === 'desktop' },
      { label: t('menu.vr'), onClick: () => this.hooks.switchMode('vr'), active: m === 'vr', disabled: m === 'vr' || !this.support.vr },
      { label: t('menu.passthrough'), onClick: () => this.hooks.switchMode('passthrough'), active: m === 'passthrough', disabled: m === 'passthrough' || !this.support.ar },
    ], y, 24); y += 84;
    p.text(t('menu.floor'), 50, y, { size: 28, color: THEME.dim, weight: 700 }); y += 38;
    row([
      { label: t('menu.hex'), onClick: () => this.setFloor('hex'), active: this.floor === 'hex' },
      { label: t('menu.checker'), onClick: () => this.setFloor('checker'), active: this.floor === 'checker' },
    ], y, 26); y += 84;
    p.text(`${t('menu.height')}  ${this.heightOffset >= 0 ? '+' : ''}${this.heightOffset.toFixed(1)} m`, 50, y, { size: 28, color: THEME.dim, weight: 700 }); y += 38;
    row([
      { label: '−', onClick: () => this.setHeight(this.heightOffset - 0.1) },
      { label: '+', onClick: () => this.setHeight(this.heightOffset + 0.1) },
      { label: t('menu.center'), onClick: () => this.hooks.recenter(), disabled: this.mode === 'desktop' },   // in VR: put the whole scene in front of you again
    ], y, 30); y += 84;
    p.text(t('menu.lang'), 50, y, { size: 28, color: THEME.dim, weight: 700 }); y += 38;
    row(LANGS.map((l) => ({ label: l.name, onClick: () => this.changeLang(l.code), active: getLang() === l.code, disabled: this.group.inRound })), y, 24); y += 84;
    if (!this.group.active) {      // free play: the level buttons (a group challenge picks the puzzles itself)
      p.text(t('menu.level'), 50, y, { size: 28, color: THEME.dim, weight: 700 }); y += 38;
      row([
        { label: t('level', { n: 0 }), onClick: () => this.setLevel(0), active: this.level === 0 && this.phase !== 'lab' },
        { label: t('level', { n: 1 }), onClick: () => this.setLevel(1, 0), active: this.level === 1 },
        { label: t('level', { n: 2 }), onClick: () => this.setLevel(2, 0), active: this.level === 2 },
        { label: t('level', { n: 3 }), onClick: () => this.setLevel(3, 0), active: this.level === 3 && !this.l1.isGallery },
      ], y, 22); y += 80;
      row([      // free play
        { label: t('lab.title'), onClick: () => this.lab.enter(), active: this.phase === 'lab' },
        { label: t('gal.title'), onClick: () => this.setLevel(3, 1), active: this.level === 3 && !!this.l1.isGallery },
      ], y, 22); y += 80;
      if (this.level === 1 || this.level === 2) {
        const list = this.level === 1 ? this.l1s : this.l2s;
        row(list.map((l, i) => ({ label: l.protein.name, onClick: () => this.setLevel(this.level, i), active: this.l1 === l })), y, list.length > 3 ? 20 : 22);
      }
    }
    const by = p.h - 120, half = (bw - 12) / 2;
    p.button(this.group.active ? t('group.leave') : t('menu.group'), 50, by, half, 76, () => { this.menuOpen = false; if (this.group.active) this.group.leave(); else this.group.openJoin(); }, { size: 26 });
    p.button(t('close'), 50 + half + 12, by, half, 76, () => this.toggleMenu(), { primary: true, size: 34 });
  }

  setFloor(f) { this.floor = f; this.hooks.setFloor(f); this.sidePanel.redraw(); }
  setHeight(v) { this.heightOffset = Math.max(-0.9, Math.min(0.6, Math.round(v * 10) / 10)); this.hooks.setHeight(this.heightOffset); this.sidePanel.redraw(); }
  setMode(m, support) { this.mode = m; if (support) this.support = support; this.redrawAll(); if (this.step === STEPS.length - 1 && this.phase === 'intro') this.setStep(this.step); }

  hint() {
    if (this.group.panelMode || this.phase === 'lab') return;
    if (this.level >= 1) return this.l1.hint();
    this.hintChain = this.lastChain || this.chains.find((c) => c.userData.state === 'tray');
    if (!this.hintChain) return;
    this.hintCount++;
    this.showHint = !this.showHint;
    this.coach.title = this.showHint ? t('hint.l0.title') : this.coach.title;
    this.coachPanel.redraw();
  }

  // ------------------------------------------------------------------ interaction
  /** pointers: [{ origin, dir, pressed, holdDelta, captured, hit, hitDist, haptic() }] in world space */
  handlePointers(pointers, raycaster, dt) {
    const interactChains = this.phase === 'play' || this.phase === 'lab' ? this.chains.filter((c) => ['tray', 'returning'].includes(c.userData.state)) : [];
    const demoTargets = this.phase === 'intro' ? Object.values(this.demos).filter((c) => c.group.visible).map((c) => c.hit) : [];
    const targets = [...this.panels.filter((p) => p.mesh.visible).map((p) => p.mesh), ...interactChains.map((c) => c.hit), ...demoTargets];
    const hovBtn = new Map(this.panels.map((p) => [p, null]));
    this.chains.forEach((c) => (c.userData.hover = false));
    this.vessels.forEach((v) => { if (v.state === 'hover') v.state = 'idle'; });

    for (const ptr of pointers) {
      if (ptr.holding && ptr.holding.isPiece) ptr.holding = null;
      const was = ptr.prevPressed;
      ptr.hit = null; ptr.hitDist = 3;
      raycaster.set(ptr.origin, ptr.dir); raycaster.far = 6;
      const hits = ptr.holding ? [] : raycaster.intersectObjects(targets, false);
      let btn = null, chain = null;
      if (hits.length) {
        const h = hits[0];
        ptr.hit = h.point; ptr.hitDist = h.distance;
        if (h.object.userData.panel) { const pan = h.object.userData.panel; btn = pan.pick(h.uv); if (btn) hovBtn.set(pan, btn.label); ptr.panelHit = pan; }
        else if (h.object.userData.chain) chain = h.object.userData.chain;
      }
      if (chain && !chain.userData.demo) chain.userData.hover = true;
      // press
      if (ptr.pressed && !was) {
        sfx.unlock();
        if (btn && !btn.disabled) { sfx.click(); ptr.haptic?.(0.4, 30); ptr.captured = true; btn.onClick(); }
        else if (chain && chain.userData.demo) { ptr.holding = { isDemo: true }; ptr._rot = null; this.demoHeld = true; ptr.captured = true; sfx.grab(); ptr.haptic?.(0.4, 40); }
        else if (chain && !chain.userData.holder) { this.grab(chain, ptr); ptr.captured = true; }
        else ptr.captured = !!(hits.length && hits[0].object.userData.panel);
      }
      if (!ptr.pressed) ptr.captured = false;
      // hold
      if (ptr.holding && ptr.holding.isDemo) {
        applyRotation(ptr, this.demoRot, this.world.quaternion, true);
        ptr.hit = this.world.localToWorld(this.demoCenter.clone()); ptr.hitDist = ptr.origin.distanceTo(ptr.hit);
        if (!ptr.pressed) { ptr.holding = null; this.demoHeld = false; ptr._rot = null; }
      } else if (ptr.holding) {
        const c = ptr.holding;
        ptr.holdDist = THREE.MathUtils.clamp(ptr.holdDist + (ptr.holdDelta || 0), 0.25, 3.2);
        // work in the play-area frame
        const o = this.world.worldToLocal(ptr.origin.clone());
        const d = ptr.dir.clone().transformDirection(this._inv.copy(this.world.matrixWorld).invert());
        const target = o.clone().addScaledVector(d, ptr.holdDist);
        // aim assist: a ray pointed at a vessel pulls the chain towards it
        const aim = this.aimedVessel(o, d);
        if (aim) target.lerp(aim.point, 0.55 + 0.4 * (1 - aim.dist / aim.vessel.radius));
        // turning the piece (grip / middle pinch, thumbstick, right-drag) freezes its position
        const rotating = applyRotation(ptr, c.group.quaternion, this.world.quaternion);
        if (!rotating) c.group.position.lerp(target, 1 - Math.pow(0.0005, dt));
        ptr.hit = this.world.localToWorld(target.clone());
        ptr.hitDist = ptr.origin.distanceTo(ptr.hit);
        // vessel hover
        const near = this.nearestVessel(c.group.position);
        if (near && near.state !== 'good' && near.state !== 'bad') near.state = 'hover';
        if (!ptr.pressed) this.release(c, ptr);
      }
      ptr.prevPressed = ptr.pressed;
    }
    for (const [pan, label] of hovBtn) pan.setHover(label);
    // hover visuals
    for (const c of this.chains) {
      const u = c.userData;
      c.bubble.material.opacity = 0.05 + (u.hover || u.state === 'held' ? 0.12 : 0);
      c.bubbleRing.material.opacity = 0.4 + (u.hover || u.state === 'held' ? 0.5 : 0);
    }
  }

  /** Vessel whose centre is closest to the ray (within reach), with the closest point on the ray. */
  aimedVessel(o, d) {
    let best = null;
    for (const v of this.vessels) {
      if (!v.activeTarget || v.show < 0.5) continue;
      const c = v.group.position;
      const t = _tmp.subVectors(c, o).dot(d);
      if (t < 0.3) continue;
      const p = o.clone().addScaledVector(d, t);
      const dist = p.distanceTo(c);
      if (dist < v.radius * 0.85 && (!best || dist < best.dist)) best = { vessel: v, dist, point: c.clone().add(p.sub(c).multiplyScalar(0.3)) };
    }
    return best;
  }

  nearestVessel(pos) {
    let best = null, bd = 1e9;
    for (const v of this.vessels) {
      if (!v.activeTarget || v.show < 0.5) continue;
      const d = pos.distanceTo(v.group.position);
      if (d < v.radius + 0.1 && d < bd) { best = v; bd = d; }
    }
    return best;
  }

  grab(chain, ptr) {
    const u = chain.userData;
    u.state = 'held'; u.holder = ptr;
    ptr.holding = chain;
    const wp = new THREE.Vector3(); chain.group.getWorldPosition(wp);
    ptr.holdDist = THREE.MathUtils.clamp(ptr.origin.distanceTo(wp), 0.3, 3);
    this.lastChain = chain;
    ptr._rot = null;
    sfx.grab(); ptr.haptic?.(0.6, 50);
    if (this.showHint) { this.hintChain = chain; this.coachPanel.redraw(); }
  }

  release(chain, ptr) {
    ptr.holding = null;
    const u = chain.userData;
    u.holder = null;
    const v = this.nearestVessel(chain.group.position);
    if (!v) { this.sendHome(chain); sfx.click(); return; }
    if (v.full) {
      this.say(t('full.title'), t('full.body', { kind: t(`kind.${v.kind}.lower`), n: v.slots.length }), 'warn');
      this.sendHome(chain); return;
    }
    const slot = v.free;
    const correct = v.kind === u.cls;
    slot.chain = chain;
    u.vessel = v; u.slot = slot; u.t = 0;
    u.from.copy(chain.group.position);
    u.fromQuat = chain.group.quaternion.clone(); // keep the orientation the user gave it
    chain.kind = v.kind; chain.flip = slot.flip;
    chain.setBubble(false);
    if (correct) {
      u.state = 'folding'; chain.weights.fill(1); chain.stress.fill(0);
      sfx.fold(); ptr.haptic?.(0.5, 80);
    } else {
      u.state = 'rejecting'; u.attempts++;
      slot.chain = null; // not accepted
      this.mistakes++;
      const idx = CLASS_INDEX[v.kind];
      chain.weights = [...chain.seq].map((aa) => THREE.MathUtils.clamp((PROPENSITY[aa][idx] - 0.5) / 0.75, 0.08, 1));
      chain.stress = chain.weights.map((w) => 1 - w);
      u.peak = 0.62;
      u.ejected = false;
      this.explainWrong(chain, v);
      sfx.fold(); ptr.haptic?.(0.8, 120);
    }
  }

  sendHome(chain) {
    const u = chain.userData;
    u.state = 'returning'; u.t = 0; u.from.copy(chain.group.position); u.fromF = chain.f;
  }

  explainWrong(chain, v) {
    const idx = CLASS_INDEX[v.kind];
    const worst = [...new Set([...chain.seq])].sort((a, b) => PROPENSITY[a][idx] - PROPENSITY[b][idx]).slice(0, 3);
    const best = chain.userData.cls;
    const nm = (a) => `${RESIDUE_NAMES[a]} (${a})`;
    const body = t('wrong.body', {
      seq: chain.seq, into: t(`kind.${v.kind}.into`), worst: worst.map(nm).join(', '), lower: t(`kind.${v.kind}.lower`), rule: t(`kind.${v.kind}.rule`),
      best: KINDS[best].like.split(', ').slice(0, 3).join(', '),
    });
    this.say(t('wrong.title'), body, 'bad');
    v.setState('bad');
  }

  // ------------------------------------------------------------------ per-frame
  update(dt, t, pointers, raycaster) {
    this.time = t;
    dt = Math.min(dt, 0.05);
    this._placePanels(dt);
    this.group.tick(dt);
    if (this.level >= 1) {
      this.l1.update(dt, t, pointers, raycaster);
      this.bursts.update(dt);
      this.updatePanelsLive();
      return;
    }
    this.handlePointers(pointers, raycaster, dt);

    // reveal of play-area objects
    const target = this.phase === 'intro' ? 0 : 1;
    this.reveal += (target - this.reveal) * Math.min(1, dt * 4);
    const rv = ease(this.reveal);
    this.updateStage(dt);
    const kv = 1 - Math.exp(-dt * 4);
    this.vessels.forEach((v) => {
      v.show += ((v.activeTarget ? 1 : 0) - v.show) * Math.min(1, dt * 5);
      const tp = this.staged ? STAGE_CENTER : v.homePos, ty = this.staged ? 0 : v.homeYaw;
      if (v.show < 0.05) { v.group.position.copy(tp); v.group.rotation.y = ty; }            // hidden: jump; visible: glide
      else { v.group.position.lerp(tp, kv); v.group.rotation.y += (ty - v.group.rotation.y) * kv; }
      const s = rv * ease(v.show);
      v.group.scale.setScalar(Math.max(0.001, s)); v.group.visible = s > 0.01; v.group.updateMatrix();
    });
    this.shelf.visible = rv > 0.01; this.shelf.scale.setScalar(Math.max(0.001, rv));
    this.pads.forEach((p) => (p.visible = rv > 0.05 && this.phase !== 'lab'));

    this.updateDemo(dt);
    this.updateChains(dt, t, rv);
    this.vessels.forEach((v) => v.update(t, dt));
    this.updateBonds(t);
    this.bursts.update(dt);
    this.updatePanelsLive();
  }

  updateChains(dt, t, rv) {
    for (const c of this.chains) {
      const u = c.userData;
      c.group.visible = rv > 0.01;
      c.tick(t);
      if (u.state === 'tray') {
        c.group.position.copy(u.home); c.group.position.y += Math.sin(t * 1.4 + u.home.x * 3) * 0.012;
        c.group.scale.setScalar(Math.max(0.001, rv) * u.homeScale);
      } else if (u.state === 'folding') {
        u.t += dt;
        const v = u.vessel, slotPos = v.worldSlotPos(u.slot);
        const a = ease(u.t / 1.0);
        c.group.position.lerpVectors(u.from, slotPos, a);
        c.group.quaternion.slerpQuaternions(u.fromQuat, v.worldQuat, a);
        c.group.scale.setScalar(THREE.MathUtils.lerp(u.homeScale, 1, a));
        c.f = ease(u.t / 2.0); c.refresh();
        if (u.t >= 2.0) this.onLocked(c);
      } else if (u.state === 'rejecting') {
        u.t += dt;
        const v = u.vessel, slotPos = v.worldSlotPos(v.free || v.slots[0]);
        const tt = u.t;
        if (tt < 0.8) {
          const a = ease(tt / 0.8);
          c.group.position.lerpVectors(u.from, slotPos, a);
          c.group.quaternion.slerpQuaternions(u.fromQuat, v.worldQuat, a);
          c.f = u.peak * ease(tt / 0.8);
          c.group.scale.setScalar(THREE.MathUtils.lerp(u.homeScale, 1, a));
        } else if (tt < 1.9) {
          c.group.scale.setScalar(1);
          c.f = u.peak + Math.sin(tt * 26) * 0.045 * (1 + Math.sin(tt * 5));
          c.group.position.copy(slotPos).add(new THREE.Vector3(Math.sin(tt * 40) * 0.006, Math.sin(tt * 33) * 0.006, 0));
        } else if (tt < 2.8) {
          if (!u.ejected) {
            u.ejected = true; u.vel.set((Math.random() - 0.5) * 1.2, 0.9, 1.5 + Math.random() * 0.4);
            sfx.bad(); u.from.copy(c.group.position);
          }
          const a = (tt - 1.9) / 0.9;
          c.group.scale.setScalar(THREE.MathUtils.lerp(1, u.homeScale, ease(a)));
          c.f = u.peak * (1 - ease(a));
          c.group.position.addScaledVector(u.vel, dt);
          u.vel.multiplyScalar(0.94); u.vel.y -= 1.0 * dt;
          c.group.quaternion.slerp(new THREE.Quaternion(), Math.min(1, dt * 4));
        } else {
          c.f = 0; c.stress.fill(0); c.kind = 'coil'; c.flip = false; c.weights.fill(1);
          c.setBubble(true); this.sendHome(c);
        }
        c.refresh();
      } else if (u.state === 'returning') {
        u.t += dt;
        const a = ease(u.t / 0.9);
        c.group.position.lerpVectors(u.from, u.home, a);
        c.group.quaternion.slerp(new THREE.Quaternion(), Math.min(1, dt * 5));
        c.group.scale.setScalar(u.homeScale);
        if (c.f > 0 || c.stress.some((s) => s > 0)) { c.f = Math.max(0, c.f - dt * 2); c.stress = c.stress.map((s) => Math.max(0, s - dt * 2)); c.refresh(); }
        if (u.t >= 0.9) {
          u.state = 'tray'; c.group.position.copy(u.home);
          if (u.stageDone) { c.kind = 'coil'; c.flip = false; c.f = 0; c.weights.fill(1); c.stress.fill(0); c.setBubble(true); c.refresh(); }   // back on the rack, unfolded again
        }
      } else if (u.state === 'held') {
        c.group.scale.setScalar(u.homeScale);
      }
      if (u.state === 'locked') {
        c.group.position.copy(u.vessel.worldSlotPos(u.slot));
        c.group.quaternion.copy(u.vessel.worldQuat);                      // (the vessel may glide to another place)
        const sh = u.vessel.show;
        c.group.scale.setScalar(Math.max(0.001, sh));                     // fades with its vessel
        if (sh < 0.02) c.group.visible = false;
      }
    }
  }

  onLocked(c) {
    const u = c.userData, v = u.vessel;
    u.state = 'locked';
    c.f = 1; c.refresh();
    c.group.position.copy(v.worldSlotPos(u.slot));
    c.setLabels(true); c.seqLabel.visible = false;
    v.setState('good');
    const wp = c.group.position;
    this.bursts.spawn(wp, hexNum(KINDS[v.kind].color), 70, 1.3);
    sfx.good();
    if (this.phase === 'done') return;                                  // finale: an earlier chain settling into its vessel
    // count H-bonds for the explanation
    const lst = v.slots.filter((s) => s.chain).map((s) => s.chain);
    const bonds = findHBonds(lst.map((x) => x.worldRes()), 2.6, 125);
    const n = bonds.length;
    const top = [...new Set([...c.seq])].sort((a, b) => PROPENSITY[b][CLASS_INDEX[v.kind]] - PROPENSITY[a][CLASS_INDEX[v.kind]]).slice(0, 3).map((a) => RESIDUE_NAMES[a]).join(', ');
    let body, key;
    if (v.kind === 'helix') { key = 'helix'; body = t('ok.helix', { seq: c.seq, top, n }); }
    else if (v.kind === 'strand') {
      const both = lst.length === 2;
      key = both ? 'sheet' : 'strand';
      body = t(both ? 'ok.sheet' : 'ok.strand', { seq: c.seq, top, n });
    } else { key = 'coil'; body = t('ok.coil', { seq: c.seq, top, n }); }
    this.say(t(`ok.${key}.title`), body, 'good');
    if (this.staged && this.phase === 'play') {                          // both sequences of this structure are in: on to the next one
      const kind = STAGE_KINDS[this.stage];
      if (this.stage < STAGE_KINDS.length - 1 && this.chains.filter((x) => x.userData.cls === kind).every((x) => x.userData.state === 'locked')) {
        this.stageDoneT = 0;
        this.coach.body += `\n\n${t('stage.done', { kind: t(`kind.${kind}.lower`), next: t(`kind.${STAGE_KINDS[this.stage + 1]}.lower`) })}`;
        this.coachPanel.redraw();
      }
    }
    if (this.phase === 'lab') return;
    const finished = this.staged ? this.stage === STAGE_KINDS.length - 1 && this.chains.filter((x) => x.userData.cls === 'coil').every((x) => x.userData.state === 'locked')
      : this.chains.every((x) => x.userData.state === 'locked');
    if (finished) this.win();
  }

  win() {
    this.phase = 'done';
    this.staged = false; this.stageDoneT = -1; this._applyStage(false);   // finale: all three vessels, each with its two folded chains
    for (const c of this.chains) {                                       // the helix and sheet sequences fold into their vessels again
      const u = c.userData;
      if (!u.stageDone) continue;
      const v = this.vessels.find((x) => x.kind === u.cls), slot = v.free;
      if (!slot) continue;
      if (u.holder) { u.holder.holding = null; u.holder = null; }
      u.stageDone = false; slot.chain = c; u.vessel = v; u.slot = slot; u.t = 0;
      u.from.copy(c.group.position); u.fromQuat = c.group.quaternion.clone();
      c.kind = v.kind; c.flip = slot.flip; c.weights.fill(1); c.stress.fill(0); c.setBubble(false);
      u.state = 'folding';
    }
    const stars = this.mistakes <= 1 ? 3 : this.mistakes <= 3 ? 2 : 1;
    setTimeout(() => {
      sfx.win();
      this.vessels.forEach((v, i) => setTimeout(() => this.bursts.spawn(v.group.position, hexNum(KINDS[v.kind].color), 90, 1.8), i * 250));
    }, 900);
    this._stars = stars;
    this.coach = this._winCoach();
    this.showHint = false;
    this.coachPanel.redraw();
  }

  _winCoach() {
    const stars = this._stars || 1;
    return {
      title: t('win.title', { stars: '★'.repeat(stars) + '☆'.repeat(3 - stars) }),
      body: t('win.body', { m: this.mistakes, h: this.hintCount }),
      tone: 'good',
    };
  }

  updateBonds(time) {
    this.hb.begin();
    const addFor = (list, fade, thr = 2.7, minAngle = 130) => {
      if (list.length === 0) return;
      const res = list.map((c) => c.worldRes());
      const bonds = findHBonds(res, thr, minAngle);
      for (const b of bonds) {
        const a = res[b.ci][b.i].O, h = res[b.cj][b.j].H;
        // quality 1 for ~2.0A, fading to 0 by 3.0A
        const q = clamp01((2.7 - b.d) / 0.6);
        const sc = list[b.ci].group.scale.x;
        this.hb.add(a.clone().multiplyScalar(K * sc), h.clone().multiplyScalar(K * sc), q, fade, time);
      }
    };
    // demos
    const D = this.demos, run = this.demoRun;
    if (run.key === 'helix') addFor([D.helix], 1);
    if (run.key === 'sheet') addFor([D.sheetA, D.sheetB], 1);
    // gameplay: group chains by vessel
    for (const v of this.vessels) {
      const locked = v.slots.map((s) => s.chain).filter((c) => c && (c.userData.state === 'locked' || c.userData.state === 'folding'));
      if (locked.length) addFor(locked, 1);
    }
    for (const c of this.chains) if (c.userData.state === 'rejecting' && c.f > 0.08) addFor([c], 0.9);
    this.hb.end();
  }

  updatePanelsLive() {
    // keep the HUD counters fresh without redrawing every frame
    const sig = this.level >= 1 ? 'L' + this.level + '|' + this.l1.sig() : `${this.placedCount}|${this.mistakes}|${this.phase}|${this.lab.seq}|${this.chains[0]?.userData.state}|${this.stage}|${this.stageDoneT >= 0}`;
    if (sig !== this._sig) { this._sig = sig; this.coachPanel.redraw(); this.sidePanel.redraw(); }
  }
}
