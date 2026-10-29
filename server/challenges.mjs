// Group challenge rules shared by the room server and the browser (no imports: plain data + functions).
// A challenge is one puzzle of Level 0, 1, 2 or 3 played by every team at the same time.

export const MARKER = 'foldquest-group-v1';

/** Puzzles per level and the base time (seconds) each one gets. Level 0 is one puzzle; Level 3 rounds are the "Who's that protein?" shadows. */
export const LEVELS = {
  0: { names: ['sort'], seconds: [240] },   // Level 0: fold the six sequences in three stages (the tutorial is not part of it)
  1: { names: ['1CRN', '1UBQ', '1MBN', '1EMA'], seconds: [240, 330, 420, 360] },
  2: { names: ['3I40', '4HHB', '1VFB'], seconds: [180, 360, 300] },
  3: { names: ['igg', 'ferritin', 'collagen', 'serca', 'amylase', 'hemoglobin', 'gfp', 'insulin'], seconds: [90, 90, 90, 90, 90, 90, 90, 90] },
};
export const SCALES = [1, 1.5, 2];            // time multiplier the teacher can choose
export const TEAMS = 4;
export const TEAM_COLORS = ['#3b82ff', '#ff4a4a', '#2fd49a', '#ffd23f'];
export const TEAM_NAMES = ['Blue', 'Red', 'Green', 'Yellow'];   // translated on screen (key team.<name>)

/** plan = { 0: n0, 1: n1, 2: n2, 3: n3 } (how many puzzles of each level; 0 or missing = skip the level) -> ordered challenge list */
export function challengeList(plan, scale = 1) {
  const out = [];
  for (const level of [0, 1, 2, 3]) {
    const L = LEVELS[level];
    const n = Math.max(0, Math.min(L.names.length, Math.floor(Number(plan?.[level]) || 0)));
    for (let idx = 0; idx < n; idx++) out.push({ id: `${level}-${idx}`, level, idx, name: L.names[idx], seconds: Math.round(L.seconds[idx] * scale) });
  }
  return out;
}

export function validPlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  let total = 0;
  for (const level of [0, 1, 2, 3]) {
    const n = plan[level] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > LEVELS[level].names.length) return false;
    total += n;
  }
  return total > 0;
}

/** Points for a solved challenge: 100 + up to 100 for speed + 50 for a clean run - 15 per mistake - 10 per hint (never below 50). */
export function roundPoints(elapsedMs, seconds, mistakes, hints = 0) {
  const left = Math.max(0, 1 - elapsedMs / (seconds * 1000));
  const pts = 100 + Math.round(100 * left) + (mistakes === 0 && hints === 0 ? 50 : 0) - Math.min(60, mistakes * 15) - Math.min(30, hints * 10);
  return Math.max(50, pts);
}

/** Ranking: points, then less total time, then team order. Works on server teams and on snapshot teams. */
export function ranking(teams) {
  return teams.filter((x) => x.claimed).sort((a, b) => b.score - a.score || a.totalMs - b.totalMs || a.index - b.index);
}
