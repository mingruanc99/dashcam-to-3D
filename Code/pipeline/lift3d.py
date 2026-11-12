"""Bước 6-7: box 2D -> vị trí 3D trên mặt đường -> world frame -> quỹ đạo mượt.

Mỗi detection có hai cách ước lượng khoảng cách:
  (a) ground-plane: đáy box -> tia -> cắt mặt đường. Chính xác ở gần, nhưng sai
      khi box bị cắt ở mép ảnh hoặc khi đường dốc.
  (b) size prior: khoảng cách ≈ fy * H_chuẩn / chiều_cao_box_px. Dùng được cả khi
      bị cắt đáy, nhưng sai nếu xe thật cao hoặc thấp hơn kích thước chuẩn.
Mặc định dùng (a), dùng (b) để kiểm chéo. Hai cách lệch nhau nhiều thì giảm
confidence. Đây là cách PLAN.md mục 3 đề xuất thay cho model depth.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from .camera import Camera
from .config import CLASS_SIZES, MAX_AGENT_RANGE, TRAFFIC_LIGHT_HEIGHT
from .ego_motion import interp_pose
from .horizon import pitch_at, with_pitch
from .smoothing import heading_from_velocity, resample, rts_cv


def lift_detections(tracks: pd.DataFrame, cam: Camera, ego: pd.DataFrame,
                    horizon_series: pd.DataFrame | None = None) -> pd.DataFrame:
    """Thêm cột vx, vy (hệ xe), wx, wy (world), range, method, q (chất lượng 0..1).

    horizon_series (từ pipeline.horizon.estimate): pitch riêng cho từng frame thay vì pitch cố định.
    """
    df = tracks[tracks["cls"] != "traffic_light"].copy()
    if df.empty:
        return df.assign(vx=[], vy=[], wx=[], wy=[], range=[], method=[], q=[])
    u = ((df["x1"] + df["x2"]) / 2).values
    v_bot = df["y2"].values
    h_px = np.maximum((df["y2"] - df["y1"]).values, 1.0)
    L = np.array([CLASS_SIZES[c][0] for c in df["cls"]])
    W = np.array([CLASS_SIZES[c][1] for c in df["cls"]])
    Hc = np.array([CLASS_SIZES[c][2] for c in df["cls"]])

    v_mid = ((df["y1"] + df["y2"]) / 2).values
    g = np.zeros((len(df), 2)); ok = np.zeros(len(df), bool); ray = np.zeros((len(df), 3))
    pitches = pitch_at(horizon_series, cam, df["t"].values)
    for pv in np.unique(pitches):  # mỗi frame một pitch
        m = pitches == pv
        cm = with_pitch(cam, float(pv))
        g[m], ok[m] = cm.pixels_to_ground(np.stack([u[m], v_bot[m]], 1))
        ray[m] = cm.pixel_rays(np.stack([u[m], v_mid[m]], 1))
    r_ground = np.hypot(g[:, 0] - cam.x_offset, g[:, 1])

    # Size prior: khoảng cách theo phương ngang dọc theo tia đi qua tâm box
    ray_h = ray[:, :2] / np.linalg.norm(ray[:, :2], axis=1, keepdims=True)
    r_size = cam.fy * Hc / h_px
    p_size = ray_h * r_size[:, None] + [cam.x_offset, 0]

    truncated = (df["y2"].values >= cam.img_h - 3) | (df["x1"].values <= 2) | (df["x2"].values >= cam.img_w - 3)
    use_ground = ok & ~truncated
    p = np.where(use_ground[:, None], g, p_size)
    rng = np.where(use_ground, r_ground, r_size)

    # Đáy box là mặt gần nhất của vật. Lùi thêm nửa chiều dài theo hướng tia để ra tâm vật.
    half = np.where(np.abs(ray_h[:, 1]) > 0.7, W / 2, L / 2)
    p = p + ray_h * half[:, None]

    agree = np.where(use_ground, np.exp(-np.abs(np.log(np.maximum(r_ground, 0.5) / r_size)) * 1.5), 0.5)
    q = df["conf"].values * np.clip(1 - rng / 80.0, 0.05, 1) * np.clip(agree, 0.1, 1)

    ex, ey, eyaw = interp_pose(ego, df["t"].values)
    c, s = np.cos(eyaw), np.sin(eyaw)
    df["vx"], df["vy"] = p[:, 0], p[:, 1]
    df["wx"] = ex + c * p[:, 0] - s * p[:, 1]
    df["wy"] = ey + s * p[:, 0] + c * p[:, 1]
    df["range"] = rng
    df["method"] = np.where(use_ground, "ground", "size")
    df["q"] = q
    return df


def build_agents(lifted: pd.DataFrame, ego: pd.DataFrame, t_grid: np.ndarray,
                 min_obs: int = 5, min_quality: float = 0.15) -> list[dict]:
    """Ghép các detection theo track_id, làm mượt và trả về danh sách agent theo schema."""
    agents = []
    lifted = lifted[lifted["range"] < MAX_AGENT_RANGE]
    for tid, g in lifted.groupby("track_id"):
        g = g.sort_values("t").drop_duplicates("t")
        if len(g) < min_obs or g["q"].median() < min_quality:
            continue
        cls = g["cls"].mode().iloc[0]
        t = g["t"].values
        # Phương sai đo tăng theo khoảng cách: monocular sai nhiều ở xa
        r = g["range"].values
        sigma = 0.3 + 0.04 * r + 0.002 * r**2  # ~1.8 m ở 20 m, ~7 m ở 50 m
        q_acc = 0.5 if cls == "pedestrian" else 3.0
        xs, _ = rts_cv(t, g[["wx", "wy"]].values, sigma**2, q=q_acc)
        tg = t_grid[(t_grid >= t[0] - 1e-6) & (t_grid <= t[-1] + 1e-6)]
        if len(tg) < 2:
            continue
        st = resample(t, xs, tg)
        _, _, eyaw = interp_pose(ego, tg)
        v_min = 0.4 if cls == "pedestrian" else 1.0
        yaw = heading_from_velocity(st[:, 2], st[:, 3], v_min, eyaw)
        size = CLASS_SIZES[cls]
        agents.append({
            "id": int(tid),
            "class": cls,
            "variant": int(tid) % 4,
            "size": list(size),
            "trajectory": [
                {"t": round(float(a), 3), "x": round(float(b), 3), "y": round(float(c_), 3),
                 "yaw": round(float(d), 4), "v": round(float(math.hypot(e, f)), 3)}
                for a, b, c_, d, e, f in zip(tg, st[:, 0], st[:, 1], yaw, st[:, 2], st[:, 3])
            ],
            "confidence": round(float(g["q"].median()), 3),
            "behavior": {"mode": "log_replay", "reactive_fallback": "idm"},
        })
    return agents


def fix_riders_and_duplicates(agents: list[dict], ped_max_speed: float = 3.5,
                              dup_dist: float = 1.5) -> list[dict]:
    """Sửa lỗi ở mức track mà luật lọc người lái theo từng frame bỏ sót.

    1. 'Người đi bộ' có tốc độ trung vị > ped_max_speed (~12.6 km/h) gần như chắc
       chắn là người ngồi trên xe máy bị tách track. Đổi class thành motorbike.
    2. Hai agent đi sát nhau (khoảng cách trung vị < dup_dist) trong thời gian chồng
       lấn thì là cùng một vật. Giữ track dài hơn.
    """
    from .config import CLASS_SIZES

    for a in agents:
        v = np.median([p["v"] for p in a["trajectory"]])
        if a["class"] == "pedestrian" and v > ped_max_speed:
            a["class"] = "motorbike"
            a["size"] = list(CLASS_SIZES["motorbike"])
    agents = sorted(agents, key=lambda a: -len(a["trajectory"]))
    kept = []
    for a in agents:
        ta = {p["t"]: (p["x"], p["y"]) for p in a["trajectory"]}
        dup = False
        for k in kept:
            common = [ta[p["t"]] + (p["x"], p["y"]) for p in k["trajectory"] if p["t"] in ta]
            if len(common) >= 3:
                d = np.median([math.hypot(x1 - x2, y1 - y2) for x1, y1, x2, y2 in common])
                if d < dup_dist:
                    dup = True
                    break
        if not dup:
            kept.append(a)
    return sorted(kept, key=lambda a: a["id"])


def build_traffic_lights(tracks: pd.DataFrame, cam: Camera, ego: pd.DataFrame,
                         min_obs: int = 5, min_state_dur: float = 0.5) -> list[dict]:
    """Ghép trạng thái đèn theo thời gian và ước lượng vị trí bằng size prior."""
    lights = []
    tl = tracks[tracks["cls"] == "traffic_light"]
    for tid, g in tl.groupby("track_id"):
        g = g.sort_values("t")
        if len(g) < min_obs:
            continue
        h_px = np.maximum((g["y2"] - g["y1"]).values, 1.0)
        r = cam.fy * TRAFFIC_LIGHT_HEIGHT / h_px
        ray = cam.pixel_rays(np.stack([((g["x1"] + g["x2"]) / 2).values, ((g["y1"] + g["y2"]) / 2).values], 1))
        ray /= np.linalg.norm(ray[:, :2], axis=1, keepdims=True)
        pv = ray * r[:, None]
        ex, ey, eyaw = interp_pose(ego, g["t"].values)
        wx = ex + np.cos(eyaw) * (pv[:, 0] + cam.x_offset) - np.sin(eyaw) * pv[:, 1]
        wy = ey + np.sin(eyaw) * (pv[:, 0] + cam.x_offset) + np.cos(eyaw) * pv[:, 1]
        z = cam.mount_height + pv[:, 2]
        near = r < 50
        if not near.any():
            continue
        # Đổi trạng thái chỉ khi trạng thái mới giữ được >= min_state_dur (lọc nhấp nháy)
        states = []
        cur, cur_t = None, None
        cand, cand_t = None, None
        for t, s in zip(g["t"].values, g["light_state"].values):
            if s in (None, "unknown"):
                continue
            if s == cur:
                cand = None
                continue
            if s != cand:
                cand, cand_t = s, t
            if cur is None or t - cand_t >= min_state_dur:
                cur, cur_t = cand, cand_t
                states.append([round(float(cur_t), 2), cur])
                cand = None
        if not states:
            continue
        lights.append({
            "id": f"tl_{tid}",
            "pos": [round(float(np.median(wx[near])), 2), round(float(np.median(wy[near])), 2),
                    round(float(np.median(z[near])), 2)],
            "states": states,
        })
    return lights
