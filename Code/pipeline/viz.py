"""Debug viewer (PLAN.md mục 3 'Công cụ debug pipeline').

Ghi một video mp4: bên trái là frame gốc có box, ID, khoảng cách và cách ước
lượng; bên phải là ảnh nhìn từ trên xuống (bird's-eye view) gồm ego, agent và
làn đường. Mở video này lên là thấy ngay pipeline sai ở bước nào: box sai do
detection, ID nhảy do tracking, khoảng cách sai do lift 3D, quỹ đạo trôi do ego-motion.
"""

from __future__ import annotations

import av
import cv2
import numpy as np
import pandas as pd

from .ego_motion import interp_pose
from .video import iter_frames

COLORS = {"car": (60, 180, 255), "suv": (60, 180, 255), "truck": (40, 90, 255), "bus": (40, 40, 220),
          "motorbike": (80, 220, 80), "bicycle": (200, 220, 60), "pedestrian": (230, 120, 230),
          "traffic_light": (0, 255, 255)}


def _bev(scn: dict, t: float, size: int = 720, span: float = 70.0) -> np.ndarray:
    img = np.full((size, size, 3), 30, np.uint8)
    ego = pd.DataFrame(scn["ego"]["trajectory"])
    ex, ey, eyaw = (float(a) for a in interp_pose(ego, t))
    c, s = np.cos(-eyaw), np.sin(-eyaw)

    def to_px(x, y):  # world -> hệ ego -> pixel (ego ở dưới, hướng lên trên)
        dx, dy = np.asarray(x) - ex, np.asarray(y) - ey
        fx, ly = c * dx - s * dy, s * dx + c * dy
        k = size / span
        return np.stack([size / 2 - ly * k, size * 0.85 - fx * k], -1).astype(np.int32)

    for r in range(10, int(span), 10):
        cv2.circle(img, (size // 2, int(size * 0.85)), int(r * size / span), (55, 55, 55), 1)
    for lane in scn["map"]["lanes"]:
        cl = np.asarray(lane["centerline"])
        cv2.polylines(img, [to_px(cl[:, 0], cl[:, 1])], False, (90, 90, 90), 1)

    def draw_box(x, y, yaw, L, W, color, label=None):
        cc, ss = np.cos(yaw), np.sin(yaw)
        corners = np.array([[L / 2, W / 2], [L / 2, -W / 2], [-L / 2, -W / 2], [-L / 2, W / 2]])
        wx = x + cc * corners[:, 0] - ss * corners[:, 1]
        wy = y + ss * corners[:, 0] + cc * corners[:, 1]
        pts = to_px(wx, wy)
        cv2.fillPoly(img, [pts], color)
        if label:
            cv2.putText(img, label, tuple(pts[0] + [4, 0]), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

    tr = np.asarray([[p["x"], p["y"]] for p in scn["ego"]["trajectory"]])
    cv2.polylines(img, [to_px(tr[:, 0], tr[:, 1])], False, (200, 200, 200), 1)
    L, W, _ = scn["ego"]["size"]
    draw_box(ex, ey, eyaw, L, W, (255, 255, 255))
    for a in scn["agents"]:
        traj = a["trajectory"]
        if not traj[0]["t"] <= t <= traj[-1]["t"]:
            continue
        df = pd.DataFrame(traj)
        x, y, yaw = (float(v) for v in interp_pose(df, t))
        draw_box(x, y, yaw, a["size"][0], a["size"][1], COLORS.get(a["class"], (200, 200, 200)), str(a["id"]))
    for tl in scn.get("traffic_lights", []):
        state = "unknown"
        for ts, st in tl["states"]:
            if ts <= t:
                state = st
        col = {"red": (0, 0, 255), "yellow": (0, 220, 255), "green": (0, 220, 0)}.get(state, (128, 128, 128))
        cv2.circle(img, tuple(to_px(tl["pos"][0], tl["pos"][1])), 6, col, -1)
    cv2.putText(img, f"t={t:5.1f}s v={np.interp(t, ego.t, ego.v)*3.6:5.1f} km/h", (10, 25),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
    return img


def render_debug(video: str, scn: dict, lifted: pd.DataFrame, out_path: str,
                 start: float = 0.0, duration: float | None = None, fps: float = 10.0,
                 width: int = 1280) -> None:
    by_t = {round(t, 3): g for t, g in lifted.groupby("t")} if len(lifted) else {}
    keys = np.array(sorted(by_t)) if by_t else None
    container = av.open(out_path, mode="w")
    stream = None
    sx = None
    for _, t, img in iter_frames(video, start, duration, fps, width=width):
        if sx is None:
            sx = width / scn["meta"]["camera"].get("image_width", width)
        if keys is not None:
            k = keys[np.argmin(np.abs(keys - t))]
            if abs(k - t) < 0.08:
                for r in by_t[k].itertuples():
                    col = COLORS.get(r.cls, (255, 255, 255))
                    p1 = (int(r.x1 * sx), int(r.y1 * sx))
                    p2 = (int(r.x2 * sx), int(r.y2 * sx))
                    cv2.rectangle(img, p1, p2, col, 2)
                    cv2.putText(img, f"#{r.track_id} {r.range:.0f}m {r.method[0]}", (p1[0], p1[1] - 4),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, col, 2)
        bev = _bev(scn, t, size=img.shape[0])
        frame = np.hstack([img, bev])
        if stream is None:
            stream = container.add_stream("libx264", rate=int(fps))
            stream.width, stream.height = frame.shape[1] // 2 * 2, frame.shape[0] // 2 * 2
            stream.pix_fmt = "yuv420p"
        frame = frame[: stream.height, : stream.width]
        for pkt in stream.encode(av.VideoFrame.from_ndarray(frame, format="bgr24")):
            container.mux(pkt)
    if stream is not None:
        for pkt in stream.encode():
            container.mux(pkt)
    container.close()
