// Build a compact molecular-surface mesh for the Level 3 quiz ("Who's that protein?").
// usage: node tools/make-surface.mjs <in.pdb> <outName> [maxCells=72]
// -> src/surfaces/<outName>.bin  (+ prints stats)
//
// Pipeline: all protein heavy atoms -> centre + PCA orientation (longest axis = Y, thinnest = Z = view direction)
// -> blobby density grid -> marching cubes -> Taubin smoothing -> per-vertex colour (by subunit, or an N->C gradient)
// -> quantised binary: header(JSON) + Int16 positions + Uint8 colours + Uint16/32 indices.
import fs from 'fs';
import { marchingCubes } from 'isosurface';

const [,, file, name, maxCellsArg] = process.argv;
const MAX_CELLS = +maxCellsArg || 88;
const RAD = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, FE: 1.5, ZN: 1.4 };

// ---------------------------------------------------------------- atoms (+ subunit index, residue fraction)
const atoms = [];
let sub = 0, lastRes = -1e9, lastChain = null, resCount = 0;
for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
  if (l.startsWith('TER') || l.startsWith('ENDMDL')) { sub++; lastRes = -1e9; lastChain = null; continue; }
  if (!l.startsWith('ATOM')) continue;
  if (l[16] !== ' ' && l[16] !== 'A') continue;
  const nm = l.slice(12, 16).trim();
  const el = (l.slice(76, 78).trim() || nm.replace(/[^A-Z]/g, '')[0]).toUpperCase();
  if (el === 'H' || el === 'D') continue;
  const res = parseInt(l.slice(22, 26)), ch = l[21];
  if (res < lastRes - 20 || (lastChain !== null && ch !== lastChain)) sub++; // a new chain without a TER record
  lastRes = res; lastChain = ch;
  atoms.push({ p: [parseFloat(l.slice(30, 38)), parseFloat(l.slice(38, 46)), parseFloat(l.slice(46, 54))], r: RAD[el] || 1.7, sub, res });
}
let nSub = 0; for (const a of atoms) nSub = Math.max(nSub, a.sub + 1);
// residue fraction (N->C) inside each subunit
const bySub = new Map();
for (const a of atoms) { const s = bySub.get(a.sub) || { min: 1e9, max: -1e9 }; s.min = Math.min(s.min, a.res); s.max = Math.max(s.max, a.res); bySub.set(a.sub, s); }
for (const a of atoms) { const s = bySub.get(a.sub); a.frac = s.max > s.min ? (a.res - s.min) / (s.max - s.min) : 0; }

// ---------------------------------------------------------------- centre + PCA orientation
const n = atoms.length;
const c = [0, 0, 0]; atoms.forEach((a) => { for (let i = 0; i < 3; i++) c[i] += a.p[i] / n; });
const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
atoms.forEach((a) => { const d = a.p.map((v, i) => v - c[i]); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j] / n; });
function jacobi(A) { // eigen decomposition of a symmetric 3x3
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], M = A.map((r) => r.slice());
  for (let it = 0; it < 60; it++) {
    let p = 0, q = 1, mx = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (Math.abs(M[i][j]) > mx) { mx = Math.abs(M[i][j]); p = i; q = j; }
    if (mx < 1e-10) break;
    const th = 0.5 * Math.atan2(2 * M[p][q], M[q][q] - M[p][p]), cs = Math.cos(th), sn = Math.sin(th);
    for (let k = 0; k < 3; k++) { const a = M[k][p], b = M[k][q]; M[k][p] = cs * a - sn * b; M[k][q] = sn * a + cs * b; }
    for (let k = 0; k < 3; k++) { const a = M[p][k], b = M[q][k]; M[p][k] = cs * a - sn * b; M[q][k] = sn * a + cs * b; }
    for (let k = 0; k < 3; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = cs * a - sn * b; V[k][q] = sn * a + cs * b; }
  }
  return { val: [M[0][0], M[1][1], M[2][2]], vec: [0, 1, 2].map((j) => [V[0][j], V[1][j], V[2][j]]) };
}
const eg = jacobi(cov);
const order = [0, 1, 2].sort((a, b) => eg.val[b] - eg.val[a]);
const e1 = eg.vec[order[0]], e2 = eg.vec[order[1]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const e3 = cross(e2, e1); // so that x = e2, y = e1, z = e3 is right-handed
const X = e2, Y = e1, Z = e3;
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
atoms.forEach((a) => { const d = a.p.map((v, i) => v - c[i]); a.q = [dot(d, X), dot(d, Y), dot(d, Z)]; });
// recentre on the bounding box
const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
atoms.forEach((a) => { for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], a.q[i]); hi[i] = Math.max(hi[i], a.q[i]); } });
const mid = lo.map((v, i) => (v + hi[i]) / 2);
atoms.forEach((a) => { a.q = a.q.map((v, i) => v - mid[i]); });

// ---------------------------------------------------------------- density grid
const PAD = 5;
const ext = lo.map((v, i) => hi[i] - v);
const h = Math.max(1.0, Math.max(ext[0], ext[1], ext[2]) / MAX_CELLS);
const min = ext.map((e) => -e / 2 - PAD), dims = ext.map((e) => Math.ceil((e + 2 * PAD) / h) + 1);
const grid = new Float32Array(dims[0] * dims[1] * dims[2]);
const B = 1.6, INFL = 1.35;   // wider, softer blobs: fills tiny crevices and gives a smooth, poster-like surface
for (const a of atoms) {
  const r = a.r + INFL, cut = r * 1.9;
  const i0 = a.q.map((v, k) => Math.max(0, Math.floor((v - cut - min[k]) / h))), i1 = a.q.map((v, k) => Math.min(dims[k] - 1, Math.ceil((v + cut - min[k]) / h)));
  for (let i = i0[0]; i <= i1[0]; i++) for (let j = i0[1]; j <= i1[1]; j++) for (let k = i0[2]; k <= i1[2]; k++) {
    const dx = min[0] + i * h - a.q[0], dy = min[1] + j * h - a.q[1], dz = min[2] + k * h - a.q[2];
    const d2 = dx*dx + dy*dy + dz*dz;
    if (d2 > cut * cut) continue;
    grid[(i * dims[1] + j) * dims[2] + k] += Math.exp(-B * (d2 / (r * r) - 1));
  }
}
const f = (x, y, z) => {
  const i = Math.round((x - min[0]) / h), j = Math.round((y - min[1]) / h), k = Math.round((z - min[2]) / h);
  return grid[(i * dims[1] + j) * dims[2] + k] - 1.0;
};
const iso = marchingCubes(dims, (x, y, z) => f(x, y, z), [[min[0], min[1], min[2]], [min[0] + (dims[0] - 1) * h, min[1] + (dims[1] - 1) * h, min[2] + (dims[2] - 1) * h]]);
// the library returns un-welded vertices: merge identical positions and drop degenerate triangles
const weld = new Map(); let P = []; const remap0 = new Int32Array(iso.positions.length);
iso.positions.forEach((p, i) => {
  const key = p[0].toFixed(3) + ',' + p[1].toFixed(3) + ',' + p[2].toFixed(3);
  let j = weld.get(key); if (j === undefined) { j = P.length; weld.set(key, j); P.push(p.slice()); }
  remap0[i] = j;
});
// (the library's winding is inverted: swap two indices so face normals point outwards)
let T = iso.cells.map((t) => t.map((v) => remap0[v])).filter(([a, b, c]) => a !== b && b !== c && a !== c).map(([a, b, c]) => [a, c, b]);
// keep only the largest connected component (drops stray droplets)
const adj = P.map(() => []);
for (const [a, b, d] of T) { adj[a].push(b, d); adj[b].push(a, d); adj[d].push(a, b); }
const comp = new Int32Array(P.length).fill(-1); let nc = 0; const sizes = [];
for (let s = 0; s < P.length; s++) { if (comp[s] >= 0) continue; const st = [s]; comp[s] = nc; let sz = 0; while (st.length) { const v = st.pop(); sz++; for (const w of adj[v]) if (comp[w] < 0) { comp[w] = nc; st.push(w); } } sizes.push(sz); nc++; }
let maxSz = 0; for (const sz of sizes) maxSz = Math.max(maxSz, sz);
const keepComps = new Set(sizes.map((sz, i) => [sz, i]).filter(([sz]) => sz > 0.05 * maxSz).map(([, i]) => i));
const remap = new Int32Array(P.length).fill(-1), P2 = [];
P.forEach((p, i) => { if (keepComps.has(comp[i])) { remap[i] = P2.length; P2.push(p); } });
T = T.filter(([a]) => remap[a] >= 0).map((t) => t.map((v) => remap[v]));
P = P2;
// Taubin smoothing
const nbr = P.map(() => new Set());
for (const [a, b, d] of T) { nbr[a].add(b).add(d); nbr[b].add(a).add(d); nbr[d].add(a).add(b); }
const smooth = (lam) => {
  const out = P.map((p, i) => { const ns = [...nbr[i]]; if (!ns.length) return p; const m = [0, 0, 0]; ns.forEach((j) => { for (let k = 0; k < 3; k++) m[k] += P[j][k] / ns.length; }); return p.map((v, k) => v + lam * (m[k] - v)); });
  P = out;
};
for (let it = 0; it < 14; it++) { smooth(0.5); smooth(-0.53); }

// ---------------------------------------------------------------- colours (nearest atom -> subunit / gradient)
const PAL = [[150, 214, 255], [170, 166, 255], [190, 236, 255], [146, 152, 238]];
const GRAD = [[150, 214, 255], [186, 160, 255]];
const cell = 6, hash = new Map();
atoms.forEach((a, i) => { const key = a.q.map((v) => Math.floor(v / cell)).join(','); (hash.get(key) || hash.set(key, []).get(key)).push(i); });
const colour = (p) => {
  const k0 = p.map((v) => Math.floor(v / cell)); let best = -1, bd = 1e9;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    for (const i of hash.get(`${k0[0] + dx},${k0[1] + dy},${k0[2] + dz}`) || []) { const q = atoms[i].q; const d = (q[0]-p[0])**2 + (q[1]-p[1])**2 + (q[2]-p[2])**2; if (d < bd) { bd = d; best = i; } }
  }
  if (best < 0) return [180, 200, 255];
  const a = atoms[best];
  if (nSub > 1) return PAL[a.sub % PAL.length];
  return GRAD[0].map((v, k) => Math.round(v + (GRAD[1][k] - v) * a.frac));
};
const C0 = P.map(colour);

// ---------------------------------------------------------------- baked ambient occlusion (darker in crevices)
const nrm = P.map(() => [0, 0, 0]);
for (const [a, b, d] of T) {
  const u = [P[b][0]-P[a][0], P[b][1]-P[a][1], P[b][2]-P[a][2]], v = [P[d][0]-P[a][0], P[d][1]-P[a][1], P[d][2]-P[a][2]];
  const nn = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  for (const i of [a, b, d]) for (let k = 0; k < 3; k++) nrm[i][k] += nn[k];
}
// outward direction: towards lower density
const grad = (p) => { const e = 1.0; return [f(p[0]+e,p[1],p[2]) - f(p[0]-e,p[1],p[2]), f(p[0],p[1]+e,p[2]) - f(p[0],p[1]-e,p[2]), f(p[0],p[1],p[2]+e) - f(p[0],p[1],p[2]-e)]; };
nrm.forEach((nv, i) => { const g = grad(P[i]); if (nv[0]*g[0] + nv[1]*g[1] + nv[2]*g[2] > 0) { nv[0] = -nv[0]; nv[1] = -nv[1]; nv[2] = -nv[2]; } const L = Math.hypot(...nv) || 1; nv[0] /= L; nv[1] /= L; nv[2] /= L; });
const DIRS = []; { const N = 24, ga = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < N; i++) { const z = 1 - (i + 0.5) / N, r = Math.sqrt(1 - z*z), th = i * ga; DIRS.push([r * Math.cos(th), r * Math.sin(th), z]); } } // hemisphere around +Z
const inside = (x, y, z) => { const i = Math.round((x - min[0]) / h), j = Math.round((y - min[1]) / h), k = Math.round((z - min[2]) / h); if (i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) return 0; return grid[(i * dims[1] + j) * dims[2] + k] > 1.0 ? 1 : 0; };
const AO = P.map((p, i) => {
  const n = nrm[i], up = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const tx = [up[1]*n[2]-up[2]*n[1], up[2]*n[0]-up[0]*n[2], up[0]*n[1]-up[1]*n[0]]; const tl = Math.hypot(...tx); tx.forEach((v, k) => (tx[k] = v / tl));
  const ty = [n[1]*tx[2]-n[2]*tx[1], n[2]*tx[0]-n[0]*tx[2], n[0]*tx[1]-n[1]*tx[0]];
  let occ = 0, tot = 0;
  for (const d of DIRS) {
    const dir = [tx[0]*d[0] + ty[0]*d[1] + n[0]*d[2], tx[1]*d[0] + ty[1]*d[1] + n[1]*d[2], tx[2]*d[0] + ty[2]*d[1] + n[2]*d[2]];
    for (const t of [2.5, 5, 8, 12]) { const w = 1 / (1 + t / 5); tot += w; if (inside(p[0] + n[0]*1.2 + dir[0]*t, p[1] + n[1]*1.2 + dir[1]*t, p[2] + n[2]*1.2 + dir[2]*t)) occ += w; }
  }
  return 1 - occ / tot;
});
const C = C0.map((c, i) => { const sh = 0.42 + 0.58 * Math.pow(Math.max(0, AO[i]), 0.9); return c.map((v) => Math.round(Math.min(255, v * sh * 1.08))); });

// ---------------------------------------------------------------- binary
let R = 0; for (const p of P) R = Math.max(R, Math.hypot(p[0], p[1], p[2]));
const nV = P.length, nI = T.length * 3, idx32 = nV > 65535;
const header = Buffer.from(JSON.stringify({ nV, nI, radius: +R.toFixed(2), ext: ext.map((v) => +v.toFixed(1)), idx32, atoms: n, subunits: nSub }));
const pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const pos = Buffer.alloc(nV * 6); P.forEach((p, i) => p.forEach((v, k) => pos.writeInt16LE(Math.round(v / R * 32767), i * 6 + k * 2)));
const col = Buffer.alloc(nV * 3); C.forEach((cc, i) => cc.forEach((v, k) => (col[i * 3 + k] = v)));
const ib = Buffer.alloc(nI * (idx32 ? 4 : 2)); T.flat().forEach((v, i) => (idx32 ? ib.writeUInt32LE(v, i * 4) : ib.writeUInt16LE(v, i * 2)));
const hdr = pad4(header), len = Buffer.alloc(8); len.writeUInt32LE(0x31465253, 0); len.writeUInt32LE(hdr.length, 4); // 'SRF1'
fs.mkdirSync('src/surfaces', { recursive: true });
fs.writeFileSync(`src/surfaces/${name}.bin`, Buffer.concat([len, hdr, pad4(pos), pad4(col), ib]));
console.log(`${name}: ${atoms.length} atoms, ${nSub} subunit(s), extent ${ext.map((v) => v.toFixed(0)).join('x')} A, grid ${dims.join('x')} h=${h.toFixed(2)} -> ${nV} verts, ${T.length} tris, ${(fs.statSync(`src/surfaces/${name}.bin`).size / 1024).toFixed(0)} KB`);
