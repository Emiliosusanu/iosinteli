#!/usr/bin/env python3
"""Focused QA: date/filter changes vs keyword + campaign metric completeness.

Drives QaBootstrap via AsyncStorage, captures syslog `[inteliads:targeting]` /
campaign/perf signals, and compares row counts across date presets.
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
QA_KEY = "inteliads.qa.command"
OUT = Path(f"/tmp/inteliads-kw-date-qa-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
(OUT / "logs").mkdir(parents=True)
(OUT / "as").mkdir(parents=True)
Path("/tmp/inteliads-kw-date-qa-latest.path").write_text(str(OUT))

DATE_PRESETS = [
    "Today",
    "Yesterday",
    "Last 7 days",
    "This month",
    "Last 30 days",
    "Last 60 days",
    "Last 90 days",
    "All time",
]

SEGMENTS = ("keywords", "asins", "auto", "category", "placement")
PERF_FILTERS = ("all", "wasting", "high_acos", "no_sales", "profitable")


def env_dev() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k != "PYMOBILEDEVICE3_UDID"}


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    (OUT / "logs" / "steps.txt").open("a").write(line + "\n")


def start_syslog() -> list[subprocess.Popen]:
    e = env_dev()
    return [
        subprocess.Popen(
            [
                "pymobiledevice3",
                "syslog",
                "live",
                "-pn",
                "InteliAds",
                "--out",
                str(OUT / "logs" / "process.log"),
            ],
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
                r"inteliads:(targeting|qa|perf|data)|INCOMPLETE_READ|HOME_QUERY|AbortError|TypeError|Unhandled",
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
    time.sleep(7.0)


def pull_as() -> Path:
    dest = OUT / "as" / "pull"
    if dest.exists():
        for p in dest.rglob("*"):
            if p.is_file():
                p.unlink()
    dest.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["pymobiledevice3", "apps", "pull", BUNDLE, AS_REMOTE, str(dest)],
        capture_output=True,
        text=True,
        env=env_dev(),
    )
    nested = dest / "RCTAsyncLocalStorage_V1"
    return nested if nested.exists() else dest


def push_as(local: Path) -> None:
    for f in local.iterdir():
        if not f.is_file():
            continue
        subprocess.run(
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


def write_qa_command(cmd: dict) -> None:
    kill_app()
    time.sleep(0.8)
    local = pull_as()
    man_path = local / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    man[QA_KEY] = json.dumps(json.dumps(cmd))
    man_path.write_text(json.dumps(man, separators=(",", ":")))
    push_as(local)
    log(f"QA_CMD {cmd.get('id')} -> {cmd}")


def run_case(cmd: dict, wait: float = 10.0) -> None:
    write_qa_command(cmd)
    launch()
    time.sleep(wait)


def parse_targeting_rows(text: str) -> list[dict]:
    rows = []
    # [inteliads:targeting] segment=keywords period=2026-09-01..2026-09-02 kw=idle/142 prod=idle/- place=idle/- active=ok
    pat = re.compile(
        r"\[inteliads:targeting\] segment=(?P<seg>\w+) period=(?P<start>[\d-]+)\.\.(?P<end>[\d-]+) "
        r"kw=(?P<kw_st>\w+)/(?P<kw>[-\d]+) "
        r"prod=(?P<prod_st>\w+)/(?P<prod>[-\d]+) "
        r"place=(?P<place_st>\w+)/(?P<place>[-\d]+) "
        r"active=(?P<active>\S+)"
    )
    for m in pat.finditer(text):
        d = m.groupdict()
        for k in ("kw", "prod", "place"):
            d[k] = None if d[k] == "-" else int(d[k])
        rows.append(d)
    return rows


def summarize() -> None:
    text = ""
    for name in ("process.log", "signals.log"):
        p = OUT / "logs" / name
        if p.exists():
            text += p.read_text(errors="replace") + "\n"

    targeting = parse_targeting_rows(text)
    qa = re.findall(r"\[inteliads:qa\][^\n]+", text)
    incomplete = [ln for ln in text.splitlines() if "INCOMPLETE_READ" in ln]
    errors = [
        ln
        for ln in text.splitlines()
        if re.search(
            r"HOME_QUERY_TIMEOUT|BooksReadError|TypeError|Unhandled JS|INCOMPLETE_READ|AbortError|RedBox|ExceptionsManager",
            ln,
            re.I,
        )
    ]

    # Latest observation per (segment, period)
    latest: dict[tuple[str, str, str], dict] = {}
    for row in targeting:
        key = (row["seg"], row["start"], row["end"])
        latest[key] = row

    # Keyword counts across date windows (segment=keywords)
    kw_by_period = []
    for (seg, start, end), row in sorted(latest.items(), key=lambda x: (x[0][1], x[0][2])):
        if seg != "keywords":
            continue
        kw_by_period.append(
            {
                "period": f"{start}..{end}",
                "kw": row["kw"],
                "kw_status": row["kw_st"],
                "active": row["active"],
            }
        )

    # Detect suspicious drops: wider window (longer span) with fewer keywords than a nested shorter one
    drops = []
    for i, a in enumerate(kw_by_period):
        for b in kw_by_period[i + 1 :]:
            if a["kw"] is None or b["kw"] is None:
                continue
            # naive: if later preset has fewer AND both idle/ok — flag for human review
            if b["kw"] < a["kw"] * 0.5 and a["kw"] >= 20:
                drops.append({"from": a, "to": b, "ratio": round(b["kw"] / max(a["kw"], 1), 3)})

    report = {
        "out": str(OUT),
        "qa_logs": len(qa),
        "targeting_samples": len(targeting),
        "unique_period_segments": len(latest),
        "keyword_counts_by_period": kw_by_period,
        "suspicious_drops": drops,
        "incomplete_reads": len(incomplete),
        "error_count": len(errors),
        "errors_tail": errors[-40:],
        "qa_tail": qa[-40:],
        "latest_by_key": [
            {"segment": k[0], "start": k[1], "end": k[2], **v}
            for k, v in sorted(latest.items())
        ],
    }
    (OUT / "logs" / "report.json").write_text(json.dumps(report, indent=2))

    lines = [
        f"OUT={OUT}",
        f"qa={len(qa)} targeting_lines={len(targeting)} incomplete={len(incomplete)} errors={len(errors)}",
        "--- keyword counts by period ---",
        *[f"  {r['period']}  kw={r['kw']} status={r['kw_status']} active={r['active']}" for r in kw_by_period],
        "--- suspicious drops (>50% loss vs earlier sample, n>=20) ---",
        *(
            [f"  {d['from']['period']} kw={d['from']['kw']} -> {d['to']['period']} kw={d['to']['kw']} ratio={d['ratio']}" for d in drops]
            if drops
            else ["  (none)"]
        ),
        "--- all segments latest ---",
        *[
            f"  {r['segment']} {r['start']}..{r['end']} kw={r['kw']} prod={r['prod']} place={r['place']} active={r['active']}"
            for r in report["latest_by_key"]
        ],
        "--- errors ---",
        *(errors[-30:] or ["(none)"]),
    ]
    (OUT / "logs" / "summary.txt").write_text("\n".join(lines))
    log(f"SUMMARY kw_periods={len(kw_by_period)} drops={len(drops)} incomplete={len(incomplete)} errors={len(errors)}")
    print("\n".join(lines), flush=True)


def main() -> int:
    log(f"START {OUT}")
    procs = start_syslog()
    try:
        # 1) Keywords × date presets (core completeness check)
        for preset in DATE_PRESETS:
            slug = preset.lower().replace(" ", "-")
            wait = 12 if preset in ("All time", "Last 90 days", "Last 60 days") else 10
            run_case(
                {
                    "id": f"kw-{slug}",
                    "route": "/(tabs)/targeting",
                    "dateLabel": preset,
                    "targetsSegment": "keywords",
                    "targetsPerf": "all",
                    "targetsSort": "spend",
                },
                wait=wait,
            )

        # 2) Same month, swap segments — do product/placement lists populate?
        for seg in SEGMENTS:
            run_case(
                {
                    "id": f"seg-{seg}",
                    "route": "/(tabs)/targeting",
                    "dateLabel": "This month",
                    "targetsSegment": seg,
                    "targetsPerf": "all",
                },
                wait=11,
            )

        # 3) Perf filters on keywords this month — filtered counts should shrink, not error
        for perf in PERF_FILTERS:
            run_case(
                {
                    "id": f"perf-{perf}",
                    "route": "/(tabs)/targeting",
                    "dateLabel": "This month",
                    "targetsSegment": "keywords",
                    "targetsPerf": perf,
                    "targetsSort": "acos",
                },
                wait=9,
            )

        # 4) Campaigns date sweep (metric presence via AX is weak; still exercise loads)
        for preset in ("Yesterday", "This month", "Last 30 days", "Last 90 days"):
            slug = preset.lower().replace(" ", "-")
            run_case(
                {
                    "id": f"camp-{slug}",
                    "route": "/(tabs)/campaigns",
                    "dateLabel": preset,
                    "campaignsState": "all",
                    "campaignsSort": "spend",
                },
                wait=9,
            )

        # 5) Bounce back to keywords this month — count should return (no sticky empty)
        run_case(
            {
                "id": "kw-final-month",
                "route": "/(tabs)/targeting",
                "dateLabel": "This month",
                "targetsSegment": "keywords",
                "targetsPerf": "all",
            },
            wait=10,
        )
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
