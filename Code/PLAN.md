# Dashcam → Unity: Real-to-Sim cho xe tự hành

> **Ý tưởng:** lấy video camera hành trình, "dịch" thành một kịch bản có cấu trúc (map + agent + quỹ đạo + đèn giao thông), dựng lại trong Unity bằng **thư viện model 3D cố định cho từng class object**, rồi thả **xe tự hành của mình** vào chạy **closed-loop**: xe tự quyết định, thế giới quanh nó phản ứng lại.
>
> **Nguyên tắc:** hạn chế tối đa VLM/AIGC. Dùng model chuyên dụng (detection, tracking, depth, odometry) để kết quả **chạy lại ra y hệt, debug được, chạy nhanh**.

Ngày tạo: 2026-10-29 · Trạng thái: **Draft v0.1**

---

## Mục lục
1. [Mục tiêu & phạm vi](#1-mục-tiêu--phạm-vi)
2. [Kiến trúc tổng thể](#2-kiến-trúc-tổng-thể)
3. [Perception pipeline: video → scenario](#3-perception-pipeline-video--scenario)
4. [Định dạng scenario](#4-định-dạng-scenario)
5. [Unity simulator](#5-unity-simulator)
6. [Chế độ chạy](#6-chế-độ-chạy)
7. [Tích hợp AV stack](#7-tích-hợp-av-stack)
8. [Metrics & đánh giá](#8-metrics--đánh-giá)
9. [Chế độ live / near-live](#9-chế-độ-live--near-live)
10. [Tech stack](#10-tech-stack)
11. [Cấu trúc repo đề xuất](#11-cấu-trúc-repo-đề-xuất)
12. [Lộ trình](#12-lộ-trình)
13. [Rủi ro & giảm thiểu](#13-rủi-ro--giảm-thiểu)
14. [Câu hỏi mở](#14-câu-hỏi-mở)
15. [Checklist nghiên cứu](#15-checklist-nghiên-cứu)
16. [Tài liệu tham khảo](#16-tài-liệu-tham-khảo)

---

## 1. Mục tiêu & phạm vi

### Mục tiêu
- **G1:** Từ một video dashcam (kèm GPS nếu có), tự động sinh ra kịch bản 3D có cấu trúc gồm đường, làn, các agent với quỹ đạo theo thời gian, và trạng thái đèn.
- **G2:** Unity load kịch bản, spawn **prefab cố định theo class**, phát lại cảnh khớp với video gốc.
- **G3:** AV stack của mình điều khiển ego trong sim như xe thật: nhận sensor giả lập, gửi lệnh lái/ga/phanh.
- **G4:** Môi trường **phản ứng** lại khi ego hành xử khác người lái thật.
- **G5:** Mở rộng được: chỉnh sửa hoặc tự thêm kịch bản, chạy near-live, VR/tương tác người thật.

### Ngoài phạm vi (giai đoạn đầu)
- Tái tạo hình ảnh photoreal (neural rendering, AIGC).
- Đêm, mưa, sương mù.
- Đa camera 360°. Trước mắt chỉ cam trước, có cam sau thì dùng thêm.

### Định nghĩa "MVP chạy được"
> Một clip **khoảng 30 s, ban ngày, đường tương đối thẳng, mật độ vừa** → JSON scenario → Unity replay khớp video (xem song song bằng mắt) → AV stack tự chạy hết clip ở chế độ closed-loop non-reactive và xuất được bảng metrics.

---

## 2. Kiến trúc tổng thể

```
┌──────────────┐   ┌───────────────────────────────┐   ┌──────────────────┐   ┌─────────────────────┐
│ Dashcam      │   │ PERCEPTION PIPELINE (Python)  │   │ SCENARIO FORMAT  │   │ UNITY SIM           │
│ video + GPS  │──▶│ calib → detect → track →      │──▶│ (JSON/OpenSCEN.) │──▶│ spawn prefab theo   │
│ (+IMU nếu có)│   │ depth → ego-motion → lift 3D  │   │ map + agents +   │   │ class, replay/react │
└──────────────┘   │ → smooth quỹ đạo → map        │   │ timeline         │   │ + sensor giả lập    │
                   └───────────────────────────────┘   └──────────────────┘   └──────────┬──────────┘
                                                                                         │ ROS2 / gRPC
                                                       ┌──────────────────┐   ┌──────────▼──────────┐
                                                       │ METRICS & REPLAY │◀──│ AV STACK            │
                                                       │ va chạm, TTC,    │   │ perception→planning │
                                                       │ jerk, luật, ...  │   │ → control           │
                                                       └──────────────────┘   └─────────────────────┘
```

**Quyết định kiến trúc chính:** tách **pipeline (video → scenario)** khỏi **simulator (scenario → Unity)** bằng một định dạng trung gian. Lợi ích:
- Kịch bản thu từ video và kịch bản tự viết tay dùng chung một format.
- Debug được từng nửa riêng biệt.
- Muốn đổi simulator (CARLA, esmini) thì vẫn dùng lại được pipeline.

---

## 3. Perception pipeline: video → scenario

| # | Bước | Việc cần làm | Tech đề xuất |
|---|---|---|---|
| 0 | **Calibration** | Intrinsics và méo ống kính (dashcam thường góc rộng/fisheye), chiều cao và pitch/roll camera | OpenCV checkerboard (`cv2.calibrateCamera` / `cv2.fisheye`), đo tay chiều cao lắp |
| 1 | **Decode & sync** | Tách frame, đọc GPS (NMEA nhúng trong file hoặc `.gpx`/`.nmea` riêng), đồng bộ timestamp | FFmpeg, PyAV, exiftool, parser riêng theo hãng dashcam |
| 2 | **Detection 2D** | car, truck, bus, **motorbike**, bicycle, pedestrian, traffic light, traffic sign | YOLO11 / RT-DETR, fine-tune data giao thông VN nếu cần |
| 3 | **Tracking** | Gán ID ổn định qua frame | ByteTrack / BoT-SORT (có sẵn trong Ultralytics), thêm re-ID nếu ID switch nhiều |
| 4 | **Depth** | Khoảng cách metric | Depth Anything V2 (metric), UniDepth, Metric3D v2 |
| 5 | **Ego-motion** | Quỹ đạo ego (x, y, yaw, v) | GPS + visual odometry (DPVO / ORB-SLAM3), fuse bằng EKF. Offline thì dùng COLMAP/GLOMAP |
| 6 | **Lift 2D → 3D** | Vị trí, hướng và kích thước 3D trên mặt đường | Điểm chạm đất đáy box + ground plane + **kích thước chuẩn theo class**, kiểm chéo bằng depth. Nâng cấp sau: mono-3D detector |
| 7 | **Smoothing** | Khử nhiễu, tính heading/vận tốc, nối track đứt | RTS smoother: bicycle model cho xe, constant-velocity cho người |
| 8 | **Map tĩnh** | Làn, mép đường, vạch, biển báo | Lane detection (CLRNet / UFLD v2) + road segmentation (SegFormer) + **OpenStreetMap** theo GPS |
| 9 | **Đèn giao thông** | Trạng thái theo thời gian | Classifier nhỏ trên crop đèn |
| 10 | **Export** | Ghi scenario | JSON schema riêng, sau đó export OpenDRIVE + OpenSCENARIO |

### Kích thước chuẩn theo class (khởi điểm, sẽ tinh chỉnh)
| Class | D × R × C (m) |
|---|---|
| car | 4.5 × 1.8 × 1.5 |
| suv | 4.8 × 1.9 × 1.7 |
| truck | 7.5 × 2.4 × 3.0 |
| bus | 11.0 × 2.5 × 3.2 |
| motorbike (kèm người) | 1.9 × 0.7 × 1.5 |
| bicycle | 1.7 × 0.6 × 1.6 |
| pedestrian | 0.5 × 0.5 × 1.7 |

### Công cụ debug pipeline
- **Rerun** (`rerun.io`): xem frame, box 2D, box 3D, quỹ đạo và point cloud depth trên cùng một timeline. Cực kỳ quan trọng để biết pipeline sai ở bước nào.

---

## 4. Định dạng scenario

Hệ tọa độ: **ENU cục bộ, đơn vị mét**, gốc tại vị trí ego ở t = 0. Thời gian tính bằng giây.

```json
{
  "schema_version": "0.1",
  "meta": {
    "source": "dashcam_2026-10-20_0815.mp4",
    "origin_gps": [21.0285, 105.8542],
    "fps": 10,
    "duration": 30.0,
    "camera": {"height": 1.35, "fov_h": 120, "intrinsics": "calib/cam01.yaml"}
  },
  "map": {
    "lanes": [{"id": "l1", "centerline": [[0,0],[50,0.4]], "width": 3.5, "left": "l2", "right": null}],
    "road_edges": [...],
    "signs": [{"type": "speed_limit_50", "pos": [40, 6]}]
  },
  "ego": {
    "size": [4.5, 1.8, 1.5],
    "trajectory": [{"t": 0.0, "x": 0, "y": 0, "yaw": 0, "v": 8.2}]
  },
  "agents": [
    {
      "id": 17, "class": "motorbike", "variant": 2, "size": [1.9, 0.7, 1.5],
      "trajectory": [{"t": 0.0, "x": 12.3, "y": -1.5, "yaw": 0.02, "v": 7.1}],
      "confidence": 0.86,
      "behavior": {"mode": "log_replay", "reactive_fallback": "idm"}
    }
  ],
  "traffic_lights": [
    {"id": "tl_1", "pos": [60, 5, 4.5], "states": [[0.0, "red"], [14.2, "green"]]}
  ],
  "events": []
}
```

Ghi chú:
- `events`: chỗ để **chèn kịch bản thêm** (jaywalker, cut-in, xe chết máy...), không đụng vào dữ liệu log.
- Validate bằng **JSON Schema** (Python `jsonschema` + C# ở phía Unity).
- Về sau map sang **OpenSCENARIO 1.x / OpenDRIVE** để tương thích hệ sinh thái (esmini, CARLA).

---

## 5. Unity simulator

- **Engine:** Unity 6 LTS. Chọn **HDRP** nếu cần camera giả lập đẹp, **URP** nếu ưu tiên nhẹ và làm VR.
- **Nền tảng nên fork hoặc tham khảo:** **AWSIM** (TIER IV): sim xe tự hành viết bằng Unity, mã nguồn mở, có sẵn ROS2, camera/LiDAR giả lập, vehicle dynamics, NPC traffic.

| Module | Nội dung |
|---|---|
| **Asset Library** | Một prefab cố định cho mỗi class + vài biến thể màu/kiểu. Pivot tại tâm trục sau, kích thước chuẩn hóa theo bảng mục 3. Nguồn: Blender, Asset Store, Sketchfab (CC) |
| **Road Builder** | Sinh mesh đường từ `map.lanes` / OSM lúc runtime (spline mesh), hoặc EasyRoads3D / RoadArchitect |
| **Scenario Player** | Đọc JSON, spawn agent, nội suy quỹ đạo (Hermite/Catmull-Rom) theo thời gian sim, quản lý agent xuất hiện/biến mất |
| **Agent Brain** | Máy trạng thái `log_replay` ↔ `reactive` (IDM / MOBIL / social force) |
| **Ego Vehicle** | Vật lý thật: WheelCollider, hoặc NWH Vehicle Physics 2 / Edy's Vehicle Physics. Nhận lệnh steer/throttle/brake |
| **Sensors** | Camera (đặt đúng vị trí và FOV dashcam gốc), LiDAR raycast, GNSS/IMU giả lập, ground-truth objects |
| **Bridge** | ROS2 For Unity (latency thấp, AWSIM dùng) hoặc ROS-TCP-Connector, hoặc gRPC |
| **Ghost View** | Phát video gốc song song hoặc overlay để so sim với thực tế |
| **Recorder** | Ghi toàn bộ state ra MCAP |
| **VR / Interaction** | OpenXR + XR Interaction Toolkit: đóng vai người đi bộ, hoặc lái một xe khác |

---

## 6. Chế độ chạy

| Mode | Ego | Agent khác | Dùng để |
|---|---|---|---|
| **M1: Open-loop replay** | Đi theo log | Theo log | So quyết định AV với người lái thật, test perception |
| **M2: Closed-loop non-reactive** | AV điều khiển | Theo log | Test planning/control cơ bản |
| **M3: Closed-loop reactive** | AV điều khiển | Log, chuyển sang IDM/MOBIL khi cần | **Đánh giá thực tế**, chế độ chính |
| **M4: Augmented** | AV điều khiển | Log + mutate + chèn event | Stress test, sinh tình huống hiếm |
| **M5: Human-in-the-loop** | AV điều khiển | + người thật qua VR/vô lăng | Tương tác, demo |

### Logic chuyển `log_replay → reactive` (M3)
Agent chuyển sang reactive khi thỏa một trong các điều kiện:
- Khoảng cách tới ego nhỏ hơn quỹ đạo log tới ego log một ngưỡng (ví dụ lệch > 2 m).
- TTC tới ego < ngưỡng (ví dụ 3 s).
- Agent ở phía sau ego trên cùng làn và ego chậm hơn ego log.

Đã chuyển sang reactive thì **không quay lại** log, để tránh teleport.

> ⚠️ **Vùng mù:** cam trước không thấy phía sau và hai bên. Có ba lựa chọn: (a) dùng cam sau nếu có, (b) sinh agent phía sau theo luật đơn giản, (c) chấp nhận và ghi chú trong metrics.

---

## 7. Tích hợp AV stack

- **Giao tiếp:** ROS2 Humble hoặc Jazzy (chuẩn ngành, dễ chuyển lên xe thật). Stack không dùng ROS thì dùng gRPC hoặc ZeroMQ.
- **Thời gian:** sim publish `/clock`, AV dùng `use_sim_time`. Có chế độ **lockstep** (sim chờ AV) để chạy lại ra kết quả y hệt.
- **Topic tối thiểu (gợi ý):**
  - Sim → AV: `/sensing/camera/front/image_raw`, `/sensing/gnss/pose`, `/sensing/imu`, `/vehicle/status/velocity`, `/sim/ground_truth/objects`
  - AV → Sim: `/control/command` (steer, throttle, brake hoặc accel), `/planning/trajectory` (để visualize)
- **Hai mức perception cho AV:**
  1. **Ground truth** từ sim: cô lập và test planning/control.
  2. **Camera render**: test toàn bộ pipeline. Có domain gap vì model 3D cố định trông khác ảnh thật.
- **Baseline để so sánh:** Frenet/lattice planner + IDM + Pure Pursuit/Stanley/MPC (CasADi, acados), hoặc Autoware.

---

## 8. Metrics & đánh giá

| Nhóm | Metric |
|---|---|
| An toàn | Số va chạm, TTC min, khoảng cách min, vượt đèn đỏ, đi sai làn / lấn vạch |
| Tiến độ | % quãng đường hoàn thành, thời gian so với người lái thật |
| Comfort | Gia tốc dọc/ngang max, jerk, tần suất phanh gấp |
| Giống người | ADE/FDE so với quỹ đạo ego log (chế độ M1/M2) |
| Hệ thống | Latency AV stack, tần số control, số frame drop |

- Tổng hợp thành điểm kiểu **nuPlan closed-loop score**.
- Mỗi lần chạy xuất `report.json` + MCAP, xem lại bằng **Foxglove Studio**.
- Bộ **regression test**: một tập scenario cố định, chạy lại mỗi khi sửa thuật toán.

---

## 9. Chế độ live / near-live

Live thật 100% khó, vì muốn quỹ đạo mượt thì tracker cần nhìn thêm vài frame tương lai. Nên đi theo hai bước:

1. **Offline trước:** xử lý cả clip rồi mới chạy sim. Chính xác nhất, dùng cho toàn bộ P1–P5.
2. **Near-live với buffer khoảng 2–3 s:**
   ```
   Dashcam/điện thoại ──RTSP/WebRTC──▶ GPU server (TensorRT: YOLO + track + depth)
        ──▶ fixed-lag smoother (2–3 s) ──WebSocket/ROS2──▶ Unity (chạy trễ ~3 s)
   ```
   - Perception mục tiêu: ≥ 15 FPS ở 720p.
   - GPU: RTX 3060–4070 trở lên sau khi export ONNX → TensorRT.
   - Agent mới xuất hiện được spawn dần (fade-in) để tránh pop-in.

---

## 10. Tech stack

| Lớp | Công cụ |
|---|---|
| Ngôn ngữ | Python 3.11+ (pipeline), C# (Unity), C++/Python (AV stack) |
| Video | FFmpeg, PyAV, GStreamer (live) |
| Detection / tracking | Ultralytics YOLO11 + ByteTrack / BoT-SORT, RT-DETR |
| Depth | Depth Anything V2 (metric), UniDepth, Metric3D v2 |
| Lane / road | CLRNet, UFLD v2, SegFormer |
| Ego-motion | GPS + DPVO / ORB-SLAM3, FilterPy (EKF/RTS), COLMAP / GLOMAP |
| Map | OSMnx, OpenDRIVE (libOpenDRIVE), Lanelet2 (nếu dùng Autoware) |
| Scenario | JSON Schema, scenariogeneration (OpenSCENARIO), esmini để verify |
| Inference | PyTorch → ONNX → TensorRT |
| Debug viz | Rerun, Foxglove Studio |
| Simulator | Unity 6 LTS, HDRP/URP, AWSIM (tham khảo/fork), NWH Vehicle Physics 2 |
| Bridge | ROS2 Humble/Jazzy + ROS2 For Unity / ROS-TCP-Connector, hoặc gRPC |
| AV baseline | Autoware hoặc tự viết (Frenet + IDM + Pure Pursuit/MPC), CasADi / acados |
| VR | OpenXR, XR Interaction Toolkit, Meta Quest 3 (Link) |
| Logging | MCAP, rosbag2 |
| Infra | Docker, Git + Git LFS (asset), DVC (video/data), uv/conda |

---

## 11. Cấu trúc repo đề xuất

```
adastest/
├── PLAN.md
├── data/                    # DVC-tracked: video thô, GPS, calib
│   ├── raw/
│   └── calib/
├── pipeline/                # Python: video → scenario
│   ├── calib/
│   ├── detect_track/
│   ├── depth/
│   ├── ego_motion/
│   ├── lift3d/
│   ├── smoothing/
│   ├── mapping/
│   ├── export/
│   └── viz/                 # Rerun viewers
├── scenarios/
│   ├── schema/scenario.schema.json
│   ├── generated/           # từ pipeline
│   └── handmade/            # tự viết / augmented
├── unity/                   # Unity project
│   └── Assets/
│       ├── Prefabs/Agents/  # car, motorbike, truck, ...
│       ├── Scripts/Scenario/
│       ├── Scripts/Agents/
│       ├── Scripts/Ego/
│       ├── Scripts/Sensors/
│       └── Scripts/Bridge/
├── av_stack/                # ROS2 workspace của xe tự hành
├── eval/                    # metrics, report, regression suite
└── docker/
```

---

## 12. Lộ trình

Ước lượng cho 1 người làm part-time/full-time vừa phải.

| Phase | Mục tiêu | Thời gian | Tiêu chí hoàn thành |
|---|---|---|---|
| **P0: Data & research** | Hoàn thành checklist mục 15, thu 10–20 clip đa dạng, calib camera, lấy được GPS | 1–2 tuần | Có dataset + `intrinsics.yaml` + GPS parse được |
| **P1: Pipeline v1** | Detect + track + lift 3D + ego-motion + smoothing → JSON | 4–6 tuần | Xem trong Rerun thấy box 3D và quỹ đạo khớp video |
| **P2: Unity replay** | Load JSON, spawn prefab, road mesh, ghost view | 3–4 tuần | Sim chạy song song video thấy khớp |
| **P3: Closed-loop** | Ego vật lý + ROS2 bridge + AV điều khiển (M2) | 3–4 tuần | **MVP**: AV tự chạy hết clip |
| **P4: Reactive + metrics** | Agent Brain (IDM/MOBIL), metrics, report | 3 tuần | Có bảng điểm cho mỗi lần chạy (M3) |
| **P5: Scenario editor** | Mutate, chèn event, random hóa | liên tục | Từ 1 clip sinh được N biến thể (M4) |
| **P6: Near-live** | Streaming + TensorRT + fixed-lag smoother | 3–4 tuần | Sim trễ ≤ 3 s so với dashcam |
| **P7: VR / HIL** | Người thật tương tác | 2–3 tuần | Đi bộ băng qua đường trước xe AV trong VR (M5) |

### Task chi tiết P1 (bắt đầu từ đây)
- [ ] Script calib camera → `data/calib/cam01.yaml`
- [ ] Parser GPS theo hãng dashcam → CSV `t, lat, lon, speed, heading`
- [ ] Chạy YOLO11 + ByteTrack → `tracks.parquet` (frame, id, class, bbox, score)
- [ ] Ước lượng ground plane từ calib + road segmentation
- [ ] Lift 3D: đáy box → ray → giao ground plane, kiểm chéo với depth
- [ ] Ego-motion: GPS → ENU + VO, fuse EKF
- [ ] Chuyển agent sang world frame, RTS smoother
- [ ] Export JSON + validate schema
- [ ] Viewer Rerun cho toàn bộ chuỗi

---

## 13. Rủi ro & giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Depth monocular sai ở xa (> 40 m) | Cao | Chỉ tin agent trong khoảng 50 m, ưu tiên ground-plane + kích thước chuẩn, gắn `confidence` |
| Xe máy dày đặc, che khuất, đổi ID | Cao | Fine-tune detector, tracker có re-ID, nối track offline |
| Log và ego lệch nhau trong closed-loop | Cao | Agent Brain chuyển sang reactive (mục 6) |
| Vùng mù phía sau/hai bên | TB | Cam sau, sinh agent theo luật, hoặc ghi chú trong metrics |
| Heading xe máy/người khó đoán | TB | Suy ra từ hướng vận tốc sau khi làm mượt |
| Đường dốc, ground plane không phẳng | TB | Ước lượng pitch theo frame từ VO, giai đoạn đầu chọn đường phẳng |
| Map OSM lệch với video | TB | Lane detection để tinh chỉnh, cho phép sửa tay trong editor |
| Đêm, mưa, lóa | TB | Ngoài phạm vi giai đoạn đầu |
| Domain gap render vs thật | TB | Test planning bằng ground truth trước. Cân nhắc 3D Gaussian Splatting cho nền (tái dựng, không phải AIGC) |
| Scope quá rộng | Cao | Bám MVP, không làm P6/P7 trước khi P4 xong |

---

## 14. Câu hỏi mở

- [ ] Dashcam là hãng/model gì? Có **GPS** không? Có **cam sau** không? Độ phân giải, FPS, FOV?
- [ ] AV stack hiện viết bằng gì? Có dùng **ROS2** chưa? Input mong đợi là camera thô hay object list?
- [ ] Quay ở **Việt Nam** (nhiều xe máy)? Loại đường chủ yếu: nội đô, quốc lộ, cao tốc?
- [ ] Máy có **GPU** gì? Chạy Windows hay cần Linux (ROS2 chạy Linux/WSL2 thuận hơn)?
- [ ] Mục tiêu cuối là nghiên cứu, demo, hay hướng tới chạy trên xe thật?
- [ ] Dùng HDRP hay URP? (phụ thuộc vào việc có làm VR sớm không)
- [ ] Fork AWSIM hay tự xây từ đầu?

---

## 15. Checklist nghiên cứu

### Data & camera
- [ ] Format GPS/metadata của dashcam đang dùng (NMEA nhúng, GPMF, file riêng)
- [ ] Calib camera fisheye với OpenCV, chọn model méo phù hợp
- [ ] Dataset giao thông VN hoặc châu Á có xe máy để fine-tune (tìm dataset công khai và license)

### Perception
- [ ] So sánh YOLO11 và RT-DETR trên clip của mình (mAP thô, FPS)
- [ ] ByteTrack vs BoT-SORT vs OC-SORT trên cảnh xe máy đông
- [ ] So sánh model metric depth: Depth Anything V2 metric, UniDepth, Metric3D v2 (sai số ở 10/30/50 m)
- [ ] Mono-3D detection có sẵn (cân nhắc cho phase sau)
- [ ] Lane detection: CLRNet vs UFLD v2 trên đường VN (vạch mờ, không có vạch)
- [ ] Visual odometry: DPVO vs ORB-SLAM3 monocular, cách fuse với GPS

### Map & scenario
- [ ] OSMnx: lấy hình học đường theo GPS, chuyển sang ENU
- [ ] OpenDRIVE và OpenSCENARIO 1.x: cấu trúc tối thiểu, thư viện Python `scenariogeneration`, esmini
- [ ] Lanelet2 (nếu dùng Autoware)

### Simulator
- [ ] Đọc source **AWSIM**: cấu trúc scene, NPC traffic, sensor, bridge ROS2
- [ ] ROS2 For Unity vs ROS-TCP-Connector: latency, hỗ trợ Windows
- [ ] Vehicle physics: WheelCollider vs NWH VP2 vs Edy's
- [ ] Sinh road mesh từ spline lúc runtime trong Unity
- [ ] Asset xe máy/xe VN: nguồn, license, poly count

### Hành vi agent & AV
- [ ] IDM, MOBIL, social force: công thức và tham số
- [ ] Cách nuPlan / Waymax xử lý reactive agents và closed-loop metrics
- [ ] Frenet planner, Pure Pursuit, Stanley, MPC (CasADi/acados)

### Live & VR
- [ ] Export TensorRT cho YOLO + depth, đo FPS thực tế
- [ ] Fixed-lag smoother cho tracking near-live
- [ ] OpenXR + XR Interaction Toolkit, Quest Link trên Windows

---

## 16. Tài liệu tham khảo

- **AWSIM** (TIER IV): Unity simulator cho Autoware, `github.com/tier4/AWSIM`
- **Autoware**: `autoware.org`
- **nuPlan**: closed-loop planning benchmark & metrics, `nuplan.org`
- **Waymax**: sim dựa trên log của Waymo, reactive agents, `github.com/waymo-research/waymax`
- **Ultralytics YOLO**: `docs.ultralytics.com`
- **Depth Anything V2**: `github.com/DepthAnything/Depth-Anything-V2`
- **UniDepth**: `github.com/lpiccinelli-eth/UniDepth`
- **DPVO**: `github.com/princeton-vl/DPVO`
- **ORB-SLAM3**: `github.com/UZ-SLAMLab/ORB_SLAM3`
- **OpenSCENARIO / OpenDRIVE** (ASAM): `asam.net`
- **esmini**: `github.com/esmini/esmini`
- **Rerun**: `rerun.io`
- **Foxglove Studio / MCAP**: `foxglove.dev`, `mcap.dev`
- **ROS2 For Unity**: `github.com/RobotecAI/ros2-for-unity`

> Link và trạng thái các repo cần kiểm tra lại khi research (mục 15).
