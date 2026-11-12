# Toàn bộ hệ thống adastest: làm gì, làm thế nào, tại sao

Tài liệu này giải thích hệ thống tính đến 09/11/2026. Lịch sử lỗi và công thức chi tiết nằm ở `docs/BUG_LOG.md` (ký hiệu B01, B02...).

Một repo `C:\Users\Admin\Downloads\adastest` gồm hai thư mục (gộp ngày 12/11/2026; trước đó Unity nằm ở `C:\Users\Admin\adastest`):
- `Code/`: Python (pipeline, AV, sim 2D, bridge, tài liệu). Mọi lệnh `python -m ...` chạy từ đây.
- `Unity/`: project Unity 6000.6.8f1, URP (code ở `Assets/Scripts/Adas/`).

---

## 1. Bức tranh chung

```
Video dashcam
   │  pipeline/  (detect, track, tính ego-motion, nâng 2D lên 3D, làm mượt, sinh map)
   ▼
scenario.json  ←── scenarios/handmade/ (kịch bản viết tay)
   │
   ├──▶ sim/ (sim 2D Python: nhanh, tất định, không có hình)
   │        └── gọi trực tiếp av_stack/
   │
   └──▶ Unity (ScenarioPlayer: đường, xe, cảm biến, vật lý RCC)
            └── TCP, mỗi dòng một JSON ──▶ bridge/tcp_server.py ──▶ av_stack/
                                                            │
                              lệnh steer + accel  ◀─────────┘
```

Ý tưởng quan trọng nhất là **file scenario đứng giữa**. Pipeline không biết gì về Unity, Unity không biết gì về YOLO. Muốn đổi detector hay đổi simulator thì chỉ sửa một phía.

| Thành phần | Trách nhiệm |
|---|---|
| `pipeline/` | Video → scenario |
| `scenarios/schema/scenario.schema.json` | "Hợp đồng" giữa các phần |
| `av_stack/` | Nhận thế giới, trả lệnh lái. Là hàm `step(obs) -> {steer, accel}` thuần, không phụ thuộc sim nào |
| `sim/`, `eval/` | Chạy closed-loop nhanh và chấm điểm |
| `bridge/` | Nối Unity với AV |
| `Assets/Scripts/Adas/` | Dựng và chạy thế giới 3D |

---

## 2. Quy ước tọa độ (đọc kỹ phần này trước)

| Hệ | Trục |
|---|---|
| Camera (OpenCV) | x phải, y xuống, z tới |
| Xe / scenario (tay phải) | x tiến, y trái, z lên, yaw ngược chiều kim đồng hồ |
| Unity (tay trái) | x, y lên, z |

Đổi từ scenario sang Unity (`SimFrame.cs`):
```
Unity.position = (x_sim, z_sim, y_sim)      đổi chỗ y và z = đổi tay phải sang tay trái, không bị lật gương
Unity.rotY     = 90° − yaw_sim
```
Với phép xoay này, **trục Z cục bộ của vật là đầu xe**, nên hộp có `localScale = (W, H, L)`.

Vị trí trong scenario là **tâm xe trên mặt đất**. Gốc tọa độ là vị trí ego lúc t = 0.

---

## 3. Pipeline: video thành scenario

Lệnh mẫu:
```
python -m pipeline.run --video 1104.mp4 --start 29.6 --duration 21 --camera data/calib/clip02_fit.yaml \
    --hood-frac 0.12 --name clip02 --speed-ref data/raw/clip02_speed.csv --straight --obstacles --debug-video
```
Kết quả trung gian lưu ở `work/<name>/` và có cache. `--force detect|ego|obstacles|all` để chạy lại. Xem `work/<name>/debug.mp4` để biết sai ở bước nào.

| Bước | File | Phương pháp |
|---|---|---|
| Tách clip | `scenes.py` | So histogram HSV giữa hai frame. `1104.mp4` là 48 clip ghép lại |
| Calib | `calib.py`, `camera.py` | Bàn cờ, hoặc ước lượng từ FOV + hàng chân trời, hoặc `speedfit` từ tốc độ thật |
| Detect + track | `detect_track.py` | YOLO26x (COCO) + ByteTrack, 15 fps. Lọc người đang ngồi trên xe máy (`suppress_riders`). Màu đèn bằng ngưỡng HSV |
| Ego-motion | `ego_motion.py` | Có GPS thì dùng GPS. Không có thì warp mặt đường sang ảnh nhìn từ trên (IPM) rồi so khớp bằng ECC |
| Đường chân trời | `horizon.py` | `v_hor = y2 − H_cam·(y2−y1)/H_car` trên các ô tô, lấy trung vị, làm mượt bằng RTS. Ý tưởng từ buildphase |
| Nâng 2D lên 3D | `lift3d.py` | Đáy box là điểm chạm đất, bắn tia cắt mặt đường. Kiểm chéo bằng kích thước chuẩn của class |
| Làm mượt | `smoothing.py` | Kalman + RTS, vận tốc không đổi, loại outlier bằng chi-square |
| Vật cản nhỏ | `obstacles.py` | YOLO26 + SAHI của buildphase, gom cụm trong world. Cao ≥ 23 cm là hazard |
| Map | `export.py` | Làn = quỹ đạo ego dịch song song. Số làn và chiều làn suy từ vị trí và hướng các xe |

Công thức cốt lõi của bước nâng 3D:
```
X = H_cam / tan(θ + atan((v − cy)/fy))  ≈  fy·H_cam / (v − v_hor)
∂X/∂v = X² / (fy·H_cam)                     lệch 1 pixel thì sai số tăng theo bình phương khoảng cách
```

**Giới hạn thật của phần này (nên nhớ khi đọc kết quả):**
- Clip02 chạy ở "điều kiện lý tưởng": fy lấy từ `speedfit` (ra FOV 42°, hẹp bất thường), tốc độ tớ đọc tay từ chữ trên video, đường giả định thẳng (`--straight`).
- Tỉ lệ của visual odometry vẫn không ổn định (B05). Đây chưa phải ego-motion dùng được cho clip bất kỳ.
- Khoảng cách ở xa còn sai nhiều, 13% vị trí xe vẫn nằm ngoài lòng đường (B26).
- Chưa có lane detection, OSM, model depth. Chưa kiểm chứng khoảng cách với LiDAR vì máy chưa có SOD.

---

## 4. AV stack (dựa theo PDF 自动驾驶系统方案)

Interface (`av_stack/stack.py`):
```
reset(lanes)
step({t, ego, objects, traffic_lights, speed_limit}) -> {steer [rad, dương = trái], accel [m/s²], debug}
```

**AV hiện dùng ground truth** (vị trí vật chính xác từ sim), giống chế độ ground-truth của AWSIM. Camera và LiDAR trong Unity mới chỉ để xem, chưa đưa vào AV.

| Khối | File | Logic |
|---|---|---|
| Quyết định làn | `planner.py` | Xe trước chậm và gần, làn bên trống và an toàn thì đổi làn, ưu tiên bên trái. Không đổi sang làn ngược chiều. Đang đổi làn vẫn kiểm tra lại, không an toàn thì hủy (B33) |
| Sinh đường | `planner.py` | cartip + rollin + rollout theo PDF 5.2, rồi `smooth_path` |
| Tìm vật cản | `_find_leads` | Vật nằm trong hành lang của đường đi, thêm dự đoán 1–2 s cho vật **cắt ngang** (B11, B34) |
| Lái | `control.py` | Pure pursuit: `δ = atan(2L·sinα / Ld)`, `Ld = 0.9v + 4`, có giới hạn góc và tốc độ đánh lái |
| Ga/phanh | `control.py` | Lấy min của PI bám tốc độ và điều khiển khoảng cách (`s0 + v·1.6`). TTC < 1.5 s thì AEB −6 m/s² |

Xe đạp động học (`sim/vehicle.py`):
```
β = atan(lr/L · tan δ);  ẋ = v cos(ψ+β);  ẏ = v sin(ψ+β);  ψ̇ = v/lr · sin β;  v̇ = a (trễ bậc 1, τ = 0.25 s)
```

**AV chưa biết né.** Khi nguy hiểm nó chỉ phanh thẳng. Đổi làn là quyết định chậm, không phải phản xạ tránh.

---

## 5. Sim 2D và cách chấm điểm

```
python -m sim.run scenarios/handmade/lead_brake.json --mode M3 --plot
```

| Mode | Ego | Agent |
|---|---|---|
| M1 | Theo log | Theo log |
| M2 | AV | Theo log |
| M3 | AV | Theo log, chuyển sang IDM khi cần |
| M4 | AV | Như M3 + `events` |

Agent chuyển sang phản ứng (IDM) khi ego gần hơn log trên 2 m, TTC < 3 s, hoặc ego chậm hơn log mà nó đang ở sau ego. IDM:
```
a = a_max·[1 − (v/v0)⁴ − (s*/s)²];   s* = s0 + vT + v·Δv/(2√(a_max·b))
```

`eval/metrics.py` tính an toàn, tiến độ, độ êm, độ giống người. Va chạm được phân vùng front / rear / side.

**Đừng tin score 1.0 một mình.** Clip02 được 1.0 dù AV giữ 50 km/h lướt sát xe buýt và người (B20).

Test: `python -m pytest -q tests`, hiện 9 qua, 1 lỗi (B12, chờ chọn điều kiện). Danh sách điều kiện: `docs/TEST_CONDITIONS.md`.

---

## 6. Bridge Unity với Python

`bridge/tcp_server.py`, cổng 5555, mỗi message là một dòng JSON:
```
Unity → {"type":"reset","lanes":[...]}          ← {"ok":true}
Unity → {"type":"step","t":..,"ego":{..},...}   ← {"steer":..,"accel":..,"debug":{..}}
```
Unity gửi rồi **đứng chờ** câu trả lời (lockstep), nên AV chậm thì sim chờ, kết quả không phụ thuộc tốc độ máy.

Sửa code trong `av_stack/` thì **phải khởi động lại bridge**, vì nó giữ code cũ trong bộ nhớ.

---

## 7. Phần Unity

### 7.1 Các file

| File | Việc |
|---|---|
| `ScenarioPlayer.cs` | Trung tâm: đọc JSON, tạo xe, vòng lặp sim, va chạm, camera, HUD |
| `SimFrame.cs` | Đổi tọa độ |
| `BridgeClient.cs` | TCP tới Python |
| `RccDriver.cs` | Đổi (δ, a) thành ga/phanh/lái của RCC |
| `EgoCollision.cs` | `AgentTag`, phân vùng chạm |
| `Env/RoadBuilder.cs` | Sinh đường, vạch, vỉa hè, nhà, cây bằng code |
| `Env/VehicleFactory.cs` | Sinh model low-poly |
| `Env/AdasAssets.cs` | Tạo và cache material, texture |
| `Sensors/LidarSensor.cs` | LiDAR bằng `RaycastCommand` |
| `Editor/AdasMenu.cs` | Menu ADAS trên thanh trên cùng + dựng scene |
| `Editor/AdasSelfTest.cs`, `AdasShots.cs`, `AdasPlayTest.cs` | Tự kiểm tra, chụp ảnh, chạy Play mode trong batchmode |

Phần code Unity **chưa có**: agent phản ứng (M3), đọc `events` kiểu theo giây (M4). NPC theo điều kiện thì có, qua bridge (mục 11).

### 7.2 Vòng lặp sim

Một bước (`ScenarioPlayer.Step`, dt = 0.05 s), đúng thứ tự như `sim/world.py`:
1. Gửi trạng thái ở t cho AV, nhận lệnh.
2. Đưa ego lên t + dt.
3. Đưa agent lên t + dt (cùng thời điểm với ego, B08).
4. `Physics.Simulate(dt)`, rồi `Physics.OverlapBox` để tìm va chạm (B21).

Hai chế độ vật lý, chọn bằng `egoModel`:

| | Kinematic | RCC |
|---|---|---|
| `Physics.simulationMode` | `Script` (ta tự gọi Simulate) | `FixedUpdate` (RCC cần FixedUpdate, B27) |
| Bước | 0.05 s | 0.01 s × 5 substep, AV gọi mỗi 0.05 s |
| Tất định | Có, khớp từng số với Python | Không hoàn toàn |
| Đặt agent | Gán transform | `Rigidbody.MovePosition` để có va chạm vật lý |

Khi thêm xe RCC cần chú ý: làm nóng 1.5 s cho bánh quay (B30), tắt deadzone (B31), không `MovePosition` lúc khởi tạo (B29).

`RccDriver`:
```
u = a_cmd/A_max + kp·(a_cmd − a_đo)/A_thr + ki·∫(a_cmd − a_đo)dt;   throttle = max(u,0);  brake = max(−u,0)
steerInput = −δ[°] / maxSteerAngle
```

### 7.3 Cách làm menu trên thanh màu trắng và tạo scene sẵn

Đây là phần cậu muốn học. Toàn bộ nằm trong `Editor/AdasMenu.cs`.

**Bước 1: script phải nằm trong thư mục tên `Editor`.** Unity tách thư mục này thành assembly riêng, chỉ chạy trong editor. Nó được dùng `UnityEditor`, và không bị đưa vào bản build.

**Bước 2: thêm menu chỉ cần một attribute trên hàm `static`.**
```csharp
using UnityEditor;
using UnityEngine;

public static class MyMenu
{
    [MenuItem("ADAS/Xin chào")]              // "ADAS" tự thành một mục mới trên thanh menu
    static void Hello() => Debug.Log("Xin chào");

    [MenuItem("ADAS/Scene/Tạo khối vuông %#t")]   // dấu / tạo menu con; %#t là Ctrl+Shift+T
    static void MakeCube() => GameObject.CreatePrimitive(PrimitiveType.Cube);

    // Hàm kiểm tra: tham số thứ hai là true. Trả về false thì mục bị xám đi
    [MenuItem("ADAS/Scene/Tạo khối vuông %#t", true)]
    static bool CanMakeCube() => !Application.isPlaying;
}
```
Lưu file, quay lại Unity đợi compile, menu `ADAS` tự hiện. Không cần đăng ký ở đâu cả. Phím tắt: `%` = Ctrl, `#` = Shift, `&` = Alt.

**Bước 3: tạo scene bằng code.** Trình tự trong `AdasMenu.BuildScene`:
```csharp
// 1. Hỏi lưu scene đang mở, rồi tạo scene mới có sẵn Camera và Light
if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

// 2. Tạo object như lúc runtime
var go = new GameObject("ADAS");
var p = go.AddComponent<ScenarioPlayer>();
p.Load();  p.BuildEnvironment();  p.BuildActors();

// 3. Lưu mesh, material, texture thành asset (bước hay bị quên)
PersistGenerated("Assets/Adas/Generated/clip02");

// 4. Lưu scene
EditorSceneManager.SaveScene(scene, "Assets/Scenes/Adas_clip02.unity");
```

**Bước 3 của khối code trên là mấu chốt.** `new Mesh()`, `new Material()` chỉ nằm trong RAM. File `.unity` chỉ lưu **tham chiếu** tới asset, nên nếu không lưu chúng thành file thì mở lại scene sẽ thấy vật màu hồng hoặc mất hình. Cách làm:
```csharp
if (string.IsNullOrEmpty(AssetDatabase.GetAssetPath(mesh)))        // chưa phải asset
    AssetDatabase.CreateAsset(mesh, "Assets/.../road.asset");
// material thì đuôi .mat; lưu texture TRƯỚC material dùng nó
AssetDatabase.SaveAssets();
```

**Những điều khác ở chế độ editor:**
- `Destroy()` không dùng được ngoài Play mode, phải `DestroyImmediate()`.
- `Start`, `Update`, `OnTriggerEnter` không chạy ngoài Play mode (B21). Muốn gọi thì viết thành hàm `public` rồi gọi trực tiếp.
- Biến `static` bị xóa khi Play hoặc khi compile lại.
- `??` và `?.` không an toàn với object của Unity, dùng `== null` (B23).

**Chạy từ dòng lệnh** (cách tớ tự kiểm tra). Hàm phải `public static`, và project không được đang mở trong editor:
```
Unity.exe -batchmode -projectPath C:\Users\Admin\adastest -executeMethod Adas.EditorTools.AdasMenu.BuildAll -quit -logFile Logs/build.log
```
Bỏ `-nographics` nếu cần render ảnh. Bỏ `-quit` nếu cần chạy Play mode, và tự gọi `EditorApplication.Exit(0)` khi xong.

### 7.4 Khi cậu tự dựng scene

`ScenarioPlayer` được viết để nhận scene tự dựng. Các điều kiện:

| Yêu cầu | Lý do |
|---|---|
| Object gốc của môi trường tên đúng **`Environment`** | Có rồi thì `BuildEnvironment` không sinh đường nữa |
| Đường đặt theo tọa độ scenario: `(x_sim, 0, y_sim)`, gốc là vị trí ego lúc t = 0 | Xe chạy theo số trong JSON |
| Mặt đường có Collider | Bánh RCC và LiDAR cần |
| Môi trường không dùng layer 2, 8, 9, 10 | Các layer này được coi là thân xe, LiDAR bỏ qua |
| Đèn giao thông tên `TrafficLight_<id>`, có con `Lamp0`, `Lamp1`, `Lamp2` (đỏ, vàng, xanh) | Để đổi màu theo thời gian |
| Xóa object `Preview` nếu không cần | Khi Play nó tự bị xóa và dựng lại |

Thay model xe: kéo prefab vào `classPrefabs` trên component, `cls` là `car`, `truck`, `bus`, `motorbike`, `bicycle`, `pedestrian`. Prefab cần **gốc ở mặt đất, tại tâm xe, đầu xe hướng +Z**. Code không tự co giãn prefab, nên cậu chỉnh kích thước cho khớp bảng trong `pipeline/config.py`.

Nên dựng đường bằng map thật của scenario, hoặc sửa scenario cho khớp đường cậu dựng. Hai bên lệch nhau thì xe sẽ chạy trên vỉa hè.

### 7.5 Điều khiển khi chạy

`Space` dừng/chạy · `R` chạy lại · `C` camera · `+`/`-` tốc độ · `V` video · `L` LiDAR · `H` ẩn panel.

Kết quả ghi ở `Logs/adas_collisions.csv`, `Logs/adas_ego_<scenario>_<model>.csv`.

---

## 8. Kết quả đã đo

`lead_brake`, M2, cùng AV Python:

| | Python | Unity kinematic | Unity RCC |
|---|---|---|---|
| Va chạm (xe máy tông đuôi) | 22.75 s | 22.75 s | khoảng 21.8–21.95 s |
| Sang làn trái | | 1.60 s | 2.45 s |
| Bám gia tốc / góc lái (RMSE) | | 0 / 0 | 0.58 m/s² / 0.27° |
| Lệch vị trí so với kinematic | | | TB 5.1 m, max 7.8 m |

Đây là một scenario, đường phẳng, một mẫu xe. Chưa đủ để kết luận về độ tin cậy nói chung.

---

## 9. Công cụ

| Việc | Công cụ |
|---|---|
| Python | 3.12, venv ở `.venv` |
| Detect, track | Ultralytics 8.4, YOLO26x, ByteTrack, PyTorch 2.11 (CUDA 12.8) |
| Video | PyAV |
| Ảnh, hình học | OpenCV, NumPy |
| Dữ liệu | pandas + parquet, jsonschema |
| Vẽ | matplotlib |
| Test | pytest |
| Vật cản nhỏ | Repo buildphase (YOLO26 + SAHI) |
| 3D | Unity 6, URP, Newtonsoft JSON, RCC Pro |

Thứ không dùng: ROS2 (TCP đơn giản hơn trên Windows ở giai đoạn này), AWSIM (chỉ học cách tổ chức, không dùng code của nó).

---

## 10. Việc còn mở

| | |
|---|---|
| B05 | Tỉ lệ visual odometry không ổn định |
| B12 | Chọn điều kiện test M2 |
| B37 | RCC không tất định, kết cục phân nhánh ở quyết định hủy đổi làn |
| B20 | Metric không phạt lái sát người và xe đứng yên |
| B35 | Người/xe ngã nằm sẵn trên đường, chưa có cảnh ngã; xe nằm là suy ra |
| | SOD chưa có; M3 chưa port sang Unity; AV chưa dùng cảm biến; AV chưa biết né |

---

## 11. Kịch bản, thông số, lái tay (thêm 09/11)

**NPC theo điều kiện** (`sim/director.py`). Trong scenario có `npcs`: xe chờ điều kiện so với ego rồi mới hành động, nên ego chạy nhanh hay chậm đều gặp tình huống. Logic nằm ở Python, Unity nhận vị trí qua bridge mỗi bước, nên sim 2D và Unity cùng một kịch bản. **Các kịch bản có NPC cần bridge đang chạy.**
Có sẵn: `cut_in`, `brake_check`, `wrong_way`, `red_light_runner`, `jaywalker` (`scenarios/handmade/make_examples.py`). Scene: menu **ADAS → Dựng scene: các kịch bản tình huống**.

**Quét tham số:** `python -m sim.sweep` in bảng tránh được / đâm theo khoảng cách tạt đầu và độ trễ phản ứng.

**Bảng thông số:** phím `P`. Danh sách nằm ở `PARAM_SPEC` trong `av_stack/stack.py`, Unity tự vẽ thanh trượt. Thêm một dòng là có thêm một thanh. Preset ở `PRESETS`. `Reset` làm mới kết nối nên Unity tự gửi lại các giá trị đã chỉnh.

**Bộ phản ứng:** tham số `reaction_delay`: AV thấy vật và đèn của (t − delay), còn trạng thái xe mình thì không trễ.

**Lái tay:** phím `M` đổi AV / người bất cứ lúc nào. WASD, mũi tên hoặc tay cầm. Luôn chạy đúng thời gian thực. AV vẫn chạy ngầm.

**Log để train:** `Logs/drives/<scenario>_<giờ>.jsonl`. Dòng đầu là meta có `lanes`. Mỗi dòng sau (0.05 s) có `obs` (đúng input của AV), `human` (ga, phanh, lái, giá trị áp dụng thực tế), `av` (lệnh AV ngầm). Không lưu ảnh camera.
