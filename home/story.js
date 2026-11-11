// Capture: the screen held, scrolling drives the live 3D. It opens on the hero's last frame (LH_17761 from above, the
// film's closing crane) and turns it into the real 3DGS, then three steps:
//   Scanned once.          The reconstruction trajectory draws in; what it passed lights up.
//   Recorded many times.   HOMIE Gen 2 on its own, then it folds into a card and the eight recordings follow, one card
//                          each (its own first-person clip, task, length), linked to where it works in the scan, its
//                          head path drawn in its colour (the film's act-2 chart, shots/act2_tree.js).
//   In one metric frame.   Down to the dining table at eye height: the operator rises and starts, with body mesh,
//                          hands, head camera and the frame it recorded.
// The section sits one screen up over the hero's end (margin-top: -100vh), so its stage pins at the moment the hero
// lets go; it is shown only once pinned, and its first frame is the hero's.
import { shared, STORY } from './engine.js';
import { drawCaptions, drawSensors } from './panel.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (u) => u * u * (3 - 2 * u);

const sec = $('#story'), stick = $('.story-stick', sec), slot = $('#slotStory'), still = $('#storyStill');
const copies = [...sec.querySelectorAll('.sc')], list = $('#storyList'), carry = $('#storyCarry');
const head = $('#scanHead'), panel = $('#storyPanel'), egoC = $('#storyEgo canvas'), egoX = egoC.getContext('2d');
const callout = $('#callouts'), svg = $('#calloutLines'), shade = $('.story-shade', sec);
const recArt = $('.sc-rec', sec), links = $('#recLinks'), casesEl = $('#cases');
const SVGNS = 'http://www.w3.org/2000/svg', el = (tag, cls) => { const e = document.createElementNS(SVGNS, tag); if (cls) e.setAttribute('class', cls); return e; };
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

let E = null, s = 0, cards = [];

// the plan is framed beside the copy: right of the copy column on a wide screen, above the copy on a tall one
function region() {
  const W = innerWidth, H = innerHeight;
  if (W / H < 0.9) return { x0: 16, y0: 64, x1: W - 16, y1: H * 0.56 };
  const copyR = Math.max(28, (W - 1180) / 2) + Math.min(440, W * 0.36);
  return { x0: copyR + 24, y0: 64, x1: W - Math.max(24, W * 0.03), y1: H - 40 };
}

function start() {
  if (E) return;
  E = shared('data/LH_17761/');   // the page's one engine (the scene viewer below uses it too)
  E.planRegion = region();
  E.track(slot);                  // the canvas is here while this screen shows more of itself than the viewer
  E.ready.then(() => {
    slot.classList.add('ready');
    const C = E.cards;
    cards = E.trails.map((tr, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--c', tr.color);
      const in3d = C.cases.some((c) => c.id === tr.id);
      li.innerHTML = `<button type="button" title="${tr.task}"><canvas width="${C.tile[0]}" height="${C.tile[1]}"></canvas><b>${String(i + 1).padStart(2, '0')}</b><span>${tr.label}</span>${in3d ? '<i class="b3d">3D</i>' : ''}<em>${fmt(tr.duration)}</em></button>`;
      li.addEventListener('pointerenter', () => { E.hi = i; });
      li.addEventListener('pointerleave', () => { if (E.hi === i) E.hi = -1; });
      li.querySelector('button').addEventListener('click', () => pick(i, true));
      list.appendChild(li);
      // its link: a line from the card to a ring where the clip works, in the recording's colour
      const g = el('g', 'lk'); g.style.setProperty('--c', tr.color);
      const line = el('line'), port = el('circle', 'port'), ring = el('circle', 'ring'), dot = el('circle', 'dot');
      port.setAttribute('r', '2.6'); ring.setAttribute('r', '7'); dot.setAttribute('r', '2.4');
      g.append(line, port, ring, dot); links.appendChild(g);
      const sheet = new Image(); sheet.src = `data/LH_17761/${tr.id}/clip.jpg`;
      return { li, cx: li.querySelector('canvas').getContext('2d'), g, line, port, ring, dot, sheet, drawn: -1, tr };
    });
    // step 3: the recordings with a 3D window, one button each
    for (const c of C.cases) {
      const tr = E.trails.find((t) => t.id === c.id), b = document.createElement('button');
      b.type = 'button'; b.dataset.id = c.id; b.style.setProperty('--c', tr?.color ?? '#CCFFA0');
      b.innerHTML = `<i></i><b>${c.place}</b><span>${c.action}</span>`;
      b.addEventListener('click', () => pick(E.trails.findIndex((t) => t.id === c.id), false));
      casesEl.appendChild(b);
    }
    syncPick();
  });
  E.onFrame = frame;
}
// picking a recording: a card toggles it (its path, link and pin stay lit); one with a 3D window is also the one step 3
// goes down to, and the case buttons there switch between those
function pick(i, toggle) {
  const id = E.trails[i]?.id;
  E.sel = toggle && E.sel === i ? -1 : i;
  if (E.sel >= 0 && E.cards.cases.some((c) => c.id === id)) E.selectCase(id);
  syncPick();
}
function syncPick() {
  cards.forEach((c, i) => c.li.classList.toggle('sel', E.sel === i));
  for (const b of casesEl.children) b.classList.toggle('on', b.dataset.id === E.caseId);
}
// load once the hero has drawn (or straight away if the page opens further down)
if (document.readyState === 'complete') setTimeout(start, 200); else addEventListener('load', () => setTimeout(start, 200));

// the hero's still (until the scan is in, and while it hands over), its caption, the copy's shade: these follow the
// scroll alone, so they are set from the scroll too, before the scan has drawn a frame
function overlay() {
  const T = STORY, ready = !!E?.loaded;
  still.style.opacity = ready ? String(1 - smooth(span(s, ...T.hand))) : '1';
  carry.style.opacity = String(1 - smooth(span(s, 0.025, 0.06)));
  carry.style.transform = `translateY(${-24 * smooth(span(s, 0.025, 0.06))}px)`;
  shade.style.opacity = String(smooth(span(s, 0.07, 0.12)) * (1 - smooth(span(s, T.descend[0], T.descend[0] + 0.06))));
}
function onScroll() {
  const r = sec.getBoundingClientRect();
  s = clamp01(-r.top / Math.max(1, r.height - innerHeight));
  stick.classList.toggle('pinned', r.top <= 0.5);   // shown once pinned: until then the hero is on screen
  if (E) E.story = s;
  copies.forEach((c) => c.classList.toggle('on', s >= Number(c.dataset.in) && s < Number(c.dataset.out)));
  if (r.top < innerHeight * 2 && !E) start();
  overlay();
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', () => { if (E) { E.planRegion = region(); E.resize(); } onScroll(); });
onScroll();

// per rendered frame: the still hands over, the hero's caption leaves, the scanner's tag, the list, the labels and the
// head camera's picture
const CALLS = [
  { key: 'body', text: 'Body · SMPL-H', dx: -150, dy: -70 },
  { key: 'hands', text: 'Hands · MANO', dx: 120, dy: 74 },
  { key: 'cam', text: 'Head camera', dx: -60, dy: -96 },
];
CALLS.forEach((c) => {
  c.el = document.createElement('div'); c.el.className = 'co'; c.el.innerHTML = `<i></i><span>${c.text}</span>`; callout.appendChild(c.el);
  c.ln = document.createElementNS('http://www.w3.org/2000/svg', 'line'); svg.appendChild(c.ln);
  c.dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.dot.setAttribute('r', '3.5'); svg.appendChild(c.dot);
});
let lastBmp = null, panelF = -1, panelRec = null;

// ---------------------------------------------------------------- step 3's right column (panel.js)
const capEl = { task: $('#capTask'), act: $('#capAct'), now: $('#capNow'), hands: $('#capHands'), taskHead: $('#capTaskHead'), actSpan: $('#capActSpan'), actHead: $('#capActHead') };
const senEl = { rate: $('#imuRate'), gyro: $('#imuGyro'), acc: $('#imuAcc'), audio: $('#audio'), gv: $('#imuGv'), av: $('#imuAv'), audV: $('#audV') };
function drawPanel(f, rec) { drawCaptions(capEl, f, rec); drawSensors(senEl, f, rec); }
function frame(f, rec, alpha = 0) {
  const T = STORY;
  overlay();

  // the head of the reconstruction trajectory, tagged
  const hp = E.scanHead ? E.project(E.scanHead) : null;
  head.style.opacity = hp ? String(span(s, T.scan[0], T.scan[0] + 0.01) * (1 - span(s, T.scan[1] - 0.01, T.scan[1]))) : '0';
  if (hp) { head.style.transform = `translate(${hp[0]}px, ${hp[1]}px)`; head.classList.toggle('flip', hp[0] > innerWidth - 230); }   // the tag stays on screen

  // step 2: HOMIE Gen 2 alone, then it folds into a card and the recordings' cards come in as their paths draw; each
  // plays its clip and is linked to its spot in the scan; one can be picked out
  recArt.classList.toggle('compact', s >= T.homie[1] - 0.005);
  const C = E.cards, tick = Math.floor(performance.now() / (1000 / C.fps));
  const linksOn = recArt.classList.contains('on') ? 1 - smooth(span(s, T.descend[0] - 0.03, T.descend[0])) : 0;
  links.style.opacity = String(linksOn);
  cards.forEach((c, i) => {
    const u = E.trailU?.[i] ?? 0, shown = u > 0.01;
    c.li.classList.toggle('on', shown);
    const fi = E.focusIndex();
    c.li.classList.toggle('hi', fi === i);
    c.li.classList.toggle('dim', fi >= 0 && fi !== i);
    if (shown && linksOn > 0 && c.sheet.complete && c.sheet.naturalWidth) {   // its clip, at 15 fps
      const k = (tick + i * 7) % c.tr.frames;
      if (k !== c.drawn) {
        c.drawn = k;
        c.cx.drawImage(c.sheet, (k % C.cols) * C.tile[0], Math.floor(k / C.cols) * C.tile[1], C.tile[0], C.tile[1], 0, 0, C.tile[0], C.tile[1]);
      }
    }
    const pin = shown && linksOn > 0 ? E.project(c.tr.pinV) : null;
    c.g.style.display = pin ? '' : 'none';
    if (!pin) return;
    const r = c.li.getBoundingClientRect(), x0 = r.right + 6, y0 = r.top + r.height / 2;
    const a = smooth(span(u, 0, 0.35)), x1 = x0 + (pin[0] - x0) * a, y1 = y0 + (pin[1] - y0) * a;   // the line runs out to its pin
    c.line.setAttribute('x1', x0); c.line.setAttribute('y1', y0); c.line.setAttribute('x2', x1); c.line.setAttribute('y2', y1);
    c.port.setAttribute('cx', x0); c.port.setAttribute('cy', y0);
    for (const q of [c.ring, c.dot]) { q.setAttribute('cx', pin[0]); q.setAttribute('cy', pin[1]); q.style.opacity = String(span(u, 0.3, 0.4)); }
    c.g.classList.toggle('hi', fi === i);
    c.g.classList.toggle('dim', fi >= 0 && fi !== i);
  });

  if (casesEl.dataset.id !== E.caseId) { casesEl.dataset.id = E.caseId; syncPick(); }
  for (const b of casesEl.children) b.classList.toggle('loading', b.dataset.id === E.caseId && !E.loadedIds.has(b.dataset.id));

  // step 3: labels on the operator, and the head camera's own picture
  const show = rec && alpha > 0.98 ? smooth(span(s, T.op[1], T.op[1] + 0.03)) : 0;
  callout.style.opacity = svg.style.opacity = panel.style.opacity = String(show);
  if (show > 0) {
    const at = { body: rec.joint(f, 6), hands: rec.hand(f, 1) ?? rec.joint(f, 21), cam: rec.headCam(f) };
    for (const c of CALLS) {
      const p = at[c.key] && E.project(at[c.key]);
      const vis = !!p;
      c.el.style.display = c.ln.style.display = c.dot.style.display = vis ? '' : 'none';
      if (!vis) continue;
      const W = innerWidth, H = innerHeight;   // labels stay clear of the bar, the edges, the copy and the right column
      const xMax = W / H > 0.9 ? panel.getBoundingClientRect().left - 30 : W - 150;
      const lw = c.dx > 0 ? c.el.querySelector('span').offsetWidth : 0;   // a label to the right of its anchor ends before xMax
      const lx = Math.min(xMax - lw, Math.max(150, p[0] + c.dx)), ly = Math.min(H * 0.62, Math.max(84, p[1] + c.dy));
      c.el.style.transform = `translate(${lx}px, ${ly}px)`;
      c.el.classList.toggle('left', c.dx < 0);
      c.ln.setAttribute('x1', p[0]); c.ln.setAttribute('y1', p[1]); c.ln.setAttribute('x2', lx); c.ln.setAttribute('y2', ly);
      c.dot.setAttribute('cx', p[0]); c.dot.setAttribute('cy', p[1]);
    }
    if (f !== panelF || rec !== panelRec) { panelF = f; panelRec = rec; drawPanel(f, rec); }
    if (rec.bitmap && rec.bitmap !== lastBmp) {
      lastBmp = rec.bitmap;
      if (egoC.width !== rec.bitmap.width) { egoC.width = rec.bitmap.width; egoC.height = rec.bitmap.height; }
      egoX.drawImage(rec.bitmap, 0, 0);
    }
  }
}
window.__story = () => ({ E, s });   // for the console and tools/shots.cjs
