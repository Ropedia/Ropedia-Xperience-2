// Real-to-Sim in free-view 3D (04 Applications): the simulator scene of LIVING_ROOM_14939_ANO as a mesh scene anyone can
// walk the camera through, playing the film's own physics run. tools/export_r2s3d.py writes its data from the Blender
// scene and the recording the film's pictures were rendered from: data/r2s3d/scene.glb (the scene at the run's first
// frame), run.bin + run.json (per frame: the prims the run moves, the points of the cover, the cushions and the towel,
// the water particles, the kinematic probes that press and pull), the scene's own lights and the object boxes.
// Picking an object (in the scene or in the list) flies the film's camera for it and loops its part of the run; the
// film's offline render of the same frames plays beside it, on the same clock. No 3D Gaussians here: the scan is the
// source of this scene, not a layer of it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const pad = (n, k) => String(n).padStart(k, '0');
const smooth = (u) => u * u * (3 - 2 * u);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const B = 'data/r2s3d/';
const CTYPE = { cloth: 'cloth', soft: 'soft', remote: 'button', switch: 'button', water: 'fluid', towel: 'cloth', fridge: 'joint' };
const pretty = (id) => { const s = id.replace(/^Tour_/, '').replace(/_(\d+)$/, ' $1').replace(/_/g, ' '); return s[0].toUpperCase() + s.slice(1); };

async function fetchBytes(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const total = Number(r.headers.get('Content-Length')) || 0;
  if (!r.body) return new Uint8Array(await r.arrayBuffer());
  const reader = r.body.getReader(), chunks = [];
  let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress?.(got, total); }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function start() {
  const stage = $('r3Stage'), canvas = $('r3Cv'), tip = $('r3Tip'), list = $('r3List');
  const R = await fetch(`${B}run.json`).then((r) => r.json());
  const TYPE = Object.fromEntries(R.types.map((t) => [t.key, t]));
  const T = R.seconds, N = R.frames;

  // ---------------------------------------------------------------- the page's side first: it works while the scene loads
  list.innerHTML = `<button type="button" data-c="" aria-pressed="true" style="--c:#f5f5f7"><b>The whole run</b><span>${T.toFixed(1)} s</span></button>` +
    R.clips.map((c) => `<button type="button" data-c="${c.id}" aria-pressed="false" style="--c:${TYPE[CTYPE[c.id]].color}"><b>${c.name}</b></button>`).join('');
  $('r3Legend').innerHTML = R.types.filter((t) => typeof t.n === 'number').map((t) => `<button type="button" data-t="${t.key}" style="--c:${t.color}">${t.name}<b>${t.n}</b></button>`).join('');
  $('r3Lanes').innerHTML = R.clips.map((c, k) => `<i data-c="${c.id}" title="${c.name}" style="left:${(100 * c.t[0] / T).toFixed(2)}%;width:${(100 * (c.t[1] - c.t[0]) / T).toFixed(2)}%;top:${4 + k * 5}px;--c:${TYPE[CTYPE[c.id]].color}"></i>`).join('');

  // view 'film': the camera is the film's own (its path through the run, or its camera for the picked object) whenever
  // nobody is steering; a drag takes over, and a few seconds after it ends the camera eases back. The other views stay put.
  const st = { t: 0, playing: !reduced, held: false, clip: null, boxes: false, type: null, hot: null, on: false, last: 0, active: false, tween: null, view: 'film', free: 0, steering: false, idleAt: 0 };

  // ---------------------------------------------------------------- renderer, light
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  // the look. With the film's light baked (run.json: gi, and for each of the page's lamps its strength in the film's
  // exposure, lights[].cd) everything is in the film's own units, and only the tone mapping's contrast and the
  // strength of the occlusion are set here, against the film's frames of the same views. Without it (an export with
  // --no-bake): the strength of a ceiling panel and of the strip, an even fill and the home's own bounce, set by eye
  const BAKED = !!R.gi;
  const LOOK = BAKED ? { exposure: 1, contrast: 1.3, fill: 0, env: 1, ao: 0.6 } : { exposure: 1.3, contrast: 1.3, lamp: 30, strip: 6, fill: 0.12, env: 1, ao: 1 };
  // tone mapping: AgX, as the film's renders, with their "medium high contrast" look. three's AgX is the base look, so
  // this is its own code with one line more (an S-curve on the encoded value), set as the renderer's custom tone mapping;
  // plain AgX if the shader chunk ever reads differently
  { const chunk = THREE.ShaderChunk.tonemapping_pars_fragment, agx = /vec3 AgXToneMapping\( vec3 color \) \{[\s\S]*?\n\}/.exec(chunk)?.[0];
    const mark = 'color = agxDefaultContrastApprox( color );', stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }', k = LOOK.contrast.toFixed(3);
    const ok = agx?.includes(mark) && chunk.includes(stub);
    if (ok) THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(stub, agx.replace('AgXToneMapping', 'CustomToneMapping').replace(mark, `${mark}\n\tcolor = clamp( color, 0.0, 1.0 ); color = pow( color, vec3( ${k} ) ) / ( pow( color, vec3( ${k} ) ) + pow( 1.0 - color, vec3( ${k} ) ) );`));
    renderer.toneMapping = ok ? THREE.CustomToneMapping : THREE.AgXToneMapping; renderer.toneMappingExposure = LOOK.exposure; }
  renderer.shadowMap.enabled = true;            // (each lamp's map is drawn again only when something it lights has moved: shade() below)
  renderer.transmissionResolutionScale = 0.5;   // (what shows through the glass is drawn at half size: a whole pass of the scene, for a bottle and a few glasses)
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0b0b0c);
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 80);
  // ambient occlusion in screen space (GTAO), multiplied over the finished picture: corners, undersides and contacts
  // darken. A short reach and thin occluders, or every fold of the curtains turns grey and each edge gets a halo
  const gtao = new GTAOPass(scene, camera, 2, 2); gtao.output = GTAOPass.OUTPUT.Off; gtao.normalMaterial.side = THREE.DoubleSide;
  gtao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 1, thickness: 0.5, scale: 1, samples: 16, distanceFallOff: 1 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 2, rings: 2, samples: 16 });   // (a small denoise radius: a wide one leaves grain)
  const aoQuad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tAO: { value: gtao.pdRenderTarget.texture }, k: { value: LOOK.ao } }, depthTest: false, depthWrite: false, toneMapped: false,
    blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // (the picture under it is already encoded for the screen, so the factor is too)
    fragmentShader: 'uniform sampler2D tAO; uniform float k; varying vec2 vUv; void main() { gl_FragColor = vec4(vec3(pow(mix(1.0, texture2D(tAO, vUv).r, k), 0.4545)), 1.0); }',
  }));
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.09, rotateSpeed: 0.6, zoomSpeed: 0.7, panSpeed: 0.7, enableZoom: false, minDistance: 0.25, maxDistance: 16, screenSpacePanning: true });
  canvas.style.touchAction = 'pan-y';
  controls.addEventListener('start', () => { st.tween = null; st.steering = true; st.free = 1; st.from = null; stage.classList.add('moved'); });
  controls.addEventListener('end', () => { st.steering = false; st.idleAt = performance.now(); });
  // the wheel belongs to the page until the scene is clicked; then it zooms, until the pointer leaves
  canvas.addEventListener('pointerdown', () => { st.active = true; controls.enableZoom = true; });
  stage.addEventListener('pointerleave', () => { st.active = false; controls.enableZoom = false; });

  const V3 = (a) => new THREE.Vector3(...a);
  const lo = V3(R.bounds[0]).min(V3(R.bounds[1])), hi = V3(R.bounds[0]).max(V3(R.bounds[1])), mid = lo.clone().add(hi).multiplyScalar(0.5), ceilY = hi.y;
  const VIEWS = {
    ...R.views,
    home: { pos: [mid.x, ceilY + Math.max(hi.x - lo.x, hi.z - lo.z) * 0.8, mid.z + 0.01], look: [mid.x, lo.y, mid.z], fov: 50 },
  };
  // light: the scene's own lamps (run.json; glTF carries no area lights), as far as a rasteriser goes. Each ceiling
  // panel that points straight down is a spot that casts shadows, the kitchen's from the moment its wall switch is
  // pressed, each as strong as the film has it (cd). The rest of the film's light is baked (gi, below); without a
  // bake, what walls and floor send back is a capture of the lit home itself (envs), over a faint even fill.
  if (LOOK.fill) scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, LOOK.fill));
  const panels = (R.lights ?? []).filter((l) => l.kind === 'area' && l.dir[1] < -0.95 && Math.min(...l.size) >= 1), flux = (l) => l.intensity * l.size[0] * l.size[1];
  const lamps = panels.map((l) => {
    // (63 degrees, full to half of that and fading from there: near the cosine lobe of a flat panel, and no wider than
    // its shadow map, 1 cm a texel on the floor: light a lamp gave outside its shadows would go through the walls)
    const s = new THREE.SpotLight(0xffffff, 0, 0, 1.1, 0.5, 2);
    s.position.fromArray(l.pos); s.target.position.fromArray(l.pos).add(V3(l.dir)); scene.add(s, s.target);
    s.castShadow = true; s.shadow.mapSize.set(1024, 1024); s.shadow.camera.near = 0.1; s.shadow.camera.far = 12;
    s.shadow.bias = -0.0006; s.shadow.normalBias = 0.03; s.shadow.radius = 2; s.shadow.autoUpdate = false;
    return { l, s, power: l.cd ?? LOOK.lamp * flux(l) / Math.max(...panels.map(flux)), at: -1, turn: 0 };   // (without a bake: as bright as its panel is next to the brightest)
  });
  // the strip under the wall cabinets: two spots along it, pointing down (no shadows: nothing hangs under it)
  const strips = (R.lights ?? []).filter((l) => l.kind === 'area' && l.dir[1] < -0.95 && Math.min(...l.size) < 0.2).flatMap((l) => [-0.25, 0.25].map((u) => {
    const s = new THREE.SpotLight(0xffffff, 0, 2.5, 1.4, 1, 2);
    s.position.fromArray(l.pos).addScaledVector(V3(l.axis), u * Math.max(...l.size)); s.target.position.copy(s.position).add(V3(l.dir)); scene.add(s, s.target);
    return { l, s, power: l.cd ?? LOOK.strip };
  }));
  const swT = Math.min(Infinity, ...lamps.filter((L) => L.l.on > 0).map((L) => L.l.on));
  let envs = null;
  // the film's light as a volume of probes (tools/bake_r2s3d.py, gi.bin): the irradiance of everything the lamps above
  // do not give directly, that is their own light after its first bounce and all the light of the film's other lamps,
  // on a grid through the whole home. A surface reads it where it is (a little off itself, along its normal and
  // towards the eye, so that it reads neither the probes inside the wall it belongs to nor, a curtain, those in the
  // dark behind it) and for the way it faces: colour * (1 + direction . n).
  // It takes the place of the environment's diffuse light. Volume 0 is with the run's lights as at its start, volume 1
  // what the lights the run switches on add
  const gi = R.gi && { A0: { value: null }, B0: { value: null }, A1: { value: null }, B1: { value: null }, k: { value: 0 },
    lo: { value: V3(R.gi.lo) }, inv: { value: V3(R.gi.dims.map((n) => 1 / (n * R.gi.step))) }, half: { value: V3(R.gi.dims.map((n) => 0.5 / n)) }, push: { value: 0.6 * R.gi.step } };
  const lit = new Set();
  const probeLight = (m) => {
    if (!gi || lit.has(m) || !m.isMeshStandardMaterial) return;
    lit.add(m);
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { giA0: gi.A0, giB0: gi.B0, giA1: gi.A1, giB1: gi.B1, giK: gi.k, giLo: gi.lo, giInv: gi.inv, giHalf: gi.half, giPush: gi.push });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGiP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGiP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGiP;\nuniform highp sampler3D giA0, giB0, giA1, giB1;\nuniform vec3 giLo, giInv, giHalf;\nuniform float giK, giPush;')
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        {
          vec3 gn = inverseTransformDirection( normal, viewMatrix );
          vec3 gp = ( vGiP + ( gn + normalize( cameraPosition - vGiP ) ) * giPush - giLo ) * giInv + giHalf;
          vec4 ga = texture( giA0, gp ); vec2 gb = texture( giB0, gp ).rg;
          iblIrradiance = ga.rgb * max( 0.0, 1.0 + dot( vec3( ga.a, gb ), gn ) );
          if ( giK > 0.0 ) { ga = texture( giA1, gp ); gb = texture( giB1, gp ).rg; iblIrradiance += giK * ga.rgb * max( 0.0, 1.0 + dot( vec3( ga.a, gb ), gn ) ); }
        }`);
    };
    m.customProgramCacheKey = () => 'gi';
  };
  const tOn = (dev) => R.events.find((e) => e.device === dev && e.on)?.time_s ?? Infinity;
  const T_TV = tOn('television');

  function goTo(v, jump) {
    const pos = V3(v.pos), look = V3(v.look);
    if (jump) { camera.position.copy(pos); controls.target.copy(look); camera.fov = v.fov; camera.updateProjectionMatrix(); st.tween = null; } else st.tween = { p0: camera.position.clone(), l0: controls.target.clone(), f0: camera.fov, pos, look, fov: v.fov, t0: performance.now(), dur: 1300 };
  }
  // the film's main camera at run time t; the picked object's camera, a little further back (its close-up plays in the inset)
  const _fp = new THREE.Vector3(), _fl = new THREE.Vector3();
  function filmPose(t) {
    if (st.clip) { const c = st.clip; _fl.fromArray(c.look); _fp.fromArray(c.pos).sub(_fl).multiplyScalar(1.4).add(_fl); return c.fov; }
    const P = R.path, ff = clamp(t * R.fps, 0, N - 1), i0 = Math.floor(ff), i1 = Math.min(N - 1, i0 + 1), u = ff - i0, a = i0 * 7, b = i1 * 7;
    _fp.set(P[a] + (P[b] - P[a]) * u, P[a + 1] + (P[b + 1] - P[a + 1]) * u, P[a + 2] + (P[b + 2] - P[a + 2]) * u);
    _fl.set(P[a + 3] + (P[b + 3] - P[a + 3]) * u, P[a + 4] + (P[b + 4] - P[a + 4]) * u, P[a + 5] + (P[b + 5] - P[a + 5]) * u);
    return P[a + 6] + (P[b + 6] - P[a + 6]) * u;
  }
  { const f = filmPose(0); goTo({ pos: _fp.toArray(), look: _fl.toArray(), fov: f }, true); }

  function resize() {
    const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    gtao.setSize(w, h);   // (in CSS pixels: half the picture's resolution on a 2x screen)
  }
  new ResizeObserver(resize).observe(stage); resize();

  // ---------------------------------------------------------------- the scene and the run
  const draco = new DRACOLoader().setDecoderPath('vendor/addons/libs/draco/gltf/');
  const setP = (u) => stage.style.setProperty('--p', `${Math.round(u * 100)}%`);
  const [glbBytes, runBytes, giBytes] = await Promise.all([fetchBytes(`${B}scene.glb`, (g, t) => setP(0.92 * g / Math.max(1, t))), fetchBytes(`${B}run.bin`), gi && fetchBytes(B + R.gi.file)]);
  if (gi) {
    const [nx, ny, nz] = R.gi.dims, n = nx * ny * nz, h = new Uint16Array(giBytes.buffer, giBytes.byteOffset, 12 * n);
    const tex = (o, ch) => { const t = new THREE.Data3DTexture(h.subarray(o * n, (o + ch) * n), nx, ny, nz); t.format = ch === 4 ? THREE.RGBAFormat : THREE.RGFormat; t.type = THREE.HalfFloatType; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
    gi.A0.value = tex(0, 4); gi.B0.value = tex(4, 2); gi.A1.value = tex(6, 4); gi.B1.value = tex(10, 2);
  }
  const gltf = await new GLTFLoader().setDRACOLoader(draco).parseAsync(glbBytes.buffer, B);
  setP(1);
  const world = gltf.scene; scene.add(world);
  const ceilings = R.ceiling.map((n) => world.getObjectByName(n)).filter(Boolean);
  let tvMats = [];
  world.traverse((o) => { if (o.isMesh) { o.frustumCulled = true; for (const m of [].concat(o.material)) if (/TVScreen/i.test(m.name) && !tvMats.includes(m)) tvMats.push(m); } });
  const buf = runBytes.buffer;
  const movers = R.movers.map((m) => ({ node: world.getObjectByName(m.node), pq: new Float32Array(buf, m.off, N * 7) })).filter((m) => m.node);
  const tl = new THREE.TextureLoader();
  const deform = R.deform.map((d) => {
    const g = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(d.verts * 3), 3); pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pos);
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, d.uv, d.verts * 2), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(buf, d.tri, d.tris * 3), 1));
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(...d.color), roughness: Math.max(0.6, d.roughness) });   // (one-sided: each is a closed shell, the cloth a thin one whose two faces would shadow each other)
    if (d.tex) { mat.color.set(0xffffff); mat.map = tl.load(B + d.tex); mat.map.colorSpace = THREE.SRGBColorSpace; mat.map.wrapS = mat.map.wrapT = THREE.RepeatWrapping; }
    probeLight(mat);
    const mesh = new THREE.Mesh(g, mat); mesh.matrixAutoUpdate = false; mesh.matrix.fromArray(d.matrix); mesh.frustumCulled = false;
    world.add(mesh);
    return { d, pos, g, mesh, q: new Uint16Array(buf, d.pos, N * d.verts * 3), at: -1 };
  });
  let water = null;
  if (R.water) {
    const W = R.water, max = Math.max(...W.counts), starts = []; let s = 0;
    for (const c of W.counts) { starts.push(s); s += c; }
    const g = new THREE.BufferGeometry(), pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3); pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pos); g.setDrawRange(0, 0);
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9fd4ff, size: 0.011, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false }));
    pts.frustumCulled = false; world.add(pts);
    water = { W, g, pos, starts, q: new Uint16Array(buf, W.off, s * 3), at: -1 };
  }
  const probeMat = new THREE.MeshBasicMaterial({ color: 0xccffa0, transparent: true, opacity: 0.55, depthWrite: false });
  const probes = R.probes.map((p) => {
    let g;
    if (p.shape === 'sphere') g = new THREE.SphereGeometry(p.size, 32, 16);
    else { g = new THREE.CylinderGeometry(p.size[0], p.size[0], p.size[1], 16); if (p.axis === 'x') g.rotateZ(Math.PI / 2); else if (p.axis === 'z') g.rotateX(Math.PI / 2); }
    const m = new THREE.Mesh(g, probeMat); m.visible = false; world.add(m);
    return { p, m, pos: new Float32Array(buf, p.off, N * 3) };
  });
  // the boxes: one set of 12 edges each
  const boxGroup = new THREE.Group(); world.add(boxGroup);
  const boxes = R.boxes.map((b) => {
    const g = new THREE.BoxGeometry(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]);
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: TYPE[b.type].color, transparent: true, opacity: 0.9, depthTest: false }));
    l.position.set((b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2); l.renderOrder = 10; l.visible = false;
    boxGroup.add(l);
    return { b, l, box: new THREE.Box3(V3(b.lo), V3(b.hi)), clip: R.clips.find((c) => c.anchor === b.id)?.id ?? null };
  });

  const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
  function apply(t) {
    const ff = clamp(t * R.fps, 0, N - 1), i0 = Math.floor(ff), i1 = Math.min(N - 1, i0 + 1), u = ff - i0;
    for (const { node, pq } of movers) {
      const a = i0 * 7, b = i1 * 7;
      node.position.set(pq[a] + (pq[b] - pq[a]) * u, pq[a + 1] + (pq[b + 1] - pq[a + 1]) * u, pq[a + 2] + (pq[b + 2] - pq[a + 2]) * u);
      node.quaternion.copy(_q0.set(pq[a + 3], pq[a + 4], pq[a + 5], pq[a + 6])).slerp(_q1.set(pq[b + 3], pq[b + 4], pq[b + 5], pq[b + 6]), u);
    }
    for (const D of deform) {
      if (D.at === ff) continue; D.at = ff;
      const { d, q } = D, n = d.verts * 3, A = D.pos.array, a = i0 * n, b = i1 * n;
      for (let c = 0; c < 3; c++) {
        const l = d.lo[c], s = (d.hi[c] - d.lo[c]) / 65535;
        for (let k = c; k < n; k += 3) A[k] = l + (q[a + k] + (q[b + k] - q[a + k]) * u) * s;
      }
      D.pos.needsUpdate = true; D.g.computeVertexNormals();
    }
    if (water && water.at !== i0) {
      water.at = i0;
      const { W, q, starts } = water, c = W.counts[i0], A = water.pos.array, o = starts[i0] * 3;
      for (let k = 0; k < c * 3; k++) { const ax = k % 3; A[k] = W.lo[ax] + q[o + k] / 65535 * (W.hi[ax] - W.lo[ax]); }
      water.pos.needsUpdate = true; water.g.setDrawRange(0, c);
    }
    for (const { p, m, pos } of probes) {
      m.visible = t >= p.t[0] && t <= p.t[1];
      if (m.visible) m.position.set(pos[i0 * 3] + (pos[i1 * 3] - pos[i0 * 3]) * u, pos[i0 * 3 + 1] + (pos[i1 * 3 + 1] - pos[i0 * 3 + 1]) * u, pos[i0 * 3 + 2] + (pos[i1 * 3 + 2] - pos[i0 * 3 + 2]) * u);
    }
    for (const L of lamps) L.s.intensity = t >= L.l.on ? L.power : 0;
    for (const L of strips) L.s.intensity = t >= L.l.on ? L.power : 0;
    if (envs) scene.environment = envs[t >= swT ? envs.length - 1 : 0];
    if (gi) gi.k.value = t >= swT ? 1 : 0;
    for (const m of tvMats) { m.emissive.setRGB(0.3, 0.5, 0.85); m.emissiveIntensity = t >= T_TV ? 0.9 : 0; }
  }

  // ---------------------------------------------------------------- the film's render of the picked object, on the same clock
  const fig = $('r3Clip'), fcv = fig.querySelector('canvas'), fctx = fcv.getContext('2d'), stills = new Map();
  function still(c, t) {
    let k = 0; const r = t * 30;
    while (k < c.rec.length - 1 && Math.abs(c.rec[k + 1] - r) <= Math.abs(c.rec[k] - r)) k++;
    const key = `${c.id}/${c.frames[k]}`;
    let im = stills.get(key);
    if (!im) { im = new Image(); im.decoding = 'async'; im.src = `data/r2s/cards/${c.id}/${pad(c.frames[k], 5)}.jpg`; stills.set(key, im); }
    if (im.complete && im.naturalWidth) { fctx.drawImage(im, 0, 0, fcv.width, fcv.height); c.shown = im; } else if (c.shown) fctx.drawImage(c.shown, 0, 0, fcv.width, fcv.height);
  }
  function pick(id, fly = true) {
    const c = R.clips.find((x) => x.id === id) ?? null;
    st.clip = c;
    for (const b of list.children) b.setAttribute('aria-pressed', b.dataset.c === (c ? c.id : ''));
    for (const l of $('r3Lanes').children) l.classList.toggle('on', !c || l.dataset.c === c.id);
    fig.hidden = !c;
    if (c) {
      st.t = c.t[0]; setPlay(true);
      fig.querySelector('b').textContent = c.name; fig.querySelector('span').textContent = c.sub;
      for (let k = 0; k < c.frames.length; k++) { const key = `${c.id}/${c.frames[k]}`; if (!stills.has(key)) { const im = new Image(); im.src = `data/r2s/cards/${c.id}/${pad(c.frames[k], 5)}.jpg`; stills.set(key, im); } }
      if (fly) setView('film');
    }
  }
  list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { pick(b.dataset.c); setView('film'); } });

  // ---------------------------------------------------------------- views, boxes, hover
  const views = $('r3Views');
  function setView(v) {
    st.view = v; for (const b of views.children) b.setAttribute('aria-pressed', b.dataset.v === v);
    if (v === 'film') { st.tween = null; st.free = 1; st.from = null; st.steering = false; st.idleAt = -1e9; } else goTo(VIEWS[v]);   // (film: ease over from wherever the camera is)
  }
  views.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { if (st.clip) pick('', false); setView(b.dataset.v); } });
  $('r3BoxT').addEventListener('click', (e) => { st.boxes = !st.boxes; e.currentTarget.setAttribute('aria-pressed', st.boxes); });
  for (const b of $('r3Legend').children) {
    const set = (on) => { st.type = on ? b.dataset.t : null; };
    b.addEventListener('pointerenter', () => set(true)); b.addEventListener('pointerleave', () => set(false));
    b.addEventListener('focus', () => set(true)); b.addEventListener('blur', () => set(false));
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hitP = new THREE.Vector3();
  function boxAt(e) {   // the box the pointer is on: the nearest one the ray enters, a smaller one inside it first
    const r = stage.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2);
    ray.setFromCamera(ndc, camera);
    let best = null, bd = Infinity;
    for (const x of boxes) {
      if (!ray.ray.intersectBox(x.box, hitP)) continue;
      const size = x.box.getSize(new THREE.Vector3()), d = hitP.distanceTo(camera.position) + Math.cbrt(size.x * size.y * size.z) * 0.9;   // (big furniture gives way to what sits on it)
      if (Math.max(size.x, size.y, size.z) > 3.2) continue;
      if (d < bd) { bd = d; best = x; }
    }
    return best;
  }
  let moved = 0, downAt = null;
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) { moved += Math.abs(e.movementX) + Math.abs(e.movementY); tip.hidden = true; return; }
    const x = boxAt(e); st.hot = x;
    canvas.style.cursor = x?.clip ? 'pointer' : '';
    if (!x) { tip.hidden = true; return; }
    const r = stage.getBoundingClientRect();
    tip.innerHTML = `${pretty(x.b.id)}<span>${TYPE[x.b.type].name}</span>${x.clip ? '<em>Click to run its physics</em>' : ''}`;
    tip.style.setProperty('--c', TYPE[x.b.type].color);
    tip.style.left = `${clamp(e.clientX - r.left, 100, r.width - 100)}px`; tip.style.top = `${Math.max(74, e.clientY - r.top)}px`; tip.hidden = false;
  });
  canvas.addEventListener('pointerleave', () => { st.hot = null; tip.hidden = true; });
  canvas.addEventListener('pointerdown', (e) => { moved = 0; downAt = e; });
  canvas.addEventListener('pointerup', (e) => { if (downAt && moved < 6) { const x = boxAt(e); if (x?.clip) pick(x.clip); } downAt = null; });

  // ---------------------------------------------------------------- clock
  const play = $('r3Play'), bar = $('r3Scrub'), head = $('r3Head'), clock = $('r3Clock');
  function setPlay(p) { st.playing = p; play.classList.toggle('paused', !p); play.setAttribute('aria-label', p ? 'Pause' : 'Play'); }
  play.addEventListener('click', () => setPlay(!st.playing));
  const at = (e) => { const r = bar.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) * T; };
  bar.addEventListener('pointerdown', (e) => {
    const lane = e.target.closest('i[data-c]');
    if (lane && (!st.clip || st.clip.id !== lane.dataset.c)) { pick(lane.dataset.c); return; }
    bar.setPointerCapture(e.pointerId); st.held = true; st.t = at(e); e.preventDefault();
  });
  bar.addEventListener('pointermove', (e) => { if (bar.hasPointerCapture(e.pointerId)) st.t = at(e); });
  const end = (e) => { if (bar.hasPointerCapture(e.pointerId)) { bar.releasePointerCapture(e.pointerId); st.held = false; } };
  bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
  bar.addEventListener('keydown', (e) => { const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0; if (d) { st.t = clamp(st.t + d * 0.2, 0, T); e.preventDefault(); } });

  // ---------------------------------------------------------------- shadows, and the light the home sends back
  // who casts a shadow: everything but glass, the ceilings, the scene's 1,231 thin tubes (stems, cords: over half the
  // draw calls of a shadow map, for shadows a few millimetres wide) and what hangs right under a lamp (a point of light
  // would throw its fixture's shadow across the room; the panel it stands for does not)
  world.updateMatrixWorld(true);
  const plain = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6 }), glow = new THREE.MeshBasicMaterial({ color: 0xfff1dc });
  const noAO = probes.map((x) => x.m);
  { const b = new THREE.Box3(), c = new THREE.Vector3();
    world.traverse((o) => {
      if (!o.isMesh) return;
      if (/Emitter/.test(o.name)) o.material = glow;                                                              // the bulbs
      else if (!o.material.name && o.material.metalness === 1 && o.material.roughness === 1) o.material = plain;   // no material in the scene: matte grey, as in the film's render
      probeLight(o.material);
      const glass = [].concat(o.material).some((m) => m.transmission > 0 || m.transparent || m.isMeshBasicMaterial);
      if (glass && !noAO.includes(o)) noAO.push(o);
      const soft = o.geometry.attributes.position.usage === THREE.DynamicDrawUsage;   // (a mesh the run deforms has no points yet: a box taken now would stay with it, at its origin)
      if (!soft) b.setFromObject(o).getCenter(c);
      const fixture = !soft && lamps.some(({ s }) => b.min.y > s.position.y - 0.9 && Math.hypot(c.x - s.position.x, c.z - s.position.z) < 0.8);
      o.receiveShadow = !glass; o.castShadow = !glass && !fixture && !/^tube_/.test(o.name) && !ceilings.some((x) => x === o || x === o.parent);
    }); }
  // the things the run moves, each with the frames that moved it (by 3 mm or more since the last that counted: a
  // shadow texel is 1 cm; a soft body at rest still trembles by less)
  const stir = (far) => { const c = new Uint8Array(N); let ref = 0; for (let k = 1; k < N; k++) if (far(ref, k)) { c[k] = 1; ref = k; } return c; };
  const things = [
    ...movers.map(({ node, pq }) => ({ own: node, box: (b) => b.setFromObject(node),
      c: stir((a, b) => { for (let j = 0; j < 7; j++) if (Math.abs(pq[a * 7 + j] - pq[b * 7 + j]) > (j < 3 ? 3e-3 : 1.5e-3)) return true; return false; }) })),
    ...deform.map(({ d, q, pos, mesh }) => {
      const n = d.verts * 3, th = [0, 1, 2].map((c) => 3e-3 * 65535 / Math.max(1e-9, d.hi[c] - d.lo[c]));
      return { own: mesh, box: (b) => b.setFromBufferAttribute(pos).applyMatrix4(mesh.matrixWorld),
        c: stir((a, b) => { for (let j = 0; j < n; j++) if (Math.abs(q[a * n + j] - q[b * n + j]) > th[j % 3]) return true; return false; }) };
    }),
  ];
  // a lamp's shadows change with a thing if, at the start, the middle or the end of the run, the lamp has a clear line,
  // inside its shadow cone, to the thing's middle or towards one of its corners (walls and furniture stop the rest; only
  // meshes of under 2,000 triangles are asked). Per lamp: how many frames up to each one moved something it lights
  { const owned = (o) => { for (; o; o = o.parent) if (things.some((x) => x.own === o)) return true; return false; };
    const stops = []; world.traverse((o) => { if (o.isMesh && o.castShadow && (o.geometry.index ?? o.geometry.attributes.position).count < 6000 && !owned(o)) stops.push(o); });
    const ray = new THREE.Raycaster(), b = new THREE.Box3(), c = new THREE.Vector3(), q = new THREE.Vector3(), dir = new THREE.Vector3();
    for (const L of lamps) L.sees = new Set();
    for (const t of [0, T / 2, T]) {
      apply(t); world.updateMatrixWorld(true);
      for (const x of things) {
        x.box(b).getCenter(c);
        const pts = [c.clone()];
        for (let k = 0; k < 8; k++) pts.push(q.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).lerp(c, 0.2).clone());
        for (const L of lamps) {
          if (L.sees.has(x)) continue;
          for (const pt of pts) {
            const len = dir.subVectors(pt, L.s.position).length(); dir.divideScalar(len);
            if (-dir.y < Math.cos(L.s.angle * L.s.shadow.focus)) continue;
            ray.set(L.s.position, dir); ray.far = len - 0.05;
            if (!ray.intersectObjects(stops, false).length) { L.sees.add(x); break; }
          }
        }
      }
    }
    for (const L of lamps) { L.pre = new Uint32Array(N); for (let k = 1; k < N; k++) { L.pre[k] = L.pre[k - 1]; for (const x of L.sees) L.pre[k] += x.c[k]; } }
  }
  // a lit lamp's shadows are drawn again only when something it lights has moved since they were drawn, and then one
  // lamp a frame, the one that has waited longest (all of them at once only for the captures below)
  let turns = 0;
  function shade(t, all) {
    const ff = clamp(t * R.fps, 0, N - 1);
    let next = null;
    for (const L of lamps) {
      if (!L.s.intensity || !(L.at < 0 || (ff !== L.at && L.pre[Math.ceil(Math.max(ff, L.at))] > L.pre[Math.floor(Math.min(ff, L.at))]))) continue;
      if (all) { L.s.shadow.needsUpdate = true; L.at = ff; } else if (!next || L.turn < next.turn) next = L;
    }
    if (next) { next.s.shadow.needsUpdate = true; next.at = ff; next.turn = ++turns; }
  }
  // what the home sends back, for every reflection (and, without the baked light, for the ambient light: then taken
  // twice, the lamps alone and with their first bounce): the lit scene seen from where the film's camera stands in the
  // living room, with the kitchen lights off and with them on
  { const pm = new THREE.PMREMGenerator(renderer), cube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.05, 40, cube); cam.position.fromArray(VIEWS.living.pos);
    scene.environmentIntensity = LOOK.env;
    const got = [0, swT].filter(Number.isFinite).map((t) => {
      apply(t); shade(t, true); scene.environment = null;
      let rt = null;
      for (let k = 0; k < (BAKED ? 1 : 2); k++) { cam.update(renderer, scene); const e = pm.fromCubemap(cube.texture); rt?.dispose(); rt = e; scene.environment = e.texture; }
      return rt.texture;
    });
    envs = got; cube.dispose(); pm.dispose(); }

  // a machine that cannot hold 25 frames a second gets a lighter picture, one step at a time: fewer pixels, then no
  // occlusion pass, then fewer pixels again
  const lighter = [];
  if (renderer.getPixelRatio() > 1.5) lighter.push(() => renderer.setPixelRatio(1.5));
  lighter.push(() => { aoQuad.material.uniforms.k.value = 0; });
  if (renderer.getPixelRatio() > 1) lighter.push(() => renderer.setPixelRatio(1));
  let pace = 16, slow = 0;

  function tick(now) {
    if (!st.on) return; requestAnimationFrame(tick);
    const gap = now - st.last, dt = Math.min(0.1, gap / 1000); st.last = now;
    if (gap < 250 && lighter.length) {   // (a longer gap is a stall or a hidden tab, not the frame rate)
      pace += (gap - pace) * 0.05; slow = pace > 40 ? slow + gap : 0;
      if (slow > 1500) { lighter.shift()(); resize(); slow = 0; pace = 16; }
    }
    const [a, b] = st.clip ? st.clip.t : [0, T];
    if (st.playing && !st.held) { st.t += dt; if (st.t > b + 0.7) st.t = a; }   // a breath on the last frame, then again
    if (!st.held && st.clip) st.t = Math.max(a, st.t);
    const t = clamp(st.t, 0, st.held ? T : b);
    apply(t);
    if (st.clip) still(st.clip, t);
    if (st.tween) {
      const w = smooth(clamp((now - st.tween.t0) / st.tween.dur, 0, 1));
      camera.position.lerpVectors(st.tween.p0, st.tween.pos, w); controls.target.lerpVectors(st.tween.l0, st.tween.look, w);
      camera.fov = st.tween.f0 + (st.tween.fov - st.tween.f0) * w; camera.updateProjectionMatrix();
      if (w >= 1) st.tween = null;
    }
    if (st.view === 'film' && !st.steering && (st.free === 0 || now - st.idleAt > 3500)) {
      // nobody steering: on the film's camera; after a drag, back to it over a second or so from where the drag left it
      const f = filmPose(t);
      if (st.free > 0) {
        st.from ??= { p: camera.position.clone(), l: controls.target.clone(), f: camera.fov };
        st.free = Math.max(0, st.free - dt / 1.3);
        const w = smooth(1 - st.free);
        camera.position.lerpVectors(st.from.p, _fp, w); controls.target.lerpVectors(st.from.l, _fl, w); camera.fov = st.from.f + (f - st.from.f) * w;
      } else { camera.position.copy(_fp); controls.target.copy(_fl); camera.fov = f; }
      camera.updateProjectionMatrix();
    }
    controls.update();
    const above = camera.position.y > ceilY - 0.25;     // from above, the home without its ceilings
    for (const c of ceilings) c.visible = !above;
    for (const x of boxes) {
      const on = st.type ? x.b.type === st.type : st.boxes || st.hot === x || (st.clip && x.clip === st.clip.id);
      x.l.visible = !!on; x.l.material.opacity = st.hot === x || (st.clip && x.clip === st.clip.id) ? 1 : 0.55;
    }
    shade(t);
    renderer.render(scene, camera);
    if (aoQuad.material.uniforms.k.value > 0) {   // (glass and the probes stay out of it)
      const vis = noAO.map((o) => o.visible); for (const o of noAO) o.visible = false;
      gtao.render(renderer);
      noAO.forEach((o, k) => { o.visible = vis[k]; });
      renderer.setRenderTarget(null); renderer.autoClear = false; aoQuad.render(renderer); renderer.autoClear = true;
    }
    head.style.left = `${100 * t / T}%`; bar.setAttribute('aria-valuenow', Math.round(100 * t / T));
    clock.textContent = `${t.toFixed(1)} s`;
  }
  apply(0); shade(0, true);
  stage.classList.add('ready');
  new IntersectionObserver((es) => {
    const on = es[es.length - 1].isIntersecting;
    if (on && !st.on) { st.on = true; st.last = performance.now(); requestAnimationFrame(tick); } else st.on = on;
  }, { threshold: 0.05 }).observe(stage);
  window.__r3 = { st, R, camera, controls, scene, renderer, pick, setView, world, lamps, gtao, aoQuad, lighter };   // for checks from the console
}

const host = document.getElementById('ap-r2s');
if (host && document.getElementById('r3Stage')) {
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start().catch((e) => { console.error(e); document.getElementById('r3Stage').classList.add('failed'); }); } }, { rootMargin: '100% 0px' });
  io.observe(host);
}
