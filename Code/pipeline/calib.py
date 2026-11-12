"""Bước 0: calib camera.

Cách 1 (chuẩn, PDF mục 4.4.1 và khóa 多传感器融合 chương 6): quay một video bàn cờ
(checkerboard) bằng chính dashcam, đưa bàn cờ đi khắp khung hình, nghiêng nhiều góc.
    python -m pipeline.calib checker --video calib.mp4 --cols 9 --rows 6 --square 0.026 \
        --out data/calib/cam01.yaml [--fisheye]

Cách 2 (nhanh, khi chưa có bàn cờ): khai báo FOV ngang và hàng pixel của đường
chân trời (lấy một frame đường thẳng, kéo dài hai vạch làn xem chúng cắt nhau ở
hàng nào).
    python -m pipeline.calib approx --video 1104.mp4 --fov 120 --horizon-row 520 \
        --mount-height 1.35 --out data/calib/cam01.yaml

Lệnh `frame` xuất một frame ảnh có kẻ lưới hàng để tìm horizon_row:
    python -m pipeline.calib frame --video 1104.mp4 --t 60 --out data/calib/frame.jpg

Cách 3 (sửa tiêu cự bằng tốc độ thật): với camera đơn, khi sai tiêu cự thì mọi thứ
TRONG MỘT FRAME vẫn khớp nhau (bề rộng làn, kích thước xe), chỉ có khoảng cách
dọc bị co giãn theo hệ số k. Ghép VO với tốc độ GPS/overlay sẽ ra k:
    k = quãng đường theo tốc độ tham chiếu / quãng đường theo VO,   fx, fy *= k
    python -m pipeline.calib speedfit --video 1104.mp4 --camera data/calib/clip02.yaml \
        --start 29.6 --duration 21 --speed-ref data/raw/clip02_speed.csv --hood-frac 0.12 \
        --out data/calib/clip02_fit.yaml
"""

from __future__ import annotations

import argparse
import os

import cv2
import numpy as np

from .camera import Camera
from .video import iter_frames, probe


def calibrate_checkerboard(video: str, cols: int, rows: int, square: float,
                           fisheye: bool = False, every: float = 0.5, max_views: int = 60):
    objp = np.zeros((rows * cols, 1, 3), np.float64)
    objp[:, 0, :2] = np.mgrid[0:cols, 0:rows].T.reshape(-1, 2) * square
    obj_pts, img_pts, size = [], [], None
    for _, t, img in iter_frames(video, fps=1.0 / every):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        size = gray.shape[::-1]
        ok, corners = cv2.findChessboardCornersSB(gray, (cols, rows), flags=cv2.CALIB_CB_EXHAUSTIVE)
        if ok:
            obj_pts.append(objp.copy())
            img_pts.append(corners.reshape(-1, 1, 2).astype(np.float64))
            print(f"[calib] t={t:.1f}s found ({len(obj_pts)})")
        if len(obj_pts) >= max_views:
            break
    if len(obj_pts) < 8:
        raise RuntimeError(f"Chỉ tìm thấy {len(obj_pts)} view bàn cờ, cần >= 8")
    if fisheye:
        K, D = np.zeros((3, 3)), np.zeros((4, 1))
        flags = cv2.fisheye.CALIB_RECOMPUTE_EXTRINSIC | cv2.fisheye.CALIB_FIX_SKEW
        rms, K, D, _, _ = cv2.fisheye.calibrate(obj_pts, img_pts, size, K, D, flags=flags)
    else:
        rms, K, D, _, _ = cv2.calibrateCamera([o.reshape(-1, 3).astype(np.float32) for o in obj_pts],
                                              [i.astype(np.float32) for i in img_pts], size, None, None)
    print(f"[calib] RMS reprojection error = {rms:.3f} px (tốt nếu < 1)")
    return Camera(size[0], size[1], K, np.asarray(D).ravel(), "fisheye" if fisheye else "pinhole"), rms


def speedfit(args) -> Camera:
    import math

    import pandas as pd

    from .ego_motion import load_speed_ref, visual_odometry, vo_speed

    cam = Camera.load(args.camera)
    horizon = cam.horizon_row
    ref = load_speed_ref(args.speed_ref, args.start)
    tracks = pd.read_parquet(args.tracks) if args.tracks else None
    for it in range(args.iters):
        vo = visual_odometry(args.video, cam, tracks, args.start, args.duration, hood_frac=args.hood_frac)
        t = vo["t"].values
        v_vo = vo_speed(vo)
        v_ref = np.interp(t, ref["t"], ref["speed"])
        use = (t >= ref["t"].min()) & (t <= ref["t"].max())
        dt = np.diff(t, prepend=t[0])
        k = float(np.sum(v_ref[use] * dt[use]) / max(np.sum(v_vo[use] * dt[use]), 1e-6))
        corr = float(np.corrcoef(v_vo[use], v_ref[use])[0, 1])
        cam.K[0, 0] *= k
        cam.K[1, 1] *= k
        cam.pitch = cam.pitch_from_horizon(horizon)
        fov = math.degrees(2 * math.atan(cam.img_w / 2 / cam.fx))
        print(f"[speedfit] lần {it + 1}: k = {k:.3f} -> fx = {cam.fx:.0f}px, FOV ngang = {fov:.1f}°, "
              f"tương quan tốc độ VO và tham chiếu = {corr:.2f}")
    return cam


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("checker")
    a.add_argument("--video", required=True)
    a.add_argument("--cols", type=int, required=True, help="số góc trong theo chiều ngang")
    a.add_argument("--rows", type=int, required=True)
    a.add_argument("--square", type=float, required=True, help="cạnh ô (m)")
    a.add_argument("--fisheye", action="store_true")
    a.add_argument("--mount-height", type=float, default=1.35)
    a.add_argument("--horizon-row", type=float)
    a.add_argument("--out", required=True)
    b = sub.add_parser("approx")
    b.add_argument("--video", required=True)
    b.add_argument("--fov", type=float, required=True, help="FOV ngang (độ)")
    b.add_argument("--horizon-row", type=float)
    b.add_argument("--mount-height", type=float, default=1.35)
    b.add_argument("--out", required=True)
    d = sub.add_parser("speedfit")
    d.add_argument("--video", required=True)
    d.add_argument("--camera", required=True)
    d.add_argument("--start", type=float, required=True)
    d.add_argument("--duration", type=float, required=True)
    d.add_argument("--speed-ref", required=True, help="CSV t (giây video gốc), speed_kmh")
    d.add_argument("--hood-frac", type=float, default=0.0)
    d.add_argument("--tracks", help="tracks.parquet để mask xe (không bắt buộc)")
    d.add_argument("--iters", type=int, default=2)
    d.add_argument("--out", required=True)
    c = sub.add_parser("frame")
    c.add_argument("--video", required=True)
    c.add_argument("--t", type=float, default=0.0)
    c.add_argument("--out", required=True)
    args = ap.parse_args()

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    if args.cmd == "frame":
        _, _, img = next(iter_frames(args.video, start=args.t, duration=1.0))
        for r in range(0, img.shape[0], 50):
            cv2.line(img, (0, r), (img.shape[1], r), (0, 255, 255) if r % 100 == 0 else (0, 128, 128), 1)
            if r % 100 == 0:
                cv2.putText(img, str(r), (5, r - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        cv2.imwrite(args.out, img)
        print(f"Đã ghi {args.out}")
        return
    if args.cmd == "speedfit":
        cam = speedfit(args)
        cam.save(args.out)
        print(f"Đã ghi {args.out}")
        return
    if args.cmd == "checker":
        cam, _ = calibrate_checkerboard(args.video, args.cols, args.rows, args.square, args.fisheye)
    else:
        info = probe(args.video)
        cam = Camera.from_fov(info["width"], info["height"], args.fov)
    cam.mount_height = args.mount_height
    if args.horizon_row is not None:
        cam.pitch = cam.pitch_from_horizon(args.horizon_row)
    cam.save(args.out)
    print(f"Đã ghi {args.out}")


if __name__ == "__main__":
    main()
