# Copyright 2026 Ropedia Research Team
# SPDX-License-Identifier: Apache-2.0
"""Register one HOMIE recording to one KOSMO scene using local exported files."""
import hashlib
import json
import os
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import h5py
import numpy as np
import open3d as o3d
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation as Rot

from .quality import verdict
from .sources import Source

o3d.utility.set_verbosity_level(o3d.utility.VerbosityLevel.Error)
cv2.setNumThreads(int(os.environ.get("HKA_CV_THREADS", "8")))
IMG_EXT = ('.jpg', '.jpeg', '.png')


def log(*args):
    print(time.strftime('%H:%M:%S'), *args, flush=True)


def write_json(path, value, **kwargs):
    Path(path).write_text(json.dumps(value, **kwargs) + '\n')


# ---------------------------------------------------------------- geometry helpers
def xf(T, p): return p @ T[:3, :3].T + T[:3, 3]


def umeyama(A, B, scale):
    A, B = np.asarray(A, float), np.asarray(B, float)
    if A.shape != B.shape or A.ndim != 2 or A.shape[1] != 3 or len(A) < 3:
        raise ValueError('alignment requires at least three matching 3D points')
    if not (np.isfinite(A).all() and np.isfinite(B).all()):
        raise ValueError('alignment points must be finite')
    ma, mb = A.mean(0), B.mean(0); a, b = A - ma, B - mb
    if np.linalg.matrix_rank(a) < 2 or np.linalg.matrix_rank(b) < 2:
        raise ValueError('camera centres do not constrain rotation; use pose averaging')
    U, S, Vt = np.linalg.svd(b.T @ a / len(A)); D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt; c = (S * np.diag(D)).sum() / ((a ** 2).sum() / len(A)) if scale else 1.0
    T = np.eye(4); T[:3, :3] = c * R; T[:3, 3] = mb - c * R @ ma
    return T


def robust_fit(A, B, scale, floor=0.08):
    keep = np.ones(len(A), bool)
    for _ in range(5):
        T = umeyama(A[keep], B[keep], scale); e = np.linalg.norm(xf(T, A) - B, axis=1)
        keep = e < max(floor, 3 * np.median(e))
    return umeyama(A[keep], B[keep], scale), keep


def sim3_parts(T):
    c = np.cbrt(np.linalg.det(T[:3, :3])); return c, T[:3, :3] / c, T[:3, 3]


def rot_deg(Ra, Rb): return float(np.degrees(Rot.from_matrix(Ra.T @ Rb).magnitude()))


# ---------------------------------------------------------------- Homie
class Homie:
    def __init__(self, src):
        self.src = src
        m = 'mocap_main/'
        a = np.atleast_2d(np.loadtxt(src.path(m + 'f_slam.txt'), comments='#'))
        if a.shape[1] != 8 or len(a) < 8 or not np.isfinite(a).all():
            raise ValueError('f_slam.txt must contain at least eight finite TUM poses (8 columns)')
        self.ts = a[:, 0]
        Twb = np.tile(np.eye(4), (len(a), 1, 1)); Twb[:, :3, :3] = Rot.from_quat(a[:, 4:8]).as_matrix(); Twb[:, :3, 3] = a[:, 1:4]
        cal = json.loads(Path(src.path(m + 'calibration.json')).read_text())
        self.Tc0b = np.array(cal['cam01']['T_c0_b']); self.Kfull = np.array(cal['cam01']['K'], float)
        self.Twb = Twb; self.TwcL = np.array([T @ np.linalg.inv(self.Tc0b) for T in Twb])
        self.Kcrop = self.crop_size = self.landmarks = None
        self.crop_src = np.array([2 * self.Kfull[2], 2 * self.Kfull[3]])
        if m + 'annotation.hdf5' in src.listing():
            with h5py.File(src.path(m + 'annotation.hdf5'), 'r') as h:
                if 'calibration/cam01' in h:
                    g = h['calibration/cam01']; self.Kcrop = g['K'][:]
                    if 'image_size' in g: self.crop_size = g['image_size'][:]
                    if 'crop_src_size' in g: self.crop_src = g['crop_src_size'][:]
                self.landmarks = h['slam/point_cloud'][:] if 'slam/point_cloud' in h else None
        if m + 'stereo_left_synced.mp4' in src.listing() and self.Kcrop is not None and self.crop_size is not None:
            self.video = src.path(m + 'stereo_left_synced.mp4')          # cropped rectified left (annotation cam01/K)
        else:
            self.video = src.path(m + 'stereo_left_synced_w_margin.mp4')  # full-size rectified left (calibration.json cam01.K)
        if not os.path.isfile(self.video):
            raise ValueError('cropped video needs annotation.hdf5 calibration/cam01/K and image_size; '
                             'otherwise supply stereo_left_synced_w_margin.mp4')
        cap = cv2.VideoCapture(self.video)
        if not cap.isOpened():
            raise ValueError(f'cannot open video: {self.video}')
        W, H, n = int(cap.get(3)), int(cap.get(4)), int(cap.get(7)); cap.release()
        if min(W, H) <= 0 or n < 8:
            raise ValueError('video must contain at least eight readable frames')
        if self.video.endswith('/stereo_left_synced.mp4') and (W, H) != tuple(int(x) for x in self.crop_size):
            raise ValueError('cropped video size does not match annotation.hdf5 calibration/cam01/image_size')
        if self.Kcrop is not None and self.crop_size is not None and (W, H) == tuple(int(x) for x in self.crop_size):
            k = self.Kcrop
        else:  # full-size or other: scale the full-size intrinsics
            s = W / self.crop_src[0]; k = self.Kfull * s
        self.K = np.array([[k[0], 0, k[2]], [0, k[1], k[3]], [0, 0, 1]]); self.W, self.H = W, H
        self.n = min(n, len(self.ts))
        if n != len(self.ts): log(f'WARN video frames {n} != poses {len(self.ts)}; using {self.n}')
        self._cap = None

    def frame(self, i, gray=True):
        if self._cap is None: self._cap = cv2.VideoCapture(self.video)
        self._cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, fr = self._cap.read()
        if not ok: return None
        return cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY) if gray else fr


# ---------------------------------------------------------------- Kosmos
class Kosmos:
    def __init__(self, src, cache):
        self.src = src
        cz = src.find(r'^colmap/.*\.zip$')
        if len(cz) != 1: raise ValueError('scene must contain exactly one colmap/*.zip text model')
        z = zipfile.ZipFile(src.path(cz[0]))
        names = {os.path.basename(n): n for n in z.namelist()}
        self.cams = {}
        for l in z.read(names['cameras.txt']).decode().splitlines():
            if l.startswith('#') or not l.strip(): continue
            s = l.split(); self.cams[int(s[0])] = dict(model=s[1], w=int(s[2]), h=int(s[3]), p=np.array(list(map(float, s[4:]))))
        self.images = []
        for l in z.read(names['images.txt']).decode().splitlines():
            s = l.split()
            if l.startswith('#') or len(s) < 10 or not s[9].lower().endswith(IMG_EXT): continue
            q = list(map(float, s[1:5])); Tcw = np.eye(4)
            Tcw[:3, :3] = Rot.from_quat([q[1], q[2], q[3], q[0]]).as_matrix(); Tcw[:3, 3] = list(map(float, s[5:8]))
            self.images.append(dict(cam=int(s[8]), name=s[9], Twc=np.linalg.inv(Tcw)))
        z.close()
        if not self.images:
            raise ValueError('COLMAP model contains no supported image entries')
        pin = [im for im in self.images if self.cams[im['cam']]['model'] in ('PINHOLE', 'SIMPLE_PINHOLE')]
        self.db = pin if len(pin) >= 50 else self.images
        log(f'Kosmos: {len(self.images)} posed images, cameras {[(k, v["model"]) for k, v in self.cams.items()]}, DB uses {len(self.db)}')
        self.C = np.array([im['Twc'][:3, 3] for im in self.db]); self.Z = np.array([im['Twc'][:3, 2] for im in self.db])
        iz = src.find(r'^images/.*\.zip$')
        if len(iz) != 1: raise ValueError('scene must contain exactly one images/*.zip')
        self._iz, self._tl = iz[0], threading.local()
        self.zipnames = set(self._zip().namelist())
        obj = src.find(r'^obj/.*\.obj$')
        if len(obj) != 1: raise ValueError('scene must contain exactly one obj/*.obj triangle mesh')
        mesh_path = Path(src.path(obj[0])).resolve()
        stat = mesh_path.stat()
        mesh_key = hashlib.sha256(f'{mesh_path}:{stat.st_size}:{stat.st_mtime_ns}'.encode()).hexdigest()
        mp = os.path.join(cache, 'mesh_' + mesh_key + '.ply')
        if not os.path.exists(mp):
            o3d.io.write_triangle_mesh(mp, o3d.io.read_triangle_mesh(src.path(obj[0])))
        self.mesh = o3d.io.read_triangle_mesh(mp)
        self.V = np.asarray(self.mesh.vertices); self.VC = np.asarray(self.mesh.vertex_colors); self.F = np.asarray(self.mesh.triangles)
        if not len(self.V) or not len(self.F):
            raise ValueError('scan mesh must contain vertices and triangles')
        if not len(self.VC):
            self.VC = np.full_like(self.V, 0.7)
        self.scene = o3d.t.geometry.RaycastingScene(); self.scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(self.mesh))
        log(f'Kosmos mesh: {len(self.V)} vertices')

    def _zip(self):
        if not hasattr(self._tl, 'z'): self._tl.z = zipfile.ZipFile(self.src.open(self._iz))
        return self._tl.z

    def read_gray(self, im, maxdim):
        name = im['name'] if im['name'] in self.zipnames else next((n for n in self.zipnames if n.endswith(im['name'])), None)
        g = cv2.imdecode(np.frombuffer(self._zip().read(name), np.uint8), cv2.IMREAD_GRAYSCALE)
        s = min(1.0, maxdim / max(g.shape));
        if s < 1: g = cv2.resize(g, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        return g, s

    def rays(self, im, px):
        """Unit-depth camera rays (x, y, 1) for full-resolution pixel coordinates."""
        c = self.cams[im['cam']]; p = c['p']; m = c['model']
        if m in ('SIMPLE_PINHOLE', 'SIMPLE_RADIAL', 'RADIAL'): fx = fy = p[0]; cx, cy = p[1], p[2]
        else: fx, fy, cx, cy = p[:4]
        K = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]])
        pts = px.reshape(-1, 1, 2).astype(np.float64)
        if m in ('PINHOLE', 'SIMPLE_PINHOLE'): n = np.stack([(px[:, 0] - cx) / fx, (px[:, 1] - cy) / fy], 1)
        elif m == 'OPENCV_FISHEYE': n = cv2.fisheye.undistortPoints(pts, K, p[4:8]).reshape(-1, 2)
        elif m in ('OPENCV', 'RADIAL', 'SIMPLE_RADIAL'):
            D = p[4:8] if m == 'OPENCV' else np.array([p[3], p[4] if m == 'RADIAL' else 0, 0, 0])
            n = cv2.undistortPoints(pts, K, D).reshape(-1, 2)
        else: raise ValueError(f'unsupported camera model {m}')
        return np.concatenate([n, np.ones((len(n), 1))], 1)

    def lift(self, im, px):
        """3D points on the Kosmos mesh seen at pixels px of DB image im (NaN where no hit)."""
        d = self.rays(im, px) @ im['Twc'][:3, :3].T; o = im['Twc'][:3, 3]
        r = np.concatenate([np.tile(o, (len(d), 1)), d], 1).astype(np.float32)
        th = self.scene.cast_rays(o3d.core.Tensor(r))['t_hit'].numpy()
        P = o + d * th[:, None]; P[~np.isfinite(th) | (th > 12)] = np.nan
        return P


# ---------------------------------------------------------------- matching / PnP
class Matcher:
    def __init__(self, nfeat):
        self.nfeat, self._tl = nfeat, threading.local(); self.bf = cv2.BFMatcher(cv2.NORM_L2); self.cache = {}

    def feat(self, g):
        if not hasattr(self._tl, 'sift'): self._tl.sift = cv2.SIFT_create(nfeatures=self.nfeat)
        kp, de = self._tl.sift.detectAndCompute(g, None)
        return (np.array([k.pt for k in kp], np.float32).reshape(-1, 2), de)

    def precompute(self, ks, ims, maxdim, threads=16):
        todo = [im for im in ims if (im['name'], maxdim) not in self.cache]
        with ThreadPoolExecutor(threads) as ex: list(ex.map(lambda im: self.db_feat(ks, im, maxdim), todo))

    def db_feat(self, ks, im, maxdim):
        key = (im['name'], maxdim)
        if key not in self.cache:
            g, s = ks.read_gray(im, maxdim); p, d = self.feat(g); self.cache[key] = (p / s, d)
        return self.cache[key]

    def match(self, dq, dd, ratio=0.8):
        if dq is None or dd is None or len(dd) < 2 or len(dq) < 2: return np.zeros((0, 2), int)
        mm = self.bf.knnMatch(dq, dd, k=2)
        best = {}   # one-to-one: many query features hitting one train feature make degenerate "F inliers"
        for m, n in (x for x in mm if len(x) == 2):
            if m.distance < ratio * n.distance and (m.trainIdx not in best or m.distance < best[m.trainIdx][1]):
                best[m.trainIdx] = (m.queryIdx, m.distance)
        return np.array([(q, t) for t, (q, _) in best.items()], int).reshape(-1, 2)


def pnp(P3, P2, K, min_inl):
    ok = np.isfinite(P3).all(1); P3, P2 = P3[ok].astype(np.float64), P2[ok].astype(np.float64)
    if len(P3) < max(12, min_inl): return None
    res = None
    for flag in (cv2.SOLVEPNP_SQPNP, cv2.SOLVEPNP_EPNP):
        try:
            res = cv2.solvePnPRansac(P3, P2, K, None, iterationsCount=4000, reprojectionError=6.0, confidence=0.9999, flags=flag); break
        except cv2.error: continue
    if res is None or not res[0] or res[3] is None or len(res[3]) < min_inl: return None
    _, rv, tv, inl = res; inl = inl[:, 0]
    rv, tv = cv2.solvePnPRefineLM(P3[inl], P2[inl], K, None, rv, tv)
    Tcw = np.eye(4); Tcw[:3, :3] = cv2.Rodrigues(rv)[0]; Tcw[:3, 3] = tv[:, 0]
    return np.linalg.inv(Tcw), int(len(inl)), int(len(P3))


def localize(hm, ks, M, i, cand, maxdim, min_inl):
    g = hm.frame(i)
    if g is None: return None
    pq, dq = M.feat(g); P3, P2 = [], []
    for im in cand:
        pd, dd = M.db_feat(ks, im, maxdim); mt = M.match(dq, dd)
        if len(mt) < 15: continue
        X = ks.lift(im, pd[mt[:, 1]]); P3.append(X); P2.append(pq[mt[:, 0]])
    if not P3: return None
    return pnp(np.concatenate(P3), np.concatenate(P2), hm.K, min_inl)


# ---------------------------------------------------------------- stages
def pick_queries(hm, M, nq):
    """One query per time window: the frame with the most SIFT keypoints among 3 candidates."""
    edges = np.linspace(0.02 * hm.n, 0.98 * hm.n, nq + 1).astype(int); out = []
    for a, b in zip(edges[:-1], edges[1:]):
        best = None
        for i in np.linspace(a, max(a, b - 1), 3).astype(int):
            g = hm.frame(int(i))
            if g is None: continue
            f = M.feat(g)
            if best is None or len(f[0]) > len(best[1][0]): best = (int(i), f)
        if best: out.append(best)
    return out


def global_init(hm, ks, nq, ndb, min_inl=25, maxdim=1536, M=None):
    M = M or Matcher(5000)
    db = [ks.db[j] for j in np.unique(np.linspace(0, len(ks.db) - 1, min(ndb, len(ks.db))).astype(int))]
    M.precompute(ks, db, maxdim); log(f'  init DB features: {len(db)} images')
    queries = pick_queries(hm, M, nq); q = [i for i, _ in queries]
    hyps = []
    for i, (pq, dq) in queries:
        scores = []
        for k, im in enumerate(db):
            pd, dd = M.db_feat(ks, im, maxdim); mt = M.match(dq, dd)
            if len(mt) < 20: continue
            F, inl = cv2.findFundamentalMat(pq[mt[:, 0]], pd[mt[:, 1]], cv2.USAC_MAGSAC, 3.0, 0.999, 2000)
            if inl is not None: scores.append((int(inl.sum()), k, mt[inl[:, 0] > 0]))
        scores.sort(key=lambda x: -x[0]); P3, P2 = [], []
        for sc, k, mt in scores[:3]:
            if sc < 12: continue
            pd, _ = M.db_feat(ks, db[k], maxdim); P3.append(ks.lift(db[k], pd[mt[:, 1]])); P2.append(pq[mt[:, 0]])
        r = pnp(np.concatenate(P3), np.concatenate(P2), hm.K, min_inl) if P3 else None
        if r: hyps.append(dict(i=int(i), Tpnp=r[0], inl=r[1], H=r[0] @ np.linalg.inv(hm.TwcL[i])))
        log(f'  init frame {i}: best F-inliers {scores[0][0] if scores else 0}, PnP {"inl %d" % r[1] if r else "fail"}')
    best, support = None, []
    for h in hyps:  # consensus: does hypothesis h predict the other frames' PnP poses?
        s = [g for g in hyps if np.linalg.norm(xf(h['H'], hm.TwcL[g['i']][:3, 3][None])[0] - g['Tpnp'][:3, 3]) < 0.3
             and rot_deg(h['H'][:3, :3] @ hm.TwcL[g['i']][:3, :3], g['Tpnp'][:3, :3]) < 5]
        if len(s) > len(support): best, support = h, s
    T = None; strong = max(hyps, key=lambda h: h['inl'], default=None)
    if len(support) >= 3:   # full PnP poses (rotation average): consensus frames are often clustered in space, centres alone leave rotation free
        T, _ = fit_pose_avg(np.array([hm.TwcL[g['i']][:3, 3] for g in support]), np.array([g['Tpnp'][:3, 3] for g in support]),
                            np.array([hm.TwcL[g['i']][:3, :3] for g in support]), np.array([g['Tpnp'][:3, :3] for g in support]))
    elif strong is not None and strong['inl'] >= 80:   # one very confident frame; fine localization must still confirm it
        T = strong['H']
    elif len(support) >= 1:
        T = best['H']
    return T, dict(n_query=len(q), n_pnp=len(hyps), n_consensus=len(support), db_images=len(db),
                   single_strong=bool(len(support) < 3 and strong is not None and strong['inl'] >= 80))


def fine_localize(hm, ks, T, step, ncand=4, min_inl=25, M=None, cache_cap=400):
    M = M or Matcher(8000); res = []
    c = sim3_parts(T)[1]
    for i in range(0, hm.n, step):
        Tp = T @ hm.TwcL[i]; cp = Tp[:3, 3]; zp = c @ hm.TwcL[i][:3, 2]
        score = np.linalg.norm(ks.C - cp, axis=1) + 1.5 * (1 - ks.Z @ zp)
        cand = [ks.db[j] for j in np.argsort(score)[:ncand]]
        r = localize(hm, ks, M, i, cand, 2048, min_inl)
        if r: res.append(dict(i=i, Tpnp=r[0], inl=r[1], n=r[2]))
        if len(M.cache) > cache_cap: M.cache.clear()
    return res


def fit_pose_avg(A, B, RA, RB):
    """SE3 from per-frame PnP orientations (robust rotation average) plus centres: well-posed even for short trajectories."""
    Rs = np.array([RB[k] @ RA[k].T for k in range(len(A))]); keep = np.ones(len(A), bool)
    for _ in range(4):
        U, _, Vt = np.linalg.svd(Rs[keep].sum(0)); R = U @ np.diag([1, 1, np.linalg.det(U @ Vt)]) @ Vt
        t = np.median(B[keep] - A[keep] @ R.T, axis=0)
        er = np.array([rot_deg(R, Rk) for Rk in Rs]); et = np.linalg.norm(A @ R.T + t - B, axis=1)
        keep = (er < max(2.0, 3 * np.median(er))) & (et < max(0.08, 3 * np.median(et)))
    T = np.eye(4); T[:3, :3] = R; T[:3, 3] = np.mean(B[keep] - A[keep] @ R.T, axis=0)
    return T, keep


def fit_and_eval(hm, loc):
    """Fit on alternating localized frames and evaluate on the held-out frames."""
    for th, need in ((60, 12), (40, 8), (25, 4)):
        selected = [r for r in loc if r['inl'] >= th]
        if len(selected) >= need:
            break
    if len(selected) < 8:
        return None, dict(n_fit=len(selected))
    A = np.array([hm.TwcL[r['i']][:3, 3] for r in selected])
    B = np.array([r['Tpnp'][:3, 3] for r in selected])
    RA = np.array([hm.TwcL[r['i']][:3, :3] for r in selected])
    RB = np.array([r['Tpnp'][:3, :3] for r in selected])
    idx = np.arange(len(A))
    tr, te = idx[::2], idx[1::2]
    out = dict(n_fit=len(selected), min_inliers=th, traj_extent_m=float(np.ptp(A, 0).max()))
    fits = dict(se3=lambda a, b, ra, rb: robust_fit(a, b, False),
                sim3=lambda a, b, ra, rb: robust_fit(a, b, True), pose_avg=fit_pose_avg)
    for name, fn in fits.items():
        try:
            with np.errstate(divide='raise', invalid='raise'):
                T, _ = fn(A[tr], B[tr], RA[tr], RB[tr])
                _, R, _ = sim3_parts(T)
                e = np.linalg.norm(xf(T, A[te]) - B[te], axis=1)
                er = [rot_deg(RB[k], R @ RA[k]) for k in te]
                values = dict(scale=float(sim3_parts(T)[0]),
                              heldout_t_median_cm=float(np.median(e) * 100),
                              heldout_t_p90_cm=float(np.percentile(e, 90) * 100),
                              heldout_r_median_deg=float(np.median(er)),
                              heldout_r_p90_deg=float(np.percentile(er, 90)))
                if not all(np.isfinite(v) for v in values.values()):
                    raise ValueError('non-finite fit')
                out[name] = values
        except (ValueError, np.linalg.LinAlgError, FloatingPointError):
            continue  # Collinear/stationary centres can still be aligned using PnP rotations.
    if not any(name in out for name in fits):
        out['error'] = 'no finite, constrained transform'
        return None, out
    score = lambda name: out[name]['heldout_t_median_cm'] + 2 * out[name]['heldout_r_median_deg']
    if out['traj_extent_m'] >= 2.5:
        model = 'se3' if 'se3' in out else 'pose_avg'
        if 'sim3' in out and ('se3' not in out or
                              out['sim3']['heldout_t_median_cm'] < out['se3']['heldout_t_median_cm'] - 0.3):
            model = 'sim3'
        if 'pose_avg' in out and score('pose_avg') < score(model) - 0.5:
            model = 'pose_avg'
    else:
        candidates = [name for name in ('pose_avg', 'se3') if name in out]
        if not candidates:
            out['error'] = 'short trajectory does not constrain a rigid fit'
            return None, out
        model = min(candidates, key=score)
    try:
        with np.errstate(divide='raise', invalid='raise'):
            T, keep = fits[model](A, B, RA, RB)
        if not np.isfinite(T).all():
            raise ValueError('non-finite final transform')
    except (ValueError, np.linalg.LinAlgError, FloatingPointError):
        out['error'] = 'full-frame refit is degenerate'
        return None, out
    out.update(model=model, fit_inlier_frames=int(keep.sum()), heldout=out[model])
    if len(A) >= 16:
        first = np.arange(len(A)) < len(A) // 2
        try:
            T1, _ = fits['se3'](A[first], B[first], RA[first], RB[first])
            T2, _ = fits['se3'](A[~first], B[~first], RA[~first], RB[~first])
            centre = A.mean(0)[None]  # Input points must remain in HOMIE world for both transforms.
            out['halves_disagree_cm'] = float(np.linalg.norm(xf(T1, centre) - xf(T2, centre)) * 100)
        except (ValueError, np.linalg.LinAlgError, FloatingPointError):
            out['halves_check'] = 'trajectory halves do not constrain centre-only rigid fits'
        out['localized_span_s'] = float((selected[-1]['i'] - selected[0]['i']) / 30)
    return T, out



def floor_plane(ks, up):
    pc = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(ks.V)).voxel_down_sample(0.03)
    planes, rest = [], pc
    for _ in range(10):
        if len(rest.points) < 500: break
        pl, inl = rest.segment_plane(0.015, 3, 2000); n = np.array(pl[:3]); nn = np.linalg.norm(n)
        pl = np.array(pl) / nn
        if pl[:3] @ up < 0: pl = -pl
        if pl[:3] @ up > 0.9: planes.append((pl, len(inl)))
        rest = rest.select_by_index(inl, invert=True)
    if not planes: return None
    big = max(p[1] for p in planes)
    cands = [p for p, n in planes if n >= 0.2 * big]
    return max(cands, key=lambda p: p[3])   # lowest plane: largest offset d in n.x + d = 0 with n pointing up


def checks(hm, ks, T, use_depth):
    c, R, t = sim3_parts(T); up = R @ np.array([0, 0, 1.0]); out = {}
    pl = floor_plane(ks, up)
    if pl is not None:
        out['gravity_deg'] = float(np.degrees(np.arccos(np.clip(pl[:3] @ up, -1, 1))))
        h = lambda p: p @ pl[:3] + pl[3]
        out['headcam_height_m'] = float(np.median(h(xf(T, hm.TwcL[:hm.n, :3, 3]))))
        if 'mocap_main/annotation.hdf5' in hm.src.listing() or hm.src.local:
            try:
                with hm.src.open('mocap_main/annotation.hdf5') as stream, h5py.File(stream, 'r') as a:
                    kp = a['full_body_mocap/keypoints'][:]
                toe = np.minimum(h(xf(T, kp[:, 10])), h(xf(T, kp[:, 11])))
                out['lowest_toe_cm_median'] = float(np.median(toe) * 100)
                out['toe_below_floor_5cm_pct'] = float(np.mean(toe < -0.05) * 100)
            except Exception as e: out['body_error'] = repr(e)[:100]
    if use_depth:
        try:
            # Read sampled frames from the local depth export.
            f = h5py.File(hm.src.path('mocap_main/depth.hdf5') if hm.src.local else hm.src.open('mocap_main/depth.hdf5'), 'r')
            dep, conf = f['depth'], f['confidence']; nd = min(hm.n, dep.shape[0])
            s = dep.shape[2] / hm.crop_src[0]; Kd = hm.Kfull * s
            ratios = []
            if hm.landmarks is not None:
                for i in range(0, nd, max(10, nd // 80)):
                    pc = xf(np.linalg.inv(hm.TwcL[i]), hm.landmarks); m = (pc[:, 2] > 0.3) & (pc[:, 2] < 2.5); pc = pc[m]
                    u = (Kd[0] * pc[:, 0] / pc[:, 2] + Kd[2]).astype(int); v = (Kd[1] * pc[:, 1] / pc[:, 2] + Kd[3]).astype(int)
                    ok = (u >= 0) & (u < dep.shape[2]) & (v >= 0) & (v < dep.shape[1]); d = dep[i][v[ok], u[ok]]; cf = conf[i][v[ok], u[ok]]
                    g = (d > 0.1) & (cf >= 80); ratios += list(d[g] / pc[ok][g, 2])
            ds = 1 / np.median(ratios) if len(ratios) > 100 else 1.0
            out['depth_over_slam_ratio'] = float(1 / ds)
            H, W = dep.shape[1:]; vv, uu = np.mgrid[0:H:2, 0:W:2]; pts = []
            for i in range(0, nd, max(6, nd // 200)):
                d = dep[i][::2, ::2] * ds; m = (d > 0.1) & (d < 2.5) & (conf[i][::2, ::2] >= 80)
                z = d[m]; p = np.stack([(uu[m] + .5 - Kd[2]) / Kd[0] * z, (vv[m] + .5 - Kd[3]) / Kd[1] * z, z], 1)
                pts.append(xf(T @ hm.TwcL[i], p))
            if not any(len(points) for points in pts):
                raise ValueError('no valid, confident stereo depth points')
            P = np.concatenate(pts); P = P[np.unique(np.floor(P / 0.03).astype(np.int64), axis=0, return_index=True)[1]]
            mpts = np.asarray(ks.mesh.sample_points_uniformly(2_000_000).points)
            dd, _ = cKDTree(mpts).query(P); ov = dd < 0.2
            out['depth_overlap_pct'] = float(ov.mean() * 100)
            if not ov.any():
                raise ValueError('no stereo depth points overlap the mesh within 20 cm')
            out['depth_residual_median_cm'] = float(np.median(dd[ov]) * 100)
            src = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(P)); tgt = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(mpts)).voxel_down_sample(0.03)
            tgt.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=0.09, max_nn=30))
            Ti = np.eye(4)
            for thr in (0.15, 0.08, 0.04):
                Ti = o3d.pipelines.registration.registration_icp(src, tgt, thr, Ti, o3d.pipelines.registration.TransformationEstimationPointToPlane()).transformation
            cen = xf(T, hm.TwcL[:hm.n, :3, 3]).mean(0)
            out['icp_vs_final_rot_deg'] = rot_deg(np.eye(3), Ti[:3, :3]); out['icp_vs_final_trans_cm'] = float(np.linalg.norm(xf(Ti, cen[None])[0] - cen) * 100)
        except Exception as e: out['depth_error'] = repr(e)[:200]
    return out


# ---------------------------------------------------------------- outputs
def write_mocap(out, hm, T):
    """homie_mocap_in_kosmos.npz. Body keypoints are in the SLAM world -> T. The MANO hand joints in annotation.hdf5 are in
    the rectified stereo-left camera frame (OpenCV), so each frame goes through T @ T_world_camL[i] (the pose in
    homie_stereo_left_rect_in_kosmos.txt, plus the Sim3 scale). All-zero (missing) joints and frames without a pose -> NaN."""
    arr = {}
    # Read current annotation bytes, including when an older annotation is in the download cache.
    with hm.src.open('mocap_main/annotation.hdf5') as stream, h5py.File(stream, 'r') as a:
        body = a['full_body_mocap']
        kp = body['keypoints'][:]
        timestamps = body['timestamps_ns'] if 'timestamps_ns' in body else a['video/device_timestamp']
        arr['timestamps_ns'] = timestamps[:].astype(np.int64)
        hands = {k: a[f'hand_mocap/{k}'][:] for k in ('left_joints_3d', 'right_joints_3d') if f'hand_mocap/{k}' in a}
    def X(p):
        p = p.astype(float).copy(); bad = np.all(p == 0, -1); q = xf(T, p.reshape(-1, 3)).reshape(p.shape); q[bad] = np.nan; return q
    Tkc = T @ hm.TwcL
    def Xcam(p):
        p = p.astype(float); n = min(len(p), len(Tkc)); q = np.full(p.shape, np.nan)
        q[:n] = np.einsum('fij,fkj->fki', Tkc[:n, :3, :3], p[:n]) + Tkc[:n, None, :3, 3]
        q[np.all(p == 0, -1)] = np.nan; return q
    arr['body_keypoints_smplh52'] = X(kp)
    for k, v in hands.items(): arr[k.replace('_joints_3d', '_hand_joints21')] = Xcam(v)
    np.savez_compressed(f'{out}/homie_mocap_in_kosmos.npz', **arr)


def write_outputs(out, hm, ks, T, loc, metrics, make_figures=True):
    c, R, t = sim3_parts(T)
    def tum(fn, Ts, hdr):
        with open(fn, 'w') as f:
            f.write(f'# {hdr}\n# timestamp_s tx ty tz qx qy qz qw (T_kosmos_from_frame, Kosmos COLMAP world, metres)\n')
            for s, Tf in zip(hm.ts[:hm.n], Ts[:hm.n]):
                q = Rot.from_matrix(R @ Tf[:3, :3]).as_quat(); p = c * R @ Tf[:3, 3] + t
                f.write(f'{s:.6f} ' + ' '.join(f'{v:.6f}' for v in p) + ' ' + ' '.join(f'{v:.8f}' for v in q) + '\n')
    tum(f'{out}/homie_body_in_kosmos.txt', hm.Twb, 'Homie body/IMU frame')
    tum(f'{out}/homie_stereo_left_rect_in_kosmos.txt', hm.TwcL, 'Homie rectified stereo-left camera (stereo_left_synced.mp4)')
    metrics['exports'] = {}
    if 'mocap_main/annotation.hdf5' in hm.src.listing():
        try:
            write_mocap(out, hm, T)
            metrics['exports']['mocap'] = 'written'
        except Exception as e:
            metrics['exports']['mocap_error'] = str(e)
            log('mocap export skipped:', repr(e)[:120])
    else:
        metrics['exports']['mocap'] = 'not supplied'
    write_json(f'{out}/transform.json', dict(S_kosmos_from_homie=T.tolist(), scale=float(c), model=metrics['fit']['model'] if metrics.get('fit') else None,
                   apply='p_kosmos = S @ [p_homie_world; 1]; Homie world = f_slam.txt world',
                   kosmos=metrics['kosmos'], homie=metrics['homie']), indent=1)
    write_json(f'{out}/pnp_frames.json', [dict(i=r['i'], inl=r['inl'], Tpnp=r['Tpnp'].tolist()) for r in loc])
    if not make_figures:
        return
    # overlay figure
    frames = np.linspace(0.1 * hm.n, 0.9 * hm.n, 4).astype(int); rows = []
    u, v = np.meshgrid(np.arange(hm.W) + 0.5, np.arange(hm.H) + 0.5)
    dirs = np.stack([(u - hm.K[0, 2]) / hm.K[0, 0], (v - hm.K[1, 2]) / hm.K[1, 1], np.ones_like(u)], -1).reshape(-1, 3)
    for i in frames:
        fr = hm.frame(i, gray=False); Tk = T @ hm.TwcL[i]; Rk = Tk[:3, :3] / c
        r = ks.scene.cast_rays(o3d.core.Tensor(np.concatenate([np.tile(Tk[:3, 3], (len(dirs), 1)), dirs @ Rk.T], 1).astype(np.float32)))
        th = r['t_hit'].numpy(); pid = r['primitive_ids'].numpy(); uv = r['primitive_uvs'].numpy(); hit = np.isfinite(th)
        img = np.zeros((len(th), 3)); tri = ks.F[pid[hit]]; w1, w2 = uv[hit, 0], uv[hit, 1]
        img[hit] = ks.VC[tri[:, 0]] * (1 - w1 - w2)[:, None] + ks.VC[tri[:, 1]] * w1[:, None] + ks.VC[tri[:, 2]] * w2[:, None]
        ren = (np.clip(img, 0, 1) * 255).astype(np.uint8).reshape(hm.H, hm.W, 3)[:, :, ::-1].copy()
        e = cv2.Canny(cv2.GaussianBlur(cv2.cvtColor(ren, cv2.COLOR_BGR2GRAY), (5, 5), 0), 40, 110)
        eo = fr.copy(); eo[cv2.dilate(e, np.ones((2, 2), np.uint8)) > 0] = (60, 255, 60)
        rows.append(np.hstack([cv2.resize(x, (hm.W // 2, hm.H // 2)) for x in (fr, ren, eo)]))
    cv2.imwrite(f'{out}/overlay.jpg', np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])
    # top-down figure
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    up = R @ np.array([0, 0, 1.0]); x = np.array([1.0, 0, 0]) - up[0] * up; x /= np.linalg.norm(x); B = np.stack([x, np.cross(up, x), up])
    Vf = ks.V @ B.T; z0 = np.percentile(Vf[:, 2], 2); keep = Vf[:, 2] - z0 < 1.3; o_ = np.argsort(Vf[keep, 2])
    fig, ax = plt.subplots(figsize=(10, 8), dpi=130)
    ax.scatter(Vf[keep][o_][::2, 0], Vf[keep][o_][::2, 1], s=0.2, c=ks.VC[keep][o_][::2], rasterized=True)
    cam = xf(T, hm.TwcL[:hm.n, :3, 3]) @ B.T
    sc = ax.scatter(cam[:, 0], cam[:, 1], c=np.arange(hm.n) / 30, s=3, cmap='viridis', zorder=5); plt.colorbar(sc, ax=ax, shrink=0.6, label='Homie time (s)')
    if loc:
        pp = np.array([r['Tpnp'][:3, 3] for r in loc if r['inl'] >= 40]).reshape(-1, 3) @ B.T
        ax.scatter(pp[:, 0], pp[:, 1], marker='x', c='red', s=14, zorder=6, label='visual PnP (independent)'); ax.legend(loc='lower left', fontsize=8)
    ax.set_aspect('equal'); ax.set_title(metrics['kosmos']['name'] + '  |  ' + metrics['verdict']); plt.tight_layout(); plt.savefig(f'{out}/topdown.png'); plt.close()
