"""Bước 8 + 10: dựng map đơn giản và ghi scenario JSON (có validate schema).

Map v1 được sinh từ chính quỹ đạo ego: làn của ego là đường ego đã đi, các làn
bên cạnh là bản dịch song song ±lane_width. PDF mục 5.2.1 làm y như vậy
("录制轨迹 + 坐标偏移生成多条平行全局路径"). Sau này thay bằng lane detection
hoặc OSM thì chỉ cần sửa hàm build_lanes.
"""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
from jsonschema import Draft202012Validator

from .config import SCHEMA_VERSION

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_PATH = os.path.join(ROOT, "scenarios", "schema", "scenario.schema.json")


def build_lanes(ego: pd.DataFrame, lane_width: float = 3.5, n_left: int = 1,
                n_right: int = 1, spacing: float = 2.0, extend: float = 60.0) -> list[dict]:
    xy = ego[["x", "y"]].values
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(xy, axis=0).T))]
    if seg[-1] < spacing:  # ego đứng yên: tạo làn thẳng theo hướng ban đầu
        yaw0 = float(ego["yaw"].iloc[0])
        xy = xy[:1] + np.outer([0, 1], [np.cos(yaw0), np.sin(yaw0)]) * spacing
        seg = np.array([0, spacing])
    s = np.arange(0, seg[-1] + 1e-6, spacing)
    c = np.stack([np.interp(s, seg, xy[:, 0]), np.interp(s, seg, xy[:, 1])], 1)
    # Kéo dài thẳng ra phía trước để AV còn đường khi chạy nhanh hơn log
    d_end = c[-1] - c[-2]
    d_end /= np.linalg.norm(d_end)
    ext = c[-1] + np.outer(np.arange(spacing, extend + 1e-6, spacing), d_end)
    c = np.vstack([c, ext])
    tang = np.gradient(c, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True)
    normal = np.stack([-tang[:, 1], tang[:, 0]], 1)  # vector pháp tuyến hướng sang trái

    offsets = list(range(n_left, -n_right - 1, -1))  # trái -> phải
    ids = {k: ("l_ego" if k == 0 else (f"l_L{k}" if k > 0 else f"l_R{-k}")) for k in offsets}
    lanes = []
    for k in offsets:
        cl = c + normal * (k * lane_width)
        lanes.append({
            "id": ids[k],
            "centerline": np.round(cl, 3).tolist(),
            "width": lane_width,
            "left": ids.get(k + 1),
            "right": ids.get(k - 1),
        })
    return lanes


def infer_lane_counts(agents: list[dict], ego: pd.DataFrame, lane_width: float = 3.5,
                      v_min: float = 2.0, q: float = 80, max_lanes: int = 3) -> tuple[int, int]:
    """Số làn mỗi bên = số làn đủ để chứa q% vị trí ngang của các XE ĐANG CHẠY (BUG_LOG B26).

    d = độ lệch ngang so với quỹ đạo ego (dương = bên trái). Người đi bộ và xe đứng yên bị loại,
    vì họ thường ở trên vỉa hè. n = ceil((P_q(|d|) − w/2) / w), giới hạn trong [1, max_lanes].
    """
    from common.geometry import Polyline
    line = Polyline(ego[["x", "y"]].values) if len(ego) > 1 else None
    left, right = [], []
    for a in agents:
        if a["class"] in ("pedestrian", "obstacle"):
            continue
        for p in a["trajectory"][::3]:
            if p["v"] < v_min or line is None:
                continue
            _, d, _ = line.project(p["x"], p["y"])
            (left if d > 0 else right).append(abs(d))
    def n(vals):
        if len(vals) < 10:
            return 1
        return int(np.clip(np.ceil((np.percentile(vals, q) - lane_width / 2) / lane_width), 1, max_lanes))
    return n(left), n(right)


def infer_lane_directions(lanes: list[dict], agents: list[dict], min_votes: int = 2,
                          v_min: float = 2.0) -> None:
    """Gán lane["direction"] = +1 (cùng chiều ego) hoặc −1 (ngược chiều), theo số đông agent đang chạy trong làn đó.

    Map v1 sinh từ quỹ đạo ego nên không biết làn nào ngược chiều. Ở Việt Nam đường 2 chiều không dải
    phân cách rất phổ biến, và nếu planner đổi sang làn ngược chiều thì rất nguy hiểm (BUG_LOG B19).
    Phiếu của mỗi agent = dấu của cos(yaw_agent − hướng làn), chỉ tính khi v > v_min.
    Làn ego luôn là +1. Không đủ phiếu thì giữ +1.
    """
    from common.geometry import Polyline
    lines = {l["id"]: Polyline(l["centerline"]) for l in lanes}
    votes = {l["id"]: [] for l in lanes}
    for a in agents:
        for p in a["trajectory"][::5]:
            if p["v"] < v_min:
                continue
            best = min(lanes, key=lambda l: abs(lines[l["id"]].project(p["x"], p["y"])[1]))
            s_, d, _ = lines[best["id"]].project(p["x"], p["y"])
            if abs(d) > best["width"] / 2:
                continue
            _, yaw = lines[best["id"]].point(s_)
            votes[best["id"]].append(np.sign(np.cos(p["yaw"] - yaw[0])))
    for l in lanes:
        v = votes[l["id"]]
        l["direction"] = -1 if (l["id"] != "l_ego" and len(v) >= min_votes and np.sum(v) < 0) else 1
    # Luật giao thông bên phải (Việt Nam): làn ngược chiều chỉ nằm bên TRÁI ego, và đã ngược chiều thì
    # mọi làn xa hơn về bên trái cũng ngược chiều. Làn bên phải luôn cùng chiều. Phiếu lẻ do lift 3D sai bị bỏ qua.
    by_id = {l["id"]: l for l in lanes}
    cur, opposite = by_id.get("l_ego", {}).get("left"), False
    while cur:
        opposite = opposite or by_id[cur]["direction"] < 0
        by_id[cur]["direction"] = -1 if opposite else 1
        cur = by_id[cur].get("left")
    cur = by_id.get("l_ego", {}).get("right")
    while cur:
        by_id[cur]["direction"] = 1
        cur = by_id[cur].get("right")


def validate(scenario: dict) -> list[str]:
    with open(SCHEMA_PATH, encoding="utf-8") as f:
        schema = json.load(f)
    v = Draft202012Validator(schema)
    return [f"{'/'.join(map(str, e.path))}: {e.message}" for e in v.iter_errors(scenario)]


def build_scenario(source: str, ego: pd.DataFrame, agents: list[dict], lights: list[dict],
                   lanes: list[dict], fps: float, origin_gps=None, video_start: float = 0.0,
                   camera: dict | None = None, ego_size=(4.5, 1.8, 1.5),
                   speed_limit: float = 50 / 3.6) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "meta": {
            "source": source,
            "frame": "enu" if origin_gps else "ego_t0",
            "origin_gps": list(origin_gps) if origin_gps else None,
            "fps": fps,
            "duration": round(float(ego["t"].iloc[-1] - ego["t"].iloc[0]), 3),
            "video_start": video_start,
            "speed_limit": speed_limit,
            "camera": camera or {},
        },
        "map": {"lanes": lanes, "road_edges": [], "signs": []},
        "ego": {
            "size": list(ego_size),
            "trajectory": [
                {"t": round(float(r.t), 3), "x": round(float(r.x), 3), "y": round(float(r.y), 3),
                 "yaw": round(float(r.yaw), 4), "v": round(float(r.v), 3)}
                for r in ego.itertuples()
            ],
        },
        "agents": agents,
        "traffic_lights": lights,
        "events": [],
    }


def save(scenario: dict, path: str, check: bool = True) -> None:
    if check:
        errs = validate(scenario)
        if errs:
            raise ValueError("Scenario không hợp lệ:\n  " + "\n  ".join(errs[:20]))
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(scenario, f, ensure_ascii=False, separators=(",", ":"))


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)
