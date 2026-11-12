"""Bước 5: tính quỹ đạo của chính xe quay video (ego): x, y, yaw, v theo thời gian.

Hai nguồn:
1. GPS (nếu có): lat/lon -> ENU, rồi RTS smoother, yaw lấy theo hướng vận tốc.
2. Visual odometry trên mặt đường (IPM + ECC) khi không có GPS:
   - Warp vùng đường phía trước thành ảnh nhìn từ trên xuống (bird's-eye view,
     inverse perspective mapping). Mỗi pixel BEV tương ứng một ô cố định trên mặt
     đường, ví dụ 5 cm x 5 cm. Vì biết chiều cao camera nên tỉ lệ ra đúng mét;
     monocular SLAM thường không biết tỉ lệ, cách này thì không gặp vấn đề đó.
   - So khớp hai ảnh BEV liên tiếp bằng ECC (Enhanced Correlation Coefficient)
     với mô hình Euclid (xoay + tịnh tiến). ECC dùng toàn bộ texture của mặt
     đường nên vẫn chạy được trên đường trơn, ít góc cạnh. Optical flow theo
     điểm đặc trưng thì bị hút vào cây cối và dải phân cách, mà những thứ đó
     không nằm trên mặt đường.
   - Vùng có xe khác (box từ bước detect) bị mask đi.
   Giả định đường phẳng (PLAN.md mục 13). Khi có GPS thì nên dùng GPS.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
import pandas as pd

from .camera import Camera
from .gps import LocalENU
from .smoothing import heading_from_velocity, resample, rts_cv
from .video import iter_frames


def from_gps(gps: pd.DataFrame, t_grid: np.ndarray, gps_sigma: float = 1.5):
    """Trả về (DataFrame t,x,y,yaw,v ; origin (lat0, lon0)). Gốc ENU = vị trí đầu tiên."""
    enu = LocalENU(float(gps["lat"].iloc[0]), float(gps["lon"].iloc[0]))
    x, y = enu.to_xy(gps["lat"].values, gps["lon"].values)
    xs, _ = rts_cv(gps["t"].values, np.stack([x, y], 1), gps_sigma**2, q=1.0)
    fallback = math.radians(90 - gps["heading"].iloc[0]) if "heading" in gps and not np.isnan(gps["heading"].iloc[0]) else 0.0
    yaw = heading_from_velocity(xs[:, 2], xs[:, 3], 1.0, fallback)
    st = resample(gps["t"].values, np.column_stack([xs, yaw]), t_grid)
    df = pd.DataFrame({"t": t_grid, "x": st[:, 0], "y": st[:, 1], "yaw": st[:, 4],
                       "v": np.hypot(st[:, 2], st[:, 3])})
    # Đặt gốc tại vị trí ego lúc t = 0 (PLAN.md mục 4)
    lat0, lon0 = enu.to_latlon(df["x"].iloc[0], df["y"].iloc[0])
    df["x"] -= df["x"].iloc[0]
    df["y"] -= df["y"].iloc[0]
    return df, (float(lat0), float(lon0))


class BEV:
    """Lưới bird's-eye view trên mặt đường: x ∈ [x_min, x_max] (tiến), y ∈ [-y_half, y_half] (trái).

    Không truyền x_min/x_max thì vùng được chọn theo hàng pixel: từ ngay trên
    capo (hood_row) lên tới gần đường chân trời. Nhờ vậy BEV luôn nhìn vào phần
    mặt đường gần, rõ nét, kể cả khi tiêu cự calib còn sai.
    """

    def __init__(self, cam: Camera, x_min=None, x_max=None, y_half=4.5, n_rows=240,
                 hood_row: float | None = None):
        if x_min is None or x_max is None:
            v_lo = (hood_row if hood_row is not None else cam.img_h) - 0.02 * cam.img_h
            v_hi = cam.horizon_row + 0.10 * cam.img_h
            g, _ = cam.pixels_to_ground([[cam.cx, v_lo], [cam.cx, v_hi]])
            x_min, x_max = float(g[0, 0]), float(g[1, 0])
        res = (x_max - x_min) / n_rows
        self.x_max, self.y_half, self.res = x_max, y_half, res
        rows = int(round((x_max - x_min) / res))
        cols = int(round(2 * y_half / res))
        r, c = np.mgrid[0:rows, 0:cols].astype(np.float64)
        gx = x_max - r * res
        gy = y_half - c * res
        uv, front = cam.project(np.stack([gx.ravel(), gy.ravel(), np.zeros(gx.size)], 1))
        uv[~front] = -1
        self.map_u = uv[:, 0].reshape(rows, cols).astype(np.float32)
        self.map_v = uv[:, 1].reshape(rows, cols).astype(np.float32)
        inside = (uv[:, 0] >= 0) & (uv[:, 0] < cam.img_w - 1) & (uv[:, 1] >= 0) & (uv[:, 1] < cam.img_h - 1)
        self.valid = inside.reshape(rows, cols)
        # Ma trận đổi mét <-> pixel BEV: [col,row,1] = A @ [x,y,1]
        self.A = np.array([[0, -1 / res, y_half / res], [-1 / res, 0, x_max / res], [0, 0, 1.0]])
        self.Ainv = np.linalg.inv(self.A)

    def warp(self, img):
        return cv2.remap(img, self.map_u, self.map_v, cv2.INTER_LINEAR, borderValue=0)

    def pixel_to_metric(self, W2x3):
        """Phép Euclid trong pixel BEV -> phép Euclid trong mét (3x3)."""
        W = np.vstack([W2x3, [0, 0, 1]])
        return self.Ainv @ W @ self.A


def _image_mask(shape, boxes, hood_row: int) -> np.ndarray:
    h, w = shape
    mask = np.full((h, w), 255, np.uint8)
    mask[hood_row:] = 0
    for x1, y1, x2, y2 in boxes:
        pad = 0.1 * (x2 - x1)
        cv2.rectangle(mask, (int(x1 - pad), int(y1 - pad)), (int(x2 + pad), int(y2 + pad)), 0, -1)
    return mask


def visual_odometry(video: str, cam: Camera, tracks: pd.DataFrame | None,
                    start: float = 0.0, duration: float | None = None,
                    proc_width: int = 960, hood_frac: float = 0.0,
                    fps: float = 15.0, min_cc: float = 0.5,
                    median_window: float = 2.0) -> pd.DataFrame:
    """IPM + ECC VO. `cam` là camera ở độ phân giải gốc, hàm sẽ tự scale.

    median_window > 0: trừ đi median của các ảnh BEV trong cửa sổ ±median_window giây.
    Thứ gì dính theo camera (phản chiếu taplo trên kính, watermark, bụi) gần như
    không đổi theo thời gian nên nằm trong median và bị khử. Còn lại chủ yếu là
    texture mặt đường đang trôi.
    Trả về DataFrame t, x, y, yaw, cc (độ khớp ECC 0..1; 0 = frame bị bỏ, dùng vận tốc cũ).
    """
    boxes_by_t = {}
    if tracks is not None and len(tracks):
        for t, g in tracks.groupby("t"):
            boxes_by_t[round(t, 3)] = g[["x1", "y1", "x2", "y2"]].values
    box_ts = np.array(sorted(boxes_by_t)) if boxes_by_t else None
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))

    # Pha 1: warp mọi frame sang BEV
    ts, tops, masks = [], [], []
    bev = None
    for _, t, img in iter_frames(video, start, duration, fps, width=proc_width):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if bev is None:
            small = cam.scaled(gray.shape[1], gray.shape[0])
            sx = gray.shape[1] / cam.img_w
            hood_row = int(gray.shape[0] * (1 - hood_frac))
            bev = BEV(small, hood_row=hood_row)
        boxes = []
        if box_ts is not None:
            near = box_ts[np.argmin(np.abs(box_ts - t))]
            if abs(near - t) < 0.1:
                boxes = boxes_by_t[near] * sx
        top = cv2.GaussianBlur(clahe.apply(bev.warp(gray)), (5, 5), 0).astype(np.float32)
        mask = (bev.warp(_image_mask(gray.shape, boxes, hood_row)) > 128) & bev.valid
        ts.append(t); tops.append(top); masks.append(mask.astype(np.uint8) * 255)
    S = np.stack(tops)
    if median_window > 0:
        half = max(1, int(median_window * fps))
        step = max(1, half // 8)
        S = np.stack([S[k] - np.median(S[max(0, k - half):k + half + 1:step], axis=0) for k in range(len(S))])

    # Pha 2: ECC giữa các cặp frame liên tiếp
    pose = np.array([0.0, 0.0, 0.0])
    out = [(ts[0], 0.0, 0.0, 0.0, 0.0)]
    last_inc = np.zeros(3)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-6)
    for k in range(1, len(ts)):
        prev, top, prev_mask = S[k - 1], S[k], masks[k - 1]
        t, dt = ts[k], max(ts[k] - ts[k - 1], 1e-3)
        # Khởi tạo ECC bằng chuyển động của bước trước (giả định vận tốc không đổi)
        c, s = math.cos(-last_inc[2]), math.sin(-last_inc[2])
        Rm = np.array([[c, -s], [s, c]])
        tm = -Rm @ last_inc[:2]
        M0 = np.eye(3); M0[:2, :2] = Rm; M0[:2, 2] = tm
        Wp = (bev.A @ M0 @ bev.Ainv)[:2].astype(np.float32)
        inc, cc = None, 0.0
        if prev_mask.sum() / 255 > 0.2 * prev_mask.size:
            try:
                cc, W = cv2.findTransformECC(prev, top, Wp, cv2.MOTION_EUCLIDEAN, crit, prev_mask, 5)
                M = bev.pixel_to_metric(W)  # điểm mặt đường: frame k -> frame k+1
                dyaw = math.atan2(M[1, 0], M[0, 0])
                c, s = math.cos(-dyaw), math.sin(-dyaw)
                dx = -(c * M[0, 2] - s * M[1, 2])
                dy = -(s * M[0, 2] + c * M[1, 2])
                if cc >= min_cc and -1.0 < dx / dt < 45 and abs(dyaw / dt) < 1.2:
                    inc = np.array([dx, dy, -dyaw])
            except cv2.error:
                cc = 0.0
        if inc is None:
            inc, cc = last_inc, 0.0  # ECC không hội tụ: coi như vận tốc không đổi
        last_inc = inc
        c, s = math.cos(pose[2]), math.sin(pose[2])
        pose = pose + [c * inc[0] - s * inc[1], s * inc[0] + c * inc[1], inc[2]]
        out.append((t, pose[0], pose[1], pose[2], float(cc)))
    return pd.DataFrame(out, columns=["t", "x", "y", "yaw", "cc"])


def vo_speed(vo: pd.DataFrame) -> np.ndarray:
    """Tốc độ thô từ VO (m/s), cùng độ dài với vo."""
    d = np.hypot(np.diff(vo["x"]), np.diff(vo["y"])) / np.maximum(np.diff(vo["t"]), 1e-3)
    return np.r_[d[:1], d]


def fuse_speed(vo: pd.DataFrame, speed_ref: pd.DataFrame, t_grid: np.ndarray) -> pd.DataFrame:
    """Ego = tốc độ tham chiếu (GPS, overlay, CAN) + hướng từ VO.

    Khi tỉ lệ của VO không đáng tin (calib sai, xe chúi khi phanh...), phép đo
    xoay của VO vẫn tốt vì góc xoay không phụ thuộc tỉ lệ. Trên xe thật cũng làm
    tương tự: PDF dùng car_speed từ CAN kết hợp với hướng từ INS.
    speed_ref: cột t (giây, cùng gốc với vo) và speed (m/s).
    """
    yaw = np.convolve(np.pad(vo["yaw"].values, 5, mode="edge"), np.ones(11) / 11, mode="valid")
    yaw_g = np.interp(t_grid, vo["t"].values, yaw)
    v_g = np.interp(t_grid, speed_ref["t"].values, speed_ref["speed"].values)
    dt = np.diff(t_grid, prepend=t_grid[0])
    x = np.cumsum(v_g * np.cos(yaw_g) * dt)
    y = np.cumsum(v_g * np.sin(yaw_g) * dt)
    return pd.DataFrame({"t": t_grid, "x": x - x[0], "y": y - y[0], "yaw": yaw_g, "v": v_g})


def load_speed_ref(path: str, start: float) -> pd.DataFrame:
    """CSV gồm t (giây tính theo thời gian của video gốc) và speed_kmh hoặc speed (m/s).
    Trả về DataFrame với t tính từ đầu clip."""
    df = pd.read_csv(path)
    if "speed_kmh" in df:
        df["speed"] = df["speed_kmh"] / 3.6
    df["t"] = df["t"] - start
    return df.sort_values("t")[["t", "speed"]].reset_index(drop=True)


def smooth_vo(vo: pd.DataFrame, t_grid: np.ndarray) -> pd.DataFrame:
    """Làm mượt kết quả VO rồi đưa về lưới thời gian đầu ra."""
    t = vo["t"].values
    xs, _ = rts_cv(t, vo[["x", "y"]].values, 0.05**2, q=3.0)
    yaw = np.convolve(np.pad(vo["yaw"].values, 5, mode="edge"), np.ones(11) / 11, mode="valid")
    st = resample(t, np.column_stack([xs[:, :2], yaw, np.hypot(xs[:, 2], xs[:, 3])]), t_grid)
    return pd.DataFrame({"t": t_grid, "x": st[:, 0], "y": st[:, 1], "yaw": st[:, 2], "v": st[:, 3]})


def interp_pose(ego: pd.DataFrame, t):
    """Pose của ego tại thời điểm t bất kỳ (nội suy)."""
    t = np.asarray(t, float)
    x = np.interp(t, ego["t"], ego["x"])
    y = np.interp(t, ego["t"], ego["y"])
    yaw = np.interp(t, ego["t"], np.unwrap(ego["yaw"].values))
    return x, y, yaw
