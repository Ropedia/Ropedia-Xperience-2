// Ropedia Xperience · site draft.
// The LIVE panels are the launch video's own pages (video/mosaic, video/flythrough, video/metrics) in iframes. They are
// deterministic and time-driven: the flythrough and mosaic pages expose dev.setTime(t), which this page calls every
// frame (a clock for loops and holds, the scroll position for the pipeline). The metrics pages play on their own clock.
// An iframe exists only while its panel is on screen, so at most two or three scenes are on the GPU at once.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const D = window.DRAFT;
  const FLY = '../../video/flythrough/index.html';

  // ---------------------------------------------------------------- draft notes on / off
  const KEY = 'xp-draft-notes';
  const notesBtn = $('#notesToggle');
  const setNotes = (on) => {
    document.documentElement.classList.toggle('notes-off', !on);
    notesBtn.setAttribute('aria-pressed', String(on));
    notesBtn.firstChild.textContent = on ? '隐藏标注 ' : '显示标注 ';
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  let notesOn = true;
  try { notesOn = localStorage.getItem(KEY) !== '0'; } catch { /* storage unavailable */ }
  setNotes(notesOn);
  const flipNotes = () => setNotes(document.documentElement.classList.contains('notes-off'));
  notesBtn.addEventListener('click', flipNotes);
  addEventListener('keydown', (e) => {
    if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) flipNotes();
  });

  // ---------------------------------------------------------------- live embeds
  const CSS = {
    top: '#logo, #chapter { display: none !important; }',
    nohud: '#hud, #leaders, #vignette { display: none !important; }',
    count: '#count { display: none !important; }',
    endsub: '#endsub { display: none !important; }',
  };
  const waitFor = (fn, ms) => new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      let v = null;
      try { v = fn(); } catch { /* page still loading */ }
      if (v) resolve(v);
      else if (performance.now() - t0 > ms) resolve(null);
      else setTimeout(tick, 150);
    };
    tick();
  });

  class Embed {
    constructor(el) {
      el._embed = this;
      this.el = el;
      this.src = el.dataset.src || null;
      this.drive = el.dataset.drive ? JSON.parse(el.dataset.drive) : null;
      this.css = (el.dataset.css || '').split(/\s+/).filter(Boolean).map((k) => CSS[k] || '').join('\n');
      this.badge = $('.live-badge', el);
      this.path = el.dataset.path || '';
      this.frame = null;
      this.win = null;
      this.raf = 0;
      this.visible = false;
      this.onlive = null;
      this.state('POSTER');
    }
    state(s) {
      if (this.badge) this.badge.textContent = `${s} · ${this.path}`;
      this.el.dataset.state = s.toLowerCase();
    }
    mount() {
      if (this.frame || !this.src) return;
      const f = document.createElement('iframe');
      f.src = this.src;
      f.title = this.path;
      f.tabIndex = -1;
      f.setAttribute('aria-hidden', 'true');
      f.addEventListener('load', () => this.loaded(f), { once: true });
      this.el.querySelector('.poster').after(f);
      this.frame = f;
      this.state('LOADING');
    }
    unmount() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.frame) { this.frame.src = 'about:blank'; this.frame.remove(); }
      this.frame = null;
      this.win = null;
      this.el.classList.remove('live');
      this.state('POSTER');
    }
    setSrc(src, drive = null) {
      this.src = src;
      this.drive = drive;
      this.unmount();
      if (this.visible) this.mount();
    }
    async loaded(f) {
      if (f !== this.frame) return;
      let w;
      try {
        w = f.contentWindow;
        const d = f.contentDocument;
        if (this.css && d && d.head) { const s = d.createElement('style'); s.textContent = this.css; d.head.appendChild(s); }
      } catch { this.state('BLOCKED'); return; }
      const api = await waitFor(() => w.director || w.mosaic || w.metrics, 120000);
      if (f !== this.frame) return;
      if (!api) { this.state('FAILED'); return; }
      try { await api.ready; } catch { /* draw what loaded */ }
      if (f !== this.frame) return;
      this.win = w;
      this.el.classList.add('live');
      this.state('LIVE');
      if (this.drive) this.run();
      if (this.onlive) this.onlive(w);
    }
    run() {   // own clock: loop a window of the shot, or play once and hold its last frame
      const { from = 0, to, loop } = this.drive;
      let t = from, last = performance.now();
      const step = (now) => {
        if (!this.win) return;
        t += Math.min(0.1, (now - last) / 1000);
        last = now;
        if (t > to) t = loop ? from : to;
        this.setTime(t);
        this.raf = requestAnimationFrame(step);
      };
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(step);
    }
    setTime(t) {
      try { if (this.win && this.win.dev) this.win.dev.setTime(t); } catch { /* page navigated away */ }
    }
  }

  const embeds = $$('.embed').map((el) => new Embed(el));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const em = e.target._embed;
      em.visible = e.isIntersecting;
      if (e.isIntersecting) em.mount(); else em.unmount();
    }
  }, { rootMargin: '60px 0px' });
  embeds.forEach((em) => io.observe(em.el));

  $$('[data-replay]').forEach((b) => b.addEventListener('click', () => {
    const em = document.getElementById(b.dataset.replay)._embed;
    if (em.win) em.run();
  }));

  // ---------------------------------------------------------------- 02 pipeline: scroll drives act 2
  const STEPS = [
    { shot: 'act2_tree', t0: 0.2, t1: 8.4, poster: 'assets/pipe_capture_scan.jpg', short: 'Scan',
      n: 'STEP 1 · KOSMO', h: 'Scan the scene once',
      p: 'KOSMO, a handheld LiDAR scanner, scans the static scene once. The scan yields posed images, a triangle mesh and a 3D Gaussian splatting model in one metric scene frame.' },
    { shot: 'act2_tree', t0: 8.4, t1: 17.1, poster: 'assets/pipe_capture_tasks.jpg', short: 'Record',
      n: 'STEP 2 · HOMIE', h: 'Record every task in it',
      p: 'The operator then wears HOMIE, a head-mounted recorder with four global-shutter fisheye cameras, and records each assigned task. One scan provides the environmental context for many recordings.' },
    { shot: 'act2_register', t0: 0, t1: 7.9, poster: 'assets/pipe_register.jpg', short: 'Register',
      n: 'STEP 3 · REGISTRATION', h: 'Register each recording to its scan',
      p: 'Each recording starts in its own SLAM frame. Its device trajectory and estimated hand and body motion are registered to the scene frame; held-out frames, IMU gravity and a depth check against the mesh assign PASS, WEAK or FAIL.' },
    { shot: 'act2_layers', t0: 0, t1: 9.9, poster: 'assets/pipe_layers.jpg', short: 'Layers',
      n: 'STEP 4 · ONE METRIC FRAME', h: 'Every layer in one scene',
      p: 'Video, device trajectory, MANO hands from EgoXperience, SMPL-H body motion from EgoAllo and hierarchical captions from Gemini 3.6 Flash, all in the scene’s metric frame.' },
  ];
  const scrolly = $('#scrolly');
  const stage = $('#stage')._embed;
  const capSteps = $('#capSteps');
  STEPS.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<b>${i + 1}</b>${s.short}`;
    b.addEventListener('click', () => {
      const span = scrolly.offsetHeight - innerHeight;
      scrollTo({ top: scrolly.getBoundingClientRect().top + scrollY + span * (i + 0.04) / STEPS.length, behavior: 'smooth' });
    });
    capSteps.appendChild(b);
  });
  let cur = -1, want = 0, queued = false;
  const layoutPipe = () => {
    queued = false;
    const r = scrolly.getBoundingClientRect();
    const span = Math.max(1, r.height - innerHeight);
    const P = Math.min(0.9999, Math.max(0, -r.top / span));
    const i = Math.floor(P * STEPS.length), p = P * STEPS.length - i, s = STEPS[i];
    if (i !== cur) {
      cur = i;
      $('#capN').textContent = s.n;
      $('#capH').textContent = s.h;
      $('#capP').textContent = s.p;
      $$('button', capSteps).forEach((b, k) => b.classList.toggle('on', k === i));
      $('#stagePoster').src = s.poster;
      stage.path = `video/flythrough · ${s.shot}`;
      const src = `${FLY}?shot=${s.shot}&lite=1`;
      if (stage.src !== src) stage.setSrc(src);
    }
    want = s.t0 + p * (s.t1 - s.t0);
    stage.setTime(want);
    $('#capBar').style.width = `${(P * 100).toFixed(2)}%`;
  };
  stage.onlive = () => stage.setTime(want);
  const queuePipe = () => { if (!queued) { queued = true; requestAnimationFrame(layoutPipe); } };
  addEventListener('scroll', queuePipe, { passive: true });
  addEventListener('resize', queuePipe);
  layoutPipe();

  // ---------------------------------------------------------------- Explore: four scenes
  const PALETTE = ['#CCFFA0', '#9CC3FF', '#FFB36B', '#B4A4FF', '#7FE7FF', '#FF8FD0', '#F4F4F0'];
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tabs = $('#sceneTabs');
  const viewer = $('#vw3d')._embed;
  let scene = null;

  D.explore.forEach((s, i) => {
    const total = s.takes.reduce((a, t) => a + t.dur, 0);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scene-tab';
    b.setAttribute('role', 'tab');
    b.innerHTML = `<img src="${s.thumb}" alt=""><div><b>${esc(s.name)}</b><span>${esc(s.type)}</span>`
      + `<span>${s.takes.length} recording${s.takes.length > 1 ? 's' : ''} · ${total >= 600 ? Math.round(total / 60) + ' min' : total + ' s'}</span></div>`;
    b.addEventListener('click', () => selectScene(i));
    tabs.appendChild(b);
  });

  const setCaps = (s, f, exact) => {
    const blk = s.blocks.find((x) => x.s <= f && f <= x.e);
    const act = s.actions.find((x) => x.s <= f && f <= x.e);
    const rows = [
      ['TASK', s.mainTask],
      ['SUB-TASK', blk ? blk.label : '—'],
      ['ACTION', act ? (exact && s.actionText ? `${act.label} — ${s.actionText}` : act.label) : '—'],
      ['NOW', exact ? s.interaction : '—'],
      ['HANDS', exact ? `L ${s.hands.left} · R ${s.hands.right}` : '—'],
      ['OBJECTS', exact ? s.objects.join(', ') : '—'],
    ];
    $('#caps').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd${v === '—' ? ' class="dim"' : ''}>${esc(v)}</dd>`).join('');
  };
  const setHead = (s, f) => {
    $('#tlHead').style.left = `${(100 * f / s.frames).toFixed(3)}%`;
    $('#tlTime').innerHTML = `<b>${fmt(f / s.fps)}</b> / ${fmt(s.frames / s.fps)}`;
  };

  function selectScene(i) {
    const s = D.explore[i];
    scene = s;
    $$('.scene-tab', tabs).forEach((b, k) => { b.classList.toggle('on', k === i); b.setAttribute('aria-selected', String(k === i)); });
    $('#vwPoster').src = s.view;
    viewer.path = `video/flythrough · ${s.shot.replace(/&/g, ' ')}`;
    viewer.setSrc(`${FLY}?${s.shot}&lite=1`, { from: 0, to: s.shotLen - 0.05, loop: true });
    $('#egoImg').src = s.ego;
    $('#takeCount').textContent = s.takes.length;
    $('#takeList').innerHTML = s.takes.map((t) => `<li class="${t.id === s.current ? 'on' : ''}"><span>${esc(t.task)}</span><span class="d">${fmt(t.dur)}</span></li>`).join('');
    $('#tlBlocks').innerHTML = s.blocks.map((b, k) => {
      const l = 100 * b.s / s.frames, w = 100 * (b.e - b.s + 1) / s.frames;
      return `<div class="tl-b" style="left:${l.toFixed(3)}%;width:${w.toFixed(3)}%;--c:${PALETTE[k % PALETTE.length]}" title="${esc(b.label)}">${esc(b.label)}</div>`;
    }).join('');
    $('#tlActs').innerHTML = s.actions.map((a) => {
      const l = 100 * a.s / s.frames, w = Math.max(0.3, 100 * (a.e - a.s) / s.frames);
      return `<i style="left:${l.toFixed(3)}%;width:${w.toFixed(3)}%" title="${esc(a.label)}"></i>`;
    }).join('');
    setCaps(s, s.frame, true);
    setHead(s, s.frame);
  }

  $('#tlTrack').addEventListener('click', (e) => {
    if (!scene) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (scene.frames - 1));
    setHead(scene, f);
    setCaps(scene, f, Math.abs(f - scene.frame) < 30);
  });
  $$('.vw-modes button').forEach((b) => b.addEventListener('click', () => {
    $$('.vw-modes button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $$('.vw-layers button:not(.vw-full)').forEach((b) => b.addEventListener('click', () => b.classList.toggle('on')));
  $('#vwFull').addEventListener('click', () => {
    const v = $('#viewer');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (v.requestFullscreen) v.requestFullscreen();
  });
  selectScene(0);

  $('#moreStrip').innerHTML = D.more.map((m) => `<figure class="more-card"><img src="${m.img}" alt="${esc(m.type)}" loading="lazy"><span>${esc(m.type)}</span></figure>`).join('');

  // ---------------------------------------------------------------- benchmark tabs
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    $$('.tab-panel').forEach((p) => p.classList.toggle('on', p.id === b.dataset.tab));
  }));
  $$('.ctl').forEach((g) => $$('button', g).forEach((b) => b.addEventListener('click', () => {
    $$('button', g).forEach((x) => x.classList.toggle('on', x === b));
  })));
  $$('.filters button').forEach((b) => b.addEventListener('click', () => {
    $$('.filters button').forEach((x) => x.classList.toggle('on', x === b));
  }));

  // ---------------------------------------------------------------- Real-to-Sim seam
  const seam = $('#seam');
  let drag = false;
  const setSeam = (cx) => {
    const r = seam.getBoundingClientRect();
    seam.style.setProperty('--x', `${Math.min(98, Math.max(2, (cx - r.left) / r.width * 100)).toFixed(2)}%`);
  };
  seam.tabIndex = 0;
  seam.setAttribute('role', 'slider');
  seam.setAttribute('aria-label', 'Real and simulator split');
  seam.addEventListener('pointerdown', (e) => { drag = true; seam.setPointerCapture(e.pointerId); setSeam(e.clientX); });
  seam.addEventListener('pointermove', (e) => { if (drag) setSeam(e.clientX); });
  seam.addEventListener('pointerup', () => { drag = false; });
  seam.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const x = parseFloat(getComputedStyle(seam).getPropertyValue('--x')) + (e.key === 'ArrowLeft' ? -4 : 4);
    seam.style.setProperty('--x', `${Math.min(98, Math.max(2, x))}%`);
    e.preventDefault();
  });

  // ---------------------------------------------------------------- film
  const film = $('#film'), video = $('#filmVideo');
  $$('[data-film]').forEach((b) => b.addEventListener('click', () => { film.showModal(); video.play().catch(() => {}); }));
  $('.film-close').addEventListener('click', () => film.close());
  film.addEventListener('close', () => video.pause());

  // ---------------------------------------------------------------- nav: current section
  const links = $$('.nav-links a');
  const secIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  ['overview', 'pipeline', 'explore', 'data', 'applications', 'release'].forEach((id) => secIO.observe(document.getElementById(id)));
})();
