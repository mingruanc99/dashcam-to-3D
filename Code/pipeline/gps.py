"""Đọc GPS và đổi lat/lon sang mét (ENU cục bộ).

Đây cũng là cách xe trong 自动驾驶系统方案.pdf mục 3.1 làm: đổi lat/lon sang
tọa độ phẳng X1, Y1, rồi trừ đi gốc X0, Y0 để số không quá lớn.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

EARTH_R = 6378137.0


class LocalENU:
    """Phép chiếu phẳng quanh gốc (lat0, lon0). Sai số rất nhỏ trong vài km."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0, self.lon0 = lat0, lon0
        self._k = math.cos(math.radians(lat0))

    def to_xy(self, lat, lon):
        lat, lon = np.asarray(lat, float), np.asarray(lon, float)
        x = np.radians(lon - self.lon0) * EARTH_R * self._k  # East
        y = np.radians(lat - self.lat0) * EARTH_R  # North
        return x, y

    def to_latlon(self, x, y):
        lat = self.lat0 + np.degrees(np.asarray(y, float) / EARTH_R)
        lon = self.lon0 + np.degrees(np.asarray(x, float) / (EARTH_R * self._k))
        return lat, lon


def _nmea_deg(value: str, hemi: str) -> float:
    if not value:
        return float("nan")
    v = float(value)
    deg = int(v // 100)
    d = deg + (v - deg * 100) / 60.0
    return -d if hemi in ("S", "W") else d


def parse_nmea(path: str) -> pd.DataFrame:
    """Đọc câu $..RMC trong file NMEA -> DataFrame (utc_s, lat, lon, speed, heading)."""
    rows = []
    with open(path, encoding="ascii", errors="ignore") as f:
        for line in f:
            i = line.find("$")
            if i < 0:
                continue
            parts = line[i:].strip().split("*")[0].split(",")
            if len(parts) < 9 or not parts[0].endswith("RMC") or parts[2] != "A":
                continue
            hhmmss = parts[1]
            utc_s = int(hhmmss[0:2]) * 3600 + int(hhmmss[2:4]) * 60 + float(hhmmss[4:])
            rows.append({
                "utc_s": utc_s,
                "lat": _nmea_deg(parts[3], parts[4]),
                "lon": _nmea_deg(parts[5], parts[6]),
                "speed": float(parts[7] or 0) * 0.514444,  # knot -> m/s
                "heading": float(parts[8]) if parts[8] else float("nan"),
            })
    df = pd.DataFrame(rows)
    if df.empty:
        raise ValueError(f"Không tìm thấy câu RMC hợp lệ trong {path}")
    return df


def load_gps(path: str, time_offset: float = 0.0) -> pd.DataFrame:
    """Đọc GPS thành DataFrame có cột t tính bằng giây từ đầu video.

    - CSV cần có cột t, lat, lon (speed và heading không bắt buộc).
    - NMEA: t = utc_s - utc_s đầu tiên + time_offset.
    `time_offset` dùng để đồng bộ GPS với video (PLAN.md mục 3 bước 1).
    """
    if path.lower().endswith((".nmea", ".txt", ".log")):
        df = parse_nmea(path)
        df["t"] = df["utc_s"] - df["utc_s"].iloc[0]
    else:
        df = pd.read_csv(path)
    df["t"] = df["t"].astype(float) + time_offset
    return df.sort_values("t").reset_index(drop=True)
