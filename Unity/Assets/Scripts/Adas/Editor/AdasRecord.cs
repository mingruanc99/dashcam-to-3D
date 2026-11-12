using System.IO;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace Adas.EditorTools
{
    /// <summary>
    /// Quay video demo không cần Play mode: mỗi bước sim render camera ra JPG, sau đó Python ghép thành mp4.
    /// Chạy bước theo bước (kinematic, Physics Script) nên tất định, máy chậm thì video vẫn đúng tốc độ.
    ///   cd Code; python -m bridge.tcp_server --port 5555   (cần cho M2 và NPC)
    ///   Unity.exe -batchmode -projectPath . -executeMethod Adas.EditorTools.AdasRecord.All -quit -logFile Logs/record.log
    /// Kết quả: Logs/rec/&lt;tên&gt;_&lt;camera&gt;/00000.jpg ...
    /// </summary>
    public static class AdasRecord
    {
        const int W = 1920, H = 1080, FPS = 30;

        public static void All()
        {
            Record("clip02.json", ScenarioPlayer.Mode.M1_Replay, dashcam: true);
            Record("lead_brake.json", ScenarioPlayer.Mode.M2_ClosedLoop);
            Record("cut_in.json", ScenarioPlayer.Mode.M2_ClosedLoop);
            Record("brake_check.json", ScenarioPlayer.Mode.M2_ClosedLoop);
            Record("red_light_runner.json", ScenarioPlayer.Mode.M2_ClosedLoop);
            Record("wrong_way.json", ScenarioPlayer.Mode.M2_ClosedLoop);
        }

        public static void LeadBrake() => Record("lead_brake.json", ScenarioPlayer.Mode.M2_ClosedLoop);

        public static void Record(string scenario, ScenarioPlayer.Mode mode, bool dashcam = false)
        {
            var p = AdasMenu.BuildScene(scenario, "", mode, save: false);
            Physics.simulationMode = SimulationMode.Script;
            p.lidarEnabled = false;
            p.dt = 1f / FPS; // một bước sim = một frame video
            p.Restart(connectBridge: true);
            Debug.Log($"[ADAS-REC] {scenario}: {p.Status}");

            var cam = Camera.main;
            SetupLook(cam);
            var name = Path.GetFileNameWithoutExtension(scenario) + (mode == ScenarioPlayer.Mode.M2_ClosedLoop ? "_M2" : "_M1");
            var root = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Logs", "rec"));
            var views = dashcam ? new[] { ("chase", 0), ("top", 2), ("dashcam", 1) } : new[] { ("chase", 0), ("top", 2) };
            foreach (var (v, _) in views) Reset(Path.Combine(root, $"{name}_{v}"));

            bool asyncOld = EditorSettings.asyncShaderCompilation;
            EditorSettings.asyncShaderCompilation = false;
            var rt = new RenderTexture(W, H, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB) { antiAliasing = 8 };
            var tex = new Texture2D(W, H, TextureFormat.RGB24, false);
            Grab(cam, rt, tex, null); // khởi động shader

            // Camera đuôi xe được làm mượt theo thời gian nên phải giữ trạng thái riêng của nó giữa các frame
            p.SetCameraMode(0);
            var chasePos = cam.transform.position;
            var chaseRot = cam.transform.rotation;
            int frame = 0;
            while (true)
            {
                foreach (var (v, m) in views)
                {
                    if (m == 0)
                    {
                        cam.transform.SetPositionAndRotation(chasePos, chaseRot);
                        p.SetCameraModeSmooth(0, 1f / FPS);
                        chasePos = cam.transform.position;
                        chaseRot = cam.transform.rotation;
                    }
                    else p.SetCameraMode(m);
                    Grab(cam, rt, tex, Path.Combine(root, $"{name}_{v}", $"{frame:00000}.jpg"));
                }
                frame++;
                if (p.SimTime >= p.EndTime - 1e-6) break;
                p.Step();
            }
            Debug.Log($"[ADAS-REC] {name}: {frame} frame, va chạm: {p.CollisionCount}");
            EditorSettings.asyncShaderCompilation = asyncOld;
            Object.DestroyImmediate(rt);
            Object.DestroyImmediate(tex);
            p.Shutdown();
        }

        /// <summary>Hậu kỳ nhẹ cho đẹp: tonemapping ACES, bloom, vignette, khử răng cưa SMAA.</summary>
        static void SetupLook(Camera cam)
        {
            var data = cam.GetUniversalAdditionalCameraData();
            data.renderPostProcessing = true;
            data.antialiasing = AntialiasingMode.SubpixelMorphologicalAntiAliasing;
            data.antialiasingQuality = AntialiasingQuality.High;
            var go = new GameObject("RecordLook");
            var vol = go.AddComponent<Volume>();
            vol.isGlobal = true;
            var prof = ScriptableObject.CreateInstance<VolumeProfile>();
            prof.Add<Tonemapping>(true).mode.Override(TonemappingMode.ACES);
            var bloom = prof.Add<Bloom>(true);
            bloom.intensity.Override(0.35f);
            bloom.threshold.Override(1.0f);
            var vig = prof.Add<Vignette>(true);
            vig.intensity.Override(0.22f);
            var ca = prof.Add<ColorAdjustments>(true);
            ca.postExposure.Override(0.15f);
            ca.contrast.Override(8f);
            ca.saturation.Override(6f);
            vol.sharedProfile = prof;
        }

        static void Reset(string dir)
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
            Directory.CreateDirectory(dir);
        }

        static void Grab(Camera cam, RenderTexture rt, Texture2D tex, string path)
        {
            var old = cam.targetTexture;
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            tex.ReadPixels(new Rect(0, 0, W, H), 0, 0);
            tex.Apply();
            if (path != null) File.WriteAllBytes(path, tex.EncodeToJPG(92));
            cam.targetTexture = old;
            RenderTexture.active = null;
        }
    }
}
