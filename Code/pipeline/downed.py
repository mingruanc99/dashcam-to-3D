"""Nhận diện người/xe đã ngã trên đường (BUG_LOG B35).

YOLO COCO được huấn luyện chủ yếu với người đứng và xe dựng, nên người và xe đang nằm thường chỉ bị bắt khi
ego tới rất gần. Ở clip02, người và xe máy đã nằm từ trước t = 9.5 s nhưng track người chỉ bắt đầu lúc 12.8 s,
và xe máy nằm thì không có track nào. Vì vậy trong sim "tự nhiên có người hiện ra".

Luật: người gần như đứng yên (v trung vị < 1 m/s), box bè ngang (cao/rộng < ngưỡng), nằm trong lòng đường
  -> gán posture = "down"
  -> kéo dài quỹ đạo về trước: vật đứng yên thì trước lúc detect được nó vẫn ở đó
  -> thêm một xe máy nằm cạnh, đánh dấu inferred = true (SUY RA, không phải đo được).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .config import MAX_AGENT_RANGE


def mark_downed(agents: list[dict], lifted: pd.DataFrame, ego: pd.DataFrame, road_half: float,
                v_max: float = 1.0, aspect_max: float = 1.3, min_obs: int = 10) -> list[dict]:
    """Sửa agents tại chỗ, trả về danh sách id đã đánh dấu."""
    out, extra = [], []
    for a in agents:
        if a["class"] != "pedestrian":
            continue
        g = lifted[lifted["track_id"] == a["id"]]
        tr = a["trajectory"]
        if len(g) < min_obs or np.median([p["v"] for p in tr]) >= v_max:
            continue
        aspect = float(np.median((g["y2"] - g["y1"]) / np.maximum(g["x2"] - g["x1"], 1.0)))
        x, y = float(np.median([p["x"] for p in tr])), float(np.median([p["y"] for p in tr]))
        d = np.hypot(ego["x"].values - x, ego["y"].values - y)
        nearest = int(np.argmin(d))
        lateral = abs(-np.sin(ego["yaw"].iloc[nearest]) * (x - ego["x"].iloc[nearest])
                      + np.cos(ego["yaw"].iloc[nearest]) * (y - ego["y"].iloc[nearest]))
        if aspect >= aspect_max or lateral > road_half:
            continue
        visible = ego[(d < MAX_AGENT_RANGE) & (ego["t"].values < tr[0]["t"])]
        pose = {"yaw": tr[0]["yaw"], "x": round(x, 3), "y": round(y, 3), "v": 0.0}
        back = [{"t": round(float(t), 3), **pose} for t in visible["t"].values]
        still = back + [{"t": p["t"], **pose} for p in tr]
        a["trajectory"] = still
        a["posture"] = "down"
        a["size"] = [1.6, 0.6, 0.4]
        extra.append({
            "id": f"{a['id']}_bike", "class": "motorbike", "variant": 0, "size": [1.9, 0.9, 0.5],
            "trajectory": [{**p, "x": round(p["x"] + 1.3, 3)} for p in still],
            "confidence": 0.0, "posture": "down", "inferred": True,
            "behavior": {"mode": "log_replay", "reactive_fallback": "none"},
        })
        out.append(a["id"])
    agents.extend(extra)
    return out
