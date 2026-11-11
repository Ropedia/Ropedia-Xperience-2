"""Assets for the capture story (story.js): one card per recording of LH_17761 and the HOMIE Gen 2 picture.

Reads the film's per-take thumbnail clips (video/flythrough/data/LH_17761/<take>/thumbs, 480 x 272, the clip each row of
the film's act-2 chart plays) and the website's registered head paths (data/LH_17761/<take>/cam.f32), and writes:
  data/LH_17761/<take>/clip.jpg   60 frames (every other one, 15 fps), 176 x 100 each, 10 x 6 grid
  data/LH_17761/recordings.json   the cards in drawing order: take, label, colour, length, the frame range, and a pin
                                  where the clip's work happens (the head 0.45 m ahead of itself, at worktop height)
  assets/homie_gen2.jpg           the HOMIE Gen 2 product render, cropped 16:9
  data/LH_17761/<take>/...        for the step-3 cases besides 7659f6d6 (build.py's): the film's 240-frame window, as
                                  build.py exports the hero take (body, hands, SMPL-H mesh, take.json with the verdict
                                  only, head-camera frames 720 px wide)
Cards run top to bottom in the order their pins sit in the plan view (screen up = -z), so the links barely cross.
Run from the repository root: python3 -I website/home/build_story.py
"""
import json
import shutil
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
FILM = ROOT / 'video/flythrough/data/LH_17761'
HOME = ROOT / 'website/home'
DATA = HOME / 'data/LH_17761'

# short card labels (the clip and the recording's task), written for the cards
LABELS = {
    '15be10ce': 'Doing the laundry',
    '3c1c734a': 'Tidying up the kitchen',
    '7659f6d6': 'Folding a towel and sweeping',
    '9dd4f1b9': 'Reheating food',
    'a5cb67e0': 'Putting away laundry tools',
    'bef95eae': 'Using the AC remote',
    'e082d579': 'Putting away dishes',
    'fda6e5d5': 'Charging a phone',
}
PALETTE = ['#4FD1C5', '#FF9F43', '#B39DFF', '#7AC4D8', '#FFD166', '#9CC3FF', '#F28B82']
HERO, HERO_COL = '7659f6d6', '#FF6B9A'   # the one the story ends on keeps the pink of its own head trail
TW, TH, COLS, ROWS = 176, 100, 10, 6
# step 3's cases: the recordings with a full 3D window, each seen from the film's clearance-checked vantage
# (shots/retarget_cuts.js; the dining table is the story's own, at eye height). near: the camera's near plane, which
# clips the wall or cabinet between the vantage and the operator, as in the film.
CASES = [
    {'id': '7659f6d6', 'place': 'Dining table', 'action': 'Folding a towel', 'pos': [0.7, 0.15, -0.9], 'look': [2.0, -0.35, 0.22], 'fov': 54, 'near': 0.05},
    {'id': '15be10ce', 'place': 'Laundry', 'action': 'Unloading the washer', 'pos': [2.76, 0.41, 2.89], 'look': [1.23, -0.32, 1.87], 'fov': 49, 'near': 0.12},
    {'id': 'e082d579', 'place': 'Kitchen', 'action': 'Putting away dishes', 'pos': [3.0, 0.72, 0.55], 'look': [1.15, -0.38, -1.2], 'fov': 51, 'near': 0.7},
    {'id': 'bef95eae', 'place': 'Bedroom', 'action': 'Placing a package', 'pos': [4.7, 0.65, 1.7], 'look': [3.3, -0.88, 3.25], 'fov': 51, 'near': 0.5},
]


def mat_vec(R, v):
    return [sum(R[i][k] * v[k] for k in range(3)) for i in range(3)]


def quat_rot(q, v):   # (x, y, z, w) rotating v
    x, y, z, w = q
    tx, ty, tz = 2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]


def main():
    scene = json.loads((DATA / 'scene.json').read_text())
    R, floor = scene['view_R'], scene['floor_y']
    takes = {t['id']: t for t in scene['takes']}
    recs = []
    for tid, label in LABELS.items():
        frames = sorted((FILM / tid / 'thumbs').glob('*.jpg'))
        f0, f1 = int(frames[0].stem), int(frames[-1].stem)
        # the clip: every other frame, on one sheet
        sheet = Image.new('RGB', (TW * COLS, TH * ROWS))
        for k, fp in enumerate(frames[::2][:COLS * ROWS]):
            im = Image.open(fp).convert('RGB').resize((TW, TH), Image.LANCZOS)
            sheet.paste(im, ((k % COLS) * TW, (k // COLS) * TH))
        sheet.save(DATA / tid / 'clip.jpg', quality=80, optimize=True)
        # the pin: the head at the clip's middle, 0.45 m ahead along its gaze in the floor plane, at worktop height
        raw = (DATA / tid / 'cam.f32').read_bytes()
        m = (f0 + f1) // 2
        c = struct.unpack_from('<7f', raw, 28 * m)
        head = mat_vec(R, c[:3])
        fwd = mat_vec(R, quat_rot(c[3:], [0, 0, 1]))
        n = (fwd[0] ** 2 + fwd[2] ** 2) ** 0.5 or 1
        pin = [head[0] + 0.45 * fwd[0] / n, floor + 0.85, head[2] + 0.45 * fwd[2] / n]
        recs.append({'id': tid, 'label': label, 'task': takes[tid]['task'], 'duration': takes[tid]['duration'],
                     'f0': f0, 'frames': len(frames[::2][:COLS * ROWS]), 'pin': [round(v, 3) for v in pin]})
    recs.sort(key=lambda r: r['pin'][2])
    k = 0
    for r in recs:
        if r['id'] == HERO:
            r['color'] = HERO_COL
        else:
            r['color'] = PALETTE[k % len(PALETTE)]; k += 1
    (DATA / 'recordings.json').write_text(json.dumps({'tile': [TW, TH], 'cols': COLS, 'fps': 15, 'recordings': recs, 'cases': CASES}, indent=1))
    for c in CASES[1:]:   # their 3D windows
        src, dst = FILM / c['id'], DATA / c['id']
        for f in ('body.f32', 'hands.f32', 'mesh.f32', 'mesh.json'):
            shutil.copyfile(src / f, dst / f)
        take = json.loads((src / 'take.json').read_text())
        take['metrics'] = {'verdict': take['metrics']['verdict']}   # PASS only, no accuracy numbers
        (dst / 'take.json').write_text(json.dumps(take, separators=(',', ':')))
        mj = json.loads((src / 'mesh.json').read_text())
        (dst / 'frames').mkdir(exist_ok=True)
        for f in range(mj['f0'], mj['f1']):
            fp = src / 'frames' / f'{f:05d}.jpg'
            if fp.exists():
                im = Image.open(fp).convert('RGB')
                im.resize((720, round(im.height * 720 / im.width)), Image.LANCZOS).save(dst / 'frames' / f'{f:05d}.jpg', quality=76)
    # HOMIE Gen 2: the product render, 16:9 around the device
    im = Image.open(ROOT / 'output/collection-figure/refs/homie-gen2-product.png').convert('RGB')
    w, h = im.size
    cw, ch = int(w * 0.8), int(w * 0.8 * 9 / 16)
    cx, cy = int(w * 0.455), int(h * 0.44)
    im.crop((cx - cw // 2, cy - ch // 2, cx + cw // 2, cy + ch // 2)).resize((1280, 720), Image.LANCZOS).save(
        HOME / 'assets/homie_gen2.jpg', quality=86, optimize=True)
    for r in recs:
        print(r['id'], r['label'], r['color'], r['pin'])


if __name__ == '__main__':
    main()
