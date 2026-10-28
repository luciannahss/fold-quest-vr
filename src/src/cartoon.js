// Static cartoon of a rigid chain: helix ribbons, strand ribbons with arrowheads, and round tubes for coils.
// Unlike Chain's single ribbon this handles any number of secondary-structure elements per chain.
import * as THREE from 'three';
import { K } from './chain.js';

export const CARTOON_COLORS = { helix: '#38e8ff', strand: '#ff3df2', coil: '#ffd166' };

/** contiguous runs of the same secondary-structure letter ('H' or 'E') of at least minLen residues */
function runsOf(ss, letter, minLen) {
  const out = [];
  let i = 0;
  while (i < ss.length) {
    if (ss[i] !== letter) { i++; continue; }
    let j = i; while (j + 1 < ss.length && ss[j + 1] === letter) j++;
    if (j - i + 1 >= minLen) out.push([i, j]);
    i = j + 1;
  }
  return out;
}

function ribbonGeometry(res, half, arrow, sp = 6) {
  const n = res.length;
  const pts = res.map((r) => r.CA.clone().multiplyScalar(K));
  const ws = [];
  for (let i = 0; i < n; i++) {
    const w = new THREE.Vector3().subVectors(res[i].O, res[i].C).normalize();
    if (i > 0 && w.dot(ws[i - 1]) < 0) w.negate();
    ws.push(w);
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const ns = (n - 1) * sp + 1;
  const pos = new Float32Array(ns * 2 * 3), nor = new Float32Array(ns * 2 * 3), idx = [];
  const p = new THREE.Vector3(), tan = new THREE.Vector3(), w = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let s = 0; s < ns; s++) {
    const u = s / (ns - 1);
    curve.getPointAt(u, p); curve.getTangentAt(u, tan);
    const f = Math.min(u * (n - 1), n - 1.0001), i0 = Math.floor(f), t = f - i0;
    w.copy(ws[i0]).lerp(ws[i0 + 1], t);
    w.addScaledVector(tan, -w.dot(tan)).normalize();
    nn.crossVectors(tan, w).normalize();
    let hw = half;
    if (arrow) { const tA = u * (n - 1) - (n - 2); if (tA > 0) hw = half * 1.9 * (1 - Math.min(1, tA)); }
    pos.set([p.x + w.x * hw, p.y + w.y * hw, p.z + w.z * hw, p.x - w.x * hw, p.y - w.y * hw, p.z - w.z * hw], s * 6);
    nor.set([nn.x, nn.y, nn.z, nn.x, nn.y, nn.z], s * 6);
    if (s < ns - 1) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * res: residues of the chain in local Angstrom (like Chain.res); ss: 'H' | 'E' | 'C' per residue.
 * scale: the display scale of the owning group (keeps ribbon / tube widths constant in the world).
 */
export function makeCartoon(res, ss, scale = 1, base = null, widths = null) {
  const group = new THREE.Group();
  const mk = (color) => new THREE.MeshStandardMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: 0.22, roughness: 0.4, metalness: 0.05, side: THREE.DoubleSide });
  // base colour (a whole chain in one hue): helices as given, strands a little darker, coils a little lighter
  const shade = (hex, f) => { const c = new THREE.Color(hex); return f < 1 ? c.multiplyScalar(f) : c.lerp(new THREE.Color(0xffffff), f - 1); };
  const mats = base
    ? { helix: mk(shade(base, 1)), strand: mk(shade(base, 0.78)), coil: mk(shade(base, 1.18)) }
    : { helix: mk(CARTOON_COLORS.helix), strand: mk(CARTOON_COLORS.strand), coil: mk(CARTOON_COLORS.coil) };
  // widths follow the protein's size (local units ~ Angstrom), with a gentle boost for big, small-scale complexes so they stay visible
  // (widths = { half, radius } in the group's local metres overrides this: the gallery draws true-to-size ribbons)
  const half = widths?.half ?? 0.0235 * Math.pow(1.15 / scale, 0.15), radius = widths?.radius ?? 0.0083 * Math.pow(1.15 / scale, 0.4);
  const n = res.length;
  const elements = [];
  for (const [a, b] of runsOf(ss, 'H', 3)) elements.push({ type: 'helix', a, b });
  for (const [a, b] of runsOf(ss, 'E', 2)) elements.push({ type: 'strand', a, b });
  elements.sort((x, y) => x.a - y.a);
  for (const e of elements) group.add(new THREE.Mesh(ribbonGeometry(res.slice(e.a, e.b + 1), half, e.type === 'strand'), mats[e.type]));
  // coil: everything between the elements, extended one residue into each neighbour so the tube joins the ribbon
  let start = 0;
  const spans = [];
  for (const e of elements) { if (e.a > start) spans.push([start, e.a]); start = e.b; }
  if (start < n - 1 || !elements.length) spans.push([start, n - 1]);
  for (const [a, b] of spans) {
    const pts = res.slice(a, b + 1).map((r) => r.CA.clone().multiplyScalar(K));
    if (a === 0) pts.unshift(res[0].N.clone().multiplyScalar(K));          // run to the real chain ends
    if (b === n - 1) pts.push(res[n - 1].C.clone().multiplyScalar(K));
    if (pts.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 10, radius, 10, false), mats.coil));
    for (const p of [pts[0], pts[pts.length - 1]]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), mats.coil); cap.position.copy(p); group.add(cap); }
  }
  return {
    group,
    /** see-through cartoon while atoms are shown */
    setTransparent(v) { for (const m of [mats.helix, mats.strand]) { m.transparent = v; m.opacity = v ? 0.5 : 1; m.depthWrite = !v; m.needsUpdate = true; } },
  };
}
