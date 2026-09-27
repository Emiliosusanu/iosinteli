#!/usr/bin/env python3
"""Create Campaign → Products AI filter smoke ×10 on cable iPhone 14 Pro (build 286).

QA deep-link to /campaign/create with Croatia in-stock ASIN + Products targeting.
Pass criteria per run: Step 2 AI chrome shows Amazon count > 0 and finishes
(Kept N / AI kept all / restored / failed confirm) — not stuck Ranking… forever,
and not "No Amazon suggestions" / couldn't load.
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
UDID = "00008120-001210563E6BC01E"
PM = os.environ.get(
    "PYMOBILEDEVICE3_BIN",
    "/Users/emiliansusanu/Downloads/iosapp-inteli/frontend/.venv-device/bin/pymobiledevice3",
)
AS_REMOTE = "Library/Application Support/io.inteliads.app/RCTAsyncLocalStorage_V1"
QA_KEY = "inteliads.qa.command"
TESSERACT = "/opt/homebrew/bin/tesseract"

ASIN = os.environ.get("CREATE_PRODUCTS_ASIN", "B0FW468FBB").strip()  # Croatia 2026
PROFILE_ID = os.environ.get("CREATE_PRODUCTS_PROFILE", "2543611550477751").strip()  # US
RUNS = int(os.environ.get("CREATE_PRODUCTS_RUNS", "10"))

OUT = Path(
    f"/tmp/inteliads-create-products-ai-286-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
)
for d in ("screens", "logs", "ax", "as"):
    (OUT / d).mkdir(parents=True, exist_ok=True)
Path("/tmp/inteliads-create-products-ai-286-latest.path").write_text(str(OUT))


def env_dev() -> dict[str, str]:
    e = {k: v for k, v in os.environ.items() if k != "PYMOBILEDEVICE3_UDID"}
    e["PATH"] = (
        str(Path(PM).parent)
        + ":/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:"
        + e.get("PATH", "")
    )
    return e


def env_ax() -> dict[str, str]:
    e = env_dev()
    e["PYMOBILEDEVICE3_UDID"] = UDID
    return e


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with (OUT / "logs" / "smoke.txt").open("a") as f:
        f.write(line + "\n")


def kill_app() -> None:
    subprocess.run(
        [PM, "developer", "dvt", "pkill", "InteliAds", "--udid", UDID],
        capture_output=True,
        env=env_dev(),
        timeout=30,
    )


def launch() -> None:
    r = subprocess.run(
        [
            PM,
            "developer",
            "dvt",
            "launch",
            BUNDLE,
            "--kill-existing",
            "--udid",
            UDID,
            "--userspace",
        ],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=45,
    )
    log(f"LAUNCH rc={r.returncode}")


def screenshot(name: str) -> Path | None:
    dest = OUT / "screens" / f"{name}.png"
    subprocess.run(
        [PM, "developer", "dvt", "screenshot", str(dest), "--udid", UDID],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=30,
    )
    ok = dest.exists() and dest.stat().st_size > 20_000
    log(f"SHOT {name} ok={ok} bytes={dest.stat().st_size if dest.exists() else 0}")
    return dest if ok else None


def ocr(png: Path | None, tag: str) -> str:
    if not png or not Path(TESSERACT).exists():
        return ""
    # Device screenshots are often 16-bit PNG; tesseract needs 8-bit JPEG.
    jpg = OUT / "screens" / f"{tag}.jpg"
    try:
        subprocess.run(
            ["sips", "-s", "format", "jpeg", str(png), "--out", str(jpg)],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except Exception as e:
        log(f"SIPS_FAIL {tag} {e}")
        return ""
    if not jpg.exists():
        return ""
    out_base = OUT / "ax" / f"{tag}-ocr"
    try:
        subprocess.run(
            [TESSERACT, str(jpg), str(out_base), "-l", "eng", "--psm", "6"],
            capture_output=True,
            timeout=60,
        )
    except Exception as e:
        log(f"OCR_FAIL {tag} {e}")
        return ""
    txt = Path(str(out_base) + ".txt")
    text = txt.read_text(errors="replace") if txt.exists() else ""
    (OUT / "ax" / f"{tag}.txt").write_text(text)
    return text


def ax_captions(tag: str) -> list[str]:
    out = OUT / "ax" / f"{tag}.json"
    err = OUT / "ax" / f"{tag}.err"
    with out.open("w") as fo, err.open("w") as fe:
        r = subprocess.run(
            [PM, "developer", "accessibility", "list-items", "--udid", UDID],
            stdout=fo,
            stderr=fe,
            env=env_ax(),
            timeout=90,
        )
    if r.returncode != 0 or out.stat().st_size < 2:
        log(f"AX_FAIL {tag} rc={r.returncode}")
        return []
    try:
        items = json.loads(out.read_text())
    except Exception as e:
        log(f"AX_PARSE {tag} {e}")
        return []
    caps = []
    for it in items if isinstance(items, list) else []:
        c = str(it.get("caption") or it.get("label") or it.get("value") or "").strip()
        if c:
            caps.append(c)
    log(f"AX {tag} n={len(caps)}")
    return caps


def pull_as() -> Path:
    dest = OUT / "as" / "work"
    dest.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [PM, "apps", "pull", "--udid", UDID, BUNDLE, AS_REMOTE, str(dest)],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=90,
    )
    nested = dest / "RCTAsyncLocalStorage_V1"
    return nested if nested.exists() else dest


def write_qa_command(cmd: dict) -> None:
    kill_app()
    time.sleep(0.7)
    local = pull_as()
    man_path = local / "manifest.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    man[QA_KEY] = json.dumps(json.dumps(cmd))
    man_path.write_text(json.dumps(man, separators=(",", ":")))
    # Flat push only — never nested RCTAsyncLocalStorage_V1 path on push
    r = subprocess.run(
        [
            PM,
            "apps",
            "push",
            "--udid",
            UDID,
            BUNDLE,
            str(man_path),
            f"{AS_REMOTE}/manifest.json",
        ],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=45,
    )
    log(f"QA_PUSH rc={r.returncode} id={cmd.get('id')}")


def installed_version() -> str:
    r = subprocess.run(
        [PM, "apps", "query", BUNDLE, "--udid", UDID],
        capture_output=True,
        text=True,
        env=env_dev(),
        timeout=60,
    )
    m = re.search(r'"CFBundleVersion"\s*:\s*"([^"]+)"', r.stdout or "")
    return m.group(1) if m else "?"


def judge(text: str, captions: list[str]) -> dict:
    blob = (text + "\n" + "\n".join(captions)).lower()
    amazon_m = re.search(r"amazon\s*[·•.\-]\s*(\d+)", blob, re.I)
    # Fallback: "Deselect all · 342" after AI kept
    if not amazon_m:
        amazon_m = re.search(r"deselect all\s*[·•.\-]\s*(\d+)", blob, re.I)
    kept_m = re.search(r"kept\s+(\d+)", blob, re.I)
    amazon_n = int(amazon_m.group(1)) if amazon_m else None
    kept_n = int(kept_m.group(1)) if kept_m else None
    pending = ("ranking" in blob or "ai filtering" in blob) and "ai kept" not in blob
    finished = any(
        s in blob
        for s in (
            "ai kept all",
            "ai kept high",
            "ai kept full",
            "kept ",
            "amazon restored",
            "ai filter failed",
            "using amazon unfiltered",
            "no amazon suggestions",
        )
    )
    load_fail = any(
        s in blob
        for s in (
            "couldn't load suggestions",
            "couldnt load suggestions",
            "couldn't load amazon",
        )
    )
    no_amazon = "no amazon suggestions" in blob or (
        amazon_n == 0 and finished and not pending
    )
    products_ui = "products" in blob or "asin" in blob or "product" in blob
    create_ui = "create campaign" in blob or "new campaign" in blob or "daily budget" in blob
    pass_ok = (
        not load_fail
        and not no_amazon
        and amazon_n is not None
        and amazon_n > 0
        and finished
        and not pending
    )
    return {
        "pass": pass_ok,
        "amazon_n": amazon_n,
        "kept_n": kept_n,
        "pending": pending,
        "finished": finished,
        "load_fail": load_fail,
        "no_amazon": no_amazon,
        "products_ui": products_ui,
        "create_ui": create_ui,
    }


def poll_until_done(tag: str, max_wait: float = 110.0) -> dict:
    """Poll AX until AI chrome finishes or timeout (product AI can be slow)."""
    start = time.time()
    last: dict = {
        "pass": False,
        "amazon_n": None,
        "kept_n": None,
        "pending": True,
        "finished": False,
        "load_fail": False,
        "no_amazon": False,
        "products_ui": False,
        "create_ui": False,
        "wait_s": 0,
        "ocr_snippet": "",
    }
    attempt = 0
    while time.time() - start < max_wait:
        attempt += 1
        time.sleep(8 if attempt == 1 else 12)
        shot = screenshot(f"{tag}-a{attempt}")
        caps = ax_captions(f"{tag}-a{attempt}")
        text = ocr(shot, f"{tag}-a{attempt}")
        j = judge(text, caps)
        j["wait_s"] = round(time.time() - start, 1)
        j["ocr_snippet"] = (text or "\n".join(caps))[:500]
        last = j
        log(
            f"POLL {tag} a{attempt} wait={j['wait_s']}s amazon={j['amazon_n']} "
            f"pending={j['pending']} finished={j['finished']} pass={j['pass']}"
        )
        if j["pass"] or j["load_fail"] or j["no_amazon"]:
            return j
        blob = (j["ocr_snippet"] or "").lower()
        if "choose a book and marketplace first" in blob and j["wait_s"] > 50:
            return j
    return last


def run_once(i: int) -> dict:
    tag = f"r{i:02d}"
    cmd = {
        "id": f"create-products-ai-{tag}",
        "route": "/campaign/create",
        "createAsin": ASIN,
        "createTargeting": "products",
        "createProfileId": PROFILE_ID,
    }
    write_qa_command(cmd)
    launch()
    j = poll_until_done(tag, max_wait=110.0)
    j["run"] = i
    log(f"JUDGE {tag} {json.dumps({k: j[k] for k in j if k != 'ocr_snippet'})}")
    return j


def main() -> int:
    ver = installed_version()
    log(f"OUT={OUT}")
    log(f"CFBundleVersion={ver} ASIN={ASIN} PROFILE={PROFILE_ID} RUNS={RUNS}")
    results = []
    for i in range(1, RUNS + 1):
        try:
            results.append(run_once(i))
        except Exception as e:
            log(f"RUN_FAIL {i} {e}")
            results.append({"run": i, "pass": False, "error": str(e)})
    passed = sum(1 for r in results if r.get("pass"))
    summary = {
        "build": ver,
        "asin": ASIN,
        "profileId": PROFILE_ID,
        "runs": RUNS,
        "passed": passed,
        "failed": RUNS - passed,
        "results": results,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    log(f"SUMMARY passed={passed}/{RUNS}")
    print(json.dumps({"passed": passed, "runs": RUNS, "out": str(OUT)}, indent=2))
    return 0 if passed == RUNS else 1


if __name__ == "__main__":
    raise SystemExit(main())
