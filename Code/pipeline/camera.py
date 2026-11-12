"""Mô hình camera: pixel <-> mặt đường.

Quy ước hệ tọa độ
-----------------
- Camera (OpenCV): x sang phải, y xuống dưới, z nhìn về phía trước.
- Xe (vehicle, giống ROS): x về phía trước, y sang trái, z hướng lên. Gốc nằm
  trên mặt đường, ngay dưới điểm tham chiếu của xe. Camera đặt tại
  (x_offset, 0, mount_height).
- pitch > 0 nghĩa là camera chúc xuống.

Ý tưởng chính (lift 2D -> 3D, PLAN.md mục 3 bước 6): đáy bounding box là điểm
vật chạm đất. Bắn một tia từ camera qua pixel đó rồi cắt với mặt phẳng z = 0,
ta được vị trí tính bằng mét. Cách này không cần model depth.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np
import yaml


@dataclass
class Camera:
    img_w: int
    img_h: int
    K: np.ndarray
    dist: np.ndarray = field(default_factory=lambda: np.zeros(5))
    model: str = "pinhole"  # "pinhole" | "fisheye"
    mount_height: float = 1.35
    pitch: float = 0.0
    x_offset: float = 0.0

    @property
    def fx(self) -> float:
        return float(self.K[0, 0])

    @property
    def fy(self) -> float:
        return float(self.K[1, 1])

    @property
    def cx(self) -> float:
        return float(self.K[0, 2])

    @property
    def cy(self) -> float:
        return float(self.K[1, 2])

    # ------------------------------------------------------------------ tạo / lưu
    @classmethod
    def from_fov(cls, img_w: int, img_h: int, fov_h_deg: float, **kw) -> "Camera":
        """Intrinsics gần đúng khi chưa calib: chỉ cần biết FOV ngang."""
        fx = (img_w / 2) / math.tan(math.radians(fov_h_deg) / 2)
        K = np.array([[fx, 0, img_w / 2], [0, fx, img_h / 2], [0, 0, 1.0]])
        return cls(img_w, img_h, K, **kw)

    @classmethod
    def load(cls, path: str) -> "Camera":
        with open(path, encoding="utf-8") as f:
            c = yaml.safe_load(f)
        w, h = int(c["image_width"]), int(c["image_height"])
        kw = dict(
            model=c.get("model", "pinhole"),
            mount_height=float(c.get("mount_height", 1.35)),
            x_offset=float(c.get("x_offset", 0.0)),
        )
        if c.get("dist") is not None:
            kw["dist"] = np.asarray(c["dist"], float).ravel()
        if c.get("K") is not None:
            cam = cls(w, h, np.asarray(c["K"], float).reshape(3, 3), **kw)
        else:
            cam = cls.from_fov(w, h, float(c["fov_h"]), **kw)
        if c.get("horizon_row") is not None:
            cam.pitch = cam.pitch_from_horizon(float(c["horizon_row"]))
        else:
            cam.pitch = math.radians(float(c.get("pitch_deg", 0.0)))
        return cam

    def save(self, path: str) -> None:
        data = {
            "image_width": self.img_w,
            "image_height": self.img_h,
            "model": self.model,
            "K": self.K.tolist(),
            "dist": np.asarray(self.dist).ravel().tolist(),
            "mount_height": self.mount_height,
            "pitch_deg": math.degrees(self.pitch),
            "x_offset": self.x_offset,
        }
        with open(path, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, sort_keys=False)

    def scaled(self, img_w: int, img_h: int) -> "Camera":
        """Camera tương ứng khi resize ảnh (dùng cho VO chạy ở ảnh nhỏ)."""
        sx, sy = img_w / self.img_w, img_h / self.img_h
        K = self.K.copy()
        K[0] *= sx
        K[1] *= sy
        return Camera(img_w, img_h, K, self.dist.copy(), self.model,
                      self.mount_height, self.pitch, self.x_offset)

    def pitch_from_horizon(self, horizon_row: float) -> float:
        """Đường chân trời nằm ở hàng pixel `horizon_row` thì pitch bằng bao nhiêu.

        Tia đi qua đường chân trời nằm ngang, nên tan(pitch) = (cy - row) / fy.
        """
        return math.atan2(self.cy - horizon_row, self.fy)

    @property
    def horizon_row(self) -> float:
        return self.cy - self.fy * math.tan(self.pitch)

    # ------------------------------------------------------------------ hình học
    def normalize(self, uv) -> np.ndarray:
        """Pixel -> tọa độ chuẩn hóa (x/z, y/z) đã khử méo."""
        uv = np.asarray(uv, np.float64).reshape(-1, 1, 2)
        if self.model == "fisheye":
            n = cv2.fisheye.undistortPoints(uv, self.K, self.dist[:4].reshape(4, 1))
        elif np.any(self.dist):
            n = cv2.undistortPoints(uv, self.K, self.dist)
        else:
            n = (uv - [self.cx, self.cy]) / [self.fx, self.fy]
        return n.reshape(-1, 2)

    def pixel_rays(self, uv) -> np.ndarray:
        """Hướng tia (chưa chuẩn hóa độ dài) trong hệ tọa độ xe, shape (N, 3)."""
        n = self.normalize(uv)
        f, l, u = np.ones(len(n)), -n[:, 0], -n[:, 1]
        c, s = math.cos(self.pitch), math.sin(self.pitch)
        return np.stack([f * c + u * s, l, -f * s + u * c], axis=1)

    def pixels_to_ground(self, uv, max_range: float = 150.0):
        """Cắt tia với mặt đường z = 0. Trả về (xy (N, 2), valid (N,))."""
        d = self.pixel_rays(uv)
        valid = d[:, 2] < -1e-6  # tia phải hướng xuống
        with np.errstate(divide="ignore", invalid="ignore"):
            t = np.where(valid, self.mount_height / -d[:, 2], np.nan)
        x = self.x_offset + t * d[:, 0]
        y = t * d[:, 1]
        valid &= np.hypot(x - self.x_offset, y) < max_range
        return np.stack([x, y], axis=1), valid

    def project(self, P) -> tuple[np.ndarray, np.ndarray]:
        """Điểm 3D trong hệ xe (N, 3) -> pixel (N, 2) và mask in_front."""
        P = np.asarray(P, np.float64).reshape(-1, 3)
        p = P - [self.x_offset, 0.0, self.mount_height]
        c, s = math.cos(self.pitch), math.sin(self.pitch)
        f = p[:, 0] * c - p[:, 2] * s
        u = p[:, 0] * s + p[:, 2] * c
        pc = np.stack([-p[:, 1], -u, f], axis=1)  # hệ camera OpenCV
        in_front = pc[:, 2] > 0.1
        pc = pc.reshape(-1, 1, 3)
        zero = np.zeros(3)
        if self.model == "fisheye":
            uv, _ = cv2.fisheye.projectPoints(pc, zero, zero, self.K, self.dist[:4])
        else:
            uv, _ = cv2.projectPoints(pc, zero, zero, self.K, self.dist)
        return uv.reshape(-1, 2), in_front
