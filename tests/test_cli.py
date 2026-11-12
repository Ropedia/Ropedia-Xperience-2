# Copyright 2026 Ropedia Research Team
# SPDX-License-Identifier: Apache-2.0
import math
import contextlib
import io
import unittest

from scene_registration.cli import json_safe, parser


class CliTests(unittest.TestCase):
    def test_invalid_step_is_rejected_before_loading_data(self):
        with self.assertRaises(SystemExit) as raised, contextlib.redirect_stderr(io.StringIO()):
            parser().parse_args(['--kosmo', 'scene', '--homie', 'recording', '--out', 'result', '--step', '0'])
        self.assertEqual(raised.exception.code, 2)

    def test_nonfinite_diagnostics_serialize_to_null(self):
        self.assertEqual(json_safe(dict(a=math.nan, b=[math.inf, 1])), dict(a=None, b=[None, 1]))


if __name__ == '__main__':
    unittest.main()
