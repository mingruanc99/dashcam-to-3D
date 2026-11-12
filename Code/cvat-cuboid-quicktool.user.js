// ==UserScript==
// @name         CVAT Cuboid Toolbox (3D)
// @namespace    https://github.com/vantixapps/cvat-tools
// @version      4.0.0
// @description  Toolbox 3D cuboid cho CVAT: ô nhìn TOP/SIDE/FRONT nhúng + bảng Item, Full Control đa frame, Blender G/W/S, Smart Snap + Snap cả sequence, Anchor Ground, Auto-Sync, QA + auto-fix có xem trước. Giao diện Sáng/Tối.
// @author       Antigravity
// @match        https://cvat-test.vantixapps.net/*
// @match        https://app.cvat.ai/*
// @match        http://localhost:8080/*
// @match        http://127.0.0.1:8080/*
// @match        http://localhost:*/*
// @match        http://127.0.0.1:*/*
// @include      *://*/jobs/*
// @include      *://*cvat*/*
// @grant        none
// @inject-into  page
// @run-at       document-idle
// ==/UserScript==

// GENERATED from src/*.js by build.ps1 - do not edit directly.
(function () {
  'use strict';

  // =========================================================================
  // Cấu hình + localStorage
  // =========================================================================
  const VERSION = '4.0.0';
  const LOG = '[CVAT-Toolbox]';
  const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
  const ALT_SYM = IS_MAC ? '⌥' : 'Alt+';

  const LS = {
    presets: 'cqt_presets_v2',
    clipboard: 'cqt_clipboard_v2',
    top: 'cqt_panel_top_v2',
    limits: 'cqt_limits_v3',
    qa: 'cqt_qa_options_v3',
    settings: 'cqt_settings_v1',
    classGroups: 'cqt_class_groups_v1',
    attrProfiles: 'cqt_attr_profiles_v1',
    fcBounds: 'cqt_full_control_v1',
  };

  // Ngưỡng LWH tiêu chuẩn theo class (m)
  const DEFAULT_LIMITS = {
    vehicle: { l: [3.2, 5.5], w: [1.6, 2.2], h: [1.5, 1.9] },
    two_wheel: { l: [1.5, 2.0], w: [0.6, 0.9], h: [1.5, 1.8] },
    pedestrian: { l: [0.65, 1.0], w: [0.65, 1.0], h: [1.2, 1.9] },
  };

  // Nhóm class chuẩn: tên nhóm => các tên nhãn được chấp nhận
  const DEFAULT_CLASS_GROUPS = {
    vehicle: ['vehicle', 'vehicles', 'car', 'cars', 'truck', 'trucks', 'bus', 'buses', 'van', 'vans', 'trailer', 'construction_vehicle'],
    two_wheel: ['two_wheel', 'two_wheeler', 'two_wheelers', 'bicycle', 'bicycles', 'motorcycle', 'motorcycles', 'cyclist', 'cyclists', 'bike', 'bikes'],
    pedestrian: ['pedestrian', 'pedestrians', 'person', 'people', 'human', 'child'],
  };

  // Tuỳ chọn QA (theo file kiểm tra cvat1.xlsx + 3 mục track_id / class_groups)
  const DEFAULT_QA = {
    missingTrack: true, // Thiếu track_id
    duplicateTrack: true, // Trùng track_id trong 1 frame
    unknownClass: true, // Nhãn không thuộc class_groups
    scale: true,
    scaleTol: 0.005, // m: chênh lệch so với size chuẩn (median) của track
    yaw: true,
    yawThresh: 75, // độ, giữa 2 frame liên tiếp
    overlap: true,
    pedPedIoU: 0.5, // pedestrian-pedestrian cho phép IoU tối đa; cặp khác không cho phép chồng lấn
    dist: true,
    distThresh: 100, // m, tính từ gốc toạ độ
    limits: true,
    ground: false, // đọc cloud từng frame => chậm, mặc định tắt
    groundTol: 0.05, // m, lệch đáy so với mặt đất cục bộ
    groundAll: false, // false = chỉ keyframe (frame nội suy đi theo), true = mọi frame
    wholeJob: true,
  };

  const DEFAULT_SETTINGS = {
    // Chế độ an toàn dữ liệu (mặc định BẬT): tool không tự chuyển qua nhiều frame (mỗi lần chuyển, CVAT
    // tải dữ liệu frame từ server), không đọc tên file frame, không xuất CSV, không lưu toạ độ box vào
    // localStorage. Mọi sửa đổi chỉ nằm trong bộ nhớ trang cho tới khi bấm Ctrl+S (lưu của chính CVAT).
    safeData: true,
    theme: 'dark', // 'dark' | 'light'
    dockViews: true, // đè TOP / SIDE / FRONT kiểu Full Control lên 3 ô nhìn phụ của CVAT
    itemPanel: true, // bảng Item (Location / Rotation / Dimensions) ở góc ô 3D
    itemCollapsed: false,
    blenderKeys: true, // G/W/S, Numpad 7/1/3/. trên canvas 3D
    bounceRefresh: false, // làm mới canvas bằng cách chuyển frame (chậm, dự phòng)
    enforceLimits: false, // ép LWH vào limits khi Áp dụng LWH / auto-fix (tắt = limits chỉ để cảnh báo)
    autoSyncObject: true, // tự động nạp thông số khi click chọn box trên canvas
    anchorResize: true, // hiện tuỳ chọn giữ cố định mặt (Anchor Face) khi chỉnh LWH
    keyframeStepper: true, // hiện thanh điều hướng Keyframe của object trên Global Bar
    microNudge: true, // hiện cụm tinh chỉnh bước nhỏ (Local Nudge) & Nội suy đoạn
    qaConfigOpen: false, // trạng thái đóng/mở bảng tiêu chí QA
  };

  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn(LOG, 'localStorage lỗi:', e);
    }
  }

  function loadOpts(key, defaults) {
    const saved = lsGet(key, null);
    return { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) };
  }

  function getSettings() {
    return loadOpts(LS.settings, DEFAULT_SETTINGS);
  }

  function getQAOptions() {
    return loadOpts(LS.qa, DEFAULT_QA);
  }

  // =========================================================================
  // Toán học hộp xoay
  // CVAT: points = [x, y, z, rx, ry, rz, L, W, H], góc radian, Euler 'XYZ' của three.js
  // =========================================================================
  const DEG = 180 / Math.PI;
  const RAD = Math.PI / 180;

  function clamp(v, lo, hi) {
    return Math.min(Math.max(v, lo), hi);
  }

  function wrapPi(a) {
    let r = (a + Math.PI) % (2 * Math.PI);
    if (r < 0) r += 2 * Math.PI;
    return r - Math.PI;
  }

  // |a - b| trên vòng tròn, trong [0, π]
  function angleDiff(a, b) {
    return Math.abs(wrapPi(a - b));
  }

  function rotationMatrix(rx, ry, rz) {
    const ca = Math.cos(rx), sa = Math.sin(rx);
    const cb = Math.cos(ry), sb = Math.sin(ry);
    const cc = Math.cos(rz), sc = Math.sin(rz);
    return [
      [cb * cc, -cb * sc, sb],
      [ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb],
      [sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb],
    ];
  }

  function lowestOffset(p) {
    const R = rotationMatrix(p[3], p[4], p[5]);
    return Math.abs(R[2][0]) * Math.abs(p[6]) / 2 +
      Math.abs(R[2][1]) * Math.abs(p[7]) / 2 +
      Math.abs(R[2][2]) * Math.abs(p[8]) / 2;
  }

  function bottomZ(p) {
    return p[2] - lowestOffset(p);
  }

  function boxCorners(p) {
    const R = rotationMatrix(p[3], p[4], p[5]);
    const hx = Math.abs(p[6]) / 2, hy = Math.abs(p[7]) / 2, hz = Math.abs(p[8]) / 2;
    const out = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lx = sx * hx, ly = sy * hy, lz = sz * hz;
          out.push([
            p[0] + R[0][0] * lx + R[0][1] * ly + R[0][2] * lz,
            p[1] + R[1][0] * lx + R[1][1] * ly + R[1][2] * lz,
            p[2] + R[2][0] * lx + R[2][1] * ly + R[2][2] * lz,
          ]);
        }
      }
    }
    return out;
  }

  // Giao cắt tia ray với hộp xoay 3D (Ray-OBB intersection, trả về khoảng cách t > 0 nếu trúng)
  function rayIntersectBox(ray, p, margin = 0.08) {
    if (!ray) return null;
    const R = rotationMatrix(p[3], p[4], p[5]);
    const dx = ray.o[0] - p[0], dy = ray.o[1] - p[1], dz = ray.o[2] - p[2];
    const ox = R[0][0] * dx + R[1][0] * dy + R[2][0] * dz;
    const oy = R[0][1] * dx + R[1][1] * dy + R[2][1] * dz;
    const oz = R[0][2] * dx + R[1][2] * dy + R[2][2] * dz;

    const dirx = R[0][0] * ray.d[0] + R[1][0] * ray.d[1] + R[2][0] * ray.d[2];
    const diry = R[0][1] * ray.d[0] + R[1][1] * ray.d[1] + R[2][1] * ray.d[2];
    const dirz = R[0][2] * ray.d[0] + R[1][2] * ray.d[1] + R[2][2] * ray.d[2];

    const hx = Math.abs(p[6]) / 2 + margin;
    const hy = Math.abs(p[7]) / 2 + margin;
    const hz = Math.abs(p[8]) / 2 + margin;

    let tmin = -Infinity, tmax = Infinity;

    if (Math.abs(dirx) > 1e-6) {
      let t1 = (-hx - ox) / dirx, t2 = (hx - ox) / dirx;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    } else if (Math.abs(ox) > hx) return null;

    if (Math.abs(diry) > 1e-6) {
      let t1 = (-hy - oy) / diry, t2 = (hy - oy) / diry;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    } else if (Math.abs(oy) > hy) return null;

    if (Math.abs(dirz) > 1e-6) {
      let t1 = (-hz - oz) / dirz, t2 = (hz - oz) / dirz;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    } else if (Math.abs(oz) > hz) return null;

    const t = tmin > 0 ? tmin : tmax;
    return t > 0 ? t : null;
  }

  // Đổi LWH, tuỳ chọn giữ nguyên cao độ đáy và giữ cố định 1 mặt (anchorMode: 'center' | 'sensor' | 'front' | 'back' | 'left' | 'right')
  function withLWH(points, l, w, h, keepGround, anchorMode = 'center') {
    const p = [...points];
    const oldBottom = bottomZ(p);
    const oldL = Math.abs(p[6]);
    const oldW = Math.abs(p[7]);
    const dL = l - oldL;
    const dW = w - oldW;

    if (anchorMode && anchorMode !== 'center' && (Math.abs(dL) > 1e-6 || Math.abs(dW) > 1e-6)) {
      const cos = Math.cos(p[5]);
      const sin = Math.sin(p[5]);
      let shiftU = 0;
      let shiftV = 0;

      if (anchorMode === 'front') {
        shiftU = -dL / 2;
      } else if (anchorMode === 'back') {
        shiftU = dL / 2;
      } else if (anchorMode === 'left') {
        shiftV = -dW / 2;
      } else if (anchorMode === 'right') {
        shiftV = dW / 2;
      } else if (anchorMode === 'sensor') {
        const sensorU = -p[0] * cos - p[1] * sin;
        const sensorV = p[0] * sin - p[1] * cos;
        if (Math.abs(sensorU) > 0.15) shiftU = -Math.sign(sensorU) * (dL / 2);
        if (Math.abs(sensorV) > 0.15) shiftV = -Math.sign(sensorV) * (dW / 2);
      }

      p[0] += shiftU * cos - shiftV * sin;
      p[1] += shiftU * sin + shiftV * cos;
    }

    p[6] = l;
    p[7] = w;
    p[8] = h;
    if (keepGround) p[2] = oldBottom + lowestOffset(p);
    return p;
  }

  function sameLWH(p, l, w, h, eps = 1e-6) {
    return Math.abs(p[6] - l) < eps && Math.abs(p[7] - w) < eps && Math.abs(p[8] - h) < eps;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function percentile(values, q) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[clamp(Math.floor(sorted.length * q), 0, sorted.length - 1)];
  }

  function fmtSigned(n, digits = 2) {
    return (n >= 0 ? '+' : '') + n.toFixed(digits);
  }

  function fmtLWH(l, w, h) {
    return `${l.toFixed(2)} x ${w.toFixed(2)} x ${h.toFixed(2)}`;
  }

  // =========================================================================
  // Mặt phẳng đất z = a·x + b·y + c (mặt phẳng ngang: a = b = 0)
  // =========================================================================
  function flatPlane(z) {
    return { a: 0, b: 0, c: z, slopeDeg: 0 };
  }

  function planeZ(plane, x, y) {
    return plane.a * x + plane.b * y + plane.c;
  }

  // Góc rx, ry để trục Z của hộp vuông góc mặt phẳng.
  // Với Euler XYZ, trục Z local = cột 2 của R = [sin ry, -sin rx·cos ry, cos rx·cos ry], không phụ thuộc rz.
  function anglesForPlane(plane) {
    const n = Math.hypot(plane.a, plane.b, 1);
    const nx = -plane.a / n, ny = -plane.b / n, nz = 1 / n;
    return { rx: Math.atan2(-ny, nz), ry: Math.asin(clamp(nx, -1, 1)) };
  }

  // Khoảng cách từ góc thấp nhất của hộp tới mặt phẳng (dương = lơ lửng, âm = lún)
  function groundGap(p, plane) {
    let gap = Infinity;
    for (const c of boxCorners(p)) gap = Math.min(gap, c[2] - planeZ(plane, c[0], c[1]));
    return gap;
  }

  // mode: 'snap' giữ nghiêng | 'flat' rx=ry=0 | 'tilt' nghiêng theo dốc
  function fitToGround(points, plane, mode) {
    const p = [...points];
    if (mode === 'flat') {
      p[3] = 0;
      p[4] = 0;
    } else if (mode === 'tilt') {
      const { rx, ry } = anglesForPlane(plane);
      p[3] = rx;
      p[4] = ry;
    }
    p[2] -= groundGap(p, plane);
    return p;
  }

  function fitPlaneLSQ(pts) {
    const n = pts.length;
    if (n < 3) return null;
    let mx = 0, my = 0, mz = 0;
    for (const q of pts) { mx += q[0]; my += q[1]; mz += q[2]; }
    mx /= n; my /= n; mz /= n;
    let sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
    for (const q of pts) {
      const dx = q[0] - mx, dy = q[1] - my, dz = q[2] - mz;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxz += dx * dz; syz += dy * dz;
    }
    const det = sxx * syy - sxy * sxy;
    if (Math.abs(det) < 1e-9) return null;
    const a = (sxz * syy - syz * sxy) / det;
    const b = (syz * sxx - sxz * sxy) / det;
    return { a, b, c: mz - a * mx - b * my };
  }

  // Dựng mặt phẳng nghiêng 3D Z = aX + bY + c từ 1 box chuẩn (Anchor Box)
  // Sử dụng 4 góc tiếp đất và góc xoay (rx, ry) của chính box đó
  function planeFromSingleBox(p) {
    const R = rotationMatrix(p[3], p[4], p[5]);
    const nx = R[0][2], ny = R[1][2], nz = R[2][2];
    if (nz <= 0.05) return flatPlane(bottomZ(p));
    const h = Math.abs(p[8]);
    const cbot = [
      p[0] - (h / 2) * nx,
      p[1] - (h / 2) * ny,
      p[2] - (h / 2) * nz,
    ];
    const a = -nx / nz;
    const b = -ny / nz;
    const c = cbot[2] - a * cbot[0] - b * cbot[1];
    const slopeDeg = Math.atan(Math.hypot(a, b)) * DEG;
    if (slopeDeg > 15) return flatPlane(bottomZ(p));
    return { a, b, c, slopeDeg };
  }

  // Độ cao lớp mặt đất trong 1 vùng: đỉnh "tập trung điểm" thấp nhất của histogram Z.
  // Mặt đường gồ ghề vẫn là 1 lớp điểm dày; thân xe, bó vỉa, nhiễu thì thưa hơn hoặc cao hơn.
  function groundPeakZ(zs, minCount = 8) {
    if (zs.length < minCount) return null;
    const BIN = 0.02, NB = 75; // xét 1.5 m phía trên điểm thấp
    const lo = percentile(zs, 0.01);
    const hist = new Float64Array(NB);
    for (const z of zs) {
      const k = Math.floor((z - lo) / BIN);
      if (k >= 0 && k < NB) hist[k]++;
    }
    const KER = [0.06, 0.24, 0.4, 0.24, 0.06]; // làm mượt ~4 cm
    const sm = new Float64Array(NB);
    let max = 0;
    for (let k = 0; k < NB; k++) {
      for (let j = 0; j < 5; j++) sm[k] += KER[j] * (hist[k + j - 2] || 0);
      max = Math.max(max, sm[k]);
    }
    if (max < 2) return null;
    let k = 0;
    while (sm[k] < 0.5 * max) k++; // lớp dày đầu tiên tính từ dưới lên
    while (k + 1 < NB && sm[k + 1] >= sm[k]) k++; // leo tới đỉnh của lớp đó
    const zc = lo + (k + 0.5) * BIN;
    let sum = 0, n = 0;
    for (const z of zs) if (Math.abs(z - zc) <= 0.04) { sum += z; n++; }
    return n ? { z: sum / n, n } : null;
  }

  // Mặt đất cục bộ dưới hộp. Không fit 1 plane lớn (đường gồ ghề làm lệch),
  // mà đo độ cao lớp đất ngay tại 4 góc đáy (chỗ bánh xe), rồi nối 4 điểm đó thành mặt nghiêng.
  function estimateGroundPlane(points, positions) {
    const cx = points[0], cy = points[1];
    const l = Math.abs(points[6]), w = Math.abs(points[7]);
    const cos = Math.cos(points[5]), sin = Math.sin(points[5]);
    const rOut = 0.5 * Math.hypot(l, w) + 2.5;
    const bz = bottomZ(points);

    const near = []; // [lx, ly, z, inside]
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const z = positions[i + 2];
      if (!Number.isFinite(z) || z < bz - 3 || z > bz + 2) continue;
      const dx = positions[i] - cx, dy = positions[i + 1] - cy;
      if (dx * dx + dy * dy > rOut * rOut) continue;
      const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
      near.push([lx, ly, z, Math.abs(lx) <= l / 2 + 0.3 && Math.abs(ly) <= w / 2 + 0.3]);
    }
    // 1) Mức đất chung: lớp dày thấp nhất ngoài footprint
    const ref = groundPeakZ(near.filter((q) => !q[3]).map((q) => q[2]), 15);
    if (!ref) return null;

    // 2) Đo lại tại từng góc đáy, chỉ trong cửa sổ ±0.3 m quanh mức chung (bỏ thân xe, bó vỉa)
    // Bán kính đo nhỏ dần từ trong ra: càng sát góc càng đúng chỗ bánh xe, chỉ nới rộng khi thiếu điểm
    const band = near.filter((q) => Math.abs(q[2] - ref.z) <= 0.3);
    const samples = [];
    let count = 0;
    for (const [ax, ay] of [[l / 2, w / 2], [l / 2, -w / 2], [-l / 2, w / 2], [-l / 2, -w / 2]]) {
      let pk = null;
      for (const r of [0.5, 0.8, 1.2, 1.6]) {
        const zs = [];
        for (const q of band) {
          const dx = q[0] - ax, dy = q[1] - ay;
          if (dx * dx + dy * dy <= r * r) zs.push(q[2]);
        }
        if (zs.length >= 12 && (pk = groundPeakZ(zs, 12))) break;
      }
      if (!pk) continue;
      count += pk.n;
      samples.push([cx + ax * cos - ay * sin, cy + ax * sin + ay * cos, pk.z]);
    }
    // Góc bị thân xe che mất đất thường cho đỉnh cao bất thường => bỏ góc cao hơn góc thấp nhất > 0.2 m
    const zMin = Math.min(...samples.map((s) => s[2]));
    const good = samples.filter((s) => s[2] - zMin <= 0.2);

    let plane = good.length >= 3 ? fitPlaneLSQ(good) : null;
    if (plane && Math.atan(Math.hypot(plane.a, plane.b)) * DEG > 12) plane = null; // dốc vô lý => coi như phẳng
    if (!plane) plane = flatPlane(good.length ? median(good.map((s) => s[2])) : ref.z);
    return { ...plane, slopeDeg: Math.atan(Math.hypot(plane.a, plane.b)) * DEG, count: count || ref.n, corners: good.length };
  }

  // =========================================================================
  // Hướng hộp từ point cloud
  // =========================================================================
  // Hướng hộp theo "L-shape fitting" (Zhang et al. 2017, tiêu chí closeness).
  // Thử mọi góc θ trong [0°, 90°): chiếu điểm lên 2 trục e1 = (cosθ, sinθ), e2 = (−sinθ, cosθ)
  // (tích vô hướng trên mặt XY), rồi chấm điểm mức độ điểm dồn sát các cạnh hộp.
  // Đúng hướng thì 2 mặt LiDAR nhìn thấy nằm gọn trên 2 cạnh => điểm cao nhất.
  // PCA bị lệch vì khi chỉ thấy 2 mặt (chữ L), trục chính chạy chéo theo đường chéo chữ L.
  // priors: [{ yaw, w }] hướng các box xung quanh (so theo mod 90°), chỉ để phân xử khi cloud mơ hồ.
  // Trả về { yaw (mod 90°), conf (0 = mơ hồ … 1 = rõ) }.
  function fitRectYaw(pts, priors = []) {
    const step = Math.max(1, Math.floor(pts.length / 1200));
    const xy = [];
    let mx = 0, my = 0;
    for (let i = 0; i < pts.length; i += step) { xy.push(pts[i]); mx += pts[i][0]; my += pts[i][1]; }
    mx /= xy.length; my /= xy.length;
    const X = xy.map((q) => q[0] - mx), Y = xy.map((q) => q[1] - my);
    const n = X.length, D0 = 0.04;
    const c1 = new Float64Array(n), c2 = new Float64Array(n);
    const s1 = new Float64Array(n), s2 = new Float64Array(n);
    const k0 = Math.floor(0.01 * (n - 1)), k1 = Math.ceil(0.99 * (n - 1));
    const closeness = (t) => {
      const c = Math.cos(t), s = Math.sin(t);
      for (let i = 0; i < n; i++) { c1[i] = X[i] * c + Y[i] * s; c2[i] = -X[i] * s + Y[i] * c; }
      s1.set(c1); s1.sort();
      s2.set(c2); s2.sort();
      const lo1 = s1[k0], hi1 = s1[k1], lo2 = s2[k0], hi2 = s2[k1];
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const d1 = Math.max(0, Math.min(c1[i] - lo1, hi1 - c1[i]));
        const d2 = Math.max(0, Math.min(c2[i] - lo2, hi2 - c2[i]));
        sum += 1 / Math.max(Math.min(d1, d2), D0);
      }
      return sum;
    };
    let wSum = 0;
    for (const p of priors) wSum += p.w;
    const prior = (t) => {
      if (!wSum) return 0;
      let s = 0;
      for (const p of priors) s += p.w * (1 + Math.cos(4 * (t - p.yaw))) / 2;
      return s / wSum;
    };
    const lambda = n < 40 ? 0.6 : n < 150 ? 0.3 : 0.12;

    const coarse = [];
    for (let d = 0; d < 90; d++) coarse.push(closeness(d * RAD));
    const sMax = Math.max(...coarse), sMin = Math.min(...coarse), span = sMax - sMin || 1;
    const total = (t, s) => (s - sMin) / span + lambda * prior(t);
    let bestD = 0;
    for (let d = 1; d < 90; d++) if (total(d * RAD, coarse[d]) > total(bestD * RAD, coarse[bestD])) bestD = d;
    let best = bestD * RAD;
    // Tinh chỉnh dưới 1°: gán điểm vào cạnh gần nhất, fit đường thẳng (TLS) cho từng cạnh,
    // rồi lấy trung bình hướng các cạnh (trong không gian 4θ để cạnh dọc/ngang cùng một nghĩa).
    for (let iter = 0; iter < 3; iter++) {
      const c = Math.cos(best), s = Math.sin(best);
      for (let i = 0; i < n; i++) { c1[i] = X[i] * c + Y[i] * s; c2[i] = -X[i] * s + Y[i] * c; }
      s1.set(c1); s1.sort();
      s2.set(c2); s2.sort();
      const bounds = [s1[k0], s1[k1], s2[k0], s2[k1]];
      const groups = [[], [], [], []];
      for (let i = 0; i < n; i++) {
        const ds = [c1[i] - bounds[0], bounds[1] - c1[i], c2[i] - bounds[2], bounds[3] - c2[i]].map(Math.abs);
        const k = ds.indexOf(Math.min(...ds));
        if (ds[k] < 0.25) groups[k].push(i);
      }
      let vc = 0, vs = 0;
      groups.forEach((g, k) => {
        if (g.length < 8) return;
        let gx = 0, gy = 0;
        for (const i of g) { gx += X[i]; gy += Y[i]; }
        gx /= g.length; gy /= g.length;
        let sxx = 0, syy = 0, sxy = 0;
        for (const i of g) { const dx = X[i] - gx, dy = Y[i] - gy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
        const dir = 0.5 * Math.atan2(2 * sxy, sxx - syy); // hướng cạnh
        const spread = Math.sqrt((sxx + syy) / g.length);
        if (spread < 0.3) return; // cạnh quá ngắn, hướng không tin được
        const th = k < 2 ? dir - Math.PI / 2 : dir; // cạnh vuông góc e1 có hướng e2 = θ + 90°
        vc += g.length * Math.cos(4 * th);
        vs += g.length * Math.sin(4 * th);
      });
      if (!vc && !vs) break;
      let th = Math.atan2(vs, vc) / 4;
      while (angleDiff(th, best) > Math.PI / 4 + 1e-9) th += Math.PI / 2; // về cùng nhánh với best
      th = ((th % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      if (Math.abs(Math.sin(2 * (th - best))) > Math.sin(2 * 3 * RAD)) break; // lệch > 3° => giữ kết quả thô
      const moved = Math.abs(Math.sin(2 * (th - best)));
      best = th;
      if (moved < 1e-4) break;
    }
    // Độ rõ: đỉnh tốt nhất trội hơn mọi hướng cách nó > 10° bao nhiêu (theo closeness thuần)
    let rival = 0;
    for (let d = 0; d < 90; d++) {
      const gap = Math.abs(((d - bestD) % 90 + 135) % 90 - 45);
      if (gap > 10) rival = Math.max(rival, (coarse[d] - sMin) / span);
    }
    return { yaw: best, conf: 1 - rival };
  }

  // Hướng các box xung quanh làm "gợi ý" cho fitRectYaw (chỉ box dài, trong 30 m)
  function yawPriors(p, others) {
    const out = [];
    for (const q of others) {
      const l = Math.abs(q[6]), w = Math.abs(q[7]);
      if (Math.max(l, w) < 1.4 * Math.min(l, w)) continue;
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < 0.5 || d > 30) continue;
      out.push({ yaw: q[5], w: 1 / (1 + d / 10) });
    }
    return out;
  }

  // Trong 4 hướng yaw + k·90°, chọn hướng gần góc hiện tại nhất (giữ L theo đầu xe)
  function nearestQuarterYaw(yaw, current) {
    let best = yaw, bestDiff = Infinity;
    for (let k = 0; k < 4; k++) {
      const cand = wrapPi(yaw + k * Math.PI / 2);
      const d = angleDiff(cand, current);
      if (d < bestDiff) { bestDiff = d; best = cand; }
    }
    return best;
  }

  // =========================================================================
  // BEV (nhìn từ trên): đa giác hộp, diện tích giao, IoU
  // =========================================================================
  function bevCorners(p) {
    const c = Math.cos(p[5]), s = Math.sin(p[5]);
    const hl = Math.abs(p[6]) / 2, hw = Math.abs(p[7]) / 2;
    return [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]]
      .map(([x, y]) => [p[0] + x * c - y * s, p[1] + x * s + y * c]); // CCW
  }

  function polyArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }

  // Sutherland–Hodgman, clip là đa giác lồi CCW
  function clipPolygon(subject, clip) {
    let out = subject;
    for (let i = 0; i < clip.length && out.length; i++) {
      const A = clip[i], B = clip[(i + 1) % clip.length];
      const inside = (P) => (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]) >= 0;
      const cross = (P, Q) => {
        const den = (P[0] - Q[0]) * (A[1] - B[1]) - (P[1] - Q[1]) * (A[0] - B[0]);
        if (Math.abs(den) < 1e-12) return Q;
        const t = ((P[0] - A[0]) * (A[1] - B[1]) - (P[1] - A[1]) * (A[0] - B[0])) / den;
        return [P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])];
      };
      const input = out;
      out = [];
      for (let j = 0; j < input.length; j++) {
        const P = input[j], Q = input[(j + 1) % input.length];
        const pIn = inside(P), qIn = inside(Q);
        if (qIn) {
          if (!pIn) out.push(cross(P, Q));
          out.push(Q);
        } else if (pIn) {
          out.push(cross(P, Q));
        }
      }
    }
    return out;
  }

  // null nếu không giao; ngược lại { inter, iou, ioa1, ioa2 }
  function bevOverlap(p1, p2) {
    const r1 = 0.5 * Math.hypot(p1[6], p1[7]), r2 = 0.5 * Math.hypot(p2[6], p2[7]);
    const dx = p1[0] - p2[0], dy = p1[1] - p2[1];
    if (dx * dx + dy * dy >= (r1 + r2) * (r1 + r2)) return null;
    const poly = clipPolygon(bevCorners(p1), bevCorners(p2));
    if (poly.length < 3) return null;
    const inter = polyArea(poly);
    if (inter <= 0) return null;
    const a1 = Math.abs(p1[6] * p1[7]), a2 = Math.abs(p2[6] * p2[7]);
    return { inter, iou: inter / (a1 + a2 - inter), ioa1: inter / a1, ioa2: inter / a2 };
  }

  // =========================================================================
  // Cầu nối CVAT: Redux store, job, frame, ObjectState, canvas 3D
  // =========================================================================
  let cachedStore = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function hasAnnotationState(store) {
    try {
      return !!store?.getState?.()?.annotation;
    } catch (e) {
      return false;
    }
  }

  // Tìm store qua React fiber (Provider nằm phía trên các component CVAT)
  function findStoreFromFiber() {
    const selectors = [
      '.cvat-canvas-container',
      '.cvat-objects-sidebar',
      '.cvat-player-frame-selector',
      '.cvat-annotation-header',
      '#root > *',
      '#root',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const key = Object.keys(el).find((k) => (
        k.startsWith('__reactFiber$') ||
        k.startsWith('__reactInternalInstance$') ||
        k.startsWith('__reactContainer$')
      ));
      if (!key) continue;
      let fiber = el[key];
      if (fiber?.current) fiber = fiber.current;
      for (let depth = 0; fiber && depth < 1000; depth++) {
        const props = fiber.memoizedProps;
        const store = props?.store || props?.value?.store;
        if (hasAnnotationState(store)) return store;
        fiber = fiber.return;
      }
    }
    return null;
  }

  function getStore() {
    if (hasAnnotationState(cachedStore)) return cachedStore;
    cachedStore = hasAnnotationState(window.store) ? window.store : findStoreFromFiber();
    return cachedStore;
  }

  function annotationState() {
    return getStore()?.getState()?.annotation || null;
  }

  // Job hiện tại luôn đọc từ store => tự đúng khi chuyển job trong SPA
  function getJob() {
    const job = annotationState()?.job?.instance;
    return job && typeof job.annotations?.get === 'function' ? job : null;
  }

  function frameInput() {
    return document.querySelector('.cvat-player-frame-selector input') ||
      document.querySelector('input.cvat-player-frame-selector');
  }

  function getFrame() {
    const n = annotationState()?.player?.frame?.number;
    if (Number.isInteger(n)) return n;
    const v = parseInt(frameInput()?.value, 10);
    return Number.isInteger(v) ? v : undefined;
  }

  function activeId() {
    const id = annotationState()?.annotations?.activatedStateID;
    return Number.isInteger(id) ? id : null;
  }

  function labelName(s) {
    return typeof s?.label === 'string' ? s.label : (s?.label?.name || '');
  }

  function isCuboid(s) {
    return !!s?.points && s.points.length >= 9;
  }

  // Thuộc tính (sub label) của label. CVAT lưu giá trị theo ID số: state.attributes = { [attrId]: 'value' }
  function attrSpecs(state) {
    return Array.isArray(state?.label?.attributes) ? state.label.attributes : [];
  }

  function findAttrSpec(state, pattern) {
    return attrSpecs(state).find((a) => pattern.test(String(a.name || '').trim())) || null;
  }

  function attrValue(state, spec) {
    return state?.attributes?.[spec.id];
  }

  // Setter attributes của ObjectState gộp key, không xoá thuộc tính khác
  function setAttr(state, spec, value) {
    state.attributes = { [spec.id]: String(value) };
  }

  const TRACK_ID_ATTR = /^track[\s_-]?id$/i;

  // { key, value, source }: source 'attr' (thuộc tính track_id), 'track' (track của CVAT), null = thiếu
  function trackIdOf(state) {
    const spec = findAttrSpec(state, TRACK_ID_ATTR);
    if (spec) {
      const raw = attrValue(state, spec);
      if (raw === undefined || raw === null || String(raw).trim() === '') return { key: null, value: null, source: null, spec };
      const n = parseInt(raw, 10);
      const value = Number.isInteger(n) && String(n) === String(raw).trim() ? n : String(raw).trim();
      return { key: 'a:' + value, value, source: 'attr', spec };
    }
    if (state?.objectType === 'track') return { key: 'c:' + state.clientID, value: state.clientID, source: 'track', spec: null };
    return { key: null, value: null, source: null, spec: null };
  }

  function jobLabels() {
    const labels = getJob()?.labels;
    return Array.isArray(labels) ? labels : [];
  }

  // Track: chỉ keyframe; shape: luôn coi như keyframe
  function isKey(s) {
    return s?.objectType !== 'track' || !!s.keyframe;
  }

  function jobBounds() {
    const job = getJob();
    if (!job) return null;
    const start = Number.isInteger(job.startFrame) ? job.startFrame : 0;
    const stop = Number.isInteger(job.stopFrame) ? job.stopFrame : null;
    return stop === null ? null : { start, stop };
  }

  async function getStates(frame) {
    const job = getJob();
    if (!job) return [];
    return job.annotations.get(frame, true);
  }

  async function getState(id, frame) {
    const states = await getStates(frame);
    const key = String(id);
    return states.find((s) => String(s.clientID) === key) ||
      states.find((s) => s.serverID !== undefined && String(s.serverID) === key) ||
      null;
  }

  async function saveState(state) {
    if (typeof state?.save !== 'function') throw new Error('ObjectState.save() không tồn tại');
    return state.save();
  }

  // Tên file frame (cột "Item ID" trong báo cáo QA)
  const frameNameCache = new Map();
  async function frameName(frame) {
    const job = getJob();
    const key = `${job?.id}:${frame}`;
    if (frameNameCache.has(key)) return frameNameCache.get(key);
    // job.frames.get có thể tải meta / chunk frame từ server => bỏ qua khi bật chế độ an toàn dữ liệu
    if (safeData()) return '';
    let name = '';
    try {
      const data = await job.frames.get(frame);
      name = String(data?.filename || data?.name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    } catch (e) {}
    frameNameCache.set(key, name);
    return name;
  }

  // =========================================================================
  // Làm mới canvas sau khi sửa annotation
  // =========================================================================
  async function refreshViaStore() {
    try {
      const store = getStore();
      const job = getJob();
      const frame = getFrame();
      if (!store || !job || !Number.isInteger(frame)) return false;
      const root = store.getState();
      const ann = root.annotation.annotations;
      const showAll = !!root.settings?.workspace?.showAllInterpolationTracks;
      const states = await job.annotations.get(frame, showAll, ann.filters || []);
      const history = typeof job.actions?.get === 'function' ? await job.actions.get() : ann.history;
      // Cùng action CVAT dùng sau undo/redo
      store.dispatch({
        type: 'FETCH_ANNOTATIONS_SUCCESS',
        payload: { states, history, minZ: ann.zLayer?.min ?? 0, maxZ: ann.zLayer?.max ?? 0 },
      });
      return true;
    } catch (e) {
      console.warn(LOG, 'Làm mới qua store lỗi, chuyển sang đổi frame:', e);
      return false;
    }
  }

  async function waitForFrame(target, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const f = annotationState()?.player?.frame;
      if (f && f.number === target && !f.fetching) return true;
      await sleep(60);
    }
    return getFrame() === target;
  }

  async function goToFrame(target) {
    if (getFrame() === target) return true;
    const input = frameInput();
    if (!input) return false;
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      input.focus();
      setter.call(input, String(target));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(80);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      input.blur();
      return await waitForFrame(target, 5000);
    } catch (e) {
      return false;
    }
  }

  // Dự phòng: sang frame bên cạnh rồi quay lại để CVAT vẽ lại
  async function bounceFrame() {
    if (safeData()) return false; // không tự nhảy frame để vẽ lại
    const original = getFrame();
    const b = jobBounds();
    if (!Number.isInteger(original) || !b || b.start === b.stop) return true;
    const other = original < b.stop ? original + 1 : original - 1;
    await goToFrame(other);
    return goToFrame(original);
  }

  async function refreshView() {
    if (!getSettings().bounceRefresh && await refreshViaStore()) return true;
    return bounceFrame();
  }

  function activateObject(id) {
    try {
      getStore()?.dispatch({
        type: 'ACTIVATE_OBJECT',
        payload: { activatedStateID: id, activatedElementID: null, activatedAttributeID: null },
      });
    } catch (e) {}
  }

  async function jumpTo(id, frame) {
    if (Number.isInteger(frame)) await goToFrame(frame);
    if (Number.isInteger(id)) {
      setField('cqt-target-id', id);
      activateObject(id);
    }
  }

  // =========================================================================
  // Canvas 3D (three.js) của CVAT
  // =========================================================================
  function getCanvas3dViews() {
    return annotationState()?.canvas?.instance?.view?.views || null;
  }

  function getPerspectiveView() {
    const v = getCanvas3dViews()?.perspective;
    return v?.camera ? v : null;
  }

  function getPointCloudPositions() {
    const views = getCanvas3dViews();
    if (!views) return null;
    for (const key of ['perspective', 'top', 'side', 'front']) {
      const cloud = views[key]?.scene?.children?.find(
        (o) => o?.isPoints && o.geometry?.attributes?.position?.array?.length
      );
      if (cloud) return cloud.geometry.attributes.position.array;
    }
    return null;
  }

  // Mesh cuboid trong view perspective (CVAT đặt name = clientID)
  function findDrawnMesh(id) {
    const scene = getPerspectiveView()?.scene;
    if (!scene) return null;
    const name = String(id);
    let found = null;
    scene.traverse?.((o) => {
      if (!found && o.isMesh && o.name === name) found = o;
    });
    return found;
  }

  // =========================================================================
  // Ô nhập, trạng thái, log
  // =========================================================================
  function $(id) {
    return document.getElementById(id);
  }

  function val(id) {
    return $(id)?.value;
  }

  function numVal(id) {
    const raw = val(id);
    if (raw === undefined || String(raw).trim() === '') return NaN;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  function intVal(id) {
    const n = parseInt(val(id), 10);
    return Number.isInteger(n) ? n : NaN;
  }

  function isChecked(id) {
    return !!$(id)?.checked;
  }

  function setField(id, value) {
    const el = $(id);
    if (el) el.value = value;
  }

  function cleanStatusText(raw) {
    return String(raw || '')
      .replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}\u{3030}↺]+/gu, '')
      .replace(/\s*⚠️\s*/g, ' — Lưu ý: ')
      .trim();
  }

  function setStatus(msg, type = '') {
    const clean = cleanStatusText(msg);
    const el = $('cqt-status');
    if (el) {
      el.textContent = clean;
      el.className = 'cqt-status ' + (type || 'info');
    }
    const fcEl = $('cqt-fc-status');
    if (fcEl) {
      fcEl.textContent = clean;
      fcEl.className = 'cqt-fc-status ' + (type || 'info');
    }
    const log = $('cqt-log');
    if (log && type) {
      const lines = [`[${new Date().toLocaleTimeString()}] ${clean}`, ...log.textContent.split('\n')];
      log.textContent = lines.slice(0, 60).join('\n');
    }
  }

  function fail(msg) {
    setStatus(msg, 'error');
    return null;
  }

  // ---- Chế độ an toàn dữ liệu ----
  function safeData() {
    return getSettings().safeData !== false;
  }

  // Chức năng phải tự chuyển qua nhiều frame (CVAT sẽ tải dữ liệu frame từ server) => chặn khi bật chế độ an toàn
  function allowAutoFrames(what) {
    if (!safeData()) return true;
    fail(`${what} cần tự chuyển qua nhiều frame (CVAT sẽ tải dữ liệu frame từ server). ` +
      'Đang bật "Chế độ an toàn dữ liệu" ở tab Cài đặt — tắt nó nếu muốn dùng chức năng này.');
    return false;
  }

  function resolveTargetId() {
    const typed = intVal('cqt-target-id');
    if (Number.isInteger(typed)) return typed;
    return activeId();
  }

  function requireTarget() {
    const id = resolveTargetId();
    if (!Number.isInteger(id)) return fail('Nhập Target Object ID hoặc chọn 1 object!');
    if (!getJob()) return fail('Chưa kết nối CVAT Job!');
    return id;
  }

  // multi = true: nhóm Shift+Click (nếu có) thay cho object đang chọn => targetIds
  function readRange(multi = false) {
    const ids = multi && selection.size ? [...selection] : null;
    const targetId = ids ? ids[0] : requireTarget();
    if (targetId === null) return null;
    if (ids && !getJob()) return fail('Chưa kết nối CVAT Job!');
    const startFrame = intVal('cqt-frame-start');
    const endFrame = intVal('cqt-frame-end');
    if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame > endFrame) {
      return fail('Dải frame không hợp lệ (Start <= End)!');
    }
    return { targetId, targetIds: ids || [targetId], startFrame, endFrame };
  }

  function idsText(ids) {
    return '#' + ids.join(', #');
  }

  async function requireCuboidAtFrame(id, frame = getFrame()) {
    if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại.');
    const s = await getState(id, frame);
    if (!isCuboid(s)) return fail(`Không thấy cuboid #${id} ở frame ${frame}.`);
    return s;
  }

  function editSuffix(res) {
    let msg = ' (Ctrl+S để lưu)';
    if (res.errors) msg += ` · ${res.errors} lần lưu lỗi (xem Console).`;
    if (!res.restored) msg += ' · Canvas chưa làm mới, hãy chuyển frame.';
    return msg;
  }

  // =========================================================================
  // Snapshot (undo riêng cho thao tác hàng loạt) — lưu trong bộ nhớ theo job,
  // vì clientID chỉ có giá trị trong phiên hiện tại của trang.
  // CVAT vẫn ghi từng lần save vào lịch sử riêng (Ctrl+Z của CVAT).
  // =========================================================================
  const snapshots = [];

  function snapshotItem(state, frame) {
    return {
      clientID: state.clientID,
      frame,
      objectType: state.objectType,
      points: [...state.points],
      keyframe: isKey(state),
      outside: !!state.outside,
      occluded: !!state.occluded,
    };
  }

  function pushSnapshot(label, items) {
    if (!items.length) return;
    snapshots.unshift({ jobId: getJob()?.id, ts: Date.now(), label, items });
    if (snapshots.length > 10) snapshots.length = 10;
    refreshSnapshotList();
  }

  function refreshSnapshotList() {
    const select = $('cqt-snap-select');
    const quickUndoBtn = $('cqt-btn-undo-quick');
    const fcUndoBtn = $('cqt-fc-undo');
    const jobId = getJob()?.id;
    const list = snapshots.map((s, i) => ({ s, i })).filter(({ s }) => s.jobId === jobId);
    const title = list.length
      ? `Hoàn tác: "${list[0].s.label}" (${list[0].s.items.length} mục) — Phím ${ALT_SYM}Z`
      : `Chưa có snapshot để hoàn tác (${ALT_SYM}Z)`;
    if (quickUndoBtn) {
      quickUndoBtn.disabled = !list.length;
      quickUndoBtn.title = title;
      const badge = $('cqt-undo-count');
      if (badge) badge.textContent = list.length ? `(${list.length})` : '';
    }
    if (fcUndoBtn) {
      fcUndoBtn.disabled = !list.length;
      fcUndoBtn.title = title;
      fcUndoBtn.textContent = list.length ? `Undo (${list.length})` : 'Undo';
    }
    if (!select) return;
    select.innerHTML = '';
    if (!list.length) {
      select.add(new Option('(chưa có snapshot)', ''));
      return;
    }
    for (const { s, i } of list) {
      select.add(new Option(`${new Date(s.ts).toLocaleTimeString()} · ${s.label} · ${s.items.length}`, String(i)));
    }
  }

  async function restoreLatestSnapshot() {
    const jobId = getJob()?.id;
    const idx = snapshots.findIndex((s) => s.jobId === jobId);
    if (idx < 0) return fail('Chưa có snapshot nào trong phiên này để hoàn tác.');
    return restoreSnapshot(idx);
  }

  // Alt+Z / nút Undo trên header: khôi phục snapshot mới nhất của job này
  async function restoreLatestSnapshot() {
    const jobId = getJob()?.id;
    const idx = snapshots.findIndex((s) => s.jobId === jobId);
    if (idx < 0) return fail('Chưa có snapshot nào trong phiên này để hoàn tác.');
    return restoreSnapshot(idx);
  }

  async function restoreSnapshot(index) {
    const snap = snapshots[index];
    if (!snap) return fail('Không có snapshot để khôi phục.');
    if (snap.jobId !== getJob()?.id) return fail('Snapshot thuộc job khác.');
    if (!confirm(`Khôi phục snapshot "${snap.label}" (${snap.items.length} mục)?`)) return;

    setStatus(`⏳ Đang khôi phục "${snap.label}"...`);
    let restored = 0;
    let errors = 0;
    // Đi ngược thứ tự đã sửa
    for (const item of [...snap.items].reverse()) {
      try {
        const s = await getState(item.clientID, item.frame);
        if (!s) continue;
        // Không gỡ keyframe (quy định dự án): frame vốn nội suy sẽ giữ keyframe, nhưng về đúng giá trị cũ
        s.points = item.points;
        if (s.objectType === 'track') s.outside = item.outside;
        s.occluded = item.occluded;
        await saveState(s);
        restored++;
      } catch (e) {
        errors++;
        console.warn(LOG, 'Restore lỗi tại frame', item.frame, e);
      }
    }
    const ok = await refreshView();
    setStatus(
      `✅ Đã khôi phục ${restored}/${snap.items.length} mục từ "${snap.label}".` +
      (errors ? ` ⚠️ ${errors} lỗi.` : '') + (ok ? '' : ' Hãy chuyển frame để thấy thay đổi.'),
      errors ? 'warn' : 'success'
    );
  }

  // =========================================================================
  // Batch: mọi thao tác sửa đều đi qua đây (snapshot + await save + refresh)
  // =========================================================================
  function createBatch(label) {
    const items = [];
    const seen = new Set();
    let changed = 0;
    let errors = 0;
    return {
      // mutate(state) trả về false = không đổi gì
      async edit(state, frame, mutate) {
        const before = snapshotItem(state, frame);
        if (mutate(state) === false) return false;
        try {
          await saveState(state);
        } catch (e) {
          errors++;
          console.warn(LOG, `Lưu #${state.clientID} frame ${frame} lỗi:`, e);
          return false;
        }
        const key = `${state.clientID}:${frame}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push(before);
        }
        changed++;
        return true;
      },
      get changed() {
        return changed;
      },
      async finish(refresh = true) {
        pushSnapshot(label, items);
        const restored = changed && refresh ? await refreshView() : true;
        return { changed, errors, restored };
      },
    };
  }

  // Sửa 1 hoặc nhiều object (targetIds) trên dải frame, chung 1 snapshot
  async function editRange(label, opts, mutate) {
    const { targetId, targetIds = [targetId], startFrame, endFrame, keyframesOnly = false, includeOutside = false } = opts;
    const batch = createBatch(label);
    let skipped = 0;
    let seen = 0;
    for (const id of targetIds) {
      for (let f = startFrame; f <= endFrame; f++) {
        if (f > startFrame && (f - startFrame) % 25 === 0) {
          setStatus(`⏳ ${label}${targetIds.length > 1 ? ` #${id}` : ''}: frame ${f}/${endFrame}...`);
          await sleep(0);
        }
        const s = await getState(id, f);
        if (!isCuboid(s)) continue;
        if (s.outside && !includeOutside) { skipped++; continue; }
        seen++;
        if (keyframesOnly && !isKey(s)) { skipped++; continue; }
        await batch.edit(s, f, (st) => mutate(st, f, id));
      }
    }
    const res = await batch.finish();
    return { ...res, skipped, seen };
  }

  // Các frame (không outside) có object, có thể kèm cả frame nội suy
  async function collectTrack(id, from, to) {
    const b = jobBounds();
    if (b) {
      from = Math.max(from, b.start);
      to = Math.min(to, b.stop);
    }
    const out = [];
    for (let f = from; f <= to; f++) {
      if (f > from && (f - from) % 100 === 0) {
        setStatus(`⏳ Đọc #${id}: frame ${f}/${to}...`);
        await sleep(0);
      }
      const s = await getState(id, f);
      if (isCuboid(s) && !s.outside) out.push({ frame: f, state: s });
    }
    return out;
  }

  // Dò frame đầu/cuối của object trong job (không ghi vào ô nhập)
  async function detectSpan(id) {
    const b = jobBounds();
    if (!b) return fail('Không đọc được dải frame của job.');
    const list = await collectTrack(id, b.start, b.stop);
    if (!list.length) return fail(`Không thấy object #${id} trong job.`);
    return { startFrame: list[0].frame, endFrame: list[list.length - 1].frame, count: list.length };
  }

  // =========================================================================
  // Mặt đất: một "ground plane" duy nhất (dốc từ point cloud, hoặc phẳng theo Z)
  // =========================================================================
  let groundPlane = null; // { a, b, c, slopeDeg, count?, source, frame? }
  const groundPlaneCache = new Map(); // frame -> { ...plane, source, frame }

  function setGroundPlane(plane, source, refPoints) {
    const f = getFrame();
    const planeData = { ...plane, source, frame: Number.isInteger(f) ? f : null };
    groundPlane = planeData;
    if (Number.isInteger(f)) {
      groundPlaneCache.set(f, planeData);
    }
    const el = $('cqt-plane-display');
    if (el) {
      const z0 = refPoints ? planeZ(plane, refPoints[0], refPoints[1]) : plane.c;
      el.textContent = plane.a || plane.b
        ? `Plane dốc ${plane.slopeDeg.toFixed(1)}°: Z = ${fmtSigned(plane.a, 4)}·X ${fmtSigned(plane.b, 4)}·Y ${fmtSigned(plane.c, 3)} ` +
          `(Z tại box ≈ ${z0.toFixed(3)}m${plane.count ? `, ${plane.count} điểm` : ''}) — ${source}`
        : `Mặt phẳng ngang Z = ${plane.c.toFixed(3)}m — ${source}`;
    }
    if (!(plane.a || plane.b)) setField('cqt-ground-z', plane.c.toFixed(3));
  }

  function findPrevGroundPlane(currentFrame) {
    if (!Number.isInteger(currentFrame)) return null;
    for (let f = currentFrame - 1; f >= 0; f--) {
      if (groundPlaneCache.has(f)) {
        return { frame: f, plane: groundPlaneCache.get(f) };
      }
    }
    return null;
  }

  function onGroundZInput() {
    const z = numVal('cqt-ground-z');
    if (Number.isFinite(z)) setGroundPlane(flatPlane(z), 'nhập tay');
  }

  function planeFromCloud(points) {
    const positions = getPointCloudPositions();
    if (!positions) return null;
    return estimateGroundPlane(points, positions);
  }

  async function calcGroundPlane() {
    const id = requireTarget();
    if (id === null) return null;
    const s = await requireCuboidAtFrame(id);
    if (!s) return null;
    const frame = getFrame();
    let plane = null;
    if (getPointCloudPositions()) {
      plane = planeFromCloud(s.points);
    }
    if (plane) {
      setGroundPlane(plane, `cloud quanh #${id} @f${frame}`, s.points);
      setStatus(`📐 Đã tính plane dốc ${plane.slopeDeg.toFixed(1)}° từ ${plane.count} điểm. Bấm "Fit Frame này" hoặc "Fit dải".`, 'success');
      return plane;
    }
    if (isChecked('cqt-ground-auto-fallback')) {
      const prev = findPrevGroundPlane(frame);
      if (prev) {
        setGroundPlane(prev.plane, `kế thừa từ @f${prev.frame} (f${frame} thiếu cloud)`, s.points);
        setStatus(`⏮️ Frame ${frame} thiếu điểm cloud: Đã tự động kế thừa plane từ frame ${prev.frame}.`, 'warn');
        return prev.plane;
      }
    }
    return fail('Không đủ điểm quanh object để fit mặt đất.');
  }

  async function inheritGroundFromPrevFrame() {
    const frame = getFrame();
    if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại.');
    if (frame <= 0) return fail('Đang ở frame đầu tiên (f=0), không có frame trước.');

    let prev = findPrevGroundPlane(frame);
    if (!prev) {
      const targetId = resolveTargetId();
      if (Number.isInteger(targetId)) {
        const prevS = await getState(targetId, frame - 1);
        if (isCuboid(prevS) && !prevS.outside) {
          prev = { frame: frame - 1, plane: flatPlane(bottomZ(prevS.points)) };
        }
      }
    }

    if (!prev) {
      return fail(`Chưa có plane ở các frame trước frame ${frame}. Hãy bấm "Từ Cloud" hoặc chọn box ở frame trước.`);
    }

    const targetId = resolveTargetId();
    const curS = Number.isInteger(targetId) ? await getState(targetId, frame) : null;
    const refPts = curS && isCuboid(curS) ? curS.points : null;

    setGroundPlane(prev.plane, `kế thừa từ @f${prev.frame}`, refPts);
    setStatus(
      `⏮️ Đã kế thừa ground từ frame ${prev.frame} (${prev.plane.slopeDeg ? `dốc ${prev.plane.slopeDeg.toFixed(1)}°` : `Z = ${prev.plane.c.toFixed(3)}m`}).`,
      'success'
    );
    return prev.plane;
  }

  function getReferenceBoxIds() {
    const raw = (val('cqt-ground-ref-ids') || '').trim();
    const list = [];
    if (raw) {
      for (const tok of raw.split(/[\s,]+/)) {
        const id = parseInt(tok.replace(/^#/, ''), 10);
        if (Number.isInteger(id) && !list.includes(id)) list.push(id);
      }
    } else if (selection.size) {
      const targetId = resolveTargetId();
      for (const id of selection) {
        if (id !== targetId && !list.includes(id)) list.push(id);
      }
    }
    return list;
  }

  async function groundFromReferenceBoxes() {
    const frame = getFrame();
    if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại.');
    const refIds = getReferenceBoxIds();
    if (!refIds.length) {
      return fail('Cần ít nhất 1 Anchor ID (vd: 1 hoặc chuỗi: 1, 4). Hãy nhập vào ô Anchor hoặc chọn trên canvas.');
    }

    const validBoxes = [];
    const pts = [];
    for (const id of refIds) {
      const s = await getState(id, frame);
      if (!isCuboid(s) || s.outside) continue;
      validBoxes.push(s);
      const corners = boxCorners(s.points);
      corners.sort((a, b) => a[2] - b[2]);
      for (let i = 0; i < 4; i++) pts.push(corners[i]);
    }

    if (!validBoxes.length) {
      return fail(`Không tìm thấy Anchor nào hợp lệ (hoặc tất cả đều outside) ở frame ${frame}.`);
    }

    let planeObj = null;
    let slope = 0;

    // TH 1: 1 Box Anchor duy nhất -> Dựng mặt phẳng nghiêng 3D (rx, ry, Z) từ chính box đó
    if (validBoxes.length === 1) {
      const p = validBoxes[0].points;
      const sp = planeFromSingleBox(p);
      slope = sp.slopeDeg || 0;
      planeObj = {
        ...sp,
        count: 4,
      };
    } else {
      // TH 2: Nhiều box Anchor (≥ 2) -> Khớp mặt phẳng bình phương tối thiểu qua đáy các box
      let plane = fitPlaneLSQ(pts);
      slope = plane ? Math.atan(Math.hypot(plane.a, plane.b)) * DEG : 0;
      if (!plane || slope > 15) {
        const zs = pts.map((p) => p[2]);
        const z = median(zs);
        plane = flatPlane(z);
        slope = 0;
      }
      planeObj = {
        ...plane,
        slopeDeg: slope,
        count: pts.length,
      };
    }

    const boxLabels = validBoxes.map((b) => '#' + b.clientID).join(', ');
    const targetId = resolveTargetId();
    const curS = Number.isInteger(targetId) ? await getState(targetId, frame) : null;
    const refPts = curS && isCuboid(curS) ? curS.points : null;

    setGroundPlane(planeObj, `từ ${validBoxes.length} Anchor box (${boxLabels}) @f${frame}`, refPts);
    setStatus(
      `📐 Đã tính plane ${slope > 0 ? `dốc ${slope.toFixed(1)}°` : 'ngang'} từ ${validBoxes.length} Anchor (${boxLabels}). Bấm "Fit Frame này", "Fit dải" hoặc "Bám Anchor dải".`,
      'success'
    );
    return planeObj;
  }

  async function ensureGroundPlane() {
    if (groundPlane) return groundPlane;
    return calcGroundPlane();
  }

  async function resolveGroundRange(targetId) {
    const scope = val('cqt-ground-scope') || 'current_to_end';
    const curFrame = getFrame();
    if (!Number.isInteger(curFrame)) {
      fail('Không đọc được frame hiện tại.');
      return null;
    }
    if (scope === 'current') {
      return { from: curFrame, to: curFrame, keyframesOnly: false };
    }

    let start = intVal('cqt-frame-start');
    let end = intVal('cqt-frame-end');

    // Nếu start/end chưa có hoặc start === end === curFrame, tự động dò span của track
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || (start === end && start === curFrame)) {
      const span = await detectSpan(targetId);
      if (span) {
        start = span.startFrame;
        end = span.endFrame;
        setField('cqt-frame-start', start);
        setField('cqt-frame-end', end);
        setField('cqt-frame-count', end - start + 1);
      }
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      fail('Dải frame không hợp lệ (Start <= End). Bấm "🔍 Dò dải" để lấy dải.');
      return null;
    }

    let from = start, to = end;
    if (scope === 'current_to_end') {
      from = curFrame;
      to = end;
      if (from > to) {
        fail(`Frame hiện tại (${curFrame}) lớn hơn End frame (${end}).`);
        return null;
      }
    }

    const keyframesOnly = scope === 'keyframes';
    return { from, to, keyframesOnly };
  }

  function groundRange(range) {
    const scope = val('cqt-ground-scope') || 'current_to_end';
    const f = getFrame();
    if (scope === 'current') return Number.isInteger(f) ? { from: f, to: f } : null;
    if (scope === 'current_to_end' && Number.isInteger(f)) return { from: f, to: range.endFrame };
    return { from: range.startFrame, to: range.endFrame };
  }

  async function checkGround() {
    const id = requireTarget();
    if (id === null) return;
    const plane = await ensureGroundPlane();
    if (!plane) return;
    const r = await resolveGroundRange(id);
    if (!r) return;

    setStatus(`⏳ Đang đo đáy #${id} (${r.from} → ${r.to})...`);
    let minGap = Infinity, maxGap = -Infinity, frames = 0, sunk = 0, floating = 0;
    for (const { state } of await collectTrack(id, r.from, r.to)) {
      const gap = groundGap(state.points, plane);
      frames++;
      if (gap < -0.01) sunk++;
      if (gap > 0.01) floating++;
      minGap = Math.min(minGap, gap);
      maxGap = Math.max(maxGap, gap);
    }
    if (!frames) return fail(`Không thấy #${id} trong dải.`);
    setStatus(
      `📏 Đáy #${id} so với mặt đất: min ${fmtSigned(minGap, 3)}m, max ${fmtSigned(maxGap, 3)}m ` +
      `trên ${frames} frame. ${sunk} lún, ${floating} lơ lửng >1cm.`,
      sunk + floating ? 'warn' : 'success'
    );
  }

  async function applyGroundFitCurrent() {
    const ids = selectedOrTarget();
    if (!ids.length) return fail('Chọn object trước!');
    const plane = await ensureGroundPlane();
    if (!plane) return;
    const frame = getFrame();
    if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại.');

    const mode = val('cqt-ground-mode') || 'snap';
    const direction = val('cqt-ground-direction') || 'both';

    const batch = createBatch('Fit mặt đất frame hiện tại');
    let minDz = Infinity, maxDz = -Infinity;
    for (const id of ids) {
      const s = await getState(id, frame);
      if (!isCuboid(s) || s.outside) continue;
      await batch.edit(s, frame, (st) => {
        const after = fitToGround(st.points, plane, mode);
        const dz = after[2] - st.points[2];
        const rotChanged = Math.abs(after[3] - st.points[3]) > 1e-6 || Math.abs(after[4] - st.points[4]) > 1e-6;
        if (Math.abs(dz) < 1e-4 && !rotChanged) return false;
        if ((direction === 'down' && dz > 0) || (direction === 'up' && dz < 0)) return false;
        st.points = after;
        minDz = Math.min(minDz, dz);
        maxDz = Math.max(maxDz, dz);
        return true;
      });
    }

    const res = await batch.finish();
    if (!res.changed) return setStatus('ℹ️ Box đã nằm đúng trên mặt đất.', 'success');
    const dzText = minDz === maxDz ? fmtSigned(minDz, 3) : `${fmtSigned(minDz, 3)} → ${fmtSigned(maxDz, 3)}`;
    setStatus(`✅ Đã fit mặt đất ${ids.length === 1 ? `#${ids[0]}` : `${res.changed} object`} @f${frame} (dz ${dzText}m).` + editSuffix(res), 'success');
  }

  // Quét cloud từng frame: mỗi frame nạp cloud 1 lần, đo mặt đất cục bộ dưới từng box (Target hoặc cả nhóm)
  async function groundSweepCloud() {
    const ids = selectedOrTarget();
    if (!ids.length) return fail('Chọn object trước!');
    if (!allowAutoFrames('Quét Cloud dải')) return null;
    const r = await resolveGroundRange(ids[0]);
    if (!r) return;

    const mode = val('cqt-ground-mode') || 'snap';
    const direction = val('cqt-ground-direction') || 'both';
    const autoFallback = isChecked('cqt-ground-auto-fallback');
    const totalFrames = r.to - r.from + 1;
    const who = idsText(ids);

    if (totalFrames > 30 &&
      !confirm(`Quét Cloud từng frame cho ${who} từ frame ${r.from} đến ${r.to} (${totalFrames} frame)?
Tool sẽ tự chuyển frame để nạp point cloud của từng frame.`)) {
      return;
    }

    const originalFrame = getFrame();
    const batch = createBatch(`Quét Cloud fit đất dải (${who})`);
    let prevPos = null;
    let noCloud = 0, fallbackCount = 0;
    const lastGood = new Map(); // id -> plane gần nhất của chính box đó
    let minDz = Infinity, maxDz = -Infinity;

    for (let f = r.from; f <= r.to; f++) {
      const states = [];
      for (const id of ids) {
        const s = await getState(id, f);
        if (!isCuboid(s) || s.outside) continue;
        if (r.keyframesOnly && !isKey(s)) continue;
        states.push(s);
      }
      if (!states.length) continue;

      setStatus(`⏳ Đang quét Cloud ${who}: frame ${f}/${r.to}...`);
      const pos = await cloudAtFrame(f, prevPos);
      if (pos) prevPos = pos;

      for (const s of states) {
        let plane = pos ? estimateGroundPlane(s.points, pos) : null;
        if (plane) {
          lastGood.set(s.clientID, plane);
          if (ids.length === 1) groundPlaneCache.set(f, { ...plane, source: `cloud @f${f}`, frame: f });
        } else if (autoFallback && lastGood.has(s.clientID)) {
          plane = lastGood.get(s.clientID);
          fallbackCount++;
        } else {
          noCloud++;
          continue;
        }

        await batch.edit(s, f, (st) => {
          const after = fitToGround(st.points, plane, mode);
          const dz = after[2] - st.points[2];
          const rotChanged = Math.abs(after[3] - st.points[3]) > 1e-6 || Math.abs(after[4] - st.points[4]) > 1e-6;
          if (Math.abs(dz) < 1e-4 && !rotChanged) return false;
          if ((direction === 'down' && dz > 0) || (direction === 'up' && dz < 0)) return false;
          st.points = after;
          minDz = Math.min(minDz, dz);
          maxDz = Math.max(maxDz, dz);
          return true;
        });
      }
    }

    const res = await batch.finish();
    if (Number.isInteger(originalFrame) && originalFrame !== getFrame()) await goToFrame(originalFrame);

    if (!res.changed) {
      return setStatus(
        noCloud ? `⚠️ Không đủ điểm cloud để fit (${noCloud} lần thiếu).` : 'ℹ️ Các frame đã nằm sát mặt đất.',
        noCloud ? 'warn' : 'success'
      );
    }

    setStatus(
      `🤖 Đã quét Cloud & fit ${res.changed} frame cho ${who} (dz ${fmtSigned(minDz, 3)} → ${fmtSigned(maxDz, 3)}m)` +
      (fallbackCount ? `, ${fallbackCount} lần kế thừa plane frame trước` : '') +
      (noCloud ? `, ${noCloud} lần bỏ qua do mất cloud` : '') + '.' + editSuffix(res),
      'success'
    );
  }

  async function groundFollowReference() {
    const refIds = getReferenceBoxIds();
    if (!refIds.length) {
      return fail('Cần ít nhất 1 Anchor ID (vd: 1 hoặc chuỗi ưu tiên: 1, 4). Hãy nhập vào ô Anchor.');
    }

    // Xác định danh sách target: Target ID hoặc nhóm box được chọn (trừ các Anchor ID)
    const targetIds = selectedOrTarget().filter((tid) => !refIds.includes(tid));
    if (!targetIds.length) {
      return fail('Không có object mục tiêu nào cần fit! Hãy nhập Target ID hoặc chọn các box cần fit (khác với Anchor ID).');
    }

    // Dải frame: lấy theo target đầu tiên hoặc dải đang nhập
    const r = await resolveGroundRange(targetIds[0]);
    if (!r) return;

    const mode = val('cqt-ground-mode') || 'snap';
    const direction = val('cqt-ground-direction') || 'both';
    const autoFallback = isChecked('cqt-ground-auto-fallback');

    const targetLabels = targetIds.map((id) => '#' + id).join(', ');
    const anchorLabels = refIds.map((id) => '#' + id).join(' → ');
    setStatus(`⏳ Đang bám Anchor (${anchorLabels}) fit cho ${targetIds.length} object (${targetLabels}) từ frame ${r.from} đến ${r.to}...`);

    const batch = createBatch(`Bám Anchor dải (${targetLabels})`);
    let fitted = 0, noRef = 0, skipped = 0;
    let lastGoodPlane = groundPlane;
    let minDz = Infinity, maxDz = -Infinity;

    for (let f = r.from; f <= r.to; f++) {
      // 1. Tìm Anchor hợp lệ đầu tiên theo chuỗi ưu tiên
      let activeAnchor = null;
      for (const rid of refIds) {
        const rs = await getState(rid, f);
        if (rs && isCuboid(rs) && !rs.outside) {
          activeAnchor = { id: rid, state: rs };
          break;
        }
      }

      let plane = null;
      if (activeAnchor) {
        const sp = planeFromSingleBox(activeAnchor.state.points);
        plane = { ...sp, source: `anchor #${activeAnchor.id} @f${f}`, frame: f };
        lastGoodPlane = plane;
        groundPlaneCache.set(f, plane);
      } else if (autoFallback && lastGoodPlane) {
        plane = lastGoodPlane;
      } else {
        noRef++;
        continue;
      }

      // 2. Fit cho tất cả các object mục tiêu tại frame f
      for (const tid of targetIds) {
        const s = await getState(tid, f);
        if (!s || !isCuboid(s) || s.outside) { skipped++; continue; }
        if (r.keyframesOnly && !isKey(s)) { skipped++; continue; }

        await batch.edit(s, f, (st) => {
          const after = fitToGround(st.points, plane, mode);
          const dz = after[2] - st.points[2];
          const rotChanged = Math.abs(after[3] - st.points[3]) > 1e-6 || Math.abs(after[4] - st.points[4]) > 1e-6;
          if (Math.abs(dz) < 1e-4 && !rotChanged) return false;
          if ((direction === 'down' && dz > 0) || (direction === 'up' && dz < 0)) return false;
          st.points = after;
          minDz = Math.min(minDz, dz);
          maxDz = Math.max(maxDz, dz);
          fitted++;
          return true;
        });
      }
    }

    const res = await batch.finish();
    if (!res.changed) {
      return setStatus(
        noRef ? `⚠️ Không tìm thấy Anchor ở các frame (${noRef} frame).` : 'ℹ️ Các object đã đúng cao độ mặt đất.',
        noRef ? 'warn' : 'success'
      );
    }

    setStatus(
      `👥 Đã bám Anchor (${anchorLabels}) & fit ${res.changed} lần cho ${targetIds.length} object (${targetLabels}) ` +
      `(dz ${fmtSigned(minDz, 3)} → ${fmtSigned(maxDz, 3)}m)` +
      (noRef ? `, ${noRef} frame thiếu anchor (đã fallback)` : '') + editSuffix(res),
      'success'
    );
  }

  async function applyGroundFit() {
    const range = readRange();
    if (!range) return;
    const plane = await ensureGroundPlane();
    if (!plane) return;
    const r = groundRange(range);
    if (!r) return fail('Không đọc được frame hiện tại.');

    const mode = val('cqt-ground-mode') || 'snap';
    const direction = val('cqt-ground-direction') || 'both';
    const keyframesOnly = val('cqt-ground-scope') === 'keyframes';
    let skippedDir = 0;
    let minDz = Infinity, maxDz = -Infinity;

    const res = await editRange('Fit mặt đất', {
      targetId: range.targetId, startFrame: r.from, endFrame: r.to, keyframesOnly,
    }, (s) => {
      const after = fitToGround(s.points, plane, mode);
      const dz = after[2] - s.points[2];
      const rotChanged = Math.abs(after[3] - s.points[3]) > 1e-6 || Math.abs(after[4] - s.points[4]) > 1e-6;
      if (Math.abs(dz) < 1e-4 && !rotChanged) return false;
      if ((direction === 'down' && dz > 0) || (direction === 'up' && dz < 0)) {
        skippedDir++;
        return false;
      }
      s.points = after;
      minDz = Math.min(minDz, dz);
      maxDz = Math.max(maxDz, dz);
      return true;
    });

    if (!res.changed) {
      if (!res.seen) return fail(`Không thấy #${range.targetId} trong dải.`);
      return setStatus(
        keyframesOnly && res.skipped === res.seen
          ? 'ℹ️ Không có keyframe nào trong dải. Chọn phạm vi khác hoặc Mọi frame.'
          : `ℹ️ Không có frame nào cần đổi${skippedDir ? ` (bỏ qua ${skippedDir} do hướng "${direction}")` : ''}.`,
        'warn'
      );
    }
    setStatus(
      `✅ Fit mặt đất #${range.targetId}: ${res.changed} frame (dz ${fmtSigned(minDz, 3)} → ${fmtSigned(maxDz, 3)}m).` +
      (skippedDir ? ` Bỏ qua ${skippedDir} frame do hướng "${direction}".` : '') + editSuffix(res),
      'success'
    );
  }

  // Alt+G: đặt object(s) lên mặt đất cục bộ (tính từ cloud quanh từng object) tại frame hiện tại
  async function quickGroundSnap(ids) {
    const frame = getFrame();
    if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại.');
    const list = ids?.length ? ids : [resolveTargetId()].filter(Number.isInteger);
    if (!list.length) return fail('Chọn object trước!');

    const mode = val('cqt-ground-mode') || 'snap';
    const batch = createBatch('Hạ chạm đất');
    let noCloud = 0;
    for (const id of list) {
      const s = await getState(id, frame);
      if (!isCuboid(s) || s.outside) continue;
      let plane = planeFromCloud(s.points) || groundPlane;
      if (!plane && isChecked('cqt-ground-auto-fallback')) {
        const prev = findPrevGroundPlane(frame);
        if (prev) plane = prev.plane;
      }
      if (!plane) { noCloud++; continue; }
      await batch.edit(s, frame, (st) => {
        const after = fitToGround(st.points, plane, mode);
        if (Math.abs(after[2] - st.points[2]) < 1e-4 && mode === 'snap') return false;
        st.points = after;
        return true;
      });
    }
    const res = await batch.finish();
    if (!res.changed) {
      return setStatus(noCloud ? '⚠️ Không đủ điểm cloud để tìm mặt đất (và không có plane frame trước).' : 'ℹ️ Đã nằm sát mặt đất.', noCloud ? 'error' : 'success');
    }
    setStatus(`⬇️ Đã hạ chạm đất ${res.changed} object tại frame ${frame}.` + editSuffix(res), 'success');
  }

  // =========================================================================
  // Smart Snap: hút box theo cụm điểm LiDAR của chủ thể
  // 1) Lấy điểm cao hơn mặt đất cục bộ trong 1 VÒNG TRÒN quanh box (không cắt theo khung box,
  //    vì cạnh cắt thẳng tạo "cạnh giả" kéo hướng về góc ban đầu).
  // 2) Tách cụm: loang từ các điểm nằm trong box sang điểm lân cận (Euclidean clustering),
  //    lấy cụm chiếm phần lớn box => không dính xe bên cạnh / cây / tường, không cụt khi box lệch.
  // 3) Hướng: L-shape fitting trên cụm điểm (chung với "Nắn theo cloud").
  // 4) Vị trí: khoá LWH, bám mặt nhìn thấy (mặt gần cảm biến); đáy đặt lên mặt đất.
  // =========================================================================
  const SNAP_MIN_H = 0.25; // bỏ điểm thấp hơn mức này so với mặt đất (đất gồ ghề, gờ)

  function snapGround(p, positions) {
    return estimateGroundPlane(p, positions) || flatPlane(bottomZ(p));
  }

  // Điểm ứng viên quanh box (đã bỏ mặt đất), dạng [x, y, z, độ cao so với đất].
  // Độ cao đất đo theo từng ô 1 m (đỉnh tập trung điểm thấp nhất), vì plane ngoại suy ra xa
  // trên đường gồ ghề sẽ để lọt điểm đất => cụm điểm loang dính sang mặt đường.
  function snapCandidates(p, positions, plane, extra = 2.5) {
    const R = 0.5 * Math.hypot(p[6], p[7]) + extra;
    const top = Math.abs(p[8]) + 0.4;
    const CELL = 1.0;
    const raw = [];
    const cells = new Map();
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      const dx = x - p[0], dy = y - p[1];
      if (dx * dx + dy * dy > R * R) continue;
      const g = planeZ(plane, x, y);
      if (z < g - 1 || z - g > top) continue;
      const k = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(z);
      raw.push([x, y, z, g, k]);
    }
    // Độ cao đất từng ô; ô cao hơn hẳn các ô đất xung quanh (chỉ thấy thân xe) bị loại
    const peaks = new Map();
    for (const [k, zs] of cells) {
      const [ix, iy] = k.split(',').map(Number);
      const pk = groundPeakZ(zs, 5);
      if (pk && pk.z - planeZ(plane, (ix + 0.5) * CELL, (iy + 0.5) * CELL) <= 0.5) peaks.set(k, pk.z);
    }
    const around = (k, map) => {
      const [ix, iy] = k.split(',').map(Number);
      const vals = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        if (!a && !b) continue;
        const v = map.get(`${ix + a},${iy + b}`);
        if (v !== undefined) vals.push(v);
      }
      return vals;
    };
    const ground = new Map();
    for (const [k, z] of peaks) {
      const nb = around(k, peaks);
      if (nb.length >= 2 && z - median(nb) > 0.2) continue;
      ground.set(k, z);
    }
    const groundAt = (k, x, y) => {
      if (ground.has(k)) return ground.get(k);
      const nb = around(k, ground); // ô bị thân xe che hết đất => lấy ô đất bên cạnh
      return nb.length ? median(nb) : planeZ(plane, x, y);
    };
    const out = [];
    for (const [x, y, z, , k] of raw) {
      const h = z - groundAt(k, x, y);
      if (h < SNAP_MIN_H || h > top) continue;
      out.push([x, y, z, h]);
    }
    return out;
  }

  // Euclidean clustering: loang từ seeds qua các điểm cách nhau ≤ r (lưới băm để tìm lân cận nhanh).
  // Trả về các cụm liên thông riêng biệt, mỗi cụm kèm số seed nằm trong nó.
  function clusterComponents(points, seeds, r) {
    const key = (ix, iy, iz) => `${ix},${iy},${iz}`;
    const grid = new Map();
    points.forEach((q, i) => {
      const k = key(Math.floor(q[0] / r), Math.floor(q[1] / r), Math.floor(q[2] / r));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    });
    const comp = new Int32Array(points.length).fill(-1);
    const r2 = r * r;
    const comps = [];
    for (const s0 of seeds) {
      if (comp[s0] >= 0) continue;
      const id = comps.length;
      const queue = [s0];
      comp[s0] = id;
      for (let qi = 0; qi < queue.length; qi++) {
        const q = points[queue[qi]];
        const ix = Math.floor(q[0] / r), iy = Math.floor(q[1] / r), iz = Math.floor(q[2] / r);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
          const cell = grid.get(key(ix + a, iy + b, iz + c));
          if (!cell) continue;
          for (const j of cell) {
            if (comp[j] >= 0) continue;
            const o = points[j];
            const dx = o[0] - q[0], dy = o[1] - q[1], dz = o[2] - q[2];
            if (dx * dx + dy * dy + dz * dz <= r2) { comp[j] = id; queue.push(j); }
          }
        }
      }
      comps.push({ idx: queue, seeds: 0 });
    }
    for (const s of seeds) comps[comp[s]].seeds++;
    return comps;
  }

  // Cụm điểm của chủ thể từ ứng viên. Trả về { pts, merged }
  function objectCluster(p, cands) {
    const L = Math.abs(p[6]), W = Math.abs(p[7]);
    const c = Math.cos(p[5]), s = Math.sin(p[5]);
    const inBox = (q, m) => {
      const dx = q[0] - p[0], dy = q[1] - p[1];
      return Math.abs(dx * c + dy * s) <= L / 2 + m && Math.abs(-dx * s + dy * c) <= W / 2 + m;
    };
    let seeds = [];
    cands.forEach((q, i) => { if (inBox(q, 0.1)) seeds.push(i); });
    if (seeds.length < 3) {
      seeds = [];
      cands.forEach((q, i) => { if (inBox(q, 0.6)) seeds.push(i); });
    }
    if (!seeds.length) return { pts: [], merged: false };
    // Bán kính loang tăng theo khoảng cách (LiDAR thưa dần khi xa)
    const r = clamp(0.2 + 0.012 * Math.hypot(p[0], p[1]), 0.3, 0.9);
    // Box chạm sang xe bên cạnh => có nhiều cụm; lấy cụm chiếm nhiều điểm trong box nhất
    const comps = clusterComponents(cands, seeds, r);
    const best = comps.reduce((x, y) => (y.seeds > x.seeds || (y.seeds === x.seeds && y.idx.length > x.idx.length) ? y : x));
    let pts = best.idx.map((i) => cands[i]);
    // Dính vật khác (cụm to bất thường) => chỉ giữ phần trong vòng tròn quanh box
    const reach = 0.5 * Math.hypot(L, W);
    const far = pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > reach * 1.4 + 0.8);
    if (far) pts = pts.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= reach + 0.4);
    return { pts, merged: far };
  }

  // Hướng từ cụm điểm (cùng logic "☁️ Nắn theo cloud"): L-shape trên mọi điểm của cụm,
  // chọn hướng gần refYaw nhất (giữ đầu xe). Quá ít điểm => theo gợi ý (box xung quanh / track).
  function cloudYaw(pts, refYaw, priors = []) {
    const fit = pts.length >= 6 ? fitRectYaw(pts, priors) : null;
    if (fit) return { yaw: nearestQuarterYaw(fit.yaw, refYaw), fit };
    return { yaw: priors.length ? nearestQuarterYaw(priors[0].yaw, refYaw) : refYaw, fit: null };
  }

  // Đo 1 frame. opts: { fitSize, refYaw, priors }. Trả về { points, n, conf, quality, merged, pts } hoặc { error }.
  // Ít điểm vẫn chạy: hướng dựa vào priors (box xung quanh / track), vị trí bám mặt nhìn thấy.
  function snapMeasure(p, cands, plane, opts = {}) {
    const { fitSize = false, refYaw = p[5], priors = [] } = opts;
    const { pts, merged } = objectCluster(p, cands);
    if (pts.length < 3) return { error: `Chỉ có ${pts.length} điểm của object quanh box.` };

    const { yaw, fit } = cloudYaw(pts, refYaw, priors);

    const c = Math.cos(yaw), s = Math.sin(yaw);
    const us = pts.map((q) => q[0] * c + q[1] * s);
    const vs = pts.map((q) => -q[0] * s + q[1] * c);
    const robust = pts.length >= 50;
    const uMin = robust ? percentile(us, 0.01) : Math.min(...us), uMax = robust ? percentile(us, 0.99) : Math.max(...us);
    const vMin = robust ? percentile(vs, 0.01) : Math.min(...vs), vMax = robust ? percentile(vs, 0.99) : Math.max(...vs);

    // Cảm biến ở gốc toạ độ => trong hệ (u, v) cũng ở 0.
    // Cảm biến nằm ngoài dải điểm theo trục nào thì mặt gần cảm biến là mặt thật => bám mặt đó.
    const place = (lo, hi, size) => {
      if (fitSize) return (lo + hi) / 2;
      if (lo > 0) return lo + size / 2;
      if (hi < 0) return hi - size / 2;
      return (lo + hi) / 2;
    };
    const L = fitSize ? Math.max(0.2, uMax - uMin) : Math.abs(p[6]);
    const W = fitSize ? Math.max(0.2, vMax - vMin) : Math.abs(p[7]);
    const cu = place(uMin, uMax, L), cv = place(vMin, vMax, W);

    const out = [...p];
    out[0] = cu * c - cv * s;
    out[1] = cu * s + cv * c;
    out[5] = yaw;
    out[6] = L;
    out[7] = W;
    if (fitSize) out[8] = Math.max(0.3, percentile(pts.map((q) => q[3]), 0.99));
    out[2] = planeZ(plane, out[0], out[1]) + Math.abs(out[8]) / 2;

    const conf = fit ? fit.conf : 0;
    const quality = Math.min(1, pts.length / 120) * (fit ? 0.4 + 0.6 * conf : 0.3) * (merged ? 0.5 : 1);
    return { points: fitToGround(out, plane, 'snap'), n: pts.length, conf, quality, merged, pts };
  }

  // Snap 1 frame từ point cloud. Lượt 2 loang lại từ box mới (bắt thêm điểm nếu box ban đầu lệch xa).
  // Không lặp nhiều lượt: lặp cắt-theo-box cũ là nguyên nhân box "trượt" dần khỏi chủ thể.
  function computeSmartSnap(p, positions, fitSize, priors = []) {
    const plane = snapGround(p, positions);
    const cands = snapCandidates(p, positions, plane);
    let r = snapMeasure(p, cands, plane, { fitSize, refYaw: p[5], priors });
    if (r.error) return r;
    const r2 = snapMeasure(r.points, cands, plane, { fitSize, refYaw: p[5], priors });
    if (!r2.error && r2.n > r.n) r = r2;
    return r;
  }

  async function smartSnap(ids) {
    const frame = getFrame();
    if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại.');
    const list = ids?.length ? ids : [resolveTargetId()].filter(Number.isInteger);
    if (!list.length) return fail('Chọn object trước!');
    const positions = getPointCloudPositions();
    if (!positions) return fail('Không đọc được point cloud.');

    const fitSize = isChecked('cqt-snap-fit-size');
    const batch = createBatch(fitSize ? 'Smart Snap (fit size)' : 'Smart Snap');
    const errors = [], unsure = [];
    let lastN = 0;
    const states = (await getStates(frame)).filter((s) => isCuboid(s) && !s.outside);
    for (const id of list) {
      const s = states.find((x) => x.clientID === id);
      if (!s) continue;
      const priors = yawPriors(s.points, states.filter((x) => x.clientID !== id).map((x) => x.points));
      const r = computeSmartSnap([...s.points], positions, fitSize, priors);
      if (r.error) { errors.push(`#${id}: ${r.error}`); continue; }
      if (r.conf < 0.25 || r.merged) unsure.push(id);
      lastN = r.n;
      await batch.edit(s, frame, (st) => { st.points = r.points; });
    }
    const res = await batch.finish();
    if (!res.changed) return fail(errors.join(' ') || 'Không snap được object nào.');
    setStatus(
      `🧲 Smart Snap ${res.changed} object` + (list.length === 1 ? ` (${lastN} điểm)` : '') +
      (fitSize ? ', đã fit cả size' : ', giữ nguyên LWH') + '.' +
      (unsure.length ? ` ⚠️ Chưa chắc (cloud thưa / 1 mặt / dính vật khác): #${unsure.join(', #')}.` : '') +
      (errors.length ? ` Lỗi: ${errors.join(' ')}` : '') + editSuffix(res),
      errors.length || unsure.length ? 'warn' : 'success'
    );
  }

  // Chỉ xoay yaw theo cạnh của cụm điểm (L-shape fitting), giữ nguyên vị trí và LWH
  async function alignYawToCloud() {
    const id = requireTarget();
    if (id === null) return;
    const frame = getFrame();
    const s = await requireCuboidAtFrame(id, frame);
    if (!s) return;
    const positions = getPointCloudPositions();
    if (!positions) return fail('Không đọc được point cloud.');
    const plane = snapGround(s.points, positions);
    const { pts } = objectCluster(s.points, snapCandidates(s.points, positions, plane));
    if (pts.length < 15) return fail(`Chỉ có ${pts.length} điểm của object, không đủ để nắn góc.`);

    const others = (await getStates(frame)).filter((x) => x.clientID !== id && isCuboid(x) && !x.outside).map((x) => x.points);
    const { yaw, fit } = cloudYaw(pts, s.points[5], yawPriors(s.points, others));
    const batch = createBatch('Nắn theo cloud');
    await batch.edit(s, frame, (st) => {
      const p = [...st.points];
      p[5] = yaw;
      st.points = p;
    });
    const res = await batch.finish();
    await inspectHeading(id, frame);
    setStatus(`☁️ Đã nắn #${id} theo cạnh cụm điểm (${(yaw * DEG).toFixed(1)}°, ${pts.length} điểm).` +
      (fit.conf < 0.25 ? ' ⚠️ Hướng chưa chắc, kiểm tra lại.' : '') + editSuffix(res), fit.conf < 0.25 ? 'warn' : 'success');
  }

  // =========================================================================
  // Object: chọn target, Auto-Sync, Lock ID, dải frame
  // =========================================================================
  let targetLocked = false;
  let lastSyncedObjId = null;
  let lastSyncedFrame = null;

  function toggleTargetLock() {
    targetLocked = !targetLocked;
    const btn = $('cqt-btn-lock-target');
    if (btn) {
      btn.classList.toggle('active', targetLocked);
      btn.title = targetLocked
        ? 'Đang khoá Target ID (bấm để mở khoá Auto-Sync)'
        : 'Khoá cố định Target ID (ngăn Auto-Sync tự đổi khi click box khác)';
    }
    setStatus(targetLocked ? 'Đã khoá cố định Target ID.' : 'Đã mở khoá Target ID (Auto-Sync hoạt động).', 'info');
  }

  async function updateKeyframeBadge(id = resolveTargetId(), frame = getFrame()) {
    const badge = $('cqt-kf-badge');
    if (!badge) return;
    if (!Number.isInteger(id) || !Number.isInteger(frame)) {
      badge.textContent = '--';
      badge.className = 'cqt-badge';
      return;
    }
    const s = await getState(id, frame);
    if (!isCuboid(s) || s.outside) {
      badge.textContent = s?.outside ? 'OUT' : '--';
      badge.className = 'cqt-badge';
      return;
    }
    const key = isKey(s);
    badge.textContent = key ? 'KEY' : 'LERP';
    badge.className = 'cqt-badge ' + (key ? 'cqt-badge-key' : 'cqt-badge-lerp');
  }

  async function fetchLWHQuiet(id, frame) {
    if (!Number.isInteger(id) || !Number.isInteger(frame)) return;
    const s = await getState(id, frame);
    if (!isCuboid(s)) return;
    const [, , , , , , l, w, h] = s.points;
    writeLWHInputs(l, w, h);
    await inspectHeading(id, frame);
    await updateKeyframeBadge(id, frame);
  }

  let syncBusy = false;
  async function syncActiveObjectQuiet() {
    if (syncBusy || !document.getElementById('cvat-quicktool-wrapper')) return;
    const frame = getFrame();
    const actId = activeId();
    const autoSync = getSettings().autoSyncObject;

    const objChanged = autoSync && !targetLocked && actId !== null && actId !== lastSyncedObjId;
    const frameChanged = Number.isInteger(frame) && frame !== lastSyncedFrame;
    if (!objChanged && !frameChanged) return;

    syncBusy = true;
    try {
      if (objChanged) {
        lastSyncedObjId = actId;
        lastSyncedFrame = frame;
        setField('cqt-target-id', actId);
        await fetchLWHQuiet(actId, frame);
        await matchPresetAndLimits(actId, frame);
        await loadAttrPanel(actId, true);
      } else if (frameChanged) {
        // Chỉ đổi frame: cập nhật hướng + badge, KHÔNG ghi đè ô L/W/H người dùng đang nhập dở
        lastSyncedFrame = frame;
        const tid = resolveTargetId();
        if (Number.isInteger(tid)) {
          await inspectHeading(tid, frame);
          await updateKeyframeBadge(tid, frame);
        }
      }
    } catch (e) {
      // Bỏ qua lỗi tạm thời khi CVAT đang chuyển frame
    } finally {
      syncBusy = false;
    }
  }

  async function detectActive() {
    const id = activeId();
    const frame = getFrame();
    if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại. Click vào canvas rồi thử lại.');
    if (id === null) return fail('Chưa chọn object nào trên canvas!');
    lastSyncedObjId = id;
    lastSyncedFrame = frame;
    setField('cqt-target-id', id);
    setField('cqt-frame-start', frame);
    setField('cqt-frame-end', frame);
    setField('cqt-frame-count', 1);
    await fetchLWH(id, frame);
    await matchPresetAndLimits(id, frame);
    await loadAttrPanel(id, true);
    await updateKeyframeBadge(id, frame);
  }

  function applyFrameCount() {
    const start = intVal('cqt-frame-start');
    const count = intVal('cqt-frame-count');
    if (!Number.isInteger(start) || !Number.isInteger(count) || count < 1) {
      return fail('Nhập Start Frame và tổng số frame (>= 1).');
    }
    const b = jobBounds();
    let end = start + count - 1;
    const cut = b && end > b.stop;
    if (cut) end = b.stop;
    setField('cqt-frame-end', end);
    setStatus(`📏 Dải áp dụng: ${start}–${end} (${end - start + 1} frame)${cut ? ` (cắt tại frame cuối ${b.stop})` : ''}.`, 'success');
  }

  async function detectSpanAndFill() {
    const id = requireTarget();
    if (id === null) return null;
    setStatus(`⏳ Đang dò dải frame của #${id}...`);
    const span = await detectSpan(id);
    if (!span) return null;
    setField('cqt-frame-start', span.startFrame);
    setField('cqt-frame-end', span.endFrame);
    setField('cqt-frame-count', span.endFrame - span.startFrame + 1);
    setStatus(`🔍 #${id}: frame ${span.startFrame}–${span.endFrame} (${span.count} frame có object).`, 'success');
    return span;
  }

  // Alt+A / ⌥A: Lấy object đang chọn + tự dò luôn dải frame trong 1 thao tác
  async function autoDetectAndSpan() {
    await detectActive();
    const id = activeId();
    if (Number.isInteger(id)) {
      await detectSpanAndFill();
    }
  }

  // =========================================================================
  // LWH
  // =========================================================================
  function readLWHInputs() {
    const l = numVal('cqt-lwh-l'), w = numVal('cqt-lwh-w'), h = numVal('cqt-lwh-h');
    return l > 0 && w > 0 && h > 0 ? { l, w, h } : null;
  }

  function writeLWHInputs(l, w, h) {
    setField('cqt-lwh-l', l.toFixed(3));
    setField('cqt-lwh-w', w.toFixed(3));
    setField('cqt-lwh-h', h.toFixed(3));
  }

  async function fetchLWH(id = resolveTargetId(), frame = getFrame()) {
    if (!Number.isInteger(id)) return fail('Nhập Target Object ID trước!');
    const s = await getState(id, frame);
    if (!isCuboid(s)) return fail(`Không thấy cuboid #${id} ở frame ${frame}.`);
    const [, , , , , , l, w, h] = s.points;
    writeLWHInputs(l, w, h);
    inspectHeading(id, frame);

    const label = labelName(s);
    const lim = getLimitsForLabel(label);
    const out = lim ? limitViolations(l, w, h, lim) : [];
    setStatus(
      `✅ #${id} [${label}] LWH ${fmtLWH(l, w, h)}` +
      (out.length ? ` ⚠️ Ngoài limits: ${out.join('; ')}.` : (lim ? ' (trong limits).' : '.')),
      out.length ? 'warn' : 'success'
    );
  }

  // Kẹp LWH theo limits của class nếu bật "Ép theo limits" (mặc định tắt: limits chỉ cảnh báo)
  async function clampLWHInputs(id, lwh) {
    if (!isChecked('cqt-limit-clamp-on-apply')) return { ...lwh, note: '' };
    const s = await getState(id, getFrame());
    const lim = getLimitsForLabel(labelName(s));
    if (!lim) return { ...lwh, note: '' };
    const c = clampLWH(lwh.l, lwh.w, lwh.h, lim);
    if (sameLWH([0, 0, 0, 0, 0, 0, lwh.l, lwh.w, lwh.h], c.l, c.w, c.h, 1e-9)) return { ...c, note: '' };
    writeLWHInputs(c.l, c.w, c.h);
    return { ...c, note: ` Đã kẹp theo limits [${labelName(s)}].` };
  }

  // scope: 'range' (dải Start–End) | 'track' (mọi keyframe của track) | 'frame' (chỉ frame hiện tại)
  async function applyLWH(scope) {
    const id = requireTarget();
    if (id === null) return;
    let input = readLWHInputs();
    if (!input) {
      await fetchLWH(id, getFrame());
      input = readLWHInputs();
    }
    if (!input) return fail('Nhập đủ L, W, H dương!');

    let opts;
    if (scope === 'frame') {
      const f = getFrame();
      if (!Number.isInteger(f)) return fail('Không đọc được frame hiện tại.');
      opts = { targetId: id, startFrame: f, endFrame: f };
    } else if (scope === 'track') {
      setStatus(`⏳ Đang dò dải frame của #${id}...`);
      const span = await detectSpan(id);
      if (!span) return;
      opts = { targetId: id, ...span, keyframesOnly: true };
    } else {
      const range = readRange();
      if (!range) return;
      opts = { ...range, keyframesOnly: isChecked('cqt-lwh-keyframe-only') };
    }

    const { l, w, h, note } = await clampLWHInputs(id, input);
    const keepGround = isChecked('cqt-keep-ground');
    const anchorMode = getSettings().anchorResize ? (val('cqt-lwh-anchor') || 'center') : 'center';
    const anchorLabels = {
      center: 'giữ tâm',
      sensor: 'giữ mặt gần LiDAR',
      front: 'giữ đầu xe',
      back: 'giữ đuôi xe',
      left: 'giữ sườn trái',
      right: 'giữ sườn phải',
    };
    const res = await editRange('LWH', opts, (s) => {
      if (sameLWH(s.points, l, w, h, 1e-9)) return false;
      s.points = withLWH(s.points, l, w, h, keepGround, anchorMode);
      return true;
    });

    if (!res.changed) {
      return setStatus(res.seen ? `#${id} đã có LWH ${fmtLWH(l, w, h)} trong phạm vi này.` : `Không thấy #${id} trong phạm vi.`, res.seen ? 'success' : 'error');
    }
    const where = scope === 'frame' ? `frame ${opts.startFrame}` :
      scope === 'track' ? `${res.changed} keyframe (frame ${opts.startFrame}–${opts.endFrame}), frame nội suy tự theo` :
        `${res.changed} frame`;
    const anchorNote = anchorMode !== 'center' ? ` (${anchorLabels[anchorMode] || anchorMode})` : '';
    setStatus(`LWH #${id} → ${fmtLWH(l, w, h)}${anchorNote} trên ${where}.` + note + editSuffix(res), 'success');
  }

  // Nhích bước nhỏ theo hệ trục cục bộ của từng box (Tiến/Lùi/Trái/Phải theo mũi xe, Lên/Xuống, ±1° yaw).
  // Phạm vi: frame này | dải Start–End | mọi keyframe của track. Áp cho Target hoặc cả nhóm Shift+Click.
  async function localMicroNudge(axis, sign) {
    const scope = val('cqt-nudge-scope') || 'frame';
    const step = Math.max(0.005, Math.abs(numVal('cqt-nudge-step')) || 0.05);
    const delta = step * sign;
    const isYaw = axis === 'YAW';

    const mutateBox = (st) => {
      const p = [...st.points];
      if (isYaw) {
        p[5] = wrapPi(p[5] + sign * RAD);
      } else if (axis === 'Z') {
        p[2] += delta;
      } else {
        const cos = Math.cos(p[5]), sin = Math.sin(p[5]);
        if (axis === 'X') { p[0] += delta * cos; p[1] += delta * sin; }
        else { p[0] -= delta * sin; p[1] += delta * cos; }
      }
      st.points = p;
      return true;
    };
    const labelDesc = isYaw ? `Xoay ${fmtSigned(sign, 0)}°` : `Nhích local ${axis} ${fmtSigned(delta, 2)}m`;

    if (scope === 'frame') {
      const ids = selectedOrTarget();
      if (!ids.length) return fail('Chọn object trước!');
      const frame = getFrame();
      if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại.');
      const batch = createBatch(labelDesc);
      for (const id of ids) {
        const s = await getState(id, frame);
        if (!isCuboid(s) || s.outside) continue;
        await batch.edit(s, frame, mutateBox);
      }
      const res = await batch.finish();
      if (!res.changed) return fail('Không tìm thấy cuboid hợp lệ ở frame hiện tại.');
      await updateKeyframeBadge();
      if (isYaw) await inspectHeading(resolveTargetId(), frame);
      return setStatus(`${labelDesc} cho ${res.changed} object tại f${frame}.` + editSuffix(res), 'success');
    }

    let opts;
    if (scope === 'keyframes') {
      const ids = selectedOrTarget();
      if (!ids.length) return fail('Chọn object trước!');
      const b = jobBounds();
      if (!b) return fail('Không đọc được dải frame của job.');
      opts = { targetId: ids[0], targetIds: ids, startFrame: b.start, endFrame: b.stop, keyframesOnly: true };
    } else {
      const range = readRange(true);
      if (!range) return;
      opts = { ...range, keyframesOnly: isChecked('cqt-lwh-keyframe-only') };
    }
    const res = await editRange(labelDesc, opts, mutateBox);
    if (!res.changed) return fail('Không có frame nào được cập nhật.');
    setStatus(`${labelDesc} cho ${idsText(opts.targetIds)} trên ${res.changed} frame.` + editSuffix(res), 'success');
  }

  let memClipboard = null; // bộ nhớ trang, mất khi tải lại

  async function copyTransform() {
    const id = requireTarget();
    if (id === null) return;
    const s = await requireCuboidAtFrame(id);
    if (!s) return;
    const clip = { points: [...s.points], label: labelName(s), ts: Date.now() };
    memClipboard = clip;
    if (safeData()) localStorage.removeItem(LS.clipboard);
    else lsSet(LS.clipboard, clip);
    setStatus(`📋 Đã copy transform #${id}.`, 'success');
  }

  async function pasteTransform() {
    const id = requireTarget();
    if (id === null) return;
    const clip = memClipboard || (safeData() ? null : lsGet(LS.clipboard, null));
    if (!clip?.points) return fail('Chưa copy transform nào.');
    const frame = getFrame();
    const s = await requireCuboidAtFrame(id, frame);
    if (!s) return;
    const batch = createBatch('Paste transform');
    await batch.edit(s, frame, (st) => { st.points = [...clip.points]; });
    const res = await batch.finish();
    setStatus(`📥 Đã paste transform vào #${id} tại frame ${frame}.` + editSuffix(res), 'success');
  }

  // =========================================================================
  // Keyframe & Cắt Track
  // Quy định dự án: chỉ được THÊM keyframe; không gỡ keyframe, không xoá object (chỉ đánh dấu outside).
  // =========================================================================
  // Điều hướng nhanh giữa các Keyframe của riêng Target Object (|< Đầu, < Trước, Sau >, Cuối >|)
  async function stepObjectKeyframe(dir) {
    const id = requireTarget();
    if (id === null) return;
    const b = jobBounds();
    if (!b) return fail('Không đọc được dải frame của job.');
    const curFrame = getFrame() ?? b.start;
    const list = await collectTrack(id, b.start, b.stop);
    const kfs = list.filter((x) => isKey(x.state)).map((x) => x.frame);
    if (!kfs.length) return fail(`Object #${id} không có keyframe nào trong job.`);

    let target = null;
    if (dir === 'first') {
      target = kfs[0];
    } else if (dir === 'last') {
      target = kfs[kfs.length - 1];
    } else if (dir === 'prev') {
      const prevs = kfs.filter((f) => f < curFrame);
      target = prevs.length ? prevs[prevs.length - 1] : kfs[0];
    } else if (dir === 'next') {
      const nexts = kfs.filter((f) => f > curFrame);
      target = nexts.length ? nexts[0] : kfs[kfs.length - 1];
    }

    if (target === null) return;
    await jumpTo(id, target);
    await updateKeyframeBadge(id, target);
    const idx = kfs.indexOf(target) + 1;
    setStatus(`Keyframe #${id}: f${target} (${idx}/${kfs.length}).`, 'info');
  }

  // Đặt keyframe tại frame hiện tại cho Target hoặc cả nhóm (không gỡ keyframe)
  async function setKeyframe() {
    const ids = selectedOrTarget();
    if (!ids.length) return fail('Chọn object trước!');
    const frame = getFrame();
    if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại.');
    const batch = createBatch('Đặt keyframe');
    let already = 0, shapes = 0;
    for (const id of ids) {
      const s = await getState(id, frame);
      if (!isCuboid(s) || s.outside) continue;
      if (s.objectType !== 'track') { shapes++; continue; }
      if (s.keyframe) { already++; continue; }
      await batch.edit(s, frame, (st) => { st.keyframe = true; });
    }
    const res = await batch.finish();
    await updateKeyframeBadge();
    if (!res.changed) {
      if (already) {
        return setStatus(`ℹ️ ${ids.length === 1 ? `#${ids[0]}` : `${already} object`} đã là keyframe ở frame ${frame} (tool không gỡ keyframe theo quy định dự án).`, 'success');
      }
      return fail(shapes ? 'Object là shape, không có keyframe.' : `Không tìm thấy track ở frame ${frame}.`);
    }
    setStatus(`⭐ Đã đặt keyframe ${ids.length === 1 ? `#${ids[0]}` : `${res.changed} object`} tại frame ${frame}.` +
      (already ? ` ${already} object vốn đã là keyframe.` : '') + editSuffix(res), 'success');
  }

  // Cắt đuôi track: Đặt outside = true từ frame hiện tại cho đến hết track (ngăn không cho xe hiện lại)
  async function cutTrackToEnd() {
    const ids = selectedOrTarget();
    if (!ids.length) return fail('Chọn object trước!');
    const curFrame = getFrame();
    if (!Number.isInteger(curFrame)) return fail('Không đọc được frame hiện tại.');

    if (!confirm(`Cắt đuôi track cho ${ids.length} object (#${ids.join(', #')}) từ frame ${curFrame} đến hết track?\n(Đặt outside = true cho toàn bộ frame từ ${curFrame} trở đi để xe không tự động hiện lại).`)) {
      return;
    }

    const batch = createBatch(`Cắt đuôi track (${ids.map((i) => '#' + i).join(', ')})`);

    for (const id of ids) {
      const span = await detectSpan(id);
      const end = span ? span.endFrame : (jobBounds()?.stop ?? curFrame);
      for (let f = curFrame; f <= end; f++) {
        const s = await getState(id, f);
        if (!s || !isCuboid(s) || s.outside) continue;
        if (s.objectType !== 'track') continue;
        // Đặt outside tại frame hiện tại và mọi keyframe tiếp theo
        if (f === curFrame || s.keyframe) {
          await batch.edit(s, f, (st) => { st.outside = true; });
        }
      }
    }

    const res = await batch.finish();
    if (!res.changed) return fail(`Không có frame nào cần đặt outside từ frame ${curFrame}.`);
    setStatus(`✂️ Đã cắt đuôi track cho ${ids.length} object từ frame ${curFrame} trở đi (${res.changed} lần đặt outside).` + editSuffix(res), 'success');
  }

  // =========================================================================
  // Preset LWH theo label
  // =========================================================================
  function getPresets() {
    return lsGet(LS.presets, {});
  }

  function refreshPresetList(selectLabel) {
    const select = $('cqt-preset-select');
    if (!select) return;
    const presets = getPresets();
    const labels = Object.keys(presets).sort();
    select.innerHTML = '';
    if (!labels.length) return select.add(new Option('(chưa có preset)', ''));
    for (const label of labels) {
      const p = presets[label];
      select.add(new Option(`${label}: ${p.l}×${p.w}×${p.h}`, label, false, label === selectLabel));
    }
  }

  async function matchPresetAndLimits(id, frame) {
    const s = await getState(id, frame);
    const label = labelName(s);
    if (!label) return;
    if (getPresets()[label]) refreshPresetList(label);
    const key = findLimitKey(label);
    if (key) refreshLimitClassList(key);
  }

  async function savePreset() {
    const id = requireTarget();
    if (id === null) return;
    const lwh = readLWHInputs();
    if (!lwh) return fail('Nhập LWH trước khi lưu preset!');
    const label = labelName(await getState(id, getFrame()));
    if (!label) return fail('Không lấy được label của object!');
    const presets = getPresets();
    presets[label] = lwh;
    lsSet(LS.presets, presets);
    refreshPresetList(label);
    setStatus(`💾 Đã lưu preset "${label}": ${lwh.l}×${lwh.w}×${lwh.h}`, 'success');
  }

  function applyPreset() {
    const label = val('cqt-preset-select');
    const p = getPresets()[label];
    if (!p) return fail('Chưa có preset nào được chọn.');
    writeLWHInputs(p.l, p.w, p.h);
    setStatus(`📐 Đã điền preset "${label}" — bấm Áp dụng LWH.`, 'success');
  }

  function deletePreset() {
    const label = val('cqt-preset-select');
    const presets = getPresets();
    if (!presets[label] || !confirm(`Xoá preset "${label}"?`)) return;
    delete presets[label];
    lsSet(LS.presets, presets);
    refreshPresetList();
    setStatus(`Đã xoá preset "${label}".`, 'success');
  }

  // =========================================================================
  // Limits LWH theo class
  // =========================================================================
  function getLimits() {
    const all = lsGet(LS.limits, null);
    if (all && typeof all === 'object') return all;
    const seeded = JSON.parse(JSON.stringify(DEFAULT_LIMITS));
    lsSet(LS.limits, seeded);
    return seeded;
  }

  // vehicles → vehicle, two_wheeler → two_wheel, Pedestrians → pedestrian
  function normalizeClass(value) {
    let s = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '_');
    if (s.endsWith('ers')) s = s.slice(0, -3);
    else if (s.endsWith('er')) s = s.slice(0, -2);
    else if (s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
    return s;
  }

  function findLimitKey(label) {
    if (!label) return null;
    return Object.keys(getLimits()).find((k) => normalizeClass(k) === normalizeClass(label)) || null;
  }

  function getClassGroups() {
    const saved = lsGet(LS.classGroups, null);
    return saved && typeof saved === 'object' ? saved : DEFAULT_CLASS_GROUPS;
  }

  // Tên nhóm (vehicle / two_wheel / pedestrian...) của một nhãn, null nếu không thuộc nhóm nào
  function findClassGroup(label) {
    if (!label) return null;
    const norm = normalizeClass(label);
    for (const [group, members] of Object.entries(getClassGroups())) {
      if (normalizeClass(group) === norm) return group;
      if (Array.isArray(members) && members.some((m) => normalizeClass(m) === norm)) return group;
    }
    return null;
  }

  // Đoán nhóm cho nhãn lạ theo từ khoá
  function suggestClassGroup(label) {
    const found = findClassGroup(label);
    if (found) return found;
    const norm = normalizeClass(label);
    if (/(veh|car|auto|truck|bus|van|suv|sedan|pickup|trailer)/.test(norm)) return 'vehicle';
    if (/(bike|moto|cycl|two_wheel|scooter)/.test(norm)) return 'two_wheel';
    if (/(ped|person|people|human|walker|child)/.test(norm)) return 'pedestrian';
    return null;
  }

  // Label có thật trong job thuộc nhóm đó (ưu tiên label trùng tên nhóm)
  function jobLabelForGroup(group) {
    const labels = jobLabels().filter((l) => findClassGroup(l.name) === group);
    return labels.find((l) => normalizeClass(l.name) === normalizeClass(group)) || labels[0] || null;
  }

  function getLimitsForLabel(label) {
    const key = findLimitKey(label) || findLimitKey(findClassGroup(label));
    return key ? getLimits()[key] : null;
  }

  function clampLWH(l, w, h, lim) {
    return { l: clamp(l, lim.l[0], lim.l[1]), w: clamp(w, lim.w[0], lim.w[1]), h: clamp(h, lim.h[0], lim.h[1]) };
  }

  function limitViolations(l, w, h, lim) {
    const out = [];
    const check = (name, v, [lo, hi]) => {
      if (v < lo - 1e-9) out.push(`${name} ${v.toFixed(2)} < ${lo}`);
      else if (v > hi + 1e-9) out.push(`${name} ${v.toFixed(2)} > ${hi}`);
    };
    check('L', l, lim.l);
    check('W', w, lim.w);
    check('H', h, lim.h);
    return out;
  }

  function limitText(lim) {
    return `L ${lim.l[0]}–${lim.l[1]}, W ${lim.w[0]}–${lim.w[1]}, H ${lim.h[0]}–${lim.h[1]}`;
  }

  const LIMIT_FIELDS = ['l-min', 'l-max', 'w-min', 'w-max', 'h-min', 'h-max'];

  function loadLimitForm(key) {
    const lim = getLimits()[key];
    const values = lim ? [lim.l[0], lim.l[1], lim.w[0], lim.w[1], lim.h[0], lim.h[1]] : ['', '', '', '', '', ''];
    LIMIT_FIELDS.forEach((f, i) => setField(`cqt-limit-${f}`, values[i]));
  }

  function refreshLimitClassList(selected) {
    const select = $('cqt-limit-class');
    if (!select) return;
    const all = getLimits();
    const keys = Object.keys(all).sort();
    select.innerHTML = '';
    if (!keys.length) select.add(new Option('(chưa có class)', ''));
    for (const key of keys) select.add(new Option(`${key}: ${limitText(all[key])}`, key));
    if (selected && keys.includes(selected)) select.value = selected;
    loadLimitForm(select.value);
  }

  function saveLimitForm() {
    const key = String(val('cqt-limit-class-name') || '').trim() || String(val('cqt-limit-class') || '').trim();
    if (!key) return fail('Chọn class có sẵn hoặc nhập tên class mới.');
    const v = LIMIT_FIELDS.map((f) => numVal(`cqt-limit-${f}`));
    if (v.some((x) => !(x > 0))) return fail('Nhập đủ 6 ngưỡng dương (min/max cho L, W, H).');
    if (v[0] > v[1] || v[2] > v[3] || v[4] > v[5]) return fail('Min không được lớn hơn max.');
    const all = getLimits();
    const actualKey = findLimitKey(key) || key;
    all[actualKey] = { l: [v[0], v[1]], w: [v[2], v[3]], h: [v[4], v[5]] };
    lsSet(LS.limits, all);
    setField('cqt-limit-class-name', '');
    refreshLimitClassList(actualKey);
    setStatus(`💾 Đã lưu limits "${actualKey}": ${limitText(all[actualKey])}.`, 'success');
  }

  function deleteLimitClass() {
    const key = val('cqt-limit-class');
    const all = getLimits();
    if (!key || !(key in all) || !confirm(`Xoá limits của class "${key}"?`)) return;
    delete all[key];
    lsSet(LS.limits, all);
    refreshLimitClassList();
    setStatus(`Đã xoá limits class "${key}".`, 'success');
  }

  function resetLimits() {
    if (!confirm('Reset toàn bộ limits về ngưỡng tiêu chuẩn?')) return;
    lsSet(LS.limits, JSON.parse(JSON.stringify(DEFAULT_LIMITS)));
    refreshLimitClassList('vehicle');
    setStatus('↺ Đã reset limits về tiêu chuẩn.', 'success');
  }

  async function fillClassNameFromObject() {
    const id = requireTarget();
    if (id === null) return;
    const label = labelName(await getState(id, getFrame()));
    if (!label) return fail('Không lấy được label của object ở frame hiện tại.');
    setField('cqt-limit-class-name', label);
    const key = findLimitKey(label);
    if (key) refreshLimitClassList(key);
    setStatus(key ? `📌 Class "${label}" — đã nạp limits có sẵn.` : `📌 Class "${label}" — nhập limits rồi bấm Lưu.`, 'success');
  }

  function clampMutator(lim, stats) {
    return (s) => {
      const p = s.points;
      const c = clampLWH(p[6], p[7], p[8], lim);
      if (sameLWH(p, c.l, c.w, c.h, 1e-9)) return false;
      if (stats && !stats.example) stats.example = `${fmtLWH(p[6], p[7], p[8])} → ${fmtLWH(c.l, c.w, c.h)}`;
      s.points = withLWH(p, c.l, c.w, c.h, true);
      return true;
    };
  }


  function classScope() {
    const b = jobBounds();
    if (!b) return fail('Chưa kết nối CVAT Job!');
    if (isChecked('cqt-limit-class-all-job')) return { from: b.start, to: b.stop };
    const from = intVal('cqt-frame-start'), to = intVal('cqt-frame-end');
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) return fail('Dải frame không hợp lệ.');
    return { from, to };
  }

  async function forEachClassState(className, scope, fn) {
    for (let f = scope.from; f <= scope.to; f++) {
      if (f > scope.from && (f - scope.from) % 50 === 0) {
        setStatus(`⏳ Class "${className}": frame ${f}/${scope.to}...`);
        await sleep(0);
      }
      for (const s of await getStates(f)) {
        if (!isCuboid(s) || s.outside || normalizeClass(labelName(s)) !== normalizeClass(className)) continue;
        await fn(s, f);
      }
    }
  }

  async function checkClassLimits() {
    const className = val('cqt-limit-class');
    const lim = getLimits()[className];
    if (!lim) return fail('Chọn class có limits trước.');
    const scope = classScope();
    if (!scope) return;

    const byId = new Map();
    await forEachClassState(className, scope, (s) => {
      const rec = byId.get(s.clientID) || { id: s.clientID, frames: 0, bad: 0, example: '' };
      byId.set(s.clientID, rec);
      rec.frames++;
      const v = limitViolations(s.points[6], s.points[7], s.points[8], lim);
      if (v.length) {
        rec.bad++;
        if (!rec.example) rec.example = v.join(', ');
      }
    });
    if (!byId.size) return fail(`Không thấy object nào thuộc class "${className}".`);

    const bad = [...byId.values()].filter((r) => r.bad).sort((a, b) => b.bad - a.bad);
    const lines = [`Class "${className}" (${limitText(lim)}): ${bad.length}/${byId.size} object ngoài ngưỡng.`];
    for (const r of bad.slice(0, 20)) lines.push(`#${r.id}: ${r.bad}/${r.frames} frame — ${r.example}`);
    if (bad.length > 20) lines.push(`... +${bad.length - 20} object khác`);
    const pre = $('cqt-limit-result');
    if (pre) pre.textContent = lines.join('\n');
    setStatus(`🔎 ${lines[0]}`, bad.length ? 'warn' : 'success');
  }

  async function clampClassLimits() {
    const className = val('cqt-limit-class');
    const lim = getLimits()[className];
    if (!lim) return fail('Chọn class có limits trước.');
    const scope = classScope();
    if (!scope) return;
    const keyframesOnly = isChecked('cqt-limit-class-keyframes');
    if (!keyframesOnly && !confirm('Clamp mọi frame sẽ biến mọi frame thành keyframe. Tiếp tục?')) return;

    const batch = createBatch(`Clamp class "${className}"`);
    const objects = new Set();
    const mutate = clampMutator(lim);
    await forEachClassState(className, scope, async (s, f) => {
      if (keyframesOnly && !isKey(s)) return;
      if (await batch.edit(s, f, mutate)) objects.add(s.clientID);
    });
    const res = await batch.finish();
    if (!res.changed) return setStatus(`ℹ️ Class "${className}": không có frame nào ngoài limits.`, 'success');
    setStatus(`📏 Clamp class "${className}": ${objects.size} object, ${res.changed} frame.` + editSuffix(res), 'success');
  }

  // =========================================================================
  // Chọn nhiều box (Shift + Click trên canvas hoặc danh sách object)
  // =========================================================================
  const selection = new Set();

  function renderSelection() {
    const n = selection.size;
    const count = $('cqt-multi-count');
    if (count) count.textContent = String(n);
    const drawer = $('cqt-multi-drawer');
    if (drawer) drawer.style.display = n > 0 ? 'flex' : 'none';
    const addBtn = $('cqt-btn-add-selection');
    if (addBtn) addBtn.classList.toggle('cqt-btn-group-active', n > 0);
    const box = $('cqt-multi-list');
    if (!box) return;
    box.innerHTML = '';
    for (const id of selection) {
      const chip = document.createElement('span');
      chip.className = 'cqt-chip';
      chip.textContent = `#${id} ✕`;
      chip.title = 'Bỏ khỏi nhóm';
      chip.addEventListener('click', () => { selection.delete(id); renderSelection(); });
      box.appendChild(chip);
    }
  }

  function toggleSelection(id) {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    renderSelection();
  }

  async function selectAllInFrame() {
    const frame = getFrame();
    if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại.');
    for (const s of await getStates(frame)) {
      if (isCuboid(s) && !s.outside) selection.add(s.clientID);
    }
    renderSelection();
    setStatus(`🎯 Đã chọn ${selection.size} box ở frame ${frame}.`, 'success');
  }

  function selectedOrTarget() {
    if (selection.size) return [...selection];
    const id = resolveTargetId();
    return Number.isInteger(id) ? [id] : [];
  }


  // Không được xoá object: chỉ đánh dấu outside tại frame hiện tại (cho Nhóm hoặc Target)
  async function outsideSelected() {
    const ids = selectedOrTarget();
    if (!ids.length) return fail('Chọn object hoặc nhóm box (Shift/Cmd + Click) trước!');
    const frame = getFrame();
    if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại.');
    if (!confirm(`Đặt outside tại frame ${frame} cho ${ids.length} object: ${ids.map((i) => '#' + i).join(', ')}?`)) return;
    const batch = createBatch('Đặt outside');
    let shapes = 0;
    for (const id of ids) {
      const s = await getState(id, frame);
      if (!isCuboid(s) || s.outside) continue;
      if (s.objectType !== 'track') { shapes++; continue; }
      await batch.edit(s, frame, (st) => { st.outside = true; });
    }
    const res = await batch.finish();
    if (!res.changed) return fail(shapes ? 'Shape không có thuộc tính outside.' : 'Không có object nào cần đặt outside.');
    setStatus(`🙈 Đã đặt outside ${res.changed} object từ frame ${frame}.` +
      (shapes ? ` Bỏ qua ${shapes} shape (không có outside).` : '') + editSuffix(res), 'success');
  }

  // =========================================================================
  // Sub label (thuộc tính checkbox của label): tick / bỏ tick theo lựa chọn
  // Lựa chọn lưu theo label: { [label]: { [tên thuộc tính]: 'on' | 'off' | 'keep' } }
  // =========================================================================
  let attrPanelLabel = null; // label đang hiển thị trong panel
  let lastAutoAttrId = null; // object đã tự áp gần nhất (chế độ tự áp)

  function checkboxSpecs(state) {
    return attrSpecs(state).filter((a) => a.inputType === 'checkbox' && !TRACK_ID_ATTR.test(String(a.name || '').trim()));
  }

  function getAttrProfiles() {
    const saved = lsGet(LS.attrProfiles, null);
    return saved && typeof saved === 'object' ? saved : {};
  }

  function getAttrProfile(label) {
    return getAttrProfiles()[label] || {};
  }

  function saveAttrChoice(label, name, choice) {
    const all = getAttrProfiles();
    all[label] = { ...(all[label] || {}), [name]: choice };
    lsSet(LS.attrProfiles, all);
  }

  function isTrue(v) {
    return String(v).toLowerCase() === 'true';
  }

  // Vẽ danh sách sub label của object
  async function loadAttrPanel(id = resolveTargetId(), quiet = false) {
    const box = $('cqt-attr-list');
    if (!box) return;
    if (!Number.isInteger(id)) return quiet ? null : fail('Chọn object trước!');
    const s = quiet ? await getState(id, getFrame()) : await requireCuboidAtFrame(id);
    if (!isCuboid(s)) return;
    const label = labelName(s);
    const specs = checkboxSpecs(s);
    attrPanelLabel = label;
    box.innerHTML = '';
    const title = $('cqt-attr-label');
    if (title) title.textContent = label ? `[${label}]` : '';
    if (!specs.length) {
      box.textContent = `Label "${label}" không có sub label dạng checkbox.`;
      return;
    }
    const profile = getAttrProfile(label);
    for (const spec of specs) {
      const row = document.createElement('div');
      row.className = 'cqt-row cqt-attr-row';
      const name = document.createElement('span');
      name.className = 'cqt-label';
      name.style.flex = '1';
      const now = isTrue(attrValue(s, spec));
      name.textContent = `${spec.name} ${now ? '☑' : '☐'}`;
      name.title = `Hiện tại ở frame ${getFrame()}: ${now ? 'đang tick' : 'chưa tick'}${spec.mutable ? ' (thay đổi theo frame)' : ''}`;
      const select = document.createElement('select');
      select.className = 'cqt-input cqt-attr-choice';
      select.style.width = '110px';
      select.dataset.attr = spec.name;
      for (const [v, text] of [['keep', 'Giữ nguyên'], ['on', '✔ Tick'], ['off', '✖ Bỏ tick']]) select.add(new Option(text, v));
      select.value = profile[spec.name] || 'keep';
      select.addEventListener('change', () => saveAttrChoice(label, spec.name, select.value));
      row.append(name, select);
      box.appendChild(row);
    }
  }

  function setAllAttrChoices(choice) {
    if (!attrPanelLabel) return fail('Bấm "Nạp" để hiện sub label trước.');
    document.querySelectorAll('.cqt-attr-choice').forEach((sel) => {
      sel.value = choice;
      saveAttrChoice(attrPanelLabel, sel.dataset.attr, choice);
    });
  }

  // Các frame cần sửa cho 1 object theo phạm vi
  async function attrFramesFor(id, scope) {
    const f = getFrame();
    if (scope === 'frame') return Number.isInteger(f) ? [f] : [];
    let from, to;
    if (scope === 'range') {
      from = intVal('cqt-frame-start');
      to = intVal('cqt-frame-end');
      if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) return null;
    } else {
      const b = jobBounds();
      if (!b) return [];
      from = b.start;
      to = b.stop;
    }
    const list = await collectTrack(id, from, to);
    // Track: sửa mọi keyframe (thuộc tính đổi theo frame giữ giá trị tới keyframe kế tiếp)
    const keys = list.filter((x) => isKey(x.state)).map((x) => x.frame);
    return keys.length ? keys : list.slice(0, 1).map((x) => x.frame);
  }

  async function applyAttrProfile(ids = selectedOrTarget(), { quiet = false } = {}) {
    if (!ids.length) return fail('Chọn object trước!');
    const scope = val('cqt-attr-scope') || 'track';
    const batch = createBatch('Sub label');
    let objects = 0, noProfile = 0;
    for (const id of ids) {
      const frames = await attrFramesFor(id, scope);
      if (frames === null) return fail('Dải frame không hợp lệ (Start <= End)!');
      let touched = false;
      for (const f of frames) {
        const s = await getState(id, f);
        if (!isCuboid(s) || s.outside) continue;
        const profile = getAttrProfile(labelName(s));
        const wanted = checkboxSpecs(s).filter((spec) => profile[spec.name] === 'on' || profile[spec.name] === 'off');
        if (!wanted.length) { noProfile++; break; }
        const ok = await batch.edit(s, f, (st) => {
          let changed = false;
          for (const spec of wanted) {
            const want = profile[spec.name] === 'on';
            if (isTrue(attrValue(st, spec)) === want) continue;
            setAttr(st, spec, want ? 'true' : 'false');
            changed = true;
          }
          return changed;
        });
        touched = touched || ok;
      }
      if (touched) objects++;
    }
    const res = await batch.finish();
    if (attrPanelLabel) await loadAttrPanel(resolveTargetId(), true);
    if (quiet && !res.changed) return;
    if (!res.changed) {
      return setStatus(noProfile === ids.length
        ? '⚠️ Chưa chọn sub label nào để tick/bỏ tick cho label này.'
        : 'ℹ️ Sub label đã đúng như lựa chọn.', noProfile === ids.length ? 'warn' : 'success');
    }
    const where = { frame: `frame ${getFrame()}`, track: 'toàn track', range: 'dải Start–End' }[scope];
    setStatus(`🏷️ Đã cập nhật sub label cho ${objects} object (${res.changed} lần sửa, ${where}).` +
      (noProfile ? ` Bỏ qua ${noProfile} object vì label của nó chưa có lựa chọn sub label.` : '') + editSuffix(res), 'success');
  }

  // Chế độ tự áp: gọi mỗi giây từ vòng init, chỉ chạy khi object được chọn thay đổi
  let autoAttrBusy = false;
  async function autoAttrTick() {
    if (autoAttrBusy || !isChecked('cqt-attr-auto')) return;
    const id = activeId();
    if (id === null || id === lastAutoAttrId) return;
    lastAutoAttrId = id;
    autoAttrBusy = true;
    try {
      await applyAttrProfile([id], { quiet: true });
    } catch (e) {
      console.warn(LOG, 'Tự áp sub label lỗi:', e);
    } finally {
      autoAttrBusy = false;
    }
  }

  // =========================================================================
  // Track: dịch, xoay, hướng đi, làm mượt, keyframe
  // =========================================================================
  function trackKeyframesOnly() {
    return isChecked('cqt-track-keyframe-only');
  }

  async function shiftTrack() {
    const range = readRange(true);
    if (!range) return;
    const dx = numVal('cqt-shift-x') || 0, dy = numVal('cqt-shift-y') || 0, dz = numVal('cqt-shift-z') || 0;
    if (!dx && !dy && !dz) return fail('Nhập ít nhất một giá trị dX/dY/dZ.');
    const res = await editRange(`Dịch (${dx}, ${dy}, ${dz})`, { ...range, keyframesOnly: trackKeyframesOnly() }, (s) => {
      const p = [...s.points];
      p[0] += dx;
      p[1] += dy;
      p[2] += dz;
      s.points = p;
    });
    if (!res.changed) return fail('Không có frame nào được dịch.');
    setStatus(`↔️ Đã dịch ${idsText(range.targetIds)} (${dx}, ${dy}, ${dz}), ${res.changed} lần sửa.` + editSuffix(res), 'success');
  }

  async function rotateTrack(angleDeg) {
    const range = readRange(true);
    if (!range) return;
    const deg = Number.isFinite(angleDeg) ? angleDeg : numVal('cqt-rotate-deg');
    if (!Number.isFinite(deg) || deg === 0) return fail('Nhập góc xoay hợp lệ (khác 0°)!');
    const res = await editRange(`Xoay ${deg}°`, { ...range, keyframesOnly: trackKeyframesOnly() }, (s) => {
      const p = [...s.points];
      p[5] = wrapPi(p[5] + deg * RAD);
      s.points = p;
    });
    if (!res.changed) return fail('Không có frame nào được xoay.');
    setStatus(`🔄 Đã xoay ${fmtSigned(deg, 0)}° ${idsText(range.targetIds)}, ${res.changed} lần sửa.` + editSuffix(res), 'success');
  }

  const MOTION_MIN = 0.05; // m/frame: chậm hơn coi như đứng yên
  const MOTION_WIN = 2; // so vị trí cách ±2 frame cho đỡ nhiễu

  // Hướng đi thật của object ở từng frame trong list.
  // poses (chuyển động xe LiDAR, xem 57-ego.js): đổi vị trí về 1 hệ toạ độ chung trước khi đo,
  // nên xe đỗ không bị coi là "đang lùi" khi xe LiDAR chạy tới. Không có poses => đo thẳng trên toạ độ box.
  // Frame đứng yên lấy hướng của frame đang chạy gần nhất (xe dừng thì không đổi hướng).
  // Trả về mảng { yaw (trong toạ độ của frame đó) | null, moving, filled }.
  function motionYaws(list, poses) {
    const ref = list.map(({ frame, state }) => {
      const pose = poses?.get(frame);
      const [x, y] = pose ? egoApply(pose, state.points[0], state.points[1]) : [state.points[0], state.points[1]];
      return { frame, x, y, th: pose ? pose.th : 0 };
    });
    const heading = ref.map((r, i) => {
      const a = ref[Math.max(0, i - MOTION_WIN)], b = ref[Math.min(ref.length - 1, i + MOTION_WIN)];
      const span = b.frame - a.frame;
      if (span <= 0) return null;
      const dx = b.x - a.x, dy = b.y - a.y;
      return Math.hypot(dx, dy) / span < MOTION_MIN ? null : Math.atan2(dy, dx);
    });
    // Đoạn "đang chạy" ngắn hơn 3 frame thường là nhiễu (sai số đo / box rung) => coi như đứng yên
    for (let i = 0; i < heading.length;) {
      if (heading[i] === null) { i++; continue; }
      let j = i;
      while (j < heading.length && heading[j] !== null) j++;
      if (j - i < 3 && heading.length >= 3) for (let k = i; k < j; k++) heading[k] = null;
      i = j;
    }
    return heading.map((h, i) => {
      let filled = false;
      if (h === null) {
        for (let d = 1; d < ref.length && h === null; d++) {
          const l = heading[i - d], r = heading[i + d];
          h = l ?? r ?? null;
        }
        filled = h !== null;
      }
      return { yaw: h === null ? null : wrapPi(h - ref[i].th), moving: heading[i] !== null, filled };
    });
  }

  // Chuyển động xe LiDAR cho dải frame (đo nếu chưa có) khi bật bù trừ
  async function posesFor(from, to) {
    if (!egoCompEnabled()) return null;
    if (!(await ensureEgo(from, to))) {
      // Chế độ an toàn không cho tự chuyển frame để đo => dừng hẳn, tránh lật ngược đầu xe đỗ
      if (safeData()) {
        throw new Error('Cần đo chuyển động xe LiDAR (tự chuyển frame) nhưng đang bật Chế độ an toàn dữ liệu. ' +
          'Bỏ tick "Trừ chuyển động xe LiDAR" ở tab Track (chỉ nên làm với xe đang chạy) hoặc tắt chế độ an toàn.');
      }
      return null;
    }
    return egoPoses(from, from, to);
  }

  // Xoay đầu theo hướng đi thực tế (dùng cả frame nội suy để tính hướng)
  // local = true: chỉ xét quanh dải (nút 1 frame), khỏi đo xe LiDAR cả track.
  // batch: dùng chung khi sửa nhiều object (không tự finish)
  async function alignYawToMotion(id, from, to, keyframesOnly, local = false, shared = null) {
    let list;
    if (local) {
      list = await collectTrack(id, from - 3, to + 3);
    } else {
      // Cả track để frame đứng yên lấy được hướng từ đoạn đang chạy
      const span = await detectSpan(id);
      if (!span) return { changed: 0, still: 0 };
      list = await collectTrack(id, span.startFrame, span.endFrame);
    }
    const poses = list.length ? await posesFor(list[0].frame, list[list.length - 1].frame) : null;
    const yaws = motionYaws(list, poses);
    const batch = shared || createBatch('Căn hướng theo hướng đi');
    let still = 0, filled = 0, edited = 0;
    for (let i = 0; i < list.length; i++) {
      const { frame } = list[i];
      if (frame < from || frame > to) continue;
      const state = await getState(id, frame);
      if (!isCuboid(state) || state.outside) continue;
      if (keyframesOnly && !isKey(state)) continue;
      const { yaw } = yaws[i];
      if (yaw === null) { still++; continue; }
      if (yaws[i].filled) filled++;
      if (await batch.edit(state, frame, (s) => {
        if (angleDiff(s.points[5], yaw) < 1e-4) return false;
        const p = [...s.points];
        p[5] = yaw;
        s.points = p;
        return true;
      })) edited++;
    }
    const res = shared ? { changed: edited } : await batch.finish();
    return { ...res, changed: edited, still, filled, compensated: !!poses };
  }

  async function alignYawRange() {
    const range = readRange(true);
    if (!range) return;
    const batch = createBatch('Căn hướng theo hướng đi');
    let still = 0, filled = 0, compensated = true;
    const stillIds = [];
    for (const id of range.targetIds) {
      const r = await alignYawToMotion(id, range.startFrame, range.endFrame, trackKeyframesOnly(), false, batch);
      still += r.still;
      filled += r.filled;
      compensated = compensated && r.compensated;
      if (!r.changed && r.still) stillIds.push(id);
    }
    const res = await batch.finish();
    const egoNote = compensated ? ' (đã trừ chuyển động xe LiDAR)'
      : egoCompEnabled() && safeData() ? ' (chưa bù chuyển động xe LiDAR: Chế độ an toàn dữ liệu chặn tự chuyển frame để đo)'
        : ' (chưa bù chuyển động xe LiDAR)';
    const stillNote = stillIds.length ? ` ⚠️ Đứng yên cả track, không có hướng đi (dùng "☁️ Nắn theo Cloud"): ${idsText(stillIds)}.` : '';
    if (!res.changed) return setStatus((stillNote || 'ℹ️ Không có frame nào cần căn.').trim(), stillIds.length ? 'warn' : 'success');
    setStatus(`🧭 Đã căn hướng ${idsText(range.targetIds)} theo hướng đi, ${res.changed} lần sửa${egoNote}` +
      (filled ? `, ${filled} frame đứng yên lấy hướng của đoạn đang chạy` : '') +
      (still ? `, bỏ qua ${still} frame` : '') + '.' + stillNote + editSuffix(res), stillIds.length ? 'warn' : 'success');
  }

  async function alignYawCurrentFrame() {
    const id = requireTarget();
    if (id === null) return;
    const f = getFrame();
    if (!Number.isInteger(f)) return fail('Không đọc được frame hiện tại.');
    const res = await alignYawToMotion(id, f, f, false, true);
    if (!res.changed) {
      return setStatus(res.still
        ? `⚠️ Object đứng yên${res.compensated ? ' (đã trừ chuyển động xe LiDAR)' : ''}, không có hướng đi. Dùng "☁️ Nắn theo Cloud".`
        : 'ℹ️ Đã khớp hướng đi.', 'warn');
    }
    await inspectHeading(id, f);
    setStatus(`🎯 Đã nắn #${id} theo hướng đi tại frame ${f}.` + editSuffix(res), 'success');
  }

  async function inspectHeading(id, frame) {
    if (!Number.isInteger(id) || !Number.isInteger(frame)) return;
    const list = await collectTrack(id, frame - 1, frame + 1);
    const i = list.findIndex((x) => x.frame === frame);
    if (i < 0) return;
    const yaw = list[i].state.points[5];
    const text = (id2, t) => { const el = $(id2); if (el) el.textContent = t; };
    text('cqt-val-yaw', `${(yaw * DEG).toFixed(1)}°`);
    text('cqt-val-yaw-rad', yaw.toFixed(3));

    // Chỉ dùng chuyển động xe LiDAR đã đo sẵn (không tự chuyển frame khi chỉ xem)
    const poses = egoCompEnabled() ? egoPoses(frame, frame - 1, frame + 1) : null;
    const m = motionYaws(list, poses)[i];
    const motion = m.moving ? m.yaw : null;
    const note = egoCompEnabled() && !poses ? ' (chưa đo xe LiDAR)' : '';
    const dev = $('cqt-val-deviation');
    if (motion === null) {
      text('cqt-val-motion', 'Đứng yên' + note);
      if (dev) { dev.textContent = 'Đứng yên: dùng "☁️ Nắn theo Cloud".'; dev.style.color = '#94a3b8'; }
      return;
    }
    text('cqt-val-motion', `${(motion * DEG).toFixed(1)}°${note}`);
    const diff = wrapPi(yaw - motion) * DEG;
    if (!dev) return;
    if (Math.abs(diff) <= 5) { dev.textContent = `✅ Khớp hướng đi (lệch ${diff.toFixed(1)}°)`; dev.style.color = '#4ade80'; }
    else if (Math.abs(diff) >= 135) { dev.textContent = `⚠️ NGƯỢC ĐẦU! Lệch ${Math.abs(diff).toFixed(1)}° so với hướng đi`; dev.style.color = '#f87171'; }
    else { dev.textContent = `⚠️ Lệch ${fmtSigned(diff, 1)}° so với hướng đi`; dev.style.color = '#fbbf24'; }
  }

  // Yaw ở frame hiện tại của từng object => mọi keyframe của chính object đó
  async function syncYawToTrack() {
    const ids = selectedOrTarget();
    if (!ids.length) return requireTarget();
    const frame = getFrame();
    const batch = createBatch('Đồng bộ yaw');
    const missing = [];
    for (const id of ids) {
      const cur = await getState(id, frame);
      if (!isCuboid(cur) || cur.outside) { missing.push(id); continue; }
      const yaw = cur.points[5];
      setStatus(`⏳ Đang dò dải frame của #${id}...`);
      const span = await detectSpan(id);
      if (!span) continue;
      for (let f = span.startFrame; f <= span.endFrame; f++) {
        const s = await getState(id, f);
        if (!isCuboid(s) || s.outside || !isKey(s)) continue;
        await batch.edit(s, f, (st) => {
          if (angleDiff(st.points[5], yaw) < 1e-4) return false;
          const p = [...st.points];
          p[5] = yaw;
          st.points = p;
          return true;
        });
      }
    }
    const res = await batch.finish();
    const note = missing.length ? ` Không có ở frame ${frame}: ${idsText(missing)}.` : '';
    if (!res.changed) return setStatus(`ℹ️ Mọi keyframe đã cùng yaw với frame hiện tại.${note}`, 'success');
    setStatus(`🔗 Đồng bộ yaw theo frame ${frame} cho ${idsText(ids)}: ${res.changed} keyframe.${note}` + editSuffix(res), 'success');
  }

  async function keyframesInRange(id, range) {
    return (await collectTrack(id, range.startFrame, range.endFrame)).filter((x) => isKey(x.state));
  }

  async function smoothTrack() {
    const range = readRange(true);
    if (!range) return;
    const batch = createBatch('Smooth vị trí');
    let total = 0;
    const few = [];
    for (const id of range.targetIds) {
      const kfs = await keyframesInRange(id, range);
      if (kfs.length < 3) { few.push(id); continue; }
      total += kfs.length;
      const orig = kfs.map((k) => [...k.state.points]);
      for (let i = 1; i < kfs.length - 1; i++) {
        await batch.edit(kfs[i].state, kfs[i].frame, (s) => {
          const p = [...orig[i]];
          for (let k = 0; k < 3; k++) p[k] = orig[i - 1][k] * 0.25 + orig[i][k] * 0.5 + orig[i + 1][k] * 0.25;
          if (Math.hypot(p[0] - orig[i][0], p[1] - orig[i][1], p[2] - orig[i][2]) < 1e-6) return false;
          s.points = p;
          return true;
        });
      }
    }
    const res = await batch.finish();
    const note = few.length ? ` Cần ≥ 3 keyframe trong dải, bỏ qua ${idsText(few)}.` : '';
    if (!total) return fail('Cần ít nhất 3 keyframe trong dải để smooth.');
    if (!res.changed) return setStatus('ℹ️ Track đã mượt.' + note, 'success');
    setStatus(`〰️ Đã smooth ${res.changed}/${total} keyframe của ${idsText(range.targetIds)}.${note}` + editSuffix(res), 'success');
  }



  // Nội suy tuyến tính đoạn giữa Start Frame và End Frame (vị trí + LWH + góc theo đường ngắn nhất).
  // Hai đầu mút giữ nguyên; "Chỉ keyframe" bật thì chỉ kéo các keyframe giữa đoạn về đường thẳng.
  async function reinterpolateRange() {
    const range = readRange(true);
    if (!range) return;
    const { startFrame, endFrame } = range;
    if (endFrame - startFrame < 2) return fail('Cần dải ít nhất 3 frame (Start < End - 1) để nội suy đoạn ở giữa.');

    const ends = new Map();
    const missing = [];
    for (const id of range.targetIds) {
      const sA = await getState(id, startFrame);
      const sB = await getState(id, endFrame);
      if (!isCuboid(sA) || sA.outside || !isCuboid(sB) || sB.outside) { missing.push(id); continue; }
      ends.set(id, [[...sA.points], [...sB.points]]);
    }
    if (!ends.size) return fail(`Không có cuboid ở cả frame ${startFrame} và ${endFrame} cho ${idsText(range.targetIds)}.`);

    const span = endFrame - startFrame;
    const keyframesOnly = trackKeyframesOnly();
    const res = await editRange('Nội suy tuyến tính đoạn', {
      targetIds: [...ends.keys()], startFrame: startFrame + 1, endFrame: endFrame - 1, keyframesOnly,
    }, (s, f, id) => {
      const [pA, pB] = ends.get(id);
      const t = (f - startFrame) / span;
      const p = [...s.points];
      for (const k of [0, 1, 2, 6, 7, 8]) p[k] = pA[k] + t * (pB[k] - pA[k]);
      for (const k of [3, 4, 5]) p[k] = wrapPi(pA[k] + t * wrapPi(pB[k] - pA[k]));
      if (!p.some((v, i) => Math.abs(v - s.points[i]) > 1e-5)) return false;
      s.points = p;
      return true;
    });

    const note = missing.length ? ` Bỏ qua ${idsText(missing)} (thiếu box ở 2 đầu dải).` : '';
    if (!res.changed) {
      return setStatus(
        (keyframesOnly
          ? `ℹ️ Không có keyframe nào giữa ${startFrame}–${endFrame} cần nội suy lại.`
          : `ℹ️ Đoạn ${startFrame}–${endFrame} đã khớp đường nội suy tuyến tính.`) + note,
        'success'
      );
    }
    setStatus(`Đã nội suy tuyến tính ${res.changed} frame giữa f${startFrame} và f${endFrame} cho ${idsText([...ends.keys()])}.${note}` + editSuffix(res), 'success');
  }

  // =========================================================================
  // Snap cả sequence (khoá LWH)
  // 1) Chuyển qua từng frame, đọc cloud, snap từng frame (đo).
  // 2) Làm mượt quỹ đạo x, y, z, yaw bằng Kalman smoother (RTS, vận tốc không đổi):
  //    frame nhiều điểm => tin số đo; frame ít điểm / không có => suy đoán từ chuyển động.
  //    Yaw được "mở vòng" (unwrap) nên xe rẽ / quay đầu vẫn liền mạch.
  // 3) Lượt 2: snap lại các frame yếu, lấy vị trí + hướng đã làm mượt làm gợi ý.
  // 4) Chọn keyframe như cách CVAT nội suy: giữ mọi keyframe cũ (sửa giá trị),
  //    chỉ thêm keyframe ở frame mà nội suy tuyến tính lệch quá ngưỡng.
  // =========================================================================
  // σ gia tốc mỗi frame² cho vị trí (m) và yaw (°)
  const SEQ_SMOOTH = {
    tight: { pos: 0.5, yaw: 4 },
    normal: { pos: 0.15, yaw: 1.5 },
    smooth: { pos: 0.05, yaw: 0.5 },
  };
  let seqRun = null; // { abort }

  // Kalman smoother Rauch–Tung–Striebel, 1 chiều, trạng thái [vị trí, vận tốc], F = [[1,1],[0,1]].
  // z[t]: số đo (null = không có), sig[t]: độ lệch chuẩn số đo, q: σ gia tốc / frame².
  function rtsSmooth(z, sig, q) {
    const T = z.length;
    const first = z.findIndex((v) => v !== null);
    if (first < 0) return null;
    const q11 = q * q / 4, q12 = q * q / 2, q22 = q * q;
    let x0 = z[first], x1 = 0, a = 100, b = 0, d = 1; // P = [[a, b], [b, d]]
    const xf = [], Pf = [], xp = [], Pp = [];
    for (let t = 0; t < T; t++) {
      if (t > 0) {
        x0 += x1;
        const na = a + 2 * b + d + q11, nb = b + d + q12, nd = d + q22;
        a = na; b = nb; d = nd;
      }
      xp.push([x0, x1]);
      Pp.push([a, b, d]);
      if (z[t] !== null) {
        const S = a + sig[t] * sig[t];
        const k0 = a / S, k1 = b / S, y = z[t] - x0;
        x0 += k0 * y;
        x1 += k1 * y;
        const na = (1 - k0) * a, nb = (1 - k0) * b, nd = d - k1 * b;
        a = na; b = nb; d = nd;
      }
      xf.push([x0, x1]);
      Pf.push([a, b, d]);
    }
    const xs = new Array(T), ps = new Array(T);
    xs[T - 1] = xf[T - 1];
    ps[T - 1] = Pf[T - 1];
    for (let t = T - 2; t >= 0; t--) {
      const [fa, fb, fd] = Pf[t];
      const [pa, pb, pd] = Pp[t + 1];
      const det = pa * pd - pb * pb;
      const i00 = pd / det, i01 = -pb / det, i11 = pa / det;
      // C = Pf·Fᵀ·Pp⁻¹, với Pf·Fᵀ = [[fa+fb, fb], [fb+fd, fd]]
      const m00 = fa + fb, m01 = fb, m10 = fb + fd, m11 = fd;
      const c00 = m00 * i00 + m01 * i01, c01 = m00 * i01 + m01 * i11;
      const c10 = m10 * i00 + m11 * i01, c11 = m10 * i01 + m11 * i11;
      const d0 = xs[t + 1][0] - xp[t + 1][0], d1 = xs[t + 1][1] - xp[t + 1][1];
      xs[t] = [xf[t][0] + c00 * d0 + c01 * d1, xf[t][1] + c10 * d0 + c11 * d1];
      const [sa, sb, sd] = ps[t + 1];
      const e00 = sa - pa, e01 = sb - pb, e11 = sd - pd;
      const t00 = c00 * e00 + c01 * e01, t01 = c00 * e01 + c01 * e11;
      const t10 = c10 * e00 + c11 * e01, t11 = c10 * e01 + c11 * e11;
      ps[t] = [fa + t00 * c00 + t01 * c01, fb + t00 * c10 + t01 * c11, fd + t10 * c10 + t11 * c11];
    }
    return xs.map((v) => v[0]);
  }

  // Đổi pose giữa toạ độ frame và hệ chung (đã trừ chuyển động xe LiDAR, it.pose = { tx, ty, th })
  function toCommon(it, x, y, yaw) {
    if (!it.pose) return { x, y, yaw };
    const [cx, cy] = egoApply(it.pose, x, y);
    return { x: cx, y: cy, yaw: yaw + it.pose.th };
  }

  function fromCommon(it, s) {
    if (!it.pose) return s;
    const { tx, ty, th } = it.pose;
    const c = Math.cos(-th), sn = Math.sin(-th), dx = s.x - tx, dy = s.y - ty;
    return { x: c * dx - sn * dy, y: sn * dx + c * dy, z: s.z, yaw: s.yaw - th };
  }

  // Làm mượt + bỏ số đo ngoại lai (2 vòng). items[t] = { p, meas, pose }. Trả về pose mượt (hệ chung) từng frame hoặc null.
  function smoothSpan(items, cfg) {
    const T = items.length;
    const ann = items.map((it) => toCommon(it, it.p[0], it.p[1], it.p[5]));
    const mc = items.map((it) => (it.meas ? toCommon(it, it.meas.points[0], it.meas.points[1], it.meas.points[5]) : null));
    // Yaw tham chiếu (của annotation) mở vòng để xe quay đầu không bị nhảy ±180°
    const refU = [ann[0].yaw];
    for (let t = 1; t < T; t++) refU.push(refU[t - 1] + wrapPi(ann[t].yaw - ann[t - 1].yaw));
    const use = items.map((it) => !!it.meas);
    let out = null;
    for (let round = 0; round < 3; round++) {
      const col = (fn) => items.map((it, t) => (use[t] ? fn(it.meas, t) : null));
      const sigPos = items.map((it) => (it.meas ? 0.05 + 0.45 * (1 - it.meas.quality) : 1));
      const sigYaw = items.map((it) => (it.meas ? (1 + 9 * (1 - it.meas.quality)) * RAD : 1));
      const sx = rtsSmooth(col((m, t) => mc[t].x), sigPos, cfg.smooth.pos);
      if (!sx) return null;
      const sy = rtsSmooth(col((m, t) => mc[t].y), sigPos, cfg.smooth.pos);
      const sz = rtsSmooth(col((m) => m.points[2]), sigPos.map((s) => s * 0.5), 0.02);
      const syaw = rtsSmooth(col((m, t) => refU[t] + wrapPi(mc[t].yaw - ann[t].yaw)), sigYaw, cfg.smooth.yaw * RAD);
      out = items.map((it, t) => ({ x: sx[t], y: sy[t], z: sz[t], yaw: syaw[t] }));
      // Số đo lệch xa quỹ đạo mượt => coi là đo sai (dính vật khác, nhầm cụm), bỏ và làm lại
      let dropped = 0;
      items.forEach((it, t) => {
        if (!use[t]) return;
        const m = mc[t];
        const dPos = Math.hypot(m.x - out[t].x, m.y - out[t].y);
        const dYaw = angleDiff(m.yaw, out[t].yaw);
        if (dPos > 3 * sigPos[t] + 0.25 || dYaw > 3 * sigYaw[t] + 8 * RAD) { use[t] = false; it.outlier = true; dropped++; }
      });
      if (!dropped) break;
    }
    return out;
  }

  function seqTargetPoints(it, sCommon) {
    const s = fromCommon(it, sCommon);
    const p = [...it.p];
    p[0] = s.x;
    p[1] = s.y;
    p[2] = s.z;
    p[5] = wrapPi(s.yaw);
    return p;
  }

  // Giá trị CVAT sẽ nội suy tại t từ tập keyframe K (tuyến tính từng thành phần; sau keyframe cuối thì giữ nguyên)
  function interpAt(K, targets, t) {
    let a = -1, b = -1;
    for (const k of K) {
      if (k <= t) a = k;
      else { b = k; break; }
    }
    if (a < 0) a = b;
    if (b < 0 || a === t) return targets[a];
    const w = (t - a) / (b - a), A = targets[a], B = targets[b];
    return A.map((v, i) => v + (B[i] - v) * w);
  }

  // Thêm keyframe tham lam (giống Douglas–Peucker): frame nào nội suy lệch nhất mà vượt ngưỡng thì thành keyframe
  function chooseKeyframes(targets, initialKeys, cfg) {
    const K = [...new Set(initialKeys)].sort((a, b) => a - b);
    for (let guard = 0; guard < targets.length; guard++) {
      let worst = 1, wt = -1;
      for (let t = 0; t < targets.length; t++) {
        if (K.includes(t)) continue;
        const v = interpAt(K, targets, t), g = targets[t];
        const e = Math.max(
          Math.hypot(v[0] - g[0], v[1] - g[1]) / cfg.tolPos,
          Math.abs(v[2] - g[2]) / cfg.tolZ,
          angleDiff(v[5], g[5]) / cfg.tolYaw
        );
        if (e > worst) { worst = e; wt = t; }
      }
      if (wt < 0) break;
      K.push(wt);
      K.sort((a, b) => a - b);
    }
    return K;
  }

  // Tỉ lệ điểm của cụm nằm trong box (nới 0.15 m)
  function coverage(p, pts) {
    if (!pts?.length) return null;
    const c = Math.cos(p[5]), s = Math.sin(p[5]);
    const hl = Math.abs(p[6]) / 2 + 0.15, hw = Math.abs(p[7]) / 2 + 0.15;
    let inside = 0;
    for (const q of pts) {
      const dx = q[0] - p[0], dy = q[1] - p[1];
      if (Math.abs(dx * c + dy * s) <= hl && Math.abs(-dx * s + dy * c) <= hw) inside++;
    }
    return inside / pts.length;
  }

  // Lập kế hoạch cho 1 track: các op (tự sửa + cần xem tay) cho bảng xem trước
  function planSequence(track, cfg) {
    const ops = [];
    const spans = [];
    for (const it of track.frames) {
      const last = spans[spans.length - 1];
      if (last && it.frame === last[last.length - 1].frame + 1) last.push(it);
      else spans.push([it]);
    }
    for (const items of spans) {
      // Chuyển động xe LiDAR (nếu bật và đo được) => làm mượt trong hệ toạ độ chung
      const poses = cfg.ego ? egoPoses(items[0].frame, items[0].frame, items[items.length - 1].frame) : null;
      for (const it of items) it.pose = poses?.get(it.frame) || null;
      // Lượt 1: snap độc lập từng frame
      for (const it of items) {
        it.meas = null;
        if (!it.cands) continue;
        const m = snapMeasure(it.p, it.cands, it.plane, { refYaw: it.p[5] });
        if (!m.error) it.meas = m;
      }
      let smooth = smoothSpan(items, cfg);
      if (!smooth) {
        ops.push({ type: 'seq', trackId: track.id, auto: false, frame: items[0].frame,
          title: `#${track.id} [${track.label}] · f${items[0].frame}–f${items[items.length - 1].frame}: không đo được frame nào`,
          detail: 'Không có cụm điểm quanh box (box lệch xa chủ thể hoặc cloud trống).' });
        continue;
      }
      // Lượt 2: frame yếu / đo sai => snap lại từ pose đã làm mượt, hướng mượt làm gợi ý mạnh
      for (let t = 0; t < items.length; t++) {
        const it = items[t];
        if (!it.cands || (it.meas && it.meas.quality >= 0.35 && !it.outlier)) continue;
        const init = seqTargetPoints(it, smooth[t]);
        const m = snapMeasure(init, it.cands, it.plane, { refYaw: init[5], priors: [{ yaw: init[5], w: 1 }] });
        if (!m.error) { it.meas = m; it.outlier = false; it.second = true; }
      }
      smooth = smoothSpan(items, cfg) || smooth;

      const targets = items.map((it, t) => seqTargetPoints(it, smooth[t]));
      const oldKeys = items.map((it, t) => (it.key ? t : -1)).filter((t) => t >= 0);
      const initial = [0, ...oldKeys];
      if (cfg.range) initial.push(items.length - 1); // giới hạn trong dải: chốt 2 đầu
      const K = chooseKeyframes(targets, initial, cfg);
      const added = K.filter((t) => !items[t].key);
      const changed = K.filter((t) => items[t].key && targets[t].some((v, i) => Math.abs(v - items[t].p[i]) > 1e-4));

      // Kiểm tra: tỉ lệ điểm nằm trong box trước / sau, frame suy đoán, frame còn lệch
      let covB = 0, covA = 0, nCov = 0;
      const bad = [], guessed = [];
      items.forEach((it, t) => {
        const pts = it.meas?.pts;
        if (!it.meas || it.meas.quality < 0.35 || it.outlier) guessed.push(it.frame);
        if (!pts || pts.length < 10 || it.outlier) return;
        const after = coverage(interpAt(K, targets, t), pts);
        covB += coverage(it.p, pts);
        covA += after;
        nCov++;
        if (after < 0.6 && pts.length >= 20) bad.push(it.frame);
      });
      const pct = (v) => `${Math.round((v / Math.max(1, nCov)) * 100)}%`;
      if (!added.length && !changed.length) continue;
      const span = `f${items[0].frame}–f${items[items.length - 1].frame}`;
      ops.push({
        type: 'seq', trackId: track.id, auto: true, checked: true,
        title: `#${track.id} [${track.label}] · ${span}: sửa ${changed.length} keyframe, thêm ${added.length} keyframe`,
        detail: `Điểm nằm trong box: ${pct(covB)} → ${pct(covA)}` +
          (guessed.length ? ` · ${guessed.length} frame ít điểm, suy đoán từ chuyển động: ${framesText(guessed)}` : '') +
          (added.length ? ` · keyframe mới: ${framesText(added.map((t) => items[t].frame))}` : ''),
        params: [
          fixParam('tolPos', 'Keyframe khi lệch > (m)', 'number', cfg.tolPos, { step: 0.01, min: 0.01 }),
          fixParam('tolYaw', 'hoặc > (°)', 'number', +(cfg.tolYaw * DEG).toFixed(2), { step: 0.5, min: 0.1 }),
        ],
        apply: async (batch, P) => {
          // Đổi ngưỡng => chọn lại keyframe từ quỹ đạo đã làm mượt
          const keys = (P.tolPos === cfg.tolPos && Math.abs(P.tolYaw * RAD - cfg.tolYaw) < 1e-9) ? K
            : chooseKeyframes(targets, initial, { ...cfg, tolPos: P.tolPos, tolYaw: P.tolYaw * RAD });
          for (const t of keys) {
            const f = items[t].frame;
            const s = await getState(track.id, f);
            if (!isCuboid(s) || s.outside) continue;
            await batch.edit(s, f, (st) => {
              const np = targets[t];
              if (isKey(st) && np.every((v, i) => Math.abs(v - st.points[i]) < 1e-4)) return false;
              st.points = np;
              if (st.objectType === 'track' && !st.keyframe) st.keyframe = true; // lưu ở frame nội suy => keyframe mới
              return true;
            });
          }
        },
      });
      if (bad.length) {
        ops.push({ type: 'seq', trackId: track.id, auto: false, frame: bad[0],
          title: `#${track.id} [${track.label}] · ${bad.length} frame box vẫn lệch cụm điểm sau khi căn`,
          detail: `Có thể dính vật khác hoặc chủ thể bị che: ${framesText(bad)}` });
      }
    }
    return ops;
  }

  function seqButton(running) {
    const btn = $('cqt-btn-seq-snap');
    if (btn) btn.textContent = running ? '⏹ Dừng đọc sequence' : '🎬 Snap cả sequence (xem trước)';
  }

  async function seqSnap() {
    if (seqRun) {
      seqRun.abort = true;
      return setStatus('⏹ Đang dừng...', 'warn');
    }
    const ids = selection.size ? [...selection] : [resolveTargetId()].filter(Number.isInteger);
    if (!ids.length) return fail('Chọn object trước!');
    if (!allowAutoFrames('Snap cả sequence')) return null;
    const b = jobBounds();
    if (!b) return fail('Chưa kết nối CVAT Job!');
    const scope = val('cqt-seq-scope') || 'track';
    let from = b.start, to = b.stop;
    if (scope === 'range') {
      from = intVal('cqt-frame-start');
      to = intVal('cqt-frame-end');
      if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) return fail('Dải frame không hợp lệ (Start <= End)!');
    }
    const cfg = {
      smooth: SEQ_SMOOTH[val('cqt-seq-smooth')] || SEQ_SMOOTH.normal,
      tolPos: Math.max(0.01, numVal('cqt-seq-tol-pos') || 0.1),
      tolYaw: Math.max(0.1, numVal('cqt-seq-tol-yaw') || 2) * RAD,
      tolZ: 0.05,
      range: scope === 'range',
      ego: egoCompEnabled(),
    };

    seqRun = { abort: false };
    seqButton(true);
    const original = getFrame();
    try {
      const tracks = [];
      const shapes = [];
      for (const id of ids) {
        const list = await collectTrack(id, from, to);
        if (!list.length) continue;
        if (list[0].state.objectType !== 'track') { shapes.push(id); continue; }
        tracks.push({
          id, label: labelName(list[0].state),
          frames: list.map(({ frame, state }) => ({ frame, p: [...state.points], key: isKey(state) })),
        });
      }
      if (!tracks.length) return fail(shapes.length ? 'Shape không có nội suy giữa các frame, chỉ áp cho track.' : 'Không thấy object trong dải.');

      // Đọc cloud từng frame 1 lần cho mọi object; frame đang mở làm trước
      const byFrame = new Map();
      for (const tr of tracks) for (const it of tr.frames) {
        if (!byFrame.has(it.frame)) byFrame.set(it.frame, []);
        byFrame.get(it.frame).push(it);
      }
      const frames = [...byFrame.keys()].sort((x, y) => (x === original ? -1 : y === original ? 1 : x - y));
      let prev = frames[0] === original ? getPointCloudPositions() : null;
      let noCloud = 0;
      for (let i = 0; i < frames.length; i++) {
        if (seqRun.abort) break;
        const f = frames[i];
        setStatus(`⏳ Snap sequence: đọc cloud frame ${f} (${i + 1}/${frames.length})... bấm ⏹ để dừng`);
        const pos = await cloudAtFrame(f, prev);
        if (!pos) { noCloud++; continue; }
        prev = pos;
        if (cfg.ego) await egoObserve(f, pos); // đo luôn chuyển động xe LiDAR, khỏi đọc lại cloud
        for (const it of byFrame.get(f)) {
          it.plane = snapGround(it.p, pos);
          it.cands = snapCandidates(it.p, pos, it.plane, 3);
        }
      }
      egoReleaseCells();
      if (Number.isInteger(original) && getFrame() !== original) await goToFrame(original);
      if (seqRun.abort) return setStatus('⏹ Đã dừng, chưa sửa gì.', 'warn');

      setStatus('⏳ Snap sequence: đang làm mượt quỹ đạo...');
      await sleep(0);
      const ops = tracks.flatMap((tr) => planSequence(tr, cfg));
      for (const tr of tracks) for (const it of tr.frames) { it.cands = null; } // giải phóng bộ nhớ
      if (!ops.length) return setStatus('✅ Box đã khớp cụm điểm trên cả sequence, không cần sửa.', 'success');
      if (noCloud || shapes.length) {
        ops.push({ type: 'seq', trackId: tracks[0].id, auto: false, frame: original,
          title: 'Lưu ý',
          detail: [noCloud ? `${noCloud} frame không đọc được cloud (đã suy đoán từ frame bên cạnh).` : '',
            shapes.length ? `Bỏ qua shape (không phải track): #${shapes.join(', #')}.` : ''].filter(Boolean).join(' ') });
      }
      openFixPreview(`Snap cả sequence (${tracks.length} object)`, ops);
      setStatus(`🎬 Đã căn ${tracks.length} object trên ${frames.length} frame. Xem trước rồi bấm Áp dụng.`, 'success');
    } finally {
      seqRun = null;
      seqButton(false);
    }
  }

  // =========================================================================
  // Chuyển động xe LiDAR (ego-motion)
  // Nếu cloud lưu theo toạ độ cảm biến, xe đỗ trông như đang chạy ngược chiều xe LiDAR.
  // Ước lượng: lấy "nền tĩnh" nhìn từ trên xuống (ô có vật thẳng đứng: tường, cột, cây; bỏ box đã gán nhãn),
  // khớp 2 frame liên tiếp bằng ICP 2D (Besl & McKay 1992; point-to-line: Chen & Medioni 1992) => xe LiDAR dịch/quay bao nhiêu mỗi frame.
  // Dữ liệu theo toạ độ thế giới thì kết quả ≈ 0 => bù trừ không đổi gì.
  // =========================================================================
  const EGO_CELL = 0.4; // m, ô BEV
  const ego = {
    jobId: null,
    rel: new Map(), // frame f -> { tx, ty, th, inl, ok }: đưa toạ độ frame f về frame f-1 (p' = R·p + t)
    cells: new Map(), // frame -> Float32Array ô nền tĩnh (chỉ giữ tạm khi đang đọc)
  };

  function egoCheckJob() {
    const id = getJob()?.id ?? null;
    if (ego.jobId !== id) {
      ego.jobId = id;
      ego.rel.clear();
      ego.cells.clear();
    }
  }

  // Ô BEV có vật thẳng đứng (chênh cao ≥ 0.5 m) => không phải mặt đất; bỏ ô nằm trong box đã gán nhãn
  function staticCells(positions, boxes) {
    const grid = new Map();
    const OFF = 1e5;
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const k = (Math.floor(x / EGO_CELL) + OFF) * 2 * OFF + (Math.floor(y / EGO_CELL) + OFF);
      const g = grid.get(k);
      if (!g) grid.set(k, [z, z, x, y, 1]);
      else { if (z < g[0]) g[0] = z; if (z > g[1]) g[1] = z; g[2] += x; g[3] += y; g[4]++; }
    }
    const rects = boxes.map((p) => [p[0], p[1], Math.cos(p[5]), Math.sin(p[5]), Math.abs(p[6]) / 2 + 0.6, Math.abs(p[7]) / 2 + 0.6]);
    const out = [];
    for (const [mn, mx, sx, sy, n] of grid.values()) {
      if (mx - mn < 0.5) continue;
      // Trọng tâm điểm trong ô (không dùng tâm ô: lưới cố định làm ICP khớp lệch theo bội số cỡ ô)
      const x = sx / n, y = sy / n;
      let inBox = false;
      for (const [bx, by, c, s, hl, hw] of rects) {
        const dx = x - bx, dy = y - by;
        if (Math.abs(dx * c + dy * s) <= hl && Math.abs(-dx * s + dy * c) <= hw) { inBox = true; break; }
      }
      if (!inBox) out.push(x, y);
    }
    // Tối đa ~3000 ô cho nhanh
    const n = out.length / 2, step = Math.max(1, Math.ceil(n / 3000));
    const res = new Float32Array(Math.ceil(n / step) * 2);
    for (let i = 0, j = 0; i < n; i += step, j++) { res[2 * j] = out[2 * i]; res[2 * j + 1] = out[2 * i + 1]; }
    return res;
  }

  // ICP 2D có cắt tỉa (bỏ 20% cặp xa nhất), src → dst, init = { tx, ty, th }.
  // Điểm–đường thẳng (point-to-line, Chen & Medioni 1992) khi ô đích nằm trên tường / hàng rào (có pháp tuyến rõ),
  // điểm–điểm khi là cột / vật nhỏ. Giải Gauss–Newton 3 ẩn (θ, tx, ty) mỗi vòng.
  function icp2d(src, dst, init, iters = 25) {
    const G = 1.0;
    const grid = new Map();
    for (let j = 0; j < dst.length; j += 2) {
      const k = `${Math.floor(dst[j] / G)},${Math.floor(dst[j + 1] / G)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(j);
    }
    // Pháp tuyến của ô đích từ các ô trong bán kính 1 m (PCA 2D); cụm không thẳng => null
    const normals = new Map();
    for (let j = 0; j < dst.length; j += 2) {
      const gx = Math.floor(dst[j] / G), gy = Math.floor(dst[j + 1] / G);
      let n = 0, mx = 0, my = 0;
      const nb = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const k of grid.get(`${gx + a},${gy + b}`) || []) {
          if (Math.hypot(dst[k] - dst[j], dst[k + 1] - dst[j + 1]) > 1.0) continue;
          nb.push(k); mx += dst[k]; my += dst[k + 1]; n++;
        }
      }
      if (n < 4) continue;
      mx /= n; my /= n;
      let sxx = 0, syy = 0, sxy = 0;
      for (const k of nb) { const dx = dst[k] - mx, dy = dst[k + 1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const tr = sxx + syy, det = sxx * syy - sxy * sxy;
      const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr - l1;
      if (l1 <= 0 || l2 / l1 > 0.05) continue;
      const dir = 0.5 * Math.atan2(2 * sxy, sxx - syy); // hướng đường thẳng
      normals.set(j, [-Math.sin(dir), Math.cos(dir)]);
    }
    let { tx, ty, th } = init;
    let maxD = 2.0, inl = 0, rms = Infinity;
    const n = src.length / 2;
    for (let it = 0; it < iters; it++) {
      const c = Math.cos(th), s = Math.sin(th);
      const pairs = [];
      const reach = Math.ceil(maxD / G);
      for (let i = 0; i < src.length; i += 2) {
        const x = c * src[i] - s * src[i + 1] + tx, y = s * src[i] + c * src[i + 1] + ty;
        const gx = Math.floor(x / G), gy = Math.floor(y / G);
        let best = maxD * maxD, bj = -1;
        for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
          const cell = grid.get(`${gx + a},${gy + b}`);
          if (!cell) continue;
          for (const j of cell) {
            const dx = dst[j] - x, dy = dst[j + 1] - y, d = dx * dx + dy * dy;
            if (d < best) { best = d; bj = j; }
          }
        }
        if (bj >= 0) pairs.push([i, bj, best]);
      }
      if (pairs.length < 20) return { tx, ty, th, inl: pairs.length / Math.max(1, n), rms: Infinity, n: pairs.length };
      pairs.sort((u, v) => u[2] - v[2]);
      const kept = pairs.slice(0, Math.max(20, Math.floor(pairs.length * 0.8)));
      // Gauss–Newton: H·δ = −g, δ = (dθ, dtx, dty)
      const H = [0, 0, 0, 0, 0, 0, 0, 0, 0], g = [0, 0, 0];
      const add = (J, r) => {
        for (let a = 0; a < 3; a++) { g[a] += J[a] * r; for (let b = 0; b < 3; b++) H[a * 3 + b] += J[a] * J[b]; }
      };
      for (const [i, j] of kept) {
        const px = src[i], py = src[i + 1];
        const x = c * px - s * py + tx, y = s * px + c * py + ty;
        const dRx = -s * px - c * py, dRy = c * px - s * py; // ∂(R·p)/∂θ
        const nm = normals.get(j);
        if (nm) {
          add([nm[0] * dRx + nm[1] * dRy, nm[0], nm[1]], nm[0] * (x - dst[j]) + nm[1] * (y - dst[j + 1]));
        } else {
          add([dRx, 1, 0], x - dst[j]);
          add([dRy, 0, 1], y - dst[j + 1]);
        }
      }
      const damp = 1e-6 * (H[0] + H[4] + H[8]);
      H[0] += damp; H[4] += damp; H[8] += damp;
      const d = solve3(H, g.map((v) => -v));
      if (!d) break;
      th += d[0]; tx += d[1]; ty += d[2];
      inl = pairs.filter((p) => p[2] <= 0.25 * 0.25).length / n; // tỉ lệ ô khớp trong 0.25 m
      rms = Math.sqrt(kept.reduce((m, p) => m + p[2], 0) / kept.length);
      const moved = Math.hypot(d[1], d[2]) + Math.abs(d[0]) * 10;
      if (moved < 1e-4 && maxD <= 0.5) break;
      maxD = Math.max(0.5, maxD * 0.7);
    }
    return { tx, ty, th, inl, rms, n };
  }

  // Giải hệ 3×3 (khử Gauss có chọn trụ)
  function solve3(A, b) {
    const M = [[A[0], A[1], A[2], b[0]], [A[3], A[4], A[5], b[1]], [A[6], A[7], A[8], b[2]]];
    for (let col = 0; col < 3; col++) {
      let piv = col;
      for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      [M[col], M[piv]] = [M[piv], M[col]];
      for (let r = 0; r < 3; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        for (let k = col; k < 4; k++) M[r][k] -= f * M[col][k];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  // Khớp frame f (src) về frame f-1 (dst). Không có dự đoán tin được (cặp đầu) hoặc khớp kém
  // => thử nhiều điểm xuất phát dọc 2 trục, lấy cái khớp tốt nhất rồi tinh chỉnh.
  function egoMatch(src, dst, guess) {
    if (src.length < 40 || dst.length < 40) return null;
    let best = guess ? icp2d(src, dst, guess) : null;
    if (!best || best.inl < 0.6) {
      for (let k = -8; k <= 8; k++) {
        for (const dir of [0, Math.PI / 2]) {
          if (dir && !k) continue;
          const r = icp2d(src, dst, { tx: k * Math.cos(dir), ty: k * Math.sin(dir), th: 0 }, 6);
          if (!best || r.inl > best.inl + 1e-9) best = r;
        }
      }
      best = icp2d(src, dst, best);
    }
    return { ...best, ok: best.inl >= 0.3 && best.n >= 50 };
  }

  // Nhận cloud của frame f (khi tool đang đi qua từng frame) => tính chuyển động với frame kề nếu có
  async function egoObserve(f, positions) {
    egoCheckJob();
    if (ego.rel.has(f) && ego.rel.has(f + 1)) return;
    const boxes = (await getStates(f)).filter((s) => isCuboid(s) && !s.outside).map((s) => s.points);
    ego.cells.set(f, staticCells(positions, boxes));
    const pair = (g) => {
      if (ego.rel.has(g) || !ego.cells.has(g) || !ego.cells.has(g - 1)) return;
      const prev = ego.rel.get(g - 1);
      const m = egoMatch(ego.cells.get(g), ego.cells.get(g - 1), prev?.ok ? prev : null);
      ego.rel.set(g, m || { tx: 0, ty: 0, th: 0, inl: 0, ok: false });
    };
    pair(f);
    pair(f + 1);
  }

  function egoReleaseCells() {
    ego.cells.clear();
  }

  // Đi qua các frame còn thiếu để đo chuyển động trong [from, to]. Trả về true nếu đủ.
  async function ensureEgo(from, to, label = 'Đo chuyển động xe LiDAR') {
    egoCheckJob();
    const b = jobBounds();
    if (b) { from = Math.max(from, b.start); to = Math.min(to, b.stop); }
    const missing = [];
    for (let f = from + 1; f <= to; f++) if (!ego.rel.has(f)) missing.push(f);
    if (!missing.length) return true;
    if (safeData()) return false; // đo cần tự chuyển frame => chỉ dùng phần đã đo sẵn
    const original = getFrame();
    let prev = null;
    const start = missing[0] - 1, end = missing[missing.length - 1];
    try {
      for (let f = start; f <= end; f++) {
        if (seqRun?.abort) return false;
        setStatus(`⏳ ${label}: frame ${f} (${f - start + 1}/${end - start + 1})...`);
        const pos = await cloudAtFrame(f, prev);
        if (!pos) continue;
        prev = pos;
        await egoObserve(f, pos);
      }
    } finally {
      egoReleaseCells();
      if (Number.isInteger(original) && getFrame() !== original) await goToFrame(original);
    }
    return true;
  }

  // Pose của frame f trong hệ toạ độ frame gốc `ref`: p_ref = R(th)·p_f + t. Khớp hỏng => coi như vận tốc không đổi.
  function egoPoses(ref, from, to) {
    egoCheckJob();
    const poses = new Map([[ref, { tx: 0, ty: 0, th: 0 }]]);
    const relAt = (f) => {
      const r = ego.rel.get(f);
      if (r?.ok) return r;
      for (let d = 1; d < 5; d++) { // khớp hỏng: lấy chuyển động frame gần nhất
        const a = ego.rel.get(f - d), b2 = ego.rel.get(f + d);
        if (a?.ok) return a;
        if (b2?.ok) return b2;
      }
      return r || null;
    };
    const compose = (A, B) => ({ // A∘B
      th: A.th + B.th,
      tx: Math.cos(A.th) * B.tx - Math.sin(A.th) * B.ty + A.tx,
      ty: Math.sin(A.th) * B.tx + Math.cos(A.th) * B.ty + A.ty,
    });
    const inverse = (A) => {
      const c = Math.cos(-A.th), s = Math.sin(-A.th);
      return { th: -A.th, tx: -(c * A.tx - s * A.ty), ty: -(s * A.tx + c * A.ty) };
    };
    for (let f = ref + 1; f <= to; f++) {
      const r = relAt(f);
      if (!r) return null;
      poses.set(f, compose(poses.get(f - 1), r));
    }
    for (let f = ref - 1; f >= from; f--) {
      const r = relAt(f + 1);
      if (!r) return null;
      poses.set(f, compose(poses.get(f + 1), inverse(r)));
    }
    return poses;
  }

  function egoApply(pose, x, y) {
    const c = Math.cos(pose.th), s = Math.sin(pose.th);
    return [c * x - s * y + pose.tx, s * x + c * y + pose.ty];
  }

  // Tóm tắt: xe LiDAR đi bao xa, quay bao nhiêu; ≈ 0 => cloud theo toạ độ thế giới (hoặc xe đứng yên)
  function egoSummary(from, to) {
    let dist = 0, rot = 0, bad = 0, n = 0;
    for (let f = from + 1; f <= to; f++) {
      const r = ego.rel.get(f);
      if (!r) continue;
      n++;
      if (!r.ok) { bad++; continue; }
      dist += Math.hypot(r.tx, r.ty);
      rot += Math.abs(r.th);
    }
    return { dist, rotDeg: rot * DEG, bad, n, sensorFrame: n > 0 && dist / n > 0.03 };
  }

  function egoCompEnabled() {
    return isChecked('cqt-ego-comp');
  }

  async function measureEgoMotion() {
    if (!allowAutoFrames('Đo chuyển động xe LiDAR')) return null;
    const b = jobBounds();
    if (!b) return fail('Chưa kết nối CVAT Job!');
    const ok = await ensureEgo(b.start, b.stop);
    if (!ok) return setStatus('⏹ Đã dừng.', 'warn');
    showEgoSummary(b.start, b.stop);
  }

  function showEgoSummary(from, to) {
    const s = egoSummary(from, to);
    const text = !s.n ? 'Chưa đo.'
      : s.sensorFrame
        ? `📡 Cloud theo toạ độ cảm biến: xe LiDAR đi ${s.dist.toFixed(1)} m, quay ${s.rotDeg.toFixed(1)}° qua ${s.n} cặp frame` +
          (s.bad ? ` (${s.bad} cặp khớp kém, đã suy từ frame bên cạnh)` : '') + '. Hướng đi đã được trừ chuyển động này.'
        : `📡 Nền tĩnh gần như đứng yên (${s.dist.toFixed(2)} m qua ${s.n} cặp frame): cloud theo toạ độ thế giới, không cần bù.`;
    const el = $('cqt-ego-info');
    if (el) el.textContent = text;
    setStatus(text, s.bad > s.n / 3 ? 'warn' : 'success');
  }

  // =========================================================================
  // QA theo file kiểm tra (cvat1.xlsx):
  // Frame | Item ID | Track ID | Class | Loại kiểm tra | Mô tả | Giá trị | Ngưỡng / Chuẩn | Track liên quan
  // =========================================================================
  const QA_TYPES = {
    missingTrack: 'Thiếu track_id',
    duplicateTrack: 'Trùng track_id',
    unknownClass: 'Class không nhận dạng',
    scale: 'Scale không đồng bộ',
    yaw: 'Đổi hướng đột ngột',
    overlap: 'Chồng lấn',
    dist: 'Quá xa',
    limits: 'Ngoài limits',
    ground: 'Chưa chạm đất',
  };

  let lastQA = null; // { rows, data, opts, range }

  // Badge "x/9 bật" trên đầu bảng tiêu chí QA (thu gọn được)
  function updateQAActiveCount(o = getQAOptions()) {
    const keys = ['missingTrack', 'duplicateTrack', 'unknownClass', 'scale', 'yaw', 'overlap', 'dist', 'limits', 'ground'];
    const badge = $('cqt-qa-active-count');
    if (badge) badge.textContent = `${keys.filter((k) => !!o[k]).length}/${keys.length} bật`;
  }

  function readQAOptionsFromUI() {
    const o = getQAOptions();
    const read = (id, key, num) => {
      const el = $(id);
      if (!el) return;
      if (num) {
        const n = parseFloat(el.value);
        if (Number.isFinite(n)) o[key] = n;
      } else {
        o[key] = el.checked;
      }
    };
    read('cqt-qa-check-missing-track', 'missingTrack');
    read('cqt-qa-check-duplicate-track', 'duplicateTrack');
    read('cqt-qa-check-unknown-class', 'unknownClass');
    read('cqt-qa-check-scale', 'scale');
    read('cqt-qa-scale-tol', 'scaleTol', true);
    read('cqt-qa-check-yaw', 'yaw');
    read('cqt-qa-yaw-threshold', 'yawThresh', true);
    read('cqt-qa-check-overlap', 'overlap');
    read('cqt-qa-pedped-iou', 'pedPedIoU', true);
    read('cqt-qa-check-dist', 'dist');
    read('cqt-qa-dist-threshold', 'distThresh', true);
    read('cqt-qa-check-limits', 'limits');
    read('cqt-qa-check-ground', 'ground');
    read('cqt-qa-ground-tol', 'groundTol', true);
    read('cqt-qa-ground-all', 'groundAll');
    read('cqt-qa-whole-job', 'wholeJob');
    lsSet(LS.qa, o);
    updateQAActiveCount(o);
    return o;
  }

  function writeQAOptionsToUI() {
    const o = getQAOptions();
    const set = (id, v) => {
      const el = $(id);
      if (!el) return;
      if (typeof v === 'boolean') el.checked = v;
      else el.value = v;
    };
    set('cqt-qa-check-missing-track', o.missingTrack);
    set('cqt-qa-check-duplicate-track', o.duplicateTrack);
    set('cqt-qa-check-unknown-class', o.unknownClass);
    set('cqt-qa-check-scale', o.scale);
    set('cqt-qa-scale-tol', o.scaleTol);
    set('cqt-qa-check-yaw', o.yaw);
    set('cqt-qa-yaw-threshold', o.yawThresh);
    set('cqt-qa-check-overlap', o.overlap);
    set('cqt-qa-pedped-iou', o.pedPedIoU);
    set('cqt-qa-check-dist', o.dist);
    set('cqt-qa-dist-threshold', o.distThresh);
    set('cqt-qa-check-limits', o.limits);
    set('cqt-qa-check-ground', o.ground);
    set('cqt-qa-ground-tol', o.groundTol);
    set('cqt-qa-ground-all', o.groundAll);
    set('cqt-qa-whole-job', o.wholeJob);
    updateQAActiveCount(o);
  }

  function qaRange(opts) {
    const b = jobBounds();
    if (!b) return fail('Chưa kết nối CVAT Job!');
    if (opts.wholeJob) return { from: b.start, to: b.stop };
    const from = intVal('cqt-frame-start'), to = intVal('cqt-frame-end');
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) return fail('Dải frame không hợp lệ (Start <= End)!');
    return { from, to };
  }

  // Đọc toàn bộ cuboid trong dải: tracks (theo clientID) + danh sách theo frame
  async function scanJobData(from, to, onlyId = null) {
    const tracks = new Map();
    const frames = new Map();
    for (let f = from; f <= to; f++) {
      if (f > from && (f - from) % 20 === 0) {
        setStatus(`⏳ QA: đọc frame ${f}/${to}...`);
        await sleep(0);
      }
      const list = [];
      for (const s of await getStates(f)) {
        if (!isCuboid(s) || s.outside) continue;
        if (onlyId !== null && !(onlyId instanceof Set ? onlyId.has(s.clientID) : s.clientID === onlyId)) continue;
        const tid = trackIdOf(s);
        let rec = tracks.get(s.clientID);
        if (!rec) {
          rec = { id: s.clientID, label: labelName(s), objectType: s.objectType, hasTrackAttr: !!tid.spec, frames: [] };
          tracks.set(s.clientID, rec);
        }
        const item = { frame: f, points: [...s.points], keyframe: isKey(s), tidKey: tid.key, tid: tid.value };
        rec.frames.push(item);
        list.push({ id: s.clientID, label: rec.label, points: item.points, tidKey: tid.key, tid: tid.value });
      }
      frames.set(f, list);
    }
    return { from, to, tracks, frames };
  }

  function trackMedianLWH(rec) {
    return {
      l: median(rec.frames.map((x) => x.points[6])),
      w: median(rec.frames.map((x) => x.points[7])),
      h: median(rec.frames.map((x) => x.points[8])),
    };
  }

  function overlapRule(cls1, cls2, opts) {
    if (normalizeClass(cls1) === 'pedestrian' && normalizeClass(cls2) === 'pedestrian') {
      return { maxIoU: opts.pedPedIoU, text: `Cho phép tối đa ${Math.round(opts.pedPedIoU * 100)}% (IOU)` };
    }
    return { maxIoU: 0, text: 'Không cho phép chồng lấn' };
  }

  function runQAChecks(data, opts) {
    const rows = [];
    const row = (frame, rec, type, desc, value, threshold, related = '') =>
      rows.push({ frame, itemId: '', trackId: rec.id, cls: rec.label, type, desc, value, threshold, related });

    for (const rec of data.tracks.values()) {
      // Thiếu track_id: shape không có thuộc tính track_id, hoặc thuộc tính track_id để trống
      if (opts.missingTrack) {
        for (const x of rec.frames) {
          if (x.tidKey != null) continue;
          row(x.frame, rec, QA_TYPES.missingTrack,
            rec.hasTrackAttr
              ? `Thuộc tính track_id đang trống (${rec.objectType === 'track' ? 'track' : 'shape'})`
              : 'Cuboid là shape, không thuộc track nào và label không có thuộc tính track_id',
            'Thiếu track_id', 'Phải có track_id hợp lệ');
        }
      }

      // Nhãn không thuộc nhóm nào trong class_groups
      if (opts.unknownClass && !findClassGroup(rec.label)) {
        const groups = Object.keys(getClassGroups()).join(', ');
        for (const x of rec.frames) {
          row(x.frame, rec, QA_TYPES.unknownClass,
            `Tên nhãn '${rec.label}' không nằm trong danh mục các nhóm của class_groups`, rec.label, groups);
        }
      }

      // Scale không đồng bộ: so với size chuẩn (median) của track
      if (opts.scale && rec.frames.length > 1) {
        const m = trackMedianLWH(rec);
        for (const x of rec.frames) {
          const d = [x.points[6] - m.l, x.points[7] - m.w, x.points[8] - m.h];
          if (Math.max(...d.map(Math.abs)) <= opts.scaleTol) continue;
          row(x.frame, rec, QA_TYPES.scale,
            `Scale lệch so với kích thước chuẩn của track (chênh L ${fmtSigned(d[0])}, W ${fmtSigned(d[1])}, H ${fmtSigned(d[2])} m)`,
            fmtLWH(x.points[6], x.points[7], x.points[8]), fmtLWH(m.l, m.w, m.h));
        }
      }

      // Đổi hướng đột ngột giữa 2 frame liên tiếp
      if (opts.yaw) {
        for (let i = 1; i < rec.frames.length; i++) {
          const a = rec.frames[i - 1], b = rec.frames[i];
          if (b.frame !== a.frame + 1) continue;
          const d = angleDiff(b.points[5], a.points[5]) * DEG;
          if (d <= opts.yawThresh) continue;
          row(b.frame, rec, QA_TYPES.yaw,
            `Obj thay đổi hướng đột ngột ${d.toFixed(1)}° (yaw ${(wrapPi(a.points[5]) * DEG).toFixed(1)}° ở frame ${a.frame} -> ${(wrapPi(b.points[5]) * DEG).toFixed(1)}° ở frame ${b.frame})`,
            d.toFixed(2), `≤ ${opts.yawThresh}°`);
        }
      }

      // Quá xa gốc toạ độ
      if (opts.dist) {
        for (const x of rec.frames) {
          const d = Math.hypot(x.points[0], x.points[1], x.points[2]);
          if (d <= opts.distThresh) continue;
          row(x.frame, rec, QA_TYPES.dist,
            `Cách gốc tọa độ ${d.toFixed(2)} m (> ${opts.distThresh} m): obj ở quá xa, cần kiểm tra`,
            d.toFixed(2), `≤ ${opts.distThresh} m`);
        }
      }

      // Ngoài ngưỡng LWH tiêu chuẩn của class
      const lim = opts.limits ? getLimitsForLabel(rec.label) : null;
      if (lim) {
        for (const x of rec.frames) {
          const v = limitViolations(x.points[6], x.points[7], x.points[8], lim);
          if (!v.length) continue;
          row(x.frame, rec, QA_TYPES.limits, `Kích thước ngoài chuẩn class ${rec.label} (${v.join('; ')})`,
            fmtLWH(x.points[6], x.points[7], x.points[8]), limitText(lim));
        }
      }
    }

    // Chồng lấn BEV trong cùng frame
    if (opts.overlap) {
      for (const [f, list] of data.frames) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const A = list[i], B = list[j];
            const ov = bevOverlap(A.points, B.points);
            if (!ov) continue;
            const rule = overlapRule(A.label, B.label, opts);
            if (rule.maxIoU > 0 ? ov.iou <= rule.maxIoU : ov.inter <= 1e-4) continue;
            for (const [self, other, ioa] of [[A, B, ov.ioa1], [B, A, ov.ioa2]]) {
              row(f, { id: self.id, label: self.label }, QA_TYPES.overlap,
                `Chồng lấn với track ${other.id} (${other.label}): IoU ${ov.iou.toFixed(3)}, IoA ${ioa.toFixed(3)}, diện tích giao ${ov.inter.toFixed(3)} m²`,
                ov.iou.toFixed(4), rule.text, other.id);
            }
          }
        }
      }
    }

    // Trùng track_id: 2 cuboid trở lên cùng track_id trong 1 frame
    if (opts.duplicateTrack) {
      for (const [f, list] of data.frames) {
        const byKey = new Map();
        for (const it of list) {
          if (it.tidKey == null) continue;
          if (!byKey.has(it.tidKey)) byKey.set(it.tidKey, []);
          byKey.get(it.tidKey).push(it);
        }
        for (const boxes of byKey.values()) {
          if (boxes.length < 2) continue;
          for (const self of boxes) {
            const other = boxes.find((b) => b !== self);
            row(f, { id: self.id, label: self.label }, QA_TYPES.duplicateTrack,
              `Cùng track_id ${self.tid} xuất hiện ${boxes.length} cuboid trong frame ${f} (trùng với #${other.id})`,
              `${boxes.length} cuboid`, '1 cuboid / frame', other.id);
          }
        }
      }
    }

    const order = Object.values(QA_TYPES);
    rows.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.trackId - b.trackId || a.frame - b.frame);
    return rows;
  }

  async function fillItemIds(rows) {
    const names = new Map();
    for (const f of new Set(rows.map((r) => r.frame))) names.set(f, await frameName(f));
    for (const r of rows) r.itemId = names.get(r.frame) || '';
  }

  // Point cloud chỉ có cho frame đang hiển thị => chuyển frame rồi chờ CVAT nạp cloud mới
  async function cloudAtFrame(f, prev) {
    if (getFrame() === f && prev) return prev;
    // Chốt chặn cuối: chế độ an toàn chỉ dùng cloud của frame đang xem, không tự chuyển frame
    if (safeData()) return getFrame() === f ? getPointCloudPositions() : null;
    if (!(await goToFrame(f))) return null;
    for (let t = 0; t < 50; t++) {
      const pos = getPointCloudPositions();
      if (pos && pos !== prev) return pos;
      await sleep(100);
    }
    return null;
  }

  // Chưa chạm đất: so góc thấp nhất của box với mặt đất cục bộ đo từ cloud (estimateGroundPlane).
  // Mỗi dòng lưu kèm plane để auto-fix hạ/nâng đúng frame đó.
  async function scanGroundRows(data, opts) {
    const byFrame = new Map(); // frame -> [{ rec, x }]
    for (const rec of data.tracks.values()) {
      for (const x of rec.frames) {
        if (!opts.groundAll && !x.keyframe) continue;
        if (!byFrame.has(x.frame)) byFrame.set(x.frame, []);
        byFrame.get(x.frame).push({ rec, x });
      }
    }
    const original = getFrame();
    // Frame đang mở trước (khỏi chờ nạp), còn lại theo thứ tự
    const frames = [...byFrame.keys()].sort((a, b) => (a === original ? -1 : b === original ? 1 : a - b));
    const rows = [];
    let prev = frames[0] === original ? getPointCloudPositions() : null;
    let noCloud = 0, noGround = 0, checked = 0;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      setStatus(`⏳ QA mặt đất: frame ${f} (${i + 1}/${frames.length})...`);
      const pos = await cloudAtFrame(f, prev);
      if (!pos) { noCloud++; continue; }
      prev = pos;
      for (const { rec, x } of byFrame.get(f)) {
        const plane = estimateGroundPlane(x.points, pos);
        if (!plane) { noGround++; continue; }
        checked++;
        const gap = groundGap(x.points, plane);
        if (Math.abs(gap) <= opts.groundTol) continue;
        rows.push({
          frame: f, itemId: '', trackId: rec.id, cls: rec.label, type: QA_TYPES.ground,
          desc: gap > 0 ? `Lơ lửng ${gap.toFixed(3)} m trên mặt đất` : `Lún ${(-gap).toFixed(3)} m xuống mặt đất`,
          value: gap.toFixed(3), threshold: `|lệch| ≤ ${opts.groundTol} m`, related: '',
          plane, keyframe: x.keyframe,
        });
      }
    }
    if (Number.isInteger(original) && getFrame() !== original) await goToFrame(original);
    return { rows, stats: { checked, noCloud, noGround, frames: frames.length } };
  }

  async function scanQA() {
    const opts = readQAOptionsFromUI();
    const range = qaRange(opts);
    if (!range) return null;
    setStatus('⏳ Đang quét QA...');
    const data = await scanJobData(range.from, range.to);
    if (!data.tracks.size) return fail('Không có cuboid nào trong dải.');
    const rows = runQAChecks(data, opts);
    let groundNote = '';
    if (opts.ground && safeData()) {
      groundNote = ' Bỏ qua mục "Chưa chạm đất" (cần đọc cloud từng frame) vì đang bật Chế độ an toàn dữ liệu.';
    } else if (opts.ground) {
      const g = await scanGroundRows(data, opts);
      rows.push(...g.rows);
      groundNote = ` Mặt đất: đo ${g.stats.checked} box / ${g.stats.frames} frame` +
        (g.stats.noCloud ? `, ${g.stats.noCloud} frame không đọc được cloud` : '') +
        (g.stats.noGround ? `, ${g.stats.noGround} box thiếu điểm đất` : '') + '.';
    }
    await fillItemIds(rows);
    lastQA = { rows, data, opts, range };
    renderQAResult();
    const tracks = new Set(rows.map((r) => r.trackId)).size;
    setStatus(
      `🔎 QA ${range.from}–${range.to}: ${data.tracks.size} object, ${rows.length} lỗi ở ${tracks} object.` + groundNote,
      rows.length ? 'warn' : 'success'
    );
    return lastQA;
  }

  function renderQAResult() {
    const box = $('cqt-qa-result');
    const filter = $('cqt-qa-filter');
    if (!box || !lastQA) return;
    const { rows } = lastQA;

    const counts = {};
    for (const r of rows) counts[r.type] = (counts[r.type] || 0) + 1;
    const current = filter?.value || '';
    if (filter) {
      filter.innerHTML = '';
      filter.add(new Option(`Tất cả (${rows.length})`, ''));
      for (const t of Object.values(QA_TYPES)) if (counts[t]) filter.add(new Option(`${t} (${counts[t]})`, t));
      filter.value = counts[current] ? current : '';
    }

    const shown = rows.filter((r) => !filter?.value || r.type === filter.value);
    box.innerHTML = '';
    if (!rows.length) {
      box.textContent = 'Không phát hiện lỗi.';
      return;
    }
    const LIMIT = 400;
    shown.slice(0, LIMIT).forEach((r) => {
      const div = document.createElement('div');
      div.className = 'cqt-qa-row';
      div.title = 'Bấm để nhảy tới frame và chọn object';
      const head = document.createElement('b');
      head.textContent = `f${r.frame} · #${r.trackId} ${r.cls} · ${r.type}`;
      div.appendChild(head);
      div.appendChild(document.createElement('br'));
      div.appendChild(document.createTextNode(r.desc));
      div.addEventListener('click', () => jumpTo(r.trackId, r.frame));
      box.appendChild(div);
    });
    if (shown.length > LIMIT) {
      const more = document.createElement('div');
      more.textContent = `... +${shown.length - LIMIT} dòng (xem đầy đủ trong CSV)`;
      box.appendChild(more);
    }
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportQA() {
    if (safeData()) {
      return fail('Đang bật Chế độ an toàn dữ liệu: không xuất file CSV chứa dữ liệu annotation ra máy. Tắt ở tab Cài đặt nếu cần xuất.');
    }
    if (!lastQA?.rows.length) return fail('Chưa có dữ liệu QA. Bấm "Quét QA" trước.');
    const header = ['Frame', 'Item ID', 'Track ID', 'Class', 'Loại kiểm tra', 'Mô tả', 'Giá trị', 'Ngưỡng / Chuẩn', 'Track liên quan'];
    const lines = [header.join(',')];
    for (const r of lastQA.rows) {
      lines.push([r.frame, r.itemId, r.trackId, r.cls, r.type, r.desc, r.value, r.threshold, r.related].map(csvEscape).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cvat_qa_job${getJob()?.id ?? ''}_${lastQA.range.from}-${lastQA.range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`📤 Đã export ${lastQA.rows.length} dòng CSV.`, 'success');
  }

  // =========================================================================
  // Auto-fix có xem trước
  // Mỗi "op" là một đề xuất sửa cho 1 track; op.apply(batch) thực hiện sửa.
  // Chỉ sửa keyframe (frame nội suy tự theo) để track không bị phình keyframe.
  // =========================================================================
  // Danh sách frame dạng "3, 7-12, f20" <-> mảng số
  function parseFrames(text) {
    const out = new Set();
    for (const part of String(text).split(',')) {
      const s = part.trim().replace(/f/gi, '');
      if (!s) continue;
      const m = s.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
      if (!m) return null;
      const a = +m[1], b = m[2] === undefined ? a : +m[2];
      for (let f = Math.min(a, b); f <= Math.max(a, b); f++) out.add(f);
    }
    return [...out].sort((x, y) => x - y);
  }

  function framesCompact(frames) {
    const out = [];
    for (let i = 0; i < frames.length; i++) {
      let j = i;
      while (j + 1 < frames.length && frames[j + 1] === frames[j] + 1) j++;
      out.push(j > i ? `${frames[i]}-${frames[j]}` : `${frames[i]}`);
      i = j;
    }
    return out.join(', ');
  }

  // Thông số chỉnh được trong bảng xem trước: { key, label, type: number|text|frames|select, value, min?, step?, options? }
  function fixParam(key, label, type, value, extra = {}) {
    return { key, label, type, value: String(value), ...extra };
  }

  function paramValues(op) {
    const P = {};
    for (const p of op.params || []) {
      if (p.type === 'number') P[p.key] = parseFloat(p.value);
      else if (p.type === 'frames') P[p.key] = parseFrames(p.value);
      else P[p.key] = p.value;
    }
    return P;
  }

  function paramError(op) {
    for (const p of op.params || []) {
      if (p.type === 'number') {
        const v = parseFloat(p.value);
        if (!Number.isFinite(v) || (p.min !== undefined && v < p.min)) return `${p.label} không hợp lệ`;
      } else if (p.type === 'frames') {
        if (!parseFrames(p.value)?.length) return `${p.label}: nhập dạng 3, 7-12`;
      } else if (p.type === 'text' && !String(p.value).trim()) {
        return `${p.label} đang trống`;
      }
    }
    return null;
  }

  function framesText(frames, max = 12) {
    const list = frames.slice(0, max).map((f) => 'f' + f).join(', ');
    return frames.length > max ? `${list}, … (+${frames.length - max})` : list;
  }

  function planSizeFix(rec, opts) {
    const m = trackMedianLWH(rec);
    // Chỉ kẹp limits khi bật "Ép theo limits"; tắt thì chỉ đồng bộ về median của track
    const lim = getSettings().enforceLimits ? getLimitsForLabel(rec.label) : null;
    const t = lim ? clampLWH(m.l, m.w, m.h, lim) : m;
    const clamped = !sameLWH([0, 0, 0, 0, 0, 0, m.l, m.w, m.h], t.l, t.w, t.h, 1e-9);
    const frames = rec.frames.filter((x) => x.keyframe && !sameLWH(x.points, t.l, t.w, t.h, 1e-4)).map((x) => x.frame);
    if (!frames.length) return null;
    const keys = rec.frames.filter((x) => x.keyframe).map((x) => x.frame);
    return {
      type: 'size', trackId: rec.id, auto: true, checked: true,
      title: `#${rec.id} [${rec.label}] · Size → ${fmtLWH(t.l, t.w, t.h)}${clamped ? ' (đã kẹp limits)' : ''}`,
      detail: `${frames.length} keyframe, giữ đáy: ${framesText(frames)}`,
      params: [
        fixParam('l', 'L', 'number', t.l.toFixed(3), { step: 0.01, min: 0.05 }),
        fixParam('w', 'W', 'number', t.w.toFixed(3), { step: 0.01, min: 0.05 }),
        fixParam('h', 'H', 'number', t.h.toFixed(3), { step: 0.01, min: 0.05 }),
      ],
      apply: async (batch, P) => {
        for (const f of keys) {
          const s = await getState(rec.id, f);
          if (!isCuboid(s) || s.outside) continue;
          await batch.edit(s, f, (st) => {
            if (sameLWH(st.points, P.l, P.w, P.h, 1e-6)) return false;
            st.points = withLWH(st.points, P.l, P.w, P.h, true);
            return true;
          });
        }
      },
    };
  }

  // Lật 180° các frame ngược đầu. Hướng đúng = theo hướng di chuyển (nếu xe chạy), ngược lại theo đa số frame.
  function planYawFix(rec, opts) {
    const fr = rec.frames;
    if (fr.length < 2) return [];
    const parity = [0];
    const manual = [];
    for (let i = 1; i < fr.length; i++) {
      const d = angleDiff(fr[i].points[5], fr[i - 1].points[5]);
      let p = parity[i - 1];
      if (d > 135 * RAD) p ^= 1;
      else if (d > opts.yawThresh * RAD && fr[i].frame === fr[i - 1].frame + 1) manual.push(fr[i].frame);
      parity.push(p);
    }

    // Hướng đi đo sau khi trừ chuyển động xe LiDAR (nếu đã đo), xem motionYaws
    const comp = egoCompEnabled();
    const poses = comp ? egoPoses(fr[0].frame, fr[0].frame, fr[fr.length - 1].frame) : null;
    const motion = motionYaws(fr.map((x) => ({ frame: x.frame, state: { points: x.points } })), poses);
    const votes = [0, 0];
    for (let i = 0; i < fr.length; i++) {
      if (!motion[i].moving) continue;
      const agree = Math.cos(fr[i].points[5] - motion[i].yaw) > 0;
      votes[agree ? parity[i] : 1 - parity[i]]++;
    }
    let good;
    let basis;
    if (votes[0] + votes[1] >= 3 && votes[0] !== votes[1]) {
      good = votes[0] > votes[1] ? 0 : 1;
      basis = 'theo hướng di chuyển' + (poses ? ' (đã trừ chuyển động xe LiDAR)' : comp ? ' (CHƯA trừ chuyển động xe LiDAR: bấm 📡 Đo ở tab Track nếu cloud theo toạ độ cảm biến)' : '');
    } else {
      const ones = parity.filter((p) => p === 1).length;
      good = ones > parity.length - ones ? 1 : 0;
      basis = 'theo đa số frame (xe đứng yên)';
    }

    const keyIdx = fr.map((x, i) => (x.keyframe ? i : -1)).filter((i) => i >= 0);
    const targets = [];
    for (let i = 0; i < fr.length; i++) {
      if (parity[i] === good) continue;
      if (fr[i].keyframe) { targets.push(fr[i].frame); continue; }
      // Frame nội suy: chỉ sửa trực tiếp khi 2 keyframe kề bên đều đúng (lật keyframe không chữa được nó)
      const prevK = [...keyIdx].reverse().find((k) => k < i);
      const nextK = keyIdx.find((k) => k > i);
      const prevWrong = prevK !== undefined && parity[prevK] !== good;
      const nextWrong = nextK !== undefined && parity[nextK] !== good;
      if (!prevWrong && !nextWrong) targets.push(fr[i].frame);
    }

    const ops = [];
    if (targets.length) {
      ops.push({
        type: 'yaw', trackId: rec.id, auto: true, checked: true,
        title: `#${rec.id} [${rec.label}] · Lật 180° ${targets.length} frame ngược đầu`,
        detail: `Hướng chuẩn ${basis}: ${framesText(targets)}`,
        params: [
          fixParam('frames', 'Frame', 'frames', framesCompact(targets), { wide: true }),
          fixParam('deg', 'Xoay (°)', 'number', 180, { step: 1 }),
        ],
        apply: async (batch, P) => {
          for (const f of P.frames) {
            const s = await getState(rec.id, f);
            if (!isCuboid(s) || s.outside) continue;
            await batch.edit(s, f, (st) => {
              const p = [...st.points];
              p[5] = wrapPi(p[5] + P.deg * RAD);
              st.points = p;
            });
          }
        },
      });
    }
    if (manual.length) {
      ops.push({
        type: 'yaw', trackId: rec.id, auto: false, frame: manual[0],
        title: `#${rec.id} [${rec.label}] · Đổi hướng ${opts.yawThresh}–135° (không phải lật đầu)`,
        detail: `Cần sửa tay: ${framesText(manual)}`,
      });
    }
    return ops;
  }

  // Gom các frame thoả điều kiện thành các đoạn liên tiếp (theo chỉ số trong rec.frames)
  function frameSegments(fr, pick) {
    const segments = [];
    for (let i = 0; i < fr.length; i++) {
      if (!pick(fr[i])) continue;
      const last = segments[segments.length - 1];
      if (last && last.endIdx === i - 1 && fr[i].frame === fr[i - 1].frame + 1) last.endIdx = i;
      else segments.push({ startIdx: i, endIdx: i });
    }
    return segments;
  }

  function segmentsText(fr, segments) {
    return segments.map((s) => `f${fr[s.startIdx].frame}–f${fr[s.endIdx].frame}`).join(', ');
  }

  // Ẩn track đúng trong các đoạn (không xoá gì): chốt keyframe ngay sau đoạn rồi đặt outside từ đầu đoạn
  async function applyOutsideSegments(batch, rec, segments) {
    const fr = rec.frames;
    for (const seg of segments) {
      const a = fr[seg.startIdx].frame;
      const b = fr[seg.endIdx].frame;
      const after = fr[seg.endIdx + 1];
      if (after && after.frame === b + 1) {
        const s = await getState(rec.id, after.frame);
        if (s && !s.outside && !s.keyframe) await batch.edit(s, after.frame, (st) => { st.keyframe = true; });
      }
      for (let k = seg.startIdx; k <= seg.endIdx; k++) {
        const x = fr[k];
        if (x.frame !== a && !x.keyframe) continue;
        const s = await getState(rec.id, x.frame);
        if (s && !s.outside) await batch.edit(s, x.frame, (st) => { st.outside = true; });
      }
    }
  }

  // Quá xa: đặt outside cho các đoạn frame vượt ngưỡng
  function planFarFix(rec, opts) {
    const fr = rec.frames;
    const segments = frameSegments(fr, (x) => Math.hypot(x.points[0], x.points[1], x.points[2]) > opts.distThresh);
    if (!segments.length) return null;
    const desc = segmentsText(fr, segments);
    if (rec.objectType !== 'track') {
      return {
        type: 'far', trackId: rec.id, auto: false, frame: fr[segments[0].startIdx].frame,
        title: `#${rec.id} [${rec.label}] · Quá xa > ${opts.distThresh}m (shape)`,
        detail: `Shape không có outside, cần kiểm tra tay: ${desc}`,
      };
    }
    return {
      type: 'far', trackId: rec.id, auto: true, checked: false,
      title: `#${rec.id} [${rec.label}] · Đặt outside ${segments.length} đoạn quá xa > ${opts.distThresh}m`,
      detail: `Ẩn track ở: ${desc} (mặc định không chọn — xem lại trước). Đổi ngưỡng thì đoạn ẩn tính lại khi áp dụng.`,
      params: [fixParam('dist', 'Xa hơn (m)', 'number', opts.distThresh, { step: 1, min: 1 })],
      apply: (batch, P) => applyOutsideSegments(batch, rec,
        frameSegments(fr, (x) => Math.hypot(x.points[0], x.points[1], x.points[2]) > P.dist)),
    };
  }

  // Gán thuộc tính track_id cho các frame của object (track: mọi keyframe; shape: chính box đó)
  async function applyTrackIdAttr(batch, rec, frames, value) {
    for (const f of frames) {
      const s = await getState(rec.id, f);
      if (!s) continue;
      const spec = findAttrSpec(s, TRACK_ID_ATTR);
      if (!spec) continue;
      await batch.edit(s, f, (st) => {
        if (String(attrValue(st, spec) ?? '') === String(value)) return false;
        setAttr(st, spec, value);
        return true;
      });
    }
  }

  function keyFrames(rec) {
    const k = rec.frames.filter((x) => x.keyframe).map((x) => x.frame);
    return k.length ? k : [rec.frames[0].frame];
  }

  function nextNumericTrackId(data) {
    let max = 0;
    for (const rec of data.tracks.values()) {
      for (const x of rec.frames) if (Number.isInteger(x.tid) && x.tidKey?.startsWith('a:')) max = Math.max(max, x.tid);
    }
    return max + 1;
  }

  // Thiếu track_id: nếu label có thuộc tính track_id thì nối với box cùng nhóm class gần nhất ở frame kề (≤ 2.5m),
  // không có thì cấp ID mới. Không có thuộc tính track_id => chỉ báo sửa tay (không đổi được shape thành track).
  function planMissingTrackFix(data, rows, idPool) {
    const ops = [];
    const ids = [...new Set(rows.filter((r) => r.type === QA_TYPES.missingTrack).map((r) => r.trackId))];
    const missing = [];
    for (const id of ids) {
      const rec = data.tracks.get(id);
      if (!rec.hasTrackAttr) {
        ops.push({
          type: 'missingTrack', trackId: id, auto: false, frame: rec.frames[0].frame,
          title: `#${id} [${rec.label}] · Shape không thuộc track (${rec.frames.length} frame)`,
          detail: 'Label không có thuộc tính track_id: cần tạo track trong CVAT hoặc thêm thuộc tính track_id vào label.',
        });
      } else {
        missing.push(rec);
      }
    }
    // Nối theo thứ tự frame để box sau dùng được ID vừa gán cho box trước
    missing.sort((a, b) => a.frames[0].frame - b.frames[0].frame);
    const assigned = new Map(); // clientID -> track_id
    // track_id đang có trong từng frame (kể cả ID vừa gán) để không tạo trùng mới
    const usedIn = (f) => new Set((data.frames.get(f) || [])
      .map((it) => (assigned.has(it.id) ? assigned.get(it.id) : (it.tidKey?.startsWith('a:') ? it.tid : null)))
      .filter((v) => v !== null));
    for (const rec of missing) {
      const first = rec.frames[0];
      const group = findClassGroup(rec.label) || normalizeClass(rec.label);
      const taken = new Set(rec.frames.flatMap((x) => [...usedIn(x.frame)]));
      let best = null;
      for (const f of [first.frame - 1, first.frame + 1]) {
        for (const it of data.frames.get(f) || []) {
          if (it.id === rec.id) continue;
          if ((findClassGroup(it.label) || normalizeClass(it.label)) !== group) continue;
          const tid = assigned.has(it.id) ? assigned.get(it.id) : (it.tidKey?.startsWith('a:') ? it.tid : null);
          if (tid === null || taken.has(tid)) continue;
          const d = Math.hypot(it.points[0] - first.points[0], it.points[1] - first.points[1]);
          if (d <= 2.5 && (!best || d < best.d)) best = { d, tid, from: it.id, f };
        }
      }
      const value = best ? best.tid : idPool.next++;
      assigned.set(rec.id, value);
      const frames = rec.objectType === 'track' ? keyFrames(rec) : rec.frames.map((x) => x.frame);
      ops.push({
        type: 'missingTrack', trackId: rec.id, auto: true, checked: true, frame: first.frame,
        title: `#${rec.id} [${rec.label}] · Gán track_id = ${value}`,
        detail: best
          ? `Nối với #${best.from} ở f${best.f} (cách ${best.d.toFixed(2)}m): ${framesText(frames)}`
          : `Không có box kề phù hợp, cấp ID mới: ${framesText(frames)}`,
        params: [fixParam('tid', 'track_id', 'text', value)],
        apply: (batch, P) => applyTrackIdAttr(batch, rec, frames, P.tid.trim()),
      });
    }
    return ops;
  }

  // Trùng track_id trong 1 frame:
  //  - 2 box gần như trùng nhau (box ma): ẩn box có ID lớn hơn đúng trong các frame trùng (outside, không xoá)
  //  - 2 box ở vị trí khác nhau: cấp track_id mới cho object có ID lớn hơn (nếu có thuộc tính track_id)
  function planDuplicateTrackFix(data, rows, idPool) {
    const ops = [];
    const pairs = new Map();
    for (const r of rows) {
      if (r.type !== QA_TYPES.duplicateTrack) continue;
      const a = Math.min(r.trackId, r.related), b = Math.max(r.trackId, r.related);
      const key = `${a}-${b}`;
      if (!pairs.has(key)) pairs.set(key, { keep: a, drop: b, frames: new Set() });
      pairs.get(key).frames.add(r.frame);
    }
    for (const p of pairs.values()) {
      const keep = data.tracks.get(p.keep), drop = data.tracks.get(p.drop);
      const both = drop.frames.filter((x) => p.frames.has(x.frame));
      let ghost = 0;
      for (const x of both) {
        const k = keep.frames.find((y) => y.frame === x.frame);
        const ov = k && bevOverlap(k.points, x.points);
        if (k && (Math.hypot(k.points[0] - x.points[0], k.points[1] - x.points[1]) < 0.4 || (ov && ov.iou > 0.4))) ghost++;
      }
      const frames = [...p.frames].sort((x, y) => x - y);
      const tidText = drop.frames.find((x) => p.frames.has(x.frame))?.tid;
      if (ghost >= both.length / 2) {
        if (drop.objectType !== 'track') {
          ops.push({
            type: 'duplicateTrack', trackId: p.drop, auto: false, frame: frames[0],
            title: `#${p.drop} · Box ma trùng #${p.keep} (shape)`,
            detail: `Shape không có outside, cần kiểm tra tay: ${framesText(frames)}`,
          });
          continue;
        }
        const segments = frameSegments(drop.frames, (x) => p.frames.has(x.frame));
        ops.push({
          type: 'duplicateTrack', trackId: p.drop, auto: true, checked: true, frame: frames[0],
          title: `#${p.drop} · Ẩn box ma trùng #${p.keep} (track_id ${tidText})`,
          detail: `Đặt outside đúng các đoạn trùng: ${segmentsText(drop.frames, segments)}`,
          params: [fixParam('frames', 'Frame ẩn', 'frames', framesCompact(frames), { wide: true })],
          apply: (batch, P) => {
            const pick = new Set(P.frames);
            return applyOutsideSegments(batch, drop, frameSegments(drop.frames, (x) => pick.has(x.frame)));
          },
        });
      } else if (drop.hasTrackAttr) {
        const value = idPool.next++;
        const target = drop.objectType === 'track' ? keyFrames(drop) : drop.frames.map((x) => x.frame);
        ops.push({
          type: 'duplicateTrack', trackId: p.drop, auto: true, checked: true, frame: frames[0],
          title: `#${p.drop} · Tách khỏi #${p.keep}: track_id ${tidText} → ${value}`,
          detail: `Hai box ở vị trí khác nhau tại ${framesText(frames)}; gán track_id mới cho #${p.drop}.`,
          params: [fixParam('tid', 'track_id mới', 'text', value)],
          apply: (batch, P) => applyTrackIdAttr(batch, drop, target, P.tid.trim()),
        });
      } else {
        ops.push({
          type: 'duplicateTrack', trackId: p.drop, auto: false, frame: frames[0],
          title: `#${p.drop} ↔ #${p.keep} · Trùng track_id ${tidText}`,
          detail: `Cần sửa tay: ${framesText(frames)}`,
        });
      }
    }
    return ops;
  }

  // Nhãn lạ: đổi sang label có thật trong job thuộc nhóm đoán được (không đổi tên label)
  function planUnknownClassFix(data, rows) {
    const ops = [];
    const ids = new Set(rows.filter((r) => r.type === QA_TYPES.unknownClass).map((r) => r.trackId));
    for (const id of ids) {
      const rec = data.tracks.get(id);
      const group = suggestClassGroup(rec.label);
      const target = group && jobLabelForGroup(group);
      if (!target) {
        ops.push({
          type: 'unknownClass', trackId: id, auto: false, frame: rec.frames[0].frame,
          title: `#${id} [${rec.label}] · Nhãn không thuộc class_groups`,
          detail: group ? `Đoán là nhóm "${group}" nhưng job không có label nào thuộc nhóm này.` : 'Không đoán được nhóm, cần sửa tay.',
        });
        continue;
      }
      const f0 = rec.frames[0].frame;
      ops.push({
        type: 'unknownClass', trackId: id, auto: true, checked: false, frame: f0,
        title: `#${id} [${rec.label}] → đổi sang label "${target.name}" (nhóm ${group})`,
        detail: 'Đổi label của cả object (CVAT có thể đặt lại thuộc tính về mặc định). Mặc định không chọn — xem lại trước.',
        params: [fixParam('label', 'Label mới', 'select', target.name, {
          options: jobLabels().map((l) => ({ value: l.name, text: l.name })),
        })],
        apply: async (batch, P) => {
          const label = jobLabels().find((l) => l.name === P.label) || target;
          const s = await getState(id, f0);
          if (s) await batch.edit(s, f0, (st) => { st.label = label; });
        },
      });
    }
    return ops;
  }

  function planOverlapNotes(rows) {
    const pairs = new Map();
    for (const r of rows) {
      if (r.type !== QA_TYPES.overlap || r.trackId > r.related) continue;
      const key = `${r.trackId}-${r.related}`;
      const p = pairs.get(key) || { a: r.trackId, b: r.related, cls: r.cls, frames: [], maxIoU: 0 };
      p.frames.push(r.frame);
      p.maxIoU = Math.max(p.maxIoU, parseFloat(r.value) || 0);
      pairs.set(key, p);
    }
    return [...pairs.values()].map((p) => ({
      type: 'overlap', trackId: p.a, auto: false, frame: p.frames[0],
      title: `#${p.a} ↔ #${p.b} · Chồng lấn ${p.frames.length} frame (IoU max ${p.maxIoU.toFixed(3)})`,
      detail: `Cần sửa tay: ${framesText(p.frames)}`,
    }));
  }

  // Chưa chạm đất: hạ/nâng keyframe về mặt đất đã đo (giữ nghiêng). Frame nội suy thì báo sửa tay
  // (sửa trực tiếp sẽ tạo keyframe mới): sửa keyframe kề rồi quét lại.
  function planGroundFix(rows) {
    const ops = [];
    const byTrack = new Map();
    for (const r of rows) {
      if (r.type !== QA_TYPES.ground) continue;
      if (!byTrack.has(r.trackId)) byTrack.set(r.trackId, []);
      byTrack.get(r.trackId).push(r);
    }
    for (const [id, list] of byTrack) {
      const keys = list.filter((r) => r.keyframe);
      const inter = list.filter((r) => !r.keyframe);
      const cls = list[0].cls;
      if (keys.length) {
        const gaps = keys.map((r) => +r.value);
        ops.push({
          type: 'ground', trackId: id, auto: true, checked: true,
          title: `#${id} [${cls}] · Đặt chạm đất ${keys.length} keyframe`,
          detail: `Lệch ${fmtSigned(Math.min(...gaps), 3)} → ${fmtSigned(Math.max(...gaps), 3)} m: ${framesText(keys.map((r) => r.frame))}`,
          params: [
            fixParam('mode', 'Cách đặt', 'select', 'snap', { options: [
              { value: 'snap', text: 'Giữ nghiêng' }, { value: 'flat', text: 'Đặt phẳng' }, { value: 'tilt', text: 'Nghiêng theo dốc' }] }),
            fixParam('clear', 'Hở đáy (m)', 'number', 0, { step: 0.01 }),
          ],
          apply: async (batch, P) => {
            for (const r of keys) {
              const s = await getState(id, r.frame);
              if (!isCuboid(s) || s.outside) continue;
              await batch.edit(s, r.frame, (st) => {
                const after = fitToGround(st.points, r.plane, P.mode);
                after[2] += P.clear;
                if (Math.abs(after[2] - st.points[2]) < 1e-4 && after[3] === st.points[3] && after[4] === st.points[4]) return false;
                st.points = after;
                return true;
              });
            }
          },
        });
      }
      if (inter.length) {
        ops.push({
          type: 'ground', trackId: id, auto: false, frame: inter[0].frame,
          title: `#${id} [${cls}] · ${inter.length} frame nội suy chưa chạm đất`,
          detail: `Sửa keyframe gần đó hoặc thêm keyframe: ${framesText(inter.map((r) => r.frame))}`,
        });
      }
    }
    return ops;
  }

  // types: tập loại cần đề xuất ('size', 'yaw', 'ground', 'far', 'overlap')
  function planFixes(qa, types) {
    const { rows, data, opts } = qa;
    const flagged = (type) => new Set(rows.filter((r) => r.type === type).map((r) => r.trackId));
    const ops = [];
    // Lỗi nằm ở frame mà sửa keyframe không chữa được => báo để sửa tay
    const manualNote = (type, id, text) => {
      const rec = data.tracks.get(id);
      const frame = rows.find((r) => r.trackId === id)?.frame;
      ops.push({ type, trackId: id, auto: false, frame, title: `#${id} [${rec.label}] · ${text}`, detail: 'Không tự sửa được, cần kiểm tra tay.' });
    };
    const idPool = { next: nextNumericTrackId(data) }; // ID mới dùng chung, không cấp trùng
    if (types.has('missingTrack')) ops.push(...planMissingTrackFix(data, rows, idPool));
    if (types.has('duplicateTrack')) ops.push(...planDuplicateTrackFix(data, rows, idPool));
    if (types.has('unknownClass')) ops.push(...planUnknownClassFix(data, rows));
    if (types.has('size')) {
      // Track chỉ ngoài limits (không lệch scale) có thể hợp lệ (vd. người đang cúi) => chỉ đề xuất khi bật ép limits, mặc định không tick
      const scaleIds = flagged(QA_TYPES.scale);
      const enforce = getSettings().enforceLimits;
      const ids = new Set([...scaleIds, ...(enforce ? flagged(QA_TYPES.limits) : [])]);
      for (const id of ids) {
        const op = planSizeFix(data.tracks.get(id), opts);
        if (op) {
          if (!scaleIds.has(id)) op.checked = false;
          ops.push(op);
        } else if (scaleIds.has(id)) manualNote('size', id, 'Size lệch nhưng mọi keyframe đã đúng chuẩn');
      }
    }
    if (types.has('yaw')) {
      for (const id of flagged(QA_TYPES.yaw)) {
        const yawOps = planYawFix(data.tracks.get(id), opts);
        if (yawOps.length) ops.push(...yawOps);
        else manualNote('yaw', id, 'Đổi hướng đột ngột');
      }
    }
    if (types.has('ground')) ops.push(...planGroundFix(rows));
    if (types.has('far')) {
      for (const id of flagged(QA_TYPES.dist)) {
        const op = planFarFix(data.tracks.get(id), opts);
        if (op) ops.push(op);
      }
    }
    if (types.has('overlap')) ops.push(...planOverlapNotes(rows));
    return ops;
  }

  async function previewAutoFix() {
    const qa = lastQA || await scanQA();
    if (!qa) return;
    const ops = planFixes(qa, new Set(['missingTrack', 'duplicateTrack', 'unknownClass', 'size', 'yaw', 'ground', 'far', 'overlap']));
    if (!ops.length) return setStatus('✅ Không có lỗi nào cần sửa.', 'success');
    openFixPreview('Xem trước auto-fix QA', ops);
  }

  // Dùng cho nút ở tab Track: chỉ xét object đang chọn (hoặc nhóm Shift+Click) trên toàn job
  async function previewFixForTarget(kind) {
    const ids = selectedOrTarget();
    if (!ids.length) return requireTarget();
    const b = jobBounds();
    if (!b) return fail('Chưa kết nối CVAT Job!');
    const opts = { ...readQAOptionsFromUI(), scale: false, overlap: false, limits: false, yaw: kind === 'yaw', dist: kind === 'far' };
    const who = idsText(ids);
    setStatus(`⏳ Đang quét ${who}...`);
    const data = await scanJobData(b.start, b.stop, new Set(ids));
    if (!data.tracks.size) return fail(`Không thấy ${who} trong job.`);
    const rows = runQAChecks(data, opts);
    const ops = planFixes({ rows, data, opts }, new Set([kind]));
    if (!ops.length) {
      return setStatus(kind === 'yaw'
        ? `ℹ️ ${who} không có bước nhảy góc > ${opts.yawThresh}°.`
        : `ℹ️ ${who} không có frame nào xa hơn ${opts.distThresh}m.`, 'success');
    }
    for (const op of ops) if (op.auto) op.checked = true;
    openFixPreview(kind === 'yaw' ? `Sửa đổi hướng ${who}` : `Cắt phần quá xa ${who}`, ops);
  }

  function openFixPreview(title, ops) {
    $('cqt-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'cqt-modal';
    modal.innerHTML = `
      <div class="cqt-modal-box">
        <div class="cqt-modal-head"><span></span><button class="cqt-modal-x" title="Đóng">✕</button></div>
        <div class="cqt-modal-tools">
          <button class="cqt-btn cqt-btn-secondary" data-act="all">Chọn tất cả</button>
          <button class="cqt-btn cqt-btn-secondary" data-act="none">Bỏ chọn</button>
        </div>
        <div class="cqt-modal-body"></div>
        <div class="cqt-modal-foot">
          <button class="cqt-btn cqt-btn-ground" data-act="apply"></button>
          <button class="cqt-btn cqt-btn-secondary" data-act="close">Đóng</button>
        </div>
      </div>`;
    modal.querySelector('.cqt-modal-head span').textContent = title;
    const body = modal.querySelector('.cqt-modal-body');
    const applyBtn = modal.querySelector('[data-act="apply"]');
    const autoOps = ops.filter((o) => o.auto);
    const manualOps = ops.filter((o) => !o.auto);
    const updateCount = () => {
      const n = autoOps.filter((o) => o.checked).length;
      const bad = autoOps.filter((o) => o.checked && o.invalid).length;
      applyBtn.textContent = !autoOps.length ? 'Không có mục tự sửa được'
        : bad ? `⚠️ ${bad} mục có thông số sai` : `Áp dụng ${n} mục đã chọn`;
      applyBtn.disabled = n === 0 || bad > 0;
    };

    const section = (text) => {
      const h = document.createElement('div');
      h.className = 'cqt-modal-section';
      h.textContent = text;
      body.appendChild(h);
    };
    const item = (op, withCheckbox) => {
      const row = document.createElement('label');
      row.className = 'cqt-fix-row';
      if (withCheckbox) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = op.checked;
        cb.addEventListener('change', () => { op.checked = cb.checked; updateCount(); });
        op.checkbox = cb;
        row.appendChild(cb);
      }
      const text = document.createElement('div');
      const t = document.createElement('b');
      t.textContent = op.title;
      const d = document.createElement('div');
      d.className = 'cqt-fix-detail';
      d.textContent = op.detail;
      text.append(t, d);
      row.appendChild(text);
      if (!withCheckbox) {
        row.title = 'Bấm để nhảy tới frame lỗi';
        row.addEventListener('click', () => jumpTo(op.trackId, op.frame));
      }
      body.appendChild(row);
      if (op.params?.length) body.appendChild(paramRow(op));
    };
    // Ô thông số nằm ngoài <label> để bấm vào không bật/tắt checkbox
    const paramRow = (op) => {
      const box = document.createElement('div');
      box.className = 'cqt-fix-params';
      const err = document.createElement('span');
      err.className = 'cqt-fix-err';
      for (const prm of op.params) {
        const wrap = document.createElement('label');
        wrap.className = 'cqt-fix-param';
        wrap.append(document.createTextNode(prm.label + ' '));
        let input;
        if (prm.type === 'select') {
          input = document.createElement('select');
          for (const o of prm.options) input.add(new Option(o.text, o.value));
          input.value = prm.value;
        } else {
          input = document.createElement('input');
          input.type = prm.type === 'number' ? 'number' : 'text';
          if (prm.step) input.step = prm.step;
          input.value = prm.value;
        }
        input.className = 'cqt-input cqt-mini' + (prm.wide ? ' cqt-wide' : '');
        input.dataset.param = prm.key;
        const sync = () => {
          prm.value = input.value;
          const e = paramError(op);
          err.textContent = e ? '⚠️ ' + e : '';
          op.invalid = !!e;
          updateCount();
        };
        input.addEventListener('input', sync);
        input.addEventListener('change', sync);
        wrap.appendChild(input);
        box.appendChild(wrap);
      }
      box.appendChild(err);
      return box;
    };

    if (autoOps.length) section(`Tự sửa được (${autoOps.length})`);
    autoOps.forEach((op) => item(op, true));
    if (manualOps.length) section(`Cần sửa tay — bấm để nhảy tới (${manualOps.length})`);
    manualOps.forEach((op) => item(op, false));
    updateCount();

    const close = () => modal.remove();
    modal.querySelector('.cqt-modal-x').addEventListener('click', close);
    modal.querySelector('[data-act="close"]').addEventListener('click', close);
    if (!autoOps.length) modal.querySelector('.cqt-modal-tools').style.display = 'none';
    modal.querySelector('[data-act="all"]').addEventListener('click', () => {
      autoOps.forEach((o) => { o.checked = true; o.checkbox.checked = true; });
      updateCount();
    });
    modal.querySelector('[data-act="none"]').addEventListener('click', () => {
      autoOps.forEach((o) => { o.checked = false; o.checkbox.checked = false; });
      updateCount();
    });
    applyBtn.addEventListener('click', async () => {
      const chosen = autoOps.filter((o) => o.checked);
      if (!chosen.length) return;
      applyBtn.disabled = true;
      close();
      await applyFixes(title, chosen);
    });
    document.body.appendChild(modal);
  }

  async function applyFixes(title, ops) {
    const batch = createBatch(title);
    // Đổi label trước (có thể đặt lại thuộc tính), rồi track_id, size, yaw, chạm đất (sau size/yaw vì 2 cái đó đổi góc đáy);
    // outside làm cuối vì ẩn frame
    const order = { unknownClass: 0, missingTrack: 1, size: 2, seq: 2, yaw: 3, ground: 4, duplicateTrack: 5, far: 6 };
    const sorted = [...ops].sort((a, b) => order[a.type] - order[b.type]);
    for (let i = 0; i < sorted.length; i++) {
      const err = paramError(sorted[i]);
      if (err) return fail(`${sorted[i].title}: ${err}`);
    }
    for (let i = 0; i < sorted.length; i++) {
      setStatus(`⏳ Đang sửa ${i + 1}/${sorted.length}: ${sorted[i].title}`);
      await sorted[i].apply(batch, paramValues(sorted[i]));
    }
    const res = await batch.finish();
    if (lastQA && ops.some((o) => o.type !== 'seq')) await scanQA();
    setStatus(
      `⚡ Đã áp dụng ${ops.length} đề xuất (${res.changed} lần sửa). Có snapshot để khôi phục.` + editSuffix(res),
      res.errors ? 'warn' : 'success'
    );
  }

  // =========================================================================
  // Workflow kiểu Blender trên canvas 3D
  //   G / W / S         : di chuyển / xoay / co giãn object đang chọn theo chuột
  //                       (nhiều box: Shift+Click để chọn, G/W/S áp cho cả nhóm, W xoay quanh tâm nhóm)
  //   X / Y / Z         : khoá trục (bấm lần 2 = trục local của box)
  //   gõ số             : nhập giá trị chính xác (m, độ, hệ số)
  //   Ctrl (khi kéo)    : bắt bước 0.1m / 5° / 0.05
  //   Enter / chuột trái: xác nhận — Esc / chuột phải: huỷ
  //   Numpad 7 / 1 / 3  : nhìn Top / Front / Side box (Ctrl = phía đối diện), Numpad . : focus
  // =========================================================================
  const vec = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  };

  function invert4(a) {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    return [
      (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det,
      (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
      (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det,
      (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
      (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det,
      (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
      (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det,
      (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
    ];
  }

  // Ma trận cột (three.js), có chia w
  function applyMat4(e, v) {
    const w = e[3] * v[0] + e[7] * v[1] + e[11] * v[2] + e[15];
    return [
      (e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12]) / w,
      (e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13]) / w,
      (e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14]) / w,
    ];
  }

  function canvasRect() {
    const el = getPerspectiveView()?.renderer?.domElement;
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? r : null;
  }

  function pointerOverCanvas(x, y) {
    const r = canvasRect();
    if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
    // Cửa sổ Full Control / ô nhìn nhúng phủ lên canvas thì không coi là đang trỏ vào canvas 3D
    return !document.elementFromPoint(x, y)?.closest?.('#cqt-fc-window, .cqt-dock-view, #cqt-item-panel');
  }

  function mouseRay(x, y) {
    const v = getPerspectiveView();
    const r = canvasRect();
    if (!v || !r) return null;
    const cam = v.camera;
    cam.updateMatrixWorld?.();
    const pInv = cam.projectionMatrixInverse?.elements || invert4(cam.projectionMatrix.elements);
    if (!pInv) return null;
    const nx = ((x - r.left) / r.width) * 2 - 1;
    const ny = -((y - r.top) / r.height) * 2 + 1;
    const a = applyMat4(cam.matrixWorld.elements, applyMat4(pInv, [nx, ny, -1]));
    const b = applyMat4(cam.matrixWorld.elements, applyMat4(pInv, [nx, ny, 1]));
    const d = vec.sub(b, a);
    const len = Math.hypot(d[0], d[1], d[2]);
    return { o: a, d: vec.scale(d, 1 / len) };
  }

  // Tìm cuboid 3D ngay dưới con trỏ chuột trên canvas (Ray-OBB, chuẩn xác trên cả macOS/Windows, không đợi CVAT)
  async function findCuboidUnderPointer(x, y) {
    const ray = mouseRay(x, y);
    if (!ray) return null;
    const frame = getFrame();
    if (!Number.isInteger(frame)) return null;
    const states = (await getStates(frame)).filter((s) => isCuboid(s) && !s.outside);
    let bestId = null;
    let minT = Infinity;
    for (const s of states) {
      const t = rayIntersectBox(ray, s.points);
      if (t !== null && t < minT) {
        minT = t;
        bestId = s.clientID;
      }
    }
    return bestId;
  }

  function rayPlane(ray, normal, point) {
    if (!ray) return null;
    const den = vec.dot(normal, ray.d);
    if (Math.abs(den) < 1e-9) return null;
    const t = vec.dot(normal, vec.sub(point, ray.o)) / den;
    return t < 0 ? null : vec.add(ray.o, vec.scale(ray.d, t));
  }

  let lastMouse = { x: 0, y: 0 };
  let swallowClicksUntil = 0;
  const xf = { active: false, items: [] };

  function axisVector(axis, local, yaw) {
    if (axis === 'Z') return [0, 0, 1];
    if (!local) return axis === 'X' ? [1, 0, 0] : [0, 1, 0];
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return axis === 'X' ? [c, s, 0] : [-s, c, 0];
  }

  // Mọi phép chiếu chuột dùng tâm nhóm (pivot) làm điểm tựa
  function groundHit(mouse) {
    return rayPlane(mouseRay(mouse.x, mouse.y), [0, 0, 1], xf.pivot);
  }

  function verticalHit(mouse) {
    const v = getPerspectiveView();
    const e = v.camera.matrixWorld.elements;
    const n = [e[8], e[9], 0]; // hướng nhìn chiếu xuống mặt ngang
    if (Math.hypot(n[0], n[1]) < 1e-6) return null;
    return rayPlane(mouseRay(mouse.x, mouse.y), n, xf.pivot);
  }

  function typedValue() {
    if (!xf.typed || xf.typed === '-' || xf.typed === '.') return null;
    const n = parseFloat(xf.typed);
    return Number.isFinite(n) ? n : null;
  }

  // Tham số chung cho cả nhóm, tính từ chuột / số đã gõ
  function computeParams(mouse, ctrl) {
    const typed = typedValue();
    const c = xf.pivot;
    const refYaw = xf.items[0].orig[5]; // trục local theo object đang active

    if (xf.mode === 'G') {
      let delta = [0, 0, 0];
      if (typed !== null) {
        delta = vec.scale(axisVector(xf.axis || 'X', xf.local || !xf.axis, refYaw), typed);
      } else if (xf.axis === 'Z') {
        const h0 = verticalHit(xf.startMouse), h1 = verticalHit(mouse);
        if (h0 && h1) delta = [0, 0, h1[2] - h0[2]];
      } else {
        const h0 = groundHit(xf.startMouse), h1 = groundHit(mouse);
        if (h0 && h1) {
          const d = vec.sub(h1, h0);
          d[2] = 0;
          if (xf.axis) {
            const ax = axisVector(xf.axis, xf.local, refYaw);
            delta = vec.scale(ax, vec.dot(d, ax));
          } else {
            delta = d;
          }
        }
      }
      if (ctrl && typed === null) delta = delta.map((x) => Math.round(x * 10) / 10);
      return { delta, info: `Δ ${delta.map((x) => fmtSigned(x)).join(', ')} m` };
    }

    if (xf.mode === 'R') {
      let angle = 0;
      if (typed !== null) {
        angle = typed * RAD;
      } else if (xf.axis === 'X' || xf.axis === 'Y') {
        angle = (mouse.x - xf.startMouse.x) * 0.5 * RAD;
      } else {
        const h0 = groundHit(xf.startMouse), h1 = groundHit(mouse);
        if (h0 && h1) angle = Math.atan2(h1[1] - c[1], h1[0] - c[0]) - Math.atan2(h0[1] - c[1], h0[0] - c[0]);
      }
      angle = wrapPi(angle);
      if (ctrl && typed === null) angle = Math.round(angle / (5 * RAD)) * 5 * RAD;
      const idx = xf.axis === 'X' ? 3 : xf.axis === 'Y' ? 4 : 5;
      return { angle, idx, info: `${idx === 3 ? 'Roll' : idx === 4 ? 'Pitch' : 'Yaw'} ${fmtSigned(angle * DEG, 1)}°` };
    }

    let k = 1;
    if (typed !== null) {
      k = typed;
    } else {
      const h0 = groundHit(xf.startMouse), h1 = groundHit(mouse);
      if (h0 && h1) {
        const d0 = Math.hypot(h0[0] - c[0], h0[1] - c[1]);
        if (d0 > 0.05) k = Math.hypot(h1[0] - c[0], h1[1] - c[1]) / d0;
      }
    }
    if (ctrl && typed === null) k = Math.round(k / 0.05) * 0.05;
    k = Math.max(0.05, k);
    return { k, info: `×${k.toFixed(3)}${xf.axis ? ` (${{ X: 'L', Y: 'W', Z: 'H' }[xf.axis]})` : ''}` };
  }

  function applyParams(o, prm) {
    const p = [...o];
    if (xf.mode === 'G') {
      for (let i = 0; i < 3; i++) p[i] += prm.delta[i];
    } else if (xf.mode === 'R') {
      if (prm.idx === 5 && xf.items.length > 1) {
        // Xoay cả nhóm quanh tâm nhóm: vị trí quay theo, yaw từng box cộng thêm
        const c = Math.cos(prm.angle), s = Math.sin(prm.angle);
        const dx = o[0] - xf.pivot[0], dy = o[1] - xf.pivot[1];
        p[0] = xf.pivot[0] + dx * c - dy * s;
        p[1] = xf.pivot[1] + dx * s + dy * c;
      }
      p[prm.idx] = wrapPi(o[prm.idx] + prm.angle);
    } else {
      // Co giãn kích thước từng box, giữ đáy, không đổi vị trí tâm XY
      const dims = [o[6], o[7], o[8]].map((x, i) => (!xf.axis || 'XYZ'[i] === xf.axis ? Math.max(0.05, x * prm.k) : x));
      return withLWH(o, dims[0], dims[1], dims[2], true);
    }
    return p;
  }

  function previewMesh(it) {
    const m = it.mesh, m0 = it.mesh0, o = it.orig, p = it.points;
    if (!m || !m0) return;
    m.position.set(m0.pos[0] + p[0] - o[0], m0.pos[1] + p[1] - o[1], m0.pos[2] + p[2] - o[2]);
    m.rotation.set(m0.rot[0] + p[3] - o[3], m0.rot[1] + p[4] - o[4], m0.rot[2] + p[5] - o[5]);
    m.scale.set(m0.scl[0] * p[6] / o[6], m0.scl[1] * p[7] / o[7], m0.scl[2] * p[8] / o[8]);
  }

  function restoreMeshes() {
    for (const it of xf.items || []) {
      const m = it.mesh, m0 = it.mesh0;
      if (!m || !m0) continue;
      m.position.set(...m0.pos);
      m.rotation.set(...m0.rot);
      m.scale.set(...m0.scl);
    }
  }

  function hud(text) {
    let el = $('cqt-hud');
    if (!text) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'cqt-hud';
      document.body.appendChild(el);
    }
    const r = canvasRect();
    if (r) {
      el.style.left = `${r.left + r.width / 2}px`;
      el.style.top = `${r.top + 12}px`;
    }
    el.textContent = text;
  }

  function targetsText() {
    const ids = xf.items.map((it) => '#' + it.id);
    return ids.length > 4 ? `${ids.length} box (${ids.slice(0, 4).join(', ')}, …)` : ids.join(', ');
  }

  function updateTransform(snapStep = false) {
    if (!xf.active) return;
    const prm = computeParams(lastMouse, snapStep);
    xf.info = prm.info;
    for (const it of xf.items) {
      it.points = applyParams(it.orig, prm);
      previewMesh(it);
    }
    const names = { G: 'Di chuyển (G)', R: 'Xoay (W)', S: 'Co giãn (S)' };
    const axis = xf.axis ? ` · trục ${xf.axis}${xf.local || xf.mode === 'S' ? ' (local)' : ''}` : '';
    const typed = xf.typed ? ` · nhập: ${xf.typed}_` : '';
    hud(`${names[xf.mode]} ${targetsText()}${axis} · ${xf.info}${typed}   |   Enter/Click trái: OK · Esc/Click phải: huỷ · X/Y/Z: trục · Shift/Ctrl: bắt bước` +
      (xf.items.every((it) => it.mesh) ? '' : '  (có box không xem trước được, sẽ áp khi xác nhận)'));
  }

  // Box sẽ bị tác động: cả danh sách chọn (nếu object đang active nằm trong đó), ngược lại chỉ object active
  function transformTargets() {
    const id = activeId();
    if (selection.size && (id === null || selection.has(id))) {
      return id === null ? [...selection] : [id, ...[...selection].filter((x) => x !== id)];
    }
    return id === null ? [] : [id];
  }

  async function startTransform(mode) {
    const ids = transformTargets();
    const frame = getFrame();
    if (!ids.length || !Number.isInteger(frame)) return;
    const states = await getStates(frame);
    const items = [];
    let locked = 0;
    for (const id of ids) {
      const s = states.find((x) => x.clientID === id);
      if (!isCuboid(s) || s.outside) continue;
      if (s.lock) { locked++; continue; }
      const mesh = findDrawnMesh(id);
      items.push({
        id, state: s, orig: [...s.points], points: [...s.points], mesh,
        mesh0: mesh ? {
          pos: [mesh.position.x, mesh.position.y, mesh.position.z],
          rot: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
          scl: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
        } : null,
      });
    }
    if (!items.length) return setStatus(locked ? '🔒 Object đang bị khoá.' : 'ℹ️ Không có box nào để thao tác ở frame này.', 'warn');
    const pivot = [0, 1, 2].map((k) => items.reduce((sum, it) => sum + it.orig[k], 0) / items.length);
    Object.assign(xf, {
      active: true, mode, axis: null, local: false, typed: '', frame, items, pivot,
      startMouse: { ...lastMouse }, info: '',
    });
    if (locked) setStatus(`🔒 Bỏ qua ${locked} box đang bị khoá.`, 'warn');
    updateTransform();
  }

  function endTransform() {
    xf.active = false;
    hud(null);
    swallowClicksUntil = Date.now() + 300;
  }

  function cancelTransform() {
    restoreMeshes();
    endTransform();
    setStatus('↩️ Đã huỷ thao tác.', '');
  }

  async function confirmTransform() {
    const { items, frame, mode } = xf;
    endTransform();
    const moved = items.filter((it) => it.points.some((v, i) => Math.abs(v - it.orig[i]) > 1e-9));
    if (!moved.length) return restoreMeshes();
    const batch = createBatch(`${mode} ${targetsText()}`);
    for (const it of moved) await batch.edit(it.state, frame, (s) => { s.points = it.points; });
    const res = await batch.finish();
    if (!res.changed) restoreMeshes();
    setStatus(`✅ ${mode} ${targetsText()}: ${xf.info}.` + editSuffix(res), res.changed ? 'success' : 'error');
  }

  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function handleTransformKey(e) {
    swallow(e);
    const k = e.key;
    if (k === 'Escape') return cancelTransform();
    if (k === 'Enter') return confirmTransform();
    if (e.code === 'KeyX' || e.code === 'KeyY' || e.code === 'KeyZ') {
      const axis = e.code.slice(3);
      if (xf.mode === 'S') xf.axis = xf.axis === axis ? null : axis;
      else if (xf.axis !== axis) { xf.axis = axis; xf.local = false; }
      else if (!xf.local && axis !== 'Z') xf.local = true;
      else { xf.axis = null; xf.local = false; }
    } else if (TRANSFORM_KEYS[e.code]) {
      restoreMeshes();
      Object.assign(xf, { mode: TRANSFORM_KEYS[e.code], axis: null, local: false, typed: '', startMouse: { ...lastMouse } });
    } else if (/^[0-9]$/.test(k) || k === '.' || k === ',') {
      xf.typed += k === ',' ? '.' : k;
    } else if (k === '-') {
      xf.typed = xf.typed.startsWith('-') ? xf.typed.slice(1) : '-' + xf.typed;
    } else if (k === 'Backspace') {
      xf.typed = xf.typed.slice(0, -1);
    }
    updateTransform(e.ctrlKey || e.shiftKey);
  }

  // =========================================================================
  // Camera
  // =========================================================================
  async function cameraView(kind, opposite = false) {
    const v = getPerspectiveView();
    if (!v) return fail('Không tìm thấy camera 3D của CVAT.');
    const controls = v.controls;
    const cam = v.camera;
    let target = null, yaw = 0, size = 4;
    const id = resolveTargetId();
    if (Number.isInteger(id)) {
      const s = await getState(id, getFrame());
      if (isCuboid(s) && !s.outside) {
        target = s.points.slice(0, 3);
        yaw = s.points[5];
        size = Math.max(s.points[6], s.points[7], s.points[8]);
      }
    }
    const t0 = controls?.getTarget?.();
    const curTarget = t0 ? [t0.x, t0.y, t0.z] : [0, 0, 0];
    if (!target) {
      if (kind === 'focus') return fail('Chọn object để focus.');
      target = curTarget;
    }
    const dist = Math.max(size * 2.5, 6);
    const sign = opposite ? -1 : 1;
    const h = [Math.cos(yaw), Math.sin(yaw), 0];
    const left = [-Math.sin(yaw), Math.cos(yaw), 0];
    let eye;
    if (kind === 'top') {
      eye = vec.add(target, vec.add([0, 0, sign * dist], vec.scale(h, -0.01)));
    } else if (kind === 'front') {
      eye = vec.add(target, vec.add(vec.scale(h, sign * dist), [0, 0, dist * 0.15]));
    } else if (kind === 'side') {
      eye = vec.add(target, vec.add(vec.scale(left, sign * dist), [0, 0, dist * 0.15]));
    } else {
      const pos = [cam.position.x, cam.position.y, cam.position.z];
      let dir = vec.sub(pos, curTarget);
      const len = Math.hypot(...dir) || 1;
      dir = vec.scale(dir, 1 / len);
      eye = vec.add(target, vec.scale(dir, dist));
    }
    if (typeof controls?.setLookAt === 'function') {
      controls.setLookAt(eye[0], eye[1], eye[2], target[0], target[1], target[2], true);
    } else {
      cam.position.set(...eye);
      cam.lookAt(...target);
      controls?.target?.set?.(...target);
      controls?.update?.();
    }
  }

  // =========================================================================
  // Phím tắt + chuột (macOS Option ⌥ & Windows Alt)
  // =========================================================================
  function isTyping(e) {
    const t = e.target;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  // Phím Blender trên canvas: G di chuyển, W xoay, S co giãn (không dùng R)
  const TRANSFORM_KEYS = { KeyG: 'G', KeyW: 'R', KeyS: 'S' };
  const NUMPAD_VIEWS = { Numpad7: 'top', Numpad1: 'front', Numpad3: 'side', NumpadDecimal: 'focus' };
  const ALT_ACTIONS = {
    KeyQ: () => togglePanel(),
    KeyM: () => toggleFullControl(),
    KeyV: () => toggleDockViews(),
    KeyN: () => toggleItemPanel(),
    KeyA: () => autoDetectAndSpan(),
    KeyS: () => smartSnap(selectedOrTarget()),
    KeyG: () => quickGroundSnap(selectedOrTarget()),
    KeyD: () => applyLWH('track'),
    KeyR: (e) => (e?.shiftKey ? alignYawCurrentFrame() : rotateTrack(180)),
    KeyK: () => setKeyframe(),
    KeyX: () => cutTrackToEnd(),
    KeyZ: () => restoreLatestSnapshot(),
    KeyF: () => cameraView('focus'),
    Backquote: () => cameraView('focus'),
    Digit1: (e) => cameraView('front', !!e?.shiftKey),
    Digit2: (e) => cameraView('top', !!e?.shiftKey),
    Digit3: (e) => cameraView('side', !!e?.shiftKey),
    Digit7: (e) => cameraView('top', !!e?.shiftKey),
  };

  function onKeyDown(e) {
    if (xf.active) return handleTransformKey(e);
    if (!document.getElementById('cvat-quicktool-wrapper')) return;
    if (fc.open && e.key === 'Escape' && !isTyping(e)) {
      swallow(e);
      if (fc.drag) fcCancelDrag();
      else closeFullControl();
      return;
    }

    if (e.altKey && !e.ctrlKey && !e.metaKey && ALT_ACTIONS[e.code]) {
      if (isTyping(e) && e.code !== 'KeyQ') return;
      swallow(e);
      if (e.repeat) return;
      guarded(ALT_ACTIONS[e.code])(e);
      return;
    }
    if (isTyping(e) || e.altKey || e.metaKey || e.repeat) return;
    if (!getSettings().blenderKeys || !pointerOverCanvas(lastMouse.x, lastMouse.y)) return;

    if (NUMPAD_VIEWS[e.code]) {
      swallow(e);
      cameraView(NUMPAD_VIEWS[e.code], e.ctrlKey || e.shiftKey);
      return;
    }
    if (!e.ctrlKey && !e.shiftKey && TRANSFORM_KEYS[e.code] && transformTargets().length) {
      swallow(e);
      startTransform(TRANSFORM_KEYS[e.code]);
    }
  }

  function installGlobalHandlers() {
    if (window.__cqtHandlers) return;
    window.__cqtHandlers = true;

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousemove', (e) => {
      lastMouse = { x: e.clientX, y: e.clientY };
      if (xf.active) updateTransform(e.ctrlKey || e.shiftKey);
    }, true);
    window.addEventListener('mousedown', (e) => {
      if (!xf.active) return;
      swallow(e);
      // macOS biến Ctrl + Click trái thành button 2 (chuột phải) => vẫn coi là xác nhận
      const isConfirm = e.button === 0 || (IS_MAC && e.button === 2 && e.ctrlKey);
      if (isConfirm) confirmTransform();
      else cancelTransform();
    }, true);
    for (const type of ['mouseup', 'click', 'contextmenu']) {
      window.addEventListener(type, (e) => {
        if (xf.active || Date.now() < swallowClicksUntil) swallow(e);
      }, true);
    }
    // Shift / Cmd + Click trên canvas hoặc danh sách object => thêm/bớt khỏi nhóm chọn
    document.addEventListener('click', async (e) => {
      if (!(e.shiftKey || e.metaKey) || e.target.closest?.('#cvat-quicktool-wrapper, #cqt-modal, #cqt-fc-window, .cqt-dock-view, #cqt-item-panel')) return;
      if (!document.getElementById('cvat-quicktool-wrapper')) return;
      // Trên canvas: bắn tia (Ray-OBB) tìm ngay cuboid dưới chuột, không chờ CVAT kích hoạt
      if (pointerOverCanvas(e.clientX, e.clientY)) {
        const hitId = await findCuboidUnderPointer(e.clientX, e.clientY);
        if (hitId !== null) return toggleSelection(hitId);
      }
      // Dự phòng: click trên sidebar, hoặc tia không trúng box nào
      setTimeout(() => {
        const id = activeId();
        if (id !== null) toggleSelection(id);
      }, 150);
    }, true);
  }

  // =========================================================================
  // Full Control Mode: Multi-Frame Orthographic + 3D Inspector & Batch Editor
  //   - Cửa sổ mở full màn, kéo 8 cạnh/góc để thu nhỏ/phóng to, kéo header để di chuyển
  //   - Mỗi frame của object = 1 hàng gồm 4 hình chiếu TOP / SIDE / FRONT / 3D (canvas 2D)
  //   - Lọc hành lang độ sâu (Slice) loại bỏ điểm của xe/cây làn bên cạnh đè vào SIDE/FRONT
  //   - Xoay trực tiếp cả 3 trục: TOP (Yaw), SIDE (Pitch), FRONT (Roll) + cột 3D (xoay góc nhìn & kéo thả box)
  //   - Kéo sửa trực tiếp; các hàng đang chọn cùng đổi (Live Multi-Edit); kéo ⤓ để Fill-Down
  //   - Chỉ ghi xuống CVAT khi nhả chuột, qua createBatch (Undo được)
  // =========================================================================
  const FC_MIN_W = 680;
  const FC_MIN_H = 420;
  const FC_HIT_PX = 7;
  const FC_YAW_HANDLE_PX = 14;
  const FC_VIEWS = ['top', 'side', 'front', '3d'];
  const FC_DEFAULTS = {
    maximized: true, x: 60, y: 50, w: 1280, h: 760,
    rowH: 155, zoom: 1, filter: 'all', fillMode: 'lwh', anchor: 'center',
    slice: 'tight', show3d: true, camAz: -0.68, camEl: 0.46,
  };
  // Cạnh của box trên từng hình chiếu: [mặt box, pháp tuyến ngoài trên màn hình (ngang, dọc lên)]
  const FC_EDGES = {
    top: [['front', 0, 1], ['back', 0, -1], ['left', -1, 0], ['right', 1, 0]],
    side: [['front', 1, 0], ['back', -1, 0], ['top', 0, 1], ['bottom', 0, -1]],
    front: [['left', 1, 0], ['right', -1, 0], ['top', 0, 1], ['bottom', 0, -1]],
  };
  const FC_BOX_EDGES_3D = [
    [0, 1], [1, 3], [3, 2], [2, 0], // mặt sau (-X)
    [0, 4], [1, 5], [2, 6], [3, 7], // 4 cạnh dọc thân
    [4, 5], [5, 7], [7, 6], [6, 4], // mặt trước (+X)
  ];
  const FC_FACE_LABEL = { front: 'mặt trước', back: 'mặt sau', left: 'sườn trái', right: 'sườn phải', top: 'nóc', bottom: 'đáy' };
  const FC_ICON_MAX = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
  const FC_ICON_RESTORE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  const ICON_SUN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  const ICON_MOON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  const pointCropCache = new Map(); // `${jobId}:${objectId}:${frame}` -> Float32Array [x, y, z, ...] (toạ độ thế giới)

  const fc = {
    open: false,
    busy: false,
    el: null,
    cfg: { ...FC_DEFAULTS },
    targetId: null,
    allRows: [], // { frame, key, outside, base, draft, ground, el, visible, camAz, camEl }
    rows: [], // allRows sau bộ lọc, đúng thứ tự hiển thị
    selected: new Set(), // frame
    lastClicked: null,
    harvesting: false,
    abort: false,
    drag: null,
    hover: null,
    extent: { l: 4.5, w: 1.9, h: 1.6 },
    observer: null,
    pending: new Set(),
    raf: 0,
  };

  function isLightTheme() {
    return getSettings().theme === 'light';
  }

  function fcPalette() {
    return isLightTheme()
      ? {
          bg: '#f8fafc',
          grid: '#e2e8f0',
          groundLine: '#64748b',
          ptGround: '#cbd5e1',
          ptAround: '#94a3b8',
          ptInside: '#059669',
          boxStroke: '#09090b',
          boxFill: 'rgba(9,9,11,0.05)',
          boxOutside: '#dc2626',
          boxOutsideFill: 'rgba(220,38,38,0.08)',
          boxFront: '#0284c7',
          boxFrontFill: 'rgba(2,132,199,0.11)',
          boxDraft: '#94a3b8',
          axis: '#3f3f46',
          handleFill: '#ffffff',
          handleHot: '#09090b',
          handleStroke: '#09090b',
          moveHandleFill: '#0284c7',
          label: '#475569',
          dims: '#475569',
          dragText: '#09090b',
        }
      : {
          bg: '#0b0b0e',
          grid: '#18181d',
          groundLine: '#71717a',
          ptGround: '#3f3f46',
          ptAround: '#71717a',
          ptInside: '#34d399',
          boxStroke: '#fafafa',
          boxFill: 'rgba(250,250,250,0.04)',
          boxOutside: '#f87171',
          boxOutsideFill: 'rgba(239,68,68,0.06)',
          boxFront: '#38bdf8',
          boxFrontFill: 'rgba(56,189,248,0.10)',
          boxDraft: '#71717a',
          axis: '#d4d4d8',
          handleFill: '#09090b',
          handleHot: '#fafafa',
          handleStroke: '#fafafa',
          moveHandleFill: '#38bdf8',
          label: '#a1a1aa',
          dims: '#a1a1aa',
          dragText: '#fafafa',
        };
  }

  function saveFcSettings(patch) {
    fc.cfg = { ...fc.cfg, ...patch };
    lsSet(LS.fcBounds, fc.cfg);
  }

  function cropKey(id, frame) {
    return `${getJob()?.id ?? 0}:${id}:${frame}`;
  }

  // ---- Toán học hình chiếu (hệ cục bộ theo yaw của box gốc: u = đầu xe, v = sườn trái, w = lên) ----
  function fcToLocal(anchor, x, y, z) {
    const c = Math.cos(anchor[5]), s = Math.sin(anchor[5]);
    const dx = x - anchor[0], dy = y - anchor[1];
    return [dx * c + dy * s, -dx * s + dy * c, z - anchor[2]];
  }

  // Điểm (lx, ly, lz) trong hệ trục 3D đầy đủ của box p (kể cả Pitch/Roll/Yaw) -> toạ độ thế giới [X, Y, Z]
  function fcBoxPoint(p, lx, ly, lz) {
    const R = rotationMatrix(p[3], p[4], p[5]);
    return [
      p[0] + R[0][0] * lx + R[0][1] * ly + R[0][2] * lz,
      p[1] + R[1][0] * lx + R[1][1] * ly + R[1][2] * lz,
      p[2] + R[2][0] * lx + R[2][1] * ly + R[2][2] * lz,
    ];
  }

  // Đọc góc nghiêng cục bộ theo hướng xe: pitch (ngóc/chúc mũi trong SIDE), roll (nghiêng sườn trong FRONT)
  function fcGetPitchRoll(p) {
    const R = rotationMatrix(p[3], p[4], p[5]);
    const nx = R[0][2], ny = R[1][2], nz = R[2][2] || 1e-6;
    const a = -nx / nz, b = -ny / nz;
    const c = Math.cos(p[5]), s = Math.sin(p[5]);
    const su = a * c + b * s;
    const sv = -a * s + b * c;
    return { pitch: Math.atan(su), roll: Math.atan(sv) };
  }

  // Ghi góc nghiêng cục bộ (pitch, roll) về lại góc Euler XYZ (rx, ry) bất biến theo Yaw
  function fcWithPitchRoll(p, pitch, roll) {
    const maxTilt = 45 * RAD;
    const su = Math.tan(clamp(pitch, -maxTilt, maxTilt));
    const sv = Math.tan(clamp(roll, -maxTilt, maxTilt));
    const c = Math.cos(p[5]), s = Math.sin(p[5]);
    const a = su * c - sv * s;
    const b = su * s + sv * c;
    const { rx, ry } = anglesForPlane({ a, b, c: 0 });
    const q = [...p];
    q[3] = rx;
    q[4] = ry;
    return q;
  }

  // (u, v, w) => [sang phải, lên trên] (mét). TOP nhìn từ trên; SIDE nhìn từ sườn phải; FRONT nhìn từ đầu xe
  function fcProject(view, u, v, w) {
    if (view === 'top') return [-v, u];
    if (view === 'side') return [u, w];
    return [v, w];
  }

  function fcUnproject(view, dh, dvert) {
    if (view === 'top') return [dvert, -dh, 0];
    if (view === 'side') return [dh, 0, dvert];
    return [0, dh, dvert];
  }

  // Chiếu 3D (u, v, w) theo góc camera (az, el) với phối cảnh nhẹ
  function fcRowCam(row) {
    return {
      az: Number.isFinite(row?.camAz) ? row.camAz : (fc.cfg.camAz ?? -0.68),
      el: Number.isFinite(row?.camEl) ? row.camEl : (fc.cfg.camEl ?? 0.46),
    };
  }

  function fcProject3D(u, v, w, az, el) {
    const ca = Math.cos(az), sa = Math.sin(az);
    const ce = Math.cos(el), se = Math.sin(el);
    const h = -u * sa + v * ca;
    const vert = -u * se * ca - v * se * sa + w * ce;
    const depth = -u * ce * ca - v * ce * sa - w * se;
    const persp = 16 / Math.max(4, 16 + depth);
    return [h * persp, vert * persp, depth];
  }

  function fcHalfExtents(view, p) {
    const L = Math.abs(p[6]) / 2, W = Math.abs(p[7]) / 2, H = Math.abs(p[8]) / 2;
    if (view === 'top') return [W, L];
    if (view === 'side') return [L, H];
    return [W, H];
  }

  function fcLocalShift(p, du, dv, dw) {
    const c = Math.cos(p[5]), s = Math.sin(p[5]);
    const q = [...p];
    q[0] += du * c - dv * s;
    q[1] += du * s + dv * c;
    q[2] += dw;
    return q;
  }

  // Kéo 1 mặt ra ngoài thêm d mét (d < 0 = thu vào), mặt đối diện đứng yên
  function fcResizeFace(p, face, d) {
    const MIN = 0.1;
    const L = Math.abs(p[6]), W = Math.abs(p[7]), H = Math.abs(p[8]);
    if (face === 'front' || face === 'back') {
      return withLWH(p, Math.max(MIN, L + d), W, H, true, face === 'front' ? 'back' : 'front');
    }
    if (face === 'left' || face === 'right') {
      return withLWH(p, L, Math.max(MIN, W + d), H, true, face === 'left' ? 'right' : 'left');
    }
    const nh = Math.max(MIN, H + d);
    if (face === 'top') return withLWH(p, L, W, nh, true, 'center');
    const q = withLWH(p, L, W, nh, false, 'center');
    q[2] = p[2] - (nh - H) / 2; // kéo đáy: giữ nguyên nóc
    return q;
  }

  function fcRotateYaw(p, dyaw) {
    const hasTilt = Math.abs(p[3]) > 1e-4 || Math.abs(p[4]) > 1e-4;
    const pr = hasTilt ? fcGetPitchRoll(p) : null;
    const q = [...p];
    q[5] = wrapPi(p[5] + dyaw);
    return pr ? fcWithPitchRoll(q, pr.pitch, pr.roll) : q;
  }

  function fcRotatePitch(p, dpitch) {
    const pr = fcGetPitchRoll(p);
    return fcWithPitchRoll(p, pr.pitch + dpitch, pr.roll);
  }

  function fcRotateRoll(p, droll) {
    const pr = fcGetPitchRoll(p);
    return fcWithPitchRoll(p, pr.pitch, pr.roll + droll);
  }

  function fcLerp(pA, pB, t) {
    const p = [...pA];
    for (const k of [0, 1, 2, 6, 7, 8]) p[k] = pA[k] + t * (pB[k] - pA[k]);
    for (const k of [3, 4, 5]) p[k] = wrapPi(pA[k] + t * wrapPi(pB[k] - pA[k]));
    return p;
  }

  // Lấy độ nghiêng (rx, ry) và cao độ đáy của box nguồn, giữ vị trí XY / yaw / LWH
  function fcCopyGround(src, p) {
    const pr = fcGetPitchRoll(src);
    const q = fcWithPitchRoll(p, pr.pitch, pr.roll);
    q[2] += bottomZ(src) - bottomZ(q);
    return q;
  }

  function fcSamePoints(a, b) {
    return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  }

  // Bao lồi 2D (monotone chain)
  function convexHull(pts) {
    const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
      upper.push(p[i]);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  // Giữ điểm trong hình trụ quanh box, đủ rộng cho estimateGroundPlane (cần ½·√(L²+W²) + 2.5 m)
  function cropPointsAroundBox(p, positions) {
    const r = 0.5 * Math.hypot(p[6], p[7]) + 3;
    const bz = bottomZ(p);
    const zLo = bz - 2.5, zHi = bz + Math.abs(p[8]) + 1.5;
    const out = [];
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const z = positions[i + 2];
      if (!(z >= zLo && z <= zHi)) continue;
      const dx = positions[i] - p[0], dy = positions[i + 1] - p[1];
      if (dx * dx + dy * dy <= r * r) out.push(positions[i], positions[i + 1], z);
    }
    return Float32Array.from(out);
  }

  // Kiểm tra điểm (eu, ev, ew) trong hệ trục cục bộ của box có nằm trong hành lang độ sâu (Slice) của view không
  function fcPassSlice(view, eu, ev, ew, hl, hw, hh) {
    const mode = fc.cfg.slice || 'tight';
    const aeu = Math.abs(eu), aev = Math.abs(ev);
    if (mode === 'inside') {
      return aeu <= hl + 0.03 && aev <= hw + 0.03 && ew >= -hh - 0.05 && ew <= hh + 0.05;
    }
    if (mode === 'wide') {
      return aeu <= hl + 1.8 && aev <= hw + 1.8 && ew >= -hh - 0.45 && ew <= hh + 1.0;
    }
    // Chế độ mặc định 'tight': cắt bỏ điểm của xe/cây ở làn bên cạnh đè vào hình chiếu SIDE / FRONT
    if (view === 'side') {
      return aev <= hw + 0.22 && aeu <= hl + 0.55 && ew >= -hh - 0.28 && ew <= hh + 0.45;
    }
    if (view === 'front') {
      return aeu <= hl + 0.22 && aev <= hw + 0.55 && ew >= -hh - 0.28 && ew <= hh + 0.45;
    }
    if (view === 'top') {
      return aeu <= hl + 0.55 && aev <= hw + 0.55 && ew >= -hh - 0.15 && ew <= hh + 0.45;
    }
    // view === '3d'
    return aeu <= hl + 0.45 && aev <= hw + 0.45 && ew >= -hh - 0.22 && ew <= hh + 0.45;
  }

  // ---- Dữ liệu track ----
  function fcRowByFrame(frame) {
    return fc.allRows.find((r) => r.frame === frame) || null;
  }

  function fcPoints(row) {
    return row.draft || row.base;
  }

  function fcCloud(row) {
    // Ô nhúng (76-dock) mang sẵn cloud của frame đang xem
    return row.cloud || pointCropCache.get(cropKey(fc.targetId, row.frame)) || null;
  }

  function fcGroundPlane(row) {
    if (row.ground === undefined) {
      const cloud = fcCloud(row);
      if (!cloud) return null;
      row.ground = estimateGroundPlane(row.base, cloud) || null;
    }
    return row.ground;
  }

  function fcSelectedRows() {
    return fc.allRows.filter((r) => fc.selected.has(r.frame) && !r.outside);
  }

  // Kéo/sửa trên 1 hàng thuộc nhóm đang chọn => áp cho cả nhóm
  function fcTargetsFor(row) {
    return fc.selected.has(row.frame) && fc.selected.size > 1 ? fcSelectedRows() : [row];
  }

  function fcAnchor() {
    return val('cqt-fc-anchor') || 'center';
  }

  function fcApplyFilter() {
    const start = intVal('cqt-frame-start'), end = intVal('cqt-frame-end');
    const hasRange = Number.isInteger(start) && Number.isInteger(end);
    fc.rows = fc.allRows.filter((r) => {
      if (fc.cfg.filter === 'key') return r.key;
      if (fc.cfg.filter === 'range' && hasRange) return r.frame >= start && r.frame <= end;
      return true;
    });
  }

  // Cùng 1 tỉ lệ m/px cho mọi hàng để so sánh trực quan giữa các frame
  function fcComputeExtent() {
    const live = fc.allRows.filter((r) => !r.outside);
    const pick = (k, def) => median(live.map((r) => Math.abs(r.base[k]))) || def;
    fc.extent = { l: pick(6, 4.5), w: pick(7, 1.9), h: pick(8, 1.6) };
  }

  async function fcLoadTrack(id = intVal('cqt-fc-target')) {
    if (!Number.isInteger(id)) id = resolveTargetId();
    if (!Number.isInteger(id)) return fail('Nhập Object ID hoặc chọn 1 object trên canvas.');
    const b = jobBounds();
    if (!b) return fail('Không đọc được dải frame của job.');
    if (fc.harvesting) {
      fc.abort = true;
      while (fc.harvesting) await sleep(50);
    }
    setStatus(`Full Control: đang đọc track #${id}...`, 'info');
    const list = await collectTrack(id, b.start, b.stop);
    if (!list.length) return fail(`Không thấy object #${id} trong job.`);
    fc.targetId = id;
    setField('cqt-fc-target', id);
    fc.allRows = list.map(({ frame, state }) => ({
      frame, key: isKey(state), outside: false, base: [...state.points], draft: null, ground: undefined, el: null, visible: false,
    }));
    fc.selected.clear();
    fc.lastClicked = null;
    fcComputeExtent();
    fcRenderList();
    await fcHarvest(false);
  }

  // Quét point cloud cho các frame chưa có trong cache (phải chuyển frame vì CVAT chỉ giữ cloud frame đang xem)
  async function fcHarvest(force) {
    const id = fc.targetId;
    if (!Number.isInteger(id) || fc.harvesting) return;
    if (force) {
      for (const r of fc.allRows) {
        pointCropCache.delete(cropKey(id, r.frame));
        r.ground = undefined;
      }
    }
    const original = getFrame();
    if (safeData()) {
      const cur = fc.allRows.find((r) => r.frame === original && !r.outside);
      const positions = getPointCloudPositions();
      if (cur && positions && !pointCropCache.has(cropKey(id, cur.frame))) {
        pointCropCache.set(cropKey(id, cur.frame), cropPointsAroundBox(cur.base, positions));
        cur.ground = undefined;
      }
      fcProgress(1, 1);
      fcRefreshAll();
      return setStatus(`Full Control #${id}: Chế độ an toàn dữ liệu — chỉ có cloud của frame đang xem (và frame đã xem trước đó), ` +
        'không tự chuyển frame để nạp cloud.', 'info');
    }
    const todo = fc.allRows
      .filter((r) => !r.outside && !pointCropCache.has(cropKey(id, r.frame)))
      .sort((a, b) => (b.frame === original) - (a.frame === original) || a.frame - b.frame);
    if (!todo.length) {
      fcProgress(1, 1);
      fcRefreshAll();
      return setStatus(`Full Control #${id}: ${fc.allRows.length} frame, cloud đã có sẵn trong cache.`, 'success');
    }

    fc.harvesting = true;
    fc.abort = false;
    fcSetHarvestUI(true);
    let prev = getPointCloudPositions(); // luôn là cloud của frame đang hiển thị
    let done = 0, missing = 0;
    try {
      for (const row of todo) {
        if (fc.abort || !fc.open) break;
        const positions = await cloudAtFrame(row.frame, prev);
        if (positions) {
          pointCropCache.set(cropKey(id, row.frame), cropPointsAroundBox(row.base, positions));
          row.ground = undefined;
          prev = positions;
          fcSchedule([row]);
        } else {
          missing++;
          prev = getPointCloudPositions();
        }
        done++;
        fcProgress(done, todo.length);
        setStatus(`Full Control: nạp cloud frame ${row.frame} (${done}/${todo.length})...`, 'info');
      }
    } finally {
      fc.harvesting = false;
      fcSetHarvestUI(false);
      if (Number.isInteger(original) && getFrame() !== original) await goToFrame(original);
    }
    fcRefreshAll();
    const stopped = done < todo.length;
    setStatus(
      `Full Control #${id}: ${stopped ? `đã dừng, nạp ${done}/${todo.length}` : `đã nạp cloud ${done}`} frame` +
      (missing ? ` — ${missing} frame không đọc được cloud.` : '.'),
      stopped || missing ? 'warn' : 'success'
    );
  }

  async function fcReloadStates() {
    const id = fc.targetId;
    if (!Number.isInteger(id)) return;
    for (const row of fc.allRows) {
      const s = await getState(id, row.frame);
      row.draft = null;
      if (!isCuboid(s)) {
        row.outside = true;
        continue;
      }
      if (!fcSamePoints(row.base, s.points)) row.ground = undefined;
      row.base = [...s.points];
      row.key = isKey(s);
      row.outside = !!s.outside;
    }
    fcRefreshAll();
  }

  // ---- Ghi xuống CVAT: mọi thao tác Full Control đều qua đây ----
  function fcSetPoints(st, next) {
    if (fcSamePoints(st.points, next)) return false;
    st.points = next;
    return true;
  }

  async function fcApply(label, rows, mutate) {
    const list = rows.filter((r) => r && !r.outside);
    if (!list.length) return fail('Chưa có frame nào để áp dụng (chọn hàng trước).');
    if (fc.busy) return fail('Đang lưu thao tác trước, thử lại sau giây lát.');
    fc.busy = true;
    try {
      const batch = createBatch(`Full Control: ${label}`);
      for (const row of list) {
        const s = await getState(fc.targetId, row.frame);
        if (!isCuboid(s)) continue;
        await batch.edit(s, row.frame, (st) => mutate(st, row));
      }
      const res = await batch.finish();
      await fcReloadStates();
      if (!res.changed) {
        setStatus(`Full Control — ${label}: không có thay đổi.`, 'info');
      } else {
        setStatus(`Full Control — ${label}: đã sửa ${res.changed} frame của #${fc.targetId}.` + editSuffix(res), res.errors ? 'warn' : 'success');
      }
      return res;
    } finally {
      fc.busy = false;
    }
  }

  async function fcSyncLWH() {
    const l = numVal('cqt-fc-l'), w = numVal('cqt-fc-w'), h = numVal('cqt-fc-h');
    if (![l, w, h].every((n) => n > 0)) return fail('Nhập đủ L / W / H (> 0) trên thanh thao tác nhóm.');
    const anchor = fcAnchor();
    return fcApply(`Đồng bộ LWH ${fmtLWH(l, w, h)}`, fcSelectedRows(), (st) => fcSetPoints(st, withLWH(st.points, l, w, h, true, anchor)));
  }

  async function fcInterpolate(rowsIn, label) {
    const rows = rowsIn.filter((r) => !r.outside).sort((a, b) => a.frame - b.frame);
    if (rows.length < 3) return fail('Cần ít nhất 3 frame (đầu, giữa, cuối) để nội suy.');
    const A = rows[0], B = rows[rows.length - 1];
    const pA = [...A.base], pB = [...B.base], span = B.frame - A.frame;
    return fcApply(label, rows.slice(1, -1), (st, row) => fcSetPoints(st, fcLerp(pA, pB, (row.frame - A.frame) / span)));
  }

  async function fcSnapRows(rows) {
    const fitSize = isChecked('cqt-fc-fitsize');
    let skipped = 0;
    const res = await fcApply(fitSize ? 'Smart Snap (fit size)' : 'Smart Snap', rows, (st, row) => {
      const cloud = fcCloud(row);
      const r = cloud ? computeSmartSnap([...st.points], cloud, fitSize, []) : null;
      if (!r || r.error) { skipped++; return false; }
      return fcSetPoints(st, r.points);
    });
    if (res && skipped) setStatus(`Smart Snap: bỏ qua ${skipped} frame (thiếu cloud hoặc < 10 điểm).`, 'warn');
  }

  async function fcGroundRows(rows) {
    let skipped = 0;
    const res = await fcApply('Fit chạm đất', rows, (st, row) => {
      const plane = fcGroundPlane(row);
      if (!plane) { skipped++; return false; }
      return fcSetPoints(st, fitToGround(st.points, plane, 'snap'));
    });
    if (res && skipped) setStatus(`Fit chạm đất: bỏ qua ${skipped} frame không đủ điểm mặt đất.`, 'warn');
  }

  function fcFlattenRows(rows) {
    return fcApply('Đặt phẳng Pitch/Roll = 0°', rows, (st) => {
      const p = [...st.points];
      const oldBz = bottomZ(p);
      p[3] = 0;
      p[4] = 0;
      p[2] = oldBz + lowestOffset(p);
      return fcSetPoints(st, p);
    });
  }

  // Quy định dự án: chỉ đặt keyframe, không gỡ
  function fcSetKeyframe(rows) {
    return fcApply('Đặt keyframe', rows, (st) => {
      if (st.objectType !== 'track' || st.keyframe) return false;
      st.keyframe = true;
      return true;
    });
  }

  function fcSetOutside(rows) {
    if (!rows.length) return fail('Chọn hàng (frame) trước.');
    if (!confirm(`Đặt outside cho ${rows.length} frame của #${fc.targetId}?`)) return null;
    return fcApply('Đặt outside', rows, (st) => {
      if (st.objectType !== 'track' || st.outside) return false;
      st.outside = true;
      return true;
    });
  }

  async function fcFillDown(fromRow, toRow) {
    const i0 = fc.rows.indexOf(fromRow), i1 = fc.rows.indexOf(toRow);
    if (i0 < 0 || i1 < 0 || i0 === i1) return null;
    const span = fc.rows.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
    const targets = span.filter((r) => r !== fromRow);
    const src = [...fromRow.base];
    const mode = val('cqt-fc-fillmode') || 'lwh';
    if (mode === 'interp') return fcInterpolate(span, `Nội suy f${span[0].frame} → f${span[span.length - 1].frame}`);
    if (mode === 'ground') return fcApply(`Kéo đáy & nghiêng từ f${fromRow.frame}`, targets, (st) => fcSetPoints(st, fcCopyGround(src, st.points)));
    if (mode === 'yaw') {
      return fcApply(`Kéo góc Yaw ${(src[5] * DEG).toFixed(1)}° từ f${fromRow.frame}`, targets, (st) => {
        const delta = wrapPi(src[5] - st.points[5]);
        return fcSetPoints(st, fcRotateYaw(st.points, delta));
      });
    }
    const [l, w, h] = [Math.abs(src[6]), Math.abs(src[7]), Math.abs(src[8])];
    const anchor = fcAnchor();
    return fcApply(`Kéo LWH ${fmtLWH(l, w, h)} từ f${fromRow.frame}`, targets, (st) => fcSetPoints(st, withLWH(st.points, l, w, h, true, anchor)));
  }

  async function fcOnRowInput(row, input) {
    const v = parseFloat(input.value);
    const k = input.dataset.k;
    const isAngle = k === 'yaw' || k === 'pitch' || k === 'roll';
    if (!Number.isFinite(v) || (!isAngle && v <= 0)) return fcUpdateRowMeta(row);
    const targets = fcTargetsFor(row);
    if (k === 'yaw') {
      return fcApply(`Yaw = ${v}°`, targets, (st) => {
        const dyaw = wrapPi(v * RAD - st.points[5]);
        return fcSetPoints(st, fcRotateYaw(st.points, dyaw));
      });
    }
    if (k === 'pitch') {
      return fcApply(`Pitch = ${v}°`, targets, (st) => {
        const pr = fcGetPitchRoll(st.points);
        return fcSetPoints(st, fcWithPitchRoll(st.points, v * RAD, pr.roll));
      });
    }
    if (k === 'roll') {
      return fcApply(`Roll = ${v}°`, targets, (st) => {
        const pr = fcGetPitchRoll(st.points);
        return fcSetPoints(st, fcWithPitchRoll(st.points, pr.pitch, v * RAD));
      });
    }
    const anchor = fcAnchor();
    return fcApply(`${k.toUpperCase()} = ${v.toFixed(2)} m`, targets, (st) => {
      const p = st.points;
      const L = k === 'l' ? v : Math.abs(p[6]);
      const W = k === 'w' ? v : Math.abs(p[7]);
      const H = k === 'h' ? v : Math.abs(p[8]);
      return fcSetPoints(st, withLWH(p, L, W, H, true, anchor));
    });
  }

  // ---- Vẽ ----
  function fcViewGeom(canvas, view) {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    const { l, w, h } = canvas._extent || fc.extent; // ô nhúng: tỉ lệ theo chính box đang xem
    const zoom = canvas._zoom ?? fc.cfg.zoom;
    if (view === '3d') {
      const diag = Math.hypot(l, w, h) + 2.2;
      return { cw, ch, cx: cw / 2, cy: ch / 2, k: Math.min(cw / diag, ch / (diag * 0.78)) * zoom };
    }
    const m = 1.2;
    const ew = view === 'side' ? l + 2 * m : w + 2 * m;
    const eh = view === 'top' ? l + 2 * m : h + 2 * m;
    return { cw, ch, cx: cw / 2, cy: ch / 2, k: Math.min(cw / ew, ch / eh) * zoom };
  }

  // Toạ độ núm tròn xoay trên màn hình cho TOP (Yaw), SIDE (Pitch), FRONT (Roll)
  function fcRotHandleScreen(row, view, g) {
    const anchor = row.base;
    const p = fcPoints(row);
    const hl = Math.abs(p[6]) / 2, hh = Math.abs(p[8]) / 2;
    const pad = FC_YAW_HANDLE_PX / Math.max(g.k, 1);
    const toScr = ([x, y, z]) => {
      const [u, v, w] = fcToLocal(anchor, x, y, z);
      const [h, vert] = fcProject(view, u, v, w);
      return [g.cx + h * g.k, g.cy - vert * g.k];
    };
    const center = toScr([p[0], p[1], p[2]]);
    if (view === 'front') {
      const edge = toScr(fcBoxPoint(p, 0, 0, hh));
      const handle = toScr(fcBoxPoint(p, 0, 0, hh + pad));
      return { center, edge, handle, kind: 'roll' };
    }
    const edge = toScr(fcBoxPoint(p, hl, 0, 0));
    const handle = toScr(fcBoxPoint(p, hl + pad, 0, 0));
    return { center, edge, handle, kind: view === 'top' ? 'yaw' : 'pitch' };
  }

  // Toạ độ núm kéo tâm 3D & núm xoay Yaw 3D trên màn hình
  function fc3DHandlesScreen(row, g) {
    const anchor = row.base;
    const p = fcPoints(row);
    const { az, el } = fcRowCam(row);
    const hl = Math.abs(p[6]) / 2;
    const pad = (FC_YAW_HANDLE_PX + 2) / Math.max(g.k, 1);
    const toScr = ([x, y, z]) => {
      const [u, v, w] = fcToLocal(anchor, x, y, z);
      const [h, vert] = fcProject3D(u, v, w, az, el);
      return [g.cx + h * g.k, g.cy - vert * g.k];
    };
    return {
      center: toScr([p[0], p[1], p[2]]),
      frontFace: toScr(fcBoxPoint(p, hl, 0, 0)),
      yawHandle: toScr(fcBoxPoint(p, hl + pad, 0, 0)),
    };
  }

  function fcStrokePoly(ctx, pts, color, width, dash) {
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function fcRender3D(row, canvas, g, pal) {
    const ctx = canvas.getContext('2d');
    const anchor = row.base;
    const p = fcPoints(row);
    const { az, el } = fcRowCam(row);
    const toScreen3D = (x, y, z) => {
      const [u, v, w] = fcToLocal(anchor, x, y, z);
      const [h, vert] = fcProject3D(u, v, w, az, el);
      return [g.cx + h * g.k, g.cy - vert * g.k];
    };

    // Lưới mặt phẳng đáy 3D quanh tâm box gốc
    const wGround = bottomZ(anchor) - anchor[2];
    const gridSpan = Math.ceil(Math.max(fc.extent.l, fc.extent.w) * 0.75) + 1;
    ctx.beginPath();
    for (let t = -gridSpan; t <= gridSpan; t += 1) {
      const [h0, v0] = fcProject3D(t, -gridSpan, wGround, az, el);
      const [h1, v1] = fcProject3D(t, gridSpan, wGround, az, el);
      ctx.moveTo(g.cx + h0 * g.k, g.cy - v0 * g.k);
      ctx.lineTo(g.cx + h1 * g.k, g.cy - v1 * g.k);
      const [h2, v2] = fcProject3D(-gridSpan, t, wGround, az, el);
      const [h3, v3] = fcProject3D(gridSpan, t, wGround, az, el);
      ctx.moveTo(g.cx + h2 * g.k, g.cy - v2 * g.k);
      ctx.lineTo(g.cx + h3 * g.k, g.cy - v3 * g.k);
    }
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Point cloud 3D (lọc theo hành lang Slice để dễ nhìn xung quanh xe)
    const cloud = fcCloud(row);
    const plane = fcGroundPlane(row);
    if (cloud) {
      const ac = Math.cos(anchor[5]), as = Math.sin(anchor[5]);
      const R = rotationMatrix(p[3], p[4], p[5]);
      const hl = Math.abs(p[6]) / 2, hw = Math.abs(p[7]) / 2, hh = Math.abs(p[8]) / 2;
      const inside = new Path2D(), around = new Path2D(), ground = new Path2D();
      const sz = g.k > 42 ? 2 : 1.5;
      for (let i = 0; i + 2 < cloud.length; i += 3) {
        const x = cloud[i], y = cloud[i + 1], z = cloud[i + 2];
        const ex = x - p[0], ey = y - p[1], ez = z - p[2];
        const eu = R[0][0] * ex + R[1][0] * ey + R[2][0] * ez;
        const ev = R[0][1] * ex + R[1][1] * ey + R[2][1] * ez;
        const ew = R[0][2] * ex + R[1][2] * ey + R[2][2] * ez;
        if (!fcPassSlice('3d', eu, ev, ew, hl, hw, hh)) continue;
        const dx = x - anchor[0], dy = y - anchor[1];
        const [h, vert] = fcProject3D(dx * ac + dy * as, -dx * as + dy * ac, z - anchor[2], az, el);
        const sx = g.cx + h * g.k, sy = g.cy - vert * g.k;
        if (sx < 0 || sy < 0 || sx > g.cw || sy > g.ch) continue;
        const isIn = Math.abs(eu) <= hl && Math.abs(ev) <= hw && Math.abs(ew) <= hh;
        const target = isIn ? inside : plane && z - planeZ(plane, x, y) < 0.12 ? ground : around;
        target.rect(sx - sz / 2, sy - sz / 2, sz, sz);
      }
      ctx.fillStyle = pal.ptGround;
      ctx.fill(ground);
      ctx.fillStyle = pal.ptAround;
      ctx.fill(around);
      ctx.fillStyle = pal.ptInside;
      ctx.fill(inside);
    }

    // Khung dây 12 cạnh của hộp 3D (mặt trước +X tô nổi màu xanh lam/cyan để phân biệt rõ đầu xe)
    const drawWireBox = (pts, strokeCol, frontCol, dash) => {
      const c2d = boxCorners(pts).map(([x, y, z]) => toScreen3D(x, y, z));
      if (!dash) {
        // Tô mờ mặt trước (+X: đỉnh 4, 5, 7, 6)
        ctx.beginPath();
        [4, 5, 7, 6].forEach((idx, i) => (i ? ctx.lineTo(c2d[idx][0], c2d[idx][1]) : ctx.moveTo(c2d[idx][0], c2d[idx][1])));
        ctx.closePath();
        ctx.fillStyle = pal.boxFrontFill;
        ctx.fill();
      }
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const [a, b] = FC_BOX_EDGES_3D[i];
        ctx.moveTo(c2d[a][0], c2d[a][1]);
        ctx.lineTo(c2d[b][0], c2d[b][1]);
      }
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = dash ? 1 : 1.2;
      ctx.stroke();

      ctx.beginPath();
      for (let i = 8; i < 12; i++) {
        const [a, b] = FC_BOX_EDGES_3D[i];
        ctx.moveTo(c2d[a][0], c2d[a][1]);
        ctx.lineTo(c2d[b][0], c2d[b][1]);
      }
      ctx.strokeStyle = frontCol || strokeCol;
      ctx.lineWidth = dash ? 1 : 1.65;
      ctx.stroke();
      ctx.setLineDash([]);
    };

    if (row.draft) drawWireBox(anchor, pal.boxDraft, pal.boxDraft, [4, 3]);
    drawWireBox(p, row.outside ? pal.boxOutside : pal.boxStroke, row.outside ? pal.boxOutside : pal.boxFront, null);

    // Mũi tên hướng đầu xe + Núm xoay Yaw 3D (●) + Núm kéo dịch 3D ở tâm (◉)
    if (!row.outside) {
      const { center, yawHandle } = fc3DHandlesScreen(row, g);
      const hoverKind = fc.hover?.row === row && fc.hover.view === '3d' ? fc.hover.hit.kind : null;

      ctx.beginPath();
      ctx.moveTo(center[0], center[1]);
      ctx.lineTo(yawHandle[0], yawHandle[1]);
      ctx.strokeStyle = pal.boxFront;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Núm xoay Yaw 3D ở mũi xe
      const hotYaw = hoverKind === 'yaw3d';
      ctx.beginPath();
      ctx.arc(yawHandle[0], yawHandle[1], hotYaw ? 6 : 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = hotYaw ? pal.boxFront : pal.handleFill;
      ctx.fill();
      ctx.strokeStyle = pal.boxFront;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Núm kéo dịch 3D ở tâm hộp (◉)
      const hotMove = hoverKind === 'move3d';
      ctx.beginPath();
      ctx.arc(center[0], center[1], hotMove ? 7.5 : 6, 0, 2 * Math.PI);
      ctx.fillStyle = hotMove ? pal.moveHandleFill : pal.handleFill;
      ctx.fill();
      ctx.strokeStyle = pal.moveHandleFill;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(center[0], center[1], 2.2, 0, 2 * Math.PI);
      ctx.fillStyle = hotMove ? pal.handleFill : pal.moveHandleFill;
      ctx.fill();
    }

    // Nhãn & trạng thái góc nhìn 3D
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = pal.label;
    ctx.fillText('3D · Kéo tâm ◉ dịch · Kéo nền xoay', 6, 13);
    ctx.fillStyle = pal.dims;
    ctx.fillText(`Góc ${(az * DEG).toFixed(0)}° / ${(el * DEG).toFixed(0)}° · Shift+Kéo ◉ = cao độ Z`, 6, g.ch - 6);
    const d = fc.drag;
    if (d && (d.type === 'edit' || d.type === 'orbit3d') && d.row === row && d.view === '3d' && d.text) {
      ctx.fillStyle = pal.dragText;
      ctx.textAlign = 'right';
      ctx.fillText(d.text, g.cw - 6, 13);
      ctx.textAlign = 'left';
    }
  }

  function fcRenderView(row, canvas) {
    const view = canvas.dataset.view;
    if (view === '3d' && !fc.cfg.show3d) return;
    const g = fcViewGeom(canvas, view);
    if (g.cw < 4 || g.ch < 4) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(g.cw * dpr), bh = Math.round(g.ch * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pal = fcPalette();
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, g.cw, g.ch);

    if (view === '3d') return fcRender3D(row, canvas, g, pal);

    const anchor = row.base;
    const p = fcPoints(row);
    const toScreen = (x, y, z) => {
      const [u, v, w] = fcToLocal(anchor, x, y, z);
      const [h, vert] = fcProject(view, u, v, w);
      return [g.cx + h * g.k, g.cy - vert * g.k];
    };

    // Lưới 1 m quanh tâm box gốc
    if (g.k >= 6) {
      ctx.beginPath();
      for (let x = g.cx % g.k; x < g.cw; x += g.k) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, g.ch); }
      for (let y = g.cy % g.k; y < g.ch; y += g.k) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(g.cw, Math.round(y) + 0.5); }
      ctx.strokeStyle = pal.grid;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Đường mặt đất (SIDE / FRONT)
    const plane = fcGroundPlane(row);
    if (plane && view !== 'top') {
      const c = Math.cos(anchor[5]), s = Math.sin(anchor[5]);
      const span = g.cw / 2 / g.k + 1;
      const at = (t) => {
        const [u, v] = view === 'side' ? [t, 0] : [0, t];
        const x = anchor[0] + u * c - v * s, y = anchor[1] + u * s + v * c;
        return toScreen(x, y, planeZ(plane, x, y));
      };
      const [x0, y0] = at(-span), [x1, y1] = at(span);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = pal.groundLine;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Point cloud: lọc hành lang độ sâu (Slice) + phân loại trong box (sáng) / mặt đất / xung quanh
    const cloud = fcCloud(row);
    if (cloud) {
      const ac = Math.cos(anchor[5]), as = Math.sin(anchor[5]);
      const R = rotationMatrix(p[3], p[4], p[5]);
      const hl = Math.abs(p[6]) / 2, hw = Math.abs(p[7]) / 2, hh = Math.abs(p[8]) / 2;
      const inside = new Path2D(), around = new Path2D(), ground = new Path2D();
      const sz = g.k > 60 ? 2 : 1.5;
      let nIn = 0;
      for (let i = 0; i + 2 < cloud.length; i += 3) {
        const x = cloud[i], y = cloud[i + 1], z = cloud[i + 2];
        const ex = x - p[0], ey = y - p[1], ez = z - p[2];
        const eu = R[0][0] * ex + R[1][0] * ey + R[2][0] * ez;
        const ev = R[0][1] * ex + R[1][1] * ey + R[2][1] * ez;
        const ew = R[0][2] * ex + R[1][2] * ey + R[2][2] * ez;
        const isIn = Math.abs(eu) <= hl && Math.abs(ev) <= hw && Math.abs(ew) <= hh;
        if (isIn && view === 'top') nIn++;
        if (!isIn && !fcPassSlice(view, eu, ev, ew, hl, hw, hh)) continue;
        const dx = x - anchor[0], dy = y - anchor[1];
        const [h, vert] = fcProject(view, dx * ac + dy * as, -dx * as + dy * ac, z - anchor[2]);
        const sx = g.cx + h * g.k, sy = g.cy - vert * g.k;
        if (sx < 0 || sy < 0 || sx > g.cw || sy > g.ch) continue;
        const target = isIn ? inside : plane && z - planeZ(plane, x, y) < 0.12 ? ground : around;
        target.rect(sx - sz / 2, sy - sz / 2, sz, sz);
      }
      ctx.fillStyle = pal.ptGround;
      ctx.fill(ground);
      ctx.fillStyle = pal.ptAround;
      ctx.fill(around);
      ctx.fillStyle = pal.ptInside;
      ctx.fill(inside);
      if (view === 'top') row.pointsIn = nIn;
    }

    // Box: bóng mờ vị trí gốc khi đang kéo + khung hiện tại
    const hullOf = (pts) => convexHull(boxCorners(pts).map(([x, y, z]) => toScreen(x, y, z)));
    if (row.draft) fcStrokePoly(ctx, hullOf(anchor), pal.boxDraft, 1, [4, 3]);
    const hull = hullOf(p);
    if (hull.length >= 3) {
      ctx.beginPath();
      hull.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = row.outside ? pal.boxOutsideFill : pal.boxFill;
      ctx.fill();
    }
    fcStrokePoly(ctx, hull, row.outside ? pal.boxOutside : pal.boxStroke, 1.25);

    // Đường trục hướng & Núm tròn xoay cho cả 3 hình chiếu: TOP (Yaw), SIDE (Pitch), FRONT (Roll)
    const { center: [ccx, ccy], edge: [fx, fy], handle: [hx, hy], kind: rotKind } = fcRotHandleScreen(row, view, g);
    if (view === 'front') {
      ctx.beginPath();
      ctx.arc(ccx, ccy, 3.5, 0, 2 * Math.PI);
      ctx.strokeStyle = pal.axis;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(ccx, ccy);
    ctx.lineTo(fx, fy);
    ctx.strokeStyle = pal.axis;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (!row.outside) {
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      const hot = fc.hover?.row === row && fc.hover.view === view && fc.hover.hit.kind === rotKind;
      ctx.beginPath();
      ctx.arc(hx, hy, hot ? 6 : 4.5, 0, 2 * Math.PI);
      ctx.fillStyle = hot ? pal.handleHot : pal.handleFill;
      ctx.fill();
      ctx.strokeStyle = pal.handleStroke;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }

    // Cạnh đang trỏ chuột
    const hover = fc.hover?.row === row && fc.hover.view === view && !row.draft ? fc.hover.hit : null;
    if (hover && (hover.kind === 'face' || hover.kind === 'move')) {
      const [ehx, ehv] = fcHalfExtents(view, anchor);
      const x0 = g.cx - ehx * g.k, x1 = g.cx + ehx * g.k, y0 = g.cy - ehv * g.k, y1 = g.cy + ehv * g.k;
      ctx.strokeStyle = pal.boxStroke;
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (hover.kind === 'move') {
        ctx.fillStyle = pal.boxFill;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      } else if (hover.nh) {
        const x = hover.nh > 0 ? x1 : x0;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      } else {
        const y = hover.nv > 0 ? y0 : y1;
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      }
      ctx.stroke();
    }

    // Nhãn
    const pr = fcGetPitchRoll(p);
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = pal.label;
    const viewTitle = view === 'top' ? `TOP · Yaw ${(p[5] * DEG).toFixed(1)}°`
      : view === 'side' ? `SIDE · Pitch ${(pr.pitch * DEG).toFixed(1)}°`
        : `FRONT · Roll ${(pr.roll * DEG).toFixed(1)}°`;
    ctx.fillText(viewTitle, 6, 13);
    const dims = view === 'top' ? `L ${Math.abs(p[6]).toFixed(2)} · W ${Math.abs(p[7]).toFixed(2)}`
      : view === 'side' ? `L ${Math.abs(p[6]).toFixed(2)} · H ${Math.abs(p[8]).toFixed(2)}`
        : `W ${Math.abs(p[7]).toFixed(2)} · H ${Math.abs(p[8]).toFixed(2)}`;
    ctx.fillStyle = pal.dims;
    ctx.fillText(dims, 6, g.ch - 6);
    const d = fc.drag;
    if (d?.type === 'edit' && d.row === row && d.view === view && d.text) {
      ctx.fillStyle = pal.dragText;
      ctx.textAlign = 'right';
      ctx.fillText(d.text, g.cw - 6, 13);
      ctx.textAlign = 'left';
    }
  }

  function fcRenderRow(row) {
    if (!row.visible || !row.el) return;
    fcGroundPlane(row);
    for (const canvas of row.el.querySelectorAll('canvas')) fcRenderView(row, canvas);
    fcUpdateRowMeta(row);
  }

  function fcSchedule(rows) {
    for (const r of rows) if (r?.visible) fc.pending.add(r);
    if (fc.raf || !fc.pending.size) return;
    fc.raf = requestAnimationFrame(() => {
      fc.raf = 0;
      const list = [...fc.pending];
      fc.pending.clear();
      for (const r of list) fcRenderRow(r);
    });
  }

  function fcRerenderVisible() {
    fcSchedule(fc.rows.filter((r) => r.visible));
  }

  // ---- DOM danh sách ----
  function fcRowHTML(row) {
    const num = (k, step) => `<input class="cqt-input" type="number" step="${step}" data-k="${k}" />`;
    return `
      <div class="cqt-fc-cell cqt-fc-meta">
        <div class="cqt-fc-sel" data-act="select" title="Bấm để chọn · Kéo dọc để chọn nhiều frame · Shift = chọn dải · Cmd/Ctrl = thêm/bớt">
          <span class="cqt-fc-check"></span>
          <span class="cqt-fc-frame">F ${row.frame}</span>
          <span class="cqt-badge" data-role="kf"></span>
        </div>
        <div class="cqt-fc-actions">
          <button class="cqt-btn cqt-btn-secondary cqt-sm" data-act="goto" title="Chuyển CVAT tới frame này">Tới</button>
          <button class="cqt-btn cqt-btn-secondary cqt-sm" data-act="key" title="Đặt keyframe tại frame này (không gỡ keyframe)">+Key</button>
        </div>
        <div class="cqt-fc-fill" data-act="fill" title="Nhấn giữ rồi kéo xuống (hoặc lên) để áp dụng theo chế độ &quot;Kéo ⤓&quot;">⤓ Kéo áp dụng</div>
      </div>
      ${FC_VIEWS.map((v) => `<div class="cqt-fc-cell cqt-fc-view" data-view-cell="${v}"><canvas data-view="${v}"></canvas></div>`).join('')}
      <div class="cqt-fc-cell cqt-fc-params">
        <div class="cqt-fc-grid4">
          <label title="Chiều dài L (m)">L${num('l', '0.01')}</label>
          <label title="Chiều rộng W (m)">W${num('w', '0.01')}</label>
          <label title="Chiều cao H (m)">H${num('h', '0.01')}</label>
          <label title="Góc hướng đầu xe Yaw (°)">Yaw${num('yaw', '0.5')}</label>
          <label title="Góc ngóc/chúc mũi xe Pitch (°) — xoay trên cột Side">Pitch${num('pitch', '0.5')}</label>
          <label title="Góc nghiêng sườn xe Roll (°) — xoay trên cột Front">Roll${num('roll', '0.5')}</label>
        </div>
        <div class="cqt-fc-info" data-role="info"></div>
        <div class="cqt-fc-actions">
          <button class="cqt-btn cqt-btn-secondary cqt-sm" data-act="snap" title="Smart Snap theo cloud của frame này (hoặc cả nhóm đang chọn)">Snap</button>
          <button class="cqt-btn cqt-btn-secondary cqt-sm" data-act="ground" title="Hạ chạm đất theo cloud của frame này (hoặc cả nhóm đang chọn)">Chạm đất</button>
          <button class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" data-act="flat" title="Đặt phẳng Pitch = Roll = 0° (giữ đáy)">0°</button>
        </div>
      </div>`;
  }

  function fcRenderList() {
    const list = $('cqt-fc-list');
    if (!list) return;
    fcApplyFilter();
    fc.observer?.disconnect();
    fc.pending.clear();
    for (const r of fc.allRows) {
      r.el = null;
      r.visible = false;
    }
    list.textContent = '';
    if (!fc.rows.length) {
      const empty = document.createElement('div');
      empty.className = 'cqt-fc-empty';
      empty.textContent = fc.allRows.length
        ? 'Không có frame nào khớp bộ lọc hiện tại.'
        : 'Nhập Object ID (hoặc bấm "Lấy đang chọn") rồi bấm "Nạp Track" để hiện mọi frame của object.';
      list.appendChild(empty);
      return fcUpdateBars();
    }
    const frag = document.createDocumentFragment();
    for (const row of fc.rows) {
      const el = document.createElement('div');
      el.className = 'cqt-fc-row';
      el.dataset.frame = String(row.frame);
      el.innerHTML = fcRowHTML(row);
      row.el = el;
      frag.appendChild(el);
    }
    list.appendChild(frag);
    fc.observer = new IntersectionObserver(fcOnIntersect, { root: list, rootMargin: '300px 0px' });
    for (const row of fc.rows) {
      fcUpdateRowMeta(row);
      fc.observer.observe(row.el);
    }
    fcUpdateBars();
  }

  // Chỉ vẽ hàng gần vùng nhìn thấy; hàng khuất được giải phóng bộ nhớ canvas
  function fcOnIntersect(entries) {
    for (const en of entries) {
      const row = fcRowByFrame(Number(en.target.dataset.frame));
      if (!row) continue;
      row.visible = en.isIntersecting;
      if (row.visible) {
        fcSchedule([row]);
      } else {
        for (const c of en.target.querySelectorAll('canvas')) {
          c.width = 0;
          c.height = 0;
        }
      }
    }
  }

  function fcUpdateRowMeta(row) {
    const el = row.el;
    if (!el) return;
    const p = fcPoints(row);
    const pr = fcGetPitchRoll(p);
    el.classList.toggle('selected', fc.selected.has(row.frame));
    el.classList.toggle('outside', !!row.outside);
    el.classList.toggle('current', row.frame === getFrame());
    const kf = el.querySelector('[data-role="kf"]');
    kf.textContent = row.outside ? 'OUT' : row.key ? 'KEY' : 'LERP';
    kf.className = 'cqt-badge ' + (row.outside ? 'cqt-badge-out' : row.key ? 'cqt-badge-key' : 'cqt-badge-lerp');
    const values = {
      l: Math.abs(p[6]).toFixed(2),
      w: Math.abs(p[7]).toFixed(2),
      h: Math.abs(p[8]).toFixed(2),
      yaw: (p[5] * DEG).toFixed(1),
      pitch: (pr.pitch * DEG).toFixed(1),
      roll: (pr.roll * DEG).toFixed(1),
    };
    for (const input of el.querySelectorAll('input[data-k]')) {
      if (document.activeElement !== input) input.value = values[input.dataset.k];
    }
    const cloud = fcCloud(row);
    const plane = row.ground || null;
    const gap = plane ? groundGap(p, plane) : null;
    el.querySelector('[data-role="info"]').textContent =
      `x ${p[0].toFixed(2)}  y ${p[1].toFixed(2)}  z ${p[2].toFixed(2)}\n` +
      (gap === null ? (cloud ? 'Đáy: chưa đo được mặt đất' : 'Đáy: chưa có cloud') : `Đáy lệch đất ${fmtSigned(gap, 3)} m`) +
      (cloud ? ` · ${row.pointsIn ?? 0} điểm` : '');
  }

  function fcRefreshAll() {
    for (const row of fc.rows) fcUpdateRowMeta(row);
    fcRerenderVisible();
    fcUpdateBars();
  }

  function fcUpdateBars() {
    if (!fc.el) return;
    const start = intVal('cqt-frame-start'), end = intVal('cqt-frame-end');
    const hasRange = Number.isInteger(start) && Number.isInteger(end);
    const counts = {
      all: fc.allRows.length,
      key: fc.allRows.filter((r) => r.key).length,
      range: hasRange ? fc.allRows.filter((r) => r.frame >= start && r.frame <= end).length : 0,
    };
    fc.el.querySelectorAll('[data-count]').forEach((s) => { s.textContent = String(counts[s.dataset.count]); });
    fc.el.querySelectorAll('[data-fc-filter]').forEach((b) => b.classList.toggle('active', b.dataset.fcFilter === fc.cfg.filter));
    const sel = $('cqt-fc-selcount');
    if (sel) sel.textContent = String(fc.selected.size);
    const btn3d = $('cqt-fc-toggle-3d');
    if (btn3d) btn3d.classList.toggle('active', !!fc.cfg.show3d);
    fc.el.classList.toggle('hide-3d', !fc.cfg.show3d);
  }

  function fcUpdateSelectionUI() {
    for (const row of fc.rows) row.el?.classList.toggle('selected', fc.selected.has(row.frame));
    const ref = fcRowByFrame(fc.lastClicked);
    if (ref) {
      setField('cqt-fc-l', Math.abs(ref.base[6]).toFixed(2));
      setField('cqt-fc-w', Math.abs(ref.base[7]).toFixed(2));
      setField('cqt-fc-h', Math.abs(ref.base[8]).toFixed(2));
    }
    fcUpdateBars();
  }

  function fcSelectRange(fromFrame, toFrame, baseSet) {
    const i0 = fc.rows.findIndex((r) => r.frame === fromFrame);
    const i1 = fc.rows.findIndex((r) => r.frame === toFrame);
    if (i0 < 0 || i1 < 0) return;
    for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) {
      if (!fc.rows[i].outside) baseSet.add(fc.rows[i].frame);
    }
    fc.selected = baseSet;
  }

  function fcSelectClick(row, e) {
    const additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey && fc.lastClicked !== null) {
      fcSelectRange(fc.lastClicked, row.frame, additive ? new Set(fc.selected) : new Set());
    } else if (additive) {
      if (fc.selected.has(row.frame)) fc.selected.delete(row.frame);
      else fc.selected.add(row.frame);
      fc.lastClicked = row.frame;
    } else {
      fc.selected = new Set([row.frame]);
      fc.lastClicked = row.frame;
    }
    fcUpdateSelectionUI();
  }

  function fcProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 100;
    const bar = $('cqt-fc-progress-bar');
    if (bar) bar.style.width = `${pct}%`;
    const text = $('cqt-fc-progress-text');
    if (text) text.textContent = `${pct}%`;
  }

  function fcSetHarvestUI(on) {
    const stop = $('cqt-fc-stop');
    if (stop) stop.style.display = on ? '' : 'none';
    const rescan = $('cqt-fc-rescan');
    if (rescan) rescan.disabled = on;
  }

  // ---- Kéo chuột: sửa box, xoay góc, cột 3D, chọn dải, Fill-Down, đổi kích thước & di chuyển cửa sổ ----
  function fcHitTest(row, canvas, mx, my) {
    const view = canvas.dataset.view;
    const g = fcViewGeom(canvas, view);
    if (view === '3d') {
      if (!row.outside) {
        const { center, yawHandle } = fc3DHandlesScreen(row, g);
        if (Math.hypot(mx - center[0], my - center[1]) <= 9) return { kind: 'move3d' };
        if (Math.hypot(mx - yawHandle[0], my - yawHandle[1]) <= 8.5) return { kind: 'yaw3d' };
      }
      return { kind: 'orbit3d' };
    }
    if (row.outside) return null;
    const { handle: [rhx, rhy], kind: rotKind } = fcRotHandleScreen(row, view, g);
    if (Math.hypot(mx - rhx, my - rhy) <= 8.5) return { kind: rotKind };
    const [hx, hv] = fcHalfExtents(view, row.base);
    const x0 = g.cx - hx * g.k, x1 = g.cx + hx * g.k, y0 = g.cy - hv * g.k, y1 = g.cy + hv * g.k;
    const T = FC_HIT_PX;
    const inX = mx >= x0 - T && mx <= x1 + T, inY = my >= y0 - T && my <= y1 + T;
    let best = null, bestD = T;
    for (const [face, nh, nv] of FC_EDGES[view]) {
      if (nh ? !inY : !inX) continue;
      const d = nh ? Math.abs(mx - (nh > 0 ? x1 : x0)) : Math.abs(my - (nv > 0 ? y0 : y1));
      if (d <= bestD) {
        bestD = d;
        best = { kind: 'face', face, nh, nv };
      }
    }
    if (best) return best;
    return mx > x0 && mx < x1 && my > y0 && my < y1 ? { kind: 'move' } : null;
  }

  function fcHitCursor(hit) {
    if (!hit) return 'default';
    if (hit.kind === 'move' || hit.kind === 'move3d') return 'move';
    if (hit.kind === 'yaw' || hit.kind === 'pitch' || hit.kind === 'roll' || hit.kind === 'yaw3d' || hit.kind === 'orbit3d') return 'grab';
    return hit.nh ? 'ew-resize' : 'ns-resize';
  }

  function fcRowAtPoint(x, y) {
    const el = document.elementFromPoint(x, y)?.closest?.('.cqt-fc-row');
    return el ? fcRowByFrame(Number(el.dataset.frame)) : null;
  }

  function fcAutoScroll(y) {
    const list = $('cqt-fc-list');
    if (!list) return;
    const r = list.getBoundingClientRect();
    if (y < r.top + 36) list.scrollTop -= 18;
    else if (y > r.bottom - 36) list.scrollTop += 18;
  }

  function fcStartCanvasDrag(e, row, canvas) {
    const rect = canvas.getBoundingClientRect();
    const hit = fcHitTest(row, canvas, e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return fcSelectClick(row, e);
    e.preventDefault();
    const view = canvas.dataset.view;
    if (hit.kind === 'orbit3d') {
      const cam = fcRowCam(row);
      fc.hover = null;
      fc.drag = {
        type: 'orbit3d', row, view: '3d', sx: e.clientX, sy: e.clientY,
        az0: cam.az, el0: cam.el, singleRow: !!e.altKey, moved: false, text: '',
      };
      return;
    }
    if (!fc.selected.has(row.frame)) {
      fc.selected = new Set([row.frame]);
      fc.lastClicked = row.frame;
      fcUpdateSelectionUI();
    }
    const g = fcViewGeom(canvas, view);
    const cam = fcRowCam(row);
    fc.hover = null;
    fc.drag = {
      type: 'edit', row, view, hit, targets: fcTargetsFor(row), k: g.k,
      sx: e.clientX, sy: e.clientY, cx: rect.left + g.cx, cy: rect.top + g.cy,
      az: cam.az, el: cam.el, moved: false, text: '',
    };
  }

  function fcDragOrbit3D(e) {
    const d = fc.drag;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 2) return;
    d.moved = true;
    const az = wrapPi(d.az0 - (e.clientX - d.sx) * 0.011);
    const el = clamp(d.el0 + (e.clientY - d.sy) * 0.009, -0.35, 1.48);
    d.text = `${(az * DEG).toFixed(0)}° / ${(el * DEG).toFixed(0)}°`;
    if (d.singleRow) {
      d.row.camAz = az;
      d.row.camEl = el;
      fcSchedule([d.row]);
    } else {
      for (const r of fc.allRows) {
        delete r.camAz;
        delete r.camEl;
      }
      fc.cfg.camAz = az;
      fc.cfg.camEl = el;
      fcRerenderVisible();
    }
  }

  function fcDragEdit(e) {
    const d = fc.drag;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
    d.moved = true;
    let fn;
    if (d.hit.kind === 'move') {
      let dh = (e.clientX - d.sx) / d.k, dvert = -(e.clientY - d.sy) / d.k;
      if (e.shiftKey) {
        if (Math.abs(dh) > Math.abs(dvert)) dvert = 0;
        else dh = 0;
      }
      const [du, dv, dw] = fcUnproject(d.view, dh, dvert);
      fn = (p) => fcLocalShift(p, du, dv, dw);
      d.text = `dịch ${fmtSigned(dh, 2)} / ${fmtSigned(dvert, 2)} m`;
    } else if (d.hit.kind === 'move3d') {
      const dh = (e.clientX - d.sx) / d.k;
      const dvert = -(e.clientY - d.sy) / d.k;
      const ca = Math.cos(d.az), sa = Math.sin(d.az);
      const ce = Math.cos(d.el), se = Math.sin(d.el);
      if (e.shiftKey) {
        const dw = dvert / Math.max(0.35, Math.abs(ce));
        fn = (p) => fcLocalShift(p, 0, 0, dw);
        d.text = `dịch Z ${fmtSigned(dw, 2)} m`;
      } else {
        const fwdScale = 1 / Math.max(0.38, Math.abs(se));
        const dfwd = dvert * fwdScale * (se >= 0 ? 1 : -1);
        const du = -dh * sa - dfwd * ca;
        const dv = dh * ca - dfwd * sa;
        fn = (p) => fcLocalShift(p, du, dv, 0);
        d.text = `dịch 3D ${fmtSigned(du, 2)} / ${fmtSigned(dv, 2)} m`;
      }
    } else if (d.hit.kind === 'face') {
      const amount = ((e.clientX - d.sx) * d.hit.nh - (e.clientY - d.sy) * d.hit.nv) / d.k;
      fn = (p) => fcResizeFace(p, d.hit.face, amount);
      d.text = `${FC_FACE_LABEL[d.hit.face]} ${fmtSigned(amount, 2)} m`;
    } else if (d.hit.kind === 'pitch') {
      // Trên SIDE view: u sang phải, w lên trên => pitch = atan2(-Δy, Δx)
      const a0 = Math.atan2(-(d.sy - d.cy), d.sx - d.cx);
      const a1 = Math.atan2(-(e.clientY - d.cy), e.clientX - d.cx);
      let dpitch = wrapPi(a1 - a0);
      if (e.shiftKey) dpitch = Math.round(dpitch * DEG * 2) / 2 * RAD;
      fn = (p) => fcRotatePitch(p, dpitch);
      d.text = `pitch ${fmtSigned(dpitch * DEG, 1)}°`;
    } else if (d.hit.kind === 'roll') {
      // Trên FRONT view: núm ở nóc (+w lên trên, +v sang phải) => roll = atan2(-Δx, -Δy)
      const a0 = Math.atan2(-(d.sx - d.cx), -(d.sy - d.cy));
      const a1 = Math.atan2(-(e.clientX - d.cx), -(e.clientY - d.cy));
      let droll = wrapPi(a1 - a0);
      if (e.shiftKey) droll = Math.round(droll * DEG * 2) / 2 * RAD;
      fn = (p) => fcRotateRoll(p, droll);
      d.text = `roll ${fmtSigned(droll * DEG, 1)}°`;
    } else if (d.hit.kind === 'yaw3d') {
      const a0 = Math.atan2(-(d.sx - d.cx), -(d.sy - d.cy));
      const a1 = Math.atan2(-(e.clientX - d.cx), -(e.clientY - d.cy));
      let dyaw = wrapPi(a1 - a0);
      if (e.shiftKey) dyaw = Math.round(dyaw * DEG) * RAD;
      fn = (p) => fcRotateYaw(p, dyaw);
      d.text = `yaw 3D ${fmtSigned(dyaw * DEG, 1)}°`;
    } else {
      // Hướng trên TOP view: u = lên trên màn hình, v = sang trái => yaw = atan2(-Δx, -Δy)
      const a0 = Math.atan2(-(d.sx - d.cx), -(d.sy - d.cy));
      const a1 = Math.atan2(-(e.clientX - d.cx), -(e.clientY - d.cy));
      let dyaw = wrapPi(a1 - a0);
      if (e.shiftKey) dyaw = Math.round(dyaw * DEG) * RAD;
      fn = (p) => fcRotateYaw(p, dyaw);
      d.text = `yaw ${fmtSigned(dyaw * DEG, 1)}°`;
    }
    for (const r of d.targets) r.draft = fn(r.base);
    fcSchedule(d.targets);
  }

  function fcDragSelect(e) {
    const d = fc.drag;
    fcAutoScroll(e.clientY);
    const row = fcRowAtPoint(e.clientX, e.clientY);
    if (!row || row.frame === d.last) return;
    d.last = row.frame;
    fcSelectRange(d.from, row.frame, new Set(d.base));
    fcUpdateSelectionUI();
  }

  function fcClearFillMarks() {
    fc.el?.querySelectorAll('.fill-target, .fill-source').forEach((el) => el.classList.remove('fill-target', 'fill-source'));
  }

  function fcDragFill(e) {
    const d = fc.drag;
    fcAutoScroll(e.clientY);
    const row = fcRowAtPoint(e.clientX, e.clientY);
    if (!row || row === d.to) return;
    d.to = row;
    const i0 = fc.rows.indexOf(d.from), i1 = fc.rows.indexOf(row);
    const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
    fc.rows.forEach((r, i) => r.el?.classList.toggle('fill-target', r !== d.from && i >= lo && i <= hi));
  }

  function fcStartResize(e, dir) {
    e.preventDefault();
    e.stopPropagation();
    const r = fc.el.getBoundingClientRect();
    if (fc.cfg.maximized) {
      saveFcSettings({ maximized: false, x: r.left, y: r.top, w: r.width, h: r.height });
      fcApplyBounds();
    }
    fc.drag = { type: 'resize', dir, sx: e.clientX, sy: e.clientY, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
  }

  function fcDragResize(e) {
    const d = fc.drag;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    let { x, y, w, h } = d.rect;
    if (d.dir.includes('e')) w = Math.max(FC_MIN_W, d.rect.w + dx);
    if (d.dir.includes('s')) h = Math.max(FC_MIN_H, d.rect.h + dy);
    if (d.dir.includes('w')) { w = Math.max(FC_MIN_W, d.rect.w - dx); x = d.rect.x + d.rect.w - w; }
    if (d.dir.includes('n')) { h = Math.max(FC_MIN_H, d.rect.h - dy); y = d.rect.y + d.rect.h - h; }
    x = Math.max(0, x);
    y = Math.max(0, y);
    Object.assign(fc.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    d.result = { x, y, w, h };
  }

  function fcStartMoveWindow(e) {
    e.preventDefault();
    const r = fc.el.getBoundingClientRect();
    fc.drag = { type: 'move-win', sx: e.clientX, sy: e.clientY, rect: { x: r.left, y: r.top }, restore: !!fc.cfg.maximized };
  }

  function fcDragMoveWindow(e) {
    const d = fc.drag;
    if (d.restore) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
      // Kéo header khi đang full màn => thu về cửa sổ, giữ con trỏ ở giữa header
      const w = clamp(fc.cfg.w, FC_MIN_W, window.innerWidth);
      const x = clamp(e.clientX - w / 2, 0, Math.max(0, window.innerWidth - w));
      saveFcSettings({ maximized: false, x, y: 0 });
      fcApplyBounds();
      d.restore = false;
      d.sx = e.clientX;
      d.sy = e.clientY;
      d.rect = { x, y: 0 };
      return;
    }
    const x = clamp(d.rect.x + e.clientX - d.sx, 0, Math.max(0, window.innerWidth - 160));
    const y = clamp(d.rect.y + e.clientY - d.sy, 0, Math.max(0, window.innerHeight - 48));
    Object.assign(fc.el.style, { left: `${x}px`, top: `${y}px` });
    d.result = { x, y };
  }

  function fcOnMouseMove(e) {
    const d = fc.drag;
    if (!d || d.dock) return; // kéo trên ô nhúng do 76-dock xử lý
    if (d.type === 'edit') fcDragEdit(e);
    else if (d.type === 'orbit3d') fcDragOrbit3D(e);
    else if (d.type === 'select') fcDragSelect(e);
    else if (d.type === 'fill') fcDragFill(e);
    else if (d.type === 'resize') fcDragResize(e);
    else if (d.type === 'move-win') fcDragMoveWindow(e);
  }

  async function fcOnMouseUp(e) {
    const d = fc.drag;
    if (!d || d.dock) return;
    fc.drag = null;
    if (d.type === 'orbit3d') {
      if (!d.moved && e) fcSelectClick(d.row, e);
      else if (!d.singleRow) saveFcSettings({ camAz: fc.cfg.camAz, camEl: fc.cfg.camEl });
      fcSchedule([d.row]);
      return;
    }
    if (d.type === 'edit') {
      if (!d.moved) {
        for (const r of d.targets) r.draft = null;
        return fcSchedule(d.targets);
      }
      const whatMap = {
        move: 'Kéo dịch',
        move3d: 'Kéo dịch 3D',
        yaw: 'Xoay Yaw',
        yaw3d: 'Xoay Yaw 3D',
        pitch: 'Xoay Pitch (Side)',
        roll: 'Xoay Roll (Front)',
      };
      const what = d.hit.kind === 'face' ? `Kéo ${FC_FACE_LABEL[d.hit.face]}` : (whatMap[d.hit.kind] || 'Chỉnh sửa');
      await fcApply(`${what} (${d.targets.length} frame)`, d.targets, (st, row) => (row.draft ? fcSetPoints(st, row.draft) : false));
    } else if (d.type === 'fill') {
      fcClearFillMarks();
      if (d.to && d.to !== d.from) await fcFillDown(d.from, d.to);
    } else if ((d.type === 'resize' || d.type === 'move-win') && d.result) {
      saveFcSettings(d.result);
    }
  }

  function fcCancelDrag() {
    const d = fc.drag;
    fc.drag = null;
    if (d?.type === 'edit') {
      for (const r of d.targets) r.draft = null;
      fcSchedule(d.targets);
    }
    fcClearFillMarks();
  }

  // ---- Cửa sổ ----
  const FC_HTML = `
    ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) => `<div class="cqt-fc-resizer" data-dir="${dir}"></div>`).join('')}
    <div class="cqt-fc-head" id="cqt-fc-head" title="Kéo để di chuyển · Nhấp đúp để phóng to / thu nhỏ">
      <div class="cqt-fc-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        <span>Full Control</span>
        <span class="cqt-badge">v${VERSION}</span>
      </div>
      <div class="cqt-fc-head-tools">
        <span class="cqt-label">Object</span>
        <input type="number" id="cqt-fc-target" class="cqt-input" placeholder="ID" />
        <button id="cqt-fc-pick" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Lấy object đang chọn trên canvas rồi nạp track">Lấy đang chọn</button>
        <button id="cqt-fc-load" class="cqt-btn cqt-btn-primary cqt-sm cqt-none" title="Đọc mọi frame của object và quét point cloud (Enter)">Nạp Track</button>
        <button id="cqt-fc-rescan" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Xoá cache và quét lại point cloud mọi frame">Quét lại Cloud</button>
        <div class="cqt-fc-progress" title="Tiến trình nạp point cloud"><div id="cqt-fc-progress-bar"></div></div>
        <span id="cqt-fc-progress-text" class="cqt-label">0%</span>
        <button id="cqt-fc-stop" class="cqt-btn cqt-btn-danger cqt-sm cqt-none" style="display:none;" title="Dừng quét cloud (giữ phần đã nạp)">Dừng</button>
      </div>
      <div class="cqt-fc-head-actions">
        <button id="cqt-fc-theme" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Đổi giao diện Sáng (Light) / Tối (Dark)"></button>
        <button id="cqt-fc-undo" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Hoàn tác Snapshot gần nhất (${ALT_SYM}Z)">Undo</button>
        <button id="cqt-fc-max" class="cqt-btn cqt-btn-secondary cqt-sm cqt-icon-btn" title="Phóng to toàn màn / Thu về cửa sổ"></button>
        <button id="cqt-fc-close" class="cqt-btn cqt-btn-secondary cqt-sm cqt-icon-btn" title="Đóng (Esc)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>

    <div class="cqt-fc-bar">
      <div class="cqt-fc-seg">
        <button data-fc-filter="all">Tất cả <span data-count="all">0</span></button>
        <button data-fc-filter="key">Keyframe <span data-count="key">0</span></button>
        <button data-fc-filter="range" title="Theo dải Start–End trên panel chính">Dải Start–End <span data-count="range">0</span></button>
      </div>
      <label class="cqt-fc-ctl" title="Chiều cao mỗi hàng frame">Cỡ hàng <input type="range" id="cqt-fc-rowh" min="100" max="360" step="10" /></label>
      <label class="cqt-fc-ctl" title="Phóng to hình chiếu (hoặc Alt/Ctrl + lăn chuột trên danh sách)">Zoom <input type="range" id="cqt-fc-zoom" min="0.5" max="4" step="0.1" /><span id="cqt-fc-zoom-val" class="cqt-label"></span></label>
      <span class="cqt-fc-sep"></span>
      <label class="cqt-fc-ctl" title="Giới hạn độ sâu đám mây điểm quanh box để loại bỏ xe/cây ở làn bên cạnh đè vào hình chiếu Side / Front">Lọc điểm
        <select id="cqt-fc-slice" class="cqt-input">
          <option value="inside">Chỉ trong Box (0m)</option>
          <option value="tight">Sát Box (±0.22m)</option>
          <option value="wide">Rộng quanh Box (±1.8m)</option>
        </select>
      </label>
      <button id="cqt-fc-toggle-3d" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Hiện / Ẩn cột tương tác 3D (xoay quanh xe &amp; kéo thả hộp 3D)">Cột 3D</button>
      <span class="cqt-fc-sep"></span>
      <label class="cqt-fc-ctl" title="Chế độ khi kéo nút ⤓ của 1 hàng xuống các hàng khác">Kéo ⤓
        <select id="cqt-fc-fillmode" class="cqt-input">
          <option value="lwh">Sao chép LWH</option>
          <option value="interp">Nội suy tuyến tính</option>
          <option value="ground">Sao chép đáy &amp; nghiêng</option>
          <option value="yaw">Sao chép góc Yaw</option>
        </select>
      </label>
      <label class="cqt-fc-ctl" title="Mặt giữ cố định khi đổi L/W bằng ô nhập, Đồng bộ LWH và Kéo ⤓ LWH">Neo mặt
        <select id="cqt-fc-anchor" class="cqt-input">
          <option value="center">Tâm box</option>
          <option value="sensor">Mặt gần LiDAR</option>
          <option value="front">Mặt trước (+X)</option>
          <option value="back">Mặt sau (-X)</option>
          <option value="left">Sườn trái (+Y)</option>
          <option value="right">Sườn phải (-Y)</option>
        </select>
      </label>
      <span class="cqt-fc-hint">Núm ● TOP = Yaw · SIDE = Pitch · FRONT = Roll · Cột 3D: kéo ◉ dịch box (Shift = cao độ Z), kéo nền xoay 3D</span>
    </div>

    <div class="cqt-fc-bar cqt-fc-batch">
      <span class="cqt-label"><b id="cqt-fc-selcount" style="color:var(--cqt-text);">0</b> frame đang chọn</span>
      <button id="cqt-fc-sel-all" class="cqt-btn cqt-btn-secondary cqt-sm">Chọn tất cả</button>
      <button id="cqt-fc-sel-none" class="cqt-btn cqt-btn-secondary cqt-sm">Bỏ chọn</button>
      <span class="cqt-fc-sep"></span>
      <span class="cqt-label">L</span><input id="cqt-fc-l" type="number" step="0.01" class="cqt-input cqt-mini" />
      <span class="cqt-label">W</span><input id="cqt-fc-w" type="number" step="0.01" class="cqt-input cqt-mini" />
      <span class="cqt-label">H</span><input id="cqt-fc-h" type="number" step="0.01" class="cqt-input cqt-mini" />
      <button id="cqt-fc-sync-lwh" class="cqt-btn cqt-btn-primary cqt-sm" title="Áp L/W/H cho mọi frame đang chọn (giữ đáy, theo Neo mặt)">Đồng bộ LWH</button>
      <span class="cqt-fc-sep"></span>
      <button id="cqt-fc-interp" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nội suy tuyến tính các frame giữa frame chọn đầu tiên và cuối cùng">Nội suy đầu → cuối</button>
      <button id="cqt-fc-snap" class="cqt-btn cqt-btn-secondary cqt-sm" title="Smart Snap từng frame đang chọn theo cloud đã cache">Smart Snap</button>
      <label class="cqt-check"><input type="checkbox" id="cqt-fc-fitsize" /> Fit size</label>
      <button id="cqt-fc-ground" class="cqt-btn cqt-btn-secondary cqt-sm" title="Hạ chạm đất từng frame đang chọn theo cloud đã cache">Fit chạm đất</button>
      <button id="cqt-fc-flat" class="cqt-btn cqt-btn-secondary cqt-sm" title="Đặt phẳng Pitch = Roll = 0° cho các frame đang chọn">Đặt phẳng 0°</button>
      <button id="cqt-fc-key-on" class="cqt-btn cqt-btn-secondary cqt-sm" title="Đặt keyframe cho các frame đang chọn (không gỡ keyframe)">Đặt Key</button>
      <button id="cqt-fc-outside" class="cqt-btn cqt-btn-danger cqt-sm">Outside</button>
    </div>

    <div class="cqt-fc-cols">
      <div>Frame</div>
      <div>Top · nhìn từ trên (xoay Yaw ↑)</div>
      <div>Side · nhìn từ sườn phải (xoay Pitch →)</div>
      <div>Front · nhìn từ đầu xe (xoay Roll ↑)</div>
      <div data-col="3d">3D · kéo nền xoay góc · kéo tâm ◉ dịch box</div>
      <div>Thông số</div>
    </div>
    <div class="cqt-fc-list" id="cqt-fc-list"></div>
    <div id="cqt-fc-status" class="cqt-fc-status">Sẵn sàng.</div>
  `;

  function fcApplyBounds() {
    const el = fc.el, b = fc.cfg;
    el.classList.toggle('maximized', !!b.maximized);
    if (b.maximized) {
      Object.assign(el.style, { left: '0px', top: '0px', width: '100vw', height: '100vh' });
    } else {
      const w = clamp(b.w, FC_MIN_W, Math.max(FC_MIN_W, window.innerWidth));
      const h = clamp(b.h, FC_MIN_H, Math.max(FC_MIN_H, window.innerHeight));
      Object.assign(el.style, {
        width: `${w}px`,
        height: `${h}px`,
        left: `${clamp(b.x, 0, Math.max(0, window.innerWidth - 160))}px`,
        top: `${clamp(b.y, 0, Math.max(0, window.innerHeight - 48))}px`,
      });
    }
    const btn = $('cqt-fc-max');
    if (btn) {
      btn.innerHTML = b.maximized ? FC_ICON_RESTORE : FC_ICON_MAX;
      btn.title = b.maximized ? 'Thu về cửa sổ (kéo cạnh/góc để chỉnh kích thước)' : 'Phóng to toàn màn';
    }
  }

  function fcToggleMaximize() {
    saveFcSettings({ maximized: !fc.cfg.maximized });
    fcApplyBounds();
  }

  function fcSyncControls() {
    const c = fc.cfg;
    fc.el.style.setProperty('--fc-row-h', `${c.rowH}px`);
    setField('cqt-fc-rowh', c.rowH);
    setField('cqt-fc-zoom', c.zoom);
    setField('cqt-fc-slice', c.slice || 'tight');
    setField('cqt-fc-fillmode', c.fillMode);
    setField('cqt-fc-anchor', c.anchor);
    const zv = $('cqt-fc-zoom-val');
    if (zv) zv.textContent = `${Number(c.zoom).toFixed(1)}×`;
    fcUpdateBars();
  }

  function fcSetZoom(z) {
    saveFcSettings({ zoom: clamp(Math.round(z * 10) / 10, 0.5, 4) });
    fcSyncControls();
    fcRerenderVisible();
  }

  function fcBindWindow(el) {
    const on = (id, fn, event = 'click') => el.querySelector('#' + id)?.addEventListener(event, guarded(fn));
    const list = el.querySelector('#cqt-fc-list');

    el.querySelectorAll('.cqt-fc-resizer').forEach((r) => r.addEventListener('mousedown', (e) => fcStartResize(e, r.dataset.dir)));
    const head = el.querySelector('#cqt-fc-head');
    const isControl = (t) => t.closest('button, input, select, label, .cqt-fc-progress');
    head.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !isControl(e.target)) fcStartMoveWindow(e);
    });
    head.addEventListener('dblclick', (e) => {
      if (!isControl(e.target)) fcToggleMaximize();
    });
    window.addEventListener('mousemove', fcOnMouseMove);
    window.addEventListener('mouseup', guarded(fcOnMouseUp));
    window.addEventListener('resize', () => { if (fc.open) fcApplyBounds(); });
    new ResizeObserver(() => fcRerenderVisible()).observe(list);

    // Header
    on('cqt-fc-theme', toggleTheme);
    on('cqt-fc-close', closeFullControl);
    on('cqt-fc-max', fcToggleMaximize);
    on('cqt-fc-undo', async () => { await restoreLatestSnapshot(); await fcReloadStates(); });
    on('cqt-fc-pick', () => {
      const id = activeId();
      if (id === null) return fail('Chưa chọn object nào trên canvas.');
      return fcLoadTrack(id);
    });
    on('cqt-fc-load', () => fcLoadTrack());
    on('cqt-fc-target', (e) => (e.key === 'Enter' ? fcLoadTrack() : null), 'keydown');
    on('cqt-fc-rescan', () => fcHarvest(true));
    on('cqt-fc-stop', () => { fc.abort = true; });

    // Bộ lọc & hiển thị
    el.querySelectorAll('[data-fc-filter]').forEach((b) => b.addEventListener('click', () => {
      saveFcSettings({ filter: b.dataset.fcFilter });
      fcRenderList();
    }));
    on('cqt-fc-rowh', () => {
      saveFcSettings({ rowH: intVal('cqt-fc-rowh') || FC_DEFAULTS.rowH });
      fcSyncControls();
      fcRerenderVisible();
    }, 'input');
    on('cqt-fc-zoom', () => fcSetZoom(numVal('cqt-fc-zoom') || 1), 'input');
    on('cqt-fc-slice', () => {
      saveFcSettings({ slice: val('cqt-fc-slice') || 'tight' });
      fcRerenderVisible();
    }, 'change');
    on('cqt-fc-toggle-3d', () => {
      saveFcSettings({ show3d: !fc.cfg.show3d });
      fcUpdateBars();
      fcRerenderVisible();
    });
    on('cqt-fc-fillmode', () => saveFcSettings({ fillMode: val('cqt-fc-fillmode') }), 'change');
    on('cqt-fc-anchor', () => saveFcSettings({ anchor: val('cqt-fc-anchor') }), 'change');

    // Thao tác nhóm
    on('cqt-fc-sel-all', () => {
      fc.selected = new Set(fc.rows.filter((r) => !r.outside).map((r) => r.frame));
      fcUpdateSelectionUI();
    });
    on('cqt-fc-sel-none', () => {
      fc.selected.clear();
      fcUpdateSelectionUI();
    });
    on('cqt-fc-sync-lwh', fcSyncLWH);
    on('cqt-fc-interp', () => fcInterpolate(fcSelectedRows(), 'Nội suy đầu → cuối'));
    on('cqt-fc-snap', () => fcSnapRows(fcSelectedRows()));
    on('cqt-fc-ground', () => fcGroundRows(fcSelectedRows()));
    on('cqt-fc-flat', () => fcFlattenRows(fcSelectedRows()));
    on('cqt-fc-key-on', () => fcSetKeyframe(fcSelectedRows()));
    on('cqt-fc-outside', () => fcSetOutside(fcSelectedRows()));

    // Danh sách: chọn, kéo sửa, Fill-Down, nút & ô nhập trên từng hàng
    list.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || fc.busy || fc.drag) return;
      const rowEl = e.target.closest('.cqt-fc-row');
      const row = rowEl && fcRowByFrame(Number(rowEl.dataset.frame));
      if (!row) return;
      const canvas = e.target.closest('canvas');
      if (canvas) return fcStartCanvasDrag(e, row, canvas);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'select') {
        e.preventDefault();
        const before = new Set(fc.selected);
        fcSelectClick(row, e);
        fc.drag = { type: 'select', from: e.shiftKey ? fc.lastClicked : row.frame, base: e.ctrlKey || e.metaKey ? before : new Set(), last: row.frame };
      } else if (act === 'fill' && !row.outside) {
        e.preventDefault();
        rowEl.classList.add('fill-source');
        fc.drag = { type: 'fill', from: row, to: row };
      }
    });
    list.addEventListener('dblclick', guarded(async (e) => {
      const canvas = e.target.closest?.('canvas');
      const row = canvas && fcRowByFrame(Number(canvas.closest('.cqt-fc-row').dataset.frame));
      if (!row) return;
      const rect = canvas.getBoundingClientRect();
      const hit = fcHitTest(row, canvas, e.clientX - rect.left, e.clientY - rect.top);
      if (canvas.dataset.view === '3d' && hit?.kind === 'orbit3d') {
        for (const r of fc.allRows) { delete r.camAz; delete r.camEl; }
        saveFcSettings({ camAz: -0.68, camEl: 0.46 });
        fcRerenderVisible();
      } else if (hit?.kind === 'pitch' || hit?.kind === 'roll') {
        await fcFlattenRows(fcTargetsFor(row));
      }
    }));
    list.addEventListener('mousemove', (e) => {
      if (fc.drag) return;
      const canvas = e.target.closest?.('canvas');
      const row = canvas && fcRowByFrame(Number(canvas.closest('.cqt-fc-row').dataset.frame));
      let hit = null;
      if (row) {
        const rect = canvas.getBoundingClientRect();
        hit = fcHitTest(row, canvas, e.clientX - rect.left, e.clientY - rect.top);
        canvas.style.cursor = fcHitCursor(hit);
      }
      const next = hit ? { row, view: canvas.dataset.view, hit } : null;
      const prev = fc.hover;
      const same = prev && next && prev.row === next.row && prev.view === next.view &&
        prev.hit.kind === next.hit.kind && prev.hit.face === next.hit.face;
      if (same || (!prev && !next)) return;
      fc.hover = next;
      fcSchedule([prev?.row, next?.row]);
    });
    list.addEventListener('mouseleave', () => {
      if (!fc.hover) return;
      const row = fc.hover.row;
      fc.hover = null;
      fcSchedule([row]);
    });
    list.addEventListener('wheel', (e) => {
      if (!e.altKey && !e.ctrlKey) return;
      e.preventDefault();
      fcSetZoom(fc.cfg.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });
    list.addEventListener('click', guarded(async (e) => {
      const btn = e.target.closest('button[data-act]');
      const row = btn && fcRowByFrame(Number(btn.closest('.cqt-fc-row').dataset.frame));
      if (!row) return;
      const act = btn.dataset.act;
      if (act === 'goto') {
        await jumpTo(fc.targetId, row.frame);
        fcRefreshAll();
      } else if (act === 'key') {
        await fcSetKeyframe([row]);
      } else if (act === 'snap') {
        await fcSnapRows(fcTargetsFor(row));
      } else if (act === 'ground') {
        await fcGroundRows(fcTargetsFor(row));
      } else if (act === 'flat') {
        await fcFlattenRows(fcTargetsFor(row));
      }
    }));
    list.addEventListener('change', guarded(async (e) => {
      const input = e.target.closest('input[data-k]');
      const row = input && fcRowByFrame(Number(input.closest('.cqt-fc-row').dataset.frame));
      if (row) await fcOnRowInput(row, input);
    }));
  }

  function fcEnsureWindow() {
    if (fc.el && document.body.contains(fc.el)) return fc.el;
    const el = document.createElement('div');
    el.id = 'cqt-fc-window';
    el.innerHTML = FC_HTML;
    document.body.appendChild(el);
    fc.el = el;
    fc.cfg = loadOpts(LS.fcBounds, FC_DEFAULTS);
    fcBindWindow(el);
    syncThemeButtons();
    return el;
  }

  async function openFullControl(id) {
    fcEnsureWindow();
    fc.open = true;
    fc.el.style.display = 'flex';
    fcApplyBounds();
    fcSyncControls();
    const target = Number.isInteger(id) ? id : resolveTargetId();
    refreshSnapshotList();
    if (Number.isInteger(target) && target !== fc.targetId) return fcLoadTrack(target);
    if (Number.isInteger(fc.targetId)) {
      setField('cqt-fc-target', fc.targetId);
      return fcReloadStates();
    }
    fcRenderList();
    return setStatus('Full Control: nhập Object ID rồi bấm "Nạp Track".', 'info');
  }

  function closeFullControl() {
    if (!fc.el) return;
    fc.open = false;
    fc.abort = true;
    fcCancelDrag();
    fc.hover = null;
    fc.el.style.display = 'none';
  }

  function toggleFullControl() {
    return fc.open ? closeFullControl() : openFullControl();
  }

  // =========================================================================
  // Ô nhìn nhúng: TOP / SIDE / FRONT của Full Control đặt đè lên 3 ô nhìn phụ của CVAT
  //   - Luôn theo Target (object đang chọn hoặc ID đã khoá) ở frame hiện tại, cloud của chính frame đó
  //   - Lăn chuột: frame trước / sau của CHÍNH object đó (bỏ qua frame object vắng mặt / outside)
  //     Shift + lăn: keyframe trước / sau · Ctrl / Alt + lăn: zoom
  //   - Kéo sửa như Full Control (dịch, kéo cạnh đổi L/W/H, núm xoay Yaw/Pitch/Roll), ghi khi nhả chuột
  //   - Nút ⤢: mở Full Control đè lên toàn layout CVAT
  // Bảng Item (kiểu N-panel "Item" của Blender) ở góc ô 3D: sửa Location / Rotation / Dimensions
  // =========================================================================
  const DOCK_VIEWS = ['top', 'side', 'front'];
  const DOCK_NAMES = { top: 'TOP', side: 'SIDE', front: 'FRONT' };

  const dock = {
    els: {}, // view -> { box, canvas, info, empty }
    hidden: false, // ẩn tạm (nút ✕), bật lại bằng Alt+V
    row: null, // { frame, key, outside, base, draft, ground, cloud }
    id: null,
    frame: null,
    sig: '',
    cloudRef: null,
    cloudFrame: null,
    frames: { id: null, job: null, at: 0, list: [], keys: [] },
    zoom: 1,
    wheelAcc: 0,
    navigating: false,
    busy: false,
    lastTick: 0,
    again: false,
    observer: null,
  };

  const ITEM_FIELDS = [
    { sec: 'Location', key: 'x', idx: 0, label: 'X', unit: 'm', step: 0.01, digits: 3 },
    { key: 'y', idx: 1, label: 'Y', unit: 'm', step: 0.01, digits: 3 },
    { key: 'z', idx: 2, label: 'Z', unit: 'm', step: 0.01, digits: 3 },
    { sec: 'Rotation (Euler XYZ)', key: 'rx', idx: 3, label: 'X', unit: '°', step: 0.5, digits: 2, deg: true },
    { key: 'ry', idx: 4, label: 'Y', unit: '°', step: 0.5, digits: 2, deg: true },
    { key: 'rz', idx: 5, label: 'Z', unit: '°', step: 0.5, digits: 2, deg: true },
    { sec: 'Dimensions', key: 'l', idx: 6, label: 'L', unit: 'm', step: 0.01, digits: 3, dim: true },
    { key: 'w', idx: 7, label: 'W', unit: 'm', step: 0.01, digits: 3, dim: true },
    { key: 'h', idx: 8, label: 'H', unit: 'm', step: 0.01, digits: 3, dim: true },
  ];

  // Nhóm (Location / Rotation / Dimensions) của từng trường, dùng cho nhãn snapshot
  let itemGroup = '';
  for (const f of ITEM_FIELDS) {
    if (f.sec) itemGroup = f.sec.split(' ')[0];
    f.group = itemGroup;
  }

  const item = {
    el: null,
    scrub: null, // { field, sx, v0, moved }
  };

  function dockOn() {
    return !!getSettings().dockViews && !dock.hidden;
  }

  function itemOn() {
    return !!getSettings().itemPanel;
  }

  // Ô canvas thật của CVAT cho từng view (renderer three.js) => toạ độ để phủ lên
  function cvatViewRect(view) {
    const el = getCanvas3dViews()?.[view]?.renderer?.domElement;
    const r = el?.isConnected ? el.getBoundingClientRect() : null;
    return r && r.width > 40 && r.height > 40 ? { r, el } : null;
  }

  // ---- Dựng DOM ----
  function dockEnsureEls() {
    for (const view of DOCK_VIEWS) {
      if (dock.els[view]) continue;
      const box = document.createElement('div');
      box.className = 'cqt-dock-view';
      box.dataset.view = view;
      box.style.display = 'none';
      box.innerHTML = `
        <div class="cqt-dock-head">
          <span class="cqt-dock-title">${DOCK_NAMES[view]}</span>
          <span class="cqt-dock-info"></span>
          <button data-act="prev" title="Frame trước của object (lăn lên) · Shift: keyframe trước">&lsaquo;</button>
          <button data-act="next" title="Frame sau của object (lăn xuống) · Shift: keyframe sau">&rsaquo;</button>
          <button data-act="expand" title="Mở rộng: Full Control đè lên layout CVAT (${ALT_SYM}M)">&#10530;</button>
          <button data-act="hide" title="Ẩn tạm, hiện lại ô nhìn gốc của CVAT (${ALT_SYM}V để bật lại)">&times;</button>
        </div>
        <canvas data-view="${view}"></canvas>
        <div class="cqt-dock-empty"></div>`;
      document.body.appendChild(box);
      const e = {
        box,
        canvas: box.querySelector('canvas'),
        info: box.querySelector('.cqt-dock-info'),
        empty: box.querySelector('.cqt-dock-empty'),
      };
      dock.els[view] = e;
      dockBindView(e, view);
    }
    if (!item.el) itemCreate();
  }

  function dockBindView(e, view) {
    const { box, canvas } = e;
    box.querySelector('.cqt-dock-head').addEventListener('click', guarded(async (ev) => {
      const act = ev.target.closest('button')?.dataset.act;
      if (act === 'prev' || act === 'next') return dockStep(act === 'next' ? 1 : -1, ev.shiftKey);
      if (act === 'expand') return openFullControl(dock.id ?? resolveTargetId());
      if (act === 'hide') {
        dock.hidden = true;
        dockLayout();
        return setStatus(`Đã ẩn ô nhìn nhúng, đang hiện ô gốc của CVAT. ${ALT_SYM}V để bật lại.`, 'info');
      }
    }));
    box.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.ctrlKey || ev.altKey || ev.metaKey) {
        dock.zoom = clamp(dock.zoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), 0.4, 6);
        return dockRender();
      }
      // Gộp delta của touchpad/chuột: 1 nấc chuột ≈ 100px => 1 frame
      const unit = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 400 : 1;
      dock.wheelAcc += ev.deltaY * unit;
      if (Math.abs(dock.wheelAcc) < 60 || dock.navigating) return;
      const dir = Math.sign(dock.wheelAcc);
      dock.wheelAcc = 0;
      guarded(() => dockStep(dir, ev.shiftKey))();
    }, { passive: false });
    canvas.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      dock.zoom = 1;
      dockRender();
    });
    canvas.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      const row = dock.row;
      if (!row || row.outside || fc.drag) return;
      const rect = canvas.getBoundingClientRect();
      const hit = fcHitTest(row, canvas, ev.clientX - rect.left, ev.clientY - rect.top);
      if (!hit) return;
      const g = fcViewGeom(canvas, view);
      fc.drag = {
        type: 'edit', dock: true, row, view, hit, targets: [row], k: g.k,
        sx: ev.clientX, sy: ev.clientY, cx: rect.left + g.cx, cy: rect.top + g.cy,
        az: 0, el: 0, moved: false, text: '',
      };
    });
    canvas.addEventListener('mousemove', (ev) => {
      if (fc.drag || !dock.row || dock.row.outside) return;
      const rect = canvas.getBoundingClientRect();
      canvas.style.cursor = fcHitCursor(fcHitTest(dock.row, canvas, ev.clientX - rect.left, ev.clientY - rect.top));
    });
    // Không để CVAT nhận click/phím khi thao tác trên ô nhúng
    for (const type of ['click', 'contextmenu', 'pointerdown']) box.addEventListener(type, (ev) => ev.stopPropagation());
  }

  // ---- Bố cục: phủ đúng lên 3 ô nhìn của CVAT, bảng Item ở góc phải ô 3D ----
  function dockLayout() {
    const onJob = !!getJob(); // ô nhìn 3D của CVAT chỉ có khi đang mở job
    for (const view of DOCK_VIEWS) {
      const e = dock.els[view];
      if (!e) continue;
      const host = onJob && dockOn() ? cvatViewRect(view) : null;
      if (!host) {
        e.box.style.display = 'none';
        continue;
      }
      const { r } = host;
      Object.assign(e.box.style, {
        display: 'flex', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      });
      if (dock.observer && !host.el.__cqtObserved) {
        host.el.__cqtObserved = true;
        dock.observer.observe(host.el);
      }
    }
    if (item.el) {
      const host = onJob && itemOn() ? cvatViewRect('perspective') : null;
      if (!host) {
        item.el.style.display = 'none';
      } else {
        item.el.style.display = 'flex';
        item.el.style.top = `${host.r.top + 8}px`;
        // Chừa chỗ cho tay nắm TOOLBOX ở mép phải màn hình
        const right = Math.min(host.r.right, window.innerWidth - 34);
        item.el.style.left = `${Math.max(host.r.left + 8, right - item.el.offsetWidth - 8)}px`;
      }
    }
  }

  // ---- Dữ liệu: Target ở frame hiện tại + cloud của đúng frame đó ----
  async function dockTick(force = false) {
    if (!document.getElementById('cvat-quicktool-wrapper')) return;
    const now = Date.now();
    if (!force && now - dock.lastTick < 90) return;
    dock.lastTick = now;
    dockEnsureEls();
    dockLayout();
    const anyDock = DOCK_VIEWS.some((v) => dock.els[v]?.box.style.display !== 'none');
    const showItem = item.el?.style.display !== 'none';
    if ((!anyDock && !showItem) || fc.drag?.dock || item.scrub) return;
    if (dock.busy) {
      if (force) dock.again = true; // đang đọc dở: đọc lại ngay sau khi xong
      return;
    }

    dock.busy = true;
    try {
      const id = resolveTargetId();
      const frame = getFrame();
      const positions = getPointCloudPositions(); // đọc cùng lúc với frame, trước khi await
      const s = Number.isInteger(id) && Number.isInteger(frame) ? await getState(id, frame) : null;
      if (getFrame() !== frame) {
        dock.again = true; // frame đổi trong lúc đọc => đọc lại
        return;
      }
      // CVAT đổi frame trước rồi mới nạp cloud: chỉ nhận cloud khi mảng điểm thực sự đổi
      if (positions !== dock.cloudRef) {
        dock.cloudRef = positions;
        dock.cloudFrame = frame;
      }
      const cloudReady = !!positions && dock.cloudFrame === frame;
      if (!isCuboid(s)) {
        dock.row = null;
        dock.id = Number.isInteger(id) ? id : null;
        dock.frame = frame;
        dock.sig = '';
        dockRender(Number.isInteger(id) ? `#${id} không có ở frame ${frame ?? '?'}` : 'Chọn 1 object (hoặc nhập Target ID)');
        itemRefresh();
        return;
      }
      const sig = `${id}|${frame}|${s.points.join(',')}|${!!s.outside}|${isKey(s)}|${cloudReady}`;
      if (!force && sig === dock.sig) return;
      dock.sig = sig;
      dock.id = id;
      dock.frame = frame;
      dock.row = {
        frame, key: isKey(s), outside: !!s.outside, base: [...s.points], draft: null, ground: undefined,
        cloud: cloudReady ? dockCrop(id, frame, s.points, positions) : (pointCropCache.get(cropKey(id, frame)) || null),
        label: labelName(s),
      };
      dockRender();
      itemRefresh();
    } finally {
      dock.busy = false;
      if (dock.again) {
        dock.again = false;
        setTimeout(() => dockTick(true), 0);
      }
    }
  }

  // Cắt cloud quanh box, nhớ lại để Full Control dùng cho frame này mà không cần tự chuyển frame
  function dockCrop(id, frame, points, positions) {
    const crop = cropPointsAroundBox(points, positions);
    pointCropCache.set(cropKey(id, frame), crop);
    return crop;
  }

  function dockRender(emptyText) {
    const row = dock.row;
    for (const view of DOCK_VIEWS) {
      const e = dock.els[view];
      if (!e || e.box.style.display === 'none') continue;
      if (!row) {
        e.canvas.style.display = 'none';
        e.empty.style.display = 'flex';
        e.empty.textContent = emptyText || 'Chọn 1 object để xem';
        e.info.textContent = '';
        continue;
      }
      e.canvas.style.display = 'block';
      e.empty.style.display = 'none';
      const p = row.base;
      e.canvas._extent = { l: Math.abs(p[6]), w: Math.abs(p[7]), h: Math.abs(p[8]) };
      e.canvas._zoom = dock.zoom;
      fcRenderView(row, e.canvas);
      const state = row.outside ? 'OUT' : row.key ? 'KEY' : 'LERP';
      const pos = dock.frames.id === dock.id ? dock.frames.list.indexOf(row.frame) : -1;
      e.info.textContent = `#${dock.id} · F${row.frame} ${state}` +
        (pos >= 0 ? ` · ${pos + 1}/${dock.frames.list.length}` : '') + (row.cloud ? '' : ' · chờ cloud');
    }
  }

  // Danh sách frame của object (có mặt, không outside) — cache ngắn để lăn chuột cho nhanh
  async function dockFrames(id) {
    const job = getJob()?.id;
    const f = dock.frames;
    if (f.id === id && f.job === job && Date.now() - f.at < 4000) return f;
    const b = jobBounds();
    if (!b) return null;
    const list = await collectTrack(id, b.start, b.stop);
    dock.frames = {
      id, job, at: Date.now(),
      list: list.map((x) => x.frame),
      keys: list.filter((x) => isKey(x.state)).map((x) => x.frame),
    };
    return dock.frames;
  }

  // Lăn chuột / nút ‹ ›: sang frame trước/sau của chính object (keyOnly: chỉ keyframe)
  async function dockStep(dir, keyOnly = false) {
    if (dock.navigating) return;
    const id = Number.isInteger(dock.id) ? dock.id : resolveTargetId();
    if (!Number.isInteger(id)) return fail('Chọn 1 object (hoặc nhập Target ID) trước.');
    dock.navigating = true;
    try {
      const fr = await dockFrames(id);
      if (!fr?.list.length) return fail(`Không thấy object #${id} trong job.`);
      const list = keyOnly ? fr.keys : fr.list;
      const cur = getFrame();
      const next = dir > 0 ? list.find((f) => f > cur) : [...list].reverse().find((f) => f < cur);
      if (next === undefined) {
        return setStatus(`#${id}: đã tới ${keyOnly ? 'keyframe' : 'frame'} ${dir > 0 ? 'cuối' : 'đầu'} của object (f${cur}).`, 'info');
      }
      if (!(await goToFrame(next))) return fail(`Không chuyển được tới frame ${next}.`);
      await dockTick(true);
    } finally {
      dock.navigating = false;
    }
  }

  // ---- Kéo sửa trên ô nhúng (dùng chung toán học/hit-test của Full Control) ----
  function dockOnMouseMove(e) {
    if (!fc.drag?.dock) return;
    fcDragEdit(e);
    dockRender();
  }

  async function dockOnMouseUp() {
    const d = fc.drag;
    if (!d?.dock) return;
    fc.drag = null;
    const row = d.row;
    if (!d.moved || !row.draft) {
      row.draft = null;
      return dockRender();
    }
    const next = row.draft;
    const what = d.hit.kind === 'face' ? `kéo ${FC_FACE_LABEL[d.hit.face]}`
      : { move: 'kéo dịch', yaw: 'xoay Yaw', pitch: 'xoay Pitch', roll: 'xoay Roll' }[d.hit.kind] || 'chỉnh sửa';
    await dockCommit(`Ô ${DOCK_NAMES[d.view]}: ${what}`, [{ id: dock.id, points: next }]);
  }

  function dockCancelDrag() {
    const d = fc.drag;
    if (!d?.dock) return false;
    fc.drag = null;
    d.row.draft = null;
    dockRender();
    return true;
  }

  // Ghi danh sách { id, points } tại frame hiện tại (1 snapshot chung)
  async function dockCommit(label, edits) {
    const frame = getFrame();
    if (!Number.isInteger(frame)) return fail('Không đọc được frame hiện tại.');
    const batch = createBatch(label);
    for (const { id, points } of edits) {
      const s = await getState(id, frame);
      if (!isCuboid(s) || s.outside) continue;
      await batch.edit(s, frame, (st) => fcSetPoints(st, [...points]));
    }
    const res = await batch.finish();
    if (dock.row) dock.row.draft = null;
    dock.frames.at = 0; // keyframe có thể vừa được tạo
    await dockTick(true);
    if (fc.open && edits.some((x) => x.id === fc.targetId)) await fcReloadStates();
    await updateKeyframeBadge();
    if (!res.changed) return setStatus(`${label}: không có thay đổi.`, 'info');
    setStatus(`${label} — ${edits.length === 1 ? `#${edits[0].id}` : `${res.changed} object`} @f${frame}.` + editSuffix(res), res.errors ? 'warn' : 'success');
  }

  // =========================================================================
  // Bảng Item (Blender N-panel): Location / Rotation / Dimensions có thể sửa
  //   Enter: áp cho Target · Alt+Enter: áp cùng giá trị cho cả nhóm · Esc: huỷ
  //   Kéo nhãn X/Y/Z sang trái/phải để chỉnh (Shift: chậm 10× · Ctrl: bắt bước)
  // =========================================================================
  function itemCreate() {
    const el = document.createElement('div');
    el.id = 'cqt-item-panel';
    el.style.display = 'none';
    let html = `
      <div class="cqt-item-head" title="Bấm để thu gọn / mở rộng (${ALT_SYM}N bật/tắt bảng)">
        <span class="cqt-item-title">Item</span>
        <span class="cqt-item-obj">--</span>
        <span class="cqt-item-caret">▾</span>
      </div>
      <div class="cqt-item-body">`;
    for (const f of ITEM_FIELDS) {
      if (f.sec) html += `<div class="cqt-item-sec">${f.sec}</div>`;
      html += `<div class="cqt-item-row" data-k="${f.key}">
          <span class="cqt-item-lbl" title="Kéo trái/phải để chỉnh (Shift: chậm · Ctrl: bắt bước)">${f.label}</span>
          <input type="text" inputmode="decimal" class="cqt-item-in" data-k="${f.key}" spellcheck="false" />
          <span class="cqt-item-unit">${f.unit}</span>
        </div>`;
    }
    html += `<div class="cqt-item-hint">Enter: áp · ${ALT_SYM}Enter: áp cả nhóm · kéo nhãn để chỉnh</div></div>`;
    el.innerHTML = html;
    document.body.appendChild(el);
    item.el = el;
    if (getSettings().itemCollapsed) el.classList.add('collapsed');

    el.querySelector('.cqt-item-head').addEventListener('click', () => {
      el.classList.toggle('collapsed');
      lsSet(LS.settings, { ...getSettings(), itemCollapsed: el.classList.contains('collapsed') });
      dockLayout();
    });
    for (const input of el.querySelectorAll('.cqt-item-in')) {
      input.addEventListener('focus', () => { input.dataset.orig = input.value; input.select(); });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // không để phím tắt CVAT nhận số đang gõ
        if (e.key === 'Enter') {
          e.preventDefault();
          guarded(() => itemCommitInput(input, e.altKey))();
        } else if (e.key === 'Escape') {
          input.value = input.dataset.orig ?? input.value;
          input.blur();
        }
      });
      input.addEventListener('blur', () => {
        if (input.dataset.orig !== undefined && input.value !== input.dataset.orig) guarded(() => itemCommitInput(input, false))();
        delete input.dataset.orig;
      });
    }
    for (const lbl of el.querySelectorAll('.cqt-item-lbl')) {
      lbl.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !dock.row || dock.row.outside) return;
        e.preventDefault();
        const field = ITEM_FIELDS.find((f) => f.key === lbl.parentElement.dataset.k);
        item.scrub = { field, sx: e.clientX, v0: itemValue(dock.row.base, field), moved: false, value: null };
      });
    }
    for (const type of ['click', 'contextmenu', 'pointerdown', 'mousedown', 'wheel']) el.addEventListener(type, (e) => e.stopPropagation());
  }

  function itemValue(p, f) {
    const v = f.dim ? Math.abs(p[f.idx]) : p[f.idx];
    return f.deg ? v * DEG : v;
  }

  // Box mới khi đặt 1 trường = value (giữ đáy khi đổi kích thước nếu ô "Giữ đáy" ở tab Box đang bật)
  function itemApply(p, f, value) {
    if (f.dim) {
      if (!(value > 0)) return null;
      const lwh = [Math.abs(p[6]), Math.abs(p[7]), Math.abs(p[8])];
      lwh[f.idx - 6] = value;
      const anchor = getSettings().anchorResize ? (val('cqt-lwh-anchor') || 'center') : 'center';
      const keep = $('cqt-keep-ground') ? isChecked('cqt-keep-ground') : true;
      return withLWH(p, lwh[0], lwh[1], lwh[2], keep, anchor);
    }
    const q = [...p];
    q[f.idx] = f.deg ? wrapPi(value * RAD) : value;
    return q;
  }

  function itemParse(text) {
    const t = String(text).trim().replace(',', '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
    return parseFloat(t);
  }

  async function itemCommitInput(input, toGroup) {
    const f = ITEM_FIELDS.find((x) => x.key === input.dataset.k);
    const value = itemParse(input.value);
    delete input.dataset.orig;
    if (!Number.isFinite(value) || (f.dim && value <= 0)) {
      itemRefresh();
      return fail(`Giá trị ${f.label} không hợp lệ${f.dim ? ' (phải > 0)' : ''}.`);
    }
    const frame = getFrame();
    const ids = toGroup && selection.size ? selectedOrTarget() : [dock.id ?? resolveTargetId()].filter(Number.isInteger);
    if (!ids.length) return fail('Chọn object trước!');
    const edits = [];
    for (const id of ids) {
      const s = await getState(id, frame);
      if (!isCuboid(s) || s.outside) continue;
      const next = itemApply([...s.points], f, value);
      if (next) edits.push({ id, points: next });
    }
    if (!edits.length) return fail(`Không có cuboid hợp lệ ở frame ${frame}.`);
    await dockCommit(`Item: ${f.group} ${f.label} = ${value}${f.unit}`, edits);
  }

  function itemOnMouseMove(e) {
    const sc = item.scrub;
    if (!sc || !dock.row) return;
    const dx = e.clientX - sc.sx;
    if (!sc.moved && Math.abs(dx) < 3) return;
    sc.moved = true;
    let value = sc.v0 + dx * sc.field.step * (e.shiftKey ? 0.1 : 1);
    if (e.ctrlKey) {
      const snap = sc.field.deg ? 5 : 0.1;
      value = Math.round(value / snap) * snap;
    }
    if (sc.field.dim) value = Math.max(0.05, value);
    sc.value = value;
    const next = itemApply(dock.row.base, sc.field, value);
    if (!next) return;
    dock.row.draft = next;
    dockRender();
    itemShow(next);
  }

  async function itemOnMouseUp() {
    const sc = item.scrub;
    if (!sc) return;
    item.scrub = null;
    if (!sc.moved || sc.value === null || !dock.row?.draft) {
      if (dock.row) dock.row.draft = null;
      return dockRender();
    }
    const f = sc.field;
    await dockCommit(`Item: kéo ${f.label} → ${sc.value.toFixed(f.digits)}${f.unit}`, [{ id: dock.id, points: dock.row.draft }]);
  }

  function itemShow(p) {
    if (!item.el) return;
    for (const f of ITEM_FIELDS) {
      const input = item.el.querySelector(`.cqt-item-in[data-k="${f.key}"]`);
      if (!input || document.activeElement === input) continue;
      input.value = p ? itemValue(p, f).toFixed(f.digits) : '';
    }
  }

  function itemRefresh() {
    if (!item.el) return;
    const head = item.el.querySelector('.cqt-item-obj');
    const row = dock.row;
    item.el.classList.toggle('empty', !row);
    if (!row) {
      head.textContent = 'chưa chọn object';
      return itemShow(null);
    }
    head.textContent = `#${dock.id} ${row.label || ''} · F${row.frame} ${row.outside ? 'OUT' : row.key ? 'KEY' : 'LERP'}`;
    item.el.classList.toggle('outside', !!row.outside);
    itemShow(row.draft || row.base);
  }

  // ---- Bật / tắt ----
  function toggleDockViews() {
    if (dock.hidden || !getSettings().dockViews) {
      dock.hidden = false;
      lsSet(LS.settings, { ...getSettings(), dockViews: true });
    } else {
      lsSet(LS.settings, { ...getSettings(), dockViews: false });
    }
    syncDockSettingsUI();
    dockTick(true);
    setStatus(getSettings().dockViews ? 'Đã bật ô nhìn nhúng TOP / SIDE / FRONT.' : 'Đã tắt ô nhìn nhúng (dùng ô gốc của CVAT).', 'info');
  }

  function toggleItemPanel() {
    lsSet(LS.settings, { ...getSettings(), itemPanel: !getSettings().itemPanel });
    syncDockSettingsUI();
    dockTick(true);
    setStatus(getSettings().itemPanel ? 'Đã bật bảng Item.' : 'Đã tắt bảng Item.', 'info');
  }

  function syncDockSettingsUI() {
    const s = getSettings();
    const a = $('cqt-set-dock-views');
    if (a) a.checked = !!s.dockViews;
    const b = $('cqt-set-item-panel');
    if (b) b.checked = !!s.itemPanel;
  }

  function installDockHandlers() {
    if (window.__cqtDockHandlers) return;
    window.__cqtDockHandlers = true;
    window.addEventListener('mousemove', (e) => {
      dockOnMouseMove(e);
      itemOnMouseMove(e);
    });
    window.addEventListener('mouseup', guarded(async () => {
      await dockOnMouseUp();
      await itemOnMouseUp();
    }));
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (dockCancelDrag() || item.scrub) {
        if (item.scrub) {
          item.scrub = null;
          if (dock.row) dock.row.draft = null;
          dockRender();
          itemRefresh();
        }
        swallow(e);
      }
    }, true);
    window.addEventListener('resize', () => dockLayout());
    if (typeof ResizeObserver === 'function') {
      dock.observer = new ResizeObserver(() => {
        dockLayout();
        dockRender();
      });
    }
  }

  // =========================================================================
  // Giao diện (shadcn/ui High-Contrast Dark & Light Architecture v3.9.0)
  // =========================================================================
  const STYLES = `
    #cvat-quicktool-wrapper, #cqt-fc-window, #cqt-modal, #cqt-hud, .cqt-dock-view, #cqt-item-panel {
      --cqt-bg: #09090b;
      --cqt-bg-bar: #0f0f13;
      --cqt-bg-card: #141418;
      --cqt-bg-elev: #1c1c22;
      --cqt-bg-hover: #272730;
      --cqt-bg-input: #09090b;
      --cqt-bg-view: #0b0b0e;
      --cqt-border: #3f3f46;
      --cqt-border-btn: #52525b;
      --cqt-border-strong: #71717a;
      --cqt-border-subtle: #27272f;
      --cqt-text: #fafafa;
      --cqt-text-sec: #e4e4e7;
      --cqt-text-muted: #a1a1aa;
      --cqt-text-dim: #71717a;
      --cqt-pri-bg: #fafafa;
      --cqt-pri-fg: #09090b;
      --cqt-pri-hover: #e4e4e7;
      --cqt-pri-kbd-bg: rgba(9,9,11,0.12);
      --cqt-pri-kbd-bd: rgba(9,9,11,0.24);
      --cqt-row-sel: rgba(250,250,250,0.045);
      --cqt-shadow: -12px 12px 32px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06);
      --cqt-fc-shadow: 0 24px 64px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.08);
    }
    body.cqt-theme-light #cvat-quicktool-wrapper,
    body.cqt-theme-light #cqt-fc-window,
    body.cqt-theme-light #cqt-modal,
    body.cqt-theme-light #cqt-hud,
    body.cqt-theme-light .cqt-dock-view,
    body.cqt-theme-light #cqt-item-panel {
      --cqt-bg: #ffffff;
      --cqt-bg-bar: #f4f4f5;
      --cqt-bg-card: #f8fafc;
      --cqt-bg-elev: #f1f5f9;
      --cqt-bg-hover: #e4e4e7;
      --cqt-bg-input: #ffffff;
      --cqt-bg-view: #f8fafc;
      --cqt-border: #d4d4d8;
      --cqt-border-btn: #a1a1aa;
      --cqt-border-strong: #52525b;
      --cqt-border-subtle: #e4e4e7;
      --cqt-text: #09090b;
      --cqt-text-sec: #18181b;
      --cqt-text-muted: #52525b;
      --cqt-text-dim: #71717a;
      --cqt-pri-bg: #18181b;
      --cqt-pri-fg: #ffffff;
      --cqt-pri-hover: #27272a;
      --cqt-pri-kbd-bg: rgba(255,255,255,0.16);
      --cqt-pri-kbd-bd: rgba(255,255,255,0.32);
      --cqt-row-sel: rgba(24,24,27,0.055);
      --cqt-shadow: -10px 10px 28px rgba(15,23,42,0.16), 0 0 0 1px rgba(15,23,42,0.08);
      --cqt-fc-shadow: 0 20px 54px rgba(15,23,42,0.22), 0 0 0 1px rgba(15,23,42,0.1);
    }
    #cvat-quicktool-wrapper {
      position: fixed; top: 80px; right: 0; z-index: 999999;
      display: flex; align-items: flex-start;
      transform: translateX(356px);
      transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
      font-size: 12px; color: var(--cqt-text); user-select: none;
      -webkit-font-smoothing: antialiased;
    }
    #cvat-quicktool-wrapper.hover-open, #cvat-quicktool-wrapper.pinned { transform: translateX(0) !important; }
    #cvat-quicktool-handle {
      width: 24px; background: var(--cqt-bg); color: var(--cqt-text-muted); padding: 14px 4px;
      border: 1px solid var(--cqt-border-btn); border-right: none;
      border-radius: 6px 0 0 6px; cursor: pointer; font-weight: 600; font-size: 10.5px; letter-spacing: 0.8px;
      box-shadow: -4px 4px 16px rgba(0,0,0,0.35); writing-mode: vertical-rl;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
    }
    #cvat-quicktool-handle:hover { background: var(--cqt-bg-elev); color: var(--cqt-text); border-color: var(--cqt-border-strong); }
    #cvat-quicktool-wrapper.pinned #cvat-quicktool-handle {
      background: var(--cqt-bg-elev); color: var(--cqt-text); border-color: var(--cqt-border-strong);
    }
    #cvat-quicktool-panel {
      width: 356px; background: var(--cqt-bg); color: var(--cqt-text);
      border: 1px solid var(--cqt-border); border-right: none;
      border-radius: 8px 0 0 8px;
      box-shadow: var(--cqt-shadow);
      overflow: hidden; display: flex; flex-direction: column; max-height: 91vh;
    }
    #cvat-quicktool-header {
      padding: 8px 10px; background: var(--cqt-bg); display: flex; justify-content: space-between;
      align-items: center; border-bottom: 1px solid var(--cqt-border); cursor: move;
    }
    #cvat-quicktool-header .title {
      font-weight: 600; color: var(--cqt-text); display: flex; align-items: center; gap: 6px;
      font-size: 12px; letter-spacing: -0.01em;
    }
    .cqt-badge {
      background: var(--cqt-bg-elev); border: 1px solid var(--cqt-border); padding: 1px 5px; border-radius: 4px;
      color: var(--cqt-text-muted); font-size: 10px; font-weight: 500;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-variant-numeric: tabular-nums;
    }
    .cqt-badge.cqt-badge-key {
      color: #10b981; background: rgba(16,185,129,0.14); border-color: rgba(16,185,129,0.45);
    }
    .cqt-badge.cqt-badge-lerp {
      color: var(--cqt-text-muted); background: var(--cqt-bg-elev); border-color: var(--cqt-border);
    }
    .cqt-badge.cqt-badge-out {
      color: #ef4444; background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.45);
    }
    #cvat-quicktool-header .actions { display: flex; align-items: center; gap: 4px; }
    #cvat-quicktool-header .actions button {
      background: var(--cqt-bg-elev); border: 1px solid var(--cqt-border-btn); color: var(--cqt-text-sec);
      cursor: pointer; font-size: 11px; height: 24px; padding: 0 7px; border-radius: 5px;
      display: inline-flex; align-items: center; justify-content: center; gap: 4px;
      transition: all 0.12s ease;
    }
    #cvat-quicktool-header .actions button:hover:not(:disabled) {
      color: var(--cqt-text); background: var(--cqt-bg-hover); border-color: var(--cqt-border-strong);
    }
    #cvat-quicktool-header .actions button:disabled { opacity: 0.38; cursor: default; }
    #cvat-quicktool-header .actions button.active {
      color: var(--cqt-pri-fg); background: var(--cqt-pri-bg); border-color: var(--cqt-pri-bg);
    }
    .cqt-camera {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px;
      padding: 6px 10px; background: var(--cqt-bg); border-bottom: 1px solid var(--cqt-border);
    }
    .cqt-global-bar {
      background: var(--cqt-bg-bar); border-bottom: 1px solid var(--cqt-border);
      padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;
    }
    #cqt-multi-drawer {
      background: var(--cqt-bg-card); border: 1px solid var(--cqt-border); border-radius: 6px;
      padding: 6px 8px; display: none; flex-direction: column; gap: 5px; margin-top: 2px;
    }
    .cqt-btn-group-active {
      background: var(--cqt-bg-hover) !important; color: var(--cqt-text) !important; border: 1px solid var(--cqt-border-strong) !important;
    }
    /* Segmented Tabs (shadcn TabsList) */
    .cqt-tabs-wrap { padding: 6px 10px 0; background: var(--cqt-bg); }
    .cqt-tabs {
      display: flex; background: var(--cqt-bg-elev); padding: 3px; border-radius: 7px;
      border: 1px solid var(--cqt-border); gap: 2px;
    }
    .cqt-tab {
      flex: 1; height: 25px; padding: 0 6px; background: transparent; border: none;
      border-radius: 5px; color: var(--cqt-text-muted); font-size: 11px; font-weight: 500;
      cursor: pointer; transition: all 0.12s ease;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .cqt-tab.cqt-tab-icon { flex: 0 0 28px; padding: 0; }
    .cqt-tab:hover { color: var(--cqt-text); }
    .cqt-tab.active {
      color: var(--cqt-text); background: var(--cqt-bg);
      box-shadow: 0 1px 2px rgba(0,0,0,0.22), 0 0 0 1px var(--cqt-border-btn);
      font-weight: 600;
    }
    #cvat-quicktool-body {
      padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 8px;
      overflow-y: auto; min-height: 0; flex: 1 1 auto;
    }
    #cvat-quicktool-body::-webkit-scrollbar { width: 5px; }
    #cvat-quicktool-body::-webkit-scrollbar-track { background: transparent; }
    #cvat-quicktool-body::-webkit-scrollbar-thumb { background: var(--cqt-border-btn); border-radius: 99px; }
    .cqt-pane { display: none; flex-direction: column; gap: 8px; }
    .cqt-pane.active { display: flex; }
    .cqt-row { display: flex; align-items: center; gap: 5px; }
    .cqt-wrap { flex-wrap: wrap; }
    .cqt-col { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
    .cqt-label { color: var(--cqt-text-muted); font-size: 11px; font-weight: 400; }
    .cqt-h {
      font-weight: 600; color: var(--cqt-text); font-size: 11px; letter-spacing: -0.01em;
      display: flex; align-items: center; gap: 6px;
    }
    .cqt-step-badge {
      background: var(--cqt-bg-elev); color: var(--cqt-text-sec); border: 1px solid var(--cqt-border-btn);
      font-size: 9.5px; font-weight: 600; padding: 1px 5px; border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .cqt-kbd {
      background: var(--cqt-bg-input); border: 1px solid var(--cqt-border); border-radius: 4px;
      padding: 0 4px; font-size: 9.5px; line-height: 15px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--cqt-text-muted);
    }
    .cqt-btn-primary .cqt-kbd {
      background: var(--cqt-pri-kbd-bg); border-color: var(--cqt-pri-kbd-bd); color: var(--cqt-pri-fg);
    }
    .cqt-hint { font-size: 10.5px; color: var(--cqt-text-dim); line-height: 1.45; }
    .cqt-card {
      background: var(--cqt-bg-card); border: 1px solid var(--cqt-border); border-radius: 7px;
      padding: 8px 9px; display: flex; flex-direction: column; gap: 6px;
    }
    .cqt-input {
      background: var(--cqt-bg-input); border: 1px solid var(--cqt-border-btn); border-radius: 5px;
      color: var(--cqt-text); padding: 4px 7px; height: 26px; font-size: 11.5px;
      outline: none; width: 100%; box-sizing: border-box;
      font-variant-numeric: tabular-nums; transition: border-color 0.12s;
    }
    .cqt-input:focus { border-color: var(--cqt-border-strong); }
    .cqt-input.cqt-mini {
      width: 54px; height: 22px; padding: 2px 5px; font-size: 11px;
      display: inline-block; text-align: right;
    }
    /* Buttons (shadcn high-contrast variants) */
    .cqt-btn {
      background: var(--cqt-bg-elev); border: 1px solid var(--cqt-border-btn); color: var(--cqt-text-sec);
      height: 27px; padding: 0 8px; border-radius: 5px; cursor: pointer;
      font-weight: 500; font-size: 11px;
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
      flex: 1; transition: all 0.12s ease; white-space: nowrap;
    }
    .cqt-btn:hover:not(:disabled) {
      background: var(--cqt-bg-hover); color: var(--cqt-text); border-color: var(--cqt-border-strong);
    }
    .cqt-btn:disabled { opacity: 0.4; cursor: default; }
    .cqt-btn.cqt-sm { height: 24px; padding: 0 6px; font-size: 10.5px; }
    .cqt-btn.cqt-none { flex: none; }
    .cqt-btn.cqt-icon-btn { flex: 0 0 24px; width: 24px; padding: 0; }
    .cqt-btn.cqt-icon-btn.active {
      background: var(--cqt-pri-bg); color: var(--cqt-pri-fg); border-color: var(--cqt-pri-bg);
    }
    /* Primary CTA (shadcn default button) */
    .cqt-btn-primary, .cqt-btn-ground {
      background: var(--cqt-pri-bg); border-color: var(--cqt-pri-bg); color: var(--cqt-pri-fg); font-weight: 600;
    }
    .cqt-btn-primary:hover:not(:disabled), .cqt-btn-ground:hover:not(:disabled) {
      background: var(--cqt-pri-hover); border-color: var(--cqt-pri-hover); color: var(--cqt-pri-fg);
    }
    /* Secondary / Outline button */
    .cqt-btn-secondary {
      background: var(--cqt-bg-elev); border-color: var(--cqt-border-btn); color: var(--cqt-text-sec);
    }
    .cqt-btn-secondary:hover:not(:disabled) {
      background: var(--cqt-bg-hover); border-color: var(--cqt-border-strong); color: var(--cqt-text);
    }
    /* Destructive subtle outline */
    .cqt-btn-danger {
      background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.45); color: #ef4444;
    }
    .cqt-btn-danger:hover:not(:disabled) {
      background: rgba(239,68,68,0.24); border-color: rgba(239,68,68,0.7); color: #dc2626;
    }
    .cqt-divider { height: 1px; background: var(--cqt-border); margin: 2px 0; }
    .cqt-check {
      color: var(--cqt-text-sec); font-size: 11px; cursor: pointer;
      display: flex; align-items: center; gap: 6px; line-height: 1.35;
    }
    .cqt-check input[type="checkbox"] {
      margin: 0; cursor: pointer; accent-color: var(--cqt-pri-bg); width: 13px; height: 13px;
    }
    .cqt-chip {
      background: var(--cqt-bg-elev); border: 1px solid var(--cqt-border-btn); color: var(--cqt-text-sec);
      border-radius: 5px; padding: 1px 6px; font-size: 10px; font-weight: 500;
      cursor: pointer; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .cqt-chip:hover { background: var(--cqt-bg-hover); border-color: var(--cqt-border-strong); }
    /* Collapsible details (QA criteria) */
    details.cqt-collapsible {
      background: var(--cqt-bg-card); border: 1px solid var(--cqt-border); border-radius: 7px; overflow: hidden;
    }
    details.cqt-collapsible > summary {
      list-style: none; padding: 7px 9px; cursor: pointer;
      display: flex; align-items: center; justify-content: space-between;
      font-weight: 600; font-size: 11px; color: var(--cqt-text);
      transition: background 0.12s;
    }
    details.cqt-collapsible > summary::-webkit-details-marker { display: none; }
    details.cqt-collapsible > summary:hover { background: var(--cqt-bg-elev); }
    details.cqt-collapsible .cqt-collapsible-body {
      padding: 8px 9px; border-top: 1px solid var(--cqt-border);
      display: flex; flex-direction: column; gap: 6px;
    }
    .cqt-qa-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 5px 8px;
    }
    .cqt-status {
      font-size: 11px; padding: 6px 9px; margin: 0 10px 9px; border-radius: 6px;
      background: var(--cqt-bg-card); border: 1px solid var(--cqt-border); color: var(--cqt-text-muted);
      min-height: 18px; word-break: break-word; line-height: 1.4; flex: none;
    }
    .cqt-status.success {
      color: #10b981; background: rgba(16,185,129,0.12); border-color: rgba(16,185,129,0.42);
    }
    .cqt-status.error {
      color: #ef4444; background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.42);
    }
    .cqt-status.warn {
      color: #f59e0b; background: rgba(245,158,11,0.14); border-color: rgba(245,158,11,0.42);
    }
    .cqt-log {
      background: var(--cqt-bg-input); border: 1px solid var(--cqt-border); border-radius: 6px;
      color: var(--cqt-text-muted); font-size: 10.5px; line-height: 1.45; padding: 7px; margin: 0;
      max-height: 135px; overflow: auto; white-space: pre-wrap; word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    #cqt-qa-result { max-height: 240px; font-family: inherit; font-size: 11px; white-space: normal; padding: 4px; }
    .cqt-qa-row { padding: 5px 6px; border-bottom: 1px solid var(--cqt-border-subtle); cursor: pointer; border-radius: 4px; }
    .cqt-qa-row:hover { background: var(--cqt-bg-elev); }
    .cqt-qa-row b { color: var(--cqt-text); font-weight: 600; }
    .cqt-keymap-grid {
      display: grid; grid-template-columns: auto 1fr; gap: 4px 8px;
      font-size: 10.5px; color: var(--cqt-text-muted); align-items: center;
    }
    #cqt-modal {
      position: fixed; inset: 0; z-index: 1000000; background: rgba(0,0,0,0.68);
      backdrop-filter: blur(2px);
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; font-size: 12px;
    }
    .cqt-modal-box {
      width: min(640px, 92vw); max-height: 82vh; background: var(--cqt-bg); color: var(--cqt-text);
      border: 1px solid var(--cqt-border); border-radius: 8px; display: flex; flex-direction: column;
      box-shadow: 0 16px 48px rgba(0,0,0,0.55);
    }
    .cqt-modal-head {
      padding: 10px 14px; font-weight: 600; color: var(--cqt-text);
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid var(--cqt-border);
    }
    .cqt-modal-x { background: none; border: none; color: var(--cqt-text-muted); cursor: pointer; font-size: 14px; }
    .cqt-modal-x:hover { color: var(--cqt-text); }
    .cqt-modal-tools, .cqt-modal-foot { display: flex; gap: 6px; padding: 8px 14px; }
    .cqt-modal-foot { border-top: 1px solid var(--cqt-border); }
    .cqt-modal-body { overflow-y: auto; padding: 0 14px 8px; }
    .cqt-modal-section {
      margin: 10px 0 4px; color: var(--cqt-text-dim); font-weight: 600; font-size: 10.5px;
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .cqt-fix-row { display: flex; gap: 8px; align-items: flex-start; padding: 6px; border-radius: 5px; cursor: pointer; }
    .cqt-fix-row:hover { background: var(--cqt-bg-elev); }
    .cqt-fix-row input { margin-top: 2px; accent-color: var(--cqt-pri-bg); }
    .cqt-fix-detail { color: var(--cqt-text-muted); font-size: 11px; margin-top: 2px; word-break: break-word; }
    .cqt-fix-params { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin: -2px 0 6px 28px; font-size: 11px; color: var(--cqt-text-sec); }
    .cqt-fix-param { display: inline-flex; align-items: center; gap: 4px; cursor: default; }
    .cqt-fix-param select.cqt-input { width: auto; height: 22px; padding: 1px 4px; font-size: 11px; display: inline-block; }
    .cqt-input.cqt-mini.cqt-wide { width: 160px; text-align: left; }
    .cqt-fix-err { color: #ef4444; }
    /* Ô nhìn nhúng đè lên TOP / SIDE / FRONT của CVAT */
    .cqt-dock-view {
      position: fixed; z-index: 900; display: none; flex-direction: column;
      background: var(--cqt-bg-view); border: 1px solid var(--cqt-border); box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; font-size: 11px;
      color: var(--cqt-text); user-select: none; overflow: hidden;
    }
    .cqt-dock-head {
      flex: none; display: flex; align-items: center; gap: 4px; height: 20px; padding: 0 3px 0 6px;
      background: var(--cqt-bg-bar); border-bottom: 1px solid var(--cqt-border-subtle);
    }
    .cqt-dock-title { font-weight: 700; letter-spacing: 0.04em; font-size: 10px; }
    .cqt-dock-info {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--cqt-text-muted); font: 10px ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .cqt-dock-head button {
      flex: none; width: 18px; height: 16px; padding: 0; line-height: 14px; font-size: 12px; cursor: pointer;
      background: var(--cqt-bg-elev); color: var(--cqt-text-sec); border: 1px solid var(--cqt-border-btn); border-radius: 3px;
    }
    .cqt-dock-head button:hover { background: var(--cqt-bg-hover); color: var(--cqt-text); }
    .cqt-dock-view canvas { flex: 1 1 auto; min-height: 0; width: 100%; display: block; }
    .cqt-dock-empty {
      flex: 1; display: none; align-items: center; justify-content: center; text-align: center; padding: 8px;
      color: var(--cqt-text-dim);
    }
    /* Bảng Item kiểu Blender N-panel ở góc ô 3D */
    #cqt-item-panel {
      position: fixed; z-index: 950; width: 196px; display: none; flex-direction: column;
      background: var(--cqt-bg); color: var(--cqt-text); border: 1px solid var(--cqt-border);
      border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; font-size: 11px;
    }
    .cqt-item-head {
      display: flex; align-items: center; gap: 6px; padding: 4px 7px; cursor: pointer; user-select: none;
      background: var(--cqt-bg-bar); border-bottom: 1px solid var(--cqt-border-subtle);
    }
    .cqt-item-title { font-weight: 700; }
    .cqt-item-obj {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--cqt-text-muted); font: 10px ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    #cqt-item-panel.collapsed .cqt-item-body { display: none; }
    #cqt-item-panel.collapsed .cqt-item-caret { transform: rotate(-90deg); }
    .cqt-item-body { display: flex; flex-direction: column; gap: 2px; padding: 4px 7px 6px; }
    .cqt-item-sec { color: var(--cqt-text-muted); font-size: 10px; font-weight: 600; margin-top: 4px; }
    .cqt-item-row { display: flex; align-items: center; gap: 4px; }
    .cqt-item-lbl {
      width: 16px; text-align: center; cursor: ew-resize; user-select: none; font-weight: 600;
      color: var(--cqt-text-sec); border-radius: 3px;
    }
    .cqt-item-lbl:hover { background: var(--cqt-bg-hover); }
    .cqt-item-row[data-k="x"] .cqt-item-lbl, .cqt-item-row[data-k="rx"] .cqt-item-lbl { color: #ef4444; }
    .cqt-item-row[data-k="y"] .cqt-item-lbl, .cqt-item-row[data-k="ry"] .cqt-item-lbl { color: #22c55e; }
    .cqt-item-row[data-k="z"] .cqt-item-lbl, .cqt-item-row[data-k="rz"] .cqt-item-lbl { color: #3b82f6; }
    .cqt-item-in {
      flex: 1; min-width: 0; height: 20px; padding: 1px 6px; box-sizing: border-box; text-align: right;
      background: var(--cqt-bg-input); color: var(--cqt-text); border: 1px solid var(--cqt-border); border-radius: 4px;
      font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; outline: none;
    }
    .cqt-item-in:focus { border-color: var(--cqt-border-strong); }
    .cqt-item-unit { width: 12px; color: var(--cqt-text-dim); }
    .cqt-item-hint { color: var(--cqt-text-dim); font-size: 9.5px; margin-top: 4px; line-height: 1.35; }
    #cqt-item-panel.empty .cqt-item-in, #cqt-item-panel.outside .cqt-item-in { opacity: 0.5; pointer-events: none; }
    #cqt-hud {
      position: fixed; transform: translateX(-50%); z-index: 1000001;
      background: var(--cqt-bg); color: var(--cqt-text); border: 1px solid var(--cqt-border-btn);
      border-radius: 6px; padding: 5px 10px;
      font: 11.5px ui-monospace, SFMono-Regular, Menlo, monospace;
      pointer-events: none; white-space: nowrap; box-shadow: 0 4px 16px rgba(0,0,0,0.45);
    }
    /* Full Control Mode Window */
    #cqt-fc-window {
      position: fixed; z-index: 1000000; background: var(--cqt-bg); color: var(--cqt-text);
      border: 1px solid var(--cqt-border); border-radius: 8px;
      box-shadow: var(--cqt-fc-shadow);
      display: flex; flex-direction: column; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
      font-size: 12px; user-select: none; -webkit-font-smoothing: antialiased;
      --fc-row-h: 150px;
    }
    #cqt-fc-window.maximized { border-radius: 0; border: none; }
    .cqt-fc-resizer { position: absolute; z-index: 10; }
    .cqt-fc-resizer[data-dir="n"] { top: 0; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
    .cqt-fc-resizer[data-dir="s"] { bottom: 0; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
    .cqt-fc-resizer[data-dir="e"] { right: 0; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
    .cqt-fc-resizer[data-dir="w"] { left: 0; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
    .cqt-fc-resizer[data-dir="nw"] { top: 0; left: 0; width: 12px; height: 12px; cursor: nwse-resize; }
    .cqt-fc-resizer[data-dir="ne"] { top: 0; right: 0; width: 12px; height: 12px; cursor: nesw-resize; }
    .cqt-fc-resizer[data-dir="sw"] { bottom: 0; left: 0; width: 12px; height: 12px; cursor: nesw-resize; }
    .cqt-fc-resizer[data-dir="se"] { bottom: 0; right: 0; width: 14px; height: 14px; cursor: nwse-resize; }
    .cqt-fc-head {
      padding: 8px 14px; background: var(--cqt-bg); border-bottom: 1px solid var(--cqt-border);
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      cursor: move; flex: none;
    }
    .cqt-fc-title {
      font-weight: 600; font-size: 13px; color: var(--cqt-text);
      display: flex; align-items: center; gap: 7px; white-space: nowrap;
    }
    .cqt-fc-head-tools {
      display: flex; align-items: center; gap: 6px; flex: 1; max-width: 720px;
    }
    #cqt-fc-target { width: 68px; height: 24px; padding: 2px 6px; font-weight: 600; }
    .cqt-fc-progress {
      width: 110px; height: 7px; background: var(--cqt-bg-elev); border: 1px solid var(--cqt-border-btn);
      border-radius: 99px; overflow: hidden; flex: none;
    }
    #cqt-fc-progress-bar { height: 100%; width: 0%; background: var(--cqt-pri-bg); transition: width 0.15s ease; }
    .cqt-fc-head-actions { display: flex; align-items: center; gap: 5px; }
    .cqt-fc-bar {
      padding: 6px 14px; background: var(--cqt-bg-bar); border-bottom: 1px solid var(--cqt-border);
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: none;
    }
    .cqt-fc-bar.cqt-fc-batch { background: var(--cqt-bg-card); }
    .cqt-fc-bar .cqt-btn { flex: none; }
    .cqt-fc-seg {
      display: inline-flex; background: var(--cqt-bg-elev); border: 1px solid var(--cqt-border-btn);
      border-radius: 6px; padding: 2px; gap: 2px;
    }
    .cqt-fc-seg button {
      background: transparent; border: none; color: var(--cqt-text-muted); font-size: 11px; font-weight: 500;
      height: 22px; padding: 0 8px; border-radius: 4px; cursor: pointer;
      display: inline-flex; align-items: center; gap: 4px; transition: all 0.12s;
    }
    .cqt-fc-seg button:hover { color: var(--cqt-text); }
    .cqt-fc-seg button.active {
      background: var(--cqt-bg); color: var(--cqt-text); font-weight: 600; box-shadow: 0 0 0 1px var(--cqt-border-btn);
    }
    .cqt-fc-seg button span {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; color: var(--cqt-text-dim);
    }
    .cqt-fc-ctl {
      display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--cqt-text-muted);
    }
    .cqt-fc-ctl input[type="range"] { width: 72px; accent-color: var(--cqt-pri-bg); cursor: pointer; }
    .cqt-fc-ctl select.cqt-input { width: auto; height: 24px; padding: 2px 6px; font-size: 11px; }
    .cqt-fc-sep { width: 1px; height: 16px; background: var(--cqt-border); display: inline-block; margin: 0 2px; }
    .cqt-fc-hint { margin-left: auto; font-size: 10.5px; color: var(--cqt-text-dim); }
    .cqt-fc-cols {
      display: grid; grid-template-columns: 140px 1fr 1fr 1fr 1.12fr 214px;
      background: var(--cqt-bg-bar); border-bottom: 1px solid var(--cqt-border);
      font-size: 10.5px; font-weight: 600; color: var(--cqt-text-muted); flex: none;
    }
    #cqt-fc-window.hide-3d .cqt-fc-cols,
    #cqt-fc-window.hide-3d .cqt-fc-row {
      grid-template-columns: 140px 1fr 1fr 1fr 214px;
    }
    #cqt-fc-window.hide-3d [data-col="3d"],
    #cqt-fc-window.hide-3d [data-view-cell="3d"] {
      display: none;
    }
    .cqt-fc-cols > div { padding: 5px 10px; border-right: 1px solid var(--cqt-border); }
    .cqt-fc-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; background: var(--cqt-bg); }
    .cqt-fc-list::-webkit-scrollbar { width: 6px; }
    .cqt-fc-list::-webkit-scrollbar-track { background: transparent; }
    .cqt-fc-list::-webkit-scrollbar-thumb { background: var(--cqt-border-btn); border-radius: 99px; }
    .cqt-fc-empty { padding: 48px 20px; text-align: center; color: var(--cqt-text-dim); font-size: 12px; }
    .cqt-fc-row {
      display: grid; grid-template-columns: 140px 1fr 1fr 1fr 1.12fr 214px;
      height: var(--fc-row-h, 150px); border-bottom: 1px solid var(--cqt-border);
      background: var(--cqt-bg); transition: background 0.1s;
    }
    .cqt-fc-row.selected { background: var(--cqt-row-sel); box-shadow: inset 3px 0 0 var(--cqt-pri-bg); }
    .cqt-fc-row.current .cqt-fc-frame { color: #10b981; }
    .cqt-fc-row.outside { opacity: 0.55; }
    .cqt-fc-row.fill-source { box-shadow: inset 3px 0 0 #10b981; background: rgba(16,185,129,0.08); }
    .cqt-fc-row.fill-target { box-shadow: inset 3px 0 0 var(--cqt-border-strong); background: var(--cqt-row-sel); }
    .cqt-fc-cell { border-right: 1px solid var(--cqt-border); min-width: 0; min-height: 0; position: relative; }
    .cqt-fc-meta {
      padding: 8px; display: flex; flex-direction: column; justify-content: space-between; gap: 4px;
    }
    .cqt-fc-sel {
      display: flex; align-items: center; gap: 6px; cursor: pointer;
      padding: 3px 4px; border-radius: 5px; border: 1px solid transparent;
    }
    .cqt-fc-sel:hover { background: var(--cqt-bg-elev); border-color: var(--cqt-border-btn); }
    .cqt-fc-check {
      width: 13px; height: 13px; border: 1px solid var(--cqt-border-btn); border-radius: 3px;
      display: inline-block; position: relative; flex: none;
    }
    .cqt-fc-row.selected .cqt-fc-check { background: var(--cqt-pri-bg); border-color: var(--cqt-pri-bg); }
    .cqt-fc-row.selected .cqt-fc-check::after {
      content: ''; position: absolute; left: 3.5px; top: 1px; width: 4px; height: 7px;
      border: solid var(--cqt-pri-fg); border-width: 0 1.8px 1.8px 0; transform: rotate(45deg);
    }
    .cqt-fc-frame {
      font-weight: 600; font-size: 11.5px; color: var(--cqt-text);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-variant-numeric: tabular-nums;
    }
    .cqt-fc-actions { display: flex; gap: 4px; }
    .cqt-fc-fill {
      font-size: 10.5px; font-weight: 500; color: var(--cqt-text-sec); background: var(--cqt-bg-card);
      border: 1px dashed var(--cqt-border-btn); border-radius: 4px; padding: 3px 6px;
      text-align: center; cursor: ns-resize; transition: all 0.12s;
    }
    .cqt-fc-fill:hover { color: var(--cqt-text); border-color: var(--cqt-border-strong); background: var(--cqt-bg-elev); }
    .cqt-fc-view { overflow: hidden; background: var(--cqt-bg-view); }
    .cqt-fc-view canvas { width: 100%; height: 100%; display: block; }
    .cqt-fc-params {
      padding: 6px 8px; display: flex; flex-direction: column; justify-content: space-between; gap: 3px;
    }
    .cqt-fc-grid6 { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 6px; }
    .cqt-fc-grid6 label {
      display: flex; align-items: center; justify-content: space-between; gap: 4px;
      font-size: 10px; color: var(--cqt-text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .cqt-fc-grid6 input.cqt-input {
      width: 56px; height: 19px; padding: 1px 4px; font-size: 10.5px; text-align: right;
    }
    .cqt-fc-info {
      font-size: 9.5px; line-height: 1.3; color: var(--cqt-text-dim);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-line;
    }
    .cqt-fc-status {
      padding: 6px 14px; background: var(--cqt-bg-bar); border-top: 1px solid var(--cqt-border);
      font-size: 11px; color: var(--cqt-text-muted); flex: none;
    }
    .cqt-fc-status.success { color: #10b981; }
    .cqt-fc-status.error { color: #ef4444; }
    .cqt-fc-status.warn { color: #f59e0b; }
  `;

  const PANEL_HTML = `
    <div id="cvat-quicktool-handle" title="Di chuột để mở, bấm để ghim (${ALT_SYM}Q)"><span>TOOLBOX</span></div>
    <div id="cvat-quicktool-panel">
      <div id="cvat-quicktool-header" title="Kéo để di chuyển panel theo chiều dọc">
        <div class="title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          <span>CVAT Cuboid</span>
          <span class="cqt-badge">v${VERSION}</span>
        </div>
        <div class="actions">
          <button id="cqt-btn-full-control" title="Mở chế độ Full Control đa frame (${ALT_SYM}M)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            <span>Full</span>
          </button>
          <button id="cqt-btn-theme" title="Đổi giao diện Sáng / Tối (Light / Dark Mode)">
            <span id="cqt-theme-label">Sáng</span>
          </button>
          <button id="cqt-btn-undo-quick" disabled title="Hoàn tác Snapshot gần nhất (${ALT_SYM}Z)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
            <span>Undo</span> <span id="cqt-undo-count"></span>
          </button>
          <button id="cqt-btn-pin" title="Ghim / Bỏ ghim panel (${ALT_SYM}Q)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
          </button>
          <button id="cqt-btn-close" title="Thu gọn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <!-- Thanh Camera: khớp thứ tự phím 1 (Front) - 2 (Top) - 3 (Side) & F (Focus) -->
      <div class="cqt-camera">
        <button data-cam="focus" class="cqt-btn cqt-btn-secondary cqt-sm" title="Focus vào object (${ALT_SYM}F hoặc Numpad .)">Focus <span class="cqt-kbd">F</span></button>
        <button data-cam="front" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nhìn đầu xe (${ALT_SYM}1 / Numpad 1) · Giữ Shift = Đuôi xe">Front <span class="cqt-kbd">1</span></button>
        <button data-cam="top" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nhìn từ trên (${ALT_SYM}2 hoặc ${ALT_SYM}7 / Numpad 7) · Giữ Shift = Từ dưới">Top <span class="cqt-kbd">2</span></button>
        <button data-cam="side" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nhìn sườn xe (${ALT_SYM}3 / Numpad 3) · Giữ Shift = Sườn phải">Side <span class="cqt-kbd">3</span></button>
      </div>

      <!-- Thanh Global Bar: Hợp nhất Target ID, Lock, Nhóm, Dải Frame & Keyframe Stepper -->
      <div class="cqt-global-bar">
        <div class="cqt-row" style="justify-content:space-between;">
          <div class="cqt-row" style="gap:4px;">
            <span class="cqt-label" style="font-weight:600; color:var(--cqt-text);">Target</span>
            <input type="number" id="cqt-target-id" class="cqt-input" placeholder="ID" style="width:54px; height:24px; padding:2px 5px; font-weight:600;" title="Nhập ID object hoặc chọn trên canvas" />
            <button id="cqt-btn-lock-target" class="cqt-btn cqt-btn-secondary cqt-sm cqt-icon-btn" title="Khoá Target ID hiện tại (không tự đổi khi click sang box khác)">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </button>
            <button id="cqt-btn-detect" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Lấy object đang chọn (${ALT_SYM}A = Lấy object + Tự dò dải frame)">Auto <span class="cqt-kbd">${ALT_SYM}A</span></button>
            <button id="cqt-btn-add-selection" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Thêm/bớt object vào nhóm chọn nhiều box (Shift/Cmd + Click trên canvas)">Nhóm (<span id="cqt-multi-count">0</span>)</button>
          </div>
          <span class="cqt-label">F <b id="cqt-current-frame" style="color:var(--cqt-text); font-variant-numeric:tabular-nums;">?</b></span>
        </div>

        <div class="cqt-row" style="gap:4px;">
          <span class="cqt-label">Dải</span>
          <input type="number" id="cqt-frame-start" class="cqt-input" value="0" style="width:52px; height:24px; padding:2px 5px;" title="Start Frame" />
          <span style="color:var(--cqt-text-dim);">→</span>
          <input type="number" id="cqt-frame-end" class="cqt-input" value="0" style="width:52px; height:24px; padding:2px 5px;" title="End Frame" />
          <input type="number" min="1" id="cqt-frame-count" class="cqt-input" value="1" style="width:44px; height:24px; padding:2px 5px;" title="Tổng số frame" />
          <button id="cqt-btn-detect-span" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" style="margin-left:auto;" title="Dò frame đầu/cuối của object trong job (${ALT_SYM}A)">Dò dải</button>
        </div>

        <!-- Keyframe Stepper của riêng Target -->
        <div id="cqt-kf-stepper-row" class="cqt-row" style="gap:3px;">
          <span class="cqt-label" style="margin-right:2px;">Key</span>
          <span id="cqt-kf-badge" class="cqt-badge">--</span>
          <button id="cqt-btn-kf-first" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nhảy tới Keyframe đầu tiên của Target">|&lt; Đầu</button>
          <button id="cqt-btn-kf-prev" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nhảy về Keyframe liền trước của Target">&lt; Trước</button>
          <button id="cqt-btn-kf-toggle" class="cqt-btn cqt-btn-secondary cqt-sm" title="Đặt keyframe tại frame hiện tại (${ALT_SYM}K) — không gỡ keyframe">+Key <span class="cqt-kbd">${ALT_SYM}K</span></button>
          <button id="cqt-btn-kf-next" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nhảy tới Keyframe liền sau của Target">Sau &gt;</button>
          <button id="cqt-btn-kf-last" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nhảy tới Keyframe cuối cùng của Target">Cuối &gt;|</button>
        </div>

        <!-- Ngăn kéo Nhóm chọn nhiều box -->
        <div id="cqt-multi-drawer">
          <div class="cqt-row" style="justify-content:space-between;">
            <span class="cqt-label" style="color:var(--cqt-text); font-weight:500;">Nhóm đang chọn (Shift/Cmd+Click)</span>
            <div class="cqt-row" style="gap:3px;">
              <button id="cqt-btn-multi-select-all" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Chọn tất cả cuboid trong frame hiện tại">+Tất cả</button>
              <button id="cqt-btn-multi-clear" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Xoá danh sách nhóm">Bỏ chọn</button>
            </div>
          </div>
          <div id="cqt-multi-list" class="cqt-row cqt-wrap" style="gap:4px;"></div>
        </div>
      </div>

      <!-- Segmented Tabs (shadcn TabsList) -->
      <div class="cqt-tabs-wrap">
        <div class="cqt-tabs">
          <button class="cqt-tab active" data-tab="object">Box</button>
          <button class="cqt-tab" data-tab="ground">Ground</button>
          <button class="cqt-tab" data-tab="track">Track</button>
          <button class="cqt-tab" data-tab="qa">QA</button>
          <button class="cqt-tab cqt-tab-icon" data-tab="settings" title="Cài đặt tính năng, phím tắt & Limits LWH">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
      </div>

      <div id="cvat-quicktool-body">
        <!-- ================= 1. BOX (LWH, ANCHOR RESIZE, MICRO-NUDGE, SUB-LABEL) ================= -->
        <div class="cqt-pane active" data-pane="object">
          <!-- Cụm 1: Smart Snap & Clipboard -->
          <div class="cqt-card">
            <div class="cqt-row">
              <button id="cqt-btn-smart-snap" class="cqt-btn cqt-btn-primary" title="Hút box (hoặc cả Nhóm) theo cụm điểm LiDAR + xoay yaw + chạm đất (${ALT_SYM}S)">Smart Snap <span class="cqt-kbd">${ALT_SYM}S</span></button>
              <label class="cqt-check" style="flex:none;" title="Bật: tính lại cả L/W/H theo cụm điểm. Tắt: giữ LWH, bám mặt gần cảm biến."><input type="checkbox" id="cqt-snap-fit-size" /> Fit size</label>
            </div>
            <div class="cqt-row" style="gap:4px;">
              <button id="cqt-btn-copy-transform" class="cqt-btn cqt-btn-secondary cqt-sm" title="Copy toạ độ, góc xoay và LWH của box">Copy Box</button>
              <button id="cqt-btn-paste-transform" class="cqt-btn cqt-btn-secondary cqt-sm" title="Dán transform đã copy vào box ở frame hiện tại">Paste Box</button>
              <button id="cqt-btn-multi-select-all-box" class="cqt-btn cqt-btn-secondary cqt-sm" title="Chọn tất cả box trong frame hiện tại vào Nhóm">Chọn hết frame</button>
            </div>
          </div>

          <!-- Cụm 2: Kích thước LWH, Preset & Anchor-Face Resize -->
          <div class="cqt-card">
            <div class="cqt-row" style="justify-content:space-between;">
              <span class="cqt-h">Kích thước LWH (m)</span>
              <button id="cqt-btn-get-lwh" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Đọc LWH từ box đang chọn">Lấy size</button>
            </div>

            <div class="cqt-row" style="gap:4px;">
              <select id="cqt-preset-select" class="cqt-input" style="height:25px; padding:2px 6px;" title="Preset LWH theo label"></select>
              <button id="cqt-btn-preset-apply" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Điền preset vào ô LWH">Nạp</button>
              <button id="cqt-btn-preset-save" class="cqt-btn cqt-btn-secondary cqt-sm cqt-icon-btn" title="Lưu LWH hiện tại làm preset cho label này">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              </button>
              <button id="cqt-btn-preset-delete" class="cqt-btn cqt-btn-danger cqt-sm cqt-icon-btn" title="Xoá preset đang chọn">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>

            <div class="cqt-row">
              <div class="cqt-col"><span class="cqt-label">L (Dài)</span><input type="number" step="0.01" id="cqt-lwh-l" class="cqt-input" /></div>
              <div class="cqt-col"><span class="cqt-label">W (Rộng)</span><input type="number" step="0.01" id="cqt-lwh-w" class="cqt-input" /></div>
              <div class="cqt-col"><span class="cqt-label">H (Cao)</span><input type="number" step="0.01" id="cqt-lwh-h" class="cqt-input" /></div>
            </div>

            <!-- Anchor-Face Resize -->
            <div id="cqt-lwh-anchor-row" class="cqt-row" style="justify-content:space-between;">
              <span class="cqt-label">Neo mặt khi đổi L/W</span>
              <select id="cqt-lwh-anchor" class="cqt-input" style="width:185px; height:24px; padding:2px 6px;" title="Chọn mặt giữ cố định khi thay đổi chiều Dài (L) hoặc Rộng (W)">
                <option value="center">Tâm box (Mặc định)</option>
                <option value="sensor">Mặt gần cảm biến LiDAR</option>
                <option value="front">Mặt trước (+X) — mở rộng đuôi</option>
                <option value="back">Mặt sau (-X) — mở rộng đầu</option>
                <option value="left">Sườn trái (+Y) — mở rộng phải</option>
                <option value="right">Sườn phải (-Y) — mở rộng trái</option>
              </select>
            </div>

            <div class="cqt-row" style="justify-content:space-between;">
              <label class="cqt-check" title="Giữ nguyên cao độ đáy khi thay đổi H"><input type="checkbox" id="cqt-keep-ground" checked /> Giữ đáy</label>
              <label class="cqt-check" title="Áp dụng dải chỉ sửa keyframe"><input type="checkbox" id="cqt-lwh-keyframe-only" checked /> Chỉ keyframe</label>
            </div>

            <div class="cqt-row" style="gap:4px;">
              <button id="cqt-btn-apply-frame" class="cqt-btn cqt-btn-secondary" title="Chỉ sửa LWH tại frame hiện tại">Frame này</button>
              <button id="cqt-btn-apply-lwh" class="cqt-btn cqt-btn-secondary" title="Áp dụng LWH cho dải Start–End">Dải Start–End</button>
              <button id="cqt-btn-sync-track" class="cqt-btn cqt-btn-primary" title="Đồng bộ LWH cho mọi keyframe toàn track (${ALT_SYM}D)">Toàn track <span class="cqt-kbd">${ALT_SYM}D</span></button>
            </div>
          </div>

          <!-- Cụm 3: Local Micro-Nudge (Nhích toạ độ theo hệ trục của xe) -->
          <div id="cqt-micro-nudge-card" class="cqt-card">
            <div class="cqt-row" style="justify-content:space-between;">
              <span class="cqt-h">Nhích vi chỉnh (Trục cục bộ xe)</span>
              <div class="cqt-row" style="gap:4px;">
                <input type="number" step="0.01" min="0.01" id="cqt-nudge-step" class="cqt-input cqt-mini" value="0.05" title="Bước nhích toạ độ (m)" />
                <span class="cqt-label">m</span>
                <select id="cqt-nudge-scope" class="cqt-input" style="width:94px; height:22px; padding:1px 4px; font-size:10.5px;" title="Phạm vi áp dụng nhích toạ độ">
                  <option value="frame">Frame này</option>
                  <option value="range">Dải Start–End</option>
                  <option value="keyframes">Toàn Keyframe</option>
                </select>
              </div>
            </div>
            <div class="cqt-row" style="gap:4px;">
              <button data-nudge="X:1" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nhích tiến theo hướng mũi xe (+X local)">Tiến +X</button>
              <button data-nudge="X:-1" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nhích lùi theo hướng đuôi xe (-X local)">Lùi -X</button>
              <button data-nudge="Y:1" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nhích sang sườn trái (+Y local)">Trái +Y</button>
              <button data-nudge="Y:-1" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nhích sang sườn phải (-Y local)">Phải -Y</button>
            </div>
            <div class="cqt-row" style="gap:4px;">
              <button data-nudge="Z:1" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nâng cao độ +Z">Lên +Z</button>
              <button data-nudge="Z:-1" class="cqt-btn cqt-btn-secondary cqt-sm" title="Hạ cao độ -Z">Xuống -Z</button>
              <button data-nudge="YAW:-1" class="cqt-btn cqt-btn-secondary cqt-sm" title="Xoay góc đầu -1°">-1° Yaw</button>
              <button data-nudge="YAW:1" class="cqt-btn cqt-btn-secondary cqt-sm" title="Xoay góc đầu +1°">+1° Yaw</button>
            </div>
          </div>

          <!-- Cụm 4: Sub-label (Thuộc tính) -->
          <div class="cqt-card">
            <div class="cqt-row" style="justify-content:space-between;">
              <span class="cqt-h">Sub-label <span id="cqt-attr-label" style="color:var(--cqt-text-muted); font-weight:500;"></span></span>
              <div class="cqt-row" style="gap:3px;">
                <button id="cqt-btn-attr-all-on" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Tick tất cả">Bật hết</button>
                <button id="cqt-btn-attr-all-off" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Bỏ tick tất cả">Tắt hết</button>
                <button id="cqt-btn-attr-all-keep" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Giữ nguyên tất cả">Giữ</button>
                <button id="cqt-btn-attr-load" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Nạp danh sách sub-label của object">Nạp</button>
              </div>
            </div>
            <div id="cqt-attr-list" class="cqt-hint">Chọn object trên canvas hoặc bấm "Auto" để nạp sub-label.</div>
            <div class="cqt-row">
              <select id="cqt-attr-scope" class="cqt-input" style="height:26px; padding:2px 6px;">
                <option value="track">Phạm vi: Toàn track</option>
                <option value="frame">Phạm vi: Frame hiện tại</option>
                <option value="range">Phạm vi: Dải Start–End</option>
              </select>
              <button id="cqt-btn-attr-apply" class="cqt-btn cqt-btn-primary cqt-none" title="Áp sub-label cho Target hoặc Nhóm đang chọn">Áp dụng</button>
            </div>
            <label class="cqt-check" title="Khi click chọn object mới trên canvas, tự áp bộ sub-label đã lưu của label đó"><input type="checkbox" id="cqt-attr-auto" /> Tự áp khi chọn object mới</label>
          </div>

          <div class="cqt-hint">Trên canvas 3D: bấm <b>G</b> (di chuyển) · <b>W</b> (xoay) · <b>S</b> (co giãn) · <b>X/Y/Z</b> khoá trục · giữ <b>Shift/Ctrl</b> bắt bước. Áp cho cả nhóm nếu đã Shift/Cmd+Click.</div>
        </div>

        <!-- ================= 2. GROUND (CHIA 2 BƯỚC RÕ RÀNG) ================= -->
        <div class="cqt-pane" data-pane="ground">
          <div class="cqt-card">
            <span class="cqt-h"><span class="cqt-step-badge">01</span> Nguồn mặt phẳng đất</span>
            <div id="cqt-plane-display" class="cqt-hint" style="background:var(--cqt-bg-input); padding:6px 8px; border-radius:5px; border:1px solid var(--cqt-border);">Chưa có mặt đất — chọn nguồn bên dưới hoặc bấm ${ALT_SYM}G.</div>
            <div class="cqt-row" style="gap:4px;">
              <button id="cqt-btn-calc-plane" class="cqt-btn cqt-btn-secondary cqt-sm" title="Fit mặt phẳng dốc 3D từ point cloud quanh box">Từ Cloud</button>
              <button id="cqt-btn-ground-ref-boxes" class="cqt-btn cqt-btn-secondary cqt-sm" title="Dựng mặt phẳng dốc 3D từ xe chuẩn (Anchor) ở frame hiện tại">Từ Anchor</button>
              <button id="cqt-btn-ground-prev-frame" class="cqt-btn cqt-btn-secondary cqt-sm" title="Lấy lại mặt phẳng đất của frame liền trước">Frame trước</button>
            </div>
            <div class="cqt-row">
              <div class="cqt-col" style="flex:1.3;">
                <span class="cqt-label">Anchor ID (chuỗi ưu tiên)</span>
                <input type="text" id="cqt-ground-ref-ids" class="cqt-input" placeholder="vd: 1 hoặc 1, 4" title="Nhập 1 xe chuẩn hoặc chuỗi kế nhiệm (vd: 1, 4)" />
              </div>
              <div class="cqt-col" style="flex:1;">
                <span class="cqt-label">Hoặc Z phẳng (m)</span>
                <input type="number" step="0.01" id="cqt-ground-z" class="cqt-input" placeholder="vd: -1.70" />
              </div>
            </div>
          </div>

          <div class="cqt-card">
            <span class="cqt-h"><span class="cqt-step-badge">02</span> Chế độ &amp; Hạ chạm đất</span>
            <div class="cqt-row">
              <div class="cqt-col">
                <span class="cqt-label">Cách đặt</span>
                <select id="cqt-ground-mode" class="cqt-input">
                  <option value="snap">Snap đáy (giữ nghiêng)</option>
                  <option value="flat">Đặt phẳng (rx=ry=0)</option>
                  <option value="tilt">Nghiêng theo dốc</option>
                </select>
              </div>
              <div class="cqt-col">
                <span class="cqt-label">Phạm vi dải</span>
                <select id="cqt-ground-scope" class="cqt-input">
                  <option value="current_to_end">Frame này → Hết dải</option>
                  <option value="whole">Toàn dải Start–End</option>
                  <option value="keyframes">Chỉ keyframe dải</option>
                  <option value="current">Chỉ frame hiện tại</option>
                </select>
              </div>
              <div class="cqt-col" style="flex:0.75;">
                <span class="cqt-label">Hướng</span>
                <select id="cqt-ground-direction" class="cqt-input">
                  <option value="both">Cả hai</option>
                  <option value="down">Chỉ hạ</option>
                  <option value="up">Chỉ nâng</option>
                </select>
              </div>
            </div>

            <label class="cqt-check" title="Khi thiếu điểm cloud hoặc Anchor bị outside sẽ tự kế thừa plane hợp lệ trước đó"><input type="checkbox" id="cqt-ground-auto-fallback" checked /> Tự kế thừa plane frame trước khi mất cloud / Anchor</label>

            <div class="cqt-row" style="gap:4px;">
              <button id="cqt-btn-apply-ground-frame" class="cqt-btn cqt-btn-primary" title="Hạ chạm đất tại frame hiện tại theo plane đang lưu (hoặc bấm ${ALT_SYM}G tự đo cloud cục bộ)">Fit Frame này <span class="cqt-kbd">${ALT_SYM}G</span></button>
              <button id="cqt-btn-apply-ground" class="cqt-btn cqt-btn-secondary" title="Fit Target trong phạm vi dải theo plane đang lưu ở Bước 1">Fit dải (plane Bước 1)</button>
              <button id="cqt-btn-check-ground" class="cqt-btn cqt-btn-secondary cqt-none" title="Đo độ lệch đáy của track so với mặt đất trong dải">Đo đáy</button>
            </div>

            <div class="cqt-row" style="gap:4px;">
              <button id="cqt-btn-ground-follow-ref" class="cqt-btn cqt-btn-secondary" title="Duyệt dải bám theo chuỗi Anchor (siêu nhanh <0.5s), chỉ fit cho Target / Nhóm đang chọn">Bám Anchor dải</button>
              <button id="cqt-btn-ground-sweep-cloud" class="cqt-btn cqt-btn-secondary" title="Tự chuyển từng frame để nạp cloud và fit mặt đất độc lập (chuẩn xác 100% theo LiDAR)">Quét Cloud dải</button>
            </div>
          </div>
        </div>

        <!-- ================= 3. TRACK (HƯỚNG + KEYFRAME/OUTSIDE + NỘI SUY + DỊCH) ================= -->
        <div class="cqt-pane" data-pane="track">
          <label class="cqt-check"><input type="checkbox" id="cqt-track-keyframe-only" checked /> Chỉ sửa keyframe trong dải (frame nội suy tự theo)</label>

          <!-- Cụm 0: Snap cả sequence -->
          <div class="cqt-card">
            <span class="cqt-h">Snap cả sequence (khoá LWH)</span>
            <div class="cqt-hint">Snap từng frame theo cụm điểm, làm mượt quỹ đạo (frame ít điểm thì suy đoán từ chuyển động), rồi chỉ thêm keyframe ở chỗ nội suy bị lệch. Áp cho Target hoặc cả nhóm.</div>
            <div class="cqt-row">
              <div class="cqt-col"><span class="cqt-label">Phạm vi</span>
                <select id="cqt-seq-scope" class="cqt-input"><option value="track">Toàn track</option><option value="range">Dải Start–End</option></select></div>
              <div class="cqt-col"><span class="cqt-label">Độ mượt</span>
                <select id="cqt-seq-smooth" class="cqt-input"><option value="tight">Bám sát</option><option value="normal" selected>Vừa</option><option value="smooth">Mượt</option></select></div>
            </div>
            <div class="cqt-row">
              <div class="cqt-col"><span class="cqt-label">Thêm keyframe khi lệch &gt; (m)</span><input type="number" step="0.01" id="cqt-seq-tol-pos" class="cqt-input" value="0.1" /></div>
              <div class="cqt-col"><span class="cqt-label">hoặc góc &gt; (°)</span><input type="number" step="0.5" id="cqt-seq-tol-yaw" class="cqt-input" value="2" /></div>
            </div>
            <div class="cqt-row">
              <button id="cqt-btn-seq-snap" class="cqt-btn cqt-btn-primary" title="Đọc cloud từng frame, căn box trên cả sequence; xem trước trước khi sửa">Snap cả sequence (xem trước)</button>
            </div>
          </div>

          <!-- Cụm 1: Hướng (Yaw) -->
          <div class="cqt-card">
            <span class="cqt-h">Hướng &amp; Góc xoay (Yaw)</span>
            <div class="cqt-row" style="justify-content:space-between; background:var(--cqt-bg-input); border:1px solid var(--cqt-border); padding:5px 8px; border-radius:5px;">
              <span class="cqt-label">Góc đầu: <b id="cqt-val-yaw" style="color:var(--cqt-text);">--</b> (<span id="cqt-val-yaw-rad">--</span>)</span>
              <span class="cqt-label">Hướng đi: <b id="cqt-val-motion" style="color:var(--cqt-text);">--</b></span>
            </div>
            <div id="cqt-val-deviation" style="font-weight:500; font-size:11px; color:var(--cqt-text-muted);">Chọn object hoặc bấm Auto (${ALT_SYM}A) để đo độ lệch hướng</div>

            <div class="cqt-row" style="gap:4px;">
              <button id="cqt-btn-quick-fix-heading" class="cqt-btn cqt-btn-primary cqt-sm" title="Xoay đầu theo hướng di chuyển tại frame hiện tại (${ALT_SYM}Shift+R)">Nắn theo hướng đi</button>
              <button id="cqt-btn-quick-fix-cloud" class="cqt-btn cqt-btn-secondary cqt-sm" title="Xoay theo cạnh cụm điểm LiDAR tại frame hiện tại">Nắn theo Cloud</button>
            </div>

            <div class="cqt-row" style="gap:4px;">
              <button data-rotate="180" class="cqt-btn cqt-btn-secondary cqt-sm" title="Lật ngược đầu xe 180° (${ALT_SYM}R)">180° <span class="cqt-kbd">${ALT_SYM}R</span></button>
              <button data-rotate="90" class="cqt-btn cqt-btn-secondary cqt-sm">+90°</button>
              <button data-rotate="-90" class="cqt-btn cqt-btn-secondary cqt-sm">-90°</button>
              <input type="number" step="1" id="cqt-rotate-deg" class="cqt-input" value="180" style="width:52px; height:24px; padding:2px 4px;" title="Số độ xoay tuỳ chỉnh" />
              <button id="cqt-btn-rotate-angle" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Xoay theo góc đã nhập">Xoay</button>
            </div>

            <div class="cqt-row" style="gap:4px;">
              <button id="cqt-btn-sync-yaw" class="cqt-btn cqt-btn-secondary cqt-sm" title="Lấy góc yaw ở frame hiện tại áp cho mọi keyframe toàn track">Đồng bộ góc track</button>
              <button id="cqt-btn-align-yaw" class="cqt-btn cqt-btn-secondary cqt-sm" title="Căn đầu xe theo hướng di chuyển trên cả dải">Căn hướng dải</button>
              <button id="cqt-btn-fix-yaw-jumps" class="cqt-btn cqt-btn-secondary cqt-sm" title="Tự tìm các frame bị lật ngược đầu 180° trong track để sửa">Sửa lật đầu</button>
            </div>
          </div>

          <div class="cqt-card">
            <span class="cqt-h">Chuyển động xe LiDAR</span>
            <label class="cqt-check" title="Cloud theo toạ độ cảm biến thì xe đỗ trông như chạy ngược xe LiDAR. Bật để trừ chuyển động đó trước khi lấy hướng đi."><input type="checkbox" id="cqt-ego-comp" checked /> Trừ chuyển động xe LiDAR khi lấy hướng đi</label>
            <div class="cqt-row">
              <button id="cqt-btn-ego-measure" class="cqt-btn cqt-btn-secondary cqt-sm" title="Đi qua mọi frame, khớp nền tĩnh giữa các frame (ICP) để biết xe LiDAR di chuyển thế nào">Đo chuyển động xe LiDAR (cả job)</button>
            </div>
            <div id="cqt-ego-info" class="cqt-hint">Chưa đo. Các nút hướng đi sẽ tự đo phần frame cần dùng.</div>
          </div>

          <!-- Cụm 2: Quản lý Keyframe, Nội suy & Cắt Track (Outside) -->
          <div class="cqt-card">
            <span class="cqt-h">Keyframe, Nội suy &amp; Cắt Track</span>
            <div class="cqt-row" style="gap:4px;">
              <button id="cqt-btn-toggle-keyframe" class="cqt-btn cqt-btn-secondary cqt-sm" title="Đặt keyframe tại frame hiện tại cho Target / Nhóm (${ALT_SYM}K). Quy định dự án: không gỡ keyframe.">Đặt Key <span class="cqt-kbd">${ALT_SYM}K</span></button>
              <button id="cqt-btn-smooth" class="cqt-btn cqt-btn-secondary cqt-sm" title="Làm mượt quỹ đạo di chuyển giữa các keyframe">Smooth</button>
            </div>
            <div id="cqt-reinterp-row" class="cqt-row" style="gap:4px;">
              <button id="cqt-btn-reinterpolate" class="cqt-btn cqt-btn-secondary cqt-sm" title="Nội suy tuyến tính toạ độ + góc xoay (wrapPi) + LWH từ Start Frame tới End Frame">Nội suy tuyến tính Start → End</button>
            </div>
            <div class="cqt-row" style="gap:4px;">
              <button id="cqt-btn-cut-track-end" class="cqt-btn cqt-btn-danger" title="Đặt outside = true từ frame hiện tại tới hết track để xe biến mất hẳn (${ALT_SYM}X)">Cắt đuôi Track tới hết <span class="cqt-kbd">${ALT_SYM}X</span></button>
            </div>
            <div class="cqt-row" style="gap:4px;">
              <button id="cqt-btn-multi-outside" class="cqt-btn cqt-btn-secondary cqt-sm" title="Chỉ đặt outside tại frame hiện tại cho Target / Nhóm">Outside frame này</button>
              <button id="cqt-btn-cut-far" class="cqt-btn cqt-btn-secondary cqt-sm" title="Tìm và đặt outside các đoạn track xa hơn ngưỡng QA">Cắt đoạn quá xa</button>
            </div>
          </div>

          <!-- Cụm 3: Dịch chuyển dải (Global XYZ) -->
          <div class="cqt-card">
            <span class="cqt-h">Dịch chuyển dải (Hệ trục chung XYZ)</span>
            <div class="cqt-row">
              <div class="cqt-col"><span class="cqt-label">dX</span><input type="number" step="0.01" id="cqt-shift-x" class="cqt-input" value="0" /></div>
              <div class="cqt-col"><span class="cqt-label">dY</span><input type="number" step="0.01" id="cqt-shift-y" class="cqt-input" value="0" /></div>
              <div class="cqt-col"><span class="cqt-label">dZ</span><input type="number" step="0.01" id="cqt-shift-z" class="cqt-input" value="0" /></div>
              <button id="cqt-btn-shift" class="cqt-btn cqt-btn-secondary cqt-none" style="margin-top:15px;">Dịch</button>
            </div>
          </div>
        </div>

        <!-- ================= 4. QA (COLLAPSIBLE + 2-COLUMN GRID) ================= -->
        <div class="cqt-pane" data-pane="qa">
          <details id="cqt-qa-details" class="cqt-collapsible">
            <summary>
              <span>Tiêu chí kiểm tra QA</span>
              <span id="cqt-qa-active-count" class="cqt-badge">8/9 bật</span>
            </summary>
            <div class="cqt-collapsible-body">
              <div class="cqt-qa-grid">
                <label class="cqt-check"><input type="checkbox" id="cqt-qa-check-missing-track" /> Thiếu track_id</label>
                <label class="cqt-check"><input type="checkbox" id="cqt-qa-check-duplicate-track" /> Trùng track_id</label>
                <label class="cqt-check"><input type="checkbox" id="cqt-qa-check-unknown-class" /> Nhãn lạ</label>
                <label class="cqt-check"><input type="checkbox" id="cqt-qa-check-limits" /> Ngoài limits LWH</label>
              </div>
              <div class="cqt-divider"></div>
              <div class="cqt-row" style="justify-content:space-between;">
                <label class="cqt-check"><input type="checkbox" id="cqt-qa-check-scale" /> Lệch Scale so với median &gt;</label>
                <div class="cqt-row" style="gap:3px;"><input type="number" step="0.001" id="cqt-qa-scale-tol" class="cqt-input cqt-mini" /><span class="cqt-label">m</span></div>
              </div>
              <div class="cqt-row" style="justify-content:space-between;">
                <label class="cqt-check"><input type="checkbox" id="cqt-qa-check-yaw" /> Đổi hướng đột ngột &gt;</label>
                <div class="cqt-row" style="gap:3px;"><input type="number" id="cqt-qa-yaw-threshold" class="cqt-input cqt-mini" /><span class="cqt-label">°</span></div>
              </div>
              <div class="cqt-row" style="justify-content:space-between;">
                <label class="cqt-check"><input type="checkbox" id="cqt-qa-check-overlap" /> Chồng lấn (ped–ped IoU ≤)</label>
                <input type="number" step="0.05" id="cqt-qa-pedped-iou" class="cqt-input cqt-mini" />
              </div>
              <div class="cqt-row" style="justify-content:space-between;">
                <label class="cqt-check"><input type="checkbox" id="cqt-qa-check-dist" /> Khoảng cách quá xa &gt;</label>
                <div class="cqt-row" style="gap:3px;"><input type="number" id="cqt-qa-dist-threshold" class="cqt-input cqt-mini" /><span class="cqt-label">m</span></div>
              </div>
              <div class="cqt-row" style="justify-content:space-between;" title="Tự chuyển qua từng frame để đọc point cloud">
                <label class="cqt-check"><input type="checkbox" id="cqt-qa-check-ground" /> Lệch đáy mặt đất &gt;</label>
                <div class="cqt-row" style="gap:3px;"><input type="number" step="0.01" id="cqt-qa-ground-tol" class="cqt-input cqt-mini" /><span class="cqt-label">m</span></div>
              </div>
              <div class="cqt-qa-grid">
                <label class="cqt-check"><input type="checkbox" id="cqt-qa-ground-all" /> Xét cả frame nội suy</label>
                <label class="cqt-check"><input type="checkbox" id="cqt-qa-whole-job" /> Quét toàn bộ Job</label>
              </div>
            </div>
          </details>

          <div class="cqt-row">
            <button id="cqt-btn-qa-scan" class="cqt-btn cqt-btn-primary">Quét QA</button>
            <button id="cqt-btn-qa-autofix" class="cqt-btn cqt-btn-secondary" title="Xem trước các sửa đề xuất, chọn rồi mới áp dụng">Xem trước Auto-fix</button>
          </div>
          <div class="cqt-row">
            <select id="cqt-qa-filter" class="cqt-input"><option value="">Tất cả lỗi</option></select>
            <button id="cqt-btn-qa-export" class="cqt-btn cqt-btn-secondary cqt-none">Xuất CSV</button>
          </div>
          <div id="cqt-qa-result" class="cqt-log">Chưa quét. Bấm "Quét QA". Bấm vào một dòng để nhảy tới lỗi.</div>

          <div class="cqt-card">
            <span class="cqt-h">Lịch sử Snapshot (${ALT_SYM}Z hoàn tác nhanh)</span>
            <div class="cqt-row">
              <select id="cqt-snap-select" class="cqt-input"></select>
              <button id="cqt-btn-snap-restore" class="cqt-btn cqt-btn-secondary cqt-none">Khôi phục</button>
            </div>
            <pre id="cqt-log" class="cqt-log">Log thao tác...</pre>
          </div>
        </div>

        <!-- ================= 5. CÀI ĐẶT & PHÍM TẮT ================= -->
        <div class="cqt-pane" data-pane="settings">
          <div class="cqt-card">
            <span class="cqt-h">Tuỳ chọn Tính năng (On / Off)</span>
            <label class="cqt-check" title="Bật giao diện Sáng (Light Mode) với viền và chữ tương phản cao"><input type="checkbox" id="cqt-set-light-theme" /> Giao diện Sáng (Light Mode)</label>
            <label class="cqt-check" title="Khi chọn cuboid trên canvas hoặc đổi frame, tự nạp ID, LWH, góc xoay và sub-label vào panel"><input type="checkbox" id="cqt-set-auto-sync" /> Tự đồng bộ Object khi chọn trên Canvas</label>
            <label class="cqt-check" title="Hiện thanh nhảy nhanh qua các Keyframe của riêng Target trên thanh Global Bar"><input type="checkbox" id="cqt-set-kf-stepper" /> Hiện thanh điều hướng Keyframe của Target</label>
            <label class="cqt-check" title="Cho phép cố định Mặt trước/sau/trái/phải/cảm biến khi đổi LWH"><input type="checkbox" id="cqt-set-anchor-resize" /> Cho phép chọn mặt neo (Anchor Face) khi đổi LWH</label>
            <label class="cqt-check" title="Hiện bảng nhích toạ độ cục bộ (Tiến/Lùi/Trái/Phải) và nút Nội suy tuyến tính dải"><input type="checkbox" id="cqt-set-micro-nudge" /> Bật cụm Nhích vi chỉnh &amp; Nội suy tuyến tính</label>
            <label class="cqt-check" title="Không tự chuyển qua nhiều frame (CVAT sẽ tải dữ liệu frame từ server), không đọc tên file frame, không xuất CSV, không lưu toạ độ box vào localStorage"><input type="checkbox" id="cqt-set-safe-data" /> <b>Chế độ an toàn dữ liệu</b> (không tự tải thêm dữ liệu từ server)</label>
            <label class="cqt-check" title="Đè TOP / SIDE / FRONT kiểu Full Control lên 3 ô nhìn phụ của CVAT. Lăn chuột = frame trước/sau của object (${ALT_SYM}V)"><input type="checkbox" id="cqt-set-dock-views" /> Ô nhìn nhúng TOP / SIDE / FRONT trên layout CVAT</label>
            <label class="cqt-check" title="Bảng Location / Rotation / Dimensions sửa được ở góc ô 3D, kiểu N-panel của Blender (${ALT_SYM}N)"><input type="checkbox" id="cqt-set-item-panel" /> Bảng Item (toạ độ / góc / kích thước) trên ô 3D</label>
            <label class="cqt-check"><input type="checkbox" id="cqt-set-blender" /> Bật phím tắt kiểu Blender trên canvas 3D (G / W / S)</label>
            <label class="cqt-check" title="Dùng khi canvas không tự cập nhật sau khi sửa"><input type="checkbox" id="cqt-set-bounce" /> Làm mới canvas bằng chuyển frame (dự phòng)</label>
          </div>

          <div class="cqt-card">
            <span class="cqt-h">Bảng Phím Tắt Nhanh (macOS &amp; Windows)</span>
            <div class="cqt-keymap-grid">
              <span class="cqt-kbd">${ALT_SYM}Q</span><span>Mở / Ghim Panel Toolbox</span>
              <span class="cqt-kbd">${ALT_SYM}M</span><span>Mở / Đóng cửa sổ Full Control (Top/Side/Front/3D đa frame)</span>
              <span class="cqt-kbd">${ALT_SYM}V</span><span>Bật / tắt ô nhìn nhúng TOP / SIDE / FRONT</span>
              <span class="cqt-kbd">${ALT_SYM}N</span><span>Bật / tắt bảng Item trên ô 3D</span>
              <span class="cqt-kbd">Lăn chuột</span><span>Trên ô nhúng: frame trước/sau của object (Shift: keyframe · Ctrl: zoom)</span>
              <span class="cqt-kbd">${ALT_SYM}A</span><span>Auto lấy Box + Tự dò dải Track</span>
              <span class="cqt-kbd">${ALT_SYM}S</span><span>Smart Snap (Target hoặc Nhóm)</span>
              <span class="cqt-kbd">${ALT_SYM}G</span><span>Hạ chạm đất nhanh (Target hoặc Nhóm)</span>
              <span class="cqt-kbd">${ALT_SYM}D</span><span>Đồng bộ LWH toàn track</span>
              <span class="cqt-kbd">${ALT_SYM}R</span><span>Lật đầu 180° (+Shift = Nắn hướng đi)</span>
              <span class="cqt-kbd">${ALT_SYM}K</span><span>Đặt Keyframe tại frame này (không gỡ)</span>
              <span class="cqt-kbd">${ALT_SYM}X</span><span>Cắt đuôi Track (Outside tới hết)</span>
              <span class="cqt-kbd">${ALT_SYM}Z</span><span>Hoàn tác Snapshot gần nhất</span>
              <span class="cqt-kbd">${ALT_SYM}1/2/3/F</span><span>Front / Top / Side / Focus (+Shift = Đối diện)</span>
              <span class="cqt-kbd">G / W / S</span><span>Di chuyển / Xoay / Co giãn trên canvas 3D</span>
              <span class="cqt-kbd">Shift/Cmd+Click</span><span>Chọn nhiều box (Ray-OBB 3D chuẩn macOS)</span>
            </div>
          </div>

          <div class="cqt-card">
            <span class="cqt-h">Limits LWH theo class</span>
            <div class="cqt-row">
              <select id="cqt-limit-class" class="cqt-input"></select>
              <button id="cqt-btn-limit-delete" class="cqt-btn cqt-btn-danger cqt-sm cqt-none">Xoá</button>
            </div>
            <div class="cqt-row">
              <input id="cqt-limit-class-name" class="cqt-input" placeholder="Class mới (trống = class đang chọn)" />
              <button id="cqt-btn-limit-from-object" class="cqt-btn cqt-btn-secondary cqt-sm cqt-none" title="Lấy label của object đang chọn">Lấy từ Box</button>
            </div>
            <div class="cqt-row"><span class="cqt-label" style="width:14px;">L</span><input type="number" step="0.01" id="cqt-limit-l-min" class="cqt-input" placeholder="min" /><input type="number" step="0.01" id="cqt-limit-l-max" class="cqt-input" placeholder="max" /></div>
            <div class="cqt-row"><span class="cqt-label" style="width:14px;">W</span><input type="number" step="0.01" id="cqt-limit-w-min" class="cqt-input" placeholder="min" /><input type="number" step="0.01" id="cqt-limit-w-max" class="cqt-input" placeholder="max" /></div>
            <div class="cqt-row"><span class="cqt-label" style="width:14px;">H</span><input type="number" step="0.01" id="cqt-limit-h-min" class="cqt-input" placeholder="min" /><input type="number" step="0.01" id="cqt-limit-h-max" class="cqt-input" placeholder="max" /></div>
            <div class="cqt-row">
              <button id="cqt-btn-limit-save" class="cqt-btn cqt-btn-primary cqt-sm">Lưu limits</button>
              <button id="cqt-btn-limit-reset" class="cqt-btn cqt-btn-secondary cqt-sm">Mặc định</button>
            </div>
            <label class="cqt-check"><input type="checkbox" id="cqt-limit-clamp-on-apply" /> Ép theo limits khi Áp dụng LWH / auto-fix</label>
            <div class="cqt-divider"></div>
            <div class="cqt-row" style="justify-content:space-between;">
              <label class="cqt-check"><input type="checkbox" id="cqt-limit-class-all-job" checked /> Toàn job</label>
              <label class="cqt-check"><input type="checkbox" id="cqt-limit-class-keyframes" checked /> Chỉ keyframe</label>
            </div>
            <div class="cqt-row">
              <button id="cqt-btn-limit-check-class" class="cqt-btn cqt-btn-secondary cqt-sm">Check class</button>
              <button id="cqt-btn-limit-clamp-class" class="cqt-btn cqt-btn-primary cqt-sm">Clamp class</button>
            </div>
            <pre id="cqt-limit-result" class="cqt-log">Chưa kiểm tra class.</pre>
          </div>
        </div>
      </div>

      <div id="cqt-status" class="cqt-status">Đang khởi tạo...</div>
    </div>
  `;

  let panelApi = null;

  function togglePanel() {
    panelApi?.toggle();
  }

  function syncThemeButtons() {
    const light = isLightTheme();
    const lbl = $('cqt-theme-label');
    if (lbl) lbl.textContent = light ? 'Tối' : 'Sáng';
    const fcBtn = $('cqt-fc-theme');
    if (fcBtn) fcBtn.textContent = light ? 'Tối' : 'Sáng';
    const chk = $('cqt-set-light-theme');
    if (chk) chk.checked = light;
  }

  function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    lsSet(LS.settings, { ...getSettings(), theme: next });
    document.body.classList.toggle('cqt-theme-light', next === 'light');
    syncThemeButtons();
    if (fc.open) fcRerenderVisible();
    dockRender();
  }

  function toggleTheme() {
    applyTheme(isLightTheme() ? 'dark' : 'light');
  }

  function applyFeatureVisibility() {
    const s = getSettings();
    const show = (id, cond) => {
      const el = $(id);
      if (el) el.style.display = cond ? '' : 'none';
    };
    show('cqt-btn-lock-target', !!s.autoSyncObject);
    show('cqt-kf-stepper-row', !!s.keyframeStepper);
    show('cqt-lwh-anchor-row', !!s.anchorResize);
    show('cqt-micro-nudge-card', !!s.microNudge);
    show('cqt-reinterp-row', !!s.microNudge);
  }

  function createUI() {
    if ($('cvat-quicktool-wrapper')) return;
    if (!$('cqt-style')) {
      const style = document.createElement('style');
      style.id = 'cqt-style';
      style.textContent = STYLES;
      document.head.appendChild(style);
    }
    const wrapper = document.createElement('div');
    wrapper.id = 'cvat-quicktool-wrapper';
    wrapper.innerHTML = PANEL_HTML;
    document.body.appendChild(wrapper);

    bindPanel(wrapper);
    bindActions(wrapper);
    restorePanelTop(wrapper);
    writeQAOptionsToUI();
    const s = getSettings();
    applyTheme(s.theme === 'light' ? 'light' : 'dark');
    $('cqt-set-auto-sync').checked = !!s.autoSyncObject;
    $('cqt-set-kf-stepper').checked = !!s.keyframeStepper;
    $('cqt-set-anchor-resize').checked = !!s.anchorResize;
    $('cqt-set-micro-nudge').checked = !!s.microNudge;
    syncDockSettingsUI();
    $('cqt-set-safe-data').checked = safeData();
    $('cqt-set-blender').checked = !!s.blenderKeys;
    $('cqt-set-bounce').checked = !!s.bounceRefresh;
    $('cqt-limit-clamp-on-apply').checked = !!s.enforceLimits;
    const qaDetails = $('cqt-qa-details');
    if (qaDetails) qaDetails.open = !!s.qaConfigOpen;
    applyFeatureVisibility();

    const job = getJob();
    const frame = getFrame();
    if (job) {
      if (Number.isInteger(frame)) {
        setField('cqt-frame-start', frame);
        setField('cqt-frame-end', frame);
      }
      setStatus(`Đã kết nối CVAT Job #${job.id ?? ''} (frame ${frame ?? '?'})`, 'success');
    } else {
      setStatus('Đang kết nối CVAT... Hãy click vào màn hình.', '');
    }
    refreshPresetList();
    refreshSnapshotList();
    refreshLimitClassList();
    renderSelection();
    syncFrameLabel();
    syncActiveObjectQuiet();
  }

  function bindPanel(wrapper) {
    let hideTimer = null;
    const pinBtn = wrapper.querySelector('#cqt-btn-pin');
    const setPinned = (on) => {
      wrapper.classList.toggle('pinned', on);
      pinBtn.classList.toggle('active', on);
      if (!on) wrapper.classList.remove('hover-open');
    };
    panelApi = {
      toggle() {
        const open = wrapper.classList.contains('pinned') || wrapper.classList.contains('hover-open');
        setPinned(!open);
      },
    };

    wrapper.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      wrapper.classList.add('hover-open');
    });
    wrapper.addEventListener('mouseleave', () => {
      if (wrapper.classList.contains('pinned')) return;
      hideTimer = setTimeout(() => wrapper.classList.remove('hover-open'), 350);
    });
    pinBtn.addEventListener('click', () => setPinned(!wrapper.classList.contains('pinned')));
    wrapper.querySelector('#cqt-btn-close').addEventListener('click', () => setPinned(false));
    wrapper.querySelector('#cvat-quicktool-handle').addEventListener('click', () => setPinned(!wrapper.classList.contains('pinned')));

    wrapper.querySelectorAll('.cqt-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        wrapper.querySelectorAll('.cqt-tab').forEach((t) => t.classList.toggle('active', t === tab));
        wrapper.querySelectorAll('.cqt-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === tab.dataset.tab));
        wrapper.querySelector('#cvat-quicktool-body').scrollTop = 0;
      });
    });

    // Kéo panel theo chiều dọc
    const header = wrapper.querySelector('#cvat-quicktool-header');
    let drag = null;
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      drag = { y: e.clientY, top: parseInt(getComputedStyle(wrapper).top, 10) || 80 };
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      wrapper.style.top = `${clamp(drag.top + e.clientY - drag.y, 0, window.innerHeight - 80)}px`;
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      lsSet(LS.top, parseInt(wrapper.style.top, 10) || 80);
    });
  }

  function restorePanelTop(wrapper) {
    const top = lsGet(LS.top, null);
    if (Number.isFinite(top)) wrapper.style.top = `${clamp(top, 0, window.innerHeight - 80)}px`;
  }

  // Mọi handler async đều bọc lỗi để không bao giờ "bấm mà không có gì xảy ra"
  function guarded(fn) {
    return async (...args) => {
      try {
        await fn(...args);
      } catch (e) {
        console.error(LOG, e);
        setStatus('Lỗi: ' + (e?.message || e), 'error');
      }
    };
  }

  function bindActions(wrapper) {
    const on = (id, fn, event = 'click') => {
      const el = wrapper.querySelector('#' + id);
      if (!el) return console.warn(LOG, 'Thiếu phần tử #' + id);
      el.addEventListener(event, guarded(fn));
    };

    wrapper.querySelectorAll('[data-cam]').forEach((b) =>
      b.addEventListener('click', guarded((e) => cameraView(b.dataset.cam, !!e?.shiftKey)))
    );
    wrapper.querySelectorAll('[data-rotate]').forEach((b) =>
      b.addEventListener('click', guarded(() => rotateTrack(Number(b.dataset.rotate))))
    );
    wrapper.querySelectorAll('[data-nudge]').forEach((b) =>
      b.addEventListener('click', guarded(() => {
        const [axis, signStr] = String(b.dataset.nudge || '').split(':');
        return localMicroNudge(axis, Number(signStr) || 1);
      }))
    );

    // Header & Global Bar
    on('cqt-btn-full-control', toggleFullControl);
    on('cqt-btn-theme', toggleTheme);
    on('cqt-btn-undo-quick', restoreLatestSnapshot);
    on('cqt-btn-lock-target', toggleTargetLock);
    on('cqt-target-id', async () => {
      const id = intVal('cqt-target-id');
      if (Number.isInteger(id)) {
        lastSyncedObjId = id;
        lastSyncedFrame = getFrame();
        await fetchLWHQuiet(id, lastSyncedFrame);
        await matchPresetAndLimits(id, lastSyncedFrame);
        await loadAttrPanel(id, true);
      }
    }, 'change');
    on('cqt-btn-detect', (e) => (e?.shiftKey ? autoDetectAndSpan() : detectActive()));
    on('cqt-btn-add-selection', () => {
      const id = activeId() ?? resolveTargetId();
      if (id === null) return fail('Chưa chọn object nào!');
      toggleSelection(id);
    });
    on('cqt-btn-multi-clear', () => { selection.clear(); renderSelection(); });
    on('cqt-btn-multi-select-all', selectAllInFrame);
    on('cqt-frame-count', applyFrameCount, 'change');
    on('cqt-frame-start', () => { if (intVal('cqt-frame-count') >= 1) applyFrameCount(); }, 'change');
    on('cqt-btn-detect-span', detectSpanAndFill);

    // Keyframe Stepper của Target
    on('cqt-btn-kf-first', () => stepObjectKeyframe('first'));
    on('cqt-btn-kf-prev', () => stepObjectKeyframe('prev'));
    on('cqt-btn-kf-toggle', setKeyframe);
    on('cqt-btn-kf-next', () => stepObjectKeyframe('next'));
    on('cqt-btn-kf-last', () => stepObjectKeyframe('last'));

    // Tab 1: Box (Snap, LWH, Preset, Sub-label)
    on('cqt-btn-smart-snap', () => smartSnap(selectedOrTarget()));
    on('cqt-btn-multi-select-all-box', selectAllInFrame);
    on('cqt-btn-copy-transform', copyTransform);
    on('cqt-btn-paste-transform', pasteTransform);
    on('cqt-btn-get-lwh', () => fetchLWH());
    on('cqt-btn-apply-lwh', () => applyLWH('range'));
    on('cqt-btn-sync-track', () => applyLWH('track'));
    on('cqt-btn-apply-frame', () => applyLWH('frame'));
    on('cqt-btn-preset-save', savePreset);
    on('cqt-btn-preset-apply', applyPreset);
    on('cqt-btn-preset-delete', deletePreset);
    on('cqt-btn-attr-load', () => loadAttrPanel());
    on('cqt-btn-attr-all-on', () => setAllAttrChoices('on'));
    on('cqt-btn-attr-all-off', () => setAllAttrChoices('off'));
    on('cqt-btn-attr-all-keep', () => setAllAttrChoices('keep'));
    on('cqt-btn-attr-apply', () => applyAttrProfile());
    on('cqt-attr-auto', () => { lastAutoAttrId = activeId(); }, 'change');

    // Tab 2: Ground
    on('cqt-btn-calc-plane', calcGroundPlane);
    on('cqt-btn-ground-prev-frame', inheritGroundFromPrevFrame);
    on('cqt-btn-ground-ref-boxes', groundFromReferenceBoxes);
    on('cqt-ground-z', onGroundZInput, 'change');
    on('cqt-btn-check-ground', checkGround);
    on('cqt-btn-apply-ground-frame', applyGroundFitCurrent);
    on('cqt-btn-apply-ground', applyGroundFit);
    on('cqt-btn-ground-sweep-cloud', groundSweepCloud);
    on('cqt-btn-ground-follow-ref', groundFollowReference);

    // Tab 3: Track (Yaw, Keyframe, Re-interpolate, Outside, Shift)
    on('cqt-btn-quick-fix-heading', alignYawCurrentFrame);
    on('cqt-btn-quick-fix-cloud', alignYawToCloud);
    on('cqt-btn-sync-yaw', syncYawToTrack);
    on('cqt-btn-fix-yaw-jumps', () => previewFixForTarget('yaw'));
    on('cqt-btn-rotate-angle', () => rotateTrack());
    on('cqt-btn-align-yaw', alignYawRange);
    on('cqt-btn-toggle-keyframe', setKeyframe);
    on('cqt-btn-reinterpolate', reinterpolateRange);
    on('cqt-btn-cut-track-end', cutTrackToEnd);
    on('cqt-btn-multi-outside', outsideSelected);
    on('cqt-btn-cut-far', () => previewFixForTarget('far'));
    on('cqt-btn-smooth', smoothTrack);
    on('cqt-btn-shift', shiftTrack);
    on('cqt-btn-seq-snap', seqSnap);
    on('cqt-btn-ego-measure', measureEgoMotion);

    // Tab 4: QA & Snapshot
    wrapper.querySelectorAll('[id^="cqt-qa-"]').forEach((el) => {
      if (el.tagName === 'INPUT') el.addEventListener('change', () => readQAOptionsFromUI());
    });
    const qaDetails = wrapper.querySelector('#cqt-qa-details');
    if (qaDetails) {
      qaDetails.addEventListener('toggle', () => {
        lsSet(LS.settings, { ...getSettings(), qaConfigOpen: qaDetails.open });
      });
    }
    on('cqt-btn-qa-scan', scanQA);
    on('cqt-btn-qa-autofix', previewAutoFix);
    on('cqt-btn-qa-export', exportQA);
    on('cqt-qa-filter', renderQAResult, 'change');
    on('cqt-btn-snap-restore', () => {
      const idx = parseInt(val('cqt-snap-select'), 10);
      return Number.isInteger(idx) ? restoreSnapshot(idx) : fail('Chưa có snapshot.');
    });

    // Tab 5: Cài đặt & Limits
    on('cqt-set-light-theme', () => applyTheme(isChecked('cqt-set-light-theme') ? 'light' : 'dark'), 'change');
    const saveSettings = () => {
      lsSet(LS.settings, {
        ...getSettings(),
        autoSyncObject: isChecked('cqt-set-auto-sync'),
        keyframeStepper: isChecked('cqt-set-kf-stepper'),
        anchorResize: isChecked('cqt-set-anchor-resize'),
        microNudge: isChecked('cqt-set-micro-nudge'),
        blenderKeys: isChecked('cqt-set-blender'),
        bounceRefresh: isChecked('cqt-set-bounce'),
        enforceLimits: isChecked('cqt-limit-clamp-on-apply'),
      });
      applyFeatureVisibility();
    };
    for (const id of [
      'cqt-set-auto-sync',
      'cqt-set-kf-stepper',
      'cqt-set-anchor-resize',
      'cqt-set-micro-nudge',
      'cqt-set-blender',
      'cqt-set-bounce',
      'cqt-limit-clamp-on-apply',
    ]) {
      on(id, saveSettings, 'change');
    }
    on('cqt-set-safe-data', () => {
      const on = isChecked('cqt-set-safe-data');
      lsSet(LS.settings, { ...getSettings(), safeData: on });
      if (on) localStorage.removeItem(LS.clipboard);
      setStatus(on
        ? 'Đã bật Chế độ an toàn dữ liệu: tool không tự chuyển frame / tải thêm dữ liệu, không xuất CSV.'
        : 'Đã tắt Chế độ an toàn dữ liệu: Snap sequence, Quét Cloud dải, QA mặt đất, đo xe LiDAR, xuất CSV hoạt động lại.', on ? 'success' : 'warn');
    }, 'change');
    on('cqt-set-dock-views', () => {
      dock.hidden = false;
      lsSet(LS.settings, { ...getSettings(), dockViews: isChecked('cqt-set-dock-views') });
      dockTick(true);
    }, 'change');
    on('cqt-set-item-panel', () => {
      lsSet(LS.settings, { ...getSettings(), itemPanel: isChecked('cqt-set-item-panel') });
      dockTick(true);
    }, 'change');
    on('cqt-limit-class', () => { setField('cqt-limit-class-name', ''); loadLimitForm(val('cqt-limit-class')); }, 'change');
    on('cqt-btn-limit-save', saveLimitForm);
    on('cqt-btn-limit-delete', deleteLimitClass);
    on('cqt-btn-limit-reset', resetLimits);
    on('cqt-btn-limit-from-object', fillClassNameFromObject);
    on('cqt-btn-limit-check-class', checkClassLimits);
    on('cqt-btn-limit-clamp-class', clampClassLimits);
  }

  function syncFrameLabel() {
    const el = $('cqt-current-frame');
    if (!el) return;
    const f = getFrame();
    el.textContent = Number.isInteger(f) ? String(f) : '?';
  }

  let subscribedStore = null;
  let storeSyncTimer = null;

  function ensureStoreSubscribed() {
    const store = getStore();
    if (!store || store === subscribedStore || typeof store.subscribe !== 'function') return;
    subscribedStore = store;
    store.subscribe(() => {
      if (storeSyncTimer) return;
      storeSyncTimer = setTimeout(() => {
        storeSyncTimer = null;
        syncFrameLabel();
        syncActiveObjectQuiet();
        autoAttrTick();
        dockTick();
      }, 40);
    });
  }

  // =========================================================================
  // Khởi động
  // =========================================================================
  console.log(LOG, `Khởi động v${VERSION}`);
  installGlobalHandlers();
  installDockHandlers();
  setInterval(() => {
    if (/\/jobs\/\d+/.test(window.location.pathname) && document.querySelector('#root')) {
      createUI();
      ensureStoreSubscribed();
    }
    syncFrameLabel();
    syncActiveObjectQuiet();
    autoAttrTick();
    dockTick(true);
  }, 1000);
})();
