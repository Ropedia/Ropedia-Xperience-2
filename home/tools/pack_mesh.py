#!/usr/bin/env python3
"""Pack each recording window's body mesh (data/**/mesh.f32, float32 vertices per frame) into mesh.q16z, about a
quarter of the size, for the page to download instead (engine.js, meshF32).

mesh.q16z: gzip of the vertices quantized to uint16 per axis over the window's bounding box, as the change from the
previous frame (mod 2^16; the first frame as is), written as all the low bytes and then all the high bytes. The box
goes into mesh.json as "q16": {"file", "lo", "hi"}; the error is well under 0.1 mm. mesh.f32 stays: the build scripts
read it, and the page falls back to it when mesh.json has no "q16" (a build script that rewrites mesh.json drops it,
so run this again after one).

  python3 tools/pack_mesh.py            pack every mesh.f32 whose mesh.q16z is missing or older
  python3 tools/pack_mesh.py --force    pack them all
"""
import argparse
import gzip
import json
from pathlib import Path

import numpy as np

HOME = Path(__file__).resolve().parent.parent


def pack(f32, force=False):
    d = f32.parent
    mj_path, out = d / 'mesh.json', d / 'mesh.q16z'
    mj = json.loads(mj_path.read_text())
    if not force and out.exists() and out.stat().st_mtime >= f32.stat().st_mtime and 'q16' in mj:
        return None
    v = np.fromfile(f32, np.float32).reshape(-1, 3)
    lo, hi = v.min(0).astype(np.float64), v.max(0).astype(np.float64)
    span = np.where(hi > lo, hi - lo, 1.0)
    q = np.round((v - lo) / span * 65535).astype(np.int64)
    err = float(np.abs(q / 65535 * span + lo - v).max())
    per = mj['verts'] * 3
    q = q.reshape(-1, per)
    dq = (np.diff(q, axis=0, prepend=0) % 65536).astype('<u2').ravel()
    planes = dq.view(np.uint8).reshape(-1, 2)
    out.write_bytes(gzip.compress(planes[:, 0].tobytes() + planes[:, 1].tobytes(), 9, mtime=0))
    mj['q16'] = {'file': out.name, 'lo': lo.tolist(), 'hi': hi.tolist()}
    mj_path.write_text(json.dumps(mj, indent=1))
    return f32.stat().st_size, out.stat().st_size, err


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    for f in sorted((HOME / 'data').rglob('mesh.f32')):
        r = pack(f, a.force)
        if r:
            print(f'{f.relative_to(HOME)}: {r[0] / 1e6:.1f} MB -> {r[1] / 1e6:.1f} MB (max error {r[2] * 1000:.3f} mm)')


if __name__ == '__main__':
    main()
