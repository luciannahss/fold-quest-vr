// Teacher screen of the group challenge (placar.html): creates the room, shows the code for the headsets, sets what to
// play (Levels 1-3), and shows what every team is doing, the results and the podium. Meant for a notebook connected to
// a projector; no headset needed.
// Adapted, with permission, from the teacher screen of Encaixe Molecular VR (Deborah Antunes).
import { LANGS, getLang, setLang, t, applyDom, onLangChange } from './i18n.js';
import { RoomClient, DEFAULT_SERVER, fmtTime, httpUrl, pingServer, serverUrl, setServerUrl } from './net/room.js';
import { LEVELS, SCALES, ranking } from '../server/challenges.mjs';
import { challengeTitle, teamName } from './net/text.js';
import { LiveView } from './placar-view.js';

const ROOM_KEY = 'foldquest-placar-room';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let server = serverUrl();
let client = null;
let serverOk = null;
let message = '';
let structure = '';
let confirmReset = 0;
let view = null;

document.title = t('pm.title');
const app = document.getElementById('app');
app.innerHTML = `
  <header>
    <div class="brand"><b>Fold Quest VR</b><span data-k="screen"></span></div>
    <div class="roomcode" data-k="room"></div>
    <div class="tools"><span class="pill" data-k="status"></span>
      ${LANGS.map((l) => `<button class="lng" data-lang="${l.code}">${l.code.toUpperCase()}</button>`).join('')}
      <button class="btn ghost" data-act="full" data-k="fullbtn"></button></div>
  </header>
  <main data-k="main"></main>
  <footer data-k="footer"></footer>`;
const $ = (k) => app.querySelector(`[data-k="${k}"]`);

/** Address of the game for the headsets (same site, without placar.html), with ?room= */
function gameLink(room) {
  const base = `${location.origin}${location.pathname.replace(/placar\.html$/, '')}`;
  const q = new URLSearchParams({ room });
  if (server && server !== DEFAULT_SERVER && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) q.set('server', server);
  return `${base}?${q}`;
}

// ------------------------------------------------------------------ connection
async function wake() {
  serverOk = null; render();
  serverOk = await pingServer(server);
  render();
}

function createRoom(resumeRoom = '') {
  client?.close();
  message = '';
  const c = new RoomClient(server, 'host', resumeRoom);
  client = c;
  c.onWelcome = () => { try { sessionStorage.setItem(ROOM_KEY, c.room); } catch { /* ignore */ } render(); };
  c.onState = (s) => onState(s);
  c.onPose = (m) => view?.pose(m);
  c.onStatus = () => render();
  c.onError = (code) => {
    message = code === 'no_teams' ? t('pm.noteams') : code === 'no_room' ? t('pm.expired') : '';
    render();
  };
  render();
}
const cmd = (msg) => client?.send(msg);

let lastChallenge = null;
function onState(s) {
  const ch = s.phase === 'round' || s.phase === 'countdown' ? s.challenge : null;
  if ((ch?.id ?? null) !== (lastChallenge?.id ?? null)) { lastChallenge = ch; void view?.setChallenge(ch); }
  render();
}

// ------------------------------------------------------------------ rendering
function statusPill() {
  const el = $('status');
  let cls = 'pill', text;
  if (client) {
    if (client.status === 'open') { cls += ' ok'; text = t('pm.s.ok'); }
    else if (client.status === 'closed') { cls += ' bad'; text = t('pm.s.closed'); }
    else { cls += ' warn'; text = t('pm.s.retry'); }
  } else if (serverOk === null) { cls += ' warn'; text = t('pm.s.waking'); }
  else if (serverOk) { cls += ' ok'; text = t('pm.s.ready'); }
  else { cls += ' bad'; text = t('pm.s.down'); }
  el.className = cls; el.textContent = text;
}

const keyOf = (s) => (!client || !s
  ? `none|${serverOk}|${client?.status ?? ''}|${(client?.failures ?? 0) >= 3}`
  : [s.phase, s.round, s.totalRounds, JSON.stringify(s.plan), s.scale, s.teams.map((x) => `${x.claimed ? 1 : 0}${x.online ? 1 : 0}`).join('')].join('|'));

function render() {
  statusPill();
  $('screen').textContent = t('pm.screen');
  $('fullbtn').textContent = t('pm.fullscreen');
  for (const b of app.querySelectorAll('[data-lang]')) b.classList.toggle('on', b.dataset.lang === getLang());
  const s = client?.state ?? null;
  $('room').innerHTML = client?.room && s ? `${t('group.room', { code: '' }).trim()} <b>${esc(client.room)}</b>` : '';
  const key = `${keyOf(s)}|${message}|${getLang()}`;
  if (key !== structure) {
    structure = key;
    // keep what the teacher is typing (a headset connecting rebuilds the lobby)
    const a = document.activeElement;
    const typing = a instanceof HTMLInputElement && a.dataset.rename !== undefined ? { id: a.dataset.rename, value: a.value, at: a.selectionStart ?? 0 } : null;
    const main = $('main');
    if (!client || !s) main.innerHTML = connectHtml();
    else if (s.phase === 'lobby') main.innerHTML = lobbyHtml(s);
    else if (s.phase === 'countdown') main.innerHTML = countdownHtml(s);
    else if (s.phase === 'round') main.innerHTML = roundHtml(s);
    else if (s.phase === 'results') main.innerHTML = resultsHtml(s);
    else main.innerHTML = podiumHtml(s);
    $('footer').innerHTML = footerHtml(s);
    const again = typing && app.querySelector(`[data-rename="${typing.id}"]`);
    if (again) { again.value = typing.value; again.focus(); again.setSelectionRange(typing.at, typing.at); }
  }
  patch(s);
}

function connectHtml() {
  // the room server does not answer: stop waiting and say so
  if (client && client.failures >= 3 && !client.state) { client.close(); client = null; serverOk = false; }
  const busy = !server || serverOk === null || (client && client.status !== 'open');
  return `<div class="connect card">
    <h1>${t('group.title')}</h1>
    <p>${t('pm.intro')}</p>
    <button class="btn big" data-act="create" ${busy ? 'disabled' : ''}>${client ? t('pm.connecting') : serverOk === null && server ? t('pm.s.waking') : t('pm.create')}</button>
    <p class="msg">${!server ? t('pm.noserver') : serverOk === false ? `${t('pm.unreachable')}<br><small>${esc(httpUrl(server))}</small>` : esc(message)}</p>
    ${serverOk === false ? `<button class="btn ghost" data-act="wake">${t('pm.retry')}</button>` : ''}
    ${server && !/^wss?:\/\/(localhost|127\.0\.0\.1)/.test(server) ? `<p>${t('pm.wake')}</p>` : ''}
    <details><summary>${t('pm.server')}</summary><input data-k="server" value="${esc(server)}" spellcheck="false"></details>
  </div>`;
}

function teamCard(tm) {
  const state = !tm.claimed ? t('pm.free') : tm.online ? t('pm.s.ok') : t('pm.noconn');
  return `<div class="team${tm.online ? ' online' : ''}" style="--c:${tm.color}">
    <span class="dot"></span>
    <input data-rename="${tm.index}" value="${esc(teamName(tm))}" maxlength="22" aria-label="${t('pm.teamname')}">
    ${tm.claimed ? `<button class="btn ghost free" data-free="${tm.index}">${t('pm.release')}</button>` : '<span></span>'}
    <span class="state">${state}</span>
  </div>`;
}

function lobbyHtml(s) {
  const link = gameLink(client.room);
  const ready = s.teams.some((x) => x.claimed);
  const plan = [0, 1, 2, 3].map((lv) => `<span>${t(`pm.l${lv}`)}</span><div class="opts">${Array.from({ length: LEVELS[lv].names.length + 1 }, (_, n) => `<button class="${s.plan[lv] === n ? 'on' : ''}" data-plan="${lv}:${n}">${n}</button>`).join('')}</div>`).join('');
  return `<section class="lobby">
    <div class="join card">
      <p class="kicker">${t('pm.code')}</p>
      <div class="code">${esc(client.room)}</div>
      <ol><li>${t('pm.join1')} <b>${esc(link.replace(/^https?:\/\//, '').split('?')[0])}</b></li><li>${t('pm.join2')}</li><li>${t('pm.join3')}</li></ol>
      <p class="link">${t('pm.link')} ${esc(link)}</p>
    </div>
    <div class="setup card">
      <h2>${t('pm.plan')} (${t('pm.how')})</h2>
      <div class="plan">${plan}</div>
      <h2>${t('pm.time')}</h2>
      <div class="opts">${SCALES.map((x) => `<button class="${s.scale === x ? 'on' : ''}" data-scale="${x}">${t(`pm.scale.${x}`)}</button>`).join('')}</div>
      <p class="hint">${s.challenges.map((c) => `${esc(challengeTitle(c))} (${fmtTime(c.seconds * 1000)})`).join(' · ')}</p>
      <h2>${t('pm.teams')}</h2>
      <div class="teams">${s.teams.map(teamCard).join('')}</div>
      <p class="msg">${esc(message)}</p>
      <button class="btn big" data-act="start" ${ready ? '' : 'disabled'}>${t('pm.start')}</button>
    </div>
  </section>`;
}

const goal = (ch) => t(`pm.goal.${ch.level}`);

function countdownHtml(s) {
  return `<section class="count-down">
    <p class="kicker">${t('pm.round', { n: s.round + 1, total: s.totalRounds })}</p>
    <h1>${esc(challengeTitle(s.challenge))}</h1>
    <div class="num" data-k="countdown">3</div>
    <p class="goal">${esc(goal(s.challenge))}</p>
  </section>`;
}

function roundHtml(s) {
  const teams = s.teams.filter((x) => x.claimed);
  return `<section style="display:flex;flex-direction:column;flex:1;min-height:0">
    <div class="round-head">
      <div><p class="kicker">${t('pm.round', { n: s.round + 1, total: s.totalRounds })}</p><h1>${esc(challengeTitle(s.challenge))}</h1><p class="goal">${esc(goal(s.challenge))}</p></div>
      <div class="timer" data-k="timer"></div>
    </div>
    <div class="grid n${teams.length}">${teams.map((tm) => `<div class="cell" data-cell="${tm.index}" style="--c:${tm.color}">
      <div class="cell-top"><span class="dot"></span><b data-k="name-${tm.index}"></b><span class="pts" data-k="pts-${tm.index}"></span></div>
      <div class="bar"><i data-k="bar-${tm.index}"></i></div>
      <div class="spacer"></div>
      <div class="cell-status" data-k="st-${tm.index}"></div>
    </div>`).join('')}</div>
    ${s.challenge.level === 3 ? `<p class="hint">${t('pm.hidden')}</p>` : ''}
  </section>`;
}

function rankRows(s, withRound) {
  return ranking(s.teams).map((tm, i) => {
    const r = tm.solved ? `✓ +${tm.points} · ${fmtTime(tm.solvedMs)}` : `✗ ${t('pm.unsolved')}`;
    return `<div class="row" style="--c:${tm.color}"><span class="pos">${i + 1}.</span><span class="dot"></span>
      <span class="name">${esc(teamName(tm))}</span>
      <span class="this${withRound && tm.solved ? ' ok' : ''}">${withRound ? r : t('pm.total', { t: fmtTime(tm.totalMs) })}</span>
      <span class="total">${t('group.pts', { n: tm.score })}</span></div>`;
  }).join('');
}

function resultsHtml(s) {
  return `<section class="results">
    <p class="kicker">${t('pm.end', { n: s.round + 1, total: s.totalRounds })}</p>
    <h1>${esc(s.challenge.level === 3 ? challengeTitle(s.challenge) : challengeTitle(s.challenge))}</h1>
    <p class="next" data-k="next"></p>
    <div class="rank">${rankRows(s, true)}</div>
  </section>`;
}

function podiumHtml(s) {
  const order = ranking(s.teams);
  const step = (i) => {
    const tm = order[i];
    if (!tm) return '';
    return `<div class="step p${i + 1}" style="--c:${tm.color}"><div class="who">${esc(teamName(tm))}</div>
      <div class="block"><span class="place">${i + 1}</span><span class="score">${t('group.pts', { n: tm.score })}</span></div></div>`;
  };
  return `<section class="results">
    <h1 style="text-align:center;color:var(--warn);font-size:3.2em">${t('pm.podium')}</h1>
    <div class="podium">${step(1)}${step(0)}${step(2)}</div>
    <div class="rank">${rankRows(s, false)}</div>
  </section>`;
}

function footerHtml(s) {
  if (!client || !s) return `<span class="note">${t('pm.footer')}</span>`;
  const b = [];
  if (s.phase === 'round') b.push(`<button class="btn warn" data-act="next">${t('pm.endround')}</button>`);
  if (s.phase === 'results' || s.phase === 'countdown') b.push(`<button class="btn warn" data-act="next">${t('pm.advance')}</button>`);
  if (s.phase === 'podium') b.push(`<button class="btn big" data-act="again">${t('pm.again')}</button>`);
  if (s.phase !== 'lobby') b.push(`<button class="btn ghost" data-act="reset">${confirmReset > Date.now() ? t('pm.reset.confirm') : t('pm.reset')}</button>`);
  b.push(`<button class="btn ghost" data-act="newroom">${t('pm.newroom')}</button>`);
  return `<span class="note">${t('group.room', { code: esc(client.room) })} · ${esc(httpUrl(server).replace(/^https?:\/\//, ''))}</span>${b.join('')}`;
}

/** updates what changes every second without rebuilding the page (keeps typing focus) */
function patch(s) {
  if (!client || !s) return;
  const now = client.now();
  const left = (ms) => Math.max(0, Math.ceil((ms - now) / 1000));
  const timer = app.querySelector('[data-k="timer"]');
  if (timer) { const l = left(s.endsAt); timer.textContent = fmtTime(l * 1000); timer.classList.toggle('low', l <= 10); }
  const cd = app.querySelector('[data-k="countdown"]');
  if (cd) cd.textContent = String(Math.max(1, left(s.phaseEndsAt)));
  const next = app.querySelector('[data-k="next"]');
  if (next) next.textContent = s.round + 1 < s.totalRounds ? t('pm.next.in', { n: Math.max(1, left(s.phaseEndsAt)) }) : t('pm.podium.in', { n: Math.max(1, left(s.phaseEndsAt)) });
  for (const tm of s.teams) {
    const el = (k) => app.querySelector(`[data-k="${k}-${tm.index}"]`);
    if (el('name')) el('name').textContent = teamName(tm) + (tm.online ? '' : ` (${t('pm.offline')})`);
    if (el('pts')) el('pts').textContent = t('group.pts', { n: tm.score });
    view?.setSolved(tm.index, tm.solved);
    if (el('bar')) el('bar').style.width = `${tm.solved ? 100 : tm.total ? Math.round(100 * tm.joined / tm.total) : 0}%`;
    if (el('st')) {
      const lv = s.challenge?.level;
      el('st').className = `cell-status${tm.solved ? ' ok' : ''}`;
      el('st').textContent = tm.solved ? t('pm.solved', { n: tm.points, t: fmtTime(tm.solvedMs) })
        : tm.total || tm.mistakes || tm.hints ? t(lv === 3 ? 'pm.prog.quiz' : lv === 0 ? 'pm.prog.l0' : 'pm.prog', { j: tm.joined, n: tm.total, m: tm.mistakes, h: tm.hints }) : t('pm.working');
    }
    app.querySelector(`[data-cell="${tm.index}"]`)?.classList.toggle('solved', tm.solved);
    const input = app.querySelector(`[data-rename="${tm.index}"]`);
    if (input && document.activeElement !== input) input.value = teamName(tm);
  }
}

// ------------------------------------------------------------------ input
app.addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  const s = client?.state;
  if (el.dataset.lang) { setLang(el.dataset.lang); return; }
  if (el.dataset.plan && s) { const [lv, n] = el.dataset.plan.split(':').map(Number); cmd({ type: 'config', plan: { ...s.plan, [lv]: n }, scale: s.scale }); return; }
  if (el.dataset.scale && s) { cmd({ type: 'config', plan: s.plan, scale: Number(el.dataset.scale) }); return; }
  if (el.dataset.free) { cmd({ type: 'free', team: Number(el.dataset.free) }); return; }
  switch (el.dataset.act) {
    case 'create': {
      const v = app.querySelector('[data-k="server"]')?.value.trim();
      if (v && /^wss?:\/\/\S+$/.test(v) && v !== server) { server = v.replace(/\/+$/, ''); setServerUrl(server === DEFAULT_SERVER ? null : server); }
      createRoom();
      break;
    }
    case 'wake': void wake(); break;
    case 'start': message = ''; cmd({ type: 'start' }); break;
    case 'next': cmd({ type: 'next' }); break;
    case 'again': cmd({ type: 'reset' }); break;
    case 'reset':
      if (confirmReset > Date.now()) { confirmReset = 0; cmd({ type: 'reset' }); } else { confirmReset = Date.now() + 4000; structure = ''; render(); setTimeout(() => { structure = ''; render(); }, 4100); }
      break;
    case 'newroom':
      try { sessionStorage.removeItem(ROOM_KEY); } catch { /* ignore */ }
      client?.close(); client = null; structure = '';
      createRoom();
      break;
    case 'full':
      if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {});
      break;
  }
});
app.addEventListener('change', (e) => {
  const input = e.target;
  if (input.dataset?.rename !== undefined) {
    const name = input.value.trim();
    if (name) cmd({ type: 'rename', team: Number(input.dataset.rename), name });
  }
});
app.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset?.rename !== undefined) e.target.blur(); });
onLangChange(() => { document.title = t('pm.title'); structure = ''; render(); });

// ------------------------------------------------------------------ start
applyDom();
document.title = t('pm.title');
render();
setInterval(() => { if (client?.state) patch(client.state); }, 250);
try {
  view = new LiveView(document.getElementById('live'), () => [0, 1, 2, 3].map((i) => app.querySelector(`[data-cell="${i}"]`)));
  if (lastChallenge) void view.setChallenge(lastChallenge);
  let last = performance.now();
  const frame = () => { const n = performance.now(); try { view?.render(Math.min(0.1, (n - last) / 1000)); } catch (err) { console.warn('live view', err); view = null; } last = n; if (view) requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
} catch (err) { console.warn('live view unavailable', err); view = null; }
window.__placar = { client: () => client };
// keeps a free-tier server awake while this screen is open
setInterval(() => { if (server) void pingServer(server, 20_000); }, 4 * 60_000);
void wake().then(() => {
  let saved = '';
  try { saved = sessionStorage.getItem(ROOM_KEY) ?? ''; } catch { /* ignore */ }
  if (saved && serverOk) createRoom(saved);
});
