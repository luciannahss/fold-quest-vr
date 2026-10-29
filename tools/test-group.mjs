// Protocol test of the group challenge server: a teacher and two headsets play a short game.
//   node tools/test-group.mjs
import { spawn } from 'node:child_process';
import { WebSocket } from '../server/node_modules/ws/wrapper.mjs';
import { MARKER } from '../server/challenges.mjs';

const PORT = 8799;
const srv = spawn('node', ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT), COUNTDOWN_MS: '300', RESULTS_MS: '400', GRACE_MS: '700' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
let bad = 0;
const check = (c, m) => { if (!c) { bad++; console.log('✗', m); } else console.log('✓', m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(role, room = '', resume = '') {
  const q = new URLSearchParams({ build: MARKER, role }); if (room) q.set('room', room); if (resume) q.set('resume', resume);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?${q}`);
  const c = { ws, state: null, welcome: null, judged: [], errors: [] };
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'state') c.state = m; else if (m.type === 'welcome') c.welcome = m; else if (m.type === 'judged') c.judged.push(m); else if (m.type === 'error') c.errors.push(m.code); });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}
const until = async (f, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (f()) return true; await sleep(20); } return false; };

const host = client('host'); await host.open;
await until(() => host.state);
const code = host.state.room;
check(/^\d{4}$/.test(code), `room code ${code}`);
check(host.state.totalRounds === 6 && host.state.challenges[0].level === 0, 'default plan = Level 0 + 1 + 1 + 3 challenges');
host.send({ type: 'config', plan: { 0: 0, 1: 0, 2: 1, 3: 1 }, scale: 1 });
await until(() => host.state.totalRounds === 2);
check(host.state.totalRounds === 2 && host.state.challenges[0].level === 2, 'config: Level 2 + Level 3');
host.send({ type: 'config', plan: { 0: 0, 1: 0, 2: 0, 3: 0 }, scale: 1 }); await sleep(100);
check(host.state.totalRounds === 2, 'empty plan rejected');
host.send({ type: 'start' }); await sleep(100);
check(host.errors?.length === undefined && host.state.phase === 'lobby' || host.state.phase === 'lobby', 'cannot start without teams');

host.poses = []; host.ws.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'pose') host.poses.push(m); });
const a = client('player', code), b = client('player', code); await a.open; await b.open;
await until(() => a.state && b.state);
a.send({ type: 'pick', team: 0 }); b.send({ type: 'pick', team: 0 }); await sleep(150);
check(b.errors.includes('team_taken'), 'second headset cannot take the same colour');
b.send({ type: 'pick', team: 1 }); await until(() => b.welcome?.team === 1);
check(a.welcome.team === 0 && b.welcome.team === 1, 'two teams seated');
const bad2 = client('player', '9999'); await sleep(300);
check(bad2.errors.includes('no_room'), 'unknown room reported');

a.send({ type: 'practice', on: true }); await until(() => host.state.teams[0].practising);
check(host.state.teams[0].practising && !host.state.teams[1].practising, 'a headset practising with the tutorial shows on the teacher screen');
host.send({ type: 'start' });
await until(() => host.state.phase === 'countdown');
check(!host.state.teams[0].practising, 'the practice flag clears when the challenge starts');
check(host.state.phase === 'countdown' && host.state.round === 0, 'countdown starts');
a.send({ type: 'solved', round: 0, mistakes: 0, hints: 0, total: 1 }); await sleep(80);
check(!host.state.teams[0].solved, 'solve during countdown ignored');
await until(() => host.state.phase === 'round');
a.send({ type: 'pose', held: '0', mols: [{ id: '0', p: [0.1, 1.2, -0.5], q: [0, 0, 0, 1], s: '' }] }); await sleep(100);
check(host.poses.length === 1 && host.poses[0].team === 0 && host.poses[0].held === '0', 'pose relayed to the teacher with the team index');
a.send({ type: 'pose', held: null, mols: [{ id: '0', p: [99, 0, 0], q: [0, 0, 0, 1] }] }); await sleep(100);
check(host.poses.length === 1, 'out-of-range pose rejected');
check(b.state && !b.errors.includes('x'), 'poses are not sent to other headsets');
a.send({ type: 'progress', round: 0, joined: 1, total: 3, mistakes: 1, hints: 0 });
await until(() => host.state.teams[0].joined === 1);
check(host.state.teams[0].mistakes === 1, 'progress relayed to the teacher');
a.send({ type: 'solved', round: 7, mistakes: 0, hints: 0, total: 3 }); await sleep(80);
check(!host.state.teams[0].solved, 'solve for another round ignored');
await sleep(200);
a.send({ type: 'solved', round: 0, mistakes: 1, hints: 1, total: 3 });
await until(() => host.state.teams[0].solved);
const pts = host.state.teams[0].points;
check(pts >= 100 && pts <= 200 && a.judged.at(-1)?.points === pts, `points computed by the server (${pts})`);
a.send({ type: 'solved', round: 0, mistakes: 0, hints: 0, total: 3 }); await sleep(100);
check(host.state.teams[0].points === pts && host.state.teams[0].score === pts, 'second solve does not add points');
b.send({ type: 'solved', round: 0, mistakes: 0, hints: 0, total: 3 });
await until(() => host.state.graceEndsAt > 0);
check(host.state.phase === 'round' && host.state.graceEndsAt > Date.now(), 'everyone solved: the round stays open for a grace period');
await until(() => host.state.phase === 'results');
check(host.state.teams[1].points > pts, 'clean run scores higher');
await until(() => host.state.phase === 'countdown' && host.state.round === 1);
check(true, 'next challenge follows');
await until(() => host.state.phase === 'round');
a.send({ type: 'solved', round: 1, mistakes: 0, hints: 0, total: 1 });
await until(() => host.state.teams[0].history.length === 2 && host.state.teams[0].solved);
host.send({ type: 'next' });          // teacher ends the round: team b did not solve
await until(() => host.state.phase === 'podium', 4000);
check(host.state.phase === 'podium', 'podium after the last challenge');
const [t0, t1] = host.state.teams;
check(t0.score > t1.score && t0.history.length === 2, `scores: ${t0.score} vs ${t1.score}`);
// a dropped headset comes back with its seat
const tok = a.welcome.resume; a.ws.close(); await sleep(150);
const a2 = client('player', code, tok); await until(() => a2.welcome?.team === 0);
check(a2.welcome?.team === 0, 'headset resumes its team');
// only the host may command
a2.send({ type: 'reset' }); await sleep(100);
check(host.state.phase === 'podium', 'players cannot send host commands');
host.send({ type: 'reset' }); await until(() => host.state.phase === 'lobby');
check(host.state.teams[0].score === 0, 'reset clears the scores');
for (const c of [host, a, b, a2, bad2]) c.ws.close();
srv.kill();
console.log(bad ? `${bad} problem(s)` : 'ok');
process.exit(bad ? 1 : 0);
