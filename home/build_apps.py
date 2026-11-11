#!/usr/bin/env python3
"""Extra data for the homepage's 04 Applications section (apps.js), from the launch video's sources in video/ (read only).

    <python with cv2> -I website/home/build_apps.py      (on this server: miniforge3/envs/scene_agent/bin/python)

build.py already writes the Real-to-Sim frames and boxes (data/r2s), run 203 (data/traj), the benchmark table
(data/bench.json) and the retargeted robots (data/LH_17761/7659f6d6). This adds, under data/apps/:

  mods/<id>.jpg        the eight modality thumbnails of the film's bridge shot (video/metrics/data/uses/thumbs)
  gap/<frame>.jpg      the real-to-sim gap heat map on the frames build.py kept (odd frames 111-205; the gap render
                       starts at frame 110)
  wall/<k>/<n>.jpg     the Robot A | Robot B wall of the film: tile k of the eight homes, its frames from the moment
                       the seam holds at the tile's centre (video/flythrough/out/frames_wall_k*)
  apps.json            the wall's tiles (scene, take, task, the 3D view's camera), the gap frames and its statistics

and, for the wall's 3D view (each tile opens its home in the engine's 'retarget' mode), per tile under data/:

  <scene>/scene.spz, scene.json        the full scan and its view frame, as build_viewer.py writes them
  <scene>/<take>/                      body.f32, hands.f32, cam.f32 (whole take), mesh.f32 + mesh.json (the robots'
                                       window), take.json (no accuracy numbers), the head camera's frames in the window
                                       (720 px), robot.json + robot_motion.f32 (Robot A) and robot_b.* (Robot B).
                                       The robots' meshes are the hero recording's own files (checked identical here),
                                       so no home downloads them again.
"""
import hashlib
import json
import shutil
from pathlib import Path

import cv2

HERE = Path(__file__).resolve().parent
V = HERE.parents[1] / 'video'
MET, FLY = V / 'metrics', V / 'flythrough'
OUT = HERE / 'data/apps'


def jpg(src, dst, width, q):
    im = cv2.imread(str(src))
    if im.shape[1] > width:
        im = cv2.resize(im, (width, round(im.shape[0] * width / im.shape[1])), interpolation=cv2.INTER_AREA)
    dst.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dst), im, [cv2.IMWRITE_JPEG_QUALITY, q, cv2.IMWRITE_JPEG_PROGRESSIVE, 1, cv2.IMWRITE_JPEG_OPTIMIZE, 1])


for p in sorted((MET / 'data/uses/thumbs').glob('*.jpg')):
    jpg(p, OUT / 'mods' / p.name, 264, 84)

gap = []
for f in range(111, 206, 2):
    src = MET / 'data/r2s/gap' / f'{f:05d}.jpg'
    if src.exists():
        jpg(src, OUT / 'gap' / f'{f:05d}.jpg', 1440, 70)
        gap.append(f)
gs = json.loads((MET / 'data/r2s/gap_stats.json').read_text())

wall = json.loads((FLY / 'shots/xemb_wall.json').read_text())
SEAM_HELD = round(wall['seam'][-1][0] * 30) + 2          # the seam is at the tile's centre from here on
# where each home's 3D view opens: the end of the tile's camera move in the film (shots/xemb_wall.js CAMS, view frame,
# metres; clearance-checked there)
CAMS = {
    'LH_B-21-02': ([-2.98, 0.21, 1.45], [-0.62, -0.33, 0.41], 47),
    'LH_17763': ([3.81, 0.25, 1.11], [2.81, -0.72, 2.35], 48),
    'LH_17764': ([-0.41, 0.17, 2.16], [-1.91, -0.6, 2.57], 46),
    'LH_17766': ([2.42, 0.39, -0.11], [4.51, -0.8, 0.08], 46),
    'LH_B-21-08': ([3.89, 0.22, -0.78], [1.64, -0.05, -1.71], 44),
    'LH_B-3A-09': ([6.63, 0.26, -0.62], [8.15, -0.46, -0.23], 48),
    'LH_F1-31-09': ([-2.3, 0.18, 2.33], [-2.28, -0.38, 0.51], 46),
    'LH_J20_02': ([1.8, 0.26, -0.52], [2.73, -0.52, 1.86], 44),
}
DATA, FILM = HERE / 'data', FLY / 'data'
HERO = DATA / 'LH_17761/7659f6d6'
md5 = lambda p: hashlib.md5(p.read_bytes()).hexdigest()
ROBOT_MESH = {n: md5(HERO / f'{n}_mesh.bin') for n in ('robot', 'robot_b')}
index = {s['id']: s for s in json.loads((FILM / 'index.json').read_text())['scenes']}


def home3d(t):
    """One tile's scan, recording window and both robots, into data/<scene>/<take>/. Returns the robots' window."""
    sid, tid = t['scene'], t['take']
    src, dst, ts, td = FILM / sid, DATA / sid, FILM / sid / t['take'], DATA / sid / t['take']
    (td / 'frames').mkdir(parents=True, exist_ok=True)
    if not (dst / 'scene.spz').exists() or (dst / 'scene.spz').stat().st_size != (src / 'scene.spz').stat().st_size:
        shutil.copyfile(src / 'scene.spz', dst / 'scene.spz')
    s = index[sid]
    (dst / 'scene.json').write_text(json.dumps({'id': sid, 'view_R': s['view_R'], 'floor_y': s['floor_y'],
                                                'ceiling_y': s['ceiling_y'], 'bounds': s['bounds_view']}, indent=1))
    ja, jb = (json.loads((ts / f'{n}.json').read_text()) for n in ('robot', 'robot_b'))
    mj = json.loads((ts / 'mesh.json').read_text())
    f0, f1 = ja['f0'], ja['f1']
    assert (jb['f0'], jb['f1']) == (f0, f1) and mj['f0'] <= f0 and mj['f1'] >= f1, (sid, tid)
    for n in ('robot', 'robot_b'):
        assert md5(ts / f'{n}_mesh.bin') == ROBOT_MESH[n], (sid, n)   # the page reads the hero recording's copy
        for f in (f'{n}.json', f'{n}_motion.f32'):
            shutil.copyfile(ts / f, td / f)
    for f in ('body.f32', 'hands.f32', 'cam.f32'):
        shutil.copyfile(ts / f, td / f)
    n = mj['verts'] * 3 * 4
    with open(ts / 'mesh.f32', 'rb') as fh:
        fh.seek((f0 - mj['f0']) * n)
        (td / 'mesh.f32').write_bytes(fh.read((f1 - f0) * n))
    (td / 'mesh.json').write_text(json.dumps({'f0': f0, 'f1': f1, 'verts': mj['verts'], 'faces': mj['faces']}))
    take = json.loads((ts / 'take.json').read_text())
    take['metrics'] = {'verdict': take['metrics']['verdict']}   # no accuracy numbers
    (td / 'take.json').write_text(json.dumps(take, separators=(',', ':')))
    for f in range(f0, f1):
        fp, op = ts / 'frames' / f'{f:05d}.jpg', td / 'frames' / f'{f:05d}.jpg'
        if fp.exists() and not op.exists():
            jpg(fp, op, 720, 76)
    return f0, f1


tiles = []
for k, t in enumerate(wall['tiles']):
    frames = sorted(int(p.stem) for p in (FLY / f'out/frames_wall_k{k}').glob('*.jpg') if int(p.stem) >= SEAM_HELD)
    for n, f in enumerate(frames):
        jpg(FLY / f'out/frames_wall_k{k}' / f'{f:05d}.jpg', OUT / 'wall' / str(k) / f'{n:03d}.jpg', 800, 72)
    f0, f1 = home3d(t)
    pos, look, fov = CAMS[t['scene']]
    tiles.append({'scene': t['scene'], 'take': t['take'], 'task': t['task'], 'seam': t['seam_x'], 'n': len(frames),
                  'win': [f0, f1], 'cam': {'pos': pos, 'look': look, 'fov': fov}})

(OUT / 'apps.json').write_text(json.dumps({
    'gap': {'frames': gap, 'per_frame': {str(f): gs[f'{f:05d}'] for f in gap if f'{f:05d}' in gs}},
    'wall': {'tiles': tiles, 'fps': 30},
}, separators=(',', ':')))
print(f'{len(gap)} gap frames; wall tiles: {[t["n"] for t in tiles]}')
