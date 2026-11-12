# HOMIE → KOSMO scene registration

This tool registers an already processed HOMIE recording to a KOSMO scan. It does not reconstruct scenes or estimate the original SLAM trajectory, stereo depth, or hand/body motion. Supply one recording and its corresponding scan per invocation.

## Inputs

Download the required exports locally before running the tool:

```text
scene/
├── colmap/
│   └── sparse_fisheye.zip          # contains cameras.txt and images.txt
├── images/
│   └── images.zip                  # images named by the COLMAP model
└── obj/
    └── scene.obj                   # triangle mesh in the COLMAP world frame

recording/
└── mocap_main/
    ├── f_slam.txt                  # TUM device poses: time tx ty tz qx qy qz qw
    ├── calibration.json
    ├── stereo_left_synced.mp4      # cropped, rectified left video
    ├── annotation.hdf5             # crop calibration; optional motion/landmarks
    └── depth.hdf5                  # depth and confidence; needed for a PASS
```

Use one COLMAP ZIP, image ZIP, and OBJ per scene directory. The COLMAP ZIP must contain a **text** model; a binary-only model must first be converted to text with COLMAP. Supported camera models are PINHOLE, SIMPLE_PINHOLE, OPENCV, OPENCV_FISHEYE, RADIAL, and SIMPLE_RADIAL. PINHOLE / SIMPLE_PINHOLE views are preferred when at least 50 are available. Image names must match the model, optionally with a common enclosing folder inside the ZIP. Images, camera poses, and the OBJ must share the same scene frame. A point cloud or 3DGS alone cannot replace these inputs.

`calibration.json` needs the following fields (`T_c0_b` maps body/IMU coordinates to the rectified stereo-left camera):

```json
{
  "cam01": {
    "K": [960.0, 960.0, 960.0, 544.0],
    "T_c0_b": [[1,0,0,0], [0,1,0,0], [0,0,1,0], [0,0,0,1]]
  }
}
```

The example values illustrate the schema; use the recording's own calibration. `K` is `[fx, fy, cx, cy]`. The full image size is twice the principal point, matching the HOMIE export convention.

For cropped video, `annotation.hdf5` must supply:

| HDF5 dataset | Shape | Meaning |
|---|---|---|
| `calibration/cam01/K` | `(4,)` | Crop intrinsics `[fx, fy, cx, cy]` |
| `calibration/cam01/image_size` | `(2,)` | Crop width, height; must match the video |
| `calibration/cam01/crop_src_size` | `(2,)` | Full image width, height; used for depth intrinsics |

Alternatively, supply `stereo_left_synced_w_margin.mp4`, the full-size rectified video. It uses `calibration.json` intrinsics and works without crop calibration. The cropped version is preferred when its calibration is present.

Optional annotations are read from:

| HDF5 dataset | Shape | Frame / meaning |
|---|---|---|
| `slam/point_cloud` | `(M, 3)` | SLAM landmarks in recording world; estimates the depth/SLAM scale ratio |
| `full_body_mocap/keypoints` | `(F, 52, 3)` | SMPL-H joints in recording world |
| `full_body_mocap/timestamps_ns` | `(F,)` | Body timestamps; falls back to `video/device_timestamp` |
| `hand_mocap/left_joints_3d` | `(F, 21, 3)` | MANO joints in the rectified stereo-left camera |
| `hand_mocap/right_joints_3d` | `(F, 21, 3)` | Same convention for the right hand |

Depth is read from `depth.hdf5` datasets `depth` and `confidence`, both shaped `(F, H, W)`. Depth is camera-axis distance in meters in the full rectified left view, resized to the depth resolution. The tool keeps samples with confidence ≥80 and depth between 0.1 and 2.5 m. Video, SLAM, depth, and hand arrays share a frame index. The expected HOMIE rate is 30 fps; the split-half diagnostic and plots use that rate. The tool reports a video/SLAM length mismatch and uses their common prefix.

## Run

```bash
xperience-register --kosmo /path/to/scene --homie /path/to/recording --out results/take-01
```

`--out` must be new or empty so a failed run cannot leave an earlier successful transform in its place. Input data are read without modification. The mesh cache defaults to `<out>/cache`; pass `--cache /path/to/cache` to share it across runs.

Useful options:

| Option | Effect |
|---|---|
| `--verify-only` | Global visual pairing check; does not produce a validated registration |
| `--no-depth` | Skip depth / ICP; the result cannot receive PASS |
| `--no-figures` | Write numerical outputs without overlay and top-down images |
| `--step N` | Localize every Nth video frame; default targets about 200 query frames |
| `--init-queries N` | Query frames for global initialization; default 30 |
| `--init-db N` | Scan views for initialization; default between 250 and 800 |

Use `python -m scene_registration` as an alternative to `xperience-register`. Processing uses the CPU; no GPU model or downloaded weights are required. For concurrent runs, limit OpenMP / BLAS threads and set `HKA_CV_THREADS` to avoid oversubscription. The implementation uses Open3D's native libraries; the validated environment is Linux with Python 3.12.

## Method

1. Choose textured egocentric frames across the recording. Retrieve scan views using SIFT matches and fundamental-matrix RANSAC; lift matched scan pixels to the mesh by ray casting and localize with PnP.
2. Initialize from consistent camera poses, then localize about 200 frames near the predicted trajectory. Repeat localization once with the fitted transform.
3. Fit SE(3), Sim(3), and a rigid pose-average candidate. Fit on alternating localized frames and evaluate on the held-out frames. Sim(3) is eligible only when the localized trajectory spans at least 2.5 m and improves held-out median translation error by more than 0.3 cm over the centre-based SE(3) fit. PnP rotations constrain short or stationary trajectories.
4. Check gravity against a scan floor plane, report estimated toe height, and compare stereo depth against the mesh. An ICP refinement checks whether independent geometry agrees with the visual fit.

A single high-inlier PnP pose may seed full localization, but a pairing-only result requires a consensus of at least three poses to receive VERIFIED. VERIFIED is distinct from PASS.

## Outputs and coordinates

Transforms act on homogeneous column vectors. `S_kosmos_from_homie` in `transform.json` maps recording SLAM world to the scan's COLMAP world:

```text
p_scene = S_kosmos_from_homie @ [p_recording_world; 1]
```

`S[:3, :3]` contains `scale * rotation`. Both input worlds use meters. HOMIE recording world is gravity-aligned with +z up; the scan's original COLMAP axes are retained. The transform is not an instruction to treat the scan's +z as up.

The calibrated stereo-left pose is `T_world_camL = T_world_body @ inv(T_c0_b)`. Body joints transform directly through `S`. Hand joints transform through **`S @ T_world_camL[frame]`**, including the similarity scale. Applying `S` directly to hand camera coordinates is incorrect. Missing all-zero joints and hands without a corresponding pose become NaN in the NPZ.

| File | Contents |
|---|---|
| `metrics.json` | Initialization, held-out errors, independent checks, verdict, and export status; also written for runtime errors after input/output setup |
| `transform.json` | Recording-world → scene similarity matrix, scale, and model |
| `pnp_frames.json` | Localized frame indices, camera poses, and inlier counts |
| `homie_body_in_kosmos.txt` | Device/IMU trajectory in TUM format |
| `homie_stereo_left_rect_in_kosmos.txt` | Rectified stereo-left camera trajectory in TUM format |
| `homie_mocap_in_kosmos.npz` | Estimated body/hand joints, when motion annotations are available |
| `overlay.jpg`, `topdown.png` | Visual checks, unless `--no-figures` is set |

The `kosmos` field names and filenames retain compatibility with existing registration exports; they refer to KOSMO. TUM quaternions contain rotation only; translations and NPZ points include the similarity scale. Motion export errors are recorded in `metrics.json` and do not silently imply that motion was exported. Numerical outputs may exist for a WEAK or FAIL fit; always read the verdict before using them.

## Quality labels

| Label | Meaning |
|---|---|
| PASS | Held-out translation median ≤5 cm and p90 ≤12 cm; gravity deviation ≤2°; ICP displacement ≤10 cm and rotation ≤2°; independent checks are present and finite |
| WEAK | A fit exists, but a PASS threshold is missed or an independent check is missing / failed |
| FAIL | No accepted visual initialization, fewer than eight reliable localized frames, held-out p90 >30 cm, or ICP displacement >30 cm |
| VERIFIED | Visual pairing check only; no registration quality claim |
| ERROR | Processing could not finish; distinct from a geometric rejection |

PASS requires finite depth-overlap and depth-residual measurements as well as the gravity and ICP checks. Toe height is diagnostic and does not change the label. A skipped or unavailable depth check cannot yield PASS. Exit codes are `0` for PASS / VERIFIED, `2` for WEAK / FAIL, and `1` for input or processing errors.

## Limitations and scope

Short or stationary trajectories do not constrain scale, so they use a rigid transform. Repetitive layouts can create false visual matches; depth and ICP checks are necessary. Views dominated by hands, textureless surfaces, or objects seen from different viewpoints may not localize. One global transform cannot correct local SLAM drift, and estimated hand/body motion is not motion-capture ground truth.

This release contains single-pair registration and a synthetic **fitting-only** example. The example exercises transform fitting and serialization, not image retrieval, PnP, or depth validation. Dataset downloads, internal pairing metadata, storage clients, batch publishing, sensor-processing software, model weights, and real recordings are not bundled.

## Validation

```bash
python -m unittest discover -s tests -v
python examples/fit_synthetic_trajectory.py --out results/synthetic
```

Tests cover rigid/similarity fitting, stationary trajectories, held-out evaluation, coordinate transforms for motion exports, camera models, and missing-check verdicts.
