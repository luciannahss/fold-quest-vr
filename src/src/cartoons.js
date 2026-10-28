// Cartoon (backbone) views of the 12 Level 3 proteins, shared by the protein gallery and the quiz's reveal.
// Data files 'CRT1' are made by tools/make-cartoon.mjs, in the same frame and scale as src/surfaces/<name>.bin.
import * as THREE from 'three';
import { K } from './chain.js';
import { makeCartoon } from './cartoon.js';

const cartoonCache = new Map();
export function loadCartoon(id) {
  if (cartoonCache.has(id)) return cartoonCache.get(id);
  const p = fetch(new URL(`./cartoons/${id}.bin`, import.meta.url)).then((r) => r.arrayBuffer()).then((buf) => {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x31545243) throw new Error('bad cartoon file ' + id);
    const hl = dv.getUint32(4, true);
    const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)).replace(/\0+$/, ''));
    const n = head.n, pad4 = (x) => (x + 3) & ~3;
    let off = 8 + hl;
    const ca = new Int16Array(buf, off, n * 3); off += pad4(n * 6);
    const dn = new Int8Array(buf, off, n * 3); off += pad4(n * 3);
    const dc = new Int8Array(buf, off, n * 3); off += pad4(n * 3);
    const w = new Int8Array(buf, off, n * 3); off += pad4(n * 3);
    const ss = new Uint8Array(buf, off, n);
    return { n, segs: head.segs, ca, dn, dc, w, ss };
  });
  cartoonCache.set(id, p);
  return p;
}

/**
 * A THREE.Group with the cartoon of every segment, sized so that the protein's radius (radiusA Angstrom, from the surface
 * header) becomes `radiusM` metres - the same size as a surface mesh scaled by radiusM.
 */
export function makeCartoonGroup(data, radiusA, radiusM = 1, thick = 1) {
  const group = new THREE.Group();
  const s = radiusM / (radiusA * K);                     // display scale
  let i0 = 0;
  for (const [len] of data.segs) {
    const res = [], ssl = [];
    for (let i = i0; i < i0 + len; i++) {
      const CA = new THREE.Vector3(data.ca[i * 3] / 200, data.ca[i * 3 + 1] / 200, data.ca[i * 3 + 2] / 200);
      const N = CA.clone().add(new THREE.Vector3(data.dn[i * 3], data.dn[i * 3 + 1], data.dn[i * 3 + 2]).multiplyScalar(1 / 30));
      const C = CA.clone().add(new THREE.Vector3(data.dc[i * 3], data.dc[i * 3 + 1], data.dc[i * 3 + 2]).multiplyScalar(1 / 30));
      const O = C.clone().add(new THREE.Vector3(data.w[i * 3], data.w[i * 3 + 1], data.w[i * 3 + 2]).multiplyScalar(1 / 120));
      res.push({ N, CA, C, O });
      ssl.push(['C', 'H', 'E'][data.ss[i]]);
    }
    group.add(makeCartoon(res, ssl, s, null, { half: 0.026 * thick, radius: 0.0115 * thick }).group);   // ~1.2 A ribbon half-width, ~0.5 A coil radius
    i0 += len;
  }
  group.scale.setScalar(s);
  return group;
}

