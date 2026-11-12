using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Adas
{
    /// <summary>
    /// Dựng môi trường từ map.lanes của scenario (PLAN mục 5, "Road Builder").
    ///   - Mặt đường: dải mesh cho từng làn, có MeshCollider để LiDAR bắn trúng.
    ///   - Vạch kẻ: giữa 2 làn cùng chiều là vạch đứt trắng (3 m sơn, 6 m trống); giữa 2 chiều
    ///     (direction khác nhau, BUG_LOG B19) là vạch vàng kép; mép đường là vạch trắng liền.
    ///   - Vỉa hè + bó vỉa, nhà, cây, đèn đường: sinh ngẫu nhiên nhưng có seed, nên lần nào dựng cũng giống nhau.
    /// Mọi tọa độ tính trong hệ scenario (x tiến, y trái) rồi đổi sang Unity bằng SimFrame.
    /// </summary>
    public static class RoadBuilder
    {
        const float MarkW = 0.15f, DashOn = 3f, DashOff = 6f, SidewalkW = 3.5f, CurbH = 0.15f;

        // ------------------------------------------------------------------ polyline (hệ scenario)
        public const float ExtendBack = 60f;

        /// <summary>
        /// Centerline của làn, kéo dài thêm ExtendBack mét về phía sau điểm đầu. Map được sinh từ quỹ đạo ego
        /// tính từ t = 0, nên nếu không kéo dài thì ego đứng ngay mép đường, phía sau là bãi cỏ (BUG_LOG B25).
        /// Phần kéo dài chỉ để hiển thị; AV vẫn dùng map gốc qua bridge.
        /// </summary>
        public static List<Vector2> Centerline(JToken lane)
        {
            var pts = ((JArray)lane["centerline"]).Select(p => new Vector2((float)p[0], (float)p[1])).ToList();
            if (pts.Count < 2) return pts;
            var d = (pts[1] - pts[0]).normalized;
            var back = new List<Vector2>();
            for (float q = ExtendBack; q > 0.01f; q -= 2f) back.Add(pts[0] - d * q);
            back.AddRange(pts);
            return back;
        }

        /// <summary>Dịch polyline sang trái một khoảng d (d < 0 là sang phải), dùng pháp tuyến trung bình.</summary>
        public static List<Vector2> Offset(IList<Vector2> pts, float d)
        {
            var o = new List<Vector2>(pts.Count);
            for (int i = 0; i < pts.Count; i++)
            {
                var t = pts[Mathf.Min(i + 1, pts.Count - 1)] - pts[Mathf.Max(i - 1, 0)];
                t = t.sqrMagnitude > 1e-9f ? t.normalized : Vector2.right;
                o.Add(pts[i] + new Vector2(-t.y, t.x) * d);
            }
            return o;
        }

        static float[] ArcLen(IList<Vector2> pts)
        {
            var s = new float[pts.Count];
            for (int i = 1; i < pts.Count; i++) s[i] = s[i - 1] + Vector2.Distance(pts[i], pts[i - 1]);
            return s;
        }

        /// <summary>Điểm và hướng (tiếp tuyến) tại độ dài cung s.</summary>
        static (Vector2 p, Vector2 t) At(IList<Vector2> pts, float[] s, float sq)
        {
            int i = Array.BinarySearch(s, sq);
            if (i < 0) i = ~i - 1;
            i = Mathf.Clamp(i, 0, pts.Count - 2);
            float seg = Mathf.Max(s[i + 1] - s[i], 1e-6f);
            var t = (pts[i + 1] - pts[i]) / seg;
            return (pts[i] + t * (sq - s[i]), t.normalized);
        }

        static List<Vector2> Slice(IList<Vector2> pts, float[] s, float s0, float s1, float step = 0.5f)
        {
            var o = new List<Vector2>();
            for (float q = s0; q < s1; q += step) o.Add(At(pts, s, q).p);
            o.Add(At(pts, s, s1).p);
            return o;
        }

        // ------------------------------------------------------------------ mesh
        /// <summary>Dải tam giác nối 2 polyline a, b. hint là hướng pháp tuyến mong muốn (để lật mặt nếu cần).</summary>
        static void AddStrip(List<Vector3> V, List<Vector2> UV, List<int> T, IList<Vector3> a, IList<Vector3> b,
                             Vector3 hint, float uvLen = 4f)
        {
            int n = Mathf.Min(a.Count, b.Count);
            if (n < 2) return;
            int baseI = V.Count;
            float acc = 0;
            for (int i = 0; i < n; i++)
            {
                if (i > 0) acc += Vector3.Distance(a[i], a[i - 1]);
                V.Add(a[i]); UV.Add(new Vector2(0, acc / uvLen));
                V.Add(b[i]); UV.Add(new Vector2(1, acc / uvLen));
            }
            var nrm = Vector3.Cross(b[0] - a[0], a[1] - a[0]);
            bool flip = Vector3.Dot(nrm, hint) < 0;
            for (int i = 0; i < n - 1; i++)
            {
                int a0 = baseI + 2 * i, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
                if (!flip) { T.Add(a0); T.Add(b0); T.Add(a1); T.Add(b0); T.Add(b1); T.Add(a1); }
                else { T.Add(a0); T.Add(a1); T.Add(b0); T.Add(b0); T.Add(a1); T.Add(b1); }
            }
        }

        static GameObject MeshObject(string name, Transform parent, List<Vector3> V, List<Vector2> UV, List<int> T,
                                     Material m, bool collider)
        {
            var mesh = new Mesh { name = name, indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            mesh.SetVertices(V);
            mesh.SetUVs(0, UV);
            mesh.SetTriangles(T, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = m;
            if (collider) go.AddComponent<MeshCollider>().sharedMesh = mesh;
            return go;
        }

        static List<Vector3> To3(IList<Vector2> pts, float h) => pts.Select(p => SimFrame.Pos(p.x, p.y, h)).ToList();

        static GameObject Prim(PrimitiveType t, Transform parent, Vector3 pos, Vector3 scale, Material m,
                               Quaternion rot, bool keepCollider = false, string name = null)
        {
            var go = GameObject.CreatePrimitive(t);
            if (name != null) go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.SetPositionAndRotation(pos, rot);
            go.transform.localScale = scale;
            go.GetComponent<Renderer>().sharedMaterial = m;
            if (!keepCollider) Kill(go.GetComponent<Collider>());
            return go;
        }

        /// <summary>
        /// Xóa NGAY (kể cả trong Play mode). Destroy() hoãn tới cuối frame, nên collider của các bộ phận model, hay cả
        /// "Preview", vẫn còn trong bước vật lý đầu tiên và va vào xe RCC (BUG_LOG B29). Chỉ dùng cho object trong scene, không dùng cho asset.
        /// </summary>
        public static void Kill(UnityEngine.Object o)
        {
            if (o == null) return;
            UnityEngine.Object.DestroyImmediate(o);
        }

        // ------------------------------------------------------------------ dựng
        public static Transform Build(JArray lanes, Transform parent, int seed)
        {
            var root = new GameObject("Environment").transform;
            root.SetParent(parent, false);
            if (lanes == null || lanes.Count == 0) return root;

            var asphalt = AdasAssets.Lit("adas_asphalt", Color.white, 0.15f, 0f,
                AdasAssets.Noise("adas_asphalt_tex", new Color(0.16f, 0.16f, 0.17f), new Color(0.30f, 0.30f, 0.31f), 128, 3, 10f),
                new Vector2(1f, 1f));
            var white = AdasAssets.Lit("adas_mark_white", new Color(0.92f, 0.92f, 0.9f), 0.4f);
            var yellow = AdasAssets.Lit("adas_mark_yellow", new Color(0.95f, 0.75f, 0.1f), 0.4f);
            var sidewalk = AdasAssets.Lit("adas_sidewalk", Color.white, 0.2f, 0f,
                AdasAssets.Noise("adas_sidewalk_tex", new Color(0.55f, 0.53f, 0.5f), new Color(0.72f, 0.70f, 0.66f), 64, 5, 20f));
            var curb = AdasAssets.Lit("adas_curb", new Color(0.75f, 0.75f, 0.72f), 0.2f);
            var grass = AdasAssets.Lit("adas_grass", Color.white, 0.05f, 0f,
                AdasAssets.Noise("adas_grass_tex", new Color(0.20f, 0.30f, 0.14f), new Color(0.33f, 0.42f, 0.2f), 128, 7, 6f),
                new Vector2(60f, 60f));

            // Thứ tự làn từ trái sang phải theo liên kết left/right
            var byId = lanes.ToDictionary(l => (string)l["id"]);
            string Link(JToken l, string k) => l[k] == null || l[k].Type == JTokenType.Null ? null : (string)l[k];
            var cur = lanes.FirstOrDefault(l => Link(l, "left") == null || !byId.ContainsKey(Link(l, "left"))) ?? lanes[0];
            var ordered = new List<JToken>();
            while (cur != null && !ordered.Contains(cur))
            {
                ordered.Add(cur);
                var r = Link(cur, "right");
                cur = r != null && byId.TryGetValue(r, out var nx) ? nx : null;
            }
            foreach (var l in lanes) if (!ordered.Contains(l)) ordered.Add(l);

            // 1) Mặt đường
            var V = new List<Vector3>(); var UV = new List<Vector2>(); var T = new List<int>();
            foreach (var lane in ordered)
            {
                var cl = Centerline(lane);
                float w = (float)lane["width"];
                AddStrip(V, UV, T, To3(Offset(cl, w / 2), 0f), To3(Offset(cl, -w / 2), 0f), Vector3.up, w);
            }
            MeshObject("Road", root, V, UV, T, asphalt, collider: true);

            // 2) Vạch kẻ
            var Vw = new List<Vector3>(); var UVw = new List<Vector2>(); var Tw = new List<int>();
            var Vy = new List<Vector3>(); var UVy = new List<Vector2>(); var Ty = new List<int>();
            void Solid(List<Vector2> line, float off, List<Vector3> v, List<Vector2> uv, List<int> t)
            {
                var c = Offset(line, off);
                AddStrip(v, uv, t, To3(Offset(c, MarkW / 2), 0.012f), To3(Offset(c, -MarkW / 2), 0.012f), Vector3.up);
            }
            for (int i = 0; i < ordered.Count; i++)
            {
                var lane = ordered[i];
                var cl = Centerline(lane);
                float w = (float)lane["width"];
                var leftEdge = Offset(cl, w / 2);
                if (i == 0) Solid(leftEdge, -0.25f, Vw, UVw, Tw); // mép trái đường
                else
                {
                    int dirL = (int?)ordered[i - 1]["direction"] ?? 1, dir = (int?)lane["direction"] ?? 1;
                    if (dirL != dir)
                    {
                        Solid(leftEdge, 0.12f, Vy, UVy, Ty);
                        Solid(leftEdge, -0.12f, Vy, UVy, Ty);
                    }
                    else
                    {
                        var s = ArcLen(leftEdge);
                        for (float q = 0; q < s[^1]; q += DashOn + DashOff)
                        {
                            var seg = Slice(leftEdge, s, q, Mathf.Min(q + DashOn, s[^1]));
                            AddStrip(Vw, UVw, Tw, To3(Offset(seg, MarkW / 2), 0.012f), To3(Offset(seg, -MarkW / 2), 0.012f), Vector3.up);
                        }
                    }
                }
                if (i == ordered.Count - 1) Solid(Offset(cl, -w / 2), 0.25f, Vw, UVw, Tw); // mép phải đường
            }
            MeshObject("Markings_White", root, Vw, UVw, Tw, white, false);
            if (Vy.Count > 0) MeshObject("Markings_Yellow", root, Vy, UVy, Ty, yellow, false);

            // 3) Vỉa hè + bó vỉa hai bên
            var first = ordered[0]; var last = ordered[^1];
            var roadL = Offset(Centerline(first), (float)first["width"] / 2);
            var roadR = Offset(Centerline(last), -(float)last["width"] / 2);
            var sideL = Offset(roadL, SidewalkW);
            var sideR = Offset(roadR, -SidewalkW);
            var Vs = new List<Vector3>(); var UVs = new List<Vector2>(); var Ts = new List<int>();
            AddStrip(Vs, UVs, Ts, To3(sideL, CurbH), To3(roadL, CurbH), Vector3.up, 2f);
            AddStrip(Vs, UVs, Ts, To3(roadR, CurbH), To3(sideR, CurbH), Vector3.up, 2f);
            MeshObject("Sidewalks", root, Vs, UVs, Ts, sidewalk, true);
            var Vc = new List<Vector3>(); var UVc = new List<Vector2>(); var Tc = new List<int>();
            // mặt đứng của bó vỉa, hướng vào lòng đường
            var inL = SimFrame.Pos(roadR[0].x - roadL[0].x, roadR[0].y - roadL[0].y);
            AddStrip(Vc, UVc, Tc, To3(roadL, 0f), To3(roadL, CurbH), inL, 1f);
            AddStrip(Vc, UVc, Tc, To3(roadR, 0f), To3(roadR, CurbH), -inL, 1f);
            MeshObject("Curbs", root, Vc, UVc, Tc, curb, false);

            // 4) Nền cỏ
            var b = new Bounds(SimFrame.Pos(roadL[0].x, roadL[0].y), Vector3.zero);
            foreach (var p in sideL.Concat(sideR)) b.Encapsulate(SimFrame.Pos(p.x, p.y));
            var ground = Prim(PrimitiveType.Plane, root, new Vector3(b.center.x, -0.03f, b.center.z),
                              new Vector3(b.size.x / 10f + 20f, 1f, b.size.z / 10f + 20f), grass, Quaternion.identity, true, "Ground");

            // 5) Nhà, cây, đèn đường dọc hai bên
            var rnd = new System.Random(seed);
            var props = new GameObject("Props").transform;
            props.SetParent(root, false);
            Roadside(props, sideL, +1, rnd);
            Roadside(props, sideR, -1, rnd);
            return root;
        }

        static readonly Color[] Facades =
        {
            new(0.82f, 0.78f, 0.70f), new(0.70f, 0.72f, 0.76f), new(0.86f, 0.84f, 0.80f), new(0.60f, 0.52f, 0.46f),
            new(0.74f, 0.66f, 0.52f), new(0.55f, 0.60f, 0.66f), new(0.88f, 0.86f, 0.74f), new(0.45f, 0.47f, 0.50f),
        };

        /// <summary>side = +1 bên trái đường, −1 bên phải. line là mép ngoài vỉa hè.</summary>
        static void Roadside(Transform parent, List<Vector2> line, int side, System.Random rnd)
        {
            float R(float a, float b) => a + (float)rnd.NextDouble() * (b - a);
            var s = ArcLen(line);
            var trunk = AdasAssets.Lit("adas_trunk", new Color(0.35f, 0.25f, 0.18f), 0.1f);
            var leaves = new[]
            {
                AdasAssets.Lit("adas_leaves0", new Color(0.20f, 0.42f, 0.18f), 0.1f),
                AdasAssets.Lit("adas_leaves1", new Color(0.28f, 0.50f, 0.20f), 0.1f),
            };
            var pole = AdasAssets.Lit("adas_pole", new Color(0.35f, 0.36f, 0.38f), 0.5f, 0.6f);
            var lampHead = AdasAssets.Lit("adas_lamp", new Color(1f, 0.95f, 0.8f), 0.6f, 0f, null, null, new Color(1.2f, 1.1f, 0.8f));
            var glass = AdasAssets.Lit("adas_window_band", new Color(0.18f, 0.22f, 0.28f), 0.85f, 0.2f);

            // Nhà
            float q = R(2f, 10f);
            while (q < s[^1] - 5f)
            {
                float along = R(8f, 18f), depth = R(10f, 20f), setback = R(1f, 6f);
                double u = rnd.NextDouble();
                float h = u < 0.6 ? R(6f, 15f) : u < 0.9 ? R(15f, 30f) : R(30f, 60f);
                var (p, t) = At(line, s, Mathf.Min(q + along / 2, s[^1]));
                var n = new Vector2(-t.y, t.x) * side; // hướng ra xa đường
                var c = p + n * (setback + depth / 2);
                float yaw = Mathf.Atan2(t.y, t.x);
                var rot = SimFrame.Rot(yaw);
                var facade = AdasAssets.Lit($"adas_facade{rnd.Next(Facades.Length)}", Facades[rnd.Next(Facades.Length)], 0.2f);
                var bld = Prim(PrimitiveType.Cube, parent, SimFrame.Pos(c.x, c.y, h / 2), new Vector3(depth, h, along),
                               facade, rot, true, "Building");
                // Dải kính mỗi tầng cho có cảm giác nhà
                for (float fy = 2.2f; fy < h - 1f; fy += 3.2f)
                    Prim(PrimitiveType.Cube, bld.transform, SimFrame.Pos(c.x, c.y, fy), Vector3.one, glass, rot)
                        .transform.localScale = new Vector3(1.01f, 1.2f / h, 0.9f);
                // Cây trong khoảng hở trước nhà kế tiếp
                float gap = R(3f, 9f);
                if (rnd.NextDouble() < 0.7)
                {
                    var (tp, _) = At(line, s, Mathf.Min(q + along + gap / 2, s[^1]));
                    var tpos = tp - new Vector2(-t.y, t.x) * side * 1.2f; // trên vỉa hè
                    float th = R(2.2f, 3.5f), cr = R(1.4f, 2.4f);
                    Prim(PrimitiveType.Cylinder, parent, SimFrame.Pos(tpos.x, tpos.y, CurbH + th / 2), new Vector3(0.3f, th / 2, 0.3f), trunk, Quaternion.identity, false, "Tree");
                    Prim(PrimitiveType.Sphere, parent, SimFrame.Pos(tpos.x, tpos.y, CurbH + th + cr * 0.7f), Vector3.one * cr * 2, leaves[rnd.Next(2)], Quaternion.identity, true, "Canopy");
                }
                q += along + gap;
            }
            // Đèn đường, cách đều 30 m, sát mép trong vỉa hè, cần đèn vươn ra đường
            for (float lq = 5f; lq < s[^1]; lq += 30f)
            {
                var (p, t) = At(line, s, lq);
                var inward = -new Vector2(-t.y, t.x) * side;
                var bp = p + inward * (SidewalkW - 0.4f);
                Prim(PrimitiveType.Cylinder, parent, SimFrame.Pos(bp.x, bp.y, CurbH + 4f), new Vector3(0.16f, 4f, 0.16f), pole, Quaternion.identity, true, "LampPole");
                var arm = bp + inward * 0.9f;
                var armYaw = Mathf.Atan2(inward.y, inward.x);
                Prim(PrimitiveType.Cube, parent, SimFrame.Pos(arm.x, arm.y, CurbH + 7.9f), new Vector3(0.08f, 0.08f, 1.8f), pole, SimFrame.Rot(armYaw));
                var head = bp + inward * 1.8f;
                Prim(PrimitiveType.Cube, parent, SimFrame.Pos(head.x, head.y, CurbH + 7.8f), new Vector3(0.35f, 0.12f, 0.6f), lampHead, SimFrame.Rot(armYaw));
            }
        }

        /// <summary>Đèn giao thông: cột + hộp đèn 3 bóng, quay mặt về phía xe đi tới. Trả về (đỏ, vàng, xanh).</summary>
        public static Renderer[] TrafficLight(Transform parent, Vector3 pos, float roadYaw, string id)
        {
            var root = new GameObject($"TrafficLight_{id}").transform;
            root.SetParent(parent, false);
            var pole = AdasAssets.Lit("adas_pole", new Color(0.35f, 0.36f, 0.38f), 0.5f, 0.6f);
            var housing = AdasAssets.Lit("adas_tl_housing", new Color(0.08f, 0.08f, 0.08f), 0.4f);
            var ground = new Vector3(pos.x, 0f, pos.z);
            float hgt = Mathf.Max(pos.y, 3f);
            Prim(PrimitiveType.Cylinder, root, ground + Vector3.up * hgt / 2, new Vector3(0.18f, hgt / 2, 0.18f), pole, Quaternion.identity, true, "Pole");
            var face = SimFrame.Rot(roadYaw + Mathf.PI); // nhìn ngược chiều xe chạy = nhìn vào mặt người lái
            var head = ground + Vector3.up * (hgt + 0.6f);
            Prim(PrimitiveType.Cube, root, head, new Vector3(0.4f, 1.1f, 0.3f), housing, face, false, "Housing");
            var r = new Renderer[3];
            var fwd = face * Vector3.forward;
            for (int i = 0; i < 3; i++)
            {
                var lamp = Prim(PrimitiveType.Sphere, root, head + Vector3.up * (0.33f - 0.33f * i) + fwd * 0.16f,
                                Vector3.one * 0.26f, AdasAssets.Lit("adas_tl_off", new Color(0.1f, 0.1f, 0.1f), 0.6f), face, false, $"Lamp{i}");
                r[i] = lamp.GetComponent<Renderer>();
            }
            return r;
        }
    }
}
