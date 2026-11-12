"""Chạy một scenario trong sim 2D và xuất report.

    python -m sim.run scenarios/handmade/lead_brake_cutin.json --mode M3 --plot
    python -m sim.run scenarios/generated/clip_120.json --mode M2 --out runs/clip_120_m2

Kết quả: <out>/report.json, <out>/log.parquet, <out>/plot.png (nếu có --plot).
"""

from __future__ import annotations

import argparse
import json
import os

import pandas as pd

from av_stack import AVStack
from eval import metrics
from pipeline.export import load

from .world import MODES, Simulator

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(scenario: dict, mode: str = "M3", dt: float = 0.05, verbose: bool = False, av=None):
    sim = Simulator(scenario, mode, av or AVStack(), dt)
    log, incidents = sim.run(verbose)
    return sim, metrics.compute(log, incidents, mode)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("scenario")
    ap.add_argument("--mode", choices=MODES, default="M3")
    ap.add_argument("--dt", type=float, default=0.05)
    ap.add_argument("--out")
    ap.add_argument("--plot", action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)

    scn = load(a.scenario)
    name = os.path.splitext(os.path.basename(a.scenario))[0]
    out = a.out or os.path.join(ROOT, "runs", f"{name}_{a.mode}")
    os.makedirs(out, exist_ok=True)
    sim, report = run(scn, a.mode, a.dt, a.verbose)
    report["scenario"] = a.scenario
    pd.DataFrame(sim.log).to_parquet(os.path.join(out, "log.parquet"), index=False)
    with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=float)
    s = report["safety"]
    print(f"score={report['score']:.3f}  collisions={s['collisions']}  red_light={s['red_light_violations']}  "
          f"min_ttc={s['min_ttc_s']}  progress={report['progress']['ratio']:.2f}  "
          f"ADE={report['human_likeness']['ADE_m']} m  reactive={len(report['agents_switched_reactive'])}")
    if a.plot:
        from .plot import plot_run
        plot_run(scn, sim, report, os.path.join(out, "plot.png"))
    print(f"-> {out}")


if __name__ == "__main__":
    main()
