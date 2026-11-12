"""Quét tham số: tình huống nào AV tránh được, tình huống nào không.

    python -m sim.sweep

In bảng cho kịch bản tạt đầu: cột là độ trễ phản ứng, hàng là khoảng cách lúc xe kia bắt đầu tạt.
"""

from __future__ import annotations

import common  # noqa: F401

from av_stack import AVStack
from eval import metrics  # noqa: F401
from scenarios.handmade.make_examples import cut_in

from .world import Simulator


def outcome(scn, reaction: float) -> str:
    sim = Simulator(scn, "M2", AVStack(reaction_delay=reaction))
    log, inc = sim.run()
    hits = [i for i in inc if i["type"] == "collision"]
    if hits:
        return f"ĐÂM {hits[0]['ego_v'] * 3.6:3.0f}"
    return f"ok {min(r['min_dist'] for r in log):4.1f}"


def main():
    delays = [0.0, 0.3, 0.6, 1.0, 1.5]
    print("Tạt đầu ở 50 km/h. 'ok x' = cách nhau gần nhất x m; 'ĐÂM v' = đâm ở v km/h")
    print("gap(m) | " + " | ".join(f"trễ {d:.1f}s" for d in delays))
    for gap in (25, 18, 12, 8, 5, 3):
        print(f"{gap:6d} | " + " | ".join(f"{outcome(cut_in(float(gap)), d):>8}" for d in delays))


if __name__ == "__main__":
    main()
