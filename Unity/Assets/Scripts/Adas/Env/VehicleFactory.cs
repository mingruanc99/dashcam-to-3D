using UnityEngine;

namespace Adas
{
    /// <summary>Tham chiếu bánh xe để quay và đánh lái cho đẹp (chỉ là hiển thị).</summary>
    public class WheelVisuals : MonoBehaviour
    {
        public Transform fl, fr, rl, rr;
        public float radius = 0.33f;
        float _spin;

        public void UpdateWheels(float steerRad, float v, float dt)
        {
            _spin = (_spin + v * dt / Mathf.Max(radius, 0.05f) * Mathf.Rad2Deg) % 360f;
            var spin = Quaternion.Euler(_spin, 0f, 0f);
            var axle = Quaternion.Euler(0f, 0f, 90f);
            // steer > 0 = rẽ trái. Trong Unity quay quanh Y dương là sang phải, nên đổi dấu
            var steer = Quaternion.Euler(0f, -steerRad * Mathf.Rad2Deg, 0f);
            if (fl) fl.localRotation = steer * spin * axle;
            if (fr) fr.localRotation = steer * spin * axle;
            if (rl) rl.localRotation = spin * axle;
            if (rr) rr.localRotation = spin * axle;
        }
    }

    /// <summary>
    /// Model low-poly theo class (PLAN mục 5, Asset Library: mỗi class một model cố định, biến thể màu theo variant).
    /// Gốc đặt trên mặt đất, ở tâm xe; trục Z cục bộ là đầu xe. Chỉ gốc có BoxCollider (W, H, L) để
    /// bắt va chạm và để LiDAR bắn trúng. Các phần con không có collider.
    /// Muốn thay bằng model thật (RCC, Asset Store) thì gán vào ScenarioPlayer.classPrefabs.
    /// </summary>
    public static class VehicleFactory
    {
        static readonly Color[] CarColors =
        {
            new(0.92f, 0.92f, 0.92f), new(0.75f, 0.76f, 0.78f), new(0.08f, 0.08f, 0.09f), new(0.62f, 0.07f, 0.08f),
            new(0.10f, 0.22f, 0.50f), new(0.40f, 0.42f, 0.45f), new(0.85f, 0.70f, 0.20f), new(0.20f, 0.35f, 0.25f),
        };
        static readonly Color[] Shirt =
        {
            new(0.85f, 0.2f, 0.2f), new(0.2f, 0.45f, 0.85f), new(0.95f, 0.95f, 0.9f), new(0.15f, 0.15f, 0.15f),
            new(0.95f, 0.7f, 0.2f), new(0.35f, 0.65f, 0.35f),
        };

        static Material M(string n, Color c, float s = 0.5f, float metal = 0f) => AdasAssets.Lit(n, c, s, metal);
        static Material Paint(int v) => M($"adas_paint{v % CarColors.Length}", CarColors[v % CarColors.Length], 0.75f, 0.3f);
        static Material Glass => M("adas_glass", new Color(0.10f, 0.13f, 0.17f), 0.92f, 0.1f);
        static Material Tire => M("adas_tire", new Color(0.06f, 0.06f, 0.06f), 0.2f);
        static Material Head => AdasAssets.Lit("adas_headlight", new Color(1f, 1f, 0.9f), 0.8f, 0f, null, null, new Color(1.5f, 1.5f, 1.3f));
        static Material Tail => AdasAssets.Lit("adas_taillight", new Color(0.8f, 0.05f, 0.05f), 0.8f, 0f, null, null, new Color(1.2f, 0.05f, 0.05f));
        static Material Skin => M("adas_skin", new Color(0.86f, 0.68f, 0.55f), 0.3f);

        static Transform Part(PrimitiveType t, Transform parent, Vector3 pos, Vector3 scale, Material m, string name = null,
                              Quaternion? rot = null)
        {
            var go = GameObject.CreatePrimitive(t);
            go.name = name ?? t.ToString();
            RoadBuilder.Kill(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localRotation = rot ?? Quaternion.identity;
            go.transform.localScale = scale;
            go.GetComponent<Renderer>().sharedMaterial = m;
            return go.transform;
        }

        static Transform Wheel(Transform p, float x, float z, float r, float w, string name)
        {
            // Cylinder gốc cao 2 theo trục Y, bán kính 0.5. Quay 90° quanh Z để trục bánh nằm ngang (X)
            var tire = Part(PrimitiveType.Cylinder, p, new Vector3(x, r, z), new Vector3(2 * r, w / 2, 2 * r), Tire, name,
                            Quaternion.Euler(0, 0, 90));
            // Lốp tròn đều nên không thấy được nó quay. Thêm nan hoa ở hai mặt để thấy chuyển động
            var hub = M("adas_hub", new Color(0.6f, 0.6f, 0.62f), 0.7f, 0.8f);
            Part(PrimitiveType.Cube, tire, new Vector3(0, 1.02f, 0), new Vector3(0.85f, 0.04f, 0.2f), hub, "hub_out");
            Part(PrimitiveType.Cube, tire, new Vector3(0, -1.02f, 0), new Vector3(0.85f, 0.04f, 0.2f), hub, "hub_in");
            return tire;
        }

        static GameObject Root(string name, float L, float W, float H, bool collider = true)
        {
            var root = new GameObject(name);
            if (collider)
            {
                var bc = root.AddComponent<BoxCollider>();
                bc.size = new Vector3(W, H, L);
                bc.center = new Vector3(0, H / 2, 0);
            }
            return root;
        }

        /// <summary>Đặt model nằm xuống (người/xe đã ngã): gom các bộ phận vào một khung rồi xoay khung.</summary>
        public static void LayDown(GameObject root, string cls)
        {
            var holder = new GameObject("down").transform;
            var parts = new System.Collections.Generic.List<Transform>();
            foreach (Transform c in root.transform) parts.Add(c);
            holder.SetParent(root.transform, false);
            foreach (var c in parts) c.SetParent(holder, false);
            if (cls == "pedestrian")
            {
                holder.localRotation = Quaternion.Euler(90f, 0f, 0f); // nằm ngửa dọc theo trục Z của vật
                holder.localPosition = new Vector3(0f, 0.18f, -0.85f);
            }
            else
            {
                holder.localRotation = Quaternion.Euler(0f, 0f, 90f); // đổ nghiêng sang một bên
                holder.localPosition = new Vector3(0.25f, 0.3f, 0f);
            }
        }

        public static GameObject Create(string cls, float L, float W, float H, int variant, string name)
        {
            switch (cls)
            {
                case "bus": return Bus(L, W, H, variant, name);
                case "truck": return Truck(L, W, H, variant, name);
                case "motorbike": return TwoWheeler(L, W, H, variant, name, motor: true);
                case "bicycle": return TwoWheeler(L, W, H, variant, name, motor: false);
                case "pedestrian": return Pedestrian(H, variant, name);
                case "obstacle": return Obstacle(L, W, H, name);
                default: return Car(L, W, H, Paint(variant), name);
            }
        }

        public static GameObject Car(float L, float W, float H, Material paint, string name)
        {
            var root = Root(name, L, W, H);
            var t = root.transform;
            float r = 0.33f, clear = 0.22f;
            float bodyH = Mathf.Max(H * 0.42f, 0.5f), cabinH = H - clear - bodyH;
            Part(PrimitiveType.Cube, t, new Vector3(0, clear + bodyH / 2, 0), new Vector3(W, bodyH, L), paint, "body");
            Part(PrimitiveType.Cube, t, new Vector3(0, clear + bodyH + cabinH / 2, -L * 0.06f), new Vector3(W * 0.84f, cabinH, L * 0.52f), Glass, "cabin");
            Part(PrimitiveType.Cube, t, new Vector3(0, H - 0.03f, -L * 0.06f), new Vector3(W * 0.8f, 0.06f, L * 0.42f), paint, "roof");
            foreach (var sx in new[] { -1f, 1f })
            {
                Part(PrimitiveType.Cube, t, new Vector3(sx * W * 0.32f, clear + bodyH * 0.65f, L / 2), new Vector3(W * 0.22f, 0.12f, 0.04f), Head, "headlight");
                Part(PrimitiveType.Cube, t, new Vector3(sx * W * 0.34f, clear + bodyH * 0.7f, -L / 2), new Vector3(W * 0.2f, 0.1f, 0.04f), Tail, "taillight");
            }
            var wv = root.AddComponent<WheelVisuals>();
            wv.radius = r;
            float wx = W / 2 - 0.12f, wz = L / 2 - Mathf.Min(0.85f, L * 0.2f);
            wv.fl = Wheel(t, -wx, wz, r, 0.24f, "wheel_fl");
            wv.fr = Wheel(t, wx, wz, r, 0.24f, "wheel_fr");
            wv.rl = Wheel(t, -wx, -wz, r, 0.24f, "wheel_rl");
            wv.rr = Wheel(t, wx, -wz, r, 0.24f, "wheel_rr");
            return root;
        }

        static GameObject Bus(float L, float W, float H, int v, string name)
        {
            var root = Root(name, L, W, H);
            var t = root.transform;
            var paint = v % 2 == 0 ? M("adas_bus_red", new Color(0.75f, 0.1f, 0.1f), 0.7f, 0.2f) : M("adas_bus_yellow", new Color(0.95f, 0.75f, 0.15f), 0.7f, 0.2f);
            float clear = 0.35f;
            Part(PrimitiveType.Cube, t, new Vector3(0, clear + (H - clear) / 2, 0), new Vector3(W, H - clear, L), paint, "body");
            Part(PrimitiveType.Cube, t, new Vector3(0, H - 1.05f, 0), new Vector3(W + 0.02f, 0.9f, L * 0.92f), Glass, "windows");
            Part(PrimitiveType.Cube, t, new Vector3(0, H - 1.2f, L / 2 + 0.005f), new Vector3(W * 0.9f, 1.3f, 0.02f), Glass, "windshield");
            var wv = root.AddComponent<WheelVisuals>();
            wv.radius = 0.5f;
            wv.fl = Wheel(t, -W / 2 + 0.2f, L / 2 - 2.2f, 0.5f, 0.3f, "wheel_fl");
            wv.fr = Wheel(t, W / 2 - 0.2f, L / 2 - 2.2f, 0.5f, 0.3f, "wheel_fr");
            wv.rl = Wheel(t, -W / 2 + 0.2f, -L / 2 + 2.5f, 0.5f, 0.3f, "wheel_rl");
            wv.rr = Wheel(t, W / 2 - 0.2f, -L / 2 + 2.5f, 0.5f, 0.3f, "wheel_rr");
            return root;
        }

        static GameObject Truck(float L, float W, float H, int v, string name)
        {
            var root = Root(name, L, W, H);
            var t = root.transform;
            var cab = M($"adas_truckcab{v % 3}", new[] { new Color(0.15f, 0.3f, 0.6f), new Color(0.2f, 0.5f, 0.25f), new Color(0.85f, 0.85f, 0.85f) }[v % 3], 0.6f, 0.2f);
            var cargo = M("adas_cargo", new Color(0.62f, 0.62f, 0.6f), 0.3f);
            float cabL = 2.2f;
            Part(PrimitiveType.Cube, t, new Vector3(0, 0.45f + H * 0.32f, L / 2 - cabL / 2), new Vector3(W, H * 0.64f, cabL), cab, "cab");
            Part(PrimitiveType.Cube, t, new Vector3(0, 0.45f + H * 0.5f, L / 2 - 0.25f), new Vector3(W * 0.9f, H * 0.28f, 0.02f), Glass, "windshield");
            Part(PrimitiveType.Cube, t, new Vector3(0, 0.45f + (H - 0.45f) / 2, -cabL / 2 - 0.1f), new Vector3(W, H - 0.45f, L - cabL - 0.2f), cargo, "cargo");
            var wv = root.AddComponent<WheelVisuals>();
            wv.radius = 0.5f;
            wv.fl = Wheel(t, -W / 2 + 0.2f, L / 2 - 1.2f, 0.5f, 0.3f, "wheel_fl");
            wv.fr = Wheel(t, W / 2 - 0.2f, L / 2 - 1.2f, 0.5f, 0.3f, "wheel_fr");
            wv.rl = Wheel(t, -W / 2 + 0.2f, -L / 2 + 1.5f, 0.5f, 0.3f, "wheel_rl");
            wv.rr = Wheel(t, W / 2 - 0.2f, -L / 2 + 1.5f, 0.5f, 0.3f, "wheel_rr");
            return root;
        }

        static GameObject TwoWheeler(float L, float W, float H, int v, string name, bool motor)
        {
            var root = Root(name, L, W, H);
            var t = root.transform;
            float r = motor ? 0.3f : 0.34f;
            var frame = motor ? Paint(v + 1) : M("adas_bikeframe", new Color(0.2f, 0.2f, 0.22f), 0.6f, 0.7f);
            if (motor) Part(PrimitiveType.Cube, t, new Vector3(0, 0.55f, 0), new Vector3(0.32f, 0.42f, L * 0.62f), frame, "body");
            else Part(PrimitiveType.Cube, t, new Vector3(0, 0.6f, 0), new Vector3(0.05f, 0.05f, L * 0.6f), frame, "frame");
            var wv = root.AddComponent<WheelVisuals>();
            wv.radius = r;
            wv.fl = Wheel(t, 0, L / 2 - r, r, 0.1f, "wheel_f");
            wv.rl = Wheel(t, 0, -L / 2 + r, r, 0.1f, "wheel_r");
            // Người lái: thân, đầu, mũ bảo hiểm
            var shirt = M($"adas_shirt{v % Shirt.Length}", Shirt[v % Shirt.Length], 0.3f);
            Part(PrimitiveType.Capsule, t, new Vector3(0, H - 0.62f, -0.1f), new Vector3(0.42f, 0.35f, 0.32f), shirt, "rider");
            Part(PrimitiveType.Sphere, t, new Vector3(0, H - 0.13f, -0.05f), Vector3.one * 0.27f,
                 M($"adas_helmet{v % 3}", new[] { Color.white, new Color(0.9f, 0.1f, 0.1f), new Color(0.1f, 0.1f, 0.1f) }[v % 3], 0.8f), "helmet");
            if (motor) Part(PrimitiveType.Cube, t, new Vector3(0, 0.75f, L / 2 - 0.15f), new Vector3(0.12f, 0.08f, 0.04f), Head, "headlight");
            return root;
        }

        static GameObject Pedestrian(float H, int v, string name)
        {
            var root = Root(name, 0.5f, 0.5f, H);
            var t = root.transform;
            var shirt = M($"adas_shirt{v % Shirt.Length}", Shirt[v % Shirt.Length], 0.3f);
            var pants = M("adas_pants", new Color(0.18f, 0.2f, 0.3f), 0.3f);
            Part(PrimitiveType.Capsule, t, new Vector3(0.1f, 0.42f, 0), new Vector3(0.16f, 0.42f, 0.16f), pants, "leg_l");
            Part(PrimitiveType.Capsule, t, new Vector3(-0.1f, 0.42f, 0), new Vector3(0.16f, 0.42f, 0.16f), pants, "leg_r");
            Part(PrimitiveType.Capsule, t, new Vector3(0, H * 0.65f, 0), new Vector3(0.42f, H * 0.2f, 0.26f), shirt, "torso");
            Part(PrimitiveType.Sphere, t, new Vector3(0, H - 0.12f, 0), Vector3.one * 0.24f, Skin, "head");
            return root;
        }

        static GameObject Obstacle(float L, float W, float H, string name)
        {
            var root = Root(name, L, W, H);
            Part(PrimitiveType.Cube, root.transform, new Vector3(0, H / 2, 0), new Vector3(W, H, L),
                 M("adas_obstacle", new Color(0.45f, 0.3f, 0.18f), 0.15f), "obstacle");
            return root;
        }

        /// <summary>
        /// Xe ego giống xe của AWSIM: thân trắng, giá cảm biến trên nóc, LiDAR dạng "puck", camera trước.
        /// Trả về (root, điểm gắn LiDAR, điểm gắn camera).
        /// </summary>
        public static (GameObject root, Transform lidarMount, Transform cameraMount) Ego(float L, float W, float H, float camHeight)
        {
            var root = Car(L, W, H, M("adas_ego_paint", new Color(0.96f, 0.96f, 0.97f), 0.85f, 0.25f), "Ego");
            var t = root.transform;
            var rack = M("adas_rack", new Color(0.12f, 0.12f, 0.13f), 0.5f, 0.6f);
            Part(PrimitiveType.Cube, t, new Vector3(0, H + 0.05f, -L * 0.04f), new Vector3(W * 0.75f, 0.06f, 0.7f), rack, "sensor_rack");
            Part(PrimitiveType.Cylinder, t, new Vector3(0, H + 0.17f, -L * 0.04f), new Vector3(0.22f, 0.09f, 0.22f), rack, "lidar_puck");
            Part(PrimitiveType.Cube, t, new Vector3(0, H + 0.13f, -L * 0.04f + 0.32f), new Vector3(0.18f, 0.1f, 0.08f), rack, "camera_box");
            var lidar = new GameObject("LidarMount").transform;
            lidar.SetParent(t, false);
            lidar.localPosition = new Vector3(0, H + 0.2f, -L * 0.04f);
            var cam = new GameObject("CameraMount").transform;
            cam.SetParent(t, false);
            cam.localPosition = new Vector3(0, camHeight, L * 0.1f);
            return (root, lidar, cam);
        }
    }
}
