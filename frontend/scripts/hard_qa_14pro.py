#!/usr/bin/env python3
"""Hard QA driver: syslog capture + deep-link launches + screenshots on physical iPhone."""
from __future__ import annotations

import asyncio
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

UDID = os.environ.get("PYMOBILEDEVICE3_UDID", "00008120-001210563E6BC01E")
BUNDLE = "io.inteliads.app"
OUT = Path(f"/tmp/inteliads-hard-qa-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
(OUT / "screens").mkdir(parents=True, exist_ok=True)
(OUT / "logs").mkdir(parents=True, exist_ok=True)
Path("/tmp/inteliads-hard-qa-latest.path").write_text(str(OUT))

ROUTES = [
    ("/", "01-overview"),
    ("/(tabs)/campaigns", "02-campaigns"),
    ("/(tabs)/targeting", "03-targets"),
    ("/(tabs)/products", "04-books"),
    ("/(tabs)/more", "05-more"),
    ("/more/settings", "06-settings"),
    ("/more/accounts", "07-accounts"),
    ("/more/bid-bot", "08-bidbot"),
    ("/more/rule-history", "09-rule-history"),
    ("/more/negative-targeting", "10-negatives"),
    ("/more/sync", "11-sync"),
    ("/more/automation", "12-automation"),
    ("/(tabs)", "13-overview-return"),
    ("/(tabs)/targeting", "14-targets-stress"),
    ("/(tabs)/campaigns", "15-campaigns-return"),
    ("/(tabs)/products", "16-books-return"),
    ("/(tabs)/targeting", "17-targets-again"),
    ("/(tabs)", "18-overview-final"),
]

SKIP_SHOTS = os.environ.get("SKIP_SHOTS", "1") == "1"

HIT_RE = re.compile(
    r"HOME_QUERY_TIMEOUT|BooksReadError|\[inteliads:perf\]|\[inteliads:data\]|\[inteliads:kdp-trace\]|"
    r"Unhandled|TypeError|RedBox|Couldn.?t load|INCOMPLETE_READ|AbortError|"
    r"NSException|ReactNativeJS|console\.error|\bERROR\b|\bWARN\b",
    re.I,
)


def log_step(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with (OUT / "logs" / "steps.txt").open("a") as f:
        f.write(line + "\n")


def start_syslog() -> list[subprocess.Popen]:
    # Do NOT set PYMOBILEDEVICE3_UDID for developer tunnel cmds — it breaks native fallback.
    env = {k: v for k, v in os.environ.items() if k != "PYMOBILEDEVICE3_UDID"}
    procs = []
    procs.append(
        subprocess.Popen(
            [
                "pymobiledevice3",
                "syslog",
                "live",
                "-pn",
                "InteliAds",
                "--out",
                str(OUT / "logs" / "process-InteliAds.log"),
            ],
            stdout=subprocess.DEVNULL,
            stderr=(OUT / "logs" / "syslog-pn.err").open("w"),
            env=env,
        )
    )
    procs.append(
        subprocess.Popen(
            [
                "pymobiledevice3",
                "syslog",
                "live",
                "--insensitive-regex",
                r"inteliads|InteliAds|ReactNativeJS|Expo|HOME_QUERY_TIMEOUT|BooksReadError|Unhandled|TypeError|RedBox|INCOMPLETE_READ|AbortError|NSException",
                "--out",
                str(OUT / "logs" / "app-filtered.log"),
            ],
            stdout=subprocess.DEVNULL,
            stderr=(OUT / "logs" / "syslog-filtered.err").open("w"),
            env=env,
        )
    )
    return procs


def launch_route(path: str) -> None:
    env = {k: v for k, v in os.environ.items() if k != "PYMOBILEDEVICE3_UDID"}
    # Prefer Expo initial URL env — positional URL args break on empty paths.
    cmd = [
        "pymobiledevice3",
        "developer",
        "dvt",
        "launch",
        BUNDLE,
        "--kill-existing",
        "--env",
        f"EXPO_ROUTER_INITIAL_URL={path}",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    (OUT / "logs" / "launch.err").open("a").write(
        f"\n--- {path} rc={r.returncode}\n{r.stdout}\n{r.stderr}\n"
    )
    if r.returncode != 0:
        log_step(f"LAUNCH_WARN {path} rc={r.returncode}")
    else:
        log_step(f"LAUNCH_OK {path} {r.stdout.strip()}")


async def take_shot(name: str) -> None:
    from pymobiledevice3.lockdown import create_using_usbmux

    dest = OUT / "screens" / f"{name}.png"
    env = {k: v for k, v in os.environ.items() if k != "PYMOBILEDEVICE3_UDID"}
    try:
        r = subprocess.run(
            [
                "pymobiledevice3",
                "developer",
                "dvt",
                "screenshot",
                str(dest),
            ],
            capture_output=True,
            text=True,
            env=env,
            timeout=20,
        )
    except subprocess.TimeoutExpired:
        log_step(f"SHOT_TIMEOUT {name}")
        return
    if r.returncode == 0 and dest.exists() and dest.stat().st_size > 1000:
        log_step(f"SHOT_OK {name} bytes={dest.stat().st_size}")
        return

    # Fallback: ScreenshotService
    try:
        from pymobiledevice3.services.screenshot import ScreenshotService

        ld = await create_using_usbmux(serial=UDID)
        async with ScreenshotService(lockdown=ld) as sc:
            data = await sc.take_screenshot()
            dest.write_bytes(data)
            log_step(f"SHOT_OK_FALLBACK {name} bytes={len(data)}")
    except Exception as e:
        log_step(f"SHOT_FAIL {name} {type(e).__name__}: {e}")


def summarize_logs() -> None:
    hits_path = OUT / "logs" / "hits.txt"
    lines = []
    for p in [OUT / "logs" / "process-InteliAds.log", OUT / "logs" / "app-filtered.log"]:
        if not p.exists():
            continue
        try:
            text = p.read_text(errors="replace")
        except Exception:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if HIT_RE.search(line):
                lines.append(f"{p.name}:{i}:{line}")
    hits_path.write_text("\n".join(lines[-500:]))
    perf = [l for l in lines if "[inteliads:perf]" in l]
    errors = [l for l in lines if re.search(r"HOME_QUERY_TIMEOUT|BooksReadError|TypeError|Unhandled|INCOMPLETE_READ|AbortError|RedBox", l, re.I)]
    (OUT / "logs" / "summary.txt").write_text(
        "\n".join(
            [
                f"OUT={OUT}",
                f"hit_lines={len(lines)}",
                f"perf_lines={len(perf)}",
                f"error_like={len(errors)}",
                "--- errors ---",
                *errors[-80:],
                "--- perf tail ---",
                *perf[-40:],
            ]
        )
    )
    log_step(f"SUMMARY hits={len(lines)} perf={len(perf)} errors={len(errors)}")


async def main() -> int:
    log_step(f"START OUT={OUT}")
    procs = start_syslog()
    log_step(f"syslog_pids={[p.pid for p in procs]}")
    time.sleep(1.5)

    try:
        for path, label in ROUTES:
            log_step(f"ROUTE {label} {path}")
            launch_route(path)
            # Targets / books need longer settle for network reads
            settle = 8 if "targeting" in path or "products" in path else 3.5
            if path.startswith("/more/"):
                settle = 4.0
            time.sleep(settle)
            if not SKIP_SHOTS:
                await take_shot(label)
        log_step("DWELL targets 20s")
        launch_route("/(tabs)/targeting")
        time.sleep(20)
        if not SKIP_SHOTS:
            await take_shot("19-targets-dwell")
        log_step("DWELL books 12s")
        launch_route("/(tabs)/products")
        time.sleep(12)
        log_step("DWELL overview 10s")
        launch_route("/(tabs)")
        time.sleep(10)
    finally:
        time.sleep(2)
        summarize_logs()
        for p in procs:
            p.send_signal(signal.SIGINT)
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
        log_step(f"DONE {OUT}")
        print(OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
