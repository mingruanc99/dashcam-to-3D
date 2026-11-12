"""AV stack baseline: planning + control (PLAN.md mục 7).

Thiết kế dựa theo 自动驾驶系统方案.pdf:
- planner.py: local planner kiểu lấy mẫu. Giữ làn (cartip), chuyển làn (rollin),
  kiểm tra làn đích (rollout), sau đó làm mượt bằng smoothPath. Xem PDF mục 5.2.
- control.py: điều khiển ngang dùng pure pursuit, có saturation và rate limiter
  (PDF mục 6.3.4). Điều khiển dọc chuyển giữa điều khiển tốc độ (PI) và điều
  khiển khoảng cách (PDF mục 6.4.1-6.4.4), thêm AEB.
- stack.py: ghép các phần trên lại. Interface là dict thuần, nên cùng một code
  chạy được với sim Python, với Unity qua bridge, và sau này với ROS2.
"""

from .stack import AVStack  # noqa: F401
