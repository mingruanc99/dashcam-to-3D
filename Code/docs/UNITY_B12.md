# Hướng dẫn: port scenario sang Unity để kiểm tra va chạm vật lý (B12)

**Mục tiêu:** chạy lại `scenarios/handmade/lead_brake.json` ở mode M2 trong Unity, với Rigidbody và Collider thật, AV vẫn là Python (qua `bridge/tcp_server.py`).
Sau đó so với sim Python: ở **t ≈ 23 s** xe máy `id 2` (14 m/s) tông đuôi ego (≈ 9.3 m/s).
Unity phải xác nhận được (1) có va chạm, (2) va chạm ở **đuôi** ego, tức là không do AV gây ra.

Phần này cậu tự làm. Tớ chỉ đưa các bước và code khung.

---

## Bước 0: Project

1. Unity Hub → New project → **Universal 3D (URP)**, dùng Unity 6000.6 (máy cậu đã có).
2. Package Manager → *Add package by name* → `com.unity.nuget.newtonsoft-json` (đọc JSON có mảng lồng nhau; JsonUtility không đọc được `[[x, y], ...]`).
3. Tạo thư mục `Assets/Scripts/Scenario`, `Assets/Scripts/Sim`, `Assets/StreamingAssets`.
4. Copy `lead_brake.json` vào `Assets/StreamingAssets/`.

## Bước 1: Đổi hệ tọa độ (quan trọng nhất)

Scenario dùng hệ tay phải: x tiến, y trái, z lên, yaw ngược chiều kim đồng hồ.
Unity dùng hệ tay trái: y lên, quay quanh trục Y theo chiều kim đồng hồ khi nhìn từ trên xuống.

```
Unity.position = (x_sim, 0, y_sim)          // đổi chỗ y và z => đổi luôn tay phải ↔ tay trái, không bị lật gương
Unity.rotY     = 90° − yaw_sim(độ)          // forward Unity = (sin ψ, 0, cos ψ) phải bằng (cos yaw, 0, sin yaw)
```

Kiểm tra nhanh: một vật có yaw = 0 phải hướng về +X của Unity (rotY = 90°). Một vật có yaw = +90° (sang trái) phải hướng về +Z (rotY = 0).

```csharp
public static class SimFrame {
    public static Vector3 Pos(double x, double y, float z = 0) => new Vector3((float)x, z, (float)y);
    public static Quaternion Rot(double yaw) => Quaternion.Euler(0, 90f - (float)(yaw * Mathf.Rad2Deg), 0);
    public static double YawFromUnity(Transform t) => (90.0 - t.eulerAngles.y) * Mathf.Deg2Rad;
    public static (double x, double y) XY(Vector3 p) => (p.x, p.z);
}
```

## Bước 2: Đọc scenario (DTO)

```csharp
using Newtonsoft.Json;
public class State { public double t, x, y, yaw, v; }
public class AgentDto { public object id; [JsonProperty("class")] public string cls; public double[] size; public State[] trajectory; }
public class LaneDto { public string id; public double[][] centerline; public double width; public string left, right; }
public class Scenario {
    public MapDto map; public EgoDto ego; public AgentDto[] agents;
    [JsonProperty("traffic_lights")] public LightDto[] trafficLights;
    public class MapDto { public LaneDto[] lanes; }
    public class EgoDto { public double[] size; public State[] trajectory; }
    public class LightDto { public string id; public double[] pos; public object[][] states; }
}
// ScenarioLoader.Awake():
// var scn = JsonConvert.DeserializeObject<Scenario>(File.ReadAllText(Path.Combine(Application.streamingAssetsPath, "lead_brake.json")));
```

## Bước 3: Agent chạy theo log (mode M2)

- Mỗi agent là một **hộp**, gắn **Rigidbody `isKinematic = true`** và BoxCollider. Cube `localScale = (W, H, L)`: với phép xoay ở Bước 1, trục **Z cục bộ là hướng đầu xe**, nên chiều dài đặt ở z.
- Pivot nằm ở **tâm hộp**, vì scenario lưu vị trí tâm xe.
- Nội suy tuyến tính theo t giống `Agent.log_state` trong Python, rồi gọi `MovePosition` và `MoveRotation` trong bước vật lý.
- Ngoài khoảng [t0, t1] của log thì `SetActive(false)`.

```csharp
public class AgentReplay : MonoBehaviour {
    public State[] traj; Rigidbody rb;
    void Awake() => rb = GetComponent<Rigidbody>();
    public void Step(double t) {                     // gọi trước Physics.Simulate
        if (t < traj[0].t || t > traj[^1].t) { gameObject.SetActive(false); return; }
        gameObject.SetActive(true);
        int i = System.Array.FindLastIndex(traj, s => s.t <= t); i = Mathf.Clamp(i, 0, traj.Length - 2);
        var a = traj[i]; var b = traj[i + 1]; double k = (t - a.t) / (b.t - a.t);
        rb.MovePosition(SimFrame.Pos(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 0.75f));
        rb.MoveRotation(SimFrame.Rot(a.yaw + (b.yaw - a.yaw) * k));
    }
}
```

⚠️ Hai Rigidbody **cùng kinematic** thì Unity **không** sinh `OnCollisionEnter`. Ego phải là Rigidbody **không** kinematic (dynamic), hoặc dùng `isTrigger` + `OnTriggerEnter`.

## Bước 4: Ego

Làm theo hai giai đoạn để biết lệch là do đâu:

1. **Ego kinematic bicycle viết lại bằng C#**, y hệt `sim/vehicle.py` (β, tau_accel = 0.25, không cho chạy lùi). Rigidbody đặt `isKinematic = false`, `useGravity = false`, khóa xoay X/Z, rồi gọi `MovePosition` theo kết quả bicycle. Giai đoạn này **phải khớp Python** gần như tuyệt đối. Không khớp tức là sai đổi tọa độ.
2. Sau đó mới thay bằng **WheelCollider** (vật lý thật: bánh, ma sát, quán tính). Lúc này lệch so với Python là "domain gap" của mô hình xe, và đó là điều ta muốn đo.

```csharp
// bicycle.Step(steer, accel, dt): đúng thứ tự như vehicle.py
a += (aCmd - a) * Mathf.Min(1, dt / 0.25f);
double lr = wheelbase / 2, beta = System.Math.Atan(lr / wheelbase * System.Math.Tan(steer));
x += v * System.Math.Cos(yaw + beta) * dt;  y += v * System.Math.Sin(yaw + beta) * dt;
yaw += v / lr * System.Math.Sin(beta) * dt;  v = System.Math.Max(0, v + a * dt);
```

## Bước 5: Lockstep với Python

```csharp
void Start() {
    Physics.simulationMode = SimulationMode.Script;     // Unity không tự chạy vật lý nữa
    Time.fixedDeltaTime = 0.05f;
    bridge.Connect("127.0.0.1", 5555);
    bridge.Send(new { type = "reset", lanes = scn.map.lanes });  bridge.Receive();
}
void Update() {                                          // mỗi frame render chạy 1 bước sim (hoặc nhiều bước nếu muốn nhanh)
    foreach (var ag in agents) ag.Step(t + dt);           // agent theo log lên t+dt (khớp với B08 trong bug log)
    var cmd = bridge.Step(BuildObservation(t));           // gửi obs, ĐỨNG CHỜ reply
    ego.Step(cmd.steer, cmd.accel, dt);
    Physics.Simulate(dt);                                 // va chạm được tính ở đây
    t += dt;
}
```

`BridgeClient`: `TcpClient` + `StreamReader.ReadLine()` / `StreamWriter.WriteLine(JsonConvert.SerializeObject(msg))`, nhớ đặt `AutoFlush = true`.
Observation phải có đúng format trong docstring của `bridge/tcp_server.py`. Mọi tọa độ trong đó đổi về hệ sim bằng `SimFrame.XY` và `SimFrame.YawFromUnity`.

Chạy: `.venv\Scripts\python -m bridge.tcp_server --port 5555`, sau đó bấm Play.

## Bước 6: Ghi và phân loại va chạm

```csharp
public class CollisionLogger : MonoBehaviour {            // gắn lên ego
    void OnCollisionEnter(Collision c) {
        var p = transform.InverseTransformPoint(c.GetContact(0).point);   // điểm chạm trong hệ ego (z = phía trước)
        string zone = p.z > 0.25f * egoLength ? "front" : (p.z < -0.25f * egoLength ? "rear" : "side");
        Debug.Log($"t={sim.t:F2} hit {c.gameObject.name} zone={zone} relV={c.relativeVelocity.magnitude:F2}");
        // ghi thêm vào CSV: t, id, zone, relV, ego_v, agent_v
    }
}
```

- `front` → AV gây ra (at-fault).
- `rear` → bị tông từ phía sau. Ở M2 thì không tính cho AV (đây đúng là trường hợp B12).
- `side` → cần xem lại, thường do đổi làn ẩu. Nên tính cho AV.

## Bước 7: Đối chiếu

| | Python sim (`runs/lead_brake_M2/report.json`) | Unity |
|---|---|---|
| Có va chạm? | có, `id 2` motorbike | ? |
| Thời điểm | t ≈ 23.0 s | ? (lệch < 0.2 s là ổn) |
| ego_v / agent_v | 9.31 / 14.0 m/s | ? |
| Vùng chạm | (Python chưa phân loại) | rear? |

Unity cho kết quả `rear` thì sửa test M2 theo đề xuất 1 trong `TEST_CONDITIONS.md` (chỉ đếm va chạm do AV gây ra). Tớ sẽ thêm phân loại front/rear/side vào sim Python để hai bên dùng cùng một tiêu chí.
