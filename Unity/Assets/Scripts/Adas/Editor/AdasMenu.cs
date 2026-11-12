using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace Adas.EditorTools
{
    /// <summary>
    /// Menu ADAS → Dựng scene: tạo scene có sẵn đường, nhà, xe, ego + cảm biến (kiểu AWSIM), mở ra là thấy ngay.
    /// Mesh, material và texture sinh bằng code được lưu thành asset trong Assets/Adas/Generated/(scenario)/,
    /// nếu không thì scene lưu xong sẽ mất tham chiếu.
    /// </summary>
    public static class AdasMenu
    {
        [MenuItem("ADAS/Dựng scene: clip02 (video thật, M1 replay)")]
        static void BuildClip02() => BuildScene("clip02.json", "clip02.mp4", ScenarioPlayer.Mode.M1_Replay, true);

        [MenuItem("ADAS/Dựng scene: lead_brake (M2, AV Python)")]
        static void BuildLeadBrake() => BuildScene("lead_brake.json", "", ScenarioPlayer.Mode.M2_ClosedLoop, true);

        [MenuItem("ADAS/Dựng scene: jaywalker (M2, AV Python)")]
        static void BuildJaywalker() => BuildScene("jaywalker.json", "", ScenarioPlayer.Mode.M2_ClosedLoop, true);

        [MenuItem("ADAS/Dựng scene: lead_brake (M2, AV Python, xe RCC vật lý)")]
        static void BuildLeadBrakeRcc() => BuildScene("lead_brake.json", "", ScenarioPlayer.Mode.M2_ClosedLoop, true, true);

        [MenuItem("ADAS/Dựng scene: clip02 (video thật, xe RCC bám log)")]
        static void BuildClip02Rcc() => BuildScene("clip02.json", "clip02.mp4", ScenarioPlayer.Mode.M1_Replay, true, true);

        /// <summary>Scene mới cho các kịch bản tình huống. Không đụng tới các scene đã có.</summary>
        [MenuItem("ADAS/Dựng scene: các kịch bản tình huống (xe RCC)")]
        public static void BuildIncidents()
        {
            foreach (var n in new[] { "cut_in", "brake_check", "wrong_way", "red_light_runner" })
                BuildScene(n + ".json", "", ScenarioPlayer.Mode.M2_ClosedLoop, true, true);
        }

        public const string RccPrefabPath = "Assets/Realistic Car Controller Pro/Prefabs/Prototype/RCCP_PrototypeVehicle_Skyline.prefab";

        public static RCCP_CarController LoadRccPrefab()
        {
            var go = AssetDatabase.LoadAssetAtPath<GameObject>(RccPrefabPath);
            return go != null ? go.GetComponent<RCCP_CarController>() : null;
        }

        /// <summary>Dùng cho batchmode: dựng và lưu cả 3 scene.</summary>
        public static void BuildAll()
        {
            BuildScene("clip02.json", "clip02.mp4", ScenarioPlayer.Mode.M1_Replay, true);
            BuildScene("lead_brake.json", "", ScenarioPlayer.Mode.M2_ClosedLoop, true);
            BuildScene("jaywalker.json", "", ScenarioPlayer.Mode.M2_ClosedLoop, true);
            BuildScene("lead_brake.json", "", ScenarioPlayer.Mode.M2_ClosedLoop, true, true);
            BuildScene("clip02.json", "clip02.mp4", ScenarioPlayer.Mode.M1_Replay, true, true);
            var list = new[]
            {
                new EditorBuildSettingsScene("Assets/Scenes/Adas_clip02.unity", true),
                new EditorBuildSettingsScene("Assets/Scenes/Adas_lead_brake.unity", true),
                new EditorBuildSettingsScene("Assets/Scenes/Adas_jaywalker.unity", true),
                new EditorBuildSettingsScene("Assets/Scenes/Adas_lead_brake_RCC.unity", true),
                new EditorBuildSettingsScene("Assets/Scenes/Adas_clip02_RCC.unity", true),
            };
            EditorBuildSettings.scenes = list;
        }

        public static ScenarioPlayer BuildScene(string scenario, string video, ScenarioPlayer.Mode mode, bool save, bool rcc = false)
        {
            if (save && !Application.isBatchMode && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return null;
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            SetupLighting();

            var go = new GameObject("ADAS");
            var p = go.AddComponent<ScenarioPlayer>();
            p.scenarioFile = scenario;
            p.videoFile = video;
            p.mode = mode;
            if (rcc)
            {
                p.egoModel = ScenarioPlayer.EgoModel.RCC; // preview trong editor vẫn là xe low-poly; Play mới spawn xe RCC
                p.rccPrefab = LoadRccPrefab();
            }
            p.Load();
            p.BuildEnvironment();
            p.BuildActors();
            p.Restart(connectBridge: false);
            p.SetCameraMode(0);
            p.Actors.gameObject.name = "Preview"; // khi Play: Preview bị xóa, xe được tạo lại

            if (save)
            {
                var name = Path.GetFileNameWithoutExtension(scenario) + (rcc ? "_RCC" : "");
                PersistGenerated($"Assets/Adas/Generated/{name}");
                EditorSceneManager.SaveScene(scene, $"Assets/Scenes/Adas_{name}.unity");
                Selection.activeGameObject = go;
                Debug.Log($"[ADAS] Đã dựng Assets/Scenes/Adas_{name}.unity");
            }
            return p;
        }

        public static void SetupLighting()
        {
            var sun = Object.FindFirstObjectByType<Light>();
            if (sun != null)
            {
                sun.transform.rotation = Quaternion.Euler(42f, -35f, 0f);
                sun.intensity = 1.6f;
                sun.color = new Color(1f, 0.96f, 0.9f);
                sun.shadows = LightShadows.Soft;
            }
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.62f, 0.7f, 0.82f);
            RenderSettings.ambientEquatorColor = new Color(0.55f, 0.56f, 0.55f);
            RenderSettings.ambientGroundColor = new Color(0.25f, 0.24f, 0.22f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = new Color(0.72f, 0.78f, 0.86f);
            RenderSettings.fogStartDistance = 150f;
            RenderSettings.fogEndDistance = 700f;
        }

        /// <summary>Lưu mọi Mesh/Material/Texture/RenderTexture chưa phải asset thành file .asset/.mat.</summary>
        public static void PersistGenerated(string dir)
        {
            if (AssetDatabase.IsValidFolder(dir)) AssetDatabase.DeleteAsset(dir);
            Directory.CreateDirectory(dir);
            AssetDatabase.Refresh();
            int n = 0;
            string Unique(string baseName, string ext) =>
                AssetDatabase.GenerateUniqueAssetPath($"{dir}/{Sanitize(baseName)}{ext}");
            bool IsAsset(Object o) => o == null || !string.IsNullOrEmpty(AssetDatabase.GetAssetPath(o));
            void SaveTex(Texture t)
            {
                if (IsAsset(t)) return;
                AssetDatabase.CreateAsset(t, Unique(t.name.Length > 0 ? t.name : "tex", ".asset"));
                n++;
            }
            foreach (var root in EditorSceneManager.GetActiveScene().GetRootGameObjects())
            {
                foreach (var mf in root.GetComponentsInChildren<MeshFilter>(true))
                    if (!IsAsset(mf.sharedMesh))
                    {
                        AssetDatabase.CreateAsset(mf.sharedMesh, Unique(mf.sharedMesh.name.Length > 0 ? mf.sharedMesh.name : "mesh", ".asset"));
                        n++;
                    }
                foreach (var r in root.GetComponentsInChildren<Renderer>(true))
                    foreach (var m in r.sharedMaterials)
                    {
                        if (IsAsset(m)) continue;
                        if (m.HasProperty("_BaseMap")) SaveTex(m.GetTexture("_BaseMap"));
                        AssetDatabase.CreateAsset(m, Unique(m.name.Length > 0 ? m.name : "mat", ".mat"));
                        n++;
                    }
                foreach (var c in root.GetComponentsInChildren<Camera>(true))
                    if (c.targetTexture != null) SaveTex(c.targetTexture);
            }
            AssetDatabase.SaveAssets();
            Debug.Log($"[ADAS] Lưu {n} asset sinh ra vào {dir}");
        }

        static string Sanitize(string s)
        {
            foreach (var ch in Path.GetInvalidFileNameChars()) s = s.Replace(ch, '_');
            return s.Replace(' ', '_');
        }
    }
}
