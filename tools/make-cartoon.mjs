// Backbone data for the Level 3 protein gallery's cartoon view, in the SAME frame as the matching surface
// (src/surfaces/<name>.bin): atoms are centred, rotated to the principal axes and re-centred exactly like
// tools/make-surface.mjs does, so a cartoon drawn at the surface's scale sits inside its surface.
// usage: node tools/make-cartoon.mjs <in.pdb> <name>      -> src/cartoons/<name>.bin
//        node tools/make-cartoon.mjs --all                (every gallery protein, see LIST)
//
// File 'CRT1': u32 magic, u32 header length, header JSON padded to 4 bytes, then (n residues)
//   Int16 CA x3 (1/200 A) | Int8 N-CA x3 (1/30 A) | Int8 C-CA x3 (1/30 A) | Int8 unit(O-C) x3 (1/120) | Uint8 ss (0 coil, 1 helix, 2 strand)
// Header: { n, segs: [[length, subunit], ...] } - chains are split into segments wherever residues are missing.
import fs from 'fs';

const LIST = {
  igg: 'data/l3/1IGT.pdb', ferritin: 'data/l3/1FHA.pdb1', collagen: 'data/l3/1BKV.pdb', serca: 'data/l3/1SU4.pdb',
  amylase: 'data/l3/1PPI.pdb', hemoglobin: 'data/4HHB.pdb', gfp: 'data/l3/1EMA.pdb', insulin: 'data/3I40.pdb',
  lysozyme: 'data/l3/2LZT.pdb', myoglobin: 'data/1MBN.pdb', ubiquitin: 'data/1UBQ.pdb', crambin: 'data/1CRN.pdb',
};
const jobs = process.argv[2] === '--all' ? Object.entries(LIST).map(([name, file]) => [file, name]) : [[process.argv[2], process.argv[3]]];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function jacobi(A) { // eigen decomposition of a symmetric 3x3 (same routine as make-surface)
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

function build(file, name) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  // ---- atoms, subunit counting and residues, exactly as make-surface reads them
  const heavy = [];             // for the frame
  const residues = [];          // { sub, chain, num, atoms: {N,CA,C,O} }
  let sub = 0, lastRes = -1e9, lastChain = null, cur = null, curKey = '';
  for (const l of lines) {
    if (l.startsWith('TER') || l.startsWith('ENDMDL')) { sub++; lastRes = -1e9; lastChain = null; continue; }
    if (!l.startsWith('ATOM')) continue;
    if (l[16] !== ' ' && l[16] !== 'A') continue;
    const nm = l.slice(12, 16).trim();
    const el = (l.slice(76, 78).trim() || nm.replace(/[^A-Z]/g, '')[0]).toUpperCase();
    if (el === 'H' || el === 'D') continue;
    const res = parseInt(l.slice(22, 26)), ch = l[21];
    if (res < lastRes - 20 || (lastChain !== null && ch !== lastChain)) sub++;
    lastRes = res; lastChain = ch;
    const p = [parseFloat(l.slice(30, 38)), parseFloat(l.slice(38, 46)), parseFloat(l.slice(46, 54))];
    heavy.push(p);
    const key = `${sub}|${ch}|${l.slice(22, 27)}`;
    if (key !== curKey) { curKey = key; cur = { sub, chain: ch, num: res, atoms: {} }; residues.push(cur); }
    if (['N', 'CA', 'C', 'O'].includes(nm) && !cur.atoms[nm]) cur.atoms[nm] = p;
  }
  // ---- the surface's frame: centre, principal axes (X = 2nd, Y = longest, Z = thinnest), bounding-box centre
  const n = heavy.length;
  const c = [0, 0, 0]; heavy.forEach((a) => { for (let i = 0; i < 3; i++) c[i] += a[i] / n; });
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  heavy.forEach((a) => { const d = a.map((v, i) => v - c[i]); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j] / n; });
  const eg = jacobi(cov);
  const order = [0, 1, 2].sort((a, b) => eg.val[b] - eg.val[a]);
  const e1 = eg.vec[order[0]], e2 = eg.vec[order[1]], e3 = cross(e2, e1);
  const X = e2, Y = e1, Z = e3;
  const rot = (p) => { const d = p.map((v, i) => v - c[i]); return [dot(d, X), dot(d, Y), dot(d, Z)]; };
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  heavy.forEach((a) => { const q = rot(a); for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], q[i]); hi[i] = Math.max(hi[i], q[i]); } });
  const mid = lo.map((v, i) => (v + hi[i]) / 2);
  const tr = (p) => rot(p).map((v, i) => v - mid[i]);
  // the frame must be the surface's: its header says how many atoms it used
  const sf = `src/surfaces/${name}.bin`;
  if (fs.existsSync(sf)) {
    const b = fs.readFileSync(sf), hl = b.readUInt32LE(4), h = JSON.parse(b.slice(8, 8 + hl).toString().replace(/\0+$/, ''));
    if (h.atoms !== n) console.warn(`  ! ${name}: ${n} atoms here but the surface used ${h.atoms}`);
  }
  // ---- secondary structure from HELIX / SHEET records (chain + residue number)
  const ss = new Map();
  for (const l of lines) {
    if (l.startsWith('HELIX')) for (let k = parseInt(l.slice(21, 25)); k <= parseInt(l.slice(33, 37)); k++) ss.set(`${l[19]}${k}`, 1);
    else if (l.startsWith('SHEET')) for (let k = parseInt(l.slice(22, 26)); k <= parseInt(l.slice(33, 37)); k++) ss.set(`${l[21]}${k}`, 2);
  }
  // ---- residues -> segments (split at big gaps (> 9 A: one or two missing residues are bridged) and at subunit borders)
  const good = residues.filter((r) => r.atoms.N && r.atoms.CA && r.atoms.C && r.atoms.O).map((r) => {
    const t = Object.fromEntries(Object.entries(r.atoms).map(([k, v]) => [k, tr(v)]));
    return { sub: r.sub, CA: t.CA, N: t.N, C: t.C, O: t.O, ss: ss.get(`${r.chain}${r.num}`) || 0 };
  });
  const segs = []; let run = [];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const r of good) {
    const prev = run[run.length - 1];
    if (prev && (prev.sub !== r.sub || dist(prev.CA, r.CA) > 9.0)) { if (run.length >= 3) segs.push(run); run = []; }
    run.push(r);
  }
  if (run.length >= 3) segs.push(run);
  const flat = segs.flat(), m = flat.length;
  const header = Buffer.from(JSON.stringify({ n: m, segs: segs.map((s) => [s.length, s[0].sub]) }));
  const pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const ca = Buffer.alloc(m * 6), dn = Buffer.alloc(m * 3), dc = Buffer.alloc(m * 3), w = Buffer.alloc(m * 3), sb = Buffer.alloc(m);
  const clamp8 = (v) => Math.max(-127, Math.min(127, Math.round(v)));
  flat.forEach((r, i) => {
    r.CA.forEach((v, k) => ca.writeInt16LE(Math.round(v * 200), i * 6 + k * 2));
    for (let k = 0; k < 3; k++) {
      dn.writeInt8(clamp8((r.N[k] - r.CA[k]) * 30), i * 3 + k);
      dc.writeInt8(clamp8((r.C[k] - r.CA[k]) * 30), i * 3 + k);
    }
    const o = [r.O[0] - r.C[0], r.O[1] - r.C[1], r.O[2] - r.C[2]], L = Math.hypot(...o) || 1;
    for (let k = 0; k < 3; k++) w.writeInt8(clamp8(o[k] / L * 120), i * 3 + k);
    sb[i] = r.ss;
  });
  const hdr = pad4(header), head = Buffer.alloc(8); head.writeUInt32LE(0x31545243, 0); head.writeUInt32LE(hdr.length, 4); // 'CRT1'
  fs.mkdirSync('src/cartoons', { recursive: true });
  const out = Buffer.concat([head, hdr, pad4(ca), pad4(dn), pad4(dc), pad4(w), sb]);
  fs.writeFileSync(`src/cartoons/${name}.bin`, out);
  const frac = (k) => (flat.filter((r) => r.ss === k).length / m * 100).toFixed(0);
  console.log(`${name}: ${m} residues in ${segs.length} segment(s), ${new Set(flat.map((r) => r.sub)).size} subunit(s), helix ${frac(1)}% strand ${frac(2)}%, ${(out.length / 1024).toFixed(1)} KB`);
}

for (const [file, name] of jobs) build(file, name);
