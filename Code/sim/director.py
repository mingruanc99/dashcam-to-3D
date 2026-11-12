"""NPC theo kịch bản: hành động theo ĐIỀU KIỆN so với ego, không theo giây cứng (BUG_LOG B13, B36).

Kịch bản theo giây chỉ đúng với đúng một tốc độ của ego. Ego đổi hành vi là tình huống trượt mất.
Ở đây NPC chờ điều kiện, ví dụ "khi cách ego 15 m thì tạt đầu", nên ego nào cũng gặp tình huống đó.

Trong scenario: "npcs": [{
    "id": "x", "class": "car", "size": [L, W, H],
    "lane": "l_L1", "s0": 60, "d0": 0, "v0": 12,       # vị trí theo làn tham chiếu (s dọc, d ngang, dương = trái)
    "phases": [{"when": {"gap_lt": 15}, "do": {"lane": "l_ego", "duration": 1.5}},
               {"when": {"t_gt": 6},    "do": {"v": 0, "accel": 8}}]
}]
when (mọi điều kiện đều phải đúng): t_gt, gap_lt, gap_gt, ego_v_gt. gap = s_npc − s_ego trên làn tham chiếu.
do: v + accel (đổi tốc độ dọc, v < 0 là đi ngược chiều), lane hoặc d + duration (chuyển ngang mượt),
    d_rate (đi ngang đều, m/s, dùng cho người băng qua đường hoặc xe cắt ngang), stop_d (dừng đi ngang khi tới d này).
Python giữ logic NPC cho cả sim 2D lẫn Unity (qua bridge), nên hai bên luôn cùng một kịch bản.
"""

from __future__ import annotations

import math

import numpy as np

from common.geometry import Polyline, box_corners


def _smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


class ScriptedAgent:
    mode = "scripted"
    can_react = False
    removed = False
    switch_reason = None

    def __init__(self, spec: dict, lines: dict):
        self.spec = spec
        self.id = spec["id"]
        self.cls = spec["class"]
        self.L, self.W = spec["size"][0], spec["size"][1]
        self.lines = lines
        self.line: Polyline = lines[spec["lane"]]
        self.phases = list(spec.get("phases", []))
        self.reset()

    def reset(self):
        s = self.spec
        self.idx = 0
        self.s, self.d = float(s["s0"]), float(s.get("d0", 0.0))
        self.vs = self.v_target = float(s.get("v0", 0.0))
        self.accel = 0.0
        self.d_rate = 0.0
        self.stop_d = None
        self.d_from = self.d_to = self.d
        self.d_t0, self.d_dur = 0.0, 0.0
        self.yaw_last = None
        self.vd = 0.0
        self.state = None
        self._make_state()

    def _make_state(self):
        (p,), yaw = self.line.to_xy([self.s], [self.d])
        road = float(yaw[0])
        if abs(self.vs) + abs(self.vd) > 0.05:
            self.yaw_last = road + math.atan2(self.vd, self.vs)
        elif self.yaw_last is None:
            self.yaw_last = road
        self.state = {"x": float(p[0]), "y": float(p[1]), "yaw": self.yaw_last, "v": math.hypot(self.vs, self.vd)}

    def _met(self, when: dict, t: float, gap: float, ego_v: float) -> bool:
        checks = {"t_gt": t > when.get("t_gt", -math.inf), "gap_lt": gap < when.get("gap_lt", math.inf),
                  "gap_gt": gap > when.get("gap_gt", -math.inf), "ego_v_gt": ego_v > when.get("ego_v_gt", -math.inf)}
        return all(checks.values())

    def _apply(self, do: dict, t: float):
        if "v" in do:
            self.v_target = float(do["v"])
            self.accel = float(do.get("accel", 3.0))
        if "lane" in do or "d" in do:
            if "lane" in do:
                (p,), _ = self.lines[do["lane"]].to_xy([self.lines[do["lane"]].project(self.state["x"], self.state["y"])[0]], [0.0])
                _, target, _ = self.line.project(float(p[0]), float(p[1]))
            else:
                target = float(do["d"])
            self.d_from, self.d_to = self.d, float(target)
            self.d_t0, self.d_dur = t, max(float(do.get("duration", 2.0)), 0.05)
            self.d_rate = 0.0
        if "d_rate" in do:
            self.d_rate = float(do["d_rate"])
            self.stop_d = do.get("stop_d")
            self.d_dur = 0.0

    def step(self, t: float, dt: float, ego: dict):
        s_e, _, _ = self.line.project(ego["x"], ego["y"])
        gap = self.s - s_e
        while self.idx < len(self.phases) and self._met(self.phases[self.idx].get("when", {}), t, gap, ego["v"]):
            self._apply(self.phases[self.idx].get("do", {}), t)
            self.idx += 1
        dv = self.v_target - self.vs
        self.vs += float(np.clip(dv, -self.accel * dt, self.accel * dt))
        self.s += self.vs * dt
        d_old = self.d
        if self.d_dur > 0:
            self.d = self.d_from + (self.d_to - self.d_from) * _smooth((t + dt - self.d_t0) / self.d_dur)
        elif self.d_rate:
            self.d += self.d_rate * dt
            if self.stop_d is not None and (self.d - self.stop_d) * self.d_rate >= 0:
                self.d, self.d_rate = float(self.stop_d), 0.0
        self.vd = (self.d - d_old) / dt
        self._make_state()

    # giao diện giống sim.agents.Agent
    @property
    def active(self) -> bool:
        return True

    def corners(self):
        st = self.state
        return box_corners(st["x"], st["y"], st["yaw"], self.L, self.W)

    def as_object(self) -> dict:
        st = self.state
        return {"id": self.id, "class": self.cls, "x": st["x"], "y": st["y"], "yaw": st["yaw"],
                "v": st["v"], "length": self.L, "width": self.W}


class Director:
    """Toàn bộ NPC của một scenario. Dùng chung cho sim 2D và bridge."""

    def __init__(self, npcs: list[dict], lanes: list[dict]):
        lines = {l["id"]: Polyline(l["centerline"]) for l in lanes}
        self.agents = [ScriptedAgent(n, lines) for n in (npcs or [])]

    def step(self, t: float, dt: float, ego: dict):
        for a in self.agents:
            a.step(t, dt, ego)

    def states(self) -> list[dict]:
        return [{"id": a.id, **a.state} for a in self.agents]
