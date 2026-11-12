# Package Unity: nên dùng gì cho adastest

Nguồn: `C:\Users\Admin\Downloads\unity-20261104T145454Z-1-001.zip` (1.7 GB, 11 file). Project: `C:\Users\Admin\adastest` (Unity 6000.6.8f1, URP 17.6).

## Lưu ý định dạng
Các file `*.unitypackage.gz` **thực chất là `.unitypackage`**. Định dạng unitypackage vốn đã là tar nén gzip, chỉ bị gắn thêm đuôi `.gz`.
**Đừng gunzip.** Chỉ cần giải nén file đó ra khỏi zip rồi **đổi tên bỏ `.gz`**. Sau đó trong Unity: *Assets → Import Package → Custom Package…*

## Nên dùng / không dùng

| Package | Dùng cho | Khuyến nghị |
|---|---|---|
| **Realistic Car Controller Pro v3.1.0 LTS** | **Ego vehicle** (PLAN mục 5: vật lý thật, WheelCollider). Xe mẫu dùng làm prefab cho `car`/`suv` | ✅ **Import đầu tiên.** Chỉ lấy bản **3.1.0**, bỏ bản 3.0.0 (trùng) |
| Racing Creator 3 URP v3.2 | Công cụ dựng đường đua và môi trường (đường, rào, cây). Có thể dùng làm Road Builder | 🟡 Để sau. Nặng 650 MB và có hệ xe riêng dễ xung đột với RCC. Nên import vào **project nháp** trước, chỉ lấy mesh và material đường |
| AR VR Mixed Reality v4.0, VR UI Package 1.1 | M5 / P7 (người thật tương tác qua VR) | ⏸ Chưa dùng (PLAN: không làm P6/P7 trước khi P4 xong). Có 2 bản AR VR trùng nhau |
| Obi Rope / Cloth / Softbody | Dây, vải, vật mềm | ❌ Không liên quan đến dự án này |
| PoseDetection Interface v1.0.0 | | ⚠️ **File rỗng (0 byte)** trong zip, cần tải lại nếu cần |

## Thứ tự import an toàn
1. **Backup project trước**: `git init` + Git LFS cho asset nặng, hoặc copy thư mục. Package lớn có thể đè `ProjectSettings` (Input, Tags/Layers, Physics).
2. Thêm `com.unity.nuget.newtonsoft-json` (Package Manager → Add package by name) để đọc scenario JSON.
3. Import **RCC Pro 3.1.0**. Nếu báo lỗi Input System, vào *Project Settings → Player → Active Input Handling = Both* (project đang dùng Input System 1.20).
4. Mở demo scene của RCC, chạy thử một xe bằng bàn phím, ghi lại tên component điều khiển input. Ta sẽ thay input bàn phím bằng lệnh `steer`/`accel` từ `bridge/tcp_server.py`.
   Tham số của RCC phải map được sang lệnh của AV: `accel > 0` thành throttle, `accel < 0` thành brake, `steer` (rad, góc bánh) thành steer chuẩn hóa = `steer / maxSteerAngle`.
   Tớ chưa kiểm tra API của RCC 3.1. Khi cậu import xong thì gửi tớ tên script input của nó, tớ viết lớp chuyển đổi.
5. Racing Creator thì để sau, khi làm Road Builder (P2).

## Dữ liệu mẫu đã chép vào project (`Assets/StreamingAssets/`)
| File | Nội dung |
|---|---|
| `clip02.mp4` | Video gốc, cắt từ `1104.mp4` đoạn 29.6–50.6 s, 1920×1080, 30 fps, H.264, không có tiếng. **t = 0 của video trùng t = 0 của scenario** |
| `clip02.json` | Scenario sinh từ video đó (yolo26x, 37 agent, 3 làn, `l_L1` ngược chiều) |
| `clip02_debug.mp4` | Video debug của pipeline: box + khoảng cách bên trái, BEV bên phải. Dùng để so với cảnh Unity |
| `lead_brake.json`, `jaywalker.json` | Scenario viết tay (dùng cho B12, xem `UNITY_B12.md`) |

**Ghost View** (PLAN mục 5): tạo một `RawImage` ở góc màn hình + component `VideoPlayer` (Render Mode = Render Texture, URL = `Path.Combine(Application.streamingAssetsPath, "clip02.mp4")`).
Mỗi bước sim gán `videoPlayer.time = t_sim` (hoặc `frame = round(t·30)`) để video luôn khớp với sim, kể cả khi đang lockstep với Python.
Đặt camera Unity đúng vị trí dashcam: cao `meta.camera.height` (1.3 m), pitch `meta.camera.pitch_deg`, FOV dọc `2·atan(H/2/fy)`.
Như vậy hai hình có thể xếp chồng lên nhau để so trực tiếp.
