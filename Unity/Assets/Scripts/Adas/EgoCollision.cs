using UnityEngine;

namespace Adas
{
    /// <summary>Gắn lên agent: thông tin để log va chạm.</summary>
    public class AgentTag : MonoBehaviour
    {
        public string id;
        public string cls;
        public string mode = "log_replay";
    }

    /// <summary>
    /// Phát hiện va chạm bằng truy vấn Physics.OverlapBox sau mỗi bước sim, thay vì callback OnTriggerEnter.
    /// Callback chỉ chạy trong Play mode và phụ thuộc vào thứ tự sự kiện của engine. Truy vấn thì tất định,
    /// và chạy được cả trong self-test của editor (BUG_LOG B21).
    /// Vùng chạm cùng tiêu chí với sim Python (sim/world.py, B12): lấy điểm gần nhất trên agent so với
    /// tâm ego, đổi sang hệ cục bộ của ego. z > L/4 là front, z < −L/4 là rear, còn lại là side.
    /// </summary>
    public static class EgoCollision
    {
        public static string Zone(Vector3 egoCenter, Quaternion egoRot, float egoLength, Collider other)
        {
            // KHÔNG dùng InverseTransformPoint: nếu transform có scale thì z bị chia cho scale (BUG_LOG B22).
            // Chỉ khử phép xoay và tịnh tiến, kết quả tính bằng mét.
            var p = Quaternion.Inverse(egoRot) * (other.ClosestPoint(egoCenter) - egoCenter);
            return p.z > 0.25f * egoLength ? "front" : (p.z < -0.25f * egoLength ? "rear" : "side");
        }
    }
}
