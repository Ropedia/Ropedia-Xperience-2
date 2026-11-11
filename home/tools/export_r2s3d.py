"""The Real-to-Sim scene of LIVING_ROOM_14939_ANO for the homepage's free-view 3D (apps.js): the simulator scene as one
Draco-compressed GLB, and the film's physics run (rec4/full, the one every picture of the film was rendered from) as
animation data. Runs in Blender on the scene the film's renders use (see video/flythrough/tools/r2s14939/README.md):

  cd /mnt/local/lihao/xperience_video_r2s
  /mnt/local/lihao/blender/blender-5.2.2-linux-x64/blender -b scene14939.blend \
      -P /mnt/local/lihao/xperience_website/website/home/tools/export_r2s3d.py -- --out /mnt/local/lihao/xperience_website/website/home/data/r2s3d

Writes into --out:
  scene.glb   every mesh at the run's first frame (settled), none of them simplified; the scene's curves (the faucet
              spout, plant stems, lamp cords, yarn loops: tubes along a line in the USD) as tube meshes of their own
              radius; textures at most 1024 px WebP; no lights. The prims the run moves are root nodes named mv_<k>;
              the meshes it deforms are not in the file (they come from run.bin).
  run.bin     per exported frame (every other frame of the 30 Hz run): position and quaternion of each moving prim, the
              points of each deforming mesh (uint16 in the mesh's own bounds; in full, except the TV cover, whose
              128k points are reduced to about 15k, each following its nearest point of the full mesh), the water particles, the probes (the kinematic fingers, palm and jaws)
  run.json    the index of run.bin, the power events, the scene's lights, the object boxes, the film's camera for each
              interaction
  tex_*.jpg   the base-colour textures of the deforming meshes
  gi.bin      the film's light as a volume of probes (bake_r2s3d.py)
Everything is in glTF axes (y up): p = (x, z, -y) of the simulator's world.
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--rec', default='/mnt/local/lihao/xperience_video_r2s/rec4/full')
ap.add_argument('--step', type=int, default=2)
ap.add_argument('--no-glb', action='store_true')
ap.add_argument('--no-bake', action='store_true', help='leave the film\'s light out of the scene (the page then falls back on its own ambient light)')
ap.add_argument('--rebake', action='store_true', help='bake again even if the work folder has a bake on this grid')
ap.add_argument('--bake-samples', type=int, default=512)
ap.add_argument('--gpus', default='0', help='comma list of the GPUs Cycles bakes on')
ap.add_argument('--probe', type=float, default=0.15, help='the light probes of the bake are this far apart (m)')
a = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
OUT = Path(a.out); OUT.mkdir(parents=True, exist_ok=True)
WORK = Path('/mnt/local/lihao/xperience_video_r2s')
SITE = Path(__file__).resolve().parents[1]
CARDS = SITE.parents[1] / 'video/metrics/data/r2s'

blend = Path(bpy.data.filepath)
names = json.loads(blend.with_name(blend.stem + '_usd_paths.json').read_text())
by_path, by_leaf = {}, {}
strip = re.compile(r'\.\d{3,}$')
for n, p in names.items():
    ob = bpy.data.objects.get(n)
    if ob is not None:
        by_path.setdefault(p, []).append(ob)
        by_leaf.setdefault(strip.sub('', n), []).append(ob)
usd = lambda M: Matrix(np.asarray(M, np.float64).T.tolist())


def resolve(path, M0=None, npts=None):   # as render_r2s.py
    c = [o for o in by_path.get(path, []) if o.type == 'MESH']
    if len(c) == 1:
        return c[0]
    c = [o for o in by_leaf.get(path.rsplit('/', 1)[-1], []) if o.type == 'MESH'] or c
    if npts is not None:
        c = [o for o in c if len(o.data.vertices) == npts] or c
    if M0 is not None and len(c) > 1:
        T = usd(M0)
        c.sort(key=lambda o: sum(abs(x) for r in (o.matrix_world - T) for x in r))
    return c[0] if c else None


meta = json.loads(Path(a.rec + '.json').read_text())
rec = np.load(a.rec + '.npz')
F = meta['frames']
FR = list(range(0, F, a.step))
xf = rec['xf']
C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))   # simulator (z up) -> glTF (y up)
Ci = C.inverted()
gl = lambda p: [float(p[0]), float(p[2]), float(-p[1])]

# every mesh in world space, without its parents (the exporter then writes one root node per mesh)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
world = {o.name: o.matrix_world.copy() for o in meshes}
for o in meshes:
    o.parent = None
for o in meshes:
    o.matrix_world = world[o.name]
bpy.context.view_layer.update()

# ---------------------------------------------------------------- the run: moving prims and deforming meshes
movers = []
for k, p in enumerate(meta['xf_paths']):
    ob = resolve(p, xf[0, k])
    if ob is None:
        continue
    ob.matrix_world = usd(xf[0, k])
    if np.abs(xf[:, k] - xf[:1, k]).max() >= 2e-3:
        movers.append((ob, k))
deform = []
for i, p in enumerate(meta['pt_paths']):
    arr = rec[f'pt_{i}']
    ob = resolve(p, None, arr.shape[1])
    if ob is None or len(ob.data.vertices) != arr.shape[1]:
        print('R2S3D_WARN unresolved', p); continue
    if ob.data.users > 1:
        ob.data = ob.data.copy()
    ob.data.vertices.foreach_set('co', np.ascontiguousarray(arr[0], np.float32).ravel()); ob.data.update()
    if np.abs(arr - arr[:1]).max() >= 0.03:      # the cover, the pressed cushions, the towel on the door
        deform.append((ob, i))
print('R2S3D movers', [o.name for o, _ in movers], 'deform', [o.name for o, _ in deform], flush=True)

blob = bytearray()


def put(arr):
    while len(blob) % 4:
        blob.append(0)
    off = len(blob); blob.extend(np.ascontiguousarray(arr).tobytes())
    return off


index = {'fps': meta['fps'] / a.step, 'frames': len(FR), 'seconds': (FR[-1]) / meta['fps'], 'movers': [], 'deform': [], 'probes': []}
for n, (ob, k) in enumerate(movers):
    ob.name = f'mv_{n}'
    pq = np.zeros((len(FR), 7), np.float32)
    for j, f in enumerate(FR):
        loc, rot, _ = (C @ usd(xf[f, k]) @ Ci).decompose()
        pq[j] = [loc.x, loc.y, loc.z, rot.x, rot.y, rot.z, rot.w]
    index['movers'].append({'node': ob.name, 'prim': meta['xf_paths'][k], 'off': put(pq)})

# deforming meshes: a decimated copy whose vertices each follow the nearest vertex of the full mesh
DEC = {'TV_cover_physical_grid': 30000}   # triangles; every other deforming mesh in full
dg = bpy.context.evaluated_depsgraph_get()
for ob, i in deform:
    arr = rec[f'pt_{i}']
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    target = DEC.get(strip.sub('', ob.name), 10 ** 9)
    tmp = ob.copy(); tmp.data = ob.data.copy(); bpy.context.scene.collection.objects.link(tmp)
    tmp.modifiers.new('tri', 'TRIANGULATE')
    if tris > target:
        tmp.modifiers.new('dec', 'DECIMATE').ratio = target / tris
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    me = tmp.evaluated_get(dg).to_mesh()
    nv = len(me.vertices)
    co = np.zeros(nv * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    me.calc_loop_triangles()
    tri = np.zeros(len(me.loop_triangles) * 3, np.int32); me.loop_triangles.foreach_get('vertices', tri)
    uv = np.zeros((nv, 2), np.float32)
    if me.uv_layers:
        luv = np.zeros(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get('uv', luv)
        lv = np.zeros(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', lv)
        uv[lv] = luv.reshape(-1, 2)
    kd = KDTree(arr.shape[1])
    for vi, p in enumerate(arr[0]):
        kd.insert(p, vi)
    kd.balance()
    src = np.array([kd.find(p)[1] for p in co], np.int64)
    P = arr[FR][:, src]                                   # (frames, nv, 3), the mesh's own frame (simulator axes)
    P = np.stack([P[..., 0], P[..., 2], -P[..., 1]], -1)
    lo, hi = P.reshape(-1, 3).min(0), P.reshape(-1, 3).max(0)
    q = np.round((P - lo) / np.maximum(hi - lo, 1e-9) * 65535).astype(np.uint16)
    # material: base colour and its texture
    col, tex, rough = [0.8, 0.8, 0.8], None, 0.8
    m = ob.data.materials[0] if ob.data.materials else None
    bsdf = next((nd for nd in m.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED'), None) if m and m.use_nodes else None
    if bsdf:
        col = list(bsdf.inputs['Base Color'].default_value)[:3]; rough = float(bsdf.inputs['Roughness'].default_value)
        lk = bsdf.inputs['Base Color'].links
        nd = lk[0].from_node if lk else None
        if nd is not None and nd.type == 'TEX_IMAGE' and nd.image:
            im = nd.image.copy()
            if max(im.size) > 1024:
                s = 1024 / max(im.size); im.scale(max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s)))
            tex = f'tex_{i}.jpg'
            im.filepath_raw = str(OUT / tex); im.file_format = 'JPEG'; im.save()
    index['deform'].append({
        'name': strip.sub('', ob.name), 'prim': meta['pt_paths'][i], 'verts': nv, 'tris': len(tri) // 3,
        'matrix': [x for col_ in (C @ ob.matrix_world @ Ci).transposed() for x in col_],   # column-major, as three.js
        'lo': lo.tolist(), 'hi': hi.tolist(), 'color': col, 'roughness': rough, 'tex': tex,
        'tri': put(tri.astype(np.uint32)), 'uv': put(uv), 'pos': put(q)})
    tmp.evaluated_get(dg).to_mesh_clear()
    bpy.data.objects.remove(tmp)
    print('R2S3D deform', ob.name, nv, len(tri) // 3, tex, flush=True)

# water: particles keep their index and only ever get more
cnt = [int(rec[f'water_{f}'].shape[0]) if f'water_{f}' in rec.files else 0 for f in FR]
allw = np.concatenate([rec[f'water_{f}'] for f, c in zip(FR, cnt) if c]) if any(cnt) else np.zeros((0, 3), np.float32)
if len(allw):
    W = np.stack([allw[:, 0], allw[:, 2], -allw[:, 1]], -1)
    lo, hi = W.min(0), W.max(0)
    index['water'] = {'counts': cnt, 'lo': lo.tolist(), 'hi': hi.tolist(), 'off': put(np.round((W - lo) / np.maximum(hi - lo, 1e-9) * 65535).astype(np.uint16))}
for pr in meta['probes']:
    P = rec['probe_' + pr['name']][FR]                    # (frames, 4, 4), row-vector convention: translation in row 3
    keys = pr.get('keys') or []
    t_on, t_off = 0.0, 1e9
    if keys:
        k0 = np.array(keys[0][1])
        moving = [kt for kt, kp in keys if np.linalg.norm(np.array(kp) - k0) > 1e-4]
        if moving:
            t_on = max(0.0, keys[[kt for kt, _ in keys].index(moving[0]) - 1][0] - 0.25)
        if np.linalg.norm(np.array(keys[-1][1]) - k0) < 1e-4:
            t_off = keys[-1][0] - 0.25
    pos = np.stack([P[:, 3, 0], P[:, 3, 2], -P[:, 3, 1]], -1).astype(np.float32)
    index['probes'].append({'name': pr['name'], 'shape': pr['shape'], 'size': pr['size'], 'axis': {'X': 'x', 'Y': 'z', 'Z': 'y'}[pr.get('axis', 'Z')],
                            't': [t_on, min(t_off, 1e6)], 'off': put(pos)})
# (the power events' clock starts with the settle; the run's frames start after it)
index['events'] = [{**e, 'time_s': e['time_s'] - meta.get('settle_s', 0.0)} for e in meta['power_events'] if e['time_s'] is not None]
# the scene's own lights (glTF has no area lights, so the page builds its lamps from these): where each one is, which
# way it points and how its long side lies, its size, its USD intensity when on, and when the run switches it on
index['lights'] = []
for k, p in enumerate(meta['light_paths']):
    ob = next((o for o in by_path.get(p, []) if o.type == 'LIGHT'), None)
    lit = np.flatnonzero(rec['light'][:, k] > 0)
    if ob is None or not len(lit):
        continue
    d, M3 = ob.data, ob.matrix_world.to_3x3()
    size = [d.size, d.size_y if d.shape in ('RECTANGLE', 'ELLIPSE') else d.size] if d.type == 'AREA' else [2 * d.shadow_soft_size] * 2
    index['lights'].append({'prim': p, 'kind': d.type.lower(), 'pos': [round(v, 4) for v in gl(ob.matrix_world.translation)],
                            'dir': [round(v, 4) for v in gl((M3 @ Vector((0, 0, -1))).normalized())], 'axis': [round(v, 4) for v in gl((M3 @ Vector((1, 0, 0))).normalized())],
                            'size': [round(float(v), 4) for v in size], 'intensity': round(float(rec['light'][:, k].max()), 3), 'on': round(float(lit[0] / meta['fps']), 3)})

# the object boxes (axis-aligned in the simulator's world) with the page's physics types, and the film's cameras
r2s = json.loads((CARDS / 'r2s.json').read_text())
boxes_sim = json.loads((WORK / 'object_boxes_sim.json').read_text())
index['types'] = r2s['types']
index['boxes'] = []
for b in r2s['boxes']:
    s = boxes_sim.get(b['id'])
    if s:
        lo, hi = gl(s['lo']), gl(s['hi'])
        index['boxes'].append({'id': b['id'], 'type': b['type'], 'lo': [min(lo[k], hi[k]) for k in range(3)], 'hi': [max(lo[k], hi[k]) for k in range(3)]})
index['clips'] = []
for c in r2s['cards']:
    cams = json.loads((CARDS / 'blender' / f'card_{c["id"]}.json').read_text())['frames']
    a0, b0 = c['range']
    fr = sorted(int(p.stem) for p in (CARDS / 'cards' / c['id']).glob('*.jpg') if a0 <= int(p.stem) <= b0)
    index['clips'].append({'id': c['id'], 'anchor': c['anchor'], 'type': c['type'], 'name': c['name'], 'sub': c['sub'],
                           't': [cams[fr[0]]['rec'] / meta['fps'], cams[fr[-1]]['rec'] / meta['fps']],
                           'pos': gl(cams[fr[0]]['pos']), 'look': gl(cams[fr[0]]['look']), 'fov': cams[fr[0]]['fov'],
                           'frames': fr[::2], 'rec': [cams[f]['rec'] for f in fr[::2]]})
main = json.loads((CARDS / 'blender/main.json').read_text())['frames']
index['views'] = {'living': {'pos': gl(main[150]['pos']), 'look': gl(main[150]['look']), 'fov': main[150]['fov']},
                  'kitchen': {'pos': gl(main[520]['pos']), 'look': gl(main[520]['look']), 'fov': main[520]['fov']}}
# the film's main camera on the run's clock: for each exported frame, the last shot frame that shows it
path = []
for f in FR:
    c = max((k for k, m in enumerate(main) if m.get('rec', 0) <= f), default=0)
    path.append(gl(main[c]['pos']) + gl(main[c]['look']) + [main[c]['fov']])
index['path'] = [round(v, 4) for p_ in path for v in p_]
bb = np.array([[v for v in (o.matrix_world @ __import__('mathutils').Vector(c))] for o in meshes for c in o.bound_box])
index['bounds'] = [gl(bb.min(0)), gl(bb.max(0))]
index['ceiling'] = []
(OUT / 'run.bin').write_bytes(bytes(blob))

# ---------------------------------------------------------------- the scene
if not a.no_glb:
    dnames = {o.name for o, _ in deform}
    # curves -> tubes of their own radius (Cycles draws them so; the glTF exporter does not write them at all)
    def tube_group(res):
        ng = bpy.data.node_groups.new(f'R2S3D_tube_{res}', 'GeometryNodeTree')
        ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
        ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
        N, L = ng.nodes, ng.links
        gi, go = N.new('NodeGroupInput'), N.new('NodeGroupOutput')
        circ = N.new('GeometryNodeCurvePrimitiveCircle'); circ.inputs['Resolution'].default_value = res; circ.inputs['Radius'].default_value = 1.0
        c2m = N.new('GeometryNodeCurveToMesh'); rad = N.new('GeometryNodeInputRadius'); sm = N.new('GeometryNodeSetShadeSmooth')
        c2m.inputs['Fill Caps'].default_value = True
        L.new(gi.outputs[0], c2m.inputs['Curve']); L.new(circ.outputs['Curve'], c2m.inputs['Profile Curve']); L.new(rad.outputs[0], c2m.inputs['Scale'])
        L.new(c2m.outputs[0], sm.inputs[0]); L.new(sm.outputs[0], go.inputs[0])
        return ng
    groups = {}
    curves = [o for o in bpy.data.objects if o.type == 'CURVES' and not o.hide_render]
    for o in curves:
        r = np.zeros(len(o.data.points), np.float32)
        if 'radius' in o.data.attributes:
            o.data.attributes['radius'].data.foreach_get('value', r)
        res = 16 if r.max() > 0.006 else 8 if r.max() > 0.0015 else 5
        o.modifiers.new('tube', 'NODES').node_group = groups.setdefault(res, tube_group(res))
    bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get()
    made = tt = 0
    got = []                                    # copies first: linking a new object frees the evaluated meshes
    for o in curves:
        gs = o.evaluated_get(dg).evaluated_geometry()      # (its mesh lives only as long as this set)
        me = gs.mesh
        if me is not None and len(me.polygons):
            got.append((o, me.copy()))
        del gs
    for o, me in got:
        for m in o.data.materials:
            me.materials.append(m)
        t = bpy.data.objects.new('tube_' + o.name, me); bpy.context.scene.collection.objects.link(t); t.matrix_world = o.matrix_world.copy()
        made += 1; tt += len(me.polygons)
    print('R2S3D tubes', made, 'of', len(curves), 'curves,', tt, 'faces', flush=True)

    # ---- the film's light as a volume of probes (bake_r2s3d.py): a grid through the whole home, --probe metres apart,
    # baked with the scene as the run leaves it (doors open, so that what is behind them has light) and without the
    # TV cover (what it hides shows once it is pulled off). The bake is kept in the work folder and redone only on
    # --rebake or for another grid. gi.bin: per probe a colour and a direction, as float16 (r, g, b, direction x) for
    # all probes and then (direction y, z) for all probes, x fastest in glTF axes; first for the run's lights as at
    # its start, then the same again for what the lights it switches on add. index['gi'] says where the grid lies
    if not a.no_bake:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import bake_r2s3d as BK
        t0 = time.time()
        lo, hi = np.array(index['bounds'][0]), np.array(index['bounds'][1])
        lo, hi = np.minimum(lo, hi), np.maximum(lo, hi)
        dims = [int(np.ceil((hi[c] - lo[c]) / a.probe)) + 1 for c in range(3)]
        g = np.stack(np.meshgrid(*[lo[c] + a.probe * np.arange(dims[c]) for c in (2, 1, 0)], indexing='ij'), -1).reshape(-1, 3)[:, ::-1]     # glTF axes, x fastest
        pts = np.stack([g[:, 0], -g[:, 2], g[:, 1]], 1).astype(np.float32)                                                                   # the simulator's
        sim = lambda v: np.array([v[0], -v[2], v[1]])
        page = []       # the page's own lamps, as r2s3d.js makes them from index['lights']: [(index, [(position, axis, reach, cone angle, penumbra)])]
        for n, l in enumerate(index['lights']):
            if l['kind'] == 'area' and l['dir'][1] < -0.95:
                if min(l['size']) >= 1:
                    page.append((n, [(sim(l['pos']), sim(l['dir']), 0.0, 1.1, 0.5)]))
                elif min(l['size']) < 0.2:
                    page.append((n, [(sim(l['pos']) + u * max(l['size']) * sim(l['axis']), sim(l['dir']), 2.5, 1.4, 1.0) for u in (-0.25, 0.25)]))
        cache, z = WORK / 'bake3d.npz', None
        if cache.exists() and not a.rebake:
            z = np.load(cache)
            if 'dims' not in z.files or list(z['dims']) != dims or float(z['probe']) != a.probe or not np.allclose(z['lo'], lo):
                z = None
        if z is None:
            lights = BK.film_lights(meta, rec, json.loads((WORK / 'lightmap.json').read_text()), by_path)
            assert sum(1 for l in lights if BK.is_panel(l['ob'])) == len(page), 'the page and the bake disagree on which lamps are the page\'s'
            for o in curves:
                o.hide_render = True                    # (their tubes stand in for them)
            for ob, k in movers:
                ob.matrix_world = usd(xf[-1, k])
            for ob, i in deform:
                if strip.sub('', ob.name) in DEC:
                    ob.hide_render = True
                else:
                    ob.data.vertices.foreach_set('co', np.ascontiguousarray(rec[f'pt_{i}'][-1], np.float32).ravel()); ob.data.update()
            bpy.context.view_layer.update()
            res = BK.run(pts, lights, -6.5, 0.05, [int(x) for x in a.gpus.split(',')], a.bake_samples)
            for ob, k in movers:
                ob.matrix_world = usd(xf[0, k])
            for ob, i in deform:
                ob.hide_render = False
                ob.data.vertices.foreach_set('co', np.ascontiguousarray(rec[f'pt_{i}'][0], np.float32).ravel()); ob.data.update()
            bpy.context.view_layer.update()
            np.savez_compressed(cache, dims=np.array(dims), probe=a.probe, lo=lo, **{k: v.astype(np.float16) for k, v in res.items()})
            z = np.load(cache)
            print('R2S3D bake %.0fs' % (time.time() - t0), flush=True)
        gi, gk, direct = (z[k].astype(np.float32) for k in ('gi', 'gk', 'direct'))
        total = (gi + gk + direct).mean((1, 2))
        lit = total > 0.02 * np.percentile(total, 90)       # (not inside a wall or a closed cupboard, nor outside the home)
        cd, used, resid = BK.fit_lamps(pts[lit], direct[lit][:, 4].mean(1), [spots for _, spots in page])
        print('R2S3D lamps (cd in the film\'s exposure)', [round(v, 2) for v in cd], 'on', used, 'probes, rms %.0f%%' % (100 * resid), flush=True)
        for (n, _), v in zip(page, cd):
            index['lights'][n]['cd'] = round(float(v), 3)
        vol = []
        for six in (gi, gk):
            c0, d = BK.volume(six, dims, lit)
            vol += [np.c_[c0, d[:, :1]].astype(np.float16).tobytes(), d[:, 1:].astype(np.float16).tobytes()]
        (OUT / 'gi.bin').write_bytes(b''.join(vol))
        index['gi'] = {'file': 'gi.bin', 'lo': [round(float(v), 4) for v in lo], 'step': a.probe, 'dims': dims}
        print('R2S3D probes', dims, len(pts), 'of which in the dark (inside things, outside the home)', int((~lit).sum()), '; mean irradiance of the others %.2f + %.2f switched' % (float(gi[lit].mean()), float(gk[lit].mean())), flush=True)
    for o in list(bpy.data.objects):
        if o.type != 'MESH' or o.name in dnames or o.hide_render:
            bpy.data.objects.remove(o)
    n = 0
    for o in bpy.data.objects:
        if 'ceiling' in o.name.lower():
            o.name = f'ceiling_{n}'; index['ceiling'].append(o.name); n += 1
    for im in bpy.data.images:
        if im.size[0] and max(im.size) > 1024:
            s = 1024 / max(im.size); im.scale(max(1, round(im.size[0] * s)), max(1, round(im.size[1] * s)))
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'scene.glb'), export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_cameras=False, export_lights=False, export_animations=False, export_extras=False,
                              export_image_format='WEBP', export_image_quality=80,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12)
(OUT / 'run.json').write_text(json.dumps(index, separators=(',', ':')))
print('R2S3D done', len(blob), flush=True)
