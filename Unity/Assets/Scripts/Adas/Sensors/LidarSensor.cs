using System.Collections.Generic;
using Unity.Collections;
using UnityEngine;

namespace Adas
{
    /// <summary>
    /// LiDAR giả lập bằng raycast (giống AWSIM: RGL/raycast). Mặc định 32 tia dọc (−25°..+10°) × 0.5° ngang = 23 040 tia,
    /// quét 10 Hz. Dùng RaycastCommand (job) nên chạy song song, rất nhanh.
    /// Đầu ra:
    ///   - points/colors: point cloud trong hệ world (vẽ dạng điểm, màu theo độ cao);
    ///   - Bev: ảnh nhìn từ trên xuống 256×256 (±50 m), dùng cho panel bên phải.
    /// Collider của ego nằm ở layer 2 (Ignore Raycast) nên tia không trúng chính xe mình.
    /// </summary>
    public class LidarSensor : MonoBehaviour
    {
        public int channels = 32;
        public float upperDeg = 10f, lowerDeg = -25f, azimuthStepDeg = 0.5f, range = 100f;
        public LayerMask mask = ~(1 << 2);
        public const int PointCloudLayer = 31;

        public readonly List<Vector3> points = new();
        readonly List<Color32> _colors = new();
        int[] _idx = new int[0];
        Mesh _mesh;
        Texture2D _bev;
        Color32[] _bevBuf;
        const int BevSize = 256;
        const float BevRange = 50f;
        public Texture2D Bev => _bev;
        public int LastCount { get; private set; }

        public void Init(Transform worldRoot)
        {
            var go = new GameObject("LidarPointCloud") { layer = PointCloudLayer }; // camera sensor không nhìn thấy layer này
            go.transform.SetParent(worldRoot, false);
            _mesh = new Mesh { name = "lidar_points", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            go.AddComponent<MeshFilter>().sharedMesh = _mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = AdasAssets.Points();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            _bev = new Texture2D(BevSize, BevSize, TextureFormat.RGBA32, false) { filterMode = FilterMode.Point, name = "lidar_bev" };
            _bevBuf = new Color32[BevSize * BevSize];
        }

        static Color32 HeightColor(float h)
        {
            if (h < 0.25f) return new Color32(70, 90, 110, 255); // mặt đường / mặt đất
            float u = Mathf.Clamp01((h - 0.25f) / 4f);
            var c = Color.Lerp(new Color(0.15f, 0.9f, 0.6f), new Color(1f, 0.85f, 0.15f), u);
            if (u > 0.5f) c = Color.Lerp(new Color(1f, 0.85f, 0.15f), new Color(1f, 0.25f, 0.2f), (u - 0.5f) * 2f);
            return c;
        }

        public int Scan()
        {
            int nAz = Mathf.RoundToInt(360f / azimuthStepDeg);
            int n = channels * nAz;
            var cmds = new NativeArray<RaycastCommand>(n, Allocator.TempJob);
            var hits = new NativeArray<RaycastHit>(n, Allocator.TempJob);
            var origin = transform.position;
            float yaw = transform.eulerAngles.y;
            var qp = new QueryParameters(mask, false, QueryTriggerInteraction.Ignore, false);
            int k = 0;
            for (int c = 0; c < channels; c++)
            {
                float elev = lowerDeg + (upperDeg - lowerDeg) * c / Mathf.Max(channels - 1, 1);
                for (int a = 0; a < nAz; a++)
                {
                    var dir = Quaternion.Euler(-elev, yaw + a * azimuthStepDeg, 0f) * Vector3.forward;
                    cmds[k++] = new RaycastCommand(origin, dir, qp, range);
                }
            }
            RaycastCommand.ScheduleBatch(cmds, hits, 256).Complete();
            points.Clear();
            _colors.Clear();
            for (int i = 0; i < n; i++)
            {
                var h = hits[i];
                if (h.distance <= 0f) continue; // không trúng gì
                points.Add(h.point);
                _colors.Add(HeightColor(h.point.y));
            }
            cmds.Dispose();
            hits.Dispose();
            LastCount = points.Count;

            if (_mesh != null)
            {
                if (_idx.Length < points.Count)
                {
                    _idx = new int[points.Count * 2];
                    for (int i = 0; i < _idx.Length; i++) _idx[i] = i;
                }
                _mesh.Clear();
                _mesh.SetVertices(points);
                _mesh.SetColors(_colors);
                _mesh.SetIndices(_idx, 0, points.Count, MeshTopology.Points, 0, false);
                _mesh.bounds = new Bounds(origin, Vector3.one * range * 2.2f);
            }
            UpdateBev(origin, yaw);
            return points.Count;
        }

        void UpdateBev(Vector3 origin, float yawDeg)
        {
            if (_bev == null) return;
            var bg = new Color32(16, 18, 22, 255);
            for (int i = 0; i < _bevBuf.Length; i++) _bevBuf[i] = bg;
            // vòng 10 m
            for (int r = 10; r <= 50; r += 10)
                for (int a = 0; a < 720; a++)
                {
                    float ang = a * Mathf.PI / 360f;
                    int px = BevSize / 2 + (int)(Mathf.Cos(ang) * r / BevRange * BevSize / 2);
                    int py = BevSize / 2 + (int)(Mathf.Sin(ang) * r / BevRange * BevSize / 2);
                    if (px >= 0 && py >= 0 && px < BevSize && py < BevSize) _bevBuf[py * BevSize + px] = new Color32(40, 44, 52, 255);
                }
            var inv = Quaternion.Euler(0, -yawDeg, 0);
            float sc = BevSize / 2f / BevRange;
            for (int i = 0; i < points.Count; i++)
            {
                var rel = inv * (points[i] - origin); // hệ ego: z tới, x phải
                int px = BevSize / 2 + (int)(rel.x * sc), py = BevSize / 2 + (int)(rel.z * sc);
                if (px < 0 || py < 0 || px >= BevSize || py >= BevSize) continue;
                _bevBuf[py * BevSize + px] = _colors[i];
            }
            // ego ở giữa
            for (int dy = -4; dy <= 4; dy++)
                for (int dx = -2; dx <= 2; dx++)
                    _bevBuf[(BevSize / 2 + dy) * BevSize + BevSize / 2 + dx] = new Color32(255, 255, 255, 255);
            _bev.SetPixels32(_bevBuf);
            _bev.Apply(false);
        }
    }
}
