import * as THREE from 'three';
import { buildBackbone, findHBonds, foldFrame, TORSION, classifySequence, scoreSequence } from '../src/chemistry.js';
const seq = 'AELLKEALK';
const mk = (s, t) => buildBackbone(s, Array(s.length).fill(t.phi), Array(s.length).fill(t.psi));
const h = mk(seq, TORSION.helix);
console.log('helix hbonds', findHBonds([h]).map(b => `O${b.i}-H${b.j} ${b.d.toFixed(2)}`).join(' | '));
const st = mk('VTVIYVTIV', TORSION.strand);
console.log('strand alone', findHBonds([st]).length);
// sheet search
function apply(res, fr, flip, off) {
  const q = fr.quat.clone();
  const flipQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), flip ? Math.PI : 0);
  return res.map(r => { const o = {}; for (const k of ['N','CA','C','O','H','R']) o[k] = r[k] ? r[k].clone().sub(fr.center).applyQuaternion(q).applyQuaternion(flipQ).add(off) : null; o.aa = r.aa; return o; });
}
const fr = foldFrame(st, 'strand');
let best = { n: -1 };
const A = apply(st, fr, false, new THREE.Vector3());
const minDist=(A,B)=>{let m=99;for(const a of A)for(const b of B)for(const k of ['N','CA','C','O'])for(const l of ['N','CA','C','O'])m=Math.min(m,a[k].distanceTo(b[l]));return m;};
for (let d = 4.0; d <= 6; d += 0.05) for (let s = -7; s <= 7; s += 0.05) {
  const B = apply(st, fr, true, new THREE.Vector3(s, 0, d));
  if (minDist(A,B) < 2.9) continue;
  const hb = findHBonds([A, B]).filter(b => b.ci !== b.cj);
  const score = hb.length * 10 - hb.reduce((a, b) => a + b.d, 0);
  if (score > best.score || best.n < 0) best = { n: hb.length, score, d, s, hb };
}
console.log('best sheet', best.n, best.d.toFixed(2), best.s.toFixed(2), best.hb.map(b=>`${b.ci}:${b.i}-${b.cj}:${b.j} ${b.d.toFixed(2)}`).join(' '));
// pleat sanity
console.log('CA y', A.map(r => r.CA.y.toFixed(1)).join(' '), 'z', A.map(r => r.CA.z.toFixed(1)).join(' '));
for (const s of ['AELLKEALK','KLMEELAQR','VTVIYVTIV','FYTVIWTYV','GPSNGDPGS','NGSPDTGKN']) console.log(s, classifySequence(s), scoreSequence(s).map(v=>v.toFixed(2)).join(' '));
