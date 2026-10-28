globalThis.location = { search: '' }; globalThis.navigator = { language: 'en' };
// Checks the dictionaries: same keys in every language, every key used in the code exists, {params} match.
import fs from 'fs';
const L = {};
for (const c of ['en', 'es', 'pt']) L[c] = (await import(`../src/lang/${c}.js`)).default;
let bad = 0;
const fail = (m) => { console.log('✗', m); bad++; };
for (const c of ['es', 'pt']) {
  for (const k of Object.keys(L.en)) if (!(k in L[c])) fail(`${c} misses ${k}`);
  for (const k of Object.keys(L[c])) if (!(k in L.en)) fail(`${c} has extra ${k}`);
  for (const k of Object.keys(L.en)) {
    const a = L.en[k], b = L[c][k];
    if (typeof a !== 'string' || typeof b !== 'string') { if (Array.isArray(a) && a.length !== b?.length) fail(`${c} ${k}: array length`); continue; }
    const pa = [...a.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().filter((x, i, a) => a.indexOf(x) === i).join(), pb = [...b.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().filter((x, i, a) => a.indexOf(x) === i).join();
    if (pa !== pb) fail(`${c} ${k}: params {${pa}} vs {${pb}}`);
  }
}
// keys used in the code (literal ones)
const used = new Set();
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = d + '/' + f.name; if (f.isDirectory()) { if (f.name !== 'lang') walk(p); } else if (p.endsWith('.js')) scan(p); } };
const scan = (p) => { const s = fs.readFileSync(p, 'utf8'); for (const m of s.matchAll(/\b(?:tr|t)\(\s*'([\w.]+)'/g)) used.add(m[1]); for (const m of s.matchAll(/\b(?:tr|t)\(\s*`([\w.${}' +]+)`/g)) used.add('~' + m[1]); };
walk('src');
for (const k of used) if (!k.startsWith('~') && !k.endsWith('.') && k !== 'key' && !(k in L.en)) fail(`code uses missing key ${k}`);
// keys built at run time
const dyn = [];
for (const k of ['helix', 'strand', 'coil']) for (const f of ['name', 'lower', 'card', 'into', 'rule']) dyn.push(`kind.${k}.${f}`);
for (const k of ['helix', 'strand', 'coil']) dyn.push(`vessel.${k}.title`, `vessel.${k}.sub`);
for (let i = 0; i < 6; i++) dyn.push(`step.${i}.title`, `step.${i}.body`);
for (const k of ['helix', 'sheet', 'strand', 'coil']) dyn.push(`ok.${k}.title`);
for (const k of ['C', 'N']) dyn.push(`l1.wrong.${k}`);
for (const k of ['hydrophobic', 'polar', 'positive', 'negative', 'glycine', 'proline']) dyn.push(`rg.${k}`);
for (const k of ['round', 'square', 'triangle', 'hexagon']) dyn.push(`l2.shape.${k}`);
for (const k of ['defense', 'structure', 'communication', 'transport', 'enzyme', 'storage', 'tool']) dyn.push(`cat.${k}`);
const { POOL } = await import('../src/surfaces/info.js');
for (const id of Object.keys(POOL)) for (const f of ['name', 'clue', 'fact']) dyn.push(`pool.${id}.${f}`);
const { PROTEINS, COMPLEXES } = await import('../src/proteins/index.js');
for (const p of [...PROTEINS, ...COMPLEXES]) {
  dyn.push(`p.${p.id}.name`, `p.${p.id}.subtitle`, `p.${p.id}.intro`, `p.${p.id}.finish`);
  p.pieces.forEach((pc) => { dyn.push(`p.${p.id}.piece.${pc.id}`); if (COMPLEXES.includes(p)) dyn.push(`p.${p.id}.sub.${pc.id}`); });
  p.insights.forEach((_, i) => dyn.push(`p.${p.id}.ins${i}`));
  if (PROTEINS.includes(p)) dyn.push(`p.${p.id}.links`);
}
for (const k of dyn) if (!(k in L.en)) fail(`missing dynamic key ${k}`);
for (const h of fs.readFileSync('index.html', 'utf8').matchAll(/data-i18n(?:-html|-title)?="([\w.]+)"/g)) if (!(h[1] in L.en)) fail(`html uses missing key ${h[1]}`);
console.log(bad ? `${bad} problem(s)` : `ok: ${Object.keys(L.en).length} keys in 3 languages`);
