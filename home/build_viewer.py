"""Data for the highlights gallery (viewer.js): one card per LH_177 home, each a scan and one PASS recording in it.

From the film's data (video/flythrough/data/<scene>/, read only) it writes, per card:
  data/<scene>/scene.spz            the full scan (the film's, footprint-cropped)
  data/<scene>/scene.json           its view frame: view_R, floor and ceiling heights, bounds
  data/<scene>/<take>/              body.f32, hands.f32, cam.f32 (whole take); mesh.f32 + mesh.json cut to the card's
                                    window; take.json with the verdict only (no accuracy numbers); the head camera's
                                    frames in the window, 720 px wide
and data/viewer.json, the cards in gallery order: scene, take, window, place, task, and the camera's vantage (view
frame, metres; clear of the scene by >= 1 m: the film's for LH_17763, shots/act1.js, and tools/find_vantage.py's on
these windows for the other two), which viewer.js sweeps slowly round the operator.
LH_17764's PASS recordings had no 3D window in the film's data, so b80d1bf3's (frames 1470-1830, at the microwave)
was exported on h200-sg2 into /mnt/local/lihao/website_viewer/ with the film's export_motion.py and
export_ego_frames.py (figvenv, --scene LH_17764 --take b80d1bf3 --frames 1470 1830), then pulled with take.json,
body.f32 and cam.f32 from the mocap viewer site's data into PULL/LH_17764/b80d1bf3 (rsync).
Run from the repository root: python3 -I website/home/build_viewer.py [PULL]
"""
import sys
import json
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
FILM = ROOT / 'video/flythrough/data'
DATA = ROOT / 'website/home/data'

CARDS = [
    {'scene': 'LH_17763', 'take': '58dd0e81', 'win': [1260, 1620], 'place': 'Dining area',
     'line': 'Wiping the dining table, then tidying up.',
     'pos': [3.292, 0.303, 1.565], 'look': [3.85, -0.24, -0.56], 'fov': 51, 'near': 0.12},   # the film's (act 1)
    {'scene': 'LH_17764', 'take': 'b80d1bf3', 'win': [1470, 1830], 'place': 'Kitchen', 'pulled': True,
     'line': 'Putting a food container in the microwave.',
     'pos': [0.152, 0.324, 1.517], 'look': [1.34, -0.18, 0.28], 'fov': 50, 'near': 0.1},    # tools/find_vantage.py
    {'scene': 'LH_17766', 'take': '89d5e5a4', 'win': [1990, 2230], 'place': 'Living room',
     'line': 'Moving a small device, then reaching for the AC remote.',
     'pos': [0.588, 0.342, 1.852], 'look': [1.42, -0.26, 3.38], 'fov': 50, 'near': 0.1},    # tools/find_vantage.py
]


def main():
    index = {s['id']: s for s in json.loads((FILM / 'index.json').read_text())['scenes']}
    out = []
    pull = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    for c in CARDS:
        sid, tid, (w0, w1) = c['scene'], c['take'], c['win']
        src, dst = FILM / sid, DATA / sid
        tsrc = pull / sid / tid if c.get('pulled') else src / tid
        (dst / tid / 'frames').mkdir(parents=True, exist_ok=True)
        if not (dst / 'scene.spz').exists() or (dst / 'scene.spz').stat().st_size != (src / 'scene.spz').stat().st_size:
            shutil.copyfile(src / 'scene.spz', dst / 'scene.spz')
        s = index[sid]
        (dst / 'scene.json').write_text(json.dumps({'id': sid, 'view_R': s['view_R'], 'floor_y': s['floor_y'],
                                                    'ceiling_y': s['ceiling_y'], 'bounds': s['bounds_view']}, indent=1))
        for f in ('body.f32', 'hands.f32', 'cam.f32'):
            shutil.copyfile(tsrc / f, dst / tid / f)
        mj = json.loads((tsrc / 'mesh.json').read_text())
        n = mj['verts'] * 3 * 4
        raw = (tsrc / 'mesh.f32').read_bytes()
        (dst / tid / 'mesh.f32').write_bytes(raw[(w0 - mj['f0']) * n:(w1 - mj['f0']) * n])
        (dst / tid / 'mesh.json').write_text(json.dumps({'f0': w0, 'f1': w1, 'verts': mj['verts'], 'faces': mj['faces']}))
        take = json.loads((tsrc / 'take.json').read_text())
        take['metrics'] = {'verdict': take['metrics']['verdict']}   # PASS only, no accuracy numbers
        assert take['metrics']['verdict'] == 'PASS', (sid, tid)
        (dst / tid / 'take.json').write_text(json.dumps(take, separators=(',', ':')))
        for f in range(w0, w1):
            fp, op = tsrc / 'frames' / f'{f:05d}.jpg', dst / tid / 'frames' / f'{f:05d}.jpg'
            if fp.exists() and not op.exists():
                im = Image.open(fp).convert('RGB')
                im.resize((720, round(im.height * 720 / im.width)), Image.LANCZOS).save(op, quality=76)
        out.append({k: c[k] for k in ('scene', 'take', 'win', 'place', 'line', 'pos', 'look', 'fov', 'near')} | {'task': take['caption']['main_task'], 'duration': take['duration']})
        print(sid, tid, w0, w1, take['caption']['main_task'])
    (DATA / 'viewer.json').write_text(json.dumps({'cards': out}, indent=1))


if __name__ == '__main__':
    main()
