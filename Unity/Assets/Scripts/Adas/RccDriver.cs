using UnityEngine;

namespace Adas
{
    /// <summary>
    /// Bộ điều khiển cấp thấp: lệnh của AV (góc bánh trước δ [rad], gia tốc a [m/s²]) -> input của RCC Pro
    /// (throttle/brake 0..1, steer −1..1). Giống khối "加速度控制器-逆模型" ở PDF mục 6.4.5:
    ///
    ///   u = a_cmd / A_max                          (feedforward: mô hình ngược, A_max = gia tốc ứng với ga/phanh 100%)
    ///     + kp·(a_cmd − a_đo)/A_thr + ki·∫(a_cmd − a_đo)dt        (PI bù sai số mô hình: tải, dốc, cấp số, trễ)
    ///   u > 0: throttle = u;  u < 0: brake = −u
    ///   a_đo = lọc thông thấp của dv/dt (v = vận tốc dọc thân xe từ Rigidbody)
    ///
    ///   steerInput = −δ[°] / maxSteerAngle   (AV: δ > 0 là rẽ trái; RCC: steerInput > 0 là rẽ phải)
    ///
    /// Đứng yên mà AV muốn dừng (a_cmd ≤ 0, v < 0.3 m/s) thì phanh 100%, để xe không bị trôi.
    /// Tắt auto-reverse và các trợ lực lái của RCC (overrideExternalInputs), để lệnh của AV là lệnh duy nhất.
    /// </summary>
    public class RccDriver : MonoBehaviour
    {
        public RCCP_CarController car;
        [Tooltip("Gia tốc (m/s²) ứng với ga 100% (ước lượng, PI bù phần sai)")]
        public float aThrottleMax = 4f;
        [Tooltip("Giảm tốc (m/s²) ứng với phanh 100%")]
        public float aBrakeMax = 9f;
        public float kp = 0.6f, ki = 0.8f, iLimit = 0.5f;

        public double cmdSteer, cmdAccel;
        [HideInInspector] public bool manual;
        [HideInInspector] public float manThrottle, manBrake, manSteer; // manSteer: −1..1, dương = trái
        public float MeasuredAccel { get; private set; }
        public float ForwardSpeed { get; private set; }
        public float Throttle => _in.throttleInput;
        public float Brake => _in.brakeInput;

        readonly RCCP_Inputs _in = new();
        float _integ, _vPrev;
        bool _hasPrev;

        public void Init(RCCP_CarController c)
        {
            car = c;
            c.Inputs.overrideExternalInputs = true; // bỏ auto-reverse, steering limiter, counter-steer
            // Deadzone mặc định 0.05 là để chống rung tay cầm. Với lệnh AV, nó xóa mọi hiệu chỉnh lái < 2° và làm
            // lệnh nhỏ chỉ còn khoảng nửa: u' = (|u| − 0.05)/0.95 (BUG_LOG B31)
            c.Inputs.steeringDeadzone = 0f;
            c.Inputs.throttleDeadzone = 0f;
            c.Inputs.brakeDeadzone = 0f;
            c.Inputs.handbrakeDeadzone = 0f;
            c.Inputs.clutchDeadzone = 0f;
            c.Inputs.OverrideInputs(_in);
            ResetState();
        }

        public void ResetState()
        {
            _integ = 0f;
            _hasPrev = false;
            MeasuredAccel = 0f;
            cmdSteer = cmdAccel = 0;
        }

        void FixedUpdate()
        {
            if (car == null) return;
            float dt = Time.fixedDeltaTime;
            var rb = car.Rigid;
            ForwardSpeed = Vector3.Dot(rb.linearVelocity, car.transform.forward);
            if (_hasPrev)
            {
                float aRaw = (ForwardSpeed - _vPrev) / Mathf.Max(dt, 1e-4f);
                float k = 1f - Mathf.Exp(-dt / 0.08f); // lọc thông thấp τ = 80 ms
                MeasuredAccel += (aRaw - MeasuredAccel) * k;
            }
            _vPrev = ForwardSpeed;
            _hasPrev = true;

            float aCmd = (float)cmdAccel;
            float err = aCmd - MeasuredAccel;
            _integ = Mathf.Clamp(_integ + err * dt, -iLimit / Mathf.Max(ki, 1e-3f), iLimit / Mathf.Max(ki, 1e-3f));
            float ff = aCmd >= 0f ? aCmd / aThrottleMax : aCmd / aBrakeMax;
            float u = ff + kp * err / aThrottleMax + ki * _integ;

            if (aCmd <= 0f && ForwardSpeed < 0.3f)
            {
                u = -1f; // giữ xe đứng yên
                _integ = 0f;
            }
            _in.throttleInput = Mathf.Clamp01(u);
            _in.brakeInput = Mathf.Clamp01(-u);
            _in.handbrakeInput = 0f;
            _in.clutchInput = 0f;
            float maxSteer = car.FrontAxle != null ? car.FrontAxle.maxSteerAngle : 40f;
            _in.steerInput = Mathf.Clamp((float)(-cmdSteer * Mathf.Rad2Deg) / maxSteer, -1f, 1f);
            if (manual)
            {
                _in.throttleInput = manThrottle;
                _in.brakeInput = manBrake;
                _in.steerInput = -manSteer;
                _integ = 0f;
            }
        }
    }
}
