"""Sinh các scenario viết tay để test AV stack và sim, không cần video.

    python -m scenarios.handmade.make_examples

1. lead_brake.json : xe trước phanh gấp rồi dừng hẳn trong làn ego; làn trái trống,
                     có một xe máy chạy nhanh hơn ở làn trái; cuối đường có đèn đỏ.
2. jaywalker.json  : giống (1) nhưng thêm event một người đi bộ băng qua đường (mode M4).
"""

from __future__ import annotations

import copy
import math
import os

import numpy as np

from pipeline.export import save
from sim.agents import IDMParams, idm_accel

HERE = os.path.dirname(os.path.abspath(__file__))
DT = 0.1
T_END = 30.0


def straight_lanes(length=450.0, width=3.5):
    xs = np.arange(-20, length, 2.0)
    mk = lambda y: np.round(np.stack([xs, np.full_like(xs, y)], 1), 3).tolist()  # noqa: E731
    return [
        {"id": "l_L1", "centerline": mk(width), "width": width, "left": None, "right": "l_ego"},
        {"id": "l_ego", "centerline": mk(0.0), "width": width, "left": "l_L1", "right": None},
    ]


def traj(ts, xs, ys, yaws, vs):
    return [{"t": round(float(t), 3), "x": round(float(x), 3), "y": round(float(y), 3),
             "yaw": round(float(w), 4), "v": round(float(v), 3)} for t, x, y, w, v in zip(ts, xs, ys, yaws, vs)]


def lead_brake():
    ts = np.arange(0, T_END + 1e-9, DT)
    # Xe trước: 11 m/s, tới t = 8 s thì phanh -3.5 m/s² cho tới khi dừng, sau đó đứng yên
    lv = np.where(ts < 8, 11.0, np.maximum(0.0, 11.0 - 3.5 * (ts - 8)))
    lx = 30 + np.r_[0, np.cumsum(lv[:-1] * DT)]
    # Ego log (người lái thật): IDM bám xe trước, sau đó đứng chờ phía sau
    p = IDMParams(T=1.4)
    ex, ev = [0.0], [12.0]
    for i in range(1, len(ts)):
        gap = lx[i - 1] - ex[-1] - 4.5
        a = idm_accel(ev[-1], 13.0, gap, lv[i - 1], p)
        ev.append(max(0.0, ev[-1] + a * DT))
        ex.append(ex[-1] + ev[-1] * DT)
    ex, ev = np.array(ex), np.array(ev)
    # Xe máy ở làn trái: 14 m/s
    mx = -25 + 14.0 * ts
    agents = [
        {"id": 1, "class": "car", "variant": 0, "size": [4.5, 1.8, 1.5],
         "trajectory": traj(ts, lx, np.zeros_like(ts), np.zeros_like(ts), lv),
         "confidence": 1.0, "behavior": {"mode": "log_replay", "reactive_fallback": "idm"}},
        {"id": 2, "class": "motorbike", "variant": 1, "size": [1.9, 0.7, 1.5],
         "trajectory": traj(ts, mx, np.full_like(ts, 3.3), np.zeros_like(ts), np.full_like(ts, 14.0)),
         "confidence": 1.0, "behavior": {"mode": "log_replay", "reactive_fallback": "idm"}},
    ]
    return {
        "schema_version": "0.1",
        "meta": {"source": "handmade:lead_brake", "frame": "ego_t0", "origin_gps": None, "fps": 1 / DT,
                 "duration": T_END, "video_start": 0.0, "speed_limit": 50 / 3.6, "camera": {}},
        "map": {"lanes": straight_lanes(), "road_edges": [], "signs": []},
        "ego": {"size": [4.5, 1.8, 1.5], "trajectory": traj(ts, ex, np.zeros_like(ts), np.zeros_like(ts), ev)},
        "agents": agents,
        "traffic_lights": [{"id": "tl_1", "pos": [330.0, 6.0, 4.5], "states": [[0.0, "red"], [27.0, "green"]]}],
        "events": [],
    }


def jaywalker(base):
    """Người băng qua đường khi ego còn cách 35 m (theo điều kiện, nên AV chạy tốc độ nào cũng gặp, BUG_LOG B13)."""
    scn = copy.deepcopy(base)
    scn["meta"]["source"] = "handmade:jaywalker"
    scn["npcs"] = [{"id": "ped", "class": "pedestrian", "size": [0.5, 0.5, 1.7], "lane": "l_ego", "s0": 120.0, "d0": 6.8,
                    "v0": 0.0, "phases": [{"when": {"gap_lt": 35}, "do": {"d_rate": -1.6, "stop_d": -4.0}}]}]
    return scn


def incident_base(name, duration=20.0, v=13.9):
    ts = np.arange(0, duration + 1e-9, DT)
    x = v * ts
    z = np.zeros_like(ts)
    return {
        "schema_version": "0.1",
        "meta": {"source": f"handmade:{name}", "frame": "ego_t0", "origin_gps": None, "fps": 1 / DT, "duration": duration,
                 "video_start": 0.0, "speed_limit": 50 / 3.6, "camera": {}},
        "map": {"lanes": straight_lanes(), "road_edges": [], "signs": []},
        "ego": {"size": [4.5, 1.8, 1.5], "trajectory": traj(ts, x, z, z, np.full_like(ts, v))},
        "agents": [], "traffic_lights": [], "events": [], "npcs": [],
    }


CAR = {"class": "car", "size": [4.5, 1.8, 1.5]}


def cut_in(gap=12.0):
    """Xe làn bên chạy song song rồi tạt đầu khi còn cách ego `gap` mét, sau đó phanh."""
    scn = incident_base("cut_in")
    scn["npcs"] = [{"id": "cutter", **CAR, "lane": "l_L1", "s0": 70.0, "v0": 10.0, "phases": [
        {"when": {"gap_lt": gap}, "do": {"lane": "l_ego", "duration": 1.2}},
        {"when": {"t_gt": 0}, "do": {"v": 7.0, "accel": 3.0}}]}]
    return scn


def brake_check(gap=25.0, decel=8.0):
    """Xe trước đột ngột phanh hết cỡ."""
    scn = incident_base("brake_check")
    scn["npcs"] = [{"id": "lead", **CAR, "lane": "l_ego", "s0": 45.0, "v0": 13.9, "phases": [
        {"when": {"t_gt": 4.0, "gap_lt": gap + 30}, "do": {"v": 0.0, "accel": decel}}]}]
    return scn


def wrong_way():
    """Xe đi ngược chiều ngay trong làn ego."""
    scn = incident_base("wrong_way")
    scn["npcs"] = [{"id": "wrong", **CAR, "lane": "l_ego", "s0": 230.0, "v0": -11.0}]
    return scn


def red_light_runner(gap=32.0):
    """Xe từ đường ngang lao qua khi ego tới gần."""
    scn = incident_base("red_light_runner")
    scn["npcs"] = [{"id": "runner", **CAR, "lane": "l_ego", "s0": 150.0, "d0": -28.0, "v0": 0.0, "phases": [
        {"when": {"gap_lt": gap}, "do": {"d_rate": 11.0, "stop_d": 40.0}}]}]
    return scn


def main():
    base = lead_brake()
    save(base, os.path.join(HERE, "lead_brake.json"))
    save(jaywalker(base), os.path.join(HERE, "jaywalker.json"))
    for name, scn in [("cut_in", cut_in()), ("brake_check", brake_check()), ("wrong_way", wrong_way()),
                      ("red_light_runner", red_light_runner())]:
        save(scn, os.path.join(HERE, f"{name}.json"))
    print("Đã ghi lead_brake, jaywalker, cut_in, brake_check, wrong_way, red_light_runner")


if __name__ == "__main__":
    main()
