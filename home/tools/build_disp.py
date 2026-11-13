#!/usr/bin/env python3
"""Data for the first long-horizon demonstration in 04 Applications (apps.js, dispenser()): the water-dispenser run
in the office simulator scene, from the replay package dispenser_rollout_07_replay (a copy is on h200-sg2 in
/mnt/local/lihao/xperience_website/sources/).

  python -I tools/build_disp.py --pkg ~/Downloads/dispenser_rollout_07_replay

Needs ffmpeg, numpy, Pillow and usd-core (pxr), so it runs on the Mac (the server has no ffmpeg); then copy
data/disp to the server's website/home/data/disp.

The run: a mobile robot with two dexterous hands, 173.7 s, 7 subtasks (all checks pass): move one cup aside from
under the left tap, fill the other at the right tap (~10%), move it under the left tap, fill again (~10%), pick it up,
carry it to a desk, set it down. The water is not a fluid simulation: the fingers really turn the tap knobs, and the
stream and the water in the cup are drawn by rule from the knob angle (the page says so). No robot, scene or asset
names leave this script.

Writes data/disp/:
  rollout.mp4   the package's two-camera recording (1920 x 540, two 960 x 540 views side by side, 15 fps), H.264
                with a key frame every second so the scrub bar seeks quickly; no audio
  poster.jpg    its first frame
  plan.png      top-down plan, 2 cm per px, from the scene's static meshes (the robot, cups and water left out),
                u = (Y1 - y) / RES to the right, v = (X1 - x) / RES down, as in data/traj/plan.png
  disp.json     stages (frames, labels, checks), the base and cup path and the water in the cup every EVERY frames,
                the plan's frame, the stats
"""
import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

HOME = Path(__file__).resolve().parent.parent
OUT = HOME / 'data/disp'
FPS, EVERY = 15, 3
RES, X0, X1, Y0, Y1 = 0.02, -0.6, 6.6, -10.1, 3.3     # the plan's window (m): the kitchenette, corridor and desks
LABELS = {
    'aside': 'Clear the left tap',
    'fill1': 'Fill at the right tap',
    'move': 'Move it under the left tap',
    'fill2': 'Fill at the left tap',
    'pickup': 'Pick up the cup',
    'carry': 'Carry it to a desk',
    'deliver': 'Set it on the desk',
}
SKIP = ('/World/Tianji', '/World/Objects/receiving_cup', '/World/WaterVisual', '/World/ReferenceCameras')


def sh(*a): subprocess.run([str(x) for x in a], check=True)


def surface_points(usd):
    """Points ~2 cm apart on every visible static mesh at frame 0 (vertices alone leave the walls dotted)."""
    from pxr import Usd, UsdGeom
    st, rng, D, out = Usd.Stage.Open(str(usd)), np.random.default_rng(0), 0.02, []
    xc = UsdGeom.XformCache(0)
    for p in st.Traverse():
        if not p.IsA(UsdGeom.Mesh) or str(p.GetPath()).startswith(SKIP): continue
        if UsdGeom.Imageable(p).ComputeVisibility(0) == 'invisible': continue
        m = UsdGeom.Mesh(p)
        v, idx, cnt = (a.Get(0) for a in (m.GetPointsAttr(), m.GetFaceVertexIndicesAttr(), m.GetFaceVertexCountsAttr()))
        if v is None or idx is None or cnt is None or len(v) == 0: continue
        v, idx, cnt = np.asarray(v, np.float64), np.asarray(idx), np.asarray(cnt)
        M = np.asarray(xc.GetLocalToWorldTransform(p), np.float64)
        w = v @ M[:3, :3] + M[3, :3]
        s0 = np.concatenate([[0], np.cumsum(cnt)[:-1]])
        tris = [np.stack([idx[s0[s]], idx[s0[s] + k], idx[s0[s] + k + 1]], 1)
                for k in range(1, cnt.max() - 1) for s in [cnt > k + 1]]
        if not tris: continue
        T = np.concatenate(tris); A, B, C = w[T[:, 0]], w[T[:, 1]], w[T[:, 2]]
        n = np.minimum(np.ceil(0.5 * np.linalg.norm(np.cross(B - A, C - A), axis=1) / D ** 2).astype(int), 20000)
        rep = np.repeat(np.arange(len(T)), n)
        r1, r2 = rng.random(len(rep)), rng.random(len(rep))
        f = r1 + r2 > 1; r1[f], r2[f] = 1 - r1[f], 1 - r2[f]
        out += [A[rep] + r1[:, None] * (B - A)[rep] + r2[:, None] * (C - A)[rep], w]
    return np.concatenate(out)


def plan(usd):
    """Brightness by the tallest point in the cell (walls brightest); transparent elsewhere (data/traj's style)."""
    P = surface_points(usd)
    m = (P[:, 2] > 0.08) & (P[:, 2] < 2.3) & (P[:, 0] > X0) & (P[:, 0] < X1) & (P[:, 1] > Y0) & (P[:, 1] < Y1)
    nu, nv = int(round((Y1 - Y0) / RES)), int(round((X1 - X0) / RES))
    u = np.clip(((Y1 - P[m, 1]) / RES).astype(int), 0, nu - 1); v = np.clip(((X1 - P[m, 0]) / RES).astype(int), 0, nv - 1)
    hm = np.zeros((nv, nu)); np.maximum.at(hm, (v, u), P[m, 2])
    k = np.clip(hm / 2.3, 0, 1)
    rgba = np.zeros((nv, nu, 4), np.float32)
    lime, white = np.array([204, 255, 160]), np.array([236, 240, 232])
    wall = k > 0.85
    rgba[..., :3] = np.where(wall[..., None], white, lime)
    rgba[..., 3] = np.where(hm > 0, np.where(wall, 0.78, 0.12 + 0.3 * k), 0) * 255
    Image.fromarray(rgba.astype(np.uint8), 'RGBA').save(OUT / 'plan.png', optimize=True)
    return {'res': RES, 'X1': X1, 'Y1': Y1, 'w': nu, 'h': nv}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pkg', required=True, type=Path)
    pkg = ap.parse_args().pkg.expanduser()
    OUT.mkdir(parents=True, exist_ok=True)

    sh('ffmpeg', '-v', 'error', '-y', '-i', pkg / 'video/rollout_07_full.mp4', '-an', '-c:v', 'libx264', '-preset', 'slow',
       '-crf', '22', '-pix_fmt', 'yuv420p', '-g', FPS, '-keyint_min', FPS, '-sc_threshold', 0, '-movflags', '+faststart',
       OUT / 'rollout.mp4')
    sh('ffmpeg', '-v', 'error', '-y', '-i', OUT / 'rollout.mp4', '-frames:v', 1, '-q:v', 3, OUT / 'poster.jpg')

    z = np.load(pkg / 'trajectory/trajectory.npz')
    stages = json.loads((pkg / 'trajectory/stages.json').read_text())
    res = json.loads((pkg / 'trajectory/RESULT.json').read_text())
    checks = {s['stage']: s['checks'] for s in res['stages']}
    assert res['success'] and all(s['ok'] and all(s['checks'].values()) for s in res['stages'])
    n = len(z['frame'])
    cup = list(z['cup_names']).index('receiving_cup_blue')        # the cup that is filled and carried
    ml = z['water_ml'][:, cup].sum(1)
    b, c = z['base_xy_yaw'], z['cup_poses'][:, cup, :3]
    mp = lambda x, y: [round(float((Y1 - y) / RES), 1), round(float((X1 - x) / RES), 1)]
    path = [mp(*b[i, :2]) + [round(float(b[i, 2]), 3)] + mp(*c[i, :2]) for i in range(0, n, EVERY)]
    flows = []                                                      # frames with water running into the cup
    on = np.diff(ml, prepend=0) > 1e-3
    for i in range(n):
        if on[i] and (not flows or flows[-1][1] < i - 2): flows.append([i, i])
        elif on[i]: flows[-1][1] = i
    D = {
        'fps': FPS, 'frames': n, 'every': EVERY,
        'stages': [{'key': s['stage'], 'name': LABELS[s['stage']], 'f0': s['first_frame'], 'f1': s['last_frame'],
                    'checks': [k.replace('_', ' ') for k in checks[s['stage']]]} for s in stages],
        'path': path, 'ml': [round(float(x), 1) for x in ml[::EVERY]], 'flows': flows,
        'capacity_ml': round(float(z['cup_capacity_ml']), 1),
        'marks': {'dispenser': mp(*c[0, :2]), 'desk': mp(*c[-1, :2])},
        'plan': plan(pkg / 'scene/rollout_07.usdc'),
        'stats': {'seconds': round(float(res['sim_seconds']), 1), 'checks': sum(len(v) for v in checks.values()),
                  'ml': round(float(ml[-1]), 1)},
    }
    (OUT / 'disp.json').write_text(json.dumps(D, separators=(',', ':')))
    for f in sorted(OUT.iterdir()): print(f'{f.name:12s} {f.stat().st_size / 1e6:6.2f} MB')


if __name__ == '__main__':
    main()
