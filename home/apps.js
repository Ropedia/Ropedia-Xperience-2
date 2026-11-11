// 04 Applications. An overview that links the nine modalities to the seven uses, the three benchmarks, and the four
// demonstrations in the film's order. Everything drawn here comes from the film's own sources (build.py and
// build_apps.py): data/bench.json (the paper's geometry table; its detection and spatial-intelligence tables are written
// out below as DET and SQA_ROWS), data/r2s (the Real-to-Sim camera path rendered as scan
// and as simulator, the simulator's object boxes, seven interaction clips), data/apps/gap (the gap heat maps),
// data/traj (run 203 and the 30 held-out runs), the two retargeted robots of recording 7659f6d6 (drawn by engine.js
// in its 'retarget' mode) and data/apps/wall (Robot A | Robot B in eight homes; each opens in 3D from data/<scene>/<take>).
// Each part sets itself up when it comes near the screen, and plays only while it is on it.
import { shared } from './engine.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const clamp01 = (x) => clamp(x, 0, 1);
const pad = (n, k) => String(n).padStart(k, '0');
const json = (u) => fetch(u).then((r) => r.json());
const mmss = (s) => `${Math.floor(s / 60)}:${pad(Math.round(s) % 60, 2)}`;
const NS = 'http://www.w3.org/2000/svg';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = $('apps');

// run fn the first time el comes within a screen of the viewport
function near(el, fn) {
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '100% 0px' });
  io.observe(el);
}
// tell fn whether el is on screen
function onScreen(el, fn) {
  new IntersectionObserver((es) => fn(es[es.length - 1].isIntersecting), { threshold: 0.05 }).observe(el);
}
// a picture sequence, decoded as it loads; at(i) gives frame i or the nearest one already in
class Seq {
  constructor(urls) { this.urls = urls; this.im = new Array(urls.length); this.started = false; }
  load(first = 0) {
    if (this.started) return; this.started = true;
    const order = this.urls.map((_, i) => i).sort((a, b) => Math.abs(a - first) - Math.abs(b - first));
    let next = 0;
    const pump = () => {
      if (next >= order.length) return;
      const i = order[next++], im = new Image();
      im.decoding = 'async';
      im.onload = () => { this.im[i] = im; this.onframe?.(i); pump(); };
      im.onerror = pump;
      im.src = this.urls[i];
    };
    for (let k = 0; k < 6; k++) pump();
  }
  idx(i) {   // the loaded frame nearest i, or -1
    i = clamp(Math.round(i), 0, this.urls.length - 1);
    for (let d = 0; d < this.urls.length; d++) { if (this.im[i - d]) return i - d; if (this.im[i + d]) return i + d; }
    return -1;
  }
  at(i) { return this.im[this.idx(i)] ?? null; }
}
// a draggable divider inside a stage: fn(x) with x in 0..1
function seam(el, stage, fn, x0 = 0.5) {
  let x = x0;
  const set = (v) => { x = clamp(v, 0.04, 0.96); el.style.left = `${x * 100}%`; el.setAttribute('aria-valuenow', Math.round(x * 100)); fn(x); };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) { const r = stage.getBoundingClientRect(); set((e.clientX - r.left) / r.width); } });
  el.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') set(x - 0.03); else if (e.key === 'ArrowRight') set(x + 0.03); else return; e.preventDefault(); });
  set(x);
  return { set, get: () => x };
}
// a scrub bar: fn(u, phase) with u in 0..1 and phase 'start' | 'move' | 'end'
function scrub(el, fn, key) {
  const at = (e) => { const r = el.getBoundingClientRect(); return clamp01((e.clientX - r.left) / r.width); };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); fn(at(e), 'start'); e.preventDefault(); });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) fn(at(e), 'move'); });
  const end = (e) => { if (el.hasPointerCapture(e.pointerId)) { el.releasePointerCapture(e.pointerId); fn(at(e), 'end'); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') key(-1); else if (e.key === 'ArrowRight') key(1); else return; e.preventDefault(); });
}
const go = (el) => el.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });

// things appear as they come up the screen
{
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' });
  root.querySelectorAll('[data-rv]').forEach((el) => io.observe(el));
}

// ================================================================ overview
const LANG = '<svg viewBox="0 0 84 56"><path d="M18 12h48a5 5 0 0 1 5 5v18a5 5 0 0 1-5 5H40l-10 8v-8H18a5 5 0 0 1-5-5V17a5 5 0 0 1 5-5z"/><path d="M22 21h40M22 27h32M22 33h22"/></svg>';
const GROUPS = [
  { name: 'Scene', dev: 'LiDAR scanner', mods: [
    { id: 'posed', name: 'Posed images', det: 'Fisheye views with camera poses' },
    { id: 'mesh', name: 'Mesh', det: 'Metric and gravity-aligned' },
    { id: 'gs', name: '3D Gaussians', det: 'Photoreal appearance' }] },
  { name: 'Human experience', dev: 'HOMIE Gen 2', mods: [
    { id: 'pose', name: 'Camera poses', det: '6-DoF head trajectory' },
    { id: 'mano', name: 'Hand pose', det: 'MANO, 21 joints per hand' },
    { id: 'smplh', name: 'Body pose', det: 'SMPL-H, 52 joints' },
    { id: 'rgb', name: 'Egocentric RGB', det: 'Four fisheye views' },
    { id: 'depth', name: 'Depth', det: 'Metric stereo depth' },
    { id: 'lang', name: 'Language', det: 'Task, sub-task and action', icon: LANG }] },
];
const ICON = {   // the film's (video/metrics/uses.js)
  geo: '<path d="M24 7l15 8.5v17L24 41 9 32.5v-17z"/><path d="M9 15.5l15 8.5 15-8.5M24 24v17"/>',
  det: '<path d="M7 15V7h8M33 7h8v8M41 33v8h-8M15 41H7v-8"/><path d="M24 15l9 5v10l-9 5-9-5V20z"/><path d="M15 20l9 5 9-5M24 25v10"/>',
  sqa: '<path d="M11 10h26a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H24l-9 7v-7h-4a5 5 0 0 1-5-5V15a5 5 0 0 1 5-5z"/><path d="M20 18.5a4.2 4.2 0 1 1 6.1 3.8c-1.4.7-2.1 1.5-2.1 3.1"/><path d="M24 29.4v.2"/>',
  r2s: '<rect x="5" y="16" width="15" height="15" rx="2" stroke-dasharray="3 2.6"/><path d="M22.5 23.5h5m-2.6-2.8 2.8 2.8-2.8 2.8"/><path d="M36 12l8 4.5v10L36 31l-8-4.5v-10z"/><path d="M28 16.5l8 4.5 8-4.5M36 21v10"/>',
  ret: '<circle cx="12" cy="11" r="3.6"/><path d="M12 15v12M12 27l-5 11M12 27l5 11M5 19.5l7-2 7 2"/><path d="M22 23.5h5m-2.6-2.8 2.8 2.8-2.8 2.8"/><rect x="31" y="8" width="13" height="9" rx="2.5"/><path d="M37.5 17v4M31 21h13v11H31zM34 32v6M41 32v6"/>',
  tel: '<path d="M7 25a10 10 0 0 1 10-10M7 33a18 18 0 0 1 18-18"/><path d="M7 39.8v.4"/><path d="M27 41h16M35 41v-7l-7-9 8-8"/><path d="M36 17l5-2M36 17l2 5"/><circle cx="35" cy="34" r="2"/><circle cx="28" cy="25" r="2"/>',
  lh: '<path d="M7 39c9 0 6-12 15-12s6-12 15-12"/><circle cx="7" cy="39" r="2.4"/><circle cx="22" cy="27" r="2.4"/><path d="M37 15V6h8l-2.5 3 2.5 3h-8"/><circle cx="37" cy="15" r="2.4"/>',
};
// what each use takes: the applications as in the paper's motivation figure, the benchmarks the scan's references
const USES = [
  { card: 0, id: 'geo', name: 'Depth & Geometry', io: 'Depth, camera pose and surface reconstruction', cost: '11 models', col: '#CCFFA0', uses: ['posed', 'mesh'], to: 'ap-bench', tab: 'geo' },
  { card: 0, id: 'det', name: '3D Object Detection', io: 'Object categories in, metric 3D boxes out', cost: '7 methods', col: '#B79CF2', uses: ['posed', 'mesh'], to: 'ap-bench', tab: 'det' },
  { card: 0, id: 'sqa', name: 'Spatial Intelligence', io: '500 spatial questions of six kinds', cost: '12 models', col: '#F2D16B', uses: ['posed', 'mesh'], to: 'ap-bench', tab: 'sqa' },
  { card: 1, id: 'r2s', name: 'Real-to-Sim', io: '<em>One scanned scene</em> → an interactive digital twin', cost: 'One scan per scene', col: '#6FD39A', uses: ['mesh', 'gs'], to: 'ap-r2s' },
  { card: 1, id: 'lh', name: 'Long-Horizon Trajectory Generation', io: '<em>The simulator scene</em> → new multi-subtask robot trajectories', cost: 'Compute only', col: '#F29A5E', uses: ['mesh', 'gs'], to: 'ap-lh' },
  { card: 1, id: 'tel', name: 'Virtual Teleoperation', io: '<em>The simulator scene and an operator</em> → teleoperated robot episodes', cost: 'Operator only', sub: 'reset is a reload', col: '#FF8FD0', uses: ['mesh', 'gs'], to: 'ap-tel' },
  { card: 1, id: 'ret', name: 'Human → Robot Retargeting', io: '<em>One registered recording</em> → robot body and hand trajectories', cost: 'One recording', sub: 'no robot', col: '#7AC4D8', uses: ['mesh', 'gs', 'pose', 'mano', 'smplh'], to: 'ap-ret' },
];
const CARDS = [{ tag: 'Understand · Benchmarks', meta: '20 scenes' }, { tag: 'Act · Demonstrations', meta: 'Cost per collection' }];

function overview() {
  const map = $('apMap'), links = $('apLinks');
  $('apMods').innerHTML = GROUPS.map((g) => `<section class="ap-grp"><header><b>${g.name}</b><span>${g.dev}</span></header>${
    g.mods.map((m) => `<div class="ap-mod" data-m="${m.id}">${m.icon ? `<span class="ic">${m.icon}</span>` : `<img src="data/apps/mods/${m.id}.jpg" alt="" loading="lazy" width="264" height="176">`}<div><b>${m.name}</b><span>${m.det}</span></div></div>`).join('')}</section>`).join('');
  $('apUses').innerHTML = CARDS.map((c, k) => `<section class="ap-grp"><header><b>${c.tag}</b><span>${c.meta}</span></header>${
    USES.filter((u) => u.card === k).map((u) => `<button type="button" class="ap-use" data-u="${u.id}" style="--c:${u.col}"><svg class="ic" viewBox="0 0 48 48" aria-hidden="true">${ICON[u.id]}</svg><span><b>${u.name}</b><span class="io">${u.io}</span></span><span class="cost">${u.cost}${u.sub ? `<small>${u.sub}</small>` : ''}</span><span class="go" aria-hidden="true">↓</span></button>`).join('')}</section>`).join('');
  const modEl = Object.fromEntries([...map.querySelectorAll('.ap-mod')].map((e) => [e.dataset.m, e]));
  const useEl = Object.fromEntries([...map.querySelectorAll('.ap-use')].map((e) => [e.dataset.u, e]));
  const paths = [];
  function layout() {   // one curve per (modality, use) pair
    const R = map.getBoundingClientRect();
    links.setAttribute('viewBox', `0 0 ${R.width} ${R.height}`);
    links.textContent = ''; paths.length = 0;
    if (getComputedStyle(links).display === 'none') return;
    queueMicrotask(() => light(cur));
    for (const u of USES) for (const m of u.uses) {
      const a = modEl[m].getBoundingClientRect(), b = useEl[u.id].getBoundingClientRect();
      const x0 = a.right - R.left + 6, y0 = a.top + a.height / 2 - R.top, x1 = b.left - R.left - 6, y1 = b.top + b.height / 2 - R.top, mx = (x0 + x1) / 2;
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', `M${x0.toFixed(1)},${y0.toFixed(1)}C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`);
      p.style.setProperty('--c', u.col);
      links.appendChild(p); paths.push({ p, u: u.id, m });
    }
  }
  new ResizeObserver(layout).observe(map);
  document.fonts?.ready.then(layout);
  let cur = null;
  function light(sel) {   // sel: { u } a use, { m } a modality, or null
    cur = sel;
    map.classList.toggle('lit', !!sel);
    const us = sel ? (sel.u ? [sel.u] : USES.filter((u) => u.uses.includes(sel.m)).map((u) => u.id)) : [];
    const col = sel?.u ? USES.find((u) => u.id === sel.u).col : '#f5f5f7';
    const ms = sel ? (sel.u ? USES.find((u) => u.id === sel.u).uses : [sel.m]) : [];
    for (const [id, e] of Object.entries(useEl)) e.classList.toggle('on', us.includes(id));
    for (const [id, e] of Object.entries(modEl)) { e.classList.toggle('on', ms.includes(id)); e.style.setProperty('--c', col); }
    for (const { p, u, m } of paths) p.classList.toggle('on', us.includes(u) && ms.includes(m));
  }
  for (const u of USES) {
    const e = useEl[u.id];
    e.addEventListener('pointerenter', () => light({ u: u.id }));
    e.addEventListener('focus', () => light({ u: u.id }));
    e.addEventListener('pointerleave', () => light(null));
    e.addEventListener('blur', () => light(null));
    e.addEventListener('click', () => { if (u.tab) pickBench(u.tab); go($(u.to)); });
  }
  for (const [id, e] of Object.entries(modEl)) {
    e.addEventListener('pointerenter', () => light({ m: id }));
    e.addEventListener('pointerleave', () => light(null));
  }
}

// ================================================================ benchmarks
const DENS = [['sparse', 'Sparse', '5'], ['medium', 'Medium', '11–100'], ['dense', 'Dense', '335–500']];
const METS = [   // up: higher is better
  { k: 'absrel', name: 'AbsRel', up: false, grp: 'Depth' }, { k: 'rmse', name: 'RMSE', up: false, grp: 'Depth' }, { k: 'd103', name: '<span class="lc">δ</span><sub>1.03</sub>', plain: 'δ1.03', up: true, grp: 'Depth' },
  { k: 'auc30', name: 'AUC@30°', up: true, grp: 'Pose' }, { k: 'ate', name: 'ATE', up: false, grp: 'Pose' },
  { k: 'cd', name: 'CD', up: false, grp: 'Surface' }, { k: 'f5', name: 'F@5cm', up: true, grp: 'Surface' },
];
// 3D object detection on the 20 scenes (the paper's table): AP25, AP50 and mIoU@0.25, in %, by kind of method
const DET = { cols: ['AP25', 'AP50', '<span class="lc">mIoU@0.25</span>'], groups: [
  ['End-to-end models', [['SpatialLM', 4.23, 1.07, 43.66], ['LLaVA-3D*', 0, 0, 0], ['SceneScript', 0, 0, 0], ['Map-Det3D', 6.45, 0.13, 36.16]]],
  ['3DGS fields', [['M3', 5.72, 0.64, 37.01], ['LangSplat', 3.43, 0.34, 37.96]]],
  ['Lifting', [['Boxer', 24.69, 6.09, 49.48]]],
] };
const DET_EX = [   // the Real-to-Sim scene's own objects on frame 151, a category each: the form of the task, not benchmark items
  { cat: 'cushion', ids: ['sofa_cushion_grey', 'sofa_cushion_grey_2', 'sofa_cushion_orange', 'sofa_cushion_pink'] },
  { cat: 'table', ids: ['coffee_table', 'sofa_side_table', 'bedroom_side_table'] },
  { cat: 'remote control', ids: ['remote_1', 'remote_2'] },
];
const SQA = [
  ['Translation', 'Between these two views, did the camera move to the left or to the right?', 'How the camera moved'],
  ['Rotation', 'From the first view to the second, which way did the camera turn?', 'How the camera turned'],
  ['Distance', 'How far is the sofa from the television, in metres?', 'Metric distance between two things'],
  ['Depth', 'Which is closer to the camera, the round table or the floor lamp?', 'Ordering by distance from the camera'],
  ['Height', 'Which is higher above the floor, the television or the curtain rail?', 'Heights in a gravity-aligned scene'],
  ['Relative position', 'Standing at the sofa and facing the television, is the kitchen on your left or your right?', 'Where one thing is from another'],
];
// spatial intelligence on the 500 questions (the paper's table): accuracy in %, the six kinds in SQA's order, then overall;
// the models of MMSI-Bench, then the one below the paper's rule
const SQA_COLS = ['Trans.', 'Rot.', 'Dist.', 'Depth', 'Height', 'Rel. pos.'];
const SQA_ROWS = [
  ['Open-weight models', [
    ['Qwen2.5-VL-7B', 20.24, 36.14, 17.86, 65.06, 79.52, 78.31, 49.40], ['Qwen2.5-VL-72B', 21.43, 48.19, 28.57, 81.93, 92.77, 90.36, 60.40],
    ['InternVL3-8B', 25.00, 30.12, 19.05, 68.67, 95.18, 80.72, 53.00], ['InternVL3-78B', 36.90, 46.99, 14.29, 80.72, 93.98, 84.34, 59.40],
    ['LLaVA-OneVision-7B', 15.48, 24.10, 13.10, 56.63, 85.54, 74.70, 44.80], ['LLaVA-OneVision-72B', 28.57, 38.55, 20.24, 67.47, 89.16, 80.72, 54.00]]],
  ['API models', [
    ['GPT-4o', 41.67, 27.71, 17.86, 69.88, 87.95, 77.11, 53.60], ['GPT-5 High', 42.86, 56.63, 17.86, 92.77, 95.18, 90.36, 65.80],
    ['o3 High', 38.10, 62.65, 11.90, 85.54, 93.98, 93.98, 64.20], ['Gemini-2.5-Pro', 54.76, 69.88, 33.33, 97.59, 98.80, 91.57, 74.20],
    ['GPT-6 Astra High', 50.00, 72.29, 27.38, 91.57, 97.59, 92.77, 71.80]]],
  [null, [['HoliWorld-VL-4B', 51.19, 62.65, 19.05, 87.95, 96.39, 90.36, 67.80]]],
];
// a score table in the paper's order: a row per group heading (none for a group after a rule), the best of each column bold
function scoreTable(head, cols, groups, title = '') {
  const rows = groups.flatMap(([, r]) => r), best = cols.map((_, j) => Math.max(...rows.map((r) => r[j + 1])));
  return `<thead><tr><th scope="col" class="nm">${head}</th>${cols.map((c, j) => `<th scope="col"${title ? ` title="${title[j]}"` : ''}>${c}</th>`).join('')}</tr></thead>${
    groups.map(([g, r]) => `<tbody>${g ? `<tr class="sec"><th scope="rowgroup" colspan="${cols.length + 1}">${g}</th></tr>` : ''}${
      r.map((row, i) => `<tr${!g && !i ? ' class="rule"' : ''}><td class="nm"><b>${row[0]}</b></td>${cols.map((_, j) => `<td${row[j + 1] === best[j] ? ' class="top"' : ''}>${row[j + 1].toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody>`).join('')}`;
}
let pickBench = () => {};

async function bench() {
  const B = await json('data/bench.json');
  const st = { dens: 'sparse', met: 'd103', best: true };
  const tabs = [...$('apBenchTabs').querySelectorAll('button')];
  pickBench = (id) => {
    for (const t of tabs) { const on = t.dataset.b === id; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; $(`apB-${t.dataset.b}`).hidden = !on; }
    if (id === 'det') det();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pickBench(t.dataset.b));
    t.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { const n = tabs[(i + d + tabs.length) % tabs.length]; n.focus(); pickBench(n.dataset.b); } });
  });

  // depth and geometry: one table, the picked metric as bars; a header sorts by its column
  const dens = $('apDens'), met = $('apMet'), tbl = $('apTbl'), head = tbl.tHead, body = tbl.tBodies[0];
  dens.innerHTML = DENS.map(([k, n, v]) => `<button type="button" data-d="${k}" aria-pressed="${k === st.dens}">${n}<small>${v}</small></button>`).join('');
  met.innerHTML = METS.map((m) => `<button type="button" data-m="${m.k}" aria-pressed="${m.k === st.met}">${m.name}</button>`).join('');
  head.innerHTML = `<tr><th scope="col">#</th><th scope="col" class="nm">Model</th>${METS.map((m) => `<th scope="col" data-m="${m.k}"><button type="button" title="${m.grp}: ${m.up ? 'higher' : 'lower'} is better">${m.name} <small>${m.up ? '↑' : '↓'}</small><i></i></button></th>`).join('')}</tr>`;
  const rows = new Map(B.models.map((m) => { const tr = document.createElement('tr'); body.appendChild(tr); return [m.name, tr]; }));
  const fmt = (v) => (v == null ? '–' : v.toFixed(3));
  function render() {
    const M = METS.find((m) => m.k === st.met);
    for (const b of dens.children) b.setAttribute('aria-pressed', b.dataset.d === st.dens);
    for (const b of met.children) b.setAttribute('aria-pressed', b.dataset.m === st.met);
    for (const th of head.querySelectorAll('th[data-m]')) { if (th.dataset.m === st.met) th.setAttribute('aria-sort', st.best === M.up ? 'descending' : 'ascending'); else th.removeAttribute('aria-sort'); }
    const val = (m, k = st.met) => m[st.dens][k];
    const order = [...B.models].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null || y == null) return (x == null) - (y == null);
      return (st.best === M.up ? y - x : x - y);
    });
    const max = Math.max(...B.models.map((m) => val(m) ?? 0));
    const bestOf = Object.fromEntries(METS.map((c) => { const vs = B.models.map((m) => val(m, c.k)).filter((v) => v != null); return [c.k, c.up ? Math.max(...vs) : Math.min(...vs)]; }));
    const was = new Map([...rows].map(([n, tr]) => [n, tr.getBoundingClientRect().top]));
    order.forEach((m, i) => {
      const tr = rows.get(m.name), oom = val(m) == null;
      tr.className = oom ? 'oom' : val(m) === bestOf[st.met] ? 'best' : '';
      tr.innerHTML = `<td>${oom ? '' : i + 1}</td><td class="nm"><b>${m.name}</b><span>${m.group}</span></td>` + (oom
        ? `<td class="oomc" colspan="${METS.length}">Out of memory on dense input</td>`
        : METS.map((c) => (c.k === st.met
          ? `<td class="sel"><div class="bar"><i style="--u:${(100 * val(m) / max).toFixed(1)}%"></i>${fmt(val(m))}</div></td>`
          : `<td${val(m, c.k) === bestOf[c.k] ? ' class="top"' : ''}>${fmt(val(m, c.k))}</td>`)).join(''));
      body.appendChild(tr);
    });
    if (!reduced) for (const [n, tr] of rows) {   // rows glide to their new rank
      const d = was.get(n) - tr.getBoundingClientRect().top;
      if (Math.abs(d) < 1) continue;
      tr.style.transition = 'none'; tr.style.transform = `translateY(${d}px)`;
      requestAnimationFrame(() => requestAnimationFrame(() => { tr.style.transition = ''; tr.style.transform = ''; }));
    }
    const top = B.models.find((m) => val(m) === bestOf[st.met]), nOom = B.models.filter((m) => val(m) == null).length;
    const dn = DENS.find((d) => d[0] === st.dens);
    $('apBenchSay').innerHTML = `<span>Best ${M.plain ?? M.name} on ${dn[1].toLowerCase()} input (${dn[2]} views): <b>${top.name}</b>, ${fmt(val(top))}. ${M.up ? 'Higher' : 'Lower'} is better.</span>${nOom ? `<span>${nOom} of ${B.models.length} models run out of memory.</span>` : ''}`;
  }
  dens.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { st.dens = b.dataset.d; render(); } });
  met.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { st.met = b.dataset.m; st.best = true; render(); } });
  head.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-m]'); if (!th) return;
    if (th.dataset.m === st.met) st.best = !st.best; else { st.met = th.dataset.m; st.best = true; }
    render();
  });
  render();

  // detection and spatial intelligence: the paper's tables as they are
  $('apDetTbl').innerHTML = scoreTable('Method', DET.cols, DET.groups);
  $('apQs').innerHTML = SQA.map(([k, q, d]) => `<div class="ap-q"><b>${k}</b><p>${q}</p><span>${d}</span></div>`).join('');
  $('apSqaTbl').innerHTML = scoreTable('Model', [...SQA_COLS, 'Overall'], SQA_ROWS, [...SQA.map(([k]) => k), 'All 500 questions']);
}

// ---------------------------------------------------------------- the simulator scene's boxes on a camera of its path
let R2S = null;
const r2sData = () => (R2S ??= json('data/r2s/r2s.json'));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
function camAt(D, i) {
  const c = D.cams[clamp(i, 0, D.cams.length - 1)], p = c.slice(0, 3), fw = norm(sub(c.slice(3, 6), p)), r = norm(cross(fw, [0, 1, 0]));
  return { p, fw, r, u: cross(r, fw), k: (D.H / 2) / Math.tan(c[6] * Math.PI / 360) };
}
function project(D, cam, b) {   // the box's eight corners on the 1920 x 1080 frame, or null when any is behind the camera
  const q = [];
  for (const v of b.v) { const d = sub(v, cam.p), z = dot(d, cam.fw); if (z < 0.08) return null; q.push([D.W / 2 + cam.k * dot(d, cam.r) / z, D.H / 2 - cam.k * dot(d, cam.u) / z]); }
  return q;
}
const edgePath = (q) => EDGES.map(([a, c]) => `M${q[a][0].toFixed(1)},${q[a][1].toFixed(1)}L${q[c][0].toFixed(1)},${q[c][1].toFixed(1)}`).join('');
function hull(q) {   // outline of the projected box (monotone chain)
  const P = [...q].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return `M${[...lo.slice(0, -1), ...up.slice(0, -1)].map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}Z`;
}
const pretty = (id) => { const s = id.replace(/^Tour_/, '').replace(/_(\d+)$/, ' $1').replace(/_/g, ' '); return s[0].toUpperCase() + s.slice(1); };

let detDone = false;
async function det() {
  if (detDone) return; detDone = true;
  const D = await r2sData(), F = 151, cam = camAt(D, F - D.f0), svg = $('apDetSvg'), ex = $('apCats');
  $('apDetImg').src = `data/r2s/real/${pad(F, 5)}.jpg`;
  ex.innerHTML = DET_EX.map((x, i) => `<button type="button" data-i="${i}" aria-pressed="${i === 0}">${x.cat}<small>${x.ids.length} boxes in this view</small></button>`).join('');
  const show = (i) => {
    const qs = DET_EX[i].ids.map((id) => project(D, cam, D.boxes.find((b) => b.id === id))).filter(Boolean);
    svg.innerHTML = qs.map((q) => `<path class="face" d="${hull(q)}"/><path d="${edgePath(q)}"/>`).join('');
    for (const b of ex.children) b.setAttribute('aria-pressed', Number(b.dataset.i) === i);
  };
  ex.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(Number(b.dataset.i)); });
  show(0);
}

// ================================================================ long-horizon trajectory generation
async function longHorizon() {
  const D = await json('data/traj/traj.json');
  const N = D.main_steps.length, seq = new Seq(D.main_steps.map((_, k) => `data/traj/chase/${pad(k, 5)}.jpg`));
  const cv = $('apLhCv'), ctx = cv.getContext('2d'), svg = $('apLhPlan'), P = D.plan;
  svg.setAttribute('viewBox', `0 0 ${P.w} ${P.h}`);
  const mp = (x, y) => [(P.Y1 - y) / P.res, (P.X1 - x) / P.res];
  const el = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  const PP = D.path.map((p) => [...mp(p[0], p[1]), p[2], ...mp(p[3], p[4])]);
  el('polyline', { class: 'ghost', points: PP.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') });
  const pathEl = el('polyline', { class: 'path' });
  const hero = D.runs.findIndex((r) => r.id === D.hero);
  const dots = D.runs.map((r, i) => {
    const [u, v] = mp(r.base[0], r.base[1]);
    const c = el('circle', { cx: u, cy: v, r: 4.2, class: 'st', tabindex: 0, role: 'button', 'aria-label': `Start ${i + 1} of ${D.runs.length}` });
    el('circle', { cx: u, cy: v, r: 9, class: 'st-hit' }).addEventListener('click', () => pick(i));
    c.addEventListener('click', () => pick(i));
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(i); } });
    return c;
  });
  const mug = el('circle', { r: 4.6, class: 'mug' }), bot = el('g', { class: 'bot' });
  const L = 0.627 / P.res, Wd = 0.675 / P.res;      // the base's footprint, metres
  el('rect', { x: -L / 2, y: -Wd / 2, width: L, height: Wd, rx: 4 }, bot);
  el('path', { d: `M${L / 2 - 9} -6 L${L / 2 - 2} 0 L${L / 2 - 9} 6` }, bot);

  // the scrub bar: one segment per subtask, as wide as its share of the time-lapse
  const ends = D.stages.map((s) => { const k = D.main_steps.findIndex((x) => x >= s.step); return k < 0 ? N - 1 : k; });
  const starts = [0, ...ends.slice(0, -1)];
  const segs = $('apLhSegs'); segs.innerHTML = D.stages.map((s, j) => `<i style="flex:${Math.max(1, ends[j] - starts[j])}" title="${s.name}"></i>`).join('');
  const st = { k: 0, playing: !reduced, on: false, last: 0, run: hero, held: false };
  const runEl = $('apLhRun');
  function pick(i) {   // a start: its run's eight subtask times
    st.run = i;
    dots.forEach((d, j) => { d.classList.toggle('on', j === i); d.setAttribute('r', j === i ? 6 : 4.2); });
    const r = D.runs[i], d = r.stages.map((s, j) => (s - (j ? r.stages[j - 1] : 0)) / 30), max = Math.max(...D.runs.flatMap((x) => x.stages.map((s, j) => (s - (j ? x.stages[j - 1] : 0)) / 30)));
    runEl.innerHTML = `<header><b>Start ${i + 1} of ${D.runs.length}${i === hero ? ' · shown in the video' : ''}</b><span>${mmss(r.stages[7] / 30)} · 8 / 8 done</span></header><ol>${
      D.stages.map((s, j) => `<li data-j="${j}"><em>${j + 1}</em><span>${s.name}</span><i style="--u:${(100 * d[j] / max).toFixed(1)}%"></i><b>${d[j] < 59.5 ? `${Math.round(d[j])} s` : mmss(d[j])}</b></li>`).join('')}</ol>`;
    paint();
  }
  runEl.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li && st.run === hero) { st.k = starts[Number(li.dataset.j)]; paint(); } });
  function paint() {
    const k = clamp(Math.round(st.k), 0, N - 1), step = D.main_steps[k], im = seq.at(k);
    if (im) ctx.drawImage(im, 0, 0, cv.width, cv.height);
    const j = Math.min(7, D.stages.findIndex((s) => step < s.step) < 0 ? 7 : D.stages.findIndex((s) => step < s.step));
    $('apLhNow').textContent = `${j + 1} / 8 · ${D.stages[j].name}`; $('apLhClock').textContent = mmss(step / 30);
    const u = st.k / (N - 1);
    $('apLhHead').style.left = `${u * 100}%`; $('apLhScrub').setAttribute('aria-valuenow', Math.round(u * 100));
    [...segs.children].forEach((s, a) => s.style.setProperty('--u', `${100 * clamp01((st.k - starts[a]) / Math.max(1, ends[a] - starts[a]))}%`));
    const n = clamp(Math.round(step / D.path_every), 0, PP.length - 1), p = PP[n];
    pathEl.setAttribute('points', PP.slice(0, n + 1).map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '));
    // heading: world (cos yaw, sin yaw) is plan (-sin yaw, -cos yaw)
    bot.setAttribute('transform', `translate(${p[0].toFixed(1)},${p[1].toFixed(1)}) rotate(${(Math.atan2(-Math.cos(p[2]), -Math.sin(p[2])) * 180 / Math.PI).toFixed(1)})`);
    mug.setAttribute('cx', p[3]); mug.setAttribute('cy', p[4]);
    if (st.run === hero) runEl.querySelectorAll('li').forEach((li, a) => { li.classList.toggle('done', a < j || k >= N - 1); li.classList.toggle('now', a === j && k < N - 1); });
  }
  const loop = (now) => {
    if (!st.on) return; requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - st.last) / 1000); st.last = now;
    if (st.playing && !st.held) { st.k += dt * 20; if (st.k > N - 1 + 30) st.k = 0; }   // 20 frames a second, a breath at the end
    paint();
  };
  seq.onframe = () => { if (!st.on) paint(); };
  const play = $('apLhPlay'), setPlay = (p) => { st.playing = p; play.classList.toggle('paused', !p); play.setAttribute('aria-label', p ? 'Pause' : 'Play'); };
  play.addEventListener('click', () => { if (!st.playing && st.k >= N - 1) st.k = 0; setPlay(!st.playing); });
  scrub($('apLhScrub'), (u, ph) => { st.held = ph !== 'end'; st.k = u * (N - 1); paint(); }, (d) => { st.k = clamp(st.k + d * 3, 0, N - 1); paint(); });
  setPlay(st.playing); pick(hero);
  onScreen(cv, (on) => { if (on && !st.on) { st.on = true; seq.load(Math.round(st.k)); st.last = performance.now(); requestAnimationFrame(loop); } else st.on = on; });
}

// ================================================================ human → robot retargeting
// One retarget stage: which body, the divider between two of them, the clock. The page has two, both drawn by the
// engine's 'retarget' mode: the hero recording's stage and the wall's dialog. The one whose slot holds the canvas owns
// the engine's state (E.emb, E.cmp, E.rtHold, E.t, E.rtSrc), and takes it back each time the canvas returns (enter).
//   el: slot, emb (the bodies' switch), cmp, seam, labL, labR, play, bar, head
//   st: emb (the body, or the right one of two), left, cmp, x (divider, 0..1), playing, src (a home of the wall, with
//       its camera; none: the hero recording)
const RT = { stages: [], planes: new WeakMap(), NAME: { human: 'Human', A: 'Robot A', B: 'Robot B' } };
function rtStage(E, el, st, onFrame) {
  const BODIES = ['human', 'A', 'B'], active = () => E.slot === el.slot;
  Object.assign(st, { held: false, t: 0 });
  const push = () => { if (active()) { E.emb = st.emb; E.cmp = st.cmp ? { l: st.left, r: st.emb } : null; E.rtHold = !st.playing || st.held; } };
  function apply() {
    if (st.cmp && st.left === st.emb) st.left = BODIES.find((e) => e !== st.emb);
    for (const b of el.emb.children) b.setAttribute('aria-pressed', b.dataset.e === st.emb);
    el.cmp.setAttribute('aria-pressed', st.cmp); el.cmp.textContent = st.cmp ? 'Side by side' : 'Compare';
    el.seam.hidden = el.labL.hidden = el.labR.hidden = !st.cmp;
    el.labL.firstChild.textContent = RT.NAME[st.left]; el.labR.textContent = RT.NAME[st.emb];
    el.labL.setAttribute('aria-label', `Left of the divider: ${RT.NAME[st.left]}. Change`);
    el.slot.classList.toggle('cmp', st.cmp);
    push();
  }
  // the switch picks the body, or the one right of the divider (picking the left one swaps the two)
  el.emb.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (st.cmp && b.dataset.e === st.left) st.left = st.emb;
    st.emb = b.dataset.e; apply();
  });
  el.cmp.addEventListener('click', () => {
    st.cmp = !st.cmp;
    if (st.cmp) { if (st.emb === 'human') st.emb = 'A'; st.left = 'human'; }
    apply();
  });
  el.labL.addEventListener('click', () => { st.left = BODIES.filter((e) => e !== st.emb).find((e) => e !== st.left); apply(); });   // the other one
  const sm = seam(el.seam, el.slot, (x) => { st.x = x; el.slot.style.setProperty('--seam', `${x * 100}%`); }, st.x ?? 0.5);
  E.controls.addEventListener('start', () => { if (active()) el.slot.classList.add('moved'); });

  // the divider in 3D: a plane through the camera that holds its up axis; each body is clipped to its side of it
  function planesOf(cur) {
    if (!cur.rec || !cur.A || !cur.B) return null;
    let pl = RT.planes.get(cur.rec);
    if (!pl) {
      const rec = cur.rec, Plane = rec.clip.constructor;
      pl = { human: new Plane(), A: new Plane(), B: new Plane() };
      for (const m of [rec.bodyMat, rec.skel.material, rec.handLines.material]) { m.clippingPlanes = [...(m === rec.bodyMat ? [rec.clip] : []), pl.human]; m.clipping = true; m.needsUpdate = true; }
      for (const [k, r] of [['A', cur.A], ['B', cur.B]]) for (const m of new Set(r.links.map((l) => l.material))) { m.clippingPlanes = [pl[k]]; m.needsUpdate = true; }
      RT.planes.set(rec, pl);
    }
    return pl;
  }
  const len = () => E.rtCur().rec?.len ?? 1;
  const self = {
    el, st, apply, seam: sm,
    enter() {   // the canvas is in this stage's slot
      E.rtSrc = st.src ?? null; E.t = st.t;
      if (st.src) E.goTo(st.src.cam, true); else E.setEmbodiment(st.emb, true);
      push();
    },
    frame(f, rec) {
      if (!rec || f < 0) return;
      const planes = planesOf(E.rtCur());
      if (planes) {
        const cam = E.camera, Vec = cam.position.constructor;
        for (const k of BODIES) {
          const side = st.cmp ? (k === st.left ? 1 : k === st.emb ? -1 : 0) : 0;
          if (!side) { planes[k].normal.set(0, 1, 0); planes[k].constant = 1e6; continue; }   // everything kept
          const dx = (2 * st.x - 1) * Math.tan(cam.fov * Math.PI / 360) * cam.aspect;
          const n = new Vec(-1, 0, -dx).normalize().applyQuaternion(cam.quaternion).multiplyScalar(side);   // side 1 keeps the left
          planes[k].normal.copy(n); planes[k].constant = -n.dot(cam.position);
        }
      }
      st.t = E.t;
      const u = clamp01((f - rec.f0) / (rec.len - 1));
      el.head.style.left = `${u * 100}%`; el.bar.setAttribute('aria-valuenow', Math.round(u * 100));
      onFrame?.(f, u);
    },
    setPlay(p) { st.playing = p; el.play.classList.toggle('paused', !p); el.play.setAttribute('aria-label', p ? 'Pause' : 'Play'); push(); },
  };
  el.play.addEventListener('click', () => self.setPlay(!st.playing));
  scrub(el.bar, (u, ph) => { if (!active()) return; st.held = ph !== 'end'; push(); E.t = u * (len() - 1) / 30; },
    (d) => { if (active()) E.t = clamp(E.t + d * 5 / 30, 0, (len() - 1) / 30); });
  if (!RT.stages.length) {
    const mine = () => RT.stages.find((s) => s.el.slot === E.slot);
    E.hooks.retarget = (f, rec) => mine()?.frame(f, rec);
    E.hooks.rtAttach = () => { const s = mine(); s?.enter(); return !!s; };
    // the story draws the hero recording's body too: nothing of it stays clipped
    E.hooks.retargetLeave = () => { const pl = E.heroRec && RT.planes.get(E.heroRec); if (pl) for (const k in pl) { pl[k].normal.set(0, 1, 0); pl[k].constant = 1e6; } };
  }
  RT.stages.push(self);
  apply(); self.setPlay(st.playing);
  if (active()) self.enter();
  return self;
}

async function retarget() {
  const slot = $('apRetSlot'), E = shared(), HB = 'data/LH_17761/7659f6d6/';
  E.track(slot);
  E.ready.then(() => slot.classList.add('ready'));
  const [ja, jb] = await Promise.all([json(`${HB}robot.json`), json(`${HB}robot_b.json`)]);
  const f0 = ja.f0, n = ja.f1 - ja.f0;

  // fingertip error over the window, from each run's own bins (robot.json: spark_cm, the mean over ten fingertips)
  const binsOf = (j) => { const s = j.stats, per = s.frames / s.spark_cm.length, off = j.offset ?? 0; return (f) => s.spark_cm[clamp(Math.floor((f - off) * j.slowdown / per), 0, s.spark_cm.length - 1)]; };
  const errA = binsOf(ja), errB = binsOf(jb);
  const ecv = $('apRetErr'), ectx = ecv.getContext('2d');
  {
    const W = ecv.width, H = ecv.height;
    let max = 0; for (let k = 0; k < n; k++) max = Math.max(max, errA(f0 + k), errB(f0 + k));
    const top = Math.ceil(max * 10) / 10, y = (v) => H - 12 - (H - 44) * v / top;
    ectx.font = '500 20px "SF Mono", Menlo, monospace'; ectx.fillStyle = 'rgba(245,245,247,0.4)'; ectx.strokeStyle = 'rgba(255,255,255,0.08)'; ectx.lineWidth = 2;
    for (const v of [0, top / 2, top]) { ectx.beginPath(); ectx.moveTo(0, y(v)); ectx.lineTo(W, y(v)); ectx.stroke(); }
    ectx.fillText(`${top.toFixed(1)} cm`, 12, y(top) - 8);
    for (const [fn, col] of [[errA, '#CCFFA0'], [errB, '#B9A7FF']]) {
      ectx.beginPath(); ectx.strokeStyle = col; ectx.lineWidth = 4; ectx.lineJoin = 'round';
      for (let k = 0; k < n; k++) { const x = k / (n - 1) * W, v = y(fn(f0 + k)); if (k) ectx.lineTo(x, v); else ectx.moveTo(x, v); }
      ectx.stroke();
    }
  }
  rtStage(E, { slot, emb: $('apEmb'), cmp: $('apCmp'), seam: $('apRetSeam'), labL: $('apRetL'), labR: $('apRetR'), play: $('apRetPlay'), bar: $('apRetScrub'), head: $('apRetHead') },
    { emb: 'human', left: 'human', cmp: false, x: 0.5, playing: !reduced },
    (f) => { $('apErrA').textContent = `${errA(f).toFixed(2)} cm`; $('apErrB').textContent = `${errB(f).toFixed(2)} cm`; });
}

// ================================================================ the wall: eight homes, each one opens in 3D
// A tile is the film's own picture of its home (Robot A | Robot B, a short clip under the pointer). Opened, the home is
// the real thing: its scan, the recording and both robots in the engine (E.home), on a stage like the one above, in a
// dialog that takes the page's one canvas while it is open. It opens as the tile shows it (Robot A | Robot B, the
// divider where the film held it, the film's camera), with the tile's picture over it until the scan is in.
async function wall() {
  const A = await json('data/apps/apps.json'), T = A.wall.tiles, host = $('apWall'), E = shared();
  const url = (k, n) => `data/apps/wall/${k}/${pad(n, 3)}.jpg`;
  const seqs = T.map((t, k) => new Seq(Array.from({ length: t.n }, (_, n) => url(k, n))));
  host.innerHTML = T.map((t, k) => `<button type="button" class="ap-tile" data-k="${k}" aria-label="${t.task}: open in 3D"><img src="${url(k, 0)}" alt="" loading="lazy" width="800" height="450"><canvas width="800" height="450" hidden></canvas><em>Open in 3D</em><span>${t.task}</span></button>`).join('');
  // under the pointer: the film's clip there and back (it holds only 2.7 s of each with both robots)
  const live = { k: -1, cv: null, t: 0, last: 0, raf: 0 };
  const loop = (now) => {
    if (live.k < 0) { live.raf = 0; return; }
    live.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - live.last) / 1000); live.last = now;
    const n = T[live.k].n; live.t = (live.t + dt * 24) % (2 * n - 2);
    const im = seqs[live.k].at(live.t < n ? live.t : 2 * n - 2 - live.t);
    if (im) { live.cv.getContext('2d').drawImage(im, 0, 0, live.cv.width, live.cv.height); live.cv.hidden = false; }
  };
  const start = (k, cv) => { Object.assign(live, { k, cv, t: 0, last: performance.now() }); seqs[k].load(); if (!live.raf) live.raf = requestAnimationFrame(loop); };
  const stop = () => { live.k = -1; };

  const dlg = $('apZoom'), slot = $('apZSlot'), poster = $('apZPoster'), cap = dlg.querySelector('figcaption'), note = slot.querySelector('.gl-load span');
  const st = { emb: 'B', left: 'A', cmp: true, x: 0.5, playing: !reduced };
  const stage = rtStage(E, { slot, emb: $('apZEmb'), cmp: $('apZCmp'), seam: $('apZSeam'), labL: $('apZL'), labR: $('apZR'), play: $('apZPlay'), bar: $('apZScrub'), head: $('apZHead') }, st,
    (f, u) => {
      $('apZFill').style.width = `${u * 100}%`;
      // the tile's picture comes off once the new scan is drawn in order: a few frames in, and Spark's sort at rest
      if (drawn >= 0) { const v = E.spark.defaultView; if (++drawn > 3 && ((!v.sorting && !v.pending) || drawn > 300)) { drawn = -1; slot.classList.add('ready'); } }
    });
  let zk = -1, recent = [], drawn = -1;   // drawn: frames of the new home so far, while its picture is still over them
  const open = (k) => {
    k = (k + T.length) % T.length;
    if (!dlg.open) dlg.showModal();
    if (k === zk && slot.classList.contains('ready')) { E.hold(slot); stage.enter(); return; }
    zk = k;
    const t = T[k];
    cap.firstElementChild.textContent = t.task; cap.lastElementChild.textContent = `Home ${k + 1} of ${T.length} · drag to look around`;
    drawn = -1; slot.classList.remove('ready', 'moved', 'failed'); slot.style.setProperty('--p', '0%'); note.textContent = 'Loading the home';
    poster.src = url(k, t.n - 1);
    E.home(t.scene, t.take, (got, total) => { if (zk === k) slot.style.setProperty('--p', `${Math.round(got / Math.max(1, total) * 100)}%`); }).then((h) => {
      // the last two homes stay in memory, the others go (each scan is 2-4 M splats)
      recent = [h.key, ...recent.filter((x) => x !== h.key)];
      for (const old of recent.splice(2)) E.dropHome(old);
      if (zk !== k || !dlg.open) return;
      Object.assign(st, { src: { ...h, cam: t.cam }, emb: 'B', left: 'A', cmp: true, t: 0 });
      stage.seam.set(t.seam); stage.apply();
      E.hold(slot); stage.enter(); drawn = 0;
    }).catch(() => { if (zk === k) { slot.classList.add('failed'); note.textContent = 'This home could not be loaded'; } });
  };
  for (const b of host.children) {
    const k = Number(b.dataset.k), cv = b.querySelector('canvas');
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !reduced && !dlg.open) start(k, cv); });
    b.addEventListener('pointerleave', () => { if (live.k === k) { stop(); cv.hidden = true; } });
    b.addEventListener('click', () => { stop(); cv.hidden = true; open(k); });
  }
  dlg.querySelector('.ds-x').addEventListener('click', () => dlg.close());
  dlg.querySelector('.prev').addEventListener('click', () => open(zk - 1));
  dlg.querySelector('.next').addEventListener('click', () => open(zk + 1));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.target.closest('[role="slider"]')) return;   // the divider and the time bar take the arrows themselves
    if (e.key === 'ArrowLeft') open(zk - 1); else if (e.key === 'ArrowRight') open(zk + 1);
  });
  dlg.addEventListener('close', () => E.hold(null));   // the canvas goes back to the page
}

overview();
bench();
// (Real-to-Sim is r2s3d.js: the simulator scene in free-view 3D)
near($('ap-lh'), longHorizon);
near($('ap-ret'), retarget);
near($('apWall'), wall);
