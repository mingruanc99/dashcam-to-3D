"""Bước 2-3 (+9): YOLO detect, ByteTrack gán ID, phân loại màu đèn giao thông.

PDF dùng YOLOv5 + DeepSORT (mục 4.3.2). Ở đây dùng YOLO11 + ByteTrack có sẵn
trong Ultralytics. Nguyên lý vẫn vậy: Kalman dự đoán box, so khớp (Hungarian/IoU)
với detection, track mới để ở trạng thái "unconfirmed" cho tới khi được xác nhận,
track mất dấu quá max_age thì xóa.
"""

from __future__ import annotations

import json
import os

import cv2
import numpy as np
import pandas as pd

from .config import COCO_TO_CLASS, COCO_TRAFFIC_LIGHT, TWO_WHEELERS
from .video import iter_frames, probe


def _iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def suppress_riders(dets: list[dict]) -> list[dict]:
    """Bỏ box 'người' đang ngồi trên xe máy/xe đạp.

    Ở Việt Nam việc này rất quan trọng: không lọc thì mỗi xe máy sẽ thành 2 agent.
    """
    bikes = [d for d in dets if d["cls"] in TWO_WHEELERS]
    out = []
    for d in dets:
        if d["cls"] == "pedestrian":
            b = d["box"]
            cx = (b[0] + b[2]) / 2
            if any(bk["box"][0] <= cx <= bk["box"][2] and b[3] <= bk["box"][3] + 0.1 * (bk["box"][3] - bk["box"][1])
                   and _iou(b, bk["box"]) > 0.1 for bk in bikes):
                continue
        out.append(d)
    return out


def classify_light(crop: np.ndarray) -> str:
    """Phân loại màu đèn bằng ngưỡng HSV. Không dùng model, kết quả luôn như nhau."""
    if crop.size == 0:
        return "unknown"
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    lit = (s > 90) & (v > 130)
    counts = {
        "red": int(np.sum(lit & ((h < 10) | (h > 165)))),
        "yellow": int(np.sum(lit & (h >= 12) & (h <= 35))),
        "green": int(np.sum(lit & (h >= 40) & (h <= 95))),
    }
    best = max(counts, key=counts.get)
    return best if counts[best] >= max(4, 0.02 * h.size) else "unknown"


def run(video: str, out_dir: str, start: float = 0.0, duration: float | None = None,
        fps: float = 15.0, model: str = "yolo26x.pt", conf: float = 0.25,
        imgsz: int = 1280, device=None, tracker: str = "bytetrack.yaml") -> pd.DataFrame:
    """Ghi out_dir/tracks.parquet và out_dir/video_meta.json."""
    from ultralytics import YOLO

    os.makedirs(out_dir, exist_ok=True)
    info = probe(video)
    yolo = YOLO(model)
    classes = sorted(COCO_TO_CLASS) + [COCO_TRAFFIC_LIGHT]
    rows = []
    for fi, t, img in iter_frames(video, start, duration, fps):
        res = yolo.track(img, persist=True, tracker=tracker, conf=conf, imgsz=imgsz,
                         classes=classes, verbose=False, device=device)[0]
        b = res.boxes
        if b is None or len(b) == 0:
            continue
        xyxy = b.xyxy.cpu().numpy()
        cls = b.cls.cpu().numpy().astype(int)
        scores = b.conf.cpu().numpy()
        ids = b.id.cpu().numpy().astype(int) if b.id is not None else np.full(len(cls), -1)
        dets = []
        for box, c, s, tid in zip(xyxy, cls, scores, ids):
            if tid < 0:
                continue  # chưa được tracker xác nhận
            name = "traffic_light" if c == COCO_TRAFFIC_LIGHT else COCO_TO_CLASS[c]
            dets.append({"box": box.tolist(), "cls": name, "conf": float(s), "id": int(tid)})
        for d in suppress_riders(dets):
            x1, y1, x2, y2 = d["box"]
            state = None
            if d["cls"] == "traffic_light":
                state = classify_light(img[int(y1):int(y2), int(x1):int(x2)])
            rows.append({"frame": fi, "t": t, "track_id": d["id"], "cls": d["cls"],
                         "conf": d["conf"], "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                         "light_state": state})
        if fi % 50 == 0:
            print(f"[detect] t={t:6.1f}s  {len(dets)} objects")
    df = pd.DataFrame(rows, columns=["frame", "t", "track_id", "cls", "conf",
                                     "x1", "y1", "x2", "y2", "light_state"])
    df.to_parquet(os.path.join(out_dir, "tracks.parquet"), index=False)
    meta = {"video": os.path.basename(video), "start": start, "duration": duration,
            "detect_fps": fps, "model": model, "width": info["width"],
            "height": info["height"], "src_fps": info["fps"]}
    with open(os.path.join(out_dir, "video_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    return df
