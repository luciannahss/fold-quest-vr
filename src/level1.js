// Level 1 - "Build the protein": a real structure (crambin, 1CRN) is cut at its secondary-structure
// boundaries. Pieces have colour-coded connector tips (plug = C-end, ring = N-end); joining the right
// tips snaps the pieces into their native relative pose. Finally the disulfide bridges lock the fold.
import * as THREE from 'three';
import { Chain, K } from './chain.js';
import { HBondViz } from './hbonds.js';
import { findHBonds, RESIDUE_NAMES, mulberry32 } from './chemistry.js';
import { THEME } from './ui.js';
import { makeLabel } from './vessels.js';
import { sfx } from './audio.js';
import { applyRotation } from './handle.js';
import { makeCartoon } from './cartoon.js';
import { PROTEINS } from './proteins/index.js';
import { t as tr } from './i18n.js';

const SNAP = 0.17;         // metres: how close two matching tips must be to join
const TYPE = {
  helix: { color: '#38e8ff' },
  strand: { color: '#ff3df2' },
  coil: { color: '#ffd166' },
};
// one colour per junction (the same pair of tips share a colour); grey = free terminus
const JCOL = [0xff8a3d, 0x7dff6a, 0xa58bff, 0xff6fb5, 0xff5a5a, 0x2affc4, 0xffe9a8, 0xc98a52];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const clamp01 = (t) => Math.min(1, Math.max(0, t));

function makeTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(4,8,24,0.85)'; g.beginPath(); g.roundRect(6, 6, 244, 84, 28); g.fill();
  g.lineWidth = 6; g.strokeStyle = color; g.stroke();
  g.font = '800 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  g.fillText(text, 128, 52);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  s.scale.set(0.12, 0.045, 1); s.renderOrder = 20;
  return s;
}

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const UPY = new THREE.Vector3(0, 1, 0), ZAX = new THREE.Vector3(0, 0, 1);

export class Level1 {
  constructor(game, protein, index = 0) {
    this.game = game;
    this.protein = protein; this.index = index;
    this.S = protein.scale;                 // display scale of this protein's pieces
    this.cs = 1.15 / this.S;                // keep connector tips a constant size
    this.nJ = protein.pieces.length - 1;    // number of junctions
    this.insightsShown = new Set();
    this.bridges2 = []; this.bridgePending = new Set();   // peptide-bond tubes closing the gaps between joined pieces
    this.group = new THREE.Group();
    this.group.visible = false;
    game.world.add(this.group);
    this.hb = new HBondViz(220);
    this.group.add(this.hb.mesh);
    this.phase = 'play';
    this.showAA = false;
    this.mistakes = 0; this.hints = 0;
    this.coach = { title: '', body: '', tone: 'info' };
    this.pedestal = new THREE.Vector3(0, 1.5, -1.95);
    this.t = 0;
    this._inv = new THREE.Matrix4();
    this.clusters = [];
    this.junctionDone = Array(this.nJ).fill(false);
    this.pulse = null; this.ghostUntil = 0;
    this.zoom = 1;                       // size of the finished protein (two-hand pinch), 1 while building

    this._buildPieces();
    this._buildWholeHandle();
    this._buildPedestalAndGhost();
    this._buildBridges();
    this._buildLigand();
    this.reset();
  }

  /** second line under a piece's name */
  subOf(def) { return def.sub || tr('res.range', { from: def.from, to: def.to }); }

  // ------------------------------------------------------------------ construction
  _buildPieces() {
    const residues = this.protein.data.residues, S = this.S;
    this.pieces = this.protein.pieces.map((def, idx) => {
      const rs = residues.filter((r) => r.n >= def.from && r.n <= def.to);
      const fixedRes = rs.map((r) => ({ aa: r.aa, hasH: r.hasH, N: v3(r.N), CA: v3(r.CA), C: v3(r.C), O: v3(r.O), H: r.H ? v3(r.H) : null, R: v3(r.R) }));
      const ribbonRange = def.ribbon ? [def.ribbon[0] - def.from, def.ribbon[1] - def.from] : null;
      const chain = new Chain(rs.map((r) => r.aa).join(''), { fixedRes, ribbonRange, kind: def.type, id: def.id });
      chain.group.scale.setScalar(S);
      // Level 1 shows secondary structure as solid colour: helix = cyan, strand = magenta (same as the name tags)
      if (def.ribbon) {
        const col = new THREE.Color(TYPE[def.type].color);
        chain.solidRibbon = true;
        chain.ribbon.material = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.22, roughness: 0.4, metalness: 0.05, side: THREE.DoubleSide });
        chain.ribbon.renderOrder = 0;
      }
      // cartoon: ribbon half-width / arrowheads, and smooth tubes for the coil parts (like the usual cartoon view)
      chain.ribbonHalf = 0.0235 * Math.pow(1.15 / S, 0.15);
      chain.arrow = def.type === 'strand';
      if (def.ribbon) chain._writeRibbon();
      this._buildCartoonTubes(chain, S, def);
      chain.seqLabel.visible = false;
      // fewer letters: only the two tips and the cysteines (the S-S bridge partners)
      const keep = new Set([0, rs.length - 1]);
      rs.forEach((r, i) => { if (r.aa === 'C') keep.add(i); });
      chain.setLabels = (v) => chain.labels.forEach((l, i) => (l.visible = v && keep.has(i)));
      chain.setLabels(true);
      let rad = 0; for (const r of chain.res) for (const k of ['N', 'CA', 'C', 'O', 'R']) rad = Math.max(rad, r[k].length());
      chain.fitBubble(rad * K + 0.03);
      chain.bubbleRing.visible = false; chain.setBubble = (v) => { chain.bubble.visible = v; };
      this.group.add(chain.group);
      const piece = { idx, def, chain, isPiece: true, rad: (rad * K + 0.06) * S, off: chain.center.clone().multiplyScalar(K * S), cluster: null, blend: null, hover: false, holdPos: new THREE.Vector3() };
      chain.userData = { piece };
      // connector tips (metres, piece-local, unscaled)
      const first = chain.res[0], last = chain.res[chain.res.length - 1];
      const dirN = first.N.clone().sub(first.CA).normalize(), dirC = last.C.clone().sub(last.CA).normalize();
      piece.tipN = first.N.clone().addScaledVector(dirN, 0.9).multiplyScalar(K);
      piece.tipC = last.C.clone().addScaledVector(dirC, 0.9).multiplyScalar(K);
      piece.dirN = dirN; piece.dirC = dirC;
      piece.conN = this._connector(chain, piece.tipN, dirN, false, idx - 1, 'N', [first.CA, first.N]);
      piece.conC = this._connector(chain, piece.tipC, dirC, true, idx, 'C', [last.CA, last.C]);
      // floating name tag
      piece.tag = makeLabel(def.label, this.subOf(def), def.color || TYPE[def.type].color);
      piece.tag.scale.set(...(this.protein.pieces.length > 5 ? [0.46, 0.115, 1] : [0.62, 0.155, 1]));
      this.group.add(piece.tag);
      return piece;
    });
  }

  /** invisible sphere around the finished protein so it can be grabbed anywhere and turned around */
  _buildWholeHandle() {
    let r = 0;
    for (const res of this.protein.data.residues) r = Math.max(r, Math.hypot(res.CA[0], res.CA[1], res.CA[2]));
    r = r * K * this.S + 0.1;
    this.hitR = r;
    this.hitAll = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.hitAll.scale.setScalar(r);
    this.hitAll.visible = false;           // only drawn while hovered / held (raycasts ignore visibility)
    this.group.add(this.hitAll);
    // stands in for a piece in the grab / hold code; pivot = the protein's centre (its native origin)
    this.whole = { isPiece: true, off: new THREE.Vector3(), cluster: null, held: false, hover: false, holdPos: new THREE.Vector3(), chain: { group: { position: new THREE.Vector3() } } };
    this.hitAll.userData.chain = { userData: { piece: this.whole } };
  }

  /** coil / loop spans as thin round tubes along the C-alpha path, yellow like the coil name tags */
  _buildCartoonTubes(chain, S, def) {
    if (this.protein.multiElement) {     // pieces with several strands / helices (GFP): one cartoon built from the per-residue secondary structure
      const ss = this.protein.data.residues.filter((r) => r.n >= def.from && r.n <= def.to).map((r) => r.ss);
      chain.cartoonApi = makeCartoon(chain.res, ss, S, null);
      chain.group.add(chain.cartoonApi.group);
      chain.kind = 'coil'; chain.ribbon.visible = false;   // Chain's own single ribbon is not used here
      // the peptide-bond tubes that later join two pieces (_addBridge) use the coil tube's material and radius
      const col = new THREE.Color(TYPE.coil.color);
      chain.tubeMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.2, roughness: 0.45, metalness: 0.05 });
      chain.tubeRadius = 0.0083 * Math.pow(1.15 / S, 0.4);
      return;
    }
    const n = chain.res.length, rr = chain.ribbonRange, spans = [];
    if (!rr) spans.push([0, n - 1]);
    else {
      spans.push(rr[0] > 0 ? [0, rr[0]] : [0, 0]);                 // coil up to the first ribbon, or just the end stub when the ribbon starts at the end
      spans.push(rr[1] < n - 1 ? [rr[1], n - 1] : [n - 1, n - 1]);  // likewise at the C-terminal side
    }
    const radius = 0.0083 * Math.pow(1.15 / S, 0.4), col = new THREE.Color(TYPE.coil.color);
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.2, roughness: 0.45, metalness: 0.05 });
    const group = new THREE.Group();
    for (const [a, b] of spans) {
      const pts = chain.res.slice(a, b + 1).map((r) => r.CA.clone().multiplyScalar(K));
      if (a === 0) pts.unshift(chain.res[0].N.clone().multiplyScalar(K));        // run the tube to the real chain ends
      if (b === n - 1) pts.push(chain.res[n - 1].C.clone().multiplyScalar(K));
      if (pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 10, radius, 10, false), mat));
      for (const p of [pts[0], pts[pts.length - 1]]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), mat); cap.position.copy(p); group.add(cap); }
    }
    chain.cartoon = group; chain.tubeMat = mat; chain.tubeRadius = radius;
    chain.group.add(group);
  }

  /**
   * plug (C-end: ball + cone) or ring (N-end), coloured by the junction it belongs to (grey = free terminus).
   * A short neck of the same colour joins it to the terminal atom, so the shape is attached to the chain end and
   * does not float. Joined pieces hide their connectors and a bridge tube closes the gap (see _addBridge).
   */
  _connector(chain, tip, dir, plug, junction, text, anchors = []) {
    const free = junction < 0 || junction >= this.nJ;
    const color = free ? 0x9aa6c8 : JCOL[junction];
    const node = new THREE.Group();
    node.position.copy(tip);
    node.quaternion.setFromUnitVectors(ZAX, dir);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, toneMapped: false });
    const glow = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    if (plug) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), mat);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.03, 14), mat); cone.rotation.x = Math.PI / 2; cone.position.z = 0.02;
      node.add(ball, cone);
    } else {
      node.add(new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0055, 10, 32), mat));
    }
    node.add(new THREE.Mesh(new THREE.SphereGeometry(0.034, 16, 12), glow));
    // neck: from the terminal atom to the connector centre (in node-local coordinates)
    const atom = anchors[anchors.length - 1];
    if (atom) {
      const toLocal = (p) => p.clone().sub(tip).applyQuaternion(node.quaternion.clone().invert());
      const neck = new THREE.CatmullRomCurve3([toLocal(atom.clone().multiplyScalar(K)), new THREE.Vector3(0, 0, 0)]);
      node.add(new THREE.Mesh(new THREE.TubeGeometry(neck, 6, 0.0075, 8, false), new THREE.MeshBasicMaterial({ color, toneMapped: false })));
    }
    const tag = makeTag(text, hex(color)); tag.position.z = 0.075; node.add(tag);
    chain.group.add(node);
    return { node, mat, glow, junction, plug, free };
  }



  /** residue lists whose C-alpha traces make up the hint ghost (one per chain) */
  ghostPaths() { return [this.protein.data.residues]; }

  _buildPedestalAndGhost() {
    const base = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.02, 56), new THREE.MeshStandardMaterial({ color: 0x0b1030, emissive: 0x0a1a3a, roughness: 0.4, metalness: 0.6 }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.007, 8, 72).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3df2, toneMapped: false }));
    rim.position.y = 0.011;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.42, 0.7, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3df2, transparent: true, opacity: 0.035, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    beam.position.y = 0.36;
    base.add(disc, rim, beam);
    base.position.set(this.pedestal.x, this.pedestal.y - 0.42, this.pedestal.z);
    this.group.add(base);
    const label = makeLabel(tr('assembly'), tr('assembly.sub', { name: this.protein.name.toLowerCase() }), '#ff3df2');
    label.scale.set(0.6, 0.15, 1); label.position.set(this.pedestal.x, this.pedestal.y + 0.78, this.pedestal.z);   // high above, clear of the pieces and their name tags
    this.group.add(label);

    // ghost of the finished fold (C-alpha trace) - only shown on Hint
    const ghostMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: 0xff3df2, emissiveIntensity: 0.25, transparent: true, opacity: 0.3, roughness: 0.1, clearcoat: 1, depthWrite: false });
    this.ghost = new THREE.Group();
    for (const path of this.ghostPaths()) {
      const pts = path.map((r) => v3(r.CA).multiplyScalar(K));
      this.ghost.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), Math.max(20, pts.length * 4), 0.016, 10, false), ghostMat));
    }
    this.ghost.scale.setScalar(this.S);
    this.ghost.position.copy(this.pedestal);
    this.ghost.visible = false;
    this.ghostMat = ghostMat;
    this.group.add(this.ghost);
  }

  _buildBridges() {
    const matB = new THREE.MeshStandardMaterial({ color: 0xffe14d, emissive: 0xffc400, emissiveIntensity: 1.2, roughness: 0.3 });
    this.bridges = this.protein.data.disulfides.map(([a, b]) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), matB);
      mesh.visible = false;
      this.group.add(mesh);
      const haloMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const halos = [0, 1].map(() => { const h = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), haloMat); h.visible = false; this.group.add(h); return h; });
      return { a, b, mesh, halos, progress: 0 };
    });
  }

  /** bound ligand (e.g. the heme of myoglobin): ball-and-stick, shown once the protein is reconstructed */
  _buildLigand() {
    this.ligandGroup = null; this.ligP = 0;
    const lig = this.protein.data.ligand || [];
    if (!lig.length) return;
    const sty = this.protein.ligandStyle || {};   // optional colours (hemoglobin's hemes are green to stand out)
    const COL = { FE: 0xff7a1a, C: sty.C ?? 0xd11d33, N: sty.N ?? 0x3b6bff, O: 0xff8a5a };
    const RAD = { FE: 0.02, C: 0.0105, N: 0.0115, O: 0.0115 };
    const group = new THREE.Group();
    const sph = new THREE.SphereGeometry(1, 14, 10), cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    const pts = lig.map((a) => v3(a.p).multiplyScalar(K));
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.35, emissive: sty.emissive ?? 0x330008, emissiveIntensity: 0.6 });
    const atoms = new THREE.InstancedMesh(sph, mat, lig.length);
    const m = new THREE.Matrix4();
    lig.forEach((a, i) => {
      atoms.setMatrixAt(i, m.compose(pts[i], new THREE.Quaternion(), new THREE.Vector3().setScalar(RAD[a.e] || 0.011)));
      atoms.setColorAt(i, new THREE.Color(COL[a.e] || 0xcccccc));
    });
    group.add(atoms);
    const bonds = [];
    for (let i = 0; i < lig.length; i++) for (let j = i + 1; j < lig.length; j++) {
      const d = lig[i].p.reduce((s2, v, k) => s2 + (v - lig[j].p[k]) ** 2, 0) ** 0.5;
      const fe = lig[i].e === 'FE' || lig[j].e === 'FE';
      if (d > 0.5 && d < (fe ? 2.4 : 1.75)) bonds.push([i, j]);
    }
    const bmesh = new THREE.InstancedMesh(cyl, new THREE.MeshStandardMaterial({ color: sty.bond ?? 0xe8b0b8, roughness: 0.5 }), bonds.length);
    bonds.forEach(([i, j], k) => {
      const mid = pts[i].clone().add(pts[j]).multiplyScalar(0.5), dir = pts[j].clone().sub(pts[i]), len = dir.length();
      bmesh.setMatrixAt(k, m.compose(mid, new THREE.Quaternion().setFromUnitVectors(UPY, dir.normalize()), new THREE.Vector3(0.0035, len, 0.0035)));
    });
    group.add(bmesh);
    group.position.copy(this.pedestal);
    group.visible = false;
    this.ligandGroup = group;
    this.group.add(group);
  }

  // ------------------------------------------------------------------ geometry helpers
  pieceOf(resNo) { return this.pieces.find((p) => resNo >= p.def.from && resNo <= p.def.to); }

  tipWorld(p, which, out = new THREE.Vector3()) {
    const g = p.chain.group;
    return out.copy(which === 'N' ? p.tipN : which === 'C' ? p.tipC : p.tipI).multiplyScalar(this.S).applyQuaternion(g.quaternion).add(g.position);
  }

  /** place all pieces of a cluster from its pose (native frame -> world) */
  place(cl, dt = 0) {
    for (const p of cl.pieces) {
      let pos = cl.pos, quat = cl.quat;
      if (p.blend) {
        p.blend.t = Math.min(1, p.blend.t + dt / 0.55);
        const e = ease(p.blend.t);
        pos = _v2.lerpVectors(p.blend.pos, cl.pos, e);
        quat = _q.slerpQuaternions(p.blend.quat, cl.quat, e);
        if (p.blend.t >= 1) p.blend = null;
      }
      const g = p.chain.group, z = this.zoom;
      g.scale.setScalar(this.S * z);
      g.quaternion.copy(quat);
      g.position.copy(p.off).multiplyScalar(z).applyQuaternion(quat).add(pos);
    }
  }

  // ------------------------------------------------------------------ flow
  reset() {
    this.phase = 'play'; this.mistakes = 0; this.hints = 0; this.zoom = 1; this._pinch = null;
    this.setAA(false);
    this.junctionDone = Array(this.nJ).fill(false);
    this.insightsShown = new Set();
    for (const m of this.bridges2) { m.parent?.remove(m); m.geometry.dispose(); }
    this.bridges2 = []; this.bridgePending = new Set();
    this.pulse = null; this.ghostUntil = 0; this.ghost.visible = false;
    this.bridges.forEach((b) => { b.progress = 0; b.mesh.visible = false; b.halos.forEach((h) => (h.visible = false)); });
    this.seal = null;
    this.ligP = 0; if (this.ligandGroup) this.ligandGroup.visible = false;
    this.whole.cluster = null; this.whole.held = false; this.hitAll.visible = false;
    this.clusters = [];
    const rnd = mulberry32(77);
    // shuffle the pieces over the arc so the order isn't given away
    const n = this.pieces.length;
    const slotOf = this.pieces.map((_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [slotOf[i], slotOf[j]] = [slotOf[j], slotOf[i]]; }
    if (slotOf.every((v, i) => v === i) || slotOf.every((v, i) => v === n - 1 - i)) [slotOf[0], slotOf[1]] = [slotOf[1], slotOf[0]];
    const step = n <= 2 ? 0.8 : n === 3 ? 0.6 : n <= 4 ? 0.45 : n <= 5 ? 0.34 : 0.27;
    const cols = Math.ceil(n / 2);
    this.pieces.forEach((p, i) => {
      p.blend = null; p.hover = false;
      let home;
      if (n <= 5) { // single arc
        const th = (slotOf[i] - (n - 1) / 2) * step;
        home = new THREE.Vector3(Math.sin(th) * 1.1, 1.15 + [-0.06, 0.24, 0.09][slotOf[i] % 3], 0.1 - Math.cos(th) * 1.1);
      } else {      // two staggered rows (back row higher), kept narrow so nothing hides behind the side boards
        const row = slotOf[i] % 2, col = Math.floor(slotOf[i] / 2);
        const th = (col - (cols - 1) / 2) * 0.4 + (row ? 0.2 : 0);
        const r = row ? 1.0 : 1.3;
        home = new THREE.Vector3(Math.sin(th) * r, row ? 1.0 : 1.42, 0.1 - Math.cos(th) * r);
      }
      const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28));
      const cl = { pieces: [p], quat, pos: home.clone().sub(p.off.clone().applyQuaternion(quat)), id: i, home };
      p.cluster = cl; this.clusters.push(cl);
      for (const c of [p.conN, p.conC]) { c.node.visible = true; c.done = false; }
      p.chain.setBubble(true);
      this.place(cl);
    });
    this.say(tr('build.title', { level: this.levelName(), name: this.protein.name.toLowerCase(), id: this.protein.id }),
      tr('l1.start', { intro: this.protein.intro, input: this.game.inputHint() }));
  }

  /** show / hide the amino acids (side-chain spheres + letters) */
  setAA(v) {
    this.showAA = v;
    for (const p of this.pieces) {
      const ch = p.chain;
      ch.setAtomsVisible(v); ch.setSideChains(v); ch.setLabels(v);
      // with atoms shown the cartoon turns see-through so the atoms inside stay visible
      const rm = ch.ribbon.material; rm.transparent = v; rm.opacity = v ? 0.5 : 1; rm.depthWrite = !v; rm.needsUpdate = true;
      ch.cartoonApi?.setTransparent(v);
    }
    this.game.coachPanel.redraw();
  }

  levelName() { return tr('level', { n: 1 }); }
  /** group challenge: the puzzle counts as solved when the chain is complete (the finale animation does not matter) */
  groupSolved() { return this.phase === 'sealing' || this.phase === 'done'; }
  /** what the finish screen offers next: the next protein, then Level 2 */
  nextTarget() {
    const next = PROTEINS[this.index + 1];
    if (next) return { label: tr('next.item', { name: next.short || next.name }), go: () => this.game.setLevel(1, this.index + 1) };
    return { label: tr('next.level', { n: 2 }), go: () => this.game.setLevel(2, 0) };
  }
  extraCtx() { return {}; }
  completeText() {
    const watch = tr(`p.${this.protein.id}.watch`);   // (optional per-protein text: what is about to appear)
    const more = this.bridges.length ? tr('l1.more.ss') : this.ligandGroup ? (watch.startsWith('p.') ? tr('l1.more.heme') : watch) : '';
    return tr('l1.complete', { n: this.pieces.length, more });
  }

  say(title, body, tone = 'info') { this.coach = { title, body, tone }; this.game.coachPanel.redraw(); }
  get joined() { return this.junctionDone.filter(Boolean).length; }
  sig() { return `${this.index}|${this.joined}|${this.mistakes}|${this.phase}|${this.hints}`; }

  hint() {
    this.hints++;
    const j = this.junctionDone.findIndex((d) => !d);
    this.ghostUntil = this.t + 8;
    if (j >= 0) this.pulse = { j, until: this.t + 6 };
    const a = this.pieces[j], b = this.pieces[j + 1];
    if (j >= 0) this.say(tr('hint'), tr('l1.hint', { color: tr('l1.jnames')[j], ato: a.def.to, a: a.def.label.toLowerCase(), bfrom: b.def.from, b: b.def.label.toLowerCase() }), 'warn');
  }

  // ------------------------------------------------------------------ pointers
  handlePointers(pointers, raycaster, dt) {
    const g = this.game;
    const interact = this.phase === 'play' ? this.pieces : [];
    const targets = [...g.panels.filter((p) => p.mesh.visible).map((p) => p.mesh), ...interact.map((p) => p.chain.hit)];
    if (this.phase === 'done' && this.whole.cluster) targets.push(this.hitAll);   // the finished protein can be grabbed whole
    this.whole.hover = false;
    const hovBtn = new Map(g.panels.map((p) => [p, null]));
    this.pieces.forEach((p) => (p.hover = false));
    // finished protein held with two hands (or two triggers): moving the hands apart / together zooms it
    const holders = this.phase === 'done' ? pointers.filter((q) => q.pressed && q.holding === this.whole) : [];
    const two = holders.length >= 2;
    if (two) {
      const d = holders[0].origin.distanceTo(holders[1].origin);
      if (!this._pinch) this._pinch = { d, z: this.zoom };
      else if (d > 0.02) {
        this.zoom += (Math.min(3, Math.max(0.4, this._pinch.z * (d / this._pinch.d))) - this.zoom) * 0.35;   // smoothed: hand tracking jitters
        if (this.clusters[0]) this.place(this.clusters[0]);
      }
    } else if (this._pinch) {                                       // back to one hand: take hold again from where the protein is, no jump
      this._pinch = null;
      pointers.forEach((q) => { q._rot = null; if (q.pressed && q.holding === this.whole) this.grab(this.whole, q); });
    }
    for (const ptr of pointers) {
      if (ptr.holding && !ptr.holding.isPiece) ptr.holding = null;
      const was = ptr.prevPressed;
      ptr.hit = null; ptr.hitDist = 3;
      raycaster.set(ptr.origin, ptr.dir); raycaster.far = 6;
      const hits = ptr.holding ? [] : raycaster.intersectObjects(targets, false);
      let btn = null, piece = null;
      if (hits.length) {
        const h = hits[0];
        ptr.hit = h.point; ptr.hitDist = h.distance;
        if (h.object.userData.panel) { const pan = h.object.userData.panel; btn = pan.pick(h.uv); if (btn) hovBtn.set(pan, btn.label); }
        else if (h.object.userData.chain) piece = h.object.userData.chain.userData.piece;
      }
      if (piece) piece.hover = true;
      if (ptr.pressed && !was) {
        sfx.unlock();
        if (btn && !btn.disabled) { sfx.click(); ptr.haptic?.(0.4, 30); ptr.captured = true; btn.onClick(); }
        else if (piece) { this.grab(piece, ptr); ptr.captured = true; }
        else if (this.phase === 'done' && this.whole.held && !btn) { this.grab(this.whole, ptr); ptr.captured = true; }   // a 2nd hand pinching anywhere joins the first (zoom)
        else ptr.captured = !!(hits.length && hits[0].object.userData.panel);
      }
      if (!ptr.pressed) ptr.captured = false;
      if (ptr.holding) {
        if (two && ptr.holding === this.whole) { /* two hands: zooming, the protein itself stays put */ }
        else this.hold(ptr, dt);
      }
      ptr.prevPressed = ptr.pressed;
    }
    if (this.phase === 'done') this.whole.held = pointers.some((q) => q.holding === this.whole);
    for (const [pan, label] of hovBtn) pan.setHover(label);
    this.hitAll.visible = this.phase === 'done' && (this.whole.hover || this.whole.held);
    for (const p of this.pieces) {
      const on = p.hover || p.held;
      p.chain.bubble.material.opacity = 0.04 + (on ? 0.1 : 0);
    }
  }

  grab(p, ptr) {
    const cl = p.cluster;
    ptr.holding = p; p.held = true; ptr._rot = null;
    cl.start = { pos: cl.pos.clone(), quat: cl.quat.clone() };
    cl.bounce = null;
    const wp = p.chain.group.position;
    p.holdPos.copy(wp);
    const o = this.game.world.worldToLocal(ptr.origin.clone());
    ptr.holdDist = THREE.MathUtils.clamp(o.distanceTo(wp), 0.3, 3);
    sfx.grab(); ptr.haptic?.(0.6, 50);
  }

  hold(ptr, dt) {
    const p = ptr.holding, cl = p.cluster, w = this.game.world;
    ptr.holdDist = THREE.MathUtils.clamp(ptr.holdDist + (ptr.holdDelta || 0), 0.25, 3.2);
    const o = w.worldToLocal(ptr.origin.clone());
    const d = ptr.dir.clone().transformDirection(this._inv.copy(w.matrixWorld).invert());
    const target = o.clone().addScaledVector(d, ptr.holdDist);
    // aim assist: if the ray passes near a spot where a compatible tip pair would meet, resolve the depth
    // ambiguity (flat screens have no depth) by pulling the cluster to that spot
    let best = null;
    for (const q of this.clusters) {
      if (q === cl) continue;
      for (const pair of this.compatPairs(cl, q)) {
        const pd = p.holdPos.clone().add(_v.subVectors(pair.tb, pair.ta));
        const proj = o.clone().addScaledVector(d, Math.max(0.2, _v2.subVectors(pd, o).dot(d)));
        const perp = proj.distanceTo(pd);
        if (perp < 0.35 && (!best || perp < best.perp)) best = { perp, pd, proj };
      }
    }
    if (best) target.copy(best.proj).lerp(best.pd, 1 - best.perp / 0.35);
    // turning the cluster (grip / middle pinch, thumbstick, right-drag) freezes its position
    const rotating = applyRotation(ptr, cl.quat, w.quaternion);
    if (!rotating) p.holdPos.lerp(target, 1 - Math.pow(0.0005, dt));
    cl.pos.copy(p.holdPos).sub(_v.copy(p.off).applyQuaternion(cl.quat));
    this.place(cl);
    ptr.hit = w.localToWorld(target.clone());
    ptr.hitDist = ptr.origin.distanceTo(ptr.hit);
    // preview: matching tips glow when they are within snapping distance
    this.preview = null;
    for (const q of this.clusters) {
      if (q === cl) continue;
      for (const pair of this.compatPairs(cl, q)) if (pair.ta.distanceTo(pair.tb) < SNAP) this.preview = pair;
    }
    if (!ptr.pressed) this.release(ptr);
  }

  /** all (tip of A, tip of B) pairs that are the correct sequence neighbours, with world tip positions */
  compatPairs(clA, clB) {
    const out = [];
    for (const a of clA.pieces) for (const b of clB.pieces) {
      if (b.idx === a.idx + 1) out.push({ a, b, ja: a.idx, ta: this.tipWorld(a, 'C'), tb: this.tipWorld(b, 'N') });
      if (a.idx === b.idx + 1) out.push({ a, b, ja: b.idx, ta: this.tipWorld(a, 'N'), tb: this.tipWorld(b, 'C') });
    }
    return out;
  }

  release(ptr) {
    const p = ptr.holding; ptr.holding = null; p.held = false;
    const cl = p.cluster;
    this.preview = null;
    // correct connection?
    let best = null;
    for (const q of this.clusters) {
      if (q === cl) continue;
      for (const pair of this.compatPairs(cl, q)) {
        const d = pair.ta.distanceTo(pair.tb);
        if (d < SNAP && (!best || d < best.d)) best = { ...pair, d, other: q };
      }
    }
    if (best) { this.connect(cl, best.other, best.ja); ptr.haptic?.(0.8, 100); return; }
    // wrong pieces / tips brought together?
    const wrong = this.detectWrong(cl);
    if (wrong) {
      if (!wrong.soft) { // a soft warning only explains; a real mistake also bounces the pieces back
        this.mistakes++;
        cl.bounce = { from: cl.pos.clone(), to: cl.start.pos.clone(), qFrom: cl.quat.clone(), qTo: cl.start.quat.clone(), t: 0 };
        sfx.bad(); ptr.haptic?.(0.9, 140);
      } else sfx.click();
      this.explainWrong(wrong);
    } else sfx.click();
  }

  /** a wrong sequence neighbour (tip pair) brought together, or null */
  detectWrong(cl) {
    let wrong = null;
    for (const q of this.clusters) {
      if (q === cl) continue;
      for (const a of cl.pieces) for (const b of q.pieces) {
        for (const wa of ['N', 'C']) for (const wb of ['N', 'C']) {
          const d = this.tipWorld(a, wa).distanceTo(this.tipWorld(b, wb));
          const ok = (wa === 'C' && wb === 'N' && b.idx === a.idx + 1) || (wa === 'N' && wb === 'C' && a.idx === b.idx + 1);
          if (d < SNAP && !ok && (!wrong || d < wrong.d)) wrong = { a, b, wa, wb, d };
        }
      }
    }
    return wrong;
  }

  explainWrong({ a, b, wa, wb }) {
    const nm = (p) => p.def.label.toLowerCase();
    let body;
    if (wa === wb) body = tr(`l1.wrong.${wa}`);
    else if ((wa === 'N' && a.idx === 0) || (wa === 'C' && a.idx === this.nJ) || (wb === 'N' && b.idx === 0) || (wb === 'C' && b.idx === this.nJ)) body = tr('l1.wrong.end');
    else {
      const [first, second] = wa === 'C' ? [a, b] : [b, a];
      body = tr('l1.wrong.order', { a: first.def.to, name: nm(first), next: first.def.to + 1, b: second.def.from });
    }
    this.say(tr('l1.wrong.title'), body, 'bad');
  }

  connect(cl, other, junction) {
    // the incoming pieces glide into the native pose of the cluster they join
    for (const p of cl.pieces) {
      p.blend = { pos: cl.pos.clone(), quat: cl.quat.clone(), t: 0 };
      p.cluster = other; other.pieces.push(p);
    }
    this.clusters = this.clusters.filter((c) => c !== cl);
    this.junctionDone[junction] = true;
    this.bridgePending.add(junction);
    for (const c of [this.pieces[junction].conC, this.pieces[junction + 1].conN]) { c.done = true; }
    sfx.good();
    const mid = this.tipWorld(this.pieces[junction], 'C');
    this.game.bursts.spawn(mid, JCOL[junction], 50, 1.0);
    // facts that become visible with the new connection
    let extra = '';
    this.protein.insights.forEach((ins, k) => {
      if (this.insightsShown.has(k)) return;
      if (ins.pieces.every((i) => other.pieces.includes(this.pieces[i]))) { this.insightsShown.add(k); extra += ins.text; }
    });
    this.pulse = null;
    this.say(tr('l1.connected', { j: this.joined, n: this.nJ }), this.protein.junctionText[junction] + extra, 'good');
    if (this.joined === this.nJ) this.complete();
  }

  /**
   * After two pieces are joined: a short tube along the peptide bond (C of the last residue -> N of the next) so the
   * finished backbone is continuous. Built in the first piece's local frame, once the second piece has glided in.
   */
  _addBridge(j) {
    const a = this.pieces[j], b = this.pieces[j + 1];
    const la = a.chain.res[a.chain.res.length - 1], fb = b.chain.res[0];
    const shift = b.chain.center.clone().sub(a.chain.center);           // native offset between the two pieces (Angstrom)
    const pts = [la.CA, la.C, fb.N.clone().add(shift), fb.CA.clone().add(shift)].map((v) => v.clone().multiplyScalar(K));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, a.chain.tubeRadius, 10, false), a.chain.tubeMat);
    a.chain.group.add(mesh);
    this.bridges2.push(mesh);
  }

  /** residues of a piece in the protein's own frame (so counts don't depend on where the piece currently is) */
  nativeRes(p) { return p.chain.res.map((r) => { const o = { aa: r.aa, hasH: r.hasH }; for (const k of ['N', 'CA', 'C', 'O', 'H', 'R']) o[k] = r[k] ? r[k].clone().add(p.chain.center) : null; return o; }); }
  crossBonds(pa, pb) { return findHBonds([this.nativeRes(pa), this.nativeRes(pb)], 2.7, 130).filter((b) => b.ci !== b.cj).length; }
  totalBonds() { return findHBonds(this.pieces.map((p) => this.nativeRes(p)), 2.7, 130).length; }

  complete() {
    this.phase = 'sealing';
    const cl = this.clusters[0];
    this.seal = { t: 0, from: cl.pos.clone(), qFrom: cl.quat.clone() };
    this.pieces.forEach((p) => p.chain.setBubble(false));
    this.say(this.completeTitle || tr('l1.complete.title'), this.completeText(), 'good');
  }

  finish() {
    this.phase = 'done';
    this.whole.cluster = this.clusters[0];
    this.whole.chain.group.position = this.clusters[0].pos;   // shared reference: moves with the cluster
    this.hitAll.position.copy(this.clusters[0].pos);
    const stars = this.mistakes <= 1 ? 3 : this.mistakes <= 3 ? 2 : 1;
    const ctx = { cross: (i, j) => this.crossBonds(this.pieces[i], this.pieces[j]), total: this.totalBonds(), ...this.extraCtx() };
    this.say(tr('l1.done.title', { name: this.protein.name, stars: '★'.repeat(stars) + '☆'.repeat(3 - stars) }),
      `${this.protein.finish(ctx)}\n${tr('stats', { m: this.mistakes, h: this.hints })}`, 'good');
    sfx.win();
    this.pieces.forEach((p, i) => setTimeout(() => this.game.bursts.spawn(p.chain.group.position, JCOL[i % JCOL.length], 60, 1.4), i * 180));
  }

  // ------------------------------------------------------------------ per frame
  update(dt, t, pointers, raycaster) {
    this.t = t;
    this.handlePointers(pointers, raycaster, dt);
    for (const cl of this.clusters) {
      if (cl.bounce) {
        cl.bounce.t = Math.min(1, cl.bounce.t + dt / 0.6);
        const e = ease(cl.bounce.t);
        cl.pos.lerpVectors(cl.bounce.from, cl.bounce.to, e); cl.quat.slerpQuaternions(cl.bounce.qFrom, cl.bounce.qTo, e);
        if (cl.bounce.t >= 1) cl.bounce = null;
      }
      if (!cl.pieces.some((p) => p.held) && !this.whole.held) this.place(cl, dt);
    }
    // sealing: move the finished chain to the pedestal, then reveal the disulfide bridges one by one
    if (this.seal) {
      const s = this.seal; s.t += dt;
      const cl = this.clusters[0];
      const e = ease(s.t / 1.4);
      cl.pos.lerpVectors(s.from, this.pedestal, e);
      cl.quat.slerpQuaternions(s.qFrom, _q.identity(), e);
      this.bridges.forEach((b, i) => {
        const start = 1.8 + i * 1.0;
        const was = b.progress;
        b.progress = clamp01((s.t - start) / 0.7);
        if (was === 0 && b.progress > 0) { sfx.fold(); this.game.bursts.spawn(this.sgWorld(b.a), 0xffe14d, 40, 0.8); }
      });
      const end = this.bridges.length ? 1.8 + this.bridges.length + 0.6 : this.ligandGroup ? 3.6 : 2.4;
      if (s.t > end && this.phase === 'sealing') { this.seal = null; this.finish(); }
    }
    this.updateBridges();
    for (const j of [...this.bridgePending]) {
      if (!this.pieces[j].blend && !this.pieces[j + 1].blend) { this._addBridge(j); this.bridgePending.delete(j); }
    }
    if (this.ligandGroup) { // the ligand pops in once the chain has been moved to the pedestal
      const show = this.phase === 'done' || (this.seal && this.seal.t > 1.6);
      this.ligP = show ? Math.min(1, this.ligP + dt * 1.6) : 0;
      this.ligandGroup.visible = this.ligP > 0;
      this.ligandGroup.scale.setScalar(this.S * this.zoom * ease(this.ligP));
      const c0 = this.clusters[0];
      if (c0 && this.ligP > 0) { this.ligandGroup.position.copy(c0.pos); this.ligandGroup.quaternion.copy(c0.quat); } // follows the protein
    }
    if (this.phase === 'done' && this.clusters[0]) { this.hitAll.position.copy(this.clusters[0].pos); this.hitAll.scale.setScalar(this.hitR * this.zoom); }
    // tags follow pieces
    for (const p of this.pieces) {
      p.tag.position.copy(p.chain.group.position); p.tag.position.y += p.rad + 0.1;
      p.tag.visible = p.cluster.pieces.length === 1; // names only on loose pieces
      // connectors: pulse when hinted / previewed, fade once joined
      for (const c of [p.conN, p.conC]) {
        if (c.setJoined) c.setJoined(c.done || this.phase === 'sealing' || this.phase === 'done');
        else c.node.visible = !c.done && !(this.phase === 'sealing' || this.phase === 'done');
        let k = 1;
        if (this.pulse && this.pulse.until > t && c.junction === this.pulse.j) k = 1.5 + 0.5 * Math.sin(t * 9);
        if (this.preview && c.junction === this.preview.ja && !c.done) k = 1.8;
        if (c.setPulse) c.setPulse(k);
        else { c.node.scale.setScalar(k * this.cs); c.glow.opacity = 0.22 * (k > 1 ? 2.2 : 1); }
      }
    }
    if (this.pulse && this.pulse.until <= t) this.pulse = null;
    // ghost
    const gv = this.ghostUntil > t;
    this.ghost.visible = gv;
    if (gv) this.ghostMat.opacity = 0.18 + 0.12 * Math.sin(t * 4) + 0.12;
    this.updateBonds(t);
  }

  sgWorld(resNo) {
    const p = this.pieceOf(resNo), r = p.chain.res[resNo - p.def.from];
    const g = p.chain.group;
    return r.R.clone().multiplyScalar(K * this.S * this.zoom).applyQuaternion(g.quaternion).add(g.position);
  }

  updateBridges() {
    for (const b of this.bridges) {
      b.mesh.visible = b.progress > 0;
      b.halos.forEach((h) => (h.visible = b.mesh.visible));
      if (!b.mesh.visible) continue;
      const A = this.sgWorld(b.a), B = this.sgWorld(b.b);
      b.halos[0].position.copy(A); b.halos[1].position.copy(B);
      b.halos.forEach((h) => h.scale.setScalar((0.8 + 0.25 * Math.sin(this.t * 5 + b.a)) * this.zoom));
      const end = _v.lerpVectors(A, B, b.progress);
      const len = A.distanceTo(end);
      b.mesh.position.copy(A).add(end).multiplyScalar(0.5);
      b.mesh.quaternion.setFromUnitVectors(UPY, _v2.subVectors(end, A).normalize());
      b.mesh.scale.set(0.011 * this.zoom, Math.max(len, 0.0001), 0.011 * this.zoom);
    }
  }

  /** no H-bond dots are drawn in Levels 1 and 2 (the counts are still reported in the finale text) */
  updateBonds() { this.hb.begin(); this.hb.end(); }


  // ------------------------------------------------------------------ panels
  drawCoach(p) {
    const { w, h } = p;
    const g = this.game;
    const c = this.coach;
    const tone = { info: THEME.border, good: THEME.good, bad: THEME.bad, warn: THEME.warn }[c.tone] || THEME.border;
    const bodyY = p.text(c.title, 56, 34, { size: 44, weight: 800, color: tone, shadow: tone, maxW: w - 112, lh: 1.15 }) + 14;
    p.text(c.body, 56, bodyY, { size: 31, maxW: w - 112, lh: 1.3 });
    const r1 = h - 196, r2 = h - 100, bh = 78;
    const options = () => p.button(g.menuOpen ? tr('options.close') : tr('options'), w - 56 - 290, r2, 290, bh, () => g.toggleMenu(), { active: g.menuOpen, size: 32 });
    if (g.group.inRound) {         // group challenge: clock, score and progress; no restart / next
      const solved = this.groupSolved();
      p.text(solved ? g.group.solvedLine() : g.group.statusLine(this), 56, r1 - 58, { size: 30, weight: 700, color: solved ? THEME.good : THEME.text, maxW: w - 112 });
      if (!solved) p.button(tr('hint'), 56, r1, 190, bh, () => this.hint());
      p.button(this.showAA ? tr('amino.hide') : tr('amino.show'), solved ? 56 : 266, r1, solved ? 420 : w - 56 - 266, bh, () => this.setAA(!this.showAA), { active: this.showAA, size: 29 });
      options();
      return;
    }
    if (this.phase === 'play' || this.phase === 'sealing') {
      p.text(tr('l1.status', { j: this.joined, n: this.nJ, m: this.mistakes }), 56, r1 - 58, { size: 34, weight: 700 });
      p.button(tr('hint'), 56, r1, 190, bh, () => this.hint(), { disabled: this.phase !== 'play' });
      p.button(tr('restart'), 266, r1, 240, bh, () => this.reset());
      p.button(this.showAA ? tr('amino.hide') : tr('amino.show'), 526, r1, w - 56 - 526, bh, () => this.setAA(!this.showAA), { active: this.showAA, size: 29 });
      options();
    } else {
      p.text(tr('l1.turn'), 56, r1 - 94, { size: 26, color: THEME.warn, maxW: w - 112 });   // (up to two lines)
      p.button(tr('play.again'), 56, r1, 300, bh, () => this.reset(), { primary: true });
      p.button(this.showAA ? tr('amino.hide') : tr('amino.show'), 380, r1, w - 56 - 380, bh, () => this.setAA(!this.showAA), { active: this.showAA, size: 29 });
      const nx = this.nextTarget();
      if (nx) p.button(nx.label, 56, r2, 330, bh, nx.go, { primary: true, size: 30 });
      else p.button(tr('level.complete'), 56, r2, 330, bh, () => {}, { disabled: true, size: 30 });
      if (!g.group.active) p.button(tr('exit.home'), 56 + 330 + 12, r2, 234, bh, () => g.hooks.exit(), { size: 28 });   // back to the start screen
      options();
    }
  }

  drawSide(p) {
    const { w, h, g } = p;
    p.text(`${this.protein.name} · ${this.protein.id}`, 50, 34, { size: 44, weight: 800, color: THEME.border });
    p.text(this.protein.subtitle, 50, 100, { size: 27, color: THEME.dim, maxW: w - 100 });
    const rowH = this.pieces.length > 5 ? 56 : 70;
    let y = 190;
    p.text(tr('l1.pieces'), 50, y, { size: 28, color: THEME.dim, weight: 700 }); y += 42;
    this.pieces.forEach((pc) => {
      const joined = pc.cluster.pieces.length > 1;
      g.fillStyle = TYPE[pc.def.type].color; g.fillRect(50, y + 6, 10, rowH - 24);
      p.text(`${pc.def.label}`, 76, y, { size: rowH < 60 ? 26 : 29, weight: 800, color: TYPE[pc.def.type].color });
      p.text(`${this.subOf(pc.def)}${joined ? tr('l1.joined') : ''}`, 76, y + (rowH < 60 ? 26 : 30), { size: rowH < 60 ? 22 : 25, color: joined ? THEME.good : THEME.dim });
      y += rowH;
    });
    y += 14;
    p.text(tr('l1.tips'), 50, y, { size: 28, color: THEME.dim, weight: 700 }); y += 40;
    p.text(tr('l1.tips.body'), 50, y, { size: 25, maxW: w - 100, lh: 1.2 }); y += 140;
    p.text(this.game.rotateHint(), 50, y, { size: 24, color: THEME.warn, maxW: w - 100, lh: 1.2 });
  }
}


export { makeTag, v3, SNAP, ease, clamp01, JCOL, TYPE };
