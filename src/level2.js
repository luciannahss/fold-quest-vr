// Level 2 - quaternary structure: a complex made of separate chains (insulin: 2 chains, hemoglobin: 4 chains).
// Each chain is a rigid piece. Every interface between two chains (computed from the coordinates) is marked by
// glowing patches coloured by chemistry, plus a pair of KEYED complementary shapes: a knob with a tab on one chain,
// a socket with a slot on its partner. Docking needs the right pair of shapes, facing each other, with the roll
// matching. Reuses Level 1's grabbing / rotating / clusters / sealing / finale.
import * as THREE from 'three';
import { Level1, v3, SNAP, TYPE } from './level1.js';
import { K } from './chain.js';
import { makeCartoon } from './cartoon.js';
import { RGROUP, rgroupOf } from './chemistry.js';
import { THEME } from './ui.js';
import { sfx } from './audio.js';
import { t as tr } from './i18n.js';

const FACE_DOT = -0.55;          // knob and socket axes must point at each other (within ~57 degrees)
const KEY_DOT = 0.77;            // tab and slot must line up (within ~40 degrees of roll)
const IFACE_DIST = 6.5;          // Angstrom: a residue is at an interface if it comes this close to the other chain
const MIN_IFACE = 8;             // an interface needs at least this many residues on each side
// one shape per interface: how many sides it has, and its name
const SHAPES = [
  { id: 'round', sides: 24 }, { id: 'square', sides: 4 }, { id: 'triangle', sides: 3 }, { id: 'hexagon', sides: 6 },
];
const IFACE_COLORS = ['#ffffff', '#ffd84d', '#b0ff4d', '#ff7bd5'];

const hexStr = (n) => '#' + n.toString(16).padStart(6, '0');
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/** rotation taking a shape's local frame (+Z = axis, +X = notch) onto the world-local vectors z and x */
function frameQuat(zDir, xDir) {
  const z = zDir.clone().normalize();
  const x = xDir.clone().addScaledVector(z, -xDir.dot(z)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** side faces of a regular prism (z0..z1); face k is centred on angle k*2pi/sides, so face 0 points along +X */
function prismWall(sides, r, z0, z1, skip = []) {
  const pos = [], idx = [], step = (Math.PI * 2) / sides;
  for (let k = 0; k < sides; k++) {
    if (skip.includes(k)) continue;
    const a0 = (k - 0.5) * step, a1 = (k + 0.5) * step, b = pos.length / 3;
    pos.push(r * Math.cos(a0), r * Math.sin(a0), z0, r * Math.cos(a1), r * Math.sin(a1), z0, r * Math.cos(a1), r * Math.sin(a1), z1, r * Math.cos(a0), r * Math.sin(a0), z1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** flat regular polygon at height z (fan from the centre) */
function polygonDisc(sides, r, z) {
  const pos = [0, 0, z], idx = [], step = (Math.PI * 2) / sides;
  for (let k = 0; k < sides; k++) { const a = (k - 0.5) * step; pos.push(r * Math.cos(a), r * Math.sin(a), z); }
  for (let k = 0; k < sides; k++) idx.push(0, 1 + k, 1 + ((k + 1) % sides));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export class Level2 extends Level1 {
  levelName() { return tr('level', { n: 2 }); }
  shapeName(f) { return tr('l2.shape.' + f.kind.id); }
  nextTarget() {
    const nxt = this.game.l2s[this.index + 1];
    return nxt ? { label: tr('next.item', { name: nxt.protein.name }), go: () => this.game.setLevel(2, this.index + 1) } : { label: tr('next.level', { n: 3 }), go: () => this.game.setLevel(3, 0) };
  }
  get joined() { return this.pieces.length - this.clusters.length; }   // docks done so far
  get completeTitle() { return tr(this.pieces.length > 2 ? 'l2.complex' : 'l2.docked.title'); }
  completeText() {
    const st = this.interfaceStats(), c = st.counts, br = this.bridgeKinds();
    const bonds = this.ifaces.reduce((n, f) => n + this.crossBonds(f.a, f.b), 0);
    return tr('l2.complete', {
      iface: this.ifaces.length > 1 ? tr('l2.ifaces.n', { n: this.ifaces.length }) : tr('l2.iface.one'), total: st.total,
      h: c.hydrophobic, p: c.polar, c: c.positive + c.negative, bonds,
      locks: br.inter ? tr('l2.locks', { n: br.inter }) : '', heme: this.ligandGroup ? tr('l2.more.heme') : '',
    });
  }
  ghostPaths() {
    return this.protein.pieces.map((d) => this.protein.data.residues.filter((r) => r.n >= d.from && r.n <= d.to));
  }

  // ------------------------------------------------------------------ construction
  /** no N/C connectors in Level 2: chains meet through their interface sites */
  _connector() { return { node: new THREE.Group(), mat: {}, glow: { opacity: 0 }, junction: -1, plug: false, free: true, done: true }; }

  /** cartoon with any number of helices / strands, built from the per-residue secondary structure */
  _buildCartoonTubes(chain, S, def) {
    const ss = this.protein.data.residues.filter((r) => r.n >= def.from && r.n <= def.to).map((r) => r.ss);
    const api = makeCartoon(chain.res, ss, S, def.color);
    chain.cartoonApi = api;
    chain.group.add(api.group);
    chain.kind = 'coil'; chain.ribbon.visible = false;   // Chain's own single ribbon is not used here
  }

  _buildPieces() {
    super._buildPieces();
    this._buildInterfaces();
  }

  /** find every interface between two chains and give both sides a site: patch spheres + a keyed shape */
  _buildInterfaces() {
    const data = this.protein.data.residues;
    const sets = this.pieces.map((p) => data.filter((r) => r.n >= p.def.from && r.n <= p.def.to));
    const pts = sets.map((rs) => rs.flatMap((r) => [v3(r.CA), v3(r.R)]));
    const dist = this.protein.ifaceDist || IFACE_DIST, minI = this.protein.minIface || MIN_IFACE; // per-complex tuning
    const near = (r, others) => { const a = v3(r.R), b = v3(r.CA); return others.some((q) => q.distanceTo(a) < dist || q.distanceTo(b) < dist); };
    this.ifaces = [];
    for (let i = 0; i < this.pieces.length; i++) for (let j = i + 1; j < this.pieces.length; j++) {
      const ri = sets[i].filter((r) => near(r, pts[j])), rj = sets[j].filter((r) => near(r, pts[i]));
      if (ri.length < minI || rj.length < minI) continue;
      this.ifaces.push({ id: this.ifaces.length, a: this.pieces[i], b: this.pieces[j], resA: ri, resB: rj });
    }
    const single = this.ifaces.length === 1;
    this.pieces.forEach((p) => { p.sites = []; });
    this.ifaces.forEach((f) => {
      const shape = SHAPES[f.id % SHAPES.length];
      f.kind = shape; f.color = IFACE_COLORS[f.id % IFACE_COLORS.length];
      const sa = this._makeSite(f, f.a, f.resA, true), sb = this._makeSite(f, f.b, f.resB, false);
      // shared docking axis (from chain a towards chain b) and a notch direction perpendicular to it, in the native frame
      const axis = sa.centre.clone().normalize().sub(sb.centre.clone().normalize()).normalize();
      const up = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const key = new THREE.Vector3().crossVectors(up, axis).normalize();
      sa.axis = axis.clone(); sb.axis = axis.clone().negate(); sa.key = key.clone(); sb.key = key.clone();
      f.sa = sa; f.sb = sb;
      for (const s of [sa, sb]) {
        s.piece.sites.push(s);
        this._buildSiteMeshes(s, shape, single ? new THREE.Color(s.piece.def.color || '#ffffff') : new THREE.Color(f.color));
      }
    });
    this._orientShapes();
  }

  _makeSite(f, p, iface, knob) {
    const local = iface.map((r) => v3(r.R).sub(p.chain.center).multiplyScalar(K)); // chain-local metres
    const c = new THREE.Vector3(); local.forEach((v) => c.add(v)); c.divideScalar(Math.max(1, local.length));
    return { iface: f, piece: p, residues: iface, local, centre: c, knob };
  }

  _buildSiteMeshes(s, shape, color) {
    const p = s.piece, iface = s.residues, local = s.local, c = s.centre;
    const grp = new THREE.Group();
    // glowing spheres (solid + soft halo), coloured by the residue chemistry
    const solid = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ toneMapped: false }), iface.length);
    const halo = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), iface.length);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    iface.forEach((r, k) => {
      col.setHex(RGROUP[rgroupOf(r.aa)].color);
      solid.setMatrixAt(k, m.compose(local[k], new THREE.Quaternion(), new THREE.Vector3().setScalar(0.0125)));
      halo.setMatrixAt(k, m.compose(local[k], new THREE.Quaternion(), new THREE.Vector3().setScalar(0.03)));
      solid.setColorAt(k, col); halo.setColorAt(k, col);
    });
    grp.add(solid, halo);
    // Keyed, complementary shapes. Shape frame: +Z = axis, +X = notch direction.
    //  knob   : a prism standing out of the chain, with a small TAB on its side
    //  socket : a cup with a closed bottom, opening towards the partner, with a SLOT (one wall face missing)
    // Docked, the knob sits in the socket and the tab passes through the slot - so the roll has to match as well.
    const fill = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const line = new THREE.LineBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.5), transparent: true, opacity: 0.95, toneMapped: false });
    const sh = new THREE.Group();
    const add = (geo, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, fill), edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), line);
      for (const o of [mesh, edge]) { o.position.set(x, y, z); sh.add(o); }
    };
    const N = shape.sides, H = 0.06, R_PEG = 0.054, R_CUP = 0.076, TAB = 0.027;   // ~35% larger than before: easier to see and aim at
    const apo = (r) => r * Math.cos(Math.PI / N);          // distance from the centre to a face
    if (s.knob) {
      add(prismWall(N, R_PEG, 0, H)); add(polygonDisc(N, R_PEG, H));                         // prism + cap
      add(new THREE.BoxGeometry(TAB, 0.03, H), apo(R_PEG) + TAB / 2 - 0.003, 0, H / 2);      // tab on face 0 (+X)
    } else {
      const skip = N > 8 ? [N - 1, 0, 1] : [0];                                                 // one face (or 3 narrow ones) missing
      add(prismWall(N, R_CUP, -H, 0, skip)); add(polygonDisc(N, R_CUP, -H));                  // walls with a slot + closed floor
    }
    grp.add(sh);
    s.shape = sh; s.sphereGrp = grp; s.halo = halo; s.fill = fill;
    p.chain.group.add(grp);
    sh.position.copy(c);
  }

  /** orient every site shape (needs the final axes / keys) */
  _orientShapes() {
    for (const f of this.ifaces) for (const s of [f.sa, f.sb]) s.shape.quaternion.copy(frameQuat(s.axis, s.key));
  }

  // ------------------------------------------------------------------ docking rules
  siteTip(s, out = new THREE.Vector3()) {
    const g = s.piece.chain.group;
    return out.copy(s.centre).multiplyScalar(this.S).applyQuaternion(g.quaternion).add(g.position);
  }
  siteAxis(s, out) { return out.copy(s.axis).applyQuaternion(s.piece.chain.group.quaternion); }
  siteKey(s, out) { return out.copy(s.key).applyQuaternion(s.piece.chain.group.quaternion); }

  /** how well two sites are lined up: knob / socket facing each other (axes opposite) and tab = slot (keys equal) */
  orientation(sa, sb) { return { face: this.siteAxis(sa, _v).dot(this.siteAxis(sb, _w)), key: this.siteKey(sa, _v).dot(this.siteKey(sb, _w)) }; }

  ifaceOf(a, b) { return this.ifaces.find((f) => (f.a === a && f.b === b) || (f.a === b && f.b === a)) || null; }

  /** site pairs (one per real interface) that face each other with the tab in line with the slot */
  compatPairs(clA, clB) {
    const out = [];
    for (const a of clA.pieces) for (const b of clB.pieces) {
      const f = this.ifaceOf(a, b);
      if (!f) continue;
      const o = this.orientation(f.sa, f.sb);
      if (o.face > FACE_DOT || o.key < KEY_DOT) continue;
      // pair order must follow (a in clA, b in clB) because callers use ta for the held cluster
      const sa = f.a === a ? f.sa : f.sb, sb = f.a === a ? f.sb : f.sa;
      out.push({ a, b, ja: f.id, ta: this.siteTip(sa), tb: this.siteTip(sb) });
    }
    return out;
  }

  /** dist between two chain centres when docked (metres) */
  nativeGap(a, b) { return a.off.distanceTo(b.off); }

  detectWrong(cl) {
    let wrong = null;
    for (const q of this.clusters) {
      if (q === cl) continue;
      for (const a of cl.pieces) for (const b of q.pieces) {
        const f = this.ifaceOf(a, b);
        if (f) { // the right pair of chains: is the orientation the problem?
          const o = this.orientation(f.sa, f.sb), td = this.siteTip(f.sa).distanceTo(this.siteTip(f.sb));
          if (o.face <= FACE_DOT && o.key < KEY_DOT && td < SNAP * 1.6) return { a, b, d: td, soft: true, reason: 'roll' };
          if (td < SNAP * 1.6 && o.face > FACE_DOT && !wrong) wrong = { a, b, d: td, soft: true, reason: 'face' };
        }
        // any other pair of sites brought together: the shapes don't match
        for (const sa of a.sites) for (const sb of b.sites) {
          if (f && sa.iface === f) continue;
          if (this.siteTip(sa).distanceTo(this.siteTip(sb)) < SNAP * 1.2 && this.siteAxis(sa, _v).dot(this.siteAxis(sb, _w)) < FACE_DOT) return { a, b, d: 0, soft: true, reason: 'shape', sa, sb };
        }
        const d = a.chain.group.position.distanceTo(b.chain.group.position), gap = this.nativeGap(a, b);
        if (d < gap * 0.62) wrong = { a, b, d, soft: false };
      }
    }
    return wrong;
  }

  explainWrong({ soft, reason, sa, sb }) {
    if (soft && reason === 'roll') this.say(tr('l2.roll.title'), tr('l2.roll'), 'warn');
    else if (soft && reason === 'shape') this.say(tr('l2.shape.title'), tr('l2.shape', { a: this.shapeName(sa.iface), b: this.shapeName(sb.iface) }), 'warn');
    else if (soft) this.say(tr('l2.face.title'), tr('l2.face'), 'warn');
    else this.say(tr('l2.collide.title'), tr('l2.collide'), 'bad');
  }

  // ------------------------------------------------------------------ docking
  shortName(p) { return p.def.short || p.def.label; }

  interfaceStats(list = this.ifaces) {
    const counts = { hydrophobic: 0, polar: 0, positive: 0, negative: 0, glycine: 0, proline: 0 };
    let total = 0;
    for (const f of list) for (const r of [...f.resA, ...f.resB]) { counts[rgroupOf(r.aa)]++; total++; }
    return { counts, total };
  }

  /** disulfide bridges between two chains and within a chain */
  bridgeKinds() {
    let inter = 0, intra = 0;
    for (const [a, b] of this.protein.data.disulfides) (this.pieceOf(a) !== this.pieceOf(b) ? inter++ : intra++);
    return { inter, intra };
  }

  extraCtx() {
    return { iface: this.interfaceStats(), ssb: this.bridgeKinds(), ifaces: this.ifaces.map((f) => ({ a: this.shortName(f.a), b: this.shortName(f.b), n: f.resA.length + f.resB.length })) };
  }

  connect(cl, other, ifaceId) {
    for (const p of cl.pieces) { p.blend = { pos: cl.pos.clone(), quat: cl.quat.clone(), t: 0 }; p.cluster = other; other.pieces.push(p); }
    this.clusters = this.clusters.filter((c) => c !== cl);
    const f = this.ifaces[ifaceId];
    sfx.good();
    this.game.bursts.spawn(this.siteTip(f.sa).add(this.siteTip(f.sb)).multiplyScalar(0.5), 0xffffff, 60, 1.1);
    this.pulse = null;
    if (this.clusters.length === 1) { this.complete(); return; }
    const st = this.interfaceStats([f]), c = st.counts, n = this.crossBonds(f.a, f.b);
    this.say(tr('l2.dock.title', { a: this.shortName(f.a), b: this.shortName(f.b), j: this.joined, n: this.nJ }),
      tr('l2.dock', { shape: this.shapeName(f), total: st.total, h: c.hydrophobic, p: c.polar, c: c.positive + c.negative, bonds: n }), 'good');
  }

  hint() {
    this.hints++;
    this.ghostUntil = this.t + 8;
    const f = this.ifaces.find((x) => x.a.cluster !== x.b.cluster) || this.ifaces[0];
    this.pulse = { iface: f.id, until: this.t + 6 };
    this.say(tr('hint'), tr('l2.hint', { a: this.shortName(f.a), b: this.shortName(f.b), shape: this.shapeName(f) }), 'warn');
  }

  reset() {
    super.reset();
    const many = this.pieces.length > 2;
    const rule = many ? tr('l2.start.many', { shapes: SHAPES.map((sh) => tr('l2.shape.' + sh.id)).join(', ') }) : tr('l2.start.two');
    this.say(tr('build.title', { level: this.levelName(), name: this.protein.name.toLowerCase(), id: this.protein.id }),
      tr('l2.start', { intro: this.protein.intro, input: this.game.inputHint(), rule }));
    for (const f of this.ifaces) for (const s of [f.sa, f.sb]) { s.shape.visible = true; s.sphereGrp.visible = true; }
  }

  setAA(v) {
    super.setAA(v);
    for (const p of this.pieces) p.chain.cartoonApi?.setTransparent(v);
  }

  update(dt, t, pointers, raycaster) {
    super.update(dt, t, pointers, raycaster);
    for (const f of this.ifaces) {
      const docked = f.a.cluster === f.b.cluster;
      const hint = this.pulse && this.pulse.until > t && this.pulse.iface === f.id;
      const prev = this.preview && this.preview.ja === f.id;
      const hot = (hint ? 1 : 0) + (prev ? 1 : 0);
      for (const s of [f.sa, f.sb]) {
        s.halo.material.opacity = docked ? 0.1 : 0.22 + 0.1 * Math.sin(t * 2.5) + hot * (0.25 + 0.15 * Math.sin(t * 9));
        s.fill.opacity = 0.45 + hot * 0.3;
        s.shape.visible = !docked && this.phase === 'play';
        s.sphereGrp.visible = this.phase === 'play';   // the interface highlights go away once the complex is built
      }
    }
  }

  // ------------------------------------------------------------------ panels
  drawSide(p) {
    const { w, g } = p;
    p.text(`${this.protein.name} · ${this.protein.id}`, 50, 34, { size: 44, weight: 800, color: THEME.border });
    p.text(this.protein.subtitle, 50, 100, { size: 27, color: THEME.dim, maxW: w - 100 });
    let y = 190;
    p.text(tr('l2.chains'), 50, y, { size: 28, color: THEME.dim, weight: 700 }); y += 42;
    const rowH = this.pieces.length > 3 ? 56 : 70;
    this.pieces.forEach((pc) => {
      const joined = pc.cluster.pieces.length > 1;
      const col = pc.def.color || TYPE[pc.def.type].color;
      g.fillStyle = col; g.fillRect(50, y + 6, 10, rowH - 22);
      p.text(pc.def.label, 76, y, { size: rowH < 60 ? 26 : 29, weight: 800, color: col });
      p.text(`${this.subOf(pc.def)}${joined ? tr('l2.docked') : ''}`, 76, y + (rowH < 60 ? 26 : 30), { size: rowH < 60 ? 22 : 25, color: joined ? THEME.good : THEME.dim });
      y += rowH;
    });
    y += 14;
    if (this.ifaces.length > 1) {
      p.text(tr('l2.matching'), 50, y, { size: 28, color: THEME.dim, weight: 700 }); y += 40;
      for (const f of this.ifaces) {
        const docked = f.a.cluster === f.b.cluster;
        p.text(`${this.shapeName(f)}: ${this.shortName(f.a)} ↔ ${this.shortName(f.b)}${docked ? '  ✓' : ''}`, 50, y, { size: 26, weight: 700, color: docked ? THEME.good : f.color }); y += 36;
      }
      y += 10;
    } else {
      p.text(tr('l2.patches'), 50, y, { size: 28, color: THEME.dim, weight: 700 }); y += 40;
      for (const k of ['hydrophobic', 'polar', 'positive', 'negative']) {
        g.fillStyle = hexStr(RGROUP[k].color); g.beginPath(); g.arc(64, y + 17, 12, 0, 7); g.fill();
        p.text(tr('rg.' + k), 90, y, { size: 26 }); y += 38;
      }
      y += 8;
    }
    p.text(tr('l2.sidehint'), 50, y, { size: 25, maxW: w - 100, lh: 1.2 }); y += 84;
    p.text(this.game.rotateHint(), 50, y, { size: 24, color: THEME.warn, maxW: w - 100, lh: 1.2 });
  }
}
