#!/usr/bin/env python3
"""Data for the homepage's 03 Data section (dataset.js): the scans from the release manifest (MANIFEST), their preview
tiles and the recordings from the film's act-3 sources in video/metrics/data. All read only.

    python3 -I website/home/build_data.py

Writes website/home/data/
  scenes.json      every scan of the release (one per work of the manifest): its preview tile in assets/atlas_small.jpg
                   (-1 where the scan has no preview picture), its category and its grade. No names, ids or paths: the
                   manifest's names carry operators' names. It also rewrites hero.json's cells to match (one per scan
                   with a tile, its category and grade).
  recordings.json  recordings per action x scene type with the tasks behind each row and column (the paper's Figure 3,
                   video/metrics/data/tasks.json). Its columns list every scan category as well, matched to the tasks'
                   scene types by name, so that the page can light a scan category and the scene type of the same name
                   together (it shows the two side by side, each on its own axis).
Standard library only. hero.json (build.py) supplies the small atlas's geometry and is checked against the scans.
"""
import json
import random
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MET = ROOT / 'video/metrics/data'
MANIFEST = Path('/mnt/local/lihao/kosmos_data_upload/reports/2026-11-11/release/release_manifest.json')   # the release (read only)
D = HERE / 'data'

# ---------------------------------------------------------------- scenes
# The release: one scan per work of the release manifest, with its category and grade. Which scans are in, their grades
# (repeat reviews, conflicts, the categories whose Delete became Reuse) and their categories are settled there, by the
# rules in the manifest's folder (README.md, rules.py); the page applies none of its own. Only work_id, category, grade
# and paper_record_ids are read: the manifest's names, accounts and paths carry operators' names and stay out of website/.
man = json.loads(MANIFEST.read_text())
recs = json.loads((MET / 'records.json').read_text())
hero = json.loads((D / 'hero.json').read_text())
W, R = man['works'], recs['records']
GRADE = {'Perfect': 0, 'Usable': 1, 'Reuse': 2}     # the manifest's grades, best first
SHOWN = ['Perfect', 'Usable', 'Reuse candidate']    # as the page names them
assert man['categories'] == recs['rows'], "the manifest's categories differ from the paper's (records.json)"
assert len(W) == man['total'] and dict(Counter(w['grade'] for w in W)) == {k: v for k, v in man['grades'].items() if v}
assert all(Counter(w['grade'] for w in W if w['category'] == n) == Counter({k: v for k, v in g.items() if v}) for n, g in man['by_category'].items())
# A scan's preview tile is that of its records in records.json (the paper's QC records, which the mosaic atlas covers);
# a scan newer than the paper (no records) or a record without a picture has none (-1).
tile = lambda r: r['tile'] if isinstance(r.get('tile'), int) and r['tile'] >= 0 else -1
rec = {r['id']: r for r in R}
tl = [{tile(rec[i]) for i in w['paper_record_ids']} for w in W]
assert all(len(x) <= 1 for x in tl), "a scan's records differ in tile"
t = [x.pop() if x else -1 for x in tl]
c = [recs['rows'].index(w['category']) for w in W]
q = [GRADE[w['grade']] for w in W]
assert len({x for x in t if x >= 0}) == sum(x >= 0 for x in t), 'two scans share a preview tile'
# hero.json's cells (build.py: [r, c, tile, cat, grade], one per record with a preview, in a shuffled order; hero.js reads
# tile, cat and grade): rebuilt from records.json in build.py's order (its filter and its seed), one cell per scan with a
# tile, with the manifest's category and grade. r, c are build.py's slot in its X, which nothing reads: kept where
# hero.json has the tile, else -1.
order = [r for r in R if tile(r) >= 0]
pool = list(range(len(order)))
random.Random(1812).shuffle(pool)                  # build.py's shuffle
first = list(dict.fromkeys(tile(order[k]) for k in pool))
at = {x[2]: x[:2] for x in hero['cells']}
assert [x[2] for x in hero['cells']] == [x for x in first if x in at], "hero.json's cells are not in build.py's order: rerun build.py"
scan = {x: (k, g) for x, k, g in zip(t, c, q) if x >= 0}
cells = [[*at.get(x, [-1, -1]), x, *scan[x]] for x in first if x in scan]
if cells != hero['cells'] or hero['outcomes'] != SHOWN:
    hero['cells'], hero['outcomes'] = cells, SHOWN
    (D / 'hero.json').write_text(json.dumps(hero, separators=(',', ':')))
assert sorted(x for x in zip(t, c, q) if x[0] >= 0) == sorted(tuple(x[2:]) for x in hero['cells']), 'the manifest and hero.json disagree: rerun build.py'
(D / 'scenes.json').write_text(json.dumps({'categories': recs['rows'], 'outcomes': SHOWN, 'tile': hero['tile'], 'atlasCols': hero['atlasCols'],
                                           't': t, 'c': c, 'q': q}, separators=(',', ':')))
print(f"scenes.json: {len(W)} scans (release manifest of {man['built_at'][:10]}), grades {[Counter(q)[k] for k in range(3)]}, "
      f"{sum(x < 0 for x in t)} without a preview ({sum(not w['paper_record_ids'] for w in W)} newer than the paper), "
      f"categories {[Counter(c)[k] for k in range(len(recs['rows']))]}; hero.json: {len(cells)} cells")
# The page states its totals as fixed floors, not counts (index.html; SCANS and RECS in dataset.js): say when one fails.
if len(W) < 1500:
    print(f"  NOTE: {len(W)} scans, fewer than the 1,500+ the page states")

# ---------------------------------------------------------------- recordings
ts = json.loads((MET / 'tasks.json').read_text())
heat = ts['heat']
assert len(heat) == len(ts['actions']) and all(len(row) == len(ts['scenes']) for row in heat)
assert sum(map(sum, heat)) == ts['records'], 'the matrix does not sum to the recording count'
assert sum(s['tasks'] for s in ts['scenes']) == sum(a['tasks'] for a in ts['actions']) == ts['tasks']
# The columns: every scan category and every task scene type, the two matched by name (the sources hold no other link
# between a recording and a scan). The scans carry 12 categories and the tasks 8 scene types; a column that is only a
# scan category has no tasks and no counts (null), a column that is only a task scene type has no scan category (cat
# null). COLS also sets the groups the page lists the scan categories in.
COLS = [('Home', ['Bedroom', 'Living room', 'Bathroom', 'Kitchen', 'Laundry', 'Multi-room']),
        ('Work / retail', ['Restaurant', 'Office', 'Store', 'Meeting room']),
        ('Outdoor & parking', ['Outdoor corridor', 'Urban street', 'Parking lot'])]
cats = recs['rows']
typed = {s['scene']: k for k, s in enumerate(ts['scenes'])}
names = [n for _, ns in COLS for n in ns]
assert len(names) == len(set(names)) and set(names) == set(cats) | set(typed), 'COLS must list every scan category and task scene type once'
assert all(ts['scenes'][typed[n]]['group'] == g for g, ns in COLS for n in ns if n in typed), 'a task scene type is outside its group'
(D / 'recordings.json').write_text(json.dumps({
    'total': ts['records'], 'tasks': ts['tasks'],
    'rows': [{'name': a['verb'], 'group': a['paradigm'], 'tasks': a['tasks']} for a in ts['actions']],
    'cols': [{'name': n, 'group': g, 'tasks': ts['scenes'][typed[n]]['tasks'] if n in typed else None, 'cat': cats.index(n) if n in cats else None}
             for g, ns in COLS for n in ns],
    'counts': [[row[typed[n]] if n in typed else None for n in names] for row in heat]}, indent=1))
print(f"recordings.json: {len(heat)} actions x {len(names)} scene types ({len(typed)} with tasks, {len(cats)} with scans, "
      f"{len(set(cats) & set(typed))} with both), {ts['records']} recordings of {ts['tasks']} tasks")
if ts['records'] < 4000:
    print(f"  NOTE: {ts['records']} recordings, fewer than the 4,000+ the page states")
