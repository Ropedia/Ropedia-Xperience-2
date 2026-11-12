// One WebGL renderer for every 3D slot on the homepage. It holds the LH_17761 scan (Spark 3DGS), recording 7659f6d6's
// dining-table window (SMPL-H mesh, skeleton, MANO hands snapped to the SMPL-H wrists, head-camera frustum with its
// recorded frames, head trail), the eight recordings' head paths, the scan's reconstruction trajectory and the two
// retargeted robots.
// Drawing code ported from video/flythrough/director.js and the mocap viewer. One engine for the page (shared()); its
// canvas moves to whichever tracked slot shows most of itself, and the slot it leaves keeps a still of its last frame:
// 'story' (scroll-driven camera), 'viewer' (viewer.js drives the camera and the layers) or 'retarget' (orbit + Human /
// Robot A / B; on the hero recording, or on another home's scan and recording: home(), rtSrc).
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
// the eight PASS recordings (head paths and cards) come from recordings.json (build_story.py), in the order the cards
// run down the page, each in its colour; 7659f6d6, the one the story ends on, keeps the pink of its own head trail
const MANO_BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20]];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const span = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (u) => u * u * (3 - 2 * u);
const inOutSine = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
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
// a recording window's mesh.json and its body mesh: mesh.q16z when mesh.json names one (tools/pack_mesh.py: a quarter
// of the size; uint16 per axis over the window's box, frame-to-frame deltas, low bytes then high bytes, gzipped),
// else the raw mesh.f32
async function meshOf(HB) {
  const mj = await json(`${HB}mesh.json`), q = mj.q16;
  if (!q || typeof DecompressionStream === 'undefined') return [await f32(`${HB}mesh.f32`), mj];
  const r = await fetch(`${HB}${q.file}`);
  if (!r.ok) throw new Error(`${HB}${q.file}: ${r.status}`);
  const b = new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const n = b.length >> 1, per = mj.verts * 3, out = new Float32Array(n), acc = new Uint16Array(per);
  const s = [0, 1, 2].map((a) => (q.hi[a] - q.lo[a]) / 65535);
  for (let k = 0, j = 0; k < n; k++) {
    acc[j] += b[k] | (b[n + k] << 8);   // (Uint16Array: the sum wraps mod 2^16 as it was packed)
    const a = j % 3;
    out[k] = q.lo[a] + acc[j] * s[a];
    if (++j === per) j = 0;
  }
  return [out, mj];
}
const smoothPts = (P, k) => P.map((_, i) => {
  const s = [0, 0, 0]; let n = 0;
  for (let j = Math.max(0, i - k); j <= Math.min(P.length - 1, i + k); j++) { s[0] += P[j][0]; s[1] += P[j][1]; s[2] += P[j][2]; n++; }
  return s.map((v) => v / n);
});

// camera presets of the retarget slot, view frame (gravity up = +Y, floor at y = -1.466); the dining-table vantage is
// the film's clearance-checked one (shots/retarget_lh17761.js)
const P = {
  robot: { pos: [0.58, 0.45, -0.95], look: [2.0, -0.6, 0.2], fov: 46 },
};
let SHARED = null;
export const shared = (base = 'data/LH_17761/') => (SHARED ??= new Engine(base));   // one engine, one canvas, per page

// ---------------------------------------------------------------- story timeline (scroll progress of the section)
export const STORY = {
  hand: [0.004, 0.04],     // the hero's last frame (a still of the film's closing crane) gives way to the live scan
  crane: [0.02, 0.15],     // that pose → the plan, framed beside the copy
  dim: [0.09, 0.15],       // the scene darkens ...
  scan: [0.14, 0.38],      // ... and the reconstruction trajectory draws in, lighting what it passed
  homie: [0.42, 0.48],     // HOMIE Gen 2, on its own
  trails: [0.48, 0.69],    // the eight recordings, card and head path one after another
  descend: [0.72, 0.88],   // down to the dining table, at eye height
  op: [0.85, 0.91],        // the operator rises from the floor and starts
};
export const CUT = 2.15;   // ceiling cut, metres above the floor (the film's)
const DIM = 0.13;          // what the unscanned scene keeps of its colour while the scan draws

// a camera as orbit parameters about its target, so poses blend without flips (also straight down)
export function pose(pos, look, fov) {
  const o = [pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]], d = Math.hypot(...o);
  return { look: [...look], dist: d, pitch: Math.asin(o[1] / d), yaw: Math.atan2(o[0], o[2]), fov, dx: 0, dy: 0, near: 0.05 };
}
export function blend(a, b, u, w = {}) {   // w: per-parameter easing of u
  const e = (k) => (w[k] ? w[k](u) : u);
  let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  return {
    look: a.look.map((v, i) => lerp(v, b.look[i], e('look'))),
    dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), e('dist'))),
    pitch: lerp(a.pitch, b.pitch, e('pitch')), yaw: a.yaw + dy * e('yaw'), fov: lerp(a.fov, b.fov, e('fov')),
    dx: lerp(a.dx, b.dx, e('off')), dy: lerp(a.dy, b.dy, e('off')), near: lerp(a.near ?? 0.05, b.near ?? 0.05, e('near')),
  };
}
// from one case to another: up over the walls and down again (a curve through a point high above the two)
function hop(a, b, u) {
  const mid = { ...blend(a, b, 0.5), dist: Math.max(a.dist, b.dist, 3.4) * 2.3, pitch: (72 * Math.PI) / 180, near: 0.05 };   // the curve peaks ~4 m up
  const w = smooth(u);
  return blend(blend(a, mid, w), blend(mid, b, w), w);
}
export function basis(p) {   // camera position and axes (three.js: x right, y up, z backward)
  const cp = Math.cos(p.pitch), z = new THREE.Vector3(cp * Math.sin(p.yaw), Math.sin(p.pitch), cp * Math.cos(p.yaw));
  const x = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw)), y = new THREE.Vector3().crossVectors(z, x);
  return { pos: V3(p.look).addScaledVector(z, p.dist), x, y, z };
}
const OUTRO = pose([2.65, 7.6, 0.8], [2.6, -1.4, 0.6], 40);   // the film's closing crane (shots/retarget_cuts.js)

const GRID_FS = `uniform vec3 uColor; uniform float uOpacity; uniform vec2 uCenter; uniform float uRadius; varying vec3 vW;
  float line(float x, float w) { float d = abs(fract(x - 0.5) - 0.5); float fw = fwidth(x); return 1.0 - smoothstep(w * fw, (w + 1.2) * fw, d); }
  void main() {
    float major = max(line(vW.x, 0.7), line(vW.z, 0.7));
    float minor = max(line(vW.x * 4.0, 0.5), line(vW.z * 4.0, 0.5));
    float fade = 1.0 - smoothstep(uRadius * 0.3, uRadius, length(vW.xz - uCenter));
    gl_FragColor = vec4(uColor, (major * 0.32 + minor * 0.07) * fade * uOpacity);
  }`;

export class Engine {
  constructor(base) {
    this.base = base;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl';
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));   // the film renders at the device's own ratio
    this.restPR = r.getPixelRatio();                             // the ratio at rest; govern() lowers it while the camera moves
    r.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080808);          // the film's
    this.spark = new SparkRenderer({ renderer: r });
    this.scene.add(this.spark);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2e33, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(2, 6, 3); this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.05, 300);
    this.world = new THREE.Group(); this.world.matrixAutoUpdate = false; this.scene.add(this.world);
    // the film's floor grid (1 m / 25 cm), under the scan
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fragmentShader: GRID_FS,
      uniforms: { uColor: { value: new THREE.Color(COL.lime) }, uOpacity: { value: 0.45 }, uCenter: { value: new THREE.Vector2(3.5, 0.8) }, uRadius: { value: 16 } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    }));
    this.grid.renderOrder = -10; this.scene.add(this.grid);
    this.cut = new SplatEdit({ rgbaBlendMode: 'multiply', softEdge: 0.05 });
    this.cutPlane = new SplatEditSdf({ type: 'plane', opacity: 0 });
    this.cutPlane.rotation.x = Math.PI / 2;                    // keeps splats below the plane
    this.cut.add(this.cutPlane); this.scene.add(this.cut);
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, rotateSpeed: 0.55, zoomSpeed: 0.6, enabled: false });
    this.controls.addEventListener('start', () => { this.tween = null; this.userMoved = true; });
    this.canvas.style.touchAction = '';                          // (OrbitControls sets none): the page still scrolls over the canvas
    this.lines = [];                                             // fat lines whose resolution follows the canvas
    this.slot = null; this.mode = null; this.story = 0; this.t = 0; this.rate = 1; this.last = performance.now();
    this.emb = 'human'; this.tween = null; this.onFrame = null; this.hi = -1; this.W = 1; this.H = 1;
    this.hooks = {};                                             // per-mode frame callbacks (story: onFrame)
    this.viewer = null;                                          // the viewer slot's controller (viewer.js)
    this.tracked = new Map();                                    // slot → how much of it is on screen (px)
    this.planRegion = null;                                      // the screen box the plan is framed into (story.js)
    this.caseId = null; this.recs = new Map(); this.loadedIds = new Set(); this.hopT = null; this.caseT0 = -1e9;   // step 3's cases (selectCase)
    this.ready = this.load();
    this.recReady = this.ready.then(() => this.selectCase(this.cards.cases[0].id));
    // every other case, one after another, so a switch in step 3 never waits: once the story is half way
    // (story.js calls preloadCases), not at page load, where they were some 80 MB more for a visitor who never gets there
    this.raf = 0;
  }

  // ---------------------------------------------------------------- loading
  // first the scan, the reconstruction trajectory and the head paths (the plan needs only these), then the window
  async load() {
    const B = this.base;
    [this.meta, this.cards] = await Promise.all([json(`${B}scene.json`), json(`${B}recordings.json`)]);
    const R = this.meta.view_R;
    this.world.matrix.set(R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, 0, 0, 0, 1);
    this.world.updateMatrixWorld(true);
    this.floorY = this.meta.floor_y;
    this.grid.position.y = this.floorY - 0.003;
    // the full scan (4.09 M splats, the film's), fetched from the start; until it is in, the story shows the hero's
    // still (the lite one, 1.2 M splats, is visibly softer and only loads with ?lite=1)
    const lite = new URLSearchParams(location.search).has('lite');
    const [bytes, cams] = await Promise.all([
      fetchBytes(`${B}${lite ? 'scene_lite' : 'scene'}.spz`, (got, total) => {
        const u = got / Math.max(1, total);
        this.progress?.(u);
        for (const s of this.tracked.keys()) s.style.setProperty('--p', `${Math.round(u * 100)}%`);
      }),
      Promise.all(this.cards.recordings.map((r) => f32(`${B}${r.id}/cam.f32`)))]);
    this.splat = new SplatMesh({ fileBytes: bytes, fileName: 'scene.spz' });
    await this.splat.initialized;
    this.world.add(this.splat);
    this.full = !lite;
    // the head paths, smoothed a little, in the order they are drawn
    this.trails = this.cards.recordings.map((r, k) => {
      const c = cams[k], pts = [];
      for (let i = 0; i < c.length / 7; i += 4) pts.push([c[7 * i], c[7 * i + 1], c[7 * i + 2]]);
      const l = this.fatPath(smoothPts(pts, 2).flat(), new THREE.Color(r.color).getHex(), 2.2, 1);
      l.userData.n = pts.length - 1; l.renderOrder = 806; this.world.add(l);
      return { ...r, line: l, pinV: V3(r.pin) };   // pin: view frame, where the card's clip works
    });
    // the reconstruction trajectory, and where the scan has been: cylinders along it (view frame), each opening once the scanner
    // reaches it; outside them the scene keeps only DIM of its colour
    const sp = smoothPts(this.meta.scan, 3);
    this.scanPts = sp;
    this.scanPath = this.fatPath(sp.flat(), COL.lime, 2.4, 1); this.scanPath.userData.n = sp.length - 1;
    this.scanPath.renderOrder = 805; this.world.add(this.scanPath);
    const Rm = new THREE.Matrix3().setFromMatrix4(this.world.matrix), seen = [];
    this.scanView = sp.map((p) => V3(p).applyMatrix3(Rm));
    this.scanView.forEach((v, i) => { if (seen.every((s) => Math.hypot(v.x - s.v.x, v.z - s.v.z) > 0.75)) seen.push({ v, u: i / (sp.length - 1) }); });
    this.lit = new SplatEdit({ rgbaBlendMode: 'multiply', softEdge: 0.9, invert: true });
    this.litCol = new THREE.Color(1, 1, 1);
    this.litCyl = seen.map(({ v, u }) => {
      const c = new SplatEditSdf({ type: 'cylinder', radius: -0.6, color: this.litCol, opacity: 1 });
      c.position.set(v.x, this.floorY + 1.1, v.z); c.scale.set(1, 1.4, 1); c.userData.u = u;
      this.lit.add(c);
      return c;
    });
    this.scene.add(this.lit);
    // the scanner covers the home in its first loop and then goes over it again, so the scroll runs through the path at
    // a pace set half by the path and half by how much of the home is newly lit: g(u) = 0.4 u + 0.6 coverage(u)
    const births = this.litCyl.map((c) => c.userData.u).sort((a, b) => a - b), N = 512;
    this.paceU = new Float32Array(N + 1);
    const g = (u) => 0.4 * u + 0.6 * (births.filter((b) => b <= u).length / births.length);
    let u = 0;
    for (let i = 0; i <= N; i++) { const want = i / N; while (u < 1 && g(u) < want) u += 1 / 4096; this.paceU[i] = Math.min(1, u); }
    this.litCyl.forEach((c) => { c.userData.q = g(c.userData.u); });   // where on that scroll pace it opens
    // the scanner's light: a lime wash on what it is passing
    this.wash = new SplatEdit({ rgbaBlendMode: 'add_rgba', softEdge: 1.1 });
    this.washSdf = new SplatEditSdf({ type: 'sphere', radius: -0.6, color: new THREE.Color(0.2, 0.34, 0.1), opacity: 0 });
    this.wash.add(this.washSdf); this.scene.add(this.wash);
    this.setCut(CUT);
    this.loaded = true;
    this.resize();
  }
  preloadCases() {
    this.casesP ??= this.recReady.then(async () => { for (const c of this.cards.cases) await this.loadCase(c.id).catch(() => {}); });
    return this.casesP;
  }
  // step 3's cases: the recordings with a 3D window (recordings.json), each loaded the first time it is picked
  loadCase(id) {
    if (this.recs.has(id)) return this.recs.get(id);
    const B = this.base, HB = `${B}${id}/`, color = this.trails.find((t) => t.id === id)?.color ?? '#FF6B9A';
    const p = (this.faces ??= u32(`${B}faces.u32`)).then((faces) => Promise.all([json(`${HB}take.json`), f32(`${HB}body.f32`),
      f32(`${HB}cam.f32`), f32(`${HB}hands.f32`), meshOf(HB)])
      .then(([take, body, cam, hands, [mesh, mj]]) => {
        const r = new Recording(this, HB, take, body, cam, hands, mesh, mj, faces, color);
        r.id = id; this.loadedIds.add(id);
        r.show({ alpha: 0 });
        for (let k = 0; k < 24; k++) r.image(r.f0 + k);   // the first second of frames, ahead of time
        return r;
      }));
    this.recs.set(id, p);
    return p;
  }
  // pick a case: the camera hops there if the story is already down at a table, and the operator changes over once
  // the new recording is in and the camera is half way
  selectCase(id) {
    const c = this.cards.cases.find((x) => x.id === id);
    if (!c || id === this.caseId) return this.recs.get(id);
    const was = this.caseId;
    this.caseId = id; this.case = c;
    this.casePose = { ...pose(c.pos, c.look, c.fov), near: c.near };
    this.setTable();
    if (was && this.lastPose && this.story >= STORY.descend[1] - 0.02) this.hopT = { from: { ...this.lastPose }, t0: performance.now(), dur: 2000 };
    const p = this.loadCase(id);
    p.then((r) => { if (this.caseId === id) this.nextRec = r; });
    return p;
  }
  // another scan, for the highlights gallery: its splats in their own view frame (data/<id>/scene.json view_R), hidden
  // until shown; and a recording registered to it (data/<id>/<take>/, its window cut by build_viewer.py)
  space(id, onProgress, temp = false) {
    this.spaces ??= new Map();
    if (!temp) (this.kept ??= new Set()).add(id);   // the gallery's stay; a home of the wall can be dropped (dropHome)
    if (this.spaces.has(id)) return this.spaces.get(id);
    const B = this.base.replace(/[^/]+\/$/, '') + `${id}/`;
    const p = json(`${B}scene.json`).then(async (meta) => {
      const world = new THREE.Group(), R = meta.view_R;
      world.matrixAutoUpdate = false;
      world.matrix.set(R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, 0, 0, 0, 1);
      world.updateMatrixWorld(true); world.visible = false; this.scene.add(world);
      const splat = new SplatMesh({ fileBytes: await fetchBytes(`${B}scene.spz`, onProgress), fileName: 'scene.spz' });
      await splat.initialized;
      const sp = { id, meta, world, splat, floorY: meta.floor_y, base: B, recs: new Map() };
      (this.spaceList ??= []).push(sp);   // (its splats join the scene when it is shown: see draw())
      return sp;
    });
    this.spaces.set(id, p);
    return p;
  }
  spaceRec(sp, take, color = '#FF6B9A') {
    if (sp.recs.has(take)) return sp.recs.get(take);
    const HB = `${sp.base}${take}/`;
    const p = (this.faces ??= u32(`${this.base}faces.u32`)).then((faces) => Promise.all([json(`${HB}take.json`), f32(`${HB}body.f32`),
      f32(`${HB}cam.f32`), f32(`${HB}hands.f32`), meshOf(HB)])
      .then(([meta, body, cam, hands, [mesh, mj]]) => {
        const r = new Recording(this, HB, meta, body, cam, hands, mesh, mj, faces, color, sp);
        r.id = take; r.show({ alpha: 0 });
        r.group.updateMatrixWorld(true);   // (its joints are asked for before its first frame is drawn)
        for (let k = 0; k < 24; k++) r.image(r.f0 + k);
        return r;
      }));
    sp.recs.set(take, p);
    return p;
  }
  // another home with one recording and both robots on it (the wall of apps.js): its scan, the recording's window and
  // the robots' motion; the robots' meshes are the hero recording's own files. Drawn in the 'retarget' mode while it
  // is this.rtSrc.
  home(scene, take, onProgress) {
    this.homes ??= new Map();
    const key = `${scene}/${take}`;
    if (!this.homes.has(key)) {
      const p = (async () => {
        await this.ready;
        const sp = await this.space(scene, onProgress, true), HB = `${sp.base}${take}/`, MB = `${this.base}${this.meta.hero}/`;
        const [rec, A, B] = await Promise.all([this.spaceRec(sp, take), new Robot(this, sp.world).load(HB, 'robot', MB), new Robot(this, sp.world).load(HB, 'robot_b', MB)]);
        return { key, scene, take, sp, rec, A, B };
      })();
      p.catch(() => this.homes.delete(key));
      this.homes.set(key, p);
    }
    return this.homes.get(key);
  }
  // let a home go: its bodies, and its scan unless the gallery shows that scan too (a scan is 2-4 M splats)
  dropHome(key) {
    const p = this.homes?.get(key);
    if (!p) return;
    this.homes.delete(key);
    p.then((h) => {
      if (this.rtSrc === h) this.rtSrc = null;
      h.A.dispose(); h.B.dispose(); h.rec.dispose(); h.sp.recs.delete(h.take);
      if (this.kept?.has(h.scene)) return;
      this.spaces.delete(h.scene); this.spaceList = this.spaceList.filter((x) => x !== h.sp);
      h.sp.splat.parent?.remove(h.sp.splat); h.sp.splat.dispose(); this.scene.remove(h.sp.world);
    }).catch(() => {});
  }
  // what the 'retarget' mode draws: the hero recording and its robots, or a home of the wall
  rtCur() { return this.rtSrc ?? { rec: this.heroRec, A: this.robotA, B: this.robotB }; }
  rtHide(c) { if (c) { c.rec?.show({ alpha: 0 }); if (c.A) c.A.group.visible = false; if (c.B) c.B.group.visible = false; } }
  // a slot that takes the canvas whatever else is on screen (a dialog over the page), until hold(null)
  hold(slot) {
    this.held = slot;
    if (slot) { this.attach(slot); this.resume(); } else this.pick();
  }
  pick() {
    if (this.held) return;
    let best = null, most = 0;
    for (const [s, v] of this.tracked) if (v > most) { most = v; best = s; }
    if (!best) this.pause(); else if (best !== this.slot) this.attach(best); else this.resume();
  }
  async loadRobots() {
    if (this.robots) return this.robots;
    await this.recReady;
    const HB = `${this.base}${this.meta.hero}/`;
    this.loadCase(this.meta.hero).then((r) => { this.heroRec = r; });   // the recording the robots were retargeted from
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
  // a view-frame point on screen (CSS px of the canvas), or null behind the camera
  project(v) {
    const p = v.clone().project(this.camera);
    if (p.z > 1) return null;
    return [(p.x + 1) / 2 * this.W, (1 - p.y) / 2 * this.H];
  }

  // ---------------------------------------------------------------- slots
  // the slots a screen hands in; the canvas goes to the one most on screen, and the engine sleeps while none is
  track(slot) {
    if (this.tracked.has(slot)) return;
    this.tracked.set(slot, 0);
    this.io ??= new IntersectionObserver((es) => {
      for (const e of es) {
        this.tracked.set(e.target, e.isIntersecting ? e.intersectionRect.height * e.intersectionRect.width : 0);
        // a slot coming on screen before the canvas does shows the frame on screen now, not black (a slot with a
        // poster of its own, such as a gallery card of another scan, keeps that)
        if (e.isIntersecting && e.target !== this.slot && this.slot && this.loaded && !('poster' in e.target.dataset) && !e.target.querySelector('canvas.gl-snap')) this.snap(e.target);
      }
      this.pick();
    }, { threshold: Array.from({ length: 41 }, (_, i) => i / 40) });
    this.io.observe(slot);
  }
  // the slot being left keeps its last frame (rendered again and copied before the drawing buffer is gone)
  snap(slot) {
    const host = slot.querySelector('.gl-host');
    let c = host.querySelector('canvas.gl-snap');
    if (!c) { c = document.createElement('canvas'); c.className = 'gl-snap'; c.setAttribute('aria-hidden', 'true'); host.appendChild(c); }
    c.width = this.canvas.width; c.height = this.canvas.height;
    this.draw(this.camera);
    c.getContext('2d').drawImage(this.canvas, 0, 0);
    c.hidden = false;
  }
  attach(slot) {
    if (this.slot === slot) return;
    const from = this.mode;
    if (this.slot && this.loaded && slot) this.snap(this.slot);
    this.slot = slot;
    if (!slot) { cancelAnimationFrame(this.raf); this.raf = 0; return; }
    const host = slot.querySelector('.gl-host'), still = host.querySelector('canvas.gl-snap');
    host.insertBefore(this.canvas, host.firstChild);
    if (still) still.hidden = true;
    this.mode = slot.dataset.mode;
    if (from === 'retarget' && this.mode !== 'retarget') {
      this.heroRec?.show({ alpha: 0 }); this.rtHide(this.rtSrc); this.rtShown = undefined;
      if (this.rtSrc) this.rtSrc.sp.world.visible = false;
      this.hooks.retargetLeave?.();
    }
    this.controls.enabled = this.mode === 'retarget';
    this.resize();
    if (this.mode === 'viewer') this.viewer?.enter(from);
    // (apps.js has two retarget slots, the hero recording's and the wall's dialog: rtAttach sets up whichever this is)
    if (this.mode === 'retarget') { this.loadRobots(); if (!this.hooks.rtAttach?.(slot)) { this.rtSrc = null; this.setEmbodiment(this.emb, true); } }
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.tick(t)); }
  }
  pause() { cancelAnimationFrame(this.raf); this.raf = 0; }
  resume() { if (this.slot && !this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame((t) => this.tick(t)); } }
  resize() {
    if (!this.slot) return;
    const host = this.slot.querySelector('.gl-host');
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.lines.forEach((m) => m.resolution.set(w, h));
    // the closing crane's last frame, cover-fitted like the hero's picture of it (16:9, 40° tall)
    const a = w / h, A = 16 / 9;
    this.outro = { ...OUTRO, fov: a > A ? 2 * Math.atan(Math.tan(Math.PI / 9) * A / a) * 180 / Math.PI : OUTRO.fov };
    if (this.meta) this.plan = this.fitPlan();
    this.setTable();
  }
  setTable() {   // the case's vantage, the operator a little right of centre, clear of the copy
    if (this.casePose) this.table = { ...this.casePose, dx: this.W / this.H > 1.2 ? 0.07 * this.W : 0 };
  }
  // the plan: the whole home seen from above at a slight tilt, framed into planRegion (beside the copy); on a tall screen
  // it turns a quarter so the home's long side runs down the screen
  fitPlan() {
    const W = this.W, H = this.H, R = this.planRegion ?? { x0: 0, y0: 0, x1: W, y1: H };
    const [lo, hi] = this.meta.bounds, f0 = this.floorY, f1 = this.floorY + CUT;
    const look = [(lo[0] + hi[0]) / 2, f0, (lo[2] + hi[2]) / 2];
    const corners = [];
    for (const x of [lo[0], hi[0]]) for (const y of [f0, f1]) for (const z of [lo[2], hi[2]]) corners.push(new THREE.Vector3(x, y, z));
    const base = { look, pitch: (76 * Math.PI) / 180, yaw: W / H < 0.9 ? -Math.PI / 2 : 0, fov: 36, dx: 0, dy: 0 };
    const f = H / 2 / Math.tan((base.fov * Math.PI) / 360);
    const box = (dist) => {
      const b = basis({ ...base, dist });
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        const v = c.clone().sub(b.pos), d = -v.dot(b.z), px = W / 2 + (v.dot(b.x) / d) * f, py = H / 2 - (v.dot(b.y) / d) * f;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      return { x0, x1, y0, y1 };
    };
    let a = 3, b = 60;
    for (let it = 0; it < 40; it++) {
      const m = (a + b) / 2, q = box(m);
      if (q.x1 - q.x0 > (R.x1 - R.x0) * 0.96 || q.y1 - q.y0 > (R.y1 - R.y0) * 0.96) a = m; else b = m;
    }
    const q = box(b);
    return { ...base, dist: b, dx: (R.x0 + R.x1) / 2 - (q.x0 + q.x1) / 2, dy: (R.y0 + R.y1) / 2 - (q.y0 + q.y1) / 2 };
  }
  applyPose(p) {
    const b = basis(p), cam = this.camera;
    cam.position.copy(b.pos);
    cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(b.x, b.y, b.z));
    cam.fov = p.fov; cam.near = p.near ?? 0.05;
    if (Math.abs(p.dx) > 0.5 || Math.abs(p.dy) > 0.5) cam.setViewOffset(this.W, this.H, -p.dx, -p.dy, this.W, this.H);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  }
  setEmbodiment(e, jump = false) {
    this.emb = e;
    this.goTo(P.robot, jump);
  }
  goTo(p, jump) {
    const pos = V3(p.pos), look = V3(p.look);
    this.camera.clearViewOffset();
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

  // ---------------------------------------------------------------- the story, at scroll progress s
  storyFrame(s) {
    const T = STORY;
    // camera: closing crane → plan → down to the table (the yaw and the distance first, the tilt late, so it stays
    // above the cut until it is over the table)
    let p = blend(this.outro, this.plan, span(s, ...T.crane), { look: smooth, dist: smooth, pitch: smooth, yaw: smooth, fov: smooth, off: smooth });
    // the way down: turn and close in over the table first, high above the ceiling cut, then lean down to eye level
    // once over it, so the camera never passes a wall
    const d = span(s, ...T.descend), early = (u) => smooth(span(u, 0, 0.7));
    if (d > 0 && this.table) p = blend(this.plan, this.table, d, { look: early, yaw: early, dist: smooth, pitch: (u) => smooth(span(u, 0.55, 1)), fov: smooth, off: (u) => smooth(span(u, 0, 0.6)), near: (u) => smooth(span(u, 0.85, 1)) });
    // a change of case at the table: hop from where the camera was
    const now = performance.now(), hu = this.hopT ? span(now, this.hopT.t0, this.hopT.t0 + this.hopT.dur) : 1;
    if (this.hopT) { p = hop(this.hopT.from, p, hu); if (hu >= 1) this.hopT = null; }
    this.lastPose = p;
    this.applyPose(p);
    this.splat.opacity = 1;
    this.grid.material.uniforms.uOpacity.value = 0.45;

    // the scan: the scene darkens, then lights up wherever the trajectory passes, in a lime wash; back to full colour
    // on the way down
    const sq = inOutSine(span(s, ...T.scan)), su = this.paceU[Math.round(sq * 512)], dim = lerp(1, DIM, smooth(span(s, ...T.dim)) * (1 - smooth(span(s, 0.7, 0.8))));
    this.litCol.setScalar(dim);
    // (an unreached cylinder sits at -0.6 m, so its soft edge lights nothing yet)
    for (const c of this.litCyl) { c.radius = lerp(-0.6, 1.55, smooth(span(sq, c.userData.q - 0.01, c.userData.q + 0.05))); c.color = this.litCol; }
    const k = Math.round(su * (this.scanView.length - 1)), head = this.scanView[k];
    this.scanHead = su > 0 && su < 1 ? head : null;
    this.washSdf.position.copy(head);
    this.washSdf.radius = su > 0 && su < 1 ? lerp(-0.6, 0.55, span(s, T.scan[0], T.scan[0] + 0.01)) : -0.6;
    const scanA = (1 - 0.84 * smooth(span(s, T.scan[1] + 0.03, T.trails[0] + 0.02))) * (1 - smooth(span(s, T.descend[0], T.descend[0] + 0.06)));
    this.reveal(this.scanPath, su, scanA);

    // the head paths, one after another; one can be picked out (this.hi) from the list
    const tu = span(s, ...T.trails), n = this.trails.length, per = 1 / n;
    const out = 1 - smooth(span(s, T.descend[0], T.descend[0] + 0.07));
    this.trailU = this.trails.map((tr, i) => inOutSine(span(tu, i * per * 0.86, i * per * 0.86 + per * 1.25)));
    const hi = this.focusIndex();
    this.trails.forEach((tr, i) => {
      const pick = hi >= 0 ? (hi === i ? 1 : 0.14) : 1;
      tr.line.material.linewidth = hi === i ? 3.6 : 2.2;
      this.reveal(tr.line, this.trailU[i], 0.95 * pick * out);
    });

    // the operator rises from the floor and starts; the recording plays on its own clock from then on. On a change of
    // case the old one sinks away while the camera rises, and the new one rises once it is in and the hop is half way.
    if (this.nextRec && hu >= 0.5) {
      this.rec?.show({ alpha: 0 });
      this.rec = this.nextRec; this.nextRec = null; this.caseT0 = now; this.t = 0;
    }
    // (while the picked one is still loading, the old one stays away)
    const waiting = this.rec && this.rec.id !== this.caseId;
    const leave = waiting ? 1 - smooth(span(hu, 0.05, 0.4)) : 1, arrive = smooth(span(now, this.caseT0, this.caseT0 + 900));
    const alpha = this.rec ? smooth(span(s, ...T.op)) * Math.min(leave, arrive) : 0;
    if (smooth(span(s, ...T.op)) <= 0) this.t = 0;
    return alpha;
  }
  focusIndex() { return this.hi >= 0 ? this.hi : this.sel ?? -1; }   // hovered, else picked

  // A scan that is hidden has its splats out of the scene graph, not only invisible: with an invisible SplatMesh in
  // the scene Spark counts a generator it never draws, takes that for a change and rebuilds every splat of every scan
  // on each update, at rest too.
  draw(cam) {
    const sync = (world, splat) => {
      if (!splat) return;
      if (world.visible) { if (splat.parent !== world) world.add(splat); } else if (splat.parent) splat.parent.remove(splat);
    };
    sync(this.world, this.splat);
    if (this.spaceList) for (const sp of this.spaceList) sync(sp.world, sp.splat);
    this.renderer.render(this.scene, cam);
  }
  // Resolution follows the camera: while it moves and frames run long, the canvas renders at fewer px per CSS px (a
  // scan in motion does not show it), and at the full ratio again a moment after it stops, so every hold is sharp. The
  // ratio a machine needed is remembered and used from the first frame of the next move. Only in the story, whose
  // camera follows the scroll: the gallery and the retarget view turn on their own and keep the full ratio.
  govern(dt) {
    const cam = this.camera, k = this.camKey ??= new Float32Array(8), R = this.renderer;
    const now = [cam.position.x, cam.position.y, cam.position.z, cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w, cam.fov];
    let d = 0;
    for (let i = 0; i < 8; i++) { d += Math.abs(now[i] - k[i]); k[i] = now[i]; }
    const moving = d > 1e-4 && this.mode === 'story', floor = Math.max(0.75, this.restPR / 2);
    this.movePR = Math.min(this.movePR ?? this.restPR, this.restPR);
    if (moving) {
      this.stillFor = 0;
      if (!this.wasMoving) this.slowN = 0;
      else if (dt > 0.024) this.slowN += 1; else this.slowN = Math.max(0, this.slowN - 0.5);
      if (this.slowN >= 5 && this.movePR > floor) { this.movePR = Math.max(floor, this.movePR - 0.25); this.slowN = 0; }
      if (R.getPixelRatio() !== this.movePR) R.setPixelRatio(this.movePR);
    } else if ((this.stillFor = (this.stillFor ?? 0) + dt) > 0.25 && R.getPixelRatio() !== this.restPR) R.setPixelRatio(this.restPR);
    this.wasMoving = moving;
  }

  // ---------------------------------------------------------------- per frame
  frame() { return this.rec.f0 + (Math.floor(this.t * FPS) % this.rec.len); }
  tick(now) {
    this.raf = requestAnimationFrame((t) => this.tick(t));
    if (!this.loaded || !this.slot) return;
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    // a slow machine: after three seconds under ~30 fps, render at 1.5 px per CSS px (never lower: it blurs the scan)
    this.ft = this.ft == null ? dt : this.ft * 0.95 + dt * 0.05;
    if (this.ft > 0.034 && this.restPR > 1.5 && (this.slowFor = (this.slowFor ?? 0) + 1) > 180) { this.restPR = 1.5; if (this.renderer.getPixelRatio() > 1.5) this.renderer.setPixelRatio(1.5); }
    const cam = this.camera;
    this.govern(dt);
    let alpha = 1, showBody = true, showFrustum = true, showTrail = false, showHands = true, V = null;
    const hook = this.hooks[this.mode] ?? (this.mode === 'story' ? this.onFrame : null);
    if (this.mode === 'story') {
      if (!this.world.visible) {   // back from the gallery: the story's own scan, floor and cut
        this.world.visible = true; this.spaces?.forEach((p) => p.then((sp) => { sp.world.visible = false; }));
        this.grid.position.y = this.floorY - 0.003; this.setCut(CUT);
        this.galleryRec?.show({ alpha: 0 });   // (its floor ring hangs off the scene, not its scan)
      }
      alpha = this.storyFrame(this.story);   // (may change this.rec over)
      showTrail = alpha > 0;
      if (alpha > 0) this.t += dt * this.rate;
    } else if (this.mode === 'viewer') {
      // the story's edits of the scan stay neutral here (full colour, no wash, no trajectory); viewer.js sets the
      // camera, the clock and how lit each layer is
      this.splat.opacity = 1; this.setCut(CUT); this.litCol.setScalar(1);
      for (const c of this.litCyl) c.color = this.litCol;
      this.washSdf.radius = -0.6; this.scanPath.visible = false; this.scanHead = null;
      V = this.viewer?.frame(now, dt) ?? null;
    } else {
      // retarget (apps.js): the story's own scan in full colour, whatever the story and the gallery left; apps.js can
      // hold the clock (rtHold) and set it (this.t)
      const S = this.rtSrc ?? null;   // a home of the wall, or the story's own scan
      if (this.rtShown !== S || !(S ? S.sp.world : this.world).visible) {
        this.rtHide(this.rtShown === undefined ? null : this.rtShown ?? { rec: this.heroRec, A: this.robotA, B: this.robotB });
        this.world.visible = !S;
        for (const sp of this.spaceList ?? []) sp.world.visible = sp === S?.sp;
        this.grid.position.y = (S ? S.sp.floorY : this.floorY) - 0.003; this.galleryRec?.show({ alpha: 0 });
        this.rtShown = S;
      }
      if (!this.rtHold) this.t += dt * this.rate;
      this.splat.opacity = 1; this.setCut(30); this.litCol?.setScalar(1);
      for (const c of this.litCyl) c.color = this.litCol;
      this.washSdf.radius = -0.6; this.scanPath.visible = false; this.scanHead = null;
      this.trails.forEach((tr) => { tr.line.visible = false; });
      if (this.tween) {
        const w = smooth(span(now, this.tween.t0, this.tween.t0 + this.tween.dur));
        cam.position.lerpVectors(this.tween.p0, this.tween.pos, w);
        this.controls.target.lerpVectors(this.tween.l0, this.tween.look, w);
        cam.fov = lerp(this.tween.f0, this.tween.fov, w); cam.updateProjectionMatrix();
        if (w >= 1) this.tween = null;
      }
      this.controls.update();
    }
    const cur = this.mode === 'retarget' ? this.rtCur() : null;
    const hero = cur?.rec ?? null;   // the robots' own recording, whichever case the story is on
    if (hero && this.rec && this.rec !== hero) this.rec.show({ alpha: 0 });
    const rec = V ? V.rec : hero ?? this.rec;   // the gallery draws its own card's recording
    if (!rec) { this.draw(cam); if (hook) hook(-1, null); return; }
    const f = V?.f ?? rec.f0 + (Math.floor(this.t * FPS) % rec.len);   // (rec: in the retarget view not always this.rec)
    rec.raw = !!V?.raw;
    rec.setFrame(f);
    // retarget: the human or one robot on the same frame; the operator as the run saw it (operator_A)
    const robots = cur && cur.A && cur.B, RA = cur?.A, RB = cur?.B;
    rec.setOperatorA(RA ? RA.info.operator_A : null);
    if (robots) {
      // one body, or two either side of a seam (this.cmp = { l, r }: apps.js clips each to its side)
      const cmp = this.cmp, on = (e) => (cmp ? cmp.l === e || cmp.r === e : this.emb === e);
      RA.group.visible = on('A'); RB.group.visible = on('B');
      if (on('A')) RA.setFrame(f);
      if (on('B')) RB.setFrame(f);
      showBody = showHands = on('human'); showFrustum = on('human') && !cmp;
    } else if (this.robotA) { this.robotA.group.visible = this.robotB.group.visible = false; }
    if (V) rec.emphasis(V.levels);
    else rec.show({ alpha, body: showBody, hands: showHands, frustum: showFrustum, trail: showTrail });
    this.draw(cam);
    if (hook) hook(f, rec, alpha);
  }
}

// ---------------------------------------------------------------- the dining-table window of recording 7659f6d6
class Recording {
  constructor(E, base, meta, body, cam, hands, mesh, mj, faces, color = COL.past, space = E) {
    Object.assign(this, { E, base, meta, body, cam, hands, mesh, mj, K: meta.K });
    this.world = space.world; this.floorY = space.floorY;           // the scan it is registered to
    this.f0 = mj.f0; this.len = mj.f1 - mj.f0; this.cache = new Map(); this.bm = new Map();   // frame → promise, decoded bitmap
    this.raw = false;                                                // MANO as estimated (the ego view), not on the SMPL-H wrists
    this.group = new THREE.Group(); this.group.matrixAutoUpdate = false; this.world.add(this.group);
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
    const fl = this.frLines = new LineSegments2(lg, this.frMat); fl.frustumCulled = false; fl.renderOrder = 850;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(c.flatMap((p) => [p.x, p.y, p.z]), 3));
    // ImageBitmaps upload top row first whatever flipY says: pixel (0, 0) takes uv (0, 0)
    pg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2)); pg.setIndex([0, 3, 1, 1, 3, 2]);
    this.tex = new THREE.Texture(); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.flipY = false;
    this.imgMat = new THREE.MeshBasicMaterial({ map: this.tex, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false });
    const quad = this.quad = new THREE.Mesh(pg, this.imgMat); quad.frustumCulled = false; quad.renderOrder = 849;
    this.frustum = new THREE.Group(); this.frustum.matrixAutoUpdate = false; this.frustum.add(fl, quad); this.group.add(this.frustum);
    this.farMid = new THREE.Vector3((w / 2 - cx) / fx * d, (h / 2 - cy) / fy * d, d);   // centre of the frame, camera frame
    // head trail around the window
    this.trA = Math.max(0, this.f0 - 150); this.trB = Math.min(meta.frames - 1, this.f0 + this.len + 90);
    const tp = []; for (let f = this.trA; f <= this.trB; f++) tp.push(...this.camPos(f));
    this.trailFuture = E.fatPath(tp, COL.future, 1.6, 0.5); this.trailPast = E.fatPath(tp, new THREE.Color(color).getHex(), 3.2, 1);
    this.group.add(this.trailFuture, this.trailPast);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.335, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: COL.lime, transparent: true, side: THREE.DoubleSide }));
    this.ring.renderOrder = -6; E.scene.add(this.ring);
    this.caption = meta.caption;
    this.shown = -1; this.bitmap = null;
  }
  dispose() {
    this.show({ alpha: 0 });
    this.world.remove(this.group); this.E.scene.remove(this.ring);
    const mats = new Set([this.ring.material]);
    this.group.traverse((o) => { o.geometry?.dispose(); if (o.material) mats.add(o.material); });
    this.ring.geometry.dispose(); this.tex.dispose();
    mats.forEach((m) => m.dispose());
    this.E.lines = this.E.lines.filter((m) => !mats.has(m));
    this.cache.clear(); this.bm.forEach((b) => b.close?.()); this.bm.clear(); this.mesh = null;
  }
  camPos(f) { const c = this.cam, q = 7 * f; return [c[q], c[q + 1], c[q + 2]]; }
  image(f) {
    if (this.cache.has(f)) return this.cache.get(f);
    const p = fetch(`${this.base}frames/${pad5(f)}.jpg`).then((r) => r.blob()).then((b) => createImageBitmap(b))
      .then((bmp) => { if (this.cache.get(f) === p) this.bm.set(f, bmp); return bmp; }).catch(() => null);
    this.cache.set(f, p);
    if (this.cache.size > 90) { const k = this.cache.keys().next().value; this.cache.delete(k); this.bm.delete(k); }
    return p;
  }
  // the frame on the frustum's far plane: straight away when it is decoded, else once it is
  useImage(f) {
    const bmp = this.bm.get(f);
    if (bmp) { if (this.bitmap !== bmp) { this.tex.image = bmp; this.tex.needsUpdate = true; this.bitmap = bmp; this.bitmapF = f; } return; }
    this.image(f).then((b) => { if (b && this.shown === f) { this.tex.image = b; this.tex.needsUpdate = true; this.bitmap = b; this.bitmapF = f; } });
  }
  setOperatorA(A) {
    const key = A ? 'A' : '-';
    if (this._opKey === key) return;
    this._opKey = key;
    if (A) this.group.matrix.set(...A.flat()); else this.group.matrix.identity();
    this.group.matrixWorldNeedsUpdate = true;
  }
  setFrame(f) {
    const key = 2 * f + (this.raw ? 1 : 0);
    if (key === this.shownKey) return;
    this.shownKey = key; this.shown = f;
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
      const wo = o + 3 * (20 + s), wok = !this.raw && ok && (B[wo] !== 0 || B[wo + 1] !== 0 || B[wo + 2] !== 0);
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
    this.useImage(f);
    for (let k2 = 1; k2 <= 12; k2++) this.image(this.f0 + ((f - this.f0 + k2) % this.len));   // prefetch
    const p = new THREE.Vector3(B[o], B[o + 1], B[o + 2]).applyMatrix4(this.group.matrixWorld);
    this.ring.position.set(p.x, this.floorY + 0.004, p.z);
  }
  // view-frame anchors for labels: a joint, the head camera, the middle of its recorded frame
  joint(f, j) { const B = this.body, o = 156 * f + 3 * j; this.group.updateMatrixWorld(); return new THREE.Vector3(B[o], B[o + 1], B[o + 2]).applyMatrix4(this.group.matrixWorld); }
  hand(f, s) {   // the MANO middle-finger knuckle, snapped like the drawn hand
    const B = this.body, o = 156 * f + 3 * (20 + s), ho = (f * 2 + s) * 63;
    if (!Number.isFinite(this.hands[ho])) return null;
    const v = new THREE.Vector3(...[0, 1, 2].map((c) => this.hands[ho + 27 + c] - this.hands[ho + c] + B[o + c]));
    return v.applyMatrix4(this.group.matrixWorld);
  }
  headCam(f) { return this.camPosV(f).applyMatrix4(this.group.matrixWorld); }
  frameMid(f) { return this.farMid.clone().applyQuaternion(this.camQuat(f)).add(this.camPosV(f)).applyMatrix4(this.group.matrixWorld); }
  camPosV(f) { const c = this.cam, q = 7 * f; return new THREE.Vector3(c[q], c[q + 1], c[q + 2]); }
  camQuat(f) { const c = this.cam, q = 7 * f; return new THREE.Quaternion(c[q + 3], c[q + 4], c[q + 5], c[q + 6]); }
  show({ alpha, body = true, hands = true, frustum = true, trail = false }) {
    const on = alpha > 0.002;
    if (this.emph) this.unemphasise();
    this.bodyMesh.visible = on && body; this.skel.visible = on && body; this.handLines.visible = on && hands;
    this.frustum.visible = on && frustum; this.ring.visible = on && body;
    this.clip.constant = this.floorY - 0.05 + 2.1 * smooth(alpha);
    this.skel.material.opacity = 0.8 * alpha; this.handLines.material.opacity = alpha;
    this.frMat.opacity = alpha; this.imgMat.opacity = 0.95 * alpha; this.ring.material.opacity = 0.9 * alpha;
    this.trailPast.visible = this.trailFuture.visible = on && trail;
    this.trailPast.material.opacity = alpha; this.trailFuture.material.opacity = 0.45 * alpha;
  }
  // the viewer's layers, each from hidden (0) through at rest (~0.4) to lit (1). body: mesh, skeleton and floor ring;
  // hands: MANO; frustum: the head camera's lines; image: its recorded frame (in the ego view the camera sits at the
  // frustum's apex, so the frame on its far plane lies exactly over the render: drawn over the scan, under the hands);
  // trail: this recording's head path around the window
  emphasis({ body = 0, hands = 0, frustum = 0, image = 0, trail = 0, ego = false }) {
    this.emph = true;
    this.bodyMesh.visible = this.skel.visible = body > 0.01; this.ring.visible = body > 0.01 && !ego;
    this.bodyMat.color.copy(BODY_REST).lerp(BODY_LIT, smooth(clamp01(body)));
    this.bodyMat.emissive.copy(BODY_GLOW).multiplyScalar(smooth(clamp01((body - 0.5) * 2)));
    this.clip.constant = 1e3;
    this.skel.material.opacity = 0.85 * body; this.ring.material.opacity = 0.9 * body;
    this.handLines.visible = hands > 0.01; this.handLines.material.opacity = Math.min(1, 1.6 * hands);
    this.handLines.material.linewidth = 1.6 + 2.2 * hands;
    this.frustum.visible = frustum > 0.01 || image > 0.01; this.frLines.visible = frustum > 0.01;
    this.frMat.opacity = frustum; this.frMat.linewidth = 1.2 + 1.4 * frustum;
    this.imgMat.opacity = image; this.imgMat.depthTest = !ego; this.quad.renderOrder = ego ? 880 : 849;
    this.trailPast.visible = this.trailFuture.visible = trail > 0.01;
    this.trailPast.material.opacity = trail; this.trailFuture.material.opacity = 0.45 * trail;
  }
  unemphasise() {   // back to the story's look
    this.emph = false;
    this.bodyMat.color.setHex(COL.body); this.bodyMat.emissive.setHex(0);
    this.handLines.material.linewidth = 2.4; this.frMat.linewidth = 1.6; this.frLines.visible = true;
    this.imgMat.depthTest = true; this.quad.renderOrder = 849;
  }
  // the recorded head camera itself, as a three.js camera pose (OpenCV x right, y down, z forward → x right, y up,
  // z back), in the view frame; its vertical FOV is 2 atan(h / 2 fy)
  egoPose(f, pos = new THREE.Vector3(), quat = new THREE.Quaternion()) {
    this.group.updateMatrixWorld();
    _m.compose(this.camPosV(f), this.camQuat(f), _one).premultiply(this.group.matrixWorld).multiply(_flip);
    _m.decompose(pos, quat, _s);
    return { pos, quat };
  }
  // where things are over the window, on average (view frame): the hands, the head camera, the frame in front of it
  stats() {
    if (this._st) return this._st;
    this.world.updateMatrixWorld(true); this.group.updateMatrixWorld(true);
    const hands = new THREE.Vector3(), head = new THREE.Vector3(), mid = new THREE.Vector3(), chest = new THREE.Vector3();
    let n = 0, nh = 0;
    for (let f = this.f0; f < this.f0 + this.len; f += 3, n++) {
      head.add(this.headCam(f)); mid.add(this.frameMid(f)); chest.add(this.joint(f, 9));
      for (const s of [0, 1]) { const h = this.hand(f, s); if (h) { hands.add(h); nh++; } }
    }
    head.divideScalar(n); mid.divideScalar(n); chest.divideScalar(n); hands.divideScalar(Math.max(1, nh));
    return (this._st = { hands, head, mid, chest });
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
  constructor(E, world = E.world) { this.E = E; this.world = world; }
  // meshBase: where <name>_mesh.bin is, when it is another recording's (the same robot: one copy of its geometry for
  // every recording it is drawn in)
  async load(base, name, meshBase = base) {
    const url = `${meshBase}${name}_mesh.bin`;
    const [info, motion] = await Promise.all([json(`${base}${name}.json`), f32(`${base}${name}_motion.f32`)]);
    Object.assign(this, { info, motion, NG: info.geoms, n: info.f1 - info.f0 });
    if (!Robot.geos.has(url)) Robot.geos.set(url, fetchBytes(url).then((bin) => info.meshes.map((m) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin.buffer, m.v, 3 * m.nv), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bin.buffer, m.n, 3 * m.nv), 3));
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin.buffer, m.i, 3 * m.nf), 1));
      return g;
    })));
    const geos = await Robot.geos.get(url);
    const mats = [new THREE.MeshStandardMaterial({ color: 0xdfe3e9, roughness: 0.36, metalness: 0.12 }),
      new THREE.MeshStandardMaterial({ color: 0x33373e, roughness: 0.5, metalness: 0.3 })];
    const byRgb = new Map(), rgbMat = (c) => {
      const key = c.join(',');
      if (!byRgb.has(key)) byRgb.set(key, new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...c, THREE.SRGBColorSpace), roughness: 0.4, metalness: 0.12 }));
      return byRgb.get(key);
    };
    this.group = new THREE.Group(); this.group.visible = false; this.world.add(this.group);
    this.links = info.geom_mesh.map((mi, k) => {
      const m = new THREE.Mesh(geos[mi], info.rgb ? rgbMat(info.rgb[k]) : mats[info.tone[k]]);
      m.matrixAutoUpdate = false; m.frustumCulled = false; m.renderOrder = -5;
      this.group.add(m);
      return m;
    });
    return this;
  }
  dispose() {   // (the geometries are shared: they stay)
    this.world.remove(this.group);
    new Set(this.links.map((l) => l.material)).forEach((m) => m.dispose());
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
Robot.geos = new Map();   // mesh file → its geometries
const _rp = new THREE.Vector3(), _rq = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _flip = new THREE.Matrix4().makeRotationX(Math.PI);
// the viewer's body: blue-grey at rest, the story's blue lit, with a little glow of its own
const BODY_REST = new THREE.Color(0x4d5a6c), BODY_LIT = new THREE.Color(COL.body), BODY_GLOW = new THREE.Color(0x1a2c4a);
