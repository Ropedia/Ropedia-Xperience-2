#!/usr/bin/env python3
"""(Copied from video/flythrough/tools/find_vantage.py; reads the website's data/<scene>/scene.json, scene.spz and
take files.) Rank camera vantages on a recorded operator: clear of the scene and with an unblocked view of the body.

  python3 tools/find_vantage.py --scene ID --take TAKE --frames f0,f1 [--dist 1.2,2.4] [--height 1.45,1.85] [--cut 2.15]
                                [--top 8] [--peeks out.json]

Candidates sit on rings around the operator's mean root (every 15 degrees, --dist metres out, --height above the floor).
Each gets: clearance (distance to the nearest solid splat, also checked 0.25 m to either side, the room a short
move needs), sight (share of rays to the body's head, pelvis and both wrists, over the frame window, that no solid
splat blocks), foreground clutter (share of the picture covered by splats within 1 m, along the move), backdrop (metres of room
behind the operator along the line of sight: a wall right behind them makes a flat picture) and how far
the line of sight is from the head camera's own direction: about 70 degrees off the operator's back scores best, where
the recorded frame in the head-camera frustum faces the lens and the hands are still in view. Each candidate also gets a short move (--orbit: a sweep round the operator
while pushing in, start/middle/end printed as `path`) that must keep the same clearance. --peeks writes the best
ones as render.mjs --peek cameras.
"""
import argparse, gzip, json, os

import numpy as np
from scipy.spatial import cKDTree

ap = argparse.ArgumentParser()
ap.add_argument('--scene', required=True); ap.add_argument('--take', required=True)
ap.add_argument('--frames', required=True); ap.add_argument('--dist', default='1.2,2.4')
ap.add_argument('--height', default='1.45,1.85'); ap.add_argument('--cut', type=float, default=None)
ap.add_argument('--alpha', type=float, default=0.4); ap.add_argument('--top', type=int, default=8)
ap.add_argument('--clear', type=float, default=0.45); ap.add_argument('--peeks', default=None)
ap.add_argument('--fov', type=float, default=52)
ap.add_argument('--orbit', default='14,0.35', help='a move for each candidate: degrees swept round the operator, metres pushed in')
a = ap.parse_args()

here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
entry = json.load(open(f'{here}/data/{a.scene}/scene.json'))
R, fy = np.array(entry['view_R']), entry['floor_y']
raw = gzip.open(f'{here}/data/{a.scene}/scene.spz').read()
n = int(np.frombuffer(raw[8:12], '<u4')[0]); frac = raw[13]
c = np.frombuffer(raw[16:16 + 9 * n], np.uint8).reshape(n, 3, 3).astype(np.int32)
alpha = np.frombuffer(raw[16 + 9 * n:16 + 10 * n], np.uint8) / 255
v = c[..., 0] | (c[..., 1] << 8) | (c[..., 2] << 16)
P = (np.where(v >= 1 << 23, v - (1 << 24), v) / float(1 << frac)) @ R.T
P = P[alpha > a.alpha]
if a.cut is not None: P = P[P[:, 1] < fy + a.cut]
tree = cKDTree(P)

# operator: SMPL-H joints (view frame) over the window
body = np.fromfile(f'{here}/data/{a.scene}/{a.take}/body.f32', np.float32).reshape(-1, 52, 3) @ R.T
f0, f1 = map(int, a.frames.split(','))
win = body[f0:f1]
J = {'pelvis': 0, 'head': 15, 'lwrist': 20, 'rwrist': 21}
root = win[:, 0].mean(0)
cam = np.fromfile(f'{here}/data/{a.scene}/{a.take}/cam.f32', np.float32).reshape(-1, 7)[f0:f1]
# head camera forward (+Z of the camera) in the view frame, horizontal part
q = cam[:, 3:7]; x, y_, z, w = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
fwd = np.stack([2 * (x * z + w * y_), 2 * (y_ * z - w * x), 1 - 2 * (x * x + y_ * y_)], 1) @ R.T
hf = fwd.mean(0); hf[1] = 0; hf /= np.linalg.norm(hf) + 1e-9
samples = np.linspace(0, len(win) - 1, 6).astype(int)
targets = np.concatenate([win[samples][:, list(J.values())]], 0).reshape(-1, 3)


look_pt = (root + win[:, 15].mean(0)) / 2


def near_cover(p, fov=52.0, W=64, H=36):
    """Share of the picture (looking at the operator) covered by solid splats within 1 m of the lens."""
    idx = tree.query_ball_point(p, 1.0)
    if not idx: return 0.0
    fwd = look_pt - p; fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 1, 0]); right /= np.linalg.norm(right); up = np.cross(right, fwd)
    q = P[idx] - p; z = q @ fwd; q, z = q[z > 0.05], z[z > 0.05]
    f = 0.5 * H / np.tan(np.radians(fov) / 2)
    x = (W / 2 + f * (q @ right) / z).astype(int); y = (H / 2 - f * (q @ up) / z).astype(int)
    m = (x >= 0) & (x < W) & (y >= 0) & (y < H)
    g = np.zeros((H, W), int); np.add.at(g, (y[m], x[m]), 1)
    return float((g >= 2).mean())


def backdrop(p):
    """Metres of scene behind the operator along the line of sight (up to 6): more room in the background."""
    d = look_pt - p; d[1] = 0; d /= np.linalg.norm(d)
    s = np.arange(0.4, 6.0, 0.05); pts = look_pt + d[None] * s[:, None]
    hit = np.nonzero(tree.query_ball_point(pts, 0.06, return_length=True) >= 3)[0]
    return float(s[hit[0]]) if len(hit) else 6.0


def sight(p):
    ok = 0
    for t in targets:
        d = t - p; L = np.linalg.norm(d)
        s = np.linspace(0.15, L - 0.25, max(4, int(L / 0.04)))
        pts = p + d[None] / L * s[:, None]
        hit = tree.query_ball_point(pts, 0.05, return_length=True)
        ok += hit.sum() < 3
    return ok / len(targets)


d0, d1 = map(float, a.dist.split(',')); h0, h1 = map(float, a.height.split(','))
rows = []
for dist in np.arange(d0, d1 + 1e-6, 0.3):
    for h in np.arange(h0, h1 + 1e-6, 0.2):
        for ang in range(0, 360, 15):
            u = np.array([np.cos(np.radians(ang)), 0, np.sin(np.radians(ang))])
            p = np.array([root[0], fy + h, root[2]]) + dist * u
            side = np.cross(u, [0, 1, 0])
            sweep, push = map(float, a.orbit.split(','))
            path = []
            for u_ in (-0.5, 0, 0.5):   # the move: sweep round the operator while pushing in, ends to either side
                b = np.radians(ang + u_ * sweep); r_ = dist - u_ * push
                path.append(np.array([root[0], fy + h, root[2]]) + r_ * np.array([np.cos(b), 0, np.sin(b)]))
            clr = min(min(tree.query(q)[0] for q in path), tree.query(p + 0.25 * side)[0], tree.query(p - 0.25 * side)[0])
            if clr < a.clear: continue
            sg = sight(p)
            face = float(u @ hf)           # 1: in front of the operator, -1: straight behind
            nc = max(near_cover(q, a.fov) for q in path)   # foreground clutter anywhere along the move
            bd = backdrop(p)
            rows.append(dict(pos=p.round(3).tolist(), path=[q.round(3).tolist() for q in path], dist=round(dist, 2), h=round(h, 2), ang=ang, clear=round(float(clr), 2),
                             sight=round(sg, 2), face=round(face, 2), near=round(nc, 2), back=round(bd, 1),
                             score=round(sg * 2 + min(clr, 1.0) + 0.6 * (1 - abs(face + 0.35)) - 3 * nc + 0.25 * min(bd, 5.0), 3)))
rows.sort(key=lambda r: -r['score'])
print(f'{a.scene}/{a.take} frames {f0}-{f1}: root {root.round(2).tolist()}, head-camera heading {hf.round(2).tolist()}, '
      f'{len(rows)} clear candidates')
look = look_pt
for r in rows[:a.top]: print('  ', {k: v for k, v in r.items() if k != 'path'}, 'look', look.round(2).tolist(), 'path', r['path'])
if a.peeks:
    json.dump([dict(name=f'v{k:02d}_a{r["ang"]}_d{r["dist"]}_h{r["h"]}', t=0, pos=r['pos'], look=look.round(3).tolist(), fov=a.fov)
               for k, r in enumerate(rows[:a.top])], open(a.peeks, 'w'), indent=1)
