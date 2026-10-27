// A foldable peptide: instanced ball-and-stick backbone, coloured R groups, translucent ribbon.
import * as THREE from 'three';
import {
  buildBackbone, findHBonds, foldFrame, mulberry32, rgroupOf, RGROUP, TORSION,
} from './chemistry.js';

export const K = 0.022; // metres per Angstrom

const ATOM_COLORS = { N: 0x2540ff, CA: 0xc4c9d6, C: 0x8d93a3, O: 0xff3b3b, H: 0xffffff };
const RADII = { N: 0.0105, CA: 0.0105, C: 0.0105, O: 0.01, H: 0.0062 };
const PER_RES_ATOMS = 6; // N CA C O H R
const PER_RES_BONDS = 6; // N-CA, CA-C, C-N', C=O, N-H, CA-R

const D2R = Math.PI / 180;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function lerpAngle(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

// ----- shared geometry / materials
const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const atomMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1, emissive: 0x111118, emissiveIntensity: 1 });
const bondMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.0, emissive: 0x0a0c14 });
const letterCache = new Map();
function letterMaterial(ch) {
  if (letterCache.has(ch)) return letterCache.get(ch);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '800 92px system-ui, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 14; g.strokeStyle = 'rgba(4,6,18,0.95)'; g.strokeText(ch, 64, 70);
  g.fillStyle = '#ffffff'; g.fillText(ch, 64, 70);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  letterCache.set(ch, m);
  return m;
}

export function makeSeqLabel(seq, { width = 0.36, hex = true } = {}) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  g.font = '700 96px ui-monospace, Menlo, Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const step = 1024 / (seq.length + 0.6);
  for (let i = 0; i < seq.length; i++) {
    const grp = RGROUP[rgroupOf(seq[i])];
    g.fillStyle = '#' + grp.color.toString(16).padStart(6, '0');
    g.shadowColor = g.fillStyle; g.shadowBlur = 18;
    g.fillText(seq[i], step * (i + 0.8), 86);
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(width, width * 160 / 1024, 1);
  return sp;
}

// ----- random coil generation (rejection sampled: compact, clash free, no H-bonds)
export function sampleCoil(seq, seed, { compact = 9, maxDiam = 11.5, tries = 20000 } = {}) {
  const rnd = mulberry32(seed);
  const n = seq.length;
  let best = null;
  for (let t = 0; t < tries; t++) {
    const phi = [], psi = [];
    for (let i = 0; i < n; i++) {
      const gly = seq[i] === 'G';
      phi.push(gly && rnd() < 0.4 ? 60 + rnd() * 30 : -160 + rnd() * 110);
      const r = rnd();
      psi.push(r < 0.25 ? -60 + rnd() * 40 : r < 0.55 ? 100 + rnd() * 80 : r < 0.8 ? -40 + rnd() * 140 : 150 + rnd() * 60 - 120);
    }
    const res = buildBackbone(seq, phi, psi);
    let ok = true;
    for (let i = 0; i < n && ok; i++) for (let j = i + 3; j < n; j++) if (res[i].CA.distanceTo(res[j].CA) < 4.8) { ok = false; break; }
    if (!ok) continue;
    if (res[0].CA.distanceTo(res[n - 1].CA) > compact) continue;
    let diam = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) diam = Math.max(diam, res[i].CA.distanceTo(res[j].CA));
    if (diam > maxDiam) continue;
    if (findHBonds([res], 3.1, 100).length) continue;
    best = { phi, psi };
    break;
  }
  return best || { phi: Array(n).fill(-75), psi: Array(n).fill(145) };
}

export function ppiiTorsions(n, seed) {
  const rnd = mulberry32(seed);
  return {
    phi: Array.from({ length: n }, () => TORSION.ppii.phi + (rnd() - 0.5) * 24),
    psi: Array.from({ length: n }, () => TORSION.ppii.psi + (rnd() - 0.5) * 24),
  };
}

// A fixed shoelace / hairpin-like loop (found offline by tools/find-loop.mjs): elongated, flat,
// clash free and with NO hydrogen bonds. Every coil chain relaxes into this shape.
export const LOOP = {
  phi: [-157, -161, -109, -74, 65, -145, -92, -150, -160],
  psi: [147, -51, -28, -21, 56, 108, 144, -32, 101],
  quat: new THREE.Quaternion(-0.7332, -0.455, -0.0932, -0.4968),
};

const frameCache = new Map();
function frameFor(kind) {
  // backbone geometry is residue independent, so one cached frame per kind is enough
  if (frameCache.has(kind)) return frameCache.get(kind);
  const n = 9;
  const t = TORSION[kind];
  const res = buildBackbone('A'.repeat(n), Array(n).fill(t.phi), Array(n).fill(t.psi));
  const f = foldFrame(res, kind);
  frameCache.set(kind, f);
  return f;
}

export class Chain {
  /**
   * Level 0 chains fold by torsion interpolation. Pass `fixedRes` (residue atoms in Angstrom, e.g. from a PDB file)
   * to show a rigid piece of a real structure instead; `ribbonRange` limits the ribbon to [first, last] residue index.
   */
  constructor(seq, { seed = 1, unfolded = 'coil', id = seq, fixedRes = null, ribbonRange = null, kind = 'coil' } = {}) {
    this.seq = seq; this.id = id;
    this.n = seq.length;
    this.group = new THREE.Group();
    this.group.name = 'chain-' + id;
    this.unfoldedKind = unfolded;
    this.fixedRes = fixedRes;
    this.ribbonRange = ribbonRange;
    this.ribbonN = ribbonRange ? ribbonRange[1] - ribbonRange[0] + 1 : this.n;

    if (fixedRes) { this.unf = null; this.coilTarget = null; }
    else {
      this.unf = unfolded === 'ppii' ? ppiiTorsions(this.n, seed) : sampleCoil(seq, seed * 7919 + 13);
      this.coilTarget = LOOP;
    }

    this.kind = fixedRes ? kind : 'coil';  // fold target
    this.f = fixedRes ? 1 : 0;             // fold amount 0..1
    this.weights = Array(this.n).fill(1);
    this.flip = false;
    this.frameBlend = null;   // null => follow f
    this.stress = Array(this.n).fill(0);
    this.res = null;          // current residues in local Angstrom (centered)
    this.showR = true;        // draw side chains (R spheres + their bonds)
    this.dirty = true;
    this.glow = 0;

    this._buildMeshes();
    this.refresh();
  }

  _buildMeshes() {
    const nA = this.n * PER_RES_ATOMS, nB = this.n * PER_RES_BONDS;
    this.atoms = new THREE.InstancedMesh(sphereGeo, atomMat, nA);
    this.bonds = new THREE.InstancedMesh(cylGeo, bondMat, nB);
    for (const m of [this.atoms, this.bonds]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.atoms.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nA * 3), 3);
    this.bonds.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nB * 3), 3);
    this.rColors = [];
    for (let i = 0; i < this.n; i++) {
      const base = i * PER_RES_ATOMS;
      ['N', 'CA', 'C', 'O', 'H'].forEach((k, j) => this.atoms.setColorAt(base + j, _c.setHex(ATOM_COLORS[k])));
      const rc = new THREE.Color(RGROUP[rgroupOf(this.seq[i])].color);
      this.rColors.push(rc);
      this.atoms.setColorAt(base + 5, rc);
      for (let b = 0; b < PER_RES_BONDS; b++) this.bonds.setColorAt(i * PER_RES_BONDS + b, _c.setHex(b === 5 ? 0x8d97c0 : b === 3 ? 0xff8a8a : b === 4 ? 0xdfe6ff : 0xb9c4ee));
    }

    // labels
    this.labels = [];
    for (let i = 0; i < this.n; i++) {
      const s = new THREE.Sprite(letterMaterial(this.seq[i]));
      s.scale.setScalar(0.04);
      s.renderOrder = 5;
      this.group.add(s);
      this.labels.push(s);
    }
    this.seqLabel = makeSeqLabel(this.seq, { width: 0.19 });
    this.seqLabel.position.set(0, -0.135, 0);
    this.group.add(this.seqLabel);

    // ribbon
    this.samplesPer = 6;
    const ns = Math.max(1, this.ribbonN - 1) * this.samplesPer + 1;
    this.ribbonGeo = new THREE.BufferGeometry();
    this.ribbonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ns * 2 * 3), 3));
    this.ribbonGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(ns * 2 * 3), 3));
    const col = new Float32Array(ns * 2 * 3);
    for (let s = 0; s < ns; s++) {
      const t = s / (ns - 1);
      _c.setHSL(0.56 - t * 0.2, 0.9, 0.55);
      for (let k = 0; k < 2; k++) { col[(s * 2 + k) * 3] = _c.r; col[(s * 2 + k) * 3 + 1] = _c.g; col[(s * 2 + k) * 3 + 2] = _c.b; }
    }
    this.ribbonGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const idx = [];
    for (let s = 0; s < ns - 1; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.ribbonGeo.setIndex(idx);
    this.ribbon = new THREE.Mesh(this.ribbonGeo, new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, opacity: 0.62, side: THREE.DoubleSide, roughness: 0.4,
      emissive: 0x0e3552, emissiveIntensity: 1, depthWrite: false,
    }));
    this.ribbon.frustumCulled = false;
    this.group.add(this.ribbon);

    // grab bubble
    this.bubble = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.bubbleRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.1, 0.002, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.group.add(this.bubble, this.bubbleRing);
    this.hit = this.bubble; // raycast target
    this.hit.userData.chain = this;
  }

  /** size the grab bubble to enclose a piece of radius r (metres, before group scale) */
  fitBubble(r) { this.bubble.scale.setScalar(r / 0.1); this.bubbleRing.scale.setScalar(r / 0.1); }
  setBubble(visible) { this.bubble.visible = this.bubbleRing.visible = visible; }
  /** show / hide the side chains (R spheres and their bonds) */
  /** show / hide ALL atoms and bonds (backbone and side chains); the ribbon stays */
  setAtomsVisible(v) { this.atoms.visible = v; this.bonds.visible = v; }
  setSideChains(v) { this.showR = v; if (this.res) this._write(); }
  setLabels(v) { this.labels.forEach((l) => (l.visible = v)); }

  /** Torsions at the current fold amount. */
  torsions() {
    const tgt = this.kind === 'coil' ? this.coilTarget : { phi: Array(this.n).fill(TORSION[this.kind].phi), psi: Array(this.n).fill(TORSION[this.kind].psi) };
    const phi = [], psi = [];
    for (let i = 0; i < this.n; i++) {
      const t = THREE.MathUtils.clamp(this.f * this.weights[i], 0, 1);
      phi.push(lerpAngle(this.unf.phi[i], tgt.phi[i], t));
      psi.push(lerpAngle(this.unf.psi[i], tgt.psi[i], t));
    }
    return { phi, psi };
  }

  /** Orientation of the whole conformation: blend identity -> canonical fold frame. */
  frameQuat() {
    if (this.kind === 'coil') return new THREE.Quaternion().slerp(LOOP.quat, THREE.MathUtils.smoothstep(this.frameBlend ?? this.f, 0, 1));
    const fr = frameFor(this.kind);
    const target = this.flip ? new THREE.Quaternion().copy(SHEET_FLIP_Q).multiply(fr.quat) : fr.quat;
    const t = this.frameBlend ?? this.f;
    return new THREE.Quaternion().slerp(target, THREE.MathUtils.smoothstep(t, 0, 1));
  }

  refresh() {
    if (this.fixedRes) {
      if (!this.res) {
        const c = new THREE.Vector3();
        for (const r of this.fixedRes) c.add(r.CA).add(r.N).add(r.C).add(r.O);
        c.divideScalar(this.fixedRes.length * 4);
        this.center = c; // centroid in the source structure's frame (Angstrom)
        this.res = this.fixedRes.map((r) => {
          const o = { aa: r.aa, hasH: r.hasH };
          for (const k of ['N', 'CA', 'C', 'O', 'H', 'R']) o[k] = r[k] ? r[k].clone().sub(c) : null;
          return o;
        });
      }
      const show = this.kind !== 'coil' && this.ribbonN >= 2;
      this.ribbon.visible = show;
      if (!this.solidRibbon) this.ribbon.material.opacity = 0.62;
      this._write();
      return;
    }
    const { phi, psi } = this.torsions();
    const raw = buildBackbone(this.seq, phi, psi);
    const c = new THREE.Vector3();
    for (const r of raw) c.add(r.CA).add(r.N).add(r.C).add(r.O);
    c.divideScalar(raw.length * 4);
    // when folded into a canonical frame, use the canonical centre so chains line up in a slot
    const q = this.frameQuat().clone();
    const centered = raw.map((r) => {
      const o = { aa: r.aa, hasH: r.hasH };
      for (const k of ['N', 'CA', 'C', 'O', 'H', 'R']) o[k] = r[k] ? r[k].clone().sub(c).applyQuaternion(q) : null;
      return o;
    });
    this.res = centered;
    this.dirty = false;
    // the ribbon only fades in as the structure forms; a bare sequence stays clean
    // (never for coils: a ribbon would suggest a regular structure)
    const rv = this.kind === 'coil' ? 0 : THREE.MathUtils.smoothstep(this.f, 0.05, 0.6);
    this.ribbon.visible = rv > 0.01;
    this.ribbon.material.opacity = 0.62 * rv;
    this._write();
  }

  _bond(idx, a, b, radius, hide = false) {
    if (hide || !a || !b) { _m.makeScale(0, 0, 0); this.bonds.setMatrixAt(idx, _m); return; }
    _v1.subVectors(b, a);
    const len = _v1.length();
    _q.setFromUnitVectors(UP, _v1.multiplyScalar(1 / (len || 1)));
    _v2.copy(a).add(b).multiplyScalar(0.5 * K);
    _s.set(radius, len * K, radius);
    _m.compose(_v2, _q, _s);
    this.bonds.setMatrixAt(idx, _m);
  }

  _write() {
    const res = this.res;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const r = res[i];
      const base = i * PER_RES_ATOMS;
      const set = (j, p, rad) => {
        if (!p) { _m.makeScale(0, 0, 0); } else { _m.compose(_v1.copy(p).multiplyScalar(K), _q.identity(), _s.setScalar(rad)); }
        this.atoms.setMatrixAt(base + j, _m);
      };
      set(0, r.N, RADII.N); set(1, r.CA, RADII.CA); set(2, r.C, RADII.C); set(3, r.O, RADII.O); set(4, r.H, RADII.H);
      const gly = r.aa === 'G';
      set(5, this.showR ? r.R : null, gly ? 0.0085 : r.aa === 'P' ? 0.0185 : 0.0165);
      const bb = i * PER_RES_BONDS;
      this._bond(bb, r.N, r.CA, 0.0036);
      this._bond(bb + 1, r.CA, r.C, 0.0036);
      this._bond(bb + 2, r.C, res[i + 1]?.N, 0.0036, i === n - 1);
      this._bond(bb + 3, r.C, r.O, 0.0040);
      this._bond(bb + 4, r.N, r.H, 0.0026, !r.H);
      this._bond(bb + 5, r.CA, r.R, 0.0030, !this.showR);
      // label sits beyond the R sphere
      _v2.subVectors(r.R, r.CA).normalize();
      this.labels[i].position.copy(r.R).addScaledVector(_v2, gly ? 0.8 : 1.1).multiplyScalar(K);
      this.labels[i].scale.setScalar(gly ? 0.026 : 0.032);
      // stress tint
      const s = this.stress[i];
      _c.copy(this.rColors[i]).lerp(RED, s);
      this.atoms.setColorAt(base + 5, _c);
    }
    this.atoms.instanceMatrix.needsUpdate = true;
    this.bonds.instanceMatrix.needsUpdate = true;
    this.atoms.instanceColor.needsUpdate = true;
    this._writeRibbon();
  }

  _writeRibbon() {
    const res = this.ribbonRange ? this.res.slice(this.ribbonRange[0], this.ribbonRange[1] + 1) : this.res, n = res.length, sp = this.samplesPer;
    if (n < 2) return;
    const pts = res.map((r) => r.CA.clone().multiplyScalar(K));
    const ws = [];
    for (let i = 0; i < n; i++) {
      const w = new THREE.Vector3().subVectors(res[i].O, res[i].C).normalize();
      if (i > 0 && w.dot(ws[i - 1]) < 0) w.negate();
      ws.push(w);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const pos = this.ribbonGeo.attributes.position, nor = this.ribbonGeo.attributes.normal;
    const ns = (n - 1) * sp + 1;
    const p = new THREE.Vector3(), tan = new THREE.Vector3(), w = new THREE.Vector3(), nn = new THREE.Vector3();
    const half = this.ribbonHalf || 0.03;
    for (let s = 0; s < ns; s++) {
      const u = s / (ns - 1);
      curve.getPointAt(u, p);
      curve.getTangentAt(u, tan);
      const f = Math.min(u * (n - 1), n - 1.0001), i0 = Math.floor(f), t = f - i0;
      w.copy(ws[i0]).lerp(ws[i0 + 1], t);
      w.addScaledVector(tan, -w.dot(tan)).normalize();
      nn.crossVectors(tan, w).normalize();
      let hw = half;
      if (this.arrow && n >= 2) { // strand arrowhead: flare out over the last residue, then taper to a point
        const tA = u * (n - 1) - (n - 2);
        if (tA > 0) hw = half * 1.9 * (1 - Math.min(1, tA));
      }
      pos.setXYZ(s * 2, p.x + w.x * hw, p.y + w.y * hw, p.z + w.z * hw);
      pos.setXYZ(s * 2 + 1, p.x - w.x * hw, p.y - w.y * hw, p.z - w.z * hw);
      nor.setXYZ(s * 2, nn.x, nn.y, nn.z); nor.setXYZ(s * 2 + 1, nn.x, nn.y, nn.z);
    }
    pos.needsUpdate = true; nor.needsUpdate = true;
  }

  setRibbon(visible, opacity) { this.ribbon.visible = visible; if (opacity != null) this.ribbon.material.opacity = opacity; }

  /** Residues transformed to the parent (play-area) frame, in Angstrom. */
  worldRes() {
    const g = this.group;
    const q = g.quaternion;
    const inv = 1 / (K * g.scale.x); // scale cancels so chains of equal scale compare in true Angstrom
    return this.res.map((r) => {
      const o = { aa: r.aa, hasH: r.hasH };
      for (const k of ['N', 'CA', 'C', 'O', 'H', 'R']) o[k] = r[k] ? r[k].clone().applyQuaternion(q).addScaledVector(g.position, inv) : null;
      return o;
    });
  }

  tick(time) {
    // gentle breathing of the bubble ring
    const p = 1 + Math.sin(time * 2 + this.n) * 0.02;
    this.bubbleRing.scale.setScalar(p);
  }
}

const SHEET_FLIP_Q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const RED = new THREE.Color(0xff2244);

export { frameFor };
