# Ropedia Xperience website

`draft/` is the layout draft (v0.2): one long page in the site's final order
(01 Overview → Paper → 02 Pipeline → Explore → 03 Data → 04 Applications → Release), English site copy, and yellow
notes and numbered pins (in Chinese) that say what each part holds, where it comes from and what is still open.
`N` or the button in the top bar hides the notes.

Panels marked LIVE are the launch video's own pages from `video/` (mosaic, flythrough shots, metrics pages) in
iframes. The draft reads them in place and never writes to `video/`. An iframe exists only while its panel is on
screen; `dev.setTime(t)` drives the flythrough and mosaic pages (a clock for loops and holds, the scroll position for
the pipeline section), and the metrics pages play on their own clock. The posters under each panel come from the
film's rendered frames.

## View

The iframes need the repository root served over HTTP (launch config `website-draft`, port 8800):

```bash
python3 -m http.server 8800 --bind 127.0.0.1 --directory .
```

Then open <http://127.0.0.1:8800/website/draft/>.

## Rebuild the posters and data

```bash
python3 -I website/draft/build_assets.py
```

It writes `draft/assets/` (posters, scene thumbnails, head-camera frames, teaser, device photos, logo, font) and
`draft/data.js` (the four Explore scenes: recordings, captions and sub-task timelines from each take's `take.json`).

## Homepage: the 03 Data section

`home/dataset.js` and `home/dataset.css` draw the Data section of `home/index.html` (the X of the scene tiles, its
three arrangements and the scene browser). The third arrangement, "By scene and task", sets the scenes and the tasks
side by side, each on its own axis: on the left the scans in rows by scene category, on the right the recordings as a
block per action with a chip for each scene type the action was recorded in. Its two data files come from the release
manifest (`MANIFEST` in `build_data.py`:
`/mnt/local/lihao/kosmos_data_upload/reports/2026-11-11/release/release_manifest.json`) and the film's act-3 sources in
`video/metrics/data` (`records.json`, `tasks.json`); rebuild them after any of those change (standard library only):

```bash
python3 -I website/home/build_data.py
```

It writes `home/data/scenes.json` (preview tile, category and review grade of every scan; no names, ids or paths,
which can carry an operator's name) and `home/data/recordings.json` (recordings per action × scene type,
with the tasks behind each row and column).

The scans are the release manifest's works, one each, with the manifest's category and grade (Perfect / Usable /
Reuse, which the page calls a reuse candidate). Which scans are in, and their grades, are settled upstream by the
rules in the manifest's folder (its README and `rules.py`: repeat reviews, conflicts, Delete left out); the page applies
none of its own. 2026-11-11: 1,589 scans, 148 perfect / 934 usable / 507 reuse candidates. `build_data.py` reads only
each work's `work_id`, `category`, `grade` and `paper_record_ids`, never its name, account or root.

A scan's preview tile is the one its paper records (`paper_record_ids`, into `video/metrics/data/records.json`) have in
the mosaic atlas. 106 scans have none: 105 are newer than the paper's 2026-10-07 snapshot, and LH_17761 (the hero's
centre scene) has no atlas tile. They count everywhere and show as blank tiles in the Data section (the X, the three
arrangements, the scene browser, where they read "no preview yet"); the hero's wall has only the scans with a tile.
`build_data.py` writes the scans with a tile into `data/hero.json` too (the hero's wall and tooltip, in `build.py`'s
shuffled order, which it rebuilds from `records.json`), so run it after `build.py`.

The page does not print these counts (the user's call of 2026-11-11). It states the totals as fixed floors, "1,500+"
scenes and "4,000+" recordings (written out in `index.html`, and `SCANS` / `RECS` in `dataset.js`), and the grades by
name only: no count or share for perfect, usable or reuse candidate anywhere (the "By review grade" bins are sized by
their scans but labelled by name; a grade filter in the scene browser shows no count). `build_data.py` prints a note if
the data fall below either floor. Other figures are still printed as they are: the per-category counts, 596 locations,
12 categories, 74 tasks, 131 h, and the recordings per action and scene type.

The scans carry 12 categories and the tasks 8 scene types, and the sources hold no link between a recording and a scan.
`build_data.py` matches the two lists by name (`COLS`, which also sets the categories' groups, and fails if a name is
missing); seven names are shared. The page uses the match for its highlight only: a scan category and the scene type
of the same name light each other under the pointer. It does not put the two on one axis. An earlier version did (a
column per name, the recordings under the scans), and the five scan categories that are not a scene type of the tasks
(Multi-room, Meeting room, Outdoor corridor, Urban street, Parking lot) then read as scenes where nothing was recorded.
Laundry is a scene type of the tasks only.

## Homepage: the 04 Applications section

`home/apps.js` and `home/apps.css` draw the Applications section of `home/index.html`: the overview (nine modalities,
three benchmarks, four demonstrations; a use lights the modalities it takes and a click goes to its part), the
benchmarks (a sortable table of the depth and geometry scores from `data/bench.json`; 3D visual grounding and spatial
intelligence have no scores yet, so they show samples and empty tables) and the demonstrations in the film's order:
Real-to-Sim (`home/r2s3d.js`: the simulator scene in free-view 3D playing the film's physics run, see below),
long-horizon trajectory generation (run 203 with the plan in step, the 30 held-out starts), virtual teleoperation
(a placeholder, no data yet) and retargeting (Human / Robot A / Robot B in 3D, drawn by `engine.js` in its `retarget`
mode, with a divider and the fingertip error over the window; then the eight-home wall).

Each tile of the wall is the film's picture of its home (Robot A | Robot B, a short clip under the pointer) and opens
that home in 3D: its own scan, the recording's window and both robots, on a stage like the hero recording's (orbit,
Human / Robot A / Robot B, a divider between any two, play and scrub). `engine.js` loads it with `home(scene, take)`
and draws it in the same `retarget` mode (`rtSrc`); the dialog takes the page's one canvas while it is open
(`hold(slot)`). The last two homes opened stay in memory and the others are dropped (`dropHome`). The dialog has no
fingertip-error chart: Robot A's runs on these windows carry only 12 error bins each, and two of them (LH_17766,
LH_J20_02) end on bins of about 16 cm that have not been checked against the runs.

Most of its data is written by `build.py`. The rest (modality thumbnails, gap heat maps, the wall's frames) comes from:

```bash
/mnt/local/lihao/miniforge3/envs/scene_agent/bin/python -I website/home/build_apps.py
```

It needs `cv2` (the system Python here has neither it nor PIL) and writes `home/data/apps/` and, for the wall's 3D
view, each home's scan, recording window and robot motion under `home/data/<scene>/<take>/` (about 430 MB in all; the
robots' meshes are the hero recording's files, not copied).

Written for the page and to be replaced when the benchmark data arrives: the three referring expressions (`VG_EX` in
`apps.js`, on the Real-to-Sim scene's own object boxes) and the six example questions (`SQA`).

### Real-to-Sim in 3D

`home/r2s3d.js` and `home/r2s3d.css` show the simulator scene of LIVING_ROOM_14939_ANO as meshes (no 3D Gaussians) and
play the film's physics run in it: doors and the tap lever move, the TV cover, two cushions and the towel deform, the
water runs, the TV and the kitchen lights switch on. Picking an object, in the scene or in the list, flies to the
film's camera for it and loops its part of the run; the film's offline render of the same frames (`data/r2s/cards`)
plays beside it on the same clock. Its data comes from the Blender scene and the recording behind the film's renders
(`/mnt/local/lihao/xperience_video_r2s` on this server; a minute and a half, or about twelve when it bakes the light anew):

```bash
cd /mnt/local/lihao/xperience_video_r2s && /mnt/local/lihao/blender/blender-5.2.2-linux-x64/blender -b scene14939.blend -P /mnt/local/lihao/xperience_website/website/home/tools/export_r2s3d.py -- --out /mnt/local/lihao/xperience_website/website/home/data/r2s3d
```

It writes `scene.glb` (Draco, 10.8 MB, 1.85 M triangles: no mesh is simplified, and the scene's 1,231 curves, such as
the faucet spout, plant stems and lamp cords, are written as tubes of their own radius; textures at most 1024 px),
`run.bin` + `run.json` (26 MB: 15 frames a second of the 11.6 s run; the cushions and the towel in full, the TV
cover's 128k points reduced to 15k; `run.json` also lists the scene's own lights, with where each is, where it points,
its size and when the run switches it on), the cover's texture and `gi.bin`, the film's light (below). The loaders and the occlusion pass
(`vendor/addons/loaders`, `libs/draco`, `postprocessing`, `shaders`, `math`) are three.js r178's own files. In the "Film camera" view the camera is the film's own (its path
through the run, or its camera for the picked object); a drag takes over and the camera eases back 3.5 s after it ends.

The light is the film's, as far as a rasteriser goes. The export bakes it (`tools/bake_r2s3d.py`, Cycles, with the
film's own lights, their strengths and its exposure) into `gi.bin` (1.6 MB): a grid of light probes through the whole
home, 15 cm apart, each holding the irradiance that arrives there as a colour and a direction, once for the run's
lights as at its start and once for what the lights it switches on add. The meshes are not touched: a surface reads
the probes around it, by where it is and which way it faces, so what the run moves is lit where it is. The probes
hold everything except the direct light of the lamps the page has itself, which cast its real-time shadows: each
ceiling panel is a spot with a shadow map (1024 px, drawn again only when something that lamp has a clear line to has
moved, one lamp a frame), the strip under the wall cabinets is two spots, and the kitchen's lights come on when its
wall switch is pressed. Their strengths are fitted to the film's (`run.json`, `lights[].cd`), so the page is in the
film's exposure and nothing of the lighting is set by eye. Reflections are a capture of the lit home itself, taken at
load from where the film's camera stands (once with the kitchen lights off, once on). A screen-space occlusion pass
(GTAO, at CSS-pixel resolution) is multiplied over the picture for what a 15 cm grid cannot hold. Tone mapping is AgX
with the film's "medium high contrast" look: three's AgX with one line added, as its custom tone mapping. What shows
through glass is drawn at half size. A machine that cannot hold 25 frames a second gets fewer pixels, then no
occlusion pass.

The bake takes about ten minutes (five passes of the 67 k probes; most of it is Cycles reading the scene) and is kept
in the work folder (`bake3d.npz`): the export uses it as long as the grid is the same, `--rebake` makes it again,
`--bake-samples`, `--probe` and `--gpus` set its samples (512), the probes' spacing and the GPUs, and `--no-bake`
leaves it out (the page then lights the scene by eye, with an ambient light of its own). What it cannot give: soft
shadows from the panels (the page's are sharp) and any light detail finer than the grid.

The earlier scan | simulator pictures and the gap heat map are no longer on the page; `data/r2s/real`, `data/r2s/sim`
and `data/apps/gap` are now only used by the grounding sample (one frame of `real`).

## Homepage: the 05 Release section

The end of `home/index.html` (`#get`, styled by `home/release.css`; the nav's "Get the data" points at it) has a card
each for the paper (arXiv), the dataset (Hugging Face) and the code (GitHub). A card whose link is not out yet is a
`<div class="rl-card soon">` ending in "Coming soon". To publish one, turn it into
`<a class="rl-card" href="https://..." target="_blank" rel="noopener">` and set its last line to "Read on arXiv",
"Open on Hugging Face" or "Open on GitHub"; the card then gets the green label and the arrow. Code only, so a push is
enough (no new media prefix).

## Deploying: code on Cloudflare Pages, media on Cloudflare R2

The page is about 4 MB of code and 1.1 GB of media (`home/data`, `home/assets`). `home/tools/deploy.py` splits them:
it leaves `home/` as it is (local development still reads everything from disk) and writes `website/dist`, a copy of
the code alone in which every `data/...` and `assets/...` reference points at a remote base URL.

**Code.** Cloudflare Workers Builds builds and serves the site from the `page` branch of
github.com/Ropedia/Ropedia-Xperience-2, which holds the code only (`home/data`, `home/assets` and `dist` are in
`.gitignore`). The Worker project `ropedia-xperience-2` has the build command
`python3 home/tools/deploy.py` and the deploy command `npx wrangler deploy`;
`wrangler.jsonc` makes it a Worker with no script that serves `dist` as static files. Every push to `page` builds and
publishes the site. The media's URL is `MEDIA_URL` in `home/tools/deploy.py` (an `ASSET_BASE` environment variable or build
variable overrides it); to point the site at other media, change that line and push.

**Media.** The R2 bucket `ropedia-xperience-2` (account `3ece8696…`, location APAC) holds them under a version prefix
(`v1/data/...`, `v1/assets/...`). For testing they are served at its development URL,
`https://pub-a5d54d8bd1a5427c92ce334fabec455e.r2.dev` (rate-limited, no caching); for the public site, by a custom
domain connected to the bucket (R2 → the bucket → Settings → Custom Domains), for example
`media.<site domain>`. `ASSET_BASE` is then `https://media.<site domain>/v1`. Not a Pages Function in front of the
bucket: one visit makes about 3,000 media requests (the recordings are frame sequences), and each would be a Function
call (100,000 a day on the free plan). Not the bucket's `r2.dev` address either: it is rate-limited and meant for
development.

The custom domain also needs:

- a CORS rule on the bucket (the page fetches the scans and recordings and loads its font from the media domain).
  Set on 2026-11-11: allowed origins `*` (the media are public anyway, and the site's domain may change), methods GET
  and HEAD, headers `*`, max age 86400
- a Cache Rule on the zone: hostname equals the media domain → eligible for cache, edge TTL from the origin's
  `Cache-Control`. Cloudflare caches `.jpg`, `.webp`, `.woff2` by default but not `.json`, `.spz`, `.f32`, `.bin`,
  `.glb`, which are most of the bytes.

The objects carry `Cache-Control: public, max-age=31536000, immutable`, so changed media go under a new prefix (`v2`,
...), never over an old one, and `ASSET_BASE` moves to it. Upload from this machine (rclone remote `r2`, provider
Cloudflare):

```
cd website/home
python3 tools/deploy.py --base https://media.<site domain>/v2 --upload r2:ropedia-xperience-2/v2
```

(This also writes `website/dist`, which is only for checking locally; Pages builds its own.)

A copy of `v1` is also in `s3://kosmos-data-492661376500-ap-southeast-3-an/website-assets/v1/` (private, uploaded
2026-11-10). The site does not use it.

`dist` was checked on 2026-11-10 with the code and the media on two local origins (the media with a CORS header): all
sections loaded, no cross-origin failure. It has not yet been checked against R2.
