using System;
using System.IO;
using System.Net.Sockets;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Adas
{
    /// <summary>
    /// Client TCP nối tới AV stack Python (bridge/tcp_server.py). Mỗi message là một dòng JSON.
    /// Gọi đồng bộ (lockstep): gửi observation rồi ĐỨNG CHỜ lệnh, nên cùng input luôn ra cùng kết quả.
    ///   python -m bridge.tcp_server --port 5555
    /// </summary>
    public sealed class BridgeClient : IDisposable
    {
        TcpClient _client;
        StreamReader _reader;
        StreamWriter _writer;

        public bool Connected => _client != null && _client.Connected;

        public bool TryConnect(string host, int port, int timeoutMs = 500)
        {
            try
            {
                _client = new TcpClient();
                var ar = _client.BeginConnect(host, port, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(timeoutMs))
                {
                    _client.Close();
                    _client = null;
                    return false;
                }
                _client.EndConnect(ar);
                _client.NoDelay = true;
                var stream = _client.GetStream();
                var utf8 = new UTF8Encoding(false);
                _reader = new StreamReader(stream, utf8);
                _writer = new StreamWriter(stream, utf8) { AutoFlush = true, NewLine = "\n" };
                return true;
            }
            catch (Exception)
            {
                _client = null;
                return false;
            }
        }

        /// <summary>Gửi một message và chờ đúng một dòng trả lời.</summary>
        public JObject Call(JObject msg)
        {
            _writer.WriteLine(msg.ToString(Formatting.None));
            var line = _reader.ReadLine();
            return line == null ? null : JObject.Parse(line);
        }

        public void Dispose()
        {
            try
            {
                if (Connected) _writer.WriteLine("{\"type\":\"bye\"}");
            }
            catch (Exception) { }
            _client?.Close();
            _client = null;
        }
    }
}
