# Ropedia Xperience 2

### A Gold Standard for Scaling Physical AI Environments and Behaviors

**Ropedia Research Team**

[Project Page](https://ropedia.com/xperience/2-research/) · [Dataset](https://huggingface.co/datasets/ropedia-ai/Ropedia-Xperience-2) · Paper: coming soon

Ropedia Xperience 2 brings together metric 3D scans of real environments and egocentric recordings of human activity. A handheld KOSMO scanner captures the scene; a head-mounted HOMIE recorder captures tasks performed in it. Scene registration places a recording's camera trajectory and estimated hand and body motion in the scan's coordinate frame.

The dataset comprises **1,500+ released scene scans** and a broader collection of **4,000+ egocentric recordings**, covering **74 tasks** and **131 hours**. Scenes include homes, workplaces, and outdoor environments. The recording and duration totals describe the collection inventory; they do not imply that every recording is processed or registered.

Available assets include posed images, meshes, 3D Gaussian splatting models, egocentric video, camera trajectories, estimated hand and body motion, and activity annotations. Asset availability varies by export. See the [project page](https://ropedia.com/xperience/2-research/) for examples and the [dataset page](https://huggingface.co/datasets/ropedia-ai/Ropedia-Xperience-2) for data access and release terms.

## Scene registration

The first code component is **HOMIE → KOSMO scene registration**: localize egocentric frames against a scan, fit a rigid or similarity transform, validate it with held-out frames, gravity, and depth, and export trajectories and motion in the scene frame.

Install with Python 3.10–3.12 (Python 3.12 is used for validation):

```bash
git clone https://github.com/Ropedia/Ropedia-Xperience-2.git
cd Ropedia-Xperience-2
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Run on locally downloaded exports:

```bash
xperience-register \
  --kosmo /path/to/scene \
  --homie /path/to/recording \
  --out results/my-recording
```

The scene must include posed images, a COLMAP text model, and a triangle mesh. A 3DGS-only export is insufficient. The tool reads existing HOMIE trajectory, calibration, and video exports; motion and depth exports enable the corresponding outputs and checks. It needs no internal storage credentials or body-model weights.

See [input formats and usage](docs/scene_registration.md) for the directory layout, coordinate conventions, output files, and PASS / WEAK / FAIL criteria. A [synthetic fitting example](examples/fit_synthetic_trajectory.py) runs without downloading recordings:

```bash
python examples/fit_synthetic_trajectory.py --out results/synthetic
```

The tool releases registration of already processed data. HOMIE sensor processing, hand/body estimation, and downstream simulation and retargeting pipelines are separate components.

## Citation

```bibtex
@misc{ropedia2026xperience2,
  title  = {Ropedia Xperience 2: A Gold Standard for Scaling Physical AI Environments and Behaviors},
  author = {{Ropedia Research Team}},
  year   = {2026},
  url    = {https://ropedia.com/xperience/2-research/}
}
```

## License

Code is released under [Apache-2.0](LICENSE). Dataset access and usage terms are provided on the dataset page. Third-party dependencies and separately distributed assets retain their own terms.
