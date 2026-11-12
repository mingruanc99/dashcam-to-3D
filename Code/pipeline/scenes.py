"""Tách video tổng hợp thành từng clip bằng cách phát hiện điểm cắt cảnh.

Video kiểu "Camera Giao thông" ghép nhiều clip từ nhiều xe và nhiều camera khác
nhau. Mỗi clip cần calib riêng, nên phải chạy pipeline cho TỪNG clip, không được
chạy cho cả file.

    python -m pipeline.scenes --video 1104.mp4 --out work/scenes
-> work/scenes/scenes.csv (clip, start, end, duration, brightness) và một ảnh
   thumbnail cho mỗi clip, xem để chọn clip phù hợp MVP (ban ngày, đường thẳng, >= 15 s).

Cách phát hiện: so sánh histogram HSV của hai frame liên tiếp (lấy mẫu 10 fps).
Hai frame khác nhau đột ngột thì coi là cắt cảnh.
"""

from __future__ import annotations

import argparse
import os

import cv2
import numpy as np
import pandas as pd

from .video import iter_frames


def _hist(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1, 2], None, [16, 8, 8], [0, 180, 0, 256, 0, 256])
    return cv2.normalize(h, h).flatten()


def detect_cuts(video: str, fps: float = 10.0, threshold: float = 0.45, min_len: float = 2.0):
    """Trả về DataFrame các clip (start, end, duration, brightness) và thumbnail giữa clip."""
    cuts = [0.0]
    prev = None
    last_t = 0.0
    bright = []
    for _, t, img in iter_frames(video, fps=fps, width=320):
        h = _hist(img)
        bright.append((t, float(img.mean())))
        if prev is not None:
            d = cv2.compareHist(prev, h, cv2.HISTCMP_BHATTACHARYYA)
            if d > threshold and t - cuts[-1] >= min_len:
                cuts.append(t)
        prev = h
        last_t = t
    cuts.append(last_t)
    b = pd.DataFrame(bright, columns=["t", "b"])
    rows = []
    for i in range(len(cuts) - 1):
        s, e = cuts[i], cuts[i + 1]
        rows.append({"clip": i, "start": round(s, 2), "end": round(e, 2), "duration": round(e - s, 2),
                     "brightness": round(float(b[(b.t >= s) & (b.t < e)].b.mean()), 1)})
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", default="work/scenes")
    ap.add_argument("--threshold", type=float, default=0.45)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    df = detect_cuts(a.video, threshold=a.threshold)
    df.to_csv(os.path.join(a.out, "scenes.csv"), index=False)
    thumbs = []
    for r in df.itertuples():
        _, _, img = next(iter_frames(a.video, start=r.start + r.duration / 2, duration=1.0, width=480))
        cv2.putText(img, f"#{r.clip} {r.start:.0f}-{r.end:.0f}s", (8, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
        cv2.imwrite(os.path.join(a.out, f"clip_{r.clip:03d}.jpg"), img)
        thumbs.append(img)
    # Ảnh tổng hợp 6 cột để xem nhanh
    if thumbs:
        h, w = thumbs[0].shape[:2]
        thumbs = [cv2.resize(t, (w, h)) for t in thumbs]
        cols = 6
        while len(thumbs) % cols:
            thumbs.append(np.zeros_like(thumbs[0]))
        grid = np.vstack([np.hstack(thumbs[i:i + cols]) for i in range(0, len(thumbs), cols)])
        cv2.imwrite(os.path.join(a.out, "overview.jpg"), grid)
    print(df.to_string(index=False))
    print(f"{len(df)} clip -> {a.out}")


if __name__ == "__main__":
    main()
