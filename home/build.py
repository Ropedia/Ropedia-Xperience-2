#!/usr/bin/env python3
"""Data and images for the Xperience homepage, derived from the launch video's sources in video/ (read only).

    python3 -I website/home/build.py

Writes website/home/{vendor,assets,data}/. Scene: LH_17761 (lite 3DGS), recording 7659f6d6's dining-table window
(frames 1265-1504) with its SMPL-H mesh, MANO hands, head-camera frames and both retargeted robots, the other PASS
recordings' head paths, KOSMO's scan path; the hero's X of scene tiles; the Real-to-Sim frames and boxes; the
long-horizon run 203; the benchmark table.
"""
import json
import math
import random
import shutil
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
V = ROOT / 'video'
FLY = V / 'flythrough'
MET = V / 'metrics'
A = HERE / 'assets'
D = HERE / 'data'
for p in (A, D):
    p.mkdir(parents=True, exist_ok=True)


def jpg(src, dst, width=None, q=82, crop=None):
    im = Image.open(src).convert('RGB')
    if crop:
        im = im.crop(crop)
    if width and im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, quality=q, optimize=True, progressive=True)


def copy(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, dst)


# ---------------------------------------------------------------- libraries, font, logo (the film's versions)
shutil.copytree(FLY / 'vendor', HERE / 'vendor', dirs_exist_ok=True)
copy(V / 'mosaic/assets/fonts/InterTight-var.woff2', A / 'fonts/InterTight-var.woff2')
copy(FLY / 'assets/ropedia_brand.png', A / 'ropedia_brand.png')

# ---------------------------------------------------------------- scene LH_17761 and its PASS recordings
SC = 'LH_17761'
HERO_TAKE = '7659f6d6'
index = json.loads((FLY / 'data/index.json').read_text())
sc = next(s for s in index['scenes'] if s['id'] == SC)
sdir, out = FLY / 'data' / SC, D / SC
copy(sdir / 'scene_lite.spz', out / 'scene_lite.spz')
copy(FLY / 'data/faces.u32', out / 'faces.u32')
kp = json.loads((sdir / 'kosmo_path.json').read_text())
takes = []
for t in sc['takes']:
    if t['verdict'] != 'PASS' or not (sdir / t['id'] / 'cam.f32').exists():
        continue
    copy(sdir / t['id'] / 'cam.f32', out / t['id'] / 'cam.f32')
    takes.append({'id': t['id'], 'frames': t['frames'], 'duration': round(t['duration'], 1), 'task': t['main_task']})
scene = {
    'id': SC, 'view_R': sc['view_R'], 'bounds': sc['bounds_view'], 'floor_y': sc['floor_y'], 'ceiling_y': sc['ceiling_y'],
    'scan': [[round(v, 3) for v in c] for c in kp['c'][::2]],     # KOSMO camera_6 centres in time order, every other pose
    'takes': takes, 'hero': HERO_TAKE,
}
(out / 'scene.json').write_text(json.dumps(scene, separators=(',', ':')))

# the hero recording: one window at the dining table, everything the film's stop draws
td, to = sdir / HERO_TAKE, out / HERO_TAKE
for f in ('body.f32', 'hands.f32', 'mesh.f32', 'mesh.json', 'robot.json', 'robot_mesh.bin', 'robot_motion.f32',
          'robot_b.json', 'robot_b_mesh.bin', 'robot_b_motion.f32'):
    copy(td / f, to / f)
take = json.loads((td / 'take.json').read_text())
take['metrics'] = {'verdict': take['metrics']['verdict']}       # the page shows PASS only, no accuracy numbers
(to / 'take.json').write_text(json.dumps(take, separators=(',', ':')))
mj = json.loads((td / 'mesh.json').read_text())
for f in range(mj['f0'], mj['f1']):
    src = td / 'frames' / f'{f:05d}.jpg'
    if src.exists():
        jpg(src, to / 'frames' / f'{f:05d}.jpg', width=720, q=76)

# ---------------------------------------------------------------- hero: X of scene tiles from the mosaic atlas
# (a cell per QC record with a preview; build_data.py then keeps one per scan and sets the page's grades)
meta = json.loads((V / 'mosaic/data/atlas.json').read_text())
atlas = Image.open(V / 'mosaic/data/atlas.png').convert('RGB')
recs = json.loads((MET / 'data/records.json').read_text())
TW, TH = 64, 36                                    # small atlas tile
acw, ach = meta['cell']
g, acols, count = meta['gutter'], meta['cols'], meta['count']
SC_COLS = 32
small = Image.new('RGB', (SC_COLS * TW, -(-count // SC_COLS) * TH), (12, 12, 12))
for i in range(count):
    x, y = (i % acols) * acw + g, (i // acols) * ach + g
    small.paste(atlas.crop((x, y, x + meta['tile'][0], y + meta['tile'][1])).resize((TW, TH), Image.LANCZOS),
                ((i % SC_COLS) * TW, (i // SC_COLS) * TH))
small.save(A / 'atlas_small.jpg', quality=80, optimize=True, progressive=True)

records = [r for r in recs['records'] if isinstance(r.get('tile'), int) and 0 <= r['tile'] < count]   # scenes with a preview
pool = list(range(len(records)))
random.Random(1812).shuffle(pool)
# X geometry, a bold letter X: two bands of perpendicular thickness T = 0.24 W around the diagonals from (a, 0) to
# (W - a, H) and from (W - a, 0) to (a, H), a = 0.13 W, cut flat at top and bottom; W = 1.05 H. Grow until it holds
# every scene.
XW, TF, INSET = 1.05, 0.24, 0.13
for rows in range(40, 160):
    cols = round(XW * rows * 9 / 16)
    W, H = cols * 16, rows * 9
    a, T = INSET * W, TF * W
    L = math.hypot(W - 2 * a, H)
    cells = []
    for r in range(rows):
        for c in range(cols):
            x, y = c * 16 + 8, r * 9 + 4.5
            d1 = abs((W - 2 * a) * y - H * (x - a)) / L
            d2 = abs((W - 2 * a) * y + H * (x - (W - a))) / L
            if min(d1, d2) <= T / 2:
                cells.append((r, c))
    if len(cells) >= len(records) + 1:
        break
slope = (W - 2 * a) / H
half = T / 2 * math.sqrt(1 + slope ** 2)          # half the crossing's width on the middle row, units
mid = min(cells, key=lambda rc: (rc[0] - (rows - 1) / 2) ** 2 + ((rc[1] - (cols - 1) / 2) * 16 / 9) ** 2)
cells.remove(mid)
cells.sort(key=lambda rc: (rc[0] - mid[0]) ** 2 + ((rc[1] - mid[1]) * 16 / 9) ** 2)   # nearest first
out_cells = [[r, c, records[pool[k]]['tile'], records[pool[k]]['cat'], records[pool[k]]['qc']]
             for k, (r, c) in enumerate(cells[:len(records)])]
# 512 x 288 pictures of every tile: the hover preview, and the tiles nearest the centre late in the zoom
shutil.copytree(V / 'mosaic/data/tiles_hi', A / 'tiles_hi', dirs_exist_ok=True)
hi = [cell[2] for cell in out_cells[:60] if cell[2] >= 0]
centre = Image.open(ROOT / 'output/mosaic_thumbs/centre_tile/LH_17761_2104408938926264321.png').convert('RGBA')
bg = Image.new('RGBA', centre.size, (12, 12, 12, 255))
bg.alpha_composite(centre)
bg.convert('RGB').save(A / 'centre_tile.jpg', quality=88)
# the same scan at full resolution for the end of the dive: the film's closing plan view of LH_17761 (no HUD)
jpg(V / 'mosaic/data/outro_hero/00000.jpg', A / 'centre_full.jpg', q=88)
hero = {'rows': rows, 'cols': cols, 'centre': list(mid), 'atlasCols': SC_COLS, 'tile': [TW, TH], 'half': half, 'slope': slope,
        'shape': {'W': W, 'H': H, 'a': a, 'T': T},
        'cells': out_cells, 'hi': hi, 'categories': recs['rows'], 'outcomes': recs['outcomes']}
(D / 'hero.json').write_text(json.dumps(hero, separators=(',', ':')))

# ---------------------------------------------------------------- highlight cards
CROP = (300, 96, 1651, 856)                         # drops the film HUD from a 1920 x 1080 frame
grid = Image.new('RGB', (1800, 1013), (0, 0, 0))
for k, n in enumerate([4, 5, 2, 9, 10, 11, 1, 6, 12]):
    im = Image.open(FLY / f'out/frames_act1_{n}/00030.jpg').convert('RGB').crop(CROP).resize((592, 333), Image.LANCZOS)
    grid.paste(im, ((k % 3) * 604, (k // 3) * 340))
grid.save(A / 'hl_scenes.jpg', quality=84)
ego = Image.new('RGB', (1800, 1022), (0, 0, 0))
for k, src in enumerate([td / 'frames/01330.jpg', sdir / '15be10ce/frames' / sorted(p.name for p in (sdir / '15be10ce/frames').iterdir())[40],
                         FLY / 'data/SHOP_13233/3839faa2/frames' / sorted(p.name for p in (FLY / 'data/SHOP_13233/3839faa2/frames').iterdir())[30],
                         sdir / 'e082d579/frames' / sorted(p.name for p in (sdir / 'e082d579/frames').iterdir())[50]]):
    im = Image.open(src).convert('RGB').resize((894, 508), Image.LANCZOS)
    ego.paste(im, ((k % 2) * 906, (k // 2) * 514))
ego.save(A / 'hl_ego.jpg', quality=84)
jpg(FLY / 'out/frames_act2_layers_nohud/00008.jpg', A / 'hl_layers.jpg', width=1800)
regs = sorted((FLY / 'out/frames_act2_register_nohud').iterdir())
jpg(regs[-1], A / 'hl_register.jpg', width=1800)
jpg(MET / 'data/r2s/sim/00200.jpg', A / 'hl_sim.jpg', width=1800)
jpg(FLY / 'out/frames_xemb_wall_nohud/00150.jpg', A / 'hl_robots.jpg', width=1800)
jpg(V / 'mosaic/out/frames_1080_outro/00269.jpg', A / 'film_poster.jpg', width=1800)

# ---------------------------------------------------------------- Real-to-Sim: real | sim frames of one camera path, boxes
r2s = json.loads((MET / 'data/r2s/r2s.json').read_text())
F0, F1 = 71, 206                                    # frames rendered both as 3DGS and as simulator
for f in range(F0, F1 + 1, 2):
    for kind in ('real', 'sim'):
        jpg(MET / 'data/r2s' / kind / f'{f:05d}.jpg', D / 'r2s' / kind / f'{f:05d}.jpg', width=1440, q=74)
cards = []
for c in r2s['cards']:
    a, b = c['range']
    fr = sorted(int(p.stem) for p in (MET / 'data/r2s/cards' / c['id']).iterdir() if a <= int(p.stem) <= b)
    for f in fr[::2]:
        jpg(MET / 'data/r2s/cards' / c['id'] / f'{f:05d}.jpg', D / 'r2s/cards' / c['id'] / f'{f:05d}.jpg', width=560, q=74)
    cards.append({k: c[k] for k in ('id', 'type', 'tag', 'name', 'sub')} | {'frames': fr[::2]})
boxes = []
for b in r2s['boxes']:
    vis = b.get('vis', '')
    boxes.append({'id': b['id'], 'type': b['type'], 'v': b['v'], 'vis': vis[F0:F1 + 1]})
(D / 'r2s/r2s.json').write_text(json.dumps({
    'f0': F0, 'f1': F1, 'step': 2, 'W': 1920, 'H': 1080, 'cams': r2s['cams'][F0:F1 + 1], 'boxes': boxes,
    'types': r2s['types'], 'nobj': r2s['nobj'], 'nint': r2s['nint'], 'gap': r2s['gap'], 'cards': cards,
}, separators=(',', ':')))

# ---------------------------------------------------------------- long-horizon run 203
traj = json.loads((MET / 'data/traj/traj.json').read_text())
for p in sorted((MET / 'data/traj/chase').iterdir()):
    jpg(p, D / 'traj/chase' / p.name, width=1152, q=76)
copy(MET / 'data/traj/plan.png', D / 'traj/plan.png')
(D / 'traj/traj.json').write_text(json.dumps({k: traj[k] for k in ('stages', 'end_step', 'main_steps', 'path_every', 'path', 'plan', 'runs', 'stats', 'hero')},
                                             separators=(',', ':')))

# ---------------------------------------------------------------- benchmark
copy(MET / 'data/bench.json', D / 'bench.json')
print(f'hero X {cols} x {rows}, {len(out_cells) + 1} tiles, {len(hi)} hi-res; {len(takes)} recordings; {len(cards)} R2S cards')
