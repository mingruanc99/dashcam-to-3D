# Điều kiện các bài test (`tests/test_core.py`)

Chạy: `.venv\Scripts\python -m pytest -q tests`

## Nhóm A: toán và hình học (unit test, nên giữ chặt)

Những test này kiểm tra công thức, nên chỉ cần sai là sai thật. Ngưỡng chặt là hợp lý.

| # | Test | Điều kiện pass | Kiểm tra điều gì |
|---|---|---|---|
| A1 | `test_camera_ground_roundtrip` | chiếu 3 điểm mặt đường (8, 25, 40 m) lên ảnh rồi chiếu ngược xuống, sai số **< 1e-6 m** | `project` và `pixels_to_ground` là nghịch đảo của nhau, pitch 3°, FOV 110° |
| A2 | `test_horizon_pitch` | chân trời ở hàng 500 (trên tâm 540) cho ra **pitch > 0**; `horizon_row` quay lại 500 với sai số **< 1e-6 px** | dấu của pitch và công thức `θ = atan((cy − v_hor)/fy)` |
| A3 | `test_enu_roundtrip` | lat/lon → mét → lat/lon sai **< 1e-9°**; điểm lệch 0.001° cho x ∈ [100, 110] m, y ∈ [105, 115] m | phép chiếu ENU cục bộ |
| A4 | `test_rts_recovers_constant_velocity` | nhiễu 0.8 m, mất 1.5 s dữ liệu → RMSE **< 0.4 m**, vận tốc trung vị lệch **< 0.3 m/s** so với 8 m/s | Kalman + RTS, nối track bị đứt |
| A5 | `test_polyline_frenet` | điểm (5, 2) cho ra s = 5, d = 2 **chính xác**; đổi ngược lại khớp | hệ Frenet (s, d) |
| A6 | `test_box_overlap` | hai hộp chồng lấn và xoay 0.3 rad thì **phát hiện va chạm**; hai hộp cách nhau 1.5 m thì **không** | SAT va chạm |
| A7 | `test_examples_valid` | scenario mẫu **không có lỗi** JSON Schema | schema |

## Nhóm B: hành vi trong sim (đây là nhóm đang chặt)

| # | Test | Điều kiện hiện tại | Vấn đề |
|---|---|---|---|
| B1 | `test_av_handles_lead_brake[M2]` | va chạm **= 0**, vượt đèn đỏ = 0, progress > 0.9 | **FAIL**: xe máy chạy theo log (không phản ứng) tông đuôi ego. Ở M2 lỗi này không phải do AV (BUG_LOG B12) |
| B2 | `test_av_handles_lead_brake[M3]` | giống B1 | pass |
| B3 | `test_av_stops_for_jaywalker` | M4, va chạm = 0 | pass, **nhưng không kiểm tra được gì** vì người đi bộ xuất hiện sau khi AV đã đi qua (B13) |

### Đề xuất nới, chờ cậu chọn

1. **Chỉ đếm va chạm do AV gây ra** (at-fault). Có hai cách xác định:
   - (a) điểm va chạm nằm ở **nửa trước** của ego (`x_local > 0`), hoặc
   - (b) agent đang ở mode `reactive`. Agent `log_replay` không né được nên va chạm từ phía sau không tính cho AV.

   Đây cũng là cách nuPlan làm (bỏ qua "at-fault" khi ego bị tông từ phía sau, ego đứng yên hoặc chạy thẳng).
   Unity sẽ kiểm tra cùng điều kiện này bằng va chạm vật lý thật (xem `UNITY_B12.md`).
2. **progress > 0.8** thay vì 0.9. AV được phép chậm hơn người lái thật khi nó chọn chạy thận trọng.
3. **Thêm điều kiện "có tương tác"** cho các test tình huống: ví dụ jaywalker phải làm AV giảm tốc dưới 50% tốc độ trước đó ở gần vị trí người đi bộ. Nếu không có tương tác thì test **fail vì scenario sai**, không phải pass.
4. **Thêm comfort** dưới dạng cảnh báo (không fail): max decel < 4 m/s², p95 jerk < 6 m/s³.
5. Nhóm A giữ nguyên ngưỡng chặt.
