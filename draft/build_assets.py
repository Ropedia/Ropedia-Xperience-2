#!/usr/bin/env python3
"""Build the website draft's images and data.js from the launch-video renders, the paper and the mosaic atlas.

Run from anywhere:  python3 -I website/draft/build_assets.py
Writes website/draft/assets/* and website/draft/data.js. Sources are read only.
"""
import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
V = ROOT / 'video'
FLY = V / 'flythrough'
OUT = HERE / 'assets'
OUT.mkdir(parents=True, exist_ok=True)

# Crop that drops the film HUD (logo, chapter label, subtitles, scene label) from a 1920 x 1080 frame.
HUD_CROP = (300, 96, 1651, 856)


def save(im, name, width=1600, q=82):
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.convert('RGB').save(OUT / name, quality=q, optimize=True, progressive=True)


def frame(src, name, crop=None, width=1600):
    im = Image.open(src)
    if crop:
        im = im.crop(crop)
    save(im, name, width)


# ---------------------------------------------------------------- film frames per section
FRAMES = {
    # posters shown until each live page is ready
    'hero_lockup.jpg': 'mosaic/out/frames_1080_grid/00612.jpg',
    'pipe_capture_scan.jpg': 'flythrough/out/frames_act2_tree/00200.jpg',
    'pipe_capture_tasks.jpg': 'flythrough/out/frames_act2_tree/00440.jpg',
    'pipe_layers.jpg': 'flythrough/out/frames_act2_layers/00285.jpg',
    'pipe_register.jpg': 'flythrough/out/frames_act2_register/00200.jpg',
    'data_metrics.jpg': 'metrics/out/frames_act2/00380.jpg',
    'app_hub.jpg': 'metrics/out/uses_frames_act3/00280.jpg',
    'bench_depth.jpg': 'metrics/out/bench_frames/00260.jpg',
    'r2s_gap.jpg': 'metrics/out/frames_r2s14939/00150.jpg',
    'lh_run.jpg': 'metrics/out/frames_traj/00150.jpg',
    'rt_match.jpg': 'flythrough/out/frames_rt_seq/00120.jpg',
    'rt_wall.jpg': 'flythrough/out/frames_xemb_wall/00150.jpg',
    'rt_triptych.jpg': 'flythrough/out/frames_close/00110.jpg',
}
for name, rel in FRAMES.items():
    frame(V / rel, name)

# Real | sim pair from the same camera (Real-to-Sim seam slider)
frame(V / 'metrics/data/r2s/real/00120.jpg', 'r2s_real.jpg')
frame(V / 'metrics/data/r2s/sim/00120.jpg', 'r2s_sim.jpg')

# ---------------------------------------------------------------- scenes (act 1 shots, HUD cropped off)
ACT1 = [  # n, type label as in the film, scene
    (1, 'Urban street', 'CITY_STREET_11147'), (2, 'Outdoor corridor', 'OUTDOOR_CORRIDOR_11940'),
    (3, 'Parking lot', 'CAR_PARK_11019'), (4, 'Store', 'SHOP_13233'), (5, 'Restaurant', 'RESTAURANT_12594'),
    (6, 'Office', 'OFFICE_ENTRANCE_11460'), (7, 'Meeting room', 'MEETING_ROOM_11027'),
    (8, 'Laundry', 'LAUNDRY_11628'), (9, 'Living room', 'LH_17763'), (10, 'Kitchen', 'LH_17764'),
    (11, 'Bedroom', 'BEDROOM_17084'), (12, 'Multi-room', 'LH_B-3A-09'),
]
more = []
for n, label, scene in ACT1:
    frame(FLY / f'out/frames_act1_{n}/00030.jpg', f'more_{n:02d}.jpg', crop=HUD_CROP, width=560)
    more.append({'img': f'assets/more_{n:02d}.jpg', 'type': label, 'scene': scene})

# ---------------------------------------------------------------- Explore: four scenes, real captions and timelines
SCENES = [
    # id, display name, type, poster frame, crop, current take, live flythrough shot (query) and its length (s)
    ('LH_17761', 'Apartment', 'Multi-room home', FLY / 'out/frames_rt_seq_nohud/00030.jpg', None, '7659f6d6', 'shot=lh17761', 15),
    ('SHOP_13233', 'Repair shop', 'Store', FLY / 'out/frames_act1_4/00030.jpg', HUD_CROP, '3839faa2', 'shot=act1_grid&n=4&dur=8', 8),
    ('RESTAURANT_12594', 'Food court', 'Restaurant', FLY / 'out/frames_act1_5/00030.jpg', HUD_CROP, 'c0ace13d', 'shot=act1_grid&n=5&dur=8', 8),
    ('OUTDOOR_CORRIDOR_11940', 'Covered sidewalk', 'Outdoor corridor', FLY / 'out/frames_act1_2/00030.jpg', HUD_CROP, '65d2b6c1', 'shot=act1_grid&n=2&dur=8', 8),
]


def first_sentence(text):
    text = (text or '').strip()
    cut = text.find('. ')
    return text if cut < 0 else text[:cut + 1]


def merge_blocks(segments):
    blocks = []
    for s in segments:
        if blocks and blocks[-1]['label'] == s['sub_task'] and s['s'] <= blocks[-1]['e'] + 1:
            blocks[-1]['e'] = s['e']
        else:
            blocks.append({'s': s['s'], 'e': s['e'], 'label': s['sub_task']})
    return blocks


def take_summary(take_dir):
    d = json.loads((take_dir / 'take.json').read_text())
    return d, {'id': d['id'], 'task': d['caption']['main_task'], 'dur': round(d['duration']),
               'verdict': d['metrics']['verdict']}


explore = []
for sid, name, typ, view, crop, cur, shot, shot_len in SCENES:
    sdir = FLY / 'data' / sid
    takes = []
    for td in sorted(p for p in sdir.iterdir() if (p / 'take.json').exists()):
        d, summ = take_summary(td)
        if summ['verdict'] == 'PASS':
            takes.append(summ)
    d = json.loads((sdir / cur / 'take.json').read_text())
    c = d['caption']
    ego_frames = sorted((sdir / cur / 'frames').glob('*.jpg'))
    ego = ego_frames[min(len(ego_frames) - 1, 65)] if sid == 'LH_17761' else ego_frames[len(ego_frames) // 2]
    f = int(ego.stem)
    seg = next((s for s in c['segments'] if s['s'] <= f <= s['e']), None)
    act = next((a for a in c['actions'] if a['s'] <= f <= a['e']), None)
    inter = min(c['interactions'], key=lambda x: abs(x['f'] - f)) if c.get('interactions') else None
    hands = min(c['hands'], key=lambda x: abs(x['f'] - f)) if c.get('hands') else None
    tag = sid.lower().replace('_', '')
    frame(view, f'view_{tag}.jpg', crop=crop)
    frame(ego, f'ego_{tag}.jpg', width=640)
    frame(view, f'thumb_{tag}.jpg', crop=crop or HUD_CROP, width=520)

    def hand(h):
        if not h or not h.get('visible'):
            return 'not visible'
        return f"{h.get('grasp') or 'free'}{' · ' + h['object'] if h.get('object') else ''}"

    explore.append({
        'id': sid, 'name': name, 'type': typ, 'shot': shot, 'shotLen': shot_len,
        'view': f'assets/view_{tag}.jpg', 'thumb': f'assets/thumb_{tag}.jpg', 'ego': f'assets/ego_{tag}.jpg',
        'takes': takes, 'current': cur, 'frame': f, 'frames': d['frames'], 'fps': d['fps'],
        'mainTask': c['main_task'],
        'subTask': seg['sub_task'] if seg else '',
        'action': act['label'] if act else '', 'actionText': first_sentence(act['description']) if act else '',
        'interaction': inter['text'] if inter else '',
        'hands': {'left': hand(hands and hands.get('left')), 'right': hand(hands and hands.get('right'))},
        'objects': (seg or {}).get('objects', []),
        'blocks': merge_blocks(c['segments']),
        'actions': [{'s': a['s'], 'e': a['e'], 'label': a['label']} for a in c['actions']],
    })

# ---------------------------------------------------------------- paper teaser, devices, logo, font
subprocess.run(['pdftoppm', '-jpeg', '-r', '300', '-singlefile', str(ROOT / 'figs/teaser.pdf'), str(OUT / 'teaser_raw')], check=True)
frame(OUT / 'teaser_raw.jpg', 'teaser.jpg', width=2000)
(OUT / 'teaser_raw.jpg').unlink()
frame(FLY / 'assets/devices/kosmo.png', 'device_kosmo.jpg', width=720)
frame(FLY / 'assets/devices/homie.jpg', 'device_homie.jpg', width=720)
shutil.copy(FLY / 'assets/ropedia_brand.png', OUT / 'ropedia_brand.png')
(OUT / 'fonts').mkdir(exist_ok=True)
shutil.copy(V / 'mosaic/assets/fonts/InterTight-var.woff2', OUT / 'fonts/InterTight-var.woff2')

# ---------------------------------------------------------------- data.js
data = {'explore': explore, 'more': more}
(HERE / 'data.js').write_text('// Generated by build_assets.py. Do not edit by hand.\nwindow.DRAFT = '
                              + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(f'explore scenes: {len(explore)}; files in {OUT}')
