using System.Collections.Generic;
using UnityEngine;

namespace Adas
{
    /// <summary>
    /// Tạo và cache material, texture dùng chung. Khi dựng scene trong editor, AdasMenu lưu chúng thành asset
    /// (Assets/Adas/Generated), để scene đã lưu không bị mất tham chiếu.
    /// </summary>
    public static class AdasAssets
    {
        static readonly Dictionary<string, Material> Mats = new();
        static readonly Dictionary<string, Texture2D> Texs = new();

        static Shader Find(params string[] names)
        {
            foreach (var n in names)
            {
                var s = Shader.Find(n);
                if (s != null) return s;
            }
            return Shader.Find("Sprites/Default");
        }

        public static Material Lit(string name, Color c, float smooth = 0.3f, float metal = 0f,
                                   Texture tex = null, Vector2? tiling = null, Color? emission = null)
        {
            if (Mats.TryGetValue(name, out var m) && m != null) return m;
            m = new Material(Find("Universal Render Pipeline/Lit", "Standard")) { name = name };
            m.SetColor("_BaseColor", c);
            m.color = c;
            m.SetFloat("_Smoothness", smooth);
            m.SetFloat("_Metallic", metal);
            if (tex != null)
            {
                m.SetTexture("_BaseMap", tex);
                m.SetTextureScale("_BaseMap", tiling ?? Vector2.one);
            }
            if (emission.HasValue)
            {
                m.EnableKeyword("_EMISSION");
                m.SetColor("_EmissionColor", emission.Value);
                m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            }
            return Mats[name] = m;
        }

        public static Material Unlit(string name, Color c)
        {
            if (Mats.TryGetValue(name, out var m) && m != null) return m;
            m = new Material(Find("Universal Render Pipeline/Unlit", "Unlit/Color")) { name = name };
            m.SetColor("_BaseColor", c);
            m.color = c;
            return Mats[name] = m;
        }

        /// <summary>Material cho point cloud LiDAR: không chiếu sáng, lấy màu theo vertex color.</summary>
        public static Material Points()
        {
            if (Mats.TryGetValue("adas_points", out var m) && m != null) return m;
            m = new Material(Find("Universal Render Pipeline/Particles/Unlit", "Particles/Standard Unlit")) { name = "adas_points" };
            m.SetColor("_BaseColor", Color.white);
            return Mats["adas_points"] = m;
        }

        /// <summary>Texture nhiễu (đốm) lặp được, dùng cho nhựa đường, cỏ, vỉa hè.</summary>
        public static Texture2D Noise(string name, Color a, Color b, int size = 128, int seed = 1, float scale = 8f)
        {
            if (Texs.TryGetValue(name, out var t) && t != null) return t;
            t = new Texture2D(size, size, TextureFormat.RGBA32, true) { name = name, wrapMode = TextureWrapMode.Repeat };
            // Value noise nhiều tầng, lưới tuần hoàn nên lặp không thấy đường nối (bản cũ dùng sin/cos bị vân tròn, BUG_LOG B24)
            var rnd = new System.Random(seed);
            var px = new Color[size * size];
            var val = new float[size * size];
            float amp = 1f, total = 0f;
            for (int cell = Mathf.Max(2, (int)(size / scale)); cell >= 2; cell /= 2, amp *= 0.55f)
            {
                int g = size / cell;
                var grid = new float[g * g];
                for (int i = 0; i < grid.Length; i++) grid[i] = (float)rnd.NextDouble();
                for (int y = 0; y < size; y++)
                    for (int x = 0; x < size; x++)
                    {
                        float fx = (float)x / cell, fy = (float)y / cell;
                        int x0 = (int)fx % g, y0 = (int)fy % g, x1 = (x0 + 1) % g, y1 = (y0 + 1) % g;
                        float u = Mathf.SmoothStep(0, 1, fx - (int)fx), v = Mathf.SmoothStep(0, 1, fy - (int)fy);
                        float n = Mathf.Lerp(Mathf.Lerp(grid[y0 * g + x0], grid[y0 * g + x1], u),
                                             Mathf.Lerp(grid[y1 * g + x0], grid[y1 * g + x1], u), v);
                        val[y * size + x] += n * amp;
                    }
                total += amp;
            }
            for (int i = 0; i < px.Length; i++)
                px[i] = Color.Lerp(a, b, Mathf.Clamp01(val[i] / total * 0.85f + (float)rnd.NextDouble() * 0.15f));
            t.SetPixels(px);
            t.Apply(true);
            return Texs[name] = t;
        }
    }
}
