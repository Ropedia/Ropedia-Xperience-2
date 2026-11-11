#!/usr/bin/env python3
"""Data for the homepage's 03 Data section (dataset.js), from the film's act-3 sources in video/metrics/data (read only).

    python3 -I website/home/build_data.py

Writes website/home/data/
  scenes.json      every scan of the release (the paper's 1,812 QC records): its preview tile in assets/atlas_small.jpg
                   (-1 where the scan has no preview picture), its display category and its review grade. No scene
                   names: the records' names are upload labels, some with an operator's name in them.
  recordings.json  recordings per action x scene type with the tasks behind each row and column (the paper's Figure 3,
                   video/metrics/data/tasks.json). Its columns list every scan category as well, matched to the tasks'
                   scene types by name, so that the page can light a scan category and the scene type of the same name
                   together (it shows the two side by side, each on its own axis).
Standard library only. hero.json (build.py) supplies the small atlas's geometry and is checked against the records.
"""
import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MET = ROOT / 'video/metrics/data'
D = HERE / 'data'

# ---------------------------------------------------------------- scenes
recs = json.loads((MET / 'records.json').read_text())
hero = json.loads((D / 'hero.json').read_text())
R = recs['records']
t = [r['tile'] if isinstance(r.get('tile'), int) and r['tile'] >= 0 else -1 for r in R]
c = [r['cat'] for r in R]
q0 = [r['qc'] for r in R]                          # the audit's grades
assert [Counter(q0)[k] for k in range(len(recs['outcomes']))] == recs['quality_totals'], 'grade totals differ from the audit'
assert all(0 <= x < len(recs['rows']) for x in c)
# The page's grades differ from the audit's (and the film's) in one rule, the user's call of 2026-11-11: in these
# categories a scan graded Excluded is a Reuse candidate. records.json under video/ keeps the audit's grades; scenes.json
# and the grade in hero.json's cells (the hero's tooltip) take the rule, so rerun this after build.py.
REUSE_NOT_EXCLUDED = ['Restaurant', 'Store', 'Urban street', 'Outdoor corridor', 'Meeting room', 'Office']
EXC, REU = recs['outcomes'].index('Excluded'), recs['outcomes'].index('Reuse candidate')
UP = {recs['rows'].index(n) for n in REUSE_NOT_EXCLUDED}   # (fails on a name that is not a category)
regrade = lambda cat, g: REU if g == EXC and cat in UP else g
q = [regrade(x, g) for x, g in zip(c, q0)]
cells = [[*cell[:4], regrade(cell[3], cell[4])] for cell in hero['cells']]   # (the same whether hero.json has the rule yet or not)
if cells != hero['cells']:
    hero['cells'] = cells
    (D / 'hero.json').write_text(json.dumps(hero, separators=(',', ':')))
# every scene with a preview is one of the hero's tiles, with the same category and grade
assert Counter(zip(t, c, q)) - Counter({k: v for k, v in Counter(zip(t, c, q)).items() if k[0] < 0}) == Counter((x[2], x[3], x[4]) for x in hero['cells']), \
    'records.json and hero.json disagree: rerun build.py'
(D / 'scenes.json').write_text(json.dumps({'categories': recs['rows'], 'outcomes': recs['outcomes'], 'tile': hero['tile'], 'atlasCols': hero['atlasCols'],
                                           't': t, 'c': c, 'q': q}, separators=(',', ':')))
print(f"scenes.json: {len(R)} scans, grades {[Counter(q)[k] for k in range(len(recs['outcomes']))]} (audit {recs['quality_totals']}), {sum(x < 0 for x in t)} without a preview, "
      f"categories {[Counter(c)[k] for k in range(len(recs['rows']))]}")

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
