# Copyright 2026 Ropedia Research Team
# SPDX-License-Identifier: Apache-2.0
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import h5py
import numpy as np
from scipy.spatial.transform import Rotation

from scene_registration.align import (Homie, Kosmos, fit_and_eval, robust_fit,
                                      umeyama, write_mocap, write_outputs, xf)
from scene_registration.sources import Source


def observations(centres, scale=1.0, scene_offset=None):
    rotation = Rotation.from_euler('xyz', [8, -12, 35], degrees=True).as_matrix()
    expected = np.eye(4)
    expected[:3, :3] = scale * rotation
    expected[:3, 3] = [2, -1, 0.7] if scene_offset is None else scene_offset
    world = np.repeat(np.eye(4)[None], len(centres), axis=0)
    world[:, :3, 3] = centres
    localized = []
    for i, point in enumerate(xf(expected, centres)):
        pose = np.eye(4)
        pose[:3, :3], pose[:3, 3] = rotation, point
        localized.append(dict(i=i, inl=100, Tpnp=pose))
    return SimpleNamespace(TwcL=world), localized, expected


class FittingTests(unittest.TestCase):
    def setUp(self):
        self.points = np.random.default_rng(4).normal(size=(48, 3)) * [3, 2, 0.5]

    def test_umeyama_recovers_rigid_and_similarity(self):
        for scale in (1, 1.04):
            with self.subTest(scale=scale):
                _, _, expected = observations(self.points, scale)
                fitted = umeyama(self.points, xf(expected, self.points), scale != 1)
                np.testing.assert_allclose(fitted, expected, atol=1e-12)

    def test_umeyama_never_returns_a_reflection(self):
        reflected = self.points.copy()
        reflected[:, 0] *= -1
        self.assertGreater(np.linalg.det(umeyama(self.points, reflected, False)[:3, :3]), 0)

    def test_robust_fit_rejects_large_outliers(self):
        _, _, expected = observations(self.points, 1.03)
        target = xf(expected, self.points)
        target[:6] += [5, -7, 3]
        fitted, keep = robust_fit(self.points, target, True)
        np.testing.assert_allclose(fitted, expected, atol=1e-10)
        self.assertFalse(keep[:6].any())

    def test_stationary_trajectory_uses_rotations(self):
        hm, loc, expected = observations(np.repeat([[0.2, -0.1, 1.5]], 24, axis=0))
        fitted, fit = fit_and_eval(hm, loc)
        np.testing.assert_allclose(fitted, expected, atol=1e-10)
        self.assertEqual(fit['model'], 'pose_avg')
        self.assertTrue(np.isfinite(fitted).all())

    def test_short_trajectory_keeps_unit_scale(self):
        hm, loc, _ = observations(self.points * 0.05, 1.08)
        fitted, fit = fit_and_eval(hm, loc)
        self.assertIn(fit['model'], ('se3', 'pose_avg'))
        self.assertAlmostEqual(np.linalg.det(fitted[:3, :3]), 1.0)

    def test_long_trajectory_can_select_similarity(self):
        hm, loc, expected = observations(self.points, 1.04)
        fitted, fit = fit_and_eval(hm, loc)
        self.assertEqual(fit['model'], 'sim3')
        np.testing.assert_allclose(fitted, expected, atol=1e-10)

    def test_heldout_errors_do_not_use_the_final_all_frame_fit(self):
        hm, loc, _ = observations(self.points)
        for record in loc[1::2]:
            record['Tpnp'][:3, 3] += [0.8, 0, 0]
        _, fit = fit_and_eval(hm, loc)
        self.assertGreater(fit['heldout']['heldout_t_median_cm'], 70)

    def test_split_half_error_is_independent_of_scene_origin(self):
        hm, loc, _ = observations(self.points)
        drift = Rotation.from_euler('z', 1, degrees=True).as_matrix()
        for record in loc[len(loc) // 2:]:
            record['Tpnp'][:3, 3] = drift @ record['Tpnp'][:3, 3] + [0.02, 0.01, 0]
            record['Tpnp'][:3, :3] = drift @ record['Tpnp'][:3, :3]
        _, first = fit_and_eval(hm, loc)
        for record in loc:
            record['Tpnp'][:3, 3] += [100, -50, 20]
        _, shifted = fit_and_eval(hm, loc)
        self.assertAlmostEqual(first['halves_disagree_cm'], shifted['halves_disagree_cm'], places=7)

    def test_insufficient_frames_produce_no_transform(self):
        hm, loc, _ = observations(self.points[:6])
        fitted, fit = fit_and_eval(hm, loc)
        self.assertIsNone(fitted)
        self.assertEqual(fit['n_fit'], 6)


class DataAndExportTests(unittest.TestCase):
    def test_missing_scan_model_is_an_input_error(self):
        with tempfile.TemporaryDirectory() as root, self.assertRaisesRegex(ValueError, 'exactly one colmap'):
            Kosmos(Source(root), root)

    def test_sources_reject_cloud_locations_and_missing_paths(self):
        for path in ('s3://example/scene', '/definitely/missing/xperience-scene'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                Source(path)

    def test_radial_camera_uses_the_correct_principal_point(self):
        ks = object.__new__(Kosmos)
        for model, parameters in (('SIMPLE_RADIAL', [100, 30, 40, 0]), ('RADIAL', [100, 30, 40, 0, 0])):
            with self.subTest(model=model):
                ks.cams = {1: dict(model=model, p=np.array(parameters, float))}
                rays = ks.rays(dict(cam=1), np.array([[30, 40], [40, 60]], float))
                np.testing.assert_allclose(rays, [[0, 0, 1], [0.1, 0.2, 1]], atol=1e-12)

    def test_cropped_video_requires_its_calibration(self):
        with tempfile.TemporaryDirectory() as root:
            data = Path(root) / 'mocap_main'
            data.mkdir()
            np.savetxt(data / 'f_slam.txt', np.tile([0, 0, 0, 0, 0, 0, 0, 1], (8, 1)))
            (data / 'calibration.json').write_text(json.dumps(dict(cam01=dict(K=[100, 100, 64, 48], T_c0_b=np.eye(4).tolist()))))
            (data / 'stereo_left_synced.mp4').touch()
            with self.assertRaisesRegex(ValueError, 'cropped video needs'):
                Homie(Source(root))

    def make_motion(self, root):
        data = Path(root) / 'mocap_main'
        data.mkdir()
        body = np.ones((3, 52, 3))
        body[1, 0] = 0
        hand = np.ones((3, 21, 3)) * [0.1, 0.2, 0.7]
        hand[1] = 0
        with h5py.File(data / 'annotation.hdf5', 'w') as file:
            file['full_body_mocap/keypoints'] = body
            file['video/device_timestamp'] = np.array([0, 33333333, 66666666], np.int64)
            file['hand_mocap/left_joints_3d'] = hand
        poses = np.repeat(np.eye(4)[None], 2, axis=0)
        poses[:, :3, :3] = np.stack([Rotation.from_euler('z', value, degrees=True).as_matrix() for value in (10, 20)])
        poses[:, :3, 3] = [[1, 2, 3], [2, 3, 4]]
        hm = SimpleNamespace(src=Source(root), TwcL=poses, Twb=poses, ts=np.array([0, 1 / 30]), n=2)
        _, _, transform = observations(np.ones((8, 3)), scale=1.06)
        return hm, transform, body, hand

    def test_hand_export_composes_camera_pose_and_similarity(self):
        with tempfile.TemporaryDirectory() as root:
            hm, transform, body, hand = self.make_motion(root)
            write_mocap(root, hm, transform)
            with np.load(Path(root) / 'homie_mocap_in_kosmos.npz') as result:
                expected = xf(transform @ hm.TwcL[0], hand[0])
                np.testing.assert_allclose(result['left_hand_joints21'][0], expected)
                self.assertTrue(np.isnan(result['left_hand_joints21'][1:]).all())
                self.assertTrue(np.isnan(result['body_keypoints_smplh52'][1, 0]).all())
                np.testing.assert_allclose(result['body_keypoints_smplh52'][0], xf(transform, body[0]))
                recovered = xf(np.linalg.inv(transform @ hm.TwcL[0]), result['left_hand_joints21'][0])
                np.testing.assert_allclose(recovered, hand[0], atol=1e-12)
                np.testing.assert_array_equal(result['timestamps_ns'], [0, 33333333, 66666666])

    def test_tum_quaternions_do_not_contain_similarity_scale(self):
        with tempfile.TemporaryDirectory() as root:
            hm, transform, _, _ = self.make_motion(root)
            metrics = dict(fit=dict(model='sim3'), kosmos=dict(name='synthetic'), homie=dict(source=root))
            write_outputs(root, hm, None, transform, [], metrics, make_figures=False)
            rows = np.loadtxt(Path(root) / 'homie_stereo_left_rect_in_kosmos.txt')
            np.testing.assert_allclose(rows[:, 1:4], xf(transform, hm.TwcL[:, :3, 3]), atol=1e-6)
            np.testing.assert_allclose(np.linalg.norm(rows[:, 4:8], axis=1), 1.0, atol=1e-8)
            self.assertEqual(metrics['exports']['mocap'], 'written')


if __name__ == '__main__':
    unittest.main()
