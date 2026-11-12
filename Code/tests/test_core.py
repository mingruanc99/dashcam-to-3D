import math
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.geometry import Polyline, box_corners, boxes_overlap  # noqa: E402
from pipeline.camera import Camera  # noqa: E402
from pipeline.export import validate  # noqa: E402
from pipeline.gps import LocalENU  # noqa: E402
from pipeline.smoothing import rts_cv  # noqa: E402


def test_camera_ground_roundtrip():
    cam = Camera.from_fov(1920, 1080, 110, mount_height=1.4)
    cam.pitch = math.radians(3)
    pts = np.array([[8.0, 1.5, 0.0], [25.0, -3.0, 0.0], [40.0, 0.0, 0.0]])
    uv, front = cam.project(pts)
    assert front.all()
    g, ok = cam.pixels_to_ground(uv)
    assert ok.all()
    np.testing.assert_allclose(g, pts[:, :2], atol=1e-6)


def test_horizon_pitch():
    cam = Camera.from_fov(1920, 1080, 120)
    cam.pitch = cam.pitch_from_horizon(500)
    assert cam.pitch > 0  # chân trời nằm trên tâm ảnh -> camera chúc xuống
    assert abs(cam.horizon_row - 500) < 1e-6


def test_enu_roundtrip():
    enu = LocalENU(21.0285, 105.8542)
    x, y = enu.to_xy(21.0295, 105.8552)
    lat, lon = enu.to_latlon(x, y)
    assert abs(lat - 21.0295) < 1e-9 and abs(lon - 105.8552) < 1e-9
    assert 100 < x < 110 and 105 < y < 115


def test_rts_recovers_constant_velocity():
    rng = np.random.default_rng(0)
    t = np.arange(0, 10, 0.1)
    truth = np.stack([5 + 8 * t, -1 + 0.5 * t], 1)
    z = truth + rng.normal(0, 0.8, truth.shape)
    z[30:45] = np.nan  # mất detection 1.5 s
    xs, _ = rts_cv(t, z, 0.8**2, q=0.5)
    assert np.sqrt(np.mean((xs[:, :2] - truth) ** 2)) < 0.4
    assert abs(np.median(xs[:, 2]) - 8) < 0.3


def test_polyline_frenet():
    pl = Polyline([[0, 0], [10, 0], [20, 10]])
    s, d, _ = pl.project(5, 2)
    assert abs(s - 5) < 1e-9 and abs(d - 2) < 1e-9
    xy, _ = pl.to_xy([5.0], [2.0])
    np.testing.assert_allclose(xy[0], [5, 2])


def test_box_overlap():
    a = box_corners(0, 0, 0, 4.5, 1.8)
    assert boxes_overlap(a, box_corners(4.0, 0.5, 0.3, 4.5, 1.8))
    assert not boxes_overlap(a, box_corners(6.0, 0, 0, 4.5, 1.8))


@pytest.fixture(scope="module")
def examples():
    from scenarios.handmade.make_examples import jaywalker, lead_brake
    base = lead_brake()
    return base, jaywalker(base)


def test_examples_valid(examples):
    for scn in examples:
        assert validate(scn) == []


@pytest.mark.parametrize("mode", ["M2", "M3"])
def test_av_handles_lead_brake(examples, mode):
    from sim.run import run
    sim, rep = run(examples[0], mode)
    assert rep["safety"]["collisions"] == 0
    assert rep["safety"]["red_light_violations"] == 0
    assert rep["progress"]["ratio"] > 0.9


def test_av_stops_for_jaywalker(examples):
    from sim.run import run
    sim, rep = run(examples[1], "M4")
    assert rep["safety"]["collisions"] == 0
    v_near = [r["v"] for r in sim.log if 95 < r["x"] < 120]
    assert min(v_near) < 0.5 * 12.0  # phải thật sự giảm tốc vì người đi bộ, không thì scenario vô nghĩa (B13)


def test_npc_triggers_on_gap_not_time():
    from scenarios.handmade.make_examples import cut_in
    from sim.director import Director
    scn = cut_in(gap=12.0)
    for ego_v in (11.5, 13.9):  # phải nhanh hơn xe kia (10 m/s) thì mới đuổi tới
        d = Director(scn["npcs"], scn["map"]["lanes"])
        a = d.agents[0]
        x, t = 0.0, 0.0
        while a.idx == 0 and t < 60:
            d.step(t, 0.05, {"x": x, "y": 0.0, "yaw": 0.0, "v": ego_v})
            x += ego_v * 0.05
            t += 0.05
        assert abs((a.s - a.line.project(x, 0.0)[0]) - 12.0) < 1.0  # ego nhanh hay chậm thì xe vẫn tạt ở đúng khoảng cách


def test_params_and_reaction_delay():
    from av_stack import AVStack
    from av_stack.stack import PRESETS
    av = AVStack()
    av.set_params(preset="than_trong")
    assert av.lon.p.time_gap == PRESETS["than_trong"]["longitudinal.time_gap"]
    av.set_params(preset="binh_thuong")
    assert av.lon.p.time_gap == 1.6
    av.set_params({"longitudinal.time_gap": 99})
    assert av.lon.p.time_gap == 3.0  # bị kẹp theo max
    av.set_params({"reaction_delay": 0.5})
    assert av._delayed(0.0, {"objects": ["a"]})[0] == ["a"]
    assert av._delayed(0.25, {"objects": ["b"]})[0] == ["a"]
    assert av._delayed(0.5, {"objects": ["c"]})[0] == ["a"]
    assert av._delayed(0.75, {"objects": ["d"]})[0] == ["b"]
