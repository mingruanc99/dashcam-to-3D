"""Ghép frame JPG do Unity quay (Editor/AdasRecord.cs) thành mp4.

    python -m demo.encode_frames ../Unity/Logs/rec --out "../demo videos/unity"
"""

from __future__ import annotations

import argparse
import glob
import os

import av
import cv2


def encode(frames: list[str], out: str, fps: int = 30, crf: int = 17) -> None:
    c = av.open(out, mode="w")
    s = None
    for f in frames:
        img = cv2.imread(f)
        if s is None:
            s = c.add_stream("libx264", rate=fps)
            s.width, s.height = img.shape[1] // 2 * 2, img.shape[0] // 2 * 2
            s.pix_fmt = "yuv420p"
            s.options = {"crf": str(crf), "preset": "medium"}
        img = img[: s.height, : s.width]
        for p in s.encode(av.VideoFrame.from_ndarray(img, format="bgr24")):
            c.mux(p)
    if s is not None:
        for p in s.encode():
            c.mux(p)
    c.close()


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("rec_dir")
    ap.add_argument("--out", default="../demo videos/unity")
    ap.add_argument("--fps", type=int, default=30)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    for d in sorted(glob.glob(os.path.join(a.rec_dir, "*"))):
        frames = sorted(glob.glob(os.path.join(d, "*.jpg")))
        if not frames:
            continue
        out = os.path.join(a.out, os.path.basename(d) + ".mp4")
        encode(frames, out, a.fps)
        print(f"{len(frames)} frame -> {out}", flush=True)


if __name__ == "__main__":
    main()
