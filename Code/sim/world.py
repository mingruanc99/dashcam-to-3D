"""Vòng lặp mô phỏng closed-loop, chạy lockstep nên deterministic (PLAN.md mục 6, 7).

Các mode:
  M1 open-loop       : ego và agent đều chạy theo log. AV vẫn chạy song song để so
                       lệnh của AV với người lái thật, nhưng lệnh không được áp vào xe.
  M2 closed-loop     : AV lái ego, agent chạy theo log.
  M3 reactive        : như M2, nhưng agent chuyển sang IDM khi thỏa luật ở mục 6.
  M4 augmented       : như M3, cộng thêm scenario["events"] (spawn agent...).
"""

from __future__ import annotations

import math
import time

import numpy as np

from common.geometry import Polyline, box_corners, box_distance, boxes_overlap, wrap

from .agents import Agent
from .director import Director
from .vehicle import KinematicBicycle, VehicleParams

MODES = ("M1", "M2", "M3", "M4")


class EgoLog:
    def __init__(self, traj):
        self.t = np.array([p["t"] for p in traj])
        self.x = np.array([p["x"] for p in traj])
        self.y = np.array([p["y"] for p in traj])
        self.yaw = np.unwrap(np.array([p["yaw"] for p in traj]))
        self.v = np.array([p["v"] for p in traj])
        self.path = Polyline(np.stack([self.x, self.y], 1)) if np.ptp(self.x) + np.ptp(self.y) > 1 else None

    def at(self, t):
        t = min(max(t, self.t[0]), self.t[-1])
        return {"x": float(np.interp(t, self.t, self.x)), "y": float(np.interp(t, self.t, self.y)),
                "yaw": float(np.interp(t, self.t, self.yaw)), "v": float(np.interp(t, self.t, self.v))}


class Simulator:
    def __init__(self, scenario: dict, mode: str = "M3", av=None, dt: float = 0.05,
                 sensor_range: float = 80.0, switch_dist: float = 2.0, switch_ttc: float = 3.0):
        assert mode in MODES, mode
        self.scn = scenario
        self.mode = mode
        self.av = av
        self.dt = dt
        self.sensor_range = sensor_range
        self.switch_dist = switch_dist
        self.switch_ttc = switch_ttc
        self.ego_log = EgoLog(scenario["ego"]["trajectory"])
        L, W, _ = scenario["ego"]["size"]
        s0 = self.ego_log.at(self.ego_log.t[0])
        self.ego = KinematicBicycle(s0["x"], s0["y"], s0["yaw"], s0["v"], VehicleParams(length=L, width=W))
        self.agents = [Agent(a) for a in scenario["agents"]]
        # Vật cản tĩnh hazard (>= 23 cm) -> agent đứng yên, không phản ứng; vật thấp hơn thì xe đi qua được
        t0, t1 = float(self.ego_log.t[0]), float(self.ego_log.t[-1])
        for ob in scenario.get("static_obstacles", []):
            if not ob.get("hazard", True):
                continue
            (x, y), (L, W, H) = ob["pos"], ob["size"]
            st = lambda t: {"t": t, "x": x, "y": y, "yaw": 0.0, "v": 0.0}  # noqa: E731
            self.agents.append(Agent({"id": ob["id"], "class": "obstacle", "size": [L, W, H],
                                      "trajectory": [st(t0), st(t1)],
                                      "behavior": {"mode": "log_replay", "reactive_fallback": "none"}}))
        self.director = Director(scenario.get("npcs", []), scenario["map"]["lanes"])
        self.agents.extend(self.director.agents)
        self.events = sorted(scenario.get("events", []), key=lambda e: e["t"]) if mode == "M4" else []
        self.lanes = scenario["map"]["lanes"]
        self.lane_lines = [(Polyline(l["centerline"]), l["width"]) for l in self.lanes]
        self.lights = scenario.get("traffic_lights", [])
        self.speed_limit = scenario["meta"].get("speed_limit", 50 / 3.6)
        self.t = float(self.ego_log.t[0])
        self.t_end = float(self.ego_log.t[-1])
        self.log: list[dict] = []
        self.incidents: list[dict] = []
        self._collided: set = set()
        self._light_side: dict = {}
        for a in self.agents:
            if a.mode == "log_replay":
                a.update(self.t, dt)
        if self.av is not None:
            self.av.reset(self.lanes)

    # ---------------------------------------------------------------- tiện ích
    def light_state(self, tl, t):
        state = "unknown"
        for ts, st in tl["states"]:
            if ts <= t + 1e-9:
                state = st
        return state

    def observation(self) -> dict:
        ego = self.ego.state()
        objs = []
        for a in self.agents:
            if a.active and math.hypot(a.state["x"] - ego["x"], a.state["y"] - ego["y"]) < self.sensor_range:
                objs.append(a.as_object())
        lights = [{"id": tl["id"], "x": tl["pos"][0], "y": tl["pos"][1], "state": self.light_state(tl, self.t)}
                  for tl in self.lights]
        return {"t": self.t, "ego": ego, "objects": objs, "traffic_lights": lights,
                "speed_limit": self.speed_limit}

    def _maybe_switch(self, a: Agent, ego: dict, ego_log: dict):
        """Luật chuyển log_replay -> reactive (PLAN.md mục 6)."""
        if self.mode not in ("M3", "M4") or a.mode != "log_replay" or not a.active:
            return
        st = a.state
        d_act = math.hypot(st["x"] - ego["x"], st["y"] - ego["y"])
        d_log = math.hypot(st["x"] - ego_log["x"], st["y"] - ego_log["y"])
        if d_act < 30 and d_act < d_log - self.switch_dist:
            a.to_reactive(f"closer_than_log({d_log - d_act:.1f}m)")
            return
        lead = a.leader_on_path([ego])
        if lead is not None:
            gap, v_along, _ = lead
            closing = st["v"] - v_along
            if closing > 0.1 and gap / closing < self.switch_ttc:
                a.to_reactive(f"ttc({gap / closing:.1f}s)")
            elif gap < 30 and ego["v"] < ego_log["v"] - 1.0:
                a.to_reactive("ego_slower_than_log")

    def _check_lights(self, ego):
        if self.ego_log.path is None:
            return
        s_ego, _, _ = self.ego_log.path.project(ego["x"], ego["y"])
        front = s_ego + ego["length"] / 2
        for tl in self.lights:
            s_tl, d_tl, _ = self.ego_log.path.project(tl["pos"][0], tl["pos"][1])
            if abs(d_tl) > 15:
                continue
            side = front < s_tl - 3.0  # vạch dừng ~3 m trước cột đèn
            prev = self._light_side.get(tl["id"])
            if prev is True and side is False and self.light_state(tl, self.t) == "red":
                self.incidents.append({"t": self.t, "type": "red_light", "id": tl["id"]})
            self._light_side[tl["id"]] = side

    # ---------------------------------------------------------------- vòng lặp
    def step(self):
        dt = self.dt
        ego_log = self.ego_log.at(self.t)
        # 1) events (M4)
        while self.events and self.events[0]["t"] <= self.t + 1e-9:
            ev = self.events.pop(0)
            if ev["type"] == "spawn_agent":
                self.agents.append(Agent(ev["agent"]))
            elif ev["type"] == "remove_agent":
                for a in self.agents:
                    if a.id == ev["agent_id"]:
                        a.removed, a.state = True, None
        # 2) agent mới spawn chưa có state -> đặt theo log ở t; rồi xét luật chuyển mode
        for a in self.agents:
            if a.mode == "log_replay" and a.state is None and not a.removed:
                a.update(self.t, dt)
        ego = self.ego.state()
        for a in self.agents:
            before = a.mode
            self._maybe_switch(a, ego, ego_log)
            if a.mode != before:
                self.incidents.append({"t": self.t, "type": "agent_reactive", "id": a.id, "reason": a.switch_reason})
        # 3) AV
        cmd, av_ms = None, 0.0
        if self.av is not None:
            t0 = time.perf_counter()
            cmd = self.av.step(self.observation())
            av_ms = (time.perf_counter() - t0) * 1000
        # 4) ego
        if self.mode == "M1" or cmd is None:
            nxt = self.ego_log.at(self.t + dt)
            a_log = (nxt["v"] - self.ego.v) / dt
            self.ego.x, self.ego.y, self.ego.yaw, self.ego.v = nxt["x"], nxt["y"], nxt["yaw"], nxt["v"]
            self.ego.a, self.ego.yaw_rate = a_log, (nxt["yaw"] - ego["yaw"]) / dt
        else:
            self.ego.step(cmd["steer"], cmd["accel"], dt)
        ego = self.ego.state()
        # 5) agent tiến lên t+dt: theo log, hoặc theo IDM (coi ego cũng là vật cản)
        actors = [ego] + [a.as_object() for a in self.agents if a.active]
        for a in self.agents:
            if a.mode == "log_replay":
                a.update(self.t + dt, dt)
            elif a.mode == "scripted":
                a.step(self.t, dt, ego)
            elif a.active:
                others = [o for o in actors if o.get("id") != a.id]
                a.update(self.t + dt, dt, a.idm_accel(others))
        self.t += dt
        # 6) va chạm và metrics
        ego_box = box_corners(ego["x"], ego["y"], ego["yaw"], ego["length"], ego["width"])
        min_dist = math.inf
        for a in self.agents:
            if not a.active:
                continue
            if math.hypot(a.state["x"] - ego["x"], a.state["y"] - ego["y"]) > 25:
                continue
            ab = a.corners()
            if boxes_overlap(ego_box, ab):
                min_dist = 0.0
                if a.id not in self._collided:
                    self._collided.add(a.id)
                    # Vùng chạm trong hệ ego (giống CollisionLogger bên Unity, docs/UNITY_B12.md):
                    # dùng tâm phần giao nhau gần đúng = trung bình các góc của box này nằm trong box kia.
                    c, s_ = math.cos(ego["yaw"]), math.sin(ego["yaw"])
                    pts = [p for p in ab if abs(c * (p[0] - ego["x"]) + s_ * (p[1] - ego["y"])) <= ego["length"] / 2
                           and abs(-s_ * (p[0] - ego["x"]) + c * (p[1] - ego["y"])) <= ego["width"] / 2]
                    cx, cy = np.mean(pts, axis=0) if pts else (a.state["x"], a.state["y"])
                    xl = c * (cx - ego["x"]) + s_ * (cy - ego["y"])
                    zone = "front" if xl > 0.25 * ego["length"] else ("rear" if xl < -0.25 * ego["length"] else "side")
                    self.incidents.append({"t": self.t, "type": "collision", "id": a.id, "class": a.cls,
                                           "agent_mode": a.mode, "zone": zone,
                                           "ego_v": ego["v"], "agent_v": a.state["v"]})
            else:
                min_dist = min(min_dist, box_distance(ego_box, ab))
        self._check_lights(ego)
        lane_d = min((abs(line.project(ego["x"], ego["y"])[1]) - w / 2 for line, w in self.lane_lines), default=0.0)
        dbg = (cmd or {}).get("debug", {})
        self.log.append({
            "t": self.t, "x": ego["x"], "y": ego["y"], "yaw": ego["yaw"], "v": ego["v"],
            "a": self.ego.a, "yaw_rate": self.ego.yaw_rate, "steer": self.ego.steer,
            "cmd_steer": (cmd or {}).get("steer", np.nan), "cmd_accel": (cmd or {}).get("accel", np.nan),
            "log_x": self.ego_log.at(self.t)["x"], "log_y": self.ego_log.at(self.t)["y"],
            "log_v": self.ego_log.at(self.t)["v"],
            "min_dist": min_dist, "ttc": dbg.get("ttc", math.inf), "lon_mode": dbg.get("mode", ""),
            "lane": dbg.get("lane", ""), "lane_excess": lane_d,
            "n_reactive": sum(a.mode == "reactive" for a in self.agents), "av_ms": av_ms,
        })

    def run(self, verbose: bool = False):
        n = int(round((self.t_end - self.t) / self.dt))
        for i in range(n):
            self.step()
            if verbose and i % int(1 / self.dt) == 0:
                r = self.log[-1]
                print(f"t={r['t']:5.1f} v={r['v']*3.6:5.1f}km/h a={r['a']:5.2f} mode={r['lon_mode']:<8} lane={r['lane']}")
        return self.log, self.incidents
