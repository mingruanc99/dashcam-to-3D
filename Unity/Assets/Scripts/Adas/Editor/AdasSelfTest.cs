using System.Globalization;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Adas.EditorTools
{
    /// <summary>
    /// Self-test không cần Play mode: chạy hết scenario theo bước, in va chạm ra log.
    ///   Unity.exe -batchmode -projectPath . -executeMethod Adas.EditorTools.AdasSelfTest.RunLeadBrake -quit -logFile Logs/selftest.log
    /// Cần bridge Python đang chạy cho M2: python -m bridge.tcp_server --port 5555
    /// </summary>
    public static class AdasSelfTest
    {
        [UnityEditor.MenuItem("ADAS/Self-test (lead_brake, M2)")]
        public static void RunLeadBrake() => Run("lead_brake.json", ScenarioPlayer.Mode.M2_ClosedLoop);

        [UnityEditor.MenuItem("ADAS/Self-test (clip02, M2)")]
        public static void RunClip02() => Run("clip02.json", ScenarioPlayer.Mode.M2_ClosedLoop);

        public static void Run(string scenario, ScenarioPlayer.Mode mode)
        {
            EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var go = new GameObject("ADAS SelfTest");
            var p = go.AddComponent<ScenarioPlayer>();
            p.scenarioFile = scenario;
            p.videoFile = "";
            p.mode = mode;
            p.lidarEnabled = false;
            Physics.simulationMode = SimulationMode.Script;
            p.Load();
            p.BuildEnvironment();
            p.BuildActors();
            p.Restart();
            int n = 0;
            while (p.SimTime < p.EndTime - 1e-6 && n++ < 100000)
            {
                p.Step();
                if (n % 100 == 0)
                    Debug.Log(string.Format(CultureInfo.InvariantCulture, "[ADAS-SELFTEST] t={0:F2}", p.SimTime));
            }
            Debug.Log($"[ADAS-SELFTEST] done steps={n}");
            Object.DestroyImmediate(go);
        }
    }
}
