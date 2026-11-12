# Copyright 2026 Ropedia Research Team
# SPDX-License-Identifier: Apache-2.0
import copy
import math
import unittest

from scene_registration.quality import verdict


class QualityTests(unittest.TestCase):
    def setUp(self):
        self.init = dict(n_consensus=4)
        self.fit = dict(n_fit=20, heldout=dict(heldout_t_median_cm=2.0, heldout_t_p90_cm=6.0))
        self.checks = dict(gravity_deg=1.0, depth_overlap_pct=80.0, depth_residual_median_cm=2.0,
                           icp_vs_final_rot_deg=1.0, icp_vs_final_trans_cm=4.0)

    def label(self, checks=None):
        return verdict(self.init, self.fit, self.checks if checks is None else checks, 20)[0]

    def test_complete_good_checks_pass(self):
        self.assertEqual(self.label(), 'PASS')

    def test_pass_thresholds_are_inclusive(self):
        self.fit['heldout'].update(heldout_t_median_cm=5, heldout_t_p90_cm=12)
        self.checks.update(gravity_deg=2, icp_vs_final_rot_deg=2, icp_vs_final_trans_cm=10)
        self.assertEqual(self.label(), 'PASS')

    def test_each_missing_independent_check_prevents_pass(self):
        for key in self.checks:
            with self.subTest(key=key):
                partial = copy.copy(self.checks)
                del partial[key]
                self.assertEqual(self.label(partial), 'WEAK')

    def test_nonfinite_checks_prevent_pass(self):
        for value in (math.nan, math.inf, -math.inf, None):
            with self.subTest(value=value):
                self.assertEqual(self.label(dict(self.checks, gravity_deg=value)), 'WEAK')

    def test_skipped_depth_is_weak(self):
        self.assertEqual(self.label(dict(gravity_deg=1.0)), 'WEAK')

    def test_depth_exception_prevents_pass(self):
        self.assertEqual(self.label(dict(self.checks, depth_error='no valid points')), 'WEAK')

    def test_threshold_miss_is_weak(self):
        for key, value in (('gravity_deg', 2.1), ('icp_vs_final_rot_deg', 2.1),
                           ('icp_vs_final_trans_cm', 10.1)):
            with self.subTest(key=key):
                self.assertEqual(self.label(dict(self.checks, **{key: value})), 'WEAK')

    def test_contradicting_depth_is_fail(self):
        self.assertEqual(self.label(dict(self.checks, icp_vs_final_trans_cm=30.1)), 'FAIL')

    def test_bad_heldout_or_missing_errors_are_fail(self):
        for value in (30.1, math.nan, None):
            with self.subTest(value=value):
                self.fit['heldout']['heldout_t_p90_cm'] = value
                self.assertEqual(self.label(), 'FAIL')

    def test_insufficient_visual_evidence_is_fail(self):
        self.assertEqual(verdict(dict(n_consensus=0), self.fit, self.checks, 20)[0], 'FAIL')
        self.assertEqual(verdict(self.init, self.fit, self.checks, 7)[0], 'FAIL')
        self.assertEqual(verdict(self.init, None, self.checks, 20)[0], 'FAIL')

    def test_toe_height_is_diagnostic_only(self):
        self.assertEqual(self.label(dict(self.checks, lowest_toe_cm_median=-20)), 'PASS')


if __name__ == '__main__':
    unittest.main()
