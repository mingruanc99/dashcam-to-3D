using System.IO;
using UnityEngine;

namespace Adas.EditorTools
{
    /// <summary>
    /// Chụp ảnh scene ra Logs/shots/ (không cần Play): camera đuôi xe, dashcam, nhìn từ trên, ảnh sensor, LiDAR BEV.
    ///   Unity.exe -batchmode -projectPath . -executeMethod Adas.EditorTools.AdasShots.Clip02 -quit -logFile Logs/shots.log
    /// Không dùng -nographics, vì cần GPU để render.
    /// </summary>
    public static class AdasShots
    {
        public static void Clip02() => Capture("clip02.json", "clip02.mp4", new[] { 3.0, 12.0 });
        public static void LeadBrake() => Capture("lead_brake.json", "", new[] { 6.0 });

        public static void Capture(string scenario, string video, double[] times)
        {
            var p = AdasMenu.BuildScene(scenario, video, ScenarioPlayer.Mode.M1_Replay, save: false);
            Physics.simulationMode = SimulationMode.Script;
            var dir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Logs", "shots"));
            Directory.CreateDirectory(dir);
            var name = Path.GetFileNameWithoutExtension(scenario);
            // Editor biên dịch shader bất đồng bộ: frame đầu render bằng shader tạm (ám nâu/xám). Tắt đi rồi render khởi động 1 lần.
            bool asyncOld = UnityEditor.EditorSettings.asyncShaderCompilation;
            UnityEditor.EditorSettings.asyncShaderCompilation = false;
            Save(Camera.main, Path.Combine(dir, "_warmup.png"), 320, 180);
            foreach (var t in times)
            {
                while (p.SimTime < t - 1e-6) p.Step();
                for (int m = 0; m < 3; m++)
                {
                    p.SetCameraMode(m);
                    Save(Camera.main, Path.Combine(dir, $"{name}_t{t:00}_cam{m}.png"), 1600, 900);
                }
                Save(p.SensorCamera, Path.Combine(dir, $"{name}_t{t:00}_sensor.png"), 640, 360);
                if (p.Lidar?.Bev != null) File.WriteAllBytes(Path.Combine(dir, $"{name}_t{t:00}_lidar.png"), p.Lidar.Bev.EncodeToPNG());
                Debug.Log($"[ADAS-SHOTS] t={t} lidar={p.Lidar?.LastCount}");
            }
            UnityEditor.EditorSettings.asyncShaderCompilation = asyncOld;
        }

        /// <summary>Mở scene đã lưu (không dựng lại) và chụp camera chính: kiểm tra asset sinh ra không bị mất tham chiếu.</summary>
        public static void SavedClip02()
        {
            UnityEditor.SceneManagement.EditorSceneManager.OpenScene("Assets/Scenes/Adas_clip02.unity");
            bool asyncOld = UnityEditor.EditorSettings.asyncShaderCompilation;
            UnityEditor.EditorSettings.asyncShaderCompilation = false;
            var dir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Logs", "shots"));
            Directory.CreateDirectory(dir);
            Save(Camera.main, Path.Combine(dir, "_warmup.png"), 320, 180);
            Save(Camera.main, Path.Combine(dir, "saved_clip02.png"), 1600, 900);
            UnityEditor.EditorSettings.asyncShaderCompilation = asyncOld;
            Debug.Log("[ADAS-SHOTS] saved scene ok");
        }

        static void Save(Camera cam, string path, int w, int h)
        {
            var rt = new RenderTexture(w, h, 24);
            var old = cam.targetTexture;
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            var tex = new Texture2D(w, h, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
            tex.Apply();
            File.WriteAllBytes(path, tex.EncodeToPNG());
            cam.targetTexture = old;
            RenderTexture.active = null;
            Object.DestroyImmediate(rt);
            Object.DestroyImmediate(tex);
        }
    }
}
