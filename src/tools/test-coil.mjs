import { sampleCoil } from '../src/chain.js';
import { buildBackbone } from '../src/chemistry.js';
for (const seq of ['VTVIYVTIV','AELLKEALK','GPSNGDPGS','KLMEELAQR','NGSPDTGKN','FYTVIWTYV']) {
  const t=Date.now();
  for (const seed of [3,4,5,6,7,8]) {
    const r = sampleCoil(seq, seed*7919+13);
    const res = buildBackbone(seq, r.phi, r.psi);
    let d=0; for (const a of res) for (const b of res) d=Math.max(d,a.CA.distanceTo(b.CA));
    process.stdout.write(`${seq}/${seed}: diam ${d.toFixed(1)}  `);
  }
  console.log(Date.now()-t,'ms');
}
