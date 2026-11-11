// One WebGL renderer for every 3D slot on the homepage. It holds the LH_17761 scan (Spark 3DGS), recording 7659f6d6's
// dining-table window (SMPL-H mesh, skeleton, MANO hands snapped to the SMPL-H wrists, head-camera frustum with its
// recorded frames, head trail), the other recordings' head paths, KOSMO's scan path and the two retargeted robots.
// Drawing code ported from video/flythrough/director.js and the mocap viewer; the canvas moves to whichever slot is on
// screen: 'story' (scroll-driven camera), 'viewer' (orbit + layer presets) or 'retarget' (orbit + Human / Robot A / B).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { SplatMesh, SparkRenderer, SplatEdit, SplatEditSdf } from './vendor/spark.module.js';

const FPS = 30;
const COL = { lime: 0xccffa0, hand: 0xff9f43, past: 0xff6b9a, future: 0x8a929e, body: 0x9cc3ff, bone: 0xf4f4f0 };
const TRAIL_COLS = [0xccffa0, 0x9cc3ff, 0xffb36b, 0xb4a4ff, 0x7fe7ff, 0xff8fd0, 0xf4f4f0, 0xffe45c];
const MANO_BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20]];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (u) => u * u * (3 - 2 * u);
const lerp = (a, b, u) => a + (b - a) * u;
const pad5 = (n) => String(n).padStart(5, '0');
const V3 = (a) => new THREE.Vector3(...a);

async function fetchBytes(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const total = Number(r.headers.get('Content-Length')) || 0;
  if (!onProgress || !r.body) return new Uint8Array(await r.arrayBuffer());
  const reader = r.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onProgress(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
const f32 = async (url, p) => new Float32Array((await fetchBytes(url, p)).buffer);
const u32 = async (url) => new Uint32Array((await fetchBytes(url)).buffer);
const json = (url) => fetch(url).then((r) => r.json());

// camera presets, view frame (gravity up = +Y, floor at y = -1.466); the dining-table vantages are the film's
// clearance-checked ones (shots/lh17761.js, retarget_lh17761.js)
const P = {
  plan: { pos: [3.5, 8.6, 2.9], look: [3.5, -1.47, 0.85], fov: 40 },
  above: { pos: [1.7, 3.4, -0.1], look: [2.2, -1.0, 0.25], fov: 44 },
  table: { pos: [0.75, 0.25, -0.95], look: [2.0, -0.65, 0.2], fov: 46 },
  scene: { pos: [0.58, 0.45, -0.95], look: [2.0, -0.6, 0.2], fov: 52 },
  hands: { pos: [0.67, 0.38, -0.76], look: [2.0, -0.63, 0.22], fov: 32 },
  head: { pos: [0.68, 0.26, -0.85], look: [2.0, -0.65, 0.2], fov: 40 },
  robot: { pos: [0.58, 0.45, -0.95], look: [2.0, -0.6, 0.2], fov: 46 },
};

export class Engine {
  constructor(base) {
    this.base = base;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl';
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.spark = new SparkRenderer({ renderer: r });
    this.scene.add(this.spark);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2e33, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(2, 6, 3); this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.05, 300);
    this.world = new THREE.Group(); this.world.matrixAutoUpdate = false; this.scene.add(this.world);
    this.cut = new SplatEdit({ rgbaBlendMode: 'multiply', softEdge: 0.05 });
    this.cutPlane = new SplatEditSdf({ type: 'plane', opacity: 0 });
    this.cutPlane.rotation.x = Math.PI / 2;                    // keeps splats below the plane
    this.cut.add(this.cutPlane); this.scene.add(this.cut);
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, rotateSpeed: 0.55, zoomSpeed: 0.6, enabled: false });
    this.controls.addEventListener('start', () => { this.tween = null; this.userMoved = true; });
    this.lines = [];                                             // fat lines whose resolution follows the canvas
    this.slot = null; this.mode = null; this.story = 0; this.t = 0; this.rate = 0.6; this.last = performance.now();
    this.focusName = 'body'; this.emb = 'human'; this.tween = null; this.onFrame = null;
    this.ready = this.load();
    this.raf = 0;
  }

  // ---------------------------------------------------------------- loading
  async load() {
    const B = this.base;
    this.meta = await json(`${B}scene.json`);
    const R = this.meta.view_R;
    this.world.matrix.set(R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, 0, 0, 0, 1);
    this.world.updateMatrixWorld(true);
    this.floorY = this.meta.floor_y;
    const hero = this.meta.hero, HB = `${B}${hero}/`;
    const [bytes, faces, take, body, cam, hands, mesh, mj] = await Promise.all([
      fetchBytes(`${B}scene_lite.spz`, (got, total) => this.progress?.(got / Math.max(1, total))),
      u32(`${B}faces.u32`), json(`${HB}take.json`), f32(`${HB}body.f32`), f32(`${HB}cam.f32`), f32(`${HB}hands.f32`),
      f32(`${HB}mesh.f32`), json(`${HB}mesh.json`)]);
    this.splat = new SplatMesh({ fileBytes: bytes, fileName: 'scene.spz' });
    await this.splat.initialized;
    this.world.add(this.splat);
    this.rec = new Recording(this, HB, take, body, cam, hands, mesh, mj, faces);
    // the other recordings' head paths and KOSMO's scan path, drawn in by `reveal`
    const others = this.meta.takes;
    const cams = await Promise.all(others.map((t) => f32(`${B}${t.id}/cam.f32`)));
    this.trails = others.map((t, k) => {
      const c = cams[k], pts = [];
      for (let i = 0; i < c.length / 7; i += 3) pts.push(c[7 * i], c[7 * i + 1], c[7 * i + 2]);
      const l = this.fatPath(pts, TRAIL_COLS[k % TRAIL_COLS.length], 2.2, 1);
      l.userData.n = pts.length / 3 - 1; this.world.add(l);
      return l;
    });
    const sp = this.meta.scan.flat();
    this.scanPath = this.fatPath(sp, COL.lime, 1.6, 0.9); this.scanPath.userData.n = sp.length / 3 - 1;
    this.world.add(this.scanPath);
    this.setCut(30);
  }
  async loadRobots() {
    if (this.robots) return this.robots;
    const HB = `${this.base}${this.meta.hero}/`;
    this.robots = Promise.all([new Robot(this).load(HB, 'robot'), new Robot(this).load(HB, 'robot_b')]);
    const [a, b] = await this.robots;
    this.robotA = a; this.robotB = b;
    return this.robots;
  }

  // ---------------------------------------------------------------- helpers
  fatPath(points, color, width, opacity) {
    const g = new LineGeometry(); g.setPositions(points);
    const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, worldUnits: false, depthWrite: false });
    const l = new Line2(g, m); l.computeLineDistances(); l.frustumCulled = false; l.renderOrder = 800;
    this.lines.push(m);
    return l;
  }
  fatLines(n, color, width, opacity) {
    const g = new LineSegmentsGeometry(); g.setPositions(new Float32Array(n * 6));
    const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, worldUnits: false, depthTest: false });
    const l = new LineSegments2(g, m); l.frustumCulled = false; l.renderOrder = 900;
    this.lines.push(m);
    return l;
  }
  setCut(heightAboveFloor) { this.cutPlane.position.set(0, this.floorY + heightAboveFloor, 0); }
  reveal(line, u, opacity) {   // draw the first u of a path
    line.visible = u > 0.001 && opacity > 0.01;
    line.geometry.instanceCount = Math.max(1, Math.round(u * line.userData.n));
    line.material.opacity = opacity;
  }

  // ---------------------------------------------------------------- slots
  attach(slot) {
    if (this.slot === slot) return;
    this.slot = slot;
    if (!slot) { cancelAnimationFrame(this.raf); this.raf = 0; return; }
    slot.querySelector('.gl-host').appendChild(this.canvas);
    this.mode = slot.dataset.mode;
    this.controls.enabled = this.mode !== 'story';
    this.resize();
    if (this.mode === 'viewer') this.focus(this.focusName, true);
    if (this.mode === 'retarget') { this.loadRobots(); this.setEmbodiment(this.emb, true); }
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.tick(t)); }
  }
  resize() {
    if (!this.slot) return;
    const host = this.slot.querySelector('.gl-host');
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.lines.forEach((m) => m.resolution.set(w, h));
  }
  // presets of the 'viewer' slot: camera + which layers are lit
  focus(name, jump = false) {
    this.focusName = name;
    const p = { scene: P.scene, body: P.table, hands: P.hands, head: P.head, trail: P.scene, captions: P.table, ego: P.head }[name] ?? P.table;
    this.goTo(p, jump);
    this.controls.enabled = name !== 'ego';
  }
  setEmbodiment(e, jump = false) {
    this.emb = e;
    this.goTo(P.robot, jump);
  }
  goTo(p, jump) {
    const pos = V3(p.pos), look = V3(p.look);
    if (jump || !this.slot) { this.camera.position.copy(pos); this.controls.target.copy(look); this.camera.fov = p.fov; this.camera.updateProjectionMatrix(); this.tween = null; }
    else this.tween = { p0: this.camera.position.clone(), l0: this.controls.target.clone(), f0: this.camera.fov, pos, look, fov: p.fov, t0: performance.now(), dur: 1100 };
    this.limits(look, pos);
  }
  limits(look, pos) {   // keep the orbit near the film's vantages: the scan is only sharp at about head height
    const c = this.controls, d = pos.distanceTo(look);
    c.minDistance = Math.max(0.5, d * 0.55); c.maxDistance = d * 1.35;
    const off = pos.clone().sub(look), az = Math.atan2(off.x, off.z);
    c.minAzimuthAngle = az - 0.75; c.maxAzimuthAngle = az + 0.75;
    c.minPolarAngle = 0.75; c.maxPolarAngle = 1.5;
  }

  // ---------------------------------------------------------------- per frame
  frame() { return this.rec.f0 + (Math.floor(this.t * FPS) % this.rec.len); }
  tick(now) {
    this.raf = requestAnimationFrame((t) => this.tick(t));
    if (!this.rec || !this.slot) return;
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.t += dt * this.rate;
    const f = this.frame(), rec = this.rec, cam = this.camera;
    rec.setFrame(f);
    let alpha = 1, showBody = true, showFrustum = true, showTrail = false, showHands = true, scanU = 0, scanA = 0, trailsU = 0, trailsA = 0;
    if (this.mode === 'story') {
      const s = this.story;
      // plan view (scan path, then every recording's head path) → descend to the table → the operator appears
      const u = smooth(span(s, 0.56, 0.86));
      const a = u < 0.5 ? P.plan : P.above, b = u < 0.5 ? P.above : P.table, k = smooth(u < 0.5 ? u * 2 : u * 2 - 1);
      cam.position.lerpVectors(V3(a.pos), V3(b.pos), k);
      cam.lookAt(V3(a.look).lerp(V3(b.look), k));
      cam.fov = lerp(a.fov, b.fov, k); cam.updateProjectionMatrix();
      this.splat.opacity = smooth(span(s, 0.0, 0.07));
      this.setCut(lerp(2.15, 30, smooth(span(s, 0.8, 0.88))));
      scanU = span(s, 0.06, 0.3); scanA = 0.95 * (1 - 0.7 * span(s, 0.6, 0.75));
      trailsU = span(s, 0.3, 0.56); trailsA = 1 - 0.6 * span(s, 0.62, 0.78);
      alpha = smooth(span(s, 0.7, 0.8));
      showTrail = alpha > 0;
    } else {
      this.splat.opacity = 1; this.setCut(30);
      if (this.tween) {
        const w = smooth(span(now, this.tween.t0, this.tween.t0 + this.tween.dur));
        cam.position.lerpVectors(this.tween.p0, this.tween.pos, w);
        this.controls.target.lerpVectors(this.tween.l0, this.tween.look, w);
        cam.fov = lerp(this.tween.f0, this.tween.fov, w); cam.updateProjectionMatrix();
        if (w >= 1) this.tween = null;
      }
      if (this.mode === 'viewer') {
        const n = this.focusName;
        showTrail = n === 'trail' || n === 'scene';
        showFrustum = n !== 'ego';
        showBody = n !== 'ego';
        trailsU = n === 'scene' || n === 'trail' ? 1 : 0; trailsA = n === 'trail' ? 0.9 : 0.35;
        if (n === 'ego') rec.egoCamera(f, cam);
        else this.controls.update();
      } else {
        this.controls.update();
      }
    }
    // retarget: the human or one robot on the same frame; the operator as the run saw it (operator_A)
    const robots = this.mode === 'retarget' && this.robotA && this.robotB;
    rec.setOperatorA(this.mode === 'retarget' && this.robotA ? this.robotA.info.operator_A : null);
    if (robots) {
      this.robotA.group.visible = this.emb === 'A'; this.robotB.group.visible = this.emb === 'B';
      if (this.emb === 'A') this.robotA.setFrame(f);
      if (this.emb === 'B') this.robotB.setFrame(f);
      showBody = showHands = this.emb === 'human'; showFrustum = this.emb === 'human';
    } else if (this.robotA) { this.robotA.group.visible = this.robotB.group.visible = false; }
    rec.show({ alpha, body: showBody, hands: showHands, frustum: showFrustum, trail: showTrail });
    this.reveal(this.scanPath, scanU, scanA);
    const per = 1 / this.trails.length;
    this.trails.forEach((l, k) => this.reveal(l, span(trailsU, k * per * 0.7, k * per * 0.7 + per * 1.3), trailsA));
    this.renderer.render(this.scene, cam);
    if (this.onFrame) this.onFrame(f, rec);
  }
}

// ---------------------------------------------------------------- the dining-table window of recording 7659f6d6
class Recording {
  constructor(E, base, meta, body, cam, hands, mesh, mj, faces) {
    Object.assign(this, { E, base, meta, body, cam, hands, mesh, mj, K: meta.K });
    this.f0 = mj.f0; this.len = mj.f1 - mj.f0; this.cache = new Map();
    this.group = new THREE.Group(); this.group.matrixAutoUpdate = false; E.world.add(this.group);
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(mj.verts * 3), 3);
    g.setAttribute('position', this.pos); g.setIndex(new THREE.BufferAttribute(faces, 1));
    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e3);   // body rises from the floor as it appears
    this.bodyMat = new THREE.MeshStandardMaterial({ color: COL.body, roughness: 0.45, metalness: 0.05, clippingPlanes: [this.clip] });
    this.bodyMesh = new THREE.Mesh(g, this.bodyMat); this.bodyMesh.frustumCulled = false; this.bodyMesh.renderOrder = -5;
    this.group.add(this.bodyMesh);
    this.bones = meta.skeleton_parents.map((p, i) => (p >= 0 && i < 22 ? [p, i] : null)).filter(Boolean);
    this.skel = E.fatLines(this.bones.length, COL.bone, 2.2, 0.85); this.group.add(this.skel);
    this.handLines = E.fatLines(MANO_BONES.length * 2, COL.hand, 2.4, 1); this.group.add(this.handLines);
    // head camera: lime frustum with the recorded frame on its far plane
    const d = 0.34, { fx, fy, cx, cy, w, h } = this.K;
    const c = [[0, 0], [w, 0], [w, h], [0, h]].map(([u, v]) => new THREE.Vector3((u - cx) / fx * d, (v - cy) / fy * d, d));
    const pts = []; c.forEach((p) => pts.push(0, 0, 0, p.x, p.y, p.z)); c.forEach((p, i) => { const q = c[(i + 1) % 4]; pts.push(p.x, p.y, p.z, q.x, q.y, q.z); });
    const lg = new LineSegmentsGeometry(); lg.setPositions(pts);
    this.frMat = new LineMaterial({ color: COL.lime, linewidth: 1.6, transparent: true, worldUnits: false, depthWrite: false }); E.lines.push(this.frMat);
    const fl = new LineSegments2(lg, this.frMat); fl.frustumCulled = false; fl.renderOrder = 850;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(c.flatMap((p) => [p.x, p.y, p.z]), 3));
    // ImageBitmaps upload top row first whatever flipY says: pixel (0, 0) takes uv (0, 0)
    pg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); pg.setIndex([0, 3, 1, 1, 3, 2]);
    this.tex = new THREE.Texture(); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.flipY = false;
    this.imgMat = new THREE.MeshBasicMaterial({ map: this.tex, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false });
    const quad = new THREE.Mesh(pg, this.imgMat); quad.frustumCulled = false; quad.renderOrder = 849;
    this.frustum = new THREE.Group(); this.frustum.matrixAutoUpdate = false; this.frustum.add(fl, quad); this.group.add(this.frustum);
    // head trail around the window
    this.trA = Math.max(0, this.f0 - 150); this.trB = Math.min(meta.frames - 1, this.f0 + this.len + 90);
    const tp = []; for (let f = this.trA; f <= this.trB; f++) tp.push(...this.camPos(f));
    this.trailFuture = E.fatPath(tp, COL.future, 1.6, 0.5); this.trailPast = E.fatPath(tp, COL.past, 3.2, 1);
    this.group.add(this.trailFuture, this.trailPast);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.335, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: COL.lime, transparent: true, side: THREE.DoubleSide }));
    this.ring.renderOrder = -6; E.scene.add(this.ring);
    this.caption = meta.caption;
    this.shown = -1;
  }
  camPos(f) { const c = this.cam, q = 7 * f; return [c[q], c[q + 1], c[q + 2]]; }
  image(f) {
    if (this.cache.has(f)) return this.cache.get(f);
    const p = fetch(`${this.base}frames/${pad5(f)}.jpg`).then((r) => r.blob()).then((b) => createImageBitmap(b)).catch(() => null);
    this.cache.set(f, p);
    if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
    return p;
  }
  setOperatorA(A) {
    const key = A ? 'A' : '-';
    if (this._opKey === key) return;
    this._opKey = key;
    if (A) this.group.matrix.set(...A.flat()); else this.group.matrix.identity();
    this.group.matrixWorldNeedsUpdate = true;
  }
  setFrame(f) {
    if (f === this.shown) return;
    this.shown = f;
    const m = this.mj, k = Math.max(m.f0, Math.min(m.f1 - 1, f)) - m.f0;
    this.pos.array.set(this.mesh.subarray(k * m.verts * 3, (k + 1) * m.verts * 3)); this.pos.needsUpdate = true;
    this.bodyMesh.geometry.computeVertexNormals();
    const B = this.body, o = 156 * f;
    const sa = this.skel.geometry.attributes.instanceStart.data;
    this.bones.forEach(([a, b], i) => { for (let c = 0; c < 3; c++) { sa.array[6 * i + c] = B[o + 3 * a + c]; sa.array[6 * i + 3 + c] = B[o + 3 * b + c]; } });
    sa.needsUpdate = true;
    const ha = this.handLines.geometry.attributes.instanceStart.data;
    for (let s = 0; s < 2; s++) {
      const ho = (f * 2 + s) * 63, ok = Number.isFinite(this.hands[ho]);
      const wo = o + 3 * (20 + s), wok = ok && (B[wo] !== 0 || B[wo + 1] !== 0 || B[wo + 2] !== 0);
      const d = [0, 1, 2].map((c) => (wok ? B[wo + c] - this.hands[ho + c] : 0));   // each hand moved whole onto the SMPL-H wrist
      MANO_BONES.forEach(([a, b], i) => {
        const q = 6 * (s * 20 + i);
        for (let c = 0; c < 3; c++) { ha.array[q + c] = ok ? this.hands[ho + 3 * a + c] + d[c] : 0; ha.array[q + 3 + c] = ok ? this.hands[ho + 3 * b + c] + d[c] : 0; }
      });
    }
    ha.needsUpdate = true;
    this.frustum.matrix.compose(this.camPosV(f), this.camQuat(f), new THREE.Vector3(1, 1, 1));
    this.frustum.matrixWorldNeedsUpdate = true;
    this.trailPast.geometry.instanceCount = Math.max(1, f - this.trA);
    this.image(f).then((bmp) => { if (bmp && this.shown === f) { this.tex.image = bmp; this.tex.needsUpdate = true; } });
    for (let k2 = 1; k2 <= 8; k2++) this.image(this.f0 + ((f - this.f0 + k2) % this.len));   // prefetch
    const p = new THREE.Vector3(B[o], B[o + 1], B[o + 2]).applyMatrix4(this.group.matrixWorld);
    this.ring.position.set(p.x, this.E.floorY + 0.004, p.z);
  }
  camPosV(f) { const c = this.cam, q = 7 * f; return new THREE.Vector3(c[q], c[q + 1], c[q + 2]); }
  camQuat(f) { const c = this.cam, q = 7 * f; return new THREE.Quaternion(c[q + 3], c[q + 4], c[q + 5], c[q + 6]); }
  show({ alpha, body, hands, frustum, trail }) {
    const on = alpha > 0.002;
    this.bodyMesh.visible = on && body; this.skel.visible = on && body; this.handLines.visible = on && hands;
    this.frustum.visible = on && frustum; this.ring.visible = on && body;
    this.clip.constant = this.E.floorY - 0.05 + 2.1 * smooth(alpha);
    this.skel.material.opacity = 0.8 * alpha; this.handLines.material.opacity = alpha;
    this.frMat.opacity = alpha; this.imgMat.opacity = 0.95 * alpha; this.ring.material.opacity = 0.9 * alpha;
    this.trailPast.visible = this.trailFuture.visible = on && trail;
    this.trailPast.material.opacity = alpha; this.trailFuture.material.opacity = 0.45 * alpha;
  }
  // the recorded head camera itself (OpenCV x right, y down, z forward → three.js), vertical FOV from the intrinsics
  egoCamera(f, cam) {
    const M = new THREE.Matrix4().compose(this.camPosV(f), this.camQuat(f), new THREE.Vector3(1, 1, 1));
    M.premultiply(this.group.matrix).premultiply(this.E.world.matrix).multiply(new THREE.Matrix4().makeRotationX(Math.PI));
    M.decompose(cam.position, cam.quaternion, new THREE.Vector3());
    cam.fov = 2 * Math.atan(this.K.h / 2 / this.K.fy) * 180 / Math.PI; cam.updateProjectionMatrix();
  }
  current(f) {
    const cap = this.caption;
    const seg = cap.segments.find((s) => s.s <= f && f <= s.e);
    const act = cap.actions.find((a) => a.s <= f && f <= a.e);
    let it = null; for (const x of cap.interactions) { if (x.f <= f) it = x; else break; }
    let hd = null; for (const x of cap.hands) { if (x.f <= f) hd = x; else break; }
    return { task: cap.main_task, sub: seg?.sub_task, objects: seg?.objects ?? [], action: act?.label, actionText: act?.description, now: it?.text, hands: hd };
  }
}

// ---------------------------------------------------------------- retargeted robot (export_robot.py), Kosmos world
class Robot {
  constructor(E) { this.E = E; }
  async load(base, name) {
    const [info, bin, motion] = await Promise.all([json(`${base}${name}.json`), fetchBytes(`${base}${name}_mesh.bin`), f32(`${base}${name}_motion.f32`)]);
    Object.assign(this, { info, motion, NG: info.geoms, n: info.f1 - info.f0 });
    const geos = info.meshes.map((m) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin.buffer, m.v, 3 * m.nv), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bin.buffer, m.n, 3 * m.nv), 3));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin.buffer, m.i, 3 * m.nf), 1));
      return g;
    });
    const mats = [new THREE.MeshStandardMaterial({ color: 0xdfe3e9, roughness: 0.36, metalness: 0.12 }),
      new THREE.MeshStandardMaterial({ color: 0x33373e, roughness: 0.5, metalness: 0.3 })];
    const byRgb = new Map(), rgbMat = (c) => {
      const key = c.join(',');
      if (!byRgb.has(key)) byRgb.set(key, new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...c, THREE.SRGBColorSpace), roughness: 0.4, metalness: 0.12 }));
      return byRgb.get(key);
    };
    this.group = new THREE.Group(); this.group.visible = false; this.E.world.add(this.group);
    this.links = info.geom_mesh.map((mi, k) => {
      const m = new THREE.Mesh(geos[mi], info.rgb ? rgbMat(info.rgb[k]) : mats[info.tone[k]]);
      m.matrixAutoUpdate = false; m.frustumCulled = false; m.renderOrder = -5;
      this.group.add(m);
      return m;
    });
    return this;
  }
  setFrame(f) {
    const k = Math.max(0, Math.min(this.n - 1, f - this.info.f0)), M = this.motion;
    this.links.forEach((m, g) => {
      const o = (k * this.NG + g) * 7;
      m.matrix.compose(_rp.set(M[o], M[o + 1], M[o + 2]), _rq.set(M[o + 3], M[o + 4], M[o + 5], M[o + 6]), _one);
      m.matrixWorldNeedsUpdate = true;
    });
  }
}
const _rp = new THREE.Vector3(), _rq = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);
