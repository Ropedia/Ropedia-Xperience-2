// A recording's captions and HOMIE Gen 2 sensors at one frame, for the story's right column and the scene viewer.
// Captions come at the three temporal scales of the paper (the recording's main task; the sub-task and action around
// this frame, with their interval on the recording's timeline; this frame's hand-object interaction and hand states).
// The sensors are the raw IMU (gyro, accelerometer, ~200 Hz) and the four microphones' envelope in the window
// (tools/export_sensors.py), the part already played bright.
const XYZ = ['#FF6B9A', '#CCFFA0', '#7AC4D8'];
const set = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };
const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

// what the captions say at frame f
export function captionsAt(cap, f) {
  const seg = cap.segments.find((s) => s.s <= f && f <= s.e), act = cap.actions.find((a) => a.s <= f && f <= a.e);
  let it = null; for (const x of cap.interactions) { if (x.f <= f) it = x; else break; }
  let hd = null; for (const x of cap.hands) { if (x.f <= f) hd = x; else break; }
  return { seg, act, it, hd };
}
export const handText = (h) => {
  if (!h || !h.visible) return 'out of view';
  const g = h.grasp ?? (h.holding ? 'holding' : 'free');
  return h.object ? `${g} ${h.object}` : g.replace(/ (for|to|toward|towards)$/, '');   // 'reaching for' alone reads 'reaching'
};

// el: task, act (sub-task · action on one line) or sub + act, now, hands (both on one line) or left + right, and the
// timeline marks taskHead, actSpan, actHead
export function drawCaptions(el, f, rec) {
  const cap = rec.caption, n = rec.meta.frames, { seg, act, it, hd } = captionsAt(cap, f);
  set(el.task, cap.main_task);
  if (el.sub) { set(el.sub, seg?.sub_task ?? ''); set(el.act, act?.label ?? ''); }
  else set(el.act, [seg?.sub_task, act?.label].filter(Boolean).join(' · '));
  set(el.now, cap1(it?.text ?? ''));
  if (el.hands) set(el.hands, hd ? `L ${handText(hd.left)} · R ${handText(hd.right)}` : '');
  if (el.left) { set(el.left, hd ? handText(hd.left) : ''); set(el.right, hd ? handText(hd.right) : ''); }
  if (el.taskHead) el.taskHead.style.left = `${(100 * f) / n}%`;
  const sp = act ?? seg;
  if (el.actSpan) { el.actSpan.style.left = `${(100 * (sp?.s ?? f)) / n}%`; el.actSpan.style.width = `${Math.max(0.8, (100 * ((sp?.e ?? f) - (sp?.s ?? f))) / n)}%`; }
  if (el.actHead) el.actHead.style.left = `${(100 * f) / n}%`;
  return { seg, act, it, hd };
}

const sensors = new Map();   // recording base → its traces, prepared for drawing
function sensorsOf(rec) {
  if (!sensors.has(rec.base)) {
    sensors.set(rec.base, null);
    fetch(`${rec.base}sensors.json`).then((r) => r.json()).then((d) => {
      const n = d.imu.length, x = new Float32Array(n), g = [0, 1, 2].map(() => new Float32Array(n)), a = [0, 1, 2].map(() => new Float32Array(n));
      d.imu.forEach((r, i) => { x[i] = r[0]; for (let k = 0; k < 3; k++) { g[k][i] = r[1 + k]; a[k][i] = r[4 + k]; } });
      const ext = (arr) => { let lo = Infinity, hi = -Infinity; for (const v of arr) for (const q of v) { lo = Math.min(lo, q); hi = Math.max(hi, q); } return [lo, hi]; };
      const [g0, g1] = ext(g), gm = Math.max(0.3, Math.abs(g0), Math.abs(g1)) * 1.08, [a0, a1] = ext(a), am = (a1 - a0) * 0.06 + 0.2;
      sensors.set(rec.base, { ...d, n, x, g, a, gr: [-gm, gm], ar: [a0 - am, a1 + am], len: d.f1 - d.f0 });
    }).catch(() => {});
  }
  return sensors.get(rec.base);
}
function trace(cv, S, series, [lo, hi], k) {
  const c = cv.getContext('2d'), w = cv.width, h = cv.height, X = (fp) => (fp / S.len) * w, Y = (v) => h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
  c.clearRect(0, 0, w, h);
  c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, Y(0)); c.lineTo(w, Y(0)); c.stroke();
  const cut = X(k);
  series.forEach((v, s) => {
    for (const [past, x0, x1] of [[false, cut, w], [true, 0, cut]]) {
      c.save(); c.beginPath(); c.rect(x0, 0, x1 - x0, h); c.clip();
      c.strokeStyle = XYZ[s]; c.globalAlpha = past ? 1 : 0.38; c.lineWidth = past ? 3.4 : 2.4; c.lineJoin = 'round'; c.beginPath();
      for (let i = 0; i < S.n; i++) { const px = X(S.x[i]), py = Y(v[i]); i ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.stroke(); c.restore();
    }
  });
  c.globalAlpha = 1; c.fillStyle = '#f5f5f7'; c.fillRect(cut - 1, 0, 2, h);
}
// el: rate, gyro, acc, audio (canvases), gv, av, audV (readouts)
export function drawSensors(el, f, rec) {
  const S = sensorsOf(rec);
  if (!S) return;
  const k = f - S.f0;
  set(el.rate, `${Math.round(S.imu_rate_hz)} Hz`);
  trace(el.gyro, S, S.g, S.gr, k);
  trace(el.acc, S, S.a, S.ar, k);
  let i = 0; while (i < S.n - 1 && S.x[i] < k) i++;
  set(el.gv, `|ω| ${Math.hypot(S.g[0][i], S.g[1][i], S.g[2][i]).toFixed(2)}`);
  set(el.av, `|a| ${Math.hypot(S.a[0][i], S.a[1][i], S.a[2][i]).toFixed(2)}`);
  // the four microphones, mirrored bars, one row each
  const c = el.audio.getContext('2d'), w = el.audio.width, h = el.audio.height, rows = S.audio_channels, rh = h / rows, m = S.audio.length, cut = (k / S.len) * w;
  c.clearRect(0, 0, w, h);
  for (let j = 0; j < m; j++) {
    const x = (j / m) * w, past = x <= cut;
    c.fillStyle = past ? 'rgba(204,255,160,0.9)' : 'rgba(245,245,247,0.2)';
    for (let r = 0; r < rows; r++) { const v = Math.min(1, S.audio[j][r]) * (rh / 2 - 1); c.fillRect(x, r * rh + rh / 2 - v, Math.max(1, w / m), 2 * v + 0.5); }
  }
  c.fillStyle = '#f5f5f7'; c.fillRect(cut - 1, 0, 2, h);
  const lvl = S.audio[Math.min(m - 1, Math.max(0, Math.round(k * S.audio_per_frame)))];
  set(el.audV, lvl ? lvl.map((v) => '▁▂▃▄▅▆▇█'[Math.min(7, Math.floor(v * 7.99))]).join('') : '');
}
