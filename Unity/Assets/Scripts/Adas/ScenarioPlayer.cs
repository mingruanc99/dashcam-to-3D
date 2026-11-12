using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.Video;

namespace Adas
{
    /// <summary>Quỹ đạo theo thời gian, nội suy tuyến tính (giống Agent.log_state / EgoLog.at trong sim Python).</summary>
    public class Track
    {
        public double[] t, x, y, yaw, v;

        public static Track From(JArray traj)
        {
            int n = traj.Count;
            var tr = new Track { t = new double[n], x = new double[n], y = new double[n], yaw = new double[n], v = new double[n] };
            for (int i = 0; i < n; i++)
            {
                var p = traj[i];
                tr.t[i] = (double)p["t"]; tr.x[i] = (double)p["x"]; tr.y[i] = (double)p["y"];
                tr.v[i] = (double)p["v"];
                double yw = (double)p["yaw"];
                // unwrap: tránh nội suy vòng qua 0 khi yaw nhảy từ +π sang −π (BUG_LOG B17 #6)
                if (i > 0) yw = tr.yaw[i - 1] + Math.IEEERemainder(yw - tr.yaw[i - 1], 2 * Math.PI);
                tr.yaw[i] = yw;
            }
            return tr;
        }

        /// <summary>Quỹ đạo "sống": một mẫu duy nhất, được bridge cập nhật mỗi bước (NPC theo kịch bản).</summary>
        public bool live, hasData;

        public static Track Live() => new Track
        {
            live = true, t = new double[1], x = new double[1], y = new double[1], yaw = new double[1], v = new double[1],
        };

        public void Set(double px, double py, double pyaw, double pv)
        {
            x[0] = px; y[0] = py; yaw[0] = pyaw; v[0] = pv;
            hasData = true;
        }

        public double T0 => t[0];
        public double T1 => t[t.Length - 1];
        public bool Active(double tt) => live ? hasData : tt >= T0 - 1e-6 && tt <= T1 + 1e-6;

        public (double x, double y, double yaw, double v) At(double tt)
        {
            if (t.Length == 1 || tt <= T0) return (x[0], y[0], yaw[0], v[0]);
            int last = t.Length - 1;
            if (tt >= T1) return (x[last], y[last], yaw[last], v[last]);
            int i = Array.BinarySearch(t, tt);
            if (i < 0) i = ~i - 1;
            i = Mathf.Clamp(i, 0, last - 1);
            double k = (tt - t[i]) / (t[i + 1] - t[i]);
            return (x[i] + (x[i + 1] - x[i]) * k, y[i] + (y[i + 1] - y[i]) * k,
                    yaw[i] + (yaw[i + 1] - yaw[i]) * k, v[i] + (v[i + 1] - v[i]) * k);
        }
    }

    /// <summary>Xe đạp động học, giống hệt sim/vehicle.py. Bước 1 của port: phải khớp Python trước khi thay bằng RCC.</summary>
    public class KinematicBicycle
    {
        public double x, y, yaw, v, a, steer;
        public double wheelbase = 2.7, maxSteer = 0.6, tauAccel = 0.25, aMin = -8, aMax = 3, vMax = 40;

        public void Step(double steerCmd, double accelCmd, double dt)
        {
            steer = Math.Clamp(steerCmd, -maxSteer, maxSteer);
            double aCmd = Math.Clamp(accelCmd, aMin, aMax);
            a += (aCmd - a) * Math.Min(1.0, dt / tauAccel);
            double lr = wheelbase / 2, beta = Math.Atan(lr / wheelbase * Math.Tan(steer));
            x += v * Math.Cos(yaw + beta) * dt;
            y += v * Math.Sin(yaw + beta) * dt;
            yaw += v / lr * Math.Sin(beta) * dt;
            double vn = v + a * dt;
            if (vn < 0) { vn = 0; a = 0; }
            v = Math.Min(vn, vMax);
        }
    }

    /// <summary>
    /// Simulator kiểu AWSIM cho scenario của adastest.
    ///   M1_Replay     : ego và agent đều theo log (so cảnh 3D với video gốc).
    ///   M2_ClosedLoop : AV Python lái ego qua bridge TCP, agent theo log. Không nối được bridge thì quay về M1.
    /// Phím: Space dừng/chạy · R chạy lại · C đổi camera (đuôi xe / dashcam / trên cao) · +/- tốc độ · V video · L LiDAR · H ẩn/hiện panel.
    /// Scene có thể dựng sẵn trong editor (menu ADAS → Dựng scene). Khi Play, môi trường dựng sẵn được giữ lại,
    /// còn xe ("Preview") được tạo lại từ đầu.
    /// </summary>
    public class ScenarioPlayer : MonoBehaviour
    {
        public enum Mode { M1_Replay, M2_ClosedLoop }

        [Serializable]
        public class ClassPrefab
        {
            public string cls;
            public GameObject prefab;
        }

        [Header("Dữ liệu (Assets/StreamingAssets)")]
        public string scenarioFile = "clip02.json";
        public string videoFile = "clip02.mp4";

        [Header("Chạy")]
        public Mode mode = Mode.M1_Replay;
        public float dt = 0.05f;
        public float speed = 1f;
        public string bridgeHost = "127.0.0.1";
        public int bridgePort = 5555;

        [Header("Cảm biến")]
        public bool lidarEnabled = true;
        public int lidarEverySteps = 2; // 0.05 s × 2 = 10 Hz

        [Header("Model thật thay cho model low-poly (để trống = dùng VehicleFactory)")]
        public List<ClassPrefab> classPrefabs = new();

        public enum EgoModel { Kinematic, RCC }

        [Header("Xe ego")]
        [Tooltip("Kinematic: xe đạp động học giống hệt sim Python (tất định). RCC: vật lý thật của Realistic Car Controller Pro")]
        public EgoModel egoModel = EgoModel.Kinematic;
        public RCCP_CarController rccPrefab;
        [Tooltip("Số bước vật lý trong một bước sim khi dùng RCC: fixedDeltaTime = dt / substeps")]
        public int rccSubsteps = 5;

        public enum DriverMode { AV, Manual }

        [Header("Người lái")]
        [Tooltip("AV: Python lái. Manual: cậu lái (phím M đổi khi đang chạy), AV vẫn chạy ngầm để so sánh")]
        public DriverMode driver = DriverMode.AV;
        [Tooltip("Ghi phiên lái tay vào Logs/drives/ để train model")]
        public bool logDrive = true;
        [HideInInspector] public float manualTestThrottle = -1f;

        [Header("Batch (chạy tự động)")]
        public bool autoExitWhenDone;
        [Tooltip("Chụp camera chính ra Logs/shots/ tại các thời điểm này (giây sim), dùng để kiểm tra")]
        public float[] captureAt = new float[0];
        int _captureIdx;

        /// <summary>Layer không được coi là vật cản: Ignore Raycast + layer của xe RCC (RCCP_Vehicle, WheelCollider, DetachablePart).</summary>
        public const int EgoLayers = (1 << 2) | (1 << 8) | (1 << 9) | (1 << 10);

        class AgentRt
        {
            public string id, cls;
            public float L, W, H;
            public Track track;
            public GameObject go;
            public WheelVisuals wheels;
            public bool crashed;
            public float crashV, crashClock;
            public double crashLast;
            public Vector3 crashDir;
            public Quaternion crashBase;
        }

        // --- dữ liệu
        JObject _scn;
        JArray _lanes;
        Track _egoLog;
        readonly List<AgentRt> _agents = new();
        readonly List<(JArray states, Renderer[] lamps)> _lights = new();
        double _t, _tEnd, _acc, _speedLimit = 50 / 3.6;
        float _egoL = 4.5f, _egoW = 1.8f, _egoH = 1.5f;
        float _camHeight = 1.35f, _camPitch, _camVFov = 50f;
        double[] _originGps;

        // --- đối tượng
        Transform _actors;
        KinematicBicycle _ego;
        GameObject _egoGo;
        WheelVisuals _egoWheels;
        Camera _sensorCam;
        RenderTexture _sensorRt;
        LidarSensor _lidar;
        LineRenderer _plannedPath;
        int _stepCount;
        RCCP_CarController _rcc;
        RccDriver _drv;
        Vector3 _rccCenterLocal;
        float _rccPivotHeight;
        double _subT;
        float _warm;
        Vector3 _warmPos;
        Quaternion _warmRot;
        float _warmV;
        bool _done;
        StreamWriter _egoCsv;
        readonly ManualInput _manual = new();
        DriveLogger _drive;
        // bảng thông số
        bool _showParams;
        JArray _params, _presets;
        string _preset;
        readonly Dictionary<string, double> _paramOverrides = new();
        Vector2 _paramScroll;
        bool UseRcc => egoModel == EgoModel.RCC && rccPrefab != null && Application.isPlaying;

        // --- chạy
        bool _paused, _showVideo = true, _showHud = true;
        int _camMode;
        BridgeClient _bridge;
        string _status = "";
        JObject _lastCmd;
        readonly List<string> _events = new();
        readonly HashSet<string> _hit = new();
        StreamWriter _csv;
        VideoPlayer _video;
        RenderTexture _videoRt;
        Texture2D _white;

        public double SimTime => _t - (_egoLog?.T0 ?? 0);
        public double EndTime => _tEnd - (_egoLog?.T0 ?? 0);
        public string Status => _status;
        public int CollisionCount => _hit.Count;

        /// <summary>Đóng bridge và file log khi chạy ngoài Play mode (lúc đó OnDestroy không được gọi).</summary>
        public void Shutdown() => OnDestroy();

        // ================================================================ vòng đời
        void Start()
        {
            Load();
            if (egoModel == EgoModel.RCC && rccPrefab != null)
            {
                // RCC chạy trong FixedUpdate (lực bánh, động cơ, hộp số) nên vật lý phải chạy tự động.
                // Chế độ Script không gọi FixedUpdate, nên xe RCC sẽ đứng im (BUG_LOG B27).
                Physics.simulationMode = SimulationMode.FixedUpdate;
                Time.fixedDeltaTime = dt / Mathf.Max(1, rccSubsteps);
            }
            else Physics.simulationMode = SimulationMode.Script; // ta tự gọi Physics.Simulate theo bước sim (lockstep)
            var preview = GameObject.Find("Preview");
            if (preview != null) RoadBuilder.Kill(preview);
            BuildEnvironment();
            BuildActors();
            SetupVideo();
            Restart();
            UpdateCamera(1f, snap: true);
        }

        void OnDestroy()
        {
            _bridge?.Dispose();
            _csv?.Dispose();
            _drive?.Dispose();
        }

        public void Load()
        {
            var path = Path.Combine(Application.streamingAssetsPath, scenarioFile);
            _scn = JObject.Parse(File.ReadAllText(path));
            _lanes = (JArray)_scn["map"]?["lanes"] ?? new JArray();
            _egoLog = Track.From((JArray)_scn["ego"]["trajectory"]);
            var es = (JArray)_scn["ego"]["size"];
            _egoL = (float)es[0]; _egoW = (float)es[1]; _egoH = (float)es[2];
            _tEnd = _egoLog.T1;
            var meta = (JObject)_scn["meta"];
            if (meta?["speed_limit"] != null) _speedLimit = (double)meta["speed_limit"];
            if (meta?["origin_gps"] is JArray og && og.Count == 2) _originGps = new[] { (double)og[0], (double)og[1] };
            if (meta?["camera"] is JObject cam && cam["height"] != null)
            {
                _camHeight = (float)cam["height"];
                _camPitch = (float)(cam["pitch_deg"] ?? 0);
                if (cam["K"] is JArray K && cam["image_height"] != null)
                    _camVFov = 2f * Mathf.Atan((float)cam["image_height"] / 2f / (float)K[1][1]) * Mathf.Rad2Deg;
            }
        }

        int Seed()
        {
            int h = 17;
            foreach (var c in scenarioFile) h = h * 31 + c;
            return h;
        }

        /// <summary>Môi trường tĩnh (đường, vạch, vỉa hè, nhà, cây). Đã có sẵn trong scene thì dùng lại.</summary>
        public Transform BuildEnvironment()
        {
            var env = GameObject.Find("Environment");
            if (env != null) return env.transform;
            var root = RoadBuilder.Build(_lanes, null, Seed());
            // Đèn giao thông, quay mặt theo hướng ego tại vị trí gần nhất
            if (_scn["traffic_lights"] is JArray tls)
                foreach (var tl in tls)
                {
                    var p = (JArray)tl["pos"];
                    double px = (double)p[0], py = (double)p[1];
                    int best = 0;
                    double bd = double.MaxValue;
                    for (int i = 0; i < _egoLog.t.Length; i++)
                    {
                        double d = (_egoLog.x[i] - px) * (_egoLog.x[i] - px) + (_egoLog.y[i] - py) * (_egoLog.y[i] - py);
                        if (d < bd) { bd = d; best = i; }
                    }
                    RoadBuilder.TrafficLight(root, SimFrame.Pos(px, py, p.Count > 2 ? (float)p[2] : 4.5f),
                                             (float)_egoLog.yaw[best], (string)tl["id"]);
                }
            return root;
        }

        /// <summary>Xe, người, vật cản, ego + cảm biến. Tạo mới mỗi lần Play.</summary>
        public void BuildActors()
        {
            _agents.Clear();
            _lights.Clear();
            _actors = new GameObject("Actors").transform;

            foreach (var a in (JArray)_scn["agents"])
            {
                var s = (JArray)a["size"];
                string cls = (string)a["class"];
                float L = (float)s[0], W = (float)s[1], H = (float)s[2];
                bool down = (string)a["posture"] == "down";
                var ag = down
                    ? AddAgent(a["id"].ToString(), cls, (int?)a["variant"] ?? 0, cls == "pedestrian" ? 0.5f : 1.9f,
                               cls == "pedestrian" ? 0.5f : 0.7f, cls == "pedestrian" ? 1.7f : 1.5f, Track.From((JArray)a["trajectory"]))
                    : AddAgent(a["id"].ToString(), cls, (int?)a["variant"] ?? 0, L, W, H, Track.From((JArray)a["trajectory"]));
                if (down)
                {
                    // Dựng model bằng kích thước khi đứng rồi đặt nằm; va chạm theo kích thước thật lúc nằm (BUG_LOG B35)
                    VehicleFactory.LayDown(ag.go, cls);
                    var bc = ag.go.GetComponent<BoxCollider>();
                    bc.size = new Vector3(W, H, L);
                    bc.center = new Vector3(0, H / 2, 0);
                    ag.L = L; ag.W = W; ag.H = H;
                }
            }
            // NPC theo kịch bản: vị trí do Python (sim/director.py) gửi về mỗi bước
            if (_scn["npcs"] is JArray npcs)
                foreach (var n in npcs)
                {
                    var s = (JArray)n["size"];
                    AddAgent(n["id"].ToString(), (string)n["class"], 0, (float)s[0], (float)s[1], (float)s[2], Track.Live());
                }
            if (_scn["static_obstacles"] is JArray obs)
                foreach (var o in obs)
                {
                    var s = (JArray)o["size"]; var p = (JArray)o["pos"];
                    var still = new JArray(
                        new JObject { ["t"] = _egoLog.T0, ["x"] = p[0], ["y"] = p[1], ["yaw"] = 0, ["v"] = 0 },
                        new JObject { ["t"] = _egoLog.T1, ["x"] = p[0], ["y"] = p[1], ["yaw"] = 0, ["v"] = 0 });
                    var ag = AddAgent((string)o["id"], "obstacle", 0, (float)s[0], (float)s[1], Mathf.Max((float)s[2], 0.05f), Track.From(still));
                    if (!(bool)o["hazard"]) ag.go.GetComponent<Collider>().enabled = false; // thấp hơn 23 cm: xe đi qua được
                }

            // Đèn giao thông (đã dựng trong Environment): lấy 3 bóng đèn để đổi màu
            if (_scn["traffic_lights"] is JArray tls)
                foreach (var tl in tls)
                {
                    var go = GameObject.Find($"TrafficLight_{tl["id"]}");
                    if (go == null) continue;
                    var lamps = new Renderer[3];
                    for (int i = 0; i < 3; i++) lamps[i] = go.transform.Find($"Lamp{i}")?.GetComponent<Renderer>();
                    _lights.Add(((JArray)tl["states"], lamps));
                }

            Transform lidarMount, camMount;
            if (UseRcc)
            {
                // Ego = xe RCC Pro (vật lý thật). Không gán làm "player vehicle" để RCC không giành camera/UI.
                var s0 = _egoLog.At(_egoLog.T0);
                _rcc = RCCP.SpawnRCC(rccPrefab, SimFrame.Pos(s0.x, s0.y, 0.5f), SimFrame.Rot(s0.yaw), false, true, true);
                _egoGo = _rcc.gameObject;
                _egoGo.name = "Ego (RCC)";
                // Tâm xe và chiều cao pivot so với mặt đất, tính từ WheelCollider: đúng điểm tiếp đất của bánh,
                // chính xác hơn Renderer.bounds (prefab RCC có nhiều renderer phụ, BUG_LOG B28)
                var tr0 = _egoGo.transform;
                var wcs = _egoGo.GetComponentsInChildren<WheelCollider>(true);
                Vector3 sum = Vector3.zero;
                float groundLocalY = 0f, roofLocalY = 1.4f;
                foreach (var wc in wcs)
                {
                    var wl = tr0.InverseTransformPoint(wc.transform.TransformPoint(wc.center));
                    sum += wl;
                    groundLocalY += wl.y - wc.radius;
                }
                if (wcs.Length > 0)
                {
                    sum /= wcs.Length;
                    groundLocalY /= wcs.Length;
                }
                foreach (var col in _egoGo.GetComponentsInChildren<Collider>(true))
                {
                    if (col is WheelCollider || !col.enabled) continue;
                    roofLocalY = Mathf.Max(roofLocalY, tr0.InverseTransformPoint(col.bounds.center + Vector3.up * col.bounds.extents.y).y);
                }
                _rccCenterLocal = new Vector3(sum.x, 0f, sum.z);
                _rccPivotHeight = -groundLocalY;
                Debug.Log(string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "[ADAS] RCC: {0} bánh, tâm cục bộ ({1:F2}, {2:F2}), pivot cao {3:F2} m so với mặt đất, nóc {4:F2} m",
                    wcs.Length, _rccCenterLocal.x, _rccCenterLocal.z, _rccPivotHeight, roofLocalY - groundLocalY));
                lidarMount = new GameObject("LidarMount").transform;
                lidarMount.SetParent(_egoGo.transform, false);
                lidarMount.localPosition = _rccCenterLocal + Vector3.up * (roofLocalY + 0.25f);
                camMount = new GameObject("CameraMount").transform;
                camMount.SetParent(_egoGo.transform, false);
                camMount.localPosition = _rccCenterLocal + new Vector3(0f, _camHeight - _rccPivotHeight, 0.3f);
                _drv = _egoGo.AddComponent<RccDriver>();
                _drv.Init(_rcc);
                _egoWheels = null;
            }
            else
            {
                // Ego: kinematic + trigger, layer 2 (Ignore Raycast) để LiDAR không bắn trúng chính nó
                var (ego, lm, cm) = VehicleFactory.Ego(_egoL, _egoW, _egoH, _camHeight);
                lidarMount = lm;
                camMount = cm;
                _egoGo = ego;
                _egoGo.transform.SetParent(_actors, false);
                foreach (var tr in _egoGo.GetComponentsInChildren<Transform>()) tr.gameObject.layer = 2;
                _egoGo.GetComponent<BoxCollider>().isTrigger = true;
                var rb = _egoGo.AddComponent<Rigidbody>();
                rb.isKinematic = true;
                rb.useGravity = false;
                _egoWheels = _egoGo.GetComponent<WheelVisuals>();
            }

            // Camera trước (đặt đúng chiều cao, pitch, FOV của dashcam gốc)
            _sensorRt = new RenderTexture(640, 360, 24) { name = "front_camera_rt" };
            var camGo = new GameObject("FrontCamera");
            camGo.transform.SetParent(camMount, false);
            camGo.transform.localRotation = Quaternion.Euler(_camPitch, 0f, 0f);
            _sensorCam = camGo.AddComponent<Camera>();
            _sensorCam.fieldOfView = _camVFov;
            _sensorCam.nearClipPlane = 0.1f;
            _sensorCam.farClipPlane = 600f;
            _sensorCam.targetTexture = _sensorRt;
            _sensorCam.cullingMask = ~((1 << LidarSensor.PointCloudLayer) | EgoLayers); // không thấy point cloud và thân ego

            _lidar = lidarMount.gameObject.AddComponent<LidarSensor>();
            _lidar.mask = ~EgoLayers;
            _lidar.Init(_actors);

            _plannedPath = new GameObject("PlannedPath").AddComponent<LineRenderer>();
            _plannedPath.transform.SetParent(_actors, false);
            _plannedPath.sharedMaterial = AdasAssets.Unlit("adas_path", new Color(0.2f, 1f, 0.4f));
            _plannedPath.widthMultiplier = 0.35f;
            _plannedPath.positionCount = 0;

            if (Camera.main == null)
            {
                var mc = new GameObject("Main Camera") { tag = "MainCamera" };
                mc.AddComponent<Camera>();
                mc.AddComponent<AudioListener>();
            }
        }

        AgentRt AddAgent(string id, string cls, int variant, float L, float W, float H, Track tr)
        {
            GameObject go = null;
            foreach (var cp in classPrefabs)
                if (cp != null && cp.prefab != null && cp.cls == cls) { go = Instantiate(cp.prefab); break; }
            if (go == null) go = VehicleFactory.Create(cls, L, W, H, variant, $"{cls}_{id}");
            go.name = $"{cls}_{id}";
            go.transform.SetParent(_actors, false);
            if (go.GetComponent<Collider>() == null)
            {
                var bc = go.AddComponent<BoxCollider>();
                bc.size = new Vector3(W, H, L);
                bc.center = new Vector3(0, H / 2, 0);
            }
            // KHÔNG dùng "GetComponent() ?? AddComponent()": Unity trả về object null giả (fake null),
            // toán tử ?? của C# không nhận ra nên không bao giờ AddComponent (BUG_LOG B23)
            var rb = go.GetComponent<Rigidbody>();
            if (rb == null) rb = go.AddComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.useGravity = false;
            var tag = go.AddComponent<AgentTag>();
            tag.id = id;
            tag.cls = cls;
            var ag = new AgentRt { id = id, cls = cls, L = L, W = W, H = H, track = tr, go = go, wheels = go.GetComponent<WheelVisuals>() };
            _agents.Add(ag);
            return ag;
        }

        void SetupVideo()
        {
            var path = Path.Combine(Application.streamingAssetsPath, videoFile ?? "");
            if (string.IsNullOrEmpty(videoFile) || !File.Exists(path)) { _showVideo = false; return; }
            _videoRt = new RenderTexture(960, 540, 0);
            _video = gameObject.AddComponent<VideoPlayer>();
            _video.playOnAwake = false;
            _video.source = VideoSource.Url;
            _video.url = path;
            _video.renderMode = VideoRenderMode.RenderTexture;
            _video.targetTexture = _videoRt;
            _video.audioOutputMode = VideoAudioOutputMode.None;
            _video.skipOnDrop = true;
            _video.Prepare();
        }

        public void Restart(bool connectBridge = true)
        {
            _t = _egoLog.T0;
            _acc = 0;
            _stepCount = 0;
            _events.Clear();
            _hit.Clear();
            var s = _egoLog.At(_t);
            _ego = new KinematicBicycle { x = s.x, y = s.y, yaw = s.yaw, v = s.v };
            _subT = 0;
            _done = false;
            if (UseRcc)
            {
                // Đặt xe RCC đúng tư thế ban đầu của log, kèm vận tốc ban đầu
                var rot = SimFrame.Rot(s.yaw);
                var pos = SimFrame.Pos(s.x, s.y, _rccPivotHeight + 0.02f) - rot * _rccCenterLocal;
                var rb = _rcc.Rigid;
                _egoGo.transform.SetPositionAndRotation(pos, rot);
                rb.position = pos;
                rb.rotation = rot;
                rb.linearVelocity = rot * Vector3.forward * (float)s.v;
                rb.angularVelocity = Vector3.zero;
                _drv.ResetState();
                _drv.manual = false;
                // Pha làm nóng: bánh xe lúc spawn đứng yên (0 rpm) trong khi xe chạy 12 m/s, và động cơ RCC cần 1 s để khởi động.
                // Giữ xe ở tư thế + vận tốc ban đầu 1.5 s để bánh lăn theo mặt đường, nếu không thì phanh/ABS không ăn (BUG_LOG B30).
                _warm = 1.5f;
                _warmPos = pos;
                _warmRot = rot;
                _warmV = (float)s.v;
                Time.timeScale = speed;
            }
            else PlaceEgo();
            foreach (var ag in _agents) PlaceAgent(ag, _t, teleport: true);
            UpdateLights();
            Physics.SyncTransforms();
            if (lidarEnabled && _lidar != null) _lidar.Scan();

            _bridge?.Dispose();
            _bridge = null;
            _lastCmd = null;
            if (_plannedPath != null) _plannedPath.positionCount = 0;
            if (!connectBridge) { _status = "Preview"; return; }

            _csv?.Dispose();
            var logDir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Logs"));
            Directory.CreateDirectory(logDir);
            _csv = new StreamWriter(Path.Combine(logDir, "adas_collisions.csv"));
            _csv.WriteLine("t,agent_id,class,zone,ego_v,mode");
            _egoCsv?.Dispose();
            var scnName = Path.GetFileNameWithoutExtension(scenarioFile);
            _egoCsv = new StreamWriter(Path.Combine(logDir, $"adas_ego_{scnName}_{(UseRcc ? "RCC" : "Kinematic")}.csv"));
            _egoCsv.WriteLine("t,x,y,yaw,v,a,steer,cmd_steer,cmd_accel,throttle,brake,lon_mode,lane,target_lane,lead_id,lead_gap,lead_v");

            _drive?.Dispose();
            _drive = null;
            _manual.testThrottle = manualTestThrottle;
            foreach (var ag in _agents)
                if (ag.track.live) ag.track.hasData = false;
            if (mode == Mode.M2_ClosedLoop || _scn["npcs"] is JArray)
            {
                _bridge = new BridgeClient();
                if (_bridge.TryConnect(bridgeHost, bridgePort))
                {
                    var rep = _bridge.Call(new JObject { ["type"] = "reset", ["lanes"] = _lanes, ["npcs"] = _scn["npcs"] ?? new JArray() });
                    ApplyNpcs(rep?["npcs"] as JArray);
                    foreach (var ag in _agents)
                        if (ag.track.live) PlaceAgent(ag, _t, teleport: true);
                    _params = rep?["params"] as JArray;
                    _presets = rep?["presets"] as JArray;
                    ResendParams();
                    _status = $"AV Python đã nối {bridgeHost}:{bridgePort}";
                }
                else
                {
                    _bridge = null;
                    _status = "Không nối được bridge → chạy M1. Chạy: python -m bridge.tcp_server --port 5555";
                }
            }
            else _status = "M1: ego chạy theo log";
        }

        // ================================================================ vòng lặp
        void Update()
        {
            var kb = Keyboard.current;
            if (kb != null)
            {
                if (kb.spaceKey.wasPressedThisFrame) _paused = !_paused;
                if (kb.rKey.wasPressedThisFrame) Restart();
                if (kb.cKey.wasPressedThisFrame) { _camMode = (_camMode + 1) % 3; UpdateCamera(1f, true); }
                if (kb.vKey.wasPressedThisFrame) _showVideo = !_showVideo && _video != null;
                if (kb.lKey.wasPressedThisFrame) lidarEnabled = !lidarEnabled;
                if (kb.hKey.wasPressedThisFrame) _showHud = !_showHud;
                if (kb.pKey.wasPressedThisFrame) _showParams = !_showParams;
                if (kb.mKey.wasPressedThisFrame)
                    driver = driver == DriverMode.AV ? DriverMode.Manual : DriverMode.AV;
                if (kb.equalsKey.wasPressedThisFrame || kb.numpadPlusKey.wasPressedThisFrame) speed = Mathf.Min(speed * 2f, 16f);
                if (kb.minusKey.wasPressedThisFrame || kb.numpadMinusKey.wasPressedThisFrame) speed = Mathf.Max(speed / 2f, 0.125f);
            }
            if (driver == DriverMode.Manual) _manual.Poll(Time.unscaledDeltaTime);
            float effSpeed = driver == DriverMode.Manual ? 1f : speed; // lái tay thì phải đúng thời gian thực
            if (UseRcc)
            {
                Time.timeScale = _paused || _done ? 0f : effSpeed; // RCC: thời gian thật, chạy nhanh/chậm bằng timeScale
            }
            else if (!_paused && _t < _tEnd - 1e-6)
            {
                _acc += Time.deltaTime * effSpeed;
                int k = 0;
                while (_acc >= dt && k++ < 40 && _t < _tEnd - 1e-6)
                {
                    Step();
                    _acc -= dt;
                }
                if (_t >= _tEnd - 1e-6) Finish();
            }
            SyncVideo();
        }

        void LateUpdate()
        {
            UpdateCamera(Time.deltaTime, false);
            if (captureAt != null && _captureIdx < captureAt.Length && SimTime >= captureAt[_captureIdx])
            {
                var cam = Camera.main;
                var dir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Logs", "shots"));
                Directory.CreateDirectory(dir);
                var rt = new RenderTexture(1600, 900, 24);
                cam.targetTexture = rt;
                cam.Render();
                RenderTexture.active = rt;
                var tex = new Texture2D(1600, 900, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, 1600, 900), 0, 0);
                tex.Apply();
                var name = $"play_{Path.GetFileNameWithoutExtension(scenarioFile)}_{(UseRcc ? "RCC" : "Kin")}_t{captureAt[_captureIdx]:00}.png";
                File.WriteAllBytes(Path.Combine(dir, name), tex.EncodeToPNG());
                cam.targetTexture = null;
                RenderTexture.active = null;
                Destroy(rt);
                Destroy(tex);
                _captureIdx++;
            }
        }

        public void Step()
        {
            double tn = _t + dt;
            // 1) AV nhìn thế giới ở thời điểm t (trước khi mọi thứ tiến lên), cùng thứ tự với sim/world.py
            JObject cmd = QueryAv();
            // 2) ego lên t+dt
            if (driver == DriverMode.Manual)
                _ego.Step(_manual.steer * 0.45, 3.0 * _manual.throttle - 8.0 * _manual.brake, dt);
            else if (cmd == null)
            {
                var s = _egoLog.At(tn);
                _ego.steer = 0;
                _ego.a = (s.v - _ego.v) / dt;
                _ego.x = s.x; _ego.y = s.y; _ego.yaw = s.yaw; _ego.v = s.v;
            }
            else _ego.Step((double)cmd["steer"], (double)cmd["accel"], dt);
            PlaceEgo();
            // 3) agent theo log lên t+dt (BUG_LOG B08)
            foreach (var ag in _agents) PlaceAgent(ag, tn);
            // 4) vật lý, rồi hỏi hộp ego đang chồng lên collider nào (BUG_LOG B21)
            Physics.Simulate(dt);
            _t = tn;
            CheckCollisions();
            LogEgo(cmd);
            // 5) cảm biến + hiển thị
            _stepCount++;
            if (lidarEnabled && _lidar != null && _stepCount % Mathf.Max(lidarEverySteps, 1) == 0) _lidar.Scan();
            _egoWheels?.UpdateWheels((float)_ego.steer, (float)_ego.v, dt);
            foreach (var ag in _agents)
                if (ag.wheels != null && ag.go.activeSelf) ag.wheels.UpdateWheels(0f, (float)ag.track.At(_t).v, dt);
            UpdateLights();
            UpdatePlannedPath();
        }

        // ================================================================ RCC (vật lý thật)
        void FixedUpdate()
        {
            if (!UseRcc || _done || _drv == null) return;
            if (_warm > 0f)
            {
                _warm -= Time.fixedDeltaTime;
                var rbw = _rcc.Rigid;
                // giữ xe tại chỗ nhưng mặt đường "chạy" dưới bánh với đúng vận tốc ban đầu
                rbw.position = _warmPos;
                rbw.rotation = _warmRot;
                rbw.linearVelocity = _warmRot * Vector3.forward * _warmV;
                rbw.angularVelocity = Vector3.zero;
                _drv.cmdAccel = 0;
                _drv.cmdSteer = 0;
                if (_warm <= 0f) _drv.ResetState();
                foreach (var ag in _agents) PlaceAgent(ag, _t, teleport: true);
                return;
            }
            if (_subT <= 1e-9) RccLogicStep(); // đầu mỗi bước sim: AV nhìn thế giới ở t, ra lệnh giữ suốt dt
            _subT += Time.fixedDeltaTime;
            foreach (var ag in _agents) PlaceAgent(ag, _t + _subT); // agent đi mượt theo từng substep
            if (_subT >= dt - 1e-6)
            {
                _subT = 0;
                _t += dt;
                CheckCollisions();
                _stepCount++;
                if (lidarEnabled && _lidar != null && _stepCount % Mathf.Max(lidarEverySteps, 1) == 0) _lidar.Scan();
                UpdateLights();
                UpdatePlannedPath();
                if (_t >= _tEnd - 1e-6) Finish();
            }
        }

        Vector3 EgoCenterGround() =>
            UseRcc ? _egoGo.transform.TransformPoint(_rccCenterLocal) - Vector3.up * _rccPivotHeight
                   : _egoGo.transform.position;

        void ReadRccState()
        {
            var c = EgoCenterGround();
            _ego.x = c.x;
            _ego.y = c.z;
            _ego.yaw = _ego.yaw + Math.IEEERemainder(SimFrame.Yaw(_egoGo.transform) - _ego.yaw, 2 * Math.PI); // giữ yaw liên tục
            _ego.v = Math.Max(0.0, _drv.ForwardSpeed);
            _ego.a = _drv.MeasuredAccel;
            _ego.steer = _rcc.FrontAxle != null ? -_rcc.FrontAxle.steerAngle * Mathf.Deg2Rad : 0.0;
        }

        void RccLogicStep()
        {
            ReadRccState();
            JObject cmd = QueryAv();
            _drv.manual = driver == DriverMode.Manual;
            if (_drv.manual)
            {
                _drv.manThrottle = _manual.throttle;
                _drv.manBrake = _manual.brake;
                _drv.manSteer = _manual.steer;
            }
            else if (cmd != null)
            {
                _drv.cmdSteer = (double)cmd["steer"];
                _drv.cmdAccel = (double)cmd["accel"];
            }
            else
            {
                // M1 với xe vật lý: không "dịch chuyển tức thời" được, nên bám log bằng pure pursuit + bám tốc độ
                var tg = _egoLog.At(Math.Min(_t + 1.0, _tEnd));
                double ang = Math.IEEERemainder(Math.Atan2(tg.y - _ego.y, tg.x - _ego.x) - _ego.yaw, 2 * Math.PI);
                double d = Math.Max(Math.Sqrt((tg.x - _ego.x) * (tg.x - _ego.x) + (tg.y - _ego.y) * (tg.y - _ego.y)), 1.0);
                _drv.cmdSteer = Math.Atan2(2 * 2.7 * Math.Sin(ang), d);
                var now = _egoLog.At(_t);
                var nx = _egoLog.At(_t + dt);
                _drv.cmdAccel = (nx.v - now.v) / dt + 1.0 * (now.v - _ego.v);
            }
            LogEgo(cmd);
        }

        /// <summary>
        /// Một lần hỏi AV: gửi trạng thái ở t, nhận lệnh + vị trí NPC ở t+dt. Khi lái tay AV vẫn chạy ngầm.
        /// Trả về null nếu không có lệnh AV dùng được (không có bridge, hoặc đang ở mode replay).
        /// </summary>
        JObject QueryAv()
        {
            var obs = BuildObservation();
            obs["dt"] = dt;
            JObject cmd = null;
            if (_bridge != null && _bridge.Connected)
            {
                try
                {
                    cmd = _bridge.Call(obs);
                    ApplyNpcs(cmd?["npcs"] as JArray);
                }
                catch (Exception e) { _status = "Bridge lỗi: " + e.Message; _bridge = null; }
            }
            if (driver == DriverMode.Manual && logDrive) LogDrive(obs, cmd);
            if (mode != Mode.M2_ClosedLoop) cmd = null;
            _lastCmd = cmd;
            return cmd;
        }

        void ApplyNpcs(JArray npcs)
        {
            if (npcs == null) return;
            foreach (var n in npcs)
                foreach (var ag in _agents)
                    if (ag.track.live && ag.id == n["id"].ToString())
                        ag.track.Set((double)n["x"], (double)n["y"], (double)n["yaw"], (double)n["v"]);
        }

        void LogDrive(JObject obs, JObject cmd)
        {
            if (_drive == null)
            {
                var logDir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Logs"));
                _drive = new DriveLogger(logDir, Path.GetFileNameWithoutExtension(scenarioFile), UseRcc ? "RCC" : "Kinematic", _lanes, dt);
            }
            _drive.Write(new JObject
            {
                ["t"] = SimTime, ["obs"] = obs,
                ["human"] = new JObject
                {
                    ["steer"] = _manual.steer, ["throttle"] = _manual.throttle, ["brake"] = _manual.brake,
                    ["applied_steer"] = _ego.steer, ["applied_accel"] = _ego.a,
                },
                ["av"] = cmd == null ? null : new JObject { ["steer"] = cmd["steer"], ["accel"] = cmd["accel"] },
            });
        }

        void ResendParams()
        {
            if (_bridge == null || !_bridge.Connected) return;
            if (_preset != null) _params = _bridge.Call(new JObject { ["type"] = "set_params", ["preset"] = _preset })?["params"] as JArray ?? _params;
            if (_paramOverrides.Count == 0) return;
            var vals = new JObject();
            foreach (var kv in _paramOverrides) vals[kv.Key] = kv.Value;
            _params = _bridge.Call(new JObject { ["type"] = "set_params", ["values"] = vals })?["params"] as JArray ?? _params;
        }

        void LogEgo(JObject cmd)
        {
            if (_egoCsv == null) return;
            double cs = cmd != null ? (double)cmd["steer"] : (_drv != null ? _drv.cmdSteer : 0);
            double ca = cmd != null ? (double)cmd["accel"] : (_drv != null ? _drv.cmdAccel : 0);
            var dbg = cmd?["debug"] as JObject;
            var lead = dbg?["lead"] as JObject;
            _egoCsv.WriteLine(string.Format(CultureInfo.InvariantCulture,
                "{0:F3},{1:F3},{2:F3},{3:F4},{4:F3},{5:F3},{6:F4},{7:F4},{8:F3},{9:F3},{10:F3},{11},{12},{13},{14},{15:F2},{16:F2}",
                SimTime, _ego.x, _ego.y, _ego.yaw, _ego.v, _ego.a, _ego.steer, cs, ca,
                _drv != null ? _drv.Throttle : 0f, _drv != null ? _drv.Brake : 0f,
                dbg?["mode"]?.ToString() ?? "", dbg?["lane"]?.ToString() ?? "", dbg?["target_lane"]?.ToString() ?? "",
                lead?["id"]?.ToString() ?? "", lead != null ? (double)lead["gap"] : double.NaN, lead != null ? (double)lead["v"] : double.NaN));
        }

        void Finish()
        {
            if (_done) return;
            _done = true;
            _egoCsv?.Flush();
            _csv?.Flush();
            Debug.Log(string.Format(CultureInfo.InvariantCulture, "[ADAS] Kết thúc {0} ({1}): x={2:F2} y={3:F2} v={4:F2}, va chạm={5}",
                                    scenarioFile, UseRcc ? "RCC" : "Kinematic", _ego.x, _ego.y, _ego.v, _events.Count));
#if UNITY_EDITOR
            if (autoExitWhenDone && Application.isBatchMode)
            {
                _egoCsv?.Dispose();
                _csv?.Dispose();
                UnityEditor.EditorApplication.Exit(0);
            }
#endif
        }

        void PlaceEgo()
        {
            _egoGo.transform.SetPositionAndRotation(SimFrame.Pos(_ego.x, _ego.y), SimFrame.Rot(_ego.yaw));
        }

        void PlaceAgent(AgentRt ag, double t, bool teleport = false)
        {
            if (ag.crashed) { CrashTick(ag, t); return; }
            bool on = ag.track.Active(t);
            if (ag.go.activeSelf != on)
            {
                ag.go.SetActive(on);
                teleport |= on; // vừa xuất hiện: đặt thẳng vào chỗ, không "quét" từ vị trí cũ (BUG_LOG B29)
            }
            if (!on) return;
            var s = ag.track.At(t);
            if (UseRcc && !teleport)
            {
                // Agent kinematic di chuyển trong vòng vật lý -> xe RCC va chạm thật (lực, phản lực)
                var rb = ag.go.GetComponent<Rigidbody>();
                rb.MovePosition(SimFrame.Pos(s.x, s.y));
                rb.MoveRotation(SimFrame.Rot(s.yaw));
            }
            else
            {
                // MovePosition chỉ có hiệu lực ở bước vật lý sau và QUÉT vật từ chỗ cũ tới chỗ mới. Agent mới tạo đang ở gốc
                // (0, 0), trùng chỗ ego, nên quét qua sẽ hất xe RCC văng ~2300 m/s (BUG_LOG B29). Lúc khởi tạo thì dịch chuyển tức thời.
                ag.go.transform.SetPositionAndRotation(SimFrame.Pos(s.x, s.y), SimFrame.Rot(s.yaw));
                var rb = ag.go.GetComponent<Rigidbody>();
                if (rb != null) { rb.position = ag.go.transform.position; rb.rotation = ag.go.transform.rotation; }
            }
        }

        /// <summary>Bị ego tông: bỏ quỹ đạo log, trượt dừng lại; xe hai bánh và người đổ xuống (BUG_LOG B32, B35).</summary>
        void StartCrash(AgentRt ag)
        {
            if (ag.crashed) return;
            ag.crashed = true;
            ag.crashV = (float)ag.track.At(_t).v;
            ag.crashDir = ag.go.transform.forward;
            ag.crashBase = ag.go.transform.rotation;
            ag.crashClock = 0f;
            ag.crashLast = _t;
            // Xe hơi vẫn là vật cản cứng; xe máy và người nhẹ nên không chặn xe ego lại
            if (ag.cls != "car" && ag.cls != "suv" && ag.cls != "truck" && ag.cls != "bus")
                foreach (var c in ag.go.GetComponentsInChildren<Collider>()) c.enabled = false;
        }

        void CrashTick(AgentRt ag, double t)
        {
            float step = Mathf.Max((float)(t - ag.crashLast), 0f);
            ag.crashLast = t;
            ag.crashClock += step;
            ag.crashV = Mathf.Max(0f, ag.crashV - 6f * step);
            var tr = ag.go.transform;
            var pos = tr.position + ag.crashDir * (ag.crashV * step);
            float tilt = Mathf.Min(ag.crashClock * 220f, 90f);
            var rot = ag.cls == "pedestrian" ? ag.crashBase * Quaternion.Euler(tilt, 0f, 0f)
                    : (ag.cls == "motorbike" || ag.cls == "bicycle") ? ag.crashBase * Quaternion.Euler(0f, 0f, tilt)
                    : tr.rotation;
            pos.y = (ag.cls == "pedestrian" || ag.cls == "motorbike" || ag.cls == "bicycle") ? 0.2f * tilt / 90f : 0f;
            tr.SetPositionAndRotation(pos, rot);
        }

        void CheckCollisions()
        {
            var tr = _egoGo.transform;
            var center = EgoCenterGround() + Vector3.up * (_egoH / 2f);
            var hits = Physics.OverlapBox(center, new Vector3(_egoW, _egoH, _egoL) / 2f, tr.rotation,
                                          ~EgoLayers, QueryTriggerInteraction.Ignore);
            foreach (var c in hits)
            {
                var tag = c.GetComponentInParent<AgentTag>();
                if (tag == null || !_hit.Add(tag.id)) continue; // mặt đường, nhà... không có AgentTag
                OnEgoCollision(tag, EgoCollision.Zone(center, tr.rotation, _egoL, c));
                // Agent theo log là kinematic (khối lượng vô hạn), nếu cứ đi tiếp sẽ kéo lê xe RCC (BUG_LOG B32)
                foreach (var ag in _agents)
                    if (ag.id == tag.id) StartCrash(ag);
            }
        }

        string LightState(JArray states, double t)
        {
            string st = "unknown";
            foreach (var s in states)
                if ((double)s[0] <= t + 1e-9) st = (string)s[1];
            return st;
        }

        void UpdateLights()
        {
            var on = new[] { new Color(3f, 0.1f, 0.1f), new Color(3f, 2.2f, 0.1f), new Color(0.1f, 3f, 0.4f) };
            foreach (var (states, lamps) in _lights)
            {
                var st = LightState(states, _t);
                int active = st == "red" ? 0 : st == "yellow" ? 1 : st == "green" ? 2 : -1;
                for (int i = 0; i < 3; i++)
                {
                    if (lamps[i] == null) continue;
                    var m = lamps[i].material; // instance riêng cho từng bóng
                    m.EnableKeyword("_EMISSION");
                    m.SetColor("_EmissionColor", i == active ? on[i] : Color.black);
                    m.SetColor("_BaseColor", i == active ? on[i] / 3f : new Color(0.1f, 0.1f, 0.1f));
                }
            }
        }

        void UpdatePlannedPath()
        {
            if (_plannedPath == null) return;
            if (_lastCmd?["debug"]?["path"] is not JArray path || path.Count < 2) { _plannedPath.positionCount = 0; return; }
            _plannedPath.positionCount = path.Count;
            for (int i = 0; i < path.Count; i++)
                _plannedPath.SetPosition(i, SimFrame.Pos((double)path[i][0], (double)path[i][1], 0.05f));
        }

        /// <summary>Observation đúng format của bridge/tcp_server.py (hệ tọa độ scenario, ground truth như AWSIM).</summary>
        JObject BuildObservation()
        {
            var objs = new JArray();
            foreach (var ag in _agents)
            {
                if (!ag.go.activeSelf || (!ag.crashed && !ag.track.Active(_t))) continue;
                if (ag.cls == "obstacle" && !ag.go.GetComponent<Collider>().enabled) continue;
                var s = ag.track.At(_t);
                if (ag.crashed)
                {
                    var p = ag.go.transform.position;
                    s = (p.x, p.z, s.yaw, ag.crashV);
                }
                if (Math.Sqrt((s.x - _ego.x) * (s.x - _ego.x) + (s.y - _ego.y) * (s.y - _ego.y)) > 80) continue;
                objs.Add(new JObject
                {
                    ["id"] = ag.id, ["class"] = ag.cls, ["x"] = s.x, ["y"] = s.y, ["yaw"] = s.yaw, ["v"] = s.v,
                    ["length"] = ag.L, ["width"] = ag.W,
                });
            }
            var lights = new JArray();
            if (_scn["traffic_lights"] is JArray tls)
                foreach (var tl in tls)
                    lights.Add(new JObject
                    {
                        ["id"] = tl["id"], ["x"] = tl["pos"][0], ["y"] = tl["pos"][1],
                        ["state"] = LightState((JArray)tl["states"], _t),
                    });
            return new JObject
            {
                ["type"] = "step", ["t"] = _t,
                ["ego"] = new JObject
                {
                    ["x"] = _ego.x, ["y"] = _ego.y, ["yaw"] = _ego.yaw, ["v"] = _ego.v,
                    ["length"] = _egoL, ["width"] = _egoW,
                },
                ["objects"] = objs, ["traffic_lights"] = lights, ["speed_limit"] = _speedLimit,
            };
        }

        public void OnEgoCollision(AgentTag tag, string zone)
        {
            var line = string.Format(CultureInfo.InvariantCulture, "{0:F2},{1},{2},{3},{4:F2},{5}",
                                     SimTime, tag.id, tag.cls, zone, _ego.v, mode);
            _csv?.WriteLine(line);
            _csv?.Flush();
            _events.Add(string.Format(CultureInfo.InvariantCulture, "t={0:F2}s  VA CHẠM {1} #{2}  vùng={3}  v_ego={4:F1} km/h",
                                      SimTime, tag.cls, tag.id, zone, _ego.v * 3.6));
            Debug.Log("[ADAS] " + _events[^1]);
        }

        // ================================================================ camera + video
        public void SetCameraMode(int m) { _camMode = m; UpdateCamera(1f, true); }
        /// <summary>Như SetCameraMode nhưng camera trượt mượt từ vị trí hiện tại (dùng khi quay video từng frame).</summary>
        public void SetCameraModeSmooth(int m, float frameDt) { _camMode = m; UpdateCamera(frameDt, false); }

        public void UpdateCamera(float frameDt, bool snap)
        {
            var cam = Camera.main;
            if (cam == null || _egoGo == null) return;
            var ep = _egoGo.transform.position;
            var fwd = _egoGo.transform.forward;
            Vector3 pos;
            Quaternion rot;
            switch (_camMode)
            {
                case 1: // dashcam: đúng chiều cao, pitch và FOV dọc của camera gốc, để so với video
                    cam.fieldOfView = _camVFov;
                    pos = _sensorCam.transform.position;
                    rot = _sensorCam.transform.rotation;
                    snap = true;
                    break;
                case 2: // trên cao
                    cam.fieldOfView = 55f;
                    pos = ep + Vector3.up * 60f - fwd * 25f;
                    rot = Quaternion.LookRotation(ep + fwd * 15f - pos);
                    break;
                default: // đuôi xe (giống camera theo xe của AWSIM)
                    cam.fieldOfView = 60f;
                    pos = ep - fwd * 11f + Vector3.up * 4.2f;
                    rot = Quaternion.LookRotation(ep + fwd * 8f + Vector3.up * 1f - pos);
                    break;
            }
            float k = snap ? 1f : 1f - Mathf.Exp(-frameDt * 6f);
            cam.transform.SetPositionAndRotation(Vector3.Lerp(cam.transform.position, pos, k),
                                                 Quaternion.Slerp(cam.transform.rotation, rot, k));
            cam.farClipPlane = 1000f;
        }

        void SyncVideo()
        {
            if (_video == null || !_video.isPrepared) return;
            double vt = SimTime; // t = 0 của video trùng t = 0 của scenario
            if (_paused || _t >= _tEnd - 1e-6) { if (_video.isPlaying) _video.Pause(); _video.time = vt; return; }
            if (!_video.isPlaying) _video.Play();
            _video.playbackSpeed = Mathf.Clamp(speed, 0.125f, 4f);
            if (Math.Abs(_video.time - vt) > 0.15) _video.time = vt;
        }

        // ================================================================ HUD kiểu AWSIM
        void Bar(Rect r, float v01, Color c)
        {
            var old = GUI.color;
            GUI.color = new Color(0.15f, 0.15f, 0.17f, 0.9f);
            GUI.DrawTexture(r, _white);
            GUI.color = c;
            GUI.DrawTexture(new Rect(r.x, r.y, r.width * Mathf.Clamp01(v01), r.height), _white);
            GUI.color = old;
        }

        void Panel(Rect r, string title)
        {
            var old = GUI.color;
            GUI.color = new Color(0.05f, 0.06f, 0.08f, 0.82f);
            GUI.DrawTexture(r, _white);
            GUI.color = old;
            GUI.Label(new Rect(r.x + 8, r.y + 4, r.width - 16, 20), $"<b>{title}</b>", _label);
        }

        GUIStyle _label, _big;

        void OnGUI()
        {
            if (_egoLog == null) return;
            if (_white == null) { _white = new Texture2D(1, 1); _white.SetPixel(0, 0, Color.white); _white.Apply(); }
            _label ??= new GUIStyle(GUI.skin.label) { richText = true, fontSize = 13, normal = { textColor = new Color(0.9f, 0.92f, 0.95f) } };
            _big ??= new GUIStyle(_label) { fontSize = 34, fontStyle = FontStyle.Bold };
            if (!_showHud) return;

            // Trái trên: trạng thái
            var info = new Rect(10, 10, 470, 146 + 18 * _events.Count);
            Panel(info, "ADAS Sim  ·  " + scenarioFile);
            string lon = _lastCmd?["debug"]?["mode"]?.ToString() ?? "-";
            string lane = _lastCmd?["debug"]?["lane"]?.ToString() ?? "-";
            GUI.Label(new Rect(18, 30, 460, 128),
                $"Mode: <b>{(_lastCmd != null ? "M2 closed-loop (AV Python)" : "M1 replay log")}</b>   t = {SimTime:F2} / {_tEnd - _egoLog.T0:F1} s   ×{speed}{(_paused ? "   <color=#ffb000>[DỪNG]</color>" : "")}\n" +
                $"{_status}\n" +
                $"Xe ego: {(UseRcc ? "<color=#7fd0ff>RCC Pro (vật lý thật)</color>" : "kinematic bicycle")}" +
                (UseRcc ? $"  ga {_drv.Throttle:F2} · phanh {_drv.Brake:F2}" : "") + "\n" +
                $"Planner: {lon}  ·  làn {lane}  ·  agent: {_agents.Count}  ·  LiDAR: {(_lidar != null ? _lidar.LastCount : 0)} điểm\n" +
                $"GNSS: {Gnss()}\n" +
                "<color=#8a93a3>Space dừng · R lại · C camera · +/- tốc độ · V video · L LiDAR · H ẩn · M lái tay · P thông số</color>", _label);
            if (driver == DriverMode.Manual)
                GUI.Label(new Rect(18, Screen.height - 62f, 700, 24), "<color=#ffb000><b>ĐANG LÁI TAY</b> · WASD/mũi tên hoặc tay cầm" +
                          (logDrive ? " · đang ghi log" : "") + "</color>", _label);
            if (_showParams) ParamPanel(info.yMax + 8f);
            for (int i = 0; i < _events.Count; i++)
                GUI.Label(new Rect(18, 142 + 18 * i, 460, 18), $"<color=#ff5050>{_events[i]}</color>", _label);

            // Cột phải: camera, video gốc, LiDAR + trạng thái xe
            float W = 400f, x = Screen.width - W - 10f, y = 10f;
            Panel(new Rect(x, y, W, 252), "Camera trước (sensor)");
            if (_sensorRt != null) GUI.DrawTexture(new Rect(x + 6, y + 24, W - 12, 222), _sensorRt, ScaleMode.ScaleToFit);
            y += 258;
            if (_showVideo && _videoRt != null)
            {
                Panel(new Rect(x, y, W, 252), "Video gốc (dashcam)");
                GUI.DrawTexture(new Rect(x + 6, y + 24, W - 12, 222), _videoRt, ScaleMode.ScaleToFit);
                y += 258;
            }
            Panel(new Rect(x, y, 200, 228), "LiDAR (BEV ±50 m)");
            if (_lidar?.Bev != null) GUI.DrawTexture(new Rect(x + 6, y + 24, 188, 198), _lidar.Bev, ScaleMode.ScaleToFit);
            var vr = new Rect(x + 206, y, W - 206, 228);
            Panel(vr, "Xe ego");
            GUI.Label(new Rect(vr.x + 10, vr.y + 26, 180, 40), $"{_ego.v * 3.6:F0}<size=14> km/h</size>", _big);
            GUI.Label(new Rect(vr.x + 10, vr.y + 70, 180, 18), $"log: {_egoLog.At(_t).v * 3.6:F0} km/h", _label);
            double steerDeg = _ego.steer * Mathf.Rad2Deg;
            GUI.Label(new Rect(vr.x + 10, vr.y + 94, 180, 18), $"Lái: {steerDeg:+0.0;-0.0;0.0}°", _label);
            Bar(new Rect(vr.x + 10, vr.y + 114, 170, 8), (float)(0.5 + steerDeg / 70.0), new Color(0.4f, 0.7f, 1f));
            double acc = _ego.a;
            GUI.Label(new Rect(vr.x + 10, vr.y + 128, 180, 18), $"Ga  {Math.Max(acc, 0):F2} m/s²", _label);
            Bar(new Rect(vr.x + 10, vr.y + 148, 170, 8), (float)(Math.Max(acc, 0) / 3.0), new Color(0.3f, 0.9f, 0.4f));
            GUI.Label(new Rect(vr.x + 10, vr.y + 160, 180, 18), $"Phanh {Math.Max(-acc, 0):F2} m/s²", _label);
            Bar(new Rect(vr.x + 10, vr.y + 180, 170, 8), (float)(Math.Max(-acc, 0) / 6.0), new Color(1f, 0.35f, 0.3f));
            GUI.Label(new Rect(vr.x + 10, vr.y + 196, 180, 18), $"Va chạm: {_events.Count}", _label);

            // Thanh thời gian dưới cùng
            var tl = new Rect(10, Screen.height - 26, Screen.width - W - 30, 10);
            Bar(tl, (float)(SimTime / Math.Max(_tEnd - _egoLog.T0, 1e-3)), new Color(0.4f, 0.75f, 1f));
        }

        /// <summary>Bảng thông số AV. Danh sách lấy từ Python (av_stack/stack.py, PARAM_SPEC), Unity không cần biết trước.</summary>
        void ParamPanel(float y)
        {
            float h = Mathf.Min(Screen.height - y - 40f, 440f);
            var r = new Rect(10, y, 470, h);
            Panel(r, "Thông số AV (đổi được khi đang chạy)");
            if (_params == null)
            {
                GUI.Label(new Rect(18, y + 28, 440, 40), "Chưa nối bridge Python nên chưa có thông số.", _label);
                return;
            }
            float bx = 18f;
            string pick = null;
            if (_presets != null)
                foreach (var pr in _presets)
                {
                    if (GUI.Button(new Rect(bx, y + 26, 110, 22), pr.ToString())) pick = pr.ToString();
                    bx += 116f;
                }
            string changed = null;
            double newVal = 0;
            float rowH = 34f;
            _paramScroll = GUI.BeginScrollView(new Rect(14, y + 54, 460, h - 60), _paramScroll, new Rect(0, 0, 436, rowH * _params.Count));
            for (int i = 0; i < _params.Count; i++)
            {
                var p = _params[i];
                float v = (float)p["value"], lo = (float)p["min"], hi = (float)p["max"];
                GUI.Label(new Rect(4, i * rowH, 330, 18), (string)p["label"], _label);
                GUI.Label(new Rect(340, i * rowH, 90, 18), v.ToString("0.00", CultureInfo.InvariantCulture), _label);
                float nv = GUI.HorizontalSlider(new Rect(4, i * rowH + 18, 426, 12), v, lo, hi);
                if (Mathf.Abs(nv - v) > (hi - lo) * 0.002f) { changed = (string)p["key"]; newVal = nv; p["value"] = nv; }
            }
            GUI.EndScrollView();
            if (_bridge == null || !_bridge.Connected) return;
            if (pick != null)
            {
                _preset = pick;
                _paramOverrides.Clear();
                ResendParams();
            }
            else if (changed != null)
            {
                _paramOverrides[changed] = newVal;
                _bridge.Call(new JObject { ["type"] = "set_params", ["values"] = new JObject { [changed] = newVal } });
            }
        }

        string Gnss()
        {
            if (_originGps == null) return $"x {_ego.x:F1} m, y {_ego.y:F1} m (không có GPS, hệ ego_t0)";
            const double R = 6378137.0;
            double lat = _originGps[0] + _ego.y / R * Mathf.Rad2Deg;
            double lon = _originGps[1] + _ego.x / (R * Math.Cos(_originGps[0] * Mathf.Deg2Rad)) * Mathf.Rad2Deg;
            return $"{lat:F6}, {lon:F6}";
        }

        // ================================================================ cho editor (dựng preview, chụp ảnh)
        public Camera SensorCamera => _sensorCam;
        public LidarSensor Lidar => _lidar;
        public Transform Actors => _actors;
    }
}
