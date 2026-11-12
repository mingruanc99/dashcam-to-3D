"""Simulator 2D tham chiếu (Python). Đây là bản đặc tả hành vi để viết lại trong Unity.

Không render gì cả, chỉ có vật lý đơn giản, agent và metrics. Dùng để:
- test AV stack và scenario khi chưa có Unity, chạy rất nhanh (hàng trăm lần thời gian thực);
- làm "đáp án": cùng một scenario và mode thì Unity phải cho kết quả gần giống.
"""

import common  # noqa: F401,E402  (stdout UTF-8, xem common/__init__.py)
