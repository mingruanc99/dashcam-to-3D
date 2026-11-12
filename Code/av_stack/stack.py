"""Ghép planner và controller lại. Interface dùng chung cho sim Python, Unity bridge và ROS2.

reset(lanes)  : danh sách làn theo schema scenario (map.lanes)
step(obs)     : obs = {
    "t": float,
    "ego": {"x","y","yaw","v","length","width"},
    "objects": [{"id","class","x","y","yaw","v","length","width"}],
    "traffic_lights": [{"id","x","y","state"}],
    "speed_limit": float (m/s)
}
-> {"steer": rad (góc bánh trước, dương = rẽ trái), "accel": m/s², "debug": {...}}
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import asdict

from .control import LateralParams, LongitudinalController, LongitudinalParams, PurePursuit
from .planner import LanePlanner, PlannerParams


# (khóa, nhãn, min, max). Unity tự vẽ bảng thông số từ danh sách này, thêm dòng ở đây là có thanh trượt mới.
PARAM_SPEC = [
    ("reaction_delay", "Trễ phản ứng (s)", 0.0, 1.5),
    ("speed_factor", "Hệ số tốc độ so với giới hạn", 0.5, 1.3),
    ("a_lat_max", "Gia tốc ngang tối đa (m/s²)", 0.5, 5.0),
    ("longitudinal.time_gap", "Khoảng cách thời gian (s)", 0.5, 3.0),
    ("longitudinal.s0", "Khoảng cách khi dừng (m)", 1.0, 10.0),
    ("longitudinal.a_max", "Tăng tốc tối đa (m/s²)", 0.5, 4.0),
    ("longitudinal.a_min", "Phanh thường (m/s²)", -6.0, -1.0),
    ("longitudinal.a_aeb", "Phanh khẩn cấp (m/s²)", -10.0, -3.0),
    ("longitudinal.aeb_ttc", "Ngưỡng AEB theo TTC (s)", 0.0, 4.0),
    ("lateral.k_lookahead", "Hệ số nhìn xa khi lái", 0.2, 2.0),
    ("lateral.max_steer_rate", "Tốc độ đánh lái (rad/s)", 0.1, 2.0),
    ("planner.lane_change", "Cho phép đổi làn (0/1)", 0.0, 1.0),
    ("planner.lc_trigger_dist", "Khoảng cách bắt đầu đổi làn (m)", 10.0, 80.0),
    ("planner.lc_rear_gap", "Khoảng trống sau khi đổi làn (m)", 2.0, 30.0),
]
PRESETS = {
    "than_trong": {"speed_factor": 0.85, "longitudinal.time_gap": 2.2, "longitudinal.a_max": 1.0,
                   "longitudinal.aeb_ttc": 2.2, "planner.lc_rear_gap": 18.0},
    "binh_thuong": {},
    "hung_hang": {"speed_factor": 1.15, "longitudinal.time_gap": 0.9, "longitudinal.a_max": 2.8,
                  "longitudinal.aeb_ttc": 1.0, "planner.lc_rear_gap": 5.0, "planner.lc_trigger_dist": 65.0},
}


class AVStack:
    def __init__(self, planner: PlannerParams | None = None, lateral: LateralParams | None = None,
                 longitudinal: LongitudinalParams | None = None, a_lat_max: float = 2.0,
                 reaction_delay: float = 0.0, speed_factor: float = 1.0):
        self.reaction_delay = reaction_delay
        self.speed_factor = speed_factor
        self._percept = deque()
        self.pp = planner or PlannerParams()
        self.lat = PurePursuit(lateral)
        self.lon = LongitudinalController(longitudinal)
        self.a_lat_max = a_lat_max
        self.planner: LanePlanner | None = None
        self.last_t = None
        self._defaults = self._all_values()

    # ------------------------------------------------------------------ tham số
    def _owner(self, key: str):
        if "." not in key:
            return self, key
        group, name = key.split(".", 1)
        return {"planner": self.pp, "lateral": self.lat.p, "longitudinal": self.lon.p}[group], name

    def _all_values(self) -> dict:
        return {k: float(getattr(*self._owner(k))) for k, *_ in PARAM_SPEC}

    def set_params(self, values: dict | None = None, preset: str | None = None) -> None:
        """Đổi tham số lúc đang chạy. preset áp lên giá trị mặc định, values áp sau cùng."""
        merged = {}
        if preset is not None:
            merged = {**self._defaults, **PRESETS[preset]}
        merged.update(values or {})
        spec = {k: (lo, hi) for k, _, lo, hi in PARAM_SPEC}
        for k, v in merged.items():
            if k not in spec:
                raise KeyError(f"tham số không có: {k}")
            obj, name = self._owner(k)
            v = min(max(float(v), spec[k][0]), spec[k][1])
            setattr(obj, name, type(getattr(obj, name))(v))

    def describe_params(self) -> list[dict]:
        vals = self._all_values()
        return [{"key": k, "label": lb, "min": lo, "max": hi, "value": vals[k]} for k, lb, lo, hi in PARAM_SPEC]

    def reset(self, lanes: list[dict]):
        self.planner = LanePlanner(lanes, self.pp)
        self.lat.reset()
        self.lon.reset()
        self.last_t = None
        self._percept.clear()

    def _delayed(self, t: float, obs: dict):
        """Bộ phản ứng: AV thấy vật và đèn của (t − reaction_delay). Trạng thái của chính xe thì không trễ."""
        self._percept.append((t, obs.get("objects", []), obs.get("traffic_lights", [])))
        while len(self._percept) > 1 and self._percept[1][0] <= t - self.reaction_delay + 1e-9:
            self._percept.popleft()
        return self._percept[0][1], self._percept[0][2]

    def _light_obstacles(self, line, ego, lights):
        """Đèn đỏ (hoặc vàng mà vẫn kịp dừng) thành vật cản ảo đứng yên tại vạch dừng."""
        out = []
        v = max(ego["v"], 0.0)
        for tl in lights:
            if tl.get("state") not in ("red", "yellow"):
                continue
            s, d, _ = line.project(tl["x"], tl["y"])
            if not (0 < s < line.length) or abs(d) > 12:
                continue
            gap = s - 3.0 - ego.get("length", 4.5) / 2
            if tl["state"] == "yellow" and v * v / (2 * max(gap, 0.1)) > 3.0:
                continue  # vàng mà không kịp dừng êm thì đi tiếp
            if gap > -1.0:
                out.append((max(gap, 0.0), 0.0, tl.get("id"), "stop_line"))
        return out

    def step(self, obs: dict) -> dict:
        if self.planner is None:
            raise RuntimeError("Gọi reset(lanes) trước")
        t = obs["t"]
        dt = 0.05 if self.last_t is None else max(t - self.last_t, 1e-3)
        self.last_t = t
        ego = obs["ego"]
        v_limit = obs.get("speed_limit", 50 / 3.6) * self.speed_factor
        objects, lights = self._delayed(t, obs)
        path = self.planner.plan(t, ego, objects, v_limit)
        v_curve = math.sqrt(self.a_lat_max / max(path.kappa_max, 1e-4))
        v_des = min(v_limit, v_curve)
        leads = path.leads + self._light_obstacles(path.line, ego, lights)
        lead = min(leads, key=lambda r: r[0]) if leads else None
        steer, dlat = self.lat.step(ego, path.line, dt)
        accel, dlon = self.lon.step(ego["v"], v_des, lead, dt)
        return {
            "steer": steer,
            "accel": accel,
            "debug": {
                "lane": path.lane_id, "target_lane": path.target_lane_id,
                "v_des": v_des, "lead": None if lead is None else
                {"gap": lead[0], "v": lead[1], "id": lead[2], "kind": lead[3]},
                "path": path.xy[::5].round(2).tolist(),
                **dlat, **dlon,
            },
        }
