"""Kalman filter + RTS smoother với mô hình vận tốc không đổi (PLAN.md mục 3 bước 7).

Lọc Kalman (forward) chỉ dùng dữ liệu quá khứ. Vì chạy offline nên ta chạy thêm
RTS smoother (backward) để mỗi điểm dùng cả dữ liệu tương lai, quỹ đạo sẽ mượt
hơn nhiều. Công thức predict/update giống mục 4.5.3.3 của PDF:
    x(t+1) = F x(t),  P(t+1) = F P F^T + Q
    K = P H^T (H P H^T + R)^-1,  x = x + K (z - H x),  P = (I - K H) P

Trạng thái: [x, y, vx, vy]. Bước thời gian dt được phép thay đổi, và phép đo
có thể thiếu (NaN). Khi đó filter chỉ predict, nhờ vậy nối được track đứt quãng.
"""

from __future__ import annotations

import numpy as np

H = np.array([[1.0, 0, 0, 0], [0, 1.0, 0, 0]])
GATE_CHI2 = 13.8  # chi-square 2 bậc tự do, mức 0.1%: loại phép đo outlier


def _FQ(dt: float, q: float):
    F = np.eye(4)
    F[0, 2] = F[1, 3] = dt
    g = np.array([[dt**3 / 3, dt**2 / 2], [dt**2 / 2, dt]]) * q
    Q = np.zeros((4, 4))
    Q[np.ix_([0, 2], [0, 2])] = g
    Q[np.ix_([1, 3], [1, 3])] = g
    return F, Q


def rts_cv(t, z, r_var, q: float = 2.0, v0_var: float = 100.0):
    """t (N,), z (N, 2), có thể chứa NaN; r_var là phương sai phép đo (N,) hoặc số.

    q là mật độ phổ nhiễu gia tốc (m²/s³): càng lớn thì quỹ đạo càng bám sát
    phép đo, càng nhỏ thì càng mượt.
    Trả về (xs (N, 4), Ps (N, 4, 4)) sau khi làm mượt.
    """
    t = np.asarray(t, float)
    z = np.asarray(z, float)
    n = len(t)
    r_var = np.broadcast_to(np.asarray(r_var, float), (n,))
    first = int(np.argmax(~np.isnan(z[:, 0])))
    x = np.array([z[first, 0], z[first, 1], 0.0, 0.0])
    P = np.diag([r_var[first], r_var[first], v0_var, v0_var])

    xf = np.zeros((n, 4)); Pf = np.zeros((n, 4, 4))
    xp = np.zeros((n, 4)); Pp = np.zeros((n, 4, 4))
    Fs = np.zeros((n, 4, 4))
    for k in range(n):
        if k > 0:
            F, Q = _FQ(max(t[k] - t[k - 1], 1e-3), q)
            x = F @ x
            P = F @ P @ F.T + Q
            Fs[k] = F
        xp[k], Pp[k] = x, P
        if not np.isnan(z[k, 0]):
            y = z[k] - H @ x
            S = H @ P @ H.T + np.eye(2) * r_var[k]
            Si = np.linalg.inv(S)
            if y @ Si @ y < GATE_CHI2 or k == first:
                K = P @ H.T @ Si
                x = x + K @ y
                P = (np.eye(4) - K @ H) @ P
        xf[k], Pf[k] = x, P

    xs = xf.copy(); Ps = Pf.copy()
    for k in range(n - 2, -1, -1):
        C = Pf[k] @ Fs[k + 1].T @ np.linalg.inv(Pp[k + 1])
        xs[k] = xf[k] + C @ (xs[k + 1] - xp[k + 1])
        Ps[k] = Pf[k] + C @ (Ps[k + 1] - Pp[k + 1]) @ C.T
    return xs, Ps


def heading_from_velocity(vx, vy, v_min: float, fallback, min_run: int = 3):
    """Hướng = hướng vận tốc khi đủ nhanh (luật `motionYaws` của cvat-cuboid-quicktool, dòng 3063).

    - Đứng yên khi v <= v_min.
    - Đoạn "di chuyển" ngắn hơn min_run mẫu cũng coi là đứng yên, vì thường là nhiễu
      vị trí chứ không phải chuyển động thật.
    - Mẫu đứng yên lấy hướng của mẫu di chuyển GẦN NHẤT (cả trước lẫn sau). Chưa có
      mẫu di chuyển nào thì lấy fallback.
    """
    v = np.hypot(vx, vy)
    yaw = np.arctan2(vy, vx)
    ok = v > v_min
    i = 0
    while i < len(ok):  # bỏ các đoạn di chuyển quá ngắn
        if ok[i]:
            j = i
            while j < len(ok) and ok[j]:
                j += 1
            if j - i < min_run:
                ok[i:j] = False
            i = j
        else:
            i += 1
    fallback = np.broadcast_to(np.asarray(fallback, float), v.shape)
    if not ok.any():
        return fallback.copy()
    idx = np.flatnonzero(ok)
    nearest = idx[np.clip(np.searchsorted(idx, np.arange(len(yaw))), 0, len(idx) - 1)]
    prev = idx[np.clip(np.searchsorted(idx, np.arange(len(yaw))) - 1, 0, len(idx) - 1)]
    pick = np.where(np.abs(prev - np.arange(len(yaw))) < np.abs(nearest - np.arange(len(yaw))), prev, nearest)
    return np.unwrap(yaw[pick])


def resample(t_src, values, t_dst):
    """Nội suy tuyến tính từng cột sang lưới thời gian mới."""
    values = np.asarray(values, float)
    if values.ndim == 1:
        return np.interp(t_dst, t_src, values)
    return np.stack([np.interp(t_dst, t_src, values[:, j]) for j in range(values.shape[1])], 1)
