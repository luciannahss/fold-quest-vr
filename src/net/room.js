// Group challenge client (protocol foldquest-group-v1, see server/server.mjs). Used by the headsets (role "player") and
// by the teacher screen (role "host"). Reconnects by itself on flaky Wi-Fi and keeps its seat with a resume token, so a
// headset that drops for a moment comes back to the same team with its points.
// Adapted, with permission, from Encaixe Molecular VR (Deborah Antunes).
import { MARKER } from '../../server/challenges.mjs';

const SERVER_KEY = 'foldquest-server';
/** Room server on the internet (Render service "foldquest-group", see README "Publishing"); can be overridden with ?server=wss://... */
export const DEFAULT_SERVER = 'wss://foldquest-group.onrender.com';

/** Server address: ?server= (saved on the device), else the saved one, else the local server when served from localhost. */
export function serverUrl() {
  try {
    const q = new URLSearchParams(location.search).get('server');
    if (q && /^wss?:\/\/[^\s]+$/.test(q)) { localStorage.setItem(SERVER_KEY, q); return q.replace(/\/+$/, ''); }
    const saved = localStorage.getItem(SERVER_KEY);
    if (saved) return saved;
  } catch { /* ignore */ }
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return `ws://${location.hostname}:8790`;
  return DEFAULT_SERVER;
}

export function setServerUrl(url) {
  try { if (url) localStorage.setItem(SERVER_KEY, url.replace(/\/+$/, '')); else localStorage.removeItem(SERVER_KEY); } catch { /* ignore */ }
}

export const httpUrl = (ws) => ws.replace(/^ws/, 'http');

/** Wakes the server and tells whether it answers (free hosting sleeps when idle; the first call can take ~1 min). */
export async function pingServer(server, timeoutMs = 70_000) {
  if (!server) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${httpUrl(server)}/healthz`, { cache: 'no-store', signal: ctl.signal });
    return r.ok;
  } catch { return false; } finally { clearTimeout(timer); }
}

const tokenKey = (role, room) => `foldquest-room:${role}:${room}`;

export class RoomClient {
  /** role: 'host' | 'player' | 'view' */
  constructor(server, role, room = '') {
    this.server = server; this.role = role; this.room = room;
    this.state = null;
    this.team = -1;
    this.status = 'connecting';   // connecting | open | retrying | closed
    this.error = '';              // fatal error code (no_room): the client stops retrying
    this.offset = 0;              // serverTime - Date.now(), smoothed
    this.ws = null; this.resume = ''; this.closed = false; this.tries = 0; this.pingTimer = 0; this.retryTimer = 0;
    this.onPose = () => {}; this.onState = () => {}; this.onJudged = () => {}; this.onError = () => {}; this.onStatus = () => {}; this.onWelcome = () => {};
    try { this.resume = room ? sessionStorage.getItem(tokenKey(role, room)) ?? '' : ''; } catch { /* ignore */ }
    this.connect();
  }

  /** Failed connection attempts in a row (0 once connected). */
  get failures() { return this.tries; }
  /** Current server clock (ms), for countdowns. */
  now() { return Date.now() + this.offset; }

  send(msg) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  pick(team) { this.send({ type: 'pick', team }); }

  close() {
    this.closed = true;
    this.setStatus('closed');
    clearInterval(this.pingTimer); clearTimeout(this.retryTimer);
    try { this.ws?.close(1000, 'bye'); } catch { /* ignore */ }
    this.ws = null;
  }

  setStatus(s) {
    if (s === this.status) return;
    this.status = s;
    this.onStatus(s);
  }

  connect() {
    if (this.closed) return;
    const q = new URLSearchParams({ build: MARKER, role: this.role });
    if (this.room) q.set('room', this.room);
    if (this.resume) q.set('resume', this.resume);
    let ws;
    try { ws = new WebSocket(`${this.server}/ws?${q}`); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.setStatus('open');
      const ping = () => this.send({ type: 'ping', t: Date.now() });
      ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(ping, 5000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      this.handle(msg);
    };
    ws.onclose = (ev) => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      // 4003 not host / 4404 no room: retrying will not help.
      if (ev.code === 4003 || ev.code === 4404 || this.error) { this.closed = true; this.setStatus('closed'); return; }
      if (ev.code === 4004) { this.team = -1; this.resume = ''; this.saveToken(); }
      this.retry();
    };
  }

  retry() {
    if (this.closed) return;
    this.setStatus('retrying');
    const wait = Math.min(8000, 700 * 2 ** this.tries++);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), wait);
  }

  saveToken() {
    try {
      if (!this.room) return;
      if (this.resume) sessionStorage.setItem(tokenKey(this.role, this.room), this.resume);
      else sessionStorage.removeItem(tokenKey(this.role, this.room));
    } catch { /* ignore */ }
  }

  handle(msg) {
    switch (msg.type) {
      case 'welcome':
        this.room = String(msg.room ?? this.room);
        this.team = typeof msg.team === 'number' ? msg.team : -1;
        if (typeof msg.resume === 'string' && msg.resume) this.resume = msg.resume;
        this.saveToken();
        this.onWelcome(this.team);
        break;
      case 'state':
        if (this.state && msg.seq < this.state.seq && msg.serverTime <= this.state.serverTime) return;
        this.state = msg;
        if (this.team >= 0 && !msg.teams[this.team]?.claimed) this.team = -1;
        this.onState(msg);
        break;
      case 'pong': {
        const rtt = Date.now() - Number(msg.t);
        if (Number.isFinite(rtt) && rtt >= 0 && rtt < 5000) {
          const off = Number(msg.serverTime) + rtt / 2 - Date.now();
          this.offset = this.offset === 0 ? off : this.offset * 0.7 + off * 0.3;
        }
        break;
      }
      case 'judged': this.onJudged(msg); break;
      case 'pose': this.onPose(msg); break;
      case 'error':
        if (msg.code === 'no_room') this.error = 'no_room';
        this.onError(String(msg.code), msg);
        break;
    }
  }
}

/** mm:ss */
export const fmtTime = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
