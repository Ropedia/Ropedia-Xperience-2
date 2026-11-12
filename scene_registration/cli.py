# Copyright 2026 Ropedia Research Team
# SPDX-License-Identifier: Apache-2.0
"""Command line entry point for local HOMIE-to-KOSMO registration."""
import argparse
import json
import math
import sys
import time
from pathlib import Path

from . import __version__


def json_safe(value):
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return None if isinstance(value, float) and not math.isfinite(value) else value


def positive_integer(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError('must be a positive integer')
    return number


def parser():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--version', action='version', version=__version__)
    ap.add_argument('--kosmo', '--kosmos', dest='kosmos', required=True,
                    help='local scene directory with colmap/, images/, and obj/')
    ap.add_argument('--homie', required=True, help='local recording directory with mocap_main/')
    ap.add_argument('--out', required=True, help='new output directory')
    ap.add_argument('--cache', help='mesh cache directory (default: <out>/cache)')
    ap.add_argument('--step', type=positive_integer, help='frame step (default: about 200 query frames)')
    ap.add_argument('--init-queries', type=positive_integer, default=30)
    ap.add_argument('--init-db', type=positive_integer, help='number of scan images for initialization')
    ap.add_argument('--verify-only', action='store_true', help='only check visual pairing; does not validate registration')
    ap.add_argument('--no-depth', action='store_true', help='skip depth/ICP checks; the result cannot be PASS')
    ap.add_argument('--no-figures', action='store_true', help='omit overlay.jpg and topdown.png')
    return ap


def run(args):
    from .align import (Homie, Kosmos, checks, fine_localize, fit_and_eval,
                        global_init, log, write_outputs)
    from .quality import verdict
    from .sources import Source

    started = time.time()
    ksrc, hsrc = Source(args.kosmos), Source(args.homie)
    out = Path(args.out).expanduser().resolve()
    if out.exists() and any(out.iterdir()):
        raise ValueError('output directory must be empty; choose a new --out to preserve earlier results')
    out.mkdir(parents=True, exist_ok=True)
    args.out = str(out)
    cache = Path(args.cache).expanduser().resolve() if args.cache else out / 'cache'
    cache.mkdir(parents=True, exist_ok=True)
    metrics = dict(tool_version=__version__,
                   kosmos=dict(source=ksrc.prefix, name=Path(ksrc.prefix).name),
                   homie=dict(source=hsrc.prefix))
    try:
        hm = Homie(hsrc)
        metrics['homie']['frames'] = hm.n
        log(f'HOMIE: {hm.n} frames, video {hm.W}x{hm.H}')
        ks = Kosmos(ksrc, str(cache))
        ndb = args.init_db or min(800, max(250, len(ks.db) // 8))
        transform, init = global_init(hm, ks, args.init_queries, ndb)
        metrics['init'] = init
        log('initialization', init)
        initialized = transform is not None and (init['n_consensus'] >= 3 or init.get('single_strong'))
        if not initialized:
            metrics['verdict'], metrics['reason'] = verdict(init, None, {})
        elif args.verify_only:
            if init['n_consensus'] >= 3:
                metrics.update(verdict='VERIFIED', reason='visual pairing only; registration checks have not run')
            else:
                metrics.update(verdict='WEAK', reason='single-frame hypothesis needs multi-frame confirmation')
        else:
            step = args.step or max(10, hm.n // 200)
            loc = fine_localize(hm, ks, transform, step)
            fitted, fit = fit_and_eval(hm, loc)
            if fitted is not None:
                second = fine_localize(hm, ks, fitted, step)
                refined, refined_fit = fit_and_eval(hm, second)
                if refined is not None:
                    loc, fitted, fit = second, refined, refined_fit
            metrics.update(fit=fit, n_localized=len(loc), n_queries=len(range(0, hm.n, step)))
            independent = checks(hm, ks, fitted, not args.no_depth) if fitted is not None else {}
            metrics['checks'] = independent
            metrics['verdict'], metrics['reason'] = verdict(init, fit, independent, len(loc))
            if fitted is not None:
                write_outputs(str(out), hm, ks, fitted, loc, metrics, make_figures=not args.no_figures)
    except Exception as exc:
        metrics.update(verdict='ERROR', reason=f'{type(exc).__name__}: {exc}')
        raise
    finally:
        metrics['runtime_s'] = round(time.time() - started)
        (out / 'metrics.json').write_text(json.dumps(json_safe(metrics), indent=2, allow_nan=False) + '\n')
    log(metrics['verdict'], metrics['reason'])
    return 0 if metrics['verdict'] in ('PASS', 'VERIFIED') else 2


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        return run(args)
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception as exc:
        print(f'xperience-register: {type(exc).__name__}: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
