# Copyright 2026 Ropedia Research Team
# SPDX-License-Identifier: Apache-2.0
"""Registration labels. Missing or non-finite independent checks cannot pass."""
import math


def _finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def verdict(init, fit, checks, n_localized=None):
    if init.get('n_consensus', 0) < 3 and not init.get('single_strong'):
        return 'FAIL', 'visual initialization found no consistent pose'
    if not fit or fit.get('n_fit', 0) < 8 or (n_localized is not None and n_localized < 8):
        return 'FAIL', 'fewer than eight reliable localized frames'
    heldout = fit.get('heldout', {})
    median = heldout.get('heldout_t_median_cm')
    p90 = heldout.get('heldout_t_p90_cm')
    if not _finite(median) or not _finite(p90):
        return 'FAIL', 'held-out errors are missing or non-finite'
    if p90 > 30:
        return 'FAIL', 'held-out p90 > 30 cm'
    translation = checks.get('icp_vs_final_trans_cm')
    if _finite(translation) and translation > 30:
        return 'FAIL', 'depth geometry contradicts visual alignment (ICP moves > 30 cm)'
    reasons = []
    required = ('gravity_deg', 'depth_overlap_pct', 'depth_residual_median_cm',
                'icp_vs_final_rot_deg', 'icp_vs_final_trans_cm')
    missing = [key for key in required if not _finite(checks.get(key))]
    if missing:
        reasons.append('independent checks unavailable: ' + ', '.join(missing))
    if checks.get('depth_error'):
        reasons.append('depth check failed')
    if median > 5:
        reasons.append('held-out median > 5 cm')
    if p90 > 12:
        reasons.append('held-out p90 > 12 cm')
    gravity = checks.get('gravity_deg')
    rotation = checks.get('icp_vs_final_rot_deg')
    if _finite(gravity) and gravity > 2:
        reasons.append('gravity mismatch > 2 deg')
    if (_finite(rotation) and rotation > 2) or (_finite(translation) and translation > 10):
        reasons.append('depth ICP disagrees (> 2 deg or > 10 cm)')
    return ('WEAK', '; '.join(reasons)) if reasons else ('PASS', 'all checks passed')
