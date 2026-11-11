// Everything in one scene: the highlights row (apple.com's "Get the highlights"), one big card per LH home beyond the
// story's: LH_17763, LH_17764, LH_17766, each its scan and one PASS recording (data/viewer.json, build_viewer.py).
// The card in front plays live (the page's one canvas moves to it, engine.js shared(); the others show a still):
//   the camera sweeps slowly round the operator from a vantage clear of the scene, aimed at them as they move, and a
//   drag turns it a little further (the wheel stays the page's);
//   Ego view flies through the head camera's frustum into the recorded camera itself: the scan rendered from its pose
//   and the frame it recorded on the frustum's far plane (one projection), a slider between them, MANO as estimated;
//   captions on the recording's clock: sub-task, action, this frame's interaction and hand states, the window as tracks.
// Each card plays its window once, then the row moves on to the next (dots and play / pause under it, as Apple's);
// dragging or the ego view stops the row moving on, play starts it again.
import * as THREE from 'three';
import { shared, pose, basis } from './engine.js';
import { drawCaptions, captionsAt } from './panel.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (u) => u * u * (3 - 2 * u);
const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
const lerp = (a, b, u) => a + (b - a) * u;
const DEG = Math.PI / 180, FPS = 30;
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

const sec = $('#viewer'), track = $('#hlTrack'), cardEls = [...sec.querySelectorAll('.hlc')], live = $('#hlLive');
const dotsEl = $('#hlDots'), playEl = $('#hlPlay'), modeEl = $('#hlMode');
const frameEl = $('#egoFrame'), blendEl = $('#egoBlend'), amtEl = $('#egoAmt'), capsEl = $('#vwCaps'), tlC = $('#vcTl');
const tagsEl = $('#vwTags'), linesEl = $('#vwLines');
const capEl = Object.fromEntries([...capsEl.querySelectorAll('[data-c]')].map((e) => [e.dataset.c, e]));

const SWEEP = 7 * DEG, PUSH = 0.35;              // the slow move: ±7° round the operator, 0.35 m in, once a play
const LIM = { y: 0.3, p0: -0.1, p1: 0.16 };       // how far a drag turns it (rad)
const LV3 = { body: 1, hands: 1, frustum: 0.55, image: 0.7, trail: 0 };

let E = null, cards = [], ci = 0, mode = '3d', trans = null, cur = null, amt = 0.5;
let playing = true, auto = true, ended = false, drag = null, tagA = 0, aimS = null, panelF = -1;
const off = { yaw: 0, pitch: 0, vy: 0, vp: 0 };
const lv = { body: 0, hands: 0, frustum: 0, image: 0, trail: 0 };

// ---------------------------------------------------------------- the row
const dots = cardEls.map((el, i) => {
  const b = document.createElement('button');
  b.type = 'button'; b.innerHTML = '<i></i>'; b.setAttribute('aria-label', el.getAttribute('aria-label'));
  b.addEventListener('click', () => { goCard(i); });
  dotsEl.appendChild(b);
  el.addEventListener('click', () => { if (i !== ci) goCard(i); });
  return b;
});
const pad = () => parseFloat(getComputedStyle(track).paddingLeft) || 0;
function goCard(i) {
  i = Math.max(0, Math.min(cardEls.length - 1, i));
  track.scrollTo({ left: cardEls[i].offsetLeft - pad(), behavior: 'smooth' });
  syncDots(i);
}
function syncDots(i) { dots.forEach((d, k) => d.classList.toggle('on', k === i)); }
function setPlay() {
  playEl.classList.toggle('paused', !playing || !auto);
  playEl.classList.toggle('replay', ended);
  playEl.setAttribute('aria-label', ended ? 'Replay' : playing && auto ? 'Pause' : 'Play');
}
playEl.addEventListener('click', () => {
  if (ended) { ended = false; playing = auto = true; goCard(0); }
  else if (playing && auto) { playing = false; auto = false; }
  else { playing = auto = true; }
  setPlay();
});

// ---------------------------------------------------------------- the card in front
function enter() {
  const i = Number(E.slot?.dataset.card ?? 0);
  if (i !== ci || !cur) {
    ci = i; mode = '3d'; trans = null; cur = null; aimS = null; panelF = -1;
    off.yaw = off.pitch = off.vy = off.vp = 0;
    const c = cards[ci];
    if (c) { c.t = 0; c.played = false; }
  }
  cardEls.forEach((el, k) => el.classList.toggle('on', k === ci));
  cardEls[ci].appendChild(live);
  syncDots(ci); syncMode();
}
// where the recorded frame sits on the card in the ego view: as large as fits under the caption, over the slider
function egoRect() {
  const K = cards[ci].rec.K, W = E.W, H = E.H, tall = W / H < 1;   // (the caption steps aside in the ego view)
  const ax0 = 16, ax1 = W - 16, ay0 = tall ? 64 : 48, ay1 = H - (tall ? 118 : 66);
  const s = Math.max(0.05, Math.min((ax1 - ax0) / K.w, (ay1 - ay0) / K.h)), w = K.w * s, h = K.h * s;
  return { x: (ax0 + ax1) / 2 - w / 2, y: (ay0 + ay1) / 2 - h / 2, w, h, s };
}
// a vantage's FOV on this card: as set on a wide card; on a tall one about as wide across as on a wide one
function fovFor(fov) {
  const a = E.W / E.H;
  if (a >= 1.3) return fov;
  const hf = Math.atan(Math.tan((fov * DEG) / 2) * (16 / 9) * 0.62);
  return Math.min(86, Math.max(fov, (2 * Math.atan(Math.tan(hf) / a)) / DEG));
}
// the camera in 3D: the vantage swept round the operator and pushed in over one play, turned by the drag, aimed at
// the operator (smoothed) as much as at the vantage's own target
function pose3d(c, f, dt) {
  const r = c.rec, chest = r.joint(f, 9);
  aimS = aimS ? aimS.lerp(chest, 1 - Math.exp(-dt * 2.2)) : chest.clone();
  const base = pose(c.pos, c.look, fovFor(c.fov)), u = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, c.t / c.T));
  const p = { ...base, yaw: base.yaw + (u - 0.5) * 2 * SWEEP + off.yaw, pitch: base.pitch + off.pitch, dist: base.dist - PUSH * u };
  const pos = basis(p).pos, aim = new THREE.Vector3(...c.look).lerp(aimS, 0.6);
  return { ...pose(pos.toArray(), aim.toArray(), base.fov), near: c.near, dx: 0, dy: -0.03 * E.H };
}
const _mb = new THREE.Matrix4();
function stateOf(p) {
  const b = basis(p);
  return { pos: b.pos, quat: new THREE.Quaternion().setFromRotationMatrix(_mb.makeBasis(b.x, b.y, b.z)), fov: p.fov, near: p.near ?? 0.05, dx: p.dx ?? 0, dy: p.dy ?? 0 };
}
function mixState(a, b, u) {
  return { pos: a.pos.clone().lerp(b.pos, u), quat: a.quat.clone().slerp(b.quat, u), fov: lerp(a.fov, b.fov, u),
    near: Math.exp(lerp(Math.log(a.near), Math.log(b.near), u)), dx: lerp(a.dx, b.dx, u), dy: lerp(a.dy, b.dy, u) };
}
// the head camera at frame f, its projection set so the recorded frame fills egoRect (principal point = image centre)
function egoState(f) {
  const r = cards[ci].rec, { pos, quat } = r.egoPose(f), q = egoRect(), fpx = q.s * r.K.fy;
  return { pos, quat, fov: (2 * Math.atan(E.H / 2 / fpx)) / DEG, near: 0.05, dx: q.x + q.w / 2 - E.W / 2, dy: q.y + q.h / 2 - E.H / 2 };
}
function applyState(s) {
  const cam = E.camera;
  cam.position.copy(s.pos); cam.quaternion.copy(s.quat); cam.fov = s.fov; cam.near = s.near;
  if (Math.abs(s.dx) > 0.5 || Math.abs(s.dy) > 0.5) cam.setViewOffset(E.W, E.H, -s.dx, -s.dy, E.W, E.H); else cam.clearViewOffset();
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}
// 0 outside the head camera, 1 at it (and between, on the way in or out)
const egoIn = () => (trans ? (trans.dir > 0 ? smoother(trans.u) : 1 - smoother(trans.u)) : mode === 'ego' ? 1 : 0);
function setMode(m) {
  if (m === mode || !cards[ci]?.rec || !cur) return;
  mode = m; auto = false; setPlay();
  trans = { dir: m === 'ego' ? 1 : -1, t0: performance.now(), dur: m === 'ego' ? 1700 : 1300, from: cur, u: 0 };
  syncMode();
}
function syncMode() { for (const b of modeEl.children) b.setAttribute('aria-pressed', String(b.dataset.m === mode)); }
modeEl.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });

// ---------------------------------------------------------------- per frame (engine.js calls this in 'viewer' mode)
function frame(now, dt) {
  const c = cards[ci];
  E.world.visible = false;                       // the story's scan stays in the story
  E.rec?.show({ alpha: 0 });
  if (!c?.rec) return { rec: null };
  for (const k of cards) if (k.sp) k.sp.world.visible = k === c;
  E.grid.position.y = c.sp.floorY - 0.003;
  E.cutPlane.position.set(0, c.sp.floorY + 30, 0);   // every view here is at eye height: the ceiling stays
  E.galleryRec = c.rec;
  const r = c.rec;
  // the clock; in the ego view it waits for each frame to be decoded, so the render and the frame never disagree
  const t0 = c.t;
  if (playing) c.t += dt;
  let f = r.f0 + (Math.floor(c.t * FPS) % r.len);
  if (egoIn() > 0.5 && !r.bm.has(f)) { r.image(f); c.t = t0; f = r.f0 + (Math.floor(c.t * FPS) % r.len); }
  if (c.t >= c.T) {                              // one play: on to the next home, or round again
    c.t -= c.T;
    if (auto && playing) { if (ci < cards.length - 1) goCard(ci + 1); else { ended = true; auto = false; setPlay(); } }
  }
  // the drag's inertia and limits
  if (!drag) { off.yaw += off.vy; off.pitch += off.vp; const k = Math.pow(0.9, dt * 60); off.vy *= k; off.vp *= k; }
  off.yaw = Math.max(-LIM.y, Math.min(LIM.y, off.yaw)); off.pitch = Math.max(LIM.p0, Math.min(LIM.p1, off.pitch));
  // the camera
  const p3 = pose3d(c, f, dt);
  if (trans) {
    trans.u = span(now, trans.t0, trans.t0 + trans.dur);
    const target = trans.dir > 0 ? egoState(f) : stateOf(p3);
    cur = mixState(trans.from, target, smoother(trans.u));
    if (trans.u >= 1) trans = null;
  } else cur = mode === 'ego' ? egoState(f) : stateOf(p3);
  applyState(cur);
  // the layers: into the head camera the frustum lights as the camera reaches it and goes as it passes through, the
  // body fades, and the frame on its far plane settles at the slider's blend
  const e = egoIn(), T = { ...LV3 };
  if (e > 0) {
    T.body = lerp(1, 0, smooth(span(e, 0.35, 0.8)));
    T.frustum = 1 - smooth(span(e, 0.72, 0.97));
    T.image = lerp(0.95, amt, smooth(span(e, 0.82, 1)));
  }
  const k = 1 - Math.exp(-dt * 6), ki = 1 - Math.exp(-dt * (e > 0.95 ? 18 : 6));
  for (const n of Object.keys(lv)) lv[n] += (T[n] - lv[n]) * (n === 'image' ? ki : k);
  if (e > 0.9) lv.body = 0;
  return { rec: r, f, raw: e > 0.6, levels: { ...lv, ego: e > 0.5 } };
}

// ---------------------------------------------------------------- per rendered frame: the card around the canvas
const TAGS = [
  { at: (r, f) => r.joint(f, 9), name: 'Body', em: 'SMPL-H', c: '#9cc3ff', dx: -150, dy: -56 },
  { at: (r, f) => r.hand(f, 1) ?? r.joint(f, 21), name: 'Hands', em: 'MANO', c: '#ff9f43', dx: 120, dy: -70 },
];
const tagEls = TAGS.map((t) => {
  const el = document.createElement('div'); el.className = 'vw-tag'; el.innerHTML = `<span><i style="background:${t.c}"></i><b>${t.name}</b><em>${t.em}</em></span>`; tagsEl.appendChild(el);
  const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line'), dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('r', '3.5'); linesEl.append(ln, dot);
  return { el, ln, dot };
});
function onFrame(f, r) {
  const c = cards[ci], card = cardEls[ci];
  if (!r || !c || r !== c.rec) return;
  E.slot.classList.add('live');
  const e = egoIn();
  card.classList.toggle('ego-on', mode === 'ego' && e > 0.92);
  card.classList.toggle('ego-in', mode === 'ego');
  dots[ci].style.setProperty('--p', `${(100 * Math.min(1, c.t / c.T)).toFixed(1)}%`);
  if (mode === 'ego' || e > 0) {
    const q = egoRect();
    Object.assign(frameEl.style, { left: `${q.x}px`, top: `${q.y}px`, width: `${q.w}px`, height: `${q.h}px` });
    blendEl.style.transform = `translate(${q.x + q.w / 2 - blendEl.offsetWidth / 2}px, ${q.y + q.h + 12}px)`;
  }
  if (f !== panelF) { panelF = f; drawCaptions(capEl, f, r); $('#vcClock').textContent = fmt(f / FPS); tracks(f, r); }
  // labels on the body and hands, once the camera is not flying
  tagA += ((mode === '3d' && !trans && !drag ? 1 : 0) - tagA) * 0.15;
  tagsEl.style.opacity = linesEl.style.opacity = String(tagA);
  if (tagA < 0.01) return;
  const W = E.W, H = E.H, capBox = capsEl.getBoundingClientRect(), cardBox = card.getBoundingClientRect();
  const capt = card.querySelector('.hlc-cap'), x1 = W / H > 1 ? capBox.left - cardBox.left - 12 : W - 12, y0 = capt.offsetTop + capt.offsetHeight + 22;
  TAGS.forEach((t, i) => {
    const T = tagEls[i], a = t.at(r, f), p = a ? E.project(a) : null;
    T.el.style.display = T.ln.style.display = T.dot.style.display = p ? '' : 'none';
    if (!p) return;
    const w = T.el.firstChild.offsetWidth;
    const lx = Math.max((t.dx < 0 ? w : 0) + 12, Math.min(x1 - (t.dx > 0 ? w : 0), p[0] + t.dx)), ly = Math.max(y0, Math.min(H - 90, p[1] + t.dy));
    T.el.classList.toggle('left', t.dx < 0);
    T.el.style.transform = `translate(${lx}px, ${ly}px)`;
    T.ln.setAttribute('x1', p[0]); T.ln.setAttribute('y1', p[1]); T.ln.setAttribute('x2', lx); T.ln.setAttribute('y2', ly);
    T.dot.setAttribute('cx', p[0]); T.dot.setAttribute('cy', p[1]);
  });
}
// the window as tracks: sub-task and action spans, each hand's state, the playhead; what is to come dimmer
function tracks(f, r) {
  const c = tlC.getContext('2d'), w = tlC.width, h = tlC.height, cap = r.caption, a = r.f0, b = r.f0 + r.len;
  const lx = 118, X = (q) => lx + ((Math.max(a, Math.min(b, q)) - a) / (b - a)) * (w - lx), rows = ['Sub-task', 'Action', 'Left', 'Right'];
  const rh = 26, gap = 12, top = 4;
  c.clearRect(0, 0, w, h);
  c.font = '600 19px "SF Mono", Menlo, monospace'; c.textBaseline = 'middle'; c.textAlign = 'left';
  const block = (y, s, e2, col) => { const x0 = X(s), x1 = X(e2 + 1); if (x1 - x0 < 1) return; c.fillStyle = col; c.beginPath(); c.roundRect(x0 + 1, y, x1 - x0 - 2, rh, 5); c.fill(); };
  rows.forEach((name, i) => {
    const y = top + i * (rh + gap);
    c.fillStyle = '#86868b'; c.fillText(name.toUpperCase(), 0, y + rh / 2 + 1);
    c.fillStyle = 'rgba(255,255,255,0.06)'; c.beginPath(); c.roundRect(lx, y, w - lx, rh, 5); c.fill();
  });
  cap.segments.filter((s) => s.e >= a && s.s < b).forEach((s, i) => block(top, s.s, s.e, i % 2 ? 'rgba(204,255,160,0.34)' : 'rgba(204,255,160,0.52)'));
  cap.actions.filter((s) => s.e >= a && s.s < b).forEach((s, i) => block(top + rh + gap, s.s, s.e, i % 2 ? 'rgba(156,195,255,0.4)' : 'rgba(156,195,255,0.6)'));
  const Hs = cap.hands;
  for (const side of [0, 1]) {
    const y = top + (2 + side) * (rh + gap);
    for (let i = 0; i < Hs.length; i++) {
      const s = Hs[i].f, e2 = (Hs[i + 1]?.f ?? b) - 1;
      if (e2 < a || s >= b) continue;
      const st = side ? Hs[i].right : Hs[i].left;
      if (!st?.visible) continue;
      block(y, s, e2, st.holding ? 'rgba(255,179,107,0.85)' : st.grasp ? 'rgba(255,179,107,0.45)' : 'rgba(245,245,247,0.16)');
    }
  }
  const px = X(f), bottom = top + 4 * (rh + gap) - gap;
  c.fillStyle = 'rgba(16,17,18,0.5)'; c.fillRect(px, 0, w - px, bottom);
  c.fillStyle = '#f5f5f7'; c.fillRect(px - 1.5, 0, 3, bottom);
  c.fillStyle = '#86868b'; c.font = '500 18px "SF Mono", Menlo, monospace';
  const yb = bottom + 16;
  c.fillText(fmt(a / FPS), lx, yb);
  c.textAlign = 'right'; c.fillText(fmt(b / FPS), w, yb);
  c.textAlign = 'left';
}

// ---------------------------------------------------------------- controls
amtEl.addEventListener('input', () => { amt = Number(amtEl.value); });
// drag to look around with the mouse (not in the ego view, nor while the camera flies); a touch swipes the row or the
// page instead
track.addEventListener('pointerdown', (e) => {
  const card = e.target.closest('.hlc');
  if (!card || Number(card.dataset.i) !== ci || mode === 'ego' || trans || e.target.closest('button, input') || e.pointerType === 'touch' || (e.pointerType === 'mouse' && e.button !== 0)) return;
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId, card };
  try { card.setPointerCapture(e.pointerId); } catch { /* (a synthetic pointer) */ }
  card.classList.add('dragging');
  if (e.pointerType === 'mouse') e.preventDefault();
});
track.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const k = 0.0028, dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  off.vy = -dx * k; off.vp = dy * k * 0.75;
  off.yaw += off.vy; off.pitch += off.vp;
  if (Math.abs(dx) + Math.abs(dy) > 2 && auto) { auto = false; setPlay(); }
});
const up = (e) => { if (!drag || e.pointerId !== drag.id) return; drag.card.classList.remove('dragging'); drag = null; };
track.addEventListener('pointerup', up);
track.addEventListener('pointercancel', up);
// the row scrolled by hand (a swipe, the trackpad): the dots follow the card nearest the start
let scrollT = 0;
track.addEventListener('scroll', () => {
  clearTimeout(scrollT);
  scrollT = setTimeout(() => {
    const x = track.scrollLeft, i = cardEls.reduce((b, el, k) => (Math.abs(el.offsetLeft - pad() - x) < Math.abs(cardEls[b].offsetLeft - pad() - x) ? k : b), 0);
    syncDots(i);
  }, 120);
}, { passive: true });

// ---------------------------------------------------------------- start
function start() {
  if (E) return;
  E = shared('data/LH_17761/');
  E.viewer = { frame, enter };
  E.hooks.viewer = onFrame;
  cardEls.forEach((el) => E.track(el.querySelector('.gl-slot')));
  syncDots(0); setPlay();
  // the homes in order, each scan and its recording, after the story's own scan
  E.ready.then(() => fetch('data/viewer.json')).then((r) => r.json()).then(async (V) => {
    cards = V.cards.map((c) => ({ ...c, t: 0, T: (c.win[1] - c.win[0]) / FPS }));
    for (const [i, c] of cards.entries()) {
      c.sp = await E.space(c.scene);
      c.rec = await E.spaceRec(c.sp, c.take);
      cardEls[i].querySelector('.gl-slot').classList.add('ready');
    }
  });
}
if (document.readyState === 'complete') setTimeout(start, 260); else addEventListener('load', () => setTimeout(start, 260));
window.__viewer = () => ({ E, cards, ci, mode, off, goCard, setMode, setAmt: (v) => { amt = v; amtEl.value = v; },
  pause: () => { playing = false; auto = false; setPlay(); }, seek: (t) => { if (cards[ci]) cards[ci].t = t; }, orbit: (y, p) => { off.yaw += y; off.pitch += p; } });
