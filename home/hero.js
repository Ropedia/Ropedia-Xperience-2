// Hero: one photo wall of the dataset's scans fills the screen (each tile one scene's 3DGS overview, from the film's mosaic
// atlas; scenes repeat once the wall needs more tiles than there are scenes), dark and grey. A letter X (two straight arms
// crossing) is the mask that lights it: inside, the pictures in their own colours, wrapped in a thin green line whose
// light radiates past the edge. On load the X flashes on and the line runs round it; "Ropedia" sits left of it,
// "perience 2" right, and the slogan under it. Scroll 1: the X grows over the wall, the words and the slogan with it;
// it holds. Scroll 2: the whole wall lights up, the words and the slogan grow and fade, and the camera dives into the
// tile at the crossing (LH_17761) until it fills the screen. Hovering a lit tile shows that scene.
const $ = (s) => document.querySelector(s);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (u) => u * u * (3 - 2 * u);
const outCubic = (u) => 1 - (1 - u) ** 3;
const lerp = (a, b, u) => a + (b - a) * u;
const load = (src) => new Promise((res, rej) => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = rej; im.src = src; });

const D = await fetch('data/hero.json').then((r) => r.json());
const [atlas, centre] = await Promise.all([load('assets/atlas_small.jpg'), load('assets/centre_full.jpg')]);
const REC = D.cells.map(([, , t, cat, qc]) => ({ t, cat, qc }));   // the scenes with a preview, in a fixed shuffled order
const [TW, TH] = D.tile, AC = D.atlasCols;

// 512 x 288 pictures, fetched on demand once a tile is drawn well larger than the small atlas, and decoded off the main
// thread before they are used
const hi = new Map(), hiWant = new Set();
let hiLoading = 0, hiVer = 0;
function getHi(t) {
  const im = hi.get(t);
  if (im) return im;
  if (!hiWant.has(t) && hiLoading < 6) {
    hiWant.add(t); hiLoading++;
    const x = new Image();
    x.src = `assets/tiles_hi/${String(t).padStart(4, '0')}.webp`;
    x.decode().then(() => { hi.set(t, x); hiVer++; }).catch(() => {}).finally(() => { hiLoading--; });
  }
  return null;
}

// ---------------------------------------------------------------- the X: a letter X, two straight arms of one width
// crossing, their ends cut level with its top and bottom; as a signed distance (negative inside). It spans [-R2, R2] both
// ways; the units (called blade lengths below) make it 2 * R2 tall.
const R2 = Math.SQRT1_2;
const BW = 0.22 * 2 * R2, BS = 1 - BW / (2 * R2), BC = 1 / Math.hypot(1, BS);   // arm width across, its slope, the slant
function xsdf(x, y) {
  const cut = Math.abs(y) - R2;
  const a1 = (Math.abs(x - BS * y) - BW / 2) * BC, a2 = (Math.abs(x + BS * y) - BW / 2) * BC;
  return Math.max(Math.min(a1, a2), cut);
}
const XH = 2 * R2;                                   // the X's height in blade lengths
const MR = 0.74;                                     // the X lies within [-MR, MR]

// the masks, drawn once in blade lengths over [-LR, LR]^2. mask: where the wall shows in colour (the X, and a little past
// its edge, fading out within a few tiles). solid: the X itself, for the flash.
// glow, over a wider square [-LRG, LRG]^2 and on its own layer that lights what is under it (screen blend): a bright band
// of green light along the edge, a soft halo round it and a faint wide haze, with a thin rim just inside.
const LR = 0.96, LN = 1024, LPX = (2 * LR) / LN, LRG = 1.4, LG = 768, LGP = (2 * LRG) / LG;
function canvasOf(img) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0); return c; }
function lightMaps() {
  const mask = new ImageData(LN, LN), solid = new ImageData(LN, LN), m8 = mask.data, s8 = solid.data;
  for (let j = 0; j < LN; j++) {
    const y = -LR + (j + 0.5) * LPX;
    for (let i = 0; i < LN; i++) {
      const x = -LR + (i + 0.5) * LPX, d = xsdf(x, y), o = (j * LN + i) * 4;
      const cov = clamp01(0.5 - d / LPX), spill = 0.4 * Math.exp(-Math.max(0, d) / 0.03);
      m8[o] = m8[o + 1] = m8[o + 2] = 255; m8[o + 3] = Math.round(255 * (cov + (1 - cov) * spill));
      s8[o] = s8[o + 1] = s8[o + 2] = 255; s8[o + 3] = Math.round(255 * cov);
    }
  }
  const glow = new ImageData(LG, LG), g8 = glow.data;
  for (let j = 0; j < LG; j++) {
    const y = -LRG + (j + 0.5) * LGP;
    for (let i = 0; i < LG; i++) {
      const x = -LRG + (i + 0.5) * LGP, d = xsdf(x, y), dd = Math.max(0, d), o = (j * LG + i) * 4;
      const band = 0.62 * Math.exp(-dd / 0.012), halo = 0.34 * Math.exp(-dd / 0.05), haze = 0.16 * Math.exp(-dd / 0.14);
      const rim = d < 0 ? Math.exp(d / 0.012) : 1, sum = band + halo + haze, t = band / sum;   // t: how much is the bright band
      g8[o] = 204 - 50 * t; g8[o + 1] = 255; g8[o + 2] = 160 - 50 * t;                          // pale brand green, deeper at the edge
      g8[o + 3] = Math.round(255 * Math.min(1, sum) * rim);
    }
  }
  return { mask: canvasOf(mask), solid: canvasOf(solid), glow: canvasOf(glow) };
}
const LIGHT = lightMaps();

// the X's outline as one closed line (marching squares on the shape), starting at the top-left tip, with its length
function outline() {
  const N = 560, h = (2 * MR) / N, S = N + 1, v = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) v[j * S + i] = xsdf(-MR + i * h, -MR + j * h);
  const pt = new Map(), nb = new Map();
  const cross = (id, i0, j0, i1, j1) => {
    if (!pt.has(id)) { const a = v[j0 * S + i0], b = v[j1 * S + i1], t = a / (a - b); pt.set(id, [-MR + (i0 + (i1 - i0) * t) * h, -MR + (j0 + (j1 - j0) * t) * h]); }
    return id;
  };
  const link = (a, b) => { for (const [p, q] of [[a, b], [b, a]]) { if (!nb.has(p)) nb.set(p, []); nb.get(p).push(q); } };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const tl = v[j * S + i] < 0, tr = v[j * S + i + 1] < 0, br = v[(j + 1) * S + i + 1] < 0, bl = v[(j + 1) * S + i] < 0;
      const e = [];
      if (tl !== tr) e.push(cross(`h${i},${j}`, i, j, i + 1, j));
      if (tr !== br) e.push(cross(`v${i + 1},${j}`, i + 1, j, i + 1, j + 1));
      if (br !== bl) e.push(cross(`h${i},${j + 1}`, i, j + 1, i + 1, j + 1));
      if (bl !== tl) e.push(cross(`v${i},${j}`, i, j, i, j + 1));
      if (e.length === 2) link(e[0], e[1]);
      else if (e.length === 4) { link(e[0], e[3]); link(e[1], e[2]); }
    }
  }
  let best = null, bd = Infinity;
  for (const [id, [x, y]] of pt) { const dd = Math.hypot(x + R2, y + R2); if (dd < bd) { bd = dd; best = id; } }
  const loop = [];
  let prev = null, cur = best;
  do { loop.push(pt.get(cur)); const n = nb.get(cur); const next = n[0] === prev ? n[1] : n[0]; prev = cur; cur = next; } while (cur !== best && loop.length < pt.size + 2);
  let len = 0;
  for (let k = 0; k < loop.length; k++) { const a = loop[k], b = loop[(k + 1) % loop.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  return { loop, len };
}
const LINE = outline();

// ---------------------------------------------------------------- the wall: whole 16:9 tiles on one grid over the screen,
// a tile at the centre (LH_17761). The nearest tiles get their own scenes; the far ones repeat them.
const GAP = 0.07, PER_X = 24;                       // gap: share of a tile; tiles across the grown X's height
const sec = $('#hero'), bg = $('#heroBg'), bx = bg.getContext('2d'), cv = $('#heroX'), ctx = cv.getContext('2d');
const glowBox = $('#heroGlow'), gl = glowBox.querySelector('canvas'), gx = gl.getContext('2d');
let gdpr = 1, glowOn = -1;
const brand = $('#lkBrand'), word = $('#lkWord'), sub = $('#lkSub'), tip = $('#heroTip'), hint = $('#heroHint'), cap = $('#heroCap');
const nav = $('.lnav');
let W = 0, H = 0, dpr = 1, p = 0, visible = true, hover = null, LK = null, CW = 0, CH = 0, cells = [], bgKey = '', litKey = '';
const t0 = performance.now();

// the lockup "Ropedia Xperience 2": the wordmark (ropedia_brand.png, 638 x 151: cap height 96, baseline at 117.5) left of
// the X, and "perience 2" right of it in the wordmark's own face (Inter Tight 400) at the same cap height, on one
// baseline, the cap band centred on the X's middle. "Ropedia" keeps a word space from the X; "perience" sits close, being
// the same word.
const BRAND = { ar: 638 / 151, cap: 96 / 151, base: 117.5 / 151 };
const SUB_GAP = 0.035;                               // blade lengths between the X's foot and the slogan
const FACE = document.createElement('canvas').getContext('2d');
let FM = null;   // the face's metrics per em: cap height, baseline in a line-height-1 box, width of "perience 2"
function faceMetrics() {
  FACE.font = '400 100px "Inter Tight"';
  const m = FACE.measureText(word.textContent), cap = FACE.measureText('R').actualBoundingBoxAscent / 100;
  return { cap, base: (100 - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 200 + m.fontBoundingBoxAscent / 100, wEm: m.width / 100 };
}
// how far from the centre a word's inner end must sit for its letters to clear the X. Boxes: [from, to] along the word
// (em, outward from its inner end) and [top, bottom] (cap heights, from the cap band's middle). The X is mirror-symmetric,
// so one side serves both.
function clearOf(fs, cap, boxes) {
  const hit = (d) => boxes.some(([x0, x1, y0, y1]) => {
    for (let x = x0; x <= x1 + 1e-9; x += 0.1) for (let y = y0; y <= y1 + 1e-9; y += 0.25) if (xsdf(d + x * fs, y * cap) < 0.012) return true;
    return false;
  });
  let d = 0.02;
  while (d < 1 && hit(d)) d += 0.003;
  return d;
}
// the X's size at rest and once grown (px per blade length), the words' cap height, and where each word's inner end
// sits: "perience" close to the X (it finishes the word), "Ropedia" a word space away
function lockup() {
  const narrow = W < 700;
  const kRest = Math.min(H * 0.53, W * 0.7) / XH, kGrown = Math.min(H * 0.8, W * (narrow ? 0.9 : 0.8)) / XH;
  let cap = 0.085 * XH, offL = 0, offR = 0;          // cap height, blade lengths
  for (let it = 0; it < 40; it++) {
    const fs = cap / FM.cap;
    offR = clearOf(fs, cap, [[0, 0.6, -0.25, 0.8], [0.6, 1.6, -0.5, 0.5]]) + 0.05 * fs;    // "p" with its descender, then the rest
    offL = clearOf(fs, cap, [[0, 0.55, -0.25, 0.5], [0.55, 1.5, -0.5, 0.5]]) + 0.28 * fs;  // "a", then "di"
    const left = offL + BRAND.ar * (cap / BRAND.cap), right = offR + FM.wEm * fs;
    if (Math.max(left, right) * kGrown < W / 2 - Math.max(18, W * 0.035) || cap < 0.02) break;
    cap *= 0.95;
  }
  // the slogan under the X, its size in blade lengths so it grows with the X: one line where that reads, else two
  sub.style.whiteSpace = 'nowrap'; sub.style.width = ''; sub.style.fontSize = '100px';
  const subOne = sub.offsetWidth / 100;              // its width per px of type, on one line
  const room = (W - 40) / kGrown, below = (H / 2 - 6) / kGrown - R2 - SUB_GAP, most = 34 / kGrown;   // once grown
  let subF = Math.min(0.095, most, room / subOne, below / 1.3), subWrap = 0;
  if (subF * kRest < 13) { subWrap = room; subF = Math.min(0.095, most, (1.7 * room) / subOne, below / 2.6); }   // two lines, with slack for word breaks
  sub.style.whiteSpace = subWrap ? 'normal' : 'nowrap';
  return { kRest, kGrown, cap, offL, offR, narrow, subF, subOne, subWrap };
}
function build() {
  const kTile = Math.min(H * 0.94, W * (LK.narrow ? 0.95 : 0.9)) / XH;   // tiles keep the size they had with the larger X
  CW = (kTile * XH) / PER_X; CH = (CW * 9) / 16;
  const nc = Math.ceil(W / 2 / CW) + 1, nr = Math.ceil(H / 2 / CH) + 1;
  cells = [];
  for (let r = -nr; r <= nr; r++) for (let c = -nc; c <= nc; c++) cells.push({ c, r, d: Math.hypot(c * CW, r * CH) });
  cells.sort((a, b) => a.d - b.d);
  cells[0].centre = true;
  let k = 0;
  for (const cell of cells) if (!cell.centre) Object.assign(cell, REC[k++ % REC.length]);
}
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = cv.clientWidth; H = cv.clientHeight;
  if (!W || !H) return;                              // not laid out yet (a hidden frame): wait for a real size
  for (const c of [cv, bg]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  gdpr = Math.max(1, dpr / 2);                       // the glow is soft, so half resolution will do
  gl.width = Math.round(W * gdpr); gl.height = Math.round(H * gdpr);
  FM = faceMetrics();
  LK = lockup();
  build();
  bgKey = ''; litKey = ''; hover = null; tip.hidden = true;
}
addEventListener('resize', resize);
await document.fonts.load('400 100px "Inter Tight"');
resize();

// scroll: 0-0.2 the X grows over the wall, 0.2-0.32 hold, 0.32-0.94 dive into the crossing tile (the dark lifts first)
function view() {
  const g = smooth(span(p, 0, 0.2)), u = span(p, 0.32, 0.94);
  const zEnd = Math.max(W / (CW * (1 - GAP)), H / (CH * (1 - GAP))) * 1.003;   // the centre tile covers the screen
  const z = Math.pow(zEnd, smooth(u));
  const kx = lerp(LK.kRest, LK.kGrown, g);
  return { g, u, z, kx, k: kx * z, cx: W / 2, cy: H / 2 };
}
function rect(v, cell) {
  const cw = CW * v.z, ch = CH * v.z, w = cw * (1 - GAP), h = ch * (1 - GAP);
  return [v.cx + cell.c * cw - w / 2, v.cy + cell.r * ch - h / 2, w, h];
}
function drawTile(c2, cell, x, y, w, h) {
  if (cell.centre) c2.drawImage(centre, x, y, w, h);
  else if (w > TW * 1.6 && getHi(cell.t)) c2.drawImage(hi.get(cell.t), x, y, w, h);
  else c2.drawImage(atlas, (cell.t % AC) * TW, Math.floor(cell.t / AC) * TH, TW, TH, x, y, w, h);
}

// the tiles that fall inside a box on screen
function tiles(c2, v, x0, y0, x1, y1) {
  for (const cell of cells) {
    const [x, y, w, h] = rect(v, cell);
    if (x > x1 || y > y1 || x + w < x0 || y + h < y0) continue;
    drawTile(c2, cell, x, y, w, h);
  }
}
// the wall layer, dark and grey by CSS until the dive lights it; redrawn only when the camera moves or a sharper picture
// arrives
const DIM = 0.32;
let wallFilter = '';
function drawWall(v, lift) {
  const f = lift < 1 ? `grayscale(${(1 - lift).toFixed(3)}) brightness(${lerp(DIM, 1, lift).toFixed(3)})` : 'none';
  if (f !== wallFilter) { wallFilter = f; bg.style.filter = f; }
  const key = `${W}x${H}:${v.z.toFixed(4)}:${hiVer}`;
  if (key === bgKey) return;
  bgKey = key;
  bx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bx.clearRect(0, 0, W, H);
  tiles(bx, v, 0, 0, W, H);
}

// on load: dark, then the X flashes on, then the green line runs round it from two opposite tips
const lightOn = (intro) => smooth(span(intro, 0.3, 0.5));
const flashOf = (intro) => (intro < 0.3 ? 0 : 0.8 * smooth(span(intro, 0.3, 0.38)) * (1 - outCubic(span(intro, 0.38, 1.1))));
const traceOf = (intro) => outCubic(span(intro, 0.5, 1.7));

function draw(now) {
  if (!cells.length) return;
  const v = view(), intro = (now - t0) / 1000;
  const lift = smooth(span(p, 0.34, 0.5));                // the whole wall lights up as the dive starts
  drawWall(v, lift);
  const key = `${W}x${H}:${v.k.toFixed(3)}:${v.z.toFixed(4)}:${lift.toFixed(3)}:${hiVer}:${hover ? `${hover.c},${hover.r}` : ''}`;
  if (intro > 2 && key === litKey) { words(v, intro); return; }   // nothing on the lit layer has changed
  litKey = key;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const S = LR * v.k, X0 = v.cx - S, Y0 = v.cy - S, L = 2 * S;
  if (lift < 1) {   // the X: the wall in colour through the mask
    ctx.save();
    ctx.beginPath(); ctx.rect(X0, Y0, L, L); ctx.clip();
    tiles(ctx, v, Math.max(0, X0), Math.max(0, Y0), Math.min(W, X0 + L), Math.min(H, Y0 + L));
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(LIGHT.mask, X0, Y0, L, L);
    ctx.restore();
  }
  const on = lightOn(intro);
  // the green light, on its own layer (screen blend, breathing by CSS): drawn with the X, shown once the X is lit
  gx.setTransform(gdpr, 0, 0, gdpr, 0, 0);
  gx.clearRect(0, 0, W, H);
  if (lift < 1) { const G = LRG * v.k; gx.drawImage(LIGHT.glow, v.cx - G, v.cy - G, 2 * G, 2 * G); }
  const go = Math.round(on * (1 - lift) * 1000) / 1000;
  if (go !== glowOn) { glowOn = go; glowBox.style.opacity = String(go); }
  if (on < 1) { ctx.globalAlpha = 1 - on; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
  const fl = flashOf(intro);
  if (fl > 0.003) { ctx.globalAlpha = fl; ctx.drawImage(LIGHT.solid, X0, Y0, L, L); }
  ctx.globalAlpha = 1;

  const lineA = (1 - smooth(span(p, 0.32, 0.42))) * on;   // the green line round the X
  const tr = traceOf(intro);
  if (lineA > 0.01 && tr > 0) {
    ctx.beginPath();
    for (let k = 0; k < LINE.loop.length; k++) { const [x, y] = LINE.loop[k]; const X = v.cx + x * v.k, Y = v.cy + y * v.k; if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
    ctx.closePath();
    const half = (LINE.len * v.k) / 2;
    ctx.setLineDash(tr < 0.999 ? [half * tr, half * (1 - tr)] : []);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(204,255,160,${lineA})`; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);
  }
  if (hover && p < 0.3) {   // the hovered scene, lifted
    const [x, y, w, h] = rect(v, hover), q = 2.2, W2 = w * q, H2 = h * q, X = x + w / 2 - W2 / 2, Y = y + h / 2 - H2 / 2;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 20; ctx.fillStyle = '#000'; ctx.fillRect(X, Y, W2, H2); ctx.restore();
    drawTile(ctx, hover, X, Y, W2, H2);
    ctx.strokeStyle = '#ccffa0'; ctx.lineWidth = 1.5; ctx.strokeRect(X - 1, Y - 1, W2 + 2, H2 + 2);
  }
  words(v, intro);
}

// the lockup from the first frame: Ropedia left of the X, perience right of it, growing with it; the dive grows and fades
// them. Then the slogan, the scroll hint and the closing caption.
function words(v, intro) {
  const capPx = LK.cap * v.kx, fs = capPx / FM.cap, bh = capPx / BRAND.cap, bw = bh * BRAND.ar;
  const yb = v.cy + capPx / 2, z = v.z;               // the shared baseline
  const grow = 1 + 0.9 * smooth(span(p, 0.32, 0.46)), wa = 1 - span(p, 0.34, 0.48);
  brand.style.height = `${bh}px`;
  brand.style.transform = `translate(${v.cx - LK.offL * v.kx * z - bw}px, ${yb - BRAND.base * bh}px) scale(${grow})`;
  brand.style.opacity = wa * clamp01((intro - 0.9) / 0.7);
  word.style.fontSize = `${fs}px`;
  word.style.transform = `translate(${v.cx + LK.offR * v.kx * z}px, ${yb - FM.base * fs}px) scale(${grow})`;
  word.style.opacity = wa * clamp01((intro - 1.05) / 0.7);

  // the slogan under the X from the first frame, sized and placed with it, so it grows with the X and leaves with the words
  const sf = LK.subF * v.kx, sw = LK.subWrap ? LK.subWrap * v.kx : LK.subOne * sf;
  sub.style.fontSize = `${sf}px`;
  if (LK.subWrap) sub.style.width = `${sw}px`;
  sub.style.transform = `translate(${v.cx - sw / 2}px, ${v.cy + (R2 + SUB_GAP) * v.kx * z}px) scale(${grow})`;
  sub.style.opacity = wa * clamp01((intro - 1.2) / 0.7);
  hint.style.opacity = (1 - span(p, 0, 0.04)) * clamp01((intro - 1.8) / 0.6);
  const ce = span(p, 0.92, 0.98);
  cap.style.opacity = ce;
  cap.style.transform = `translateY(${(1 - ce) * 24}px)`;
}

// hover: the lit scene under the cursor until the dive starts
cv.addEventListener('pointermove', (e) => {
  if (p > 0.3) { hover = null; tip.hidden = true; return; }
  const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, v = view();
  const lit = xsdf((x - v.cx) / v.k, (y - v.cy) / v.k) < 0;
  const c = Math.round((x - v.cx) / (CW * v.z)), rr = Math.round((y - v.cy) / (CH * v.z));
  const hit = lit ? cells.find((cell) => cell.c === c && cell.r === rr) : null;
  hover = hit || null;
  if (!hit) { tip.hidden = true; return; }
  tip.hidden = false;
  const key = hit.centre ? 'c' : `${hit.t}`;
  if (tip.dataset.key !== key) {
    tip.dataset.key = key;
    const pic = hit.centre ? 'assets/centre_full.jpg' : `assets/tiles_hi/${String(hit.t).padStart(4, '0')}.webp`;
    const name = hit.centre ? 'Multi-room home' : D.categories[hit.cat];
    const subt = hit.centre ? 'LH_17761 · the scene below' : D.outcomes[hit.qc];
    tip.innerHTML = `<img src="${pic}" alt=""><div class="tt"><b>${name}</b><span>${subt}</span></div>`;
  }
  const tw = 264, th = 200, px = Math.min(innerWidth - tw / 2 - 12, Math.max(tw / 2 + 12, e.clientX));
  const above = e.clientY - th - 22 > 12;
  tip.style.left = `${px}px`;
  tip.style.top = `${above ? e.clientY - 22 : e.clientY + 26}px`;
  tip.classList.toggle('below', !above);
});
cv.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; });

function onScroll() {
  const r = sec.getBoundingClientRect();
  p = clamp01(-r.top / Math.max(1, r.height - innerHeight));
  nav.classList.toggle('away', r.bottom > innerHeight * 0.35);   // no bar over the hero
  if (p > 0.3) { hover = null; tip.hidden = true; }
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(sec);
function loop(now) {
  requestAnimationFrame(loop);
  if (visible) draw(now);
}
requestAnimationFrame(loop);
