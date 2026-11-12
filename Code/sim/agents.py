"""Agent Brain (PLAN.md mục 5 và 6): log_replay ↔ reactive (IDM).

- log_replay: phát lại đúng quỹ đạo đã đo từ video, nội suy theo thời gian.
- reactive: vẫn đi trên đường cũ của log (đã kéo dài thêm phía cuối), nhưng tốc
  độ do IDM quyết định nên biết phanh khi gặp xe phía trước, kể cả ego.
  Đã chuyển sang reactive thì không quay lại log, để tránh agent bị teleport.

IDM (Intelligent Driver Model):
    a = a_max * [1 - (v / v0)^4 - (s* / s)^2]
    s* = s0 + v T + v Δv / (2 sqrt(a_max b))
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from common.geometry import Polyline, box_corners


@dataclass
class IDMParams:
    a_max: float = 1.5
    b: float = 2.5
    T: float = 1.3
    s0: float = 2.0
    delta: float = 4.0
    b_max: float = 7.0


def idm_accel(v, v0, gap, v_lead, p: IDMParams) -> float:
    free = 1 - (max(v, 0) / max(v0, 0.5)) ** p.delta
    if gap is None:
        return p.a_max * free
    s_star = p.s0 + max(0.0, v * p.T + v * (v - v_lead) / (2 * math.sqrt(p.a_max * p.b)))
    a = p.a_max * (free - (s_star / max(gap, 0.1)) ** 2)
    return max(a, -p.b_max)


class Agent:
    def __init__(self, spec: dict, idm: IDMParams | None = None):
        self.spec = spec
        self.id = spec["id"]
        self.cls = spec["class"]
        self.L, self.W = spec["size"][0], spec["size"][1]
        tr = spec["trajectory"]
        self.t = np.array([p["t"] for p in tr])
        self.x = np.array([p["x"] for p in tr])
        self.y = np.array([p["y"] for p in tr])
        self.yaw = np.unwrap(np.array([p["yaw"] for p in tr]))
        self.v = np.array([p["v"] for p in tr])
        b = spec.get("behavior", {})
        self.mode = b.get("mode", "log_replay")
        self.can_react = b.get("reactive_fallback", "idm") == "idm"
        self.idm = idm or IDMParams()
        self.v0 = max(float(np.percentile(self.v, 80)), 1.0 if self.cls == "pedestrian" else 3.0)
        self.path = self._build_path()
        self.s = 0.0
        self.cur_v = float(self.v[0])
        self.state = None
        self.removed = False
        self.switch_reason = None
        if self.mode == "reactive":
            self.s = 0.0
            self.state = self._path_state(self.s, self.cur_v)

    def _build_path(self) -> Polyline:
        pts = np.stack([self.x, self.y], 1)
        keep = [0]
        for i in range(1, len(pts)):
            if np.hypot(*(pts[i] - pts[keep[-1]])) > 0.5:
                keep.append(i)
        pts = pts[keep]
        yaw_end = self.yaw[-1]
        if len(pts) < 2:
            pts = np.vstack([pts[:1], pts[:1] + [math.cos(yaw_end) * 0.5, math.sin(yaw_end) * 0.5]])
        d = pts[-1] - pts[-2]
        d /= np.linalg.norm(d)
        ext = pts[-1] + np.outer(np.arange(2.0, 200.0, 2.0), d)
        return Polyline(np.vstack([pts, ext]))

    def _path_state(self, s, v):
        (px, py), = self.path.point(s)[0]
        _, yaw = self.path.point(s)
        return {"x": float(px), "y": float(py), "yaw": float(yaw[0]), "v": float(v)}

    # ---------------------------------------------------------------- log
    def log_state(self, t: float):
        if t < self.t[0] - 1e-6 or t > self.t[-1] + 1e-6:
            return None
        return {"x": float(np.interp(t, self.t, self.x)), "y": float(np.interp(t, self.t, self.y)),
                "yaw": float(np.interp(t, self.t, self.yaw)), "v": float(np.interp(t, self.t, self.v))}

    # ---------------------------------------------------------------- vòng đời
    def to_reactive(self, reason: str):
        if self.mode == "reactive" or not self.can_react or self.state is None:
            return False
        self.mode = "reactive"
        self.switch_reason = reason
        self.s, _, _ = self.path.project(self.state["x"], self.state["y"])
        self.cur_v = self.state["v"]
        return True

    def update(self, t: float, dt: float, accel: float | None = None):
        if self.removed:
            return
        if self.mode == "log_replay":
            self.state = self.log_state(t)
            return
        self.cur_v = max(0.0, self.cur_v + (accel or 0.0) * dt)
        self.s += self.cur_v * dt
        if self.s >= self.path.length:
            self.removed, self.state = True, None
            return
        self.state = self._path_state(self.s, self.cur_v)

    @property
    def active(self) -> bool:
        return self.state is not None and not self.removed

    def corners(self):
        st = self.state
        return box_corners(st["x"], st["y"], st["yaw"], self.L, self.W)

    def as_object(self) -> dict:
        st = self.state
        return {"id": self.id, "class": self.cls, "x": st["x"], "y": st["y"], "yaw": st["yaw"],
                "v": st["v"], "length": self.L, "width": self.W}

    # ---------------------------------------------------------------- IDM
    def leader_on_path(self, others: list[dict], horizon: float = 80.0):
        """Tìm vật gần nhất ở phía trước trên đường đi của agent. Trả về (gap, v_dọc, obj) hoặc None."""
        if not self.active:
            return None
        s_self, _, _ = self.path.project(self.state["x"], self.state["y"])
        best = None
        for o in others:
            s, d, _ = self.path.project(o["x"], o["y"])
            ds = s - s_self
            if not (0 < ds < horizon) or abs(d) > (self.W + o["width"]) / 2 + 0.2:
                continue
            _, yaw = self.path.point(s)
            gap = ds - (self.L + o["length"]) / 2
            v_along = o["v"] * math.cos(o["yaw"] - yaw[0])
            if best is None or gap < best[0]:
                best = (gap, v_along, o)
        return best

    def idm_accel(self, others: list[dict]) -> float:
        lead = self.leader_on_path(others)
        if lead is None:
            return idm_accel(self.cur_v, self.v0, None, 0.0, self.idm)
        return idm_accel(self.cur_v, self.v0, lead[0], lead[1], self.idm)
