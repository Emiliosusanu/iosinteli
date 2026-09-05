#!/usr/bin/env python3
"""Live bulk-bid outbox drain on a physical iPhone.

AX Activate is a no-op on this host, so we cannot tap Select → +$0.01.
Instead we enqueue the same durable outbox payload the Targeting bulk bar
writes, relaunch so AppContext drains it to Nest/Amazon, then assert AS.

Uses a tiny +$0.01 then reverts −$0.01 so Amazon ends where it started.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

BUNDLE = "io.inteliads.app"
UDID = os.environ.get("INTELIADS_UDID", "00008120-001210563E6BC01E")
AS_REMOTE = "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1"
OUTBOX_KEY = "inteliads.bulkOutbox.v1"
QA_KEY = "inteliads.qa.command"
VENV_PY = Path(__file__).resolve().parents[1] / ".venv-device" / "bin" / "python"
OUT = Path(f"/tmp/inteliads-bulk-live-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
(OUT / "logs").mkdir(parents=True)
(OUT / "as").mkdir(parents=True)
Path("/tmp/inteliads-bulk-live-latest.path").write_text(str(OUT))

# Real keyword from device query cache (enabled, bid >= $0.02).
ENTITY_ID = os.environ.get("BULK_KEYWORD_ID", "189848531252882")
ENTITY_TEXT = os.environ.get("BULK_KEYWORD_TEXT", "iceland")
BASE_BID = float(os.environ.get("BULK_BASE_BID", "0.71"))
DELTA = float(os.environ.get("BULK_DELTA", "0.01"))


def env_dev() -> dict[str, str]:
    e = {k: v for k, v in os.environ.items() if k != "PYMOBILEDEVICE3_UDID"}
    e["PATH"] = f"{VENV_PY.parent}:{e.get('PATH', '')}"
    return e


def pmd(args: list[str], timeout: int = 90) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["pymobiledevice3", *args],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=timeout,
    )


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    (OUT / "logs" / "steps.txt").open("a").write(line + "\n")


def kill_app() -> None:
    pmd(["developer", "dvt", "pkill", "InteliAds"])
    time.sleep(0.8)


def launch() -> None:
    r = pmd(["developer", "dvt", "launch", BUNDLE, "--kill-existing"], timeout=60)
    log(f"LAUNCH rc={r.returncode} { (r.stderr or r.stdout or '')[-120:] }")
    time.sleep(8.0)


def pull_as(tag: str) -> Path:
    dest = OUT / "as" / tag
    if dest.exists():
        for p in dest.rglob("*"):
            if p.is_file():
                p.unlink()
    dest.mkdir(parents=True, exist_ok=True)
    r = pmd(["apps", "pull", BUNDLE, AS_REMOTE, str(dest)], timeout=120)
    if r.returncode != 0:
        log(f"AS_PULL_FAIL {tag} {(r.stderr or '')[-200:]}")
    nested = dest / "RCTAsyncLocalStorage_V1"
    return nested if nested.exists() else dest


def push_as(local: Path) -> None:
    for f in local.iterdir():
        if not f.is_file():
            continue
        r = pmd(
            ["apps", "push", BUNDLE, str(f), f"{AS_REMOTE}/{f.name}"],
            timeout=60,
        )
        if r.returncode != 0:
            log(f"AS_PUSH_FAIL {f.name} {(r.stderr or '')[-160:]}")


def encode_storage_value(value: object) -> str:
    # Matches storage.setItem → AsyncStorage.setItem(key, JSON.stringify(value))
    return json.dumps(value)


def read_outbox(as_dir: Path) -> dict:
    man_path = as_dir / "manifest.json"
    if not man_path.exists():
        return {"items": [], "raw": None}
    man = json.loads(man_path.read_text())
    raw = man.get(OUTBOX_KEY)
    if raw is None:
        return {"items": [], "raw": None}
    # raw is JSON-stringified payload string
    if isinstance(raw, str):
        try:
            inner = json.loads(raw)
        except json.JSONDecodeError:
            inner = raw
        if isinstance(inner, str):
            try:
                parsed = json.loads(inner)
            except json.JSONDecodeError:
                return {"items": [], "raw": raw}
        elif isinstance(inner, dict):
            parsed = inner
        else:
            return {"items": [], "raw": raw}
    elif isinstance(raw, dict):
        parsed = raw
    else:
        return {"items": [], "raw": raw}
    items = parsed.get("items") if isinstance(parsed, dict) else []
    return {"items": items if isinstance(items, list) else [], "raw": raw}


def write_outbox_and_qa(items: list[dict], qa: dict | None = None) -> None:
    kill_app()
    local = pull_as("prewrite")
    man_path = local / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    payload = json.dumps({"items": items})
    man[OUTBOX_KEY] = encode_storage_value(payload)
    if qa is not None:
        man[QA_KEY] = encode_storage_value(json.dumps(qa))
    man_path.write_text(json.dumps(man, separators=(",", ":")))
    (OUT / "as" / "queued.json").write_text(json.dumps({"items": items}, indent=2))
    push_as(local)
    log(f"QUEUED n={len(items)} entity={ENTITY_ID} text={ENTITY_TEXT}")


def summarize_items(items: list[dict]) -> str:
    parts = []
    for it in items:
        parts.append(
            f"{it.get('status')}:{it.get('action')}:{it.get('entityId')}:"
            f"bid={it.get('bid')} delta={it.get('deltaUsd')} err={it.get('lastError')}"
        )
    return " | ".join(parts) if parts else "(empty)"


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
                r"bulk|outbox|Amazon|keyword|NestApi|Unauthorized|failed_permanent|Writing to Amazon|inteliads",
                "--out",
                str(OUT / "logs" / "signals.log"),
            ],
            stdout=subprocess.DEVNULL,
            stderr=(OUT / "logs" / "s2.err").open("w"),
            env=e,
        ),
    ]


def make_delta_item(delta: float, job_suffix: str) -> dict:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    next_bid = round(BASE_BID + delta, 2)
    return {
        "id": f"item_live_{job_suffix}_{int(time.time())}",
        "jobId": f"job_live_{job_suffix}_{int(time.time())}",
        "entityKind": "keyword",
        "entityId": ENTITY_ID,
        "action": "bid_delta",
        "deltaUsd": delta,
        "bid": next_bid,
        "baseBid": BASE_BID if delta > 0 else round(BASE_BID + DELTA, 2),
        "previousBid": BASE_BID if delta > 0 else round(BASE_BID + DELTA, 2),
        "previousEnabled": None,
        "status": "pending",
        "attempts": 0,
        "lastError": None,
        "nextAttemptAt": None,
        "createdAt": stamp,
        "updatedAt": stamp,
    }


def await_drain(tag: str, expect_entity: str, wait_s: float = 18.0) -> dict:
    deadline = time.time() + wait_s
    last: dict = {"items": []}
    while time.time() < deadline:
        time.sleep(3.0)
        as_dir = pull_as(tag)
        last = read_outbox(as_dir)
        items = last["items"]
        live = [
            i
            for i in items
            if i.get("entityId") == expect_entity
            and i.get("status") in ("pending", "in_flight", "failed_permanent")
        ]
        done_gone = not any(
            i.get("entityId") == expect_entity and i.get("status") in ("pending", "in_flight")
            for i in items
        )
        log(f"POLL {tag} {summarize_items(items)}")
        if done_gone and not any(i.get("status") == "failed_permanent" and i.get("entityId") == expect_entity for i in items):
            # success: done items pruned, or never written because empty
            return {"ok": True, "items": items, "failed": False}
        if any(i.get("status") == "failed_permanent" and i.get("entityId") == expect_entity for i in items):
            return {"ok": False, "items": items, "failed": True}
        if live and all(i.get("attempts", 0) >= 1 for i in live):
            # still retrying — keep waiting a bit
            continue
    return {"ok": False, "items": last.get("items", []), "failed": False, "timeout": True}


def main() -> int:
    log(f"START out={OUT} udid={UDID} keyword={ENTITY_ID}({ENTITY_TEXT}) base={BASE_BID} delta=+{DELTA}")
    procs = start_syslog()
    result = {
        "pass": False,
        "bump": None,
        "revert": None,
        "note": "",
    }
    try:
        # Phase 1: +$0.01
        bump = make_delta_item(DELTA, "bump")
        # For +delta, baseBid must be current Amazon bid
        bump["baseBid"] = BASE_BID
        bump["previousBid"] = BASE_BID
        bump["bid"] = round(BASE_BID + DELTA, 2)
        write_outbox_and_qa(
            [bump],
            qa={
                "id": "bulk-live-bump",
                "route": "/(tabs)/targeting",
                "targetsSegment": "keywords",
                "targetsPerf": "all",
                "dateLabel": "This month",
            },
        )
        launch()
        bump_res = await_drain("after-bump", ENTITY_ID, wait_s=22.0)
        result["bump"] = {
            "ok": bump_res.get("ok"),
            "failed": bump_res.get("failed"),
            "timeout": bump_res.get("timeout"),
            "items": bump_res.get("items"),
        }
        log(f"BUMP_RESULT {json.dumps({k:v for k,v in result['bump'].items() if k!='items'})}")

        if bump_res.get("failed"):
            result["note"] = "Amazon/Nest rejected +$0.01 (failed_permanent in outbox)"
            (OUT / "result.json").write_text(json.dumps(result, indent=2))
            log("FAIL permanent on bump")
            return 2

        if not bump_res.get("ok"):
            result["note"] = "Bump did not drain to done within timeout (pending/in_flight remain)"
            (OUT / "result.json").write_text(json.dumps(result, indent=2))
            log("FAIL timeout on bump")
            return 3

        # Phase 2: revert −$0.01 (base is now BASE+DELTA)
        rev = make_delta_item(-DELTA, "revert")
        rev["baseBid"] = round(BASE_BID + DELTA, 2)
        rev["previousBid"] = round(BASE_BID + DELTA, 2)
        rev["bid"] = BASE_BID
        rev["deltaUsd"] = -DELTA
        write_outbox_and_qa(
            [rev],
            qa={
                "id": "bulk-live-revert",
                "route": "/(tabs)/targeting",
                "targetsSegment": "keywords",
            },
        )
        launch()
        rev_res = await_drain("after-revert", ENTITY_ID, wait_s=22.0)
        result["revert"] = {
            "ok": rev_res.get("ok"),
            "failed": rev_res.get("failed"),
            "timeout": rev_res.get("timeout"),
            "items": rev_res.get("items"),
        }
        log(f"REVERT_RESULT {json.dumps({k:v for k,v in result['revert'].items() if k!='items'})}")

        if rev_res.get("failed"):
            result["note"] = "Bump OK but revert failed_permanent — Amazon bid may be BASE+0.01"
            (OUT / "result.json").write_text(json.dumps(result, indent=2))
            log("FAIL permanent on revert")
            return 4

        if not rev_res.get("ok"):
            result["note"] = "Bump OK but revert timed out"
            (OUT / "result.json").write_text(json.dumps(result, indent=2))
            log("FAIL timeout on revert")
            return 5

        result["pass"] = True
        result["note"] = (
            f"Live outbox drain OK: keyword {ENTITY_ID} ({ENTITY_TEXT}) "
            f"+{DELTA} then −{DELTA}; outbox pruned (Amazon accepted)."
        )
        (OUT / "result.json").write_text(json.dumps(result, indent=2))
        log(f"PASS {result['note']}")
        return 0
    finally:
        # scrape signals
        text = ""
        for name in ("process.log", "signals.log"):
            p = OUT / "logs" / name
            if p.exists():
                text += p.read_text(errors="replace") + "\n"
        hits = [
            ln
            for ln in text.splitlines()
            if re.search(r"bulk|outbox|failed_permanent|Couldn't update keyword|Unauthorized|401|403", ln, re.I)
        ]
        (OUT / "logs" / "bulk-signals.txt").write_text("\n".join(hits[-120:]))
        for p in procs:
            try:
                p.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
