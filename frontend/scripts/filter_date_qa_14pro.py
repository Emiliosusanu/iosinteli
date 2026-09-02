#!/usr/bin/env python3
"""Filter + date-range hard QA via AsyncStorage QA commands + syslog intercept.

AX Activate is a no-op on this device/host; CoreDevice tunnel is unavailable for
XCUITest. Commands are pushed into RCTAsyncLocalStorage_V1 then the app is
relaunching so QaBootstrap applies route/date/filters.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import time
from datetime import datetime
from pathlib import Path

BUNDLE = "io.inteliads.app"
UDID = "00008120-001210563E6BC01E"
AS_REMOTE = "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1"
OUT = Path(f"/tmp/inteliads-filter-qa-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
(OUT / "logs").mkdir(parents=True)
(OUT / "ax").mkdir(parents=True)
(OUT / "as").mkdir(parents=True)
Path("/tmp/inteliads-filter-qa-latest.path").write_text(str(OUT))

DATE_PRESETS = [
    "Today",
    "Yesterday",
    "This month",
    "Last 7 days",
    "Last 30 days",
    "Last 60 days",
    "Last 90 days",
    "All time",
]


def env_dev() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k != "PYMOBILEDEVICE3_UDID"}


def env_ax() -> dict[str, str]:
    e = env_dev()
    e["PYMOBILEDEVICE3_UDID"] = UDID
    return e


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    (OUT / "logs" / "steps.txt").open("a").write(line + "\n")


def start_syslog() -> list[subprocess.Popen]:
    e = env_dev()
    return [
        subprocess.Popen(
            ["pymobiledevice3", "syslog", "live", "-pn", "InteliAds", "--out", str(OUT / "logs" / "process.log")],
            stdout=subprocess.DEVNULL,
            stderr=(OUT / "logs" / "s1.err").open("w"),
            env=e,
        ),
        subprocess.Popen(
            [
                "pymobiledevice3",
                "syslog",
                "live",
                "--insensitive-regex",
                r"inteliads|ReactNativeJS|HOME_QUERY|BooksReadError|TypeError|Unhandled|INCOMPLETE|AbortError|RedBox|\[inteliads",
                "--out",
                str(OUT / "logs" / "signals.log"),
            ],
            stdout=subprocess.DEVNULL,
            stderr=(OUT / "logs" / "s2.err").open("w"),
            env=e,
        ),
    ]


def kill_app() -> None:
    subprocess.run(
        ["pymobiledevice3", "developer", "dvt", "pkill", "InteliAds"],
        capture_output=True,
        env=env_dev(),
    )


def launch() -> None:
    r = subprocess.run(
        ["pymobiledevice3", "developer", "dvt", "launch", BUNDLE, "--kill-existing"],
        capture_output=True,
        text=True,
        env=env_dev(),
    )
    log(f"LAUNCH rc={r.returncode}")
    time.sleep(6.5)


def ax_list(tag: str) -> list[dict]:
    out = OUT / "ax" / f"{tag}.json"
    err = OUT / "ax" / f"{tag}.err"
    with out.open("w") as fo, err.open("w") as fe:
        r = subprocess.run(
            ["pymobiledevice3", "developer", "accessibility", "list-items"],
            stdout=fo,
            stderr=fe,
            env=env_ax(),
            timeout=90,
        )
    if r.returncode != 0 or out.stat().st_size < 2:
        log(f"AX_LIST_FAIL {tag} rc={r.returncode}")
        return []
    try:
        items = json.loads(out.read_text())
    except Exception as e:
        log(f"AX_PARSE_FAIL {tag} {e}")
        return []
    log(f"AX_LIST {tag} n={len(items)}")
    return items


def snapshot(items: list[dict], tag: str) -> None:
    interesting = []
    for it in items[:40]:
        c = it.get("caption") or ""
        if any(
            k in c
            for k in (
                "Date range",
                "Period,",
                "Net",
                "Selected",
                "ACoS",
                "Spend",
                "Loading",
                "No ",
                "Search",
                "Sort",
                "Active",
                "Paused",
                "Keywords",
                "Waste",
                "Profit",
            )
        ):
            interesting.append(c[:140])
    log(f"SNAP {tag} :: {' | '.join(interesting[:14])}")


def pull_as() -> Path:
    dest = OUT / "as" / "pull"
    if dest.exists():
        for p in dest.rglob("*"):
            if p.is_file():
                p.unlink()
    dest.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["pymobiledevice3", "apps", "pull", BUNDLE, AS_REMOTE, str(dest)],
        capture_output=True,
        text=True,
        env=env_dev(),
    )
    if r.returncode != 0:
        log(f"AS_PULL_FAIL {r.stderr[-200:]}")
    # apps pull may nest
    nested = dest / "RCTAsyncLocalStorage_V1"
    return nested if nested.exists() else dest


def push_as(local: Path) -> None:
    # Push each file into the remote folder
    for f in local.iterdir():
        if not f.is_file():
            continue
        r = subprocess.run(
            [
                "pymobiledevice3",
                "apps",
                "push",
                BUNDLE,
                str(f),
                f"{AS_REMOTE}/{f.name}",
            ],
            capture_output=True,
            text=True,
            env=env_dev(),
        )
        if r.returncode != 0:
            log(f"AS_PUSH_FAIL {f.name} {r.stderr[-160:]}")


def encode_storage_value(value: object) -> str:
    # storage.setItem JSON.stringifies the value once.
    return json.dumps(value)


def write_qa_command(cmd: dict) -> None:
    kill_app()
    time.sleep(0.8)
    local = pull_as()
    man_path = local / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    # dateRange also set for screens that read it before QaBootstrap runs
    if cmd.get("dateLabel") or cmd.get("periodMode") or cmd.get("periodShift"):
        # Leave dateRange to QaBootstrap for correctness; still stamp command.
        pass
    man[QA_KEY] = encode_storage_value(json.dumps(cmd))
    # Also write plain object form that retrieve() accepts if double-encoding differs
    man_path.write_text(json.dumps(man, separators=(",", ":")))
    push_as(local)
    log(f"QA_CMD {cmd.get('id')} -> {cmd}")


QA_KEY = "inteliads.qa.command"


def run_case(cmd: dict, wait: float = 8.0) -> list[dict]:
    write_qa_command(cmd)
    launch()
    time.sleep(wait)
    items = ax_list(cmd["id"])
    snapshot(items, cmd["id"])
    return items


def summarize() -> None:
    text = ""
    for name in ("process.log", "signals.log"):
        p = OUT / "logs" / name
        if p.exists():
            text += p.read_text(errors="replace") + "\n"
    qa = re.findall(r"\[inteliads:qa\][^\n]+", text)
    perf = re.findall(r"\[inteliads:perf\][^\n]+", text)
    errors = [
        ln
        for ln in text.splitlines()
        if re.search(
            r"HOME_QUERY_TIMEOUT|BooksReadError|TypeError|Unhandled JS|INCOMPLETE_READ|AbortError|RedBox|ExceptionsManager",
            ln,
            re.I,
        )
    ]
    summary = [
        f"OUT={OUT}",
        f"qa_logs={len(qa)} perf={len(perf)} errors={len(errors)}",
        "--- qa ---",
        *qa,
        "--- errors ---",
        *errors[-60:],
        "--- perf ---",
        *perf[-80:],
        "--- steps ---",
        *(OUT / "logs" / "steps.txt").read_text().splitlines(),
    ]
    (OUT / "logs" / "summary.txt").write_text("\n".join(summary))
    log(f"SUMMARY qa={len(qa)} perf={len(perf)} errors={len(errors)}")


def main() -> int:
    log(f"START {OUT}")
    procs = start_syslog()
    try:
        # Overview period matrix
        run_case({"id": "ov-month", "route": "/(tabs)", "periodMode": "month"}, wait=7)
        run_case({"id": "ov-week", "route": "/(tabs)", "periodMode": "week"}, wait=7)
        for i in range(1, 4):
            run_case(
                {"id": f"ov-prev-{i}", "route": "/(tabs)", "periodMode": "month", "periodShift": -i},
                wait=8,
            )
        run_case({"id": "ov-next-back", "route": "/(tabs)", "periodMode": "month", "periodShift": 0}, wait=6)

        # Date presets on Campaigns / Targets / Books
        for tab, route in (
            ("campaigns", "/(tabs)/campaigns"),
            ("targets", "/(tabs)/targeting"),
            ("books", "/(tabs)/products"),
        ):
            for preset in DATE_PRESETS:
                slug = preset.lower().replace(" ", "-")
                run_case(
                    {"id": f"{tab}-{slug}", "route": route, "dateLabel": preset},
                    wait=9 if preset in ("All time", "Last 90 days", "Last 60 days") else 7,
                )

        # Campaign filters
        for state in ("all", "enabled", "paused"):
            for sort in ("top", "spend", "orders", "acos"):
                run_case(
                    {
                        "id": f"camp-{state}-{sort}",
                        "route": "/(tabs)/campaigns",
                        "dateLabel": "This month",
                        "campaignsState": state,
                        "campaignsSort": sort,
                    },
                    wait=7,
                )

        # Targets segments + perf + sort
        for seg in ("keywords", "asins", "auto", "category", "placement"):
            run_case(
                {
                    "id": f"tgt-seg-{seg}",
                    "route": "/(tabs)/targeting",
                    "dateLabel": "This month",
                    "targetsSegment": seg,
                },
                wait=10,
            )
        for perf in ("all", "wasting", "high_acos", "no_sales", "profitable"):
            run_case(
                {
                    "id": f"tgt-perf-{perf}",
                    "route": "/(tabs)/targeting",
                    "dateLabel": "This month",
                    "targetsPerf": perf,
                    "targetsSort": "spend",
                },
                wait=8,
            )
        for sort in ("spend", "acos", "orders"):
            run_case(
                {
                    "id": f"tgt-sort-{sort}",
                    "route": "/(tabs)/targeting",
                    "dateLabel": "This month",
                    "targetsSort": sort,
                },
                wait=8,
            )

        # Books sorts
        for sort in ("net", "spend", "acos", "orders"):
            run_case(
                {
                    "id": f"books-sort-{sort}",
                    "route": "/(tabs)/products",
                    "dateLabel": "This month",
                    "booksSort": sort,
                },
                wait=8,
            )

        run_case({"id": "final-overview", "route": "/(tabs)", "periodMode": "month"}, wait=6)
    finally:
        time.sleep(2)
        summarize()
        for p in procs:
            p.send_signal(signal.SIGINT)
            try:
                p.wait(timeout=4)
            except subprocess.TimeoutExpired:
                p.kill()
        log(f"DONE {OUT}")
        print(OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
