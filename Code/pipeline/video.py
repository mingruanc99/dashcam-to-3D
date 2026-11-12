"""Đọc video bằng PyAV: xem thông tin và lấy frame theo khoảng thời gian/FPS."""

from __future__ import annotations

from typing import Iterator

import av
import numpy as np


def probe(path: str) -> dict:
    """Thông tin cơ bản và danh sách stream (để tìm GPS nhúng trong file)."""
    with av.open(path) as c:
        v = c.streams.video[0]
        fps = float(v.average_rate) if v.average_rate else 30.0
        duration = float(c.duration / av.time_base) if c.duration else None
        streams = [
            {"index": s.index, "type": s.type,
             "codec": getattr(s.codec_context, "name", None) if s.codec_context else None,
             "metadata": dict(s.metadata)}
            for s in c.streams
        ]
        return {
            "width": v.codec_context.width,
            "height": v.codec_context.height,
            "fps": fps,
            "frames": v.frames,
            "duration": duration,
            "format_metadata": dict(c.metadata),
            "streams": streams,
        }


def iter_frames(path: str, start: float = 0.0, duration: float | None = None,
                fps: float | None = None, width: int | None = None
                ) -> Iterator[tuple[int, float, np.ndarray]]:
    """Trả về lần lượt (index, t, ảnh BGR), với t tính bằng giây kể từ `start`.

    fps=None lấy mọi frame. width khác None thì resize, giữ nguyên tỉ lệ.
    """
    with av.open(path) as c:
        v = c.streams.video[0]
        v.thread_type = "AUTO"
        if start > 0:
            c.seek(int(start / v.time_base), stream=v, backward=True, any_frame=False)
        end = None if duration is None else start + duration
        next_t = start
        idx = 0
        for frame in c.decode(v):
            if frame.pts is None:
                continue
            ts = float(frame.pts * v.time_base)
            if ts < start - 1e-3:
                continue
            if end is not None and ts > end:
                break
            if fps is not None:
                if ts + 1e-6 < next_t:
                    continue
                next_t += 1.0 / fps
                while next_t <= ts:
                    next_t += 1.0 / fps
            if width is not None and width != frame.width:
                h = int(round(frame.height * width / frame.width / 2)) * 2
                frame = frame.reformat(width=width, height=h)
            yield idx, ts - start, frame.to_ndarray(format="bgr24")
            idx += 1
