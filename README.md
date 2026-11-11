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

`home/dataset.js` and `home/dataset.css` draw the Data section of `home/index.html` (the X of 1,812 scene tiles, its
three arrangements and the scene browser). The third arrangement, "By scene and task", sets the scenes and the tasks
side by side, each on its own axis: on the left the scans in rows by scene category, on the right the recordings as a
block per action with a chip for each scene type the action was recorded in. Its two data files come from the film's
act-3 sources in `video/metrics/data` (`records.json`, `tasks.json`); rebuild them after those change (standard library
only):

```bash
python3 -I website/home/build_data.py
```

It writes `home/data/scenes.json` (preview tile, category and review grade of every scan; no scene names, which are
upload labels and can carry an operator's name) and `home/data/recordings.json` (recordings per action × scene type,
with the tasks behind each row and column).

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

## Deploying: code on the web host, media on S3

The page is about 4 MB of code and 1.1 GB of media (`home/data`, `home/assets`). `home/tools/deploy.py` splits them:
it leaves `home/` as it is (local development still reads everything from disk) and writes `website/dist`, a copy of
the code alone in which every `data/...` and `assets/...` reference points at a remote base URL. Only `dist` goes to
the web host.

The web host is Cloudflare Pages, built from this repository (which holds the code only: `home/data`, `home/assets`
and `dist` are in `.gitignore`). In the Pages project: framework preset None, build command
`python3 home/tools/deploy.py`, build output directory `dist`, root directory empty, and the variable `ASSET_BASE` set
to where the media are served (an `https://` URL, or a path on the site such as `/media/v1`). Every push to `main`
then builds and publishes the site.

The media are in `s3://kosmos-data-492661376500-ap-southeast-3-an/website-assets/v1/` (Jakarta, 6,898 files, uploaded
2026-11-10 with a one-year immutable cache header). The bucket is private and stays so; the page reads the media
through a CloudFront distribution in front of that folder. Until that distribution exists, `dist` loads no media.

```
cd website/home
# after the media changed: upload under a new prefix (v2, ...), never over v1, which browsers keep for a year
python3 tools/deploy.py --base https://<cloudfront domain>/v2 \
  --upload "aws,region=ap-southeast-3,location_constraint=ap-southeast-3,no_check_bucket=true:kosmos-data-492661376500-ap-southeast-3-an/website-assets/v2"
# code only (the media unchanged): rebuild dist
python3 tools/deploy.py --base https://<cloudfront domain>/v1
```

The CloudFront distribution (the `docker-cli` key in rclone's `aws` remote may not create it):

- origin `kosmos-data-492661376500-ap-southeast-3-an.s3.ap-southeast-3.amazonaws.com`, origin path `/website-assets`,
  with an origin access control (sign requests, S3); viewer protocol HTTPS only, GET and HEAD
- cache policy `CachingOptimized`; response headers policy `SimpleCORS` (the page fetches the scans and recordings and
  loads its font from another origin; without `Access-Control-Allow-Origin` they fail); compression on
- this statement in the bucket's policy, which opens `website-assets/` to that one distribution and nothing else:

```json
{ "Version": "2012-10-17", "Statement": [{
  "Sid": "CloudFrontReadsWebsiteAssets", "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" },
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::kosmos-data-492661376500-ap-southeast-3-an/website-assets/*",
  "Condition": { "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::492661376500:distribution/<distribution id>" } } }] }
```

`dist` was checked on 2026-11-10 with the code and the media on two local origins (the media with a CORS header): all
sections loaded, no cross-origin failure. It has not been checked against CloudFront.
