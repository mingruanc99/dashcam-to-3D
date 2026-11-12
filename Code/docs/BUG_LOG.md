# Bug log: adastest (Dashcam → Scenario → Sim)

Log này ghi lại tớ đã làm gì, gặp bug ở đâu, nghi nguyên nhân gì, công thức và code nào liên quan, và hiện đang ở trạng thái nào.
**Quy ước:** mỗi khi gặp bug mới thì thêm một mục `B<số>` ở cuối file và cập nhật bảng tổng quan.
Trạng thái gồm 🟢 đã sửa (có bằng chứng), 🟡 vá tạm, 🔴 còn mở, ⚪ không phải bug (giới hạn thiết kế).

---

## Tổng quan

| ID | Phần | Tóm tắt | Trạng thái |
|---|---|---|---|
| B01 | môi trường | `pip install` treo khoảng 20 phút | 🟢 |
| B02 | dữ liệu | `1104.mp4` là 48 clip ghép từ nhiều xe | 🟢 tách clip |
| B03 | ego-motion | VO theo điểm đặc trưng ra 5 km/h trong khi thật là 50 km/h | 🟢 đổi sang IPM + ECC |
| B04 | ego-motion | Vùng BEV đặt sai chỗ, ảnh mờ | 🟢 |
| B05 | ego-motion / calib | Tỉ lệ VO không ổn định (thật/VO từ 3.5 đến 11) | ⚪ hoãn: giả định điều kiện lý tưởng |
| B06 | ego-motion | Yaw của VO trôi 26° trên đường thẳng | 🟡 `--straight` |
| B07 | lift 3D | Vận tốc agent vô lý (xe máy 82 km/h, người đi bộ 35 km/h) | 🟡 một phần |
| B08 | sim | Agent theo log lệch một bước thời gian so với ego | 🟢 |
| B09 | sim | Dòng lọc `others` cho IDM viết sai | 🟢 |
| B10 | planner | Đổi làn không bao giờ hoàn tất | 🟢 |
| B11 | planner | Dự đoán vật cắt ngang bỏ qua chuyển động của ego, AEB phanh oan | 🟢 |
| B12 | sim / test | M2: xe máy chạy theo log tông đuôi ego (zone = rear) | ⚪ chờ Unity + chọn điều kiện test |
| B13 | scenario | `jaywalker` không thật sự kiểm tra AV | 🟢 NPC theo điều kiện, test có kiểm tra giảm tốc |
| B14 | sim | `clip02` M3: progress 0.28, min TTC 0.07 s | 🟢 M1 hết va chạm sau khi dùng yolo26x + horizon theo frame |
| B15 | CLI | In tiếng Việt khi pipe stdout trên Windows thì crash (`cp1252`) | 🟢 |
| B17 | cvat-cuboid-quicktool.user.js | 22 điểm bug/đáng ngờ (sensor ở gốc, race khi tải cloud, lùi xe bị lật hướng...) | 🔴 bên tool của cậu |
| B18 | map / planner | AV nhanh hơn log thì ra khỏi map; `current_lane` trả về làn tùy ý | 🟢 |
| B19 | map / planner | Map coi mọi làn là cùng chiều, AV có thể đổi sang làn ngược chiều | 🟢 suy chiều làn từ agent |
| B20 | metrics | Score 1.0 dù AV giữ 50 km/h lướt qua xe buýt dừng + người đi bộ (cách 1.2 m), còn người lái thật giảm xuống 5 km/h | 🔴 cần bàn |
| B21 | Unity | `OnTriggerEnter` không được gọi khi chạy `Physics.Simulate` ngoài Play mode, nên không ghi được va chạm | 🟢 chuyển sang `OverlapBox` |
| B22 | Unity | Vùng chạm luôn ra `side` vì `InverseTransformPoint` chia cho scale của cube | 🟢 |
| B23 | Unity | `GetComponent() ?? AddComponent()` không bao giờ AddComponent vì Unity trả về null giả | 🟢 |
| B24 | Unity | Texture nhiễu có vân hình "0" lặp lại | 🟢 |
| B25 | Unity | Scene trống khi mở trong editor; ego đứng ngay mép đường | 🟢 dựng sẵn scene + kéo dài đường |
| B26 | map | Map quá hẹp (3 làn), 46% vị trí agent nằm ngoài lòng đường | 🟢 suy số làn từ xe (còn 13%) |
| B27 | Unity/RCC | Chế độ vật lý Script không gọi FixedUpdate, nên xe RCC đứng im | 🟢 RCC dùng FixedUpdate + 5 substep |
| B28 | Unity/RCC | Tâm xe RCC tính từ Renderer.bounds (giả thuyết sai cho B29, vẫn đổi sang WheelCollider) | 🟢 |
| B29 | Unity/RCC | Xe RCC bị văng ~2300 m/s ngay bước đầu (MovePosition quét agent từ gốc; Destroy() hoãn) | 🟢 |
| B30 | Unity/RCC | Phanh không ăn trong 2 s đầu (bánh 0 rpm khi spawn, động cơ khởi động 1 s) | 🟢 pha làm nóng 1.5 s |
| B31 | Unity/RCC | Deadzone 0.05 của RCC xóa hiệu chỉnh lái < 2°, lệnh nhỏ chỉ còn ~½ | 🟢 |
| B32 | Unity/RCC | Sau va chạm, agent kinematic (khối lượng vô hạn) kéo lê xe | 🟢 agent bỏ quỹ đạo, trượt dừng / đổ xuống |
| B33 | AV planner | Đổi làn không kiểm tra lại làn đích, xe chậm thì bị xe sau tông | 🟢 kiểm tra mỗi chu kỳ + hủy |
| B34 | AV planner | Dự đoán τ>0 coi xe cùng chiều đang vượt từ phía sau là lead, nên phanh trước mũi nó | 🟢 |
| B35 | pipeline + Unity | Xe máy ngã không có hiệu ứng, người tự nhiên xuất hiện | 🟡 người/xe nằm sẵn trên đường; chưa có cảnh ngã trong video |
| B36 | Unity | ScenarioPlayer không đọc `events`, scene jaywalker không có người đi bộ | 🟢 NPC qua bridge (events kiểu cũ vẫn chưa đọc) |
| B37 | RCC + planner | Cùng input, RCC cho 2 kết cục khác nhau (hủy đổi làn hay không) | 🔴 |
| B38 | Unity vs sim 2D | `cut_in` M2 kinematic: Unity báo 1 va chạm, sim Python báo 0 (cách nhau 0.23 m) | 🔴 chưa rõ nguyên nhân |
| B16 | buildphase | `SahiDetector` dùng `half=True`, ultralytics 8.4 báo deprecated ở mỗi lần gọi | 🟡 tắt half bên adastest |

Test hiện tại (`pytest tests`): **9 passed, 1 failed** (`test_av_handles_lead_brake[M2]`, xem B12).

---

## Ký hiệu dùng chung

- Hệ xe: x tiến, y trái, z lên. Hệ camera OpenCV: x phải, y xuống, z tới.
- `fx, fy, cx, cy`: intrinsics. `H_cam`: chiều cao camera. `θ`: pitch (θ > 0 là camera chúc xuống).
- Đường chân trời: `v_hor = cy − fy·tan θ`  ⇔  `θ = atan((cy − v_hor)/fy)`. Code ở `pipeline/camera.py:106` (`pitch_from_horizon`).
- Một pixel (u, v) chiếu xuống mặt đường, code ở `pipeline/camera.py:136` (`pixels_to_ground`):
  ```
  n = K⁻¹[u, v, 1]   (đã khử méo)
  d0 = (1, −n_x, −n_y)                         # tia trong hệ xe khi pitch = 0
  d  = (d0.f·cosθ + d0.u·sinθ,  d0.l,  −d0.f·sinθ + d0.u·cosθ)
  t  = H_cam / (−d_z),   P = (x_off + t·d_x,  t·d_y)
  ```
  Dạng rút gọn theo hàng ảnh (tâm ảnh, bỏ qua méo):
  **`X(v) = H_cam / tan(θ + atan((v − cy)/fy))`**.
  Đây chính là `1/z = a·v + b` trong `buildphase/showcase/sod_geo.py` khi góc nhỏ: `a = 1/(fy·H_cam)`, `b = −v_hor/(fy·H_cam)`.

---

## B01: `pip install` treo khoảng 20 phút (môi trường)

- **Đã làm:** cài `ultralytics av scipy pandas ...` ở chế độ chạy nền.
- **Hiện tượng:** process pip chạy 19 phút, CPU chỉ khoảng 6 s, output rỗng.
- **Nguyên nhân (đoán):** mạng chậm hoặc rớt khi resolve hay tải. Lần chạy lại có `--default-timeout 60` và ghi log ra file thì cài bình thường. Tải `yolo11m.pt` cũng mất 4 phút 45 giây, khoảng 70 KB/s.
- **Bài học:** cài thư viện lớn thì luôn ghi log ra file và đặt timeout, để biết nó đang treo ở gói nào.

## B02: `1104.mp4` không phải một clip mà là video tổng hợp 48 clip

- **Hiện tượng:** ghép các frame ở 10 s, 120 s, 300 s... thì thấy mỗi frame là một xe, một camera, một thời điểm khác nhau, có cả cảnh đêm. Kênh "Camera Giao thông" đã ghép lại và chèn watermark.
- **Hệ quả:** calib, chiều cao camera và đường chân trời **khác nhau ở mỗi clip**. Không chạy pipeline cho cả file một lần được. Clip cũng đã bị re-encode, có thể đã bị crop hoặc zoom (xem B05).
- **Sửa:** `pipeline/scenes.py:33` `detect_cuts()` so sánh histogram HSV (khoảng cách Bhattacharyya > 0.45) giữa hai frame liên tiếp ở 10 fps. Ra 48 clip, kèm `work/scenes/scenes.csv` và `overview.jpg`.
- **Clip đang dùng:** #2 (29.3–50.8 s). Trời sáng, đường thẳng dưới cầu cạn, xe phanh từ 50 xuống 5 km/h. Overlay có GPS và tốc độ, nhưng chỉ là **chữ in trên hình**, không có track metadata.

## B03: VO theo điểm đặc trưng cho tốc độ khoảng 5 km/h (thật là 50 km/h)

- **Đã làm (bản 1):** `goodFeaturesToTrack` + Lucas-Kanade, chiếu điểm xuống mặt đường rồi chạy `estimateAffinePartial2D` (RANSAC).
- **Hiện tượng:** trung vị inliers khoảng 150, nghe có vẻ tốt, nhưng tốc độ trung vị chỉ 2.9 km/h.
- **Nguyên nhân (đã xác minh bằng ảnh `flow.jpg`):** điểm đặc trưng tập trung ở hàng cây, dải phân cách và xe tải bên trái. Những thứ đó **không nằm trên mặt đường**. Mặt đường ướt và trơn gần như không có góc nào. Chiếu một điểm ở trên cao xuống mặt đường thì khoảng cách bị phóng đại, còn RANSAC lại chọn đúng nhóm điểm sai đó vì chúng đông hơn.
- **Sửa:** viết lại thành **IPM + ECC** (`pipeline/ego_motion.py:50` `BEV`, `:101` `visual_odometry`):
  1. Warp vùng đường thành ảnh nhìn từ trên xuống. Lưới mét (x, y) được chiếu lên ảnh bằng `cam.project`, sau đó dùng `cv2.remap`.
  2. Chạy `findTransformECC(MOTION_EUCLIDEAN)` giữa hai ảnh BEV liên tiếp, có mask bỏ vùng có xe.
  3. Đổi phép biến đổi từ pixel BEV sang mét: `M = A⁻¹·W·A`, với `A = [[0, −1/r, y_half/r], [−1/r, 0, x_max/r], [0, 0, 1]]`.
  4. Ego chuyển động ngược với chuyển động của mặt đường: `Δψ = −atan2(M10, M00)`, `Δp = −R(Δψ_mặt đường)ᵀ·t`.
- **Kết quả:** ECC khớp tốt (cc trung vị 0.94–0.99), **nhưng tỉ lệ vẫn sai**, xem B05.

## B04: Vùng BEV đặt sai chỗ, ảnh BEV mờ

- **Hiện tượng:** ban đầu BEV cố định ở x ∈ [4, 24] m. Với calib ước lượng (fx = 554), vùng này rơi vào gần đường chân trời nên BEV bị kéo giãn mờ thành vệt (`bev.jpg`).
- **Sửa:** chọn vùng theo **hàng ảnh** thay vì theo mét: từ ngay trên capo (`hood_row − 2%·H`) lên tới `v_hor + 10%·H`, chia 240 hàng (`BEV.__init__`, `pipeline/ego_motion.py:50`).
- **Còn lại:** vùng BEV hiện chỉ là x ∈ [2.3, 6.9] m, tức là rất sát xe. Ở 50 km/h xe đi 0.93 m mỗi frame (15 fps), khoảng 20% chiều cao BEV, nên ECC chỉ hội tụ được nhờ khởi tạo bằng chuyển động của bước trước.

## B05: 🔴 Tỉ lệ VO không ổn định (bug chính)

- **Đã làm:** so tốc độ VO với tốc độ đọc từ overlay (`data/raw/clip02_speed.csv`, tớ đọc tay mỗi giây từ ảnh crop).
- **Số liệu** (thật / VO tại các mốc t = 0.4, 3.4, 6.4, 9.4, 12.4, 15.4, 18.4 s):
  ```
  ECC thô 15 fps         : 4.63  7.22 11.33 8.30 3.60 4.19 3.52   (CV = 0.39)
  ECC trừ median 15 fps  : 4.57  6.40  7.67 5.57 3.50 3.25 2.34   (CV = 0.26)
  ```
  Nếu chỉ sai tiêu cự thì tỉ số phải **gần như hằng số**. Ở đây nó dao động gấp khoảng 3 lần.
- **Thử `speedfit`** (`pipeline/calib.py:66`): `k = ∫v_ref dt / ∫v_VO dt`, rồi `fx, fy *= k`, giữ nguyên `v_hor`.
  Hai vòng lặp cho k = 4.81 rồi 0.945, ra fx ≈ 2518 px, **FOV ngang khoảng 42°**. Tương quan tốc độ chỉ 0.68.
  → FOV 42° **không hợp lý** cho dashcam (thường 110–140°). Có thể clip đã bị crop hoặc zoom khi ghép, nhưng nhiều khả năng k đang "nuốt" luôn lỗi pitch.
- **Phân tích độ nhạy** (đạo hàm của `X(v)`): khi góc nhỏ thì `X ≈ fy·H_cam/(v − v_hor)`.
  ```
  ∂X/∂v_hor = X² / (fy·H_cam)        ← sai đường chân trời 1 px thì sai bao nhiêu mét
  ```
  Tốc độ đo được tỉ lệ với `(v − v_hor)⁻²`. Nếu pitch **đổi theo thời gian** (xe chúi đầu khi phanh, cầu cạn làm đường dốc nhẹ) thì `v_hor` trôi, kéo theo tỉ lệ trôi. Điều này khớp với việc tỉ số lớn nhất (11.3) rơi vào lúc bắt đầu phanh mạnh (t ≈ 6–9 s, 47 → 31 km/h).
- **Nghi nguyên nhân (thứ tự theo khả năng):**
  1. Pitch đổi theo từng frame, trong khi code giả định pitch cố định (`Camera.pitch` là hằng số).
  2. `v_hor = 597` là tớ nhìn ảnh rồi đoán, và `H_cam = 1.3` cũng là đoán.
  3. Méo ống kính: đang coi `dist = 0` dù dashcam góc rộng.
  4. Video đã re-encode hoặc ổn định hình (stabilize), làm hỏng hình học.
- **Hướng sửa đề xuất** (mượn từ `buildphase/showcase/sod_geo.py`, mô hình mặt đường theo từng frame):
  - Ước lượng `v_hor` **cho từng frame** từ các ô tô đã detect. Viết ngược công thức chiều cao của buildphase:
    `h_obj = H_cam·(y2 − y1)/(y2 − v_hor)` ⇒ **`v_hor = y2 − H_cam·(y2 − y1)/H_car`** với H_car ≈ 1.5 m. Lấy trung vị trên các xe trong frame rồi làm mượt theo thời gian.
  - Hoặc đo sự thay đổi pitch bằng ECC chỉ theo trục dọc trên vùng cảnh xa (gần chân trời), vì vùng đó gần như chỉ dịch khi pitch đổi.
  - Sau đó mới chạy lại `speedfit` để fit `fy`.
- **Code liên quan:** `pipeline/camera.py:106,136`, `pipeline/ego_motion.py:50,101`, `pipeline/calib.py:66`, `pipeline/lift3d.py:25`.

### Cập nhật B05 (6/11): kiểm chứng giả thuyết pitch, và quyết định
- **Thí nghiệm:** ước lượng đường chân trời cho từng frame từ ô tô bằng công thức chiều cao của buildphase viết ngược lại
  (`pipeline/horizon.py`):
  ```
  h_obj = H_cam·(y2 − y1)/(y2 − v_hor)   ⇒   v_hor = y2 − H_cam·(y2 − y1)/H_car      (H_car = 1.5 m, không dùng fy)
  ```
  Trên clip02: v_hor dao động **583–601 px** (đoán tay là 597), có 96% frame có xe. Trong đoạn phanh mạnh t = 6–9 s, v_hor gần như không đổi (593–597).
- **Kết luận:** pitch chỉ lệch khoảng ±6 px, tức chưa tới 1°. Ở vùng BEV (X ≈ 2–7 m) mức này chỉ gây vài % sai số, **không giải thích được tỉ số lệch gấp 3 lần**. Giả thuyết số 1 bị bác bỏ.
- **Hiểu thêm (quan trọng cho việc dạy):** với camera đơn trên mặt phẳng, **fy không quan sát được từ một frame duy nhất**:
  ```
  X = fy·H_cam/(v − v_hor)               ← khoảng cách tỉ lệ với fy
  w_px(làn) = fx·W/X = W·(v − v_hor)/H_cam   ← bề rộng làn KHÔNG phụ thuộc f (khi fx = fy)
  ```
  Bề rộng làn và chiều cao xe đều không ràng buộc được f. Chỉ có **chuyển động** (tốc độ thật) hoặc **một chiều dài dọc đã biết**
  (chiều dài vạch đứt, khoảng cách giữa các vạch) mới đo được f. Vì vậy `speedfit` là cách đúng về nguyên lý.
- **Quyết định (theo ý cậu):** không đi tìm nguyên nhân do encode, stabilize hay FOV của video tổng hợp. Giả định **điều kiện lý tưởng**: dùng fy sau `speedfit`, tốc độ lấy từ overlay (`--speed-ref`), đường thẳng (`--straight`). Độ chính xác vị trí sẽ được kiểm lại bằng **SOD (có LiDAR)** khi có dữ liệu. Hiện máy chưa có `Small_Obstacle_Dataset`.
- **Vẫn giữ:** pitch theo frame (`--horizon cars`, mặc định) trong `lift_detections` (`pipeline/lift3d.py`) và trong việc đo chiều cao vật cản.

## B06: 🟡 Yaw của VO trôi 26° trên đường thẳng

- **Hiện tượng:** clip #2 chạy thẳng dưới cầu cạn nhưng yaw tích lũy tăng đều khoảng 2–5° mỗi 2 s trong 12 s đầu, tổng cộng 26°. Hậu quả là quỹ đạo ego cong, và mọi agent (vốn được đặt theo pose ego) bị xoay theo.
- **Nghi nguyên nhân:** cùng gốc với B05. Sai roll hoặc pitch làm BEV bị méo thành hình thang, nên ECC mô hình Euclid phải "xoay" mới khớp được phần méo đó. Thêm nữa, vạch làn ở một bên có thể kéo lệch.
- **Vá tạm:** cờ `--straight` (`pipeline/run.py:42`) đặt yaw = 0. Tốc độ lấy từ `--speed-ref` (`fuse_speed`, `pipeline/ego_motion.py:187`):
  `x_k = Σ v_ref·cos ψ·Δt`, `y_k = Σ v_ref·sin ψ·Δt`.
- **Sửa thật:** đợi sửa xong B05. Sau đó kiểm tra lại bằng clip có cua rõ ràng.

## B07: 🟡 Vận tốc agent vô lý

- **Hiện tượng (clip02):** xe máy #419 có vận tốc 82 km/h, "người đi bộ" #36 có vận tốc 35 km/h, ô tô đi ngược chiều khoảng 45 km/h (con số này có thể đúng).
- **Nguyên nhân:**
  1. Khoảng cách theo phương dọc sai vì cùng lý do với B05. Sai số `∂X/∂v = X²/(fy·H_cam)` lớn rất nhanh khi vật ở xa, và vận tốc là đạo hàm của khoảng cách nên sai càng nhiều.
  2. Người ngồi trên xe máy bị tách thành track riêng mà `suppress_riders` (lọc theo từng frame) bỏ sót.
- **Sửa một phần:** `pipeline/lift3d.py:109` `fix_riders_and_duplicates()`:
  - Người đi bộ có tốc độ trung vị > 3.5 m/s thì đổi class thành `motorbike`.
  - Hai track có khoảng cách trung vị < 1.5 m trong thời gian chồng lấn thì gộp lại, giữ track dài hơn.
- **Đang dùng song song:** ước lượng theo kích thước `r_size = fy·H_class/h_px` (`pipeline/lift3d.py:43`). Hai cách lệch nhau thì confidence giảm theo `exp(−1.5·|ln(r_ground/r_size)|)`.
- **Ý tưởng:** cách tính chiều cao từ đường chân trời theo frame của buildphase không phụ thuộc fy, nên sẽ ổn định hơn sau khi sửa B05.

## B08: 🟢 Sim: agent theo log lệch một bước thời gian so với ego

- **Hiện tượng (đọc code):** agent `log_replay` được cập nhật ở `t` đầu vòng lặp, trong khi ego được tích phân lên `t + dt`. Va chạm được kiểm tra giữa hai thời điểm khác nhau.
- **Sửa:** agent theo log được cập nhật lên `t + dt` sau bước ego, cùng chỗ với IDM (`sim/world.py:165`). State ban đầu được đặt trong `__init__`.

## B09: 🟢 Dòng lọc `others` cho IDM viết sai

- **Hiện tượng:** biểu thức `[...] and [...]` lộn xộn. Ego không có `id` nên không lọc đúng được.
- **Sửa:** `others = [o for o in actors if o.get("id") != a.id]` (`sim/world.py:171`). Đồng thời `KinematicBicycle.state()` trả thêm `"id": "ego"`.

## B10: 🟢 Planner: đổi làn không bao giờ hoàn tất

- **Hiện tượng:** `lead_brake` ở M2 có ego bị kẹt ở y ≈ 1.1–1.3 (giữa hai làn), AEB phanh liên tục, lane vẫn là `l_ego`.
- **Nguyên nhân:** bản cũ dựng path dọc theo làn **hiện tại** và trộn dần sang làn đích bằng trọng số `w(s − s₀ − keep)`. Mỗi chu kỳ, `s₀` là vị trí ego mới, nên đoạn rollin luôn bắt đầu ở phía trước ego. Kết quả là xe chỉ tiến được một ít sang ngang rồi kế hoạch lại bị "đẩy về phía trước". Đây là lỗi kiểu receding horizon không hội tụ.
- **Sửa** (`av_stack/planner.py:164–174`): dựng path dọc theo làn **đích**, với độ lệch ngang hiện tại của ego `d_t` so với làn đích:
  ```
  P(s) = C_target(s) + n(s) · d_t · (1 − smoothstep((s − s_t)/(keep + rollin)))
  ```
  `d_t` giảm dần qua các chu kỳ nên quá trình đổi làn hội tụ. `rollin_time` cũng giảm từ 2.5 xuống 1.2 s.
- **Bằng chứng:** `lead_brake` ở M3 chuyển sang `l_L1` lúc t ≈ 3 s, y = 3.50, score = 1.000.

## B11: 🟢 Dự đoán vật cắt ngang bỏ qua chuyển động của ego, AEB phanh oan

- **Hiện tượng:** lúc t ≈ 5 s, AV đặt xe máy #2 (đang ở **làn bên**, phía sau ego, nhanh hơn ego) làm lead với gap 3.3 m, v = 0, rồi AEB phanh từ 12 xuống 0 m/s.
- **Nguyên nhân** (`_find_leads`): dự đoán vị trí vật tại τ = 1, 2 s theo vận tốc không đổi, và nếu vị trí đó rơi vào hành lang của path thì coi là xung đột. Bản cũ (1) không tính rằng ego cũng đi được `v_ego·τ`, và (2) ép `v_along = min(v, 0)`.
- **Sửa** (`av_stack/planner.py:185–205`):
  ```
  s_ego(τ) = v_ego·τ
  bỏ qua nếu s_vật < s_ego(τ) − L_ego   (ego đã đi qua chỗ đó)
  bỏ qua nếu s_vật > s_ego(τ) + 15     (chưa cần phản ứng)
  v_along = v·cos(ψ_vật − ψ_path)       (giữ dấu thật; người cắt ngang thì ≈ 0)
  ```
- **Bằng chứng:** M3 không còn AEB, min TTC = 4.03 s, comfort tốt (max decel 2.98, p95 jerk 2.45).

## B12: ⚪ M2: xe máy theo log tông đuôi ego, test FAIL

- **Hiện tượng:** `lead_brake` ở M2 có một va chạm lúc t = 23 s: xe máy #2 (`log_replay`, 14 m/s) tông đuôi ego (9.3 m/s) đang giảm tốc vì đèn đỏ ở x = 330 m, sau khi ego đã sang làn trái là làn của xe máy.
- **Đánh giá:** theo thiết kế (PLAN mục 6), ở M2 agent không phản ứng được, nên lỗi không nằm ở AV. Ở M3 xe máy chuyển sang IDM (`ttc` / `ego_slower_than_log`) và không có va chạm. `eval/metrics.py` đã phạt nhẹ trường hợp này (hệ số 0.5 khi va chạm với agent `log_replay`).
- **Nhưng:** `tests/test_core.py:84` yêu cầu M2 không có va chạm nào, nên **đang FAIL**.
- **Cần quyết định:** (a) test M2 chỉ đếm va chạm "AV có lỗi", ví dụ va chạm ở nửa trước của ego; (b) làm cho AV không đổi sang làn có xe đang lao tới từ phía sau (hiện `_lane_safe` chỉ xét thời điểm đổi làn); hoặc (c) bỏ M2 khỏi test này.

### Cập nhật B12 (6/11)
Sim Python giờ phân loại vùng va chạm trong hệ ego (`sim/world.py`, cùng tiêu chí với `CollisionLogger` bên Unity):
```
x_local = cosψ·(cx − x_ego) + sinψ·(cy − y_ego)
zone = front nếu x_local > L/4,  rear nếu x_local < −L/4,  còn lại là side
```
(cx, cy) = trung bình các góc của box agent nằm trong box ego.
Kết quả: va chạm của B12 là **`zone = rear`**, khẳng định không do AV gây ra. Hướng dẫn port sang Unity để kiểm tra bằng vật lý thật: `docs/UNITY_B12.md`.
Các lựa chọn để sửa điều kiện test: `docs/TEST_CONDITIONS.md` (chờ cậu chọn).

## B13: 🔴 Scenario `jaywalker` không thật sự kiểm tra AV

- **Hiện tượng:** người đi bộ được spawn lúc t = 9 s tại x = 120. Lúc đó AV (đã sang làn trái, chạy khoảng 14 m/s) đã đi qua x = 120 (x ≈ 115 lúc t = 9 s, qua hẳn khi người tới làn). Report giống hệt `lead_brake` M3 nên event không ảnh hưởng gì.
- **Đề xuất sửa** (bị dừng giữa chừng, chưa áp dụng): spawn lúc t = 3.5 s từ y = −4, đi 1.4 m/s, để người vào làn trái (y ≈ 3.5) đúng lúc AV tới x = 120. Kèm assert là AV phải giảm tốc (min v gần x = 120 < v ban đầu).
- **Bài học:** scenario tình huống phải được tính theo **quỹ đạo của AV**, không phải theo quỹ đạo log, và test phải kiểm tra rằng event *thực sự* gây tương tác.

## B14: 🔴 `clip02` ở M3: progress 0.28, min TTC 0.07 s

- **Số liệu** (chạy **trước** khi sửa B10, B11): M1 có một va chạm (tức là log ego tự "đâm" agent, chứng tỏ vị trí agent sai, do B05/B07); M2 score 0.40, ADE 31 m; M3 score 0.12, progress 0.28.
- **Nghi nguyên nhân:** chủ yếu do scenario sai (B05–B07), ví dụ agent ma đứng trên làn ego hay khoảng cách bị co. Thêm vào đó là hai lỗi planner đã sửa.
- **Việc cần làm:** chạy lại sau B10 và B11. Va chạm ở **M1** là phép kiểm tra hữu ích: log ego không bao giờ được va chạm với agent trong log. Nếu có thì scenario sai.

## B15: 🟢 In tiếng Việt khi pipe stdout trên Windows thì crash

- **Hiện tượng:** `python -m pipeline.run ... | tail` báo `UnicodeEncodeError: 'charmap' codec can't encode character 'ị'`. Chạy trực tiếp trong console thì không lỗi.
- **Nguyên nhân:** khi stdout bị pipe hoặc redirect, Python trên Windows dùng encoding của locale (`cp1252`) thay vì UTF-8.
- **Sửa:** `common/__init__.py` gọi `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`. File này được import ở `pipeline`, `sim`, `bridge` và `scenarios`.

## B16: 🟡 buildphase `sahi_deploy.SahiDetector`: `half` deprecated ở ultralytics 8.4

- **Hiện tượng:** mỗi lần `model.predict(..., half=True)` in ra `WARNING 'half' is deprecated ... Use 'quantize' instead.`. Chạy SAHI thì mỗi frame gọi nhiều lần nên log bị ngập.
- **Chỗ liên quan:** `buildphase/sahi_deploy.py`, `SahiDetector._run` (truyền `half=self.cfg.half`).
- **Vá bên adastest:** `pipeline/obstacles.py` gọi với `half=False` (FP32, chậm hơn một chút).
- **Đề xuất cho buildphase:** kiểm tra version ultralytics. Từ 8.4 trở lên thì chỉ truyền `half` khi API còn hỗ trợ, hoặc chuyển sang tham số mới. README của buildphase đang ghim torch 2.14.1/cu126, còn adastest đang chạy torch 2.11/cu128 và ultralytics 8.4.202.
- **Ghi chú thêm (không phải bug):** `nms_ios` loại một box khi IOS = giao/diện tích box *nhỏ hơn* ≥ 0.5. Nghĩa là box nhỏ nằm lọt trong box lớn cùng lớp sẽ bị bỏ. Với 1 lớp `obstacle` thì hai viên đá sát nhau có thể bị gộp thành một.

## B17: 🔴 `cvat-cuboid-quicktool.user.js` (v4.0.0, 9612 dòng): review toàn bộ

Một agent đã đọc hết file, kiểm từng công thức. Tớ chưa sửa file này, đây là tool của cậu.
**Phần đúng (đã kiểm):** `rotationMatrix` (Rx·Ry·Rz), `anglesForPlane`, `fitPlaneLSQ`, `planeFromSingleBox`, ray–OBB,
Sutherland–Hodgman, đại số RTS, Jacobian của ICP, `solve3`, SE(2) compose/inverse, chuỗi pose, `withLWH`.

### Công thức chính của tool (để đối chiếu)
- Bám đất theo góc (`anglesForPlane`, dòng 316): mặt đường `z = a·x + b·y + c`, pháp tuyến `n = (−a, −b, 1)/‖·‖`,
  `rx = atan2(−n_y, n_z)`, `ry = asin(n_x)`. Đúng vì cột thứ 3 của Rx·Ry·Rz là `(sin ry, −sin rx·cos ry, cos rx·cos ry)`, không phụ thuộc yaw.
- Mặt đất bền vững (`groundPeakZ`, dòng 384): histogram z, bin 2 cm, lấy lớp dày đặc **đầu tiên tính từ dưới lên** (≥ 0.5·max), lấy trung bình ±4 cm quanh đỉnh. Cách này loại được vỉa hè và thân xe.
- Loại trừ chuyển động (`staticCells`, dòng 3718): ô BEV 0.4 m, chỉ giữ ô có `z_max − z_min ≥ 0.5 m` (vật đứng), **bỏ các ô nằm trong box đã gán nhãn nới thêm 0.6 m**, rồi chạy ICP 2D point-to-line, bỏ 20% cặp xa nhất.
- Hướng theo chuyển động (`motionYaws`, dòng 3063): `ψ_i = atan2(Δy, Δx)` trong hệ chung (đã bù ego), lấy giữa i−2 và i+2. Đứng yên khi < 0.05 m/frame; đoạn di chuyển ngắn hơn 3 frame cũng coi là đứng yên; frame đứng yên lấy hướng của frame di chuyển gần nhất.
- RTS (`rtsSmooth`, dòng 3348): F = [[1, 1], [0, 1]], Q = q²·[[¼, ½], [½, 1]], σ theo chất lượng: `σ_pos = 0.05 + 0.45·(1 − quality)`, loại outlier khi lệch > 3σ + 0.25 m, tối đa 3 vòng.

### Danh sách bug
| # | Dòng | Vấn đề | Mức | Đề xuất |
|---|---|---|---|---|
| 1 | 1987–1992, 1949, 260–265, 4192 | **Giả định cảm biến ở gốc (0, 0)**: đặt mặt nhìn thấy (`if (lo > 0) return lo + size/2`), bán kính cluster `0.012·hypot(x, y)`, `withLWH` chế độ 'sensor', khoảng cách trong QA. Với cloud ở hệ world (mà `egoSummary` tự phát hiện được) thì box bị đẩy sai mặt | TB | truyền vị trí sensor theo frame (phần tịnh tiến của pose ego) |
| 2 | 1449, 1509, 1535, 1746 | `ensureGroundPlane` trả về **một** `groundPlane` toàn cục (ước lượng quanh một box ở một frame), sau đó `applyGroundFit` và `checkGround` dùng nó cho mọi frame. Sai trên dốc, và sai khi cloud ở hệ sensor | TB | ước lượng lại theo frame như `groundSweepCloud`, hoặc lưu kèm `plane.frame` |
| 3 | 4265–4275 | `cloudAtFrame` nhận biết cloud mới bằng `pos !== prev`. Khi `prev = null` (lúc bắt đầu `ensureEgo`, sau một frame bị thiếu, trong `groundSweepCloud`) thì có thể lấy nhầm mảng của frame cũ (nghi race) | TB | so thêm số frame, uuid/độ dài buffer và hash vài điểm |
| 4 | 3063–3075, 4534 | `motionYaws` coi xe luôn chạy tiến. Xe **lùi** thì sai 180°, và `planYawFix` sẽ "sửa" luôn những frame vốn đúng | TB | cho phép lùi (tốc độ thấp và ngược với hướng từ L-shape), hoặc đánh dấu cần duyệt |
| 5 | 9584–9592, 3003–3016 | Subscription của store và interval 1 s gọi `autoAttrTick`/`dockTick` **trong lúc** các batch async (`editRange`, `seqSnap`) đang `goToFrame`. Không có khóa toàn cục (chỉ có `fc.busy`), nên có thể `save()` đồng thời và snapshot xen kẽ nhau (nghi ngờ) | TB | dùng một async mutex chung, tick bỏ qua khi đang khóa |
| 6 | 3451, 3465 | `seqTargetPoints` wrap yaw. `interpAt` nội suy tuyến tính, nên từ +179° sang −179° nó đi vòng qua 0°. `chooseKeyframes` bù lại bằng cách thêm keyframe, làm phình số keyframe | Thấp–TB | ghi yaw đã unwrap (`syaw`) vào keyframe |
| 7 | 3264–3267 | `smoothTrack` dùng trọng số 0.25/0.5/0.25 theo **chỉ số** keyframe, bỏ qua khoảng cách thời gian | Thấp–TB | trọng số theo khoảng frame, hoặc dùng RTS |
| 8 | 4130–4131 | `overlapRule` so `normalizeClass(cls) === 'pedestrian'`, nên nhãn 'person'/'human' bị dung sai IoU = 0 | Thấp–TB | dùng `findClassGroup(cls) === 'pedestrian'` |
| 9 | 1267, 1287–1294 | `groundPlaneCache` chỉ dùng frame làm key. Đổi job trong SPA thì kế thừa plane của job trước | Thấp | key = `${jobId}:${frame}` |
| 10 | 922–931 | `getPointCloudPositions` bỏ qua `matrixWorld` của đối tượng Points (nghi ngờ) | Thấp | nhân với `matrixWorld`, hoặc assert nó là identity |
| 11 | 3421–3427 | Một vòng loại outlier mà xóa hết phép đo thì `rtsSmooth` trả về null, và `smoothSpan` bỏ luôn kết quả hợp lệ trước đó | Thấp | `if (!sx) break;` |
| 12 | 3828–3829 | `icp2d` tính inlier/rms **trước** khi áp bước cập nhật cuối, nên chất lượng báo ra trễ một bước | Thấp | tính lại sau bước cuối |
| 13 | 5339, 5352 | Xoay roll/pitch bằng phím W + X/Y cộng thẳng vào Euler rx/ry. Khi yaw ≠ 0 thì đó không phải trục cục bộ, cũng không phải trục world (Full Control làm đúng qua `fcWithPitchRoll`) | Thấp | dùng `fcRotatePitch`/`fcRotateRoll` |
| 14 | 425, 1938, 3497, 5773… | Hệ cục bộ chỉ dùng yaw, bỏ qua rx/ry. Sai số dưới 1° khi dốc ≤ 12–15° | Thấp | chấp nhận được |
| 15 | 289–293 | `percentile` lấy `floor(n·q)`, không nội suy. Khi n < 100 thì phân vị 0.99 chính là max, nên "1–99%" ở dòng 1982 không loại được outlier | Thấp | nội suy tuyến tính, hoặc yêu cầu n ≥ 200 |
| 16 | 1124, 1132 | `restoreLatestSnapshot` được định nghĩa hai lần | Thấp | xóa một bản |
| 17 | 471–476 | `fitRectYaw([])` chia cho 0 ra NaN (hiện đã có guard ở caller) | Thấp | trả null khi < 3 điểm |
| 18 | 2573–2578 | `normalizeClass` bỏ đuôi số nhiều sai: 'bus' → 'bu', 'trailer' → 'trail' | Thấp | dùng bảng alias |
| 19 | 2037 | `smartSnap` chỉ khớp theo `clientID`, nên gõ serverID thì bị bỏ qua | Thấp | dùng lại phần tra cứu của `getState` |
| 20 | 1183–1191 | `batch.edit` sửa state trước khi `save()`. Save lỗi thì snapshot không ghi lại thay đổi (nghi ngờ) | Thấp | push `before` trước khi save |
| 21 | 3718–3741 | Loại trừ chuyển động chỉ dựa vào box **đã gán nhãn**. Xe đang chạy mà chưa gán nhãn vẫn lọt vào ICP | Giới hạn thiết kế | mask theo detection |
| 22 | 6190 | Cảnh báo ghi "< 10 points" nhưng ngưỡng thật là 3 (dòng 1974) | Rất nhỏ | sửa câu chữ |

### Phần đem sang adastest
- Đã có sẵn tương đương: RTS (`pipeline/smoothing.py`), mask detection khi chạy VO (giống #21), ray–plane (`camera.pixels_to_ground`).
- Port lần này: (1) **luật `motionYaws`**: bỏ các đoạn di chuyển ngắn hơn 3 frame trước khi lấy hướng theo vận tốc (`smoothing.heading_from_velocity`); (2) **RTS cho chuỗi đường chân trời** (`horizon.estimate`), thay cho median trượt.
- Chỉ dùng được với LiDAR: `staticCells`, `snapCandidates`, `objectCluster`, `fitRectYaw`, `estimateGroundPlane`. Khi có LiDAR, `groundPeakZ` + `fitPlaneLSQ` thay được `horizon.py` (giống `sod_geo.ground_model` của buildphase).

## Cập nhật B14 (6/11)
Chạy lại clip02 với **yolo26x** (3270 detection, 254 track, trước đây yolo11m là 2513/202), pitch theo frame, và các sửa B10/B11/B18/B19:
M1, M2, M3 đều không có va chạm. **M1 hết va chạm** là bằng chứng scenario đã nhất quán: log ego không còn "đâm" agent trong log.

## B18: 🟢 AV ra khỏi map, `current_lane` chọn làn tùy ý

- **Hiện tượng:** clip02 M2: AV giữ 13.9 m/s trong khi người lái phanh xuống 1.3 m/s. Tới x ≈ 216 m (điểm cuối log 156 m + 60 m kéo dài) thì AV hết map. Từ t ≈ 16 s, `lane` báo `l_L1` dù y = 0.
- **Nguyên nhân:**
  1. `build_lanes(extend=60)` chỉ kéo dài cố định 60 m.
  2. `current_lane` loại mọi làn có `s` nằm ngoài [−5, length + 5]. Khi tất cả đều bị loại, nó `return next(iter(self.lines))`, tức là làn đầu tiên trong dict.
- **Sửa:**
  - `pipeline/run.py`: `extend = max(60, v_lim·duration − quãng_đường_log + 30)`.
  - `av_stack/planner.py` `current_lane`: xếp theo khóa `(ra_ngoài_làn, |d|)`, dùng |d| ngoại suy thay cho nhánh mặc định.

## B19: 🟢 Map không biết làn ngược chiều

- **Hiện tượng:** ở clip02, các ô tô ở y ≈ 4–7 m chạy về phía ego khoảng 45 km/h, nhưng map lại gắn `l_L1` là "làn bên trái cùng chiều". Planner (PDF ưu tiên vượt bên trái) có thể đổi sang làn này.
- **Sửa** (`pipeline/export.py` `infer_lane_directions`): mỗi agent đang chạy (v > 2 m/s) bỏ một phiếu cho làn gần nhất:
  ```
  phiếu = sign(cos(ψ_agent − ψ_làn(s)))     direction = −1 nếu Σ phiếu < 0 và có ≥ 2 phiếu (trừ l_ego)
  ```
  Schema thêm `lanes[].direction ∈ {1, −1}`. Planner bỏ qua làn có `direction < 0` khi chọn làn để đổi.
- **Kết quả:** clip02 cho `l_L1 = −1`, `l_ego = +1`, `l_R1 = +1`.
- **Giới hạn:** làn không có agent nào chạy qua thì mặc định là cùng chiều. Khi có lane detection hoặc OSM thì lấy chiều từ đó.

## B20: 🔴 Metric không phát hiện được kiểu lái "đúng luật nhưng nguy hiểm"

- **Hiện tượng:** clip02 M2/M3 được score **1.000**, nhưng AV giữ 50 km/h và đi qua chiếc xe buýt đang dừng (id 52, x ≈ 170, y ≈ −3) cùng người đi bộ ngồi sát bên, khoảng cách tối thiểu **1.2–2.1 m**. Người lái thật giảm từ 50 xuống 5 km/h. ADE = 38 m.
- **Nguyên nhân:** `eval/metrics.py` chỉ phạt va chạm, TTC (chỉ tính cho vật *trên path*), đèn đỏ, ra khỏi làn và comfort. Một vật đứng sát làn nhưng không nằm trên path thì không bao giờ có TTC.
  AV cũng không có luật giảm tốc gần người đi bộ hoặc xe đang dừng.
- **Đề xuất (cần bàn):**
  1. Metric "khoảng cách theo tốc độ": phạt nếu `v_ego > v_safe(d_lat)` khi đi ngang người đi bộ hoặc xe máy, ví dụ `v_safe = 2 + 4·max(d_lat − 1, 0)` m/s (cách 1 m thì ≤ 7 km/h, cách 3 m thì ≤ 36 km/h).
  2. AV: thêm giới hạn tốc độ như vậy vào `v_des` (`av_stack/stack.py`) cho các vật nằm trong hành lang ±3 m quanh path.
  3. So với người lái thật: cảnh báo khi `v_AV − v_log > 5 m/s` ở gần vật dễ tổn thương. Đó là tín hiệu người lái đã thấy một thứ mà AV không thấy.

## B21: 🟢 Unity: callback va chạm không chạy khi gọi `Physics.Simulate` từ editor

- **Đã làm:** port scenario sang Unity (`C:/Users/Admin/adastest/Assets/Scripts/Adas/`), viết self-test chạy `lead_brake` ở M2 trong batchmode,
  AV Python nối qua `bridge/tcp_server.py`.
- **Hiện tượng:** AV lái đúng (t = 5 s đổi sang làn trái y = 3.5, giống Python), nhưng `adas_collisions.csv` **rỗng**. Python có va chạm lúc t = 23 s.
- **Nguyên nhân:** `OnTriggerEnter` là message của MonoBehaviour và chỉ được gửi trong Play mode. Self-test gọi `Physics.Simulate` trong edit mode
  nên không bao giờ nhận callback. Ngay cả trong Play mode, phát hiện va chạm dựa vào callback cũng phụ thuộc thứ tự sự kiện của engine.
- **Sửa:** sau mỗi `Physics.Simulate(dt)`, `ScenarioPlayer.CheckCollisions()` gọi
  `Physics.OverlapBox(tâm ego, (W, H, L)/2, rot ego, ~0, QueryTriggerInteraction.Ignore)`. Collider của ego là trigger nên tự bị loại.
  Mỗi agent chỉ log lần chạm đầu (`HashSet`), giống `_collided` bên Python. Kết quả giống nhau ở Play mode và self-test.

## B22: 🟢 Unity: vùng chạm luôn ra `side`

- **Hiện tượng:** sau khi sửa B21, Unity bắt được va chạm lúc t = 23.00 s, xe máy #2, v_ego = 9.31 m/s (trùng Python), nhưng báo `zone = side`, còn Python báo `rear`.
- **Nguyên nhân:** `transform.InverseTransformPoint(p)` khử luôn **localScale**. Cube ego có scale (W, H, L) = (1.8, 1.5, 4.5), nên z cục bộ nằm trong khoảng
  [−0.5, 0.5] (đơn vị chuẩn hóa), không bao giờ vượt ngưỡng `L/4 = 1.125 m`.
- **Sửa** (`EgoCollision.Zone`): `p = Quaternion.Inverse(ego.rotation) · (điểm − ego.position)`, chỉ khử xoay và tịnh tiến, kết quả tính bằng mét.
- **Kết quả đối chiếu Python ↔ Unity:**

| Scenario | Python | Unity |
|---|---|---|
| lead_brake M2 | va chạm t = 23.00, motorbike #2, rear, v = 9.31 | **t = 23.00, motorbike #2, rear, v = 9.31** |
| clip02 M2 (t = 5/10/15/20 s) | x = 69.44 / 138.89 / 208.33 / 277.78, v = 13.89 | **giống hệt** |

  → Port bước 1 (kinematic bicycle + agent theo log) **khớp tất định** với sim Python. Bước tiếp theo: thay ego bằng RCC (vật lý thật) rồi đo lại độ lệch.

## B23: 🟢 Unity: `GetComponent<T>() ?? AddComponent<T>()` không bao giờ AddComponent

- **Hiện tượng:** chụp ảnh batchmode báo `MissingComponentException: There is no 'Rigidbody' attached to "motorbike_1"`.
- **Nguyên nhân:** khi không có component, trong editor `GetComponent` trả về một object "null giả" (fake null) để báo lỗi rõ hơn.
  Toán tử `==` của Unity coi nó là null, nhưng `??` (và `?.`) của C# so sánh tham chiếu thật, nên thấy khác null và không gọi `AddComponent`.
- **Sửa** (`ScenarioPlayer.AddAgent`): `var rb = go.GetComponent<Rigidbody>(); if (rb == null) rb = go.AddComponent<Rigidbody>();`
- **Quy tắc:** với `UnityEngine.Object` thì **không dùng `??`/`?.`**, luôn dùng `== null`.

## B24: 🟢 Unity: texture nhiễu bị vân tròn lặp lại

- **Hiện tượng:** ảnh nhìn từ trên thấy cỏ có các vân hình "0" lặp đều.
- **Nguyên nhân:** `AdasAssets.Noise` lấy Perlin theo `cos(2πu)`, `sin(2πv)` để tạo texture lặp được. Cách này ánh xạ mỗi trục lên một đường tròn
  (không phải mặt xuyến 4D), nên sinh ra vân tròn.
- **Sửa:** value noise nhiều tầng (octave) trên lưới **tuần hoàn** (chỉ số `% g`), nội suy smoothstep. Lặp không thấy đường nối.

## B25: 🟢 Unity: scene trống khi mở, ego đứng ngay mép đường

- **Hiện tượng (cậu báo):** "scene chẳng có gì cả". Bản đầu dựng mọi thứ **lúc bấm Play**, nên mở scene trong editor không thấy gì.
  Thêm nữa, map sinh từ quỹ đạo ego bắt đầu đúng ở vị trí ego lúc t = 0, nên phía sau xe là bãi cỏ.
- **Sửa:**
  - Menu `ADAS → Dựng scene: ...` (`AdasMenu.BuildScene`) dựng sẵn môi trường + xe (Preview) rồi lưu scene. Mesh, material và texture sinh ra
    được lưu thành asset trong `Assets/Adas/Generated/<scenario>/` (`PersistGenerated`); nếu không, scene lưu xong sẽ mất tham chiếu.
    Đã kiểm tra bằng cách mở lại scene đã lưu và render (`AdasShots.SavedClip02`).
  - `RoadBuilder.Centerline` kéo dài làn thêm 60 m về phía sau (chỉ để hiển thị).

## B26: 🟢 Map quá hẹp so với đường thật

- **Hiện tượng:** khi xem clip02 trong Unity, xe máy và ô tô chạy trên vỉa hè. Đo lại: **46%** vị trí agent có |y| > 5.25 m (ngoài 3 làn × 3.5 m).
- **Nguyên nhân:** `--lanes-left 1 --lanes-right 1` cố định. Đường thật dưới cầu cạn có nhiều làn mỗi chiều.
- **Sửa** (`pipeline/export.py` `infer_lane_counts`, `run.py --lanes-left/--lanes-right auto`): với xe đang chạy (v > 2 m/s, bỏ người đi bộ),
  lấy độ lệch ngang d so với quỹ đạo ego:
  ```
  n_bên = clip( ceil((P80(|d|) − w/2) / w), 1, 3 )
  ```
  Thêm luật giao thông bên phải trong `infer_lane_directions`: làn ngược chiều chỉ nằm bên trái ego, và đã ngược chiều thì mọi làn xa hơn
  về bên trái cũng ngược chiều. Làn bên phải luôn cùng chiều (bản trước có `l_R2 = −1` kẹp giữa hai làn +1 do phiếu nhiễu).
- **Kết quả clip02:** 2 làn ngược chiều + làn ego + 3 làn cùng chiều (21 m), xe nằm ngoài lòng đường còn **13%**. Phần còn lại chủ yếu do sai số lift 3D ở xa (B05/B07).

## Port xe ego sang RCC Pro (vật lý thật): các bug B27–B34

**Đã làm:** `ScenarioPlayer.egoModel = RCC` spawn prefab `RCCP_PrototypeVehicle_Skyline` (prefab xe duy nhất có trong gói đã import).
Bộ điều khiển cấp thấp `RccDriver.cs` chuyển lệnh của AV (δ, a) sang input của RCC, giống "加速度控制器-逆模型" ở PDF mục 6.4.5:
```
u = a_cmd / A_max  +  kp·(a_cmd − a_đo)/A_thr  +  ki·∫(a_cmd − a_đo)dt      (A_thr = 4, A_brk = 9 m/s², kp = 0.6, ki = 0.8)
throttle = max(u, 0),  brake = max(−u, 0),  a_đo = LPF(dv/dt, τ = 80 ms)
steerInput = −δ[°] / maxSteerAngle(40°)      (AV: δ > 0 rẽ trái; RCC: steerInput > 0 rẽ phải)
```
Kiểm tra bằng harness Play mode trong batchmode: `Adas.EditorTools.AdasPlayTest.LeadBrakeRcc` / `LeadBrakeKinematic`, kết quả ở `Logs/adas_ego_*.csv`.

### B27: 🟢 Chế độ vật lý Script không gọi FixedUpdate
Sim kinematic tự gọi `Physics.Simulate(dt)` (`SimulationMode.Script`) để chạy lockstep. RCC tính lực bánh, động cơ, hộp số trong `FixedUpdate`, mà ở chế độ Script thì Unity không gọi `FixedUpdate`, nên xe đứng im.
**Sửa:** khi dùng RCC thì `SimulationMode.FixedUpdate`, `fixedDeltaTime = dt/5` = 0.01 s. AV vẫn chỉ được gọi mỗi 0.05 s (`RccLogicStep` ở substep đầu); agent di chuyển theo từng substep.

### B28: 🟢 (giả thuyết sai) Tâm xe tính từ Renderer.bounds
Khi thấy xe bị văng, tớ nghi do tâm xe tính từ `Renderer.bounds` (prefab RCC có nhiều renderer phụ). Đổi sang WheelCollider:
`tâm = trung bình vị trí bánh`, `cao pivot = −trung bình(y_bánh − r)`. Kết quả: pivot cao 0.51 m, nóc 1.91 m. **Xe vẫn văng**, nên đây không phải nguyên nhân (xem B29). Cách tính mới vẫn giữ vì đúng hơn.

### B29: 🟢 Xe RCC bị văng ~2300 m/s ngay bước vật lý đầu
- **Chẩn đoán:** log 12 substep đầu. Ở substep 0, hộp ego **chồng lên `car_1`, `motorbike_2` và các bộ phận `body`, `cabin`, `wheel_f`...**; sang substep 1 thì `vel = (−2327, 104, 265)`.
- **Nguyên nhân, 2 lỗi cộng dồn:**
  1. `Restart` đặt agent bằng `Rigidbody.MovePosition`. Lệnh này chỉ có hiệu lực ở bước vật lý sau và **quét** vật từ chỗ cũ tới chỗ mới. Agent mới tạo đang ở gốc (0, 0), trùng chỗ ego, nên khi quét tới x = 30 / −25 nó đâm xuyên xe RCC với khối lượng vô hạn.
  2. `RoadBuilder.Kill` dùng `Destroy()` trong Play mode. Lệnh này **hoãn tới cuối frame**, nên collider của các bộ phận model (primitive) vẫn còn trong bước vật lý đầu tiên.
- **Sửa:** khi khởi tạo hoặc khi agent vừa xuất hiện thì dịch chuyển tức thời (`transform` + `rb.position`), chỉ dùng `MovePosition` khi đang chạy. `Kill` luôn dùng `DestroyImmediate` (chỉ cho object trong scene).

### B30: 🟢 Phanh không ăn trong ~2 s đầu
- **Hiện tượng:** brake = 1.0 nhưng a_đo ≈ −0.2 m/s², v còn tăng nhẹ 12.0 → 12.8.
- **Nguyên nhân:** spawn với vận tốc 12 m/s nhưng **bánh xe đứng yên (0 rpm)**, nên tỉ số trượt κ = (ωr − v)/v = −1, ABS nhả phanh. Thêm vào đó `RCCP_Engine.StartEngineDelayed` chờ 1 s mới chạy.
- **Sửa:** pha làm nóng 1.5 s trước t = 0. Mỗi substep giữ `rb.position/rotation` ở tư thế ban đầu và `rb.linearVelocity = v0·forward`, để bánh lăn theo mặt đường và động cơ khởi động xong.

### B31: 🟢 Deadzone của RCC làm mất lệnh lái nhỏ
- **Hiện tượng:** lệnh δ = 0.06 rad nhưng bánh chỉ quay 0.03 rad. Đổi làn chậm (y = 0.04 m lúc t = 1 s, kinematic là 1.08 m).
- **Nguyên nhân:** `RCCP_Input.ApplyDeadzone`: `|u| < 0.05 → 0`, ngược lại `u' = (|u| − 0.05)/0.95`. Với u = 0.086 thì u' = 0.038. Mọi hiệu chỉnh giữ làn < 2° bị xóa hẳn.
  Deadzone này để chống rung tay cầm analog, không dành cho lệnh từ AV.
- **Sửa:** `RccDriver.Init` đặt mọi deadzone = 0. Sau khi sửa, RMSE bám lái còn **0.27°**.

### B32: 🟡 Agent kinematic kéo lê xe sau va chạm
- **Hiện tượng:** sau khi xe máy tông, ego chạy đều đúng 14 m/s (bằng vận tốc xe máy) dù brake = 1. Agent `log_replay` là kinematic (khối lượng vô hạn), cứ thế đẩy xe đi theo quỹ đạo log của nó.
- **Vá:** đã ghi nhận va chạm thì chuyển collider của agent đó thành trigger, để phần còn lại của bài vẫn chạy được.
- **Đúng hơn (sau này):** agent đã va chạm chuyển sang Rigidbody động có khối lượng thật (ô tô 1500 kg, xe máy 250 kg), hoặc dừng bài thử.

### B33: 🟢 (AV) Đổi làn không kiểm tra lại làn đích
- **Hiện tượng (lộ ra nhờ RCC):** xe RCC đổi làn chậm hơn, trong lúc đó xe máy 14 m/s ở làn đích từ phía sau đuổi kịp và tông đuôi (t = 4.75 s). Với kinematic thì không xảy ra, vì đổi làn nhanh.
- **Nguyên nhân:** `LanePlanner._decide_lane` chỉ gọi `_lane_safe` lúc quyết định, sau đó `return self.target` cho tới khi xong.
- **Sửa** (`av_stack/planner.py`): mỗi chu kỳ đang đổi làn đều kiểm tra lại với ngưỡng nhẹ hơn: `rear = 5 + 1.5·max(0, v_xe − v_ego)`, `front = 4 + 0.8·max(0, v_ego − v_xe)`.
  Không an toàn thì quay về làn cũ và chờ `lc_min_interval` mới thử lại.

### B34: 🟢 (AV) Dự đoán τ > 0 phanh trước một xe nhanh hơn đang bám đuôi
- **Hiện tượng:** lúc t = 4–8 s, planner báo lead = xe máy #2 (gap 14.9 → 4.6 m) trong khi xe máy đang **ở phía sau** ego. AV phanh −1.9 m/s² và bị tông đuôi (t = 6.25 s).
- **Nguyên nhân:** phần dự đoán τ = 1, 2 s (bản sửa B11) đặt vị trí tương lai của xe máy (nhanh hơn ego) ra trước ego trên path, nên nó thành "lead".
- **Sửa** (`_find_leads`): với τ > 0 chỉ xét vật **cắt ngang**: bỏ nếu `cos(ψ_vật − ψ_path) > cos 30°`. Xe cùng chiều chỉ xét ở τ = 0.

### Kết quả sau khi sửa (lead_brake, M2, cùng AV Python)
| | Python sim | Unity kinematic | Unity RCC Pro |
|---|---|---|---|
| Va chạm | t = 22.75 s, xe máy #2, rear | **t = 22.75 s, rear (khớp)** | t = 21.80 s, rear |
| Sang làn trái (y > 1.75) | | 1.60 s | 2.45 s |
| Dừng đèn đỏ (tâm xe; vạch ≈ 324.75) | 320.2 | 322.7 | 321.1 |
| Bám gia tốc / lái (RMSE) | | 0 / 0 | **0.58 m/s² / 0.27°** |
| Lệch vị trí so với kinematic (TB / max) | | | 5.1 m / 7.8 m |

Lưu ý quy trình: lần so sánh đầu tớ dùng CSV kinematic chạy với **planner cũ** (bridge vẫn giữ code cũ trong bộ nhớ), nên tưởng ego vượt đèn đỏ.
→ Mỗi khi sửa `av_stack/` phải **khởi động lại `bridge/tcp_server.py`**.

## B35: 🔴 Xe máy ngã không có hiệu ứng, người tự nhiên xuất hiện

- **Hiện tượng (cậu báo):** trong clip02, đoạn xe máy đâm rồi ngã không có hiệu ứng gì, và tự nhiên có một người hiện ra.
- **Bằng chứng:** trong `scenarios/generated/clip02.json`, `pedestrian #974` bắt đầu đột ngột lúc t = 12.8 s (x ≈ 155, y ≈ −2.1, 60 detection tới t = 16.7 s).
  Trong `work/clip02/tracks.parquet` không có track xe máy nào ở phần ảnh đó nối với nó (lọc x1 > 900, y2 > 600, t = 9–17 s, từ 3 detection trở lên).
- **Nguyên nhân:**
  1. Pipeline chỉ có box theo từng class, không có khái niệm "ngã". Xe máy nằm trên đường khó được YOLO nhận là `motorbike` nên track bị mất (nghi ngờ, chưa kiểm tra từng frame).
  2. Lúc còn ngồi trên xe, người bị `suppress_riders` bỏ đi, nên khi tách khỏi xe thì thành track `pedestrian` mới, không liên kết với xe.
  3. Unity bật agent bằng `SetActive(true)` đúng lúc track bắt đầu, nên hiện ra tức thì.
  4. Trajectory chỉ có x, y, yaw: không có roll để biểu diễn xe đổ.
- **Hướng sửa (chưa làm):** pipeline sinh event `fall` bằng cách ghép track `pedestrian` mới với track xe hai bánh vừa mất ở gần đó (cách nhau < 2 m và < 1.5 s). Unity đổi agent từ kinematic sang Rigidbody/ragdoll tại thời điểm đó.

## B36: 🔴 Unity chưa đọc `events`, scene jaywalker không có người đi bộ

- **Hiện tượng:** `ScenarioPlayer.cs` không xử lý trường `events` của scenario (chỉ sim Python M4 có). Scene `Adas_jaywalker` vì vậy chạy giống `lead_brake`.
- **Đính chính:** khi bàn giao scene, tớ đã mô tả scene này là "có thêm người đi bộ băng qua đường". Mô tả đó sai.
- **Hướng sửa (chưa làm):** đọc `events` trong Unity, làm chung với cơ chế trigger cho kịch bản (xem `docs/HE_THONG.md`, mục 10, và B13).

### Cập nhật B35 (09/11): nguyên nhân cũ sai một phần
Xem lại video: người và xe máy **đã nằm trên đường từ trước t = 9.5 s**, ngay trước đầu xe buýt. Không phải người "văng ra" lúc 12.8 s như tớ ghi, mà YOLO chỉ bắt được người đang nằm khi ego tới gần, và không bao giờ bắt được xe nằm.
**Sửa:** `pipeline/downed.py`: người có v trung vị < 1 m/s, box `cao/rộng < 1.3`, trong lòng đường thì gán `posture = "down"`, kéo dài quỹ đạo về trước (tới lúc vào tầm 60 m), và thêm xe máy nằm cạnh với `inferred = true` (**suy ra, không đo được**). Clip02 bắt được #974.
**Còn thiếu:** thời điểm ngã thật không đo được, nên trong sim họ nằm sẵn từ đầu, không có cảnh ngã.
Riêng va chạm với ego thì có hiệu ứng: `ScenarioPlayer.StartCrash` / `CrashTick`: trượt với −6 m/s², xe hai bánh và người đổ 90°, ô tô dừng lại và vẫn là vật cản.

## B37: 🔴 RCC không tất định, kết cục phân nhánh ở quyết định hủy đổi làn

- **Hiện tượng:** `lead_brake`, M2, RCC, cùng code, 4 lần chạy: lần 1 không hủy đổi làn, bị xe máy tông lúc t = 6.05 s; lần 2–4 hủy đổi làn (y 2.2 → 0.2) và không va chạm (cuối x ≈ 314.7, sai khác dưới 0.2 m giữa các lần).
- **Nguyên nhân:** vật lý PhysX + `Time.deltaTime` thay đổi làm trạng thái lệch rất nhỏ, và `_lane_safe` là ngưỡng cứng (`rear = 5 + 1.5·Δv`), nên xe máy nằm sát ngưỡng thì kết quả rẽ nhánh.
- **Hệ quả:** số liệu RCC trước đó (va chạm lúc khoảng 21.8 s) chỉ là một nhánh. Với RCC phải **chạy nhiều lần và báo tỉ lệ**, không dùng một lần chạy.
- **Hướng sửa (chưa làm):** thêm hysteresis cho quyết định hủy; harness chạy N lần.

## B38: 🔴 `cut_in` M2: Unity có va chạm, sim Python thì không

- **Đã làm:** quay video demo bằng `Editor/AdasRecord.cs` (kinematic, Physics Script, `dt = 1/30` để mỗi bước sim là một frame), AV Python nối qua bridge.
- **Hiện tượng:** Unity `cut_in` M2 kết thúc với `CollisionCount = 1`. Sim Python cùng scenario thì không va chạm, ở cả hai dt:
  - `dt = 0.05`: min_distance = 0.399 m, min TTC = 0.27 s
  - `dt = 1/30`: min_distance = 0.233 m, min TTC = 0.11 s

  Đây là một tình huống suýt va chạm, khoảng hở dưới 0.4 m.
- **Nghi ngờ (chưa kiểm):** collider của agent trong Unity lớn hơn hộp `L×W` mà Python dùng (ví dụ collider bao theo mesh có gương, cản). Hộp ego hai bên giống nhau: `OverlapBox(W, H, L)` ở `ScenarioPlayer.cs:922`, `box_corners(L, W)` ở `sim/world.py`. Chỉ cần lệch khoảng 0.12 m mỗi bên là đủ để 0.23 m thành va chạm.
- **Công thức:** Python coi là va chạm khi `boxes_overlap(ego_box, agent_box)` (SAT trên 2 hộp L×W). Unity coi là va chạm khi `Physics.OverlapBox(ego)` chạm bất kỳ collider nào có `AgentTag`.
- **Cách kiểm:** in `collider.bounds.size` của xe `cutter` và so với `size` trong scenario, rồi in `t` va chạm trong `Logs/adas_collisions.csv` (file này bị ghi đè sau mỗi kịch bản, nên phải chạy riêng `cut_in`).
- **Hệ quả:** với kịch bản sát ngưỡng, số va chạm giữa hai sim không so trực tiếp được. Nên báo kèm min_distance.

