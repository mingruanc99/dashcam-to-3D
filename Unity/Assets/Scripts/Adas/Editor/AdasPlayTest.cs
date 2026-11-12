using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Adas.EditorTools
{
    /// <summary>
    /// Chạy scenario trong Play mode từ batchmode (RCC cần Play mode vì chạy trong FixedUpdate), tự thoát khi xong.
    ///   Unity.exe -batchmode -projectPath . -executeMethod Adas.EditorTools.AdasPlayTest.LeadBrakeRcc -logFile Logs/play_rcc.log
    /// (KHÔNG thêm -quit: editor phải ở lại để chạy Play mode. ScenarioPlayer.autoExitWhenDone gọi Exit khi xong.)
    /// Kết quả: Logs/adas_ego_*.csv, Logs/adas_collisions.csv.
    /// </summary>
    public static class AdasPlayTest
    {
        public static void LeadBrakeRcc() => Run("lead_brake.json", ScenarioPlayer.Mode.M2_ClosedLoop, true);
        public static void LeadBrakeKinematic() => Run("lead_brake.json", ScenarioPlayer.Mode.M2_ClosedLoop, false);
        public static void Clip02Rcc() => Run("clip02.json", ScenarioPlayer.Mode.M1_Replay, true);
        public static void CutInRcc() => Run("cut_in.json", ScenarioPlayer.Mode.M2_ClosedLoop, true);
        public static void CutInKinematic() => Run("cut_in.json", ScenarioPlayer.Mode.M2_ClosedLoop, false);

        /// <summary>Lái tay giả lập (ga cố định) để kiểm tra chế độ Manual và file log.</summary>
        public static void ManualTest() => Run("cut_in.json", ScenarioPlayer.Mode.M2_ClosedLoop, true, 0.3f);

        static void Run(string scenario, ScenarioPlayer.Mode mode, bool rcc, float manualThrottle = -1f)
        {
            var p = AdasMenu.BuildScene(scenario, "", mode, save: false, rcc: rcc);
            p.autoExitWhenDone = true;
            if (manualThrottle >= 0f)
            {
                p.driver = ScenarioPlayer.DriverMode.Manual;
                p.manualTestThrottle = manualThrottle;
            }
            p.speed = 4f; // chạy nhanh gấp 4 lần thời gian thực
            p.lidarEnabled = true;
            p.captureAt = scenario == "lead_brake.json" ? new[] { 22.3f, 23.2f } : new[] { 3f, 11f, 13f };
            if (rcc && p.rccPrefab == null)
            {
                Debug.LogError("[ADAS] Không tìm thấy prefab RCC tại " + AdasMenu.RccPrefabPath);
                EditorApplication.Exit(1);
                return;
            }
            // Play mode sẽ gọi Start(): Preview bị xóa, xe được dựng lại
            EditorApplication.EnterPlaymode();
        }
    }
}
