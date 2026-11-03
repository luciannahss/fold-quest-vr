// Group challenge rules shared by the room server and the browser (no imports: plain data + functions).
// A challenge is one puzzle of Level 0, 1, 2 or 3 played by every team at the same time.

export const MARKER = 'foldquest-group-v1';

/** Puzzles per level and the base time (seconds) each one gets. Level 0 is one puzzle; Level 3 rounds are the "Who's that protein?" shadows. */
export const LEVELS = {
  0: { names: ['sort'], seconds: [240] },   // Level 0: fold the six sequences in three stages (the tutorial is not part of it)
  1: { names: ['1CRN', '1UBQ', '1MBN', '1EMA'], seconds: [240, 330, 420, 360] },
  2: { names: ['3I40', '1VFB', '4HHB'], seconds: [180, 300, 360] },
  3: { names: ['igg', 'ferritin', 'collagen', 'serca', 'amylase', 'hemoglobin', 'gfp', 'insulin'], seconds: [30, 30, 30, 30, 30, 30, 30, 30] },
};
export const SCALES = [1, 1.5, 2];            // time multiplier the teacher can choose
export const TEAMS = 4;
export const TEAM_COLORS = ['#3b82ff', '#ff4a4a', '#2fd49a', '#ffd23f'];
export const TEAM_NAMES = ['Blue', 'Red', 'Green', 'Yellow'];   // translated on screen (key team.<name>)

/** A level's choice is a list of puzzle indices (e.g. [0, 3] = Crambin and GFP); a plain number n still means "the first n". */
export function levelPicks(plan, level) {
  const L = LEVELS[level], v = plan?.[level];
  if (Array.isArray(v)) return [...new Set(v.filter((i) => Number.isInteger(i) && i >= 0 && i < L.names.length))].sort((x, y) => x - y);
  const n = Math.max(0, Math.min(L.names.length, Math.floor(Number(v) || 0)));
  return Array.from({ length: n }, (_, i) => i);
}

/** plan = { level: [indices] | count } -> { 0: [...], 1: [...], 2: [...], 3: [...] } */
export function normPlan(plan) {
  return { 0: levelPicks(plan, 0), 1: levelPicks(plan, 1), 2: levelPicks(plan, 2), 3: levelPicks(plan, 3) };
}

/** plan (see normPlan) -> ordered challenge list; `n` is the position inside its level (Level 3 shadows are numbered by it) */
export function challengeList(plan, scale = 1) {
  const out = [];
  for (const level of [0, 1, 2, 3]) {
    levelPicks(plan, level).forEach((idx, n) => out.push({ id: `${level}-${idx}`, level, idx, n, name: LEVELS[level].names[idx], seconds: Math.round(LEVELS[level].seconds[idx] * scale) }));
  }
  return out;
}

export function validPlan(plan) {
  if (!plan || typeof plan !== 'object') return false;
  return [0, 1, 2, 3].some((level) => levelPicks(plan, level).length > 0);
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
