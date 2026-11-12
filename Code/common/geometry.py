"""Hình học 2D dùng chung cho sim và AV stack: polyline (s, d) và va chạm hộp xoay."""

from __future__ import annotations

import math

import numpy as np


def wrap(a):
    return (np.asarray(a) + np.pi) % (2 * np.pi) - np.pi


class Polyline:
    """Đường gấp khúc có tham số độ dài cung s, đổi qua lại hệ Frenet (s, d).

    d > 0 nghĩa là điểm nằm bên trái đường.
    """

    def __init__(self, pts):
        self.pts = np.asarray(pts, float)
        seg = np.diff(self.pts, axis=0)
        self.seg_len = np.hypot(seg[:, 0], seg[:, 1])
        keep = np.r_[True, self.seg_len > 1e-6]
        if not keep.all():
            self.pts = self.pts[keep]
            seg = np.diff(self.pts, axis=0)
            self.seg_len = np.hypot(seg[:, 0], seg[:, 1])
        self.seg_dir = seg / self.seg_len[:, None]
        self.s = np.r_[0.0, np.cumsum(self.seg_len)]
        self.length = float(self.s[-1])

    def project(self, x: float, y: float, hint: int | None = None, window: int = 40):
        """Trả về (s, d, seg_index) của điểm gần nhất trên polyline."""
        n = len(self.seg_len)
        lo, hi = (0, n) if hint is None else (max(0, hint - window), min(n, hint + window))
        a = self.pts[lo:hi]
        dv = self.seg_dir[lo:hi]
        rel = np.array([x, y]) - a
        tproj = np.clip(np.einsum("ij,ij->i", rel, dv), 0, self.seg_len[lo:hi])
        closest = a + dv * tproj[:, None]
        dist2 = np.sum((np.array([x, y]) - closest) ** 2, axis=1)
        i = int(np.argmin(dist2))
        k = lo + i
        cross = dv[i, 0] * rel[i, 1] - dv[i, 1] * rel[i, 0]
        # Ngoài hai đầu: ngoại suy theo hướng đoạn đầu/cuối để s vẫn liên tục
        along = float(np.dot(rel[i], dv[i]))
        if k == 0 and along < 0:
            return along, float(cross), 0
        if k == n - 1 and along > self.seg_len[k]:
            return self.s[k] + along, float(cross), k
        return float(self.s[k] + tproj[i]), float(math.copysign(math.sqrt(dist2[i]), cross)), k

    def point(self, s):
        """Vị trí (N, 2) và hướng (N,) tại các giá trị s (ngoại suy thẳng ở hai đầu)."""
        s = np.atleast_1d(np.asarray(s, float))
        k = np.clip(np.searchsorted(self.s, s, side="right") - 1, 0, len(self.seg_len) - 1)
        off = s - self.s[k]
        p = self.pts[k] + self.seg_dir[k] * off[:, None]
        yaw = np.arctan2(self.seg_dir[k, 1], self.seg_dir[k, 0])
        return p, yaw

    def to_xy(self, s, d):
        p, yaw = self.point(s)
        d = np.atleast_1d(np.asarray(d, float))
        return p + np.stack([-np.sin(yaw), np.cos(yaw)], 1) * d[:, None], yaw

    def curvature(self, s, ds: float = 3.0):
        _, y0 = self.point(np.asarray(s) - ds)
        _, y1 = self.point(np.asarray(s) + ds)
        return wrap(y1 - y0) / (2 * ds)


def box_corners(x, y, yaw, L, W):
    c, s = math.cos(yaw), math.sin(yaw)
    pts = np.array([[L / 2, W / 2], [L / 2, -W / 2], [-L / 2, -W / 2], [-L / 2, W / 2]])
    return np.stack([x + c * pts[:, 0] - s * pts[:, 1], y + s * pts[:, 0] + c * pts[:, 1]], 1)


def boxes_overlap(a, b) -> bool:
    """Separating Axis Theorem cho hai hình chữ nhật xoay (mỗi cái là 4 góc)."""
    for poly in (a, b):
        for i in range(4):
            e = poly[(i + 1) % 4] - poly[i]
            axis = np.array([-e[1], e[0]])
            pa, pb = a @ axis, b @ axis
            if pa.max() < pb.min() or pb.max() < pa.min():
                return False
    return True


def box_distance(a, b) -> float:
    """Khoảng cách gần đúng giữa hai hộp (0 nếu chạm nhau): khoảng cách nhỏ nhất giữa các góc và cạnh."""
    if boxes_overlap(a, b):
        return 0.0
    best = math.inf
    for P, Q in ((a, b), (b, a)):
        for p in P:
            for i in range(4):
                q0, q1 = Q[i], Q[(i + 1) % 4]
                e = q1 - q0
                t = np.clip(np.dot(p - q0, e) / max(np.dot(e, e), 1e-9), 0, 1)
                best = min(best, float(np.hypot(*(p - (q0 + t * e)))))
    return best
