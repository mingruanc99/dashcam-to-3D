"""Metrics và điểm tổng (PLAN.md mục 8), tính kiểu nuPlan closed-loop score.

score = Π(hệ số phạt nặng) × trung bình có trọng số(các điểm mềm)
  hệ số phạt nặng : va chạm, vượt đèn đỏ, ra khỏi làn/đường. Dính một lỗi là bị nhân 0 hoặc 0.5.
  điểm mềm        : progress (5), TTC (5), comfort (2)
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd


def compute(log: list[dict], incidents: list[dict], mode: str) -> dict:
    df = pd.DataFrame(log)
    dt = float(np.median(np.diff(df.t))) if len(df) > 1 else 0.05
    a = df["a"].values
    jerk = np.diff(a) / dt if len(a) > 1 else np.zeros(1)
    a_lat = df["v"].values * df["yaw_rate"].values
    collisions = [i for i in incidents if i["type"] == "collision"]
    red = [i for i in incidents if i["type"] == "red_light"]
    # Lệch khỏi quỹ đạo người lái thật
    err = np.hypot(df.x - df.log_x, df.y - df.log_y)
    # progress: quãng đường đi được so với người lái thật
    dist = float(np.sum(np.hypot(np.diff(df.x), np.diff(df.y))))
    dist_log = float(np.sum(np.hypot(np.diff(df.log_x), np.diff(df.log_y))))
    progress = min(1.0, dist / dist_log) if dist_log > 1 else 1.0
    ttc = df["ttc"].replace([np.inf], np.nan)
    min_ttc = float(np.nanmin(ttc)) if ttc.notna().any() else math.inf
    off_lane = float((df["lane_excess"] > 0.5).mean())

    no_collision = 0.0 if any(c["agent_mode"] == "reactive" for c in collisions) else (0.5 if collisions else 1.0)
    # Va chạm với agent đang log_replay (agent không phản ứng được) thì phạt nhẹ hơn
    multipliers = no_collision * (0.0 if red else 1.0) * (0.5 if off_lane > 0.05 else 1.0)
    ttc_ok = 1.0 if min_ttc > 1.5 else 0.0
    comfort_ok = float(np.max(np.abs(a)) < 4.0 and np.percentile(np.abs(jerk), 95) < 6.0 and np.max(np.abs(a_lat)) < 4.0)
    score = multipliers * (5 * progress + 5 * ttc_ok + 2 * comfort_ok) / 12

    return {
        "mode": mode,
        "score": round(score, 4),
        "safety": {
            "collisions": len(collisions),
            "collision_details": collisions,
            "min_ttc_s": None if math.isinf(min_ttc) else round(min_ttc, 3),
            "min_distance_m": round(float(df["min_dist"].replace([np.inf], np.nan).min()), 3)
            if df["min_dist"].replace([np.inf], np.nan).notna().any() else None,
            "red_light_violations": len(red),
            "off_lane_ratio": round(off_lane, 4),
        },
        "progress": {
            "distance_m": round(dist, 2),
            "distance_log_m": round(dist_log, 2),
            "ratio": round(progress, 4),
        },
        "comfort": {
            "max_accel": round(float(a.max()), 3),
            "max_decel": round(float(-a.min()), 3),
            "max_abs_jerk": round(float(np.max(np.abs(jerk))), 3),
            "p95_abs_jerk": round(float(np.percentile(np.abs(jerk), 95)), 3),
            "max_lat_accel": round(float(np.max(np.abs(a_lat))), 3),
            "hard_brakes": int(np.sum((a[1:] < -3.0) & (a[:-1] >= -3.0))),
        },
        "human_likeness": {
            "ADE_m": round(float(err.mean()), 3),
            "FDE_m": round(float(err.iloc[-1]), 3),
        },
        "system": {
            "av_ms_mean": round(float(df["av_ms"].mean()), 3),
            "av_ms_max": round(float(df["av_ms"].max()), 3),
            "steps": len(df),
        },
        "agents_switched_reactive": [i for i in incidents if i["type"] == "agent_reactive"],
    }
