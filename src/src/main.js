// App shell: renderer, WebXR sessions (VR / passthrough), flat-screen controls, pointers.
import * as THREE from 'three';
import { createEnvironment } from './environment.js';
import { Game } from './game.js';
import { sfx } from './audio.js';
import { t, applyDom, onLangChange } from './i18n.js';
import { serverUrl } from './net/room.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
applyDom();

// ------------------------------------------------------------------ optional WebXR emulator for desktop testing
if (params.has('iwer')) {
  try {
    const { XRDevice, metaQuest3 } = await import('../vendor/iwer.module.js');
    const device = new XRDevice(metaQuest3);
    device.installRuntime({ forceInstall: true });
    device.position.set(0, 1.6, 0);
    window.__xrDevice = device;
    console.info('[iwer] Meta Quest 3 emulation installed');
  } catch (e) { console.warn('iwer failed', e); }
}

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
$('stage').appendChild(renderer.domElement);
renderer.domElement.style.touchAction = 'none';

const scene = new THREE.Scene();
const BG = new THREE.Color(0x02030a);
scene.background = BG;
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.03, 80);

scene.add(new THREE.HemisphereLight(0xa9c4ff, 0x2a0f4a, 1.25));
const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(1.5, 3, 2.5); scene.add(sun);
const cyanLight = new THREE.PointLight(0x38e8ff, 6, 5, 1.6); cyanLight.position.set(-1.2, 1.9, -0.6); scene.add(cyanLight);
const pinkLight = new THREE.PointLight(0xff3df2, 5, 5, 1.6); pinkLight.position.set(1.2, 1.9, -0.6); scene.add(pinkLight);

const env = createEnvironment(scene);
const game = new Game();
scene.add(game.world);
window.__game = game; window.__scene = scene; window.__camera = camera;

// ------------------------------------------------------------------ mode handling
let mode = 'desktop';
let support = { vr: false, ar: false };
let pendingMode = null;
let placeWorld = false;

function applyMode(m) {
  mode = m;
  env.setMode(m);
  const mr = m === 'passthrough';
  scene.background = mr ? null : BG;
  renderer.setClearColor(0x000000, mr ? 0 : 1);
  game.setMode(m, support);
  document.body.dataset.mode = m;
  $('toolbar').classList.toggle('hidden', m !== 'desktop');
}

async function detectSupport() {
  if (!navigator.xr) return;
  try { support.vr = await navigator.xr.isSessionSupported('immersive-vr'); } catch { /* ignore */ }
  try { support.ar = await navigator.xr.isSessionSupported('immersive-ar'); } catch { /* ignore */ }
  game.setMode(mode, support);
  for (const [id, ok] of [['btn-vr', support.vr], ['btn-mr', support.ar], ['tb-vr', support.vr], ['tb-mr', support.ar]]) {
    const b = $(id); if (b) b.disabled = !ok;
  }
  setNote(() => !navigator.xr ? t('xr.none') : !support.vr && !support.ar ? t('xr.nosession') : t('xr.ready', { vr: support.vr ? '✓' : '✗', ar: support.ar ? '✓' : '✗' }));
}

// the note under the mode buttons is re-worded when the language changes
let noteFn = null;
function setNote(fn) { noteFn = fn; $('xr-note').textContent = fn ? fn() : ''; }
onLangChange(() => { if (noteFn) $('xr-note').textContent = noteFn(); });

async function startSession(m) {
  const type = m === 'passthrough' ? 'immersive-ar' : 'immersive-vr';
  const session = await navigator.xr.requestSession(type, {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking', 'bounded-floor', 'layers'],
  });
  session.addEventListener('end', onSessionEnd);
  applyMode(m);
  await renderer.xr.setSession(session);
  placeWorld = true;
  $('overlay').classList.add('hidden');
  sfx.unlock();
}

function onSessionEnd() {
  game.world.position.set(0, 0, 0); game.world.rotation.set(0, 0, 0);
  game.heightOffset = game.heightOffset; // keep the user's height preference
  applyMode('desktop');
  if (pendingMode) {
    const m = pendingMode; pendingMode = null;
    startSession(m).catch((e) => {
      console.warn('could not start', m, e);
      $('overlay').classList.remove('hidden');
      setNote(() => t('xr.press', { btn: t(m === 'vr' ? 'tb.vr' : 'tb.mr') }));
    });
  }
}

async function switchMode(m) {
  const cur = renderer.xr.getSession();
  if (m === 'desktop') { cur?.end(); return; }
  if (cur) { pendingMode = m; cur.end(); return; }
  try { await startSession(m); } catch (e) { console.warn(e); setNote(() => t('xr.fail', { err: e.message || e })); $('overlay').classList.remove('hidden'); }
}

game.hooks.switchMode = (m) => switchMode(m);
game.hooks.setFloor = (f) => { env.setFloor(f); try { localStorage.setItem('floor', f); } catch { /* ignore */ } };
game.hooks.setHeight = () => { /* applied per frame */ };
game.hooks.recenter = () => { if (renderer.xr.isPresenting) xrPlaceWorld(); };   // Options > Center: the scene moves to where you are and faces where you look
try { const f = localStorage.getItem('floor'); if (f) { game.floor = f; env.setFloor(f); } } catch { /* ignore */ }

$('btn-vr').onclick = () => switchMode('vr');
$('btn-mr').onclick = () => switchMode('passthrough');
$('btn-flat').onclick = () => { $('overlay').classList.add('hidden'); sfx.unlock(); };
$('tb-vr').onclick = () => switchMode('vr');
$('tb-mr').onclick = () => switchMode('passthrough');
$('tb-help').onclick = () => $('overlay').classList.remove('hidden');
$('tb-floor').onclick = () => game.setFloor(game.floor === 'hex' ? 'checker' : 'hex');
// group challenge: join with a code from the start screen (before entering VR), ?room=1234, or after a page reload
const groupNote = $('group-note');
let groupNoteFn = null;
const setGroupNote = (fn) => { groupNoteFn = fn; groupNote.textContent = fn ? fn() : ''; };
onLangChange(() => { if (groupNoteFn) groupNote.textContent = groupNoteFn(); });
game.hooks.groupChanged = (code) => { setGroupNote(code ? () => t('ov.group.ok', { code }) : null); if (!code) document.querySelector('#group-form input').value = ''; };
$('group-form').onsubmit = (e) => {
  e.preventDefault();
  const code = e.target.room.value.replace(/\D/g, '');
  if (code.length !== 4) { setGroupNote(() => t('ov.group.bad')); return; }
  if (!serverUrl()) { setGroupNote(() => t('ov.group.noserver')); return; }
  game.group.join(code);
};
try {
  const code = params.get('room') ?? sessionStorage.getItem('foldquest-room-current') ?? '';
  if (/^\d{4}$/.test(code) && serverUrl()) { document.querySelector('#group-form input').value = code; game.group.join(code); }
} catch { /* ignore */ }

$('tb-skip').onclick = () => { if (game.phase === 'intro') game.skipTutorial(); };
for (const b of document.querySelectorAll('[data-floor]')) b.onclick = () => { game.setFloor(b.dataset.floor); };
for (const b of document.querySelectorAll('[data-lang]')) b.onclick = () => game.changeLang(b.dataset.lang);

// ------------------------------------------------------------------ pointers
const raycaster = new THREE.Raycaster();
const mkPointer = (kind) => ({ kind, origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), quat: null, isHand: false, handQuat: null, squeeze: false, spin: 0, tilt: 0, dragSpin: 0, dragTilt: 0, pressed: false, prevPressed: false, holding: null, holdDist: 1, holdDelta: 0, captured: false, hit: null, hitDist: 3, haptic: null });
const mouse = mkPointer('mouse');
const xrPointers = [mkPointer('xr0'), mkPointer('xr1')];
xrPointers.forEach((p) => (p.quat = new THREE.Quaternion()));
window.__mouse = mouse;
window.__xrPointers = xrPointers;
const controllers = [];
const ndc = new THREE.Vector2();
const rayMat = new THREE.LineBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.85, toneMapped: false });

for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  scene.add(c);
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(geo, rayMat); line.name = 'ray'; c.add(line);
  const nub = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  c.add(nub);
  const reticle = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3df2, toneMapped: false }));
  reticle.visible = false; scene.add(reticle);
  c.userData = { line, reticle, source: null, ptr: xrPointers[i] };
  c.addEventListener('selectstart', () => { xrPointers[i].pressed = true; });
  c.addEventListener('selectend', () => { xrPointers[i].pressed = false; });
  c.addEventListener('squeezestart', () => { xrPointers[i].squeeze = true; });
  c.addEventListener('squeezeend', () => { xrPointers[i].squeeze = false; });
  c.addEventListener('connected', (e) => {
    c.userData.source = e.data;
    xrPointers[i].haptic = (s, ms) => { try { e.data.gamepad?.hapticActuators?.[0]?.pulse(s, ms); } catch { /* ignore */ } };
  });
  c.addEventListener('disconnected', () => { c.userData.source = null; xrPointers[i].haptic = null; xrPointers[i].pressed = false; xrPointers[i].squeeze = false; });
  controllers.push(c);
  const hand = renderer.xr.getHand(i); scene.add(hand);
  c.userData.hand = hand;
}

function decorateHands() {
  for (const c of controllers) {
    const hand = c.userData.hand;
    if (!hand?.joints) continue;
    for (const j of Object.values(hand.joints)) {
      if (j.userData.viz) continue;
      j.userData.viz = true;
      j.add(new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 6), new THREE.MeshBasicMaterial({ color: 0x38e8ff, transparent: true, opacity: 0.8, toneMapped: false })));
    }
  }
}

// ------------------------------------------------------------------ flat-screen camera
// First-person: the camera sits where a standing player's head would be and you look around.
const look = { yaw: 0, pitch: -0.05, fov: 66 };
window.__look = look;
const EYE = new THREE.Vector3(0, 1.55, 0.85);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
function placeCamera() {
  camera.position.copy(EYE);
  _euler.set(look.pitch, look.yaw, 0);
  camera.quaternion.setFromEuler(_euler);
  // keep the horizontal view of a 16:9 screen even in tall / square windows
  const fov = 2 * Math.atan(Math.tan(look.fov * Math.PI / 360) * Math.max(1, (16 / 9) / camera.aspect)) * 180 / Math.PI;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
}
placeCamera();

const el = renderer.domElement;
el.addEventListener('pointerdown', (e) => {
  updateNdc(e);
  if (e.button === 0) { mouse.pressed = true; try { el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ } }
  sfx.unlock();
});
el.addEventListener('pointerup', (e) => { if (e.button === 0) mouse.pressed = false; });
el.addEventListener('pointercancel', () => { mouse.pressed = false; });
el.addEventListener('contextmenu', (e) => e.preventDefault());
el.addEventListener('pointermove', (e) => {
  updateNdc(e);
  // right-drag turns whatever is held (left-drag also turns the tutorial molecule)
  if (mouse.holding && ((e.buttons & 2) || (mouse.holding.isDemo && (e.buttons & 1)))) { mouse.dragSpin += e.movementX * 0.012; mouse.dragTilt += e.movementY * 0.012; }
  if (mouse.pressed && !mouse.captured && !mouse.holding && mouse.prevPressed) {
    look.yaw = THREE.MathUtils.clamp(look.yaw + e.movementX * 0.004, -1.3, 1.3);
    look.pitch = THREE.MathUtils.clamp(look.pitch + e.movementY * 0.004, -0.8, 0.5);
  }
});
el.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (mouse.holding) mouse.holdDelta += -Math.sign(e.deltaY) * 0.08;
  else look.fov = THREE.MathUtils.clamp(look.fov + Math.sign(e.deltaY) * 3, 35, 100);
}, { passive: false });
function updateNdc(e) {
  const r = el.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
const held = new Set();
addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  held.add(e.key.toLowerCase());
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { if (game.phase === 'intro') game.setStep(game.step + 1 > 5 ? 5 : game.step + 1); if (e.key === ' ') e.preventDefault(); }
  else if (e.key === 'ArrowLeft' && game.phase === 'intro') game.setStep(game.step - 1);
  else if (e.key === 'h' || e.key === 'H') game.hint();
  else if (e.key === 'r' || e.key === 'R') game.restart();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ main loop
const timer = new THREE.Timer();
const tmpQ2 = new THREE.Quaternion(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), headPos = new THREE.Vector3();
let frames = 0;

function xrPlaceWorld() {
  const cam = renderer.xr.getCamera();
  cam.getWorldPosition(headPos);
  cam.getWorldQuaternion(tmpQ);
  tmpV.set(0, 0, -1).applyQuaternion(tmpQ);
  const yaw = Math.atan2(-tmpV.x, -tmpV.z);
  game.world.rotation.set(0, yaw, 0);
  game.world.position.set(headPos.x, 0, headPos.z);
}

function frame() {
  timer.update();
  const dt = timer.getDelta(), t = timer.getElapsed();
  frames++;
  env.update(t);
  const xr = renderer.xr.isPresenting;
  if (xr && placeWorld && frames > 3) { xrPlaceWorld(); placeWorld = false; }
  game.world.position.y = xr ? game.heightOffset : 0;
  game.world.updateMatrixWorld(true);

  const pointers = [];
  if (!xr) {
    placeCamera();
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    mouse.origin.copy(raycaster.ray.origin); mouse.dir.copy(raycaster.ray.direction);
    mouse.spin = ((held.has('e') ? 1 : 0) - (held.has('q') ? 1 : 0)) * dt * 2 + mouse.dragSpin;
    mouse.tilt = ((held.has('x') ? 1 : 0) - (held.has('z') ? 1 : 0)) * dt * 2 + mouse.dragTilt;
    pointers.push(mouse);
    for (const c of controllers) c.userData.reticle.visible = false;
  } else {
    decorateHands();
    for (const c of controllers) {
      const ptr = c.userData.ptr;
      c.updateMatrixWorld(true);
      c.getWorldPosition(ptr.origin);
      c.getWorldQuaternion(tmpQ);
      ptr.quat.copy(tmpQ);
      // hands: orientation of the wrist joint (smoothed), independent of where the aiming ray points
      const src = c.userData.source;
      ptr.isHand = !!ptr.forceHand || !!src?.hand;
      if (ptr.testHandQuat) ptr.handQuat = ptr.testHandQuat;
      else if (src?.hand) {
        const wrist = c.userData.hand?.joints?.wrist;
        if (wrist) {
          wrist.getWorldQuaternion(tmpQ2);
          if (!ptr.handQuat) ptr.handQuat = tmpQ2.clone(); else ptr.handQuat.slerp(tmpQ2, 0.5);
        }
      } else ptr.handQuat = null;
      ptr.dir.set(0, 0, -1).applyQuaternion(tmpQ).normalize();
      const gp = c.userData.source?.gamepad;
      const ay = gp && gp.axes.length > 3 ? gp.axes[3] : 0;
      ptr.holdDelta = Math.abs(ay) > 0.2 ? -ay * dt * 1.2 : 0;
      const ax = gp && gp.axes.length > 2 ? gp.axes[2] : 0;
      ptr.spin = Math.abs(ax) > 0.25 ? ax * dt * 2.2 : 0;
      const active = !!c.userData.source;
      if (active) pointers.push(ptr);
      c.userData.line.visible = active;
    }
  }

  game.update(dt, t, pointers, raycaster);
  mouse.holdDelta = 0; mouse.dragSpin = 0; mouse.dragTilt = 0;

  // ray / reticle visuals
  if (xr) {
    for (const c of controllers) {
      const ptr = c.userData.ptr, ret = c.userData.reticle;
      const d = ptr.hit ? ptr.hitDist : 2.2;
      c.userData.line.scale.z = d;
      c.userData.line.material.color.setHex(ptr.pressed ? 0xff3df2 : 0x38e8ff);
      ret.visible = !!ptr.hit && !!c.userData.source;
      if (ptr.hit) ret.position.copy(ptr.hit);
    }
  } else {
    el.style.cursor = mouse.holding ? 'grabbing' : mouse.hit ? 'pointer' : 'grab';
  }
  renderer.render(scene, camera);
}

applyMode('desktop');
if (['1', '2', '3'].includes(params.get('level'))) game.setLevel(+params.get('level'), (parseInt(params.get('protein')) || 1) - 1);
detectSupport();
renderer.setAnimationLoop(frame);
$('loading')?.remove();

// ------------------------------------------------------------------ dev helpers (?dev) for scripted testing
if (params.has('dev')) {
  $('overlay').classList.add('hidden');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const screen = (obj) => { const v = obj.getWorldPosition(new THREE.Vector3()).project(camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; };
  const fire = (t, x, y) => el.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, button: 0, buttons: t === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true }));
  window.__dev = {
    sleep, screen, fire, eye: EYE,
    look: (yaw, pitch, fov) => { look.yaw = yaw; look.pitch = pitch; if (fov) look.fov = fov; return sleep(250); },
    /** Level 1: drag piece i so that its tip meets the matching tip of piece j */
    async dragPiece(i, j) {
      const l1 = game.l1, a = l1.pieces[i], b = l1.pieces[j];
      const [wa, wb] = j === i + 1 ? ['C', 'N'] : ['N', 'C'];
      const delta = l1.tipWorld(b, wb).sub(l1.tipWorld(a, wa));
      const from = a.chain.group.position.clone(), to = from.clone().add(delta);
      const proj = (v) => { const p = v.clone().project(camera); return [(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight]; };
      const [x0, y0] = proj(from), [x1, y1] = proj(to);
      fire('pointermove', x0, y0); await sleep(150);
      fire('pointerdown', x0, y0); await sleep(200);
      for (let k = 1; k <= 14; k++) { fire('pointermove', x0 + (x1 - x0) * k / 14, y0 + (y1 - y0) * k / 14); await sleep(40); }
      await sleep(500); fire('pointerup', x1, y1);
    },
    /** drag chain index -> vessel index with realistic timing */
    async drag(ci, vi, hold = 250) {
      const c = game.chains[ci], v = game.vessels[vi];
      const [x0, y0] = screen(c.group), [x1, y1] = screen(v.group);
      fire('pointermove', x0, y0); await sleep(150);
      fire('pointerdown', x0, y0); await sleep(200);
      for (let i = 1; i <= 14; i++) { fire('pointermove', x0 + (x1 - x0) * i / 14, y0 + (y1 - y0) * i / 14); await sleep(40); }
      await sleep(hold); fire('pointerup', x1, y1);
    },
  };
}
