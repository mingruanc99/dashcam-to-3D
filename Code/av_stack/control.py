"""Điều khiển ngang (pure pursuit) và điều khiển dọc (ACC + AEB)."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from common.geometry import Polyline, wrap


@dataclass
class LateralParams:
    wheelbase: float = 2.7
    k_lookahead: float = 0.9  # Ld = k * v + L0
    l0: float = 4.0
    ld_min: float = 4.0
    ld_max: float = 25.0
    max_steer: float = 0.55  # rad, góc bánh trước
    max_steer_rate: float = 0.7  # rad/s (PDF: vô lăng ~720°/s, tỉ số lái ~15)


class PurePursuit:
    """Chọn điểm ngắm cách xe Ld trên path, rồi tính góc lái theo cung tròn đi qua điểm đó.

    δ = atan(2 L sin α / Ld). Sau đó qua saturation và rate limiter, giống khối
    Saturation Dynamic và Rate Limiter Dynamic ở PDF mục 6.3.4.
    """

    def __init__(self, p: LateralParams | None = None):
        self.p = p or LateralParams()
        self.prev = 0.0

    def reset(self):
        self.prev = 0.0

    def step(self, ego: dict, path: Polyline, dt: float) -> tuple[float, dict]:
        p = self.p
        v = max(ego["v"], 0.0)
        rx = ego["x"] - math.cos(ego["yaw"]) * p.wheelbase / 2  # cầu sau
        ry = ego["y"] - math.sin(ego["yaw"]) * p.wheelbase / 2
        s0, _, _ = path.project(rx, ry)
        ld = float(np.clip(p.k_lookahead * v + p.l0, p.ld_min, p.ld_max))
        (tx, ty), = path.point(s0 + ld)[0]
        alpha = wrap(math.atan2(ty - ry, tx - rx) - ego["yaw"])
        dist = math.hypot(tx - rx, ty - ry)
        raw = math.atan2(2 * p.wheelbase * math.sin(alpha), max(dist, 1e-3))
        sat = float(np.clip(raw, -p.max_steer, p.max_steer))
        step = p.max_steer_rate * dt
        out = float(np.clip(sat, self.prev - step, self.prev + step))
        self.prev = out
        return out, {"lookahead": ld, "target": [tx, ty], "steer_raw": raw}


@dataclass
class LongitudinalParams:
    a_max: float = 1.5
    a_min: float = -3.0  # phanh thoải mái
    a_aeb: float = -6.0  # phanh khẩn cấp (> 0.5 g, PDF mục 2.1.1)
    jerk_max: float = 4.0
    kp_v: float = 0.6
    ki_v: float = 0.08
    i_limit: float = 1.0
    time_gap: float = 1.6
    s0: float = 4.0  # khoảng cách tối thiểu khi dừng
    k_gap: float = 0.23
    k_dv: float = 0.75
    follow_range: float = 70.0
    aeb_ttc: float = 1.5


class LongitudinalController:
    """Chuyển giữa hai chế độ (PDF mục 6.4.1):
    - speed: PI bám theo v_des (PDF mục 6.4.4, có giới hạn tích phân).
    - distance: giữ khoảng cách s0 + v * time_gap với xe trước (PDF mục 6.4.3).
    Lấy giá trị nhỏ hơn (an toàn hơn) trong hai chế độ, rồi kiểm tra AEB theo TTC.
    """

    def __init__(self, p: LongitudinalParams | None = None):
        self.p = p or LongitudinalParams()
        self.integ = 0.0
        self.prev_a = 0.0

    def reset(self):
        self.integ = 0.0
        self.prev_a = 0.0

    def step(self, v: float, v_des: float, lead, dt: float) -> tuple[float, dict]:
        p = self.p
        e = v_des - v
        a_v = p.kp_v * e + p.ki_v * self.integ
        a_d, ttc, mode = math.inf, math.inf, "speed"
        if lead is not None and lead[0] < p.follow_range:
            gap, v_lead = lead[0], lead[1]
            gap_des = p.s0 + max(v, 0) * p.time_gap
            a_d = p.k_gap * (gap - gap_des) + p.k_dv * (v_lead - v)
            if v > v_lead:
                ttc = max(gap, 0.0) / (v - v_lead)
                # gia tốc tối thiểu cần để dừng/bám kịp trước khi hết khoảng trống
                a_req = -(v * v - max(v_lead, 0) ** 2) / (2 * max(gap - p.s0 * 0.5, 0.3))
                a_d = min(a_d, a_req * 1.1)
        a = min(a_v, a_d)
        if a_d < a_v:
            mode = "distance"
        else:
            self.integ = float(np.clip(self.integ + e * dt, -p.i_limit / p.ki_v, p.i_limit / p.ki_v))
        if ttc < p.aeb_ttc:
            a, mode = p.a_aeb, "aeb"
        else:
            a = float(np.clip(a, p.a_min, p.a_max))
            j = p.jerk_max * dt
            a = float(np.clip(a, self.prev_a - j, self.prev_a + j))
        self.prev_a = a
        return a, {"mode": mode, "ttc": ttc, "a_speed": a_v, "a_dist": a_d}
