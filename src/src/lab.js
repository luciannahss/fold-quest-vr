// Level 0 "sequence lab" (free play): build your own 9-residue sequence from the 20 amino acids, see which shape each
// residue favours, then grab the chain and drop it into a vessel to see whether it folds. It reuses Level 0's chain,
// vessels, grab / drop / fold-or-reject logic: while the lab is open the game's `chains` list holds the single lab chain.
import * as THREE from 'three';
import { Chain } from './chain.js';
import { THEME } from './ui.js';
import { t } from './i18n.js';
import { PROPENSITY, RESIDUE_NAMES, RGROUP, classifySequence, rgroupOf, scoreSequence } from './chemistry.js';
import { SEQUENCES } from './sequences.js';

const LEN = 9;                                   // the vessels are built for 9-residue chains
const HOME = new THREE.Vector3(0, 1.08, -0.82);  // where the lab chain waits
const SCALE = 1.3;                               // same display scale as the tray chains
const KEYS = 'AVILMFWCSTNQYHKRDEGP';              // grouped by chemistry: oily, polar, +, -, Gly, Pro
const ALL = 'ACDEFGHIKLMNPQRSTVWY';
const KINDS = ['helix', 'strand', 'coil'];
const KIND_COLOR = { helix: '#38e8ff', strand: '#ff3df2', coil: '#ffd166' };
const EXTRA = ['AAAAAAAAA', 'VVVVVVVVV', 'GGGGGGGGG', 'PAPAPAPAP', 'AVGAVGAVG', 'KKKKEEEEE'];
const EXAMPLES = [...SEQUENCES.map((s) => s.seq), ...EXTRA];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class Lab {
  constructor(game) {
    this.game = game;
    this.seq = ''; this.chain = null; this.tray = null; this.pad = null; this.n = 0; this.example = 0;
  }

  get active() { return this.game.phase === 'lab'; }

  // ------------------------------------------------------------------ enter / leave
  enter() {
    const g = this.game;
    g.level = 0; g.phase = 'lab'; g.menuOpen = false; g.showHint = false;
    g.staged = false; g.stageDoneT = -1; g._applyStage(false);   // the lab shows the three vessels
    [...g.l1s, ...g.l2s, ...g.l3s].forEach((l) => (l.group.visible = false));
    g.l0.visible = true;
    Object.values(g.demos).forEach((c) => (c.group.visible = false));
    g.demoRun = { key: null, t: 0 };
    if (!this.tray) this.tray = g.chains;           // the six Level 0 sequences wait while the lab is open
    this.tray.forEach((c) => (c.group.visible = false));
    g.chains = [];
    if (!this.pad) this.pad = this._makePad();
    this.pad.visible = true;
    this.seq = '';
    this.rebuild();
  }

  /** back to the normal Level 0 state (called before another level / the tutorial is shown) */
  exit() {
    const g = this.game;
    if (this.chain) { g.l0.remove(this.chain.group); this.chain = null; }
    if (this.pad) this.pad.visible = false;
    if (this.tray) { g.chains = this.tray; this.tray = null; }
    g.phase = 'done';
  }

  _makePad() {
    const pad = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.165, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.7, toneMapped: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.15, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a2a6a, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
    pad.add(ring, disc);
    pad.position.copy(HOME); pad.position.y -= 0.27;
    this.game.l0.add(pad);
    return pad;
  }

  // ------------------------------------------------------------------ sequence
  setSeq(seq) { this.seq = seq.slice(0, LEN); this.rebuild(); }
  add(aa) { if (this.seq.length < LEN) this.setSeq(this.seq + aa); }
  del() { this.setSeq(this.seq.slice(0, -1)); }
  random() { this.setSeq(Array.from({ length: LEN }, () => ALL[Math.floor(Math.random() * ALL.length)]).join('')); }
  nextExample() { this.setSeq(EXAMPLES[this.example++ % EXAMPLES.length]); }

  _clearVessels() {
    for (const v of this.game.vessels) { v.slots.forEach((s) => (s.chain = null)); v.state = 'idle'; }
  }

  /** (re)creates the chain for the current sequence (only when it is complete) and resets the vessels */
  rebuild() {
    const g = this.game;
    if (this.chain) { g.l0.remove(this.chain.group); this.chain = null; }
    g.chains = []; g.lastChain = null;
    this._clearVessels();
    if (this.seq.length === LEN) {
      const c = new Chain(this.seq, { seed: 21, unfolded: 'coil', id: 'lab' + this.n++ });
      c.userData = { state: 'tray', cls: classifySequence(this.seq), t: 0, from: new THREE.Vector3(), vel: new THREE.Vector3(), attempts: 0, homeScale: SCALE, home: HOME.clone() };
      c.group.position.copy(HOME); c.group.scale.setScalar(SCALE);
      c.setBubble(true); c.bubble.material.side = THREE.DoubleSide;
      g.l0.add(c.group);
      this.chain = c; g.chains = [c];
      g.coach = { title: t('lab.ready.title'), body: t('lab.ready'), tone: 'good' };
    } else this.intro();
    g.coachPanel.redraw(); g.sidePanel.redraw();
  }

  /** the language changed: rewrite the coach message */
  refreshText() { if (this.chain) this.game.coach = { title: t('lab.ready.title'), body: t('lab.ready'), tone: 'good' }; else this.intro(); }

  intro() {
    const left = LEN - this.seq.length;
    this.game.coach = { title: t('lab.intro.title'), body: this.seq ? t('lab.partial', { n: left }) : t('lab.intro'), tone: 'info' };
  }

  /** take the chain out of its vessel and put it back on its pad */
  takeOut() {
    const g = this.game;
    if (!this.chain) return;
    g.resetPieces();
    g.coach = { title: t('lab.ready.title'), body: t('lab.ready'), tone: 'good' };
    g.redrawAll();
  }

  // ------------------------------------------------------------------ boards
  /** right board: the sequence strip, the 20 amino-acid keys and the buttons */
  drawCoach(p) {
    const { w, h, g } = p;
    const game = this.game;
    p.text(t('lab.title'), 56, 34, { size: 46, weight: 800, color: THEME.border, shadow: THEME.border, maxW: w - 112 });
    // sequence strip: 9 boxes
    const bw = 86, gap = 10, x0 = (w - LEN * bw - (LEN - 1) * gap) / 2, y0 = 112;
    for (let i = 0; i < LEN; i++) {
      const x = x0 + i * (bw + gap), aa = this.seq[i];
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x, y0, bw, 96);
      g.strokeStyle = i === this.seq.length ? THEME.warn : aa ? hex(RGROUP[rgroupOf(aa)].color) : 'rgba(255,255,255,0.25)';
      g.lineWidth = 4; g.strokeRect(x, y0, bw, 96);
      if (aa) p.text(aa, x + bw / 2, y0 + 16, { size: 58, weight: 800, color: hex(RGROUP[rgroupOf(aa)].color), align: 'center' });
    }
    // 20 keys, 5 columns, coloured by chemistry
    const kw = 160, kh = 96, kg = 12, kx = (w - 5 * kw - 4 * kg) / 2, ky = 236;
    [...KEYS].forEach((aa, i) => {
      const x = kx + (i % 5) * (kw + kg), y = ky + Math.floor(i / 5) * (kh + kg);
      p.button(aa, x, y, kw, kh, () => this.add(aa), { size: 42, disabled: this.seq.length >= LEN });
      g.fillStyle = hex(RGROUP[rgroupOf(aa)].color); g.fillRect(x + 14, y + 14, 10, kh - 28);
      p.text(RESIDUE_NAMES[aa], x + kw / 2, y + kh - 30, { size: 19, color: THEME.dim, align: 'center' });
    });
    const r1 = h - 196, r2 = h - 100, bh = 78, bw4 = (w - 112 - 3 * 12) / 4;
    p.button(t('lab.delete'), 56, r1, bw4, bh, () => this.del(), { size: 28, disabled: !this.seq });
    p.button(t('lab.clear'), 56 + (bw4 + 12), r1, bw4, bh, () => this.setSeq(''), { size: 28, disabled: !this.seq });
    p.button(t('lab.random'), 56 + 2 * (bw4 + 12), r1, bw4, bh, () => this.random(), { size: 28 });
    p.button(t('lab.example'), 56 + 3 * (bw4 + 12), r1, bw4, bh, () => this.nextExample(), { size: 28 });
    p.button(t('lab.takeout'), 56, r2, 300, bh, () => this.takeOut(), { size: 28, disabled: !this.chain });
    p.button(t('level', { n: 0 }), 56 + 312, r2, 200, bh, () => game.setLevel(0), { size: 28 });
    p.button(game.menuOpen ? t('options.close') : t('options'), w - 56 - 250, r2, 250, bh, () => game.toggleMenu(), { active: game.menuOpen, size: 30 });
  }

  /** left board: how much the residues like each shape, and the result of the last drop */
  drawSide(p) {
    const { w, g } = p;
    const game = this.game;
    p.text(t('lab.analysis'), 50, 34, { size: 44, weight: 800, color: THEME.border });
    let y = 108;
    if (!this.seq) {
      p.text(t('lab.empty'), 50, y, { size: 28, color: THEME.dim, maxW: w - 100 });
      y += 120;
    } else {
      const s = scoreSequence(this.seq), max = Math.max(...s);
      p.text(t('lab.bars'), 50, y, { size: 26, color: THEME.dim, maxW: w - 100 }); y += 40;
      s.forEach((v, i) => {
        const k = KINDS[i], x0 = 250, bwid = w - x0 - 160;
        p.text(t(`kind.${k}.lower`), 50, y + 4, { size: 32, weight: 700, color: KIND_COLOR[k], maxW: 190 });
        g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x0, y + 4, bwid, 36);
        g.fillStyle = KIND_COLOR[k]; g.globalAlpha = v === max ? 1 : 0.55; g.fillRect(x0, y + 4, bwid * Math.min(1, v / 1.8), 36); g.globalAlpha = 1;
        p.text(v.toFixed(2), x0 + bwid + 16, y + 4, { size: 32, weight: 700 });
        y += 62;
      });
      p.text(t('lab.prefers', { kind: t(`kind.${KINDS[s.indexOf(max)]}.lower`) }), 50, y + 4, { size: 34, weight: 800, color: KIND_COLOR[KINDS[s.indexOf(max)]], maxW: w - 100 }); y += 62;
      // how many residues favour each shape (their own best column)
      const counts = [0, 0, 0];
      for (const aa of this.seq) counts[PROPENSITY[aa].indexOf(Math.max(...PROPENSITY[aa]))]++;
      p.text(t('lab.counts'), 50, y, { size: 26, color: THEME.dim, maxW: w - 100 }); y += 38;
      p.text(KINDS.map((k, i) => `${t(`kind.${k}.lower`)} ${counts[i]}`).join('   ·   '), 50, y, { size: 30, weight: 700, maxW: w - 100 }); y += 70;
    }
    // result of the last drop (the game's own messages: folds / can't fold / why)
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(36, y, w - 72, 4); y += 24;
    const c = game.coach, tone = { info: THEME.border, good: THEME.good, bad: THEME.bad, warn: THEME.warn }[c.tone] || THEME.border;
    y = p.text(c.title, 50, y, { size: 34, weight: 800, color: tone, maxW: w - 100 }) + 8;
    p.text(c.body, 50, y, { size: 26, maxW: w - 100, lh: 1.25 });
  }
}
