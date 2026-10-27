// Protein definitions for Level 1: the PDB-derived data (see tools/prep-pdb.mjs), how it is cut into
// pieces at secondary-structure boundaries, and the teaching text.  To add a protein: generate its data
// file, then add an entry here.  Pieces are listed N -> C; loops are attached to the preceding element.
import crambin from './crambin.js';
import ubiquitin from './ubiquitin.js';
import myoglobin from './myoglobin.js';
import insulin from './insulin.js';
import hemoglobin from './hemoglobin.js';
import antibody from './antibody.js';
import { t } from '../i18n.js';

export const PROTEINS = [
  {
    id: '1CRN',
    data: crambin,
    scale: 1.15,
    pieces: [
      { id: 'b1', type: 'strand', from: 1, to: 6, ribbon: [1, 4] },
      { id: 'h1', type: 'helix', from: 7, to: 22, ribbon: [7, 19] },
      { id: 'h2', type: 'helix', from: 23, to: 31, ribbon: [23, 30] },
      { id: 'b2', type: 'strand', from: 32, to: 35, ribbon: [32, 35] },
      { id: 'tail', type: 'coil', from: 36, to: 46, ribbon: null },
    ],
    insights: [
      { pieces: [0, 3] },
    ],
  },
  {
    id: '1UBQ',
    data: ubiquitin,
    scale: 0.82,
    pieces: [
      { id: 'b1', type: 'strand', from: 1, to: 9, ribbon: [1, 7] },
      { id: 'b2', type: 'strand', from: 10, to: 22, ribbon: [10, 17] },
      { id: 'h1', type: 'helix', from: 23, to: 39, ribbon: [23, 34] },
      { id: 'b3', type: 'strand', from: 40, to: 47, ribbon: [40, 45] },
      { id: 'b4', type: 'strand', from: 48, to: 55, ribbon: [48, 50] },
      { id: 'h2', type: 'helix', from: 56, to: 63, ribbon: [56, 59] },
      { id: 'b5', type: 'strand', from: 64, to: 76, ribbon: [64, 72] },
    ],
    insights: [
      { pieces: [0, 1] },
      { pieces: [0, 6] },
      { pieces: [2, 6] },
    ],
  },
  {
    id: '1MBN',
    data: myoglobin,
    scale: 0.6,
    pieces: [
      { id: 'hA', type: 'helix', from: 1, to: 19, ribbon: [3, 18] },
      { id: 'hB', type: 'helix', from: 20, to: 35, ribbon: [20, 35] },
      { id: 'hC', type: 'helix', from: 36, to: 50, ribbon: [36, 42] },
      { id: 'hD', type: 'helix', from: 51, to: 57, ribbon: [51, 57] },
      { id: 'hE', type: 'helix', from: 58, to: 85, ribbon: [58, 77] },
      { id: 'hF', type: 'helix', from: 86, to: 99, ribbon: [86, 94] },
      { id: 'hG', type: 'helix', from: 100, to: 124, ribbon: [100, 118] },
      { id: 'hH', type: 'helix', from: 125, to: 153, ribbon: [125, 148] },
    ],
    insights: [
      { pieces: [0, 6, 7] },
      { pieces: [4, 5] },
    ],
  },
];

// Level 2: complexes of several chains (quaternary structure). Each chain is one rigid piece; the interface
// patches are derived from the coordinates (residues within a few Angstrom of the other chain).
export const COMPLEXES = [
  {
    id: '3I40',
    data: insulin,
    scale: 1.05,
    pieces: [
      { id: 'A', type: 'helix', color: '#3f7bff', from: 1, to: 21 },
      { id: 'B', type: 'strand', color: '#ff6a3d', from: 1001, to: 1030 },
    ],
    insights: [],
  },
  {
    id: '4HHB',
    data: hemoglobin,
    scale: 0.55,
    pieces: [
      { id: 'a1', short: 'α1', type: 'helix', color: '#3f7bff', from: 1, to: 141 },
      { id: 'b1', short: 'β1', type: 'strand', color: '#ff7a2d', from: 1001, to: 1146 },
      { id: 'a2', short: 'α2', type: 'helix', color: '#9a6bff', from: 2001, to: 2141 },
      { id: 'b2', short: 'β2', type: 'strand', color: '#e0334d', from: 3001, to: 3146 },
    ],
    insights: [],
  },
  {
    id: '1VFB',
    data: antibody,
    scale: 0.6,
    ifaceDist: 8.0,   // antigen contacts are small: measure interfaces a little more generously
    pieces: [
      { id: 'vl', short: 'VL', type: 'helix', color: '#5b8bff', from: 1, to: 107 },
      { id: 'vh', short: 'VH', type: 'strand', color: '#ff7a2d', from: 1001, to: 1116 },
      { id: 'ag', short: 'Ag', type: 'coil', color: '#35c98a', from: 2001, to: 2129 },
    ],
    insights: [],
  },
];

// The texts live in src/lang/*.js (keys p.<id>.*); they are read through getters so a language change is picked up
// when the levels are rebuilt. Complex pieces carry a second line ("21 residues") under their name.
function localize(p, withSub) {
  const k = (f) => `p.${p.id}.${f}`;
  Object.defineProperties(p, {
    name: { get: () => t(k('name')), enumerable: true },
    subtitle: { get: () => t(k('subtitle')), enumerable: true },
    intro: { get: () => t(k('intro')), enumerable: true },
    junctionText: { get: () => t(k('links')) || [''], enumerable: true },
    finish: { get: () => (c) => t(k('finish'), c), enumerable: true },
  });
  p.insights.forEach((ins, i) => Object.defineProperty(ins, 'text', { get: () => t(k('ins' + i)), enumerable: true }));
  p.pieces.forEach((pc) => {
    Object.defineProperty(pc, 'label', { get: () => t(k('piece.' + pc.id)), enumerable: true });
    if (withSub) Object.defineProperty(pc, 'sub', { get: () => t(k('sub.' + pc.id)), enumerable: true });
  });
}
PROTEINS.forEach((p) => localize(p, false));
COMPLEXES.forEach((p) => localize(p, true));
