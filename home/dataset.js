// 03 Data: the release as its scene tiles, one per scan (the hero's atlas and data/scenes.json: a preview tile, a
// category and a review grade for each of the scans). The same tiles are used from top to bottom:
//   1. the one scroll (#dsWall): the X of every scan spreads into a wall that fills the screen and dims under six figures;
//   2. the tabs (#dsStage): three arrangements of the tiles, switched by a click. All of them as one grid (the wall again,
//      which sorts itself into the grades once the card is on screen); the review grades as a flow
//      (the film's act 3: a band per grade from the reviewed set to its bin); the scenes and the tasks side by side,
//      each on its own axis: on the left the scans, a row of tiles per scene category; on the right the recordings, a
//      block per action with a chip for each scene type it was recorded in (#dsTasks). Nothing joins the two but a
//      name: a category and the scene type of the same name light each other under the pointer. The recordings are
//      data/recordings.json { total, tasks, rows: [{ name, group, tasks }], cols: [{ name, group, tasks, cat }],
//      counts: [row][col], frames?: { "row,col": { src, cols, rows, index, label } }, placeholder?: true }. Its cols
//      list every scan category and every scene type of the tasks, matched by name: cat is the scan category in
//      scenes.json (null: a scene type only the tasks have), tasks and the counts are null where only the scans have
//      it. A file marked placeholder is shown under a "sample data" flag; frames (an example frame per count, cut
//      from a sheet) are optional;
//   3. every scene (#dsBrowse): a full-screen browser with grade and category filters, behind one button, a click on
//      a tile (the grid, the grades) or a click on a category's row (the third arrangement).
// Both files come from the film's act-3 data (build_data.py). A scan without a preview picture is drawn as a blank
// tile, so there is a tile for every scan.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (u) => u * u * (3 - 2 * u);
const io3 = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const out3 = (u) => 1 - (1 - u) ** 3;
const lerp = (a, b, u) => a + (b - a) * u;
const fmt = (n) => n.toLocaleString('en-US');
const load = (src) => new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = rej; im.src = src; });
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function rng(a) {   // mulberry32: the same layout on every load
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const sec = $('#data');
const D = await fetch('data/scenes.json').then((r) => r.json());
const R = await fetch('data/recordings.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);   // (without it: no third tab)
const atlas = await load('assets/atlas_small.jpg');
await document.fonts.load('600 12.5px "Inter Tight"').catch(() => {});

// ---------------------------------------------------------------- the scenes
const GRADES = D.outcomes, CATS = D.categories;
const QCOL = ['#ccffa0', '#9cc3ff', '#ffb36b'];   // a colour per grade (perfect, usable, reuse candidate)
const SCANS = '1,500+', RECS = '4,000+';         // the totals as the page states them: fixed, not counted (the user's call of 2026-11-11); no grade is given a number
const [TW, TH] = D.tile, AC = D.atlasCols, AROWS = Math.round(atlas.height / TH);
const rnd = rng(1812);
const SC = D.t.map((t, i) => ({ t, cat: D.c[i], qc: D.q[i] }));
for (let i = SC.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [SC[i], SC[j]] = [SC[j], SC[i]]; }   // one fixed shuffle: the X's tiles nearest its centre first
const N = SC.length;
const QN = GRADES.map((_, q) => SC.filter((s) => s.qc === q).length);
const CN = CATS.map((_, c) => SC.filter((s) => s.cat === c).length);
const BLANK = SC.filter((s) => s.t < 0).length;
const BYQ = GRADES.map((_, q) => SC.map((s, i) => (s.qc === q ? i : -1)).filter((i) => i >= 0));
const RANK = new Float32Array(N), DEL = new Float32Array(N), DELA = new Float32Array(N);
for (const ids of BYQ) ids.forEach((i, r) => { RANK[i] = (r + 0.5) / ids.length; });
for (let i = 0; i < N; i++) DEL[i] = rnd();
const ORDER = CATS.map((_, c) => c).sort((a, b) => CN[b] - CN[a]);   // the categories, largest first
// the third arrangement's two sides. ROWS: the scans' categories, a row each, in their groups and the largest of a group
// first, each with its scans (best grade first). TS: the tasks' own scene types (j: its column in the counts; row: the
// row of the scan category of the same name, -1 where the scans have none)
const ROWS = (R ? R.cols : []).filter((c) => c.cat != null).map((c) => {
  const ids = SC.map((s, i) => (s.cat === c.cat ? i : -1)).filter((i) => i >= 0).sort((a, b) => SC[a].qc - SC[b].qc);
  return { name: c.name, group: c.group, cat: c.cat, ids, n: ids.length };
});
{ const g = [...new Set(ROWS.map((r) => r.group))]; ROWS.sort((a, b) => g.indexOf(a.group) - g.indexOf(b.group) || b.n - a.n); }
const TS = (R ? R.cols : []).map((c, j) => ({ ...c, j })).filter((c) => c.tasks != null).map((c) => ({ ...c, row: ROWS.findIndex((r) => r.cat === c.cat) }));
const hiSrc = (t) => `assets/tiles_hi/${String(t).padStart(4, '0')}.webp`;
const spritePos = (t) => `${((t % AC) / (AC - 1)) * 100}% ${(Math.floor(t / AC) / Math.max(1, AROWS - 1)) * 100}%`;

// ---------------------------------------------------------------- arrangements: where each tile sits (x, y, w, h)
const GAP = 0.08;                                     // the gap between tiles, as a share of a tile
const put = (P, i, x, y, w, h) => { const o = i * 4; P[o] = x; P[o + 1] = y; P[o + 2] = w; P[o + 3] = h; };

// the X, the hero's letter in whole 16:9 tiles: a square outline, two arms about 22% of its width, their ends cut
// level and their outer corners on the outline's corners. Every row holds one run of L tiles per arm; the run steps
// sideways from row to row (one run where the arms cross). Of the grids near those proportions, the one that holds
// exactly the scenes; failing that, the one with the fewest to spare, which lose tiles in the crooks of the crossing,
// where it does not show. The tiles nearest the crossing first. In units of 16 x 9 per tile, about the centre.
const XS = (() => {
  const runs = (rows, cols, L) => Array.from({ length: rows >> 1 }, (_, r) => Math.round((cols - L) * (r + 0.5) / rows));   // each upper row's first column
  const size = (rows, cols, L) => 2 * runs(rows, cols, L).reduce((n, a) => n + Math.min(2 * L, cols - 2 * a), 0) + (rows % 2 ? L : 0);
  let best = null;
  for (let rows = 30; rows <= 240; rows++) {
    const c0 = Math.round(rows * 9 / 16);
    for (let cols = Math.max(8, c0 - 4); cols <= c0 + 4; cols++) {
      const l0 = Math.round(0.22 * cols);
      for (let L = Math.max(2, l0 - 3); L <= l0 + 3; L++) {
        if (rows % 2 && (cols - L) % 2) continue;     // an odd middle row has to sit on the centre
        const over = size(rows, cols, L) - N;
        if (over < 0) continue;
        const cost = Math.abs(cols * 16 / (rows * 9) - 1) + 4 * Math.abs(L / cols - 0.22);
        if (!best || over < best.over || (over === best.over && cost < best.cost)) best = { rows, cols, L, over, cost };
      }
    }
  }
  if (!best) throw new Error('no X holds the scenes');
  const { rows, cols, L, over } = best, W = cols * 16, H = rows * 9, cells = [];
  const row = (r, a) => { for (let c = 0; c < cols; c++) if ((c >= a && c < a + L) || (c >= cols - L - a && c < cols - a)) cells.push([c * 16 + 8 - W / 2, r * 9 + 4.5 - H / 2]); };
  runs(rows, cols, L).forEach((a, r) => { row(r, a); row(rows - 1 - r, a); });
  if (rows % 2) row(rows >> 1, (cols - L) / 2);
  if (over) {   // the crooks: (+-w/2, 0) and (0, +-v), where the arms' edges meet
    const w = L * 16, v = (w * H) / (2 * (cols - L) * 16), crook = ([x, y]) => Math.min(Math.hypot(Math.abs(x) - w / 2, y), Math.hypot(x, Math.abs(y) - v));
    cells.sort((p, q) => crook(q) - crook(p));
    cells.length -= over;
  }
  cells.sort((p, q) => p[0] * p[0] + p[1] * p[1] - (q[0] * q[0] + q[1] * q[1]));
  const at = new Float32Array(N * 2);
  let far = 1;
  for (let i = 0; i < N; i++) { at[2 * i] = cells[i][0]; at[2 * i + 1] = cells[i][1]; far = Math.max(far, Math.hypot(cells[i][0], cells[i][1])); }
  for (let i = 0; i < N; i++) DELA[i] = 0.55 * DEL[i] + 0.45 * (1 - Math.hypot(at[2 * i], at[2 * i + 1]) / far);   // the tips leave first
  return { W, H, at, rows, cols, L, over };
})();
function layX(W, H, fitW, fitH, cy = H / 2) {
  const k = Math.min(fitH / XS.H, fitW / XS.W), w = 16 * k * (1 - GAP), h = 9 * k * (1 - GAP), P = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) put(P, i, W / 2 + XS.at[2 * i] * k - w / 2, cy + XS.at[2 * i + 1] * k - h / 2, w, h);
  return { P };
}
// the wall: the largest tiles whose full rows still cover the screen (a last short row falls below it). Each tile goes
// to the place of its own rank, top to bottom and left to right, so the X opens out rather than shuffles.
function layWall(W, H, from) {
  let cols = 1;
  for (let c = 260; c >= 1; c--) if (Math.floor(N / c) * (W / c) * 9 / 16 >= H) { cols = c; break; }
  const tw = W / cols, th = tw * 9 / 16, top = (H - Math.floor(N / cols) * th) / 2, P = new Float32Array(N * 4);
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => from[4 * a + 1] - from[4 * b + 1] || from[4 * a] - from[4 * b]);
  for (let r = 0; r * cols < N; r++) {
    order.slice(r * cols, (r + 1) * cols).sort((a, b) => from[4 * a] - from[4 * b])
      .forEach((i, c) => put(P, i, c * tw + tw * GAP / 2, top + r * th + th * GAP / 2, tw * (1 - GAP), th * (1 - GAP)));
  }
  return { P };
}
// every scan as one even grid inside the card (the tabs' first arrangement): the largest tiles whose rows all fit, the
// last row centred. It is the wall of the scroll above, at the card's size.
function layGrid(W, H, pad) {
  const w = W - 2 * pad, h = H - 2 * pad;
  let cols = N;
  for (let c = 1; c <= N; c++) if (Math.ceil(N / c) * (w / c) * 9 / 16 <= h) { cols = c; break; }
  const tw = w / cols, th = tw * 9 / 16, rows = Math.ceil(N / cols), top = pad + (h - rows * th) / 2, P = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / cols), n = r === rows - 1 ? N - r * cols : cols;
    put(P, i, pad + (w - n * tw) / 2 + (i % cols) * tw + tw * GAP / 2, top + r * th + th * GAP / 2, tw * (1 - GAP), th * (1 - GAP));
  }
  return { P };
}
// the review grades: a bar of the whole set on the left, a segment per grade; a bin per grade on the right, its height
// set by its tiles; bands join the two
function layQC(W, H) {
  const narrow = W < 620, pad = narrow ? 12 : 22, head = narrow ? 24 : 30, inp = narrow ? 7 : 12, gap = narrow ? 6 : 8;
  const xb = Math.round(W * (narrow ? 0.31 : 0.38)), bw = W - pad - xb, ah = H - 2 * pad;
  let tw = 3, cols = Math.max(1, Math.floor((bw - 2 * inp) / tw)), rows = QN.map((n) => Math.ceil(n / cols));
  for (let t = 34; t >= 3; t -= 0.25) {
    const c = Math.floor((bw - 2 * inp) / t), r = QN.map((n) => Math.ceil(n / Math.max(1, c)));
    if (c >= 3 && r.reduce((s, v) => s + head + v * t * 9 / 16 + inp, 0) + (QN.length - 1) * gap <= ah) { tw = t; cols = c; rows = r; break; }
  }
  const th = tw * 9 / 16, total = rows.reduce((s, v) => s + head + v * th + inp, 0) + (QN.length - 1) * gap, P = new Float32Array(N * 4), bins = [];
  let y = pad + (ah - total) / 2;
  QN.forEach((n, q) => {
    const h = head + rows[q] * th + inp;
    bins.push({ x: xb, y, w: bw, h });
    BYQ[q].forEach((i, r) => put(P, i, xb + inp + (r % cols) * tw + tw * GAP / 2, y + head + Math.floor(r / cols) * th + th * GAP / 2, tw * (1 - GAP), th * (1 - GAP)));
    y += h + gap;
  });
  const sx = pad + (narrow ? 2 : 26), sw = narrow ? 7 : 10, sg = 3, sh = Math.min(ah * 0.58, total * 0.6), segs = [];
  let sy = H / 2 - sh / 2 + (narrow ? 14 : 18);
  QN.forEach((n) => { const h = (sh - (QN.length - 1) * sg) * n / N; segs.push([sy, sy + h]); sy += h + sg; });
  return { P, bins, segs, sx, sw, x0: sx + sw + 5, x1: xb - 5, inp, head };
}
// scenes and tasks, side by side: the scans' half. A row per scene category under its group's name, the largest category
// of a group first: its name and count on the left, then its tiles in lines of one length, best grade first. The tile
// is the largest that lets every row into the room (a row is never thinner than its name). x1: the half's right edge;
// top, room: where it starts and how tall it may be. The other half is a DOM panel (#dsTasks); placeMix() sets both.
function layMix(x1, top, room, narrow) {
  const pad = narrow ? 12 : 22, NL = narrow ? 112 : 138, x0 = pad + NL + 10, tw = x1 - x0;
  const HH = 22, GH = 22, G = 7, GG = narrow ? 8 : 12, min = 20;   // the heading; a group's name; between rows; between groups; a row at least
  const first = ROWS.map((r, k) => !k || r.group !== ROWS[k - 1].group), ng = first.filter(Boolean).length;
  const fixed = HH + ng * GH + (ROWS.length - ng) * G + (ng - 1) * GG;
  let per = Math.max(1, Math.floor(tw / 16)), t, hs;
  for (; ; per++) {
    t = tw / per; hs = ROWS.map((r) => Math.max(min, Math.ceil(r.n / per) * t * 9 / 16));
    if (t <= 3 || hs.reduce((s, v) => s + v, fixed) <= room) break;
  }
  const th = t * 9 / 16, P = new Float32Array(N * 4), rows = [], heads = [];
  let y = top + HH;
  ROWS.forEach((r, k) => {
    if (first[k]) { if (k) y += GG; heads.push({ y, name: r.group }); y += GH; } else y += G;
    const y0 = y + (hs[k] - Math.ceil(r.n / per) * th) / 2;   // (a short row's tiles on its name's line)
    r.ids.forEach((id, q) => put(P, id, x0 + (q % per) * t + t * GAP / 2, y0 + Math.floor(q / per) * th + th * GAP / 2, t * (1 - GAP), th * (1 - GAP)));
    rows.push({ y, h: hs[k] });
    y += hs[k];
  });
  return { P, rows, heads, x0, x1, tw, top, bot: y, pad, NL };
}

// ---------------------------------------------------------------- drawing the tiles
const SX = new Uint16Array(N), SY = new Uint16Array(N), BLANKS = [];
SC.forEach((s, i) => { if (s.t < 0) BLANKS.push(i); else { SX[i] = (s.t % AC) * TW; SY[i] = Math.floor(s.t / AC) * TH; } });
// the atlas at half and quarter size as well: most tiles are drawn far smaller than its 64 x 36, and a copy near the
// drawn size is both cheaper to draw and steadier in motion than a 4x reduction on every frame
const MIP = [atlas];
for (let k = 1; k < 3; k++) {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  c.width = atlas.width >> k; c.height = atlas.height >> k;
  x.imageSmoothingQuality = 'high';
  x.drawImage(MIP[k - 1], 0, 0, c.width, c.height);
  MIP.push(c);
}
function paint(c2, P, W, H, dpr) {
  const a = (TW / 2) * 1.1 / dpr, b = (TW / 4) * 1.1 / dpr;   // a tile up to 10% wider than a copy's tiles takes that copy
  for (let i = 0; i < N; i++) {
    const o = i * 4, x = P[o], y = P[o + 1], w = P[o + 2], h = P[o + 3];
    if (SC[i].t < 0 || x > W || y > H || x + w < 0 || y + h < 0) continue;
    const k = w > a ? 0 : w > b ? 1 : 2;
    c2.drawImage(MIP[k], SX[i] >> k, SY[i] >> k, TW >> k, TH >> k, x, y, w, h);
  }
  c2.fillStyle = '#1a1b1d'; c2.strokeStyle = 'rgba(255,255,255,0.2)'; c2.lineWidth = 1;   // a scan without a preview yet
  for (const i of BLANKS) {
    const o = i * 4, x = P[o], y = P[o + 1], w = P[o + 2], h = P[o + 3];
    c2.fillRect(x, y, w, h);
    if (w > 9) c2.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}
function rr(c2, x, y, w, h, r) { c2.beginPath(); if (c2.roundRect) c2.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); else c2.rect(x, y, w, h); }

// ---------------------------------------------------------------- 1. the one scroll: X -> wall -> six figures
const wall = $('#dsWall'), wcv = $('#dsWallCv'), wctx = wcv.getContext('2d'), xcap = $('#dsXcap'), nums = $$('.ds-num', sec);
const A = { W: 0, H: 0, dpr: 1, a: null, b: null, P: new Float32Array(N * 4), p: reduce ? 1 : 0, key: '', f: '', on: false, raf: 0 };
function sizeA() {
  A.dpr = Math.min(devicePixelRatio || 1, 2); A.W = wcv.clientWidth; A.H = wcv.clientHeight;
  if (!A.W || !A.H) return;
  wcv.width = Math.round(A.W * A.dpr); wcv.height = Math.round(A.H * A.dpr);
  A.a = layX(A.W, A.H, A.W * 0.88, A.H * 0.74, A.H / 2 + 6);
  A.b = layWall(A.W, A.H, A.a.P);
  for (const el of nums) {   // each figure keeps the width of its final value while it counts up
    const dt = el.firstElementChild;
    dt.style.width = ''; dt.firstChild.nodeValue = fmt(+dt.dataset.n); dt.style.width = `${Math.ceil(dt.getBoundingClientRect().width)}px`;
  }
  A.key = '';
  drawA();
}
// scroll: 0.05-0.56 the tiles leave the X for the wall (the tips first), 0.44-0.68 the wall dims and greys, 0.58-0.86
// the six figures come up one after another; the rest holds
function drawA() {
  if (!A.a) return;
  const p = A.p, key = p.toFixed(4);
  if (key === A.key) return;
  A.key = key;
  const s = span(p, 0.05, 0.56), lag = 0.5, a = A.a.P, b = A.b.P, P = A.P;
  for (let i = 0; i < N; i++) {
    const u = smooth(clamp01(s * (1 + lag) - lag * DELA[i])), o = i * 4;
    P[o] = lerp(a[o], b[o], u); P[o + 1] = lerp(a[o + 1], b[o + 1], u); P[o + 2] = lerp(a[o + 2], b[o + 2], u); P[o + 3] = lerp(a[o + 3], b[o + 3], u);
  }
  wctx.setTransform(A.dpr, 0, 0, A.dpr, 0, 0);
  wctx.clearRect(0, 0, A.W, A.H);
  paint(wctx, P, A.W, A.H, A.dpr);
  const d = smooth(span(p, 0.44, 0.68)), f = d > 0.002 ? `grayscale(${(0.85 * d).toFixed(3)}) brightness(${lerp(1, 0.22, d).toFixed(3)})` : 'none';
  if (f !== A.f) { A.f = f; wcv.style.filter = f; }
  xcap.style.opacity = String(1 - span(p, 0.03, 0.12));
  nums.forEach((el, k) => {
    const v = smooth(span(p, 0.58 + k * 0.028, 0.72 + k * 0.028)), dt = el.firstElementChild, txt = fmt(Math.round(+dt.dataset.n * out3(v)));
    el.style.opacity = String(v);
    el.style.transform = `translateY(${((1 - v) * 28).toFixed(1)}px)`;
    if (dt.firstChild.nodeValue !== txt) dt.firstChild.nodeValue = txt;
  });
}
function onScroll() {
  if (!A.on) return;
  const r = wall.getBoundingClientRect();
  A.p = reduce ? 1 : clamp01(-r.top / Math.max(1, r.height - innerHeight));
  if (!A.raf) A.raf = requestAnimationFrame(() => { A.raf = 0; drawA(); });
}
addEventListener('scroll', onScroll, { passive: true });

// ---------------------------------------------------------------- 2. the tabs: all scenes / by review grade / by scene and task
// The stage is --h0 tall, and --h1 while it shows the scenes and the tasks: at least as tall, and as tall as their two
// halves need (--need, which placeMix() sets). The canvas is always --h1 tall.
const stage = $('#dsStage'), pan = $('#dsPan'), cv = $('#dsCv'), ctx = cv.getContext('2d'), labs = $('#dsLabs'), tk = $('#dsTasks'), say = $('#dsSay'), tip = $('#dsTip');
const tabs = $$('.ds-tabs [role="tab"]', sec);
if (!R) tabs.pop().remove();                         // no third arrangement without the recordings
// W x H0: the stage as the grid and the grades see it; W x H: the canvas; lit, was, hk: the rows of scans that are lit (a bit each: now, last) and how far their light is up; ph: the tasks' panel as placed
const S = { W: 0, H: 0, H0: 0, dpr: 1, L: null, view: 'all', cur: new Float32Array(N * 4), from: new Float32Array(N * 4), to: null, t0: 0, moving: false, band: false, aq: 0, lit: 0, was: 0, hk: 0, ph: 0, hover: -1, on: false, raf: 0, last: 0 };
const SAY = {
  all: [SCANS, 'scans in this release. <strong>One tile per scan,</strong> each a real space captured in 3D at metric scale.'],
  qc: [SCANS, 'scans, each one reviewed and graded <strong>perfect, usable or reuse candidate.</strong>'],
  mix: [RECS, `recordings of ${R?.tasks ?? 0} tasks, beside the ${SCANS} scans. <strong>Scene categories on the left, actions on the right.</strong> Point at one to see where it meets the other side.`],
};
const ALT = {
  all: () => `${SCANS} scene tiles in one grid, one per scan`,
  qc: () => `${SCANS} scene tiles sorted by review grade: ${GRADES.join(', ')}`,
  mix: () => `${SCANS} scene tiles in rows by scene category (${ROWS.map((r) => `${r.name} ${fmt(r.n)}`).join(', ')}), beside the recordings of each action`,
};
function sizeB() {
  S.dpr = Math.min(devicePixelRatio || 1, 2); S.W = stage.clientWidth; S.H0 = $('.ds-h0', stage).offsetHeight;
  if (!S.W || !S.H0) return;
  cool();
  const mix = R && placeMix();                        // (first: it sets how tall the canvas is)
  S.H = pan.clientHeight;
  cv.width = Math.round(S.W * S.dpr); cv.height = Math.round(S.H * S.dpr);
  const pad = S.W < 620 ? 16 : 28;
  S.L = { all: layGrid(S.W, S.H0, pad), qc: layQC(S.W, S.H0), mix };
  S.cur.set(S.L[S.view].P);
  S.moving = false; S.aq = S.view === 'qc' ? 1 : 0; S.lit = 0; S.hk = 0; S.hover = -1;
  labels();
  if (S.on) drawB();
}
// The two halves of the third arrangement. Where the stage is wide enough they stand side by side: the tasks' panel on
// the right, as tall as its chips wrap, the rows of scans on the left over the same height. On a narrower stage the
// panel goes under the rows. Either way the stage grows to hold them (--need).
function placeMix() {
  const W = S.W, narrow = W < 620, side = W >= 860, pad = narrow ? 12 : 22, gaps = R.rows.length;
  const pw = side ? Math.round(clamp(W * 0.44, 400, 540)) : W - 2 * pad;
  tk.classList.toggle('side', side); tk.classList.toggle('col', pw < 470);
  tk.style.cssText = `width:${pw}px`;
  const ph = tk.offsetHeight;                         // (with the least gap between its blocks)
  let m, top, gap = 12;
  if (side) {   // a stage taller than the panel: its blocks a little further apart, then both halves centred
    const H = Math.max(S.H0, ph + 2 * pad);
    gap = clamp(12 + (H - 2 * pad - ph) / gaps, 12, 26);
    const h = ph + (gap - 12) * gaps;
    top = Math.round((H - h) / 2);
    m = layMix(W - pw - 3 * pad, top, h, narrow);
    stage.style.setProperty('--need', `${Math.ceil(ph + 2 * pad)}px`);
  } else {
    m = layMix(W - pad, pad + 2, narrow ? 560 : 500, narrow);
    top = Math.round(m.bot + 28);
    stage.style.setProperty('--need', `${Math.ceil(top + ph + pad + 4)}px`);
  }
  tk.style.cssText = `left:${side ? W - pad - pw : pad}px;top:${top}px;width:${pw}px;--gap:${gap.toFixed(1)}px`;
  S.ph = tk.offsetHeight;
  return m;
}
function labels() {
  const q = S.L.qc, m = S.L.mix;
  labs.innerHTML = q.bins.map((b, g) => `<p class="ds-lab ds-lab-q" data-v="qc" style="left:${(b.x + q.inp).toFixed(1)}px;top:${(b.y + q.head / 2 - 7).toFixed(1)}px;--c:${QCOL[g]}">${GRADES[g]}</p>`).join('')
    + `<p class="ds-lab ds-lab-src" data-v="qc" style="left:${q.sx}px;${S.W < 620 ? 'top:14px' : `bottom:${(S.H - q.segs[0][0] + 12).toFixed(1)}px`}"><b>${SCANS}</b>scans reviewed</p>`   // (clear of the bands on a narrow stage)
    // the scans' half of the third arrangement: its heading, each group's name over its rows, each row's name and count (a button: it opens that category)
    + (m ? `<p class="ds-lab ds-lab-h" data-v="mix" style="left:${m.pad}px;top:${m.top}px;width:${m.x1 - m.pad}px"><span>Scans by scene category</span><span>${SCANS}</span></p>`
      + m.heads.map((h) => `<p class="ds-lab ds-lab-g" data-v="mix" style="left:${m.pad}px;top:${h.y.toFixed(1)}px;width:${m.x1 - m.pad}px">${h.name}</p>`).join('')
      + m.rows.map((w, k) => `<button type="button" class="ds-row" data-k="${k}" style="left:${m.pad}px;top:${w.y.toFixed(1)}px;width:${m.NL}px;height:${w.h.toFixed(1)}px" title="See the ${fmt(ROWS[k].n)} ${ROWS[k].name} scans"><b>${ROWS[k].name}</b><i>${fmt(ROWS[k].n)}</i></button>`).join('') : '');
  T.rows = $$('.ds-row', labs);
}
function go(view) {
  if (view === S.view || !S.L) return;
  S.from.set(S.cur); S.to = S.L[view].P; S.band = view === 'qc'; S.view = view; S.t0 = performance.now(); S.moving = !reduce; S.hover = -1;
  if (reduce) { S.cur.set(S.to); S.aq = view === 'qc' ? 1 : 0; }
  cool(); S.hk = 0;
  hideTip();
  stage.dataset.view = view;
  stage.classList.remove('hit');
  cv.setAttribute('aria-label', ALT[view]());
  for (const b of tabs) { const on = b.dataset.v === view; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
  say.classList.remove('swap');
  say.innerHTML = `<b>${SAY[view][0]}</b><p>${SAY[view][1]}</p>`;
  void say.offsetWidth;
  say.classList.add('swap');
  S.on ? kick() : drawB();
}
// a tile on its way to its bin: to the mouth of its grade's band, along the band, then to its place
function flow(P, a, b, o, i, u, q) {
  const g = SC[i].qc, f = RANK[i], seg = q.segs[g], bin = q.bins[g], w = b[o + 2], h = b[o + 3];
  const y1 = lerp(seg[0], seg[1], f), y2 = bin.y + 8 + f * (bin.h - 16), fx = a[o] + a[o + 2] / 2, fy = a[o + 1] + a[o + 3] / 2;
  let x, y, s = 1;
  if (u < 0.3) { const e = (u / 0.3) ** 2; x = lerp(fx, q.x0, e); y = lerp(fy, y1, e); s = e; }
  else if (u < 0.72) { const v = (u - 0.3) / 0.42; x = q.x0 + (q.x1 - q.x0) * (1.5 * v - 1.5 * v * v + v * v * v); y = y1 + (y2 - y1) * smooth(v); }
  else { const e = out3((u - 0.72) / 0.28); x = lerp(q.x1, b[o] + w / 2, e); y = lerp(y2, b[o + 1] + h / 2, e); }
  const ww = lerp(a[o + 2], w, s), hh = lerp(a[o + 3], h, s);
  P[o] = x - ww / 2; P[o + 1] = y - hh / 2; P[o + 2] = ww; P[o + 3] = hh;
}
function frame(now) {
  S.raf = 0;
  const dt = Math.min(60, Math.max(0, now - S.last));
  S.last = now;
  let busy = false;
  if (S.moving) {
    const t = now - S.t0, dur = S.band ? 1700 : 1150, spread = S.band ? 1500 : 650, a = S.from, b = S.to, P = S.cur, q = S.L.qc;
    for (let i = 0; i < N; i++) {
      const u = clamp01((t - DEL[i] * spread) / dur), o = i * 4;
      if (u < 1) busy = true;
      if (S.band) flow(P, a, b, o, i, u, q);
      else { const e = io3(u); P[o] = lerp(a[o], b[o], e); P[o + 1] = lerp(a[o + 1], b[o + 1], e); P[o + 2] = lerp(a[o + 2], b[o + 2], e); P[o + 3] = lerp(a[o + 3], b[o + 3], e); }
    }
    if (!busy) { S.moving = false; P.set(b); }
  }
  const tq = S.view === 'qc' ? 1 : 0, tl = S.lit ? 1 : 0, k = dt / 380, kl = dt / 170;   // the bands with the move; the lit rows' light
  S.aq = tq > S.aq ? Math.min(tq, S.aq + k) : Math.max(tq, S.aq - k);
  S.hk = tl > S.hk ? Math.min(tl, S.hk + kl) : Math.max(tl, S.hk - kl);
  if (S.aq !== tq || S.hk !== tl) busy = true;
  drawB();
  if (busy) kick();
}
function kick() { if (!S.raf && S.on) { S.last = performance.now(); S.raf = requestAnimationFrame(frame); } }
function drawB() {
  if (!S.L) return;
  const mix = S.view === 'mix', { W, H0: H, dpr, cur: P } = S;   // (W x H: the room a lifted tile keeps to)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, S.H);
  if (S.aq > 0.004) {   // the bar of the whole set, a band and a bin per grade
    const q = S.L.qc, mx = (q.x0 + q.x1) / 2;
    for (let g = 0; g < QN.length; g++) {
      const [s0, s1] = q.segs[g], b = q.bins[g], b0 = b.y + 8, b1 = b.y + b.h - 8;
      ctx.beginPath(); ctx.moveTo(q.x0, s0); ctx.bezierCurveTo(mx, s0, mx, b0, q.x1, b0); ctx.lineTo(q.x1, b1); ctx.bezierCurveTo(mx, b1, mx, s1, q.x0, s1); ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle = QCOL[g]; ctx.lineWidth = 1;
      ctx.globalAlpha = S.aq * 0.12; ctx.fill();
      ctx.globalAlpha = S.aq * 0.38; ctx.stroke();
      ctx.globalAlpha = S.aq; rr(ctx, q.sx, s0, q.sw, s1 - s0, 3); ctx.fill();
      rr(ctx, b.x, b.y, b.w, b.h, 14);
      ctx.globalAlpha = S.aq * 0.035; ctx.fillStyle = '#fff'; ctx.fill();
      ctx.globalAlpha = S.aq * 0.26; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  paint(ctx, P, W, S.H, dpr);
  if (mix && S.hk > 0.004 && !S.moving) {   // some rows of scans are lit: the other rows step back
    const m = S.L.mix;
    ctx.fillStyle = `rgba(11,11,12,${(0.7 * S.hk).toFixed(3)})`;
    m.rows.forEach((w, k) => { if (!(S.was >> k & 1)) ctx.fillRect(m.x0 - 1, w.y - 1, m.tw + 2, w.h + 2); });
  }
  if (S.hover >= 0) {   // the tile under the cursor, lifted
    const o = S.hover * 4, w = Math.max(76, P[o + 2] * 2.6), h = w * 9 / 16;
    const x = clamp(P[o] + P[o + 2] / 2 - w / 2, 3, W - w - 3), y = clamp(P[o + 1] + P[o + 3] / 2 - h / 2, 3, H - h - 3), s = SC[S.hover];
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 22; ctx.fillStyle = '#1a1b1d'; ctx.fillRect(x, y, w, h); ctx.restore();
    if (s.t >= 0) ctx.drawImage(atlas, SX[S.hover], SY[S.hover], TW, TH, x, y, w, h);
    ctx.strokeStyle = '#ccffa0'; ctx.lineWidth = 1.5; ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
  }
}
for (const b of tabs) b.addEventListener('click', () => { S.auto = false; go(b.dataset.v); });
$('.ds-tabs', sec).addEventListener('keydown', (e) => {
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!d) return;
  e.preventDefault();
  S.auto = false;
  const b = tabs[(tabs.findIndex((t) => t.dataset.v === S.view) + d + tabs.length) % tabs.length];
  b.focus(); go(b.dataset.v);
});

// the scene under the cursor (the grid and the grades): lifted on the canvas, its picture, category and grade beside it; a click opens it
function hideTip() { tip.hidden = true; tip.dataset.key = ''; }
function placeTip(x, y, h) {
  const w = tip.offsetWidth || 264, px = clamp(x, w / 2 + 12, innerWidth - w / 2 - 12), above = y - h - 26 > 8;
  tip.style.left = `${px}px`;
  tip.style.top = `${above ? y - 22 : y + 26}px`;
  tip.classList.toggle('below', !above);
}
function sceneTip(i, x, y) {
  const key = `s${i}`, s = SC[i];
  if (tip.dataset.key !== key) {
    tip.className = 'ds-tip'; tip.dataset.key = key;
    tip.innerHTML = (s.t < 0 ? '<div class="pic none">No preview yet</div>'
      : `<div class="pic" style="background-image:url(assets/atlas_small.jpg);background-size:${AC * 100}% auto;background-position:${spritePos(s.t)}"><img src="${hiSrc(s.t)}" alt=""></div>`)
      + `<div class="tt"><b>${CATS[s.cat]}</b><span style="--c:${QCOL[s.qc]}">${GRADES[s.qc]}</span></div>`;
  }
  tip.hidden = false;
  placeTip(x, y, 200);
}
function pick(e) {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, P = S.cur;
  for (let i = 0; i < N; i++) { const o = i * 4; if (x >= P[o] - 1 && x <= P[o] + P[o + 2] + 1 && y >= P[o + 1] - 1 && y <= P[o + 1] + P[o + 3] + 1) return i; }
  return -1;
}
// Beside the tasks no tile is opened up: a row of tiles stands for its category, so the pointer on it lights the row (and
// what the tasks have under that name) and a click opens that category's scans, as on the row's name.
function rowAt(e) {
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, m = S.L.mix;
  return x < m.pad || x > m.x1 + 2 ? -1 : m.rows.findIndex((w) => y >= w.y - 2 && y <= w.y + w.h + 2);
}
cv.addEventListener('pointermove', (e) => {
  if (S.moving || e.pointerType === 'touch') return;
  if (S.view === 'mix') { const k = rowAt(e); stage.classList.toggle('hit', k >= 0); if (k >= 0) litScene(k); else cool(); return; }
  const i = pick(e);
  stage.classList.toggle('hit', i >= 0);
  if (i !== S.hover) { S.hover = i; kick(); }
  if (i < 0) hideTip(); else sceneTip(i, e.clientX, e.clientY);
});
cv.addEventListener('pointerleave', () => { if (S.hover >= 0) { S.hover = -1; kick(); } stage.classList.remove('hit'); hideTip(); if (S.view === 'mix') cool(); });
cv.addEventListener('click', (e) => {
  if (S.moving) return;
  if (S.view === 'mix') { const k = rowAt(e); if (k >= 0) { cool(); openBrowse(-1, ROWS[k].cat); } return; }
  const i = pick(e);
  if (i >= 0) openBrowse(i);
});

// ---------------------------------------------------------------- 3. every scene: the full-screen browser
const dlg = $('#dsBrowse'), scroller = $('.ds-b-in', dlg), grid = $('#dsGrid'), count = $('#dsCount'), chipsQ = $('#dsChipsQ'), chipsC = $('#dsChipsC'), none = $('#dsNone'), note = $('#dsNote');
const zoomEl = $('#dsZoom'), zImg = $('img', zoomEl), zName = $('figcaption b', zoomEl), zGrade = $('figcaption span', zoomEl);
const F = { q: -1, c: -1, at: -1, cells: null };
function build() {
  if (F.cells) return;
  chipsQ.innerHTML = '<button type="button" data-q="-1">All grades</button>'
    + GRADES.map((g, q) => `<button type="button" data-q="${q}" style="--c:${QCOL[q]}"><i></i>${g}</button>`).join('');
  chipsC.innerHTML = '<button type="button" data-c="-1">All categories</button>'
    + ORDER.map((c) => `<button type="button" data-c="${c}">${CATS[c]} <b>${fmt(CN[c])}</b></button>`).join('');
  grid.innerHTML = SC.map((s, i) => (s.t < 0
    ? `<div class="ds-th blank" data-i="${i}" style="--c:${QCOL[s.qc]}" role="img" aria-label="${CATS[s.cat]}, ${GRADES[s.qc].toLowerCase()}, no preview yet">${CATS[s.cat]} · no preview yet</div>`
    : `<button type="button" class="ds-th" data-i="${i}" style="--c:${QCOL[s.qc]};background-position:${spritePos(s.t)}" aria-label="${CATS[s.cat]}, ${GRADES[s.qc].toLowerCase()}"><img alt="" decoding="async" data-src="${hiSrc(s.t)}"><span>${CATS[s.cat]}</span></button>`)).join('');
  F.cells = [...grid.children];
  note.hidden = !BLANK;
  note.textContent = `${fmt(BLANK)} scans have no preview picture yet; they are counted and shown as blank tiles.`;
  // the 512 x 288 pictures arrive as their tiles come near the screen; the small atlas stands in until then
  const near = new IntersectionObserver((es) => {
    for (const e of es) { if (!e.isIntersecting) continue; const im = e.target.firstElementChild; im.src = im.dataset.src; near.unobserve(e.target); }
  }, { root: scroller, rootMargin: '500px 0px' });
  for (const el of F.cells) if (!el.classList.contains('blank')) near.observe(el);
  grid.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('in'); }, true);
}
function apply() {
  let n = 0;
  F.cells.forEach((el, i) => { const s = SC[i], ok = (F.q < 0 || s.qc === F.q) && (F.c < 0 || s.cat === F.c); el.hidden = !ok; if (ok) n++; });
  count.textContent = F.q >= 0 ? [GRADES[F.q], ...(F.c >= 0 ? [CATS[F.c]] : [])].join(' · ')   // (a grade gets no count)
    : n === N ? `${SCANS} scenes` : `${fmt(n)} of ${SCANS} scenes`;
  none.hidden = n > 0;
  for (const b of chipsQ.children) b.setAttribute('aria-pressed', String(+b.dataset.q === F.q));
  for (const b of chipsC.children) b.setAttribute('aria-pressed', String(+b.dataset.c === F.c));
}
function zoom(i) {
  const s = SC[i];
  F.at = i;
  zImg.src = hiSrc(s.t); zImg.alt = `${CATS[s.cat]}, ${GRADES[s.qc].toLowerCase()}`;
  zName.textContent = CATS[s.cat]; zGrade.textContent = GRADES[s.qc]; zGrade.style.setProperty('--c', QCOL[s.qc]);
  zoomEl.hidden = false;
}
function unzoom() { if (zoomEl.hidden) return; zoomEl.hidden = true; F.cells[F.at]?.focus({ preventScroll: true }); }
function stepZoom(d) {   // the next scene that passes the filters
  for (let k = 1, i = F.at; k <= N; k++) { i = (i + d + N) % N; if (!F.cells[i].hidden && SC[i].t >= 0) { zoom(i); F.cells[i].scrollIntoView({ block: 'nearest' }); return; } }
}
function openBrowse(i = -1, c = -1) {   // at scene i, or on category c
  build();
  if (i >= 0 || c >= 0) { F.q = -1; F.c = c; }
  apply();
  hideTip();
  document.documentElement.style.overflow = 'hidden';
  if (!dlg.open) dlg.showModal();
  if (c >= 0) scroller.scrollTop = 0;
  if (i >= 0 && SC[i].t >= 0) { F.cells[i].scrollIntoView({ block: 'center' }); zoom(i); } else zoomEl.hidden = true;
}
$('#dsMore').addEventListener('click', () => openBrowse());
$('.ds-b-head .ds-x', dlg).addEventListener('click', () => dlg.close());
dlg.addEventListener('close', () => { document.documentElement.style.overflow = ''; zoomEl.hidden = true; });
dlg.addEventListener('cancel', (e) => { if (!zoomEl.hidden) { e.preventDefault(); unzoom(); } });
chipsQ.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { F.q = +b.dataset.q; apply(); scroller.scrollTop = 0; } });
chipsC.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { F.c = +b.dataset.c; apply(); scroller.scrollTop = 0; } });
grid.addEventListener('click', (e) => { const b = e.target.closest('button.ds-th'); if (b) zoom(+b.dataset.i); });
zoomEl.addEventListener('click', (e) => {
  if (e.target === zoomEl || e.target.closest('.ds-x')) unzoom();
  else if (e.target.closest('.ds-nav')) stepZoom(e.target.closest('.ds-nav').classList.contains('next') ? 1 : -1);
});
dlg.addEventListener('keydown', (e) => {
  if (zoomEl.hidden) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); stepZoom(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); stepZoom(-1); }
});

// ---------------------------------------------------------------- scenes and tasks, side by side: the tasks' half
// A block per action (#dsTasks): its name, its recordings, its paradigm and tasks, then a chip per scene type of the
// tasks it was recorded in, the largest first, the count on a log ramp of green. A combination that was never recorded
// has no chip. The two halves share no axis; what joins them is a name. A row of scans under the pointer (or the keys)
// lights the chips of the scene type of that name; a chip lights that row and the same scene type under the other
// actions; an action's name lights the rows of all its scene types. Where a name has no match on the other side, that
// side stays as it is. A row's name or its tiles open that category's scans.
const RAMP = [[27, 36, 26], [79, 106, 67], [143, 185, 116], [204, 255, 160]];
function ramp(v) { const x = clamp01(v) * 3, k = Math.min(2, Math.floor(x)), u = x - k; return `rgb(${RAMP[k].map((c, j) => Math.round(lerp(c, RAMP[k + 1][j], u))).join(',')})`; }
const T = { key: '', chips: [], acts: [], rows: [] };   // what is lit; the chips, the actions' blocks, the rows' names
function cool() {
  if (!T.key) return;
  T.key = '';
  tk.classList.remove('hot'); labs.classList.remove('hot');
  for (const x of [...T.chips, ...T.acts, ...T.rows]) x.classList.remove('on', 'at');
  S.lit = 0; kick();
  hideTip();
}
// lights the chips that pass on(), the action r and the rows of scans in mask (a bit each); false where that is lit already
function light(key, on, r, mask) {
  if (key === T.key || stage.dataset.view !== 'mix') return false;
  T.key = key;
  let any = false;
  for (const x of T.chips) { const k = on(x); x.classList.toggle('on', k); x.classList.remove('at'); if (k) any = true; }
  T.acts.forEach((x, q) => x.classList.toggle('on', q === r));
  T.rows.forEach((x, k) => x.classList.toggle('on', (mask >> k & 1) === 1));
  tk.classList.toggle('hot', any); labs.classList.toggle('hot', mask > 0);
  S.lit = mask; if (mask) S.was = mask;
  kick();
  return true;
}
function litScene(k) { if (light(`s${k}`, (x) => TS[+x.dataset.c].row === k, -1, 1 << k)) hideTip(); }
function tasks() {
  const { rows } = R, at = (r, c) => R.counts[r][TS[c].j];
  const rowT = rows.map((_, r) => TS.reduce((s, _t, c) => s + at(r, c), 0)), colT = TS.map((_, c) => rows.reduce((s, _a, r) => s + at(r, c), 0));
  const max = Math.max(1, ...rows.flatMap((_, r) => TS.map((_t, c) => at(r, c))));
  const some = (n, one) => `${fmt(n)} ${one}${n === 1 ? '' : 's'}`, pct = (a, b) => `${a * 100 / b < 1 && a ? '<1' : Math.round(a * 100 / b)}%`;
  const masks = rows.map((_, r) => TS.reduce((m, t, c) => (at(r, c) && t.row >= 0 ? m | 1 << t.row : m), 0));   // the rows of scans an action's scene types have
  let tab = 0;                                        // (one chip takes the Tab key; the arrows move among them)
  tk.innerHTML = (R.placeholder ? '<p class="ds-flag">Sample data · not the real counts yet</p>' : '')
    + `<p class="tk-h"><span>Recordings by action</span><em>1<i></i>${fmt(max)} · log scale</em></p>`
    + rows.map((row, r) => `<div class="tk-r" role="group" aria-label="${row.name}: ${some(rowT[r], 'recording')}, ${row.group}, ${some(row.tasks, 'task')}">`
      + `<p class="tk-a" data-r="${r}"><b>${row.name}</b><span>${fmt(rowT[r])}</span><i>${row.group} · ${some(row.tasks, 'task')}</i></p><div class="tk-cs">${
        TS.map((_t, c) => [c, at(r, c)]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]).map(([c, n]) => {
          const v = Math.log(1 + n) / Math.log(1 + max), ti = tab;   // a log scale: the counts run from 1 to several hundred
          tab = -1;
          return `<button type="button" class="tk-c" tabindex="${ti}" data-r="${r}" data-c="${c}" style="--bg:${ramp(v)};--ink:${v > 0.52 ? '#0b0f08' : 'rgba(245,245,247,0.9)'}" aria-label="${row.name} in ${TS[c].name}: ${some(n, 'recording')}">${TS[c].name}<b>${fmt(n)}</b></button>`;
        }).join('')}</div></div>`).join('');
  T.chips = $$('.tk-c', tk); T.acts = $$('.tk-r', tk);
  const litAction = (r) => { if (light(`a${r}`, (x) => +x.dataset.r === r, r, masks[r])) hideTip(); };
  const litChip = (el) => {
    const r = +el.dataset.r, c = +el.dataset.c, t = TS[c], n = at(r, c), fr = R.frames?.[`${r},${t.j}`];
    if (!light(`c${r},${c}`, (x) => +x.dataset.c === c, r, t.row < 0 ? 0 : 1 << t.row)) return;
    el.classList.add('at');
    tip.className = `ds-tip${fr ? '' : ' slim'}`; tip.dataset.key = `h${r},${c}`;
    tip.innerHTML = (fr ? `<div class="pic" style="background-image:url(${fr.src});background-size:${fr.cols * 100}% auto;background-position:${((fr.index % fr.cols) / Math.max(1, fr.cols - 1)) * 100}% ${(Math.floor(fr.index / fr.cols) / Math.max(1, fr.rows - 1)) * 100}%"></div>` : '')
      + `<div class="big"><b>${fmt(n)}</b><span>${n === 1 ? 'recording' : 'recordings'}</span></div>`
      + `<p class="sub"><b>${rows[r].name}</b> in <b>${t.name}</b><br>${pct(n, rowT[r])} of ${rows[r].name} · ${pct(n, colT[c])} of ${t.name}${fr?.label ? `<br>Example: ${fr.label}` : ''}</p>`;
    tip.hidden = false;
    const b = el.getBoundingClientRect();
    placeTip(b.left + b.width / 2, b.top + 16, fr ? 250 : 104);
  };
  tk.addEventListener('pointerover', (e) => {
    const c = e.target.closest('.tk-c'), a = c ? null : e.target.closest('.tk-a');
    if (c) litChip(c); else if (a) litAction(+a.dataset.r);
  });
  tk.addEventListener('pointerout', (e) => { if (!e.relatedTarget?.closest?.('.tk-c, .tk-a')) cool(); });
  tk.addEventListener('focusin', (e) => { const c = e.target.closest('.tk-c'); if (c) litChip(c); });
  tk.addEventListener('focusout', cool);
  tk.addEventListener('keydown', (e) => {             // left and right: the next chip; up and down: the action above or below
    const el = e.target.closest('.tk-c'), d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!el || !d) return;
    e.preventDefault(); e.stopPropagation();          // (the page's scroll keys stay out of the chips)
    let to;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') to = T.chips[T.chips.indexOf(el) + d];
    else {
      const own = T.chips.filter((x) => x.dataset.r === el.dataset.r), next = T.chips.filter((x) => +x.dataset.r === +el.dataset.r + d);
      to = next[Math.min(own.indexOf(el), next.length - 1)];
    }
    if (to) { el.tabIndex = -1; to.tabIndex = 0; to.focus(); }
  });
  // the scans' half: the rows' names (labels() makes them anew at each size)
  const row = (e) => e.target.closest?.('.ds-row');
  labs.addEventListener('pointerover', (e) => { const b = row(e); if (b) litScene(+b.dataset.k); });
  labs.addEventListener('pointerout', (e) => { if (!e.relatedTarget?.closest?.('.ds-row')) cool(); });
  labs.addEventListener('focusin', (e) => { const b = row(e); if (b) litScene(+b.dataset.k); });
  labs.addEventListener('focusout', cool);
  labs.addEventListener('click', (e) => { const b = row(e); if (b) { cool(); openBrowse(-1, ROWS[+b.dataset.k].cat); } });
  addEventListener('scroll', cool, { passive: true });
  document.fonts.ready.then(() => { if (tk.offsetHeight !== S.ph) sizeB(); });   // (the chips wrap by their type's widths)
}

// ---------------------------------------------------------------- start
new IntersectionObserver(([e]) => { A.on = e.isIntersecting; if (A.on) onScroll(); }, { rootMargin: '120px 0px' }).observe(wall);
new IntersectionObserver(([e]) => { S.on = e.isIntersecting; if (S.on) { drawB(); if (S.moving) kick(); } }, { rootMargin: '120px 0px' }).observe(stage);
let rz = 0;
addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { sizeA(); sizeB(); }, 140); });
stage.dataset.view = 'all';
cv.setAttribute('aria-label', ALT.all());
say.innerHTML = `<b>${SAY.all[0]}</b><p>${SAY.all[1]}</p>`;
// The card opens as the wall the scroll above ended on; once most of it is on screen the tiles sort themselves into the
// review grades, one time, unless a tab was chosen first. So the tabs are seen to re-arrange the same tiles.
S.auto = !reduce;
const first = new IntersectionObserver(([e]) => {
  if (!e.isIntersecting) return;
  first.disconnect();
  setTimeout(() => { if (S.auto && S.view === 'all') go('qc'); S.auto = false; }, 450);
}, { threshold: 0.6 });
first.observe(stage);
if (R) tasks();
sizeA();
sizeB();
