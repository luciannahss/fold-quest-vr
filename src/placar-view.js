// Live 3D view of every team's table for the teacher screen. One canvas behind the page; each team's card is a
// viewport (scissor). The headsets send the poses of their pieces (Level 1/2) or protein cards (Level 3) about 8 times
// a second; the geometry is rebuilt here from the same data files, so only a few numbers travel over the network.
// Adapted, with permission, from the live view of Encaixe Molecular VR (Deborah Antunes).
import * as THREE from 'three';
import { makeCartoon } from './cartoon.js';
import { PROTEINS, COMPLEXES } from './proteins/index.js';
import { loadSurface, dispRadius, STAGE, surfaceMaterial } from './level3.js';
import { POOL, ROUNDS } from './surfaces/info.js';
import { Chain } from './chain.js';
import { Vessel, makeLabel } from './vessels.js';
import { optimizeSheet } from './chemistry.js';
import { SEQUENCES } from './sequences.js';
import { t } from './i18n.js';

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const EYE = new THREE.Vector3(0, 1.6, 0.55), AIM = new THREE.Vector3(0, 1.22, -1.2);

/** cartoon of one piece (a residue range of a protein), centred like Chain does, ready to be placed by a pose */
function pieceNode(protein, def, base) {
  const rs = protein.data.residues.filter((r) => r.n >= def.from && r.n <= def.to);
  const c = new THREE.Vector3();
  for (const r of rs) c.add(v3(r.CA)).add(v3(r.N)).add(v3(r.C)).add(v3(r.O));
  c.divideScalar(rs.length * 4);
  const res = rs.map((r) => ({ N: v3(r.N).sub(c), CA: v3(r.CA).sub(c), C: v3(r.C).sub(c), O: v3(r.O).sub(c) }));
  const node = new THREE.Group();
  node.add(makeCartoon(res, rs.map((r) => r.ss), protein.scale, base).group);
  node.scale.setScalar(protein.scale);
  return node;
}

export class LiveView {
  /** cells: () => array (by team index) of the elements whose rectangle is each team's viewport (or null) */
  constructor(canvas, cells) {
    this.canvas = canvas; this.cells = cells;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x050816, 1);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 40);
    this.camera.position.copy(EYE); this.camera.lookAt(AIM);
    this.scenes = [0, 1, 2, 3].map(() => this.makeScene());
    this.challenge = null; this.token = 0;
    this.solved = [false, false, false, false];
    this.lastPose = [0, 0, 0, 0];
  }

  makeScene() {
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xa9c4ff, 0x2a0f4a, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(1.5, 3, 2.5); scene.add(sun);
    const grid = new THREE.GridHelper(8, 32, 0x38e8ff, 0x1b2a6b); grid.material.transparent = true; grid.material.opacity = 0.55; scene.add(grid);
    const table = new THREE.Group(); scene.add(table);
    return { scene, table, items: new Map(), reveal: null };
  }

  clear() {
    for (const S of this.scenes) { S.table.clear(); S.items.clear(); S.reveal = null; S.vessels = null; S.shadow = null; }
    this.token++;
  }

  /** a new challenge ({ level, idx, name }) or null (lobby / results) */
  async setChallenge(ch) {
    if (ch && this.challenge && ch.id === this.challenge.id) return;
    this.challenge = ch; this.clear();
    this.solved = [false, false, false, false];
    if (!ch) return;
    const token = this.token;
    if (ch.level === 0) {
      // Level 0: the three vessels and the six sequences (state, fold and orientation come with the poses)
      const sheet = optimizeSheet();
      const COLORS = { helix: '#38e8ff', strand: '#ff3df2', coil: '#ffd166' };
      for (const S of this.scenes) {
        S.vessels = [['helix', -1.0, 0.38], ['strand', 0, 0], ['coil', 1.0, -0.38]].map(([kind, x, yaw]) => {
          const v = new Vessel(kind, sheet);
          v.group.position.set(x, 1.5, -1.45 + Math.abs(x) * 0.2); v.group.rotation.y = yaw;
          const label = makeLabel(t(`vessel.${kind}.title`), t(`vessel.${kind}.sub`), COLORS[kind]); label.position.set(0, 0.5, 0); v.group.add(label);
          S.table.add(v.group);
          return v;
        });
        SEQUENCES.forEach((sq, i) => {
          const chain = new Chain(sq.seq, { seed: i + 3, unfolded: 'coil', id: 'seq' + i });
          chain.setBubble(false); chain.setLabels(false); chain.seqLabel.visible = false;
          chain.group.visible = false; S.table.add(chain.group);
          S.items.set(`c${i}`, { node: chain.group, chain, target: null });
        });
      }
    } else if (ch.level === 3) {
      const target = ROUNDS[ch.idx].target;
      const surf = await loadSurface(target);
      if (token !== this.token) return;
      this.surf = surf;
      const rs = Math.min(0.8, 1.55 * dispRadius(surf.radius));
      for (const S of this.scenes) {
        const shadow = new THREE.Mesh(surf.geo, new THREE.MeshBasicMaterial({ color: 0x03040a }));
        shadow.position.copy(STAGE); shadow.scale.setScalar(rs); S.table.add(shadow); S.shadow = shadow;
        const reveal = new THREE.Mesh(surf.geo, surfaceMaterial());
        reveal.position.copy(STAGE); reveal.scale.setScalar(rs); reveal.visible = false; S.table.add(reveal); S.reveal = reveal;
        const back = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.7), new THREE.MeshBasicMaterial({ color: 0xffd479 }));
        back.position.set(STAGE.x, STAGE.y, STAGE.z - 0.35); S.table.add(back);
      }
    } else {
      const list = ch.level === 1 ? PROTEINS : COMPLEXES;
      const protein = list.find((p) => p.id === ch.name);
      this.templates = protein.pieces.map((def) => pieceNode(protein, def, def.color));
      for (const S of this.scenes) {
        this.templates.forEach((tpl, i) => { const n = tpl.clone(true); n.visible = false; S.table.add(n); S.items.set(String(i), { node: n, target: null }); });
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.02, 48), new THREE.MeshBasicMaterial({ color: 0x1a2a6a }));
        disc.position.set(0, 1.08, -1.95); S.table.add(disc);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.007, 8, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3df2 }));
        rim.position.set(0, 1.09, -1.95); S.table.add(rim);
      }
    }
  }

  /** pose message from the server: { team, round, held, mols: [{ id, p, q, s }] } */
  pose(m) {
    const S = this.scenes[m.team];
    if (!S || !this.challenge) return;
    this.lastPose[m.team] = performance.now();
    for (const mol of m.mols) {
      let it = S.items.get(mol.id);
      if (!it && this.challenge.level === 3 && POOL[mol.id]) {
        // Level 3 cards appear when their first pose arrives (their surface is loaded on demand)
        it = { node: new THREE.Group(), target: null, held: false };
        S.items.set(mol.id, it); S.table.add(it.node);
        loadSurface(mol.id).then((surf) => {
          const mesh = new THREE.Mesh(surf.geo, surfaceMaterial());
          mesh.scale.setScalar(dispRadius(surf.radius)); it.node.add(mesh); it.ready = true;
        });
      }
      if (!it) continue;
      const first = !it.target;
      it.target = { p: v3(mol.p), q: new THREE.Quaternion(mol.q[0], mol.q[1], mol.q[2], mol.q[3]) };
      it.gone = mol.s === 'gone';
      if (it.chain && mol.s !== it.sig) {                 // Level 0 chain: state letter + kind + fold 0-9 + flip
        it.sig = mol.s;
        const kind = { h: 'helix', s: 'strand', c: 'coil' }[mol.s[1]] ?? 'coil';
        it.chain.kind = kind; it.chain.f = Number(mol.s[2]) / 9; it.chain.flip = mol.s[3] === '1';
        it.chain.refresh();
        it.node.scale.setScalar('th'.includes(mol.s[0]) ? 1.3 : 1);
      }
      if (first) { it.node.position.copy(it.target.p); it.node.quaternion.copy(it.target.q); }
      it.node.visible = !it.gone;
    }
    for (const [id, it] of S.items) it.held = id === m.held;
  }

  /** seconds since the team's headset last sent a pose */
  silence(team) { return this.lastPose[team] ? (performance.now() - this.lastPose[team]) / 1000 : 99; }

  /** team solved its puzzle (Level 3: the shadow turns into the coloured protein) */
  setSolved(team, solved) {
    this.solved[team] = solved;
    const S = this.scenes[team];
    if (S?.reveal) { S.reveal.visible = solved; if (S.shadow) S.shadow.visible = !solved; }
  }

  render(dt) {
    const els = this.cells();
    const W = innerWidth, H = innerHeight, R = this.renderer;
    const pr = Math.min(devicePixelRatio, 2);
    R.setPixelRatio(pr);
    if (this.canvas.width !== Math.round(W * pr) || this.canvas.height !== Math.round(H * pr)) R.setSize(W, H, false);
    R.setScissorTest(true);
    R.setViewport(0, 0, W, H); R.setScissor(0, 0, W, H); R.setClearColor(0x000000, 0); R.clear();
    const k = 1 - Math.exp(-dt * 14);
    els.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > H) return;
      const S = this.scenes[i];
      S.vessels?.forEach((v) => v.update(performance.now() / 1000, dt));
      for (const it of S.items.values()) {
        if (!it.target) continue;
        it.node.position.lerp(it.target.p, k); it.node.quaternion.slerp(it.target.q, k);
      }
      R.setViewport(r.left, H - r.bottom, r.width, r.height); R.setScissor(r.left, H - r.bottom, r.width, r.height);
      R.setClearColor(0x050816, 1); R.clear();
      // Level 0 spreads wider (vessels at the back, sequences in front): stand further back
      if (this.challenge?.level === 0) { this.camera.position.set(0, 1.55, 1.55); this.camera.lookAt(0, 1.2, -1.2); } else { this.camera.position.copy(EYE); this.camera.lookAt(AIM); }
      this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix();
      R.render(S.scene, this.camera);
    });
    R.setScissorTest(false);
  }
}
