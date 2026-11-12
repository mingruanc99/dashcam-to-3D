"""Bridge Unity <-> AV stack qua TCP, mỗi message là một dòng JSON, chạy lockstep.

Đây là bước trung gian trước khi dùng ROS2 (PLAN.md mục 7). Trên Windows, chạy
ROS2 cùng Unity khá vất vả, còn TCP thì C# chỉ cần TcpClient là xong.

Giao thức (mỗi message kết thúc bằng '\n'):
  Unity -> Python  {"type":"reset","lanes":[...]}                    -> {"ok":true}
  Unity -> Python  {"type":"step","t":..,"ego":{..},"objects":[..],
                    "traffic_lights":[..],"speed_limit":..}          -> {"steer":..,"accel":..,"debug":{..}}
  Unity -> Python  {"type":"set_params","values":{...}} hoặc {"preset":"than_trong"}  -> {"ok":true,"params":[...]}
  Unity -> Python  {"type":"bye"}
  reset có thể kèm "npcs" (xem sim/director.py); reply của reset và step trả về vị trí NPC.
Toàn bộ tọa độ dùng hệ của scenario (x tiến, y trái, mét, radian). Unity tự đổi
sang hệ của nó (xem docs/HUONG_DAN.md, mục Unity).

Lockstep: Unity gửi step rồi đứng chờ reply, sau đó mới chạy tiếp vật lý. Nhờ vậy
cùng một input luôn cho cùng một kết quả.

    python -m bridge.tcp_server --port 5555
"""

from __future__ import annotations

import argparse
import json
import socketserver

from av_stack import AVStack
from av_stack.stack import PRESETS
from sim.director import Director


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        av = AVStack()
        director = Director([], [])
        print(f"[bridge] client {self.client_address} connected")
        for raw in self.rfile:
            msg = json.loads(raw)
            kind = msg.get("type")
            if kind == "reset":
                av.reset(msg["lanes"])
                director = Director(msg.get("npcs", []), msg["lanes"])
                reply = {"ok": True, "npcs": director.states(), "params": av.describe_params(), "presets": list(PRESETS)}
            elif kind == "set_params":
                av.set_params(msg.get("values"), msg.get("preset"))
                reply = {"ok": True, "params": av.describe_params()}
            elif kind == "step":
                cmd = av.step(msg)
                if not self.server.send_debug:
                    cmd.pop("debug", None)
                director.step(msg["t"], msg.get("dt", 0.05), msg["ego"])
                cmd["npcs"] = director.states()
                reply = cmd
            elif kind == "bye":
                break
            else:
                reply = {"error": f"unknown type {kind}"}
            self.wfile.write((json.dumps(reply, default=float) + "\n").encode())
        print("[bridge] client disconnected")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    send_debug = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=5555)
    ap.add_argument("--no-debug", action="store_true")
    a = ap.parse_args()
    with Server((a.host, a.port), Handler) as srv:
        srv.send_debug = not a.no_debug
        print(f"[bridge] listening on {a.host}:{a.port}")
        srv.serve_forever()


if __name__ == "__main__":
    main()
