"""Hằng số dùng chung cho pipeline."""

# Kích thước chuẩn theo class: (dài, rộng, cao) mét — PLAN.md mục 3.
CLASS_SIZES = {
    "car": (4.5, 1.8, 1.5),
    "suv": (4.8, 1.9, 1.7),
    "truck": (7.5, 2.4, 3.0),
    "bus": (11.0, 2.5, 3.2),
    "motorbike": (1.9, 0.7, 1.5),
    "bicycle": (1.7, 0.6, 1.6),
    "pedestrian": (0.5, 0.5, 1.7),
}

# COCO class id (YOLO pretrained) -> class của scenario.
COCO_TO_CLASS = {
    0: "pedestrian",
    1: "bicycle",
    2: "car",
    3: "motorbike",
    5: "bus",
    7: "truck",
}
COCO_TRAFFIC_LIGHT = 9

VEHICLE_CLASSES = {"car", "suv", "truck", "bus"}
TWO_WHEELERS = {"motorbike", "bicycle"}

# Chiều cao vỏ đèn giao thông 3 bóng (m), dùng để ước lượng khoảng cách tới đèn.
TRAFFIC_LIGHT_HEIGHT = 1.0

# Chỉ tin agent trong bán kính này (PLAN.md mục 13: depth đơn mắt sai ở xa).
MAX_AGENT_RANGE = 60.0

SCHEMA_VERSION = "0.1"
