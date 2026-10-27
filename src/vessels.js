// "Empty vessels": transparent plastic templates shaped like a helix, a sheet and a coil loop.
// Templates are built from the same torsion geometry the chains use, so a matching chain fits exactly.
import * as THREE from 'three';
import { buildBackbone, TORSION } from './chemistry.js';
import { K, frameFor, LOOP } from './chain.js';

const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const SHEET_TURN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

/** Ideal C-alpha path (metres), centred and oriented like a Chain's conformation. */
function idealPath(kind, flip = false) {
  const n = 9;
  const phi = kind === 'coil' ? LOOP.phi : Array(n).fill(TORSION[kind].phi);
  const psi = kind === 'coil' ? LOOP.psi : Array(n).fill(TORSION[kind].psi);
  const res = buildBackbone('A'.repeat(n), phi, psi);
  const c = new THREE.Vector3();
  for (const r of res) c.add(r.CA).add(r.N).add(r.C).add(r.O);
  c.divideScalar(n * 4);
  const q = kind === 'coil' ? LOOP.quat.clone() : frameFor(kind).quat.clone();
  if (flip) q.premultiply(FLIP);
  return res.map((r) => r.CA.clone().sub(c).applyQuaternion(q).multiplyScalar(K));
}

export function makeLabel(title, sub, color = '#38e8ff') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // long words (other languages) shrink to fit the 1024 px texture instead of being cut off
  const fit = (px, weight, str) => { g.font = `${weight} ${px}px system-ui, sans-serif`; const w = g.measureText(str).width; return w > 980 ? Math.floor(px * 980 / w) : px; };
  g.font = `800 ${fit(120, 800, title)}px system-ui, sans-serif`; g.fillStyle = color; g.shadowColor = color; g.shadowBlur = 30;
  g.fillText(title, 512, 100);
  g.shadowBlur = 0; g.font = `500 ${fit(54, 500, sub)}px system-ui, sans-serif`; g.fillStyle = '#b6c3ee';
  g.fillText(sub, 512, 205);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(1.0, 0.25, 1);
  return s;
}

const COLORS = {
  idle: new THREE.Color(0x4fd8ff), hover: new THREE.Color(0xffffff), good: new THREE.Color(0x4dff9a),
  bad: new THREE.Color(0xff3b5c), full: new THREE.Color(0x8fa0ff),
};

export class Vessel {
  /** kind: 'helix' | 'strand' | 'coil'; layout: {d, s} sheet spacing in Angstrom */
  constructor(kind, layout) {
    this.kind = kind;
    this.group = new THREE.Group();
    this.group.name = 'vessel-' + kind;
    this.rot = new THREE.Quaternion(); // extra orientation of the template (the sheet stands up)
    this.slots = [];
    this.state = 'idle';
    this.flash = 0;
    this.radius = 0.4; // capture radius (m)
    this.arrowMats = [];

    // transparent plastic: glossy, lightly tinted, see-through so the folded chain shows inside
    this.baseMat = new THREE.MeshPhysicalMaterial({
      color: COLORS.idle, emissive: COLORS.idle, emissiveIntensity: 0.1, transparent: true, opacity: 0.26,
      roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide, depthWrite: false,
    });
    this.lineMat = new THREE.LineBasicMaterial({ color: COLORS.idle, transparent: true, opacity: 0.9, toneMapped: false });

    if (kind === 'helix') this._buildHelix();
    else if (kind === 'strand') this._buildSheet(layout);
    else this._buildCoil();

    // emitter base + beam
    const base = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.02, 48), new THREE.MeshStandardMaterial({ color: 0x0b1030, emissive: 0x0a1a3a, roughness: 0.4, metalness: 0.6 }));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.006, 8, 64).rotateX(Math.PI / 2), this.lineMat);
    rim.position.y = 0.011;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.34, 0.5, 40, 1, true), new THREE.MeshBasicMaterial({ color: COLORS.idle, transparent: true, opacity: 0.035, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    beam.position.y = 0.25; this.beamMat = beam.material;
    base.add(disc, rim, beam);
    base.position.y = -0.3;
    this.group.add(base);
    this.base = base;
  }

  /** A plastic tube along `points` with rounded end caps; added to `parent`. */
  _tube(points, radius, parent) {
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, radius, 16, false), this.baseMat));
    for (const p of [points[0], points[points.length - 1]]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), this.baseMat);
      cap.position.copy(p); g.add(cap);
    }
    parent.add(g);
    return g;
  }

  _addSlot(pos, flip = false) { this.slots.push({ pos: pos.clone().applyQuaternion(this.rot), flip, chain: null }); }

  _buildHelix() {
    const path = idealPath('helix');
    for (const x of [-0.135, 0.135]) {
      const pos = new THREE.Vector3(x, 0, 0);
      this._tube(path, 0.036, this.group).position.copy(pos);
      this._addSlot(pos);
    }
    this.radius = 0.38;
  }

  _buildSheet(layout) {
    this.rot.copy(SHEET_TURN); // stand the sheet up so both strands face the viewer
    const body = new THREE.Group(); body.quaternion.copy(this.rot); this.group.add(body);
    const dA = layout.d * K, sA = layout.s * K;
    const A = idealPath('strand'), B = idealPath('strand', true);
    const posA = new THREE.Vector3(-sA / 2, 0, -dA / 2), posB = new THREE.Vector3(sA / 2, 0, dA / 2);
    for (const [path, pos, dir] of [[A, posA, 1], [B, posB, -1]]) {
      this._tube(path, 0.03, body).position.copy(pos);
      const arrowMat = new THREE.MeshBasicMaterial({ color: COLORS.idle, transparent: true, opacity: 0.85, toneMapped: false });
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.1, 16), arrowMat); // N -> C direction
      arrow.rotation.z = -dir * Math.PI / 2;
      arrow.position.copy(pos).add(new THREE.Vector3(dir * (0.255 + 0.06), 0, 0));
      body.add(arrow); this.arrowMats.push(arrowMat);
    }
    this._addSlot(posA); this._addSlot(posB, true);
    this.radius = 0.45;
  }

  _buildCoil() {
    // shoelace / hairpin loop: the tube follows the exact loop the coil chains relax into
    const path = idealPath('coil');
    for (const x of [-0.15, 0.15]) {
      const pos = new THREE.Vector3(x, 0, 0);
      this._tube(path, 0.036, this.group).position.copy(pos);
      this._addSlot(pos);
    }
    this.radius = 0.4;
  }

  get free() { return this.slots.find((s) => !s.chain) || null; }
  get full() { return !this.free; }
  get placed() { return this.slots.filter((s) => s.chain).length; }
  /** orientation chains take when they sit in this vessel */
  get worldQuat() { return this.group.quaternion.clone().multiply(this.rot); }

  worldSlotPos(slot, out = new THREE.Vector3()) { this.group.updateMatrix(); return out.copy(slot.pos).applyMatrix4(this.group.matrix); }

  setState(s, flash = 1) { this.state = s; this.flash = flash; }

  update(t, dt) {
    this.flash = Math.max(0, this.flash - dt * 1.3);
    let target = COLORS.idle, op = 1;
    if (this.state === 'hover') { target = COLORS.hover; op = 1.35; }
    else if (this.state === 'good') { target = COLORS.good; op = 1.5; }
    else if (this.state === 'bad') { target = COLORS.bad; op = 1.6; }
    else if (this.full) { target = COLORS.full; op = 0.85; }
    if ((this.state === 'good' || this.state === 'bad') && this.flash <= 0) this.state = 'idle';
    const k = Math.min(1, dt * 10);
    this.baseMat.color.lerp(target, k); this.baseMat.emissive.lerp(target, k);
    this.lineMat.color.lerp(target, k); this.beamMat.color.lerp(target, k);
    for (const m of this.arrowMats) m.color.lerp(target, k);
    this.baseMat.opacity = 0.26 * op + (this.state === 'idle' ? Math.sin(t * 2) * 0.01 : 0);
    this.baseMat.emissiveIntensity = 0.1 * op;
    this.beamMat.opacity = 0.035 * op;
  }
}
