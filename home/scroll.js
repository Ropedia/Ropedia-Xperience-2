// Assisted scrolling over the scroll-driven screens (the hero's X and dive, the capture story, then the scene viewer
// framed on the screen). Going down, one small
// scroll plays the current animation to its end on its own and stops at the next hold; the rest of that flick (its
// momentum) is swallowed, so the next step needs a scroll of its own, which acts at once (and hurries a step still playing). Going up is the visitor's own scroll, as far as
// they move, and it stops a step that is playing. Past the last hold the page scrolls as usual. Off with ?assist=0 and
// under prefers-reduced-motion.
import { STORY } from './engine.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
const hero = document.querySelector('#hero'), story = document.querySelector('#story'), viewer = document.querySelector('#viewer');

// the holds, as progress through each section, and how long the step into each one plays (ms)
const HOLDS = [
  [hero, 0.26, 1100],                         // the X grown (its hold is 0.2-0.32)
  [hero, 1, 2400],                            // the dive done: LH_17761 from above, the story's first frame
  [story, STORY.crane[1], 1500],              // the plan framed beside "Scanned once."
  [story, STORY.scan[1] + 0.01, 3400],        // the reconstruction trajectory drawn
  [story, STORY.homie[1] - 0.015, 1300],      // HOMIE Gen 2 on its own
  [story, STORY.trails[1] + 0.01, 3200],      // all eight cards and head paths
  [story, STORY.op[1] + 0.035, 2800],         // down at the table, the operator in, labels up
  [viewer, 0, 1900],                          // the scene viewer filling the screen (it is one screen tall)
];
const off = new URLSearchParams(location.search).get('assist') === '0' || matchMedia('(prefers-reduced-motion: reduce)').matches;

const at = (el, u) => el.getBoundingClientRect().top + scrollY + u * (el.offsetHeight - innerHeight);
function next() {   // the first hold below where the page is, with where the step to it starts from
  const y = scrollY;
  let prev = 0;
  for (const [el, u, dur] of HOLDS) {
    const h = at(el, u);
    if (h > y + 4) return { y: h, dur: dur * clamp01((h - y) / Math.max(1, h - prev)) };
    prev = h;
  }
  return null;
}

let tw = null;
function play(n) {
  tw = { y0: scrollY, y1: n.y, t0: performance.now(), dur: Math.max(450, n.dur), hurried: false };
  requestAnimationFrame(step);
}
function step(now) {
  if (!tw) return;
  const u = clamp01((now - tw.t0) / tw.dur);
  scrollTo({ top: tw.y0 + (tw.y1 - tw.y0) * ease(Math.pow(u, 0.7)), behavior: 'instant' });   // off the mark at once, soft landing
  if (u < 1) requestAnimationFrame(step);
  else tw = null;
}
const stop = () => { tw = null; };
// a new scroll while a step plays: the rest of it runs in well under half the time (once per step)
function hurry(now) {
  if (tw.hurried) return;
  const u = clamp01((now - tw.t0) / tw.dur), left = tw.dur * (1 - u);
  if (u > 0.999 || left < 400) return;
  tw.hurried = true;
  tw.dur = Math.max(400, left * 0.4) / (1 - u);
  tw.t0 = now - u * tw.dur;
}

// wheel and trackpad: down plays a step. The flick that started a step goes on sending its momentum for a second or
// more; that tail is swallowed, but it is told apart from a new scroll by its shape rather than by waiting for
// silence: momentum only decays and never pauses, so a delta that grows, or one after a pause, is the visitor again
// and acts at once.
let lastT = 0, lastD = 0, coasting = false;
addEventListener('wheel', (e) => {
  if (off || e.ctrlKey) return;
  if (e.deltaY < 0) { stop(); coasting = false; lastD = 0; return; }
  if (e.deltaY === 0) return;
  const now = performance.now(), at = e.timeStamp, d = Math.abs(e.deltaY) * (e.deltaMode === 1 ? 40 : 1);   // (the event's own time: a busy frame delivers late)
  const fresh = at - lastT > 90 || d > lastD * 1.4 + 3 || e.deltaMode !== 0;
  lastT = at; lastD = d;
  if (tw) { e.preventDefault(); if (fresh && now - tw.t0 > 350) hurry(now); return; }
  const n = next();
  if (!n) { coasting = false; return; }
  e.preventDefault();
  if (coasting && !fresh) return;
  coasting = true;
  play(n);
}, { passive: false });

// touch: a swipe up plays a step (one per swipe); a swipe down is the visitor's own
let ty = null, used = false;
addEventListener('touchstart', (e) => { ty = e.touches[0].clientY; used = false; }, { passive: true });
addEventListener('touchmove', (e) => {
  if (off || ty == null) return;
  const dy = ty - e.touches[0].clientY;
  if (dy < -6) { stop(); return; }
  if (dy <= 0) return;
  if (tw) { e.preventDefault(); return; }
  const n = next();
  if (!n) return;
  e.preventDefault();
  if (!used && dy > 14) { used = true; play(n); }
}, { passive: false });
addEventListener('touchend', () => { ty = null; }, { passive: true });

// keys: down, page down and space play a step; up keys scroll as usual
addEventListener('keydown', (e) => {
  if (off || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target, typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName));
  if (['ArrowUp', 'PageUp', 'Home'].includes(e.key) || (e.key === ' ' && e.shiftKey)) { stop(); return; }
  if (!['ArrowDown', 'PageDown', ' '].includes(e.key) || (e.key === ' ' && typing)) return;
  const n = tw ? null : next();
  if (tw) { e.preventDefault(); return; }
  if (!n) return;
  e.preventDefault();
  play(n);
});
// a drag of the scroll bar, or a jump from a link, stops a step that is playing
addEventListener('mousedown', (e) => { if (e.clientX > document.documentElement.clientWidth - 2) stop(); });
addEventListener('hashchange', stop);

// ?fps=1: a small meter (frames per second, the longest frame of the last second, the 3D canvas's px per CSS px)
if (new URLSearchParams(location.search).get('fps') === '1') {
  const m = document.createElement('div');
  m.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:999;padding:6px 9px;border-radius:8px;background:rgba(0,0,0,.75);color:#ccffa0;font:12px/1.3 ui-monospace,monospace;pointer-events:none;white-space:pre';
  document.body.appendChild(m);
  let last = performance.now(), n = 0, worst = 0, t0 = last;
  const f = (now) => {
    requestAnimationFrame(f);
    worst = Math.max(worst, now - last); last = now; n += 1;
    if (now - t0 < 1000) return;
    const R = window.__story?.().E?.renderer;
    m.textContent = `${Math.round(n * 1000 / (now - t0))} fps  worst ${Math.round(worst)} ms\n3D ${R ? `${R.getPixelRatio()}x ${R.domElement.width}x${R.domElement.height}` : '-'}  dpr ${devicePixelRatio}`;
    n = 0; worst = 0; t0 = now;
  };
  requestAnimationFrame(f);
}
