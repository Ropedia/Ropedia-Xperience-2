#!/usr/bin/env python3
# Copyright 2026 Ropedia Research Team
# SPDX-License-Identifier: Apache-2.0
"""Fitting-only example with generated camera poses. No recordings are needed."""
import argparse
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
from scipy.spatial.transform import Rotation

from scene_registration.align import fit_and_eval, xf
from scene_registration.quality import verdict


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out', default='results/synthetic')
    args = ap.parse_args()
    rng = np.random.default_rng(7)
    t = np.linspace(0, 2 * np.pi, 64)
    centres = np.column_stack([3 * np.cos(t), 2 * np.sin(t), 0.3 * np.sin(2 * t)])
    poses = np.repeat(np.eye(4)[None], len(t), axis=0)
    poses[:, :3, 3] = centres
    expected = np.eye(4)
    rotation = Rotation.from_euler('xyz', [4, -6, 32], degrees=True).as_matrix()
    expected[:3, :3] = 1.025 * rotation
    expected[:3, 3] = [2, -1, 0.5]
    located = xf(expected, centres) + rng.normal(0, 0.005, centres.shape)
    observations = []
    for i, point in enumerate(located):
        pose = np.eye(4)
        pose[:3, :3], pose[:3, 3] = rotation, point
        observations.append(dict(i=i, inl=100, Tpnp=pose))
    transform, fit = fit_and_eval(SimpleNamespace(TwcL=poses), observations)
    if transform is None:
        raise RuntimeError('synthetic fit failed')
    np.testing.assert_allclose(transform, expected, atol=0.004)
    label, reason = verdict(dict(n_consensus=10), fit, {}, len(observations))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'transform.json').write_text(json.dumps(dict(S_kosmos_from_homie=transform.tolist(),
                                                       scale=fit['heldout']['scale'], model=fit['model']), indent=2) + '\n')
    (out / 'metrics.json').write_text(json.dumps(dict(example='synthetic fit only', fit=fit,
                                                     verdict=label, reason=reason), indent=2) + '\n')
    print(f"Recovered {fit['model']} transform; held-out median {fit['heldout']['heldout_t_median_cm']:.2f} cm")
    print(f'{label}: independent scene/depth checks need real input data')
    print(f'Outputs: {out.resolve()}')


if __name__ == '__main__':
    main()
