"""Mô hình xe đạp động học (kinematic bicycle), điểm tham chiếu ở tâm xe.

    β    = atan(lr / L * tan δ)
    ẋ    = v cos(ψ + β),  ẏ = v sin(ψ + β)
    ψ̇    = v / lr * sin β
    v̇    = a  (actuator có độ trễ bậc 1, hằng số thời gian tau)
Trong Unity, phần này được thay bằng WheelCollider hoặc NWH, tức là vật lý thật.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class VehicleParams:
    length: float = 4.5
    width: float = 1.8
    wheelbase: float = 2.7
    max_steer: float = 0.6
    tau_accel: float = 0.25
    a_min: float = -8.0
    a_max: float = 3.0
    v_max: float = 40.0


class KinematicBicycle:
    def __init__(self, x, y, yaw, v, p: VehicleParams | None = None):
        self.p = p or VehicleParams()
        self.x, self.y, self.yaw, self.v = float(x), float(y), float(yaw), float(v)
        self.a = 0.0
        self.steer = 0.0
        self.yaw_rate = 0.0

    def step(self, steer_cmd: float, accel_cmd: float, dt: float):
        p = self.p
        self.steer = max(-p.max_steer, min(p.max_steer, steer_cmd))
        a_cmd = max(p.a_min, min(p.a_max, accel_cmd))
        self.a += (a_cmd - self.a) * min(1.0, dt / p.tau_accel)
        lr = p.wheelbase / 2
        beta = math.atan(lr / p.wheelbase * math.tan(self.steer))
        self.x += self.v * math.cos(self.yaw + beta) * dt
        self.y += self.v * math.sin(self.yaw + beta) * dt
        self.yaw_rate = self.v / lr * math.sin(beta)
        self.yaw += self.yaw_rate * dt
        v_new = self.v + self.a * dt
        if v_new < 0:  # không cho chạy lùi, xe dừng hẳn
            v_new, self.a = 0.0, 0.0
        self.v = min(v_new, p.v_max)

    def state(self) -> dict:
        return {"id": "ego", "x": self.x, "y": self.y, "yaw": self.yaw, "v": self.v,
                "length": self.p.length, "width": self.p.width}
