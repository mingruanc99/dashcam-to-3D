"""Vật cản tĩnh nhỏ trên đường (đá, gạch, lốp, cọc...) bằng model YOLO26 + SAHI của buildphase.

Luồng xử lý:
  1. SahiDetector (buildphase/sahi_deploy.py) với weight/best.pt (1 lớp obstacle), chạy ~5 fps.
  2. Mỗi box: điểm chạm đất -> mặt đường (pitch theo frame, xem pipeline/horizon.py)
     chiều cao  h = H_cam·(y2 − y1)/(y2 − v_hor)        (công thức buildphase, không cần fy)
     bề rộng    w = (x2 − x1)·X/fx
  3. Đưa sang world bằng pose ego. Vật tĩnh nên các lần thấy nằm cùng một chỗ trong world:
     gom cụm bán kính cluster_r, cụm thấy >= min_hits frame mới giữ (loại detect nhiễu).
  4. hazard = h >= 0.23 m (ngưỡng của buildphase). Sim chỉ tính va chạm với vật hazard,
     vật thấp hơn thì xe đi qua được.
Đầu ra: list dict theo schema scenario["static_obstacles"].
"""

from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

from .camera import Camera
from .ego_motion import interp_pose
from .horizon import object_height, pitch_at, with_pitch
from .video import iter_frames

HAZARD_H = 0.23
DEFAULT_BUILDPHASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "buildphase")


def load_detector(buildphase: str = DEFAULT_BUILDPHASE, weights: str | None = None, sahi: bool = True,
                  conf: float = 0.25, device="0"):
    sys.path.insert(0, os.path.abspath(buildphase))
    from sahi_deploy import SahiConfig, SahiDetector  # noqa: E402  (code của buildphase)
    weights = weights or os.path.join(buildphase, "weight", "best.pt")
    return SahiDetector(weights, SahiConfig(imgsz=1024, conf=conf, use_slices=sahi, device=device, half=False))  # half=True báo deprecated ở ultralytics 8.4 (B17)


def detect(video: str, cam: Camera, ego: pd.DataFrame, horizon_series: pd.DataFrame | None,
           start: float, duration: float, fps: float = 5.0, hood_frac: float = 0.0,
           detector=None, max_range: float = 40.0) -> pd.DataFrame:
    det = detector or load_detector()
    rows = []
    hood_row = cam.img_h * (1 - hood_frac)
    for _, t, img in iter_frames(video, start, duration, fps):
        dets, _ = det.predict(img)
        if not dets:
            continue
        pitch = float(pitch_at(horizon_series, cam, [t])[0])
        cm = with_pitch(cam, pitch)
        ex, ey, eyaw = (float(v) for v in interp_pose(ego, t))
        for d in dets:
            x1, y1, x2, y2 = d.box
            if y2 >= hood_row - 2:
                continue  # chạm capo: đáy box không phải điểm chạm đất
            gp, okv = cm.pixels_to_ground([[(x1 + x2) / 2, y2]])
            gx, gy, ok = float(gp[0, 0]), float(gp[0, 1]), bool(okv[0])
            if not ok or np.hypot(gx, gy) > max_range:
                continue
            h = object_height(d.box, cm.horizon_row, cam.mount_height)
            if h is None:
                continue
            X = float(np.hypot(gx - cam.x_offset, gy))
            w = (x2 - x1) * X / cam.fx
            rows.append({"t": t, "conf": d.conf, "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                         "range": X, "h": h, "w": w,
                         "wx": ex + np.cos(eyaw) * gx - np.sin(eyaw) * gy,
                         "wy": ey + np.sin(eyaw) * gx + np.cos(eyaw) * gy})
    return pd.DataFrame(rows, columns=["t", "conf", "x1", "y1", "x2", "y2", "range", "h", "w", "wx", "wy"])


def cluster(dets: pd.DataFrame, cluster_r: float = 1.0, min_hits: int = 3) -> list[dict]:
    """Gom cụm theo vị trí world (greedy, theo thứ tự conf). Vật tĩnh -> một cụm."""
    if dets.empty:
        return []
    order = dets.sort_values("conf", ascending=False)
    centers, members = [], []
    for r in order.itertuples():
        for i, c in enumerate(centers):
            if np.hypot(r.wx - c[0], r.wy - c[1]) < cluster_r:
                members[i].append(r)
                m = members[i]
                centers[i] = (np.mean([q.wx for q in m]), np.mean([q.wy for q in m]))
                break
        else:
            centers.append((r.wx, r.wy))
            members.append([r])
    out = []
    for k, (c, m) in enumerate(zip(centers, members)):
        if len({q.t for q in m}) < min_hits:
            continue
        # Lấy số đo từ những lần nhìn gần nhất: sai số monocular tăng theo X²
        near = sorted(m, key=lambda q: q.range)[: max(3, len(m) // 2)]
        h = float(np.median([q.h for q in near]))
        w = float(np.clip(np.median([q.w for q in near]), 0.1, 2.0))
        out.append({
            "id": f"ob_{k}",
            "class": "obstacle",
            "pos": [round(float(c[0]), 2), round(float(c[1]), 2)],
            "size": [round(w, 2), round(w, 2), round(h, 2)],
            "hazard": bool(h >= HAZARD_H),
            "confidence": round(float(np.median([q.conf for q in m])), 3),
            "hits": len({q.t for q in m}),
            "first_seen": round(float(min(q.t for q in m)), 2),
        })
    return out
