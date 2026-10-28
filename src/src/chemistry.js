// Backbone geometry from torsion angles (NeRF), residue data and hydrogen-bond detection.
// All coordinates here are in Angstrom; the renderer scales them to metres.
import * as THREE from 'three';

const D2R = Math.PI / 180;

// ---------------------------------------------------------------- residue data
// Chou-Fasman propensities: helix, sheet, turn/coil.
export const PROPENSITY = {
  A: [1.42, 0.83, 0.66], R: [0.98, 0.93, 0.95], N: [0.67, 0.89, 1.56], D: [1.01, 0.54, 1.46],
  C: [0.70, 1.19, 1.19], E: [1.51, 0.37, 0.74], Q: [1.11, 1.10, 0.98], G: [0.57, 0.75, 1.56],
  H: [1.00, 0.87, 0.95], I: [1.08, 1.60, 0.47], L: [1.21, 1.30, 0.59], K: [1.16, 0.74, 1.01],
  M: [1.45, 1.05, 0.60], F: [1.13, 1.38, 0.60], P: [0.57, 0.55, 1.52], S: [0.77, 0.75, 1.43],
  T: [0.83, 1.19, 0.96], W: [1.08, 1.37, 0.96], Y: [0.69, 1.47, 1.14], V: [1.06, 1.70, 0.50],
};
export const CLASS_INDEX = { helix: 0, strand: 1, coil: 2 };

export const RESIDUE_NAMES = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', E: 'Glu', Q: 'Gln', G: 'Gly', H: 'His', I: 'Ile',
  L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
};

// Side-chain chemistry groups, used for colouring the R spheres.
export const RGROUP = {
  hydrophobic: { color: 0xffb020, label: 'Hydrophobic', set: 'AVILMFWC' },
  polar: { color: 0x6ee05a, label: 'Polar', set: 'STNQYH' },
  positive: { color: 0x22d3ff, label: 'Positive (+)', set: 'KR' },
  negative: { color: 0xff5c8a, label: 'Negative (−)', set: 'DE' },
  glycine: { color: 0xf2f2f2, label: 'Glycine (just H)', set: 'G' },
  proline: { color: 0xd35cff, label: 'Proline (ring)', set: 'P' },
};
export function rgroupOf(aa) {
  for (const [k, v] of Object.entries(RGROUP)) if (v.set.includes(aa)) return k;
  return 'polar';
}

export function scoreSequence(seq) {
  const s = [0, 0, 0];
  for (const aa of seq) for (let i = 0; i < 3; i++) s[i] += PROPENSITY[aa][i];
  return s.map((v) => v / seq.length);
}
export function classifySequence(seq) {
  const s = scoreSequence(seq);
  return ['helix', 'strand', 'coil'][s.indexOf(Math.max(...s))];
}

// ---------------------------------------------------------------- torsion sets
export const TORSION = {
  helix: { phi: -57, psi: -47 },
  strand: { phi: -135, psi: 135 },
  ppii: { phi: -75, psi: 145 },
};

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- NeRF builder
const BOND = { NCA: 1.458, CAC: 1.525, CN: 1.329, CO: 1.231, NH: 1.01 };
const ANG = { CACN: 116.2 * D2R, CNCA: 121.7 * D2R, NCAC: 111.0 * D2R };

const _bc = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Vector3(), _ab = new THREE.Vector3();
function place(out, A, B, C, len, ang, tor) {
  _ab.subVectors(B, A);
  _bc.subVectors(C, B).normalize();
  _n.crossVectors(_ab, _bc).normalize();
  _m.crossVectors(_n, _bc);
  const x = -len * Math.cos(ang), y = len * Math.sin(ang) * Math.cos(tor), z = len * Math.sin(ang) * Math.sin(tor);
  out.copy(C).addScaledVector(_bc, x).addScaledVector(_m, y).addScaledVector(_n, z);
  return out;
}

/**
 * Build backbone + decoration atoms from phi/psi arrays (degrees).
 * Returns per-residue atoms {N, CA, C, O, H|null, R, hasH} in Angstrom. omega = 180.
 */
export function buildBackbone(seq, phi, psi) {
  const n = seq.length;
  const N = [], CA = [], C = [], Nnext = [];
  const v = () => new THREE.Vector3();
  const Cprev = v(), N0 = v(), CA0 = v();
  N0.set(0, 0, 0);
  CA0.set(BOND.NCA, 0, 0);
  Cprev.set(BOND.CN * Math.cos(ANG.CNCA), BOND.CN * Math.sin(ANG.CNCA), 0);
  let pC = Cprev, pN = N0, pCA = CA0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // N_i from (N_{i-1}, CA_{i-1}, C_{i-1}) via psi_{i-1}
      const Ni = place(v(), N[i - 1], CA[i - 1], C[i - 1], BOND.CN, ANG.CACN, psi[i - 1] * D2R);
      const CAi = place(v(), CA[i - 1], C[i - 1], Ni, BOND.NCA, ANG.CNCA, Math.PI);
      pN = Ni; pCA = CAi; pC = C[i - 1];
    }
    N.push(pN); CA.push(pCA);
    C.push(place(v(), pC, pN, pCA, BOND.CAC, ANG.NCAC, phi[i] * D2R));
  }
  // virtual next N for the last carbonyl
  const Nvirt = place(v(), N[n - 1], CA[n - 1], C[n - 1], BOND.CN, ANG.CACN, psi[n - 1] * D2R);
  const res = [];
  for (let i = 0; i < n; i++) {
    const Nn = i < n - 1 ? N[i + 1] : Nvirt;
    const bis = v().subVectors(C[i], CA[i]).normalize().add(v().subVectors(C[i], Nn).normalize()).normalize();
    const O = v().copy(C[i]).addScaledVector(bis, BOND.CO);
    const prevC = i === 0 ? Cprev : C[i - 1];
    const hasH = seq[i] !== 'P';
    let H = null;
    if (hasH) {
      const hb = v().subVectors(N[i], prevC).normalize().add(v().subVectors(N[i], CA[i]).normalize()).normalize();
      H = v().copy(N[i]).addScaledVector(hb, BOND.NH);
    }
    // C-beta (ProteinMPNN/Rosetta ideal formula), then push the R sphere a bit outwards
    const b = v().subVectors(CA[i], N[i]), c = v().subVectors(C[i], CA[i]), a = v().crossVectors(b, c);
    const CB = v().copy(CA[i]).addScaledVector(a, -0.58273431).addScaledVector(b, 0.56802827).addScaledVector(c, -0.54067466);
    const R = v().copy(CA[i]).addScaledVector(v().subVectors(CB, CA[i]), 1.25);
    res.push({ aa: seq[i], N: N[i], CA: CA[i], C: C[i], O, H, R, hasH });
  }
  return res;
}

// ---------------------------------------------------------------- hydrogen bonds
/** Find backbone C=O ... H-N bonds. chains: [{res:[atoms], tag}] in a shared coordinate frame. */
export function findHBonds(chains, maxDist = 2.55, minAngle = 125) {
  const out = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let ci = 0; ci < chains.length; ci++) {
    for (let cj = 0; cj < chains.length; cj++) {
      const A = chains[ci], B = chains[cj];
      for (let i = 0; i < A.length; i++) {
        const o = A[i].O;
        for (let j = 0; j < B.length; j++) {
          if (ci === cj && Math.abs(i - j) < 3) continue;
          const h = B[j].H;
          if (!h) continue;
          const d = o.distanceTo(h);
          if (d > maxDist) continue;
          a.subVectors(B[j].N, h); b.subVectors(o, h);
          const ang = Math.acos(THREE.MathUtils.clamp(a.dot(b) / (a.length() * b.length()), -1, 1)) / D2R;
          if (ang < minAngle) continue;
          out.push({ ci, i, cj, j, d });
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- fold frames
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/**
 * Orientation that maps a folded structure into the canonical frame:
 *   helix : axis -> +Y
 *   strand: axis -> +X, pleat normal -> +Y
 * Returns { quat, center } where center is the centroid of all heavy atoms (pre-rotation).
 */
export function foldFrame(res, kind) {
  const ca = res.map((r) => r.CA);
  const n = ca.length;
  const center = new THREE.Vector3();
  for (const r of res) center.add(r.CA).add(r.N).add(r.C).add(r.O);
  center.divideScalar(res.length * 4);
  const q = new THREE.Quaternion();
  if (kind === 'helix') {
    const axis = new THREE.Vector3();
    const rad = [];
    for (let i = 1; i < n - 1; i++) {
      rad.push(new THREE.Vector3().copy(ca[i - 1]).add(ca[i + 1]).addScaledVector(ca[i], -2).negate());
    }
    for (let i = 0; i < rad.length - 1; i++) axis.add(new THREE.Vector3().crossVectors(rad[i], rad[i + 1]));
    axis.normalize();
    if (new THREE.Vector3().subVectors(ca[n - 1], ca[0]).dot(axis) < 0) axis.negate();
    // roll: first radial vector (from axis to CA0) -> +X
    const r0 = new THREE.Vector3().subVectors(ca[0], center);
    r0.addScaledVector(axis, -r0.dot(axis)).normalize();
    _y.copy(axis); _x.copy(r0); _z.crossVectors(_x, _y);
    const m = new THREE.Matrix4().makeBasis(_x, _y, _z); // local->world of the fold; we need inverse
    q.setFromRotationMatrix(m).invert();
  } else if (kind === 'strand') {
    const ax = new THREE.Vector3().subVectors(ca[n - 1], ca[0]).normalize();
    const nrm = new THREE.Vector3();
    for (let i = 1; i < n - 1; i++) {
      const d = new THREE.Vector3().copy(ca[i]).multiplyScalar(2).sub(ca[i - 1]).sub(ca[i + 1]);
      nrm.addScaledVector(d, i % 2 ? 1 : -1);
    }
    nrm.addScaledVector(ax, -nrm.dot(ax)).normalize();
    // make CA_1 sit on the +normal side
    const side = new THREE.Vector3().subVectors(ca[1], center).dot(nrm);
    if (side < 0) nrm.negate();
    _x.copy(ax); _y.copy(nrm); _z.crossVectors(_x, _y);
    const m = new THREE.Matrix4().makeBasis(_x, _y, _z);
    q.setFromRotationMatrix(m).invert();
  }
  return { quat: q, center };
}

// ---------------------------------------------------------------- helpers shared by game code
/** Copy residues applying: p' = flipQ * frame.quat * (p - frame.center) + offset. */
export function transformRes(res, quat, center, offset = new THREE.Vector3()) {
  return res.map((r) => {
    const o = { aa: r.aa, hasH: r.hasH };
    for (const k of ['N', 'CA', 'C', 'O', 'H', 'R']) o[k] = r[k] ? r[k].clone().sub(center).applyQuaternion(quat).add(offset) : null;
    return o;
  });
}
const FLIP_Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
export const SHEET_FLIP = FLIP_Y;

function minHeavyDist(A, B) {
  let m = 99;
  for (const a of A) for (const b of B) for (const k of ['N', 'CA', 'C', 'O']) for (const l of ['N', 'CA', 'C', 'O']) m = Math.min(m, a[k].distanceTo(b[l]));
  return m;
}

/** Find lane spacing/shift that gives the best antiparallel ladder of H-bonds. Result in Angstrom. */
export function optimizeSheet() {
  const seq = 'VTVIYVTIV';
  const st = buildBackbone(seq, Array(9).fill(TORSION.strand.phi), Array(9).fill(TORSION.strand.psi));
  const fr = foldFrame(st, 'strand');
  const A = transformRes(st, fr.quat, fr.center);
  let best = null;
  for (let d = 4.2; d <= 6; d += 0.05) {
    for (let s = -7; s <= 7; s += 0.05) {
      const B = transformRes(st, FLIP_Y.clone().multiply(fr.quat), fr.center, new THREE.Vector3(s, 0, d));
      if (minHeavyDist(A, B) < 2.9) continue;
      const hb = findHBonds([A, B]).filter((b) => b.ci !== b.cj);
      const score = hb.length * 10 - hb.reduce((a, b) => a + b.d, 0);
      if (!best || score > best.score) best = { score, d, s, n: hb.length };
    }
  }
  return best;
}
