// Group challenge, headset side: joins a room (code from the teacher screen), picks a team colour, and plays the
// Level 1-3 puzzles the server announces. The server owns timers and points; this file only reports progress and the
// moment the puzzle is solved. Panels: join keypad, team choice, lobby, countdown, results and podium.
// Adapted, with permission, from the "Desafio em grupo" of Encaixe Molecular VR (Deborah Antunes).
import { THEME } from './ui.js';
import { t } from './i18n.js';
import { sfx } from './audio.js';
import { RoomClient, serverUrl, fmtTime } from './net/room.js';
import { ranking } from '../server/challenges.mjs';
import { challengeTitle, teamName } from './net/text.js';

const CURRENT = 'foldquest-room-current';

export class Group {
  constructor(game) {
    this.game = game;
    this.room = null;
    this.view = 'none';          // 'join' (keypad) | 'room' | 'none'
    this.joinCode = ''; this.joinError = '';
    this.begun = -1;             // round whose puzzle is on screen
    this.sent = false;           // "solved" already reported for this round
    this.sig = ''; this.clock = ''; this.idle = false; this.myPoints = 0;
  }

  get active() { return !!this.room; }
  get state() { return this.room?.state ?? null; }
  get me() { const s = this.state; return s && this.room.team >= 0 ? s.teams[this.room.team] : null; }
  /** a puzzle is being played right now */
  get inRound() { const s = this.state; return !!s && s.phase === 'round' && this.room.team >= 0 && this.begun === s.round; }
  /** the group boards (keypad, lobby, results...) replace the normal coach / side boards */
  get panelMode() { return this.view === 'join' || (!!this.room && !this.inRound); }

  // ------------------------------------------------------------------ joining
  openJoin(code = '') {
    this.view = 'join'; this.joinError = ''; this.joinCode = code.replace(/\D/g, '').slice(0, 4);
    this.game.menuOpen = false;
    this.game.groupIdle(); this.idle = true;
    if (this.joinCode.length === 4) { this.join(this.joinCode); return; }
    this.game.redrawAll();
  }

  join(code) {
    this.room?.close();
    this.joinError = ''; this.begun = -1; this.sent = false;
    const server = serverUrl();
    if (!server) { this.joinError = t('group.noserver'); this.view = 'join'; this.game.redrawAll(); return; }
    const room = new RoomClient(server, 'player', code);
    this.room = room; this.view = 'room';
    try { sessionStorage.setItem(CURRENT, code); } catch { /* ignore */ }
    room.onState = (s) => this.onState(s);
    room.onStatus = () => this.game.redrawAll();
    room.onWelcome = () => this.game.redrawAll();
    room.onJudged = (j) => { if (j.ok) { this.myPoints = j.points ?? 0; sfx.good(); this.game.redrawAll(); } };
    room.onError = (c) => {
      if (c === 'no_room') { this.leave(false); this.joinError = t('group.notfound', { code }); this.view = 'join'; this.joinCode = ''; this.game.redrawAll(); }
      else if (c === 'team_taken') { this.joinError = t('group.taken'); this.game.redrawAll(); }
    };
    this.game.groupIdle(); this.idle = true;
    this.game.redrawAll();
    this.game.hooks.groupChanged?.(code);
  }

  leave(restart = true) {
    const room = this.room;
    this.room = null; room?.close();
    try { sessionStorage.removeItem(CURRENT); } catch { /* ignore */ }
    this.view = 'none'; this.begun = -1; this.sent = false; this.idle = false;
    this.game.hooks.groupChanged?.('');
    if (restart) this.game.setLevel(0); else this.game.redrawAll();
  }

  // ------------------------------------------------------------------ room state
  onState(s) {
    const room = this.room;
    if (!room) return;
    if (s.phase === 'round' && room.team >= 0 && this.begun !== s.round) {
      this.begun = s.round; this.sent = false; this.sig = ''; this.myPoints = 0; this.idle = false;
      this.game.startGroupChallenge(s.challenge);
    } else if (!this.inRound && !this.idle) { this.game.groupIdle(); this.idle = true; }
    if (s.phase === 'podium' && !this.heardPodium) { this.heardPodium = true; sfx.win(); }
    if (s.phase === 'lobby' || s.phase === 'podium') this.begun = -1;
    if (s.phase === 'lobby') this.heardPodium = false;
    this.game.redrawAll();
  }

  /** per frame: report progress / solve, and refresh the clock once a second */
  tick(dt = 0) {
    const room = this.room, s = this.state;
    if (!room || !s) return;
    if (this.inRound) {
      this.sendPoses(dt);
      const L = this.game.puzzle;
      const sig = L.sig();
      if (sig !== this.sig) {
        this.sig = sig;
        room.send({ type: 'progress', round: s.round, joined: L.joined, total: L.nJ, mistakes: L.mistakes, hints: L.hints });
      }
      if (!this.sent && L.groupSolved()) {
        this.sent = true;
        room.send({ type: 'solved', round: s.round, mistakes: L.mistakes, hints: L.hints, total: L.nJ });
      }
    }
    const key = s.phase === 'round' ? `r${Math.ceil((s.endsAt - room.now()) / 1000)}` : `${s.phase}${Math.ceil((s.phaseEndsAt - room.now()) / 1000)}`;
    if (key !== this.clock) { this.clock = key; this.game.coachPanel.redraw(); }
  }

  /** poses of the pieces (Level 1/2) or cards (Level 3) for the teacher's live view, ~8 times per second */
  sendPoses(dt) {
    this.poseTimer = (this.poseTimer ?? 0) - dt;
    if (this.poseTimer > 0) return;
    this.poseTimer = 0.125;
    const L = this.game.puzzle, r3 = (x) => Math.round(x * 1000) / 1000;
    const pose = (id, g, s = '') => ({ id, p: [r3(g.position.x), r3(g.position.y), r3(g.position.z)], q: [r3(g.quaternion.x), r3(g.quaternion.y), r3(g.quaternion.z), r3(g.quaternion.w)], s });
    let mols, held = null;
    if (L.groupKind === 'l0') {          // Level 0: state letter (tray, held, folding, locked, rejecting, returning) + kind + fold 0-9 + flip
      const code = { tray: 't', held: 'h', folding: 'f', locked: 'k', rejecting: 'r', returning: 'x' };
      mols = this.game.chains.map((c, i) => pose(`c${i}`, c.group, `${code[c.userData.state] ?? 't'}${c.kind[0]}${Math.round(c.f * 9)}${c.flip ? 1 : 0}`));
      mols.push({ id: 'stage', p: [this.game.stage, this.game.staged ? 1 : 0, 0], q: [0, 0, 0, 1], s: '' });   // which vessel is on stage (the teacher's view follows it)
      const h = this.game.chains.findIndex((c) => c.userData.state === 'held');
      held = h >= 0 ? `c${h}` : null;
    } else if (L.cards) {                // Level 3
      mols = L.cards.map((c) => pose(c.id, c.group, c.state === 'gone' ? 'gone' : ''));
      held = L.cards.find((c) => c.held)?.id ?? null;
    } else {                             // Level 1 / 2
      mols = L.pieces.map((p, i) => pose(String(i), p.chain.group));
      const h = L.pieces.findIndex((p) => p.held);
      held = h >= 0 ? String(h) : null;
    }
    this.room.send({ type: 'pose', held, mols });
  }

  // ------------------------------------------------------------------ text helpers
  timeLeft() { const s = this.state; return s ? Math.max(0, s.endsAt - this.room.now()) : 0; }
  secondsLeft() { const s = this.state; return s ? Math.max(0, Math.ceil((s.phaseEndsAt - this.room.now()) / 1000)) : 0; }

  /** footer line once this team has solved the puzzle (with the grace countdown when every team is done) */
  solvedLine() {
    const s = this.state;
    const left = s?.graceEndsAt ? Math.max(0, Math.ceil((s.graceEndsAt - this.room.now()) / 1000)) : 0;
    return left > 0 ? t('group.solved.next', { n: this.myPoints, s: left }) : t('group.solved', { n: this.myPoints });
  }

  /** one line for the footer of the level boards while playing */
  statusLine(L) {
    const me = this.me;
    const progress = L.groupKind === 'l0' ? t('group.progress.l0', { j: L.joined, n: L.nJ, m: L.mistakes })
      : L.protein?.id === 'quiz' ? t('group.progress.quiz', { m: L.mistakes }) : t('group.progress', { j: L.joined, n: L.nJ, m: L.mistakes });
    return `⏱ ${fmtTime(this.timeLeft())}   ${t('group.pts', { n: me?.score ?? 0 })}   ${progress}`;
  }

  // ------------------------------------------------------------------ boards
  drawCoach(p) {
    const { w, h } = p;
    const room = this.room, s = this.state;
    p.text(t('group.title'), 56, 34, { size: 46, weight: 800, color: THEME.border, shadow: THEME.border, maxW: w - 112 });
    if (room) p.text(t('group.room', { code: room.room }), 56, 100, { size: 34, weight: 700, color: THEME.good });
    // bottom row: Leave | Change colour (lobby only) | Options - three buttons that must not overlap (990 px wide board)
    const options = () => p.button(this.game.menuOpen ? t('options.close') : t('options'), w - 56 - 250, h - 100, 250, 78, () => this.game.toggleMenu(), { active: this.game.menuOpen, size: 28 });
    const leave = () => p.button(t('group.leave'), 56, h - 100, 330, 78, () => this.leave(), { size: 28 });
    const center = (text, y, size, color = THEME.text, weight = 700) => p.text(text, w / 2, y, { size, weight, color, align: 'center', maxW: w - 112 });

    if (this.view === 'join' || !room) { this.drawKeypad(p, options); return; }
    if (room.status !== 'open') {
      p.text(room.status === 'closed' ? t('group.disconnected') : t('group.connecting'), w - 56, 108, { size: 30, weight: 700, color: THEME.warn, align: 'right' });
      if (room.failures >= 3 && !s) {
        let y = p.text(t('group.unreachable'), 56, 220, { size: 36, weight: 700, color: THEME.bad, maxW: w - 112 }) + 16;
        y = p.text(t('group.unreachable.hint'), 56, y, { size: 30, maxW: w - 112 }) + 16;
        p.text(room.server.replace(/^wss?:\/\//, ''), 56, y, { size: 26, color: THEME.dim, maxW: w - 112 });
        leave(); options(); return;
      }
    }
    if (room.team < 0) {
      center(s ? t('group.pick') : t('group.connecting'), 200, 44);
      const cw = (w - 112 - 30) / 2;
      (s?.teams ?? [0, 1, 2, 3].map((index) => ({ index, name: ['Blue', 'Red', 'Green', 'Yellow'][index], color: '#8f96c9', claimed: false, online: false }))).forEach((tm, i) => {
        const taken = tm.claimed && tm.online;
        const x = 56 + (i % 2) * (cw + 30), y = 290 + Math.floor(i / 2) * 190;
        p.button(taken ? `${teamName(tm)} · ${t('group.taken.short')}` : teamName(tm), x, y, cw, 160, () => { if (!taken) room.pick(i); }, { disabled: taken, size: 40 });
        p.g.fillStyle = tm.color; p.g.fillRect(x + 14, y + 14, 18, 132);
      });
      if (this.joinError) center(this.joinError, h - 180, 28, THEME.bad);
      leave(); options(); return;
    }
    const me = this.me;
    if (!s || !me) { leave(); options(); return; }
    const left = this.secondsLeft();
    if (s.phase === 'lobby') {
      p.text(t('group.yourteam', { team: teamName(me) }), w / 2, 190, { size: 52, weight: 800, color: me.color, align: 'center', maxW: w - 112 });
      center(t('group.waiting'), 290, 40, THEME.warn);
      center(t('group.plan', { n: s.totalRounds }), 350, 32, THEME.dim, 500);
      this.drawRows(p, s, 420, false);
      p.button(t('group.swap'), 56 + 330 + 12, h - 100, 250, 78, () => { room.team = -1; this.game.redrawAll(); }, { size: 26 });
    } else if (s.phase === 'countdown') {
      center(t('group.round', { n: s.round + 1, total: s.totalRounds }), 190, 40, THEME.dim);
      center(challengeTitle(s.challenge), 250, 52, THEME.good, 800);
      center(String(Math.max(1, left)), 400, 260, THEME.warn, 800);
    } else if (s.phase === 'results') {
      center(t('group.end', { n: s.round + 1, total: s.totalRounds }), 190, 44);
      center(s.round + 1 < s.totalRounds ? t('group.next', { n: Math.max(1, left) }) : t('group.podium.in', { n: Math.max(1, left) }), 250, 32, THEME.warn);
      this.drawRows(p, s, 320, true);
    } else if (s.phase === 'round') {
      // seated but the puzzle has not started on this headset yet
      center(t('group.connecting'), 300, 40, THEME.dim);
    } else {
      center(t('group.podium'), 190, 70, THEME.warn, 800);
      const order = ranking(s.teams), place = order.findIndex((x) => x.index === me.index);
      if (place >= 0) center(place === 0 ? t('group.won') : t('group.place', { n: place + 1 }), 290, 36, me.color);
      this.drawRows(p, s, 360, false);
    }
    leave(); options();
  }

  /** ranking rows: dot, place, team name, points (and this challenge's result) */
  drawRows(p, s, y, round) {
    const { w, g } = p;
    const rows = s.phase === 'lobby' ? s.teams.filter((x) => x.claimed) : ranking(s.teams);
    rows.forEach((tm, i) => {
      const yy = y + i * 78;
      g.fillStyle = tm.color; g.beginPath(); g.arc(86, yy + 22, 17, 0, 7); g.fill();
      const label = s.phase === 'lobby' ? teamName(tm) : `${i + 1}.  ${teamName(tm)}`;
      p.text(tm.online ? label : `${label} (${t('group.offline')})`, 120, yy, { size: 38, weight: 700, color: tm.online ? THEME.text : THEME.dim, maxW: w - 520 });
      if (s.phase !== 'lobby') {
        p.text(t('group.pts', { n: tm.score }), w - 56, yy, { size: 38, weight: 800, color: THEME.warn, align: 'right' });
        if (round) p.text(tm.solved ? `✓ +${tm.points}` : '✗', w - 290, yy + 4, { size: 32, weight: 700, color: tm.solved ? THEME.good : THEME.bad, align: 'right' });
      }
    });
  }

  drawKeypad(p, options) {
    const { w, h, g } = p;
    p.text(t('group.keypad'), w / 2, 130, { size: 32, color: THEME.dim, align: 'center', maxW: w - 112 });
    const bw = 110, gap = 22, x0 = (w - 4 * bw - 3 * gap) / 2;
    for (let i = 0; i < 4; i++) {
      const x = x0 + i * (bw + gap);
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, 190, bw, 100);
      g.strokeStyle = i === this.joinCode.length ? THEME.warn : 'rgba(255,255,255,0.3)'; g.lineWidth = 4; g.strokeRect(x, 190, bw, 100);
      if (this.joinCode[i]) p.text(this.joinCode[i], x + bw / 2, 205, { size: 72, weight: 800, align: 'center' });
    }
    const kw = 190, kh = 92, kg = 16, kx = (w - 3 * kw - 2 * kg) / 2;
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].forEach((k, i) => {
      const ok = k === 'OK';
      p.button(ok ? t('group.enter') : k, kx + (i % 3) * (kw + kg), 316 + Math.floor(i / 3) * (kh + kg), kw, kh, () => {
        if (ok) { if (this.joinCode.length === 4) this.join(this.joinCode); return; }
        if (k === '⌫') this.joinCode = this.joinCode.slice(0, -1); else if (this.joinCode.length < 4) this.joinCode += k;
        this.joinError = ''; this.game.redrawAll();
      }, { primary: ok && this.joinCode.length === 4, disabled: ok && this.joinCode.length < 4, size: ok ? 34 : 50 });
    });
    if (this.joinError) p.text(this.joinError, w / 2, h - 180, { size: 28, color: THEME.bad, align: 'center', maxW: w - 112 });
    p.button(t('group.back'), 56, h - 100, 280, 78, () => this.leave(), { size: 32 });
    options();
  }

  /** left board while the group boards are shown: live scoreboard */
  drawSide(p) {
    const { w } = p;
    const s = this.state;
    p.text(t('group.scoreboard'), 50, 34, { size: 44, weight: 800, color: THEME.border });
    if (!s) { p.text(t('group.keypad'), 50, 110, { size: 27, color: THEME.dim, maxW: w - 100 }); return; }
    p.text(t('group.round', { n: Math.max(1, s.round + 1), total: s.totalRounds }), 50, 100, { size: 27, color: THEME.dim, maxW: w - 100 });
    let y = 170;
    ranking(s.teams).forEach((tm, i) => {
      p.g.fillStyle = tm.color; p.g.fillRect(50, y + 4, 10, 50);
      p.text(`${i + 1}. ${teamName(tm)}${tm.online ? '' : ` (${t('group.offline')})`}`, 76, y, { size: 30, weight: 800, color: tm.online ? THEME.text : THEME.dim, maxW: w - 100 });
      p.text(`${t('group.pts', { n: tm.score })}${s.phase === 'results' || s.phase === 'round' ? (tm.solved ? `   ✓ +${tm.points}` : '') : ''}`, 76, y + 34, { size: 25, color: tm.solved ? THEME.good : THEME.dim });
      y += 84;
    });
    y += 20;
    s.challenges.forEach((ch, i) => {
      const done = i < s.round || (i === s.round && (s.phase === 'results' || s.phase === 'podium'));
      p.text(`${done ? '✓' : i === s.round ? '▶' : '•'} ${challengeTitle(ch, true)}`, 50, y, { size: 24, color: done ? THEME.good : i === s.round ? THEME.warn : THEME.dim, maxW: w - 100 });
      y += 32;
    });
  }
}
