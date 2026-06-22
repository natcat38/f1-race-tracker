#!/usr/bin/env python3
"""Sweep WebSocket load levels against the gateway, sample docker stats for the
gateway container, write bench/results.csv, and render bench/results.png.

Usage:
    python bench/run.py --levels 100,500,1000,2000 --duration 30s
Assumes `docker compose up -d` is already running (redis + replay + gateway).
"""
import argparse
import csv
import json
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent

_MEM_FACTORS = {
    "B": 1 / 1024 / 1024, "KiB": 1 / 1024, "MiB": 1.0, "GiB": 1024.0,
    "KB": 1 / 1024, "MB": 1.0, "GB": 1024.0,
}


def parse_cpu_perc(s: str):
    """'35.20%' -> 35.2; returns None if no percentage is present."""
    m = re.search(r"([\d.]+)\s*%", s)
    return float(m.group(1)) if m else None


def parse_mem_mb(s: str):
    """'180MiB / 7.6GiB' -> 180.0 (used side, in MiB). None if unparseable."""
    used = s.split("/")[0].strip()
    m = re.match(r"([\d.]+)\s*([KMG]?i?B)", used)
    if not m:
        return None
    val, unit = float(m.group(1)), m.group(2)
    factor = _MEM_FACTORS.get(unit)
    return val * factor if factor is not None else None


def discover_container(service: str) -> str:
    out = subprocess.run(
        ["docker", "compose", "ps", "-q", service],
        cwd=REPO, capture_output=True, text=True,
    ).stdout.strip()
    if not out:
        sys.exit(f"could not find a running container for compose service '{service}'. "
                 f"Run `docker compose up -d` first.")
    return out.splitlines()[0]


class StatsSampler(threading.Thread):
    """Polls `docker stats --no-stream` for one container until stopped."""

    def __init__(self, container: str):
        super().__init__(daemon=True)
        self.container = container
        self._stop = threading.Event()
        self.cpu = []
        self.mem = []

    def run(self):
        while not self._stop.is_set():
            out = subprocess.run(
                ["docker", "stats", "--no-stream", "--format",
                 "{{.CPUPerc}};{{.MemUsage}}", self.container],
                capture_output=True, text=True,
            ).stdout.strip()
            if ";" in out:
                cpu_s, mem_s = out.split(";", 1)
                c, m = parse_cpu_perc(cpu_s), parse_mem_mb(mem_s)
                if c is not None:
                    self.cpu.append(c)
                if m is not None:
                    self.mem.append(m)
            self._stop.wait(2.0)

    def stop(self):
        self._stop.set()
        self.join(timeout=5)

    def avg(self):
        cpu = round(sum(self.cpu) / len(self.cpu), 1) if self.cpu else None
        mem = round(sum(self.mem) / len(self.mem), 1) if self.mem else None
        return cpu, mem


def build_loadtest() -> Path:
    exe = HERE / ("loadtest.exe" if sys.platform == "win32" else "loadtest")
    print(f"building {exe.name} ...")
    subprocess.run(["go", "build", "-o", str(exe), "./cmd/loadtest"],
                   cwd=REPO, check=True)
    return exe


def run_level(exe: Path, url: str, clients: int, duration: str,
              ramp: str, warmup: str, container: str) -> dict:
    sampler = StatsSampler(container)
    sampler.start()
    proc = subprocess.run(
        [str(exe), "-url", url, "-clients", str(clients),
         "-duration", duration, "-ramp", ramp, "-warmup", warmup],
        cwd=REPO, capture_output=True, text=True,
    )
    sampler.stop()
    if proc.stderr:
        print(proc.stderr.strip(), file=sys.stderr)
    lines = proc.stdout.strip().splitlines()
    if proc.returncode != 0 or not lines:
        raise RuntimeError(
            f"loadtest exited {proc.returncode} with no JSON output.\nstderr: {proc.stderr.strip()}"
        )
    row = json.loads(lines[-1])
    cpu, mem = sampler.avg()
    row["cpuPerc"] = cpu
    row["memMB"] = mem
    return row


FIELDS = ["clients", "connected", "framesPerSec", "p50", "p95", "p99", "max",
          "drops", "connectErrors", "cpuPerc", "memMB"]


def write_csv(rows, path: Path):
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k) for k in FIELDS})
    print(f"wrote {path}")


def render_chart(rows, path: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    xs = [r["clients"] for r in rows]
    fig, ax1 = plt.subplots(figsize=(8, 5))
    ax1.set_xlabel("concurrent WebSocket clients")
    ax1.set_ylabel("fan-out latency (ms)")
    ax1.plot(xs, [r["p50"] for r in rows], "-o", label="p50")
    ax1.plot(xs, [r["p95"] for r in rows], "-o", label="p95")
    ax1.plot(xs, [r["p99"] for r in rows], "-o", label="p99")
    ax1.legend(loc="upper left")
    ax1.grid(True, alpha=0.3)

    ax2 = ax1.twinx()
    ax2.set_ylabel("dropped connections")
    ax2.bar(xs, [r["drops"] for r in rows], width=max(xs) * 0.03,
            alpha=0.25, color="red", label="drops")

    plt.title("F1 Race Tracker — gateway fan-out latency vs concurrent clients")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    print(f"wrote {path}")


def print_markdown_table(rows):
    print("\n| clients | connected | frames/s | p50 | p95 | p99 | max | drops | CPU% | mem MB |")
    print("|--------:|----------:|---------:|----:|----:|----:|----:|------:|-----:|-------:|")
    for r in rows:
        print(f"| {r['clients']} | {r['connected']} | {r['framesPerSec']} | "
              f"{r['p50']} | {r['p95']} | {r['p99']} | {r['max']} | {r['drops']} | "
              f"{r.get('cpuPerc')} | {r.get('memMB')} |")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--levels", default="100,500,1000,2000,4000")
    ap.add_argument("--url", default="ws://localhost:8080/ws?session=replay")
    ap.add_argument("--duration", default="30s")
    ap.add_argument("--ramp", default="5s")
    ap.add_argument("--warmup", default="3s")
    ap.add_argument("--service", default="gateway", help="compose service name of the gateway")
    args = ap.parse_args()

    levels = [int(x) for x in args.levels.split(",") if x.strip()]
    container = discover_container(args.service)
    exe = build_loadtest()

    rows = []
    for n in levels:
        print(f"\n=== load level: {n} clients ===")
        row = run_level(exe, args.url, n, args.duration, args.ramp, args.warmup, container)
        print(f"  -> p50={row['p50']} p99={row['p99']} max={row['max']} "
              f"drops={row['drops']} cpu={row.get('cpuPerc')}% mem={row.get('memMB')}MB")
        rows.append(row)

    write_csv(rows, HERE / "results.csv")
    render_chart(rows, HERE / "results.png")
    print_markdown_table(rows)


if __name__ == "__main__":
    main()
