#!/usr/bin/env python3
"""Device QA: Targeting segments/filters/placement via AsyncStorage QA + syslog.

Requires a build that includes Nest-first placement + Select bulk bar.
iPhone 14 Pro default UDID.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from datetime import datetime
from pathlib import Path

BUNDLE = "io.inteliads.app"
UDID = os.environ.get("INTELIADS_UDID", "00008120-001210563E6BC01E")
AS_REMOTE = "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1"
QA_KEY = "inteliads.qa.command"
VENV = Path(__file__).resolve().parents[1] / ".venv-device" / "bin"
OUT = Path(f"/tmp/inteliads-targeting-device-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
(OUT / "logs").mkdir(parents=True)
(OUT / "as").mkdir(parents=True)
Path("/tmp/inteliads-targeting-device-latest.path").write_text(str(OUT))


def env() -> dict[str, str]:
    e = {k: v for k, v in os.environ.items() if k != "PYMOBILEDEVICE3_UDID"}
    e["PATH"] = f"{VENV}:{e.get('PATH', '')}"
    return e


def pmd(args: list[str], timeout: int = 90) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["pymobiledevice3", *args],
        capture_output=True,
        text=True,
        env=env(),
        timeout=timeout,
    )


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    (OUT / "logs" / "steps.txt").open("a").write(line + "\n")


def kill() -> None:
    pmd(["developer", "dvt", "pkill", "InteliAds"])
    time.sleep(0.8)


def launch() -> None:
    r = pmd(["developer", "dvt", "launch", BUNDLE, "--kill-existing"], timeout=60)
    log(f"LAUNCH rc={r.returncode}")
    time.sleep(8)


def pull(tag: str) -> Path:
    dest = OUT / "as" / tag
    dest.mkdir(parents=True, exist_ok=True)
    pmd(["apps", "pull", BUNDLE, AS_REMOTE, str(dest)], timeout=120)
    nested = dest / "RCTAsyncLocalStorage_V1"
    return nested if nested.exists() else dest


def push(local: Path) -> None:
    for f in local.iterdir():
        if f.is_file():
            pmd(["apps", "push", BUNDLE, str(f), f"{AS_REMOTE}/{f.name}"], timeout=60)


def write_qa(cmd: dict) -> None:
    kill()
    local = pull("pre")
    man_path = local / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    man[QA_KEY] = json.dumps(json.dumps(cmd))
    man_path.write_text(json.dumps(man, separators=(",", ":")))
    push(local)
    log(f"QA {cmd.get('id')} {cmd}")


CASES = [
    {"id": "kw-default", "route": "/(tabs)/targeting", "targetsSegment": "keywords", "targetsPerf": "all", "targetsSort": "acos"},
    {"id": "asins", "route": "/(tabs)/targeting", "targetsSegment": "asins"},
    {"id": "auto", "route": "/(tabs)/targeting", "targetsSegment": "auto"},
    {"id": "category", "route": "/(tabs)/targeting", "targetsSegment": "category"},
    {"id": "placement", "route": "/(tabs)/targeting", "targetsSegment": "placement"},
    {
        "id": "bid-max-sort",
        "route": "/(tabs)/targeting",
        "targetsSegment": "keywords",
        "targetsAdvanced": {"bidMax": 0.75},
    },
    {
        "id": "acos-range-sort",
        "route": "/(tabs)/targeting",
        "targetsSegment": "keywords",
        "targetsAdvanced": {"acosMin": 10, "acosMax": 20},
    },
    {
        "id": "impr-min-sort",
        "route": "/(tabs)/targeting",
        "targetsSegment": "keywords",
        "targetsAdvanced": {"impressionsMin": 50},
    },
]


def main() -> int:
    log(f"START {OUT} udid={UDID}")
    proc = subprocess.Popen(
        [
            "pymobiledevice3",
            "syslog",
            "live",
            "--insensitive-regex",
            r"inteliads:targeting|inteliads:qa|Nest campaign|targets\.(keywords|products|placements)|TypeError|RedBox",
            "--out",
            str(OUT / "logs" / "signals.log"),
        ],
        stdout=subprocess.DEVNULL,
        stderr=(OUT / "logs" / "syslog.err").open("w"),
        env=env(),
    )
    try:
        for cmd in CASES:
            write_qa(cmd)
            launch()
            time.sleep(4)
            # scrape recent targeting logs
            text = (OUT / "logs" / "signals.log").read_text(errors="replace") if (OUT / "logs" / "signals.log").exists() else ""
            hits = [ln for ln in text.splitlines() if cmd["id"] in ln or "inteliads:targeting" in ln or "inteliads:qa" in ln]
            log(f"CASE {cmd['id']} log_hits={len(hits)} last={hits[-1][:160] if hits else '-'}")
        summary = (OUT / "logs" / "signals.log").read_text(errors="replace") if (OUT / "logs" / "signals.log").exists() else ""
        qa = re.findall(r"\[inteliads:qa\][^\n]+", summary)
        tgt = re.findall(r"\[inteliads:targeting\][^\n]+", summary)
        errs = [ln for ln in summary.splitlines() if re.search(r"TypeError|RedBox|Unhandled|INCOMPLETE", ln, re.I)]
        (OUT / "result.json").write_text(
            json.dumps({"qa": qa[-20:], "targeting": tgt[-40:], "errors": errs[-20:], "out": str(OUT)}, indent=2)
        )
        log(f"DONE qa={len(qa)} targeting={len(tgt)} errors={len(errs)}")
        return 1 if errs else 0
    finally:
        try:
            proc.terminate()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
