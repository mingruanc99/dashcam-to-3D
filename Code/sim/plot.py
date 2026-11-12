"""Vẽ kết quả một lần chạy: bản đồ nhìn từ trên xuống và đồ thị theo thời gian."""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402


def plot_run(scn: dict, sim, report: dict, path: str):
    df = pd.DataFrame(sim.log)
    fig = plt.figure(figsize=(14, 9))
    ax = fig.add_subplot(2, 1, 1)
    for lane in scn["map"]["lanes"]:
        c = np.asarray(lane["centerline"])
        ax.plot(c[:, 0], c[:, 1], color="0.8", lw=0.8, zorder=0)
    for a in scn["agents"]:
        tr = np.asarray([[p["x"], p["y"]] for p in a["trajectory"]])
        ax.plot(tr[:, 0], tr[:, 1], lw=0.7, alpha=0.6)
    ax.plot(df.log_x, df.log_y, "k--", lw=1.2, label="ego log (người lái)")
    ax.plot(df.x, df.y, "r", lw=1.8, label=f"ego AV ({report['mode']})")
    for inc in sim.incidents:
        if inc["type"] in ("collision", "red_light"):
            r = df.iloc[(df.t - inc["t"]).abs().argmin()]
            ax.plot(r.x, r.y, "kx" if inc["type"] == "collision" else "m^", ms=12, mew=3)
    for tl in scn.get("traffic_lights", []):
        ax.plot(tl["pos"][0], tl["pos"][1], "o", color="orange")
    ax.set_aspect("equal", adjustable="datalim")
    ax.legend(loc="upper left")
    ax.set_title(f"score={report['score']:.3f}  collisions={report['safety']['collisions']}  "
                 f"progress={report['progress']['ratio']:.2f}")
    ax2 = fig.add_subplot(2, 2, 3)
    ax2.plot(df.t, df.v * 3.6, "r", label="v AV")
    ax2.plot(df.t, df.log_v * 3.6, "k--", label="v log")
    ax2.set_ylabel("km/h"); ax2.legend(); ax2.grid(alpha=0.3)
    ax3 = fig.add_subplot(2, 2, 4)
    ax3.plot(df.t, df.a, label="a (m/s²)")
    ax3.plot(df.t, np.degrees(df.steer) / 10, label="steer (°/10)")
    ax3.plot(df.t, df.ttc.clip(upper=10), label="TTC (s, cắt ở 10)")
    ax3.legend(); ax3.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)
