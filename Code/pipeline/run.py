"""Chạy toàn bộ pipeline: video -> scenario JSON.

Ví dụ:
    python -m pipeline.run --video 1104.mp4 --start 120 --duration 30 \
        --camera data/calib/cam01.yaml --name clip_120 [--gps data/raw/1104.nmea] [--debug-video]

Kết quả trung gian lưu ở work/<name>/: tracks.parquet, ego.parquet, lifted.parquet.
Bước nào đã có file thì bỏ qua (cache). Muốn chạy lại một bước thì dùng
--force detect / ego / all.
"""

from __future__ import annotations

import argparse
import json
import math
import os

import numpy as np
import pandas as pd

from . import detect_track, downed, ego_motion, export, horizon, lift3d, obstacles
from .camera import Camera
from .gps import load_gps
from .video import probe

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--duration", type=float, default=30.0)
    ap.add_argument("--camera", help="file yaml calib; không có thì dùng --fov")
    ap.add_argument("--fov", type=float, default=120.0)
    ap.add_argument("--mount-height", type=float, default=1.35)
    ap.add_argument("--hood-frac", type=float, default=0.0, help="phần đáy ảnh bị nắp capo che (0..0.4)")
    ap.add_argument("--gps", help="CSV (t,lat,lon[,speed,heading]) hoặc NMEA")
    ap.add_argument("--gps-offset", type=float, default=0.0)
    ap.add_argument("--speed-ref", help="CSV t (giây video gốc), speed_kmh: lấy tốc độ từ đây, hướng từ VO")
    ap.add_argument("--straight", action="store_true",
                    help="giả định đường thẳng: hướng ego không đổi (khi yaw của VO bị trôi)")
    ap.add_argument("--name")
    ap.add_argument("--fps", type=float, default=10.0, help="tần số của scenario đầu ra")
    ap.add_argument("--detect-fps", type=float, default=15.0)
    ap.add_argument("--model", default="yolo26x.pt", help="model COCO cho xe/người (ByteTrack)")
    ap.add_argument("--imgsz", type=int, default=1280)
    ap.add_argument("--lanes-left", default="auto", help="số làn bên trái làn ego, hoặc auto (suy từ vị trí xe)")
    ap.add_argument("--lanes-right", default="auto")
    ap.add_argument("--lane-width", type=float, default=3.5)
    ap.add_argument("--horizon", choices=["static", "cars"], default="cars",
                    help="cars: đường chân trời theo frame từ chiều cao ô tô (pipeline/horizon.py)")
    ap.add_argument("--obstacles", action="store_true", help="chạy YOLO26+SAHI của buildphase tìm vật cản tĩnh")
    ap.add_argument("--buildphase", default=os.path.join(ROOT, "..", "buildphase"))
    ap.add_argument("--no-sahi", action="store_true")
    ap.add_argument("--force", choices=["detect", "ego", "obstacles", "all"])
    ap.add_argument("--debug-video", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args(argv)

    name = a.name or f"{os.path.splitext(os.path.basename(a.video))[0]}_{int(a.start)}"
    work = os.path.join(ROOT, "work", name)
    os.makedirs(work, exist_ok=True)
    out = a.out or os.path.join(ROOT, "scenarios", "generated", f"{name}.json")
    info = probe(a.video)

    if a.camera:
        cam = Camera.load(a.camera)
        if (cam.img_w, cam.img_h) != (info["width"], info["height"]):
            cam = cam.scaled(info["width"], info["height"])
    else:
        cam = Camera.from_fov(info["width"], info["height"], a.fov, mount_height=a.mount_height)
        print(f"[warn] Chưa calib: dùng FOV {a.fov}° và pitch 0. Khoảng cách sẽ sai nhiều, nên chạy pipeline.calib trước.")

    # 1) Detect + track
    p_tracks = os.path.join(work, "tracks.parquet")
    if a.force in ("detect", "all") or not os.path.exists(p_tracks):
        print("== detect + track")
        detect_track.run(a.video, work, a.start, a.duration, a.detect_fps, a.model, imgsz=a.imgsz)
    tracks = pd.read_parquet(p_tracks)
    print(f"   {len(tracks)} detections, {tracks.track_id.nunique()} tracks")

    # 2) Ego-motion
    t_grid = np.round(np.arange(0, a.duration + 1e-9, 1.0 / a.fps), 4)
    p_ego = os.path.join(work, "ego.parquet")
    origin = None
    if a.gps:
        print("== ego-motion từ GPS")
        gps = load_gps(a.gps, a.gps_offset - a.start)
        gps = gps[(gps.t >= -2) & (gps.t <= a.duration + 2)]
        ego, origin = ego_motion.from_gps(gps, t_grid)
    else:
        p_vo = os.path.join(work, "vo.parquet")
        if a.force in ("ego", "all", "detect") or not os.path.exists(p_vo):
            print("== ego-motion bằng ground-plane VO")
            vo = ego_motion.visual_odometry(a.video, cam, tracks, a.start, a.duration, hood_frac=a.hood_frac)
            vo.to_parquet(p_vo, index=False)
        vo = pd.read_parquet(p_vo)
        print(f"   VO: ECC cc trung vị {vo.cc.median():.2f}, frame phải nội suy: {(vo.cc == 0).mean()*100:.0f}%")
        if a.straight:
            vo = vo.assign(yaw=0.0)
            print("   --straight: bỏ yaw của VO, giữ hướng ego không đổi")
        if a.speed_ref:
            print("   tốc độ lấy từ --speed-ref, hướng lấy từ VO")
            ego = ego_motion.fuse_speed(vo, ego_motion.load_speed_ref(a.speed_ref, a.start), t_grid)
        else:
            ego = ego_motion.smooth_vo(vo, t_grid)
    ego.to_parquet(p_ego, index=False)
    dist = float(np.sum(np.hypot(np.diff(ego.x), np.diff(ego.y))))
    print(f"   ego: quãng đường {dist:.0f} m, v trung bình {ego.v.mean()*3.6:.1f} km/h")

    # 3) Lift 3D + làm mượt agent
    print("== lift 3D + smoothing")
    hz = None
    if a.horizon == "cars":
        hz = horizon.estimate(tracks, cam, hood_frac=a.hood_frac)
        hz.to_parquet(os.path.join(work, "horizon.parquet"), index=False)
        print(f"   đường chân trời theo frame: {hz.v_hor.min():.0f}..{hz.v_hor.max():.0f} px "
              f"(mặc định {cam.horizon_row:.0f}), {(hz.n > 0).mean()*100:.0f}% frame có xe")
    lifted = lift3d.lift_detections(tracks, cam, ego, hz)
    lifted.to_parquet(os.path.join(work, "lifted.parquet"), index=False)
    agents = lift3d.fix_riders_and_duplicates(lift3d.build_agents(lifted, ego, t_grid))
    lights = lift3d.build_traffic_lights(tracks, cam, ego)
    print(f"   {len(agents)} agents, {len(lights)} đèn giao thông")

    # 3b) Vật cản tĩnh (YOLO26 + SAHI của buildphase)
    static_obs = []
    if a.obstacles:
        p_ob = os.path.join(work, "obstacles.parquet")
        if a.force in ("obstacles", "all") or not os.path.exists(p_ob):
            print("== vật cản tĩnh: YOLO26 + SAHI (buildphase)")
            det = obstacles.load_detector(a.buildphase, sahi=not a.no_sahi)
            obstacles.detect(a.video, cam, ego, hz, a.start, a.duration, hood_frac=a.hood_frac,
                             detector=det).to_parquet(p_ob, index=False)
        static_obs = obstacles.cluster(pd.read_parquet(p_ob))
        print(f"   {len(static_obs)} vật cản tĩnh ({sum(o['hazard'] for o in static_obs)} hazard)")

    # 4) Map + export
    # Lane phải đủ dài để AV chạy hết clip ở tốc độ giới hạn, kể cả khi nó nhanh hơn người lái (B18)
    v_lim = 50 / 3.6
    extend = max(60.0, v_lim * a.duration - dist + 30.0)
    n_left, n_right = export.infer_lane_counts(agents, ego, a.lane_width)
    n_left = n_left if a.lanes_left == "auto" else int(a.lanes_left)
    n_right = n_right if a.lanes_right == "auto" else int(a.lanes_right)
    print(f"   map: {n_left} làn trái + làn ego + {n_right} làn phải")
    lanes = export.build_lanes(ego, a.lane_width, n_left, n_right, extend=extend)
    down = downed.mark_downed(agents, lifted, ego, (n_right + 0.5) * a.lane_width)
    if down:
        print(f"   người/xe ngã trên đường: {down}")
    export.infer_lane_directions(lanes, agents)
    camera_meta = {"image_width": cam.img_w, "image_height": cam.img_h,
                   "height": cam.mount_height, "pitch_deg": round(math.degrees(cam.pitch), 3),
                   "fov_h": round(math.degrees(2 * math.atan(cam.img_w / 2 / cam.fx)), 2),
                   "K": np.round(cam.K, 3).tolist(), "intrinsics": a.camera}
    scn = export.build_scenario(os.path.basename(a.video), ego, agents, lights, lanes, a.fps,
                                origin, a.start, camera_meta)
    scn["static_obstacles"] = static_obs
    export.save(scn, out)
    print(f"== Đã ghi {out}")

    if a.debug_video:
        from .viz import render_debug
        p = os.path.join(work, "debug.mp4")
        render_debug(a.video, scn, lifted, p, a.start, a.duration)
        print(f"== Debug video: {p}")
    with open(os.path.join(work, "summary.json"), "w", encoding="utf-8") as f:
        json.dump({"scenario": out, "agents": len(agents), "lights": len(lights),
                   "ego_distance_m": dist}, f, indent=2)
    return out


if __name__ == "__main__":
    main()
