"""Local planner kiểu lấy mẫu (PDF mục 5.2).

    ego ──cartip──▶ ──── rollin ────▶ ════ rollout (làn đích) ════▶
         (giữ làn)     (chuyển dần)      (kiểm tra vật cản để quyết định đổi làn)

- cartip: đoạn ngắn giữ nguyên làn hiện tại, dài khoảng v * keep_time. Đoạn này
  quyết định việc đổi quỹ đạo có mượt hay không.
- rollin: đoạn chuyển ngang từ làn hiện tại sang làn đích. Xe chạy càng nhanh
  thì đoạn này càng dài. Đoạn chuyển được tính theo độ lệch so với làn ĐÍCH,
  nên đổi làn hội tụ dần (xem chú thích trong plan()).
- rollout: các làn song song phía trước, dùng để kiểm tra làn nào trống.
Sau đó làm mượt bằng smoothPath (weight_data, weight_smooth, tolerance) đúng
như PDF mục 5.2.4. PDF ưu tiên làn bên trái khi muốn vượt (prefer_left).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from common.geometry import Polyline, wrap


@dataclass
class PlannerParams:
    point_distance: float = 1.0
    horizon: float = 70.0
    keep_time: float = 0.6
    keep_min: float = 4.0
    rollin_time: float = 1.2
    rollin_min: float = 10.0
    corridor_margin: float = 0.35
    # quyết định đổi làn
    lane_change: bool = True
    lc_trigger_dist: float = 45.0
    lc_slow_margin: float = 2.5
    lc_gain: float = 15.0
    lc_min_interval: float = 6.0
    lc_rear_gap: float = 10.0
    lc_front_gap: float = 12.0
    prefer_left: bool = True
    # làm mượt (PDF smoothPath)
    weight_data: float = 0.2
    weight_smooth: float = 0.35
    tolerance: float = 1e-3


def smooth_path(path: np.ndarray, weight_data: float, weight_smooth: float,
                tolerance: float, max_iter: int = 200) -> np.ndarray:
    """Làm mượt bằng gradient descent, giữ cố định hai điểm đầu và cuối.

    weight_data kéo điểm về lại vị trí gốc để tránh lệch đột ngột. weight_smooth
    kéo mỗi điểm về trung bình của hai điểm bên cạnh để đường mượt hơn.
    """
    new = path.copy()
    for _ in range(max_iter):
        old = new.copy()
        new[1:-1] += weight_data * (path[1:-1] - new[1:-1]) + \
            weight_smooth * (new[:-2] + new[2:] - 2 * new[1:-1])
        if np.abs(new - old).sum() < tolerance:
            break
    return new


def _smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


@dataclass
class LocalPath:
    xy: np.ndarray
    line: Polyline
    lane_id: str
    target_lane_id: str
    kappa_max: float
    leads: list = field(default_factory=list)  # [(gap_s, v_along, id, kind)]


class LanePlanner:
    def __init__(self, lanes: list[dict], params: PlannerParams | None = None):
        self.p = params or PlannerParams()
        self.lanes = {l["id"]: l for l in lanes}
        self.lines = {l["id"]: Polyline(l["centerline"]) for l in lanes}
        self.target: str | None = None
        self.last_lc_t = -1e9
        self.hints: dict[str, int] = {}

    # ------------------------------------------------------------------ tiện ích
    def _proj(self, lane_id, x, y):
        s, d, k = self.lines[lane_id].project(x, y, self.hints.get(lane_id))
        self.hints[lane_id] = k
        return s, d

    def current_lane(self, x, y) -> str:
        # Chọn làn gần nhất theo |d|. Ra ngoài hai đầu làn thì vẫn dùng |d| ngoại suy (Polyline.project
        # đã ngoại suy thẳng) thay vì trả về làn đầu tiên trong dict (B18).
        best, best_key = None, (math.inf, math.inf)
        for lid in self.lines:
            s, d = self._proj(lid, x, y)
            outside = max(0.0, -5 - s, s - self.lines[lid].length - 5)
            key = (outside > 0, abs(d))
            if key < best_key:
                best, best_key = lid, key
        return best

    def _lane_objects(self, lane_id, s_ego, objects, ego_w):
        """Các vật nằm trong làn: danh sách (khoảng s tương đối, v dọc làn, obj)."""
        half = self.lanes[lane_id]["width"] / 2
        line = self.lines[lane_id]
        out = []
        for o in objects:
            s, d, _ = line.project(o["x"], o["y"])
            if abs(d) < half + o.get("width", 1.8) / 2 - 0.3:
                _, yaw = line.point(s)
                out.append((s - s_ego, o["v"] * math.cos(o["yaw"] - yaw[0]), o))
        return out

    def _free_ahead(self, lane_id, s_ego, objects, ego_w):
        ahead = [(ds, v) for ds, v, _ in self._lane_objects(lane_id, s_ego, objects, ego_w) if ds > 0]
        return min(ahead) if ahead else (self.p.horizon * 2, 99.0)

    def _lane_safe(self, lane_id, s_ego, v_ego, objects, ego_w, rear=None, rear_k=2.5, front=None, front_k=1.5) -> bool:
        """An toàn khi không có xe trong khoảng [−rear_gap, +front_gap] quanh ego ở làn đó.
        rear_gap = rear + rear_k·max(0, v_xe − v_ego): xe phía sau càng nhanh hơn thì càng cần khoảng trống."""
        rear0 = self.p.lc_rear_gap if rear is None else rear
        front0 = self.p.lc_front_gap if front is None else front
        for ds, v, o in self._lane_objects(lane_id, s_ego, objects, ego_w):
            rear = rear0 + max(0.0, v - v_ego) * rear_k
            front = front0 + max(0.0, v_ego - v) * front_k
            if -rear < ds < front:
                return False
        return True

    # ------------------------------------------------------------------ quyết định
    def _decide_lane(self, t, cur, s_ego, v_ego, v_des, objects, ego_w) -> str:
        p = self.p
        if self.target and self.target != cur:
            # Đang đổi làn: kiểm tra LẠI làn đích mỗi chu kỳ. Xe chậm đổi làn (vật lý thật, RCC) cho xe phía sau
            # ở làn đích kịp đuổi tới; trước đây chỉ kiểm tra 1 lần lúc quyết định nên bị tông đuôi (BUG_LOG B33).
            s_t, _ = self._proj(self.target, *self.lines[cur].point(s_ego)[0][0])
            if not self._lane_safe(self.target, s_t, v_ego, objects, ego_w, rear=5.0, rear_k=1.5, front=4.0, front_k=0.8):
                self.last_lc_t = t  # hủy, quay về làn cũ, chờ lc_min_interval mới thử lại
                return cur
            return self.target  # đang đổi làn: giữ cam kết đến khi xong
        if not p.lane_change or t - self.last_lc_t < p.lc_min_interval:
            return cur
        gap, v_lead = self._free_ahead(cur, s_ego, objects, ego_w)
        if gap > p.lc_trigger_dist or v_lead > v_des - p.lc_slow_margin:
            return cur
        lane = self.lanes[cur]
        cands = [lane.get("left"), lane.get("right")] if p.prefer_left else [lane.get("right"), lane.get("left")]
        for cand in cands:
            if not cand or cand not in self.lines or self.lanes[cand].get("direction", 1) < 0:
                continue  # không bao giờ đổi sang làn ngược chiều (B19)
            s_c, _ = self._proj(cand, *self.lines[cur].point(s_ego)[0][0])
            g2, _ = self._free_ahead(cand, s_c, objects, ego_w)
            if g2 > gap + p.lc_gain and self._lane_safe(cand, s_c, v_ego, objects, ego_w):
                self.last_lc_t = t
                return cand
        return cur

    # ------------------------------------------------------------------ plan
    def plan(self, t: float, ego: dict, objects: list[dict], v_des: float) -> LocalPath:
        p = self.p
        x, y, v = ego["x"], ego["y"], max(ego["v"], 0.0)
        cur = self.current_lane(x, y)
        s0, d0 = self._proj(cur, x, y)
        if self.target is None or self.target == cur:
            self.target = cur
        target = self._decide_lane(t, cur, s0, v, v_des, objects, ego.get("width", 1.8))
        self.target = target

        keep = max(p.keep_min, v * p.keep_time)
        rollin = max(p.rollin_min, v * p.rollin_time)
        # Path luôn dựng dọc theo làn ĐÍCH. Độ lệch ngang hiện tại của ego so với
        # làn đích (d_t) giảm dần về 0 sau quãng cartip + rollin. Không đổi làn thì
        # d_t chỉ là độ lệch nhỏ khỏi tâm làn. Đang đổi làn thì d_t ≈ ±3.5 m và
        # nhỏ dần qua từng chu kỳ, nhờ vậy quá trình chuyển làn hội tụ. Nếu neo đoạn
        # rollin theo vị trí ego ở mỗi chu kỳ thì đoạn chuyển làn luôn "ở phía
        # trước" và không bao giờ đổi làn xong.
        st, dt_ = self._proj(target, x, y)
        ss = st + np.arange(0, p.horizon + 1e-6, p.point_distance)
        base, yaw = self.lines[target].point(ss)
        rel = ss - st
        decay = 1 - _smoothstep(rel / (keep + rollin))
        normal = np.stack([-np.sin(yaw), np.cos(yaw)], 1)
        pts = base + normal * (dt_ * decay)[:, None]
        pts[0] = [x, y]
        pts = smooth_path(pts, p.weight_data, p.weight_smooth, p.tolerance)
        line = Polyline(pts)
        kappa = np.abs(line.curvature(np.linspace(0, min(line.length, 50), 25)))
        lp = LocalPath(pts, line, cur, target, float(kappa.max()) if len(kappa) else 0.0)
        lp.leads = self._find_leads(line, ego, objects)
        return lp

    def _find_leads(self, line: Polyline, ego: dict, objects: list[dict]):
        """Vật nằm trên đường đi, hoặc sẽ cắt ngang trong 2 s tới (dự đoán vận tốc không đổi)."""
        ego_half = ego.get("width", 1.8) / 2
        v_ego = max(ego["v"], 0.0)
        leads = []
        for o in objects:
            w = o.get("width", 1.8) / 2 + ego_half + self.p.corridor_margin
            for tau in (0.0, 1.0, 2.0):
                ox = o["x"] + o["v"] * math.cos(o["yaw"]) * tau
                oy = o["y"] + o["v"] * math.sin(o["yaw"]) * tau
                s, d, _ = line.project(ox, oy)
                if not (0 < s < line.length) or abs(d) > w:
                    continue
                if tau > 0:
                    # Dự đoán chỉ dành cho vật CẮT NGANG path. Xe chạy cùng chiều mà nhanh hơn ego (đang vượt từ phía sau)
                    # thì vị trí dự đoán sẽ nằm trước ego. Coi nó là lead rồi phanh trước một xe nhanh hơn đang bám đuôi
                    # chính là tự gây va chạm từ phía sau (BUG_LOG B34). Xe cùng chiều chỉ xét ở tau = 0.
                    _, yaw_p = line.point(s)
                    if math.cos(wrap(o["yaw"] - yaw_p[0])) > math.cos(math.radians(30)):
                        break
                    s_ego_future = v_ego * tau  # ego cũng di chuyển trong lúc đó
                    if s < s_ego_future - ego.get("length", 4.5):
                        continue  # lúc vật tới đó thì ego đã đi qua: không xung đột
                    if s > s_ego_future + 15:
                        continue  # vật tới đó nhưng ego còn ở xa: chưa cần phản ứng
                _, yaw = line.point(s)
                # Vận tốc dọc path: xe cùng chiều giữ nguyên vận tốc, người cắt ngang thì ≈ 0
                v_along = o["v"] * math.cos(wrap(o["yaw"] - yaw[0]))
                gap = s - ego.get("length", 4.5) / 2 - o.get("length", 4.5) / 2
                leads.append((gap, v_along, o.get("id"), o.get("class", "")))
                break
        leads.sort(key=lambda r: r[0])
        return leads
