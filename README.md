# Fold Quest VR

**Play:** https://luciannahss.github.io/fold-quest-vr/ · **Teacher screen (group challenge):** https://luciannahss.github.io/fold-quest-vr/placar.html

A browser-based WebXR game that teaches **how proteins fold, assemble and work**, from secondary structure to quaternary structure and shape recognition, using real structures from the PDB. Built for **Meta Quest 3**; also playable on a flat screen. English, Spanish and Portuguese.

**Level 0 — From Sequence to Shape** (tutorial + first game)

1. A short guided intro shows the backbone (N–Cα–C=O, side chains as coloured spheres) and folds a demo chain into a helix,
   a two-strand sheet and a coil, with the **hydrogen bonds drawn as dotted lines** (as in the textbook figures).
2. Six unfolded sequences wait on a rack. Grab one and drop it into a vessel:
   * right shape → it folds (torsion angles animate) and stays; the coach explains which bonds hold it together
   * wrong shape → it tries, residues that don't fit glow red, then it is pushed back out; the coach explains why
3. Playing solo, the puzzle has **three stages, one structure at a time**: a single vessel (α-helix, then β-sheet, then coil) stands in the centre with the boards close by, and all six sequences are on the rack in every stage, so the ones for the other structures are distractors (dropping one in the wrong vessel counts as a mistake). Fill the vessel with its two sequences and press *Continue* (or wait a few seconds): the two sequences you placed go back to the rack, unfolded, and stay among the choices of the next stage. At the end the three vessels return side by side and every sequence folds into its own vessel. Stars depend on mistakes; **Hint** shows propensity bars. The group challenge's Level 0 puzzle uses the same stages (the teacher's live view follows the stage), with 240 s as the base time.

Every level's finish screen has a **Home** button: in VR it ends the session and brings back the start screen (mode, language, group room); on a flat screen it shows the start screen again.

**Sequence lab** (Level 0, free play; Options → *Lab*, or the *Sequence lab* button after finishing Level 0): build your own 9-residue sequence with the 20 amino-acid keys (coloured by chemistry), see the Chou–Fasman propensities for helix / sheet / coil and which shape each residue favours, then grab the chain and drop it into a vessel: it folds if the sequence prefers that shape, otherwise the game explains why not. *Example* and *Random* fill in a sequence; *Take it out* lets you try another vessel. Code: `src/lab.js`.

**Level 1 — Build real proteins** (structures from the PDB): crambin (1CRN, 5 pieces), ubiquitin (1UBQ, 7 pieces), then myoglobin (1MBN, 8 helix pieces), then green fluorescent protein (1EMA, 6 pieces: groups of β-strands and the central helix; its chromophore appears at the end)

The 46-residue crambin structure is cut at its secondary-structure boundaries into 5 pieces: β-strand 1 + loop (1–6),
α-helix 1 + loop (7–22), α-helix 2 + loop (23–31), β-strand 2 (32–35) and the C-terminal tail (36–46).
Pieces are drawn as a cartoon (helix ribbons, arrow-tipped strand ribbons, coil tubes); atoms appear only with **Show amino acids**. Each piece ends in colour-coded connector tips (**plug = C-end, ring = N-end**, attached to the chain end by a short neck). Bring a plug to the ring of
the same colour and the pieces snap into their native relative pose, and the coach explains the link. Wrong tips are rejected with a
reason. **Hint** shows a faint ghost of the final fold and lights up the next link. When all five pieces are joined, the three
disulfide bridges form and the fold locks. Spin a held piece with Q/E (tilt Z/X) or the thumbstick. Level buttons are in **Options**
(or open `?level=1&protein=3`).

Ubiquitin and myoglobin have no disulfides, so their finale shows the H-bond network instead; myoglobin also reveals its bound heme (extracted from the PDB `HETATM` records).

To add a protein: `node tools/prep-pdb.mjs data/XXXX.pdb A src/proteins/xxxx.js` (backbone atoms, computed H, R-group positions, S–S pairs),
then add an entry to `src/proteins/index.js` (cut list, display scale, junction text, insights, finale text). Loops attach to the preceding element.

**Level 2 — Quaternary structure** (complexes of several chains: insulin 3I40 with 2 chains, hemoglobin 4HHB with 4, and an antibody Fv bound to its antigen lysozyme, 1VFB, with 3)

Each chain is a rigid cartoon piece. The residues that touch the other chain form an **interface patch**: glowing spheres
coloured by chemistry (amber hydrophobic, green polar, cyan positive, pink negative). Each chain is a different colour. Chain A carries a round **knob with a tab**, chain B a matching **socket (closed
bottom) with a slot**. Turn the chains so knob and socket face each other, line up the tab with the slot (the roll matters too),
and bring them together to dock. Colliding surfaces count as a mistake; a near miss with the wrong orientation only gets a
hint. The finale shows the interface statistics, the H-bonds across it and the disulfide bridges that join the chains.
Interfaces are found automatically from the coordinates (a pair of chains with ≥ 8 touching residues on each side). With several
interfaces every one gets its own shape (round, square, triangle, hexagon) and colour, so a knob only fits the socket of the same shape;
docks can be done in any order, and the bound ligands (the four hemes of hemoglobin) appear at the finale.
A complex can tune interface detection with `ifaceDist` / `minIface` (the antibody uses 8 Å because antigen contacts are small).
Add a complex: generate data with `node tools/prep-pdb.mjs data/XXXX.pdb A,B,C,D src/proteins/xxxx.js` (later chains get residue
numbers +1000, +2000…) and add it to `COMPLEXES` in `src/proteins/index.js`; `?level=2` opens it.

**Protein gallery** (Level 3, free play; Options → *Protein gallery*, or the *Gallery* button after Level 3): browse the 12 proteins of the quiz, turn them around (grab and rotate), read what each one does and its size, and switch between the **Surface**, the **Cartoon** (helices cyan, strands magenta, coils yellow) or **Both** (a see-through surface around the cartoon). All proteins are shown at the same size. Code: `src/gallery.js`; the cartoons are compact backbone files `src/cartoons/<name>.bin` made by `node tools/make-cartoon.mjs --all` (same frame and scale as the surfaces, so they overlay exactly).

**Level 3 — Who's that protein?** (the last level)

A black shadow of a protein in surface form stands in front of a sunburst backdrop, like a "Who's that Pokémon?" screen. Four coloured
surface models stand in front of you. Grab one, rotate it to compare outlines (later rounds start turned around, the last two fully
rotated) and drop it into the shadow. A right guess turns the shadow into the coloured protein and tells you what it does (defense,
structure, communication, transport, enzymes, storage…); a wrong guess compares the two outlines (tall rod vs compact blob, size) and
the **Hint** button gives a function clue, then fades out a wrong choice. Eight rounds, from very different shapes to look-alike small
proteins: antibody IgG, ferritin, collagen, calcium pump SERCA, alpha-amylase, hemoglobin, GFP, insulin; lysozyme, myoglobin, ubiquitin
and crambin show up as distractors.

Surfaces are generated offline: `node tools/make-surface.mjs data/XXXX.pdb name [cells]` builds a smooth molecular surface (all heavy atoms,
Gaussian density + marching cubes + smoothing, with ambient occlusion baked into the vertex colours), orients it face-on (longest axis vertical, thinnest axis towards the viewer), colours it by
subunit and writes `src/surfaces/name.bin`. In the game the surfaces use a soft clay-like matcap material (independent of the scene lights) and a thin outline. Add the protein's text to `src/surfaces/info.js` (POOL) and use it in a round (ROUNDS).

## Languages
English, Spanish and Brazilian Portuguese. The language follows `?lang=es|pt|en`, then the saved choice, then the browser language. Switch it on the start screen or in-game under **Options → Language** (works inside VR; the current puzzle restarts, because its labels are re-drawn).
All texts live in `src/lang/en.js` (reference), `es.js`, `pt.js`; `src/i18n.js` has `t('key', {params})`. Protein texts are keys `p.<PDB id>.*` and `pool.<id>.*`, read through getters in `src/proteins/index.js` and `src/surfaces/info.js`. To add a protein or a language, add the keys, then run `node tools/test-i18n.mjs` (checks that every language has the same keys and `{params}`, and that every key used in the code exists).

## Group challenge
A class plays **Levels 0-3 together**: up to 4 headsets (teams) get the same puzzles at the same time, and a computer on a projector shows the room code, a **live 3D view of each team's table** (the headsets send the poses of their pieces about 8 times a second; the geometry is rebuilt on the teacher screen), what each team is doing, the results after each puzzle and the podium. Adapted, with permission, from the "Desafio em grupo" of [Encaixe Molecular VR](https://github.com/deborahantunes/encaixe-perfeito) by Deborah Antunes.

1. Start the room server: `npm run server` (port 8790; run `cd server && npm install` once). Serve the game as usual (`npm run serve`).
2. On the computer open `http://localhost:8080/placar.html` (teacher screen) and click **Create room**: a 4-digit code appears. Choose how many puzzles of each level to play (Level 0: fold the six sequences in three stages, without the tutorial; Level 1: crambin, ubiquitin, myoglobin; Level 2: insulin, hemoglobin, antibody; Level 3: the shadows) and the time per puzzle.
3. Each headset joins with the code: on the start screen before entering VR, in-game under **Options → Group challenge** (keypad), or with the link `?room=1234`. Each headset picks a team colour.
   While waiting in the lobby, a headset can press **Learn how to move (tutorial)** to practise with the first five steps of the Level 0 tutorial (grab and turn a molecule, read the boards). The teacher screen shows "practising with the tutorial…" on that team, and the practice ends by itself when the challenge starts.
4. Press **Start the challenge**. Everybody plays the same puzzle; the server runs the clock. Points: 100 for solving + up to 100 for speed + 50 for a clean run (no mistakes or hints) − 15 per mistake − 10 per hint (never below 50). Ties are broken by total time.

Level 3 shows the teacher screen only "Shadow n" (never the protein name), so the class cannot see the answer. Headsets only report their progress and the moment they finish; the server measures the time and computes the points. It does not re-check the puzzle itself (a Level 1 puzzle is assembled locally), so it is meant for a classroom, not for a competition with prizes.

On a Quest connected by USB, forward both ports: `adb reverse tcp:8080 tcp:8080 && adb reverse tcp:8790 tcp:8790` (the game then uses `ws://localhost:8790`). To use a server on the internet (for example [Render](https://render.com); `render.yaml` is included, root directory `server`) open the teacher screen and the game once with `?server=wss://your-server` (saved on each device), or set `DEFAULT_SERVER` in `src/net/room.js`. Set `ALLOWED_ORIGINS=https://your-site` on the server when the game is hosted on another domain. `npm run test:group` plays a short game against a local server.

## Publishing (GitHub Pages + Render)
The game and the teacher screen are static files: **Settings → Pages → Deploy from a branch → `main` / root** on the GitHub repository `luciannahss/fold-quest-vr` publishes them at https://luciannahss.github.io/fold-quest-vr/ (no build step).
The group server (`server/`) runs on [Render](https://render.com) (free): **New → Blueprint**, pick this repository; `render.yaml` sets root directory `server` and `ALLOWED_ORIGINS=https://luciannahss.github.io`. The game expects it at `wss://foldquest-group.onrender.com` (`DEFAULT_SERVER` in `src/net/room.js`; change it if Render gives the service another address, or open the pages once with `?server=wss://...`).
`data/` (raw PDB files used to regenerate the protein data and surfaces) is not published (see `.gitignore`).

## Modes
| Mode | How |
|---|---|
| Immersive VR | neon hex / checker floor world |
| Passthrough (MR) | Quest 3 mixed reality, molecules float in your room |
| Flat screen | mouse: drag to grab, wheel = push/pull (or zoom), drag background to look |

You can switch modes from the in-world **Options** board (left) or from the page. Floor style, height offset (seated/standing) and **Center** are there too: in VR, *Center* moves the whole scene to where you are and turns it to face where you are looking (use it after you walk or turn around). There is also a small **Center** button in the top-right corner of the left board in every level, so it is always within reach.

## Run
```bash
npm run serve        # http://localhost:8080  (any static server works)
```
WebXR needs a secure context. On the Quest:

* **USB**: `adb reverse tcp:8080 tcp:8080`, then open `http://localhost:8080` in the Quest Browser, **or**
* host the folder on any HTTPS static host (GitHub Pages, Netlify, ...).

Test without a headset: open `http://localhost:8080/?iwer` (Meta Quest 3 emulator) — `?dev` adds scripted-test helpers.

## How it works
| File | Role |
|---|---|
| `src/chemistry.js` | NeRF backbone builder from φ/ψ angles, H-bond detection, sheet-lane optimiser, Chou–Fasman propensities |
| `src/chain.js` | A foldable peptide: instanced atoms/bonds, ribbon, torsion interpolation, coil sampling |
| `src/vessels.js` | Template vessels built from the *same* geometry as the chains (so a correct chain fits exactly) |
| `src/cartoons.js` | loader and builder of the cartoon views (shared by the gallery and by the quiz reveal) |
| `src/gallery.js`, `src/cartoons/` | Level 3 protein gallery (surface / cartoon / both) and its backbone data (`tools/make-cartoon.mjs`) |
| `src/lab.js` | Level 0 sequence lab (keypad + analysis boards; reuses Level 0's chain, vessels and fold-or-reject logic) |
| `src/game.js` | Level 0 flow, grab/drop, fit-or-reject logic, feedback text, panels, level switching |
| `src/level1.js` | Level 1: pieces, connectors, cluster snapping, hints, disulfide finale |
| `src/level2.js`, `src/cartoon.js` | Level 2 (extends Level 1): interface patches, docking rules; static cartoon builder for multi-element chains |
| `src/level3.js`, `src/surfaces/` | Level 3 quiz and its data: `info.js` (texts, rounds) + generated `.bin` surface meshes (`tools/make-surface.mjs`) |
| `src/proteins/` | PDB-derived data (`tools/prep-pdb.mjs`) and the cut lists / teaching text per protein (`index.js`) |
| `src/group.js`, `src/net/`, `src/placar.js`, `src/placar-view.js`, `server/` | group challenge: headset side, client + shared texts, teacher screen (`placar.html`), room server (WebSocket) |
| `src/i18n.js`, `src/lang/` | translations (en / es / pt-BR) and the `t()` helper |
| `src/ui.js`, `src/hbonds.js`, `src/environment.js`, `src/audio.js` | 3D panels, dotted H-bonds, neon world, synthesised SFX |
| `src/main.js` | Renderer, XR sessions (VR/passthrough), flat-screen controls, controller rays, hand joints |

Everything chemically shown is computed: helix bonds are O(i)→H(i+4) at ~2.1 Å, sheet strands sit ~5 Å apart with 8 bonds between them.
Sequences are classified with Chou–Fasman propensities (`classifySequence`), so you can add new sequences to `SEQUENCES` in `game.js`.
