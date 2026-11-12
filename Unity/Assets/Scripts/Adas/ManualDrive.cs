using System;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Adas
{
    /// <summary>Đọc bàn phím (WASD / mũi tên) hoặc tay cầm. steer: −1..1, dương = rẽ trái (cùng quy ước với AV).</summary>
    public class ManualInput
    {
        public float throttle, brake, steer;
        /// <summary>>= 0: dùng giá trị này thay cho bàn phím (chỉ để kiểm thử tự động).</summary>
        public float testThrottle = -1f;

        public void Poll(float dt)
        {
            if (testThrottle >= 0f) { throttle = testThrottle; brake = 0f; steer = 0f; return; }
            float th = 0f, br = 0f, st = 0f;
            var kb = Keyboard.current;
            if (kb != null)
            {
                if (kb.wKey.isPressed || kb.upArrowKey.isPressed) th = 1f;
                if (kb.sKey.isPressed || kb.downArrowKey.isPressed) br = 1f;
                if (kb.aKey.isPressed || kb.leftArrowKey.isPressed) st += 1f;
                if (kb.dKey.isPressed || kb.rightArrowKey.isPressed) st -= 1f;
            }
            var pad = Gamepad.current;
            if (pad != null)
            {
                th = Mathf.Max(th, pad.rightTrigger.ReadValue());
                br = Mathf.Max(br, pad.leftTrigger.ReadValue());
                if (Mathf.Abs(pad.leftStick.x.ReadValue()) > 0.08f) st = -pad.leftStick.x.ReadValue();
            }
            // Bàn phím chỉ có bật/tắt nên phải dốc dần, nếu không vô lăng giật từ 0 lên hết lái trong 1 frame
            throttle = Mathf.MoveTowards(throttle, th, dt * 2.5f);
            brake = Mathf.MoveTowards(brake, br, dt * 4f);
            steer = Mathf.MoveTowards(steer, st, dt * (Mathf.Approximately(st, 0f) ? 3f : 1.6f));
        }
    }

    /// <summary>
    /// Ghi lại phiên lái tay để train model (behavior cloning): Logs/drives/&lt;scenario&gt;_&lt;giờ&gt;.jsonl
    /// Dòng đầu là meta (có map.lanes). Mỗi dòng sau là một bước 0.05 s:
    ///   {"t":.., "obs":{cùng format AV nhận}, "human":{steer, throttle, brake, applied_steer, applied_accel}, "av":{steer, accel}}
    /// "av" là lệnh của AV chạy ngầm cùng lúc, để so người với AV (không có bridge thì null).
    /// </summary>
    public sealed class DriveLogger : IDisposable
    {
        readonly StreamWriter _w;
        public string Path { get; }

        public DriveLogger(string logDir, string scenario, string egoModel, JArray lanes, double dt)
        {
            var dir = System.IO.Path.Combine(logDir, "drives");
            Directory.CreateDirectory(dir);
            Path = System.IO.Path.Combine(dir, $"{scenario}_{DateTime.Now:yyyyMMdd_HHmmss}.jsonl");
            _w = new StreamWriter(Path);
            Write(new JObject { ["type"] = "meta", ["scenario"] = scenario, ["ego_model"] = egoModel, ["dt"] = dt, ["lanes"] = lanes });
        }

        public void Write(JObject o) => _w.WriteLine(o.ToString(Formatting.None));
        public void Dispose() => _w.Dispose();
    }
}
