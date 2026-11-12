"""Ước lượng đường chân trời theo từng frame từ chiều cao ô tô (ý tưởng mượn từ buildphase/sod_geo).

buildphase tính chiều cao vật từ đường chân trời (điểm chạm đất + phối cảnh):
    h_obj = H_cam · (y2 − y1) / (y2 − v_hor)
Viết ngược lại, nếu biết chiều cao vật (ô tô ≈ 1.5 m) thì suy ra được đường chân trời:
    v_hor = y2 − H_cam · (y2 − y1) / H_car
Công thức không dùng tiêu cự fy, nên sai calib fy không làm hỏng nó.
Lấy trung vị trên các xe trong mỗi frame, rồi làm mượt theo thời gian.
SOD có LiDAR thì khớp trực tiếp 1/z = a·v + b; dashcam không có LiDAR nên dùng ô tô làm thước đo.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .camera import Camera
from .smoothing import rts_cv


def estimate(tracks: pd.DataFrame, cam: Camera, H_car: float = 1.5, classes=("car",),
             hood_frac: float = 0.0, min_h_px: float = 25.0, window: int = 15,
             max_dev_frac: float = 0.04) -> pd.DataFrame:
    """-> DataFrame t, v_hor, n (số xe dùng được; 0 = dùng giá trị mặc định của camera)."""
    v_static = cam.horizon_row
    ts = np.sort(tracks["t"].unique())
    c = tracks[tracks["cls"].isin(classes)]
    h = c["y2"] - c["y1"]
    ok = ((c["y2"] < cam.img_h * (1 - hood_frac) - 3) & (h > min_h_px)
          & (c["x1"] > 2) & (c["x2"] < cam.img_w - 3) & (c["y2"] > v_static))
    c = c[ok]
    vh = c["y2"] - cam.mount_height * (c["y2"] - c["y1"]) / H_car
    per = vh.groupby(c["t"]).agg(["median", "count"])
    s = pd.Series(np.nan, index=ts)
    n = pd.Series(0, index=ts)
    s.loc[per.index] = per["median"].values
    n.loc[per.index] = per["count"].values
    # Bỏ giá trị quá xa mặc định (do detect sai hoặc xe tải bị gán class car)
    s[(s - v_static).abs() > max_dev_frac * cam.img_h] = np.nan
    # Median trượt để chặn outlier, rồi RTS (ý tưởng smoothSpan của cvat-cuboid-quicktool):
    # phương sai đo giảm khi frame có nhiều xe; frame không có xe thì chỉ predict.
    med = s.rolling(window, center=True, min_periods=1).median()
    if med.notna().sum() >= 2:
        z = np.stack([med.values, np.zeros(len(med))], 1)
        r_var = (8.0 ** 2) / np.maximum(n.values, 1)          # ~8 px/xe
        xs, _ = rts_cv(ts, z, r_var, q=50.0)                    # dùng chiều x của CV-RTS cho chuỗi 1D
        smooth = pd.Series(xs[:, 0], index=ts)
    else:
        smooth = med.fillna(v_static)
    return pd.DataFrame({"t": ts, "v_hor": smooth.values, "n": n.values})


def pitch_at(series: pd.DataFrame | None, cam: Camera, t) -> np.ndarray:
    """Pitch (rad) theo thời gian; không có series thì dùng pitch cố định của camera."""
    t = np.asarray(t, float)
    if series is None or series.empty:
        return np.full(t.shape, cam.pitch)
    v = np.interp(t, series["t"], series["v_hor"])
    return np.arctan2(cam.cy - v, cam.fy)


def object_height(box, v_hor: float, H_cam: float):
    """Chiều cao vật đứng trên mặt đường (công thức buildphase). None nếu đáy box ở trên chân trời."""
    x1, y1, x2, y2 = box
    return H_cam * (y2 - y1) / (y2 - v_hor) if y2 > v_hor + 2 else None


def with_pitch(cam: Camera, pitch: float) -> Camera:
    return Camera(cam.img_w, cam.img_h, cam.K, cam.dist, cam.model, cam.mount_height, pitch, cam.x_offset)

