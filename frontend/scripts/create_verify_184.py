#!/usr/bin/env python3
"""Create Verify on iPhone 14 Pro for InteliAds 184.

Opens Create via QA AsyncStorage (router.replace) with paperback ASIN + products
targeting, screenshots after settle, OCR for real titles (not ASIN-as-title).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path

BUNDLE = "io.inteliads.app"
UDID = "00008120-001210563E6BC01E"
PM = os.environ.get(
    "PYMOBILEDEVICE3_BIN",
    "/Users/emiliansusanu/Downloads/iosapp-inteli/frontend/.venv-device/bin/pymobiledevice3",
)
REPO = Path("/Users/emiliansusanu/Downloads/iosapp-inteli")
OUT = Path(
    os.environ.get(
        "CREATE_VERIFY_OUT",
        str(REPO / "docs/qa/evidence/cache-stale-cert-184"),
    )
)
APP = Path(
    os.environ.get(
        "INTELIADS_APP",
        "/tmp/InteliAds-DD-184/Build/Products/Release-iphoneos/InteliAds.app",
    )
)
AS_REMOTE = "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1"
QA_KEY = "inteliads.qa.command"
TESSERACT = "/opt/homebrew/bin/tesseract"
# Paperback from Nest book-candidates (Alaska Travel Guide 2025)
PAPERBACK = os.environ.get("CREATE_VERIFY_ASIN", "B0F2FH1XXD")
ASIN_RE = re.compile(r"\bB0[A-Z0-9]{8}\b")

for d in ("screens", "logs", "ax", "as"):
    (OUT / d).mkdir(parents=True, exist_ok=True)


def env_dev() -> dict[str, str]:
    e = {k: v for k, v in os.environ.items() if k != "PYMOBILEDEVICE3_UDID"}
    e["PATH"] = str(Path(PM).parent) + ":" + e.get("PATH", "")
    return e


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with (OUT / "logs" / "create-verify.txt").open("a") as f:
        f.write(line + "\n")


def kill_app() -> None:
    subprocess.run(
        [PM, "developer", "dvt", "pkill", "InteliAds", "--udid", UDID],
        capture_output=True,
        env=env_dev(),
        timeout=30,
    )


def launch(path: str | None = None) -> None:
    cmd = [PM, "developer", "dvt", "launch", BUNDLE, "--kill-existing", "--udid", UDID]
    if path:
        cmd += ["--env", f"EXPO_ROUTER_INITIAL_URL={path}"]
    r = subprocess.run(cmd, capture_output=True, text=True, env=env_dev(), timeout=45)
    log(f"LAUNCH path={path or '/'} rc={r.returncode} err={(r.stderr or '')[:120]}")


def screenshot(name: str) -> Path | None:
    dest = OUT / "screens" / f"{name}.png"
    try:
        r = subprocess.run(
            [PM, "developer", "dvt", "screenshot", str(dest), "--udid", UDID],
            capture_output=True,
            text=True,
            env=env_dev(),
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        log(f"SHOT {name} TIMEOUT")
        return None
    ok = dest.exists() and dest.stat().st_size > 50000
    log(f"SHOT {name} ok={ok} bytes={dest.stat().st_size if dest.exists() else 0} rc={r.returncode}")
    return dest if ok else None


def ocr(png: Path, tag: str) -> str:
    out_base = OUT / "ax" / f"{tag}-ocr"
    try:
        subprocess.run(
            [TESSERACT, str(png), str(out_base), "-l", "eng", "--psm", "6"],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except Exception as e:
        log(f"OCR_FAIL {tag} {e}")
        return ""
    txt_path = Path(str(out_base) + ".txt")
    text = txt_path.read_text(errors="replace") if txt_path.exists() else ""
    (OUT / "ax" / f"{tag}.txt").write_text(text)
    return text


def pull_as(subdir: str = "pull") -> Path:
    dest = OUT / "as" / subdir
    if dest.exists():
        for p in dest.rglob("*"):
            if p.is_file():
                p.unlink()
    dest.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [PM, "apps", "pull", "--udid", UDID, BUNDLE, AS_REMOTE, str(dest)],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=60,
    )
    nested = dest / "RCTAsyncLocalStorage_V1"
    return nested if nested.exists() else dest


def write_qa_command(cmd: dict) -> None:
    kill_app()
    time.sleep(0.5)
    local = pull_as("work")
    man_path = local / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    man[QA_KEY] = json.dumps(json.dumps(cmd))
    man_path.write_text(json.dumps(man, separators=(",", ":")))
    subprocess.run(
        [PM, "apps", "push", "--udid", UDID, BUNDLE, str(man_path), f"{AS_REMOTE}/manifest.json"],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=45,
    )
    log(f"QA_CMD {cmd}")


def install_app() -> None:
    if not APP.is_dir():
        raise SystemExit(f"missing app {APP}")
    version = subprocess.run(
        ["/usr/libexec/PlistBuddy", "-c", "Print :CFBundleVersion", str(APP / "Info.plist")],
        capture_output=True,
        text=True,
        timeout=10,
    ).stdout.strip()
    log(f"INSTALL {APP} CFBundleVersion={version}")
    r = subprocess.run(
        ["xcrun", "devicectl", "device", "install", "app", "--device", UDID, str(APP)],
        capture_output=True,
        text=True,
        timeout=180,
    )
    log(f"INSTALL rc={r.returncode} {(r.stdout or r.stderr or '')[:200]}")


def judge_create_ocr(text: str) -> dict:
    low = text.lower()
    create_ui = any(
        s in low
        for s in (
            "verify with amazon",
            "refresh suggestions",
            "loading product",
            "create campaign",
            "automatic",
            "title unavailable",
        )
    )
    alert_stock_block = "did not confirm this" in low or "couldn't load suggestions" in low
    asin_tokens = ASIN_RE.findall(text.upper())
    asin_as_title = False
    for line in text.splitlines():
        stripped = line.strip()
        if ASIN_RE.fullmatch(stripped.upper().replace(" ", "")):
            asin_as_title = True
            break
    has_title_unavailable = "title unavailable" in low
    has_stock = any(s in low for s in ("in stock", "out of stock"))
    # Suggestion rows: need list content beyond soft-fail paste copy / alerts.
    soft_fail_only = "suggestions unavailable" in low or "paste asins" in low
    titleish = [
        ln.strip()
        for ln in text.splitlines()
        if len(ln.strip()) >= 12
        and " " in ln.strip()
        and not ASIN_RE.search(ln.upper())
        and not any(
            bad in ln.lower()
            for bad in (
                "campaign",
                "targeting",
                "budget",
                "verify",
                "amazon",
                "profile",
                "couldn't",
                "marketplace",
                "catalog",
                "paperback is",
                "paste",
                "refresh",
                "automatic",
                "create paused",
            )
        )
    ]
    # PASS only when Create is open AND we see suggestion titles (or Title unavailable)
    # without a stock-block alert hiding the list.
    suggestions_ok = (has_title_unavailable or bool(titleish)) and not alert_stock_block and not soft_fail_only
    return {
        "create_ui": create_ui,
        "asin_tokens": asin_tokens[:20],
        "asin_as_title": asin_as_title,
        "has_title_unavailable": has_title_unavailable,
        "has_stock_badge": has_stock,
        "alert_stock_block": alert_stock_block,
        "soft_fail_only": soft_fail_only,
        "titleish_lines": titleish[:12],
        "pass": bool(create_ui and suggestions_ok and not asin_as_title),
    }


def main() -> None:
    (OUT / "logs" / "create-verify.txt").write_text("")
    if os.environ.get("SKIP_INSTALL") != "1":
        install_app()
        time.sleep(1)

    route = f"/campaign/create?asin={PAPERBACK}&targeting=products"
    write_qa_command({"id": "create-verify-184", "route": route})
    launch()  # QA apply on auth — no EXPO_ROUTER needed
    time.sleep(18)
    shot1 = screenshot("20-create-prefill")
    text1 = ocr(shot1, "20-create-prefill") if shot1 else ""
    log(f"OCR1 snip={text1[:180]!r}")

    # Allow Amazon suggestions to land
    time.sleep(22)
    shot2 = screenshot("21-create-suggestions")
    text2 = ocr(shot2, "21-create-suggestions") if shot2 else ""
    log(f"OCR2 snip={text2[:180]!r}")

    # Also try deep-link initial URL path (now allowlisted in 184)
    kill_app()
    time.sleep(0.5)
    launch(route)
    time.sleep(16)
    shot3 = screenshot("22-create-deeplink")
    text3 = ocr(shot3, "22-create-deeplink") if shot3 else ""
    log(f"OCR3 snip={text3[:180]!r}")

    j1 = judge_create_ocr(text1)
    j2 = judge_create_ocr(text2)
    j3 = judge_create_ocr(text3)
    best = max([j1, j2, j3], key=lambda j: (j["pass"], j["create_ui"], len(j["titleish_lines"])))
    result = {
        "build": "184",
        "device": UDID,
        "paperback": PAPERBACK,
        "route": route,
        "judges": {"prefill": j1, "suggestions": j2, "deeplink": j3},
        "best": best,
        "pass": best["pass"],
    }
    (OUT / "CREATE_VERIFY.json").write_text(json.dumps(result, indent=2))
    log(f"RESULT pass={result['pass']} best={json.dumps(best)[:300]}")
    raise SystemExit(0 if result["pass"] else 2)


if __name__ == "__main__":
    main()
