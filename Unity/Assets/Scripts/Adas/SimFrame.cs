using UnityEngine;

namespace Adas
{
    /// <summary>
    /// Đổi tọa độ scenario (tay phải: x tiến, y trái, z lên, yaw ngược chiều kim đồng hồ)
    /// sang Unity (tay trái: y lên, quay quanh Y theo chiều kim đồng hồ khi nhìn từ trên xuống).
    ///   Unity.position = (x_sim, z, y_sim)   -> đổi chỗ 2 trục = đổi luôn tay phải/tay trái, không bị lật gương
    ///   Unity.rotY     = 90° − yaw_sim       -> forward Unity (sinψ, 0, cosψ) = (cos yaw, 0, sin yaw)
    /// Với phép xoay này, trục Z CỤC BỘ của vật là đầu xe, nên localScale = (W, H, L).
    /// </summary>
    public static class SimFrame
    {
        public static Vector3 Pos(double x, double y, float z = 0f) => new Vector3((float)x, z, (float)y);

        public static Quaternion Rot(double yaw) =>
            Quaternion.Euler(0f, 90f - (float)(yaw * Mathf.Rad2Deg), 0f);

        public static double Yaw(Transform t) => (90.0 - t.eulerAngles.y) * Mathf.Deg2Rad;
    }
}
